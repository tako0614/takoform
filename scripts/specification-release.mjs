#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import {
  createHash,
  createPublicKey,
  verify as verifyEd25519,
} from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import process from "node:process";

import {
  classifySpecificationPublicationSource,
  validateAuthorityTransfer,
  validateRecordPrefixChain,
  validateSchemaLedgerShape,
  validateSpecificationLedger,
} from "./records.mjs";

export const AUTHORITY_PATH = "release/specification-authority.json";
export const AUTHORITY_PREPARED_STATE = "prepared-writer-disabled";
export const AUTHORITY_ACTIVE_STATE = "successor-active";
export const DORMANT_WRITER_GUARD = AUTHORITY_PREPARED_STATE;
export const SPECIFICATION_LEDGER_PATH = "release/specification-releases.json";
export const SCHEMA_LEDGER_PATH = "release/public-schema-identities.json";
export const PREFIX_CHAIN_PATH = "release/record-prefix-chain.json";
export const RECORD_HEAD_PATH = "release/record-head.json";
export const RECORD_HEAD_SIGNATURE_PATH = "release/record-head.sig.json";
export const RECORD_HEAD_PUBLIC_KEY_PATH =
  "release/authority/record-head-ed25519.pub.pem";
export const POLICY_PATH = "release/specification-release-policy.md";
export const CANDIDATE_PATH = "release/specification-release-candidate.json";
export const SCHEMA_ROUTE = "forms.takoform.com/schemas/*";
export const SPECIFICATION_TAG_RULESET_PATTERN =
  "refs/tags/specification/*";
export const SPECIFICATION_TAG_RULESET_RULES = Object.freeze([
  "deletion",
  "update",
]);
export const PINNED_RECORD_KEY_FINGERPRINT =
  "sha256:a4f2a0811b8d9432a8d5ecea246f768470d78d0ed53214a587ba2f7c238e8cbb";
export const N_TO_E_TRACKED_PATHS = Object.freeze([CANDIDATE_PATH]);
export const E_TO_R_TRACKED_PATHS = Object.freeze([
  SPECIFICATION_LEDGER_PATH,
  PREFIX_CHAIN_PATH,
  RECORD_HEAD_PATH,
  RECORD_HEAD_SIGNATURE_PATH,
]);
export const RESERVATION_TRACKED_PATHS = Object.freeze([
  SCHEMA_LEDGER_PATH,
  PREFIX_CHAIN_PATH,
  RECORD_HEAD_PATH,
  RECORD_HEAD_SIGNATURE_PATH,
]);
export const UNSIGNED_RESERVATION_PATHS = Object.freeze([
  SCHEMA_LEDGER_PATH,
  PREFIX_CHAIN_PATH,
  RECORD_HEAD_PATH,
]);
export const UNSIGNED_SPECIFICATION_RECEIPT_PATHS = Object.freeze([
  SPECIFICATION_LEDGER_PATH,
  PREFIX_CHAIN_PATH,
  RECORD_HEAD_PATH,
]);
export const SPECIFICATION_RELEASE_REVIEW_TOPICS = Object.freeze([
  "append-only-schema-and-source-closure",
  "create-only-signed-tag-and-immutable-release",
  "n-to-e-history-and-canonical-main",
  "schema-stage-activation-and-public-readback",
  "forward-only-recovery-and-receipt-cas",
]);
export const WRITER_CLOSURE_MANIFEST_PATH =
  "release/authority/specification-writer-closure.json";
export const WRITER_TOOL_CLOSURE_POLICY_PATH =
  "release/authority/specification-schema-tool-closure.json";
export const WRITER_EXECUTION_PATHS = Object.freeze([
  "bun.lock",
  "package.json",
  "release/authority/core-tag-allowed-signers",
  RECORD_HEAD_PUBLIC_KEY_PATH,
  WRITER_TOOL_CLOSURE_POLICY_PATH,
  WRITER_CLOSURE_MANIFEST_PATH,
  "release/core-release-policy.md",
  "release/schema-origin-policy.md",
  POLICY_PATH,
  "schema-origin/wrangler.jsonc",
  "scripts/core-release.mjs",
  "scripts/deploy.mjs",
  "scripts/records.mjs",
  "scripts/schema-origin-deploy.mjs",
  "scripts/schema-origin-projection.mjs",
  "scripts/specification-release-adapter.mjs",
  "scripts/specification-release.mjs",
]);
// Retained as an import-compatible name for the production adapter. The source
// root is P0, never E; callers must validate the checkpoint set explicitly.
export const SOURCE_PINNED_EXECUTION_PATHS = WRITER_EXECUTION_PATHS;

const FULL_COMMIT = /^[0-9a-f]{40}$/u;
const GIT_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const VERSION = /^1\.([0-9]+)$/u;
const SAFE_RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0).+$/u;
const FUTURE_RECEIPT_FORMAT = "takoform.specification-release-receipt@v1";
const CANDIDATE_FORMAT = "takoform.publication-candidate@v1";
const UNSIGNED_RECORD_ARTIFACT_FORMAT = "takoform.unsigned-record-change@v1";
const SEALED_RECORD_ARTIFACT_FORMAT = "takoform.sealed-record-change@v1";

export class SpecificationReleaseError extends Error {
  constructor(phase, stage, message, { externalStateTouched = false } = {}) {
    super(`specification release ${phase}/${stage}: ${message}`);
    this.name = "SpecificationReleaseError";
    this.phase = phase;
    this.stage = stage;
    this.externalStateTouched = externalStateTouched;
  }
}

function fail(phase, stage, message, state) {
  throw new SpecificationReleaseError(phase, stage, message, state);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sortJSON(value) {
  if (Array.isArray(value)) return value.map(sortJSON);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJSON(value[key])]),
    );
  }
  return value;
}

export function canonicalJSON(value) {
  return `${JSON.stringify(sortJSON(value), null, 2)}\n`;
}

function prettyJSON(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(raw) {
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function objectDigest(value) {
  return sha256(Buffer.from(JSON.stringify(value)));
}

function same(left, right) {
  return canonicalJSON(left) === canonicalJSON(right);
}

function exactKeys(value, expected) {
  return isRecord(value) &&
    same(Object.keys(value).sort(), [...expected].sort());
}

function assertFullCommit(value, label) {
  if (!FULL_COMMIT.test(value ?? "")) {
    throw new Error(`${label} must be one full lowercase commit`);
  }
}

function canonicalInstant(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value.replace("Z", ".000Z");
}

export function validateIndependentReview(review, request) {
  if (!exactKeys(review, [
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
  ]) || review.format !==
      "takoform.specification-release-independent-review@v1" ||
      review.approved !== true ||
      typeof review.reviewer !== "string" ||
      review.reviewer.trim() === "" ||
      review.reviewer.trim() !== review.reviewer ||
      !canonicalInstant(review.reviewedAt) ||
      !same(review.lanes, request.lanes) ||
      review.version !== request.version ||
      review.expectedDCommit !== request.expectedDCommit ||
      review.expectedNCommit !== request.expectedNCommit ||
      review.expectedECommit !== request.expectedECommit ||
      review.candidateSha256 !== request.candidateSha256 ||
      review.schemaOriginCandidateSha256 !==
        request.schemaOriginCandidateSha256 ||
      review.recovery !== request.recovery ||
      !same(review.reviewed, SPECIFICATION_RELEASE_REVIEW_TOPICS)) {
    throw new Error(
      "independent review record is incomplete or bound to another Specification release operation",
    );
  }
  return review;
}

function optionName(name) {
  return name.replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
}

const PHASE_OPTIONS = Object.freeze({
  reserve: {
    required: ["expected-d-commit", "output"],
    optional: [],
  },
  "apply-reservation": {
    required: ["expected-d-commit", "sealed-artifact"],
    optional: [],
  },
  seal: {
    required: ["input", "output", "signer"],
    optional: [],
  },
  prepare: {
    required: [
      "lane",
      "expected-d-commit",
      "expected-n-commit",
      "output",
    ],
    optional: ["version"],
  },
  publish: {
    required: [
      "lane",
      "expected-d-commit",
      "expected-n-commit",
      "expected-e-commit",
      "review-record",
    ],
    optional: ["version"],
  },
  recover: {
    required: [
      "lane",
      "expected-d-commit",
      "expected-n-commit",
      "expected-e-commit",
      "review-record",
    ],
    optional: ["version"],
  },
  "prepare-receipt": {
    required: [
      "version",
      "expected-d-commit",
      "expected-n-commit",
      "expected-e-commit",
      "output",
    ],
    optional: [],
  },
  record: {
    required: [
      "version",
      "expected-d-commit",
      "expected-n-commit",
      "expected-e-commit",
      "sealed-artifact",
    ],
    optional: [],
  },
  verify: {
    required: [
      "lane",
      "expected-d-commit",
      "expected-n-commit",
      "expected-e-commit",
    ],
    optional: ["version", "expected-r-commit"],
  },
});

export function parseSpecificationReleaseArgs(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("Specification release phase is required");
  }
  const phase = argv[0];
  const contract = PHASE_OPTIONS[phase];
  if (!contract) throw new Error(`unknown Specification release phase: ${phase}`);
  const allowed = [...contract.required, ...contract.optional];
  if ((argv.length - 1) % 2 !== 0) {
    throw new Error(`phase ${phase} requires option/value pairs`);
  }
  const options = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (typeof flag !== "string" || !flag.startsWith("--") || typeof value !== "string" || value === "") {
      throw new Error(`phase ${phase} has an invalid option/value pair`);
    }
    const name = flag.slice(2);
    if (!allowed.includes(name)) throw new Error(`phase ${phase} rejects --${name}`);
    if (Object.hasOwn(options, name)) throw new Error(`phase ${phase} repeats --${name}`);
    options[name] = value;
  }
  for (const name of contract.required) {
    if (!Object.hasOwn(options, name)) throw new Error(`phase ${phase} requires --${name}`);
  }
  if (Object.hasOwn(options, "lane") &&
      !["specification", "schema", "composed"].includes(options.lane)) {
    throw new Error("publication lane must be specification, schema, or composed");
  }
  if (options.lane === "schema" && Object.hasOwn(options, "version")) {
    throw new Error("schema-only publication rejects a Specification version");
  }
  if (options.lane !== undefined && options.lane !== "schema" &&
      !Object.hasOwn(options, "version")) {
    throw new Error(`${options.lane} publication requires --version`);
  }
  if (phase === "verify" && options.lane === "schema" &&
      Object.hasOwn(options, "expected-r-commit")) {
    throw new Error("schema-only verification has no Specification receipt commit");
  }
  if (phase === "verify" && options.lane !== "schema" &&
      !Object.hasOwn(options, "expected-r-commit")) {
    throw new Error("Specification verification requires --expected-r-commit");
  }
  if (Object.hasOwn(options, "version")) {
    const versionMatch = VERSION.exec(options.version);
    if (!versionMatch || Number(versionMatch[1]) < 2) {
      throw new Error("future Specification version must be an unreused 1.x minor after 1.1");
    }
  }
  for (const [name, value] of Object.entries(options)) {
    if (name.includes("commit")) assertFullCommit(value, `--${name}`);
    if (["input", "output", "signer", "review-record", "sealed-artifact"].includes(name) &&
        !isAbsolute(value)) {
      throw new Error(`--${name} must be an absolute path`);
    }
  }
  return {
    phase,
    ...Object.fromEntries(
      Object.entries(options).map(([name, value]) => [optionName(name), value]),
    ),
  };
}

function occupiedSpecificationVersions(ledger) {
  const values = [];
  for (const entry of [
    ...(Array.isArray(ledger?.reserved) ? ledger.reserved : []),
    ...(Array.isArray(ledger?.releases) ? ledger.releases : []),
  ]) {
    if (typeof entry?.version === "string") values.push(entry.version);
  }
  if (typeof ledger?.candidate?.version === "string") values.push(ledger.candidate.version);
  return values;
}

export function assertAllowedFutureVersion(version, ledger) {
  const match = VERSION.exec(version ?? "");
  if (!match) throw new Error("future Specification versions must stay on major 1");
  const requestedMinor = Number(match[1]);
  if (!Number.isSafeInteger(requestedMinor) || requestedMinor < 2) {
    throw new Error("Specification 1.0 and 1.1 can never be issued or reissued");
  }
  const occupied = occupiedSpecificationVersions(ledger);
  if (occupied.includes(version)) {
    throw new Error(`Specification ${version} is already occupied and cannot be reissued`);
  }
  const usedMinors = occupied
    .map((value) => VERSION.exec(value))
    .filter(Boolean)
    .map((value) => Number(value[1]));
  const next = Math.max(1, ...usedMinors) + 1;
  if (requestedMinor !== next) {
    throw new Error(`future Specification version must be the next unused minor 1.${next}`);
  }
  return version;
}

function containsForbiddenV2(value) {
  if (typeof value === "string") {
    return /forms\.takoform\.com\/(?:[^\s/?#]+\/)*v2(?:[/.]|$)/u.test(value) ||
      /specification\/(?:v)?2(?:[./]|$)/u.test(value) ||
      /^2\.[0-9]+$/u.test(value) ||
      /takoform\.specification@(?:v)?2(?:[./]|$)/u.test(value) ||
      /^takoform\.[a-z0-9.-]+@v2$/u.test(value);
  }
  if (Array.isArray(value)) return value.some(containsForbiddenV2);
  if (isRecord(value)) return Object.values(value).some(containsForbiddenV2);
  return false;
}

function assertNoV2(value, label) {
  if (containsForbiddenV2(value)) {
    throw new Error(`${label} contains a permanently forbidden API/Specification v2 identity`);
  }
}

export function assertMutationAuthority(authority, phase = "mutation") {
  const problems = validateAuthorityTransfer(authority);
  if (problems.length !== 0) {
    fail(phase, "authority", problems.join("; "));
  }
  if (authority.state !== AUTHORITY_ACTIVE_STATE) {
    fail(
      phase,
      "authority",
      `writer is dormant in ${authority.state}; ${phase} is forbidden before successor activation`,
    );
  }
  return authority;
}

function validateClosurePoint(point, label, expectedCommit = null) {
  if (!exactKeys(point, ["commit", "pathObjects"]) ||
      !FULL_COMMIT.test(point?.commit ?? "") ||
      (expectedCommit !== null && point.commit !== expectedCommit) ||
      !exactKeys(point?.pathObjects, WRITER_EXECUTION_PATHS)) {
    throw new Error(`immutable P0 writer ${label} observation is not closed`);
  }
  for (const path of WRITER_EXECUTION_PATHS) {
    if (!GIT_OBJECT.test(point.pathObjects[path] ?? "")) {
      throw new Error(`immutable P0 writer ${label} has an invalid blob for ${path}`);
    }
  }
  return point;
}

export function validateWriterExecutionClosureObservation(
  observed,
  { authority, checkpoints },
) {
  if (validateAuthorityTransfer(authority).length !== 0 ||
      authority?.state !== AUTHORITY_ACTIVE_STATE ||
      !FULL_COMMIT.test(authority?.successorPreparedCommit ?? "")) {
    throw new Error("immutable writer execution requires active authority with exact P0");
  }
  if (!exactKeys(observed, ["prepared", "checkpoints", "current"]) ||
      !Array.isArray(checkpoints) || checkpoints.length === 0 ||
      checkpoints.some((commit) => !FULL_COMMIT.test(commit ?? "")) ||
      !Array.isArray(observed.checkpoints) ||
      observed.checkpoints.length !== checkpoints.length) {
    throw new Error("immutable P0 writer checkpoint observation is not closed");
  }
  const prepared = validateClosurePoint(
    observed.prepared,
    "root",
    authority.successorPreparedCommit,
  );
  const labels = ["D", "N", "E"];
  const points = observed.checkpoints.map((point, index) =>
    validateClosurePoint(
      point,
      labels[index] ?? `checkpoint-${index + 1}`,
      checkpoints[index],
    ));
  const current = validateClosurePoint(observed.current, "current");
  for (const [index, point] of [...points, current].entries()) {
    const label = index < points.length
      ? (labels[index] ?? `checkpoint-${index + 1}`)
      : "current";
    for (const path of WRITER_EXECUTION_PATHS) {
      if (point.pathObjects[path] !== prepared.pathObjects[path]) {
        throw new Error(`immutable P0 writer blob changed at ${label}: ${path}`);
      }
    }
  }
  return { prepared, checkpoints: points, current };
}

function validateCurrentRecords(state) {
  const problems = [
    ...validateSpecificationLedger(state?.specificationLedger),
    ...validateSchemaLedgerShape(state?.schemaLedger),
    ...validateRecordPrefixChain(
      state?.prefixChain,
      state?.specificationLedger,
      state?.schemaLedger,
    ),
  ];
  if (problems.length !== 0) {
    throw new Error(`current append-only records are invalid: ${problems.join("; ")}`);
  }
}

function assertSchemaEntry(entry) {
  if (!exactKeys(entry, ["id", "sha256", "source", "public"])) {
    throw new Error("new schema entries must contain exactly id, sha256, source and public");
  }
  if (typeof entry.id !== "string" ||
      !entry.id.startsWith("https://forms.takoform.com/schemas/") ||
      containsForbiddenV2(entry.id)) {
    throw new Error(`new schema has an invalid or forbidden identity: ${entry.id}`);
  }
  if (typeof entry.source !== "string" ||
      !entry.source.startsWith("spec/schemas/") ||
      !entry.source.endsWith(".schema.json") ||
      !SAFE_RELATIVE_PATH.test(entry.source)) {
    throw new Error(`new schema has an invalid source path: ${entry.source}`);
  }
  if (typeof entry.public !== "string" || !SAFE_RELATIVE_PATH.test(entry.public)) {
    throw new Error(`new schema has an invalid public path: ${entry.public}`);
  }
  if (!SHA256.test(entry.sha256 ?? "")) {
    throw new Error(`new schema has an invalid digest: ${entry.sha256}`);
  }
  if (/(?:^|[/_-])v2(?:[./_-]|$)/u.test(entry.id) ||
      /(?:^|[/_-])v2(?:[./_-]|$)/u.test(entry.source) ||
      /(?:^|[/_-])v2(?:[./_-]|$)/u.test(entry.public)) {
    throw new Error("new schema must not mint a v2 identity, source, or path");
  }
  assertNoV2(entry, "new schema entry");
}

function duplicateField(entries, field) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry[field])) return entry[field];
    seen.add(entry[field]);
  }
  return null;
}

function publicPathForSchemaID(id) {
  let parsed;
  try {
    parsed = new URL(id);
  } catch (error) {
    throw new Error(`schema $id is not an absolute URL: ${error.message}`);
  }
  if (parsed.href !== id || parsed.origin !== "https://forms.takoform.com" ||
      parsed.search !== "" || parsed.hash !== "" ||
      !/^\/schemas\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.schema\.json$/u.test(
        parsed.pathname,
      ) || parsed.pathname.includes("%")) {
    throw new Error(`schema $id is outside the canonical public schema route: ${id}`);
  }
  return `website/public${parsed.pathname}`;
}

export function deriveUnrecordedPublicSchemas({ ledger, files }) {
  const ledgerProblems = validateSchemaLedgerShape(ledger);
  if (ledgerProblems.length !== 0) {
    throw new Error(`cannot derive schemas from an invalid ledger: ${ledgerProblems.join("; ")}`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("canonical D schema tree must contain every public schema file");
  }
  const bySource = new Map(
    [...ledger.identities, ...ledger.retired].map((entry) => [entry.source, entry]),
  );
  const observedSources = new Set();
  const additions = [];
  for (const file of [...files].sort((left, right) =>
    String(left?.source).localeCompare(String(right?.source)))) {
    if (!exactKeys(file, ["source", "bytes"]) ||
        typeof file.source !== "string" ||
        !file.source.startsWith("spec/schemas/") ||
        !file.source.endsWith(".schema.json") ||
        !SAFE_RELATIVE_PATH.test(file.source) ||
        observedSources.has(file.source) ||
        !(Buffer.isBuffer(file.bytes) || file.bytes instanceof Uint8Array)) {
      throw new Error("canonical D schema tree contains an invalid or duplicate blob");
    }
    observedSources.add(file.source);
    const bytes = Buffer.from(file.bytes);
    let schema;
    try {
      schema = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`${file.source} is not JSON: ${error.message}`);
    }
    const entry = {
      id: schema?.$id,
      source: file.source,
      public: publicPathForSchemaID(schema?.$id),
      sha256: sha256(bytes),
    };
    assertSchemaEntry(entry);
    const recorded = bySource.get(file.source);
    if (recorded !== undefined) {
      const comparable = recorded.retiredBecause === undefined
        ? recorded
        : {
            id: recorded.id,
            source: recorded.source,
            public: recorded.public,
            sha256: recorded.sha256,
          };
      if (!same(comparable, entry)) {
        throw new Error(`canonical D rewrote recorded schema ${file.source}`);
      }
      continue;
    }
    additions.push(entry);
  }
  for (const source of bySource.keys()) {
    if (!observedSources.has(source)) {
      throw new Error(`canonical D omitted recorded schema ${source}`);
    }
  }
  additions.sort((left, right) => left.id.localeCompare(right.id));
  const combined = [
    ...ledger.identities,
    ...ledger.retired,
    ...additions,
  ];
  for (const field of ["id", "source", "public", "sha256"]) {
    const duplicated = duplicateField(combined, field);
    if (duplicated !== null) {
      throw new Error(`derived schema additions duplicate ${field}: ${duplicated}`);
    }
  }
  return additions;
}

export function validateDToNTransition({
  dCommit,
  nCommit,
  additions,
  transition,
}) {
  assertFullCommit(dCommit, "D commit");
  assertFullCommit(nCommit, "N commit");
  if (!Array.isArray(additions)) {
    throw new Error("D to N validation requires the complete derived additions array");
  }
  if (additions.length === 0) {
    if (nCommit !== dCommit || transition !== null) {
      throw new Error("zero schema additions require N to equal D with no reservation edge");
    }
    return { kind: "no-reservation", dCommit, nCommit };
  }
  if (dCommit === nCommit) {
    throw new Error("schema additions require one direct D to N reservation edge");
  }
  const problems = validateTrackedTransition(
    transition,
    dCommit,
    nCommit,
    RESERVATION_TRACKED_PATHS,
  );
  if (problems.length !== 0) {
    throw new Error(`D to N reservation edge is invalid: ${problems.join("; ")}`);
  }
  return { kind: "reservation", dCommit, nCommit, additions: structuredClone(additions) };
}

export function buildSchemaReservation({ version, state, additions }) {
  validateCurrentRecords(state);
  if (!Array.isArray(additions) || additions.length === 0) {
    throw new Error("schema reservation requires at least one active addition");
  }
  additions.forEach(assertSchemaEntry);
  const existing = [
    ...state.schemaLedger.identities,
    ...state.schemaLedger.retired,
  ];
  const combined = [...existing, ...additions];
  for (const field of ["id", "source", "public", "sha256"]) {
    const duplicated = duplicateField(combined, field);
    if (duplicated !== null) {
      throw new Error(`schema reservation would overwrite or duplicate ${field}: ${duplicated}`);
    }
  }
  if (additions.some((entry) => Object.hasOwn(entry, "retiredBecause"))) {
    throw new Error("W10 schema publication is additions-only and cannot retire a schema");
  }

  const schemaLedger = structuredClone(state.schemaLedger);
  schemaLedger.identities.push(...structuredClone(additions));
  if (!same(schemaLedger.retired, state.schemaLedger.retired)) {
    throw new Error("schema retirement and active/retired movement are forbidden");
  }
  const prefixChain = structuredClone(state.prefixChain);
  const priorSeal = prefixChain.publicSchemaIdentities.at(-1);
  const unsignedSeal = {
    sequence: priorSeal.sequence + 1,
    activeCount: schemaLedger.identities.length,
    verifyOnlyCount: schemaLedger.retired.length,
    prefixSha256: objectDigest({
      identities: schemaLedger.identities,
      retired: schemaLedger.retired,
    }),
    previousEntrySha256: priorSeal.entrySha256,
  };
  const schemaSeal = {
    ...unsignedSeal,
    entrySha256: objectDigest(unsignedSeal),
  };
  prefixChain.publicSchemaIdentities.push(schemaSeal);

  let currentHead;
  try {
    currentHead = JSON.parse(Buffer.from(state.recordHeadRaw).toString("utf8"));
  } catch (error) {
    throw new Error(`current record head is not JSON: ${error.message}`);
  }
  const specificationSeal = prefixChain.specificationReleases.at(-1);
  const recordHead = {
    kind: "takoform.record-head@v1",
    generation: currentHead.generation + 1,
    specificationReleases: {
      sequence: specificationSeal.sequence,
      releaseCount: specificationSeal.releaseCount,
      entrySha256: specificationSeal.entrySha256,
    },
    publicSchemaIdentities: {
      sequence: schemaSeal.sequence,
      activeCount: schemaSeal.activeCount,
      verifyOnlyCount: schemaSeal.verifyOnlyCount,
      entrySha256: schemaSeal.entrySha256,
    },
    previousHeadSha256: sha256(state.recordHeadRaw),
  };
  return { schemaLedger, prefixChain, schemaSeal, recordHead };
}

function parseClosedJSON(raw, label) {
  let value;
  try {
    value = JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not JSON: ${error.message}`);
  }
  if (!Buffer.from(canonicalJSON(value)).equals(Buffer.from(raw))) {
    throw new Error(`${label} must use the exact canonical JSON encoding`);
  }
  return value;
}

function validateSourceSnapshot(raw, expectedCommit) {
  const snapshot = parseClosedJSON(raw, "Specification source snapshot");
  if (!exactKeys(snapshot, [
    "format",
    "sourceCommit",
    "roots",
    "files",
    "pathSetSha256",
    "documentSetSha256",
  ]) || snapshot.format !== "takoform.specification-source-snapshot@v1" ||
      snapshot.sourceCommit !== expectedCommit ||
      !same(snapshot.roots, ["spec"]) ||
      !Array.isArray(snapshot.files) || snapshot.files.length === 0) {
    throw new Error("Specification source snapshot has an invalid closed envelope");
  }
  const paths = [];
  for (const file of snapshot.files) {
    if (!exactKeys(file, ["path", "sha256", "classification"]) ||
        typeof file.path !== "string" || !file.path.startsWith("spec/") ||
        !SAFE_RELATIVE_PATH.test(file.path) || !SHA256.test(file.sha256 ?? "") ||
        !["normative", "non-normative-proposal"].includes(file.classification) ||
        (file.classification === "non-normative-proposal") !==
          file.path.startsWith("spec/proposals/")) {
      throw new Error("Specification source snapshot contains an invalid file record");
    }
    paths.push(file.path);
  }
  if (new Set(paths).size !== paths.length ||
      !same(paths, [...paths].sort())) {
    throw new Error("Specification source snapshot paths must be unique and sorted");
  }
  const pathSet = Buffer.from(`${paths.join("\n")}\n`);
  const documents = Buffer.from(
    snapshot.files
      .map(({ path, sha256: digest, classification }) =>
        `${digest}  ${classification}  ${path}\n`)
      .join(""),
  );
  if (snapshot.pathSetSha256 !== sha256(pathSet) ||
      snapshot.documentSetSha256 !== sha256(documents)) {
    throw new Error("Specification source snapshot path/document closure differs");
  }
  assertNoV2(snapshot, "Specification source snapshot");
  return snapshot;
}

function schemaReservationBoundary(state) {
  const seals = state?.prefixChain?.publicSchemaIdentities;
  if (!Array.isArray(seals) || seals.length < 2) {
    throw new Error("N must append one schema reservation seal before prepare");
  }
  const current = seals.at(-1);
  const previous = seals.at(-2);
  if (current.sequence !== previous.sequence + 1 ||
      current.activeCount <= previous.activeCount ||
      current.verifyOnlyCount !== previous.verifyOnlyCount ||
      current.activeCount !== state.schemaLedger.identities.length ||
      current.verifyOnlyCount !== state.schemaLedger.retired.length) {
    throw new Error("N schema reservation must be one additions-only active prefix extension");
  }
  return {
    previous,
    current,
    retained: state.schemaLedger.identities.slice(0, previous.activeCount),
    additions: state.schemaLedger.identities.slice(
      previous.activeCount,
      current.activeCount,
    ),
  };
}

function canonicalBase64(raw) {
  return Buffer.from(raw).toString("base64");
}

function decodeCanonicalBase64(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be base64`);
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error(`${label} is not canonical base64`);
  }
  return bytes;
}

function specificationReleaseBody({
  title,
  normativeCommit,
  sourceSnapshotSha256,
  schemaOriginCandidateSha256 = null,
}) {
  const lines = [
    title,
    "",
    `Normative commit: ${normativeCommit}`,
    `Source snapshot: ${sourceSnapshotSha256}`,
  ];
  if (schemaOriginCandidateSha256 !== null) {
    lines.push(`Schema-origin candidate: ${schemaOriginCandidateSha256}`);
  }
  lines.push(
    "",
    "The retained candidate is operator review evidence and is not a public Release asset.",
  );
  return lines.join("\n");
}

export function buildPreparedCandidate({
  lane = "composed",
  version,
  expectedNCommit,
  expectedDCommit,
  state,
  sourceSnapshotRaw,
  schemaOriginCandidateRaw,
}) {
  validateCurrentRecords(state);
  assertFullCommit(expectedDCommit, "D commit");
  assertFullCommit(expectedNCommit, "N commit");
  if (!["specification", "schema", "composed"].includes(lane)) {
    throw new Error("publication candidate lane must be specification, schema, or composed");
  }
  const specificationEnabled = lane !== "schema";
  const schemaEnabled = lane !== "specification";
  if (specificationEnabled) {
    assertAllowedFutureVersion(version, state.specificationLedger);
  } else if (version !== null && version !== undefined) {
    throw new Error("schema-only publication must not carry a Specification version");
  }
  if (!schemaEnabled && expectedNCommit !== expectedDCommit) {
    throw new Error("Specification-only release requires zero-reservation N=D");
  }
  if (schemaEnabled && expectedNCommit === expectedDCommit) {
    throw new Error("schema publication requires one real D to N reservation edge");
  }
  const sourceSnapshot = specificationEnabled
    ? validateSourceSnapshot(sourceSnapshotRaw, expectedDCommit)
    : null;
  const boundary = schemaEnabled ? schemaReservationBoundary(state) : null;
  const originBytes = schemaEnabled
    ? Buffer.from(schemaOriginCandidateRaw ?? [])
    : null;
  if (schemaEnabled && originBytes.length === 0) {
    throw new Error("composed release schema-origin candidate must contain exact opaque bytes");
  }
  if (schemaEnabled) {
    assertNoV2(originBytes.toString("utf8"), "opaque schema-origin candidate");
  }
  const currentHead = JSON.parse(Buffer.from(state.recordHeadRaw).toString("utf8"));
  const unknown404 = schemaEnabled
    ? `https://forms.takoform.com/schemas/.takoform-must-not-exist-${expectedNCommit.slice(0, 16)}.schema.json`
    : null;
  const sourceSnapshotSha256 = specificationEnabled
    ? sha256(sourceSnapshotRaw)
    : null;
  const schemaOriginCandidateSha256 = schemaEnabled ? sha256(originBytes) : null;
  const title = specificationEnabled ? `Takoform Specification ${version}` : null;
  const document = {
    format: CANDIDATE_FORMAT,
    lanes: {
      specification: specificationEnabled,
      schema: schemaEnabled,
    },
    version: specificationEnabled ? version : null,
    title,
    track: specificationEnabled ? "specification-v1" : null,
    hostApiLane: specificationEnabled ? "forms.takoform.com/v1" : null,
    tag: specificationEnabled ? `specification/${version}` : null,
    canonicalCommit: expectedDCommit,
    normativeCommit: expectedDCommit,
    reservationCommit: expectedNCommit,
    sourceSnapshot: specificationEnabled
      ? {
          sha256: sourceSnapshotSha256,
          bytesBase64: canonicalBase64(sourceSnapshotRaw),
        }
      : null,
    schemaOrigin: schemaEnabled
      ? {
          worker: "takoform-schema-origin",
          route: SCHEMA_ROUTE,
          candidateSha256: schemaOriginCandidateSha256,
          candidateBytesBase64: canonicalBase64(originBytes),
          retained: structuredClone(boundary.retained),
          additions: structuredClone(boundary.additions),
          retired404: structuredClone(state.schemaLedger.retired),
          unknown404,
        }
      : null,
    schemaReservation: schemaEnabled
      ? {
          sequence: boundary.current.sequence,
          entrySha256: boundary.current.entrySha256,
          recordGeneration: currentHead.generation,
          recordHeadSha256: sha256(state.recordHeadRaw),
        }
      : null,
    githubRelease: specificationEnabled
      ? {
          body: specificationReleaseBody({
            title,
            normativeCommit: expectedDCommit,
            sourceSnapshotSha256,
            schemaOriginCandidateSha256,
          }),
          draft: false,
          prerelease: false,
          immutable: true,
          assets: [],
        }
      : null,
    hostApiEffect: "none",
    formPublicationEffect: "none",
    providerEffect: "none",
  };
  assertNoV2(document, "Specification candidate");
  const raw = Buffer.from(canonicalJSON(document));
  return { document, raw, sourceSnapshot };
}

function candidateVersionIsCurrent(document, ledger) {
  const existing = ledger?.releases?.filter(
    (entry) => entry?.version === document?.version,
  ) ?? [];
  if (existing.length > 1) return false;
  if (existing.length === 1) return true;
  try {
    assertAllowedFutureVersion(document?.version, ledger);
    return true;
  } catch {
    return false;
  }
}

export function validatePreparedCandidate(raw, state) {
  const problems = [];
  let document;
  try {
    document = parseClosedJSON(raw, "Specification release candidate");
  } catch (error) {
    return [error.message];
  }
  if (!exactKeys(document, [
    "format",
    "lanes",
    "version",
    "title",
    "track",
    "hostApiLane",
    "tag",
    "canonicalCommit",
    "normativeCommit",
    "reservationCommit",
    "sourceSnapshot",
    "schemaOrigin",
    "schemaReservation",
    "githubRelease",
    "hostApiEffect",
    "formPublicationEffect",
    "providerEffect",
  ]) || document.format !== CANDIDATE_FORMAT) {
    problems.push("Specification release candidate has an invalid closed envelope");
  }
  const lanesClosed = exactKeys(document?.lanes, ["specification", "schema"]) &&
    typeof document?.lanes?.specification === "boolean" &&
    typeof document?.lanes?.schema === "boolean" &&
    (document.lanes.specification || document.lanes.schema);
  const specificationEnabled = document?.lanes?.specification === true;
  const schemaEnabled = document?.lanes?.schema === true;
  if (!lanesClosed ||
      !FULL_COMMIT.test(document?.canonicalCommit ?? "") ||
      document?.normativeCommit !== document?.canonicalCommit ||
      !FULL_COMMIT.test(document?.reservationCommit ?? "")) {
    problems.push("publication candidate has an invalid D/N identity closure");
  }
  if (specificationEnabled
    ? (!candidateVersionIsCurrent(document, state?.specificationLedger) ||
      document?.tag !== `specification/${document?.version}` ||
      document?.title !== `Takoform Specification ${document?.version}` ||
      document?.track !== "specification-v1" ||
      document?.hostApiLane !== "forms.takoform.com/v1")
    : (document?.version !== null || document?.tag !== null ||
      document?.title !== null || document?.track !== null ||
      document?.hostApiLane !== null)) {
    problems.push("publication candidate has an invalid or forbidden Specification identity");
  }
  if (document?.hostApiEffect !== "none" ||
      document?.formPublicationEffect !== "none" ||
      document?.providerEffect !== "none") {
    problems.push("Specification release candidate advances an independent release axis");
  }
  if ((specificationEnabled
        ? !exactKeys(document?.sourceSnapshot, ["sha256", "bytesBase64"])
        : document?.sourceSnapshot !== null) ||
      (schemaEnabled
        ? (!exactKeys(document?.schemaOrigin, [
            "worker",
            "route",
            "candidateSha256",
            "candidateBytesBase64",
            "retained",
            "additions",
            "retired404",
            "unknown404",
          ]) ||
          !exactKeys(document?.schemaReservation, [
            "sequence",
            "entrySha256",
            "recordGeneration",
            "recordHeadSha256",
          ]))
        : (document?.schemaOrigin !== null ||
          document?.schemaReservation !== null ||
          document?.reservationCommit !== document?.canonicalCommit)) ||
      (specificationEnabled
        ? !exactKeys(document?.githubRelease, [
            "body",
            "draft",
            "prerelease",
            "immutable",
            "assets",
          ])
        : document?.githubRelease !== null)) {
    problems.push("Specification release candidate has an open nested envelope");
  }
  let sourceBytes;
  let originBytes;
  if (specificationEnabled) {
    try {
      sourceBytes = decodeCanonicalBase64(
        document?.sourceSnapshot?.bytesBase64,
        "source snapshot bytes",
      );
      if (document?.sourceSnapshot?.sha256 !== sha256(sourceBytes)) {
        problems.push("source snapshot candidate digest differs from its exact bytes");
      }
      validateSourceSnapshot(sourceBytes, document?.canonicalCommit);
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (schemaEnabled) {
    try {
      originBytes = decodeCanonicalBase64(
        document?.schemaOrigin?.candidateBytesBase64,
        "schema-origin candidate bytes",
      );
      if (document?.schemaOrigin?.candidateSha256 !== sha256(originBytes)) {
        problems.push("schema-origin candidate digest differs from its exact bytes");
      }
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (schemaEnabled) {
    try {
      const boundary = schemaReservationBoundary(state);
      if (document?.schemaOrigin?.worker !== "takoform-schema-origin" ||
          document?.schemaOrigin?.route !== SCHEMA_ROUTE ||
          document?.schemaOrigin?.unknown404 !==
            `https://forms.takoform.com/schemas/.takoform-must-not-exist-${document?.reservationCommit?.slice(0, 16)}.schema.json` ||
          !same(document?.schemaOrigin?.retained, boundary.retained) ||
          !same(document?.schemaOrigin?.additions, boundary.additions) ||
          !same(document?.schemaOrigin?.retired404, state.schemaLedger.retired)) {
        problems.push("schema-origin candidate differs from the reserved schema prefixes");
      }
      const currentHead = JSON.parse(Buffer.from(state.recordHeadRaw).toString("utf8"));
      const candidateHeadDigest = document?.schemaReservation?.recordHeadSha256;
      const receiptRecorded = specificationEnabled && state.specificationLedger?.releases?.some(
        (entry) => entry?.version === document?.version,
      );
      const expectedHeadDigest = receiptRecorded
        ? currentHead.previousHeadSha256
        : sha256(state.recordHeadRaw);
      if (document?.schemaReservation?.sequence !== boundary.current.sequence ||
          document?.schemaReservation?.entrySha256 !== boundary.current.entrySha256 ||
          document?.schemaReservation?.recordGeneration !== (receiptRecorded
            ? currentHead.generation - 1
            : currentHead.generation) ||
          candidateHeadDigest !== expectedHeadDigest) {
        problems.push("candidate does not pin the exact N schema seal and signed head");
      }
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (specificationEnabled &&
      (document?.githubRelease?.body !== specificationReleaseBody({
        title: document?.title,
        normativeCommit: document?.normativeCommit,
        sourceSnapshotSha256: document?.sourceSnapshot?.sha256,
        schemaOriginCandidateSha256:
          document?.schemaOrigin?.candidateSha256 ?? null,
      }) || document?.githubRelease?.draft !== false ||
        document?.githubRelease?.prerelease !== false ||
        document?.githubRelease?.immutable !== true ||
        !same(document?.githubRelease?.assets, []))) {
    problems.push("Specification candidate has an invalid direct asset-free Release identity");
  }
  try {
    assertNoV2(document, "Specification candidate");
  } catch (error) {
    problems.push(error.message);
  }
  return [...new Set(problems)];
}

export function validateTrackedTransition(
  transition,
  expectedFrom,
  expectedTo,
  expectedPaths,
) {
  const problems = [];
  if (transition?.fromCommit !== expectedFrom ||
      transition?.toCommit !== expectedTo ||
      !Array.isArray(transition?.parents) || transition.parents.length !== 1 ||
      transition.parents[0] !== expectedFrom) {
    problems.push(`${expectedTo} must be the direct single-parent child of ${expectedFrom}`);
  }
  const paths = transition?.changedPaths;
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length ||
      !same([...paths].sort(), [...expectedPaths].sort())) {
    problems.push(`tracked paths must be exactly ${expectedPaths.join(", ")}`);
  }
  return problems;
}

function exactCommitHistory(history, first, required, label) {
  if (!Array.isArray(history) || history.length === 0 ||
      history[0] !== first || new Set(history).size !== history.length ||
      history.some((commit) => !FULL_COMMIT.test(commit)) ||
      required.some((commit) => !history.includes(commit))) {
    throw new Error(`${label} first-parent history is not exact`);
  }
}

function recordFilesFromState(state) {
  return new Map([
    [SPECIFICATION_LEDGER_PATH, Buffer.from(prettyJSON(state.specificationLedger))],
    [PREFIX_CHAIN_PATH, Buffer.from(prettyJSON(state.prefixChain))],
    [RECORD_HEAD_PATH, Buffer.from(state.recordHeadRaw)],
    [
      RECORD_HEAD_SIGNATURE_PATH,
      Buffer.from(prettyJSON(state.recordHeadSignature)),
    ],
  ]);
}

function validateRecordDescriptors(records, label, files = null) {
  if (!exactKeys(records, E_TO_R_TRACKED_PATHS)) {
    throw new Error(`${label} must name the exact four Specification record paths`);
  }
  if (files !== null && (!(files instanceof Map) ||
      !same([...files.keys()], E_TO_R_TRACKED_PATHS))) {
    throw new Error(`${label} expected file bytes are not the exact ordered record set`);
  }
  for (const path of E_TO_R_TRACKED_PATHS) {
    const descriptor = records[path];
    if (!exactKeys(descriptor, ["objectId", "sha256"]) ||
        !GIT_OBJECT.test(descriptor.objectId ?? "") ||
        !SHA256.test(descriptor.sha256 ?? "")) {
      throw new Error(`${label} has an invalid Git object/digest for ${path}`);
    }
    if (files !== null && descriptor.sha256 !== sha256(files.get(path))) {
      throw new Error(`${label} digest differs from exact bytes for ${path}`);
    }
  }
  return records;
}

export function validateSpecificationReceiptLineage(
  lineage,
  {
    expectedECommit,
    expectedRCommit = null,
    sourceFiles = null,
    receiptFiles = null,
  },
) {
  if (!exactKeys(lineage, [
    "sourceCommit",
    "parentCommit",
    "receiptCommit",
    "canonicalMainCommit",
    "receiptParents",
    "parentFirstParentHistory",
    "currentFirstParentHistory",
    "sourceRecords",
    "parentRecords",
    "receiptRecords",
    "currentRecords",
    "changedPaths",
  ]) || lineage.sourceCommit !== expectedECommit ||
      !FULL_COMMIT.test(lineage.parentCommit ?? "") ||
      !FULL_COMMIT.test(lineage.receiptCommit ?? "") ||
      !FULL_COMMIT.test(lineage.canonicalMainCommit ?? "") ||
      (expectedRCommit !== null && lineage.receiptCommit !== expectedRCommit) ||
      !same(lineage.receiptParents, [lineage.parentCommit]) ||
      !same(lineage.changedPaths, E_TO_R_TRACKED_PATHS)) {
    throw new Error("Specification receipt lineage has an invalid closed envelope");
  }
  exactCommitHistory(
    lineage.parentFirstParentHistory,
    lineage.parentCommit,
    [expectedECommit],
    "receipt parent",
  );
  exactCommitHistory(
    lineage.currentFirstParentHistory,
    lineage.canonicalMainCommit,
    [lineage.receiptCommit, expectedECommit],
    "canonical main",
  );
  const receiptIndex = lineage.currentFirstParentHistory.indexOf(
    lineage.receiptCommit,
  );
  if (receiptIndex < 0 ||
      !same(
        lineage.currentFirstParentHistory.slice(receiptIndex + 1),
        lineage.parentFirstParentHistory,
      )) {
    throw new Error(
      "Specification receipt R is not the sole-parent first-parent child of its classified parent",
    );
  }
  validateRecordDescriptors(lineage.sourceRecords, "source records", sourceFiles);
  validateRecordDescriptors(lineage.parentRecords, "receipt-parent records");
  validateRecordDescriptors(lineage.receiptRecords, "receipt records", receiptFiles);
  validateRecordDescriptors(lineage.currentRecords, "canonical-main records");
  if (!same(lineage.sourceRecords, lineage.parentRecords) ||
      !same(lineage.receiptRecords, lineage.currentRecords)) {
    throw new Error(
      "Specification receipt parent or later canonical main rewrote the four record blobs",
    );
  }
  for (const path of E_TO_R_TRACKED_PATHS) {
    if (lineage.sourceRecords[path].objectId ===
          lineage.receiptRecords[path].objectId ||
        lineage.sourceRecords[path].sha256 ===
          lineage.receiptRecords[path].sha256) {
      throw new Error(`Specification receipt R did not change ${path}`);
    }
  }
  return lineage;
}

export function validateSpecificationReceiptCASLost(
  result,
  { expectedECommit, sourceFiles },
) {
  if (!exactKeys(result, [
    "status",
    "sourceCommit",
    "parentCommit",
    "receiptCommit",
    "canonicalMainCommit",
    "currentFirstParentHistory",
    "sourceRecords",
    "currentRecords",
  ]) || result.status !== "cas-lost" ||
      result.sourceCommit !== expectedECommit ||
      !FULL_COMMIT.test(result.parentCommit ?? "") ||
      !FULL_COMMIT.test(result.receiptCommit ?? "") ||
      !FULL_COMMIT.test(result.canonicalMainCommit ?? "")) {
    throw new Error("Specification receipt CAS-loss classification is invalid");
  }
  exactCommitHistory(
    result.currentFirstParentHistory,
    result.canonicalMainCommit,
    [result.parentCommit, expectedECommit],
    "CAS-loss canonical main",
  );
  if (result.currentFirstParentHistory.indexOf(result.parentCommit) >
      result.currentFirstParentHistory.indexOf(expectedECommit)) {
    throw new Error(
      "CAS-loss receipt parent is not a first-parent descendant of the exact E source",
    );
  }
  if (result.currentFirstParentHistory.includes(result.receiptCommit)) {
    throw new Error("CAS-loss classification omitted a receipt that reached canonical main");
  }
  validateRecordDescriptors(result.sourceRecords, "CAS source records", sourceFiles);
  validateRecordDescriptors(result.currentRecords, "CAS canonical-main records");
  if (!same(result.sourceRecords, result.currentRecords)) {
    throw new Error("CAS-loss canonical main rewrote a source Specification record");
  }
  return result;
}

function keyFingerprint(publicKeyPEM) {
  const publicKey = createPublicKey(publicKeyPEM);
  const der = publicKey.export({ type: "spki", format: "der" });
  return {
    publicKey,
    fingerprint: sha256(der),
  };
}

export function verifyPinnedRecordSignature({
  subject,
  signature,
  publicKeyPEM,
  expectedFingerprint = PINNED_RECORD_KEY_FINGERPRINT,
}) {
  const bytes = Buffer.from(signature ?? []);
  if (bytes.length !== 64) {
    throw new Error("record-head signer must return exactly 64 raw Ed25519 bytes");
  }
  const { publicKey, fingerprint } = keyFingerprint(publicKeyPEM);
  if (fingerprint !== expectedFingerprint) {
    throw new Error("record-head public key differs from the independently retained fingerprint");
  }
  if (!verifyEd25519(null, Buffer.from(subject), publicKey, bytes)) {
    throw new Error("record-head signature does not verify under the independently retained record-head key");
  }
  return fingerprint;
}

function commandIsInsideRepository(command, repositoryRoot) {
  const rel = relative(resolve(repositoryRoot), command);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

export function validateExternalSignerCommand(command, repositoryRoot) {
  if (typeof command !== "string" || !isAbsolute(command)) {
    throw new Error("record-head signer must be one absolute executable path");
  }
  const exact = resolve(command);
  const info = lstatSync(exact);
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) {
    throw new Error("record-head signer must be one non-symlink regular file");
  }
  if ((info.mode & 0o111) === 0) {
    throw new Error("record-head signer must be executable");
  }
  if ((info.mode & 0o022) !== 0) {
    throw new Error("record-head signer must not be group/world writable");
  }
  if (realpathSync(exact) !== exact) {
    throw new Error("record-head signer path must not traverse a symlink");
  }
  if (commandIsInsideRepository(exact, repositoryRoot)) {
    throw new Error("record-head signer must be outside the repository");
  }
  return exact;
}

const SIGNER_FORBIDDEN_ENVIRONMENT = Object.freeze([
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
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
]);

export function assertSignerOnlyEnvironment(
  environment,
  ambientEnvironment = null,
) {
  if (!isRecord(environment)) {
    throw new Error("signer-only phase requires one explicit sanitized environment");
  }
  for (const source of [environment, ambientEnvironment].filter(Boolean)) {
    for (const name of SIGNER_FORBIDDEN_ENVIRONMENT) {
      if (source[name] !== undefined && source[name] !== "") {
        throw new Error(`signer-only phase refuses ${name}`);
      }
    }
  }
  const allowed = new Set(["PATH", "LANG", "LC_ALL", "TZ", "TMPDIR"]);
  for (const name of Object.keys(environment)) {
    if (!allowed.has(name)) {
      throw new Error(`signer-only phase refuses nonessential environment ${name}`);
    }
  }
  return {
    PATH: environment.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    ...(typeof environment.TMPDIR === "string"
      ? { TMPDIR: environment.TMPDIR }
      : {}),
  };
}

export function assertNoSameUIDSignerCredentialProcesses({
  procRoot = "/proc",
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  pids = null,
} = {}) {
  if (uid === null) {
    throw new Error("signer-only phase cannot establish its operating-system uid");
  }
  let targets = pids;
  if (targets === null) {
    targets = [];
    let pid = String(process.pid);
    const seen = new Set();
    while (/^[1-9][0-9]*$/u.test(pid) && !seen.has(pid)) {
      seen.add(pid);
      targets.push(pid);
      let status;
      try {
        status = readFileSync(join(procRoot, pid, "status"), "utf8");
      } catch (error) {
        throw new Error(
          `signer-only phase cannot close /proc ancestry for pid ${pid}: ${error.message}`,
        );
      }
      const parent = /^PPid:\s+([0-9]+)$/mu.exec(status)?.[1];
      if (parent === "0") break;
      if (!/^[1-9][0-9]*$/u.test(parent ?? "")) {
        throw new Error(`signer-only phase found an invalid /proc parent for pid ${pid}`);
      }
      pid = parent;
    }
  }
  if (!Array.isArray(targets) || targets.length === 0 ||
      targets.some((pid) => !/^[1-9][0-9]*$/u.test(pid))) {
    throw new Error("signer-only phase received an invalid process-tree boundary");
  }
  for (const pid of targets) {
    const processPath = join(procRoot, pid);
    try {
      if (statSync(processPath).uid !== uid) continue;
      const fields = readFileSync(join(processPath, "environ"))
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
      for (const name of SIGNER_FORBIDDEN_ENVIRONMENT) {
        if (fields.some((field) =>
          field.startsWith(`${name}=`) && field.length > name.length + 1)) {
          throw new Error(
            `signer-only phase refuses same-uid /proc credential ${name} in pid ${pid}`,
          );
        }
      }
    } catch (error) {
      if (error?.code === "ENOENT" && pids !== null) {
        continue;
      }
      throw error;
    }
  }
}

async function invokeRecordSignerOnly({
  command,
  repositoryRoot,
  subject,
  environment,
}) {
  const signer = validateExternalSignerCommand(command, repositoryRoot);
  const sanitized = assertSignerOnlyEnvironment(environment, process.env);
  assertNoSameUIDSignerCredentialProcesses();
  const directory = mkdtempSync(join(tmpdir(), "takoform-record-sign-"));
  const input = join(directory, "record-head.json");
  const output = join(directory, "record-head.sig");
  try {
    writeFileSync(input, subject, { flag: "wx", mode: 0o600 });
    execFileSync(signer, ["sign", "--input", input, "--output", output], {
      cwd: directory,
      env: sanitized,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    const signature = readFileSync(output);
    if (signature.length !== 64) {
      throw new Error("record-head signer must return exactly 64 raw Ed25519 bytes");
    }
    return signature;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export async function invokeExternalRecordSigner({
  command,
  repositoryRoot,
  subject,
  publicKeyPEM,
  expectedFingerprint = PINNED_RECORD_KEY_FINGERPRINT,
  environment = {
    PATH: process.env.PATH,
  },
}) {
  const signature = await invokeRecordSignerOnly({
    command,
    repositoryRoot,
    subject,
    environment,
  });
  verifyPinnedRecordSignature({
    subject,
    signature,
    publicKeyPEM,
    expectedFingerprint,
  });
  return signature;
}

function recordSignatureEnvelope(subject, signature, fingerprint) {
  return {
    kind: "takoform.record-head-signature@v1",
    algorithm: "ed25519",
    publicKeySha256: fingerprint,
    subject: RECORD_HEAD_PATH,
    subjectSha256: sha256(subject),
    signature: Buffer.from(signature).toString("base64"),
  };
}

function unsignedPathsForPurpose(purpose) {
  if (purpose === "schema-reservation") return UNSIGNED_RESERVATION_PATHS;
  if (purpose === "specification-receipt") {
    return UNSIGNED_SPECIFICATION_RECEIPT_PATHS;
  }
  throw new Error(`unknown record-change purpose: ${purpose}`);
}

function parseUnsignedRecordArtifact(raw, expected = {}) {
  const document = parseClosedJSON(raw, "unsigned record-change artifact");
  if (!exactKeys(document, ["format", "purpose", "sourceCommit", "files"]) ||
      document.format !== UNSIGNED_RECORD_ARTIFACT_FORMAT ||
      !FULL_COMMIT.test(document.sourceCommit ?? "") ||
      !Array.isArray(document.files)) {
    throw new Error("unsigned record-change artifact has an invalid closed envelope");
  }
  if (expected.purpose !== undefined && document.purpose !== expected.purpose) {
    throw new Error("unsigned record-change artifact has another purpose");
  }
  if (expected.sourceCommit !== undefined &&
      document.sourceCommit !== expected.sourceCommit) {
    throw new Error("unsigned record-change artifact has another source commit");
  }
  const expectedPaths = unsignedPathsForPurpose(document.purpose);
  const files = new Map();
  for (const entry of document.files) {
    if (!exactKeys(entry, ["path", "sha256", "bytesBase64"]) ||
        !expectedPaths.includes(entry.path) || files.has(entry.path) ||
        !SHA256.test(entry.sha256 ?? "")) {
      throw new Error("unsigned record-change artifact contains an invalid file");
    }
    const bytes = decodeCanonicalBase64(
      entry.bytesBase64,
      `unsigned record file ${entry.path}`,
    );
    if (sha256(bytes) !== entry.sha256) {
      throw new Error(`unsigned record file digest differs for ${entry.path}`);
    }
    files.set(entry.path, bytes);
  }
  if (!same([...files.keys()], expectedPaths)) {
    throw new Error("unsigned record-change artifact path set or order is not exact");
  }
  return { document, files };
}

export function buildUnsignedRecordArtifact({
  purpose,
  sourceCommit,
  files,
}) {
  assertFullCommit(sourceCommit, "unsigned record source commit");
  const paths = unsignedPathsForPurpose(purpose);
  if (!(files instanceof Map) || !same([...files.keys()], paths)) {
    throw new Error("unsigned record-change files have another path set or order");
  }
  const document = {
    format: UNSIGNED_RECORD_ARTIFACT_FORMAT,
    purpose,
    sourceCommit,
    files: paths.map((path) => {
      const bytes = Buffer.from(files.get(path) ?? []);
      if (bytes.length === 0) {
        throw new Error(`unsigned record-change file is empty: ${path}`);
      }
      return {
        path,
        sha256: sha256(bytes),
        bytesBase64: canonicalBase64(bytes),
      };
    }),
  };
  const raw = Buffer.from(canonicalJSON(document));
  parseUnsignedRecordArtifact(raw, { purpose, sourceCommit });
  return { document, raw, files: new Map(files) };
}

export async function sealRecordArtifact({
  authority,
  unsignedArtifactRaw,
  signerCommand,
  repositoryRoot,
  environment,
}) {
  assertMutationAuthority(authority, "seal");
  const unsignedRaw = Buffer.from(unsignedArtifactRaw ?? []);
  const unsigned = parseUnsignedRecordArtifact(unsignedRaw);
  const subject = unsigned.files.get(RECORD_HEAD_PATH);
  const signature = await invokeRecordSignerOnly({
    command: signerCommand,
    repositoryRoot: resolve(repositoryRoot),
    subject,
    environment,
  });
  const document = {
    format: SEALED_RECORD_ARTIFACT_FORMAT,
    unsignedSha256: sha256(unsignedRaw),
    unsignedBytesBase64: canonicalBase64(unsignedRaw),
    signature: {
      algorithm: "ed25519",
      bytesBase64: canonicalBase64(signature),
    },
  };
  return { document, raw: Buffer.from(canonicalJSON(document)) };
}

export function verifySealedRecordArtifact(raw, {
  purpose,
  sourceCommit,
  publicKeyPEM,
  expectedFingerprint = PINNED_RECORD_KEY_FINGERPRINT,
}) {
  const sealed = parseClosedJSON(raw, "sealed record-change artifact");
  if (!exactKeys(sealed, [
    "format",
    "unsignedSha256",
    "unsignedBytesBase64",
    "signature",
  ]) || sealed.format !== SEALED_RECORD_ARTIFACT_FORMAT ||
      !exactKeys(sealed.signature, ["algorithm", "bytesBase64"]) ||
      sealed.signature.algorithm !== "ed25519") {
    throw new Error("sealed record-change artifact has an invalid closed envelope");
  }
  const unsignedRaw = decodeCanonicalBase64(
    sealed.unsignedBytesBase64,
    "sealed unsigned record bytes",
  );
  if (sealed.unsignedSha256 !== sha256(unsignedRaw)) {
    throw new Error("sealed record-change artifact names different unsigned bytes");
  }
  const unsigned = parseUnsignedRecordArtifact(unsignedRaw, {
    purpose,
    sourceCommit,
  });
  const signature = decodeCanonicalBase64(
    sealed.signature.bytesBase64,
    "sealed record signature",
  );
  const subject = unsigned.files.get(RECORD_HEAD_PATH);
  const fingerprint = verifyPinnedRecordSignature({
    subject,
    signature,
    publicKeyPEM,
    expectedFingerprint,
  });
  const files = new Map(unsigned.files);
  files.set(
    RECORD_HEAD_SIGNATURE_PATH,
    Buffer.from(prettyJSON(recordSignatureEnvelope(
      subject,
      signature,
      fingerprint,
    ))),
  );
  return {
    sealed,
    unsigned: unsigned.document,
    files,
  };
}

function verifyRecordHeadState(state, expectedFingerprint) {
  let head;
  try {
    head = JSON.parse(Buffer.from(state.recordHeadRaw).toString("utf8"));
  } catch (error) {
    throw new Error(`record head is not JSON: ${error.message}`);
  }
  if (!exactKeys(head, [
    "kind",
    "generation",
    "specificationReleases",
    "publicSchemaIdentities",
    "previousHeadSha256",
  ]) || head.kind !== "takoform.record-head@v1" ||
      !Number.isSafeInteger(head.generation) || head.generation < 1 ||
      !exactKeys(head.specificationReleases, [
        "sequence",
        "releaseCount",
        "entrySha256",
      ]) ||
      !exactKeys(head.publicSchemaIdentities, [
        "sequence",
        "activeCount",
        "verifyOnlyCount",
        "entrySha256",
      ])) {
    throw new Error("record head has an invalid closed envelope");
  }
  const expectedGeneration =
    state.prefixChain.specificationReleases.length +
    state.prefixChain.publicSchemaIdentities.length - 1;
  if (head.generation !== expectedGeneration ||
      (head.generation === 1
        ? head.previousHeadSha256 !== null
        : !SHA256.test(head.previousHeadSha256 ?? ""))) {
    throw new Error(
      "record head generation or predecessor differs from the exact append history",
    );
  }
  const envelope = state.recordHeadSignature;
  if (!exactKeys(envelope, [
    "kind",
    "algorithm",
    "publicKeySha256",
    "subject",
    "subjectSha256",
    "signature",
  ]) || envelope.kind !== "takoform.record-head-signature@v1" ||
      envelope.algorithm !== "ed25519" ||
      envelope.subject !== RECORD_HEAD_PATH ||
      envelope.subjectSha256 !== sha256(state.recordHeadRaw) ||
      envelope.publicKeySha256 !== expectedFingerprint) {
    throw new Error("record-head signature envelope does not close the exact subject");
  }
  const signature = Buffer.from(envelope.signature ?? "", "base64");
  if (signature.toString("base64") !== envelope.signature) {
    throw new Error("record-head signature is not canonical base64");
  }
  verifyPinnedRecordSignature({
    subject: state.recordHeadRaw,
    signature,
    publicKeyPEM: state.recordHeadPublicKeyPEM,
    expectedFingerprint,
  });
  const specificationSeal = state.prefixChain.specificationReleases.at(-1);
  const schemaSeal = state.prefixChain.publicSchemaIdentities.at(-1);
  if (head?.specificationReleases?.sequence !== specificationSeal?.sequence ||
      head?.specificationReleases?.releaseCount !== specificationSeal?.releaseCount ||
      head?.specificationReleases?.entrySha256 !== specificationSeal?.entrySha256 ||
      head?.publicSchemaIdentities?.sequence !== schemaSeal?.sequence ||
      head?.publicSchemaIdentities?.activeCount !== schemaSeal?.activeCount ||
      head?.publicSchemaIdentities?.verifyOnlyCount !== schemaSeal?.verifyOnlyCount ||
      head?.publicSchemaIdentities?.entrySha256 !== schemaSeal?.entrySha256) {
    throw new Error("signed record head does not close both current ledger seals");
  }
  return head;
}

function loadCandidateState(state, input, expectedFingerprint) {
  validateCurrentRecords(state);
  verifyRecordHeadState(state, expectedFingerprint);
  if (state.headCommit !== input.expectedECommit) {
    throw new Error("current head must equal the exact E commit");
  }
  const transitionProblems = validateTrackedTransition(
    state.evidenceTransition,
    input.expectedNCommit,
    input.expectedECommit,
    N_TO_E_TRACKED_PATHS,
  );
  if (transitionProblems.length !== 0) {
    throw new Error(`N to E history is invalid: ${transitionProblems.join("; ")}`);
  }
  const candidateRaw = Buffer.from(state.candidateRaw ?? []);
  const candidateProblems = validatePreparedCandidate(candidateRaw, state);
  if (candidateProblems.length !== 0) {
    throw new Error(`Specification candidate is invalid: ${candidateProblems.join("; ")}`);
  }
  const candidate = JSON.parse(candidateRaw.toString("utf8"));
  if (candidate.version !== (input.version ?? null) ||
      candidate.canonicalCommit !== input.expectedDCommit ||
      candidate.normativeCommit !== input.expectedDCommit ||
      candidate.reservationCommit !== input.expectedNCommit ||
      (input.lane !== undefined &&
        !same(candidate.lanes, {
          specification: input.lane !== "schema",
          schema: input.lane !== "specification",
        }))) {
    throw new Error("command inputs differ from the exact retained candidate");
  }
  return { candidate, candidateRaw };
}

async function verifyNormativeSourceSnapshot(candidate, operations) {
  if (!candidate.lanes.specification) return null;
  const snapshotBytes = decodeCanonicalBase64(
    candidate.sourceSnapshot.bytesBase64,
    "candidate source snapshot bytes",
  );
  const request = {
    commit: candidate.normativeCommit,
    snapshotSha256: candidate.sourceSnapshot.sha256,
    snapshotBytes,
  };
  const observed = await requireOperation(
    operations,
    "verifySpecificationSourceSnapshot",
    request,
  );
  if (!exactKeys(observed, ["commit", "snapshotSha256", "exact"]) ||
      observed.commit !== request.commit ||
      observed.snapshotSha256 !== request.snapshotSha256 ||
      observed.exact !== true) {
    throw new Error(
      "normative source-snapshot verifier did not close the exact classified D bytes",
    );
  }
  return observed;
}

function bytesFromReadback(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

function validateHTTPReadback(readback, expectedURL, expectedStatus, expectedBytes) {
  if (!exactKeys(readback, ["status", "url", "redirected", "bytes"]) ||
      readback.status !== expectedStatus || readback.url !== expectedURL ||
      readback.redirected !== false || bytesFromReadback(readback.bytes) === null) {
    throw new Error(
      `closed HTTP readback for ${expectedURL} must be exact ${expectedStatus} without redirect`,
    );
  }
  if (expectedStatus === 200 &&
      !bytesFromReadback(readback.bytes).equals(Buffer.from(expectedBytes))) {
    throw new Error(`live schema bytes differ for ${expectedURL}`);
  }
  return readback;
}

async function schemaSourceClosure(candidate, operations) {
  const entries = [
    ...candidate.schemaOrigin.retained,
    ...candidate.schemaOrigin.additions,
  ];
  const sources = new Map();
  for (const entry of entries) {
    const raw = Buffer.from(
      await requireOperation(operations, "readSchemaSource", entry.source),
    );
    if (sha256(raw) !== entry.sha256) {
      throw new Error(`committed schema digest differs for ${entry.source}`);
    }
    let schema;
    try {
      schema = JSON.parse(raw.toString("utf8"));
    } catch (error) {
      throw new Error(`committed schema ${entry.source} is not JSON: ${error.message}`);
    }
    if (schema.$id !== entry.id) {
      throw new Error(`committed schema $id differs for ${entry.source}`);
    }
    sources.set(entry.id, raw);
  }
  return sources;
}

async function readSchemaHTTP(operations, url, status, bytes) {
  const readback = await requireOperation(operations, "readHTTP", url);
  return validateHTTPReadback(readback, url, status, bytes);
}

async function verifyPreRouteState(candidate, sources, operations) {
  for (const entry of candidate.schemaOrigin.retained) {
    await readSchemaHTTP(operations, entry.id, 200, sources.get(entry.id));
  }
  for (const entry of candidate.schemaOrigin.additions) {
    await readSchemaHTTP(operations, entry.id, 404);
  }
}

async function verifyPostRouteState(candidate, sources, operations) {
  for (const entry of [
    ...candidate.schemaOrigin.retained,
    ...candidate.schemaOrigin.additions,
  ]) {
    await readSchemaHTTP(operations, entry.id, 200, sources.get(entry.id));
  }
  for (const entry of candidate.schemaOrigin.retired404) {
    await readSchemaHTTP(operations, entry.id, 404);
  }
  await readSchemaHTTP(operations, candidate.schemaOrigin.unknown404, 404);
}

function validateAbsentTag(value, tag) {
  if (!exactKeys(value, ["status", "tag"]) ||
      value.status !== 404 || value.tag !== tag) {
    throw new Error(`tag ${tag} readback is ambiguous or already occupied`);
  }
}

function validateExactTag(value, candidate, expectedECommit) {
  if (!exactKeys(value, [
    "status",
    "tag",
    "targetCommit",
    "tagObject",
    "annotated",
    "signed",
    "signatureVerified",
  ]) || value.status !== 200 || value.tag !== candidate.tag ||
      value.targetCommit !== expectedECommit ||
      !/^[0-9a-f]{40}$/u.test(value.tagObject ?? "") ||
      value.annotated !== true || value.signed !== true ||
      value.signatureVerified !== true) {
    throw new Error(`signed annotated tag ${candidate.tag} readback is not exact`);
  }
  return value;
}

function validateAbsentRelease(value, tag) {
  if (!exactKeys(value, ["status", "tag"]) ||
      value.status !== 404 || value.tag !== tag) {
    throw new Error(`Release ${tag} readback is ambiguous or already occupied`);
  }
}

function validateExactRelease(value, candidate) {
  if (!exactKeys(value, [
    "status",
    "tag",
    "id",
    "url",
    "body",
    "draft",
    "prerelease",
    "immutable",
    "assets",
  ]) || value.status !== 200 || value.tag !== candidate.tag ||
      !Number.isSafeInteger(value.id) || value.id < 1 ||
      value.url !==
        `https://github.com/tako0614/takoform/releases/tag/${candidate.tag}` ||
      value.body !== candidate.githubRelease.body ||
      value.draft !== false || value.prerelease !== false ||
      value.immutable !== true || !same(value.assets, [])) {
    throw new Error(`immutable Release ${candidate.tag} readback is not exact`);
  }
  return value;
}

export function validateTagProtectionRuleset(value) {
  if (!exactKeys(value, [
    "id",
    "target",
    "enforcement",
    "bypassActors",
    "include",
    "exclude",
    "rules",
  ]) || !Number.isSafeInteger(value.id) || value.id < 1 ||
      value.target !== "tag" || value.enforcement !== "active" ||
      !same(value.bypassActors, []) ||
      !same(value.include, [SPECIFICATION_TAG_RULESET_PATTERN]) ||
      !same(value.exclude, []) ||
      !same(value.rules, SPECIFICATION_TAG_RULESET_RULES)) {
    throw new Error(
      "Specification tag ruleset must be exact, active, update/deletion protected, and have no bypass actor",
    );
  }
  return value;
}

async function acquireTagProtectionAuditToken(
  candidate,
  phase,
  operations,
) {
  const token = await requireOperation(
    operations,
    "acquireTagProtectionAuditToken",
    {
      surface: "takoform-specification-tag-ruleset",
      version: candidate.version,
      phase,
    },
  );
  if (!isRecord(token)) {
    throw new Error(
      "tag-protection audit authority must remain one opaque adapter-owned object",
    );
  }
  return token;
}

async function auditTagProtectionRuleset(candidate, operations, auditToken) {
  return validateTagProtectionRuleset(
    await requireOperation(operations, "verifyTagProtectionRuleset", {
      tag: candidate.tag,
      expectedPattern: SPECIFICATION_TAG_RULESET_PATTERN,
      auditToken,
    }),
  );
}

function validateStageObservation(value, candidate, { allowExact }) {
  if (exactKeys(value, ["status", "candidateSha256"]) &&
      value.status === 404 &&
      value.candidateSha256 === candidate.schemaOrigin.candidateSha256) {
    return { kind: "absent" };
  }
  if (allowExact &&
      exactKeys(value, ["status", "candidateSha256", "stageID", "exact"]) &&
      value.status === 200 &&
      value.candidateSha256 === candidate.schemaOrigin.candidateSha256 &&
      typeof value.stageID === "string" && value.stageID !== "" &&
      value.exact === true) {
    return { kind: "exact", stage: value };
  }
  throw new Error("schema-origin stage state is ambiguous or mismatched");
}

async function stageAndActivate(candidate, candidateRaw, operations, credentials, { recoverMode }) {
  const observation = validateStageObservation(
    await requireOperation(
      operations,
      "readSchemaOriginStage",
      candidate.schemaOrigin.candidateSha256,
    ),
    candidate,
    { allowExact: recoverMode },
  );
  let stage = observation.stage;
  if (observation.kind === "absent") {
    stage = await requireOperation(operations, "stageSchemaOrigin", {
      route: SCHEMA_ROUTE,
      candidateSha256: candidate.schemaOrigin.candidateSha256,
      candidateBytes: decodeCanonicalBase64(
        candidate.schemaOrigin.candidateBytesBase64,
        "schema-origin candidate bytes",
      ),
      releaseCandidateBytes: candidateRaw,
      credentials,
      createOnly: true,
    });
  }
  const verified = await requireOperation(
    operations,
    "verifyStagedSchemaOrigin",
    stage,
  );
  if (verified?.exact !== true ||
      verified?.candidateSha256 !== candidate.schemaOrigin.candidateSha256) {
    throw new Error("staged schema-origin candidate did not verify exactly");
  }
  await requireOperation(operations, "activateSchemaRoute", {
    route: SCHEMA_ROUTE,
    stageID: stage.stageID,
    candidateSha256: candidate.schemaOrigin.candidateSha256,
    credentials,
    createOnly: true,
  });
}

function tagMessage(candidate) {
  return [
    candidate.title,
    "",
    `Normative commit: ${candidate.normativeCommit}`,
    `Candidate: ${sha256(Buffer.from(canonicalJSON(candidate)))}`,
  ].join("\n");
}

async function createTag(
  candidate,
  input,
  operations,
  credentials,
  auditToken,
) {
  const tagProtectionRuleset = await auditTagProtectionRuleset(
    candidate,
    operations,
    auditToken,
  );
  await requireOperation(operations, "createSignedAnnotatedTag", {
    tag: candidate.tag,
    targetCommit: input.expectedECommit,
    message: tagMessage(candidate),
    signed: true,
    annotated: true,
    createOnly: true,
    credentials,
  });
  return {
    tag: validateExactTag(
      await requireOperation(operations, "readTag", candidate.tag),
      candidate,
      input.expectedECommit,
    ),
    tagProtectionRuleset,
  };
}

async function createRelease(
  candidate,
  input,
  operations,
  credentials,
  auditToken,
  expectedTagProtectionRuleset = null,
) {
  const tagProtectionRuleset = await auditTagProtectionRuleset(
    candidate,
    operations,
    auditToken,
  );
  if (expectedTagProtectionRuleset !== null &&
      !same(tagProtectionRuleset, expectedTagProtectionRuleset)) {
    throw new Error(
      "Specification tag ruleset changed between tag creation and Release publication",
    );
  }
  await requireOperation(operations, "createImmutableRelease", {
    tag: candidate.tag,
    targetCommit: input.expectedECommit,
    title: candidate.title,
    body: candidate.githubRelease.body,
    draft: false,
    prerelease: false,
    assets: [],
    immutable: true,
    createOnly: true,
    direct: true,
    credentials,
  });
  return {
    release: validateExactRelease(
      await requireOperation(operations, "readRelease", candidate.tag),
      candidate,
    ),
    tagProtectionRuleset,
  };
}

async function requireOperation(operations, name, ...args) {
  if (typeof operations?.[name] !== "function") {
    throw new Error(`Specification release operation ${name} is required`);
  }
  return await operations[name](...args);
}

async function requireIndependentReview(
  input,
  candidate,
  candidateRaw,
  operations,
  recovery,
) {
  if (!isAbsolute(input.reviewRecord ?? "")) {
    throw new Error("publish/recover independent review record must be one absolute path");
  }
  const request = {
    path: input.reviewRecord,
    lanes: structuredClone(candidate.lanes),
    version: candidate.version,
    expectedDCommit: input.expectedDCommit,
    expectedNCommit: input.expectedNCommit,
    expectedECommit: input.expectedECommit,
    candidateSha256: sha256(candidateRaw),
    schemaOriginCandidateSha256:
      candidate.schemaOrigin?.candidateSha256 ?? null,
    recovery,
    reviewed: [...SPECIFICATION_RELEASE_REVIEW_TOPICS],
  };
  const review = await requireOperation(
    operations,
    "verifyIndependentReview",
    request,
  );
  return validateIndependentReview(review, request);
}

function writerCheckpoints(input, phase) {
  const dCommit = input.expectedDCommit;
  const nCommit = input.expectedNCommit;
  const eCommit = input.expectedECommit;
  const values = phase === "reserve"
    ? [dCommit]
    : phase === "prepare"
      ? [dCommit, nCommit]
      : [dCommit, nCommit, eCommit];
  for (const [index, commit] of values.entries()) {
    assertFullCommit(commit, `${["D", "N", "E"][index]} writer checkpoint`);
  }
  return values;
}

async function requireSourcePinnedExecution(input, operations, phase) {
  const checkpoints = writerCheckpoints(input, phase);
  const request = {
    preparedCommit: input.authority.successorPreparedCommit,
    checkpoints,
    paths: [...SOURCE_PINNED_EXECUTION_PATHS],
  };
  const observed = await requireOperation(
    operations,
    "verifySourcePinnedExecution",
    request,
  );
  try {
    return validateWriterExecutionClosureObservation(observed, {
      authority: input.authority,
      checkpoints,
    });
  } catch (error) {
    throw new Error(
      `writer execution is not pinned to immutable P0: ${error.message}`,
    );
  }
}

async function requireSealedSchemaTools(writerClosure, operations) {
  const request = {
    preparedCommit: writerClosure.prepared.commit,
    packageObject: writerClosure.prepared.pathObjects["package.json"],
    lockObject: writerClosure.prepared.pathObjects["bun.lock"],
    toolPolicyObject:
      writerClosure.prepared.pathObjects[WRITER_TOOL_CLOSURE_POLICY_PATH],
    wranglerVersion: "4.115.0",
  };
  const evidence = await requireOperation(
    operations,
    "prepareSchemaToolClosure",
    request,
  );
  if (!exactKeys(evidence, [
    "format",
    "preparedCommit",
    "packageObject",
    "lockObject",
    "toolPolicyObject",
    "wranglerVersion",
    "manifestSha256",
    "fileCount",
  ]) || evidence.format !== "takoform.sealed-schema-tool-closure@v1" ||
      evidence.preparedCommit !== request.preparedCommit ||
      evidence.packageObject !== request.packageObject ||
      evidence.lockObject !== request.lockObject ||
      evidence.toolPolicyObject !== request.toolPolicyObject ||
      evidence.wranglerVersion !== request.wranglerVersion ||
      !SHA256.test(evidence.manifestSha256 ?? "") ||
      !Number.isSafeInteger(evidence.fileCount) || evidence.fileCount < 1) {
    throw new Error("schema tool-seal evidence does not close the exact P0 dependency installation");
  }
  return evidence;
}

export async function reserve(input, operations, runtime = {}) {
  assertMutationAuthority(input?.authority, "reserve");
  await requireSourcePinnedExecution(input, operations, "reserve");
  const dCommit = input.expectedDCommit;
  assertFullCommit(dCommit, "expected canonical D commit");
  const state = await requireOperation(operations, "readReservationState");
  if (state.headCommit !== undefined && state.headCommit !== dCommit) {
    fail("reserve", "history", "schema derivation must read the exact canonical D commit");
  }
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  verifyRecordHeadState(state, expectedFingerprint);
  const files = await requireOperation(
    operations,
    "readCanonicalSchemaTree",
    { commit: dCommit, root: "spec/schemas" },
  );
  const additions = deriveUnrecordedPublicSchemas({
    ledger: state.schemaLedger,
    files,
  });
  if (additions.length === 0) {
    return {
      status: "no-reservation",
      dCommit,
      nCommit: dCommit,
      additions: [],
      unsignedArtifact: null,
    };
  }
  const next = buildSchemaReservation({
    state,
    additions,
  });
  const recordHeadRaw = Buffer.from(prettyJSON(next.recordHead));
  const unsignedFiles = new Map([
    [SCHEMA_LEDGER_PATH, Buffer.from(prettyJSON(next.schemaLedger))],
    [PREFIX_CHAIN_PATH, Buffer.from(prettyJSON(next.prefixChain))],
    [RECORD_HEAD_PATH, recordHeadRaw],
  ]);
  const unsignedArtifact = buildUnsignedRecordArtifact({
    purpose: "schema-reservation",
    sourceCommit: dCommit,
    files: unsignedFiles,
  });
  return {
    status: "reservation-prepared",
    dCommit,
    nCommit: null,
    additions,
    ...next,
    recordHeadRaw,
    unsignedArtifact,
  };
}

export async function applySchemaReservation(input, operations, runtime = {}) {
  assertMutationAuthority(input?.authority, "apply-reservation");
  await requireSourcePinnedExecution(input, operations, "reserve");
  const dCommit = input.expectedDCommit;
  assertFullCommit(dCommit, "expected canonical D commit");
  const state = await requireOperation(operations, "readReservationState");
  if (state.headCommit !== undefined && state.headCommit !== dCommit) {
    fail("apply-reservation", "history", "reservation apply must run at exact D");
  }
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  verifyRecordHeadState(state, expectedFingerprint);
  const sealed = verifySealedRecordArtifact(input.sealedArtifactRaw, {
    purpose: "schema-reservation",
    sourceCommit: dCommit,
    publicKeyPEM: state.recordHeadPublicKeyPEM,
    expectedFingerprint,
  });
  const nextState = {
    specificationLedger: state.specificationLedger,
    schemaLedger: JSON.parse(sealed.files.get(SCHEMA_LEDGER_PATH)),
    prefixChain: JSON.parse(sealed.files.get(PREFIX_CHAIN_PATH)),
    recordHeadRaw: sealed.files.get(RECORD_HEAD_PATH),
    recordHeadSignature: JSON.parse(
      sealed.files.get(RECORD_HEAD_SIGNATURE_PATH),
    ),
    recordHeadPublicKeyPEM: state.recordHeadPublicKeyPEM,
  };
  validateCurrentRecords(nextState);
  verifyRecordHeadState(nextState, expectedFingerprint);
  if (!same(
    nextState.specificationLedger,
    state.specificationLedger,
  ) || !same(
    nextState.schemaLedger.identities.slice(
      0,
      state.schemaLedger.identities.length,
    ),
    state.schemaLedger.identities,
  ) || !same(nextState.schemaLedger.retired, state.schemaLedger.retired) ||
      nextState.schemaLedger.identities.length <=
        state.schemaLedger.identities.length) {
    fail(
      "apply-reservation",
      "artifact",
      "sealed reservation is not one additions-only extension of D",
    );
  }
  await requireOperation(operations, "writeTrackedFiles", sealed.files);
  return {
    status: "reservation-applied",
    dCommit,
    additions: nextState.schemaLedger.identities.slice(
      state.schemaLedger.identities.length,
    ),
    files: sealed.files,
  };
}

export async function prepare(input, operations, runtime = {}) {
  assertMutationAuthority(input?.authority, "prepare");
  await requireSourcePinnedExecution(input, operations, "prepare");
  assertFullCommit(input.expectedDCommit, "expected D commit");
  assertFullCommit(input.expectedNCommit, "expected N commit");
  if (!isAbsolute(input.output ?? "")) {
    fail("prepare", "arguments", "candidate output must be an absolute path");
  }
  const state = await requireOperation(operations, "readPreparationState");
  if (state.headCommit !== input.expectedNCommit) {
    fail("prepare", "history", "prepare must run on the exact N commit");
  }
  validateCurrentRecords(state);
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  verifyRecordHeadState(state, expectedFingerprint);
  const lane = input.lane ?? "specification";
  if (!["specification", "schema", "composed"].includes(lane)) {
    fail("prepare", "arguments", "lane must be specification, schema, or composed");
  }
  const schemaEnabled = lane !== "specification";
  const additions = schemaEnabled
    ? schemaReservationBoundary(state).additions
    : [];
  try {
    validateDToNTransition({
      dCommit: input.expectedDCommit,
      nCommit: input.expectedNCommit,
      additions,
      transition: state.reservationTransition ?? null,
    });
  } catch (error) {
    fail("prepare", "history", error.message);
  }
  const sourceSnapshotRaw = lane === "schema"
    ? null
    : Buffer.from(
        await requireOperation(operations, "buildSpecificationSourceSnapshot", {
          commit: input.expectedDCommit,
          roots: ["spec"],
          exclude: [CANDIDATE_PATH],
        }),
      );
  const schemaOriginCandidateRaw = schemaEnabled
    ? Buffer.from(
        await requireOperation(operations, "buildSchemaOriginCandidate", {
          route: SCHEMA_ROUTE,
          schemaLedger: structuredClone(state.schemaLedger),
          schemaSeal: structuredClone(
            state.prefixChain.publicSchemaIdentities.at(-1),
          ),
        }),
      )
    : null;
  const candidate = buildPreparedCandidate({
    lane,
    version: input.version,
    expectedDCommit: input.expectedDCommit,
    expectedNCommit: input.expectedNCommit,
    state,
    sourceSnapshotRaw,
    schemaOriginCandidateRaw,
  });
  await requireOperation(operations, "writeCandidate", {
    path: input.output,
    trackedPath: CANDIDATE_PATH,
    bytes: candidate.raw,
    exclusive: true,
  });
  return candidate;
}

export async function publish(input, operations, runtime = {}) {
  assertMutationAuthority(input?.authority, "publish");
  const writerClosure = await requireSourcePinnedExecution(
    input,
    operations,
    "publish",
  );
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  const state = await requireOperation(operations, "readPublishState");
  const { candidate, candidateRaw } = loadCandidateState(
    state,
    input,
    expectedFingerprint,
  );
  await verifyNormativeSourceSnapshot(candidate, operations);
  const sources = candidate.schemaOrigin === null
    ? null
    : await schemaSourceClosure(candidate, operations);
  if (sources !== null) {
    await verifyPreRouteState(candidate, sources, operations);
  }
  if (candidate.lanes.specification) {
    validateAbsentTag(
      await requireOperation(operations, "readTag", candidate.tag),
      candidate.tag,
    );
    validateAbsentRelease(
      await requireOperation(operations, "readRelease", candidate.tag),
      candidate.tag,
    );
  }
  await requireIndependentReview(
    input,
    candidate,
    candidateRaw,
    operations,
    false,
  );
  if (sources !== null) {
    await requireSealedSchemaTools(writerClosure, operations);
  }
  const auditToken = candidate.lanes.specification
    ? await acquireTagProtectionAuditToken(candidate, "publish", operations)
    : null;
  const credentials = await requireOperation(operations, "acquireCredentials", {
    surface: candidate.lanes.specification
      ? "takoform-specification-release"
      : "takoform-schema-publication",
    version: candidate.version,
    lanes: structuredClone(candidate.lanes),
  });
  if (sources !== null) {
    await stageAndActivate(
      candidate,
      candidateRaw,
      operations,
      credentials,
      { recoverMode: false },
    );
    await verifyPostRouteState(candidate, sources, operations);
  }
  if (!candidate.lanes.specification) {
    return {
      status: "schema-published",
      candidate,
      tag: null,
      release: null,
      tagProtectionRuleset: null,
    };
  }
  const createdTag = await createTag(
    candidate,
    input,
    operations,
    credentials,
    auditToken,
  );
  const createdRelease = await createRelease(
    candidate,
    input,
    operations,
    credentials,
    auditToken,
    createdTag.tagProtectionRuleset,
  );
  return {
    status: "published",
    candidate,
    tag: createdTag.tag,
    release: createdRelease.release,
    tagProtectionRuleset: createdRelease.tagProtectionRuleset,
  };
}

async function classifyRoute(candidate, sources, operations) {
  let additionsAbsent = true;
  let additionsLive = true;
  for (const entry of candidate.schemaOrigin.retained) {
    await readSchemaHTTP(operations, entry.id, 200, sources.get(entry.id));
  }
  for (const entry of candidate.schemaOrigin.additions) {
    const observed = await requireOperation(operations, "readHTTP", entry.id);
    try {
      validateHTTPReadback(observed, entry.id, 404);
      additionsLive = false;
    } catch {
      validateHTTPReadback(observed, entry.id, 200, sources.get(entry.id));
      additionsAbsent = false;
    }
  }
  if (additionsAbsent && !additionsLive) return "before";
  if (additionsLive && !additionsAbsent) {
    for (const entry of candidate.schemaOrigin.retired404) {
      await readSchemaHTTP(operations, entry.id, 404);
    }
    await readSchemaHTTP(operations, candidate.schemaOrigin.unknown404, 404);
    return "active";
  }
  throw new Error("schema route is a mixed partial state; exact recovery is impossible");
}

function classifyTag(value, candidate, expectedECommit) {
  try {
    validateAbsentTag(value, candidate.tag);
    return { kind: "absent" };
  } catch {
    return {
      kind: "exact",
      value: validateExactTag(value, candidate, expectedECommit),
    };
  }
}

function classifyRelease(value, candidate) {
  try {
    validateAbsentRelease(value, candidate.tag);
    return { kind: "absent" };
  } catch {
    return {
      kind: "exact",
      value: validateExactRelease(value, candidate),
    };
  }
}

export async function recover(input, operations, runtime = {}) {
  assertMutationAuthority(input?.authority, "recover");
  const writerClosure = await requireSourcePinnedExecution(
    input,
    operations,
    "recover",
  );
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  const state = await requireOperation(operations, "readRecoveryState");
  const { candidate, candidateRaw } = loadCandidateState(
    state,
    input,
    expectedFingerprint,
  );
  await verifyNormativeSourceSnapshot(candidate, operations);
  const sources = candidate.schemaOrigin === null
    ? null
    : await schemaSourceClosure(candidate, operations);
  let route = sources === null
    ? "not-requested"
    : await classifyRoute(candidate, sources, operations);
  let tag = candidate.lanes.specification
    ? classifyTag(
        await requireOperation(operations, "readTag", candidate.tag),
        candidate,
        input.expectedECommit,
      )
    : { kind: "not-requested" };
  let release = candidate.lanes.specification
    ? classifyRelease(
        await requireOperation(operations, "readRelease", candidate.tag),
        candidate,
      )
    : { kind: "not-requested" };
  if (release.kind === "exact" && tag.kind !== "exact") {
    fail("recover", "preflight", "an immutable Release exists without its exact signed tag");
  }
  if (candidate.lanes.specification && route === "before" &&
      (tag.kind === "exact" || release.kind === "exact")) {
    fail(
      "recover",
      "preflight",
      "schema route must be live before any Specification tag or Release identity",
    );
  }
  await requireIndependentReview(
    input,
    candidate,
    candidateRaw,
    operations,
    true,
  );
  if (route === "before") {
    await requireSealedSchemaTools(writerClosure, operations);
  }
  const auditToken = candidate.lanes.specification
    ? await acquireTagProtectionAuditToken(candidate, "recover", operations)
    : null;
  if (!candidate.lanes.specification && route === "active") {
    return {
      status: "schema-already-complete",
      candidate,
      tag: null,
      release: null,
      tagProtectionRuleset: null,
    };
  }
  if (["active", "not-requested"].includes(route) &&
      tag.kind === "exact" && release.kind === "exact") {
    const tagProtectionRuleset = await auditTagProtectionRuleset(
      candidate,
      operations,
      auditToken,
    );
    return {
      status: "already-complete",
      candidate,
      tag: tag.value,
      release: release.value,
      tagProtectionRuleset,
    };
  }
  const credentials = await requireOperation(operations, "acquireCredentials", {
    surface: candidate.lanes.specification
      ? "takoform-specification-release"
      : "takoform-schema-publication",
    version: candidate.version,
    lanes: structuredClone(candidate.lanes),
    recovery: true,
  });
  if (route === "before") {
    await stageAndActivate(
      candidate,
      candidateRaw,
      operations,
      credentials,
      { recoverMode: true },
    );
    await verifyPostRouteState(candidate, sources, operations);
    route = "active";
  }
  if (!candidate.lanes.specification) {
    return {
      status: "schema-recovered-forward",
      candidate,
      tag: null,
      release: null,
      tagProtectionRuleset: null,
    };
  }
  if (tag.kind === "absent") {
    const createdTag = await createTag(
      candidate,
      input,
      operations,
      credentials,
      auditToken,
    );
    tag = {
      kind: "exact",
      value: createdTag.tag,
      tagProtectionRuleset: createdTag.tagProtectionRuleset,
    };
  }
  if (release.kind === "absent") {
    const createdRelease = await createRelease(
      candidate,
      input,
      operations,
      credentials,
      auditToken,
      tag.tagProtectionRuleset ?? null,
    );
    release = {
      kind: "exact",
      value: createdRelease.release,
      tagProtectionRuleset: createdRelease.tagProtectionRuleset,
    };
  }
  const tagProtectionRuleset = release.tagProtectionRuleset ??
    tag.tagProtectionRuleset ??
    await auditTagProtectionRuleset(candidate, operations, auditToken);
  return {
    status: "recovered-forward",
    candidate,
    tag: tag.value,
    release: release.value,
    tagProtectionRuleset,
  };
}

function buildSpecificationReceipt(
  candidate,
  tag,
  release,
  tagProtectionRuleset,
  input,
) {
  const receipt = {
    format: FUTURE_RECEIPT_FORMAT,
    version: candidate.version,
    title: candidate.title,
    track: candidate.track,
    hostApiLane: candidate.hostApiLane,
    sourceCommit: candidate.normativeCommit,
    releaseCommit: input.expectedECommit,
    sourceSnapshotSha256: candidate.sourceSnapshot.sha256,
    schemaOriginCandidateSha256:
      candidate.schemaOrigin?.candidateSha256 ?? null,
    schemaReservationEntrySha256:
      candidate.schemaReservation?.entrySha256 ?? null,
    prerequisites: candidate.schemaOrigin === null
      ? ["specification-source-snapshot"]
      : [
          "specification-source-snapshot",
          "schema-origin-live-readback",
        ],
    hostApiEffect: "none",
    formPublicationEffect: "none",
    providerEffect: "none",
    tag: candidate.tag,
    tagObject: tag.tagObject,
    annotatedTag: true,
    signedTag: true,
    tagProtectionRuleset: structuredClone(tagProtectionRuleset),
    release: {
      id: release.id,
      url: release.url,
      bodySha256: sha256(Buffer.from(release.body)),
      draft: false,
      prerelease: false,
      immutable: true,
    },
    assets: [],
  };
  assertNoV2(receipt, "Specification receipt");
  return receipt;
}

function appendSpecificationSeal(prefixChain, specificationLedger) {
  const chain = structuredClone(prefixChain);
  const previous = chain.specificationReleases.at(-1);
  const unsigned = {
    sequence: previous.sequence + 1,
    releaseCount: specificationLedger.releases.length,
    prefixSha256: objectDigest(specificationLedger.releases),
    previousEntrySha256: previous.entrySha256,
  };
  const seal = { ...unsigned, entrySha256: objectDigest(unsigned) };
  chain.specificationReleases.push(seal);
  return { chain, seal };
}

function nextRecordHead(state, prefixChain) {
  const previous = JSON.parse(Buffer.from(state.recordHeadRaw).toString("utf8"));
  const specification = prefixChain.specificationReleases.at(-1);
  const schemas = prefixChain.publicSchemaIdentities.at(-1);
  return {
    kind: "takoform.record-head@v1",
    generation: previous.generation + 1,
    specificationReleases: {
      sequence: specification.sequence,
      releaseCount: specification.releaseCount,
      entrySha256: specification.entrySha256,
    },
    publicSchemaIdentities: {
      sequence: schemas.sequence,
      activeCount: schemas.activeCount,
      verifyOnlyCount: schemas.verifyOnlyCount,
      entrySha256: schemas.entrySha256,
    },
    previousHeadSha256: sha256(state.recordHeadRaw),
  };
}

function buildUnsignedSpecificationReceipt({
  state,
  candidate,
  tag,
  release,
  tagProtectionRuleset,
  input,
}) {
  const receipt = buildSpecificationReceipt(
    candidate,
    tag,
    release,
    tagProtectionRuleset,
    input,
  );
  const specificationLedger = structuredClone(state.specificationLedger);
  if (specificationLedger.releases.some(
    (entry) => entry.version === candidate.version,
  )) {
    fail("prepare-receipt", "ledger", `Specification ${candidate.version} receipt already exists`);
  }
  specificationLedger.releases.push(receipt);
  const specificationProblems = validateSpecificationLedger(specificationLedger);
  if (specificationProblems.length !== 0) {
    fail("prepare-receipt", "ledger", specificationProblems.join("; "));
  }
  const { chain: prefixChain } = appendSpecificationSeal(
    state.prefixChain,
    specificationLedger,
  );
  const recordHead = nextRecordHead(state, prefixChain);
  const recordHeadRaw = Buffer.from(prettyJSON(recordHead));
  const unsignedFiles = new Map([
    [SPECIFICATION_LEDGER_PATH, Buffer.from(prettyJSON(specificationLedger))],
    [PREFIX_CHAIN_PATH, Buffer.from(prettyJSON(prefixChain))],
    [RECORD_HEAD_PATH, recordHeadRaw],
  ]);
  const unsignedArtifact = buildUnsignedRecordArtifact({
    purpose: "specification-receipt",
    sourceCommit: input.expectedECommit,
    files: unsignedFiles,
  });
  return {
    receipt,
    specificationLedger,
    prefixChain,
    recordHead,
    recordHeadRaw,
    unsignedFiles,
    unsignedArtifact,
  };
}

async function readExactPublication(
  candidate,
  input,
  operations,
  auditToken,
) {
  const tagProtectionRuleset = await auditTagProtectionRuleset(
    candidate,
    operations,
    auditToken,
  );
  const tag = validateExactTag(
    await requireOperation(operations, "readTag", candidate.tag),
    candidate,
    input.expectedECommit,
  );
  const release = validateExactRelease(
    await requireOperation(operations, "readRelease", candidate.tag),
    candidate,
  );
  return { tag, release, tagProtectionRuleset };
}

export async function prepareReceipt(input, operations, runtime = {}) {
  assertMutationAuthority(input?.authority, "prepare-receipt");
  await requireSourcePinnedExecution(input, operations, "record");
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  const state = await requireOperation(operations, "readRecordState", {
    sourceCommit: input.expectedECommit,
  });
  const { candidate, candidateRaw } = loadCandidateState(
    state,
    input,
    expectedFingerprint,
  );
  if (!candidate.lanes.specification) {
    fail("prepare-receipt", "lane", "schema-only publication cannot mint a Specification receipt");
  }
  await verifyNormativeSourceSnapshot(candidate, operations);
  const auditToken = await acquireTagProtectionAuditToken(
    candidate,
    "record",
    operations,
  );
  const sources = candidate.schemaOrigin === null
    ? null
    : await schemaSourceClosure(candidate, operations);
  if (sources !== null) {
    await verifyPostRouteState(candidate, sources, operations);
  }
  const { tag, release, tagProtectionRuleset } = await readExactPublication(
    candidate,
    input,
    operations,
    auditToken,
  );
  const prepared = buildUnsignedSpecificationReceipt({
    state,
    candidate,
    tag,
    release,
    tagProtectionRuleset,
    input,
  });
  return {
    status: "receipt-prepared",
    candidate,
    candidateSha256: sha256(candidateRaw),
    tag,
    release,
    tagProtectionRuleset,
    ...prepared,
  };
}

export async function record(input, operations, runtime = {}) {
  assertMutationAuthority(input?.authority, "record");
  await requireSourcePinnedExecution(input, operations, "record");
  if (input.signerCommand !== undefined) {
    fail(
      "record",
      "authority",
      "record CAS never accepts signer authority; use the isolated seal phase",
    );
  }
  let auditToken = null;
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const state = await requireOperation(operations, "readRecordState", {
      sourceCommit: input.expectedECommit,
    });
    const { candidate, candidateRaw } = loadCandidateState(
      state,
      input,
      expectedFingerprint,
    );
    if (!candidate.lanes.specification) {
      fail("record", "lane", "schema-only publication cannot mint a Specification receipt");
    }
    await verifyNormativeSourceSnapshot(candidate, operations);
    auditToken ??= await acquireTagProtectionAuditToken(
      candidate,
      "record",
      operations,
    );
    if (candidate.schemaOrigin !== null) {
      const sources = await schemaSourceClosure(candidate, operations);
      await verifyPostRouteState(candidate, sources, operations);
    }
    const { tag, release, tagProtectionRuleset } = await readExactPublication(
      candidate,
      input,
      operations,
      auditToken,
    );
    const expected = buildUnsignedSpecificationReceipt({
      state,
      candidate,
      tag,
      release,
      tagProtectionRuleset,
      input,
    });
    const sealed = verifySealedRecordArtifact(input.sealedArtifactRaw, {
      purpose: "specification-receipt",
      sourceCommit: input.expectedECommit,
      publicKeyPEM: state.recordHeadPublicKeyPEM,
      expectedFingerprint,
    });
    for (const path of UNSIGNED_SPECIFICATION_RECEIPT_PATHS) {
      if (!Buffer.from(sealed.files.get(path)).equals(
        expected.unsignedFiles.get(path),
      )) {
        fail(
          "record",
          "sealed-artifact",
          `sealed receipt bytes differ from fresh publication at ${path}`,
        );
      }
    }
    const files = sealed.files;
    const sourceFiles = recordFilesFromState(state);
    const update = await requireOperation(
      operations,
      "tryRecordSpecificationReceipt",
      {
        sourceCommit: input.expectedECommit,
        expectedPaths: [...E_TO_R_TRACKED_PATHS],
        files,
        publication: {
          tag: structuredClone(tag),
          release: structuredClone(release),
          tagProtectionRuleset: structuredClone(tagProtectionRuleset),
        },
        auditToken,
      },
    );
    if (update?.status === "cas-lost") {
      validateSpecificationReceiptCASLost(update, {
        expectedECommit: input.expectedECommit,
        sourceFiles,
      });
      continue;
    }
    if (!exactKeys(update, ["status", "lineage"]) ||
        update.status !== "recorded") {
      fail("record", "receipt-cas", "adapter returned an invalid authoritative CAS classification");
    }
    const lineage = validateSpecificationReceiptLineage(update.lineage, {
      expectedECommit: input.expectedECommit,
      sourceFiles,
      receiptFiles: files,
    });
    return {
      status: "receipt-recorded",
      attempt,
      sourceCommit: input.expectedECommit,
      parentCommit: lineage.parentCommit,
      receiptCommit: lineage.receiptCommit,
      canonicalMainCommit: lineage.canonicalMainCommit,
      receipt: expected.receipt,
      specificationLedger: expected.specificationLedger,
      prefixChain: expected.prefixChain,
      recordHead: expected.recordHead,
      recordHeadSignature: JSON.parse(
        files.get(RECORD_HEAD_SIGNATURE_PATH).toString("utf8"),
      ),
      files,
    };
  }
  fail(
    "record",
    "receipt-cas",
    "canonical main changed during five bounded Specification receipt CAS attempts",
  );
}

export async function verify(input, operations, runtime = {}) {
  const authorityProblems = validateAuthorityTransfer(input?.authority);
  if (authorityProblems.length !== 0) {
    fail("verify", "authority", authorityProblems.join("; "));
  }
  const expectedFingerprint = runtime.expectedRecordKeyFingerprint ??
    PINNED_RECORD_KEY_FINGERPRINT;
  if (input.authority.state === AUTHORITY_PREPARED_STATE) {
    fail(
      "verify",
      "authority",
      "writer is dormant; use the credentialless records gate instead of constructing a release adapter",
    );
  }
  if (input.authority.state !== AUTHORITY_ACTIVE_STATE) {
    fail("verify", "authority", "live release verification requires successor-active authority");
  }
  await requireSourcePinnedExecution(input, operations, "verify");
  if (input.lane === "schema") {
    if (input.version !== undefined || input.expectedRCommit !== undefined) {
      fail(
        "verify",
        "lane",
        "schema-only verification cannot carry a Specification version or receipt commit",
      );
    }
    const state = await requireOperation(
      operations,
      "readSchemaVerificationState",
      { sourceCommit: input.expectedECommit },
    );
    const { candidate } = loadCandidateState(
      state,
      input,
      expectedFingerprint,
    );
    if (candidate.lanes.specification || !candidate.lanes.schema) {
      fail("verify", "lane", "schema verification received another publication lane");
    }
    const sources = await schemaSourceClosure(candidate, operations);
    await verifyPostRouteState(candidate, sources, operations);
    return {
      status: "schema-verified",
      candidate,
      sourceCommit: input.expectedECommit,
    };
  }
  const state = await requireOperation(
    operations,
    "readVerificationState",
    {
      sourceCommit: input.expectedECommit,
      receiptCommit: input.expectedRCommit,
    },
  );
  validateCurrentRecords(state);
  verifyRecordHeadState(state, expectedFingerprint);
  const nToE = validateTrackedTransition(
    state.evidenceTransition,
    input.expectedNCommit,
    input.expectedECommit,
    N_TO_E_TRACKED_PATHS,
  );
  if (nToE.length !== 0) {
    fail("verify", "history", nToE.join("; "));
  }
  const lineage = validateSpecificationReceiptLineage(
    state.receiptLineage,
    {
      expectedECommit: input.expectedECommit,
      expectedRCommit: input.expectedRCommit,
      sourceFiles: state.sourceRecordFiles,
      receiptFiles: recordFilesFromState(state),
    },
  );
  if (state.headCommit !== lineage.canonicalMainCommit) {
    fail(
      "verify",
      "history",
      "verification state is not the freshly classified canonical main",
    );
  }
  const candidateRaw = Buffer.from(state.candidateRaw);
  const candidateProblems = validatePreparedCandidate(candidateRaw, state);
  if (candidateProblems.length !== 0) {
    fail("verify", "candidate", candidateProblems.join("; "));
  }
  const candidate = JSON.parse(candidateRaw.toString("utf8"));
  if (!candidate.lanes.specification ||
      candidate.version !== input.version ||
      candidate.normativeCommit !== input.expectedDCommit ||
      candidate.reservationCommit !== input.expectedNCommit) {
    fail("verify", "candidate", "command identities differ from retained candidate");
  }
  await verifyNormativeSourceSnapshot(candidate, operations);
  const auditToken = await acquireTagProtectionAuditToken(
    candidate,
    "verify",
    operations,
  );
  if (candidate.schemaOrigin !== null) {
    const sources = await schemaSourceClosure(candidate, operations);
    await verifyPostRouteState(candidate, sources, operations);
  }
  const { tag, release, tagProtectionRuleset } = await readExactPublication(
    candidate,
    input,
    operations,
    auditToken,
  );
  const expectedReceipt = buildSpecificationReceipt(
    candidate,
    tag,
    release,
    tagProtectionRuleset,
    input,
  );
  const receipt = state.specificationLedger.releases.find(
    (entry) => entry.version === candidate.version,
  );
  if (!same(receipt, expectedReceipt)) {
    fail("verify", "receipt", "ledger receipt differs from exact live readback");
  }
  return {
    status: "verified",
    candidate,
    receipt,
    tag,
    release,
    receiptCommit: lineage.receiptCommit,
    canonicalMainCommit: lineage.canonicalMainCommit,
  };
}

export const reserveSpecificationRelease = reserve;
export const prepareSpecificationRelease = prepare;
export const publishSpecificationRelease = publish;
export const recoverSpecificationRelease = recover;
export const recordSpecificationRelease = record;
export const verifySpecificationRelease = verify;

export async function main(argv = process.argv.slice(2)) {
  const options = parseSpecificationReleaseArgs(argv);
  const authority = JSON.parse(readFileSync(AUTHORITY_PATH, "utf8"));
  if (options.phase !== "verify") {
    // The checked-in P0 entrypoint intentionally terminates here. No credential,
    // signer, writer, schema-origin, GitHub or network adapter is constructed
    // until a later reviewed activation changes the authority record.
    assertMutationAuthority(authority, options.phase);
  }
  throw new Error(
    "active Specification release execution requires the owning deploy adapter",
  );
}

export { classifySpecificationPublicationSource };

if (import.meta.main) await main();
