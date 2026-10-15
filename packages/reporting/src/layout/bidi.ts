// Bidirectional paragraph layout for the PDF (ADR-0046 §3; REQ-S13-009). pdfkit shapes a string with fontkit (OpenType
// GSUB/GPOS, including the Arabic joining forms) but does not reorder bidirectional text and wraps lines in logical
// order, so this module does, per paragraph:
//   1. base direction = the export language (`ar` -> RTL, `en` -> LTR);
//   2. identifiers, numbers and Latin text (`RAID-014`, UUIDs, SHA-256, `-1,234.50`, dates) are marked as left-to-right
//      runs inside Arabic text (`markLtrStretches`), so they read in their own order;
//   3. embedding levels with `bidi-js` (the Unicode Bidirectional Algorithm, UAX #9);
//   4. a face per character: the first face of the language's stack (fonts.ts) that covers it, neutrals staying in
//      the face of the text before them;
//   5. line breaking on the logical text at spaces (a word wider than the line is broken between characters),
//      measuring runs with the embedded font;
//   6. for each line, the visual order of its characters (`bidi-js` reordered indices), mirrored brackets in
//      right-to-left runs, and drawing pieces of one face and one level. A piece is handed to fontkit in the order
//      fontkit expects: fontkit lays out a right-to-left script run (Arabic) in logical order and returns its glyphs
//      in visual order, applying the joining forms; any other run is handed over in visual order.
// Bidi control characters (isolates, marks, embeddings) take part in the algorithm but are never drawn.
//
// The module is pure: measurement and coverage come from an injected `Shaper` (pdf/** backs it with pdfkit/fontkit).
import bidiModule, { type Bidi } from "bidi-js";

// bidi-js is a CommonJS module whose `module.exports` is the factory; its types declare it as `export default`.
const bidiFactory = ((bidiModule as unknown as { default?: () => Bidi }).default ??
  (bidiModule as unknown as () => Bidi)) as () => Bidi;
const bidi = bidiFactory();

export type BaseDirection = "ltr" | "rtl";

/** Measurement and glyph coverage of the faces, injected by the renderer. */
export interface Shaper {
  /** True when the face has a glyph for the code point. */
  covers(face: string, codePoint: number): boolean;
  /** The advance width of `text` in `face` at `size` points (shaped). */
  width(face: string, text: string, size: number): number;
  /** True when fontkit lays `text` out as a right-to-left run (it then reverses the glyphs into visual order). */
  shapesRtl(face: string, text: string): boolean;
}

/** One drawable piece of a line: `draw` is the string to hand to the font, left to right on the page. */
export interface Piece {
  readonly face: string;
  /** The string handed to fontkit (logical order for a run fontkit lays out right to left, else visual order). */
  readonly draw: string;
  /** The characters as they appear left to right on the page (for tests and text extraction). */
  readonly visual: string;
  readonly width: number;
  /** The bidi embedding level (odd = right to left). */
  readonly level: number;
}

export interface Line {
  readonly pieces: readonly Piece[];
  readonly width: number;
}

export interface ParagraphOptions {
  readonly direction: BaseDirection;
  /** The available width in points; `Infinity` for no wrapping. */
  readonly maxWidth: number;
  readonly size: number;
  /** The face names, in preference order (fonts.ts `fontStack`). */
  readonly faces: readonly string[];
  readonly shaper: Shaper;
}

const LRM = "\u200E";

/** Bidi controls and zero-width marks: they take part in the algorithm but are never drawn. */
const INVISIBLE = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;
/** A maximal stretch without right-to-left script (Hebrew, Arabic, Syriac, Thaana, NKo, their presentation forms). */
const NON_RTL_STRETCH = /[^\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]+/g;
const ALNUM = /[A-Za-z0-9]/;

/**
 * Step 2 (right-to-left paragraphs only): every stretch of Latin text, identifiers and numbers between the Arabic
 * (from its first letter or digit, or a sign before a digit, to its last letter, digit or `%`, with the brackets it
 * opens or closes) is marked with U+200E LEFT-TO-RIGHT MARK on both sides, so it is one left-to-right run in its own
 * order: `RAID-014`, a UUID or SHA-256, `-1,250.50 SAR`, `2026-10-15 13:45 (Asia/Riyadh)`. Inside the stretch, UAX #9
 * rule W7 makes the digits after a Latin letter left-to-right, so a hyphen between them stays in place. A Latin-only
 * paragraph is unchanged in order; only its alignment follows the base direction.
 */
export function markLtrStretches(text: string, direction: BaseDirection): string {
  if (direction !== "rtl") return text;
  return text.replace(NON_RTL_STRETCH, (stretch) => {
    let a = 0;
    while (a < stretch.length && !ALNUM.test(stretch[a]!)) {
      if ((stretch[a] === "-" || stretch[a] === "+") && /[0-9]/.test(stretch[a + 1] ?? "")) break;
      a++;
    }
    let b = stretch.length - 1;
    while (b >= a && !ALNUM.test(stretch[b]!) && stretch[b] !== "%") b--;
    if (a > b) return stretch;
    const count = (t: string, re: RegExp) => (t.match(re) ?? []).length;
    while (b + 1 < stretch.length && /[)\]}]/.test(stretch[b + 1]!)) {
      const inner = stretch.slice(a, b + 1);
      if (count(inner, /[([{]/g) <= count(inner, /[)\]}]/g)) break;
      b++;
    }
    while (a > 0 && /[([{]/.test(stretch[a - 1]!)) {
      const inner = stretch.slice(a, b + 1);
      if (count(inner, /[)\]}]/g) <= count(inner, /[([{]/g)) break;
      a--;
    }
    return `${stretch.slice(0, a)}${LRM}${stretch.slice(a, b + 1)}${LRM}${stretch.slice(b + 1)}`;
  });
}

const isWhitespace = (cp: number) => cp === 0x20 || cp === 0x09 || cp === 0xa0 || cp === 0x3000 || cp === 0x2009;

interface Unit {
  /** UTF-16 index of the code point's first unit. */
  readonly start: number;
  readonly text: string;
  readonly cp: number;
  /** The face that draws it, or null for an invisible control. */
  readonly face: string | null;
}

/** Steps 2-4 for one paragraph: the marked text, its levels and one unit per code point with its face. */
function analyse(paragraph: string, o: ParagraphOptions) {
  const text = markLtrStretches(paragraph, o.direction);
  const embedding = bidi.getEmbeddingLevels(text, o.direction);
  const units: Unit[] = [];
  let previous: string | null = null;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    let face: string | null = null;
    if (!INVISIBLE.test(ch)) {
      const type = bidi.getBidiCharTypeName(ch);
      const neutral = type === "WS" || type === "ON" || type === "CS" || type === "ES" || type === "ET";
      if (neutral && previous !== null && o.shaper.covers(previous, cp)) face = previous;
      else face = o.faces.find((f) => o.shaper.covers(f, cp)) ?? o.faces[0]!;
      previous = face;
    }
    units.push({ start: i, text: ch, cp, face });
    i += ch.length;
  }
  return { text, embedding, units };
}

/**
 * Step 5: logical line ranges [from, to) over the units (trailing spaces excluded from the range). `widthOf` is the
 * width of the line exactly as it is drawn (its visual pieces), so a line never exceeds the width.
 */
function breakLines(
  units: readonly Unit[],
  o: ParagraphOptions,
  widthOf: (from: number, to: number) => number,
): [number, number][] {
  // Words: a maximal run of non-spaces followed by its spaces.
  const words: { from: number; end: number; to: number }[] = [];
  for (let k = 0; k < units.length; ) {
    const from = k;
    while (k < units.length && !isWhitespace(units[k]!.cp)) k++;
    const end = k;
    while (k < units.length && isWhitespace(units[k]!.cp)) k++;
    words.push({ from, end, to: k });
  }
  const lines: [number, number][] = [];
  let lineFrom = -1;
  let lineEnd = -1;
  for (const w of words) {
    if (lineFrom >= 0 && widthOf(lineFrom, w.end) <= o.maxWidth) {
      lineEnd = w.end;
      continue;
    }
    if (lineFrom >= 0) lines.push([lineFrom, lineEnd]);
    // A word wider than the line is broken between characters.
    let from = w.from;
    while (from < w.end && widthOf(from, w.end) > o.maxWidth) {
      let to = from + 1;
      while (to < w.end && widthOf(from, to + 1) <= o.maxWidth) to++;
      lines.push([from, to]);
      from = to;
    }
    lineFrom = from;
    lineEnd = w.end;
  }
  if (lineFrom >= 0) lines.push([lineFrom, lineEnd]);
  if (lines.length === 0) lines.push([0, 0]);
  return lines;
}

const reverseUnits = (s: string): string => Array.from(s).reverse().join("");

/** Step 6 for one line: the visual pieces, left to right. */
function linePieces(
  text: string,
  embedding: ReturnType<Bidi["getEmbeddingLevels"]>,
  units: readonly Unit[],
  from: number,
  to: number,
  o: ParagraphOptions,
): Line {
  if (from >= to) return { pieces: [], width: 0 };
  const startIndex = units[from]!.start;
  const last = units[to - 1]!;
  const endIndex = last.start + last.text.length - 1;
  const order = bidi.getReorderedIndices(text, embedding, startIndex, endIndex);
  const mirrored = bidi.getMirroredCharactersMap(text, embedding.levels, startIndex, endIndex);
  const unitAt = new Map(units.slice(from, to).map((u) => [u.start, u] as const));
  // Visual sequence of code points (a surrogate pair stays one unit even inside a reversed run).
  const visual: Unit[] = [];
  const seen = new Set<Unit>();
  for (const index of order) {
    const low = text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
    const u = unitAt.get(index) ?? (low ? unitAt.get(index - 1) : undefined);
    if (u === undefined || u.face === null || seen.has(u)) continue;
    seen.add(u);
    visual.push(u);
  }
  const pieces: Piece[] = [];
  let k = 0;
  while (k < visual.length) {
    const first = visual[k]!;
    const level = embedding.levels[first.start]!;
    let shown = "";
    while (k < visual.length && visual[k]!.face === first.face && embedding.levels[visual[k]!.start] === level) {
      const u = visual[k]!;
      shown += mirrored.get(u.start) ?? u.text;
      k++;
    }
    const face = first.face!;
    const draw = o.shaper.shapesRtl(face, shown) ? reverseUnits(shown) : shown;
    pieces.push({ face, draw, visual: shown, width: o.shaper.width(face, draw, o.size), level });
  }
  return { pieces, width: pieces.reduce((a, p) => a + p.width, 0) };
}

/** Lays out one text (paragraphs separated by line feeds) into lines of visual pieces. */
export function layoutText(input: string, o: ParagraphOptions): Line[] {
  const lines: Line[] = [];
  for (const paragraph of input.replace(/\r\n?/g, "\n").replace(/\t/g, " ").split("\n")) {
    const { text, embedding, units } = analyse(paragraph, o);
    const line = (from: number, to: number) => linePieces(text, embedding, units, from, to, o);
    for (const [from, to] of breakLines(units, o, (from, to) => line(from, to).width)) lines.push(line(from, to));
  }
  return lines;
}

/** The text of a line as read left to right on the page (tests; text extraction order). */
export const visualText = (line: Line): string => line.pieces.map((p) => p.visual).join("");
