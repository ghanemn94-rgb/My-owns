// Unit tests of the ADR-0037 amendment K1 selection rule (T-DG4-KBE-R4), the rule shared by the Finance class lines
// and the value-state drill-downs (`lineEntersClassSum`, `benefitInClass` in finance.ts):
//  - K1 item 6 / byte stability: without a value class the rule is EXACTLY the as-built rule of the four original value
//    metrics (`valueLinesOf`: lineEligible + lineInWindow), over an exhaustive grid of benefit facts, states and windows;
//  - K1 item 3: a class narrows to the benefits of that Finance class; `non_financial_valued` selects valued
//    non-financial benefits only; an unmonetised or not-counted benefit is never selected; an open overlap holds back
//    validated and sustained lines (and only those);
//  - K1 item 4, pure half: over a worked fixture (two financial classes in SAR, a second currency, an overlap-held
//    benefit, a valued non-financial benefit, an Unknown amount, out-of-window lines and all seven states), the per-
//    benefit sums of the selected lines of every class line equal the line's total in its currency, or both are
//    Unknown. The HTTP half (the real drill-down over every page) is apps/api/test/integration/reporting/
//    finance-drilldown-k1.test.ts.
// Decimal only: every figure is a decimal string. All data is synthetic.
import { FINANCE_LINE_STATES } from "@mth/shared/schemas";
import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  FINANCIAL_VALUE_CLASSES,
  sumValue,
  valueLinesOf,
  VALUE_HEADLINE_STATES,
  type DashboardClock,
  type ValueBenefitFact,
  type ValueLineFact,
} from "./areas.ts";
import { benefitInClass, financeClassLines, lineEntersClassSum } from "./finance.ts";

const clock: DashboardClock = {
  businessDate: "2026-10-10",
  asOf: "2026-10-10",
  windowStart: null,
  windowEnd: null,
  calendar: null,
};
const windowed: DashboardClock = { ...clock, asOf: "2026-06-30", windowStart: "2026-04-01", windowEnd: "2026-06-30" };

const benefit = (over: Partial<ValueBenefitFact> & Pick<ValueBenefitFact, "benefitId">): ValueBenefitFact => ({
  transformationId: "t",
  code: over.benefitId.toUpperCase(),
  title: "Synthetic",
  ownerUserId: null,
  valueClass: "revenue_uplift",
  currency: "SAR",
  counted: true,
  overlapOpen: false,
  unmonetised: false,
  ...over,
});

let seq = 0;
const line = (
  benefitId: string,
  state: string,
  amount: string | null,
  periodEnd: string | null = "2026-02-28",
  currency = "SAR",
): ValueLineFact => ({
  benefitId,
  transformationId: "t",
  state,
  amount,
  currency,
  periodStart: periodEnd === null ? null : `${periodEnd.slice(0, 8)}01`,
  periodEnd,
  recordTable: state === "planned" || state === "forecast" ? "benefit_plan_value" : "benefit_measurement",
  recordId: `r${String((seq += 1)).padStart(4, "0")}`,
});

describe("K1 item 6: without a value class the rule is the as-built rule of the four value metrics", () => {
  it("equals valueLinesOf over every benefit fact × state × window (exhaustive grid)", () => {
    const classes = [...FINANCIAL_VALUE_CLASSES, "non_financial", "something_else"];
    const benefits: ValueBenefitFact[] = [];
    for (const valueClass of classes)
      for (const counted of [true, false])
        for (const unmonetised of [true, false])
          for (const overlapOpen of [true, false])
            benefits.push(
              benefit({
                benefitId: `b${benefits.length}`,
                valueClass,
                counted,
                unmonetised,
                overlapOpen,
                currency: benefits.length % 2 === 0 ? "SAR" : "USD",
              }),
            );
    const ends = [null, "2026-01-31", "2026-05-31", "2026-06-30", "2026-07-31", "2026-12-31"];
    const lines = benefits.flatMap((b) =>
      ["planned", "forecast", "submitted", "validated", "measured", "rejected", "sustained"].flatMap((state) =>
        ends.map((end) => line(b.benefitId, state, "1", end, b.currency)),
      ),
    );
    const byId = new Map(benefits.map((b) => [b.benefitId, b]));
    let compared = 0;
    for (const c of [clock, windowed])
      for (const state of VALUE_HEADLINE_STATES) {
        const asBuilt = valueLinesOf(byId, lines, state, c).map((l) => l.recordId);
        const k1 = lines
          .filter((l) => lineEntersClassSum(byId.get(l.benefitId), l, state, null, c))
          .map((l) => l.recordId);
        expect(k1, `${state} ${c.windowStart ?? "no window"}`).toEqual(asBuilt);
        compared += lines.length;
      }
    // 7 classes × 8 fact combinations × 7 states × 6 period ends, checked for 4 states under 2 clocks.
    expect(compared).toBe(benefits.length * 7 * ends.length * 4 * 2);
    expect(benefits).toHaveLength(56);
  });
});

describe("K1 item 3: which benefits and lines a class selects", () => {
  const rev = benefit({ benefitId: "rev" });
  const cx = benefit({ benefitId: "cx", valueClass: "non_financial" });
  const cxNa = benefit({ benefitId: "cxna", valueClass: "non_financial", unmonetised: true });
  const notCounted = benefit({ benefitId: "nc", counted: false });
  const held = benefit({ benefitId: "held", valueClass: "avoided_cost", overlapOpen: true });

  it("a class selects its own Finance class only; null selects the five financial classes", () => {
    expect([
      benefitInClass(rev, "revenue_uplift"),
      benefitInClass(rev, "margin_uplift"),
      benefitInClass(rev, null),
    ]).toEqual([true, false, true]);
    expect([benefitInClass(cx, "non_financial_valued"), benefitInClass(cx, null)]).toEqual([true, false]);
    // Unmonetised (no approved valuation method) or not counted: in no class, never a 0 contribution.
    for (const c of [null, "non_financial_valued", "revenue_uplift"]) {
      expect(benefitInClass(cxNa, c), String(c)).toBe(false);
      expect(benefitInClass(notCounted, c), String(c)).toBe(false);
    }
    // An overlap-held benefit is still in its class (its class line exists; only some of its lines are held back).
    expect(benefitInClass(held, "avoided_cost")).toBe(true);
  });

  it("an open overlap holds back validated and sustained lines only", () => {
    const pick = (state: string) => lineEntersClassSum(held, line("held", state, "5"), state, "avoided_cost", clock);
    expect(FINANCE_LINE_STATES.map((s) => [s, pick(s)])).toEqual([
      ["planned", true],
      ["forecast", true],
      ["measured", true],
      ["submitted", true],
      ["validated", false],
      ["rejected", true],
      ["sustained", false],
    ]);
  });

  it("a line of another state, or outside the window, is not selected", () => {
    expect(lineEntersClassSum(rev, line("rev", "planned", "5"), "validated", "revenue_uplift", clock)).toBe(false);
    expect(lineEntersClassSum(rev, line("rev", "planned", "5", "2027-01-31"), "planned", "revenue_uplift", clock)).toBe(
      false,
    );
    expect(lineEntersClassSum(rev, line("rev", "planned", "5", null), "planned", "revenue_uplift", clock)).toBe(false);
    expect(lineEntersClassSum(undefined, line("x", "planned", "5"), "planned", null, clock)).toBe(false);
  });
});

describe("K1 item 4 (pure half): every class line equals the sum of the records its drill-down selects", () => {
  // Worked fixture (all synthetic):
  //  SAR revenue_uplift  A: planned 1000 + 500, forecast 300, measured 900, validated 900, submitted 250, rejected 40,
  //                         sustained 120, planned 9999 in 2027 (after the as-of date: never to date)
  //  SAR revenue_uplift  A2: planned 0.1, validated 0.2 (a second benefit of the same class: two items, one line)
  //  SAR margin_uplift   B: planned 70.05, validated 30.0001, rejected 10
  //  SAR avoided_cost    D (open overlap): planned 400, validated 350 and sustained 60 HELD BACK, submitted 35
  //  SAR cash_saving     H: submitted with NO amount (Unknown, never 0), planned 5
  //  SAR non_financial   E (approved valuation method): planned 125000, measured 110000, validated 100000
  //  SAR non_financial   F (no approved method): planned 777 -> in no line
  //  USD revenue_uplift  U: planned 2000, validated 1500, sustained 75
  //  not counted         N: planned 888 -> in no line
  const benefits = [
    benefit({ benefitId: "a" }),
    benefit({ benefitId: "a2" }),
    benefit({ benefitId: "b", valueClass: "margin_uplift" }),
    benefit({ benefitId: "d", valueClass: "avoided_cost", overlapOpen: true }),
    benefit({ benefitId: "h", valueClass: "cash_saving" }),
    benefit({ benefitId: "e", valueClass: "non_financial" }),
    benefit({ benefitId: "f", valueClass: "non_financial", unmonetised: true }),
    benefit({ benefitId: "u", currency: "USD" }),
    benefit({ benefitId: "n", counted: false }),
  ];
  const lines = [
    line("a", "planned", "1000"),
    line("a", "planned", "500", "2026-03-31"),
    line("a", "forecast", "300", "2026-11-30"),
    line("a", "measured", "900"),
    line("a", "validated", "900"),
    line("a", "submitted", "250", "2026-03-31"),
    line("a", "rejected", "40"),
    line("a", "sustained", "120", "2026-08-31"),
    line("a", "planned", "9999", "2027-01-31"),
    line("a2", "planned", "0.1"),
    line("a2", "validated", "0.2"),
    line("b", "planned", "70.05"),
    line("b", "validated", "30.0001"),
    line("b", "rejected", "10"),
    line("d", "planned", "400"),
    line("d", "validated", "350"),
    line("d", "sustained", "60"),
    line("d", "submitted", "35"),
    line("h", "submitted", null),
    line("h", "planned", "5"),
    line("e", "planned", "125000"),
    line("e", "measured", "110000"),
    line("e", "validated", "100000"),
    line("f", "planned", "777"),
    line("u", "planned", "2000", "2026-02-28", "USD"),
    line("u", "validated", "1500", "2026-02-28", "USD"),
    line("u", "sustained", "75", "2026-02-28", "USD"),
    line("n", "planned", "888"),
  ];
  const byId = new Map(benefits.map((b) => [b.benefitId, b]));
  const classLines = financeClassLines(benefits, lines, clock);

  /** The drill-down's items for (state, class): one per benefit, its selected lines summed (as drilldown.ts does). */
  const drillItems = (state: string, valueClass: string) => {
    const selected = lines.filter((l) => lineEntersClassSum(byId.get(l.benefitId), l, state, valueClass, clock));
    return [...new Set(selected.map((l) => l.benefitId))].map((id) =>
      sumValue(
        selected.filter((l) => l.benefitId === id).map((l) => l.amount),
        byId.get(id)!.currency,
        "currency",
        "benefit.value_amount_missing",
      ),
    );
  };
  /** The invariant's left-hand side (drilldown.ts sumItems): null when an item of the currency is Unknown. */
  const sumIn = (items: ReturnType<typeof drillItems>, currency: string) => {
    let acc = new Decimal(0);
    for (const i of items) {
      if (i.currency !== currency) continue;
      if (i.value === null) return null;
      acc = acc.plus(new Decimal(i.value));
    }
    return acc.toFixed();
  };

  it("the fixture has what K1 item 4 requires", () => {
    const sar = new Set(classLines.filter((l) => l.currency === "SAR").map((l) => l.valueClass));
    expect([...sar].filter((c) => FINANCIAL_VALUE_CLASSES.includes(c)).length).toBeGreaterThanOrEqual(2);
    expect([...new Set(classLines.map((l) => l.currency))]).toEqual(["SAR", "USD"]);
    expect(sar.has("non_financial_valued")).toBe(true);
    expect(benefits.some((b) => b.overlapOpen)).toBe(true);
    // 5 SAR classes (revenue, margin, avoided cost, cash saving, valued non-financial) + 1 USD class, 7 states each.
    expect(classLines).toHaveLength((5 + 1) * 7);
  });

  it("each of the 42 class lines: the decimal sum of its drill-down items equals its total, or both are Unknown", () => {
    for (const l of classLines) {
      const items = drillItems(l.state, l.valueClass);
      const got = sumIn(items, l.currency);
      const label = `${l.valueClass} ${l.state} ${l.currency}`;
      if (l.total.state === "unknown") expect(got, label).toBeNull();
      else expect(got === null ? null : new Decimal(got).toFixed(), label).toBe(new Decimal(l.total.value!).toFixed());
      // A drill-down never shows a record of another currency for the class line.
      expect(
        items.every((i) => i.currency === l.currency) || classLines.some((x) => x.currency !== l.currency),
        label,
      ).toBe(true);
    }
  });

  it("worked figures: overlap hold-back, Unknown amount, valued non-financial, out-of-window plan", () => {
    const t = (valueClass: string, state: string, currency = "SAR") =>
      classLines.find((x) => x.valueClass === valueClass && x.state === state && x.currency === currency)!.total;
    expect([t("revenue_uplift", "planned").value, t("revenue_uplift", "validated").value]).toEqual(["1500.1", "900.2"]);
    expect(t("margin_uplift", "validated").value).toBe("30.0001");
    // Overlap-held: validated and sustained are known zeros (held back), submitted still shows.
    expect([t("avoided_cost", "validated").state, t("avoided_cost", "sustained").state]).toEqual(["zero", "zero"]);
    expect(t("avoided_cost", "submitted").value).toBe("35");
    expect(drillItems("validated", "avoided_cost")).toEqual([]);
    // A missing amount makes the line and its drill-down Unknown, never 0.
    expect(t("cash_saving", "submitted")).toMatchObject({ state: "unknown", value: null });
    expect(sumIn(drillItems("submitted", "cash_saving"), "SAR")).toBeNull();
    expect(t("non_financial_valued", "measured").value).toBe("110000");
    expect([t("revenue_uplift", "sustained", "USD").value, t("revenue_uplift", "sustained").value]).toEqual([
      "75",
      "120",
    ]);
    // An empty state of an eligible class is a known zero with no items (not a fabricated figure).
    expect([t("margin_uplift", "sustained").state, drillItems("sustained", "margin_uplift")]).toEqual(["zero", []]);
  });
});
