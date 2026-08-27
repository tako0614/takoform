import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CORE_RELEASE,
  parseCoreReleaseArgs,
  runCoreRelease,
  verifyCoreRelease,
} from "./core-release.mjs";

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function releaseBody(version, overrides = {}) {
  return JSON.stringify({
    tag_name: version,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/${CORE_RELEASE.githubRepository}/releases/tag/${version}`,
    tarball_url: `${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/tarball/${version}`,
    zipball_url: `${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/zipball/${version}`,
    ...overrides,
  });
}

function fixture({ published = false, tag = published, tagCommit = COMMIT } = {}) {
  const calls = [];
  let tagCreated = tag;
  let releaseCreated = published;
  const run = (command, args, options = {}) => {
    calls.push({ command, args: [...args], options: { ...options } });
    if (command === "git" && args.join(" ") === "rev-parse --show-toplevel") {
      return { status: 0, stdout: `${ROOT}\n`, stderr: "" };
    }
    if (command === "git" && args.join(" ") === "remote get-url origin") {
      return { status: 0, stdout: "https://github.com/tako0614/takoform.git\n", stderr: "" };
    }
    if (command === "git" && args[0] === "status") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "git" && args.join(" ") === "rev-parse HEAD") {
      return { status: 0, stdout: `${COMMIT}\n`, stderr: "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      const version = args[3].slice("refs/tags/".length);
      return {
        status: 0,
        stdout: tagCreated ? `${tagCommit}\trefs/tags/${version}\n` : "",
        stderr: "",
      };
    }
    if (command === "git" && args[0] === "push") {
      tagCreated = true;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "bun" && args.join(" ") === "run check") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "gh" && args[0] === "release" && args[1] === "create") {
      if (!tagCreated) throw new Error("test fixture requires the tag before release creation");
      releaseCreated = true;
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  const request = async () => ({
    status: releaseCreated ? 200 : 404,
    body: releaseCreated ? releaseBody("v1.0.0") : "Not Found",
  });
  return { calls, run, request };
}

describe("minimal Core release", () => {
  test("accepts only the API and Go module v1 release line", () => {
    expect(parseCoreReleaseArgs(["v1.0.0"])).toEqual({ version: "v1.0.0", mode: "publish" });
    expect(parseCoreReleaseArgs(["v1.2.3", "--dry-run"])).toEqual({ version: "v1.2.3", mode: "dry-run" });
    expect(parseCoreReleaseArgs(["v1.2.3", "--verify"])).toEqual({ version: "v1.2.3", mode: "verify" });
    for (const args of [[], ["1.0.0"], ["v0.1.0"], ["v2.0.0"], ["v01.0.0"], ["v1.0.0-rc.1"], ["v1.0.0", "--force"], ["v1.0.0", "--verify", "extra"]]) {
      expect(() => parseCoreReleaseArgs(args)).toThrow();
    }
  });

  test("dry-run is read-only and runs the complete portable gate", async () => {
    const f = fixture();
    expect(
      await runCoreRelease(parseCoreReleaseArgs(["v1.0.0", "--dry-run"]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).toEqual({ mode: "dry-run", version: "v1.0.0", commit: COMMIT, tag: "missing", ready: true });
    expect(f.calls.filter((call) => call.command === "bun").map((call) => call.args)).toEqual([["run", "check"]]);
    expect(f.calls.some((call) => call.command === "gh")).toBe(false);
    expect(f.calls.some((call) => ["tag", "push"].includes(call.args[0]))).toBe(false);
  });

  test("publishes through one create-only GitHub Release call and verifies public readback", async () => {
    const f = fixture();
    const result = await runCoreRelease(parseCoreReleaseArgs(["v1.0.0"]), {
      root: ROOT,
      run: f.run,
      request: f.request,
    });
    expect(result).toEqual({
      mode: "verify",
      version: "v1.0.0",
      tagCommit: COMMIT,
      releaseURL: "https://github.com/tako0614/takoform/releases/tag/v1.0.0",
      sourceTarballURL: "https://api.github.com/repos/tako0614/takoform/tarball/v1.0.0",
      sourceZipballURL: "https://api.github.com/repos/tako0614/takoform/zipball/v1.0.0",
    });
    const ghCalls = f.calls.filter((call) => call.command === "gh");
    expect(ghCalls).toHaveLength(1);
    expect(ghCalls[0].args).toEqual([
      "release",
      "create",
      "v1.0.0",
      "--repo",
      "tako0614/takoform",
      "--title",
      "Takoform API 1.0.0",
      "--generate-notes",
      "--verify-tag",
    ]);
    expect(ghCalls[0].args.some((arg) => /(?:edit|delete|upload|force)/u.test(arg))).toBe(false);
    expect(
      f.calls.filter((call) => call.command === "git" && call.args[0] === "push").map((call) => call.args),
    ).toEqual([["push", "origin", `${COMMIT}:refs/tags/v1.0.0`]]);
  });

  test("refuses an existing public tag before the gate or publication", async () => {
    const f = fixture({ published: true });
    await expect(
      runCoreRelease(parseCoreReleaseArgs(["v1.0.0", "--dry-run"]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("never overwritten");
    expect(f.calls.some((call) => call.command === "bun" || call.command === "gh")).toBe(false);
  });

  test("completes a missing Release for an exact existing tag without pushing it again", async () => {
    const f = fixture({ tag: true });
    const result = await runCoreRelease(parseCoreReleaseArgs(["v1.0.0"]), {
      root: ROOT,
      run: f.run,
      request: f.request,
    });
    expect(result.tagCommit).toBe(COMMIT);
    expect(f.calls.some((call) => call.command === "git" && call.args[0] === "push")).toBe(false);
    expect(f.calls.filter((call) => call.command === "gh")).toHaveLength(1);
  });

  test("refuses an occupied tag that points anywhere else", async () => {
    const f = fixture({
      tag: true,
      tagCommit: "fedcba9876543210fedcba9876543210fedcba98",
    });
    await expect(
      runCoreRelease(parseCoreReleaseArgs(["v1.0.0", "--dry-run"]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("another commit");
    expect(f.calls.some((call) => call.command === "bun" || call.command === "gh")).toBe(false);
  });

  test("verify is read-only and accepts an annotated tag's peeled commit", async () => {
    const f = fixture({ published: true });
    const tagObject = "fedcba9876543210fedcba9876543210fedcba98";
    const defaultFixtureRun = f.run;
    f.run = (command, args, options = {}) => {
      if (command === "git" && args[0] === "ls-remote") {
        f.calls.push({ command, args: [...args], options: { ...options } });
        return {
          status: 0,
          stdout: `${tagObject}\trefs/tags/v1.0.0\n${COMMIT}\trefs/tags/v1.0.0^{}\n`,
          stderr: "",
        };
      }
      return defaultFixtureRun(command, args, options);
    };
    const result = await verifyCoreRelease("v1.0.0", { root: ROOT, run: f.run, request: f.request });
    expect(result.tagCommit).toBe(COMMIT);
    expect(f.calls.some((call) => call.command === "bun" || call.command === "gh")).toBe(false);
  });

  test("verify rejects draft releases and missing source archive readback", async () => {
    const f = fixture({ published: true });
    for (const overrides of [{ draft: true }, { tarball_url: null }, { zipball_url: null }]) {
      const request = async () => ({ status: 200, body: releaseBody("v1.0.0", overrides) });
      await expect(verifyCoreRelease("v1.0.0", { root: ROOT, run: f.run, request })).rejects.toThrow(
        "not one stable source release",
      );
    }
  });
});
