// A minimal PDF reader for tests (like xlsx/read.ts; not used by the renderers): it inflates the streams, decodes each
// text-showing operator's glyph ids through its font's ToUnicode map, and keeps the position and the embedded subset
// font program, so a test checks what a viewer draws (REQ-S13-009: direction, embedded fonts, the order of
// identifiers and numbers, the Arabic joining forms). It understands the PDFs pdfkit writes, not PDF in general.
import { inflateSync } from "node:zlib";

export interface PdfObject {
  readonly dict: string;
  readonly stream: Buffer | null;
}
export interface Shown {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly font: string;
  readonly baseFont: string;
  readonly gids: number[];
  /** The glyphs' text in drawing (visual) order. */
  readonly text: string;
  /** The glyphs' text in reverse drawing order: the logical text of a right-to-left run (ligatures stay whole). */
  readonly logical: string;
}
export interface ReadPdf {
  readonly raw: string;
  readonly objects: Map<number, PdfObject>;
  readonly shown: Shown[];
  readonly pages: number;
  /** The FontFile2 bytes of a font resource (by BaseFont + ToUnicode identity). */
  readonly fontFile: Map<string, Buffer>;
}

export function readPdf(bytes: Uint8Array): ReadPdf {
  const buf = Buffer.from(bytes);
  const raw = buf.toString("latin1");
  const objects = new Map<number, PdfObject>();
  for (const m of raw.matchAll(/(\d+) 0 obj\s*(<<[\s\S]*?>>)\s*(stream\r?\n|endobj)/g)) {
    let stream: Buffer | null = null;
    if (m[3]!.startsWith("stream")) {
      const length = Number(/\/Length (\d+)/.exec(m[2]!)![1]);
      const start = m.index + m[0].length;
      const data = buf.subarray(start, start + length);
      stream = /\/FlateDecode/.test(m[2]!) ? inflateSync(data) : data;
    }
    objects.set(Number(m[1]), { dict: m[2]!.replace(/\s+/g, " "), stream });
  }
  const ref = (dict: string, key: string) => {
    const r = new RegExp(`/${key} (\\d+) 0 R`).exec(dict);
    return r === null ? null : Number(r[1]);
  };
  const cmapOf = (id: number): Map<number, string> => {
    const text = objects.get(id)!.stream!.toString("latin1");
    const map = new Map<number, string>();
    const utf16 = (hex: string) => Buffer.from(hex, "hex").swap16().toString("utf16le");
    for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
      for (const r of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g)) {
        const start = parseInt(r[1]!, 16);
        [...r[3]!.matchAll(/<([0-9a-fA-F\s]*)>/g)].forEach((h, k) =>
          map.set(start + k, utf16(h[1]!.replace(/\s/g, ""))),
        );
      }
    for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
      for (const r of block[1]!.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g))
        map.set(parseInt(r[1]!, 16), utf16(r[2]!));
    return map;
  };
  const catalog = [...objects.values()].find((o) => /\/Type \/Catalog/.test(o.dict))!;
  const pagesRoot = objects.get(ref(catalog.dict, "Pages")!)!;
  const kids = [.../\/Kids \[([^\]]*)\]/.exec(pagesRoot.dict)![1]!.matchAll(/(\d+) 0 R/g)].map((k) => Number(k[1]));
  const shown: Shown[] = [];
  const fontFile = new Map<string, Buffer>();
  kids.forEach((pageId, pageIndex) => {
    const page = objects.get(pageId)!;
    const resources = objects.get(ref(page.dict, "Resources")!)!.dict;
    const fonts = new Map<string, { base: string; cmap: Map<number, string> }>();
    for (const f of /\/Font << ([^>]*) >>/.exec(resources)![1]!.matchAll(/\/(\w+) (\d+) 0 R/g)) {
      const fontDict = objects.get(Number(f[2]))!.dict;
      const base = /\/BaseFont \/([\w+-]+)/.exec(fontDict)![1]!;
      const descendant = objects.get(Number(/\/DescendantFonts \[(\d+) 0 R\]/.exec(fontDict)![1]))!.dict;
      const descriptor = objects.get(ref(descendant, "FontDescriptor")!)!.dict;
      fontFile.set(base, objects.get(ref(descriptor, "FontFile2")!)!.stream!);
      fonts.set(f[1]!, { base, cmap: cmapOf(ref(fontDict, "ToUnicode")!) });
    }
    const content = objects.get(ref(page.dict, "Contents")!)!.stream!.toString("latin1");
    let x = 0;
    let y = 0;
    let font = "";
    for (const op of content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm|\/(\w+) [\d.]+ Tf|\[([^\]]*)\] TJ/g)) {
      if (op[1] !== undefined) {
        x = Number(op[1]);
        y = Number(op[2]);
      } else if (op[3] !== undefined) font = op[3];
      else {
        const f = fonts.get(font)!;
        const gids = [...op[4]!.matchAll(/<([0-9a-fA-F]+)>/g)].flatMap((h) =>
          (h[1]!.match(/.{4}/g) ?? []).map((g) => parseInt(g, 16)),
        );
        const chars = gids.map((g) => f.cmap.get(g) ?? "?");
        shown.push({
          page: pageIndex + 1,
          x,
          y,
          font,
          baseFont: f.base,
          gids,
          text: chars.join(""),
          logical: [...chars].reverse().join(""),
        });
      }
    }
  });
  return { raw, objects, shown, pages: kids.length, fontFile };
}

/** The visual lines of a page: pieces at one baseline, left to right. */
export function lines(pdf: ReadPdf, page?: number): string[] {
  const rows = new Map<string, Shown[]>();
  for (const s of pdf.shown) {
    if (page !== undefined && s.page !== page) continue;
    const key = `${s.page}:${s.y.toFixed(1)}`;
    rows.set(key, [...(rows.get(key) ?? []), s]);
  }
  return [...rows.values()].map((r) =>
    r
      .sort((a, b) => a.x - b.x)
      .map((s) => s.text)
      .join(""),
  );
}

export const rev = (s: string) => Array.from(s).reverse().join("");
/** Arabic text without its diacritics (tanween, shadda, ...), which the PDF draws as separately positioned glyphs. */
export const plain = (s: string) => s.replace(/[\u064B-\u065F\u0670]/g, "");
/** True when a drawn right-to-left run on `page` (any page when omitted) contains the Arabic `text`. */
export const drawsArabic = (pdf: ReadPdf, text: string, page?: number) =>
  pdf.shown.some((s) => (page === undefined || s.page === page) && plain(s.logical).includes(plain(text)));
