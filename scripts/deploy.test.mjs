import { describe, expect, test } from "bun:test";

import { DEPLOY_CONTRACT, parseDeployArgs, runDeploy } from "./deploy.mjs";

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
    expect(DEPLOY_CONTRACT.surfaces).toHaveLength(1);
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

  test("rejects unknown surfaces and extra contract arguments", () => {
    expect(() => parseDeployArgs(["host", "v1.0.0"])).toThrow("usage:");
    expect(() => parseDeployArgs(["--contract", "core"])).toThrow("usage:");
  });
});
