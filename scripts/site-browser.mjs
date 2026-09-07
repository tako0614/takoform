import assert from "node:assert/strict";
import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
  inspectDist, inspectSite, SITE_DIST, HAND_AUTHORED_PAGE_SOURCES,
  GENERATED_INDEX_PAGES, MIRRORED_SPEC_DOCUMENTS,
  siteRouteForPageSource, siteRouteForSpecDocument,
} from "./site.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const routes = ["", "/en"].flatMap((prefix) => ["/", "/start/", "/guides/", "/authoring/", "/client/", "/reference/", "/glossary", "/host-api/"].map((route) => `${prefix}${route}`));
const widths = [320, 375, 414, 768];
const sidebarRoutes = [...new Set([
  ...HAND_AUTHORED_PAGE_SOURCES.map(siteRouteForPageSource),
  ...GENERATED_INDEX_PAGES.map(siteRouteForPageSource),
  ...MIRRORED_SPEC_DOCUMENTS.flatMap((source) => [siteRouteForSpecDocument(source), `/en${siteRouteForSpecDocument(source)}`]),
])].sort();

function browserExecutable() {
  const candidates = process.env.TAKOFORM_BROWSER
    ? [process.env.TAKOFORM_BROWSER]
    : [chromium.executablePath(), "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Chrome/Chromium not found. Set TAKOFORM_BROWSER to an executable path; this command never downloads a browser.");
}

async function startPreview(directory) {
  const files = new Map();
  const collect = (path, prefix = "") => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) collect(join(path, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile()) files.set(`/${prefix}${entry.name}`, readFileSync(join(path, entry.name)));
    }
  };
  collect(directory);
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml",
    ".png": "image/png", ".woff2": "font/woff2", ".xml": "application/xml",
  };
  const server = createServer((request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const target = [path, `${path}.html`, `${path.replace(/\/$/u, "")}/index.html`]
      .find((candidate) => files.has(candidate));
    if (target === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : files.get(target));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

function inspectGeometry() {
  const documentWidth = document.documentElement.clientWidth;
  const issues = [];
  if (document.documentElement.scrollWidth > documentWidth + 1 || document.body.scrollWidth > documentWidth + 1) issues.push("horizontal document overflow");
  if (document.querySelectorAll("main").length !== 1) issues.push("expected one main landmark");
  const expectedLang = location.pathname.startsWith("/en/") ? "en" : "ja-JP";
  if (document.documentElement.lang !== expectedLang) issues.push(`expected ${expectedLang} document language`);
  if (document.title.trim() === "") issues.push("missing document title");
  for (const element of document.querySelectorAll("a[href], button, input, summary")) {
    if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    if (element.matches(".header-anchor") || element.closest(".VPSkipLink")) continue;
    const sidebar = element.closest(".VPSidebar");
    if (sidebar && !sidebar.classList.contains("open") && innerWidth < 960) continue;
    const rectangle = element.getBoundingClientRect();
    if (rectangle.width === 0 || rectangle.height === 0) continue;
    if (rectangle.left < -1 || rectangle.right > documentWidth + 1) {
      issues.push(`clipped control: ${element.textContent.trim().slice(0, 70) || element.getAttribute("aria-label") || element.tagName}`);
    }
  }
  return issues;
}

async function checkDisclosure(page, selector) {
  const trigger = page.locator(selector);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction((target) => document.querySelector(target)?.getAttribute("aria-expanded") === "true", selector);
  await page.keyboard.press("Escape");
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    return element?.getAttribute("aria-expanded") === "false" && document.activeElement === element;
  }, selector);
}

async function switchLanguage(page, width, label, expectedPath, expectedLang) {
  let menu;
  if (width < 768) {
    await page.locator(".VPNavBarHamburger").click();
    menu = page.locator(".VPNavScreenTranslations");
    await menu.locator("button.title").click();
  } else {
    menu = page.locator(width < 1280 ? ".VPNavBarExtra" : ".VPNavBarTranslations");
    await menu.locator("button.button").focus();
    await page.keyboard.press("Enter");
  }
  const fragment = new URL(page.url()).hash;
  await menu.getByRole("link", { name: label, exact: true }).click();
  await page.waitForURL((url) => url.pathname === expectedPath && url.hash === fragment);
  await page.waitForFunction((lang) => document.documentElement.lang === lang, expectedLang);
  if (fragment) assert.ok(await page.evaluate((hash) => !!document.getElementById(decodeURIComponent(hash.slice(1))), fragment), "translated fragment must resolve");
}

async function run() {
  assert.deepEqual([...inspectSite(root), ...inspectDist(root)], [], "site must pass its source and built-output checks");
  const executablePath = browserExecutable();
  const { server, origin } = await startPreview(join(root, SITE_DIST));
  let browser;
  const close = async () => {
    await browser?.close();
    server.closeAllConnections();
    if (server.listening) await new Promise((resolveClose) => server.close(resolveClose));
  };
  const interrupted = () => {
    process.exitCode = 130;
    void close();
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ reducedMotion: "reduce", colorScheme: "light" });
    const networkFailures = [];
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      networkFailures.push(`unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => networkFailures.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) networkFailures.push(`${response.status()}: ${response.url()}`);
    });
    page.on("requestfailed", (request) => networkFailures.push(`failed request: ${request.url()}`));
    const visit = async (route) => {
      await page.goto(origin + route, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      assert.deepEqual(await page.locator('.VPSidebar a[href^="/"]').evaluateAll(
        (links) => links.map((link) => link.getAttribute("href")).sort(),
      ), sidebarRoutes.filter((entry) => entry.startsWith("/en/") === route.startsWith("/en/")), `${route}: shared sidebar must contain every locale page`);
      assert.equal(await page.locator(".VPSidebarItem.collapsed").count(), 0, `${route}: sidebar groups start expanded`);
    };
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await visit(route);
        assert.deepEqual(await page.evaluate(inspectGeometry), [], `${width}px ${route}`);
      }
      await visit("/spec/host-api/v1");
      await visit("/en/spec/host-api/v1");
    }
    for (const width of [375, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [path, fragment] of [["/", ""], ["/start/", "#_0-準備"], ["/spec/host-api/v1", "#artifacts-and-operations"]]) {
        await visit(path + fragment);
        await switchLanguage(page, width, "English", `/en${path}`, "en");
        await switchLanguage(page, width, "日本語", path, "ja-JP");
        if (path.startsWith("/spec/")) assert.equal(await page.locator(".specification-source").getAttribute("lang"), "en");
      }
    }
    await page.setViewportSize({ width: 375, height: 900 });
    for (const prefix of ["", "/en"]) {
      await visit(`${prefix}/start/`);
      await page.locator(".VPNavBarSearch button").click();
      await page.locator("#localsearch-input").fill(prefix ? "packageDigest" : "パッケージ");
      const results = page.locator(".VPLocalSearchBox a.result");
      await results.first().waitFor();
      const links = await results.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
      assert.ok(links.length && links.every((link) => link.startsWith("/en/") === !!prefix), "search results must stay in the selected language");
      await results.first().click();
      await page.waitForFunction(() => !document.querySelector(".VPLocalSearchBox"));
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await visit("/");
    await checkDisclosure(page, ".VPNavBarHamburger");
    await checkDisclosure(page, ".VPLocalNav button.menu");
    await visit("/start/");
    await checkDisclosure(page, ".VPLocalNav button.menu");
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await visit("/");
      assert.equal(await page.locator(".VPSidebar").isVisible(), true, "homepage sidebar must be visible on desktop");
      assert.equal(await page.locator("html").evaluate((element) => element.classList.contains("dark")), colorScheme === "dark");
      assert.deepEqual(await page.evaluate(inspectGeometry), [], `1280px ${colorScheme}`);
      const primary = page.locator('.VPHero .VPButton[href="/start/"]');
      const bounds = await primary.boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 800, `${colorScheme}: primary action must fit first viewport`);
      await page.keyboard.press("Tab");
      await primary.focus();
      assert.ok(await primary.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      }), `${colorScheme}: primary action must have a keyboard focus indicator`);
      await page.screenshot({ path: `/tmp/takoform-docs-home-${colorScheme}.png`, fullPage: true });
    }
    assert.deepEqual(networkFailures, [], "browser runtime and asset requests");
    console.log(`site-browser: ${widths.length * routes.length} responsive pages, bilingual search, language/fragment round trips, complete shared sidebar, keyboard disclosures and themes passed (${browser.version()})`);
  } finally {
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
    await close();
  }
}

run().catch((error) => {
  console.error(`site-browser: ${error.stack ?? error.message}`);
  process.exitCode = process.exitCode || 1;
});
