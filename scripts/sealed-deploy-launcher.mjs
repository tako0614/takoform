#!/usr/bin/env node

// This module is deliberately credentialless. It may copy and seal reviewed
// source and private phase inputs, but it cannot mint an accepted capability or
// execute a credentialed phase. Only the independently installed static broker
// may do either of those things.

import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";

export const SEALED_PROPOSAL_FORMAT = "takoform.sealed-deploy-proposal@v2";
export const SEALED_REVIEW_FORMAT = "takoform.sealed-deploy-review@v2";
export const SEALED_SOURCE_REVIEW_FORMAT =
  "takoform.sealed-deploy-source-review@v1";
export const SEALED_REVIEW_NAMESPACE = "takoform-sealed-continuation-review-v2";
export const SEALED_BROKER_EXECUTABLE = "/usr/local/libexec/takoform-sealed-deploy-broker";
export const SEALED_BROKER_STATE_ROOT = "/var/lib/takoform-sealed-deploy-broker";
export const SEALED_TRUST_ROOT = "/etc/takoform/release/sealed-continuation-review.pub";
export const SEALED_REVIEW_FINGERPRINT = "SHA256:86DoAm86Ps8C2G97eVpFU/On8UyESZfVboCnX63tYXU";
export const SEALED_CONTINUATION_RUNTIME = "/usr/local/bin/node";
export const SEALED_CONTINUATION_GIT = "/usr/bin/git";
export const SEALED_CONTINUATION_BUN =
  "/usr/local/lib/node_modules/bun/node_modules/@oven/bun-linux-x64-baseline/bin/bun";
export const SEALED_CONTINUATION_SSH_KEYGEN = "/usr/bin/ssh-keygen";
export const SEALED_CONTINUATION_CREDENTIAL_FD = 3;

const COMMIT = /^[0-9a-f]{40}$/u;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_PROPOSAL_BYTES = 16 * 1024 * 1024;
const PT_INTERP = 3;
const SOURCE_REVIEW_TOPICS = Object.freeze([
  "broker-static-boundary",
  "raw-reviewed-source",
  "sealed-closure-proposal",
]);

const CREDENTIAL_ENV_NAMES = Object.freeze([
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ZONE_ID",
  "GH_TOKEN",
  "TAKOFORM_CORE_REF_WRITE_TOKEN",
  "TAKOFORM_CORE_TAG_SIGNING_KEY",
  "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
  "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
]);

export const SEALED_FORBIDDEN_AMBIENT_ENV = Object.freeze(new Set([
  "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GITHUB_PAT",
  "TAKOFORM_CORE_TAG_SIGNING_KEY", "TAKOFORM_CORE_REF_WRITE_TOKEN",
  "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN", "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
  "TAKOFORM_SPECIFICATION_TAG_SIGNING_KEY", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID", "CF_API_TOKEN",
  "CF_API_KEY", "CF_API_EMAIL", "NPM_TOKEN", "NODE_AUTH_TOKEN", "BUN_AUTH_TOKEN",
  "YARN_NPM_AUTH_TOKEN", "GOAUTH", "NETRC", "SSH_AUTH_SOCK", "SSH_ASKPASS",
  "SSH_ASKPASS_REQUIRE", "GIT_ASKPASS", "GIT_SSH", "GIT_SSH_COMMAND", "GNUPGHOME",
  "GPG_AGENT_INFO", "GPG_TTY", "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS",
  "OPENSSL_CONF", "SSL_CERT_FILE", "SSL_CERT_DIR", "BUN_OPTIONS", "BUN_INSTALL",
  "NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG", "HTTP_PROXY", "HTTPS_PROXY",
  "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy",
  "BASH_ENV", "ENV", "CDPATH", "SHELLOPTS", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "LD_AUDIT", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH",
]));

export function canonicalJSON(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactStringArrays(left, right) {
  return canonicalJSON([...left].sort()) === canonicalJSON([...right].sort());
}

function forbiddenAmbientClass(name) {
  const upper = name.toUpperCase();
  const exact = new Set([...SEALED_FORBIDDEN_AMBIENT_ENV].map((entry) => entry.toUpperCase()));
  if (exact.has(upper)) return "exact";
  if (/(?:^|_)(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIALS?|API_KEY|ACCESS_KEY)(?:$|_)/u.test(upper)) return "credential";
  if (/^(?:BUN|DENO|NODE)_OPTIONS$/u.test(upper)) return "runtime-startup-options";
  if (/^(?:(?:BUN|DENO|NODE)_(?:LOADER|LOADERS|PATH|PRELOAD)|GLIBC_TUNABLES|LD_.*|DYLD_.*|__XPC_DYLD_.*)$/u.test(upper)) return "runtime-loaders";
  if (/(?:^|_)(?:CA_BUNDLE|CAFILE|CERT_DIR|CERT_FILE|EXTRA_CA_CERTS)$/u.test(upper)) return "custom-ca";
  if (/(?:^|_)(?:ALL|HTTP|HTTPS|NO)_PROXY$/u.test(upper)) return "proxy";
  if (/^(?:BASH_FUNC_.+|BASHOPTS|BASH_ENV|CDPATH|COMSPEC|ENV|PROMPT_COMMAND|SHELL|SHELLOPTS|ZDOTDIR)$/u.test(upper)) return "shell-startup";
  if (/^GIT_/u.test(upper)) return "git-overrides";
  if (/^(?:GPG_AGENT_INFO|SSH_AGENT_PID|SSH_ASKPASS(?:_REQUIRE)?|SSH_AUTH_SOCK|SUDO_ASKPASS)$/u.test(upper)) return "key-agent";
  return null;
}

function assertCredentiallessEnvironment(env) {
  for (const name of Object.keys(env)) {
    if (forbiddenAmbientClass(name) !== null) {
      throw new Error(`credentialless continuation proposal rejects ambient authority/injection ${name}`);
    }
  }
}

function fileIdentity(info) {
  return {
    dev: info.dev, ino: info.ino, uid: info.uid, gid: info.gid,
    mode: info.mode & 0o777, nlink: info.nlink, size: info.size, mtimeMs: info.mtimeMs,
  };
}

function stableReadFile(path, label, maximum = MAX_FILE_BYTES, { owners, exactMode } = {}) {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  const before = lstatSync(path);
  const allowedOwners = owners ?? [0, process.getuid?.()];
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 ||
      !allowedOwners.includes(before.uid) || (before.mode & 0o022) !== 0 ||
      (exactMode !== undefined && (before.mode & 0o777) !== exactMode) ||
      before.size <= 0 || before.size > maximum) {
    throw new Error(`${label} is not one private stable regular file`);
  }
  const raw = readFileSync(path);
  const after = lstatSync(path);
  if (canonicalJSON(fileIdentity(before)) !== canonicalJSON(fileIdentity(after))) {
    throw new Error(`${label} changed while it was read`);
  }
  return { raw, sha256: sha256(raw), identity: fileIdentity(before) };
}

function assertPrivateDirectory(path, label, { exactMode = 0o700, owners } = {}) {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  const info = lstatSync(path);
  const allowedOwners = owners ?? [0, process.getuid?.()];
  if (info.isSymbolicLink() || !info.isDirectory() || realpathSync(path) !== resolve(path) ||
      !allowedOwners.includes(info.uid) || (info.mode & 0o022) !== 0 ||
      (exactMode !== undefined && (info.mode & 0o777) !== exactMode)) {
    throw new Error(`${label} is not one private root/current-user-owned directory`);
  }
  return { path: realpathSync(path), ...fileIdentity(info) };
}

function trustedExecutable(path, label, { rootOnly = false, exactMode } = {}) {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  const resolved = realpathSync(path);
  const info = statSync(resolved);
  const owners = rootOnly ? [0] : [0, process.getuid?.()];
  if (!info.isFile() || info.nlink !== 1 || !owners.includes(info.uid) ||
      (info.mode & 0o022) !== 0 || (exactMode !== undefined && (info.mode & 0o777) !== exactMode)) {
    throw new Error(`${label} is not one trusted absolute executable`);
  }
  const raw = readFileSync(resolved);
  const after = statSync(resolved);
  if (canonicalJSON(fileIdentity(info)) !== canonicalJSON(fileIdentity(after))) {
    throw new Error(`${label} changed while it was measured`);
  }
  return { path: resolved, sha256: sha256(raw), ...fileIdentity(info) };
}

function assertStaticELF(path, identity) {
  const fd = openSync(path, "r");
  try {
    const header = Buffer.alloc(64);
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
        header.subarray(0, 4).toString("hex") !== "7f454c46" || header[4] !== 2 || header[5] !== 1) {
      throw new Error("sealed broker must be one 64-bit little-endian ELF executable");
    }
    const programOffset = Number(header.readBigUInt64LE(32));
    const entrySize = header.readUInt16LE(54);
    const entryCount = header.readUInt16LE(56);
    if (entrySize < 56 || entryCount === 0 || programOffset <= 0 ||
        programOffset + entrySize * entryCount > identity.size) {
      throw new Error("sealed broker ELF program headers are invalid");
    }
    const programs = Buffer.alloc(entrySize * entryCount);
    if (readSync(fd, programs, 0, programs.length, programOffset) !== programs.length) {
      throw new Error("sealed broker ELF program headers are incomplete");
    }
    const buildIds = [];
    for (let index = 0; index < entryCount; index += 1) {
      const entry = index * entrySize;
      const type = programs.readUInt32LE(entry);
      if (type === PT_INTERP) {
        throw new Error("sealed broker must be statically linked without PT_INTERP");
      }
      if (type !== 4) continue;
      const offset = Number(programs.readBigUInt64LE(entry + 8));
      const size = Number(programs.readBigUInt64LE(entry + 32));
      if (offset < 0 || size <= 0 || offset + size > identity.size) throw new Error("sealed broker ELF note segment is invalid");
      const notes = Buffer.alloc(size);
      if (readSync(fd, notes, 0, size, offset) !== size) throw new Error("sealed broker ELF note segment is incomplete");
      for (let cursor = 0; cursor < notes.length;) {
        if (cursor + 12 > notes.length) throw new Error("sealed broker ELF note header is incomplete");
        const nameSize = notes.readUInt32LE(cursor);
        const descriptorSize = notes.readUInt32LE(cursor + 4);
        const noteType = notes.readUInt32LE(cursor + 8);
        cursor += 12;
        const nameEnd = cursor + nameSize;
        const descriptorStart = (nameEnd + 3) & ~3;
        const descriptorEnd = descriptorStart + descriptorSize;
        const next = (descriptorEnd + 3) & ~3;
        if (nameEnd > notes.length || descriptorEnd > notes.length || next > notes.length) throw new Error("sealed broker ELF note payload is invalid");
        const name = notes.subarray(cursor, nameEnd);
        if (noteType === 4 && name.equals(Buffer.from([0x47, 0x6f, 0x00, 0x00]))) {
          if (descriptorSize === 0) throw new Error("sealed broker Go build id is empty");
          buildIds.push(sha256(notes.subarray(descriptorStart, descriptorEnd)));
        }
        cursor = next;
      }
    }
    if (buildIds.length !== 1) throw new Error("sealed broker must contain exactly one Go build-id note");
    return buildIds[0];
  } finally {
    closeSync(fd);
  }
}

function trustedStaticBroker(path) {
  const broker = trustedExecutable(path, "sealed deploy broker", { rootOnly: true, exactMode: 0o555 });
  if (broker.path !== path) throw new Error("sealed deploy broker must be invoked by its exact real path");
  return { ...broker, staticBuildIdSha256: assertStaticELF(path, broker) };
}

function runGit(args, cwd, home) {
  const git = trustedExecutable(SEALED_CONTINUATION_GIT, "proposal Git").path;
  const result = spawnSync(git, [
    "--no-optional-locks", "--no-replace-objects", "-c", "credential.helper=",
    "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
    "-c", "core.attributesFile=/dev/null", "-c", "diff.external=",
    "-c", "protocol.ext.allow=never", ...args,
  ], {
    cwd,
    env: {
      PATH: "/usr/bin:/bin", HOME: home, GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
      GIT_NO_REPLACE_OBJECTS: "1", LC_ALL: "C",
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`credentialless proposal Git failed: ${(result.error?.message ?? result.stderr ?? "unknown failure").trim()}`);
  }
  return result.stdout;
}

function runBunInstall(cwd, home) {
  const bun = trustedExecutable(SEALED_CONTINUATION_BUN, "proposal Bun").path;
  const result = spawnSync(bun, ["install", "--frozen-lockfile", "--ignore-scripts", "--backend=copyfile"], {
    cwd,
    env: { HOME: home, TMPDIR: home, XDG_CACHE_HOME: join(home, "cache"), PATH: "/usr/local/bin:/usr/bin:/bin", LC_ALL: "C" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`credentialless proposal frozen Bun install failed: ${(result.error?.message ?? result.stderr ?? "unknown failure").trim()}`);
  }
}

function sanitizeCredentialedGitMetadata(repository) {
  const git = join(repository, ".git");
  for (const forbidden of [
    "commondir", "config.worktree", "gitdir", "shallow", "worktrees",
    join("info", "attributes"), join("objects", "info", "alternates"),
    join("objects", "info", "commit-graph"), join("objects", "info", "commit-graphs"),
    join("objects", "pack", "multi-pack-index"), join("refs", "replace"),
  ]) {
    if (existsSync(join(git, forbidden))) throw new Error(`sealed proposal rejects Git metadata ${forbidden}`);
  }
  const pack = join(git, "objects", "pack");
  if (existsSync(pack) && readdirSync(pack).some((name) => name.endsWith(".promisor"))) {
    throw new Error("sealed proposal rejects partial/promisor Git objects");
  }
  rmSync(join(git, "hooks"), { recursive: true, force: true });
  mkdirSync(join(git, "hooks"), { mode: 0o700 });
}

function assertInternalSymlink(root, path, relativePath) {
  const target = readlinkSync(path);
  const resolved = resolve(dirname(path), target);
  const relation = relative(root, resolved);
  if (target.includes("\0") || relation === ".." || relation.startsWith(`..${sep}`) ||
      isAbsolute(relation) || !existsSync(resolved)) {
    throw new Error(`sealed closure rejects escaping or broken symlink ${relativePath}`);
  }
  return target;
}

function sealTree(root, relativeRoot = "") {
  const directory = relativeRoot === "" ? root : join(root, ...relativeRoot.split("/"));
  for (const name of readdirSync(directory).sort()) {
    const relativePath = relativeRoot === "" ? name : `${relativeRoot}/${name}`;
    const path = join(root, ...relativePath.split("/"));
    const info = lstatSync(path);
    if (info.isSymbolicLink()) assertInternalSymlink(root, path, relativePath);
    else if (info.isDirectory()) {
      sealTree(root, relativePath);
      chmodSync(path, 0o555);
    } else if (info.isFile() && info.nlink === 1) {
      chmodSync(path, (info.mode & 0o111) === 0 ? 0o444 : 0o555);
    } else throw new Error(`sealed closure rejects non-ordinary file ${relativePath}`);
  }
}

function walkTree(root, relativeRoot = "") {
  const directory = relativeRoot === "" ? root : join(root, ...relativeRoot.split("/"));
  const records = [];
  for (const name of readdirSync(directory).sort()) {
    const relativePath = relativeRoot === "" ? name : `${relativeRoot}/${name}`;
    const path = join(root, ...relativePath.split("/"));
    const before = lstatSync(path);
    if (before.uid !== 0 && before.uid !== process.getuid?.()) throw new Error(`sealed closure rejects foreign owner ${relativePath}`);
    if (before.isSymbolicLink()) {
      records.push({ path: relativePath, type: "symlink", target: assertInternalSymlink(root, path, relativePath), uid: before.uid, gid: before.gid, mode: before.mode & 0o777, dev: before.dev, ino: before.ino, nlink: before.nlink, mtimeMs: before.mtimeMs });
    } else if (before.isDirectory()) {
      if ((before.mode & 0o777) !== 0o555) throw new Error(`sealed closure directory is not exact mode 0555 ${relativePath}`);
      records.push({ path: relativePath, type: "directory", uid: before.uid, gid: before.gid, mode: before.mode & 0o777, dev: before.dev, ino: before.ino, nlink: before.nlink, mtimeMs: before.mtimeMs });
      records.push(...walkTree(root, relativePath));
    } else {
      if (!before.isFile() || before.nlink !== 1 || ![0o444, 0o555].includes(before.mode & 0o777)) {
        throw new Error(`sealed closure file is not exact private ordinary file ${relativePath}`);
      }
      const raw = readFileSync(path);
      const after = lstatSync(path);
      if (canonicalJSON(fileIdentity(before)) !== canonicalJSON(fileIdentity(after))) throw new Error(`sealed closure changed while read ${relativePath}`);
      records.push({ path: relativePath, type: "file", uid: before.uid, gid: before.gid, mode: before.mode & 0o777, dev: before.dev, ino: before.ino, nlink: before.nlink, size: before.size, mtimeMs: before.mtimeMs, sha256: sha256(raw) });
    }
  }
  return records;
}

function contentTreeDigest(inventory) {
  return sha256(Buffer.from(canonicalJSON(inventory.map((entry) => {
    if (entry.type === "file") return { path: entry.path, type: entry.type, mode: entry.mode, size: entry.size, sha256: entry.sha256 };
    if (entry.type === "symlink") return { path: entry.path, type: entry.type, target: entry.target };
    return { path: entry.path, type: entry.type, mode: entry.mode };
  }))));
}

function assertPrivateInputTree(path, label, relativeRoot = "") {
  const directory = relativeRoot === "" ? path : join(path, ...relativeRoot.split("/"));
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.uid !== 0 && info.uid !== process.getuid?.()) || (info.mode & 0o022) !== 0) {
    throw new Error(`${label} contains an unsafe directory ${relativeRoot || "."}`);
  }
  for (const name of readdirSync(directory).sort()) {
    const relativePath = relativeRoot === "" ? name : `${relativeRoot}/${name}`;
    const child = join(path, ...relativePath.split("/"));
    const childInfo = lstatSync(child);
    if (childInfo.isSymbolicLink()) throw new Error(`${label} rejects symlink ${relativePath}`);
    if (childInfo.isDirectory()) assertPrivateInputTree(path, label, relativePath);
    else stableReadFile(child, `${label} ${relativePath}`, MAX_FILE_BYTES);
  }
}

function copyPrivateTree(source, target, relativeRoot = "") {
  const sourceDirectory = relativeRoot === "" ? source : join(source, ...relativeRoot.split("/"));
  const targetDirectory = relativeRoot === "" ? target : join(target, ...relativeRoot.split("/"));
  mkdirSync(targetDirectory, { mode: 0o700 });
  for (const name of readdirSync(sourceDirectory).sort()) {
    const relativePath = relativeRoot === "" ? name : `${relativeRoot}/${name}`;
    const sourcePath = join(source, ...relativePath.split("/"));
    const targetPath = join(target, ...relativePath.split("/"));
    const info = lstatSync(sourcePath);
    if (info.isDirectory()) copyPrivateTree(source, target, relativePath);
    else {
      const file = stableReadFile(sourcePath, `sealed continuation input ${relativePath}`, MAX_FILE_BYTES);
      writeFileSync(targetPath, file.raw, { flag: "wx", mode: 0o600 });
    }
  }
}

function copyBoundInputs(root, args, inputFlags) {
  const rewritten = [...args];
  const records = [];
  const inputRoot = join(root, "inputs");
  mkdirSync(inputRoot, { mode: 0o700 });
  for (let index = 0; index < rewritten.length - 1; index += 1) {
    const flag = rewritten[index];
    if (!inputFlags.includes(flag)) continue;
    const source = rewritten[index + 1];
    if (!isAbsolute(source)) throw new Error(`sealed continuation input ${flag} must be absolute`);
    const sourceInfo = lstatSync(source);
    const target = join(inputRoot, `${String(records.length).padStart(3, "0")}-${basename(source)}`);
    if (sourceInfo.isDirectory() && !sourceInfo.isSymbolicLink()) {
      assertPrivateDirectory(source, `sealed continuation directory input ${flag}`, { exactMode: undefined });
      assertPrivateInputTree(source, `sealed continuation directory input ${flag}`);
      copyPrivateTree(source, target);
      sealTree(target);
      chmodSync(target, 0o555);
      const inventory = walkTree(target);
      rewritten[index + 1] = target;
      records.push({ flag, path: target, type: "directory", inventory, manifestSha256: sha256(Buffer.from(canonicalJSON(inventory))), treeSha256: contentTreeDigest(inventory) });
    } else {
      const file = stableReadFile(source, `sealed continuation input ${flag}`, MAX_FILE_BYTES);
      writeFileSync(target, file.raw, { flag: "wx", mode: 0o400 });
      chmodSync(target, 0o400);
      const copied = stableReadFile(target, `copied sealed continuation input ${flag}`, MAX_FILE_BYTES, { exactMode: 0o400 });
      rewritten[index + 1] = target;
      records.push({ flag, path: target, type: "file", sha256: copied.sha256, identity: copied.identity });
    }
    index += 1;
  }
  return { args: rewritten, inputs: records };
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

export function expectedCredentialBinding(args) {
  const surface = args[0];
  const phase = args[1];
  if (surface === "takoform-core-release") {
    const env = { audit: ["GH_TOKEN"], "sign-tag": ["TAKOFORM_CORE_TAG_SIGNING_KEY"], publish: ["GH_TOKEN"], "record-push": ["TAKOFORM_CORE_REF_WRITE_TOKEN"] }[phase];
    if (env) return { credentialClass: "broker-bound-exact-phase-authority-envelope", env };
  }
  if (surface === "takoform-schema-origin") {
    return { credentialClass: "broker-bound-exact-phase-authority-envelope", env: ["CLOUDFLARE_API_TOKEN"] };
  }
  if (surface === "takoform-specification-release") {
    const lane = flagValue(args, "--lane");
    let env;
    if (phase === "prepare" && ["schema", "composed"].includes(lane)) env = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID"];
    else if (["publish", "recover"].includes(phase) && lane === "specification") env = ["GH_TOKEN", "TAKOFORM_CORE_TAG_SIGNING_KEY", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"];
    else if (["publish", "recover"].includes(phase) && lane === "schema") env = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID"];
    else if (["publish", "recover"].includes(phase) && lane === "composed") env = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ZONE_ID", "GH_TOKEN", "TAKOFORM_CORE_TAG_SIGNING_KEY", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"];
    else if (phase === "prepare-receipt") env = ["TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"];
    else if (phase === "record") env = ["TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN", "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"];
    else if (phase === "verify" && lane !== "schema") env = ["TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN"];
    if (env) return { credentialClass: "broker-bound-exact-phase-authority-envelope", env };
  }
  throw new Error("sealed continuation invocation has no exact credentialed phase binding");
}

function parseOpenSSHPublicKey(raw) {
  const fields = raw.toString("utf8").trim().split(/\s+/u);
  if (fields[0] !== "ssh-ed25519" || fields.length < 2) throw new Error("continuation review trust root is not one SSH Ed25519 public key");
  const blob = Buffer.from(fields[1], "base64");
  if (blob.length < 4 || blob.readUInt32BE(0) !== 11 || blob.subarray(4, 15).toString("ascii") !== "ssh-ed25519") throw new Error("continuation review SSH public key blob is invalid");
  const offset = 15;
  if (blob.length !== offset + 4 + 32 || blob.readUInt32BE(offset) !== 32) throw new Error("continuation review SSH Ed25519 key length is invalid");
  const fingerprint = `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/u, "")}`;
  if (fingerprint !== SEALED_REVIEW_FINGERPRINT) throw new Error("continuation review public key fingerprint is not the pinned authority");
  return { sha256: sha256(raw), fingerprint, blobSha256: sha256(blob) };
}

function copySourceReview(root, path, source, rawSourceTreeSha256, broker) {
  assertPrivateDirectory(dirname(path), "continuation source review parent");
  const file = stableReadFile(path, "continuation source review", 1024 * 1024);
  let review;
  try { review = JSON.parse(file.raw.toString("utf8")); } catch (error) { throw new Error(`continuation source review is not JSON: ${error.message}`); }
  if (!exactStringArrays(Object.keys(review), [
    "approved", "brokerSha256", "format", "reviewed", "reviewedAt",
    "rawSourceTreeSha256", "reviewer", "source",
  ]) || review.format !== SEALED_SOURCE_REVIEW_FORMAT || review.approved !== true ||
      review.source !== source || review.brokerSha256 !== broker.sha256 ||
      review.rawSourceTreeSha256 !== rawSourceTreeSha256 ||
      review.reviewer !== "takoform-sealed-continuation-independent-reviewer" ||
      canonicalJSON(review.reviewed) !== canonicalJSON(SOURCE_REVIEW_TOPICS) ||
      `${canonicalJSON(review)}\n` !== file.raw.toString("utf8")) {
    throw new Error("continuation source review does not bind the exact source and installed broker");
  }
  const instant = new Date(review.reviewedAt ?? "");
  if (Number.isNaN(instant.valueOf()) || instant.toISOString() !== review.reviewedAt) throw new Error("continuation source review timestamp is not canonical UTC");
  const target = join(root, "inputs", "continuation-source-review.json");
  writeFileSync(target, file.raw, { flag: "wx", mode: 0o400 });
  chmodSync(target, 0o400);
  const copied = stableReadFile(target, "copied continuation source review", 1024 * 1024, { exactMode: 0o400 });
  if (copied.sha256 !== file.sha256) throw new Error("copied continuation source review differs from reviewed bytes");
  return { path: target, sha256: copied.sha256, identity: copied.identity };
}

export function prepareSealedProposal({
  repository,
  outputRoot,
  source,
  args,
  credentialEnv,
  credentialClass,
  continuationReview,
  inputFlags = [],
  brokerExecutable = SEALED_BROKER_EXECUTABLE,
  environment = process.env,
}) {
  assertCredentiallessEnvironment(environment);
  if (!isAbsolute(repository) || !isAbsolute(outputRoot) || !COMMIT.test(source)) throw new Error("sealed proposal repository/output/source is invalid");
  if (!isAbsolute(continuationReview)) throw new Error("sealed proposal continuation source review must be absolute");
  if (!Array.isArray(args) || args.length < 2 || args.some((value) => typeof value !== "string" || value.includes("\0"))) throw new Error("sealed proposal invocation is invalid");
  const expected = expectedCredentialBinding(args);
  if (credentialClass !== expected.credentialClass || !exactStringArrays(credentialEnv, expected.env) || credentialEnv.some((name) => !CREDENTIAL_ENV_NAMES.includes(name))) {
    throw new Error("sealed proposal credential environment is not the fixed phase allowlist");
  }
  if (existsSync(outputRoot)) throw new Error("sealed proposal output already exists");
  assertPrivateDirectory(dirname(outputRoot), "sealed proposal output parent");
  const broker = trustedStaticBroker(brokerExecutable);
  mkdirSync(outputRoot, { mode: 0o700 });
  const root = assertPrivateDirectory(outputRoot, "sealed proposal root");
  mkdirSync(join(root.path, "home"), { mode: 0o700 });
  const repositoryRoot = realpathSync(repository);
  runGit(["clone", "--no-local", "--no-tags", "--no-checkout", "--", repositoryRoot, join(root.path, "source")], root.path, join(root.path, "home"));
  runGit(["checkout", "--detach", source], join(root.path, "source"), join(root.path, "home"));
  runGit(["remote", "remove", "origin"], join(root.path, "source"), join(root.path, "home"));
  sanitizeCredentialedGitMetadata(join(root.path, "source"));
  if (runGit(["rev-parse", "--verify", "HEAD^{commit}"], join(root.path, "source"), join(root.path, "home")).trim() !== source) throw new Error("sealed proposal clone is not exact source S");
  runGit(["fsck", "--strict", "--full", "--no-reflogs"], join(root.path, "source"), join(root.path, "home"));
  if (runGit(["status", "--porcelain=v1", "--untracked-files=all"], join(root.path, "source"), join(root.path, "home")) !== "") throw new Error("sealed proposal clone is not exactly clean");
  if (["takoform-specification-release", "takoform-schema-origin"].includes(args[0])) {
    runBunInstall(join(root.path, "source"), join(root.path, "home"));
    if (runGit(["status", "--porcelain=v1", "--untracked-files=all"], join(root.path, "source"), join(root.path, "home")) !== "") throw new Error("sealed proposal frozen install changed tracked source");
  }
  const rawSourceTreeSha256 = sha256(Buffer.from(runGit(["ls-tree", "-r", "-z", "--full-tree", source], join(root.path, "source"), join(root.path, "home")), "utf8"));
  const bound = copyBoundInputs(root.path, args, inputFlags);
  const sourceReview = copySourceReview(
    root.path,
    continuationReview,
    source,
    rawSourceTreeSha256,
    broker,
  );
  chmodSync(join(root.path, "inputs"), 0o555);
  sealTree(join(root.path, "source"));
  chmodSync(join(root.path, "source"), 0o555);
  const inventory = walkTree(join(root.path, "source"));
  const closureManifestSha256 = sha256(Buffer.from(canonicalJSON(inventory)));
  const closureTreeSha256 = contentTreeDigest(inventory);
  const node = trustedExecutable(SEALED_CONTINUATION_RUNTIME, "sealed continuation Node");
  const git = trustedExecutable(SEALED_CONTINUATION_GIT, "sealed continuation Git");
  const sshKeygen = trustedExecutable(SEALED_CONTINUATION_SSH_KEYGEN, "sealed continuation ssh-keygen");
  const runtime = { continuationTools: { git, sshKeygen }, node };
  const preparationTools = {
    git,
    ...(["takoform-specification-release", "takoform-schema-origin"].includes(args[0])
      ? { bun: trustedExecutable(SEALED_CONTINUATION_BUN, "proposal Bun") }
      : {}),
  };
  const runtimeDependencyClosureSha256 = sha256(Buffer.from(canonicalJSON(runtime)));
  const trustRootFile = stableReadFile(join(root.path, "source", "release", "authority", "core-release-continuation-review.pub"), "raw-S continuation review public key", 4096, { exactMode: 0o444 });
  const trustRoot = parseOpenSSHPublicKey(trustRootFile.raw);
  const runnerPath = join(root.path, "source", "scripts", "sealed-deploy-runner.mjs");
  const runner = stableReadFile(runnerPath, "sealed deploy runner", MAX_PROPOSAL_BYTES, { exactMode: 0o444 });
  const invocationSha256 = sha256(Buffer.from(canonicalJSON({ args: bound.args, phase: args[1], surface: args[0] })));
  const launcherConfigSha256 = sha256(Buffer.from(canonicalJSON({
    brokerExecutable: broker.path, brokerStateRoot: SEALED_BROKER_STATE_ROOT,
    credentialFd: SEALED_CONTINUATION_CREDENTIAL_FD, reviewNamespace: SEALED_REVIEW_NAMESPACE,
    runnerPath, runtimeExecutable: node.path, trustRoot: SEALED_TRUST_ROOT,
  })));
  const identityEvidence = {
    "source.raw-source-tree-sha256": rawSourceTreeSha256,
    "source.review-record-sha256": sourceReview.sha256,
    "closure.closure-manifest-sha256": closureManifestSha256,
    "closure.closure-tree-sha256": closureTreeSha256,
    "runtime.runtime-executable-sha256": node.sha256,
    "runtime.runtime-dependency-closure-sha256": runtimeDependencyClosureSha256,
    "launcher.launcher-executable-sha256": broker.sha256,
    "launcher.launcher-config-sha256": launcherConfigSha256,
    "launcher.launcher-device": broker.dev,
    "launcher.launcher-inode": broker.ino,
    "launcher.launcher-owner-uid": broker.uid,
    "launcher.launcher-owner-gid": broker.gid,
    "launcher.launcher-mode": broker.mode,
  };
  const proposal = {
    format: SEALED_PROPOSAL_FORMAT,
    nonce: randomBytes(32).toString("hex"),
    root: { path: root.path, dev: root.dev, ino: root.ino, uid: root.uid, gid: root.gid, mode: root.mode },
    source: { commit: source, root: join(root.path, "source"), inventory, inventorySha256: closureManifestSha256, treeSha256: closureTreeSha256, rawSourceTreeSha256, reviewRecord: sourceReview },
    inputs: [...bound.inputs, { flag: "--continuation-review", ...sourceReview, type: "file" }],
    invocation: { surface: args[0], phase: args[1], args: bound.args, sha256: invocationSha256 },
    credential: { class: credentialClass, names: [...credentialEnv].sort(), fd: SEALED_CONTINUATION_CREDENTIAL_FD, transport: "protected-fd" },
    preparationTools,
    runtime,
    launcher: { broker, configSha256: launcherConfigSha256, runner: { path: runnerPath, sha256: runner.sha256 }, stateRoot: SEALED_BROKER_STATE_ROOT },
    review: { format: SEALED_REVIEW_FORMAT, namespace: SEALED_REVIEW_NAMESPACE, trustRootPath: SEALED_TRUST_ROOT, trustRootRepositorySha256: trustRootFile.sha256, trustRootBlobSha256: trustRoot.blobSha256, trustRootFingerprint: trustRoot.fingerprint },
    identityEvidence,
  };
  const proposalPath = join(root.path, "proposal.json");
  writeFileSync(proposalPath, `${canonicalJSON(proposal)}\n`, { flag: "wx", mode: 0o600 });
  const sealedProposal = stableReadFile(proposalPath, "sealed continuation proposal", MAX_PROPOSAL_BYTES, { exactMode: 0o600 });
  const reviewRequest = {
    approved: false,
    boundIdentityEvidence: identityEvidence,
    format: SEALED_REVIEW_FORMAT,
    invocation: proposal.invocation,
    proposalSha256: sealedProposal.sha256,
    reviewNamespace: SEALED_REVIEW_NAMESPACE,
    reviewedAt: "REVIEWER-MUST-SET-CANONICAL-UTC",
    reviewer: "takoform-sealed-continuation-independent-reviewer",
    sourceBinding: {
      closureManifestSha256,
      closureTreeSha256,
      commit: source,
      rawSourceTreeSha256,
      sourceReviewSha256: sourceReview.sha256,
    },
    trustRootFingerprint: SEALED_REVIEW_FINGERPRINT,
  };
  const reviewRequestPath = join(root.path, "review-request.json");
  writeFileSync(reviewRequestPath, `${canonicalJSON(reviewRequest)}\n`, { flag: "wx", mode: 0o600 });
  chmodSync(join(root.path, "home"), 0o500);
  return Object.freeze({
    format: "takoform.sealed-deploy-proposal-result@v2",
    source, surface: args[0], phase: args[1], proposalPath,
    proposalSha256: sealedProposal.sha256, reviewRequestPath,
    credentialNames: Object.freeze([...proposal.credential.names]),
    launcher: Object.freeze({
      executable: broker.path,
      argvPrefix: Object.freeze(["--proposal", proposalPath, "--proposal-sha256", sealedProposal.sha256]),
      reviewRecordFlag: "--review", reviewSignatureFlag: "--signature",
      credentialFd: SEALED_CONTINUATION_CREDENTIAL_FD,
      credentialTransport: "protected-fd", environment: "empty",
    }),
    review: Object.freeze({
      format: SEALED_REVIEW_FORMAT, namespace: SEALED_REVIEW_NAMESPACE,
      trustRootFingerprint: SEALED_REVIEW_FINGERPRINT, externalSigningOnly: true,
    }),
    identityEvidence: Object.freeze(identityEvidence),
  });
}
