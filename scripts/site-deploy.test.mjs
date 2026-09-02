import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  CLOUDFLARE_ACCOUNT_ENV,
  CLOUDFLARE_TOKEN_ENV,
  READBACK_ROUTES,
  SITE_PUBLIC_ORIGIN,
  assertProductionSource,
  extractDeploymentUrl,
  parseSiteDeployArgs,
  runSiteDeploy,
} from "./site-deploy.mjs";
import { SITE_DIST } from "./site.mjs";

const HEAD = "a".repeat(40);
const DEPLOYMENT = "https://1a2b3c4d.takoform-site.pages.dev";

const roots = [];
function fixtureRoot(bodies) {
  const root = mkdtempSync(join(tmpdir(), "takoform-site-deploy-"));
  roots.push(root);
  for (const route of READBACK_ROUTES) {
    const file = join(root, `${SITE_DIST}${route}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bodies[route] ?? `bytes for ${route}`);
  }
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function gitRunner({ dirty = false, branch = "main", publicMain = HEAD } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
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
    if (command === "wrangler") {
      return { status: 0, stdout: `Deployment complete! Take a peek over at ${DEPLOYMENT}\n` };
    }
    return { status: 0, stdout: "" };
  };
  run.calls = calls;
  return run;
}

function servingFetch(bodies, { failing = new Set() } = {}) {
  return async (url) => {
    const route = new URL(url).pathname;
    if (failing.has(url)) return { ok: false, status: 500 };
    const body = bodies[route] ?? `bytes for ${route}`;
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(body) };
  };
}

const credentials = {
  [CLOUDFLARE_TOKEN_ENV]: "token-value",
  [CLOUDFLARE_ACCOUNT_ENV]: "account-value",
};

describe("takoform-site argument parsing", () => {
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
    });
    expect(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
    ).toEqual({ mode: "apply", environment: "production", branch: "main", execute: true });
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
});

describe("takoform-site deployment URL", () => {
  test("takes the one immutable URL the upload printed", () => {
    expect(extractDeploymentUrl(`... ${DEPLOYMENT} ...`)).toBe(DEPLOYMENT);
    expect(extractDeploymentUrl(`${DEPLOYMENT}\n${DEPLOYMENT}\n`)).toBe(DEPLOYMENT);
  });

  test("halts rather than guessing when the output names none or several", () => {
    expect(() => extractDeploymentUrl("Deployment complete!")).toThrow("indeterminate");
    expect(() =>
      extractDeploymentUrl(`${DEPLOYMENT}\nhttps://ffff.takoform-site.pages.dev\n`)
    ).toThrow("indeterminate");
  });
});

describe("takoform-site runs", () => {
  test("status reads local and provider state without mutating anything", async () => {
    const run = gitRunner();
    const result = await runSiteDeploy(parseSiteDeployArgs(["--status"]), {
      root: fixtureRoot({}),
      run,
      env: {},
      fetch: async () => {
        throw new Error("status must not reach the provider without credentials");
      },
    });
    expect(result.mutating).toBe(false);
    expect(result.credentialsPresent).toBe(false);
    expect(result.target.detail).toContain(CLOUDFLARE_TOKEN_ENV);
    expect(run.calls.some(([command]) => command === "wrangler")).toBe(false);
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
  });

  test("a plan runs no gate and uploads nothing", async () => {
    const run = gitRunner();
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production"]),
      { root: fixtureRoot({}), run, env: credentials, fetch: async () => ({ ok: true }) },
    );
    expect(result.executed).toBe(false);
    expect(result.refusedWithout).toBe("--execute");
    expect(run.calls.some(([command]) => command === "wrangler")).toBe(false);
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
  });

  test("refuses before the gate when the operator credentials are absent", async () => {
    const run = gitRunner();
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "integration", "--execute"]),
        { root: fixtureRoot({}), run, env: {}, fetch: async () => ({ ok: true }) },
      ),
    ).rejects.toThrow(CLOUDFLARE_TOKEN_ENV);
    expect(run.calls.some(([command]) => command === "bun")).toBe(false);
  });

  test("production runs one scoped gate, one upload, and two digest readbacks", async () => {
    const root = fixtureRoot({});
    const run = gitRunner();
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
      { root, run, env: credentials, fetch: servingFetch({}) },
    );
    expect(result.executed).toBe(true);
    expect(result.deploymentUrl).toBe(DEPLOYMENT);
    expect(result.commit).toBe(HEAD);
    expect(result.publicOriginVerified).toBe(SITE_PUBLIC_ORIGIN);
    const gates = run.calls.filter(([command]) => command === "bun");
    expect(gates).toEqual([
      ["bun", "run", "check:site"],
      ["bun", "run", "build:site"],
    ]);
    expect(run.calls.filter(([command]) => command === "wrangler")).toHaveLength(1);
  });

  test("a preview lane publishes a preview branch and skips the public alias", async () => {
    const run = gitRunner({ dirty: true, branch: "feature/site" });
    const result = await runSiteDeploy(
      parseSiteDeployArgs(["--apply", "--environment", "integration", "--execute"]),
      { root: fixtureRoot({}), run, env: credentials, fetch: servingFetch({}) },
    );
    expect(result.executed).toBe(true);
    expect(result.publicOriginVerified).toBe(null);
    const [upload] = run.calls.filter(([command]) => command === "wrangler");
    expect(upload).toContain("--branch");
    expect(upload[upload.indexOf("--branch") + 1]).toBe("preview");
    expect(upload).toContain("--commit-dirty");
  });

  test("halts when the immutable deployment serves other bytes than the upload", async () => {
    const root = fixtureRoot({});
    const run = gitRunner();
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root,
          run,
          env: credentials,
          fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from("other") }),
        },
      ),
    ).rejects.toThrow("the deployment is live and wrong");
  });

  test("halts when the public alias still serves an older deployment", async () => {
    const root = fixtureRoot({});
    const run = gitRunner();
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        {
          root,
          run,
          env: credentials,
          fetch: async (url) => {
            const route = new URL(url).pathname;
            const stale = url.startsWith(SITE_PUBLIC_ORIGIN);
            return {
              ok: true,
              status: 200,
              arrayBuffer: async () => Buffer.from(stale ? "stale" : `bytes for ${route}`),
            };
          },
        },
      ),
    ).rejects.toThrow(SITE_PUBLIC_ORIGIN);
  });

  test("preserves the provider output verbatim when the upload fails", async () => {
    const run = (command, args) => {
      if (command === "wrangler") {
        return { status: 1, stdout: "", stderr: "Authentication error [code: 10000]\n" };
      }
      return gitRunner()(command, args);
    };
    await expect(
      runSiteDeploy(
        parseSiteDeployArgs(["--apply", "--environment", "production", "--execute"]),
        { root: fixtureRoot({}), run, env: credentials, fetch: servingFetch({}) },
      ),
    ).rejects.toThrow("Authentication error [code: 10000]");
  });
});
