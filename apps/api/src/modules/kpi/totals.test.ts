// Unit tests of the business-case totals and roll-up (kpi/totals.ts; ADR-0024 §3; REQ-S05-005, REQ-PB-054). Worked
// fixtures, all SYNTHETIC. The two benefit amounts are the B0087 playbook examples as the shared engine stores them:
// Δ attach × customers × ARPU = 0.02 × 100000 × 50 = 100000 SAR, and volume × Δ unit cost = 200000 × 2.50 = 500000 SAR.
// The totals never re-implement that arithmetic; they only add stored line amounts.
import { describe, expect, it } from "vitest";
import { computeTotals, moneyTotals, netTotals, normaliseTitle, periodsOverlap, type TotalsLine } from "./totals.ts";

const T = "00000000-0000-7000-8000-0000000000a0"; // transformation case
const I1 = "00000000-0000-7000-8000-0000000000b1"; // initiative case 1
const I2 = "00000000-0000-7000-8000-0000000000b2"; // initiative case 2

let n = 0;
const line = (over: Partial<TotalsLine> & Pick<TotalsLine, "businessCaseId">): TotalsLine => ({
  id: `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`,
  lineKind: "benefit",
  class: "revenue",
  valueBasis: "revenue_uplift",
  title: `Line ${n}`,
  amount: "0",
  currency: "SAR",
  periodStart: null,
  periodEnd: null,
  ...over,
});

// The engine's stored results for the two B0087 examples (ADR-0024 §6 item 12: canonical "100000" / "500000", stored
// numeric(24,6)). The engine itself is tested in packages/shared/src/formula; the API boundary rules do not list
// @mth/shared/calc for this module yet (see the T-DG3-KBE-B handback), so the stored values are used here verbatim.
const revenueExample = { ok: true, result: "100000", rounding: { stored: "100000.000000" } };
const costExample = { ok: true, result: "500000", rounding: { stored: "500000.000000" } };

describe("playbook examples feed the lines exactly", () => {
  it("Δ attach × customers × ARPU = 0.02 × 100000 × 50 = 100000; volume × Δ unit cost = 200000 × 2.50 = 500000", () => {
    expect([revenueExample.ok, revenueExample.result]).toEqual([true, "100000"]);
    expect([costExample.ok, costExample.result]).toEqual([true, "500000"]);
  });

  it("a case with both examples plus a 150000.0000 capex line: gross 600000, cost 150000, net 450000", () => {
    const lines = [
      line({ businessCaseId: T, amount: revenueExample.rounding.stored!, title: "Roaming attach uplift" }),
      line({
        businessCaseId: T,
        class: "cost_reduction",
        valueBasis: "cash_saving",
        amount: costExample.rounding.stored!,
      }),
      line({ businessCaseId: T, lineKind: "investment", class: "capex", valueBasis: "cash", amount: "150000.0000" }),
    ];
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines });
    expect(t.grossBenefits).toEqual([{ currency: "SAR", amount: "600000", unknownLineCount: 0, lineCount: 2 }]);
    expect(t.implementationCost).toEqual([{ currency: "SAR", amount: "150000", unknownLineCount: 0, lineCount: 1 }]);
    expect(t.netValue).toEqual([{ currency: "SAR", amount: "450000", unknownLineCount: 0, lineCount: 3 }]);
    expect(t.grossBenefitsByValueBasis).toEqual({
      cash_saving: [{ currency: "SAR", amount: "500000", unknownLineCount: 0, lineCount: 1 }],
      revenue_uplift: [{ currency: "SAR", amount: "100000", unknownLineCount: 0, lineCount: 1 }],
    });
  });
});

describe("distinct lines, each counted once", () => {
  it("the same line handed in twice (or via two included ids) counts once", () => {
    const a = line({ businessCaseId: T, amount: "100.25" });
    const b = line({ businessCaseId: T, amount: "0.75" });
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines: [a, b, a, a] });
    expect(t.grossBenefits).toEqual([{ currency: "SAR", amount: "101", unknownLineCount: 0, lineCount: 2 }]);
  });

  it("lines of cases not included (e.g. archived initiative cases) never count", () => {
    const own = line({ businessCaseId: T, amount: "10" });
    const stray = line({ businessCaseId: I2, amount: "999" });
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines: [own, stray] });
    expect(t.grossBenefits[0]!.amount).toBe("10");
  });

  it("0.1 + 0.2 = 0.3 exactly", () => {
    const lines = [line({ businessCaseId: T, amount: "0.1" }), line({ businessCaseId: T, amount: "0.2" })];
    expect(
      computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines }).grossBenefits[0]!
        .amount,
    ).toBe("0.3");
  });

  it("numeric(20,4) extremes sum exactly (no float precision loss)", () => {
    const lines = [
      line({ businessCaseId: T, amount: "9999999999999999.9999" }),
      line({ businessCaseId: T, amount: "0.0001" }),
    ];
    expect(
      computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines }).grossBenefits[0]!
        .amount,
    ).toBe("10000000000000000");
  });
});

describe("roll-up by reference", () => {
  const top = line({ businessCaseId: T, lineKind: "investment", class: "opex", valueBasis: "cash", amount: "200" });
  const i1Benefit = line({ businessCaseId: I1, amount: "1000" });
  const i1Cost = line({
    businessCaseId: I1,
    lineKind: "investment",
    class: "capex",
    valueBasis: "cash",
    amount: "300",
  });
  const i2Benefit = line({ businessCaseId: I2, class: "cost_avoidance", valueBasis: "avoided_cost", amount: "50" });

  it("transformation total = own lines ∪ initiative lines, each once; initiative totals stay their own", () => {
    const all = [top, i1Benefit, i1Cost, i2Benefit];
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T, I1, I2], transformationCaseId: T, lines: all });
    expect(t.includedCaseIds).toEqual([T, I1, I2]);
    expect(t.grossBenefits[0]).toEqual({ currency: "SAR", amount: "1050", unknownLineCount: 0, lineCount: 2 });
    expect(t.implementationCost[0]).toEqual({ currency: "SAR", amount: "500", unknownLineCount: 0, lineCount: 2 });
    expect(t.netValue[0]!.amount).toBe("550");
    const i1 = computeTotals({ businessCaseId: I1, includedCaseIds: [I1], transformationCaseId: null, lines: all });
    expect([i1.grossBenefits[0]!.amount, i1.implementationCost[0]!.amount, i1.netValue[0]!.amount]).toEqual([
      "1000",
      "300",
      "700",
    ]);
    // Σ initiative nets + the transformation's own lines = the transformation net (no cost subtracted twice).
  });

  it("editing an initiative line changes the roll-up on the next computation without duplicating it", () => {
    const edited = { ...i1Benefit, amount: "1500" };
    const t = computeTotals({
      businessCaseId: T,
      includedCaseIds: [T, I1, I2],
      transformationCaseId: T,
      lines: [top, edited, i1Cost, i2Benefit],
    });
    expect(t.grossBenefits[0]).toEqual({ currency: "SAR", amount: "1550", unknownLineCount: 0, lineCount: 2 });
  });
});

describe("gross, cost and net shown separately; economic quantities kept apart", () => {
  it("cash and non-cash investment subtotals; implementation cost = both, net subtracts each line once", () => {
    const lines = [
      line({ businessCaseId: T, lineKind: "investment", class: "capex", valueBasis: "cash", amount: "100" }),
      line({ businessCaseId: T, lineKind: "investment", class: "vendor_cost", valueBasis: "cash", amount: "20" }),
      line({ businessCaseId: T, lineKind: "investment", class: "internal_fte", valueBasis: "non_cash", amount: "30" }),
      line({ businessCaseId: T, amount: "1000" }),
    ];
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines });
    expect(t.implementationCostCash[0]!.amount).toBe("120");
    expect(t.implementationCostNonCash[0]!.amount).toBe("30");
    expect(t.implementationCost[0]!.amount).toBe("150");
    expect(t.netValue[0]!.amount).toBe("850");
    expect(t.grossBenefits[0]!.amount).toBe("1000");
  });

  it("revenue uplift and margin uplift are separate, with the revenue_and_margin warning", () => {
    const lines = [
      line({ businessCaseId: T, valueBasis: "revenue_uplift", amount: "100" }),
      line({ businessCaseId: T, valueBasis: "margin_uplift", amount: "40" }),
    ];
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines });
    expect(t.grossBenefitsByValueBasis["revenue_uplift"]![0]!.amount).toBe("100");
    expect(t.grossBenefitsByValueBasis["margin_uplift"]![0]!.amount).toBe("40");
    expect(t.warnings.map((w) => w.code)).toEqual(["business_case.revenue_and_margin"]);
  });

  it("avoided cost is kept apart from cash savings", () => {
    const lines = [
      line({ businessCaseId: T, class: "cost_reduction", valueBasis: "cash_saving", amount: "70" }),
      line({ businessCaseId: T, class: "cost_avoidance", valueBasis: "avoided_cost", amount: "30" }),
    ];
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines });
    expect(Object.keys(t.grossBenefitsByValueBasis)).toEqual(["avoided_cost", "cash_saving"]);
    expect(Object.keys(t.grossBenefitsByClass)).toEqual(["cost_avoidance", "cost_reduction"]);
    expect(t.warnings).toEqual([]);
  });

  it("strategic / non-financial benefits are counted, never summed or monetised", () => {
    const lines = [
      line({ businessCaseId: T, class: "strategic_non_financial", valueBasis: "non_financial", amount: null }),
      line({ businessCaseId: T, amount: "5" }),
    ];
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines });
    expect(t.nonFinancialBenefitCount).toBe(1);
    expect(t.grossBenefits).toEqual([{ currency: "SAR", amount: "5", unknownLineCount: 0, lineCount: 1 }]);
    expect(t.grossBenefitsByClass["strategic_non_financial"]).toBeUndefined();
  });
});

describe("Unknown is never 0", () => {
  it("all lines Unknown -> amount null with the counts; partial -> the known sum and the unknown count", () => {
    expect(moneyTotals([line({ businessCaseId: T, amount: null }), line({ businessCaseId: T, amount: null })])).toEqual(
      [{ currency: "SAR", amount: null, unknownLineCount: 2, lineCount: 2 }],
    );
    expect(moneyTotals([line({ businessCaseId: T, amount: null }), line({ businessCaseId: T, amount: "7" })])).toEqual([
      { currency: "SAR", amount: "7", unknownLineCount: 1, lineCount: 2 },
    ]);
  });

  it("a known 0 stays a real 0 (distinct from Unknown)", () => {
    expect(moneyTotals([line({ businessCaseId: T, amount: "0.0000" })])[0]!.amount).toBe("0");
  });

  it("net is Unknown when either side has no known amount in that currency (no cost lines is not a zero cost)", () => {
    const gross = moneyTotals([line({ businessCaseId: T, amount: "100" })]);
    expect(netTotals(gross, [])).toEqual([{ currency: "SAR", amount: null, unknownLineCount: 0, lineCount: 1 }]);
    const unknownCost = moneyTotals([
      line({ businessCaseId: T, lineKind: "investment", class: "capex", valueBasis: "cash", amount: null }),
    ]);
    expect(netTotals(gross, unknownCost)[0]).toEqual({
      currency: "SAR",
      amount: null,
      unknownLineCount: 1,
      lineCount: 2,
    });
  });

  it("an empty case has no totals at all (never a zero total)", () => {
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines: [] });
    expect([t.grossBenefits, t.implementationCost, t.netValue]).toEqual([[], [], []]);
  });

  it("a negative net is reported as such", () => {
    const gross = moneyTotals([line({ businessCaseId: T, amount: "100" })]);
    const cost = moneyTotals([
      line({ businessCaseId: T, lineKind: "investment", class: "capex", valueBasis: "cash", amount: "250.5" }),
    ]);
    expect(netTotals(gross, cost)[0]!.amount).toBe("-150.5");
  });
});

describe("per currency, no FX", () => {
  it("amounts in different currencies are never added; net is per currency", () => {
    const lines = [
      line({ businessCaseId: T, amount: "100", currency: "SAR" }),
      line({ businessCaseId: T, amount: "10", currency: "USD" }),
      line({
        businessCaseId: T,
        lineKind: "investment",
        class: "opex",
        valueBasis: "cash",
        amount: "40",
        currency: "SAR",
      }),
    ];
    const t = computeTotals({ businessCaseId: T, includedCaseIds: [T], transformationCaseId: T, lines });
    expect(t.grossBenefits.map((g) => [g.currency, g.amount])).toEqual([
      ["SAR", "100"],
      ["USD", "10"],
    ]);
    expect(t.netValue.map((g) => [g.currency, g.amount])).toEqual([
      ["SAR", "60"],
      ["USD", null],
    ]);
  });
});

describe("possible duplicate warning (transformation line vs initiative line)", () => {
  it("same class, same normalised title and overlapping period -> warning; otherwise none", () => {
    const top = line({
      businessCaseId: T,
      title: "  PMO   Office ",
      lineKind: "investment",
      class: "opex",
      valueBasis: "cash",
      amount: "10",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    const dup = { ...top, id: "00000000-0000-7000-8000-00000000ffff", businessCaseId: I1, title: "pmo office" };
    const other = { ...dup, id: "00000000-0000-7000-8000-00000000fffe", periodStart: "2027-01-01", periodEnd: null };
    const warn = computeTotals({
      businessCaseId: T,
      includedCaseIds: [T, I1],
      transformationCaseId: T,
      lines: [top, dup],
    });
    expect(warn.warnings.map((w) => w.code)).toEqual(["business_case.possible_duplicate"]);
    // Both lines still count: it is a warning for Finance, not a silent removal.
    expect(warn.implementationCost[0]!.amount).toBe("20");
    const none = computeTotals({
      businessCaseId: T,
      includedCaseIds: [T, I1],
      transformationCaseId: T,
      lines: [top, other],
    });
    expect(none.warnings).toEqual([]);
  });

  it("helpers: title normalisation and open period bounds", () => {
    expect(normaliseTitle("ＰＭＯ\tOffice")).toBe("pmo office");
    expect(periodsOverlap({ periodStart: null, periodEnd: null }, { periodStart: "2026-01-01", periodEnd: null })).toBe(
      true,
    );
    expect(
      periodsOverlap(
        { periodStart: "2026-01-01", periodEnd: "2026-03-31" },
        { periodStart: "2026-04-01", periodEnd: "2026-06-30" },
      ),
    ).toBe(false);
  });
});
