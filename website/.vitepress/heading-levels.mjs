// Screen-reader users move through a page by heading level, so a heading that
// skips one, such as an h3 straight after the h1, leaves a gap in the outline
// they navigate. Nest each heading one level below the heading it falls under:
// the nearest earlier heading written at a higher level. Siblings stay
// siblings, so `# A`, `### B`, `#### C`, `### D` becomes h1, h2, h3, h2.
export function nestedHeadingLevels(levels) {
  const open = [];
  return levels.map((written) => {
    while (open.length > 0 && open.at(-1).written >= written) open.pop();
    const parent = open.at(-1);
    const level = parent === undefined ? written : parent.level + 1;
    open.push({ written, level });
    return level;
  });
}

// Apply the nesting to the rendered elements only. The rule runs on the block
// parser's heading tokens, so setext headings and headings inside containers or
// blockquotes count and text inside code never does. The Markdown, including a
// mirrored specification, keeps its bytes and each heading keeps its ID. A raw
// HTML heading is not a heading token and keeps its level; the site build
// refuses a page whose rendered outline still skips a level.
export function nestHeadings(md) {
  md.core.ruler.after("block", "takoform_heading_levels", (state) => {
    // Heading open and close tokens alternate, so each pair shares a level.
    const tokens = state.tokens.filter((token) => token.type === "heading_open" || token.type === "heading_close");
    const levels = nestedHeadingLevels(tokens.filter((token) => token.nesting === 1).map((token) => Number(token.tag.slice(1))));
    tokens.forEach((token, index) => {
      token.tag = `h${levels[index >> 1]}`;
    });
  });
}
