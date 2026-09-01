import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  inspectVersionAxes,
  validateHostApiClosure,
} from "./version-axis.mjs";

function cleanEntries() {
  return new Map([
    [
      "spec/versioning.md",
      "Host API major, each Form's definitionVersion, Core/library SemVer, and Provider SemVer.\n",
    ],
    ["spec/host-api/v1.md", "The Host API identity is forms.takoform.com/v1.\n"],
  ]);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

describe("Takoform version-axis boundary", () => {
  test("rejects an independent numbered document release in active source", () => {
    const entries = cleanEntries();
    entries.set(
      "README.md",
      "Choose the current Takoform Specification 1.2 release.\n",
    );

    expect(inspectVersionAxes(entries)).toContain(
      "README.md:1 reintroduces an independent Specification version or release: Takoform Specification 1.2",
    );
  });

  test.each([
    ["release lane", "release/next.json", '{"kind":"takoform.specification-release@v1"}\n'],
    ["release ledger", "README.md", "Use the Specification release ledger.\n"],
    ["selectable track", "release/current.json", '{"track":"specification-v1"}\n'],
    ["tag lane", "release/current.json", '{"tag":"specification/1.2"}\n'],
    ["manifest field", "release/current.json", '{"specificationVersion":"1.2"}\n'],
    ["current label", "README.md", "Read the current Specification.\n"],
    ["candidate label", "README.md", "Read the Specification candidate.\n"],
    ["document semver label", "README.md", "This is Specification-minor work.\n"],
  ])("rejects an active %s", (_name, path, content) => {
    const entries = cleanEntries();
    entries.set(path, content);
    expect(inspectVersionAxes(entries)).not.toEqual([]);
  });

  test("exempts only isolated append-only historical evidence", () => {
    const entries = cleanEntries();
    entries.set(
      "docs/extraction/history/specification-1.1-publication-evidence.json",
      '{"title":"Takoform Specification 1.1","tag":"specification/1.1"}\n',
    );
    expect(inspectVersionAxes(entries)).toEqual([]);

    entries.set(
      "docs/extraction/history/current-note.md",
      '{"title":"Takoform Specification 1.1","tag":"specification/1.1"}\n',
    );
    expect(inspectVersionAxes(entries)).not.toEqual([]);
  });

  test("binds the literal Host API v1 identity to exact normative bytes", () => {
    const entries = new Map([
      ["spec/host-api/v1.md", "host-v1\n"],
      ["spec/schemas/host-api-wire-v1.schema.json", '{"lane":"forms.takoform.com/v1"}\n'],
      [
        "release/host-api-v1.json",
        `${JSON.stringify({
          kind: "takoform.host-api-closure@v1",
          apiVersion: "forms.takoform.com/v1",
          compatibility: {
            incompatibleChange: "requires-api-v2",
            editorialErrata: "same-api-v1-identity",
          },
          documents: [
            {
              path: "spec/host-api/v1.md",
              sha256: "sha256:dca1c81964e80d9a67a20baa5f5c210cd491008d075b09665902f98b1e2faf21",
            },
            {
              path: "spec/schemas/host-api-wire-v1.schema.json",
              sha256: "sha256:9d4d8af4a803d1d1e546e0005bd45b096582991576c74212181dbe3ccfda7d49",
            },
          ],
        })}\n`,
      ],
    ]);
    const expectedPaths = [
      "spec/host-api/v1.md",
      "spec/schemas/host-api-wire-v1.schema.json",
    ];

    expect(validateHostApiClosure(entries, { expectedPaths })).toEqual([]);
    entries.set("spec/host-api/v1.md", "changed\n");
    expect(validateHostApiClosure(entries, { expectedPaths })).toContain(
      "Host API v1 digest changed for spec/host-api/v1.md",
    );
  });

  test("requires every referenced Host schema identity in the exact closure", () => {
    const wire = `${JSON.stringify({
      $id: "https://forms.takoform.com/schemas/v1/host-api-wire.schema.json",
      $ref: "https://forms.takoform.com/schemas/v1/missing.schema.json",
    })}\n`;
    const entries = new Map([
      ["spec/host-api/v1.md", "host-v1\n"],
      ["spec/schemas/host-api-wire-v1.schema.json", wire],
      [
        "release/host-api-v1.json",
        `${JSON.stringify({
          kind: "takoform.host-api-closure@v1",
          apiVersion: "forms.takoform.com/v1",
          compatibility: {
            incompatibleChange: "requires-api-v2",
            editorialErrata: "same-api-v1-identity",
          },
          documents: [
            {
              path: "spec/host-api/v1.md",
              sha256: sha256("host-v1\n"),
            },
            {
              path: "spec/schemas/host-api-wire-v1.schema.json",
              sha256: sha256(wire),
            },
          ],
        })}\n`,
      ],
    ]);

    expect(validateHostApiClosure(entries, {
      expectedPaths: [
        "spec/host-api/v1.md",
        "spec/schemas/host-api-wire-v1.schema.json",
      ],
    })).toContain(
      "Host API v1 closure omits referenced schema identity: https://forms.takoform.com/schemas/v1/missing.schema.json",
    );
  });
});
