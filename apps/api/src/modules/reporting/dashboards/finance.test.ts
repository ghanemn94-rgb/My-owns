// Unit tests of the Finance dashboard's pure functions (T-DG4-KBE-G2; ADR-0030 §6-§8; ADR-0037 §5, §12) with worked
// fixtures. Decimal only: every expected figure is a decimal string, never a float. All data is synthetic.
import { describe, expect, it } from "vitest";
import type { DashboardClock, ValueBenefitFact, ValueLineFact } from "./areas.ts";
import { financeClassLines, financeClassOf, subtractValues } from "./finance.ts";

const clock: DashboardClock = {
  businessDate: "2026-10-10",
  asOf: "2026-10-10",
  windowStart: null,
  windowEnd: null,
  calendar: null,
};

const benefit = (over: Partial<ValueBenefitFact> & Pick<ValueBenefitFact, "benefitId">): ValueBenefitFact =>
  ({
    transformationId: "t",
    code: "B01",
    title: "Synthetic",
    ownerUserId: null,
    valueClass: "revenue_uplift",
    currency: "SAR",
    counted: true,
    overlapOpen: false,
    unmonetised: false,
    ...over,
  }) as ValueBenefitFact;

let seq = 0;
const line = (benefitId: string, state: string, amount: string | null, periodEnd = "2026-02-28"): ValueLineFact =>
  ({
    benefitId,
    transformationId: "t",
    state,
    amount,
    currency: "SAR",
    periodStart: "2026-02-01",
    periodEnd,
    recordTable: "benefit_measurement",
    recordId: `r${(seq += 1)}`,
  }) as ValueLineFact;

const total = (rows: ReturnType<typeof financeClassLines>, valueClass: string, state: string, currency = "SAR") =>
  rows.find((r) => r.valueClass === valueClass && r.state === state && r.currency === currency)?.total;

describe("financeClassOf (ADR-0030 §7 items 1-3)", () => {
  it("counted financial benefits keep their class; non-financial with an approved method is non_financial_valued", () => {
    expect(financeClassOf(benefit({ benefitId: "a" }))).toBe("revenue_uplift");
    expect(financeClassOf(benefit({ benefitId: "b", valueClass: "non_financial" }))).toBe("non_financial_valued");
  });
  it("an unmonetised (no approved method) or not-counted benefit enters no line: n/a, never 0", () => {
    expect(financeClassOf(benefit({ benefitId: "c", valueClass: "non_financial", unmonetised: true }))).toBeNull();
    expect(financeClassOf(benefit({ benefitId: "d", counted: false }))).toBeNull();
  });
});

describe("financeClassLines (class × state × currency; each state on its own)", () => {
  it("worked fixture: revenue uplift and avoided cost stay separate lines; states are never added together", () => {
    const rev = benefit({ benefitId: "rev" });
    const avo = benefit({ benefitId: "avo", valueClass: "avoided_cost" });
    const rows = financeClassLines(
      [rev, avo],
      [
        line("rev", "planned", "1000.0000"),
        line("rev", "planned", "500.0000", "2026-03-31"),
        line("rev", "validated", "900.0000"),
        line("rev", "submitted", "250.0000", "2026-03-31"),
        line("rev", "forecast", "999999.0000", "2027-03-31"),
        line("avo", "planned", "0.1000"),
        line("avo", "planned", "0.2000"),
      ],
      clock,
    );
    expect(total(rows, "revenue_uplift", "planned")).toMatchObject({ state: "value", value: "1500" });
    expect(total(rows, "revenue_uplift", "validated")).toMatchObject({ state: "value", value: "900" });
    expect(total(rows, "revenue_uplift", "submitted")).toMatchObject({ state: "value", value: "250" });
    // Forecast is never validated; without a period filter every forecast line is shown in its own state.
    expect(total(rows, "revenue_uplift", "forecast")).toMatchObject({ state: "value", value: "999999" });
    expect(total(rows, "revenue_uplift", "rejected")).toMatchObject({ state: "zero", value: "0" });
    // Decimal: 0.1 + 0.2 = 0.3 exactly (ADR-0030 probe D01), in avoided cost, never in cash savings or revenue.
    expect(total(rows, "avoided_cost", "planned")).toMatchObject({ state: "value", value: "0.3" });
    expect(total(rows, "cash_saving", "planned")).toBeUndefined();
    expect(rows.filter((r) => r.valueClass === "revenue_uplift").map((r) => r.state)).toEqual([
      "planned",
      "forecast",
      "measured",
      "submitted",
      "validated",
      "rejected",
      "sustained",
    ]);
  });

  it("planned, validated and the other states are 'to date': a line ending after the as-of date is left out", () => {
    const rows = financeClassLines(
      [benefit({ benefitId: "x" })],
      [line("x", "planned", "100"), line("x", "planned", "700", "2026-12-31")],
      clock,
    );
    expect(total(rows, "revenue_uplift", "planned")?.value).toBe("100");
  });

  it("a period window keeps only the lines inside it", () => {
    const q1: DashboardClock = { ...clock, windowStart: "2026-01-01", windowEnd: "2026-03-31", asOf: "2026-03-31" };
    const rows = financeClassLines(
      [benefit({ benefitId: "x" })],
      [line("x", "planned", "100", "2026-02-28"), line("x", "planned", "40", "2026-05-31")],
      q1,
    );
    expect(total(rows, "revenue_uplift", "planned")?.value).toBe("100");
  });

  it("a missing amount makes the total Unknown with its reason, never 0", () => {
    const rows = financeClassLines([benefit({ benefitId: "x" })], [line("x", "validated", null)], clock);
    expect(total(rows, "revenue_uplift", "validated")).toEqual({
      state: "unknown",
      value: null,
      unit: "currency",
      currency: "SAR",
      reasonKey: "benefit.value_amount_missing",
    });
  });

  it("an open overlap holds back validated and sustained values (ADR-0030 §7 item 4), not planned ones", () => {
    const rows = financeClassLines(
      [benefit({ benefitId: "o", overlapOpen: true })],
      [line("o", "planned", "10"), line("o", "validated", "9"), line("o", "sustained", "8")],
      clock,
    );
    expect([
      total(rows, "revenue_uplift", "planned")?.value,
      total(rows, "revenue_uplift", "validated")?.state,
      total(rows, "revenue_uplift", "sustained")?.state,
    ]).toEqual(["10", "zero", "zero"]);
  });

  it("currencies are never converted or added: each is its own block", () => {
    const rows = financeClassLines(
      [benefit({ benefitId: "s" }), benefit({ benefitId: "u", currency: "USD" })],
      [line("s", "planned", "100"), line("u", "planned", "7")],
      clock,
    );
    expect([
      total(rows, "revenue_uplift", "planned", "SAR")?.value,
      total(rows, "revenue_uplift", "planned", "USD")?.value,
    ]).toEqual(["100", "7"]);
  });

  it("an unmonetised non-financial benefit produces no line at all (REQ-PB-076)", () => {
    const rows = financeClassLines(
      [benefit({ benefitId: "n", valueClass: "non_financial", unmonetised: true })],
      [line("n", "planned", null)],
      clock,
    );
    expect(rows).toEqual([]);
  });
});

describe("subtractValues (net = gross − implementation cost; ADR-0030 §7 item 6)", () => {
  const known = (value: string) => ({
    state: "value" as const,
    value,
    unit: "currency",
    currency: "SAR",
    reasonKey: null,
  });
  it("worked fixture: 10 000 000 gross − 1 000 000 initiative cost = 9 000 000 (subtracted once)", () => {
    expect(subtractValues(known("10000000.0000"), known("1000000.0000"), "SAR")).toMatchObject({
      state: "value",
      value: "9000000",
    });
  });
  it("a known zero result is the state zero; a negative net is a value", () => {
    expect(subtractValues(known("5"), known("5"), "SAR")).toMatchObject({ state: "zero", value: "0" });
    expect(subtractValues(known("1"), known("3.5"), "SAR")).toMatchObject({ state: "value", value: "-2.5" });
  });
  it("an Unknown cost makes net Unknown with the cost reason, never gross", () => {
    const unknownCost = {
      state: "unknown" as const,
      value: null,
      unit: "currency",
      currency: "SAR",
      reasonKey: "benefit.cost_amount_missing",
    };
    expect(subtractValues(known("100"), unknownCost, "SAR")).toEqual({
      state: "unknown",
      value: null,
      unit: "currency",
      currency: "SAR",
      reasonKey: "benefit.cost_amount_missing",
    });
  });
});
