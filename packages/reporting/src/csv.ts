// CSV writer (ADR-0046 §3, §4; REQ-S13-005, REQ-S13-006). UTF-8 with a byte-order mark, CRLF line ends, RFC 4180
// quoting (a field is quoted when it contains a comma, a double quote, CR or LF; quotes are doubled). Header labels are
// in the export language; CSV has no direction and no font.
//
// Layout: the header block (label, value), then every section in content order (its title, then its rows: a table's
// column header, data rows and totals; a fields/metrics section's label, value and status rows), then the legend rows.
// Cells follow ADR-0046 §4 exactly: text that starts like a formula is prefixed with `'`; a decimal is its canonical
// string, unprefixed; Unknown/Stale is an empty field with its status in the companion column; a total is its
// decimal.js value (CSV has no formulas).
import { reportDocument, type ReportDocument } from "@mth/shared/schemas";
import { neutralizeSpreadsheetText } from "./injection.ts";
import { createLabels } from "./labels.ts";
import {
  EXPORT_CONTENT_TYPES,
  RenderError,
  emptyTableText,
  frameRows,
  legendRows,
  sectionRows,
  tableColumns,
  tableRowCells,
  totalRowCells,
  type RenderOptions,
  type RenderResult,
  type SheetCell,
} from "./model.ts";

const BOM = "﻿";
const CRLF = "\r\n";

/** RFC 4180 quoting of one field. */
export function csvField(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV field of a sheet cell (ADR-0046 §4 CSV column). */
export function csvCell(c: SheetCell): string {
  switch (c.kind) {
    case "empty":
      return "";
    case "number":
      return c.value;
    case "sum":
      return c.cached;
    case "text":
      return csvField(neutralizeSpreadsheetText(c.text).text);
  }
}

const textRow = (...texts: string[]): string =>
  texts.map((t) => csvCell({ kind: "text", text: t, quotePrefix: false, italic: false })).join(",");

export async function renderCsv(input: ReportDocument, o: RenderOptions): Promise<RenderResult> {
  const parsed = reportDocument.safeParse(input);
  if (!parsed.success) throw new RenderError("the snapshot content is not a valid report document");
  const doc = parsed.data;
  const labels = createLabels(o.language, o.labels);
  const lines: string[] = [];
  for (const [label, value] of frameRows(doc, o, labels)) lines.push(textRow(label, value));
  lines.push("");
  const total = doc.sections.length;
  let done = 0;
  for (const s of doc.sections) {
    lines.push(textRow(labels.text(s.titleKey)));
    if (s.kind === "table") {
      const cols = tableColumns(s, labels);
      lines.push(textRow(...cols.map((c) => c.label)));
      if (s.rows.length === 0) lines.push(textRow(emptyTableText(s, labels)));
      for (const r of s.rows) lines.push(tableRowCells(cols, r.cells, labels).map(csvCell).join(","));
      const totals = totalRowCells(s, cols, labels, 0, 0);
      if (totals !== null) lines.push(totals.map(csvCell).join(","));
    } else {
      for (const row of sectionRows(s, labels)) lines.push(row.map(csvCell).join(","));
    }
    lines.push("");
    done += 1;
    await o.onSection?.(done, total);
  }
  lines.push(textRow(labels.text("export.legend.title")));
  for (const [label, text] of legendRows(labels)) lines.push(textRow(label, text));
  const body = BOM + lines.join(CRLF) + CRLF;
  return {
    bytes: new TextEncoder().encode(body),
    contentType: EXPORT_CONTENT_TYPES.csv,
    extension: "csv",
    sections: total,
    missingLabels: [...labels.missing].sort(),
  };
}
