// A page's description for search results and shared links, taken from its
// first prose paragraph when the frontmatter gives none. The paragraph comes
// from the tokens of VitePress's own render, after frontmatter is removed and
// includes are expanded, so code spans, escapes, entities, inline HTML and hard
// wraps read as the rendered page does, and text inside lists, quotes,
// containers and HTML blocks is never mistaken for it. It is cut to whole
// sentences within the limit or, when the first sentence alone is longer, to
// its words and an ellipsis.

export const SUMMARY_LIMIT = 200;

const ENTITY = /&(?:#x[\da-f]+|#\d+|[a-z][a-z\d]*);/giu;

function inlineText(children, decodeEntity) {
  return children.map((child) => {
    if (child.type === "text") return child.content.replace(ENTITY, decodeEntity);
    // A code span shows its entities as written.
    if (child.type === "code_inline" || child.type === "emoji") return child.content;
    if (child.type === "softbreak" || child.type === "hardbreak") return " ";
    if (child.type === "html_inline" && /^<br\b/iu.test(child.content)) return " ";
    if (child.type === "image") return inlineText(child.children ?? [], decodeEntity);
    return "";
  }).join("");
}

/**
 * Return the plain text of the first top-level paragraph in markdown-it tokens.
 * VitePress leaves entities as written in text tokens, so `decodeEntity`
 * (markdown-it's `utils.unescapeAll`) decodes each one.
 */
export function firstParagraphText(tokens, decodeEntity = (entity) => entity) {
  const index = tokens.findIndex((token) => token.type === "paragraph_open" && token.level === 0);
  if (index === -1) return undefined;
  const text = inlineText(tokens[index + 1]?.children ?? [], decodeEntity).replace(/\s+/gu, " ").trim();
  return text === "" ? undefined : text;
}

/**
 * Record the first top-level paragraph of each rendered page in `paragraphs`,
 * keyed by its source file (`env.realPath`, else `env.path`). An inline-only
 * render, such as a title, leaves the record alone.
 */
export function recordOpeningParagraphs(md, paragraphs) {
  md.core.ruler.push("takoform_opening_paragraph", (state) => {
    const file = state.env?.realPath ?? state.env?.path;
    if (state.inlineMode || typeof file !== "string") return;
    const text = firstParagraphText(state.tokens, (entity) => md.utils.unescapeAll(entity));
    if (text === undefined) paragraphs.delete(file);
    else paragraphs.set(file, text);
  });
}

/** Cut text to whole sentences within the limit, or to words with an ellipsis. */
export function summarize(text, limit = SUMMARY_LIMIT) {
  // A sentence ends at . ! or ? (and any closing quote or bracket) followed by
  // a space, so the dots in a host name or version do not end one. This module
  // runs only in the Node.js build.
  const sentences = text.split(/(?<=[.!?][)"'”’]*)\s+/u);
  let summary = "";
  for (const sentence of sentences) {
    const next = summary === "" ? sentence : `${summary} ${sentence}`;
    if (next.length > limit) break;
    summary = next;
  }
  // A clause that introduces a list ("The governing rule:") says nothing
  // without the list; end at the sentence before it.
  // A lone introducing sentence is marked as cut instead.
  summary = summary.replace(/(?<=[.!?][)"'”’]*)\s+[^.!?]*:$/u, "").replace(/:$/u, "…");
  if (summary !== "") return summary;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/u, "")}…`;
}
