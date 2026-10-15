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
