#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const HOST_API_V1_MANIFEST_PATH = "release/host-api-v1.json";
export const HOST_API_V1_PATHS = Object.freeze([
  "spec/host-api/v1.md",
  "spec/host-api/operations-v1.json",
  "spec/schemas/artifact-manifest-v1alpha1.schema.json",
  "spec/schemas/binding-ref-v1alpha2.schema.json",
  "spec/schemas/form-definition-v1.schema.json",
  "spec/schemas/form-ref-v1.schema.json",
  "spec/schemas/host-api-wire-v1.schema.json",
  "spec/schemas/host-discovery-v1.schema.json",
  "spec/schemas/host-support-profile-v1.schema.json",
  "spec/schemas/interface-ref-v1alpha1.schema.json",
  "spec/schemas/operation-v1.schema.json",
  "spec/schemas/standard-service-ref-v1.schema.json",
]);

export const historicalEvidencePaths = Object.freeze(new Set([
  "docs/extraction/history/publication-blockers-v1beta1.json",
  "docs/extraction/history/published-document-lanes.json",
  "docs/extraction/history/specification-1.1-publication-evidence.json",
  "docs/extraction/history/specification-1.1-publication-policy.md",
  "docs/extraction/history/specification-compatibility.json",
  "docs/extraction/history/w08-source-boundary-inventory.md",
  "docs/extraction/source-path-map.json",
  "docs/extraction/w10-core-cutover.md",
]));

const guardPaths = new Set([
  "scripts/version-axis.mjs",
  "scripts/version-axis.test.mjs",
]);

const forbiddenVocabulary = Object.freeze([
  /\b(?:Takoform\s+)?Specification\s+v?\d+(?:\.\d+)+\b/giu,
  /\bspecification[- ]releases?\b/giu,
  /\bspecification-v\d+\b/giu,
  /\bspecification\/v?\d+(?:\.\d+)*\b/giu,
  /\bspecification(?:Version|Releases?)\b/giu,
  /\b(?:current|candidate)\s+(?:Takoform\s+)?Specification\b/giu,
  /\b(?:Takoform\s+)?Specification\s+(?:current|candidate)\b/giu,
  /\b(?:Takoform\s+)?Specification[- ](?:major|minor|patch)\b/giu,
]);

function isHistoricalEvidence(path) {
  return historicalEvidencePaths.has(path);
}

function lineNumberAt(content, offset) {
  return content.slice(0, offset).split("\n").length;
}

export function inspectVersionAxes(entries) {
  const problems = [];
  const map = entries instanceof Map ? entries : new Map(Object.entries(entries ?? {}));
  for (const path of [...map.keys()].sort()) {
    if (isHistoricalEvidence(path) || guardPaths.has(path)) continue;
    const content = String(map.get(path) ?? "").replace(/\r\n?/gu, "\n");
    for (const pattern of forbiddenVocabulary) {
      for (const match of content.matchAll(pattern)) {
        problems.push(
          `${path}:${lineNumberAt(content, match.index ?? 0)} reintroduces an independent Specification version or release: ${match[0]}`,
        );
      }
    }
  }
  return problems;
}

function exactKeys(value, expected) {
  return JSON.stringify(Object.keys(value ?? {}).sort()) ===
    JSON.stringify([...expected].sort());
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function visitStrings(value, visit) {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) visitStrings(entry, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) visitStrings(entry, visit);
  }
}

export function validateHostApiClosure(
  entries,
  { expectedPaths = HOST_API_V1_PATHS } = {},
) {
  const problems = [];
  const map = entries instanceof Map ? entries : new Map(Object.entries(entries ?? {}));
  let manifest;
  try {
    manifest = JSON.parse(String(map.get(HOST_API_V1_MANIFEST_PATH) ?? ""));
  } catch {
    return [`${HOST_API_V1_MANIFEST_PATH} is missing or invalid JSON`];
  }
  if (
    !exactKeys(manifest, ["kind", "apiVersion", "compatibility", "documents"]) ||
    manifest.kind !== "takoform.host-api-closure@v1" ||
    manifest.apiVersion !== "forms.takoform.com/v1" ||
    !exactKeys(manifest.compatibility, ["incompatibleChange", "editorialErrata"]) ||
    manifest.compatibility.incompatibleChange !== "requires-api-v2" ||
    manifest.compatibility.editorialErrata !== "same-api-v1-identity" ||
    !Array.isArray(manifest.documents)
  ) {
    problems.push("Host API v1 closure manifest has an invalid closed envelope");
    return problems;
  }
  const paths = manifest.documents.map((document) => document?.path);
  if (JSON.stringify(paths) !== JSON.stringify(expectedPaths)) {
    problems.push("Host API v1 closure manifest does not name the exact normative path set");
  }
  const schemaIdentities = new Set();
  const referencedSchemaIdentities = new Set();
  for (const document of manifest.documents) {
    if (
      !exactKeys(document, ["path", "sha256"]) ||
      typeof document.path !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(document.sha256 ?? "")
    ) {
      problems.push("Host API v1 closure manifest contains an invalid document record");
      continue;
    }
    if (!map.has(document.path)) {
      problems.push(`Host API v1 document is missing: ${document.path}`);
      continue;
    }
    if (sha256(map.get(document.path)) !== document.sha256) {
      problems.push(`Host API v1 digest changed for ${document.path}`);
    }
    if (!document.path.endsWith(".json")) continue;
    let parsed;
    try {
      parsed = JSON.parse(map.get(document.path));
    } catch {
      problems.push(`Host API v1 JSON document is invalid: ${document.path}`);
      continue;
    }
    if (
      typeof parsed?.$id === "string" &&
      parsed.$id.startsWith("https://forms.takoform.com/schemas/")
    ) {
      if (schemaIdentities.has(parsed.$id)) {
        problems.push(`Host API v1 closure duplicates schema identity: ${parsed.$id}`);
      }
      schemaIdentities.add(parsed.$id);
    }
    visitStrings(parsed, (value) => {
      if (!value.startsWith("https://forms.takoform.com/schemas/")) return;
      referencedSchemaIdentities.add(value.split("#", 1)[0]);
    });
  }
  for (const identity of [...referencedSchemaIdentities].sort()) {
    if (!schemaIdentities.has(identity)) {
      problems.push(`Host API v1 closure omits referenced schema identity: ${identity}`);
    }
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
  for (const path of listing.stdout.toString("utf8").split("\0")) {
    if (path === "") continue;
    try {
      entries.set(path, readFileSync(path, "utf8"));
    } catch (error) {
      if (["EISDIR", "ENOENT"].includes(error?.code)) continue;
      throw error;
    }
  }
  return entries;
}

export function main() {
  const entries = worktreeEntries();
  const problems = [
    ...inspectVersionAxes(entries),
    ...validateHostApiClosure(entries),
  ];
  if (problems.length !== 0) {
    for (const problem of problems) console.error(`version-axis: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("version-axis: only Host API, Form, Core, and Provider versions remain active");
}

if (import.meta.main) main();
