import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { documentVersion, versionTarget } from "../website/.vitepress/versions.mjs";
import config from "../website/.vitepress/config.mts";

function loadInstalledGetSidebar() {
  // Bun resolves this client module's VitePress imports to the server entry.
  // Evaluate the pinned installed implementation with its two local helpers
  // so this regression exercises VitePress's actual prefix-selection logic.
  const sidebarSource = readFileSync(
    "node_modules/vitepress/dist/client/theme-default/support/sidebar.js",
    "utf8",
  );
  const utilsSource = readFileSync(
    "node_modules/vitepress/dist/client/theme-default/support/utils.js",
    "utf8",
  );
  const getSidebar = sidebarSource.match(/export function getSidebar\([\s\S]*?\n\}/u)?.[0];
  const addBase = sidebarSource.match(/function addBase\([\s\S]*?\n\}/u)?.[0];
  const ensureStartingSlash = utilsSource.match(/export function ensureStartingSlash\([\s\S]*?\n\}/u)?.[0];
  if (!getSidebar || !addBase || !ensureStartingSlash) {
    throw new Error("Could not extract VitePress sidebar resolution functions");
  }
  return new Function(
    `${ensureStartingSlash.replace(/^export /u, "")}\n${getSidebar.replace(/^export /u, "")}\n${addBase}\nreturn getSidebar;`,
  )();
}

const getSidebar = loadInstalledGetSidebar();

describe("version-separated documentation navigation", () => {
  test("assigns the documented route families to exactly one version", () => {
    for (const path of ["/start/", "/model/", "/client/", "/authoring/", "/use/", "/host-api/", "/guides/", "/glossary", "/v2/"]) {
      expect(documentVersion(path)).toBe("v2");
      expect(documentVersion(`/en${path}`)).toBe("v2");
    }
    for (const path of ["/conformance/", "/schemas/", "/spec/conformance", "/spec/core/", "/spec/host-api/v1"]) {
      expect(documentVersion(path)).toBe("v1");
      expect(documentVersion(`/en${path}`)).toBe("v1");
    }
    expect(documentVersion("/schemas/v1/form-definition.schema.json")).toBe("v1");
    expect(documentVersion("/en/schemas/support/v1/host-support-profile.schema.json")).toBe("v1");
    expect(documentVersion("/v1/")).toBe("v1");
    expect(documentVersion("/en/v1/")).toBe("v1");
    expect(documentVersion("/spec/host-api/v2/http")).toBe("v2");
    expect(documentVersion("/en/spec/host-api/v2/http")).toBe("v2");
    for (const path of ["/", "/reference/", "/site", "/spec", "/spec/", "/spec/host-api", "/spec/host-api/"]) {
      expect(documentVersion(path)).toBeNull();
      expect(documentVersion(`/en${path}`)).toBeNull();
    }
  });

  test("switches to a locale-matched version entry unless the page is already in that version", () => {
    expect(versionTarget("/en/client/#intent?view=compact", "v2")).toBe("/en/client/");
    expect(versionTarget("/spec/host-api/v1#wire", "v1")).toBe("/spec/host-api/v1");
    expect(versionTarget("/client/#intent", "v1")).toBe("/v1/");
    expect(versionTarget("/en/spec/host-api/v1#wire", "v2")).toBe("/en/v2/");
    expect(versionTarget("/en/reference/#anything", "v1")).toBe("/en/v1/");
    expect(versionTarget("/spec/host-api/", "v1")).toBe("/v1/");
    expect(() => versionTarget("/", "v3")).toThrow(TypeError);
  });

  test("keeps version-specific sidebars free of the other version's contract routes", () => {
    const collect = (items) => items.flatMap((item) => [
      ...(item.link ? [item.link] : []),
      ...(item.items ? collect(item.items) : []),
    ]);
    const rootSidebar = config.themeConfig.sidebar;
    const v1Links = collect(rootSidebar["/spec/host-api/v1"]);
    const v2Links = collect(rootSidebar["/spec/host-api/v2"]);

    expect(v1Links).toContain("/v1/");
    expect(v1Links).toContain("/conformance/");
    expect(v1Links).toContain("/schemas/");
    expect(v1Links).not.toContain("/spec/");
    expect(v1Links).not.toContain("/spec/host-api/");
    expect(v1Links.some((link) => link.includes("/spec/host-api/v2/"))).toBe(false);
    expect(v2Links.some((link) => link === "/spec/host-api/v1")).toBe(false);
    expect(v2Links.some((link) => link.startsWith("/spec/") && !link.startsWith("/spec/host-api/v2/"))).toBe(false);
    expect(v2Links).not.toContain("/reference/");
    expect(collect(rootSidebar["/glossary"])).toEqual(collect(rootSidebar["/v2/"]));
    expect(getSidebar(rootSidebar, "/spec")).toEqual([]);
    expect(getSidebar(rootSidebar, "/spec/")).toEqual([]);
    expect(getSidebar(rootSidebar, "/spec/host-api")).toEqual([]);
    expect(getSidebar(rootSidebar, "/spec/host-api/")).toEqual([]);
    expect(getSidebar(rootSidebar, "/spec/conformance")).toEqual(rootSidebar["/spec/host-api/v1"]);
    expect(getSidebar(rootSidebar, "/spec/host-api/v1")).toEqual(rootSidebar["/spec/host-api/v1"]);
    expect(getSidebar(rootSidebar, "/spec/host-api/v1.html")).toEqual(rootSidebar["/spec/host-api/v1"]);
    expect(getSidebar(rootSidebar, "/spec/core/index.html")).toEqual(rootSidebar["/spec/host-api/v1"]);
    expect(getSidebar(rootSidebar, "/spec/host-api/v2/http.html")).toEqual(rootSidebar["/spec/host-api/v2"]);
    expect(config.themeConfig.nav.map((item) => item.link)).toEqual(["/", "/v1/", "/v2/"]);
    expect(config.themeConfig.nav.map((item) => item.text)).toEqual(["概要", "v1", "v2"]);
    expect(rootSidebar["/reference/"]).toBeUndefined();
    const englishSidebar = config.locales.en.themeConfig.sidebar;
    expect(englishSidebar["/en/reference/"]).toBeUndefined();
    expect(getSidebar(englishSidebar, "/en/spec/")).toEqual([]);
    expect(getSidebar(englishSidebar, "/en/spec/host-api/")).toEqual([]);
    expect(getSidebar(englishSidebar, "/en/spec/host-api/v1.html"))
      .toEqual(englishSidebar["/en/spec/host-api/v1"]);
    expect(config.locales.en.themeConfig.nav.map((item) => item.link))
      .toEqual(["/en/", "/en/v1/", "/en/v2/"]);
    expect(config.locales.en.themeConfig.nav.map((item) => item.text))
      .toEqual(["Overview", "v1", "v2"]);

    const versionContext = readFileSync("website/.vitepress/theme/components/VersionContext.vue", "utf8");
    const homePage = readFileSync("website/.vitepress/theme/components/HomePage.vue", "utf8");
    const layout = readFileSync("website/.vitepress/theme/Layout.vue", "utf8");
    expect(versionContext).toContain("v1 frozen, v2 fixed");
    expect(versionContext).toContain('"Fixed" : "固定済み"');
    expect(homePage).toContain("A common HTTP API for managing resources.");
    expect(homePage).toContain('`${localePrefix}/v1/`');
    expect(homePage).toContain('`${localePrefix}/v2/`');
    expect(homePage).not.toContain("/reference/");
    expect(homePage).not.toContain("/site");
    expect(homePage).not.toContain("Open to revision");
    expect(versionContext).toContain("class=\"version-status\"");
    expect(versionContext).toContain('label: "API v1"');
    expect(versionContext).toContain('label: "API v2"');
    expect(versionContext).toContain("min-height: 44px");
    expect(versionContext).toContain(":focus-visible");
    expect(versionContext).toContain(":disabled=\"changingVersion\"");
    expect(versionContext).toContain("await router.go");
    expect(versionContext).toContain("vpi-chevron-down");
    expect(layout).toContain("#nav-bar-content-after");
    expect(layout).not.toContain("nav-screen-content-after");
  });
});
