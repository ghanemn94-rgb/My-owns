// Unit tests of the T10 area engine (T-DG4-KBE-G; ADR-0037 §3, §5; REQ-PB-063, REQ-PB-064, REQ-S13-003) with worked
// fixtures and seeded property tests (a deterministic PRNG; no new dependency):
//  - the precedence red > amber > unknown/not_computable > stale > green; Unknown and Stale never combine to green;
//  - an outcome reads only its KPIs' statuses (never task completion); a KPI with no actual is unknown;
//  - Value: gap ratio with decimal arithmetic; planned 0 -> n/a; unknown amounts -> unknown; currencies never added;
//    the decimal sum of the per-benefit drill items equals the headline (the drill-down invariant);
//  - Value on the profit-and-cash basis (ADR-0037 amendment N3; F-DG4-123, D-119): the DOM-GROSS world and ARCH-R5's
//    variants A-C, top line and non-cash kept apart, and the per-basis drill invariant per currency;
//  - Portfolio milestone component, Dependencies, Decisions (ADR-0032 overdue rule) and the empty-set rules.
// All data is synthetic.
import { DASHBOARD_RAG_DEFAULTS, type RagStatus } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import {
  decisionOverdue,
  decisionsArea,
  dependenciesArea,
  dependencyStatus,
  kpiActualValue,
  lineInWindow,
  milestoneComponent,
  outcomesArea,
  outcomeStatus,
  portfolioArea,
  basisClasses,
  basisOfClass,
  sumValue,
  VALUE_BASES,
  valueArea,
  valueGapStatus,
  valueLinesOf,
  type DashboardClock,
  type DecisionFact,
  type DependencyFact,
  type InitiativeFact,
  type KpiStatusFact,
  type OutcomeFact,
  type ValueBenefitFact,
  type ValueLineFact,
} from "./areas.ts";
import { combine, combineOr, fromKpiRag, type InputStatus } from "./combine.ts";
import { mapDatabaseGuardError } from "../../platform/index.ts";
import { thresholdOrderViolation, effectiveValues, policySourceOf } from "./rag-policy.ts";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";

const POLICY = { ...DASHBOARD_RAG_DEFAULTS };
/** Sunday-Thursday workweek (ADR-0025 default), no holidays. */
const CAL = { workweek: [7, 1, 2, 3, 4], holidays: [] };
const CLOCK: DashboardClock = {
  businessDate: "2041-03-10",
  asOf: "2041-03-10",
  windowStart: null,
  windowEnd: null,
  calendar: CAL,
};

let seq = 0;
const id = () => `0192000a-0000-7000-8000-${String(++seq).padStart(12, "0")}`;

function kpi(
  rag: string,
  actual: string | null = "10",
  actualStatus = "ok",
  extra: Partial<KpiStatusFact> = {},
): KpiStatusFact {
  return {
    kpiDefinitionId: id(),
    kpiName: "Synthetic KPI",
    ownerUserId: null,
    displayedRag: rag,
    calculatedRag: rag,
    overridden: false,
    actual,
    actualStatus,
    actualReason: actual === null ? "kpi.no_accepted_actual" : null,
    unit: "count",
    currency: null,
    reportingPeriodId: id(),
    periodLabel: "2041-03",
    evaluationId: actual === null ? null : id(),
    calculationRunId: null,
    ...extra,
  };
}

function outcome(...rags: string[]): OutcomeFact {
  return {
    outcomeId: id(),
    transformationId: "t",
    statement: "Synthetic outcome",
    ownerUserId: null,
    kpis: rags.map((r) => ({ outcomeKpiId: id(), ownerUserId: null, status: kpi(r, r === "unknown" ? null : "1") })),
  };
}

/** Mulberry32: a deterministic PRNG for the property tests. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL: InputStatus[] = ["green", "amber", "red", "unknown", "stale", "not_applicable", "not_computable"];

describe("combine (ADR-0037 §3 precedence)", () => {
  it("red > amber > unknown/not_computable > stale > green; empty and all-n/a give null", () => {
    expect(combine(["green", "stale", "amber", "red"])).toBe("red");
    expect(combine(["green", "stale", "unknown", "amber"])).toBe("amber");
    expect(combine(["green", "stale", "unknown"])).toBe("unknown");
    expect(combine(["green", "not_computable"])).toBe("unknown");
    expect(combine(["green", "stale"])).toBe("stale");
    expect(combine(["green", "green"])).toBe("green");
    expect(combine([])).toBeNull();
    expect(combine(["not_applicable"])).toBeNull();
    expect(combineOr([], "unknown")).toBe("unknown");
    expect(fromKpiRag("not_computable")).toBe("unknown");
  });

  it("property: Unknown or Stale inputs never combine to green, and the result is one of the inputs' ranks (2000 seeded sets)", () => {
    const rnd = prng(20261009);
    for (let n = 0; n < 2000; n += 1) {
      const set = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => ALL.at(Math.floor(rnd() * ALL.length))!);
      const out = combine(set);
      if (set.some((s) => s === "unknown" || s === "stale" || s === "not_computable")) expect(out).not.toBe("green");
      if (set.includes("red")) expect(out).toBe("red");
      if (out === "green") expect(set.every((s) => s === "green" || s === "not_applicable")).toBe(true);
      if (out !== null) expect([...set.map((s) => (s === "not_computable" ? "unknown" : s))]).toContain(out);
      // Order independence.
      expect(combine([...set].reverse())).toBe(out);
    }
  });
});

describe("Outcomes (REQ-PB-063: trajectory, not activity completion)", () => {
  it("an outcome is the combination of its KPI statuses; no KPI -> unknown; empty area -> unknown", () => {
    expect(outcomeStatus(outcome("green", "amber"))).toBe("amber");
    expect(outcomeStatus(outcome("green", "red"))).toBe("red");
    expect(outcomeStatus(outcome())).toBe("unknown");
    expect(outcomeStatus(outcome("green", "unknown"))).toBe("unknown");
    expect(outcomesArea([]).rag).toEqual({ status: "unknown", ruleKey: "dashboard.rag.outcomes.none", ruleParams: {} });
  });

  it("a KPI below trajectory is red/amber whatever else is complete; a KPI with no actual is unknown, never 0", () => {
    // The OutcomeFact has no deliverable, milestone or task input at all: completion cannot reach the rule.
    const below = outcome("amber");
    expect(outcomesArea([below]).rag.status).toBe("amber");
    const none = kpi("unknown", null, "unknown");
    expect(kpiActualValue(none)).toEqual({
      state: "unknown",
      value: null,
      unit: "count",
      currency: null,
      reasonKey: "kpi.no_accepted_actual",
    });
    expect(kpiActualValue(kpi("stale", "7", "stale")).state).toBe("stale");
    expect(kpiActualValue(kpi("green", "0")).state).toBe("zero");
  });

  it("an override in force is the displayed status (slice A override; D-106 (b))", () => {
    const o: OutcomeFact = {
      ...outcome(),
      kpis: [
        {
          outcomeKpiId: id(),
          ownerUserId: null,
          status: kpi("green", "1", "ok", { calculatedRag: "red", overridden: true }),
        },
      ],
    };
    expect(outcomeStatus(o)).toBe("green");
    expect(outcomesArea([o]).outcomes[0]!.flags).toEqual(["override_in_force"]);
  });
});

// ------------------------------------------------------------------------------------------------ Value

function benefit(extra: Partial<ValueBenefitFact> = {}): ValueBenefitFact {
  return {
    benefitId: id(),
    transformationId: "t",
    code: "B-01",
    title: "Synthetic benefit",
    ownerUserId: null,
    // T-DG4-KBE-R6 (F-DG4-123): margin_uplift, a profit-and-cash class (ADR-0037 amendment N3), so the worked examples
    // below keep their values on the basis the Value headlines now use. It was revenue_uplift while every financial
    // class entered the headline; the N3 tests below cover the other classes.
    valueClass: "margin_uplift",
    currency: "SAR",
    counted: true,
    overlapOpen: false,
    unmonetised: false,
    ...extra,
  };
}

function line(b: ValueBenefitFact, state: string, amount: string | null, periodEnd = "2041-01-31"): ValueLineFact {
  return {
    benefitId: b.benefitId,
    transformationId: "t",
    state,
    amount,
    currency: b.currency,
    periodStart: periodEnd.slice(0, 8) + "01",
    periodEnd,
    recordTable: state === "planned" || state === "forecast" ? "benefit_plan_value" : "benefit_measurement",
    recordId: id(),
  };
}

describe("Value (validated benefit gap)", () => {
  it("worked example: planned 1,000,000.00 vs validated 900,000.00 -> gap 0.1 -> amber with the default 0.05/0.15", () => {
    const b = benefit();
    const r = valueArea([b], [line(b, "planned", "1000000.00"), line(b, "validated", "900000.00")], CLOCK, POLICY);
    expect(r.currencies[0]).toMatchObject({ currency: "SAR", gapRatio: "0.1", status: "amber" });
    expect(r.rag.ruleKey).toBe("dashboard.rag.value.validated_gap");
    // Configured thresholds change the status (policy).
    const strict = valueArea([b], [line(b, "planned", "1000000.00"), line(b, "validated", "900000.00")], CLOCK, {
      ...POLICY,
      valueGapRedRatio: "0.08",
    });
    expect(strict.rag.status).toBe("red");
  });

  it("planned 0 is not_applicable; nothing due is not_applicable; an unknown amount is unknown (never 0)", () => {
    expect(
      valueGapStatus(sumValue([], "SAR", "currency", "x"), sumValue([], "SAR", "currency", "x"), POLICY).status,
    ).toBe("not_applicable");
    expect(valueArea([], [], CLOCK, POLICY).rag).toEqual({
      status: "not_applicable",
      ruleKey: "dashboard.rag.value.nothing_due",
      ruleParams: {},
    });
    const b = benefit();
    const r = valueArea([b], [line(b, "planned", "100"), line(b, "validated", null)], CLOCK, POLICY);
    expect(r.currencies[0]!.validated).toMatchObject({
      state: "unknown",
      value: null,
      reasonKey: "benefit.value_amount_missing",
    });
    expect(r.rag.status).toBe("unknown");
  });

  it("forecast, submitted, non-financial, not-counted and overlap-held values are never counted as validated", () => {
    const fin = benefit();
    const nf = benefit({ valueClass: "non_financial", unmonetised: true });
    const shared = benefit({ counted: false });
    const overlap = benefit({ overlapOpen: true });
    const lines = [
      line(fin, "planned", "100"),
      line(fin, "forecast", "500"),
      line(fin, "submitted", "70"),
      line(fin, "validated", "20"),
      line(nf, "validated", null),
      line(shared, "validated", "999"),
      line(overlap, "planned", "50"),
      line(overlap, "validated", "50"),
    ];
    const r = valueArea([fin, nf, shared, overlap], lines, CLOCK, POLICY);
    expect(r.currencies).toHaveLength(1);
    expect(r.currencies[0]!.validated).toMatchObject({ state: "value", value: "20" });
    expect(r.currencies[0]!.planned).toMatchObject({ value: "150" });
    expect(r.currencies[0]!.submitted).toMatchObject({ value: "70" });
    expect(r.currencies[0]!.forecast).toMatchObject({ value: "500" });
  });

  it("a validated total of nothing is a known zero, distinct from unknown and n/a (ADR-0037 §5)", () => {
    const b = benefit();
    const r = valueArea([b], [line(b, "planned", "100")], CLOCK, POLICY);
    expect(r.currencies[0]!.validated).toEqual({
      state: "zero",
      value: "0",
      unit: "currency",
      currency: "SAR",
      reasonKey: null,
    });
    expect(r.rag.status).toBe("red"); // gap 1 > 0.15
  });

  it("currencies are separate lines, never added together", () => {
    const sar = benefit();
    const usd = benefit({ currency: "USD" });
    const r = valueArea([sar, usd], [line(sar, "planned", "10"), line(usd, "planned", "20")], CLOCK, POLICY);
    expect(r.currencies.map((c) => [c.currency, c.planned.value])).toEqual([
      ["SAR", "10"],
      ["USD", "20"],
    ]);
  });

  it("the period window: to-date lines inside [start, asOf]; forecast inside [start, end]", () => {
    const b = benefit();
    const q1: DashboardClock = { ...CLOCK, windowStart: "2041-01-01", windowEnd: "2041-03-31", asOf: "2041-03-10" };
    expect(lineInWindow(line(b, "validated", "1", "2041-02-28"), "validated", q1)).toBe(true);
    expect(lineInWindow(line(b, "validated", "1", "2040-12-31"), "validated", q1)).toBe(false);
    expect(lineInWindow(line(b, "validated", "1", "2041-03-31"), "validated", q1)).toBe(false);
    expect(lineInWindow(line(b, "forecast", "1", "2041-03-31"), "forecast", q1)).toBe(true);
    expect(lineInWindow(line(b, "forecast", "1", "2041-04-30"), "forecast", q1)).toBe(false);
  });

  it("property: the per-benefit decimal sums equal the headline per currency (the drill-down invariant; 300 seeded sets)", () => {
    const rnd = prng(42);
    const amount = () => `${Math.floor(rnd() * 1e9)}.${String(Math.floor(rnd() * 1e4)).padStart(4, "0")}`;
    for (let n = 0; n < 300; n += 1) {
      const benefits = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () =>
        benefit({ currency: rnd() < 0.7 ? "SAR" : "USD", counted: rnd() < 0.9 }),
      );
      const lines = benefits.flatMap((b) =>
        Array.from({ length: Math.floor(rnd() * 4) }, () =>
          line(b, rnd() < 0.5 ? "planned" : "validated", amount(), `2041-0${1 + Math.floor(rnd() * 3)}-28`),
        ),
      );
      const byId = new Map(benefits.map((b) => [b.benefitId, b]));
      const r = valueArea(benefits, lines, CLOCK, POLICY);
      for (const c of r.currencies) {
        const contributing = valueLinesOf(byId, lines, "validated", CLOCK).filter(
          (l) => byId.get(l.benefitId)!.currency === c.currency,
        );
        const perBenefit = [...new Set(contributing.map((l) => l.benefitId))].map((bid) =>
          contributing.filter((l) => l.benefitId === bid).reduce((acc, l) => acc.plus(new D(l.amount!)), new D(0)),
        );
        const sum = perBenefit.reduce((acc, v) => acc.plus(v), new D(0));
        expect(new D(c.validated.value!).eq(sum)).toBe(true);
        expect(["value", "zero"]).toContain(c.validated.state);
      }
    }
  });
});

describe("Value on the profit-and-cash basis (ADR-0037 amendment N3; F-DG4-123, D-119)", () => {
  const cls = (valueClass: string, extra: Partial<ValueBenefitFact> = {}) => benefit({ valueClass, ...extra });
  const dom = () => {
    const rev = cls("revenue_uplift");
    const mar = cls("margin_uplift");
    const cash = cls("cash_saving");
    const avoided = cls("avoided_cost");
    return {
      benefits: [rev, mar, cash, avoided],
      lines: [
        line(rev, "planned", "300"),
        line(mar, "planned", "70"),
        line(cash, "planned", "20"),
        line(avoided, "planned", "45"),
      ],
    };
  };

  it("the bases: profit_and_cash = margin + cash saving + working capital; top_line = revenue; non_cash = avoided cost", () => {
    expect(VALUE_BASES).toEqual(["profit_and_cash", "top_line", "non_cash"]);
    expect(basisClasses("profit_and_cash")).toEqual(["margin_uplift", "cash_saving", "working_capital_release"]);
    expect(basisClasses("top_line")).toEqual(["revenue_uplift"]);
    expect(basisClasses("non_cash")).toEqual(["avoided_cost"]);
    expect(
      [
        "revenue_uplift",
        "margin_uplift",
        "cash_saving",
        "avoided_cost",
        "working_capital_release",
        "non_financial_valued",
      ].map(basisOfClass),
    ).toEqual(["top_line", "profit_and_cash", "profit_and_cash", "non_cash", "profit_and_cash", null]);
  });

  it("DOM-GROSS: planned 90 on profit and cash, 300 top line, 45 non-cash; validated a known zero; gap 1 -> red; never 435", () => {
    const { benefits, lines } = dom();
    const r = valueArea(benefits, lines, CLOCK, POLICY);
    expect(r.currencies).toHaveLength(1);
    const c = r.currencies[0]!;
    expect(c.planned).toEqual({ state: "value", value: "90", unit: "currency", currency: "SAR", reasonKey: null });
    expect(c.validated.state).toBe("zero");
    expect([c.forecast.state, c.submitted.state]).toEqual(["zero", "zero"]);
    expect(c.topLine!.planned.value).toBe("300");
    expect(c.nonCash!.planned.value).toBe("45");
    expect([c.topLine!.validated.state, c.nonCash!.validated.state]).toEqual(["zero", "zero"]);
    expect(c).toMatchObject({ gapRatio: "1", status: "red", reasonKey: null });
    expect(r.rag).toMatchObject({ status: "red", ruleKey: "dashboard.rag.value.validated_gap" });
    expect(r.rag.ruleParams["headlineBasis"]).toBe("profit_and_cash");
    expect(JSON.stringify(r)).not.toContain('"435"');
  });

  it("variant A: only revenue uplift and avoided cost -> profit-and-cash and the RAG are n/a (never 0, never green)", () => {
    const rev = cls("revenue_uplift");
    const avoided = cls("avoided_cost");
    const r = valueArea([rev, avoided], [line(rev, "planned", "300"), line(avoided, "planned", "45")], CLOCK, POLICY);
    const c = r.currencies[0]!;
    const na = {
      state: "not_applicable",
      value: null,
      unit: "currency",
      currency: "SAR",
      reasonKey: "dashboard.value.no_profit_and_cash_benefit",
    };
    for (const v of [c.planned, c.forecast, c.submitted, c.validated]) expect(v).toEqual(na);
    expect(c).toMatchObject({
      gapRatio: null,
      status: "not_applicable",
      reasonKey: "dashboard.value.no_profit_and_cash_benefit",
    });
    expect(c.topLine!.planned.value).toBe("300");
    expect(c.nonCash!.planned.value).toBe("45");
    expect(r.rag).toEqual({
      status: "not_applicable",
      ruleKey: "dashboard.rag.value.no_profit_and_cash_benefit",
      ruleParams: {},
    });
  });

  it("variant A per currency: one currency without a profit-and-cash benefit does not hide another's gap", () => {
    const sarRev = cls("revenue_uplift");
    const usdMar = cls("margin_uplift", { currency: "USD" });
    const r = valueArea(
      [sarRev, usdMar],
      [line(sarRev, "planned", "300"), line(usdMar, "planned", "10"), line(usdMar, "validated", "10")],
      CLOCK,
      POLICY,
    );
    expect(r.currencies.map((c) => [c.currency, c.status, c.reasonKey])).toEqual([
      ["SAR", "not_applicable", "dashboard.value.no_profit_and_cash_benefit"],
      ["USD", "green", null],
    ]);
    expect(r.rag.status).toBe("green");
    expect(r.rag.ruleKey).toBe("dashboard.rag.value.validated_gap");
  });

  it("variant B: a margin benefit with no line in the window -> profit-and-cash planned is a known zero, gap n/a nothing_planned", () => {
    const mar = cls("margin_uplift");
    const rev = cls("revenue_uplift");
    const r = valueArea(
      [mar, rev],
      [line(mar, "planned", "70", "2041-12-31"), line(rev, "planned", "300")],
      CLOCK,
      POLICY,
    );
    const c = r.currencies[0]!;
    expect(c.planned).toMatchObject({ state: "zero", value: "0", currency: "SAR" });
    expect(c).toMatchObject({ gapRatio: null, status: "not_applicable", reasonKey: "dashboard.value.nothing_planned" });
    expect(c.topLine!.planned.value).toBe("300");
    expect(c.nonCash).toBeNull();
    expect(r.rag).toEqual({ status: "not_applicable", ruleKey: "dashboard.rag.value.nothing_due", ruleParams: {} });
  });

  it("variant C: a revenue line without an amount makes only the top-line headline unknown", () => {
    const { benefits, lines } = dom();
    const r = valueArea(benefits, [...lines, line(benefits[0]!, "planned", null, "2041-02-28")], CLOCK, POLICY);
    const c = r.currencies[0]!;
    expect(c.topLine!.planned).toMatchObject({ state: "unknown", reasonKey: "benefit.value_amount_missing" });
    expect(c.planned.value).toBe("90");
    expect(c.nonCash!.planned.value).toBe("45");
    expect(c.status).toBe("red");
  });

  it("an unknown avoided-cost or margin line: only its own basis is unknown", () => {
    const { benefits, lines } = dom();
    const withAvoided = valueArea(benefits, [...lines, line(benefits[3]!, "validated", null)], CLOCK, POLICY);
    expect(withAvoided.currencies[0]!.nonCash!.validated.state).toBe("unknown");
    expect(withAvoided.currencies[0]!.validated.state).toBe("zero");
    const withMargin = valueArea(benefits, [...lines, line(benefits[1]!, "validated", null)], CLOCK, POLICY);
    expect(withMargin.currencies[0]!.validated.state).toBe("unknown");
    expect(withMargin.currencies[0]!.topLine!.validated.state).toBe("zero");
    expect(withMargin.rag.status).toBe("unknown");
  });

  it("a top-line or non-cash basis appears only where a counted, monetised benefit of its class exists", () => {
    const mar = cls("margin_uplift");
    const notCounted = cls("revenue_uplift", { counted: false });
    const unmonetised = cls("avoided_cost", { unmonetised: true });
    const r = valueArea(
      [mar, notCounted, unmonetised],
      [line(mar, "planned", "5"), line(notCounted, "planned", "9")],
      CLOCK,
      POLICY,
    );
    expect(r.currencies[0]!.topLine).toBeNull();
    expect(r.currencies[0]!.nonCash).toBeNull();
    expect(r.currencies[0]!.planned.value).toBe("5");
  });

  it("property: per currency and basis, the decimal sum of the basis's contributing lines equals its headline (300 seeded sets)", () => {
    const rnd = prng(123);
    const classes = ["revenue_uplift", "margin_uplift", "cash_saving", "avoided_cost", "working_capital_release"];
    const amount = () => `${Math.floor(rnd() * 1e9)}.${String(Math.floor(rnd() * 1e4)).padStart(4, "0")}`;
    const states = ["planned", "forecast", "submitted", "validated"] as const;
    for (let n = 0; n < 300; n += 1) {
      const benefits = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () =>
        benefit({
          valueClass: classes.at(Math.floor(rnd() * classes.length))!,
          currency: rnd() < 0.7 ? "SAR" : "USD",
          counted: rnd() < 0.9,
        }),
      );
      const lines = benefits.flatMap((b) =>
        Array.from({ length: Math.floor(rnd() * 5) }, () =>
          line(b, states.at(Math.floor(rnd() * 4))!, amount(), `2041-0${1 + Math.floor(rnd() * 3)}-28`),
        ),
      );
      const byId = new Map(benefits.map((b) => [b.benefitId, b]));
      const r = valueArea(benefits, lines, CLOCK, POLICY);
      for (const c of r.currencies)
        for (const [basis, sums] of [
          ["profit_and_cash", c.reasonKey === "dashboard.value.no_profit_and_cash_benefit" ? null : c],
          ["top_line", c.topLine],
          ["non_cash", c.nonCash],
        ] as const) {
          if (sums === null) continue;
          for (const state of states) {
            const sum = valueLinesOf(byId, lines, state, CLOCK, basisClasses(basis))
              .filter((l) => byId.get(l.benefitId)!.currency === c.currency)
              .reduce((acc, l) => acc.plus(new D(l.amount!)), new D(0));
            const v =
              state === "planned"
                ? sums.planned
                : state === "forecast"
                  ? sums.forecast
                  : state === "submitted"
                    ? sums.submitted
                    : sums.validated;
            expect(new D(v.value!).eq(sum), `${n} ${c.currency} ${basis} ${state}`).toBe(true);
          }
        }
      // Profit and cash never includes a revenue or avoided-cost amount: it equals the five-class sum minus those.
      for (const c of r.currencies) {
        if (c.reasonKey === "dashboard.value.no_profit_and_cash_benefit") continue;
        const all = valueLinesOf(byId, lines, "planned", CLOCK)
          .filter((l) => byId.get(l.benefitId)!.currency === c.currency)
          .reduce((acc, l) => acc.plus(new D(l.amount!)), new D(0));
        const beside = new D(c.topLine?.planned.value ?? 0).plus(new D(c.nonCash?.planned.value ?? 0));
        expect(new D(c.planned.value!).eq(all.minus(beside))).toBe(true);
      }
    }
  });
});

// ------------------------------------------------------------------------------------------------ Portfolio

function initiative(extra: Partial<InitiativeFact> = {}): InitiativeFact {
  return {
    initiativeId: id(),
    transformationId: "t",
    code: "INI-01",
    name: "Synthetic initiative",
    status: "launched",
    executiveOwnerUserId: null,
    workstreamLeadUserId: null,
    plannedAllocated: null,
    plannedCurrency: "SAR",
    milestones: [],
    outcomeIds: [],
    ...extra,
  };
}

const ms = (approvedDate: string | null, forecastDate: string | null, status = "planned") => ({
  milestoneId: id(),
  title: "Synthetic milestone",
  status,
  approvedDate,
  forecastDate,
});

describe("Portfolio (milestone + outcome risk)", () => {
  it("milestone component: overdue -> red; slip in working days vs thresholds; no approved date -> unknown", () => {
    expect(milestoneComponent([ms("2041-03-09", null)], CLOCK, POLICY).status).toBe("red");
    expect(milestoneComponent([ms("2041-03-09", null, "achieved")], CLOCK, POLICY).status).toBe("green");
    expect(milestoneComponent([ms(null, null)], CLOCK, POLICY).status).toBe("unknown");
    // 2041-03-14 is a Thursday; forecast the next Sunday 2041-03-17 = 1 working day (Fri/Sat skipped) -> amber (>= 1).
    expect(milestoneComponent([ms("2041-03-14", "2041-03-17")], CLOCK, POLICY)).toMatchObject({
      status: "amber",
      maxSlipWorkingDays: 1,
    });
    // Two working weeks later (10 working days) -> red (>= 10).
    expect(milestoneComponent([ms("2041-03-14", "2041-03-28")], CLOCK, POLICY).status).toBe("red");
    expect(milestoneComponent([ms("2041-03-14", "2041-03-17")], { ...CLOCK, calendar: null }, POLICY).status).toBe(
      "unknown",
    );
  });

  it("initiative = combine(milestone, outcome); top N by planned value allocated (decimal), then code", () => {
    const outcomes = new Map<string, RagStatus>([["o1", "red"]]);
    const a = initiative({
      code: "A",
      plannedAllocated: "100.5",
      milestones: [ms("2041-04-01", null)],
      outcomeIds: [],
    });
    const b = initiative({
      code: "B",
      plannedAllocated: "100.25",
      milestones: [ms("2041-04-01", null)],
      outcomeIds: ["o1"],
    });
    const c = initiative({ code: "C", plannedAllocated: null, status: "draft" });
    const r = portfolioArea([c, b, a], outcomes, CLOCK, { ...POLICY, topInitiativeCount: 2 });
    expect(r.initiatives.map((x) => x.fact.code)).toEqual(["A", "B"]);
    expect(r.initiatives.map((x) => x.status)).toEqual(["unknown", "red"]); // A: no contributed outcome -> unknown
    expect(r.rag.status).toBe("red");
    expect(portfolioArea([], outcomes, CLOCK, POLICY).rag.status).toBe("not_applicable");
  });
});

// ------------------------------------------------------------------------------------------------ Dependencies, Decisions

function dep(extra: Partial<DependencyFact> = {}): DependencyFact {
  return {
    dependencyId: id(),
    transformationId: "t",
    code: "DEP-01",
    description: "Synthetic dependency",
    ownerUserId: null,
    neededBy: "2041-06-01",
    status: "open",
    decisionId: null,
    decisionOverdue: false,
    targetInitiativeId: null,
    onCriticalPath: false,
    ...extra,
  };
}

describe("Dependencies (decision date / critical path)", () => {
  it("needed-by passed or an overdue linked decision -> red; at risk or due soon -> amber, red on the critical path", () => {
    expect(dependencyStatus(dep({ neededBy: "2041-03-09" }), CLOCK, POLICY).status).toBe("red");
    expect(dependencyStatus(dep({ decisionOverdue: true }), CLOCK, POLICY).status).toBe("red");
    expect(dependencyStatus(dep({ status: "at_risk" }), CLOCK, POLICY).status).toBe("amber");
    expect(dependencyStatus(dep({ neededBy: "2041-03-12" }), CLOCK, POLICY).status).toBe("amber");
    expect(dependencyStatus(dep({ neededBy: "2041-03-12", onCriticalPath: true }), CLOCK, POLICY).status).toBe("red");
    expect(dependencyStatus(dep({ neededBy: null }), CLOCK, POLICY).status).toBe("unknown");
    expect(dependencyStatus(dep(), CLOCK, POLICY).status).toBe("green");
    expect(dependencyStatus(dep({ onCriticalPath: null }), CLOCK, POLICY).flags).toContain(
      "critical_path_not_computable",
    );
    expect(dependenciesArea([], CLOCK, POLICY).rag).toEqual({
      status: "green",
      ruleKey: "dashboard.rag.dependencies.none_open",
      ruleParams: {},
    });
  });
});

function decision(dueDate: string | null, status = "open"): DecisionFact {
  return {
    decisionId: id(),
    transformationId: "t",
    code: "D-01",
    title: "Synthetic ask",
    ownerUserId: null,
    dueDate,
    status,
    impactOfDelay: null,
  };
}

describe("Decisions (REQ-PB-064: red if an executive decision is overdue)", () => {
  it("one open ask due yesterday (business date injected) -> red and listed; decided asks are not counted", () => {
    const yesterday = decision("2041-03-09");
    const r = decisionsArea([yesterday, decision("2041-06-01")], CLOCK, POLICY);
    expect(r.rag.status).toBe("red");
    expect(r.overdueCount).toBe(1);
    expect(r.decisions.find((x) => x.flags.includes("overdue"))!.fact.decisionId).toBe(yesterday.decisionId);
    const decided = decisionsArea([{ ...yesterday, status: "decided" }], CLOCK, POLICY);
    expect(decided.rag).toEqual({ status: "green", ruleKey: "dashboard.rag.decisions.none_open", ruleParams: {} });
    expect(decisionOverdue({ status: "deferred", dueDate: "2041-03-09" }, "2041-03-10")).toBe(true);
    expect(decisionOverdue({ status: "open", dueDate: "2041-03-10" }, "2041-03-10")).toBe(false);
  });

  it("due within the configured working days -> amber; a configured 0 narrows it to today", () => {
    expect(decisionsArea([decision("2041-03-12")], CLOCK, POLICY).rag.status).toBe("amber");
    expect(
      decisionsArea([decision("2041-03-12")], CLOCK, { ...POLICY, decisionDueSoonWorkingDays: 0 }).rag.status,
    ).toBe("green");
  });
});

describe("RAG policy rules", () => {
  it("effective values fall back to the labelled defaults; policySource names which applies; order is checked", () => {
    expect(effectiveValues(undefined)).toEqual({ ...DASHBOARD_RAG_DEFAULTS });
    expect(policySourceOf(undefined)).toBe("default");
    expect(thresholdOrderViolation({ ...POLICY, valueGapAmberRatio: "0.2" })).toBe("/valueGapAmberRatio");
    expect(thresholdOrderViolation({ ...POLICY, milestoneSlipAmberWorkingDays: 11 })).toBe(
      "/milestoneSlipAmberWorkingDays",
    );
    expect(thresholdOrderViolation(POLICY)).toBeNull();
  });

  it("maps the 0056 order CHECKs to 422 dashboard_rag_policy.threshold_order with the exact text", () => {
    const p = mapDatabaseGuardError({ code: "23514", constraint: "dashboard_rag_policy_value_gap_order" } as never);
    expect(p?.status).toBe(422);
    expect(p?.code).toBe("dashboard_rag_policy.threshold_order");
    expect(p?.detail).toBe("The amber threshold cannot be beyond the red threshold.");
    const milestone = mapDatabaseGuardError({
      code: "23514",
      constraint: "dashboard_rag_policy_milestone_slip_order",
    } as never);
    expect([milestone?.code, milestone?.errors?.[0]?.pointer]).toEqual([
      "dashboard_rag_policy.threshold_order",
      "/milestoneSlipAmberWorkingDays",
    ]);
    // Any other constraint keeps the generic mapping (never the dashboard code).
    expect(mapDatabaseGuardError({ code: "23514", constraint: "something_else" } as never)?.code).not.toBe(
      "dashboard_rag_policy.threshold_order",
    );
  });
});
