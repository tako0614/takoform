#!/usr/bin/env node

// Read-only verifier: v1 remains at first-add bytes; v2 permits the one
// approved editorial commit while preserving its original public edition.
// Subsequent normative-source changes require a new API identity.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FREEZE_PATH = "spec/host-api/v1.freeze.json";
export const FREEZE_KIND = "takoform.host-api.freeze";
export const EXACT_HOST_API_LANE = "forms.takoform.com/v1";
export const V2_FREEZE_PATH = "spec/host-api/v2.freeze.json";
export const EXACT_V2_HOST_API_LANE = "forms.takoform.com/v2";
export const EXPECTED_V2_NORMATIVE_PROSE = Object.freeze([
  "spec/host-api/v2/README.md",
  "spec/host-api/v2/http.md",
  "spec/host-api/v2/forms.md",
]);
// The first public English edition remains an exact transition predecessor,
// not an open-ended alternative to the current fixed edition.
export const INITIAL_V2_NORMATIVE_SHA256 = Object.freeze({
  "spec/host-api/v2/README.md": "sha256:d93d3118bf231b00066e4cf1402f3a214f7e279aa93fde56e508e593bf6dc6b8",
  "spec/host-api/v2/http.md": "sha256:2d5d272430bfea0f4daa7955d6ecc4db1a9cf4f79048fcf6737e9691126d0a1a",
  "spec/host-api/v2/forms.md": "sha256:5754a1fcca22054a5fe849128acd18ead0bd90e9e6b973daa5ae1243f4de359d",
});
export const SCHEMA_LEDGER_PATH = "release/public-schema-identities.json";
export const EXPECTED_NORMATIVE_PROSE = Object.freeze([
  "spec/host-api/v1.md",
  "spec/conformance.md",
  "spec/versioning.md",
  "spec/form-families.md",
  "spec/portability-boundary.md",
  "spec/form-definition/README.md",
  "spec/form-package/README.md",
  "spec/core/README.md",
  "spec/interface-contract/README.md",
  "spec/binding-contract/README.md",
  "spec/artifact-transport/README.md",
  "spec/standard-services/README.md",
  "spec/trust/README.md",
]);
export const EXPECTED_MACHINE_ROOTS = Object.freeze([
  "spec/host-api/operations-v1.json",
  "conformance/takoform-v1/generic.json",
  "spec/trust/profile.json",
]);
export const EXPECTED_SCHEMA_ROOTS = Object.freeze([
  "https://forms.takoform.com/schemas/v1/host-discovery.schema.json",
  "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
  "https://forms.takoform.com/schemas/v1/form-definition.schema.json",
  "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json",
  "https://forms.takoform.com/schemas/operations/v1/operation.schema.json",
  "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-definition.schema.json",
  "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-definition.schema.json",
  "https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json",
  "https://forms.takoform.com/schemas/v1alpha5/package-index.schema.json",
  "https://forms.takoform.com/schemas/v1/form-package-revocation.schema.json",
  "https://forms.takoform.com/schemas/v1/form-package-revocation-checkpoint.schema.json",
]);
export const EXPECTED_SCHEMA_CLOSURE = Object.freeze([
  "https://forms.takoform.com/schemas/artifacts/v1alpha1/artifact-manifest.schema.json",
  "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-definition.schema.json",
  "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-ref.schema.json",
  "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-definition.schema.json",
  "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-ref.schema.json",
  "https://forms.takoform.com/schemas/operations/v1/operation.schema.json",
  "https://forms.takoform.com/schemas/standards/v1/standard-service-ref.schema.json",
  "https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json",
  "https://forms.takoform.com/schemas/v1/form-definition.schema.json",
  "https://forms.takoform.com/schemas/v1/form-package-revocation-checkpoint.schema.json",
  "https://forms.takoform.com/schemas/v1/form-package-revocation.schema.json",
  "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
  "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json",
  "https://forms.takoform.com/schemas/v1/host-discovery.schema.json",
  "https://forms.takoform.com/schemas/v1alpha5/package-index.schema.json",
  "https://forms.takoform.com/schemas/v1beta2/form-ref.schema.json",
]);

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const EXPECTED_MANIFEST_KEYS = ["kind", "lane", "machineRoots", "normativeProse", "schemas"];
const EXPECTED_SCHEMA_KEYS = ["closureIds", "ledger", "rootIds"];
const EXPECTED_DIGEST_ENTRY_KEYS = ["path", "sha256"];

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function sameKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    sameArray(Object.keys(value).sort(), expected);
}

function safeRepositoryPath(path) {
  return typeof path === "string" && path !== "" && !path.startsWith("/") &&
    !path.includes("\\") && posix.normalize(path) === path && path !== ".." &&
    !path.startsWith("../");
}

function parseJSON(bytes, label, problems) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    problems.push(`${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

function readRequired(accessor, path, problems) {
  try {
    return accessor.read(path);
  } catch {
    problems.push(`${path} is missing`);
    return null;
  }
}

function fileAccessor(root) {
  return {
    read(path) {
      if (!safeRepositoryPath(path)) throw new Error("unsafe repository path");
      return readFileSync(resolve(root, path));
    },
  };
}

function runGit(root, args, { bytes = false, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: bytes ? null : "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const stderr = bytes ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(stderr.trim() || `git ${args[0]} failed with status ${result.status}`);
  }
  return result;
}

function commitAccessor(root, commit) {
  return {
    read(path) {
      if (!safeRepositoryPath(path)) throw new Error("unsafe repository path");
      const result = runGit(root, ["show", `${commit}:${path}`], { bytes: true });
      return result.stdout;
    },
  };
}

function contentChangingCommits(root, commits, paths) {
  // --full-history also lists a merge that merely selected one parent's
  // already-reviewed bytes. That is not a third editorial edition.
  const bytesAt = (commit, path) => {
    try { return commitAccessor(root, commit).read(path); } catch { return null; }
  };
  return commits.filter((commit) => {
    const [, ...parents] = runGit(root, ["rev-list", "--parents", "-n", "1", commit]).stdout.trim().split(/\s+/u);
    if (parents.length < 2) return true;
    return !parents.some((parent) => paths.every((path) => {
      const current = bytesAt(commit, path);
      const before = bytesAt(parent, path);
      return current === null ? before === null : before !== null && current.equals(before);
    }));
  });
}

function validateDigestEntries(entries, expectedPaths, label, problems, lane = "v1") {
  if (!Array.isArray(entries) || entries.length !== expectedPaths.length) {
    problems.push(`${label} must name exactly ${expectedPaths.join(", ")}`);
    return [];
  }
  const paths = entries.map((entry) => entry?.path);
  if (!sameArray(paths, expectedPaths)) {
    problems.push(`${label} paths or order differ from the intended Host API ${lane} closure`);
  }
  for (const entry of entries) {
    if (!sameKeys(entry, EXPECTED_DIGEST_ENTRY_KEYS) || !safeRepositoryPath(entry.path) ||
      !SHA256.test(entry.sha256 ?? "")) {
      problems.push(`${label} contains a malformed path/sha256 entry`);
    }
  }
  return entries;
}

function validateManifest(manifest, problems) {
  if (!sameKeys(manifest, EXPECTED_MANIFEST_KEYS)) {
    problems.push(`${FREEZE_PATH} has fields outside the one-time freeze shape`);
    return;
  }
  if (manifest.kind !== FREEZE_KIND) problems.push(`${FREEZE_PATH} kind must be ${FREEZE_KIND}`);
  if (manifest.lane !== EXACT_HOST_API_LANE) {
    problems.push(`${FREEZE_PATH} lane must be exactly ${EXACT_HOST_API_LANE}`);
  }
  validateDigestEntries(
    manifest.normativeProse,
    EXPECTED_NORMATIVE_PROSE,
    "normativeProse",
    problems,
  );
  validateDigestEntries(
    manifest.machineRoots,
    EXPECTED_MACHINE_ROOTS,
    "machineRoots",
    problems,
  );
  if (!sameKeys(manifest.schemas, EXPECTED_SCHEMA_KEYS)) {
    problems.push(`${FREEZE_PATH} schemas has fields outside ledger/rootIds/closureIds`);
    return;
  }
  if (manifest.schemas.ledger !== SCHEMA_LEDGER_PATH) {
    problems.push(`${FREEZE_PATH} must dereference schemas through ${SCHEMA_LEDGER_PATH}`);
  }
  if (!sameArray(manifest.schemas.rootIds, EXPECTED_SCHEMA_ROOTS)) {
    problems.push("schema root IDs differ from the intended Host API v1 roots");
  }
  if (!sameArray(manifest.schemas.closureIds, EXPECTED_SCHEMA_CLOSURE)) {
    problems.push("schema closure IDs differ from the intended Host API v1 closure");
  }
}

function maskMarkdownCode(source) {
  return source
    .replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2(?=\n|$)/gu, "$1")
    .replace(/(`+)[\s\S]*?\1/gu, "");
}

function inspectNormativeProseReferences(path, source, frozenPaths, problems) {
  const masked = maskMarkdownCode(source);
  const links = masked.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>\n]+)>|([^\s)]+))/gu);
  for (const match of links) {
    const raw = (match[1] ?? match[2]).split("#", 1)[0];
    if (raw === "" || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw) || raw.startsWith("/")) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(path), raw));
    const prosePath = raw.endsWith("/") ? `${resolved}README.md` : resolved;
    if (prosePath.startsWith("spec/decisions/")) continue;
    if (prosePath.startsWith("spec/") && prosePath.endsWith(".md") &&
      !frozenPaths.has(prosePath)) {
      problems.push(`${path} references normative prose outside the frozen closure: ${prosePath}`);
    }
  }
}

function externalSchemaRefs(value, baseId, problems) {
  const refs = new Set();
  function visit(node) {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "$ref" && typeof child === "string" && !child.startsWith("#")) {
        try {
          const resolved = new URL(child, baseId);
          resolved.hash = "";
          if (resolved.href !== baseId) refs.add(resolved.href);
        } catch {
          problems.push(`${baseId} has an invalid external $ref: ${child}`);
        }
      }
      visit(child);
    }
  }
  visit(value);
  return refs;
}

function schemaEntries(ledger, problems) {
  if (ledger?.kind !== "takoform.public-schema-identities@v1" ||
    !Array.isArray(ledger.identities) || !Array.isArray(ledger.retired)) {
    problems.push(`${SCHEMA_LEDGER_PATH} has an invalid identity-ledger shape`);
    return new Map();
  }
  const entries = new Map();
  for (const [status, list] of [["active", ledger.identities], ["retired", ledger.retired]]) {
    for (const entry of list) {
      if (typeof entry?.id !== "string") {
        problems.push(`${SCHEMA_LEDGER_PATH} contains an entry without an id`);
        continue;
      }
      if (entries.has(entry.id)) {
        problems.push(`${SCHEMA_LEDGER_PATH} repeats schema identity ${entry.id}`);
        continue;
      }
      entries.set(entry.id, { ...entry, status });
    }
  }
  return entries;
}

function inspectSchemaClosure(accessor, manifest, problems) {
  const ledgerBytes = readRequired(accessor, SCHEMA_LEDGER_PATH, problems);
  if (ledgerBytes === null) return new Map();
  const ledger = parseJSON(ledgerBytes, SCHEMA_LEDGER_PATH, problems);
  if (ledger === null) return new Map();
  const byId = schemaEntries(ledger, problems);
  const resolvedEntries = new Map();
  const closure = new Set();
  const queue = [...EXPECTED_SCHEMA_ROOTS];
  while (queue.length !== 0) {
    const id = queue.shift();
    if (closure.has(id)) continue;
    closure.add(id);
    const entry = byId.get(id);
    if (entry === undefined) {
      problems.push(`${id} is absent from ${SCHEMA_LEDGER_PATH}`);
      continue;
    }
    let identityURL;
    try {
      identityURL = new URL(id);
    } catch {
      problems.push(`${id} is not a URL schema identity`);
      continue;
    }
    const expectedPublic = `website/public${identityURL.pathname}`;
    if (identityURL.origin !== "https://forms.takoform.com" || identityURL.search ||
      identityURL.hash || !identityURL.pathname.startsWith("/schemas/") ||
      !identityURL.pathname.endsWith(".json")) {
      problems.push(`${id} is outside the Host API schema identity origin`);
    }
    if (!safeRepositoryPath(entry.source) || !entry.source.startsWith("spec/schemas/")) {
      problems.push(`${id} has an invalid source path in ${SCHEMA_LEDGER_PATH}`);
      continue;
    }
    if (entry.public !== expectedPublic || !safeRepositoryPath(entry.public)) {
      problems.push(`${id} must resolve at ${expectedPublic}`);
      continue;
    }
    if (!SHA256.test(entry.sha256 ?? "")) {
      problems.push(`${id} has an invalid ledger sha256`);
      continue;
    }
    if (entry.status !== "active") problems.push(`${id} is not an active schema identity`);
    const source = readRequired(accessor, entry.source, problems);
    const published = readRequired(accessor, entry.public, problems);
    if (source === null || published === null) continue;
    if (sha256(source) !== entry.sha256) problems.push(`${entry.source} differs from its ledger sha256`);
    if (!source.equals(published)) problems.push(`${entry.public} differs byte-for-byte from ${entry.source}`);
    const document = parseJSON(source, entry.source, problems);
    if (document === null) continue;
    if (document.$id !== id) problems.push(`${entry.source} $id does not equal ${id}`);
    resolvedEntries.set(id, { ...entry, sourceBytes: source, publicBytes: published });
    for (const ref of externalSchemaRefs(document, id, problems)) queue.push(ref);
  }
  const actualClosure = [...closure].sort();
  if (!sameArray(actualClosure, EXPECTED_SCHEMA_CLOSURE) ||
    !sameArray(actualClosure, manifest?.schemas?.closureIds ?? [])) {
    problems.push("recursive schema closure differs from the intended Host API v1 closure");
  }
  return resolvedEntries;
}

function inspectTree(accessor) {
  const problems = [];
  const manifestBytes = readRequired(accessor, FREEZE_PATH, problems);
  if (manifestBytes === null) return { problems, manifest: null, manifestBytes, schemas: new Map() };
  const manifest = parseJSON(manifestBytes, FREEZE_PATH, problems);
  if (manifest === null) {
    if (problems.length === 0) problems.push(`${FREEZE_PATH} must be a JSON object`);
    return { problems, manifest, manifestBytes, schemas: new Map() };
  }
  validateManifest(manifest, problems);

  const frozenProse = new Set(EXPECTED_NORMATIVE_PROSE);
  const proseEntries = Array.isArray(manifest.normativeProse) ? manifest.normativeProse : [];
  const machineEntries = Array.isArray(manifest.machineRoots) ? manifest.machineRoots : [];
  for (const entry of [...proseEntries, ...machineEntries]) {
    if (!safeRepositoryPath(entry?.path)) continue;
    const bytes = readRequired(accessor, entry.path, problems);
    if (bytes === null) continue;
    if (sha256(bytes) !== entry.sha256) problems.push(`${entry.path} differs from its frozen sha256`);
    if (frozenProse.has(entry.path)) {
      const source = bytes.toString("utf8");
      if (entry.path === "spec/host-api/v1.md" &&
        !source.includes(`\`${EXACT_HOST_API_LANE}\``)) {
        problems.push(`${entry.path} does not name the exact Host API v1 lane`);
      }
      inspectNormativeProseReferences(entry.path, source, frozenProse, problems);
    }
    if (entry.path === "spec/host-api/operations-v1.json") {
      const operations = parseJSON(bytes, entry.path, problems);
      if (operations !== null) {
        if (operations.format !== "takoform.host-api@v1") {
          problems.push(`${entry.path} format must be takoform.host-api@v1`);
        }
        if (operations.apiGroup !== EXACT_HOST_API_LANE) {
          problems.push(`${entry.path} apiGroup must be exactly ${EXACT_HOST_API_LANE}`);
        }
      }
    }
    if (entry.path === "conformance/takoform-v1/generic.json") {
      const corpus = parseJSON(bytes, entry.path, problems);
      if (corpus !== null) {
        if (corpus.format !== "takoform.core-artifact-corpus@v1") {
          problems.push(`${entry.path} format must be takoform.core-artifact-corpus@v1`);
        }
        if (corpus.hostApiLane !== EXACT_HOST_API_LANE) {
          problems.push(`${entry.path} hostApiLane must be exactly ${EXACT_HOST_API_LANE}`);
        }
      }
    }
    if (entry.path === "spec/trust/profile.json") {
      const profile = parseJSON(bytes, entry.path, problems);
      if (profile !== null) {
        if (profile.format !== "takoform.core-trust-profile@v1") {
          problems.push(`${entry.path} format must be takoform.core-trust-profile@v1`);
        }
        if (profile.revocation?.statementIdentity !== "trust.forms.takoform.com/v1" ||
          profile.revocation?.checkpointIdentity !== "trust.forms.takoform.com/v1") {
          problems.push(`${entry.path} must name the current v1 revocation identities`);
        }
      }
    }
  }
  const schemas = inspectSchemaClosure(accessor, manifest, problems);
  return { problems: [...new Set(problems)], manifest, manifestBytes, schemas };
}

function inspectV2Tree(accessor) {
  const problems = [];
  const manifestBytes = readRequired(accessor, V2_FREEZE_PATH, problems);
  if (manifestBytes === null) return { problems, manifestBytes };
  const manifest = parseJSON(manifestBytes, V2_FREEZE_PATH, problems);
  if (!sameKeys(manifest, ["kind", "lane", "normativeProse"])) {
    problems.push(`${V2_FREEZE_PATH} must contain only kind, lane, and normativeProse`);
    return { problems, manifestBytes };
  }
  if (manifest.kind !== FREEZE_KIND) problems.push(`${V2_FREEZE_PATH} kind must be ${FREEZE_KIND}`);
  if (manifest.lane !== EXACT_V2_HOST_API_LANE) {
    problems.push(`${V2_FREEZE_PATH} lane must be exactly ${EXACT_V2_HOST_API_LANE}`);
  }
  const entries = validateDigestEntries(manifest.normativeProse,
    EXPECTED_V2_NORMATIVE_PROSE, "v2 normativeProse", problems, "v2");
  for (const entry of entries) {
    if (!EXPECTED_V2_NORMATIVE_PROSE.includes(entry?.path)) continue;
    const bytes = readRequired(accessor, entry.path, problems);
    if (bytes !== null && sha256(bytes) !== entry.sha256) {
      problems.push(`${entry.path} differs from its frozen sha256`);
    }
  }
  return { problems: [...new Set(problems)], manifest, manifestBytes };
}

export function readHostAPIFreezeManifest(root) {
  const problems = [];
  const bytes = readRequired(fileAccessor(root), FREEZE_PATH, problems);
  const manifest = bytes === null ? null : parseJSON(bytes, FREEZE_PATH, problems);
  if (manifest !== null) validateManifest(manifest, problems);
  else if (problems.length === 0) problems.push(`${FREEZE_PATH} must be a JSON object`);
  if (problems.length !== 0) throw new Error(problems.join("\n"));
  return manifest;
}

function repositoryHistory(root, manifestPath = FREEZE_PATH) {
  const inside = runGit(root, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return { problem: `${root} is not a Git worktree` };
  }
  const shallow = runGit(root, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
  const log = runGit(
    root,
    ["log", "--reverse", "--format=%H", "--diff-filter=A", "--root", "HEAD", "--", manifestPath],
    { allowFailure: true },
  );
  const commits = log.status === 0 ? log.stdout.trim().split(/\s+/u).filter(Boolean) : [];
  const atHead = runGit(root, ["cat-file", "-e", `HEAD:${manifestPath}`], {
    allowFailure: true,
  }).status === 0;
  const changes = manifestPath === V2_FREEZE_PATH
    ? contentChangingCommits(root,
      runGit(root, ["log", "--full-history", "--reverse", "--format=%H", "--root", "HEAD", "--", manifestPath]).stdout.trim().split(/\s+/u).filter(Boolean),
      [manifestPath])
    : null;
  return { shallow, firstAddCommit: commits[0] ?? null, atHead, changes };
}

function compareV2Edition(root, current, history, problems) {
  const firstAddCommit = history.firstAddCommit;
  const historical = inspectV2Tree(commitAccessor(root, firstAddCommit));
  for (const problem of historical.problems) {
    problems.push(`first-add commit ${firstAddCommit}: ${problem}`);
  }
  for (const entry of historical.manifest?.normativeProse ?? []) {
    if (entry.sha256 !== INITIAL_V2_NORMATIVE_SHA256[entry.path]) {
      problems.push(`first-add commit ${firstAddCommit}: ${entry.path} differs from the original public edition`);
    }
  }
  const changes = history.changes ?? [];
  if (changes[0] !== firstAddCommit || changes.length > 2) {
    problems.push(`${V2_FREEZE_PATH} must have only its first-add and one editorial modification in full Git history`);
    return firstAddCommit;
  }
  const editionCommit = changes[1] ?? firstAddCommit;
  const edition = editionCommit === firstAddCommit ? historical
    : inspectV2Tree(commitAccessor(root, editionCommit));
  if (edition !== historical) {
    for (const problem of edition.problems) problems.push(`editorial commit ${editionCommit}: ${problem}`);
    if (edition.manifestBytes?.equals(historical.manifestBytes)) {
      problems.push(`${V2_FREEZE_PATH} editorial commit did not change the manifest bytes`);
    }
  }
  const sourceChanges = contentChangingCommits(root,
    runGit(root, ["log", "--full-history", "--format=%H",
      `${firstAddCommit}..HEAD`, "--", ...EXPECTED_V2_NORMATIVE_PROSE]).stdout.trim().split(/\s+/u).filter(Boolean),
    EXPECTED_V2_NORMATIVE_PROSE);
  if (sourceChanges.some((commit) => commit !== editionCommit) ||
    (editionCommit !== firstAddCommit && !sourceChanges.includes(editionCommit))) {
    problems.push(`v2 normative sources may change only in the one ${V2_FREEZE_PATH} editorial commit`);
  }
  if (edition.manifestBytes !== null && current.manifestBytes !== null &&
    !current.manifestBytes.equals(edition.manifestBytes)) {
    problems.push(`${V2_FREEZE_PATH} differs from its ${editionCommit === firstAddCommit ? "first-add" : "editorial"} commit ${editionCommit}`);
  }
  const currentAccessor = fileAccessor(root);
  const editionAccessor = commitAccessor(root, editionCommit);
  for (const path of EXPECTED_V2_NORMATIVE_PROSE) {
    try {
      if (!currentAccessor.read(path).equals(editionAccessor.read(path))) {
        problems.push(`${path} differs from its ${editionCommit === firstAddCommit ? "first-add" : "editorial"} commit ${editionCommit}`);
      }
    } catch {
      // inspectV2Tree already reports missing current or committed source.
    }
  }
  return editionCommit;
}

function compareFirstAdd(root, current, firstAddCommit, problems) {
  const historical = inspectTree(commitAccessor(root, firstAddCommit));
  for (const problem of historical.problems) {
    problems.push(`first-add commit ${firstAddCommit}: ${problem}`);
  }
  if (historical.manifestBytes !== null && current.manifestBytes !== null &&
    !current.manifestBytes.equals(historical.manifestBytes)) {
    problems.push(`${FREEZE_PATH} differs from its first-add commit ${firstAddCommit}`);
  }
  const frozenPaths = [
    ...(historical.manifest?.normativeProse ?? []).map((entry) => entry.path),
    ...(historical.manifest?.machineRoots ?? []).map((entry) => entry.path),
  ];
  const currentAccessor = fileAccessor(root);
  const historicalAccessor = commitAccessor(root, firstAddCommit);
  for (const path of frozenPaths) {
    try {
      if (!currentAccessor.read(path).equals(historicalAccessor.read(path))) {
        problems.push(`${path} differs from its first-add commit ${firstAddCommit}`);
      }
    } catch {
      // inspectTree already reports the missing side with its exact path.
    }
  }
  for (const id of historical.manifest?.schemas?.closureIds ?? []) {
    const before = historical.schemas.get(id);
    const now = current.schemas.get(id);
    if (before === undefined || now === undefined) continue;
    for (const key of ["id", "sha256", "source", "public", "status"]) {
      if (before[key] !== now[key]) {
        problems.push(`${id} ${key} differs from its first-add commit ${firstAddCommit}`);
      }
    }
    if (!before.sourceBytes.equals(now.sourceBytes)) {
      problems.push(`${now.source} differs from its first-add commit ${firstAddCommit}`);
    }
    if (!before.publicBytes.equals(now.publicBytes)) {
      problems.push(`${now.public} differs from its first-add commit ${firstAddCommit}`);
    }
  }
}

export function verifyHostAPIFreeze(root, { mode = "check" } = {}) {
  if (mode !== "check" && mode !== "bootstrap") throw new Error(`unsupported mode: ${mode}`);
  const current = inspectTree(fileAccessor(root));
  const currentV2 = inspectV2Tree(fileAccessor(root));
  let history;
  let v2History;
  try {
    history = repositoryHistory(root);
    v2History = repositoryHistory(root, V2_FREEZE_PATH);
  } catch (error) {
    return { problems: [...current.problems, ...currentV2.problems, `cannot inspect Git history: ${error.message}`], firstAddCommit: null, v2FirstAddCommit: null };
  }
  const problems = [...current.problems, ...currentV2.problems];
  if (history.problem || v2History.problem) return { problems: [...problems, history.problem ?? v2History.problem], firstAddCommit: null, v2FirstAddCommit: null };
  if (mode === "bootstrap") {
    if (history.firstAddCommit !== null || history.atHead || v2History.firstAddCommit !== null || v2History.atHead) {
      problems.push("bootstrap is forbidden after the freeze manifest entered Git history");
    }
    return { problems: [...new Set(problems)], firstAddCommit: history.firstAddCommit, v2FirstAddCommit: v2History.firstAddCommit };
  }
  if (history.shallow) {
    problems.push("cannot prove the first-add commit from a shallow Git history");
  } else if (history.firstAddCommit === null) {
    problems.push(`${FREEZE_PATH} has no first-add commit; use --bootstrap only before its first commit`);
  } else {
    compareFirstAdd(root, current, history.firstAddCommit, problems);
  }
  let v2EditionCommit = null;
  if (v2History.shallow) {
    problems.push("cannot prove the v2 editorial history from a shallow Git history");
  } else if (v2History.firstAddCommit === null) {
    problems.push(`${V2_FREEZE_PATH} has no first-add commit; commit the fixed current v2 source and manifest together`);
  } else {
    v2EditionCommit = compareV2Edition(root, currentV2, v2History, problems);
  }
  return { problems: [...new Set(problems)], firstAddCommit: history.firstAddCommit, v2FirstAddCommit: v2History.firstAddCommit, v2EditionCommit };
}

export function inspectHostAPIFreeze(root, options = {}) {
  return verifyHostAPIFreeze(root, options).problems;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: bun scripts/host-api-freeze.mjs [--check|--bootstrap]\n";

export function main(argv = process.argv.slice(2)) {
  const flag = argv[0] ?? "--check";
  if (argv.length > 1 || (flag !== "--check" && flag !== "--bootstrap")) {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  const mode = flag.slice(2);
  const result = verifyHostAPIFreeze(ROOT, { mode });
  if (result.problems.length !== 0) {
    for (const problem of result.problems) process.stderr.write(`host-api-freeze: ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  if (mode === "bootstrap") {
    process.stdout.write("host-api-freeze: bootstrap verified the uncommitted Host API v1 and v2 closures\n");
  } else {
    process.stdout.write(
      `host-api-freeze: current v1 bytes equal first-add ${result.firstAddCommit}; v2 edition ${result.v2EditionCommit} retains first-add ${result.v2FirstAddCommit}\n`,
    );
  }
}

if (import.meta.main) main();
