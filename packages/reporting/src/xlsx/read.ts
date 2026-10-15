// A minimal XLSX reader for tests only (excluded from the build): reads back the parts this package writes, so a test
// can compare an exported workbook cell by cell. It understands exactly the SpreadsheetML subset of sheet.ts.
import JSZip from "jszip";

export interface ReadCell {
  readonly ref: string;
  readonly type: string | null;
  readonly style: number;
  readonly formula: string | null;
  readonly value: string | null;
  readonly text: string | null;
}

export interface ReadSheet {
  readonly name: string;
  readonly rtl: boolean;
  readonly xml: string;
  readonly rows: ReadCell[][];
}

export interface ReadWorkbook {
  readonly sheets: ReadSheet[];
  readonly styles: string;
  readonly files: string[];
  /** cellXfs index -> has quotePrefix */
  readonly quotePrefix: boolean[];
  /** cellXfs index -> italic font */
  readonly italic: boolean[];
}

const unescape = (s: string) =>
  s
    .replace(/&#13;/g, "\r")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

export async function readXlsx(bytes: Uint8Array): Promise<ReadWorkbook> {
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.keys(zip.files).sort();
  const workbook = await zip.file("xl/workbook.xml")!.async("string");
  const names = [...workbook.matchAll(/<sheet name="([^"]*)" sheetId="(\d+)"/g)].map((m) => unescape(m[1]!));
  const sheets: ReadSheet[] = [];
  for (let i = 0; i < names.length; i++) {
    const xml = await zip.file(`xl/worksheets/sheet${i + 1}.xml`)!.async("string");
    const rows = [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map((r) =>
      [...r[1]!.matchAll(/<c r="([A-Z]+\d+)"(?: t="(\w+)")? s="(\d+)">(.*?)<\/c>/g)].map((c) => {
        const inner = c[4]!;
        const f = /<f>(.*?)<\/f>/.exec(inner);
        const v = /<v>(.*?)<\/v>/.exec(inner);
        const t = /<t xml:space="preserve">([\s\S]*?)<\/t>/.exec(inner);
        return {
          ref: c[1]!,
          type: c[2] ?? null,
          style: Number(c[3]),
          formula: f ? f[1]! : null,
          value: v ? v[1]! : null,
          text: t ? unescape(t[1]!) : null,
        };
      }),
    );
    sheets.push({ name: names[i]!, rtl: xml.includes('rightToLeft="1"'), xml, rows });
  }
  const styles = await zip.file("xl/styles.xml")!.async("string");
  const fonts = [...styles.matchAll(/<font>(.*?)<\/font>/g)].map((m) => m[1]!.includes("<i/>"));
  const xfs = [...(/<cellXfs[^>]*>(.*?)<\/cellXfs>/.exec(styles)?.[1] ?? "").matchAll(/<xf ([^>]*)\/>/g)].map(
    (m) => m[1]!,
  );
  return {
    sheets,
    styles,
    files,
    quotePrefix: xfs.map((x) => x.includes('quotePrefix="1"')),
    italic: xfs.map((x) => fonts[Number(/fontId="(\d+)"/.exec(x)?.[1] ?? 0)] === true),
  };
}

/** The display text of a read cell (inline string, number or cached formula value). */
export const cellText = (c: ReadCell | undefined): string | null => (c === undefined ? null : (c.text ?? c.value));
