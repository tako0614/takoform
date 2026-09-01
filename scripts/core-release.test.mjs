import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import {
  CORE_RELEASE,
  CORE_RELEASE_PHASES,
  CORE_RELEASE_REVIEW,
  assertImmutableReleaseRepository,
  assertCoreReleasePhaseAuthority,
  auditCoreRelease as auditCoreReleaseImplementation,
  canonicalJSON,
  coreTagCreateOnlyPushSpec,
  coreTagMessage,
  createCoreReleaseReceipt,
  createCoreTagAnnotation,
  normalizeCoreReleaseReceipt,
  normalizeCoreTagRuleset,
  normalizeQualificationReport,
  normalizeStoredRulesetAudit,
  normalizeTagBundleDocument,
  parseCoreTagAllowedSigner,
  parseCoreReleaseArgs,
  prepareCoreRelease as prepareCoreReleaseImplementation,
  publishCoreRelease as publishCoreReleaseImplementation,
  publishForwardOnly,
  readQualificationArtifact,
  readRecordPushArtifact,
  readRulesetAuditArtifact,
  readTagBundleArtifact,
  recordPrepareCoreRelease as recordPrepareCoreReleaseImplementation,
  recordPushCoreRelease as recordPushCoreReleaseImplementation,
  releaseBody,
  runProcess,
  sha256,
  signCoreReleaseTag as signCoreReleaseTagImplementation,
  validateCoreReleaseRuntime,
  verifyGoProxyReadbackResults,
  verifyPublishedCoreRelease as verifyPublishedCoreReleaseImplementation,
} from "./core-release.mjs";

const TEST_NODE_RUNTIME = "/usr/local/bin/node";
const TEST_NODE_VERSION = execFileSync(TEST_NODE_RUNTIME, ["--version"], {
  encoding: "utf8",
}).trim();

function withTestNodeRuntime(dependencies = {}) {
  return {
    ...dependencies,
    runtimePath: TEST_NODE_RUNTIME,
    runtimeVersion: TEST_NODE_VERSION,
  };
}

const prepareCoreRelease = (input, dependencies) =>
  prepareCoreReleaseImplementation(input, withTestNodeRuntime(dependencies));
const auditCoreRelease = (input, dependencies) =>
  auditCoreReleaseImplementation(input, withTestNodeRuntime(dependencies));
const signCoreReleaseTag = (input, dependencies) =>
  signCoreReleaseTagImplementation(input, withTestNodeRuntime(dependencies));
const publishCoreRelease = (input, dependencies) =>
  publishCoreReleaseImplementation(input, withTestNodeRuntime(dependencies));
const recordPrepareCoreRelease = (input, dependencies) =>
  recordPrepareCoreReleaseImplementation(input, withTestNodeRuntime(dependencies));
const recordPushCoreRelease = (input, dependencies) =>
  recordPushCoreReleaseImplementation(input, withTestNodeRuntime(dependencies));
const verifyPublishedCoreRelease = (input, dependencies) =>
  verifyPublishedCoreReleaseImplementation(input, withTestNodeRuntime(dependencies));

const temporary = [];

afterEach(() => {
  while (temporary.length > 0) {
    rmSync(temporary.pop(), { recursive: true, force: true });
  }
});

function temp(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

function recordRepositoryInventory(repository) {
  const inventory = [];
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const status = lstatSync(path);
      if (status.isDirectory()) {
        inventory.push({
          path: relativePath,
          type: "directory",
          mode: status.mode & 0o777,
        });
        walk(path, relativePath);
      } else {
        const raw = readFileSync(path);
        inventory.push({
          path: relativePath,
          type: "file",
          mode: status.mode & 0o777,
          bytes: raw.length,
          sha256: sha256(raw),
        });
      }
    }
  };
  walk(repository);
  return inventory;
}

function rewriteRecordManifest(output, mutate = () => {}) {
  const path = join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  mutate(manifest);
  manifest.repositoryInventory = recordRepositoryInventory(
    join(output, manifest.repositoryDirectory),
  );
  writeFileSync(path, canonicalJSON(manifest));
  return manifest;
}

function git(cwd, args, options = {}) {
  return execFileSync("/usr/bin/git", args, {
    cwd,
    env: {
      PATH: "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      ...options.env,
    },
    input: options.input,
    encoding: "utf8",
  }).trim();
}

function procAuthorityCanary(canary, { passthrough = false } = {}) {
  return [
    "#!/bin/sh",
    "found=0",
    "for environment in /proc/[0-9]*/environ; do",
    "  /usr/bin/tr '\\000' '\\n' < \"$environment\" 2>/dev/null | /usr/bin/grep -q 'parent-secret' && found=1",
    "done",
    `printf 'executed proc-secret=%s\\n' \"$found\" > ${JSON.stringify(canary)}`,
    ...(passthrough ? ["/usr/bin/cat"] : []),
    "exit 0",
    "",
  ].join("\n");
}

function baseLedger() {
  return {
    kind: "takoform.core-releases@v1",
    candidate: {
      version: CORE_RELEASE.version,
      title: CORE_RELEASE.title,
      module: CORE_RELEASE.module,
      commands: ["form-package", "generic-conformance", "takoform-trust"],
      distribution: "go-module",
      apiV2Effect: "none",
      status: "candidate",
    },
    releases: [],
  };
}

function writeSourceFiles(repository) {
  mkdirSync(join(repository, "release", "authority"), { recursive: true });
  writeFileSync(
    join(repository, CORE_RELEASE.ledger),
    `${JSON.stringify(baseLedger(), null, 2)}\n`,
  );
  writeFileSync(
    join(repository, CORE_RELEASE.tagAllowedSigners),
    [
      `# fingerprint ${CORE_RELEASE.tagSignerFingerprint}`,
      "takoform-core-release namespaces=\"git\" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPCvfYukIC7Jlny4FZ5QLAqdp4lvskqR/bh5+OFCkdPB",
      "",
    ].join("\n"),
  );
  writeFileSync(join(repository, "go.mod"), `${`module ${CORE_RELEASE.module}`}\n\ngo 1.25.8\n`);
  writeFileSync(join(repository, "package.json"), '{"private":true}\n');
  writeFileSync(join(repository, "bun.lock"), "fixture\n");
  writeFileSync(join(repository, "tracked.txt"), "clean\n");
}

function createRepository({ detached = false, attributes, gitignore } = {}) {
  const root = temp("takoform-core-test-");
  const repository = join(root, "source");
  const origin = join(root, "origin.git");
  mkdirSync(repository);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "Test"]);
  git(repository, ["config", "user.email", "test@example.invalid"]);
  writeSourceFiles(repository);
  if (attributes !== undefined) {
    writeFileSync(join(repository, ".gitattributes"), attributes);
  }
  if (gitignore !== undefined) {
    writeFileSync(join(repository, ".gitignore"), gitignore);
  }
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "source S"]);
  const commit = git(repository, ["rev-parse", "HEAD"]);
  git(root, ["clone", "--bare", repository, origin]);
  git(repository, ["remote", "add", "origin", origin]);
  if (detached) git(repository, ["checkout", "--detach", commit]);
  return { root, repository, origin, commit };
}

function toolEvidence(path = "/usr/bin/tool") {
  return {
    path,
    sha256: `sha256:${"1".repeat(64)}`,
    versionProbe: { arguments: ["--version"], status: 0, output: "tool 1" },
  };
}

function nodeRuntimeEvidence() {
  return {
    path: TEST_NODE_RUNTIME,
    sha256: `sha256:${"0".repeat(64)}`,
    versionProbe: {
      arguments: ["process.version"],
      status: 0,
      output: TEST_NODE_VERSION,
    },
  };
}

function qualificationFixture(commit) {
  const builds = [];
  for (const target of CORE_RELEASE.targets) {
    for (const command of CORE_RELEASE.commands) {
      builds.push({
        command: command.name,
        target: `${target.os}/${target.arch}`,
        bytes: 123,
        sha256: `sha256:${"2".repeat(64)}`,
        goVersionMetadataSha256: `sha256:${"3".repeat(64)}`,
      });
    }
  }
  const versions = CORE_RELEASE.commands.map(({ name }) => ({
    command: name,
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    commit,
  }));
  const run = {
    label: "primary",
    lifecycle: ["bun install --frozen-lockfile", "bun run check"],
    builds,
    versionOutputs: versions,
  };
  return {
    format: "takoform.core-qualification@v2",
    repository: CORE_RELEASE.repository,
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sourceCommit: commit,
    sourceTree: "a".repeat(40),
    commands: CORE_RELEASE.commands.map(({ name }) => name),
    targets: CORE_RELEASE.targets.map(({ os, arch }) => `${os}/${arch}`),
    tools: {
      node: nodeRuntimeEvidence(),
      git: toolEvidence("/usr/bin/git"),
      bun: toolEvidence("/usr/bin/bun"),
      go: toolEvidence("/usr/bin/go"),
    },
    runs: [run, { ...structuredClone(run), label: "witness" }],
    reproducible: true,
  };
}

function rawRuleset(id = 71) {
  return {
    id,
    target: "tag",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: [`refs/tags/${CORE_RELEASE.version}`],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "update" },
    ],
  };
}

function auditFixture(id = 71) {
  return normalizeCoreTagRuleset(rawRuleset(id), id);
}

function writePrivateArtifact(directory, name, value) {
  const path = join(directory, name);
  writeFileSync(path, canonicalJSON(value), { mode: 0o600 });
  return path;
}

function reviewFixture(commit, qualificationDigest, rulesetAuditDigest) {
  return {
    format: CORE_RELEASE_REVIEW.format,
    approved: true,
    sourceCommit: commit,
    qualificationDigest,
    rulesetAuditDigest,
    reviewer: "independent-reviewer",
    reviewedAt: "2026-08-27T00:00:00.000Z",
    reviewed: [...CORE_RELEASE_REVIEW.reviewed],
  };
}

function tagRaw(commit, annotation) {
  return Buffer.from(
    [
      `object ${commit}`,
      "type commit",
      `tag ${CORE_RELEASE.version}`,
      "tagger Test <test@example.invalid> 1700000000 +0000",
    ].join("\n") +
      `\n\n${coreTagMessage(annotation)}` +
      "-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n",
  );
}

function objectID(type, raw) {
  return createHash("sha1")
    .update(`${type} ${raw.length}\0`)
    .update(raw)
    .digest("hex");
}

function tagBundleFixture(commit, qualificationDigest, reviewDigest, audit) {
  const auditDigest = sha256(Buffer.from(canonicalJSON(audit)));
  const annotation = createCoreTagAnnotation({
    expectedCommit: commit,
    qualificationDigest,
    reviewDigest,
    rulesetAuditDigest: auditDigest,
    rulesetAudit: audit,
  });
  const raw = tagRaw(commit, annotation);
  const object = objectID("tag", raw);
  return {
    format: "takoform.core-tag-bundle@v2",
    repository: CORE_RELEASE.repository,
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sourceCommit: commit,
    tag: CORE_RELEASE.version,
    tagObject: object,
    tagObjectSha256: sha256(raw),
    tagObjectBase64: raw.toString("base64"),
    annotation,
    qualificationDigest,
    independentReviewDigest: reviewDigest,
    rulesetAuditDigest: auditDigest,
    tools: {
      node: nodeRuntimeEvidence(),
      git: toolEvidence("/usr/bin/git"),
      sshKeygen: toolEvidence("/usr/bin/ssh-keygen"),
    },
  };
}

const moduleSum = `h1:${"A".repeat(43)}=`;
const goModSum = `h1:${"B".repeat(43)}=`;

function goEvidence(commit) {
  return {
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sum: moduleSum,
    goModSum,
    sumdb: "sum.golang.org",
    origin: {
      vcs: "git",
      url: CORE_RELEASE.repository,
      hash: commit,
      ref: `refs/tags/${CORE_RELEASE.version}`,
    },
    installs: CORE_RELEASE.commands.map(({ name }) => ({
      target: `${CORE_RELEASE.module}/cmd/${name}@${CORE_RELEASE.version}`,
      versionOutput: {
        command: name,
        module: CORE_RELEASE.module,
        version: CORE_RELEASE.version,
        sum: moduleSum,
      },
    })),
  };
}

function releaseFixture(commit, bundle, id = 41) {
  return {
    id,
    tag_name: CORE_RELEASE.version,
    target_commitish: commit,
    name: CORE_RELEASE.title,
    body: releaseBody(commit, bundle.tagObject, bundle.rulesetAuditDigest),
    draft: false,
    prerelease: false,
    immutable: true,
    assets: [],
    html_url: `${CORE_RELEASE.repository}/releases/tag/${CORE_RELEASE.version}`,
  };
}

function tagEvidence(bundle) {
  return {
    object: bundle.tagObject,
    objectSha256: bundle.tagObjectSha256,
    annotation: bundle.annotation,
  };
}

describe("seven-phase contract and authority bootstrap", () => {
  test("pins the asset-free Go module identity and exactly seven phases", () => {
    expect(CORE_RELEASE.version).toBe("v0.1.0");
    expect(CORE_RELEASE.module).toBe("github.com/tako0614/takoform");
    expect(CORE_RELEASE.commands.map(({ name }) => name)).toEqual([
      "form-package",
      "generic-conformance",
      "takoform-trust",
    ]);
    expect(CORE_RELEASE_PHASES).toEqual([
      "prepare",
      "audit",
      "sign-tag",
      "publish",
      "record-prepare",
      "record-push",
      "verify",
    ]);
  });

  test("pins and measures the exact owning Node runtime and rejects wrong or mutable Node", () => {
    const evidence = validateCoreReleaseRuntime({
      runtimePath: TEST_NODE_RUNTIME,
      expectedPath: TEST_NODE_RUNTIME,
      runtimeVersion: TEST_NODE_VERSION,
    });
    expect(evidence.path).toBe(TEST_NODE_RUNTIME);
    expect(evidence.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidence.versionProbe).toEqual({
      arguments: ["process.version"],
      status: 0,
      output: TEST_NODE_VERSION,
    });
    expect(() =>
      validateCoreReleaseRuntime({
        runtimePath: "/usr/bin/node",
        expectedPath: TEST_NODE_RUNTIME,
        runtimeVersion: TEST_NODE_VERSION,
      }),
    ).toThrow(/owning deploy parent must be exact \/usr\/local\/bin\/node/);

    const mutableNode = join(temp("takoform-mutable-node-"), "node");
    writeFileSync(mutableNode, "synthetic Node runtime\n", { mode: 0o700 });
    validateCoreReleaseRuntime({
      runtimePath: mutableNode,
      expectedPath: mutableNode,
      runtimeVersion: "v1.2.3",
    });
    chmodSync(mutableNode, 0o722);
    expect(() =>
      validateCoreReleaseRuntime({
        runtimePath: mutableNode,
        expectedPath: mutableNode,
        runtimeVersion: "v1.2.3",
      }),
    ).toThrow(/non-group\/world-writable/);
  });

  test("wrong owning Node causes zero runner and network execution", async () => {
    let runnerCalls = 0;
    let networkCalls = 0;
    await expect(
      auditCoreReleaseImplementation(
        {
          expectedCommit: "1".repeat(40),
          rulesetId: 71,
          output: "/tmp/core-ruleset-audit.json",
        },
        {
          repo: "/tmp",
          env: { GH_TOKEN: "parent-secret" },
          runtimePath: "/usr/bin/node",
          runtimeVersion: TEST_NODE_VERSION,
          runner() {
            runnerCalls += 1;
            throw new Error("runner must not execute");
          },
          async githubRequest() {
            networkCalls += 1;
            throw new Error("network must not execute");
          },
        },
      ),
    ).rejects.toThrow(/owning deploy parent must be exact \/usr\/local\/bin\/node/);
    expect(runnerCalls).toBe(0);
    expect(networkCalls).toBe(0);
  });

  test("parses only exact phase-specific options", () => {
    const commit = "1".repeat(40);
    expect(
      parseCoreReleaseArgs([
        "publish",
        "--expected-commit",
        commit,
        "--qualification",
        "/tmp/q",
        "--ruleset-audit",
        "/tmp/a",
        "--review-record",
        "/tmp/r",
        "--tag-bundle",
        "/tmp/t",
        "--mode",
        "recover",
      ]),
    ).toEqual({
      phase: "publish",
      expectedCommit: commit,
      qualification: "/tmp/q",
      rulesetAudit: "/tmp/a",
      reviewRecord: "/tmp/r",
      tagBundle: "/tmp/t",
      mode: "recover",
    });
    expect(
      parseCoreReleaseArgs(["record-push", "--artifact", "/tmp/push"]),
    ).toEqual({ phase: "record-push", artifact: "/tmp/push" });
    for (const invalid of [
      ["seal", "--expected-commit", commit],
      ["recover", "--expected-commit", commit],
      ["publish", "--expected-commit", commit],
      ["record-push", "--artifact", "relative"],
    ]) {
      expect(() => parseCoreReleaseArgs(invalid)).toThrow();
    }
  });

  test("permits one credential class and rejects every representative off-phase authority", () => {
    expect(() => assertCoreReleasePhaseAuthority("audit", { GH_TOKEN: "x" })).not.toThrow();
    expect(() =>
      assertCoreReleasePhaseAuthority("sign-tag", {
        TAKOFORM_CORE_TAG_SIGNING_KEY: "/private/key",
      }),
    ).not.toThrow();
    expect(() =>
      assertCoreReleasePhaseAuthority("record-push", {
        TAKOFORM_CORE_REF_WRITE_TOKEN: "x",
      }),
    ).not.toThrow();
    for (const [phase, env] of [
      ["prepare", { GH_TOKEN: "x" }],
      ["audit", { GH_TOKEN: "x", SSH_AUTH_SOCK: "/agent" }],
      ["sign-tag", { TAKOFORM_CORE_TAG_SIGNING_KEY: "/k", GH_TOKEN: "x" }],
      ["publish", { GH_TOKEN: "x", CLOUDFLARE_API_TOKEN: "cf" }],
      ["record-prepare", { NODE_AUTH_TOKEN: "npm" }],
      ["record-push", { TAKOFORM_CORE_REF_WRITE_TOKEN: "x", GPG_TTY: "tty" }],
      ["verify", { TAKOFORM_SCHEMA_ORIGIN_TOKEN: "x" }],
    ]) {
      expect(() => assertCoreReleasePhaseAuthority(phase, env)).toThrow("forbidden");
    }
  });

  test("off-phase authority causes zero runner and network execution", async () => {
    let runnerCalls = 0;
    let networkCalls = 0;
    const runner = () => {
      runnerCalls += 1;
      throw new Error("runner must not execute");
    };
    const githubRequest = async () => {
      networkCalls += 1;
      throw new Error("network must not execute");
    };
    const commit = "1".repeat(40);
    const cases = [
      () =>
        prepareCoreRelease(
          { expectedCommit: commit, output: "/tmp/q" },
          { repo: "/tmp", env: { GH_TOKEN: "wrong" }, runner },
        ),
      () =>
        auditCoreRelease(
          { expectedCommit: commit, rulesetId: 1, output: "/tmp/a" },
          {
            repo: "/tmp",
            env: { GH_TOKEN: "ok", SSH_AUTH_SOCK: "/wrong" },
            runner,
            githubRequest,
          },
        ),
      () =>
        signCoreReleaseTag(
          {
            expectedCommit: commit,
            qualification: "/tmp/q",
            rulesetAudit: "/tmp/a",
            reviewRecord: "/tmp/r",
            output: "/tmp/t",
          },
          {
            repo: "/tmp",
            env: {
              TAKOFORM_CORE_TAG_SIGNING_KEY: "/tmp/key",
              GH_TOKEN: "wrong",
            },
            runner,
          },
        ),
      () =>
        publishCoreRelease(
          {
            expectedCommit: commit,
            qualification: "/tmp/q",
            rulesetAudit: "/tmp/a",
            reviewRecord: "/tmp/r",
            tagBundle: "/tmp/t",
            mode: "forward",
          },
          {
            repo: "/tmp",
            env: { GH_TOKEN: "ok", CLOUDFLARE_API_TOKEN: "wrong" },
            runner,
            githubRequest,
          },
        ),
      () =>
        recordPrepareCoreRelease(
          { expectedCommit: commit, output: "/tmp/p" },
          { repo: "/tmp", env: { NPM_TOKEN: "wrong" }, runner, githubRequest },
        ),
      () =>
        recordPushCoreRelease(
          { artifact: "/tmp/p" },
          {
            repo: "/tmp",
            env: {
              TAKOFORM_CORE_REF_WRITE_TOKEN: "ok",
              GH_TOKEN: "wrong",
            },
            runner,
          },
        ),
      () =>
        verifyPublishedCoreRelease(
          { expectedCommit: commit, receiptCommit: "2".repeat(40) },
          {
            repo: "/tmp",
            env: { TAKOFORM_SCHEMA_ORIGIN_TOKEN: "wrong" },
            runner,
            githubRequest,
          },
        ),
    ];
    for (const invoke of cases) {
      try {
        await invoke();
        throw new Error("expected authority rejection");
      } catch (error) {
        expect(error.message).toMatch(/forbidden/);
      }
    }
    expect(runnerCalls).toBe(0);
    expect(networkCalls).toBe(0);
    expect(() =>
      prepareCoreRelease(
        {},
        { repo: "not-absolute", env: { GH_TOKEN: "wrong" }, runner },
      ),
    ).toThrow(/GH_TOKEN is forbidden/);
    expect(() =>
      recordPushCoreRelease(
        {},
        {
          repo: "not-absolute",
          env: {
            TAKOFORM_CORE_REF_WRITE_TOKEN: "ok",
            GH_TOKEN: "wrong",
          },
          runner,
        },
      ),
    ).toThrow(/GH_TOKEN is forbidden/);
    expect(runnerCalls).toBe(0);
  });

  test("audit rejects executable local Git config before any Git child can run it", async () => {
    const source = createRepository({ detached: true });
    const canary = join(source.root, "fsmonitor-executed");
    const monitor = join(source.root, "fsmonitor.sh");
    writeFileSync(
      monitor,
      procAuthorityCanary(canary),
      { mode: 0o700 },
    );
    git(source.repository, ["config", "core.fsmonitor", monitor]);
    await expect(
      auditCoreRelease(
        {
          expectedCommit: source.commit,
          rulesetId: 71,
          output: join(source.root, "audit.json"),
        },
        {
          repo: source.repository,
          env: { GH_TOKEN: "credential-must-stay-in-parent" },
          tools: { git: "/usr/bin/git" },
          githubRequest: async () => {
            throw new Error("network must not execute");
          },
        },
      ),
    ).rejects.toThrow(/unsafe local Git config/);
    expect(existsSync(canary)).toBe(false);
  });

  test("credentialed source closure rejects every hidden index flag before Git or network", async () => {
    for (const [label, configure] of [
      ["assume-unchanged", (source) => {
        git(source.repository, ["update-index", "--assume-unchanged", "tracked.txt"]);
      }],
      ["skip-worktree", (source) => {
        git(source.repository, ["update-index", "--skip-worktree", "tracked.txt"]);
      }],
      ["intent-to-add", (source) => {
        writeFileSync(join(source.repository, "intent.txt"), "intent\n");
        git(source.repository, ["add", "--intent-to-add", "intent.txt"]);
      }],
    ]) {
      const source = createRepository({ detached: true });
      configure(source);
      let runnerCalls = 0;
      let networkCalls = 0;
      await expect(
        auditCoreRelease(
          {
            expectedCommit: source.commit,
            rulesetId: 71,
            output: join(source.root, `${label}.json`),
          },
          {
            repo: source.repository,
            env: { GH_TOKEN: "parent-secret" },
            tools: { git: "/usr/bin/git" },
            runner() {
              runnerCalls += 1;
              throw new Error("Git must not execute");
            },
            async githubRequest() {
              networkCalls += 1;
              throw new Error("network must not execute");
            },
          },
        ),
      ).rejects.toThrow(new RegExp(`index.*${label}`, "i"));
      expect(runnerCalls).toBe(0);
      expect(networkCalls).toBe(0);
    }
  });

  test("a hidden substituted authority key fails before signer, Git, or network", () => {
    const source = createRepository({ detached: true });
    const algorithm = Buffer.from("ssh-ed25519");
    const substitutedKey = Buffer.concat([
      Buffer.from([0, 0, 0, algorithm.length]),
      algorithm,
      Buffer.from([0, 0, 0, 32]),
      Buffer.alloc(32, 0x42),
    ]).toString("base64");
    const substitutedAuthority = [
      `# fingerprint ${CORE_RELEASE.tagSignerFingerprint}`,
      `${CORE_RELEASE.tagSignerPrincipal} namespaces="git" ssh-ed25519 ${substitutedKey}`,
      "",
    ].join("\n");
    expect(() => parseCoreTagAllowedSigner(Buffer.from(substitutedAuthority))).toThrow(
      /computed public-key fingerprint differs from the pin/,
    );
    git(source.repository, [
      "update-index",
      "--skip-worktree",
      CORE_RELEASE.tagAllowedSigners,
    ]);
    writeFileSync(
      join(source.repository, CORE_RELEASE.tagAllowedSigners),
      substitutedAuthority,
    );
    let runnerCalls = 0;
    expect(() =>
      signCoreReleaseTag(
        {
          expectedCommit: source.commit,
          qualification: join(source.root, "qualification.json"),
          rulesetAudit: join(source.root, "audit.json"),
          reviewRecord: join(source.root, "review.json"),
          output: join(source.root, "tag.json"),
        },
        {
          repo: source.repository,
          env: { TAKOFORM_CORE_TAG_SIGNING_KEY: join(source.root, "key") },
          tools: { git: "/usr/bin/git", sshKeygen: "/usr/bin/ssh-keygen" },
          runner() {
            runnerCalls += 1;
            throw new Error("signer or Git must not execute");
          },
        },
      ),
    ).toThrow(/index.*skip-worktree/i);
    expect(runnerCalls).toBe(0);
  });

  test("audit rejects executable semantics in source-S tracked attributes before Git", async () => {
    const source = createRepository({
      detached: true,
      attributes: "tracked.txt filter=credential-leak diff=credential-leak\n",
    });
    await expect(
      auditCoreRelease(
        {
          expectedCommit: source.commit,
          rulesetId: 71,
          output: join(source.root, "audit.json"),
        },
        {
          repo: source.repository,
          env: { GH_TOKEN: "credential-must-stay-in-parent" },
          tools: { git: "/usr/bin/git" },
          githubRequest: async () => {
            throw new Error("network must not execute");
          },
        },
      ),
    ).rejects.toThrow(/tracked \.gitattributes.*executable semantics/);
  });

  test("credentialed phases reject a real filter driver before it can inspect parent authority", async () => {
    const source = createRepository({
      detached: true,
      attributes: "tracked.txt filter=credential-leak\n",
    });
    const canary = join(source.root, "filter-executed");
    const filter = join(source.root, "filter.sh");
    writeFileSync(
      filter,
      procAuthorityCanary(canary, { passthrough: true }),
      { mode: 0o700 },
    );
    git(source.repository, ["config", "filter.credential-leak.clean", filter]);
    await expect(
      auditCoreRelease(
        {
          expectedCommit: source.commit,
          rulesetId: 71,
          output: join(source.root, "A.json"),
        },
        {
          repo: source.repository,
          env: { GH_TOKEN: "parent-secret" },
          tools: { git: "/usr/bin/git" },
          githubRequest: async () => {
            throw new Error("network must not execute");
          },
        },
      ),
    ).rejects.toThrow(/unsafe local Git config/);
    expect(existsSync(canary)).toBe(false);
  });

  test("explicit hooksPath and optional-lock fences keep a real checkout hook inert", async () => {
    const source = createRepository({ detached: true });
    const canary = join(source.root, "hook-executed");
    const hook = join(source.repository, ".git", "hooks", "post-index-change");
    writeFileSync(
      hook,
      procAuthorityCanary(canary),
      { mode: 0o700 },
    );
    const result = await auditCoreRelease(
      {
        expectedCommit: source.commit,
        rulesetId: 71,
        output: join(source.root, "A.json"),
      },
      {
        repo: source.repository,
        env: { GH_TOKEN: "parent-secret" },
        tools: { git: "/usr/bin/git" },
        githubRequest: async () => ({ status: 200, document: rawRuleset() }),
      },
    );
    expect(result.status).toBe("audited");
    expect(existsSync(canary)).toBe(false);
  });

  test("sign and publish reject local Git execution config before artifact or network work", async () => {
    const source = createRepository({ detached: true });
    const canary = join(source.root, "credentialed-git-executed");
    const monitor = join(source.root, "credentialed-monitor.sh");
    writeFileSync(
      monitor,
      procAuthorityCanary(canary),
      { mode: 0o700 },
    );
    git(source.repository, ["config", "core.fsmonitor", monitor]);
    expect(() =>
      signCoreReleaseTag(
        {
          expectedCommit: source.commit,
          qualification: join(source.root, "missing-q"),
          rulesetAudit: join(source.root, "missing-a"),
          reviewRecord: join(source.root, "missing-r"),
          output: join(source.root, "tag.json"),
        },
        {
          repo: source.repository,
          env: { TAKOFORM_CORE_TAG_SIGNING_KEY: join(source.root, "missing-key") },
          tools: { git: "/usr/bin/git", sshKeygen: "/usr/bin/ssh-keygen" },
        },
      ),
    ).toThrow(/unsafe local Git config/);
    await expect(
      publishCoreRelease(
        {
          expectedCommit: source.commit,
          qualification: join(source.root, "missing-q"),
          rulesetAudit: join(source.root, "missing-a"),
          reviewRecord: join(source.root, "missing-r"),
          tagBundle: join(source.root, "missing-t"),
          mode: "recover",
        },
        {
          repo: source.repository,
          env: { GH_TOKEN: "parent-secret" },
          tools: { git: "/usr/bin/git", sshKeygen: "/usr/bin/ssh-keygen" },
          githubRequest: async () => {
            throw new Error("network must not execute");
          },
        },
      ),
    ).rejects.toThrow(/unsafe local Git config/);
    expect(existsSync(canary)).toBe(false);
  });
});

describe("prepare qualification report", () => {
  function fakeTools(
    root,
    commit,
    {
      dirty = false,
      ignoredPath,
      nodeModules = false,
      nodeModulesDirty = false,
      nodeModulesEscape = false,
      gitMetadataDirty = false,
    } = {},
  ) {
    const bin = join(root, "tools");
    mkdirSync(bin);
    const bun = join(bin, "bun");
    writeFileSync(
      bun,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "1.3.14"; exit 0; fi',
        ...(dirty
          ? ['if [ "$1" = "install" ]; then printf "dirty\\n" >> tracked.txt; fi']
          : []),
        ...(ignoredPath === undefined
          ? []
          : [
              `if [ "$1" = "install" ]; then mkdir -p $(dirname ${JSON.stringify(ignoredPath)}); printf "ignored\\n" > ${JSON.stringify(ignoredPath)}; fi`,
            ]),
        ...(nodeModules || nodeModulesDirty || nodeModulesEscape
          ? [
              'if [ "$1" = "install" ]; then mkdir -p node_modules/fixture; printf "sealed\\n" > node_modules/fixture/value; fi',
            ]
          : []),
        ...(nodeModulesEscape
          ? [
              'if [ "$1" = "install" ]; then printf "outside\\n" > ../outside-node-module; ln -s ../../../outside-node-module node_modules/fixture/escape; fi',
            ]
          : []),
        ...(nodeModulesDirty
          ? [
              'if [ "$1" = "run" ] && [ "$2" = "check" ]; then printf "mutated\\n" >> node_modules/fixture/value; fi',
            ]
          : []),
        ...(gitMetadataDirty
          ? [
              'if [ "$1" = "install" ]; then printf "drift\\n" > .git/lifecycle-drift; fi',
            ]
          : []),
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    const go = join(bin, "go");
    writeFileSync(
      go,
      [
        "#!/usr/bin/node",
        'const fs = require("fs");',
        'const path = require("path");',
        "const args = process.argv.slice(2);",
        'if (args[0] === "--version") { console.log("go version go1.26.7 linux/amd64"); process.exit(0); }',
        'if (args[0] === "env" && args[1] === "GOVERSION") { console.log("go1.26.7"); process.exit(0); }',
        'if (args[0] === "mod" && args[1] === "edit") { console.log(JSON.stringify({Replace: []})); process.exit(0); }',
        'if (args[0] === "version" && args[1] === "-m") { console.log("fixture go version metadata"); process.exit(0); }',
        'if (args[0] === "build") {',
        '  const output = args[args.indexOf("-o") + 1];',
        '  const command = path.basename(output).replace(/\\.exe$/, "");',
        `  const payload = JSON.stringify({command, module:${JSON.stringify(CORE_RELEASE.module)}, version:${JSON.stringify(CORE_RELEASE.version)}, commit:${JSON.stringify(commit)}});`,
        '  fs.writeFileSync(output, `#!/bin/sh\\nprintf \'%s\\n\' \'${payload}\'\\n`, {mode: 0o700});',
        "  process.exit(0);",
        "}",
        'console.error(`unexpected fake go: ${args.join(" ")}`);',
        "process.exit(2);",
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    return { git: "/usr/bin/git", bun, go };
  }

  test("actual prepare roundtrips one report and no archive or asset directory", () => {
    const source = createRepository();
    const output = join(source.root, "qualification.json");
    const tools = fakeTools(source.root, source.commit, { nodeModules: true });
    const result = prepareCoreRelease(
      { expectedCommit: source.commit, output },
      {
        repo: source.repository,
        env: { PATH: join(source.root, "malicious-path") },
        tools,
        origin: source.origin,
      },
    );
    expect(result.status).toBe("qualified");
    const artifact = readQualificationArtifact(output, source.commit);
    expect(artifact.digest).toBe(result.qualificationDigest);
    expect(artifact.document.runs).toHaveLength(2);
    expect(artifact.document.runs[0].builds).toHaveLength(18);
    expect(artifact.document.runs[0].versionOutputs).toHaveLength(3);
    expect(Object.keys(artifact.document.tools).sort()).toEqual([
      "bun",
      "git",
      "go",
      "node",
    ]);
    expect(artifact.document.tools.node).toMatchObject({
      path: TEST_NODE_RUNTIME,
      versionProbe: {
        arguments: ["process.version"],
        status: 0,
        output: TEST_NODE_VERSION,
      },
    });
    expect(Object.keys(artifact.document).join(" ")).not.toMatch(
      /archive|sbom|provenance|checksum|signature|asset/i,
    );
    expect(basename(output)).toBe("qualification.json");
  }, 30_000);

  test("prepare catches source lifecycle dirtiness at the post-command fence", () => {
    const source = createRepository();
    const tools = fakeTools(source.root, source.commit, { dirty: true });
    expect(() =>
      prepareCoreRelease(
        {
          expectedCommit: source.commit,
          output: join(source.root, "qualification.json"),
        },
        {
          repo: source.repository,
          env: {},
          tools,
          origin: source.origin,
        },
      ),
    ).toThrow(/not clean|differs from S/);
  });

  test("prepare rejects ignored content in the invoking canonical checkout", () => {
    const source = createRepository({ gitignore: "dist/\n" });
    mkdirSync(join(source.repository, "dist"));
    writeFileSync(join(source.repository, "dist", "ignored"), "hidden\n");
    expect(() =>
      prepareCoreRelease(
        { expectedCommit: source.commit, output: join(source.root, "qualification.json") },
        {
          repo: source.repository,
          env: {},
          tools: fakeTools(source.root, source.commit),
          origin: source.origin,
        },
      ),
    ).toThrow(/ignored or untracked path dist/);
  });

  test("prepare rejects ignored lifecycle output outside sealed node_modules", () => {
    const ignored = "dist/\n.release-tmp/\n.claude/\n*.tfstate\nnode_modules/\n";
    for (const [index, ignoredPath] of [
      "dist/hidden",
      ".release-tmp/hidden",
      ".claude/state",
      "terraform.tfstate",
    ].entries()) {
      const source = createRepository({ gitignore: ignored });
      expect(() =>
        prepareCoreRelease(
          {
            expectedCommit: source.commit,
            output: join(source.root, `qualification-${index}.json`),
          },
          {
            repo: source.repository,
            env: {},
            tools: fakeTools(source.root, source.commit, { ignoredPath }),
            origin: source.origin,
          },
        ),
      ).toThrow(/ignored or untracked path/);
    }
  }, 30_000);

  test("prepare seals node_modules before the owner gate", () => {
    const source = createRepository({ gitignore: "node_modules/\n" });
    expect(() =>
      prepareCoreRelease(
        { expectedCommit: source.commit, output: join(source.root, "qualification.json") },
        {
          repo: source.repository,
          env: {},
          tools: fakeTools(source.root, source.commit, { nodeModulesDirty: true }),
          origin: source.origin,
        },
      ),
    ).toThrow(/node_modules differs from its exact post-install seal/);
  });

  test("prepare rejects node_modules symlinks that escape the measured closure", () => {
    const source = createRepository({ gitignore: "node_modules/\n" });
    expect(() =>
      prepareCoreRelease(
        { expectedCommit: source.commit, output: join(source.root, "qualification.json") },
        {
          repo: source.repository,
          env: {},
          tools: fakeTools(source.root, source.commit, { nodeModulesEscape: true }),
          origin: source.origin,
        },
      ),
    ).toThrow(/symlink .* escapes its measured closure/);
  });

  test("prepare rejects lifecycle Git metadata drift", () => {
    const source = createRepository();
    expect(() =>
      prepareCoreRelease(
        { expectedCommit: source.commit, output: join(source.root, "qualification.json") },
        {
          repo: source.repository,
          env: {},
          tools: fakeTools(source.root, source.commit, { gitMetadataDirty: true }),
          origin: source.origin,
        },
      ),
    ).toThrow(/Git metadata drifted/);
  });

  test("qualification closure rejects one changed witness build", () => {
    const commit = "1".repeat(40);
    const report = qualificationFixture(commit);
    expect(normalizeQualificationReport(report, commit)).toEqual(report);
    report.runs[1].builds[0].sha256 = `sha256:${"9".repeat(64)}`;
    expect(() => normalizeQualificationReport(report, commit)).toThrow(
      /not reproducible/,
    );
  });

  test("qualification closure rejects non-owning Node evidence", () => {
    const commit = "1".repeat(40);
    const report = qualificationFixture(commit);
    report.tools.node.path = "/usr/bin/node";
    expect(() => normalizeQualificationReport(report, commit)).toThrow(
      /exact owning Node runtime evidence/,
    );
  });
});

describe("ruleset audit A", () => {
  test("requires bypass_actors to be observable and normalizes a closed A", () => {
    const audit = normalizeCoreTagRuleset(rawRuleset(), 71);
    expect(audit.format).toBe("takoform.core-ruleset-audit@v3");
    expect(audit.rules).toEqual([{ type: "deletion" }, { type: "update" }]);
    expect(audit.bypassActors).toEqual([]);
    expect(audit.apiVersion).toBe(CORE_RELEASE.githubApiVersion);
    expect(normalizeStoredRulesetAudit(audit, 71)).toEqual(audit);
    const omitted = rawRuleset();
    delete omitted.bypass_actors;
    expect(() => normalizeCoreTagRuleset(omitted, 71)).toThrow(
      /mutation-capable repository credential/,
    );
  });

  test("requires the live update rule to be the exact type-only tag rule", () => {
    const branchOnlyParameter = rawRuleset();
    branchOnlyParameter.rules[1].parameters = {
      update_allows_fetch_and_merge: false,
    };
    expect(() => normalizeCoreTagRuleset(branchOnlyParameter, 71)).toThrow(
      /exactly deletion and update/u,
    );

    const unknownUpdateField = rawRuleset();
    unknownUpdateField.rules[1].unexpected = false;
    expect(() => normalizeCoreTagRuleset(unknownUpdateField, 71)).toThrow(
      /exactly deletion and update/u,
    );

    const legacyAudit = auditFixture();
    legacyAudit.format = "takoform.core-ruleset-audit@v2";
    expect(() => normalizeStoredRulesetAudit(legacyAudit, 71)).toThrow(
      /exact closed A artifact/u,
    );
  });

  test("audit performs one authenticated exact GET and roundtrips the filesystem artifact", async () => {
    const source = createRepository({ detached: true });
    const output = join(source.root, "A.json");
    const requests = [];
    const result = await auditCoreRelease(
      { expectedCommit: source.commit, rulesetId: 71, output },
      {
        repo: source.repository,
        env: { GH_TOKEN: "mutation-capable-audit-token", PATH: "/evil" },
        tools: { git: "/usr/bin/git" },
        githubRequest: async (request) => {
          requests.push(request);
          return { status: 200, document: rawRuleset() };
        },
      },
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "GET",
      path: "repos/tako0614/takoform/rulesets/71",
      token: "mutation-capable-audit-token",
      authenticated: true,
    });
    expect(result.toolEvidence.node).toMatchObject({
      path: TEST_NODE_RUNTIME,
      versionProbe: {
        arguments: ["process.version"],
        status: 0,
        output: TEST_NODE_VERSION,
      },
    });
    const artifact = readRulesetAuditArtifact(output, 71);
    expect(artifact.digest).toBe(result.rulesetAuditDigest);
    expect(readFileSync(output, "utf8")).toBe(canonicalJSON(artifact.document));
  });
});

describe("SSH-signed tag bundle and full A binding", () => {
  test("canonical tag object roundtrips and any A tamper breaks the bundle", () => {
    const commit = "1".repeat(40);
    const qualificationDigest = `sha256:${"4".repeat(64)}`;
    const reviewDigest = `sha256:${"5".repeat(64)}`;
    const bundle = tagBundleFixture(
      commit,
      qualificationDigest,
      reviewDigest,
      auditFixture(),
    );
    const normalized = normalizeTagBundleDocument(bundle, commit);
    expect(normalized.document).toEqual(bundle);
    expect(normalized.annotation.rulesetAudit.bypassActors).toEqual([]);
    const directory = temp("takoform-tag-bundle-");
    const path = writePrivateArtifact(directory, "tag.json", bundle);
    expect(readTagBundleArtifact(path, commit).document).toEqual(bundle);

    const changed = structuredClone(bundle);
    changed.annotation.rulesetAudit.enforcement = "disabled";
    expect(() => normalizeTagBundleDocument(changed, commit)).toThrow();

    const changedRaw = Buffer.from(bundle.tagObjectBase64, "base64");
    changedRaw[20] ^= 1;
    const bytesChanged = {
      ...bundle,
      tagObjectBase64: changedRaw.toString("base64"),
    };
    expect(() => normalizeTagBundleDocument(bytesChanged, commit)).toThrow(
      /bytes or digests/,
    );
  });

  test("tag publication source is the exact object id with a width-derived zero lease", () => {
    const object = "a".repeat(40);
    expect(coreTagCreateOnlyPushSpec(object)).toEqual({
      lease: `--force-with-lease=refs/tags/${CORE_RELEASE.version}:${"0".repeat(40)}`,
      refspec: `${object}:refs/tags/${CORE_RELEASE.version}`,
    });
    expect(coreTagCreateOnlyPushSpec("b".repeat(64)).lease).toEndWith(
      "0".repeat(64),
    );
  });

  test("sign-tag validates real filesystem inputs and emits one closed bundle", () => {
    const source = createRepository({ detached: true });
    const directory = source.root;
    const qualification = qualificationFixture(source.commit);
    const qualificationPath = writePrivateArtifact(
      directory,
      "qualification.json",
      qualification,
    );
    const qualificationDigest = sha256(Buffer.from(canonicalJSON(qualification)));
    const audit = auditFixture();
    const auditPath = writePrivateArtifact(directory, "audit.json", audit);
    const auditDigest = sha256(Buffer.from(canonicalJSON(audit)));
    const review = reviewFixture(source.commit, qualificationDigest, auditDigest);
    const reviewPath = writePrivateArtifact(directory, "review.json", review);
    const reviewDigest = sha256(Buffer.from(canonicalJSON(review)));
    const expected = tagBundleFixture(
      source.commit,
      qualificationDigest,
      reviewDigest,
      audit,
    );
    const raw = Buffer.from(expected.tagObjectBase64, "base64");
    const privateKey = join(directory, "tag-key");
    writeFileSync(privateKey, "test-private-key\n", { mode: 0o600 });
    const output = join(directory, "signed-tag.json");
    const actualGit = resolve("/usr/bin/git");
    const actualSSH = resolve("/usr/bin/ssh-keygen");
    const runner = (command, args, options = {}) => {
      if (command === actualSSH && args[0] === "-y") {
        return {
          status: 0,
          stdout:
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPCvfYukIC7Jlny4FZ5QLAqdp4lvskqR/bh5+OFCkdPB\n",
          stderr: "",
        };
      }
      if (command === actualSSH && args.includes("-lf")) {
        return {
          status: 0,
          stdout: `256 ${CORE_RELEASE.tagSignerFingerprint} test (ED25519)\n`,
          stderr: "",
        };
      }
      if (command === actualGit && args.includes("tag") && args.includes("--sign")) {
        return { status: 0, stdout: "", stderr: "" };
      }
      if (
        command === actualGit &&
        args.includes("rev-parse") &&
        args.includes(`refs/tags/${CORE_RELEASE.version}`)
      ) {
        return { status: 0, stdout: `${expected.tagObject}\n`, stderr: "" };
      }
      if (
        command === actualGit &&
        args.includes("cat-file") &&
        args.includes(expected.tagObject)
      ) {
        return { status: 0, stdout: raw.toString("utf8"), stderr: "" };
      }
      if (command === actualGit && args.includes("verify-tag")) {
        return { status: 0, stdout: "Good signature\n", stderr: "" };
      }
      return runProcess(command, args, options);
    };
    const result = signCoreReleaseTag(
      {
        expectedCommit: source.commit,
        qualification: qualificationPath,
        rulesetAudit: auditPath,
        reviewRecord: reviewPath,
        output,
      },
      {
        repo: source.repository,
        env: { TAKOFORM_CORE_TAG_SIGNING_KEY: privateKey },
        runner,
        tools: { git: actualGit, sshKeygen: actualSSH },
      },
    );
    expect(result.tagObject).toBe(expected.tagObject);
    const artifact = readTagBundleArtifact(output, source.commit);
    expect(artifact.document.annotation).toEqual(expected.annotation);
    expect(Object.keys(artifact.document.tools).sort()).toEqual([
      "git",
      "node",
      "sshKeygen",
    ]);
    expect(artifact.document.tools.node.path).toBe(TEST_NODE_RUNTIME);
    expect(Object.keys(artifact.document).sort()).toEqual(
      Object.keys(expected).sort(),
    );
  });

  test("sign-tag detects a same-digest rename swap immediately before signing", () => {
    const source = createRepository({ detached: true });
    const qualification = qualificationFixture(source.commit);
    const qualificationPath = writePrivateArtifact(
      source.root,
      "qualification.json",
      qualification,
    );
    const audit = auditFixture();
    const auditPath = writePrivateArtifact(source.root, "audit.json", audit);
    const review = reviewFixture(
      source.commit,
      sha256(Buffer.from(canonicalJSON(qualification))),
      sha256(Buffer.from(canonicalJSON(audit))),
    );
    const reviewPath = writePrivateArtifact(source.root, "review.json", review);
    const privateKey = join(source.root, "tag-key");
    writeFileSync(privateKey, "test-private-key\n", { mode: 0o600 });
    const actualSSH = resolve("/usr/bin/ssh-keygen");
    let swapped = false;
    let signingExecuted = false;
    const runner = (command, args, options = {}) => {
      if (command === actualSSH && args[0] === "-y") {
        renameSync(qualificationPath, `${qualificationPath}.old`);
        writeFileSync(qualificationPath, canonicalJSON(qualification), { mode: 0o600 });
        swapped = true;
        return {
          status: 0,
          stdout:
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPCvfYukIC7Jlny4FZ5QLAqdp4lvskqR/bh5+OFCkdPB\n",
          stderr: "",
        };
      }
      if (command === actualSSH && args.includes("-lf")) {
        return {
          status: 0,
          stdout: `256 ${CORE_RELEASE.tagSignerFingerprint} test (ED25519)\n`,
          stderr: "",
        };
      }
      if (args.includes("tag") && args.includes("--sign")) signingExecuted = true;
      return runProcess(command, args, options);
    };
    expect(() =>
      signCoreReleaseTag(
        {
          expectedCommit: source.commit,
          qualification: qualificationPath,
          rulesetAudit: auditPath,
          reviewRecord: reviewPath,
          output: join(source.root, "signed-tag.json"),
        },
        {
          repo: source.repository,
          env: { TAKOFORM_CORE_TAG_SIGNING_KEY: privateKey },
          runner,
          tools: { git: "/usr/bin/git", sshKeygen: actualSSH },
        },
      ),
    ).toThrow(/changed or was replaced/);
    expect(swapped).toBe(true);
    expect(signingExecuted).toBe(false);
  });
});

describe("operator-private artifact custody", () => {
  test("rejects a shared writable parent before accepting a qualification artifact", () => {
    const directory = temp("takoform-shared-custody-");
    const path = writePrivateArtifact(
      directory,
      "qualification.json",
      qualificationFixture("1".repeat(40)),
    );
    chmodSync(directory, 0o777);
    expect(() => readQualificationArtifact(path, "1".repeat(40))).toThrow(
      /private 0700-class directory/,
    );

    const protectedRoot = temp("takoform-ancestor-custody-");
    const shared = join(protectedRoot, "shared");
    const task = join(shared, "task");
    mkdirSync(shared, { mode: 0o777 });
    chmodSync(shared, 0o777);
    mkdirSync(task, { mode: 0o700 });
    const nested = writePrivateArtifact(
      task,
      "qualification.json",
      qualificationFixture("1".repeat(40)),
    );
    expect(() => readQualificationArtifact(nested, "1".repeat(40))).toThrow(
      /shared non-sticky writable ancestor/,
    );
  });

  test("rejects foreign-owned and multiply-linked private files", () => {
    const foreignDirectory = temp("takoform-foreign-custody-");
    const foreignPath = writePrivateArtifact(
      foreignDirectory,
      "qualification.json",
      qualificationFixture("1".repeat(40)),
    );
    chownSync(foreignPath, 65534, 65534);
    expect(() => readQualificationArtifact(foreignPath, "1".repeat(40))).toThrow(
      /release-owned/,
    );

    const linkedDirectory = temp("takoform-linked-custody-");
    const linkedPath = writePrivateArtifact(
      linkedDirectory,
      "qualification.json",
      qualificationFixture("1".repeat(40)),
    );
    linkSync(linkedPath, join(linkedDirectory, "second-link.json"));
    expect(() => readQualificationArtifact(linkedPath, "1".repeat(40))).toThrow(
      /release-owned.*regular file/,
    );
  });
});

describe("forward-only publication and recover mode", () => {
  function publisher({ initialTag = "absent", initialRelease = "absent" } = {}) {
    const commit = "1".repeat(40);
    const audit = auditFixture();
    const bundle = tagBundleFixture(
      commit,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      audit,
    );
    const release = releaseFixture(commit, bundle);
    const trace = [];
    let tagState = initialTag;
    let releaseState = initialRelease;
    const operations = {
      async assertCanonicalMain(value) {
        trace.push(["assertCanonicalMain", value]);
        return "2".repeat(40); // descendant main is explicitly allowed
      },
      async assertImmutableReleases() {
        trace.push(["assertImmutableReleases"]);
      },
      async inspectTag() {
        trace.push(["inspectTag"]);
        return tagState === "exact"
          ? { status: "exact", object: bundle.tagObject, commit }
          : { status: "absent" };
      },
      async inspectRelease() {
        trace.push(["inspectRelease"]);
        return releaseState === "exact"
          ? { status: "exact", release }
          : { status: "absent" };
      },
      async installTagObject() {
        trace.push(["installTagObject", bundle.tagObject]);
      },
      async auditRuleset() {
        trace.push(["auditRuleset"]);
        return audit;
      },
      async pushTag() {
        trace.push(["pushTag", `${bundle.tagObject}:refs/tags/${CORE_RELEASE.version}`]);
        tagState = "exact";
        return { status: 0, stdout: "ok", stderr: "" };
      },
      async createRelease() {
        trace.push(["createRelease"]);
        releaseState = "exact";
        return release;
      },
      async readPublicRelease() {
        trace.push(["readPublicRelease"]);
        return releaseState === "exact"
          ? { status: "exact", release }
          : { status: "absent" };
      },
    };
    return { commit, audit, bundle, release, trace, operations };
  }

  test("final A fences are immediately adjacent to exact tag push and sole Release create", async () => {
    const fixture = publisher();
    const result = await publishForwardOnly(
      {
        mode: "forward",
        expectedCommit: fixture.commit,
        bundle: fixture.bundle,
        storedAudit: fixture.audit,
      },
      fixture.operations,
    );
    expect(result).toMatchObject({
      status: "published",
      tagObject: fixture.bundle.tagObject,
      releaseId: 41,
      currentBypassStateClaimed: false,
    });
    const names = fixture.trace.map(([name]) => name);
    const push = names.indexOf("pushTag");
    const post = names.indexOf("createRelease");
    expect(names[push - 1]).toBe("auditRuleset");
    expect(names[post - 1]).toBe("auditRuleset");
    expect(names.filter((name) => name === "createRelease")).toHaveLength(1);
    expect(fixture.trace[push][1]).toBe(
      `${fixture.bundle.tagObject}:refs/tags/${CORE_RELEASE.version}`,
    );
  });

  test("publish re-reads every private artifact after final A and blocks a rename swap", async () => {
    const source = createRepository({ detached: true });
    const qualification = qualificationFixture(source.commit);
    const qualificationPath = writePrivateArtifact(
      source.root,
      "qualification.json",
      qualification,
    );
    const audit = auditFixture();
    const auditPath = writePrivateArtifact(source.root, "audit.json", audit);
    const review = reviewFixture(
      source.commit,
      sha256(Buffer.from(canonicalJSON(qualification))),
      sha256(Buffer.from(canonicalJSON(audit))),
    );
    const reviewPath = writePrivateArtifact(source.root, "review.json", review);
    const bundle = tagBundleFixture(
      source.commit,
      sha256(Buffer.from(canonicalJSON(qualification))),
      sha256(Buffer.from(canonicalJSON(review))),
      audit,
    );
    const tagPath = writePrivateArtifact(source.root, "tag.json", bundle);
    let swapped = false;
    let pushed = false;
    const operations = {
      async assertCanonicalMain() {},
      async assertImmutableReleases() {},
      async inspectTag() {
        return { status: "absent" };
      },
      async inspectRelease() {
        return { status: "absent" };
      },
      async installTagObject() {},
      async auditRuleset() {
        if (!swapped) {
          renameSync(qualificationPath, `${qualificationPath}.old`);
          writeFileSync(qualificationPath, canonicalJSON(qualification), {
            mode: 0o600,
          });
          swapped = true;
        }
        return audit;
      },
      async pushTag() {
        pushed = true;
        return { status: 0, stdout: "ok", stderr: "" };
      },
      async createRelease() {
        throw new Error("Release must not execute");
      },
      async readPublicRelease() {
        return { status: "absent" };
      },
    };
    await expect(
      publishCoreRelease(
        {
          expectedCommit: source.commit,
          qualification: qualificationPath,
          rulesetAudit: auditPath,
          reviewRecord: reviewPath,
          tagBundle: tagPath,
          mode: "forward",
        },
        {
          repo: source.repository,
          env: { GH_TOKEN: "parent-secret" },
          tools: { git: "/usr/bin/git", sshKeygen: "/usr/bin/ssh-keygen" },
          operations,
          runner(command, args, options) {
            if (args.includes("verify-tag")) {
              return { status: 0, stdout: "Good signature\n", stderr: "" };
            }
            return runProcess(command, args, options);
          },
        },
      ),
    ).rejects.toThrow(/changed or was replaced/);
    expect(swapped).toBe(true);
    expect(pushed).toBe(false);
  });

  test("recover adopts complete state without mutation", async () => {
    const fixture = publisher({ initialTag: "exact", initialRelease: "exact" });
    const result = await publishForwardOnly(
      {
        mode: "recover",
        expectedCommit: fixture.commit,
        bundle: fixture.bundle,
        storedAudit: fixture.audit,
      },
      fixture.operations,
    );
    expect(result.externalStateTouched).toBe(false);
    expect(fixture.trace.some(([name]) => name === "pushTag")).toBe(false);
    expect(fixture.trace.some(([name]) => name === "createRelease")).toBe(false);
  });

  test("recover creates only a missing Release after an exact tag", async () => {
    const fixture = publisher({ initialTag: "exact" });
    const result = await publishForwardOnly(
      {
        mode: "recover",
        expectedCommit: fixture.commit,
        bundle: fixture.bundle,
        storedAudit: fixture.audit,
      },
      fixture.operations,
    );
    expect(result.status).toBe("published");
    expect(fixture.trace.some(([name]) => name === "pushTag")).toBe(false);
    expect(fixture.trace.filter(([name]) => name === "createRelease")).toHaveLength(1);
  });

  test("forward rejects preexisting state and recover rejects Release-without-tag", async () => {
    const preexisting = publisher({ initialTag: "exact" });
    await expect(
      publishForwardOnly(
        {
          mode: "forward",
          expectedCommit: preexisting.commit,
          bundle: preexisting.bundle,
          storedAudit: preexisting.audit,
        },
        preexisting.operations,
      ),
    ).rejects.toThrow(/recover mode/);

    const invalid = publisher({ initialRelease: "exact" });
    await expect(
      publishForwardOnly(
        {
          mode: "recover",
          expectedCommit: invalid.commit,
          bundle: invalid.bundle,
          storedAudit: invalid.audit,
        },
        invalid.operations,
      ),
    ).rejects.toThrow(/without the exact protected signed tag/);
  });

  test("a final A mismatch blocks both mutation boundaries", async () => {
    const fixture = publisher();
    let count = 0;
    fixture.operations.auditRuleset = async () => {
      fixture.trace.push(["auditRuleset"]);
      count += 1;
      return count === 1
        ? { ...fixture.audit, enforcement: "disabled" }
        : fixture.audit;
    };
    await expect(
      publishForwardOnly(
        {
          mode: "forward",
          expectedCommit: fixture.commit,
          bundle: fixture.bundle,
          storedAudit: fixture.audit,
        },
        fixture.operations,
      ),
    ).rejects.toThrow(/byte-equal/);
    expect(fixture.trace.some(([name]) => name === "pushTag")).toBe(false);
    expect(fixture.trace.some(([name]) => name === "createRelease")).toBe(false);
  });

  test("public wording is historical and explicitly makes no current hidden-bypass claim", () => {
    const fixture = publisher();
    const body = releaseBody(
      fixture.commit,
      fixture.bundle.tagObject,
      fixture.bundle.rulesetAuditDigest,
    );
    expect(body).toContain("publication-time ruleset");
    expect(body).toContain("does not claim");
    expect(body).not.toContain("current bypass actors are empty");
  });

  test("uses the authenticated immutable-releases endpoint and its real enabled shape", async () => {
    const requests = [];
    await assertImmutableReleaseRepository(async (request) => {
      requests.push(request);
      return {
        status: 200,
        document: { enabled: true, enforced_by_owner: false },
      };
    }, "github-token");
    expect(requests).toEqual([
      {
        method: "GET",
        path: "repos/tako0614/takoform/immutable-releases",
        token: "github-token",
        authenticated: true,
      },
    ]);
    await expect(
      assertImmutableReleaseRepository(
        async () => ({
          status: 200,
          document: { immutable_releases_enabled: true },
        }),
        "github-token",
      ),
    ).rejects.toThrow(/does not report immutable Releases enabled/);
  });
});

describe("Go authority and truthful receipt v2", () => {
  test("requires proxy/direct Sum and GoModSum equality plus exact Origin hash/ref", () => {
    const commit = "1".repeat(40);
    const common = {
      Path: CORE_RELEASE.module,
      Version: CORE_RELEASE.version,
      Sum: moduleSum,
      GoModSum: goModSum,
    };
    const direct = {
      ...common,
      Origin: {
        VCS: "git",
        URL: CORE_RELEASE.repository,
        Hash: commit,
        Ref: `refs/tags/${CORE_RELEASE.version}`,
      },
    };
    expect(
      verifyGoProxyReadbackResults({
        proxyResult: common,
        directResult: direct,
        expectedCommit: commit,
      }),
    ).toMatchObject({ sum: moduleSum, goModSum, sumdb: "sum.golang.org" });
    expect(() =>
      verifyGoProxyReadbackResults({
        proxyResult: common,
        directResult: {
          ...direct,
          Origin: { ...direct.Origin, Hash: "2".repeat(40) },
        },
        expectedCommit: commit,
      }),
    ).toThrow(/Origin/);
  });

  test("receipt binds all three installed binaries' command/module/version/sum output", () => {
    const commit = "1".repeat(40);
    const bundle = tagBundleFixture(
      commit,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      auditFixture(),
    );
    const receipt = createCoreReleaseReceipt({
      expectedCommit: commit,
      tagEvidence: tagEvidence(bundle),
      release: releaseFixture(commit, bundle),
      go: goEvidence(commit),
    });
    expect(receipt.format).toBe("takoform.core-release-receipt@v2");
    expect(receipt.go.installs.map(({ versionOutput }) => versionOutput)).toEqual(
      CORE_RELEASE.commands.map(({ name }) => ({
        command: name,
        module: CORE_RELEASE.module,
        version: CORE_RELEASE.version,
        sum: moduleSum,
      })),
    );
    expect(receipt.tag.annotation.rulesetAudit.bypassActors).toEqual([]);
    const changed = structuredClone(receipt);
    changed.go.installs[0].versionOutput.sum = goModSum;
    expect(() => normalizeCoreReleaseReceipt(changed, commit)).toThrow(
      /version output/,
    );
  });
});

describe("record prepare, record push, and verify", () => {
  async function prepareRecordArtifact() {
    const source = createRepository({ detached: true });
    const audit = auditFixture();
    const bundle = tagBundleFixture(
      source.commit,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      audit,
    );
    const evidence = tagEvidence(bundle);
    const release = releaseFixture(source.commit, bundle);
    const go = goEvidence(source.commit);
    const output = join(source.root, "record-push");
    const operationTrace = [];
    const result = await recordPrepareCoreRelease(
      { expectedCommit: source.commit, output },
      {
        repo: source.repository,
        env: {},
        tools: {
          git: "/usr/bin/git",
          sshKeygen: "/usr/bin/ssh-keygen",
          go: "/usr/bin/go",
        },
        cloneOrigin: source.origin,
        now: () => new Date("2026-08-27T00:00:00.000Z"),
        operations: {
          readTag() {
            operationTrace.push("readTag");
            return evidence;
          },
          readRelease() {
            operationTrace.push("readRelease");
            return release;
          },
          verifyGo() {
            operationTrace.push("verifyGo");
            return go;
          },
        },
      },
    );
    return { source, audit, bundle, evidence, release, go, output, result, operationTrace };
  }

  test("record-prepare is credentialless and roundtrips a closed one-path P-to-R artifact", async () => {
    const fixture = await prepareRecordArtifact();
    expect(fixture.operationTrace).toEqual(["readTag", "readRelease", "verifyGo"]);
    expect(fixture.result.status).toBe("receipt-artifact-prepared");
    expect(fixture.result.parentCommit).toBe(fixture.source.commit);
    expect(fixture.result.receiptCommit).toMatch(/^[0-9a-f]{40}$/);
    const artifact = readRecordPushArtifact(fixture.output, {
      repo: fixture.source.repository,
      env: {},
      runner: runProcess,
      tools: { git: resolve("/usr/bin/git") },
    });
    expect(artifact.manifest.receiptCommit).toBe(fixture.result.receiptCommit);
    expect(artifact.manifest.receipt.go.installs).toHaveLength(3);
    expect(artifact.manifest.ref).toBe("refs/heads/main");
    expect(artifact.manifest.format).toBe(
      "takoform.core-record-push-artifact@v3",
    );
    expect(artifact.manifest.artifactRoot).toEqual({
      ownerUid: lstatSync(fixture.output).uid,
      mode: 0o700,
    });
    expect(Object.keys(artifact.manifest.tools).sort()).toEqual([
      "git",
      "go",
      "node",
      "sshKeygen",
    ]);
    expect(artifact.manifest.tools.node.path).toBe(TEST_NODE_RUNTIME);
  }, 30_000);

  test("record artifact inventory rejects a post-prepare extra file", async () => {
    const fixture = await prepareRecordArtifact();
    writeFileSync(join(fixture.output, "repository.git", "extra"), "tamper");
    expect(() => readRecordPushArtifact(fixture.output)).toThrow(
      /inventory changed/,
    );
  }, 30_000);

  test("record artifact rejects a manifest-consistent Git config that could redirect the ref token", async () => {
    const fixture = await prepareRecordArtifact();
    const configPath = join(fixture.output, "repository.git", "config");
    const malicious = Buffer.from(
      `${readFileSync(configPath, "utf8")}\n[url \"https://attacker.invalid/\"]\n\tinsteadOf = https://github.com/\n`,
    );
    writeFileSync(configPath, malicious);
    const manifestPath = join(fixture.output, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const configEntry = manifest.repositoryInventory.find(
      ({ path }) => path === "config",
    );
    configEntry.bytes = malicious.length;
    configEntry.sha256 = sha256(malicious);
    writeFileSync(manifestPath, canonicalJSON(manifest));
    expect(() => readRecordPushArtifact(fixture.output)).toThrow(
      /fixed non-extensible config/,
    );
  }, 30_000);

  test("record-push rejects a manifest-consistent real commit-graph before token or Git execution", async () => {
    const fixture = await prepareRecordArtifact();
    const repository = join(fixture.output, "repository.git");
    git(fixture.source.root, [
      "--git-dir",
      repository,
      "commit-graph",
      "write",
      "--reachable",
    ]);
    rewriteRecordManifest(fixture.output);
    let runnerCalls = 0;
    expect(() =>
      recordPushCoreRelease(
        { artifact: fixture.output },
        {
          repo: fixture.source.repository,
          env: { TAKOFORM_CORE_REF_WRITE_TOKEN: "must-remain-unused" },
          runner() {
            runnerCalls += 1;
            throw new Error("Git must not execute");
          },
          tools: { git: "/usr/bin/git" },
        },
      ),
    ).toThrow(/forbidden Git metadata.*commit-graph/);
    expect(runnerCalls).toBe(0);
  }, 30_000);

  test("record-push rehashes raw R and rejects a manifest-consistent wrong parent before CAS", async () => {
    const fixture = await prepareRecordArtifact();
    const repository = join(fixture.output, "repository.git");
    const manifest = JSON.parse(
      readFileSync(join(fixture.output, "manifest.json"), "utf8"),
    );
    const tree = git(fixture.source.root, [
      "--git-dir",
      repository,
      "rev-parse",
      `${manifest.receiptCommit}^{tree}`,
    ]);
    const identityEnv = {
      GIT_AUTHOR_NAME: "Adversary",
      GIT_AUTHOR_EMAIL: "adversary@example.invalid",
      GIT_COMMITTER_NAME: "Adversary",
      GIT_COMMITTER_EMAIL: "adversary@example.invalid",
      GIT_AUTHOR_DATE: "2026-08-27T01:00:00Z",
      GIT_COMMITTER_DATE: "2026-08-27T01:00:00Z",
    };
    const wrongParent = git(
      fixture.source.root,
      ["--git-dir", repository, "commit-tree", tree, "-p", manifest.parentCommit],
      { env: identityEnv, input: "wrong intermediate parent\n" },
    );
    const forgedReceipt = git(
      fixture.source.root,
      ["--git-dir", repository, "commit-tree", tree, "-p", wrongParent],
      {
        env: {
          ...identityEnv,
          GIT_AUTHOR_DATE: "2026-08-27T01:00:01Z",
          GIT_COMMITTER_DATE: "2026-08-27T01:00:01Z",
        },
        input: "forged receipt\n",
      },
    );
    git(fixture.source.root, [
      "--git-dir",
      repository,
      "update-ref",
      "refs/core/receipt",
      forgedReceipt,
    ]);
    rewriteRecordManifest(fixture.output, (document) => {
      document.receiptCommit = forgedReceipt;
    });
    let credentialedGitCalls = 0;
    expect(() =>
      recordPushCoreRelease(
        { artifact: fixture.output },
        {
          repo: fixture.source.repository,
          env: { TAKOFORM_CORE_REF_WRITE_TOKEN: "must-remain-unused" },
          tools: { git: "/usr/bin/git" },
          runner(command, args, options) {
            if (args.some((argument) => argument.includes("AUTHORIZATION: basic"))) {
              credentialedGitCalls += 1;
            }
            return runProcess(command, args, options);
          },
        },
      ),
    ).toThrow(/raw R does not have exact sole parent P/);
    expect(credentialedGitCalls).toBe(0);
  }, 30_000);

  test("record-push closes its invoking checkout before a real fsmonitor can run", async () => {
    const fixture = await prepareRecordArtifact();
    const canary = join(fixture.source.root, "record-fsmonitor-executed");
    const monitor = join(fixture.source.root, "record-fsmonitor.sh");
    writeFileSync(
      monitor,
      procAuthorityCanary(canary),
      { mode: 0o700 },
    );
    git(fixture.source.repository, ["config", "core.fsmonitor", monitor]);
    let runnerCalls = 0;
    expect(() =>
      recordPushCoreRelease(
        { artifact: fixture.output },
        {
          repo: fixture.source.repository,
          env: { TAKOFORM_CORE_REF_WRITE_TOKEN: "parent-secret" },
          tools: { git: "/usr/bin/git" },
          runner() {
            runnerCalls += 1;
            throw new Error("Git must not execute");
          },
        },
      ),
    ).toThrow(/unsafe local Git config/);
    expect(runnerCalls).toBe(0);
    expect(existsSync(canary)).toBe(false);
  }, 30_000);

  test("record-push detects an artifact-root rename swap before authoritative readback or CAS", async () => {
    const fixture = await prepareRecordArtifact();
    const old = `${fixture.output}.old`;
    let swapped = false;
    let credentialedGitCalls = 0;
    expect(() =>
      recordPushCoreRelease(
        { artifact: fixture.output },
        {
          repo: fixture.source.repository,
          env: { TAKOFORM_CORE_REF_WRITE_TOKEN: "must-remain-unused" },
          tools: { git: "/usr/bin/git" },
          runner(command, args, options) {
            if (!swapped && args.includes("rev-parse")) {
              renameSync(fixture.output, old);
              cpSync(old, fixture.output, {
                recursive: true,
                preserveTimestamps: true,
              });
              swapped = true;
            }
            if (args.some((argument) => argument.includes("AUTHORIZATION: basic"))) {
              credentialedGitCalls += 1;
            }
            return runProcess(command, args, options);
          },
        },
      ),
    ).toThrow(/artifact root changed or was replaced/);
    expect(swapped).toBe(true);
    expect(credentialedGitCalls).toBe(0);
  }, 30_000);

  test("record-push exposes the ref token only to absolute Git CAS/readback and runs no Go/curl/gh", async () => {
    const fixture = await prepareRecordArtifact();
    const trace = [];
    const receiptCommit = fixture.result.receiptCommit;
    const parentCommit = fixture.result.parentCommit;
    const actualGit = resolve("/usr/bin/git");
    const runner = (command, args, options = {}) => {
      trace.push({ command, args: [...args], env: { ...(options.env ?? {}) } });
      expect(command).toBe(actualGit);
      expect(options.env?.TAKOFORM_CORE_REF_WRITE_TOKEN).toBeUndefined();
      if (args.includes("ls-remote") && args.includes(CORE_RELEASE.origin)) {
        return {
          status: 0,
          stdout: `${parentCommit}\t${CORE_RELEASE.ref}\n`,
          stderr: "",
        };
      }
      if (args.includes("push") && args.includes(CORE_RELEASE.origin)) {
        expect(args).toContain(
          `${receiptCommit}:${CORE_RELEASE.ref}`,
        );
        expect(args).toContain(
          `--force-with-lease=${CORE_RELEASE.ref}:${parentCommit}`,
        );
        return { status: 0, stdout: "ok\n", stderr: "" };
      }
      if (args.includes("fetch") && args.includes(CORE_RELEASE.origin)) {
        execFileSync(actualGit, [
          "--git-dir",
          options.cwd,
          "update-ref",
          "refs/core/readback",
          receiptCommit,
        ]);
        return { status: 0, stdout: "", stderr: "" };
      }
      return runProcess(command, args, options);
    };
    const result = recordPushCoreRelease(
      { artifact: fixture.output },
      {
        repo: fixture.source.repository,
        env: {
          TAKOFORM_CORE_REF_WRITE_TOKEN: "ref-secret",
          PATH: join(fixture.source.root, "malicious"),
        },
        runner,
        tools: { git: actualGit },
      },
    );
    expect(result.status).toBe("recorded");
    expect(
      trace.every(({ command }) =>
        command === actualGit && !/[\\/]?(?:go|curl|gh|bun)$/u.test(command),
      ),
    ).toBe(true);
    const credentialed = trace.filter(({ args }) =>
      args.some((arg) => arg.includes("AUTHORIZATION: basic")),
    );
    expect(credentialed.length).toBeGreaterThanOrEqual(3);
    expect(
      trace
        .filter(({ args }) => !args.some((arg) => arg.includes("AUTHORIZATION: basic")))
        .every(({ args }) => !args.some((arg) => arg.includes("ref-secret"))),
    ).toBe(true);
  }, 30_000);

  test("record-push classifies a descendant-main P lease loss without CAS", async () => {
    const fixture = await prepareRecordArtifact();
    const manifest = JSON.parse(
      readFileSync(join(fixture.output, "manifest.json"), "utf8"),
    );
    const actualGit = resolve("/usr/bin/git");
    let pushed = false;
    let descendant;
    const runner = (command, args, options = {}) => {
      if (args.includes("ls-remote") && args.includes(CORE_RELEASE.origin)) {
        const tree = execFileSync(
          actualGit,
          ["--git-dir", options.cwd, "rev-parse", `${manifest.parentCommit}^{tree}`],
          { encoding: "utf8" },
        ).trim();
        descendant = execFileSync(
          actualGit,
          [
            "--git-dir",
            options.cwd,
            "commit-tree",
            tree,
            "-p",
            manifest.parentCommit,
          ],
          {
            input: "advance main\n",
            encoding: "utf8",
            env: {
              PATH: "/usr/bin:/bin",
              GIT_AUTHOR_NAME: "Test",
              GIT_AUTHOR_EMAIL: "test@example.invalid",
              GIT_COMMITTER_NAME: "Test",
              GIT_COMMITTER_EMAIL: "test@example.invalid",
            },
          },
        ).trim();
        return { status: 0, stdout: `${descendant}\t${CORE_RELEASE.ref}\n`, stderr: "" };
      }
      if (args.includes("push") && args.includes(CORE_RELEASE.origin)) {
        pushed = true;
      }
      if (args.includes("fetch") && args.includes(CORE_RELEASE.origin)) {
        execFileSync(actualGit, [
          "--git-dir",
          options.cwd,
          "update-ref",
          "refs/core/readback",
          descendant,
        ]);
        return { status: 0, stdout: "", stderr: "" };
      }
      return runProcess(command, args, options);
    };
    const result = recordPushCoreRelease(
      { artifact: fixture.output },
      {
        repo: fixture.source.repository,
        env: { TAKOFORM_CORE_REF_WRITE_TOKEN: "ref-secret" },
        runner,
        tools: { git: actualGit },
      },
    );
    expect(result.status).toBe("cas-lost");
    expect(pushed).toBe(false);
  }, 30_000);

  test("verify reconstructs fresh receipt without any current-ruleset operation", async () => {
    const source = createRepository({ detached: true });
    const bundle = tagBundleFixture(
      source.commit,
      `sha256:${"4".repeat(64)}`,
      `sha256:${"5".repeat(64)}`,
      auditFixture(),
    );
    const evidence = tagEvidence(bundle);
    const release = releaseFixture(source.commit, bundle);
    const go = goEvidence(source.commit);
    const receipt = createCoreReleaseReceipt({
      expectedCommit: source.commit,
      tagEvidence: evidence,
      release,
      go,
    });
    const trace = [];
    const receiptCommit = "9".repeat(40);
    const result = await verifyPublishedCoreRelease(
      { expectedCommit: source.commit, receiptCommit },
      {
        repo: source.repository,
        env: {},
        tools: {
          git: "/usr/bin/git",
          sshKeygen: "/usr/bin/ssh-keygen",
          go: "/usr/bin/go",
        },
        operations: {
          readReceipt() {
            trace.push("readReceipt");
            return {
              receipt,
              parentCommit: source.commit,
              currentMain: receiptCommit,
            };
          },
          readTag() {
            trace.push("readTag");
            return evidence;
          },
          readRelease() {
            trace.push("readRelease");
            return release;
          },
          verifyGo() {
            trace.push("verifyGo");
            return go;
          },
        },
      },
    );
    expect(trace).toEqual(["readReceipt", "readTag", "readRelease", "verifyGo"]);
    expect(trace.some((name) => /ruleset|bypass/i.test(name))).toBe(false);
    expect(result.currentBypassStateClaimed).toBe(false);
    expect(result.status).toBe("verified");
  });
});

test("implementation contains no archive/seal/checksum/curl/gh release lane", () => {
  const implementation = readFileSync(
    new URL("./core-release.mjs", import.meta.url),
    "utf8",
  );
  expect(implementation).not.toMatch(
    /createDeterministicTar|createDeterministicZip|sealCandidate|SHA256SUMS|SBOM_NAME|PROVENANCE_NAME|TAKOFORM_CORE_SIGNER_COMMAND\s*\]/u,
  );
  expect(implementation).not.toMatch(/runner\([^\n]*["'](?:curl|gh|go|bun)["']/u);
  expect(implementation).toContain("currentBypassStateClaimed: false");
  expect(implementation).toContain("coreTagCreateOnlyPushSpec(bundle.tagObject)");
});
