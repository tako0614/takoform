#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const finalModule = "github.com/tako0614/takoform";
const predecessorRepository =
  "https://github.com/tako0614/terraform-provider-takoform.git";

const predecessorEvidenceSources = new Set([
  "scripts/schema-origin-deploy.mjs",
]);

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
    // These three guards must name the predecessor and forbidden identities in
    // order to validate them. Their behavior is covered by adversarial tests.
    return !new Set([
      "scripts/extraction-map.mjs",
      "scripts/records.mjs",
      "scripts/source-boundary.mjs",
    ]).has(path);
  }
  if (path.startsWith(".github/workflows/") && /\.ya?ml$/u.test(path)) return true;
  if (path.startsWith("conformance/") && path.endsWith(".json")) return true;
  return false;
}

function withoutPinnedPredecessorEvidence(path, content) {
  if (!predecessorEvidenceSources.has(path)) return content;
  return content
    .replaceAll(JSON.stringify(predecessorRepository), "\"\"")
    .replaceAll(`'${predecessorRepository}'`, "''");
}

export function inspectSource(entries) {
  const problems = [];
  const paths = [...entries.keys()].sort();

  for (const prefix of forbiddenTopLevelPrefixes) {
    if (paths.some((path) => path.startsWith(prefix))) {
      problems.push(`forbidden pre-extraction source remains under ${prefix}`);
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
    const authorityContent = withoutPinnedPredecessorEvidence(path, content);
    if (authorityContent.includes("github.com/tako0614/terraform-provider-takoform")) {
      problems.push(`${path} imports or executes through the former Provider module`);
    }
    if (content.includes("edge.forms.takoform.com")) {
      problems.push(`${path} hard-codes the historical Edge publisher group`);
    }
    if (content.includes("forms.takoform.com/v2")) {
      problems.push(`${path} creates or consumes the forbidden Host API v2 identity`);
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
