import { test, expect } from "bun:test";
import MiniSearch from "minisearch";
import {
  defaultSearchScope, resultCountLabel, resultVersion, searchResultPage, searchResults,
} from "../website/.vitepress/search-scope.mjs";

test("the current document version supplies the default; neutral pages use all", () => {
  expect(defaultSearchScope("/spec/host-api/v1")).toBe("v1");
  expect(defaultSearchScope("/en/spec/host-api/v2/http#request")).toBe("v2");
  expect(defaultSearchScope("/en/")).toBe("all");
  expect(resultVersion("/en/spec/host-api/v1#heading")).toBe("v1");
  expect(resultVersion("/en/glossary#heading")).toBe("v2");
  expect(resultVersion("/en/site#heading")).toBe(null);
});

test("version filter is applied before result limit and retains common documents", () => {
  const index = new MiniSearch({ fields: ["text"], storeFields: ["title"] });
  for (let i = 0; i < 24; i++) {
    index.add({ id: `/spec/host-api/v1#item-${i}`, title: `v1 ${i}`, text: "request" });
  }
  index.add({ id: "/spec/host-api/v2/http#request", title: "v2", text: "request" });
  index.add({ id: "/site#request", title: "common", text: "request" });
  expect(searchResults(index, "request", "v2").map((result) => result.id).sort()).toEqual([
    "/site#request", "/spec/host-api/v2/http#request",
  ]);
  expect(searchResults(index, "request", "v1")).toHaveLength(16);
  expect(searchResults(index, "request", "all")).toHaveLength(16);
  expect(searchResults(index, "  ", "all")).toEqual([]);
});

test("a page reports truncation only when more matches exist than it shows", () => {
  const indexWith = (count) => {
    const index = new MiniSearch({ fields: ["text"], storeFields: ["title"] });
    for (let i = 0; i < count; i++) index.add({ id: `/spec/host-api/v2/http#item-${i}`, title: `${i}`, text: "request" });
    return index;
  };
  const exact = searchResultPage(indexWith(16), "request", "v2");
  expect(exact.results).toHaveLength(16);
  expect(exact.truncated).toBe(false);
  const more = searchResultPage(indexWith(17), "request", "v2");
  expect(more.results).toHaveLength(16);
  expect(more.truncated).toBe(true);
  expect(searchResultPage(indexWith(3), "request", "v1")).toEqual({ results: [], truncated: false });
  expect(resultCountLabel(16, true)).toBe("Top 16 results");
  expect(resultCountLabel(16, false)).toBe("16 results");
  expect(resultCountLabel(1, false)).toBe("1 result");
});
