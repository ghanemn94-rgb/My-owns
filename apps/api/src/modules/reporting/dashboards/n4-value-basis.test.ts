// T-DG4-KBE-R7 (F-DG4-126, F-DG4-127, D-122, D-123; ADR-0037 and ADR-0030 amendment N4): worked fixtures for the
// Value status per basis and currency (never summed across bases, the Value RAG the worst of them) and the Portfolio
// initiative value on the profit-and-cash basis (a missing planned amount is Unknown, never omitted). Pure: no I/O.
// All data is SYNTHETIC.
import { DASHBOARD_RAG_DEFAULTS, type RagStatus } from "@mth/shared/schemas";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import { describe, expect, it } from "vitest";
import {
  basisClasses,
  comparePortfolio,
  gapValue,
  valueArea,
  valueGapStatus,
  valueLinesOf,
  VALUE_BASES,
  type DashboardClock,
  type InitiativeFact,
  type ValueBenefitFact,
  type ValueLineFact,
} from "./areas.ts";
import { combine } from "./combine.ts";
import {
  initiativePlannedValues,
  initiativeValue,
  NO_PROFIT_AND_CASH_ALLOCATION,
  type AllocationFact,
} from "./engine.ts";

const POLICY = { ...DASHBOARD_RAG_DEFAULTS };
const CLOCK: DashboardClock = {
  businessDate: "2026-10-11",
  asOf: "2026-10-11",
  windowStart: null,
  windowEnd: null,
  calendar: null,
};
let seq = 0;
const id = () => `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, "0")}`;

function benefit(valueClass: string, extra: Partial<ValueBenefitFact> = {}): ValueBenefitFact {
  return {
    benefitId: id(),
    transformationId: "t",
    code: `B-${seq}`,
    title: "Synthetic benefit",
    ownerUserId: null,
    valueClass,
    currency: "SAR",
    counted: true,
    overlapOpen: false,
    unmonetised: false,
    ...extra,
  };
}
/** A line of the reviewers' worlds: planned periods 2026-01..06, so every planned line is due at the as-of date. */
function line(b: ValueBenefitFact, state: string, amount: string | null, periodEnd = "2026-06-30"): ValueLineFact {
  return {
    benefitId: b.benefitId,
    transformationId: b.transformationId,
    state,
    amount,
    currency: b.currency,
    periodStart: "2026-01-01",
    periodEnd,
    recordTable: state === "planned" || state === "forecast" ? "benefit_plan_value" : "benefit_measurement",
    recordId: id(),
  };
}
const gap = (currency: string, headlineBasis: string, gapRatio: string | null, status: RagStatus) => ({
  currency,
  headlineBasis,
  gapRatio,
  status,
  reasonKey: null,
});

describe("F-DG4-126: a validated-gap ratio per basis and currency; the Value RAG is the worst of them (N4 item 1)", () => {
  for (const [other, basis] of [
    ["revenue_uplift", "top_line"],
    ["avoided_cost", "non_cash"],
  ] as const)
    it(`R3-6 (${other}): margin 70 validated 70 beside ${other} 300 unvalidated -> red, never green`, () => {
      const m = benefit("margin_uplift");
      const o = benefit(other);
      const r = valueArea(
        [m, o],
        [line(m, "planned", "70"), line(m, "validated", "70", "2026-02-28"), line(o, "planned", "300")],
        CLOCK,
        POLICY,
      );
      // The profit-and-cash headline amounts and gap are unchanged (N3): 70, 70, gap 0, green.
      const c = r.currencies[0]!;
      expect([c.planned.value, c.validated.value, c.gapRatio, c.status]).toEqual(["70", "70", "0", "green"]);
      expect(r.rag).toEqual({
        status: "red",
        ruleKey: "dashboard.rag.value.validated_gap",
        ruleParams: {
          amberRatio: "0.05",
          redRatio: "0.15",
          lines: [gap("SAR", "profit_and_cash", "0", "green"), gap("SAR", basis, "1", "red")],
        },
      });
    });

  it("probe GC: SAR margin 70 and USD revenue uplift 11, nothing validated -> SAR p&c red, USD top line red; USD p&c n/a", () => {
    const m = benefit("margin_uplift");
    const u = benefit("revenue_uplift", { currency: "USD" });
    const r = valueArea([m, u], [line(m, "planned", "70"), line(u, "planned", "11")], CLOCK, POLICY);
    expect(r.rag.status).toBe("red");
    expect(r.rag.ruleParams["lines"]).toEqual([
      gap("SAR", "profit_and_cash", "1", "red"),
      gap("USD", "top_line", "1", "red"),
    ]);
    const usd = r.currencies.find((c) => c.currency === "USD")!;
    expect(usd.planned).toEqual({
      state: "not_applicable",
      value: null,
      unit: "currency",
      currency: "USD",
      reasonKey: "dashboard.value.no_profit_and_cash_benefit",
    });
    expect(usd.topLineGap).toEqual({ gapRatio: "1", status: "red", reasonKey: null });
    expect(usd.nonCashGap).toBeNull();
  });

  it("revenue only (300, nothing validated): red with the top-line line (was n/a no_profit_and_cash_benefit; D-123 item 1)", () => {
    const rev = benefit("revenue_uplift");
    const r = valueArea([rev], [line(rev, "planned", "300")], CLOCK, POLICY);
    expect(r.rag.status).toBe("red");
    expect(r.rag.ruleKey).toBe("dashboard.rag.value.validated_gap");
    expect(r.rag.ruleParams["lines"]).toEqual([gap("SAR", "top_line", "1", "red")]);
    expect(JSON.stringify(r)).not.toContain("dashboard.rag.value.no_profit_and_cash_benefit");
    expect(r.currencies[0]!.reasonKey).toBe("dashboard.value.no_profit_and_cash_benefit");
  });

  it("each basis is assessed on its own: a fully validated top line never hides a profit-and-cash gap, or the reverse", () => {
    const m = benefit("margin_uplift");
    const rev = benefit("revenue_uplift");
    const r = valueArea(
      [m, rev],
      [
        line(m, "planned", "100"),
        line(m, "validated", "90", "2026-02-28"),
        line(rev, "planned", "1000"),
        line(rev, "validated", "1000", "2026-02-28"),
      ],
      CLOCK,
      POLICY,
    );
    // A summed ratio would be (1100 - 1090) / 1100 = 0.009 (green). The profit-and-cash gap alone is 0.1 (amber).
    expect(r.rag.status).toBe("amber");
    expect(r.rag.ruleParams["lines"]).toEqual([
      gap("SAR", "profit_and_cash", "0.1", "amber"),
      gap("SAR", "top_line", "0", "green"),
    ]);
  });

  it("an unknown amount on one basis is an unknown line; a not_applicable line takes no part; none left -> nothing_due", () => {
    const m = benefit("margin_uplift");
    const a = benefit("avoided_cost");
    const unknown = valueArea(
      [m, a],
      [line(m, "planned", "10"), line(m, "validated", "10", "2026-02-28"), line(a, "planned", null)],
      CLOCK,
      POLICY,
    );
    expect(unknown.rag.status).toBe("unknown");
    expect(unknown.rag.ruleParams["lines"]).toEqual([
      gap("SAR", "profit_and_cash", "0", "green"),
      {
        currency: "SAR",
        headlineBasis: "non_cash",
        gapRatio: null,
        status: "unknown",
        reasonKey: "benefit.value_amount_missing",
      },
    ]);
    // Nothing due on any basis (planned periods after the as-of date): every line n/a -> the area n/a, never green.
    const later = valueArea(
      [m, a],
      [line(m, "planned", "10", "2027-06-30"), line(a, "planned", "5", "2027-06-30")],
      CLOCK,
      POLICY,
    );
    expect(later.rag).toEqual({ status: "not_applicable", ruleKey: "dashboard.rag.value.nothing_due", ruleParams: {} });
    expect(later.currencies[0]!.nonCashGap).toEqual({
      gapRatio: null,
      status: "not_applicable",
      reasonKey: "dashboard.value.nothing_planned",
    });
  });

  it("gapValue: known ratio, unknown, n/a with the currency (basis absent), n/a without (nothing planned)", () => {
    expect(gapValue({ gapRatio: "0.25", status: "red", reasonKey: null }, "SAR")).toEqual({
      state: "value",
      value: "0.25",
      unit: "ratio",
      currency: "SAR",
      reasonKey: null,
    });
    expect(gapValue({ gapRatio: "0", status: "green", reasonKey: null }, "USD").state).toBe("zero");
    expect(gapValue({ gapRatio: null, status: "unknown", reasonKey: "benefit.value_amount_missing" }, "SAR")).toEqual({
      state: "unknown",
      value: null,
      unit: "ratio",
      currency: "SAR",
      reasonKey: "benefit.value_amount_missing",
    });
    expect(
      gapValue(
        { gapRatio: null, status: "not_applicable", reasonKey: "dashboard.value.no_profit_and_cash_benefit" },
        "USD",
      ),
    ).toMatchObject({ state: "not_applicable", currency: "USD" });
    expect(
      gapValue({ gapRatio: null, status: "not_applicable", reasonKey: "dashboard.value.nothing_planned" }, "SAR"),
    ).toEqual({
      state: "not_applicable",
      value: null,
      unit: "ratio",
      currency: null,
      reasonKey: "dashboard.value.nothing_planned",
    });
  });

  it("property: the RAG is combine(every basis line), each line is its own basis's exact gap, never a cross-basis sum (500 seeded sets)", () => {
    let s = 20261011;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const classes = ["revenue_uplift", "margin_uplift", "cash_saving", "avoided_cost", "working_capital_release"];
    for (let n = 0; n < 500; n += 1) {
      const benefits = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () =>
        benefit(classes.at(Math.floor(rnd() * classes.length))!, {
          currency: rnd() < 0.6 ? "SAR" : "USD",
          counted: rnd() < 0.9,
        }),
      );
      const lines = benefits.flatMap((b) =>
        Array.from({ length: Math.floor(rnd() * 4) }, () =>
          line(
            b,
            rnd() < 0.5 ? "planned" : "validated",
            rnd() < 0.05 ? null : String(Math.floor(rnd() * 1000)),
            rnd() < 0.8 ? "2026-03-31" : "2027-03-31",
          ),
        ),
      );
      const byId = new Map(benefits.map((b) => [b.benefitId, b]));
      const r = valueArea(benefits, lines, CLOCK, POLICY);
      const expected: { currency: string; headlineBasis: string; status: RagStatus; gapRatio: string | null }[] = [];
      for (const c of r.currencies)
        for (const basis of VALUE_BASES) {
          const present = benefits.some(
            (b) => b.counted && b.currency === c.currency && basisClasses(basis).includes(b.valueClass),
          );
          if (!present) continue;
          const sum = (state: "planned" | "validated") => {
            const ls = valueLinesOf(byId, lines, state, CLOCK, basisClasses(basis)).filter(
              (l) => byId.get(l.benefitId)!.currency === c.currency,
            );
            if (ls.some((l) => l.amount === null))
              return { state: "unknown" as const, value: null, unit: "currency", currency: c.currency, reasonKey: "x" };
            const v = ls.reduce((acc, l) => acc.plus(new D(l.amount!)), new D(0));
            return {
              state: v.isZero() ? ("zero" as const) : ("value" as const),
              value: v.toFixed(),
              unit: "currency",
              currency: c.currency,
              reasonKey: null,
            };
          };
          const g = valueGapStatus(sum("planned"), sum("validated"), POLICY);
          expected.push({ currency: c.currency, headlineBasis: basis, status: g.status, gapRatio: g.gapRatio });
        }
      const got = (r.rag.ruleParams["lines"] ?? []) as {
        currency: string;
        headlineBasis: string;
        status: RagStatus;
        gapRatio: string | null;
      }[];
      const status = combine(expected.map((e) => e.status));
      expect(r.rag.status, `set ${n}`).toBe(status ?? "not_applicable");
      if (status !== null)
        expect(
          got.map(({ currency, headlineBasis, status: st, gapRatio }) => ({
            currency,
            headlineBasis,
            status: st,
            gapRatio,
          })),
          `set ${n}`,
        ).toEqual(expected);
      // Never green while a basis line is red, amber or unknown.
      if (expected.some((e) => e.status === "red" || e.status === "amber" || e.status === "unknown"))
        expect(r.rag.status, `set ${n}`).not.toBe("green");
    }
  });
});

describe("F-DG4-127: the Portfolio initiative value on the profit-and-cash basis (N4 item 2; D-123 item 3)", () => {
  const SAR = new Map([["t", "SAR"]]);
  const alloc = (b: ValueBenefitFact, initiativeId: string, share = "1"): AllocationFact => ({
    benefitId: b.benefitId,
    initiativeId,
    share,
  });

  it("R3-8 DOM-GROSS allocated 100 % to INI-0017: 90 (margin 70 + cash 20), never 435", () => {
    const amounts: [string, string][] = [
      ["revenue_uplift", "300"],
      ["margin_uplift", "70"],
      ["cash_saving", "20"],
      ["avoided_cost", "45"],
    ];
    const bs = amounts.map(([c]) => benefit(c));
    const v = initiativePlannedValues(
      bs,
      bs.map((b, i) => line(b, "planned", amounts.at(i)![1])),
      bs.map((b) => alloc(b, "INI-0017")),
      SAR,
    );
    expect(v.get("INI-0017")).toEqual({ plannedAllocated: "90", valueReasonKey: null });
  });

  it("the ranking world: INI-B (margin 70) first; INI-A (revenue only) n/a; INI-C (nothing) unknown; both after, by code", () => {
    const rev = benefit("revenue_uplift");
    const mar = benefit("margin_uplift");
    const v = initiativePlannedValues(
      [rev, mar],
      [line(rev, "planned", "300"), line(mar, "planned", "70")],
      [alloc(rev, "A"), alloc(mar, "B")],
      SAR,
    );
    expect(v.get("A")).toEqual({ plannedAllocated: null, valueReasonKey: NO_PROFIT_AND_CASH_ALLOCATION });
    expect(v.get("B")).toEqual({ plannedAllocated: "70", valueReasonKey: null });
    expect(v.has("C")).toBe(false);
    const fact = (initiativeId: string): InitiativeFact => ({
      initiativeId,
      transformationId: "t",
      code: `INI-${initiativeId}`,
      name: "Synthetic initiative",
      status: "completed",
      executiveOwnerUserId: null,
      workstreamLeadUserId: null,
      ...(v.get(initiativeId) ?? { plannedAllocated: null, valueReasonKey: "dashboard.portfolio.no_allocated_value" }),
      plannedCurrency: "SAR",
      milestones: [],
      outcomeIds: [],
    });
    const facts = ["A", "B", "C"].map(fact);
    expect([...facts].sort(comparePortfolio).map((f) => f.code)).toEqual(["INI-B", "INI-A", "INI-C"]);
    expect(facts.map(initiativeValue)).toEqual([
      {
        state: "not_applicable",
        value: null,
        unit: "currency",
        currency: "SAR",
        reasonKey: "dashboard.portfolio.no_profit_and_cash_allocation",
      },
      { state: "value", value: "70", unit: "currency", currency: "SAR", reasonKey: null },
      {
        state: "unknown",
        value: null,
        unit: "currency",
        currency: "SAR",
        reasonKey: "dashboard.portfolio.no_allocated_value",
      },
    ]);
  });

  it("D-123 item 3: a profit-and-cash planned line with no amount makes the initiative unknown, never a sum that omits it", () => {
    const mar = benefit("margin_uplift");
    const cash = benefit("cash_saving");
    const v = initiativePlannedValues(
      [mar, cash],
      [line(mar, "planned", "70"), line(cash, "planned", "20"), line(cash, "planned", null, "2026-03-31")],
      [alloc(mar, "X"), alloc(cash, "X"), alloc(mar, "Y")],
      SAR,
    );
    // As built (before T-DG4-KBE-R7) X was 90 (the null line skipped) and treated as known.
    expect(v.get("X")).toEqual({ plannedAllocated: null, valueReasonKey: "benefit.value_amount_missing" });
    expect(v.get("Y")).toEqual({ plannedAllocated: "70", valueReasonKey: null });
    const x = initiativeValue({
      initiativeId: "X",
      transformationId: "t",
      code: "INI-X",
      name: "Synthetic initiative",
      status: "launched",
      executiveOwnerUserId: null,
      workstreamLeadUserId: null,
      ...v.get("X")!,
      plannedCurrency: "SAR",
      milestones: [],
      outcomeIds: [],
    });
    expect(x).toEqual({
      state: "unknown",
      value: null,
      unit: "currency",
      currency: "SAR",
      reasonKey: "benefit.value_amount_missing",
    });
    // A missing amount on a top-line benefit is not a profit-and-cash amount: it changes nothing here.
    const rev = benefit("revenue_uplift");
    const w = initiativePlannedValues(
      [mar, rev],
      [line(mar, "planned", "70"), line(rev, "planned", null)],
      [alloc(mar, "Z"), alloc(rev, "Z")],
      SAR,
    );
    expect(w.get("Z")).toEqual({ plannedAllocated: "70", valueReasonKey: null });
  });

  it("shares, money scale and the other rules of the sum are unchanged: not counted, unmonetised, other currency left out", () => {
    const mar = benefit("margin_uplift");
    const wc = benefit("working_capital_release");
    const notCounted = benefit("cash_saving", { counted: false });
    const usd = benefit("cash_saving", { currency: "USD" });
    const v = initiativePlannedValues(
      [mar, wc, notCounted, usd],
      [
        line(mar, "planned", "100.00005"),
        line(wc, "planned", "10"),
        line(notCounted, "planned", "999"),
        line(usd, "planned", "999"),
        line(mar, "validated", "5000"),
      ],
      [alloc(mar, "I", "0.333333"), alloc(wc, "I", "0.5"), alloc(notCounted, "I"), alloc(usd, "I")],
      SAR,
    );
    // 100.00005 × 0.333333 = 33.33331666665 -> 33.3333 (half-even at 4 places); + 10 × 0.5 = 38.3333.
    expect(v.get("I")).toEqual({ plannedAllocated: "38.3333", valueReasonKey: null });
  });
});
