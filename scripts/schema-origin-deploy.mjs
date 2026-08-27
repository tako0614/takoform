#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  closeSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  inspectSchemaProjection,
  readSchemaIdentityLedger,
} from "./schema-origin-projection.mjs";
import {
  schemaRouteCutoverClosureSha256,
  specificationWriterClosurePaths,
  validateAuthorityTransfer,
  validateSpecificationWriterClosureManifest,
} from "./records.mjs";
import {
  parseSchemaToolClosurePolicy,
  sealInstalledToolClosure,
  validateSchemaToolRuntimePolicy,
} from "./specification-release-adapter.mjs";
import {
  WRITER_CLOSURE_MANIFEST_PATH,
  WRITER_EXECUTION_PATHS,
  WRITER_TOOL_CLOSURE_POLICY_PATH,
} from "./specification-release.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const CLOUDFLARE_ID = /^[0-9a-f]{32}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;
const CANDIDATE_KIND = "takoform.schema-origin-cutover-candidate@v1";
const REVIEW_KIND = "takoform.schema-origin-independent-review@v1";
const STAGE_KIND = "takoform.schema-origin-stage-record@v1";
const TOMBSTONE_KIND = "takoform.schema-origin-predecessor-tombstone-readback@v1";
const CUTOVER_KIND = "takoform.schema-origin-cutover-record@v1";
const ACTIVATION_KIND =
  "takoform.schema-origin-authority-activation-evidence@v1";
const REVERT_KIND = "takoform.schema-origin-revert-record@v1";

const requiredReviewChecks = Object.freeze([
  "candidate-and-source-closure",
  "predecessor-disable-before-cutover-order",
  "public-byte-and-sentinel-readback",
  "route-custom-domain-and-version-state",
  "stage-without-trigger-and-exact-reversal",
]);
const requiredTombstoneChecks = Object.freeze([
  "canonical-main-is-tombstone",
  "predecessor-schema-writer-disabled",
  "predecessor-specification-writer-disabled",
  "successor-prepared-commit-pinned",
]);
const customDomainHosts = Object.freeze([
  "takoform.com",
  "www.takoform.com",
  "forms.takoform.com",
]);

export const SCHEMA_ORIGIN = Object.freeze({
  repository: "https://github.com/tako0614/takoform.git",
  predecessorRepository:
    "https://github.com/tako0614/terraform-provider-takoform.git",
  worker: "takoform-schema-origin",
  predecessorWorker: "takoform-website",
  zoneName: "takoform.com",
  routePattern: "forms.takoform.com/schemas/*",
  origin: "https://forms.takoform.com",
  configPath: "schema-origin/wrangler.jsonc",
  ledgerPath: "release/public-schema-identities.json",
  authorityPath: "release/specification-authority.json",
  projectionRoot: "schema-origin/public",
  wranglerVersion: "4.115.0",
  activeSchemaCount: 31,
  activeSchemaBytes: 155_294,
  retiredSchemaCount: 15,
  unknownSchemaUrl:
    "https://forms.takoform.com/schemas/__takoform-schema-origin-cutover-unknown__.json",
  customDomainHosts,
  requiredReviewChecks,
  requiredTombstoneChecks,
});

export class SchemaOriginFailure extends Error {
  constructor(
    phase,
    stage,
    message,
    {
      externalStateTouched = false,
      externalStateIndeterminate = false,
      recoveryEvidence = [],
      cause,
    } = {},
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SchemaOriginFailure";
    this.phase = phase;
    this.stage = stage;
    this.repositoryStateTouched = false;
    this.repositoryStateIndeterminate = false;
    this.externalStateTouched = externalStateTouched;
    this.externalStateIndeterminate = externalStateIndeterminate;
    this.recoveryEvidence = Array.isArray(recoveryEvidence)
      ? recoveryEvidence
      : [];
  }
}

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  }
  return value;
}

export function canonicalJSON(value) {
  return `${JSON.stringify(ordered(value), null, 2)}\n`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function same(left, right) {
  return canonicalJSON(left) === canonicalJSON(right);
}

function exactKeys(value, expected) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...expected].sort())
  );
}

function relationIsInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function canonicalInstant(value) {
  return (
    typeof value === "string" &&
    CANONICAL_INSTANT.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value.replace("Z", ".000Z")
  );
}

function failure(phase, stage, message, tracker, options = {}) {
  const externalStateTouched =
    options.externalStateTouched ?? tracker?.externalStateTouched ?? false;
  const externalStateIndeterminate = options.externalStateIndeterminate ?? false;
  if (externalStateTouched || externalStateIndeterminate) {
    try {
      tracker?.retainRecoveryEvidence?.({ phase, stage });
    } catch {
      // Recovery evidence is best effort; the original fail-closed error wins.
    }
  }
  throw new SchemaOriginFailure(phase, stage, message, {
    externalStateTouched,
    externalStateIndeterminate,
    recoveryEvidence:
      options.recoveryEvidence ?? tracker?.getRecoveryEvidence?.() ?? [],
    cause: options.cause,
  });
}

async function readOperation(phase, stage, tracker, callback, {
  indeterminateAfterMutation = false,
} = {}) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof SchemaOriginFailure) {
      if (
        error.externalStateTouched ||
        error.externalStateIndeterminate ||
        tracker?.externalStateTouched
      ) {
        try {
          tracker?.retainRecoveryEvidence?.({ phase, stage });
        } catch {
          // Keep the original structured failure.
        }
      }
      error.recoveryEvidence = tracker?.getRecoveryEvidence?.() ?? error.recoveryEvidence ?? [];
      throw error;
    }
    failure(phase, stage, error?.message ?? String(error), tracker, {
      cause: error,
      externalStateIndeterminate:
        indeterminateAfterMutation && tracker?.externalStateTouched === true,
    });
  }
}

async function mutationOperation(phase, stage, tracker, callback) {
  try {
    const result = await callback();
    tracker.externalStateTouched = true;
    return result;
  } catch (error) {
    if (error instanceof SchemaOriginFailure) {
      try {
        tracker?.retainRecoveryEvidence?.({ phase, stage });
      } catch {
        // Keep the original structured failure.
      }
      error.recoveryEvidence = tracker?.getRecoveryEvidence?.() ?? error.recoveryEvidence ?? [];
      throw error;
    }
    failure(phase, stage, error?.message ?? String(error), tracker, {
      cause: error,
      externalStateIndeterminate: true,
    });
  }
}

function requireToken(phase, stage, env, tracker) {
  const token = env?.CLOUDFLARE_API_TOKEN;
  if (typeof token !== "string" || token.trim() === "") {
    failure(
      phase,
      stage,
      "CLOUDFLARE_API_TOKEN is required for this control-plane operation",
      tracker,
    );
  }
  return token;
}

function verifyOperationToolClosure(phase, operations, tracker) {
  if (typeof operations?.verifyToolClosure !== "function") return;
  try {
    operations.verifyToolClosure();
  } catch (error) {
    failure(phase, "sealed-tool-closure", error?.message ?? String(error), tracker, {
      cause: error,
    });
  }
}

function phaseTracker(operations) {
  return {
    externalStateTouched: false,
    retainRecoveryEvidence(reason) {
      operations?.retainRecoveryEvidence?.(reason);
    },
    getRecoveryEvidence() {
      return operations?.getRecoveryEvidence?.() ?? [];
    },
  };
}

function validateAbsoluteRecordPath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !path.isAbsolute(value)
  ) {
    throw new Error(`${label} must be an absolute outside-repository path`);
  }
  return value;
}

function validateCommit(value, label) {
  if (typeof value !== "string" || !COMMIT.test(value)) {
    throw new Error(`${label} must be a lowercase 40-character commit`);
  }
  return value;
}

function validateCloudflareId(value, label) {
  if (typeof value !== "string" || !CLOUDFLARE_ID.test(value)) {
    throw new Error(`${label} must be a lowercase 32-character Cloudflare id`);
  }
  return value;
}

function validateCanonicalSchemaUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`${label} must be a URL (${error.message})`);
  }
  if (
    parsed.href !== value ||
    parsed.origin !== SCHEMA_ORIGIN.origin ||
    !/^\/schemas\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.json$/u.test(
      parsed.pathname,
    ) ||
    parsed.pathname.includes("%") ||
    parsed.pathname.includes("\\") ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname.split("/").includes("v2")
  ) {
    throw new Error(
      `${label} must be a canonical ${SCHEMA_ORIGIN.origin}/schemas/*.json URL and must not contain /v2`,
    );
  }
  return value;
}

function validateSentinelUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(`sentinel URL is invalid (${error.message})`);
  }
  if (
    parsed.href !== value ||
    parsed.origin !== SCHEMA_ORIGIN.origin ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.pathname === "/schemas" ||
    parsed.pathname.startsWith("/schemas/") ||
    parsed.pathname.split("/").includes("v2") ||
    parsed.pathname.includes("%") ||
    parsed.pathname.includes("\\")
  ) {
    throw new Error(
      `sentinel URL must be a canonical non-schema, non-/v2 ${SCHEMA_ORIGIN.origin} URL`,
    );
  }
  return value;
}

const phaseOptions = Object.freeze({
  prepare: Object.freeze([
    "expected-commit",
    "account-id",
    "zone-id",
    "sentinel-url",
    "output",
  ]),
  stage: Object.freeze([
    "expected-commit",
    "candidate",
    "review-record",
    "output",
  ]),
  cutover: Object.freeze([
    "expected-commit",
    "candidate",
    "stage-record",
    "predecessor-tombstone-commit",
    "predecessor-readback",
    "output",
  ]),
  "prepare-activation": Object.freeze([
    "expected-commit",
    "candidate",
    "stage-record",
    "cutover-record",
    "cutover-record-sha256",
    "predecessor-tombstone-commit",
    "predecessor-readback",
    "output",
  ]),
  verify: Object.freeze(["candidate"]),
  revert: Object.freeze([
    "expected-commit",
    "candidate",
    "route-id",
    "script",
    "output",
  ]),
});

function camelCase(option) {
  return option.replace(/-([a-z])/gu, (_, character) => character.toUpperCase());
}

export function parseSchemaOriginArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || !(args[0] in phaseOptions)) {
    throw new Error(
      "usage: schema-origin-deploy.mjs <prepare|stage|cutover|prepare-activation|verify|revert> [exact options]",
    );
  }
  const phase = args[0];
  const allowed = new Set(phaseOptions[phase]);
  const parsed = { phase };
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      typeof flag !== "string" ||
      !flag.startsWith("--") ||
      flag.length === 2 ||
      !allowed.has(flag.slice(2)) ||
      typeof value !== "string" ||
      value.startsWith("--")
    ) {
      throw new Error(`invalid or unknown ${phase} option ${flag ?? "<missing>"}`);
    }
    const key = camelCase(flag.slice(2));
    if (key in parsed) throw new Error(`duplicate ${flag}`);
    parsed[key] = value;
  }
  for (const option of allowed) {
    const key = camelCase(option);
    if (!(key in parsed)) throw new Error(`missing --${option}`);
  }
  if ("expectedCommit" in parsed) {
    validateCommit(parsed.expectedCommit, "--expected-commit");
  }
  if ("predecessorTombstoneCommit" in parsed) {
    validateCommit(
      parsed.predecessorTombstoneCommit,
      "--predecessor-tombstone-commit",
    );
  }
  if ("accountId" in parsed) validateCloudflareId(parsed.accountId, "--account-id");
  if ("zoneId" in parsed) validateCloudflareId(parsed.zoneId, "--zone-id");
  if ("routeId" in parsed) validateCloudflareId(parsed.routeId, "--route-id");
  if ("cutoverRecordSha256" in parsed) {
    validateDigest(parsed.cutoverRecordSha256, "--cutover-record-sha256");
  }
  if ("sentinelUrl" in parsed) validateSentinelUrl(parsed.sentinelUrl);
  for (const key of [
    "candidate",
    "reviewRecord",
    "stageRecord",
    "cutoverRecord",
    "predecessorReadback",
    "output",
  ]) {
    if (key in parsed) validateAbsoluteRecordPath(parsed[key], `--${key}`);
  }
  if (phase === "revert" && parsed.script !== SCHEMA_ORIGIN.worker) {
    throw new Error(`--script must be exactly ${SCHEMA_ORIGIN.worker}`);
  }
  return parsed;
}

function validateDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a canonical sha256 digest`);
  }
}

function validateSchemaEntry(entry, label, { projected }) {
  const expected = projected
    ? ["bytes", "projectionPath", "sha256", "sourcePath", "url"]
    : ["sha256", "url"];
  if (!exactKeys(entry, expected)) throw new Error(`${label} has an unexpected field set`);
  validateCanonicalSchemaUrl(entry.url, `${label} URL`);
  validateDigest(entry.sha256, `${label} digest`);
  if (projected) {
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
      throw new Error(`${label} byte length is invalid`);
    }
    const pathname = new URL(entry.url).pathname.slice(1);
    if (entry.projectionPath !== `${SCHEMA_ORIGIN.projectionRoot}/${pathname}`) {
      throw new Error(`${label} projection path does not match its URL`);
    }
    if (
      typeof entry.sourcePath !== "string" ||
      !/^spec\/schemas\/[A-Za-z0-9._~-]+\.json$/u.test(entry.sourcePath)
    ) {
      throw new Error(`${label} source path is not canonical`);
    }
  }
}

function validateClosedSchemas(active, retired) {
  if (!Array.isArray(active) || active.length !== SCHEMA_ORIGIN.activeSchemaCount) {
    throw new Error(`active schema closure must contain exactly ${SCHEMA_ORIGIN.activeSchemaCount} entries`);
  }
  if (!Array.isArray(retired) || retired.length !== SCHEMA_ORIGIN.retiredSchemaCount) {
    throw new Error(`retired schema closure must contain exactly ${SCHEMA_ORIGIN.retiredSchemaCount} entries`);
  }
  const ids = new Set();
  const projections = new Set();
  const sources = new Set();
  for (const [index, entry] of active.entries()) {
    validateSchemaEntry(entry, `active schema ${index}`, { projected: true });
    if (ids.has(entry.url)) throw new Error(`duplicate active schema URL ${entry.url}`);
    if (projections.has(entry.projectionPath)) throw new Error(`duplicate projection path ${entry.projectionPath}`);
    if (sources.has(entry.sourcePath)) throw new Error(`duplicate source path ${entry.sourcePath}`);
    ids.add(entry.url);
    projections.add(entry.projectionPath);
    sources.add(entry.sourcePath);
  }
  const sorted = active.map(({ url }) => url).sort();
  if (!same(active.map(({ url }) => url), sorted)) {
    throw new Error("active schema URLs must be sorted");
  }
  const totalBytes = active.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes !== SCHEMA_ORIGIN.activeSchemaBytes) {
    throw new Error(`active schema closure must total exactly ${SCHEMA_ORIGIN.activeSchemaBytes} bytes`);
  }
  for (const [index, entry] of retired.entries()) {
    validateSchemaEntry(entry, `retired schema ${index}`, { projected: false });
    if (ids.has(entry.url)) throw new Error(`schema URL is both active and retired: ${entry.url}`);
    ids.add(entry.url);
  }
  if (ids.has(SCHEMA_ORIGIN.unknownSchemaUrl)) {
    throw new Error("fixed unknown schema sentinel collides with a ledger identity");
  }
}

function validateBundle(bundle) {
  if (!exactKeys(bundle, ["files", "sha256", "totalBytes", "wranglerVersion"])) {
    throw new Error("dry-run bundle has an unexpected field set");
  }
  if (bundle.wranglerVersion !== SCHEMA_ORIGIN.wranglerVersion) {
    throw new Error(`dry-run bundle must use pinned Wrangler ${SCHEMA_ORIGIN.wranglerVersion}`);
  }
  validateDigest(bundle.sha256, "dry-run bundle digest");
  if (!Number.isSafeInteger(bundle.totalBytes) || bundle.totalBytes <= 0 || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error("dry-run bundle closure is empty or invalid");
  }
  const paths = new Set();
  let total = 0;
  for (const [index, file] of bundle.files.entries()) {
    if (!exactKeys(file, ["bytes", "path", "sha256"])) throw new Error(`bundle file ${index} has an unexpected field set`);
    if (typeof file.path !== "string" || file.path === "" || file.path.startsWith("/") || file.path.includes("..") || file.path.includes("\\")) {
      throw new Error(`bundle file ${index} path is invalid`);
    }
    if (paths.has(file.path)) throw new Error(`duplicate bundle file ${file.path}`);
    paths.add(file.path);
    validateDigest(file.sha256, `bundle file ${file.path}`);
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0) throw new Error(`bundle file ${file.path} byte length is invalid`);
    total += file.bytes;
  }
  if (total !== bundle.totalBytes) throw new Error("dry-run bundle total does not close over its files");
}

function validateLocalEvidence(local, expectedCommit) {
  if (!exactKeys(local, ["authority", "config", "dryRunBundle", "ledger", "projection", "retired", "source"])) {
    throw new Error("local evidence has an unexpected field set");
  }
  if (!exactKeys(local.source, ["branch", "canonicalMainCommit", "clean", "commit", "repository"]) ||
      local.source.repository !== SCHEMA_ORIGIN.repository ||
      local.source.branch !== "main" ||
      local.source.commit !== expectedCommit ||
      local.source.canonicalMainCommit !== expectedCommit ||
      local.source.clean !== true) {
    throw new Error("source is not the exact clean canonical Core main commit");
  }
  if (!exactKeys(local.authority, ["document", "path", "sha256"]) || local.authority.path !== SCHEMA_ORIGIN.authorityPath) {
    throw new Error("authority evidence is invalid");
  }
  validateDigest(local.authority.sha256, "authority digest");
  const authorityProblems = validateAuthorityTransfer(local.authority.document);
  if (authorityProblems.length !== 0) throw new Error(`authority receipt is invalid (${authorityProblems.join("; ")})`);
  if (local.authority.document.state !== "prepared-writer-disabled") {
    throw new Error(`Core authority must remain prepared-writer-disabled, observed ${local.authority.document.state}`);
  }
  if (!COMMIT.test(local.authority.document.successorPreparedCommit ?? "")) {
    throw new Error("prepared Core authority must already pin its exact P0 commit");
  }
  if (!exactKeys(local.ledger, ["path", "sha256"]) || local.ledger.path !== SCHEMA_ORIGIN.ledgerPath) {
    throw new Error("schema ledger evidence is invalid");
  }
  validateDigest(local.ledger.sha256, "schema ledger digest");
  if (!exactKeys(local.config, ["path", "sha256"]) || local.config.path !== SCHEMA_ORIGIN.configPath) {
    throw new Error("schema origin config evidence is invalid");
  }
  validateDigest(local.config.sha256, "schema origin config digest");
  if (!exactKeys(local.projection, ["entries", "root", "sha256", "totalBytes"]) || local.projection.root !== SCHEMA_ORIGIN.projectionRoot) {
    throw new Error("schema projection evidence is invalid");
  }
  validateDigest(local.projection.sha256, "schema projection digest");
  validateClosedSchemas(local.projection.entries, local.retired);
  if (local.projection.totalBytes !== SCHEMA_ORIGIN.activeSchemaBytes) {
    throw new Error("schema projection total byte count is invalid");
  }
  validateBundle(local.dryRunBundle);
  return local;
}

function normalizeRoute(route) {
  if (route === null || typeof route !== "object" || Array.isArray(route)) {
    throw new Error("route readback contains a non-object");
  }
  validateCloudflareId(route.id, "route id");
  if (typeof route.pattern !== "string" || typeof route.script !== "string") {
    throw new Error("route readback lacks pattern or script");
  }
  return { id: route.id, pattern: route.pattern, script: route.script };
}

function assertRoutesAbsent(phase, stage, routes, tracker) {
  if (!Array.isArray(routes)) failure(phase, stage, "route readback is not an array", tracker);
  let normalized;
  try {
    normalized = routes.map(normalizeRoute);
  } catch (error) {
    failure(phase, stage, error.message, tracker);
  }
  if (normalized.length !== 0) {
    failure(
      phase,
      stage,
      `zone routes must be exactly empty before staging/cutover; observed ${normalized.length}`,
      tracker,
    );
  }
  return normalized;
}

function assertExactRoute(phase, stage, routes, tracker, expectedRouteId) {
  if (!Array.isArray(routes)) failure(phase, stage, "route readback is not an array", tracker);
  let normalized;
  try {
    normalized = routes.map(normalizeRoute);
  } catch (error) {
    failure(phase, stage, error.message, tracker);
  }
  if (
    normalized.length !== 1 ||
    normalized[0].pattern !== SCHEMA_ORIGIN.routePattern ||
    normalized[0].script !== SCHEMA_ORIGIN.worker ||
    (expectedRouteId !== undefined && normalized[0].id !== expectedRouteId)
  ) {
    failure(
      phase,
      stage,
      `route state must contain only ${SCHEMA_ORIGIN.routePattern} -> ${SCHEMA_ORIGIN.worker}${expectedRouteId ? ` with id ${expectedRouteId}` : ""}`,
      tracker,
    );
  }
  return normalized[0];
}

function normalizeCustomDomains(domains, target) {
  if (!Array.isArray(domains)) throw new Error("custom-domain readback is not an array");
  const normalized = domains.map((domain, index) => {
    if (domain === null || typeof domain !== "object" || Array.isArray(domain)) {
      throw new Error(`custom domain ${index} is not an object`);
    }
    if (!UUID.test(domain.id ?? "") || !UUID.test(domain.certId ?? "")) {
      throw new Error(`custom domain ${index} has an invalid id or cert id`);
    }
    const result = {
      id: domain.id,
      certId: domain.certId,
      hostname: domain.hostname,
      service: domain.service,
      zoneId: domain.zoneId,
      zoneName: domain.zoneName,
      environment: domain.environment ?? null,
    };
    if (
      !customDomainHosts.includes(result.hostname) ||
      result.service !== SCHEMA_ORIGIN.predecessorWorker ||
      result.zoneId !== target.zoneId ||
      result.zoneName !== SCHEMA_ORIGIN.zoneName ||
      ![null, "production"].includes(result.environment)
    ) {
      throw new Error(`custom domain ${index} differs from the exact predecessor ownership`);
    }
    return result;
  });
  if (normalized.length !== customDomainHosts.length) {
    throw new Error(`expected exactly ${customDomainHosts.length} custom domains in zone ${SCHEMA_ORIGIN.zoneName}`);
  }
  const byHost = new Map();
  for (const domain of normalized) {
    if (byHost.has(domain.hostname)) throw new Error(`duplicate custom domain ${domain.hostname}`);
    byHost.set(domain.hostname, domain);
  }
  if (customDomainHosts.some((hostname) => !byHost.has(hostname))) {
    throw new Error("custom-domain closure is missing a predecessor hostname");
  }
  return customDomainHosts.map((hostname) => byHost.get(hostname));
}

function assertCustomDomains(phase, stage, domains, target, tracker, expected) {
  let normalized;
  try {
    normalized = normalizeCustomDomains(domains, target);
  } catch (error) {
    failure(phase, stage, error.message, tracker);
  }
  if (expected !== undefined && !same(normalized, expected)) {
    failure(phase, stage, "custom-domain IDs or ownership changed from the prepared candidate", tracker);
  }
  return normalized;
}

function assertWorkerAbsent(phase, stage, workerState, tracker) {
  if (
    !exactKeys(workerState, ["deployments", "exists", "versions"]) ||
    workerState.exists !== false ||
    !Array.isArray(workerState.versions) ||
    workerState.versions.length !== 0 ||
    !Array.isArray(workerState.deployments) ||
    workerState.deployments.length !== 0
  ) {
    failure(
      phase,
      stage,
      `${SCHEMA_ORIGIN.worker} must be exactly absent before the one-time stage`,
      tracker,
    );
  }
  return { exists: false, versions: [], deployments: [] };
}

function normalizeObservation(observation, expectedUrl, label) {
  if (
    !exactKeys(observation, [
      "bytes",
      "contentType",
      "location",
      "redirected",
      "sha256",
      "status",
      "url",
    ]) ||
    observation.url !== expectedUrl ||
    observation.redirected !== false ||
    observation.location !== null ||
    !Number.isSafeInteger(observation.status) ||
    !Number.isSafeInteger(observation.bytes) ||
    observation.bytes < 0 ||
    typeof observation.contentType !== "string" ||
    !SHA256.test(observation.sha256 ?? "")
  ) {
    throw new Error(`${label} has a redirect, ambiguous URL, or invalid response envelope`);
  }
  return observation;
}

async function readPublicClosure(phase, candidateLike, operations, tracker) {
  const activeReadback = [];
  for (const [index, schema] of candidateLike.schemas.active.entries()) {
    const observation = await readOperation(
      phase,
      "public-active-readback",
      tracker,
      () => operations.readPublic(schema.url),
      { indeterminateAfterMutation: true },
    );
    let normalized;
    try {
      normalized = normalizeObservation(observation, schema.url, `active schema ${index}`);
    } catch (error) {
      failure(phase, "public-active-readback", error.message, tracker);
    }
    if (
      normalized.status !== 200 ||
      normalized.contentType !== "application/json" ||
      normalized.sha256 !== schema.sha256 ||
      normalized.bytes !== schema.bytes
    ) {
      failure(
        phase,
        "public-active-readback",
        `active schema ${schema.url} is not exact 200/application-json locked bytes`,
        tracker,
      );
    }
    activeReadback.push(normalized);
  }

  const retiredReadback = [];
  for (const [index, schema] of candidateLike.schemas.retired.entries()) {
    const observation = await readOperation(
      phase,
      "public-retired-readback",
      tracker,
      () => operations.readPublic(schema.url),
      { indeterminateAfterMutation: true },
    );
    let normalized;
    try {
      normalized = normalizeObservation(observation, schema.url, `retired schema ${index}`);
    } catch (error) {
      failure(phase, "public-retired-readback", error.message, tracker);
    }
    if (normalized.status !== 404) {
      failure(phase, "public-retired-readback", `retired schema ${schema.url} must be exactly 404`, tracker);
    }
    retiredReadback.push(normalized);
  }

  const unknown = await readOperation(
    phase,
    "public-unknown-readback",
    tracker,
    () => operations.readPublic(candidateLike.schemas.unknownUrl),
    { indeterminateAfterMutation: true },
  );
  let normalizedUnknown;
  try {
    normalizedUnknown = normalizeObservation(
      unknown,
      candidateLike.schemas.unknownUrl,
      "unknown schema sentinel",
    );
  } catch (error) {
    failure(phase, "public-unknown-readback", error.message, tracker);
  }
  if (normalizedUnknown.status !== 404) {
    failure(phase, "public-unknown-readback", "unknown schema sentinel must be exactly 404", tracker);
  }

  const sentinel = await readOperation(
    phase,
    "public-non-schema-sentinel",
    tracker,
    () => operations.readPublic(candidateLike.sentinelUrl),
    { indeterminateAfterMutation: true },
  );
  let normalizedSentinel;
  try {
    normalizedSentinel = normalizeObservation(
      sentinel,
      candidateLike.sentinelUrl,
      "non-schema sentinel",
    );
  } catch (error) {
    failure(phase, "public-non-schema-sentinel", error.message, tracker);
  }
  if (normalizedSentinel.status !== 200) {
    failure(phase, "public-non-schema-sentinel", "non-schema sentinel must be exactly 200", tracker);
  }

  return {
    activeSha256: sha256(canonicalJSON(activeReadback)),
    retiredSha256: sha256(
      canonicalJSON(
        retiredReadback.map(({ url, status }) => ({ url, status })),
      ),
    ),
    unknown: {
      url: normalizedUnknown.url,
      status: normalizedUnknown.status,
    },
    sentinel: normalizedSentinel,
  };
}

function targetFromOptions(options) {
  return {
    accountId: options.accountId,
    zoneId: options.zoneId,
    zoneName: SCHEMA_ORIGIN.zoneName,
    worker: SCHEMA_ORIGIN.worker,
    routePattern: SCHEMA_ORIGIN.routePattern,
  };
}

function validateTarget(target) {
  if (!exactKeys(target, ["accountId", "routePattern", "worker", "zoneId", "zoneName"])) throw new Error("candidate target has an unexpected field set");
  validateCloudflareId(target.accountId, "candidate account id");
  validateCloudflareId(target.zoneId, "candidate zone id");
  if (target.zoneName !== SCHEMA_ORIGIN.zoneName || target.worker !== SCHEMA_ORIGIN.worker || target.routePattern !== SCHEMA_ORIGIN.routePattern) {
    throw new Error("candidate names another zone, worker, host, path, or route");
  }
}

function candidateFrom(local, target, sentinelUrl, publicReadback, domains) {
  return {
    kind: CANDIDATE_KIND,
    source: local.source,
    authority: {
      path: local.authority.path,
      sha256: local.authority.sha256,
      state: local.authority.document.state,
      successorPreparedCommit: local.authority.document.successorPreparedCommit,
    },
    target,
    artifacts: {
      ledger: local.ledger,
      projection: local.projection,
      config: local.config,
      dryRunBundle: local.dryRunBundle,
    },
    schemas: {
      active: local.projection.entries,
      retired: local.retired,
      unknownUrl: SCHEMA_ORIGIN.unknownSchemaUrl,
    },
    sentinelUrl,
    preflight: {
      public: publicReadback,
      routes: [],
      customDomains: domains,
      worker: { exists: false, versions: [], deployments: [] },
    },
  };
}

// Candidate validation cannot call the authority validator without copying the
// whole mutable authority document into an operator record. Keep that document
// local and close the candidate over only its raw digest and prepared P0 pin.
function validateCandidateRecord(candidate) {
  if (!exactKeys(candidate, ["artifacts", "authority", "kind", "preflight", "schemas", "sentinelUrl", "source", "target"]) || candidate.kind !== CANDIDATE_KIND) {
    throw new Error("candidate has an unknown kind or field set");
  }
  if (!exactKeys(candidate.source, ["branch", "canonicalMainCommit", "clean", "commit", "repository"]) ||
      candidate.source.repository !== SCHEMA_ORIGIN.repository ||
      candidate.source.branch !== "main" ||
      candidate.source.clean !== true ||
      candidate.source.commit !== candidate.source.canonicalMainCommit ||
      !COMMIT.test(candidate.source.commit ?? "")) {
    throw new Error("candidate source is not an exact clean canonical main commit");
  }
  if (!exactKeys(candidate.authority, ["path", "sha256", "state", "successorPreparedCommit"]) ||
      candidate.authority.path !== SCHEMA_ORIGIN.authorityPath ||
      candidate.authority.state !== "prepared-writer-disabled" ||
      !COMMIT.test(candidate.authority.successorPreparedCommit ?? "")) {
    throw new Error("candidate authority is not prepared-writer-disabled with an exact P0 pin");
  }
  validateDigest(candidate.authority.sha256, "candidate authority digest");
  validateTarget(candidate.target);
  validateSentinelUrl(candidate.sentinelUrl);
  if (!exactKeys(candidate.artifacts, ["config", "dryRunBundle", "ledger", "projection"])) throw new Error("candidate artifacts have an unexpected field set");
  if (!exactKeys(candidate.artifacts.ledger, ["path", "sha256"]) || candidate.artifacts.ledger.path !== SCHEMA_ORIGIN.ledgerPath) throw new Error("candidate ledger evidence is invalid");
  validateDigest(candidate.artifacts.ledger.sha256, "candidate ledger digest");
  if (!exactKeys(candidate.artifacts.config, ["path", "sha256"]) || candidate.artifacts.config.path !== SCHEMA_ORIGIN.configPath) throw new Error("candidate config evidence is invalid");
  validateDigest(candidate.artifacts.config.sha256, "candidate config digest");
  if (!exactKeys(candidate.artifacts.projection, ["entries", "root", "sha256", "totalBytes"]) || candidate.artifacts.projection.root !== SCHEMA_ORIGIN.projectionRoot || candidate.artifacts.projection.totalBytes !== SCHEMA_ORIGIN.activeSchemaBytes) throw new Error("candidate projection evidence is invalid");
  validateDigest(candidate.artifacts.projection.sha256, "candidate projection digest");
  validateBundle(candidate.artifacts.dryRunBundle);
  if (!exactKeys(candidate.schemas, ["active", "retired", "unknownUrl"]) || candidate.schemas.unknownUrl !== SCHEMA_ORIGIN.unknownSchemaUrl || !same(candidate.schemas.active, candidate.artifacts.projection.entries)) throw new Error("candidate schema inventories do not close over the projection");
  validateClosedSchemas(candidate.schemas.active, candidate.schemas.retired);
  if (!exactKeys(candidate.preflight, ["customDomains", "public", "routes", "worker"]) || !Array.isArray(candidate.preflight.routes) || candidate.preflight.routes.length !== 0) throw new Error("candidate route preflight is not exactly empty");
  const domains = normalizeCustomDomains(candidate.preflight.customDomains, candidate.target);
  if (!same(domains, candidate.preflight.customDomains)) throw new Error("candidate custom domains are not canonical");
  if (!exactKeys(candidate.preflight.worker, ["deployments", "exists", "versions"]) || candidate.preflight.worker.exists !== false || candidate.preflight.worker.versions.length !== 0 || candidate.preflight.worker.deployments.length !== 0) throw new Error("candidate Worker preflight is not exactly absent");
  if (!exactKeys(candidate.preflight.public, ["activeSha256", "retiredSha256", "sentinel", "unknown"])) throw new Error("candidate public preflight has an unexpected field set");
  validateDigest(candidate.preflight.public.activeSha256, "candidate active readback digest");
  validateDigest(candidate.preflight.public.retiredSha256, "candidate retired readback digest");
  if (!exactKeys(candidate.preflight.public.unknown, ["status", "url"]) || candidate.preflight.public.unknown.url !== SCHEMA_ORIGIN.unknownSchemaUrl || candidate.preflight.public.unknown.status !== 404) throw new Error("candidate unknown readback is not the exact URL/404 pair");
  normalizeObservation(candidate.preflight.public.sentinel, candidate.sentinelUrl, "candidate sentinel readback");
  if (candidate.preflight.public.sentinel.status !== 200) throw new Error("candidate sentinel readback is not 200");
  return candidate;
}

async function loadCanonicalRecord(phase, stage, recordPath, operations, tracker) {
  const raw = await readOperation(phase, stage, tracker, () => operations.readRecord(recordPath));
  const bytes = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
  if (typeof bytes !== "string" || Buffer.byteLength(bytes) > 10 * 1024 * 1024) {
    failure(phase, stage, "record is not bounded UTF-8 JSON", tracker);
  }
  let value;
  try {
    value = JSON.parse(bytes);
  } catch (error) {
    failure(phase, stage, `record is invalid JSON (${error.message})`, tracker);
  }
  if (canonicalJSON(value) !== bytes) {
    failure(phase, stage, "record bytes are not exact canonical JSON", tracker);
  }
  return { value, bytes, sha256: sha256(bytes) };
}

function assertCandidateMatchesLocal(phase, candidate, local, tracker) {
  const expected = candidateFrom(
    local,
    candidate.target,
    candidate.sentinelUrl,
    candidate.preflight.public,
    candidate.preflight.customDomains,
  );
  if (!same(expected, candidate)) {
    failure(
      phase,
      "candidate-current-source",
      "candidate no longer matches the exact clean canonical prepared Core source, authority, ledger, projection, config, or dry-run bundle",
      tracker,
    );
  }
}

function assertPublicMatchesCandidate(phase, readback, candidate, tracker) {
  if (!same(readback, candidate.preflight.public)) {
    failure(
      phase,
      "public-candidate-readback",
      "public schema or non-schema sentinel readback changed from the prepared candidate",
      tracker,
    );
  }
}

function validateReviewRecord(phase, review, candidate, candidateSha256, tracker) {
  if (!exactKeys(review, ["approved", "candidateSha256", "kind", "reviewed", "reviewedAt", "reviewer", "sourceCommit"]) ||
      review.kind !== REVIEW_KIND ||
      review.approved !== true ||
      review.candidateSha256 !== candidateSha256 ||
      review.sourceCommit !== candidate.source.commit ||
      typeof review.reviewer !== "string" ||
      review.reviewer.trim() === "" ||
      !canonicalInstant(review.reviewedAt) ||
      !same(review.reviewed, requiredReviewChecks)) {
    failure(
      phase,
      "independent-review",
      "independent review must exactly approve this source/candidate and every required fence",
      tracker,
    );
  }
}

function versionMessage(candidateSha256, commit) {
  return `takoform-schema-origin source=${commit} candidate=${candidateSha256}`;
}

function deploymentMessage(candidateSha256, commit) {
  return `takoform-schema-origin-100 source=${commit} candidate=${candidateSha256}`;
}

function validateVersion(version, versionId, message) {
  if (version === null || typeof version !== "object" || Array.isArray(version) || version.id !== versionId || !UUID.test(version.id ?? "")) throw new Error("staged version id is absent or ambiguous");
  if (version.metadata?.source !== "wrangler" || version.annotations?.["workers/message"] !== message) throw new Error("staged version lacks the exact pinned Wrangler message");
  if (version.resources === null || typeof version.resources !== "object" || typeof version.resources.script?.etag !== "string" || version.resources.script.etag === "") throw new Error("staged version resource readback is incomplete");
  return version;
}

function validateDeployment(deployment, deploymentId, versionId, message) {
  if (deployment === null || typeof deployment !== "object" || Array.isArray(deployment) || deployment.id !== deploymentId || !UUID.test(deployment.id ?? "") || deployment.strategy !== "percentage" || deployment.annotations?.["workers/message"] !== message || !Array.isArray(deployment.versions) || deployment.versions.length !== 1 || deployment.versions[0]?.version_id !== versionId || deployment.versions[0]?.percentage !== 100) {
    throw new Error("deployment is not the exact staged version at 100 percent");
  }
  return deployment;
}

function assertUploadedState(phase, state, version, tracker) {
  if (!exactKeys(state, ["deployments", "exists", "versions"]) || state.exists !== true || state.versions.length !== 1 || state.deployments.length !== 0 || state.versions[0]?.id !== version.id) {
    failure(phase, "staged-version-readback", "uploaded Worker version state is duplicate, partial, or ambiguous", tracker);
  }
}

function validateStagedWorkerState(state, version, deployment) {
  if (!exactKeys(state, ["deployments", "exists", "versions"]) || state.exists !== true || state.versions.length !== 1 || state.deployments.length !== 1 || state.versions[0]?.id !== version.id) {
    throw new Error("staged Worker version state is duplicate, missing, or ambiguous");
  }
  const ids = new Set(state.deployments.map((entry) => entry?.id));
  if (ids.size !== state.deployments.length || state.deployments[0]?.id !== deployment.id) {
    throw new Error("latest deployment is not the exact staged deployment");
  }
  validateDeployment(state.deployments[0], deployment.id, version.id, deployment.annotations["workers/message"]);
  return state;
}

function assertStagedState(phase, state, version, deployment, tracker, stage = "staged-deployment-readback") {
  try {
    return validateStagedWorkerState(state, version, deployment);
  } catch (error) {
    failure(phase, stage, error.message, tracker);
  }
}

function validateStageRecord(stage, candidate, candidateSha256) {
  if (!exactKeys(stage, ["candidateSha256", "deployment", "deploymentId", "deploymentMessage", "kind", "routeState", "sourceCommit", "target", "version", "versionId", "versionMessage"]) ||
      stage.kind !== STAGE_KIND ||
      stage.candidateSha256 !== candidateSha256 ||
      stage.sourceCommit !== candidate.source.commit ||
      !same(stage.target, candidate.target) ||
      stage.routeState !== "absent" ||
      !UUID.test(stage.versionId ?? "") ||
      !UUID.test(stage.deploymentId ?? "") ||
      stage.versionMessage !== versionMessage(candidateSha256, candidate.source.commit) ||
      stage.deploymentMessage !== deploymentMessage(candidateSha256, candidate.source.commit)) {
    throw new Error("stage record does not bind the exact candidate, version, deployment, and absent route");
  }
  validateVersion(stage.version, stage.versionId, stage.versionMessage);
  validateDeployment(stage.deployment, stage.deploymentId, stage.versionId, stage.deploymentMessage);
  return stage;
}

function validateTombstoneRecord(record, options, candidate) {
  if (!exactKeys(record, ["canonicalMainCommit", "checks", "disabledAt", "kind", "predecessorRepository", "readBackAt", "reviewer", "successorCommit", "successorRepository", "tombstoneCommit", "writerState"]) ||
      record.kind !== TOMBSTONE_KIND ||
      record.predecessorRepository !== SCHEMA_ORIGIN.predecessorRepository ||
      record.tombstoneCommit !== options.predecessorTombstoneCommit ||
      record.canonicalMainCommit !== options.predecessorTombstoneCommit ||
      record.successorRepository !== SCHEMA_ORIGIN.repository ||
      record.successorCommit !== candidate.source.commit ||
      record.writerState !== "disabled" ||
      !canonicalInstant(record.disabledAt) ||
      !canonicalInstant(record.readBackAt) ||
      Date.parse(record.disabledAt) >= Date.parse(record.readBackAt) ||
      typeof record.reviewer !== "string" ||
      record.reviewer.trim() === "" ||
      !same(record.checks, requiredTombstoneChecks)) {
    throw new Error("predecessor tombstone readback does not prove exact canonical disablement strictly before cutover");
  }
  return record;
}

function cutoverClosure({
  candidate,
  candidateSha256,
  stageRecordSha256,
  predecessorReadbackSha256,
  route,
  publicReadback,
  customDomains,
  version,
  deployment,
  workerState,
}) {
  const schemaClosure = {
    activeCount: candidate.schemas.active.length,
    activeBytes: candidate.schemas.active.reduce(
      (total, entry) => total + entry.bytes,
      0,
    ),
    activeInventorySha256: sha256(canonicalJSON(candidate.schemas.active)),
    activeReadbackSha256: publicReadback.activeSha256,
    retiredCount: candidate.schemas.retired.length,
    retiredInventorySha256: sha256(canonicalJSON(candidate.schemas.retired)),
    retiredReadbackSha256: publicReadback.retiredSha256,
    unknown: publicReadback.unknown,
    sentinel: publicReadback.sentinel,
  };
  return {
    activeInventorySha256: schemaClosure.activeInventorySha256,
    candidateSha256,
    configSha256: candidate.artifacts.config.sha256,
    customDomainsSha256: sha256(canonicalJSON(customDomains)),
    deploymentSha256: sha256(canonicalJSON(deployment)),
    dryRunBundleSha256: candidate.artifacts.dryRunBundle.sha256,
    ledgerSha256: candidate.artifacts.ledger.sha256,
    predecessorReadbackSha256,
    projectionSha256: candidate.artifacts.projection.sha256,
    publicReadbackSha256: sha256(canonicalJSON(publicReadback)),
    retiredInventorySha256: schemaClosure.retiredInventorySha256,
    routeSha256: sha256(canonicalJSON(route)),
    schemaClosureSha256: sha256(canonicalJSON(schemaClosure)),
    stageRecordSha256,
    versionSha256: sha256(canonicalJSON(version)),
    workerStateSha256: sha256(canonicalJSON(workerState)),
  };
}

function schemaReadbackClosure(candidate, publicReadback) {
  return {
    activeCount: candidate.schemas.active.length,
    activeBytes: candidate.schemas.active.reduce(
      (total, entry) => total + entry.bytes,
      0,
    ),
    activeInventorySha256: sha256(canonicalJSON(candidate.schemas.active)),
    activeReadbackSha256: publicReadback.activeSha256,
    retiredCount: candidate.schemas.retired.length,
    retiredInventorySha256: sha256(canonicalJSON(candidate.schemas.retired)),
    retiredReadbackSha256: publicReadback.retiredSha256,
    unknown: publicReadback.unknown,
    sentinel: publicReadback.sentinel,
  };
}

function validateCutoverRecord(
  record,
  candidate,
  candidateSha256,
  stageRecord,
  stageRecordSha256,
  tombstone,
  predecessorReadbackSha256,
) {
  const expectedKeys = [
    "authorityState",
    "candidateSha256",
    "closure",
    "completedReadbackAt",
    "customDomains",
    "deployment",
    "deploymentId",
    "kind",
    "predecessorReadbackSha256",
    "predecessorTombstoneCommit",
    "public",
    "route",
    "schemaClosure",
    "sourceCommit",
    "specificationWriterActivated",
    "stageRecordSha256",
    "target",
    "version",
    "versionId",
    "workerState",
  ];
  if (
    !exactKeys(record, expectedKeys) ||
    record.kind !== CUTOVER_KIND ||
    record.candidateSha256 !== candidateSha256 ||
    record.stageRecordSha256 !== stageRecordSha256 ||
    record.predecessorReadbackSha256 !== predecessorReadbackSha256 ||
    record.predecessorTombstoneCommit !== tombstone.tombstoneCommit ||
    record.sourceCommit !== candidate.source.commit ||
    !same(record.target, candidate.target) ||
    record.versionId !== stageRecord.versionId ||
    record.deploymentId !== stageRecord.deploymentId ||
    record.authorityState !== "prepared-writer-disabled" ||
    record.specificationWriterActivated !== false ||
    !canonicalInstant(record.completedReadbackAt) ||
    Date.parse(record.completedReadbackAt) <= Date.parse(tombstone.readBackAt)
  ) {
    throw new Error(
      "cutover record does not bind the exact prepared source, records, staged deployment, and completed readback instant",
    );
  }
  const route = normalizeRoute(record.route);
  if (
    route.pattern !== SCHEMA_ORIGIN.routePattern ||
    route.script !== SCHEMA_ORIGIN.worker
  ) {
    throw new Error("cutover record does not contain the exact sole schema route");
  }
  if (!same(record.public, candidate.preflight.public)) {
    throw new Error("cutover record public closure differs from the candidate");
  }
  const expectedSchemaClosure = schemaReadbackClosure(candidate, record.public);
  if (!same(record.schemaClosure, expectedSchemaClosure)) {
    throw new Error("cutover record schema counts, bytes, or readbacks are not exact");
  }
  const domains = normalizeCustomDomains(record.customDomains, candidate.target);
  if (
    !same(domains, candidate.preflight.customDomains) ||
    !same(domains, record.customDomains)
  ) {
    throw new Error("cutover record custom-domain closure is not exact");
  }
  validateVersion(record.version, stageRecord.versionId, stageRecord.versionMessage);
  validateDeployment(
    record.deployment,
    stageRecord.deploymentId,
    stageRecord.versionId,
    stageRecord.deploymentMessage,
  );
  if (
    !same(record.version, stageRecord.version) ||
    !same(record.deployment, stageRecord.deployment)
  ) {
    throw new Error("cutover record version or deployment changed from staging");
  }
  validateStagedWorkerState(
    record.workerState,
    record.version,
    record.deployment,
  );
  const expectedClosure = cutoverClosure({
    candidate,
    candidateSha256,
    stageRecordSha256,
    predecessorReadbackSha256,
    route,
    publicReadback: record.public,
    customDomains: domains,
    version: record.version,
    deployment: record.deployment,
    workerState: record.workerState,
  });
  if (!same(record.closure, expectedClosure)) {
    throw new Error("cutover record digest closure is incomplete or changed");
  }
  return record;
}

async function canonicalOperationInstant(
  phase,
  stage,
  operations,
  tracker,
  callback,
) {
  const value = await readOperation(phase, stage, tracker, callback);
  if (!canonicalInstant(value)) {
    failure(phase, stage, "operation clock did not return a canonical UTC instant", tracker);
  }
  return value;
}

export async function prepareSchemaOrigin(options, operations, env = process.env) {
  const phase = "prepare";
  const tracker = phaseTracker(operations);
  verifyOperationToolClosure(phase, operations, tracker);
  let local;
  try {
    local = validateLocalEvidence(
      await readOperation(phase, "local-closure", tracker, () => operations.inspectLocalState(options.expectedCommit)),
      options.expectedCommit,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "local-closure", error.message, tracker);
  }
  const target = targetFromOptions(options);
  try {
    validateTarget(target);
    validateSentinelUrl(options.sentinelUrl);
  } catch (error) {
    failure(phase, "target", error.message, tracker);
  }
  const candidateLike = {
    schemas: {
      active: local.projection.entries,
      retired: local.retired,
      unknownUrl: SCHEMA_ORIGIN.unknownSchemaUrl,
    },
    sentinelUrl: options.sentinelUrl,
  };
  const publicReadback = await readPublicClosure(phase, candidateLike, operations, tracker);
  const token = requireToken(phase, "control-plane-capability", env, tracker);
  const routes = assertRoutesAbsent(
    phase,
    "control-plane-route",
    await readOperation(phase, "control-plane-route", tracker, () => operations.readRoutes(target, token)),
    tracker,
  );
  const domains = assertCustomDomains(
    phase,
    "control-plane-custom-domains",
    await readOperation(phase, "control-plane-custom-domains", tracker, () => operations.readCustomDomains(target, token)),
    target,
    tracker,
  );
  const worker = assertWorkerAbsent(
    phase,
    "control-plane-worker",
    await readOperation(phase, "control-plane-worker", tracker, () => operations.readWorkerState(target, token)),
    tracker,
  );
  const candidate = candidateFrom(local, target, options.sentinelUrl, publicReadback, domains);
  candidate.preflight.routes = routes;
  candidate.preflight.worker = worker;
  try {
    validateCandidateRecord(candidate);
  } catch (error) {
    failure(phase, "candidate-closure", error.message, tracker);
  }
  const bytes = canonicalJSON(candidate);
  await readOperation(phase, "candidate-write", tracker, () => operations.writeRecord(options.output, bytes));
  return {
    status: "prepared",
    phase,
    sourceCommit: candidate.source.commit,
    candidateSha256: sha256(bytes),
    output: options.output,
  };
}

export async function stageSchemaOrigin(options, operations, env = process.env) {
  const phase = "stage";
  const tracker = phaseTracker(operations);
  verifyOperationToolClosure(phase, operations, tracker);
  const loadedCandidate = await loadCanonicalRecord(phase, "candidate-read", options.candidate, operations, tracker);
  let candidate;
  try {
    candidate = validateCandidateRecord(loadedCandidate.value);
  } catch (error) {
    failure(phase, "candidate-closure", error.message, tracker);
  }
  if (candidate.source.commit !== options.expectedCommit) failure(phase, "candidate-source", "--expected-commit differs from candidate", tracker);
  let local;
  try {
    local = validateLocalEvidence(
      await readOperation(phase, "local-closure", tracker, () => operations.inspectLocalState(options.expectedCommit)),
      options.expectedCommit,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "local-closure", error.message, tracker);
  }
  assertCandidateMatchesLocal(phase, candidate, local, tracker);
  const loadedReview = await loadCanonicalRecord(phase, "independent-review", options.reviewRecord, operations, tracker);
  validateReviewRecord(phase, loadedReview.value, candidate, loadedCandidate.sha256, tracker);
  const token = requireToken(phase, "mutation-capability", env, tracker);
  const publicReadback = await readPublicClosure(phase, candidate, operations, tracker);
  assertPublicMatchesCandidate(phase, publicReadback, candidate, tracker);
  assertRoutesAbsent(phase, "pre-stage-route", await readOperation(phase, "pre-stage-route", tracker, () => operations.readRoutes(candidate.target, token)), tracker);
  assertCustomDomains(phase, "pre-stage-custom-domains", await readOperation(phase, "pre-stage-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token)), candidate.target, tracker, candidate.preflight.customDomains);
  assertWorkerAbsent(phase, "pre-stage-worker", await readOperation(phase, "pre-stage-worker", tracker, () => operations.readWorkerState(candidate.target, token)), tracker);

  const uploadMessage = versionMessage(loadedCandidate.sha256, candidate.source.commit);
  const uploadOutput = await mutationOperation(phase, "version-upload", tracker, () => operations.uploadVersion(candidate.target, {
    candidateSha256: loadedCandidate.sha256,
    sourceCommit: candidate.source.commit,
    message: uploadMessage,
    token,
  }));
  if (!exactKeys(uploadOutput, ["type", "version", "version_id", "worker_name"]) || uploadOutput.type !== "version-upload" || uploadOutput.version !== 1 || uploadOutput.worker_name !== SCHEMA_ORIGIN.worker || !UUID.test(uploadOutput.version_id ?? "")) {
    failure(phase, "version-upload-output", "pinned Wrangler returned an ambiguous version-upload record", tracker);
  }
  const versionId = uploadOutput.version_id;
  let version;
  try {
    version = validateVersion(
      await readOperation(phase, "staged-version-readback", tracker, () => operations.readVersion(candidate.target, versionId, token), { indeterminateAfterMutation: true }),
      versionId,
      uploadMessage,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "staged-version-readback", error.message, tracker);
  }
  assertUploadedState(phase, await readOperation(phase, "staged-version-readback", tracker, () => operations.readWorkerState(candidate.target, token), { indeterminateAfterMutation: true }), version, tracker);
  assertRoutesAbsent(phase, "stage-upload-route-absence", await readOperation(phase, "stage-upload-route-absence", tracker, () => operations.readRoutes(candidate.target, token), { indeterminateAfterMutation: true }), tracker);
  assertCustomDomains(phase, "stage-upload-custom-domains", await readOperation(phase, "stage-upload-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token), { indeterminateAfterMutation: true }), candidate.target, tracker, candidate.preflight.customDomains);

  const deployMessage = deploymentMessage(loadedCandidate.sha256, candidate.source.commit);
  const deployOutput = await mutationOperation(phase, "version-deploy", tracker, () => operations.deployVersion(candidate.target, {
    versionId,
    candidateSha256: loadedCandidate.sha256,
    sourceCommit: candidate.source.commit,
    message: deployMessage,
    token,
  }));
  if (!exactKeys(deployOutput, ["deployment_id", "type", "version", "version_traffic", "worker_name"]) || deployOutput.type !== "version-deploy" || deployOutput.version !== 1 || deployOutput.worker_name !== SCHEMA_ORIGIN.worker || !UUID.test(deployOutput.deployment_id ?? "") || deployOutput.version_traffic?.[versionId] !== 100 || Object.keys(deployOutput.version_traffic ?? {}).length !== 1) {
    failure(phase, "version-deploy-output", "pinned Wrangler returned an ambiguous version-deploy record", tracker);
  }
  const deploymentId = deployOutput.deployment_id;
  let deployment;
  try {
    deployment = validateDeployment(
      await readOperation(phase, "staged-deployment-readback", tracker, () => operations.readDeployment(candidate.target, deploymentId, token), { indeterminateAfterMutation: true }),
      deploymentId,
      versionId,
      deployMessage,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "staged-deployment-readback", error.message, tracker);
  }
  const stagedState = await readOperation(phase, "staged-deployment-readback", tracker, () => operations.readWorkerState(candidate.target, token), { indeterminateAfterMutation: true });
  assertStagedState(phase, stagedState, version, deployment, tracker);
  assertRoutesAbsent(phase, "stage-route-absence", await readOperation(phase, "stage-route-absence", tracker, () => operations.readRoutes(candidate.target, token), { indeterminateAfterMutation: true }), tracker);
  assertCustomDomains(phase, "stage-custom-domains", await readOperation(phase, "stage-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token), { indeterminateAfterMutation: true }), candidate.target, tracker, candidate.preflight.customDomains);

  const stageRecord = {
    kind: STAGE_KIND,
    candidateSha256: loadedCandidate.sha256,
    sourceCommit: candidate.source.commit,
    target: candidate.target,
    versionId,
    deploymentId,
    versionMessage: uploadMessage,
    deploymentMessage: deployMessage,
    version,
    deployment,
    routeState: "absent",
  };
  try {
    validateStageRecord(stageRecord, candidate, loadedCandidate.sha256);
  } catch (error) {
    failure(phase, "stage-record-closure", error.message, tracker);
  }
  await readOperation(phase, "stage-record-write", tracker, () => operations.writeRecord(options.output, canonicalJSON(stageRecord)));
  return {
    status: "staged-route-absent",
    phase,
    sourceCommit: candidate.source.commit,
    candidateSha256: loadedCandidate.sha256,
    versionId,
    deploymentId,
    routeState: "absent",
    output: options.output,
  };
}

export async function cutoverSchemaOrigin(options, operations, env = process.env) {
  const phase = "cutover";
  const tracker = phaseTracker(operations);
  verifyOperationToolClosure(phase, operations, tracker);
  const loadedCandidate = await loadCanonicalRecord(phase, "candidate-read", options.candidate, operations, tracker);
  let candidate;
  try {
    candidate = validateCandidateRecord(loadedCandidate.value);
  } catch (error) {
    failure(phase, "candidate-closure", error.message, tracker);
  }
  if (candidate.source.commit !== options.expectedCommit) failure(phase, "candidate-source", "--expected-commit differs from candidate", tracker);
  const loadedStage = await loadCanonicalRecord(phase, "stage-record-read", options.stageRecord, operations, tracker);
  let stageRecord;
  try {
    stageRecord = validateStageRecord(loadedStage.value, candidate, loadedCandidate.sha256);
  } catch (error) {
    failure(phase, "stage-record-closure", error.message, tracker);
  }
  let local;
  try {
    local = validateLocalEvidence(
      await readOperation(phase, "local-closure", tracker, () => operations.inspectLocalState(options.expectedCommit)),
      options.expectedCommit,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "authority-state", error.message, tracker);
  }
  assertCandidateMatchesLocal(phase, candidate, local, tracker);
  const loadedTombstone = await loadCanonicalRecord(phase, "predecessor-tombstone-readback", options.predecessorReadback, operations, tracker);
  let tombstone;
  try {
    tombstone = validateTombstoneRecord(loadedTombstone.value, options, candidate);
  } catch (error) {
    failure(phase, "predecessor-tombstone-readback", error.message, tracker);
  }
  const remoteTombstone = await readOperation(phase, "predecessor-canonical-main", tracker, () => operations.readPredecessorMain(options.predecessorTombstoneCommit));
  if (remoteTombstone !== options.predecessorTombstoneCommit) failure(phase, "predecessor-canonical-main", "canonical predecessor main is not the exact supplied tombstone", tracker);
  const token = requireToken(phase, "mutation-capability", env, tracker);
  const publicReadback = await readPublicClosure(phase, candidate, operations, tracker);
  assertPublicMatchesCandidate(phase, publicReadback, candidate, tracker);
  assertRoutesAbsent(phase, "pre-cutover-route", await readOperation(phase, "pre-cutover-route", tracker, () => operations.readRoutes(candidate.target, token)), tracker);
  assertCustomDomains(phase, "pre-cutover-custom-domains", await readOperation(phase, "pre-cutover-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token)), candidate.target, tracker, candidate.preflight.customDomains);
  const version = await readOperation(phase, "pre-cutover-version", tracker, () => operations.readVersion(candidate.target, stageRecord.versionId, token));
  const deployment = await readOperation(phase, "pre-cutover-deployment", tracker, () => operations.readDeployment(candidate.target, stageRecord.deploymentId, token));
  try {
    validateVersion(version, stageRecord.versionId, stageRecord.versionMessage);
    validateDeployment(deployment, stageRecord.deploymentId, stageRecord.versionId, stageRecord.deploymentMessage);
  } catch (error) {
    failure(phase, "pre-cutover-staged-state", error.message, tracker);
  }
  assertStagedState(phase, await readOperation(phase, "pre-cutover-staged-state", tracker, () => operations.readWorkerState(candidate.target, token)), version, deployment, tracker, "pre-cutover-staged-state");

  let justInTimeLocal;
  try {
    justInTimeLocal = validateLocalEvidence(
      await readOperation(phase, "just-in-time-authority", tracker, () => operations.inspectLocalState(options.expectedCommit)),
      options.expectedCommit,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "just-in-time-authority", error.message, tracker);
  }
  assertCandidateMatchesLocal(phase, candidate, justInTimeLocal, tracker);
  const justInTimeTombstone = await readOperation(phase, "just-in-time-predecessor-main", tracker, () => operations.readPredecessorMain(options.predecessorTombstoneCommit));
  if (justInTimeTombstone !== options.predecessorTombstoneCommit) failure(phase, "just-in-time-predecessor-main", "predecessor canonical main changed before the route mutation", tracker);
  assertRoutesAbsent(phase, "just-in-time-route", await readOperation(phase, "just-in-time-route", tracker, () => operations.readRoutes(candidate.target, token)), tracker);
  assertCustomDomains(phase, "just-in-time-custom-domains", await readOperation(phase, "just-in-time-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token)), candidate.target, tracker, candidate.preflight.customDomains);
  const justInTimeDeployment = await readOperation(phase, "just-in-time-deployment", tracker, () => operations.readDeployment(candidate.target, stageRecord.deploymentId, token));
  try {
    validateDeployment(justInTimeDeployment, stageRecord.deploymentId, stageRecord.versionId, stageRecord.deploymentMessage);
  } catch (error) {
    failure(phase, "just-in-time-deployment", error.message, tracker);
  }

  await mutationOperation(phase, "route-trigger-deploy", tracker, () => operations.deployTriggers(candidate.target, {
    candidateSha256: loadedCandidate.sha256,
    sourceCommit: candidate.source.commit,
    versionId: stageRecord.versionId,
    deploymentId: stageRecord.deploymentId,
    token,
  }));
  const route = assertExactRoute(phase, "control-plane-route", await readOperation(phase, "control-plane-route", tracker, () => operations.readRoutes(candidate.target, token), { indeterminateAfterMutation: true }), tracker);
  const postCustomDomains = assertCustomDomains(phase, "control-plane-custom-domains", await readOperation(phase, "control-plane-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token), { indeterminateAfterMutation: true }), candidate.target, tracker, candidate.preflight.customDomains);
  const postPublic = await readPublicClosure(phase, candidate, operations, tracker);
  assertPublicMatchesCandidate(phase, postPublic, candidate, tracker);
  const postVersion = await readOperation(phase, "post-cutover-version", tracker, () => operations.readVersion(candidate.target, stageRecord.versionId, token), { indeterminateAfterMutation: true });
  const postDeployment = await readOperation(phase, "post-cutover-deployment", tracker, () => operations.readDeployment(candidate.target, stageRecord.deploymentId, token), { indeterminateAfterMutation: true });
  try {
    validateVersion(postVersion, stageRecord.versionId, stageRecord.versionMessage);
    validateDeployment(postDeployment, stageRecord.deploymentId, stageRecord.versionId, stageRecord.deploymentMessage);
  } catch (error) {
    failure(phase, "post-cutover-staged-state", error.message, tracker);
  }
  const postWorkerState = await readOperation(
    phase,
    "post-cutover-staged-state",
    tracker,
    () => operations.readWorkerState(candidate.target, token),
    { indeterminateAfterMutation: true },
  );
  assertStagedState(
    phase,
    postWorkerState,
    postVersion,
    postDeployment,
    tracker,
    "post-cutover-staged-state",
  );
  let postCutoverLocal;
  try {
    postCutoverLocal = validateLocalEvidence(
      await readOperation(phase, "post-cutover-authority", tracker, () => operations.inspectLocalState(options.expectedCommit), { indeterminateAfterMutation: true }),
      options.expectedCommit,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "post-cutover-authority", error.message, tracker);
  }
  assertCandidateMatchesLocal(phase, candidate, postCutoverLocal, tracker);
  const completedReadbackAt = await canonicalOperationInstant(
    phase,
    "completed-readback-instant",
    operations,
    tracker,
    () => operations.now(),
  );
  if (Date.parse(completedReadbackAt) <= Date.parse(tombstone.readBackAt)) {
    failure(
      phase,
      "completed-readback-instant",
      "cutover completed readback must be strictly after predecessor tombstone readback",
      tracker,
    );
  }
  const closure = cutoverClosure({
    candidate,
    candidateSha256: loadedCandidate.sha256,
    stageRecordSha256: loadedStage.sha256,
    predecessorReadbackSha256: loadedTombstone.sha256,
    route,
    publicReadback: postPublic,
    customDomains: postCustomDomains,
    version: postVersion,
    deployment: postDeployment,
    workerState: postWorkerState,
  });
  const schemaClosure = schemaReadbackClosure(candidate, postPublic);
  const cutoverRecord = {
    kind: CUTOVER_KIND,
    candidateSha256: loadedCandidate.sha256,
    stageRecordSha256: loadedStage.sha256,
    predecessorReadbackSha256: loadedTombstone.sha256,
    predecessorTombstoneCommit: tombstone.tombstoneCommit,
    sourceCommit: candidate.source.commit,
    target: candidate.target,
    versionId: stageRecord.versionId,
    deploymentId: stageRecord.deploymentId,
    route,
    public: postPublic,
    schemaClosure,
    customDomains: postCustomDomains,
    version: postVersion,
    deployment: postDeployment,
    workerState: postWorkerState,
    completedReadbackAt,
    closure,
    authorityState: "prepared-writer-disabled",
    specificationWriterActivated: false,
  };
  try {
    validateCutoverRecord(
      cutoverRecord,
      candidate,
      loadedCandidate.sha256,
      stageRecord,
      loadedStage.sha256,
      tombstone,
      loadedTombstone.sha256,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "cutover-record-closure", error.message, tracker);
  }
  await readOperation(phase, "cutover-record-write", tracker, () => operations.writeRecord(options.output, canonicalJSON(cutoverRecord)));
  return {
    status: "cutover-verified-writer-still-disabled",
    phase,
    route,
    versionId: stageRecord.versionId,
    deploymentId: stageRecord.deploymentId,
    completedReadbackAt,
    closure,
    specificationWriterActivated: false,
    output: options.output,
  };
}

export async function prepareSchemaOriginAuthorityActivation(
  options,
  operations,
  env = process.env,
) {
  const phase = "prepare-activation";
  const tracker = phaseTracker(operations);
  verifyOperationToolClosure(phase, operations, tracker);
  const loadedCandidate = await loadCanonicalRecord(
    phase,
    "candidate-read",
    options.candidate,
    operations,
    tracker,
  );
  const loadedStage = await loadCanonicalRecord(
    phase,
    "stage-record-read",
    options.stageRecord,
    operations,
    tracker,
  );
  const loadedCutover = await loadCanonicalRecord(
    phase,
    "cutover-record-read",
    options.cutoverRecord,
    operations,
    tracker,
  );
  if (loadedCutover.sha256 !== options.cutoverRecordSha256) {
    failure(
      phase,
      "cutover-record-digest",
      "cutover record bytes do not match the explicit expected digest",
      tracker,
    );
  }
  const loadedTombstone = await loadCanonicalRecord(
    phase,
    "predecessor-tombstone-readback",
    options.predecessorReadback,
    operations,
    tracker,
  );
  let candidate;
  let stageRecord;
  let tombstone;
  try {
    candidate = validateCandidateRecord(loadedCandidate.value);
    if (candidate.source.commit !== options.expectedCommit) {
      throw new Error("--expected-commit differs from candidate source P");
    }
    stageRecord = validateStageRecord(
      loadedStage.value,
      candidate,
      loadedCandidate.sha256,
    );
    tombstone = validateTombstoneRecord(
      loadedTombstone.value,
      options,
      candidate,
    );
  } catch (error) {
    failure(phase, "input-record-closure", error.message, tracker);
  }

  // This prepared-state authority read is deliberately before token access or
  // any control-plane callback. An active or malformed authority must fail
  // without acquiring production credentials or invoking a signer.
  let local;
  try {
    local = validateLocalEvidence(
      await readOperation(phase, "prepared-authority", tracker, () =>
        operations.inspectLocalState(options.expectedCommit),
      ),
      options.expectedCommit,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "prepared-authority", error.message, tracker);
  }
  assertCandidateMatchesLocal(phase, candidate, local, tracker);

  let cutoverRecord;
  try {
    cutoverRecord = validateCutoverRecord(
      loadedCutover.value,
      candidate,
      loadedCandidate.sha256,
      stageRecord,
      loadedStage.sha256,
      tombstone,
      loadedTombstone.sha256,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "cutover-record-closure", error.message, tracker);
  }
  const predecessorMain = await readOperation(
    phase,
    "predecessor-canonical-main",
    tracker,
    () => operations.readPredecessorMain(options.predecessorTombstoneCommit),
  );
  if (predecessorMain !== options.predecessorTombstoneCommit) {
    failure(
      phase,
      "predecessor-canonical-main",
      "canonical predecessor main is not the exact supplied tombstone T",
      tracker,
    );
  }

  const token = requireToken(phase, "control-plane-capability", env, tracker);
  const freshPublic = await readPublicClosure(
    phase,
    candidate,
    operations,
    tracker,
  );
  assertPublicMatchesCandidate(phase, freshPublic, candidate, tracker);
  const freshRoute = assertExactRoute(
    phase,
    "fresh-sole-route",
    await readOperation(phase, "fresh-sole-route", tracker, () =>
      operations.readRoutes(candidate.target, token),
    ),
    tracker,
    cutoverRecord.route.id,
  );
  const freshDomains = assertCustomDomains(
    phase,
    "fresh-custom-domains",
    await readOperation(phase, "fresh-custom-domains", tracker, () =>
      operations.readCustomDomains(candidate.target, token),
    ),
    candidate.target,
    tracker,
    candidate.preflight.customDomains,
  );
  const freshVersion = await readOperation(
    phase,
    "fresh-version",
    tracker,
    () => operations.readVersion(candidate.target, stageRecord.versionId, token),
  );
  const freshDeployment = await readOperation(
    phase,
    "fresh-deployment",
    tracker,
    () =>
      operations.readDeployment(
        candidate.target,
        stageRecord.deploymentId,
        token,
      ),
  );
  try {
    validateVersion(
      freshVersion,
      stageRecord.versionId,
      stageRecord.versionMessage,
    );
    validateDeployment(
      freshDeployment,
      stageRecord.deploymentId,
      stageRecord.versionId,
      stageRecord.deploymentMessage,
    );
    if (
      !same(freshVersion, stageRecord.version) ||
      !same(freshDeployment, stageRecord.deployment)
    ) {
      throw new Error("fresh version or deployment differs from the exact stage record");
    }
  } catch (error) {
    failure(phase, "fresh-staged-state", error.message, tracker);
  }
  const freshWorkerState = await readOperation(
    phase,
    "fresh-staged-state",
    tracker,
    () => operations.readWorkerState(candidate.target, token),
  );
  assertStagedState(
    phase,
    freshWorkerState,
    freshVersion,
    freshDeployment,
    tracker,
    "fresh-staged-state",
  );
  const freshClosure = cutoverClosure({
    candidate,
    candidateSha256: loadedCandidate.sha256,
    stageRecordSha256: loadedStage.sha256,
    predecessorReadbackSha256: loadedTombstone.sha256,
    route: freshRoute,
    publicReadback: freshPublic,
    customDomains: freshDomains,
    version: freshVersion,
    deployment: freshDeployment,
    workerState: freshWorkerState,
  });
  if (!same(freshClosure, cutoverRecord.closure)) {
    failure(
      phase,
      "fresh-cutover-closure",
      "fresh route, public, domain, version, deployment, or Worker state differs from the exact cutover closure",
      tracker,
    );
  }
  const freshReadbackAt = await canonicalOperationInstant(
    phase,
    "fresh-readback-instant",
    operations,
    tracker,
    () => operations.now(),
  );
  if (
    Date.parse(freshReadbackAt) <=
    Date.parse(cutoverRecord.completedReadbackAt)
  ) {
    failure(
      phase,
      "fresh-readback-instant",
      "authority activation readback must be strictly after the completed cutover readback",
      tracker,
    );
  }
  const successorWriterEnabledAt = await canonicalOperationInstant(
    phase,
    "successor-writer-enabled-instant",
    operations,
    tracker,
    () => operations.activationInstantAfter(freshReadbackAt),
  );
  if (
    Date.parse(successorWriterEnabledAt) <= Date.parse(freshReadbackAt) ||
    Date.parse(successorWriterEnabledAt) <= Date.parse(tombstone.disabledAt)
  ) {
    failure(
      phase,
      "successor-writer-enabled-instant",
      "successorWriterEnabledAt must be strictly after the fresh activation readback and predecessor disablement",
      tracker,
    );
  }

  const schemaRouteCutover = {
    format: "takoform.schema-origin-authority-cutover@v1",
    sourceCommit: candidate.source.commit,
    predecessorTombstoneCommit: tombstone.tombstoneCommit,
    candidateSha256: loadedCandidate.sha256,
    stageRecordSha256: loadedStage.sha256,
    cutoverRecordSha256: loadedCutover.sha256,
    predecessorReadbackSha256: loadedTombstone.sha256,
    routeId: freshRoute.id,
    routePattern: freshRoute.pattern,
    worker: freshRoute.script,
    versionId: stageRecord.versionId,
    deploymentId: stageRecord.deploymentId,
    completedReadbackAt: cutoverRecord.completedReadbackAt,
    freshReadbackAt,
  };
  schemaRouteCutover.closureSha256 =
    schemaRouteCutoverClosureSha256(schemaRouteCutover);
  const authority = {
    ...structuredClone(local.authority.document),
    state: "successor-active",
    predecessorTombstoneCommit: tombstone.tombstoneCommit,
    schemaRouteCutover,
    predecessorWriterDisabledAt: tombstone.disabledAt,
    successorWriterEnabledAt,
  };
  const authorityProblems = validateAuthorityTransfer(authority);
  if (authorityProblems.length !== 0) {
    failure(
      phase,
      "active-authority-closure",
      `active authority document is invalid (${authorityProblems.join("; ")})`,
      tracker,
    );
  }
  const authoritySha256 = sha256(canonicalJSON(authority));
  const activationClosure = {
    ...freshClosure,
    authoritySha256,
    cutoverRecordSha256: loadedCutover.sha256,
    schemaRouteCutoverSha256: sha256(canonicalJSON(schemaRouteCutover)),
  };
  const evidence = {
    kind: ACTIVATION_KIND,
    sourceCommit: candidate.source.commit,
    candidateSha256: loadedCandidate.sha256,
    stageRecordSha256: loadedStage.sha256,
    cutoverRecordSha256: loadedCutover.sha256,
    predecessorReadbackSha256: loadedTombstone.sha256,
    predecessorTombstoneCommit: tombstone.tombstoneCommit,
    predecessorCanonicalMainCommit: predecessorMain,
    schemaRouteCutover,
    target: candidate.target,
    route: freshRoute,
    versionId: stageRecord.versionId,
    deploymentId: stageRecord.deploymentId,
    public: freshPublic,
    schemaClosure: schemaReadbackClosure(candidate, freshPublic),
    customDomains: freshDomains,
    version: freshVersion,
    deployment: freshDeployment,
    workerState: freshWorkerState,
    freshReadbackAt,
    closure: activationClosure,
    authorityPath: SCHEMA_ORIGIN.authorityPath,
    authority,
    authoritySha256,
    activationChange: {
      parentCommit: candidate.source.commit,
      changedPaths: [SCHEMA_ORIGIN.authorityPath],
      stateTransition: "prepared-writer-disabled -> successor-active",
      externalMutation: false,
      apiV2Mutation: false,
      notBefore: successorWriterEnabledAt,
    },
  };
  await readOperation(phase, "activation-evidence-write", tracker, () =>
    operations.writeRecord(options.output, canonicalJSON(evidence)),
  );
  return {
    status: "authority-activation-evidence-prepared",
    phase,
    sourceCommit: candidate.source.commit,
    cutoverRecordSha256: loadedCutover.sha256,
    freshReadbackAt,
    authorityPath: SCHEMA_ORIGIN.authorityPath,
    authority,
    schemaRouteCutover,
    authoritySha256,
    authorityChangeOnly: true,
    externalMutation: false,
    apiV2Mutation: false,
    output: options.output,
  };
}

export async function verifySchemaOrigin(options, operations, env = process.env) {
  const phase = "verify";
  const tracker = phaseTracker(operations);
  verifyOperationToolClosure(phase, operations, tracker);
  const loadedCandidate = await loadCanonicalRecord(phase, "candidate-read", options.candidate, operations, tracker);
  let candidate;
  try {
    candidate = validateCandidateRecord(loadedCandidate.value);
  } catch (error) {
    failure(phase, "candidate-closure", error.message, tracker);
  }
  const publicReadback = await readPublicClosure(phase, candidate, operations, tracker);
  assertPublicMatchesCandidate(phase, publicReadback, candidate, tracker);
  const token = env?.CLOUDFLARE_API_TOKEN;
  if (typeof token !== "string" || token.trim() === "") {
    return {
      status: "verified-public-bytes",
      phase,
      candidateSha256: loadedCandidate.sha256,
      controlPlane: "not-requested",
      public: publicReadback,
    };
  }
  const route = assertExactRoute(phase, "control-plane-route", await readOperation(phase, "control-plane-route", tracker, () => operations.readRoutes(candidate.target, token)), tracker);
  assertCustomDomains(phase, "control-plane-custom-domains", await readOperation(phase, "control-plane-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token)), candidate.target, tracker, candidate.preflight.customDomains);
  return {
    status: "verified-public-and-control-plane",
    phase,
    candidateSha256: loadedCandidate.sha256,
    controlPlane: "verified",
    route,
    public: publicReadback,
  };
}

export async function revertSchemaOrigin(options, operations, env = process.env) {
  const phase = "revert";
  const tracker = phaseTracker(operations);
  verifyOperationToolClosure(phase, operations, tracker);
  if (options.script !== SCHEMA_ORIGIN.worker) {
    failure(phase, "exact-route-input", `revert script must be exactly ${SCHEMA_ORIGIN.worker}`, tracker);
  }
  const loadedCandidate = await loadCanonicalRecord(phase, "candidate-read", options.candidate, operations, tracker);
  let candidate;
  try {
    candidate = validateCandidateRecord(loadedCandidate.value);
  } catch (error) {
    failure(phase, "candidate-closure", error.message, tracker);
  }
  if (candidate.source.commit !== options.expectedCommit) failure(phase, "candidate-source", "--expected-commit differs from candidate", tracker);
  const rawLocal = await readOperation(phase, "authority-state", tracker, () => operations.inspectLocalState(options.expectedCommit));
  const observedState = rawLocal?.authority?.document?.state;
  if (observedState === "successor-active") {
    failure(phase, "authority-state", "successor authority is active; revert is forbidden and recovery requires forward repair", tracker);
  }
  let local;
  try {
    local = validateLocalEvidence(rawLocal, options.expectedCommit);
  } catch (error) {
    failure(phase, "authority-state", error.message, tracker);
  }
  assertCandidateMatchesLocal(phase, candidate, local, tracker);
  const token = requireToken(phase, "mutation-capability", env, tracker);
  const prePublic = await readPublicClosure(phase, candidate, operations, tracker);
  assertPublicMatchesCandidate(phase, prePublic, candidate, tracker);
  assertCustomDomains(phase, "pre-revert-custom-domains", await readOperation(phase, "pre-revert-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token)), candidate.target, tracker, candidate.preflight.customDomains);
  const exactRoute = assertExactRoute(phase, "exact-route-readback", await readOperation(phase, "exact-route-readback", tracker, () => operations.readRoutes(candidate.target, token)), tracker, options.routeId);
  if (exactRoute.script !== options.script) failure(phase, "exact-route-readback", "route script differs from the explicit revert script", tracker);

  const justInTimeLocal = await readOperation(phase, "just-in-time-authority", tracker, () => operations.inspectLocalState(options.expectedCommit));
  if (justInTimeLocal?.authority?.document?.state === "successor-active") {
    failure(phase, "just-in-time-authority", "successor authority became active; revert is forbidden and recovery requires forward repair", tracker);
  }
  try {
    assertCandidateMatchesLocal(
      phase,
      candidate,
      validateLocalEvidence(justInTimeLocal, options.expectedCommit),
      tracker,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "just-in-time-authority", error.message, tracker);
  }
  const justInTimeRoute = assertExactRoute(phase, "just-in-time-route", await readOperation(phase, "just-in-time-route", tracker, () => operations.readRoutes(candidate.target, token)), tracker, options.routeId);
  if (justInTimeRoute.script !== options.script) failure(phase, "just-in-time-route", "route script changed before exact deletion", tracker);

  const deleted = await mutationOperation(phase, "exact-route-delete", tracker, () => operations.deleteRoute(candidate.target, options.routeId, token));
  if (deleted?.id !== options.routeId) failure(phase, "exact-route-delete-readback", "Cloudflare did not acknowledge only the exact route id", tracker);
  assertRoutesAbsent(phase, "post-revert-route-absence", await readOperation(phase, "post-revert-route-absence", tracker, () => operations.readRoutes(candidate.target, token), { indeterminateAfterMutation: true }), tracker);
  assertCustomDomains(phase, "post-revert-custom-domains", await readOperation(phase, "post-revert-custom-domains", tracker, () => operations.readCustomDomains(candidate.target, token), { indeterminateAfterMutation: true }), candidate.target, tracker, candidate.preflight.customDomains);
  const fallbackPublic = await readPublicClosure(phase, candidate, operations, tracker);
  assertPublicMatchesCandidate(phase, fallbackPublic, candidate, tracker);
  const postRevertLocal = await readOperation(phase, "post-revert-authority", tracker, () => operations.inspectLocalState(options.expectedCommit), { indeterminateAfterMutation: true });
  if (postRevertLocal?.authority?.document?.state === "successor-active") {
    failure(phase, "post-revert-authority", "successor authority became active during revert; route is absent and forward repair is now required", tracker);
  }
  try {
    assertCandidateMatchesLocal(
      phase,
      candidate,
      validateLocalEvidence(postRevertLocal, options.expectedCommit),
      tracker,
    );
  } catch (error) {
    if (error instanceof SchemaOriginFailure) throw error;
    failure(phase, "post-revert-authority", error.message, tracker);
  }
  const revertRecord = {
    kind: REVERT_KIND,
    candidateSha256: loadedCandidate.sha256,
    sourceCommit: candidate.source.commit,
    authorityState: "prepared-writer-disabled",
    deletedRoute: exactRoute,
    routeState: "absent",
    fallbackPublic,
    retained: ["worker", "version", "deployment", "assets", "custom-domains"],
  };
  await readOperation(phase, "revert-record-write", tracker, () => operations.writeRecord(options.output, canonicalJSON(revertRecord)));
  return {
    status: "reverted-to-predecessor-fallback",
    phase,
    routeState: "absent",
    deletedRoute: exactRoute,
    output: options.output,
  };
}

function gitOutput(repositoryRoot, args) {
  try {
    return execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed (${error.status ?? "unknown status"})`);
  }
}

function regularRepositoryFile(repositoryRoot, relativePath) {
  const absolute = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, absolute);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${relativePath} escapes the repository`);
  }
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(absolute) !== absolute) {
    throw new Error(`${relativePath} must be one ordinary in-repository file`);
  }
  return { absolute, bytes: readFileSync(absolute) };
}

function parseJSONDocument(raw, label) {
  try {
    return JSON.parse(Buffer.from(raw).toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is not JSON (${error.message})`);
  }
}

function gitBlob(repositoryRoot, commit, relativePath) {
  try {
    return execFileSync("git", ["cat-file", "blob", `${commit}:${relativePath}`], {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new Error(
      `P0 Git blob ${commit}:${relativePath} is unavailable (${error.status ?? "unknown status"})`,
    );
  }
}

function resolveP0ToolClosure(repositoryRoot) {
  const authorityFile = regularRepositoryFile(
    repositoryRoot,
    SCHEMA_ORIGIN.authorityPath,
  );
  const authority = parseJSONDocument(
    authorityFile.bytes,
    "Specification authority",
  );
  const authorityProblems = validateAuthorityTransfer(authority);
  if (authorityProblems.length !== 0) {
    throw new Error(
      `prepared Core authority is invalid (${authorityProblems.join("; ")})`,
    );
  }
  if (authority.state !== "prepared-writer-disabled") {
    throw new Error(
      `prepared Core authority must remain dormant, observed ${authority.state}`,
    );
  }
  const p0 = validateCommit(
    authority.successorPreparedCommit,
    "prepared Core P0 commit",
  );
  const resolved = gitOutput(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${p0}^{commit}`,
  ]);
  if (resolved !== p0) {
    throw new Error("prepared Core P0 commit does not resolve to itself");
  }

  const writerManifestBytes = gitBlob(
    repositoryRoot,
    p0,
    WRITER_CLOSURE_MANIFEST_PATH,
  );
  const writerManifest = parseJSONDocument(
    writerManifestBytes,
    "P0 Specification writer closure manifest",
  );
  const manifestProblems = validateSpecificationWriterClosureManifest(
    writerManifest,
  );
  if (manifestProblems.length !== 0) {
    throw new Error(
      `P0 Specification writer closure manifest is invalid (${manifestProblems.join("; ")})`,
    );
  }
  if (
    canonicalJSON(writerManifest.paths) !==
    canonicalJSON(specificationWriterClosurePaths) ||
    canonicalJSON(writerManifest.paths) !== canonicalJSON(WRITER_EXECUTION_PATHS)
  ) {
    throw new Error("P0 Specification writer closure paths differ from the exact ownership manifest");
  }

  const uniquePaths = [...writerManifest.paths];
  for (const requiredPath of [
    "package.json",
    "bun.lock",
    WRITER_TOOL_CLOSURE_POLICY_PATH,
    WRITER_CLOSURE_MANIFEST_PATH,
  ]) {
    if (!uniquePaths.includes(requiredPath)) {
      throw new Error(
        `P0 Specification writer closure is missing required path: ${requiredPath}`,
      );
    }
  }
  const p0Records = Object.fromEntries(
    uniquePaths.map((relativePath) => {
      const bytes = gitBlob(repositoryRoot, p0, relativePath);
      return [relativePath, {
        sha256: sha256(bytes),
        bytes,
      }];
    }),
  );
  const currentRecords = Object.fromEntries(
    uniquePaths.map((relativePath) => {
      const file = regularRepositoryFile(repositoryRoot, relativePath);
      return [relativePath, {
        sha256: sha256(file.bytes),
        bytes: file.bytes,
      }];
    }),
  );
  for (const relativePath of uniquePaths) {
    if (
      p0Records[relativePath].sha256 !== currentRecords[relativePath].sha256 ||
      !p0Records[relativePath].bytes.equals(currentRecords[relativePath].bytes)
    ) {
      throw new Error(
        `current Specification writer path differs from immutable P0: ${relativePath}`,
      );
    }
  }
  const policy = parseSchemaToolClosurePolicy(
    p0Records[WRITER_TOOL_CLOSURE_POLICY_PATH].bytes,
  );
  return Object.freeze({
    commit: p0,
    authoritySha256: sha256(authorityFile.bytes),
    policy,
    manifestSha256: sha256(writerManifestBytes),
    paths: Object.freeze([...uniquePaths]),
    records: Object.freeze(
      Object.fromEntries(
        uniquePaths.map((relativePath) => [
          relativePath,
          Object.freeze({
            sha256: p0Records[relativePath].sha256,
            bytes: Buffer.from(p0Records[relativePath].bytes),
          }),
        ]),
      ),
    ),
  });
}

function verifyP0ToolClosure(repositoryRoot, p0Closure) {
  const authorityFile = regularRepositoryFile(
    repositoryRoot,
    SCHEMA_ORIGIN.authorityPath,
  );
  const authority = parseJSONDocument(
    authorityFile.bytes,
    "Specification authority",
  );
  if (
    authority.state !== "prepared-writer-disabled" ||
    authority.successorPreparedCommit !== p0Closure.commit
  ) {
    throw new Error("prepared Core authority rotated or no longer pins immutable P0");
  }
  const resolved = gitOutput(repositoryRoot, [
    "rev-parse",
    "--verify",
    `${p0Closure.commit}^{commit}`,
  ]);
  if (resolved !== p0Closure.commit) {
    throw new Error("immutable P0 commit no longer resolves to itself");
  }
  for (const relativePath of p0Closure.paths) {
    const current = regularRepositoryFile(repositoryRoot, relativePath).bytes;
    const expected = p0Closure.records[relativePath];
    if (sha256(current) !== expected.sha256 || !current.equals(expected.bytes)) {
      throw new Error(
        `current Specification writer path differs from immutable P0: ${relativePath}`,
      );
    }
  }
}

function validateSchemaOriginConfig(raw) {
  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw new Error(`schema-origin/wrangler.jsonc must be strict JSON (${error.message})`);
  }
  const expectedKeys = [
    "$schema",
    "assets",
    "compatibility_date",
    "name",
    "preview_urls",
    "routes",
    "workers_dev",
  ];
  if (
    !exactKeys(config, expectedKeys) ||
    config.$schema !== "../node_modules/wrangler/config-schema.json" ||
    config.name !== SCHEMA_ORIGIN.worker ||
    config.compatibility_date !== "2026-08-27" ||
    config.workers_dev !== false ||
    config.preview_urls !== false ||
    !Array.isArray(config.routes) ||
    config.routes.length !== 1 ||
    !exactKeys(config.routes[0], ["pattern", "zone_name"]) ||
    config.routes[0].pattern !== SCHEMA_ORIGIN.routePattern ||
    config.routes[0].zone_name !== SCHEMA_ORIGIN.zoneName ||
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
    throw new Error(
      `schema origin config must remain the exact static-only ${SCHEMA_ORIGIN.routePattern} route with no redirect, custom domain, runtime, binding, or /v2 surface`,
    );
  }
  return config;
}

function walkClosedDirectory(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new Error(`bundle output contains symlink ${relative}`);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        const bytes = readFileSync(absolute);
        files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
      } else {
        throw new Error(`bundle output contains non-regular entry ${relative}`);
      }
    }
  };
  visit(root);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

export function createWranglerSubprocessEnvironment(_baseEnv, {
  accountId,
  token,
  outputFile,
  isolationRoot,
  nodeModulesRoot,
  runtimeExecutable = process.execPath,
} = {}) {
  if (typeof isolationRoot !== "string" || !path.isAbsolute(isolationRoot)) {
    throw new Error("Wrangler subprocess isolation root must be absolute");
  }
  const home = path.join(isolationRoot, "home");
  const config = path.join(isolationRoot, "xdg-config");
  const cache = path.join(isolationRoot, "xdg-cache");
  const data = path.join(isolationRoot, "xdg-data");
  const state = path.join(isolationRoot, "xdg-state");
  const temporary = path.join(isolationRoot, "tmp");
  for (const directory of [home, config, cache, data, state, temporary]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const environment = {
    PATH: `${path.dirname(runtimeExecutable)}:/usr/bin:/bin`,
    HOME: home,
    XDG_CONFIG_HOME: config,
    XDG_CACHE_HOME: cache,
    XDG_DATA_HOME: data,
    XDG_STATE_HOME: state,
    TMPDIR: temporary,
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    CI: "true",
    NO_COLOR: "1",
    WRANGLER_LOG_SANITIZE: "true",
    WRANGLER_SEND_METRICS: "false",
  };
  if (token !== undefined) environment.CLOUDFLARE_API_TOKEN = token;
  if (accountId !== undefined) environment.CLOUDFLARE_ACCOUNT_ID = accountId;
  if (nodeModulesRoot !== undefined) {
    if (typeof nodeModulesRoot !== "string" || !path.isAbsolute(nodeModulesRoot)) {
      throw new Error("sealed Wrangler module root must be absolute");
    }
    environment.NODE_PATH = nodeModulesRoot;
  }
  if (outputFile !== undefined) environment.WRANGLER_OUTPUT_FILE_PATH = outputFile;
  return environment;
}

export function redactSubprocessText(value, token) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (typeof token !== "string" || token === "") return text;
  return text.split(token).join("[REDACTED]");
}

function redactSubprocessValue(value, token) {
  if (typeof value === "string") return redactSubprocessText(value, token);
  if (Array.isArray(value)) return value.map((entry) => redactSubprocessValue(entry, token));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        redactSubprocessText(key, token),
        redactSubprocessValue(entry, token),
      ]),
    );
  }
  return value;
}

function currentOrRootOwner(info, label) {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && info.uid !== 0 && info.uid !== uid) {
    throw new Error(`${label} is not owned by root or the current user`);
  }
}

function validatedNodeExecutable() {
  const executable = process.execPath;
  if (
    !path.isAbsolute(executable) ||
    !/^(?:node|nodejs)$/iu.test(path.basename(executable)) ||
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
  currentOrRootOwner(info, "credentialed Wrangler runtime");
  return executable;
}

function verifySecureTemporaryParent() {
  const parent = realpathSync(tmpdir());
  const info = lstatSync(parent);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("temporary directory parent must be one real directory");
  }
  currentOrRootOwner(info, "temporary directory parent");
  const mode = info.mode & 0o7777;
  if ((mode & 0o022) !== 0 && (mode & 0o1000) === 0) {
    throw new Error("temporary directory parent is group/world writable without sticky protection");
  }
  return parent;
}

function independentSealedClosureRecords(root) {
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
    currentOrRootOwner(directoryInfo, `sealed tool closure directory ${directory}`);
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = prefix === "" ? name : `${prefix}/${name}`;
      const info = lstatSync(absolute);
      if (info.isSymbolicLink()) {
        throw new Error(`sealed tool closure contains a symlink: ${relative}`);
      }
      currentOrRootOwner(info, `sealed tool closure entry ${relative}`);
      if (info.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!info.isFile() || info.nlink !== 1) {
        throw new Error(`sealed tool closure entry is not one ordinary file: ${relative}`);
      }
      const mode = info.mode & 0o7777;
      if (mode !== 0o444 && mode !== 0o555) {
        throw new Error(`sealed tool closure file is not exact read-only mode: ${relative}`);
      }
      const bytes = readFileSync(absolute);
      records.push({
        path: relative,
        sha256: sha256(bytes),
        executable: mode === 0o555,
      });
    }
  };
  visit(root);
  if (records.length === 0) throw new Error("sealed dependency/tool closure is empty");
  return records;
}

function verifySealedToolClosure(sealedToolClosure, policy, repositoryRoot) {
  if (
    sealedToolClosure === null ||
    typeof sealedToolClosure !== "object" ||
    typeof sealedToolClosure.verify !== "function" ||
    typeof sealedToolClosure.root !== "string" ||
    typeof sealedToolClosure.executable !== "string"
  ) {
    throw new Error("sealed Wrangler closure is not one adapter-issued closure");
  }
  const root = path.resolve(sealedToolClosure.root);
  const executable = path.resolve(sealedToolClosure.executable);
  const repository = path.resolve(repositoryRoot);
  const temporaryParent = verifySecureTemporaryParent();
  const runtimeRoot = path.dirname(root);
  if (
    path.basename(root) !== "sealed-node_modules" ||
    path.dirname(runtimeRoot) !== temporaryParent ||
    relationIsInside(repository, root) ||
    realpathSync(runtimeRoot) !== runtimeRoot ||
    realpathSync(root) !== root
  ) {
    throw new Error("sealed Wrangler closure must remain in a private temporary root outside the repository");
  }
  const runtimeInfo = lstatSync(runtimeRoot);
  if (
    runtimeInfo.isSymbolicLink() ||
    !runtimeInfo.isDirectory() ||
    (runtimeInfo.mode & 0o7777) !== 0o700
  ) {
    throw new Error("sealed Wrangler runtime root is not private");
  }
  currentOrRootOwner(runtimeInfo, "sealed Wrangler runtime root");
  const recordsBefore = independentSealedClosureRecords(root);
  const manifestBefore = sha256(Buffer.from(canonicalJSON(recordsBefore)));
  if (
    recordsBefore.length !== policy.fileCount ||
    manifestBefore !== policy.manifestSha256
  ) {
    throw new Error("sealed Wrangler closure differs from the tracked tool-closure policy");
  }
  // The adapter hook is retained for callers that need an explicit just-in-
  // time check, but its reported metadata is not trusted as authority.
  sealedToolClosure.verify();
  const recordsAfter = independentSealedClosureRecords(root);
  if (canonicalJSON(recordsBefore) !== canonicalJSON(recordsAfter)) {
    throw new Error("sealed dependency/tool closure changed during verification");
  }
  const manifestAfter = sha256(Buffer.from(canonicalJSON(recordsAfter)));
  if (manifestAfter !== policy.manifestSha256) {
    throw new Error("sealed Wrangler closure changed during verification");
  }
  const resolvedExecutable = realpathSync(executable);
  const relativeExecutable = path
    .relative(root, resolvedExecutable)
    .split(path.sep)
    .join("/");
  if (
    !path.isAbsolute(root) ||
    !path.isAbsolute(executable) ||
    resolvedExecutable !== executable ||
    relativeExecutable !== policy.executable ||
    !statSync(executable).isFile()
  ) {
    throw new Error("sealed Wrangler closure differs from the tracked tool-closure policy");
  }
  return executable;
}

function runPinnedWrangler(sealedToolClosure, repositoryRoot, baseEnv, args, {
  accountId,
  token,
  expectOutput = false,
  runner = spawnSync,
  registerEvidence,
} = {}) {
  // This verification is intentionally the first operation in the
  // credentialed path. It must precede reading or passing Cloudflare
  // authority to the subprocess and precede every spawn.
  if (!sealedToolClosure.p0Closure) {
    throw new Error("sealed Wrangler closure lacks its immutable P0 authority proof");
  }
  const runtimeExecutable = runner === spawnSync
    ? validatedNodeExecutable()
    : process.execPath;
  validateSchemaToolRuntimePolicy(sealedToolClosure.policy, {
    requireCurrent: runner === spawnSync,
  });
  const runtimeEvidence = {
    executable: runtimeExecutable,
    version: process.version,
    sha256: runner === spawnSync ? sha256(readFileSync(runtimeExecutable)) : null,
  };
  const executable = verifySealedToolClosure(
    sealedToolClosure,
    sealedToolClosure.policy,
    repositoryRoot,
  );
  verifyP0ToolClosure(repositoryRoot, sealedToolClosure.p0Closure);
  const resolvedAccountId = typeof accountId === "function" ? accountId() : accountId;
  const resolvedToken = typeof token === "function" ? token() : token;
  const executionRoot = mkdtempSync(
    path.join(tmpdir(), "takoform-schema-origin-wrangler-"),
  );
  const diagnosticRoot = mkdtempSync(
    path.join(tmpdir(), "takoform-schema-origin-diagnostic-"),
  );
  const emptyEnvFile = path.join(executionRoot, "explicit-empty.env");
  const outputFile = path.join(executionRoot, "wrangler-output.jsonl");
  writeFileSync(emptyEnvFile, "", { mode: 0o600, flag: "wx" });
  if (expectOutput) writeFileSync(outputFile, "", { mode: 0o600, flag: "wx" });
  const command = [runtimeExecutable, executable, ...args, "--env-file", emptyEnvFile];
  let result;
  try {
    result = runner(
      runtimeExecutable,
      [executable, ...args, "--env-file", emptyEnvFile],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env: createWranglerSubprocessEnvironment(baseEnv, {
          accountId: resolvedAccountId,
          token: resolvedToken,
          outputFile: expectOutput ? outputFile : undefined,
          isolationRoot: executionRoot,
          nodeModulesRoot: sealedToolClosure.root,
          runtimeExecutable,
        }),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    result = {
      status: null,
      signal: null,
      stdout: "",
      stderr: error?.message ?? String(error),
      error,
    };
  }
  const diagnostic = {
    command: redactSubprocessValue(command, resolvedToken),
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    stdout: redactSubprocessText(result.stdout ?? "", resolvedToken),
    stderr: redactSubprocessText(result.stderr ?? "", resolvedToken),
  };
  writeFileSync(
    path.join(diagnosticRoot, "diagnostic.json"),
    canonicalJSON(diagnostic),
    { mode: 0o600, flag: "wx" },
  );
  const evidence = {
    executionRoot,
    diagnosticRoot,
    outputFile,
    emptyEnvFile,
    command: redactSubprocessValue(command, resolvedToken),
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    stdout: diagnostic.stdout,
    stderr: diagnostic.stderr,
    rawMachineOutput: null,
    machineOutput: null,
    sealedClosure: {
      root: sealedToolClosure.root,
      executable,
      fileCount: sealedToolClosure.policy.fileCount,
      manifestSha256: sealedToolClosure.policy.manifestSha256,
      wranglerVersion: sealedToolClosure.policy.wranglerVersion,
      p0Commit: sealedToolClosure.p0Closure?.commit ?? null,
    },
    runtime: runtimeEvidence,
    recovery: false,
  };
  const publishEvidence = () => {
    if (typeof registerEvidence !== "function") return;
    try {
      registerEvidence(evidence);
    } catch {
      // Evidence registration must not weaken fail-closed command handling.
    }
  };
  const failWithSanitizedDiagnostic = (message) => {
    publishEvidence();
    throw new Error(
      `${message}; sanitized diagnostics retained outside the repository at ${diagnosticRoot}`,
    );
  };
  if (result?.error || result?.status !== 0) {
    failWithSanitizedDiagnostic("pinned Wrangler command failed");
  }
  let output = null;
  if (expectOutput) {
    let lines;
    let rawOutput;
    try {
      rawOutput = readFileSync(outputFile, "utf8");
      evidence.rawMachineOutput = redactSubprocessText(rawOutput, resolvedToken);
      if (typeof resolvedToken === "string" && resolvedToken !== "" && rawOutput.includes(resolvedToken)) {
        failWithSanitizedDiagnostic(
          "pinned Wrangler attempted to place the API token in machine output",
        );
      }
      lines = rawOutput
        .split("\n")
        .filter((line) => line !== "");
    } catch (error) {
      if (error?.message?.includes("sanitized diagnostics retained")) throw error;
      failWithSanitizedDiagnostic(
        `pinned Wrangler produced no machine output (${redactSubprocessText(error.message, resolvedToken)})`,
      );
    }
    try {
      const documents = lines.map((line) => JSON.parse(line));
      const sessions = documents.filter((document) => document?.type === "wrangler-session");
      const outputs = documents.filter((document) => document?.type !== "wrangler-session");
      if (
        sessions.length > 1 ||
        sessions.some((session) => session.wrangler_version !== sealedToolClosure.policy.wranglerVersion) ||
        outputs.length !== 1
      ) {
        failWithSanitizedDiagnostic("pinned Wrangler machine output is ambiguous");
      }
      output = outputs[0];
      evidence.machineOutput = redactSubprocessValue(output, resolvedToken);
    } catch (error) {
      failWithSanitizedDiagnostic(
        `pinned Wrangler machine output is invalid JSON (${redactSubprocessText(error.message, resolvedToken)})`,
      );
    }
  }
  publishEvidence();
  return output;
}

function buildDryRunBundle(
  repositoryRoot,
  baseEnv,
  sealedToolClosure,
  runner,
  registerEvidence,
) {
  const root = mkdtempSync(path.join(tmpdir(), "takoform-schema-origin-dry-run-"));
  const outputRoot = path.join(root, "bundle");
  try {
    runPinnedWrangler(
      sealedToolClosure,
      repositoryRoot,
      baseEnv,
      [
        "versions",
        "upload",
        "--dry-run",
        "--outdir",
        outputRoot,
        "--config",
        SCHEMA_ORIGIN.configPath,
        "--name",
        SCHEMA_ORIGIN.worker,
      ],
      { runner, registerEvidence },
    );
    const files = walkClosedDirectory(outputRoot);
    if (files.length === 0) throw new Error("Wrangler dry-run bundle is empty");
    const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
    const bundle = {
      wranglerVersion: SCHEMA_ORIGIN.wranglerVersion,
      files,
      totalBytes,
      sha256: sha256(canonicalJSON(files)),
    };
    validateBundle(bundle);
    return bundle;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function inspectLocalRepository(
  repositoryRoot,
  baseEnv,
  expectedCommit,
  sealedToolClosure,
  runner,
  registerEvidence,
) {
  validateCommit(expectedCommit, "expected commit");
  const root = path.resolve(repositoryRoot);
  if (
    realpathSync(root) !== root ||
    lstatSync(root).isSymbolicLink() ||
    !statSync(root).isDirectory()
  ) {
    throw new Error("repository root must be one real directory");
  }
  const commit = gitOutput(root, ["rev-parse", "HEAD"]);
  const branch = gitOutput(root, ["branch", "--show-current"]);
  const shallow = gitOutput(root, ["rev-parse", "--is-shallow-repository"]);
  const dirty = gitOutput(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  const replacements = gitOutput(root, ["for-each-ref", "--format=%(refname)", "refs/replace"]);
  const origin = gitOutput(root, ["remote", "get-url", "origin"]);
  const canonicalLine = gitOutput(root, [
    "ls-remote",
    "--exit-code",
    SCHEMA_ORIGIN.repository,
    "refs/heads/main",
  ]);
  const canonicalFields = canonicalLine.split(/\s+/u);
  const alternatesPath = path.resolve(
    root,
    gitOutput(root, ["rev-parse", "--git-path", "objects/info/alternates"]),
  );
  let alternatesPresent = false;
  try {
    alternatesPresent = lstatSync(alternatesPath).isFile();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (
    commit !== expectedCommit ||
    branch !== "main" ||
    shallow !== "false" ||
    dirty !== "" ||
    replacements !== "" ||
    origin !== SCHEMA_ORIGIN.repository ||
    canonicalFields.length !== 2 ||
    canonicalFields[0] !== expectedCommit ||
    canonicalFields[1] !== "refs/heads/main" ||
    alternatesPresent ||
    typeof baseEnv.GIT_ALTERNATE_OBJECT_DIRECTORIES === "string"
  ) {
    throw new Error(
      "repository must be clean, attached non-shallow main at exact fresh canonical Core main with canonical origin and no replacements or alternates",
    );
  }

  const authorityFile = regularRepositoryFile(root, SCHEMA_ORIGIN.authorityPath);
  const ledgerFile = regularRepositoryFile(root, SCHEMA_ORIGIN.ledgerPath);
  const configFile = regularRepositoryFile(root, SCHEMA_ORIGIN.configPath);
  let authority;
  try {
    authority = JSON.parse(authorityFile.bytes);
  } catch (error) {
    throw new Error(`authority record is invalid JSON (${error.message})`);
  }
  validateSchemaOriginConfig(configFile.bytes.toString("utf8"));
  const inspectedProjection = inspectSchemaProjection(root);
  if (inspectedProjection.problems.length !== 0) {
    throw new Error(
      `schema projection differs from its active ledger (${inspectedProjection.problems.join("; ")})`,
    );
  }
  for (const entry of inspectedProjection.entries) {
    if (entry.bytes.includes(Buffer.from("/v2"))) {
      throw new Error(`active schema ${entry.id} contains forbidden /v2 bytes`);
    }
  }
  const ledger = readSchemaIdentityLedger(root);
  const entries = inspectedProjection.entries.map((entry) => ({
    bytes: entry.bytes.length,
    projectionPath: `${SCHEMA_ORIGIN.projectionRoot}/${entry.relativePath}`,
    sha256: entry.sha256,
    sourcePath: entry.source,
    url: entry.id,
  }));
  const retired = ledger.retired.map((entry) => ({
    sha256: entry.sha256,
    url: entry.id,
  }));
  const local = {
    source: {
      repository: SCHEMA_ORIGIN.repository,
      branch,
      commit,
      canonicalMainCommit: canonicalFields[0],
      clean: true,
    },
    authority: {
      document: authority,
      path: SCHEMA_ORIGIN.authorityPath,
      sha256: sha256(authorityFile.bytes),
    },
    ledger: {
      path: SCHEMA_ORIGIN.ledgerPath,
      sha256: sha256(ledgerFile.bytes),
    },
    projection: {
      root: SCHEMA_ORIGIN.projectionRoot,
      sha256: sha256(canonicalJSON(entries)),
      totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      entries,
    },
    config: {
      path: SCHEMA_ORIGIN.configPath,
      sha256: sha256(configFile.bytes),
    },
    retired,
    dryRunBundle: buildDryRunBundle(
      root,
      baseEnv,
      sealedToolClosure,
      runner,
      registerEvidence,
    ),
  };
  return validateLocalEvidence(local, expectedCommit);
}

function outsideRepositoryPath(repositoryRoot, candidate, { mustExist }) {
  validateAbsoluteRecordPath(candidate, "record path");
  const absolute = path.resolve(candidate);
  const relative = path.relative(repositoryRoot, absolute);
  if (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  ) {
    throw new Error("operator candidate/review/production records must remain outside the repository");
  }
  const parent = path.dirname(absolute);
  if (realpathSync(parent) !== parent || lstatSync(parent).isSymbolicLink()) {
    throw new Error("record parent must be one real outside-repository directory");
  }
  if (mustExist) {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isFile() || realpathSync(absolute) !== absolute) {
      throw new Error("input record must be one ordinary outside-repository file");
    }
  } else {
    try {
      lstatSync(absolute);
      throw new Error("output record already exists; overwrite is forbidden");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return absolute;
}

function writeOutsideRecord(repositoryRoot, output, bytes) {
  const absolute = outsideRepositoryPath(repositoryRoot, output, {
    mustExist: false,
  });
  const descriptor = openSync(absolute, "wx", 0o600);
  try {
    writeFileSync(descriptor, bytes, "utf8");
  } finally {
    closeSync(descriptor);
  }
}

async function publicObservation(fetchImpl, url) {
  const response = await fetchImpl(url, {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "application/json" },
  });
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > 2 * 1024 * 1024)
  ) {
    throw new Error(`public response for ${url} has an invalid or oversized Content-Length`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 2 * 1024 * 1024) {
    throw new Error(`public response for ${url} exceeds the 2 MiB readback limit`);
  }
  return {
    url: response.url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    sha256: sha256(bytes),
    bytes: bytes.length,
    redirected: response.redirected,
    location: response.headers.get("location"),
  };
}

function encoded(value) {
  return encodeURIComponent(value);
}

function cloudflareApi(fetchImpl, token) {
  if (
    typeof token !== "string" ||
    token === "" ||
    token.trim() !== token ||
    /[\u0000-\u0020\u007f]/u.test(token)
  ) {
    throw new Error("CLOUDFLARE_API_TOKEN is empty or non-canonical");
  }
  const request = async (apiPath, { method = "GET", allowNotFound = false } = {}) => {
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4${apiPath}`,
      {
        method,
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (allowNotFound && response.status === 404) return { notFound: true };
    const raw = await response.text();
    if (raw.length > 8 * 1024 * 1024) throw new Error("Cloudflare API response exceeded 8 MiB");
    let body;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Cloudflare API returned invalid JSON (${error.message})`);
    }
    if (
      !response.ok ||
      body?.success !== true ||
      !Array.isArray(body?.errors) ||
      body.errors.length !== 0
    ) {
      const messages = Array.isArray(body?.errors)
        ? body.errors.map((entry) => entry?.message).filter(Boolean).join("; ")
        : "unknown error";
      throw new Error(`Cloudflare API ${method} ${apiPath} failed (${response.status}: ${messages})`);
    }
    return { body, result: body.result };
  };
  return { request };
}

function versionItems(result) {
  const items = Array.isArray(result) ? result : result?.items;
  if (!Array.isArray(items)) throw new Error("Cloudflare versions readback has an unknown shape");
  return items;
}

function normalizeVersionApi(version) {
  return {
    id: version?.id,
    metadata: version?.metadata ?? {},
    annotations: version?.annotations ?? {},
    resources: version?.resources ?? {},
  };
}

function normalizeDeploymentApi(deployment) {
  return {
    id: deployment?.id,
    strategy: deployment?.strategy,
    versions: deployment?.versions,
    annotations: deployment?.annotations ?? {},
  };
}

export function createSchemaOriginOperations({
  repo = moduleRoot,
  env = process.env,
  fetchImpl = globalThis.fetch,
  runner = spawnSync,
  sealToolClosure = sealInstalledToolClosure,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch capability is unavailable");
  if (typeof runner !== "function") throw new Error("Wrangler subprocess runner is unavailable");
  if (typeof sealToolClosure !== "function") throw new Error("tool-closure sealer is unavailable");
  const repositoryRoot = path.resolve(repo);
  let runtimeRoot;
  let retainedEvidence = [];
  let recoveryRetained = false;
  let cleaned = false;
  try {
    // Seal the complete installed dependency closure before any repository
    // inspection can spawn Git, fetch public state, or observe authority.
    runtimeRoot = mkdtempSync(
      path.join(tmpdir(), "takoform-schema-origin-closure-"),
    );
    const policyFile = regularRepositoryFile(
      repositoryRoot,
      WRITER_TOOL_CLOSURE_POLICY_PATH,
    );
    const policy = parseSchemaToolClosurePolicy(policyFile.bytes);
    const sealed = sealToolClosure({ repositoryRoot, runtimeRoot });
    const policyAtSeal = parseSchemaToolClosurePolicy(policyFile.bytes);
    const preliminarySealedToolClosure = Object.freeze({
      ...sealed,
      policy: policyAtSeal,
    });
    verifySealedToolClosure(
      preliminarySealedToolClosure,
      policyAtSeal,
      repositoryRoot,
    );
    const p0Closure = resolveP0ToolClosure(repositoryRoot);
    if (
      p0Closure.policy.manifestSha256 !== policy.manifestSha256 ||
      p0Closure.policy.fileCount !== policy.fileCount ||
      p0Closure.policy.wranglerVersion !== policy.wranglerVersion ||
      p0Closure.policy.runtimeExecutable !== policy.runtimeExecutable ||
      p0Closure.policy.runtimeVersion !== policy.runtimeVersion ||
      p0Closure.policy.runtimeSha256 !== policy.runtimeSha256
    ) {
      throw new Error("current tool policy differs from immutable P0 authority");
    }
    const sealedToolClosure = Object.freeze({ ...sealed, policy, p0Closure });
    verifySealedToolClosure(sealedToolClosure, policy, repositoryRoot);
    const policyAfter = regularRepositoryFile(
      repositoryRoot,
      WRITER_TOOL_CLOSURE_POLICY_PATH,
    );
    if (!policyFile.bytes.equals(policyAfter.bytes)) {
      throw new Error("schema tool-closure policy changed while it was sealed");
    }

    const registerEvidence = (evidence) => {
      if (evidence === null || typeof evidence !== "object") return;
      if (!retainedEvidence.includes(evidence)) retainedEvidence.push(evidence);
    };
    const recoveryArtifact = (evidence, reason) => {
      recoveryRetained = true;
      evidence.recovery = true;
      evidence.recoveryReasons ??= [];
      if (reason !== undefined) {
        const encoded = canonicalJSON(reason);
        if (!evidence.recoveryReasons.some((entry) => canonicalJSON(entry) === encoded)) {
          evidence.recoveryReasons.push(reason);
        }
      }
      const artifact = {
        format: "takoform.schema-origin-recovery-evidence@v1",
        recoveryReasons: evidence.recoveryReasons,
        command: evidence.command,
        status: evidence.status,
        signal: evidence.signal,
        stdout: evidence.stdout,
        stderr: evidence.stderr,
        runtime: evidence.runtime,
        machineOutput: evidence.machineOutput,
        rawMachineOutput: evidence.rawMachineOutput,
        machineOutputPath: evidence.outputFile,
        executionRoot: evidence.executionRoot,
        diagnosticRoot: evidence.diagnosticRoot,
        sealedClosure: evidence.sealedClosure,
      };
      writeFileSync(
        path.join(evidence.diagnosticRoot, "recovery.json"),
        canonicalJSON(artifact),
        { mode: 0o600 },
      );
    };
    const retainRecoveryEvidence = (reason) => {
      for (const evidence of retainedEvidence) recoveryArtifact(evidence, reason);
    };
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      for (const evidence of retainedEvidence) {
        if (evidence.recovery === true) continue;
        rmSync(evidence.executionRoot, { recursive: true, force: true });
        rmSync(evidence.diagnosticRoot, { recursive: true, force: true });
      }
      if (!recoveryRetained) rmSync(runtimeRoot, { recursive: true, force: true });
    };
    const getRecoveryEvidence = () => retainedEvidence
      .filter((evidence) => evidence.recovery === true)
      .map((evidence) => Object.freeze({
        recoveryArtifact: path.join(evidence.diagnosticRoot, "recovery.json"),
        diagnosticRoot: evidence.diagnosticRoot,
        executionRoot: evidence.executionRoot,
        sealedRoot: evidence.sealedClosure.root,
        machineOutputPath: evidence.outputFile,
      }));
    const operations = {
      cleanup,
      retainRecoveryEvidence,
      getRecoveryEvidence,
      verifyToolClosure() {
        verifySealedToolClosure(sealedToolClosure, policy, repositoryRoot);
        verifyP0ToolClosure(repositoryRoot, p0Closure);
      },
      async inspectLocalState(expectedCommit) {
        verifySealedToolClosure(sealedToolClosure, policy, repositoryRoot);
        verifyP0ToolClosure(repositoryRoot, p0Closure);
        return inspectLocalRepository(
          repositoryRoot,
          env,
          expectedCommit,
          sealedToolClosure,
          runner,
          registerEvidence,
        );
      },
    async readRecord(recordPath) {
      const absolute = outsideRepositoryPath(repositoryRoot, recordPath, {
        mustExist: true,
      });
      const stat = statSync(absolute);
      if (stat.size > 10 * 1024 * 1024) throw new Error("input record exceeds 10 MiB");
      return readFileSync(absolute, "utf8");
    },
    async writeRecord(recordPath, bytes) {
      writeOutsideRecord(repositoryRoot, recordPath, bytes);
    },
    async readPublic(url) {
      return publicObservation(fetchImpl, url);
    },
    async readRoutes(target, token) {
      const api = cloudflareApi(fetchImpl, token);
      const { result } = await api.request(
        `/zones/${encoded(target.zoneId)}/workers/routes`,
      );
      if (!Array.isArray(result)) throw new Error("Cloudflare route list has an unknown shape");
      return result;
    },
    async readCustomDomains(target, token) {
      const api = cloudflareApi(fetchImpl, token);
      const domains = [];
      let page = 1;
      for (;;) {
        const { body, result } = await api.request(
          `/accounts/${encoded(target.accountId)}/workers/domains?zone_name=${encoded(SCHEMA_ORIGIN.zoneName)}&page=${page}&per_page=100`,
        );
        if (!Array.isArray(result)) throw new Error("Cloudflare custom-domain list has an unknown shape");
        domains.push(...result);
        const totalPages = body.result_info?.total_pages ?? 1;
        if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 100) throw new Error("Cloudflare custom-domain pagination is invalid");
        if (page >= totalPages) break;
        page += 1;
      }
      return domains.map((domain) => ({
        id: domain.id,
        certId: domain.cert_id,
        hostname: domain.hostname,
        service: domain.service,
        zoneId: domain.zone_id,
        zoneName: domain.zone_name,
        environment: domain.environment ?? null,
      }));
    },
    async readWorkerState(target, token) {
      const api = cloudflareApi(fetchImpl, token);
      const versionsResponse = await api.request(
        `/accounts/${encoded(target.accountId)}/workers/scripts/${encoded(target.worker)}/versions?per_page=100`,
        { allowNotFound: true },
      );
      if (versionsResponse.notFound) {
        return { exists: false, versions: [], deployments: [] };
      }
      const versions = versionItems(versionsResponse.result).map(normalizeVersionApi);
      const deploymentsResponse = await api.request(
        `/accounts/${encoded(target.accountId)}/workers/scripts/${encoded(target.worker)}/deployments`,
      );
      const deployments = deploymentsResponse.result?.deployments;
      if (!Array.isArray(deployments)) throw new Error("Cloudflare deployments list has an unknown shape");
      return {
        exists: true,
        versions,
        deployments: deployments.map(normalizeDeploymentApi),
      };
    },
    async readVersion(target, versionId, token) {
      const api = cloudflareApi(fetchImpl, token);
      const { result } = await api.request(
        `/accounts/${encoded(target.accountId)}/workers/scripts/${encoded(target.worker)}/versions/${encoded(versionId)}`,
      );
      return normalizeVersionApi(result);
    },
    async readDeployment(target, deploymentId, token) {
      const api = cloudflareApi(fetchImpl, token);
      const { result } = await api.request(
        `/accounts/${encoded(target.accountId)}/workers/scripts/${encoded(target.worker)}/deployments/${encoded(deploymentId)}`,
      );
      return normalizeDeploymentApi(result);
    },
    async uploadVersion(target, request) {
      const output = runPinnedWrangler(
        sealedToolClosure,
        repositoryRoot,
        env,
        [
          "versions",
          "upload",
          "--strict",
          "--config",
          SCHEMA_ORIGIN.configPath,
          "--name",
          SCHEMA_ORIGIN.worker,
          "--message",
          request.message,
        ],
        {
          accountId: () => target.accountId,
          token: () => request.token,
          expectOutput: true,
          runner,
          registerEvidence,
        },
      );
      return {
        type: output?.type,
        version: output?.version,
        worker_name: output?.worker_name,
        version_id: output?.version_id,
      };
    },
    async deployVersion(target, request) {
      const output = runPinnedWrangler(
        sealedToolClosure,
        repositoryRoot,
        env,
        [
          "versions",
          "deploy",
          `${request.versionId}@100%`,
          "--yes",
          "--config",
          SCHEMA_ORIGIN.configPath,
          "--name",
          SCHEMA_ORIGIN.worker,
          "--message",
          request.message,
        ],
        {
          accountId: () => target.accountId,
          token: () => request.token,
          expectOutput: true,
          runner,
          registerEvidence,
        },
      );
      return {
        type: output?.type,
        version: output?.version,
        worker_name: output?.worker_name,
        deployment_id: output?.deployment_id,
        version_traffic: { [request.versionId]: 100 },
      };
    },
    async deployTriggers(target, request) {
      runPinnedWrangler(
        sealedToolClosure,
        repositoryRoot,
        env,
        [
          "triggers",
          "deploy",
          "--config",
          SCHEMA_ORIGIN.configPath,
          "--name",
          SCHEMA_ORIGIN.worker,
        ],
        {
          accountId: () => target.accountId,
          token: () => request.token,
          expectOutput: false,
          runner,
          registerEvidence,
        },
      );
    },
    async readPredecessorMain(expectedCommit) {
      validateCommit(expectedCommit, "predecessor tombstone commit");
      const raw = gitOutput(repositoryRoot, [
        "ls-remote",
        "--exit-code",
        SCHEMA_ORIGIN.predecessorRepository,
        "refs/heads/main",
      ]);
      const fields = raw.split(/\s+/u);
      if (fields.length !== 2 || fields[1] !== "refs/heads/main") {
        throw new Error("canonical predecessor main readback is ambiguous");
      }
      return fields[0];
    },
    async now() {
      return new Date().toISOString().replace(/\.\d{3}Z$/u, "Z");
    },
    async activationInstantAfter(freshReadbackAt) {
      if (!canonicalInstant(freshReadbackAt)) {
        throw new Error("fresh activation readback instant is not canonical");
      }
      return new Date(Date.parse(freshReadbackAt) + 1_000)
        .toISOString()
        .replace(/\.\d{3}Z$/u, "Z");
    },
    async deleteRoute(target, routeId, token) {
      const api = cloudflareApi(fetchImpl, token);
      await api.request(
        `/zones/${encoded(target.zoneId)}/workers/routes/${encoded(routeId)}`,
        { method: "DELETE" },
      );
      return { id: routeId };
    },
    };
    return operations;
  } catch (error) {
    if (runtimeRoot !== undefined) {
      rmSync(runtimeRoot, { recursive: true, force: true });
    }
    throw error;
  }
}

export async function runSchemaOriginDeploy({
  args,
  repo = moduleRoot,
  env = process.env,
  stdout = process.stdout,
  operations,
} = {}) {
  const options = parseSchemaOriginArgs(args);
  const ownsOperations = operations === undefined;
  const activeOperations =
    operations ?? createSchemaOriginOperations({ repo, env });
  try {
    let result;
    if (options.phase === "prepare") {
      result = await prepareSchemaOrigin(options, activeOperations, env);
    } else if (options.phase === "stage") {
      result = await stageSchemaOrigin(options, activeOperations, env);
    } else if (options.phase === "cutover") {
      result = await cutoverSchemaOrigin(options, activeOperations, env);
    } else if (options.phase === "prepare-activation") {
      result = await prepareSchemaOriginAuthorityActivation(
        options,
        activeOperations,
        env,
      );
    } else if (options.phase === "verify") {
      result = await verifySchemaOrigin(options, activeOperations, env);
    } else {
      result = await revertSchemaOrigin(options, activeOperations, env);
    }
    stdout.write(canonicalJSON(result));
    return result;
  } finally {
    if (ownsOperations && typeof activeOperations.cleanup === "function") {
      activeOperations.cleanup();
    }
  }
}

function failureRecord(error) {
  return {
    status: "blocked",
    phase: error instanceof SchemaOriginFailure ? error.phase : "argument",
    stage:
      error instanceof SchemaOriginFailure
        ? error.stage
        : "parse-or-bootstrap",
    repositoryStateTouched: false,
    repositoryStateIndeterminate: false,
    externalStateTouched:
      error instanceof SchemaOriginFailure
        ? error.externalStateTouched
        : false,
    externalStateIndeterminate:
      error instanceof SchemaOriginFailure
        ? error.externalStateIndeterminate
        : false,
    recoveryEvidence:
      error instanceof SchemaOriginFailure &&
      Array.isArray(error.recoveryEvidence)
        ? error.recoveryEvidence
        : [],
    automaticCleanupAttempted: false,
    blindRetryAllowed: false,
    message: error?.message ?? String(error),
  };
}

if (import.meta.main) {
  try {
    await runSchemaOriginDeploy({ args: process.argv.slice(2) });
  } catch (error) {
    process.stderr.write(canonicalJSON(failureRecord(error)));
    process.exitCode = 1;
  }
}
