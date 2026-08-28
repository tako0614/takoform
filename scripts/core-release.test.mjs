import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
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
const OTHER_COMMIT = "fedcba9876543210fedcba9876543210fedcba98";
const VERSION = "v1.1.0";

function releaseBody(version, overrides = {}) {
  return JSON.stringify({
    tag_name: version,
    name: `Takoform Core ${version}`,
    draft: false,
    prerelease: false,
    html_url: `https://github.com/${CORE_RELEASE.githubRepository}/releases/tag/${version}`,
    tarball_url: `${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/tarball/${version}`,
    zipball_url: `${CORE_RELEASE.githubApi}/repos/${CORE_RELEASE.githubRepository}/zipball/${version}`,
    ...overrides,
  });
}

function fixture({
  published = false,
  tag = published,
  tagCommit = COMMIT,
  tagReadbacks,
  headCommit = COMMIT,
  mainCommits = [COMMIT],
  version = VERSION,
  releaseTitle = `Takoform Core ${version}`,
} = {}) {
  const calls = [];
  let tagCreated = tag;
  let releaseCreated = published;
  let mainRead = 0;
  let tagRead = 0;
  const releaseRequests = [];
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
      return { status: 0, stdout: `${headCommit}\n`, stderr: "" };
    }
    if (
      command === "git" &&
      args.join(" ") === `ls-remote --heads ${CORE_RELEASE.publicOrigin} refs/heads/main`
    ) {
      const mainCommit = mainCommits[Math.min(mainRead, mainCommits.length - 1)];
      mainRead += 1;
      return {
        status: 0,
        stdout: `${mainCommit}\trefs/heads/main\n`,
        stderr: "",
      };
    }
    if (command === "git" && args[0] === "ls-remote" && args[1] === "--tags") {
      const version = args[3].slice("refs/tags/".length);
      let readback = tagCreated ? tagCommit : null;
      if (tagReadbacks !== undefined) {
        readback = tagReadbacks[Math.min(tagRead, tagReadbacks.length - 1)];
      }
      tagRead += 1;
      return {
        status: 0,
        stdout: readback === null ? "" : `${readback}\trefs/tags/${version}\n`,
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
    if (command === "go" && args.join(" ") === "mod tidy") {
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "go" && args[0] === "list") {
      return { status: 0, stdout: `${CORE_RELEASE.module}@${version}\n`, stderr: "" };
    }
    if (command === "go" && args[0] === "test") {
      return { status: 0, stdout: "ok\n", stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  const request = async () => {
    releaseRequests.push(releaseCreated);
    return {
      status: releaseCreated ? 200 : 404,
      body: releaseCreated ? releaseBody(version, { name: releaseTitle }) : "Not Found",
    };
  };
  return { calls, releaseRequests, run, request };
}

describe("minimal Core release", () => {
  test("accepts only the current Core module v1 release line", () => {
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
      await runCoreRelease(parseCoreReleaseArgs([VERSION, "--dry-run"]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).toEqual({
      mode: "dry-run",
      version: VERSION,
      commit: COMMIT,
      publicMainCommit: COMMIT,
      publicMainMatchesHead: true,
      publicationAction: "create",
      tag: "missing",
      gatePassed: true,
      publishReady: true,
    });
    expect(f.calls.filter((call) => call.command === "bun").map((call) => call.args)).toEqual([["run", "check"]]);
    expect(f.calls.some((call) => call.command === "gh")).toBe(false);
    expect(f.calls.some((call) => ["tag", "push"].includes(call.args[0]))).toBe(false);
  });

  test("dry-run reports a reviewed branch that is not public main without publishing", async () => {
    const f = fixture({ mainCommits: [OTHER_COMMIT] });
    expect(
      await runCoreRelease(parseCoreReleaseArgs([VERSION, "--dry-run"]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).toEqual({
      mode: "dry-run",
      version: VERSION,
      commit: COMMIT,
      publicMainCommit: OTHER_COMMIT,
      publicMainMatchesHead: false,
      publicationAction: "create",
      tag: "missing",
      gatePassed: true,
      publishReady: false,
    });
    expect(f.calls.some((call) => call.command === "gh" || call.args[0] === "push")).toBe(false);
  });

  test("dry-run identifies an exact existing-tag reconciliation as publish-ready after main advances", async () => {
    const f = fixture({ tag: true, mainCommits: [OTHER_COMMIT] });
    expect(
      await runCoreRelease(parseCoreReleaseArgs([VERSION, "--dry-run"]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).toEqual({
      mode: "dry-run",
      version: VERSION,
      commit: COMMIT,
      publicMainCommit: OTHER_COMMIT,
      publicMainMatchesHead: false,
      publicationAction: "reconcile-existing-tag",
      tag: "existing-exact",
      gatePassed: true,
      publishReady: true,
    });
    expect(f.calls.some((call) => call.command === "gh" || call.args[0] === "push")).toBe(false);
  });

  test("reads public main and tags without repository or credential configuration", async () => {
    const f = fixture();
    await runCoreRelease(parseCoreReleaseArgs([VERSION, "--dry-run"]), {
      root: ROOT,
      run: f.run,
      request: f.request,
    });

    const publicReads = f.calls.filter(
      (call) => call.command === "git" && call.args[0] === "ls-remote",
    );
    expect(publicReads).toHaveLength(2);
    expect(publicReads.map((call) => call.args[1])).toEqual(["--tags", "--heads"]);
    for (const call of publicReads) {
      expect(call.args).toContain(CORE_RELEASE.publicOrigin);
      expect(call.options.cwd).not.toBe(ROOT);
      expect(call.options.env.GIT_CONFIG_COUNT).toBe("0");
      expect(call.options.env.GIT_CONFIG_NOSYSTEM).toBe("1");
      expect(call.options.env.GIT_TERMINAL_PROMPT).toBe("0");
      expect(call.options.env.GH_TOKEN).toBeUndefined();
      expect(call.options.env.GITHUB_TOKEN).toBeUndefined();
    }
  });

  test("publishes through one create-only GitHub Release call and verifies public readback", async () => {
    const f = fixture();
    const result = await runCoreRelease(parseCoreReleaseArgs([VERSION]), {
      root: ROOT,
      run: f.run,
      request: f.request,
    });
    expect(result).toEqual({
      mode: "verify",
      version: VERSION,
      expectedCommit: COMMIT,
      tagCommit: COMMIT,
      goModule: `github.com/tako0614/takoform@${VERSION}`,
      releaseURL: `https://github.com/tako0614/takoform/releases/tag/${VERSION}`,
      sourceTarballURL: `https://api.github.com/repos/tako0614/takoform/tarball/${VERSION}`,
      sourceZipballURL: `https://api.github.com/repos/tako0614/takoform/zipball/${VERSION}`,
    });
    const ghCalls = f.calls.filter((call) => call.command === "gh");
    expect(ghCalls).toHaveLength(1);
    expect(ghCalls[0].args).toEqual([
      "release",
      "create",
      VERSION,
      "--repo",
      "tako0614/takoform",
      "--title",
      "Takoform Core v1.1.0",
      "--generate-notes",
      "--verify-tag",
    ]);
    expect(ghCalls[0].args.some((arg) => /(?:edit|delete|upload|force)/u.test(arg))).toBe(false);
    expect(
      f.calls.filter((call) => call.command === "git" && call.args[0] === "push").map((call) => call.args),
    ).toEqual([["push", "origin", `${COMMIT}:refs/tags/${VERSION}`]]);
  });

  test("publish refuses a commit that is not credential-free public main before the gate", async () => {
    const f = fixture({ mainCommits: [OTHER_COMMIT] });
    await expect(
      runCoreRelease(parseCoreReleaseArgs([VERSION]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("public refs/heads/main");
    expect(
      f.calls.some(
        (call) => call.command === "bun" || call.command === "gh" || call.args[0] === "push",
      ),
    ).toBe(false);
  });

  test("publish rechecks public main after the owner gate", async () => {
    const f = fixture({ mainCommits: [COMMIT, OTHER_COMMIT] });
    await expect(
      runCoreRelease(parseCoreReleaseArgs([VERSION]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("public refs/heads/main changed");
    expect(f.calls.filter((call) => call.command === "bun")).toHaveLength(1);
    expect(f.calls.some((call) => call.command === "gh" || call.args[0] === "push")).toBe(false);
  });

  test("refuses an existing public tag before the gate or publication", async () => {
    const f = fixture({ published: true });
    await expect(
      runCoreRelease(parseCoreReleaseArgs([VERSION, "--dry-run"]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("never overwritten");
    expect(f.calls.some((call) => call.command === "bun" || call.command === "gh")).toBe(false);
  });

  test("reconciles a missing Release from the tagged commit after public main advances", async () => {
    const f = fixture({ tag: true, mainCommits: [OTHER_COMMIT] });
    const result = await runCoreRelease(parseCoreReleaseArgs([VERSION]), {
      root: ROOT,
      run: f.run,
      request: f.request,
    });
    expect(result.tagCommit).toBe(COMMIT);
    expect(f.calls.some((call) => call.command === "git" && call.args[0] === "push")).toBe(false);
    expect(f.calls.filter((call) => call.command === "gh")).toHaveLength(1);
    expect(f.releaseRequests).toEqual([false, false, true]);
    expect(
      f.calls.filter(
        (call) =>
          call.command === "git" &&
          call.args.join(" ") ===
            `ls-remote --heads ${CORE_RELEASE.publicOrigin} refs/heads/main`,
      ),
    ).toHaveLength(1);
  });

  test("newer public main cannot reconcile a tag that names the older candidate", async () => {
    const f = fixture({
      tag: true,
      tagCommit: COMMIT,
      headCommit: OTHER_COMMIT,
      mainCommits: [OTHER_COMMIT],
    });
    await expect(
      runCoreRelease(parseCoreReleaseArgs([VERSION]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("already names another commit");
    expect(f.calls.some((call) => call.command === "bun" || call.command === "gh")).toBe(false);
    expect(
      f.calls.some(
        (call) => call.command === "git" && call.args.includes("refs/heads/main"),
      ),
    ).toBe(false);
  });

  test("reconciliation refuses if the exact public tag changes after the gate", async () => {
    const f = fixture({
      tag: true,
      tagReadbacks: [COMMIT, OTHER_COMMIT],
      mainCommits: [OTHER_COMMIT],
    });
    await expect(
      runCoreRelease(parseCoreReleaseArgs([VERSION]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("changed after the owner gate");
    expect(f.calls.some((call) => call.command === "git" && call.args[0] === "push")).toBe(false);
    expect(f.calls.some((call) => call.command === "gh")).toBe(false);
  });

  test("reconciliation never recreates a public tag that disappears after the gate", async () => {
    const f = fixture({
      tag: true,
      tagReadbacks: [COMMIT, null],
      mainCommits: [OTHER_COMMIT],
    });
    await expect(
      runCoreRelease(parseCoreReleaseArgs([VERSION]), {
        root: ROOT,
        run: f.run,
        request: f.request,
      }),
    ).rejects.toThrow("changed after the owner gate");
    expect(f.calls.some((call) => call.command === "git" && call.args[0] === "push")).toBe(false);
    expect(f.calls.some((call) => call.command === "gh")).toBe(false);
  });

  test("refuses an occupied tag that points anywhere else", async () => {
    const f = fixture({
      tag: true,
      tagCommit: OTHER_COMMIT,
    });
    await expect(
      runCoreRelease(parseCoreReleaseArgs([VERSION, "--dry-run"]), {
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
          stdout: `${tagObject}\trefs/tags/${VERSION}\n${COMMIT}\trefs/tags/${VERSION}^{}\n`,
          stderr: "",
        };
      }
      return defaultFixtureRun(command, args, options);
    };
    const result = await verifyCoreRelease(VERSION, { root: ROOT, run: f.run, request: f.request });
    expect(result.tagCommit).toBe(COMMIT);
    expect(result).not.toHaveProperty("expectedCommit");
    expect(f.calls.some((call) => call.command === "bun" || call.command === "gh")).toBe(false);
  });

  test("verify compiles the exact public module in an isolated fresh consumer and removes it", async () => {
    const f = fixture({ published: true });
    let consumerGoMod;
    const defaultFixtureRun = f.run;
    f.run = (command, args, options = {}) => {
      if (command === "go" && args.join(" ") === "mod tidy") {
        consumerGoMod = readFileSync(resolve(options.cwd, "go.mod"), "utf8");
      }
      return defaultFixtureRun(command, args, options);
    };
    await verifyCoreRelease(VERSION, { root: ROOT, run: f.run, request: f.request });

    const goCalls = f.calls.filter((call) => call.command === "go");
    expect(goCalls.map((call) => call.args)).toEqual([
      ["mod", "tidy"],
      ["list", "-m", "-f", "{{.Path}}@{{.Version}}", CORE_RELEASE.module],
      ["test", "./..."],
    ]);
    const consumerRoot = goCalls[0].options.cwd;
    const temporaryRoot = dirname(consumerRoot);
    expect(consumerRoot).toBe(resolve(temporaryRoot, "consumer"));
    expect(consumerGoMod).toBe(
      `module takoform.release/consumer\n\ngo 1.25.8\n\nrequire ${CORE_RELEASE.module} ${VERSION}\n`,
    );
    expect(goCalls.every((call) => call.options.cwd === consumerRoot)).toBe(true);
    expect(goCalls.every((call) => call.options.env.GOPROXY === "https://proxy.golang.org,direct")).toBe(true);
    expect(goCalls.every((call) => call.options.env.GOSUMDB === "sum.golang.org")).toBe(true);
    expect(goCalls.every((call) => call.options.env.GOWORK === "off")).toBe(true);
    expect(goCalls.every((call) => call.options.env.GOMODCACHE === resolve(temporaryRoot, "gomodcache"))).toBe(true);
    expect(goCalls.every((call) => call.options.env.GOCACHE === resolve(temporaryRoot, "gocache"))).toBe(true);
    expect(goCalls.every((call) => call.options.env.GOPATH === resolve(temporaryRoot, "gopath"))).toBe(true);
    expect(existsSync(temporaryRoot)).toBe(false);
  });

  test("verify preserves consumer diagnostics and removes temporary state on failure", async () => {
    const f = fixture({ published: true });
    const defaultFixtureRun = f.run;
    f.run = (command, args, options = {}) => {
      if (command === "go" && args[0] === "test") {
        f.calls.push({ command, args: [...args], options: { ...options } });
        return { status: 1, stdout: "", stderr: "public consumer compile failed\n" };
      }
      return defaultFixtureRun(command, args, options);
    };

    await expect(
      verifyCoreRelease(VERSION, { root: ROOT, run: f.run, request: f.request }),
    ).rejects.toThrow("public consumer compile failed");
    const temporaryRoot = dirname(f.calls.find((call) => call.command === "go").options.cwd);
    expect(existsSync(temporaryRoot)).toBe(false);
  });

  test("verify rejects a consumer resolution that is not the exact requested module", async () => {
    const f = fixture({ published: true });
    const defaultFixtureRun = f.run;
    f.run = (command, args, options = {}) => {
      if (command === "go" && args[0] === "list") {
        f.calls.push({ command, args: [...args], options: { ...options } });
        return { status: 0, stdout: `${CORE_RELEASE.module}@v1.0.1\n`, stderr: "" };
      }
      return defaultFixtureRun(command, args, options);
    };

    await expect(
      verifyCoreRelease(VERSION, { root: ROOT, run: f.run, request: f.request }),
    ).rejects.toThrow(
      `fresh public consumer resolved ${CORE_RELEASE.module}@v1.0.1; want ${CORE_RELEASE.module}@${VERSION}`,
    );
    expect(f.calls.some((call) => call.command === "go" && call.args[0] === "test")).toBe(false);
    const temporaryRoot = dirname(f.calls.find((call) => call.command === "go").options.cwd);
    expect(existsSync(temporaryRoot)).toBe(false);
  });

  test("the internal release helper has no direct CLI", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(ROOT, "scripts/core-release.mjs"), "--must-remain-import-only"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  test("verify rejects draft releases and missing source archive readback", async () => {
    const f = fixture({ published: true });
    for (const overrides of [{ draft: true }, { tarball_url: null }, { zipball_url: null }]) {
      const request = async () => ({ status: 200, body: releaseBody(VERSION, overrides) });
      await expect(verifyCoreRelease(VERSION, { root: ROOT, run: f.run, request })).rejects.toThrow(
        "not one stable Core source release",
      );
    }
  });

  test("verify binds public tag readback to an explicit expected commit", async () => {
    const f = fixture({ published: true, tagCommit: OTHER_COMMIT });
    await expect(
      verifyCoreRelease(VERSION, {
        root: ROOT,
        run: f.run,
        request: f.request,
        expectedCommit: COMMIT,
      }),
    ).rejects.toThrow("does not point to expected commit");
    expect(f.calls.some((call) => call.command === "go")).toBe(false);
  });

  test("standalone verify remains valid from a newer local HEAD", async () => {
    const f = fixture({ published: true, headCommit: OTHER_COMMIT });
    const result = await verifyCoreRelease(VERSION, {
      root: ROOT,
      run: f.run,
      request: f.request,
    });
    expect(result.tagCommit).toBe(COMMIT);
    expect(result).not.toHaveProperty("expectedCommit");
  });

  test.each([
    ["v1.0.0", "Takoform API 1.0.0"],
    ["v1.0.1", "Takoform API 1.0.1"],
  ])("verify preserves the immutable historical title for %s", async (version, releaseTitle) => {
    const f = fixture({ published: true, version, releaseTitle });
    const result = await verifyCoreRelease(version, {
      root: ROOT,
      run: f.run,
      request: f.request,
    });
    expect(result).toMatchObject({
      version,
      tagCommit: COMMIT,
      goModule: `${CORE_RELEASE.module}@${version}`,
      releaseURL: `https://github.com/${CORE_RELEASE.githubRepository}/releases/tag/${version}`,
    });
  });

  test("verify rejects a GitHub Release with any other title", async () => {
    const f = fixture({ published: true });
    const request = async () => ({
      status: 200,
      body: releaseBody(VERSION, { name: "Takoform API 1.1.0" }),
    });
    await expect(verifyCoreRelease(VERSION, { root: ROOT, run: f.run, request })).rejects.toThrow(
      "not one stable Core source release",
    );
  });
});
