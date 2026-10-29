// Duplicate detection of a staged import (ADR-0056 §5; M0334 "detect duplicate source/period records"; T-DG6-BE-M).
//
// The duplicate key is the target's (for KPI actuals the DG4 slot `kpi_actual:<kpi>:<scopeKind>:<scopeId>:<period>`).
//  - Against committed data: a row whose key the target already holds is `duplicate_committed`, with the params the
//    target gave (the existing record's status). Every such row is, even the first of the batch.
//  - Within the batch: the FIRST valid row (in row-number order) with a key is `valid`; every later row with the same
//    key is `duplicate_in_batch` and points at that first valid row (its row number is the reason's `firstRow`). The
//    database holds the same invariant (unique index `import_row_one_valid_per_key`, trigger `import_row_duplicate_of`).
//  - An invalid row stays invalid with its own reasons; it is never "the first" of a key.
// Pure: no I/O.
import type { ImportCells, ImportRowReason, RowVerdict } from "./targets.ts";

export type ImportRowValidationStatus = "valid" | "invalid" | "duplicate_in_batch" | "duplicate_committed";

/** A row after the engine's and the target's checks, before duplicate classification. */
export interface CheckedRow {
  readonly rowNumber: number;
  readonly sourceRecordId: string | null;
  /** The source cells as text (the display copy stored in `import_row.raw`). */
  readonly raw: ImportCells;
  readonly verdict: RowVerdict;
}

export interface ClassifiedRow {
  readonly rowNumber: number;
  readonly sourceRecordId: string | null;
  readonly raw: ImportCells;
  readonly validationStatus: ImportRowValidationStatus;
  /** Set iff valid. */
  readonly normalized: ImportCells | null;
  readonly duplicateKey: string | null;
  /** The row number of the first valid row with the same key (duplicate_in_batch only). */
  readonly duplicateOfRowNumber: number | null;
  /** Empty iff valid. */
  readonly reasons: readonly ImportRowReason[];
}

export interface ImportCounts {
  readonly total: number;
  readonly valid: number;
  readonly invalid: number;
  /** In-batch and committed duplicates together (`import_batch.rows_duplicate`). */
  readonly duplicate: number;
}

/** The keys to ask the target about: those of the rows it found valid. */
export function candidateKeys(rows: readonly CheckedRow[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) if (r.verdict.valid) keys.add(r.verdict.duplicateKey);
  return [...keys];
}

/** Classifies every row (in row-number order). `committed`: the keys the target already holds, with reason params. */
export function classifyDuplicates(
  rows: readonly CheckedRow[],
  committed: ReadonlyMap<string, Readonly<Record<string, string>>>,
): ClassifiedRow[] {
  const firstValid = new Map<string, number>();
  return [...rows]
    .sort((a, b) => a.rowNumber - b.rowNumber)
    .map((r): ClassifiedRow => {
      const base = { rowNumber: r.rowNumber, sourceRecordId: r.sourceRecordId, raw: r.raw };
      const v = r.verdict;
      if (!v.valid)
        return {
          ...base,
          validationStatus: "invalid",
          normalized: null,
          duplicateKey: v.duplicateKey,
          duplicateOfRowNumber: null,
          reasons: v.reasons,
        };
      const existing = committed.get(v.duplicateKey);
      if (existing)
        return {
          ...base,
          validationStatus: "duplicate_committed",
          normalized: null,
          duplicateKey: v.duplicateKey,
          duplicateOfRowNumber: null,
          reasons: [{ code: "import.row.duplicate_committed", field: null, params: { ...existing } }],
        };
      const first = firstValid.get(v.duplicateKey);
      if (first !== undefined)
        return {
          ...base,
          validationStatus: "duplicate_in_batch",
          normalized: null,
          duplicateKey: v.duplicateKey,
          duplicateOfRowNumber: first,
          reasons: [{ code: "import.row.duplicate_in_batch", field: null, params: { firstRow: first } }],
        };
      firstValid.set(v.duplicateKey, r.rowNumber);
      return {
        ...base,
        validationStatus: "valid",
        normalized: v.normalized,
        duplicateKey: v.duplicateKey,
        duplicateOfRowNumber: null,
        reasons: [],
      };
    });
}

export function countRows(rows: readonly ClassifiedRow[]): ImportCounts {
  let valid = 0;
  let invalid = 0;
  let duplicate = 0;
  for (const r of rows) {
    if (r.validationStatus === "valid") valid += 1;
    else if (r.validationStatus === "invalid") invalid += 1;
    else duplicate += 1;
  }
  return { total: rows.length, valid, invalid, duplicate };
}
