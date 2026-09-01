#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RUNTIME_VERSION = /^v\d+\.\d+\.\d+$/u;
const WRANGLER_VERSION = "4.115.0";

function exactKeys(value, expected) {
  return JSON.stringify(Object.keys(value ?? {}).sort()) ===
    JSON.stringify([...expected].sort());
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalRecords(records) {
  return JSON.stringify(records);
}

function relationIsInside(root, candidate) {
  const value = relative(root, candidate);
  return value === "" ||
    (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

function acceptableOwner(info, label) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && info.uid !== 0 && info.uid !== uid) {
    throw new Error(`${label} is not owned by root or the current user`);
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
      records.push({
        path,
        sha256: digest(readFileSync(source)),
        executable: (sourceInfo.mode & 0o111) !== 0,
      });
    }
  };
  visit(closureRoot);
  if (records.length === 0) throw new Error("installed dependency/tool closure is empty");
  return records;
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
    acceptableOwner(directoryInfo, `sealed tool closure directory ${directory}`);
    for (const name of readdirSync(directory).sort()) {
      const absolute = join(directory, name);
      const path = prefix === "" ? name : `${prefix}/${name}`;
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`sealed tool closure contains a symlink: ${path}`);
      }
      acceptableOwner(info, `sealed tool closure entry ${path}`);
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
  if (records.length === 0) throw new Error("sealed dependency/tool closure is empty");
  return records;
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

function makeReadOnly(root) {
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

export function validateSchemaToolRuntimePolicy(
  policy,
  { requireCurrent = false } = {},
) {
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

export function parseSchemaToolClosurePolicy(raw) {
  let policy;
  try {
    policy = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (error) {
    throw new Error(`schema tool-closure policy is not JSON: ${error.message}`);
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
    policy.format !== "takoform.schema-origin-tool-closure@v1" ||
    policy.platform !== process.platform ||
    policy.architecture !== process.arch ||
    policy.closureRoot !== "node_modules" ||
    policy.executable !== "wrangler/bin/wrangler.js" ||
    policy.wranglerVersion !== WRANGLER_VERSION ||
    !Number.isSafeInteger(policy.fileCount) ||
    policy.fileCount < 1 ||
    !SHA256.test(policy.manifestSha256 ?? "")
  ) {
    throw new Error("schema tool-closure policy does not pin this exact runtime and Wrangler closure");
  }
  validateSchemaToolRuntimePolicy(policy);
  return policy;
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
  if (
    canonicalRecords(before) !== canonicalRecords(after) ||
    canonicalRecords(before) !== canonicalRecords(copied)
  ) {
    throw new Error("installed dependency/tool closure changed while it was sealed");
  }
  makeReadOnly(destination);
  const sealed = sealedClosureRecords(destination);
  if (canonicalRecords(sealed) !== canonicalRecords(before)) {
    throw new Error("read-only dependency/tool closure differs from its source seal");
  }
  const manifestSha256 = digest(Buffer.from(canonicalRecords(sealed)));
  const executable = resolve(destination, "wrangler/bin/wrangler.js");
  if (!lstatSync(executable).isFile()) throw new Error("sealed Wrangler executable is missing");
  return Object.freeze({
    root: destination,
    executable,
    manifestSha256,
    fileCount: sealed.length,
    verify() {
      const current = sealedClosureRecords(destination);
      if (digest(Buffer.from(canonicalRecords(current))) !== manifestSha256) {
        throw new Error("sealed dependency/tool closure changed before credentialed execution");
      }
    },
  });
}
