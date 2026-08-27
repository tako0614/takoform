import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST_PATH = "docs/extraction/source-path-map.json";
const FORMAT = "takoform.core-extraction-source-map@v1";
const SOURCE_REPOSITORY =
  "https://github.com/tako0614/terraform-provider-takoform.git";
const SOURCE_COMMIT = "1fa34160a4ed152443b4ea424a324f7677716e36";
const FILTERED_COMMIT = "f3ed98a9b967cfed130359a51f56badf11188bd4";

function git(repo, args, encoding = "utf8") {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
}

function tree(repo, commit) {
  return git(repo, ["rev-parse", `${commit}^{tree}`]).trim();
}

function pathsAt(repo, commit) {
  const raw = git(repo, ["ls-tree", "-r", "-z", "--name-only", commit], null);
  return raw
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function blob(repo, commit, relativePath) {
  const spec = `${commit}:${relativePath}`;
  const oid = git(repo, ["rev-parse", spec]).trim();
  const size = Number.parseInt(git(repo, ["cat-file", "-s", spec]).trim(), 10);
  const bytes = git(repo, ["cat-file", "blob", spec], null);
  return {
    oid,
    size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function generate(sourceRepo) {
  if (!sourceRepo) {
    throw new Error("--source-repo is required with --write");
  }
  const extractedPaths = pathsAt(ROOT, FILTERED_COMMIT);
  const entries = extractedPaths.map((relativePath) => ({
    sourcePath: relativePath,
    extractedPath: relativePath,
    source: blob(sourceRepo, SOURCE_COMMIT, relativePath),
    extracted: blob(ROOT, FILTERED_COMMIT, relativePath),
  }));
  for (const entry of entries) {
    if (
      entry.source.oid !== entry.extracted.oid ||
      entry.source.size !== entry.extracted.size ||
      entry.source.sha256 !== entry.extracted.sha256
    ) {
      throw new Error(`extracted bytes drifted for ${entry.sourcePath}`);
    }
  }
  return {
    format: FORMAT,
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: SOURCE_COMMIT,
    sourceTree: tree(sourceRepo, SOURCE_COMMIT),
    filteredCommit: FILTERED_COMMIT,
    filteredTree: tree(ROOT, FILTERED_COMMIT),
    pathCount: entries.length,
    paths: entries,
  };
}

function check(sourceRepo) {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, MANIFEST_PATH), "utf8"),
  );
  if (
    manifest.format !== FORMAT ||
    manifest.sourceRepository !== SOURCE_REPOSITORY ||
    manifest.sourceCommit !== SOURCE_COMMIT ||
    manifest.filteredCommit !== FILTERED_COMMIT
  ) {
    throw new Error("extraction source-map identity drifted");
  }
  const extractedPaths = pathsAt(ROOT, FILTERED_COMMIT);
  if (
    manifest.pathCount !== extractedPaths.length ||
    manifest.paths.length !== extractedPaths.length
  ) {
    throw new Error("extraction source-map path count drifted");
  }
  for (let index = 0; index < extractedPaths.length; index += 1) {
    const relativePath = extractedPaths[index];
    const entry = manifest.paths[index];
    if (
      entry.sourcePath !== relativePath ||
      entry.extractedPath !== relativePath
    ) {
      throw new Error(`extraction source-map path drifted at ${relativePath}`);
    }
    const extracted = blob(ROOT, FILTERED_COMMIT, relativePath);
    if (JSON.stringify(entry.extracted) !== JSON.stringify(extracted)) {
      throw new Error(`filtered blob metadata drifted for ${relativePath}`);
    }
    if (sourceRepo) {
      const source = blob(sourceRepo, SOURCE_COMMIT, relativePath);
      if (JSON.stringify(entry.source) !== JSON.stringify(source)) {
        throw new Error(`source blob metadata drifted for ${relativePath}`);
      }
    }
    if (JSON.stringify(entry.source) !== JSON.stringify(entry.extracted)) {
      throw new Error(`source and extracted bytes disagree for ${relativePath}`);
    }
  }
  if (
    manifest.sourceTree !==
      (sourceRepo ? tree(sourceRepo, SOURCE_COMMIT) : manifest.sourceTree) ||
    manifest.filteredTree !== tree(ROOT, FILTERED_COMMIT)
  ) {
    throw new Error("extraction tree identity drifted");
  }
  return manifest;
}

const args = process.argv.slice(2);
const mode = args[0];
const sourceIndex = args.indexOf("--source-repo");
const sourceRepo = sourceIndex >= 0 ? path.resolve(args[sourceIndex + 1]) : null;

if (mode === "--write") {
  const manifest = generate(sourceRepo);
  writeFileSync(
    path.join(ROOT, MANIFEST_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(`wrote ${manifest.pathCount} extraction path records`);
} else if (mode === "--check") {
  const manifest = check(sourceRepo);
  console.log(`extraction path map OK: ${manifest.pathCount} byte-exact paths`);
} else {
  throw new Error(
    "usage: bun scripts/extraction-map.mjs --write --source-repo <repo> | --check [--source-repo <repo>]",
  );
}
