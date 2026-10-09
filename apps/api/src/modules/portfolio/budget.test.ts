// Unit tests of the budget-line arithmetic and refusals (T-DG4-BE-E; ADR-0031 §7, §11, §13; REQ-S09-007 "budget/actual/
// forecast use decimal SAR"). Decimal only: no float ever touches an amount. All amounts are SYNTHETIC.
import { describe, expect, it } from "vitest";
import { HttpProblem, mapDatabaseGuardError } from "../platform/index.ts";
import { budgetTotals, checkAmounts, checkPeriod, Money, moneyText } from "./budget.ts";

const refusal = (fn: () => void): HttpProblem => {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpProblem) return err;
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("decimal money (ADR-0031 §7 probes BU02, BU03)", () => {
  it("100000 x 0.02 x 50 = 100000.00 exactly", () => {
    expect(new Money("100000").times("0.02").times("50").toFixed(2)).toBe("100000.00");
    expect(moneyText(new Money("100000").times("0.02").times("50"))).toBe("100000.0000");
  });
  it("0.1 + 0.2 = 0.3 exactly (a float would give 0.30000000000000004)", () => {
    expect(moneyText(new Money("0.1").plus("0.2"))).toBe("0.3000");
    expect(new Money("0.1").plus("0.2").equals("0.3")).toBe(true);
  });
});

describe("budgetTotals", () => {
  const l = (currency: string, b: string | null, a: string | null, f: string | null) => ({
    currency,
    budget_amount: b,
    actual_amount: a,
    forecast_amount: f,
  });

  it("no line -> no total (the caller reports no_budget_lines)", () => {
    expect(budgetTotals([])).toEqual([]);
  });

  it("sums per currency in code order, never converted; variances are forecast - budget and actual - budget", () => {
    const t = budgetTotals([
      l("USD", "1.0000", "2.0000", "3.0000"),
      l("SAR", "0.1000", "0.1000", "0.0500"),
      l("SAR", "0.2000", "0.3000", "0.2000"),
    ]);
    expect(t.map((x) => x.currency)).toEqual(["SAR", "USD"]);
    expect([t[0]!.budget.amount, t[0]!.actual.amount, t[0]!.forecast.amount]).toEqual(["0.3000", "0.4000", "0.2500"]);
    expect([t[0]!.forecastVariance.amount, t[0]!.actualVariance.amount]).toEqual(["-0.0500", "0.1000"]);
    expect([t[1]!.budget.amount, t[1]!.forecastVariance.amount, t[1]!.actualVariance.amount]).toEqual([
      "1.0000",
      "2.0000",
      "1.0000",
    ]);
  });

  it("a missing amount makes the total unknown with the known part, never 0; none known -> knownAmount null", () => {
    const [t] = budgetTotals([l("SAR", "10", null, null), l("SAR", null, null, "5")]);
    expect(t!.budget).toEqual({
      status: "unknown",
      amount: null,
      knownAmount: "10.0000",
      missingCount: 1,
      reason: "missing_amounts",
    });
    expect(t!.actual).toEqual({
      status: "unknown",
      amount: null,
      knownAmount: null,
      missingCount: 2,
      reason: "missing_amounts",
    });
    expect(t!.forecastVariance).toEqual({
      status: "unknown",
      amount: null,
      knownAmount: null,
      missingCount: 2,
      reason: "missing_amounts",
    });
  });

  it("a known zero total stays a known 0.0000 (zero is data, not Unknown)", () => {
    const [t] = budgetTotals([l("SAR", "0", "0", "0")]);
    expect(t!.budget).toEqual({
      status: "known",
      amount: "0.0000",
      knownAmount: "0.0000",
      missingCount: 0,
      reason: null,
    });
  });
});

describe("checkAmounts / checkPeriod (ADR-0031 §11)", () => {
  const TEXT = "Amounts must be zero or more, with at most 16 digits before and 4 after the decimal point.";
  it.each([
    ["budgetAmount", { budgetAmount: "-0.0001" }],
    ["actualAmount", { actualAmount: "12345678901234567" }],
    ["forecastAmount", { forecastAmount: "0.00001" }],
  ] as const)("%s out of range -> 422 budget_line.amount_invalid at the field", (field, body) => {
    const p = refusal(() => checkAmounts(body));
    expect([p.status, p.code, p.detail, p.errors?.[0]?.pointer]).toEqual([
      422,
      "budget_line.amount_invalid",
      TEXT,
      `/${field}`,
    ]);
  });
  it("accepts zero, -0, null, absent and the numeric(20,4) maximum", () => {
    expect(() =>
      checkAmounts({ budgetAmount: "0", actualAmount: "-0", forecastAmount: "9999999999999999.9999" }),
    ).not.toThrow();
    expect(() => checkAmounts({ budgetAmount: null })).not.toThrow();
    expect(() => checkAmounts({})).not.toThrow();
  });
  it("a month other than its first day -> 422 budget_line.period_invalid at /periodMonth", () => {
    const p = refusal(() => checkPeriod("2026-10-31"));
    expect([p.status, p.code, p.detail, p.errors?.[0]?.pointer]).toEqual([
      422,
      "budget_line.period_invalid",
      "The month must be given as its first day (YYYY-MM-01).",
      "/periodMonth",
    ]);
    expect(() => checkPeriod("2026-10-01")).not.toThrow();
    expect(() => checkPeriod(null)).not.toThrow();
  });
});

describe("database last lines (platform/db-errors.ts, BE-E part of the slice E block)", () => {
  const map = (constraint: string) => mapDatabaseGuardError({ code: "23514", constraint });
  it("maps the budget and schedule guards to the exact ADR-0031 §11 refusals", () => {
    expect([map("budget_line_archived_frozen")?.status, map("budget_line_archived_frozen")?.code]).toEqual([
      422,
      "budget_line.archived",
    ]);
    expect([map("budget_line_active_key")?.status, map("budget_line_active_key")?.code]).toEqual([
      409,
      "budget_line.duplicate",
    ]);
    expect([map("budget_line_period_month_check")?.status, map("budget_line_period_month_check")?.code]).toEqual([
      422,
      "budget_line.period_invalid",
    ]);
    const exists = map("initiative_schedule_initiative_key");
    expect([exists?.status, exists?.code, exists?.detail]).toEqual([
      409,
      "initiative_schedule.exists",
      "This initiative already has a planned duration; update it instead.",
    ]);
  });
  it("guards the API never reaches are programming errors (500)", () => {
    expect(map("budget_line_currency_locked")?.status).toBe(500);
    expect(map("initiative_schedule_initiative_immutable")?.status).toBe(500);
  });
});
