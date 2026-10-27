// The drill-down of one headline number or Finance class line (ADR-0037 §5 and amendment K1; REQ-S13-003,
// REQ-PB-062, REQ-S03-009):
//   GET /dashboard-drilldown?metric=&organizationId=&transformationId=&ownerUserId=&periodId=&phase=&status=
//                            &subjectId=&valueClass=&currency=&cursor=&limit=
// Its contributing records (paginated), period, calculation and evidence, over exactly the facts the headline was
// computed from (the same scope, filters, window and rules: engine.ts), so for a sum metric the decimal sum of
// `items[].value` over all pages equals the headline value, per currency (the invariant KBE-G tests). Currencies are
// never added together: with more than one currency the drill-down's own `value` is not_applicable
// (dashboard.value.multiple_currencies) and each item carries its currency. Zero, Unknown, Stale and not_applicable are
// distinct states; an Unknown amount makes a sum Unknown (never 0). With `currency` (ADR-0037 amendment N4 item 3) a
// value drill-down answers only that currency's figure, and a currency holding no record of the basis is not_applicable
// with no item. A read model: nothing stored.
import type { DbOrTx } from "@mth/db";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import {
  dashboardMetric,
  financeValueClass,
  HEADLINE_BASIS_CLASSES,
  type DashboardDrilldown,
  type HeadlineBasis,
  type DashboardMetric,
  type DashboardValue,
  type DrilldownEvidence,
  type DrilldownInput,
  type DrilldownItem,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadBenefitLineEvidence } from "../../benefits/index.ts";
import { principalOf } from "../../access/index.ts";
import { loadKpiStatusLineage } from "../../kpi/index.ts";
import {
  cursorSchema,
  decodeCursor,
  encodeCursor,
  filterHash,
  limitSchema,
  parseQuery,
  problems,
  type ModuleDeps,
} from "../../platform/index.ts";
import {
  basisClasses,
  basisOfClass,
  countValue,
  gapValue,
  kpiActualValue,
  knownValue,
  NO_PROFIT_AND_CASH,
  notApplicableValue,
  RATIO_ROUNDING,
  sumValue,
  unknownValue,
  valueCurrencies,
  valueLinesOf,
  type BasisGap,
  type ValueBenefitFact,
  type ValueCurrencyLine,
} from "./areas.ts";
import {
  computeAreas,
  initiativeValue,
  kpiStatusHref,
  loadDashboardContext,
  readOnly,
  T_PATH,
  type AreaResults,
  type DashboardContext,
} from "./engine.ts";
import { appliedFilters, asIdList, dashboardRefusal, organizationFilterShape, resolveFilters } from "./filters.ts";
import { benefitInClass, extraStateLinesOf, isExtraState, lineEntersClassSum } from "./finance.ts";
import { dashboardRestriction } from "./restricted.ts";
import { readableTransformations } from "./scope.ts";

export const DASHBOARD_DRILLDOWN = "/api/v1/dashboard-drilldown";
const drilldownQuery = z.strictObject({
  metric: dashboardMetric,
  ...organizationFilterShape,
  subjectId: z.uuid().optional(),
  // ADR-0037 amendment K1: only with the seven value-state metrics (else 422 dashboard.value_class_not_applicable).
  valueClass: financeValueClass.optional(),
  // ADR-0037 amendment N4 item 3: ISO 4217 (else 400); only with the value-state metrics, value.gap and value.investment
  // (else 422 dashboard.currency_not_applicable).
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

interface Drill {
  /** The basis of the classes summed (ADR-0037 amendment N3); null on non-value metrics and non_financial_valued. */
  readonly headlineBasis: HeadlineBasis | null;
  readonly value: DashboardValue;
  readonly items: DrilldownItem[];
  readonly ruleKey: string;
  readonly expression: string | null;
  readonly inputs: DrilldownInput[];
  readonly rounding: Record<string, unknown> | null;
  readonly evidence: DrilldownEvidence[];
}

/** The seven value-state metrics and their state (ADR-0037 §5 and amendment K1). */
const VALUE_STATE_OF: ReadonlyMap<DashboardMetric, string> = new Map<DashboardMetric, string>([
  ["value.planned", "planned"],
  ["value.forecast", "forecast"],
  ["value.submitted", "submitted"],
  ["value.validated", "validated"],
  ["value.measured", "measured"],
  ["value.rejected", "rejected"],
  ["value.sustained", "sustained"],
]);

/** The metrics whose `subjectId` names one record (ADR-0037 §5); the others take none. */
const SUBJECT_METRICS: readonly DashboardMetric[] = [
  "outcomes.kpi_status",
  "value.planned",
  "value.forecast",
  "value.submitted",
  "value.validated",
  "value.measured",
  "value.rejected",
  "value.sustained",
  "portfolio.initiatives",
  "decisions.open",
  "decisions.overdue",
];

/** The classes `value.gap` accepts as `valueClass` (ADR-0037 amendment N4 item 1) and the basis each selects. */
const GAP_CLASS_BASIS: ReadonlyMap<string, HeadlineBasis> = new Map<string, HeadlineBasis>([
  ["revenue_uplift", "top_line"],
  ["avoided_cost", "non_cash"],
]);

/** The not_applicable reason of a currency holding no benefit of the class asked for (ADR-0037 amendment N4 item 3). */
const NO_BENEFIT_IN_CLASS = "dashboard.value.no_benefit_in_class";

/** The gap of `basis` in one Value-area currency line, or null when the currency holds no benefit of that basis. */
function basisGapOf(line: ValueCurrencyLine | undefined, basis: HeadlineBasis): BasisGap | null {
  if (line === undefined) return null;
  if (basis === "top_line") return line.topLineGap;
  if (basis === "non_cash") return line.nonCashGap;
  return line.reasonKey === NO_PROFIT_AND_CASH ? null : line;
}

/** The planned and validated sums of `basis` in one Value-area currency line (the gap's inputs), or null. */
function basisSumsOf(line: ValueCurrencyLine, basis: HeadlineBasis) {
  if (basis === "top_line") return line.topLine;
  if (basis === "non_cash") return line.nonCash;
  return line;
}

/** The single-currency value of a set of per-currency sums, or not_applicable when several currencies are involved. */
function oneCurrency(byCurrency: ReadonlyMap<string, DashboardValue>, unit: string): DashboardValue {
  if (byCurrency.size === 1) return [...byCurrency.values()][0]!;
  if (byCurrency.size === 0) return knownValue("0", unit, null);
  return notApplicableValue("dashboard.value.multiple_currencies", unit);
}

function period(ctx: DashboardContext) {
  return {
    start: ctx.filters.windowStart,
    end: ctx.filters.windowEnd,
    asOf: ctx.filters.asOf,
    label: ctx.filters.period?.label ?? null,
  };
}

/**
 * A value-state drill-down (value.planned, forecast, submitted, validated, measured, rejected, sustained): one item per
 * benefit, its lines of the state summed. The lines are selected by the Finance class line's own rule
 * (lineEntersClassSum, ADR-0037 amendment K1 item 3): with `valueClass` the benefits of that Finance class, without it
 * the three PROFIT-AND-CASH classes (margin_uplift, cash_saving, working_capital_release; ADR-0037 amendment N3 item 3,
 * so the drill-down of a profit_and_cash headline and of a Finance gross line sums exactly their records). Measured,
 * rejected and sustained lines are the benefit_value_line rows the Finance dashboard reads (extraStateLinesOf).
 *
 * The drill-down's own `value` and `inputs` are per currency: the currencies of the eligible benefits (those the
 * Finance dashboard shows a class line for), so an eligible class with no line in the state is a known zero in its own
 * currency, like its Finance line (ADR-0030 §7 item 7). A scope with no eligible benefit is not_applicable with its
 * reason, never a fabricated 0: without `valueClass`, dashboard.value.no_profit_and_cash_benefit when it holds
 * financial benefits of the other two classes only, else dashboard.value.no_financial_benefit.
 */
async function valueDrill(
  db: DbOrTx,
  ctx: DashboardContext,
  scopeIds: readonly string[],
  state: string,
  valueClass: string | null,
  subjectId: string | null,
  currency: string | null,
) {
  const byId = new Map(ctx.facts.benefits.map((b) => [b.benefitId, b]));
  const source = isExtraState(state) ? await extraStateLinesOf(db, ctx, scopeIds) : ctx.facts.lines;
  const classes: readonly string[] = valueClass === null ? HEADLINE_BASIS_CLASSES.profit_and_cash : [valueClass];
  let lines = source.filter((l) =>
    classes.some((c) => lineEntersClassSum(byId.get(l.benefitId), l, state, c, ctx.clock)),
  );
  let eligible: ValueBenefitFact[] = ctx.facts.benefits.filter((b) => classes.some((c) => benefitInClass(b, c)));
  let financial: ValueBenefitFact[] = ctx.facts.benefits.filter((b) => benefitInClass(b, null));
  if (subjectId !== null) {
    if (!byId.has(subjectId)) throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
    lines = lines.filter((l) => l.benefitId === subjectId);
    eligible = eligible.filter((b) => b.benefitId === subjectId);
    financial = financial.filter((b) => b.benefitId === subjectId);
  }
  if (currency !== null) {
    // N4 item 3: only this currency's records, after subjectId.
    lines = lines.filter((l) => byId.get(l.benefitId)!.currency === currency);
    eligible = eligible.filter((b) => b.currency === currency);
    financial = financial.filter((b) => b.currency === currency);
  }
  const benefitIds = [...new Set(lines.map((l) => l.benefitId))];
  const items: DrilldownItem[] = benefitIds.map((id) => {
    const b = byId.get(id)!;
    return {
      recordType: "benefit",
      recordId: id,
      code: b.code,
      label: b.title,
      href: `${T_PATH(b.transformationId)}/benefits/${id}`,
      value: sumValue(
        lines.filter((l) => l.benefitId === id).map((l) => l.amount),
        b.currency,
        "currency",
        "benefit.value_amount_missing",
      ),
      period: period(ctx),
    };
  });
  const currencies = [...new Set(eligible.map((b) => b.currency))].sort();
  const byCurrency = new Map<string, DashboardValue>();
  for (const c of currencies)
    byCurrency.set(
      c,
      sumValue(
        lines.filter((l) => byId.get(l.benefitId)!.currency === c).map((l) => l.amount),
        c,
        "currency",
        "benefit.value_amount_missing",
      ),
    );
  const measurementIds = lines.filter((l) => l.recordTable === "benefit_measurement").map((l) => l.recordId);
  const evidence = (await loadBenefitLineEvidence(db, measurementIds)).map((e) => ({
    evidenceId: e.id,
    title: e.title,
    verificationStatus: e.review_status,
    recordType: "benefit_measurement",
    recordId: e.measurement_id!,
  }));
  // The scope's value currencies (N4 item 3): those of its counted, monetised financial benefits plus those of the
  // requested class's eligible benefits (non_financial_valued). Without `currency` and `subjectId`, more than one of
  // them makes the drill-down's own value not_applicable, so it never answers one currency's figure for another's.
  const scopeCurrencies = new Set([...valueCurrencies(ctx.facts.benefits), ...currencies]);
  const noRecord = (unit: string) =>
    notApplicableValue(
      valueClass !== null && currency !== null
        ? NO_BENEFIT_IN_CLASS
        : valueClass === null && financial.length > 0
          ? NO_PROFIT_AND_CASH
          : "dashboard.value.no_financial_benefit",
      unit,
    );
  return {
    headlineBasis: valueClass === null ? "profit_and_cash" : basisOfClass(valueClass),
    value:
      byCurrency.size === 0
        ? currency === null
          ? noRecord("currency")
          : { ...noRecord("currency"), currency }
        : currency === null && subjectId === null && scopeCurrencies.size > 1
          ? notApplicableValue("dashboard.value.multiple_currencies", "currency")
          : oneCurrency(byCurrency, "currency"),
    items,
    // ADR-0037 amendment N3: dashboard.value.sum_<state>_profit_and_cash without valueClass; K2 (unchanged) with it.
    ruleKey: valueClass === null ? `dashboard.value.sum_${state}_profit_and_cash` : `dashboard.value.sum_${state}`,
    expression: null,
    inputs: [...byCurrency].map(([c, v]) => ({ name: `total_${c}`, value: v, recordType: null, recordId: null })),
    rounding: null,
    evidence,
  } satisfies Drill;
}

async function drill(
  db: DbOrTx,
  ctx: DashboardContext,
  r: AreaResults,
  metric: DashboardMetric,
  subjectId: string | null,
  valueClass: string | null,
  scopeIds: readonly string[],
  currency: string | null,
): Promise<Drill> {
  const state = VALUE_STATE_OF.get(metric);
  // ADR-0037 amendment K1 item 1: a value class narrows only a value-state drill-down, and (N4 item 1) selects the
  // top-line or non-cash gap on value.gap.
  if (valueClass !== null && state === undefined && !(metric === "value.gap" && GAP_CLASS_BASIS.has(valueClass)))
    throw dashboardRefusal("dashboard.value_class_not_applicable", "/valueClass");
  if (subjectId !== null && !SUBJECT_METRICS.includes(metric))
    throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
  // N4 item 3: a currency narrows only a value-state, value.gap or value.investment drill-down.
  if (currency !== null && state === undefined && metric !== "value.gap" && metric !== "value.investment")
    throw dashboardRefusal("dashboard.currency_not_applicable", "/currency");
  if (state !== undefined) return valueDrill(db, ctx, scopeIds, state, valueClass, subjectId, currency);
  const base = { headlineBasis: null, expression: null, rounding: null, evidence: [] as DrilldownEvidence[] };
  switch (metric) {
    case "outcomes.area": {
      const kpis = r.outcomes.outcomes.flatMap((o) => o.fact.kpis.map((k) => ({ o: o.fact, k })));
      return {
        ...base,
        value: countValue(kpis.length, "outcome_kpi"),
        items: kpis.map(({ o, k }) => ({
          recordType: "outcome_kpi",
          recordId: k.outcomeKpiId,
          code: k.status.periodLabel,
          label: k.status.kpiName,
          href: kpiStatusHref(o.transformationId, k.status.kpiDefinitionId),
          value: kpiActualValue(k.status),
          period: period(ctx),
        })),
        ruleKey: r.outcomes.rag.ruleKey,
        inputs: [],
      };
    }
    case "outcomes.kpi_status": {
      if (subjectId === null) throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
      const found = r.outcomes.outcomes
        .flatMap((o) => o.fact.kpis.map((k) => ({ o: o.fact, k })))
        .find((x) => x.k.outcomeKpiId === subjectId);
      if (!found) {
        const exists = await db.selectFrom("outcome_kpi").select("id").where("id", "=", subjectId).executeTakeFirst();
        if (exists) throw problems.notFound();
        throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
      }
      const s = found.k.status;
      const actual = kpiActualValue(s);
      const lineage = s.evaluationId === null ? null : await loadKpiStatusLineage(db, s.evaluationId);
      const t = found.o.transformationId;
      const items: DrilldownItem[] = [];
      if (lineage?.actual)
        items.push({
          recordType: "kpi_actual",
          recordId: lineage.actual.id,
          code: lineage.actual.period_label,
          label: s.kpiName,
          href: `${T_PATH(t)}/kpi-actuals/${lineage.actual.id}`,
          value: actual,
          period: {
            start: lineage.actual.period_start,
            end: lineage.actual.period_end,
            asOf: ctx.filters.asOf,
            label: lineage.actual.period_label,
          },
        });
      if (lineage)
        items.push({
          recordType: "kpi_evaluation",
          recordId: lineage.evaluation.id,
          code: s.periodLabel,
          label: s.kpiName,
          href: kpiStatusHref(t, s.kpiDefinitionId),
          value: actual,
          period: null,
        });
      return {
        headlineBasis: null,
        value: actual,
        items,
        ruleKey: `dashboard.kpi.${s.displayedRag}`,
        expression: null,
        inputs: [
          {
            name: "actual",
            value: actual,
            recordType: lineage?.actual ? "kpi_actual" : null,
            recordId: lineage?.actual?.id ?? null,
          },
        ],
        rounding: (lineage?.evaluation.rounding as Record<string, unknown> | null | undefined) ?? null,
        evidence: (lineage?.evidence ?? []).map((e) => ({
          evidenceId: e.id,
          title: e.title,
          verificationStatus: e.review_status,
          recordType: "kpi_actual",
          recordId: lineage!.actual!.id,
        })),
      };
    }
    case "value.investment": {
      // N4 item 3: with `currency`, that currency's lines only, and a known zero in it when there is none.
      const investment =
        currency === null ? ctx.facts.investment : ctx.facts.investment.filter((l) => l.currency === currency);
      const currencies = currency === null ? [...new Set(investment.map((l) => l.currency))].sort() : [currency];
      const byCurrency = new Map(
        currencies.map((c) => [
          c,
          sumValue(
            investment.filter((l) => l.currency === c).map((l) => l.amount),
            c,
            "currency",
            "benefit.cost_amount_missing",
          ),
        ]),
      );
      return {
        ...base,
        value: oneCurrency(byCurrency, "currency"),
        items: investment.map((l) => ({
          recordType: "business_case_line",
          recordId: l.recordId,
          code: null,
          label: l.label,
          href: `/api/v1/business-cases/${l.businessCaseId}/lines/${l.recordId}`,
          value:
            l.amount === null
              ? unknownValue("benefit.cost_amount_missing", "currency", l.currency)
              : knownValue(l.amount, "currency", l.currency),
          period: null,
        })),
        ruleKey: "dashboard.value.sum_investment",
        inputs: [...byCurrency].map(([c, v]) => ({ name: `total_${c}`, value: v, recordType: null, recordId: null })),
      };
    }
    case "value.gap": {
      // ADR-0037 amendments N3 and N4 item 1: the gap of one basis (profit and cash without valueClass, top line with
      // revenue_uplift, non-cash with avoided_cost), so its items are only that basis's lines; with `currency` (N4
      // item 3) only that currency's.
      const basis: HeadlineBasis = valueClass === null ? "profit_and_cash" : GAP_CLASS_BASIS.get(valueClass)!;
      const classes = basisClasses(basis);
      const byId = new Map(ctx.facts.benefits.map((b) => [b.benefitId, b]));
      const inCurrency = (l: { benefitId: string }) =>
        currency === null || byId.get(l.benefitId)!.currency === currency;
      const lines = [
        ...valueLinesOf(byId, ctx.facts.lines, "planned", ctx.clock, classes),
        ...valueLinesOf(byId, ctx.facts.lines, "validated", ctx.clock, classes),
      ].filter(inCurrency);
      const c = r.value.currencies;
      const absent = (cur: string, line: ValueCurrencyLine | undefined): DashboardValue => ({
        ...notApplicableValue(
          valueClass !== null
            ? NO_BENEFIT_IN_CLASS
            : line !== undefined
              ? NO_PROFIT_AND_CASH
              : "dashboard.value.no_financial_benefit",
          "ratio",
        ),
        currency: cur,
      });
      let value: DashboardValue;
      if (currency !== null) {
        const line = c.find((x) => x.currency === currency);
        const gap = basisGapOf(line, basis);
        value = gap === null ? absent(currency, line) : gapValue(gap, currency);
      } else {
        const one = c.length === 1 ? c[0]! : null;
        const gap = one === null ? null : basisGapOf(one, basis);
        value =
          c.length > 1
            ? notApplicableValue("dashboard.value.multiple_currencies", "ratio")
            : one === null
              ? notApplicableValue("dashboard.value.no_financial_benefit", "ratio")
              : gap === null
                ? absent(one.currency, one)
                : gapValue(gap, one.currency);
      }
      // The inputs: the planned and validated sums of the basis per currency (the profit-and-cash ones of every value
      // currency, as before, without `currency`); none for a currency without the basis.
      const inputLines =
        basis === "profit_and_cash" && currency === null
          ? c
          : c.filter((x) => (currency === null || x.currency === currency) && basisGapOf(x, basis) !== null);
      return {
        ...base,
        headlineBasis: basis,
        value,
        items: lines.map((l) => {
          const b = byId.get(l.benefitId)!;
          return {
            recordType: l.recordTable,
            recordId: l.recordId,
            code: b.code,
            label: `${b.title} (${l.state})`,
            href:
              l.recordTable === "benefit_measurement"
                ? `${T_PATH(b.transformationId)}/benefit-measurements/${l.recordId}`
                : `${T_PATH(b.transformationId)}/benefit-plan-values/${l.recordId}`,
            value:
              l.amount === null
                ? unknownValue("benefit.value_amount_missing", "currency", b.currency)
                : knownValue(l.amount, "currency", b.currency),
            period: { start: l.periodStart, end: l.periodEnd, asOf: ctx.filters.asOf, label: null },
          };
        }),
        ruleKey: basis === "profit_and_cash" ? "dashboard.value.gap_ratio" : `dashboard.value.gap_ratio_${basis}`,
        expression: "(plannedToDate - validatedToDate) / plannedToDate",
        rounding: { ...RATIO_ROUNDING },
        inputs: inputLines.flatMap((x) => {
          const sums = basisSumsOf(x, basis)!;
          return [
            { name: `planned_${x.currency}`, value: sums.planned, recordType: null, recordId: null },
            { name: `validated_${x.currency}`, value: sums.validated, recordType: null, recordId: null },
          ];
        }),
      };
    }
    case "portfolio.initiatives": {
      let rows = r.portfolio.initiatives;
      if (subjectId !== null) {
        rows = rows.filter((x) => x.fact.initiativeId === subjectId);
        if (rows.length === 0) throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
      }
      return {
        ...base,
        // ADR-0037 amendment N4 item 2: the items' values are on the profit-and-cash basis.
        headlineBasis: "profit_and_cash",
        value: countValue(rows.length, "initiative"),
        items: rows.map((x) => ({
          recordType: "initiative",
          recordId: x.fact.initiativeId,
          code: x.fact.code,
          label: x.fact.name,
          href: `/api/v1/initiatives/${x.fact.initiativeId}`,
          value: initiativeValue(x.fact),
          period: null,
        })),
        ruleKey: r.portfolio.rag.ruleKey,
        inputs: rows.map((x) => ({
          name: `milestone_${x.milestone.status}_outcome_${x.outcome}`,
          value: countValue(x.milestone.maxSlipWorkingDays ?? 0, "working_day"),
          recordType: "initiative",
          recordId: x.fact.initiativeId,
        })),
      };
    }
    case "dependencies.open":
      return {
        ...base,
        value: countValue(r.dependencies.dependencies.length, "dependency"),
        items: r.dependencies.dependencies.map((x) => ({
          recordType: "dependency",
          recordId: x.fact.dependencyId,
          code: x.fact.code,
          label: x.fact.description,
          href: `${T_PATH(x.fact.transformationId)}/dependencies/${x.fact.dependencyId}`,
          value: null,
          period: null,
        })),
        ruleKey: r.dependencies.rag.ruleKey,
        inputs: [],
      };
    case "decisions.open":
    case "decisions.overdue": {
      let rows = r.decisions.decisions.filter((x) => metric === "decisions.open" || x.flags.includes("overdue"));
      if (subjectId !== null) {
        rows = rows.filter((x) => x.fact.decisionId === subjectId);
        if (rows.length === 0) throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
      }
      return {
        ...base,
        value: countValue(rows.length, "decision"),
        items: rows.map((x) => ({
          recordType: "executive_decision",
          recordId: x.fact.decisionId,
          code: x.fact.code,
          label: x.fact.title,
          href: `${T_PATH(x.fact.transformationId)}/executive-decisions/${x.fact.decisionId}`,
          value: null,
          period: null,
        })),
        ruleKey: r.decisions.rag.ruleKey,
        inputs: [],
      };
    }
    case "adoption.indicators":
      return {
        ...base,
        value: countValue(r.adoption.indicators.length, "indicator"),
        items: r.adoption.indicators.map((x) => ({
          recordType: "adoption_metric_link",
          recordId: x.fact.metricLinkId,
          code: x.fact.templateKey,
          label: x.fact.status.kpiName,
          href: kpiStatusHref(x.fact.transformationId, x.fact.status.kpiDefinitionId),
          value: kpiActualValue(x.fact.status),
          period: period(ctx),
        })),
        ruleKey: r.adoption.rag.ruleKey,
        inputs: [],
      };
    case "finance.pending_validation": {
      // Submitted measurements awaiting Finance (pending is never validated value; REQ-S08-016): not windowed.
      const byId = new Map(ctx.facts.benefits.map((b) => [b.benefitId, b]));
      const pending = ctx.facts.lines.filter((l) => l.state === "submitted" && byId.has(l.benefitId));
      return {
        ...base,
        value: countValue(pending.length, "measurement"),
        items: pending.map((l) => {
          const b = byId.get(l.benefitId)!;
          return {
            recordType: "benefit_measurement",
            recordId: l.recordId,
            code: b.code,
            label: b.title,
            href: `${T_PATH(b.transformationId)}/benefit-measurements/${l.recordId}`,
            value:
              l.amount === null
                ? unknownValue("benefit.value_amount_missing", "currency", l.currency)
                : knownValue(l.amount, "currency", l.currency),
            period: { start: l.periodStart, end: l.periodEnd, asOf: ctx.filters.asOf, label: null },
          };
        }),
        ruleKey: "dashboard.finance.pending_validation",
        inputs: [],
      };
    }
    default:
      // Every metric is handled above (DASHBOARD_METRICS); kept for exhaustiveness.
      throw problems.internal();
  }
}

/** The decimal sum of known item values of one currency (the invariant's left-hand side; used by the tests). */
export function sumItems(items: readonly DrilldownItem[], currency: string): string | null {
  let acc = new D(0);
  for (const i of items) {
    if (i.value === null || i.value.currency !== currency) continue;
    if (i.value.value === null) return null;
    acc = acc.plus(new D(i.value.value));
  }
  return acc.toFixed();
}

export function registerDrilldownRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    DASHBOARD_DRILLDOWN,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<DashboardDrilldown> => {
      const query = parseQuery(drilldownQuery, request.query);
      const transformationIds = asIdList(query.transformationId);
      const hash = filterHash({
        drilldown: query.metric,
        organizationId: query.organizationId,
        transformationIds: [...transformationIds].sort(),
        ownerUserId: query.ownerUserId ?? null,
        periodId: query.periodId ?? null,
        phase: query.phase ?? null,
        status: query.status ?? null,
        subjectId: query.subjectId ?? null,
        // Only when given, so the cursor of every request without it is unchanged (byte stability, K1 item 6).
        ...(query.valueClass === undefined ? {} : { valueClass: query.valueClass }),
        ...(query.currency === undefined ? {} : { currency: query.currency }),
      });
      const after = decodeCursor(query.cursor, hash, 1);
      return readOnly(db, async (tx) => {
        const principal = principalOf(request);
        const scope = await readableTransformations(tx, principal, query.organizationId, {
          transformationIds,
          phase: query.phase ?? null,
          status: query.status ?? null,
        });
        const filters = await resolveFilters(tx, {
          organizationId: query.organizationId,
          transformationIds,
          ownerUserId: query.ownerUserId,
          periodId: query.periodId,
          phase: query.phase,
          status: query.status,
        });
        const ctx = await loadDashboardContext(tx, scope, filters);
        // P6 (T-DG6-BE-B2; ADR-0051 §2): the figures are the same for every reader; an item, input or evidence entry of
        // a restricted record is not listed, and a restricted subject is refused like a subject outside the scope.
        const restriction = await dashboardRestriction(tx, principal, ctx.facts);
        if (query.subjectId !== undefined && restriction.hides("benefit", query.subjectId))
          throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
        const drilled = await drill(
          tx,
          ctx,
          computeAreas(ctx.facts, ctx.clock, ctx.policy),
          query.metric,
          query.subjectId ?? null,
          query.valueClass ?? null,
          scope.map((t) => t.id),
          query.currency ?? null,
        );
        const d =
          restriction.field.includesRestrictedRecords === true
            ? {
                ...drilled,
                items: drilled.items.filter((i) => !restriction.hides(i.recordType, i.recordId)),
                inputs: drilled.inputs.filter((i) => !restriction.hides(i.recordType, i.recordId)),
                evidence: drilled.evidence.filter((e) => !restriction.hides(e.recordType, e.recordId)),
              }
            : drilled;
        // Offset pagination over the deterministic item order (the cursor is bound to the filters by its hash).
        const start = after ? Number(after[0]) : 0;
        const page = d.items.slice(start, start + query.limit);
        const next = start + query.limit < d.items.length ? encodeCursor([start + query.limit], hash) : null;
        return {
          metric: query.metric,
          appliedFilters: appliedFilters(filters),
          value: d.value,
          period: period(ctx),
          calculation: { ruleKey: d.ruleKey, expression: d.expression, inputs: d.inputs, rounding: d.rounding },
          items: page,
          evidence: d.evidence,
          nextCursor: next,
          headlineBasis: d.headlineBasis,
          currency: query.currency ?? null,
          ...restriction.field,
        };
      });
    },
  );
  return [`GET ${DASHBOARD_DRILLDOWN}`];
}
