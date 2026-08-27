import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  classifySpecificationPublicationSource,
  deriveSuccessorActivationCommit,
  schemaRouteCutoverClosureSha256,
  validateRepositoryAuthorityHistory,
  validateRepositoryRecords,
  validateAuthorityTransfer,
  validateAuthorityTransferHistory,
  validateSchemaLedgerShape,
  validateRecordHead,
  validateRecordPrefixChain,
  validateSpecificationLedger,
  validateSpecificationWriterClosureManifest,
  validateSpecificationWriterSurface,
  specificationWriterClosurePaths,
  validateTrustProfile,
} from "./records.mjs";

const specification = await Bun.file("release/specification-releases.json").json();
const schemas = await Bun.file("release/public-schema-identities.json").json();
const prefixChain = await Bun.file("release/record-prefix-chain.json").json();
const recordHeadRaw = await Bun.file("release/record-head.json").arrayBuffer();
const recordHead = JSON.parse(new TextDecoder().decode(recordHeadRaw));
const recordHeadSignature = await Bun.file("release/record-head.sig.json").json();
const recordHeadPublicKey = await Bun.file("release/authority/record-head-ed25519.pub.pem").text();
const authority = await Bun.file("release/specification-authority.json").json();
const trustProfile = await Bun.file("spec/trust/profile.json").json();
const authorityPath = "release/specification-authority.json";

function dormantAuthority() {
  return {
    ...structuredClone(authority),
    state: "prepared-writer-disabled",
    predecessorTombstoneCommit: null,
    successorPreparedCommit: null,
    schemaRouteCutover: null,
    predecessorWriterDisabledAt: null,
    successorWriterEnabledAt: null,
    writerOverlapAllowed: false,
  };
}
const p0 = "1".repeat(40);
const p = "2".repeat(40);
const tombstone = "4".repeat(40);
const activation = "5".repeat(40);

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
  }).trim();
}

function writeAuthority(root, document) {
  const path = join(root, authorityPath);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
}

function commitAuthority(root, message) {
  git(root, ["add", "--", authorityPath]);
  git(root, ["commit", "--no-gpg-sign", "-m", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

function writeDormantWriterSurface(root) {
  mkdirSync(join(root, "scripts"), { recursive: true });
  const writer = [
    "export const DORMANT_WRITER_GUARD = 'prepared-writer-disabled';",
    "export async function reserve() { assertMutationAuthority(); }",
    "export async function applySchemaReservation() { assertMutationAuthority(); }",
    "export async function sealRecordArtifact() { assertMutationAuthority(); }",
    "export async function prepare() { assertMutationAuthority(); }",
    "export async function publish() { assertMutationAuthority(); }",
    "export async function recover() { assertMutationAuthority(); }",
    "export async function prepareReceipt() { assertMutationAuthority(); }",
    "export async function record() { assertMutationAuthority(); }",
    "export async function verify() {}",
  ].join("\n");
  const adapter = [
    "export function createSpecificationReleaseOperations() {}",
    "async function verifyIndependentReview() {}",
    "async function verifySourcePinnedExecution() {}",
    "async function verifySpecificationSourceSnapshot() {}",
    "async function readSchemaVerificationState() {}",
    "async function prepareSchemaToolClosure() {}",
    "async function tryRecordSpecificationReceipt() {}",
    "async function acquireTagProtectionAuditToken() {}",
    "async function verifyTagProtectionRuleset() {}",
    "async function createImmutableRelease() {}",
  ].join("\n");
  const deploy = [
    "import { createSpecificationReleaseOperations } from './specification-release-adapter.mjs';",
    "const surface = 'specification-release';",
  ].join("\n");
  const manifest = `${JSON.stringify({
    format: "takoform.specification-writer-closure@v1",
    paths: specificationWriterClosurePaths,
  }, null, 2)}\n`;
  const files = new Map([
    ...specificationWriterClosurePaths.map((path) => [path, "// P0 closure\n"]),
    ["scripts/specification-release.mjs", writer],
    ["scripts/specification-release.test.mjs", "// committed P0 tests\n"],
    ["scripts/specification-release-adapter.mjs", adapter],
    ["scripts/specification-release-adapter.test.mjs", "// committed P0 adapter tests\n"],
    ["scripts/deploy.mjs", deploy],
    ["release/specification-release-policy.md", "# committed P0 policy\n"],
    ["release/authority/specification-writer-closure.json", manifest],
  ]);
  for (const [path, source] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  git(root, ["add", "--", ...files.keys()]);
}

function activeAuthority({
  p0Commit = p0,
  pCommit = p,
  tombstoneCommit = tombstone,
} = {}) {
  const schemaRouteCutover = {
    format: "takoform.schema-origin-authority-cutover@v1",
    sourceCommit: pCommit,
    predecessorTombstoneCommit: tombstoneCommit,
    candidateSha256: `sha256:${"1".repeat(64)}`,
    stageRecordSha256: `sha256:${"2".repeat(64)}`,
    cutoverRecordSha256: `sha256:${"3".repeat(64)}`,
    predecessorReadbackSha256: `sha256:${"4".repeat(64)}`,
    routeId: "5".repeat(32),
    routePattern: "forms.takoform.com/schemas/*",
    worker: "takoform-schema-origin",
    versionId: "11111111-2222-4333-8444-555555555555",
    deploymentId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    completedReadbackAt: "2026-08-27T12:00:01Z",
    freshReadbackAt: "2026-08-27T12:00:02Z",
  };
  schemaRouteCutover.closureSha256 =
    schemaRouteCutoverClosureSha256(schemaRouteCutover);
  return {
    ...dormantAuthority(),
    state: "successor-active",
    successorPreparedCommit: p0Commit,
    predecessorTombstoneCommit: tombstoneCommit,
    predecessorWriterDisabledAt: "2026-08-27T12:00:00Z",
    schemaRouteCutover,
    successorWriterEnabledAt: "2026-08-27T12:00:03Z",
  };
}

function authorityHistory() {
  const prepared = dormantAuthority();
  const receipt = {
    ...structuredClone(prepared),
    successorPreparedCommit: p0,
  };
  const active = activeAuthority();
  return [
    {
      commit: p0,
      parents: ["0".repeat(40)],
      changedPaths: [
        authorityPath,
        "scripts/specification-release.mjs",
        "scripts/specification-release.test.mjs",
        "scripts/specification-release-adapter.mjs",
        "scripts/specification-release-adapter.test.mjs",
        "scripts/deploy.mjs",
        "release/specification-release-policy.md",
      ],
      authority: prepared,
    },
    {
      commit: p,
      parents: [p0],
      changedPaths: [authorityPath],
      authority: receipt,
    },
    {
      commit: activation,
      parents: [p],
      changedPaths: [authorityPath],
      authority: active,
    },
  ];
}

describe("append-only Core records", () => {
  test("the repository closes every recorded byte", async () => {
    expect(await validateRepositoryRecords(".", {
      authorityHistoryValidator: () => [],
    })).toEqual([]);
  });

  test("a newly sealed Specification prefix cannot later be rewritten or removed", () => {
    const changedSpecification = structuredClone(specification);
    changedSpecification.releases.push({
      version: "1.2",
      tag: "specification/1.2",
      hostApiEffect: "none",
      formPublicationEffect: "none",
      providerEffect: "none",
    });
    const changedChain = structuredClone(prefixChain);
    const prior = changedChain.specificationReleases.at(-1);
    const unsigned = {
      sequence: prior.sequence + 1,
      releaseCount: changedSpecification.releases.length,
      prefixSha256: `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(changedSpecification.releases)).digest("hex")}`,
      previousEntrySha256: prior.entrySha256,
    };
    changedChain.specificationReleases.push({
      ...unsigned,
      entrySha256: `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(unsigned)).digest("hex")}`,
    });
    expect(validateRecordPrefixChain(changedChain, changedSpecification, schemas)).toEqual([]);

    const rewritten = structuredClone(changedSpecification);
    rewritten.releases[1].tag = "specification/rewritten";
    expect(validateRecordPrefixChain(changedChain, rewritten, schemas)).toContain(
      "Specification prefix seal 2 no longer matches its recorded prefix",
    );
    const removed = structuredClone(changedSpecification);
    removed.releases.pop();
    expect(validateRecordPrefixChain(changedChain, removed, schemas)).not.toEqual([]);
    const sealRemoved = structuredClone(changedChain);
    sealRemoved.specificationReleases.pop();
    expect(validateRecordPrefixChain(sealRemoved, changedSpecification, schemas)).toContain(
      "Specification release ledger head is not sealed",
    );
  });

  test("recomputing every future seal cannot forge the independently signed head", () => {
    const changedSpecification = structuredClone(specification);
    changedSpecification.releases.push({
      version: "1.2",
      title: "Takoform Specification 1.2",
      tag: "specification/1.2",
      hostApiEffect: "none",
      formPublicationEffect: "none",
      providerEffect: "none",
    });
    const changedChain = structuredClone(prefixChain);
    const prior = changedChain.specificationReleases.at(-1);
    const appendSeal = () => {
      const unsigned = {
        sequence: prior.sequence + 1,
        releaseCount: changedSpecification.releases.length,
        prefixSha256: `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(changedSpecification.releases)).digest("hex")}`,
        previousEntrySha256: prior.entrySha256,
      };
      changedChain.specificationReleases[1] = {
        ...unsigned,
        entrySha256: `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(unsigned)).digest("hex")}`,
      };
    };
    appendSeal();

    // Rewrite the future record, then recompute the prefix and every affected
    // seal. The hash chain alone accepts this attack.
    changedSpecification.releases[1].title = "Rewritten Specification 1.2";
    appendSeal();
    expect(validateRecordPrefixChain(changedChain, changedSpecification, schemas)).toEqual([]);

    const forgedHead = {
      kind: "takoform.record-head@v1",
      generation: 2,
      specificationReleases: {
        sequence: 2,
        releaseCount: 2,
        entrySha256: changedChain.specificationReleases[1].entrySha256,
      },
      publicSchemaIdentities: recordHead.publicSchemaIdentities,
      previousHeadSha256: `sha256:${new Bun.CryptoHasher("sha256").update(recordHeadRaw).digest("hex")}`,
    };
    const forgedRaw = new TextEncoder().encode(`${JSON.stringify(forgedHead, null, 2)}\n`);
    const forgedSignature = {
      ...recordHeadSignature,
      subjectSha256: `sha256:${new Bun.CryptoHasher("sha256").update(forgedRaw).digest("hex")}`,
    };
    expect(validateRecordHead(forgedRaw, forgedSignature, recordHeadPublicKey, changedChain)).toContain(
      "record head signature is invalid",
    );
  });

  test("a rewritten signed-head generation cannot reorder ledger history", () => {
    const rewritten = structuredClone(recordHead);
    rewritten.generation = 2;
    rewritten.previousHeadSha256 = `sha256:${"0".repeat(64)}`;
    const raw = new TextEncoder().encode(`${JSON.stringify(rewritten, null, 2)}\n`);
    expect(
      validateRecordHead(raw, recordHeadSignature, recordHeadPublicKey, prefixChain),
    ).toContain(
      "signed record head generation must equal the exact append order of both prefix histories",
    );
  });

  test("a newly sealed schema prefix cannot later move, change, or disappear", () => {
    const changedSchemas = structuredClone(schemas);
    changedSchemas.identities.push({
      id: "https://example.test/schemas/forms/v1/example.schema.json",
      sha256: `sha256:${"a".repeat(64)}`,
      source: "spec/schemas/example.schema.json",
    });
    const changedChain = structuredClone(prefixChain);
    const prior = changedChain.publicSchemaIdentities.at(-1);
    const prefix = { identities: changedSchemas.identities, retired: changedSchemas.retired };
    const unsigned = {
      sequence: prior.sequence + 1,
      activeCount: changedSchemas.identities.length,
      verifyOnlyCount: changedSchemas.retired.length,
      prefixSha256: `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(prefix)).digest("hex")}`,
      previousEntrySha256: prior.entrySha256,
    };
    changedChain.publicSchemaIdentities.push({
      ...unsigned,
      entrySha256: `sha256:${new Bun.CryptoHasher("sha256").update(JSON.stringify(unsigned)).digest("hex")}`,
    });
    expect(validateRecordPrefixChain(changedChain, specification, changedSchemas)).toEqual([]);

    const rewritten = structuredClone(changedSchemas);
    rewritten.identities.at(-1).sha256 = `sha256:${"b".repeat(64)}`;
    expect(validateRecordPrefixChain(changedChain, specification, rewritten)).toContain(
      "schema prefix seal 2 no longer matches its recorded prefixes",
    );
    const moved = structuredClone(changedSchemas);
    moved.retired.push({ ...moved.identities.pop(), retiredBecause: "rewritten history" });
    expect(validateRecordPrefixChain(changedChain, specification, moved)).not.toEqual([]);
    const removed = structuredClone(changedSchemas);
    removed.identities.pop();
    expect(validateRecordPrefixChain(changedChain, specification, removed)).not.toEqual([]);
  });

  test("Specification 1.1 cannot be rewritten or reused", () => {
    const changed = structuredClone(specification);
    changed.releases[0].tagObject = "0".repeat(40);
    changed.releases[0].format = "takoform.specification-release-receipt@v9";
    changed.releases[0].hostApiLane = "forms.takoform.com/v9";
    changed.releases.push({
      version: "1.0",
      tag: "specification/1.0",
      hostApiEffect: "none",
      formPublicationEffect: "none",
      providerEffect: "none",
    });
    expect(validateSpecificationLedger(changed)).toEqual(expect.arrayContaining([
      "Specification 1.1 immutable tagObject changed",
      "Specification 1.1 immutable receipt object changed",
      "withdrawn Specification 1.0 was reused",
    ]));
  });

  test("a Specification receipt cannot smuggle Host API v2", () => {
    const changed = structuredClone(specification);
    changed.releases[0].hostApiLane = "forms.takoform.com/v2";
    expect(validateSpecificationLedger(changed)).toContain(
      "Specification ledger contains a forbidden Host API v2 identity",
    );
  });

  test("v2 text is confined to explicitly classified non-normative proposals", () => {
    expect(classifySpecificationPublicationSource(
      "spec/proposals/w19-host-api-v2.md",
      Buffer.from(
        "---\nclassification: non-normative-proposal\n---\n\nProposal: `forms.takoform.com/v2`.\n",
      ),
    )).toBe("non-normative-proposal");
    for (const [path, raw] of [
      ["spec/host-api/v2.md", "Host lane `forms.takoform.com/v2`.\n"],
      ["spec/proposals/w19-host-api-v2.md", "Proposal: `forms.takoform.com/v2`.\n"],
      ["spec/README.md", "Tag `specification/2.0` is now released.\n"],
      ["spec/schemas/example.schema.json", '{"$id":"https://forms.takoform.com/schemas/v2/example.json"}\n'],
    ]) {
      expect(() => classifySpecificationPublicationSource(path, Buffer.from(raw)))
        .toThrow();
    }
  });

  test("future receipts stay contiguous on 1.x and cannot reissue 1.1", () => {
    const changed = structuredClone(specification);
    changed.releases.push({
      format: "takoform.specification-release-receipt@v1",
      version: "2.0",
      tag: "specification/2.0",
      hostApiEffect: "none",
      formPublicationEffect: "none",
      providerEffect: "none",
    });
    expect(validateSpecificationLedger(changed)).toEqual(expect.arrayContaining([
      "Specification release 2.0 must stay on the contiguous 1.x minor line",
      "Specification ledger contains a forbidden major-2 or Host API v2 identity",
    ]));

    changed.releases[1].version = "1.3";
    changed.releases[1].tag = "specification/1.3";
    expect(validateSpecificationLedger(changed)).toContain(
      "Specification release 1.3 skips or reorders the next unused 1.x minor",
    );
  });

  test("future receipts require the exact active no-bypass tag ruleset and asset-free Release", () => {
    const changed = structuredClone(specification);
    const release = {
      format: "takoform.specification-release-receipt@v1",
      version: "1.2",
      title: "Takoform Specification 1.2",
      track: "specification-v1",
      hostApiLane: "forms.takoform.com/v1",
      sourceCommit: "a".repeat(40),
      releaseCommit: "b".repeat(40),
      sourceSnapshotSha256: `sha256:${"1".repeat(64)}`,
      schemaOriginCandidateSha256: `sha256:${"2".repeat(64)}`,
      schemaReservationEntrySha256: `sha256:${"3".repeat(64)}`,
      prerequisites: [
        "specification-source-snapshot",
        "schema-origin-live-readback",
      ],
      hostApiEffect: "none",
      formPublicationEffect: "none",
      providerEffect: "none",
      tag: "specification/1.2",
      tagObject: "c".repeat(40),
      annotatedTag: true,
      signedTag: true,
      tagProtectionRuleset: {
        id: 321,
        target: "tag",
        enforcement: "active",
        bypassActors: [],
        include: ["refs/tags/specification/*"],
        exclude: [],
        rules: ["deletion", "update"],
      },
      release: {
        id: 1200,
        url:
          "https://github.com/tako0614/takoform/releases/tag/specification/1.2",
        bodySha256: "",
        draft: false,
        prerelease: false,
        immutable: true,
      },
      assets: [],
    };
    const body = [
      release.title,
      "",
      `Normative commit: ${release.sourceCommit}`,
      `Source snapshot: ${release.sourceSnapshotSha256}`,
      `Schema-origin candidate: ${release.schemaOriginCandidateSha256}`,
      "",
      "The retained candidate is operator review evidence and is not a public Release asset.",
    ].join("\n");
    release.release.bodySha256 =
      `sha256:${new Bun.CryptoHasher("sha256").update(body).digest("hex")}`;
    changed.releases.push(release);
    expect(validateSpecificationLedger(changed)).toEqual([]);

    const specificationOnly = structuredClone(specification);
    const noSchema = structuredClone(release);
    noSchema.schemaOriginCandidateSha256 = null;
    noSchema.schemaReservationEntrySha256 = null;
    noSchema.prerequisites = ["specification-source-snapshot"];
    const noSchemaBody = [
      noSchema.title,
      "",
      `Normative commit: ${noSchema.sourceCommit}`,
      `Source snapshot: ${noSchema.sourceSnapshotSha256}`,
      "",
      "The retained candidate is operator review evidence and is not a public Release asset.",
    ].join("\n");
    noSchema.release.bodySha256 =
      `sha256:${new Bun.CryptoHasher("sha256").update(noSchemaBody).digest("hex")}`;
    specificationOnly.releases.push(noSchema);
    expect(validateSpecificationLedger(specificationOnly)).toEqual([]);

    const bypassed = structuredClone(changed);
    bypassed.releases[1].tagProtectionRuleset.bypassActors.push({
      actorId: 1,
    });
    expect(validateSpecificationLedger(bypassed)).toContain(
      "Specification 1.2 future receipt lacks the exact active no-bypass tag ruleset",
    );

    const wrongRules = structuredClone(changed);
    wrongRules.releases[1].tagProtectionRuleset.rules = [
      "deletion",
      "required_signatures",
    ];
    expect(validateSpecificationLedger(wrongRules)).toContain(
      "Specification 1.2 future receipt lacks the exact active no-bypass tag ruleset",
    );

    const asset = structuredClone(changed);
    asset.releases[1].assets.push({ name: "candidate.json" });
    expect(validateSpecificationLedger(asset)).toContain(
      "Specification 1.2 future receipt lacks exact direct asset-free immutable Release closure",
    );
  });

  test("active and verify-only schema identities cannot overlap", () => {
    const changed = structuredClone(schemas);
    changed.retired.push({ ...changed.identities[0], retiredBecause: "test" });
    expect(validateSchemaLedgerShape(changed)).not.toEqual([]);
  });

  test("schema additions cannot duplicate a public path or digest or grow retirement", () => {
    const duplicatePath = structuredClone(schemas);
    duplicatePath.identities.push({
      id: "https://forms.takoform.com/schemas/future/v1/path.schema.json",
      source: "spec/schemas/future-path.schema.json",
      public: schemas.identities[0].public,
      sha256: `sha256:${"a".repeat(64)}`,
    });
    expect(validateSchemaLedgerShape(duplicatePath)).toContain(
      `active schema public path is invalid or duplicated: ${schemas.identities[0].public}`,
    );

    const duplicateDigest = structuredClone(schemas);
    duplicateDigest.identities.push({
      id: "https://forms.takoform.com/schemas/future/v1/digest.schema.json",
      source: "spec/schemas/future-digest.schema.json",
      public: "website/public/schemas/future/v1/digest.schema.json",
      sha256: schemas.identities[0].sha256,
    });
    expect(validateSchemaLedgerShape(duplicateDigest)).toContain(
      `active schema digest is duplicated: ${schemas.identities[0].sha256}`,
    );

    const retired = structuredClone(schemas);
    retired.retired.push({
      ...retired.identities[0],
      retiredBecause: "future retirement is forbidden",
    });
    expect(validateSchemaLedgerShape(retired)).toContain(
      "W10 schema retirement is frozen at the imported 15-entry verify-only prefix",
    );
  });

  test("an imported verify-only schema cannot move into the active prefix", () => {
    const changed = structuredClone(schemas);
    changed.identities.push(changed.retired.shift());
    expect(validateSchemaLedgerShape(changed)).toEqual(expect.arrayContaining([
      "imported schema retired prefix was removed",
    ]));
  });

  test("a prepared successor cannot claim a writer or overlap", () => {
    const changed = dormantAuthority();
    changed.writerOverlapAllowed = true;
    changed.successorWriterEnabledAt = "2026-08-27T00:00:00Z";
    expect(validateAuthorityTransfer(changed)).toEqual(expect.arrayContaining([
      "Specification authority receipt must forbid writer overlap",
      "prepared authority receipt must leave successorWriterEnabledAt null",
    ]));
  });

  test("P is an authority-only child that pins P0 without self-reference", () => {
    const history = authorityHistory().slice(0, 2);
    expect(validateAuthorityTransferHistory(history)).toEqual([]);
    expect(history[0].authority.successorPreparedCommit).toBeNull();
    expect(history[1].authority.successorPreparedCommit).toBe(p0);

    const wrongParent = structuredClone(history);
    wrongParent[1].authority.successorPreparedCommit = "9".repeat(40);
    expect(validateAuthorityTransferHistory(wrongParent)).toContain(
      "prepared authority receipt must pin its direct P0 parent",
    );

    const extraPath = structuredClone(history);
    extraPath[1].changedPaths.push("README.md");
    expect(validateAuthorityTransferHistory(extraPath)).toContain(
      "prepared authority receipt P must change only release/specification-authority.json",
    );
  });

  test("repository validation derives committed P0, P and A instead of trusting a fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "takoform-authority-history-"));
    try {
      git(root, ["init", "-b", "main"]);
      git(root, ["config", "user.name", "Takoform Authority Test"]);
      git(root, ["config", "user.email", "authority@example.invalid"]);
      mkdirSync(join(root, "release"), { recursive: true });

      const prepared = dormantAuthority();
      writeDormantWriterSurface(root);
      writeAuthority(root, prepared);
      const committedP0 = commitAuthority(root, "P0 dormant implementation");
      expect(validateRepositoryAuthorityHistory(root, prepared)).toEqual([]);

      const receipt = {
        ...structuredClone(prepared),
        successorPreparedCommit: committedP0,
      };
      writeAuthority(root, receipt);
      const committedP = commitAuthority(root, "P pins P0");
      expect(validateRepositoryAuthorityHistory(root, receipt)).toEqual([]);

      const active = activeAuthority({
        p0Commit: committedP0,
        pCommit: committedP,
      });
      writeAuthority(root, active);
      commitAuthority(root, "A activates exact cutover authority");
      expect(validateRepositoryAuthorityHistory(root, active)).toEqual([]);

      writeFileSync(
        join(root, authorityPath),
        `${JSON.stringify(active, null, 2)}\n `,
      );
      expect(validateRepositoryAuthorityHistory(root, active)).toContain(
        "working-tree Specification authority differs from committed HEAD",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("activation is history-derived after the exact tombstone and cannot reopen", () => {
    const history = authorityHistory();
    expect(history).toHaveLength(3);
    expect(validateAuthorityTransferHistory(history, {
      predecessorTombstone: {
        commit: tombstone,
        pinsSuccessorCommit: p,
        readbackSha256:
          history[2].authority.schemaRouteCutover.predecessorReadbackSha256,
      },
    })).toEqual([]);
    expect(deriveSuccessorActivationCommit(history)).toBe(activation);

    const fakeRouteCommit = structuredClone(history);
    fakeRouteCommit[2].parents = ["3".repeat(40)];
    expect(validateAuthorityTransferHistory(fakeRouteCommit, {
      predecessorTombstone: {
        commit: tombstone,
        pinsSuccessorCommit: p,
        readbackSha256:
          history[2].authority.schemaRouteCutover.predecessorReadbackSha256,
      },
    })).toContain(
      "successor activation A must be the direct authority-only child of P",
    );

    expect(validateAuthorityTransferHistory(history, {
      predecessorTombstone: {
        commit: tombstone,
        pinsSuccessorCommit: p0,
        readbackSha256:
          history[2].authority.schemaRouteCutover.predecessorReadbackSha256,
      },
    })).toContain("predecessor tombstone must pin the exact prepared receipt P");

    const reopened = structuredClone(history);
    reopened.push({
      commit: "6".repeat(40),
      parents: [activation],
      changedPaths: [authorityPath],
      authority: history[1].authority,
    });
    expect(validateAuthorityTransferHistory(reopened)).toContain(
      "Specification writer authority must never reopen after successor activation",
    );
  });

  test("successor activation requires exact repositories, commits, and instants", () => {
    const changed = dormantAuthority();
    changed.state = "successor-active";
    changed.predecessorRepository = "https://example.invalid/predecessor.git";
    changed.predecessorTombstoneCommit = "x";
    changed.successorPreparedCommit = "y";
    changed.predecessorWriterDisabledAt = "a";
    changed.successorWriterEnabledAt = "z";
    expect(validateAuthorityTransfer(changed)).toEqual(expect.arrayContaining([
      "Specification authority receipt changed predecessor or successor repository identity",
      "active authority receipt requires a full commit for predecessorTombstoneCommit",
      "active authority receipt requires a full commit for successorPreparedCommit",
      "active authority receipt requires a canonical UTC instant for predecessorWriterDisabledAt",
      "active authority receipt requires a canonical UTC instant for successorWriterEnabledAt",
    ]));
  });

  test("the reviewed local writer stays present and guarded without a CI workflow", () => {
    const files = new Set([
      ...specificationWriterClosurePaths,
      "scripts/specification-release.test.mjs",
      "scripts/specification-release-adapter.test.mjs",
    ]);
    const source = [
      "export async function reserve() { assertMutationAuthority(); }",
      "export async function prepare() { assertMutationAuthority(); }",
      "export async function publish() { assertMutationAuthority(); }",
      "export async function recover() { assertMutationAuthority(); }",
      "export async function record() { assertMutationAuthority(); }",
      "export async function verify() {}",
      "export async function applySchemaReservation() { assertMutationAuthority(); }",
      "export async function sealRecordArtifact() { assertMutationAuthority(); }",
      "export async function prepareReceipt() { assertMutationAuthority(); }",
      "export const DORMANT_WRITER_GUARD = 'prepared-writer-disabled';",
    ].join("\n");
    const adapterSource = [
      "export function createSpecificationReleaseOperations() {}",
      "async function verifyIndependentReview() {}",
      "async function verifySourcePinnedExecution() {}",
      "async function verifySpecificationSourceSnapshot() {}",
      "async function readSchemaVerificationState() {}",
      "async function prepareSchemaToolClosure() {}",
      "async function tryRecordSpecificationReceipt() {}",
      "async function acquireTagProtectionAuditToken() {}",
      "async function verifyTagProtectionRuleset() {}",
      "async function createImmutableRelease() {}",
    ].join("\n");
    const deploySource = [
      "import { createSpecificationReleaseOperations } from './specification-release-adapter.mjs';",
      "const surface = 'specification-release';",
    ].join("\n");
    const surface = { files, source, adapterSource, deploySource };
    expect(validateSpecificationWriterSurface(authority, surface)).toEqual([]);
    expect(validateSpecificationWriterSurface(activeAuthority(), surface)).toEqual([]);

    expect(validateSpecificationWriterClosureManifest({
      format: "takoform.specification-writer-closure@v1",
      paths: [...specificationWriterClosurePaths],
    })).toEqual([]);
    expect(validateSpecificationWriterClosureManifest({
      format: "takoform.specification-writer-closure@v1",
      paths: specificationWriterClosurePaths.filter(
        (path) => path !== "scripts/schema-origin-projection.mjs",
      ),
    })).toContain(
      "Specification writer closure manifest must name the exact ordered P0 transitive closure",
    );

    const withWorkflow = new Set(files);
    withWorkflow.add(".github/workflows/specification-release.yml");
    expect(validateSpecificationWriterSurface(authority, {
      files: withWorkflow,
      source,
      adapterSource,
      deploySource,
    })).toContain("Specification publication must not have a CI/workflow writer");
  });

  test("Core cannot install a privileged publisher or ambient root", () => {
    const changed = structuredClone(trustProfile);
    changed.publisherPolicy.officialTrustBypass = true;
    changed.signature.ambientTrustedRoot = true;
    expect(validateTrustProfile(changed)).toEqual(expect.arrayContaining([
      "Core trust profile must set officialTrustBypass to false",
      "Core trust profile must use explicit offline trust inputs without an ambient root",
    ]));
  });
});
