#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The schema origin is intentionally a data-only Worker.  This script is the
 * closed projection boundary: the release identity ledger is the input, and
 * schema-origin/public is the only output it may write.
 */

export const PUBLIC_SCHEMA_ORIGIN = "https://forms.takoform.com";
export const SCHEMA_ROUTE_PATTERN = "forms.takoform.com/schemas/*";
export const SCHEMA_IDENTITY_LEDGER = "release/public-schema-identities.json";
export const PROJECTION_ROOT = "schema-origin/public";
export const IMPORTED_ACTIVE_SCHEMA_COUNT = 31;

const LEDGER_KIND = "takoform.public-schema-identities@v1";
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SOURCE_PATH = /^spec\/schemas\/[A-Za-z0-9._~-]+\.json$/u;
const URL_PATH = /^\/schemas\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.json$/u;
const ACTIVE_KEYS = ["id", "public", "sha256", "source"];
const RETIRED_KEYS = ["id", "public", "retiredBecause", "sha256", "source"];
const ROOT_KEYS = ["identities", "kind", "retired"];

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message) {
  throw new Error(`schema-origin projection: ${message}`);
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join(",") !== wanted.join(",")) {
    fail(`${label} must have exactly ${wanted.join(", ")}`);
  }
}

function canonicalPathname(id, label) {
  if (typeof id !== "string" || id.length === 0) {
    fail(`${label} id must be a string`);
  }

  let parsed;
  try {
    parsed = new URL(id);
  } catch (error) {
    fail(`${label} id is not a URL (${error.message})`);
  }

  // href equality rejects host case folding, default ports, dot-segment
  // normalization, escaping, and all other non-canonical URL spellings.
  if (
    parsed.href !== id ||
    parsed.origin !== PUBLIC_SCHEMA_ORIGIN ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !URL_PATH.test(parsed.pathname) ||
    parsed.pathname.includes("%") ||
    parsed.pathname.includes("\\") ||
    `${PUBLIC_SCHEMA_ORIGIN}${parsed.pathname}` !== id
  ) {
    fail(
      `${label} id must be a canonical ${PUBLIC_SCHEMA_ORIGIN}/schemas/*.json URL`,
    );
  }

  return parsed.pathname;
}

function validateSourcePath(source, label) {
  if (typeof source !== "string" || !SOURCE_PATH.test(source) || source.includes("%") || source.includes("\\")) {
    fail(`${label} source must be a canonical spec/schemas/*.json path`);
  }
  return source;
}

function validatePublicPath(publicPath, pathname, label) {
  if (publicPath !== `website/public${pathname}`) {
    fail(`${label} public path must match its canonical id`);
  }
}

function validateIdentityFields(identity, index, state) {
  const label = `${state} identity ${index}`;
  exactKeys(identity, state === "active" ? ACTIVE_KEYS : RETIRED_KEYS, label);

  if (
    typeof identity.id !== "string" ||
    typeof identity.source !== "string" ||
    typeof identity.public !== "string" ||
    typeof identity.sha256 !== "string" ||
    !SHA256.test(identity.sha256)
  ) {
    fail(`${label} has invalid fields`);
  }

  const pathname = canonicalPathname(identity.id, label);
  validateSourcePath(identity.source, label);
  validatePublicPath(identity.public, pathname, label);
  if (state === "retired" && (typeof identity.retiredBecause !== "string" || identity.retiredBecause.trim() === "")) {
    fail(`${label} must state why it was retired`);
  }

  return { ...identity, pathname, relativePath: pathname.slice(1) };
}

/**
 * Parse and validate the complete release ledger while returning active and
 * retired entries separately. Retired entries are retained for collision
 * checks only; they are never returned as projection inputs.
 */
export function parseSchemaIdentityLedger(raw, label = SCHEMA_IDENTITY_LEDGER) {
  let document;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    fail(`${label} is invalid JSON (${error.message})`);
  }

  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    fail(`${label} must be an object`);
  }
  const rootKeys = Object.keys(document);
  if (
    rootKeys.some((key) => !ROOT_KEYS.includes(key)) ||
    document.kind !== LEDGER_KIND ||
    !Array.isArray(document.identities) ||
    document.identities.length === 0
  ) {
    fail(`${label} must be a non-empty ${LEDGER_KIND} document`);
  }
  if (document.retired !== undefined && !Array.isArray(document.retired)) {
    fail(`${label} retired must be an array when present`);
  }

  const active = [];
  const retired = [];
  const activeIDs = new Set();
  const activePaths = new Set();
  const activeSources = new Set();
  const retiredIDs = new Set();
  const retiredPaths = new Set();

  for (const [index, identity] of document.identities.entries()) {
    const candidate = validateIdentityFields(identity, index, "active");
    if (activeIDs.has(candidate.id)) fail(`${label} duplicates active id ${candidate.id}`);
    if (activePaths.has(candidate.pathname)) fail(`${label} duplicates active path ${candidate.pathname}`);
    if (activeSources.has(candidate.source)) fail(`${label} duplicates active source ${candidate.source}`);
    activeIDs.add(candidate.id);
    activePaths.add(candidate.pathname);
    activeSources.add(candidate.source);
    active.push(candidate);
  }

  const orderedIDs = active.map(({ id }) => id);
  if (orderedIDs.join("\n") !== [...orderedIDs].sort().join("\n")) {
    fail(`${label} active identities must be sorted by id`);
  }

  for (const [index, identity] of (document.retired ?? []).entries()) {
    const candidate = validateIdentityFields(identity, index, "retired");
    if (retiredIDs.has(candidate.id)) fail(`${label} duplicates retired id ${candidate.id}`);
    if (retiredPaths.has(candidate.pathname)) fail(`${label} duplicates retired path ${candidate.pathname}`);
    if (activeIDs.has(candidate.id) || activePaths.has(candidate.pathname)) {
      fail(`${label} identity ${candidate.id} is both active and retired`);
    }
    retiredIDs.add(candidate.id);
    retiredPaths.add(candidate.pathname);
    retired.push(candidate);
  }

  return { active, retired };
}

// Keep the old descriptive export available for callers that use the ledger
// name rather than this worker's projection terminology.
export const parsePublicSchemaIdentityLedger = parseSchemaIdentityLedger;

export function readSchemaIdentityLedger(repositoryRoot = moduleRoot) {
  const ledgerPath = path.join(repositoryRoot, SCHEMA_IDENTITY_LEDGER);
  let raw;
  try {
    raw = readFileSync(ledgerPath, "utf8");
  } catch (error) {
    fail(`cannot read ${SCHEMA_IDENTITY_LEDGER} (${error.message})`);
  }
  return parseSchemaIdentityLedger(raw, SCHEMA_IDENTITY_LEDGER);
}

export const readPublicSchemaIdentityLedger = readSchemaIdentityLedger;

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertInside(root, candidate, label) {
  if (!isInside(root, candidate)) fail(`${label} escapes the validated projection root`);
}

function assertNoSymlinkAlongPath(candidate, label, { allowMissingFinal = false } = {}) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const pieces = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const [index, piece] of pieces.entries()) {
    current = path.join(current, piece);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === "ENOENT" && allowMissingFinal && index === pieces.length - 1) return;
      if (error?.code === "ENOENT") return;
      fail(`${label} cannot be inspected (${error.message})`);
    }
    if (stat.isSymbolicLink()) fail(`${label} must not traverse a symlink: ${current}`);
  }
}

function existingEntry(candidate) {
  try {
    return lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertRepositoryRoot(repositoryRoot) {
  const absolute = path.resolve(repositoryRoot);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    fail(`repository root cannot be inspected (${error.message})`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("repository root must be a real directory");
  assertNoSymlinkAlongPath(absolute, "repository root");
  return absolute;
}

function projectionRootFor(repositoryRoot) {
  const absoluteRoot = assertRepositoryRoot(repositoryRoot);
  const projectionRoot = path.resolve(absoluteRoot, PROJECTION_ROOT);
  assertInside(absoluteRoot, projectionRoot, "projection root");
  // The parent and final directory are the only locations this script may
  // ever create or remove. This check also rejects a schema-origin symlink.
  assertNoSymlinkAlongPath(path.dirname(projectionRoot), "projection root parent");
  if (existingEntry(projectionRoot)) {
    assertNoSymlinkAlongPath(projectionRoot, "projection root");
  }
  return projectionRoot;
}

function validateSourceFile(repositoryRoot, entry) {
  const sourcePath = path.resolve(repositoryRoot, entry.source);
  assertInside(repositoryRoot, sourcePath, `${entry.source} source`);
  assertNoSymlinkAlongPath(sourcePath, `${entry.source} source`);
  let stat;
  try {
    stat = lstatSync(sourcePath);
  } catch (error) {
    fail(`${entry.source} is missing (${error.message})`);
  }
  if (!stat.isFile()) fail(`${entry.source} must be a regular file`);

  const bytes = readFileSync(sourcePath);
  const observedDigest = digest(bytes);
  if (observedDigest !== entry.sha256) {
    fail(`${entry.source} digest ${observedDigest} differs from locked ${entry.sha256}`);
  }
  let document;
  try {
    document = JSON.parse(bytes);
  } catch (error) {
    fail(`${entry.source} is invalid JSON (${error.message})`);
  }
  if (document?.$id !== entry.id) {
    fail(`${entry.source} $id differs from ${entry.id}`);
  }
  return { ...entry, sourcePath, bytes };
}

/**
 * Resolve the active ledger identities into exact source bytes and safe
 * destination paths. Retired identities intentionally never enter this list.
 */
export function resolveSchemaProjection(repositoryRoot = moduleRoot) {
  const absoluteRoot = assertRepositoryRoot(repositoryRoot);
  const { active } = readSchemaIdentityLedger(absoluteRoot);
  const projectionRoot = projectionRootFor(absoluteRoot);
  const entries = active.map((entry) => {
    const resolved = validateSourceFile(absoluteRoot, entry);
    const destinationPath = path.resolve(projectionRoot, entry.relativePath);
    assertInside(projectionRoot, destinationPath, `${entry.id} destination`);
    return { ...resolved, destinationPath };
  });
  if (
    entries.length < IMPORTED_ACTIVE_SCHEMA_COUNT &&
    absoluteRoot === moduleRoot
  ) {
    fail(
      `the imported ${IMPORTED_ACTIVE_SCHEMA_COUNT}-identity prefix was truncated to ${entries.length}`,
    );
  }
  return { repositoryRoot: absoluteRoot, projectionRoot, entries };
}

function walkProjectionTree(projectionRoot) {
  const files = new Map();
  const directories = new Set();
  const visit = (directory) => {
    let children;
    try {
      children = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      fail(`cannot read projection directory ${directory} (${error.message})`);
    }
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = path.relative(projectionRoot, absolute).split(path.sep).join("/");
      assertInside(projectionRoot, absolute, `tracked projection path ${relative}`);
      if (child.isSymbolicLink()) fail(`tracked projection contains a symlink: ${relative}`);
      if (child.isDirectory()) {
        directories.add(relative);
        visit(absolute);
      } else if (child.isFile()) {
        files.set(relative, absolute);
      } else {
        fail(`tracked projection contains a non-regular entry: ${relative}`);
      }
    }
  };
  visit(projectionRoot);
  return { files, directories };
}

function expectedDirectories(entries) {
  const directories = new Set();
  for (const entry of entries) {
    const segments = entry.relativePath.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current === "" ? segment : `${current}/${segment}`;
      directories.add(current);
    }
  }
  return directories;
}

/**
 * Return a deterministic list of projection mismatches without mutating the
 * worktree. A missing projection root is a failed check, not an empty output.
 */
export function inspectSchemaProjection(repositoryRoot = moduleRoot) {
  const resolved = resolveSchemaProjection(repositoryRoot);
  const { projectionRoot, entries } = resolved;
  if (!existsSync(projectionRoot)) {
    return {
      ...resolved,
      problems: [`missing projection root ${PROJECTION_ROOT}`],
    };
  }
  const stat = lstatSync(projectionRoot);
  if (!stat.isDirectory()) fail(`projection root ${PROJECTION_ROOT} must be a directory`);
  const observed = walkProjectionTree(projectionRoot);
  const expected = new Map(entries.map((entry) => [entry.relativePath, entry]));
  const problems = [];

  for (const relative of [...expected.keys()].sort()) {
    const entry = expected.get(relative);
    const observedPath = observed.files.get(relative);
    if (!observedPath) {
      problems.push(`missing projected file ${relative}`);
      continue;
    }
    const actual = readFileSync(observedPath);
    if (!actual.equals(entry.bytes)) problems.push(`changed bytes for projected file ${relative}`);
  }
  for (const relative of [...observed.files.keys()].sort()) {
    if (!expected.has(relative)) problems.push(`unexpected projected file ${relative}`);
  }
  const wantedDirectories = expectedDirectories(entries);
  for (const relative of [...observed.directories].sort()) {
    if (!wantedDirectories.has(relative)) problems.push(`unexpected projected directory ${relative}`);
  }

  return { ...resolved, problems };
}

export function checkSchemaProjection(repositoryRoot = moduleRoot) {
  const result = inspectSchemaProjection(repositoryRoot);
  if (result.problems.length !== 0) {
    for (const problem of result.problems) console.error(`schema-origin projection: ${problem}`);
    throw new Error(
      `schema-origin projection: tracked public tree is not an exact active-ledger projection (${result.problems.join("; ")})`,
    );
  }
  const totalBytes = result.entries.reduce((total, entry) => total + entry.bytes.length, 0);
  console.log(
    `schema-origin projection: ${result.entries.length} active schema assets are exact (${totalBytes} bytes)`,
  );
  return result;
}

function removeTreeEntry(absolute, projectionRoot) {
  assertInside(projectionRoot, absolute, "projection deletion");
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) fail(`refusing to delete symlink under projection root: ${absolute}`);
  if (stat.isDirectory()) {
    for (const child of readdirSync(absolute)) removeTreeEntry(path.join(absolute, child), projectionRoot);
    rmdirSync(absolute);
  } else if (stat.isFile()) {
    unlinkSync(absolute);
  } else {
    fail(`refusing to delete non-regular projection entry: ${absolute}`);
  }
}

function clearProjectionRoot(projectionRoot) {
  const stat = existingEntry(projectionRoot);
  if (!stat) return;
  if (stat.isSymbolicLink()) fail("refusing to write through a projection-root symlink");
  if (!stat.isDirectory()) fail(`projection root ${PROJECTION_ROOT} must be a directory`);
  // Validate every existing entry before the first deletion. This means a
  // symlink anywhere in the tree leaves the worktree untouched.
  walkProjectionTree(projectionRoot);
  for (const child of readdirSync(projectionRoot)) {
    removeTreeEntry(path.join(projectionRoot, child), projectionRoot);
  }
}

function ensureWritableProjectionRoot(projectionRoot) {
  const parent = path.dirname(projectionRoot);
  assertNoSymlinkAlongPath(parent, "projection root parent", { allowMissingFinal: true });
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  assertNoSymlinkAlongPath(parent, "projection root parent");
  if (!existingEntry(projectionRoot)) {
    mkdirSync(projectionRoot);
  }
  assertNoSymlinkAlongPath(projectionRoot, "projection root");
  const stat = lstatSync(projectionRoot);
  if (!stat.isDirectory()) fail(`projection root ${PROJECTION_ROOT} must be a directory`);
}

/**
 * Rewrite only schema-origin/public from the active identities. Existing
 * output is closed by deleting its contents, but deletion is constrained to
 * the exact validated root and is refused if a symlink or special file exists.
 */
export function writeSchemaProjection(repositoryRoot = moduleRoot) {
  const resolved = resolveSchemaProjection(repositoryRoot);
  const { projectionRoot, entries } = resolved;
  ensureWritableProjectionRoot(projectionRoot);
  clearProjectionRoot(projectionRoot);

  for (const entry of entries) {
    assertInside(projectionRoot, entry.destinationPath, `${entry.id} destination`);
    const parent = path.dirname(entry.destinationPath);
    assertInside(projectionRoot, parent, `${entry.id} destination parent`);
    mkdirSync(parent, { recursive: true });
    assertNoSymlinkAlongPath(parent, `${entry.id} destination parent`);
    if (existsSync(entry.destinationPath)) {
      const stat = lstatSync(entry.destinationPath);
      if (stat.isSymbolicLink()) fail(`refusing to overwrite destination symlink: ${entry.relativePath}`);
      if (!stat.isFile()) fail(`destination ${entry.relativePath} must be a regular file`);
    }
    writeFileSync(entry.destinationPath, entry.bytes);
  }

  const checked = checkSchemaProjection(resolved.repositoryRoot);
  return checked;
}

function usage() {
  return [
    "Usage: node scripts/schema-origin-projection.mjs --check",
    "       node scripts/schema-origin-projection.mjs --write",
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1 || !["--check", "--write"].includes(argv[0])) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  try {
    if (argv[0] === "--check") checkSchemaProjection();
    else writeSchemaProjection();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
