// The XLSX writer (ADR-0046 §3, §4, §7): SpreadsheetML parts (content types, relationships, workbook, styles, one
// worksheet per part) zipped with jszip. No spreadsheet library: formula handling stays in our code (sheet.ts).
//
// Sheets: "About" (the header block, then every non-table section in content order), one sheet per table section (its
// column header, data rows in document order and its totals row), and "Legend" (the validation labels). Arabic sheets
// are right-to-left (`<sheetView rightToLeft="1">`); the named font is IBM Plex Sans Arabic (Arabic) or IBM Plex Sans
// (English). Spreadsheets do not embed fonts.
//
// The bytes are deterministic for one snapshot, format and language: each zip entry is dated with the snapshot's
// as-of time, never the render time.
import JSZip from "jszip";
import { reportDocument, type ReportDocument } from "@mth/shared/schemas";
import { createLabels } from "../labels.ts";
import {
  EXPORT_CONTENT_TYPES,
  RenderError,
  emptyTableText,
  frameRows,
  legendRows,
  sectionRows,
  tableColumns,
  tableRowCells,
  textCell,
  totalRowCells,
  type RenderOptions,
  type RenderResult,
  type SheetCell,
} from "../model.ts";
import { REL_NS, MAIN_NS, stylesXml, worksheetXml, xmlText, type SheetRow } from "./sheet.ts";

export { cellXml, columnName, sumFormula, styleId, worksheetXml, xmlText } from "./sheet.ts";

export const XLSX_FONTS = { en: "IBM Plex Sans", ar: "IBM Plex Sans Arabic" } as const;

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

/** A sheet name: at most 31 characters, none of `[]:*?/\`, unique in the workbook (case-insensitive). */
export function sheetName(wanted: string, taken: Set<string>): string {
  const base =
    wanted
      .replace(/[[\]:*?/\\]/g, " ")
      .trim()
      .slice(0, 31) || "Sheet";
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

interface Sheet {
  readonly name: string;
  readonly rows: SheetRow[];
  readonly width: number;
}

const texts = (...t: string[]): SheetCell[] => t.map((x) => textCell(x));

export async function renderXlsx(input: ReportDocument, o: RenderOptions): Promise<RenderResult> {
  const parsed = reportDocument.safeParse(input);
  if (!parsed.success) throw new RenderError("the snapshot content is not a valid report document");
  const doc = parsed.data;
  const labels = createLabels(o.language, o.labels);
  const taken = new Set<string>();
  const about: Sheet = { name: sheetName(labels.text("export.sheet.about"), taken), rows: [], width: 3 };
  for (const [label, value] of frameRows(doc, o, labels)) about.rows.push({ cells: texts(label, value) });
  const sheets: Sheet[] = [about];
  const total = doc.sections.length;
  let done = 0;
  for (const s of doc.sections) {
    const title = labels.text(s.titleKey);
    if (s.kind === "table") {
      const cols = tableColumns(s, labels);
      const sheet: Sheet = { name: sheetName(title, taken), rows: [], width: cols.length };
      sheet.rows.push({ cells: texts(title), bold: true });
      sheet.rows.push({ cells: texts(...cols.map((c) => c.label)), bold: true });
      const first = sheet.rows.length + 1;
      if (s.rows.length === 0) sheet.rows.push({ cells: texts(emptyTableText(s, labels)) });
      for (const r of s.rows) sheet.rows.push({ cells: tableRowCells(cols, r.cells, labels) });
      const last = sheet.rows.length;
      const totals = totalRowCells(s, cols, labels, first, last);
      if (totals !== null) sheet.rows.push({ cells: totals, bold: true });
      sheets.push(sheet);
    } else {
      about.rows.push({ cells: [] });
      about.rows.push({ cells: texts(title), bold: true });
      for (const row of sectionRows(s, labels)) about.rows.push({ cells: row });
    }
    done += 1;
    await o.onSection?.(done, total);
  }
  const legend: Sheet = { name: sheetName(labels.text("export.sheet.legend"), taken), rows: [], width: 2 };
  legend.rows.push({ cells: texts(labels.text("export.legend.title")), bold: true });
  for (const [label, text] of legendRows(labels)) legend.rows.push({ cells: texts(label, text) });
  sheets.push(legend);

  const rtl = o.language === "ar";
  const zip = new JSZip();
  const date = new Date(doc.asOf);
  const add = (path: string, xml: string) => zip.file(path, xml, { date, createFolders: false });
  add(
    "[Content_Types].xml",
    XML_HEAD +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("") +
      `</Types>`,
  );
  add(
    "_rels/.rels",
    XML_HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  add(
    "xl/workbook.xml",
    XML_HEAD +
      `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>` +
      sheets.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      `</sheets></workbook>`,
  );
  add(
    "xl/_rels/workbook.xml.rels",
    XML_HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      sheets
        .map(
          (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join("") +
      `<Relationship Id="rId${sheets.length + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`,
  );
  add("xl/styles.xml", stylesXml(XLSX_FONTS[o.language]));
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(s.rows, rtl, s.width)));
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return {
    bytes,
    contentType: EXPORT_CONTENT_TYPES.xlsx,
    extension: "xlsx",
    sections: total,
    missingLabels: [...labels.missing].sort(),
  };
}
