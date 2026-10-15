// Unit tests of the reconciliation row mapping (T-DG5-KBE-E; ADR-0047 §2, §9). Pure: no database. Worked fixtures:
//  - an `ok` pair shows both numbers and the difference, in canonical form ("90.000000" -> "90");
//  - a stale, unknown or not computable side shows no number (null, never 0), and there is no difference;
//  - a stored row (numeric(24,6) strings, a stale side keeping its number as the CHECK requires) maps to exactly the
//    API row of the preview it was written from, so "the retained reconciliation equals the draft preview".
import { describe, expect, it } from "vitest";
import { fromStoredRow, toReconciliationRow, type ReconciliationRowData } from "./restatement-reconciliation.ts";

const P = "01900000-0000-7000-8000-000000000001";
const T = "01900000-0000-7000-8000-000000000002";
const E = "01900000-0000-7000-8000-000000000003";
const V = "01900000-0000-7000-8000-000000000004";

const preview = (over: Partial<ReconciliationRowData> = {}): ReconciliationRowData => ({
  reportingPeriodId: P,
  periodLabel: "2072-Q1",
  scopeKind: "transformation",
  scopeId: T,
  valueBasis: "period",
  before: { evaluationId: E, kpiVersionId: V, value: "90", valueStatus: "ok", rag: "amber", target: "100" },
  after: { value: "90", valueStatus: "ok", rag: "red", target: "120" },
  difference: "0",
  currency: null,
  unitKind: "count",
  ...over,
});

describe("toReconciliationRow", () => {
  it("an ok pair shows both numbers, the targets and the difference, canonically", () => {
    const r = toReconciliationRow(
      preview({
        before: {
          evaluationId: E,
          kpiVersionId: V,
          value: "90.500000",
          valueStatus: "ok",
          rag: "amber",
          target: "100.000000",
        },
        after: { value: "95.250000", valueStatus: "ok", rag: "green", target: "120.000000" },
        difference: "4.750000",
      }),
    );
    expect([r.before.value, r.before.target, r.after.value, r.after.target, r.difference]).toEqual([
      "90.5",
      "100",
      "95.25",
      "120",
      "4.75",
    ]);
  });

  it("stale, unknown and not computable sides carry no number, never 0, and no difference", () => {
    for (const status of ["stale", "unknown", "not_computable"] as const) {
      const r = toReconciliationRow(
        preview({
          before: {
            evaluationId: E,
            kpiVersionId: V,
            value: status === "stale" ? "40" : null,
            valueStatus: status,
            rag: status,
            target: "100",
          },
          after: { value: status === "stale" ? "40" : null, valueStatus: status, rag: status, target: "100" },
          difference: null,
        }),
      );
      expect([r.before.value, r.after.value, r.difference, r.before.rag, r.after.rag]).toEqual([
        null,
        null,
        null,
        status,
        status,
      ]);
    }
  });

  it("a slot never evaluated before has before `none` with no number", () => {
    const r = toReconciliationRow(
      preview({
        before: { evaluationId: null, kpiVersionId: null, value: null, valueStatus: "none", rag: "none", target: null },
        difference: null,
      }),
    );
    expect(r.before).toEqual({
      evaluationId: null,
      kpiVersionId: null,
      value: null,
      valueStatus: "none",
      rag: "none",
      target: null,
    });
    expect(r.after.value).toBe("90");
  });
});

describe("fromStoredRow", () => {
  it("the stored form of a preview row maps back to the same API row", () => {
    const data = preview({
      after: { value: "95.25", valueStatus: "ok", rag: "green", target: "120" },
      difference: "5.25",
      currency: "SAR",
      unitKind: "currency",
    });
    const stored = fromStoredRow(
      {
        reporting_period_id: P,
        scope_kind: "transformation",
        scope_id: T,
        value_basis: "period",
        before_evaluation_id: E,
        before_kpi_version_id: V,
        before_value: "90.000000",
        before_value_status: "ok",
        before_rag: "amber",
        before_target: "100.000000",
        after_value: "95.250000",
        after_value_status: "ok",
        after_rag: "green",
        after_target: "120.000000",
        difference: "5.250000",
        currency: "SAR",
      },
      "2072-Q1",
      "currency",
    );
    expect(toReconciliationRow(stored)).toEqual(toReconciliationRow(data));
  });
});
