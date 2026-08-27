#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const finalModule = "github.com/tako0614/takoform";

const retiredSpecificationAuthorityPaths = new Set([
  "release/specification-authority.json",
  "release/specification-release-policy.md",
  "release/authority/specification-schema-tool-closure.json",
  "release/authority/specification-writer-closure.json",
  "release/authority/specification-writer-rotations.json",
  "scripts/specification-release.mjs",
  "scripts/specification-release.test.mjs",
  "scripts/specification-release-adapter.mjs",
  "scripts/specification-release-adapter.test.mjs",
]);

const retiredSpecificationAuthorityTokens = [
  "takoform-specification-release",
  "TAKOFORM_SPECIFICATION_",
  "prepare-activation",
  "specification-release-adapter.mjs",
  "specification-release.mjs",
];

const retiredReleaseAuthorityPaths = new Set([
  "release/authority/core-release-broker.json",
  "release/authority/core-release-continuation-review.pub",
  "release/authority/core-tag-allowed-signers",
  "release/core-releases.json",
  "scripts/deploy.mjs",
  "scripts/deploy.test.mjs",
  "scripts/sealed-deploy-bootstrap.mjs",
  "scripts/sealed-deploy-launcher.mjs",
  "scripts/sealed-deploy-runner.mjs",
]);

const retiredReleaseAuthorityTokens = [
  "TAKOFORM_CORE_",
  "prepare-sealed-continuation",
  "takoform-sealed-deploy",
  "takoform.core-release-independent-review",
  "takoform.core-release-receipt",
  "takoform.core-releases@",
  "record-push",
  "ruleset-id",
  "tag-bundle",
];

const forbiddenSchemaHostingPaths = new Set([
  "release/schema-origin-authority.json",
  "release/schema-origin-policy.md",
  "release/schema-origin-record-prefix-chain.json",
  "release/authority/schema-origin-tool-closure.json",
  "scripts/schema-origin-authority.mjs",
  "scripts/schema-origin-authority.test.mjs",
  "scripts/schema-origin-deploy.mjs",
  "scripts/schema-origin-deploy.test.mjs",
  "scripts/schema-origin-projection.mjs",
  "scripts/schema-origin-projection.test.mjs",
  "scripts/schema-origin-tool-closure.mjs",
  "scripts/schema-origin-tool-closure.test.mjs",
]);

const forbiddenSchemaHostingTokens = [
  "takoform-schema-origin",
  "CLOUDFLARE_",
  "wrangler",
];

const forbiddenTopLevelPrefixes = [
  "internal/clientv3/",
  "internal/currentformsnapshot/",
  "internal/currentformmodel/",
  "internal/currentformselection/",
  "internal/edgeformcatalog/",
  "internal/provider/",
  "providerdiagnostics/",
];

function isRuntimeGoSource(path) {
  return path.endsWith(".go") && !path.endsWith("_test.go");
}

function isReleaseAuthoritySource(path) {
  if (isRuntimeGoSource(path)) return true;
  if (path === "package.json" || path === "spec/trust/profile.json") return true;
  if (path.startsWith("scripts/") && path.endsWith(".mjs") && !path.endsWith(".test.mjs")) {
    // These guards must name predecessor and forbidden identities in
    // order to validate them. Their behavior is covered by adversarial tests.
    return !new Set([
      "scripts/extraction-map.mjs",
      "scripts/docs-boundary.mjs",
      "scripts/records.mjs",
      "scripts/source-boundary.mjs",
    ]).has(path);
  }
  if (path.startsWith(".github/workflows/") && /\.ya?ml$/u.test(path)) return true;
  if (path.startsWith("conformance/") && path.endsWith(".json")) return true;
  return false;
}

export function inspectSource(entries) {
  const problems = [];
  const paths = [...entries.keys()].sort();

  for (const prefix of forbiddenTopLevelPrefixes) {
    if (paths.some((path) => path.startsWith(prefix))) {
      problems.push(`forbidden pre-extraction source remains under ${prefix}`);
    }
  }

  for (const path of retiredSpecificationAuthorityPaths) {
    if (entries.has(path)) {
      problems.push(`retired Specification authority path must remain absent: ${path}`);
    }
  }
  for (const path of retiredReleaseAuthorityPaths) {
    if (entries.has(path)) {
      problems.push(`retired bespoke release authority path must remain absent: ${path}`);
    }
  }
  if (paths.some((path) => path.startsWith("release/broker/"))) {
    problems.push("Core must not contain a credential or release broker");
  }
  if (paths.some((path) => path.startsWith("schema-origin/"))) {
    problems.push("Core must not contain a schema-origin hosting tree");
  }
  if (paths.some((path) =>
    path.startsWith("scripts/schema-origin-") ||
    path.startsWith("release/schema-origin-") ||
    path.startsWith("release/authority/schema-origin-")
  )) {
    problems.push("Core must not contain schema-origin hosting scripts or authority records");
  }
  for (const path of forbiddenSchemaHostingPaths) {
    if (entries.has(path)) {
      problems.push(`schema hosting belongs outside Core: ${path}`);
    }
  }

  const goMod = entries.get("go.mod") ?? "";
  const moduleLines = goMod
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("module "));
  if (moduleLines.length !== 1 || moduleLines[0] !== `module ${finalModule}`) {
    problems.push(`go.mod must declare exactly module ${finalModule}`);
  }
  if (/^replace\s|^replace\s*\(/mu.test(goMod)) {
    problems.push("go.mod must not use replace directives or sibling source");
  }

  for (const path of paths) {
    if (!isReleaseAuthoritySource(path) && path !== "go.mod") continue;
    const content = entries.get(path) ?? "";
    if (content.includes("github.com/tako0614/terraform-provider-takoform")) {
      problems.push(`${path} imports or executes through the former Provider module`);
    }
    if (content.includes("edge.forms.takoform.com")) {
      problems.push(`${path} hard-codes the historical Edge publisher group`);
    }
    if (content.includes("forms.takoform.com/v2")) {
      problems.push(`${path} creates or consumes the forbidden Host API v2 identity`);
    }
    for (const token of retiredSpecificationAuthorityTokens) {
      if (content.includes(token)) {
        problems.push(`${path} retains retired Specification writer authority token ${token}`);
      }
    }
    for (const token of retiredReleaseAuthorityTokens) {
      if (content.includes(token)) {
        problems.push(`${path} retains retired bespoke release authority token ${token}`);
      }
    }
    for (const token of forbiddenSchemaHostingTokens) {
      if (content.toLowerCase().includes(token.toLowerCase())) {
        problems.push(`${path} retains platform-specific schema hosting token ${token}`);
      }
    }
  }

  for (const dependency of [
    "github.com/hashicorp/terraform-plugin-framework",
    "github.com/hashicorp/terraform-plugin-go",
  ]) {
    if (goMod.includes(dependency)) {
      problems.push(`Core must not depend on Provider runtime module ${dependency}`);
    }
  }

  for (const required of ["formpackage/model.go", "hostclient/hostclient.go", "snapshot/snapshot.go"]) {
    if (!entries.has(required)) problems.push(`required public Core package path is missing: ${required}`);
  }

  return problems;
}

function worktreeEntries() {
  const listing = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "buffer" },
  );
  if (listing.status !== 0) {
    throw new Error(`git ls-files failed: ${listing.stderr.toString("utf8").trim()}`);
  }
  const entries = new Map();
  for (const rawPath of listing.stdout.toString("utf8").split("\0")) {
    if (rawPath === "") continue;
    try {
      entries.set(rawPath, readFileSync(rawPath, "utf8"));
    } catch (error) {
      if (error?.code === "EISDIR" || error?.code === "ENOENT") continue;
      throw error;
    }
  }
  return entries;
}

export function main() {
  const problems = inspectSource(worktreeEntries());
  if (problems.length !== 0) {
    for (const problem of problems) console.error(`source-boundary: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("source-boundary: Core runtime and release-authority sources are closed");
}

if (import.meta.main) main();
