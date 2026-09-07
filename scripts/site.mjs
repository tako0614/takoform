#!/usr/bin/env bun

// Generator and gate for the API and common-model-only takoform.com site.
//
// The site publishes the frozen Host API v1/common-model closure and the exact
// public schema bytes at the paths their $id values name. It also publishes
// clearly non-normative indexes and hand-authored presentation that point at
// those contracts without redefining them.
//
// Two rules keep it honest and are enforced below rather than reviewed:
//
//   1. Every mirrored page and every served schema byte is derived. A generated
//      page edited in place is a second source and drifts. `--check` re-derives
//      and compares.
//   2. Nothing is served that no derivation produced. A mirror that only ever
//      adds keeps publishing pages whose source was deleted, which is how a
//      withdrawn lane stays reachable and readable as current.
//
// Form definitions, per-Form examples, publisher catalogs, and client adapter
// pages are deliberately absent: they belong to the publisher or adapter that
// owns them, and re-hosting them here would make this repository look like a
// registry it is not.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_RELEASE } from "./core-release.mjs";
import { readHostAPIFreezeManifest } from "./host-api-freeze.mjs";
export const SITE_ROOT = "website";
export const SITE_PUBLIC_ROOT = `${SITE_ROOT}/public`;
export const SITE_DIST = `${SITE_ROOT}/.vitepress/dist`;
export const SCHEMA_IDENTITY_ORIGIN = "https://forms.takoform.com";
export const SCHEMA_LEDGER_PATH = "release/public-schema-identities.json";

const SOURCE_BROWSE = `https://github.com/${CORE_RELEASE.githubRepository}/blob/main`;
const SOURCE_TREE = `https://github.com/${CORE_RELEASE.githubRepository}/tree/main`;

// The immutable prose this site republishes comes only from the freeze. Retired
// Host API lanes and decision bodies are deliberately absent: a retired lane
// read as a current page is the exact confusion the lane withdrawal was for,
// and decisions are non-normative repository history rather than public/current
// contract pages.
export const FROZEN_HOST_API_SPEC_DOCUMENTS = Object.freeze(
  readHostAPIFreezeManifest(resolve(dirname(fileURLToPath(import.meta.url)), ".."))
    .normativeProse.map((entry) => entry.path),
);

export const MIRRORED_SPEC_DOCUMENTS = Object.freeze([...new Set([
  "spec/README.md",
  "spec/conformance.md",
  "spec/versioning.md",
  "spec/form-families.md",
  "spec/portability-boundary.md",
  "spec/core/README.md",
  "spec/form-definition/README.md",
  "spec/form-package/README.md",
  "spec/host-api/README.md",
  ...FROZEN_HOST_API_SPEC_DOCUMENTS,
  "spec/interface-contract/README.md",
  "spec/binding-contract/README.md",
  "spec/artifact-transport/README.md",
  "spec/standard-services/README.md",
  "spec/schemas/README.md",
  "spec/trust/README.md",
])]);

export const GENERATED_INDEX_PAGES = Object.freeze([
  `${SITE_ROOT}/schemas/index.md`,
]);

// Reader-first entry points are hand-authored by the documentation owner. The
// route inventory is explicit so a new page cannot become publishable merely
// by appearing under website/; every listed source is required by the site
// check and build route allowlist.
export const HAND_AUTHORED_ROUTE_SOURCES = Object.freeze([
  `${SITE_ROOT}/start/index.md`,
  `${SITE_ROOT}/guides/index.md`,
  `${SITE_ROOT}/reference/index.md`,
  `${SITE_ROOT}/glossary.md`,
]);

export const HAND_AUTHORED_PAGE_SOURCES = Object.freeze([
  `${SITE_ROOT}/index.md`,
  `${SITE_ROOT}/host-api/index.md`,
  `${SITE_ROOT}/model/index.md`,
  `${SITE_ROOT}/conformance/index.md`,
  `${SITE_ROOT}/site.md`,
  ...HAND_AUTHORED_ROUTE_SOURCES,
]);

const REQUIRED_HAND_AUTHORED_PAGE_SOURCES = HAND_AUTHORED_PAGE_SOURCES;

export const HAND_AUTHORED_PUBLIC_FILES = Object.freeze([
  `${SITE_PUBLIC_ROOT}/_headers`,
  `${SITE_PUBLIC_ROOT}/robots.txt`,
]);

export function inspectSiteAssets(root, distRoot) {
  const problems = [];
  for (const path of HAND_AUTHORED_PUBLIC_FILES) {
    let bytes;
    try {
      bytes = readBytes(root, path);
      if (bytes.length === 0) problems.push(`${path} is empty`);
    } catch {
      problems.push(`${path} is missing`);
      continue;
    }
    if (distRoot !== undefined) {
      const target = `${distRoot}/${path.slice(SITE_PUBLIC_ROOT.length + 1)}`;
      try {
        if (!readBytes(root, target).equals(bytes)) problems.push(`${target} differs from ${path}`);
      } catch {
        problems.push(`${target} is missing`);
      }
    }
  }
  return problems;
}

export function inspectDesignRecords(root) {
  const problems = [];
  for (const [path, fields] of [
    [".hallmark/preflight.json", ["scannedAt", "framework", "fonts", "palette", "motion", "spacing"]],
    [".hallmark/log.json", ["date", "macrostructure", "theme", "enrichment", "brief", "slopTest"]],
  ]) {
    try {
      const value = readJSON(root, path);
      const records = path.endsWith("/log.json") ? value : [value];
      if (!Array.isArray(records) || records.length === 0 || records.some((record) =>
        fields.some((field) => typeof record?.[field] !== "string" || record[field].trim() === "") ||
        (path.endsWith("/log.json") && (!Array.isArray(record.viewports) ||
          record.viewports.length === 0 || record.viewports.some((width) => !Number.isInteger(width) || width <= 0)))
      )) problems.push(`${path} has invalid design-record fields`);
    } catch {
      problems.push(`${path} is missing or invalid JSON`);
    }
  }
  return problems;
}

// Everything a generated tree owns end to end. A file that lives under one of
// these and is not produced by a derivation is deleted by `--write` and
// reported by `--check`.
const GENERATED_TREES = Object.freeze([
  `${SITE_ROOT}/spec`,
  `${SITE_ROOT}/decisions`,
  `${SITE_ROOT}/releases`,
  `${SITE_PUBLIC_ROOT}/.well-known`,
  `${SITE_PUBLIC_ROOT}/schemas`,
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readBytes(root, relativePath) {
  return readFileSync(resolve(root, relativePath));
}

function readText(root, relativePath) {
  return readBytes(root, relativePath).toString("utf8");
}

function readJSON(root, relativePath) {
  return JSON.parse(readText(root, relativePath));
}

function walk(root, relativeDir) {
  const absolute = resolve(root, relativeDir);
  if (!existsSync(absolute)) return [];
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const next = posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) found.push(...walk(root, next));
    else if (entry.isFile()) found.push(next);
  }
  return found.sort();
}

const NON_NORMATIVE_DECLARATION =
  /\b(?:This (?:page|document|index|guide) is non-normative|This non-normative (?:page|document|index|guide))\b/iu;
const NORMATIVE_REQUIREMENT =
  /\b(?:MUST(?: NOT)?|REQUIRED|SHALL(?: NOT)?|SHOULD(?: NOT)?|RECOMMENDED|MAY|OPTIONAL)\b/u;
const SELF_NORMATIVE_CLAIM =
  /(?:^#{1,6}\s+Normative\b|\bThis (?:page|document|guide|index|site) (?:is|defines|contains|specifies)[^\n.]{0,80}\bnormative\b)/imu;

function markdownProse(source) {
  return source
    .replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/gu, "$1")
    .replace(/(`+)[\s\S]*?\1/gu, "");
}

export function inspectPublicDocumentAuthority(
  documents,
  frozenPaths,
  { classificationRequiredPaths = new Set() } = {},
) {
  const problems = [];
  for (const [path, source] of documents) {
    if (frozenPaths.has(path)) continue;
    const prose = markdownProse(source);
    const explicitlyNonNormative = NON_NORMATIVE_DECLARATION.test(prose.slice(0, 512));
    if (classificationRequiredPaths.has(path) && !explicitlyNonNormative) {
      problems.push(
        `${path} is a public/current document outside the frozen closure and must explicitly declare itself non-normative`,
      );
      continue;
    }
    if (!explicitlyNonNormative &&
      (NORMATIVE_REQUIREMENT.test(prose) || SELF_NORMATIVE_CLAIM.test(prose))) {
      problems.push(`${path} defines normative behavior outside the frozen closure`);
    }
  }
  return problems;
}

export function inspectPublishedSourceAllowlist(paths, derivedPaths) {
  const problems = [];
  const allowedPageSources = new Set(HAND_AUTHORED_PAGE_SOURCES);
  const allowedPublicFiles = new Set(HAND_AUTHORED_PUBLIC_FILES);
  for (const path of paths) {
    if (path.startsWith(`${SITE_ROOT}/.vitepress/`)) continue;
    if (path.startsWith(`${SITE_PUBLIC_ROOT}/`)) {
      if (!derivedPaths.has(path) && !allowedPublicFiles.has(path)) {
        problems.push(`${path} would publish a static file outside the schema/site-asset allowlist`);
      }
      continue;
    }
    if (!path.endsWith(".md") && !path.endsWith(".html")) continue;
    if (!derivedPaths.has(path) && !allowedPageSources.has(path)) {
      problems.push(`${path} would publish a page outside the API/common-model allowlist`);
    }
  }
  return problems;
}

export function servedPathForIdentity(identity) {
  let url;
  try {
    url = new URL(identity.id);
  } catch {
    throw new Error(`schema identity is not a URL: ${identity.id}`);
  }
  if (url.origin !== SCHEMA_IDENTITY_ORIGIN) {
    throw new Error(`schema identity is not served from the identity origin: ${identity.id}`);
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error(`schema identity carries a query or fragment: ${identity.id}`);
  }
  if (!url.pathname.startsWith("/schemas/") || !url.pathname.endsWith(".json")) {
    throw new Error(`schema identity is outside the served schema tree: ${identity.id}`);
  }
  const expected = `${SITE_PUBLIC_ROOT}${url.pathname}`;
  if (identity.public !== expected) {
    throw new Error(
      `schema identity ${identity.id} declares public path ${identity.public}, not ${expected}`,
    );
  }
  return url.pathname;
}

export function deriveSchemas(root) {
  const ledger = readJSON(root, SCHEMA_LEDGER_PATH);
  if (ledger?.kind !== "takoform.public-schema-identities@v1") {
    throw new Error(`${SCHEMA_LEDGER_PATH} kind changed`);
  }
  const identities = [];
  for (const [status, entries] of [
    ["active", ledger.identities],
    ["verify-only", ledger.retired],
  ]) {
    for (const entry of entries) {
      const path = servedPathForIdentity(entry);
      if (sha256(readBytes(root, entry.source)) !== entry.sha256) {
        throw new Error(`${entry.source} differs from its ledger digest`);
      }
      identities.push({
        id: entry.id,
        path,
        source: entry.source,
        sha256: entry.sha256,
        status,
      });
    }
  }
  identities.sort((left, right) => left.id.localeCompare(right.id));
  return {
    ledger: SCHEMA_LEDGER_PATH,
    identityOrigin: SCHEMA_IDENTITY_ORIGIN,
    activeCount: ledger.identities.length,
    verifyOnlyCount: ledger.retired.length,
    identities,
  };
}

// ---------------------------------------------------------------------------
// Mirrored specification prose
// ---------------------------------------------------------------------------

export function sitePathForSpecDocument(specPath) {
  const rest = specPath.slice("spec/".length);
  const name = rest.endsWith("README.md")
    ? `${rest.slice(0, -"README.md".length)}index.md`
    : rest;
  return `${SITE_ROOT}/spec/${name}`;
}

export function siteRouteForSpecDocument(specPath) {
  const rest = specPath.slice("spec/".length);
  if (rest.endsWith("README.md")) return `/spec/${rest.slice(0, -"README.md".length)}`;
  return `/spec/${rest.slice(0, -".md".length)}`;
}

export function distPagePathForSource(source, distRoot = SITE_DIST) {
  const relative = source.slice(`${SITE_ROOT}/`.length);
  if (relative === "index.md") return `${distRoot}/index.html`;
  if (relative.endsWith("/index.md")) {
    return `${distRoot}/${relative.slice(0, -"index.md".length)}index.html`;
  }
  return `${distRoot}/${relative.slice(0, -".md".length)}.html`;
}

function schemaIdentityBySource(identities) {
  return new Map(identities.map((identity) => [identity.source, identity.id]));
}

/**
 * Resolve one Markdown link target found in a mirrored specification document.
 *
 * A mirrored page keeps the prose byte-for-byte and moves only the addresses,
 * because a link that still points at a repository-relative path is a broken
 * link on the web, and a link silently dropped is a claim the source did not
 * make. Three destinations exist: another mirrored page, a published schema
 * $id, or the source tree.
 */
export function rewriteLinkTarget(specPath, rawTarget, context) {
  const target = rawTarget.trim();
  if (target === "" || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target) || target.startsWith("#")) {
    return target;
  }
  const hashIndex = target.indexOf("#");
  const fragment = hashIndex === -1 ? "" : target.slice(hashIndex);
  const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const resolved = posix.normalize(posix.join(posix.dirname(specPath), pathPart));
  if (resolved.startsWith("..")) {
    throw new Error(`${specPath}: link escapes the repository: ${rawTarget}`);
  }

  const schemaId = context.schemaIdentities.get(resolved.replace(/\/$/u, ""));
  if (schemaId !== undefined) return `${schemaId}${fragment}`;

  const mirroredDirect = context.mirrored.get(resolved);
  if (mirroredDirect !== undefined) return `${mirroredDirect}${fragment}`;

  const asDirectory = resolved.endsWith("/") ? `${resolved}README.md` : `${resolved}/README.md`;
  const mirroredDirectory = context.mirrored.get(posix.normalize(asDirectory));
  if (mirroredDirectory !== undefined) return `${mirroredDirectory}${fragment}`;

  const isDirectory = pathPart.endsWith("/") ||
    (existsSync(resolve(context.root, resolved)) &&
      statSync(resolve(context.root, resolved)).isDirectory());
  const base = isDirectory ? SOURCE_TREE : SOURCE_BROWSE;
  return `${base}/${resolved.replace(/\/$/u, "")}${fragment}`;
}

export function renderMirroredDocument(specPath, source, context) {
  // Code spans are masked before rewriting so an inline pattern such as
  // `[a-z](x)` is not mistaken for a link, then restored unchanged.
  const spans = [];
  const masked = source.replace(/(`+)([\s\S]*?)\1/gu, (span) => {
    spans.push(span);
    // A private-use sentinel is the one thing a Markdown source never
    // carries, so the placeholder cannot collide with prose. A digit-only
    // sentinel does: an earlier revision restored a literal 31 out of a
    // table cell while putting a code span back.
    return `\uE000${spans.length - 1}\uE000`;
  });
  const rewritten = masked.replace(
    /(!?\[[^\]]*\]\()\s*(<[^>\n]+>|[^)\s]+)((?:\s+[^)]*)?\))/gu,
    (whole, open, rawTarget, close) => {
      const bracketed = rawTarget.startsWith("<") && rawTarget.endsWith(">");
      const inner = bracketed ? rawTarget.slice(1, -1) : rawTarget;
      const moved = rewriteLinkTarget(specPath, inner, context);
      return `${open}${bracketed ? `<${moved}>` : moved}${close}`;
    },
  );
  const body = rewritten.replace(/\uE000(\d+)\uE000/gu, (_, index) => spans[Number(index)]);
  return [
    "---",
    `# Generated from ${specPath} by scripts/site.mjs. Edit the specification, not this page.`,
    `normative: ${FROZEN_HOST_API_SPEC_DOCUMENTS.includes(specPath)}`,
    `canonicalSource: ${specPath}`,
    `canonicalUrl: ${SOURCE_BROWSE}/${specPath}`,
    "---",
    "",
    body,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Generated index pages
// ---------------------------------------------------------------------------

function schemaIndexPage(schemas) {
  const rows = (entries) =>
    entries.map((entry) =>
      `| [\`${entry.path}\`](${entry.path}) | \`${entry.id}\` | \`${entry.sha256}\` | [\`${entry.source}\`](${SOURCE_BROWSE}/${entry.source}) |`
    ).join("\n");
  const active = schemas.identities.filter((entry) => entry.status === "active");
  const verifyOnly = schemas.identities.filter((entry) => entry.status === "verify-only");
  return `---
# Generated by scripts/site.mjs from release/public-schema-identities.json.
title: 公開 schema
---

# 公開 schema

This non-normative index is derived from the append-only identity ledger. It
can track future identities without adding them to the frozen Host API v1
closure or redefining their contracts.

The non-retired/active identities below are a mixed inventory of
current-authoring and retained-readable profiles. Non-retired status only says
that the identity has not been retired; it does not say that a profile is valid
or preferred for new authoring. Read the owning source contract and its
current-authoring guidance before selecting an identity.

Takoform の normative schema は、\`$id\` が名指す path でそのまま配信されます。
配信される bytes は [\`spec/schemas/\`](${SOURCE_TREE}/spec/schemas) の source と
byte 単位で同一で、digest は append-only ledger
[\`release/public-schema-identities.json\`](${SOURCE_BROWSE}/release/public-schema-identities.json)
が固定します。

\`$id\` は仕様上の論理 identity です。どの hostname を実際にこの site へ向けるかは
公開を行う operator の判断であり、この repository は決めません。

schema は structural minimum です。schema を通っただけの document が
contract を満たすとは限りません。意味規則は
[conformance](/spec/conformance) と各 contract document が持ちます。

## Active identity（${active.length}）

The active section is the non-retired half of that mixed inventory. Its entries
may be current-authoring or retained-readable; the source contract decides
which role applies.

For the exact role assigned to each identity, use the [schema role table](/spec/schemas/)
before selecting an entry for authoring or retained-readable verification.

| 配信 path | \`$id\` | digest | source |
| --- | --- | --- | --- |
${rows(active)}

## Verify-only identity（${verifyOnly.length}）

occupied なまま retire された identity です。既存 document を読むためだけに
残り、新しい document の発行には使えません。bytes は発行時のまま変わりません。

| 配信 path | \`$id\` | digest | source |
| --- | --- | --- | --- |
${rows(verifyOnly)}
`;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function buildSiteFiles(root) {
  const schemas = deriveSchemas(root);
  const files = new Map();

  for (const identity of schemas.identities) {
    files.set(`${SITE_PUBLIC_ROOT}${identity.path}`, readBytes(root, identity.source));
  }

  const context = {
    root,
    schemaIdentities: schemaIdentityBySource(schemas.identities),
    mirrored: new Map(
      MIRRORED_SPEC_DOCUMENTS.map((specPath) => [specPath, siteRouteForSpecDocument(specPath)]),
    ),
  };
  for (const specPath of MIRRORED_SPEC_DOCUMENTS) {
    files.set(
      sitePathForSpecDocument(specPath),
      Buffer.from(renderMirroredDocument(specPath, readText(root, specPath), context), "utf8"),
    );
  }

  files.set(`${SITE_ROOT}/schemas/index.md`, Buffer.from(schemaIndexPage(schemas), "utf8"));
  return files;
}

function generatedTreeContents(root) {
  const found = new Set();
  for (const tree of GENERATED_TREES) for (const path of walk(root, tree)) found.add(path);
  return found;
}

export function siteRouteForPageSource(source) {
  const relative = source.slice(`${SITE_ROOT}/`.length);
  if (relative === "index.md") return "/";
  if (relative.endsWith("/index.md")) {
    return `/${relative.slice(0, -"index.md".length)}`;
  }
  return `/${relative.slice(0, -".md".length)}`;
}

export function inspectSite(root) {
  const problems = [...inspectSiteAssets(root), ...inspectDesignRecords(root)];
  let files;
  try {
    files = buildSiteFiles(root);
  } catch (error) {
    return [error.message];
  }
  for (const [path, expected] of files) {
    let actual;
    try {
      actual = readBytes(root, path);
    } catch {
      problems.push(`${path} is missing; run bun scripts/site.mjs --write`);
      continue;
    }
    if (!actual.equals(expected)) {
      problems.push(`${path} differs from its derivation; run bun scripts/site.mjs --write`);
    }
  }
  for (const path of generatedTreeContents(root)) {
    if (!files.has(path)) {
      problems.push(`${path} is served but no derivation produces it; run bun scripts/site.mjs --write`);
    }
  }
  for (const path of GENERATED_INDEX_PAGES) {
    if (!files.has(path)) problems.push(`generated index page ${path} was not derived`);
  }
  for (const path of REQUIRED_HAND_AUTHORED_PAGE_SOURCES) {
    if (!existsSync(resolve(root, path))) problems.push(`allowed page source ${path} is missing`);
  }
  const publicDocuments = new Map();
  for (const path of [...MIRRORED_SPEC_DOCUMENTS, ...HAND_AUTHORED_PAGE_SOURCES]) {
    if (existsSync(resolve(root, path))) publicDocuments.set(path, readText(root, path));
  }
  for (const path of GENERATED_INDEX_PAGES) {
    const bytes = files.get(path);
    if (bytes !== undefined) publicDocuments.set(path, bytes.toString("utf8"));
  }
  problems.push(
    ...inspectPublicDocumentAuthority(
      publicDocuments,
      new Set(FROZEN_HOST_API_SPEC_DOCUMENTS),
      {
        classificationRequiredPaths: new Set([
          ...MIRRORED_SPEC_DOCUMENTS,
          ...GENERATED_INDEX_PAGES,
        ]),
      },
    ),
  );
  problems.push(
    ...inspectPublishedSourceAllowlist(walk(root, SITE_ROOT), new Set(files.keys())),
  );
  return problems;
}

export function writeSite(root) {
  const files = buildSiteFiles(root);
  for (const path of generatedTreeContents(root)) {
    if (!files.has(path)) rmSync(resolve(root, path));
  }
  for (const [path, bytes] of files) {
    const target = resolve(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return files.size;
}

// ---------------------------------------------------------------------------
// Built output
// ---------------------------------------------------------------------------

function canonicalPageRoute(pathname) {
  if (pathname === "/" || pathname === "/index.html") return "/";
  return pathname
    .replace(/\/index\.html$/u, "")
    .replace(/\.html$/u, "")
    .replace(/\/$/u, "");
}

function attribute(openingTag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return openingTag.match(new RegExp(`\\s${escaped}="([^"]*)"`, "u"))?.[1];
}

function readableText(markup) {
  return markup
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(?:[a-z]+|#\d+|#x[\da-f]+);/giu, "x")
    .replace(/\s+/gu, " ")
    .trim();
}

function decodedFragment(hash) {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

/**
 * Inspect the semantic HTML readers and assistive technology actually receive.
 * This stays browser-free so it remains part of the portable build gate; pixel
 * geometry is checked separately in the explicit browser lane.
 */
export function inspectRenderedSitePages(pages, servedPaths = new Set()) {
  const problems = [];
  const byRoute = new Map(
    pages.map((page) => [canonicalPageRoute(page.route), page]),
  );
  const linksByRoute = new Map();

  for (const page of pages) {
    const route = canonicalPageRoute(page.route);
    const links = new Set();
    linksByRoute.set(route, links);
    const titles = [...page.html.matchAll(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/gu)];
    if (titles.length !== 1 || readableText(titles[0]?.[1] ?? "") === "") {
      problems.push(`${page.path} must render exactly one non-empty title`);
    }
    const head = page.html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/u)?.[1] ?? "";
    const metadata = [...head.matchAll(/<meta\b[^>]*>/gu)].map((match) => match[0]);
    for (const [key, expected] of [
      ["og:title", titles[0]?.[1]],
      ["og:url", new URL(page.route, "https://takoform.com").href],
      ["twitter:title", titles[0]?.[1]],
      ["og:description", undefined],
      ["twitter:description", undefined],
    ]) {
      const values = metadata.filter((tag) =>
        attribute(tag, "property") === key || attribute(tag, "name") === key,
      ).map((tag) => attribute(tag, "content"));
      if (values.length !== 1 || !values[0]?.trim() ||
          (expected !== undefined && values[0] !== expected)) {
        problems.push(`${page.path} must render matching non-empty ${key}`);
      }
    }

    const htmlTag = page.html.match(/<html\b[^>]*>/u)?.[0];
    if (htmlTag === undefined) {
      problems.push(`${page.path} does not render an html element`);
    } else {
      if (attribute(htmlTag, "lang") !== page.lang) {
        problems.push(`${page.path} must render lang=${page.lang}`);
      }
      if (attribute(htmlTag, "data-document-authority") !== page.authority) {
        problems.push(`${page.path} must render authority=${page.authority}`);
      }
    }

    const ids = [...page.html.matchAll(/\sid="([^"]+)"/gu)].map((match) => match[1]);
    const idSet = new Set(ids);
    for (const id of idSet) {
      if (ids.filter((candidate) => candidate === id).length > 1) {
        problems.push(`${page.path} renders duplicate id=${id}`);
      }
    }
    for (const match of page.html.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/gu)) {
      for (const id of match[1].split(/\s+/u).filter(Boolean)) {
        if (!idSet.has(id)) problems.push(`${page.path} references missing aria target #${id}`);
      }
    }

    if (page.mirror === true) {
      const notice = page.html.match(/<aside\b[^>]*class="[^"]*\bmirror-notice\b[^"]*"[^>]*>/u)?.[0];
      if (notice === undefined) {
        problems.push(`${page.path} does not render its source authority notice`);
      } else if (attribute(notice, "data-document-authority") !== page.authority) {
        problems.push(`${page.path} source notice disagrees with ${page.authority}`);
      }
    }

    for (const match of page.html.matchAll(/<a\b([^>]*)\bhref="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/gu)) {
      const opening = `<a${match[1]}href="${match[2]}"${match[3]}>`;
      if (readableText(match[4]) === "" && (attribute(opening, "aria-label") ?? "").trim() === "") {
        problems.push(`${page.path} renders a link without an accessible name`);
      }

      let target;
      try {
        target = new URL(match[2], `https://takoform.com${page.route}`);
      } catch {
        problems.push(`${page.path} renders invalid link ${match[2]}`);
        continue;
      }
      if (target.origin !== "https://takoform.com") continue;
      const targetRoute = canonicalPageRoute(target.pathname);
      const targetPage = byRoute.get(targetRoute);
      if (targetPage === undefined) {
        if (!servedPaths.has(target.pathname)) {
          problems.push(`${page.path} links to missing internal route ${target.pathname}`);
        }
        continue;
      }
      links.add(targetRoute);
      if (target.hash !== "") {
        const targetIds = new Set(
          [...targetPage.html.matchAll(/\sid="([^"]+)"/gu)].map((id) => id[1]),
        );
        const fragment = decodedFragment(target.hash);
        if (!targetIds.has(fragment)) {
          problems.push(`${page.path} links to missing fragment ${target.pathname}#${fragment}`);
        }
      }
    }
  }

  const reachable = new Set();
  const pending = byRoute.has("/") ? ["/"] : [];
  while (pending.length > 0) {
    const route = pending.pop();
    if (reachable.has(route)) continue;
    reachable.add(route);
    pending.push(...(linksByRoute.get(route) ?? []));
  }
  for (const route of byRoute.keys()) {
    if (route !== "/404" && !reachable.has(route)) problems.push(`${route} is not reachable from the home page`);
  }

  const home = byRoute.get("/");
  if (home !== undefined) {
    if ([...home.html.matchAll(/<main\b/gu)].length !== 1) {
      problems.push(`${home.path} must render exactly one main`);
    }
    if ([...home.html.matchAll(/<h1\b/gu)].length !== 1) {
      problems.push(`${home.path} must render exactly one h1`);
    }
  }
  return problems;
}

/**
 * Prove the built tree serves exactly the public surfaces this repository is
 * the authority for. The build is a bundler: it is trusted to render pages and
 * not trusted to carry the bytes an external consumer resolves by $id.
 */
export function inspectDist(root, distRoot = SITE_DIST) {
  const problems = inspectSiteAssets(root, distRoot);
  if (!existsSync(resolve(root, distRoot))) {
    return [`${distRoot} does not exist; run bun scripts/site.mjs --build`];
  }
  let schemas;
  try {
    schemas = deriveSchemas(root);
  } catch (error) {
    return [error.message];
  }

  const servedSchemas = new Set(walk(root, `${distRoot}/schemas`));
  for (const identity of schemas.identities) {
    const path = `${distRoot}${identity.path}`;
    servedSchemas.delete(path);
    let bytes;
    try {
      bytes = readBytes(root, path);
    } catch {
      problems.push(`${identity.id} is not served at ${identity.path}`);
      continue;
    }
    if (sha256(bytes) !== identity.sha256) {
      problems.push(`${identity.path} does not serve the ledger digest for ${identity.id}`);
    }
    if (!bytes.equals(readBytes(root, identity.source))) {
      problems.push(`${identity.path} drifted from ${identity.source}`);
    }
  }
  // The human index of the identities renders into the same directory the
  // identities are served from. It is the one page allowed there; anything
  // else under /schemas/ would be a URL an external reader could mistake for
  // a schema this repository publishes.
  servedSchemas.delete(`${distRoot}/schemas/index.html`);
  for (const extra of servedSchemas) {
    problems.push(`${extra} is served under /schemas/ but names no ledger identity`);
  }

  const expectedPageMetadata = new Map([
    [`${distRoot}/404.html`, {
      route: "/404",
      lang: "ja-JP",
      authority: "non-normative",
      mirror: false,
    }],
    [`${distRoot}/schemas/index.html`, {
      route: "/schemas/",
      lang: "ja-JP",
      authority: "non-normative",
      mirror: false,
    }],
  ]);
  for (const source of HAND_AUTHORED_PAGE_SOURCES) {
    expectedPageMetadata.set(distPagePathForSource(source, distRoot), {
      route: siteRouteForPageSource(source),
      lang: "ja-JP",
      authority: "non-normative",
      mirror: false,
    });
  }
  for (const specPath of MIRRORED_SPEC_DOCUMENTS) {
    const route = siteRouteForSpecDocument(specPath);
    const page = route.endsWith("/") ? `${route}index.html` : `${route}.html`;
    expectedPageMetadata.set(`${distRoot}${page}`, {
      route,
      lang: "en",
      authority: FROZEN_HOST_API_SPEC_DOCUMENTS.includes(specPath)
        ? "normative"
        : "non-normative",
      mirror: true,
    });
  }
  const actualPages = new Set(walk(root, distRoot).filter((path) => path.endsWith(".html")));
  for (const page of expectedPageMetadata.keys()) {
    if (!actualPages.delete(page)) problems.push(`${page} is missing`);
  }
  for (const page of actualPages) {
    problems.push(`${page} is built outside the API/common-model route allowlist`);
  }
  const renderedPages = [];
  for (const [path, metadata] of expectedPageMetadata) {
    if (!existsSync(resolve(root, path))) continue;
    renderedPages.push({
      path,
      html: readText(root, path),
      ...metadata,
    });
  }
  const servedPaths = new Set(
    walk(root, distRoot).map((path) => `/${path.slice(`${distRoot}/`.length)}`),
  );
  problems.push(...inspectRenderedSitePages(renderedPages, servedPaths));
  return problems;
}

/** sha256 over the built tree: one digest for one publishable byte set. */
export function distDigest(root, distRoot = SITE_DIST) {
  const hash = createHash("sha256");
  for (const path of walk(root, distRoot)) {
    hash.update(path.slice(distRoot.length));
    hash.update("\0");
    hash.update(readBytes(root, path));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export function buildSite(root, { run = spawnSync } = {}) {
  const vitepress = resolve(root, "node_modules/vitepress/bin/vitepress.js");
  if (!existsSync(vitepress)) {
    throw new Error("vitepress is not installed; run bun install");
  }
  const result = run(process.execPath, [vitepress, "build", SITE_ROOT], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`vitepress build failed with status ${result.status}`);
}

/**
 * Build twice and require one byte-identical publishable tree.
 *
 * The deploy verifier compares live bytes with a fresh build. A site build
 * that changes without a source change therefore cannot be published or
 * repaired safely: the next verification would prove a different artifact.
 */
export function buildSiteReproducibly(
  root,
  { build = buildSite, digest = distDigest } = {},
) {
  build(root);
  const first = digest(root);
  build(root);
  const second = digest(root);
  if (first !== second) {
    throw new Error(
      `site build is not reproducible: consecutive publishable trees differ (${first} != ${second})`,
    );
  }
  return second;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: bun scripts/site.mjs [--check|--write|--build|--dist-digest]\n";

export async function main(argv = process.argv.slice(2)) {
  const mode = argv[0] ?? "--check";
  if (argv.length !== 1) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  if (mode === "--write") {
    const count = writeSite(ROOT);
    process.stdout.write(`site: wrote ${count} derived files\n`);
    return;
  }
  if (mode === "--check") {
    const problems = inspectSite(ROOT);
    if (problems.length !== 0) {
      for (const problem of problems) process.stderr.write(`site: ${problem}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("site: every generated page and served schema equals its derivation\n");
    return;
  }
  if (mode === "--build") {
    const digest = buildSiteReproducibly(ROOT);
    const problems = inspectDist(ROOT);
    if (problems.length !== 0) {
      for (const problem of problems) process.stderr.write(`site: ${problem}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `site: built ${SITE_DIST} serving ${deriveSchemas(ROOT).identities.length} schema identities (${digest})\n`,
    );
    return;
  }
  if (mode === "--dist-digest") {
    process.stdout.write(`${distDigest(ROOT)}\n`);
    return;
  }
  process.stderr.write(USAGE);
  process.exitCode = 1;
}

if (import.meta.main) await main();
