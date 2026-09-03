import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import {
  EXACT_HOST_API_LANE,
  EXPECTED_MACHINE_ROOTS,
  EXPECTED_NORMATIVE_PROSE,
  EXPECTED_SCHEMA_CLOSURE,
  EXPECTED_SCHEMA_ROOTS,
  FREEZE_KIND,
  FREEZE_PATH,
  inspectHostAPIFreeze,
} from "./host-api-freeze.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function write(root, path, value) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

const schemaSources = new Map([
  [
    "https://forms.takoform.com/schemas/artifacts/v1alpha1/artifact-manifest.schema.json",
    "spec/schemas/artifact-manifest-v1alpha1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-definition.schema.json",
    "spec/schemas/binding-definition-v1alpha2.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-ref.schema.json",
    "spec/schemas/binding-ref-v1alpha2.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-definition.schema.json",
    "spec/schemas/interface-definition-v1alpha1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-ref.schema.json",
    "spec/schemas/interface-ref-v1alpha1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/operations/v1/operation.schema.json",
    "spec/schemas/operation-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/standards/v1/standard-service-ref.schema.json",
    "spec/schemas/standard-service-ref-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json",
    "spec/schemas/host-support-profile-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1/form-definition.schema.json",
    "spec/schemas/form-definition-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1/form-package-revocation-checkpoint.schema.json",
    "spec/schemas/form-package-revocation-checkpoint-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1/form-package-revocation.schema.json",
    "spec/schemas/form-package-revocation-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
    "spec/schemas/form-ref-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json",
    "spec/schemas/host-api-wire-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1/host-discovery.schema.json",
    "spec/schemas/host-discovery-v1.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1alpha5/package-index.schema.json",
    "spec/schemas/package-index-v1alpha5.schema.json",
  ],
  [
    "https://forms.takoform.com/schemas/v1beta2/form-ref.schema.json",
    "spec/schemas/form-ref-v1beta2.schema.json",
  ],
]);

function schemaDocument(id) {
  if (id === "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json") {
    return {
      $id: id,
      allOf: [
        { $ref: "https://forms.takoform.com/schemas/v1/form-ref.schema.json" },
        { $ref: "https://forms.takoform.com/schemas/operations/v1/operation.schema.json" },
        { $ref: "https://forms.takoform.com/schemas/artifacts/v1alpha1/artifact-manifest.schema.json" },
        { $ref: "https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json" },
      ],
    };
  }
  if (id === "https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json") {
    return {
      $id: id,
      allOf: [
        { $ref: "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-ref.schema.json" },
        { $ref: "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-ref.schema.json" },
        { $ref: "https://forms.takoform.com/schemas/standards/v1/standard-service-ref.schema.json" },
      ],
    };
  }
  if (id === "https://forms.takoform.com/schemas/v1alpha5/package-index.schema.json") {
    return {
      $id: id,
      $ref: "https://forms.takoform.com/schemas/v1beta2/form-ref.schema.json",
    };
  }
  if (id === "https://forms.takoform.com/schemas/v1/form-package-revocation.schema.json" ||
    id === "https://forms.takoform.com/schemas/v1/form-package-revocation-checkpoint.schema.json") {
    return {
      $id: id,
      $ref: "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
    };
  }
  return { $id: id, type: "object" };
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "takoform-host-api-freeze-"));
  temporaryRoots.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "freeze-test@example.invalid");
  git(root, "config", "user.name", "Freeze Test");
  write(root, ".gitignore", "\n");
  git(root, "add", ".gitignore");
  git(root, "commit", "--quiet", "-m", "fixture root");

  const prose = `# Host API v1\n\n\`${EXACT_HOST_API_LANE}\` is immutable.\n`;
  for (const path of EXPECTED_NORMATIVE_PROSE) {
    write(root, path, path === "spec/host-api/v1.md" ? prose : `# ${path}\n`);
  }
  const machineRoots = new Map([
    [
      "spec/host-api/operations-v1.json",
      `${JSON.stringify({ format: "takoform.host-api@v1", apiGroup: EXACT_HOST_API_LANE }, null, 2)}\n`,
    ],
    [
      "conformance/takoform-v1/generic.json",
      `${JSON.stringify({ format: "takoform.core-artifact-corpus@v1", hostApiLane: EXACT_HOST_API_LANE }, null, 2)}\n`,
    ],
    [
      "spec/trust/profile.json",
      `${JSON.stringify({
        format: "takoform.core-trust-profile@v1",
        revocation: {
          statementIdentity: "trust.forms.takoform.com/v1",
          checkpointIdentity: "trust.forms.takoform.com/v1",
        },
      }, null, 2)}\n`,
    ],
  ]);
  for (const [path, bytes] of machineRoots) write(root, path, bytes);

  const identities = [];
  for (const id of EXPECTED_SCHEMA_CLOSURE) {
    const source = schemaSources.get(id);
    const publicPath = `website/public${new URL(id).pathname}`;
    const bytes = `${JSON.stringify(schemaDocument(id), null, 2)}\n`;
    write(root, source, bytes);
    write(root, publicPath, bytes);
    identities.push({ id, sha256: digest(bytes), source, public: publicPath });
  }
  write(
    root,
    "release/public-schema-identities.json",
    `${JSON.stringify({ kind: "takoform.public-schema-identities@v1", identities, retired: [] }, null, 2)}\n`,
  );
  const manifest = {
    kind: FREEZE_KIND,
    lane: EXACT_HOST_API_LANE,
    normativeProse: EXPECTED_NORMATIVE_PROSE.map((path) => ({
      path,
      sha256: digest(readFileSync(join(root, path))),
    })),
    machineRoots: EXPECTED_MACHINE_ROOTS.map((path) => ({
      path,
      sha256: digest(machineRoots.get(path)),
    })),
    schemas: {
      ledger: "release/public-schema-identities.json",
      rootIds: [...EXPECTED_SCHEMA_ROOTS],
      closureIds: [...EXPECTED_SCHEMA_CLOSURE],
    },
  };
  write(root, FREEZE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  write(root, "website/index.md", "# Mutable presentation\n");
  return { root, manifest };
}

describe("Host API v1 immutable freeze", () => {
  test("pins the complete semantic prose, machine, schema-root, and recursive schema closure", () => {
    expect(EXPECTED_NORMATIVE_PROSE).toEqual([
      "spec/host-api/v1.md",
      "spec/conformance.md",
      "spec/versioning.md",
      "spec/form-families.md",
      "spec/portability-boundary.md",
      "spec/form-definition/README.md",
      "spec/form-package/README.md",
      "spec/core/README.md",
      "spec/interface-contract/README.md",
      "spec/binding-contract/README.md",
      "spec/artifact-transport/README.md",
      "spec/standard-services/README.md",
      "spec/trust/README.md",
    ]);
    expect(EXPECTED_MACHINE_ROOTS).toEqual([
      "spec/host-api/operations-v1.json",
      "conformance/takoform-v1/generic.json",
      "spec/trust/profile.json",
    ]);
    expect(EXPECTED_SCHEMA_ROOTS).toEqual([
      "https://forms.takoform.com/schemas/v1/host-discovery.schema.json",
      "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
      "https://forms.takoform.com/schemas/v1/form-definition.schema.json",
      "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json",
      "https://forms.takoform.com/schemas/operations/v1/operation.schema.json",
      "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-definition.schema.json",
      "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-definition.schema.json",
      "https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json",
      "https://forms.takoform.com/schemas/v1alpha5/package-index.schema.json",
      "https://forms.takoform.com/schemas/v1/form-package-revocation.schema.json",
      "https://forms.takoform.com/schemas/v1/form-package-revocation-checkpoint.schema.json",
    ]);
    expect(EXPECTED_SCHEMA_CLOSURE).toEqual([
      "https://forms.takoform.com/schemas/artifacts/v1alpha1/artifact-manifest.schema.json",
      "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-definition.schema.json",
      "https://forms.takoform.com/schemas/bindings/v1alpha2/binding-ref.schema.json",
      "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-definition.schema.json",
      "https://forms.takoform.com/schemas/interfaces/v1alpha1/interface-ref.schema.json",
      "https://forms.takoform.com/schemas/operations/v1/operation.schema.json",
      "https://forms.takoform.com/schemas/standards/v1/standard-service-ref.schema.json",
      "https://forms.takoform.com/schemas/support/v1/host-support-profile.schema.json",
      "https://forms.takoform.com/schemas/v1/form-definition.schema.json",
      "https://forms.takoform.com/schemas/v1/form-package-revocation-checkpoint.schema.json",
      "https://forms.takoform.com/schemas/v1/form-package-revocation.schema.json",
      "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
      "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json",
      "https://forms.takoform.com/schemas/v1/host-discovery.schema.json",
      "https://forms.takoform.com/schemas/v1alpha5/package-index.schema.json",
      "https://forms.takoform.com/schemas/v1beta2/form-ref.schema.json",
    ]);
  });

  test("exposes no writer or update CLI mode", () => {
    for (const mode of ["--write", "--update"]) {
      const result = spawnSync("bun", [join(import.meta.dir, "host-api-freeze.mjs"), mode], {
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("[--check|--bootstrap]");
    }
  });

  test("bootstrap validates the complete uncommitted closure and catches source drift", () => {
    const { root } = createFixture();
    expect(inspectHostAPIFreeze(root, { mode: "bootstrap" })).toEqual([]);

    write(root, "spec/host-api/operations-v1.json", '{"apiGroup":"changed"}\n');
    expect(inspectHostAPIFreeze(root, { mode: "bootstrap" }).join("\n")).toContain(
      "spec/host-api/operations-v1.json differs from its frozen sha256",
    );
  });

  test("new common-model prose and machine inputs are digest-frozen", () => {
    for (const path of [
      "spec/form-package/README.md",
      "spec/core/README.md",
      "spec/trust/README.md",
      "conformance/takoform-v1/generic.json",
      "spec/trust/profile.json",
    ]) {
      const { root } = createFixture();
      write(root, path, "changed\n");
      expect(inspectHostAPIFreeze(root, { mode: "bootstrap" }).join("\n")).toContain(
        `${path} differs from its frozen sha256`,
      );
    }
  });

  test("history check rejects editing the manifest and source together after first add", () => {
    const { root, manifest } = createFixture();
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "first immutable Host API freeze");
    expect(inspectHostAPIFreeze(root, { mode: "check" })).toEqual([]);

    const changed = `# Host API v1\n\n\`${EXACT_HOST_API_LANE}\` changed.\n`;
    write(root, "spec/host-api/v1.md", changed);
    manifest.normativeProse[0].sha256 = digest(changed);
    write(root, FREEZE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

    const problems = inspectHostAPIFreeze(root, { mode: "check" }).join("\n");
    expect(problems).toContain(`${FREEZE_PATH} differs from its first-add commit`);
    expect(problems).toContain("spec/host-api/v1.md differs from its first-add commit");
    expect(inspectHostAPIFreeze(root, { mode: "bootstrap" }).join("\n")).toContain(
      "bootstrap is forbidden after the freeze manifest entered Git history",
    );
  });

  test("history check freezes package and trust schema bytes through their ledger identities", () => {
    for (const id of [
      "https://forms.takoform.com/schemas/v1alpha5/package-index.schema.json",
      "https://forms.takoform.com/schemas/v1/form-package-revocation.schema.json",
      "https://forms.takoform.com/schemas/v1/form-package-revocation-checkpoint.schema.json",
    ]) {
      const { root } = createFixture();
      git(root, "add", ".");
      git(root, "commit", "--quiet", "-m", "first immutable Host API freeze");

      const source = schemaSources.get(id);
      const publicPath = `website/public${new URL(id).pathname}`;
      const changed = `${JSON.stringify({ ...schemaDocument(id), description: "changed" }, null, 2)}\n`;
      write(root, source, changed);
      write(root, publicPath, changed);
      const ledgerPath = join(root, "release/public-schema-identities.json");
      const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
      ledger.identities.find((entry) => entry.id === id).sha256 = digest(changed);
      write(root, "release/public-schema-identities.json", `${JSON.stringify(ledger, null, 2)}\n`);

      const problems = inspectHostAPIFreeze(root, { mode: "check" }).join("\n");
      expect(problems).toContain(`${id} sha256 differs from its first-add commit`);
      expect(problems).toContain(`${source} differs from its first-add commit`);
      expect(problems).toContain(`${publicPath} differs from its first-add commit`);
    }
  });

  test("recursive external $ref closure cannot expand", () => {
    const { root } = createFixture();
    const extraId = "https://forms.takoform.com/schemas/v1/unintended.schema.json";
    const extraSource = "spec/schemas/unintended-v1.schema.json";
    const extraPublic = `website/public${new URL(extraId).pathname}`;
    const extraBytes = `${JSON.stringify({ $id: extraId, type: "object" }, null, 2)}\n`;
    write(root, extraSource, extraBytes);
    write(root, extraPublic, extraBytes);

    const ledgerPath = join(root, "release/public-schema-identities.json");
    const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    ledger.identities.push({
      id: extraId,
      sha256: digest(extraBytes),
      source: extraSource,
      public: extraPublic,
    });
    write(root, "release/public-schema-identities.json", `${JSON.stringify(ledger, null, 2)}\n`);

    const wirePath = schemaSources.get(
      "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json",
    );
    const wire = JSON.parse(readFileSync(join(root, wirePath), "utf8"));
    wire.allOf.push({ $ref: extraId });
    const wireBytes = `${JSON.stringify(wire, null, 2)}\n`;
    write(root, wirePath, wireBytes);
    write(root, `website/public/schemas/v1/host-api-wire.schema.json`, wireBytes);
    const wireEntry = ledger.identities.find((entry) => entry.source === wirePath);
    wireEntry.sha256 = digest(wireBytes);
    write(root, "release/public-schema-identities.json", `${JSON.stringify(ledger, null, 2)}\n`);

    expect(inspectHostAPIFreeze(root, { mode: "bootstrap" }).join("\n")).toContain(
      "recursive schema closure differs from the intended Host API v1 closure",
    );
  });

  test("a frozen prose link cannot silently add another normative specification", () => {
    const { root, manifest } = createFixture();
    const prose = `# Host API v1\n\n\`${EXACT_HOST_API_LANE}\`. See [another contract](../unfrozen-contract.md).\n`;
    write(root, "spec/host-api/v1.md", prose);
    write(root, "spec/unfrozen-contract.md", "# Another contract\n");
    manifest.normativeProse[0].sha256 = digest(prose);
    write(root, FREEZE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

    expect(inspectHostAPIFreeze(root, { mode: "bootstrap" }).join("\n")).toContain(
      "references normative prose outside the frozen closure: spec/unfrozen-contract.md",
    );
  });

  test("presentation bytes remain outside the immutable normative closure", () => {
    const { root } = createFixture();
    expect(inspectHostAPIFreeze(root, { mode: "bootstrap" })).toEqual([]);
    write(root, "website/index.md", "# A different mutable presentation\n");
    expect(inspectHostAPIFreeze(root, { mode: "bootstrap" })).toEqual([]);
  });
});
