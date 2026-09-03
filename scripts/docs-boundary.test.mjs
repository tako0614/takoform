import { describe, expect, test } from "bun:test";

import { inspectDocs, publishingPlatformDocPaths } from "./docs-boundary.mjs";

function baseEntries() {
  return new Map([
    ["spec/README.md", "See [families](form-families.md).\n"],
    ["spec/form-families.md", "# Families\n"],
    ["trust/README.md", "Core accepts caller-supplied trust policy.\n"],
  ]);
}

describe("current documentation boundary", () => {
  test("accepts neutral docs and existing local links", () => {
    expect(inspectDocs(baseEntries())).toEqual([]);
  });

  test("rejects a missing local Markdown target", () => {
    const entries = baseEntries();
    entries.set("spec/versioning.md", "[missing](does-not-exist.md)\n");
    expect(inspectDocs(entries)).toContain(
      "spec/versioning.md:1 local Markdown link target does not exist: does-not-exist.md",
    );
  });

  test.each([
    ["deleted command", "See `cmd/portable-host-conformance/` for the runner."],
    ["deleted corpus", "Use `conformance/portable-host-v1beta1/contract.json`."],
    ["fixed official roster", "The official family roster contains eight families."],
    ["current Edge authority", "edge.forms.takoform.com is the current family."],
    ["positive Host API v2", "Hosts serve forms.takoform.com/v2 today."],
    ["invented Host API v1.1", "Hosts serve Host API v1.1 today."],
    ["invented v1.1 route", "Hosts serve forms.takoform.com/v1.1 today."],
    ["negation-laundered Host API v1.1", "No clients reject the current Host API v1.1."],
    ["invented API SemVer", "Takoform API 1.1.0 is the current release."],
    ["ambiguous 1.1 shorthand", "This is the current post-1.1 draft."],
    ["unpublished current API", "Host API v1 is the current unpublished candidate."],
    ["unreleased current API", "This is the current unreleased Host API v1 draft."],
    ["unreleased successor draft", "This tree is an unreleased draft after the historical Specification 1.1 snapshot."],
    ["Provider implementation authority", "Core owns the Provider projection and Terraform resource schema."],
    ["future numbered writer", "Core owns the future Specification writer."],
    ["retired schema-origin authority", "Core deploys the schema-origin projection."],
    ["publishing platform in a contract document", "The schemas are served from Cloudflare Pages."],
  ])("rejects %s", (_name, text) => {
    const entries = baseEntries();
    entries.set("spec/current.md", text);
    expect(inspectDocs(entries)).not.toEqual([]);
  });

  test("allows explicit retained predecessor references", () => {
    const entries = baseEntries();
    entries.set(
      "spec/versioning.md",
      "The retained predecessor documents mention `edge.forms.takoform.com/v1beta1` and `cmd/form-package-release/` for historical reading only.\n",
    );
    expect(inspectDocs(entries)).toEqual([]);
  });

  test("allows Core v1.1.0 only as a software artifact beside the unchanged Host API v1 lane", () => {
    const entries = baseEntries();
    entries.set(
      "spec/versioning.md",
      "Takoform Core v1.1.0 is a software/module artifact release. The Host API remains forms.takoform.com/v1; there is no Host API v1.1.\n",
    );
    expect(inspectDocs(entries)).toEqual([]);
  });

  test("allows proposal documents to explore future vocabulary", () => {
    const entries = baseEntries();
    entries.set(
      "spec/proposals/future.md",
      "Proposal: evaluate forms.takoform.com/v2 and a Provider mapping.\n[old](../form-families.md)\n",
    );
    expect(inspectDocs(entries)).toEqual([]);
  });

  test("checks current-applicability overlays without rewriting historical decision bodies", () => {
    const entries = baseEntries();
    entries.set(
      "spec/decisions/old.md",
      "# Old decision\n\n> Current applicability: current authoring has the Takoform API\n> release SemVer.\n\n## Historical body\nThe Takoform API release SemVer was adopted here.\n",
    );
    expect(inspectDocs(entries)).toEqual([
      "spec/decisions/old.md:3 retains a superseded API SemVer axis in a current-applicability overlay: Takoform API release SemVer",
    ]);

    entries.set(
      "spec/decisions/old.md",
      "# Old decision\n\n> Current applicability: the domain axes are the literal Host API lane and each Form's definitionVersion.\n\n## Historical body\nThe Takoform API release SemVer was adopted here.\n",
    );
    expect(inspectDocs(entries)).toEqual([]);
  });

  test("checks links in historical decisions and retained Host docs", () => {
    const entries = baseEntries();
    entries.set(
      "docs/extraction/history/old.md",
      "[gone](missing.md) edge.forms.takoform.com forms.takoform.com/v2 cmd/reference-host/\n",
    );
    entries.set(
      "spec/decisions/0001-old.md",
      "[gone](missing.md) Core owns the Provider projection.\n",
    );
    entries.set(
      "spec/host-api/v1beta1.md",
      "[gone](missing.md) cmd/portable-host-conformance/\n",
    );
    expect(inspectDocs(entries)).toEqual([
      "spec/decisions/0001-old.md:1 local Markdown link target does not exist: missing.md",
      "spec/host-api/v1beta1.md:1 local Markdown link target does not exist: missing.md",
    ]);
  });

  test("allows only historical decisions to retain the retired lifecycle link", () => {
    const entries = baseEntries();
    entries.set(
      "spec/decisions/0035-beta-contracts-ship-in-stable-provider-v2-1.md",
      "[historical lifecycle](../project-lifecycle.md)\n",
    );
    expect(inspectDocs(entries)).toEqual([]);

    entries.set("spec/current.md", "[retired lifecycle](project-lifecycle.md)\n");
    expect(inspectDocs(entries)).toContain(
      "spec/current.md:1 local Markdown link target does not exist: project-lifecycle.md",
    );
  });

  test("checks links in the W10 receipt and generated guidance", () => {
    const entries = baseEntries();
    entries.set("docs/extraction/w10-core-cutover.md", "[gone](missing.md)\n");
    entries.set("AGENTS.md", "[gone](missing.md)\n");
    expect(inspectDocs(entries)).toEqual([
      "AGENTS.md:1 local Markdown link target does not exist: missing.md",
      "docs/extraction/w10-core-cutover.md:1 local Markdown link target does not exist: missing.md",
    ]);
  });

  test("does not blanket-exclude the deleted trust report from links", () => {
    const entries = baseEntries();
    entries.set("spec/trust/0001-provider-runner-report-v2.md", "[gone](missing.md)\n");
    expect(inspectDocs(entries)).toContain(
      "spec/trust/0001-provider-runner-report-v2.md:1 local Markdown link target does not exist: missing.md",
    );
  });

  test("allows a negated absence claim without allowing a positive claim", () => {
    const entries = baseEntries();
    entries.set(
      "spec/current.md",
      "There is no official family roster and Core owns no Provider mapping.\n",
    );
    expect(inspectDocs(entries)).toEqual([]);
    entries.set("spec/current.md", "The official family roster is fixed.\n");
    expect(inspectDocs(entries)).not.toEqual([]);
  });

  test("lets only the site operator document name the publishing platform", () => {
    const entries = baseEntries();
    const sentence = "The site is published to a Cloudflare Pages project with Wrangler.\n";
    entries.set("docs/site.md", sentence);
    expect(inspectDocs(entries)).toEqual([]);
    expect(publishingPlatformDocPaths.has("docs/site.md")).toBe(true);

    entries.delete("docs/site.md");
    entries.set("spec/current.md", sentence);
    expect(inspectDocs(entries)).toContain(
      "spec/current.md:1 names a publishing platform outside the site operator document: Cloudflare",
    );
  });

  test("keeps the retired schema-origin authority forbidden even in the operator document", () => {
    const entries = baseEntries();
    entries.set("docs/site.md", "The schema-origin authority publishes the identities.\n");
    expect(inspectDocs(entries)).toContain(
      "docs/site.md:1 retains retired schema-origin hosting authority vocabulary: schema-origin",
    );
  });

  test("a preceding historical sentence cannot bless a following authority claim", () => {
    const entries = baseEntries();
    entries.set(
      "spec/current.md",
      "The retained predecessor used an official family roster.\nThe official family roster is fixed.\n",
    );
    expect(inspectDocs(entries)).toContain(
      "spec/current.md:2 reintroduces current implementation or publisher authority: official family roster",
    );
  });

  test("a preceding negative sentence cannot bless a following authority claim", () => {
    const entries = baseEntries();
    entries.set(
      "spec/current.md",
      "There is no official family roster.\nThe official family roster is fixed.\n",
    );
    expect(inspectDocs(entries)).toContain(
      "spec/current.md:2 reintroduces current implementation or publisher authority: official family roster",
    );
  });

  test("a preceding sentence on the same line cannot bless a following claim", () => {
    const entries = baseEntries();
    entries.set(
      "spec/current.md",
      "There is no official family roster. The official family roster is fixed.\n",
    );
    expect(inspectDocs(entries)).toContain(
      "spec/current.md:1 reintroduces current implementation or publisher authority: official family roster",
    );
  });
});
