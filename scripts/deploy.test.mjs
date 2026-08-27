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
      covers: ["."],
      triggers: ["published-identity"],
    });
    expect(DEPLOY_CONTRACT.surfaces[0].obligations).toHaveProperty("no-overwrite");
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "GOPROXY=direct",
    );
    expect(DEPLOY_CONTRACT.surfaces[0].obligations["post-conditions"]).toContain(
      "fresh temporary Go module",
    );
  });

  test("delegates the current API/Core v1 release unchanged", async () => {
    const calls = [];
    const parsed = parseDeployArgs(["core", "v1.0.0", "--dry-run"]);
    const result = await runDeploy(parsed, {
      runCoreRelease: async (release) => {
        calls.push(release);
        return { delegated: true };
      },
    });

    expect(calls).toEqual([{ version: "v1.0.0", mode: "dry-run" }]);
    expect(result).toEqual({ delegated: true });
  });

  test("fails closed before delegation for the abandoned v0 stream", () => {
    expect(() => parseDeployArgs(["core", "v0.1.0"])).toThrow(
      "current API v1 line",
    );
  });

  test("rejects unknown surfaces and extra contract arguments", () => {
    expect(() => parseDeployArgs(["host", "v1.0.0"])).toThrow("usage:");
    expect(() => parseDeployArgs(["--contract", "core"])).toThrow("usage:");
  });
});
