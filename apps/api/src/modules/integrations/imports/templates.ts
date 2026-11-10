// Import templates (ADR-0056 §9; REQ-S17-003 "CSV/XLSX templates are downloadable"; p6-work-split §B/A.5; T-DG6-BE-M2).
//
//   listImportTemplates     every registered template with its columns (key, English and Arabic labels, required, kind,
//                           example) and the two file media types;
//   downloadImportTemplate  the template as a CSV or XLSX file, prefilled with one row per active KPI of the
//                           transformation (KPI id, KPI name and its entry scope; every value empty).
//
// The file is laid out exactly as the import engine reads it, so a downloaded template re-imports without a whole-file
// refusal: the header (row 1) is the column keys in template order; data rows follow. The XLSX's FIRST worksheet is that
// table (the engine reads the first worksheet only); a second, right-to-left worksheet "Column labels" lists each
// column's English and Arabic label, whether it is required and its example, so the Arabic labels travel with the file
// without adding a row the engine would read as data (ADR-0056 §9 "the Arabic label row ... only in XLSX"; see the
// T-DG6-BE-M2 handback). The CSV keeps one header row.
//
// Writers. The API process does not load @mth/reporting's renderers (ADR-0046 §1; architecture.testkit.ts allows the
// `@mth/reporting/storage` subpath only), so the two small writers below apply the P5 export rules themselves, as
// forms/export.ts does: RFC 4180 quoting, UTF-8 with a byte-order mark and CRLF line ends for CSV; for XLSX, text is
// always an inline string (never a formula element), and a text that starts like a formula (= + - @ TAB CR) is written
// with the leading apostrophe in CSV and the `quotePrefix` style in XLSX (ADR-0046 §4). The ZIP container is written
// with node:zlib (deflate and CRC-32), no dependency, with a fixed entry date so the bytes are deterministic.
import { crc32, deflateRawSync } from "node:zlib";
import type { DbOrTx } from "@mth/db";
import { CSV_MEDIA_TYPE, XLSX_MEDIA_TYPE, type ImportColumn, type ImportTarget } from "./targets.ts";

/** The contract's `ImportTemplateColumn` (the port's `informational` flag is not part of the contract). */
export function toTemplateColumn(c: ImportColumn) {
  return {
    key: c.key,
    labelEn: c.labelEn,
    labelAr: c.labelAr,
    required: c.required,
    kind: c.kind,
    example: c.example,
  };
}

/** The contract's `ImportTemplate`. */
export function toImportTemplate(t: ImportTarget) {
  return {
    templateVersion: t.templateVersion,
    targetKind: t.kind,
    titleEn: t.titleEn,
    titleAr: t.titleAr,
    mediaTypes: [CSV_MEDIA_TYPE, XLSX_MEDIA_TYPE] as const,
    columns: t.columns.map(toTemplateColumn),
  };
}

// ------------------------------------------------------------------------------------------------ prefill

/** One prefilled row: cells by column key (text); every other column is empty. */
export type TemplateRow = Readonly<Record<string, string>>;

/**
 * The prefill rows of a template in a transformation the caller can read (the route's read gate has admitted it): for
 * `kpi_actual`, one row per KPI with an active version, ordered by name and id, with its id, name and entry scope kind
 * (and, for a transformation-level KPI, the transformation as its scope id). Read-only.
 */
export async function templateRows(db: DbOrTx, target: ImportTarget, transformationId: string): Promise<TemplateRow[]> {
  if (target.kind !== "kpi_actual") return [];
  const kpis = await db
    .selectFrom("kpi_definition as d")
    .innerJoin("kpi_version as v", (j) => j.onRef("v.kpi_definition_id", "=", "d.id").on("v.status", "=", "active"))
    .select(["d.id", "d.name", "v.entry_scope_kind"])
    .where("d.transformation_id", "=", transformationId)
    .where("d.archived_at", "is", null)
    .orderBy("d.name")
    .orderBy("d.id")
    .execute();
  return kpis.map((k) => ({
    kpi_id: k.id,
    kpi_name: k.name,
    scope_kind: k.entry_scope_kind,
    ...(k.entry_scope_kind === "transformation" ? { scope_id: transformationId } : {}),
  }));
}

const cellOf = (row: TemplateRow, key: string): string => {
  for (const [k, v] of Object.entries(row)) if (k === key) return v;
  return "";
};

// ------------------------------------------------------------------------------------------------ CSV

const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"]);
const startsLikeFormula = (text: string): boolean => text.length > 0 && FORMULA_TRIGGERS.has(text[0]!);

/** RFC 4180 quoting of one field (quoted when it holds a comma, a double quote, CR or LF; quotes doubled). */
export function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** A text cell of a template CSV: neutralized with a leading apostrophe when it starts like a formula. */
const csvText = (text: string): string => csvField(startsLikeFormula(text) ? `'${text}` : text);

/** The template as CSV: UTF-8 with a byte-order mark, CRLF line ends, the column keys on row 1. */
export function templateCsv(target: ImportTarget, rows: readonly TemplateRow[]): Uint8Array {
  const keys = target.columns.map((c) => c.key);
  const lines = [keys.map(csvText).join(","), ...rows.map((r) => keys.map((k) => csvText(cellOf(r, k))).join(","))];
  return new TextEncoder().encode(`\uFEFF${lines.join("\r\n")}\r\n`);
}

// ------------------------------------------------------------------------------------------------ XLSX

const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

/** Characters XML 1.0 cannot carry become U+FFFD; then the five escapes and CR as a reference. */
function xmlText(s: string): string {
  const safe = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "\uFFFD");
  return safe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;");
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** One worksheet: rows of texts; `bold` rows use style 2. Every cell is an inline string. */
export interface XlsxSheet {
  readonly name: string;
  readonly rtl: boolean;
  readonly rows: readonly (readonly string[])[];
  /** Row indexes (0-based) written bold. */
  readonly boldRows?: readonly number[];
}

/** Style ids: 0 regular, 1 regular + quotePrefix, 2 bold, 3 bold + quotePrefix. */
function cellXml(text: string, ref: string, bold: boolean): string {
  if (text.length === 0) return "";
  const s = (bold ? 2 : 0) + (startsLikeFormula(text) ? 1 : 0);
  return `<c r="${ref}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${xmlText(text)}</t></is></c>`;
}

function worksheetXml(sheet: XlsxSheet): string {
  const bold = new Set(sheet.boldRows ?? []);
  const body = sheet.rows
    .map((cells, i) => {
      const xml = cells.map((c, j) => cellXml(c, `${columnName(j)}${i + 1}`, bold.has(i))).join("");
      return `<row r="${i + 1}">${xml}</row>`;
    })
    .join("");
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  return (
    XML_HEAD +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheetViews><sheetView workbookViewId="0"${sheet.rtl ? ' rightToLeft="1"' : ""}/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="${width}" width="28" customWidth="1"/></cols>` +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES_XML =
  XML_HEAD +
  `<styleSheet xmlns="${MAIN_NS}">` +
  `<fonts count="2"><font><sz val="11"/><name val="IBM Plex Sans"/></font><font><b/><sz val="11"/><name val="IBM Plex Sans"/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="4">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" quotePrefix="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

// 1980-01-01 00:00 in MS-DOS date/time: the fixed entry date that keeps the bytes deterministic.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/** A ZIP archive of the parts (deflate, CRC-32), written with node:zlib. */
export function zipParts(parts: ReadonlyArray<readonly [string, string]>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of parts) {
    const raw = Buffer.from(text, "utf8");
    const body = deflateRawSync(raw);
    const name = Buffer.from(path, "utf8");
    const crc = crc32(raw) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

/** A workbook of text-only worksheets (the first one is the one the import engine reads). */
export function xlsxWorkbook(sheets: readonly XlsxSheet[]): Uint8Array {
  const n = sheets.length;
  const contentTypes =
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
    `</Types>`;
  const rootRels =
    XML_HEAD +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const workbook =
    XML_HEAD +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>` +
    sheets.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    `</sheets></workbook>`;
  const workbookRels =
    XML_HEAD +
    `<Relationships xmlns="${PKG_REL_NS}">` +
    sheets
      .map(
        (_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${n + 1}" Type="${REL_NS}/styles" Target="styles.xml"/></Relationships>`;
  return zipParts([
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", workbookRels],
    ["xl/styles.xml", STYLES_XML],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(s)] as const),
  ]);
}

/** The template as XLSX: sheet 1 the table (keys on row 1), sheet 2 the bilingual column labels (right-to-left). */
export function templateXlsx(target: ImportTarget, rows: readonly TemplateRow[]): Uint8Array {
  const keys = target.columns.map((c) => c.key);
  const table: XlsxSheet = {
    name: "Data",
    rtl: false,
    rows: [keys, ...rows.map((r) => keys.map((k) => cellOf(r, k)))],
    boldRows: [0],
  };
  const labels: XlsxSheet = {
    name: "Column labels",
    rtl: true,
    rows: [
      ["column", "English", "العربية", "required", "example"],
      ...target.columns.map((c) => [c.key, c.labelEn, c.labelAr, c.required ? "yes" : "no", c.example ?? ""]),
    ],
    boldRows: [0],
  };
  return xlsxWorkbook([table, labels]);
}

/** The file name of a downloaded template: "<template version>-template.<format>". */
export const templateFileName = (target: ImportTarget, format: "csv" | "xlsx"): string =>
  `${target.templateVersion}-template.${format}`;
