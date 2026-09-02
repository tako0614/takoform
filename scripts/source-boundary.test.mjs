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

  test.each([
    ["retired Host envelope vocabulary", "// transport uses the v1beta1 resource envelope\npackage hostclient\n"],
    ["retired versioned-group decoder", "package hostclient\nfunc SplitGroupPath(parts []string) {}\n"],
  ])("rejects public hostclient %s", (_name, content) => {
    const entries = validEntries();
    entries.set("hostclient/hostclient.go", content);
    expect(inspectSource(entries)).not.toEqual([]);
  });

  test.each([
    ["retired deploy route", "scripts/deploy.mjs", 'const surface = "takoform-specification-release";'],
    ["retired writer import", "scripts/release.mjs", 'import "./specification-release.mjs";'],
    ["retired credential lane", "scripts/launcher.mjs", 'const key = "TAKOFORM_SPECIFICATION_REF_WRITE_TOKEN";'],
    ["retired activation phase", "scripts/schema.mjs", 'const phase = "prepare-activation";'],
  ])("rejects %s", (_name, path, content) => {
    const entries = validEntries();
    entries.set(path, content);
    expect(inspectSource(entries)).not.toEqual([]);
  });

  test("rejects restoration of every retired Specification authority file", () => {
    for (const path of [
      "release/specification-authority.json",
      "release/specification-release-policy.md",
      "release/authority/specification-schema-tool-closure.json",
      "release/authority/specification-writer-closure.json",
      "release/authority/specification-writer-rotations.json",
      "scripts/specification-release.mjs",
      "scripts/specification-release.test.mjs",
      "scripts/specification-release-adapter.mjs",
      "scripts/specification-release-adapter.test.mjs",
    ]) {
      const entries = validEntries();
      entries.set(path, "retired\n");
      expect(inspectSource(entries)).toContain(
        `retired Specification authority path must remain absent: ${path}`,
      );
    }
  });

  test("rejects restoration of bespoke release authority and credential brokers", () => {
    for (const path of [
      "release/authority/core-release-broker.json",
      "release/authority/core-release-continuation-review.pub",
      "release/authority/core-tag-allowed-signers",
      "release/core-releases.json",
      "release/broker/main.go",
      "scripts/sealed-deploy-bootstrap.mjs",
      "scripts/sealed-deploy-launcher.mjs",
      "scripts/sealed-deploy-runner.mjs",
    ]) {
      const entries = validEntries();
      entries.set(path, "retired\n");
      expect(inspectSource(entries)).not.toEqual([]);
    }
    for (const token of [
      "TAKOFORM_CORE_TAG_SIGNING_KEY",
      "prepare-sealed-continuation",
      "takoform.core-release-receipt@v2",
      "record-push",
      "ruleset-id",
      "tag-bundle",
    ]) {
      const entries = validEntries();
      entries.set("scripts/release.mjs", `const retired = ${JSON.stringify(token)};\n`);
      expect(inspectSource(entries)).not.toEqual([]);
    }
  });

  test("rejects platform-specific schema hosting machinery", () => {
    for (const [path, content] of [
      ["schema-origin/wrangler.jsonc", "{}\n"],
      ["release/schema-origin-policy.md", "hosting\n"],
      ["release/authority/schema-origin-tool-closure.json", "{}\n"],
      ["scripts/schema-origin-deploy.mjs", "export const route = true;\n"],
      ["scripts/deploy.mjs", 'const surface = "takoform-schema-origin";\n'],
      ["scripts/release.mjs", 'const token = "CLOUDFLARE_API_TOKEN";\n'],
      ["package.json", '{"devDependencies":{"wrangler":"1.0.0"}}\n'],
    ]) {
      const entries = validEntries();
      entries.set(path, content);
      expect(inspectSource(entries)).not.toEqual([]);
    }
  });

  function siteEntries() {
    const entries = validEntries();
    entries.set("scripts/site.mjs", "export const SITE_ROOT = \"website\";\n");
    entries.set("scripts/site-status.mjs", "export const SITE_STATUS_ROUTE = \"/x\";\n");
    entries.set("website/.vitepress/config.mts", "export default {};\n");
    return entries;
  }

  test("lets only the deploy entrypoint name the platform it publishes the site to", () => {
    const entries = siteEntries();
    entries.set("scripts/site-deploy.mjs", 'const token = "CLOUDFLARE_API_TOKEN";\nconst tool = "wrangler";\n');
    expect(inspectSource(entries)).toEqual([]);

    const sibling = siteEntries();
    sibling.set("scripts/publish.mjs", 'const token = "CLOUDFLARE_API_TOKEN";\n');
    expect(inspectSource(sibling)).toContain(
      "scripts/publish.mjs names the publishing platform outside the deploy entrypoint: CLOUDFLARE_",
    );
  });

  test("keeps the retired schema-origin identity forbidden inside the entrypoint too", () => {
    const entries = siteEntries();
    entries.set("scripts/site-deploy.mjs", 'const surface = "takoform-schema-origin";\n');
    expect(inspectSource(entries)).not.toEqual([]);
  });

  test("refuses a platform-naming entrypoint once the site it publishes is gone", () => {
    const entries = validEntries();
    entries.set("scripts/site-deploy.mjs", 'const token = "CLOUDFLARE_API_TOKEN";\n');
    const problems = inspectSource(entries);
    expect(problems).toContain(
      "the deploy entrypoint names a publishing platform but the site it publishes is missing: scripts/site.mjs",
    );
    expect(problems).toContain(
      "the deploy entrypoint names a publishing platform but the site it publishes is missing: website/.vitepress/config.mts",
    );
  });
});
