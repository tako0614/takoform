#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  CANDIDATE_PATH,
  E_TO_R_TRACKED_PATHS,
  N_TO_E_TRACKED_PATHS,
  PREFIX_CHAIN_PATH,
  RECORD_HEAD_PATH,
  RECORD_HEAD_PUBLIC_KEY_PATH,
  RECORD_HEAD_SIGNATURE_PATH,
  RESERVATION_TRACKED_PATHS,
  SCHEMA_LEDGER_PATH,
  SCHEMA_ROUTE,
  SOURCE_PINNED_EXECUTION_PATHS,
  SPECIFICATION_LEDGER_PATH,
  WRITER_TOOL_CLOSURE_POLICY_PATH,
  canonicalJSON,
  classifySpecificationPublicationSource,
} from "./specification-release.mjs";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[0-9a-f]{40}$/u;
const OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RUNTIME_VERSION = /^v\d+\.\d+\.\d+$/u;
const CLOUDFLARE_ID = /^[0-9a-f]{32}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0).+$/u;
const PHASES = new Set([
  "reserve",
  "apply-reservation",
  "prepare",
  "publish",
  "recover",
  "prepare-receipt",
  "record",
  "verify",
]);
const SCHEMA_CANDIDATE_FORMAT =
  "takoform.specification-schema-origin-candidate@v1";
const API_VERSION = "2026-03-10";
const MAX_HTTP_BYTES = 10 * 1024 * 1024;
const credentialValue = Symbol("Specification release credentials");
const auditCredentialValue = Symbol("Specification tag-protection audit credential");
const SENSITIVE_AUTHORITY_ENVIRONMENT = Object.freeze([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_ZONE_ID",
  "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
  "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
  "TAKOFORM_CORE_RULESET_AUDIT_TOKEN",
  "TAKOFORM_CORE_REF_WRITE_TOKEN",
  "TAKOFORM_CORE_TAG_SIGNING_KEY",
  "SSH_AUTH_SOCK",
  "GPG_AGENT_INFO",
]);

function assertPhaseAuthorityEnvironment(phase, options, env) {
  const lane = options?.lane;
  const specification = lane === "specification" || lane === "composed";
  const schema = lane === "schema" || lane === "composed";
  const allowed = new Set();
  if (phase === "prepare" && schema) {
    allowed.add("CLOUDFLARE_ACCOUNT_ID");
    allowed.add("CLOUDFLARE_ZONE_ID");
  }
  if (["publish", "recover"].includes(phase)) {
    if (specification) {
      allowed.add("GH_TOKEN");
      allowed.add("TAKOFORM_CORE_TAG_SIGNING_KEY");
      allowed.add("TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN");
    }
    if (schema) {
      allowed.add("CLOUDFLARE_API_TOKEN");
      allowed.add("CLOUDFLARE_ACCOUNT_ID");
      allowed.add("CLOUDFLARE_ZONE_ID");
    }
  }
  if (["prepare-receipt", "record"].includes(phase)) {
    allowed.add("TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN");
  }
  if (phase === "record") {
    allowed.add("TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN");
  }
  if (phase === "verify" && specification) {
    allowed.add("TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN");
  }
  for (const name of SENSITIVE_AUTHORITY_ENVIRONMENT) {
    if (!allowed.has(name) && env?.[name] !== undefined && env[name] !== "") {
      throw new Error(`${phase} refuses off-phase authority ${name}`);
    }
  }
}

export function parseSchemaToolClosurePolicy(raw) {
  let policy;
  try {
    policy = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (error) {
    throw new Error(
      `Specification schema tool-closure policy is not JSON: ${error.message}`,
    );
  }
  if (
    !exactKeys(policy, [
      "format",
      "platform",
      "architecture",
      "runtimeExecutable",
      "runtimeVersion",
      "runtimeSha256",
      "closureRoot",
      "executable",
      "wranglerVersion",
      "fileCount",
      "manifestSha256",
    ]) ||
    policy.format !== "takoform.specification-schema-tool-closure@v1" ||
    policy.platform !== process.platform ||
    policy.architecture !== process.arch ||
    !isAbsolute(policy.runtimeExecutable ?? "") ||
    !/^(?:node|nodejs)$/iu.test(basename(policy.runtimeExecutable ?? "")) ||
    !RUNTIME_VERSION.test(policy.runtimeVersion ?? "") ||
    !SHA256.test(policy.runtimeSha256 ?? "") ||
    policy.closureRoot !== "node_modules" ||
    policy.executable !== "wrangler/bin/wrangler.js" ||
    policy.wranglerVersion !== SPECIFICATION_RELEASE_ADAPTER.wranglerVersion ||
    !Number.isSafeInteger(policy.fileCount) ||
    policy.fileCount < 1 ||
    !SHA256.test(policy.manifestSha256 ?? "")
  ) {
    throw new Error(
      "Specification schema tool-closure policy does not pin this exact runtime and Wrangler closure",
    );
  }
  validateSchemaToolRuntimePolicy(policy);
  return policy;
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseTagAllowedSigner(raw) {
  const match =
    /^# fingerprint (SHA256:\S+)\n([A-Za-z0-9._-]+) namespaces="git" (ssh-ed25519) ([A-Za-z0-9+/]+={0,3})\n$/u.exec(
      Buffer.from(raw).toString("utf8"),
    );
  if (!match) throw new Error("Specification tag allowed-signers authority is invalid");
  const decoded = Buffer.from(match[4], "base64");
  if (decoded.length === 0 || decoded.toString("base64") !== match[4]) {
    throw new Error("Specification tag public key is not canonical base64");
  }
  return {
    fingerprint: match[1],
    principal: match[2],
    keyType: match[3],
    publicKey: match[4],
  };
}

function tagSigningGitConfig(privateKey) {
  if (typeof privateKey !== "string" || !isAbsolute(privateKey)) {
    throw new Error("Specification tag signing key config requires an absolute path");
  }
  return [
    "-c", "gpg.format=ssh",
    "-c", "gpg.ssh.program=ssh-keygen",
    "-c", `user.signingkey=${privateKey}`,
    "-c", "user.name=tako0614",
    "-c", "user.email=tako0614@users.noreply.github.com",
    "-c", "tag.gpgSign=true",
  ];
}

function tagVerificationGitConfig(allowedSigners) {
  if (typeof allowedSigners !== "string" || !isAbsolute(allowedSigners)) {
    throw new Error("Specification tag allowed-signers config requires an absolute path");
  }
  return [
    "-c", "gpg.format=ssh",
    "-c", "gpg.ssh.program=ssh-keygen",
    "-c", `gpg.ssh.allowedSignersFile=${allowedSigners}`,
    "-c", "gpg.minTrustLevel=fully",
  ];
}

export const SPECIFICATION_RELEASE_REVIEW = Object.freeze({
  format: "takoform.specification-release-independent-review@v1",
  reviewed: Object.freeze([
    "append-only-schema-and-source-closure",
    "create-only-signed-tag-and-immutable-release",
    "n-to-e-history-and-canonical-main",
    "schema-stage-activation-and-public-readback",
    "forward-only-recovery-and-receipt-cas",
  ]),
});

export const SPECIFICATION_RELEASE_ADAPTER = Object.freeze({
  origin: "https://github.com/tako0614/takoform.git",
  repository: "https://github.com/tako0614/takoform",
  githubRepository: "tako0614/takoform",
  branch: "main",
  worker: "takoform-schema-origin",
  route: SCHEMA_ROUTE,
  zoneName: "takoform.com",
  configPath: "schema-origin/wrangler.jsonc",
  wranglerVersion: "4.115.0",
  tagAllowedSigners: "release/authority/core-tag-allowed-signers",
  tagSignerFingerprint:
    "SHA256:C9nOGYF3q5s7QoftDP/eB7oAGtmC7fjC6UX+60/VyzE",
  tagSignerPrincipal: "takoform-core-release",
  tagSigningKeyEnvironment: "TAKOFORM_CORE_TAG_SIGNING_KEY",
  schemaTokenEnvironment: "CLOUDFLARE_API_TOKEN",
  tagProtectionAuditTokenEnvironment:
    "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
  accountEnvironment: "CLOUDFLARE_ACCOUNT_ID",
  zoneEnvironment: "CLOUDFLARE_ZONE_ID",
});

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, expected) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJSON(Object.keys(value).sort()) ===
      canonicalJSON([...expected].sort());
}

function parseCanonicalJSON(raw, label) {
  const bytes = Buffer.from(raw);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not JSON: ${error.message}`);
  }
  if (!Buffer.from(canonicalJSON(document)).equals(bytes)) {
    throw new Error(`${label} is not exact canonical JSON`);
  }
  return document;
}

function requireCommit(value, label) {
  if (!COMMIT.test(value ?? "")) {
    throw new Error(`${label} must be one full lowercase commit`);
  }
  return value;
}

function requireCloudflareID(value, label) {
  if (!CLOUDFLARE_ID.test(value ?? "")) {
    throw new Error(`${label} must be one lowercase 32-character id`);
  }
  return value;
}

function requireSecret(value, label) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.trim() !== value ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    throw new Error(`${label} is required and must be canonical`);
  }
  return value;
}

function githubRefPatternMatches(pattern, reference) {
  if (pattern === "~ALL") return true;
  if (
    typeof pattern !== "string" ||
    typeof reference !== "string" ||
    /[\[\]{}()!+@]/u.test(pattern)
  ) {
    throw new Error("GitHub ruleset contains an unsupported ref-pattern expression");
  }
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u").test(reference);
}

function relationIsInside(root, candidate) {
  const relation = relative(root, candidate);
  return relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !isAbsolute(relation));
}

function repositoryPath(repositoryRoot, relativePath) {
  if (
    typeof relativePath !== "string" ||
    !SAFE_PATH.test(relativePath)
  ) {
    throw new Error(`repository path is unsafe: ${relativePath}`);
  }
  const absolute = resolve(repositoryRoot, relativePath);
  if (!relationIsInside(repositoryRoot, absolute) || absolute === repositoryRoot) {
    throw new Error(`repository path escapes the root: ${relativePath}`);
  }
  return absolute;
}

function strictFile(repositoryRoot, relativePath) {
  const absolute = repositoryPath(repositoryRoot, relativePath);
  const status = lstatSync(absolute);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.nlink !== 1 ||
    realpathSync(absolute) !== absolute
  ) {
    throw new Error(`${relativePath} must be one ordinary repository file`);
  }
  return { absolute, bytes: readFileSync(absolute) };
}

function strictJSON(repositoryRoot, relativePath) {
  const { bytes } = strictFile(repositoryRoot, relativePath);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${relativePath} is invalid JSON: ${error.message}`);
  }
}

function installedClosureRecords(root) {
  const closureRoot = realpathSync(root);
  const records = [];
  const visit = (directory, prefix = "") => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const info = lstatSync(absolute);
      if (info.isDirectory()) {
        visit(absolute, path);
        continue;
      }
      let source = absolute;
      let sourceInfo = info;
      if (info.isSymbolicLink()) {
        source = realpathSync(absolute);
        if (!relationIsInside(closureRoot, source)) {
          throw new Error(`installed tool symlink escapes node_modules: ${path}`);
        }
        sourceInfo = statSync(source);
      }
      if (!sourceInfo.isFile()) {
        throw new Error(`installed tool closure contains a special file: ${path}`);
      }
      const bytes = readFileSync(source);
      records.push({
        path,
        sha256: digest(bytes),
        executable: (sourceInfo.mode & 0o111) !== 0,
      });
    }
  };
  visit(closureRoot);
  if (records.length === 0) {
    throw new Error("installed dependency/tool closure is empty");
  }
  return records;
}

function sealedClosureOwner(info, label) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && info.uid !== 0 && info.uid !== uid) {
    throw new Error(`${label} is not owned by root or the current user`);
  }
}

function sealedClosureRecords(root) {
  const requestedRoot = resolve(root);
  const closureRoot = realpathSync(requestedRoot);
  if (closureRoot !== requestedRoot) {
    throw new Error("sealed tool closure root must be one real directory");
  }
  const records = [];
  const visit = (directory, prefix = "") => {
    const directoryInfo = lstatSync(directory);
    if (
      directoryInfo.isSymbolicLink() ||
      !directoryInfo.isDirectory() ||
      (directoryInfo.mode & 0o7777) !== 0o555
    ) {
      throw new Error(`sealed tool closure directory is not private read-only: ${directory}`);
    }
    sealedClosureOwner(directoryInfo, `sealed tool closure directory ${directory}`);
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`sealed tool closure contains a symlink: ${path}`);
      }
      sealedClosureOwner(info, `sealed tool closure entry ${path}`);
      if (info.isDirectory()) {
        visit(absolute, path);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1) {
        throw new Error(`sealed tool closure entry is not one ordinary file: ${path}`);
      }
      const mode = info.mode & 0o7777;
      if (mode !== 0o444 && mode !== 0o555) {
        throw new Error(`sealed tool closure file is not exact read-only mode: ${path}`);
      }
      records.push({
        path,
        sha256: digest(readFileSync(absolute)),
        executable: mode === 0o555,
      });
    }
  };
  visit(closureRoot);
  if (records.length === 0) {
    throw new Error("sealed dependency/tool closure is empty");
  }
  return records;
}

function makeReadOnlyClosure(root) {
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const absolute = join(directory, name);
      const info = lstatSync(absolute);
      if (info.isDirectory()) {
        visit(absolute);
        chmodSync(absolute, 0o555);
      } else if (info.isFile()) {
        chmodSync(absolute, (info.mode & 0o111) === 0 ? 0o444 : 0o555);
      } else {
        throw new Error("sealed tool closure contains a symlink or special file");
      }
    }
  };
  visit(root);
  chmodSync(root, 0o555);
}

function copyInstalledClosure(source, destination) {
  const sourceRoot = realpathSync(source);
  const copyEntry = (sourcePath, destinationPath) => {
    const info = lstatSync(sourcePath);
    if (info.isDirectory()) {
      mkdirSync(destinationPath, { mode: info.mode & 0o777 });
      for (const name of readdirSync(sourcePath).sort()) {
        copyEntry(join(sourcePath, name), join(destinationPath, name));
      }
      return;
    }
    let filePath = sourcePath;
    let fileInfo = info;
    if (info.isSymbolicLink()) {
      filePath = realpathSync(sourcePath);
      if (!relationIsInside(sourceRoot, filePath)) {
        throw new Error(`installed tool symlink escapes node_modules: ${sourcePath}`);
      }
      fileInfo = statSync(filePath);
    }
    if (!fileInfo.isFile()) {
      throw new Error("installed tool closure contains a special file");
    }
    writeFileSync(destinationPath, readFileSync(filePath), {
      mode: fileInfo.mode & 0o777,
      flag: "wx",
    });
  };
  copyEntry(sourceRoot, destination);
}

export function sealInstalledToolClosure({ repositoryRoot, runtimeRoot }) {
  const source = resolve(repositoryRoot, "node_modules");
  if (!statSync(source).isDirectory() || realpathSync(source) !== source) {
    throw new Error("installed node_modules must be one real directory");
  }
  const before = installedClosureRecords(source);
  const destination = join(runtimeRoot, "sealed-node_modules");
  copyInstalledClosure(source, destination);
  const after = installedClosureRecords(source);
  const copied = installedClosureRecords(destination);
  if (canonicalJSON(before) !== canonicalJSON(after) ||
      canonicalJSON(before) !== canonicalJSON(copied)) {
    throw new Error("installed dependency/tool closure changed while it was sealed");
  }
  makeReadOnlyClosure(destination);
  const sealed = sealedClosureRecords(destination);
  if (canonicalJSON(sealed) !== canonicalJSON(before)) {
    throw new Error("read-only dependency/tool closure differs from its source seal");
  }
  const manifestSha256 = digest(Buffer.from(canonicalJSON(sealed)));
  const executable = resolve(destination, "wrangler/bin/wrangler.js");
  if (!lstatSync(executable).isFile()) {
    throw new Error("sealed Wrangler executable is missing");
  }
  return Object.freeze({
    root: destination,
    executable,
    manifestSha256,
    fileCount: sealed.length,
    verify() {
      const current = sealedClosureRecords(destination);
      if (digest(Buffer.from(canonicalJSON(current))) !== manifestSha256) {
        throw new Error("sealed dependency/tool closure changed before credentialed execution");
      }
    },
  });
}

function outsideRegularFile(repositoryRoot, input, label) {
  if (typeof input !== "string" || !isAbsolute(input)) {
    throw new Error(`${label} must be one absolute outside-repository path`);
  }
  const exact = resolve(input);
  const status = lstatSync(exact);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.nlink !== 1 ||
    realpathSync(exact) !== exact ||
    relationIsInside(repositoryRoot, exact)
  ) {
    throw new Error(`${label} must be one ordinary file outside the repository`);
  }
  return readFileSync(exact);
}

export function verifySpecificationReleaseIndependentReview({
  path,
  repositoryRoot,
  lanes,
  version,
  expectedDCommit,
  expectedNCommit,
  expectedECommit,
  candidateSha256,
  schemaOriginCandidateSha256,
  recovery,
}) {
  const root = realpathSync(repositoryRoot);
  const raw = outsideRegularFile(root, path, "independent review record");
  const review = parseCanonicalJSON(raw, "independent review record");
  if (
    !exactKeys(review, [
      "format",
      "approved",
      "reviewer",
      "reviewedAt",
      "lanes",
      "version",
      "expectedDCommit",
      "expectedNCommit",
      "expectedECommit",
      "candidateSha256",
      "schemaOriginCandidateSha256",
      "recovery",
      "reviewed",
    ]) ||
    review.format !== SPECIFICATION_RELEASE_REVIEW.format ||
    review.approved !== true ||
    typeof review.reviewer !== "string" ||
    review.reviewer.trim() === "" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(review.reviewedAt ?? "") ||
    Number.isNaN(Date.parse(review.reviewedAt)) ||
    new Date(review.reviewedAt).toISOString() !== review.reviewedAt.replace("Z", ".000Z") ||
    canonicalJSON(review.lanes) !== canonicalJSON(lanes) ||
    review.version !== version ||
    review.expectedDCommit !== expectedDCommit ||
    review.expectedNCommit !== expectedNCommit ||
    review.expectedECommit !== expectedECommit ||
    review.candidateSha256 !== candidateSha256 ||
    review.schemaOriginCandidateSha256 !== schemaOriginCandidateSha256 ||
    review.recovery !== recovery ||
    canonicalJSON(review.reviewed) !==
      canonicalJSON(SPECIFICATION_RELEASE_REVIEW.reviewed)
  ) {
    throw new Error("independent review record is incomplete or bound to another release");
  }
  return review;
}

function checked(runner, command, args, options = {}) {
  const result = runner(command, args, options);
  if (result?.status !== 0) {
    const detail = `${result?.stderr ?? ""}${result?.stdout ?? ""}`
      .trim()
      .slice(-8_192);
    throw new Error(
      `${command} ${args.join(" ")} exited ${result?.status ?? "unknown"}${
        detail === "" ? "" : `: ${detail}`
      }`,
    );
  }
  return Buffer.isBuffer(result.stdout)
    ? result.stdout.toString("utf8")
    : String(result.stdout ?? "");
}

function networkEnvironment(env) {
  const result = {};
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]) {
    if (typeof env[name] === "string") result[name] = env[name];
  }
  return result;
}

function redactSubprocessText(value, token) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (typeof token !== "string" || token === "") return text;
  return text.split(token).join("[REDACTED]");
}

function validatedNodeExecutable() {
  const executable = process.execPath;
  if (
    !isAbsolute(executable) ||
    !/^(?:node|nodejs)$/iu.test(basename(executable)) ||
    process.release?.name !== "node"
  ) {
    throw new Error("credentialed Wrangler execution requires an absolute Node runtime");
  }
  const info = lstatSync(executable);
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== 1 ||
    (info.mode & 0o022) !== 0 ||
    realpathSync(executable) !== executable
  ) {
    throw new Error("credentialed Wrangler runtime must be one non-writable regular Node executable");
  }
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && info.uid !== 0 && info.uid !== uid) {
    throw new Error("credentialed Wrangler runtime is not owned by root or the current user");
  }
  return executable;
}

export function validateSchemaToolRuntimePolicy(policy, { requireCurrent = false } = {}) {
  if (
    policy === null ||
    typeof policy !== "object" ||
    !isAbsolute(policy.runtimeExecutable ?? "") ||
    !/^(?:node|nodejs)$/iu.test(basename(policy.runtimeExecutable ?? "")) ||
    !RUNTIME_VERSION.test(policy.runtimeVersion ?? "") ||
    !SHA256.test(policy.runtimeSha256 ?? "")
  ) {
    throw new Error("schema tool policy does not pin one exact Node runtime");
  }
  const executable = resolve(policy.runtimeExecutable);
  const info = lstatSync(executable);
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== 1 ||
    (info.mode & 0o022) !== 0 ||
    realpathSync(executable) !== executable ||
    (uid !== null && info.uid !== 0 && info.uid !== uid) ||
    digest(readFileSync(executable)) !== policy.runtimeSha256
  ) {
    throw new Error("schema tool policy Node runtime bytes are not the pinned executable");
  }
  if (
    requireCurrent &&
    (process.execPath !== executable ||
      process.release?.name !== "node" ||
      process.version !== policy.runtimeVersion)
  ) {
    throw new Error("credentialed Wrangler execution is not running the pinned Node runtime");
  }
  return executable;
}

export function createSpecificationWranglerEnvironment({
  runtimeRoot,
  nodeModulesRoot,
  runtimeExecutable = process.execPath,
  accountId,
  token,
  outputFile,
} = {}) {
  if (typeof runtimeRoot !== "string" || !isAbsolute(runtimeRoot)) {
    throw new Error("Wrangler subprocess isolation root must be absolute");
  }
  const home = join(runtimeRoot, "wrangler-home");
  const config = join(runtimeRoot, "wrangler-config");
  const cache = join(runtimeRoot, "wrangler-cache");
  const data = join(runtimeRoot, "wrangler-data");
  const state = join(runtimeRoot, "wrangler-state");
  const temporary = join(runtimeRoot, "wrangler-tmp");
  for (const directory of [home, config, cache, data, state, temporary]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const environment = {
    PATH: `${dirname(runtimeExecutable)}:/usr/bin:/bin`,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TZ: "UTC",
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    XDG_STATE_HOME: state,
    TMPDIR: temporary,
    CI: "true",
    NO_COLOR: "1",
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  if (token !== undefined) environment.CLOUDFLARE_API_TOKEN = token;
  if (accountId !== undefined) environment.CLOUDFLARE_ACCOUNT_ID = accountId;
  if (nodeModulesRoot !== undefined) {
    if (typeof nodeModulesRoot !== "string" || !isAbsolute(nodeModulesRoot)) {
      throw new Error("sealed Wrangler module root must be absolute");
    }
    environment.NODE_PATH = nodeModulesRoot;
  }
  if (outputFile !== undefined) environment.WRANGLER_OUTPUT_FILE_PATH = outputFile;
  return environment;
}

function gitEnvironment(env, emptyConfig, extra = {}) {
  return {
    ...networkEnvironment(env),
    PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C.UTF-8",
    LC_ALL: "C",
    TZ: "UTC",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_TERMINAL_PROMPT: "0",
    ...extra,
  };
}

function signerEnvironment(env) {
  const result = {};
  for (const name of ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "TZ"]) {
    if (typeof env[name] === "string") result[name] = env[name];
  }
  result.LC_ALL = "C";
  result.TZ = "UTC";
  return result;
}

function assertNoGitOverrides(env) {
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_REPLACE_REF_BASE",
  ]) {
    if (env[name] !== undefined && env[name] !== "") {
      throw new Error(`Specification release refuses ambient ${name}`);
    }
  }
}

function parseRemoteMain(raw) {
  const lines = raw.trim() === "" ? [] : raw.trim().split("\n");
  const match = /^([0-9a-f]{40})\trefs\/heads\/main$/u.exec(lines[0] ?? "");
  if (lines.length !== 1 || !match) {
    throw new Error("fresh canonical main readback is ambiguous");
  }
  return match[1];
}

function parseNameStatus(raw) {
  if (raw === "") return [];
  return raw
    .trimEnd()
    .split("\n")
    .map((line) => {
      const fields = line.split("\t");
      if (
        fields.length !== 2 ||
        !["A", "M", "D"].includes(fields[0]) ||
        !SAFE_PATH.test(fields[1])
      ) {
        throw new Error("Git changed-path readback is ambiguous or contains a rename");
      }
      return { status: fields[0], path: fields[1] };
    });
}

function compareChanges(actual, expected, label) {
  if (canonicalJSON(actual) !== canonicalJSON(expected)) {
    throw new Error(`${label} changed paths are not exact`);
  }
}

function validateSchemaConfig(raw) {
  let config;
  try {
    config = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (error) {
    throw new Error(`schema-origin config is not strict JSON: ${error.message}`);
  }
  if (
    !exactKeys(config, [
      "$schema",
      "assets",
      "compatibility_date",
      "name",
      "preview_urls",
      "routes",
      "workers_dev",
    ]) ||
    config.name !== SPECIFICATION_RELEASE_ADAPTER.worker ||
    config.workers_dev !== false ||
    config.preview_urls !== false ||
    !Array.isArray(config.routes) ||
    config.routes.length !== 1 ||
    !exactKeys(config.routes[0], ["pattern", "zone_name"]) ||
    config.routes[0].pattern !== SPECIFICATION_RELEASE_ADAPTER.route ||
    config.routes[0].zone_name !== SPECIFICATION_RELEASE_ADAPTER.zoneName ||
    !exactKeys(config.assets, [
      "directory",
      "html_handling",
      "not_found_handling",
    ]) ||
    config.assets.directory !== "./public" ||
    config.assets.html_handling !== "none" ||
    config.assets.not_found_handling !== "none" ||
    JSON.stringify(config).includes("/v2")
  ) {
    throw new Error("schema-origin config no longer closes the sole static schema route");
  }
  return config;
}

function schemaAssetPath(entry) {
  let parsed;
  try {
    parsed = new URL(entry.id);
  } catch (error) {
    throw new Error(`schema identity is not a URL: ${error.message}`);
  }
  if (
    parsed.href !== entry.id ||
    parsed.origin !== "https://forms.takoform.com" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !/^\/schemas\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.json$/u.test(
      parsed.pathname,
    ) ||
    parsed.pathname.includes("%") ||
    parsed.pathname.split("/").includes("v2") ||
    entry.public !== `website/public${parsed.pathname}`
  ) {
    throw new Error(`schema identity/public path is not canonical: ${entry.id}`);
  }
  return parsed.pathname.slice(1);
}

function decodeCanonicalBase64(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is not base64`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error(`${label} is not canonical base64`);
  }
  return bytes;
}

function stageTag(candidateSha256) {
  if (!SHA256.test(candidateSha256 ?? "")) {
    throw new Error("schema candidate digest is invalid");
  }
  return `specification-${candidateSha256.slice("sha256:".length)}`;
}

function stageMessage(candidateSha256, releaseCandidateSha256) {
  if (!SHA256.test(releaseCandidateSha256 ?? "")) {
    throw new Error("release candidate digest is invalid");
  }
  return `Takoform Specification schema ${candidateSha256}; release ${releaseCandidateSha256}`;
}

function tagMessage(candidate, candidateRaw) {
  return [
    candidate.title,
    "",
    `Normative commit: ${candidate.normativeCommit}`,
    `Candidate: ${digest(candidateRaw)}`,
  ].join("\n");
}

function loadAllowedSigners(repositoryRoot) {
  const file = strictFile(
    repositoryRoot,
    SPECIFICATION_RELEASE_ADAPTER.tagAllowedSigners,
  );
  if ((lstatSync(file.absolute).mode & 0o022) !== 0) {
    throw new Error("tag allowed-signers authority is writable by group or other");
  }
  const parsed = parseTagAllowedSigner(file.bytes);
  if (
    parsed.fingerprint !== SPECIFICATION_RELEASE_ADAPTER.tagSignerFingerprint ||
    parsed.principal !== SPECIFICATION_RELEASE_ADAPTER.tagSignerPrincipal
  ) {
    throw new Error("Specification tag signer authority differs from its exact pin");
  }
  return { ...parsed, path: file.absolute };
}

function validateTagPrivateKey({ keyPath, repositoryRoot, runner, env, signer }) {
  if (typeof keyPath !== "string" || !isAbsolute(keyPath)) {
    throw new Error(
      `${SPECIFICATION_RELEASE_ADAPTER.tagSigningKeyEnvironment} must be an absolute path`,
    );
  }
  const status = lstatSync(keyPath);
  const exact = realpathSync(keyPath);
  if (
    status.isSymbolicLink() ||
    !status.isFile() ||
    status.nlink !== 1 ||
    exact !== resolve(keyPath) ||
    (status.mode & 0o077) !== 0 ||
    relationIsInside(repositoryRoot, exact)
  ) {
    throw new Error("Specification tag key must be one private ordinary file outside the repository");
  }
  accessSync(exact, fsConstants.R_OK);
  const derived = checked(runner, "ssh-keygen", ["-y", "-f", exact], {
    cwd: repositoryRoot,
    env: signerEnvironment(env),
  }).trim();
  const match = /^(ssh-ed25519) ([A-Za-z0-9+/]+={0,3})(?: .*)?$/u.exec(derived);
  if (!match || match[1] !== signer.keyType || match[2] !== signer.publicKey) {
    throw new Error("Specification tag key does not match the pinned public key");
  }
  const fingerprint = checked(
    runner,
    "ssh-keygen",
    ["-E", "sha256", "-lf", "-"],
    {
      cwd: repositoryRoot,
      env: signerEnvironment(env),
      input: `${match[1]} ${match[2]}\n`,
    },
  ).trim();
  if (!fingerprint.split(/\s+/u).includes(signer.fingerprint)) {
    throw new Error("Specification tag key fingerprint differs from the pin");
  }
  return exact;
}

function makeCredentials(value) {
  const result = { kind: "takoform.specification-release-credentials@v1" };
  Object.defineProperty(result, credentialValue, {
    value: Object.freeze(value),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(result);
}

function unwrapCredentials(credentials) {
  const value = credentials?.[credentialValue];
  if (!value) throw new Error("Specification release credentials are not adapter-issued");
  return value;
}

function makeAuditCredential(token) {
  const result = {
    kind: "takoform.specification-tag-protection-audit-credential@v1",
  };
  Object.defineProperty(result, auditCredentialValue, {
    value: token,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(result);
}

function unwrapAuditCredential(credential) {
  const token = credential?.[auditCredentialValue];
  if (!token) {
    throw new Error("Specification tag-protection audit credential is not adapter-issued");
  }
  return token;
}

function ensureResponseURL(response, expected, label) {
  if (response.redirected !== false || response.url !== expected) {
    throw new Error(`${label} redirected or ended at another URL`);
  }
}

async function responseBytes(response, label) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/u.test(declared) || Number(declared) > MAX_HTTP_BYTES)
  ) {
    throw new Error(`${label} has an invalid or oversized Content-Length`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_HTTP_BYTES) throw new Error(`${label} exceeds 10 MiB`);
  return bytes;
}

export function createSpecificationReleaseOperations({
  phase,
  options = {},
  repo = moduleRoot,
  env = process.env,
  runner = runProcess,
  fetchImpl = globalThis.fetch,
  readGitBlob,
  sealToolClosure = sealInstalledToolClosure,
} = {}) {
  if (!PHASES.has(phase)) {
    throw new Error("Specification release operations require one exact phase");
  }
  if (typeof repo !== "string" || !isAbsolute(repo)) {
    throw new Error("Specification release repository must be an absolute path");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Specification release requires fetch capability");
  }
  assertPhaseAuthorityEnvironment(phase, options, env);
  assertNoGitOverrides(env);
  const repositoryRoot = realpathSync(repo);
  if (!statSync(repositoryRoot).isDirectory()) {
    throw new Error("Specification release repository root is not a directory");
  }
  const runtimeRoot = mkdtempSync(join(tmpdir(), "takoform-specification-release-"));
  const emptyGitConfig = join(runtimeRoot, "empty-gitconfig");
  writeFileSync(emptyGitConfig, "", { flag: "wx", mode: 0o600 });
  const emptyWranglerEnv = join(runtimeRoot, "empty-wrangler.env");
  writeFileSync(emptyWranglerEnv, "", { flag: "wx", mode: 0o600 });
  const askpass = join(runtimeRoot, "git-askpass.sh");
  writeFileSync(
    askpass,
    "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' 'x-access-token' ;;\n  *Password*) printf '%s\\n' \"$GH_TOKEN\" ;;\n  *) exit 64 ;;\nesac\n",
    { flag: "wx", mode: 0o700 },
  );
  const refAskpass = join(runtimeRoot, "git-ref-askpass.sh");
  writeFileSync(
    refAskpass,
    "#!/bin/sh\ncase \"$1\" in\n  *Username*) printf '%s\\n' 'x-access-token' ;;\n  *Password*) printf '%s\\n' \"$TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN\" ;;\n  *) exit 64 ;;\nesac\n",
    { flag: "wx", mode: 0o700 },
  );
  const signer = loadAllowedSigners(repositoryRoot);
  const baseGitEnvironment = gitEnvironment(env, emptyGitConfig);
  const git = (args, commandOptions = {}) =>
    checked(runner, "git", args, {
      cwd: repositoryRoot,
      env: baseGitEnvironment,
      ...commandOptions,
    }).trim();
  git.raw = (args, commandOptions = {}) =>
    checked(runner, "git", args, {
      cwd: repositoryRoot,
      env: baseGitEnvironment,
      ...commandOptions,
    });
  const objectReader = readGitBlob ?? ((object) =>
    execFileSync("git", ["cat-file", "blob", object], {
      cwd: repositoryRoot,
      env: baseGitEnvironment,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }));
  let activeCredentials;
  let candidateRaw;
  let candidateDocument;
  let schemaCandidateRaw;
  let schemaCandidateDocument;
  let independentReviewVerified = false;
  let pinnedSourceRepository;
  let tagProtectionProof;
  let writerClosureProof;
  let preparedToolClosure;
  let preparedToolPolicy;

  const expectedWriterCheckpoints = () => {
    const dCommit = options.expectedDCommit;
    if (["reserve", "apply-reservation"].includes(phase)) return [dCommit];
    if (phase === "prepare") return [dCommit, options.expectedNCommit];
    return [dCommit, options.expectedNCommit, options.expectedECommit];
  };

  const expectedHead = () => {
    if (["reserve", "apply-reservation"].includes(phase)) {
      return requireCommit(options.expectedDCommit, "D commit");
    }
    if (phase === "prepare") return requireCommit(options.expectedNCommit, "N commit");
    if (["publish", "recover", "prepare-receipt", "record"].includes(phase)) {
      return requireCommit(options.expectedECommit, "E commit");
    }
    return requireCommit(options.expectedRCommit, "R commit");
  };

  const assertCleanCanonicalHead = (expectedCommit) => {
    requireCommit(expectedCommit, "expected canonical commit");
    if (git(["rev-parse", "--show-toplevel"]) !== repositoryRoot) {
      throw new Error("Specification release must run at the exact repository root");
    }
    if (git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") {
      throw new Error("Specification release requires a clean worktree including untracked files");
    }
    if (
      git(["rev-parse", "HEAD"]) !== expectedCommit ||
      git(["branch", "--show-current"]) !== SPECIFICATION_RELEASE_ADAPTER.branch ||
      git(["rev-parse", "--is-shallow-repository"]) !== "false" ||
      git(["replace", "-l"]) !== "" ||
      git(["remote", "get-url", "origin"]) !== SPECIFICATION_RELEASE_ADAPTER.origin
    ) {
      throw new Error("local Git authority differs from clean attached non-shallow canonical main");
    }
    const common = git(["rev-parse", "--git-common-dir"]);
    const alternates = resolve(repositoryRoot, common, "objects/info/alternates");
    if (existsSync(alternates)) {
      throw new Error("Specification release refuses Git object alternates");
    }
    const remoteMain = parseRemoteMain(
      git([
        "ls-remote",
        "--exit-code",
        SPECIFICATION_RELEASE_ADAPTER.origin,
        "refs/heads/main",
      ]),
    );
    if (remoteMain !== expectedCommit) {
      throw new Error("HEAD and fresh canonical main differ from the exact expected commit");
    }
  };

  const transition = (fromCommit, toCommit, expectedChanges, label) => {
    const ancestry = git(["rev-list", "--parents", "-n", "1", toCommit]).split(/\s+/u);
    if (
      ancestry[0] !== toCommit ||
      ancestry.length !== 2 ||
      ancestry[1] !== fromCommit
    ) {
      throw new Error(`${label} must be one direct single-parent edge`);
    }
    const changes = parseNameStatus(
      checked(runner, "git", [
        "diff",
        "--name-status",
        "--no-renames",
        fromCommit,
        toCommit,
        "--",
      ], { cwd: repositoryRoot, env: baseGitEnvironment }),
    );
    compareChanges(changes, expectedChanges, label);
    return {
      fromCommit,
      toCommit,
      parents: [fromCommit],
      changedPaths: changes.map(({ path }) => path),
    };
  };

  const readStateFiles = () => ({
    specificationLedger: strictJSON(repositoryRoot, SPECIFICATION_LEDGER_PATH),
    schemaLedger: strictJSON(repositoryRoot, SCHEMA_LEDGER_PATH),
    prefixChain: strictJSON(repositoryRoot, PREFIX_CHAIN_PATH),
    recordHeadRaw: strictFile(repositoryRoot, RECORD_HEAD_PATH).bytes,
    recordHeadSignature: strictJSON(repositoryRoot, RECORD_HEAD_SIGNATURE_PATH),
    recordHeadPublicKeyPEM: strictFile(
      repositoryRoot,
      RECORD_HEAD_PUBLIC_KEY_PATH,
    ).bytes.toString("utf8"),
  });

  const cacheCandidate = (raw) => {
    candidateRaw = Buffer.from(raw);
    candidateDocument = parseCanonicalJSON(
      candidateRaw,
      "Specification release candidate",
    );
    return candidateRaw;
  };

  const readEvidenceState = () => {
    const head = expectedHead();
    assertCleanCanonicalHead(head);
    const state = readStateFiles();
    const raw = cacheCandidate(strictFile(repositoryRoot, CANDIDATE_PATH).bytes);
    const evidenceTransition = transition(
      requireCommit(options.expectedNCommit, "N commit"),
      requireCommit(options.expectedECommit, "E commit"),
      [{ status: "A", path: CANDIDATE_PATH }],
      "N to E evidence",
    );
    return {
      ...state,
      candidateRaw: raw,
      headCommit: head,
      evidenceTransition,
    };
  };

  const verifyCandidateContext = () => {
    if (!candidateDocument || !candidateRaw) {
      cacheCandidate(strictFile(repositoryRoot, CANDIDATE_PATH).bytes);
    }
    if (
      candidateDocument.version !== (options.version ?? null) ||
      candidateDocument.canonicalCommit !== options.expectedDCommit ||
      candidateDocument.normativeCommit !== options.expectedDCommit ||
      candidateDocument.reservationCommit !== options.expectedNCommit ||
      (candidateDocument.lanes?.specification === true &&
        candidateDocument.tag !== `specification/${options.version}`)
    ) {
      throw new Error("adapter candidate cache differs from the exact release inputs");
    }
    return { candidate: candidateDocument, raw: candidateRaw };
  };

  const parseSchemaCandidate = (raw, expectedDigest) => {
    const bytes = Buffer.from(raw);
    if (digest(bytes) !== expectedDigest) {
      throw new Error("schema-origin candidate bytes differ from their exact digest");
    }
    const document = parseCanonicalJSON(bytes, "schema-origin candidate");
    if (
      !exactKeys(document, [
        "format",
        "sourceCommit",
        "worker",
        "route",
        "target",
        "wrangler",
        "schemaSeal",
        "assets",
        "retired404",
      ]) ||
      document.format !== SCHEMA_CANDIDATE_FORMAT ||
      document.sourceCommit !== options.expectedNCommit ||
      document.worker !== SPECIFICATION_RELEASE_ADAPTER.worker ||
      document.route !== SPECIFICATION_RELEASE_ADAPTER.route ||
      !exactKeys(document.target, ["accountId", "zoneId", "zoneName"]) ||
      !CLOUDFLARE_ID.test(document.target.accountId ?? "") ||
      !CLOUDFLARE_ID.test(document.target.zoneId ?? "") ||
      document.target.zoneName !== SPECIFICATION_RELEASE_ADAPTER.zoneName ||
      !exactKeys(document.wrangler, ["version", "configPath", "configSha256"]) ||
      document.wrangler.version !== SPECIFICATION_RELEASE_ADAPTER.wranglerVersion ||
      document.wrangler.configPath !== SPECIFICATION_RELEASE_ADAPTER.configPath ||
      !SHA256.test(document.wrangler.configSha256 ?? "") ||
      !exactKeys(document.schemaSeal, ["sequence", "entrySha256"]) ||
      !Number.isSafeInteger(document.schemaSeal.sequence) ||
      !SHA256.test(document.schemaSeal.entrySha256 ?? "") ||
      !Array.isArray(document.assets) ||
      document.assets.length === 0 ||
      !Array.isArray(document.retired404)
    ) {
      throw new Error("schema-origin candidate has an invalid closed envelope");
    }
    const config = strictFile(repositoryRoot, SPECIFICATION_RELEASE_ADAPTER.configPath);
    validateSchemaConfig(config.bytes);
    if (digest(config.bytes) !== document.wrangler.configSha256) {
      throw new Error("schema-origin config differs from the prepared candidate");
    }
    const seen = new Set();
    const sorted = [];
    for (const asset of document.assets) {
      if (
        !exactKeys(asset, ["url", "path", "source", "sha256", "bytesBase64"]) ||
        typeof asset.url !== "string" ||
        typeof asset.path !== "string" ||
        typeof asset.source !== "string" ||
        !SHA256.test(asset.sha256 ?? "") ||
        !SAFE_PATH.test(asset.path) ||
        seen.has(asset.path)
      ) {
        throw new Error("schema-origin candidate contains an invalid or duplicate asset");
      }
      const entry = {
        id: asset.url,
        public: `website/public/${asset.path}`,
      };
      if (schemaAssetPath(entry) !== asset.path) {
        throw new Error("schema-origin asset path differs from its URL");
      }
      const assetBytes = decodeCanonicalBase64(asset.bytesBase64, asset.path);
      if (digest(assetBytes) !== asset.sha256) {
        throw new Error(`schema-origin asset digest differs for ${asset.path}`);
      }
      let schema;
      try {
        schema = JSON.parse(assetBytes.toString("utf8"));
      } catch (error) {
        throw new Error(`schema-origin asset ${asset.path} is not JSON: ${error.message}`);
      }
      if (schema.$id !== asset.url) {
        throw new Error(`schema-origin asset $id differs for ${asset.path}`);
      }
      seen.add(asset.path);
      sorted.push(asset.url);
    }
    if (canonicalJSON(sorted) !== canonicalJSON([...sorted].sort())) {
      throw new Error("schema-origin candidate assets are not sorted by URL");
    }
    for (const retired of document.retired404) {
      if (
        !exactKeys(retired, ["url", "sha256"]) ||
        typeof retired.url !== "string" ||
        !SHA256.test(retired.sha256 ?? "") ||
        retired.url.includes("/v2")
      ) {
        throw new Error("schema-origin candidate contains an invalid retired identity");
      }
    }
    schemaCandidateRaw = bytes;
    schemaCandidateDocument = document;
    return document;
  };

  const activeCredential = () => {
    if (!activeCredentials) {
      throw new Error("schema/GitHub operation ran before explicit credential acquisition");
    }
    return activeCredentials;
  };

  const wranglerExecutable = () => {
    if (!preparedToolClosure) {
      throw new Error("Wrangler cannot execute before the credential-free sealed tool phase");
    }
    preparedToolClosure.verify();
    const metadataPath = resolve(
      preparedToolClosure.root,
      "wrangler/package.json",
    );
    const metadata = { bytes: readFileSync(metadataPath) };
    let packageDocument;
    try {
      packageDocument = JSON.parse(metadata.bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`installed Wrangler metadata is invalid: ${error.message}`);
    }
    if (packageDocument.version !== SPECIFICATION_RELEASE_ADAPTER.wranglerVersion) {
      throw new Error(
        `local Wrangler must be exactly ${SPECIFICATION_RELEASE_ADAPTER.wranglerVersion}`,
      );
    }
    const executable = preparedToolClosure.executable;
    const resolvedExecutable = realpathSync(executable);
    const packageRoot = resolve(preparedToolClosure.root, "wrangler");
    if (
      !relationIsInside(packageRoot, resolvedExecutable) ||
      !lstatSync(resolvedExecutable).isFile()
    ) {
      throw new Error("Wrangler executable is not owned by the pinned local package");
    }
    return executable;
  };

  const wranglerEnvironment = (credentials, outputFile, runtimeExecutable = process.execPath) => {
    return createSpecificationWranglerEnvironment({
      runtimeRoot,
      nodeModulesRoot: preparedToolClosure.root,
      runtimeExecutable,
      accountId: schemaCandidateDocument.target.accountId,
      token: credentials.cloudflareToken,
      outputFile,
    });
  };

  const runWrangler = (args, { machine = false } = {}) => {
    const executable = wranglerExecutable();
    const runtimeExecutable = runner === runProcess
      ? validatedNodeExecutable()
      : process.execPath;
    if (preparedToolPolicy !== undefined) {
      validateSchemaToolRuntimePolicy(preparedToolPolicy, {
        requireCurrent: runner === runProcess,
      });
    }
    const credentials = activeCredential();
    const callRoot = mkdtempSync(join(runtimeRoot, "wrangler-"));
    const outputFile = join(callRoot, "output.jsonl");
    if (machine) writeFileSync(outputFile, "", { flag: "wx", mode: 0o600 });
    // Re-close the copied dependency bytes and pinned runtime immediately
    // before spawning, catching a same-byte mode/owner/link race after the
    // pre-credential check above.
    preparedToolClosure.verify();
    if (preparedToolPolicy !== undefined) {
      validateSchemaToolRuntimePolicy(preparedToolPolicy, {
        requireCurrent: runner === runProcess,
      });
    }
    let result;
    try {
      result = runner(
        runtimeExecutable,
        [executable, ...args, "--env-file", emptyWranglerEnv],
        {
          cwd: repositoryRoot,
          env: wranglerEnvironment(
            credentials,
            machine ? outputFile : undefined,
            runtimeExecutable,
          ),
        },
      );
    } catch (error) {
      const detail = redactSubprocessText(error?.message ?? String(error), credentials.cloudflareToken);
      throw new Error(`pinned Wrangler operation failed (${detail})`, { cause: error });
    }
    if (result?.status !== 0) {
      const detail = redactSubprocessText(
        String(result?.stderr ?? result?.stdout ?? "").trim().slice(-8_192),
        credentials.cloudflareToken,
      );
      throw new Error(
        `pinned Wrangler operation failed (${detail})`,
      );
    }
    if (!machine) return null;
    const rawOutput = readFileSync(outputFile, "utf8");
    if (rawOutput.includes(credentials.cloudflareToken)) {
      throw new Error("pinned Wrangler machine output contained the API token");
    }
    const lines = rawOutput
      .split("\n")
      .filter((line) => line !== "");
    if (lines.length === 0) {
      throw new Error("pinned Wrangler machine output is missing or ambiguous");
    }
    try {
      const documents = lines.map((line) => JSON.parse(line));
      const sessions = documents.filter((document) => document?.type === "wrangler-session");
      const outputs = documents.filter((document) => document?.type !== "wrangler-session");
      if (
        sessions.length > 1 ||
        sessions.some((session) => session.wrangler_version !== SPECIFICATION_RELEASE_ADAPTER.wranglerVersion) ||
        outputs.length !== 1
      ) {
        throw new Error("pinned Wrangler machine output is missing or ambiguous");
      }
      return outputs[0];
    } catch (error) {
      throw new Error(`pinned Wrangler machine output is not JSON: ${error.message}`);
    }
  };

  const cloudflareRequest = async (apiPath, { allow404 = false } = {}) => {
    const credentials = activeCredential();
    const url = `https://api.cloudflare.com/client/v4${apiPath}`;
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${credentials.cloudflareToken}`,
      },
    });
    ensureResponseURL(response, url, "Cloudflare API readback");
    if (allow404 && response.status === 404) return { notFound: true };
    const bytes = await responseBytes(response, "Cloudflare API readback");
    let body;
    try {
      body = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`Cloudflare API returned invalid JSON: ${error.message}`);
    }
    if (
      !response.ok ||
      body?.success !== true ||
      !Array.isArray(body?.errors) ||
      body.errors.length !== 0
    ) {
      throw new Error(`Cloudflare API readback failed with HTTP ${response.status}`);
    }
    return { body, result: body.result };
  };

  const listVersions = async () => {
    const account = schemaCandidateDocument.target.accountId;
    const collected = [];
    for (let page = 1; page <= 100; page += 1) {
      const response = await cloudflareRequest(
        `/accounts/${encodeURIComponent(account)}/workers/scripts/${SPECIFICATION_RELEASE_ADAPTER.worker}/versions?page=${page}&per_page=100`,
        { allow404: true },
      );
      if (response.notFound) return [];
      const items = Array.isArray(response.result)
        ? response.result
        : response.result?.items;
      if (!Array.isArray(items)) {
        throw new Error("Cloudflare version inventory has an unknown shape");
      }
      collected.push(...items);
      const pages = response.body.result_info?.total_pages ?? 1;
      if (!Number.isSafeInteger(pages) || pages < 1 || pages > 100) {
        throw new Error("Cloudflare version pagination is invalid");
      }
      if (page >= pages) return collected;
    }
    throw new Error("Cloudflare version inventory exceeded the closed pagination bound");
  };

  const listDeployments = async () => {
    const account = schemaCandidateDocument.target.accountId;
    const response = await cloudflareRequest(
      `/accounts/${encodeURIComponent(account)}/workers/scripts/${SPECIFICATION_RELEASE_ADAPTER.worker}/deployments`,
    );
    const deployments = Array.isArray(response.result)
      ? response.result
      : response.result?.deployments;
    if (!Array.isArray(deployments)) {
      throw new Error("Cloudflare deployment inventory has an unknown shape");
    }
    return deployments;
  };

  const releaseCandidateDigest = () => digest(verifyCandidateContext().raw);
  const assertExactVersion = (version, candidateSha256) => {
    const expectedTag = stageTag(candidateSha256);
    const expectedMessage = stageMessage(candidateSha256, releaseCandidateDigest());
    if (
      !UUID.test(version?.id ?? "") ||
      version?.annotations?.["workers/tag"] !== expectedTag ||
      version?.annotations?.["workers/message"] !== expectedMessage
    ) {
      throw new Error("Cloudflare staged version does not carry the exact candidate annotations");
    }
    return version;
  };

  const readStage = async (candidateSha256) => {
    const expectedTag = stageTag(candidateSha256);
    const matches = (await listVersions()).filter(
      (version) => version?.annotations?.["workers/tag"] === expectedTag,
    );
    if (matches.length === 0) {
      return { status: 404, candidateSha256 };
    }
    if (matches.length !== 1) {
      throw new Error("schema-origin stage identity is duplicated or ambiguous");
    }
    const version = assertExactVersion(matches[0], candidateSha256);
    return {
      status: 200,
      candidateSha256,
      stageID: version.id,
      exact: true,
    };
  };

  const assertExactRoute = async () => {
    const zone = schemaCandidateDocument.target.zoneId;
    const response = await cloudflareRequest(
      `/zones/${encodeURIComponent(zone)}/workers/routes`,
    );
    if (!Array.isArray(response.result)) {
      throw new Error("Cloudflare route inventory has an unknown shape");
    }
    const matches = response.result.filter(
      (route) => route?.pattern === SPECIFICATION_RELEASE_ADAPTER.route,
    );
    if (
      matches.length !== 1 ||
      matches[0]?.script !== SPECIFICATION_RELEASE_ADAPTER.worker ||
      typeof matches[0]?.id !== "string" ||
      matches[0].id === ""
    ) {
      throw new Error("the sole Specification schema route is absent, duplicated, or owned elsewhere");
    }
    return matches[0];
  };

  const currentDeploymentFor = async (stageID) => {
    const deployments = await listDeployments();
    const current = deployments[0];
    const versions = current?.versions;
    if (!current || !Array.isArray(versions)) return null;
    if (
      versions.length === 1 &&
      versions[0]?.version_id === stageID &&
      versions[0]?.percentage === 100
    ) {
      return current;
    }
    return null;
  };

  const publicGitHubJSON = async (endpoint, { allow404 = false } = {}) => {
    const url = `https://api.github.com/${endpoint}`;
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "takoform-specification-release-verifier",
      },
    });
    ensureResponseURL(response, url, "public GitHub API readback");
    if (allow404 && response.status === 404) return { status: 404 };
    const bytes = await responseBytes(response, "public GitHub API readback");
    if (!response.ok) {
      throw new Error(`public GitHub API returned HTTP ${response.status}`);
    }
    try {
      return { status: response.status, body: JSON.parse(bytes.toString("utf8")) };
    } catch (error) {
      throw new Error(`public GitHub API returned invalid JSON: ${error.message}`);
    }
  };

  const auditGitHubJSON = async (endpoint, auditCredential) => {
    const token = unwrapAuditCredential(auditCredential);
    const url = `https://api.github.com/${endpoint}`;
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "takoform-specification-tag-protection-auditor",
      },
    });
    ensureResponseURL(response, url, "GitHub tag-protection audit");
    const bytes = await responseBytes(response, "GitHub tag-protection audit");
    if (!response.ok) {
      throw new Error(`GitHub tag-protection audit returned HTTP ${response.status}`);
    }
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`GitHub tag-protection audit returned invalid JSON: ${error.message}`);
    }
  };

  const exactTagProtectionRuleset = async ({ tag, expectedPattern, auditToken }) => {
    const exactReference = `refs/tags/${tag}`;
    const summaries = [];
    for (let page = 1; page <= 10; page += 1) {
      const batch = await auditGitHubJSON(
        `repos/${SPECIFICATION_RELEASE_ADAPTER.githubRepository}/rulesets?includes_parents=true&per_page=100&page=${page}`,
        auditToken,
      );
      if (!Array.isArray(batch)) {
        throw new Error("GitHub ruleset inventory is not an array");
      }
      summaries.push(...batch);
      if (batch.length < 100) break;
      if (page === 10) throw new Error("GitHub ruleset inventory exceeded the closed bound");
    }
    const applicable = [];
    for (const summary of summaries) {
      if (
        !Number.isSafeInteger(summary?.id) ||
        summary.id < 1 ||
        typeof summary.target !== "string" ||
        typeof summary.enforcement !== "string"
      ) {
        throw new Error("GitHub ruleset inventory omitted an authority field");
      }
      if (summary.target !== "tag" || summary.enforcement !== "active") continue;
      const detail = await auditGitHubJSON(
        `repos/${SPECIFICATION_RELEASE_ADAPTER.githubRepository}/rulesets/${summary.id}`,
        auditToken,
      );
      for (const field of [
        "id",
        "target",
        "enforcement",
        "bypass_actors",
        "conditions",
        "rules",
      ]) {
        if (!Object.hasOwn(detail ?? {}, field)) {
          throw new Error(`GitHub ruleset detail omitted ${field}`);
        }
      }
      if (
        detail.id !== summary.id ||
        detail.target !== "tag" ||
        detail.enforcement !== "active" ||
        !Array.isArray(detail.bypass_actors) ||
        !exactKeys(detail.conditions, ["ref_name"]) ||
        !exactKeys(detail.conditions.ref_name, ["include", "exclude"]) ||
        !Array.isArray(detail.conditions.ref_name.include) ||
        !Array.isArray(detail.conditions.ref_name.exclude) ||
        !Array.isArray(detail.rules)
      ) {
        throw new Error("GitHub active tag ruleset has an unknown authority envelope");
      }
      const applies = detail.conditions.ref_name.include.some((pattern) =>
        githubRefPatternMatches(pattern, exactReference)
      ) && !detail.conditions.ref_name.exclude.some((pattern) =>
        githubRefPatternMatches(pattern, exactReference)
      );
      if (applies) applicable.push(detail);
    }
    if (applicable.length !== 1) {
      throw new Error("the exact tag is not governed by one sole active tag ruleset");
    }
    const ruleset = applicable[0];
    const rulesByType = new Map();
    for (const rule of ruleset.rules) {
      if (
        rule === null ||
        typeof rule !== "object" ||
        Array.isArray(rule) ||
        typeof rule.type !== "string" ||
        rulesByType.has(rule.type)
      ) {
        throw new Error("GitHub tag ruleset contains an invalid or duplicate rule");
      }
      rulesByType.set(rule.type, rule);
    }
    const deletion = rulesByType.get("deletion");
    const update = rulesByType.get("update");
    if (
      ruleset.bypass_actors.length !== 0 ||
      canonicalJSON(ruleset.conditions.ref_name.include) !==
        canonicalJSON([expectedPattern]) ||
      ruleset.conditions.ref_name.exclude.length !== 0 ||
      canonicalJSON([...rulesByType.keys()].sort()) !==
        canonicalJSON(["deletion", "update"]) ||
      !exactKeys(deletion, ["type"]) ||
      !exactKeys(update, ["type"])
    ) {
      throw new Error("GitHub tag ruleset is broader, bypassable, or has missing/extra rules");
    }
    return {
      id: ruleset.id,
      target: "tag",
      enforcement: "active",
      bypassActors: [],
      include: [expectedPattern],
      exclude: [],
      rules: ["deletion", "update"],
    };
  };

  const consumeTagProtectionProof = (tag, operation) => {
    if (
      tagProtectionProof?.tag !== tag ||
      canonicalJSON(tagProtectionProof?.normalized) !== canonicalJSON({
        id: tagProtectionProof?.normalized?.id,
        target: "tag",
        enforcement: "active",
        bypassActors: [],
        include: ["refs/tags/specification/*"],
        exclude: [],
        rules: ["deletion", "update"],
      })
    ) {
      throw new Error(`${operation} requires an immediately preceding exact tag-protection audit`);
    }
    const proof = tagProtectionProof;
    tagProtectionProof = undefined;
    return proof;
  };

  const refreshTagProtectionProof = async (proof, tag, operation) => {
    const normalized = await exactTagProtectionRuleset({
      tag,
      expectedPattern: "refs/tags/specification/*",
      auditToken: proof.auditToken,
    });
    if (canonicalJSON(normalized) !== canonicalJSON(proof.normalized)) {
      throw new Error(`${operation} tag-protection ruleset changed at the final fence`);
    }
    return normalized;
  };

  const authenticatedGitHub = async (method, endpoint, body) => {
    if (!["GET", "POST"].includes(method)) {
      throw new Error("Specification release GitHub writer permits only GET and create POST");
    }
    const credentials = activeCredential();
    const url = `https://api.github.com/${endpoint}`;
    const response = await fetchImpl(url, {
      method,
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${credentials.githubToken}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "takoform-specification-release-writer",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: canonicalJSON(body) }),
    });
    ensureResponseURL(response, url, "authenticated GitHub API operation");
    const bytes = await responseBytes(response, "authenticated GitHub API operation");
    if (!response.ok) {
      throw new Error(`GitHub API ${method} ${endpoint} returned HTTP ${response.status}`);
    }
    if (bytes.length === 0) return null;
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`GitHub API returned invalid JSON: ${error.message}`);
    }
  };

  const expectedRelease = () => {
    const cached = verifyCandidateContext();
    if (
      !exactKeys(cached.candidate.githubRelease, [
        "body",
        "draft",
        "prerelease",
        "immutable",
        "assets",
      ]) ||
      typeof cached.candidate.githubRelease.body !== "string" ||
      cached.candidate.githubRelease.draft !== false ||
      cached.candidate.githubRelease.prerelease !== false ||
      cached.candidate.githubRelease.immutable !== true ||
      canonicalJSON(cached.candidate.githubRelease.assets) !== canonicalJSON([])
    ) {
      throw new Error("candidate does not contain the exact direct asset-free Release identity");
    }
    return {
      tag: cached.candidate.tag,
      title: cached.candidate.title,
      body: cached.candidate.githubRelease?.body,
      target: options.expectedECommit,
    };
  };

  const validateReleaseIdentity = (release, expected) => {
    if (
      !Number.isSafeInteger(release?.id) ||
      release.id < 1 ||
      release.tag_name !== expected.tag ||
      release.name !== expected.title ||
      release.body !== expected.body ||
      release.html_url !==
        `${SPECIFICATION_RELEASE_ADAPTER.repository}/releases/tag/${expected.tag}` ||
      release.draft !== false ||
      release.prerelease !== false ||
      release.immutable !== true ||
      !Array.isArray(release.assets) ||
      release.assets.length !== 0
    ) {
      throw new Error("GitHub Specification Release identity differs from the exact candidate");
    }
    return release;
  };

  const immutableReleasesEnabled = async () => {
    const status = await authenticatedGitHub(
      "GET",
      `repos/${SPECIFICATION_RELEASE_ADAPTER.githubRepository}/immutable-releases`,
    );
    if (status?.enabled !== true) {
      throw new Error("GitHub immutable releases must already be enabled");
    }
  };

  const authenticatedReleaseByTag = async (tag) => {
    const matches = [];
    for (let page = 1; page <= 10; page += 1) {
      const releases = await authenticatedGitHub(
        "GET",
        `repos/${SPECIFICATION_RELEASE_ADAPTER.githubRepository}/releases?per_page=100&page=${page}`,
      );
      if (!Array.isArray(releases)) {
        throw new Error("GitHub Release inventory is not an array");
      }
      matches.push(...releases.filter((release) => release?.tag_name === tag));
      if (releases.length < 100) break;
      if (page === 10) throw new Error("GitHub Release inventory exceeded the closed bound");
    }
    if (matches.length > 1) throw new Error("GitHub Release identity is duplicated");
    return matches[0] ?? null;
  };

  const inspectTagObject = ({ directory, tag, object, expectedCommit }) => {
    if (!OBJECT.test(object ?? "")) throw new Error("tag object id is invalid");
    const environment = gitEnvironment(env, emptyGitConfig);
    const localGit = (args) =>
      checked(runner, "git", args, { cwd: directory, env: environment }).trim();
    if (localGit(["cat-file", "-t", object]) !== "tag") {
      throw new Error("Specification release tag is not annotated");
    }
    if (localGit(["rev-list", "-n", "1", object]) !== expectedCommit) {
      throw new Error("Specification release tag peels to another commit");
    }
    const raw = checked(runner, "git", ["cat-file", "-p", object], {
      cwd: directory,
      env: environment,
    });
    if (raw.includes("\r")) throw new Error("Specification tag object is not canonical text");
    const split = raw.indexOf("\n\n");
    const headers = split < 0 ? [] : raw.slice(0, split).split("\n");
    const expected = verifyCandidateContext();
    const expectedMessage = `${tagMessage(expected.candidate, expected.raw)}\n`;
    const contents = split < 0 ? "" : raw.slice(split + 2);
    const signatureMarker = "-----BEGIN SSH SIGNATURE-----\n";
    const signatureOffset = contents.indexOf(signatureMarker);
    if (
      headers.length !== 4 ||
      headers[0] !== `object ${expectedCommit}` ||
      headers[1] !== "type commit" ||
      headers[2] !== `tag ${tag}` ||
      !/^tagger .+ <[^<>\n]+> [1-9][0-9]* [+-][0-9]{4}$/u.test(headers[3]) ||
      signatureOffset < 0 ||
      contents.slice(0, signatureOffset) !== expectedMessage ||
      !/^-----BEGIN SSH SIGNATURE-----\n(?:[A-Za-z0-9+/]+={0,2}\n)+-----END SSH SIGNATURE-----\n$/u.test(
        contents.slice(signatureOffset),
      )
    ) {
      throw new Error("Specification release tag object differs from the exact signed annotation");
    }
    localGit([
      ...tagVerificationGitConfig(signer.path),
      "verify-tag",
      object,
    ]);
    return object;
  };

  const readRemoteTag = (tag) => {
    const raw = git([
      "ls-remote",
      "--tags",
      SPECIFICATION_RELEASE_ADAPTER.origin,
      `refs/tags/${tag}`,
      `refs/tags/${tag}^{}`,
    ]);
    if (raw === "") return { status: 404, tag };
    const refs = new Map();
    for (const line of raw.split("\n")) {
      const match = /^([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(line);
      if (!match || refs.has(match[2])) {
        throw new Error("remote Specification tag readback is ambiguous");
      }
      refs.set(match[2], match[1]);
    }
    if (
      refs.size !== 2 ||
      !refs.has(`refs/tags/${tag}`) ||
      !refs.has(`refs/tags/${tag}^{}`)
    ) {
      throw new Error("remote Specification tag is lightweight, partial, or ambiguous");
    }
    const directory = mkdtempSync(join(runtimeRoot, "tag-readback-"));
    const environment = gitEnvironment(env, emptyGitConfig);
    checked(runner, "git", ["init", "--quiet"], { cwd: directory, env: environment });
    checked(
      runner,
      "git",
      ["remote", "add", "origin", SPECIFICATION_RELEASE_ADAPTER.origin],
      { cwd: directory, env: environment },
    );
    checked(
      runner,
      "git",
      ["fetch", "--no-tags", "origin", `refs/tags/${tag}:refs/tags/${tag}`],
      { cwd: directory, env: environment },
    );
    const object = checked(runner, "git", ["rev-parse", `refs/tags/${tag}`], {
      cwd: directory,
      env: environment,
    }).trim();
    const target = checked(
      runner,
      "git",
      ["rev-list", "-n", "1", `refs/tags/${tag}`],
      { cwd: directory, env: environment },
    ).trim();
    if (
      object !== refs.get(`refs/tags/${tag}`) ||
      target !== refs.get(`refs/tags/${tag}^{}`)
    ) {
      throw new Error("freshly fetched Specification tag differs from ls-remote");
    }
    inspectTagObject({
      directory,
      tag,
      object,
      expectedCommit: options.expectedECommit,
    });
    return {
      status: 200,
      tag,
      targetCommit: target,
      tagObject: object,
      annotated: true,
      signed: true,
      signatureVerified: true,
    };
  };

  const freshCanonicalRepository = () => {
    const directory = mkdtempSync(join(runtimeRoot, "canonical-main-"));
    const environment = gitEnvironment(env, emptyGitConfig);
    const localGit = (args, commandOptions = {}) =>
      checked(runner, "git", args, {
        cwd: directory,
        env: environment,
        ...commandOptions,
      }).trim();
    localGit.raw = (args, commandOptions = {}) =>
      checked(runner, "git", args, {
        cwd: directory,
        env: environment,
        ...commandOptions,
      });
    localGit(["init", "--quiet"]);
    localGit(["remote", "add", "origin", SPECIFICATION_RELEASE_ADAPTER.origin]);
    const main = parseRemoteMain(localGit([
      "ls-remote",
      "--exit-code",
      SPECIFICATION_RELEASE_ADAPTER.origin,
      "refs/heads/main",
    ]));
    localGit([
      "fetch",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ]);
    if (localGit(["rev-parse", "refs/remotes/origin/main"]) !== main) {
      throw new Error("fresh canonical-main fetch differs from ls-remote");
    }
    return { directory, environment, localGit, main };
  };

  const firstParentHistory = (localGit, commit) => {
    requireCommit(commit, "first-parent history commit");
    const values = localGit(["rev-list", "--first-parent", commit])
      .split("\n")
      .filter(Boolean);
    if (values.length === 0 || values[0] !== commit || values.some((value) => !COMMIT.test(value))) {
      throw new Error("first-parent history readback is invalid");
    }
    return values;
  };

  const recordsAt = (localGit, commit, paths) => {
    const records = {};
    for (const path of paths) {
      const objectId = localGit(["rev-parse", `${commit}:${path}`]);
      if (!OBJECT.test(objectId)) {
        throw new Error(`Git blob identity is invalid for ${path}`);
      }
      if (localGit(["cat-file", "-t", objectId]) !== "blob") {
        throw new Error(`receipt record ${path} is not a Git blob`);
      }
      const bytes = Buffer.from(localGit.raw(["cat-file", "blob", objectId]));
      records[path] = { objectId, sha256: digest(bytes) };
    }
    return records;
  };

  const blobAt = (localGit, commit, path) => {
    if (!SAFE_PATH.test(path)) throw new Error(`unsafe Git path ${path}`);
    const objectId = localGit(["rev-parse", `${commit}:${path}`]);
    if (!OBJECT.test(objectId) || localGit(["cat-file", "-t", objectId]) !== "blob") {
      throw new Error(`Git source ${commit}:${path} is not one exact blob`);
    }
    return Buffer.from(localGit.raw(["cat-file", "blob", objectId]));
  };

  const specificationSourceSnapshotAt = (
    localGit,
    commit,
    readObject = (object) => localGit.raw(["cat-file", "blob", object]),
  ) => {
    requireCommit(commit, "Specification source commit");
    const rawTree = localGit.raw([
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      commit,
      "--",
      "spec",
    ]);
    const files = [];
    for (const record of rawTree.split("\0").filter(Boolean)) {
      const match = /^(100644|100755) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(record);
      if (!match || !match[3].startsWith("spec/") || !SAFE_PATH.test(match[3])) {
        throw new Error("Specification tree contains a non-blob or unsafe path");
      }
      const bytes = Buffer.from(readObject(match[2]));
      files.push({
        path: match[3],
        sha256: digest(bytes),
        classification: classifySpecificationPublicationSource(
          match[3],
          bytes,
        ),
      });
    }
    files.sort((left, right) => left.path.localeCompare(right.path));
    if (files.length === 0 ||
        new Set(files.map(({ path }) => path)).size !== files.length) {
      throw new Error("Specification source snapshot is empty or duplicates a path");
    }
    const paths = Buffer.from(`${files.map(({ path }) => path).join("\n")}\n`);
    const documents = Buffer.from(
      files.map(({ path, sha256, classification }) =>
        `${sha256}  ${classification}  ${path}\n`).join(""),
    );
    return Buffer.from(canonicalJSON({
      format: "takoform.specification-source-snapshot@v1",
      sourceCommit: commit,
      roots: ["spec"],
      files,
      pathSetSha256: digest(paths),
      documentSetSha256: digest(documents),
    }));
  };

  const jsonAt = (localGit, commit, path) => {
    try {
      return JSON.parse(blobAt(localGit, commit, path).toString("utf8"));
    } catch (error) {
      throw new Error(`${commit}:${path} is invalid JSON: ${error.message}`);
    }
  };

  const stateAt = (localGit, commit) => ({
    specificationLedger: jsonAt(localGit, commit, SPECIFICATION_LEDGER_PATH),
    schemaLedger: jsonAt(localGit, commit, SCHEMA_LEDGER_PATH),
    prefixChain: jsonAt(localGit, commit, PREFIX_CHAIN_PATH),
    recordHeadRaw: blobAt(localGit, commit, RECORD_HEAD_PATH),
    recordHeadSignature: jsonAt(localGit, commit, RECORD_HEAD_SIGNATURE_PATH),
    recordHeadPublicKeyPEM: blobAt(
      localGit,
      commit,
      RECORD_HEAD_PUBLIC_KEY_PATH,
    ).toString("utf8"),
  });

  const transitionAt = (localGit, fromCommit, toCommit, expectedChanges, label) => {
    const ancestry = localGit(["rev-list", "--parents", "-n", "1", toCommit])
      .split(/\s+/u);
    if (ancestry.length !== 2 || ancestry[0] !== toCommit || ancestry[1] !== fromCommit) {
      throw new Error(`${label} must be one direct single-parent edge`);
    }
    const changes = parseNameStatus(localGit.raw([
      "diff",
      "--name-status",
      "--no-renames",
      fromCommit,
      toCommit,
      "--",
    ]));
    compareChanges(changes, expectedChanges, label);
    return {
      fromCommit,
      toCommit,
      parents: [fromCommit],
      changedPaths: changes.map(({ path }) => path),
    };
  };

  const recordsEqual = (left, right) =>
    canonicalJSON(left) === canonicalJSON(right);

  const assertLoadedExecutionClosure = (sourceRecords) => {
    if (
      git(["rev-parse", "--show-toplevel"]) !== repositoryRoot ||
      git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "" ||
      git(["branch", "--show-current"]) !== SPECIFICATION_RELEASE_ADAPTER.branch ||
      git(["rev-parse", "--is-shallow-repository"]) !== "false" ||
      git(["replace", "-l"]) !== "" ||
      git(["remote", "get-url", "origin"]) !== SPECIFICATION_RELEASE_ADAPTER.origin
    ) {
      throw new Error("running Specification release tool closure is not one clean canonical checkout");
    }
    const common = git(["rev-parse", "--git-common-dir"]);
    if (existsSync(resolve(repositoryRoot, common, "objects/info/alternates"))) {
      throw new Error("running Specification release tool closure refuses Git object alternates");
    }
    for (const path of SOURCE_PINNED_EXECUTION_PATHS) {
      if (git(["rev-parse", `HEAD:${path}`]) !== sourceRecords[path].objectId) {
        throw new Error(`running Specification release tool ${path} differs from immutable P0`);
      }
    }
  };

  const assertRecordInput = (request) => {
    if (
      phase !== "record" ||
      !exactKeys(request, [
        "sourceCommit",
        "expectedPaths",
        "files",
        "publication",
        "auditToken",
      ]) ||
      request.sourceCommit !== options.expectedECommit ||
      canonicalJSON(request.expectedPaths) !== canonicalJSON(E_TO_R_TRACKED_PATHS) ||
      !(request.files instanceof Map) ||
      canonicalJSON([...request.files.keys()]) !== canonicalJSON(E_TO_R_TRACKED_PATHS) ||
      !exactKeys(request.publication, [
        "tag",
        "release",
        "tagProtectionRuleset",
      ])
    ) {
      throw new Error("receipt CAS request is not the exact E-pinned four-file transition");
    }
    for (const path of E_TO_R_TRACKED_PATHS) {
      const bytes = request.files.get(path);
      if (!(Buffer.isBuffer(bytes) || bytes instanceof Uint8Array)) {
        throw new Error(`receipt CAS file ${path} is not exact bytes`);
      }
    }
  };

  const isCIWriter = () =>
    (typeof env.CI === "string" && env.CI !== "" && env.CI !== "0" && env.CI !== "false") ||
    env.GITHUB_ACTIONS === "true";

  const recordObject = (localGit, bytes) => {
    const objectId = localGit(
      ["hash-object", "-w", "--stdin"],
      { input: Buffer.from(bytes) },
    );
    if (!OBJECT.test(objectId)) throw new Error("receipt blob write returned an invalid object id");
    return objectId;
  };

  const classifyReceiptCAS = ({
    canonical,
    sourceCommit,
    parentCommit,
    receiptCommit,
    expectedPaths,
    sourceRecords,
    parentRecords,
    receiptRecords,
    parentFirstParentHistory,
  }) => {
    canonical.localGit([
      "fetch",
      "--force",
      "--no-tags",
      "origin",
      "refs/heads/main:refs/remotes/origin/main",
    ]);
    const canonicalMainCommit = canonical.localGit(["rev-parse", "refs/remotes/origin/main"]);
    const currentFirstParentHistory = firstParentHistory(
      canonical.localGit,
      canonicalMainCommit,
    );
    const currentRecords = recordsAt(
      canonical.localGit,
      canonicalMainCommit,
      expectedPaths,
    );
    if (currentFirstParentHistory.includes(receiptCommit)) {
      if (
        !currentFirstParentHistory.includes(sourceCommit) ||
        !recordsEqual(receiptRecords, currentRecords)
      ) {
        throw new Error("receipt CAS landed but later canonical state changed its exact records");
      }
      return {
        status: "recorded",
        lineage: {
          sourceCommit,
          parentCommit,
          receiptCommit,
          canonicalMainCommit,
          receiptParents: [parentCommit],
          parentFirstParentHistory,
          currentFirstParentHistory,
          sourceRecords,
          parentRecords,
          receiptRecords,
          currentRecords,
          changedPaths: [...expectedPaths],
        },
      };
    }
    if (
      !currentFirstParentHistory.includes(parentCommit) ||
      !currentFirstParentHistory.includes(sourceCommit) ||
      currentFirstParentHistory.includes(receiptCommit) ||
      !recordsEqual(sourceRecords, currentRecords)
    ) {
      throw new Error("receipt CAS lost to canonical state that changed source authority or records");
    }
    return {
      status: "cas-lost",
      sourceCommit,
      parentCommit,
      receiptCommit,
      canonicalMainCommit,
      currentFirstParentHistory,
      sourceRecords,
      currentRecords,
    };
  };

  const operations = {
    cleanup() {
      rmSync(runtimeRoot, { recursive: true, force: true });
    },

    async readReservationState() {
      assertCleanCanonicalHead(expectedHead());
      return { ...readStateFiles(), headCommit: expectedHead() };
    },

    async readPreparationState() {
      const headCommit = expectedHead();
      assertCleanCanonicalHead(headCommit);
      const dCommit = requireCommit(options.expectedDCommit, "D commit");
      return {
        ...readStateFiles(),
        headCommit,
        reservationTransition: dCommit === headCommit
          ? null
          : transition(
              dCommit,
              headCommit,
              RESERVATION_TRACKED_PATHS.map((path) => ({ status: "M", path })),
              "D to N schema reservation",
            ),
      };
    },

    async readPublishState() {
      return readEvidenceState();
    },

    async readRecoveryState() {
      return readEvidenceState();
    },

    async readRecordState(request) {
      if (
        !exactKeys(request, ["sourceCommit"]) ||
        request.sourceCommit !== options.expectedECommit
      ) {
        throw new Error("record state request is not pinned to the exact E source");
      }
      const canonical = freshCanonicalRepository();
      const history = firstParentHistory(canonical.localGit, canonical.main);
      if (!history.includes(request.sourceCommit)) {
        throw new Error("canonical main does not first-parent contain the E record source");
      }
      pinnedSourceRepository = canonical;
      const raw = cacheCandidate(
        blobAt(canonical.localGit, request.sourceCommit, CANDIDATE_PATH),
      );
      return {
        ...stateAt(canonical.localGit, request.sourceCommit),
        candidateRaw: raw,
        headCommit: request.sourceCommit,
        evidenceTransition: transitionAt(
          canonical.localGit,
          requireCommit(options.expectedNCommit, "N commit"),
          request.sourceCommit,
          [{ status: "A", path: CANDIDATE_PATH }],
          "N to E evidence",
        ),
      };
    },

    async readSchemaVerificationState(request) {
      if (phase !== "verify") {
        throw new Error("schema verification state is read-only and verify-phase only");
      }
      return await operations.readRecordState(request);
    },

    async readVerificationState(request) {
      if (exactKeys(request, ["dormant"]) && request.dormant === true) {
        const headCommit = requireCommit(git(["rev-parse", "HEAD"]), "dormant HEAD");
        assertCleanCanonicalHead(headCommit);
        const candidate = repositoryPath(repositoryRoot, CANDIDATE_PATH);
        return {
          ...readStateFiles(),
          candidateRaw: existsSync(candidate) ? strictFile(repositoryRoot, CANDIDATE_PATH).bytes : null,
          headCommit,
        };
      }
      if (
        !exactKeys(request, ["sourceCommit", "receiptCommit"]) ||
        request.sourceCommit !== options.expectedECommit ||
        request.receiptCommit !== options.expectedRCommit
      ) {
        throw new Error("verification state request is not the exact E/R identity pair");
      }
      const canonical = freshCanonicalRepository();
      const history = firstParentHistory(canonical.localGit, canonical.main);
      if (!history.includes(request.receiptCommit) || !history.includes(request.sourceCommit)) {
        throw new Error("canonical main does not first-parent contain the E source and R receipt");
      }
      const receiptAncestry = canonical.localGit([
        "rev-list",
        "--parents",
        "-n",
        "1",
        request.receiptCommit,
      ]).split(/\s+/u);
      if (receiptAncestry.length !== 2 || receiptAncestry[0] !== request.receiptCommit) {
        throw new Error("Specification receipt is not one sole-parent commit");
      }
      const parentCommit = receiptAncestry[1];
      const parentFirstParentHistory = firstParentHistory(
        canonical.localGit,
        parentCommit,
      );
      if (!parentFirstParentHistory.includes(request.sourceCommit)) {
        throw new Error("Specification receipt parent does not first-parent contain E");
      }
      const receiptChanges = parseNameStatus(canonical.localGit.raw([
        "diff",
        "--name-status",
        "--no-renames",
        parentCommit,
        request.receiptCommit,
        "--",
      ]));
      const receiptChangesByPath = new Map(
        receiptChanges.map((entry) => [entry.path, entry.status]),
      );
      if (
        receiptChanges.length !== E_TO_R_TRACKED_PATHS.length ||
        receiptChangesByPath.size !== E_TO_R_TRACKED_PATHS.length ||
        E_TO_R_TRACKED_PATHS.some((path) => receiptChangesByPath.get(path) !== "M")
      ) {
        throw new Error("Specification receipt changes more or less than the exact four records");
      }
      pinnedSourceRepository = canonical;
      const raw = cacheCandidate(
        blobAt(canonical.localGit, request.sourceCommit, CANDIDATE_PATH),
      );
      const sourceRecordFiles = new Map(
        E_TO_R_TRACKED_PATHS.map((path) => [
          path,
          blobAt(canonical.localGit, request.sourceCommit, path),
        ]),
      );
      return {
        ...stateAt(canonical.localGit, canonical.main),
        candidateRaw: raw,
        headCommit: canonical.main,
        evidenceTransition: transitionAt(
          canonical.localGit,
          requireCommit(options.expectedNCommit, "N commit"),
          request.sourceCommit,
          [{ status: "A", path: CANDIDATE_PATH }],
          "N to E evidence",
        ),
        sourceRecordFiles,
        receiptLineage: {
          sourceCommit: request.sourceCommit,
          parentCommit,
          receiptCommit: request.receiptCommit,
          canonicalMainCommit: canonical.main,
          receiptParents: [parentCommit],
          parentFirstParentHistory,
          currentFirstParentHistory: history,
          sourceRecords: recordsAt(
            canonical.localGit,
            request.sourceCommit,
            E_TO_R_TRACKED_PATHS,
          ),
          parentRecords: recordsAt(
            canonical.localGit,
            parentCommit,
            E_TO_R_TRACKED_PATHS,
          ),
          receiptRecords: recordsAt(
            canonical.localGit,
            request.receiptCommit,
            E_TO_R_TRACKED_PATHS,
          ),
          currentRecords: recordsAt(
            canonical.localGit,
            canonical.main,
            E_TO_R_TRACKED_PATHS,
          ),
          changedPaths: [...E_TO_R_TRACKED_PATHS],
        },
      };
    },

    async verifySourcePinnedExecution(request) {
      if (
        !exactKeys(request, ["preparedCommit", "checkpoints", "paths"]) ||
        request.preparedCommit !== options.authority?.successorPreparedCommit ||
        !Array.isArray(request.checkpoints) ||
        canonicalJSON(request.checkpoints) !==
          canonicalJSON(expectedWriterCheckpoints()) ||
        canonicalJSON(request.paths) !==
          canonicalJSON(SOURCE_PINNED_EXECUTION_PATHS)
      ) {
        throw new Error("writer execution request differs from the immutable P0 closure");
      }
      // First close the loaded checkout entirely from local Git objects. This
      // check intentionally precedes fresh-canonical fetches: no credential,
      // signer, package/source script, or network-capable callback may run
      // while an altered executable closure is loaded.
      const loadedHead = requireCommit(git(["rev-parse", "HEAD"]), "loaded HEAD");
      const loadedHistory = firstParentHistory(git, loadedHead);
      if (!loadedHistory.includes(request.preparedCommit) ||
          request.checkpoints.some((commit) => !loadedHistory.includes(commit))) {
        throw new Error(
          "loaded checkout does not first-parent contain P0 and every D/N/E checkpoint",
        );
      }
      const loadedPreparedRecords = recordsAt(
        git,
        request.preparedCommit,
        request.paths,
      );
      for (const commit of request.checkpoints) {
        if (!recordsEqual(
          loadedPreparedRecords,
          recordsAt(git, commit, request.paths),
        )) {
          throw new Error(
            `loaded checkpoint ${commit} changed one of the P0 writer paths`,
          );
        }
      }
      const loadedCurrentRecords = recordsAt(git, loadedHead, request.paths);
      if (!recordsEqual(loadedPreparedRecords, loadedCurrentRecords)) {
        throw new Error("loaded checkout changed one of the P0 writer paths");
      }
      assertLoadedExecutionClosure(loadedPreparedRecords);

      const canonical = freshCanonicalRepository();
      const history = firstParentHistory(canonical.localGit, canonical.main);
      if (!history.includes(request.preparedCommit) ||
          request.checkpoints.some((commit) => !history.includes(commit))) {
        throw new Error("canonical main does not first-parent contain P0 and every D/N/E checkpoint");
      }
      const preparedRecords = recordsAt(
        canonical.localGit,
        request.preparedCommit,
        request.paths,
      );
      const checkpoints = request.checkpoints.map((commit) => ({
        commit,
        pathObjects: Object.fromEntries(
          Object.entries(recordsAt(canonical.localGit, commit, request.paths))
            .map(([path, record]) => [path, record.objectId]),
        ),
      }));
      const currentRecords = recordsAt(
        canonical.localGit,
        canonical.main,
        request.paths,
      );
      for (const point of checkpoints) {
        if (request.paths.some((path) =>
          point.pathObjects[path] !== preparedRecords[path].objectId)) {
          throw new Error(`canonical checkpoint ${point.commit} changed one of the P0 writer paths`);
        }
      }
      if (!recordsEqual(preparedRecords, currentRecords)) {
        throw new Error("canonical main changed one of the P0 writer paths");
      }
      if (!recordsEqual(loadedPreparedRecords, preparedRecords)) {
        throw new Error("fresh canonical P0 differs from the locally closed P0 objects");
      }
      const proof = {
        prepared: {
          commit: request.preparedCommit,
          pathObjects: Object.fromEntries(
            request.paths.map((path) => [path, preparedRecords[path].objectId]),
          ),
        },
        checkpoints,
        current: {
          commit: canonical.main,
          pathObjects: Object.fromEntries(
            request.paths.map((path) => [path, currentRecords[path].objectId]),
          ),
        },
      };
      writerClosureProof = structuredClone(proof);
      return proof;
    },

    async prepareSchemaToolClosure(request) {
      if (
        !["publish", "recover"].includes(phase) ||
        !exactKeys(request, [
          "preparedCommit",
          "packageObject",
          "lockObject",
          "toolPolicyObject",
          "wranglerVersion",
        ]) ||
        request.preparedCommit !== options.authority?.successorPreparedCommit ||
        request.wranglerVersion !== SPECIFICATION_RELEASE_ADAPTER.wranglerVersion ||
        !OBJECT.test(request.packageObject ?? "") ||
        !OBJECT.test(request.lockObject ?? "") ||
        !OBJECT.test(request.toolPolicyObject ?? "")
      ) {
        throw new Error("schema tool-seal request differs from the exact P0 dependency closure");
      }
      if (!writerClosureProof ||
          writerClosureProof.prepared.commit !== request.preparedCommit ||
          writerClosureProof.prepared.pathObjects["package.json"] !==
            request.packageObject ||
          writerClosureProof.prepared.pathObjects["bun.lock"] !==
            request.lockObject ||
          writerClosureProof.prepared.pathObjects[
            WRITER_TOOL_CLOSURE_POLICY_PATH
          ] !== request.toolPolicyObject) {
        throw new Error("schema tool sealing requires the verified immutable P0 closure");
      }
      if (activeCredentials) {
        throw new Error("schema tool sealing must finish before credential acquisition");
      }
      const policy = parseSchemaToolClosurePolicy(
        Buffer.from(objectReader(request.toolPolicyObject)),
      );
      validateSchemaToolRuntimePolicy(policy, {
        requireCurrent: false,
      });
      preparedToolClosure ??= sealToolClosure({
        repositoryRoot,
        runtimeRoot,
      });
      preparedToolClosure.verify();
      const executable = relative(
        preparedToolClosure.root,
        realpathSync(preparedToolClosure.executable),
      ).split(sep).join("/");
      if (
        preparedToolClosure.manifestSha256 !== policy.manifestSha256 ||
        preparedToolClosure.fileCount !== policy.fileCount ||
        executable !== policy.executable
      ) {
        throw new Error(
          "installed dependency/tool closure differs from the exact P0 authority manifest",
        );
      }
      preparedToolPolicy = policy;
      return {
        format: "takoform.sealed-schema-tool-closure@v1",
        preparedCommit: request.preparedCommit,
        packageObject: request.packageObject,
        lockObject: request.lockObject,
        toolPolicyObject: request.toolPolicyObject,
        wranglerVersion: request.wranglerVersion,
        manifestSha256: preparedToolClosure.manifestSha256,
        fileCount: preparedToolClosure.fileCount,
      };
    },

    async tryRecordSpecificationReceipt(request) {
      assertRecordInput(request);
      if (isCIWriter()) {
        throw new Error("Specification receipt publication has no CI writer authority");
      }
      const cached = verifyCandidateContext();
      const finalTag = readRemoteTag(cached.candidate.tag);
      const finalRelease = await operations.readRelease(cached.candidate.tag);
      const finalRuleset = await exactTagProtectionRuleset({
        tag: cached.candidate.tag,
        expectedPattern: "refs/tags/specification/*",
        auditToken: request.auditToken,
      });
      if (canonicalJSON({
        tag: finalTag,
        release: finalRelease,
        tagProtectionRuleset: finalRuleset,
      }) !== canonicalJSON(request.publication)) {
        throw new Error(
          "final tag, immutable empty Release, or no-bypass ruleset drifted before ref authority",
        );
      }
      // This is deliberately the first ref-authority read. The public identity
      // fences above are not atomic with GitHub's subsequent leased ref update;
      // a post-fence change can only be detected by the authoritative CAS
      // classification and requires forward repair.
      const refWriteToken = requireSecret(
        env.TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN,
        "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
      );
      const canonical = freshCanonicalRepository();
      const sourceCommit = request.sourceCommit;
      const parentCommit = canonical.main;
      const expectedPaths = [...request.expectedPaths];
      const parentFirstParentHistory = firstParentHistory(
        canonical.localGit,
        parentCommit,
      );
      if (!parentFirstParentHistory.includes(sourceCommit)) {
        throw new Error("canonical parent does not first-parent contain the exact E source");
      }
      const sourceRecords = recordsAt(
        canonical.localGit,
        sourceCommit,
        expectedPaths,
      );
      const parentRecords = recordsAt(
        canonical.localGit,
        parentCommit,
        expectedPaths,
      );
      if (!recordsEqual(sourceRecords, parentRecords)) {
        throw new Error("canonical parent changed one of the four E-pinned receipt records");
      }
      const sourceExecutionRecords = recordsAt(
        canonical.localGit,
        sourceCommit,
        SOURCE_PINNED_EXECUTION_PATHS,
      );
      const parentExecutionRecords = recordsAt(
        canonical.localGit,
        parentCommit,
        SOURCE_PINNED_EXECUTION_PATHS,
      );
      if (!recordsEqual(sourceExecutionRecords, parentExecutionRecords)) {
        throw new Error("canonical receipt parent changed one of the E-pinned execution paths");
      }
      assertLoadedExecutionClosure(sourceExecutionRecords);
      const index = join(canonical.directory, "receipt.index");
      const commitInstant = new Date().toISOString();
      const commitEnvironment = {
        ...canonical.environment,
        GIT_INDEX_FILE: index,
        GIT_AUTHOR_NAME: "Takoform Specification Release",
        GIT_AUTHOR_EMAIL: "tako0614@users.noreply.github.com",
        GIT_AUTHOR_DATE: commitInstant,
        GIT_COMMITTER_NAME: "Takoform Specification Release",
        GIT_COMMITTER_EMAIL: "tako0614@users.noreply.github.com",
        GIT_COMMITTER_DATE: commitInstant,
      };
      canonical.localGit(["read-tree", parentCommit], { env: commitEnvironment });
      for (const path of expectedPaths) {
        const objectId = recordObject(
          (args, commandOptions = {}) => canonical.localGit(args, {
            ...commandOptions,
            env: commitEnvironment,
          }),
          request.files.get(path),
        );
        if (objectId === parentRecords[path].objectId) {
          throw new Error(`receipt record ${path} did not change from its E-pinned parent`);
        }
        canonical.localGit(
          ["update-index", "--add", "--cacheinfo", "100644", objectId, path],
          { env: commitEnvironment },
        );
      }
      const tree = canonical.localGit(["write-tree"], { env: commitEnvironment });
      if (!OBJECT.test(tree)) throw new Error("receipt tree identity is invalid");
      const receiptCommit = canonical.localGit(
        ["commit-tree", tree, "-p", parentCommit],
        {
          env: commitEnvironment,
          input: `Record Takoform Specification ${options.version} release\n`,
        },
      );
      requireCommit(receiptCommit, "receipt commit");
      const ancestry = canonical.localGit([
        "rev-list",
        "--parents",
        "-n",
        "1",
        receiptCommit,
      ]).split(/\s+/u);
      if (
        ancestry.length !== 2 ||
        ancestry[0] !== receiptCommit ||
        ancestry[1] !== parentCommit
      ) {
        throw new Error("receipt commit is not the sole direct child of its canonical parent");
      }
      const changed = parseNameStatus(
        canonical.localGit.raw([
          "diff",
          "--name-status",
          "--no-renames",
          parentCommit,
          receiptCommit,
          "--",
        ]),
      );
      const byPath = new Map(changed.map((entry) => [entry.path, entry.status]));
      if (
        changed.length !== expectedPaths.length ||
        byPath.size !== expectedPaths.length ||
        expectedPaths.some((path) => byPath.get(path) !== "M")
      ) {
        throw new Error("receipt commit changes more or less than the exact four record paths");
      }
      const receiptRecords = recordsAt(
        canonical.localGit,
        receiptCommit,
        expectedPaths,
      );
      for (const path of expectedPaths) {
        if (receiptRecords[path].objectId === parentRecords[path].objectId) {
          throw new Error(`receipt commit retained the parent blob for ${path}`);
        }
      }
      const authEnvironment = gitEnvironment(env, emptyGitConfig, {
        GIT_ASKPASS: refAskpass,
        TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN: refWriteToken,
      });
      runner(
        "git",
        [
          "push",
          "--porcelain",
          `--force-with-lease=refs/heads/main:${parentCommit}`,
          SPECIFICATION_RELEASE_ADAPTER.origin,
          `${receiptCommit}:refs/heads/main`,
        ],
        { cwd: canonical.directory, env: authEnvironment },
      );
      return classifyReceiptCAS({
        canonical,
        sourceCommit,
        parentCommit,
        receiptCommit,
        expectedPaths,
        sourceRecords,
        parentRecords,
        receiptRecords,
        parentFirstParentHistory,
      });
    },

    async readSchemaSource(source) {
      if (typeof source !== "string" || !source.startsWith("spec/schemas/")) {
        throw new Error("schema source is outside the exact Specification schema root");
      }
      const sourceCommit = requireCommit(options.expectedDCommit, "D schema source commit");
      if (pinnedSourceRepository) {
        return blobAt(pinnedSourceRepository.localGit, sourceCommit, source);
      }
      const objectId = git(["rev-parse", `${sourceCommit}:${source}`]);
      if (!OBJECT.test(objectId) || git(["cat-file", "-t", objectId]) !== "blob") {
        throw new Error("schema source is not one exact D-pinned Git blob");
      }
      return Buffer.from(objectReader(objectId));
    },

    async readCanonicalSchemaTree(request) {
      const expectedDCommit = options.expectedDCommit;
      if (!exactKeys(request, ["commit", "root"]) ||
          request.commit !== expectedDCommit ||
          request.root !== "spec/schemas") {
        throw new Error("canonical schema derivation request differs from exact D");
      }
      assertCleanCanonicalHead(request.commit);
      const raw = checked(
        runner,
        "git",
        ["ls-tree", "-r", "-z", "--full-tree", request.commit, "--", request.root],
        { cwd: repositoryRoot, env: baseGitEnvironment },
      );
      const result = [];
      for (const record of raw.split("\0").filter(Boolean)) {
        const match = /^(100644) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(record);
        if (!match || !SAFE_PATH.test(match[3]) ||
            !match[3].startsWith("spec/schemas/") ||
            !match[3].endsWith(".schema.json")) {
          throw new Error("canonical D schema tree contains a nonordinary or nonschema entry");
        }
        result.push({ source: match[3], bytes: Buffer.from(objectReader(match[2])) });
      }
      result.sort((left, right) => left.source.localeCompare(right.source));
      if (result.length === 0 ||
          new Set(result.map(({ source }) => source)).size !== result.length) {
        throw new Error("canonical D schema tree is empty or duplicates a source");
      }
      return result;
    },

    async readHTTP(url) {
      if (
        typeof url !== "string" ||
        !url.startsWith("https://forms.takoform.com/schemas/")
      ) {
        throw new Error("schema readback URL is outside the sole public schema surface");
      }
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "application/schema+json, application/json" },
      });
      const bytes = await responseBytes(response, `schema readback ${url}`);
      return {
        status: response.status,
        url: response.url,
        redirected: response.redirected,
        bytes,
      };
    },

    async buildSpecificationSourceSnapshot(request) {
      if (
        !exactKeys(request, ["commit", "roots", "exclude"]) ||
        request.commit !== options.expectedDCommit ||
        canonicalJSON(request.roots) !== canonicalJSON(["spec"]) ||
        canonicalJSON(request.exclude) !== canonicalJSON([CANDIDATE_PATH])
      ) {
        throw new Error("source snapshot request does not close the exact Specification root");
      }
      git(["merge-base", "--is-ancestor", request.commit, options.expectedNCommit]);
      return specificationSourceSnapshotAt(git, request.commit, objectReader);
    },

    async verifySpecificationSourceSnapshot(request) {
      if (
        !exactKeys(request, ["commit", "snapshotSha256", "snapshotBytes"]) ||
        request.commit !== options.expectedDCommit ||
        !SHA256.test(request.snapshotSha256 ?? "") ||
        !(Buffer.isBuffer(request.snapshotBytes) ||
          request.snapshotBytes instanceof Uint8Array) ||
        digest(request.snapshotBytes) !== request.snapshotSha256
      ) {
        throw new Error("normative source-snapshot verification request is not exact");
      }
      const cached = verifyCandidateContext();
      if (cached.candidate.lanes?.specification !== true) {
        throw new Error("schema-only publication has no normative source snapshot");
      }
      const candidateBytes = decodeCanonicalBase64(
        cached.candidate.sourceSnapshot?.bytesBase64,
        "candidate source snapshot bytes",
      );
      if (!candidateBytes.equals(Buffer.from(request.snapshotBytes)) ||
          cached.candidate.sourceSnapshot?.sha256 !== request.snapshotSha256) {
        throw new Error("normative source-snapshot request differs from the E candidate");
      }
      const sourceRepository = pinnedSourceRepository?.localGit ?? git;
      const actual = specificationSourceSnapshotAt(
        sourceRepository,
        request.commit,
        sourceRepository === git
          ? objectReader
          : (object) => sourceRepository.raw(["cat-file", "blob", object]),
      );
      if (!actual.equals(candidateBytes)) {
        throw new Error(
          "normative source snapshot differs from the exact classified D bytes",
        );
      }
      return {
        commit: request.commit,
        snapshotSha256: request.snapshotSha256,
        exact: true,
      };
    },

    async buildSchemaOriginCandidate(request) {
      if (
        !exactKeys(request, ["route", "schemaLedger", "schemaSeal"]) ||
        request.route !== SPECIFICATION_RELEASE_ADAPTER.route ||
        !Array.isArray(request.schemaLedger?.identities) ||
        !Array.isArray(request.schemaLedger?.retired)
      ) {
        throw new Error("schema-origin candidate request is not exact");
      }
      assertCleanCanonicalHead(options.expectedNCommit);
      const accountId = requireCloudflareID(
        env[SPECIFICATION_RELEASE_ADAPTER.accountEnvironment],
        SPECIFICATION_RELEASE_ADAPTER.accountEnvironment,
      );
      const zoneId = requireCloudflareID(
        env[SPECIFICATION_RELEASE_ADAPTER.zoneEnvironment],
        SPECIFICATION_RELEASE_ADAPTER.zoneEnvironment,
      );
      const config = strictFile(repositoryRoot, SPECIFICATION_RELEASE_ADAPTER.configPath);
      validateSchemaConfig(config.bytes);
      const assets = [];
      for (const entry of request.schemaLedger.identities) {
        const path = schemaAssetPath(entry);
        const objectId = git([
          "rev-parse",
          `${requireCommit(options.expectedDCommit, "D commit")}:${entry.source}`,
        ]);
        if (!OBJECT.test(objectId) || git(["cat-file", "-t", objectId]) !== "blob") {
          throw new Error(`schema source is not one exact D blob: ${entry.source}`);
        }
        const bytes = Buffer.from(objectReader(objectId));
        if (digest(bytes) !== entry.sha256) {
          throw new Error(`schema source digest differs for ${entry.source}`);
        }
        let schema;
        try {
          schema = JSON.parse(bytes.toString("utf8"));
        } catch (error) {
          throw new Error(`schema source ${entry.source} is not JSON: ${error.message}`);
        }
        if (schema.$id !== entry.id) {
          throw new Error(`schema source $id differs for ${entry.source}`);
        }
        assets.push({
          url: entry.id,
          path,
          source: entry.source,
          sha256: entry.sha256,
          bytesBase64: bytes.toString("base64"),
        });
      }
      const urls = assets.map(({ url }) => url);
      if (canonicalJSON(urls) !== canonicalJSON([...urls].sort())) {
        throw new Error("active schema ledger must remain sorted by canonical identity");
      }
      const document = {
        format: SCHEMA_CANDIDATE_FORMAT,
        sourceCommit: options.expectedNCommit,
        worker: SPECIFICATION_RELEASE_ADAPTER.worker,
        route: SPECIFICATION_RELEASE_ADAPTER.route,
        target: {
          accountId,
          zoneId,
          zoneName: SPECIFICATION_RELEASE_ADAPTER.zoneName,
        },
        wrangler: {
          version: SPECIFICATION_RELEASE_ADAPTER.wranglerVersion,
          configPath: SPECIFICATION_RELEASE_ADAPTER.configPath,
          configSha256: digest(config.bytes),
        },
        schemaSeal: structuredClone(request.schemaSeal),
        assets,
        retired404: request.schemaLedger.retired.map((entry) => ({
          url: entry.id,
          sha256: entry.sha256,
        })),
      };
      const bytes = Buffer.from(canonicalJSON(document));
      parseSchemaCandidate(bytes, digest(bytes));
      return bytes;
    },

    async writeCandidate(request) {
      if (
        phase !== "prepare" ||
        !exactKeys(request, ["path", "trackedPath", "bytes", "exclusive"]) ||
        request.trackedPath !== CANDIDATE_PATH ||
        request.exclusive !== true ||
        resolve(request.path) !== repositoryPath(repositoryRoot, CANDIDATE_PATH)
      ) {
        throw new Error("candidate writer accepts only the exact create-only tracked candidate");
      }
      assertCleanCanonicalHead(options.expectedNCommit);
      const output = repositoryPath(repositoryRoot, CANDIDATE_PATH);
      if (existsSync(output)) {
        throw new Error("Specification candidate already exists; overwrite is forbidden");
      }
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, Buffer.from(request.bytes), { flag: "wx", mode: 0o644 });
      const changes = parseNameStatus(
        checked(runner, "git", ["status", "--porcelain=v1", "--untracked-files=all"], {
          cwd: repositoryRoot,
          env: baseGitEnvironment,
        }).replace(/^\?\? /u, "A\t"),
      );
      compareChanges(changes, [{ status: "A", path: CANDIDATE_PATH }], "candidate write");
    },

    async writeTrackedFiles(files) {
      const expectedPaths = phase === "apply-reservation"
        ? RESERVATION_TRACKED_PATHS
        : phase === "record"
          ? E_TO_R_TRACKED_PATHS
          : null;
      if (!(files instanceof Map) || expectedPaths === null) {
        throw new Error("tracked record writer is available only to reserve or record");
      }
      if (phase === "record") {
        throw new Error(
          "record is blocked until orchestration owns creation and create-only CAS publication of the direct E-child receipt commit",
        );
      }
      const paths = [...files.keys()];
      if (canonicalJSON(paths) !== canonicalJSON(expectedPaths)) {
        throw new Error("tracked record writer received another path set or order");
      }
      assertCleanCanonicalHead(expectedHead());
      const temporary = [];
      try {
        for (const path of expectedPaths) {
          const output = repositoryPath(repositoryRoot, path);
          const status = lstatSync(output);
          if (status.isSymbolicLink() || !status.isFile() || realpathSync(output) !== output) {
            throw new Error(`tracked record ${path} is not an ordinary file`);
          }
          const staging = `${output}.specification-release-${process.pid}`;
          writeFileSync(staging, Buffer.from(files.get(path)), {
            flag: "wx",
            mode: status.mode & 0o777,
          });
          temporary.push({ staging, output });
        }
        for (const entry of temporary) renameSync(entry.staging, entry.output);
      } finally {
        for (const { staging } of temporary) rmSync(staging, { force: true });
      }
      const changes = parseNameStatus(
        checked(runner, "git", ["diff", "--name-status", "--no-renames", "HEAD", "--"], {
          cwd: repositoryRoot,
          env: baseGitEnvironment,
        }),
      );
      compareChanges(
        changes,
        expectedPaths.map((path) => ({ status: "M", path })),
        "tracked record write",
      );
      if (git(["ls-files", "--others", "--exclude-standard"]) !== "") {
        throw new Error("tracked record write produced an untracked file");
      }
    },

    async acquireTagProtectionAuditToken(request) {
      if (
        !exactKeys(request, ["surface", "version", "phase"]) ||
        request.surface !== "takoform-specification-tag-ruleset" ||
        request.version !== options.version ||
        request.phase !== phase ||
        ![
          "publish",
          "recover",
          "prepare-receipt",
          "record",
          "verify",
        ].includes(phase)
      ) {
        throw new Error("tag-protection audit credential request differs from the exact phase");
      }
      const token = requireSecret(
        env[SPECIFICATION_RELEASE_ADAPTER.tagProtectionAuditTokenEnvironment],
        SPECIFICATION_RELEASE_ADAPTER.tagProtectionAuditTokenEnvironment,
      );
      if (token === env.GH_TOKEN) {
        throw new Error("tag-protection audit and GitHub publication credentials must be separate");
      }
      return makeAuditCredential(token);
    },

    async verifyTagProtectionRuleset(request) {
      if (
        !exactKeys(request, ["tag", "expectedPattern", "auditToken"]) ||
        request.tag !== verifyCandidateContext().candidate.tag ||
        request.expectedPattern !== "refs/tags/specification/*"
      ) {
        throw new Error("tag-protection audit request differs from the exact release identity");
      }
      const normalized = await exactTagProtectionRuleset(request);
      tagProtectionProof = {
        tag: request.tag,
        auditToken: request.auditToken,
        normalized,
      };
      return normalized;
    },

    async acquireCredentials(request) {
      const expectedSurface = request?.lanes?.specification === true
        ? "takoform-specification-release"
        : "takoform-schema-publication";
      if (
        !["publish", "recover"].includes(phase) ||
        !exactKeys(
          request,
          phase === "recover"
            ? ["surface", "version", "lanes", "recovery"]
            : ["surface", "version", "lanes"],
        ) ||
        request?.surface !== expectedSurface ||
        request?.version !== (options.version ?? null) ||
        !exactKeys(request?.lanes, ["specification", "schema"]) ||
        typeof request.lanes.specification !== "boolean" ||
        typeof request.lanes.schema !== "boolean" ||
        (!request.lanes.specification && !request.lanes.schema) ||
        (phase === "recover" ? request?.recovery !== true : Object.hasOwn(request, "recovery"))
      ) {
        throw new Error("credential request differs from the exact release phase");
      }
      if (
        (typeof env.CI === "string" && env.CI !== "" && env.CI !== "0" && env.CI !== "false") ||
        env.GITHUB_ACTIONS === "true"
      ) {
        throw new Error("Specification release has no CI writer authority");
      }
      if (!independentReviewVerified) {
        throw new Error(
          "publish/recover is blocked until orchestration calls verifyIndependentReview with an explicit outside-repository record",
        );
      }
      const cached = verifyCandidateContext();
      if (canonicalJSON(request.lanes) !== canonicalJSON(cached.candidate.lanes)) {
        throw new Error("credential lanes differ from the retained publication candidate");
      }
      if (request.lanes.schema && !preparedToolClosure) {
        throw new Error(
          "Cloudflare authority is blocked until the credential-free sealed tool phase completes",
        );
      }
      if (request.lanes.schema) {
        // Re-close every copied byte before reading any Cloudflare authority.
        // A changed closure therefore cannot observe the token through either
        // execution or an adapter-owned credential object.
        preparedToolClosure.verify();
      }
      const githubToken = request.lanes.specification
        ? requireSecret(env.GH_TOKEN, "GH_TOKEN")
        : null;
      const privateKey = request.lanes.specification
        ? validateTagPrivateKey({
            keyPath: env[SPECIFICATION_RELEASE_ADAPTER.tagSigningKeyEnvironment],
            repositoryRoot,
            runner,
            env,
            signer,
          })
        : null;
      let cloudflareToken = null;
      if (request.lanes.schema) {
        cloudflareToken = requireSecret(
          env[SPECIFICATION_RELEASE_ADAPTER.schemaTokenEnvironment],
          SPECIFICATION_RELEASE_ADAPTER.schemaTokenEnvironment,
        );
        const originBytes = decodeCanonicalBase64(
          cached.candidate.schemaOrigin.candidateBytesBase64,
          "schema-origin candidate bytes",
        );
        parseSchemaCandidate(
          originBytes,
          cached.candidate.schemaOrigin.candidateSha256,
        );
        const candidateAccount = requireCloudflareID(
          schemaCandidateDocument.target.accountId,
          "candidate Cloudflare account",
        );
        const candidateZone = requireCloudflareID(
          schemaCandidateDocument.target.zoneId,
          "candidate Cloudflare zone",
        );
        if (
          requireCloudflareID(
            env[SPECIFICATION_RELEASE_ADAPTER.accountEnvironment],
            SPECIFICATION_RELEASE_ADAPTER.accountEnvironment,
          ) !== candidateAccount ||
          requireCloudflareID(
            env[SPECIFICATION_RELEASE_ADAPTER.zoneEnvironment],
            SPECIFICATION_RELEASE_ADAPTER.zoneEnvironment,
          ) !== candidateZone
        ) {
          throw new Error("explicit Cloudflare target differs from the reviewed schema candidate");
        }
      }
      activeCredentials = Object.freeze({
        githubToken,
        cloudflareToken,
        privateKey,
      });
      return makeCredentials(activeCredentials);
    },

    async verifyIndependentReview(request) {
      if (
        !["publish", "recover"].includes(phase) ||
        !exactKeys(request, [
          "path",
          "lanes",
          "version",
          "expectedDCommit",
          "expectedNCommit",
          "expectedECommit",
          "candidateSha256",
          "schemaOriginCandidateSha256",
          "recovery",
          "reviewed",
        ])
      ) {
        throw new Error("independent review request is not the exact publish/recover authority input");
      }
      const cached = verifyCandidateContext();
      if (
        request.path !== options.reviewRecord ||
        canonicalJSON(request.lanes) !== canonicalJSON(cached.candidate.lanes) ||
        request.version !== cached.candidate.version ||
        request.expectedDCommit !== cached.candidate.canonicalCommit ||
        request.expectedNCommit !== cached.candidate.reservationCommit ||
        request.expectedECommit !== options.expectedECommit ||
        request.candidateSha256 !== digest(cached.raw) ||
        request.schemaOriginCandidateSha256 !==
          (cached.candidate.schemaOrigin?.candidateSha256 ?? null) ||
        request.recovery !== (phase === "recover") ||
        canonicalJSON(request.reviewed) !==
          canonicalJSON(SPECIFICATION_RELEASE_REVIEW.reviewed)
      ) {
        throw new Error("independent review request differs from the retained candidate");
      }
      const review = verifySpecificationReleaseIndependentReview({
        ...request,
        repositoryRoot,
      });
      independentReviewVerified = true;
      return review;
    },

    async readSchemaOriginStage(candidateSha256) {
      return await readStage(candidateSha256);
    },

    async stageSchemaOrigin(request) {
      const credentials = unwrapCredentials(request?.credentials);
      if (credentials !== activeCredential()) {
        throw new Error("schema stage received credentials from another adapter instance");
      }
      if (
        !exactKeys(request, [
          "route",
          "candidateSha256",
          "candidateBytes",
          "releaseCandidateBytes",
          "credentials",
          "createOnly",
        ]) ||
        request.route !== SPECIFICATION_RELEASE_ADAPTER.route ||
        request.createOnly !== true ||
        digest(request.candidateBytes) !== request.candidateSha256 ||
        !Buffer.from(request.releaseCandidateBytes).equals(verifyCandidateContext().raw)
      ) {
        throw new Error("schema stage request differs from the exact prepared candidate");
      }
      parseSchemaCandidate(request.candidateBytes, request.candidateSha256);
      assertCleanCanonicalHead(options.expectedECommit);
      const before = await readStage(request.candidateSha256);
      if (before.status !== 404) {
        throw new Error("schema-origin candidate stage already exists; create-only upload refused");
      }
      await assertExactRoute();
      const assetsRoot = mkdtempSync(join(runtimeRoot, "schema-assets-"));
      for (const asset of schemaCandidateDocument.assets) {
        const output = resolve(assetsRoot, asset.path);
        if (!relationIsInside(assetsRoot, output) || output === assetsRoot) {
          throw new Error("schema candidate asset escapes its isolated upload root");
        }
        mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
        writeFileSync(output, decodeCanonicalBase64(asset.bytesBase64, asset.path), {
          flag: "wx",
          mode: 0o600,
        });
      }
      const output = runWrangler([
        "versions",
        "upload",
        "--strict",
        "--config",
        SPECIFICATION_RELEASE_ADAPTER.configPath,
        "--name",
        SPECIFICATION_RELEASE_ADAPTER.worker,
        "--assets",
        assetsRoot,
        "--tag",
        stageTag(request.candidateSha256),
        "--message",
        stageMessage(request.candidateSha256, digest(request.releaseCandidateBytes)),
      ], { machine: true });
      const stageID = output?.version_id;
      if (
        !UUID.test(stageID ?? "") ||
        output?.worker_name !== SPECIFICATION_RELEASE_ADAPTER.worker
      ) {
        throw new Error("Wrangler upload returned another or ambiguous version identity");
      }
      const readback = await readStage(request.candidateSha256);
      if (readback.status !== 200 || readback.stageID !== stageID) {
        throw new Error("fresh Cloudflare version readback differs after upload");
      }
      return { stageID, candidateSha256: request.candidateSha256 };
    },

    async verifyStagedSchemaOrigin(stage) {
      if (
        !UUID.test(stage?.stageID ?? "") ||
        !SHA256.test(stage?.candidateSha256 ?? "")
      ) {
        throw new Error("schema stage receipt is invalid");
      }
      const exact = await readStage(stage.candidateSha256);
      if (exact.status !== 200 || exact.stageID !== stage.stageID) {
        throw new Error("fresh schema stage readback differs from the exact receipt");
      }
      if (await currentDeploymentFor(stage.stageID)) {
        throw new Error(
          "schema stage is already active while the public route classified it as pre-activation",
        );
      }
      return {
        stageID: stage.stageID,
        candidateSha256: stage.candidateSha256,
        exact: true,
      };
    },

    async activateSchemaRoute(request) {
      const credentials = unwrapCredentials(request?.credentials);
      if (credentials !== activeCredential()) {
        throw new Error("schema activation received credentials from another adapter instance");
      }
      if (
        !exactKeys(request, [
          "route",
          "stageID",
          "candidateSha256",
          "credentials",
          "createOnly",
        ]) ||
        request.route !== SPECIFICATION_RELEASE_ADAPTER.route ||
        request.createOnly !== true ||
        !UUID.test(request.stageID ?? "") ||
        !SHA256.test(request.candidateSha256 ?? "")
      ) {
        throw new Error("schema activation request is not exact");
      }
      assertCleanCanonicalHead(options.expectedECommit);
      await assertExactRoute();
      const stage = await readStage(request.candidateSha256);
      if (stage.status !== 200 || stage.stageID !== request.stageID) {
        throw new Error("just-in-time schema stage differs before activation");
      }
      if (await currentDeploymentFor(request.stageID)) {
        throw new Error("schema version is already active; create-only activation refused");
      }
      const output = runWrangler([
        "versions",
        "deploy",
        `${request.stageID}@100%`,
        "--yes",
        "--config",
        SPECIFICATION_RELEASE_ADAPTER.configPath,
        "--name",
        SPECIFICATION_RELEASE_ADAPTER.worker,
        "--message",
        `Activate ${request.candidateSha256}`,
      ], { machine: true });
      if (
        output?.version_traffic?.[request.stageID] !== 100 ||
        !UUID.test(output?.deployment_id ?? "")
      ) {
        throw new Error("Wrangler activation returned another deployment identity");
      }
      const current = await currentDeploymentFor(request.stageID);
      if (!current || current.id !== output.deployment_id) {
        throw new Error("fresh Cloudflare deployment readback differs after activation");
      }
      await assertExactRoute();
      return { stageID: request.stageID, deploymentID: current.id, exact: true };
    },

    async createSignedAnnotatedTag(request) {
      const credentials = unwrapCredentials(request?.credentials);
      if (credentials !== activeCredential()) {
        throw new Error("tag creation received credentials from another adapter instance");
      }
      const cached = verifyCandidateContext();
      if (
        !exactKeys(request, [
          "tag",
          "targetCommit",
          "message",
          "signed",
          "annotated",
          "createOnly",
          "credentials",
        ]) ||
        request.tag !== cached.candidate.tag ||
        request.targetCommit !== options.expectedECommit ||
        request.message !== tagMessage(cached.candidate, cached.raw) ||
        request.signed !== true ||
        request.annotated !== true ||
        request.createOnly !== true
      ) {
        throw new Error("signed tag request differs from the exact candidate");
      }
      assertCleanCanonicalHead(options.expectedECommit);
      const protectionProof = consumeTagProtectionProof(
        request.tag,
        "signed tag creation",
      );
      if (readRemoteTag(request.tag).status !== 404) {
        throw new Error("remote Specification tag already exists; create-only push refused");
      }
      const localResult = runner(
        "git",
        ["show-ref", "--verify", "--hash", `refs/tags/${request.tag}`],
        { cwd: repositoryRoot, env: baseGitEnvironment },
      );
      let object;
      if (localResult.status === 0) {
        if (phase !== "recover") {
          throw new Error("local Specification tag already exists outside recovery");
        }
        object = String(localResult.stdout).trim();
        inspectTagObject({
          directory: repositoryRoot,
          tag: request.tag,
          object,
          expectedCommit: options.expectedECommit,
        });
      } else if (localResult.status === 1) {
        git([
          ...tagSigningGitConfig(credentials.privateKey),
          "tag",
          "--sign",
          "--annotate",
          request.tag,
          "--message",
          request.message,
          request.targetCommit,
        ]);
        object = git(["rev-parse", `refs/tags/${request.tag}`]);
        inspectTagObject({
          directory: repositoryRoot,
          tag: request.tag,
          object,
          expectedCommit: options.expectedECommit,
        });
      } else {
        throw new Error("local Specification tag absence is ambiguous");
      }
      const objectFormat = git(["rev-parse", "--show-object-format"]);
      const zero = objectFormat === "sha256" ? "0".repeat(64) : "0".repeat(40);
      const authEnvironment = gitEnvironment(env, emptyGitConfig, {
        GIT_ASKPASS: askpass,
        GH_TOKEN: credentials.githubToken,
      });
      await refreshTagProtectionProof(
        protectionProof,
        request.tag,
        "signed tag creation",
      );
      checked(
        runner,
        "git",
        [
          "push",
          `--force-with-lease=refs/tags/${request.tag}:${zero}`,
          SPECIFICATION_RELEASE_ADAPTER.origin,
          `refs/tags/${request.tag}:refs/tags/${request.tag}`,
        ],
        { cwd: repositoryRoot, env: authEnvironment },
      );
      const fresh = readRemoteTag(request.tag);
      if (fresh.status !== 200 || fresh.tagObject !== object) {
        throw new Error("fresh remote signed-tag readback differs after create-only push");
      }
    },

    async readTag(tag) {
      const cached = verifyCandidateContext();
      if (tag !== cached.candidate.tag) {
        throw new Error("tag readback requested another Specification identity");
      }
      return readRemoteTag(tag);
    },

    async createImmutableRelease(request) {
      const credentials = unwrapCredentials(request?.credentials);
      if (credentials !== activeCredential()) {
        throw new Error("Release creation received credentials from another adapter instance");
      }
      const expected = expectedRelease();
      if (
        !exactKeys(request, [
          "tag",
          "targetCommit",
          "title",
          "body",
          "draft",
          "prerelease",
          "immutable",
          "assets",
          "createOnly",
          "direct",
          "credentials",
        ]) ||
        request.tag !== expected.tag ||
        request.targetCommit !== expected.target ||
        request.title !== expected.title ||
        request.body !== expected.body ||
        request.draft !== false ||
        request.prerelease !== false ||
        request.immutable !== true ||
        request.createOnly !== true ||
        request.direct !== true ||
        !Array.isArray(request.assets) ||
        request.assets.length !== 0
      ) {
        throw new Error("immutable Release request differs from the exact candidate");
      }
      assertCleanCanonicalHead(options.expectedECommit);
      const exactTag = readRemoteTag(expected.tag);
      if (exactTag.status !== 200 || exactTag.targetCommit !== options.expectedECommit) {
        throw new Error("immutable Release requires the fresh exact signed remote tag");
      }
      await immutableReleasesEnabled();
      if (await authenticatedReleaseByTag(expected.tag) !== null) {
        throw new Error("Specification Release or draft already exists; create-only POST refused");
      }
      assertCleanCanonicalHead(options.expectedECommit);
      const finalTag = readRemoteTag(expected.tag);
      if (finalTag.status !== 200 || finalTag.tagObject !== exactTag.tagObject) {
        throw new Error("signed tag changed at the final Release publication fence");
      }
      await immutableReleasesEnabled();
      const protectionProof = consumeTagProtectionProof(
        expected.tag,
        "immutable Release creation",
      );
      await refreshTagProtectionProof(
        protectionProof,
        expected.tag,
        "immutable Release creation",
      );
      const release = await authenticatedGitHub(
        "POST",
        `repos/${SPECIFICATION_RELEASE_ADAPTER.githubRepository}/releases`,
        {
          tag_name: expected.tag,
          target_commitish: expected.target,
          name: expected.title,
          body: expected.body,
          draft: false,
          prerelease: false,
          make_latest: "false",
        },
      );
      validateReleaseIdentity(release, expected);
      const publicRelease = await operations.readRelease(expected.tag);
      if (publicRelease.status !== 200 || publicRelease.id !== release.id) {
        throw new Error("fresh credential-free immutable Release readback differs");
      }
    },

    async readRelease(tag) {
      const expected = expectedRelease();
      if (tag !== expected.tag) {
        throw new Error("Release readback requested another Specification identity");
      }
      const endpoint =
        `repos/${SPECIFICATION_RELEASE_ADAPTER.githubRepository}/releases/tags/${encodeURIComponent(tag)}`;
      const response = await publicGitHubJSON(endpoint, { allow404: true });
      if (response.status === 404) return { status: 404, tag };
      const release = validateReleaseIdentity(response.body, expected);
      return {
        status: 200,
        tag,
        id: release.id,
        url: release.html_url,
        body: release.body,
        draft: false,
        prerelease: false,
        immutable: true,
        assets: [],
      };
    },
  };

  return operations;
}
