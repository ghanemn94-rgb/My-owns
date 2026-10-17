// Unit tests of the system SUM totals of assembled tables (T-DG5-KBE-D3; D-163, F-DG5-qa-c-3; ADR-0045 §"Every
// number…", §5; ADR-0046 §4; REQ-S13-006), with worked fixtures. The database behaviour (the business-case and
// benefits-register totals equal the screens' figures) is proved by test/integration/reporting/kbe-c2-assemblers.test.ts
// and registers-report.test.ts; the formula in the XLSX file by packages/reporting and the A15 QA test.
// All data is SYNTHETIC.
import { reportDocument, type ReportColumn, type ReportRow, type ReportValue } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { decimalValue, textValue } from "../assembler.ts";
import { NOT_APPLICABLE, PROVISIONAL, STALE, UNKNOWN_MISSING, VALIDATED, type ValueState } from "../provisional.ts";
import { columnTotal, columnTotals, sameDecimal } from "./table-totals.ts";

const columns: ReportColumn[] = [
  { key: "title", labelKey: "report.business_cases.title", valueKind: "text", unitKind: null },
  { key: "amount", labelKey: "report.business_cases.amount", valueKind: "decimal", unitKind: "currency" },
];
const sar = (
  value: string | null,
  state?: ValueState,
  currency = "SAR",
  valueBasis: "planned" | "validated" = "planned",
) => decimalValue(value, { unitKind: "currency", currency, valueBasis, ...(state === undefined ? {} : { state }) });
let n = 0;
const row = (amount: ReportValue): ReportRow => {
  n += 1;
  return {
    recordType: "business_case_line",
    recordId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    recordVersion: 1,
    cells: [textValue(`Line ${n}`), amount],
  };
};
const table = (...amounts: ReportValue[]) => ({ columns, rows: amounts.map(row) });

describe("columnTotal: a single-basis, single-currency money column (worked fixtures)", () => {
  it("Δ attach × customers × ARPU lines: 1,250,000.0000 + 375,000.5000 + 0.2500 = 1,625,000.75 SAR, exactly", () => {
    // Playbook-style worked lines (synthetic): 0.02 attach uplift × 250,000 customers × 250 SAR ARPU = 1,250,000;
    // volume × Δ unit cost: 200,000 units × 1.8750025 SAR = 375,000.5; and a 0.25 SAR line.
    const t = columnTotal(
      table(sar("1250000.0000", VALIDATED), sar("375000.5000", VALIDATED), sar("0.2500", VALIDATED)),
      "amount",
    );
    expect(t).toEqual({
      columnKey: "amount",
      formula: "sum",
      value: {
        type: "decimal",
        value: "1625000.75",
        unitKind: "currency",
        currency: "SAR",
        valueBasis: "planned",
        validation: "validated",
        reason: null,
      },
    });
  });

  it("decimal arithmetic, never binary floats: 0.1 + 0.2 = 0.3 (a float sum would be 0.30000000000000004)", () => {
    expect(columnTotal(table(sar("0.1000", VALIDATED), sar("0.2000", VALIDATED)), "amount")!.value.value).toBe("0.3");
  });

  it("a negative line (a correction) is summed with its sign", () => {
    expect(columnTotal(table(sar("100.0000", VALIDATED), sar("-40.0000", VALIDATED)), "amount")!.value.value).toBe(
      "60",
    );
  });

  it("the screen's own figure is used when given (the engine's amount, by reference)", () => {
    const t = columnTotal(table(sar("10.0000", VALIDATED), sar("5.0000", VALIDATED)), "amount", "15");
    expect(t!.value.value).toBe("15");
    expect(sameDecimal(t!.value.value as string, "15.0000")).toBe(true);
  });

  it("is as provisional as its inputs: one provisional cell makes the total provisional", () => {
    expect(columnTotal(table(sar("1", VALIDATED), sar("2", PROVISIONAL)), "amount")!.value.validation).toBe(
      "provisional",
    );
  });

  it("n/a cells with a number (a cost line, a 0.0000 with no line in that state) count but carry no label", () => {
    const t = columnTotal(table(sar("7.0000", NOT_APPLICABLE), sar("0.0000", NOT_APPLICABLE)), "amount");
    expect(t!.value).toMatchObject({ value: "7", validation: "not_applicable", reason: null });
    // validated + n/a 0.0000: still validated (the zero is no value of its own).
    expect(columnTotal(table(sar("3", VALIDATED), sar("0.0000", NOT_APPLICABLE)), "amount")!.value.validation).toBe(
      "validated",
    );
  });

  it("n/a cells with no number (unmonetised, held back by an open overlap) are left out of the sum", () => {
    const t = columnTotal(table(sar("9.0000", VALIDATED), sar(null, NOT_APPLICABLE)), "amount");
    expect(t!.value).toMatchObject({ value: "9", validation: "validated" });
    // A column of such cells only has nothing to total.
    expect(columnTotal(table(sar(null, NOT_APPLICABLE)), "amount")).toBeNull();
  });
});

describe("columnTotal: Unknown and Stale are never a partial sum shown as complete", () => {
  it("an unknown cell makes the total unknown, with no number", () => {
    const t = columnTotal(table(sar("100", VALIDATED), sar(null, UNKNOWN_MISSING)), "amount");
    expect(t!.value).toEqual({
      type: "decimal",
      value: null,
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "planned",
      validation: "unknown",
      reason: "not_computable",
    });
  });

  it("a stale cell makes the total unknown as well (a stale value shows no current number)", () => {
    expect(columnTotal(table(sar("100", VALIDATED), sar(null, STALE)), "amount")!.value).toMatchObject({
      value: null,
      validation: "unknown",
    });
  });

  it("an unknown cell wins even when the screen passes a (partial) figure", () => {
    expect(
      columnTotal(table(sar("100", VALIDATED), sar(null, UNKNOWN_MISSING)), "amount", "100")!.value.value,
    ).toBeNull();
  });
});

describe("columnTotal: never across currencies, value bases or unit kinds (D-117, D-119, D-122)", () => {
  it("a mixed-currency column has no total", () => {
    expect(columnTotal(table(sar("1", VALIDATED), sar("2", VALIDATED, "USD")), "amount")).toBeNull();
  });

  it("a mixed-basis column has no total", () => {
    expect(columnTotal(table(sar("1", VALIDATED), sar("2", VALIDATED, "SAR", "validated")), "amount")).toBeNull();
  });

  it("a mixed-unit column has no total", () => {
    const other = decimalValue("2", { unitKind: "other", state: NOT_APPLICABLE });
    expect(columnTotal(table(sar("1", VALIDATED), other), "amount")).toBeNull();
  });

  it("a money column without a currency, a text column, an unknown column or an empty table has no total", () => {
    expect(columnTotal(table(decimalValue("1", { unitKind: "currency", state: NOT_APPLICABLE })), "amount")).toBeNull();
    expect(columnTotal(table(sar("1", VALIDATED)), "title")).toBeNull();
    expect(columnTotal(table(sar("1", VALIDATED)), "nope")).toBeNull();
    expect(columnTotal(table(), "amount")).toBeNull();
  });

  it("columnTotals keeps the named columns that get a total, in order", () => {
    const t = columnTotals(table(sar("1", VALIDATED)), ["title", "amount"], { amount: "1" });
    expect(t.map((x) => x.columnKey)).toEqual(["amount"]);
  });
});

describe("the declared total passes the document schema (report.column_mixed, report.total_column)", () => {
  it("a table with a SUM total is a valid ReportDocument table", () => {
    const tbl = table(sar("1.5000", VALIDATED), sar("2.5000", PROVISIONAL));
    const doc = {
      schemaVersion: 1,
      definitionCode: "business_cases",
      transformation: { id: "00000000-0000-4000-8000-000000000001", code: "TR-1", name: "Synthetic" },
      subject: { type: "transformation", id: "00000000-0000-4000-8000-000000000001", code: "TR-1", label: "Synthetic" },
      period: null,
      asOf: "2041-07-01T00:00:00.000Z",
      methodology: { versionId: "00000000-0000-4000-8000-000000000002", key: "methodology", versionNo: 1 },
      approvalState: "not_applicable",
      sections: [
        {
          key: "group_1_cash_saving_sar",
          titleKey: "report.business_case_value_basis.cash_saving",
          kind: "table",
          sources: [],
          ...tbl,
          totals: columnTotals(tbl, ["amount"]),
          emptyKey: "report.empty.no_records",
        },
      ],
    };
    const parsed = reportDocument.safeParse(doc);
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true);
  });
});
