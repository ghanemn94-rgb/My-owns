// The renderer contract and what every format shares (ADR-0046 §1-§4, §9; ADR-0045 §3, §5).
//
// A renderer is pure: it gets the stored document model of ONE report snapshot (validated again here), the export
// language, the label tables, the branding and the snapshot's identity, and returns the file's bytes. It reads no
// database, makes no network call and holds no transaction (p5-work-split §F.11 item 5).
//
// Values follow ADR-0046 §4/§9: numbers are the canonical decimal strings of the document (never floats, never
// re-rounded); Unknown and Stale never print a number (an empty spreadsheet cell with its status label, never 0);
// provisional values are labelled; every decimal column of a table gets a companion status column.
import { Decimal } from "decimal.js";
import type { ReportDocument, ReportSection, ReportTableSection, ReportValue } from "@mth/shared/schemas";
import { neutralizeSpreadsheetText } from "./injection.ts";
import type { ExportLanguage, LabelTable, Labels } from "./labels.ts";

export const EXPORT_FORMATS = ["pdf", "docx", "xlsx", "pptx", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The content type stored with a file (equal to the 0081 `export_job_content_type_matches` CHECK). */
export const EXPORT_CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv; charset=utf-8",
};

export interface SnapshotIdentity {
  readonly id: string;
  readonly status: "generated" | "issued" | "superseded" | "discarded";
  readonly issueVersion: number | null;
}

export interface RenderOptions {
  readonly format: ExportFormat;
  readonly language: ExportLanguage;
  /** The output's title in the export language (the report definition's label). */
  readonly title: string;
  /** The product name (slice I's branding port once BE-R ships it; until then the DG1 product name). */
  readonly branding: { readonly productName: string };
  readonly snapshot: SnapshotIdentity;
  /** IANA time zone the as-of time is printed in (default Asia/Riyadh). */
  readonly timeZone?: string;
  /** The content label table (`report.*` keys); the frame labels are built in (labels.ts). */
  readonly labels?: LabelTable;
  /**
   * Called after each section is rendered (`done` of `total`); awaited, so the caller can record progress and stop
   * a cancelled export by throwing.
   */
  readonly onSection?: (done: number, total: number) => void | Promise<void>;
}

export interface RenderResult {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly extension: ExportFormat;
  /** The number of document sections rendered. */
  readonly sections: number;
  /** Label keys that no table translated (shown by the fallback). */
  readonly missingLabels: readonly string[];
}

/** A renderer's own validation error: retrying cannot fix it (the job fails with export.render_failed at once). */
export class RenderError extends Error {
  readonly code = "export.render_failed";
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

// ------------------------------------------------------------------------------------------------ the frame

/** `2026-10-15 13:45 (Asia/Riyadh)`, Latin digits in both languages (ADR-0046 §3). */
export function formatAsOf(isoTime: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB-u-nu-latn", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(isoTime));
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")} (${timeZone})`;
}

/** The issue line: the issue version, or "Draft — not an issued report" for a generated snapshot (ADR-0046 §2). */
export function issueLine(s: SnapshotIdentity, labels: Labels): string {
  if (s.status === "issued" && s.issueVersion !== null)
    return labels.text("export.issue_version", { n: s.issueVersion });
  if (s.status === "superseded" && s.issueVersion !== null)
    return labels.text("export.superseded", { n: s.issueVersion });
  return labels.text("export.draft");
}

/** The header block every file carries (ADR-0046 §2), as label/value pairs in the export language. */
export function frameRows(doc: ReportDocument, o: RenderOptions, labels: Labels): [string, string][] {
  const tz = o.timeZone ?? "Asia/Riyadh";
  const subject = doc.subject.code === null ? doc.subject.label : `${doc.subject.code} — ${doc.subject.label}`;
  const period = doc.period === null ? "" : `${doc.period.label} (${doc.period.start} – ${doc.period.end})`;
  return [
    [labels.text("export.product"), o.branding.productName],
    [labels.text("export.output"), o.title],
    [labels.text("export.transformation"), `${doc.transformation.code} — ${doc.transformation.name}`],
    [labels.text("export.subject"), subject],
    [labels.text("export.period"), period],
    [labels.text("export.as_of"), formatAsOf(doc.asOf, tz)],
    [labels.text("export.snapshot_id"), o.snapshot.id],
    [labels.text("export.issue"), issueLine(o.snapshot, labels)],
    [labels.text("export.methodology_version"), `${doc.methodology.key} v${doc.methodology.versionNo}`],
    [labels.text("export.approval_state"), labels.text(`export.approval.${doc.approvalState}`)],
  ];
}

export const VALIDATION_ORDER = ["validated", "provisional", "unknown", "stale", "not_applicable"] as const;

/** The legend rows: each validation label with its explanation, then the formula note. */
export function legendRows(labels: Labels): [string, string][] {
  return [
    ...VALIDATION_ORDER.map((v): [string, string] => [labels.validation(v), labels.text(`export.legend.${v}`)]),
    ["", labels.text("export.legend.formulas")],
  ];
}

// ------------------------------------------------------------------------------------------------ values

/** The display text of a non-number value (code labels translated; dates and times as ISO 8601). */
export function valueText(v: ReportValue, labels: Labels): string | null {
  if (v.value === null) return null;
  switch (v.type) {
    case "text":
    case "date":
    case "timestamp":
      return v.value;
    case "code":
      return v.labelKey === null ? v.value : labels.text(v.labelKey, undefined, v.value);
    case "decimal":
      return v.value;
    case "count":
      return String(v.value);
  }
}

/** True when a value has no number or text to show (Unknown, Stale, or n/a without a value). */
export const isEmptyValue = (v: ReportValue): boolean => v.value === null;

/** A spreadsheet cell (XLSX and CSV), decided once for both formats (ADR-0046 §4). */
export type SheetCell =
  | { readonly kind: "text"; readonly text: string; readonly quotePrefix: boolean; readonly italic: boolean }
  | { readonly kind: "number"; readonly value: string; readonly italic: boolean }
  | { readonly kind: "empty" }
  | {
      readonly kind: "sum";
      readonly column: number;
      readonly firstRow: number;
      readonly lastRow: number;
      readonly cached: string;
    };

/** A spreadsheet holds a binary double: more than 15 significant digits is written as text (ADR-0046 §4). */
export function fitsDouble(decimal: string): boolean {
  return new Decimal(decimal).sd(true) <= 15;
}

/** A text cell: neutralized when it starts like a formula (the quote prefix; never a formula). */
export function textCell(text: string, italic = false): SheetCell {
  return { kind: "text", text, quotePrefix: neutralizeSpreadsheetText(text).prefixed, italic };
}

/** The spreadsheet cell of one value; Unknown/Stale of a decimal is an empty cell (its status is in the companion). */
export function valueCell(v: ReportValue, labels: Labels): SheetCell {
  const italic = v.validation === "provisional";
  if (v.type === "decimal") {
    if (v.value === null) return { kind: "empty" };
    // A system number: a leading minus is not user text, so it is never prefixed (ADR-0046 §4).
    return fitsDouble(v.value)
      ? { kind: "number", value: v.value, italic }
      : { kind: "text", text: v.value, quotePrefix: false, italic };
  }
  if (v.type === "count")
    return v.value === null ? statusText(v, labels) : { kind: "number", value: String(v.value), italic };
  if (v.value === null) return statusText(v, labels);
  return textCell(valueText(v, labels) ?? "", italic);
}

/** A non-decimal value with no value shows its validation label as text (Unknown, Stale, n/a): never 0. */
function statusText(v: ReportValue, labels: Labels): SheetCell {
  return { kind: "text", text: labels.validation(v.validation), quotePrefix: false, italic: false };
}

/** The companion status of a decimal value (Validated, Provisional, Unknown, Stale, n/a). */
export const statusOf = (v: ReportValue, labels: Labels): string => labels.validation(v.validation);

// ------------------------------------------------------------------------------------------------ tables

export interface SheetColumn {
  readonly label: string;
  /** The document column index this sheet column shows. */
  readonly source: number;
  readonly companion: boolean;
}

/** The sheet columns of a table: every column, each decimal column followed by its "<label> — status" column. */
export function tableColumns(s: ReportTableSection, labels: Labels): SheetColumn[] {
  const out: SheetColumn[] = [];
  s.columns.forEach((c, i) => {
    const label = labels.text(c.labelKey);
    out.push({ label, source: i, companion: false });
    if (c.valueKind === "decimal")
      out.push({ label: `${label} — ${labels.text("export.status_suffix")}`, source: i, companion: true });
  });
  return out;
}

/** One data row of a table as sheet cells (companions filled with the status label). */
export function tableRowCells(
  cols: readonly SheetColumn[],
  cells: readonly ReportValue[],
  labels: Labels,
): SheetCell[] {
  return cols.map((c) => {
    const v = cells[c.source]!;
    return c.companion ? textCell(statusOf(v, labels)) : valueCell(v, labels);
  });
}

/**
 * The totals row of a table (`firstRow`/`lastRow` are the 1-based sheet rows of its data). A declared `sum` total
 * becomes `SUM(<col>first:<col>last)` with the document's decimal.js total as its cached value, but only when the
 * formula computes exactly that total: every data cell of the column is a number and their decimal.js sum equals it.
 * Otherwise (an Unknown row, a number written as text) the total is written as its value only, so the spreadsheet
 * never recomputes a partial total; an Unknown total is an empty cell with its status.
 */
export function totalRowCells(
  s: ReportTableSection,
  cols: readonly SheetColumn[],
  labels: Labels,
  firstRow: number,
  lastRow: number,
  firstSheetColumn = 0,
): SheetCell[] | null {
  if (s.totals.length === 0) return null;
  const byColumn = new Map(s.totals.map((t) => [s.columns.findIndex((c) => c.key === t.columnKey), t] as const));
  return cols.map((c, j): SheetCell => {
    if (j === 0 && !byColumn.has(c.source)) return textCell(labels.text("export.total"));
    const t = byColumn.get(c.source);
    if (t === undefined) return { kind: "empty" };
    if (c.companion) return textCell(statusOf(t.value, labels));
    if (t.value.value === null || t.value.type !== "decimal") return { kind: "empty" };
    const values = s.rows.map((r) => r.cells[c.source]!);
    const numeric = values.every((v) => v.type === "decimal" && v.value !== null && fitsDouble(v.value));
    const sum = numeric ? values.reduce((acc, v) => acc.plus(new Decimal(v.value as string)), new Decimal(0)) : null;
    if (sum !== null && s.rows.length > 0 && sum.eq(new Decimal(t.value.value)) && fitsDouble(t.value.value))
      return { kind: "sum", column: firstSheetColumn + j, firstRow, lastRow, cached: t.value.value };
    return valueCell(t.value, labels);
  });
}

// ------------------------------------------------------------------------------------------------ non-table sections

/** The label/value/status rows of a fields, metrics, text or list section (spreadsheets). */
export function sectionRows(s: Exclude<ReportSection, ReportTableSection>, labels: Labels): SheetCell[][] {
  const row = (label: string, v: ReportValue): SheetCell[] => [
    textCell(label),
    valueCell(v, labels),
    textCell(statusOf(v, labels)),
  ];
  switch (s.kind) {
    case "fields":
    case "metrics":
      return s.fields.map((f) => row(labels.text(f.labelKey), f.value));
    case "text":
      return [[valueCell(s.text, labels), { kind: "empty" }, textCell(statusOf(s.text, labels))]];
    case "list":
      if (s.items.length === 0) return [[textCell(labels.text(s.emptyKey ?? "export.no_records"))]];
      return s.items.map((i) => [valueCell(i.value, labels), { kind: "empty" }, textCell(statusOf(i.value, labels))]);
  }
}

/** The table's empty-state line ("No records" or the section's own empty key). */
export const emptyTableText = (s: ReportTableSection, labels: Labels): string =>
  labels.text(s.emptyKey ?? "export.no_records");
