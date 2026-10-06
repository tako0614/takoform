import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  ABSENT_ROUTES,
  API_CUTOVER_SURFACE,
  DOMAIN_STATE_RESIDUAL,
  INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES,
  INITIAL_CUTOVER_PREDECESSOR,
  PAGE_READBACK_ROUTES,
  SITE_CONTRACT_READBACK_ROUTES,
  V2_NORMATIVE_ROUTES,
  V2_RAW_SOURCE_ROUTES,
  SCHEMA_PUBLIC_ORIGIN,
  SITE_PUBLIC_ORIGINS,
  SITE_PUBLIC_HOSTNAMES,
  SITE_PAGES_ORIGIN,
  SITE_PROJECT,
  SITE_SURFACE,
  SITE_PUBLIC_ORIGIN,
  SITE_WWW_ORIGIN,
  assertProductionSource,
  extractDeploymentUrl,
  findRollbackCandidate,
  parseSiteDeployArgs,
  readSourceState,
  requireInitialCutoverTopology,
  requireProjectDomainOwnership,
  runSiteDeploy,
} from "./site-deploy.mjs";
import { SCHEMA_LEDGER_PATH, SITE_DIST } from "./site.mjs";

const HEAD = "a".repeat(40);
const DEPLOYMENT = "https://1a2b3c4d.takoform-site.pages.dev";
const ROLLBACK_CANDIDATE = "https://0f0e0d0c.takoform-site.pages.dev";
const REVIEW = "audit_takoform_live_cutover_owner";
const REPOSITORY_ROOT = join(import.meta.dirname, "..");
const SCHEMA_LEDGER = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, SCHEMA_LEDGER_PATH), "utf8"),
);
const SCHEMA_ENTRIES = [...SCHEMA_LEDGER.identities, ...SCHEMA_LEDGER.retired];
const SCHEMA_ROUTES = SCHEMA_ENTRIES.map(({ id }) => new URL(id).pathname);
const EXPECTED_INITIAL_ABSENT_ROUTES = [
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
];
const PROJECT_LIST = JSON.stringify([
  {
    "Project Name": SITE_PROJECT,
    "Project Domains": "",
    "Git Provider": "No",
    "Last Modified": "2026-09-03T00:00:00.000Z",
  },
]);
const PROJECT_LIST_WITH_DOMAINS = JSON.stringify([
  {
    "Project Name": SITE_PROJECT,
    "Project Domains": SITE_PUBLIC_HOSTNAMES.join(", "),
    "Git Provider": "No",
    "Last Modified": "2026-09-03T00:00:00.000Z",
  },
]);

const roots = [];
function fixtureRoot(pageBodies = {}) {
  const root = mkdtempSync(join(tmpdir(), "takoform-site-deploy-"));
  roots.push(root);
  const ledgerPath = join(root, SCHEMA_LEDGER_PATH);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(SCHEMA_LEDGER, null, 2)}\n`);
  for (const route of SITE_CONTRACT_READBACK_ROUTES) {
    const fileRoute = route === "/" ? "/index.html" : route === "/sitemap.xml" ? route :
      route.endsWith("/") ? `${route}index.html` : `${route}.html`;
    const file = join(root, `${SITE_DIST}${fileRoute}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pageBodies[route] ?? (V2_NORMATIVE_ROUTES.includes(route)
      ? `<aside data-release-state="published">v2 source ${route}</aside>` : `bytes for ${route}`));
  }
  for (const entry of SCHEMA_ENTRIES) {
    const route = new URL(entry.id).pathname;
    const file = join(root, `${SITE_DIST}${route}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, readFileSync(join(REPOSITORY_ROOT, entry.source)));
  }
  for (const route of V2_RAW_SOURCE_ROUTES) {
    const file = join(root, `${SITE_DIST}${route}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, readFileSync(join(REPOSITORY_ROOT, "spec/host-api/v2", route.split("/").at(-1).slice(0, -4))));
  }
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function gitRunner({
  dirty = false,
  branch = "main",
  publicMain = HEAD,
  projectList = PROJECT_LIST,
  projectListStatus = 0,
  projectListStderr = "",
  productionDeployments = [
    JSON.stringify([
      {
        Id: "existing-production",
        Environment: "Production",
        Branch: "main",
        Deployment: ROLLBACK_CANDIDATE,
        Status: "1 hour ago",
      },
    ]),
    JSON.stringify([
      {
        Id: "existing-production",
        Environment: "Production",
        Branch: "main",
        Deployment: ROLLBACK_CANDIDATE,
        Status: "1 hour ago",
      },
    ]),
    JSON.stringify([
      {
        Id: "new-production",
        Environment: "Production",
        Branch: "main",
        Deployment: DEPLOYMENT,
        Status: "just now",
      },
      {
        Id: "existing-production",
        Environment: "Production",
        Branch: "main",
        Deployment: ROLLBACK_CANDIDATE,
        Status: "1 hour ago",
      },
    ]),
  ],
  productionDeploymentsStatus = 0,
  uploadDeployment = DEPLOYMENT,
  events = [],
} = {}) {
  const calls = [];
  const invocations = [];
  const deploymentResponses = Array.isArray(productionDeployments)
    ? productionDeployments
    : [productionDeployments];
  let deploymentRead = 0;
  const run = (command, args, options = {}) => {
    calls.push([command, ...args]);
    invocations.push({ command, args, options });
    events.push(`command:${command}:${args.join(" ")}`);
    if (command === "git" && args.includes("--abbrev-ref")) {
      return { status: 0, stdout: `${branch}\n` };
    }
    if (command === "git" && args.includes("rev-parse") && args.includes("HEAD")) {
      return { status: 0, stdout: `${HEAD}\n` };
    }
    if (command === "git" && args.includes("status")) {
      return { status: 0, stdout: dirty ? " M spec/README.md\n" : "" };
    }
    if (command === "git" && args.includes("ls-remote")) {
      return publicMain === null
        ? { status: 128, stdout: "", stderr: "could not read Username\n" }
        : { status: 0, stdout: `${publicMain}\trefs/heads/main\n` };
    }
    if (command === "bun") return { status: 0, stdout: "" };
    if (command === "wrangler" && args.includes("project") && args.includes("list")) {
      return { status: projectListStatus, stdout: projectList, stderr: projectListStderr };
    }
    if (command === "wrangler" && args.includes("deployment") && args.includes("list")) {
      const stdout = deploymentResponses[Math.min(deploymentRead, deploymentResponses.length - 1)];
      deploymentRead += 1;
      return { status: productionDeploymentsStatus, stdout, stderr: "" };
    }
    if (command === "wrangler") {
      return { status: 0, stdout: `Deployment complete! Take a peek over at ${uploadDeployment}\n` };
    }
    return { status: 0, stdout: "" };
  };
  run.calls = calls;
  run.invocations = invocations;
  return run;
}

function localBody(root, route) {
  const fileRoute = route === "/" ? "/index.html" :
    SITE_CONTRACT_READBACK_ROUTES.includes(route) && route !== "/sitemap.xml"
      ? route.endsWith("/") ? `${route}index.html` : `${route}.html`
      : route;
  return readFileSync(join(root, `${SITE_DIST}${fileRoute}`));
}

function servingFetch(root, {
  events = [],
  oldFormsPartition = false,
  override = new Map(),
} = {}) {
  return async (url, init = {}) => {
    events.push(`fetch:${url}`);
    const parsed = new URL(url);
    const route = parsed.pathname;
    const replacement = override.get(url);
    if (replacement !== undefined) return replacement;
    if (ABSENT_ROUTES.includes(route)) return { ok: false, status: 404 };
    if (
      oldFormsPartition &&
      parsed.origin === SCHEMA_PUBLIC_ORIGIN &&
      INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES.includes(route)
    ) {
      return { ok: false, status: 404 };
    }
    if (![...SITE_CONTRACT_READBACK_ROUTES, ...V2_RAW_SOURCE_ROUTES, ...SCHEMA_ROUTES].includes(route)) {
      throw new Error(`unexpected readback ${url}`);
    }
    expect(init.redirect).toBe("manual");
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => localBody(root, route),
    };
  };
}

function priorRevisionRoot({ changeSource = true, state = "revision-open" } = {}) {
  const root = fixtureRoot();
  if (changeSource) {
    for (const route of V2_RAW_SOURCE_ROUTES) {
      writeFileSync(join(root, `${SITE_DIST}${route}`), `previous source for ${route}\n`);
    }
  }
  for (const route of V2_NORMATIVE_ROUTES) {
    const fileRoute = route.endsWith("/") ? `${route}index.html` : `${route}.html`;
    writeFileSync(join(root, `${SITE_DIST}${fileRoute}`),
      `<aside data-release-state="${state}">previous page for ${route}</aside>`);
  }
  return root;
}

function changedRevisionFetch(currentRoot, priorRoot, run, options = {}) {
  const current = servingFetch(currentRoot, options);
  const prior = servingFetch(priorRoot, options);
  return (url, init) => {
    const origin = new URL(url).origin;
    const uploaded = run.calls.some(([command, ...args]) => command === "wrangler" && args.includes("deploy"));
    if (origin === ROLLBACK_CANDIDATE ||
      (!uploaded && [SITE_PUBLIC_ORIGIN, SITE_WWW_ORIGIN].includes(origin))) {
      return prior(url, init);
    }
    return current(url, init);
  };
}

function staleThenConvergingFetch(root, { staleAttempts, events = [] } = {}) {
  const baseFetch = servingFetch(root, { events });
  const attempts = new Map();
  return async (url, init = {}) => {
    const parsed = new URL(url);
    if ([SITE_PUBLIC_ORIGIN, SITE_WWW_ORIGIN, SCHEMA_PUBLIC_ORIGIN].includes(parsed.origin)) {
      const firstRoute = parsed.origin === SCHEMA_PUBLIC_ORIGIN ? SCHEMA_ROUTES[0] : "/";
      if (parsed.pathname === firstRoute) {
        attempts.set(parsed.origin, (attempts.get(parsed.origin) ?? 0) + 1);
      }
      const attempt = attempts.get(parsed.origin) ?? 0;
      if (attempt > 0 && attempt <= staleAttempts) {
        events.push(`fetch:${url}`);
        expect(init.headers["cache-control"]).toBe("no-cache");
        expect(init.headers.pragma).toBe("no-cache");
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => Buffer.from(`stale ${parsed.origin} ${attempt}`),
        };
      }
    }
    return baseFetch(url, init);
  };
}

describe("takoform-site argument parsing", () => {
  test("reads the Pages landing document through its canonical slash route", () => {
    expect(PAGE_READBACK_ROUTES).toEqual(["/", "/sitemap.xml"]);
    expect(PAGE_READBACK_ROUTES).not.toContain("/index.html");
  });

  test("accepts a read-only status request", () => {
    expect(parseSiteDeployArgs(["--status"])).toEqual({ mode: "status" });
  });

  test("requires an exact environment before any mutation", () => {
    expect(() => parseSiteDeployArgs(["--apply"])).toThrow("an exact environment is required");
    expect(() => parseSiteDeployArgs(["--apply", "--environment", "staging"])).toThrow(
      "unknown environment staging",
    );
  });

  test("plans without --execute and mutates only with it", () => {
    expect(parseSiteDeployArgs(["--apply", "--environment", "integration"])).toEqual({
      mode: "apply",
      environment: "integration",
      branch: "preview",
      execute: false,
      initialCutover: false,
      review: null,
    });
    expect(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
    ).toEqual({
      mode: "apply",
      environment: "production",
      branch: "main",
      execute: true,
      initialCutover: false,
      review: null,
    });
  });

  test("makes the first cutover an explicit production-only reviewed acknowledgement", () => {
    expect(
      parseSiteDeployArgs([
        "--apply",
        "--environment",
        "production",
        "--initial-cutover",
        "--review",
        REVIEW,
        "--execute",
      ]),
    ).toEqual({
      mode: "apply",
      environment: "production",
      branch: "main",
      execute: true,
      initialCutover: true,
      review: REVIEW,
    });
    expect(() =>
      parseSiteDeployArgs([
        "--apply",
        "--environment",
        "integration",
        "--initial-cutover",
      ])
    ).toThrow("--initial-cutover is production-only");
    expect(() =>
      parseSiteDeployArgs([
        "--apply",
        "--environment",
        "production",
        "--initial-cutover",
        "--execute",
      ])
    ).toThrow("--review");
    for (const review of ["", "   ", "0123456789abcdef0123456789abcdef"]) {
      expect(() =>
        parseSiteDeployArgs([
          "--apply",
          "--environment",
          "production",
          "--initial-cutover",
          "--review",
          review,
          "--execute",
        ])
      ).toThrow("evidence label");
    }
  });

  test("parses the upload-free post-domain cutover verifier", () => {
    expect(
      parseSiteDeployArgs(["--verify-cutover", "--deployment-url", DEPLOYMENT]),
    ).toEqual({ mode: "verify-cutover", deploymentUrl: DEPLOYMENT });
    expect(() =>
      parseSiteDeployArgs([
        "--verify-cutover",
        "--deployment-url",
        SITE_PAGES_ORIGIN,
      ])
    ).toThrow("exact immutable deployment URL");
    expect(() => parseSiteDeployArgs(["--verify-cutover"])).toThrow("usage:");
  });

  test("keeps direct routine parsing separate from the API cutover surface", () => {
    expect(() =>
      parseSiteDeployArgs(
        ["--apply", "--environment", "production", "--initial-cutover", "--review", REVIEW],
        { allowCutover: false },
      )
    ).toThrow(API_CUTOVER_SURFACE);
    expect(
      parseSiteDeployArgs(
        ["--apply", "--environment", "production", "--review", REVIEW, "--execute"],
        { allowCutover: true, forceInitialCutover: true },
      ),
    ).toMatchObject({ initialCutover: true, review: REVIEW, execute: true });
  });

  test("keeps the production alias out of a preview lane and out of an override", () => {
    expect(() =>
      parseSiteDeployArgs(["--apply", "--environment", "rehearsal", "--branch", "main"])
    ).toThrow("that branch is the production alias");
    expect(() =>
      parseSiteDeployArgs(["--apply", "--environment", "production", "--branch", "preview"])
    ).toThrow("takes no --branch override");
  });

  test("rejects an unknown flag rather than ignoring it", () => {
    expect(() => parseSiteDeployArgs(["--apply", "--environment", "integration", "--force"]))
      .toThrow("usage:");
    expect(() => parseSiteDeployArgs(["--status", "--execute"])).toThrow("usage:");
  });
});

describe("takoform-site production source guard", () => {
  test("refuses a dirty worktree, a non-main branch, and a divergent HEAD", () => {
    expect(() => assertProductionSource({ dirty: true, branch: "main", head: HEAD, publicMain: HEAD }))
      .toThrow("only a clean worktree");
    expect(() =>
      assertProductionSource({ dirty: false, branch: "topic", head: HEAD, publicMain: HEAD })
    ).toThrow("publishes only main");
    expect(() =>
      assertProductionSource({ dirty: false, branch: "main", head: HEAD, publicMain: "b".repeat(40) })
    ).toThrow("is not the public main");
  });

  test("refuses when the public ref could not be read at all", () => {
    expect(() =>
      assertProductionSource({
        dirty: false,
        branch: "main",
        head: HEAD,
        publicMain: null,
        publicMainError: "could not read Username",
      })
    ).toThrow("could not be read");
  });

  test("accepts a clean main that equals the public ref", () => {
    expect(() =>
      assertProductionSource({ dirty: false, branch: "main", head: HEAD, publicMain: HEAD })
    ).not.toThrow();
  });

  test("reads public main outside the worktree with Git credentials and config disabled", () => {
    const run = gitRunner();
    readSourceState(run, {
      root: fixtureRoot(),
      env: {
        PATH: process.env.PATH,
        GH_TOKEN: "must-not-pass",
        GITHUB_TOKEN: "must-not-pass",
        GIT_CONFIG_PARAMETERS: "'credential.helper'='unsafe'",
        GIT_SSH_VARIANT: "ssh",
        SSH_AUTH_SOCK: "/tmp/must-not-pass",
      },
    });
    const publicRead = run.invocations.find(
      ({ command, args }) => command === "git" && args.includes("ls-remote"),
    );
    expect(publicRead.options.cwd).toBe(tmpdir());
    expect(publicRead.options.env).toMatchObject({
      GCM_INTERACTIVE: "never",
      GIT_CONFIG_COUNT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(publicRead.options.env.GIT_CONFIG_GLOBAL).toBeTruthy();
    for (const key of [
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GIT_CONFIG_PARAMETERS",
      "GIT_SSH_VARIANT",
      "SSH_AUTH_SOCK",
    ]) {
      expect(key in publicRead.options.env).toBe(false);
    }
  });
});

describe("takoform-site deployment URL", () => {
  test("takes the immutable URL from Wrangler's completion line and ignores its alias line", () => {
    expect(
      extractDeploymentUrl(
        `✨ Deployment complete! Take a peek over at ${DEPLOYMENT}\n✨ Deployment alias URL: https://preview.takoform-site.pages.dev\n`,
      ),
    ).toBe(DEPLOYMENT);
  });

  test("halts rather than guessing when the output names none or several", () => {
    expect(() => extractDeploymentUrl("Deployment complete!")).toThrow("indeterminate");
    expect(() =>
      extractDeploymentUrl(
        `Deployment complete! Take a peek over at ${DEPLOYMENT}\nDeployment complete! Take a peek over at https://ffff.takoform-site.pages.dev\n`,
      )
    ).toThrow("indeterminate");
  });
});

describe("takoform-site schema cutover invariants", () => {
  test("pins the live-audited 31 exact and exact 17 absent partition", () => {
    expect(SCHEMA_LEDGER.identities).toHaveLength(33);
    expect(SCHEMA_LEDGER.retired).toHaveLength(15);
    expect(INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES).toEqual(EXPECTED_INITIAL_ABSENT_ROUTES);
    expect(INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES).toHaveLength(17);
    expect(
      SCHEMA_ROUTES.filter((route) => !INITIAL_CUTOVER_ABSENT_SCHEMA_ROUTES.includes(route)),
    ).toHaveLength(31);
  });

  test("records the exact predecessor owner without an account identifier", () => {
    expect(INITIAL_CUTOVER_PREDECESSOR).toEqual({
      provider: "cloudflare-worker",
      name: "takoform-website",
      version: "1e4871b5-e4b3-4c30-8bb9-78592b5ce49e",
      deployment: "9eae618a-4144-4115-abe4-3a50dae795af",
      source: "f71d4be4caf5a5e0c4fc97bfadeb6ebb627d1928",
    });
    expect(JSON.stringify(INITIAL_CUTOVER_PREDECESSOR)).not.toContain("account");
  });
});

describe("takoform-site Pages domain ownership", () => {
  test("requires apex, www, and forms when Wrangler exposes configured domains", () => {
    const ownership = requireProjectDomainOwnership({
      readable: true,
      existing: true,
      domainStateAvailable: true,
      domains: SITE_PUBLIC_HOSTNAMES,
    });
    expect(ownership).toMatchObject({
      source: "wrangler pages project list --json",
      required: SITE_PUBLIC_HOSTNAMES,
      attached: SITE_PUBLIC_HOSTNAMES,
      active: null,
      activeVerified: false,
      residual: DOMAIN_STATE_RESIDUAL,
    });
  });

  test("fails closed for a missing www domain", () => {
    expect(() =>
      requireProjectDomainOwnership({
        readable: true,
        existing: true,
        domainStateAvailable: true,
        domains: ["takoform.com", "forms.takoform.com"],
      })
    ).toThrow("www.takoform.com");
  });

  test("fails closed when Wrangler does not expose domain ownership at all", () => {
    expect(() =>
      requireProjectDomainOwnership({
        readable: true,
        existing: true,
        domainStateAvailable: false,
        domains: [],
      })
    ).toThrow("did not expose configured domains");
  });

  test("initial topology rejects an already attached custom domain and records branch residual", () => {
    expect(() =>
      requireInitialCutoverTopology({
        readable: true,
        existing: true,
        domainStateAvailable: true,
        domains: ["takoform.com"],
        productionBranch: null,
      })
    ).toThrow("no custom domains");
    expect(
      requireInitialCutoverTopology({
        readable: true,
        existing: true,
        domainStateAvailable: true,
        domains: [],
        productionBranch: null,
      }),
    ).toMatchObject({ productionBranchVerified: false, residual: expect.stringContaining("does not expose") });
    expect(() =>
      requireInitialCutoverTopology({
        readable: true,
        existing: true,
        domainStateAvailable: true,
        domains: [],
        productionBranch: "preview",
      })
    ).toThrow("expected main");
  });
});

describe("takoform-site runs", () => {
  test("historical v1 cutover cannot upload the current v2 projection", async () => {
    const root = fixtureRoot();
    const run = gitRunner({ productionDeployments: "[]" });
    await expect(runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--initial-cutover", "--review", REVIEW, "--execute"]),
      { root, run, env: {}, surface: API_CUTOVER_SURFACE, fetch: servingFetch(root) },
    )).rejects.toThrow("historical v1 initial cutover cannot upload the current v2 projection");
    expect(run.calls.some(([command]) => command === "wrangler" || command === "bun")).toBe(false);
  });

  test("routine site refuses an incomplete prior public projection", async () => {
    const root = fixtureRoot();
    const run = gitRunner();
    const normal = servingFetch(root);
    const fetch = (url, init) => url === `${SITE_PUBLIC_ORIGIN}/spec/host-api/v2/http`
      ? Promise.resolve({ status: 200, arrayBuffer: async () => Buffer.from("公開準備中です。") })
      : normal(url, init);
    await expect(runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: {}, fetch },
    )).rejects.toThrow("lacks one published or revision-open v2 marker");
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
    expect(run.calls.some(([command, ...args]) => command === "wrangler" && args.includes("deploy"))).toBe(false);
  });

  test("routine site refuses public aliases that disagree on prior raw v2 bytes", async () => {
    const root = fixtureRoot();
    const run = gitRunner();
    const normal = servingFetch(root);
    const fetch = (url, init) => url === `${SITE_PUBLIC_ORIGIN}${V2_RAW_SOURCE_ROUTES[0]}`
      ? Promise.resolve({ status: 200, arrayBuffer: async () => Buffer.from("changed public source") })
      : normal(url, init);
    await expect(runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: {}, fetch },
    )).rejects.toThrow("public aliases and the current immutable deployment disagree");
    expect(run.calls.some(([command, ...args]) => command === "wrangler" && args.includes("deploy"))).toBe(false);
  });

  test("a preview does not sample public aliases", async () => {
    const root = fixtureRoot();
    const run = gitRunner({ dirty: true, branch: "feature/v2-preview" });
    const normal = servingFetch(root);
    const fetch = (url, init) => {
      if ([SITE_PUBLIC_ORIGIN, SITE_WWW_ORIGIN].includes(new URL(url).origin)) {
        throw new Error("preview must not sample a public alias");
      }
      return normal(url, init);
    };
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "integration", "--execute"]),
      { root, run, env: {}, fetch },
    );
    expect(result.readback.immutable.pages).toHaveProperty("/spec/host-api/v2/http");
    expect(run.calls.filter(([command]) => command === "bun")).toEqual([
      ["bun", "run", "check:host-api-freeze"],
      ["bun", "run", "check:site"],
      ["bun", "run", "build:site"],
    ]);
  });

  test("mixed apex and www v2 states cannot authorize routine production", async () => {
    const root = fixtureRoot();
    const normal = servingFetch(root);
    const fetch = (url, init) => new URL(url).origin === SITE_WWW_ORIGIN &&
      V2_NORMATIVE_ROUTES.includes(new URL(url).pathname)
      ? Promise.resolve({ status: 200, arrayBuffer: async () => Buffer.from("公開準備中です。") })
      : normal(url, init);
    const run = gitRunner();
    await expect(runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: {}, fetch },
    )).rejects.toThrow("lacks one published or revision-open v2 marker");
    expect(run.calls.some(([command, ...args]) => command === "wrangler" && args.includes("deploy"))).toBe(false);
  });

  test("status reads local and the Wrangler project list without mutating anything", async () => {
    const run = gitRunner();
    const result = await runSiteDeploy(parseSiteDeployArgs(["--status"]), {
      root: fixtureRoot(),
      run,
      env: {},
      fetch: async () => {
        throw new Error("status must not fetch deployment bytes");
      },
    });
    expect(result.mutating).toBe(false);
    expect(result.target).toMatchObject({
      readable: true,
      existing: true,
      name: SITE_PROJECT,
      domains: [],
    });
    expect(run.calls).toContainEqual(["wrangler", "pages", "project", "list", "--json"]);
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
  });

  test("status reports a provider diagnostic when Wrangler cannot read the project list", async () => {
    const run = gitRunner({
      projectListStatus: 1,
      projectList: "",
      projectListStderr: "Not authenticated. Please run wrangler login.\n",
    });
    const result = await runSiteDeploy(parseSiteDeployArgs(["--status"]), {
      root: fixtureRoot(),
      run,
      env: {},
    });
    expect(result.mutating).toBe(false);
    expect(result.target).toMatchObject({ readable: false, existing: false });
    expect(result.target.detail).toContain("Not authenticated");
    expect(result.target.detail).toContain("wrangler login");
  });

  test("a plan runs no gate and uploads nothing", async () => {
    const run = gitRunner();
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production"]),
      { root: fixtureRoot(), run, env: {}, fetch: async () => ({ ok: true }) },
    );
    expect(result.executed).toBe(false);
    expect(result.refusedWithout).toBe("--execute");
    expect(run.calls.some(([command]) => command === "wrangler")).toBe(false);
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
  });

  test("refuses before the gate when the Wrangler profile cannot read Pages projects", async () => {
    const run = gitRunner({
      projectListStatus: 1,
      projectList: "",
      projectListStderr: "Authentication error [code: 10000]\n",
    });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "integration", "--execute"]),
        { root: fixtureRoot(), run, env: {}, fetch: async () => ({ ok: true }) },
      ),
    ).rejects.toThrow("Authentication error [code: 10000]");
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
  });

  test("refuses before the gate when the exact Pages project is missing", async () => {
    const run = gitRunner({ projectList: "[]" });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "integration", "--execute"]),
        { root: fixtureRoot(), run, env: {}, fetch: async () => ({ ok: true }) },
      ),
    ).rejects.toThrow(`Pages project ${SITE_PROJECT} does not exist`);
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
  });

  test("every preview environment reads all 48 schema bytes from its immutable deployment", async () => {
    for (const environment of ["integration", "rehearsal"]) {
      const root = fixtureRoot();
      const events = [];
      const run = gitRunner({ dirty: true, branch: "feature/site", events });
      const result = await runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", environment, "--execute"]),
        { root, run, env: {}, fetch: servingFetch(root, { events }) },
      );
      expect(Object.keys(result.readback.immutable.schemas)).toHaveLength(48);
      for (const route of SCHEMA_ROUTES) {
        expect(events).toContain(`fetch:${DEPLOYMENT}${route}`);
      }
      expect(result.publicOriginsVerified).toEqual([]);
      const [upload] = run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      );
      expect(upload).toContain("--commit-dirty");
    }
  });

  test("refuses before upload when one locally built schema differs from its ledger digest", async () => {
    const root = fixtureRoot();
    const run = gitRunner({ dirty: true, branch: "feature/site" });
    writeFileSync(join(root, `${SITE_DIST}${SCHEMA_ROUTES[0]}`), "changed schema bytes");
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "integration", "--execute"]),
        { root, run, env: {}, fetch: servingFetch(root) },
      ),
    ).rejects.toThrow("built schema bytes differ");
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(0);
  });

  test("normal production verifies immutable bytes, apex pages, forms schemas, and retired routes", async () => {
    const root = fixtureRoot();
    const events = [];
    const run = gitRunner({ events });
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: {}, fetch: servingFetch(root, { events }) },
    );
    expect(result.executed).toBe(true);
    expect(result.deploymentUrl).toBe(DEPLOYMENT);
    expect(result.productionDeploymentVerified).toBe(true);
    expect(result.commit).toBe(HEAD);
    expect(result.publicOriginsVerified).toEqual([...SITE_PUBLIC_ORIGINS]);
    expect(result.publicOrigins).toEqual([...SITE_PUBLIC_ORIGINS]);
    expect(result.site.publicOrigins).toEqual([...SITE_PUBLIC_ORIGINS]);
    expect(Object.keys(result.readback.immutable.schemas)).toHaveLength(48);
    expect(Object.keys(result.readback.forms.schemas)).toHaveLength(48);
    for (const route of SCHEMA_ROUTES) {
      expect(events).toContain(`fetch:${DEPLOYMENT}${route}`);
      expect(events).toContain(`fetch:${SCHEMA_PUBLIC_ORIGIN}${route}`);
      expect(events).not.toContain(`fetch:${SITE_PUBLIC_ORIGIN}${route}`);
      expect(events).not.toContain(`fetch:${SITE_WWW_ORIGIN}${route}`);
    }
    for (const route of PAGE_READBACK_ROUTES) {
      expect(events).toContain(`fetch:${DEPLOYMENT}${route}`);
      expect(events).toContain(`fetch:${SITE_PUBLIC_ORIGIN}${route}`);
      expect(events).toContain(`fetch:${SITE_WWW_ORIGIN}${route}`);
      expect(events).not.toContain(`fetch:${SCHEMA_PUBLIC_ORIGIN}${route}`);
    }
    for (const route of ABSENT_ROUTES) {
      expect(events).toContain(`fetch:${DEPLOYMENT}${route}`);
      expect(events).toContain(`fetch:${SITE_PUBLIC_ORIGIN}${route}`);
      expect(events).toContain(`fetch:${SITE_WWW_ORIGIN}${route}`);
    }
    expect(ABSENT_ROUTES).toEqual(expect.arrayContaining([
      "/reference/", "/en/reference/", "/spec/", "/en/spec/",
      "/spec/host-api/", "/en/spec/host-api/",
    ]));
    expect(ABSENT_ROUTES).toContain("/spec/project-lifecycle");
    expect(ABSENT_ROUTES).toContain("/spec/project-lifecycle/");
    expect(run.calls.filter(([command]) => command === "bun")).toEqual([
      ["bun", "run", "check:host-api-freeze"],
      ["bun", "run", "check:site"],
      ["bun", "run", "build:site"],
    ]);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(1);
  });

  test("routine production refuses a prior v2 source that differs from fixed current bytes", async () => {
    const root = fixtureRoot();
    const priorRoot = priorRevisionRoot();
    const run = gitRunner();
    await expect(runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: {}, fetch: changedRevisionFetch(root, priorRoot, run) },
    )).rejects.toThrow("prior public Host API v2 source differs from the fixed normative bytes");
    expect(run.calls.some(([command, ...args]) => command === "wrangler" && args.includes("deploy"))).toBe(false);
  });

  test("a removed index on the prior deployment does not block an absent new deployment", async () => {
    const root = fixtureRoot();
    const run = gitRunner();
    const current = servingFetch(root);
    const removedRoute = "/reference/";
    const fetch = (url, init) => {
      if (url === `${ROLLBACK_CANDIDATE}${removedRoute}`) {
        return { status: 200, arrayBuffer: async () => Buffer.from("old reference index") };
      }
      return current(url, init);
    };
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: {}, fetch },
    );
    expect(result.executed).toBe(true);
    expect(result.readback.immutable.absent).toContain(removedRoute);
  });

  test("new deployment exposing a removed index fails exact post-upload readback", async () => {
    const root = fixtureRoot();
    const run = gitRunner();
    const removedRoute = "/en/spec/host-api/";
    const fetch = servingFetch(root, {
      override: new Map([[`${DEPLOYMENT}${removedRoute}`,
        { status: 200, arrayBuffer: async () => Buffer.from("stale index") }]]),
    });
    let failure;
    try {
      await runSiteDeploy(parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root, run, env: {}, fetch });
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({
      kind: "takoform.site-post-upload-failure",
      uploadSucceeded: true,
      reason: "immutable deployment readback failed",
    });
    expect(failure.message).toContain(`retired route ${DEPLOYMENT}${removedRoute} returned HTTP 200`);
    expect(run.calls.filter(([command, ...args]) => command === "wrangler" && args.includes("deploy"))).toHaveLength(1);
  });

  test("post-upload failure may offer a prior revision-open page with the same fixed v2 bytes", async () => {
    const root = fixtureRoot();
    const priorRoot = priorRevisionRoot({ changeSource: false });
    const run = gitRunner();
    const fetch = changedRevisionFetch(root, priorRoot, run, {
      override: new Map([[`${DEPLOYMENT}${SCHEMA_ROUTES[0]}`,
        { status: 200, arrayBuffer: async () => Buffer.from("wrong new schema") }]]),
    });
    let failure;
    try {
      await runSiteDeploy(parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root, run, env: {}, fetch });
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({
      kind: "takoform.site-post-upload-failure",
      reason: "immutable deployment readback failed",
      rollbackCandidate: { url: ROLLBACK_CANDIDATE },
    });
  });

  test("prior immutable schema drift refuses before upload even when v2 aliases agree", async () => {
    const root = fixtureRoot();
    const priorRoot = priorRevisionRoot();
    const run = gitRunner();
    const fetch = changedRevisionFetch(root, priorRoot, run, {
      override: new Map([[`${ROLLBACK_CANDIDATE}${SCHEMA_ROUTES[0]}`,
        { status: 200, arrayBuffer: async () => Buffer.from("changed prior schema") }]]),
    });
    await expect(runSiteDeploy(parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: {}, fetch })).rejects.toThrow("the prior immutable deployment");
    expect(run.calls.some(([command, ...args]) => command === "wrangler" && args.includes("deploy"))).toBe(false);
  });

  test("retains immutable and rollback identities when immutable post-upload readback fails", async () => {
    const root = fixtureRoot();
    const route = SCHEMA_ROUTES[0];
    const history = JSON.stringify([{ Id: "rollback", Deployment: ROLLBACK_CANDIDATE }]);
    const run = gitRunner({
      productionDeployments: [
        history,
        history,
        JSON.stringify([
          { Id: "new-production", Environment: "Production", Branch: "main", Deployment: DEPLOYMENT },
          { Id: "rollback", Environment: "Production", Branch: "main", Deployment: ROLLBACK_CANDIDATE },
        ]),
      ],
      uploadDeployment: DEPLOYMENT,
    });
    let failure;
    try {
      await runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root,
          run,
          env: {},
          fetch: servingFetch(root, {
            override: new Map([
              [
                `${DEPLOYMENT}${route}`,
                { ok: true, status: 200, arrayBuffer: async () => Buffer.from("wrong bytes") },
              ],
            ]),
          }),
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.kind).toBe("takoform.site-post-upload-failure");
    expect(failure.reason).toBe("immutable deployment readback failed");
    expect(failure.deploymentUrl).toBe(DEPLOYMENT);
    expect(failure.rollbackCandidate.url).toBe(ROLLBACK_CANDIDATE);
    expect(failure.message).toContain("upload succeeded");
    expect(failure.message).toContain(DEPLOYMENT);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(1);
  });

  test("selects the exact predecessor behind the uploaded production deployment", () => {
    const concurrent = "https://22222222.takoform-site.pages.dev";
    const failed = "https://33333333.takoform-site.pages.dev";
    const preview = "https://44444444.takoform-site.pages.dev";
    expect(findRollbackCandidate([
      {
        Id: "concurrent-newer-production",
        Environment: "Production",
        Branch: "main",
        Deployment: concurrent,
        Status: "just now",
      },
      {
        Id: "uploaded-production",
        Environment: "Production",
        Branch: "main",
        Deployment: DEPLOYMENT,
        Status: "seconds ago",
      },
      {
        Id: "failed-production",
        Environment: "Production",
        Branch: "main",
        Deployment: failed,
        Status: "failed",
      },
      {
        Id: "active-production",
        Environment: "Production",
        Branch: "main",
        Deployment: "https://55555555.takoform-site.pages.dev",
        Status: "Active",
      },
      {
        id: "idle-production-api-shape",
        environment: "production",
        branch: "main",
        url: "https://66666666.takoform-site.pages.dev",
        latest_stage: { status: "idle" },
      },
      {
        Id: "preview",
        Environment: "Preview",
        Branch: "feature/site",
        Deployment: preview,
        Status: "success",
      },
      {
        Id: "exact-predecessor",
        Environment: "Production",
        Branch: "main",
        Deployment: ROLLBACK_CANDIDATE,
        Status: "1 hour ago",
      },
    ], DEPLOYMENT)).toMatchObject({
      id: "exact-predecessor",
      url: ROLLBACK_CANDIDATE,
      branch: "main",
    });
  });

  test("wraps an invalid immutable URL acknowledgement after exactly one upload", async () => {
    const root = fixtureRoot();
    const run = gitRunner({ uploadDeployment: "not-a-deployment-url" });
    let failure;
    try {
      await runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root, run, env: {}, fetch: servingFetch(root) },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      kind: "takoform.site-post-upload-failure",
      uploadSucceeded: true,
      reason: "immutable deployment URL was unavailable from the upload acknowledgement",
      deploymentUrl: null,
      rollbackCandidate: { url: ROLLBACK_CANDIDATE },
    });
    expect(failure.message).toContain("upload succeeded");
    expect(failure.message).toContain("immutable deployment URL unavailable");
    expect(failure.message).toContain(ROLLBACK_CANDIDATE);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(1);
  });

  test("refuses before upload when production history has only non-successful rows", async () => {
    const root = fixtureRoot();
    const run = gitRunner({
      productionDeployments: JSON.stringify([
        {
          Id: "active",
          Environment: "Production",
          Branch: "main",
          Deployment: ROLLBACK_CANDIDATE,
          Status: "Active",
        },
        {
          id: "idle",
          environment: "production",
          branch: "main",
          url: "https://77777777.takoform-site.pages.dev",
          latest_stage: { status: "idle" },
        },
      ]),
    });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root, run, env: {}, fetch: servingFetch(root) },
      ),
    ).rejects.toThrow("no successful production/main deployment");
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(0);
  });

  test("bounds a non-cooperative immutable readback after one upload", async () => {
    const root = fixtureRoot();
    const run = gitRunner();
    const baseFetch = servingFetch(root);
    const fetch = (url, init) =>
      url === `${DEPLOYMENT}/` ? new Promise(() => {}) : baseFetch(url, init);
    let failure;
    try {
      await runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root,
          run,
          env: {},
          fetch,
          postUploadReadback: { attempts: 1, intervalMs: 0, deadlineMs: 5 },
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      kind: "takoform.site-post-upload-failure",
      uploadSucceeded: true,
      reason: "immutable deployment readback failed",
      deploymentUrl: DEPLOYMENT,
    });
    expect(failure.message).toContain("deadline elapsed");
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(1);
  });

  test("polls stale production aliases until they converge after one upload", async () => {
    const root = fixtureRoot();
    const events = [];
    const run = gitRunner({ events });
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      {
        root,
        run,
        env: {},
        events,
        fetch: staleThenConvergingFetch(root, { staleAttempts: 2, events }),
        postUploadReadback: { attempts: 4, intervalMs: 0 },
      },
    );
    expect(result.executed).toBe(true);
    expect(result.deploymentUrl).toBe(DEPLOYMENT);
    expect(result.publicOriginsVerified).toEqual([...SITE_PUBLIC_ORIGINS]);
    expect(result.readbackAttempts).toBe(3);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(1);
    expect(
      run.calls.filter(
        ([command, ...args]) =>
          command === "wrangler" && args.includes("deployment") && args.includes("list"),
      ),
    ).toHaveLength(3);
  });

  test("reports an explicit post-upload convergence failure with immutable and rollback URLs", async () => {
    const root = fixtureRoot();
    const events = [];
    const history = JSON.stringify([{ Id: "rollback", Deployment: ROLLBACK_CANDIDATE }]);
    const run = gitRunner({
      events,
      productionDeployments: [history, history, JSON.stringify([
        { Id: "new-production", Deployment: DEPLOYMENT },
        { Id: "rollback", Deployment: ROLLBACK_CANDIDATE },
      ])],
      uploadDeployment: DEPLOYMENT,
    });
    let failure;
    try {
      await runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root,
          run,
          env: {},
          events,
          fetch: staleThenConvergingFetch(root, { staleAttempts: 100, events }),
          postUploadReadback: { attempts: 3, intervalMs: 0 },
        },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("upload succeeded");
    expect(failure.message).toContain("readback not converged");
    expect(failure.message).toContain(DEPLOYMENT);
    expect(failure.message).toContain(ROLLBACK_CANDIDATE);
    expect(failure.deploymentUrl).toBe(DEPLOYMENT);
    expect(failure.rollbackCandidate.url).toBe(ROLLBACK_CANDIDATE);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(1);
  });

  test("refuses when the returned immutable URL is absent from refreshed production history", async () => {
    const root = fixtureRoot();
    const history = JSON.stringify([{ Id: "rollback", Deployment: ROLLBACK_CANDIDATE }]);
    const run = gitRunner({
      productionDeployments: [history, history],
      uploadDeployment: DEPLOYMENT,
    });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root, run, env: {}, fetch: servingFetch(root) },
      ),
    ).rejects.toThrow(/upload succeeded.*production deployment history.*1a2b3c4d/u);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(1);
    expect(
      run.calls.filter(
        ([command, ...args]) =>
          command === "wrangler" && args.includes("deployment") && args.includes("list"),
      ),
    ).toHaveLength(3);
  });

  test("normal production cannot consume the project's first deployment", async () => {
    const run = gitRunner({ productionDeployments: "[]" });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root: fixtureRoot(), run, env: {}, fetch: async () => ({}) },
      ),
    ).rejects.toThrow("first publication requires the audited --initial-cutover flow");
    expect(run.calls.filter(([command]) => command === "bun")).toHaveLength(0);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(0);
  });

  test("every historical initial-cutover apply is refused before provider access", async () => {
    for (const surface of [SITE_SURFACE, API_CUTOVER_SURFACE]) {
      const root = fixtureRoot();
      const run = gitRunner({ productionDeployments: "[]" });
      await expect(runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--initial-cutover", "--review", REVIEW, "--execute"]),
        { root, run, env: {}, surface, fetch: servingFetch(root) },
      )).rejects.toThrow("historical v1 initial cutover cannot upload the current v2 projection");
      expect(run.calls.some(([command]) => command === "wrangler" || command === "bun")).toBe(false);
    }
  });


  test("the post-domain verifier requires clean public main and uploads nothing", async () => {
    const root = fixtureRoot();
    const events = [];
    const run = gitRunner({
      events,
      projectList: PROJECT_LIST_WITH_DOMAINS,
      productionDeployments: JSON.stringify([
        {
          Id: "new-production",
          Environment: "Production",
          Branch: "main",
          Deployment: DEPLOYMENT,
          Status: "just now",
        },
        {
          Id: "old-production",
          Environment: "Production",
          Branch: "main",
          Deployment: ROLLBACK_CANDIDATE,
          Status: "1 hour ago",
        },
      ]),
    });
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--verify-cutover", "--deployment-url", DEPLOYMENT]),
      { root, run, env: {}, fetch: servingFetch(root, { events }) },
    );
    expect(result).toMatchObject({
      kind: "takoform.site-cutover-verification",
      status: "verified",
      mutating: false,
      commit: HEAD,
      deploymentUrl: DEPLOYMENT,
      publicOriginsVerified: SITE_PUBLIC_ORIGINS,
      domainOwnership: {
        required: SITE_PUBLIC_HOSTNAMES,
        attached: SITE_PUBLIC_HOSTNAMES,
        activeVerified: false,
        residual: DOMAIN_STATE_RESIDUAL,
      },
    });
    expect(Object.keys(result.readback.immutable.schemas)).toHaveLength(48);
    expect(Object.keys(result.readback.forms.schemas)).toHaveLength(48);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deployment") && args.includes("list"),
      ),
    ).toHaveLength(1);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(0);
    expect(run.calls.filter(([command]) => command === "bun")).toEqual([
      ["bun", "run", "check:host-api-freeze"],
      ["bun", "run", "check:site"],
      ["bun", "run", "build:site"],
    ]);
    for (const route of ABSENT_ROUTES) {
      expect(events).toContain(`fetch:${DEPLOYMENT}${route}`);
      expect(events).toContain(`fetch:${SITE_PUBLIC_ORIGIN}${route}`);
      expect(events).toContain(`fetch:${SITE_WWW_ORIGIN}${route}`);
    }
    for (const route of PAGE_READBACK_ROUTES) {
      expect(events).toContain(`fetch:${SITE_WWW_ORIGIN}${route}`);
    }

    const dirtyRun = gitRunner({ dirty: true });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--verify-cutover", "--deployment-url", DEPLOYMENT]),
        { root: fixtureRoot(), run: dirtyRun, env: {}, fetch: async () => ({}) },
      ),
    ).rejects.toThrow("only a clean worktree");
    expect(dirtyRun.calls.filter(([command]) => command === "bun")).toHaveLength(0);
  });

  test("the post-domain verifier refuses before the freeze gate when www is not attached", async () => {
    const run = gitRunner({
      projectList: JSON.stringify([
        {
          "Project Name": SITE_PROJECT,
          "Project Domains": "takoform.com, forms.takoform.com",
        },
      ]),
    });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--verify-cutover", "--deployment-url", DEPLOYMENT]),
        { root: fixtureRoot(), run, env: {}, fetch: async () => ({}) },
      ),
    ).rejects.toThrow("www.takoform.com");
    expect(run.calls.filter(([command]) => command === "bun")).toHaveLength(0);
  });

  test("the post-domain verifier refuses before the freeze gate when domain ownership is unavailable", async () => {
    const run = gitRunner({
      projectList: JSON.stringify([{ "Project Name": SITE_PROJECT }]),
    });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--verify-cutover", "--deployment-url", DEPLOYMENT]),
        { root: fixtureRoot(), run, env: {}, fetch: async () => ({}) },
      ),
    ).rejects.toThrow("did not expose configured domains");
    expect(run.calls.filter(([command]) => command === "bun")).toHaveLength(0);
  });

  test("the post-domain verifier rejects a branch alias not found in production history", async () => {
    const run = gitRunner({ projectList: PROJECT_LIST_WITH_DOMAINS });
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs([
          "--verify-cutover",
          "--deployment-url",
          "https://preview.takoform-site.pages.dev",
        ]),
        { root: fixtureRoot(), run, env: {}, fetch: async () => ({}) },
      ),
    ).rejects.toThrow("not an exact immutable URL");
    expect(run.calls.filter(([command]) => command === "bun")).toHaveLength(0);
    expect(
      run.calls.filter(
        ([command, ...args]) => command === "wrangler" && args.includes("deploy"),
      ),
    ).toHaveLength(0);
  });

  test("halts when an immutable schema serves other bytes than the build", async () => {
    const root = fixtureRoot();
    const run = gitRunner({ dirty: true, branch: "feature/site" });
    const route = SCHEMA_ROUTES[0];
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "integration", "--execute"]),
        {
          root,
          run,
          env: {},
          fetch: servingFetch(root, {
            override: new Map([
              [
                `${DEPLOYMENT}${route}`,
                { ok: true, status: 200, arrayBuffer: async () => Buffer.from("other") },
              ],
            ]),
          }),
        },
      ),
    ).rejects.toThrow("the deployment is live and wrong");
  });

  test("halts when the apex alias still serves an older page", async () => {
    const root = fixtureRoot();
    const run = gitRunner();
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root,
          run,
          env: {},
          fetch: servingFetch(root, {
            override: new Map([
              [
                `${SITE_PUBLIC_ORIGIN}${PAGE_READBACK_ROUTES[0]}`,
                { ok: true, status: 200, arrayBuffer: async () => Buffer.from("stale") },
              ],
            ]),
          }),
          postUploadReadback: { attempts: 1, intervalMs: 0 },
        },
      ),
    ).rejects.toThrow(SITE_PUBLIC_ORIGIN);
  });

  test("halts when the www alias serves an older page or redirects", async () => {
    const staleRoot = fixtureRoot();
    const staleRun = gitRunner();
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root: staleRoot,
          run: staleRun,
          env: {},
          fetch: servingFetch(staleRoot, {
            override: new Map([
              [
                `${SITE_WWW_ORIGIN}${PAGE_READBACK_ROUTES[0]}`,
                { ok: true, status: 200, arrayBuffer: async () => Buffer.from("stale") },
              ],
            ]),
          }),
          postUploadReadback: { attempts: 1, intervalMs: 0 },
        },
      ),
    ).rejects.toThrow(SITE_WWW_ORIGIN);

    const redirectRoot = fixtureRoot();
    const redirectRun = gitRunner();
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root: redirectRoot,
          run: redirectRun,
          env: {},
          fetch: servingFetch(redirectRoot, {
            override: new Map([
              [`${SITE_WWW_ORIGIN}${PAGE_READBACK_ROUTES[0]}`, { ok: false, status: 301 }],
            ]),
          }),
          postUploadReadback: { attempts: 1, intervalMs: 0 },
        },
      ),
    ).rejects.toThrow(`${SITE_WWW_ORIGIN}/ returned HTTP 301`);
  });

  test("halts when a removed public metadata or catalog route is still served", async () => {
    const root = fixtureRoot();
    const run = gitRunner();
    const route = "/.well-known/takoform-site.json";
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root,
          run,
          env: {},
          fetch: servingFetch(root, {
            override: new Map([
              [
                `${DEPLOYMENT}${route}`,
                { ok: true, status: 200, arrayBuffer: async () => Buffer.from("stale") },
              ],
            ]),
          }),
        },
      ),
    ).rejects.toThrow("still exposes a removed public surface");
  });

  test("preserves the provider output verbatim when the upload fails", async () => {
    const root = fixtureRoot();
    const fallback = gitRunner();
    const run = (command, args) => {
      if (command === "wrangler" && args.includes("project") && args.includes("list")) {
        return { status: 0, stdout: PROJECT_LIST, stderr: "" };
      }
      if (command === "wrangler" && args.includes("deployment") && args.includes("list")) {
        return {
          status: 0,
          stdout: JSON.stringify([{ Id: "existing-production", Deployment: DEPLOYMENT }]),
          stderr: "",
        };
      }
      if (command === "wrangler") {
        return { status: 1, stdout: "", stderr: "Authentication error [code: 10000]\n" };
      }
      return fallback(command, args);
    };
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root, run, env: {}, fetch: servingFetch(root) },
      ),
    ).rejects.toThrow("Authentication error [code: 10000]");
  });
});
