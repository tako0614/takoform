import { documentVersion } from "./versions.mjs";

export function defaultSearchScope(path) {
  return documentVersion(path) ?? "all";
}

export function resultVersion(id) {
  return documentVersion(id.split("#", 1)[0]);
}

export function searchResults(index, query, scope, limit = 16, options = {}) {
  if (!query.trim()) return [];
  // MiniSearch applies filter while collecting matches. Filtering an already
  // truncated list would hide valid results whenever another version ranks first.
  return index.search(query, {
    ...options,
    filter: (result) => {
      const version = resultVersion(result.id);
      return scope === "all" || version === null || version === scope;
    },
  }).slice(0, limit);
}

/**
 * How far one query term may be misspelled. Short terms and terms with digits
 * match only exactly or as a prefix: one edit would turn `curl` into `url`,
 * `409` into `404`, and `v1alpha1` into `v1alpha2`. (Swapped letters count as
 * two edits.)
 */
export function searchFuzziness(term) {
  return term.length > 4 && !/\d/u.test(term) ? 0.2 : false;
}

/**
 * The site's MiniSearch options. At most two edits keep long words from
 * matching distant ones, such as `specification` and `verification`.
 */
export const SEARCH_OPTIONS = { fuzzy: searchFuzziness, maxFuzzy: 2, prefix: true, boost: { title: 4, text: 2, titles: 1 } };

export const SEARCH_RESULT_LIMIT = 16;

/**
 * Return at most `limit` filtered results, whether more matched, and whether
 * they are approximate: a query that matches nothing exactly or by prefix in
 * any version, such as a misspelled short word, is retried with an edit
 * allowed in every term. A query that matches only in another version keeps
 * the empty result, whose message offers all versions.
 */
export function searchResultPage(index, query, scope, limit = SEARCH_RESULT_LIMIT) {
  // One extra match tells the reader whether the list was cut at the limit.
  let matches = searchResults(index, query, scope, limit + 1);
  let approximate = false;
  if (!matches.length && (scope === "all" || !searchResults(index, query, "all", 1).length)) {
    matches = searchResults(index, query, scope, limit + 1, { fuzzy: 0.2 });
    approximate = matches.length > 0;
  }
  return { results: matches.slice(0, limit), truncated: matches.length > limit, approximate };
}

export function resultCountLabel(count, truncated, approximate = false) {
  const label = truncated ? `Top ${count} results` : count === 1 ? "1 result" : `${count} results`;
  return approximate ? `${label} for similar spellings` : label;
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
