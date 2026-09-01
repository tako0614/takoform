#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const schemaLedgerPath = "release/public-schema-identities.json";
const authorityPath = "release/schema-origin-authority.json";
const writerClosureManifestPath =
  "release/authority/schema-origin-writer-closure.json";
const trustProfilePath = "spec/trust/profile.json";

const extractedEvidence = Object.freeze({
  "docs/extraction/history/specification-compatibility.json":
    "2d65b2c0fe9d6ddfb8aa8866fb2e4946be5984402c7cbcf7a6a8f55b12d00faa",
  "docs/extraction/history/published-document-lanes.json":
    "f00211e3f0f943679e27976d2b9d06f96ea534eaeee80430b6e893b20d47dcb3",
  "docs/extraction/history/specification-1.1-publication-evidence.json":
    "6f2ba3d51261f2559d0738ed2b22f51d7066d4d5b9f9bf0213694f352b677a84",
  "docs/extraction/history/publication-blockers-v1beta1.json":
    "8bc708163e789b95833331a537abf1c455062179c0eef5b57c583c76b8d740e0",
  "docs/extraction/history/specification-1.1-publication-policy.md":
    "1828286b630758980a1a36c85321f7759c7134aeb05df0bba7953edfd942002c",
  "docs/extraction/history/w08-source-boundary-inventory.md":
    "f279a967a2d4435f8452fc2db548af93417a0a641f02fa2f68e8979550a95c70",
  "docs/extraction/source-path-map.json":
    "6542239003656464f8c78f87dca7d37f5e2b2ae358a49734d8f48a939bc52dad",
  "docs/extraction/w10-core-cutover.md":
    "876860586cae71f1f4bacb19edae2ccb0c8dcdd85cdf047efd2b9b0b95d2cc9f",
});

const importedSchemaPrefixes = Object.freeze({
  active: Object.freeze({
    count: 31,
    sha256:
      "e463f5d08bfaad90c800c9dab3587a61f37c768e5326f163cd7bea0d04132e68",
  }),
  retired: Object.freeze({
    count: 15,
    sha256:
      "32e6a5c2daaa9b03ff0c2f9b4a0a75da43b183afda2d964525695c514ce26201",
  }),
});

export const schemaOriginWriterClosurePaths = Object.freeze([
  "bun.lock",
  "package.json",
  "release/authority/schema-origin-tool-closure.json",
  "release/authority/schema-origin-writer-closure.json",
  "release/host-api-v1.json",
  "release/schema-origin-policy.md",
  "schema-origin/wrangler.jsonc",
  "scripts/deploy.mjs",
  "scripts/records.mjs",
  "scripts/schema-origin-deploy.mjs",
  "scripts/schema-origin-projection.mjs",
  "scripts/schema-tool-closure.mjs",
  "scripts/version-axis.mjs",
]);

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const CLOUDFLARE_ID = /^[0-9a-f]{32}$/u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

function problem(problems, message) {
  if (!problems.includes(message)) problems.push(message);
}

function exactKeys(value, expected) {
  return JSON.stringify(Object.keys(value ?? {}).sort()) ===
    JSON.stringify([...expected].sort());
}

function objectSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalDigest(value) {
  return `sha256:${objectSha256(value)}`;
}

function schemaRouteCutoverClosure(cutover) {
  return {
    format: cutover?.format,
    sourceCommit: cutover?.sourceCommit,
    predecessorTombstoneCommit: cutover?.predecessorTombstoneCommit,
    candidateSha256: cutover?.candidateSha256,
    stageRecordSha256: cutover?.stageRecordSha256,
    cutoverRecordSha256: cutover?.cutoverRecordSha256,
    predecessorReadbackSha256: cutover?.predecessorReadbackSha256,
    routeId: cutover?.routeId,
    routePattern: cutover?.routePattern,
    worker: cutover?.worker,
    versionId: cutover?.versionId,
    deploymentId: cutover?.deploymentId,
    completedReadbackAt: cutover?.completedReadbackAt,
    freshReadbackAt: cutover?.freshReadbackAt,
  };
}

export function schemaRouteCutoverClosureSha256(cutover) {
  return canonicalDigest(schemaRouteCutoverClosure(cutover));
}

export function validateSchemaLedgerShape(ledger) {
  const problems = [];
  if (ledger?.kind !== "takoform.public-schema-identities@v1") {
    problem(
      problems,
      "schema ledger kind must remain takoform.public-schema-identities@v1",
    );
  }
  const seenIDs = new Set();
  const seenSources = new Set();
  const seenPublicPaths = new Set();
  const seenDigests = new Set();
  for (const [state, entries] of [
    ["active", ledger?.identities],
    ["verify-only", ledger?.retired],
  ]) {
    if (!Array.isArray(entries)) {
      problem(problems, `${state} schema identities must be an array`);
      continue;
    }
    for (const entry of entries) {
      const expectedKeys =
        state === "active"
          ? ["id", "sha256", "source", "public"]
          : ["id", "sha256", "source", "public", "retiredBecause"];
      if (!exactKeys(entry, expectedKeys)) {
        problem(problems, `${state} schema ${entry?.id} has an unexpected field set`);
      }
      if (typeof entry?.id !== "string" || seenIDs.has(entry.id)) {
        problem(problems, `${state} schema id is missing or duplicated: ${entry?.id}`);
      }
      seenIDs.add(entry?.id);
      if (
        typeof entry?.source !== "string" ||
        !entry.source.startsWith("spec/schemas/") ||
        seenSources.has(entry.source)
      ) {
        problem(
          problems,
          `${state} schema source is invalid or duplicated: ${entry?.source}`,
        );
      }
      seenSources.add(entry?.source);
      if (
        typeof entry?.public !== "string" ||
        entry.public === "" ||
        seenPublicPaths.has(entry.public)
      ) {
        problem(
          problems,
          `${state} schema public path is invalid or duplicated: ${entry?.public}`,
        );
      }
      seenPublicPaths.add(entry?.public);
      if (!SHA256.test(entry?.sha256 ?? "")) {
        problem(problems, `${state} schema ${entry?.id} has a non-canonical digest`);
      } else if (seenDigests.has(entry.sha256)) {
        problem(problems, `${state} schema digest is duplicated: ${entry.sha256}`);
      }
      seenDigests.add(entry?.sha256);
      if (state === "verify-only" && typeof entry?.retiredBecause !== "string") {
        problem(problems, `verify-only schema ${entry?.id} lacks retirement evidence`);
      }
      if (
        /^https:\/\/forms\.takoform\.com\/(?:[^\s?#]*\/)?v2(?:[/.]|$)/u.test(
          entry?.id ?? "",
        ) ||
        /(?:^|[/_-])v2(?:[./_-]|$)/u.test(entry?.source ?? "") ||
        /(?:^|[/_-])v2(?:[./_-]|$)/u.test(entry?.public ?? "")
      ) {
        problem(
          problems,
          `schema ledger contains a forbidden API v2 identity: ${entry.id}`,
        );
      }
    }
  }
  for (const [field, baseline] of [
    ["identities", importedSchemaPrefixes.active],
    ["retired", importedSchemaPrefixes.retired],
  ]) {
    const entries = ledger?.[field];
    if (!Array.isArray(entries) || entries.length < baseline.count) {
      problem(problems, `imported schema ${field} prefix was removed`);
      continue;
    }
    if (objectSha256(entries.slice(0, baseline.count)) !== baseline.sha256) {
      problem(problems, `imported schema ${field} prefix changed or moved`);
    }
  }
  if (
    !Array.isArray(ledger?.retired) ||
    ledger.retired.length !== importedSchemaPrefixes.retired.count
  ) {
    problem(
      problems,
      "schema retirement is frozen at the imported 15-entry verify-only prefix",
    );
  }
  return problems;
}

export function validateSchemaOriginAuthority(authority) {
  const problems = [];
  const expectedKeys = [
    "format",
    "state",
    "hostApi",
    "hostApiClosure",
    "schemaLedger",
    "predecessorRepository",
    "predecessorCutoffCommit",
    "predecessorCutoffTree",
    "successorRepository",
    "predecessorTombstoneCommit",
    "schemaRouteCutover",
    "predecessorWriterDisabledAt",
    "successorWriterEnabledAt",
    "writerOverlapAllowed",
    "rollback",
  ];
  if (
    !exactKeys(authority, expectedKeys) ||
    authority?.format !== "takoform.schema-origin-authority-transfer@v1"
  ) {
    problem(problems, "schema-origin authority has an invalid closed envelope");
    return problems;
  }
  if (
    authority.hostApi !== "forms.takoform.com/v1" ||
    authority.hostApiClosure !== "release/host-api-v1.json" ||
    authority.schemaLedger !== schemaLedgerPath
  ) {
    problem(problems, "schema-origin authority must bind the literal Host API v1 closure and schema ledger");
  }
  if (
    authority.predecessorRepository !==
      "https://github.com/tako0614/terraform-provider-takoform.git" ||
    authority.successorRepository !== "https://github.com/tako0614/takoform.git" ||
    !COMMIT.test(authority.predecessorCutoffCommit ?? "") ||
    !COMMIT.test(authority.predecessorCutoffTree ?? "")
  ) {
    problem(problems, "schema-origin authority repository or commit identity is invalid");
  }
  if (authority.writerOverlapAllowed !== false) {
    problem(problems, "schema-origin authority must forbid writer overlap");
  }
  if (
    typeof authority.rollback !== "string" ||
    !authority.rollback.includes("repair forward") ||
    !authority.rollback.includes("never reopen the predecessor schema writer")
  ) {
    problem(problems, "schema-origin authority lacks the exact forward-repair boundary");
  }
  if (authority.state === "prepared-writer-disabled") {
    for (const field of [
      "predecessorTombstoneCommit",
      "schemaRouteCutover",
      "predecessorWriterDisabledAt",
      "successorWriterEnabledAt",
    ]) {
      if (authority[field] !== null) {
        problem(problems, `prepared schema-origin authority must keep ${field} null`);
      }
    }
  } else if (authority.state === "successor-active") {
    if (
      !COMMIT.test(authority.predecessorTombstoneCommit ?? "") ||
      !INSTANT.test(authority.predecessorWriterDisabledAt ?? "") ||
      !INSTANT.test(authority.successorWriterEnabledAt ?? "") ||
      authority.schemaRouteCutover === null
    ) {
      problem(problems, "active schema-origin authority lacks exact cutover evidence");
    }
  } else {
    problem(problems, "schema-origin authority has an unknown state");
  }
  const cutover = authority.schemaRouteCutover;
  if (cutover !== null) {
    const closure = schemaRouteCutoverClosure(cutover);
    if (
      cutover.format !== "takoform.schema-origin-authority-cutover@v1" ||
      !COMMIT.test(cutover.sourceCommit ?? "") ||
      !COMMIT.test(cutover.predecessorTombstoneCommit ?? "") ||
      !SHA256.test(cutover.candidateSha256 ?? "") ||
      !SHA256.test(cutover.stageRecordSha256 ?? "") ||
      !SHA256.test(cutover.cutoverRecordSha256 ?? "") ||
      !SHA256.test(cutover.predecessorReadbackSha256 ?? "") ||
      !CLOUDFLARE_ID.test(cutover.routeId ?? "") ||
      cutover.routePattern !== "forms.takoform.com/schemas/*" ||
      cutover.worker !== "takoform-schema-origin" ||
      !UUID.test(cutover.versionId ?? "") ||
      !UUID.test(cutover.deploymentId ?? "") ||
      !INSTANT.test(cutover.completedReadbackAt ?? "") ||
      !INSTANT.test(cutover.freshReadbackAt ?? "") ||
      cutover.closureSha256 !== canonicalDigest(closure)
    ) {
      problem(problems, "schema-origin authority cutover closure is invalid");
    }
  }
  return problems;
}

export function validateSchemaOriginWriterClosureManifest(manifest) {
  const problems = [];
  if (
    !exactKeys(manifest, ["format", "paths"]) ||
    manifest?.format !== "takoform.schema-origin-writer-closure@v1" ||
    !Array.isArray(manifest?.paths) ||
    new Set(manifest.paths).size !== manifest.paths.length ||
    JSON.stringify(manifest.paths) !== JSON.stringify(schemaOriginWriterClosurePaths)
  ) {
    problem(
      problems,
      "schema-origin writer closure manifest must name the exact ordered execution closure",
    );
  }
  return problems;
}

export function validateTrustProfile(profile) {
  const problems = [];
  if (profile?.format !== "takoform.core-trust-profile@v1") {
    problem(problems, "Core trust profile has an unknown format");
  }
  const policy = profile?.publisherPolicy;
  const fields = [...(policy?.requiredExactFields ?? [])].sort();
  if (
    policy?.callerSupplied !== true ||
    JSON.stringify(fields) !==
      JSON.stringify(["oidcIssuer", "ref", "sourceRepository", "workflow"])
  ) {
    problem(
      problems,
      "Core trust profile must require the complete caller-supplied publisher policy",
    );
  }
  for (const field of [
    "publisherClassField",
    "officialTrustBypass",
    "defaultPublisher",
  ]) {
    if (policy?.[field] !== false) {
      problem(problems, `Core trust profile must set ${field} to false`);
    }
  }
  if (
    profile?.signature?.ambientTrustedRoot !== false ||
    profile?.signature?.offlineVerification !== true
  ) {
    problem(
      problems,
      "Core trust profile must use explicit offline trust inputs without an ambient root",
    );
  }
  const serialized = JSON.stringify(profile);
  if (
    serialized.includes("terraform-provider-takoform") ||
    serialized.includes("registry.terraform.io")
  ) {
    problem(problems, "Core trust profile contains Provider or Registry authority");
  }
  return problems;
}

async function schemaFiles(root) {
  const directory = resolve(root, "spec/schemas");
  return (await readdir(directory))
    .filter((name) => name.endsWith(".schema.json"))
    .map((name) => `spec/schemas/${name}`)
    .sort();
}

export async function validateRepositoryRecords(root = ".") {
  const problems = [];
  const absoluteRoot = await realpath(resolve(root));
  const schemaLedger = JSON.parse(
    await readFile(resolve(absoluteRoot, schemaLedgerPath), "utf8"),
  );
  const authority = JSON.parse(
    await readFile(resolve(absoluteRoot, authorityPath), "utf8"),
  );
  const writerClosureManifest = JSON.parse(
    await readFile(resolve(absoluteRoot, writerClosureManifestPath), "utf8"),
  );
  const trustProfile = JSON.parse(
    await readFile(resolve(absoluteRoot, trustProfilePath), "utf8"),
  );
  problems.push(...validateSchemaLedgerShape(schemaLedger));
  problems.push(...validateSchemaOriginAuthority(authority));
  problems.push(
    ...validateSchemaOriginWriterClosureManifest(writerClosureManifest),
  );
  problems.push(...validateTrustProfile(trustProfile));

  const entries = [
    ...(schemaLedger.identities ?? []),
    ...(schemaLedger.retired ?? []),
  ];
  const ledgerSources = new Set(entries.map((entry) => entry.source));
  for (const source of await schemaFiles(absoluteRoot)) {
    if (!ledgerSources.has(source)) {
      problem(problems, `unrecorded public schema source: ${source}`);
    }
  }
  for (const entry of entries) {
    const sourcePath = resolve(absoluteRoot, entry.source ?? "");
    try {
      const resolved = await realpath(sourcePath);
      const info = await stat(sourcePath);
      if (
        resolved !== sourcePath ||
        !resolved.startsWith(absoluteRoot + sep) ||
        !info.isFile()
      ) {
        problem(
          problems,
          `schema source must be one ordinary in-repository file: ${entry.source}`,
        );
        continue;
      }
      const raw = await readFile(sourcePath);
      const digest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
      if (digest !== entry.sha256) {
        problem(problems, `schema digest changed for ${entry.source}`);
      }
      const schema = JSON.parse(raw.toString("utf8"));
      if (schema.$id !== entry.id) {
        problem(problems, `schema $id differs from ledger for ${entry.source}`);
      }
    } catch (error) {
      problem(
        problems,
        `cannot validate schema source ${entry.source}: ${error.message}`,
      );
    }
  }
  for (const [path, expected] of Object.entries(extractedEvidence)) {
    try {
      const raw = await readFile(resolve(absoluteRoot, path));
      const digest = createHash("sha256").update(raw).digest("hex");
      if (digest !== expected) {
        problem(problems, `immutable extracted evidence changed: ${path}`);
      }
    } catch (error) {
      problem(
        problems,
        `cannot validate extracted evidence ${path}: ${error.message}`,
      );
    }
  }
  return problems;
}

export async function main() {
  const problems = await validateRepositoryRecords();
  if (problems.length !== 0) {
    for (const current of problems) console.error(`records: ${current}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "records: Host API v1 schema identities and historical extraction evidence are closed",
  );
}

if (import.meta.main) await main();
