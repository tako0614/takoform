// How a long code line wraps, shared by highlighted code blocks
// (wrappedCodeLines in config.mts) and the home page example (HomePage.vue);
// custom.css lays the result out. This module also runs in the browser, so it
// avoids regular-expression lookbehind, which older Safari cannot parse.
//
// - The line hangs: its first row is pulled back by `hang` columns and its
//   continuation rows start that far in. The hang covers the leading
//   indentation plus at least two columns, rounded up to the four-column tab
//   size, because tab stops are measured from the block's edge: a first row
//   that starts on a tab stop keeps its tabs at their usual width.
// - Preserved white space is a wrap opportunity, so the indentation and the
//   first character are kept together; otherwise a long first token leaves the
//   indentation alone on a blank row. A trailing shell continuation (" \")
//   likewise stays with the word before it.
// - A line may wrap after the punctuation that joins parts of a path, URL,
//   query or expression, and after every 16 digits of a hex run, before the
//   browser breaks inside a word. A time such as 12:00:00 stays whole.

export const TAB_SIZE = 4;
export const HEX_RUN = /([0-9a-f]{16})(?=[0-9a-f])/gu;
// A character, then a run of joining punctuation before another character.
const CODE_BREAK_RUN = /([^\s/.:_\-?&=,([{])([/.:_\-?&=,([{]+)(?=[^\s/.:_\-?&=,([{)\]}])/gu;

/**
 * The layout of one code line: `hang` in columns (null for an unindented
 * line), `keep` as [start, end) ranges that must not wrap, and `breaks` as the
 * offsets after which the line may wrap, none inside or at the end of a kept
 * range.
 */
export function codeLineLayout(text) {
  let hang = null;
  const keep = [];
  const leading = text.match(/^[ \t]*/u)[0];
  if (leading && leading.length < text.length) {
    const indent = [...leading]
      .reduce((column, character) => character === "\t" ? column + TAB_SIZE - column % TAB_SIZE : column + 1, 0);
    hang = Math.ceil((indent + 2) / TAB_SIZE) * TAB_SIZE;
    keep.push([0, leading.length + String.fromCodePoint(text.codePointAt(leading.length)).length]);
  }
  const continuation = text.match(/[^ \t][ \t]+\\$/u);
  if (continuation && continuation.index >= (keep[0]?.[1] ?? 0)) keep.push([continuation.index, text.length]);
  const time = (match) => /\d/u.test(match[1]) && match[2].startsWith(":") &&
    /^\d/u.test(text.slice(match.index + match[0].length));
  const breaks = [...new Set([
    ...[...text.matchAll(CODE_BREAK_RUN)].filter((match) => !time(match)).map((match) => match.index + match[0].length),
    ...[...text.matchAll(HEX_RUN)].map((match) => match.index + 16),
  ])].filter((at) => !keep.some(([start, end]) => at > start && at <= end)).sort((left, right) => left - right);
  return { hang, keep, breaks };
}

/**
 * A hand-written code block as lines of segments for a template: each line's
 * hang as a style, and its text split at kept ranges and break hints, with
 * `hint` marking a segment that may start a new row.
 */
export function codeLineSegments(source) {
  return source.split("\n").map((text) => {
    const { hang, keep, breaks } = codeLineLayout(text);
    const cuts = [...new Set([0, ...keep.flat(), ...breaks, text.length])].sort((left, right) => left - right);
    const segments = cuts.slice(0, -1).map((start, index) => ({
      text: text.slice(start, cuts[index + 1]),
      keep: keep.some(([from, to]) => start >= from && cuts[index + 1] <= to),
      hint: breaks.includes(start),
    }));
    return { style: hang === null ? undefined : `--takoform-hang:${hang}ch`, segments };
  });
}
