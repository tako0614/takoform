#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const specificationLedgerPath = "release/specification-releases.json";
const schemaLedgerPath = "release/public-schema-identities.json";
const authorityPath = "release/specification-authority.json";
const prefixChainPath = "release/record-prefix-chain.json";
const recordHeadPath = "release/record-head.json";
const recordHeadSignaturePath = "release/record-head.sig.json";
const recordHeadPublicKeyPath = "release/authority/record-head-ed25519.pub.pem";
const writerClosureManifestPath =
  "release/authority/specification-writer-closure.json";
const recordHeadPublicKeySha256 =
  "sha256:a4f2a0811b8d9432a8d5ecea246f768470d78d0ed53214a587ba2f7c238e8cbb";
const trustProfilePath = "spec/trust/profile.json";
const extractedEvidence = Object.freeze({
  "docs/extraction/history/specification-compatibility.json": "2d65b2c0fe9d6ddfb8aa8866fb2e4946be5984402c7cbcf7a6a8f55b12d00faa",
  "docs/extraction/history/published-document-lanes.json": "f00211e3f0f943679e27976d2b9d06f96ea534eaeee80430b6e893b20d47dcb3",
  "docs/extraction/history/specification-1.1-publication-evidence.json": "6f2ba3d51261f2559d0738ed2b22f51d7066d4d5b9f9bf0213694f352b677a84",
  "docs/extraction/history/publication-blockers-v1beta1.json": "8bc708163e789b95833331a537abf1c455062179c0eef5b57c583c76b8d740e0",
  "docs/extraction/history/specification-1.1-publication-policy.md": "1828286b630758980a1a36c85321f7759c7134aeb05df0bba7953edfd942002c",
  "docs/extraction/history/w08-source-boundary-inventory.md": "f279a967a2d4435f8452fc2db548af93417a0a641f02fa2f68e8979550a95c70",
});

const specification11 = Object.freeze({
  sourceCommit: "00ae5ee4e2ea2eb62ea796499a93081374dc36b9",
  releaseCommit: "35c03a76326c808e859aa77172e086f15a2aeb5d",
  sourceSnapshotSha256: "sha256:23a9b14dc79f46fae632624fc5c442f947f63565e9d7f9d0a614598b5027ae03",
  sourceEvidenceSha256: "sha256:6f2ba3d51261f2559d0738ed2b22f51d7066d4d5b9f9bf0213694f352b677a84",
  tag: "specification/1.1",
  tagObject: "e2c1ba71766a6b25cae0826df99c8906a7f3f20b",
  releaseID: 377480828,
  releaseURL: "https://github.com/tako0614/terraform-provider-takoform/releases/tag/specification/1.1",
  assetName: "takoform-specification-1.1-source-snapshot.json",
  assetSourcePath: "spec/publication-evidence.json",
  assetSha256: "sha256:6f2ba3d51261f2559d0738ed2b22f51d7066d4d5b9f9bf0213694f352b677a84",
});

const specification11ReceiptObjectSha256 =
  "4ec0d0fe6e7defe60f7e1961dd25191fa052e08653e071a7ec0978dc080c6c44";

const importedSchemaPrefixes = Object.freeze({
  active: Object.freeze({
    count: 31,
    sha256: "e463f5d08bfaad90c800c9dab3587a61f37c768e5326f163cd7bea0d04132e68",
  }),
  retired: Object.freeze({
    count: 15,
    sha256: "32e6a5c2daaa9b03ff0c2f9b4a0a75da43b183afda2d964525695c514ce26201",
  }),
});

const futureSpecificationReceiptKeys = Object.freeze([
  "format",
  "version",
  "title",
  "track",
  "hostApiLane",
  "sourceCommit",
  "releaseCommit",
  "sourceSnapshotSha256",
  "schemaOriginCandidateSha256",
  "schemaReservationEntrySha256",
  "prerequisites",
  "hostApiEffect",
  "formPublicationEffect",
  "providerEffect",
  "tag",
  "tagObject",
  "annotatedTag",
  "signedTag",
  "tagProtectionRuleset",
  "release",
  "assets",
].sort());
const specificationTagRulesetKeys = Object.freeze([
  "id",
  "target",
  "enforcement",
  "bypassActors",
  "include",
  "exclude",
  "rules",
].sort());
const authorityRollback =
  "Before successor activation, abandon the prepared repository and leave the predecessor writer unchanged. After predecessor disablement, repair forward in the successor; never reopen the predecessor writer or recreate Specification 1.1.";

export const specificationWriterClosurePaths = Object.freeze([
  "bun.lock",
  "package.json",
  "release/authority/core-tag-allowed-signers",
  recordHeadPublicKeyPath,
  "release/authority/specification-schema-tool-closure.json",
  writerClosureManifestPath,
  "release/core-release-policy.md",
  "release/schema-origin-policy.md",
  "release/specification-release-policy.md",
  "schema-origin/wrangler.jsonc",
  "scripts/core-release.mjs",
  "scripts/deploy.mjs",
  "scripts/records.mjs",
  "scripts/schema-origin-deploy.mjs",
  "scripts/schema-origin-projection.mjs",
  "scripts/specification-release-adapter.mjs",
  "scripts/specification-release.mjs",
]);

const authorityKeys = Object.freeze([
  "format",
  "state",
  "predecessorRepository",
  "predecessorCutoffCommit",
  "predecessorCutoffTree",
  "successorRepository",
  "lastPredecessorSpecificationRelease",
  "predecessorTombstoneCommit",
  "successorPreparedCommit",
  "schemaRouteCutover",
  "predecessorWriterDisabledAt",
  "successorWriterEnabledAt",
  "writerOverlapAllowed",
  "rollback",
].sort());

const schemaRouteCutoverKeys = Object.freeze([
  "format",
  "sourceCommit",
  "predecessorTombstoneCommit",
  "candidateSha256",
  "stageRecordSha256",
  "cutoverRecordSha256",
  "predecessorReadbackSha256",
  "routeId",
  "routePattern",
  "worker",
  "versionId",
  "deploymentId",
  "completedReadbackAt",
  "freshReadbackAt",
  "closureSha256",
].sort());

const fullCommit = /^[0-9a-f]{40}$/u;
const sha256Digest = /^sha256:[0-9a-f]{64}$/u;
const cloudflareID = /^[0-9a-f]{32}$/u;
const canonicalUUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function objectSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function canonicalDigest(value) {
  return `sha256:${objectSha256(value)}`;
}

function rawSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function futureSpecificationReleaseBody(release) {
  const lines = [
    release?.title,
    "",
    `Normative commit: ${release?.sourceCommit}`,
    `Source snapshot: ${release?.sourceSnapshotSha256}`,
  ];
  if (release?.schemaOriginCandidateSha256 !== null) {
    lines.push(`Schema-origin candidate: ${release?.schemaOriginCandidateSha256}`);
  }
  lines.push(
    "",
    "The retained candidate is operator review evidence and is not a public Release asset.",
  );
  return lines.join("\n");
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

function exactKeys(value, expected) {
  return JSON.stringify(Object.keys(value ?? {}).sort()) === JSON.stringify([...expected].sort());
}

const proposalClassificationHeader =
  /^---\nclassification: non-normative-proposal\n---\n/u;
const mintedV2Patterns = Object.freeze([
  /(?:https:\/\/)?forms\.takoform\.com\/(?:[A-Za-z0-9._~-]+\/)*v2(?:[/."'`\s]|$)/iu,
  /\bspecification\/(?:v)?2(?:\.[0-9]+)?(?:[\s"'`/]|$)/iu,
  /takoform\.specification-release-receipt@v2(?:[.\s"'`]|$)/iu,
  /["']hostApiLane["']\s*:\s*["'][^"']*\/v2(?:[/."']|$)/iu,
  /["']track["']\s*:\s*["']specification-v2["']/iu,
  /["']tag["']\s*:\s*["']specification\/(?:v)?2(?:\.[0-9]+)?["']/iu,
]);

export function classifySpecificationPublicationSource(path, raw) {
  const bytes = Buffer.from(raw);
  const text = bytes.toString("utf8");
  const proposalPath = typeof path === "string" &&
    /^spec\/proposals\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md$/u.test(path);
  const classifiedProposal = proposalClassificationHeader.test(text);
  if (proposalPath !== classifiedProposal) {
    throw new Error(
      `${path}: v2 proposal material requires both spec/proposals/**.md and classification: non-normative-proposal`,
    );
  }
  if (!proposalPath) {
    if (typeof path !== "string" || !path.startsWith("spec/") ||
        /(?:^|\/)v2(?:[./_-]|$)/iu.test(path) &&
          (path.startsWith("spec/schemas/") || path.startsWith("spec/host-api/"))) {
      throw new Error(`${path}: normative v2 schema/Host path is forbidden`);
    }
    if (mintedV2Patterns.some((pattern) => pattern.test(text))) {
      throw new Error(
        `${path}: normative snapshot mints a forbidden v2 schema, Host lane, route, tag, receipt, or release identity`,
      );
    }
  }
  return proposalPath ? "non-normative-proposal" : "normative";
}

function canonicalInstant(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value.replace("Z", ".000Z");
}

function problem(list, message) {
  list.push(message);
}

export function validateSpecificationLedger(ledger) {
  const problems = [];
  if (ledger?.kind !== "takoform.specification-releases@v1") {
    problem(problems, "Specification ledger kind must remain takoform.specification-releases@v1");
  }
  const withdrawn = Array.isArray(ledger?.reserved)
    ? ledger.reserved.find((entry) => entry?.version === "1.0")
    : undefined;
  if (withdrawn?.status !== "withdrawn-retained" || withdrawn?.noReuse !== true) {
    problem(problems, "Specification 1.0 must remain withdrawn-retained and non-reusable");
  }
  if (!Array.isArray(ledger?.releases)) {
    problem(problems, "Specification releases must be an append-only array");
    return problems;
  }
  const versions = new Set();
  let expectedMinor = 1;
  for (const [index, release] of ledger.releases.entries()) {
    if (typeof release?.version !== "string" || versions.has(release.version)) {
      problem(problems, `Specification release version is missing or duplicated: ${release?.version}`);
    }
    versions.add(release?.version);
    if (release?.version === "1.0") problem(problems, "withdrawn Specification 1.0 was reused");
    const match = /^1\.([0-9]+)$/u.exec(release?.version ?? "");
    if (!match) {
      problem(problems, `Specification release ${release?.version} must stay on the contiguous 1.x minor line`);
    } else if (Number(match[1]) !== expectedMinor) {
      problem(problems, `Specification release ${release?.version} skips or reorders the next unused 1.x minor`);
    }
    expectedMinor += 1;
    if (release?.tag !== `specification/${release?.version}`) {
      problem(problems, `Specification ${release?.version} has a non-canonical tag`);
    }
    if (release?.hostApiEffect !== "none" || release?.formPublicationEffect !== "none" || release?.providerEffect !== "none") {
      problem(problems, `Specification ${release?.version} improperly advances another release axis`);
    }
    if (index > 0) {
      if (!exactKeys(release, futureSpecificationReceiptKeys)) {
        problem(problems, `Specification ${release?.version} future receipt has an unexpected field set`);
      }
      if (release?.format !== "takoform.specification-release-receipt@v1" ||
          release?.title !== `Takoform Specification ${release?.version}` ||
          release?.track !== "specification-v1" ||
          release?.hostApiLane !== "forms.takoform.com/v1") {
        problem(problems, `Specification ${release?.version} future receipt has an invalid identity envelope`);
      }
      if (!/^[0-9a-f]{40}$/u.test(release?.sourceCommit ?? "") ||
          !/^[0-9a-f]{40}$/u.test(release?.releaseCommit ?? "") ||
          release?.sourceCommit === release?.releaseCommit ||
          !/^[0-9a-f]{40}$/u.test(release?.tagObject ?? "")) {
        problem(problems, `Specification ${release?.version} future receipt has invalid N/E/tag commits`);
      }
      if (!sha256Digest.test(release?.sourceSnapshotSha256 ?? "")) {
        problem(problems, `Specification ${release?.version} future receipt has invalid sourceSnapshotSha256`);
      }
      const hasSchema = release?.schemaOriginCandidateSha256 !== null ||
        release?.schemaReservationEntrySha256 !== null;
      if (hasSchema &&
          (!sha256Digest.test(release?.schemaOriginCandidateSha256 ?? "") ||
            !sha256Digest.test(release?.schemaReservationEntrySha256 ?? ""))) {
        problem(problems, `Specification ${release?.version} future receipt has invalid optional schema closure`);
      }
      if (!hasSchema &&
          (release?.schemaOriginCandidateSha256 !== null ||
            release?.schemaReservationEntrySha256 !== null)) {
        problem(problems, `Specification ${release?.version} future receipt has a partial schema closure`);
      }
      const prerequisites = hasSchema
        ? ["specification-source-snapshot", "schema-origin-live-readback"]
        : ["specification-source-snapshot"];
      if (!sameJSON(release?.prerequisites, prerequisites) ||
          release?.annotatedTag !== true || release?.signedTag !== true) {
        problem(problems, `Specification ${release?.version} future receipt lacks exact prerequisites or signed tag closure`);
      }
      const ruleset = release?.tagProtectionRuleset;
      if (!exactKeys(ruleset, specificationTagRulesetKeys) ||
          !Number.isSafeInteger(ruleset?.id) || ruleset.id < 1 ||
          ruleset?.target !== "tag" || ruleset?.enforcement !== "active" ||
          !sameJSON(ruleset?.bypassActors, []) ||
          !sameJSON(ruleset?.include, ["refs/tags/specification/*"]) ||
          !sameJSON(ruleset?.exclude, []) ||
          !sameJSON(ruleset?.rules, ["deletion", "update"])) {
        problem(problems, `Specification ${release?.version} future receipt lacks the exact active no-bypass tag ruleset`);
      }
      if (!exactKeys(release?.release, [
        "id",
        "url",
        "bodySha256",
        "draft",
        "prerelease",
        "immutable",
      ]) ||
          !Number.isSafeInteger(release?.release?.id) || release.release.id < 1 ||
          release?.release?.url !==
            `https://github.com/tako0614/takoform/releases/tag/${release?.tag}` ||
          release?.release?.bodySha256 !==
            rawSha256(futureSpecificationReleaseBody(release)) ||
          release?.release?.draft !== false ||
          release?.release?.prerelease !== false ||
          release?.release?.immutable !== true ||
          !sameJSON(release?.assets, [])) {
        problem(problems, `Specification ${release?.version} future receipt lacks exact direct asset-free immutable Release closure`);
      }
    }
  }
  const release = ledger.releases.find((entry) => entry?.version === "1.1");
  if (!release) {
    problem(problems, "immutable Specification 1.1 receipt is missing");
    return problems;
  }
  const exact = {
    sourceCommit: release.sourceCommit,
    releaseCommit: release.releaseCommit,
    sourceSnapshotSha256: release.sourceSnapshotSha256,
    sourceEvidenceSha256: release.sourceEvidenceSha256,
    tag: release.tag,
    tagObject: release.tagObject,
    releaseID: release.release?.id,
    releaseURL: release.release?.url,
    assetName: release.assets?.[0]?.name,
    assetSourcePath: release.assets?.[0]?.sourcePath,
    assetSha256: release.assets?.[0]?.sha256,
  };
  for (const [field, expected] of Object.entries(specification11)) {
    if (exact[field] !== expected) problem(problems, `Specification 1.1 immutable ${field} changed`);
  }
  if (release.annotatedTag !== true || release.release?.immutable !== true || release.assets?.length !== 1) {
    problem(problems, "Specification 1.1 immutable tag/release/asset closure changed");
  }
  if (objectSha256(release) !== specification11ReceiptObjectSha256) {
    problem(problems, "Specification 1.1 immutable receipt object changed");
  }
  const serialized = JSON.stringify(ledger);
  if (serialized.includes("forms.takoform.com/v2")) {
    problem(problems, "Specification ledger contains a forbidden Host API v2 identity");
  }
  if (/forms\.takoform\.com\/(?:[^\s/?#]+\/)*v2(?:[/.]|")|specification\/(?:v)?2(?:[./]|")|"version":"2\./u.test(serialized)) {
    problem(problems, "Specification ledger contains a forbidden major-2 or Host API v2 identity");
  }
  return problems;
}

export function validateSchemaLedgerShape(ledger) {
  const problems = [];
  if (ledger?.kind !== "takoform.public-schema-identities@v1") {
    problem(problems, "schema ledger kind must remain takoform.public-schema-identities@v1");
  }
  const seenIDs = new Set();
  const seenSources = new Set();
  const seenPublicPaths = new Set();
  const seenDigests = new Set();
  for (const [state, entries] of [["active", ledger?.identities], ["verify-only", ledger?.retired]]) {
    if (!Array.isArray(entries)) {
      problem(problems, `${state} schema identities must be an array`);
      continue;
    }
    for (const entry of entries) {
      const expectedKeys = state === "active"
        ? ["id", "sha256", "source", "public"]
        : ["id", "sha256", "source", "public", "retiredBecause"];
      if (!exactKeys(entry, expectedKeys)) {
        problem(problems, `${state} schema ${entry?.id} has an unexpected field set`);
      }
      if (typeof entry?.id !== "string" || seenIDs.has(entry.id)) {
        problem(problems, `${state} schema id is missing or duplicated: ${entry?.id}`);
      }
      seenIDs.add(entry?.id);
      if (typeof entry?.source !== "string" || !entry.source.startsWith("spec/schemas/") || seenSources.has(entry.source)) {
        problem(problems, `${state} schema source is invalid or duplicated: ${entry?.source}`);
      }
      seenSources.add(entry?.source);
      if (typeof entry?.public !== "string" || entry.public === "" || seenPublicPaths.has(entry.public)) {
        problem(problems, `${state} schema public path is invalid or duplicated: ${entry?.public}`);
      }
      seenPublicPaths.add(entry?.public);
      if (!/^sha256:[0-9a-f]{64}$/u.test(entry?.sha256 ?? "")) {
        problem(problems, `${state} schema ${entry?.id} has a non-canonical digest`);
      } else if (seenDigests.has(entry.sha256)) {
        problem(problems, `${state} schema digest is duplicated: ${entry.sha256}`);
      }
      seenDigests.add(entry?.sha256);
      if (state === "verify-only" && typeof entry?.retiredBecause !== "string") {
        problem(problems, `verify-only schema ${entry?.id} lacks retirement evidence`);
      }
      if (/^https:\/\/forms\.takoform\.com\/(?:[^\s?#]*\/)?v2(?:[/.]|$)/u.test(entry?.id ?? "") ||
          /(?:^|[/_-])v2(?:[./_-]|$)/u.test(entry?.source ?? "") ||
          /(?:^|[/_-])v2(?:[./_-]|$)/u.test(entry?.public ?? "")) {
        problem(problems, `schema ledger contains a forbidden API v2 identity: ${entry.id}`);
      }
    }
  }
  for (const [field, baseline] of [["identities", importedSchemaPrefixes.active], ["retired", importedSchemaPrefixes.retired]]) {
    const entries = ledger?.[field];
    if (!Array.isArray(entries) || entries.length < baseline.count) {
      problem(problems, `imported schema ${field} prefix was removed`);
      continue;
    }
    if (objectSha256(entries.slice(0, baseline.count)) !== baseline.sha256) {
      problem(problems, `imported schema ${field} prefix changed or moved`);
    }
  }
  if (!Array.isArray(ledger?.retired) || ledger.retired.length !== importedSchemaPrefixes.retired.count) {
    problem(problems, "W10 schema retirement is frozen at the imported 15-entry verify-only prefix");
  }
  return problems;
}

export function validateRecordPrefixChain(chain, specificationLedger, schemaLedger) {
  const problems = [];
  if (chain?.kind !== "takoform.record-prefix-chain@v1") {
    problem(problems, "record prefix chain has an unknown kind");
  }

  const specificationSeals = chain?.specificationReleases;
  if (!Array.isArray(specificationSeals) || specificationSeals.length === 0) {
    problem(problems, "Specification release prefix chain must be non-empty");
  } else {
    let previous = null;
    let previousCount = 0;
    for (let index = 0; index < specificationSeals.length; index++) {
      const seal = specificationSeals[index];
      if (!exactKeys(seal, ["sequence", "releaseCount", "prefixSha256", "previousEntrySha256", "entrySha256"])) {
        problem(problems, `Specification prefix seal ${index + 1} has an unexpected field set`);
      }
      if (seal?.sequence !== index + 1) {
        problem(problems, `Specification prefix seal ${index + 1} has a non-contiguous sequence`);
      }
      if (!Number.isSafeInteger(seal?.releaseCount) || seal.releaseCount !== previousCount + 1) {
        problem(problems, `Specification prefix seal ${index + 1} does not extend the prior prefix`);
      }
      if (seal?.previousEntrySha256 !== (previous?.entrySha256 ?? null)) {
        problem(problems, `Specification prefix seal ${index + 1} breaks the hash chain`);
      }
      const unsigned = {
        sequence: seal?.sequence,
        releaseCount: seal?.releaseCount,
        prefixSha256: seal?.prefixSha256,
        previousEntrySha256: seal?.previousEntrySha256,
      };
      if (seal?.entrySha256 !== canonicalDigest(unsigned)) {
        problem(problems, `Specification prefix seal ${index + 1} has an invalid entry digest`);
      }
      const releases = specificationLedger?.releases;
      if (!Array.isArray(releases) || seal?.releaseCount > releases.length ||
          seal?.prefixSha256 !== canonicalDigest(releases.slice(0, seal?.releaseCount))) {
        problem(problems, `Specification prefix seal ${index + 1} no longer matches its recorded prefix`);
      }
      previous = seal;
      previousCount = seal?.releaseCount ?? previousCount;
    }
    if (specificationSeals[0]?.releaseCount !== 1 ||
        specificationSeals[0]?.entrySha256 !== "sha256:1dd8e2d031d68eab69e1e1d4baacb4e1af12b2bd889975fc1a36666ac73c31f7") {
      problem(problems, "Specification prefix chain changed its imported 1.1 genesis seal");
    }
    if (specificationSeals.at(-1)?.releaseCount !== specificationLedger?.releases?.length) {
      problem(problems, "Specification release ledger head is not sealed");
    }
  }

  const schemaSeals = chain?.publicSchemaIdentities;
  if (!Array.isArray(schemaSeals) || schemaSeals.length === 0) {
    problem(problems, "public schema prefix chain must be non-empty");
  } else {
    let previous = null;
    let previousTotal = 0;
    for (let index = 0; index < schemaSeals.length; index++) {
      const seal = schemaSeals[index];
      if (!exactKeys(seal, ["sequence", "activeCount", "verifyOnlyCount", "prefixSha256", "previousEntrySha256", "entrySha256"])) {
        problem(problems, `schema prefix seal ${index + 1} has an unexpected field set`);
      }
      if (seal?.sequence !== index + 1) {
        problem(problems, `schema prefix seal ${index + 1} has a non-contiguous sequence`);
      }
      const activeCount = seal?.activeCount;
      const verifyOnlyCount = seal?.verifyOnlyCount;
      const total = activeCount + verifyOnlyCount;
      if (!Number.isSafeInteger(activeCount) || !Number.isSafeInteger(verifyOnlyCount) ||
          (index > 0 && activeCount <= (previous?.activeCount ?? 0)) ||
          verifyOnlyCount !== importedSchemaPrefixes.retired.count ||
          (index > 0 && verifyOnlyCount !== previous?.verifyOnlyCount) ||
          total <= previousTotal) {
        problem(problems, `schema prefix seal ${index + 1} does not append to both prior prefixes`);
      }
      if (seal?.previousEntrySha256 !== (previous?.entrySha256 ?? null)) {
        problem(problems, `schema prefix seal ${index + 1} breaks the hash chain`);
      }
      const unsigned = {
        sequence: seal?.sequence,
        activeCount,
        verifyOnlyCount,
        prefixSha256: seal?.prefixSha256,
        previousEntrySha256: seal?.previousEntrySha256,
      };
      if (seal?.entrySha256 !== canonicalDigest(unsigned)) {
        problem(problems, `schema prefix seal ${index + 1} has an invalid entry digest`);
      }
      const identities = schemaLedger?.identities;
      const retired = schemaLedger?.retired;
      const prefix = {
        identities: Array.isArray(identities) ? identities.slice(0, activeCount) : [],
        retired: Array.isArray(retired) ? retired.slice(0, verifyOnlyCount) : [],
      };
      if (!Array.isArray(identities) || !Array.isArray(retired) || activeCount > identities.length ||
          verifyOnlyCount > retired.length || seal?.prefixSha256 !== canonicalDigest(prefix)) {
        problem(problems, `schema prefix seal ${index + 1} no longer matches its recorded prefixes`);
      }
      previous = seal;
      previousTotal = total;
    }
    if (schemaSeals[0]?.activeCount !== importedSchemaPrefixes.active.count ||
        schemaSeals[0]?.verifyOnlyCount !== importedSchemaPrefixes.retired.count ||
        schemaSeals[0]?.entrySha256 !== "sha256:17cd0076bea0a95260f721d64b57fc4dbe91b4e8224bd752b0bb25b2cbc57558") {
      problem(problems, "schema prefix chain changed its imported genesis seal");
    }
    if (schemaSeals.at(-1)?.activeCount !== schemaLedger?.identities?.length ||
        schemaSeals.at(-1)?.verifyOnlyCount !== schemaLedger?.retired?.length) {
      problem(problems, "public schema identity ledger head is not sealed");
    }
  }
  return problems;
}

export function validateRecordHead(headRaw, signature, publicKeyPEM, chain) {
  const problems = [];
  let head;
  try {
    head = JSON.parse(Buffer.from(headRaw).toString("utf8"));
  } catch (error) {
    return [`record head is not JSON: ${error.message}`];
  }
  if (!exactKeys(head, ["kind", "generation", "specificationReleases", "publicSchemaIdentities", "previousHeadSha256"]) ||
      head?.kind !== "takoform.record-head@v1" || !Number.isSafeInteger(head?.generation) || head.generation < 1) {
    problem(problems, "record head has an invalid closed envelope");
  }
  if (!exactKeys(head?.specificationReleases, ["sequence", "releaseCount", "entrySha256"]) ||
      !exactKeys(head?.publicSchemaIdentities, ["sequence", "activeCount", "verifyOnlyCount", "entrySha256"])) {
    problem(problems, "record head has an invalid closed ledger reference");
  }
  if (head?.generation === 1) {
    if (head?.previousHeadSha256 !== null) problem(problems, "record head genesis must not name a predecessor");
  } else if (!/^sha256:[0-9a-f]{64}$/u.test(head?.previousHeadSha256 ?? "")) {
    problem(problems, "record head extension must name the exact prior signed head");
  }

  const specificationSeal = chain?.specificationReleases?.at(-1);
  const schemaSeal = chain?.publicSchemaIdentities?.at(-1);
  if (head?.specificationReleases?.sequence !== specificationSeal?.sequence ||
      head?.specificationReleases?.releaseCount !== specificationSeal?.releaseCount ||
      head?.specificationReleases?.entrySha256 !== specificationSeal?.entrySha256) {
    problem(problems, "signed record head does not close the current Specification prefix seal");
  }
  if (head?.publicSchemaIdentities?.sequence !== schemaSeal?.sequence ||
      head?.publicSchemaIdentities?.activeCount !== schemaSeal?.activeCount ||
      head?.publicSchemaIdentities?.verifyOnlyCount !== schemaSeal?.verifyOnlyCount ||
      head?.publicSchemaIdentities?.entrySha256 !== schemaSeal?.entrySha256) {
    problem(problems, "signed record head does not close the current schema prefix seal");
  }
  const expectedGeneration =
    (Array.isArray(chain?.specificationReleases) ? chain.specificationReleases.length : 0) +
    (Array.isArray(chain?.publicSchemaIdentities) ? chain.publicSchemaIdentities.length : 0) -
    1;
  if (head?.generation !== expectedGeneration) {
    problem(problems, "signed record head generation must equal the exact append order of both prefix histories");
  }

  if (!exactKeys(signature, ["kind", "algorithm", "publicKeySha256", "subject", "subjectSha256", "signature"]) ||
      signature?.kind !== "takoform.record-head-signature@v1" || signature?.algorithm !== "ed25519" ||
      signature?.subject !== recordHeadPath) {
    problem(problems, "record head signature has an invalid closed envelope");
  }
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPEM);
    const publicDER = publicKey.export({ type: "spki", format: "der" });
    const digest = `sha256:${createHash("sha256").update(publicDER).digest("hex")}`;
    if (digest !== recordHeadPublicKeySha256 || signature?.publicKeySha256 !== digest) {
      problem(problems, "record head public key differs from the independently retained authority key");
    }
  } catch (error) {
    problem(problems, `record head public key is invalid: ${error.message}`);
  }
  const subjectDigest = `sha256:${createHash("sha256").update(headRaw).digest("hex")}`;
  if (signature?.subjectSha256 !== subjectDigest) {
    problem(problems, "record head signature names different subject bytes");
  }
  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature?.signature ?? "", "base64");
    if (signatureBytes.length !== 64 || signatureBytes.toString("base64") !== signature?.signature) {
      throw new Error("signature is not canonical 64-byte base64");
    }
  } catch (error) {
    problem(problems, `record head signature bytes are invalid: ${error.message}`);
  }
  if (publicKey && signatureBytes?.length === 64 && !verify(null, headRaw, publicKey, signatureBytes)) {
    problem(problems, "record head signature is invalid");
  }
  return problems;
}

export function validateAuthorityTransfer(authority) {
  const problems = [];
  const keys = Object.keys(authority ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(authorityKeys)) {
    problem(problems, "Specification authority receipt has an unexpected field set");
  }
  if (authority?.format !== "takoform.specification-authority-transfer@v1") {
    problem(problems, "Specification authority receipt has an unknown format");
  }
  if (authority?.writerOverlapAllowed !== false) {
    problem(problems, "Specification authority receipt must forbid writer overlap");
  }
  if (authority?.rollback !== authorityRollback) {
    problem(problems, "Specification authority rollback must remain forward-only and must never reopen the predecessor");
  }
  if (authority?.predecessorCutoffCommit !== "1fa34160a4ed152443b4ea424a324f7677716e36" ||
      authority?.predecessorCutoffTree !== "7e4a2578af2f50b826fba1004fdd4e430c761314") {
    problem(problems, "Specification authority receipt changed the W09 cutoff identity");
  }
  if (authority?.predecessorRepository !== "https://github.com/tako0614/terraform-provider-takoform.git" ||
      authority?.successorRepository !== "https://github.com/tako0614/takoform.git") {
    problem(problems, "Specification authority receipt changed predecessor or successor repository identity");
  }
  if (authority?.lastPredecessorSpecificationRelease?.version !== "1.1" ||
      authority?.lastPredecessorSpecificationRelease?.tag !== specification11.tag ||
      Object.keys(authority?.lastPredecessorSpecificationRelease ?? {}).sort().join(",") !== "releaseId,tag,tagObject,version") {
    problem(problems, "Specification authority receipt changed the last predecessor release shape");
  }
  if (authority?.lastPredecessorSpecificationRelease?.tagObject !== specification11.tagObject ||
      authority?.lastPredecessorSpecificationRelease?.releaseId !== specification11.releaseID) {
    problem(problems, "Specification authority receipt changed the last predecessor release");
  }
  if (authority?.state === "prepared-writer-disabled") {
    if (authority.successorPreparedCommit !== null &&
        !fullCommit.test(authority.successorPreparedCommit ?? "")) {
      problem(problems, "prepared authority receipt successorPreparedCommit must be null or a full commit");
    }
    for (const field of [
      "predecessorTombstoneCommit",
      "schemaRouteCutover",
      "predecessorWriterDisabledAt",
      "successorWriterEnabledAt",
    ]) {
      if (authority[field] !== null) problem(problems, `prepared authority receipt must leave ${field} null`);
    }
  } else if (authority?.state === "successor-active") {
    for (const field of ["predecessorTombstoneCommit", "successorPreparedCommit"]) {
      if (!fullCommit.test(authority[field] ?? "")) {
        problem(problems, `active authority receipt requires a full commit for ${field}`);
      }
    }
    for (const field of ["predecessorWriterDisabledAt", "successorWriterEnabledAt"]) {
      if (!canonicalInstant(authority[field])) {
        problem(problems, `active authority receipt requires a canonical UTC instant for ${field}`);
      }
    }
    if (canonicalInstant(authority.predecessorWriterDisabledAt) &&
        canonicalInstant(authority.successorWriterEnabledAt) &&
        Date.parse(authority.predecessorWriterDisabledAt) >= Date.parse(authority.successorWriterEnabledAt)) {
      problem(problems, "successor writer was not enabled strictly after predecessor disablement");
    }
    const cutover = authority.schemaRouteCutover;
    if (!exactKeys(cutover, schemaRouteCutoverKeys) ||
        cutover?.format !== "takoform.schema-origin-authority-cutover@v1" ||
        !fullCommit.test(cutover?.sourceCommit ?? "") ||
        cutover?.predecessorTombstoneCommit !== authority.predecessorTombstoneCommit ||
        !sha256Digest.test(cutover?.candidateSha256 ?? "") ||
        !sha256Digest.test(cutover?.stageRecordSha256 ?? "") ||
        !sha256Digest.test(cutover?.cutoverRecordSha256 ?? "") ||
        !sha256Digest.test(cutover?.predecessorReadbackSha256 ?? "") ||
        !cloudflareID.test(cutover?.routeId ?? "") ||
        cutover?.routePattern !== "forms.takoform.com/schemas/*" ||
        cutover?.worker !== "takoform-schema-origin" ||
        !canonicalUUID.test(cutover?.versionId ?? "") ||
        !canonicalUUID.test(cutover?.deploymentId ?? "") ||
        !canonicalInstant(cutover?.completedReadbackAt) ||
        !canonicalInstant(cutover?.freshReadbackAt) ||
        cutover?.closureSha256 !== schemaRouteCutoverClosureSha256(cutover)) {
      problem(problems, "active authority receipt has an invalid schema-route cutover closure");
    }
    if (canonicalInstant(authority.predecessorWriterDisabledAt) &&
        canonicalInstant(cutover?.completedReadbackAt) &&
        Date.parse(cutover.completedReadbackAt) <=
          Date.parse(authority.predecessorWriterDisabledAt)) {
      problem(problems, "schema-route completed readback must be strictly after predecessor disablement");
    }
    if (canonicalInstant(cutover?.completedReadbackAt) &&
        canonicalInstant(cutover?.freshReadbackAt) &&
        Date.parse(cutover.freshReadbackAt) <=
          Date.parse(cutover.completedReadbackAt)) {
      problem(problems, "schema-route fresh readback must be strictly after completed cutover readback");
    }
    if (canonicalInstant(cutover?.freshReadbackAt) &&
        canonicalInstant(authority.successorWriterEnabledAt) &&
        Date.parse(authority.successorWriterEnabledAt) <=
          Date.parse(cutover.freshReadbackAt)) {
      problem(problems, "successor writer must be enabled strictly after the fresh schema-route readback");
    }
  } else {
    problem(problems, `unknown Specification authority state: ${authority?.state}`);
  }
  return problems;
}

function sameJSON(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactPathSet(paths, expected) {
  return Array.isArray(paths) &&
    sameJSON([...paths].sort(), [...expected].sort()) &&
    new Set(paths).size === paths.length;
}

function authorityWithPreparedCommit(authority, successorPreparedCommit) {
  return { ...structuredClone(authority), successorPreparedCommit };
}

export function deriveSuccessorActivationCommit(history) {
  if (!Array.isArray(history)) return null;
  let previousState = null;
  for (const entry of history) {
    const state = entry?.authority?.state;
    if (state === "successor-active" && previousState !== "successor-active") {
      return /^[0-9a-f]{40}$/u.test(entry?.commit ?? "") ? entry.commit : null;
    }
    previousState = state;
  }
  return null;
}

// Pure validation of the local P0 -> P -> A history. P0 contains the reviewed
// dormant implementation and null preparation/cutover receipts. Its direct
// authority-only child P records P0, avoiding any self-referential commit. The
// route cutover is external evidence, not a fake Git commit. Direct
// authority-only child A is the first prepared-to-active transition.
export function validateAuthorityTransferHistory(
  history,
  { predecessorTombstone = null } = {},
) {
  const problems = [];
  if (!Array.isArray(history) || history.length === 0) return problems;
  for (const [index, entry] of history.entries()) {
    if (!fullCommit.test(entry?.commit ?? "")) {
      problem(problems, `Specification authority history entry ${index + 1} has an invalid commit`);
      continue;
    }
    problems.push(...validateAuthorityTransfer(entry.authority));
  }

  const p0 = history[0];
  if (p0?.authority?.state !== "prepared-writer-disabled" ||
      p0?.authority?.successorPreparedCommit !== null ||
      p0?.authority?.schemaRouteCutover !== null) {
    problem(problems, "authority history must begin with one dormant implementation P0");
  }
  if (history.length >= 2) {
    const p = history[1];
    if (p?.authority?.state !== "prepared-writer-disabled" ||
        !Array.isArray(p?.parents) || p.parents.length !== 1 ||
        p.parents[0] !== p0?.commit ||
        p?.authority?.successorPreparedCommit !== p0?.commit) {
      problem(problems, "prepared authority receipt must pin its direct P0 parent");
    }
    if (!exactPathSet(p?.changedPaths, [authorityPath])) {
      problem(problems, "prepared authority receipt P must change only release/specification-authority.json");
    }
    if (!sameJSON(
      p?.authority,
      authorityWithPreparedCommit(p0?.authority, p0?.commit),
    )) {
      problem(problems, "prepared authority receipt P may change only successorPreparedCommit");
    }
  }
  if (history.length >= 3) {
    const p = history[1];
    const activation = history[2];
    const cutover = activation?.authority?.schemaRouteCutover;
    if (activation?.authority?.state !== "successor-active" ||
        !Array.isArray(activation?.parents) || activation.parents.length !== 1 ||
        activation.parents[0] !== p?.commit) {
      problem(problems, "successor activation A must be the direct authority-only child of P");
    }
    if (!exactPathSet(activation?.changedPaths, [authorityPath])) {
      problem(problems, "successor activation A must change only release/specification-authority.json");
    }
    if (activation?.authority?.successorPreparedCommit !== p0?.commit) {
      problem(problems, "successor activation must preserve P's exact P0 preparation pin");
    }
    if (cutover?.sourceCommit !== p?.commit) {
      problem(problems, "schema-route cutover must name the exact prepared receipt P as its source");
    }
    if (predecessorTombstone === null) {
      problem(problems, "successor activation history requires exact predecessor tombstone evidence");
    } else {
      if (predecessorTombstone?.commit !==
          activation?.authority?.predecessorTombstoneCommit) {
        problem(problems, "active authority receipt must name the exact predecessor tombstone");
      }
      if (predecessorTombstone?.pinsSuccessorCommit !== p?.commit) {
        problem(problems, "predecessor tombstone must pin the exact prepared receipt P");
      }
      if (predecessorTombstone?.readbackSha256 !==
          cutover?.predecessorReadbackSha256) {
        problem(problems, "schema-route cutover must pin the exact predecessor tombstone readback");
      }
    }
    const expectedActive = {
      ...structuredClone(p?.authority),
      state: "successor-active",
      predecessorTombstoneCommit:
        activation?.authority?.predecessorTombstoneCommit,
      schemaRouteCutover: structuredClone(cutover),
      predecessorWriterDisabledAt:
        activation?.authority?.predecessorWriterDisabledAt,
      successorWriterEnabledAt:
        activation?.authority?.successorWriterEnabledAt,
    };
    if (!sameJSON(activation?.authority, expectedActive)) {
      problem(problems, "successor activation A may change only the exact cutover authority fields");
    }
  }
  if (history.length > 3) {
    if (history.slice(3).some((entry) =>
      entry?.authority?.state === "prepared-writer-disabled")) {
      problem(problems, "Specification writer authority must never reopen after successor activation");
    }
    problem(problems, "Specification authority history must contain only P0, P, and A");
  }
  return [...new Set(problems)];
}

export function validateSpecificationWriterSurface(
  authority,
  { files, source, adapterSource, deploySource },
) {
  const problems = [];
  const required = [
    ...specificationWriterClosurePaths,
    "scripts/specification-release.test.mjs",
    "scripts/specification-release-adapter.test.mjs",
  ];
  for (const path of required) {
    if (!(files instanceof Set) || !files.has(path)) {
      problem(problems, `local dormant Specification writer surface is missing ${path}`);
    }
  }
  if (files instanceof Set && files.has(".github/workflows/specification-release.yml")) {
    problem(problems, "Specification publication must not have a CI/workflow writer");
  }
  if (typeof source !== "string" ||
      !source.includes("DORMANT_WRITER_GUARD") ||
      !source.includes("prepared-writer-disabled")) {
    problem(problems, "local Specification writer lacks its explicit dormant authority guard");
  }
  for (const phase of ["reserve", "prepare", "publish", "recover", "record", "verify"]) {
    if (typeof source !== "string" || !source.includes(`export async function ${phase}`)) {
      problem(problems, `local Specification writer lacks exported ${phase} orchestration`);
    }
  }
  for (const phase of [
    "applySchemaReservation",
    "sealRecordArtifact",
    "prepareReceipt",
  ]) {
    if (typeof source !== "string" ||
        !source.includes(`export async function ${phase}`)) {
      problem(problems, `local Specification writer lacks exported ${phase} phase`);
    }
  }
  for (const phase of [
    "reserve",
    "applySchemaReservation",
    "sealRecordArtifact",
    "prepare",
    "publish",
    "recover",
    "prepareReceipt",
    "record",
  ]) {
    const guardedEntry = new RegExp(
      `export\\s+async\\s+function\\s+${phase}\\s*\\([^)]*\\)\\s*\\{\\s*assertMutationAuthority\\(`,
      "u",
    );
    if (typeof source !== "string" || !guardedEntry.test(source)) {
      problem(
        problems,
        `local Specification writer ${phase} entry does not begin with the dormant authority guard`,
      );
    }
  }
  if (typeof source === "string" && /(?:from|import)\s*[('"].*deploy\.mjs/u.test(source)) {
    problem(problems, "local Specification writer must not import scripts/deploy.mjs");
  }
  if (typeof adapterSource !== "string" ||
      !adapterSource.includes("createSpecificationReleaseOperations") ||
      !adapterSource.includes("verifyIndependentReview") ||
      !adapterSource.includes("verifySourcePinnedExecution") ||
      !adapterSource.includes("verifySpecificationSourceSnapshot") ||
      !adapterSource.includes("readSchemaVerificationState") ||
      !adapterSource.includes("prepareSchemaToolClosure") ||
      !adapterSource.includes("tryRecordSpecificationReceipt") ||
      !adapterSource.includes("acquireTagProtectionAuditToken") ||
      !adapterSource.includes("verifyTagProtectionRuleset") ||
      !adapterSource.includes("createImmutableRelease")) {
    problem(problems, "dormant Specification production adapter lacks its complete reviewed operation surface");
  }
  if (typeof deploySource !== "string" ||
      !deploySource.includes("createSpecificationReleaseOperations") ||
      !deploySource.includes("specification-release")) {
    problem(problems, "owning scripts/deploy.mjs does not wire the dormant Specification release surface");
  }
  if (!["prepared-writer-disabled", "successor-active"].includes(authority?.state)) {
    problem(problems, "local Specification writer surface has an unknown authority state");
  }
  return problems;
}

export function validateSpecificationWriterClosureManifest(manifest) {
  const problems = [];
  if (!exactKeys(manifest, ["format", "paths"]) ||
      manifest?.format !== "takoform.specification-writer-closure@v1" ||
      !Array.isArray(manifest?.paths) ||
      new Set(manifest.paths).size !== manifest.paths.length ||
      !sameJSON(manifest.paths, specificationWriterClosurePaths)) {
    problem(
      problems,
      "Specification writer closure manifest must name the exact ordered P0 transitive closure",
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
  if (policy?.callerSupplied !== true ||
      JSON.stringify(fields) !== JSON.stringify(["oidcIssuer", "ref", "sourceRepository", "workflow"])) {
    problem(problems, "Core trust profile must require the complete caller-supplied publisher policy");
  }
  for (const field of ["publisherClassField", "officialTrustBypass", "defaultPublisher"]) {
    if (policy?.[field] !== false) problem(problems, `Core trust profile must set ${field} to false`);
  }
  if (profile?.signature?.ambientTrustedRoot !== false || profile?.signature?.offlineVerification !== true) {
    problem(problems, "Core trust profile must use explicit offline trust inputs without an ambient root");
  }
  const serialized = JSON.stringify(profile);
  if (serialized.includes("terraform-provider-takoform") || serialized.includes("registry.terraform.io")) {
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

async function specificationPublicationFiles(root, relative = "spec") {
  const directory = resolve(root, relative);
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`Specification source tree contains a symlink: ${path}`);
    }
    if (entry.isDirectory()) {
      result.push(...await specificationPublicationFiles(root, path));
    } else if (entry.isFile()) {
      result.push(path);
    } else {
      throw new Error(`Specification source tree contains a special file: ${path}`);
    }
  }
  return result.sort();
}

function readGit(root, args, { bytes = false } = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: bytes ? null : "utf8",
    env: {
      PATH: process.env.PATH,
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitLines(value) {
  const trimmed = String(value).trim();
  return trimmed === "" ? [] : trimmed.split("\n");
}

function validateCommittedSpecificationWriterSurface(
  repositoryRoot,
  commit,
  authority,
) {
  const problems = [];
  const inspected = [
    ...specificationWriterClosurePaths,
    "scripts/specification-release.test.mjs",
    "scripts/specification-release-adapter.test.mjs",
    ".github/workflows/specification-release.yml",
  ];
  const files = new Set();
  for (const path of inspected) {
    const entry = readGit(repositoryRoot, [
      "ls-tree",
      commit,
      "--",
      path,
    ]).trim();
    if (entry === "") continue;
    const match = /^(100644|100755) blob [0-9a-f]{40,64}\t(.+)$/u.exec(entry);
    if (match === null || match[2] !== path) {
      problem(
        problems,
        `P0 Specification writer surface is not one ordinary committed file: ${path}`,
      );
      continue;
    }
    files.add(path);
  }
  let source = "";
  let adapterSource = "";
  let deploySource = "";
  try {
    const manifest = JSON.parse(readGit(repositoryRoot, [
      "show",
      `${commit}:${writerClosureManifestPath}`,
    ]));
    problems.push(...validateSpecificationWriterClosureManifest(manifest).map(
      (message) => `committed P0: ${message}`,
    ));
    source = readGit(repositoryRoot, [
      "show",
      `${commit}:scripts/specification-release.mjs`,
    ]);
    adapterSource = readGit(repositoryRoot, [
      "show",
      `${commit}:scripts/specification-release-adapter.mjs`,
    ]);
    deploySource = readGit(repositoryRoot, [
      "show",
      `${commit}:scripts/deploy.mjs`,
    ]);
  } catch (error) {
    problem(
      problems,
      `cannot read committed P0 Specification writer surface: ${error.message}`,
    );
  }
  problems.push(...validateSpecificationWriterSurface(authority, {
    files,
    source,
    adapterSource,
    deploySource,
  }).map((message) => `committed P0: ${message}`));
  return problems;
}

export function validateRepositoryAuthorityHistory(root, currentAuthority) {
  const problems = [];
  let repositoryRoot;
  try {
    repositoryRoot = realpathSync(
      readGit(root, ["rev-parse", "--show-toplevel"]).trim(),
    );
    if (repositoryRoot !== realpathSync(resolve(root))) {
      return ["Specification authority history must be read from the exact repository root"];
    }
    if (readGit(repositoryRoot, ["rev-parse", "--is-shallow-repository"]).trim() !== "false" ||
        readGit(repositoryRoot, ["replace", "-l"]).trim() !== "") {
      return ["Specification authority history requires a complete repository without replacement objects"];
    }
  } catch (error) {
    return [`cannot establish committed Specification authority history: ${error.message}`];
  }

  const status = readGit(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    authorityPath,
  ]).trim();
  if (status !== "") {
    problem(problems, "working-tree Specification authority differs from committed HEAD");
  }

  let headCommit;
  let headAuthorityRaw;
  let commits;
  try {
    headCommit = readGit(repositoryRoot, ["rev-parse", "HEAD"]).trim();
    if (!fullCommit.test(headCommit)) throw new Error("HEAD is not one full commit");
    headAuthorityRaw = readGit(
      repositoryRoot,
      ["show", `HEAD:${authorityPath}`],
      { bytes: true },
    );
    commits = gitLines(readGit(repositoryRoot, [
      "log",
      "--first-parent",
      "--reverse",
      "--format=%H",
      "--",
      authorityPath,
    ]));
  } catch (error) {
    problem(
      problems,
      `Specification authority P0 must be committed before record validation: ${error.message}`,
    );
    return [...new Set(problems)];
  }
  let committedHeadAuthority;
  try {
    committedHeadAuthority = JSON.parse(headAuthorityRaw.toString("utf8"));
  } catch (error) {
    problem(problems, `committed HEAD authority is invalid JSON: ${error.message}`);
    return [...new Set(problems)];
  }
  if (!sameJSON(currentAuthority, committedHeadAuthority)) {
    problem(problems, "working-tree Specification authority object differs from committed HEAD");
  }
  if (commits.length === 0 || commits.some((commit) => !fullCommit.test(commit))) {
    problem(problems, "committed Specification authority history is absent or malformed");
    return [...new Set(problems)];
  }

  const history = [];
  for (const commit of commits) {
    try {
      const parentLine = readGit(repositoryRoot, [
        "rev-list",
        "--parents",
        "-n",
        "1",
        commit,
      ]).trim().split(/\s+/u);
      if (parentLine[0] !== commit ||
          parentLine.slice(1).some((parent) => !fullCommit.test(parent))) {
        throw new Error("commit parents are malformed");
      }
      const changedPaths = gitLines(readGit(repositoryRoot, [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-only",
        "-r",
        "--no-renames",
        commit,
        "--",
      ]));
      const authority = JSON.parse(readGit(
        repositoryRoot,
        ["show", `${commit}:${authorityPath}`],
      ));
      history.push({
        commit,
        parents: parentLine.slice(1),
        changedPaths,
        authority,
      });
    } catch (error) {
      problem(problems, `cannot close authority commit ${commit}: ${error.message}`);
    }
  }
  if (history.length !== commits.length) return [...new Set(problems)];
  problems.push(...validateCommittedSpecificationWriterSurface(
    repositoryRoot,
    history[0].commit,
    history[0].authority,
  ));
  const latest = history.at(-1);
  if (!sameJSON(latest.authority, committedHeadAuthority)) {
    problem(problems, "committed HEAD authority differs from the latest authority history entry");
  }
  if (currentAuthority?.state === "prepared-writer-disabled" &&
      headCommit !== latest.commit) {
    problem(problems, "prepared authority HEAD must remain the exact P0 or P commit until activation A");
  }
  const predecessorTombstone = currentAuthority?.state === "successor-active"
    ? {
        commit: currentAuthority.predecessorTombstoneCommit,
        pinsSuccessorCommit: currentAuthority.schemaRouteCutover?.sourceCommit,
        readbackSha256:
          currentAuthority.schemaRouteCutover?.predecessorReadbackSha256,
      }
    : null;
  problems.push(...validateAuthorityTransferHistory(history, {
    predecessorTombstone,
  }));
  return [...new Set(problems)];
}

export async function validateRepositoryRecords(
  root = ".",
  {
    authorityHistoryValidator = validateRepositoryAuthorityHistory,
  } = {},
) {
  const problems = [];
  const absoluteRoot = await realpath(resolve(root));
  const specificationLedger = JSON.parse(await readFile(resolve(absoluteRoot, specificationLedgerPath), "utf8"));
  const schemaLedger = JSON.parse(await readFile(resolve(absoluteRoot, schemaLedgerPath), "utf8"));
  const prefixChain = JSON.parse(await readFile(resolve(absoluteRoot, prefixChainPath), "utf8"));
  const recordHeadRaw = await readFile(resolve(absoluteRoot, recordHeadPath));
  const recordHeadSignature = JSON.parse(await readFile(resolve(absoluteRoot, recordHeadSignaturePath), "utf8"));
  const recordHeadPublicKey = await readFile(resolve(absoluteRoot, recordHeadPublicKeyPath), "utf8");
  const authority = JSON.parse(await readFile(resolve(absoluteRoot, authorityPath), "utf8"));
  const writerClosureManifest = JSON.parse(await readFile(
    resolve(absoluteRoot, writerClosureManifestPath),
    "utf8",
  ));
  const trustProfile = JSON.parse(await readFile(resolve(absoluteRoot, trustProfilePath), "utf8"));
  problems.push(...validateSpecificationLedger(specificationLedger));
  problems.push(...validateSchemaLedgerShape(schemaLedger));
  problems.push(...validateRecordPrefixChain(prefixChain, specificationLedger, schemaLedger));
  problems.push(...validateRecordHead(recordHeadRaw, recordHeadSignature, recordHeadPublicKey, prefixChain));
  problems.push(...validateAuthorityTransfer(authority));
  problems.push(...validateSpecificationWriterClosureManifest(
    writerClosureManifest,
  ));
  problems.push(...authorityHistoryValidator(absoluteRoot, authority));
  problems.push(...validateTrustProfile(trustProfile));
  try {
    for (const path of await specificationPublicationFiles(absoluteRoot)) {
      classifySpecificationPublicationSource(
        path,
        await readFile(resolve(absoluteRoot, path)),
      );
    }
  } catch (error) {
    problem(problems, error.message);
  }
  const writerSurfaceFiles = new Set();
  for (const path of [
    ...specificationWriterClosurePaths,
    "scripts/specification-release.test.mjs",
    "scripts/specification-release-adapter.test.mjs",
    ".github/workflows/specification-release.yml",
  ]) {
    const absolute = resolve(absoluteRoot, path);
    try {
      const info = await stat(absolute);
      if (!info.isFile() || await realpath(absolute) !== absolute) {
        problem(problems, `Specification writer surface must be one ordinary file: ${path}`);
      } else {
        writerSurfaceFiles.add(path);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  let writerSource = "";
  let adapterSource = "";
  let deploySource = "";
  try {
    writerSource = await readFile(
      resolve(absoluteRoot, "scripts/specification-release.mjs"),
      "utf8",
    );
  } catch (error) {
    problem(problems, `cannot read local Specification writer: ${error.message}`);
  }
  try {
    adapterSource = await readFile(
      resolve(absoluteRoot, "scripts/specification-release-adapter.mjs"),
      "utf8",
    );
    deploySource = await readFile(
      resolve(absoluteRoot, "scripts/deploy.mjs"),
      "utf8",
    );
  } catch (error) {
    problem(problems, `cannot read dormant Specification adapter/deploy wiring: ${error.message}`);
  }
  problems.push(...validateSpecificationWriterSurface(authority, {
    files: writerSurfaceFiles,
    source: writerSource,
    adapterSource,
    deploySource,
  }));
  try {
    await stat(resolve(absoluteRoot, "release/trust/trusted-root.json"));
    problem(problems, "Core release authority must not install an ambient publisher trusted root");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const entries = [...(schemaLedger.identities ?? []), ...(schemaLedger.retired ?? [])];
  const ledgerSources = new Set(entries.map((entry) => entry.source));
  for (const source of await schemaFiles(absoluteRoot)) {
    if (!ledgerSources.has(source)) problem(problems, `unrecorded public schema source: ${source}`);
  }
  for (const entry of entries) {
    const path = resolve(absoluteRoot, entry.source ?? "");
    try {
      const resolved = await realpath(path);
      const info = await stat(path);
      if (resolved !== path || !resolved.startsWith(absoluteRoot + sep) || !info.isFile()) {
        problem(problems, `schema source must be one ordinary in-repository file: ${entry.source}`);
        continue;
      }
      const raw = await readFile(path);
      const digest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
      if (digest !== entry.sha256) problem(problems, `schema digest changed for ${entry.source}`);
      const schema = JSON.parse(raw.toString("utf8"));
      if (schema.$id !== entry.id) problem(problems, `schema $id differs from ledger for ${entry.source}`);
    } catch (error) {
      problem(problems, `cannot validate schema source ${entry.source}: ${error.message}`);
    }
  }
  for (const [path, expected] of Object.entries(extractedEvidence)) {
    try {
      const raw = await readFile(resolve(absoluteRoot, path));
      const digest = createHash("sha256").update(raw).digest("hex");
      if (digest !== expected) problem(problems, `immutable extracted evidence changed: ${path}`);
    } catch (error) {
      problem(problems, `cannot validate extracted evidence ${path}: ${error.message}`);
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
  console.log("records: Specification receipt and schema identities are closed");
}

if (import.meta.main) await main();
