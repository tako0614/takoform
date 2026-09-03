#!/usr/bin/env bun

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseCoreReleaseArgs, runCoreRelease } from "./core-release.mjs";
import {
  API_CUTOVER_SURFACE,
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
  `       bun run deploy -- ${API_CUTOVER_SURFACE} --status`,
  `       bun run deploy -- ${API_CUTOVER_SURFACE} --apply --environment production --review <non-secret-reference> [--execute]`,
  `       bun run deploy -- ${API_CUTOVER_SURFACE} --verify-cutover --deployment-url <exact-immutable-url>`,
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
    // Routine presentation publication is intentionally separate from the
    // one-time topology/identity cutover below. A typo fix must not inherit
    // the cutover surface's irreversible trigger.
    Object.freeze({
      surface: SITE_SURFACE,
      target:
        `cloudflare-pages:${SITE_PROJECT}; operator-routed aliases takoform.com,www.takoform.com,forms.takoform.com`,
      covers: Object.freeze(["website"]),
      requiresScripts: Object.freeze(["check:host-api-freeze", "check:site", "build:site"]),
      requiresTools: Object.freeze(["git", "bun", "node", "wrangler"]),
      requiresEnv: Object.freeze([]),
      triggers: Object.freeze([]),
      obligations: Object.freeze({
        provenance:
          "uses the operator's standard Wrangler login/profile (run `wrangler login`): a read-only `wrangler pages project list --json` preflight confirms the exact Pages project before any gate or upload, then runs `check:host-api-freeze`, `check:site`, and `build:site` over the bytes it publishes. Production additionally refuses a dirty worktree or a HEAD that is not a credential-free read of the public refs/heads/main and records the source/digest and immutable deployment URL; integration and rehearsal may publish a dirty preview branch. This routine surface publishes presentation, does not change the fixed Host API v1, and never performs the identity/domain cutover",
        "post-conditions":
          "reads back exact bytes rather than status alone: every environment verifies the landing page, sitemap, and all 33 current plus 15 retired ledgered schema routes at the immutable per-deployment URL, with retired site-status, Form-catalog, release, project-lifecycle, and decision routes absent. Routine production additionally verifies the apex and www pages and negative routes at https://takoform.com and https://www.takoform.com, plus all 48 schema bytes at https://forms.takoform.com, against the production deployment history. This surface cannot request --initial-cutover or --verify-cutover",
        reversal:
          `presentation-only changes may promote a previous ${SITE_PROJECT} Pages deployment only after proving it still serves every ledgered schema byte. Once the initial domain cutover makes the 17 previously absent $id routes public, the predecessor Worker is never a rollback target; schema or domain-cutover failure is forward repair from provider history to a Pages deployment that serves all 48 exact bytes`,
        "failure-handling":
          "refuses before touching the target on a missing or unknown environment, an unauthenticated or unreadable Wrangler profile, a missing Pages project, an unreadable public ref, a dirty or non-main production source, an empty production history in normal production mode, or a failed scoped gate. An upload that fails prints the provider output verbatim, states that the target may or may not have changed, and never retries. A finished upload that prints no single immutable deployment URL, and any status, redirect, or digest mismatch, halt and require authoritative provider readback and forward repair instead of guessing",
        "no-overwrite":
          "a served schema path only ever carries the bytes its ledger entry digests, and bun run check:site fails if a published path drifts from its normative source or if the built tree serves any file under /schemas/ that names no ledger identity, so republishing cannot change an already-minted $id in place",
      }),
    }),
    Object.freeze({
      surface: API_CUTOVER_SURFACE,
      target:
        `cloudflare-pages:${SITE_PROJECT}; operator-routed aliases takoform.com,www.takoform.com,forms.takoform.com`,
      covers: Object.freeze(["host-api-v1-cutover"]),
      requiresScripts: Object.freeze(["check:host-api-freeze", "check:site", "build:site"]),
      requiresTools: Object.freeze(["git", "bun", "node", "wrangler"]),
      requiresEnv: Object.freeze([]),
      triggers: Object.freeze(["published-identity", "irreversible"]),
      obligations: Object.freeze({
        provenance:
          "one-time Host API v1 identity/domain cutover through the same Pages project: automatically invokes the internal initial-cutover implementation, runs check:host-api-freeze before check:site and build:site, and records the exact source, schema ledger partition, immutable deployment, and provider production readback without changing the frozen API bytes",
        "post-conditions":
          "the reviewed production-only initial flow reads the predecessor forms origin as 31 exact HTTP 200 schema bytes plus 17 exact HTTP 404 routes, uploads once with no custom domains attached, proves the returned deployment belongs to production history, and verifies the immutable Pages URL; after the operator moves domains in order www→apex→forms (forms last), upload-free --verify-cutover reads the immutable URL, apex pages/negative routes at https://takoform.com, www pages/negative routes at https://www.takoform.com, and all 48 forms schema bytes at https://forms.takoform.com with exact bodies and no redirects",
        reversal:
          "once forms.takoform.com moves and the 17 previously absent schema identities become public, the predecessor Worker is not a rollback target; any schema or topology failure is repaired forward from a Pages deployment serving all 48 exact bytes",
        "failure-handling":
          "refuses before upload on missing/changed 31/17 predecessor partition, existing production deployment, custom domains already attached, wrong reported production branch, unreadable project/profile, unavailable Pages domain ownership, failed Host API freeze/site gate, or failed exact readback; upload failure preserves provider diagnostics and never retries; post-domain verification is read-only and halts on any status, redirect, domain-ownership, or digest mismatch",
        "no-overwrite":
          "frozen Host API v1 prose, machine roots, and schema closure are checked by check:host-api-freeze; the append-only schema ledger and byte digests prevent an existing consumer-pinned identity from being overwritten",
        "pre-mutation-proof":
          "requires clean production source, empty production deployment history, an exact 31/17 predecessor partition, no custom domains beyond the Pages default hostname, and a second topology/history read immediately before the single upload; Wrangler does not expose the production branch setting, so that unsupported fact remains an explicit residual while the upload is forced to main and the returned deployment is proven in production history",
        "independent-review":
          "execute requires --review <non-secret-reference> naming evidence from a reviewer or deliberate review that did not author the change; the reference is recorded in the pending receipt but is not deployment permission",
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
      site: parseSiteDeployArgs(args.slice(1), { allowCutover: false }),
    });
  }
  if (args[0] === API_CUTOVER_SURFACE) {
    return Object.freeze({
      mode: "site",
      surface: API_CUTOVER_SURFACE,
      site: parseSiteDeployArgs(args.slice(1), {
        allowCutover: true,
        forceInitialCutover: true,
      }),
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
    return site(parsed.site, {
      ...(options.siteDeployOptions ?? {}),
      surface: parsed.surface,
    });
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
