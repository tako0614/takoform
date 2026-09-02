import { describe, expect, test } from "bun:test";

import { deriveSiteStatus } from "./site-status.mjs";
import {
  GENERATED_INDEX_PAGES,
  MIRRORED_SPEC_DOCUMENTS,
  SITE_PUBLIC_ROOT,
  buildSiteFiles,
  inspectSite,
  renderMirroredDocument,
  rewriteLinkTarget,
  siteRouteForSpecDocument,
  sitePathForSpecDocument,
} from "./site.mjs";

const status = deriveSiteStatus(".");
const context = {
  root: ".",
  schemaIdentities: new Map(
    status.schemas.identities.map((identity) => [identity.source, identity.id]),
  ),
  mirrored: new Map(
    MIRRORED_SPEC_DOCUMENTS.map((path) => [path, siteRouteForSpecDocument(path)]),
  ),
};

describe("takoform.com site derivation", () => {
  test("every generated page and served schema equals its derivation", () => {
    expect(inspectSite(".")).toEqual([]);
  });

  test("serves one file per ledger identity at the path the $id names", () => {
    const files = buildSiteFiles(".");
    for (const identity of status.schemas.identities) {
      expect(files.has(`${SITE_PUBLIC_ROOT}${identity.path}`)).toBe(true);
    }
    const served = [...files.keys()].filter((path) =>
      path.startsWith(`${SITE_PUBLIC_ROOT}/schemas/`)
    );
    expect(served.length).toBe(status.schemas.identities.length);
  });

  test("derives every index page and every mirrored specification page", () => {
    const files = buildSiteFiles(".");
    for (const page of GENERATED_INDEX_PAGES) expect(files.has(page)).toBe(true);
    for (const specPath of MIRRORED_SPEC_DOCUMENTS) {
      expect(files.has(sitePathForSpecDocument(specPath))).toBe(true);
    }
  });

  test("mirrors README.md as a directory index and keeps other names", () => {
    expect(sitePathForSpecDocument("spec/README.md")).toBe("website/spec/index.md");
    expect(siteRouteForSpecDocument("spec/README.md")).toBe("/spec/");
    expect(sitePathForSpecDocument("spec/host-api/README.md")).toBe(
      "website/spec/host-api/index.md",
    );
    expect(siteRouteForSpecDocument("spec/host-api/README.md")).toBe("/spec/host-api/");
    expect(sitePathForSpecDocument("spec/host-api/v1.md")).toBe("website/spec/host-api/v1.md");
    expect(siteRouteForSpecDocument("spec/host-api/v1.md")).toBe("/spec/host-api/v1");
  });

  test("does not mirror the retired lanes or the decision bodies", () => {
    expect(MIRRORED_SPEC_DOCUMENTS).not.toContain("spec/host-api/v1beta1.md");
    expect(MIRRORED_SPEC_DOCUMENTS).not.toContain("spec/host-api/v1beta4.md");
    expect(MIRRORED_SPEC_DOCUMENTS.some((path) => path.startsWith("spec/decisions/"))).toBe(false);
    expect(MIRRORED_SPEC_DOCUMENTS.some((path) => path.startsWith("spec/proposals/"))).toBe(false);
  });

  describe("link rewriting", () => {
    test("moves a schema link to the published $id rather than a repository path", () => {
      expect(rewriteLinkTarget("spec/host-api/v1.md", "../schemas/form-ref-v1.schema.json", context))
        .toBe("https://forms.takoform.com/schemas/v1/form-ref.schema.json");
    });

    test("moves a mirrored sibling to its site route and keeps the fragment", () => {
      expect(rewriteLinkTarget("spec/README.md", "host-api/v1.md", context))
        .toBe("/spec/host-api/v1");
      expect(rewriteLinkTarget("spec/README.md", "conformance.md#requirement-keywords", context))
        .toBe("/spec/conformance#requirement-keywords");
      expect(rewriteLinkTarget("spec/README.md", "form-definition/", context))
        .toBe("/spec/form-definition/");
    });

    test("sends anything the site does not serve to the source tree, not to a dead page", () => {
      expect(rewriteLinkTarget("spec/README.md", "../conformance/takoform-v1/generic.json", context))
        .toBe("https://github.com/tako0614/takoform/blob/main/conformance/takoform-v1/generic.json");
      expect(rewriteLinkTarget("spec/README.md", "../formpackage/", context))
        .toBe("https://github.com/tako0614/takoform/tree/main/formpackage");
      expect(rewriteLinkTarget("spec/versioning.md", "project-lifecycle.md", context))
        .toBe("/spec/project-lifecycle");
    });

    test("leaves absolute and fragment-only targets untouched", () => {
      expect(rewriteLinkTarget("spec/conformance.md", "https://www.rfc-editor.org/info/bcp14", context))
        .toBe("https://www.rfc-editor.org/info/bcp14");
      expect(rewriteLinkTarget("spec/conformance.md", "#requirement-keywords", context))
        .toBe("#requirement-keywords");
    });

    test("refuses a link that would escape the repository", () => {
      expect(() => rewriteLinkTarget("spec/README.md", "../../elsewhere.md", context))
        .toThrow("escapes the repository");
    });
  });

  describe("mirrored rendering", () => {
    test("keeps prose byte-identical and moves only the addresses", () => {
      const source = "# Title\n\nSee [the wire contract](host-api/v1.md) for detail.\n";
      const rendered = renderMirroredDocument("spec/README.md", source, context);
      expect(rendered).toContain("See [the wire contract](/spec/host-api/v1) for detail.");
      expect(rendered).toContain("canonicalSource: spec/README.md");
      expect(rendered).toContain("# Title");
    });

    test("does not mistake a character class inside a code span for a link", () => {
      const source = "Names match `^[a-z](x)$` exactly.\n";
      const rendered = renderMirroredDocument("spec/README.md", source, context);
      expect(rendered).toContain("`^[a-z](x)$`");
    });

    test("restores a code span without eating an adjacent number", () => {
      const source = "The `count` is 31 and the `total` is 0.\n";
      const rendered = renderMirroredDocument("spec/README.md", source, context);
      expect(rendered).toContain("The `count` is 31 and the `total` is 0.");
    });

    test("says on the page which copy is normative", () => {
      const rendered = renderMirroredDocument("spec/README.md", "# Title\n", context);
      expect(rendered).toContain(
        "canonicalUrl: https://github.com/tako0614/takoform/blob/main/spec/README.md",
      );
    });
  });

  test("reports a page nothing derives instead of leaving it served", () => {
    const files = buildSiteFiles(".");
    expect(files.has("website/spec/withdrawn-lane.md")).toBe(false);
  });
});
