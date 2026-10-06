import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { renderForSearch, tokenize } from "../website/.vitepress/search.mjs";
import { documentVersion } from "../website/.vitepress/versions.mjs";

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
  V2_SPEC_DOCUMENTS,
  V2_SOURCE_PREFIX,
  v2NormativeSourceRoute,
  renderV2SpecDocument,
  rewriteLinkTarget,
  servedPathForIdentity,
  siteRouteForSpecDocument,
  siteRouteForPageSource,
  sitePathForSpecDocument,
  sitePathForV2SpecDocument,
  siteRouteForV2SpecDocument,
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
  test("connects the authoring, client, and getting-started guides to v2", () => {
    for (const prefix of ["", "en/"]) {
      const authoringPath = `website/${prefix}authoring/index.md`;
      const clientPath = `website/${prefix}client/index.md`;
      expect(HAND_AUTHORED_PAGE_SOURCES).toContain(authoringPath);
      expect(HAND_AUTHORED_PAGE_SOURCES).toContain(clientPath);
      const authoring = readFileSync(authoringPath, "utf8");
      const client = readFileSync(clientPath, "utf8");
      expect(authoring).toContain("https://forms.publisher.example/key-value-entry/1.0.0");
      expect(authoring).toContain("BASE_URL");
      expect(authoring).toContain(`/${prefix}spec/host-api/v2/forms`);
      expect(client).toContain("Idempotency-Key");
      expect(client).toContain(`/${prefix}spec/host-api/v2/http`);
      const start = readFileSync(`website/${prefix}start/index.md`, "utf8");
      expect(start).toContain("GET /.well-known/takoform/v2 HTTP/1.1");
      expect(start).toContain("POST /apis/forms.takoform.com/v2/resources HTTP/1.1");
      expect(start).toContain("PUT /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1");
      expect(start).toContain("DELETE /apis/forms.takoform.com/v2/resources/r_1 HTTP/1.1");
      expect(start).toContain("Takoform-Expected-Generation: 1");
      expect(start).toContain("Takoform-Expected-Generation: 2");
      expect(start).toContain("HTTP/1.1 202 Accepted");
    }
  });
  test("renders v2 contract links in both authoring and client guides", async () => {
    const { createMarkdownRenderer } = await import("vitepress");
    const markdown = await createMarkdownRenderer(join(process.cwd(), "website"));
    for (const prefix of ["", "en/"]) {
      for (const page of ["authoring", "client"]) {
        const path = `website/${prefix}${page}/index.md`;
        const html = markdown.render(readFileSync(path, "utf8"), { path: join(process.cwd(), path) });
        expect(html).toContain(`href="/${prefix}spec/host-api/v2/http.html`);
        expect(html).not.toContain("Code snippet path not found");
      }
    }
  }, 30_000);
  test("uses English page titles in both locales, including generated indexes", () => {
    const derived = buildSiteFiles(".");
    const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    for (const path of [...HAND_AUTHORED_PAGE_SOURCES, ...GENERATED_INDEX_PAGES]) {
      const source = derived.get(path)?.toString("utf8") ?? readFileSync(path, "utf8");
      const title = source.match(/^title: (.+)$/mu)?.[1];
      const heading = source.match(/^# (.+)$/mu)?.[1]?.replace(/\s*\{#[^}]+\}/u, "");
      expect(title, `${path}: browser title`).toBeDefined();
      expect(japanese.test(title), `${path}: browser title must be English`).toBe(false);
      if (heading) expect(japanese.test(heading), `${path}: page heading must be English`).toBe(false);
    }
  });
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
  test("explains the model and lifecycle with version selection left to the header", () => {
    const source = readFileSync("website/index.md", "utf8");
    expect(source).toContain("title: Takoform\n");
    expect(source).toContain("titleTemplate: false");
    const component = readFileSync("website/.vitepress/theme/components/HomePage.vue", "utf8");
    for (const target of [
      "/client/",
      "/authoring/",
      "/host-api/",
    ]) expect(component).toContain(target);
    expect(component).toContain('<h1 id="home-title">Takoform</h1>');
    expect(component).toContain("Form");
    expect(component).toContain("Host");
    expect(component).not.toContain("Open to revision");
    expect(component).not.toContain("改訂可能");
    expect(component).not.toContain("/reference/");
    expect(component).not.toContain("home-index");
    expect(component).toContain("A common HTTP API for resource management.");
    expect(component).toContain("Forms, Hosts and clients");
    expect(component).toContain("POST /apis/forms.takoform.com/v2/resources");
  });
  test("separates version sidebars and keeps shared pages out of their sequences", async () => {
    const config = (await import("../website/.vitepress/config.mts")).default;
    expect(config.locales.root.label).toBe("日本語");
    expect(config.locales.en.label).toBe("English");
    for (const localePrefix of ["", "/en"]) {
      const theme = localePrefix ? config.locales.en.themeConfig : config.themeConfig;
      expect(theme.nav.map((item) => item.link)).toEqual(
        [`${localePrefix}/`],
      );
      const sidebars = theme.sidebar;
      expect(Array.isArray(sidebars)).toBe(false);
      const collect = (items) => {
        const links = [];
        const visit = (nested) => {
          for (const item of nested) {
            expect(item.collapsed).not.toBe(true);
            if (item.link) links.push(item.link);
            if (item.items) visit(item.items);
          }
        };
        visit(items);
        return links;
      };
      expect(sidebars["/"]).toEqual([]);
      expect(sidebars[`${localePrefix}/site`]).toEqual([]);
      const v1Links = collect(sidebars[`${localePrefix}/v1/`]);
      const v2Links = collect(sidebars[`${localePrefix}/v2/`]);
      const publishedRoutes = [
        ...HAND_AUTHORED_PAGE_SOURCES.map(siteRouteForPageSource),
        ...GENERATED_INDEX_PAGES.map(siteRouteForPageSource),
        ...V2_SPEC_DOCUMENTS.map((document) => siteRouteForV2SpecDocument(document.path, localePrefix ? "en" : "ja")),
        ...MIRRORED_SPEC_DOCUMENTS.map((source) =>
          `${localePrefix}${siteRouteForSpecDocument(source)}`
        ),
      ].filter((route) => route.startsWith("/en/") === !!localePrefix);
      for (const [version, links] of [["v1", v1Links], ["v2", v2Links]]) {
        expect(links.every((link) => documentVersion(link) === version)).toBe(true);
        expect([...links].sort()).toEqual([...new Set(publishedRoutes.filter((route) => documentVersion(route) === version))].sort());
      }
      expect(v1Links).toContain(`${localePrefix}/schemas/`);
      expect(v1Links).toContain(`${localePrefix}/conformance/`);
      expect(v1Links).not.toContain(`${localePrefix}/glossary`);
      const expectedV2Routes = [
        `${localePrefix}/v2/`,
        ...V2_SPEC_DOCUMENTS.map((document) =>
          siteRouteForV2SpecDocument(document.path, localePrefix ? "en" : "ja")
        ),
        ...["start", "model", "client", "authoring", "use", "host-api", "guides"]
          .map((page) => `${localePrefix}/${page}/`),
        `${localePrefix}/glossary`,
      ];
      expect(v2Links.filter((link) => link.startsWith("/")).sort()).toEqual(
        [...new Set(expectedV2Routes)].sort(),
      );
      expect(theme.nav.map((item) => documentVersion(item.link))).toEqual([null]);
    }
  });
  test("translations preserve every example byte and pair all guide headings", async () => {
    const { createMarkdownRenderer } = await import("vitepress");
    const markdown = await createMarkdownRenderer(join(process.cwd(), "website"));
    const ids = (source, path) => [...markdown.render(source, { path: join(process.cwd(), path) }).matchAll(/<h[1-6]\b[^>]*id="([^"]+)"/gu)].map((match) => match[1]);
    const fences = (source) => source.match(/^```[^\n]*\n[\s\S]*?^```/gmu) ?? [];
    const links = (source, normalizeExternalLocale = false) => [...source.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)]
      .map((match) => {
        const target = match[1].replace(/^\/en\//u, "/")
          .replace(/^https:\/\/takoform\.com\/en\//u, "https://takoform.com/");
        return normalizeExternalLocale
          ? target
            .replace(/^(https:\/\/[^/]+)\/(?:en|ja)(?=\/|[?#]|$)(.*)$/iu, "$1$2")
            .replace(
              "https://github.com/tako0614/terraform-provider-takoform/blob/main/docs/ja/getting-started.md",
              "https://github.com/tako0614/terraform-provider-takoform/blob/main/docs/getting-started.md",
            )
          : target;
      }).sort();
    for (const source of HAND_AUTHORED_PAGE_SOURCES.filter((path) =>
      !path.startsWith("website/en/") && path !== "website/v2/index.md"
    )) {
      const japanese = readFileSync(source, "utf8");
      const english = readFileSync(source.replace("website/", "website/en/"), "utf8");
      expect(fences(english)).toEqual(fences(japanese));
      expect(english.match(/^<<< .+$/gmu) ?? []).toEqual(japanese.match(/^<<< .+$/gmu) ?? []);
      expect(ids(english, source.replace("website/", "website/en/"))).toEqual(ids(japanese, source));
      expect(links(english)).toEqual(links(japanese));
    }
    expect(readFileSync("website/en/v2/index.md", "utf8"))
      .toContain("The overview, HTTP API, and Form requirements are normative.");
    expect(readFileSync("website/en/v2/index.md", "utf8"))
      .toContain("Examples and migration guidance explain the specification.");
    expect(readFileSync("spec/host-api/v2/migration.md", "utf8"))
      .toContain("[v1 contract](../v1.md)");
    expect(readFileSync("website/en/v2/index.md", "utf8"))
      .not.toContain("remains open to revision");
    expect(readFileSync("website/v2/index.md", "utf8"))
      .toContain("Host実装者:");
    expect(readFileSync("website/v2/index.md", "utf8"))
      .toContain("クライアント実装者:");
    expect(readFileSync("website/en/v2/index.md", "utf8"))
      .toContain("Host implementers:");
    expect(readFileSync("website/en/v2/index.md", "utf8"))
      .toContain("Client implementers:");
    expect(readFileSync("website/v2/index.md", "utf8"))
      .toContain("/spec/host-api/v2/migration");
    expect(readFileSync("website/en/v2/index.md", "utf8"))
      .toContain("/en/spec/host-api/v2/migration");
    expect(links("[guide](https://publisher.example/en/forms/?lang=en#start)", true))
      .toEqual(links("[guide](https://publisher.example/forms/?lang=en#start)", true));
    expect(links("[guide](https://publisher.example/en/forms/)", true))
      .not.toEqual(links("[guide](https://other.example/forms/)", true));
    expect(links("[guide](https://publisher.example/en/forms/)", true))
      .not.toEqual(links("[guide](https://publisher.example/other/forms/)", true));
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

  test("preserves specification bytes and HTML revalidation without changing schema caching and CORS", () => {
    const headers = readFileSync("website/public/_headers", "utf8");
    // The production zone's email obfuscation rewrote user@host.example in
    // the HTTP specification while the immutable Pages URL stayed intact.
    // Pages overrides its default Cache-Control with custom headers, and
    // combines matching rules. Keep HTML and schema cache policies disjoint.
    expect(headers).toMatch(/^\/spec\/\*\r?\n[ \t]+cache-control: public, max-age=0, must-revalidate, no-transform\s*$/m);
    expect(headers).toMatch(/^\/en\/spec\/\*\r?\n[ \t]+cache-control: public, max-age=0, must-revalidate, no-transform\s*$/m);
    expect(headers).not.toMatch(/^\/\*\s*$/m);
    expect(headers).toMatch(/^\/schemas\/\*\r?\n[ \t]+access-control-allow-origin: \*\r?\n[ \t]+cache-control: public, max-age=3600\s*$/m);
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
    expect(inspectRenderedSitePages([{ ...pages[0], html: home.replace("<title>Takoform</title>", "<title>概要</title>") }, pages[1]]))
      .toContain("dist/index.html must render an English page title");
    expect(inspectRenderedSitePages([pages[0], { ...pages[1], html: guide.replace('<h1 id="guide">Guide</h1>', '<h1 id="guide">ガイド</h1>') }]))
      .toContain("dist/guide.html must render an English page heading");
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

  test("projects only the explicit v2 specification and migration sources with authority and release state separate", () => {
    expect(V2_SPEC_DOCUMENTS.map(({ path, normative, sourceLanguage, releaseState }) => ({
      path, normative, sourceLanguage, releaseState,
    }))).toEqual([
      { path: "spec/host-api/v2/README.md", normative: true, sourceLanguage: "en", releaseState: "published" },
      { path: "spec/host-api/v2/http.md", normative: true, sourceLanguage: "en", releaseState: "published" },
      { path: "spec/host-api/v2/forms.md", normative: true, sourceLanguage: "en", releaseState: "published" },
      { path: "spec/host-api/v2/examples.md", normative: false, sourceLanguage: "en", releaseState: "published" },
      { path: "spec/host-api/v2/migration.md", normative: false, sourceLanguage: "en", releaseState: "published" },
    ]);
    for (const document of V2_SPEC_DOCUMENTS) {
      expect(MIRRORED_SPEC_DOCUMENTS).not.toContain(document.path);
      expect(FROZEN_HOST_API_SPEC_DOCUMENTS).not.toContain(document.path);
    }
    expect(sitePathForV2SpecDocument("spec/host-api/v2/README.md"))
      .toBe("website/spec/host-api/v2/index.md");
    expect(siteRouteForV2SpecDocument("spec/host-api/v2/README.md"))
      .toBe("/spec/host-api/v2/");
    expect(sitePathForV2SpecDocument("spec/host-api/v2/forms.md", "en"))
      .toBe("website/en/spec/host-api/v2/forms.md");
    expect(siteRouteForV2SpecDocument("spec/host-api/v2/forms.md", "en"))
      .toBe("/en/spec/host-api/v2/forms");
    expect(sitePathForV2SpecDocument("spec/host-api/v2/migration.md"))
      .toBe("website/spec/host-api/v2/migration.md");
    expect(siteRouteForV2SpecDocument("spec/host-api/v2/migration.md", "en"))
      .toBe("/en/spec/host-api/v2/migration");

    const files = buildSiteFiles(".");
    expect(V2_SOURCE_PREFIX).toBe("/_source/host-api/v2");
    for (const document of V2_SPEC_DOCUMENTS.filter((entry) => entry.normative)) {
      const raw = `website/public${v2NormativeSourceRoute(document.path)}`;
      expect(files.get(raw)).toEqual(readFileSync(document.path));
    }
    expect(() => v2NormativeSourceRoute("spec/host-api/v2/examples.md"))
      .toThrow("unlisted v2 normative source");
    for (const document of V2_SPEC_DOCUMENTS) {
      for (const locale of ["ja", "en"]) {
        const page = files.get(sitePathForV2SpecDocument(document.path, locale))?.toString("utf8");
        expect(page).toContain(`normative: ${document.normative}`);
        expect(page).toContain(`canonicalSource: ${document.path}`);
        expect(page).toContain(`sourceLanguage: ${document.sourceLanguage}`);
        expect(page).toContain(`releaseState: ${document.releaseState}`);
        expect(page).toContain('<div lang="en" class="specification-source">');
        if (document.normative) {
          expect(page).toContain(`canonicalUrl: ${v2NormativeSourceRoute(document.path)}`);
        } else {
          expect(page).not.toContain("canonicalUrl:");
        }
      }
    }
    expect(files.get("website/spec/host-api/v1.md").toString("utf8"))
      .toContain("normative: true");
    expect(files.has("website/spec/index.md")).toBe(false);
    expect(files.has("website/spec/host-api/index.md")).toBe(false);
    expect(HAND_AUTHORED_PAGE_SOURCES).not.toContain("website/reference/index.md");
    expect(files.has("website/drafts/v2/host-api-v2.md")).toBe(false);
    expect(files.has("website/spec/host-api/v2/unlisted.md")).toBe(false);
  });

  test("identifies the English normative source without requiring release-status copy", () => {
    const html = `<!doctype html><html lang="en" data-document-authority="normative"><head>
<title>V2 contract</title><meta property="og:title" content="V2 contract">
<meta property="og:url" content="https://takoform.com/">
<meta property="og:description" content="V2 contract">
<meta name="twitter:title" content="V2 contract">
<meta name="twitter:description" content="V2 contract">
</head><body><main><h1>V2 contract</h1>
<aside class="mirror-notice" data-document-authority="normative" data-release-state="published">Normative source (English original)</aside>
<div lang="en" class="specification-source">Source</div></main></body></html>`;
    const page = {
      path: "dist/index.html", route: "/", html, lang: "en", authority: "normative",
      mirror: true, releaseState: "published", sourceLanguage: "en",
    };
    expect(inspectRenderedSitePages([page])).toEqual([]);
    for (const wrong of ["revision-open source", "source", "English explanatory source", "Normative source (English original), open to revision", "改訂可能"]) {
      expect(inspectRenderedSitePages([{ ...page, html: html.replace("Normative source (English original)", wrong) }]))
        .toContain("dist/index.html does not identify its English normative source");
    }
  });

  test("rewrites v2 document links to locale-correct routes without changing frozen v1", () => {
    const v2Context = {
      ...context,
      mirrored: new Map([
        ...MIRRORED_SPEC_DOCUMENTS.map((path) => [path, siteRouteForSpecDocument(path)]),
        ...V2_SPEC_DOCUMENTS.map((document) => [
          document.path,
          siteRouteForV2SpecDocument(document.path),
        ]),
      ]),
    };
    const page = renderV2SpecDocument(
      V2_SPEC_DOCUMENTS[0],
      "[HTTP](http.md) [Form](forms.md) [examples](examples.md) [migration](migration.md) [v1](../v1.md)",
      v2Context,
    );
    expect(page).toContain("[HTTP](/spec/host-api/v2/http)");
    expect(page).toContain("[Form](/spec/host-api/v2/forms)");
    expect(page).toContain("[examples](/spec/host-api/v2/examples)");
    expect(page).toContain("[migration](/spec/host-api/v2/migration)");
    expect(page).toContain("[v1](/spec/host-api/v1)");
    expect(page).toContain("normative: true");
    expect(page).toContain("releaseState: published");
    expect(page).not.toContain("draft:");
    expect(page).not.toContain("design/takoform-v2-spec-20261004");

    const first = buildSiteFiles(".");
    const second = buildSiteFiles(".");
    for (const document of V2_SPEC_DOCUMENTS) {
      for (const locale of ["ja", "en"]) {
        const path = sitePathForV2SpecDocument(document.path, locale);
        expect(second.get(path)).toEqual(first.get(path));
      }
    }
  });

  test("rejects an unlisted v2 source instead of admitting arbitrary proposals", () => {
    const files = buildSiteFiles(".");
    expect(() => sitePathForV2SpecDocument("spec/host-api/v2/unlisted.md"))
      .toThrow("unlisted v2 specification source");
    expect(inspectPublishedSourceAllowlist(
      ["website/spec/host-api/v2/unlisted.md", "website/drafts/v2/unlisted.md"],
      new Set(files.keys()),
    )).toEqual([
      "website/spec/host-api/v2/unlisted.md would publish a page outside the API/common-model allowlist",
      "website/drafts/v2/unlisted.md would publish a page outside the API/common-model allowlist",
    ]);
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
        "website/v1/index.md",
        "website/v2/index.md",
        "website/glossary.md",
      ]),
    );
    expect(HAND_AUTHORED_ROUTE_SOURCES).toEqual([
      "website/start/index.md",
      "website/guides/index.md",
      "website/authoring/index.md",
      "website/client/index.md",
      "website/use/index.md",
      "website/v1/index.md",
      "website/v2/index.md",
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
          "website/v1/index.md",
          "website/v2/index.md",
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
    expect(config.themeConfig?.nav).toEqual([
      { text: "Overview", link: "/" },
    ]);
    expect(config.locales.en.themeConfig.nav).toEqual([
      { text: "Overview", link: "/en/" },
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
      expect.arrayContaining(["/start/", "/guides/", "/v1/", "/v2/", "/glossary"]),
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
