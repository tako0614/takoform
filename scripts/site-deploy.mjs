#!/usr/bin/env bun

// The `takoform-site` deploy surface: static bytes to a Pages project.
//
// This is the routine static lane and nothing more. It publishes prerendered
// HTML plus a set of JSON files whose bytes are already frozen by an
// append-only ledger, so it owns no schema, no durable state, no credential
// rotation, and no consumer-pinned version. The gate it runs is scoped to the
// bytes it publishes: re-running an unrelated Go and conformance suite to ship
// a typo fix is a procedure that gets routed around rather than followed.
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
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_RELEASE } from "./core-release.mjs";
import { SITE_DIST, distDigest, inspectDist } from "./site.mjs";
import { SITE_STATUS_ROUTE } from "./site-status.mjs";

export const SITE_SURFACE = "takoform-site";
export const SITE_PROJECT = "takoform-site";
export const SITE_PUBLIC_ORIGIN = "https://takoform.com";
export const SITE_PREVIEW_HOST = `${SITE_PROJECT}.pages.dev`;
export const SITE_ENVIRONMENTS = Object.freeze(["integration", "rehearsal", "production"]);
export const PRODUCTION_BRANCH = "main";
export const DEFAULT_PREVIEW_BRANCH = "preview";

export const CLOUDFLARE_TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
export const CLOUDFLARE_ACCOUNT_ENV = "CLOUDFLARE_ACCOUNT_ID";

// Read back more than one route. A single document proves the upload landed;
// it does not prove the published schema tree came with it.
export const READBACK_ROUTES = Object.freeze([
  SITE_STATUS_ROUTE,
  "/schemas/v1/host-discovery.schema.json",
  "/schemas/v1/form-ref.schema.json",
]);

export const USAGE = [
  `usage: bun run deploy -- ${SITE_SURFACE} --status`,
  `       bun run deploy -- ${SITE_SURFACE} --apply --environment <${SITE_ENVIRONMENTS.join("|")}> [--branch <name>] [--execute]`,
].join("\n");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function text(value) {
  if (value === undefined || value === null) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

export function parseSiteDeployArgs(args) {
  const rest = [...args];
  if (rest.length === 1 && rest[0] === "--status") {
    return Object.freeze({ mode: "status" });
  }
  if (rest[0] !== "--apply") throw new Error(USAGE);
  rest.shift();

  let environment;
  let branch;
  let execute = false;
  while (rest.length > 0) {
    const flag = rest.shift();
    if (flag === "--execute") {
      execute = true;
    } else if (flag === "--environment" || flag === "--branch") {
      const value = rest.shift();
      if (value === undefined || value.startsWith("--")) throw new Error(USAGE);
      if (flag === "--environment") environment = value;
      else branch = value;
    } else {
      throw new Error(USAGE);
    }
  }

  if (environment === undefined) {
    throw new Error(
      `an exact environment is required before any mutation: --environment <${SITE_ENVIRONMENTS.join("|")}>`,
    );
  }
  if (!SITE_ENVIRONMENTS.includes(environment)) {
    throw new Error(`unknown environment ${environment}; expected one of ${SITE_ENVIRONMENTS.join(", ")}`);
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

  return Object.freeze({ mode: "apply", environment, branch, execute });
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
function credentialFreeEnvironment(env) {
  const clean = { ...env };
  for (const key of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GIT_ASKPASS",
    "GIT_CONFIG_PARAMETERS",
    "GIT_SSH_COMMAND",
    "SSH_ASKPASS",
    "SSH_AUTH_SOCK",
  ]) {
    delete clean[key];
  }
  clean.GIT_TERMINAL_PROMPT = "0";
  return clean;
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
    { cwd: root, encoding: "utf8", env: credentialFreeEnvironment(env) },
  );
  if (remote?.error || remote?.status !== 0) {
    publicMainError = text(remote?.stderr).trim() || "public ref read failed";
  } else {
    publicMain = text(remote.stdout).trim().split(/\s+/u)[0] ?? null;
  }
  return { head, branch, dirty, publicMain, publicMainError };
}

function requireCredentials(env) {
  const missing = [CLOUDFLARE_TOKEN_ENV, CLOUDFLARE_ACCOUNT_ENV].filter(
    (name) => (env[name] ?? "") === "",
  );
  if (missing.length !== 0) {
    throw new Error(
      `refused before touching the target: set ${missing.join(" and ")} in the operator environment`,
    );
  }
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
  const matches = [
    ...text(stdout).matchAll(
      new RegExp(`https://[a-z0-9-]+\\.${SITE_PREVIEW_HOST.replace(/\./gu, "\\.")}`, "gu"),
    ),
  ].map((match) => match[0]);
  const unique = [...new Set(matches)];
  if (unique.length !== 1) {
    throw new Error(
      `the upload finished but printed ${unique.length} immutable deployment URLs; the target state is indeterminate, read the provider deployment history before acting`,
    );
  }
  return unique[0];
}

async function readbackDigests(fetchImpl, origin, routes) {
  const digests = {};
  for (const route of routes) {
    const response = await fetchImpl(`${origin}${route}`, {
      headers: { "cache-control": "no-cache" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`readback of ${origin}${route} returned HTTP ${response.status}`);
    }
    digests[route] = sha256(Buffer.from(await response.arrayBuffer()));
  }
  return digests;
}

function localDigests(root, routes) {
  const digests = {};
  for (const route of routes) {
    digests[route] = sha256(readFileSync(resolve(root, `${SITE_DIST}${route}`)));
  }
  return digests;
}

function compareDigests(where, expected, actual) {
  const mismatched = Object.keys(expected).filter((route) => expected[route] !== actual[route]);
  if (mismatched.length !== 0) {
    throw new Error(
      `${where} serves different bytes than the upload for ${mismatched.join(", ")}; the deployment is live and wrong, read the provider deployment history and roll back before retrying`,
    );
  }
}

async function readProjectState(fetchImpl, env) {
  const account = env[CLOUDFLARE_ACCOUNT_ENV];
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${SITE_PROJECT}`,
    { headers: { authorization: `Bearer ${env[CLOUDFLARE_TOKEN_ENV]}` } },
  );
  if (!response.ok) {
    return { readable: false, detail: `HTTP ${response.status}` };
  }
  const body = await response.json();
  const project = body?.result ?? {};
  return {
    readable: true,
    name: project.name ?? null,
    productionBranch: project.production_branch ?? null,
    domains: project.domains ?? [],
    latestProductionDeployment: project.canonical_deployment
      ? {
        id: project.canonical_deployment.id ?? null,
        url: project.canonical_deployment.url ?? null,
        createdOn: project.canonical_deployment.created_on ?? null,
      }
      : null,
  };
}

export async function runSiteDeploy(parsed, options = {}) {
  const root = options.root ?? ROOT;
  const run = options.run ?? spawnSync;
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const source = readSourceState(run, { root, env });
  const site = {
    project: SITE_PROJECT,
    publicOrigin: SITE_PUBLIC_ORIGIN,
    dist: SITE_DIST,
    distProblems: inspectDist(root),
  };
  if (site.distProblems.length === 0) site.distDigest = distDigest(root);

  if (parsed.mode === "status") {
    const credentialsPresent = [CLOUDFLARE_TOKEN_ENV, CLOUDFLARE_ACCOUNT_ENV].every(
      (name) => (env[name] ?? "") !== "",
    );
    return {
      surface: SITE_SURFACE,
      mode: "status",
      mutating: false,
      source,
      site,
      credentialsPresent,
      target: credentialsPresent
        ? await readProjectState(fetchImpl, env)
        : {
          readable: false,
          detail: `${CLOUDFLARE_TOKEN_ENV} and ${CLOUDFLARE_ACCOUNT_ENV} are not set; only local state was read`,
        },
    };
  }

  const plan = {
    surface: SITE_SURFACE,
    mode: "apply",
    environment: parsed.environment,
    branch: parsed.branch,
    executed: false,
    source,
    site,
    gate: ["check:site", "build:site"],
    upload: ["wrangler", "pages", "deploy", SITE_DIST, "--project-name", SITE_PROJECT, "--branch", parsed.branch],
    readback: READBACK_ROUTES,
  };

  if (parsed.environment === "production") assertProductionSource(source);
  if (!parsed.execute) {
    plan.refusedWithout = "--execute";
    return plan;
  }
  requireCredentials(env);

  // One scoped gate, over the bytes about to be published, before the one
  // upload. `build:site` rebuilds the tree it verifies, so what is uploaded is
  // what was just proved rather than whatever the last local build left.
  runScoped(run, root, "check:site");
  runScoped(run, root, "build:site");
  const built = distDigest(root);
  const expected = localDigests(root, READBACK_ROUTES);

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
      `${SITE_SURFACE} ${parsed.environment} ${built}`,
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
  compareDigests(
    `the immutable deployment ${deploymentUrl}`,
    expected,
    await readbackDigests(fetchImpl, deploymentUrl, READBACK_ROUTES),
  );

  const result = {
    ...plan,
    executed: true,
    commit: source.head,
    distDigest: built,
    deploymentUrl,
    readbackDigests: expected,
  };

  if (parsed.environment === "production") {
    compareDigests(
      `the public alias ${SITE_PUBLIC_ORIGIN}`,
      expected,
      await readbackDigests(fetchImpl, SITE_PUBLIC_ORIGIN, READBACK_ROUTES),
    );
    result.publicOriginVerified = SITE_PUBLIC_ORIGIN;
  } else {
    result.publicOriginVerified = null;
  }
  return result;
}
