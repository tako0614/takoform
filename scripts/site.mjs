#!/usr/bin/env bun

// Generator and gate for the API and common-model-only takoform.com site.
//
// The site publishes exactly two things this repository is the authority for:
// the normative Host API v1 and common-model prose, and the exact public
// schema bytes at the paths their $id values name. Everything else on the site
// is an index into those two, or a statement about what the site does not
// publish.
//
// Two rules keep it honest and are enforced below rather than reviewed:
//
//   1. Every generated page and every served schema byte is derived. A page
//      that a human edited in place is a second copy of a normative document,
//      and a second copy drifts. `--check` re-derives and compares.
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
import {
  SITE_STATUS_ROUTE,
  SITE_STATUS_SOURCE_PATH,
  deriveSiteStatus,
  renderSiteStatus,
} from "./site-status.mjs";

export const SITE_ROOT = "website";
export const SITE_PUBLIC_ROOT = `${SITE_ROOT}/public`;
export const SITE_DIST = `${SITE_ROOT}/.vitepress/dist`;

const SOURCE_BROWSE = `https://github.com/${CORE_RELEASE.githubRepository}/blob/main`;
const SOURCE_TREE = `https://github.com/${CORE_RELEASE.githubRepository}/tree/main`;

// The normative prose this site republishes. Retired Host API lanes and the
// decision bodies are deliberately absent: a retired lane read as a current
// page is the exact confusion the lane withdrawal was for, and the decisions
// are non-normative rationale that the index below points at in place.
export const MIRRORED_SPEC_DOCUMENTS = Object.freeze([
  "spec/README.md",
  "spec/conformance.md",
  "spec/versioning.md",
  "spec/form-families.md",
  "spec/portability-boundary.md",
  "spec/project-lifecycle.md",
  "spec/publication-freeze.md",
  "spec/core/README.md",
  "spec/form-definition/README.md",
  "spec/form-package/README.md",
  "spec/host-api/README.md",
  "spec/host-api/v1.md",
  "spec/interface-contract/README.md",
  "spec/binding-contract/README.md",
  "spec/artifact-transport/README.md",
  "spec/standard-services/README.md",
  "spec/schemas/README.md",
  "spec/trust/README.md",
]);

export const GENERATED_INDEX_PAGES = Object.freeze([
  `${SITE_ROOT}/schemas/index.md`,
  `${SITE_ROOT}/decisions/index.md`,
  `${SITE_ROOT}/releases/index.md`,
]);

// Everything a generated tree owns end to end. A file that lives under one of
// these and is not produced by a derivation is deleted by `--write` and
// reported by `--check`.
const GENERATED_TREES = Object.freeze([
  `${SITE_ROOT}/spec`,
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

// ---------------------------------------------------------------------------
// Mirrored normative prose
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

function schemaIndexPage(status) {
  const rows = (entries) =>
    entries.map((entry) =>
      `| [\`${entry.path}\`](${entry.path}) | \`${entry.id}\` | \`${entry.sha256}\` | [\`${entry.source}\`](${SOURCE_BROWSE}/${entry.source}) |`
    ).join("\n");
  const active = status.schemas.identities.filter((entry) => entry.status === "active");
  const verifyOnly = status.schemas.identities.filter((entry) => entry.status === "verify-only");
  return `---
# Generated by scripts/site.mjs from release/public-schema-identities.json.
title: 公開 schema
---

# 公開 schema

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

authoring と verification の双方に使える identity です。

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

function decisionIndexPage(root) {
  const source = readText(root, "spec/decisions/README.md");
  const entries = [
    ...source.matchAll(/^- \[([^\]]+)\]\(([^)\s]+\.md)\)\s*$/gmu),
  ].map((match) => ({ title: match[1], file: match[2] }));
  if (entries.length === 0) {
    throw new Error("spec/decisions/README.md lists no decisions");
  }
  const list = entries
    .map((entry) => `- [${entry.title}](${SOURCE_BROWSE}/spec/decisions/${entry.file})`)
    .join("\n");
  return `---
# Generated by scripts/site.mjs from spec/decisions/README.md.
title: Decision index
---

# Decision index

これらの記録は設計理由と履歴です。**非 normative** であり、現在の挙動と要件は
それを所有する specification document だけが定義します。決定の題名や結論が
すでに superseded な状態を述べていることがあり、現在の specification を
上書きしません。

本文は source repository に置き、この site は索引だけを配信します。

${list}
`;
}

function releasesIndexPage(status) {
  const core = status.core.releases
    .map((entry) => `| \`${entry.version}\` | \`${entry.releaseTitle}\` |`)
    .join("\n");
  const specification = status.specification.releases
    .map((entry) =>
      `| ${entry.version} | \`${entry.tag}\` | \`${entry.sourceCommit}\` | \`${entry.tagObject}\` | ${entry.immutable ? "immutable" : "mutable"} |`
    )
    .join("\n");
  const withdrawn = status.specification.withdrawn
    .map((entry) => `- ${entry.version} — ${entry.status}${entry.noReuse ? "（identity は再利用しない）" : ""}`)
    .join("\n");
  return `---
# Generated by scripts/site.mjs from this repository's release records.
title: Release
---

# Release

Takoform には ecosystem 全体の GA gate はありません。次の identity は
それぞれ独立に released または retained です。

## Core（Go software/module artifact）

現行 artifact は \`${status.core.module}@${status.core.artifactVersion}\` です。
Core SemVer は software artifact の identity であり、Host API の version では
ありません。Host wire identity は \`${status.hostApi.lane}\` のままで、
Host API v1.1 lane は存在しません。

| tag | GitHub Release title |
| --- | --- |
${core}

## Specification 受領書

数字付き Specification release は、normative source tree の exact な commit
snapshot を 1 つだけ記録した immutable な受領書です。release train ではなく、
Host API、Form、package、client のどれも発行しません。

| version | tag | source commit | tag object | 状態 |
| --- | --- | --- | --- | --- |
${specification}

撤回済み identity:

${withdrawn}

## この site の status

機械可読な status document は
[\`${SITE_STATUS_ROUTE}\`](${SITE_STATUS_ROUTE}) にあります。
この repository の記録だけから導出され、gate が配信中の copy と導出結果の
一致を検査します。
`;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

export function buildSiteFiles(root) {
  const status = deriveSiteStatus(root);
  const files = new Map();

  for (const identity of status.schemas.identities) {
    files.set(`${SITE_PUBLIC_ROOT}${identity.path}`, readBytes(root, identity.source));
  }
  files.set(SITE_STATUS_SOURCE_PATH, Buffer.from(renderSiteStatus(root), "utf8"));

  const context = {
    root,
    schemaIdentities: schemaIdentityBySource(status.schemas.identities),
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

  files.set(`${SITE_ROOT}/schemas/index.md`, Buffer.from(schemaIndexPage(status), "utf8"));
  files.set(`${SITE_ROOT}/decisions/index.md`, Buffer.from(decisionIndexPage(root), "utf8"));
  files.set(`${SITE_ROOT}/releases/index.md`, Buffer.from(releasesIndexPage(status), "utf8"));
  return files;
}

function generatedTreeContents(root) {
  const found = new Set();
  for (const tree of GENERATED_TREES) for (const path of walk(root, tree)) found.add(path);
  return found;
}

export function inspectSite(root) {
  const problems = [];
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

/**
 * Prove the built tree serves exactly the public surfaces this repository is
 * the authority for. The build is a bundler: it is trusted to render pages and
 * not trusted to carry the bytes an external consumer resolves by $id.
 */
export function inspectDist(root, distRoot = SITE_DIST) {
  const problems = [];
  if (!existsSync(resolve(root, distRoot))) {
    return [`${distRoot} does not exist; run bun scripts/site.mjs --build`];
  }
  let status;
  try {
    status = deriveSiteStatus(root);
  } catch (error) {
    return [error.message];
  }

  const servedSchemas = new Set(walk(root, `${distRoot}/schemas`));
  for (const identity of status.schemas.identities) {
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

  const statusPath = `${distRoot}${SITE_STATUS_ROUTE}`;
  try {
    if (readText(root, statusPath) !== renderSiteStatus(root)) {
      problems.push(`${statusPath} differs from the site-status derivation`);
    }
  } catch {
    problems.push(`${SITE_STATUS_ROUTE} is not served by the build`);
  }

  for (const page of ["index.html", "404.html"]) {
    if (!existsSync(resolve(root, `${distRoot}/${page}`))) {
      problems.push(`${distRoot}/${page} is missing`);
    }
  }
  for (const specPath of MIRRORED_SPEC_DOCUMENTS) {
    const route = siteRouteForSpecDocument(specPath);
    const page = route.endsWith("/") ? `${route}index.html` : `${route}.html`;
    if (!existsSync(resolve(root, `${distRoot}${page}`))) {
      problems.push(`${specPath} is mirrored but ${page} is not built`);
    }
  }
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
    buildSite(ROOT);
    const problems = inspectDist(ROOT);
    if (problems.length !== 0) {
      for (const problem of problems) process.stderr.write(`site: ${problem}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `site: built ${SITE_DIST} serving ${deriveSiteStatus(ROOT).schemas.identities.length} schema identities (${distDigest(ROOT)})\n`,
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
