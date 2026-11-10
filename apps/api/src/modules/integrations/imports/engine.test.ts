// The import engine without a database (ADR-0056 §1, §3-§5; p6-work-split §B/A.3 tests; T-DG6-BE-M): the file-level
// refusals, the header against the template, the engine's cell rules, the verdict merge, duplicate classification, the
// stored raw cells and the registry. The staging transaction is covered against PostgreSQL in
// apps/api/test/integration/integrations/import-staging.test.ts.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HttpProblem } from "../../platform/index.ts";
import { classifyDuplicates, countRows, candidateKeys, type CheckedRow } from "./duplicates.ts";
import { bareMediaType, parseImportFile, uploadSource } from "./staging.ts";
import { createImportTargetRegistry, XLSX_MEDIA_TYPE, type ImportColumn, type ImportTarget } from "./targets.ts";
import {
  checkCells,
  IMPORT_LIMITS,
  mergeVerdict,
  rawForStorage,
  tableFromJsonItems,
  toTable,
  type ParsedSheet,
} from "./validate.ts";

/**
 * Budget of the tests that build or parse files near the limits (10 MiB, 5,000 rows, 20-51 MiB containers): the
 * loaded worst case measured in a full parallel `pnpm test` was 5.96 s (the 10 MiB CSV, before the chunked scan); the
 * budget is about 5x that (F-DG4-143..148: deterministic under load).
 */
const LARGE_INPUT = { timeout: 30_000 };

const enc = (s: string) => new TextEncoder().encode(s);

function refusal(fn: () => unknown): { status: number; code: string; params?: unknown } {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpProblem)
      return { status: err.status, code: err.code, ...(err.params ? { params: err.params } : {}) };
    throw err;
  }
  throw new Error("expected a refusal");
}

const column = (key: string, required = false, extra: Partial<ImportColumn> = {}): ImportColumn => ({
  key,
  labelEn: key,
  labelAr: key,
  required,
  kind: "text",
  example: null,
  ...extra,
});

/** A test target, in this test file only (p6-work-split §B/A.3): the engine never depends on a real domain. */
const TEST_TARGET: ImportTarget = {
  kind: "kpi_actual",
  templateVersion: "kpi_actual.v9",
  titleEn: "Test target",
  titleAr: "هدف اختبار",
  columns: [
    column("source_record_id"),
    column("kpi_id", true),
    column("kpi_name", false, { informational: true }),
    column("period_label", true),
    column("value"),
    column("comment"),
  ],
  validateRow: () => Promise.resolve({ valid: true, normalized: {}, duplicateKey: "k" }),
  existingKeys: () => Promise.resolve(new Map()),
  commitRow: () => Promise.reject(new Error("not used")),
  requiredPermissions: [],
};

const sheet = (header: (string | null)[], rows: (string | null)[][], formulas: number[][] = []): ParsedSheet => ({
  header,
  headerFormulaIndexes: [],
  rows: rows.map((values, i) => ({ rowNumber: i + 2, values, formulaIndexes: formulas.at(i) ?? [] })),
});

describe("parseImportFile: the file-level refusals (ADR-0056 §3, §9)", () => {
  it("refuses a file over 10 MiB with 413 import.file_too_large, before parsing", LARGE_INPUT, () => {
    const big = new Uint8Array(IMPORT_LIMITS.fileBytes + 1).fill(0x61);
    expect(refusal(() => parseImportFile(big, "text/csv"))).toEqual({ status: 413, code: "import.file_too_large" });
    expect(refusal(() => parseImportFile(big, XLSX_MEDIA_TYPE))).toEqual({
      status: 413,
      code: "import.file_too_large",
    });
  });

  it("accepts exactly 10 MiB", LARGE_INPUT, () => {
    const head = enc("a,b\n");
    const bytes = new Uint8Array(IMPORT_LIMITS.fileBytes).fill(0x20);
    bytes.set(head, 0);
    expect(parseImportFile(bytes, "text/csv").header).toEqual(["a", "b"]);
  });

  it("refuses any other media type with 415 import.unsupported_media_type", () => {
    for (const type of ["application/json", "application/vnd.ms-excel", "text/plain", "", null])
      expect(refusal(() => parseImportFile(enc("a,b\n"), type))).toEqual({
        status: 415,
        code: "import.unsupported_media_type",
      });
  });

  it("checks the content against the declared type: CSV bytes sent as XLSX, XLSX bytes sent as CSV", () => {
    expect(refusal(() => parseImportFile(enc("a,b\n1,2\n"), XLSX_MEDIA_TYPE)).status).toBe(415);
    expect(refusal(() => parseImportFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), "text/csv")).status).toBe(415);
  });

  it("accepts a UTF-8 charset parameter on CSV and refuses another charset", () => {
    expect(parseImportFile(enc("a,b\n"), "text/csv; charset=UTF-8").header).toEqual(["a", "b"]);
    expect(refusal(() => parseImportFile(enc("a,b\n"), "text/csv; charset=windows-1256")).status).toBe(415);
    expect(bareMediaType("Text/CSV ; charset=utf-8")).toBe("text/csv");
  });

  it("records an upload's name, media type, size and SHA-256 (never its bytes)", () => {
    const bytes = enc("a,b\n");
    expect(uploadSource("actuals.csv", "text/csv", bytes)).toEqual({
      kind: "csv_upload",
      fileName: "actuals.csv",
      mediaType: "text/csv",
      byteSize: 4,
      contentSha256: createHash("sha256").update("a,b\n").digest("hex"),
    });
  });
});

describe("toTable: the header against the template (ADR-0056 §3, §4: import.header_mismatch 422)", () => {
  const mismatch = { status: 422, code: "import.header_mismatch", params: { template: "kpi_actual.v9" } };

  it("keys the cells by column and accepts columns in any order, optional ones absent", () => {
    const t = toTable(sheet(["period_label", "kpi_id", "value"], [["2026-Q1", "k1", "1"]]), TEST_TARGET);
    expect(t.header).toEqual(["period_label", "kpi_id", "value"]);
    expect(t.rows[0]).toEqual({
      rowNumber: 2,
      cells: { period_label: "2026-Q1", kpi_id: "k1", value: "1" },
      formulaColumns: [],
      nonTextColumns: [],
    });
  });

  it("trims header cells and ignores trailing empty header cells", () => {
    expect(toTable(sheet([" kpi_id ", "period_label", null, ""], []), TEST_TARGET).header).toEqual([
      "kpi_id",
      "period_label",
    ]);
  });

  it("refuses an unknown column, a duplicate column, an empty column name and a missing required column", () => {
    expect(refusal(() => toTable(sheet(["kpi_id", "period_label", "colour"], []), TEST_TARGET))).toEqual(mismatch);
    expect(refusal(() => toTable(sheet(["kpi_id", "period_label", "kpi_id"], []), TEST_TARGET))).toEqual(mismatch);
    expect(refusal(() => toTable(sheet(["kpi_id", "", "period_label"], []), TEST_TARGET))).toEqual(mismatch);
    expect(refusal(() => toTable(sheet(["kpi_id", "value"], []), TEST_TARGET))).toEqual(mismatch);
  });

  it("refuses a missing header row and more than 50 columns", () => {
    expect(refusal(() => toTable(sheet([], []), TEST_TARGET))).toEqual(mismatch);
    const wide = Array.from({ length: 51 }, (_, i) => `x${i}`);
    expect(refusal(() => toTable(sheet(wide, []), TEST_TARGET, wide))).toEqual(mismatch);
  });

  it("accepts the pinned form schema's extension columns only when the target lists them", () => {
    const s = sheet(["kpi_id", "period_label", "ext_site"], [["k", "p", "Riyadh"]]);
    expect(refusal(() => toTable(s, TEST_TARGET))).toEqual(mismatch);
    expect(toTable(s, TEST_TARGET, ["ext_site"]).rows[0]!.cells["ext_site"]).toBe("Riyadh");
  });

  it("refuses data outside the header's columns and a formula header", () => {
    expect(refusal(() => toTable(sheet(["kpi_id", "period_label"], [["k", "p", "extra"]]), TEST_TARGET))).toEqual(
      mismatch,
    );
    // Empty trailing cells beyond the header are fine.
    expect(toTable(sheet(["kpi_id", "period_label"], [["k", "p", null, ""]]), TEST_TARGET).rows).toHaveLength(1);
    expect(
      refusal(() => toTable({ header: ["kpi_id", "period_label"], headerFormulaIndexes: [1], rows: [] }, TEST_TARGET)),
    ).toEqual(mismatch);
  });

  it("names the formula columns of a row by key", () => {
    const t = toTable(sheet(["kpi_id", "period_label", "value"], [["k", "p", null]], [[2]]), TEST_TARGET);
    expect(t.rows[0]!.formulaColumns).toEqual(["value"]);
  });
});

describe("checkCells and mergeVerdict: the engine's row reasons (ADR-0056 §3-§5)", () => {
  const row = (cells: Record<string, string | null>, formulaColumns: string[] = []) => ({
    rowNumber: 2,
    cells,
    formulaColumns,
  });

  it("reports a formula cell as import.row.formula_cell and hides the cell from the target", () => {
    const c = checkCells(row({ kpi_id: "k", value: null }, ["value"]));
    expect(c.reasons).toEqual([{ code: "import.row.formula_cell", field: "value", params: { field: "value" } }]);
    expect(c.cells).toEqual({ kpi_id: "k", value: null });
  });

  it("refuses a cell over 4,000 characters (4,000 exactly is fine)", () => {
    expect(checkCells(row({ comment: "x".repeat(4000) })).reasons).toEqual([]);
    const c = checkCells(row({ comment: "x".repeat(4001) }));
    expect(c.reasons).toEqual([{ code: "import.row.text_too_long", field: "comment", params: { field: "comment" } }]);
    expect(c.cells["comment"]).toBeNull();
  });

  it("refuses U+0000 and a lone surrogate (the shared hasInvalidCharacter rule), keeps emoji and Arabic", () => {
    expect(checkCells(row({ comment: "a\u0000b" })).reasons[0]!.code).toBe("import.row.text_invalid_character");
    expect(checkCells(row({ comment: "a\ud800b" })).reasons[0]!.code).toBe("import.row.text_invalid_character");
    expect(checkCells(row({ comment: "تعليق 😀" })).reasons).toEqual([]);
  });

  it("keeps formula-like text as text: no reason (D-195 Q11)", () => {
    expect(checkCells(row({ comment: "=1+1", value: "-1" })).reasons).toEqual([]);
  });

  it("takes source_record_id up to 200 characters and refuses a longer one", () => {
    expect(checkCells(row({ source_record_id: "s".repeat(200) })).sourceRecordId).toBe("s".repeat(200));
    const c = checkCells(row({ source_record_id: "s".repeat(201) }));
    expect(c.sourceRecordId).toBeNull();
    expect(c.reasons[0]!.code).toBe("import.row.source_record_id_too_long");
  });

  it("puts the engine's reasons first and drops the target's reason on the same field", () => {
    const c = checkCells(row({ value: null, comment: "ok" }, ["value"]));
    const merged = mergeVerdict(c, {
      valid: false,
      reasons: [
        { code: "import.row.required_missing", field: "value", params: { field: "value" } },
        { code: "import.row.period_unknown", field: "period_label", params: { value: "2026-Q9" } },
      ],
      duplicateKey: null,
    });
    expect(merged).toEqual({
      valid: false,
      reasons: [
        { code: "import.row.formula_cell", field: "value", params: { field: "value" } },
        { code: "import.row.period_unknown", field: "period_label", params: { value: "2026-Q9" } },
      ],
      duplicateKey: null,
    });
  });

  it("makes a row the target found valid invalid when the engine refused a cell, and caps reasons at 20", () => {
    const c = checkCells(row({ comment: "x".repeat(4001) }));
    expect(mergeVerdict(c, { valid: true, normalized: {}, duplicateKey: "k" })).toMatchObject({
      valid: false,
      duplicateKey: "k",
    });
    const many = Array.from({ length: 25 }, (_, i) => ({ code: "import.row.value_shape", field: `f${i}` }));
    const merged = mergeVerdict(checkCells(row({})), { valid: false, reasons: many, duplicateKey: null });
    expect(merged.valid ? 0 : merged.reasons.length).toBe(20);
  });
});

describe("tableFromJsonItems: webhook items (ADR-0056 §7)", () => {
  it("keeps strings as text, null as an empty cell, and marks any other JSON value non-text", () => {
    const t = tableFromJsonItems([
      { sourceRecordId: "w-1", value: "12.5", comment: null },
      { sourceRecordId: "w-2", value: 12.5, flag: true, extra: { a: 1 } },
    ]);
    expect(t.header).toEqual(["sourceRecordId", "value", "comment", "flag", "extra"]);
    expect(t.rows[0]).toEqual({
      rowNumber: 2,
      cells: { sourceRecordId: "w-1", value: "12.5", comment: null },
      formulaColumns: [],
      nonTextColumns: [],
    });
    expect(t.rows[1]).toMatchObject({
      rowNumber: 3,
      cells: { value: "12.5", flag: "true", extra: '{"a":1}' },
      nonTextColumns: ["value", "flag", "extra"],
    });
  });

  it("gives a JSON number the row reason import.row.value_not_decimal and hides it from the target (never coerced)", () => {
    const row = tableFromJsonItems([{ value: 12.5 }]).rows[0]!;
    const c = checkCells(row);
    expect(c.reasons).toEqual([
      { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: "12.5" } },
    ]);
    expect(c.cells["value"]).toBeNull();
  });

  it("keeps the non-text marks through the header check", () => {
    const items = tableFromJsonItems([{ kpi_id: "k", period_label: "p", value: 3 }]);
    const sheetOf: ParsedSheet = {
      header: items.header,
      headerFormulaIndexes: [],
      rows: [{ rowNumber: 2, values: ["k", "p", "3"], formulaIndexes: [], nonTextIndexes: [2] }],
    };
    expect(toTable(sheetOf, TEST_TARGET).rows[0]!.nonTextColumns).toEqual(["value"]);
  });
});

describe("classifyDuplicates (ADR-0056 §5)", () => {
  const valid = (rowNumber: number, key: string): CheckedRow => ({
    rowNumber,
    sourceRecordId: `s-${rowNumber}`,
    raw: {},
    verdict: { valid: true, normalized: { value: "1" }, duplicateKey: key },
  });
  const invalid = (rowNumber: number, key: string | null): CheckedRow => ({
    rowNumber,
    sourceRecordId: null,
    raw: {},
    verdict: { valid: false, reasons: [{ code: "import.row.value_not_decimal", field: "value" }], duplicateKey: key },
  });

  it("points an in-batch duplicate at the FIRST VALID row with its key (an invalid row is never the first)", () => {
    const rows = classifyDuplicates([valid(5, "A"), invalid(2, "A"), valid(3, "A"), valid(4, "B")], new Map());
    expect(rows.map((r) => [r.rowNumber, r.validationStatus, r.duplicateOfRowNumber])).toEqual([
      [2, "invalid", null],
      [3, "valid", null],
      [4, "valid", null],
      [5, "duplicate_in_batch", 3],
    ]);
    expect(rows[3]!.reasons).toEqual([{ code: "import.row.duplicate_in_batch", field: null, params: { firstRow: 3 } }]);
    expect(rows[3]!.normalized).toBeNull();
    expect(countRows(rows)).toEqual({ total: 4, valid: 2, invalid: 1, duplicate: 1 });
  });

  it("marks every row whose key is already committed duplicate_committed, with the target's params", () => {
    const committed = new Map([["A", { status: "accepted" }]]);
    const rows = classifyDuplicates([valid(2, "A"), valid(3, "A"), valid(4, "B")], committed);
    expect(rows.map((r) => r.validationStatus)).toEqual(["duplicate_committed", "duplicate_committed", "valid"]);
    expect(rows[0]!.reasons).toEqual([
      { code: "import.row.duplicate_committed", field: null, params: { status: "accepted" } },
    ]);
    expect(countRows(rows)).toEqual({ total: 3, valid: 1, invalid: 0, duplicate: 2 });
  });

  it("asks the target only about the keys of valid rows, once each", () => {
    expect(candidateKeys([valid(2, "A"), valid(3, "A"), invalid(4, "C"), valid(5, "B")])).toEqual(["A", "B"]);
  });

  it("the A17 shape: 8 valid, 1 invalid, 1 duplicate of row 2", () => {
    const rows: CheckedRow[] = [];
    for (let n = 2; n <= 11; n += 1) {
      if (n === 7) rows.push(invalid(n, null));
      else if (n === 11) rows.push(valid(n, "K2"));
      else rows.push(valid(n, `K${n}`));
    }
    const out = classifyDuplicates(rows, new Map());
    expect(countRows(out)).toEqual({ total: 10, valid: 8, invalid: 1, duplicate: 1 });
    expect(out.find((r) => r.rowNumber === 11)!.duplicateOfRowNumber).toBe(2);
  });
});

describe("rawForStorage (import_row.raw ≤ 32 KiB, ≤ 50 keys, text or null)", () => {
  it("stores the cells unchanged when they fit", () => {
    expect(rawForStorage({ a: "1", b: null, c: "نص" })).toEqual({ a: "1", b: null, c: "نص" });
  });

  it("cuts an over-long cell to 4,000 characters and shrinks the longest cells until the row fits", () => {
    const cells: Record<string, string> = Object.fromEntries([
      ...Array.from({ length: 20 }, (_, i) => [`c${i}`, "ب".repeat(3999)]),
      ["long", "😀".repeat(3000)],
    ]);
    const raw = rawForStorage(cells);
    expect(Buffer.byteLength(JSON.stringify(raw)) + 4 * 21).toBeLessThanOrEqual(IMPORT_LIMITS.rawBytes);
    for (const v of Object.values(raw)) {
      expect(v!.length).toBeLessThanOrEqual(4000);
      expect(/\p{Cs}/u.test(v!)).toBe(false); // never a split surrogate pair
    }
  });
});

describe("the ImportTargetRegistry (ADR-0056 §1)", () => {
  it("registers, gets and lists targets, and gives the newest template's columns per kind", () => {
    const registry = createImportTargetRegistry();
    expect(registry.get("kpi_actual.v9")).toBeUndefined();
    expect(registry.columnsOf("kpi_actual")).toEqual([]);
    registry.register({ ...TEST_TARGET, templateVersion: "kpi_actual.v2", columns: [column("source_record_id")] });
    registry.register(TEST_TARGET);
    expect(registry.get("kpi_actual.v9")).toBe(TEST_TARGET);
    expect(registry.list().map((t) => t.templateVersion)).toEqual(["kpi_actual.v2", "kpi_actual.v9"]);
    expect(registry.columnsOf("kpi_actual").map((c) => c.key)).toContain("period_label");
  });

  it("refuses a malformed target as a programming error", () => {
    const registry = createImportTargetRegistry();
    expect(() => registry.register({ ...TEST_TARGET, templateVersion: "kpi_actual" })).toThrow(/template version/);
    expect(() => registry.register({ ...TEST_TARGET, templateVersion: "other.v1" })).toThrow(/template version/);
    expect(() => registry.register({ ...TEST_TARGET, kind: "benefit" as "kpi_actual" })).toThrow(/target kind/);
    expect(() => registry.register({ ...TEST_TARGET, columns: [column("kpi_id")] })).toThrow(/source_record_id/);
    expect(() =>
      registry.register({ ...TEST_TARGET, columns: [column("source_record_id"), column("Bad Key")] }),
    ).toThrow(/column key/);
  });
});
