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
