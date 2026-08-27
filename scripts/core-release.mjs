import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const CORE_RELEASE = Object.freeze({
  surface: "takoform-core-release",
  module: "github.com/tako0614/takoform",
  repository: "https://github.com/tako0614/takoform",
  origin: "https://github.com/tako0614/takoform.git",
  githubRepository: "tako0614/takoform",
  branch: "main",
  ref: "refs/heads/main",
  version: "v0.1.0",
  title: "Takoform Core v0.1.0",
  goToolchain: "go1.26.7",
  githubApiVersion: "2022-11-28",
  ledger: "release/core-releases.json",
  tagAllowedSigners: "release/authority/core-tag-allowed-signers",
  tagSignerPrincipal: "takoform-core-release",
  tagSignerFingerprint:
    "SHA256:C9nOGYF3q5s7QoftDP/eB7oAGtmC7fjC6UX+60/VyzE",
  commands: Object.freeze([
    Object.freeze({ name: "form-package", package: "./cmd/form-package" }),
    Object.freeze({
      name: "generic-conformance",
      package: "./cmd/generic-conformance",
    }),
    Object.freeze({ name: "takoform-trust", package: "./cmd/takoform-trust" }),
  ]),
  targets: Object.freeze([
    Object.freeze({ os: "darwin", arch: "amd64" }),
    Object.freeze({ os: "darwin", arch: "arm64" }),
    Object.freeze({ os: "linux", arch: "amd64" }),
    Object.freeze({ os: "linux", arch: "arm64" }),
    Object.freeze({ os: "windows", arch: "amd64" }),
    Object.freeze({ os: "windows", arch: "arm64" }),
  ]),
});

export const CORE_RELEASE_REVIEW = Object.freeze({
  format: "takoform.core-release-independent-review@v2",
  reviewed: Object.freeze([
    "asset-free-forward-only-publication",
    "canonical-source-qualification",
    "publication-time-ruleset-audit",
    "signed-tag-evidence-binding",
    "source-commit",
  ]),
});

export const CORE_RELEASE_PHASES = Object.freeze([
  "prepare",
  "audit",
  "sign-tag",
  "publish",
  "record-prepare",
  "record-push",
  "verify",
]);

const COMMIT = /^[0-9a-f]{40}$/u;
const OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const GO_SUM = /^h1:[A-Za-z0-9+/]{43}=$/u;
const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024;
const MAX_HTTP_BYTES = 4 * 1024 * 1024;

const DEFAULT_TOOL_PATHS = Object.freeze({
  node: "/usr/local/bin/node",
  git: "/usr/bin/git",
  bun: "/usr/local/bin/bun",
  go: "/usr/bin/go",
  sshKeygen: "/usr/bin/ssh-keygen",
});

const PHASE_AUTHORITY = Object.freeze({
  prepare: Object.freeze({ required: [], allowed: [] }),
  audit: Object.freeze({ required: ["GH_TOKEN"], allowed: ["GH_TOKEN"] }),
  "sign-tag": Object.freeze({
    required: ["TAKOFORM_CORE_TAG_SIGNING_KEY"],
    allowed: ["TAKOFORM_CORE_TAG_SIGNING_KEY"],
  }),
  publish: Object.freeze({ required: ["GH_TOKEN"], allowed: ["GH_TOKEN"] }),
  "record-prepare": Object.freeze({ required: [], allowed: [] }),
  "record-push": Object.freeze({
    required: ["TAKOFORM_CORE_REF_WRITE_TOKEN"],
    allowed: ["TAKOFORM_CORE_REF_WRITE_TOKEN"],
  }),
  verify: Object.freeze({ required: [], allowed: [] }),
});

// This is intentionally broader than the three current Core credentials.  A
// phase fails before reading source, artifacts, tools, or the network whenever
// another release lane's authority is ambient.
const KNOWN_AUTHORITY_ENV = Object.freeze([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GITHUB_PAT",
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "TAKOFORM_CORE_TAG_SIGNING_KEY",
  "TAKOFORM_CORE_REF_WRITE_TOKEN",
  "TAKOFORM_CORE_RULESET_AUDIT_TOKEN",
  "TAKOFORM_CORE_SIGNER_COMMAND",
  "TAKOFORM_CORE_GITHUB_WRITE_TOKEN",
  "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
  "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
  "TAKOFORM_SPECIFICATION_TAG_SIGNING_KEY",
  "TAKOFORM_SCHEMA_ORIGIN_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "CF_API_TOKEN",
  "CF_API_KEY",
  "CF_API_EMAIL",
  "NPM_TOKEN",
  "NODE_AUTH_TOKEN",
  "BUN_AUTH_TOKEN",
  "YARN_NPM_AUTH_TOKEN",
  "GOAUTH",
  "NETRC",
  "SSH_AUTH_SOCK",
  "SSH_ASKPASS",
  "SSH_ASKPASS_REQUIRE",
  "GIT_ASKPASS",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GNUPGHOME",
  "GPG_AGENT_INFO",
  "GPG_TTY",
]);

const DANGEROUS_GIT_ENV = Object.freeze([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_KEY_0",
  "GIT_CONFIG_VALUE_0",
]);

const PHASE_OPTIONS = Object.freeze({
  prepare: Object.freeze({
    required: ["expected-commit", "output"],
    optional: [],
  }),
  audit: Object.freeze({
    required: ["expected-commit", "ruleset-id", "output"],
    optional: [],
  }),
  "sign-tag": Object.freeze({
    required: [
      "expected-commit",
      "qualification",
      "ruleset-audit",
      "review-record",
      "output",
    ],
    optional: [],
  }),
  publish: Object.freeze({
    required: [
      "expected-commit",
      "qualification",
      "ruleset-audit",
      "review-record",
      "tag-bundle",
      "mode",
    ],
    optional: [],
  }),
  "record-prepare": Object.freeze({
    required: ["expected-commit", "output"],
    optional: [],
  }),
  "record-push": Object.freeze({
    required: ["artifact"],
    optional: [],
  }),
  verify: Object.freeze({
    required: ["expected-commit", "receipt-commit"],
    optional: [],
  }),
});

export class ReleaseFailure extends Error {
  constructor(message, state = {}, cause) {
    super(message, { cause });
    this.name = "ReleaseFailure";
    this.phase = state.phase ?? "unknown";
    this.stage = state.stage ?? "unknown";
    this.repositoryStateTouched = state.repositoryStateTouched === true;
    this.repositoryStateIndeterminate =
      state.repositoryStateIndeterminate === true;
    this.externalStateTouched = state.externalStateTouched === true;
    this.externalStateIndeterminate = state.externalStateIndeterminate === true;
  }
}

export function canonicalJSON(value) {
  return `${JSON.stringify(sortJSON(value))}\n`;
}

function sortJSON(value) {
  if (Array.isArray(value)) return value.map(sortJSON);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJSON(value[key])]),
    );
  }
  return value;
}

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitObjectID(type, bytes, length = 40) {
  const algorithm = length === 64 ? "sha256" : "sha1";
  return createHash(algorithm)
    .update(`${type} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJSON(Object.keys(value).sort()) === canonicalJSON([...keys].sort())
  );
}

function requireCommit(value, label = "source commit") {
  if (!COMMIT.test(value ?? "")) {
    throw new Error(`${label} must be one lowercase 40-character commit`);
  }
  return value;
}

function requireObject(value, label = "Git object") {
  if (!OBJECT.test(value ?? "")) {
    throw new Error(`${label} must be one exact Git object id`);
  }
  return value;
}

function requireRulesetID(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("ruleset id must be one safe positive integer");
  }
  return value;
}

function requireAbsolutePath(value, label) {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path`);
  }
  return value;
}

function requireDigest(value, label) {
  if (!SHA256.test(value ?? "")) {
    throw new Error(`${label} must be one sha256 digest`);
  }
  return value;
}

function assertOutsideRepository(path, repositoryRoot, label) {
  const relation = relative(repositoryRoot, resolve(path));
  if (relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..")) {
    throw new Error(`${label} must remain outside the repository`);
  }
}

export function parseCoreReleaseArgs(args) {
  if (!Array.isArray(args) || args.length === 0) throw usageError();
  const [phase, ...rest] = args;
  const specification = PHASE_OPTIONS[phase];
  if (!specification || rest.length % 2 !== 0) throw usageError();
  const permitted = new Set([...specification.required, ...specification.optional]);
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index];
    const value = rest[index + 1];
    if (
      typeof option !== "string" ||
      !option.startsWith("--") ||
      option === "--" ||
      typeof value !== "string" ||
      value === "" ||
      value.startsWith("--")
    ) {
      throw usageError();
    }
    const name = option.slice(2);
    if (!permitted.has(name) || Object.hasOwn(values, name)) throw usageError();
    values[name] = value;
  }
  if (specification.required.some((name) => !Object.hasOwn(values, name))) {
    throw usageError();
  }
  if (values["expected-commit"] !== undefined) {
    requireCommit(values["expected-commit"], "--expected-commit");
  }
  if (values["receipt-commit"] !== undefined) {
    requireCommit(values["receipt-commit"], "--receipt-commit");
  }
  for (const name of [
    "output",
    "qualification",
    "ruleset-audit",
    "review-record",
    "tag-bundle",
    "artifact",
  ]) {
    if (values[name] !== undefined) requireAbsolutePath(values[name], `--${name}`);
  }
  if (values["ruleset-id"] !== undefined) {
    if (
      !POSITIVE_INTEGER.test(values["ruleset-id"]) ||
      !Number.isSafeInteger(Number(values["ruleset-id"]))
    ) {
      throw new Error("--ruleset-id must be one safe positive integer");
    }
  }
  if (values.mode !== undefined && !["forward", "recover"].includes(values.mode)) {
    throw new Error("--mode must be forward or recover");
  }
  return {
    phase,
    ...(values["expected-commit"] === undefined
      ? {}
      : { expectedCommit: values["expected-commit"] }),
    ...(values["receipt-commit"] === undefined
      ? {}
      : { receiptCommit: values["receipt-commit"] }),
    ...(values["ruleset-id"] === undefined
      ? {}
      : { rulesetId: Number(values["ruleset-id"]) }),
    ...(values.output === undefined ? {} : { output: values.output }),
    ...(values.qualification === undefined
      ? {}
      : { qualification: values.qualification }),
    ...(values["ruleset-audit"] === undefined
      ? {}
      : { rulesetAudit: values["ruleset-audit"] }),
    ...(values["review-record"] === undefined
      ? {}
      : { reviewRecord: values["review-record"] }),
    ...(values["tag-bundle"] === undefined
      ? {}
      : { tagBundle: values["tag-bundle"] }),
    ...(values.artifact === undefined ? {} : { artifact: values.artifact }),
    ...(values.mode === undefined ? {} : { mode: values.mode }),
  };
}

function usageError() {
  return new Error(
    "usage: takoform-core-release <prepare|audit|sign-tag|publish|record-prepare|record-push|verify> [exact phase options]",
  );
}

export function assertCoreReleasePhaseAuthority(phase, env = process.env) {
  const policy = PHASE_AUTHORITY[phase];
  if (!policy) throw new Error("Core release authority requires one exact phase");
  const allowed = new Set(policy.allowed);
  for (const name of KNOWN_AUTHORITY_ENV) {
    if (
      typeof env[name] === "string" &&
      env[name] !== "" &&
      !allowed.has(name)
    ) {
      throw new Error(`${name} is forbidden for Core release ${phase}`);
    }
  }
  for (const name of policy.required) {
    if (typeof env[name] !== "string" || env[name].trim() === "") {
      throw new Error(`${name} is required for Core release ${phase}`);
    }
  }
  for (const name of DANGEROUS_GIT_ENV) {
    if (typeof env[name] === "string" && env[name] !== "") {
      throw new Error(`${name} is forbidden for Core release ${phase}`);
    }
  }
}

export function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? result.error?.message ?? "",
  };
}

function checked(runner, command, args, options = {}) {
  const result = runner(command, args, options);
  if (!result || result.status !== 0) {
    const diagnostic = `${result?.stderr ?? ""}\n${result?.stdout ?? ""}`
      .trim()
      .slice(-8_192);
    const rendered = args
      .map((argument) =>
        /authorization:|password|token=/iu.test(String(argument))
          ? "<redacted>"
          : String(argument),
      )
      .join(" ");
    throw new Error(
      `${basename(command)} ${rendered} failed${diagnostic === "" ? "" : `: ${diagnostic}`}`,
    );
  }
  return result.stdout ?? "";
}

function minimalEnvironment(env, toolPaths, { network = false } = {}) {
  const directories = [...new Set(Object.values(toolPaths).map(dirname))];
  const result = {
    PATH: [...directories, "/usr/bin", "/bin"].join(":"),
    LANG: "C.UTF-8",
    LC_ALL: "C",
    TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_EXTERNAL_DIFF: "",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
  };
  if (network) {
    for (const name of [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
    ]) {
      if (typeof env[name] === "string") result[name] = env[name];
    }
  }
  return result;
}

const executableEvidenceCache = new Map();
const runtimeEvidenceCache = new Map();

export function validateTrustedExecutable(
  path,
  label,
  { runner = runProcess, versionArgs = ["--version"], env = process.env } = {},
) {
  requireAbsolutePath(path, `${label} executable`);
  const resolved = realpathSync(path);
  const status = lstatSync(resolved);
  const owner = typeof process.geteuid === "function" ? process.geteuid() : status.uid;
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.nlink < 1 ||
    ![0, owner].includes(status.uid) ||
    (status.mode & 0o022) !== 0 ||
    (status.mode & 0o111) === 0
  ) {
    throw new Error(
      `${label} executable must resolve to a root/current-user-owned non-group/world-writable regular executable`,
    );
  }
  accessSync(resolved, fsConstants.R_OK | fsConstants.X_OK);
  const cacheKey = `${resolved}:${status.size}:${status.mtimeMs}:${versionArgs.join("\0")}`;
  if (executableEvidenceCache.has(cacheKey)) {
    return structuredClone(executableEvidenceCache.get(cacheKey));
  }
  const version = runner(resolved, versionArgs, {
    cwd: "/",
    env: minimalEnvironment(env, { [label]: resolved }),
  });
  const combined = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
  if (version.status !== 0 && combined === "") {
    throw new Error(`${label} executable version probe failed without evidence`);
  }
  const evidence = {
    path: resolved,
    sha256: sha256(readFileSync(resolved)),
    versionProbe: {
      arguments: [...versionArgs],
      status: version.status,
      output: combined.slice(0, 4_096),
    },
  };
  executableEvidenceCache.set(cacheKey, evidence);
  return structuredClone(evidence);
}

function resolveTools(names, options = {}) {
  const configured = { ...DEFAULT_TOOL_PATHS, ...(options.tools ?? {}) };
  const tools = {};
  const evidence = {};
  for (const name of names) {
    const versionArgs = name === "sshKeygen" ? ["-?"] : ["--version"];
    const item = validateTrustedExecutable(configured[name], name, {
      runner: options.runner ?? runProcess,
      versionArgs,
      env: options.env ?? process.env,
    });
    tools[name] = item.path;
    evidence[name] = item;
  }
  return { tools, evidence };
}

export function validateCoreReleaseRuntime({
  runtimePath = process.execPath,
  expectedPath = DEFAULT_TOOL_PATHS.node,
  runtimeVersion = process.version,
} = {}) {
  requireAbsolutePath(runtimePath, "Core release parent runtime");
  requireAbsolutePath(expectedPath, "Core release expected Node runtime");
  if (runtimePath !== expectedPath) {
    throw new Error(
      `Core release owning deploy parent must be exact ${DEFAULT_TOOL_PATHS.node}`,
    );
  }
  const resolved = realpathSync(runtimePath);
  const status = lstatSync(runtimePath);
  const owner = typeof process.geteuid === "function" ? process.geteuid() : status.uid;
  if (
    resolved !== resolve(runtimePath) ||
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.nlink !== 1 ||
    ![0, owner].includes(status.uid) ||
    (status.mode & 0o022) !== 0
  ) {
    throw new Error(
      "Core release parent Node must be one exact root/current-user-owned non-group/world-writable regular executable",
    );
  }
  accessSync(resolved, fsConstants.R_OK | fsConstants.X_OK);
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+].*)?$/u.test(runtimeVersion)) {
    throw new Error("Core release parent Node process.version is invalid");
  }
  const cacheKey = [
    resolved,
    status.dev,
    status.ino,
    status.size,
    status.mode,
    status.mtimeMs,
    status.ctimeMs,
    runtimeVersion,
  ].join(":");
  if (runtimeEvidenceCache.has(cacheKey)) {
    return structuredClone(runtimeEvidenceCache.get(cacheKey));
  }
  const raw = readFileSync(resolved);
  const after = lstatSync(resolved);
  if (!sameStatusIdentity(status, after) || raw.length !== status.size) {
    throw new Error("Core release parent Node changed while its identity was read");
  }
  const evidence = {
    path: resolved,
    sha256: sha256(raw),
    versionProbe: {
      arguments: ["process.version"],
      status: 0,
      output: runtimeVersion,
    },
  };
  runtimeEvidenceCache.set(cacheKey, evidence);
  return structuredClone(evidence);
}

function normalizeToolEvidence(evidence, label) {
  if (
    !exactKeys(evidence, ["path", "sha256", "versionProbe"]) ||
    typeof evidence.path !== "string" ||
    !isAbsolute(evidence.path) ||
    !SHA256.test(evidence.sha256 ?? "") ||
    !exactKeys(evidence.versionProbe, ["arguments", "status", "output"]) ||
    !Array.isArray(evidence.versionProbe.arguments) ||
    evidence.versionProbe.arguments.length === 0 ||
    evidence.versionProbe.arguments.some(
      (argument) => typeof argument !== "string" || argument === "",
    ) ||
    !Number.isInteger(evidence.versionProbe.status) ||
    typeof evidence.versionProbe.output !== "string" ||
    evidence.versionProbe.output === "" ||
    evidence.versionProbe.output.length > 4_096
  ) {
    throw new Error(`${label} trusted executable evidence is not closed`);
  }
  return evidence;
}

function normalizeNodeRuntimeEvidence(evidence, label) {
  normalizeToolEvidence(evidence, label);
  if (
    evidence.path !== DEFAULT_TOOL_PATHS.node ||
    canonicalJSON(evidence.versionProbe.arguments) !==
      canonicalJSON(["process.version"]) ||
    evidence.versionProbe.status !== 0 ||
    !/^v[0-9]+\.[0-9]+\.[0-9]+(?:[-+].*)?$/u.test(
      evidence.versionProbe.output,
    )
  ) {
    throw new Error(`${label} is not the exact owning Node runtime evidence`);
  }
  return evidence;
}

function ownedByReleaseUser(status) {
  const uid = typeof process.getuid === "function" ? process.getuid() : status.uid;
  return status.uid === 0 || status.uid === uid;
}

function statusIdentity(status) {
  return {
    dev: `${status.dev}`,
    ino: `${status.ino}`,
    size: `${status.size}`,
    mtimeMs: `${status.mtimeMs}`,
    mode: status.mode & 0o7777,
    uid: status.uid,
    nlink: status.nlink,
  };
}

function sameStatusIdentity(left, right) {
  return canonicalJSON(statusIdentity(left)) === canonicalJSON(statusIdentity(right));
}

function assertPrivateDirectory(path, label) {
  requireAbsolutePath(path, label);
  const before = lstatSync(path);
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    realpathSync(path) !== resolve(path) ||
    !ownedByReleaseUser(before) ||
    (before.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} must be one release-owned private 0700-class directory`);
  }
  const after = lstatSync(path);
  if (!sameStatusIdentity(before, after)) {
    throw new Error(`${label} changed while custody was checked`);
  }
  return { path: resolve(path), identity: statusIdentity(after) };
}

function assertPrivateParent(path, label) {
  const parent = realpathSync(dirname(path));
  if (parent !== resolve(dirname(path))) {
    throw new Error(`${label} parent must not traverse a symlink`);
  }
  const custody = assertPrivateDirectory(parent, `${label} parent custody`);
  let ancestor = dirname(parent);
  while (true) {
    const status = lstatSync(ancestor);
    if (
      !status.isDirectory() ||
      status.isSymbolicLink() ||
      !ownedByReleaseUser(status)
    ) {
      throw new Error(`${label} ancestor custody is not release-owned`);
    }
    if (
      (status.mode & 0o022) !== 0 &&
      !((status.mode & 0o1000) !== 0 && status.uid === 0)
    ) {
      throw new Error(`${label} rejects a shared non-sticky writable ancestor`);
    }
    const next = dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  return custody;
}

function strictRegularFile(path, label, maxBytes = MAX_ARTIFACT_BYTES) {
  requireAbsolutePath(path, label);
  const status = lstatSync(path);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.nlink !== 1 ||
    status.size <= 0 ||
    status.size > maxBytes ||
    !ownedByReleaseUser(status) ||
    (status.mode & 0o022) !== 0
  ) {
    throw new Error(`${label} must be one release-owned, non-writable, nonempty regular file`);
  }
  const raw = readFileSync(path);
  const after = lstatSync(path);
  if (raw.length !== status.size || !sameStatusIdentity(status, after)) {
    throw new Error(`${label} changed while being read`);
  }
  return raw;
}

function parseCanonicalArtifact(path, label) {
  assertPrivateParent(path, label);
  const raw = strictRegularFile(path, label);
  let document;
  try {
    document = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not JSON: ${error.message}`);
  }
  if (!Buffer.from(canonicalJSON(document)).equals(raw)) {
    throw new Error(`${label} is not exact canonical JSON`);
  }
  return {
    document,
    raw,
    digest: sha256(raw),
    path: resolve(path),
    identity: statusIdentity(lstatSync(path)),
  };
}

function revalidateCanonicalArtifact(artifact, label) {
  assertPrivateParent(artifact.path, label);
  const raw = strictRegularFile(artifact.path, label);
  if (
    !sameStatusIdentity(lstatSync(artifact.path), artifact.identity) ||
    sha256(raw) !== artifact.digest ||
    !raw.equals(artifact.raw)
  ) {
    throw new Error(`${label} changed or was replaced after validation`);
  }
  return artifact;
}

function assertPrivateInputOutsideRepository(path, repositoryRoot, label) {
  requireAbsolutePath(path, label);
  const resolved = realpathSync(path);
  assertOutsideRepository(resolved, repositoryRoot, label);
  return resolved;
}

function prepareFileOutput(path, repositoryRoot, label) {
  requireAbsolutePath(path, label);
  if (existsSync(path)) throw new Error(`${label} already exists; refusing overwrite`);
  assertPrivateParent(path, label);
  assertOutsideRepository(resolve(path), repositoryRoot, label);
  return resolve(path);
}

function writeCanonicalArtifact(path, document, repositoryRoot, label) {
  const output = prepareFileOutput(path, repositoryRoot, label);
  writeFileSync(output, canonicalJSON(document), { flag: "wx", mode: 0o600 });
  const reread = parseCanonicalArtifact(output, label);
  if (canonicalJSON(reread.document) !== canonicalJSON(document)) {
    throw new Error(`${label} changed while being written`);
  }
  return reread;
}

function withTemporaryDirectory(prefix, callback) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  try {
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function gitObjectId(type, body) {
  const header = Buffer.from(`${type} ${body.length}\0`);
  return createHash("sha1").update(header).update(body).digest("hex");
}

function parseLooseGitObject(raw, expectedObject, label) {
  let inflated;
  try {
    inflated = inflateSync(raw);
  } catch (error) {
    throw new Error(`${label} is not one valid compressed Git object: ${error.message}`);
  }
  const separator = inflated.indexOf(0);
  if (separator <= 0) throw new Error(`${label} omits its Git object header`);
  const header = inflated.subarray(0, separator).toString("ascii");
  const match = /^(blob|tree|commit|tag) ([0-9]+)$/u.exec(header);
  if (!match || Number(match[2]) !== inflated.length - separator - 1) {
    throw new Error(`${label} has an invalid Git object header or size`);
  }
  const body = inflated.subarray(separator + 1);
  if (gitObjectId(match[1], body) !== expectedObject) {
    throw new Error(`${label} does not hash to its requested Git object id`);
  }
  return { type: match[1], body };
}

function parsePackIndex(raw, path) {
  if (
    raw.length < 8 + 256 * 4 + 40 ||
    raw.readUInt32BE(0) !== 0xff744f63 ||
    raw.readUInt32BE(4) !== 2
  ) {
    throw new Error(`${path} is not a Git pack index v2`);
  }
  const indexChecksum = raw.subarray(raw.length - 20);
  const calculatedIndexChecksum = createHash("sha1")
    .update(raw.subarray(0, raw.length - 20))
    .digest();
  if (!calculatedIndexChecksum.equals(indexChecksum)) {
    throw new Error(`${path} has an invalid pack-index checksum`);
  }
  const fanoutOffset = 8;
  let previous = 0;
  for (let index = 0; index < 256; index += 1) {
    const value = raw.readUInt32BE(fanoutOffset + index * 4);
    if (value < previous) throw new Error(`${path} has a decreasing fanout table`);
    previous = value;
  }
  const count = previous;
  const objectIdsOffset = fanoutOffset + 256 * 4;
  const crcOffset = objectIdsOffset + count * 20;
  const offsetsOffset = crcOffset + count * 4;
  if (offsetsOffset + count * 4 + 40 > raw.length) {
    throw new Error(`${path} is truncated before its object offsets`);
  }
  let largeCount = 0;
  for (let index = 0; index < count; index += 1) {
    if ((raw.readUInt32BE(offsetsOffset + index * 4) & 0x80000000) !== 0) {
      largeCount += 1;
    }
  }
  const largeOffset = offsetsOffset + count * 4;
  const expectedLength = largeOffset + largeCount * 8 + 40;
  if (raw.length !== expectedLength) {
    throw new Error(`${path} has a non-canonical pack-index length`);
  }
  const objects = new Map();
  let lastObject = "";
  const offsets = [];
  for (let index = 0; index < count; index += 1) {
    const object = raw
      .subarray(objectIdsOffset + index * 20, objectIdsOffset + (index + 1) * 20)
      .toString("hex");
    if (lastObject !== "" && object <= lastObject) {
      throw new Error(`${path} object ids are not strictly sorted`);
    }
    lastObject = object;
    const firstByte = Number.parseInt(object.slice(0, 2), 16);
    const lower = firstByte === 0 ? 0 : raw.readUInt32BE(fanoutOffset + (firstByte - 1) * 4);
    const upper = raw.readUInt32BE(fanoutOffset + firstByte * 4);
    if (index < lower || index >= upper) {
      throw new Error(`${path} fanout table does not bind its object ids`);
    }
    const encodedOffset = raw.readUInt32BE(offsetsOffset + index * 4);
    let offset;
    if ((encodedOffset & 0x80000000) === 0) {
      offset = encodedOffset;
    } else {
      const largeIndex = encodedOffset & 0x7fffffff;
      if (largeIndex >= largeCount) {
        throw new Error(`${path} references a missing 64-bit pack offset`);
      }
      const value = raw.readBigUInt64BE(largeOffset + largeIndex * 8);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${path} contains an unsafe 64-bit pack offset`);
      }
      offset = Number(value);
    }
    if (offset < 12 || offsets.includes(offset)) {
      throw new Error(`${path} contains a duplicate or invalid pack offset`);
    }
    offsets.push(offset);
    objects.set(object, offset);
  }
  return {
    count,
    objects,
    offsets: [...offsets].sort((left, right) => left - right),
    packChecksum: raw.subarray(raw.length - 40, raw.length - 20),
  };
}

function readPackVariableInteger(raw, state, label) {
  let value = 0;
  let shift = 0;
  for (let count = 0; count < 10; count += 1) {
    if (state.offset >= raw.length) throw new Error(`${label} is truncated`);
    const byte = raw[state.offset];
    state.offset += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if (!Number.isSafeInteger(value)) throw new Error(`${label} exceeds a safe size`);
    if ((byte & 0x80) === 0) return value;
    shift += 7;
  }
  throw new Error(`${label} has an overlong variable integer`);
}

function applyGitDelta(base, delta, label) {
  const state = { offset: 0 };
  const baseSize = readPackVariableInteger(delta, state, `${label} base size`);
  const resultSize = readPackVariableInteger(delta, state, `${label} result size`);
  if (baseSize !== base.length) throw new Error(`${label} names the wrong base size`);
  const chunks = [];
  let produced = 0;
  while (state.offset < delta.length) {
    const instruction = delta[state.offset];
    state.offset += 1;
    if ((instruction & 0x80) === 0) {
      if (instruction === 0 || state.offset + instruction > delta.length) {
        throw new Error(`${label} has an invalid insert instruction`);
      }
      chunks.push(delta.subarray(state.offset, state.offset + instruction));
      state.offset += instruction;
      produced += instruction;
      continue;
    }
    let offset = 0;
    let size = 0;
    for (let index = 0; index < 4; index += 1) {
      if ((instruction & (1 << index)) !== 0) {
        if (state.offset >= delta.length) throw new Error(`${label} copy offset is truncated`);
        offset += delta[state.offset] * 2 ** (index * 8);
        state.offset += 1;
      }
    }
    for (let index = 0; index < 3; index += 1) {
      if ((instruction & (1 << (index + 4))) !== 0) {
        if (state.offset >= delta.length) throw new Error(`${label} copy size is truncated`);
        size += delta[state.offset] * 2 ** (index * 8);
        state.offset += 1;
      }
    }
    if (size === 0) size = 0x10000;
    if (offset + size > base.length) throw new Error(`${label} copies beyond its base`);
    chunks.push(base.subarray(offset, offset + size));
    produced += size;
    if (produced > resultSize) throw new Error(`${label} produces too many bytes`);
  }
  if (produced !== resultSize) throw new Error(`${label} produces the wrong result size`);
  return Buffer.concat(chunks, resultSize);
}

function readPackedGitObject(pack, offset, resolveObject, expectedObject, stack) {
  const next = pack.index.offsets.find((candidate) => candidate > offset) ?? pack.raw.length - 20;
  if (offset >= next || next > pack.raw.length - 20) {
    throw new Error(`${pack.path} has an invalid object boundary`);
  }
  let cursor = offset;
  const first = pack.raw[cursor];
  cursor += 1;
  const typeCode = (first >> 4) & 0x07;
  let representationSize = first & 0x0f;
  let shift = 4;
  let continuation = first;
  while ((continuation & 0x80) !== 0) {
    if (cursor >= next || shift > 53) throw new Error(`${pack.path} object header is invalid`);
    continuation = pack.raw[cursor];
    cursor += 1;
    representationSize += (continuation & 0x7f) * 2 ** shift;
    shift += 7;
  }
  if (!Number.isSafeInteger(representationSize)) {
    throw new Error(`${pack.path} object representation is too large`);
  }
  let baseObject;
  let baseOffset;
  if (typeCode === 6) {
    if (cursor >= next) throw new Error(`${pack.path} OFS delta is truncated`);
    let byte = pack.raw[cursor];
    cursor += 1;
    let distance = byte & 0x7f;
    while ((byte & 0x80) !== 0) {
      if (cursor >= next || distance > (Number.MAX_SAFE_INTEGER - 127) / 128) {
        throw new Error(`${pack.path} OFS delta distance is invalid`);
      }
      byte = pack.raw[cursor];
      cursor += 1;
      distance = ((distance + 1) << 7) + (byte & 0x7f);
    }
    baseOffset = offset - distance;
    if (!pack.index.offsets.includes(baseOffset)) {
      throw new Error(`${pack.path} OFS delta references a missing base`);
    }
  } else if (typeCode === 7) {
    if (cursor + 20 > next) throw new Error(`${pack.path} REF delta is truncated`);
    baseObject = pack.raw.subarray(cursor, cursor + 20).toString("hex");
    cursor += 20;
  }
  let representation;
  try {
    representation = inflateSync(pack.raw.subarray(cursor, next));
  } catch (error) {
    throw new Error(`${pack.path} object ${expectedObject} has invalid zlib data: ${error.message}`);
  }
  if (representation.length !== representationSize) {
    throw new Error(`${pack.path} object ${expectedObject} has the wrong packed size`);
  }
  const types = new Map([[1, "commit"], [2, "tree"], [3, "blob"], [4, "tag"]]);
  let type = types.get(typeCode);
  let body = representation;
  if (typeCode === 6 || typeCode === 7) {
    const base = baseOffset === undefined
      ? resolveObject(baseObject, stack)
      : pack.resolveAtOffset(baseOffset, stack);
    type = base.type;
    body = applyGitDelta(base.body, representation, `${pack.path} object ${expectedObject} delta`);
  }
  if (type === undefined || gitObjectId(type, body) !== expectedObject) {
    throw new Error(`${pack.path} object ${expectedObject} does not rehash exactly`);
  }
  return { type, body };
}

function createRawGitObjectReader(
  gitDirectory,
  { rejectAccelerators = true } = {},
) {
  const objectsDirectory = join(gitDirectory, "objects");
  if (realpathSync(objectsDirectory) !== resolve(objectsDirectory)) {
    throw new Error("Git object directory traverses a symlink");
  }
  for (const forbidden of [
    join(objectsDirectory, "info", "alternates"),
    join(objectsDirectory, "info", "http-alternates"),
  ]) {
    if (existsSync(forbidden)) throw new Error(`Git object closure rejects ${forbidden}`);
  }
  const packDirectory = join(objectsDirectory, "pack");
  const packs = [];
  if (existsSync(packDirectory)) {
    const allNames = readdirSync(packDirectory).sort();
    for (const name of allNames) {
      if (name === "multi-pack-index" || name.endsWith(".rev") || name.endsWith(".bitmap")) {
        if (rejectAccelerators) {
          throw new Error(`Git object closure rejects accelerator ${name}`);
        }
        continue;
      }
      if (!/^pack-[0-9a-f]{40}\.(?:idx|pack)$/u.test(name)) {
        throw new Error(`Git object closure rejects unexpected pack path ${name}`);
      }
    }
    const names = allNames.filter(
      (name) =>
        name !== "multi-pack-index" &&
        !name.endsWith(".rev") &&
        !name.endsWith(".bitmap"),
    );
    const stems = new Set(names.map((name) => name.replace(/\.(?:idx|pack)$/u, "")));
    for (const stem of stems) {
      if (!names.includes(`${stem}.idx`) || !names.includes(`${stem}.pack`)) {
        throw new Error(`Git object closure requires an idx/pack pair for ${stem}`);
      }
      const indexPath = join(packDirectory, `${stem}.idx`);
      const packPath = join(packDirectory, `${stem}.pack`);
      const index = parsePackIndex(readFileSync(indexPath), indexPath);
      const raw = readFileSync(packPath);
      if (
        raw.length < 32 ||
        raw.subarray(0, 4).toString("ascii") !== "PACK" ||
        ![2, 3].includes(raw.readUInt32BE(4)) ||
        raw.readUInt32BE(8) !== index.count
      ) {
        throw new Error(`${packPath} has an invalid pack header or count`);
      }
      const trailer = raw.subarray(raw.length - 20);
      if (
        !createHash("sha1").update(raw.subarray(0, raw.length - 20)).digest().equals(trailer) ||
        !trailer.equals(index.packChecksum)
      ) {
        throw new Error(`${packPath} has an invalid or unbound pack checksum`);
      }
      for (const offset of index.offsets) {
        if (offset >= raw.length - 20) throw new Error(`${packPath} index offset is outside its pack`);
      }
      packs.push({ path: packPath, raw, index });
    }
  }
  const cache = new Map();
  const offsetCache = new Map();
  const read = (object, stack = new Set()) => {
    if (!COMMIT.test(object)) throw new Error(`Git object id is not SHA-1: ${object}`);
    if (cache.has(object)) return cache.get(object);
    if (stack.has(object) || stack.size > 128) throw new Error(`Git object graph cycles at ${object}`);
    const nextStack = new Set(stack).add(object);
    const loose = join(objectsDirectory, object.slice(0, 2), object.slice(2));
    let value;
    if (existsSync(loose)) {
      value = parseLooseGitObject(readFileSync(loose), object, loose);
    } else {
      const matches = packs.filter((pack) => pack.index.objects.has(object));
      if (matches.length !== 1) throw new Error(`Git object ${object} is absent or ambiguous`);
      const pack = matches[0];
      pack.resolveAtOffset ??= (offset, nestedStack) => {
        const key = `${pack.path}:${offset}`;
        if (offsetCache.has(key)) return offsetCache.get(key);
        const entry = [...pack.index.objects.entries()].find(([, candidate]) => candidate === offset);
        if (!entry) throw new Error(`${pack.path} offset ${offset} is not indexed`);
        const resolved = readPackedGitObject(pack, offset, read, entry[0], nestedStack);
        offsetCache.set(key, resolved);
        cache.set(entry[0], resolved);
        return resolved;
      };
      value = readPackedGitObject(pack, pack.index.objects.get(object), read, object, nextStack);
    }
    cache.set(object, value);
    return value;
  };
  return { read };
}

function parseRawCommit(reader, object, label = "Git commit") {
  const value = reader.read(object);
  if (value.type !== "commit") throw new Error(`${label} is not a commit object`);
  const separator = value.body.indexOf(Buffer.from("\n\n"));
  if (separator <= 0) throw new Error(`${label} omits its exact header boundary`);
  const headers = value.body.subarray(0, separator).toString("utf8").split("\n");
  const treeHeaders = headers.filter((line) => line.startsWith("tree "));
  const parents = headers
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length));
  if (treeHeaders.length !== 1 || !COMMIT.test(treeHeaders[0].slice(5))) {
    throw new Error(`${label} has an invalid tree header`);
  }
  if (parents.some((parent) => !COMMIT.test(parent))) {
    throw new Error(`${label} has an invalid raw parent header`);
  }
  return { object, tree: treeHeaders[0].slice(5), parents, raw: value.body };
}

function parseRawTree(reader, object, label = "Git tree") {
  const value = reader.read(object);
  if (value.type !== "tree") throw new Error(`${label} is not a tree object`);
  const entries = [];
  let offset = 0;
  while (offset < value.body.length) {
    const space = value.body.indexOf(0x20, offset);
    const nul = value.body.indexOf(0, space + 1);
    if (space <= offset || nul <= space + 1 || nul + 21 > value.body.length) {
      throw new Error(`${label} has a truncated entry`);
    }
    const mode = value.body.subarray(offset, space).toString("ascii");
    const nameRaw = value.body.subarray(space + 1, nul);
    const name = nameRaw.toString("utf8");
    if (
      !["40000", "100644", "100755", "120000", "160000"].includes(mode) ||
      !Buffer.from(name).equals(nameRaw) ||
      name === "" ||
      name === "." ||
      name === ".." ||
      name.includes("/")
    ) {
      throw new Error(`${label} has an unsafe entry`);
    }
    entries.push({ mode, name, object: value.body.subarray(nul + 1, nul + 21).toString("hex") });
    offset = nul + 21;
  }
  return entries;
}

function rawTreeSummary(reader, tree, label) {
  const children = new Map();
  let entryCount = 0;
  for (const entry of parseRawTree(reader, tree, label)) {
    if (entry.mode === "40000") {
      const child = rawTreeSummary(reader, entry.object, `${label}/${entry.name}`);
      children.set(entry.name, { object: entry.object, ...child });
      entryCount += child.entryCount;
    } else {
      entryCount += 1;
    }
  }
  return { entryCount, children };
}

function readCacheTreeRecord(raw, state, label) {
  const nul = raw.indexOf(0, state.offset);
  if (nul < state.offset) throw new Error(`${label} cache-tree name is truncated`);
  const nameRaw = raw.subarray(state.offset, nul);
  const name = nameRaw.toString("utf8");
  if (!Buffer.from(name).equals(nameRaw) || name.includes("/") || name === "." || name === "..") {
    throw new Error(`${label} cache-tree name is unsafe`);
  }
  const newline = raw.indexOf(0x0a, nul + 1);
  if (newline < 0) throw new Error(`${label} cache-tree header is truncated`);
  const header = raw.subarray(nul + 1, newline).toString("ascii");
  const match = /^(-?[0-9]+) ([0-9]+)$/u.exec(header);
  if (!match) throw new Error(`${label} cache-tree header is invalid`);
  const entryCount = Number(match[1]);
  const subtreeCount = Number(match[2]);
  if (!Number.isSafeInteger(entryCount) || !Number.isSafeInteger(subtreeCount)) {
    throw new Error(`${label} cache-tree counts are unsafe`);
  }
  state.offset = newline + 1;
  let object;
  if (entryCount >= 0) {
    if (state.offset + 20 > raw.length) {
      throw new Error(`${label} cache-tree object is truncated`);
    }
    object = raw.subarray(state.offset, state.offset + 20).toString("hex");
    state.offset += 20;
  }
  return { name, entryCount, subtreeCount, object };
}

function assertCacheTreeExtension(raw, reader, expectedTree, label) {
  const state = { offset: 0 };
  const validate = (record, tree, expectedName, path) => {
    if (record.name !== expectedName || record.entryCount < 0) {
      throw new Error(`${label} cache-tree omits or renames ${path || "root"}`);
    }
    const summary = rawTreeSummary(reader, tree, `${label} raw tree ${path || "."}`);
    if (
      record.object !== tree ||
      record.entryCount !== summary.entryCount ||
      record.subtreeCount !== summary.children.size
    ) {
      throw new Error(`${label} cache-tree differs from raw source S at ${path || "root"}`);
    }
    const observed = new Set();
    for (let index = 0; index < record.subtreeCount; index += 1) {
      const childRecord = readCacheTreeRecord(raw, state, label);
      const child = summary.children.get(childRecord.name);
      if (child === undefined || observed.has(childRecord.name)) {
        throw new Error(`${label} cache-tree has an unexpected subtree`);
      }
      observed.add(childRecord.name);
      validate(
        childRecord,
        child.object,
        childRecord.name,
        path === "" ? childRecord.name : `${path}/${childRecord.name}`,
      );
    }
  };
  validate(readCacheTreeRecord(raw, state, label), expectedTree, "", "");
  if (state.offset !== raw.length) {
    throw new Error(`${label} cache-tree has trailing bytes`);
  }
}

function parseCheckoutIndex(raw, reader, expectedCommit, label) {
  if (raw.length < 32 || raw.subarray(0, 4).toString("ascii") !== "DIRC") {
    throw new Error(`${label} is not one Git index`);
  }
  const version = raw.readUInt32BE(4);
  if (![2, 3].includes(version)) {
    throw new Error(`${label} requires Git index version 2 or 3`);
  }
  const checksumOffset = raw.length - 20;
  const expectedChecksum = createHash("sha1")
    .update(raw.subarray(0, checksumOffset))
    .digest();
  if (!expectedChecksum.equals(raw.subarray(checksumOffset))) {
    throw new Error(`${label} checksum differs`);
  }
  const commit = parseRawCommit(reader, expectedCommit, `${label} raw source S`);
  const expected = flattenRawGitTree(reader, commit.tree, `${label} raw source S`);
  const count = raw.readUInt32BE(8);
  const observed = new Set();
  let offset = 12;
  for (let index = 0; index < count; index += 1) {
    const entryStart = offset;
    if (entryStart + 62 >= checksumOffset) {
      throw new Error(`${label} entry ${index} is truncated`);
    }
    const mode = raw.readUInt32BE(entryStart + 24);
    const object = raw.subarray(entryStart + 40, entryStart + 60).toString("hex");
    const flags = raw.readUInt16BE(entryStart + 60);
    const rejected = [];
    if ((flags & 0x8000) !== 0) rejected.push("assume-unchanged");
    if ((flags & 0x3000) !== 0) rejected.push("unmerged-stage");
    let pathOffset = entryStart + 62;
    if ((flags & 0x4000) !== 0) {
      if (pathOffset + 2 >= checksumOffset) {
        throw new Error(`${label} extended flags are truncated`);
      }
      const extended = raw.readUInt16BE(pathOffset);
      pathOffset += 2;
      if ((extended & 0x4000) !== 0) rejected.push("skip-worktree");
      if ((extended & 0x2000) !== 0) rejected.push("intent-to-add");
      if ((extended & 0x0020) !== 0) rejected.push("fsmonitor-valid");
      if ((extended & ~0x6020) !== 0) rejected.push("unknown-extended");
      if (extended === 0) rejected.push("empty-extended");
    }
    if (rejected.length !== 0) {
      throw new Error(`${label} rejects ${rejected.join(", ")} index flags`);
    }
    const nul = raw.indexOf(0, pathOffset);
    if (nul < pathOffset || nul >= checksumOffset) {
      throw new Error(`${label} entry ${index} path is truncated`);
    }
    const pathRaw = raw.subarray(pathOffset, nul);
    const path = pathRaw.toString("utf8");
    const encodedLength = flags & 0x0fff;
    if (
      !Buffer.from(path).equals(pathRaw) ||
      path === "" ||
      path.startsWith("/") ||
      path.split("/").some((part) => part === "" || part === "." || part === "..") ||
      (pathRaw.length < 0x0fff
        ? encodedLength !== pathRaw.length
        : encodedLength !== 0x0fff)
    ) {
      throw new Error(`${label} entry ${index} path is unsafe or non-canonical`);
    }
    const expectedEntry = expected.get(path);
    if (
      expectedEntry === undefined ||
      observed.has(path) ||
      mode !== Number.parseInt(expectedEntry.mode, 8) ||
      object !== expectedEntry.object
    ) {
      throw new Error(`${label} entry ${path} mode or object differs from raw source S`);
    }
    observed.add(path);
    offset = entryStart + Math.ceil((nul - entryStart + 1) / 8) * 8;
    if (offset > checksumOffset || raw.subarray(nul, offset).some((byte) => byte !== 0)) {
      throw new Error(`${label} entry ${path} padding is invalid`);
    }
  }
  let cacheTreeSeen = false;
  while (offset < checksumOffset) {
    if (offset + 8 > checksumOffset) throw new Error(`${label} extension is truncated`);
    const signature = raw.subarray(offset, offset + 4).toString("ascii");
    const size = raw.readUInt32BE(offset + 4);
    const end = offset + 8 + size;
    if (end > checksumOffset) throw new Error(`${label} ${signature} extension is truncated`);
    if (signature !== "TREE" || cacheTreeSeen) {
      throw new Error(`${label} rejects Git index extension ${signature}`);
    }
    assertCacheTreeExtension(
      raw.subarray(offset + 8, end),
      reader,
      commit.tree,
      label,
    );
    cacheTreeSeen = true;
    offset = end;
  }
  if (count !== expected.size || observed.size !== expected.size) {
    throw new Error(`${label} paths differ from raw source S`);
  }
  return { tree: commit.tree, entries: observed.size };
}

function assertCheckoutIndexMatchesRawSource(repository, expectedCommit) {
  const gitDirectory = join(repository, ".git");
  const path = join(gitDirectory, "index");
  const raw = strictRegularFile(path, "Core release checkout index", 128 * 1024 * 1024);
  const reader = createRawGitObjectReader(gitDirectory, { rejectAccelerators: false });
  parseCheckoutIndex(raw, reader, expectedCommit, "Core release checkout index");
  return { path, digest: sha256(raw) };
}

function trackedAttributeFiles(reader, commit) {
  const root = parseRawCommit(reader, commit, "source S raw commit").tree;
  const attributes = new Map();
  const walk = (tree, prefix = "", depth = 0) => {
    if (depth > 128 || attributes.size > 10_000) {
      throw new Error("source S tree exceeds the tracked-attributes closure limit");
    }
    for (const entry of parseRawTree(reader, tree, `source S tree ${prefix || "."}`)) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.mode === "40000") {
        walk(entry.object, path, depth + 1);
      } else if (entry.name === ".gitattributes") {
        if (!["100644", "100755"].includes(entry.mode)) {
          throw new Error(`source S tracked .gitattributes ${path} is not a regular blob`);
        }
        const value = reader.read(entry.object);
        if (value.type !== "blob") throw new Error(`source S ${path} is not a blob`);
        attributes.set(path, value.body);
      }
    }
  };
  walk(root);
  return attributes;
}

function assertAttributeBytesSafe(raw, path) {
  const text = raw.toString("utf8");
  if (!Buffer.from(text).equals(raw) || text.includes("\0") || text.includes("\r")) {
    throw new Error(`source S tracked .gitattributes ${path} is not strict UTF-8 text`);
  }
  for (const line of text.split("\n")) {
    if (/^[ \t]*#/u.test(line)) continue;
    if (/(?:^|[ \t])[-!]?(?:filter|diff|working-tree-encoding|process)(?:[ \t=]|$)/iu.test(line)) {
      throw new Error(`source S tracked .gitattributes ${path} contains executable semantics`);
    }
  }
}

function assertTrackedAttributesClosure(repository, gitDirectory, expectedCommit) {
  const reader = createRawGitObjectReader(gitDirectory);
  const expected = trackedAttributeFiles(reader, expectedCommit);
  for (const [path, raw] of expected) assertAttributeBytesSafe(raw, path);
  const found = new Map();
  let entries = 0;
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      if (prefix === "" && name === ".git") continue;
      entries += 1;
      if (entries > 100_000) throw new Error("checkout exceeds tracked-attributes scan limit");
      const path = join(directory, name);
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const status = lstatSync(path);
      if (status.isDirectory() && !status.isSymbolicLink()) walk(path, relativePath);
      if (name === ".gitattributes") {
        if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1) {
          throw new Error(`checkout .gitattributes ${relativePath} is not one regular file`);
        }
        const raw = readFileSync(path);
        found.set(relativePath, raw);
      }
    }
  };
  walk(repository);
  if (found.size !== expected.size) {
    throw new Error("checkout .gitattributes paths differ from source S");
  }
  for (const [path, raw] of expected) {
    const actual = found.get(path);
    if (actual === undefined || !actual.equals(raw)) {
      throw new Error(`checkout .gitattributes ${path} differs from source S`);
    }
  }
  return [...expected.entries()].map(([path, raw]) => ({ path, digest: sha256(raw) }));
}

function parseSafeCheckoutConfig(raw) {
  const allowed = new Map([
    ["core.repositoryformatversion", (value) => value === "0"],
    ["core.filemode", (value) => ["true", "false"].includes(value)],
    ["core.bare", (value) => value === "false"],
    ["core.logallrefupdates", (value) => value === "true"],
    ["user.name", (value) => value !== "" && !/[\0\r\n]/u.test(value)],
    ["user.email", (value) => value !== "" && !/[\0\r\n]/u.test(value)],
    ["remote.origin.url", (value) => value !== "" && !/[\0\r\n]/u.test(value)],
    [
      "remote.origin.fetch",
      (value) => value === "+refs/heads/*:refs/remotes/origin/*",
    ],
    ["remote.origin.tagopt", (value) => value === "--no-tags"],
    ["branch.main.remote", (value) => value === "origin"],
    ["branch.main.merge", (value) => value === "refs/heads/main"],
  ]);
  const required = new Set([
    "core.repositoryformatversion",
    "core.filemode",
    "core.bare",
    "core.logallrefupdates",
  ]);
  const observed = new Map();
  let section = null;
  for (const line of Buffer.from(raw).toString("utf8").split("\n")) {
    if (line === "") continue;
    const sectionMatch = /^\[([a-z][a-z0-9.-]*)(?: "([A-Za-z0-9._-]+)")?\]$/u.exec(
      line,
    );
    if (sectionMatch) {
      section = sectionMatch[2] === undefined
        ? sectionMatch[1]
        : `${sectionMatch[1]}.${sectionMatch[2]}`;
      continue;
    }
    const valueMatch = /^\t([A-Za-z][A-Za-z0-9.-]*) = ([^\0\r\n]*)$/u.exec(line);
    if (!section || !valueMatch) {
      throw new Error("unsafe local Git config is not strict canonical config");
    }
    const key = `${section}.${valueMatch[1]}`.toLowerCase();
    const validator = allowed.get(key);
    if (!validator || observed.has(key) || !validator(valueMatch[2])) {
      throw new Error(`unsafe local Git config key or value: ${key}`);
    }
    observed.set(key, valueMatch[2]);
  }
  for (const key of required) {
    if (!observed.has(key)) {
      throw new Error(`unsafe local Git config omits ${key}`);
    }
  }
  return observed;
}

function assertCredentialedCheckoutClosure(repository, expectedCommit) {
  requireAbsolutePath(repository, "credentialed release repository");
  requireCommit(expectedCommit);
  const root = realpathSync(repository);
  if (root !== resolve(repository) || !lstatSync(root).isDirectory()) {
    throw new Error("credentialed release checkout root is not one real directory");
  }
  const gitDirectory = join(root, ".git");
  const gitStatus = lstatSync(gitDirectory);
  if (
    !gitStatus.isDirectory() ||
    gitStatus.isSymbolicLink() ||
    realpathSync(gitDirectory) !== gitDirectory
  ) {
    throw new Error("credentialed release checkout requires one standalone real .git directory");
  }
  for (const forbidden of [
    "commondir",
    "config.worktree",
    "gitdir",
    "worktrees",
  ]) {
    if (existsSync(join(gitDirectory, forbidden))) {
      throw new Error(`credentialed release checkout rejects .git/${forbidden}`);
    }
  }
  const configPath = join(gitDirectory, "config");
  const config = strictRegularFile(
    configPath,
    "credentialed release local Git config",
    256 * 1024,
  );
  parseSafeCheckoutConfig(config);
  const headPath = join(gitDirectory, "HEAD");
  const head = strictRegularFile(
    headPath,
    "credentialed release detached HEAD",
    1024,
  );
  if (!head.equals(Buffer.from(`${expectedCommit}\n`))) {
    throw new Error("credentialed release checkout is not detached at exact source S");
  }
  if (existsSync(join(gitDirectory, "info", "attributes"))) {
    throw new Error("credentialed release checkout rejects .git/info/attributes");
  }
  for (const forbidden of [
    join(gitDirectory, "objects", "info", "commit-graph"),
    join(gitDirectory, "objects", "info", "commit-graphs"),
    join(gitDirectory, "objects", "pack", "multi-pack-index"),
  ]) {
    if (existsSync(forbidden)) {
      throw new Error(`credentialed release checkout rejects Git accelerator ${forbidden}`);
    }
  }
  const index = assertCheckoutIndexMatchesRawSource(root, expectedCommit);
  const attributes = assertTrackedAttributesClosure(root, gitDirectory, expectedCommit);
  return {
    repository: root,
    expectedCommit,
    config: { path: configPath, digest: sha256(config) },
    head: { path: headPath, digest: sha256(head) },
    index,
    attributes,
  };
}

function assertCredentialedCheckoutStable(closure) {
  if (closure === undefined) return;
  for (const item of [closure.config, closure.head, closure.index]) {
    const raw = strictRegularFile(item.path, "credentialed checkout closure file");
    if (sha256(raw) !== item.digest) {
      throw new Error("credentialed release checkout changed after bootstrap closure");
    }
  }
  if (existsSync(join(closure.repository, ".git", "info", "attributes"))) {
    throw new Error("credentialed release checkout gained .git/info/attributes");
  }
  const index = assertCheckoutIndexMatchesRawSource(
    closure.repository,
    closure.expectedCommit,
  );
  if (index.digest !== closure.index.digest) {
    throw new Error("credentialed release checkout index changed after bootstrap closure");
  }
  const attributes = assertTrackedAttributesClosure(
    closure.repository,
    join(closure.repository, ".git"),
    closure.expectedCommit,
  );
  if (canonicalJSON(attributes) !== canonicalJSON(closure.attributes)) {
    throw new Error("credentialed release checkout attributes changed after bootstrap closure");
  }
}

function baseGitArgs() {
  return [
    "--no-replace-objects",
    "-c",
    "credential.helper=",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.attributesFile=/dev/null",
    "-c",
    "diff.external=",
    "-c",
    "protocol.ext.allow=never",
  ];
}

function gitEnvironment(env, tools, { network = false, extra = {} } = {}) {
  return {
    ...minimalEnvironment(env, tools, { network }),
    HOME: tmpdir(),
    ...extra,
  };
}

function gitChecked(context, args, options = {}) {
  assertCredentialedCheckoutStable(context.checkoutClosure);
  options.beforeRun?.();
  return checked(context.runner, context.tools.git, [...baseGitArgs(), ...args], {
    cwd: options.cwd ?? context.repo,
    env: options.env ?? gitEnvironment(context.env, context.tools),
    input: options.input,
  });
}

function buildContext(
  phase,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    toolNames = [],
    credentialedCommit,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
  } = {},
) {
  // Bootstrap authority is the first operation by design.  Tests use the
  // runner/http trace to enforce that off-phase authority reaches nothing.
  assertCoreReleasePhaseAuthority(phase, env);
  const runtimeEvidence = validateCoreReleaseRuntime({
    runtimePath,
    expectedPath: DEFAULT_TOOL_PATHS.node,
    runtimeVersion,
  });
  requireAbsolutePath(repo, "release repository");
  const repositoryRoot = realpathSync(repo);
  const checkoutClosure = credentialedCommit === undefined
    ? undefined
    : assertCredentialedCheckoutClosure(repositoryRoot, credentialedCommit);
  const resolved = resolveTools(toolNames, { env, runner, tools });
  return {
    phase,
    repo: repositoryRoot,
    env,
    runner,
    tools: { node: runtimeEvidence.path, ...resolved.tools },
    toolEvidence: { node: runtimeEvidence, ...resolved.evidence },
    checkoutClosure,
    sourceClosures: new Map(),
  };
}

function phaseState(phase) {
  return {
    phase,
    stage: "bootstrap",
    repositoryStateTouched: false,
    repositoryStateIndeterminate: false,
    externalStateTouched: false,
    externalStateIndeterminate: false,
  };
}

function phaseStep(state, stage, callback) {
  state.stage = stage;
  try {
    return callback();
  } catch (error) {
    if (error instanceof ReleaseFailure) throw error;
    throw new ReleaseFailure(`${stage} failed: ${error.message}`, state, error);
  }
}

export function coreGoInstallTargets() {
  return CORE_RELEASE.commands.map(
    ({ name }) => `${CORE_RELEASE.module}/cmd/${name}@${CORE_RELEASE.version}`,
  );
}

export function assertPinnedGoToolchainVersion(version) {
  if (String(version).trim() !== CORE_RELEASE.goToolchain) {
    throw new Error(
      `Core release requires ${CORE_RELEASE.goToolchain}; received ${String(version).trim() || "empty"}`,
    );
  }
}

export function parseCoreTagAllowedSigner(raw) {
  const text = Buffer.from(raw).toString("utf8");
  const match =
    /^# fingerprint (SHA256:\S+)\n([A-Za-z0-9._-]+) namespaces="git" (ssh-ed25519) ([A-Za-z0-9+/]+={0,3})\n$/u.exec(
      text,
    );
  if (
    !match ||
    match[2] !== CORE_RELEASE.tagSignerPrincipal ||
    match[3] !== "ssh-ed25519"
  ) {
    throw new Error("Core tag allowed-signers authority differs from the pin");
  }
  const decoded = Buffer.from(match[4], "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== match[4]) {
    throw new Error("Core tag allowed-signers public key is not canonical base64");
  }
  if (decoded.length < 8) {
    throw new Error("Core tag allowed-signers public key wire value is truncated");
  }
  const algorithmLength = decoded.readUInt32BE(0);
  const algorithmEnd = 4 + algorithmLength;
  if (algorithmEnd + 4 > decoded.length) {
    throw new Error("Core tag allowed-signers public key algorithm is truncated");
  }
  const algorithm = decoded.subarray(4, algorithmEnd).toString("ascii");
  const keyLength = decoded.readUInt32BE(algorithmEnd);
  const keyOffset = algorithmEnd + 4;
  if (
    algorithm !== "ssh-ed25519" ||
    keyLength !== 32 ||
    keyOffset + keyLength !== decoded.length
  ) {
    throw new Error("Core tag allowed-signers public key wire value is not exact Ed25519");
  }
  const computedFingerprint = `SHA256:${createHash("sha256")
    .update(decoded)
    .digest("base64")
    .replace(/=+$/u, "")}`;
  if (
    computedFingerprint !== CORE_RELEASE.tagSignerFingerprint ||
    match[1] !== computedFingerprint
  ) {
    throw new Error(
      "Core tag allowed-signers computed public-key fingerprint differs from the pin",
    );
  }
  return {
    fingerprint: computedFingerprint,
    principal: match[2],
    keyType: match[3],
    publicKey: match[4],
  };
}

export function coreTagSigningGitConfig(
  privateKey,
  sshKeygen = realpathSync(DEFAULT_TOOL_PATHS.sshKeygen),
) {
  requireAbsolutePath(privateKey, "Core tag signing key config");
  requireAbsolutePath(sshKeygen, "Core ssh-keygen config");
  return [
    "-c",
    "gpg.format=ssh",
    "-c",
    `gpg.ssh.program=${sshKeygen}`,
    "-c",
    `user.signingkey=${privateKey}`,
    "-c",
    "user.name=tako0614",
    "-c",
    "user.email=tako0614@users.noreply.github.com",
    "-c",
    "tag.gpgSign=true",
  ];
}

export function coreTagVerificationGitConfig(
  allowedSigners,
  sshKeygen = realpathSync(DEFAULT_TOOL_PATHS.sshKeygen),
) {
  requireAbsolutePath(allowedSigners, "Core tag allowed-signers config");
  requireAbsolutePath(sshKeygen, "Core ssh-keygen config");
  return [
    "-c",
    "gpg.format=ssh",
    "-c",
    `gpg.ssh.program=${sshKeygen}`,
    "-c",
    `gpg.ssh.allowedSignersFile=${allowedSigners}`,
    "-c",
    "gpg.minTrustLevel=fully",
  ];
}

function readTagAuthority(repositoryRoot, expectedCommit) {
  requireCommit(expectedCommit);
  const gitDirectory = existsSync(join(repositoryRoot, ".git"))
    ? join(repositoryRoot, ".git")
    : repositoryRoot;
  const reader = createRawGitObjectReader(gitDirectory, {
    rejectAccelerators: false,
  });
  const commit = parseRawCommit(
    reader,
    expectedCommit,
    "Core tag authority source commit",
  );
  const entry = flattenRawGitTree(
    reader,
    commit.tree,
    "Core tag authority raw tree",
  ).get(CORE_RELEASE.tagAllowedSigners);
  if (entry === undefined || !["100644", "100755"].includes(entry.mode)) {
    throw new Error("Core tag allowed-signers is absent from raw source authority");
  }
  const object = reader.read(entry.object);
  if (object.type !== "blob" || object.body.length > 64 * 1024) {
    throw new Error("Core tag allowed-signers raw source authority is not one bounded blob");
  }
  return {
    sourceCommit: expectedCommit,
    object: entry.object,
    raw: object.body,
    digest: sha256(object.body),
    identity: parseCoreTagAllowedSigner(object.body),
  };
}

function materializeTagAuthority(directory, authority) {
  const path = join(directory, "core-tag-allowed-signers");
  writeFileSync(path, authority.raw, { flag: "wx", mode: 0o600 });
  const reread = strictRegularFile(path, "materialized Core tag authority", 64 * 1024);
  if (!reread.equals(authority.raw) || sha256(reread) !== authority.digest) {
    throw new Error("materialized Core tag authority differs from raw source S");
  }
  return path;
}

function assertTagAuthorityLineage(repository, sourceCommit, parentCommit) {
  const source = readTagAuthority(repository, sourceCommit);
  const parent = readTagAuthority(repository, parentCommit);
  if (
    source.object !== parent.object ||
    source.digest !== parent.digest ||
    !source.raw.equals(parent.raw) ||
    canonicalJSON(source.identity) !== canonicalJSON(parent.identity)
  ) {
    throw new Error("Core tag authority bytes changed between raw source S and parent P");
  }
  return source;
}

function gitResult(context, args, options = {}) {
  assertCredentialedCheckoutStable(context.checkoutClosure);
  options.beforeRun?.();
  return context.runner(context.tools.git, [...baseGitArgs(), ...args], {
    cwd: options.cwd ?? context.repo,
    env:
      options.env ??
      gitEnvironment(context.env, context.tools, {
        network: options.network === true,
        extra: options.extraEnv ?? {},
      }),
    input: options.input,
  });
}

function parseSingleRemoteRef(raw, expectedRef) {
  const lines = String(raw).trim() === "" ? [] : String(raw).trim().split("\n");
  if (lines.length !== 1) {
    throw new Error(`remote ${expectedRef} is absent or ambiguous`);
  }
  const match = /^([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(lines[0]);
  if (!match || match[2] !== expectedRef) {
    throw new Error(`remote ${expectedRef} response is not exact`);
  }
  return match[1];
}

function assertRepositorySource(
  context,
  expectedCommit,
  {
    attachedMain = false,
    detached = false,
    expectNoRemote = false,
    allowNodeModules = false,
  } = {},
) {
  requireCommit(expectedCommit);
  assertCheckoutIndexMatchesRawSource(context.repo, expectedCommit);
  const root = gitChecked(context, ["rev-parse", "--show-toplevel"]).trim();
  if (realpathSync(root) !== context.repo) {
    throw new Error("Core release is not running from the exact repository root");
  }
  const head = gitChecked(context, ["rev-parse", "HEAD"]).trim();
  if (head !== expectedCommit) throw new Error("repository HEAD differs from source S");
  const status = gitChecked(context, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const dirty = status
    .split("\0")
    .filter((entry) => entry !== "")
    .filter(
      (entry) =>
        !allowNodeModules ||
        !(entry.startsWith("?? node_modules/") || entry === "?? node_modules"),
    );
  if (dirty.length !== 0) throw new Error("repository source is not clean");
  const symbolic = gitResult(context, ["symbolic-ref", "--quiet", "HEAD"]);
  if (attachedMain) {
    if (symbolic.status !== 0 || symbolic.stdout.trim() !== CORE_RELEASE.ref) {
      throw new Error("prepare must run from attached canonical main");
    }
  } else if (detached && symbolic.status !== 1) {
    throw new Error("this phase must run from a detached source-S checkout");
  }
  if (
    gitChecked(context, ["rev-parse", "--is-shallow-repository"]).trim() !==
    "false"
  ) {
    throw new Error("Core release source must not be shallow");
  }
  if (gitChecked(context, ["replace", "-l"]).trim() !== "") {
    throw new Error("Core release source contains replacement refs");
  }
  const common = gitChecked(context, ["rev-parse", "--git-common-dir"]).trim();
  if (existsSync(resolve(context.repo, common, "objects", "info", "alternates"))) {
    throw new Error("Core release source contains object alternates");
  }
  if (expectNoRemote && gitChecked(context, ["remote"]).trim() !== "") {
    throw new Error("isolated source retains a remote");
  }
  const tree = gitChecked(context, ["rev-parse", `${expectedCommit}^{tree}`]).trim();
  requireObject(tree, "source tree");
  return tree;
}

function assertCanonicalPrepareSource(context, expectedCommit, origin) {
  const tree = assertRepositorySource(context, expectedCommit, {
    attachedMain: true,
  });
  const closure = context.sourceClosures.get(context.repo) ??
    initializeSourceClosure(context, context.repo, expectedCommit);
  assertQualifiedWorktreeClosure(context.repo, closure, undefined);
  const configured = gitChecked(context, ["remote", "get-url", "origin"]).trim();
  if (configured !== origin) {
    throw new Error("prepare origin is not the exact canonical origin");
  }
  const remote = parseSingleRemoteRef(
    gitChecked(context, ["ls-remote", origin, CORE_RELEASE.ref], {
      cwd: "/",
      env: gitEnvironment(context.env, context.tools, { network: true }),
    }),
    CORE_RELEASE.ref,
  );
  if (remote !== expectedCommit) {
    throw new Error("canonical main does not equal source S");
  }
  assertCoreReleaseBaseLedger(
    parseNormalizedLedger(
      gitChecked(context, ["show", `${expectedCommit}:${CORE_RELEASE.ledger}`]),
      "source S",
    ),
  );
  return tree;
}

function assertDetachedSource(context, expectedCommit) {
  return assertRepositorySource(context, expectedCommit, { detached: true });
}

function measureDirectoryClosure(
  root,
  label,
  { directoryMtime = true, confinedSymlinks = false } = {},
) {
  if (!existsSync(root)) return null;
  if (
    confinedSymlinks &&
    (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
  ) {
    throw new Error(`${label} root must be one real directory`);
  }
  const resolvedRoot = realpathSync(root);
  const inventory = [];
  let count = 0;
  const walk = (path, prefix = "") => {
    const status = lstatSync(path);
    if (!ownedByReleaseUser(status)) throw new Error(`${label} has a foreign-owned path ${prefix || "."}`);
    count += 1;
    if (count > 500_000) throw new Error(`${label} exceeds its closure entry limit`);
    if (status.isDirectory() && !status.isSymbolicLink()) {
      inventory.push({
        path: prefix || ".",
        type: "directory",
        mode: status.mode & 0o777,
        uid: status.uid,
        dev: `${status.dev}`,
        ino: `${status.ino}`,
        ...(directoryMtime ? { mtimeMs: `${status.mtimeMs}` } : {}),
      });
      for (const name of readdirSync(path).sort()) {
        walk(join(path, name), prefix === "" ? name : `${prefix}/${name}`);
      }
      return;
    }
    if (status.isFile() && !status.isSymbolicLink()) {
      const raw = readFileSync(path);
      const after = lstatSync(path);
      if (!sameStatusIdentity(status, after) || raw.length !== status.size) {
        throw new Error(`${label} path ${prefix} changed while measured`);
      }
      inventory.push({
        path: prefix,
        type: "file",
        mode: status.mode & 0o777,
        uid: status.uid,
        dev: `${status.dev}`,
        ino: `${status.ino}`,
        nlink: status.nlink,
        bytes: raw.length,
        mtimeMs: `${status.mtimeMs}`,
        sha256: sha256(raw),
      });
      return;
    }
    if (status.isSymbolicLink()) {
      const target = readlinkSync(path, { encoding: "buffer" });
      const after = lstatSync(path);
      if (!sameStatusIdentity(status, after)) {
        throw new Error(`${label} symlink ${prefix} changed while measured`);
      }
      let resolvedTarget;
      if (confinedSymlinks) {
        const targetText = target.toString("utf8");
        if (!Buffer.from(targetText).equals(target)) {
          throw new Error(`${label} symlink ${prefix} has a non-UTF-8 target`);
        }
        try {
          resolvedTarget = realpathSync(path);
        } catch (error) {
          throw new Error(`${label} symlink ${prefix} is not closed: ${error.message}`);
        }
        const relation = relative(resolvedRoot, resolvedTarget);
        if (relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
          throw new Error(`${label} symlink ${prefix} escapes its measured closure`);
        }
      }
      inventory.push({
        path: prefix,
        type: "symlink",
        mode: status.mode & 0o777,
        uid: status.uid,
        dev: `${status.dev}`,
        ino: `${status.ino}`,
        mtimeMs: `${status.mtimeMs}`,
        targetBase64: target.toString("base64"),
        ...(resolvedTarget === undefined
          ? {}
          : { resolvedTarget: relative(resolvedRoot, resolvedTarget) || "." }),
      });
      return;
    }
    throw new Error(`${label} contains unsupported path ${prefix || "."}`);
  };
  walk(root);
  return inventory;
}

function initializeSourceClosure(context, source, expectedCommit) {
  const gitDirectory = join(source, ".git");
  const reader = createRawGitObjectReader(gitDirectory, {
    rejectAccelerators: false,
  });
  const commit = parseRawCommit(reader, expectedCommit, "qualified source raw S");
  const files = flattenRawGitTree(reader, commit.tree, "qualified source raw S");
  const directories = new Set();
  for (const path of files.keys()) {
    const parts = path.split("/");
    for (let count = 1; count < parts.length; count += 1) {
      directories.add(parts.slice(0, count).join("/"));
    }
  }
  const closure = {
    expectedCommit,
    reader,
    files,
    directories,
    gitMetadata: measureDirectoryClosure(gitDirectory, "qualified source Git metadata", {
      directoryMtime: false,
    }),
  };
  context.sourceClosures.set(source, closure);
  return closure;
}

function assertQualifiedWorktreeClosure(source, closure, nodeModules) {
  const observedFiles = new Set();
  const observedDirectories = new Set();
  let count = 0;
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      if (prefix === "" && name === ".git") continue;
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      if (prefix === "" && name === "node_modules") {
        const measured = measureDirectoryClosure(
          join(directory, name),
          "qualified source measured node_modules",
          { confinedSymlinks: true },
        );
        if (
          nodeModules === undefined ||
          canonicalJSON(measured) !== canonicalJSON(nodeModules)
        ) {
          throw new Error("qualified source node_modules differs from its exact post-install seal");
        }
        continue;
      }
      count += 1;
      if (count > 500_000) throw new Error("qualified source worktree exceeds its closure limit");
      const path = join(directory, name);
      const status = lstatSync(path);
      if (status.isDirectory() && !status.isSymbolicLink()) {
        observedDirectories.add(relativePath);
        walk(path, relativePath);
        continue;
      }
      const expected = closure.files.get(relativePath);
      if (expected === undefined) {
        throw new Error(`qualified source contains ignored or untracked path ${relativePath}`);
      }
      observedFiles.add(relativePath);
      if (["100644", "100755"].includes(expected.mode)) {
        if (!status.isFile() || status.isSymbolicLink()) {
          throw new Error(`qualified source tracked file ${relativePath} changed type`);
        }
        const raw = readFileSync(path);
        const after = lstatSync(path);
        if (
          !sameStatusIdentity(status, after) ||
          gitObjectId("blob", raw) !== expected.object ||
          ((status.mode & 0o111) !== 0) !== (expected.mode === "100755")
        ) {
          throw new Error(`qualified source tracked file ${relativePath} differs from S`);
        }
      } else if (expected.mode === "120000") {
        if (!status.isSymbolicLink()) {
          throw new Error(`qualified source tracked symlink ${relativePath} changed type`);
        }
        const target = readlinkSync(path, { encoding: "buffer" });
        if (gitObjectId("blob", target) !== expected.object) {
          throw new Error(`qualified source tracked symlink ${relativePath} differs from S`);
        }
      } else {
        throw new Error(`qualified source rejects tracked gitlink ${relativePath}`);
      }
    }
  };
  walk(source);
  if (
    canonicalJSON([...observedFiles].sort()) !==
      canonicalJSON([...closure.files.keys()].sort()) ||
    canonicalJSON([...observedDirectories].sort()) !==
      canonicalJSON([...closure.directories].sort())
  ) {
    throw new Error("qualified source filesystem paths differ from exact source S");
  }
}

function assertSourceGitMetadataClosure(repository, closure) {
  const gitMetadata = measureDirectoryClosure(
    join(repository, ".git"),
    "qualified source Git metadata",
    { directoryMtime: false },
  );
  if (canonicalJSON(gitMetadata) !== canonicalJSON(closure.gitMetadata)) {
    const before = new Map(closure.gitMetadata.map((entry) => [entry.path, entry]));
    const after = new Map(gitMetadata.map((entry) => [entry.path, entry]));
    const changed = [...new Set([...before.keys(), ...after.keys()])].find(
      (path) => canonicalJSON(before.get(path)) !== canonicalJSON(after.get(path)),
    );
    throw new Error(
      `qualified source Git metadata drifted after clone closure at ${changed ?? "unknown"}`,
    );
  }
}

function sourceFence(context, source, expectedCommit, nodeModules = undefined) {
  const nested = { ...context, repo: realpathSync(source) };
  let closure = context.sourceClosures.get(nested.repo);
  if (closure !== undefined) {
    assertQualifiedWorktreeClosure(nested.repo, closure, nodeModules);
    assertSourceGitMetadataClosure(nested.repo, closure);
  }
  const tree = assertRepositorySource(nested, expectedCommit, {
    detached: true,
    expectNoRemote: true,
    allowNodeModules: nodeModules !== undefined,
  });
  closure ??= initializeSourceClosure(context, nested.repo, expectedCommit);
  if (closure.expectedCommit !== expectedCommit) {
    throw new Error("qualified source closure changed source commit");
  }
  assertQualifiedWorktreeClosure(nested.repo, closure, nodeModules);
  assertSourceGitMetadataClosure(nested.repo, closure);
  return tree;
}

function goEnvironment(context, root, target = {}) {
  const home = join(root, "home");
  const moduleCache = join(root, "gomodcache");
  const buildCache = join(root, "gocache");
  for (const path of [home, moduleCache, buildCache]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  return {
    ...minimalEnvironment(context.env, context.tools, { network: true }),
    HOME: home,
    GOENV: "off",
    GOFLAGS: "",
    GOTOOLCHAIN: "local",
    GOWORK: "off",
    GOMODCACHE: moduleCache,
    GOCACHE: buildCache,
    CGO_ENABLED: "0",
    GOPROXY: "https://proxy.golang.org,direct",
    GOSUMDB: "sum.golang.org",
    GOPRIVATE: "",
    GONOPROXY: "",
    GONOSUMDB: "",
    GOINSECURE: "",
    ...(target.os === undefined ? {} : { GOOS: target.os }),
    ...(target.arch === undefined ? {} : { GOARCH: target.arch }),
  };
}

function lifecycleCommand(
  context,
  source,
  expectedCommit,
  command,
  args,
  runtime,
  nodeModules = undefined,
) {
  sourceFence(context, source, expectedCommit, nodeModules);
  const stdout = checked(context.runner, command, args, {
    cwd: source,
    env: goEnvironment(context, runtime),
  });
  sourceFence(context, source, expectedCommit, nodeModules);
  return stdout;
}

function cloneExactSource(context, destination, expectedCommit, origin) {
  gitChecked(
    context,
    [
      "-c",
      "protocol.file.allow=always",
      "clone",
      "--no-tags",
      "--single-branch",
      "--branch",
      CORE_RELEASE.branch,
      origin,
      destination,
    ],
    {
      cwd: dirname(destination),
      env: gitEnvironment(context.env, context.tools, { network: true }),
    },
  );
  const nested = { ...context, repo: destination };
  gitChecked(nested, ["checkout", "--detach", expectedCommit]);
  gitChecked(nested, ["remote", "remove", "origin"]);
  removeRecordRepositoryAccelerators(join(destination, ".git"));
  sourceFence(context, destination, expectedCommit);
  const edit = JSON.parse(
    lifecycleCommand(
      context,
      destination,
      expectedCommit,
      context.tools.go,
      ["mod", "edit", "-json"],
      join(dirname(destination), `go-mod-edit-${basename(destination)}`),
    ),
  );
  if (Array.isArray(edit.Replace) && edit.Replace.length > 0) {
    throw new Error("isolated source go.mod contains replace directives");
  }
  return sourceFence(context, destination, expectedCommit);
}

function hostTarget() {
  const os =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return { os, arch };
}

function parseQualifiedVersion(raw, command, expectedCommit) {
  let value;
  try {
    value = JSON.parse(String(raw).trim());
  } catch (error) {
    throw new Error(`${command} version output is not JSON: ${error.message}`);
  }
  const expected = {
    command,
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    commit: expectedCommit,
  };
  if (!exactKeys(value, Object.keys(expected)) || canonicalJSON(value) !== canonicalJSON(expected)) {
    throw new Error(`${command} local version output is not exact`);
  }
  return expected;
}

function qualifyClone(context, source, runtime, expectedCommit, label, chosenHost) {
  sourceFence(context, source, expectedCommit);
  checked(context.runner, context.tools.bun, ["install", "--frozen-lockfile"], {
    cwd: source,
    env: goEnvironment(context, join(runtime, "bun-install")),
  });
  const nodeModules = measureDirectoryClosure(
    join(source, "node_modules"),
    "qualified source post-install node_modules",
    { confinedSymlinks: true },
  );
  sourceFence(context, source, expectedCommit, nodeModules);
  lifecycleCommand(
    context,
    source,
    expectedCommit,
    context.tools.bun,
    ["run", "check"],
    join(runtime, "owner-gate"),
    nodeModules,
  );
  const builds = [];
  const versions = [];
  for (const target of CORE_RELEASE.targets) {
    for (const command of CORE_RELEASE.commands) {
      const extension = target.os === "windows" ? ".exe" : "";
      const output = join(
        runtime,
        "build",
        `${target.os}-${target.arch}`,
        `${command.name}${extension}`,
      );
      mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
      sourceFence(context, source, expectedCommit, nodeModules);
      checked(
        context.runner,
        context.tools.go,
        [
          "build",
          "-trimpath",
          "-buildvcs=false",
          "-ldflags",
          `-X github.com/tako0614/takoform/internal/buildinfo.Version=${CORE_RELEASE.version} -X github.com/tako0614/takoform/internal/buildinfo.Commit=${expectedCommit}`,
          "-o",
          output,
          command.package,
        ],
        {
          cwd: source,
          env: goEnvironment(context, join(runtime, "go", target.os, target.arch), target),
        },
      );
      sourceFence(context, source, expectedCommit, nodeModules);
      const binary = strictRegularFile(output, `${command.name} ${target.os}/${target.arch} binary`, 512 * 1024 * 1024);
      const metadata = lifecycleCommand(
        context,
        source,
        expectedCommit,
        context.tools.go,
        ["version", "-m", output],
        join(runtime, "inspect", target.os, target.arch),
        nodeModules,
      );
      builds.push({
        command: command.name,
        target: `${target.os}/${target.arch}`,
        bytes: binary.length,
        sha256: sha256(binary),
        goVersionMetadataSha256: sha256(Buffer.from(metadata)),
      });
      if (target.os === chosenHost.os && target.arch === chosenHost.arch) {
        accessSync(output, fsConstants.X_OK);
        sourceFence(context, source, expectedCommit, nodeModules);
        const versionRaw = checked(context.runner, output, ["version"], {
          cwd: source,
          env: minimalEnvironment(context.env, context.tools),
        });
        sourceFence(context, source, expectedCommit, nodeModules);
        versions.push(parseQualifiedVersion(versionRaw, command.name, expectedCommit));
      }
    }
  }
  if (versions.length !== CORE_RELEASE.commands.length) {
    throw new Error("prepare target matrix does not include the current host");
  }
  return {
    label,
    lifecycle: ["bun install --frozen-lockfile", "bun run check"],
    builds,
    versionOutputs: versions,
  };
}

function expectedCommandNames() {
  return CORE_RELEASE.commands.map(({ name }) => name);
}

function expectedTargets() {
  return CORE_RELEASE.targets.map(({ os, arch }) => `${os}/${arch}`);
}

export function normalizeQualificationReport(report, expectedCommit) {
  requireCommit(expectedCommit);
  const keys = [
    "format",
    "repository",
    "module",
    "version",
    "sourceCommit",
    "sourceTree",
    "commands",
    "targets",
    "tools",
    "runs",
    "reproducible",
  ];
  if (
    !exactKeys(report, keys) ||
    report.format !== "takoform.core-qualification@v2" ||
    report.repository !== CORE_RELEASE.repository ||
    report.module !== CORE_RELEASE.module ||
    report.version !== CORE_RELEASE.version ||
    report.sourceCommit !== expectedCommit ||
    !OBJECT.test(report.sourceTree ?? "") ||
    canonicalJSON(report.commands) !== canonicalJSON(expectedCommandNames()) ||
    canonicalJSON(report.targets) !== canonicalJSON(expectedTargets()) ||
    report.reproducible !== true ||
    !Array.isArray(report.runs) ||
    report.runs.length !== 2 ||
    report.runs[0]?.label !== "primary" ||
    report.runs[1]?.label !== "witness"
  ) {
    throw new Error("Core qualification report has an invalid closed identity");
  }
  const normalizeRun = (run) => {
    if (
      !exactKeys(run, ["label", "lifecycle", "builds", "versionOutputs"]) ||
      canonicalJSON(run.lifecycle) !==
        canonicalJSON(["bun install --frozen-lockfile", "bun run check"]) ||
      !Array.isArray(run.builds) ||
      run.builds.length !== CORE_RELEASE.targets.length * CORE_RELEASE.commands.length ||
      !Array.isArray(run.versionOutputs) ||
      run.versionOutputs.length !== CORE_RELEASE.commands.length
    ) {
      throw new Error("Core qualification run is not the exact lifecycle/build closure");
    }
    for (const build of run.builds) {
      if (
        !exactKeys(build, [
          "command",
          "target",
          "bytes",
          "sha256",
          "goVersionMetadataSha256",
        ]) ||
        !expectedCommandNames().includes(build.command) ||
        !expectedTargets().includes(build.target) ||
        !Number.isSafeInteger(build.bytes) ||
        build.bytes <= 0 ||
        !SHA256.test(build.sha256 ?? "") ||
        !SHA256.test(build.goVersionMetadataSha256 ?? "")
      ) {
        throw new Error("Core qualification build evidence is invalid");
      }
    }
    const identities = run.builds.map(({ command, target }) => `${target}:${command}`);
    if (new Set(identities).size !== identities.length) {
      throw new Error("Core qualification build evidence is duplicated");
    }
    for (const output of run.versionOutputs) {
      parseQualifiedVersion(canonicalJSON(output), output?.command, expectedCommit);
    }
    if (
      canonicalJSON(run.versionOutputs.map(({ command }) => command).sort()) !==
      canonicalJSON(expectedCommandNames().sort())
    ) {
      throw new Error("Core qualification is missing a command version output");
    }
    return run;
  };
  const primary = normalizeRun(report.runs[0]);
  const witness = normalizeRun(report.runs[1]);
  if (
    canonicalJSON({ ...primary, label: undefined }) !==
    canonicalJSON({ ...witness, label: undefined })
  ) {
    throw new Error("Core qualification double-build evidence is not reproducible");
  }
  if (!exactKeys(report.tools, ["node", "git", "bun", "go"])) {
    throw new Error("Core qualification tool evidence is not closed");
  }
  normalizeNodeRuntimeEvidence(report.tools.node, "qualification node");
  for (const name of ["git", "bun", "go"]) {
    normalizeToolEvidence(report.tools[name], `qualification ${name}`);
  }
  return structuredClone(report);
}

export function readQualificationArtifact(path, expectedCommit) {
  const artifact = parseCanonicalArtifact(path, "Core qualification report");
  normalizeQualificationReport(artifact.document, expectedCommit);
  return artifact;
}

export function prepareCoreRelease(
  input,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
    origin = CORE_RELEASE.origin,
    host = hostTarget(),
  } = {},
) {
  assertCoreReleasePhaseAuthority("prepare", env);
  requireCommit(input?.expectedCommit);
  requireAbsolutePath(input?.output, "prepare output");
  const context = buildContext("prepare", {
    repo,
    env,
    runner,
    tools,
    runtimePath,
    runtimeVersion,
    toolNames: ["git", "bun", "go"],
  });
  const state = phaseState("prepare");
  const sourceTree = phaseStep(state, "canonical-source-S", () =>
    assertCanonicalPrepareSource(context, input.expectedCommit, origin),
  );
  phaseStep(state, "pinned-go-toolchain", () =>
    withTemporaryDirectory("takoform-go-version-", (directory) => {
      const version = checked(
        context.runner,
        context.tools.go,
        ["env", "GOVERSION"],
        {
          cwd: context.repo,
          env: goEnvironment(context, directory),
        },
      );
      assertPinnedGoToolchainVersion(version);
    }),
  );
  const output = phaseStep(state, "qualification-output-fence", () =>
    prepareFileOutput(
      input.output,
      context.repo,
      "Core qualification output",
    ),
  );
  const report = withTemporaryDirectory("takoform-core-prepare-", (directory) => {
    const runs = [];
    for (const label of ["primary", "witness"]) {
      const source = join(directory, `source-${label}`);
      phaseStep(state, `clone-${label}-S`, () =>
        cloneExactSource(context, source, input.expectedCommit, origin),
      );
      runs.push(
        phaseStep(state, `qualify-${label}-S`, () =>
          qualifyClone(
            context,
            source,
            join(directory, `runtime-${label}`),
            input.expectedCommit,
            label,
            host,
          ),
        ),
      );
    }
    const candidate = {
      format: "takoform.core-qualification@v2",
      repository: CORE_RELEASE.repository,
      module: CORE_RELEASE.module,
      version: CORE_RELEASE.version,
      sourceCommit: input.expectedCommit,
      sourceTree,
      commands: expectedCommandNames(),
      targets: expectedTargets(),
      tools: context.toolEvidence,
      runs,
      reproducible: true,
    };
    phaseStep(state, "double-build-reproducibility", () =>
      normalizeQualificationReport(candidate, input.expectedCommit),
    );
    return candidate;
  });
  const written = phaseStep(state, "write-qualification-report", () =>
    writeCanonicalArtifact(
      output,
      report,
      context.repo,
      "Core qualification output",
    ),
  );
  state.stage = "complete";
  return {
    phase: "prepare",
    status: "qualified",
    sourceCommit: input.expectedCommit,
    qualification: output,
    qualificationDigest: written.digest,
    repositoryStateTouched: false,
    externalStateTouched: false,
  };
}

async function defaultGitHubRequest({ method, path, token, body, authenticated = true }) {
  if (typeof fetch !== "function") {
    throw new Error("Bun/Node built-in fetch is unavailable");
  }
  const response = await fetch(`https://api.github.com/${path}`, {
    method,
    redirect: "error",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": CORE_RELEASE.githubApiVersion,
      "User-Agent": "takoform-core-release",
      ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: canonicalJSON(body) }),
  });
  const raw = Buffer.from(await response.arrayBuffer());
  if (raw.length > MAX_HTTP_BYTES) {
    throw new Error(`GitHub API ${path} response exceeded the closed size limit`);
  }
  let document;
  if (raw.length > 0) {
    try {
      document = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      throw new Error(`GitHub API ${path} returned non-JSON: ${error.message}`);
    }
  }
  return { status: response.status, document, raw };
}

export function normalizeCoreTagRuleset(raw, expectedRulesetId) {
  requireRulesetID(expectedRulesetId ?? raw?.id);
  if (!Object.hasOwn(raw ?? {}, "bypass_actors")) {
    throw new Error(
      "GitHub ruleset response omitted bypass_actors; a mutation-capable repository credential is required to observe it",
    );
  }
  if (
    raw.id !== (expectedRulesetId ?? raw.id) ||
    raw.target !== "tag" ||
    raw.enforcement !== "active" ||
    canonicalJSON(raw.bypass_actors) !== canonicalJSON([]) ||
    !exactKeys(raw.conditions, ["ref_name"]) ||
    !exactKeys(raw.conditions.ref_name, ["include", "exclude"]) ||
    canonicalJSON(raw.conditions.ref_name.include) !==
      canonicalJSON([`refs/tags/${CORE_RELEASE.version}`]) ||
    canonicalJSON(raw.conditions.ref_name.exclude) !== canonicalJSON([]) ||
    !Array.isArray(raw.rules) ||
    raw.rules.length !== 2
  ) {
    throw new Error(
      "Core tag ruleset is not the exact active v0.1.0-only no-bypass policy",
    );
  }
  const byType = new Map();
  for (const rule of raw.rules) {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Array.isArray(rule) ||
      typeof rule.type !== "string" ||
      byType.has(rule.type)
    ) {
      throw new Error("Core tag ruleset contains an invalid or duplicate rule");
    }
    byType.set(rule.type, rule);
  }
  const deletion = byType.get("deletion");
  const update = byType.get("update");
  if (
    !deletion ||
    !update ||
    !exactKeys(deletion, ["type"]) ||
    !exactKeys(update, ["type", "parameters"]) ||
    canonicalJSON(update.parameters) !==
      canonicalJSON({ update_allows_fetch_and_merge: false })
  ) {
    throw new Error(
      "Core tag ruleset rules must be exactly deletion and update without fetch-and-merge",
    );
  }
  return {
    format: "takoform.core-ruleset-audit@v2",
    apiVersion: CORE_RELEASE.githubApiVersion,
    repository: CORE_RELEASE.githubRepository,
    tag: `refs/tags/${CORE_RELEASE.version}`,
    id: raw.id,
    target: "tag",
    enforcement: "active",
    bypassActors: [],
    conditions: {
      refName: {
        include: [`refs/tags/${CORE_RELEASE.version}`],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      {
        type: "update",
        parameters: { update_allows_fetch_and_merge: false },
      },
    ],
  };
}

export function normalizeStoredRulesetAudit(audit, expectedRulesetId) {
  const expected = {
    format: "takoform.core-ruleset-audit@v2",
    apiVersion: CORE_RELEASE.githubApiVersion,
    repository: CORE_RELEASE.githubRepository,
    tag: `refs/tags/${CORE_RELEASE.version}`,
    id: audit?.id,
    target: "tag",
    enforcement: "active",
    bypassActors: [],
    conditions: {
      refName: {
        include: [`refs/tags/${CORE_RELEASE.version}`],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      {
        type: "update",
        parameters: { update_allows_fetch_and_merge: false },
      },
    ],
  };
  if (
    !Number.isSafeInteger(audit?.id) ||
    audit.id <= 0 ||
    (expectedRulesetId !== undefined && audit.id !== expectedRulesetId) ||
    canonicalJSON(audit) !== canonicalJSON(expected)
  ) {
    throw new Error("stored Core ruleset audit is not the exact closed A artifact");
  }
  return structuredClone(expected);
}

export function readRulesetAuditArtifact(path, expectedRulesetId) {
  const artifact = parseCanonicalArtifact(path, "Core ruleset audit A");
  normalizeStoredRulesetAudit(artifact.document, expectedRulesetId);
  return artifact;
}

async function authenticatedRulesetAudit(request, token, rulesetId) {
  const response = await request({
    method: "GET",
    path: `repos/${CORE_RELEASE.githubRepository}/rulesets/${rulesetId}`,
    token,
    authenticated: true,
  });
  if (response.status !== 200) {
    throw new Error(`GitHub ruleset GET returned HTTP ${response.status}`);
  }
  return normalizeCoreTagRuleset(response.document, rulesetId);
}

export async function auditCoreRelease(
  input,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
    githubRequest = defaultGitHubRequest,
  } = {},
) {
  assertCoreReleasePhaseAuthority("audit", env);
  requireCommit(input?.expectedCommit);
  requireRulesetID(input?.rulesetId);
  requireAbsolutePath(input?.output, "ruleset audit output");
  const context = buildContext("audit", {
    repo,
    env,
    runner,
    tools,
    runtimePath,
    runtimeVersion,
    toolNames: ["git"],
    credentialedCommit: input.expectedCommit,
  });
  const state = phaseState("audit");
  phaseStep(state, "detached-source-S", () =>
    assertDetachedSource(context, input.expectedCommit),
  );
  phaseStep(state, "ruleset-audit-output-fence", () =>
    prepareFileOutput(input.output, context.repo, "Core ruleset audit output"),
  );
  state.stage = "authenticated-ruleset-GET";
  let audit;
  try {
    audit = await authenticatedRulesetAudit(
      githubRequest,
      env.GH_TOKEN,
      input.rulesetId,
    );
  } catch (error) {
    throw new ReleaseFailure(
      `authenticated-ruleset-GET failed: ${error.message}`,
      state,
      error,
    );
  }
  const written = phaseStep(state, "write-ruleset-audit-A", () =>
    writeCanonicalArtifact(
      input.output,
      audit,
      context.repo,
      "Core ruleset audit output",
    ),
  );
  state.stage = "complete";
  return {
    phase: "audit",
    status: "audited",
    sourceCommit: input.expectedCommit,
    rulesetAudit: input.output,
    rulesetAuditDigest: written.digest,
    toolEvidence: context.toolEvidence,
    repositoryStateTouched: false,
    externalStateTouched: false,
  };
}

export function normalizeIndependentReview(
  review,
  { expectedCommit, qualificationDigest, rulesetAuditDigest },
) {
  const keys = [
    "format",
    "approved",
    "sourceCommit",
    "qualificationDigest",
    "rulesetAuditDigest",
    "reviewer",
    "reviewedAt",
    "reviewed",
  ];
  const parsedDate = new Date(review?.reviewedAt ?? "");
  if (
    !exactKeys(review, keys) ||
    review.format !== CORE_RELEASE_REVIEW.format ||
    review.approved !== true ||
    review.sourceCommit !== expectedCommit ||
    review.qualificationDigest !== qualificationDigest ||
    review.rulesetAuditDigest !== rulesetAuditDigest ||
    typeof review.reviewer !== "string" ||
    review.reviewer.trim() === "" ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString() !== review.reviewedAt ||
    canonicalJSON(review.reviewed) !== canonicalJSON(CORE_RELEASE_REVIEW.reviewed)
  ) {
    throw new Error("Core independent review is not the exact approved v2 record");
  }
  return structuredClone(review);
}

function readIndependentReview(path, bindings) {
  const artifact = parseCanonicalArtifact(path, "Core independent review");
  normalizeIndependentReview(artifact.document, bindings);
  return artifact;
}

export function createCoreTagAnnotation({
  expectedCommit,
  qualificationDigest,
  reviewDigest,
  rulesetAuditDigest,
  rulesetAudit,
}) {
  requireCommit(expectedCommit);
  requireDigest(qualificationDigest, "qualification digest");
  requireDigest(reviewDigest, "independent review digest");
  requireDigest(rulesetAuditDigest, "ruleset audit digest");
  const audit = normalizeStoredRulesetAudit(rulesetAudit);
  if (sha256(Buffer.from(canonicalJSON(audit))) !== rulesetAuditDigest) {
    throw new Error("tag annotation ruleset A bytes differ from its digest");
  }
  return {
    format: "takoform.core-tag-annotation@v2",
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sourceCommit: expectedCommit,
    qualificationDigest,
    independentReviewDigest: reviewDigest,
    rulesetAuditDigest,
    rulesetAudit: audit,
  };
}

export function coreTagMessage(annotation) {
  return `${CORE_RELEASE.title}\n\n${canonicalJSON(annotation)}`;
}

function parseTagObject(raw, expectedCommit) {
  requireCommit(expectedCommit);
  const text = Buffer.from(raw).toString("utf8");
  const split = text.indexOf("\n\n");
  if (split < 0) throw new Error("signed Core tag object has no message boundary");
  const headers = text.slice(0, split).split("\n");
  const body = text.slice(split + 2);
  const signatureMarker = "-----BEGIN SSH SIGNATURE-----\n";
  const signatureOffset = body.indexOf(signatureMarker);
  if (
    headers.length !== 4 ||
    headers[0] !== `object ${expectedCommit}` ||
    headers[1] !== "type commit" ||
    headers[2] !== `tag ${CORE_RELEASE.version}` ||
    !/^tagger .+ <[^<>\n]+> [1-9][0-9]* [+-][0-9]{4}$/u.test(headers[3]) ||
    signatureOffset < 0
  ) {
    throw new Error("signed Core tag headers or SSH signature boundary differ");
  }
  const message = body.slice(0, signatureOffset);
  const signature = body.slice(signatureOffset);
  if (
    !/^-----BEGIN SSH SIGNATURE-----\n(?:[A-Za-z0-9+/]+={0,2}\n)+-----END SSH SIGNATURE-----\n$/u.test(
      signature,
    )
  ) {
    throw new Error("signed Core tag has a malformed SSH signature block");
  }
  if (!message.startsWith(`${CORE_RELEASE.title}\n\n`)) {
    throw new Error("signed Core tag title differs");
  }
  const annotationRaw = Buffer.from(
    message.slice(`${CORE_RELEASE.title}\n\n`.length),
  );
  let annotation;
  try {
    annotation = JSON.parse(annotationRaw.toString("utf8"));
  } catch (error) {
    throw new Error(`signed Core tag annotation is not JSON: ${error.message}`);
  }
  if (!Buffer.from(canonicalJSON(annotation)).equals(annotationRaw)) {
    throw new Error("signed Core tag annotation is not exact canonical JSON");
  }
  return { annotation, tagger: headers[3] };
}

function normalizeTagAnnotation(annotation, expectedCommit) {
  const keys = [
    "format",
    "module",
    "version",
    "sourceCommit",
    "qualificationDigest",
    "independentReviewDigest",
    "rulesetAuditDigest",
    "rulesetAudit",
  ];
  if (
    !exactKeys(annotation, keys) ||
    annotation.format !== "takoform.core-tag-annotation@v2" ||
    annotation.module !== CORE_RELEASE.module ||
    annotation.version !== CORE_RELEASE.version ||
    annotation.sourceCommit !== expectedCommit
  ) {
    throw new Error("signed Core tag annotation has an invalid closed identity");
  }
  requireDigest(annotation.qualificationDigest, "tag qualification digest");
  requireDigest(annotation.independentReviewDigest, "tag review digest");
  requireDigest(annotation.rulesetAuditDigest, "tag ruleset audit digest");
  normalizeStoredRulesetAudit(annotation.rulesetAudit);
  if (
    sha256(Buffer.from(canonicalJSON(annotation.rulesetAudit))) !==
    annotation.rulesetAuditDigest
  ) {
    throw new Error("signed Core tag does not bind the full canonical ruleset A");
  }
  return structuredClone(annotation);
}

function validatePrivateTagKey(context, privateKey, authority) {
  requireAbsolutePath(privateKey, "TAKOFORM_CORE_TAG_SIGNING_KEY");
  assertPrivateParent(privateKey, "Core tag SSH private key");
  const status = lstatSync(privateKey);
  const resolved = realpathSync(privateKey);
  const owner = typeof process.geteuid === "function" ? process.geteuid() : status.uid;
  if (
    status.isSymbolicLink() ||
    resolved !== resolve(privateKey) ||
    !status.isFile() ||
    status.nlink !== 1 ||
    ![0, owner].includes(status.uid) ||
    (status.mode & 0o077) !== 0
  ) {
    throw new Error(
      "Core tag SSH private key must be one root/current-user-owned mode-0600-style regular file",
    );
  }
  accessSync(resolved, fsConstants.R_OK);
  assertOutsideRepository(resolved, context.repo, "Core tag SSH private key");
  const raw = strictRegularFile(
    resolved,
    "Core tag SSH private key",
    1024 * 1024,
  );
  const derived = checked(
    context.runner,
    context.tools.sshKeygen,
    ["-y", "-f", resolved],
    {
      cwd: context.repo,
      env: minimalEnvironment(context.env, context.tools),
    },
  ).trim();
  const match = /^(ssh-ed25519) ([A-Za-z0-9+/]+={0,3})(?: .*)?$/u.exec(derived);
  if (
    !match ||
    match[1] !== authority.identity.keyType ||
    match[2] !== authority.identity.publicKey
  ) {
    throw new Error("Core tag SSH private key does not match pinned authority");
  }
  const fingerprint = checked(
    context.runner,
    context.tools.sshKeygen,
    ["-E", "sha256", "-lf", "-"],
    {
      cwd: context.repo,
      env: minimalEnvironment(context.env, context.tools),
      input: `${match[1]} ${match[2]}\n`,
    },
  );
  if (!fingerprint.split(/\s+/u).includes(authority.identity.fingerprint)) {
    throw new Error("Core tag SSH private key fingerprint differs from pin");
  }
  return {
    path: resolved,
    digest: sha256(raw),
    raw,
    identity: statusIdentity(lstatSync(resolved)),
  };
}

function revalidatePrivateTagKey(key) {
  assertPrivateParent(key.path, "Core tag SSH private key");
  const status = lstatSync(key.path);
  const raw = strictRegularFile(key.path, "Core tag SSH private key", 1024 * 1024);
  if (
    (status.mode & 0o077) !== 0 ||
    !sameStatusIdentity(status, key.identity) ||
    sha256(raw) !== key.digest ||
    !raw.equals(key.raw)
  ) {
    throw new Error("Core tag SSH private key changed or was replaced after validation");
  }
  return key;
}

function signTagObject(
  context,
  expectedCommit,
  message,
  privateKey,
  beforeSigning,
) {
  return withTemporaryDirectory("takoform-core-sign-tag-", (directory) => {
    const bare = join(directory, "tag.git");
    gitChecked(context, ["init", "--bare", bare], { cwd: directory });
    const local = { ...context, repo: bare };
    gitChecked(
      local,
      [
        "-c",
        "protocol.file.allow=always",
        "fetch",
        "--no-tags",
        context.repo,
        expectedCommit,
      ],
      { cwd: bare },
    );
    gitChecked(
      local,
      [
        ...coreTagSigningGitConfig(privateKey, context.tools.sshKeygen),
        "tag",
        "--sign",
        "--annotate",
        "--cleanup=verbatim",
        "--message",
        message,
        CORE_RELEASE.version,
        expectedCommit,
      ],
      { beforeRun: beforeSigning },
    );
    const object = gitChecked(local, [
      "rev-parse",
      `refs/tags/${CORE_RELEASE.version}`,
    ]).trim();
    requireObject(object, "signed tag object");
    const raw = Buffer.from(gitChecked(local, ["cat-file", "-p", object]));
    if (gitObjectID("tag", raw, object.length) !== object) {
      throw new Error("signed tag raw bytes do not hash to the Git object id");
    }
    return { object, raw };
  });
}

function verifyTagObjectSignature(context, raw, expectedObject, expectedCommit) {
  const authority = readTagAuthority(context.repo, expectedCommit);
  return withTemporaryDirectory("takoform-core-verify-tag-", (directory) => {
    const allowedSigners = materializeTagAuthority(directory, authority);
    const bare = join(directory, "verify.git");
    gitChecked(context, ["init", "--bare", bare], { cwd: directory });
    const local = { ...context, repo: bare };
    gitChecked(
      local,
      [
        "-c",
        "protocol.file.allow=always",
        "fetch",
        "--no-tags",
        context.repo,
        expectedCommit,
      ],
      { cwd: bare },
    );
    const written = gitChecked(local, ["hash-object", "-t", "tag", "-w", "--stdin"], {
      input: raw,
    }).trim();
    if (written !== expectedObject) {
      throw new Error("tag bundle bytes differ from the declared Git object");
    }
    gitChecked(local, [
      ...coreTagVerificationGitConfig(allowedSigners, context.tools.sshKeygen),
      "verify-tag",
      expectedObject,
    ]);
  });
}

export function normalizeTagBundleDocument(bundle, expectedCommit) {
  const keys = [
    "format",
    "repository",
    "module",
    "version",
    "sourceCommit",
    "tag",
    "tagObject",
    "tagObjectSha256",
    "tagObjectBase64",
    "annotation",
    "qualificationDigest",
    "independentReviewDigest",
    "rulesetAuditDigest",
    "tools",
  ];
  if (
    !exactKeys(bundle, keys) ||
    bundle.format !== "takoform.core-tag-bundle@v2" ||
    bundle.repository !== CORE_RELEASE.repository ||
    bundle.module !== CORE_RELEASE.module ||
    bundle.version !== CORE_RELEASE.version ||
    bundle.sourceCommit !== expectedCommit ||
    bundle.tag !== CORE_RELEASE.version ||
    !OBJECT.test(bundle.tagObject ?? "") ||
    !SHA256.test(bundle.tagObjectSha256 ?? "") ||
    typeof bundle.tagObjectBase64 !== "string" ||
    !exactKeys(bundle.tools, ["node", "git", "sshKeygen"])
  ) {
    throw new Error("Core tag bundle has an invalid closed identity");
  }
  normalizeNodeRuntimeEvidence(bundle.tools.node, "tag-bundle node");
  for (const name of ["git", "sshKeygen"]) {
    normalizeToolEvidence(bundle.tools[name], `tag-bundle ${name}`);
  }
  const raw = Buffer.from(bundle.tagObjectBase64, "base64");
  if (
    raw.length === 0 ||
    raw.toString("base64") !== bundle.tagObjectBase64 ||
    sha256(raw) !== bundle.tagObjectSha256 ||
    gitObjectID("tag", raw, bundle.tagObject.length) !== bundle.tagObject
  ) {
    throw new Error("Core tag bundle object bytes or digests differ");
  }
  const parsed = parseTagObject(raw, expectedCommit);
  const annotation = normalizeTagAnnotation(parsed.annotation, expectedCommit);
  if (
    canonicalJSON(annotation) !== canonicalJSON(bundle.annotation) ||
    annotation.qualificationDigest !== bundle.qualificationDigest ||
    annotation.independentReviewDigest !== bundle.independentReviewDigest ||
    annotation.rulesetAuditDigest !== bundle.rulesetAuditDigest ||
    coreTagMessage(annotation) !==
      `${CORE_RELEASE.title}\n\n${canonicalJSON(annotation)}`
  ) {
    throw new Error("Core tag bundle descriptor differs from its signed annotation");
  }
  return { document: structuredClone(bundle), raw, annotation };
}

export function readTagBundleArtifact(path, expectedCommit, context) {
  const artifact = parseCanonicalArtifact(path, "Core signed tag bundle");
  const normalized = normalizeTagBundleDocument(artifact.document, expectedCommit);
  if (context !== undefined) {
    verifyTagObjectSignature(
      context,
      normalized.raw,
      normalized.document.tagObject,
      expectedCommit,
    );
  }
  return {
    ...artifact,
    document: normalized.document,
    tagObjectRaw: normalized.raw,
    annotation: normalized.annotation,
  };
}

export function signCoreReleaseTag(
  input,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
  } = {},
) {
  assertCoreReleasePhaseAuthority("sign-tag", env);
  requireCommit(input?.expectedCommit);
  for (const [name, path] of [
    ["qualification", input?.qualification],
    ["ruleset audit", input?.rulesetAudit],
    ["review record", input?.reviewRecord],
    ["tag bundle output", input?.output],
  ]) {
    requireAbsolutePath(path, name);
  }
  const context = buildContext("sign-tag", {
    repo,
    env,
    runner,
    tools,
    runtimePath,
    runtimeVersion,
    toolNames: ["git", "sshKeygen"],
    credentialedCommit: input.expectedCommit,
  });
  const state = phaseState("sign-tag");
  phaseStep(state, "detached-source-S", () =>
    assertDetachedSource(context, input.expectedCommit),
  );
  phaseStep(state, "private-input-boundary", () => {
    for (const [label, path] of [
      ["Core qualification report", input.qualification],
      ["Core ruleset audit A", input.rulesetAudit],
      ["Core independent review", input.reviewRecord],
    ]) {
      assertPrivateInputOutsideRepository(path, context.repo, label);
    }
  });
  const qualification = phaseStep(state, "qualification-report", () =>
    readQualificationArtifact(input.qualification, input.expectedCommit),
  );
  const audit = phaseStep(state, "ruleset-audit-A", () =>
    readRulesetAuditArtifact(input.rulesetAudit),
  );
  const review = phaseStep(state, "independent-review", () =>
    readIndependentReview(input.reviewRecord, {
      expectedCommit: input.expectedCommit,
      qualificationDigest: qualification.digest,
      rulesetAuditDigest: audit.digest,
    }),
  );
  phaseStep(state, "tag-bundle-output-fence", () =>
    prepareFileOutput(input.output, context.repo, "Core tag bundle output"),
  );
  const authority = phaseStep(state, "tag-signing-authority", () =>
    readTagAuthority(context.repo, input.expectedCommit),
  );
  const privateKey = phaseStep(state, "tag-signing-key", () =>
    validatePrivateTagKey(
      context,
      env.TAKOFORM_CORE_TAG_SIGNING_KEY,
      authority,
    ),
  );
  const annotation = phaseStep(state, "tag-annotation", () =>
    createCoreTagAnnotation({
      expectedCommit: input.expectedCommit,
      qualificationDigest: qualification.digest,
      reviewDigest: review.digest,
      rulesetAuditDigest: audit.digest,
      rulesetAudit: audit.document,
    }),
  );
  const signed = phaseStep(state, "ssh-signed-annotated-tag", () =>
    {
      const revalidateSigningInputs = () => {
        for (const [artifact, label] of [
          [qualification, "Core qualification report"],
          [audit, "Core ruleset audit A"],
          [review, "Core independent review"],
        ]) {
          revalidateCanonicalArtifact(artifact, label);
        }
        revalidatePrivateTagKey(privateKey);
      };
      return signTagObject(
        context,
        input.expectedCommit,
        coreTagMessage(annotation),
        privateKey.path,
        revalidateSigningInputs,
      );
    },
  );
  phaseStep(state, "verify-signed-tag", () =>
    verifyTagObjectSignature(
      context,
      signed.raw,
      signed.object,
      input.expectedCommit,
    ),
  );
  const bundle = {
    format: "takoform.core-tag-bundle@v2",
    repository: CORE_RELEASE.repository,
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sourceCommit: input.expectedCommit,
    tag: CORE_RELEASE.version,
    tagObject: signed.object,
    tagObjectSha256: sha256(signed.raw),
    tagObjectBase64: signed.raw.toString("base64"),
    annotation,
    qualificationDigest: qualification.digest,
    independentReviewDigest: review.digest,
    rulesetAuditDigest: audit.digest,
    tools: context.toolEvidence,
  };
  phaseStep(state, "tag-bundle-closure", () =>
    normalizeTagBundleDocument(bundle, input.expectedCommit),
  );
  const written = phaseStep(state, "write-tag-bundle", () =>
    writeCanonicalArtifact(
      input.output,
      bundle,
      context.repo,
      "Core tag bundle output",
    ),
  );
  state.stage = "complete";
  return {
    phase: "sign-tag",
    status: "signed",
    sourceCommit: input.expectedCommit,
    tagObject: signed.object,
    tagBundle: input.output,
    tagBundleDigest: written.digest,
    repositoryStateTouched: false,
    externalStateTouched: false,
  };
}

function tokenGitArgs(token) {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return [
    "-c",
    `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`,
  ];
}

function assertCanonicalMainDescendant(context, expectedCommit) {
  return withTemporaryDirectory("takoform-core-main-read-", (directory) => {
    const bare = join(directory, "main.git");
    gitChecked(context, ["init", "--bare", bare], { cwd: directory });
    const local = { ...context, repo: bare };
    gitChecked(
      local,
      [
        "fetch",
        "--no-tags",
        CORE_RELEASE.origin,
        `+${CORE_RELEASE.ref}:refs/core/main`,
      ],
      {
        env: gitEnvironment(context.env, context.tools, { network: true }),
      },
    );
    const main = gitChecked(local, ["rev-parse", "refs/core/main"]).trim();
    requireCommit(main, "canonical main");
    const history = gitChecked(local, ["rev-list", "--first-parent", main])
      .trim()
      .split("\n");
    if (!history.includes(expectedCommit)) {
      throw new Error("canonical main is not source S or its first-parent descendant");
    }
    assertTagAuthorityLineage(bare, expectedCommit, main);
    return main;
  });
}

function parseRemoteTagRefs(raw) {
  if (String(raw).trim() === "") return { status: "absent" };
  const refs = new Map();
  for (const line of String(raw).trim().split("\n")) {
    const match = /^([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(line);
    if (!match || refs.has(match[2])) {
      throw new Error("remote Core tag readback is ambiguous");
    }
    refs.set(match[2], match[1]);
  }
  const tagRef = `refs/tags/${CORE_RELEASE.version}`;
  const object = refs.get(tagRef);
  const commit = refs.get(`${tagRef}^{}`);
  if (!object || !commit || refs.size !== 2) {
    throw new Error("remote Core tag is not one annotated tag plus peel");
  }
  return { status: "exact", object, commit };
}

function inspectRemoteTag(
  context,
  token,
  bundle,
  expectedCommit,
  authorityRepository = context.repo,
) {
  const authority = readTagAuthority(authorityRepository, expectedCommit);
  const tagRef = `refs/tags/${CORE_RELEASE.version}`;
  const raw = gitChecked(
    context,
    [
      ...tokenGitArgs(token),
      "ls-remote",
      "--tags",
      CORE_RELEASE.origin,
      tagRef,
      `${tagRef}^{}`,
    ],
    {
      cwd: "/",
      env: gitEnvironment(context.env, context.tools, { network: true }),
    },
  );
  const parsed = parseRemoteTagRefs(raw);
  if (parsed.status === "absent") return parsed;
  if (parsed.object !== bundle.tagObject || parsed.commit !== expectedCommit) {
    throw new Error("remote Core tag conflicts with the exact signed tag bundle");
  }
  return withTemporaryDirectory("takoform-core-remote-tag-", (directory) => {
    const allowedSigners = materializeTagAuthority(directory, authority);
    const bare = join(directory, "remote.git");
    gitChecked(context, ["init", "--bare", bare], { cwd: directory });
    const local = { ...context, repo: bare };
    gitChecked(
      local,
      [
        ...tokenGitArgs(token),
        "fetch",
        "--no-tags",
        CORE_RELEASE.origin,
        `${tagRef}:refs/core/tag`,
      ],
      { env: gitEnvironment(context.env, context.tools, { network: true }) },
    );
    const fetchedObject = gitChecked(local, ["rev-parse", "refs/core/tag"]).trim();
    const fetchedRaw = Buffer.from(gitChecked(local, ["cat-file", "-p", fetchedObject]));
    if (
      fetchedObject !== bundle.tagObject ||
      !fetchedRaw.equals(Buffer.from(bundle.tagObjectBase64, "base64"))
    ) {
      throw new Error("fresh remote tag bytes differ from signed bundle");
    }
    gitChecked(local, [
      ...coreTagVerificationGitConfig(allowedSigners, context.tools.sshKeygen),
      "verify-tag",
      fetchedObject,
    ]);
    parseTagObject(fetchedRaw, expectedCommit);
    return parsed;
  });
}

function installExactTagObject(context, bundle) {
  const raw = Buffer.from(bundle.tagObjectBase64, "base64");
  const object = gitChecked(context, ["hash-object", "-t", "tag", "-w", "--stdin"], {
    input: raw,
  }).trim();
  if (object !== bundle.tagObject) {
    throw new Error("installed tag object differs from signed bundle");
  }
}

export function coreTagCreateOnlyPushSpec(tagObject) {
  requireObject(tagObject, "create-only tag object");
  return {
    lease: `--force-with-lease=refs/tags/${CORE_RELEASE.version}:${"0".repeat(tagObject.length)}`,
    refspec: `${tagObject}:refs/tags/${CORE_RELEASE.version}`,
  };
}

function pushExactTagObject(context, token, bundle, beforeMutation) {
  const push = coreTagCreateOnlyPushSpec(bundle.tagObject);
  return gitResult(
    context,
    [
      ...tokenGitArgs(token),
      "push",
      "--porcelain",
      "--no-verify",
      push.lease,
      CORE_RELEASE.origin,
      push.refspec,
    ],
    { network: true, beforeRun: beforeMutation },
  );
}

export function releaseBody(expectedCommit, tagObject, rulesetAuditDigest) {
  requireCommit(expectedCommit);
  requireObject(tagObject, "release tag object");
  requireDigest(rulesetAuditDigest, "release ruleset audit digest");
  return [
    `Source commit: ${expectedCommit}`,
    `Signed annotated tag object: ${tagObject}`,
    `Publication-time ruleset evidence: ${rulesetAuditDigest}`,
    "The signed tag contains the full canonical publication-time ruleset audit A and attests that evidence.",
    "This public record does not claim that GitHub's hidden bypass state remains unchanged after publication.",
    `Distribution authority: ${CORE_RELEASE.module}@${CORE_RELEASE.version} through the Go proxy and checksum database.`,
    "GitHub Release assets: none.",
    "Published identities are append-only and repaired only under a later version.",
  ].join("\n");
}

function releaseRequest(expectedCommit, bundle) {
  return {
    tag_name: CORE_RELEASE.version,
    target_commitish: expectedCommit,
    name: CORE_RELEASE.title,
    body: releaseBody(
      expectedCommit,
      bundle.tagObject,
      bundle.rulesetAuditDigest,
    ),
    draft: false,
    prerelease: false,
  };
}

export function verifyReleaseIdentity(release, expectedCommit, bundle) {
  requireCommit(expectedCommit);
  const expectedURL = `${CORE_RELEASE.repository}/releases/tag/${CORE_RELEASE.version}`;
  if (
    !Number.isSafeInteger(release?.id) ||
    release.id <= 0 ||
    release.tag_name !== CORE_RELEASE.version ||
    release.target_commitish !== expectedCommit ||
    release.name !== CORE_RELEASE.title ||
    release.body !==
      releaseBody(expectedCommit, bundle.tagObject, bundle.rulesetAuditDigest) ||
    release.draft !== false ||
    release.prerelease !== false ||
    release.immutable !== true ||
    canonicalJSON(release.assets) !== canonicalJSON([]) ||
    release.html_url !== expectedURL
  ) {
    throw new Error("GitHub Core Release identity differs from the exact immutable asset-free release");
  }
  return release;
}

async function inspectReleaseState(request, token, expectedCommit, bundle, authenticated) {
  const response = await request({
    method: "GET",
    path: `repos/${CORE_RELEASE.githubRepository}/releases/tags/${CORE_RELEASE.version}`,
    token,
    authenticated,
  });
  if (response.status === 404) return { status: "absent" };
  if (response.status !== 200) {
    throw new Error(`GitHub Release GET returned HTTP ${response.status}`);
  }
  return {
    status: "exact",
    release: verifyReleaseIdentity(response.document, expectedCommit, bundle),
  };
}

export async function assertImmutableReleaseRepository(request, token) {
  const response = await request({
    method: "GET",
    path: `repos/${CORE_RELEASE.githubRepository}/immutable-releases`,
    token,
    authenticated: true,
  });
  if (
    response.status !== 200 ||
    !exactKeys(response.document, ["enabled", "enforced_by_owner"]) ||
    response.document.enabled !== true ||
    typeof response.document.enforced_by_owner !== "boolean"
  ) {
    throw new Error("GitHub repository does not report immutable Releases enabled");
  }
}

function assertFreshAuditEquals(stored, fresh) {
  if (canonicalJSON(fresh) !== canonicalJSON(stored)) {
    throw new Error("fresh authenticated ruleset GET is not byte-equal to signed audit A");
  }
}

async function createRelease(request, token, expectedCommit, bundle) {
  const response = await request({
    method: "POST",
    path: `repos/${CORE_RELEASE.githubRepository}/releases`,
    token,
    authenticated: true,
    body: releaseRequest(expectedCommit, bundle),
  });
  if (response.status !== 201) {
    throw new Error(`GitHub Release creation returned HTTP ${response.status}`);
  }
  return verifyReleaseIdentity(response.document, expectedCommit, bundle);
}

export async function publishForwardOnly(
  { mode, expectedCommit, bundle, storedAudit },
  operations,
) {
  if (!["forward", "recover"].includes(mode)) {
    throw new Error("publish mode must be forward or recover");
  }
  const state = phaseState("publish");
  const step = async (stage, callback) => {
    state.stage = stage;
    try {
      return await callback();
    } catch (error) {
      if (error instanceof ReleaseFailure) throw error;
      throw new ReleaseFailure(`${stage} failed: ${error.message}`, state, error);
    }
  };
  await step("canonical-main-descendant", () =>
    operations.assertCanonicalMain(expectedCommit),
  );
  await step("immutable-release-setting", () => operations.assertImmutableReleases());
  let tag = await step("initial-tag-state", () => operations.inspectTag());
  let release = await step("initial-release-state", () => operations.inspectRelease());
  if (mode === "forward" && (tag.status !== "absent" || release.status !== "absent")) {
    throw new ReleaseFailure(
      "forward publication found existing state; rerun the same state machine in recover mode",
      { ...state, stage: "forward-state-must-be-empty" },
    );
  }
  if (tag.status === "absent" && release.status !== "absent") {
    throw new ReleaseFailure(
      "a GitHub Release exists without the exact protected signed tag; refusing recreation",
      { ...state, stage: "invalid-partial-state" },
    );
  }
  if (tag.status === "absent") {
    await step("install-exact-tag-object", () => operations.installTagObject());
    state.repositoryStateTouched = true;
    const fresh = await step("final-A-before-tag", () => operations.auditRuleset());
    phaseStep(state, "final-A-before-tag-equality", () =>
      assertFreshAuditEquals(storedAudit, fresh),
    );
    state.externalStateIndeterminate = true;
    const push = await operations.pushTag();
    if (!push || push.status !== 0) {
      try {
        tag = await operations.inspectTag();
      } catch (readError) {
        throw new ReleaseFailure(
          `tag create-only push was indeterminate and authoritative readback failed: ${readError.message}`,
          { ...state, stage: "tag-push-readback" },
          readError,
        );
      }
      if (tag.status !== "exact") {
        state.externalStateIndeterminate = false;
        throw new ReleaseFailure(
          `tag create-only push failed and the exact tag is absent: ${`${push?.stderr ?? push?.stdout ?? ""}`.trim().slice(-8_192)}`,
          { ...state, stage: "tag-create-only-push" },
        );
      }
    }
    state.externalStateTouched = true;
    state.externalStateIndeterminate = false;
    tag = await step("fresh-tag-after-push", () => operations.inspectTag());
  }
  if (tag.status !== "exact") {
    throw new ReleaseFailure("remote tag state is not exact", {
      ...state,
      stage: "exact-remote-tag",
    });
  }
  release = await step("release-state-after-tag", () => operations.inspectRelease());
  if (release.status === "absent") {
    await step("fresh-signed-tag-before-release", () => operations.inspectTag());
    await step("authenticated-release-absence", async () => {
      const current = await operations.inspectRelease();
      if (current.status !== "absent") {
        throw new Error("Release appeared before create-only POST");
      }
    });
    const fresh = await step("final-A-before-release", () => operations.auditRuleset());
    phaseStep(state, "final-A-before-release-equality", () =>
      assertFreshAuditEquals(storedAudit, fresh),
    );
    state.externalStateIndeterminate = true;
    try {
      release = {
        status: "exact",
        release: await operations.createRelease(),
      };
      state.externalStateTouched = true;
      state.externalStateIndeterminate = false;
    } catch (postError) {
      try {
        release = await operations.readPublicRelease();
      } catch (readError) {
        throw new ReleaseFailure(
          `Release POST was indeterminate and public readback failed: ${postError.message}; ${readError.message}`,
          { ...state, stage: "release-post-readback" },
          readError,
        );
      }
      if (release.status !== "exact") {
        state.externalStateIndeterminate = false;
        throw new ReleaseFailure(
          `Release POST did not create the exact public identity: ${postError.message}`,
          { ...state, stage: "release-create-only-post" },
          postError,
        );
      }
      state.externalStateTouched = true;
      state.externalStateIndeterminate = false;
    }
  }
  const publicRelease = await step("fresh-public-release", () =>
    operations.readPublicRelease(),
  );
  if (publicRelease.status !== "exact") {
    throw new ReleaseFailure("fresh public Release identity is absent", {
      ...state,
      stage: "fresh-public-release",
    });
  }
  state.stage = "complete";
  return {
    phase: "publish",
    mode,
    status: "published",
    sourceCommit: expectedCommit,
    tagObject: bundle.tagObject,
    releaseId: publicRelease.release.id,
    publicationTimeRulesetAuditDigest: bundle.rulesetAuditDigest,
    currentBypassStateClaimed: false,
    repositoryStateTouched: state.repositoryStateTouched,
    externalStateTouched: state.externalStateTouched,
  };
}

export async function publishCoreRelease(
  input,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
    githubRequest = defaultGitHubRequest,
    operations,
  } = {},
) {
  assertCoreReleasePhaseAuthority("publish", env);
  requireCommit(input?.expectedCommit);
  for (const [name, path] of [
    ["qualification", input?.qualification],
    ["ruleset audit", input?.rulesetAudit],
    ["review record", input?.reviewRecord],
    ["tag bundle", input?.tagBundle],
  ]) {
    requireAbsolutePath(path, name);
  }
  if (!["forward", "recover"].includes(input?.mode)) {
    throw new Error("publish mode must be forward or recover");
  }
  const context = buildContext("publish", {
    repo,
    env,
    runner,
    tools,
    runtimePath,
    runtimeVersion,
    toolNames: ["git", "sshKeygen"],
    credentialedCommit: input.expectedCommit,
  });
  const state = phaseState("publish");
  phaseStep(state, "detached-source-S", () =>
    assertDetachedSource(context, input.expectedCommit),
  );
  phaseStep(state, "private-input-boundary", () => {
    for (const [label, path] of [
      ["Core qualification report", input.qualification],
      ["Core ruleset audit A", input.rulesetAudit],
      ["Core independent review", input.reviewRecord],
      ["Core signed tag bundle", input.tagBundle],
    ]) {
      assertPrivateInputOutsideRepository(path, context.repo, label);
    }
  });
  const qualification = phaseStep(state, "qualification-report", () =>
    readQualificationArtifact(input.qualification, input.expectedCommit),
  );
  const audit = phaseStep(state, "ruleset-audit-A", () =>
    readRulesetAuditArtifact(input.rulesetAudit),
  );
  const review = phaseStep(state, "independent-review", () =>
    readIndependentReview(input.reviewRecord, {
      expectedCommit: input.expectedCommit,
      qualificationDigest: qualification.digest,
      rulesetAuditDigest: audit.digest,
    }),
  );
  const tag = phaseStep(state, "signed-tag-bundle", () =>
    readTagBundleArtifact(input.tagBundle, input.expectedCommit, context),
  );
  if (
    tag.document.qualificationDigest !== qualification.digest ||
    tag.document.independentReviewDigest !== review.digest ||
    tag.document.rulesetAuditDigest !== audit.digest ||
    canonicalJSON(tag.annotation.rulesetAudit) !== canonicalJSON(audit.document)
  ) {
    throw new ReleaseFailure(
      "signed tag bundle does not bind the supplied qualification, review, and audit A",
      { ...state, stage: "artifact-binding" },
    );
  }
  const token = env.GH_TOKEN;
  let publicationDirectory;
  let publicationContext = context;
  try {
    if (operations === undefined) {
      publicationDirectory = mkdtempSync(join(tmpdir(), "takoform-core-publish-"));
      const publicationRepository = join(publicationDirectory, "publish.git");
      gitChecked(context, ["init", "--bare", publicationRepository], {
        cwd: publicationDirectory,
      });
      publicationContext = { ...context, repo: publicationRepository };
    }
    const baseOperations =
      operations ??
      {
        assertCanonicalMain: (expectedCommit) =>
          assertCanonicalMainDescendant(context, expectedCommit),
        assertImmutableReleases: () =>
          assertImmutableReleaseRepository(githubRequest, token),
        inspectTag: () =>
          inspectRemoteTag(
            publicationContext,
            token,
            tag.document,
            input.expectedCommit,
            context.repo,
          ),
        inspectRelease: () =>
          inspectReleaseState(
            githubRequest,
            token,
            input.expectedCommit,
            tag.document,
            true,
          ),
        installTagObject: () =>
          installExactTagObject(publicationContext, tag.document),
        auditRuleset: () =>
          authenticatedRulesetAudit(githubRequest, token, audit.document.id),
        pushTag: () =>
          pushExactTagObject(
            publicationContext,
            token,
            tag.document,
            revalidatePublicationArtifacts,
          ),
        createRelease: () =>
          createRelease(githubRequest, token, input.expectedCommit, tag.document),
        readPublicRelease: () =>
          inspectReleaseState(
            githubRequest,
            undefined,
            input.expectedCommit,
            tag.document,
            false,
          ),
      };
    const revalidatePublicationArtifacts = () => {
      for (const [artifact, label] of [
        [qualification, "Core qualification report"],
        [audit, "Core ruleset audit A"],
        [review, "Core independent review"],
        [tag, "Core signed tag bundle"],
      ]) {
        revalidateCanonicalArtifact(artifact, label);
      }
    };
    const concrete = {
      ...baseOperations,
      pushTag: async () => {
        assertCredentialedCheckoutStable(context.checkoutClosure);
        revalidatePublicationArtifacts();
        return baseOperations.pushTag();
      },
      createRelease: async () => {
        assertCredentialedCheckoutStable(context.checkoutClosure);
        revalidatePublicationArtifacts();
        return baseOperations.createRelease();
      },
    };
    const result = await publishForwardOnly(
      {
        mode: input.mode,
        expectedCommit: input.expectedCommit,
        bundle: tag.document,
        storedAudit: audit.document,
      },
      concrete,
    );
    return { ...result, toolEvidence: context.toolEvidence };
  } finally {
    if (publicationDirectory !== undefined) {
      rmSync(publicationDirectory, { recursive: true, force: true });
    }
  }
}

function coreReleaseBaseLedger() {
  return {
    kind: "takoform.core-releases@v1",
    candidate: {
      version: CORE_RELEASE.version,
      title: CORE_RELEASE.title,
      module: CORE_RELEASE.module,
      commands: expectedCommandNames(),
      distribution: "go-module",
      apiV2Effect: "none",
      status: "candidate",
    },
    releases: [],
  };
}

function parseNormalizedLedger(raw, label) {
  const bytes = Buffer.from(raw);
  let ledger;
  try {
    ledger = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} Core ledger is not JSON: ${error.message}`);
  }
  if (!Buffer.from(`${JSON.stringify(ledger, null, 2)}\n`).equals(bytes)) {
    throw new Error(`${label} Core ledger is not normalized two-space JSON`);
  }
  return ledger;
}

function assertCoreReleaseBaseLedger(ledger) {
  if (canonicalJSON(ledger) !== canonicalJSON(coreReleaseBaseLedger())) {
    throw new Error("source Core ledger does not preserve the exact v0.1.0 candidate");
  }
  return ledger;
}

function parseLedgerTreeEntry(raw, label) {
  const match = /^(100644) blob ([0-9a-f]{40}|[0-9a-f]{64})\trelease\/core-releases\.json\n?$/u.exec(
    String(raw),
  );
  if (!match) throw new Error(`${label} ledger is not one regular Git blob`);
  return { mode: match[1], blob: match[2] };
}

function parseParents(raw, expectedCommit) {
  const values = String(raw).trim().split(/\s+/u);
  if (values[0] !== expectedCommit || values.some((value) => !COMMIT.test(value))) {
    throw new Error(`could not read exact parents for ${expectedCommit}`);
  }
  return values.slice(1);
}

function parseNameStatus(raw) {
  if (String(raw).trim() === "") return [];
  return String(raw)
    .trim()
    .split("\n")
    .map((line) => {
      const fields = line.split("\t");
      if (fields.length !== 2 || !/^[AMD]$/u.test(fields[0])) {
        throw new Error("Git name-status is not an exact non-rename change set");
      }
      return { status: fields[0], path: fields[1] };
    });
}

function normalizeInstalledVersion(output, command, expectedSum) {
  const expected = {
    command,
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sum: expectedSum,
  };
  if (
    !exactKeys(output, Object.keys(expected)) ||
    canonicalJSON(output) !== canonicalJSON(expected)
  ) {
    throw new Error(`${command} installed version output is not exact module/version/sum evidence`);
  }
  return expected;
}

export function verifyGoProxyReadbackResults({
  proxyResult,
  directResult,
  expectedCommit,
}) {
  requireCommit(expectedCommit);
  const expectedOrigin = {
    VCS: "git",
    URL: CORE_RELEASE.repository,
    Hash: expectedCommit,
    Ref: `refs/tags/${CORE_RELEASE.version}`,
  };
  for (const [label, result] of [
    ["proxy", proxyResult],
    ["direct", directResult],
  ]) {
    if (
      result?.Path !== CORE_RELEASE.module ||
      result?.Version !== CORE_RELEASE.version ||
      !GO_SUM.test(result?.Sum ?? "") ||
      !GO_SUM.test(result?.GoModSum ?? "")
    ) {
      throw new Error(`${label} Go module readback lacks exact path/version/sums`);
    }
  }
  if (
    proxyResult.Sum !== directResult.Sum ||
    proxyResult.GoModSum !== directResult.GoModSum ||
    canonicalJSON(directResult.Origin) !== canonicalJSON(expectedOrigin)
  ) {
    throw new Error("proxy/direct Go sums or direct Origin differ from source S and tag ref");
  }
  return {
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sum: proxyResult.Sum,
    goModSum: proxyResult.GoModSum,
    sumdb: "sum.golang.org",
    origin: {
      vcs: "git",
      url: CORE_RELEASE.repository,
      hash: expectedCommit,
      ref: `refs/tags/${CORE_RELEASE.version}`,
    },
  };
}

function parseGoDownload(raw, label) {
  let result;
  try {
    result = JSON.parse(String(raw));
  } catch (error) {
    throw new Error(`${label} go mod download output is not JSON: ${error.message}`);
  }
  if (result?.Error !== undefined) {
    throw new Error(`${label} go mod download failed: ${JSON.stringify(result.Error)}`);
  }
  return result;
}

export function verifyGoDistribution(context, expectedCommit) {
  return withTemporaryDirectory("takoform-core-go-readback-", (directory) => {
    const proxyEnv = goEnvironment(context, join(directory, "proxy"));
    proxyEnv.GOPROXY = "https://proxy.golang.org";
    const directEnv = goEnvironment(context, join(directory, "direct"));
    directEnv.GOPROXY = "direct";
    const identity = `${CORE_RELEASE.module}@${CORE_RELEASE.version}`;
    const proxyResult = parseGoDownload(
      checked(context.runner, context.tools.go, ["mod", "download", "-json", identity], {
        cwd: directory,
        env: proxyEnv,
      }),
      "proxy",
    );
    const directResult = parseGoDownload(
      checked(context.runner, context.tools.go, ["mod", "download", "-json", identity], {
        cwd: directory,
        env: directEnv,
      }),
      "direct",
    );
    const distribution = verifyGoProxyReadbackResults({
      proxyResult,
      directResult,
      expectedCommit,
    });
    const bin = join(directory, "bin");
    mkdirSync(bin, { mode: 0o700 });
    const installs = [];
    for (const command of CORE_RELEASE.commands) {
      const target = `${CORE_RELEASE.module}/cmd/${command.name}@${CORE_RELEASE.version}`;
      checked(context.runner, context.tools.go, ["install", target], {
        cwd: directory,
        env: { ...proxyEnv, GOBIN: bin, CGO_ENABLED: "0" },
      });
      const executable = join(
        bin,
        `${command.name}${process.platform === "win32" ? ".exe" : ""}`,
      );
      strictRegularFile(executable, `${command.name} installed binary`, 512 * 1024 * 1024);
      accessSync(executable, fsConstants.X_OK);
      let version;
      try {
        version = JSON.parse(
          checked(context.runner, executable, ["version"], {
            cwd: directory,
            env: minimalEnvironment(context.env, context.tools),
          }).trim(),
        );
      } catch (error) {
        throw new Error(`${command.name} installed version output is invalid: ${error.message}`);
      }
      installs.push({
        target,
        versionOutput: normalizeInstalledVersion(
          version,
          command.name,
          distribution.sum,
        ),
      });
    }
    return { ...distribution, installs };
  });
}

function inspectPublicRemoteTag(context, expectedCommit) {
  const authority = readTagAuthority(context.repo, expectedCommit);
  const tagRef = `refs/tags/${CORE_RELEASE.version}`;
  const raw = gitChecked(context, [
    "ls-remote",
    "--tags",
    CORE_RELEASE.origin,
    tagRef,
    `${tagRef}^{}`,
  ], {
    cwd: "/",
    env: gitEnvironment(context.env, context.tools, { network: true }),
  });
  const refs = parseRemoteTagRefs(raw);
  if (refs.status !== "exact" || refs.commit !== expectedCommit) {
    throw new Error("public Core tag is absent or does not peel to source S");
  }
  return withTemporaryDirectory("takoform-core-public-tag-", (directory) => {
    const allowedSigners = materializeTagAuthority(directory, authority);
    const bare = join(directory, "tag.git");
    gitChecked(context, ["init", "--bare", bare], { cwd: directory });
    const local = { ...context, repo: bare };
    gitChecked(
      local,
      ["fetch", "--no-tags", CORE_RELEASE.origin, `${tagRef}:refs/core/tag`],
      { env: gitEnvironment(context.env, context.tools, { network: true }) },
    );
    const object = gitChecked(local, ["rev-parse", "refs/core/tag"]).trim();
    const objectRaw = Buffer.from(gitChecked(local, ["cat-file", "-p", object]));
    if (object !== refs.object || gitObjectID("tag", objectRaw, object.length) !== object) {
      throw new Error("fresh public Core tag object differs from remote identity");
    }
    gitChecked(local, [
      ...coreTagVerificationGitConfig(allowedSigners, context.tools.sshKeygen),
      "verify-tag",
      object,
    ]);
    const parsed = parseTagObject(objectRaw, expectedCommit);
    return {
      object,
      objectSha256: sha256(objectRaw),
      annotation: normalizeTagAnnotation(parsed.annotation, expectedCommit),
    };
  });
}

async function readPublicReleaseForTag(
  request,
  expectedCommit,
  tagEvidence,
) {
  const bundleIdentity = {
    tagObject: tagEvidence.object,
    rulesetAuditDigest: tagEvidence.annotation.rulesetAuditDigest,
  };
  const state = await inspectReleaseState(
    request,
    undefined,
    expectedCommit,
    bundleIdentity,
    false,
  );
  if (state.status !== "exact") {
    throw new Error("public immutable Core Release is absent");
  }
  return state.release;
}

export function createCoreReleaseReceipt({
  expectedCommit,
  tagEvidence,
  release,
  go,
}) {
  requireCommit(expectedCommit);
  const annotation = normalizeTagAnnotation(tagEvidence?.annotation, expectedCommit);
  requireObject(tagEvidence?.object, "receipt tag object");
  if (!SHA256.test(tagEvidence?.objectSha256 ?? "")) {
    throw new Error("receipt tag object digest is invalid");
  }
  const bundleIdentity = {
    tagObject: tagEvidence.object,
    rulesetAuditDigest: annotation.rulesetAuditDigest,
  };
  verifyReleaseIdentity(release, expectedCommit, bundleIdentity);
  const normalizedGo = normalizeGoReceipt(go, expectedCommit);
  return {
    format: "takoform.core-release-receipt@v2",
    version: CORE_RELEASE.version,
    title: CORE_RELEASE.title,
    module: CORE_RELEASE.module,
    sourceCommit: expectedCommit,
    tag: {
      name: CORE_RELEASE.version,
      object: tagEvidence.object,
      objectSha256: tagEvidence.objectSha256,
      annotated: true,
      signerPrincipal: CORE_RELEASE.tagSignerPrincipal,
      signerFingerprint: CORE_RELEASE.tagSignerFingerprint,
      annotation,
    },
    release: {
      id: release.id,
      url: `${CORE_RELEASE.repository}/releases/tag/${CORE_RELEASE.version}`,
      immutable: true,
      assets: [],
    },
    go: normalizedGo,
  };
}

function normalizeGoReceipt(go, expectedCommit) {
  const expectedOrigin = {
    vcs: "git",
    url: CORE_RELEASE.repository,
    hash: expectedCommit,
    ref: `refs/tags/${CORE_RELEASE.version}`,
  };
  if (
    !exactKeys(go, [
      "module",
      "version",
      "sum",
      "goModSum",
      "sumdb",
      "origin",
      "installs",
    ]) ||
    go.module !== CORE_RELEASE.module ||
    go.version !== CORE_RELEASE.version ||
    !GO_SUM.test(go.sum ?? "") ||
    !GO_SUM.test(go.goModSum ?? "") ||
    go.sumdb !== "sum.golang.org" ||
    canonicalJSON(go.origin) !== canonicalJSON(expectedOrigin) ||
    !Array.isArray(go.installs) ||
    go.installs.length !== CORE_RELEASE.commands.length
  ) {
    throw new Error("Core receipt Go evidence is not exact proxy/direct/sumdb evidence");
  }
  const targets = [];
  for (let index = 0; index < CORE_RELEASE.commands.length; index += 1) {
    const command = CORE_RELEASE.commands[index];
    const install = go.installs[index];
    const target = `${CORE_RELEASE.module}/cmd/${command.name}@${CORE_RELEASE.version}`;
    if (!exactKeys(install, ["target", "versionOutput"]) || install.target !== target) {
      throw new Error("Core receipt install targets are not the exact versioned command set");
    }
    normalizeInstalledVersion(install.versionOutput, command.name, go.sum);
    targets.push(structuredClone(install));
  }
  return {
    module: CORE_RELEASE.module,
    version: CORE_RELEASE.version,
    sum: go.sum,
    goModSum: go.goModSum,
    sumdb: "sum.golang.org",
    origin: expectedOrigin,
    installs: targets,
  };
}

export function normalizeCoreReleaseReceipt(receipt, expectedCommit) {
  const keys = [
    "format",
    "version",
    "title",
    "module",
    "sourceCommit",
    "tag",
    "release",
    "go",
  ];
  if (
    !exactKeys(receipt, keys) ||
    receipt.format !== "takoform.core-release-receipt@v2" ||
    receipt.version !== CORE_RELEASE.version ||
    receipt.title !== CORE_RELEASE.title ||
    receipt.module !== CORE_RELEASE.module ||
    receipt.sourceCommit !== expectedCommit ||
    !exactKeys(receipt.tag, [
      "name",
      "object",
      "objectSha256",
      "annotated",
      "signerPrincipal",
      "signerFingerprint",
      "annotation",
    ]) ||
    receipt.tag.name !== CORE_RELEASE.version ||
    !OBJECT.test(receipt.tag.object ?? "") ||
    !SHA256.test(receipt.tag.objectSha256 ?? "") ||
    receipt.tag.annotated !== true ||
    receipt.tag.signerPrincipal !== CORE_RELEASE.tagSignerPrincipal ||
    receipt.tag.signerFingerprint !== CORE_RELEASE.tagSignerFingerprint
  ) {
    throw new Error("Core release receipt has an invalid closed v2 identity");
  }
  normalizeTagAnnotation(receipt.tag.annotation, expectedCommit);
  if (
    !exactKeys(receipt.release, ["id", "url", "immutable", "assets"]) ||
    !Number.isSafeInteger(receipt.release.id) ||
    receipt.release.id <= 0 ||
    receipt.release.url !==
      `${CORE_RELEASE.repository}/releases/tag/${CORE_RELEASE.version}` ||
    receipt.release.immutable !== true ||
    canonicalJSON(receipt.release.assets) !== canonicalJSON([])
  ) {
    throw new Error("Core release receipt Release identity is invalid");
  }
  normalizeGoReceipt(receipt.go, expectedCommit);
  return structuredClone(receipt);
}

export function verifyCoreReleaseLedgerTransition({
  sourceLedger,
  receiptLedger,
  expectedCommit,
  receipt,
}) {
  assertCoreReleaseBaseLedger(sourceLedger);
  normalizeCoreReleaseReceipt(receipt, expectedCommit);
  const expected = {
    kind: sourceLedger.kind,
    candidate: structuredClone(sourceLedger.candidate),
    releases: [structuredClone(receipt)],
  };
  if (canonicalJSON(receiptLedger) !== canonicalJSON(expected)) {
    throw new Error("Core ledger transition is not the sole candidate-to-one-receipt append");
  }
  return expected;
}

function prepareDirectoryOutput(path, repositoryRoot, label) {
  requireAbsolutePath(path, label);
  if (existsSync(path)) throw new Error(`${label} already exists; refusing overwrite`);
  assertPrivateParent(path, label);
  assertOutsideRepository(resolve(path), repositoryRoot, label);
  return resolve(path);
}

function inventoryTree(root) {
  const inventory = [];
  const walk = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = prefix === "" ? name : `${prefix}/${name}`;
      const status = lstatSync(path);
      if (
        status.isSymbolicLink() ||
        !ownedByReleaseUser(status) ||
        (status.mode & 0o022) !== 0
      ) {
        throw new Error(`record artifact contains unsafe path ${relativePath}`);
      }
      if (status.isDirectory()) {
        inventory.push({
          path: relativePath,
          type: "directory",
          mode: status.mode & 0o777,
        });
        walk(path, relativePath);
      } else if (status.isFile() && status.nlink === 1) {
        const raw = readFileSync(path);
        inventory.push({
          path: relativePath,
          type: "file",
          mode: status.mode & 0o777,
          bytes: raw.length,
          sha256: sha256(raw),
        });
      } else {
        throw new Error(`record artifact contains unsupported path ${relativePath}`);
      }
    }
  };
  walk(root);
  return inventory;
}

function safeRecordRepositoryConfig() {
  return [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = true",
    "\tbare = true",
    '[remote "origin"]',
    `\turl = ${CORE_RELEASE.origin}`,
    "\ttagOpt = --no-tags",
    "",
  ].join("\n");
}

function writeSafeRecordRepositoryConfig(repository) {
  const staging = join(dirname(repository), "record-safe-config");
  writeFileSync(staging, safeRecordRepositoryConfig(), {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(staging, join(repository, "config"));
}

function assertSafeRecordRepositoryMetadata(repository, inventory) {
  const config = strictRegularFile(
    join(repository, "config"),
    "record artifact Git config",
    64 * 1024,
  );
  if (!config.equals(Buffer.from(safeRecordRepositoryConfig()))) {
    throw new Error("record artifact Git config is not the fixed non-extensible config");
  }
  const forbidden = inventory.find(({ path }) =>
    path === "shallow" ||
    path === "info/grafts" ||
    path === "objects/info/alternates" ||
    path === "objects/info/http-alternates" ||
    path === "objects/info/commit-graph" ||
    path === "objects/info/commit-graphs" ||
    path.startsWith("objects/info/commit-graphs/") ||
    path === "objects/pack/multi-pack-index" ||
    (path.startsWith("objects/pack/") &&
      (path.endsWith(".rev") || path.endsWith(".bitmap"))) ||
    path === "config.worktree" ||
    path === "hooks" ||
    path.startsWith("hooks/") ||
    path === "refs/replace" ||
    path.startsWith("refs/replace/") ||
    path.endsWith(".promisor")
  );
  if (forbidden !== undefined) {
    throw new Error(`record artifact contains forbidden Git metadata ${forbidden.path}`);
  }
  const packedRefs = join(repository, "packed-refs");
  if (
    existsSync(packedRefs) &&
    /(?:^|\n)[0-9a-f]+ refs\/replace\//u.test(
      strictRegularFile(
        packedRefs,
        "record artifact packed refs",
        MAX_ARTIFACT_BYTES,
      ).toString("utf8"),
    )
  ) {
    throw new Error("record artifact contains a packed replacement ref");
  }
}

function removeRecordRepositoryAccelerators(repository) {
  for (const path of [
    join(repository, "objects", "info", "commit-graph"),
    join(repository, "objects", "info", "commit-graphs"),
    join(repository, "objects", "pack", "multi-pack-index"),
  ]) {
    rmSync(path, { recursive: true, force: true });
  }
  const pack = join(repository, "objects", "pack");
  if (existsSync(pack)) {
    for (const name of readdirSync(pack)) {
      if (name.endsWith(".rev") || name.endsWith(".bitmap")) {
        rmSync(join(pack, name), { force: true });
      }
    }
  }
}

function flattenRawGitTree(reader, tree, label) {
  const files = new Map();
  let count = 0;
  const walk = (object, prefix = "", depth = 0) => {
    if (depth > 128) throw new Error(`${label} exceeds the tree-depth limit`);
    for (const entry of parseRawTree(reader, object, `${label} tree ${prefix || "."}`)) {
      count += 1;
      if (count > 250_000) throw new Error(`${label} exceeds the tree-entry limit`);
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.mode === "40000") {
        walk(entry.object, path, depth + 1);
      } else {
        files.set(path, { mode: entry.mode, object: entry.object });
      }
    }
  };
  walk(tree);
  return files;
}

function rawLedger(reader, entry, label) {
  if (entry === undefined || !["100644", "100755"].includes(entry.mode)) {
    throw new Error(`${label} ledger is absent or not one regular blob`);
  }
  const object = reader.read(entry.object);
  if (object.type !== "blob") throw new Error(`${label} ledger object is not a blob`);
  return parseNormalizedLedger(object.body.toString("utf8"), label);
}

function rawRecordArtifactValidation(manifest, repository) {
  const reader = createRawGitObjectReader(repository);
  const receipt = parseRawCommit(reader, manifest.receiptCommit, "record artifact raw R");
  if (canonicalJSON(receipt.parents) !== canonicalJSON([manifest.parentCommit])) {
    throw new Error("record artifact raw R does not have exact sole parent P");
  }
  const parent = parseRawCommit(reader, manifest.parentCommit, "record artifact raw P");
  const source = parseRawCommit(reader, manifest.sourceCommit, "record artifact raw S");
  let cursor = parent;
  const visited = new Set();
  for (let count = 0; cursor.object !== manifest.sourceCommit; count += 1) {
    if (count > 250_000 || visited.has(cursor.object) || cursor.parents.length === 0) {
      throw new Error("record artifact raw P is not a first-parent descendant of S");
    }
    visited.add(cursor.object);
    cursor = parseRawCommit(reader, cursor.parents[0], "record artifact raw ancestor");
  }
  if (!cursor.raw.equals(source.raw)) {
    throw new Error("record artifact raw S identity is inconsistent");
  }
  assertTagAuthorityLineage(
    repository,
    manifest.sourceCommit,
    manifest.parentCommit,
  );
  const sourceTree = flattenRawGitTree(reader, source.tree, "record artifact raw S");
  const parentTree = flattenRawGitTree(reader, parent.tree, "record artifact raw P");
  const receiptTree = flattenRawGitTree(reader, receipt.tree, "record artifact raw R");
  const sourceEntry = sourceTree.get(CORE_RELEASE.ledger);
  const parentEntry = parentTree.get(CORE_RELEASE.ledger);
  const receiptEntry = receiptTree.get(CORE_RELEASE.ledger);
  if (
    sourceEntry?.object !== manifest.sourceLedgerBlob ||
    parentEntry?.object !== manifest.sourceLedgerBlob ||
    receiptEntry?.object !== manifest.receiptLedgerBlob ||
    sourceEntry?.mode !== parentEntry?.mode ||
    parentEntry?.mode !== receiptEntry?.mode
  ) {
    throw new Error("record artifact raw ledger object identities differ from manifest");
  }
  const paths = new Set([...parentTree.keys(), ...receiptTree.keys()]);
  const changed = [...paths].filter((path) =>
    canonicalJSON(parentTree.get(path)) !== canonicalJSON(receiptTree.get(path))
  );
  if (canonicalJSON(changed) !== canonicalJSON([CORE_RELEASE.ledger])) {
    throw new Error("record artifact raw P to R changes more than the one ledger path");
  }
  verifyCoreReleaseLedgerTransition({
    sourceLedger: rawLedger(reader, sourceEntry, "record raw source S"),
    receiptLedger: rawLedger(reader, receiptEntry, "record raw receipt R"),
    expectedCommit: manifest.sourceCommit,
    receipt: manifest.receipt,
  });
  return { reader, receipt, parent, source };
}

function normalizeRecordArtifactManifest(manifest) {
  const keys = [
    "format",
    "repository",
    "ref",
    "ledgerPath",
    "sourceCommit",
    "parentCommit",
    "receiptCommit",
    "sourceLedgerBlob",
    "receiptLedgerBlob",
    "tagObject",
    "receiptDigest",
    "receipt",
    "repositoryDirectory",
    "repositoryInventory",
    "artifactRoot",
    "tools",
  ];
  if (
    !exactKeys(manifest, keys) ||
    manifest.format !== "takoform.core-record-push-artifact@v3" ||
    manifest.repository !== CORE_RELEASE.origin ||
    manifest.ref !== CORE_RELEASE.ref ||
    manifest.ledgerPath !== CORE_RELEASE.ledger ||
    !COMMIT.test(manifest.sourceCommit ?? "") ||
    !COMMIT.test(manifest.parentCommit ?? "") ||
    !COMMIT.test(manifest.receiptCommit ?? "") ||
    !OBJECT.test(manifest.sourceLedgerBlob ?? "") ||
    !OBJECT.test(manifest.receiptLedgerBlob ?? "") ||
    !OBJECT.test(manifest.tagObject ?? "") ||
    !SHA256.test(manifest.receiptDigest ?? "") ||
    manifest.repositoryDirectory !== "repository.git" ||
    !exactKeys(manifest.artifactRoot, ["ownerUid", "mode"]) ||
    !Number.isSafeInteger(manifest.artifactRoot.ownerUid) ||
    ![0, typeof process.getuid === "function" ? process.getuid() : 0].includes(
      manifest.artifactRoot.ownerUid,
    ) ||
    manifest.artifactRoot.mode !== 0o700 ||
    !Array.isArray(manifest.repositoryInventory) ||
    manifest.repositoryInventory.length === 0 ||
    !exactKeys(manifest.tools, ["node", "git", "sshKeygen", "go"])
  ) {
    throw new Error("Core record-push manifest has an invalid closed identity");
  }
  normalizeNodeRuntimeEvidence(manifest.tools.node, "record artifact node");
  for (const name of ["git", "sshKeygen", "go"]) {
    normalizeToolEvidence(manifest.tools[name], `record artifact ${name}`);
  }
  normalizeCoreReleaseReceipt(manifest.receipt, manifest.sourceCommit);
  if (
    manifest.receipt.tag.object !== manifest.tagObject ||
    sha256(Buffer.from(canonicalJSON(manifest.receipt))) !== manifest.receiptDigest
  ) {
    throw new Error("Core record-push manifest receipt or tag binding differs");
  }
  const paths = new Set();
  for (const entry of manifest.repositoryInventory) {
    if (
      !exactKeys(
        entry,
        entry?.type === "directory"
          ? ["path", "type", "mode"]
          : ["path", "type", "mode", "bytes", "sha256"],
      ) ||
      typeof entry.path !== "string" ||
      entry.path === "" ||
      entry.path.startsWith("/") ||
      entry.path.includes("\\") ||
      entry.path.split("/").includes("..") ||
      paths.has(entry.path) ||
      !["directory", "file"].includes(entry.type) ||
      !Number.isSafeInteger(entry.mode) ||
      (entry.mode & 0o022) !== 0 ||
      (entry.type === "file" &&
        (!Number.isSafeInteger(entry.bytes) ||
          entry.bytes < 0 ||
          !SHA256.test(entry.sha256 ?? "")))
    ) {
      throw new Error("Core record-push repository inventory is invalid");
    }
    paths.add(entry.path);
  }
  return structuredClone(manifest);
}

function semanticRecordArtifactValidation(context, manifest, repository) {
  rawRecordArtifactValidation(manifest, repository);
  const local = { ...context, repo: repository };
  gitChecked(local, ["fsck", "--full", "--strict", "--no-reflogs"]);
  if (gitChecked(local, ["cat-file", "-t", manifest.receiptCommit]).trim() !== "commit") {
    throw new Error("record artifact R is not a commit object");
  }
  const parents = parseParents(
    gitChecked(local, ["rev-list", "--parents", "-n", "1", manifest.receiptCommit]),
    manifest.receiptCommit,
  );
  if (canonicalJSON(parents) !== canonicalJSON([manifest.parentCommit])) {
    throw new Error("record artifact R does not have sole parent P");
  }
  const history = gitChecked(local, [
    "rev-list",
    "--first-parent",
    manifest.parentCommit,
  ])
    .trim()
    .split("\n");
  if (!history.includes(manifest.sourceCommit)) {
    throw new Error("record artifact P is not a first-parent descendant of source S");
  }
  const sourceEntry = parseLedgerTreeEntry(
    gitChecked(local, ["ls-tree", manifest.sourceCommit, "--", CORE_RELEASE.ledger]),
    "record source S",
  );
  const parentEntry = parseLedgerTreeEntry(
    gitChecked(local, ["ls-tree", manifest.parentCommit, "--", CORE_RELEASE.ledger]),
    "record parent P",
  );
  const receiptEntry = parseLedgerTreeEntry(
    gitChecked(local, ["ls-tree", manifest.receiptCommit, "--", CORE_RELEASE.ledger]),
    "record receipt R",
  );
  if (
    sourceEntry.blob !== manifest.sourceLedgerBlob ||
    parentEntry.blob !== sourceEntry.blob ||
    receiptEntry.blob !== manifest.receiptLedgerBlob
  ) {
    throw new Error("record artifact ledger object identities differ from manifest");
  }
  const changed = parseNameStatus(
    gitChecked(local, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "--no-renames",
      manifest.parentCommit,
      manifest.receiptCommit,
      "--",
    ]),
  );
  if (
    canonicalJSON(changed) !==
    canonicalJSON([{ status: "M", path: CORE_RELEASE.ledger }])
  ) {
    throw new Error("record artifact P to R changes more than the one ledger path");
  }
  const sourceLedger = parseNormalizedLedger(
    gitChecked(local, ["show", `${manifest.sourceCommit}:${CORE_RELEASE.ledger}`]),
    "record source S",
  );
  const receiptLedger = parseNormalizedLedger(
    gitChecked(local, ["show", `${manifest.receiptCommit}:${CORE_RELEASE.ledger}`]),
    "record receipt R",
  );
  verifyCoreReleaseLedgerTransition({
    sourceLedger,
    receiptLedger,
    expectedCommit: manifest.sourceCommit,
    receipt: manifest.receipt,
  });
  const origin = gitChecked(local, ["config", "--get", "remote.origin.url"]).trim();
  if (origin !== CORE_RELEASE.origin) {
    throw new Error("record artifact repository origin is not fixed");
  }
  return manifest;
}

export function readRecordPushArtifact(path, context) {
  requireAbsolutePath(path, "record-push artifact");
  assertPrivateParent(path, "record-push artifact root");
  const rootCustody = assertPrivateDirectory(path, "record-push artifact root");
  const root = rootCustody.path;
  const entries = readdirSync(root).sort();
  if (canonicalJSON(entries) !== canonicalJSON(["manifest.json", "repository.git"])) {
    throw new Error("record-push artifact root is not closed");
  }
  const manifestArtifact = parseCanonicalArtifact(
    join(root, "manifest.json"),
    "Core record-push manifest",
  );
  const manifest = normalizeRecordArtifactManifest(manifestArtifact.document);
  if (
    manifest.artifactRoot.ownerUid !== rootCustody.identity.uid ||
    manifest.artifactRoot.mode !== (rootCustody.identity.mode & 0o777)
  ) {
    throw new Error("record-push artifact root custody differs from its manifest");
  }
  const repository = join(root, manifest.repositoryDirectory);
  if (
    realpathSync(repository) !== resolve(repository) ||
    !lstatSync(repository).isDirectory()
  ) {
    throw new Error("record-push private repository is not one exact directory");
  }
  const inventory = inventoryTree(repository);
  if (canonicalJSON(inventory) !== canonicalJSON(manifest.repositoryInventory)) {
    throw new Error("record-push private repository inventory changed");
  }
  assertSafeRecordRepositoryMetadata(repository, inventory);
  if (context !== undefined) {
    semanticRecordArtifactValidation(context, manifest, repository);
  }
  const finalCustody = assertPrivateDirectory(root, "record-push artifact root");
  if (
    canonicalJSON(finalCustody.identity) !== canonicalJSON(rootCustody.identity) ||
    canonicalJSON(inventoryTree(repository)) !==
      canonicalJSON(manifest.repositoryInventory)
  ) {
    throw new Error("record-push artifact changed while being validated");
  }
  revalidateCanonicalArtifact(manifestArtifact, "Core record-push manifest");
  return {
    root,
    repository,
    manifest,
    manifestDigest: manifestArtifact.digest,
    manifestArtifact,
    rootCustody,
  };
}

function revalidateRecordPushArtifact(artifact) {
  const custody = assertPrivateDirectory(artifact.root, "record-push artifact root");
  if (canonicalJSON(custody.identity) !== canonicalJSON(artifact.rootCustody.identity)) {
    throw new Error("record-push artifact root changed or was replaced after validation");
  }
  revalidateCanonicalArtifact(artifact.manifestArtifact, "Core record-push manifest");
  if (
    canonicalJSON(readdirSync(artifact.root).sort()) !==
    canonicalJSON(["manifest.json", "repository.git"])
  ) {
    throw new Error("record-push artifact root changed after validation");
  }
  const inventory = inventoryTree(artifact.repository);
  if (canonicalJSON(inventory) !== canonicalJSON(artifact.manifest.repositoryInventory)) {
    throw new Error("record-push artifact repository changed after validation");
  }
  assertSafeRecordRepositoryMetadata(artifact.repository, inventory);
  return artifact;
}

function buildRecordPushArtifact(
  context,
  {
    output,
    expectedCommit,
    receipt,
    now = () => new Date(),
    cloneOrigin = CORE_RELEASE.origin,
  },
) {
  const finalOutput = prepareDirectoryOutput(
    output,
    context.repo,
    "Core record-push artifact output",
  );
  const parent = dirname(finalOutput);
  const staging = mkdtempSync(join(parent, ".takoform-core-record-"));
  chmodSync(staging, 0o700);
  let completed = false;
  try {
    const repository = join(staging, "repository.git");
    gitChecked(
      context,
      ["clone", "--bare", "--no-local", "--no-tags", cloneOrigin, repository],
      {
        cwd: staging,
        env: gitEnvironment(context.env, context.tools, { network: true }),
      },
    );
    const local = { ...context, repo: repository };
    if (cloneOrigin !== CORE_RELEASE.origin) {
      gitChecked(local, ["config", "remote.origin.url", CORE_RELEASE.origin]);
    }
    writeSafeRecordRepositoryConfig(repository);
    const parentCommit = gitChecked(local, ["rev-parse", CORE_RELEASE.ref]).trim();
    requireCommit(parentCommit, "record parent P");
    const history = gitChecked(local, ["rev-list", "--first-parent", parentCommit])
      .trim()
      .split("\n");
    if (!history.includes(expectedCommit)) {
      throw new Error("record parent P is not a first-parent descendant of source S");
    }
    assertTagAuthorityLineage(repository, expectedCommit, parentCommit);
    const sourceEntry = parseLedgerTreeEntry(
      gitChecked(local, ["ls-tree", expectedCommit, "--", CORE_RELEASE.ledger]),
      "record source S",
    );
    const parentEntry = parseLedgerTreeEntry(
      gitChecked(local, ["ls-tree", parentCommit, "--", CORE_RELEASE.ledger]),
      "record parent P",
    );
    if (sourceEntry.blob !== parentEntry.blob) {
      throw new Error("record parent P changed the source-S Core ledger");
    }
    const sourceLedger = parseNormalizedLedger(
      gitChecked(local, ["show", `${expectedCommit}:${CORE_RELEASE.ledger}`]),
      "record source S",
    );
    assertCoreReleaseBaseLedger(sourceLedger);
    const receiptLedger = {
      kind: sourceLedger.kind,
      candidate: structuredClone(sourceLedger.candidate),
      releases: [normalizeCoreReleaseReceipt(receipt, expectedCommit)],
    };
    verifyCoreReleaseLedgerTransition({
      sourceLedger,
      receiptLedger,
      expectedCommit,
      receipt,
    });
    const ledgerFile = join(staging, "receipt-ledger.json");
    writeFileSync(ledgerFile, `${JSON.stringify(receiptLedger, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    const receiptLedgerBlob = gitChecked(local, [
      "hash-object",
      "--no-filters",
      "-w",
      ledgerFile,
    ]).trim();
    requireObject(receiptLedgerBlob, "receipt ledger blob");
    const index = join(staging, "receipt-index");
    const indexEnv = gitEnvironment(context.env, context.tools, {
      extra: { GIT_INDEX_FILE: index },
    });
    gitChecked(local, ["read-tree", parentCommit], { env: indexEnv });
    gitChecked(
      local,
      [
        "update-index",
        "--add",
        "--cacheinfo",
        `100644,${receiptLedgerBlob},${CORE_RELEASE.ledger}`,
      ],
      { env: indexEnv },
    );
    const tree = gitChecked(local, ["write-tree"], { env: indexEnv }).trim();
    requireObject(tree, "receipt tree");
    const instant = now();
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
      throw new Error("record artifact commit time is invalid");
    }
    const receiptCommit = gitChecked(
      local,
      ["commit-tree", tree, "-p", parentCommit],
      {
        input: `Record ${CORE_RELEASE.title} publication receipt\n`,
        env: gitEnvironment(context.env, context.tools, {
          extra: {
            GIT_AUTHOR_NAME: "Takoform Core Receipt",
            GIT_AUTHOR_EMAIL:
              "takoform-core-receipt@users.noreply.github.com",
            GIT_AUTHOR_DATE: instant.toISOString(),
            GIT_COMMITTER_NAME: "Takoform Core Receipt",
            GIT_COMMITTER_EMAIL:
              "takoform-core-receipt@users.noreply.github.com",
            GIT_COMMITTER_DATE: instant.toISOString(),
          },
        }),
      },
    ).trim();
    requireCommit(receiptCommit, "receipt commit R");
    gitChecked(local, ["update-ref", "refs/core/receipt", receiptCommit]);
    const manifestBase = {
      format: "takoform.core-record-push-artifact@v3",
      repository: CORE_RELEASE.origin,
      ref: CORE_RELEASE.ref,
      ledgerPath: CORE_RELEASE.ledger,
      sourceCommit: expectedCommit,
      parentCommit,
      receiptCommit,
      sourceLedgerBlob: sourceEntry.blob,
      receiptLedgerBlob,
      tagObject: receipt.tag.object,
      receiptDigest: sha256(Buffer.from(canonicalJSON(receipt))),
      receipt,
      repositoryDirectory: "repository.git",
      repositoryInventory: [],
      artifactRoot: {
        ownerUid: lstatSync(staging).uid,
        mode: lstatSync(staging).mode & 0o777,
      },
      tools: context.toolEvidence,
    };
    removeRecordRepositoryAccelerators(repository);
    semanticRecordArtifactValidation(context, manifestBase, repository);
    rmSync(ledgerFile, { force: true });
    rmSync(index, { force: true });
    rmSync(join(repository, "hooks"), { recursive: true, force: true });
    const manifest = {
      ...manifestBase,
      repositoryInventory: inventoryTree(repository),
    };
    normalizeRecordArtifactManifest(manifest);
    writeFileSync(join(staging, "manifest.json"), canonicalJSON(manifest), {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(staging, finalOutput);
    completed = true;
    const reread = readRecordPushArtifact(finalOutput, context);
    return {
      output: finalOutput,
      parentCommit,
      receiptCommit,
      manifestDigest: reread.manifestDigest,
    };
  } finally {
    if (!completed) rmSync(staging, { recursive: true, force: true });
  }
}

export async function recordPrepareCoreRelease(
  input,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
    githubRequest = defaultGitHubRequest,
    operations,
    now,
    cloneOrigin,
  } = {},
) {
  assertCoreReleasePhaseAuthority("record-prepare", env);
  requireCommit(input?.expectedCommit);
  requireAbsolutePath(input?.output, "record-prepare output");
  const context = buildContext("record-prepare", {
    repo,
    env,
    runner,
    tools,
    runtimePath,
    runtimeVersion,
    toolNames: ["git", "sshKeygen", "go"],
  });
  const state = phaseState("record-prepare");
  phaseStep(state, "detached-source-S", () =>
    assertDetachedSource(context, input.expectedCommit),
  );
  phaseStep(state, "record-artifact-output-fence", () =>
    prepareDirectoryOutput(
      input.output,
      context.repo,
      "Core record-push artifact output",
    ),
  );
  let tagEvidence;
  let release;
  let go;
  try {
    tagEvidence = await (operations?.readTag?.() ??
      inspectPublicRemoteTag(context, input.expectedCommit));
    release = await (operations?.readRelease?.(tagEvidence) ??
      readPublicReleaseForTag(githubRequest, input.expectedCommit, tagEvidence));
    go = await (operations?.verifyGo?.() ??
      verifyGoDistribution(context, input.expectedCommit));
  } catch (error) {
    throw new ReleaseFailure(
      `fresh-public-evidence failed: ${error.message}`,
      { ...state, stage: "fresh-public-evidence" },
      error,
    );
  }
  const receipt = phaseStep(state, "receipt-v2", () =>
    createCoreReleaseReceipt({
      expectedCommit: input.expectedCommit,
      tagEvidence,
      release,
      go,
    }),
  );
  const artifact = phaseStep(state, "construct-P-to-R-artifact", () =>
    operations?.buildArtifact?.(receipt) ??
    buildRecordPushArtifact(context, {
      output: input.output,
      expectedCommit: input.expectedCommit,
      receipt,
      ...(now === undefined ? {} : { now }),
      ...(cloneOrigin === undefined ? {} : { cloneOrigin }),
    }),
  );
  state.stage = "complete";
  return {
    phase: "record-prepare",
    status: "receipt-artifact-prepared",
    sourceCommit: input.expectedCommit,
    parentCommit: artifact.parentCommit,
    receiptCommit: artifact.receiptCommit,
    artifact: artifact.output ?? input.output,
    artifactDigest: artifact.manifestDigest,
    receipt,
    repositoryStateTouched: false,
    externalStateTouched: false,
  };
}

function remoteMainFromLsRemote(context, token) {
  const raw = gitChecked(
    context,
    [
      ...tokenGitArgs(token),
      "ls-remote",
      CORE_RELEASE.origin,
      CORE_RELEASE.ref,
    ],
    { env: gitEnvironment(context.env, context.tools, { network: true }) },
  );
  return parseSingleRemoteRef(raw, CORE_RELEASE.ref);
}

function classifyRecordPushReadback(context, manifest, pushResult) {
  const current = gitChecked(context, ["rev-parse", "refs/core/readback"]).trim();
  requireCommit(current, "authoritative main readback");
  const history = gitChecked(context, ["rev-list", "--first-parent", current])
    .trim()
    .split("\n");
  const currentEntry = parseLedgerTreeEntry(
    gitChecked(context, ["ls-tree", current, "--", CORE_RELEASE.ledger]),
    "authoritative main",
  );
  if (history.includes(manifest.receiptCommit)) {
    if (currentEntry.blob !== manifest.receiptLedgerBlob) {
      throw new Error("main advanced after R but rewrote the receipt ledger");
    }
    return {
      status: "recorded",
      canonicalMainCommit: current,
      externalStateTouched: pushResult?.status === 0,
    };
  }
  if (!history.includes(manifest.parentCommit)) {
    throw new Error("authoritative main is not a first-parent descendant of artifact P");
  }
  if (currentEntry.blob !== manifest.sourceLedgerBlob) {
    throw new Error("a competing main advance changed the Core receipt ledger");
  }
  return {
    status: "cas-lost",
    canonicalMainCommit: current,
    externalStateTouched: false,
  };
}

export function recordPushCoreRelease(
  input,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
  } = {},
) {
  assertCoreReleasePhaseAuthority("record-push", env);
  validateCoreReleaseRuntime({ runtimePath, runtimeVersion });
  requireAbsolutePath(input?.artifact, "record-push artifact");
  requireAbsolutePath(repo, "release repository");
  const repositoryRoot = realpathSync(repo);
  const state = phaseState("record-push");
  phaseStep(state, "private-input-boundary", () =>
    assertPrivateInputOutsideRepository(
      input.artifact,
      repositoryRoot,
      "Core record-push artifact",
    ),
  );
  const artifact = phaseStep(state, "closed-record-artifact", () =>
    readRecordPushArtifact(input.artifact),
  );
  const context = buildContext("record-push", {
    repo: repositoryRoot,
    env,
    runner,
    tools,
    runtimePath,
    runtimeVersion,
    toolNames: ["git"],
    credentialedCommit: artifact.manifest.sourceCommit,
  });
  phaseStep(state, "detached-source-S", () =>
    assertDetachedSource(context, artifact.manifest.sourceCommit),
  );
  const token = env.TAKOFORM_CORE_REF_WRITE_TOKEN;
  return withTemporaryDirectory("takoform-core-record-push-", (directory) => {
    const repository = join(directory, "repository.git");
    phaseStep(state, "record-artifact-stability-before-copy", () =>
      revalidateRecordPushArtifact(artifact),
    );
    phaseStep(state, "private-repository-copy", () =>
      cpSync(artifact.repository, repository, {
        recursive: true,
        preserveTimestamps: true,
        errorOnExist: true,
      }),
    );
    const local = { ...context, repo: repository };
    const assertCopiedRepositoryStable = () => {
      const copiedInventory = inventoryTree(repository);
      if (
        canonicalJSON(copiedInventory) !==
        canonicalJSON(artifact.manifest.repositoryInventory)
      ) {
        throw new Error("record artifact changed while its private repository was copied");
      }
      assertSafeRecordRepositoryMetadata(repository, copiedInventory);
    };
    phaseStep(state, "private-repository-copy-closure", assertCopiedRepositoryStable);
    phaseStep(state, "exact-R-object-and-transition", () =>
      semanticRecordArtifactValidation(local, artifact.manifest, repository),
    );
    const before = phaseStep(state, "authoritative-P-lease-readback", () =>
      remoteMainFromLsRemote(local, token),
    );
    if (before !== artifact.manifest.parentCommit) {
      phaseStep(state, "stale-P-readback-fetch", () =>
        gitChecked(
          local,
          [
            ...tokenGitArgs(token),
            "fetch",
            "--no-tags",
            CORE_RELEASE.origin,
            `+${CORE_RELEASE.ref}:refs/core/readback`,
          ],
          { env: gitEnvironment(context.env, context.tools, { network: true }) },
        ),
      );
      const classified = phaseStep(state, "stale-P-classification", () =>
        classifyRecordPushReadback(local, artifact.manifest, { status: 1 }),
      );
      if (classified.canonicalMainCommit === artifact.manifest.parentCommit) {
        throw new ReleaseFailure(
          "pre-CAS main readbacks disagreed about P; refusing a stale or ambiguous lease",
          { ...state, stage: "stale-P-readback-disagreement" },
        );
      }
      state.stage = "complete";
      return {
        phase: "record-push",
        ...classified,
        sourceCommit: artifact.manifest.sourceCommit,
        parentCommit: artifact.manifest.parentCommit,
        receiptCommit: artifact.manifest.receiptCommit,
        repositoryStateTouched: false,
        toolEvidence: context.toolEvidence,
      };
    }
    phaseStep(state, "record-artifact-stability-before-CAS", assertCopiedRepositoryStable);
    state.externalStateIndeterminate = true;
    const pushResult = gitResult(
      local,
      [
        ...tokenGitArgs(token),
        "push",
        "--porcelain",
        "--no-verify",
        `--force-with-lease=${CORE_RELEASE.ref}:${artifact.manifest.parentCommit}`,
        CORE_RELEASE.origin,
        `${artifact.manifest.receiptCommit}:${CORE_RELEASE.ref}`,
      ],
      {
        network: true,
        beforeRun: assertCopiedRepositoryStable,
      },
    );
    const fetchResult = gitResult(
      local,
      [
        ...tokenGitArgs(token),
        "fetch",
        "--no-tags",
        CORE_RELEASE.origin,
        `+${CORE_RELEASE.ref}:refs/core/readback`,
      ],
      { network: true },
    );
    if (fetchResult.status !== 0) {
      throw new ReleaseFailure(
        `record CAS returned ${pushResult.status}; authoritative Git readback failed: ${`${fetchResult.stderr ?? fetchResult.stdout ?? ""}`.trim().slice(-8_192)}`,
        { ...state, stage: "authoritative-record-readback" },
      );
    }
    const classified = phaseStep(state, "authoritative-record-classification", () =>
      classifyRecordPushReadback(local, artifact.manifest, pushResult),
    );
    state.externalStateIndeterminate = false;
    if (
      pushResult.status !== 0 &&
      classified.status === "cas-lost" &&
      classified.canonicalMainCommit === artifact.manifest.parentCommit
    ) {
      throw new ReleaseFailure(
        `record CAS was rejected while authoritative main remained P: ${`${pushResult.stderr ?? pushResult.stdout ?? ""}`.trim().slice(-8_192)}`,
        { ...state, stage: "record-CAS-rejected" },
      );
    }
    if (pushResult.status === 0 && classified.status !== "recorded") {
      throw new ReleaseFailure(
        "Git reported a successful receipt CAS but authoritative main omitted R",
        { ...state, stage: "successful-CAS-lost-R" },
      );
    }
    state.stage = "complete";
    return {
      phase: "record-push",
      ...classified,
      sourceCommit: artifact.manifest.sourceCommit,
      parentCommit: artifact.manifest.parentCommit,
      receiptCommit: artifact.manifest.receiptCommit,
      repositoryStateTouched: false,
      toolEvidence: context.toolEvidence,
    };
  });
}

export function readRecordedReceiptFromMain(context, expectedCommit, receiptCommit) {
  requireCommit(expectedCommit);
  requireCommit(receiptCommit, "receipt commit R");
  return withTemporaryDirectory("takoform-core-verify-ledger-", (directory) => {
    const repository = join(directory, "repository.git");
    gitChecked(
      context,
      ["clone", "--bare", "--no-tags", CORE_RELEASE.origin, repository],
      {
        cwd: directory,
        env: gitEnvironment(context.env, context.tools, { network: true }),
      },
    );
    const local = { ...context, repo: repository };
    const currentMain = gitChecked(local, ["rev-parse", CORE_RELEASE.ref]).trim();
    requireCommit(currentMain, "current canonical main");
    const currentHistory = gitChecked(local, [
      "rev-list",
      "--first-parent",
      currentMain,
    ])
      .trim()
      .split("\n");
    if (!currentHistory.includes(receiptCommit)) {
      throw new Error("receipt R is not on current main first-parent history");
    }
    const parents = parseParents(
      gitChecked(local, ["rev-list", "--parents", "-n", "1", receiptCommit]),
      receiptCommit,
    );
    if (parents.length !== 1) throw new Error("receipt R must have exactly one parent P");
    const parentCommit = parents[0];
    const parentHistory = gitChecked(local, [
      "rev-list",
      "--first-parent",
      parentCommit,
    ])
      .trim()
      .split("\n");
    if (!parentHistory.includes(expectedCommit)) {
      throw new Error("receipt parent P is not a first-parent descendant of source S");
    }
    assertTagAuthorityLineage(repository, expectedCommit, parentCommit);
    const sourceEntry = parseLedgerTreeEntry(
      gitChecked(local, ["ls-tree", expectedCommit, "--", CORE_RELEASE.ledger]),
      "verified source S",
    );
    const parentEntry = parseLedgerTreeEntry(
      gitChecked(local, ["ls-tree", parentCommit, "--", CORE_RELEASE.ledger]),
      "verified parent P",
    );
    const receiptEntry = parseLedgerTreeEntry(
      gitChecked(local, ["ls-tree", receiptCommit, "--", CORE_RELEASE.ledger]),
      "verified receipt R",
    );
    const currentEntry = parseLedgerTreeEntry(
      gitChecked(local, ["ls-tree", currentMain, "--", CORE_RELEASE.ledger]),
      "verified current main",
    );
    if (
      sourceEntry.blob !== parentEntry.blob ||
      receiptEntry.blob !== currentEntry.blob
    ) {
      throw new Error("verified Core ledger lineage rewrote source or receipt state");
    }
    const changed = parseNameStatus(
      gitChecked(local, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--name-status",
        "--no-renames",
        parentCommit,
        receiptCommit,
        "--",
      ]),
    );
    if (
      canonicalJSON(changed) !==
      canonicalJSON([{ status: "M", path: CORE_RELEASE.ledger }])
    ) {
      throw new Error("verified receipt P to R changes more than the ledger");
    }
    const sourceLedger = parseNormalizedLedger(
      gitChecked(local, ["show", `${expectedCommit}:${CORE_RELEASE.ledger}`]),
      "verified source S",
    );
    const receiptLedger = parseNormalizedLedger(
      gitChecked(local, ["show", `${receiptCommit}:${CORE_RELEASE.ledger}`]),
      "verified receipt R",
    );
    if (!Array.isArray(receiptLedger.releases) || receiptLedger.releases.length !== 1) {
      throw new Error("verified receipt R does not contain exactly one receipt");
    }
    const receipt = normalizeCoreReleaseReceipt(
      receiptLedger.releases[0],
      expectedCommit,
    );
    verifyCoreReleaseLedgerTransition({
      sourceLedger,
      receiptLedger,
      expectedCommit,
      receipt,
    });
    return { receipt, parentCommit, currentMain };
  });
}

export async function verifyPublishedCoreRelease(
  input,
  {
    repo,
    env = process.env,
    runner = runProcess,
    tools,
    runtimePath = process.execPath,
    runtimeVersion = process.version,
    githubRequest = defaultGitHubRequest,
    operations,
  } = {},
) {
  assertCoreReleasePhaseAuthority("verify", env);
  requireCommit(input?.expectedCommit);
  requireCommit(input?.receiptCommit, "receipt commit R");
  const context = buildContext("verify", {
    repo,
    env,
    runner,
    tools,
    runtimePath,
    runtimeVersion,
    toolNames: ["git", "sshKeygen", "go"],
  });
  const state = phaseState("verify");
  phaseStep(state, "detached-source-S", () =>
    assertDetachedSource(context, input.expectedCommit),
  );
  const recorded = phaseStep(state, "receipt-lineage", () =>
    operations?.readReceipt?.() ??
    readRecordedReceiptFromMain(
      context,
      input.expectedCommit,
      input.receiptCommit,
    ),
  );
  let tagEvidence;
  let release;
  let go;
  try {
    tagEvidence = await (operations?.readTag?.() ??
      inspectPublicRemoteTag(context, input.expectedCommit));
    release = await (operations?.readRelease?.(tagEvidence) ??
      readPublicReleaseForTag(githubRequest, input.expectedCommit, tagEvidence));
    go = await (operations?.verifyGo?.() ??
      verifyGoDistribution(context, input.expectedCommit));
  } catch (error) {
    throw new ReleaseFailure(
      `fresh-public-verification failed: ${error.message}`,
      { ...state, stage: "fresh-public-verification" },
      error,
    );
  }
  const liveReceipt = phaseStep(state, "live-receipt-reconstruction", () =>
    createCoreReleaseReceipt({
      expectedCommit: input.expectedCommit,
      tagEvidence,
      release,
      go,
    }),
  );
  if (canonicalJSON(liveReceipt) !== canonicalJSON(recorded.receipt)) {
    throw new ReleaseFailure(
      "fresh immutable public identities differ from receipt R",
      { ...state, stage: "receipt-live-equality" },
    );
  }
  state.stage = "complete";
  return {
    phase: "verify",
    status: "verified",
    sourceCommit: input.expectedCommit,
    receiptCommit: input.receiptCommit,
    parentCommit: recorded.parentCommit,
    canonicalMainCommit: recorded.currentMain,
    tagObject: tagEvidence.object,
    publicationTimeRulesetAuditDigest:
      tagEvidence.annotation.rulesetAuditDigest,
    currentBypassStateClaimed: false,
    toolEvidence: context.toolEvidence,
    repositoryStateTouched: false,
    externalStateTouched: false,
  };
}
