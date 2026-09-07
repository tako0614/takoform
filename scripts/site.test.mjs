import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderForSearch, tokenize } from "../website/.vitepress/search.mjs";

import {
  GENERATED_INDEX_PAGES,
  FROZEN_HOST_API_SPEC_DOCUMENTS,
  HAND_AUTHORED_ROUTE_SOURCES,
  HAND_AUTHORED_PAGE_SOURCES,
  HAND_AUTHORED_PUBLIC_FILES,
  MIRRORED_SPEC_DOCUMENTS,
  SITE_PUBLIC_ROOT,
  buildSiteReproducibly,
  buildSiteFiles,
  deriveSchemas,
  distPagePathForSource,
  inspectPublishedSourceAllowlist,
  inspectPublicDocumentAuthority,
  inspectRenderedSitePages,
  inspectSite,
  inspectSiteAssets,
  inspectDesignRecords,
  renderMirroredDocument,
  rewriteLinkTarget,
  servedPathForIdentity,
  siteRouteForSpecDocument,
  siteRouteForPageSource,
  sitePathForSpecDocument,
} from "./site.mjs";

const schemas = deriveSchemas(".");
const context = {
  root: ".",
  schemaIdentities: new Map(
    schemas.identities.map((identity) => [identity.source, identity.id]),
  ),
  mirrored: new Map(
    MIRRORED_SPEC_DOCUMENTS.map((path) => [path, siteRouteForSpecDocument(path)]),
  ),
};

describe("takoform.com site derivation", () => {
  test("publishes authoring and client guides with executable examples", () => {
    for (const prefix of ["", "en/"]) {
      for (const page of ["authoring", "client"]) {
        const file = `website/${prefix}${page}/index.md`;
        expect(HAND_AUTHORED_PAGE_SOURCES).toContain(file);
        const source = readFileSync(file, "utf8");
        expect(source).toContain("go test");
        expect(source).toContain("<<<");
      }
      const start = readFileSync(`website/${prefix}start/index.md`, "utf8");
      expect(start).toContain("POST https://host.example/apis/forms.takoform.com/v1/resources/prepare");
      expect(start).toMatch(/HTTP\/1\.1 201 Created\nContent-Type: application\/json\nETag: "1"\n\n\{/u);
    }
  });
  test("renders tested source regions in both authoring and client guides", async () => {
    const { createMarkdownRenderer } = await import("vitepress");
    const markdown = await createMarkdownRenderer(join(process.cwd(), "website"));
    for (const prefix of ["", "en/"]) {
      for (const [page, names] of [["authoring", ["exampleDefinition", "ExampleVerifyFS"]], ["client", ["ExampleClient_ApplyResource"]]]) {
        const path = `website/${prefix}${page}/index.md`;
        const html = markdown.render(readFileSync(path, "utf8"), { path: join(process.cwd(), path) });
        for (const name of names) expect(html).toContain(name);
        expect(html).not.toContain("Code snippet path not found");
      }
    }
  }, 30_000);
  test("tokenizes Japanese prose without splitting API identifiers", () => {
    expect(tokenize("パッケージを検証します。packageDigest schemaDigest"))
      .toEqual(expect.arrayContaining(["パッケージ", "検証", "packageDigest", "schemaDigest"]));
    expect(tokenize("  。  ")).toEqual([]);
    const html = '<h2 id="guide">設定項目<a href="#guide">#</a></h2><p>パッケージを検証します。</p>';
    const output = renderForSearch("", {}, { render: () => html });
    expect(output).toContain('<h2 id="guide">設定項目<a href="#guide">#</a></h2>');
    expect(output).toContain("パッケージ を 検証");
    expect(renderForSearch("", { frontmatter: { search: false } }, { render: () => html })).toBe("");
  });
  test("keeps the standard-theme homepage useful without a custom palette", () => {
    const source = readFileSync("website/index.md", "utf8");
    for (const target of ["/start/", "/reference/", "/model/", "/host-api/"]) {
      expect(source).toContain(`link: ${target}`);
    }
    expect(source).not.toContain("sidebar: false");
    const component = readFileSync("website/.vitepress/theme/components/HomePage.vue", "utf8");
    expect(component).toContain("<VPHomeHero />");
    expect(component).toContain("<VPHomeFeatures />");
    const css = readFileSync("website/.vitepress/theme/custom.css", "utf8");
    expect(css).not.toMatch(/--vp-(?:c-|font-family)[\w-]*\s*:/u);
    expect(css).not.toContain("tokens.css");
  });
  test("exposes every locale page and top-level destination in a complete sidebar", async () => {
    const config = (await import("../website/.vitepress/config.mts")).default;
    expect(config.locales.root.label).toBe("日本語");
    expect(config.locales.en.label).toBe("English");
    for (const prefix of ["", "/en"]) {
    const theme = prefix ? config.locales.en.themeConfig : config.themeConfig;
    const sidebar = theme.sidebar;
    expect(Array.isArray(sidebar)).toBe(true);
    const links = [];
    const visit = (items) => {
      for (const item of items) {
        expect(item.collapsed).not.toBe(true);
        if (item.link) links.push(item.link);
        if (item.items) visit(item.items);
      }
    };
    visit(sidebar);
    const publishedRoutes = [
      ...HAND_AUTHORED_PAGE_SOURCES.map(siteRouteForPageSource),
      ...GENERATED_INDEX_PAGES.map(siteRouteForPageSource),
      ...MIRRORED_SPEC_DOCUMENTS.map((source) => `${prefix}${siteRouteForSpecDocument(source)}`),
    ].filter((route) => route.startsWith("/en/") === !!prefix);
    expect(links.filter((link) => link.startsWith("/")).sort()).toEqual(
      [...new Set(publishedRoutes)].sort(),
    );
    for (const item of theme.nav) expect(links).toContain(item.link);
    }
  });
  test("translations preserve every example byte and pair all guide headings", async () => {
    const { createMarkdownRenderer } = await import("vitepress");
    const markdown = await createMarkdownRenderer(join(process.cwd(), "website"));
    const ids = (source, path) => [...markdown.render(source, { path: join(process.cwd(), path) }).matchAll(/<h[1-6]\b[^>]*id="([^"]+)"/gu)].map((match) => match[1]);
    const fences = (source) => source.match(/^```[^\n]*\n[\s\S]*?^```/gmu) ?? [];
    const links = (source) => [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)]
      .map((match) => match[1].replace(/^\/en\//u, "/")).sort();
    for (const source of HAND_AUTHORED_PAGE_SOURCES.filter((path) => !path.startsWith("website/en/"))) {
      const japanese = readFileSync(source, "utf8");
      const english = readFileSync(source.replace("website/", "website/en/"), "utf8");
      expect(fences(english)).toEqual(fences(japanese));
      expect(english.match(/^<<< .+$/gmu) ?? []).toEqual(japanese.match(/^<<< .+$/gmu) ?? []);
      expect(ids(english, source.replace("website/", "website/en/"))).toEqual(ids(japanese, source));
      expect(links(english)).toEqual(links(japanese));
    }
  });
  test("requires intact source and built site assets", () => {
    const root = mkdtempSync(join(tmpdir(), "takoform-site-assets-"));
    try {
      expect(inspectSiteAssets(root)).toContain("website/public/_headers is missing");
      for (const path of HAND_AUTHORED_PUBLIC_FILES) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), readFileSync(path));
        const target = join(root, "dist", path.slice(SITE_PUBLIC_ROOT.length + 1));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(path));
      }
      expect(inspectSiteAssets(root, "dist")).toEqual([]);
      writeFileSync(join(root, "dist/_headers"), "changed");
      expect(inspectSiteAssets(root, "dist")).toContain("dist/_headers differs from website/public/_headers");
      rmSync(join(root, "dist/robots.txt"));
      expect(inspectSiteAssets(root, "dist")).toContain("dist/robots.txt is missing");
      writeFileSync(join(root, "website/public/robots.txt"), "");
      expect(inspectSiteAssets(root)).toContain("website/public/robots.txt is empty");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps design records explicit without treating a review score as a product gate", () => {
    const root = mkdtempSync(join(tmpdir(), "takoform-design-records-"));
    try {
      expect(inspectDesignRecords(root)).toHaveLength(2);
      mkdirSync(join(root, ".hallmark"));
      for (const name of ["preflight", "log"]) {
        writeFileSync(join(root, `.hallmark/${name}.json`), readFileSync(`.hallmark/${name}.json`));
      }
      expect(inspectDesignRecords(root)).toEqual([]);
      writeFileSync(join(root, ".hallmark/log.json"), "[]");
      expect(inspectDesignRecords(root)).toContain(".hallmark/log.json has invalid design-record fields");
      writeFileSync(join(root, ".hallmark/log.json"), "broken");
      expect(inspectDesignRecords(root)).toContain(".hallmark/log.json is missing or invalid JSON");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("refuses a publishable tree that changes across consecutive builds", () => {
    const observed = ["sha256:first", "sha256:second"];
    expect(() =>
      buildSiteReproducibly(".", {
        build: () => {},
        digest: () => observed.shift(),
      })
    ).toThrow("site build is not reproducible");
  });

  test("returns the digest of a reproducible publishable tree", () => {
    let builds = 0;
    expect(buildSiteReproducibly(".", {
      build: () => builds++,
      digest: () => "sha256:stable",
    })).toBe("sha256:stable");
    expect(builds).toBe(2);
  });

  test("every generated page and served schema equals its derivation", () => {
    expect(inspectSite(".")).toEqual([]);
  });

  test("serves one file per ledger identity at the path the $id names", () => {
    const files = buildSiteFiles(".");
    for (const identity of schemas.identities) {
      expect(files.has(`${SITE_PUBLIC_ROOT}${identity.path}`)).toBe(true);
    }
    const served = [...files.keys()].filter((path) =>
      path.startsWith(`${SITE_PUBLIC_ROOT}/schemas/`)
    );
    expect(served.length).toBe(schemas.identities.length);
  });

  test("derives every index page and every mirrored specification page", () => {
    const files = buildSiteFiles(".");
    for (const page of GENERATED_INDEX_PAGES) expect(files.has(page)).toBe(true);
    for (const specPath of MIRRORED_SPEC_DOCUMENTS) {
      expect(files.has(sitePathForSpecDocument(specPath))).toBe(true);
    }
  });

  test("describes non-retired identities as mixed authoring/readable inventory", () => {
    const index = buildSiteFiles(".").get("website/en/schemas/index.md")?.toString("utf8");
    expect(index).toContain("current-authoring");
    expect(index).toContain("retained-readable");
    expect(index).toContain("does not say that a profile is valid");
    expect(index).toContain("current-authoring guidance");
    expect(index).toContain("[schema role table](/en/spec/schemas/)");
    const japanese = buildSiteFiles(".").get("website/schemas/index.md").toString("utf8");
    expect(japanese).toContain("新規作成に適していることまでは示しません");
    expect(japanese).toContain("[スキーマの用途一覧](/spec/schemas/)");
    expect(index).not.toContain("authoring と verification の双方に使える identity です。");
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
    expect(distPagePathForSource("website/index.md")).toBe(
      "website/.vitepress/dist/index.html",
    );
    expect(distPagePathForSource("website/host-api/index.md")).toBe(
      "website/.vitepress/dist/host-api/index.html",
    );
    expect(distPagePathForSource("website/site.md")).toBe(
      "website/.vitepress/dist/site.html",
    );
    expect(siteRouteForPageSource("website/index.md")).toBe("/");
    expect(siteRouteForPageSource("website/start/index.md")).toBe("/start/");
    expect(siteRouteForPageSource("website/glossary.md")).toBe("/glossary");
  });

  test("checks rendered navigation, fragments, authority, and home semantics", () => {
    const home = `<!doctype html>
<html lang="ja-JP" data-document-authority="non-normative">
<head><title>Takoform</title>
<meta property="og:title" content="Takoform"><meta property="og:url" content="https://takoform.com/">
<meta property="og:description" content="Contract"><meta name="twitter:title" content="Takoform"><meta name="twitter:description" content="Contract">
</head><body>
<a href="/guide">Guide</a>
<main>
  <h1>Resource definitions and management API</h1>
</main></body></html>`;
    const guide = `<!doctype html>
<html lang="ja-JP" data-document-authority="non-normative">
<head><title>Guide</title>
<meta property="og:title" content="Guide"><meta property="og:url" content="https://takoform.com/guide">
<meta property="og:description" content="Guide"><meta name="twitter:title" content="Guide"><meta name="twitter:description" content="Guide">
</head><body><a href="/">Home</a><h1 id="guide">Guide</h1></body></html>`;
    const pages = [
      {
        path: "dist/index.html",
        route: "/",
        html: home,
        lang: "ja-JP",
        authority: "non-normative",
        mirror: false,
      },
      {
        path: "dist/guide.html",
        route: "/guide",
        html: guide,
        lang: "ja-JP",
        authority: "non-normative",
        mirror: false,
      },
    ];
    expect(inspectRenderedSitePages(pages)).toEqual([]);
    pages[0] = { ...pages[0], html: home.replace('href="/guide"', 'href="/guide#missing"') };
    expect(inspectRenderedSitePages(pages)).toContain(
      "dist/index.html links to missing fragment /guide#missing",
    );
    pages[1] = { ...pages[1], html: guide.replace('content="https://takoform.com/guide"', 'content="https://takoform.com/"') };
    expect(inspectRenderedSitePages(pages)).toContain("dist/guide.html must render matching non-empty og:url");
    pages[1] = { ...pages[1], html: guide.replace('property="og:title" content="Guide"', 'property="og:title" content="Takoform"') };
    expect(inspectRenderedSitePages(pages)).toContain("dist/guide.html must render matching non-empty og:title");
    pages[0] = { ...pages[0], html: home.replace('<a href="/guide">Guide</a>', '') };
    pages[1] = { ...pages[1], html: guide.replace('<a href="/">Home</a>', '<a href="/guide#guide">Self</a>') };
    expect(inspectRenderedSitePages(pages)).toContain("/guide is not reachable from the home page");
  });

  test("does not mirror the retired lanes or the decision bodies", () => {
    expect(MIRRORED_SPEC_DOCUMENTS).not.toContain("spec/host-api/v1beta1.md");
    expect(MIRRORED_SPEC_DOCUMENTS).not.toContain("spec/host-api/v1beta4.md");
    expect(MIRRORED_SPEC_DOCUMENTS.some((path) => path.startsWith("spec/decisions/"))).toBe(false);
    expect(MIRRORED_SPEC_DOCUMENTS.some((path) => path.startsWith("spec/proposals/"))).toBe(false);
  });

  test("derives frozen Host API mirrors from the freeze while presentation stays mutable", () => {
    expect(FROZEN_HOST_API_SPEC_DOCUMENTS).toEqual([
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
    expect(MIRRORED_SPEC_DOCUMENTS).toContain("spec/host-api/v1.md");
    expect(new Set(MIRRORED_SPEC_DOCUMENTS).size).toBe(MIRRORED_SPEC_DOCUMENTS.length);
    for (const path of HAND_AUTHORED_PAGE_SOURCES) {
      expect(FROZEN_HOST_API_SPEC_DOCUMENTS).not.toContain(path);
    }
  });

  test("does not mirror publisher-owned lifecycle records", () => {
    expect(MIRRORED_SPEC_DOCUMENTS).not.toContain("spec/project-lifecycle.md");
    expect(buildSiteFiles(".").has("website/spec/project-lifecycle.md")).toBe(false);
  });

  test("keeps normative claims inside the freeze and classifies mutable spec indexes", () => {
    const frozen = new Set(["spec/frozen.md"]);
    expect(inspectPublicDocumentAuthority(
      new Map([
        ["spec/frozen.md", "# Contract\n\nA Host MUST reject this input.\n"],
        ["spec/index.md", "# Index\n\nThis non-normative index only links to contracts.\n"],
        ["website/guide.md", "# Guide\n\nThis page explains the contract.\n"],
      ]),
      frozen,
      { classificationRequiredPaths: new Set(["spec/frozen.md", "spec/index.md"]) },
    )).toEqual([]);

    expect(inspectPublicDocumentAuthority(
      new Map([["spec/shadow.md", "# Shadow contract\n\nA Host MUST accept this input.\n"]]),
      frozen,
      { classificationRequiredPaths: new Set(["spec/shadow.md"]) },
    )).toEqual([
      "spec/shadow.md is a public/current document outside the frozen closure and must explicitly declare itself non-normative",
    ]);
    expect(inspectPublicDocumentAuthority(
      new Map([["website/guide.md", "# Guide\n\nA Host MUST accept this input.\n"]]),
      frozen,
    )).toEqual([
      "website/guide.md defines normative behavior outside the frozen closure",
    ]);
  });

  test("requires an explicit non-normative declaration on the Japanese schema index", () => {
    const path = "website/schemas/index.md";
    const options = { classificationRequiredPaths: new Set([path]) };
    expect(inspectPublicDocumentAuthority(new Map([[path, "この索引は案内用であり、仕様ではありません。"]]), new Set(), options)).toEqual([]);
    expect(inspectPublicDocumentAuthority(new Map([[path, "この索引は仕様です。"]]), new Set(), options)).toHaveLength(1);
  });

  test("marks frozen mirrors normative and mutable indexes non-normative", () => {
    const normative = renderMirroredDocument(
      "spec/host-api/v1.md",
      "# Host API v1\n",
      context,
    );
    expect(normative).toContain("normative: true");

    const index = renderMirroredDocument("spec/README.md", "# Index\n", context);
    expect(index).toContain("normative: false");
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
        .toBe("https://github.com/tako0614/takoform/blob/main/spec/project-lifecycle.md");
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

    test("records the canonical source without assigning normative status", () => {
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

  test("refuses an ad-hoc Form page or public status file outside the allowlist", () => {
    expect(
      inspectPublishedSourceAllowlist(
        [
          "website/index.md",
          "website/forms/example.md",
          "website/public/site-status.json",
        ],
        new Set(),
      ),
    ).toEqual([
      "website/forms/example.md would publish a page outside the API/common-model allowlist",
      "website/public/site-status.json would publish a static file outside the schema/site-asset allowlist",
    ]);
  });

  test("allows the reader-first hand-authored route and asset inventory", () => {
    expect(HAND_AUTHORED_PAGE_SOURCES).toEqual(
      expect.arrayContaining([
        "website/start/index.md",
        "website/guides/index.md",
        "website/reference/index.md",
        "website/glossary.md",
      ]),
    );
    expect(HAND_AUTHORED_ROUTE_SOURCES).toEqual([
      "website/start/index.md",
      "website/guides/index.md",
      "website/authoring/index.md",
      "website/client/index.md",
      "website/reference/index.md",
      "website/glossary.md",
    ]);
    expect(HAND_AUTHORED_PUBLIC_FILES).toEqual(
      expect.arrayContaining([
        "website/public/_headers",
        "website/public/robots.txt",
      ]),
    );
    expect(
      inspectPublishedSourceAllowlist(
        [
          "website/start/index.md",
          "website/guides/index.md",
          "website/reference/index.md",
          "website/glossary.md",
          "website/public/_headers",
          "website/public/robots.txt",
        ],
        new Set(),
      ),
    ).toEqual([]);
  });

  test("keeps the local optimizer target separate from the release build target", async () => {
    const config = (await import("../website/.vitepress/config.mts")).default;
    expect(config.vite?.optimizeDeps?.esbuildOptions?.target).toBe("esnext");
    expect(config.vite?.build?.target).toBe("esnext");
    expect(config.markdown?.theme).toEqual({
      light: "github-light-high-contrast",
      dark: "github-dark-high-contrast",
    });
    expect(config.themeConfig?.search?.provider).toBe("local");
    expect(config.head).toContainEqual([
      "link",
      { rel: "icon", href: "data:," },
    ]);
    expect(config.themeConfig?.logo).toBeUndefined();
    expect(config.head.some(([, attrs]) =>
      /^(?:og:image|twitter:image)(?::|$)/u.test(attrs.property ?? attrs.name ?? ""),
    )).toBe(false);
    expect(inspectPublishedSourceAllowlist(
      ["website/public/favicon.svg", "website/public/social-card.png"], new Set(),
    )).toHaveLength(2);
    for (const [relativePath, route] of [["index.md", "/"], ["start/index.md", "/start/"], ["spec/host-api/v1.md", "/spec/host-api/v1"], ["glossary.md", "/glossary"]]) {
      const head = config.transformHead({ pageData: { relativePath }, title: "Page | Takoform", description: "Page description" });
      expect(head).toContainEqual(["meta", { property: "og:url", content: `https://takoform.com${route}` }]);
      expect(head).toContainEqual(["meta", { property: "og:title", content: "Page | Takoform" }]);
    }
    expect(config.themeConfig?.nav?.slice(0, 3)).toEqual([
      { text: "はじめる", link: "/start/" },
      { text: "ガイド", link: "/guides/" },
      { text: "仕様", link: "/reference/" },
    ]);
    const links = [];
    const collectLinks = (value) => {
      if (Array.isArray(value)) {
        for (const item of value) collectLinks(item);
      } else if (value && typeof value === "object") {
        if (typeof value.link === "string") links.push(value.link);
        for (const child of Object.values(value)) collectLinks(child);
      }
    };
    collectLinks(config.themeConfig?.nav);
    collectLinks(config.themeConfig?.sidebar);
    expect(links).toEqual(
      expect.arrayContaining(["/start/", "/guides/", "/reference/", "/glossary"]),
    );
    const frozen = config.transformHtml?.(
      '<html lang="ja-JP"><head></head></html>',
      "spec/host-api/v1.md",
      { pageData: { relativePath: "spec/host-api/v1.md", frontmatter: { normative: true } } },
    );
    expect(frozen).toContain('lang="ja-JP"');
    expect(frozen).toContain('data-document-authority="normative"');
    const guide = config.transformHtml?.(
      '<html lang="ja-JP"><head></head></html>',
      "start/index.md",
      { pageData: { relativePath: "start/index.md", frontmatter: {} } },
    );
    expect(guide).toContain('lang="ja-JP"');
    expect(guide).toContain('data-document-authority="non-normative"');
  });

  test("refuses a schema served at a path or origin other than its $id", () => {
    expect(() =>
      servedPathForIdentity({
        id: "https://forms.takoform.com/schemas/v1/form-ref.schema.json",
        public: "website/public/schemas/elsewhere/form-ref.schema.json",
      })
    ).toThrow("declares public path");
    expect(() =>
      servedPathForIdentity({
        id: "https://example.test/schemas/v1/form-ref.schema.json",
        public: "website/public/schemas/v1/form-ref.schema.json",
      })
    ).toThrow("identity origin");
  });
});
