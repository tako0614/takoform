#!/usr/bin/env bun

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseCoreReleaseArgs, runCoreRelease } from "./core-release.mjs";

const SURFACE = "core";
const USAGE = [
  "usage: bun run deploy -- --contract",
  "       bun run deploy -- core v1.MINOR.PATCH [--dry-run|--verify]",
].join("\n");

export const DEPLOY_CONTRACT = Object.freeze({
  kind: "takos.deploy-contract@v2",
  surfaces: Object.freeze([
    Object.freeze({
      surface: SURFACE,
      target: "git-tag+github-release:tako0614/takoform/v1.MINOR.PATCH",
      covers: Object.freeze(["."]),
      requiresScripts: Object.freeze(["check"]),
      requiresTools: Object.freeze(["git", "bun", "node", "go", "gofmt", "gh"]),
      requiresEnv: Object.freeze([]),
      triggers: Object.freeze(["published-identity"]),
      obligations: Object.freeze({
        provenance:
          "refuses a dirty worktree or wrong module/origin, binds the release to exact HEAD, and runs the complete owner gate before creating either public identity",
        "post-conditions":
          "reads the public Git tag and non-draft, non-prerelease GitHub Release back, then uses GOPROXY=direct with fresh module/build caches in a fresh temporary Go module to resolve the exact released module and test representative public Core packages before removing all temporary state",
        reversal:
          "the tag and GitHub Release are immutable consumer identities and are not rolled back in place; a bad publication is repaired only with a later compatible version",
        "failure-handling":
          "preserves command diagnostics, refuses failed or indeterminate readback, never overwrites or blindly retries, and can reconcile an exact tag whose matching Release is still absent",
        "no-overwrite":
          "checks public tag and Release state before and after the owner gate, rejects any conflicting or existing Release, and uses only ordinary create operations without force, edit, delete, or retag paths",
      }),
    }),
  ]),
});

export function parseDeployArgs(args) {
  if (args.length === 1 && args[0] === "--contract") {
    return Object.freeze({ mode: "contract" });
  }
  if (args[0] !== SURFACE) throw new Error(USAGE);
  return Object.freeze({
    mode: "release",
    surface: SURFACE,
    release: parseCoreReleaseArgs(args.slice(1)),
  });
}

export async function runDeploy(parsed, options = {}) {
  if (parsed.mode === "contract") return DEPLOY_CONTRACT;
  const release = options.runCoreRelease ?? runCoreRelease;
  return release(parsed.release, options.coreReleaseOptions);
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMainModule()) {
  try {
    const parsed = parseDeployArgs(process.argv.slice(2));
    const result = await runDeploy(parsed);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`deploy refused: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
