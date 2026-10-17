import assert from "node:assert/strict";
import { accessSync, constants, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { documentVersion } from "../website/.vitepress/versions.mjs";
import {
  deriveSchemas, inspectDist, inspectSite, SITE_DIST, HAND_AUTHORED_PAGE_SOURCES,
  GENERATED_INDEX_PAGES, MIRRORED_SPEC_DOCUMENTS,
  siteRouteForPageSource, siteRouteForSpecDocument,
} from "./site.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const v2Routes = ["/v2/", "/spec/host-api/v2/", "/spec/host-api/v2/http", "/spec/host-api/v2/forms", "/spec/host-api/v2/examples", "/spec/host-api/v2/migration"];
const routes = ["/", "/v1/", "/spec/host-api/v1", "/schemas/", "/site", "/start/", "/model/", "/client/", "/authoring/", "/use/", "/host-api/", "/guides/", "/glossary", "/404.html", ...v2Routes];
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
      // Like the Pages host, answer unknown paths with the built not-found page.
      const notFound = files.get("/404.html");
      response.writeHead(404, notFound ? { "Content-Type": types[".html"] } : {});
      response.end(request.method === "HEAD" ? undefined : notFound);
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(target)] ?? "application/octet-stream" });
    response.end(request.method === "HEAD" ? undefined : files.get(target));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// WCAG 2 contrast ratio for two opaque rgb()/rgba() computed colours.
function contrastRatio(foreground, background) {
  const luminance = (color) => {
    const [r, g, b] = color.match(/[\d.]+/gu).slice(0, 3).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
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
    // WCAG 1.4.10 exempts data tables from reflow. A control scrolled out of
    // view inside a table that scrolls sideways is reachable as long as the
    // table itself fits; unreachableTableControls checks that separately.
    const table = element.closest(".vp-doc table");
    if (table && table.scrollWidth > table.clientWidth + 1) {
      const box = table.getBoundingClientRect();
      if (box.left >= -1 && box.right <= documentWidth + 1) continue;
    }
    if (rectangle.left < -1 || rectangle.right > documentWidth + 1) {
      issues.push(`clipped control: ${element.textContent.trim().slice(0, 70) || element.getAttribute("aria-label") || element.tagName}`);
    }
  }
  return issues;
}

// A table that scrolls sideways must take keyboard focus (VitePress renders
// tabindex="0") and contain no control wider than its visible width, so
// scrolling the table alone brings every control into view.
function unreachableTableControls() {
  const problems = [];
  document.querySelectorAll(".vp-doc table").forEach((table, index) => {
    if (table.scrollWidth <= table.clientWidth + 1) return;
    const name = `table ${index + 1}`;
    if (!["auto", "scroll"].includes(getComputedStyle(table).overflowX)) problems.push(`${name} does not scroll`);
    if (table.tabIndex !== 0) problems.push(`${name} cannot take keyboard focus`);
    for (const control of table.querySelectorAll("a[href], button, input, select, summary"))
      if (control.getBoundingClientRect().width > table.clientWidth + 1) problems.push(`${name}: ${control.textContent.trim().slice(0, 70)}`);
  });
  return problems;
}

// Code that wraps inside a word, such as "valu|e". A break is allowed at a
// <wbr> hint (a text-node boundary), at a space, and inside a
// table-break-anywhere piece (over 20 characters or a hex digest piece).
function midWordCode(selector) {
  const alnum = /[A-Za-z0-9]/u;
  const broken = [];
  for (const code of document.querySelectorAll(selector)) {
    if (code.getClientRects().length < 2) continue;
    const chars = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      for (let offset = 0; offset < node.length; offset++) chars.push([node, offset]);
    let previous = null;
    for (const [index, [node, offset]] of chars.entries()) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const top = Math.round(range.getBoundingClientRect().top);
      const [before, beforeOffset] = chars[index - 1] ?? [];
      if (previous !== null && top > previous + 2 && before === node &&
        alnum.test(node.data[beforeOffset]) && alnum.test(node.data[offset])) {
        if (!node.parentElement.classList.contains("table-break-anywhere")) broken.push(code.textContent);
      }
      previous = top;
    }
  }
  return [...new Set(broken)];
}

// Table code that wraps between the words of a camelCase name, which only a
// phone allows (breakTableCode in config.mts).
function camelCaseBreaks() {
  const breaks = [];
  for (const mark of document.querySelectorAll(".vp-doc .takoform-camel")) {
    const [before, after] = [mark.previousSibling, mark.nextSibling];
    if (before?.nodeType !== Node.TEXT_NODE || after?.nodeType !== Node.TEXT_NODE) continue;
    const top = (node, offset) => {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      return range.getBoundingClientRect().top;
    };
    if (top(after, 0) > top(before, before.length - 1) + 2) breaks.push(mark.parentElement.textContent);
  }
  return breaks;
}

// Code blocks other than plain text, and the home page example, wrap long
// lines instead of scrolling and so take no tab stop. Each line's first character sits at its indentation
// column (a tab advances to the next multiple of four); a wrapped continuation
// starts right of it, so it reads as part of that line; and a row may end
// inside a word only when that run of letters and digits is 16 or longer.
// Plain-text blocks, which hold diagrams, do not wrap.
function codeWrapProblems() {
  const problems = [];
  const alnum = /[A-Za-z0-9]/u;
  const charRect = (node, offset) => {
    const range = document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, offset + 1);
    return range.getBoundingClientRect();
  };
  for (const pre of document.querySelectorAll('.vp-doc div[class*="language-"] > pre, .home-example pre')) {
    const name = pre.textContent.trim().split("\n")[0].slice(0, 60);
    if (!pre.classList.contains("takoform-wrap")) {
      if (getComputedStyle(pre).whiteSpace !== "pre") problems.push(`plain text wraps: ${name}`);
      continue;
    }
    if (pre.scrollWidth > pre.clientWidth + 1) problems.push(`code scrolls sideways: ${name}`);
    if (pre.hasAttribute("tabindex")) problems.push(`code that cannot scroll takes a tab stop: ${name}`);
    const code = pre.querySelector("code");
    const probe = code.appendChild(document.createElement("span"));
    probe.textContent = "0".repeat(10);
    const column = probe.getBoundingClientRect().width / 10;
    probe.remove();
    const origin = code.getBoundingClientRect().left + parseFloat(getComputedStyle(code).paddingLeft);
    const lineHeight = parseFloat(getComputedStyle(code).lineHeight);
    for (const line of pre.querySelectorAll(".line")) {
      const chars = [];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (let offset = 0; offset < node.length; offset++) chars.push([node, offset]);
      const visible = chars.filter(([node, offset]) => !/[ \t]/u.test(node.data[offset]));
      if (!visible.length) continue;
      const text = line.textContent.trim().slice(0, 60);
      const indent = [...line.textContent.match(/^[ \t]*/u)[0]]
        .reduce((total, character) => character === "\t" ? total + 4 - total % 4 : total + 1, 0);
      const first = charRect(...visible[0]);
      if (Math.abs(first.left - origin - indent * column) > 1) problems.push(`indentation shifted: ${text}`);
      if (line.getBoundingClientRect().height < lineHeight * 1.5) continue;
      const rects = chars.map((char) => charRect(...char));
      const continuation = rects.filter((rect, index) => rect.top > first.top + lineHeight / 2 && visible.includes(chars[index]));
      if (Math.min(...continuation.map((rect) => rect.left)) < first.left + column * 1.5) problems.push(`continuation not indented: ${text}`);
      for (const [index, [node, offset]] of chars.entries()) {
        if (index === 0 || rects[index].top <= rects[index - 1].top + lineHeight / 2 || chars[index - 1][0] !== node) continue;
        if (!alnum.test(node.data[offset - 1]) || !alnum.test(node.data[offset])) continue;
        const run = node.data.slice(0, offset).match(/[A-Za-z0-9]*$/u)[0] + node.data.slice(offset).match(/^[A-Za-z0-9]*/u)[0];
        if (run.length < 16) problems.push(`breaks inside "${run}": ${text}`);
      }
    }
  }
  return problems;
}

// Header controls whose boxes overlap, where a click near an edge could reach
// the wrong one.
function overlappingHeaderControls() {
  const controls = [...document.querySelectorAll(".VPNavBar :is(a, button, select)")]
    .filter((control) => control.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && control.getBoundingClientRect().width > 0);
  const overlaps = [];
  for (const [index, first] of controls.entries()) for (const second of controls.slice(index + 1)) {
    const [a, b] = [first.getBoundingClientRect(), second.getBoundingClientRect()];
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
      const name = (control) => (control.getAttribute("aria-label") || control.textContent.trim() || control.getAttribute("title") || "").slice(0, 30);
      overlaps.push(`${name(first)} / ${name(second)}`);
    }
  }
  return overlaps;
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

// The name and description Chrome exposes to assistive technology.
async function accessibleText(page, selector) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    const { nodes: [node] } = await session.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
    return { name: node.name?.value ?? "", description: node.description?.value ?? "" };
  } finally {
    await session.detach();
  }
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
    const expectedNotFound = new Set();
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
    // Vue reports a hydration mismatch only on the console. Failed loads are
    // console errors too, but the response listener below judges those.
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) networkFailures.push(`console: ${message.text()}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !(response.status() === 404 && expectedNotFound.has(new URL(response.url()).pathname))) {
        networkFailures.push(`${response.status()}: ${response.url()}`);
      }
    });
    page.on("requestfailed", (request) => networkFailures.push(`failed request: ${request.url()}`));
    const visit = async (route) => {
      await page.goto(origin + route, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const visibleText = await page.locator("body").innerText();
      assert.doesNotMatch(visibleText, /[\u3040-\u30ff\u3400-\u9fff]/u, `${route}: visible page content is English`);
      const accessibleNames = await page.locator("[aria-label], [title], [alt], [placeholder]").evaluateAll((elements) => elements.flatMap(
        (element) => ["aria-label", "title", "alt", "placeholder"].map((name) => element.getAttribute(name) ?? ""),
      ));
      assert.deepEqual(accessibleNames.filter((name) => /[\u3040-\u30ff\u3400-\u9fff]|\{#[^}]*\}|`/u.test(name)), [], `${route}: accessible names are English without Markdown syntax`);
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
        assert.deepEqual(await page.evaluate(midWordCode, ".vp-doc :is(td, th) code"), [], `${width}px ${route}: table identifiers stay whole`);
        assert.deepEqual(await page.evaluate(unreachableTableControls), [], `${width}px ${route}: scrolling tables are keyboard-reachable`);
        if (route === "/") {
          const start = await page.locator('.home-actions a[href="/start/"]').boundingBox();
          assert.ok(start && start.y + start.height <= 900, `${width}px: the walkthrough link is in the first viewport`);
          assert.equal(await page.locator(".home-example pre.takoform-wrap").count(), 3, `${width}px: the home example wraps like other code`);
        }
        if (width === 375 && ["/", "/spec/host-api/v2/http"].includes(route)) {
          const name = route === "/" ? "home-en" : "http-v2";
          await page.screenshot({ path: `/tmp/takoform-docs-${name}-375.png`, fullPage: true });
        }
      }
      await visit("/spec/host-api/v1");
    }
    // Table code on every built page: words stay whole on phones and on desktop.
    // From 414px, a large phone, no table may scroll; tables that scroll on
    // narrower phones stay reachable. A table that stops fitting is fixed with
    // a break hint or presentation in breakTableCode, never by rewording
    // fixed normative text.
    for (const width of [320, 375, 414, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of [...new Set([...routes, ...sidebarRoutes])]) {
        await visit(route);
        assert.deepEqual(await page.evaluate(midWordCode, ".vp-doc :is(td, th) code"), [], `${width}px ${route}: table identifiers stay whole`);
        assert.deepEqual(await page.evaluate(unreachableTableControls), [], `${width}px ${route}: scrolling tables are keyboard-reachable`);
        assert.deepEqual(await page.evaluate(codeWrapProblems), [], `${width}px ${route}: long code lines wrap under their own line`);
        if (width === 1280) assert.deepEqual(await page.evaluate(camelCaseBreaks), [], `1280px ${route}: table identifiers stay whole on desktop`);
        if (width >= 414) assert.deepEqual(await page.locator(".vp-doc table").evaluateAll((tables) => tables
          .filter((table) => table.scrollWidth > table.clientWidth + 1)
          .map((table) => `${[...table.rows[0].cells].map((cell) => cell.textContent.trim()).join(" | ")}: ${table.scrollWidth - table.clientWidth}px`)),
        [], `${width}px ${route}: tables fit without scrolling`);
      }
      // The schema index lists each identity's $id and digest as code that
      // wraps only at its hints; on desktop each takes at most two lines.
      await visit("/schemas/");
      const values = page.locator(".vp-doc li > code");
      assert.equal(await values.count(), 2 * deriveSchemas(root).identities.length, `${width}px /schemas/: one $id and one digest per identity`);
      assert.deepEqual(await page.evaluate(midWordCode, ".vp-doc li code"), [], `${width}px /schemas/: identities and digests stay whole`);
      if (width === 1280) assert.deepEqual(await values.evaluateAll((codes) =>
        codes.filter((code) => code.getClientRects().length > 2).map((code) => code.textContent)), [], "1280px /schemas/: each $id and digest fits two lines");
    }
    for (const width of [320, 375, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/", "/v2/"]) {
        await visit(path);
        assert.deepEqual(await page.evaluate(overlappingHeaderControls), [], `${width}px ${path}: header controls do not overlap`);
      }
      if (width >= 768 && width < 1280) {
        // The open ••• menu stays clear of the API version selector.
        await page.locator('.VPNavBarExtra button[aria-label="extra navigation"]').hover();
        const menu = page.locator(".VPNavBarExtra .menu");
        await menu.waitFor({ state: "visible" });
        const [panel, select] = [await menu.boundingBox(), await page.locator(".version-context select").boundingBox()];
        assert.ok(panel.x + panel.width <= select.x + 1 || panel.y >= select.y + select.height - 1,
          `${width}px: the open ••• menu does not cover the API version selector`);
        await page.mouse.move(0, 400);
      }
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
    const marks = await results.first().locator(".VersionSearch-excerpt mark").allInnerTexts();
    assert.ok(marks.length && marks.every((mark) => /^(?:takoform|expected|generation)/iu.test(mark)),
      `a search result shows where it matched, with the query's terms highlighted (got ${JSON.stringify(marks)})`);
    const links = await results.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
    assert.ok(links.length && links.every((link) => !link.startsWith("/en/")), "search results use root canonical routes");
    assert.ok(links.every((link) => documentVersion(link) !== "v1"), "v2 search must exclude v1 by default");
    await page.locator(".VersionSearch input").fill("entryExists");
    await results.first().waitFor();
    const entryExcerpts = await page.locator(".VersionSearch-excerpt").evaluateAll((nodes) => nodes.map((node) => node.textContent));
    assert.ok(entryExcerpts.some((excerpt) => excerpt.includes('Confirmed presence is { "entryExists": true')) &&
      !entryExcerpts.some((excerpt) => /&(?:[a-z]+|#x?[\da-f]+);/iu.test(excerpt)), "search excerpts show escaped page text decoded");
    await page.locator(".VersionSearch input").fill("replay window");
    await results.first().waitFor();
    const phrase = await page.locator(".VersionSearch-results li").evaluateAll((options) => options.findIndex((option) =>
      /\breplay window\b/iu.test(option.querySelector(".VersionSearch-excerpt")?.textContent ?? "")));
    assert.ok(phrase >= 0, "a search excerpt shows the query's two adjacent words");
    const option = await accessibleText(page, `#version-search-result-${phrase}`);
    const shown = await page.locator(`#version-search-result-${phrase} a > :not(.VersionSearch-excerpt)`).allTextContents();
    assert.equal(option.name, shown.join(" ").replace(/\s+/gu, " ").trim(), "a search option is named by its title, version and heading path");
    assert.match(option.description, /\breplay window\b/iu, "the excerpt describes the option with highlighted words kept apart");
    // Near the end of a section the first match must still fit the two lines a phone shows.
    await page.locator(".VersionSearch input").fill("retainUntil");
    await results.first().waitFor();
    assert.deepEqual(await page.locator(".VersionSearch-results li").evaluateAll((options) => options.flatMap((option) => {
      const excerpt = option.querySelector(".VersionSearch-excerpt")?.getBoundingClientRect();
      const mark = option.querySelector(".VersionSearch-excerpt mark")?.getBoundingClientRect();
      return excerpt && mark && mark.bottom > excerpt.bottom + 1 ? [option.querySelector("a").getAttribute("href")] : [];
    })), [], "375px: each search result's first highlight shows within its excerpt");
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
    const status = page.locator(".VersionSearch-status");
    await page.locator(".VersionSearch input").fill("zzzqqq");
    await page.locator(".VersionSearch-message").filter({ hasText: "No results. Try a shorter or different term." }).waitFor();
    assert.equal(await status.textContent(), "No results. Try a shorter or different term.", "the persistent status region announces the empty state");
    assert.equal(await page.locator(".VersionSearch-widen").count(), 0, "the all-version empty state does not offer all versions again");
    await page.locator(".VersionSearch input").fill("Host");
    await page.locator(".VersionSearch-count").filter({ hasText: /^Top 16 results$/u }).waitFor();
    assert.equal(await status.textContent(), "Top 16 results", "the same status region announces the result count");
    // A misspelled short word finds nothing exactly, so search retries with
    // typos allowed and says the results are for similar spellings.
    await page.locator(".VersionSearch input").fill("hoat");
    await page.locator(".VersionSearch-count").filter({ hasText: /for similar spellings$/u }).waitFor();
    assert.match(await status.textContent(), /results? for similar spellings$/u, "a misspelled short word still finds close matches, labelled as such");
    // An error code copied from a response leads to a section that names it.
    await page.locator(".VersionSearch input").fill("unsupported_form");
    await page.locator(".VersionSearch-count").filter({ hasNotText: /similar spellings/u }).waitFor();
    assert.match(await results.first().textContent(), /unsupported_form/u, "an error code search starts with a section that contains the code");
    assert.ok(await page.locator(".VersionSearch-results").evaluate((list) => list.scrollWidth <= list.clientWidth), "375px search results do not scroll sideways");
    await page.locator(".VersionSearch input").fill("zzzqqq");
    await page.locator("#version-search-scope").selectOption("v1");
    await page.locator(".VersionSearch-message").filter({ hasText: "No results in v1 + common." }).waitFor();
    await page.locator(".VersionSearch-widen").click();
    assert.equal(await page.locator("#version-search-scope").inputValue(), "all", "the empty state widens the search to all versions");
    assert.ok(await page.locator(".VersionSearch input").evaluate((input) => document.activeElement === input), "widening the search returns focus to the query");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".VersionSearch"));
    assert.ok(await page.locator(".VPNavBarSearch button").evaluate((button) => document.activeElement === button), "closing search returns focus to its trigger");
    // The live widget hides itself when it has nothing to show; the placement must not leave a blank box.
    const placement = page.locator(".adring-placement");
    assert.ok(await placement.isVisible(), "the ad placement keeps its space before the widget reports a state");
    await placement.evaluate((element) => {
      const widget = document.createElement("div");
      widget.dataset.adringWidget = "card";
      widget.dataset.adringState = "loading";
      element.firstElementChild.append(widget);
    });
    const placementShown = () => placement.evaluate((element) => getComputedStyle(element).display !== "none");
    assert.equal(await placementShown(), true, "a loading ad placement keeps its space");
    for (const [state, shown] of [["empty", false], ["error", false], ["ready", true]]) {
      await placement.evaluate((element, value) => { element.querySelector("[data-adring-widget]").dataset.adringState = value; }, state);
      assert.equal(await placementShown(), shown, `an ad placement in state ${state} is ${shown ? "shown" : "collapsed"}`);
    }
    const blocked = await context.newPage();
    await blocked.route("https://ar-cdn.net/**", (route) => route.abort());
    await blocked.goto(`${origin}/start/`, { waitUntil: "networkidle" });
    await blocked.locator(".adring-placement[hidden]").waitFor({ state: "attached" });
    assert.equal(await blocked.locator(".adring-placement").evaluate((element) => getComputedStyle(element).display), "none", "a blocked ad script releases its space");
    await blocked.close();
    await visit("/404.html");
    assert.deepEqual(await page.locator(".not-found a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), [
      "/", "/start/", "/v2/", "/v1/",
    ], "the not-found page links to the overview, the walkthrough and both versions");
    // A missing page under a versioned prefix belongs to no version.
    const missing = "/spec/host-api/v1/missing";
    expectedNotFound.add(missing);
    assert.equal((await page.goto(origin + missing, { waitUntil: "networkidle" }))?.status(), 404, "unknown paths answer 404");
    await page.locator(".not-found h1").filter({ hasText: "Page not found" }).waitFor();
    assert.equal(await page.locator(".version-context select").inputValue(), "shared", "a missing /spec/ page does not claim a version");
    await page.locator(".not-found__search").click();
    await page.locator(".VersionSearch input").waitFor();
    assert.ok(await page.locator(".VersionSearch input").evaluate((input) => document.activeElement === input), "the not-found page opens search");
    assert.equal(await page.locator("#version-search-scope").inputValue(), "all", "search from a missing page covers all versions");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".VersionSearch"));
    assert.ok(await page.locator(".not-found__search").evaluate((button) => document.activeElement === button), "closing search returns focus to the not-found page");
    await page.locator(".version-context select").selectOption("v1");
    await page.waitForURL((url) => url.pathname === "/v1/", { timeout: 10000 });
    await visit("/spec/host-api/v2/examples");
    assert.match(await page.locator(".mirror-notice").innerText(), /^Explanatory source \(English original\): .+ — not a specification requirement\.$/u,
      "explanatory pages say they are not specification requirements");
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
      assert.deepEqual(await page.locator(".home-steps h3 a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))), [
        "/start/#discover-support", "/start/#create-read", "/start/#create-read", "/start/#update",
      ], "each lifecycle step opens its walkthrough section");
      assert.deepEqual(await page.locator(".home-example .line").evaluateAll((lines) => lines
        .filter((line) => line.getBoundingClientRect().height > parseFloat(getComputedStyle(line).lineHeight) * 1.5)
        .map((line) => line.textContent)), [], "on desktop no line of the create request, its response or the Resource wraps");
      const exampleRequest = readFileSync(join(root, "website/start/index.md"), "utf8")
        .match(/^POST .+ HTTP\/1\.1$/mu)?.[0];
      assert.ok(exampleRequest, "the getting-started guide includes a create request");
      assert.ok((await page.locator(".home-example pre").first().textContent()).includes(exampleRequest), "home uses the guide's illustrative create request");
      assert.match(await page.locator(".home-example pre").nth(1).textContent(), /^HTTP\/1\.1 202 Accepted\n/u, "home shows the accepted Operation the request returns");
      assert.match(await page.locator(".home-example pre").nth(2).textContent(), /^GET \S+\/resources\/r_1 HTTP\/1\.1\n\nHTTP\/1\.1 200 OK\n[\s\S]*"observedGeneration": 1,/u,
        "home ends at the Resource the Operation produced");
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
      await visit("/start/");
      const labelContrast = contrastRatio(...await page.locator(".vp-doc div[class*='language-'] > span.lang").first().evaluate(
        (label) => [getComputedStyle(label).color, getComputedStyle(label.parentElement).backgroundColor],
      ));
      assert.ok(labelContrast >= 4.5, `${colorScheme}: code block language labels meet 4.5:1 (got ${labelContrast.toFixed(2)})`);
      await visit("/host-api/");
      assert.ok(await page.locator("#run-check ~ div[class*='language-js'] pre").first().evaluate((pre) => pre.scrollWidth <= pre.clientWidth),
        `${colorScheme}: the Host check script fits without horizontal scrolling on desktop`);
      await visit("/client/");
      const clientBlocks = await page.locator("#loop ~ div[class*='language-js'] pre").evaluateAll((blocks) => blocks.map((pre) => pre.scrollWidth <= pre.clientWidth));
      assert.ok(clientBlocks.length === 3 && clientBlocks.every(Boolean),
        `${colorScheme}: the client loop, its usage, and its update/delete intents fit without horizontal scrolling on desktop`);
      for (const path of ["/spec/host-api/v1", "/spec/host-api/v2/http"]) {
        await visit(path);
        assert.ok(await page.locator(".mirror-notice a").evaluate((link) => {
          const style = getComputedStyle(link);
          return style.textDecorationLine.includes("underline") && style.color !== getComputedStyle(link.closest("p")).color;
        }), `${colorScheme} ${path}: the normative source link looks like a link`);
      }
      await visit("/spec/host-api/v1");
      await page.locator(".VPNavBarSearch button").click();
      const placeholderContrast = contrastRatio(...await page.locator(".VersionSearch input").evaluate(
        (input) => [getComputedStyle(input, "::placeholder").color, getComputedStyle(input.closest("dialog")).backgroundColor],
      ));
      assert.ok(placeholderContrast >= 4.5, `${colorScheme}: the search placeholder meets 4.5:1 (got ${placeholderContrast.toFixed(2)})`);
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
