#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

const paths = Object.freeze({
  specificationLedger: "release/specification-releases.json",
  schemaLedger: "release/public-schema-identities.json",
  combinedPrefixChain: "release/record-prefix-chain.json",
  combinedHead: "release/record-head.json",
  combinedHeadSignature: "release/record-head.sig.json",
  combinedHeadPublicKey: "release/authority/record-head-ed25519.pub.pem",
  retiredWriterHistory:
    "docs/extraction/history/w10-retired-specification-writer.json",
  trustProfile: "spec/trust/profile.json",
});

const immutableRawDigests = Object.freeze({
  [paths.specificationLedger]:
    "sha256:5013901f82db29b900fc611511ac27583204524c0562aca11b36088cc2f9bca3",
  [paths.combinedPrefixChain]:
    "sha256:72525a4df2ecae5bef651802e386605ce7fb6af40d9f495def470bf4024a1d1d",
  [paths.combinedHead]:
    "sha256:8651d9c8a7fd8ded87c7a2a175aefac6676bf4795082ee4df04a0faf35aa1bc5",
  [paths.combinedHeadSignature]:
    "sha256:f0c3950b0bd559e2ce96a3aaccf35d414b4ac7f43359be1244105d8d9f6e09b6",
  [paths.combinedHeadPublicKey]:
    "sha256:4a13be4c9cab7bfb06583c8b55e3ad8bc9bdad73f5093ea3371f4aaa3042aa0e",
  "docs/extraction/history/README.md":
    "sha256:a238488fbff7560127767ecd6173f1d8110904dc398613055faf068adeb411cc",
  "docs/extraction/history/publication-blockers-v1beta1.json":
    "sha256:8bc708163e789b95833331a537abf1c455062179c0eef5b57c583c76b8d740e0",
  "docs/extraction/history/published-document-lanes.json":
    "sha256:f00211e3f0f943679e27976d2b9d06f96ea534eaeee80430b6e893b20d47dcb3",
  "docs/extraction/history/specification-1.1-publication-evidence.json":
    "sha256:6f2ba3d51261f2559d0738ed2b22f51d7066d4d5b9f9bf0213694f352b677a84",
  "docs/extraction/history/specification-1.1-publication-policy.md":
    "sha256:1828286b630758980a1a36c85321f7759c7134aeb05df0bba7953edfd942002c",
  "docs/extraction/history/specification-compatibility.json":
    "sha256:2d65b2c0fe9d6ddfb8aa8866fb2e4946be5984402c7cbcf7a6a8f55b12d00faa",
  "docs/extraction/history/w08-source-boundary-inventory.md":
    "sha256:f279a967a2d4435f8452fc2db548af93417a0a641f02fa2f68e8979550a95c70",
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
const retiredWriterSource = Object.freeze({
  commit: "94d22e4325695b4ffb215629f4bb937e35a6fed0",
  tree: "f6a3ba75d8f2f84d4d0d4e23ddcb5ac3431071bc",
});
const retiredWriterFiles = Object.freeze([
  ["release/authority/specification-schema-tool-closure.json", 508, "fe83242c72f85b6ace9cd14fbf42fc75999d3139", "d03a7e56a7cc459d8d07d24fc480d00d50b53ded6d807f5ded9faac88f4e0866"],
  ["release/authority/specification-writer-closure.json", 818, "06b067b06fa056ec1fee5b65b4408f866680f2c9", "34c54ba7f2c3a5ded3da7bc364b2d366227850b393b944bff2b202312c0ac8d1"],
  ["release/authority/specification-writer-rotations.json", 1341, "8cfec8e13c00f7d043686063601a759a5239a438", "00fbbb0658e8ffc9ea547ca0188961ca10cbdab7fa34616c6dfe4255c52b9419"],
  ["release/specification-authority.json", 1097, "3cf9e28c3ad3d7353c4e819d5023f148919a0f71", "6e0a9d4a08e5004aa882a5c5b945bd4b60265e6ddfaca83c3042d1c19750821c"],
  ["release/specification-release-policy.md", 14320, "b7246c715e71003a20ad2c3464eaa2291aeef587", "ffd21ab759bfd95dd04589239690522d5a257553582b8c798facef7dc8123474"],
  ["scripts/specification-release-adapter.mjs", 133861, "5d7a2c271bf6d2a7764e80fb7986ab67fc989b3d", "915c984c8cd48a610cd58cc32ae1328afd68eeee77293165dc741beab996e6c0"],
  ["scripts/specification-release-adapter.test.mjs", 73505, "d4d473228ba27068986a96b06cacf02bce7fc443", "b93a854e5a28a47cc3081cd4572328d49374e04f0ce4c76920090e1c8a71a397"],
  ["scripts/specification-release.mjs", 109709, "6bb653cbbb5b19612ec8ac10e76eeb66ecf8de5d", "b339975244a27bbc0cf539d4eff0e57ab69bf8e8cf2af1467adfd10a48978e8b"],
  ["scripts/specification-release.test.mjs", 66462, "232e7b49561d84ece376fdb10088f770975ca4e5", "6d1d442d5d2429c90632996ebcad8cde02a524a43c9ebe42d6c826794a272794"],
]);

const proposalClassificationHeader =
  /^---\nclassification: non-normative-proposal\n---\n/u;
const mintedV2Patterns = Object.freeze([
  /(?:https:\/\/)?forms\.takoform\.com\/(?:[A-Za-z0-9._~-]+\/)*v2(?:[/\."'`\s]|$)/iu,
  /\bspecification\/(?:v)?2(?:\.[0-9]+)?(?:[\s"'`/]|$)/iu,
  /takoform\.specification-release-receipt@v2(?:[.\s"'`]|$)/iu,
  /["']hostApiLane["']\s*:\s*["'][^"']*\/v2(?:[/\."']|$)/iu,
  /["']track["']\s*:\s*["']specification-v2["']/iu,
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function objectSha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, expected) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...expected].sort());
}

function problem(problems, message) {
  problems.push(message);
}

export function classifySpecificationPublicationSource(path, raw) {
  const text = Buffer.from(raw).toString("utf8");
  const proposalPath = typeof path === "string" &&
    /^spec\/proposals\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md$/u.test(path);
  const classifiedProposal = proposalClassificationHeader.test(text);
  if (proposalPath !== classifiedProposal) {
    throw new Error(
      `${path}: v2 proposal material requires both spec/proposals/**.md and classification: non-normative-proposal`,
    );
  }
  if (!proposalPath) {
    if (
      typeof path !== "string" ||
      (/^spec\/(?:schemas|host-api)\//u.test(path) &&
        /(?:^|\/)v2(?:[._/-]|$)/iu.test(path))
    ) {
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

export function validateSpecificationLedger(ledger) {
  const problems = [];
  if (
    ledger?.kind !== "takoform.specification-releases@v1" ||
    !Array.isArray(ledger?.releases) ||
    ledger.releases.length !== 1
  ) {
    problem(
      problems,
      "Specification ledger must remain the sealed one-record historical 1.1 receipt",
    );
    return problems;
  }
  const withdrawn = ledger.reserved?.find((entry) => entry?.version === "1.0");
  if (withdrawn?.status !== "withdrawn-retained" || withdrawn?.noReuse !== true) {
    problem(problems, "Specification 1.0 must remain withdrawn and non-reusable");
  }
  const release = ledger.releases[0];
  if (
    release?.version !== "1.1" ||
    release?.tag !== "specification/1.1" ||
    release?.sourceCommit !== "00ae5ee4e2ea2eb62ea796499a93081374dc36b9" ||
    release?.releaseCommit !== "35c03a76326c808e859aa77172e086f15a2aeb5d" ||
    release?.tagObject !== "e2c1ba71766a6b25cae0826df99c8906a7f3f20b" ||
    release?.release?.id !== 377480828 ||
    release?.release?.immutable !== true ||
    release?.assets?.length !== 1 ||
    objectSha256(release) !== specification11ReceiptObjectSha256
  ) {
    problem(problems, "Specification 1.1 immutable receipt changed");
  }
  const serialized = JSON.stringify(ledger);
  if (/forms\.takoform\.com\/v2|specification\/(?:v)?2|"version":"(?:1\.[2-9]|[2-9])/u.test(serialized)) {
    problem(problems, "Specification history contains a future numbered or API v2 identity");
  }
  return problems;
}

function validateSchemaEntry(entry, label, { retired = false } = {}) {
  const problems = [];
  const expectedKeys = retired
    ? ["id", "public", "retiredBecause", "sha256", "source"]
    : ["id", "public", "sha256", "source"];
  if (!exactKeys(entry, expectedKeys)) {
    problem(problems, `${label} has an unexpected field set`);
    return problems;
  }
  if (
    typeof entry.id !== "string" ||
    !entry.id.startsWith("https://forms.takoform.com/schemas/") ||
    entry.id.includes("/v2/") ||
    !/^sha256:[0-9a-f]{64}$/u.test(entry.sha256 ?? "") ||
    typeof entry.source !== "string" ||
    !entry.source.startsWith("spec/schemas/") ||
    typeof entry.public !== "string"
  ) {
    problem(problems, `${label} identity, source, public path, or digest is invalid`);
  }
  return problems;
}

export function validateSchemaLedgerShape(ledger) {
  const problems = [];
  if (ledger?.kind !== "takoform.public-schema-identities@v1") {
    problem(problems, "schema ledger kind changed");
  }
  if (!Array.isArray(ledger?.identities) || !Array.isArray(ledger?.retired)) {
    problem(problems, "schema ledger active and verify-only prefixes must be arrays");
    return problems;
  }
  const seenIds = new Set();
  const seenPaths = new Set();
  for (const [prefix, entries] of [["active", ledger.identities], ["verify-only", ledger.retired]]) {
    for (const [index, entry] of entries.entries()) {
      problems.push(...validateSchemaEntry(entry, `${prefix} schema ${index}`, {
        retired: prefix === "verify-only",
      }));
      if (seenIds.has(entry?.id)) problem(problems, `schema identity is duplicated: ${entry?.id}`);
      if (seenPaths.has(entry?.public)) problem(problems, `schema public path is duplicated: ${entry?.public}`);
      seenIds.add(entry?.id);
      seenPaths.add(entry?.public);
    }
  }
  if (
    ledger.identities.length < importedSchemaPrefixes.active.count ||
    objectSha256(ledger.identities.slice(0, importedSchemaPrefixes.active.count)) !==
      importedSchemaPrefixes.active.sha256
  ) {
    problem(problems, "imported 31-entry active schema prefix changed or was removed");
  }
  if (
    ledger.retired.length < importedSchemaPrefixes.retired.count ||
    objectSha256(ledger.retired.slice(0, importedSchemaPrefixes.retired.count)) !==
      importedSchemaPrefixes.retired.sha256
  ) {
    problem(problems, "imported 15-entry verify-only schema prefix changed or was removed");
  }
  return problems;
}

export function validateRecordPrefixChain(chain, specificationLedger, schemaLedger) {
  const problems = [];
  if (
    chain?.kind !== "takoform.record-prefix-chain@v1" ||
    chain?.specificationReleases?.length !== 1 ||
    chain?.publicSchemaIdentities?.length !== 1
  ) {
    problem(problems, "signed W09 combined prefix chain shape changed");
    return problems;
  }
  const specification = chain.specificationReleases[0];
  const schema = chain.publicSchemaIdentities[0];
  if (
    specification.sequence !== 1 ||
    specification.releaseCount !== 1 ||
    specification.prefixSha256 !==
      `sha256:${objectSha256(specificationLedger.releases.slice(0, 1))}` ||
    specification.entrySha256 !==
      `sha256:${objectSha256({
        sequence: specification.sequence,
        releaseCount: specification.releaseCount,
        prefixSha256: specification.prefixSha256,
        previousEntrySha256: specification.previousEntrySha256,
      })}`
  ) {
    problem(problems, "signed Specification 1.1 prefix seal changed");
  }
  const prefix = {
    identities: schemaLedger.identities.slice(0, schema.activeCount),
    retired: schemaLedger.retired.slice(0, schema.verifyOnlyCount),
  };
  if (
    schema.sequence !== 1 ||
    schema.activeCount !== 31 ||
    schema.verifyOnlyCount !== 15 ||
    schema.prefixSha256 !== `sha256:${objectSha256(prefix)}` ||
    schema.entrySha256 !==
      `sha256:${objectSha256({
        sequence: schema.sequence,
        activeCount: schema.activeCount,
        verifyOnlyCount: schema.verifyOnlyCount,
        prefixSha256: schema.prefixSha256,
        previousEntrySha256: schema.previousEntrySha256,
      })}`
  ) {
    problem(problems, "signed imported schema prefix seal changed");
  }
  return problems;
}

export function validateRecordHead(headRaw, signature, publicKeyPEM, chain) {
  const problems = [];
  let head;
  try {
    head = JSON.parse(Buffer.from(headRaw).toString("utf8"));
  } catch (error) {
    return [`signed record head is not JSON (${error.message})`];
  }
  if (
    head?.kind !== "takoform.record-head@v1" ||
    head?.generation !== 1 ||
    head?.specificationReleases?.entrySha256 !==
      chain?.specificationReleases?.[0]?.entrySha256 ||
    head?.publicSchemaIdentities?.entrySha256 !==
      chain?.publicSchemaIdentities?.[0]?.entrySha256 ||
    head?.previousHeadSha256 !== null
  ) {
    problem(problems, "signed W09 record head no longer pins both imported prefixes");
  }
  if (
    signature?.kind !== "takoform.record-head-signature@v1" ||
    signature?.algorithm !== "ed25519" ||
    signature?.subject !== paths.combinedHead ||
    signature?.subjectSha256 !== sha256(headRaw) ||
    signature?.publicKeySha256 !==
      "sha256:a4f2a0811b8d9432a8d5ecea246f768470d78d0ed53214a587ba2f7c238e8cbb"
  ) {
    problem(problems, "record head signature envelope changed");
    return problems;
  }
  try {
    const key = createPublicKey(publicKeyPEM);
    if (!verify(null, headRaw, key, Buffer.from(signature.signature, "base64"))) {
      problem(problems, "record head signature is invalid");
    }
  } catch (error) {
    problem(problems, `record head signature verification failed (${error.message})`);
  }
  return problems;
}

export function validateRetiredWriterHistory(
  manifest,
  { root = ".", verifyGit = true } = {},
) {
  const problems = [];
  const expectedFiles = retiredWriterFiles.map(([path, bytes, gitBlob, digest]) => ({
    path,
    bytes,
    gitBlob,
    sha256: `sha256:${digest}`,
  }));
  if (
    !exactKeys(manifest, ["files", "kind", "sourceCommit", "sourceTree", "status"]) ||
    manifest.kind !== "takoform.retired-specification-writer-history@v1" ||
    manifest.sourceCommit !== retiredWriterSource.commit ||
    manifest.sourceTree !== retiredWriterSource.tree ||
    manifest.status !== "historical-bytes-only-no-executable-authority" ||
    !same(manifest.files, expectedFiles)
  ) {
    problem(problems, "retired Specification writer history manifest changed");
    return problems;
  }
  if (!verifyGit) return problems;
  try {
    const tree = execFileSync(
      "git",
      ["show", "-s", "--format=%T", manifest.sourceCommit],
      { cwd: root, encoding: "utf8" },
    ).trim();
    if (tree !== manifest.sourceTree) {
      problem(problems, "retired writer source commit no longer has the recorded tree");
      return problems;
    }
    for (const file of manifest.files) {
      const raw = execFileSync(
        "git",
        ["show", `${manifest.sourceCommit}:${file.path}`],
        { cwd: root, encoding: "buffer", maxBuffer: 2 * 1024 * 1024 },
      );
      const blob = execFileSync(
        "git",
        ["rev-parse", `${manifest.sourceCommit}:${file.path}`],
        { cwd: root, encoding: "utf8" },
      ).trim();
      if (raw.length !== file.bytes || sha256(raw) !== file.sha256 || blob !== file.gitBlob) {
        problem(problems, `retired writer history bytes changed at ${file.path}`);
      }
    }
  } catch (error) {
    problem(problems, `cannot verify retired writer history at P (${error.message})`);
  }
  return problems;
}

export function validateTrustProfile(profile) {
  const problems = [];
  if (
    profile?.format !== "takoform.core-trust-profile@v1" ||
    profile?.status !== "core-format" ||
    profile?.publisherPolicy?.callerSupplied !== true ||
    profile?.publisherPolicy?.publisherClassField !== false ||
    profile?.publisherPolicy?.officialTrustBypass !== false ||
    profile?.publisherPolicy?.defaultPublisher !== false ||
    profile?.signature?.ambientTrustedRoot !== false ||
    profile?.contentPolicy?.dataOnly !== true ||
    profile?.contentPolicy?.allowExecutableValidationOrAdapterCode !== false
  ) {
    problem(problems, "Core trust profile grants ambient publisher or executable authority");
  }
  return problems;
}

async function walk(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await walk(root, path));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function readRequired(root, path, problems) {
  try {
    return await readFile(resolve(root, path));
  } catch (error) {
    problem(problems, `${path} cannot be read (${error.message})`);
    return null;
  }
}

function parseJSON(raw, path, problems) {
  if (raw === null) return null;
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch (error) {
    problem(problems, `${path} is not JSON (${error.message})`);
    return null;
  }
}

export async function validateRepositoryRecords(
  root = ".",
  { verifyGitHistory = true } = {},
) {
  const problems = [];
  const raw = {};
  for (const path of new Set([
    ...Object.keys(immutableRawDigests),
    paths.schemaLedger,
    paths.retiredWriterHistory,
    paths.trustProfile,
  ])) {
    raw[path] = await readRequired(root, path, problems);
  }
  for (const [path, expected] of Object.entries(immutableRawDigests)) {
    if (raw[path] !== null && sha256(raw[path]) !== expected) {
      problem(problems, `${path} immutable bytes changed`);
    }
  }

  const specification = parseJSON(raw[paths.specificationLedger], paths.specificationLedger, problems);
  const schemas = parseJSON(raw[paths.schemaLedger], paths.schemaLedger, problems);
  const combinedChain = parseJSON(raw[paths.combinedPrefixChain], paths.combinedPrefixChain, problems);
  const combinedHeadSignature = parseJSON(raw[paths.combinedHeadSignature], paths.combinedHeadSignature, problems);
  const writerHistory = parseJSON(raw[paths.retiredWriterHistory], paths.retiredWriterHistory, problems);
  const trustProfile = parseJSON(raw[paths.trustProfile], paths.trustProfile, problems);

  if (specification) problems.push(...validateSpecificationLedger(specification));
  if (schemas) problems.push(...validateSchemaLedgerShape(schemas));
  if (combinedChain && specification && schemas) {
    problems.push(...validateRecordPrefixChain(combinedChain, specification, schemas));
  }
  if (
    raw[paths.combinedHead] &&
    combinedHeadSignature &&
    raw[paths.combinedHeadPublicKey] &&
    combinedChain
  ) {
    problems.push(...validateRecordHead(
      raw[paths.combinedHead],
      combinedHeadSignature,
      raw[paths.combinedHeadPublicKey],
      combinedChain,
    ));
  }
  if (writerHistory) {
    problems.push(...validateRetiredWriterHistory(writerHistory, {
      root,
      verifyGit: verifyGitHistory,
    }));
  }
  if (trustProfile) problems.push(...validateTrustProfile(trustProfile));

  if (schemas) {
    for (const entry of [...schemas.identities, ...schemas.retired]) {
      const source = await readRequired(root, entry.source, problems);
      if (source !== null && sha256(source) !== entry.sha256) {
        problem(problems, `${entry.source} differs from schema ledger digest ${entry.sha256}`);
      }
    }
  }

  try {
    for (const path of (await walk(resolve(root, "spec"))).map((entry) => `spec/${entry}`)) {
      const source = await readFile(resolve(root, path));
      classifySpecificationPublicationSource(path, source);
    }
  } catch (error) {
    problem(problems, error.message);
  }

  return problems;
}

export async function main() {
  const problems = await validateRepositoryRecords(".");
  if (problems.length !== 0) {
    for (const message of problems) console.error(`records: ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    "records: W09 history and platform-neutral public schema identities are immutable",
  );
}

if (import.meta.main) await main();
