#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const CORE_RELEASE = Object.freeze({
  module: "github.com/tako0614/takoform",
  githubRepository: "tako0614/takoform",
  githubApi: "https://api.github.com",
  publicOrigin: "https://github.com/tako0614/takoform.git",
  origins: Object.freeze([
    "https://github.com/tako0614/takoform.git",
    "git@github.com:tako0614/takoform.git",
  ]),
});

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const STABLE_SEMVER_TAG = /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const USAGE = "usage: bun run release:core -- vMAJOR.MINOR.PATCH [--dry-run|--verify]";

function text(value) {
  if (value === undefined || value === null) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

export function parseCoreReleaseArgs(args) {
  if (args.length < 1 || args.length > 2) throw new Error(USAGE);
  const [version, option] = args;
  if (!STABLE_SEMVER_TAG.test(version)) {
    throw new Error(`Core release tag must be exact stable SemVer: ${version}`);
  }
  if (option !== undefined && option !== "--dry-run" && option !== "--verify") {
    throw new Error(USAGE);
  }
  return Object.freeze({
    version,
    mode: option === "--dry-run" ? "dry-run" : option === "--verify" ? "verify" : "publish",
  });
}

function defaultRun(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : "pipe",
  });
}

function runChecked(run, command, args, options = {}) {
  const result = run(command, args, options);
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    const detail = text(result?.stderr).trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail === "" ? "" : `: ${detail}`}`);
  }
  return text(result.stdout).trim();
}

function assertRepository(root, run, { requireClean }) {
  const actualRoot = realpathSync(
    runChecked(run, "git", ["rev-parse", "--show-toplevel"], { cwd: root }),
  );
  if (actualRoot !== root) throw new Error("Core release must run from the Takoform repository root");

  const moduleLine = readFileSync(resolve(root, "go.mod"), "utf8")
    .split(/\r?\n/u)
    .find((line) => line.startsWith("module "));
  if (moduleLine !== `module ${CORE_RELEASE.module}`) {
    throw new Error(`go.mod must declare ${CORE_RELEASE.module}`);
  }

  const origin = runChecked(run, "git", ["remote", "get-url", "origin"], { cwd: root });
  if (!CORE_RELEASE.origins.includes(origin)) {
    throw new Error(`origin must be ${CORE_RELEASE.githubRepository}; received ${origin}`);
  }

  if (requireClean) {
    const status = runChecked(
      run,
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      { cwd: root },
    );
    if (status !== "") throw new Error("Core release requires a clean worktree");
  }

  const commit = runChecked(run, "git", ["rev-parse", "HEAD"], { cwd: root });
  if (!COMMIT.test(commit)) throw new Error("Core release HEAD is not an exact Git commit");
  return commit;
}

async function defaultRequest(path) {
  const response = await fetch(`${CORE_RELEASE.githubApi}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "takoform-core-release-readback",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
  });
  return { status: response.status, body: await response.text() };
}

function releasePath(version) {
  return `/repos/${CORE_RELEASE.githubRepository}/releases/tags/${encodeURIComponent(version)}`;
}

function readPublicTag({ root, version, run }) {
  const refs = runChecked(
    run,
    "git",
    [
      "ls-remote",
      "--tags",
      CORE_RELEASE.publicOrigin,
      `refs/tags/${version}`,
      `refs/tags/${version}^{}`,
    ],
    { cwd: root },
  );
  return refs === "" ? null : parseTagReadback(refs, version);
}

async function assertReleaseMissing({ version, request }) {
  const response = await request(releasePath(version));
  if (response.status === 200) {
    throw new Error(`GitHub Release ${version} already exists; releases are never overwritten`);
  }
  if (response.status !== 404) {
    throw new Error(`public GitHub Release absence readback failed with HTTP ${response.status}`);
  }
}

function parseTagReadback(raw, version) {
  const refs = new Map();
  for (const line of raw.split("\n").filter(Boolean)) {
    const match = /^([0-9a-f]{40})\t(.+)$/u.exec(line);
    if (!match) throw new Error(`public Git tag ${version} readback is malformed`);
    refs.set(match[2], match[1]);
  }
  const base = refs.get(`refs/tags/${version}`);
  if (!base) throw new Error(`public Git tag ${version} does not exist`);
  for (const name of refs.keys()) {
    if (name !== `refs/tags/${version}` && name !== `refs/tags/${version}^{}`) {
      throw new Error(`public Git tag ${version} readback returned an unexpected ref`);
    }
  }
  return refs.get(`refs/tags/${version}^{}`) ?? base;
}

function parseReleaseReadback(raw, version) {
  let release;
  try {
    release = JSON.parse(raw);
  } catch {
    throw new Error(`public GitHub Release ${version} readback is not JSON`);
  }
  if (
    release === null ||
    typeof release !== "object" ||
    Array.isArray(release) ||
    release.tag_name !== version ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.html_url !== "string" ||
    !release.html_url.startsWith(`https://github.com/${CORE_RELEASE.githubRepository}/releases/tag/`) ||
    typeof release.tarball_url !== "string" ||
    !release.tarball_url.startsWith(`${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/tarball/`) ||
    typeof release.zipball_url !== "string" ||
    !release.zipball_url.startsWith(`${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/zipball/`)
  ) {
    throw new Error(`public GitHub Release ${version} readback is not one stable source release`);
  }
  return release;
}

export async function verifyCoreRelease(version, options = {}) {
  if (!STABLE_SEMVER_TAG.test(version)) {
    throw new Error(`Core release tag must be exact stable SemVer: ${version}`);
  }
  const root = realpathSync(options.root ?? ROOT);
  const run = options.run ?? defaultRun;
  const request = options.request ?? defaultRequest;
  assertRepository(root, run, { requireClean: false });

  const tagCommit = readPublicTag({ root, version, run });
  if (tagCommit === null) throw new Error(`public Git tag ${version} does not exist`);
  const response = await request(releasePath(version));
  if (response.status !== 200) {
    throw new Error(`public GitHub Release ${version} readback failed with HTTP ${response.status}`);
  }
  const release = parseReleaseReadback(response.body, version);
  if (options.expectedCommit !== undefined && tagCommit !== options.expectedCommit) {
    throw new Error(`public Git tag ${version} does not point to the released commit`);
  }
  return Object.freeze({
    mode: "verify",
    version,
    tagCommit,
    releaseURL: release.html_url,
    sourceTarballURL: release.tarball_url,
    sourceZipballURL: release.zipball_url,
  });
}

export async function runCoreRelease(parsed, options = {}) {
  const root = realpathSync(options.root ?? ROOT);
  const run = options.run ?? defaultRun;
  const request = options.request ?? defaultRequest;

  if (parsed.mode === "verify") {
    return verifyCoreRelease(parsed.version, { root, run, request });
  }

  const commit = assertRepository(root, run, { requireClean: true });
  const initialTag = readPublicTag({ root, version: parsed.version, run });
  if (initialTag !== null && initialTag !== commit) {
    throw new Error(`Core tag ${parsed.version} already names another commit; releases are never overwritten`);
  }
  await assertReleaseMissing({ version: parsed.version, request });
  runChecked(run, "bun", ["run", "check"], { cwd: root, inherit: true });

  if (parsed.mode === "dry-run") {
    return Object.freeze({
      mode: "dry-run",
      version: parsed.version,
      commit,
      tag: initialTag === null ? "missing" : "existing-exact",
      ready: true,
    });
  }

  // Re-read both public names after the gate. The create operation has no
  // update/delete counterpart here, so a concurrent or previous release is a
  // hard refusal rather than an overwrite path.
  await assertReleaseMissing({ version: parsed.version, request });
  let tagCommit = readPublicTag({ root, version: parsed.version, run });
  if (tagCommit === null) {
    runChecked(
      run,
      "git",
      ["push", "origin", `${commit}:refs/tags/${parsed.version}`],
      { cwd: root, inherit: true },
    );
    tagCommit = readPublicTag({ root, version: parsed.version, run });
  }
  if (tagCommit !== commit) {
    throw new Error(`public Git tag ${parsed.version} does not point to the released commit`);
  }
  runChecked(
    run,
    "gh",
    [
      "release",
      "create",
      parsed.version,
      "--repo",
      CORE_RELEASE.githubRepository,
      "--title",
      `Takoform Core ${parsed.version}`,
      "--generate-notes",
      "--verify-tag",
    ],
    { cwd: root, inherit: true },
  );
  return verifyCoreRelease(parsed.version, { root, run, request, expectedCommit: commit });
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const result = await runCoreRelease(parseCoreReleaseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Core release refused: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
