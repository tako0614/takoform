import { test, expect } from "bun:test";
import MiniSearch from "minisearch";
import { defaultSearchScope, resultVersion, searchResults } from "../website/.vitepress/search-scope.mjs";

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
