// The text of one rendered export (T-DG5-BE-R2; ADR-0049 §7 (c)): what a reader of the file sees, per format, read
// back with the reporting package's own test readers (pdf/read.ts, xlsx/read.ts, ooxml-read.ts). For a PDF both the
// drawing order and the logical (right-to-left) order of every glyph run are returned, and the visual lines, so an
// Arabic run is scanned in reading order.
import type { ExportFormat } from "../../../../packages/reporting/src/model.ts";
import { readOoxml, xmlTexts } from "../../../../packages/reporting/src/ooxml-read.ts";
import { lines, readPdf } from "../../../../packages/reporting/src/pdf/read.ts";
import { readXlsx } from "../../../../packages/reporting/src/xlsx/read.ts";
import type { ProductText } from "./scan.ts";

export async function renderedTexts(where: string, format: ExportFormat, bytes: Uint8Array): Promise<ProductText[]> {
  const at = (part: string, text: string): ProductText => ({ where: `${where}#${part}`, text });
  switch (format) {
    case "csv":
      return new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .split(/\r?\n/)
        .map((line, i) => at(`line ${i + 1}`, line));
    case "xlsx": {
      const wb = await readXlsx(bytes);
      return wb.sheets.flatMap((s) => [
        at(`sheet ${s.name}`, s.name),
        ...s.rows.flatMap((row) =>
          row.flatMap((c) => [c.text, c.value].filter((t) => t !== null).map((t) => at(`${s.name}!${c.ref}`, t!))),
        ),
      ]);
    }
    case "docx":
    case "pptx": {
      const pkg = await readOoxml(bytes, format === "docx" ? /^word\/.*\.xml$/ : /^ppt\/.*\.xml$/);
      return [...pkg.parts].flatMap(([name, xml]) => {
        const runs = xmlTexts(xml);
        // A paragraph's runs joined as written (one phrase may span runs); paragraphs (cells, lines) stay apart.
        const paragraphs = xml
          .split(/<\/(?:w|a):p>/)
          .map((p) => xmlTexts(p).join(""))
          .filter((p) => p.length > 0);
        return [
          ...runs.map((t, i) => at(`${name} run ${i + 1}`, t)),
          ...paragraphs.map((t, i) => at(`${name} paragraph ${i + 1}`, t)),
        ];
      });
    }
    case "pdf": {
      const pdf = readPdf(bytes);
      // The logical lines: the pieces of one baseline from right to left, each right-to-left run in its logical order
      // (an Arabic line is drawn in visual order), joined as drawn and also with a space between pieces.
      const rows = new Map<string, typeof pdf.shown>();
      for (const s of pdf.shown) {
        const key = `${s.page}:${s.y.toFixed(1)}`;
        rows.set(key, [...(rows.get(key) ?? []), s]);
      }
      const logicalLines = [...rows.values()].flatMap((r) => {
        const pieces = [...r]
          .sort((a, b) => b.x - a.x)
          .map((s) => (/[\u0590-\u08FF]/.test(s.logical) ? s.logical : s.text));
        return [pieces.join(""), pieces.join(" ")];
      });
      return [
        ...pdf.shown.flatMap((s, i) => [at(`run ${i + 1}`, s.text), at(`run ${i + 1} (logical)`, s.logical)]),
        ...lines(pdf).map((l, i) => at(`line ${i + 1}`, l)),
        ...logicalLines.map((l, i) => at(`logical line ${Math.floor(i / 2) + 1}`, l)),
      ];
    }
  }
}
