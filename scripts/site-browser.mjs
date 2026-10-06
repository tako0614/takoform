import assert from "node:assert/strict";
import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { documentVersion } from "../website/.vitepress/versions.mjs";
import {
  inspectDist, inspectSite, SITE_DIST, HAND_AUTHORED_PAGE_SOURCES,
  GENERATED_INDEX_PAGES, MIRRORED_SPEC_DOCUMENTS,
  siteRouteForPageSource, siteRouteForSpecDocument,
} from "./site.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v2Routes = ["/v2/", "/spec/host-api/v2/", "/spec/host-api/v2/http", "/spec/host-api/v2/forms", "/spec/host-api/v2/examples", "/spec/host-api/v2/migration"];
const routes = ["/", "/v1/", "/spec/host-api/v1", "/schemas/", "/site", "/start/", "/model/", "/client/", "/authoring/", "/use/", "/host-api/", "/guides/", "/glossary", ...v2Routes];
const widths = [320, 375, 414, 768];
const sidebarRoutes = [...new Set([
  ...v2Routes,
  ...HAND_AUTHORED_PAGE_SOURCES.map(siteRouteForPageSource),
  ...GENERATED_INDEX_PAGES.map(siteRouteForPageSource),
  ...MIRRORED_SPEC_DOCUMENTS.map(siteRouteForSpecDocument),
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
  const redirectBytes = files.get("/_redirects");
  assert.ok(redirectBytes, "built Pages output contains the declared _redirects file");
  const redirects = redirectBytes.toString("utf8").split(/\r?\n/u).flatMap((line, index) => {
    const value = line.trim();
    if (value === "" || value.startsWith("#")) return [];
    const fields = value.split(/\s+/u);
    assert.equal(fields.length, 3, `_redirects line ${index + 1} uses from, to, and status`);
    const [from, to, statusText] = fields;
    assert.ok(from.startsWith("/") && to.startsWith("/"), `_redirects line ${index + 1} is same-origin`);
    assert.ok(!from.includes("*") && !to.includes(":splat"), `_redirects line ${index + 1} is an explicit route`);
    assert.ok(statusText === "301" || statusText === "302" || statusText === "307" || statusText === "308", `_redirects line ${index + 1} uses a supported status`);
    return [{ from, to, status: Number(statusText) }];
  });
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
    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      response.writeHead(400).end();
      return;
    }
    const redirect = redirects.find((rule) => url.pathname === rule.from);
    if (redirect) {
      response.writeHead(redirect.status, { Location: `${redirect.to}${url.search}` }).end();
      return;
    }
    let path;
    try {
      path = decodeURIComponent(url.pathname);
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
  const expectedLang = "en";
  if (document.documentElement.lang !== expectedLang) issues.push(`expected ${expectedLang} document language`);
  if (document.title.trim() === "") issues.push("missing document title");
  for (const element of document.querySelectorAll("a[href], button, input, select, summary")) {
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

async function assertDeclaredRedirect(origin, sourcePath, destinationPath) {
  const sourceUrl = new URL(sourcePath, origin);
  const expectedUrl = new URL(destinationPath, origin);
  if (expectedUrl.search === "") expectedUrl.search = sourceUrl.search;
  const response = await fetch(sourceUrl, { redirect: "manual" });
  assert.equal(response.status, 301, `${sourcePath}: legacy URL uses its declared permanent redirect`);
  assert.equal(response.headers.get("location"), `${expectedUrl.pathname}${expectedUrl.search}`, `${sourcePath}: redirect preserves the query string`);
  assert.equal(await response.text(), "", `${sourcePath}: redirect has no page body`);
}

async function assertUnlistedLegacyUrl404(origin, path) {
  const response = await fetch(new URL(path, origin), { redirect: "manual" });
  assert.equal(response.status, 404, `${path}: unlisted legacy route remains not found`);
  assert.equal(response.headers.get("location"), null, `${path}: no broad redirect is applied`);
}

async function run() {
  assert.deepEqual([...inspectSite(root), ...inspectDist(root)], [], "site must pass its source and built-output checks");
  const executablePath = browserExecutable();
  let server;
  let origin;
  let browser;
  const close = async () => {
    await browser?.close();
    server?.closeAllConnections();
    if (server?.listening) await new Promise((resolveClose) => server.close(resolveClose));
  };
  const interrupted = () => {
    process.exitCode = 130;
    void close();
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    const preview = await startPreview(join(root, SITE_DIST));
    server = preview.server;
    origin = preview.origin;
    await assertDeclaredRedirect(origin, "/en?legacy=home", "/?legacy=home");
    await assertDeclaredRedirect(origin, "/en/?legacy=home", "/?legacy=home");
    await assertDeclaredRedirect(
      origin,
      "/en/spec/host-api/v2/forms?legacy=normative&keep=%2F",
      "/spec/host-api/v2/forms?legacy=normative&keep=%2F",
    );
    await assertUnlistedLegacyUrl404(origin, "/en/spec/");
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ reducedMotion: "reduce", colorScheme: "light" });
    const networkFailures = [];
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      networkFailures.push(`unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    // Layout.vue mounts the Adring placement, which is the only external script
    // the site loads. Answer it locally so this lane stays offline while still
    // reporting any other external request as a failure. Playwright resolves
    // routes in reverse registration order, so this specific route wins.
    await context.route("https://ar-cdn.net/**", (route) => route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: "",
    }));
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
      const visibleText = await page.locator("body").innerText();
      assert.doesNotMatch(visibleText, /[\u3040-\u30ff\u3400-\u9fff]/u, `${route}: visible page content is English`);
      assert.equal(await page.locator(".VPNavBarTranslations, .VPNavScreenTranslations").count(), 0, `${route}: canonical site has no language switch`);
      const path = new URL(page.url()).pathname;
      const version = documentVersion(path);
      const expectedSidebar = version === null ? [] : sidebarRoutes.filter((entry) => documentVersion(entry) === version);
      assert.deepEqual(await page.locator('.VPSidebar a[href^="/"]').evaluateAll(
        (links) => links.map((link) => link.getAttribute("href")).sort(),
      ), expectedSidebar, `${route}: sidebar must contain the correct version pages`);
      assert.equal(await page.locator(".VPSidebarItem.collapsed").count(), 0, `${route}: sidebar groups start expanded`);
      const selector = page.locator(".version-context select");
      assert.equal(await selector.count(), 1, "one visible API-version control");
      assert.ok(await selector.isVisible(), "version control remains visible on mobile");
      assert.equal(await selector.inputValue(), version ?? "shared", `${route}: visible version matches content`);
      const bounds = await selector.boundingBox();
      assert.ok(bounds && bounds.height >= 44, "version selector has a 44px touch target");
      const adjacent = await page.locator(".VPDocFooter .prev-next a").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
      assert.ok(adjacent.every((link) => version && documentVersion(link) === version), `${route}: previous/next do not switch version`);
    };
    await page.goto(`${origin}/en/spec/host-api/v2/forms?legacy=browser&keep=%2F#state`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const redirectedUrl = new URL(page.url());
    assert.equal(redirectedUrl.pathname, "/spec/host-api/v2/forms", "legacy normative URL redirects to its root canonical route");
    assert.equal(redirectedUrl.search, "?legacy=browser&keep=%2F", "browser redirect preserves the query string");
    assert.equal(redirectedUrl.hash, "#state", "browser retains the client-side fragment across the redirect");
    assert.ok(await page.evaluate((id) => !!document.getElementById(id), "state"), "preserved normative anchor resolves at the root URL");
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await visit(route);
        assert.deepEqual(await page.evaluate(inspectGeometry), [], `${width}px ${route}`);
        if (width === 375 && ["/", "/spec/host-api/v2/http"].includes(route)) {
          const name = route === "/" ? "home-en" : "http-v2";
          await page.screenshot({ path: `/tmp/takoform-docs-${name}-375.png`, fullPage: true });
        }
      }
      await visit("/spec/host-api/v1");
    }
    for (const width of [375, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/", "/v1/", "/v2/", "/spec/host-api/v2/http", "/start/", "/spec/host-api/v1#artifacts-and-operations"]) {
        await visit(path);
        if (path.startsWith("/spec/")) assert.equal(await page.locator(".specification-source").getAttribute("lang"), "en");
      }
      await visit("/spec/host-api/v1#artifacts-and-operations");
      await page.locator(".version-context select").selectOption("v2");
      await page.waitForURL((url) => url.pathname === "/v2/" && url.hash === "");
      await page.locator(".vp-doc h1").filter({ hasText: "Host API v2" }).waitFor();
      await page.locator(".version-context select").selectOption("v1");
      await page.waitForURL((url) => url.pathname === "/v1/" && url.hash === "");
    }
    await page.setViewportSize({ width: 375, height: 900 });
    await visit("/start/");
    await page.locator(".VPNavBarSearch button").click();
    assert.equal(await page.locator("#version-search-scope").inputValue(), "v2");
    await page.locator(".VersionSearch input").fill("Takoform-Expected-Generation");
    const results = page.locator(".VersionSearch-results a");
    await results.first().waitFor();
    const links = await results.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    assert.ok(links.length && links.every((link) => !link.startsWith("/en/")), "search results use root canonical routes");
    assert.ok(links.every((link) => documentVersion(link) !== "v1"), "v2 search must exclude v1 by default");
    await results.first().click();
    await page.waitForFunction(() => !document.querySelector(".VersionSearch"));
    await visit("/spec/host-api/v1");
    await page.locator(".VPNavBarSearch button").click();
    assert.equal(await page.locator("#version-search-scope").inputValue(), "v1");
    await page.locator(".VersionSearch input").fill("Snapshot");
    await results.first().waitFor();
    assert.ok((await results.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).every((link) => documentVersion(link) !== "v2"), "v1 search excludes v2 by default");
    await page.locator("#version-search-scope").selectOption("all");
    await page.locator(".VersionSearch input").fill("Takoform-Expected-Generation");
    await results.first().waitFor();
    assert.ok((await results.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).some((link) => documentVersion(link) === "v2"), "explicit all-version scope finds v2 from v1");
    assert.ok((await page.locator(".VersionSearch-tag").allTextContents()).every((label) => ["v1", "v2", "Common"].includes(label)), "every result labels its version");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".VersionSearch"));
    assert.ok(await page.locator(".VPNavBarSearch button").evaluate((button) => document.activeElement === button), "closing search returns focus to its trigger");
    await page.setViewportSize({ width: 320, height: 900 });
    await visit("/");
    await checkDisclosure(page, ".VPNavBarHamburger");
    assert.equal(await page.locator(".VPLocalNav button.menu").count(), 0, "home has no version-specific sidebar");
    await visit("/v2/");
    await checkDisclosure(page, ".VPLocalNav button.menu");
    await visit("/start/");
    await checkDisclosure(page, ".VPLocalNav button.menu");
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await visit("/");
      assert.equal(await page.locator(".VPSidebar").isVisible(), false, "homepage explains Takoform without a version-specific sidebar");
      assert.equal(await page.locator("html").evaluate((element) => element.classList.contains("dark")), colorScheme === "dark");
      assert.deepEqual(await page.evaluate(inspectGeometry), [], `1280px ${colorScheme}`);
      assert.equal(await page.locator(".home-index").count(), 0, "home is not a version list");
      assert.deepEqual(await page.locator(".home-page h2").allTextContents(), [
        "Forms, Hosts and clients", "A resource, from request to result", "Using and implementing Takoform",
      ]);
      assert.equal(await page.locator(".home-roles dt").count(), 3);
      assert.equal(await page.locator(".home-steps li").count(), 4);
      const exampleRequest = readFileSync(join(root, "website/start/index.md"), "utf8")
        .match(/^POST .+ HTTP\/1\.1$/mu)?.[0];
      assert.ok(exampleRequest, "the getting-started guide includes a create request");
      assert.ok((await page.locator(".home-example pre").textContent()).includes(exampleRequest), "home uses the guide's illustrative create request");
      const primary = page.locator('.version-context select');
      const bounds = await primary.boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 800, `${colorScheme}: API selection must fit first viewport`);
      await page.keyboard.press("Tab");
      await primary.focus();
      assert.ok(await primary.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      }), `${colorScheme}: API selection must have a keyboard focus indicator`);
      await page.screenshot({ path: `/tmp/takoform-docs-home-${colorScheme}.png`, fullPage: true });
      await visit("/spec/host-api/v1");
      await page.locator(".VPNavBarSearch button").click();
      await page.locator(".VersionSearch input").fill("Snapshot");
      await page.locator(".VersionSearch-results a").first().waitFor();
      assert.deepEqual(await page.evaluate(inspectGeometry), [], `${colorScheme}: search geometry`);
      await page.screenshot({ path: `/tmp/takoform-docs-search-${colorScheme}.png`, fullPage: true });
      await page.keyboard.press("Escape");
    }
    assert.deepEqual(networkFailures, [], "browser runtime and asset requests");
    console.log(`site-browser: ${widths.length * routes.length} responsive pages, English canonical search, legacy URL redirects, version-specific sidebars, keyboard disclosures and themes passed (${browser.version()})`);
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
