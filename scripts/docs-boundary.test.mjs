import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { inspectDocs } from "./docs-boundary.mjs";

const ROOT = resolve(import.meta.dirname, "..");

function currentDoc(path) {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function baseEntries() {
  return new Map([
    ["spec/README.md", "See [families](form-families.md).\n"],
    ["spec/form-families.md", "# Families\n"],
    ["trust/README.md", "Core accepts caller-supplied trust policy.\n"],
  ]);
}

describe("current documentation boundary", () => {
  test("current version docs expose four streams and retain Specification 1.1 as history", () => {
    const readme = currentDoc("README.md");
    const versioning = currentDoc("spec/versioning.md");
    const publication = currentDoc("spec/publication-freeze.md");

    expect(readme).toContain("Takoform has exactly four named version streams");
    expect(readme).not.toMatch(/^\|\s*Specification\s*\|/mu);
    expect(readme).not.toMatch(/^\|\s*Form Package(?: format)?\s*\|/mu);
    expect(versioning).toContain("Host API major, each Form's");
    expect(versioning).toContain("Core/library SemVer, and Provider SemVer");
    expect(versioning).toMatch(/There is no current\s+Specification 1\.0 or 1\.1 release lane/iu);
    expect(versioning).toMatch(/package envelope[\s\S]+not a\s+fifth product release stream/iu);
    expect(publication).toMatch(/Specification 1\.1 is immutable history/iu);
    expect(publication).toMatch(/There is no current Specification 1\.0 or 1\.1 release lane/iu);
    expect(publication).toMatch(/Host API v1[\s\S]+semantics are frozen/iu);
  });

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
    ["Provider implementation authority", "Core owns the Provider projection and Terraform resource schema."],
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

  test("allows proposal documents to explore future vocabulary", () => {
    const entries = baseEntries();
    entries.set(
      "spec/proposals/future.md",
      "Proposal: evaluate forms.takoform.com/v2 and a Provider mapping.\n[old](../form-families.md)\n",
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
