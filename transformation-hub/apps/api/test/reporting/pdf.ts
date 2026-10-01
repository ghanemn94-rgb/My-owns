/**
 * Independent PDF reader for the export tests (AT-24, REQ-RPT-008): pdf.js (pdfjs-dist, a dev dependency — not the
 * Chromium that wrote the file) parses the document, lists the fonts each page really uses and extracts the text.
 *
 * pdf.js returns one item per positioned glyph, in visual order; Arabic glyphs come back as positional presentation forms,
 * and a glyph cluster may map to several letters in either order. So:
 *  - `latin` keeps each line as drawn (left-to-right text, numbers and codes read correctly);
 *  - Arabic labels are matched with {@link hasArabic}: some line holds every letter of the label (NFKC-normalised, as a
 *    multiset). Shaping itself is proven by the presentation-form glyph count and the embedded Arabic font; the visual
 *    check of the rendered pages is recorded in docs/test-evidence.
 */
export interface PdfInfo {
  pages: number;
  fonts: string[];
  /** Fraction of right-to-left text items (pdf.js direction detection). */
  rtlShare: number;
  /** Arabic presentation-form glyphs found (proof of contextual shaping). */
  shapedGlyphs: number;
  latin: string;
  perPage: { latin: string; lines: string[] }[];
  title: string | null;
  language: string | null;
}

const strip = (s: string) => s.replace(/\s+/g, '');
export const norm = (s: string) => strip(s.normalize('NFKC'));
const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-﻿]/;

function bag(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of norm(s)) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}

/** True when one line of the given pages contains every letter of `label` (as many times as the label has it). */
export function hasArabic(info: PdfInfo, label: string, page?: number): boolean {
  const want = bag(label);
  const lines = page === undefined ? info.perPage.flatMap((p) => p.lines) : (info.perPage[page]?.lines ?? []);
  return lines.some((l) => {
    const have = bag(l);
    for (const [c, n] of want) if ((have.get(c) ?? 0) < n) return false;
    return true;
  });
}

export async function readPdf(bytes: Buffer): Promise<PdfInfo> {
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('not a PDF (no %PDF- header)');
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as typeof import('pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false }).promise;
  const meta = (await doc.getMetadata()).info as { Title?: string; Language?: string };
  const fonts = new Set<string>();
  const perPage: { latin: string; lines: string[] }[] = [];
  let rtl = 0;
  let items = 0;
  let shaped = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const lines = new Map<number, string[]>();
    for (const it of tc.items as { str: string; dir: string; transform: number[] }[]) {
      if (!it.str) continue;
      items++;
      if (it.dir === 'rtl') rtl++;
      shaped += [...it.str].filter((c) => PRESENTATION_FORMS.test(c)).length;
      const y = Math.round(it.transform[5]!);
      (lines.get(y) ?? lines.set(y, []).get(y)!).push(it.str);
    }
    const visual = [...lines.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => norm(l.join('')));
    perPage.push({ latin: visual.join('\n'), lines: visual });
    const ops = await page.getOperatorList();
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (ops.fnArray[k] !== pdfjs.OPS.setFont) continue;
      const font = page.commonObjs.get((ops.argsArray[k] as string[])[0]!) as { name?: string; missingFile?: boolean };
      if (font?.name) fonts.add(`${font.name.replace(/^[A-Z]{6}\+/, '')}${font.missingFile ? ' (not embedded)' : ''}`);
    }
  }
  return {
    pages: doc.numPages,
    fonts: [...fonts].sort(),
    rtlShare: items ? rtl / items : 0,
    shapedGlyphs: shaped,
    latin: perPage.map((p) => p.latin).join('\n'),
    perPage,
    title: meta.Title ?? null,
    language: meta.Language ?? null,
  };
}
