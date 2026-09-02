#!/usr/bin/env bun

// The machine-readable status document served at /.well-known/takoform-site.json
// by the API and common-model-only takoform.com site this repository owns.
//
// Every field is derived from this repository's own committed records. Nothing
// here reads a sibling checkout, a client adapter's release ledger, a package
// publisher's catalog, or a network service, because this document must stay
// true when read from a clone that contains only these bytes. A status field
// that needs another repository's state is that repository's status field.
//
// The document deliberately answers only what this repository can prove:
// the Host API v1 lane and its byte-pinned machine sources, the Core software
// artifact release line, the immutable Specification receipt, and the exact
// public schema identities. It states no adapter availability, no Form
// catalog, no publisher roster, and no Host support claim.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_RELEASE } from "./core-release.mjs";

export const SITE_STATUS_FORMAT = "takoform.spec-site-status@v1";
export const SITE_STATUS_ROUTE = "/.well-known/takoform-site.json";
export const SITE_STATUS_SOURCE_PATH =
  "website/public/.well-known/takoform-site.json";

// The served origin of every schema $id. The ledger owns the identities; this
// constant only names the host they are addressed under so the derivation can
// prove each entry agrees with it. Which hostnames actually resolve, and to
// what, is the publishing operator's authority and not recorded here.
export const SCHEMA_IDENTITY_ORIGIN = "https://forms.takoform.com";

export const SITE_STATUS_PATHS = Object.freeze({
  goMod: "go.mod",
  coreReleasePolicy: "release/core-release-policy.md",
  hostApiContract: "spec/host-api/v1.md",
  hostApiOperations: "spec/host-api/operations-v1.json",
  specificationCompatibility:
    "docs/extraction/history/specification-compatibility.json",
  specificationReleases: "release/specification-releases.json",
  schemaLedger: "release/public-schema-identities.json",
  recordHead: "release/record-head.json",
  recordHeadSignature: "release/record-head.sig.json",
});

// Key order is part of the format. A reader that diffs two published documents
// must see a field move only when the fact moved, so the writer emits this
// list and the gate compares the served key order against it exactly.
export const SITE_STATUS_FIELDS = Object.freeze([
  "format",
  "site",
  "scope",
  "sourceRepository",
  "notPublishedHere",
  "hostApi",
  "core",
  "specification",
  "schemas",
  "records",
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail(message) {
  throw new Error(`site-status: ${message}`);
}

function readBytes(root, relativePath) {
  try {
    return readFileSync(resolve(root, relativePath));
  } catch (error) {
    fail(`cannot read ${relativePath} (${error.message})`);
    return null;
  }
}

function readText(root, relativePath) {
  return readBytes(root, relativePath).toString("utf8");
}

function readJSON(root, relativePath) {
  const raw = readText(root, relativePath);
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`${relativePath} is not JSON (${error.message})`);
    return null;
  }
}

// Markdown prose wraps. Every fact matched below is a single sentence in the
// source record, so the matcher works on a whitespace-collapsed copy rather
// than depending on where a line happens to break.
function flatten(text) {
  return text.replace(/\s+/gu, " ");
}

function matchOnce(text, pattern, what, where) {
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`${where} must state ${what} exactly once, found ${matches.length}`);
  }
  return matches[0];
}

export function deriveGoModule(root) {
  const lines = readText(root, SITE_STATUS_PATHS.goMod)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("module "));
  if (lines.length !== 1) fail("go.mod must declare exactly one module path");
  return lines[0].slice("module ".length).trim();
}

export function deriveHostApi(root) {
  const contract = flatten(readText(root, SITE_STATUS_PATHS.hostApiContract));
  const operations = readJSON(root, SITE_STATUS_PATHS.hostApiOperations);
  const compatibility = readJSON(
    root,
    SITE_STATUS_PATHS.specificationCompatibility,
  );

  const discovery = matchOnce(
    contract,
    /`GET (\/\.well-known\/takoform\/v1)` returns exactly one advertised API lane, `(forms\.takoform\.com\/v1)`, with API root `(\/apis\/forms\.takoform\.com\/v1)`/gu,
    "the discovery path, advertised lane, and API root",
    SITE_STATUS_PATHS.hostApiContract,
  );
  const [, discoveryPath, lane, apiRoot] = discovery;

  if (operations?.format !== "takoform.host-api@v1") {
    fail(`${SITE_STATUS_PATHS.hostApiOperations} is not the v1 operation table`);
  }
  if (operations.apiGroup !== lane || operations.discoveryPath !== discoveryPath) {
    fail("the operation table and the wire contract disagree about the v1 lane");
  }

  const pin = compatibility?.hostApiV1Pin;
  if (pin?.lane !== lane || !Array.isArray(pin?.sources)) {
    fail("the byte pin does not cover the advertised Host API v1 lane");
  }
  // Only the machine documents are frozen bytes. The v1 prose stays outside
  // the pin on purpose so a non-behavioral editorial correction does not have
  // to look like a protocol change; the same split is what records.mjs
  // enforces, and publishing the prose digest here would quietly re-freeze it.
  const machineSources = pin.sources.filter((entry) => !entry.path.endsWith(".md"));
  if (machineSources.length === 0 || machineSources.length === pin.sources.length) {
    fail("the Host API v1 pin no longer separates machine bytes from prose");
  }
  for (const entry of machineSources) {
    const actual = sha256(readBytes(root, entry.path));
    if (actual !== entry.sha256) {
      fail(`${entry.path} differs from the Host API v1 byte pin`);
    }
  }

  return {
    lane,
    discoveryPath,
    apiRoot,
    requiredFeatures: [...operations.requiredFeatures].sort(),
    errorCodes: [...operations.errorEnvelope.codes].sort(),
    machineSources: machineSources.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
    })),
  };
}

export function deriveCore(root) {
  const module = deriveGoModule(root);
  const policy = flatten(readText(root, SITE_STATUS_PATHS.coreReleasePolicy));

  const current = matchOnce(
    policy,
    /Core \*\*(v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\*\* is a software\/module artifact release/gu,
    "the current Core artifact version",
    SITE_STATUS_PATHS.coreReleasePolicy,
  );
  const version = current[1];

  const title = matchOnce(
    policy,
    /GitHub Release titled exactly `([^`]+)` name that one published artifact/gu,
    "the current Core Release title",
    SITE_STATUS_PATHS.coreReleasePolicy,
  );
  const releaseTitle = title[1];

  if (!policy.includes(`\`${module}@${version}\``)) {
    fail(
      `${SITE_STATUS_PATHS.coreReleasePolicy} does not name the module artifact ${module}@${version}`,
    );
  }
  if (!releaseTitle.endsWith(version)) {
    fail(`the Core Release title ${releaseTitle} does not name ${version}`);
  }

  const occupied = [
    ...policy.matchAll(
      /(v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)) requires `([^`]+)`/gu,
    ),
  ].map((match) => ({ version: match[1], releaseTitle: match[2] }));
  if (occupied.length === 0) {
    fail(
      `${SITE_STATUS_PATHS.coreReleasePolicy} records no occupied historical Release titles`,
    );
  }

  const releases = [...occupied, { version, releaseTitle }].sort((left, right) =>
    compareSemver(left.version, right.version)
  );
  const seen = new Set();
  for (const release of releases) {
    if (seen.has(release.version)) {
      fail(`Core release history repeats ${release.version}`);
    }
    seen.add(release.version);
  }

  return {
    module,
    artifactVersion: version,
    releaseTitle,
    // Stated, not implied. Three separate readers have previously read a Core
    // SemVer bump as a protocol revision.
    hostApiEffect: "none",
    formPublicationEffect: "none",
    releases,
  };
}

function compareSemver(left, right) {
  const parse = (value) => value.slice(1).split(".").map(Number);
  const [lMajor, lMinor, lPatch] = parse(left);
  const [rMajor, rMinor, rPatch] = parse(right);
  return lMajor - rMajor || lMinor - rMinor || lPatch - rPatch;
}

export function deriveSpecification(root) {
  const ledger = readJSON(root, SITE_STATUS_PATHS.specificationReleases);
  if (ledger?.kind !== "takoform.specification-releases@v1") {
    fail(`${SITE_STATUS_PATHS.specificationReleases} kind changed`);
  }
  if (!Array.isArray(ledger.releases) || ledger.releases.length === 0) {
    fail("the Specification ledger records no release receipt");
  }
  return {
    ledger: SITE_STATUS_PATHS.specificationReleases,
    // The receipt names one exact committed source snapshot. It is not a
    // release train: the site publishes it so a reader can resolve the
    // identity, not so a reader can expect a successor.
    releases: ledger.releases.map((release) => ({
      version: release.version,
      title: release.title,
      tag: release.tag,
      tagObject: release.tagObject,
      sourceCommit: release.sourceCommit,
      releaseCommit: release.releaseCommit,
      sourceSnapshotSha256: release.sourceSnapshotSha256,
      immutable: release.release?.immutable === true,
      hostApiEffect: release.hostApiEffect,
      formPublicationEffect: release.formPublicationEffect,
    })),
    withdrawn: (ledger.reserved ?? []).map((entry) => ({
      version: entry.version,
      status: entry.status,
      noReuse: entry.noReuse === true,
    })),
  };
}

// The ledger's `public` field is a repository path under the site's static
// directory. The served URL is the $id path, and the two must agree exactly:
// a schema served anywhere else is a second identity for the same bytes.
export function servedPathForIdentity(identity) {
  let url;
  try {
    url = new URL(identity.id);
  } catch {
    fail(`schema identity is not a URL: ${identity.id}`);
    return null;
  }
  if (`${url.origin}` !== SCHEMA_IDENTITY_ORIGIN) {
    fail(`schema identity is not served from the identity origin: ${identity.id}`);
  }
  if (url.search !== "" || url.hash !== "") {
    fail(`schema identity carries a query or fragment: ${identity.id}`);
  }
  if (!url.pathname.startsWith("/schemas/") || !url.pathname.endsWith(".json")) {
    fail(`schema identity is outside the served schema tree: ${identity.id}`);
  }
  const expected = `website/public${url.pathname}`;
  if (identity.public !== expected) {
    fail(
      `schema identity ${identity.id} declares public path ${identity.public}, not ${expected}`,
    );
  }
  return url.pathname;
}

export function deriveSchemas(root) {
  const ledger = readJSON(root, SITE_STATUS_PATHS.schemaLedger);
  if (ledger?.kind !== "takoform.public-schema-identities@v1") {
    fail(`${SITE_STATUS_PATHS.schemaLedger} kind changed`);
  }
  const identities = [];
  for (const [status, entries] of [
    ["active", ledger.identities],
    ["verify-only", ledger.retired],
  ]) {
    for (const entry of entries) {
      const path = servedPathForIdentity(entry);
      const actual = sha256(readBytes(root, entry.source));
      if (actual !== entry.sha256) {
        fail(`${entry.source} differs from its ledger digest`);
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
  identities.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return {
    ledger: SITE_STATUS_PATHS.schemaLedger,
    identityOrigin: SCHEMA_IDENTITY_ORIGIN,
    servedPathPrefix: "/schemas/",
    activeCount: ledger.identities.length,
    verifyOnlyCount: ledger.retired.length,
    // A verify-only identity keeps serving the exact bytes it was published
    // with. It is dead for authoring, not withdrawn from the web.
    identities,
  };
}

export function deriveRecords(root) {
  const headBytes = readBytes(root, SITE_STATUS_PATHS.recordHead);
  const head = JSON.parse(headBytes.toString("utf8"));
  const signature = readJSON(root, SITE_STATUS_PATHS.recordHeadSignature);
  const digest = sha256(headBytes);
  if (signature?.subject !== SITE_STATUS_PATHS.recordHead) {
    fail("the record head signature does not name the record head");
  }
  if (signature.subjectSha256 !== digest) {
    fail("the record head signature does not cover the current record head bytes");
  }
  return {
    head: SITE_STATUS_PATHS.recordHead,
    kind: head.kind,
    generation: head.generation,
    sha256: digest,
    signatureAlgorithm: signature.algorithm,
    specificationReleasesEntrySha256: head.specificationReleases?.entrySha256,
    publicSchemaIdentitiesEntrySha256: head.publicSchemaIdentities?.entrySha256,
  };
}

export function deriveSiteStatus(root) {
  const document = {
    format: SITE_STATUS_FORMAT,
    site: "takoform.com",
    scope: "host-api-v1-and-publisher-neutral-common-model",
    sourceRepository: `github.com/${CORE_RELEASE.githubRepository}`,
    // Naming the absences is the point of the document. Every one of these
    // was, at some time, read off this site by someone who then treated it as
    // an availability, roster, or support claim it never made.
    notPublishedHere: [
      "form-definitions-and-per-form-examples",
      "publisher-form-catalogs-and-rosters",
      "form-specific-conformance-reports",
      "client-adapter-resource-pages",
      "client-adapter-availability-or-status",
      "host-support-activation-or-service-offering",
      "realized-dns-cdn-account-or-credential-state",
    ],
    hostApi: deriveHostApi(root),
    core: deriveCore(root),
    specification: deriveSpecification(root),
    schemas: deriveSchemas(root),
    records: deriveRecords(root),
  };
  const keys = Object.keys(document);
  if (JSON.stringify(keys) !== JSON.stringify([...SITE_STATUS_FIELDS])) {
    fail(`derived field order drifted: ${keys.join(", ")}`);
  }
  return document;
}

export function renderSiteStatus(root) {
  return `${JSON.stringify(deriveSiteStatus(root), null, 2)}\n`;
}

export function verifySiteStatus(root) {
  const problems = [];
  let expected;
  try {
    expected = renderSiteStatus(root);
  } catch (error) {
    return [error.message];
  }
  let served;
  try {
    served = readFileSync(resolve(root, SITE_STATUS_SOURCE_PATH), "utf8");
  } catch (error) {
    return [
      `${SITE_STATUS_SOURCE_PATH} is not served (${error.message}); run bun scripts/site-status.mjs --write`,
    ];
  }
  if (served !== expected) {
    problems.push(
      `${SITE_STATUS_SOURCE_PATH} differs from the derivation; run bun scripts/site-status.mjs --write`,
    );
    let servedKeys;
    try {
      servedKeys = Object.keys(JSON.parse(served));
    } catch {
      servedKeys = null;
    }
    if (servedKeys && JSON.stringify(servedKeys) !== JSON.stringify([...SITE_STATUS_FIELDS])) {
      problems.push(
        `served field order is ${servedKeys.join(", ")}, expected ${SITE_STATUS_FIELDS.join(", ")}`,
      );
    }
  }
  return problems;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function main(argv = process.argv.slice(2)) {
  const mode = argv[0] ?? "--check";
  if (argv.length !== 1 || !["--check", "--write", "--print"].includes(mode)) {
    process.stderr.write(
      "usage: bun scripts/site-status.mjs [--check|--write|--print]\n",
    );
    process.exitCode = 1;
    return;
  }
  if (mode === "--print") {
    process.stdout.write(renderSiteStatus(ROOT));
    return;
  }
  if (mode === "--write") {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const target = resolve(ROOT, SITE_STATUS_SOURCE_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderSiteStatus(ROOT));
    process.stdout.write(`site-status: wrote ${SITE_STATUS_SOURCE_PATH}\n`);
    return;
  }
  const problems = verifySiteStatus(ROOT);
  if (problems.length !== 0) {
    for (const problem of problems) process.stderr.write(`site-status: ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `site-status: ${SITE_STATUS_ROUTE} equals the derivation from this repository's records\n`,
  );
}

if (import.meta.main) await main();
