import { describe, expect, test } from "bun:test";

import { finalModule, inspectSource } from "./source-boundary.mjs";

function validEntries() {
  return new Map([
    ["go.mod", `module ${finalModule}\n\ngo 1.25.8\n`],
    ["formpackage/model.go", "package formpackage\n"],
    ["hostclient/hostclient.go", "package hostclient\n"],
    ["snapshot/snapshot.go", "package snapshot\n"],
  ]);
}

describe("Core source boundary", () => {
  test("accepts the final neutral public package coordinates", () => {
    expect(inspectSource(validEntries())).toEqual([]);
  });

  test.each([
    ["old module import", "cmd/takoform/main.go", 'import "github.com/tako0614/terraform-provider-takoform/formpackage"'],
    ["publisher privilege", "snapshot/snapshot.go", 'const group = "edge.forms.takoform.com"'],
    ["API v2", "hostclient/hostclient.go", 'const api = "forms.takoform.com/v2"'],
    ["script-side Provider execution", "scripts/release.mjs", 'const command = "github.com/tako0614/terraform-provider-takoform"'],
    ["workflow-side publisher privilege", ".github/workflows/release.yml", 'run: publish edge.forms.takoform.com'],
    ["corpus-side API v2", "conformance/takoform-v1/generic.json", '{"apiVersion":"forms.takoform.com/v2"}'],
  ])("rejects %s", (_name, path, content) => {
    const entries = validEntries();
    entries.set(path, content);
    expect(inspectSource(entries)).not.toEqual([]);
  });

  test("does not turn historical prose or adversarial tests into executable authority", () => {
    const entries = validEntries();
    entries.set("docs/extraction/history/provider.md", "github.com/tako0614/terraform-provider-takoform edge.forms.takoform.com forms.takoform.com/v2");
    entries.set("scripts/source-boundary.test.mjs", "edge.forms.takoform.com forms.takoform.com/v2");
    expect(inspectSource(entries)).toEqual([]);
  });

  test("allows only the exact predecessor repository as cutover evidence", () => {
    const entries = validEntries();
    entries.set(
      "scripts/schema-origin-deploy.mjs",
      'const predecessor = "https://github.com/tako0614/terraform-provider-takoform.git";\n',
    );
    expect(inspectSource(entries)).toEqual([]);

    entries.set(
      "scripts/schema-origin-deploy.mjs",
      'const predecessor = "https://github.com/tako0614/terraform-provider-takoform.git";\nconst command = "github.com/tako0614/terraform-provider-takoform/formpackage";\n',
    );
    expect(inspectSource(entries)).not.toEqual([]);
  });

  test("rejects Provider dependencies and sibling replacement", () => {
    const entries = validEntries();
    entries.set(
      "go.mod",
      `module ${finalModule}\n\nrequire github.com/hashicorp/terraform-plugin-framework v1.0.0\nreplace example.test/sibling => ../sibling\n`,
    );
    expect(inspectSource(entries)).toHaveLength(2);
  });

  test("rejects pre-extraction internal ownership paths", () => {
    const entries = validEntries();
    entries.set("internal/currentformsnapshot/snapshot.go", "package currentformsnapshot\n");
    expect(inspectSource(entries)).toContain(
      "forbidden pre-extraction source remains under internal/currentformsnapshot/",
    );
  });
});
