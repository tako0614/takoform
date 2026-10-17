import { documentVersion } from "./versions.mjs";

export function defaultSearchScope(path) {
  return documentVersion(path) ?? "all";
}

export function resultVersion(id) {
  return documentVersion(id.split("#", 1)[0]);
}

export function searchResults(index, query, scope, limit = 16) {
  if (!query.trim()) return [];
  // MiniSearch applies filter while collecting matches. Filtering an already
  // truncated list would hide valid results whenever another version ranks first.
  return index.search(query, {
    filter: (result) => {
      const version = resultVersion(result.id);
      return scope === "all" || version === null || version === scope;
    },
  }).slice(0, limit);
}

export const SEARCH_RESULT_LIMIT = 16;

/** Return at most `limit` filtered results and whether more matched. */
export function searchResultPage(index, query, scope, limit = SEARCH_RESULT_LIMIT) {
  // One extra match tells the reader whether the list was cut at the limit.
  const matches = searchResults(index, query, scope, limit + 1);
  return { results: matches.slice(0, limit), truncated: matches.length > limit };
}

export function resultCountLabel(count, truncated) {
  if (truncated) return `Top ${count} results`;
  return count === 1 ? "1 result" : `${count} results`;
}

// VitePress strips tags from indexed text but leaves the escapes that
// markdown-it and Shiki wrote, such as `&quot;` and `&#x3C;`.
const ENTITY = /&(?:#[xX]([\da-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/gu;
const NAMED_ENTITY = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };

/** Decode the HTML escapes left in indexed text, for display as plain text. */
export function decodeEntities(text) {
  return text.replace(ENTITY, (_entity, hex, decimal, name) => {
    if (name) return NAMED_ENTITY[name];
    const code = hex ? Number.parseInt(hex, 16) : Number(decimal);
    // As in HTML, code points that cannot stand alone become U+FFFD.
    return code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff ? "\ufffd" : String.fromCodePoint(code);
  });
}

const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
// Context kept before the first match, and how far a cut may move to land on a
// space; past that, a long unbroken token is cut mid-way instead.
const LEAD = 40;
const SNAP = 20;

/**
 * A short excerpt of a result's text around its first matched term, as plain
 * `{ text, match }` segments: `match` marks each occurrence of a matched term
 * at the start of a word, so the caller highlights without rendering HTML.
 */
export function searchExcerpt(text, terms = [], length = 160) {
  const source = decodeEntities(text ?? "").replace(/\s+/gu, " ").trim();
  // Longer terms first, so `replaywindowseconds` wins over `replay`. Terms
  // from code keep tabs and indentation, which the source no longer has.
  const words = [...new Set(terms.map((term) => term.replace(/\s+/gu, " ").trim().toLowerCase()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  const pattern = words.length
    ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${words.map(escapeRegExp).join("|")})`, "giu")
    : null;
  const first = pattern?.exec(source);
  const anchor = first?.index ?? 0;
  const anchorEnd = anchor + (first?.[0].length ?? 0);
  // Starting any earlier, even to fill the window near the end of a section,
  // can push the first match past the two lines a phone shows.
  let start = Math.max(0, anchor - LEAD);
  if (start > 0 && source[start - 1] !== " ") {
    const space = source.indexOf(" ", start);
    if (space !== -1 && space < anchor && space - start < SNAP) start = space + 1;
  }
  let end = Math.min(source.length, start + length);
  if (end < source.length && source[end] !== " ") {
    const space = source.lastIndexOf(" ", end);
    if (space >= anchorEnd && end - space < SNAP) end = space;
  }
  const segments = [];
  let plain = start > 0 ? "… " : "";
  let at = start;
  if (pattern) {
    pattern.lastIndex = start;
    for (let match = pattern.exec(source); match && match.index + match[0].length <= end; match = pattern.exec(source)) {
      plain += source.slice(at, match.index);
      if (plain) segments.push({ text: plain, match: false });
      segments.push({ text: match[0], match: true });
      plain = "";
      at = match.index + match[0].length;
    }
  }
  plain += source.slice(at, end);
  if (end < source.length) plain += " …";
  if (plain) segments.push({ text: plain, match: false });
  return segments;
}
