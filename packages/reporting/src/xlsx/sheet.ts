// SpreadsheetML worksheet and style parts of the own XLSX writer (ADR-0046 §3, §4, §7; REQ-S13-006).
//
// Cells: text is ALWAYS an inline string (`t="inlineStr"`), never a `<f>` element; a text that starts like a formula
// also gets the `quotePrefix` style, so a spreadsheet application keeps it as text when the cell is edited. A number is
// a `<v>` with the canonical decimal string. The ONLY formula this writer emits is a declared total, written from a
// fixed template: `SUM(<col><first>:<col><last>)` over one contiguous range of the same column of the same sheet, with
// the decimal.js total as its cached value. No user text ever reaches the formula template (it takes only integers).
import type { SheetCell } from "../model.ts";
import { xmlSafe } from "../xml-chars.ts";

export const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * Escapes text content and attribute values; CR is a character reference so XML end-of-line handling keeps it. Characters
 * XML 1.0 cannot carry are replaced by U+FFFD first (xml-chars.ts `xmlSafe`, the rule the DOCX and PPTX writers share).
 */
export function xmlText(s: string): string {
  return xmlSafe(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;");
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Style ids: bold * 4 + italic * 2 + quotePrefix (cellXfs order in stylesXml). */
export function styleId(o: { bold?: boolean; italic?: boolean; quotePrefix?: boolean }): number {
  return (o.bold ? 4 : 0) + (o.italic ? 2 : 0) + (o.quotePrefix ? 1 : 0);
}

/** The SUM template: integers only, one contiguous range of one column. */
export function sumFormula(column: number, firstRow: number, lastRow: number): string {
  if (
    ![column, firstRow, lastRow].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    firstRow < 1 ||
    lastRow < firstRow
  )
    throw new Error("xlsx: invalid SUM range");
  const c = columnName(column);
  return `SUM(${c}${firstRow}:${c}${lastRow})`;
}

/** One `<c>` element (an empty cell is omitted). `rowIndex` is 1-based, `col` 0-based. */
export function cellXml(cell: SheetCell, rowIndex: number, col: number, bold = false): string {
  const ref = `${columnName(col)}${rowIndex}`;
  switch (cell.kind) {
    case "empty":
      return "";
    case "number":
      return `<c r="${ref}" s="${styleId({ bold, italic: cell.italic })}"><v>${cell.value}</v></c>`;
    case "sum":
      return `<c r="${ref}" s="${styleId({ bold: true })}"><f>${sumFormula(cell.column, cell.firstRow, cell.lastRow)}</f><v>${cell.cached}</v></c>`;
    case "text":
      return (
        `<c r="${ref}" t="inlineStr" s="${styleId({ bold, italic: cell.italic, quotePrefix: cell.quotePrefix })}">` +
        `<is><t xml:space="preserve">${xmlText(cell.text)}</t></is></c>`
      );
  }
}

export interface SheetRow {
  readonly cells: readonly SheetCell[];
  readonly bold?: boolean;
}

/** A worksheet part; `rtl` sets `<sheetView rightToLeft="1">` (Arabic). */
export function worksheetXml(rows: readonly SheetRow[], rtl: boolean, width: number): string {
  const body = rows
    .map((r, i) => {
      const cells = r.cells.map((c, j) => cellXml(c, i + 1, j, r.bold === true)).join("");
      return `<row r="${i + 1}">${cells}</row>`;
    })
    .join("");
  const cols = width > 0 ? `<cols><col min="1" max="${width}" width="28" customWidth="1"/></cols>` : "";
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ""}/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${body}</sheetData></worksheet>`
  );
}

/** The styles part: four fonts (regular, italic, bold, bold italic) in the export font, eight cell formats. */
export function stylesXml(fontName: string): string {
  const font = (b: boolean, i: boolean) =>
    `<font>${b ? "<b/>" : ""}${i ? "<i/>" : ""}<sz val="11"/><name val="${xmlText(fontName)}"/></font>`;
  // fontId: bold * 2 + italic.
  const fonts = [font(false, false), font(false, true), font(true, false), font(true, true)].join("");
  const xfs: string[] = [];
  for (let id = 0; id < 8; id++) {
    const bold = (id & 4) !== 0;
    const italic = (id & 2) !== 0;
    const quote = (id & 1) !== 0;
    const fontId = (bold ? 2 : 0) + (italic ? 1 : 0);
    xfs.push(
      `<xf numFmtId="0" fontId="${fontId}" fillId="0" borderId="0" xfId="0"${fontId > 0 ? ' applyFont="1"' : ""}${quote ? ' quotePrefix="1"' : ""}/>`,
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<styleSheet xmlns="${MAIN_NS}">` +
    `<fonts count="4">${fonts}</fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="8">${xfs.join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`
  );
}
