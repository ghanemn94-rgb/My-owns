// Unit tests of the report document model v1 and the registers parameters (T-DG5-KBE-C; ADR-0045 §1, §3, §5, §12).
// Pure; every value is synthetic.
import { describe, expect, it } from "vitest";
import {
  countReportValues,
  registersReportParameters,
  reportSection,
  reportSnapshotReason,
  type ReportSection,
} from "./report.ts";

const id = (n: number) => `0190f0a0-0000-7000-8000-${String(n).padStart(12, "0")}`;
const money = (value: string | null, currency: string, basis: string, validation = "not_applicable") => ({
  type: "decimal",
  value,
  unitKind: "currency",
  currency,
  valueBasis: basis,
  validation,
  reason: value === null && (validation === "unknown" || validation === "stale") ? "missing" : null,
});

function table(cells: unknown[][], totals: unknown[] = []) {
  return {
    key: "register",
    titleKey: "report.registers.benefits.title",
    kind: "table",
    sources: [],
    columns: [
      { key: "amount", labelKey: "report.registers.benefits.pending", valueKind: "decimal", unitKind: "currency" },
    ],
    rows: cells.map((c, i) => ({ recordType: "benefit", recordId: id(i + 1), recordVersion: 1, cells: c })),
    totals,
    emptyKey: "report.empty.no_records",
  };
}

describe("table sections: value bases and currencies are never mixed (D-117, D-119, D-122)", () => {
  it("accepts one basis per column; refuses two bases in one column", () => {
    expect(
      reportSection.safeParse(table([[money("1.0000", "SAR", "submitted")], [money("2.0000", "SAR", "submitted")]]))
        .success,
    ).toBe(true);
    const mixed = reportSection.safeParse(
      table([[money("1.0000", "SAR", "submitted")], [money("2.0000", "SAR", "validated")]]),
    );
    expect(mixed.success).toBe(false);
  });

  it("rows may state different currencies, but a totalled column must hold one currency", () => {
    const rows = [[money("1.0000", "SAR", "planned")], [money("2.0000", "USD", "planned")]];
    expect(reportSection.safeParse(table(rows)).success).toBe(true);
    const total = { columnKey: "amount", formula: "sum", value: money("3.0000", "SAR", "planned") };
    expect(reportSection.safeParse(table(rows, [total])).success).toBe(false);
  });

  it("refuses a row of the wrong width and a cell of the wrong kind", () => {
    expect(reportSection.safeParse(table([[]])).success).toBe(false);
    expect(
      reportSection.safeParse(table([[{ type: "count", value: 1, validation: "not_applicable", reason: null }]]))
        .success,
    ).toBe(false);
  });

  it("counts provisional and unknown/stale values (ADR-0045 §5)", () => {
    const s = reportSection.parse(
      table([
        [money("1.0000", "SAR", "submitted", "provisional")],
        [money(null, "SAR", "submitted", "unknown")],
        [{ ...money(null, "SAR", "submitted", "stale"), reason: "stale" }],
        [money("0.0000", "SAR", "submitted")],
      ]),
    ) as ReportSection;
    expect(countReportValues([s])).toEqual({ provisional: 1, unknown: 2 });
  });
});

describe("registers parameters (the list routes' filters)", () => {
  it("one register with its own filters; unknown members and registers are refused", () => {
    expect(registersReportParameters.parse({ register: "raid" })).toEqual({ register: "raid", filters: {} });
    expect(registersReportParameters.parse({ register: "raid", filters: { type: "risk", status: "open" } })).toEqual({
      register: "raid",
      filters: { type: "risk", status: "open" },
    });
    expect(registersReportParameters.safeParse({ register: "raid", filters: { lifecycleStep: "plan" } }).success).toBe(
      false,
    );
    expect(registersReportParameters.safeParse({ register: "budgets" }).success).toBe(false);
    expect(registersReportParameters.safeParse({ register: "actions", filters: { overdue: "true" } }).success).toBe(
      false,
    );
    expect(registersReportParameters.parse({ register: "actions", filters: { overdue: true } }).filters).toEqual({
      overdue: true,
    });
  });
});

describe("reasons are free text of 3-1000 characters (the shared rules)", () => {
  it("refuses blank, too short and invalid characters", () => {
    expect(reportSnapshotReason.safeParse({ reason: "Synthetic reason" }).success).toBe(true);
    expect(reportSnapshotReason.safeParse({ reason: "ab" }).success).toBe(false);
    expect(reportSnapshotReason.safeParse({ reason: "   ‏ " }).success).toBe(false);
    expect(reportSnapshotReason.safeParse({ reason: "abc\u0000" }).success).toBe(false);
  });
});
