#!/usr/bin/env bun

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseCoreReleaseArgs, runCoreRelease } from "./core-release.mjs";
import {
  CLOUDFLARE_ACCOUNT_ENV,
  CLOUDFLARE_TOKEN_ENV,
  SITE_ENVIRONMENTS,
  SITE_PROJECT,
  SITE_SURFACE,
  parseSiteDeployArgs,
  runSiteDeploy,
} from "./site-deploy.mjs";

const SURFACE = "core";
const USAGE = [
  "usage: bun run deploy -- --contract",
  "       bun run deploy -- core v1.MINOR.PATCH [--dry-run|--verify]",
  `       bun run deploy -- ${SITE_SURFACE} --status`,
  `       bun run deploy -- ${SITE_SURFACE} --apply --environment <${SITE_ENVIRONMENTS.join("|")}> [--branch <name>] [--execute]`,
].join("\n");

export const DEPLOY_CONTRACT = Object.freeze({
  kind: "takos.deploy-contract@v2",
  surfaces: Object.freeze([
    Object.freeze({
      surface: SURFACE,
      target:
        "go-module+git-tag+github-release:github.com/tako0614/takoform@v1.MINOR.PATCH",
      covers: Object.freeze(["."]),
      requiresScripts: Object.freeze(["check"]),
      requiresTools: Object.freeze(["git", "bun", "node", "go", "gofmt", "gh"]),
      requiresEnv: Object.freeze([]),
      triggers: Object.freeze(["published-identity"]),
      obligations: Object.freeze({
        provenance:
          "publishes one Core software/module artifact while the Host API remains forms.takoform.com/v1 (there is no Host API v1.1); refuses a dirty worktree or wrong module/origin; requires new tag creation HEAD to equal credential-free public refs/heads/main before and after the owner gate; and permits Release-only reconciliation solely from clean HEAD equal to the existing exact public tag",
        "post-conditions":
          "binds publication verification and public readback to the expected candidate commit; reads the public Git tag and version-specific exact-title, non-draft, non-prerelease GitHub Release back; then writes an exact require in a fresh temporary Go module, runs go mod tidy with GOPROXY=https://proxy.golang.org,direct and fresh sibling caches, confirms the exact resolved module, and tests representative public Core packages before removing all temporary state",
        reversal:
          "the tag and GitHub Release are immutable consumer identities and are not rolled back in place; a bad publication is repaired only with a later compatible version",
        "failure-handling":
          "preserves command diagnostics, refuses failed or indeterminate readback, never overwrites or blindly retries, and can reconcile an exact tag whose matching Release is proven absent before and after the owner gate even after public main advances",
        "no-overwrite":
          "reads the exact public tag before evaluating main, re-reads the action-specific tag/main state and Release absence after the owner gate, rejects any changed or conflicting tag and any existing Release, and uses only ordinary create operations without force, edit, delete, or retag paths",
      }),
    }),
    // Two failure modes, two surfaces. The Core release above mints an
    // identity a consumer resolves forever; this one replaces reversible
    // static bytes. Folding them together would drag a module publication's
    // controls onto a typo fix and, worse, make the typo fix look like the
    // safer half of a procedure that mints a tag.
    Object.freeze({
      surface: SITE_SURFACE,
      target: `takoform.com -> cloudflare-pages:${SITE_PROJECT}`,
      covers: Object.freeze(["website"]),
      requiresScripts: Object.freeze(["check:site", "build:site"]),
      requiresTools: Object.freeze(["git", "bun", "node", "wrangler"]),
      requiresEnv: Object.freeze([CLOUDFLARE_TOKEN_ENV, CLOUDFLARE_ACCOUNT_ENV]),
      // Routine static bytes. The published schema bytes are a consumer-pinned
      // identity, but the append-only ledger and the site gate mint them, not
      // this upload, so the no-overwrite answer below is volunteered, not owed.
      triggers: Object.freeze([]),
      obligations: Object.freeze({
        provenance:
          "runs one scoped gate over the bytes it publishes and nothing else: bun run check:site re-derives every generated page and every served schema byte from this repository's own contracts, then bun run build:site rebuilds and re-verifies website/.vitepress/dist so the uploaded tree is the tree just proved. production additionally refuses a dirty worktree and any HEAD that is not a credential-free read of the public refs/heads/main, and records that commit, the sha256 tree digest of the built output, and the immutable deployment URL on stdout; integration and rehearsal allow a dirty worktree and publish a preview branch that is never main",
        "post-conditions":
          "reads back the exact bytes rather than a status code: after the single upload it fetches the landing page, sitemap, and two published schema $id paths from the immutable per-deployment URL and compares each sha256 against the locally built file; it also requires retired site-status, Form-catalog, release, and decision routes to return 404 or 410. Production repeats both positive and negative readbacks against https://takoform.com so a stale alias cannot pass as a live publication",
        reversal:
          `the provider keeps every previous deployment; roll back by promoting the previous production deployment of the ${SITE_PROJECT} project from that history. The published schema bytes are byte-identical to the spec/schemas sources an append-only ledger pins, so an older deployment still serves every already-minted $id`,
        "failure-handling":
          `refuses before touching the target on a missing or unknown environment, an unset ${CLOUDFLARE_TOKEN_ENV} or ${CLOUDFLARE_ACCOUNT_ENV}, an unreadable public ref, a dirty or non-main production source, or a failed scoped gate, and says so in those words. An upload that fails prints the provider output verbatim, states that the target may or may not have changed, and never retries. A finished upload that prints no single immutable deployment URL, and any readback whose digests differ, halt and direct the operator to the provider deployment history instead of guessing`,
        "no-overwrite":
          "a served schema path only ever carries the bytes its ledger entry digests, and bun run check:site fails if a published path drifts from its normative source or if the built tree serves any file under /schemas/ that names no ledger identity, so republishing cannot change an already-minted $id in place",
      }),
    }),
  ]),
});

export function parseDeployArgs(args) {
  if (args.length === 1 && args[0] === "--contract") {
    return Object.freeze({ mode: "contract" });
  }
  if (args[0] === SITE_SURFACE) {
    return Object.freeze({
      mode: "site",
      surface: SITE_SURFACE,
      site: parseSiteDeployArgs(args.slice(1)),
    });
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
  if (parsed.mode === "site") {
    const site = options.runSiteDeploy ?? runSiteDeploy;
    return site(parsed.site, options.siteDeployOptions);
  }
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
