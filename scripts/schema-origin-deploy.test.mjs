import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  chownSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SCHEMA_ORIGIN,
  SchemaOriginFailure,
  canonicalJSON,
  createSchemaOriginOperations,
  createWranglerSubprocessEnvironment,
  cutoverSchemaOrigin,
  parseSchemaOriginArgs,
  prepareSchemaOriginAuthorityActivation,
  prepareSchemaOrigin,
  redactSubprocessText,
  revertSchemaOrigin,
  stageSchemaOrigin,
  verifySchemaOrigin,
} from "./schema-origin-deploy.mjs";
import {
  parseSchemaToolClosurePolicy,
  sealInstalledToolClosure,
} from "./specification-release-adapter.mjs";
import {
  schemaRouteCutoverClosureSha256,
  validateAuthorityTransfer,
} from "./records.mjs";
import {
  WRITER_CLOSURE_MANIFEST_PATH,
  WRITER_EXECUTION_PATHS,
} from "./specification-release.mjs";

const COMMIT = "a".repeat(40);
const PREPARED_COMMIT = "b".repeat(40);
const TOMBSTONE = "c".repeat(40);
const ACCOUNT_ID = "1".repeat(32);
const ZONE_ID = "2".repeat(32);
const VERSION_ID = "11111111-2222-4333-8444-555555555555";
const DEPLOYMENT_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const ROUTE_ID = "d".repeat(32);
const CANDIDATE_PATH = "/tmp/takoform-schema-origin-candidate.json";
const REVIEW_PATH = "/tmp/takoform-schema-origin-review.json";
const STAGE_PATH = "/tmp/takoform-schema-origin-stage.json";
const TOMBSTONE_PATH = "/tmp/takoform-schema-origin-tombstone.json";
const CUTOVER_PATH = "/tmp/takoform-schema-origin-cutover.json";
const ACTIVATION_PATH = "/tmp/takoform-schema-origin-activation.json";
const REVERT_PATH = "/tmp/takoform-schema-origin-revert.json";
const SENTINEL_URL = "https://forms.takoform.com/";
const TOKEN_ENV = { CLOUDFLARE_API_TOKEN: "operator-token-never-print" };
const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function digest(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function toolClosureFixture({ policy = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "takoform-schema-tool-test-"));
  temporaryRoots.push(root);
  const wranglerRoot = path.join(root, "node_modules", "wrangler");
  mkdirSync(path.join(wranglerRoot, "bin"), { recursive: true });
  mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
  const executable = Buffer.from("#!/usr/bin/env node\n");
  const metadata = Buffer.from(
    JSON.stringify({ version: SCHEMA_ORIGIN.wranglerVersion }),
  );
  writeFileSync(path.join(wranglerRoot, "bin", "wrangler.js"), executable, {
    mode: 0o755,
  });
  writeFileSync(path.join(wranglerRoot, "package.json"), metadata);
  symlinkSync(
    "../wrangler/bin/wrangler.js",
    path.join(root, "node_modules", ".bin", "wrangler"),
  );
  const records = [
    { path: ".bin/wrangler", sha256: digest(executable), executable: true },
    {
      path: "wrangler/bin/wrangler.js",
      sha256: digest(executable),
      executable: true,
    },
    {
      path: "wrangler/package.json",
      sha256: digest(metadata),
      executable: false,
    },
  ];
  const basePolicy = {
    format: "takoform.specification-schema-tool-closure@v1",
    platform: process.platform,
    architecture: process.arch,
    runtimeExecutable: "/usr/local/bin/node",
    runtimeVersion: "v26.1.0",
    runtimeSha256: "sha256:da220b82279ed9885a7759f6efb8c4b9351ece579f93429bf7b7d2fbd481bcf8",
    closureRoot: "node_modules",
    executable: "wrangler/bin/wrangler.js",
    wranglerVersion: SCHEMA_ORIGIN.wranglerVersion,
    fileCount: records.length,
    manifestSha256: digest(Buffer.from(canonicalJSON(records))),
    ...policy,
  };
  const policyPath = path.join(
    root,
    "release",
    "authority",
    "specification-schema-tool-closure.json",
  );
  mkdirSync(path.dirname(policyPath), { recursive: true });
  writeFileSync(policyPath, `${JSON.stringify(basePolicy, null, 2)}\n`);
  writeFileSync(
    path.join(root, WRITER_CLOSURE_MANIFEST_PATH),
    `${JSON.stringify({
      format: "takoform.specification-writer-closure@v1",
      paths: [...WRITER_EXECUTION_PATHS],
    }, null, 2)}\n`,
  );
  for (const relativePath of WRITER_EXECUTION_PATHS) {
    const absolute = path.join(root, relativePath);
    if (
      relativePath === WRITER_CLOSURE_MANIFEST_PATH ||
      absolute === policyPath
    ) {
      continue;
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    if (!existsSync(absolute)) {
      writeFileSync(absolute, `fixture:${relativePath}\n`);
    }
  }
  const authorityPath = path.join(
    root,
    "release",
    "specification-authority.json",
  );
  const authority = preparedAuthority();
  writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["config", "user.email", "fixture@example.com"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["config", "user.name", "Fixture"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["add", "."], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture P0"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const p0Commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  authority.successorPreparedCommit = p0Commit;
  writeFileSync(authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
  return {
    root,
    sourceExecutable: path.join(wranglerRoot, "bin", "wrangler.js"),
    policyPath,
    authorityPath,
    p0Commit,
  };
}

function subprocessProbe() {
  let tokenReads = 0;
  let fetches = 0;
  let spawns = 0;
  const calls = [];
  const env = new Proxy(
    { CLOUDFLARE_API_TOKEN: "ambient-token-should-not-be-read" },
    {
      get(target, property, receiver) {
        if (property === "CLOUDFLARE_API_TOKEN") tokenReads += 1;
        return Reflect.get(target, property, receiver);
      },
    },
  );
  const fetchImpl = async () => {
    fetches += 1;
    throw new Error("fetch must remain unavailable");
  };
  const runner = (command, args, options) => {
    spawns += 1;
    calls.push({ command, args: [...args], options });
    const outputFile = options.env.WRANGLER_OUTPUT_FILE_PATH;
    if (outputFile) {
      writeFileSync(
        outputFile,
        `${JSON.stringify({
          type: "version-upload",
          version: 1,
          worker_name: SCHEMA_ORIGIN.worker,
          version_id: VERSION_ID,
        })}\n`,
      );
    }
    return { status: 0, signal: null, stdout: "", stderr: "" };
  };
  return { env, fetchImpl, runner, calls, get tokenReads() { return tokenReads; }, get fetches() { return fetches; }, get spawns() { return spawns; } };
}

function activeSchemas() {
  return Array.from({ length: SCHEMA_ORIGIN.activeSchemaCount }, (_, index) => {
    const bytes = index === SCHEMA_ORIGIN.activeSchemaCount - 1 ? 5_294 : 5_000;
    return {
      bytes,
      projectionPath: `schema-origin/public/schemas/test/v1/schema-${String(index).padStart(2, "0")}.json`,
      sha256: digest(`active-${index}`),
      sourcePath: `spec/schemas/schema-${String(index).padStart(2, "0")}.json`,
      url: `https://forms.takoform.com/schemas/test/v1/schema-${String(index).padStart(2, "0")}.json`,
    };
  });
}

function retiredSchemas() {
  return Array.from({ length: SCHEMA_ORIGIN.retiredSchemaCount }, (_, index) => ({
    sha256: digest(`retired-${index}`),
    url: `https://forms.takoform.com/schemas/retired/v1/schema-${String(index).padStart(2, "0")}.json`,
  }));
}

function preparedAuthority(state = "prepared-writer-disabled") {
  const authority = {
    format: "takoform.specification-authority-transfer@v1",
    state,
    predecessorRepository: SCHEMA_ORIGIN.predecessorRepository,
    predecessorCutoffCommit: "1fa34160a4ed152443b4ea424a324f7677716e36",
    predecessorCutoffTree: "7e4a2578af2f50b826fba1004fdd4e430c761314",
    successorRepository: SCHEMA_ORIGIN.repository,
    lastPredecessorSpecificationRelease: {
      version: "1.1",
      tag: "specification/1.1",
      tagObject: "e2c1ba71766a6b25cae0826df99c8906a7f3f20b",
      releaseId: 377480828,
    },
    predecessorTombstoneCommit: state === "successor-active" ? TOMBSTONE : null,
    successorPreparedCommit: PREPARED_COMMIT,
    schemaRouteCutover: null,
    predecessorWriterDisabledAt: state === "successor-active" ? "2026-08-27T11:40:00Z" : null,
    successorWriterEnabledAt: state === "successor-active" ? "2026-08-27T12:20:01Z" : null,
    writerOverlapAllowed: false,
    rollback: "Before successor activation, abandon the prepared repository and leave the predecessor writer unchanged. After predecessor disablement, repair forward in the successor; never reopen the predecessor writer or recreate Specification 1.1.",
  };
  if (state === "successor-active") {
    authority.schemaRouteCutover = {
      format: "takoform.schema-origin-authority-cutover@v1",
      sourceCommit: COMMIT,
      predecessorTombstoneCommit: TOMBSTONE,
      candidateSha256: digest("candidate"),
      stageRecordSha256: digest("stage"),
      cutoverRecordSha256: digest("cutover"),
      predecessorReadbackSha256: digest("predecessor-readback"),
      routeId: ROUTE_ID,
      routePattern: SCHEMA_ORIGIN.routePattern,
      worker: SCHEMA_ORIGIN.worker,
      versionId: VERSION_ID,
      deploymentId: DEPLOYMENT_ID,
      completedReadbackAt: "2026-08-27T12:10:00Z",
      freshReadbackAt: "2026-08-27T12:20:00Z",
    };
    authority.schemaRouteCutover.closureSha256 =
      schemaRouteCutoverClosureSha256(authority.schemaRouteCutover);
  }
  return authority;
}

function localEvidence(authority = preparedAuthority()) {
  const active = activeSchemas();
  return {
    source: {
      repository: SCHEMA_ORIGIN.repository,
      branch: "main",
      commit: COMMIT,
      canonicalMainCommit: COMMIT,
      clean: true,
    },
    authority: {
      document: authority,
      path: "release/specification-authority.json",
      sha256: digest(canonicalJSON(authority)),
    },
    ledger: {
      path: "release/public-schema-identities.json",
      sha256: digest("ledger"),
    },
    projection: {
      root: "schema-origin/public",
      sha256: digest(canonicalJSON(active)),
      totalBytes: SCHEMA_ORIGIN.activeSchemaBytes,
      entries: active,
    },
    config: {
      path: "schema-origin/wrangler.jsonc",
      sha256: digest("config"),
    },
    retired: retiredSchemas(),
    dryRunBundle: {
      wranglerVersion: SCHEMA_ORIGIN.wranglerVersion,
      sha256: digest("dry-run-bundle"),
      totalBytes: 42,
      files: [{ path: "index.js", bytes: 42, sha256: digest("bundle-file") }],
    },
  };
}

function customDomains() {
  return [
    ["takoform.com", "00000000-0000-4000-8000-000000000001"],
    ["www.takoform.com", "00000000-0000-4000-8000-000000000002"],
    ["forms.takoform.com", "00000000-0000-4000-8000-000000000003"],
  ].map(([hostname, id], index) => ({
    id,
    certId: `10000000-0000-4000-8000-00000000000${index + 1}`,
    hostname,
    service: SCHEMA_ORIGIN.predecessorWorker,
    zoneId: ZONE_ID,
    zoneName: SCHEMA_ORIGIN.zoneName,
    environment: "production",
  }));
}

function activeObservation(entry) {
  return {
    url: entry.url,
    status: 200,
    contentType: "application/json",
    sha256: entry.sha256,
    bytes: entry.bytes,
    redirected: false,
    location: null,
  };
}

function notFoundObservation(url) {
  return {
    url,
    status: 404,
    contentType: "text/plain",
    sha256: digest(`404:${url}`),
    bytes: 9,
    redirected: false,
    location: null,
  };
}

function sentinelObservation() {
  return {
    url: SENTINEL_URL,
    status: 200,
    contentType: "text/html; charset=utf-8",
    sha256: digest("sentinel"),
    bytes: 1234,
    redirected: false,
    location: null,
  };
}

function reviewRecord(candidateBytes) {
  const candidateSha256 = digest(candidateBytes);
  return {
    kind: "takoform.schema-origin-independent-review@v1",
    approved: true,
    sourceCommit: COMMIT,
    candidateSha256,
    reviewer: "independent-reviewer",
    reviewedAt: "2026-08-27T11:30:00Z",
    reviewed: [...SCHEMA_ORIGIN.requiredReviewChecks],
  };
}

function predecessorReadback() {
  return {
    kind: "takoform.schema-origin-predecessor-tombstone-readback@v1",
    predecessorRepository: SCHEMA_ORIGIN.predecessorRepository,
    tombstoneCommit: TOMBSTONE,
    canonicalMainCommit: TOMBSTONE,
    successorRepository: SCHEMA_ORIGIN.repository,
    successorCommit: COMMIT,
    writerState: "disabled",
    disabledAt: "2026-08-27T11:40:00Z",
    readBackAt: "2026-08-27T11:41:00Z",
    reviewer: "independent-reviewer",
    checks: [...SCHEMA_ORIGIN.requiredTombstoneChecks],
  };
}

function makeOperations({ authority = preparedAuthority() } = {}) {
  const records = new Map();
  const calls = [];
  let currentAuthority = authority;
  let routes = [];
  let version = null;
  let deployment = null;
  let versionUploadCount = 0;
  let versionDeployCount = 0;
  let triggerDeployCount = 0;
  let routeDeleteCount = 0;
  let clockReadCount = 0;

  const operations = {
    calls,
    records,
    setAuthority(next) {
      currentAuthority = next;
    },
    setRoutes(next) {
      routes = structuredClone(next);
    },
    setVersion(next) {
      version = structuredClone(next);
    },
    setDeployment(next) {
      deployment = structuredClone(next);
    },
    counts() {
      return { versionUploadCount, versionDeployCount, triggerDeployCount, routeDeleteCount };
    },
    async inspectLocalState(expectedCommit) {
      calls.push("inspect-local");
      if (expectedCommit !== COMMIT) throw new Error("unexpected commit");
      return localEvidence(structuredClone(currentAuthority));
    },
    async readRecord(recordPath) {
      calls.push(`read-record:${recordPath}`);
      if (!records.has(recordPath)) throw new Error(`missing record ${recordPath}`);
      return records.get(recordPath);
    },
    async writeRecord(recordPath, bytes) {
      calls.push(`write-record:${recordPath}`);
      if (records.has(recordPath)) throw new Error(`would overwrite ${recordPath}`);
      records.set(recordPath, bytes);
    },
    async readPublic(url) {
      calls.push(`public:${url}`);
      const active = activeSchemas().find((entry) => entry.url === url);
      if (active) return activeObservation(active);
      if (retiredSchemas().some((entry) => entry.url === url) || url === SCHEMA_ORIGIN.unknownSchemaUrl) {
        return notFoundObservation(url);
      }
      if (url === SENTINEL_URL) return sentinelObservation();
      throw new Error(`unexpected public URL ${url}`);
    },
    async readRoutes() {
      calls.push("read-routes");
      return structuredClone(routes);
    },
    async readCustomDomains() {
      calls.push("read-domains");
      return customDomains();
    },
    async readWorkerState() {
      calls.push("read-worker-state");
      return {
        exists: version !== null,
        versions: version === null ? [] : [structuredClone(version)],
        deployments: deployment === null ? [] : [structuredClone(deployment)],
      };
    },
    async readVersion(_target, versionId) {
      calls.push(`read-version:${versionId}`);
      return structuredClone(version);
    },
    async readDeployment(_target, deploymentId) {
      calls.push(`read-deployment:${deploymentId}`);
      return structuredClone(deployment);
    },
    async uploadVersion(_target, request) {
      calls.push("mutate:upload-version");
      versionUploadCount += 1;
      version = {
        id: VERSION_ID,
        metadata: { source: "wrangler" },
        annotations: { "workers/message": request.message },
        resources: { script: { etag: "etag-1" }, bindings: [] },
      };
      return {
        type: "version-upload",
        version: 1,
        worker_name: SCHEMA_ORIGIN.worker,
        version_id: VERSION_ID,
      };
    },
    async deployVersion(_target, request) {
      calls.push("mutate:deploy-version");
      versionDeployCount += 1;
      deployment = {
        id: DEPLOYMENT_ID,
        strategy: "percentage",
        versions: [{ version_id: request.versionId, percentage: 100 }],
        annotations: { "workers/message": request.message },
      };
      return {
        type: "version-deploy",
        version: 1,
        worker_name: SCHEMA_ORIGIN.worker,
        deployment_id: DEPLOYMENT_ID,
        version_traffic: { [request.versionId]: 100 },
      };
    },
    async deployTriggers() {
      calls.push("mutate:deploy-triggers");
      triggerDeployCount += 1;
      routes = [{ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker }];
    },
    async readPredecessorMain(expectedCommit) {
      calls.push("read-predecessor-main");
      return expectedCommit;
    },
    async now() {
      calls.push("read-clock");
      const instants = [
        "2026-08-27T12:10:00Z",
        "2026-08-27T12:20:00Z",
        "2026-08-27T12:30:00Z",
      ];
      const instant = instants[Math.min(clockReadCount, instants.length - 1)];
      clockReadCount += 1;
      return instant;
    },
    async activationInstantAfter(freshReadbackAt) {
      calls.push("activation-instant");
      return new Date(Date.parse(freshReadbackAt) + 1_000)
        .toISOString()
        .replace(/\.\d{3}Z$/u, "Z");
    },
    async deleteRoute(_target, routeId) {
      calls.push(`mutate:delete-route:${routeId}`);
      routeDeleteCount += 1;
      routes = routes.filter((route) => route.id !== routeId);
      return { id: routeId };
    },
  };
  return operations;
}

async function makePrepared(operations = makeOperations()) {
  await prepareSchemaOrigin({
    phase: "prepare",
    expectedCommit: COMMIT,
    accountId: ACCOUNT_ID,
    zoneId: ZONE_ID,
    sentinelUrl: SENTINEL_URL,
    output: CANDIDATE_PATH,
  }, operations, TOKEN_ENV);
  const candidateBytes = operations.records.get(CANDIDATE_PATH);
  operations.records.set(REVIEW_PATH, canonicalJSON(reviewRecord(candidateBytes)));
  return { operations, candidateBytes, candidate: JSON.parse(candidateBytes) };
}

async function makeStaged(operations = makeOperations()) {
  const prepared = await makePrepared(operations);
  await stageSchemaOrigin({
    phase: "stage",
    expectedCommit: COMMIT,
    candidate: CANDIDATE_PATH,
    reviewRecord: REVIEW_PATH,
    output: STAGE_PATH,
  }, operations, TOKEN_ENV);
  return {
    ...prepared,
    stageBytes: operations.records.get(STAGE_PATH),
    stage: JSON.parse(operations.records.get(STAGE_PATH)),
  };
}

async function makeActivationReady(operations = makeOperations()) {
  const staged = await makeStaged(operations);
  operations.records.set(
    TOMBSTONE_PATH,
    canonicalJSON(predecessorReadback()),
  );
  await cutoverSchemaOrigin({
    phase: "cutover",
    expectedCommit: COMMIT,
    candidate: CANDIDATE_PATH,
    stageRecord: STAGE_PATH,
    predecessorTombstoneCommit: TOMBSTONE,
    predecessorReadback: TOMBSTONE_PATH,
    output: CUTOVER_PATH,
  }, operations, TOKEN_ENV);
  return {
    ...staged,
    cutoverBytes: operations.records.get(CUTOVER_PATH),
    cutover: JSON.parse(operations.records.get(CUTOVER_PATH)),
  };
}

function activationOptions(cutoverBytes) {
  return {
    phase: "prepare-activation",
    expectedCommit: COMMIT,
    candidate: CANDIDATE_PATH,
    stageRecord: STAGE_PATH,
    cutoverRecord: CUTOVER_PATH,
    cutoverRecordSha256: digest(cutoverBytes),
    predecessorTombstoneCommit: TOMBSTONE,
    predecessorReadback: TOMBSTONE_PATH,
    output: ACTIVATION_PATH,
  };
}

describe("strict schema-origin invocation parser", () => {
  test("accepts only the exact phase-specific option set", () => {
    expect(parseSchemaOriginArgs([
      "prepare",
      "--expected-commit", COMMIT,
      "--account-id", ACCOUNT_ID,
      "--zone-id", ZONE_ID,
      "--sentinel-url", SENTINEL_URL,
      "--output", CANDIDATE_PATH,
    ])).toEqual({
      phase: "prepare",
      expectedCommit: COMMIT,
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      sentinelUrl: SENTINEL_URL,
      output: CANDIDATE_PATH,
    });
    expect(parseSchemaOriginArgs(["verify", "--candidate", CANDIDATE_PATH])).toEqual({
      phase: "verify",
      candidate: CANDIDATE_PATH,
    });
    expect(parseSchemaOriginArgs([
      "prepare-activation",
      "--expected-commit", COMMIT,
      "--candidate", CANDIDATE_PATH,
      "--stage-record", STAGE_PATH,
      "--cutover-record", CUTOVER_PATH,
      "--cutover-record-sha256", digest("cutover"),
      "--predecessor-tombstone-commit", TOMBSTONE,
      "--predecessor-readback", TOMBSTONE_PATH,
      "--output", ACTIVATION_PATH,
    ])).toEqual({
      phase: "prepare-activation",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      stageRecord: STAGE_PATH,
      cutoverRecord: CUTOVER_PATH,
      cutoverRecordSha256: digest("cutover"),
      predecessorTombstoneCommit: TOMBSTONE,
      predecessorReadback: TOMBSTONE_PATH,
      output: ACTIVATION_PATH,
    });
  });

  test("rejects duplicate, unknown, relative, token, other-host, schema and v2 inputs", () => {
    for (const args of [
      ["prepare", "--expected-commit", COMMIT, "--expected-commit", COMMIT, "--account-id", ACCOUNT_ID, "--zone-id", ZONE_ID, "--sentinel-url", SENTINEL_URL, "--output", CANDIDATE_PATH],
      ["prepare", "--expected-commit", COMMIT, "--account-id", ACCOUNT_ID, "--zone-id", ZONE_ID, "--sentinel-url", SENTINEL_URL, "--output", "relative.json"],
      ["prepare", "--expected-commit", COMMIT, "--account-id", ACCOUNT_ID, "--zone-id", ZONE_ID, "--sentinel-url", "https://example.com/", "--output", CANDIDATE_PATH],
      ["prepare", "--expected-commit", COMMIT, "--account-id", ACCOUNT_ID, "--zone-id", ZONE_ID, "--sentinel-url", "https://forms.takoform.com/schemas/x.json", "--output", CANDIDATE_PATH],
      ["prepare", "--expected-commit", COMMIT, "--account-id", ACCOUNT_ID, "--zone-id", ZONE_ID, "--sentinel-url", "https://forms.takoform.com/v2", "--output", CANDIDATE_PATH],
      ["verify", "--candidate", CANDIDATE_PATH, "--token", "secret"],
      ["unknown"],
    ]) {
      expect(() => parseSchemaOriginArgs(args)).toThrow();
    }
  });
});

describe("Wrangler subprocess boundary", () => {
  test("uses only isolated allowlisted state and redacts an intentionally printed token", () => {
    const isolationRoot = mkdtempSync(
      path.join(tmpdir(), "schema-origin-env-test-"),
    );
    const token = TOKEN_ENV.CLOUDFLARE_API_TOKEN;
    try {
      const ambient = {
        ...process.env,
        NODE_OPTIONS: "--require=/definitely-not-present/schema-origin-poison.cjs",
        NODE_DEBUG: "http,https",
        DEBUG: "*",
        HTTP_PROXY: "http://attacker.invalid:8080",
        HTTPS_PROXY: "http://attacker.invalid:8080",
        ALL_PROXY: "socks5://attacker.invalid:1080",
        NO_PROXY: "api.cloudflare.com",
        NODE_EXTRA_CA_CERTS: "/attacker/ca.pem",
        SSL_CERT_FILE: "/attacker/ca.pem",
        SSL_CERT_DIR: "/attacker/certs",
        CLOUDFLARE_API_BASE_URL: "https://attacker.invalid/client/v4",
        CF_API_BASE_URL: "https://attacker.invalid/client/v4",
        CF_API_TOKEN: "ambient-token",
        CLOUDFLARE_API_TOKEN: "ambient-cloudflare-token",
        WRANGLER_CONFIG_PATH: "/attacker/wrangler.toml",
        WRANGLER_LOG: "debug",
      };
      const environment = createWranglerSubprocessEnvironment(ambient, {
        accountId: ACCOUNT_ID,
        token,
        outputFile: path.join(isolationRoot, "machine-output.jsonl"),
        isolationRoot,
      });
      const child = spawnSync(
        process.execPath,
        [
          "-e",
          `process.stdout.write(JSON.stringify({keys:Object.keys(process.env).sort(),token:process.env.CLOUDFLARE_API_TOKEN,dangerous:{nodeOptions:process.env.NODE_OPTIONS,proxy:process.env.HTTPS_PROXY,customCA:process.env.NODE_EXTRA_CA_CERTS,apiBase:process.env.CLOUDFLARE_API_BASE_URL,wranglerConfig:process.env.WRANGLER_CONFIG_PATH,ambientToken:process.env.CF_API_TOKEN}}));process.stderr.write(process.env.CLOUDFLARE_API_TOKEN);`,
        ],
        {
          encoding: "utf8",
          env: environment,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      expect(child.status).toBe(0);
      const observed = JSON.parse(child.stdout);
      expect(observed.keys).toEqual(Object.keys(environment).sort());
      expect(observed.dangerous).toEqual({});
      expect(observed.token).toBe(token);
      const safeStdout = redactSubprocessText(child.stdout, token);
      const safeStderr = redactSubprocessText(child.stderr, token);
      expect(`${safeStdout}${safeStderr}`).not.toContain(token);
      expect(safeStdout).toContain("[REDACTED]");
      expect(safeStderr).toBe("[REDACTED]");
      expect(environment.HOME).toBe(path.join(isolationRoot, "home"));
      expect(environment.XDG_CONFIG_HOME).toBe(
        path.join(isolationRoot, "xdg-config"),
      );
    } finally {
      rmSync(isolationRoot, { recursive: true, force: true });
    }
  });
});

describe("sealed schema tool closure", () => {
  test("executes the copied absolute Wrangler entrypoint after source node_modules mutates", async () => {
    const fixture = toolClosureFixture();
    const probe = subprocessProbe();
    let tokenReads = 0;
    const operations = createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
      sealToolClosure({ repositoryRoot, runtimeRoot }) {
        const sealed = sealInstalledToolClosure({ repositoryRoot, runtimeRoot });
        writeFileSync(fixture.sourceExecutable, "#!/usr/bin/env node\nsource-mutated\n", {
          mode: 0o755,
        });
        return sealed;
      },
    });
    const request = {};
    Object.defineProperty(request, "message", {
      value: "sealed-source-test",
      enumerable: true,
    });
    Object.defineProperty(request, "token", {
      get() {
        tokenReads += 1;
        return "credential-token";
      },
      enumerable: true,
    });
    await expect(operations.uploadVersion(
      { accountId: ACCOUNT_ID },
      request,
    )).resolves.toMatchObject({
      type: "version-upload",
      worker_name: SCHEMA_ORIGIN.worker,
      version_id: VERSION_ID,
    });
    expect(probe.spawns).toBe(1);
    expect(probe.fetches).toBe(0);
    expect(probe.tokenReads).toBe(0);
    expect(tokenReads).toBe(1);
    expect(probe.calls[0].args[0]).toContain("sealed-node_modules/wrangler/bin/wrangler.js");
    expect(probe.calls[0].args[0]).not.toBe(fixture.sourceExecutable);
    expect(probe.calls[0].args[0]).not.toContain(`${fixture.root}/node_modules`);
    operations.cleanup();
  });

  test("rejects a tampered copied closure before token, fetch, or spawn observation", async () => {
    const fixture = toolClosureFixture();
    const probe = subprocessProbe();
    let sealedRoot;
    const operations = createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
      sealToolClosure({ repositoryRoot, runtimeRoot }) {
        const sealed = sealInstalledToolClosure({ repositoryRoot, runtimeRoot });
        sealedRoot = sealed.root;
        return sealed;
      },
    });
    writeFileSync(
      path.join(sealedRoot, "wrangler", "bin", "wrangler.js"),
      "#!/usr/bin/env node\ncopied-tampered\n",
      { mode: 0o755 },
    );
    await expect(verifySchemaOrigin(
      { phase: "verify", candidate: CANDIDATE_PATH },
      operations,
      probe.env,
    )).rejects.toMatchObject({
      phase: "verify",
      stage: "sealed-tool-closure",
      externalStateTouched: false,
    });
    expect(probe.tokenReads).toBe(0);
    expect(probe.fetches).toBe(0);
    expect(probe.spawns).toBe(0);
    operations.cleanup();
  });

  test("rejects a wrong tracked closure policy before credential or subprocess access", () => {
    const fixture = toolClosureFixture({
      policy: { manifestSha256: digest("wrong-policy") },
    });
    const probe = subprocessProbe();
    expect(() => createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
    })).toThrow("tracked tool-closure policy");
    expect(probe.tokenReads).toBe(0);
    expect(probe.fetches).toBe(0);
    expect(probe.spawns).toBe(0);
  });

  test("rejects a same-name but differently pinned Node runtime before credential or subprocess access", () => {
    const fixture = toolClosureFixture({
      policy: { runtimeExecutable: "/usr/bin/node" },
    });
    const probe = subprocessProbe();
    expect(() => createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
    })).toThrow("Node runtime bytes");
    expect(probe.tokenReads).toBe(0);
    expect(probe.fetches).toBe(0);
    expect(probe.spawns).toBe(0);
  });

  test("independently rejects repository roots, mode changes, root swaps, and hardlinks", () => {
    const cases = [
      {
        name: "mutable repository node_modules",
        mutate(fixture, sealed) {
          return {
            ...sealed,
            root: path.join(fixture.root, "node_modules"),
            executable: fixture.sourceExecutable,
          };
        },
        message: "outside the repository",
      },
      {
        name: "writable sealed root",
        mutate(_fixture, sealed) {
          chmodSync(sealed.root, 0o755);
          return sealed;
        },
        message: "private read-only",
      },
      {
        name: "swapped sealed root",
        mutate(_fixture, sealed) {
          rmSync(sealed.root, { recursive: true, force: true });
          mkdirSync(sealed.root, { mode: 0o555 });
          return sealed;
        },
        message: "empty",
      },
      {
        name: "hardlinked sealed file",
        mutate(_fixture, sealed) {
          linkSync(
            path.join(sealed.root, "wrangler", "bin", "wrangler.js"),
            path.join(sealed.root, "wrangler", "bin", "hardlink.js"),
          );
          return sealed;
        },
        message: "ordinary file",
      },
    ];
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      cases.push({
        name: "foreign-owned sealed root",
        mutate(_fixture, sealed) {
          chownSync(sealed.root, 65_534, 65_534);
          return sealed;
        },
        message: "owned by root or the current user",
      });
    }
    for (const { name, mutate, message } of cases) {
      const fixture = toolClosureFixture();
      const probe = subprocessProbe();
      expect(() => createSchemaOriginOperations({
        repo: fixture.root,
        env: probe.env,
        fetchImpl: probe.fetchImpl,
        runner: probe.runner,
        sealToolClosure({ repositoryRoot, runtimeRoot }) {
          const sealed = sealInstalledToolClosure({ repositoryRoot, runtimeRoot });
          return mutate(fixture, sealed);
        },
      }), name).toThrow(message);
      expect(probe.tokenReads).toBe(0);
      expect(probe.fetches).toBe(0);
      expect(probe.spawns).toBe(0);
    }
  });

  test("rejects an authority P0 rotation before credential, network, or subprocess access", async () => {
    const fixture = toolClosureFixture();
    const probe = subprocessProbe();
    const operations = createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
    });
    const authority = JSON.parse(readFileSync(fixture.authorityPath, "utf8"));
    authority.successorPreparedCommit = "f".repeat(40);
    writeFileSync(fixture.authorityPath, `${JSON.stringify(authority, null, 2)}\n`);
    await expect(verifySchemaOrigin(
      { phase: "verify", candidate: CANDIDATE_PATH },
      operations,
      probe.env,
    )).rejects.toMatchObject({
      phase: "verify",
      stage: "sealed-tool-closure",
      externalStateTouched: false,
    });
    expect(probe.tokenReads).toBe(0);
    expect(probe.fetches).toBe(0);
    expect(probe.spawns).toBe(0);
    operations.cleanup();
  });

  test("rejects a non-Node parent runtime before token resolution or Wrangler spawn", async () => {
    const fixture = toolClosureFixture();
    let tokenReads = 0;
    const operations = createSchemaOriginOperations({
      repo: fixture.root,
      fetchImpl: async () => {
        throw new Error("network must remain unavailable");
      },
    });
    const request = {
      message: "runtime-mismatch",
      get token() {
        tokenReads += 1;
        return "operator-token-never-print";
      },
    };
    await expect(operations.uploadVersion({ accountId: ACCOUNT_ID }, request)).rejects.toThrow("absolute Node runtime");
    expect(tokenReads).toBe(0);
    operations.cleanup();
  });

  test("parses the pretty tracked policy bytes and compares them with the immutable P0 Git blob", () => {
    const fixture = toolClosureFixture();
    const tracked = readFileSync(fixture.policyPath);
    const p0 = execFileSync(
      "git",
      ["cat-file", "blob", `${fixture.p0Commit}:release/authority/specification-schema-tool-closure.json`],
      { cwd: fixture.root },
    );
    expect(tracked).toEqual(p0);
    expect(parseSchemaToolClosurePolicy(tracked)).toMatchObject({
      fileCount: 3,
      manifestSha256: digest(Buffer.from(canonicalJSON([
        { path: ".bin/wrangler", sha256: digest(Buffer.from("#!/usr/bin/env node\n")), executable: true },
        { path: "wrangler/bin/wrangler.js", sha256: digest(Buffer.from("#!/usr/bin/env node\n")), executable: true },
        { path: "wrangler/package.json", sha256: digest(Buffer.from(JSON.stringify({ version: SCHEMA_ORIGIN.wranglerVersion }))), executable: false },
      ]))),
    });
  });

  test("rejects tracked tool-policy drift against the immutable P0 bytes", async () => {
    const fixture = toolClosureFixture();
    const probe = subprocessProbe();
    const operations = createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
    });
    const policy = JSON.parse(readFileSync(fixture.policyPath, "utf8"));
    policy.fileCount += 1;
    writeFileSync(fixture.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    await expect(verifySchemaOrigin(
      { phase: "verify", candidate: CANDIDATE_PATH },
      operations,
      probe.env,
    )).rejects.toMatchObject({
      phase: "verify",
      stage: "sealed-tool-closure",
      externalStateTouched: false,
    });
    expect(probe.tokenReads).toBe(0);
    expect(probe.fetches).toBe(0);
    expect(probe.spawns).toBe(0);
    operations.cleanup();
  });

  test("retains restartable command and sealed-closure evidence after an external-state readback failure", () => {
    const fixture = toolClosureFixture();
    const probe = subprocessProbe();
    const operations = createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
    });
    operations.uploadVersion(
      { accountId: ACCOUNT_ID },
      { message: "evidence-test", token: "secret-token" },
    );
    operations.retainRecoveryEvidence({
      phase: "stage",
      stage: "staged-version-readback",
    });
    const evidence = operations.getRecoveryEvidence();
    expect(evidence).toHaveLength(1);
    const artifactPath = evidence[0].recoveryArtifact;
    expect(existsSync(artifactPath)).toBe(true);
    expect(existsSync(evidence[0].sealedRoot)).toBe(true);
    expect(existsSync(evidence[0].executionRoot)).toBe(true);
    expect(existsSync(evidence[0].machineOutputPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    expect(artifact.format).toBe("takoform.schema-origin-recovery-evidence@v1");
    expect(artifact.command.slice(0, 4)).toEqual([
      process.execPath,
      path.join(evidence[0].sealedRoot, "wrangler/bin/wrangler.js"),
      "versions",
      "upload",
    ]);
    expect(artifact).toMatchObject({
      machineOutput: {
        type: "version-upload",
        worker_name: SCHEMA_ORIGIN.worker,
        version_id: VERSION_ID,
      },
      sealedClosure: {
        root: evidence[0].sealedRoot,
        executable: path.join(evidence[0].sealedRoot, "wrangler/bin/wrangler.js"),
        fileCount: 3,
      },
    });
    const artifactBytes = readFileSync(artifactPath, "utf8");
    expect(artifactBytes).not.toContain("secret-token");
    expect(artifactBytes).not.toContain("ambient-token-should-not-be-read");
    operations.cleanup();
    expect(existsSync(artifactPath)).toBe(true);
    rmSync(evidence[0].diagnosticRoot, { recursive: true, force: true });
    rmSync(evidence[0].executionRoot, { recursive: true, force: true });
    rmSync(path.dirname(evidence[0].sealedRoot), { recursive: true, force: true });
  });

  test("attaches existing 0600 recovery evidence to the structured readback failure", async () => {
    const fixture = toolClosureFixture();
    const probe = subprocessProbe();
    const fake = await makePrepared();
    const operations = createSchemaOriginOperations({
      repo: fixture.root,
      env: probe.env,
      fetchImpl: probe.fetchImpl,
      runner: probe.runner,
    });
    operations.readRecord = async (recordPath) => {
      if (!fake.operations.records.has(recordPath)) throw new Error(`missing record ${recordPath}`);
      return fake.operations.records.get(recordPath);
    };
    operations.writeRecord = async (recordPath, bytes) => {
      fake.operations.records.set(recordPath, bytes);
    };
    for (const method of [
      "inspectLocalState",
      "readPublic",
      "readRoutes",
      "readCustomDomains",
      "readWorkerState",
      "readDeployment",
    ]) {
      operations[method] = fake.operations[method].bind(fake.operations);
    }
    const uploadVersion = operations.uploadVersion.bind(operations);
    const fakeUploadVersion = fake.operations.uploadVersion.bind(fake.operations);
    operations.uploadVersion = async (target, request) => {
      const output = await uploadVersion(target, request);
      await fakeUploadVersion(target, request);
      return output;
    };
    const fakeReadVersion = fake.operations.readVersion.bind(fake.operations);
    operations.readVersion = async (...args) => {
      await fakeReadVersion(...args);
      throw new Error("fresh readback unavailable");
    };
    const fakeDeployVersion = fake.operations.deployVersion.bind(fake.operations);
    const deployVersion = operations.deployVersion.bind(operations);
    operations.deployVersion = async (target, request) => {
      const output = await deployVersion(target, request);
      await fakeDeployVersion(target, request);
      return output;
    };
    let failure;
    try {
      await stageSchemaOrigin({
        phase: "stage",
        expectedCommit: COMMIT,
        candidate: CANDIDATE_PATH,
        reviewRecord: REVIEW_PATH,
        output: STAGE_PATH,
      }, operations, TOKEN_ENV);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SchemaOriginFailure);
    expect(failure.recoveryEvidence).toHaveLength(1);
    for (const evidence of failure.recoveryEvidence) {
      expect(statSync(evidence.recoveryArtifact).mode & 0o777).toBe(0o600);
      expect(statSync(evidence.diagnosticRoot).mode & 0o777).toBe(0o700);
      expect(statSync(evidence.executionRoot).mode & 0o777).toBe(0o700);
      expect(statSync(evidence.sealedRoot).mode & 0o777).toBe(0o555);
      expect(statSync(evidence.machineOutputPath).mode & 0o777).toBe(0o600);
      const bytes = readFileSync(evidence.recoveryArtifact, "utf8");
      expect(bytes).not.toContain("operator-token-never-print");
      expect(bytes).not.toContain("ambient-token-should-not-be-read");
    }
    operations.cleanup();
    for (const evidence of failure.recoveryEvidence) {
      rmSync(evidence.diagnosticRoot, { recursive: true, force: true });
      rmSync(evidence.executionRoot, { recursive: true, force: true });
    }
    rmSync(path.dirname(failure.recoveryEvidence[0].sealedRoot), {
      recursive: true,
      force: true,
    });
  });
});

describe("prepare and public verification", () => {
  test("prepare is production-mutation-free and emits one canonical outside-repo candidate", async () => {
    const operations = makeOperations();
    const { candidateBytes, candidate } = await makePrepared(operations);
    expect(candidateBytes).toBe(canonicalJSON(candidate));
    expect(candidate.kind).toBe("takoform.schema-origin-cutover-candidate@v1");
    expect(candidate.source.commit).toBe(COMMIT);
    expect(candidate.authority.state).toBe("prepared-writer-disabled");
    expect(candidate.schemas.active).toHaveLength(31);
    expect(candidate.schemas.retired).toHaveLength(15);
    expect(candidate.artifacts.projection.totalBytes).toBe(155_294);
    expect(candidate.preflight.routes).toEqual([]);
    expect(candidate.preflight.customDomains).toEqual(customDomains());
    expect(operations.calls.filter((call) => call.startsWith("mutate:"))).toEqual([]);
  });

  test("prepare requires explicit read authority only when it reaches control-plane preflight", async () => {
    const operations = makeOperations();
    await expect(prepareSchemaOrigin({
      phase: "prepare",
      expectedCommit: COMMIT,
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      sentinelUrl: SENTINEL_URL,
      output: CANDIDATE_PATH,
    }, operations, {})).rejects.toMatchObject({ stage: "control-plane-capability", externalStateTouched: false });
    expect(operations.calls).not.toContain("read-routes");
  });

  test("redirects, partial responses, wrong bytes and retired projection are permanent fences", async () => {
    for (const mutation of [
      (observation) => ({ ...observation, redirected: true }),
      (observation) => ({ ...observation, status: 206 }),
      (observation) => ({ ...observation, sha256: digest("wrong") }),
    ]) {
      const operations = makeOperations();
      const original = operations.readPublic;
      operations.readPublic = async (url) => {
        const observation = await original(url);
        return url === activeSchemas()[0].url ? mutation(observation) : observation;
      };
      await expect(makePrepared(operations)).rejects.toBeInstanceOf(SchemaOriginFailure);
      expect(operations.counts().versionUploadCount).toBe(0);
    }

    const operations = makeOperations();
    const originalInspect = operations.inspectLocalState;
    operations.inspectLocalState = async (...args) => {
      const local = await originalInspect(...args);
      local.projection.entries.push({
        ...local.retired[0],
        sourcePath: "spec/schemas/retired.json",
        projectionPath: "schema-origin/public/schemas/retired.json",
        bytes: 1,
      });
      return local;
    };
    await expect(makePrepared(operations)).rejects.toMatchObject({ stage: "local-closure" });
  });

  test("public verify needs no token, repository, Wrangler or control-plane capability", async () => {
    const { operations } = await makePrepared();
    operations.inspectLocalState = async () => { throw new Error("repository capability must stay lazy"); };
    operations.readRoutes = async () => { throw new Error("control plane must stay lazy"); };
    operations.readCustomDomains = async () => { throw new Error("control plane must stay lazy"); };
    const result = await verifySchemaOrigin({ phase: "verify", candidate: CANDIDATE_PATH }, operations, {});
    expect(result.status).toBe("verified-public-bytes");
    expect(result.controlPlane).toBe("not-requested");
    expect(operations.counts()).toEqual({
      versionUploadCount: 0,
      versionDeployCount: 0,
      triggerDeployCount: 0,
      routeDeleteCount: 0,
    });
  });

  test("authenticated verify closes the exact route and rejects any other or duplicate route/domain", async () => {
    const { operations } = await makePrepared();
    operations.setRoutes([{ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker }]);
    const result = await verifySchemaOrigin({ phase: "verify", candidate: CANDIDATE_PATH }, operations, TOKEN_ENV);
    expect(result.controlPlane).toBe("verified");

    for (const badRoutes of [
      [],
      [{ id: ROUTE_ID, pattern: "forms.takoform.com/*", script: SCHEMA_ORIGIN.worker }],
      [
        { id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker },
        { id: "e".repeat(32), pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker },
      ],
    ]) {
      operations.setRoutes(badRoutes);
      await expect(verifySchemaOrigin({ phase: "verify", candidate: CANDIDATE_PATH }, operations, TOKEN_ENV)).rejects.toMatchObject({ stage: "control-plane-route" });
    }

    operations.setRoutes([{ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker }]);
    operations.readCustomDomains = async () => [...customDomains(), customDomains()[0]];
    await expect(verifySchemaOrigin({ phase: "verify", candidate: CANDIDATE_PATH }, operations, TOKEN_ENV)).rejects.toMatchObject({ stage: "control-plane-custom-domains" });
  });
});

describe("stage", () => {
  test("requires exact review and auth before upload, then deploys the exact version at 100 without routes", async () => {
    const { operations, stage } = await makeStaged();
    expect(stage.versionId).toBe(VERSION_ID);
    expect(stage.deploymentId).toBe(DEPLOYMENT_ID);
    expect(stage.routeState).toBe("absent");
    expect(operations.counts()).toEqual({
      versionUploadCount: 1,
      versionDeployCount: 1,
      triggerDeployCount: 0,
      routeDeleteCount: 0,
    });
    expect(operations.calls.indexOf("mutate:upload-version")).toBeGreaterThan(operations.calls.indexOf(`read-record:${REVIEW_PATH}`));
    expect(operations.calls.filter((call) => call === "read-routes").length).toBeGreaterThanOrEqual(3);
  });

  test("rejects a stale or inexact review before external mutation", async () => {
    const { operations } = await makePrepared();
    const review = JSON.parse(operations.records.get(REVIEW_PATH));
    review.reviewed.pop();
    operations.records.set(REVIEW_PATH, canonicalJSON(review));
    await expect(stageSchemaOrigin({
      phase: "stage",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      reviewRecord: REVIEW_PATH,
      output: STAGE_PATH,
    }, operations, TOKEN_ENV)).rejects.toMatchObject({ stage: "independent-review", externalStateTouched: false });
    expect(operations.counts().versionUploadCount).toBe(0);
  });

  test("rejects missing auth, existing Worker state, route ambiguity and domain drift before upload", async () => {
    for (const setup of [
      (operations) => operations.setVersion({ id: VERSION_ID }),
      (operations) => operations.setRoutes([{ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker }]),
      (operations) => { operations.readCustomDomains = async () => customDomains().slice(1); },
    ]) {
      const { operations } = await makePrepared();
      setup(operations);
      await expect(stageSchemaOrigin({
        phase: "stage",
        expectedCommit: COMMIT,
        candidate: CANDIDATE_PATH,
        reviewRecord: REVIEW_PATH,
        output: STAGE_PATH,
      }, operations, TOKEN_ENV)).rejects.toBeInstanceOf(SchemaOriginFailure);
      expect(operations.counts().versionUploadCount).toBe(0);
    }

    const { operations } = await makePrepared();
    await expect(stageSchemaOrigin({
      phase: "stage",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      reviewRecord: REVIEW_PATH,
      output: STAGE_PATH,
    }, operations, {})).rejects.toMatchObject({ stage: "mutation-capability" });
    expect(operations.counts().versionUploadCount).toBe(0);
  });

  test("rejects ambiguous version or deployment readback and never applies a route", async () => {
    const { operations } = await makePrepared();
    const originalState = operations.readWorkerState;
    operations.readWorkerState = async (...args) => {
      const state = await originalState(...args);
      if (state.versions.length === 1) state.versions.push(structuredClone(state.versions[0]));
      return state;
    };
    await expect(stageSchemaOrigin({
      phase: "stage",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      reviewRecord: REVIEW_PATH,
      output: STAGE_PATH,
    }, operations, TOKEN_ENV)).rejects.toMatchObject({ stage: "staged-version-readback" });
    expect(operations.counts().triggerDeployCount).toBe(0);
  });

  test("reports an upload failure as indeterminate without blind cleanup or retry", async () => {
    const { operations } = await makePrepared();
    operations.uploadVersion = async () => {
      operations.calls.push("mutate:upload-version");
      throw new Error("transport ended after request write");
    };
    await expect(stageSchemaOrigin({
      phase: "stage",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      reviewRecord: REVIEW_PATH,
      output: STAGE_PATH,
    }, operations, TOKEN_ENV)).rejects.toMatchObject({
      stage: "version-upload",
      externalStateTouched: false,
      externalStateIndeterminate: true,
    });
    expect(operations.calls.filter((call) => call === "mutate:upload-version")).toHaveLength(1);
    expect(operations.counts().triggerDeployCount).toBe(0);
  });

  test("requests recovery evidence when a post-upload readback is unavailable", async () => {
    const { operations } = await makePrepared();
    const retained = [];
    operations.retainRecoveryEvidence = (reason) => retained.push(reason);
    operations.readVersion = async () => {
      throw new Error("fresh readback unavailable");
    };
    await expect(stageSchemaOrigin({
      phase: "stage",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      reviewRecord: REVIEW_PATH,
      output: STAGE_PATH,
    }, operations, TOKEN_ENV)).rejects.toMatchObject({
      stage: "staged-version-readback",
      externalStateTouched: true,
      externalStateIndeterminate: true,
    });
    expect(retained).toContainEqual({
      phase: "stage",
      stage: "staged-version-readback",
    });
  });
});

describe("cutover and exact-only revert", () => {
  async function readyCutover() {
    const staged = await makeStaged();
    staged.operations.records.set(TOMBSTONE_PATH, canonicalJSON(predecessorReadback()));
    return staged;
  }

  test("proves predecessor disablement before the only trigger mutation and verifies every post-condition", async () => {
    const { operations } = await readyCutover();
    const result = await cutoverSchemaOrigin({
      phase: "cutover",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      stageRecord: STAGE_PATH,
      predecessorTombstoneCommit: TOMBSTONE,
      predecessorReadback: TOMBSTONE_PATH,
      output: CUTOVER_PATH,
    }, operations, TOKEN_ENV);
    expect(result.route).toEqual({ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker });
    const record = JSON.parse(operations.records.get(CUTOVER_PATH));
    expect(record.completedReadbackAt).toBe("2026-08-27T12:10:00Z");
    expect(record.schemaClosure).toMatchObject({
      activeCount: 31,
      activeBytes: 155_294,
      retiredCount: 15,
      unknown: { url: SCHEMA_ORIGIN.unknownSchemaUrl, status: 404 },
    });
    expect(record.closure).toMatchObject({
      candidateSha256: digest(operations.records.get(CANDIDATE_PATH)),
      stageRecordSha256: digest(operations.records.get(STAGE_PATH)),
      predecessorReadbackSha256: digest(
        operations.records.get(TOMBSTONE_PATH),
      ),
      routeSha256: digest(canonicalJSON(record.route)),
      publicReadbackSha256: digest(canonicalJSON(record.public)),
    });
    expect(operations.calls.indexOf("mutate:deploy-triggers")).toBeGreaterThan(operations.calls.indexOf("read-predecessor-main"));
    expect(operations.counts().triggerDeployCount).toBe(1);
    expect(operations.counts().routeDeleteCount).toBe(0);
  });

  test("wrong tombstone pin/order, active authority, route presence or non-100 deployment blocks before trigger", async () => {
    for (const setup of [
      ({ operations }) => {
        const record = predecessorReadback();
        record.successorCommit = "f".repeat(40);
        operations.records.set(TOMBSTONE_PATH, canonicalJSON(record));
      },
      ({ operations }) => {
        const record = predecessorReadback();
        record.readBackAt = record.disabledAt;
        operations.records.set(TOMBSTONE_PATH, canonicalJSON(record));
      },
      ({ operations }) => operations.setAuthority(preparedAuthority("successor-active")),
      ({ operations }) => operations.setRoutes([{ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker }]),
      ({ operations }) => {
        operations.setDeployment({
          id: DEPLOYMENT_ID,
          strategy: "percentage",
          versions: [{ version_id: VERSION_ID, percentage: 50 }],
          annotations: { "workers/message": "wrong" },
        });
      },
    ]) {
      const ready = await readyCutover();
      setup(ready);
      await expect(cutoverSchemaOrigin({
        phase: "cutover",
        expectedCommit: COMMIT,
        candidate: CANDIDATE_PATH,
        stageRecord: STAGE_PATH,
        predecessorTombstoneCommit: TOMBSTONE,
        predecessorReadback: TOMBSTONE_PATH,
        output: CUTOVER_PATH,
      }, ready.operations, TOKEN_ENV)).rejects.toBeInstanceOf(SchemaOriginFailure);
      expect(ready.operations.counts().triggerDeployCount).toBe(0);
    }
  });

  test("a trigger transport failure is indeterminate and is never auto-reverted", async () => {
    const { operations } = await readyCutover();
    operations.deployTriggers = async () => {
      operations.calls.push("mutate:deploy-triggers");
      throw new Error("connection lost");
    };
    await expect(cutoverSchemaOrigin({
      phase: "cutover",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      stageRecord: STAGE_PATH,
      predecessorTombstoneCommit: TOMBSTONE,
      predecessorReadback: TOMBSTONE_PATH,
      output: CUTOVER_PATH,
    }, operations, TOKEN_ENV)).rejects.toMatchObject({
      stage: "route-trigger-deploy",
      externalStateTouched: false,
      externalStateIndeterminate: true,
    });
    expect(operations.counts().routeDeleteCount).toBe(0);
  });

  test("post-cutover negative URLs are status fences, while the non-schema sentinel remains byte-exact", async () => {
    const first = await readyCutover();
    const firstPublic = first.operations.readPublic;
    first.operations.readPublic = async (url) => {
      const observation = await firstPublic(url);
      if (
        first.operations.counts().triggerDeployCount === 1 &&
        observation.status === 404
      ) {
        return {
          ...observation,
          contentType: "application/json",
          sha256: digest(`new-worker-404:${url}`),
          bytes: 0,
        };
      }
      return observation;
    };
    await expect(cutoverSchemaOrigin({
      phase: "cutover",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      stageRecord: STAGE_PATH,
      predecessorTombstoneCommit: TOMBSTONE,
      predecessorReadback: TOMBSTONE_PATH,
      output: CUTOVER_PATH,
    }, first.operations, TOKEN_ENV)).resolves.toMatchObject({ status: "cutover-verified-writer-still-disabled" });

    const second = await readyCutover();
    const secondPublic = second.operations.readPublic;
    second.operations.readPublic = async (url) => {
      const observation = await secondPublic(url);
      if (
        second.operations.counts().triggerDeployCount === 1 &&
        url === SENTINEL_URL
      ) {
        return { ...observation, sha256: digest("sentinel-drift") };
      }
      return observation;
    };
    await expect(cutoverSchemaOrigin({
      phase: "cutover",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      stageRecord: STAGE_PATH,
      predecessorTombstoneCommit: TOMBSTONE,
      predecessorReadback: TOMBSTONE_PATH,
      output: CUTOVER_PATH,
    }, second.operations, TOKEN_ENV)).rejects.toMatchObject({
      stage: "public-candidate-readback",
      externalStateTouched: true,
      externalStateIndeterminate: false,
    });
  });

  test("revert deletes only the supplied exact route and proves old fallback bytes", async () => {
    const { operations } = await readyCutover();
    await cutoverSchemaOrigin({
      phase: "cutover",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      stageRecord: STAGE_PATH,
      predecessorTombstoneCommit: TOMBSTONE,
      predecessorReadback: TOMBSTONE_PATH,
      output: CUTOVER_PATH,
    }, operations, TOKEN_ENV);
    const result = await revertSchemaOrigin({
      phase: "revert",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      routeId: ROUTE_ID,
      script: SCHEMA_ORIGIN.worker,
      output: REVERT_PATH,
    }, operations, TOKEN_ENV);
    expect(result.routeState).toBe("absent");
    expect(operations.counts().routeDeleteCount).toBe(1);
    expect(operations.counts().versionUploadCount).toBe(1);
    expect(operations.counts().versionDeployCount).toBe(1);
    expect(operations.calls.filter((call) => call.startsWith("mutate:"))).toEqual([
      "mutate:upload-version",
      "mutate:deploy-version",
      "mutate:deploy-triggers",
      `mutate:delete-route:${ROUTE_ID}`,
    ]);
  });

  test("revert refuses a wrong ID/script/candidate, ambiguity, missing route and successor-active state before delete", async () => {
    const buildCutoverState = async () => {
      const ready = await readyCutover();
      ready.operations.setRoutes([{ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker }]);
      return ready;
    };
    const scenarios = [
      { options: { routeId: "e".repeat(32), script: SCHEMA_ORIGIN.worker } },
      { options: { routeId: ROUTE_ID, script: "other-worker" } },
      { options: { routeId: ROUTE_ID, script: SCHEMA_ORIGIN.worker }, setup: ({ operations }) => operations.setRoutes([]) },
      { options: { routeId: ROUTE_ID, script: SCHEMA_ORIGIN.worker }, setup: ({ operations }) => operations.setRoutes([
        { id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker },
        { id: "e".repeat(32), pattern: "forms.takoform.com/other/*", script: "other" },
      ]) },
      { options: { routeId: ROUTE_ID, script: SCHEMA_ORIGIN.worker }, setup: ({ operations }) => operations.setAuthority(preparedAuthority("successor-active")) },
    ];
    for (const scenario of scenarios) {
      const ready = await buildCutoverState();
      scenario.setup?.(ready);
      await expect(revertSchemaOrigin({
        phase: "revert",
        expectedCommit: COMMIT,
        candidate: CANDIDATE_PATH,
        routeId: scenario.options.routeId,
        script: scenario.options.script,
        output: REVERT_PATH,
      }, ready.operations, TOKEN_ENV)).rejects.toBeInstanceOf(SchemaOriginFailure);
      expect(ready.operations.counts().routeDeleteCount).toBe(0);
    }
  });

  test("successor-active revert failure explicitly requires forward repair without mutation authority", async () => {
    const { operations } = await makePrepared();
    operations.setAuthority(preparedAuthority("successor-active"));
    operations.setRoutes([{ id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker }]);
    await expect(revertSchemaOrigin({
      phase: "revert",
      expectedCommit: COMMIT,
      candidate: CANDIDATE_PATH,
      routeId: ROUTE_ID,
      script: SCHEMA_ORIGIN.worker,
      output: REVERT_PATH,
    }, operations, {})).rejects.toMatchObject({
      stage: "authority-state",
      externalStateTouched: false,
      message: expect.stringMatching(/forward repair/i),
    });
    expect(operations.counts().routeDeleteCount).toBe(0);
  });
});

describe("authority activation preparation", () => {
  test("freshly closes cutover and emits only the exact successor-active authority change", async () => {
    const ready = await makeActivationReady();
    const beforeCounts = ready.operations.counts();
    const callBoundary = ready.operations.calls.length;
    const result = await prepareSchemaOriginAuthorityActivation(
      activationOptions(ready.cutoverBytes),
      ready.operations,
      TOKEN_ENV,
    );
    const activationCalls = ready.operations.calls.slice(callBoundary);
    const evidenceBytes = ready.operations.records.get(ACTIVATION_PATH);
    const evidence = JSON.parse(evidenceBytes);
    expect(evidenceBytes).toBe(canonicalJSON(evidence));
    expect(result.status).toBe("authority-activation-evidence-prepared");
    expect(result.authority).toEqual(evidence.authority);
    expect(evidence).toMatchObject({
      kind: "takoform.schema-origin-authority-activation-evidence@v1",
      sourceCommit: COMMIT,
      cutoverRecordSha256: digest(ready.cutoverBytes),
      predecessorTombstoneCommit: TOMBSTONE,
      predecessorCanonicalMainCommit: TOMBSTONE,
      route: {
        id: ROUTE_ID,
        pattern: SCHEMA_ORIGIN.routePattern,
        script: SCHEMA_ORIGIN.worker,
      },
      schemaClosure: {
        activeCount: 31,
        activeBytes: 155_294,
        retiredCount: 15,
        unknown: { url: SCHEMA_ORIGIN.unknownSchemaUrl, status: 404 },
      },
      freshReadbackAt: "2026-08-27T12:20:00Z",
      activationChange: {
        parentCommit: COMMIT,
        changedPaths: [SCHEMA_ORIGIN.authorityPath],
        stateTransition: "prepared-writer-disabled -> successor-active",
        externalMutation: false,
        apiV2Mutation: false,
        notBefore: "2026-08-27T12:20:01Z",
      },
    });
    expect(evidence.authority).toEqual({
      ...preparedAuthority(),
      state: "successor-active",
      predecessorTombstoneCommit: TOMBSTONE,
      schemaRouteCutover: evidence.schemaRouteCutover,
      predecessorWriterDisabledAt: "2026-08-27T11:40:00Z",
      successorWriterEnabledAt: "2026-08-27T12:20:01Z",
    });
    expect(evidence.schemaRouteCutover).toEqual({
      format: "takoform.schema-origin-authority-cutover@v1",
      sourceCommit: COMMIT,
      predecessorTombstoneCommit: TOMBSTONE,
      candidateSha256: digest(ready.candidateBytes),
      stageRecordSha256: digest(ready.stageBytes),
      cutoverRecordSha256: digest(ready.cutoverBytes),
      predecessorReadbackSha256: digest(
        ready.operations.records.get(TOMBSTONE_PATH),
      ),
      routeId: ROUTE_ID,
      routePattern: SCHEMA_ORIGIN.routePattern,
      worker: SCHEMA_ORIGIN.worker,
      versionId: VERSION_ID,
      deploymentId: DEPLOYMENT_ID,
      completedReadbackAt: "2026-08-27T12:10:00Z",
      freshReadbackAt: "2026-08-27T12:20:00Z",
      closureSha256: schemaRouteCutoverClosureSha256(
        evidence.schemaRouteCutover,
      ),
    });
    expect(Object.keys(evidence.schemaRouteCutover)).toHaveLength(15);
    expect(evidence.authority.schemaRouteCutover).toEqual(
      evidence.schemaRouteCutover,
    );
    expect(result.schemaRouteCutover).toEqual(evidence.schemaRouteCutover);
    expect(evidence.authoritySha256).toBe(
      digest(canonicalJSON(evidence.authority)),
    );
    expect(evidence.closure).toMatchObject({
      candidateSha256: digest(ready.candidateBytes),
      stageRecordSha256: digest(ready.stageBytes),
      cutoverRecordSha256: digest(ready.cutoverBytes),
      authoritySha256: evidence.authoritySha256,
      schemaRouteCutoverSha256: digest(
        canonicalJSON(evidence.schemaRouteCutover),
      ),
    });
    expect(Date.parse(evidence.authority.successorWriterEnabledAt)).toBeGreaterThan(
      Date.parse(evidence.freshReadbackAt),
    );
    expect(ready.operations.counts()).toEqual(beforeCounts);
    expect(activationCalls.filter((call) => call.startsWith("mutate:"))).toEqual([]);
    expect(activationCalls.indexOf("read-predecessor-main")).toBeGreaterThan(
      activationCalls.indexOf("inspect-local"),
    );
    expect(activationCalls.indexOf("read-routes")).toBeGreaterThan(
      activationCalls.indexOf("inspect-local"),
    );
  });

  test("the embedded route cutover rejects every digest, id, time, source, and closure mismatch", async () => {
    const ready = await makeActivationReady();
    await prepareSchemaOriginAuthorityActivation(
      activationOptions(ready.cutoverBytes),
      ready.operations,
      TOKEN_ENV,
    );
    const authority = JSON.parse(
      ready.operations.records.get(ACTIVATION_PATH),
    ).authority;
    const mutations = [
      ["format", (cutover) => { cutover.format = "unknown"; }],
      ["source", (cutover) => { cutover.sourceCommit = "f".repeat(40); }],
      ["tombstone", (cutover) => { cutover.predecessorTombstoneCommit = "e".repeat(40); }],
      ["candidate digest", (cutover) => { cutover.candidateSha256 = digest("wrong-candidate"); }],
      ["stage digest", (cutover) => { cutover.stageRecordSha256 = digest("wrong-stage"); }],
      ["cutover digest", (cutover) => { cutover.cutoverRecordSha256 = digest("wrong-cutover"); }],
      ["predecessor digest", (cutover) => { cutover.predecessorReadbackSha256 = digest("wrong-predecessor"); }],
      ["route id", (cutover) => { cutover.routeId = "e".repeat(32); }],
      ["route pattern", (cutover) => { cutover.routePattern = "forms.takoform.com/*"; }],
      ["worker", (cutover) => { cutover.worker = "other-worker"; }],
      ["version id", (cutover) => { cutover.versionId = "21111111-2222-4333-8444-555555555555"; }],
      ["deployment id", (cutover) => { cutover.deploymentId = "76666666-7777-4888-8999-aaaaaaaaaaaa"; }],
      ["completed time", (cutover) => { cutover.completedReadbackAt = "2026-08-27T12:10:01Z"; }],
      ["fresh time", (cutover) => { cutover.freshReadbackAt = "2026-08-27T12:20:01Z"; }],
      ["closure digest", (cutover) => { cutover.closureSha256 = digest("wrong-closure"); }],
    ];
    for (const [label, mutate] of mutations) {
      const changed = structuredClone(authority);
      mutate(changed.schemaRouteCutover);
      expect(validateAuthorityTransfer(changed), label).toContain(
        "active authority receipt has an invalid schema-route cutover closure",
      );
    }
  });

  test("upstream evidence mismatches cannot be normalized into authority cutover evidence", async () => {
    const scenarios = [
      ["source", (record) => { record.sourceCommit = "f".repeat(40); }],
      ["tombstone", (record) => { record.predecessorTombstoneCommit = "e".repeat(40); }],
      ["candidate digest", (record) => { record.candidateSha256 = digest("wrong-candidate"); }],
      ["stage digest", (record) => { record.stageRecordSha256 = digest("wrong-stage"); }],
      ["predecessor digest", (record) => { record.predecessorReadbackSha256 = digest("wrong-predecessor"); }],
      ["route id", (record) => { record.route.id = "e".repeat(32); }],
      ["route pattern", (record) => { record.route.pattern = "forms.takoform.com/*"; }],
      ["worker", (record) => { record.route.script = "other-worker"; }],
      ["version id", (record) => { record.versionId = "21111111-2222-4333-8444-555555555555"; }],
      ["deployment id", (record) => { record.deploymentId = "76666666-7777-4888-8999-aaaaaaaaaaaa"; }],
      ["completed time", (record) => { record.completedReadbackAt = "2026-08-27T11:41:00Z"; }],
      ["closure digest", (record) => { record.closure.routeSha256 = digest("wrong-route"); }],
    ];
    for (const [label, mutate] of scenarios) {
      const ready = await makeActivationReady();
      const changed = structuredClone(ready.cutover);
      mutate(changed);
      const changedBytes = canonicalJSON(changed);
      ready.operations.records.set(CUTOVER_PATH, changedBytes);
      await expect(prepareSchemaOriginAuthorityActivation(
        activationOptions(changedBytes),
        ready.operations,
        TOKEN_ENV,
      ), label).rejects.toMatchObject({
        stage: "cutover-record-closure",
        externalStateTouched: false,
      });
      expect(ready.operations.records.has(ACTIVATION_PATH), label).toBe(false);
    }

    const freshTime = await makeActivationReady();
    freshTime.operations.now = async () =>
      freshTime.cutover.completedReadbackAt;
    await expect(prepareSchemaOriginAuthorityActivation(
      activationOptions(freshTime.cutoverBytes),
      freshTime.operations,
      TOKEN_ENV,
    )).rejects.toMatchObject({
      stage: "fresh-readback-instant",
      externalStateTouched: false,
    });
    expect(freshTime.operations.records.has(ACTIVATION_PATH)).toBe(false);
  });

  test("prepared authority is a hard fence before control-plane or signer capability", async () => {
    const ready = await makeActivationReady();
    ready.operations.setAuthority(preparedAuthority("successor-active"));
    let signerCalled = false;
    let tokenRead = false;
    ready.operations.signAuthority = async () => {
      signerCalled = true;
      throw new Error("signer must remain unavailable");
    };
    const guardedEnv = new Proxy({}, {
      get(_target, property) {
        if (property === "CLOUDFLARE_API_TOKEN") tokenRead = true;
        return undefined;
      },
    });
    const callBoundary = ready.operations.calls.length;
    await expect(prepareSchemaOriginAuthorityActivation(
      activationOptions(ready.cutoverBytes),
      ready.operations,
      guardedEnv,
    )).rejects.toMatchObject({
      phase: "prepare-activation",
      stage: "prepared-authority",
      externalStateTouched: false,
    });
    const activationCalls = ready.operations.calls.slice(callBoundary);
    expect(activationCalls).toContain("inspect-local");
    expect(activationCalls).not.toContain("read-predecessor-main");
    expect(activationCalls).not.toContain("read-routes");
    expect(signerCalled).toBe(false);
    expect(tokenRead).toBe(false);
  });

  test("rejects an unpinned, tampered, stale, or non-ordered closure without mutation", async () => {
    {
      const ready = await makeActivationReady();
      await expect(prepareSchemaOriginAuthorityActivation({
        ...activationOptions(ready.cutoverBytes),
        cutoverRecordSha256: digest("wrong-cutover-record"),
      }, ready.operations, TOKEN_ENV)).rejects.toMatchObject({
        stage: "cutover-record-digest",
        externalStateTouched: false,
      });
    }
    {
      const ready = await makeActivationReady();
      const tampered = structuredClone(ready.cutover);
      tampered.route.id = "e".repeat(32);
      const tamperedBytes = canonicalJSON(tampered);
      ready.operations.records.set(CUTOVER_PATH, tamperedBytes);
      const callBoundary = ready.operations.calls.length;
      await expect(prepareSchemaOriginAuthorityActivation(
        activationOptions(tamperedBytes),
        ready.operations,
        TOKEN_ENV,
      )).rejects.toMatchObject({
        stage: "cutover-record-closure",
        externalStateTouched: false,
      });
      expect(ready.operations.calls.slice(callBoundary)).not.toContain("read-routes");
    }
    {
      const ready = await makeActivationReady();
      ready.operations.setRoutes([
        { id: ROUTE_ID, pattern: SCHEMA_ORIGIN.routePattern, script: SCHEMA_ORIGIN.worker },
        { id: "e".repeat(32), pattern: "forms.takoform.com/other/*", script: "other" },
      ]);
      await expect(prepareSchemaOriginAuthorityActivation(
        activationOptions(ready.cutoverBytes),
        ready.operations,
        TOKEN_ENV,
      )).rejects.toMatchObject({ stage: "fresh-sole-route" });
      expect(ready.operations.counts().routeDeleteCount).toBe(0);
    }
    {
      const ready = await makeActivationReady();
      ready.operations.setDeployment({
        id: DEPLOYMENT_ID,
        strategy: "percentage",
        versions: [{ version_id: VERSION_ID, percentage: 50 }],
        annotations: { "workers/message": "drifted" },
      });
      await expect(prepareSchemaOriginAuthorityActivation(
        activationOptions(ready.cutoverBytes),
        ready.operations,
        TOKEN_ENV,
      )).rejects.toMatchObject({ stage: "fresh-staged-state" });
      expect(ready.operations.counts().triggerDeployCount).toBe(1);
    }
    {
      const ready = await makeActivationReady();
      const originalReadPublic = ready.operations.readPublic;
      ready.operations.readPublic = async (url) => {
        const observation = await originalReadPublic(url);
        return url === SENTINEL_URL
          ? { ...observation, sha256: digest("fresh-sentinel-drift") }
          : observation;
      };
      await expect(prepareSchemaOriginAuthorityActivation(
        activationOptions(ready.cutoverBytes),
        ready.operations,
        TOKEN_ENV,
      )).rejects.toMatchObject({
        stage: "public-candidate-readback",
        externalStateTouched: false,
      });
    }
    {
      const ready = await makeActivationReady();
      ready.operations.activationInstantAfter = async (freshReadbackAt) =>
        freshReadbackAt;
      await expect(prepareSchemaOriginAuthorityActivation(
        activationOptions(ready.cutoverBytes),
        ready.operations,
        TOKEN_ENV,
      )).rejects.toMatchObject({
        stage: "successor-writer-enabled-instant",
        externalStateTouched: false,
      });
      expect(ready.operations.counts()).toEqual({
        versionUploadCount: 1,
        versionDeployCount: 1,
        triggerDeployCount: 1,
        routeDeleteCount: 0,
      });
    }
  });
});
