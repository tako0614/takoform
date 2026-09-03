import { describe, expect, test } from "bun:test";

import { DEPLOY_CONTRACT, parseDeployArgs, runDeploy } from "./deploy.mjs";
import { API_CUTOVER_SURFACE, SITE_SURFACE } from "./site-deploy.mjs";

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
    expect(DEPLOY_CONTRACT.surfaces).toHaveLength(3);
    expect(DEPLOY_CONTRACT.surfaces.map((surface) => surface.surface)).toEqual([
      "core",
      SITE_SURFACE,
      API_CUTOVER_SURFACE,
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

  test("declares the site cutover's consumer identity and irreversible topology hazards", () => {
    const site = DEPLOY_CONTRACT.surfaces.find((surface) => surface.surface === SITE_SURFACE);
    expect(site).toMatchObject({
      target:
      "cloudflare-pages:takoform-site; operator-routed aliases takoform.com,www.takoform.com,forms.takoform.com",
      covers: ["website"],
      requiresScripts: ["check:host-api-freeze", "check:site", "build:site"],
      triggers: [],
    });
    expect(site.requiresTools).toContain("wrangler");
    expect(site.requiresEnv).toEqual([]);
    expect(site.obligations).toHaveProperty("no-overwrite");
    expect(site.obligations).not.toHaveProperty("pre-mutation-proof");
    expect(site.obligations).not.toHaveProperty("independent-review");
  });

  test("uses the standard Wrangler login/profile instead of environment token requirements", () => {
    const site = DEPLOY_CONTRACT.surfaces.find((surface) => surface.surface === SITE_SURFACE);
    expect(site.requiresEnv).toEqual([]);
    const obligations = Object.values(site.obligations).join("\n");
    expect(obligations).toContain("wrangler login");
    expect(obligations).toContain("pages project list --json");
  });

  test("answers the site surface with a gate scoped to the bytes it publishes", () => {
    const site = DEPLOY_CONTRACT.surfaces.find((surface) => surface.surface === SITE_SURFACE);
    expect(site.obligations.provenance).toContain("check:site");
    expect(site.obligations.provenance).toContain("check:host-api-freeze");
    expect(site.obligations.provenance).toContain("credential-free read of the public refs/heads/main");
    expect(site.obligations.provenance).toContain("does not change the fixed Host API v1");
    expect(site.obligations["post-conditions"]).toContain("immutable per-deployment URL");
    expect(site.obligations["post-conditions"]).toContain("https://takoform.com");
    expect(site.obligations["post-conditions"]).toContain("https://www.takoform.com");
    expect(site.obligations["post-conditions"]).toContain("https://forms.takoform.com");
    expect(site.obligations["post-conditions"]).toContain("production deployment history");
    expect(site.obligations.reversal).toContain("forward repair");
    expect(site.obligations["failure-handling"]).toContain("never retries");
    expect(site.obligations["no-overwrite"]).toContain("names no ledger identity");
    const cutover = DEPLOY_CONTRACT.surfaces.find((surface) => surface.surface === API_CUTOVER_SURFACE);
    expect(cutover).toMatchObject({
      surface: API_CUTOVER_SURFACE,
      target:
        "cloudflare-pages:takoform-site; operator-routed aliases takoform.com,www.takoform.com,forms.takoform.com",
      triggers: ["published-identity", "irreversible"],
    });
    expect(cutover.obligations["pre-mutation-proof"]).toContain("31");
    expect(cutover.obligations["pre-mutation-proof"]).toContain("17");
    expect(cutover.obligations["pre-mutation-proof"]).toContain("immediately before");
    expect(cutover.obligations["independent-review"]).toContain("--review");
    expect(cutover.obligations["post-conditions"]).toContain("https://www.takoform.com");
    expect(cutover.obligations["failure-handling"]).toContain("unavailable Pages domain ownership");
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

  test("delegates the upload-free API cutover verifier", async () => {
    const calls = [];
    const deploymentUrl = "https://1a2b3c4d.takoform-site.pages.dev";
    const result = await runDeploy(
      parseDeployArgs([API_CUTOVER_SURFACE, "--verify-cutover", "--deployment-url", deploymentUrl]),
      {
        runSiteDeploy: async (site) => {
          calls.push(site);
          return { delegated: "cutover-verification" };
        },
      },
    );
    expect(calls).toEqual([{ mode: "verify-cutover", deploymentUrl }]);
    expect(result).toEqual({ delegated: "cutover-verification" });
  });

  test("routine site rejects direct cutover flags and API surface auto-selects initial cutover", () => {
    expect(() =>
      parseDeployArgs([
        SITE_SURFACE,
        "--apply",
        "--environment",
        "production",
        "--initial-cutover",
        "--review",
        "audit_takoform_live_cutover_owner",
      ])
    ).toThrow(API_CUTOVER_SURFACE);
    expect(() =>
      parseDeployArgs([
        SITE_SURFACE,
        "--verify-cutover",
        "--deployment-url",
        "https://1a2b3c4d.takoform-site.pages.dev",
      ])
    ).toThrow(API_CUTOVER_SURFACE);
    expect(
      parseDeployArgs([
        API_CUTOVER_SURFACE,
        "--apply",
        "--environment",
        "production",
        "--review",
        "audit_takoform_live_cutover_owner",
      ]),
    ).toMatchObject({
      mode: "site",
      surface: API_CUTOVER_SURFACE,
      site: { mode: "apply", initialCutover: true, review: "audit_takoform_live_cutover_owner" },
    });
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
