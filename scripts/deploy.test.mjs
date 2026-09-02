import { describe, expect, test } from "bun:test";

import { DEPLOY_CONTRACT, parseDeployArgs, runDeploy } from "./deploy.mjs";
import {
  CLOUDFLARE_ACCOUNT_ENV,
  CLOUDFLARE_TOKEN_ENV,
  SITE_SURFACE,
} from "./site-deploy.mjs";

describe("Takoform deploy entrypoint", () => {
  test("answers the v2 contract without invoking the release implementation", async () => {
    let invoked = false;
    const result = await runDeploy(parseDeployArgs(["--contract"]), {
      runCoreRelease: async () => {
        invoked = true;
        throw new Error("release implementation must remain untouched");
      },
    });

    expect(result).toBe(DEPLOY_CONTRACT);
    expect(invoked).toBe(false);
    expect(DEPLOY_CONTRACT.surfaces).toHaveLength(2);
    expect(DEPLOY_CONTRACT.surfaces.map((surface) => surface.surface)).toEqual([
      "core",
      SITE_SURFACE,
    ]);
    expect(DEPLOY_CONTRACT.surfaces[0]).toMatchObject({
      surface: "core",
      target:
        "go-module+git-tag+github-release:github.com/tako0614/takoform@v1.MINOR.PATCH",
      covers: ["."],
      triggers: ["published-identity"],
    });
    expect(DEPLOY_CONTRACT.surfaces[0].obligations).toHaveProperty("no-overwrite");
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "GOPROXY=https://proxy.golang.org,direct",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "fresh temporary Go module",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "exact require",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "go mod tidy",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "sibling caches",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations.provenance).toContain(
      "credential-free public refs/heads/main",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations.provenance).toContain(
      "new tag creation",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations.provenance).toContain(
      "clean HEAD equal to the existing exact public tag",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations.provenance).toContain(
      "Core software/module artifact",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations.provenance).toContain(
      "forms.takoform.com/v1",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "expected candidate commit",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "version-specific exact-title",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["failure-handling"]).toContain(
      "after public main advances",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["no-overwrite"]).toContain(
      "reads the exact public tag before evaluating main",
    );
  });

  test("delegates the current Core module v1 artifact release unchanged", async () => {
    const calls = [];
    const parsed = parseDeployArgs(["core", "v1.1.0", "--dry-run"]);
    const result = await runDeploy(parsed, {
      runCoreRelease: async (release) => {
        calls.push(release);
        return { delegated: true };
      },
    });

    expect(calls).toEqual([{ version: "v1.1.0", mode: "dry-run" }]);
    expect(result).toEqual({ delegated: true });
  });

  test("fails closed before delegation for the abandoned v0 stream", () => {
    expect(() => parseDeployArgs(["core", "v0.1.0"])).toThrow(
      "current v1 line",
    );
  });

  test("keeps the site surface in the routine static lane, separate from the release", () => {
    const site = DEPLOY_CONTRACT.surfaces.find((surface) => surface.surface === SITE_SURFACE);
    expect(site).toMatchObject({
      target: "takoform.com -> cloudflare-pages:takoform-site",
      covers: ["website"],
      requiresScripts: ["check:site", "build:site"],
      triggers: [],
    });
    expect(site.requiresTools).toContain("wrangler");
    expect(site.requiresEnv).toEqual([CLOUDFLARE_TOKEN_ENV, CLOUDFLARE_ACCOUNT_ENV]);
  });

  test("lets an operator discover every variable the site surface requires", () => {
    const site = DEPLOY_CONTRACT.surfaces.find((surface) => surface.surface === SITE_SURFACE);
    const answers = Object.values(site.obligations).join("\n");
    for (const variable of site.requiresEnv) expect(answers).toContain(variable);
  });

  test("answers the site surface with a gate scoped to the bytes it publishes", () => {
    const site = DEPLOY_CONTRACT.surfaces.find((surface) => surface.surface === SITE_SURFACE);
    expect(site.obligations.provenance).toContain("check:site");
    expect(site.obligations.provenance).toContain("credential-free read of the public refs/heads/main");
    expect(site.obligations["post-conditions"]).toContain("immutable per-deployment URL");
    expect(site.obligations["post-conditions"]).toContain("https://takoform.com");
    expect(site.obligations.reversal).toContain("previous production deployment");
    expect(site.obligations["failure-handling"]).toContain("never retries");
    expect(site.obligations["no-overwrite"]).toContain("names no ledger identity");
  });

  test("delegates the site surface without reaching the release implementation", async () => {
    const calls = [];
    const result = await runDeploy(parseDeployArgs([SITE_SURFACE, "--status"]), {
      runSiteDeploy: async (site) => {
        calls.push(site);
        return { delegated: "site" };
      },
      runCoreRelease: async () => {
        throw new Error("the site surface must never reach the Core release");
      },
    });
    expect(calls).toEqual([{ mode: "status" }]);
    expect(result).toEqual({ delegated: "site" });
  });

  test("refuses a site mutation that names no exact environment", () => {
    expect(() => parseDeployArgs([SITE_SURFACE, "--apply"])).toThrow(
      "an exact environment is required",
    );
  });

  test("rejects unknown surfaces and extra contract arguments", () => {
    expect(() => parseDeployArgs(["host", "v1.0.0"])).toThrow("usage:");
    expect(() => parseDeployArgs(["--contract", "core"])).toThrow("usage:");
  });
});
