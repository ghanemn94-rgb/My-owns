// System SUM totals of assembled tables (T-DG5-KBE-D3; D-163, F-DG5-qa-c-3; ADR-0045 §"Every number…", §3, §5;
// ADR-0046 §4; p5-work-split §F.11 items 3, 4 and 6; REQ-S13-006). PURE: no I/O, unit-tested in table-totals.test.ts
// with worked fixtures.
//
// A table section declares `totals[]` only where its source screen shows a total for that column. This helper builds
// one declared total (`{ columnKey, formula: "sum", value }`) from the column's cells, and refuses where a total would
// be wrong:
//  - only a decimal column is totalled; a table with no rows has no total (there is nothing on the screen to sum);
//  - a column whose cells mix unit kinds, value bases or currencies gets NO total (D-117, D-119, D-122; currencies are
//    never converted): `columnTotal` returns null;
//  - an `unknown` or `stale` cell makes the total Unknown (no number; reason `not_computable`): a partial sum is never
//    shown as complete;
//  - a `not_applicable` cell with no number (e.g. an unmonetised benefit, or a value held back by an open overlap) is
//    not part of the screen's total and is left out; a column of such cells only has no total;
//  - the value is the screen's own figure when the caller passes it (the owning module's engine, read by reference),
//    else the decimal.js sum of the cells (decimal strings only; never a JavaScript number). The XLSX writer emits
//    `SUM(<col>first:<col>last)` with this value cached only when every row holds a number whose decimal sum equals it
//    (packages/reporting/src/model.ts `totalRowCells`); otherwise it prints the value without a formula;
//  - the total's label: provisional when any summed cell is provisional; validated only when every labelled cell is
//    validated; otherwise not_applicable (ADR-0045 §5: a total is as provisional as its inputs).
import {
  sumDecimals,
  type ReportColumn,
  type ReportRow,
  type ReportTotal,
  type ReportValue,
} from "@mth/shared/schemas";
import { Decimal } from "decimal.js";

type DecimalCell = Extract<ReportValue, { type: "decimal" }>;

/** The declared SUM total of one column, or null when that column must carry no total (see the rules above). */
export function columnTotal(
  section: { readonly columns: readonly ReportColumn[]; readonly rows: readonly ReportRow[] },
  columnKey: string,
  screenValue?: string | null,
): ReportTotal | null {
  const j = section.columns.findIndex((c) => c.key === columnKey);
  if (j < 0 || section.columns.at(j)?.valueKind !== "decimal" || section.rows.length === 0) return null;
  const cells: DecimalCell[] = [];
  for (const r of section.rows) {
    const c = r.cells.at(j);
    if (c === undefined || c.type !== "decimal") return null;
    cells.push(c);
  }
  const units = new Set(cells.map((c) => c.unitKind));
  const bases = new Set(cells.map((c) => c.valueBasis ?? "-"));
  const currencies = new Set(cells.flatMap((c) => (c.currency === null ? [] : [c.currency])));
  if (units.size !== 1 || bases.size !== 1 || currencies.size > 1) return null;
  const unitKind = cells[0]!.unitKind;
  const valueBasis = cells[0]!.valueBasis;
  const currency = currencies.size === 1 ? [...currencies][0]! : null;
  // A money total states its currency (report.currency_required); a money column without one has no total.
  if (unitKind === "currency" && currency === null) return null;
  const base = { type: "decimal" as const, unitKind, currency, valueBasis };
  if (cells.some((c) => c.validation === "unknown" || c.validation === "stale"))
    return {
      columnKey,
      formula: "sum",
      value: { ...base, value: null, validation: "unknown", reason: "not_computable" },
    };
  const valued = cells.filter((c) => c.value !== null);
  if (valued.length === 0) return null;
  const sum = sumDecimals(valued.map((c) => c.value!));
  const value = screenValue === undefined || screenValue === null ? sum : screenValue;
  const labelled = valued.filter((c) => c.validation !== "not_applicable");
  const validation = labelled.some((c) => c.validation === "provisional")
    ? ("provisional" as const)
    : labelled.length > 0 && labelled.every((c) => c.validation === "validated")
      ? ("validated" as const)
      : ("not_applicable" as const);
  return { columnKey, formula: "sum", value: { ...base, value, validation, reason: null } };
}

/** The declared totals of the named columns, in that order, leaving out every column that gets none. */
export function columnTotals(
  section: { readonly columns: readonly ReportColumn[]; readonly rows: readonly ReportRow[] },
  columnKeys: readonly string[],
  screenValues: Readonly<Record<string, string | null | undefined>> = {},
): ReportTotal[] {
  return columnKeys.flatMap((k) => {
    const t = columnTotal(section, k, new Map(Object.entries(screenValues)).get(k));
    return t === null ? [] : [t];
  });
}

/** True when the screen's figure equals the decimal sum of the column's numbers (used by the tests and the checks). */
export function sameDecimal(a: string, b: string): boolean {
  return new Decimal(a).eq(new Decimal(b));
}
