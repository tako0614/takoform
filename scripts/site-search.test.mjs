import { test, expect } from "bun:test";
import MiniSearch from "minisearch";
import {
  decodeEntities, defaultSearchScope, resultCountLabel, resultVersion, SEARCH_OPTIONS, searchExcerpt, searchFuzziness, searchResultPage, searchResults,
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
  expect(searchResultPage(indexWith(3), "request", "v1")).toEqual({ results: [], truncated: false, approximate: false });
  expect(resultCountLabel(16, true)).toBe("Top 16 results");
  expect(resultCountLabel(16, false)).toBe("16 results");
  expect(resultCountLabel(1, false)).toBe("1 result");
});

test("result excerpts show the first match with every matched term highlighted", () => {
  const text = "A client records the initial send time. After a lost response it resends the identical request only within replayWindowSeconds; after that it reads the Operation and the Resource instead of replaying.";
  const shown = (segments) => segments.map((segment) => segment.match ? `[${segment.text}]` : segment.text).join("");
  // The window opens shortly before the first match, at a word boundary, even
  // near the end of the text; the longest matching term wins.
  expect(shown(searchExcerpt(text, ["replay", "replaywindowseconds", "window"])))
    .toBe("… the identical request only within [replayWindowSeconds]; after that it reads the Operation and the Resource instead of [replay]ing.");
  // A short text keeps its start and end without ellipses.
  expect(searchExcerpt("Send a new Idempotency-Key.", ["idempotency", "key"]))
    .toEqual([{ text: "Send a new ", match: false }, { text: "Idempotency", match: true }, { text: "-", match: false }, { text: "Key", match: true }, { text: ".", match: false }]);
  // Terms inside a word are neither marked nor used as the anchor, including
  // after a combining accent.
  expect(searchExcerpt("unreplayable replay", ["replay"]))
    .toEqual([{ text: "unreplayable ", match: false }, { text: "replay", match: true }]);
  expect(shown(searchExcerpt("e\u0301replay replay", ["replay"]))).toBe("e\u0301replay [replay]");
  // The window opens at the earliest match of any term, not at the longest term.
  const lead = "word ".repeat(30);
  const gap = "gap ".repeat(15);
  expect(shown(searchExcerpt(`${lead}window ${gap}replayWindowSeconds ${lead}`, ["replaywindowseconds", "window"])))
    .toBe(`… ${"word ".repeat(8)}[window] ${gap}[replayWindowSeconds] ${"word ".repeat(6)}…`);
  expect(shown(searchExcerpt(`${lead}unreplayable then replay ${lead}`, ["replay"])))
    .toBe(`… ${"word ".repeat(4)}unreplayable then [replay] ${"word ".repeat(23)}…`);
  // Escapes left in the index are decoded once, and whitespace runs collapse
  // in the text and in terms taken from indented code.
  expect(shown(searchExcerpt("{ &quot;entryExists&quot;:\n\t true }  &#x3C;prefix&gt; &amp;lt;", ["entryexists"])))
    .toBe("{ \"[entryExists]\": true } <prefix> &lt;");
  expect(shown(searchExcerpt("func main() {\n\tdefer f()\n}", ["\tdefer"]))).toBe("func main() { [defer] f() }");
  expect(decodeEntities("&#0;&#xD800;&#x110000;&#x1F600;&#38;amp;")).toBe("\ufffd\ufffd\ufffd\u{1f600}&amp;");
  // A long unbroken token is cut rather than dropped to reach a space.
  const token = `https://example.com/${"a".repeat(80)}`;
  expect(shown(searchExcerpt(`See ${token} replay ${"b".repeat(200)}`, ["replay"])))
    .toBe(`… ${"a".repeat(39)} [replay] ${"b".repeat(113)} …`);
  // Without a match the excerpt starts at the beginning.
  expect(shown(searchExcerpt(text, ["absent"]))).toBe(`${text.slice(0, text.lastIndexOf(" ", 160))} …`);
  expect(searchExcerpt("", ["replay"])).toEqual([]);
  expect(searchExcerpt("text", undefined)).toEqual([{ text: "text", match: false }]);
});

test("short and numeric terms match exactly, longer words tolerate a typo", () => {
  expect([searchFuzziness("host"), searchFuzziness("hosts"), searchFuzziness("sha256")]).toEqual([false, 0.2, false]);
  const index = new MiniSearch({ fields: ["text"], storeFields: ["text"], searchOptions: SEARCH_OPTIONS });
  index.addAll([
    { id: "curl", text: "Try the API with curl" },
    { id: "url", text: "The exact Form URL" },
    { id: "conflict", text: "409 generation conflict" },
    { id: "missing", text: "404 not found" },
    { id: "alpha1", text: "schemas v1alpha1" },
    { id: "alpha2", text: "schemas v1alpha2" },
    { id: "idempotency", text: "Idempotency-Key header" },
    { id: "token", text: "Bearer token" },
    { id: "specification", text: "A Form specification" },
    { id: "verification", text: "Offline verification" },
    { id: "host", text: "Host discovery" },
  ]);
  const ids = (query) => index.search(query).map((result) => result.id).sort();
  expect(ids("curl")).toEqual(["curl"]);
  expect(ids("409")).toEqual(["conflict"]);
  expect(ids("v1alpha1")).toEqual(["alpha1"]);
  expect(ids("ur")).toEqual(["url"]);
  // A five-letter word and longer words still tolerate a typo, but at most two
  // edits, so a long word does not match a distant one.
  expect(ids("tokem")).toEqual(["token"]);
  expect(ids("idempotncy")).toEqual(["idempotency"]);
  expect(ids("specification")).toEqual(["specification"]);
  // A query that matches nothing exactly is retried allowing typos, and the
  // results say so.
  const strict = searchResultPage(index, "hoat", "all");
  expect(strict.results.map((result) => result.id)).toEqual(["host"]);
  expect(strict.approximate).toBe(true);
  expect(searchResultPage(index, "host", "all").approximate).toBe(false);
  expect(searchResultPage(index, "zzzz", "all")).toEqual({ results: [], truncated: false, approximate: false });
  // A term that matches exactly only in another version is not replaced by
  // near spellings in the narrowed scope: the empty result offers all versions.
  const versioned = new MiniSearch({ fields: ["text"], storeFields: ["text"], searchOptions: SEARCH_OPTIONS });
  versioned.addAll([
    { id: "/spec/host-api/v2/http#curl", text: "Try the API with curl" },
    { id: "/spec/host-api/v1#url", text: "The exact Form URL" },
  ]);
  expect(searchResultPage(versioned, "curl", "v1")).toEqual({ results: [], truncated: false, approximate: false });
  expect(searchResultPage(versioned, "hoat", "v1")).toEqual({ results: [], truncated: false, approximate: false });
  expect(searchResultPage(versioned, "urk", "v1").approximate).toBe(true);
  expect(resultCountLabel(1, false, true)).toBe("1 result for similar spellings");
  expect(resultCountLabel(16, true, true)).toBe("Top 16 results for similar spellings");
});
