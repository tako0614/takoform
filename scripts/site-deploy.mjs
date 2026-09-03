#!/usr/bin/env bun

// The `takoform-site` deploy surface: static bytes to a Pages project.
//
// Presentation-only changes remain ordinary static publication, but this
// surface also carries exact schema bytes that consumers address by immutable
// $id. Its first Pages cutover makes seventeen ledgered identities reachable
// for the first time and makes the predecessor Worker an invalid rollback
// target. That one transition is explicit, preflighted, and forward-only.
//
// Two things here are deliberately stricter than the lane requires. Production
// takes only clean `main` that equals a credential-free read of the public
// ref, because "which commit is on takoform.com" has to have an answer. And
// the readback compares digests rather than status codes, because the previous
// site served HTTP 200 from an alias that pointed at an older deployment for
// long enough that nobody noticed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_RELEASE } from "./core-release.mjs";
import {
  SCHEMA_IDENTITY_ORIGIN,
  SCHEMA_LEDGER_PATH,
  SITE_DIST,
  distDigest,
  inspectDist,
} from "./site.mjs";

export const SITE_SURFACE = "takoform-site";
export const API_CUTOVER_SURFACE = "takoform-api-v1-cutover";
export const SITE_PROJECT = "takoform-site";
export const SITE_PUBLIC_ORIGIN = "https://takoform.com";
export const SITE_WWW_ORIGIN = "https://www.takoform.com";
export const SITE_PREVIEW_HOST = `${SITE_PROJECT}.pages.dev`;
export const SITE_PAGES_ORIGIN = `https://${SITE_PREVIEW_HOST}`;
export const SCHEMA_PUBLIC_ORIGIN = SCHEMA_IDENTITY_ORIGIN;
export const SITE_PUBLIC_ORIGINS = Object.freeze([
  SITE_PUBLIC_ORIGIN,
  SITE_WWW_ORIGIN,
  SCHEMA_PUBLIC_ORIGIN,
]);
export const SITE_PUBLIC_HOSTNAMES = Object.freeze(
  SITE_PUBLIC_ORIGINS.map((origin) => new URL(origin).hostname),
);
export const DOMAIN_STATE_RESIDUAL =
  "Wrangler pages project list --json exposes configured custom domains but not per-domain active or certificate-validation state; HTTPS byte readbacks are the active serving evidence, while provider-side activation remains an operator readback residual";
export const SITE_ENVIRONMENTS = Object.freeze(["integration", "rehearsal", "production"]);
export const PRODUCTION_BRANCH = "main";
export const DEFAULT_PREVIEW_BRANCH = "preview";
export const WRANGLER_PROJECT_LIST_ARGS = Object.freeze([
  "pages",
  "project",
  "list",
  "--json",
]);
export const WRANGLER_PRODUCTION_DEPLOYMENT_LIST_ARGS = Object.freeze([
  "pages",
  "deployment",
  "list",
  "--project-name",
  SITE_PROJECT,
  "--environment",
  "production",
  "--json",
]);

// Read back more than one page. Schema routes are loaded from the append-only
// ledger below; a hand-maintained sample cannot prove a publication.
export const PAGE_READBACK_ROUTES = Object.freeze([
  "/",
  "/sitemap.xml",
]);
// Kept as an import-compatible name for callers that used the original page
// sample. It deliberately contains no schema routes now.
export const READBACK_ROUTES = PAGE_READBACK_ROUTES;
export const ABSENT_ROUTES = Object.freeze([
  "/.well-known/takoform-site.json",
  "/forms/",
  "/release/",
  "/proposals/",
  "/docs/resources/actor_namespace.html",
  "/spec/decisions/0052-the-specification-is-released-on-its-own-line.html",
  "/docs/versions.html",
  "/spec/publication-freeze",
  "/spec/host-api/v1beta1",
  "/spec/host-api/v1beta4",
  "/spec/trust/0001-provider-runner-report-v2",
  "/spec/project-lifecycle",
  "/spec/project-lifecycle/",
  "/releases/",
  "/decisions/",
]);

// Read-only live audit on 2026-09-03: the predecessor Worker served the other
// 31 ledger identities byte-for-byte and returned an unredirected HTTP 404 for
// exactly these 17. The initial cutover refuses if either side changes.
export const INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES = Object.freeze([
  "/schemas/v1/form-package-revocation-checkpoint.schema.json",
  "/schemas/v1/form-package-revocation.schema.json",
  "/schemas/host-discovery.schema.json",
  "/schemas/v1alpha1/form-definition.schema.json",
  "/schemas/v1alpha1/form-ref.schema.json",
  "/schemas/v1alpha1/host-api-wire.schema.json",
  "/schemas/v1alpha1/package-index.schema.json",
  "/schemas/v1alpha2/form-definition.schema.json",
  "/schemas/v1alpha2/form-ref.schema.json",
  "/schemas/v1alpha2/host-api-wire.schema.json",
  "/schemas/v1alpha2/host-discovery.schema.json",
  "/schemas/v1alpha2/package-index.schema.json",
  "/schemas/v1alpha3/form-definition.schema.json",
  "/schemas/v1alpha3/form-ref.schema.json",
  "/schemas/v1alpha3/host-api-wire.schema.json",
  "/schemas/v1alpha3/host-discovery.schema.json",
  "/schemas/v1alpha3/package-index.schema.json",
]);
export const INITIAL_CUTOVER_PREDECESSOR = Object.freeze({
  provider: "cloudflare-worker",
  name: "takoform-website",
  version: "1e4871b5-e4b3-4c30-8bb9-78592b5ce49e",
  deployment: "9eae618a-4144-4115-abe4-3a50dae795af",
  source: "f71d4be4caf5a5e0c4fc97bfadeb6ebb627d1928",
});

export const USAGE = [
  `usage: bun run deploy -- ${SITE_SURFACE} --status`,
  `       bun run deploy -- ${SITE_SURFACE} --apply --environment <${SITE_ENVIRONMENTS.join("|")}> [--branch <name>] [--execute]`,
  `usage: bun run deploy -- ${API_CUTOVER_SURFACE} --status`,
  `       bun run deploy -- ${API_CUTOVER_SURFACE} --apply --environment production --review <non-secret-reference> [--execute]`,
  `       bun run deploy -- ${API_CUTOVER_SURFACE} --verify-cutover --deployment-url <exact-immutable-url>`,
].join("\n");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function text(value) {
  if (value === undefined || value === null) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

export function parseSiteDeployArgs(
  args,
  { allowCutover = true, forceInitialCutover = false } = {},
) {
  const rest = [...args];
  if (rest.length === 1 && rest[0] === "--status") {
    return Object.freeze({ mode: "status" });
  }
  if (rest[0] === "--verify-cutover") {
    if (!allowCutover) {
      throw new Error(
        `--verify-cutover belongs to ${API_CUTOVER_SURFACE}; routine ${SITE_SURFACE} publishes presentation only`,
      );
    }
    if (rest.length !== 3 || rest[1] !== "--deployment-url") throw new Error(USAGE);
    return Object.freeze({
      mode: "verify-cutover",
      deploymentUrl: requireImmutableDeploymentUrl(rest[2]),
    });
  }
  if (rest[0] !== "--apply") throw new Error(USAGE);
  rest.shift();

  let environment;
  let branch;
  let execute = false;
  let initialCutover = false;
  let review = null;
  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === "--execute") {
      execute = true;
    } else if (flag === "--initial-cutover") {
      if (!allowCutover) {
        throw new Error(
          `--initial-cutover belongs to ${API_CUTOVER_SURFACE}; routine ${SITE_SURFACE} publishes presentation only`,
        );
      }
      initialCutover = true;
    } else if (flag === "--environment" || flag === "--branch" || flag === "--review") {
      const value = rest.shift();
      if (value === undefined || value.startsWith("--")) throw new Error(USAGE);
      if (flag === "--environment") environment = value;
      else if (flag === "--branch") branch = value;
      else review = requireReviewReference(value);
    } else {
      throw new Error(USAGE);
    }
  }

  if (forceInitialCutover) initialCutover = true;

  if (environment === undefined) {
    throw new Error(
      `an exact environment is required before any mutation: --environment <${SITE_ENVIRONMENTS.join("|")}>`,
    );
  }
  if (!SITE_ENVIRONMENTS.includes(environment)) {
    throw new Error(`unknown environment ${environment}; expected one of ${SITE_ENVIRONMENTS.join(", ")}`);
  }
  if (initialCutover && environment !== "production") {
    throw new Error("--initial-cutover is production-only");
  }
  if (review !== null && !initialCutover) {
    throw new Error("--review is accepted only as evidence for --initial-cutover");
  }
  if (initialCutover && execute && review === null) {
    throw new Error(
      "--initial-cutover --execute requires --review <non-secret-reference>; review evidence is recorded but does not authorize deployment",
    );
  }
  if (environment === "production") {
    if (branch !== undefined && branch !== PRODUCTION_BRANCH) {
      throw new Error(
        `production publishes the ${PRODUCTION_BRANCH} branch of the Pages project and takes no --branch override`,
      );
    }
    branch = PRODUCTION_BRANCH;
  } else if (branch === undefined) {
    branch = DEFAULT_PREVIEW_BRANCH;
  } else if (branch === PRODUCTION_BRANCH) {
    throw new Error(
      `${environment} must not publish the ${PRODUCTION_BRANCH} branch; that branch is the production alias`,
    );
  }

  return Object.freeze({ mode: "apply", environment, branch, execute, initialCutover, review });
}

function requireReviewReference(value) {
  if (
    typeof value !== "string" ||
    !/^(?:audit|review|operator|agent)[_:][a-z0-9][a-z0-9._:-]{1,119}$/u.test(value)
  ) {
    throw new Error(
      "--review must be a non-secret evidence label beginning audit_, review_, operator_, agent_, or the same prefix followed by :; it is evidence only and never deployment authorization",
    );
  }
  return value;
}

function git(run, args, { root }) {
  const result = run("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${text(result?.stderr).trim()}`);
  }
  return text(result.stdout).trim();
}

/** A public ref read must not be able to succeed on an operator's credential. */
function publicGitEnvironment(env) {
  const clean = { ...env };
  for (const key of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GIT_ASKPASS",
    "GIT_CONFIG_PARAMETERS",
    "GIT_SSH_COMMAND",
    "GIT_SSH_VARIANT",
    "SSH_ASKPASS",
    "SSH_AUTH_SOCK",
  ]) {
    delete clean[key];
  }
  return {
    ...clean,
    GCM_INTERACTIVE: "never",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function readSourceState(run, { root, env }) {
  const head = git(run, ["rev-parse", "HEAD"], { root });
  const branch = git(run, ["rev-parse", "--abbrev-ref", "HEAD"], { root });
  const dirty = git(run, ["status", "--porcelain"], { root }) !== "";
  let publicMain = null;
  let publicMainError = null;
  const remote = run(
    "git",
    ["ls-remote", CORE_RELEASE.publicOrigin, "refs/heads/main"],
    { cwd: tmpdir(), encoding: "utf8", env: publicGitEnvironment(env) },
  );
  if (remote?.error || remote?.status !== 0) {
    publicMainError = text(remote?.stderr).trim() || "public ref read failed";
  } else {
    publicMain = text(remote.stdout).trim().split(/\s+/u)[0] ?? null;
  }
  return { head, branch, dirty, publicMain, publicMainError };
}

export function assertProductionSource(source) {
  if (source.dirty) {
    throw new Error("refused before touching the target: production publishes only a clean worktree");
  }
  if (source.branch !== PRODUCTION_BRANCH) {
    throw new Error(
      `refused before touching the target: production publishes only ${PRODUCTION_BRANCH}, found ${source.branch}`,
    );
  }
  if (source.publicMain === null) {
    throw new Error(
      `refused before touching the target: the public ${PRODUCTION_BRANCH} ref could not be read (${source.publicMainError})`,
    );
  }
  if (source.publicMain !== source.head) {
    throw new Error(
      `refused before touching the target: local HEAD ${source.head} is not the public ${PRODUCTION_BRANCH} ${source.publicMain}`,
    );
  }
}

function runScoped(run, root, script) {
  const result = run("bun", ["run", script], { cwd: root, stdio: "inherit" });
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    throw new Error(`refused before touching the target: bun run ${script} failed`);
  }
}

export function extractDeploymentUrl(stdout) {
  const deploymentHost = SITE_PREVIEW_HOST.replace(/\./gu, "\\.");
  const matches = [
    ...text(stdout).matchAll(
      new RegExp(
        `Deployment complete! Take a peek over at[^\\r\\n]*?(https://[a-z0-9-]+\\.${deploymentHost})`,
        "gu",
      ),
    ),
  ].map((match) => match[1]);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) {
    throw new Error(
      `the upload finished but printed ${unique.length} immutable deployment URLs; the target state is indeterminate, read the provider deployment history before acting`,
    );
  }
  return requireImmutableDeploymentUrl(unique[0]);
}

export function requireImmutableDeploymentUrl(value) {
  if (
    typeof value !== "string" ||
    !new RegExp(
      `^https://[a-z0-9][a-z0-9-]*\\.${SITE_PREVIEW_HOST.replace(/\./gu, "\\.")}$`,
      "u",
    ).test(value)
  ) {
    throw new Error(
      `--deployment-url must be one exact immutable deployment URL: https://<deployment>.${SITE_PREVIEW_HOST}`,
    );
  }
  return value;
}

function schemaRoute(entry) {
  let id;
  try {
    id = new URL(entry?.id);
  } catch {
    throw new Error(`${SCHEMA_LEDGER_PATH} contains a schema identity that is not a URL`);
  }
  if (
    id.origin !== SCHEMA_PUBLIC_ORIGIN ||
    id.search !== "" ||
    id.hash !== "" ||
    !id.pathname.startsWith("/schemas/") ||
    !id.pathname.endsWith(".json")
  ) {
    throw new Error(`${SCHEMA_LEDGER_PATH} contains an invalid public schema identity: ${entry.id}`);
  }
  if (entry.public !== `website/public${id.pathname}`) {
    throw new Error(`${SCHEMA_LEDGER_PATH} maps ${entry.id} to the wrong public path`);
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(entry.sha256 ?? "")) {
    throw new Error(`${SCHEMA_LEDGER_PATH} gives ${entry.id} an invalid sha256 digest`);
  }
  return id.pathname;
}

export function loadSchemaReadbackEntries(root) {
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(resolve(root, SCHEMA_LEDGER_PATH), "utf8"));
  } catch (error) {
    throw new Error(`could not read ${SCHEMA_LEDGER_PATH}`, { cause: error });
  }
  if (
    ledger?.kind !== "takoform.public-schema-identities@v1" ||
    !Array.isArray(ledger.identities) ||
    !Array.isArray(ledger.retired)
  ) {
    throw new Error(`${SCHEMA_LEDGER_PATH} does not contain the expected identity ledger`);
  }
  const entries = [
    ...ledger.identities.map((entry) => ({ ...entry, ledgerStatus: "current" })),
    ...ledger.retired.map((entry) => ({ ...entry, ledgerStatus: "retired" })),
  ].map((entry) => ({ ...entry, route: schemaRoute(entry) }));
  const routes = new Set(entries.map(({ route }) => route));
  const ids = new Set(entries.map(({ id }) => id));
  if (routes.size !== entries.length || ids.size !== entries.length) {
    throw new Error(`${SCHEMA_LEDGER_PATH} contains duplicate schema identities or routes`);
  }
  return entries;
}

function receiptSchemaEntry(entry) {
  return {
    id: entry.id,
    route: entry.route,
    sha256: entry.sha256,
    ledgerStatus: entry.ledgerStatus,
  };
}

function requireInitialCutoverPartition(entries) {
  const byRoute = new Map(entries.map((entry) => [entry.route, entry]));
  const absent = INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES.map((route) => byRoute.get(route));
  const expectedAbsent = new Set(INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES);
  const exact = entries.filter(({ route }) => !expectedAbsent.has(route));
  if (
    entries.length !== 48 ||
    exact.length !== 31 ||
    absent.length !== 17 ||
    absent.some((entry) => entry === undefined)
  ) {
    throw new Error(
      "initial cutover pre-mutation proof refused: the audited 31 exact / 17 absent schema partition changed",
    );
  }
  return {
    origin: SCHEMA_PUBLIC_ORIGIN,
    exact: exact.map(receiptSchemaEntry),
    absent: absent.map(receiptSchemaEntry),
  };
}

async function readbackDigests(fetchImpl, origin, routes, { redirect = "manual" } = {}) {
  const digests = {};
  for (const route of routes) {
    const response = await fetchImpl(`${origin}${route}`, {
      headers: { "cache-control": "no-cache" },
      redirect,
    });
    if (response.status !== 200) {
      throw new Error(`readback of ${origin}${route} returned HTTP ${response.status}`);
    }
    digests[route] = sha256(Buffer.from(await response.arrayBuffer()));
  }
  return digests;
}

async function requireAbsentRoutes(fetchImpl, origin, routes) {
  for (const route of routes) {
    const response = await fetchImpl(`${origin}${route}`, {
      headers: { "cache-control": "no-cache" },
      redirect: "manual",
    });
    if (response.status !== 404 && response.status !== 410) {
      throw new Error(
        `readback of retired route ${origin}${route} returned HTTP ${response.status}; the deployment still exposes a removed public surface`,
      );
    }
  }
}

function localDigests(root, routes) {
  const digests = {};
  for (const route of routes) {
    const fileRoute = route === "/" ? "/index.html" : route;
    digests[route] = sha256(readFileSync(resolve(root, `${SITE_DIST}${fileRoute}`)));
  }
  return digests;
}

function localSchemaDigests(root, entries) {
  const digests = localDigests(root, entries.map(({ route }) => route));
  const mismatched = entries.filter(({ route, sha256: expected }) => digests[route] !== expected);
  if (mismatched.length !== 0) {
    throw new Error(
      `refused before touching the target: the built schema bytes differ from ${SCHEMA_LEDGER_PATH} for ${mismatched.map(({ route }) => route).join(", ")}`,
    );
  }
  return digests;
}

function compareDigests(where, expected, actual) {
  const mismatched = Object.keys(expected).filter((route) => expected[route] !== actual[route]);
  if (mismatched.length !== 0) {
    throw new Error(
      `${where} serves different bytes than the proved build for ${mismatched.join(", ")}; the deployment is live and wrong, halt, read the provider deployment history, and repair forward before retrying`,
    );
  }
}

async function verifyExactRoutes(fetchImpl, origin, expected, where, options) {
  const actual = await readbackDigests(fetchImpl, origin, Object.keys(expected), options);
  compareDigests(where, expected, actual);
  return actual;
}

async function verifyFullDeployment(fetchImpl, origin, expected) {
  const pages = await verifyExactRoutes(
    fetchImpl,
    origin,
    expected.pages,
    `the deployment ${origin}`,
    { redirect: "manual" },
  );
  const schemas = await verifyExactRoutes(
    fetchImpl,
    origin,
    expected.schemas,
    `the deployment ${origin}`,
  );
  await requireAbsentRoutes(fetchImpl, origin, ABSENT_ROUTES);
  return { pages, schemas, absent: ABSENT_ROUTES };
}

async function verifyApex(fetchImpl, expectedPages) {
  const pages = await verifyExactRoutes(
    fetchImpl,
    SITE_PUBLIC_ORIGIN,
    expectedPages,
    `the public alias ${SITE_PUBLIC_ORIGIN}`,
    { redirect: "manual" },
  );
  await requireAbsentRoutes(fetchImpl, SITE_PUBLIC_ORIGIN, ABSENT_ROUTES);
  return { pages, absent: ABSENT_ROUTES };
}

async function verifyWww(fetchImpl, expectedPages) {
  const pages = await verifyExactRoutes(
    fetchImpl,
    SITE_WWW_ORIGIN,
    expectedPages,
    `the public alias ${SITE_WWW_ORIGIN}`,
    { redirect: "manual" },
  );
  await requireAbsentRoutes(fetchImpl, SITE_WWW_ORIGIN, ABSENT_ROUTES);
  return { pages, absent: ABSENT_ROUTES };
}

async function verifySchemaOrigin(fetchImpl, expectedSchemas) {
  const schemas = await verifyExactRoutes(
    fetchImpl,
    SCHEMA_PUBLIC_ORIGIN,
    expectedSchemas,
    `the schema identity origin ${SCHEMA_PUBLIC_ORIGIN}`,
  );
  return { schemas };
}

async function auditInitialCutoverPredecessor(fetchImpl, partition) {
  for (const entry of partition.exact) {
    const response = await fetchImpl(entry.id, {
      headers: { "cache-control": "no-cache" },
      redirect: "manual",
    });
    if (response.status !== 200) {
      throw new Error(
        `initial cutover pre-mutation proof failed: ${entry.id} was audited byte-exact but now returns HTTP ${response.status}`,
      );
    }
    const actual = sha256(Buffer.from(await response.arrayBuffer()));
    if (actual !== entry.sha256) {
      throw new Error(
        `initial cutover pre-mutation proof failed: ${entry.id} no longer matches ${entry.sha256}`,
      );
    }
  }
  for (const entry of partition.absent) {
    const response = await fetchImpl(entry.id, {
      headers: { "cache-control": "no-cache" },
      redirect: "manual",
    });
    if (response.status !== 404) {
      throw new Error(
        `initial cutover pre-mutation proof failed: ${entry.id} was audited absent but now returns HTTP ${response.status}, not exact HTTP 404`,
      );
    }
  }
}

function splitProjectDomains(value) {
  if (Array.isArray(value)) {
    return value.flatMap((domain) => {
      if (typeof domain === "string") return [domain];
      if (domain && typeof domain === "object") {
        const name = domain.name ?? domain.domain ?? domain.hostname;
        return typeof name === "string" ? [name] : [];
      }
      return [];
    });
  }
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean);
}

function normalizeProjectListRow(row) {
  if (!row || typeof row !== "object") return null;
  const name = row["Project Name"] ?? row.name ?? row.project_name ?? null;
  if (typeof name !== "string" || name === "") return null;
  const domainField = row["Project Domains"] ?? row.domains ?? row["Domains"] ?? row.custom_domains;
  const domainStateAvailable =
    Object.prototype.hasOwnProperty.call(row, "Project Domains") ||
    Object.prototype.hasOwnProperty.call(row, "domains") ||
    Object.prototype.hasOwnProperty.call(row, "Domains") ||
    Object.prototype.hasOwnProperty.call(row, "custom_domains");
  return {
    name,
    domains: splitProjectDomains(domainField),
    domainStateAvailable,
    productionBranch:
      row.production_branch ??
      row.productionBranch ??
      row["Production Branch"] ??
      row["Production branch"] ??
      null,
    latestProductionDeployment: row.canonical_deployment
      ? {
        id: row.canonical_deployment.id ?? null,
        url: row.canonical_deployment.url ?? null,
        createdOn: row.canonical_deployment.created_on ?? null,
      }
      : null,
  };
}

export function parseWranglerProjectList(stdout) {
  let body;
  try {
    body = JSON.parse(text(stdout).replace(/^\uFEFF/u, "").trim());
  } catch (error) {
    const detail = text(stdout).trim() || "(no JSON output)";
    throw new Error(`Wrangler returned invalid Pages project list JSON: ${detail}`, { cause: error });
  }

  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.result)
      ? body.result
      : Array.isArray(body?.projects)
        ? body.projects
        : null;
  if (rows === null) {
    throw new Error("Wrangler Pages project list JSON was not an array");
  }
  return rows.map(normalizeProjectListRow).filter((project) => project !== null);
}

function providerOutput(result) {
  const stdout = text(result?.stdout).trim();
  const stderr = text(result?.stderr).trim();
  const output = [stdout, stderr].filter(Boolean).join("\n");
  if (output !== "") return output;
  if (result?.error) return result.error instanceof Error ? result.error.message : String(result.error);
  return "(no provider diagnostic)";
}

function runWranglerProjectList(run, { root, env }) {
  const result = run("wrangler", WRANGLER_PROJECT_LIST_ARGS, {
    cwd: root,
    encoding: "utf8",
    env,
  });
  const diagnostic = providerOutput(result);
  if (result?.error || result?.status !== 0) {
    return {
      readable: false,
      existing: false,
      name: null,
      domains: [],
      domainStateAvailable: false,
      productionBranch: null,
      detail: `wrangler pages project list --json failed; run \`wrangler login\` and select a profile that can read Pages projects. Provider diagnostic follows:\n${diagnostic}`,
    };
  }

  let projects;
  try {
    projects = parseWranglerProjectList(result.stdout);
  } catch (error) {
    return {
      readable: false,
      existing: false,
      name: null,
      domains: [],
      detail: `${error instanceof Error ? error.message : String(error)}\nProvider diagnostic follows:\n${diagnostic}`,
    };
  }

  const project = projects.find(({ name }) => name === SITE_PROJECT) ?? null;
  if (project === null) {
    return {
      readable: true,
      existing: false,
      name: null,
      domains: [],
      domainStateAvailable: false,
      productionBranch: null,
      latestProductionDeployment: null,
      detail: `Pages project ${SITE_PROJECT} does not exist in the readable Wrangler project list`,
    };
  }
  return {
    readable: true,
    existing: true,
    ...project,
  };
}

function normalizedHostname(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const raw = value.trim();
  try {
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`);
    if (parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return null;
    return parsed.hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    return null;
  }
}

function projectDomainHostnames(target) {
  return [
    ...new Set((target?.domains ?? []).map(normalizedHostname).filter((host) => host !== null)),
  ];
}

function projectDiagnostic(target) {
  if (!target?.readable) return target?.detail ?? "Pages project list is unreadable";
  if (!target?.existing) return target?.detail ?? `Pages project ${SITE_PROJECT} does not exist`;
  return `Pages project ${SITE_PROJECT}`;
}

/**
 * Verify the strongest domain ownership fact Wrangler exposes without using a
 * private Cloudflare API. The Pages project list contains configured domain
 * names, but Wrangler does not expose certificate/activation state there.
 */
export function requireProjectDomainOwnership(target) {
  if (!target?.readable || !target?.existing) {
    throw new Error(`refused before verification: ${projectDiagnostic(target)}`);
  }
  const required = [...SITE_PUBLIC_HOSTNAMES];
  if (target.domainStateAvailable !== true) {
    throw new Error(
      `refused before verification: Wrangler pages project list --json did not expose configured domains for Pages project ${SITE_PROJECT}; cannot prove apex, www, and forms ownership`,
    );
  }
  const configured = new Set(projectDomainHostnames(target));
  const missing = required.filter((hostname) => !configured.has(hostname));
  if (missing.length !== 0) {
    throw new Error(
      `refused before verification: Pages project ${SITE_PROJECT} is missing required custom domain(s): ${missing.join(", ")}; Wrangler project ownership is not complete`,
    );
  }
  return {
    source: "wrangler pages project list --json",
    required,
    attached: required,
    active: null,
    activeVerified: false,
    residual: DOMAIN_STATE_RESIDUAL,
  };
}

/**
 * Initial API cutover must happen before any custom domain is moved. Wrangler
 * does not currently return a Pages project's production-branch setting, so
 * branch verification is recorded as a residual unless a future supported
 * readback supplies it. A reported non-main value is still authoritative and
 * fails closed.
 */
export function requireInitialCutoverTopology(target) {
  if (!target?.readable || !target?.existing) {
    throw new Error(`refused before touching the target: ${projectDiagnostic(target)}`);
  }
  if (target.domainStateAvailable !== true) {
    throw new Error(
      `refused before touching the target: Wrangler did not expose Pages project domains, so the initial cutover cannot prove that no custom domain is attached`,
    );
  }
  const configured = projectDomainHostnames(target);
  const customDomains = configured.filter((hostname) => hostname !== SITE_PREVIEW_HOST);
  if (customDomains.length !== 0) {
    throw new Error(
      `refused before touching the target: initial cutover requires no custom domains on Pages project ${SITE_PROJECT}; found ${customDomains.join(", ")}`,
    );
  }
  if (
    target.productionBranch !== null &&
    target.productionBranch !== undefined &&
    target.productionBranch !== ""
  ) {
    if (target.productionBranch !== PRODUCTION_BRANCH) {
      throw new Error(
        `refused before touching the target: Pages project ${SITE_PROJECT} production branch is ${target.productionBranch}, expected ${PRODUCTION_BRANCH}`,
      );
    }
    return {
      customDomains: [],
      productionBranch: PRODUCTION_BRANCH,
      productionBranchVerified: true,
      residual: null,
    };
  }
  return {
    customDomains: [],
    productionBranch: null,
    productionBranchVerified: false,
    residual:
      "Wrangler pages project list --json does not expose the Pages production branch; the upload is forced to main and the returned deployment is checked against production deployment history before any custom-domain move",
  };
}

function runWranglerProductionDeploymentList(run, { root, env }) {
  const result = run("wrangler", WRANGLER_PRODUCTION_DEPLOYMENT_LIST_ARGS, {
    cwd: root,
    encoding: "utf8",
    env,
  });
  const diagnostic = providerOutput(result);
  if (result?.error || result?.status !== 0) {
    throw new Error(
      `refused before touching the target: wrangler could not list production deployments. Provider diagnostic follows:\n${diagnostic}`,
    );
  }
  let deployments;
  try {
    const parsed = JSON.parse(text(result.stdout).replace(/^\uFEFF/u, "").trim());
    deployments = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.result)
        ? parsed.result
        : Array.isArray(parsed?.deployments)
          ? parsed.deployments
          : null;
  } catch (error) {
    throw new Error(
      `refused before touching the target: Wrangler returned invalid Pages deployment list JSON. Provider diagnostic follows:\n${diagnostic}`,
      { cause: error },
    );
  }
  if (deployments === null) {
    throw new Error(
      "refused before touching the target: Wrangler Pages deployment list JSON was not an array",
    );
  }
  return deployments;
}

function requireKnownProductionDeploymentUrl(deployments, deploymentUrl) {
  const normalized = deploymentUrl.replace(/\/$/u, "");
  const known = deployments.some((deployment) => {
    if (!deployment || typeof deployment !== "object") {
      return false;
    }
    // Wrangler 4 prints JSON table rows with a capitalized `Deployment`
    // column. Retain `url` for the underlying API shape so a CLI format
    // simplification does not weaken the identity check.
    const providerUrl = deployment.Deployment ?? deployment.url;
    return typeof providerUrl === "string" && providerUrl.replace(/\/$/u, "") === normalized;
  });
  if (!known) {
    throw new Error(
      `refused before verification: ${deploymentUrl} is not an exact immutable URL in the ${SITE_PROJECT} production deployment history; branch aliases and unrelated URLs are not accepted`,
    );
  }
}

export async function runSiteDeploy(parsed, options = {}) {
  const root = options.root ?? ROOT;
  const run = options.run ?? spawnSync;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const surface = options.surface ?? SITE_SURFACE;

  const source = readSourceState(run, { root, env });
  const site = {
    project: SITE_PROJECT,
    publicOrigin: SITE_PUBLIC_ORIGIN,
    wwwOrigin: SITE_WWW_ORIGIN,
    schemaOrigin: SCHEMA_PUBLIC_ORIGIN,
    publicOrigins: [...SITE_PUBLIC_ORIGINS],
    dist: SITE_DIST,
    distProblems: inspectDist(root),
  };
  if (site.distProblems.length === 0) site.distDigest = distDigest(root);

  if (parsed.mode === "status") {
    return {
      surface,
      mode: "status",
      mutating: false,
      source,
      site,
      target: runWranglerProjectList(run, { root, env }),
    };
  }

  const schemaEntries = loadSchemaReadbackEntries(root);

  if (parsed.mode === "verify-cutover") {
    assertProductionSource(source);
    const target = runWranglerProjectList(run, { root, env });
    const domainOwnership = requireProjectDomainOwnership(target);
    const deployments = runWranglerProductionDeploymentList(run, { root, env });
    requireKnownProductionDeploymentUrl(deployments, parsed.deploymentUrl);
    runScoped(run, root, "check:host-api-freeze");
    runScoped(run, root, "check:site");
    runScoped(run, root, "build:site");
    const built = distDigest(root);
    const expected = {
      pages: localDigests(root, PAGE_READBACK_ROUTES),
      schemas: localSchemaDigests(root, schemaEntries),
    };
    const readback = {
      immutable: await verifyFullDeployment(fetchImpl, parsed.deploymentUrl, expected),
      apex: await verifyApex(fetchImpl, expected.pages),
      www: await verifyWww(fetchImpl, expected.pages),
      forms: await verifySchemaOrigin(fetchImpl, expected.schemas),
    };
    return {
      kind: "takoform.site-cutover-verification",
      status: "verified",
      surface,
      mode: "verify-cutover",
      mutating: false,
      commit: source.head,
      distDigest: built,
      deploymentUrl: parsed.deploymentUrl,
      publicOriginsVerified: [...SITE_PUBLIC_ORIGINS],
      domainOwnership,
      readback,
      reversal: "forward-repair-only-after-domain-cutover",
    };
  }

  const schemaPartition = parsed.initialCutover
    ? requireInitialCutoverPartition(schemaEntries)
    : null;

  const plan = {
    surface,
    mode: "apply",
    environment: parsed.environment,
    branch: parsed.branch,
    executed: false,
    initialCutover: parsed.initialCutover,
    review: parsed.review,
    publicOrigins: [...SITE_PUBLIC_ORIGINS],
    source,
    site,
    gate: ["check:host-api-freeze", "check:site", "build:site"],
    upload: ["wrangler", "pages", "deploy", SITE_DIST, "--project-name", SITE_PROJECT, "--branch", parsed.branch],
    readbackPlan: {
      immutable: {
        exact: [...PAGE_READBACK_ROUTES, ...schemaEntries.map(({ route }) => route)],
        absent: ABSENT_ROUTES,
      },
      production: parsed.initialCutover
        ? {
          predecessorSchemaPartition: { exact: 31, absent: 17 },
          pagesCanonical: SITE_PAGES_ORIGIN,
          customDomainsRequiredBeforeUpload: false,
        }
        : {
          apexPages: PAGE_READBACK_ROUTES,
          wwwPages: PAGE_READBACK_ROUTES,
          apexAbsent: ABSENT_ROUTES,
          wwwAbsent: ABSENT_ROUTES,
          schemas: schemaEntries.map(({ route }) => route),
        },
    },
  };

  if (parsed.environment === "production") assertProductionSource(source);
  if (!parsed.execute) {
    plan.refusedWithout = "--execute";
    return plan;
  }

  // Wrangler's logged-in profile is the sole provider authority. Read the
  // exact project list before running any gate or upload so authentication and
  // project-topology failures remain pre-mutation diagnostics.
  const target = runWranglerProjectList(run, { root, env });
  if (!target.readable) {
    throw new Error(`refused before touching the target: ${target.detail}`);
  }
  if (!target.existing) {
    throw new Error(
      `refused before touching the target: Pages project ${SITE_PROJECT} does not exist; create it in the operator's Cloudflare account before applying.`,
    );
  }
  const initialTopology = parsed.initialCutover ? requireInitialCutoverTopology(target) : null;
  if (parsed.environment === "production") {
    const deployments = runWranglerProductionDeploymentList(run, { root, env });
    if (parsed.initialCutover && deployments.length !== 0) {
      throw new Error(
        `refused before touching the target: Pages project ${SITE_PROJECT} already has a production deployment; --initial-cutover cannot be reused, inspect provider history and repair forward`,
      );
    }
    if (!parsed.initialCutover && deployments.length === 0) {
      throw new Error(
        `refused before touching the target: Pages project ${SITE_PROJECT} has no production deployment; its first publication requires the audited --initial-cutover flow`,
      );
    }
  }

  // One scoped gate, over the bytes about to be published, before the one
  // upload. `build:site` rebuilds the tree it verifies, so what is uploaded is
  // what was just proved rather than whatever the last local build left.
  runScoped(run, root, "check:host-api-freeze");
  runScoped(run, root, "check:site");
  runScoped(run, root, "build:site");
  const built = distDigest(root);
  const expected = {
    pages: localDigests(root, PAGE_READBACK_ROUTES),
    schemas: localSchemaDigests(root, schemaEntries),
  };

  if (parsed.initialCutover) {
    await auditInitialCutoverPredecessor(fetchImpl, schemaPartition);
    const deploymentsImmediatelyBeforeUpload = runWranglerProductionDeploymentList(run, {
      root,
      env,
    });
    if (deploymentsImmediatelyBeforeUpload.length !== 0) {
      throw new Error(
        `refused before touching the target: Pages project ${SITE_PROJECT} production history changed during the initial-cutover proof; do not upload, inspect the competing deployment and repair the procedure`,
      );
    }
    const topologyImmediatelyBeforeUpload = runWranglerProjectList(run, { root, env });
    requireInitialCutoverTopology(topologyImmediatelyBeforeUpload);
  }

  const upload = run(
    "wrangler",
    [
      "pages",
      "deploy",
      SITE_DIST,
      "--project-name",
      SITE_PROJECT,
      "--branch",
      parsed.branch,
      "--commit-hash",
      source.head,
      "--commit-message",
      `${surface} ${parsed.environment} ${built}`,
      ...(source.dirty ? ["--commit-dirty", "true"] : []),
    ],
    { cwd: root, encoding: "utf8", env },
  );
  if (upload?.error) throw upload.error;
  const uploadOutput = `${text(upload?.stdout)}\n${text(upload?.stderr)}`;
  if (upload?.status !== 0) {
    throw new Error(
      `the upload failed; the target may or may not have changed. Provider output follows verbatim, and nothing is retried:\n${uploadOutput.trim()}`,
    );
  }

  const deploymentUrl = extractDeploymentUrl(uploadOutput);
  let productionDeploymentVerified = false;
  if (parsed.initialCutover) {
    const deploymentsAfterUpload = runWranglerProductionDeploymentList(run, { root, env });
    requireKnownProductionDeploymentUrl(deploymentsAfterUpload, deploymentUrl);
    productionDeploymentVerified = true;
  }
  const readback = {
    immutable: await verifyFullDeployment(fetchImpl, deploymentUrl, expected),
  };

  const result = {
    ...plan,
    executed: true,
    commit: source.head,
    distDigest: built,
    deploymentUrl,
    readback,
    absentRoutes: ABSENT_ROUTES,
    publicOriginsVerified: [],
  };

  if (parsed.initialCutover) {
    result.readback.pagesCanonical = await verifyFullDeployment(
      fetchImpl,
      SITE_PAGES_ORIGIN,
      expected,
    );
    return {
      ...result,
      kind: "takoform.site-initial-cutover-pending",
      status: "pending-domain-cutover",
      review: parsed.review,
      predecessor: INITIAL_CUTOVER_PREDECESSOR,
      schemaPartition,
      pagesCanonicalVerified: SITE_PAGES_ORIGIN,
      productionDeploymentVerified,
      initialTopology,
      publicOriginsVerified: [SITE_PAGES_ORIGIN],
      reversal: "forward-repair-only-after-domain-cutover",
      next:
        "the operator must move domains in order www→apex→forms (www.takoform.com → takoform.com → forms.takoform.com; forms last), then must run `bun run deploy -- takoform-api-v1-cutover --verify-cutover --deployment-url <this exact deploymentUrl>`",
    };
  }

  if (parsed.environment === "production") {
    result.readback.apex = await verifyApex(fetchImpl, expected.pages);
    result.readback.www = await verifyWww(fetchImpl, expected.pages);
    result.readback.forms = await verifySchemaOrigin(fetchImpl, expected.schemas);
    result.publicOriginsVerified = [...SITE_PUBLIC_ORIGINS];
  }
  return result;
}
