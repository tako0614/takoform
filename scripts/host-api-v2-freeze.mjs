#!/usr/bin/env node

// One-way verifier for the normative Host API v2 prose. The manifest is a
// repository-owned freeze record, not a document writer or version stream.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FREEZE_PATH = "spec/host-api/v2.freeze.json";
export const FREEZE_KIND = "takoform.host-api.freeze";
export const EXACT_HOST_API = "forms.takoform.com/v2";
export const EXPECTED_NORMATIVE_PROSE = Object.freeze([
  "spec/host-api/v2/README.md",
  "spec/host-api/v2/http.md",
  "spec/host-api/v2/forms.md",
]);

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const EXPECTED_MANIFEST_KEYS = ["api", "kind", "normativeProse"];
const EXPECTED_DIGEST_ENTRY_KEYS = ["path", "sha256"];

function sha256(bytes) {
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

function runGit(root, args, { bytes = false, allowFailure = false } = {}) {
  const result = spawnSync("git", ["--no-replace-objects", ...args], {
    cwd: root,
    encoding: bytes ? null : "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const stderr = bytes ? result.stderr.toString("utf8") : result.stderr;
    throw new Error(stderr.trim() || `git ${args[0]} failed with status ${result.status}`);
  }
  return result;
}

function repositoryAccessor(root) {
  return {
    read(path) {
      if (!safeRepositoryPath(path)) throw new Error("unsafe repository path");
      return readFileSync(resolve(root, path));
    },
  };
}

function commitAccessor(root, commit) {
  return {
    read(path) {
      if (!safeRepositoryPath(path)) throw new Error("unsafe repository path");
      return runGit(root, ["show", `${commit}:${path}`], { bytes: true }).stdout;
    },
  };
}

function readRequired(accessor, path, problems) {
  try {
    return accessor.read(path);
  } catch {
    problems.push(`${path} is missing`);
    return null;
  }
}

function parseManifest(bytes, problems) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    problems.push(`${FREEZE_PATH} is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateManifest(manifest, problems) {
  if (!sameKeys(manifest, EXPECTED_MANIFEST_KEYS)) {
    problems.push(`${FREEZE_PATH} has fields outside the one-time v2 freeze shape`);
    return;
  }
  if (manifest.kind !== FREEZE_KIND)
    problems.push(`${FREEZE_PATH} kind must be ${FREEZE_KIND}`);
  if (manifest.api !== EXACT_HOST_API)
    problems.push(`${FREEZE_PATH} api must be exactly ${EXACT_HOST_API}`);
  const entries = manifest.normativeProse;
  if (!Array.isArray(entries) || entries.length !== EXPECTED_NORMATIVE_PROSE.length) {
    problems.push(
      `normativeProse must name exactly ${EXPECTED_NORMATIVE_PROSE.join(", ")}`,
    );
    return;
  }
  const paths = entries.map((entry) => entry?.path);
  if (!sameArray(paths, EXPECTED_NORMATIVE_PROSE)) {
    problems.push("normativeProse paths or order differ from the intended Host API v2 closure");
  }
  for (const entry of entries) {
    if (!sameKeys(entry, EXPECTED_DIGEST_ENTRY_KEYS) ||
      !safeRepositoryPath(entry.path) || !SHA256.test(entry.sha256 ?? "")) {
      problems.push("normativeProse contains a malformed path/sha256 entry");
    }
  }
}

function inspectTree(accessor) {
  const problems = [];
  let manifestBytes;
  try {
    manifestBytes = accessor.read(FREEZE_PATH);
  } catch {
    return { problems, manifest: null, manifestBytes: null, present: false };
  }
  const manifest = parseManifest(manifestBytes, problems);
  if (manifest === null) {
    if (problems.length === 0) problems.push(`${FREEZE_PATH} must be a JSON object`);
    return { problems, manifest, manifestBytes, present: true };
  }
  validateManifest(manifest, problems);
  const entries = Array.isArray(manifest.normativeProse) ? manifest.normativeProse : [];
  for (const entry of entries) {
    if (!safeRepositoryPath(entry?.path)) continue;
    const bytes = readRequired(accessor, entry.path, problems);
    if (bytes !== null && sha256(bytes) !== entry.sha256)
      problems.push(`${entry.path} differs from its frozen sha256`);
  }
  return { problems: [...new Set(problems)], manifest, manifestBytes, present: true };
}

function repositoryHistory(root) {
  const inside = runGit(root, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (inside.status !== 0 || inside.stdout.trim() !== "true")
    return { problem: `${root} is not a Git worktree` };
  const graftPathResult = runGit(root, ["rev-parse", "--git-path", "info/grafts"]);
  const graftPathText = graftPathResult.stdout.trim();
  if (graftPathText === "")
    return { problem: "cannot resolve the Git graft path; first-add provenance is unknown" };
  const graftPath = resolve(root, graftPathText);
  try {
    lstatSync(graftPath);
    return { problem: "legacy Git graft file exists; cannot prove first-add history" };
  } catch (error) {
    if (error.code !== "ENOENT")
      return { problem: `cannot inspect Git graft path; first-add provenance is unknown: ${error.message}` };
  }
  const shallow = runGit(root, ["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
  const addLog = runGit(
    root,
    ["log", "--reverse", "--format=%H", "--diff-filter=A", "--root", "HEAD", "--", FREEZE_PATH],
    { allowFailure: true },
  );
  const deleteLog = runGit(
    root,
    ["log", "--format=%H", "--diff-filter=D", "--root", "HEAD", "--", FREEZE_PATH],
    { allowFailure: true },
  );
  if (addLog.status !== 0 || deleteLog.status !== 0) {
    const diagnostic = [addLog.stderr, deleteLog.stderr]
      .filter(Boolean)
      .join("\n")
      .trim();
    return {
      problem: `cannot inspect freeze-manifest add/delete history${diagnostic ? `: ${diagnostic}` : ""}`,
    };
  }
  const additions = addLog.status === 0 ? addLog.stdout.trim().split(/\s+/u).filter(Boolean) : [];
  const deletions = deleteLog.status === 0 ? deleteLog.stdout.trim().split(/\s+/u).filter(Boolean) : [];
  const atHead = runGit(root, ["cat-file", "-e", `HEAD:${FREEZE_PATH}`], {
    allowFailure: true,
  }).status === 0;
  return {
    shallow,
    firstAddCommit: additions[0] ?? null,
    additions,
    deletions,
    atHead,
  };
}

function compareFirstAdd(root, current, firstAddCommit, problems) {
  const historical = inspectTree(commitAccessor(root, firstAddCommit));
  for (const problem of historical.problems)
    problems.push(`first-add commit ${firstAddCommit}: ${problem}`);
  if (historical.manifestBytes !== null && current.manifestBytes !== null &&
    !current.manifestBytes.equals(historical.manifestBytes)) {
    problems.push(`${FREEZE_PATH} differs from its first-add commit ${firstAddCommit}`);
  }
  const paths = historical.manifest?.normativeProse ?? [];
  const currentAccessor = repositoryAccessor(root);
  const historicalAccessor = commitAccessor(root, firstAddCommit);
  for (const entry of paths) {
    if (!safeRepositoryPath(entry?.path)) continue;
    try {
      if (!currentAccessor.read(entry.path).equals(historicalAccessor.read(entry.path)))
        problems.push(`${entry.path} differs from its first-add commit ${firstAddCommit}`);
    } catch {
      // inspectTree reports a missing current or historical source path.
    }
  }
}

/**
 * Verify the exact API v2 normative prose closure and its first-add Git bytes.
 * `bootstrap` validates a candidate only; it never writes or freezes a manifest.
 */
export function verifyV2Freeze(root, { mode = "check", requireFrozen = false } = {}) {
  if (mode !== "check" && mode !== "bootstrap")
    throw new Error(`unsupported mode: ${mode}`);
  if (typeof requireFrozen !== "boolean")
    throw new Error("requireFrozen must be a boolean");
  if (mode === "bootstrap" && requireFrozen)
    throw new Error("requireFrozen cannot be used with bootstrap mode");

  const current = inspectTree(repositoryAccessor(root));
  let history;
  try {
    history = repositoryHistory(root);
  } catch (error) {
    return {
      status: "INVALID",
      problems: [...current.problems, `cannot inspect Git history: ${error.message}`],
      firstAddCommit: null,
    };
  }
  const problems = [...current.problems];
  if (history.problem) {
    return { status: "INVALID", problems: [...problems, history.problem], firstAddCommit: null };
  }
  if (history.shallow) {
    problems.push("cannot prove the first-add commit from a shallow Git history");
    return { status: "INVALID", problems: [...new Set(problems)], firstAddCommit: history.firstAddCommit };
  }
  if (history.deletions.length !== 0) {
    problems.push(`${FREEZE_PATH} was deleted in Git history; deletion and re-addition are forbidden`);
  }

  if (mode === "bootstrap") {
    if (history.firstAddCommit !== null || history.atHead)
      problems.push("bootstrap is forbidden after the freeze manifest entered Git history");
    if (!current.present)
      problems.push(`${FREEZE_PATH} candidate is missing; bootstrap validates but never writes it`);
    return {
      status: problems.length === 0 ? "BOOTSTRAP_CANDIDATE" : "INVALID",
      problems: [...new Set(problems)],
      firstAddCommit: history.firstAddCommit,
    };
  }

  if (history.firstAddCommit === null) {
    if (history.atHead) {
      problems.push(`${FREEZE_PATH} has no first-add commit; use --bootstrap only before its first commit`);
      return { status: "INVALID", problems: [...new Set(problems)], firstAddCommit: null };
    }
    if (current.present) {
      problems.push(`${FREEZE_PATH} is present but has no first-add commit; use --bootstrap before committing it`);
      return { status: "INVALID", problems: [...new Set(problems)], firstAddCommit: null };
    }
    if (requireFrozen)
      problems.push(`${FREEZE_PATH} is absent; this check requires a frozen Host API v2 closure`);
    return {
      status: problems.length === 0 ? "UNFROZEN" : "INVALID",
      problems: [...new Set(problems)],
      firstAddCommit: null,
    };
  }

  if (!history.atHead || !current.present)
    problems.push(`${FREEZE_PATH} was first added at ${history.firstAddCommit} but is absent at HEAD`);
  compareFirstAdd(root, current, history.firstAddCommit, problems);
  return {
    status: problems.length === 0 ? "FROZEN" : "INVALID",
    problems: [...new Set(problems)],
    firstAddCommit: history.firstAddCommit,
  };
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: bun scripts/host-api-v2-freeze.mjs [--check [--require-frozen]|--bootstrap]\n";

export function main(argv = process.argv.slice(2)) {
  let mode = "check";
  let requireFrozen = false;
  if (argv.length === 1 && argv[0] === "--bootstrap") mode = "bootstrap";
  else if (argv.length === 0 || (argv.length === 1 && argv[0] === "--check")) {
    mode = "check";
  } else if (argv.length === 2 && argv[0] === "--check" && argv[1] === "--require-frozen") {
    requireFrozen = true;
  } else {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }
  const result = verifyV2Freeze(ROOT, { mode, requireFrozen });
  if (result.problems.length !== 0) {
    for (const problem of result.problems) process.stderr.write(`host-api-v2-freeze: ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.status === "UNFROZEN")
    process.stdout.write("host-api-v2-freeze: UNFROZEN (no manifest has entered Git history)\n");
  else if (result.status === "BOOTSTRAP_CANDIDATE")
    process.stdout.write("host-api-v2-freeze: bootstrap candidate verified; no manifest was written\n");
  else
    process.stdout.write(`host-api-v2-freeze: current bytes equal first-add commit ${result.firstAddCommit}\n`);
}

if (import.meta.main) main();
