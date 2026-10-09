// Unit tests of the KBE-E calculation code (T-DG4-KBE-E; ADR-0030 §4, §7, §8; REQ-S16-025, REQ-S08-009, REQ-S08-011,
// REQ-S08-014, REQ-PB-058, REQ-PB-076, REQ-S08-015, REQ-S08-017, REQ-S08-004). Worked fixtures, all SYNTHETIC:
//  - D01: 0.1 + 0.2 SAR = 0.3000 exactly (decimal.js, never a binary float);
//  - D02: 100000 × 0.02 × 50 = 100000.00 (volume × Δ rate × ARPU, the playbook B0087 revenue example: Δ attach ×
//    customers × ARPU) and the cost example volume × Δ unit cost;
//  - counted once, classes apart, n/a never 0, open overlaps held back, gross − cost = net, Unknown never 0;
//  - corrections: the signed amendment delta and the reversal that nets to zero;
//  - the six Finance items and the strict snapshot; no eval/Function in the KBE-E sources (the DG3 engine only).
import { readFileSync } from "node:fs";
import { evaluateFormula, FORMULA_DECIMAL as D } from "@mth/shared/calc";
import { buildFinanceContent, financeItemsText, missingFinanceItems } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { amendmentDelta, currentValidated, reversalAmount } from "./corrections.ts";
import { money4, seriesTotal, sumExact } from "./values.ts";
import { addAmounts, computeTotals, subtractAmounts, sumOrUnknown, type TotalsBenefit } from "./totals.ts";

const benefit = (id: string, over: Partial<TotalsBenefit> = {}): TotalsBenefit => ({
  id,
  code: id.toUpperCase(),
  valueClass: "revenue_uplift",
  currency: "SAR",
  counted: true,
  exclusionReason: null,
  overlapOpen: false,
  unmonetised: false,
  ...over,
});

describe("REQ-S16-025: decimal arithmetic (D01, D02)", () => {
  it("D01: 0.1 + 0.2 SAR = 0.3000 (JavaScript numbers would give 0.30000000000000004)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(money4(sumExact(["0.1", "0.2"]))).toBe("0.3000");
    expect(sumOrUnknown(["0.1", "0.2"], "SAR", "x")).toEqual({
      status: "known",
      amount: "0.3000",
      currency: "SAR",
      reason: null,
    });
    const t = computeTotals({
      benefits: [benefit("a"), benefit("b", { valueClass: "margin_uplift" })],
      lines: [
        { benefitId: "a", state: "planned", amount: "0.1" },
        { benefitId: "b", state: "planned", amount: "0.2" },
      ],
      costLines: [],
    });
    expect(t.currencies[0]!.gross.planned.amount).toBe("0.3000");
  });

  it("D02: 100000 × 0.02 × 50 = 100000.00 (decimal) and the B0087 examples on the DG3 engine", () => {
    expect(new D("100000").times("0.02").times("50").toFixed(2)).toBe("100000.00");
    const revenue = evaluateFormula("(target_attach_rate - baseline_attach_rate) * eligible_customers * arpu", [
      { name: "baseline_attach_rate", kind: "fraction", period: "none", value: "0.10" },
      { name: "target_attach_rate", kind: "fraction", period: "none", value: "0.12" },
      { name: "eligible_customers", kind: "count", unit: "customers", period: "year", value: "100000" },
      { name: "arpu", kind: "currency", currency: "SAR", unit: "per customer", period: "year", value: "50" },
    ]);
    expect([revenue.ok, revenue.result]).toEqual([true, "100000"]);
    expect(money4(revenue.result!)).toBe("100000.0000");
    const cost = evaluateFormula("volume * (baseline_unit_cost - target_unit_cost)", [
      { name: "volume", kind: "count", unit: "calls", period: "year", value: "2000000" },
      {
        name: "baseline_unit_cost",
        kind: "currency",
        currency: "SAR",
        unit: "per call",
        period: "none",
        value: "4.20",
      },
      { name: "target_unit_cost", kind: "currency", currency: "SAR", unit: "per call", period: "none", value: "3.85" },
    ]);
    expect([cost.ok, cost.result]).toEqual([true, "700000"]);
  });

  it("rounding happens once, at presentation, half up", () => {
    expect(money4("0.00005")).toBe("0.0001");
    expect(money4("-0.00005")).toBe("-0.0001");
    expect(money4("1.23444")).toBe("1.2344");
  });
});

describe("computeTotals (ADR-0030 §7)", () => {
  it("REQ-PB-058: a shared benefit is summed once; excluded benefits are listed and never summed", () => {
    const t = computeTotals({
      benefits: [
        benefit("shared"),
        benefit("parent", { counted: false, exclusionReason: "parent_rollup" }),
        benefit("member", { counted: false, exclusionReason: "group_member_not_counted" }),
      ],
      lines: [
        { benefitId: "shared", state: "planned", amount: "10000000" },
        { benefitId: "member", state: "planned", amount: "10000000" },
      ],
      costLines: [],
    });
    const planned = t.currencies[0]!.lines.find((l) => l.state === "planned" && l.valueClass === "revenue_uplift")!;
    expect([planned.total.amount, planned.count]).toEqual(["10000000.0000", 1]);
    expect(t.excluded.map((e) => e.reason)).toEqual(["group_member_not_counted", "parent_rollup"]);
  });

  it("REQ-S08-009: revenue vs margin and cash saving vs avoided cost are separate lines; states never added", () => {
    const t = computeTotals({
      benefits: [
        benefit("r"),
        benefit("m", { valueClass: "margin_uplift" }),
        benefit("c", { valueClass: "cash_saving" }),
        benefit("a", { valueClass: "avoided_cost" }),
      ],
      lines: [
        { benefitId: "r", state: "validated", amount: "1" },
        { benefitId: "m", state: "validated", amount: "2" },
        { benefitId: "c", state: "validated", amount: "3" },
        { benefitId: "a", state: "validated", amount: "4" },
        { benefitId: "a", state: "submitted", amount: "100" },
        { benefitId: "a", state: "measured", amount: "100" },
      ],
      costLines: [],
    });
    const of = (cls: string, state: string) =>
      t.currencies[0]!.lines.find((l) => l.valueClass === cls && l.state === state)!.total.amount;
    expect([of("revenue_uplift", "validated"), of("margin_uplift", "validated")]).toEqual(["1.0000", "2.0000"]);
    expect([of("cash_saving", "validated"), of("avoided_cost", "validated")]).toEqual(["3.0000", "4.0000"]);
    expect([of("avoided_cost", "submitted"), of("avoided_cost", "measured")]).toEqual(["100.0000", "100.0000"]);
    expect(t.currencies[0]!.gross.validated.amount).toBe("10.0000");
    expect(t.currencies[0]!.lines).toHaveLength(4 * 7);
  });

  it("REQ-PB-076: unmonetised benefits are counted, never summed as 0; currencies are never converted", () => {
    const t = computeTotals({
      benefits: [
        benefit("cx", { valueClass: "non_financial", unmonetised: true }),
        benefit("usd", { currency: "USD" }),
      ],
      lines: [
        { benefitId: "cx", state: "validated", amount: null },
        { benefitId: "usd", state: "planned", amount: "5" },
      ],
      costLines: [{ amount: "7", currency: "SAR", valueBasis: "cash" }],
    });
    expect(t.nonFinancialCount).toBe(1);
    expect(t.currencies.map((c) => c.currency)).toEqual(["SAR", "USD"]);
    expect(t.currencies[0]!.lines).toEqual([]);
    expect(t.currencies[1]!.gross.planned).toEqual({
      status: "known",
      amount: "5.0000",
      currency: "USD",
      reason: null,
    });
  });

  it("REQ-S08-014: an open overlap moves validated and sustained values to pendingOverlap", () => {
    const t = computeTotals({
      benefits: [benefit("o", { overlapOpen: true })],
      lines: [
        { benefitId: "o", state: "validated", amount: "700" },
        { benefitId: "o", state: "sustained", amount: "30" },
        { benefitId: "o", state: "planned", amount: "900" },
      ],
      costLines: [],
    });
    const c = t.currencies[0]!;
    expect(c.lines.find((l) => l.state === "validated")).toMatchObject({ total: { amount: "0.0000" }, count: 0 });
    expect(c.lines.find((l) => l.state === "planned")).toMatchObject({ total: { amount: "900.0000" }, count: 1 });
    expect(c.pendingOverlap.map((l) => [l.state, l.total.amount, l.count])).toEqual([
      ["validated", "700.0000", 1],
      ["sustained", "30.0000", 1],
    ]);
  });

  it("REQ-S08-011: net = gross − each cost line once; a NULL cost is Unknown (never 0)", () => {
    const base = {
      benefits: [benefit("g")],
      lines: [
        { benefitId: "g", state: "planned", amount: "3000000" },
        { benefitId: "g", state: "validated", amount: "1500000" },
      ],
    };
    const t = computeTotals({ ...base, costLines: [{ amount: "1000000", currency: "SAR", valueBasis: "cash" }] });
    const c = t.currencies[0]!;
    expect([c.implementationCost.total.amount, c.net.planned.amount, c.net.validated.amount]).toEqual([
      "1000000.0000",
      "2000000.0000",
      "500000.0000",
    ]);
    const u = computeTotals({
      ...base,
      costLines: [
        { amount: "1000000", currency: "SAR", valueBasis: "cash" },
        { amount: null, currency: "SAR", valueBasis: "non_cash" },
      ],
    }).currencies[0]!;
    expect(u.implementationCost.cash.amount).toBe("1000000.0000");
    expect(u.implementationCost.nonCash.status).toBe("unknown");
    expect([u.implementationCost.total.status, u.net.planned.status, u.net.planned.reason]).toEqual([
      "unknown",
      "unknown",
      "benefit.cost_amount_missing",
    ]);
  });

  it("a value line without an amount makes its line and gross Unknown, never 0", () => {
    const t = computeTotals({
      benefits: [benefit("x")],
      lines: [
        { benefitId: "x", state: "submitted", amount: null },
        { benefitId: "x", state: "submitted", amount: "5" },
      ],
      costLines: [],
    });
    const s = t.currencies[0]!.lines.find((l) => l.state === "submitted")!;
    expect([s.total.status, s.total.amount, s.count]).toEqual(["unknown", null, 2]);
    expect(seriesTotal([null], "SAR", false).status).toBe("unknown");
    expect(seriesTotal(["1"], "SAR", true)).toEqual({
      status: "not_applicable",
      amount: null,
      currency: null,
      reason: null,
    });
    expect(seriesTotal([], "SAR", false)).toEqual({ status: "known", amount: "0.0000", currency: "SAR", reason: null });
  });

  it("an initiative view multiplies by the allocated share", () => {
    const t = computeTotals({
      benefits: [benefit("s", { share: "0.6" })],
      lines: [{ benefitId: "s", state: "planned", amount: "10000000" }],
      costLines: [],
    });
    expect(t.currencies[0]!.lines.find((l) => l.state === "planned")!.total.amount).toBe("6000000.0000");
  });

  it("addAmounts / subtractAmounts propagate Unknown", () => {
    const k = (a: string) => ({ status: "known" as const, amount: a, currency: "SAR", reason: null });
    const u = { status: "unknown" as const, amount: null, currency: "SAR", reason: "r" };
    expect(addAmounts(k("1.5"), k("2.25"), "SAR").amount).toBe("3.7500");
    expect(subtractAmounts(k("1"), k("2.5"), "SAR").amount).toBe("-1.5000");
    expect(addAmounts(u, k("1"), "SAR")).toEqual({ status: "unknown", amount: null, currency: "SAR", reason: "r" });
    expect(subtractAmounts(k("1"), u, "SAR").status).toBe("unknown");
  });
});

describe("corrections (REQ-S08-017)", () => {
  it("amend 240000.5 -> 239500 is -500.5000; the reversal nets original + amendments to zero", () => {
    expect(currentValidated("240000.5", [])).toBe("240000.5");
    expect(amendmentDelta("239500", "240000.5")).toBe("-500.5000");
    const current = currentValidated("240000.5", ["-500.5"]);
    expect(current).toBe("239500");
    expect(reversalAmount(current)).toBe("-239500.0000");
    expect(sumExact(["240000.5", "-500.5", "-239500"])).toBe("0");
    expect(new D(amendmentDelta("239500.0000", current)).isZero()).toBe(true);
  });
});

describe("the six Finance items (REQ-S08-015) and the snapshot", () => {
  it("names the missing items in order; the snapshot has exactly the six keys and needs the period", () => {
    expect(
      missingFinanceItems({ baseline: {}, attribution: {}, calculation: {}, evidence: {}, assumptions: {} }),
    ).toEqual(["measurementPeriod"]);
    expect(financeItemsText(["attribution", "measurementPeriod"])).toBe(
      "attribution/counterfactual, measurement period",
    );
    const facts = {
      benefit: {
        baseline_value: "1000000.000000",
        baseline_unit: "SAR",
        baseline_date: null,
        baseline_id: null,
        counterfactual: null,
        baseline_validation_status: "validated",
      },
      measurement: {
        formula_version_id: null,
        benefit_calculation_id: null,
        amount: "250000.0000",
        kpi_value: null,
        currency: "SAR",
        attribution: null,
        assumptions: null,
        period_start: "2026-09-01",
        period_end: "2026-09-30",
      },
      inputs: [],
      evidenceIds: [],
    };
    expect(Object.keys(buildFinanceContent(facts)).sort()).toEqual(
      ["assumptions", "attribution", "baseline", "calculation", "evidence", "measurementPeriod"].sort(),
    );
    expect(() =>
      buildFinanceContent({ ...facts, measurement: { ...facts.measurement, period_start: null } }),
    ).toThrow();
  });
});

describe("REQ-S08-004: no evaluator of its own", () => {
  it("the KBE-E sources contain no eval, Function constructor or dynamic import of code", () => {
    const files = [
      "./measurements.ts",
      "./finance-validation.ts",
      "./corrections.ts",
      "./totals.ts",
      "./values.ts",
      "./downstream.ts",
      "../../../../worker/src/handlers/benefits.ts",
    ];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\beval\s*\(/);
      expect(src, f).not.toMatch(/\bnew\s+Function\b|\bFunction\s*\(/);
      expect(src, f).not.toMatch(/\bvm\.|node:vm/);
    }
  });
});
