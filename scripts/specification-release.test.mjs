import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createHash,
  generateKeyPairSync,
  sign as signEd25519,
} from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  AUTHORITY_ACTIVE_STATE,
  CANDIDATE_PATH,
  E_TO_R_TRACKED_PATHS,
  N_TO_E_TRACKED_PATHS,
  PINNED_RECORD_KEY_FINGERPRINT,
  SCHEMA_ROUTE,
  SOURCE_PINNED_EXECUTION_PATHS,
  SPECIFICATION_RELEASE_REVIEW_TOPICS,
  SPECIFICATION_TAG_RULESET_PATTERN,
  SPECIFICATION_TAG_RULESET_RULES,
  WRITER_EXECUTION_PATHS,
  WRITER_CLOSURE_MANIFEST_PATH,
  assertNoSameUIDSignerCredentialProcesses,
  assertSignerOnlyEnvironment,
  assertAllowedFutureVersion,
  applySchemaReservation,
  buildUnsignedRecordArtifact,
  buildPreparedCandidate,
  buildSchemaReservation,
  canonicalJSON,
  deriveUnrecordedPublicSchemas,
  invokeExternalRecordSigner,
  parseSpecificationReleaseArgs,
  sealRecordArtifact,
  prepare,
  prepareReceipt,
  publish,
  record,
  recover,
  reserve,
  verify,
  validatePreparedCandidate,
  validateDToNTransition,
  validateWriterExecutionClosureObservation,
  verifySealedRecordArtifact,
  validateTrackedTransition,
} from "./specification-release.mjs";
import { schemaRouteCutoverClosureSha256 } from "./records.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const N = "a".repeat(40);
const E = "b".repeat(40);
const R = "c".repeat(40);
const P0 = "d".repeat(40);
const P = "e".repeat(40);
const T = "f".repeat(40);
const A = "1".repeat(40);
const VERSION = "1.2";
const TAG = `specification/${VERSION}`;
const TAG_RULESET = Object.freeze({
  id: 321,
  target: "tag",
  enforcement: "active",
  bypassActors: [],
  include: ["refs/tags/specification/*"],
  exclude: [],
  rules: ["deletion", "update"],
});

const D = "2".repeat(40);

const preparedAuthority = await Bun.file(
  "release/specification-authority.json",
).json();
const specificationLedger = await Bun.file(
  "release/specification-releases.json",
).json();
const schemaLedger = await Bun.file(
  "release/public-schema-identities.json",
).json();
const prefixChain = await Bun.file("release/record-prefix-chain.json").json();
const retainedHeadRaw = Buffer.from(
  await Bun.file("release/record-head.json").arrayBuffer(),
);

const testKeys = generateKeyPairSync("ed25519");
const wrongKeys = generateKeyPairSync("ed25519");
const testPublicPEM = testKeys.publicKey.export({
  type: "spki",
  format: "pem",
});
const testFingerprint = `sha256:${createHash("sha256")
  .update(testKeys.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex")}`;
const TEST_RUNTIME = Object.freeze({
  expectedRecordKeyFingerprint: testFingerprint,
});

function signerSource(privateKey) {
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  return `#!/usr/bin/env node\nimport { readFileSync, writeFileSync } from "node:fs";\nimport { createPrivateKey, sign } from "node:crypto";\nconst args = process.argv.slice(2);\nif (args.length !== 5 || args[0] !== "sign" || args[1] !== "--input" || args[3] !== "--output") process.exit(64);\nconst key = createPrivateKey(${JSON.stringify(pem)});\nwriteFileSync(args[4], sign(null, readFileSync(args[2]), key));\n`;
}

function activeAuthority() {
  const schemaRouteCutover = {
    format: "takoform.schema-origin-authority-cutover@v1",
    sourceCommit: P,
    predecessorTombstoneCommit: T,
    candidateSha256: `sha256:${"1".repeat(64)}`,
    stageRecordSha256: `sha256:${"2".repeat(64)}`,
    cutoverRecordSha256: `sha256:${"3".repeat(64)}`,
    predecessorReadbackSha256: `sha256:${"4".repeat(64)}`,
    routeId: "5".repeat(32),
    routePattern: SCHEMA_ROUTE,
    worker: "takoform-schema-origin",
    versionId: "11111111-2222-4333-8444-555555555555",
    deploymentId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    completedReadbackAt: "2026-08-27T12:00:01Z",
    freshReadbackAt: "2026-08-27T12:00:02Z",
  };
  schemaRouteCutover.closureSha256 =
    schemaRouteCutoverClosureSha256(schemaRouteCutover);
  return {
    ...structuredClone(preparedAuthority),
    state: AUTHORITY_ACTIVE_STATE,
    successorPreparedCommit: P0,
    predecessorTombstoneCommit: T,
    predecessorWriterDisabledAt: "2026-08-27T12:00:00Z",
    schemaRouteCutover,
    successorWriterEnabledAt: "2026-08-27T12:00:03Z",
  };
}

function newSchema(name = "future") {
  const id = `https://forms.takoform.com/schemas/future/v1/${name}.schema.json`;
  const source = `spec/schemas/${name}.schema.json`;
  const publicPath = `schemas/future/v1/${name}.schema.json`;
  const bytes = Buffer.from(`${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: id, type: "object" }, null, 2)}\n`);
  return {
    entry: {
      id,
      source,
      public: publicPath,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    },
    bytes,
  };
}

function signedHeadFixture(raw = retainedHeadRaw) {
  const signature = signEd25519(null, raw, testKeys.privateKey);
  return {
    raw,
    signature: {
      kind: "takoform.record-head-signature@v1",
      algorithm: "ed25519",
      publicKeySha256: testFingerprint,
      subject: "release/record-head.json",
      subjectSha256: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
      signature: signature.toString("base64"),
    },
    publicKeyPEM: testPublicPEM,
  };
}

function repositoryState() {
  const signed = signedHeadFixture();
  return {
    specificationLedger: structuredClone(specificationLedger),
    schemaLedger: structuredClone(schemaLedger),
    prefixChain: structuredClone(prefixChain),
    recordHeadRaw: Buffer.from(signed.raw),
    recordHeadSignature: structuredClone(signed.signature),
    recordHeadPublicKeyPEM: signed.publicKeyPEM,
  };
}

function stateRecordFiles(state) {
  return new Map([
    [
      "release/specification-releases.json",
      Buffer.from(`${JSON.stringify(state.specificationLedger, null, 2)}\n`),
    ],
    [
      "release/record-prefix-chain.json",
      Buffer.from(`${JSON.stringify(state.prefixChain, null, 2)}\n`),
    ],
    ["release/record-head.json", Buffer.from(state.recordHeadRaw)],
    [
      "release/record-head.sig.json",
      Buffer.from(`${JSON.stringify(state.recordHeadSignature, null, 2)}\n`),
    ],
  ]);
}

function recordDescriptors(files, objectPrefix) {
  return Object.fromEntries(
    [...files.entries()].map(([path, bytes], index) => [
      path,
      {
        objectId: `${objectPrefix}${String(index + 1)}`.padEnd(40, objectPrefix),
        sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      },
    ]),
  );
}

function exactWriterClosure(request, currentCommit = E) {
  const pathObjects = Object.fromEntries(
    request.paths.map((path, index) => [
      path,
      `${(index % 9) + 1}`.repeat(40),
    ]),
  );
  return {
    prepared: {
      commit: request.preparedCommit,
      pathObjects: structuredClone(pathObjects),
    },
    checkpoints: request.checkpoints.map((commit) => ({
      commit,
      pathObjects: structuredClone(pathObjects),
    })),
    current: {
      commit: currentCommit,
      pathObjects: structuredClone(pathObjects),
    },
  };
}

function canonicalSchemaFiles(additions = []) {
  return [
    ...[...schemaLedger.identities, ...schemaLedger.retired].map((entry) => ({
      source: entry.source,
      bytes: readFileSync(join(ROOT, entry.source)),
    })),
    ...additions.map((addition) => ({
      source: addition.entry.source,
      bytes: addition.bytes,
    })),
  ];
}

function signedStateAfterReservation(addition = newSchema()) {
  const current = repositoryState();
  const reserved = buildSchemaReservation({
    version: VERSION,
    state: current,
    additions: [addition.entry],
  });
  const raw = Buffer.from(`${JSON.stringify(reserved.recordHead, null, 2)}\n`);
  const signed = signedHeadFixture(raw);
  return {
    addition,
    state: {
      specificationLedger: current.specificationLedger,
      schemaLedger: reserved.schemaLedger,
      prefixChain: reserved.prefixChain,
      recordHeadRaw: raw,
      recordHeadSignature: signed.signature,
      recordHeadPublicKeyPEM: signed.publicKeyPEM,
      headCommit: N,
    },
  };
}

function sourceSnapshotBytes(sourceCommit = N) {
  const files = [
    {
      path: "spec/README.md",
      sha256: `sha256:${"1".repeat(64)}`,
      classification: "normative",
    },
    {
      path: "spec/decisions/0035-beta-contracts-ship-in-stable-provider-v2-1.md",
      sha256: `sha256:${"0".repeat(64)}`,
      classification: "normative",
    },
    {
      path: "spec/versioning.md",
      sha256: `sha256:${"2".repeat(64)}`,
      classification: "normative",
    },
  ];
  const pathBytes = Buffer.from(`${files.map(({ path }) => path).join("\n")}\n`);
  const documentBytes = Buffer.from(
    files.map(({ path, sha256: digest, classification }) =>
      `${digest}  ${classification}  ${path}\n`).join(""),
  );
  return Buffer.from(
    canonicalJSON({
      format: "takoform.specification-source-snapshot@v1",
      sourceCommit,
      roots: ["spec"],
      files,
      pathSetSha256: `sha256:${createHash("sha256").update(pathBytes).digest("hex")}`,
      documentSetSha256: `sha256:${createHash("sha256").update(documentBytes).digest("hex")}`,
    }),
  );
}

const schemaOriginCandidateBytes = Buffer.from(
  canonicalJSON({
    format: "takoform.schema-origin-candidate@v1",
    worker: "takoform-schema-origin",
    route: SCHEMA_ROUTE,
  }),
);

function noCallbackOperations(counter) {
  return new Proxy(
    {},
    {
      get() {
        return async () => {
          counter.count += 1;
          throw new Error("callback must not be touched");
        };
      },
    },
  );
}

describe("dormant owner-local command contract", () => {
  test("pins the local writer surface and exact phase arguments", () => {
    expect(PINNED_RECORD_KEY_FINGERPRINT).toBe(
      "sha256:a4f2a0811b8d9432a8d5ecea246f768470d78d0ed53214a587ba2f7c238e8cbb",
    );
    expect(SCHEMA_ROUTE).toBe("forms.takoform.com/schemas/*");
    expect(N_TO_E_TRACKED_PATHS).toEqual([CANDIDATE_PATH]);
    expect(E_TO_R_TRACKED_PATHS).toEqual([
      "release/specification-releases.json",
      "release/record-prefix-chain.json",
      "release/record-head.json",
      "release/record-head.sig.json",
    ]);
    expect(SPECIFICATION_TAG_RULESET_PATTERN).toBe(
      "refs/tags/specification/*",
    );
    expect(SPECIFICATION_TAG_RULESET_RULES).toEqual([
      "deletion",
      "update",
    ]);

    expect(
      parseSpecificationReleaseArgs([
        "prepare",
        "--lane",
        "composed",
        "--version",
        VERSION,
        "--expected-d-commit",
        D,
        "--expected-n-commit",
        N,
        "--output",
        "/tmp/specification-candidate.json",
      ]),
    ).toEqual({
      phase: "prepare",
      lane: "composed",
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      output: "/tmp/specification-candidate.json",
    });
    expect(parseSpecificationReleaseArgs([
      "publish",
      "--lane",
      "composed",
      "--version",
      VERSION,
      "--expected-d-commit",
      D,
      "--expected-n-commit",
      N,
      "--expected-e-commit",
      E,
      "--review-record",
      "/operator/specification-review.json",
    ])).toEqual({
      phase: "publish",
      lane: "composed",
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      reviewRecord: "/operator/specification-review.json",
    });
    expect(parseSpecificationReleaseArgs([
      "prepare",
      "--lane",
      "schema",
      "--expected-d-commit",
      D,
      "--expected-n-commit",
      N,
      "--output",
      "/tmp/schema-candidate.json",
    ])).toMatchObject({
      phase: "prepare",
      lane: "schema",
      expectedDCommit: D,
      expectedNCommit: N,
    });
    expect(parseSpecificationReleaseArgs([
      "verify",
      "--lane",
      "schema",
      "--expected-d-commit",
      D,
      "--expected-n-commit",
      N,
      "--expected-e-commit",
      E,
    ])).toEqual({
      phase: "verify",
      lane: "schema",
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
    });

    for (const args of [
      [],
      ["prepare", "--lane", "composed", "--version", VERSION, "--expected-n-commit", N],
      ["prepare", "--lane", "schema", "--version", VERSION, "--expected-d-commit", D, "--expected-n-commit", N, "--output", "/tmp/candidate"],
      ["prepare", "--lane", "composed", "--version", "2.0", "--expected-d-commit", D, "--expected-n-commit", N, "--output", "/tmp/candidate"],
      ["prepare", "--lane", "composed", "--version", "1.1", "--expected-d-commit", D, "--expected-n-commit", N, "--output", "/tmp/candidate"],
      ["prepare", "--lane", "composed", "--version", VERSION, "--version", VERSION, "--expected-d-commit", D, "--expected-n-commit", N, "--output", "/tmp/candidate"],
      ["prepare", "--lane", "composed", "--version", VERSION, "--expected-d-commit", D, "--expected-n-commit", N.toUpperCase(), "--output", "/tmp/candidate"],
      ["publish", "--lane", "composed", "--version", VERSION, "--expected-d-commit", D, "--expected-n-commit", N, "--expected-e-commit", E, "--tag", TAG],
      ["publish", "--lane", "composed", "--version", VERSION, "--expected-d-commit", D, "--expected-n-commit", N, "--expected-e-commit", E, "--review-record", "relative-review.json"],
      ["verify", "--lane", "schema", "--expected-d-commit", D, "--expected-n-commit", N, "--expected-e-commit", E, "--expected-r-commit", R],
      ["verify", "--lane", "specification", "--version", VERSION, "--expected-d-commit", D, "--expected-n-commit", D, "--expected-e-commit", E],
      ["unknown", "--version", VERSION],
    ]) {
      expect(() => parseSpecificationReleaseArgs(args)).toThrow();
    }
  });

  test("every mutation phase rejects prepared authority before any callback", async () => {
    const phases = [
      reserve,
      applySchemaReservation,
      sealRecordArtifact,
      prepare,
      publish,
      recover,
      prepareReceipt,
      record,
    ];
    for (const phase of phases) {
      const counter = { count: 0 };
      await expect(
        phase(
          {
            authority: structuredClone(preparedAuthority),
            version: VERSION,
            expectedCommit: N,
            expectedNCommit: N,
            expectedECommit: E,
            signerCommand: "/operator/record-signer",
          },
          noCallbackOperations(counter),
        ),
      ).rejects.toThrow("prepared-writer-disabled");
      expect(counter.count).toBe(0);
    }
    const counter = { count: 0 };
    await expect(verify(
      { authority: structuredClone(preparedAuthority) },
      noCallbackOperations(counter),
    )).rejects.toThrow("writer is dormant");
    expect(counter.count).toBe(0);
  });

  test("version fencing permanently excludes 1.0, 1.1 and every major 2 identity", () => {
    expect(assertAllowedFutureVersion(VERSION, specificationLedger)).toBe(VERSION);
    for (const value of ["1.0", "1.1", "2.0", "2.1", "v2.0", "1.3"]) {
      expect(() => assertAllowedFutureVersion(value, specificationLedger)).toThrow();
    }
  });
});

describe("external record-head signer", () => {
  const temporary = mkdtempSync(join(tmpdir(), "takoform-spec-signer-"));
  const goodSigner = join(temporary, "good-signer.mjs");
  const wrongSigner = join(temporary, "self-verifying-wrong-signer.mjs");

  beforeAll(() => {
    writeFileSync(goodSigner, signerSource(testKeys.privateKey));
    writeFileSync(wrongSigner, signerSource(wrongKeys.privateKey));
    chmodSync(goodSigner, 0o700);
    chmodSync(wrongSigner, 0o700);
  });

  afterAll(() => rmSync(temporary, { recursive: true, force: true }));

  test("uses only sign --input FILE --output FILE and accepts exact raw Ed25519", async () => {
    const subject = Buffer.from("signed record head\n");
    const signature = await invokeExternalRecordSigner({
      command: goodSigner,
      repositoryRoot: ROOT,
      subject,
      publicKeyPEM: testPublicPEM,
      expectedFingerprint: testFingerprint,
    });
    expect(signature).toHaveLength(64);
  });

  test("rejects a signer whose output verifies only under its own forged key", async () => {
    await expect(
      invokeExternalRecordSigner({
        command: wrongSigner,
        repositoryRoot: ROOT,
        subject: Buffer.from("forged head\n"),
        publicKeyPEM: testPublicPEM,
        expectedFingerprint: testFingerprint,
      }),
    ).rejects.toThrow("independently retained record-head key");
  });

  test("rejects relative, in-repository, symlink and non-executable commands", async () => {
    const linkedSigner = join(temporary, "linked-signer");
    const nonExecutable = join(temporary, "non-executable");
    symlinkSync(goodSigner, linkedSigner);
    writeFileSync(nonExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
    for (const command of [
      "relative-signer",
      join(ROOT, "scripts", "specification-release.mjs"),
      linkedSigner,
      nonExecutable,
    ]) {
      await expect(
        invokeExternalRecordSigner({
          command,
          repositoryRoot: ROOT,
          subject: Buffer.from("x"),
          publicKeyPEM: testPublicPEM,
          expectedFingerprint: testFingerprint,
        }),
      ).rejects.toThrow();
    }
  });
});

describe("additions-only schema reservation", () => {
  test("appends one active identity, one seal and one signed-head candidate", () => {
    const current = repositoryState();
    const addition = newSchema();
    const next = buildSchemaReservation({
      version: VERSION,
      state: current,
      additions: [addition.entry],
    });
    expect(next.schemaLedger.identities.slice(0, -1)).toEqual(schemaLedger.identities);
    expect(next.schemaLedger.identities.at(-1)).toEqual(addition.entry);
    expect(next.schemaLedger.retired).toEqual(schemaLedger.retired);
    expect(next.prefixChain.publicSchemaIdentities).toHaveLength(2);
    expect(next.prefixChain.specificationReleases).toEqual(
      prefixChain.specificationReleases,
    );
    expect(next.recordHead.generation).toBe(2);
    expect(next.recordHead.specificationReleases).toEqual(
      JSON.parse(retainedHeadRaw).specificationReleases,
    );
  });

  test("rejects overwrite, movement, retirement, reactivation and duplicate identity/source/path", () => {
    const addition = newSchema();
    const current = repositoryState();
    const retired = schemaLedger.retired[0];
    const cases = [
      { ...addition.entry, id: schemaLedger.identities[0].id },
      { ...addition.entry, source: schemaLedger.identities[0].source },
      { ...addition.entry, public: schemaLedger.identities[0].public },
      { ...addition.entry, sha256: schemaLedger.identities[0].sha256 },
      { ...addition.entry, id: retired.id },
      { ...addition.entry, source: retired.source },
      { ...addition.entry, public: retired.public },
      { ...addition.entry, retiredBecause: "move to retired" },
      { ...addition.entry, id: "https://forms.takoform.com/schemas/v2/forbidden.schema.json" },
    ];
    for (const changed of cases) {
      expect(() =>
        buildSchemaReservation({
          version: VERSION,
          state: current,
          additions: [changed],
        }),
      ).toThrow();
    }
    expect(() =>
      buildSchemaReservation({
        version: VERSION,
        state: current,
        additions: [addition.entry, structuredClone(addition.entry)],
      }),
    ).toThrow();
  });

  test("reserve derives D exactly and prepares unsigned bytes without signer or writer", async () => {
    const addition = newSchema("derived-reservation");
    let writes = 0;
    const state = { ...repositoryState(), headCommit: D };
    const result = await reserve(
      {
        authority: activeAuthority(),
        expectedDCommit: D,
        additions: [{ id: "https://attacker.invalid/arbitrary.schema.json" }],
      },
      {
        verifySourcePinnedExecution: async (request) =>
          exactWriterClosure(request, D),
        readReservationState: async () => state,
        readCanonicalSchemaTree: async () => canonicalSchemaFiles([addition]),
        writeTrackedFiles: async () => {
          writes += 1;
        },
      },
      TEST_RUNTIME,
    );
    expect(result.status).toBe("reservation-prepared");
    expect(result.additions).toEqual([{
      ...addition.entry,
      public: addition.entry.id.replace(
        "https://forms.takoform.com/",
        "website/public/",
      ),
    }]);
    expect(result.unsignedArtifact.document.purpose).toBe(
      "schema-reservation",
    );
    expect(writes).toBe(0);
  });

  test("zero derived additions returns exact N=D without a fake seal or signer", async () => {
    const state = { ...repositoryState(), headCommit: D };
    const result = await reserve(
      { authority: activeAuthority(), expectedDCommit: D },
      {
        verifySourcePinnedExecution: async (request) =>
          exactWriterClosure(request, D),
        readReservationState: async () => state,
        readCanonicalSchemaTree: async () => canonicalSchemaFiles(),
      },
      TEST_RUNTIME,
    );
    expect(result).toEqual({
      status: "no-reservation",
      dCommit: D,
      nCommit: D,
      additions: [],
      unsignedArtifact: null,
    });
  });

  test("seal and apply are separate; apply writes only four verified reservation records", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "takoform-reserve-good-"));
    const signer = join(temporary, "signer");
    writeFileSync(signer, signerSource(testKeys.privateKey), { mode: 0o700 });
    const addition = newSchema("reserved");
    let files = null;
    try {
      const state = { ...repositoryState(), headCommit: D };
      const prepared = await reserve(
        {
          authority: activeAuthority(),
          expectedDCommit: D,
        },
        {
          verifySourcePinnedExecution: async (request) =>
            exactWriterClosure(request, D),
          readReservationState: async () => state,
          readCanonicalSchemaTree: async () => canonicalSchemaFiles([addition]),
        },
        TEST_RUNTIME,
      );
      const sealed = await sealRecordArtifact({
        authority: activeAuthority(),
        unsignedArtifactRaw: prepared.unsignedArtifact.raw,
        signerCommand: signer,
        repositoryRoot: ROOT,
        environment: { PATH: process.env.PATH },
      });
      const result = await applySchemaReservation(
        {
          authority: activeAuthority(),
          expectedDCommit: D,
          sealedArtifactRaw: sealed.raw,
        },
        {
          verifySourcePinnedExecution: async (request) =>
            exactWriterClosure(request, D),
          readReservationState: async () => state,
          writeTrackedFiles: async (next) => {
            files = next;
          },
        },
        TEST_RUNTIME,
      );
      expect([...files.keys()]).toEqual([
        "release/public-schema-identities.json",
        "release/record-prefix-chain.json",
        "release/record-head.json",
        "release/record-head.sig.json",
      ]);
      expect(result.additions).toEqual(prepared.additions);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});

describe("N to E to R release choreography", () => {
  const temporary = mkdtempSync(join(tmpdir(), "takoform-spec-flow-"));
  const signer = join(temporary, "record-signer");

  beforeAll(() => {
    writeFileSync(signer, signerSource(testKeys.privateKey), { mode: 0o700 });
  });
  afterAll(() => rmSync(temporary, { recursive: true, force: true }));

  async function preparedFixture() {
    const reserved = signedStateAfterReservation();
    let candidateRaw = null;
    const candidate = await prepare(
      {
        authority: activeAuthority(),
        lane: "composed",
        version: VERSION,
        expectedDCommit: D,
        expectedNCommit: N,
        output: "/tmp/takoform-specification-release-candidate.json",
      },
      {
        verifySourcePinnedExecution: async (request) =>
          exactWriterClosure(request, N),
        readPreparationState: async () => ({
          ...structuredClone(reserved.state),
          reservationTransition: {
            fromCommit: D,
            toCommit: N,
            parents: [D],
            changedPaths: [
              "release/public-schema-identities.json",
              "release/record-prefix-chain.json",
              "release/record-head.json",
              "release/record-head.sig.json",
            ],
          },
        }),
        buildSpecificationSourceSnapshot: async ({ commit }) => {
          expect(commit).toBe(D);
          return sourceSnapshotBytes(D);
        },
        buildSchemaOriginCandidate: async ({ route }) => {
          expect(route).toBe(SCHEMA_ROUTE);
          return schemaOriginCandidateBytes;
        },
        writeCandidate: async ({ path, bytes }) => {
          expect(path).toBe("/tmp/takoform-specification-release-candidate.json");
          candidateRaw = Buffer.from(bytes);
        },
      },
      TEST_RUNTIME,
    );
    expect(candidateRaw.equals(candidate.raw)).toBe(true);
    expect(validatePreparedCandidate(candidateRaw, reserved.state)).toEqual([]);
    return { ...reserved, candidate: candidate.document, candidateRaw };
  }

  function transition(changedPaths = N_TO_E_TRACKED_PATHS) {
    return {
      fromCommit: N,
      toCommit: E,
      parents: [N],
      changedPaths: [...changedPaths],
    };
  }

  function liveOperations(fixture, order, options = {}) {
    let routeActive = options.routeActive ?? false;
    let tag = options.tag ?? null;
    let releaseReceipt = options.release ?? null;
    const additions = new Set(
      fixture.candidate.schemaOrigin.additions.map(({ id }) => id),
    );
    const byID = new Map(
      fixture.state.schemaLedger.identities.map((entry) => [entry.id, entry]),
    );
    const sourceBytes = new Map(
      fixture.state.schemaLedger.identities.map((entry) => [
        entry.source,
        entry.id === fixture.addition.entry.id
          ? fixture.addition.bytes
          : readFileSync(join(ROOT, entry.source)),
      ]),
    );
    const absentTag = () => ({ status: 404, tag: TAG });
    const absentRelease = () => ({ status: 404, tag: TAG });
    const exactTag = () => ({
      status: 200,
      tag: TAG,
      targetCommit: E,
      tagObject: "9".repeat(40),
      annotated: true,
      signed: true,
      signatureVerified: true,
    });
    const exactRelease = () => ({
      status: 200,
      tag: TAG,
      id: 1200,
      url: `https://github.com/tako0614/takoform/releases/tag/${TAG}`,
      body: fixture.candidate.githubRelease.body,
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [],
    });
    const auditToken = Object.freeze({ opaqueAuditAuthority: true });
    return {
      readPublishState: async () => ({
        ...structuredClone(fixture.state),
        candidateRaw: Buffer.from(fixture.candidateRaw),
        headCommit: E,
        evidenceTransition: transition(options.changedPaths),
      }),
      readRecoveryState: async () => ({
        ...structuredClone(fixture.state),
        candidateRaw: Buffer.from(fixture.candidateRaw),
        headCommit: E,
        evidenceTransition: transition(options.changedPaths),
      }),
      readRecordState: async () => ({
        ...structuredClone(fixture.state),
        candidateRaw: Buffer.from(fixture.candidateRaw),
        headCommit: E,
        evidenceTransition: transition(options.changedPaths),
      }),
      readVerificationState: async () => ({
        ...structuredClone(fixture.recordedState ?? fixture.state),
        candidateRaw: Buffer.from(fixture.candidateRaw),
        headCommit: fixture.recordedState
          ? (fixture.canonicalMainCommit ?? R)
          : E,
        evidenceTransition: transition(),
        sourceRecordFiles: fixture.sourceRecordFiles,
        receiptLineage: fixture.receiptLineage,
      }),
      verifySourcePinnedExecution: async (request) =>
        exactWriterClosure(request),
      verifySpecificationSourceSnapshot: async (request) => {
        const expected = Buffer.from(
          fixture.candidate.sourceSnapshot.bytesBase64,
          "base64",
        );
        expect(request.commit).toBe(D);
        expect(Buffer.from(request.snapshotBytes)).toEqual(expected);
        expect(request.snapshotSha256).toBe(
          fixture.candidate.sourceSnapshot.sha256,
        );
        return {
          commit: request.commit,
          snapshotSha256: request.snapshotSha256,
          exact: true,
        };
      },
      verifyIndependentReview: async (request) => {
        order.push(`review:${request.recovery ? "recover" : "publish"}`);
        return {
          format: "takoform.specification-release-independent-review@v1",
          approved: true,
          reviewer: "independent-reviewer",
          reviewedAt: "2026-08-27T13:00:00Z",
          lanes: structuredClone(request.lanes),
          version: request.version,
          expectedDCommit: request.expectedDCommit,
          expectedNCommit: request.expectedNCommit,
          expectedECommit: request.expectedECommit,
          candidateSha256: request.candidateSha256,
          schemaOriginCandidateSha256:
            request.schemaOriginCandidateSha256,
          recovery: request.recovery,
          reviewed: [...request.reviewed],
        };
      },
      acquireTagProtectionAuditToken: async (request) => {
        order.push(`ruleset:credentials:${request.phase}`);
        expect(request).toEqual({
          surface: "takoform-specification-tag-ruleset",
          version: VERSION,
          phase: request.phase,
        });
        return auditToken;
      },
      verifyTagProtectionRuleset: async (request) => {
        order.push("ruleset:audit");
        expect(request).toEqual({
          tag: TAG,
          expectedPattern: SPECIFICATION_TAG_RULESET_PATTERN,
          auditToken,
        });
        return structuredClone(TAG_RULESET);
      },
      readSchemaSource: async (source) => Buffer.from(sourceBytes.get(source)),
      readHTTP: async (url) => {
        order.push(`http:${routeActive ? "after" : "before"}:${url}`);
        const entry = byID.get(url);
        if (entry && (routeActive || !additions.has(url))) {
          return {
            status: 200,
            url,
            redirected: false,
            bytes: Buffer.from(sourceBytes.get(entry.source)),
          };
        }
        return { status: 404, url, redirected: false, bytes: Buffer.from("not found\n") };
      },
      readSchemaOriginStage: async () => ({ status: 404, candidateSha256: fixture.candidate.schemaOrigin.candidateSha256 }),
      prepareSchemaToolClosure: async (request) => {
        order.push("schema:seal-tools");
        return {
          format: "takoform.sealed-schema-tool-closure@v1",
          ...request,
          manifestSha256: `sha256:${"8".repeat(64)}`,
          fileCount: 100,
        };
      },
      acquireCredentials: async () => {
        order.push("credentials");
        return { opaque: true };
      },
      stageSchemaOrigin: async () => {
        order.push("schema:stage");
        return { stageID: "stage-1", candidateSha256: fixture.candidate.schemaOrigin.candidateSha256 };
      },
      verifyStagedSchemaOrigin: async (stage) => {
        order.push("schema:verify-stage");
        return { ...stage, exact: true };
      },
      activateSchemaRoute: async ({ route }) => {
        expect(route).toBe(SCHEMA_ROUTE);
        order.push("schema:activate");
        routeActive = true;
      },
      readTag: async () => tag ?? absentTag(),
      readRelease: async () => releaseReceipt ?? absentRelease(),
      createSignedAnnotatedTag: async () => {
        order.push("release:create-tag");
        tag = exactTag();
      },
      createImmutableRelease: async (request) => {
        fixture.releaseRequest = request;
        expect(request).toMatchObject({
          tag: TAG,
          targetCommit: E,
          title: `Takoform Specification ${VERSION}`,
          body: fixture.candidate.githubRelease.body,
          draft: false,
          prerelease: false,
          assets: [],
          immutable: true,
          createOnly: true,
          direct: true,
        });
        order.push("release:create");
        releaseReceipt = exactRelease();
      },
      tryRecordSpecificationReceipt: async (request) => {
        expect(request.sourceCommit).toBe(E);
        expect(request.expectedPaths).toEqual(E_TO_R_TRACKED_PATHS);
        order.push("record:cas");
        const files = request.files;
        fixture.recordFiles = files;
        fixture.recordedState = {
          specificationLedger: JSON.parse(files.get("release/specification-releases.json")),
          schemaLedger: fixture.state.schemaLedger,
          prefixChain: JSON.parse(files.get("release/record-prefix-chain.json")),
          recordHeadRaw: files.get("release/record-head.json"),
          recordHeadSignature: JSON.parse(files.get("release/record-head.sig.json")),
          recordHeadPublicKeyPEM: testPublicPEM,
        };
        fixture.sourceRecordFiles = stateRecordFiles(fixture.state);
        const sourceRecords = recordDescriptors(
          fixture.sourceRecordFiles,
          "1",
        );
        const receiptRecords = recordDescriptors(files, "a");
        const canonicalMainCommit = fixture.canonicalMainCommit ?? R;
        fixture.receiptLineage = {
          sourceCommit: E,
          parentCommit: P,
          receiptCommit: R,
          canonicalMainCommit,
          receiptParents: [P],
          parentFirstParentHistory: [P, E, N],
          currentFirstParentHistory: canonicalMainCommit === R
            ? [R, P, E, N]
            : [canonicalMainCommit, R, P, E, N],
          sourceRecords,
          parentRecords: structuredClone(sourceRecords),
          receiptRecords,
          currentRecords: structuredClone(receiptRecords),
          changedPaths: [...E_TO_R_TRACKED_PATHS],
        };
        return {
          status: "recorded",
          lineage: structuredClone(fixture.receiptLineage),
        };
      },
      observed: () => ({ routeActive, tag, release: releaseReceipt }),
    };
  }

  async function sealFreshReceipt(operations) {
    const prepared = await prepareReceipt({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
    }, operations, TEST_RUNTIME);
    return await sealRecordArtifact({
      authority: activeAuthority(),
      unsignedArtifactRaw: prepared.unsignedArtifact.raw,
      signerCommand: signer,
      repositoryRoot: ROOT,
      environment: { PATH: process.env.PATH },
    });
  }

  test("prepare emits one closed source-snapshot/schema-origin candidate", async () => {
    const fixture = await preparedFixture();
    expect(fixture.candidate).toMatchObject({
      format: "takoform.publication-candidate@v1",
      version: VERSION,
      tag: TAG,
      canonicalCommit: D,
      normativeCommit: D,
      reservationCommit: N,
      schemaOrigin: {
        route: SCHEMA_ROUTE,
        additions: [fixture.addition.entry],
      },
    });
    expect(JSON.stringify(fixture.candidate)).not.toContain("/v2");

    const open = structuredClone(fixture.candidate);
    open.schemaOrigin.untracked = true;
    expect(validatePreparedCandidate(
      Buffer.from(canonicalJSON(open)),
      fixture.state,
    )).toContain("Specification release candidate has an open nested envelope");
  });

  test("prepare rejects API v2 hidden inside opaque schema-origin candidate bytes", async () => {
    const reserved = signedStateAfterReservation();
    let writes = 0;
    await expect(
      prepare(
        {
          authority: activeAuthority(),
          lane: "composed",
          version: VERSION,
          expectedDCommit: D,
          expectedNCommit: N,
          output: "/tmp/forbidden-candidate.json",
        },
        {
          verifySourcePinnedExecution: async (request) =>
            exactWriterClosure(request, N),
          readPreparationState: async () => ({
            ...structuredClone(reserved.state),
            reservationTransition: {
              fromCommit: D,
              toCommit: N,
              parents: [D],
              changedPaths: [
                "release/public-schema-identities.json",
                "release/record-prefix-chain.json",
                "release/record-head.json",
                "release/record-head.sig.json",
              ],
            },
          }),
          buildSpecificationSourceSnapshot: async () => sourceSnapshotBytes(D),
          buildSchemaOriginCandidate: async () => Buffer.from(
            canonicalJSON({
              format: "takoform.schema-origin-candidate@v1",
              route: "forms.takoform.com/schemas/v2/*",
            }),
          ),
          writeCandidate: async () => {
            writes += 1;
          },
        },
        TEST_RUNTIME,
      ),
    ).rejects.toThrow("forbidden API/Specification v2");
    expect(writes).toBe(0);
  });

  test("enforces the direct evidence-only N to E path edge", () => {
    expect(validateTrackedTransition(transition(), N, E, N_TO_E_TRACKED_PATHS)).toEqual([]);
    expect(
      validateTrackedTransition(
        transition([...N_TO_E_TRACKED_PATHS, "spec/README.md"]),
        N,
        E,
        N_TO_E_TRACKED_PATHS,
      ),
    ).toContain("tracked paths must be exactly release/specification-release-candidate.json");
  });

  test("rejects live 200/404 ambiguity before schema or release mutation", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const operations = liveOperations(fixture, order);
    operations.readHTTP = async (url) => ({
      status: [200, 404],
      url,
      redirected: false,
      bytes: Buffer.alloc(0),
    });
    await expect(
      publish(
        {
          authority: activeAuthority(),
          version: VERSION,
          expectedDCommit: D,
          expectedNCommit: N,
          expectedECommit: E,
          reviewRecord: "/operator/specification-review.json",
        },
        operations,
        TEST_RUNTIME,
      ),
    ).rejects.toThrow("closed HTTP readback");
    expect(order).not.toContain("schema:stage");
    expect(order).not.toContain("release:create-tag");
  });

  test("a forged independent review blocks credentials and every mutation", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const operations = liveOperations(fixture, order);
    operations.verifyIndependentReview = async (request) => ({
      format: "takoform.specification-release-independent-review@v1",
      approved: true,
      reviewer: "self-asserted-reviewer",
      reviewedAt: "2026-08-27T13:00:00Z",
      lanes: structuredClone(request.lanes),
      version: request.version,
      expectedDCommit: request.expectedDCommit,
      expectedNCommit: request.expectedNCommit,
      expectedECommit: request.expectedECommit,
      candidateSha256: `sha256:${"0".repeat(64)}`,
      schemaOriginCandidateSha256: request.schemaOriginCandidateSha256,
      recovery: request.recovery,
      reviewed: [...request.reviewed],
    });
    await expect(publish({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      reviewRecord: "/operator/forged-review.json",
    }, operations, TEST_RUNTIME)).rejects.toThrow(
      "independent review record is incomplete or bound to another",
    );
    expect(order).not.toContain("credentials");
    expect(order.some((entry) => entry.startsWith("ruleset:credentials:"))).toBe(false);
    expect(order).not.toContain("schema:stage");
    expect(order).not.toContain("release:create-tag");
    expect(order).not.toContain("release:create");
  });

  test("a bypassed or wrongly typed tag ruleset blocks tag and Release creation", async () => {
    for (const ruleset of [
      { ...structuredClone(TAG_RULESET), bypassActors: [{ actorId: 1 }] },
      {
        ...structuredClone(TAG_RULESET),
        rules: ["deletion", "required_signatures"],
      },
    ]) {
      const fixture = await preparedFixture();
      const order = [];
      const operations = liveOperations(fixture, order);
      operations.verifyTagProtectionRuleset = async () => ruleset;
      await expect(publish({
        authority: activeAuthority(),
        version: VERSION,
        expectedDCommit: D,
        expectedNCommit: N,
        expectedECommit: E,
        reviewRecord: "/operator/specification-review.json",
      }, operations, TEST_RUNTIME)).rejects.toThrow(
        "tag ruleset must be exact, active",
      );
      expect(order).not.toContain("release:create-tag");
      expect(order).not.toContain("release:create");
    }
  });

  test("publishes schema before release and records only after live readback", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const operations = liveOperations(fixture, order);
    const published = await publish(
      {
        authority: activeAuthority(),
        version: VERSION,
        expectedDCommit: D,
        expectedNCommit: N,
        expectedECommit: E,
        reviewRecord: "/operator/specification-review.json",
      },
      operations,
      TEST_RUNTIME,
    );
    expect(published.release.immutable).toBe(true);
    expect(published.release.assets).toEqual([]);
    expect(published.tagProtectionRuleset).toEqual(TAG_RULESET);
    expect(fixture.releaseRequest.assets).toEqual([]);
    expect(fixture.releaseRequest.draft).toBe(false);

    const sealedReceipt = await sealFreshReceipt(operations);
    await record(
      {
        authority: activeAuthority(),
        version: VERSION,
        expectedDCommit: D,
        expectedNCommit: N,
        expectedECommit: E,
        sealedArtifactRaw: sealedReceipt.raw,
      },
      operations,
      TEST_RUNTIME,
    );
    expect([...fixture.recordFiles.keys()]).toEqual(E_TO_R_TRACKED_PATHS);
    expect(order.indexOf("schema:activate")).toBeLessThan(
      order.indexOf("release:create-tag"),
    );
    expect(order.indexOf("review:publish")).toBeLessThan(
      order.indexOf("ruleset:credentials:publish"),
    );
    expect(order.indexOf("review:publish")).toBeLessThan(
      order.indexOf("credentials"),
    );
    const tagCreateIndex = order.indexOf("release:create-tag");
    const releaseCreateIndex = order.indexOf("release:create");
    expect(order[tagCreateIndex - 1]).toBe("ruleset:audit");
    expect(order[releaseCreateIndex - 1]).toBe("ruleset:audit");
    expect(order.indexOf("release:create")).toBeLessThan(
      order.indexOf("record:cas"),
    );
    expect(JSON.stringify(fixture.recordedState.specificationLedger)).not.toContain(
      "forms.takoform.com/v2",
    );
    const recordedReceipt = fixture.recordedState.specificationLedger.releases.at(-1);
    expect(recordedReceipt.assets).toEqual([]);
    expect(recordedReceipt.tagProtectionRuleset).toEqual(TAG_RULESET);
    expect(recordedReceipt.release).toMatchObject({
      draft: false,
      prerelease: false,
      immutable: true,
    });

    const mutationOrderBeforeVerify = order.filter((entry) =>
      [
        "schema:stage",
        "schema:activate",
        "release:create-tag",
        "release:create",
        "record:cas",
      ].includes(entry),
    );
    const verification = await verify(
      {
        authority: activeAuthority(),
        version: VERSION,
        expectedDCommit: D,
        expectedNCommit: N,
        expectedECommit: E,
        expectedRCommit: R,
      },
      operations,
      TEST_RUNTIME,
    );
    expect(verification.status).toBe("verified");
    expect(order.filter((entry) => mutationOrderBeforeVerify.includes(entry))).toEqual(
      mutationOrderBeforeVerify,
    );
  });

  test("recovery performs only the exact missing forward release step", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const exactTag = {
      status: 200,
      tag: TAG,
      targetCommit: E,
      tagObject: "9".repeat(40),
      annotated: true,
      signed: true,
      signatureVerified: true,
    };
    const operations = liveOperations(fixture, order, {
      routeActive: true,
      tag: exactTag,
    });
    const recovered = await recover(
      {
        authority: activeAuthority(),
        version: VERSION,
        expectedDCommit: D,
        expectedNCommit: N,
        expectedECommit: E,
        reviewRecord: "/operator/specification-review.json",
      },
      operations,
      TEST_RUNTIME,
    );
    expect(recovered.release.immutable).toBe(true);
    expect(order).not.toContain("schema:stage");
    expect(order).not.toContain("schema:activate");
    expect(order).not.toContain("release:create-tag");
    expect(order).toContain("release:create");
  });

  test("receipt CAS retries from the unchanged E records without republishing", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const operations = liveOperations(fixture, order);
    await publish({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      reviewRecord: "/operator/specification-review.json",
    }, operations, TEST_RUNTIME);
    const sealedReceipt = await sealFreshReceipt(operations);
    const recorded = operations.tryRecordSpecificationReceipt;
    let attempts = 0;
    operations.tryRecordSpecificationReceipt = async (request) => {
      attempts += 1;
      if (attempts !== 1) return await recorded(request);
      order.push("record:cas-lost");
      const sourceFiles = stateRecordFiles(fixture.state);
      const sourceRecords = recordDescriptors(sourceFiles, "1");
      return {
        status: "cas-lost",
        sourceCommit: E,
        parentCommit: P,
        receiptCommit: "7".repeat(40),
        canonicalMainCommit: P,
        currentFirstParentHistory: [P, E, N],
        sourceRecords,
        currentRecords: structuredClone(sourceRecords),
      };
    };
    const result = await record({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      sealedArtifactRaw: sealedReceipt.raw,
    }, operations, TEST_RUNTIME);
    expect(result.attempt).toBe(2);
    expect(attempts).toBe(2);
    expect(order.filter((entry) => entry === "release:create-tag")).toHaveLength(1);
    expect(order.filter((entry) => entry === "release:create")).toHaveLength(1);
    expect(order).toContain("record:cas-lost");
  });

  test("record rejects a forged E execution closure before audit, signer, or CAS", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const operations = liveOperations(fixture, order, { routeActive: true });
    operations.verifySourcePinnedExecution = async (request) => {
      const observation = exactWriterClosure(request);
      delete observation.checkpoints.at(-1).pathObjects[request.paths[0]];
      return observation;
    };
    await expect(record({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
    }, operations, TEST_RUNTIME)).rejects.toThrow(
      "writer execution is not pinned to immutable P0",
    );
    expect(order.some((entry) => entry.startsWith("ruleset:credentials:"))).toBe(false);
    expect(order).not.toContain("ruleset:audit");
    expect(order).not.toContain("record:cas");
  });

  test("verify permits later first-parent main only while the four R record blobs remain exact", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const operations = liveOperations(fixture, order);
    await publish({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      reviewRecord: "/operator/specification-review.json",
    }, operations, TEST_RUNTIME);
    const sealedReceipt = await sealFreshReceipt(operations);
    await record({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      sealedArtifactRaw: sealedReceipt.raw,
    }, operations, TEST_RUNTIME);
    const later = "7".repeat(40);
    fixture.canonicalMainCommit = later;
    fixture.receiptLineage.canonicalMainCommit = later;
    fixture.receiptLineage.currentFirstParentHistory = [later, R, P, E, N];
    expect((await verify({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      expectedRCommit: R,
    }, operations, TEST_RUNTIME)).canonicalMainCommit).toBe(later);

    fixture.receiptLineage.currentRecords = structuredClone(
      fixture.receiptLineage.currentRecords,
    );
    fixture.receiptLineage.currentRecords[E_TO_R_TRACKED_PATHS[0]].objectId =
      "f".repeat(40);
    await expect(verify({
      authority: activeAuthority(),
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      expectedRCommit: R,
    }, operations, TEST_RUNTIME)).rejects.toThrow(
      "later canonical main rewrote the four record blobs",
    );
  });

  test("recovery halts when a release identity appeared before schema activation", async () => {
    const fixture = await preparedFixture();
    const order = [];
    const operations = liveOperations(fixture, order, {
      routeActive: false,
      tag: {
        status: 200,
        tag: TAG,
        targetCommit: E,
        tagObject: "9".repeat(40),
        annotated: true,
        signed: true,
        signatureVerified: true,
      },
    });
    await expect(
      recover(
        {
          authority: activeAuthority(),
          version: VERSION,
          expectedDCommit: D,
          expectedNCommit: N,
          expectedECommit: E,
          reviewRecord: "/operator/specification-review.json",
        },
        operations,
        TEST_RUNTIME,
      ),
    ).rejects.toThrow("schema route must be live before any Specification tag");
    expect(order).not.toContain("schema:stage");
    expect(order).not.toContain("credentials");
  });
});

describe("P1 immutable writer and split-lane authority", () => {
  test("P0 is the immutable complete writer root across D, N, E and current", () => {
    expect(WRITER_CLOSURE_MANIFEST_PATH).toBe(
      "release/authority/specification-writer-closure.json",
    );
    expect(WRITER_EXECUTION_PATHS).toEqual([
      "bun.lock",
      "package.json",
      "release/authority/core-tag-allowed-signers",
      "release/authority/record-head-ed25519.pub.pem",
      "release/authority/specification-schema-tool-closure.json",
      "release/authority/specification-writer-closure.json",
      "release/authority/specification-writer-rotations.json",
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
    const pathObjects = Object.fromEntries(
      WRITER_EXECUTION_PATHS.map((path, index) => [
        path,
        `${(index % 9) + 1}`.repeat(40),
      ]),
    );
    const observed = {
      prepared: { commit: P0, pathObjects: structuredClone(pathObjects) },
      checkpoints: [D, N, E].map((commit) => ({
        commit,
        pathObjects: structuredClone(pathObjects),
      })),
      current: { commit: R, pathObjects: structuredClone(pathObjects) },
    };
    expect(validateWriterExecutionClosureObservation(observed, {
      authority: activeAuthority(),
      checkpoints: [D, N, E],
    }).prepared.commit).toBe(P0);

    for (const changedPath of [
      "scripts/records.mjs",
      "scripts/schema-origin-projection.mjs",
      "scripts/core-release.mjs",
      "package.json",
      "bun.lock",
      "release/authority/specification-schema-tool-closure.json",
      "schema-origin/wrangler.jsonc",
    ]) {
      const forged = structuredClone(observed);
      forged.checkpoints[2].pathObjects[changedPath] = "f".repeat(40);
      expect(() => validateWriterExecutionClosureObservation(forged, {
        authority: activeAuthority(),
        checkpoints: [D, N, E],
      })).toThrow(`immutable P0 writer blob changed at E: ${changedPath}`);
    }
  });

  test("derives every unrecorded schema from exact D bytes and defines N=D for zero additions", () => {
    const addition = newSchema("derived-only");
    const derived = deriveUnrecordedPublicSchemas({
      ledger: schemaLedger,
      files: [
        { source: addition.entry.source, bytes: addition.bytes },
        ...[...schemaLedger.identities, ...schemaLedger.retired].map((entry) => ({
          source: entry.source,
          bytes: readFileSync(join(ROOT, entry.source)),
        })),
      ],
    });
    expect(derived).toEqual([{
      ...addition.entry,
      public: addition.entry.id.replace(
        "https://forms.takoform.com/",
        "website/public/",
      ),
    }]);
    expect(validateDToNTransition({
      dCommit: D,
      nCommit: D,
      additions: [],
      transition: null,
    })).toEqual({ kind: "no-reservation", dCommit: D, nCommit: D });
    expect(() => validateDToNTransition({
      dCommit: D,
      nCommit: N,
      additions: [],
      transition: {
        fromCommit: D,
        toCommit: N,
        parents: [D],
        changedPaths: ["release/public-schema-identities.json"],
      },
    })).toThrow("zero schema additions require N to equal D");
  });

  test("a Specification-only 1.x candidate has no schema mutation or Cloudflare prerequisite", () => {
    const state = repositoryState();
    state.headCommit = D;
    const candidate = buildPreparedCandidate({
      lane: "specification",
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: D,
      state,
      sourceSnapshotRaw: sourceSnapshotBytes(D),
      schemaOriginCandidateRaw: null,
    });
    expect(candidate.document.lanes).toEqual({
      specification: true,
      schema: false,
    });
    expect(candidate.document.schemaOrigin).toBeNull();
    expect(candidate.document.schemaReservation).toBeNull();
    expect(candidate.document.githubRelease.assets).toEqual([]);
    expect(candidate.document.githubRelease.body).not.toContain(
      "Schema-origin candidate:",
    );
  });

  test("schema-only publication activates schemas without minting any Specification identity", async () => {
    const reserved = signedStateAfterReservation(newSchema("schema-lane"));
    const built = buildPreparedCandidate({
      lane: "schema",
      version: null,
      expectedDCommit: D,
      expectedNCommit: N,
      state: reserved.state,
      sourceSnapshotRaw: null,
      schemaOriginCandidateRaw: schemaOriginCandidateBytes,
    });
    const fixture = {
      ...reserved,
      candidate: built.document,
      candidateRaw: built.raw,
    };
    const order = [];
    let routeActive = false;
    const additions = new Set(
      fixture.candidate.schemaOrigin.additions.map(({ id }) => id),
    );
    const byID = new Map(
      fixture.state.schemaLedger.identities.map((entry) => [entry.id, entry]),
    );
    const sourceBytes = new Map(
      fixture.state.schemaLedger.identities.map((entry) => [
        entry.source,
        entry.id === fixture.addition.entry.id
          ? fixture.addition.bytes
          : readFileSync(join(ROOT, entry.source)),
      ]),
    );
    const operations = {
      verifySourcePinnedExecution: async (request) =>
        exactWriterClosure(request),
      readPublishState: async () => ({
        ...structuredClone(fixture.state),
        candidateRaw: Buffer.from(fixture.candidateRaw),
        headCommit: E,
        evidenceTransition: {
          fromCommit: N,
          toCommit: E,
          parents: [N],
          changedPaths: [CANDIDATE_PATH],
        },
      }),
      readSchemaVerificationState: async () => ({
        ...structuredClone(fixture.state),
        candidateRaw: Buffer.from(fixture.candidateRaw),
        headCommit: E,
        evidenceTransition: {
          fromCommit: N,
          toCommit: E,
          parents: [N],
          changedPaths: [CANDIDATE_PATH],
        },
      }),
      readSchemaSource: async (source) => Buffer.from(sourceBytes.get(source)),
      readHTTP: async (url) => {
        const entry = byID.get(url);
        if (entry && (routeActive || !additions.has(url))) {
          return {
            status: 200,
            url,
            redirected: false,
            bytes: Buffer.from(sourceBytes.get(entry.source)),
          };
        }
        return {
          status: 404,
          url,
          redirected: false,
          bytes: Buffer.from("not found\n"),
        };
      },
      verifyIndependentReview: async ({ path: _path, ...request }) => ({
        format: "takoform.specification-release-independent-review@v1",
        approved: true,
        reviewer: "independent-reviewer",
        reviewedAt: "2026-08-27T13:00:00Z",
        ...structuredClone(request),
      }),
      prepareSchemaToolClosure: async (request) => ({
        format: "takoform.sealed-schema-tool-closure@v1",
        ...request,
        manifestSha256: `sha256:${"8".repeat(64)}`,
        fileCount: 100,
      }),
      acquireCredentials: async (request) => {
        expect(request).toEqual({
          surface: "takoform-schema-publication",
          version: null,
          lanes: { specification: false, schema: true },
        });
        return { cloudflareOnly: true };
      },
      readSchemaOriginStage: async () => ({
        status: 404,
        candidateSha256: fixture.candidate.schemaOrigin.candidateSha256,
      }),
      stageSchemaOrigin: async () => {
        order.push("schema:stage");
        return {
          stageID: "schema-stage",
          candidateSha256: fixture.candidate.schemaOrigin.candidateSha256,
        };
      },
      verifyStagedSchemaOrigin: async (stage) => ({ ...stage, exact: true }),
      activateSchemaRoute: async () => {
        routeActive = true;
        order.push("schema:activate");
      },
    };
    for (const name of [
      "readTag",
      "readRelease",
      "acquireTagProtectionAuditToken",
      "verifyTagProtectionRuleset",
      "createSignedAnnotatedTag",
      "createImmutableRelease",
    ]) {
      operations[name] = async () => {
        throw new Error(`schema-only publication touched ${name}`);
      };
    }
    const result = await publish({
      authority: activeAuthority(),
      lane: "schema",
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
      reviewRecord: "/operator/schema-review.json",
    }, operations, TEST_RUNTIME);
    expect(result.status).toBe("schema-published");
    expect(result.candidate.version).toBeNull();
    expect(result.candidate.tag).toBeNull();
    expect(result.tag).toBeNull();
    expect(result.release).toBeNull();
    expect(order).toContain("schema:activate");
    expect(order).not.toContain("ruleset:audit");
    expect(order).not.toContain("release:create-tag");
    expect(order).not.toContain("release:create");
    expect(await verify({
      authority: activeAuthority(),
      lane: "schema",
      expectedDCommit: D,
      expectedNCommit: N,
      expectedECommit: E,
    }, operations, TEST_RUNTIME)).toMatchObject({
      status: "schema-verified",
      sourceCommit: E,
      candidate: { version: null, tag: null },
    });
  });

  test("Specification-only publication never requests schema tools, Cloudflare, or route mutation", async () => {
    const state = repositoryState();
    const built = buildPreparedCandidate({
      lane: "specification",
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: D,
      state,
      sourceSnapshotRaw: sourceSnapshotBytes(D),
      schemaOriginCandidateRaw: null,
    });
    let tag = null;
    let releaseReceipt = null;
    const touched = [];
    const exactTag = () => ({
      status: 200,
      tag: TAG,
      targetCommit: E,
      tagObject: "9".repeat(40),
      annotated: true,
      signed: true,
      signatureVerified: true,
    });
    const exactRelease = () => ({
      status: 200,
      tag: TAG,
      id: 1201,
      url: `https://github.com/tako0614/takoform/releases/tag/${TAG}`,
      body: built.document.githubRelease.body,
      draft: false,
      prerelease: false,
      immutable: true,
      assets: [],
    });
    const operations = {
      verifySourcePinnedExecution: async (request) =>
        exactWriterClosure(request),
      readPublishState: async () => ({
        ...structuredClone(state),
        candidateRaw: Buffer.from(built.raw),
        headCommit: E,
        evidenceTransition: {
          fromCommit: D,
          toCommit: E,
          parents: [D],
          changedPaths: [CANDIDATE_PATH],
        },
      }),
      verifySpecificationSourceSnapshot: async (request) => ({
        commit: request.commit,
        snapshotSha256: request.snapshotSha256,
        exact: true,
      }),
      verifyIndependentReview: async ({ path: _path, ...request }) => ({
        format: "takoform.specification-release-independent-review@v1",
        approved: true,
        reviewer: "independent-reviewer",
        reviewedAt: "2026-08-27T13:00:00Z",
        ...structuredClone(request),
      }),
      readTag: async () => tag ?? { status: 404, tag: TAG },
      readRelease: async () => releaseReceipt ?? { status: 404, tag: TAG },
      acquireTagProtectionAuditToken: async () => ({ audit: true }),
      verifyTagProtectionRuleset: async () => structuredClone(TAG_RULESET),
      acquireCredentials: async (request) => {
        expect(request.lanes).toEqual({ specification: true, schema: false });
        return { githubOnly: true };
      },
      createSignedAnnotatedTag: async () => {
        tag = exactTag();
      },
      createImmutableRelease: async () => {
        releaseReceipt = exactRelease();
      },
    };
    for (const name of [
      "readSchemaSource",
      "readHTTP",
      "prepareSchemaToolClosure",
      "readSchemaOriginStage",
      "stageSchemaOrigin",
      "verifyStagedSchemaOrigin",
      "activateSchemaRoute",
    ]) {
      operations[name] = async () => {
        touched.push(name);
        throw new Error(`Specification-only publication touched ${name}`);
      };
    }
    const result = await publish({
      authority: activeAuthority(),
      lane: "specification",
      version: VERSION,
      expectedDCommit: D,
      expectedNCommit: D,
      expectedECommit: E,
      reviewRecord: "/operator/specification-review.json",
    }, operations, TEST_RUNTIME);
    expect(result.status).toBe("published");
    expect(result.candidate.schemaOrigin).toBeNull();
    expect(touched).toEqual([]);
  });

  test("record-head signing is an artifact-only phase that rejects every other credential", async () => {
    const temporary = mkdtempSync(join(tmpdir(), "takoform-signer-only-"));
    const signerPath = join(temporary, "signer");
    writeFileSync(signerPath, signerSource(testKeys.privateKey), { mode: 0o700 });
    const head = Buffer.from("{\"generation\":2}\n");
    const unsigned = buildUnsignedRecordArtifact({
      purpose: "schema-reservation",
      sourceCommit: D,
      files: new Map([
        ["release/public-schema-identities.json", Buffer.from("{}\n")],
        ["release/record-prefix-chain.json", Buffer.from("{}\n")],
        ["release/record-head.json", head],
      ]),
    });
    try {
      for (const name of [
        "GH_TOKEN",
        "CLOUDFLARE_API_TOKEN",
        "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
        "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
      ]) {
        expect(() => assertSignerOnlyEnvironment({ [name]: `canary-${name}` }))
          .toThrow(name);
      }
      const sealed = await sealRecordArtifact({
        authority: activeAuthority(),
        unsignedArtifactRaw: unsigned.raw,
        signerCommand: signerPath,
        repositoryRoot: ROOT,
        environment: { PATH: process.env.PATH },
      });
      const verified = verifySealedRecordArtifact(sealed.raw, {
        purpose: "schema-reservation",
        sourceCommit: D,
        publicKeyPEM: testPublicPEM,
        expectedFingerprint: testFingerprint,
      });
      expect(verified.files.get("release/record-head.json")).toEqual(head);
      expect(verified.files.has("release/record-head.sig.json")).toBe(true);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  test("same-uid /proc canaries reject every publication, audit, and ref credential", () => {
    const procRoot = mkdtempSync(join(tmpdir(), "takoform-fake-proc-"));
    const pid = "4242";
    const processRoot = join(procRoot, pid);
    mkdirSync(processRoot, { recursive: true });
    try {
      for (const name of [
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_API_KEY",
        "TAKOFORM_SPECIFICATION_RULESET_AUDIT_TOKEN",
        "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN",
      ]) {
        writeFileSync(
          join(processRoot, "environ"),
          Buffer.from(`PATH=/usr/bin\0${name}=same-uid-canary\0`),
        );
        expect(() => assertNoSameUIDSignerCredentialProcesses({
          procRoot,
          uid: typeof process.getuid === "function" ? process.getuid() : 0,
          pids: [pid],
        })).toThrow(`${name} in pid ${pid}`);
      }
    } finally {
      rmSync(procRoot, { recursive: true, force: true });
    }
  });
});
