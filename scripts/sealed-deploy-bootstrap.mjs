import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const FORMAT = "takoform.broker-attested-run-request@v1";
const BROKER = "/usr/local/libexec/takoform-sealed-deploy-broker";
const CLASS = "broker-bound-exact-phase-authority-envelope";
const MAX_REQUEST = 16 * 1024 * 1024;
const MAX_CREDENTIAL = 4 * 1024 * 1024;
const IDENTITY_KEYS = Object.freeze([
  "source.raw-source-tree-sha256",
  "source.review-record-sha256",
  "closure.closure-manifest-sha256",
  "closure.closure-tree-sha256",
  "runtime.runtime-executable-sha256",
  "runtime.runtime-dependency-closure-sha256",
  "launcher.launcher-executable-sha256",
  "launcher.launcher-config-sha256",
  "launcher.launcher-device",
  "launcher.launcher-inode",
  "launcher.launcher-owner-uid",
  "launcher.launcher-owner-gid",
  "launcher.launcher-mode",
]);
const pending = new WeakMap();

function canonicalJSON(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    canonicalJSON(Object.keys(value).sort()) === canonicalJSON([...expected].sort());
}

function identity(info) {
  return {
    dev: info.dev, ino: info.ino, uid: info.uid, gid: info.gid,
    mode: info.mode & 0o777, nlink: info.nlink, size: info.size, mtimeMs: info.mtimeMs,
  };
}

function readUnlinkedFD(fd, label, mode, maximum) {
  const before = fstatSync(fd);
  if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || before.nlink !== 0 ||
      (before.mode & 0o777) !== mode || before.size <= 0 || before.size > maximum) {
    throw new Error(`${label} is not one broker-owned unlinked exact-mode regular FD`);
  }
  const raw = Buffer.alloc(before.size);
  let offset = 0;
  while (offset < raw.length) {
    const count = readSync(fd, raw, offset, raw.length - offset, null);
    if (count === 0) break;
    offset += count;
  }
  const after = fstatSync(fd);
  closeSync(fd);
  if (offset !== raw.length || canonicalJSON(identity(before)) !== canonicalJSON(identity(after))) {
    throw new Error(`${label} changed while read`);
  }
  return raw;
}

function parseCanonical(raw, label) {
  let value;
  try { value = JSON.parse(raw.toString("utf8")); } catch (error) { throw new Error(`${label} is not JSON: ${error.message}`); }
  if (`${canonicalJSON(value)}\n` !== raw.toString("utf8")) throw new Error(`${label} is not exact canonical JSON plus LF`);
  return value;
}

function stableRootExecutable(path, label) {
  if (!path.startsWith("/") || realpathSync(path) !== path) throw new Error(`${label} is not one exact real path`);
  const before = statSync(path);
  if (!before.isFile() || before.nlink !== 1 || before.uid !== 0 || before.gid !== 0 || (before.mode & 0o022) !== 0) {
    throw new Error(`${label} is not one root-owned immutable executable`);
  }
  const raw = readFileSync(path);
  const after = statSync(path);
  if (canonicalJSON(identity(before)) !== canonicalJSON(identity(after))) throw new Error(`${label} changed while read`);
  return { path, sha256: sha256(raw), dev: before.dev, ino: before.ino, uid: before.uid, gid: before.gid, mode: before.mode & 0o777 };
}

function procStat(pid, label) {
  const raw = readFileSync(`/proc/${pid}/stat`, "utf8").trim();
  const close = raw.lastIndexOf(")");
  const firstSpace = raw.indexOf(" ");
  if (close === -1 || firstSpace === -1) throw new Error(`${label} process stat is malformed`);
  const fields = raw.slice(close + 2).split(" ");
  if (raw.slice(0, firstSpace) !== String(pid) || fields.length < 20 || !/^\d+$/u.test(fields[19])) {
    throw new Error(`${label} process stat is incomplete`);
  }
  return { ppid: Number(fields[1]), startTime: fields[19] };
}

function assertParent(request) {
  const pid = process.ppid;
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error("sealed runner has no live broker parent");
  const before = procStat(pid, "broker parent");
  if (procStat(process.pid, "sealed runner").ppid !== pid) throw new Error("sealed runner was reparented before broker validation");
  const path = realpathSync(`/proc/${pid}/exe`);
  if (path !== BROKER || path !== request.broker.path) throw new Error("sealed runner parent is not the exact installed broker path");
  const observed = stableRootExecutable(path, "live sealed deploy broker");
  for (const key of ["path", "sha256", "dev", "ino", "uid", "gid", "mode"]) {
    if (observed[key] !== request.broker[key]) throw new Error(`live sealed deploy broker ${key} differs from signed run request`);
  }
  const after = procStat(pid, "broker parent");
  if (before.startTime !== after.startTime || procStat(process.pid, "sealed runner").ppid !== pid) {
    throw new Error("sealed deploy broker parent identity changed during validation");
  }
}

function validateRequest(request) {
  if (!exactKeys(request, [
    "attestation", "broker", "credential", "ephemeralRoot", "format", "identityEvidence",
    "invocation", "proposalEnvelopeSha256", "reviewRecordSha256", "runtime", "source",
  ]) || request.format !== FORMAT) throw new Error("broker run request has an open or unknown envelope");
  if (!exactKeys(request.source, ["commit", "root"]) || !/^[0-9a-f]{40}$/u.test(request.source.commit) || !request.source.root.startsWith("/")) {
    throw new Error("broker run request source binding is invalid");
  }
  if (!exactKeys(request.invocation, ["args", "phase", "sha256", "surface"]) ||
      !Array.isArray(request.invocation.args) || request.invocation.args.length < 2 ||
      request.invocation.args[0] !== request.invocation.surface || request.invocation.args[1] !== request.invocation.phase ||
      request.invocation.args.some((value) => typeof value !== "string" || value.includes("\0")) ||
      sha256(Buffer.from(canonicalJSON({ args: request.invocation.args, phase: request.invocation.phase, surface: request.invocation.surface }))) !== request.invocation.sha256) {
    throw new Error("broker run request invocation binding is invalid");
  }
  if (!exactKeys(request.credential, ["class", "names"]) || request.credential.class !== CLASS ||
      !Array.isArray(request.credential.names) || request.credential.names.length === 0 ||
      canonicalJSON(request.credential.names) !== canonicalJSON([...request.credential.names].sort()) ||
      request.credential.names.some((name) => typeof name !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(name))) {
    throw new Error("broker run request credential binding is invalid");
  }
  if (!exactKeys(request.broker, ["dev", "gid", "identityEnvelopeSha256", "ino", "mode", "path", "sha256", "staticBuildIdSha256", "uid"]) ||
      !exactKeys(request.runtime, ["node"]) ||
      !exactKeys(request.runtime.node, ["dev", "gid", "ino", "mode", "path", "sha256", "uid"]) ||
      !exactKeys(request.attestation, ["capabilityConsumeMarkerSha256", "capabilityEnvelopeSha256", "signedReviewEnvelopeSha256"]) ||
      !exactKeys(request.identityEvidence, IDENTITY_KEYS)) throw new Error("broker run request identity evidence is incomplete");
  for (const value of [
    request.proposalEnvelopeSha256, request.reviewRecordSha256,
    request.broker.identityEnvelopeSha256, request.broker.sha256, request.broker.staticBuildIdSha256,
    request.runtime.node.sha256, ...Object.values(request.attestation),
    ...Object.values(request.identityEvidence).filter((value) => typeof value === "string"),
  ]) if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error("broker run request contains a noncanonical digest");
  if (request.identityEvidence["runtime.runtime-executable-sha256"] !== request.runtime.node.sha256 ||
      request.identityEvidence["launcher.launcher-executable-sha256"] !== request.broker.sha256 ||
      request.identityEvidence["launcher.launcher-device"] !== request.broker.dev ||
      request.identityEvidence["launcher.launcher-inode"] !== request.broker.ino ||
      request.identityEvidence["launcher.launcher-owner-uid"] !== request.broker.uid ||
      request.identityEvidence["launcher.launcher-owner-gid"] !== request.broker.gid ||
      request.identityEvidence["launcher.launcher-mode"] !== request.broker.mode ||
      request.attestation.signedReviewEnvelopeSha256 !== request.reviewRecordSha256) {
    throw new Error("broker run request cross-identity binding differs");
  }
  const brokerIdentityEnvelopeSha256 = sha256(Buffer.from(canonicalJSON({
    path: request.broker.path,
    sha256: request.broker.sha256,
    dev: request.broker.dev,
    ino: request.broker.ino,
    uid: request.broker.uid,
    gid: request.broker.gid,
    mode: request.broker.mode,
    staticBuildIdSha256: request.broker.staticBuildIdSha256,
  })));
  if (request.broker.identityEnvelopeSha256 !== brokerIdentityEnvelopeSha256) {
    throw new Error("broker run request identity-envelope digest differs");
  }
  const source = realpathSync(request.source.root);
  const sourceBefore = lstatSync(source);
  if (source !== request.source.root || !sourceBefore.isDirectory() ||
      sourceBefore.isSymbolicLink() || sourceBefore.uid !== 0 ||
      sourceBefore.gid !== 0 || (sourceBefore.mode & 0o777) !== 0o555 ||
      resolve(dirname(fileURLToPath(import.meta.url)), "..") !== source) {
    throw new Error(
      "broker run request did not start the exact root-owned resealed source runner",
    );
  }
  const runtime = stableRootExecutable(request.runtime.node.path, "sealed deploy Node runtime");
  if (realpathSync(process.execPath) !== runtime.path) throw new Error("sealed runner is not executing under the bound Node runtime");
  for (const key of ["path", "sha256", "dev", "ino", "uid", "gid", "mode"]) {
    if (runtime[key] !== request.runtime.node[key]) throw new Error(`sealed deploy Node ${key} differs from signed run request`);
  }
  const ephemeral = lstatSync(request.ephemeralRoot);
  if (!ephemeral.isDirectory() || ephemeral.isSymbolicLink() || ephemeral.uid !== 0 || ephemeral.gid !== 0 ||
      (ephemeral.mode & 0o777) !== 0o700 || realpathSync(request.ephemeralRoot) !== request.ephemeralRoot ||
      dirname(request.ephemeralRoot) !== dirname(source)) {
    throw new Error("broker ephemeral credential root is not exact root-owned mode 0700");
  }
  const sourceAfter = lstatSync(source);
  if (canonicalJSON(identity(sourceBefore)) !== canonicalJSON(identity(sourceAfter))) {
    throw new Error("broker-owned resealed source root changed during bootstrap");
  }
}

function readCredential(fd, names) {
  const payload = parseCanonical(readUnlinkedFD(fd, "broker credential envelope", 0o600, MAX_CREDENTIAL), "broker credential envelope");
  if (!exactKeys(payload, names)) throw new Error("broker credential envelope names differ from the exact phase allowlist");
  for (const name of names) if (typeof payload[name] !== "string" || payload[name] === "" || payload[name].includes("\0")) {
    throw new Error(`broker credential envelope contains an invalid ${name} value`);
  }
  return payload;
}

function materialize(request, payload) {
  const env = { ...payload };
  const files = [];
  if (Object.hasOwn(env, "TAKOFORM_CORE_TAG_SIGNING_KEY")) {
    const path = join(request.ephemeralRoot, "core-tag-signing-key");
    let created = false;
    try {
      writeFileSync(path, env.TAKOFORM_CORE_TAG_SIGNING_KEY, {
        flag: "wx",
        mode: 0o600,
      });
      created = true;
      chmodSync(path, 0o600);
      const info = lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 ||
          info.gid !== 0 || info.nlink !== 1 ||
          (info.mode & 0o777) !== 0o600) {
        throw new Error(
          "broker tag signing key materialization lost private custody",
        );
      }
      files.push({ path, identity: identity(info) });
      env.TAKOFORM_CORE_TAG_SIGNING_KEY = path;
    } catch (error) {
      if (created && existsSync(path)) {
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink() || info.uid !== 0 ||
            info.gid !== 0 || info.nlink !== 1 ||
            (info.mode & 0o777) !== 0o600) {
          throw new Error(
            `tag signing key cleanup refused an identity-changed path after: ${error.message}`,
          );
        }
        unlinkSync(path);
      }
      throw error;
    }
  }
  return { env, files };
}

function cleanup(files) {
  for (const item of files) {
    const info = lstatSync(item.path);
    if (canonicalJSON(identity(info)) !== canonicalJSON(item.identity)) throw new Error("broker ephemeral credential changed before cleanup");
    unlinkSync(item.path);
    if (existsSync(item.path)) throw new Error("broker ephemeral credential survived cleanup");
  }
}

export function consumeBrokeredDeployFromFds({ requestFd = 3, credentialFd = 4 } = {}) {
  if (process.execArgv.length !== 0 || Object.keys(process.env).length !== 0) {
    throw new Error("brokered deploy requires exact empty runtime environment and no Node startup options");
  }
  const request = parseCanonical(readUnlinkedFD(requestFd, "broker-attested run request", 0o400, MAX_REQUEST), "broker-attested run request");
  validateRequest(request);
  assertParent(request);
  const payload = readCredential(credentialFd, request.credential.names);
  const materialized = materialize(request, payload);
  const attestation = Object.freeze(Object.create(null));
  pending.set(attestation, { request, env: materialized.env, files: materialized.files });
  return attestation;
}

export function takeBrokeredDeploy(attestation) {
  const value = pending.get(attestation);
  if (value === undefined) throw new Error("brokered deploy attestation is absent, forged, or already consumed");
  pending.delete(attestation);
  return value;
}

export function abandonBrokeredDeploy(attestation) {
  const value = pending.get(attestation);
  if (value === undefined) return;
  pending.delete(attestation);
  cleanup(value.files);
}

export function finishBrokeredDeploy(value) {
  cleanup(value.files);
}
