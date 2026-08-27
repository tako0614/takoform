import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  chownSync,
  chmodSync,
  linkSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import process from "node:process";
import { basename, dirname, join, resolve } from "node:path";

import {
  SPECIFICATION_RELEASE_ADAPTER,
  SPECIFICATION_RELEASE_REVIEW,
  createSpecificationReleaseOperations,
  createSpecificationWranglerEnvironment,
  sealInstalledToolClosure,
  verifySpecificationReleaseIndependentReview,
} from "./specification-release-adapter.mjs";
import {
  E_TO_R_TRACKED_PATHS,
  SOURCE_PINNED_EXECUTION_PATHS,
  WRITER_TOOL_CLOSURE_POLICY_PATH,
  canonicalJSON,
} from "./specification-release.mjs";

const SOURCE_ROOT = resolve(import.meta.dirname, "..");
const P0 = "0".repeat(40);
const D = "8".repeat(40);
const N = "a".repeat(40);
const E = "b".repeat(40);
const R = "c".repeat(40);
const VERSION = "1.2";
const TAG = `specification/${VERSION}`;
const ACCOUNT_ID = "1".repeat(32);
const ZONE_ID = "2".repeat(32);
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const DEPLOYMENT_ID = "22222222-2222-4222-8222-222222222222";
const TAG_OBJECT = "9".repeat(40);
const RULESET_ID = 4242;
const temporaryRoots = [];

function releaseOptions(overrides = {}) {
  return {
    authority: { successorPreparedCommit: P0 },
    lane: "composed",
    version: VERSION,
    expectedDCommit: D,
    expectedNCommit: N,
    expectedECommit: E,
    ...overrides,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function response(url, status, bytes, {
  redirected = false,
  headers = {},
} = {}) {
  const body = Buffer.from(bytes);
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    redirected,
    headers: new Headers(headers),
    async arrayBuffer() {
      return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
    },
  };
}

function jsonResponse(url, status, value, options) {
  return response(url, status, Buffer.from(JSON.stringify(value)), {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
}

function fixtureRepository() {
  const parent = mkdtempSync(join(tmpdir(), "takoform-spec-adapter-test-"));
  temporaryRoots.push(parent);
  const repo = join(parent, "repo");
  mkdirSync(join(repo, "release", "authority"), { recursive: true });
  mkdirSync(join(repo, "schema-origin"), { recursive: true });
  mkdirSync(join(repo, "node_modules", "wrangler"), { recursive: true });
  mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
  writeFileSync(
    join(repo, SPECIFICATION_RELEASE_ADAPTER.tagAllowedSigners),
    readFileSync(join(SOURCE_ROOT, SPECIFICATION_RELEASE_ADAPTER.tagAllowedSigners)),
  );
  writeFileSync(
    join(repo, "release", "authority", "record-head-ed25519.pub.pem"),
    readFileSync(join(SOURCE_ROOT, "release/authority/record-head-ed25519.pub.pem")),
  );
  const config = Buffer.from(`${JSON.stringify({
    $schema: "../node_modules/wrangler/config-schema.json",
    name: SPECIFICATION_RELEASE_ADAPTER.worker,
    compatibility_date: "2026-08-27",
    workers_dev: false,
    preview_urls: false,
    routes: [{
      pattern: SPECIFICATION_RELEASE_ADAPTER.route,
      zone_name: SPECIFICATION_RELEASE_ADAPTER.zoneName,
    }],
    assets: {
      directory: "./public",
      html_handling: "none",
      not_found_handling: "none",
    },
  }, null, 2)}\n`);
  writeFileSync(join(repo, SPECIFICATION_RELEASE_ADAPTER.configPath), config);
  writeFileSync(
    join(repo, "node_modules", "wrangler", "package.json"),
    JSON.stringify({ version: SPECIFICATION_RELEASE_ADAPTER.wranglerVersion }),
  );
  mkdirSync(join(repo, "node_modules", "wrangler", "bin"), { recursive: true });
  writeFileSync(
    join(repo, "node_modules", "wrangler", "bin", "wrangler.js"),
    "#!/usr/bin/env node\n",
    { mode: 0o755 },
  );
  symlinkSync(
    "../wrangler/bin/wrangler.js",
    join(repo, "node_modules", ".bin", "wrangler"),
  );
  for (const [path, value] of [
    ["release/specification-releases.json", {}],
    ["release/public-schema-identities.json", {}],
    ["release/record-prefix-chain.json", {}],
    ["release/record-head.json", {}],
    ["release/record-head.sig.json", {}],
  ]) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), `${JSON.stringify(value, null, 2)}\n`);
  }
  return { parent, repo, config };
}

function fixtureToolPolicyRaw() {
  const executable = Buffer.from("#!/usr/bin/env node\n");
  const metadata = Buffer.from(JSON.stringify({
    version: SPECIFICATION_RELEASE_ADAPTER.wranglerVersion,
  }));
  const records = [
    {
      path: ".bin/wrangler",
      sha256: sha256(executable),
      executable: true,
    },
    {
      path: "wrangler/bin/wrangler.js",
      sha256: sha256(executable),
      executable: true,
    },
    {
      path: "wrangler/package.json",
      sha256: sha256(metadata),
      executable: false,
    },
  ];
  return Buffer.from(canonicalJSON({
    format: "takoform.specification-schema-tool-closure@v1",
    platform: process.platform,
    architecture: process.arch,
    runtimeExecutable: "/usr/local/bin/node",
    runtimeVersion: "v26.1.0",
    runtimeSha256: "sha256:da220b82279ed9885a7759f6efb8c4b9351ece579f93429bf7b7d2fbd481bcf8",
    closureRoot: "node_modules",
    executable: "wrangler/bin/wrangler.js",
    wranglerVersion: SPECIFICATION_RELEASE_ADAPTER.wranglerVersion,
    fileCount: records.length,
    manifestSha256: sha256(Buffer.from(canonicalJSON(records))),
  }));
}

function releaseFixture(repository) {
  const id = "https://forms.takoform.com/schemas/future/v1/example.schema.json";
  const schemaBytes = Buffer.from(`${JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    type: "object",
  }, null, 2)}\n`);
  const schemaCandidate = {
    format: "takoform.specification-schema-origin-candidate@v1",
    sourceCommit: N,
    worker: SPECIFICATION_RELEASE_ADAPTER.worker,
    route: SPECIFICATION_RELEASE_ADAPTER.route,
    target: {
      accountId: ACCOUNT_ID,
      zoneId: ZONE_ID,
      zoneName: SPECIFICATION_RELEASE_ADAPTER.zoneName,
    },
    wrangler: {
      version: SPECIFICATION_RELEASE_ADAPTER.wranglerVersion,
      configPath: SPECIFICATION_RELEASE_ADAPTER.configPath,
      configSha256: sha256(repository.config),
    },
    schemaSeal: {
      sequence: 2,
      entrySha256: `sha256:${"3".repeat(64)}`,
    },
    assets: [{
      url: id,
      path: "schemas/future/v1/example.schema.json",
      source: "spec/schemas/example.schema.json",
      sha256: sha256(schemaBytes),
      bytesBase64: schemaBytes.toString("base64"),
    }],
    retired404: [],
  };
  const schemaCandidateRaw = Buffer.from(canonicalJSON(schemaCandidate));
  const outer = {
    format: "takoform.publication-candidate@v1",
    lanes: { specification: true, schema: true },
    version: VERSION,
    title: `Takoform Specification ${VERSION}`,
    tag: TAG,
    canonicalCommit: D,
    normativeCommit: D,
    reservationCommit: N,
    schemaOrigin: {
      candidateSha256: sha256(schemaCandidateRaw),
      candidateBytesBase64: schemaCandidateRaw.toString("base64"),
    },
    githubRelease: {
      body: "Fixture direct asset-free immutable Release body",
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [],
    },
  };
  const candidateRaw = Buffer.from(canonicalJSON(outer));
  writeFileSync(join(repository.repo, "release/specification-release-candidate.json"), candidateRaw);
  return { outer, candidateRaw, schemaCandidate, schemaCandidateRaw, schemaBytes };
}

function exactReview(path, fixture, overrides = {}) {
  const review = {
    format: SPECIFICATION_RELEASE_REVIEW.format,
    approved: true,
    reviewer: "independent-reviewer",
    reviewedAt: "2026-08-27T12:00:00Z",
    lanes: { specification: true, schema: true },
    version: VERSION,
    expectedDCommit: D,
    expectedNCommit: N,
    expectedECommit: E,
    candidateSha256: sha256(fixture.candidateRaw),
    schemaOriginCandidateSha256: sha256(fixture.schemaCandidateRaw),
    recovery: false,
    reviewed: [...SPECIFICATION_RELEASE_REVIEW.reviewed],
    ...overrides,
  };
  writeFileSync(path, canonicalJSON(review), { mode: 0o600 });
  return review;
}

function fakeRunner(repository, state = {}) {
  state.head ??= E;
  state.remoteTag ??= false;
  state.calls ??= [];
  const tagAnnotation = () => [
    `object ${E}`,
    "type commit",
    `tag ${TAG}`,
    "tagger Fixture <fixture@example.com> 1 +0000",
    "",
    `Takoform Specification ${VERSION}`,
    "",
    `Normative commit: ${D}`,
    `Candidate: ${sha256(state.fixture.candidateRaw)}`,
    "-----BEGIN SSH SIGNATURE-----",
    "AAAA",
    "-----END SSH SIGNATURE-----",
    "",
  ].join("\n");
  return (command, args, options = {}) => {
    state.calls.push({ command, args: [...args], options });
    const ok = (stdout = "") => ({ status: 0, signal: null, stdout, stderr: "" });
    if (command === "ssh-keygen") {
      if (args[0] === "-y") {
        return ok("ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIPCvfYukIC7Jlny4FZ5QLAqdp4lvskqR/bh5+OFCkdPB\n");
      }
      return ok(`256 ${SPECIFICATION_RELEASE_ADAPTER.tagSignerFingerprint} fixture (ED25519)\n`);
    }
    if (
      command === process.execPath &&
      args[0]?.endsWith("/sealed-node_modules/wrangler/bin/wrangler.js")
    ) {
      if (state.failWrangler) {
        return {
          status: 1,
          signal: null,
          stdout: "",
          stderr: `wrangler failed ${options.env.CLOUDFLARE_API_TOKEN}`,
        };
      }
      if (args.includes("upload")) {
        state.version = {
          id: VERSION_ID,
          annotations: {
            "workers/tag": `specification-${sha256(state.fixture.schemaCandidateRaw).slice(7)}`,
            "workers/message":
              `Takoform Specification schema ${sha256(state.fixture.schemaCandidateRaw)}; release ${sha256(state.fixture.candidateRaw)}`,
          },
        };
        writeFileSync(
          options.env.WRANGLER_OUTPUT_FILE_PATH,
          `${JSON.stringify({
            type: "version-upload",
            worker_name: SPECIFICATION_RELEASE_ADAPTER.worker,
            version_id: VERSION_ID,
          })}\n`,
        );
        return ok();
      }
      if (args.includes("deploy")) {
        state.deployment = {
          id: DEPLOYMENT_ID,
          versions: [{ version_id: VERSION_ID, percentage: 100 }],
        };
        writeFileSync(
          options.env.WRANGLER_OUTPUT_FILE_PATH,
          `${JSON.stringify({
            type: "version-deploy",
            worker_name: SPECIFICATION_RELEASE_ADAPTER.worker,
            deployment_id: DEPLOYMENT_ID,
            version_traffic: { [VERSION_ID]: 100 },
          })}\n`,
        );
        return ok();
      }
      throw new Error(`unexpected Wrangler call: ${args.join(" ")}`);
    }
    if (command !== "git") throw new Error(`unexpected command ${command}`);
    if (args.join(" ") === "rev-parse --show-toplevel") return ok(`${repository.repo}\n`);
    if (args.join(" ") === "status --porcelain=v1 --untracked-files=all") return ok();
    if (args.join(" ") === "rev-parse HEAD") return ok(`${state.head}\n`);
    if (args[0] === "rev-parse" && args[1]?.startsWith(`${D}:spec/schemas/`)) {
      return ok(`${"6".repeat(40)}\n`);
    }
    if (args.join(" ") === "branch --show-current") return ok("main\n");
    if (args.join(" ") === "rev-parse --is-shallow-repository") return ok("false\n");
    if (args.join(" ") === "replace -l") return ok();
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") return ok();
    if (args.join(" ") === "remote get-url origin") {
      return ok(`${SPECIFICATION_RELEASE_ADAPTER.origin}\n`);
    }
    if (args.join(" ") === "rev-parse --git-common-dir") return ok(".git\n");
    if (args.includes("--exit-code") && args.includes("refs/heads/main")) {
      return ok(`${state.head}\trefs/heads/main\n`);
    }
    if (args[0] === "rev-parse" && args[1] === "refs/remotes/origin/main") {
      return ok(`${state.head}\n`);
    }
    if (args[0] === "rev-list" && args[1] === "--first-parent") {
      return ok(`${state.head}\n${N}\n${D}\n${P0}\n`);
    }
    if (args[0] === "rev-parse" && args[1]?.includes(":")) {
      const path = args[1].slice(args[1].indexOf(":") + 1);
      return ok(`${createHash("sha1").update(path).digest("hex")}\n`);
    }
    if (args[0] === "rev-list" && args[1] === "--parents") {
      if (args.at(-1) === E) return ok(`${E} ${N}\n`);
      if (args.at(-1) === R) return ok(`${R} ${E}\n`);
    }
    if (args[0] === "diff" && args.includes(N) && args.includes(E)) {
      return ok("A\trelease/specification-release-candidate.json\n");
    }
    if (args.includes("--tags") && args[0] === "ls-remote") {
      return state.remoteTag
        ? ok(`${TAG_OBJECT}\trefs/tags/${TAG}\n${E}\trefs/tags/${TAG}^{}\n`)
        : ok();
    }
    if (args[0] === "show-ref") return { status: 1, signal: null, stdout: "", stderr: "" };
    if (args.includes("--annotate") && args.includes("--sign")) {
      state.localTag = true;
      return ok();
    }
    if (args.join(" ") === `rev-parse refs/tags/${TAG}`) return ok(`${TAG_OBJECT}\n`);
    if (args.join(" ") === "rev-parse --show-object-format") return ok("sha1\n");
    if (args[0] === "push") {
      state.remoteTag = true;
      return ok();
    }
    if (["init", "remote", "fetch"].includes(args[0])) return ok();
    if (args[0] === "cat-file" && args[1] === "-t") {
      return ok(args[2] === TAG_OBJECT ? "tag\n" : "blob\n");
    }
    if (args[0] === "cat-file" && args[1] === "blob") {
      return ok(`blob:${args[2]}\n`);
    }
    if (args[0] === "cat-file" && args[1] === "-p") return ok(tagAnnotation());
    if (args[0] === "rev-list" && args[1] === "-n") return ok(`${E}\n`);
    if (args.includes("verify-tag")) return ok();
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}

function casRunner(
  repository,
  {
    casLost = false,
    canonicalToolMismatch = false,
    loadedToolMismatch = false,
  } = {},
) {
  const P = "d".repeat(40);
  const Q = "e".repeat(40);
  const receiptCommit = R;
  const state = {
    remote: P,
    calls: [],
    fetches: [],
    index: new Map(),
    blobs: new Map(),
    commits: new Map(),
  };
  let candidate = null;
  let candidateRaw = null;
  try {
    candidateRaw = readFileSync(
      join(repository.repo, "release/specification-release-candidate.json"),
    );
    candidate = JSON.parse(candidateRaw);
    state.release = {
      id: 77,
      tag_name: TAG,
      target_commitish: E,
      name: candidate.title,
      body: candidate.githubRelease.body,
      html_url: `${SPECIFICATION_RELEASE_ADAPTER.repository}/releases/tag/${TAG}`,
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [],
    };
  } catch {
    // Read-only record-state fixtures intentionally omit the worktree candidate.
  }
  const tagAnnotation = () => [
    `object ${E}`,
    "type commit",
    `tag ${TAG}`,
    "tagger Fixture <fixture@example.com> 1 +0000",
    "",
    candidate?.title ?? `Takoform Specification ${VERSION}`,
    "",
    `Normative commit: ${D}`,
    `Candidate: ${candidateRaw === null ? "" : sha256(candidateRaw)}`,
    "-----BEGIN SSH SIGNATURE-----",
    "AAAA",
    "-----END SSH SIGNATURE-----",
    "",
  ].join("\n");
  const objectId = (label) => createHash("sha1").update(label).digest("hex");
  const baseRecords = new Map();
  for (const path of [...new Set([
    ...E_TO_R_TRACKED_PATHS,
    ...SOURCE_PINNED_EXECUTION_PATHS,
    "release/public-schema-identities.json",
    "release/specification-release-candidate.json",
    "spec/schemas/example.schema.json",
  ])]) {
    const bytes = Buffer.from(
      path.endsWith(".json") && !path.endsWith("example.schema.json")
        ? canonicalJSON({})
        : `source:${path}\n`,
    );
    const id = objectId(`source:${path}`);
    state.blobs.set(id, bytes);
    baseRecords.set(path, id);
  }
  const currentRecords = new Map(baseRecords);
  if (canonicalToolMismatch) {
    const path = SOURCE_PINNED_EXECUTION_PATHS[0];
    const bytes = Buffer.from(`changed:${path}\n`);
    const id = objectId(bytes);
    state.blobs.set(id, bytes);
    currentRecords.set(path, id);
  }
  state.commits.set(E, new Map(baseRecords));
  state.commits.set(P, new Map(currentRecords));
  state.commits.set(Q, new Map(currentRecords));
  state.commits.set(N, new Map(baseRecords));
  state.commits.set(D, new Map(baseRecords));
  state.commits.set(P0, new Map(baseRecords));
  if (loadedToolMismatch) {
    const path = SOURCE_PINNED_EXECUTION_PATHS.at(-1);
    const bytes = Buffer.from(`loaded-change:${path}\n`);
    const id = objectId(bytes);
    state.blobs.set(id, bytes);
    state.commits.get(E).set(path, id);
  }
  const ok = (stdout = "") => ({ status: 0, signal: null, stdout, stderr: "" });
  const runner = (command, args, options = {}) => {
    state.calls.push({ command, args: [...args], options });
    if (command !== "git") throw new Error(`unexpected CAS command ${command}`);
    if (args.join(" ") === "rev-parse --show-toplevel") return ok(`${repository.repo}\n`);
    if (args.join(" ") === "status --porcelain=v1 --untracked-files=all") return ok();
    if (args.join(" ") === "rev-parse HEAD") return ok(`${E}\n`);
    if (args.join(" ") === "branch --show-current") return ok("main\n");
    if (args.join(" ") === "rev-parse --is-shallow-repository") return ok("false\n");
    if (args.join(" ") === "replace -l") return ok();
    if (args.join(" ") === "remote get-url origin") {
      return ok(`${SPECIFICATION_RELEASE_ADAPTER.origin}\n`);
    }
    if (["init", "remote", "fetch"].includes(args[0])) return ok();
    if (args.join(" ") === "rev-parse --git-common-dir") return ok(".git\n");
    if (args[0] === "ls-remote" && args.includes("--tags")) {
      return ok(`${TAG_OBJECT}\trefs/tags/${TAG}\n${E}\trefs/tags/${TAG}^{}\n`);
    }
    if (args[0] === "ls-remote") {
      return ok(`${state.remote}\trefs/heads/main\n`);
    }
    if (args[0] === "rev-parse" && args[1] === "refs/remotes/origin/main") {
      return ok(`${state.remote}\n`);
    }
    if (args[0] === "rev-list" && args[1] === "--first-parent") {
      const commit = args[2];
      if (commit === E) return ok(`${E}\n${N}\n${D}\n${P0}\n`);
      if (commit === receiptCommit) return ok(`${receiptCommit}\n${P}\n${E}\n${N}\n${D}\n${P0}\n`);
      if (commit === P) return ok(`${P}\n${E}\n${N}\n${D}\n${P0}\n`);
      if (commit === Q) return ok(`${Q}\n${P}\n${E}\n${N}\n${D}\n${P0}\n`);
      throw new Error(`unexpected history ${commit}`);
    }
    if (args[0] === "rev-parse" && args[1].includes(":")) {
      const separator = args[1].indexOf(":");
      const commit = args[1].slice(0, separator) === "HEAD"
        ? E
        : args[1].slice(0, separator);
      const path = args[1].slice(separator + 1);
      const id = state.commits.get(commit)?.get(path);
      if (!id) throw new Error(`missing fixture record ${commit}:${path}`);
      return ok(`${id}\n`);
    }
    if (args[0] === "rev-parse" && args[1] === `refs/tags/${TAG}`) {
      return ok(`${TAG_OBJECT}\n`);
    }
    if (args[0] === "cat-file" && args[1] === "-t") {
      return ok(args[2] === TAG_OBJECT ? "tag\n" : "blob\n");
    }
    if (args[0] === "cat-file" && args[1] === "-p" && args[2] === TAG_OBJECT) {
      return ok(tagAnnotation());
    }
    if (args[0] === "cat-file" && args[1] === "blob") {
      return ok(state.blobs.get(args[2]).toString("utf8"));
    }
    if (args[0] === "read-tree") {
      state.index = new Map(state.commits.get(args[1]));
      return ok();
    }
    if (args[0] === "hash-object") {
      const bytes = Buffer.from(options.input);
      const id = objectId(bytes);
      state.blobs.set(id, bytes);
      return ok(`${id}\n`);
    }
    if (args[0] === "update-index") {
      state.index.set(args[5], args[4]);
      return ok();
    }
    if (args[0] === "write-tree") return ok(`${"7".repeat(40)}\n`);
    if (args[0] === "commit-tree") {
      state.commits.set(receiptCommit, new Map(state.index));
      return ok(`${receiptCommit}\n`);
    }
    if (args[0] === "rev-list" && args[1] === "--parents") {
      if (args.at(-1) === E) return ok(`${E} ${N}\n`);
      return ok(`${receiptCommit} ${P}\n`);
    }
    if (args[0] === "rev-list" && args[1] === "-n") return ok(`${E}\n`);
    if (args.includes("verify-tag")) return ok();
    if (args[0] === "diff") {
      if (args.includes(N) && args.includes(E)) {
        return ok("A\trelease/specification-release-candidate.json\n");
      }
      return ok(E_TO_R_TRACKED_PATHS.map((path) => `M\t${path}\n`).join(""));
    }
    if (args[0] === "push") {
      state.remote = casLost ? Q : receiptCommit;
      return casLost
        ? { status: 1, signal: null, stdout: "", stderr: "lease rejected" }
        : ok("ok\n");
    }
    throw new Error(`unexpected CAS git call: ${args.join(" ")}`);
  };
  return { runner, state, P, Q, receiptCommit };
}

function cloudflareFetch(state) {
  return async (url, request) => {
    state.fetches.push({ url, request });
    const success = (result, resultInfo) => ({
      success: true,
      errors: [],
      messages: [],
      result,
      ...(resultInfo ? { result_info: resultInfo } : {}),
    });
    if (url.includes("/versions?")) {
      return jsonResponse(
        url,
        200,
        success(state.version ? [state.version] : [], { total_pages: 1 }),
      );
    }
    if (url.endsWith("/deployments")) {
      return jsonResponse(
        url,
        200,
        success({ deployments: state.deployment ? [state.deployment] : [] }),
      );
    }
    if (url.endsWith("/workers/routes")) {
      return jsonResponse(url, 200, success([{
        id: "route-1",
        pattern: SPECIFICATION_RELEASE_ADAPTER.route,
        script: SPECIFICATION_RELEASE_ADAPTER.worker,
      }]));
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

function rulesetDocument(overrides = {}) {
  return {
    id: RULESET_ID,
    target: "tag",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["refs/tags/specification/*"],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "update" },
    ],
    ...overrides,
  };
}

function combinedFetch(state) {
  const cloudflare = cloudflareFetch(state);
  return async (url, request) => {
    state.fetches.push({ url, request });
    if (url.includes("/rulesets?")) {
      return jsonResponse(url, 200, [{
        id: RULESET_ID,
        target: "tag",
        enforcement: "active",
      }]);
    }
    if (url.endsWith(`/rulesets/${RULESET_ID}`)) {
      const reads = state.rulesetDetailReads ?? 0;
      state.rulesetDetailReads = reads + 1;
      const sequenced = state.rulesetSequence?.[
        Math.min(reads, state.rulesetSequence.length - 1)
      ];
      return jsonResponse(
        url,
        200,
        sequenced ?? state.ruleset ?? rulesetDocument(),
      );
    }
    if (url.endsWith("/immutable-releases")) {
      return jsonResponse(url, 200, { enabled: true });
    }
    if (url.includes("/releases?")) {
      return jsonResponse(url, 200, state.release ? [state.release] : []);
    }
    if (url.endsWith("/releases") && request.method === "POST") {
      const body = JSON.parse(request.body);
      state.release = {
        id: 77,
        tag_name: body.tag_name,
        target_commitish: body.target_commitish,
        name: body.name,
        body: body.body,
        html_url: `${SPECIFICATION_RELEASE_ADAPTER.repository}/releases/tag/${TAG}`,
        draft: false,
        prerelease: false,
        immutable: true,
        assets: [],
      };
      return jsonResponse(url, 201, state.release);
    }
    if (url.includes("/releases/tags/")) {
      return state.release
        ? jsonResponse(url, 200, state.release)
        : jsonResponse(url, 404, { message: "Not Found" });
    }
    return cloudflare(url, request);
  };
}

async function credentialedOperations({ phase = "publish", ci = false } = {}) {
  const repository = fixtureRepository();
  const fixture = releaseFixture(repository);
  const state = { fixture, calls: [], fetches: [] };
  const runner = fakeRunner(repository, state);
  const privateKey = join(repository.parent, "tag-key");
  writeFileSync(privateKey, "fixture-private-key\n", { mode: 0o600 });
  const reviewPath = join(repository.parent, "review.json");
  exactReview(reviewPath, fixture, { recovery: phase === "recover" });
  const env = {
    PATH: process.env.PATH,
    GH_TOKEN: "github-token",
    CLOUDFLARE_API_TOKEN: "cloudflare-token",
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_ZONE_ID: ZONE_ID,
    TAKOFORM_CORE_TAG_SIGNING_KEY: privateKey,
    TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN: "ruleset-audit-token",
    ...(ci ? { CI: "true" } : {}),
  };
  const options = {
    phase,
    authority: { successorPreparedCommit: P0 },
    lane: "composed",
    version: VERSION,
    expectedDCommit: D,
    expectedNCommit: N,
    expectedECommit: E,
    reviewRecord: reviewPath,
  };
  const operations = createSpecificationReleaseOperations({
    phase,
    options,
    repo: repository.repo,
    env,
    runner,
    fetchImpl: combinedFetch(state),
    readGitBlob: (object) => {
      const policyObject = createHash("sha1")
        .update(WRITER_TOOL_CLOSURE_POLICY_PATH)
        .digest("hex");
      if (object === policyObject) return fixtureToolPolicyRaw();
      throw new Error(`unexpected direct Git blob read ${object}`);
    },
  });
  await operations.readPublishState();
  const reviewRequest = {
    path: reviewPath,
    lanes: { specification: true, schema: true },
    version: VERSION,
    expectedDCommit: D,
    expectedNCommit: N,
    expectedECommit: E,
    candidateSha256: sha256(fixture.candidateRaw),
    schemaOriginCandidateSha256: sha256(fixture.schemaCandidateRaw),
    recovery: phase === "recover",
    reviewed: [...SPECIFICATION_RELEASE_REVIEW.reviewed],
  };
  return { repository, fixture, state, runner, env, options, operations, reviewRequest };
}

async function auditTagProtection(context) {
  const auditToken = await context.operations.acquireTagProtectionAuditToken({
    surface: "takoform-specification-tag-ruleset",
    version: VERSION,
    phase: context.options.phase ?? "publish",
  });
  return await context.operations.verifyTagProtectionRuleset({
    tag: TAG,
    expectedPattern: "refs/tags/specification/*",
    auditToken,
  });
}

async function prepareAdapterTools(context) {
  const proof = await context.operations.verifySourcePinnedExecution({
    preparedCommit: P0,
    checkpoints: [D, N, E],
    paths: [...SOURCE_PINNED_EXECUTION_PATHS],
  });
  return await context.operations.prepareSchemaToolClosure({
    preparedCommit: P0,
    packageObject: proof.prepared.pathObjects["package.json"],
    lockObject: proof.prepared.pathObjects["bun.lock"],
    toolPolicyObject:
      proof.prepared.pathObjects[WRITER_TOOL_CLOSURE_POLICY_PATH],
    wranglerVersion: SPECIFICATION_RELEASE_ADAPTER.wranglerVersion,
  });
}

async function exactReceiptCASAuthority(operations) {
  const auditToken = await operations.acquireTagProtectionAuditToken({
    surface: "takoform-specification-tag-ruleset",
    version: VERSION,
    phase: "record",
  });
  const tag = await operations.readTag(TAG);
  const release = await operations.readRelease(TAG);
  const tagProtectionRuleset = await operations.verifyTagProtectionRuleset({
    tag: TAG,
    expectedPattern: "refs/tags/specification/*",
    auditToken,
  });
  return {
    publication: { tag, release, tagProtectionRuleset },
    auditToken,
  };
}

describe("Specification release production adapter", () => {
  test("pins the sole owner, schema surface, clients and signing authority", () => {
    expect(SPECIFICATION_RELEASE_ADAPTER).toMatchObject({
      origin: "https://github.com/tako0614/takoform.git",
      githubRepository: "tako0614/takoform",
      worker: "takoform-schema-origin",
      route: "forms.takoform.com/schemas/*",
      wranglerVersion: "4.115.0",
      tagSignerFingerprint:
        "SHA256:C9nOGYF3q5s7QoftDP/eB7oAGtmC7fjC6UX+60/VyzE",
    });
  });

  test("executes the actual sealed Wrangler entrypoint with a credentialless machine-output environment", { timeout: 30_000 }, () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "takoform-spec-adapter-sealed-runtime-"));
    temporaryRoots.push(runtimeRoot);
    const outputFile = join(runtimeRoot, "machine-output.jsonl");
    const emptyEnvFile = join(runtimeRoot, "empty.env");
    const outputRoot = join(runtimeRoot, "dry-run-output");
    mkdirSync(outputRoot);
    writeFileSync(emptyEnvFile, "", { mode: 0o600 });
    const sealed = sealInstalledToolClosure({
      repositoryRoot: SOURCE_ROOT,
      runtimeRoot,
    });
    const nodeExecutable = [
      process.execPath,
      "/usr/local/bin/node",
      "/usr/bin/node",
    ].find((candidate) => {
      try {
        const info = lstatSync(candidate);
        return basename(candidate).toLowerCase() === "node" &&
          info.isFile() &&
          info.nlink === 1 &&
          (info.mode & 0o022) === 0 &&
          realpathSync(candidate) === candidate;
      } catch {
        return false;
      }
    });
    if (!nodeExecutable) throw new Error("test host has no validated Node executable");
    const environment = createSpecificationWranglerEnvironment({
      runtimeRoot,
      nodeModulesRoot: sealed.root,
      runtimeExecutable: nodeExecutable,
      outputFile,
    });
    expect(environment.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(environment.HTTPS_PROXY).toBeUndefined();
    expect(environment.HTTP_PROXY).toBeUndefined();
    expect(environment.SSL_CERT_FILE).toBeUndefined();
    expect(environment.CLOUDFLARE_API_BASE_URL).toBeUndefined();
    expect(environment.NODE_OPTIONS).toBeUndefined();
    expect(environment.NODE_DEBUG).toBeUndefined();
    expect(environment.NODE_EXTRA_CA_CERTS).toBeUndefined();
    expect(environment.NODE_PATH).toBe(sealed.root);
    expect(environment.PATH).toBe(`${dirname(nodeExecutable)}:/usr/bin:/bin`);
    const result = spawnSync(
      nodeExecutable,
      [
        sealed.executable,
        "versions",
        "upload",
        "--dry-run",
        "--outdir",
        outputRoot,
        "--config",
        SPECIFICATION_RELEASE_ADAPTER.configPath,
        "--name",
        SPECIFICATION_RELEASE_ADAPTER.worker,
        "--env-file",
        emptyEnvFile,
      ],
      {
        cwd: SOURCE_ROOT,
        env: environment,
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(SPECIFICATION_RELEASE_ADAPTER.wranglerVersion);
    expect(existsSync(outputFile)).toBe(true);
    const lines = readFileSync(outputFile, "utf8")
      .split("\n")
      .filter((line) => line !== "");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: "wrangler-session",
      wrangler_version: SPECIFICATION_RELEASE_ADAPTER.wranglerVersion,
    });
    expect(JSON.parse(lines[1])).toMatchObject({
      type: "version-upload",
      worker_name: SPECIFICATION_RELEASE_ADAPTER.worker,
    });
  });

  test("rejects sealed closure mode and hardlink tampering before credentialed use", () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), "takoform-spec-adapter-sealed-integrity-"));
    temporaryRoots.push(runtimeRoot);
    const sealed = sealInstalledToolClosure({
      repositoryRoot: SOURCE_ROOT,
      runtimeRoot,
    });
    const metadata = join(sealed.root, "wrangler", "package.json");
    chmodSync(metadata, 0o555);
    expect(() => sealed.verify()).toThrow("changed before credentialed execution");
    chmodSync(metadata, 0o644);
    expect(() => sealed.verify()).toThrow("exact read-only mode");

    const hardlinkRoot = mkdtempSync(join(tmpdir(), "takoform-spec-adapter-sealed-hardlink-"));
    temporaryRoots.push(hardlinkRoot);
    const second = sealInstalledToolClosure({
      repositoryRoot: SOURCE_ROOT,
      runtimeRoot: hardlinkRoot,
    });
    linkSync(
      join(second.root, "wrangler", "package.json"),
      join(second.root, "wrangler", "package-hardlink.json"),
    );
    expect(() => second.verify()).toThrow("ordinary file");
  });

  test("rejects foreign-owned sealed closure entries before credentialed use", () => {
    if (typeof process.getuid !== "function" || process.getuid() !== 0) return;
    const runtimeRoot = mkdtempSync(join(tmpdir(), "takoform-spec-adapter-sealed-owner-"));
    temporaryRoots.push(runtimeRoot);
    const sealed = sealInstalledToolClosure({
      repositoryRoot: SOURCE_ROOT,
      runtimeRoot,
    });
    const metadata = join(sealed.root, "wrangler", "package.json");
    chownSync(metadata, 65_534, 65_534);
    expect(() => sealed.verify()).toThrow("owned by root or the current user");
  });

  test("rejects construction outside one exact release phase", () => {
    expect(() => createSpecificationReleaseOperations({
      phase: "deploy",
      options: {},
      repo: import.meta.dirname,
    })).toThrow("exact phase");
    const repository = fixtureRepository();
    const operations = createSpecificationReleaseOperations({
      phase: "prepare-receipt",
      options: releaseOptions(),
      repo: repository.repo,
      fetchImpl: async () => {
        throw new Error("network must not be touched");
      },
    });
    operations.cleanup();
  });

  test("rejects every off-phase authority before constructing runtime callbacks", () => {
    const repository = fixtureRepository();
    for (const [phase, lane, name] of [
      ["reserve", undefined, "GH_TOKEN"],
      ["prepare", "specification", "CLOUDFLARE_API_TOKEN"],
      ["prepare-receipt", undefined, "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN"],
      ["record", undefined, "GH_TOKEN"],
      ["publish", "schema", "GH_TOKEN"],
      ["publish", "specification", "CLOUDFLARE_API_TOKEN"],
      ["verify", "schema", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"],
    ]) {
      expect(() => createSpecificationReleaseOperations({
        phase,
        options: releaseOptions({ lane }),
        repo: repository.repo,
        env: { [name]: `off-phase-${name}` },
        runner: () => {
          throw new Error("runner must not be constructed");
        },
        fetchImpl: async () => {
          throw new Error("network must not be constructed");
        },
      })).toThrow(`${phase} refuses off-phase authority ${name}`);
    }
  });

  test("accepts only a canonical review record outside the repository", () => {
    const repository = fixtureRepository();
    const fixture = releaseFixture(repository);
    const path = join(repository.parent, "review.json");
    exactReview(path, fixture);
    expect(verifySpecificationReleaseIndependentReview({
      path,
      repositoryRoot: repository.repo,
      lanes: { specification: true, schema: true },
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      candidateSha256: sha256(fixture.candidateRaw),
      schemaOriginCandidateSha256: sha256(fixture.schemaCandidateRaw),
      recovery: false,
    })).toMatchObject({ approved: true, reviewer: "independent-reviewer" });
    const forged = join(repository.parent, "forged.json");
    exactReview(forged, fixture, { expectedECommit: R });
    expect(() => verifySpecificationReleaseIndependentReview({
      path: forged,
      repositoryRoot: repository.repo,
      lanes: { specification: true, schema: true },
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      candidateSha256: sha256(fixture.candidateRaw),
      schemaOriginCandidateSha256: sha256(fixture.schemaCandidateRaw),
      recovery: false,
    })).toThrow("another release");
    const inside = join(repository.repo, "review.json");
    exactReview(inside, fixture);
    expect(() => verifySpecificationReleaseIndependentReview({
      path: inside,
      repositoryRoot: repository.repo,
      lanes: { specification: true, schema: true },
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      candidateSha256: sha256(fixture.candidateRaw),
      schemaOriginCandidateSha256: sha256(fixture.schemaCandidateRaw),
      recovery: false,
    })).toThrow("outside");
  });

  test("fails before reading credentials when the high-level review callback was not invoked", async () => {
    const context = await credentialedOperations();
    const calls = context.state.calls.length;
    await expect(context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    })).rejects.toThrow("verifyIndependentReview");
    expect(context.state.calls).toHaveLength(calls);
    context.operations.cleanup();
  });

  test("permanently refuses a CI writer even after exact independent review", async () => {
    const context = await credentialedOperations({ ci: true });
    await context.operations.verifyIndependentReview(context.reviewRequest);
    await expect(context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    })).rejects.toThrow("no CI writer");
    context.operations.cleanup();
  });

  test("record refuses before writing until direct E-child CAS is owned by orchestration", async () => {
    const repository = fixtureRepository();
    const state = { fixture: releaseFixture(repository), calls: [] };
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      runner: fakeRunner(repository, state),
      fetchImpl: async () => {
        throw new Error("network must not be touched");
      },
    });
    const before = readFileSync(join(repository.repo, "release/specification-releases.json"));
    await expect(operations.writeTrackedFiles(new Map([
      ["release/specification-releases.json", Buffer.from("changed")],
      ["release/record-prefix-chain.json", Buffer.from("changed")],
      ["release/record-head.json", Buffer.from("changed")],
      ["release/record-head.sig.json", Buffer.from("changed")],
    ]))).rejects.toThrow("CAS publication");
    expect(readFileSync(join(repository.repo, "release/specification-releases.json"))).toEqual(before);
    expect(state.calls).toHaveLength(0);
    operations.cleanup();
  });

  test("apply-reservation writes exactly the four sealed reservation records", async () => {
    const repository = fixtureRepository();
    const state = { fixture: releaseFixture(repository), head: D, calls: [] };
    const base = fakeRunner(repository, state);
    const runner = (command, args, options) => {
      if (command === "git" && args[0] === "ls-files") {
        return { status: 0, signal: null, stdout: "", stderr: "" };
      }
      if (command === "git" && args[0] === "diff") {
        return {
          status: 0,
          signal: null,
          stdout: [
            "release/public-schema-identities.json",
            "release/record-prefix-chain.json",
            "release/record-head.json",
            "release/record-head.sig.json",
          ].map((path) => `M\t${path}\n`).join(""),
          stderr: "",
        };
      }
      return base(command, args, options);
    };
    const operations = createSpecificationReleaseOperations({
      phase: "apply-reservation",
      options: releaseOptions({ expectedNCommit: undefined }),
      repo: repository.repo,
      runner,
      fetchImpl: async () => {
        throw new Error("network must not be touched");
      },
    });
    const files = new Map([
      "release/public-schema-identities.json",
      "release/record-prefix-chain.json",
      "release/record-head.json",
      "release/record-head.sig.json",
    ].map((path) => [path, Buffer.from(`sealed:${path}\n`)]));
    await operations.writeTrackedFiles(files);
    for (const [path, bytes] of files) {
      expect(readFileSync(join(repository.repo, path))).toEqual(bytes);
    }
    operations.cleanup();
  });

  test("publishes one sole-parent receipt commit with an E-descendant main CAS and exact lineage", async () => {
    const repository = fixtureRepository();
    const fixture = releaseFixture(repository);
    const cas = casRunner(repository);
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env: {
        PATH: process.env.PATH,
        TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN: "receipt-ref-token",
        TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN: "receipt-audit-token",
      },
      runner: cas.runner,
      fetchImpl: combinedFetch(cas.state),
    });
    const files = new Map(E_TO_R_TRACKED_PATHS.map((path) => [
      path,
      Buffer.from(`receipt:${path}\n`),
    ]));
    const authority = await exactReceiptCASAuthority(operations);
    const result = await operations.tryRecordSpecificationReceipt({
      sourceCommit: E,
      expectedPaths: [...E_TO_R_TRACKED_PATHS],
      files,
      ...authority,
    });
    expect(result).toMatchObject({
      status: "recorded",
      lineage: {
        sourceCommit: E,
        parentCommit: cas.P,
        receiptCommit: R,
        canonicalMainCommit: R,
        receiptParents: [cas.P],
        changedPaths: [...E_TO_R_TRACKED_PATHS],
      },
    });
    expect(result.lineage.parentFirstParentHistory).toEqual([
      cas.P, E, N, D, P0,
    ]);
    expect(result.lineage.currentFirstParentHistory).toEqual([
      R, cas.P, E, N, D, P0,
    ]);
    expect(result.lineage.sourceRecords).toEqual(result.lineage.parentRecords);
    expect(result.lineage.receiptRecords).toEqual(result.lineage.currentRecords);
    for (const path of E_TO_R_TRACKED_PATHS) {
      expect(result.lineage.receiptRecords[path].objectId).not.toBe(
        result.lineage.parentRecords[path].objectId,
      );
    }
    const push = cas.state.calls.find(({ args }) => args[0] === "push");
    expect(push.args).toContain(
      `--force-with-lease=refs/heads/main:${cas.P}`,
    );
    expect(push.args.join(" ")).not.toContain("receipt-ref-token");
    expect(push.options.env.TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN).toBe(
      "receipt-ref-token",
    );
    expect(push.options.env.GH_TOKEN).toBeUndefined();
    expect(readFileSync(join(repository.repo, "release/specification-releases.json"))).toEqual(
      Buffer.from("{}\n"),
    );
    expect(fixture.candidateRaw.length).toBeGreaterThan(0);
    operations.cleanup();
  });

  test("reads record evidence and schema closure from E/N after canonical main advances to P", async () => {
    const repository = fixtureRepository();
    const cas = casRunner(repository);
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env: { PATH: process.env.PATH },
      runner: cas.runner,
      fetchImpl: async () => {
        throw new Error("network must not be touched");
      },
    });
    const state = await operations.readRecordState({ sourceCommit: E });
    expect(state.headCommit).toBe(E);
    expect(state.candidateRaw).toEqual(Buffer.from(canonicalJSON({})));
    expect(state.evidenceTransition).toEqual({
      fromCommit: N,
      toCommit: E,
      parents: [N],
      changedPaths: ["release/specification-release-candidate.json"],
    });
    expect(await operations.readSchemaSource("spec/schemas/example.schema.json"))
      .toEqual(Buffer.from("source:spec/schemas/example.schema.json\n"));
    operations.cleanup();
  });

  test("classifies a lost main CAS only when the winner retains E-pinned records", async () => {
    const repository = fixtureRepository();
    releaseFixture(repository);
    const cas = casRunner(repository, { casLost: true });
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env: {
        PATH: process.env.PATH,
        TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN: "receipt-ref-token",
        TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN: "receipt-audit-token",
      },
      runner: cas.runner,
      fetchImpl: combinedFetch(cas.state),
    });
    const authority = await exactReceiptCASAuthority(operations);
    const result = await operations.tryRecordSpecificationReceipt({
      sourceCommit: E,
      expectedPaths: [...E_TO_R_TRACKED_PATHS],
      files: new Map(E_TO_R_TRACKED_PATHS.map((path) => [
        path,
        Buffer.from(`receipt:${path}\n`),
      ])),
      ...authority,
    });
    expect(result).toMatchObject({
      status: "cas-lost",
      sourceCommit: E,
      parentCommit: cas.P,
      receiptCommit: R,
      canonicalMainCommit: cas.Q,
      currentFirstParentHistory: [cas.Q, cas.P, E, N, D, P0],
    });
    expect(result.currentFirstParentHistory).not.toContain(R);
    expect(result.sourceRecords).toEqual(result.currentRecords);
    operations.cleanup();
  });

  test("pins execution paths to exact E Git objects through fresh canonical history", async () => {
    const repository = fixtureRepository();
    releaseFixture(repository);
    const cas = casRunner(repository);
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env: { PATH: process.env.PATH },
      runner: cas.runner,
      fetchImpl: async () => {
        throw new Error("HTTP must not be touched by source pinning");
      },
    });
    const result = await operations.verifySourcePinnedExecution({
      preparedCommit: P0,
      checkpoints: [D, N, E],
      paths: [...SOURCE_PINNED_EXECUTION_PATHS],
    });
    expect(result.prepared.commit).toBe(P0);
    expect(result.current.commit).toBe(cas.P);
    expect(Object.keys(result.prepared.pathObjects)).toEqual(SOURCE_PINNED_EXECUTION_PATHS);
    expect(Object.values(result.prepared.pathObjects).every((value) => /^[0-9a-f]{40}$/u.test(value))).toBe(true);
    operations.cleanup();
  });

  test("rejects a canonical descendant that changed an E-pinned execution path", async () => {
    const repository = fixtureRepository();
    releaseFixture(repository);
    const cas = casRunner(repository, { canonicalToolMismatch: true });
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env: { PATH: process.env.PATH },
      runner: cas.runner,
      fetchImpl: async () => {
        throw new Error("HTTP must not be touched by source pinning");
      },
    });
    await expect(operations.verifySourcePinnedExecution({
      preparedCommit: P0,
      checkpoints: [D, N, E],
      paths: [...SOURCE_PINNED_EXECUTION_PATHS],
    })).rejects.toThrow("canonical main changed");
    operations.cleanup();
  });

  test("rejects a changed loaded transitive module before any fresh-canonical network callback", async () => {
    const repository = fixtureRepository();
    releaseFixture(repository);
    const cas = casRunner(repository, { loadedToolMismatch: true });
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env: { PATH: process.env.PATH },
      runner: cas.runner,
      fetchImpl: async () => {
        throw new Error("HTTP must not be touched by source pinning");
      },
    });
    await expect(operations.verifySourcePinnedExecution({
      preparedCommit: P0,
      checkpoints: [D, N, E],
      paths: [...SOURCE_PINNED_EXECUTION_PATHS],
    })).rejects.toThrow("loaded checkpoint");
    expect(cas.state.calls.some(({ args }) =>
      ["init", "fetch", "ls-remote"].includes(args[0])
    )).toBe(false);
    operations.cleanup();
  });

  test("rechecks the E execution closure inside the final receipt CAS callback", async () => {
    const repository = fixtureRepository();
    releaseFixture(repository);
    const cas = casRunner(repository, { canonicalToolMismatch: true });
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env: {
        PATH: process.env.PATH,
        TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN: "receipt-ref-token",
        TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN: "receipt-audit-token",
      },
      runner: cas.runner,
      fetchImpl: combinedFetch(cas.state),
    });
    const authority = await exactReceiptCASAuthority(operations);
    await expect(operations.tryRecordSpecificationReceipt({
      sourceCommit: E,
      expectedPaths: [...E_TO_R_TRACKED_PATHS],
      files: new Map(E_TO_R_TRACKED_PATHS.map((path) => [
        path,
        Buffer.from(`receipt:${path}\n`),
      ])),
      ...authority,
    })).rejects.toThrow("execution paths");
    expect(cas.state.calls.some(({ args }) => args[0] === "push")).toBe(false);
    operations.cleanup();
  });

  test("final publication drift reads zero ref tokens and performs zero pushes", async () => {
    const repository = fixtureRepository();
    releaseFixture(repository);
    const cas = casRunner(repository);
    let refTokenReads = 0;
    const env = new Proxy({
      PATH: process.env.PATH,
      TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN: "receipt-ref-token",
      TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN: "receipt-audit-token",
    }, {
      get(target, name, receiver) {
        if (name === "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN") {
          refTokenReads += 1;
        }
        return Reflect.get(target, name, receiver);
      },
    });
    const operations = createSpecificationReleaseOperations({
      phase: "record",
      options: releaseOptions(),
      repo: repository.repo,
      env,
      runner: cas.runner,
      fetchImpl: combinedFetch(cas.state),
    });
    const authority = await exactReceiptCASAuthority(operations);
    cas.state.release = {
      ...cas.state.release,
      body: "drifted immutable release body",
    };
    await expect(operations.tryRecordSpecificationReceipt({
      sourceCommit: E,
      expectedPaths: [...E_TO_R_TRACKED_PATHS],
      files: new Map(E_TO_R_TRACKED_PATHS.map((path) => [
        path,
        Buffer.from(`receipt:${path}\n`),
      ])),
      ...authority,
    })).rejects.toThrow();
    expect(refTokenReads).toBe(0);
    expect(cas.state.calls.some(({ args }) => args[0] === "push")).toBe(false);
    operations.cleanup();
  });

  test("public schema HTTP readback never carries an acquired or ambient credential", async () => {
    const repository = fixtureRepository();
    const requests = [];
    const url = "https://forms.takoform.com/schemas/example.schema.json";
    const operations = createSpecificationReleaseOperations({
      phase: "publish",
      options: releaseOptions(),
      repo: repository.repo,
      env: { CLOUDFLARE_API_TOKEN: "must-not-leak", GH_TOKEN: "must-not-leak" },
      runner: () => {
        throw new Error("process must not be touched");
      },
      fetchImpl: async (requested, request) => {
        requests.push({ requested, request });
        return response(url, 404, "not found\n");
      },
    });
    expect(await operations.readHTTP(url)).toMatchObject({
      status: 404,
      url,
      redirected: false,
    });
    expect(requests[0].request.headers).toEqual({
      Accept: "application/schema+json, application/json",
    });
    operations.cleanup();
  });

  test("builds the source snapshot from exact Git blobs rather than worktree bytes", async () => {
    const repository = fixtureRepository();
    const state = { fixture: releaseFixture(repository), head: N, calls: [] };
    const blobs = new Map([
      ["1".repeat(40), Buffer.from("alpha\n")],
      ["2".repeat(40), Buffer.from("beta\n")],
    ]);
    const base = fakeRunner(repository, state);
    const runner = (command, args, options) => {
      if (command === "git" && args[0] === "ls-tree") {
        return {
          status: 0,
          stdout:
            `100644 blob ${"2".repeat(40)}\tspec/z.md\0` +
            `100644 blob ${"1".repeat(40)}\tspec/a.md\0`,
          stderr: "",
        };
      }
      return base(command, args, options);
    };
    const operations = createSpecificationReleaseOperations({
      phase: "prepare",
      options: releaseOptions(),
      repo: repository.repo,
      runner,
      fetchImpl: async () => {
        throw new Error("network must not be touched");
      },
      readGitBlob: (object) => blobs.get(object),
    });
    const raw = await operations.buildSpecificationSourceSnapshot({
      commit: D,
      roots: ["spec"],
      exclude: ["release/specification-release-candidate.json"],
    });
    const snapshot = JSON.parse(raw);
    expect(snapshot.files).toEqual([
      {
        path: "spec/a.md",
        sha256: sha256(Buffer.from("alpha\n")),
        classification: "normative",
      },
      {
        path: "spec/z.md",
        sha256: sha256(Buffer.from("beta\n")),
        classification: "normative",
      },
    ]);
    operations.cleanup();

    const fixture = state.fixture;
    fixture.outer.sourceSnapshot = {
      sha256: sha256(raw),
      bytesBase64: Buffer.from(raw).toString("base64"),
    };
    fixture.candidateRaw = Buffer.from(canonicalJSON(fixture.outer));
    writeFileSync(
      join(repository.repo, "release/specification-release-candidate.json"),
      fixture.candidateRaw,
    );
    state.head = E;
    const verifier = createSpecificationReleaseOperations({
      phase: "publish",
      options: releaseOptions(),
      repo: repository.repo,
      runner,
      fetchImpl: async () => {
        throw new Error("network must not be touched");
      },
      readGitBlob: (object) => blobs.get(object),
    });
    await verifier.readPublishState();
    expect(await verifier.verifySpecificationSourceSnapshot({
      commit: D,
      snapshotSha256: sha256(raw),
      snapshotBytes: raw,
    })).toEqual({
      commit: D,
      snapshotSha256: sha256(raw),
      exact: true,
    });
    blobs.set(
      "2".repeat(40),
      Buffer.from("hostApiLane: forms.takoform.com/v2\n"),
    );
    await expect(verifier.verifySpecificationSourceSnapshot({
      commit: D,
      snapshotSha256: sha256(raw),
      snapshotBytes: raw,
    })).rejects.toThrow("forbidden v2");
    verifier.cleanup();
  });

  test("builds a credential-free schema candidate and rejects a noncanonical public path", async () => {
    const repository = fixtureRepository();
    const fixture = releaseFixture(repository);
    const source = "spec/schemas/example.schema.json";
    mkdirSync(dirname(join(repository.repo, source)), { recursive: true });
    writeFileSync(join(repository.repo, source), fixture.schemaBytes);
    const state = { fixture, head: N, calls: [] };
    const operations = createSpecificationReleaseOperations({
      phase: "prepare",
      options: releaseOptions(),
      repo: repository.repo,
      env: {
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
        CLOUDFLARE_ZONE_ID: ZONE_ID,
      },
      runner: fakeRunner(repository, state),
      fetchImpl: async () => {
        throw new Error("network must not be touched");
      },
      readGitBlob: () => fixture.schemaBytes,
    });
    const entry = {
      id: fixture.schemaCandidate.assets[0].url,
      source,
      public: `website/public/${fixture.schemaCandidate.assets[0].path}`,
      sha256: sha256(fixture.schemaBytes),
    };
    const raw = await operations.buildSchemaOriginCandidate({
      route: SPECIFICATION_RELEASE_ADAPTER.route,
      schemaLedger: { identities: [entry], retired: [] },
      schemaSeal: fixture.schemaCandidate.schemaSeal,
    });
    expect(JSON.parse(raw)).toMatchObject({
      target: { accountId: ACCOUNT_ID, zoneId: ZONE_ID },
      assets: [{ url: entry.id, sha256: entry.sha256 }],
    });
    await expect(operations.buildSchemaOriginCandidate({
      route: SPECIFICATION_RELEASE_ADAPTER.route,
      schemaLedger: {
        identities: [{ ...entry, public: "third-party/example.schema.json" }],
        retired: [],
      },
      schemaSeal: fixture.schemaCandidate.schemaSeal,
    })).rejects.toThrow("not canonical");
    operations.cleanup();
  });

  test("stages by pinned Wrangler upload, verifies annotations, then activates only by version deployment", async () => {
    const context = await credentialedOperations();
    await context.operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools(context);
    const credentials = await context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    });
    expect(credentials).toEqual({ kind: "takoform.specification-release-credentials@v1" });
    expect(await context.operations.readSchemaOriginStage(
      sha256(context.fixture.schemaCandidateRaw),
    )).toEqual({
      status: 404,
      candidateSha256: sha256(context.fixture.schemaCandidateRaw),
    });
    const stage = await context.operations.stageSchemaOrigin({
      route: SPECIFICATION_RELEASE_ADAPTER.route,
      candidateSha256: sha256(context.fixture.schemaCandidateRaw),
      candidateBytes: context.fixture.schemaCandidateRaw,
      releaseCandidateBytes: context.fixture.candidateRaw,
      credentials,
      createOnly: true,
    });
    expect(stage).toEqual({
      stageID: VERSION_ID,
      candidateSha256: sha256(context.fixture.schemaCandidateRaw),
    });
    expect(await context.operations.verifyStagedSchemaOrigin(stage)).toEqual({
      ...stage,
      exact: true,
    });
    expect(await context.operations.activateSchemaRoute({
      route: SPECIFICATION_RELEASE_ADAPTER.route,
      stageID: VERSION_ID,
      candidateSha256: sha256(context.fixture.schemaCandidateRaw),
      credentials,
      createOnly: true,
    })).toEqual({
      stageID: VERSION_ID,
      deploymentID: DEPLOYMENT_ID,
      exact: true,
    });
    const wranglerCalls = context.state.calls.filter(({ command, args }) =>
      command === process.execPath &&
      args[0]?.endsWith("/sealed-node_modules/wrangler/bin/wrangler.js")
    );
    expect(wranglerCalls).toHaveLength(2);
    expect(wranglerCalls[0].args.slice(1, 3)).toEqual(["versions", "upload"]);
    expect(wranglerCalls[1].args.slice(1, 3)).toEqual(["versions", "deploy"]);
    expect(wranglerCalls.some(({ args }) => args.includes("triggers"))).toBe(false);
    for (const call of wranglerCalls) {
      expect(call.options.env.CLOUDFLARE_API_TOKEN).toBe("cloudflare-token");
      expect(call.args.join(" ")).not.toContain("cloudflare-token");
    }
    context.operations.cleanup();
  });

  test("redacts credentials from retained Wrangler command failures", async () => {
    const context = await credentialedOperations();
    await context.operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools(context);
    const credentials = await context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    });
    context.state.failWrangler = true;
    let error;
    try {
      await context.operations.stageSchemaOrigin({
        route: SPECIFICATION_RELEASE_ADAPTER.route,
        candidateSha256: sha256(context.fixture.schemaCandidateRaw),
        candidateBytes: context.fixture.schemaCandidateRaw,
        releaseCandidateBytes: context.fixture.candidateRaw,
        credentials,
        createOnly: true,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("[REDACTED]");
    expect(error.message).not.toContain("cloudflare-token");
    context.operations.cleanup();
  });

  test("a changed sealed tool closure reads zero Cloudflare tokens and executes zero Wrangler", async () => {
    const context = await credentialedOperations();
    context.operations.cleanup();
    let changed = false;
    let cloudflareTokenReads = 0;
    const env = new Proxy(context.env, {
      get(target, name, receiver) {
        if (name === "CLOUDFLARE_API_TOKEN") cloudflareTokenReads += 1;
        return Reflect.get(target, name, receiver);
      },
    });
    const policy = JSON.parse(fixtureToolPolicyRaw());
    const operations = createSpecificationReleaseOperations({
      phase: "publish",
      options: context.options,
      repo: context.repository.repo,
      env,
      runner: context.runner,
      fetchImpl: combinedFetch(context.state),
      readGitBlob: () => fixtureToolPolicyRaw(),
      sealToolClosure: ({ repositoryRoot }) => ({
        root: join(repositoryRoot, "node_modules"),
        executable: join(
          repositoryRoot,
          "node_modules",
          "wrangler",
          "bin",
          "wrangler.js",
        ),
        manifestSha256: policy.manifestSha256,
        fileCount: policy.fileCount,
        verify() {
          if (changed) throw new Error("sealed tool canary changed");
        },
      }),
    });
    await operations.readPublishState();
    await operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools({ operations });
    changed = true;
    await expect(operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    })).rejects.toThrow("sealed tool canary changed");
    expect(cloudflareTokenReads).toBe(0);
    expect(context.state.calls.some(({ command, args }) =>
      command === process.execPath &&
      args[0]?.endsWith("/sealed-node_modules/wrangler/bin/wrangler.js")
    )).toBe(false);
    operations.cleanup();
  });

  test("halts on duplicate remote schema stages instead of uploading another version", async () => {
    const context = await credentialedOperations();
    await context.operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools(context);
    await context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    });
    const tag = `specification-${sha256(context.fixture.schemaCandidateRaw).slice(7)}`;
    const message =
      `Takoform Specification schema ${sha256(context.fixture.schemaCandidateRaw)}; release ${sha256(context.fixture.candidateRaw)}`;
    context.state.version = {
      id: VERSION_ID,
      annotations: { "workers/tag": tag, "workers/message": message },
    };
    context.operations.cleanup();
    const fetchImpl = async (url, request) => {
      if (url.includes("/versions?")) {
        return jsonResponse(url, 200, {
          success: true,
          errors: [],
          result_info: { total_pages: 1 },
          result: [
            context.state.version,
            { ...context.state.version, id: "33333333-3333-4333-8333-333333333333" },
          ],
        });
      }
      return cloudflareFetch(context.state)(url, request);
    };
    const operations = createSpecificationReleaseOperations({
      phase: "publish",
      options: context.options,
      repo: context.repository.repo,
      env: context.env,
      runner: context.runner,
      fetchImpl,
      readGitBlob: () => fixtureToolPolicyRaw(),
    });
    await operations.readPublishState();
    await operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools({ operations });
    await operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    });
    await expect(operations.readSchemaOriginStage(
      sha256(context.fixture.schemaCandidateRaw),
    )).rejects.toThrow("duplicated or ambiguous");
    operations.cleanup();
  });

  test("creates a signed annotated tag with a zero-object lease and fresh-repository readback", async () => {
    const context = await credentialedOperations();
    await context.operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools(context);
    const credentials = await context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    });
    expect(await auditTagProtection(context)).toEqual({
      id: RULESET_ID,
      target: "tag",
      enforcement: "active",
      bypassActors: [],
      include: ["refs/tags/specification/*"],
      exclude: [],
      rules: ["deletion", "update"],
    });
    const message = [
      `Takoform Specification ${VERSION}`,
      "",
      `Normative commit: ${D}`,
      `Candidate: ${sha256(context.fixture.candidateRaw)}`,
    ].join("\n");
    await context.operations.createSignedAnnotatedTag({
      tag: TAG,
      targetCommit: E,
      message,
      signed: true,
      annotated: true,
      createOnly: true,
      credentials,
    });
    expect(await context.operations.readTag(TAG)).toMatchObject({
      status: 200,
      tag: TAG,
      targetCommit: E,
      tagObject: TAG_OBJECT,
      annotated: true,
      signed: true,
      signatureVerified: true,
    });
    const push = context.state.calls.find(({ command, args }) =>
      command === "git" && args[0] === "push"
    );
    expect(push.args).toContain(
      `--force-with-lease=refs/tags/${TAG}:${"0".repeat(40)}`,
    );
    expect(push.args.join(" ")).not.toContain("github-token");
    expect(push.options.env.GH_TOKEN).toBe("github-token");
    expect(context.state.calls.some(({ args }) => args.includes("verify-tag"))).toBe(true);
    context.operations.cleanup();
  });

  test("rejects a bypassable, broader, or extra-rule tag ruleset under the separate audit credential", async () => {
    const context = await credentialedOperations();
    context.state.ruleset = rulesetDocument({
      bypass_actors: [{ actor_id: 1, actor_type: "OrganizationAdmin" }],
      conditions: {
        ref_name: { include: ["refs/tags/**"], exclude: [] },
      },
      rules: [
        { type: "creation" },
        { type: "deletion" },
        { type: "update" },
      ],
    });
    const auditToken = await context.operations.acquireTagProtectionAuditToken({
      surface: "takoform-specification-tag-ruleset",
      version: VERSION,
      phase: "publish",
    });
    await expect(context.operations.verifyTagProtectionRuleset({
      tag: TAG,
      expectedPattern: "refs/tags/specification/*",
      auditToken,
    })).rejects.toThrow(/broader|bypassable|extra/u);
    const auditFetches = context.state.fetches.filter(({ url }) =>
      url.includes("/rulesets")
    );
    expect(auditFetches.length).toBeGreaterThanOrEqual(2);
    for (const { request } of auditFetches) {
      expect(request.headers.Authorization).toBe("Bearer ruleset-audit-token");
      expect(request.headers.Authorization).not.toContain("github-token");
    }
    context.operations.cleanup();
  });

  test("accepts only a type-only raw update rule while keeping the normalized receipt closed", async () => {
    const context = await credentialedOperations();
    const auditToken = await context.operations.acquireTagProtectionAuditToken({
      surface: "takoform-specification-tag-ruleset",
      version: VERSION,
      phase: "publish",
    });
    await expect(context.operations.verifyTagProtectionRuleset({
      tag: TAG,
      expectedPattern: "refs/tags/specification/*",
      auditToken,
    })).resolves.toEqual({
      id: RULESET_ID,
      target: "tag",
      enforcement: "active",
      bypassActors: [],
      include: ["refs/tags/specification/*"],
      exclude: [],
      rules: ["deletion", "update"],
    });
    context.operations.cleanup();

    for (const update of [
      {
        type: "update",
        parameters: { update_allows_fetch_and_merge: false },
      },
      { type: "update", unexpected: false },
    ]) {
      const rejected = await credentialedOperations();
      rejected.state.ruleset = rulesetDocument({
        rules: [{ type: "deletion" }, update],
      });
      const rejectedAuditToken =
        await rejected.operations.acquireTagProtectionAuditToken({
          surface: "takoform-specification-tag-ruleset",
          version: VERSION,
          phase: "publish",
        });
      await expect(rejected.operations.verifyTagProtectionRuleset({
        tag: TAG,
        expectedPattern: "refs/tags/specification/*",
        auditToken: rejectedAuditToken,
      })).rejects.toThrow(/broader|missing|extra/u);
      rejected.operations.cleanup();
    }
  });

  test("creates one direct asset-free immutable Release and verifies it publicly without credentials", async () => {
    const context = await credentialedOperations();
    await context.operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools(context);
    const credentials = await context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    });
    context.state.remoteTag = true;
    await auditTagProtection(context);
    const body = context.fixture.outer.githubRelease.body;
    await context.operations.createImmutableRelease({
      tag: TAG,
      targetCommit: E,
      title: context.fixture.outer.title,
      body,
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [],
      createOnly: true,
      direct: true,
      credentials,
    });
    expect(await context.operations.readRelease(TAG)).toEqual({
      status: 200,
      tag: TAG,
      id: 77,
      url: `${SPECIFICATION_RELEASE_ADAPTER.repository}/releases/tag/${TAG}`,
      body,
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [],
    });
    const releaseWrites = context.state.fetches.filter(({ url, request }) =>
      url.endsWith("/releases") && request.method !== "GET"
    );
    expect(releaseWrites).toHaveLength(1);
    const releasePostIndex = context.state.fetches.indexOf(releaseWrites[0]);
    expect(context.state.fetches[releasePostIndex - 1].url.endsWith(
      `/rulesets/${RULESET_ID}`,
    )).toBe(true);
    expect(context.state.fetches[releasePostIndex - 1].request.headers.Authorization)
      .toBe("Bearer ruleset-audit-token");
    expect(releaseWrites[0].request.method).toBe("POST");
    expect(JSON.parse(releaseWrites[0].request.body)).toEqual({
      tag_name: TAG,
      target_commitish: E,
      name: context.fixture.outer.title,
      body,
      draft: false,
      prerelease: false,
      make_latest: "false",
    });
    expect(context.state.fetches.some(({ url, request }) =>
      ["PATCH", "DELETE"].includes(request.method) ||
      url.includes("uploads.github.com") ||
      /\/releases\/[^/]+\/assets/u.test(url)
    )).toBe(false);
    const publicReads = context.state.fetches.filter(({ url }) =>
      url.includes("/releases/tags/")
    );
    expect(publicReads.length).toBeGreaterThanOrEqual(2);
    for (const { request } of publicReads) {
      expect(request.headers.Authorization).toBeUndefined();
    }
    context.operations.cleanup();
  });

  test("refuses the Release POST when the exact ruleset changes at the final fresh audit", async () => {
    const context = await credentialedOperations();
    await context.operations.verifyIndependentReview(context.reviewRequest);
    await prepareAdapterTools(context);
    const credentials = await context.operations.acquireCredentials({
      surface: "takoform-specification-release",
      version: VERSION,
      lanes: { specification: true, schema: true },
    });
    context.state.remoteTag = true;
    context.state.rulesetSequence = [
      rulesetDocument(),
      rulesetDocument({ bypass_actors: [{ actor_id: 1, actor_type: "RepositoryRole" }] }),
    ];
    await auditTagProtection(context);
    await expect(context.operations.createImmutableRelease({
      tag: TAG,
      targetCommit: E,
      title: context.fixture.outer.title,
      body: context.fixture.outer.githubRelease.body,
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [],
      createOnly: true,
      direct: true,
      credentials,
    })).rejects.toThrow(/bypassable|final fence/u);
    expect(context.state.fetches.some(({ url, request }) =>
      url.endsWith("/releases") && request.method === "POST"
    )).toBe(false);
    context.operations.cleanup();
  });
});
