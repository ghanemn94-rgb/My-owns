// Import validation (ADR-0056 §3-§5; p6-work-split §B/A.3; T-DG6-BE-M): the limits, the whole-file refusals, the
// header check against the target's template, and the engine's own cell rules (formula cells, over-long cells,
// characters that cannot be stored). A target's row rules (`ImportTarget.validateRow`) run after these, on the cells
// the engine did not refuse.
//
// Cells are TEXT from the parser to `numeric` (p6-work-split §B/A.13 item 4): nothing here turns a cell into a number.
import { PROBLEM_TYPES } from "@mth/shared";
import { hasInvalidCharacter, truncateText } from "@mth/shared/schemas";
import { HttpProblem } from "../../platform/index.ts";
import {
  SOURCE_RECORD_ID_COLUMN,
  SOURCE_RECORD_ID_MAX,
  cellValue,
  type ImportCells,
  type ImportRowReason,
  type ImportTarget,
  type RowVerdict,
} from "./targets.ts";

/** The limits of ADR-0056 §3 (file size and row count are also database CHECKs in 0105). */
export const IMPORT_LIMITS = Object.freeze({
  /** 10 MiB (`import_batch.byte_size`). */
  fileBytes: 10_485_760,
  /** Data rows, header excluded (`import_batch.rows_total`). */
  dataRows: 5000,
  /** Header columns (`import_row.raw` has at most 50 keys). */
  columns: 50,
  /** Characters (UTF-16 code units, the database's `char_length` for BMP text) per cell. */
  cellChars: 4000,
  /** XLSX container. */
  zipEntries: 100,
  zipEntryBytes: 20 * 1_048_576,
  zipTotalBytes: 50 * 1_048_576,
  zipRatio: 100,
  /** `import_row.row_number` is at most 100,000 (0105). */
  rowNumber: 100_000,
  /** `import_row.reasons` holds at most 20 reasons (0105). */
  reasonsPerRow: 20,
  /** `import_row.raw` is at most 32 KiB of JSON (0105). */
  rawBytes: 32_768,
});

// ------------------------------------------------------------------------------------------------ refusals

const validation422 = (code: string, detail: string, params?: Record<string, string>): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: PROBLEM_TYPES.validation,
    code,
    title: "Business rule violated",
    detail,
    ...(params ? { params } : {}),
  });

/**
 * The whole-file refusals of ADR-0056 §9 (English verbatim; codes are i18n keys under `problems.`). `csvMalformed`
 * is not in the ADR table: it is proposed in the T-DG6-BE-M handback (p6-work-split §2 rule 17).
 */
export const importRefusals = {
  fileTooLarge: () =>
    new HttpProblem({
      status: 413,
      type: PROBLEM_TYPES.validation,
      code: "import.file_too_large",
      title: "Content too large",
      detail: "The file is larger than 10 MiB.",
    }),
  unsupportedMediaType: () =>
    new HttpProblem({
      status: 415,
      type: PROBLEM_TYPES.validation,
      code: "import.unsupported_media_type",
      title: "Unsupported media type",
      detail: "Only CSV (UTF-8) and XLSX files can be imported.",
    }),
  csvNotUtf8: () => validation422("import.csv_not_utf8", "The CSV file is not valid UTF-8 text."),
  csvMalformed: () =>
    validation422("import.csv_malformed", "The CSV file is not valid CSV: a quoted field is not closed correctly."),
  xlsxUnsafe: () =>
    validation422(
      "import.xlsx_unsafe",
      "The XLSX file was refused: it has too many parts, unpacks too large, or contains macros or external links.",
    ),
  tooManyRows: () =>
    validation422("import.too_many_rows", "The file has more than 5,000 data rows. Split it into smaller files."),
  headerMismatch: (template: string) =>
    validation422(
      "import.header_mismatch",
      `The header row does not match template ${template}. Download the template and keep its columns.`,
      { template },
    ),
  templateUnknown: (template: string) =>
    validation422("import.template_unknown", `Template ${template} does not exist.`, { template }),
};

// ------------------------------------------------------------------------------------------------ parsed shapes

/** A parser's positional output: the header row's cells and the data rows' cells by column index. */
export interface ParsedSheet {
  /** Row 1's cells (null for an empty cell). */
  readonly header: readonly (string | null)[];
  /** Header-row cells that hold a formula (a formula header is never a column name). */
  readonly headerFormulaIndexes: readonly number[];
  readonly rows: readonly ParsedSheetRow[];
}

export interface ParsedSheetRow {
  /** The source row (header is row 1). */
  readonly rowNumber: number;
  /** Cells by column index; an empty cell is null; every cell is text. */
  readonly values: readonly (string | null)[];
  /** Column indexes whose cell holds a formula (XLSX `<f>`); their value is null, never the cached result. */
  readonly formulaIndexes: readonly number[];
  /** Column indexes whose source value was not text (a webhook item's JSON number, boolean, object or array). */
  readonly nonTextIndexes?: readonly number[];
}

/** ADR-0056 §3: the parsers' result once the header is checked; cells keyed by template column key. */
export interface ParsedTable {
  readonly header: readonly string[];
  readonly rows: readonly ParsedRow[];
}

export interface ParsedRow {
  readonly rowNumber: number;
  readonly cells: ImportCells;
  readonly formulaColumns: readonly string[];
  /**
   * Columns whose source value was not text (ADR-0056 §7: "every value a JSON string (a JSON number is the row reason
   * import.row.value_not_decimal)"); the cell holds the value's JSON text for display only.
   */
  readonly nonTextColumns?: readonly string[];
}

/**
 * The header row against the template (ADR-0056 §3 "header row required (row 1)", §4 "an unknown column is the
 * whole-file refusal import.header_mismatch"): every header cell names a template column or an extension field of the
 * pinned form schema version, once; every required column is present; at most 50 columns; no data outside them.
 * Trailing empty header cells are ignored. Returns the rows keyed by column key.
 */
export function toTable(
  sheet: ParsedSheet,
  target: Pick<ImportTarget, "templateVersion" | "columns">,
  extensionColumns: readonly string[] = [],
): ParsedTable {
  const refuse = () => importRefusals.headerMismatch(target.templateVersion);
  let width = sheet.header.length;
  while (width > 0 && (sheet.header.at(width - 1) ?? "").trim() === "") width -= 1;
  if (width === 0 || width > 50) throw refuse();
  if (sheet.headerFormulaIndexes.some((i) => i < width)) throw refuse();
  const known = new Set([...target.columns.map((c) => c.key), ...extensionColumns]);
  const header: string[] = [];
  for (let i = 0; i < width; i += 1) {
    const key = (sheet.header.at(i) ?? "").trim();
    if (key === "" || !known.has(key) || header.includes(key)) throw refuse();
    header.push(key);
  }
  for (const c of target.columns) if (c.required && !header.includes(c.key)) throw refuse();
  const rows: ParsedRow[] = sheet.rows.map((r) => {
    if (r.values.slice(width).some((v) => v !== null && v !== undefined && v !== "")) throw refuse();
    if (r.formulaIndexes.some((i) => i >= width) || (r.nonTextIndexes ?? []).some((i) => i >= width)) throw refuse();
    const cells: ImportCells = Object.fromEntries(
      header.map((key, i) => {
        const v = r.values.at(i);
        return [key, v === undefined || v === "" ? null : v];
      }),
    );
    return {
      rowNumber: r.rowNumber,
      cells,
      formulaColumns: r.formulaIndexes.map((i) => header.at(i)!),
      nonTextColumns: (r.nonTextIndexes ?? []).map((i) => header.at(i)!),
    };
  });
  return { header, rows };
}

/**
 * A webhook's items (ADR-0056 §7) as a keyed table: item i is source row i + 2 (as if the keys were a header row).
 * A string stays text; null is an empty cell; any other JSON value (a number, boolean, object or array) keeps its JSON
 * text for display and is marked non-text, so the row gets `import.row.value_not_decimal` and the value is never
 * coerced. The keys are checked against the template by `prepareImport` like a file header.
 */
export function tableFromJsonItems(items: readonly Readonly<Record<string, unknown>>[]): ParsedTable {
  const header: string[] = [];
  const rows = items.map((item, i): ParsedRow => {
    const nonText: string[] = [];
    const entries = Object.entries(item).map(([key, value]): [string, string | null] => {
      if (!header.includes(key)) header.push(key);
      if (value === null || typeof value === "string") return [key, value];
      nonText.push(key);
      return [key, JSON.stringify(value) ?? null];
    });
    return { rowNumber: i + 2, cells: Object.fromEntries(entries), formulaColumns: [], nonTextColumns: nonText };
  });
  return { header, rows };
}

// ------------------------------------------------------------------------------------------------ cell rules

/** The engine's own reasons for one row and the fields they concern (the target sees those fields as null). */
export interface CellCheck {
  readonly reasons: readonly ImportRowReason[];
  readonly refusedFields: ReadonlySet<string>;
  /** The cells the target receives: refused cells replaced by null. */
  readonly cells: ImportCells;
  /** `source_record_id` when it fits the column (≤ 200 characters), else null. */
  readonly sourceRecordId: string | null;
}

/**
 * ADR-0056 §3-§5, the rules that do not depend on the target: a formula cell is `import.row.formula_cell` (D-195 Q11:
 * never its cached value); a cell whose source value was not text (a webhook's JSON number) is
 * `import.row.value_not_decimal` (ADR-0056 §7), never coerced; a cell over 4,000 characters is
 * `import.row.text_too_long`; a cell with U+0000 or a lone surrogate is `import.row.text_invalid_character` (the shared `hasInvalidCharacter` rule, ADR-0052 §2); a
 * `source_record_id` over 200 characters is `import.row.source_record_id_too_long` (proposed in the handback: the
 * column holds 200). Formula-like CSV text (`=`, `+`, `-`, `@` first) is NOT refused: it is imported as text (D-195
 * Q11) and neutralised on any later export (ADR-0046).
 */
export function checkCells(row: ParsedRow): CellCheck {
  const reasons: ImportRowReason[] = [];
  const refused = new Set<string>();
  const cells = new Map(Object.entries(row.cells));
  const refuse = (code: string, field: string, params: Record<string, string> = {}) => {
    reasons.push({ code, field, params: { field, ...params } });
    refused.add(field);
    cells.set(field, null);
  };
  for (const field of row.formulaColumns) refuse("import.row.formula_cell", field);
  for (const field of row.nonTextColumns ?? [])
    if (!refused.has(field))
      refuse("import.row.value_not_decimal", field, { value: truncateText(cellValue(row.cells, field) ?? "", 200) });
  for (const [field, value] of Object.entries(row.cells)) {
    if (value === null || refused.has(field)) continue;
    if (value.length > IMPORT_LIMITS.cellChars) refuse("import.row.text_too_long", field);
    else if (hasInvalidCharacter(value)) refuse("import.row.text_invalid_character", field);
  }
  let sourceRecordId = cells.get(SOURCE_RECORD_ID_COLUMN) ?? null;
  if (sourceRecordId !== null && sourceRecordId.length > SOURCE_RECORD_ID_MAX) {
    refuse("import.row.source_record_id_too_long", SOURCE_RECORD_ID_COLUMN);
    sourceRecordId = null;
  }
  return { reasons, refusedFields: refused, cells: Object.fromEntries(cells), sourceRecordId };
}

/**
 * The row's final verdict: the engine's reasons first, then the target's reasons for the other fields (a target
 * reason on a refused field repeats the engine's and is dropped). At most 20 reasons are stored (0105).
 */
export function mergeVerdict(check: CellCheck, verdict: RowVerdict): RowVerdict {
  if (check.reasons.length === 0) {
    if (verdict.valid) return verdict;
    return {
      valid: false,
      reasons: verdict.reasons.slice(0, IMPORT_LIMITS.reasonsPerRow),
      duplicateKey: verdict.duplicateKey,
    };
  }
  const targetReasons = verdict.valid
    ? []
    : verdict.reasons.filter((r) => r.field === undefined || r.field === null || !check.refusedFields.has(r.field));
  return {
    valid: false,
    reasons: [...check.reasons, ...targetReasons].slice(0, IMPORT_LIMITS.reasonsPerRow),
    duplicateKey: verdict.duplicateKey,
  };
}

// ------------------------------------------------------------------------------------------------ raw cells

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), "utf8");

/**
 * The cells as stored in `import_row.raw` (0105 CHECK: ≤ 50 keys, ≤ 32 KiB of JSON, values text or null). A cell over
 * 4,000 characters is stored cut to 4,000 (its row is invalid with `import.row.text_too_long`); if the row still
 * exceeds the column, its longest cells are cut further, through `truncateText` only (p6-work-split §2 rule 1). The
 * row's verdict was taken on the full cells; the cut applies only to the stored display copy.
 */
export function rawForStorage(cells: ImportCells): Record<string, string | null> {
  const raw = new Map(
    Object.entries(cells).map(([k, v]) => [k, v === null ? null : truncateText(v, IMPORT_LIMITS.cellChars)]),
  );
  // jsonb's text form adds a space after each ':' and ','; leave room for it and for escapes that grow on output.
  const budget = IMPORT_LIMITS.rawBytes - 4 * raw.size - 64;
  while (jsonBytes(Object.fromEntries(raw)) > budget) {
    let longest: [string, string] | null = null;
    for (const [k, v] of raw) if (v !== null && (longest === null || v.length > longest[1].length)) longest = [k, v];
    if (longest === null) break;
    raw.set(longest[0], truncateText(longest[1], Math.floor(longest[1].length / 2)));
  }
  return Object.fromEntries(raw);
}
