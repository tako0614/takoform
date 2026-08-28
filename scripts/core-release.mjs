#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
// This entrypoint owns the current v1 major of the Core Go module. It does not
// version the Host API: the wire identity remains forms.takoform.com/v1, and a
// Core v1.1.0 artifact never implies a Host API v1.1 lane.
const CURRENT_CORE_MODULE_TAG = /^v1\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const USAGE = "usage: bun run deploy -- core v1.MINOR.PATCH [--dry-run|--verify]";
const PUBLIC_CONSUMER_TEST = `package consumer

import (
	"testing"

	"github.com/tako0614/takoform/formpackage"
	"github.com/tako0614/takoform/hostclient"
	"github.com/tako0614/takoform/snapshot"
	"github.com/tako0614/takoform/trust"
)

func TestPublicCorePackages(t *testing.T) {
	digest := formpackage.DigestBytes([]byte("takoform-release-consumer"))
	if !formpackage.ValidDigest(digest) {
		t.Fatalf("formpackage returned invalid digest %q", digest)
	}
	if err := hostclient.ValidateSpaceID("release-consumer"); err != nil {
		t.Fatalf("hostclient rejected portable SpaceID: %v", err)
	}
	compiled, diagnostics := snapshot.Compile(snapshot.Input{HostAPI: "forms.takoform.com/v1"})
	if compiled == nil || len(diagnostics) != 0 {
		t.Fatalf("snapshot rejected zero-family API v1 input: %#v", diagnostics)
	}
	_ = trust.PublisherPolicy{}
}
`;

function text(value) {
  if (value === undefined || value === null) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

export function parseCoreReleaseArgs(args) {
  if (args.length < 1 || args.length > 2) throw new Error(USAGE);
  const [version, option] = args;
  if (!CURRENT_CORE_MODULE_TAG.test(version)) {
    throw new Error(`Core module release tag must be exact stable SemVer on its current v1 line: ${version}`);
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
    env: options.env ?? process.env,
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

function publicGitEnvironment() {
  const env = { ...process.env };
  for (const key of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GIT_ASKPASS",
    "GIT_CONFIG_PARAMETERS",
    "GIT_SSH_COMMAND",
    "GIT_SSH_VARIANT",
    "SSH_ASKPASS",
    "SSH_AUTH_SOCK",
  ]) {
    delete env[key];
  }
  return {
    ...env,
    GCM_INTERACTIVE: "never",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function runPublicGit(run, args) {
  return runChecked(run, "git", args, {
    cwd: tmpdir(),
    env: publicGitEnvironment(),
  });
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

function verifyPublicGoModule({ version, run }) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "takoform-release-consumer-"));
  const consumerRoot = join(temporaryRoot, "consumer");
  let primaryError;
  try {
    mkdirSync(consumerRoot);
    writeFileSync(
      join(consumerRoot, "go.mod"),
      `module takoform.release/consumer\n\ngo 1.25.8\n\nrequire ${CORE_RELEASE.module} ${version}\n`,
      "utf8",
    );
    writeFileSync(join(consumerRoot, "consumer_test.go"), PUBLIC_CONSUMER_TEST, "utf8");
    const env = {
      ...process.env,
      GOCACHE: join(temporaryRoot, "gocache"),
      GOFLAGS: "",
      GOINSECURE: "",
      GOMODCACHE: join(temporaryRoot, "gomodcache"),
      GONOPROXY: "none",
      GONOSUMDB: "",
      GOPATH: join(temporaryRoot, "gopath"),
      GOPRIVATE: "",
      GOPROXY: "https://proxy.golang.org,direct",
      GOSUMDB: "sum.golang.org",
      GOTOOLCHAIN: "local",
      GOVCS: "public:git,private:off",
      GOWORK: "off",
      GCM_INTERACTIVE: "never",
      GIT_CONFIG_COUNT: "0",
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    const expected = `${CORE_RELEASE.module}@${version}`;
    runChecked(run, "go", ["mod", "tidy"], {
      cwd: consumerRoot,
      env,
      inherit: true,
    });
    const resolved = runChecked(
      run,
      "go",
      ["list", "-m", "-f", "{{.Path}}@{{.Version}}", CORE_RELEASE.module],
      { cwd: consumerRoot, env },
    );
    if (resolved !== expected) {
      throw new Error(`fresh public consumer resolved ${resolved || "nothing"}; want ${expected}`);
    }
    runChecked(run, "go", ["test", "./..."], {
      cwd: consumerRoot,
      env,
      inherit: true,
    });
    return expected;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      rmSync(temporaryRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      if (primaryError === undefined) throw cleanupError;
      process.stderr.write(
        `fresh consumer cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}\n`,
      );
    }
  }
}

function readPublicTag({ version, run }) {
  const refs = runPublicGit(
    run,
    [
      "ls-remote",
      "--tags",
      CORE_RELEASE.publicOrigin,
      `refs/tags/${version}`,
      `refs/tags/${version}^{}`,
    ],
  );
  return refs === "" ? null : parseTagReadback(refs, version);
}

function readPublicMain(run) {
  const raw = runPublicGit(run, [
    "ls-remote",
    "--heads",
    CORE_RELEASE.publicOrigin,
    "refs/heads/main",
  ]);
  const match = /^([0-9a-f]{40})\trefs\/heads\/main$/u.exec(raw);
  if (!match) {
    throw new Error("credential-free public refs/heads/main readback is missing or malformed");
  }
  return match[1];
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
    release.name !== `Takoform Core ${version}` ||
    release.draft !== false ||
    release.prerelease !== false ||
    typeof release.html_url !== "string" ||
    !release.html_url.startsWith(`https://github.com/${CORE_RELEASE.githubRepository}/releases/tag/`) ||
    typeof release.tarball_url !== "string" ||
    !release.tarball_url.startsWith(`${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/tarball/`) ||
    typeof release.zipball_url !== "string" ||
    !release.zipball_url.startsWith(`${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/zipball/`)
  ) {
    throw new Error(`public GitHub Release ${version} readback is not one stable Core source release`);
  }
  return release;
}

export async function verifyCoreRelease(version, options = {}) {
  if (!CURRENT_CORE_MODULE_TAG.test(version)) {
    throw new Error(`Core module release tag must be exact stable SemVer on its current v1 line: ${version}`);
  }
  const root = realpathSync(options.root ?? ROOT);
  const run = options.run ?? defaultRun;
  const request = options.request ?? defaultRequest;
  assertRepository(root, run, { requireClean: false });
  const { expectedCommit } = options;
  if (expectedCommit !== undefined && !COMMIT.test(expectedCommit)) {
    throw new Error("Core release verification requires one exact expected Git commit");
  }

  const tagCommit = readPublicTag({ version, run });
  if (tagCommit === null) throw new Error(`public Git tag ${version} does not exist`);
  if (expectedCommit !== undefined && tagCommit !== expectedCommit) {
    throw new Error(
      `public Git tag ${version} does not point to expected commit ${expectedCommit}`,
    );
  }
  const response = await request(releasePath(version));
  if (response.status !== 200) {
    throw new Error(`public GitHub Release ${version} readback failed with HTTP ${response.status}`);
  }
  const release = parseReleaseReadback(response.body, version);
  const goModule = verifyPublicGoModule({ version, run });
  return Object.freeze({
    mode: "verify",
    version,
    ...(expectedCommit === undefined ? {} : { expectedCommit }),
    tagCommit,
    goModule,
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
  const publicMainCommit = readPublicMain(run);
  const publicMainMatchesHead = publicMainCommit === commit;
  if (parsed.mode === "publish" && !publicMainMatchesHead) {
    throw new Error(
      `Core publish HEAD ${commit} must already equal credential-free public refs/heads/main ${publicMainCommit}`,
    );
  }
  const initialTag = readPublicTag({ version: parsed.version, run });
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
      publicMainCommit,
      publicMainMatchesHead,
      tag: initialTag === null ? "missing" : "existing-exact",
      gatePassed: true,
      publishReady: publicMainMatchesHead,
    });
  }

  // Re-read both public names after the gate. The create operation has no
  // update/delete counterpart here, so a concurrent or previous release is a
  // hard refusal rather than an overwrite path.
  const confirmedPublicMainCommit = readPublicMain(run);
  if (confirmedPublicMainCommit !== commit) {
    throw new Error(
      `credential-free public refs/heads/main changed after the owner gate: received ${confirmedPublicMainCommit}; want ${commit}`,
    );
  }
  await assertReleaseMissing({ version: parsed.version, request });
  let tagCommit = readPublicTag({ version: parsed.version, run });
  if (tagCommit === null) {
    runChecked(
      run,
      "git",
      ["push", "origin", `${commit}:refs/tags/${parsed.version}`],
      { cwd: root, inherit: true },
    );
    tagCommit = readPublicTag({ version: parsed.version, run });
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
