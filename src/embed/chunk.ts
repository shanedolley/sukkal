/**
 * Splits a source's body into the passages that get embedded.
 *
 * A chunk is a byte range into `sources.body`, never a copy of the text (see
 * `src/memory/source.ts`), so a citation opens at the right place and the bytes
 * of the range are the chunk, verbatim. This module therefore cuts and never
 * rewrites: it does not trim inside a chunk, join lines or drop markup.
 *
 * ON STRUCTURE, IN THIS ORDER. A heading starts a new chunk once the current
 * one is long enough to stand alone. A blank line ends a paragraph, and
 * paragraphs pack until the next would pass `MAX_CHARS`. Only a paragraph that
 * is longer than that on its own is cut inside, and it is cut at a line end,
 * then a sentence end, then a space, so a sentence is cut only when a single
 * sentence outgrows the limit. A fenced code block is one paragraph however many
 * blank lines or `#` lines it holds, but a block longer than `MAX_CHARS` is cut
 * like any other long paragraph.
 *
 * Leading frontmatter is skipped. It is metadata the sources table already
 * holds in columns, and it would embed as noise.
 *
 * WORK IS DONE IN UTF-16 INDEXES AND CONVERTED TO BYTES AT THE END. JavaScript
 * counts code units and Postgres ranges count bytes, and the two agree only on
 * ASCII. `byteOffsets` is the one place that converts.
 */
import type { Chunk } from '../memory/source.ts';

/** The most characters a chunk holds, unless one sentence is longer. */
export const MAX_CHARS = 1500;

/** A chunk this short is joined to what follows rather than left alone. */
export const MIN_CHARS = 300;

interface Span {
  start: number;
  end: number;
  heading: boolean;
}

const HEADING = /^#{1,6}\s/;
const FENCE = /^\s*(```|~~~)/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const SENTENCE_END = /[.!?]["')\]]*\s/g;

/** The byte offset of every UTF-16 index, with the length at the end. */
function byteOffsets(text: string): Uint32Array {
  const offsets = new Uint32Array(text.length + 1);
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    offsets[i] = bytes;
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    // A surrogate pair is four bytes: charge them to the high half.
    else if (code >= 0xd800 && code <= 0xdbff) bytes += 4;
    else if (code >= 0xdc00 && code <= 0xdfff) bytes += 0;
    else bytes += 3;
  }
  offsets[text.length] = bytes;
  return offsets;
}

/** Where the body proper begins, after any leading frontmatter. */
function afterFrontmatter(body: string): number {
  const open = /^---[ \t]*\r?\n/.exec(body);
  if (!open) return 0;
  const close = /\r?\n---[ \t]*(\r?\n|$)/.exec(body.slice(open[0].length - 1));
  return close ? open[0].length - 1 + close.index + close[0].length : 0;
}

/** Paragraphs and headings, in order, as index spans with no edge blank. */
function units(body: string, from: number): Span[] {
  const found: Span[] = [];
  let open: Span | null = null;
  let fenced = false;
  let index = from;

  const close = (): void => {
    if (open) found.push(open);
    open = null;
  };

  while (index < body.length) {
    const newline = body.indexOf('\n', index);
    const next = newline === -1 ? body.length : newline + 1;
    const line = body.slice(index, newline === -1 ? body.length : newline).replace(/\r$/, '');
    const isFence = FENCE.test(line);

    if (!fenced && line.trim() === '') {
      close();
    } else if (!fenced && !isFence && HEADING.test(line)) {
      close();
      open = { start: index, end: index + line.length, heading: true };
    } else {
      open ??= { start: index, end: index, heading: false };
      open.end = index + line.length;
    }
    if (isFence) fenced = !fenced;
    index = next;
  }
  close();
  return found;
}

/** The last cut inside `(from, limit]` that does not split a sentence, line or word. */
function cutPoint(text: string, from: number, limit: number): number {
  const half = from + Math.floor((limit - from) / 2);
  const window = text.slice(from, limit);

  const line = window.lastIndexOf('\n');
  if (from + line > half) return from + line;

  SENTENCE_END.lastIndex = 0;
  let sentence = -1;
  for (let m = SENTENCE_END.exec(window); m; m = SENTENCE_END.exec(window)) {
    sentence = m.index + m[0].length;
  }
  if (from + sentence > half) return from + sentence;

  const space = window.search(/\s\S*$/);
  if (space !== -1 && from + space > half) return from + space;

  // Nothing to cut at: cut the characters, but never between the two halves
  // of a surrogate pair.
  const code = text.charCodeAt(limit - 1);
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
}

/** Cuts a span longer than `MAX_CHARS` into spans no longer than it. */
function cut(text: string, span: Span): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  let heading = span.heading;
  while (span.end - start > MAX_CHARS) {
    const end = cutPoint(text, start, start + MAX_CHARS);
    pieces.push({ start, end, heading });
    heading = false;
    start = end;
    while (start < span.end && /\s/.test(text[start] ?? '')) start += 1;
  }
  pieces.push({ start, end: span.end, heading });
  return pieces.map((piece) => {
    let end = piece.end;
    while (end > piece.start && /\s/.test(text[end - 1] ?? '')) end -= 1;
    return { ...piece, end };
  });
}

/** The chunks of `body`, as byte ranges into its UTF-8 bytes. */
export function chunkBody(body: string): Chunk[] {
  const spans = units(body, afterFrontmatter(body))
    .filter((unit) => !RULE.test(body.slice(unit.start, unit.end)))
    .flatMap((unit) => cut(body, unit))
    .filter((unit) => unit.end > unit.start);

  const chunks: Array<{ start: number; end: number }> = [];
  let current: { start: number; end: number } | null = null;
  for (const unit of spans) {
    if (current) {
      const flush =
        unit.end - current.start > MAX_CHARS ||
        (unit.heading && current.end - current.start >= MIN_CHARS);
      if (!flush) {
        current.end = unit.end;
        continue;
      }
      chunks.push(current);
    }
    current = { start: unit.start, end: unit.end };
  }
  if (current) chunks.push(current);

  const offsets = byteOffsets(body);
  return chunks.map((chunk) => ({
    byteStart: offsets[chunk.start] ?? 0,
    byteEnd: offsets[chunk.end] ?? 0,
  }));
}
