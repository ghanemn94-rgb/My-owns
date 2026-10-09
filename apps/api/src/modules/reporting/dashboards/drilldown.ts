// The drill-down of one headline number (ADR-0037 §5; REQ-S13-003, REQ-PB-062, REQ-S03-009):
//   GET /dashboard-drilldown?metric=&organizationId=&transformationId=&ownerUserId=&periodId=&phase=&status=
//                            &subjectId=&cursor=&limit=
// Its contributing records (paginated), period, calculation and evidence, over exactly the facts the headline was
// computed from (the same scope, filters, window and rules: engine.ts), so for a sum metric the decimal sum of
// `items[].value` over all pages equals the headline value, per currency (the invariant KBE-G tests). Currencies are
// never added together: with more than one currency the drill-down's own `value` is not_applicable
// (dashboard.value.multiple_currencies) and each item carries its currency. Zero, Unknown, Stale and not_applicable are
// distinct states; an Unknown amount makes a sum Unknown (never 0). A read model: nothing stored.
import type { DbOrTx } from "@mth/db";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import {
  dashboardMetric,
  type DashboardDrilldown,
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
  countValue,
  kpiActualValue,
  knownValue,
  notApplicableValue,
  RATIO_ROUNDING,
  sumValue,
  unknownValue,
  valueLinesOf,
  type ValueHeadlineState,
} from "./areas.ts";
import {
  computeAreas,
  kpiStatusHref,
  loadDashboardContext,
  readOnly,
  T_PATH,
  type AreaResults,
  type DashboardContext,
} from "./engine.ts";
import { appliedFilters, asIdList, dashboardRefusal, organizationFilterShape, resolveFilters } from "./filters.ts";
import { readableTransformations } from "./scope.ts";

export const DASHBOARD_DRILLDOWN = "/api/v1/dashboard-drilldown";
const drilldownQuery = z.strictObject({
  metric: dashboardMetric,
  ...organizationFilterShape,
  subjectId: z.uuid().optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

interface Drill {
  readonly value: DashboardValue;
  readonly items: DrilldownItem[];
  readonly ruleKey: string;
  readonly expression: string | null;
  readonly inputs: DrilldownInput[];
  readonly rounding: Record<string, unknown> | null;
  readonly evidence: DrilldownEvidence[];
}

const VALUE_STATE_OF: ReadonlyMap<DashboardMetric, ValueHeadlineState> = new Map<DashboardMetric, ValueHeadlineState>([
  ["value.planned", "planned"],
  ["value.forecast", "forecast"],
  ["value.submitted", "submitted"],
  ["value.validated", "validated"],
]);

/** The metrics whose `subjectId` names one record (ADR-0037 §5); the others take none. */
const SUBJECT_METRICS: readonly DashboardMetric[] = [
  "outcomes.kpi_status",
  "value.planned",
  "value.forecast",
  "value.submitted",
  "value.validated",
  "portfolio.initiatives",
  "decisions.open",
  "decisions.overdue",
];

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

/** value.planned / forecast / submitted / validated: one item per benefit (its eligible lines summed). */
async function valueDrill(db: DbOrTx, ctx: DashboardContext, state: ValueHeadlineState, subjectId: string | null) {
  const byId = new Map(ctx.facts.benefits.map((b) => [b.benefitId, b]));
  let lines = valueLinesOf(byId, ctx.facts.lines, state, ctx.clock);
  if (subjectId !== null) {
    if (!byId.has(subjectId)) throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
    lines = lines.filter((l) => l.benefitId === subjectId);
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
  const byCurrency = new Map<string, DashboardValue>();
  for (const c of [...new Set(lines.map((l) => byId.get(l.benefitId)!.currency))].sort())
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
  return {
    value: oneCurrency(byCurrency, "currency"),
    items,
    ruleKey: `dashboard.value.sum_${state}`,
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
): Promise<Drill> {
  if (subjectId !== null && !SUBJECT_METRICS.includes(metric))
    throw dashboardRefusal("dashboard.metric_subject_mismatch", "/subjectId");
  const state = VALUE_STATE_OF.get(metric);
  if (state !== undefined) return valueDrill(db, ctx, state, subjectId);
  const base = { expression: null, rounding: null, evidence: [] as DrilldownEvidence[] };
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
      const currencies = [...new Set(ctx.facts.investment.map((l) => l.currency))].sort();
      const byCurrency = new Map(
        currencies.map((c) => [
          c,
          sumValue(
            ctx.facts.investment.filter((l) => l.currency === c).map((l) => l.amount),
            c,
            "currency",
            "benefit.cost_amount_missing",
          ),
        ]),
      );
      return {
        ...base,
        value: oneCurrency(byCurrency, "currency"),
        items: ctx.facts.investment.map((l) => ({
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
      const byId = new Map(ctx.facts.benefits.map((b) => [b.benefitId, b]));
      const lines = [
        ...valueLinesOf(byId, ctx.facts.lines, "planned", ctx.clock),
        ...valueLinesOf(byId, ctx.facts.lines, "validated", ctx.clock),
      ];
      const c = r.value.currencies;
      const one = c.length === 1 ? c[0]! : null;
      const value: DashboardValue =
        c.length > 1
          ? notApplicableValue("dashboard.value.multiple_currencies", "ratio")
          : one === null
            ? notApplicableValue("dashboard.value.no_financial_benefit", "ratio")
            : one.gapRatio !== null
              ? knownValue(one.gapRatio, "ratio", one.currency)
              : one.status === "unknown"
                ? unknownValue(one.reasonKey ?? "benefit.value_amount_missing", "ratio", one.currency)
                : notApplicableValue(one.reasonKey ?? "dashboard.value.nothing_planned", "ratio");
      return {
        ...base,
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
        ruleKey: "dashboard.value.gap_ratio",
        expression: "(plannedToDate - validatedToDate) / plannedToDate",
        rounding: { ...RATIO_ROUNDING },
        inputs: c.flatMap((x) => [
          { name: `planned_${x.currency}`, value: x.planned, recordType: null, recordId: null },
          { name: `validated_${x.currency}`, value: x.validated, recordType: null, recordId: null },
        ]),
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
        value: countValue(rows.length, "initiative"),
        items: rows.map((x) => ({
          recordType: "initiative",
          recordId: x.fact.initiativeId,
          code: x.fact.code,
          label: x.fact.name,
          href: `/api/v1/initiatives/${x.fact.initiativeId}`,
          value:
            x.fact.plannedAllocated === null
              ? unknownValue("dashboard.portfolio.no_allocated_value", "currency", x.fact.plannedCurrency)
              : knownValue(x.fact.plannedAllocated, "currency", x.fact.plannedCurrency),
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
      });
      const after = decodeCursor(query.cursor, hash, 1);
      return readOnly(db, async (tx) => {
        const scope = await readableTransformations(tx, principalOf(request), query.organizationId, {
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
        const d = await drill(
          tx,
          ctx,
          computeAreas(ctx.facts, ctx.clock, ctx.policy),
          query.metric,
          query.subjectId ?? null,
        );
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
        };
      });
    },
  );
  return [`GET ${DASHBOARD_DRILLDOWN}`];
}
