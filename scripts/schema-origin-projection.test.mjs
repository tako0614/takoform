import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  IMPORTED_ACTIVE_SCHEMA_COUNT,
  checkSchemaProjection,
  parseSchemaIdentityLedger,
  readSchemaIdentityLedger,
  resolveSchemaProjection,
  writeSchemaProjection,
} from "./schema-origin-projection.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const sourceLedger = JSON.parse(
  readFileSync(path.join(repositoryRoot, "release/public-schema-identities.json"), "utf8"),
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeFixture(mutator = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), "takoform-schema-origin-"));
  mkdirSync(path.join(root, "release"), { recursive: true });
  mkdirSync(path.join(root, "spec/schemas"), { recursive: true });
  const ledger = clone(sourceLedger);
  mutator(ledger);
  writeFileSync(
    path.join(root, "release/public-schema-identities.json"),
    `${JSON.stringify(ledger, null, 2)}\n`,
  );
  for (const identity of sourceLedger.identities) {
    copyFileSync(
      path.join(repositoryRoot, identity.source),
      path.join(root, identity.source),
    );
  }
  return root;
}

function cleanFixture(root) {
  rmSync(root, { recursive: true, force: true });
}

function withFixture(mutator, callback) {
  const root = makeFixture(mutator);
  try {
    return callback(root);
  } finally {
    cleanFixture(root);
  }
}

function firstEntry(root) {
  return resolveSchemaProjection(root).entries[0];
}

test("the checked-in output is an exact 31-entry active projection", () => {
  const result = checkSchemaProjection(repositoryRoot);
  assert.equal(result.entries.length, IMPORTED_ACTIVE_SCHEMA_COUNT);
  assert.equal(result.problems.length, 0);
});

test("write creates a closed projection and check rereads exact source bytes", () => {
  withFixture(undefined, (root) => {
    const result = writeSchemaProjection(root);
    assert.equal(result.entries.length, IMPORTED_ACTIVE_SCHEMA_COUNT);
    assert.deepEqual(checkSchemaProjection(root).problems, []);
  });
});

test("a future active identity appends without changing projection code", () => {
  const id =
    "https://forms.takoform.com/schemas/zz-future/v1/future.schema.json";
  const bytes = Buffer.from(
    `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", $id: id, type: "object" }, null, 2)}\n`,
  );
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  withFixture(
    (ledger) => {
      ledger.identities.push({
        id,
        sha256,
        source: "spec/schemas/future.schema.json",
        public:
          "website/public/schemas/zz-future/v1/future.schema.json",
      });
    },
    (root) => {
      writeFileSync(path.join(root, "spec/schemas/future.schema.json"), bytes);
      const result = writeSchemaProjection(root);
      assert.equal(result.entries.length, IMPORTED_ACTIVE_SCHEMA_COUNT + 1);
      assert.equal(
        readFileSync(
          path.join(
            root,
            "schema-origin/public/schemas/zz-future/v1/future.schema.json",
          ),
        ).equals(bytes),
        true,
      );
    },
  );
});

test("changed bytes fail the read-only check", () => {
  withFixture(undefined, (root) => {
    writeSchemaProjection(root);
    const entry = firstEntry(root);
    writeFileSync(
      entry.destinationPath,
      Buffer.concat([entry.bytes, Buffer.from("changed")]),
    );
    assert.throws(() => checkSchemaProjection(root), /changed bytes/);
  });
});

test("extra files fail the read-only check", () => {
  withFixture(undefined, (root) => {
    writeSchemaProjection(root);
    const extra = path.join(root, "schema-origin/public/schemas/extra.json");
    writeFileSync(extra, "extra\n");
    assert.throws(() => checkSchemaProjection(root), /unexpected projected file .*extra\.json/);
  });
});

test("missing files fail the read-only check", () => {
  withFixture(undefined, (root) => {
    writeSchemaProjection(root);
    unlinkSync(firstEntry(root).destinationPath);
    assert.throws(() => checkSchemaProjection(root), /missing projected file/);
  });
});

test("duplicate active id/path records are rejected before projection", () => {
  withFixture((ledger) => {
    ledger.identities.splice(1, 0, clone(ledger.identities[0]));
  }, (root) => {
    assert.throws(
      () => readSchemaIdentityLedger(root),
      /duplicates active id https:\/\/forms\.takoform\.com\/schemas\//,
    );
  });
});

test("retired identities are not projected and a retired file is an extra", () => {
  withFixture(undefined, (root) => {
    writeSchemaProjection(root);
    const retired = sourceLedger.retired[0];
    const retiredPath = path.join(root, "schema-origin/public", new URL(retired.id).pathname.slice(1));
    mkdirSync(path.dirname(retiredPath), { recursive: true });
    writeFileSync(retiredPath, "retired bytes\n");
    assert.throws(() => checkSchemaProjection(root), /unexpected projected file/);
  });
});

test("non-canonical hosts and paths are rejected", () => {
  withFixture((ledger) => {
    ledger.identities[0].id = ledger.identities[0].id.replace("forms.takoform.com", "FORMS.takoform.com");
  }, (root) => {
    assert.throws(() => resolveSchemaProjection(root), /canonical .*schemas/);
  });
  withFixture((ledger) => {
    ledger.identities[0].id = ledger.identities[0].id.replace("/schemas/", "/schemas/../schemas/");
  }, (root) => {
    assert.throws(() => resolveSchemaProjection(root), /canonical .*schemas/);
  });
});

test("source traversal is rejected before any output mutation", () => {
  withFixture((ledger) => {
    ledger.identities[0].source = "spec/schemas/../../outside.json";
  }, (root) => {
    assert.throws(() => resolveSchemaProjection(root), /canonical spec\/schemas/);
    assert.equal(existsSync(path.join(root, "schema-origin")), false);
  });
});

test("check and write refuse symlinks and write leaves the tree untouched", () => {
  withFixture(undefined, (root) => {
    writeSchemaProjection(root);
    const entry = firstEntry(root);
    const outside = path.join(root, "outside.json");
    writeFileSync(outside, "outside\n");
    unlinkSync(entry.destinationPath);
    symlinkSync(outside, entry.destinationPath);
    assert.throws(() => checkSchemaProjection(root), /contains a symlink/);
    assert.throws(() => writeSchemaProjection(root), /contains a symlink/);
    assert.equal(readFileSync(entry.destinationPath, "utf8"), "outside\n");
  });
});

test("the parser rejects a traversal-shaped URL before path resolution", () => {
  const identity = clone(sourceLedger.identities[0]);
  identity.id = "https://forms.takoform.com/schemas/../escape.schema.json";
  const ledger = { kind: sourceLedger.kind, identities: [identity], retired: [] };
  assert.throws(
    () => parseSchemaIdentityLedger(JSON.stringify(ledger), "fixture ledger"),
    /canonical .*schemas/,
  );
});
