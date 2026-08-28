#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, normalize, posix } from "node:path";

// These documents contain predecessor vocabulary that must not be copied into
// the current boundary. They are still checked for link validity unless they
// are one of the byte-pinned extraction records below.
export const vocabularyExcludedDocPrefixes = Object.freeze([
  "docs/extraction/history/",
  "spec/decisions/",
  "spec/proposals/",
  "proposals/",
]);

export const vocabularyExcludedDocPaths = Object.freeze(new Set([
  "AGENTS.md",
  "docs/extraction/w10-core-cutover.md",
  "spec/host-api/v1beta1.md",
  "spec/host-api/v1beta4.md",
]));

// records.mjs byte-pins this extraction subtree. Checking its links would
// turn a historical receipt into a rewrite, so only this subtree is exempt
// from link validation. Vocabulary remains exempt independently above.
export const linkExcludedDocPrefixes = Object.freeze([
  "docs/extraction/history/",
]);

const deletedRunnerTokens = Object.freeze([
  /\bcmd\/(?:portable-host-conformance|reference-host|form-package-release|standard-form-conformance|current-form-source)(?:\/|\b)/iu,
  /\bconformance\/(?:portable-host-v3|portable-host-v1beta1|runtime-abi-v1)(?:\/|\b)/iu,
  /\bconformance\/takoform-v1\/(?:manifest\.json|generic-host\/portable-host)(?:\/|\b)/iu,
]);

const officialRosterTokens = Object.freeze([
  /\b(?:first|current|preferred)\s+official\s+famil(?:y|ies)\b/iu,
  /\bofficial[- ]family\s+(?:roster|catalog|index|list|count)\b/iu,
  /\b(?:current|generated)\s+(?:family|families|roster|catalog|index)\b/iu,
  /\b(?:eight|seven)\s+(?:versionless\s+)?famil(?:y|ies)\b/iu,
  /\b(?:31|16)\s+(?:exact\s+)?(?:current\s+)?(?:formrefs?|forms?|members)\b/iu,
  /\b(?:13\s+interfaces|6\s+bindings)\b/iu,
]);

const edgeAuthorityTokens = Object.freeze([
  /\b(?:first|current|official)\s+edge(?:\s+platform)?\s+family\b/iu,
  /\bedge\.forms\.takoform\.com(?!\/v1(?:alpha|beta)\d+)/iu,
]);

const providerAuthorityTokens = Object.freeze([
  /\bprovider[- ](?:owned|specific|projection|mapping|implementation|schema|state|codec|release|registry|authority)\b/iu,
  /\b(?:provider|terraform|opentofu)\b[^\n.!?]{0,100}\b(?:owns?|defines?|controls?(?!\s+plane\b)|registers?|implements?|maps?|generates?|publishes?|authorit(?:y|ative))\b/iu,
  /\b(?:owns?|defines?|controls?(?!\s+plane\b)|registers?|implements?|maps?|generates?|publishes?|authorit(?:y|ative))\b[^\n.!?]{0,100}\b(?:provider|terraform|opentofu)\b/iu,
  /\bterraform\s+resource(?:\s+type)?\b/iu,
  /\bterraform\/opentofu\s+provider\b/iu,
]);

const hostApiV2Token = /\bforms\.takoform\.com\/v2(?:[^A-Za-z0-9_]|$)/iu;

const hostApi11Token =
  /(?:\bHost API\s+(?:v)?1\.1\b|\bforms\.takoform\.com\/v1\.1\b)/iu;

const takoformApiSemverToken =
  /\bTakoform API\s+(?:v)?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\b/iu;
const staleCurrentAxisToken = /\bTakoform API release SemVer\b/iu;

const ambiguousPostSpecificationToken = /\bpost-1\.1\b/iu;
const unreleasedDraftToken = /\bunreleased\s+draft\b/iu;

const unreleasedCurrentHostAPITokens = Object.freeze([
  /\b(?:Host API|API)\s+(?:v)?1\b[^\n.!?]{0,100}\b(?:candidate|unpublished|unreleased)\b/iu,
  /\b(?:candidate|unpublished|unreleased)\b[^\n.!?]{0,100}\b(?:Host API|API)\s+(?:v)?1\b/iu,
]);

const futureSpecificationWriterToken =
  /\b(?:current|future|continuing|new)\s+(?:numbered\s+)?Specification(?:\s+1\.x)?\s+(?:writer|release|stream)\b/iu;

const platformSchemaHostingToken = /\b(?:Cloudflare|Wrangler|schema-origin)\b/iu;

const exceptionWords = /\b(?:histor(?:y|ical)|predecessor|retained|withdrawn|legacy|proposal|proposed|verify-only|compatibility[- ]only|not\s+current|not\s+a\s+current|old\s+repository|former|superseded|unserved|forbidden|never\s+reuse)\b/iu;
const negationWords = /\b(?:no|not|never|without|neither|nor|cannot|does\s+not|do\s+not|doesn't|don't|isn't|aren't|none)\b/iu;

function isVocabularyExcludedDoc(path) {
  return vocabularyExcludedDocPaths.has(path) ||
    vocabularyExcludedDocPrefixes.some((prefix) => path.startsWith(prefix));
}

function isLinkExcludedDoc(path) {
  return linkExcludedDocPrefixes.some((prefix) => path.startsWith(prefix));
}

export function isCurrentDoc(path) {
  // Historical Markdown still participates in the vocabulary/link split;
  // callers decide which half to skip after this shape check.
  return path.endsWith(".md");
}

function sentenceBounds(text, index, length = 0) {
  let start = 0;
  for (const match of text.matchAll(/[.!?](?=\s|$)/gu)) {
    if ((match.index ?? 0) >= index) break;
    start = (match.index ?? 0) + 1;
  }
  let end = text.length;
  const remainder = text.slice(index + length);
  const terminator = /[.!?](?=\s|$)/u.exec(remainder);
  if (terminator) end = index + length + (terminator.index ?? 0) + 1;
  return { start, end };
}

function sentenceFragment(text, index, length = 0) {
  const { start, end } = sentenceBounds(text, index, length);
  return text.slice(start, end);
}

function hasExceptionContext(text, match) {
  // Historical/proposal vocabulary is an exception only in the sentence on
  // the current line that contains this match. Wrapped lines are joined only
  // while they remain in that same sentence; a previous sentence must never
  // bless a current authority claim.
  return exceptionWords.test(sentenceFragment(text, match.index ?? 0, match[0].length));
}

function isNegated(text, match) {
  const { start, end } = sentenceBounds(text, match.index ?? 0, match[0].length);
  const localBefore = text.slice(start, match.index ?? 0);
  const localAfter = text.slice((match.index ?? 0) + match[0].length, end);
  return negationWords.test(localBefore) || /\b(?:not|never|no)\b/iu.test(localAfter.slice(0, 48));
}

function isExplicitHostAPIAbsence(text, match) {
  const { start } = sentenceBounds(text, match.index ?? 0, match[0].length);
  const localBefore = text.slice(start, match.index ?? 0);
  return /\b(?:there\s+is\s+no|no)\s*$/iu.test(localBefore);
}

function matchesInLine(line, token) {
  const flags = token.flags.includes("g") ? token.flags : `${token.flags}g`;
  return line.matchAll(new RegExp(token.source, flags));
}

function checkVocabulary(path, content, problems) {
  const normalizedContent = content.replace(/\r\n?/gu, "\n");
  const lines = normalizedContent.split("\n");
  let lineOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const absoluteOffset = lineOffset;
    for (const token of deletedRunnerTokens) {
      for (const match of matchesInLine(line, token)) {
        const absoluteMatch = { ...match, index: absoluteOffset + (match.index ?? 0) };
        if (!hasExceptionContext(normalizedContent, absoluteMatch)) {
          problems.push(`${path}:${index + 1} references a deleted runner or command path: ${match[0]}`);
        }
      }
    }
    for (const token of [...officialRosterTokens, ...edgeAuthorityTokens, ...providerAuthorityTokens]) {
      for (const match of matchesInLine(line, token)) {
        const absoluteMatch = { ...match, index: absoluteOffset + (match.index ?? 0) };
        if (!hasExceptionContext(normalizedContent, absoluteMatch) && !isNegated(normalizedContent, absoluteMatch)) {
          problems.push(`${path}:${index + 1} reintroduces current implementation or publisher authority: ${match[0]}`);
        }
      }
    }
    for (const v2 of matchesInLine(line, hostApiV2Token)) {
      const absoluteV2 = { ...v2, index: absoluteOffset + (v2.index ?? 0) };
      if (!hasExceptionContext(normalizedContent, absoluteV2) && !isNegated(normalizedContent, absoluteV2)) {
        problems.push(`${path}:${index + 1} claims a positive Host API v2 identity: ${v2[0]}`);
      }
    }
    for (const v11 of matchesInLine(line, hostApi11Token)) {
      const absoluteV11 = { ...v11, index: absoluteOffset + (v11.index ?? 0) };
      if (
        !hasExceptionContext(normalizedContent, absoluteV11) &&
        !isExplicitHostAPIAbsence(normalizedContent, absoluteV11)
      ) {
        problems.push(`${path}:${index + 1} conflates Specification 1.1 with a Host API lane: ${v11[0]}`);
      }
    }
    for (const apiSemver of matchesInLine(line, takoformApiSemverToken)) {
      const absoluteAPISemver = {
        ...apiSemver,
        index: absoluteOffset + (apiSemver.index ?? 0),
      };
      if (
        !hasExceptionContext(normalizedContent, absoluteAPISemver) &&
        !isNegated(normalizedContent, absoluteAPISemver)
      ) {
        problems.push(
          `${path}:${index + 1} presents artifact SemVer as a Takoform API version: ${apiSemver[0]}`,
        );
      }
    }
    for (const ambiguous of matchesInLine(line, ambiguousPostSpecificationToken)) {
      problems.push(`${path}:${index + 1} uses ambiguous 1.1 shorthand instead of naming the historical Specification snapshot: ${ambiguous[0]}`);
    }
    for (const unreleased of matchesInLine(line, unreleasedDraftToken)) {
      problems.push(`${path}:${index + 1} retains an unreleased-draft label after Host API v1 convergence: ${unreleased[0]}`);
    }
    for (const token of unreleasedCurrentHostAPITokens) {
      for (const stalled of matchesInLine(line, token)) {
        problems.push(`${path}:${index + 1} describes the current Host API v1 lane as an unpublished candidate: ${stalled[0]}`);
      }
    }
    for (const writer of matchesInLine(line, futureSpecificationWriterToken)) {
      const absoluteWriter = { ...writer, index: absoluteOffset + (writer.index ?? 0) };
      if (!hasExceptionContext(normalizedContent, absoluteWriter) && !isNegated(normalizedContent, absoluteWriter)) {
        problems.push(`${path}:${index + 1} claims retired numbered Specification authority: ${writer[0]}`);
      }
    }
    for (const hosting of matchesInLine(line, platformSchemaHostingToken)) {
      problems.push(`${path}:${index + 1} retains platform-specific schema hosting vocabulary: ${hosting[0]}`);
    }
    lineOffset += line.length + 1;
  }
}

function checkDecisionCurrentApplicability(path, content, problems) {
  if (!path.startsWith("spec/decisions/")) return;
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  let overlayLines = [];
  let overlayStart = 0;
  const flushOverlay = () => {
    if (overlayLines.length === 0) return;
    const overlay = overlayLines.map((line) => line.replace(/^>\s?/u, "")).join(" ");
    for (const staleAxis of matchesInLine(overlay, staleCurrentAxisToken)) {
      problems.push(
        `${path}:${overlayStart} retains a superseded API SemVer axis in a current-applicability overlay: ${staleAxis[0]}`,
      );
    }
    overlayLines = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^>\s*Current applicability\b/iu.test(line)) {
      flushOverlay();
      overlayStart = index + 1;
      overlayLines.push(line);
    } else if (overlayLines.length > 0 && /^>/u.test(line)) {
      overlayLines.push(line);
    } else if (overlayLines.length > 0) {
      flushOverlay();
    }
  }
  flushOverlay();
}

function stripLinkTarget(raw) {
  const value = raw.trim();
  if (value.startsWith("<") && value.endsWith(">")) return value.slice(1, -1);
  return value;
}

function isExternalTarget(target) {
  return target.startsWith("#") || target.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target) || target.startsWith("//");
}

function resolveLocalTarget(docPath, rawTarget) {
  const target = stripLinkTarget(rawTarget);
  const withoutQuery = target.split(/[?#]/u, 1)[0];
  if (withoutQuery === "" || isExternalTarget(withoutQuery)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return { target: withoutQuery, invalidEncoding: true };
  }
  const resolved = normalize(posix.join(dirname(docPath), decoded));
  if (resolved === "." || resolved === ".." || resolved.startsWith(`..${posix.sep}`)) {
    return { target: resolved, escapesRepository: true };
  }
  return { target: resolved.replace(/^\.\//u, "") };
}

function hasEntry(entries, target) {
  if (entries.has(target)) return true;
  // Markdown commonly links to a directory README without spelling README.md.
  const prefix = target.endsWith("/") ? target : `${target}/`;
  return [...entries.keys()].some((entry) => entry.startsWith(prefix));
}

function checkLocalLinks(path, content, entries, problems) {
  const lines = content.split(/\r?\n/u);
  const linkPattern = /!?\[[^\]]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+[^)]*)?\)/gu;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // Inline code can contain regex character classes such as `[a-z](`,
    // which are not Markdown links. Mask code spans before matching while
    // preserving character positions for diagnostics.
    const linkLine = line.replace(/(`+)([\s\S]*?)\1/gu, (span) => " ".repeat(span.length));
    for (const match of linkLine.matchAll(linkPattern)) {
      const resolved = resolveLocalTarget(path, match[1]);
      if (!resolved) continue;
      if (resolved.invalidEncoding) {
        problems.push(`${path}:${index + 1} has an invalid local Markdown link target: ${match[1]}`);
      } else if (resolved.escapesRepository) {
        problems.push(`${path}:${index + 1} local Markdown link escapes the repository: ${match[1]}`);
      } else if (!hasEntry(entries, resolved.target)) {
        problems.push(`${path}:${index + 1} local Markdown link target does not exist: ${match[1]}`);
      }
    }
  }
}

export function inspectDocs(entries) {
  const problems = [];
  const map = entries instanceof Map ? entries : new Map(Object.entries(entries ?? {}));
  for (const path of [...map.keys()].sort()) {
    if (!isCurrentDoc(path)) continue;
    const content = String(map.get(path) ?? "");
    if (!isLinkExcludedDoc(path)) checkLocalLinks(path, content, map, problems);
    checkDecisionCurrentApplicability(path, content, problems);
    if (!isVocabularyExcludedDoc(path)) checkVocabulary(path, content, problems);
  }
  return problems;
}

// Descriptive aliases make the guard convenient to embed in another check.
export const inspectDocumentBoundary = inspectDocs;
export const checkDocsBoundary = inspectDocs;

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
  const problems = inspectDocs(worktreeEntries());
  if (problems.length !== 0) {
    for (const problem of problems) console.error(`docs-boundary: ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log("docs-boundary: current Markdown links and authority vocabulary are closed");
}

if (import.meta.main) main();
