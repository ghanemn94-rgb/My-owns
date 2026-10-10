// The Finance dashboard (T-DG4-KBE-G2; ADR-0037 §2, §4-§6, §12; ADR-0030 §6-§7; REQ-S13-001 "Finance"; M0244):
//   GET /dashboards/finance?organizationId=&transformationId=&ownerUserId=&periodId=&phase=&status=
// Over the transformations of the organization the caller may read (scope.ts; 404 outside it), narrowed by the
// filters, with the same facts, window and counting rules as the T10 Value area (engine.ts, areas.ts):
//  - `lines`: one line per value class × state × currency (ADR-0030 §7 item 2): the five financial classes and
//    `non_financial_valued` (a non-financial benefit with an APPROVED valuation method), each state summed on its own
//    (never states added together; forecast is never validated; scenarios are never read). Only benefits counted once
//    (`benefit_counting.counted`) enter; a benefit with an open overlap warning has its validated and sustained values
//    held back (ADR-0030 §7 item 4). Planned, measured, submitted, validated, rejected and sustained are "to date"
//    (period end on or before the as-of date, and inside the period filter's window); forecast is "in the window"
//    (lineInWindow, the Value area's rule). Currencies are never converted or added together.
//  - gross, implementation cost and net (ADR-0030 §7 item 6): the lines `gross` (planned, validated) = the sum of the
//    five financial classes' lines of that state = exactly the Value area's `value.planned` / `value.validated`
//    headline (so they drill to it with the decimal-sum invariant); implementation cost is the `value.investment`
//    headline (each business-case investment line once); the lines `net` (planned, validated) = gross − implementation
//    cost per currency. A missing amount makes the total Unknown with its reason, never 0. With an owner filter the
//    investment lines have no owner (engine.ts narrowByFilters), so no net line is shown.
//  - `headlines`: the Value area's headlines (planned, forecast, submitted, validated, gap, investment per currency) and
//    `finance.pending_validation` (the submitted measurements awaiting Finance), each drilling to its records.
//  - `pendingValidationCount`, `nonFinancialCount` (counted benefits without an approved valuation method: Value n/a,
//    in no line, never summed as 0; REQ-PB-076) and one row per transformation with its six area statuses.
// A read model: computed in the request's READ ONLY transaction (engine.ts readOnly); nothing is stored. Pending,
// forecast and unvalidated values are never shown as validated. Nothing here is a Finance approval.
import type { DbOrTx } from "@mth/db";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import type { DashboardValue, FinanceDashboard, FinanceLineState, FinanceValueLine } from "@mth/shared/schemas";
import { FINANCE_LINE_STATES } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import { parseQuery, type ModuleDeps } from "../../platform/index.ts";
import {
  countValue,
  FINANCIAL_VALUE_CLASSES,
  lineInWindow,
  sumValue,
  unknownValue,
  type DashboardClock,
  type ValueBenefitFact,
  type ValueLineFact,
  type ValueResult,
} from "./areas.ts";
import {
  areaStatuses,
  computeAreas,
  factsOfTransformation,
  loadAreaDefinitions,
  loadDashboardContext,
  presentAreas,
  readOnly,
  type DashboardContext,
} from "./engine.ts";
import { appliedFilters, asIdList, drilldownHref, organizationFilterShape, resolveFilters } from "./filters.ts";
import { readableTransformations } from "./scope.ts";

export const FINANCE_DASHBOARD = "/api/v1/dashboards/finance";
const financeQuery = z.strictObject(organizationFilterShape);

/** The value classes of a Finance line, in ADR-0030 §7 order. */
export const FINANCE_LINE_CLASSES = [...FINANCIAL_VALUE_CLASSES, "non_financial_valued"] as const;

/** The value states the engine's facts do not carry (measured, rejected, sustained), read from benefit_value_line. */
const EXTRA_STATES = ["measured", "rejected", "sustained"] as const;

/** The Finance class of a benefit, or null when it enters no line (not counted, or unmonetised: Value n/a). */
export function financeClassOf(b: ValueBenefitFact): string | null {
  if (!b.counted || b.unmonetised) return null;
  if (b.valueClass === "non_financial") return "non_financial_valued";
  return FINANCIAL_VALUE_CLASSES.includes(b.valueClass) ? b.valueClass : null;
}

/** Whether a line of a benefit enters its Finance line: an open overlap holds back validated and sustained values. */
function entersLine(b: ValueBenefitFact, state: string): boolean {
  return !(b.overlapOpen && (state === "validated" || state === "sustained"));
}

/**
 * The class × state × currency lines (pure). `lines` must already be narrowed to the benefits of `benefits` (owner,
 * scope). Every class with at least one counted, monetised benefit in a currency gets all seven states; an empty state
 * is a known zero (ADR-0030 §7 item 7), a missing amount is Unknown.
 */
export function financeClassLines(
  benefits: readonly ValueBenefitFact[],
  lines: readonly ValueLineFact[],
  clock: DashboardClock,
): Omit<FinanceValueLine, "drilldownHref">[] {
  const byId = new Map(benefits.map((b) => [b.benefitId, b]));
  const out: Omit<FinanceValueLine, "drilldownHref">[] = [];
  const currencies = [...new Set(benefits.filter((b) => financeClassOf(b) !== null).map((b) => b.currency))].sort();
  for (const currency of currencies) {
    const mine = benefits.filter((b) => b.currency === currency && financeClassOf(b) !== null);
    for (const valueClass of FINANCE_LINE_CLASSES) {
      if (!mine.some((b) => financeClassOf(b) === valueClass)) continue;
      for (const state of FINANCE_LINE_STATES) {
        const amounts = lines
          .filter((l) => {
            const b = byId.get(l.benefitId);
            return (
              b !== undefined &&
              l.state === state &&
              b.currency === currency &&
              financeClassOf(b) === valueClass &&
              entersLine(b, state) &&
              lineInWindow(l, state, clock)
            );
          })
          .map((l) => l.amount);
        out.push({
          valueClass,
          state,
          currency,
          total: sumValue(amounts, currency, "currency", "benefit.value_amount_missing"),
        });
      }
    }
  }
  return out;
}

/** a − b for dashboard values of one currency (exact); Unknown when either is Unknown (the first reason wins). */
export function subtractValues(a: DashboardValue, b: DashboardValue, currency: string): DashboardValue {
  if (a.value === null || a.state === "unknown" || a.state === "not_applicable")
    return unknownValue(a.reasonKey ?? "benefit.value_amount_missing", "currency", currency);
  if (b.value === null || b.state === "unknown" || b.state === "not_applicable")
    return unknownValue(b.reasonKey ?? "benefit.cost_amount_missing", "currency", currency);
  return sumValue(
    [new D(a.value).minus(new D(b.value)).toFixed()],
    currency,
    "currency",
    "benefit.value_amount_missing",
  );
}

/** The implementation cost of each currency (each investment line once; a NULL amount makes it Unknown). */
export function investmentByCurrency(ctx: DashboardContext): Map<string, DashboardValue> {
  const out = new Map<string, DashboardValue>();
  for (const currency of [...new Set(ctx.facts.investment.map((l) => l.currency))].sort())
    out.set(
      currency,
      sumValue(
        ctx.facts.investment.filter((l) => l.currency === currency).map((l) => l.amount),
        currency,
        "currency",
        "benefit.cost_amount_missing",
      ),
    );
  return out;
}

/** The gross and net lines (ADR-0030 §7 item 6) from the Value area result and the investment lines. */
export function grossNetLines(
  ctx: DashboardContext,
  value: ValueResult,
  hrefOf: (metric: "value.planned" | "value.validated") => string,
): FinanceValueLine[] {
  const out: FinanceValueLine[] = [];
  const cost = investmentByCurrency(ctx);
  const grossOf = new Map(value.currencies.map((c) => [c.currency, c]));
  for (const c of value.currencies) {
    out.push({
      valueClass: "gross",
      state: "planned",
      currency: c.currency,
      total: c.planned,
      drilldownHref: hrefOf("value.planned"),
    });
    out.push({
      valueClass: "gross",
      state: "validated",
      currency: c.currency,
      total: c.validated,
      drilldownHref: hrefOf("value.validated"),
    });
  }
  // Net needs the implementation cost; under an owner filter the investment lines (which have no owner) are left out.
  if (ctx.filters.ownerUserId !== null) return out;
  const currencies = [...new Set([...grossOf.keys(), ...cost.keys()])].sort();
  for (const currency of currencies) {
    const zero = sumValue([], currency, "currency", "benefit.value_amount_missing");
    const g = grossOf.get(currency);
    const k = cost.get(currency) ?? zero;
    for (const state of ["planned", "validated"] as const) {
      const gross = g === undefined ? zero : state === "planned" ? g.planned : g.validated;
      out.push({ valueClass: "net", state, currency, total: subtractValues(gross, k, currency), drilldownHref: null });
    }
  }
  return out;
}

/** The states a value drill-down metric exists for (the others' lines have no drill-down of their own). */
const DRILL_METRIC_OF: ReadonlyMap<
  FinanceLineState,
  "value.planned" | "value.forecast" | "value.submitted" | "value.validated"
> = new Map([
  ["planned", "value.planned"],
  ["forecast", "value.forecast"],
  ["submitted", "value.submitted"],
  ["validated", "value.validated"],
]);

/** The measured, rejected and sustained lines of the scope (benefit_value_line, ADR-0030 §6), read-only. */
async function loadExtraStateLines(db: DbOrTx, transformationIds: readonly string[]): Promise<ValueLineFact[]> {
  if (transformationIds.length === 0) return [];
  const rows = await db
    .selectFrom("benefit_value_line")
    .select([
      "benefit_id",
      "transformation_id",
      "value_state",
      "amount",
      "currency",
      "period_start",
      "period_end",
      "record_table",
      "record_id",
    ])
    .where("transformation_id", "in", [...transformationIds])
    .where("value_state", "in", [...EXTRA_STATES])
    .orderBy("benefit_id")
    .orderBy("record_id")
    .execute();
  // View columns are typed nullable; benefit_id, value_state, currency, record_* are never NULL in 0039.
  return rows.map((r) => ({
    benefitId: r.benefit_id!,
    transformationId: r.transformation_id!,
    state: r.value_state!,
    amount: r.amount,
    currency: r.currency!.trim(),
    periodStart: r.period_start,
    periodEnd: r.period_end,
    recordTable: r.record_table!,
    recordId: r.record_id!,
  }));
}

/** The submitted measurements awaiting Finance (the `finance.pending_validation` drill-down's records). */
export function pendingValidationCount(ctx: DashboardContext): number {
  const ids = new Set(ctx.facts.benefits.map((b) => b.benefitId));
  return ctx.facts.lines.filter((l) => l.state === "submitted" && ids.has(l.benefitId)).length;
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerFinanceDashboardRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    FINANCE_DASHBOARD,
    { config: { access: { permission: "transformation.read" } } },
    async (request): Promise<FinanceDashboard> => {
      const query = parseQuery(financeQuery, request.query);
      const transformationIds = asIdList(query.transformationId);
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
        const results = computeAreas(ctx.facts, ctx.clock, ctx.policy);
        const areas = presentAreas(ctx, results, await loadAreaDefinitions(tx), {
          drillTransformationIds: transformationIds,
          workstream: false,
        });
        const hrefOf = (metric: string) => drilldownHref(metric, filters, { transformationIds });
        const kept = new Set(ctx.facts.benefits.map((b) => b.benefitId));
        const extra = (
          await loadExtraStateLines(
            tx,
            scope.map((t) => t.id),
          )
        ).filter((l) => kept.has(l.benefitId));
        const raw = financeClassLines(ctx.facts.benefits, [...ctx.facts.lines, ...extra], ctx.clock);
        const classLines = raw.map((l): FinanceValueLine => {
          // A class line drills to its state's value drill-down only when it IS that state's whole figure in its
          // currency (the only financial class there), so the drill-down's decimal sum equals the line (ADR-0037 §5).
          // Otherwise its records are a subset of that drill-down, and it carries no href (a contract need: the
          // drill-down has no value-class parameter; see the handback).
          const metric = DRILL_METRIC_OF.get(l.state);
          const financialClasses = new Set(
            raw
              .filter((x) => x.currency === l.currency && FINANCIAL_VALUE_CLASSES.includes(x.valueClass))
              .map((x) => x.valueClass),
          );
          const whole =
            metric !== undefined && FINANCIAL_VALUE_CLASSES.includes(l.valueClass) && financialClasses.size === 1;
          return { ...l, drilldownHref: whole ? hrefOf(metric) : null };
        });
        const pending = pendingValidationCount(ctx);
        const valueArea = areas.find((a) => a.code === "value")!;
        return {
          organizationId: query.organizationId,
          generatedAt: ctx.generatedAt,
          businessDate: filters.businessDate,
          appliedFilters: appliedFilters(filters),
          lines: [...classLines, ...grossNetLines(ctx, results.value, hrefOf)],
          headlines: [
            ...valueArea.headlines,
            {
              metric: "finance.pending_validation",
              labelKey: "dashboard.finance.pending_validation",
              value: countValue(pending, "measurement"),
              period: {
                start: filters.windowStart,
                end: filters.windowEnd,
                asOf: filters.asOf,
                label: filters.period?.label ?? null,
              },
              drilldownHref: hrefOf("finance.pending_validation"),
            },
          ],
          pendingValidationCount: pending,
          nonFinancialCount: ctx.facts.benefits.filter((b) => b.counted && b.unmonetised).length,
          transformations: scope.map((t) => ({
            transformationId: t.id,
            code: t.code,
            name: t.name,
            areaStatuses: areaStatuses(computeAreas(factsOfTransformation(ctx.facts, t.id), ctx.clock, ctx.policy)),
          })),
        };
      });
    },
  );
  return [`GET ${FINANCE_DASHBOARD}`];
}
