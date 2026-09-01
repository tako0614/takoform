import { describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SchemaOriginFailure } from "./schema-origin-deploy.mjs";
import {
  DEPLOY_CONTRACT,
  DEPLOY_RUNTIME_EXECUTABLE,
  assertDeployRuntime,
  failureJSON,
  parseDeployInvocation,
  prepareDeployContinuation,
  runBrokeredDeploy,
  runDeploy,
  sealedRequirementForInvocation,
} from "./deploy.mjs";
import {
  SEALED_REVIEW_FINGERPRINT,
  canonicalJSON,
  prepareSealedProposal,
} from "./sealed-deploy-launcher.mjs";

const commit = "0123456789abcdef0123456789abcdef01234567";
const receipt = "89abcdef0123456789abcdef0123456789abcdef";
const nodeRuntime = "/usr/local/bin/node";
const aggregateClass = "broker-bound-exact-phase-authority-envelope";
const repositoryRoot = realpathSync(new URL("..", import.meta.url).pathname);

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function git(cwd, args) {
  return execFileSync("/usr/bin/git", args, {
    cwd,
    env: {
      PATH: "/usr/bin:/bin",
      HOME: cwd,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      LC_ALL: "C",
    },
    encoding: "utf8",
  }).trim();
}

function proposalFixture() {
  const parent = mkdtempSync(join(tmpdir(), "takoform-broker-proposal-test-"));
  chmodSync(parent, 0o700);
  const broker = join(parent, "takoform-sealed-deploy-broker");
  copyFileSync("/root/.local/toolchains/go1.26.7/bin/go", broker);
  chmodSync(broker, 0o555);
  const repo = join(parent, "repo");
  mkdirSync(join(repo, "scripts"), { recursive: true, mode: 0o700 });
  mkdirSync(join(repo, "release", "authority"), { recursive: true, mode: 0o700 });
  for (const name of [
    "sealed-deploy-launcher.mjs",
    "sealed-deploy-bootstrap.mjs",
    "sealed-deploy-runner.mjs",
  ]) copyFileSync(new URL(name, import.meta.url), join(repo, "scripts", name));
  writeFileSync(join(repo, "scripts", "deploy.mjs"), "export async function runBrokeredDeploy(){throw new Error('must not import before broker validation')}\n");
  copyFileSync(
    new URL("../release/authority/core-release-continuation-review.pub", import.meta.url),
    join(repo, "release", "authority", "core-release-continuation-review.pub"),
  );
  writeFileSync(join(repo, "README.md"), "sealed proposal fixture\n");
  git(repo, ["init", "--initial-branch=main"]);
  git(repo, ["config", "user.name", "Sealed Proposal Test"]);
  git(repo, ["config", "user.email", "sealed-proposal@example.invalid"]);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "sealed proposal fixture"]);
  return { parent, broker, repo, source: git(repo, ["rev-parse", "HEAD"]) };
}

function sourceReview(fixture, overrides = {}) {
  const rawSourceTreeSha256 = digest(execFileSync(
    "/usr/bin/git",
    [
      "--no-optional-locks", "--no-replace-objects", "-c", "credential.helper=",
      "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
      "-c", "core.attributesFile=/dev/null", "-c", "diff.external=",
      "-c", "protocol.ext.allow=never", "ls-tree", "-r", "-z", "--full-tree",
      fixture.source,
    ],
    {
      cwd: fixture.repo,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: fixture.repo,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_REPLACE_OBJECTS: "1",
        LC_ALL: "C",
      },
    },
  ));
  const document = {
    approved: true,
    brokerSha256: digest(readFileSync(fixture.broker)),
    format: "takoform.sealed-deploy-source-review@v1",
    reviewed: [
      "broker-static-boundary",
      "raw-reviewed-source",
      "sealed-closure-proposal",
    ],
    reviewedAt: "2026-08-27T00:00:00.000Z",
    rawSourceTreeSha256,
    reviewer: "takoform-sealed-continuation-independent-reviewer",
    source: fixture.source,
    ...overrides,
  };
  const path = join(fixture.parent, `source-review-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(path, `${canonicalJSON(document)}\n`, { mode: 0o600 });
  return path;
}

function auditPreparation(fixture, outputRoot, overrides = {}) {
  return prepareDeployContinuation({
    repo: fixture.repo,
    brokerExecutable: fixture.broker,
    environment: {},
    args: [
      "--prepare-sealed-continuation",
      outputRoot,
      "--source",
      fixture.source,
      "--continuation-review",
      overrides.review ?? sourceReview(fixture),
      "--",
      "takoform-core-release",
      "audit",
      "--expected-commit",
      fixture.source,
      "--ruleset-id",
      "123",
      "--output",
      join(fixture.parent, "ruleset-audit.json"),
    ],
  });
}

function makeUnlinkedFD(root, name, bytes, mode) {
  const path = join(root, name);
  writeFileSync(path, bytes, { mode });
  chmodSync(path, mode);
  const fd = openSync(path, "r");
  unlinkSync(path);
  return fd;
}

describe("owner-operated brokered deploy entrypoint", () => {
  test("--contract is credentialless and declares one exact broker envelope", () => {
    const raw = execFileSync("/usr/bin/env", ["-i", nodeRuntime, "scripts/deploy.mjs", "--contract"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    expect(JSON.parse(raw)).toEqual(DEPLOY_CONTRACT);
    for (const surface of DEPLOY_CONTRACT.surfaces) {
      expect(surface.requiresEnv).toEqual([]);
      expect(surface.sealedContinuation.credentialClasses).toEqual({
        facade: [],
        capability: [],
        launcher: [aggregateClass],
      });
      expect(surface.sealedContinuation.capability.authenticity).toMatchObject({
        scheme: "broker-minted-after-pinned-review",
        proposalProducer: "credentialless-unprivileged-facade",
        acceptedCapabilityIssuer: "preinstalled-root-or-system-owned-static-trusted-broker",
        reviewVerification: "cryptographic-signature-against-broker-pinned-reviewer-trust-root",
        mintAndConsume: "broker-internal-atomic-one-use",
        credentialReadOrder: "after-broker-reseal-and-atomic-capability-consume-before-protected-fd-or-broker-read",
        sourceMinting: "refuse",
        custody: "broker-internal-unexposed",
      });
      expect(surface.sealedContinuation.capability.authenticity.requiredEvidence).toHaveLength(30);
      expect(surface.sealedContinuation.capability.boundIdentityEvidence).toContain("launcher.launcher-executable-sha256");
      expect(surface.sealedContinuation.closureCustody).toEqual({
        producerInputOwnership: "unprivileged-producer",
        brokerReseal: "after-pinned-review-before-capability-consume",
        executionSource: "broker-owned-revalidated-private-copy-only",
        preCredentialChildExecution: "refuse",
        mutation: "refuse",
      });
      expect(surface.sealedContinuation.launcher.checkout).toBe(
        "broker-resealed-private-closure",
      );
      expect(surface.sealedContinuation.ambientAuthority.forbiddenClasses).toContain("key-agent");
    }
  });

  test("routes the seven Core phases and keeps recover inside publish", () => {
    expect(parseDeployInvocation([
      "takoform-core-release", "prepare", "--expected-commit", commit, "--output", "/tmp/q",
    ])).toEqual({ surface: "takoform-core-release", options: { phase: "prepare", expectedCommit: commit, output: "/tmp/q" } });
    expect(parseDeployInvocation([
      "takoform-core-release", "publish", "--expected-commit", commit,
      "--qualification", "/tmp/q", "--ruleset-audit", "/tmp/a",
      "--review-record", "/tmp/r", "--tag-bundle", "/tmp/t", "--mode", "recover",
    ]).options.mode).toBe("recover");
    expect(parseDeployInvocation([
      "takoform-core-release", "record-push", "--artifact", "/tmp/record",
    ]).options).toEqual({ phase: "record-push", artifact: "/tmp/record" });
    expect(parseDeployInvocation([
      "takoform-core-release", "verify", "--expected-commit", commit, "--receipt-commit", receipt,
    ]).options.phase).toBe("verify");
    expect(() => parseDeployInvocation(["takoform-core-release", "recover"])).toThrow();
  });

  test("retains credentialless public schema verification", async () => {
    let schemaCalls = 0;
    await runDeploy({
      args: ["takoform-schema-origin", "verify", "--candidate", "/tmp/candidate.json"],
      repo: repositoryRoot,
      env: {},
      runtimeExecutable: nodeRuntime,
      schemaDeploy: async () => { schemaCalls += 1; return { status: "public" }; },
      stdout: { write() {} },
    });
    expect(schemaCalls).toBe(1);
  });

  test("requires exact Node and preserves structured failure evidence", () => {
    expect(assertDeployRuntime(nodeRuntime)).toEqual({ executable: DEPLOY_RUNTIME_EXECUTABLE, owner: 0, mode: 0o755 });
    expect(() => assertDeployRuntime(process.execPath)).toThrow("exact private-system Node");
    const recoveryEvidence = [{ recoveryArtifact: "/tmp/recovery.json" }];
    const error = new SchemaOriginFailure("stage", "readback", "failed", { externalStateTouched: true, externalStateIndeterminate: true });
    error.recoveryEvidence = recoveryEvidence;
    expect(failureJSON(error)).toMatchObject({
      status: "blocked", externalStateTouched: true,
      externalStateIndeterminate: true, recoveryEvidence,
      automaticCleanupAttempted: false, blindRetryAllowed: false,
    });
  });

  test("maps every authority phase to one aggregate class with exact private keys", () => {
    expect(sealedRequirementForInvocation("takoform-core-release", { phase: "audit" })).toEqual({ credentialClass: aggregateClass, env: ["GH_TOKEN"] });
    expect(sealedRequirementForInvocation("takoform-core-release", { phase: "sign-tag" })).toEqual({ credentialClass: aggregateClass, env: ["TAKOFORM_CORE_TAG_SIGNING_KEY"] });
    expect(sealedRequirementForInvocation("takoform-schema-origin", { phase: "stage" })).toEqual({ credentialClass: aggregateClass, env: ["CLOUDFLARE_API_TOKEN"] });
  });

  test("direct credentialed execution and plain-object continuation fail before runner/network/delegate", async () => {
    let runnerCalls = 0;
    let networkCalls = 0;
    await expect(runDeploy({
      args: [
        "takoform-core-release", "audit", "--expected-commit", commit,
        "--ruleset-id", "123", "--output", "/tmp/audit.json",
      ],
      repo: repositoryRoot,
      env: { GH_TOKEN: "must-not-reach" },
      runtimeExecutable: nodeRuntime,
      runner() { runnerCalls += 1; },
      githubRequest() { networkCalls += 1; },
      sealedContinuation: { format: "forged" },
    })).rejects.toThrow("requires the independently installed static broker");
    expect(runnerCalls).toBe(0);
    expect(networkCalls).toBe(0);
    await expect(runBrokeredDeploy({ attestation: {} })).rejects.toThrow("absent, forged, or already consumed");
  });

  test("credentialless facade rejects policy-wide ambient authority case-insensitively", async () => {
    for (const name of [
      "cloudflare_api_token", "node_options", "DENO_PRELOAD", "ld_custom_inject",
      "DyLd_InSeRt_LiBrArIeS", "__XPC_DYLD_INSERT_LIBRARIES", "GLIBC_TUNABLES",
      "AWS_CA_BUNDLE", "npm_config_cafile", "https_proxy", "PROMPT_COMMAND",
      "git_config_count", "ssh_agent_pid", "SUDO_ASKPASS",
    ]) {
      let delegates = 0;
      await expect(runDeploy({
        args: ["takoform-schema-origin", "verify", "--candidate", "/tmp/candidate.json"],
        repo: repositoryRoot,
        env: { [name]: "must-not-reach" },
        runtimeExecutable: nodeRuntime,
        schemaDeploy: async () => { delegates += 1; },
      })).rejects.toThrow(`rejects ambient authority/injection ${name}`);
      expect(delegates).toBe(0);
    }
  });

  test("outer credentialless facade strips Bun/Node preload hooks", () => {
    const root = mkdtempSync(join(tmpdir(), "takoform-deploy-preload-"));
    const canary = join(root, "canary");
    const bunPreload = join(root, "bun-preload.mjs");
    const nodePreload = join(root, "node-preload.cjs");
    writeFileSync(bunPreload, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(canary)}, String(process.env.GH_TOKEN));`);
    writeFileSync(nodePreload, `require("node:fs").writeFileSync(${JSON.stringify(canary)}, String(process.env.GH_TOKEN));`);
    const result = spawnSync("/usr/bin/env", ["-i", "/usr/local/bin/bun", "run", "deploy", "--", "--contract"], {
      cwd: repositoryRoot,
      env: {
        GH_TOKEN: "must-not-observe", BUN_OPTIONS: `--preload=${bunPreload}`,
        NODE_OPTIONS: `--require=${nodePreload}`, NODE_EXTRA_CA_CERTS: join(root, "ca.pem"),
        HTTPS_PROXY: "http://attacker.invalid:8080",
      },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(DEPLOY_CONTRACT);
    expect(existsSync(canary)).toBe(false);
  });

  test("credentialless facade emits only a signed-review proposal, never a capability or command string", () => {
    const fixture = proposalFixture();
    const outputRoot = join(fixture.parent, "proposal with spaces;$(not-a-shell)");
    const prepared = auditPreparation(fixture, outputRoot);
    expect(prepared).toMatchObject({
      format: "takoform.sealed-deploy-proposal-result@v2",
      source: fixture.source,
      surface: "takoform-core-release",
      phase: "audit",
      credentialNames: ["GH_TOKEN"],
      review: {
        format: "takoform.sealed-deploy-review@v2",
        namespace: "takoform-sealed-continuation-review-v2",
        trustRootFingerprint: SEALED_REVIEW_FINGERPRINT,
        externalSigningOnly: true,
      },
    });
    expect(prepared).not.toHaveProperty("capabilityPath");
    expect(prepared).not.toHaveProperty("command");
    expect(prepared.launcher).toEqual({
      executable: fixture.broker,
      argvPrefix: ["--proposal", prepared.proposalPath, "--proposal-sha256", prepared.proposalSha256],
      reviewRecordFlag: "--review",
      reviewSignatureFlag: "--signature",
      credentialFd: 3,
      credentialTransport: "protected-fd",
      environment: "empty",
    });
    const proposal = JSON.parse(readFileSync(prepared.proposalPath, "utf8"));
    expect(proposal.identityEvidence["source.review-record-sha256"]).toMatch(/^sha256:/);
    expect(proposal.launcher.broker).toMatchObject({
      path: fixture.broker,
      uid: 0,
      gid: 0,
      mode: 0o555,
    });
    expect(proposal.launcher.broker.staticBuildIdSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.keys(proposal.runtime).sort()).toEqual(["continuationTools", "node"]);
    expect(Object.keys(proposal.runtime.continuationTools).sort()).toEqual(["git", "sshKeygen"]);
    expect(proposal.runtime.node.path).toBe(nodeRuntime);
    expect(proposal.preparationTools.git.path).toBe("/usr/bin/git");
    expect(proposal.preparationTools).not.toHaveProperty("bun");
    const reviewRequest = JSON.parse(readFileSync(prepared.reviewRequestPath, "utf8"));
    expect(reviewRequest.sourceBinding).toEqual({
      closureManifestSha256: proposal.source.inventorySha256,
      closureTreeSha256: proposal.source.treeSha256,
      commit: fixture.source,
      rawSourceTreeSha256: proposal.source.rawSourceTreeSha256,
      sourceReviewSha256: proposal.source.reviewRecord.sha256,
    });
    expect(proposal.source.inventory.some(({ path }) => path === ".git/config")).toBe(true);
    expect(proposal.source.inventory.some(({ path }) => path.startsWith(".git/hooks/"))).toBe(false);
    expect(readFileSync(prepared.reviewRequestPath, "utf8")).not.toContain("PRIVATE KEY");
  });

  test("proposal producer is genuinely unprivileged and emits no accepted capability", () => {
    const fixture = proposalFixture();
    const review = sourceReview(fixture);
    const outputRoot = join(fixture.parent, "nobody-proposal");
    const driver = join(fixture.parent, "prepare-as-nobody.mjs");
    const launcher = join(fixture.repo, "scripts", "sealed-deploy-launcher.mjs");
    writeFileSync(driver, [
      `import { prepareSealedProposal } from ${JSON.stringify(`file://${launcher}`)};`,
      `const result = prepareSealedProposal(${JSON.stringify({
        repository: fixture.repo,
        outputRoot,
        source: fixture.source,
        args: [
          "takoform-core-release", "audit", "--expected-commit",
          fixture.source, "--ruleset-id", "123", "--output",
          join(fixture.parent, "audit.json"),
        ],
        credentialEnv: ["GH_TOKEN"],
        credentialClass: aggregateClass,
        continuationReview: review,
        brokerExecutable: fixture.broker,
        environment: {},
      })});`,
      "process.stdout.write(JSON.stringify(result));",
      "",
    ].join("\n"), { mode: 0o600 });
    execFileSync("/usr/bin/chown", ["-R", "65534:65534", fixture.parent]);
    execFileSync("/usr/bin/chown", ["0:0", fixture.broker]);
    chmodSync(fixture.broker, 0o555);
    const result = spawnSync("/usr/bin/setpriv", [
      "--reuid=65534", "--regid=65534", "--clear-groups",
      nodeRuntime, driver,
    ], { env: {}, encoding: "utf8" });
    expect(result.status).toBe(0);
    const prepared = JSON.parse(result.stdout);
    expect(prepared.format).toBe("takoform.sealed-deploy-proposal-result@v2");
    expect(prepared).not.toHaveProperty("capabilityPath");
    expect(lstatSync(prepared.proposalPath).uid).toBe(65534);
    expect(lstatSync(prepared.proposalPath).mode & 0o777).toBe(0o600);
  });

  test("proposal recursively seals record-push directory artifacts", () => {
    const fixture = proposalFixture();
    const artifact = join(fixture.parent, "record-push");
    mkdirSync(join(artifact, "repository.git", "objects"), { recursive: true, mode: 0o700 });
    writeFileSync(join(artifact, "manifest.json"), "{\"closed\":true}\n", { mode: 0o600 });
    writeFileSync(join(artifact, "repository.git", "HEAD"), "ref: refs/heads/main\n", { mode: 0o600 });
    writeFileSync(join(artifact, "repository.git", "objects", "object"), "object-bytes", { mode: 0o600 });
    const prepared = prepareDeployContinuation({
      repo: fixture.repo,
      brokerExecutable: fixture.broker,
      environment: {},
      args: [
        "--prepare-sealed-continuation", join(fixture.parent, "record-proposal"),
        "--source", fixture.source, "--continuation-review", sourceReview(fixture), "--",
        "takoform-core-release", "record-push", "--artifact", artifact,
      ],
    });
    const proposal = JSON.parse(readFileSync(prepared.proposalPath, "utf8"));
    const sealed = proposal.inputs.find(({ flag }) => flag === "--artifact");
    expect(sealed.type).toBe("directory");
    expect(sealed.inventory.map(({ path }) => path)).toEqual([
      "manifest.json", "repository.git", "repository.git/HEAD",
      "repository.git/objects", "repository.git/objects/object",
    ]);
    expect(lstatSync(sealed.path).mode & 0o777).toBe(0o555);
    expect(proposal.invocation.args[proposal.invocation.args.indexOf("--artifact") + 1]).toBe(sealed.path);
  });

  test("proposal rejects ambient injection before cloning or broker/source-review substitution", () => {
    const fixture = proposalFixture();
    for (const name of ["NODE_OPTIONS", "lower_token", "LD_MALICE", "DYLD_INSERT_LIBRARIES", "GLIBC_TUNABLES", "NPM_CONFIG_CAFILE", "ALL_PROXY", "BASH_FUNC_attack", "GIT_CONFIG_SYSTEM", "SSH_AUTH_SOCK"]) {
      const outputRoot = join(fixture.parent, `blocked-${name}`);
      expect(() => prepareSealedProposal({
        repository: fixture.repo,
        outputRoot,
        source: fixture.source,
        continuationReview: sourceReview(fixture),
        args: ["takoform-core-release", "audit", "--expected-commit", fixture.source, "--ruleset-id", "123", "--output", join(fixture.parent, "a")],
        credentialClass: aggregateClass,
        credentialEnv: ["GH_TOKEN"],
        brokerExecutable: fixture.broker,
        environment: { [name]: "attacker" },
      })).toThrow(`rejects ambient authority/injection ${name}`);
      expect(existsSync(outputRoot)).toBe(false);
    }
    const badReview = sourceReview(fixture, { brokerSha256: `sha256:${"0".repeat(64)}` });
    expect(() => auditPreparation(fixture, join(fixture.parent, "bad-review"), { review: badReview })).toThrow("does not bind the exact source and installed broker");
    const wrongTreeReview = sourceReview(fixture, { rawSourceTreeSha256: `sha256:${"0".repeat(64)}` });
    expect(() => auditPreparation(fixture, join(fixture.parent, "wrong-tree-review"), { review: wrongTreeReview })).toThrow("does not bind the exact source and installed broker");
    const dynamicBroker = join(fixture.parent, "dynamic-node");
    copyFileSync(nodeRuntime, dynamicBroker);
    chmodSync(dynamicBroker, 0o555);
    expect(() => prepareSealedProposal({
      repository: fixture.repo,
      outputRoot: join(fixture.parent, "dynamic-broker-proposal"),
      source: fixture.source,
      continuationReview: sourceReview(fixture, {
        brokerSha256: digest(readFileSync(dynamicBroker)),
      }),
      args: ["takoform-core-release", "audit"],
      credentialClass: aggregateClass,
      credentialEnv: ["GH_TOKEN"],
      brokerExecutable: dynamicBroker,
      environment: {},
    })).toThrow(/statically linked|Go build-id/);
  });

  test("direct sealed runner cannot read credential FD without the live installed broker parent", () => {
    const fixture = proposalFixture();
    const prepared = auditPreparation(fixture, join(fixture.parent, "direct-run-proposal"));
    const proposal = JSON.parse(readFileSync(prepared.proposalPath, "utf8"));
    const selectIdentity = (value) => Object.fromEntries(["path", "sha256", "dev", "ino", "uid", "gid", "mode"].map((key) => [key, value[key]]));
    const fake = `sha256:${"1".repeat(64)}`;
    const brokerIdentity = {
      ...selectIdentity(proposal.launcher.broker),
      staticBuildIdSha256: proposal.launcher.broker.staticBuildIdSha256,
    };
    const forgedEphemeralRoot = join(proposal.root.path, "ephemeral");
    mkdirSync(forgedEphemeralRoot, { mode: 0o700 });
    const request = {
      attestation: {
        capabilityConsumeMarkerSha256: fake,
        capabilityEnvelopeSha256: fake,
        signedReviewEnvelopeSha256: fake,
      },
      broker: {
        ...brokerIdentity,
        identityEnvelopeSha256: digest(Buffer.from(canonicalJSON(brokerIdentity))),
      },
      credential: { class: aggregateClass, names: ["GH_TOKEN"] },
      ephemeralRoot: forgedEphemeralRoot,
      format: "takoform.broker-attested-run-request@v1",
      identityEvidence: proposal.identityEvidence,
      invocation: proposal.invocation,
      proposalEnvelopeSha256: prepared.proposalSha256,
      reviewRecordSha256: fake,
      runtime: { node: selectIdentity(proposal.runtime.node) },
      source: { commit: fixture.source, root: proposal.source.root },
    };
    const requestFd = makeUnlinkedFD(fixture.parent, "run-request", `${canonicalJSON(request)}\n`, 0o400);
    const secret = "credential-must-remain-unread";
    const credentialFd = makeUnlinkedFD(fixture.parent, "credential", `${canonicalJSON({ GH_TOKEN: secret })}\n`, 0o600);
    const result = spawnSync(nodeRuntime, [
      join(proposal.source.root, "scripts", "sealed-deploy-runner.mjs"),
      "--broker-run-request-fd", "3", "--broker-credential-fd", "4",
    ], {
      env: {},
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe", requestFd, credentialFd],
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("exact installed broker path");
    expect(result.stderr).not.toContain(secret);
    const first = Buffer.alloc(1);
    expect(readSync(credentialFd, first, 0, 1, null)).toBe(1);
    expect(first.toString()).toBe("{");
    closeSync(requestFd);
    closeSync(credentialFd);
  });

  test("release policies describe proposal, external signature, broker install, and no JS mint", () => {
    const core = readFileSync(new URL("../release/core-release-policy.md", import.meta.url), "utf8");
    const schema = readFileSync(new URL("../release/schema-origin-policy.md", import.meta.url), "utf8");
    for (const policy of [core, schema]) {
      expect(policy).toContain("broker");
      expect(policy).toContain("proposal");
      expect(policy).toContain("FD 3");
      expect(policy).not.toContain("--surface=takoform-schema-origin");
    }
    expect(core).toContain("takoform-sealed-continuation-review-v2");
    expect(core).toContain("/usr/local/libexec/takoform-sealed-deploy-broker");
    expect(core).toContain("runs no Git or other parser child");
    expect(schema).toContain("starts no child or source parser");
  });

  test("broker authority manifest is portable, unrealized, and pins the review/runtime contract", () => {
    const raw = readFileSync(
      new URL("../release/authority/core-release-broker.json", import.meta.url),
      "utf8",
    );
    const manifest = JSON.parse(raw);
    expect(raw).not.toContain("/root/.local/toolchains");
    expect(manifest.build).toMatchObject({
      goVersion: "go1.26.7",
      platform: "linux/amd64",
      cgoEnabled: false,
      trimpath: true,
      candidateBinarySha256:
        "sha256:126ae6d5c77eaf53390b34e0b5cacf7ebd4cf033992d6fc0310a139d567849bc",
      candidateStaticBuildIdSha256:
        "sha256:a3edd30e63bdee89d2dc42f41ae40a293750921eb1cbe8f84e9396b06bb8b579",
      reproducibility: "two-byte-identical-exact-toolchain-builds",
      goArchiveSha256:
        "sha256:ffb5f8de10c62550dfddab66b36b57030721e0a44a3218e9e1181d7b59f121ca",
    });
    expect(manifest.install).toMatchObject({
      status: "prepared-not-installed",
      path: "/usr/local/libexec/takoform-sealed-deploy-broker",
      mode: "0555",
      uid: 0,
      gid: 0,
      binaryDigestEvidence:
        "candidate-two-builds-byte-identical-not-installed",
      binarySha256:
        "sha256:126ae6d5c77eaf53390b34e0b5cacf7ebd4cf033992d6fc0310a139d567849bc",
    });
    expect(manifest.review).toMatchObject({
      publicKeyFileSha256:
        "sha256:2fa583d47379dd1501a21ec0545f2595bc282b2c52da4d3c03c553c1c30abf3a",
      publicKeyBlobSha256:
        "sha256:f3a0e8026f3a3ecf02d86f7b795a4553f3a7f14c844997d56e80a75faded6175",
      reviewerPublicKeyEvidenceRepresentation:
        "decoded-ssh-public-key-blob",
      sshFingerprint: SEALED_REVIEW_FINGERPRINT,
    });
    expect(manifest.runtime).toMatchObject({
      executable: nodeRuntime,
      brokerSpawn: [nodeRuntime],
      continuationToolIdentities: ["/usr/bin/git", "/usr/bin/ssh-keygen"],
      preparationToolIdentities: {
        always: ["/usr/bin/git"],
        surfaceConditional: [
          "/usr/local/lib/node_modules/bun/node_modules/@oven/bun-linux-x64-baseline/bin/bun",
        ],
      },
    });
    expect(manifest.verification).toMatchObject({
      externalChildBeforeCredentialRead: "refuse",
      rawGitCommitTreeLinkageAuthority: "independent-signed-review",
    });
    expect(manifest.invocation).toMatchObject({
      environment: "exactly-empty",
      credentialAttachOrder:
        "empty-environment-before-protected-fd-attach",
      dynamicWrapperAfterCredentialAttach: "refuse",
    });
  });
});
