import { documentVersion } from "./versions.mjs";

export function defaultSearchScope(path) {
  return documentVersion(path) ?? "all";
}

export function resultVersion(id) {
  return documentVersion(id.split("#", 1)[0]);
}

// Words joined by punctuation, as in an error code (`unsupported_form`), a
// header (`Takoform-Expected-Generation`) or a host (`forms.takoform.com`).
const JOINED_WORDS = /[\p{L}\p{N}][\p{Pc}\p{Pd}./:][\p{L}\p{N}]/u;
const normalizedPhrase = (query) => (query ?? "").trim().replace(/\s+/gu, " ");
// Matches `phrase` where a word starts, ignoring case, in decoded text.
const phrasePattern = (phrase) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRegExp(phrase)}`, "iu");

// A result's title, heading path and text, decoded once per loaded index.
const searchableText = new WeakMap();
function resultText(index, result) {
  if (!searchableText.has(index)) searchableText.set(index, new Map());
  const texts = searchableText.get(index);
  if (!texts.has(result.id)) {
    texts.set(result.id, [result.title, ...(result.titles ?? []), result.text]
      .filter(Boolean).map((field) => decodeEntities(field).replace(/\s+/gu, " ")).join("\n"));
  }
  return texts.get(result.id);
}

// MiniSearch scores each word of a query on its own, so sections that only use
// the words of an error code such as `unsupported_form` can outrank the ones
// that name it. A query of words joined by punctuation therefore ranks the
// sections that contain it exactly first, keeping MiniSearch's order within
// each group. Plain phrases keep MiniSearch's order: the docs write many
// names differently (Idempotency-Key for "idempotency key"), and an exact
// phrase is a weak signal next to MiniSearch's scores.
function literalFirst(index, matches, query) {
  const phrase = normalizedPhrase(query);
  if (!JOINED_WORDS.test(phrase)) return matches;
  const pattern = phrasePattern(phrase);
  const [exact, rest] = [[], []];
  for (const result of matches) (pattern.test(resultText(index, result)) ? exact : rest).push(result);
  return [...exact, ...rest];
}

export function searchResults(index, query, scope, limit = 16, options = {}) {
  if (!query.trim()) return [];
  // MiniSearch applies filter while collecting matches. Filtering an already
  // truncated list would hide valid results whenever another version ranks first.
  const matches = index.search(query, {
    ...options,
    filter: (result) => {
      const version = resultVersion(result.id);
      return scope === "all" || version === null || version === scope;
    },
  });
  // Close spellings cannot contain the query exactly, so they keep their order.
  return (options.fuzzy === undefined ? literalFirst(index, matches, query) : matches).slice(0, limit);
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
  if (!matches.length && (scope === "all" || !index.search(query).length)) {
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
 * A short excerpt of a result's text around its first matched term, or
 * around `phrase`, the query, where a query of several words or joined by
 * punctuation occurs exactly. It is a list of plain `{ text, match }`
 * segments: `match` marks each occurrence of a matched term at the start of a
 * word, so the caller highlights without rendering HTML.
 */
export function searchExcerpt(text, terms = [], phrase = "", length = 160) {
  const source = decodeEntities(text ?? "").replace(/\s+/gu, " ").trim();
  // Longer terms first, so `replaywindowseconds` wins over `replay`. Terms
  // from code keep tabs and indentation, which the source no longer has.
  const words = [...new Set(terms.map((term) => term.replace(/\s+/gu, " ").trim().toLowerCase()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  const pattern = words.length
    ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${words.map(escapeRegExp).join("|")})`, "giu")
    : null;
  // A query of several words or joined by punctuation, such as an error code,
  // opens the window where it occurs exactly at a word start, the same test
  // literalFirst ranks by; otherwise the window opens at the first term.
  const exact = normalizedPhrase(phrase);
  const first = (/[\s\p{P}]/u.test(exact) ? phrasePattern(exact).exec(source) : null) ?? pattern?.exec(source);
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
