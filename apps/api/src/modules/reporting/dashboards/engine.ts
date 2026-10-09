// The dashboard read model (ADR-0037 §1-§5; REQ-PB-062, REQ-PB-063, REQ-PB-064, REQ-S03-009, REQ-S13-001..003):
// load the facts of the readable transformations ONCE per request (through the views and the engine modules'
// dashboard-facts exports), narrow them by the filters, compute the six areas with the pure rules of areas.ts, and
// present them in the T10Area shape with the seeded bilingual labels of `t10_area_definition`.
//
// Nothing is stored: no table, cache or snapshot holds a figure or a RAG status, so the next read after a commit (an
// accepted KPI actual, a recorded decision) shows it. No advisory lock is taken. Every query is constrained by the
// transformation ids of the readable set (scope.ts); workstream rows are reached only through their transformation.
import { sql, type Db, type DbOrTx, type Tx } from "@mth/db";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import type {
  DashboardHeadline,
  DashboardItem,
  DashboardValue,
  RagStatus,
  T10Area,
  T10AreaCode,
} from "@mth/shared/schemas";
import { loadAdoptionDashboardIndicators } from "../../adoption/index.ts";
import { loadBenefitDashboardFacts } from "../../benefits/index.ts";
import { loadKpiDashboardStatuses, loadOutcomeRows, type KpiStatusRequest } from "../../kpi/index.ts";
import {
  loadCriticalPathFlags,
  loadDefaultWorkingCalendar,
  loadPortfolioDashboardInitiatives,
} from "../../portfolio/index.ts";
import {
  adoptionArea,
  countValue,
  decisionOverdue,
  decisionsArea,
  dependenciesArea,
  FINANCIAL_VALUE_CLASSES,
  kpiActualValue,
  kpiRowStatus,
  knownValue,
  MONEY_SCALE,
  notApplicableValue,
  outcomesArea,
  portfolioArea,
  unknownValue,
  valueArea,
  WORKSTREAM_NOT_APPLICABLE,
  type AdoptionIndicatorFact,
  type AdoptionResult,
  type AreaRag,
  type DashboardClock,
  type DashboardPolicy,
  type DecisionFact,
  type DecisionsResult,
  type DependenciesResult,
  type DependencyFact,
  type InitiativeFact,
  type InvestmentLineFact,
  type KpiStatusFact,
  type OutcomeFact,
  type OutcomesResult,
  type PortfolioResult,
  type ValueBenefitFact,
  type ValueLineFact,
  type ValueResult,
} from "./areas.ts";
import { clockOf, drilldownHref, type ResolvedFilters } from "./filters.ts";
import { loadDashboardPolicy } from "./rag-policy.ts";
import type { ScopeTransformation } from "./scope.ts";

/**
 * Runs a dashboard read in its own READ ONLY transaction (ADR-0037 §1 "computed in the request's read-only
 * transaction"): one consistent snapshot of every fact, and any write would fail, so no figure can be stored.
 */
export function readOnly<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().setAccessMode("read only").execute(fn);
}

// ------------------------------------------------------------------------------------------------ facts

export interface DependencyRowFact extends DependencyFact {
  readonly fromInitiativeId: string | null;
}

export interface AllocationFact {
  readonly benefitId: string;
  readonly initiativeId: string;
  readonly share: string;
}

export interface DashboardFacts {
  readonly outcomes: readonly OutcomeFact[];
  readonly benefits: readonly ValueBenefitFact[];
  readonly lines: readonly ValueLineFact[];
  readonly investment: readonly InvestmentLineFact[];
  readonly allocations: readonly AllocationFact[];
  readonly initiatives: readonly InitiativeFact[];
  readonly dependencies: readonly DependencyRowFact[];
  readonly decisions: readonly DecisionFact[];
  readonly indicators: readonly AdoptionIndicatorFact[];
}

export interface DashboardContext {
  readonly facts: DashboardFacts;
  readonly clock: DashboardClock;
  readonly policy: DashboardPolicy;
  readonly filters: ResolvedFilters;
  readonly generatedAt: string;
}

const statusKey = (r: KpiStatusRequest) => `${r.kpiDefinitionId}:${r.scopeKind}:${r.scopeId}`;

async function dbNow(db: DbOrTx): Promise<Date> {
  const r = await sql<{ now: Date }>`SELECT now() AS now`.execute(db);
  return r.rows[0]!.now;
}

/** An Unknown KPI status for a request the status service could not answer (a KPI that no longer exists). */
function missingStatus(kpiDefinitionId: string): KpiStatusFact {
  return {
    kpiDefinitionId,
    kpiName: "",
    ownerUserId: null,
    displayedRag: "unknown",
    calculatedRag: "unknown",
    overridden: false,
    actual: null,
    actualStatus: "unknown",
    actualReason: "kpi.no_active_version",
    unit: null,
    currency: null,
    reportingPeriodId: null,
    periodLabel: null,
    evaluationId: null,
    calculationRunId: null,
  };
}

/** Loads every fact of the readable transformations (one pass; read-only). */
export async function loadDashboardContext(
  db: DbOrTx,
  scope: readonly ScopeTransformation[],
  filters: ResolvedFilters,
): Promise<DashboardContext> {
  const organizationId = filters.organizationId;
  const ids = scope.map((t) => t.id);
  const currencyOf = new Map(scope.map((t) => [t.id, t.currency]));
  const now = await dbNow(db);
  const policy = await loadDashboardPolicy(db, organizationId);
  const calendar = await loadDefaultWorkingCalendar(db, organizationId);
  const clock = clockOf(filters, calendar);

  // KPI statuses (slice A status service) of the outcome KPIs and the adoption indicators.
  const outcomeRows = await loadOutcomeRows(db, ids);
  const indicatorRows = await loadAdoptionDashboardIndicators(db, ids);
  const requests: KpiStatusRequest[] = [
    ...outcomeRows.flatMap((o) =>
      o.kpis.map((k) => ({
        kpiDefinitionId: k.kpiDefinitionId,
        scopeKind: "transformation",
        scopeId: o.transformationId,
      })),
    ),
    ...indicatorRows.map((i) => ({ kpiDefinitionId: i.kpiDefinitionId, scopeKind: i.scopeKind, scopeId: i.scopeId })),
  ];
  const period = filters.period
    ? {
        id: filters.period.id,
        frequency: filters.period.frequency,
        start: filters.period.start,
        end: filters.period.end,
      }
    : null;
  const statuses = await loadKpiDashboardStatuses(db, organizationId, requests, period, now, filters.businessDate);
  const statusOf = (r: KpiStatusRequest): KpiStatusFact =>
    statuses.get(statusKey(r)) ?? missingStatus(r.kpiDefinitionId);
  const outcomes: OutcomeFact[] = outcomeRows.map((o) => ({
    outcomeId: o.outcomeId,
    transformationId: o.transformationId,
    statement: o.statement,
    ownerUserId: o.ownerUserId,
    kpis: o.kpis.map((k) => ({
      outcomeKpiId: k.outcomeKpiId,
      ownerUserId: k.ownerUserId,
      status: statusOf({
        kpiDefinitionId: k.kpiDefinitionId,
        scopeKind: "transformation",
        scopeId: o.transformationId,
      }),
    })),
  }));
  const indicators: AdoptionIndicatorFact[] = indicatorRows.map((i) => ({
    metricLinkId: i.metricLinkId,
    transformationId: i.transformationId,
    templateKey: i.templateKey,
    targetKind: i.targetKind,
    status: statusOf(i),
  }));

  // Benefits (slice B counting rules) and the planned value allocated to each initiative.
  const b = await loadBenefitDashboardFacts(db, ids);
  const benefitById = new Map(b.benefits.map((x) => [x.benefitId, x]));
  const plannedOf = new Map<string, InstanceType<typeof D>>();
  for (const l of b.lines) {
    const ben = benefitById.get(l.benefitId);
    if (l.state !== "planned" || l.amount === null || !ben || !ben.counted || ben.unmonetised) continue;
    if (!FINANCIAL_VALUE_CLASSES.includes(ben.valueClass)) continue;
    if (ben.currency !== currencyOf.get(ben.transformationId)) continue;
    plannedOf.set(l.benefitId, (plannedOf.get(l.benefitId) ?? new D(0)).plus(new D(l.amount)));
  }
  const allocatedOf = new Map<string, InstanceType<typeof D>>();
  for (const a of b.allocations) {
    const p = plannedOf.get(a.benefitId);
    if (p === undefined) continue;
    allocatedOf.set(a.initiativeId, (allocatedOf.get(a.initiativeId) ?? new D(0)).plus(p.times(new D(a.share))));
  }
  const initiativeRows = await loadPortfolioDashboardInitiatives(db, ids);
  const initiatives: InitiativeFact[] = initiativeRows.map((i) => ({
    ...i,
    // planned × share can carry 10 fraction digits: presented (and ranked) at the money scale, half-even.
    plannedAllocated:
      allocatedOf.get(i.initiativeId)?.toDecimalPlaces(MONEY_SCALE, D.ROUND_HALF_EVEN).toFixed() ?? null,
    plannedCurrency: currencyOf.get(i.transformationId) ?? null,
  }));

  // Decisions (the T16 view) and dependencies (the RAID register view with the dependency's links).
  const decisionRows =
    ids.length === 0
      ? []
      : await db
          .selectFrom("executive_decision_log")
          .select([
            "id",
            "transformation_id",
            "t16_id",
            "decision",
            "owner_user_id",
            "decision_date",
            "status",
            "impact_of_delay",
          ])
          .where("transformation_id", "in", ids)
          .where("status", "in", ["open", "deferred"])
          .orderBy("decision_date")
          .orderBy("id")
          .execute();
  const decisions: DecisionFact[] = decisionRows.map((d) => ({
    decisionId: d.id!,
    transformationId: d.transformation_id!,
    code: d.t16_id ?? "",
    title: d.decision ?? "",
    ownerUserId: d.owner_user_id,
    dueDate: d.decision_date,
    status: d.status!,
    impactOfDelay: d.impact_of_delay,
  }));
  const overdueDecisionIds = new Set(
    decisions.filter((d) => decisionOverdue(d, filters.businessDate)).map((d) => d.decisionId),
  );
  const dependencyRows =
    ids.length === 0
      ? []
      : await db
          .selectFrom("raid_register as r")
          .innerJoin("dependency as d", "d.id", "r.id")
          .select([
            "r.id",
            "r.transformation_id",
            "r.code",
            "r.description",
            "r.owner_user_id",
            "r.due_date",
            "r.record_status",
            "d.decision_id",
            "d.from_initiative_id",
            "d.to_initiative_id",
          ])
          .where("r.record_table", "=", "dependency")
          .where("r.raid_status", "=", "open")
          .where("r.transformation_id", "in", ids)
          .orderBy("r.due_date")
          .orderBy("r.id")
          .execute();
  const critical = await loadCriticalPathFlags(
    db,
    dependencyRows
      .filter((d) => d.to_initiative_id !== null)
      .map((d) => ({ initiativeId: d.to_initiative_id!, transformationId: d.transformation_id! })),
  );
  const dependencies: DependencyRowFact[] = dependencyRows.map((d) => ({
    dependencyId: d.id!,
    transformationId: d.transformation_id!,
    code: d.code ?? "",
    description: d.description ?? "",
    ownerUserId: d.owner_user_id,
    neededBy: d.due_date,
    status: d.record_status!,
    decisionId: d.decision_id,
    decisionOverdue: d.decision_id !== null && overdueDecisionIds.has(d.decision_id),
    targetInitiativeId: d.to_initiative_id,
    fromInitiativeId: d.from_initiative_id,
    onCriticalPath: d.to_initiative_id === null ? null : (critical.get(d.to_initiative_id) ?? null),
  }));

  const facts: DashboardFacts = {
    outcomes,
    benefits: b.benefits,
    lines: b.lines,
    investment: b.investment,
    allocations: b.allocations,
    initiatives,
    dependencies,
    decisions,
    indicators,
  };
  return {
    facts: narrowByFilters(facts, filters),
    clock,
    policy,
    filters,
    generatedAt: now.toISOString(),
  };
}

// ------------------------------------------------------------------------------------------------ narrowing (pure)

const inWindow = (date: string | null, f: { windowStart: string | null; windowEnd: string | null }) =>
  f.windowStart === null || f.windowEnd === null || (date !== null && date >= f.windowStart && date <= f.windowEnd);

/**
 * The owner filter (ADR-0037 §4: outcome and outcome-KPI owner, KPI owner, benefit owner, initiative executive owner
 * or workstream lead, dependency owner, decision owner) and the period window of decisions and dependencies.
 */
export function narrowByFilters(
  facts: DashboardFacts,
  f: { ownerUserId: string | null; windowStart: string | null; windowEnd: string | null },
): DashboardFacts {
  const owner = f.ownerUserId;
  const outcomes =
    owner === null
      ? facts.outcomes
      : facts.outcomes
          .map((o) =>
            o.ownerUserId === owner
              ? o
              : { ...o, kpis: o.kpis.filter((k) => k.ownerUserId === owner || k.status.ownerUserId === owner) },
          )
          .filter((o) => o.ownerUserId === owner || o.kpis.length > 0);
  const benefits = owner === null ? facts.benefits : facts.benefits.filter((b) => b.ownerUserId === owner);
  const kept = new Set(benefits.map((b) => b.benefitId));
  return {
    outcomes,
    benefits,
    lines: facts.lines.filter((l) => kept.has(l.benefitId)),
    investment: owner === null ? facts.investment : [],
    allocations: facts.allocations.filter((a) => kept.has(a.benefitId)),
    initiatives:
      owner === null
        ? facts.initiatives
        : facts.initiatives.filter((i) => i.executiveOwnerUserId === owner || i.workstreamLeadUserId === owner),
    dependencies: facts.dependencies.filter(
      (d) => (owner === null || d.ownerUserId === owner) && inWindow(d.neededBy, f),
    ),
    decisions: facts.decisions.filter((d) => (owner === null || d.ownerUserId === owner) && inWindow(d.dueDate, f)),
    indicators: owner === null ? facts.indicators : facts.indicators.filter((i) => i.status.ownerUserId === owner),
  };
}

/** The facts of one transformation (the per-transformation rows of the overview). */
export function factsOfTransformation(facts: DashboardFacts, transformationId: string): DashboardFacts {
  const of = <T extends { transformationId: string }>(xs: readonly T[]) =>
    xs.filter((x) => x.transformationId === transformationId);
  const benefits = of(facts.benefits);
  const kept = new Set(benefits.map((b) => b.benefitId));
  return {
    outcomes: of(facts.outcomes),
    benefits,
    lines: of(facts.lines),
    investment: of(facts.investment),
    allocations: facts.allocations.filter((a) => kept.has(a.benefitId)),
    initiatives: of(facts.initiatives),
    dependencies: of(facts.dependencies),
    decisions: of(facts.decisions),
    indicators: of(facts.indicators),
  };
}

/**
 * The facts of a workstream (ADR-0037 §2): its active initiatives, the outcomes they contribute to, the benefits
 * allocated to them (each counted once), the dependencies to or from them. Decisions and People & adoption are
 * transformation-level (not_applicable on this dashboard).
 */
export function factsOfWorkstream(facts: DashboardFacts, initiativeIds: readonly string[]): DashboardFacts {
  const mine = new Set(initiativeIds);
  const initiatives = facts.initiatives.filter((i) => mine.has(i.initiativeId));
  const outcomeIds = new Set(initiatives.flatMap((i) => i.outcomeIds));
  const allocations = facts.allocations.filter((a) => mine.has(a.initiativeId));
  const benefitIds = new Set(allocations.map((a) => a.benefitId));
  return {
    outcomes: facts.outcomes.filter((o) => outcomeIds.has(o.outcomeId)),
    benefits: facts.benefits.filter((b) => benefitIds.has(b.benefitId)),
    lines: facts.lines.filter((l) => benefitIds.has(l.benefitId)),
    investment: [],
    allocations,
    initiatives,
    dependencies: facts.dependencies.filter(
      (d) =>
        (d.targetInitiativeId !== null && mine.has(d.targetInitiativeId)) ||
        (d.fromInitiativeId !== null && mine.has(d.fromInitiativeId)),
    ),
    decisions: [],
    indicators: [],
  };
}

// ------------------------------------------------------------------------------------------------ computing (pure)

export interface AreaResults {
  readonly outcomes: OutcomesResult;
  readonly value: ValueResult;
  readonly portfolio: PortfolioResult;
  readonly dependencies: DependenciesResult;
  readonly decisions: DecisionsResult;
  readonly adoption: AdoptionResult;
}

export function computeAreas(facts: DashboardFacts, clock: DashboardClock, policy: DashboardPolicy): AreaResults {
  const outcomes = outcomesArea(facts.outcomes);
  const outcomeStatuses = new Map(outcomes.outcomes.map((r) => [r.fact.outcomeId, r.status]));
  return {
    outcomes,
    value: valueArea(facts.benefits, facts.lines, clock, policy.values),
    portfolio: portfolioArea(facts.initiatives, outcomeStatuses, clock, policy.values),
    dependencies: dependenciesArea(facts.dependencies, clock, policy.values),
    decisions: decisionsArea(facts.decisions, clock, policy.values),
    adoption: adoptionArea(facts.indicators),
  };
}

/** The six area statuses of a result set, in Template 10 order (workstream: Decisions and adoption n/a). */
export function areaStatuses(r: AreaResults, workstream = false): { code: T10AreaCode; status: RagStatus }[] {
  return [
    { code: "outcomes", status: r.outcomes.rag.status },
    { code: "value", status: r.value.rag.status },
    { code: "portfolio", status: r.portfolio.rag.status },
    { code: "dependencies", status: r.dependencies.rag.status },
    { code: "decisions", status: workstream ? "not_applicable" : r.decisions.rag.status },
    { code: "people_adoption", status: workstream ? "not_applicable" : r.adoption.rag.status },
  ];
}

// ------------------------------------------------------------------------------------------------ presenting

export const T_PATH = (t: string) => `/api/v1/transformations/${t}`;
export const kpiStatusHref = (t: string, kpi: string) => `${T_PATH(t)}/kpi-definitions/${kpi}/status`;

export interface AreaDefinition {
  readonly code: T10AreaCode;
  readonly ordinal: number;
  readonly sourceAreaEn: string;
  readonly areaAr: string;
  readonly sourceWhatToShowEn: string;
  readonly whatToShowAr: string;
  readonly sourceRagLogicEn: string;
  readonly ragLogicAr: string;
  readonly arProvisional: boolean;
}

/** The six seeded area rows (B0095 verbatim; Arabic provisional), in Template 10 order. */
export async function loadAreaDefinitions(db: DbOrTx): Promise<AreaDefinition[]> {
  const rows = await db.selectFrom("t10_area_definition").selectAll().orderBy("ordinal").execute();
  return rows.map((r) => ({
    code: r.code as T10AreaCode,
    ordinal: r.ordinal,
    sourceAreaEn: r.source_area_en,
    areaAr: r.area_ar,
    sourceWhatToShowEn: r.source_what_to_show_en,
    whatToShowAr: r.what_to_show_ar,
    sourceRagLogicEn: r.source_rag_logic_en,
    ragLogicAr: r.rag_logic_ar,
    arProvisional: r.ar_provisional,
  }));
}

interface PresentOptions {
  /** The transformation ids the drill-down links carry (the response's scope). */
  readonly drillTransformationIds: readonly string[];
  readonly workstream: boolean;
}

function headline(
  ctx: DashboardContext,
  o: PresentOptions,
  metric: DashboardHeadline["metric"],
  labelKey: string,
  value: DashboardValue,
): DashboardHeadline {
  return {
    metric,
    labelKey,
    value,
    period: {
      start: ctx.filters.windowStart,
      end: ctx.filters.windowEnd,
      asOf: ctx.filters.asOf,
      label: ctx.filters.period?.label ?? null,
    },
    drilldownHref: drilldownHref(metric, ctx.filters, { transformationIds: o.drillTransformationIds }),
  };
}

function item(x: Partial<DashboardItem> & Pick<DashboardItem, "recordType" | "recordId" | "href">): DashboardItem {
  return {
    code: null,
    label: null,
    rag: null,
    dueDate: null,
    value: null,
    ownerUserId: null,
    flags: [],
    ...x,
  };
}

/** The validated-to-date value of one benefit (its eligible lines), the Value list's item value. */
function benefitValidated(ctx: DashboardContext, b: ValueBenefitFact): DashboardValue {
  if (!FINANCIAL_VALUE_CLASSES.includes(b.valueClass) || b.unmonetised)
    return notApplicableValue("benefit.non_financial", "currency");
  if (!b.counted) return notApplicableValue("benefit.not_counted", "currency");
  const lines = ctx.facts.lines.filter(
    (l) =>
      l.benefitId === b.benefitId &&
      l.state === "validated" &&
      l.periodEnd !== null &&
      l.periodEnd <= ctx.clock.asOf &&
      (ctx.clock.windowStart === null || l.periodEnd >= ctx.clock.windowStart),
  );
  if (b.overlapOpen) return unknownValue("benefit.overlap_open", "currency", b.currency);
  if (lines.some((l) => l.amount === null)) return unknownValue("benefit.value_amount_missing", "currency", b.currency);
  return knownValue(lines.reduce((acc, l) => acc.plus(new D(l.amount!)), new D(0)).toFixed(), "currency", b.currency);
}

/** The six areas in the T10Area shape (REQ-PB-062: every area has every member, with both languages' labels). */
export function presentAreas(
  ctx: DashboardContext,
  r: AreaResults,
  defs: readonly AreaDefinition[],
  o: PresentOptions,
): T10Area[] {
  const src = ctx.policy.source;
  const rag = (a: AreaRag) => ({ status: a.status, ruleKey: a.ruleKey, ruleParams: a.ruleParams, policySource: src });
  const byCode = new Map<T10AreaCode, { rag: AreaRag; headlines: DashboardHeadline[]; items: DashboardItem[] }>();

  // Outcomes: each outcome with its combined status, then each outcome KPI with its actual (shown once).
  byCode.set("outcomes", {
    rag: r.outcomes.rag,
    headlines: [
      headline(
        ctx,
        o,
        "outcomes.area",
        "dashboard.headline.outcome_kpis",
        countValue(
          r.outcomes.outcomes.reduce((n, x) => n + x.fact.kpis.length, 0),
          "outcome_kpi",
        ),
      ),
    ],
    items: r.outcomes.outcomes.flatMap((row) => [
      item({
        recordType: "outcome",
        recordId: row.fact.outcomeId,
        label: row.fact.statement,
        href: `${T_PATH(row.fact.transformationId)}/outcomes/${row.fact.outcomeId}`,
        rag: row.status,
        ownerUserId: row.fact.ownerUserId,
        flags: [...row.flags],
      }),
      ...row.fact.kpis.map((k) =>
        item({
          recordType: "outcome_kpi",
          recordId: k.outcomeKpiId,
          code: k.status.periodLabel,
          label: k.status.kpiName,
          href: kpiStatusHref(row.fact.transformationId, k.status.kpiDefinitionId),
          rag: kpiRowStatus(k.status),
          value: kpiActualValue(k.status),
          ownerUserId: k.ownerUserId ?? k.status.ownerUserId,
          flags: [`calculated_${k.status.calculatedRag}`, ...(k.status.overridden ? ["override_in_force"] : [])],
        }),
      ),
    ]),
  });

  // Value: per currency planned, forecast, submitted, validated, gap and investment; each benefit with its validated.
  const valueHeadlines: DashboardHeadline[] = [];
  for (const c of r.value.currencies) {
    valueHeadlines.push(headline(ctx, o, "value.planned", "dashboard.headline.value_planned", c.planned));
    valueHeadlines.push(headline(ctx, o, "value.forecast", "dashboard.headline.value_forecast", c.forecast));
    valueHeadlines.push(headline(ctx, o, "value.submitted", "dashboard.headline.value_submitted", c.submitted));
    valueHeadlines.push(headline(ctx, o, "value.validated", "dashboard.headline.value_validated", c.validated));
    valueHeadlines.push(
      headline(
        ctx,
        o,
        "value.gap",
        "dashboard.headline.value_gap",
        c.gapRatio === null
          ? c.status === "unknown"
            ? unknownValue(c.reasonKey ?? "benefit.value_amount_missing", "ratio", c.currency)
            : notApplicableValue(c.reasonKey ?? "dashboard.value.nothing_planned", "ratio")
          : { ...knownValue(c.gapRatio, "ratio", c.currency) },
      ),
    );
  }
  if (r.value.currencies.length === 0)
    valueHeadlines.push(
      headline(
        ctx,
        o,
        "value.validated",
        "dashboard.headline.value_validated",
        notApplicableValue("dashboard.value.no_financial_benefit", "currency"),
      ),
    );
  for (const currency of [...new Set(ctx.facts.investment.map((l) => l.currency))].sort()) {
    const amounts = ctx.facts.investment.filter((l) => l.currency === currency).map((l) => l.amount);
    valueHeadlines.push(
      headline(
        ctx,
        o,
        "value.investment",
        "dashboard.headline.value_investment",
        amounts.some((a) => a === null)
          ? unknownValue("benefit.cost_amount_missing", "currency", currency)
          : knownValue(amounts.reduce((acc, a) => acc.plus(new D(a!)), new D(0)).toFixed(), "currency", currency),
      ),
    );
  }
  byCode.set("value", {
    rag: r.value.rag,
    headlines: valueHeadlines,
    items: ctx.facts.benefits.map((b) =>
      item({
        recordType: "benefit",
        recordId: b.benefitId,
        code: b.code,
        label: b.title,
        href: `${T_PATH(b.transformationId)}/benefits/${b.benefitId}`,
        value: benefitValidated(ctx, b),
        ownerUserId: b.ownerUserId,
        flags: [
          ...(b.unmonetised || !FINANCIAL_VALUE_CLASSES.includes(b.valueClass) ? ["non_financial"] : []),
          ...(b.counted ? [] : ["not_counted"]),
          ...(b.overlapOpen ? ["overlap_open"] : []),
        ],
      }),
    ),
  });

  byCode.set("portfolio", {
    rag: r.portfolio.rag,
    headlines: [
      headline(
        ctx,
        o,
        "portfolio.initiatives",
        "dashboard.headline.top_initiatives",
        countValue(r.portfolio.initiatives.length, "initiative"),
      ),
    ],
    items: r.portfolio.initiatives.map((row) =>
      item({
        recordType: "initiative",
        recordId: row.fact.initiativeId,
        code: row.fact.code,
        label: row.fact.name,
        href: `/api/v1/initiatives/${row.fact.initiativeId}`,
        rag: row.status,
        value:
          row.fact.plannedAllocated === null
            ? unknownValue("dashboard.portfolio.no_allocated_value", "currency", row.fact.plannedCurrency)
            : knownValue(row.fact.plannedAllocated, "currency", row.fact.plannedCurrency),
        ownerUserId: row.fact.executiveOwnerUserId ?? row.fact.workstreamLeadUserId,
        flags: [...row.flags],
      }),
    ),
  });

  byCode.set("dependencies", {
    rag: r.dependencies.rag,
    headlines: [
      headline(
        ctx,
        o,
        "dependencies.open",
        "dashboard.headline.open_dependencies",
        countValue(r.dependencies.dependencies.length, "dependency"),
      ),
    ],
    items: r.dependencies.dependencies.map((row) =>
      item({
        recordType: "dependency",
        recordId: row.fact.dependencyId,
        code: row.fact.code,
        label: row.fact.description,
        href: `${T_PATH(row.fact.transformationId)}/dependencies/${row.fact.dependencyId}`,
        rag: row.status,
        dueDate: row.fact.neededBy,
        ownerUserId: row.fact.ownerUserId,
        flags: [...row.flags],
      }),
    ),
  });

  const decisionItems = (rows: DecisionsResult["decisions"]) =>
    rows.map((row) =>
      item({
        recordType: "executive_decision",
        recordId: row.fact.decisionId,
        code: row.fact.code,
        label: row.fact.title,
        href: `${T_PATH(row.fact.transformationId)}/executive-decisions/${row.fact.decisionId}`,
        rag: row.status,
        dueDate: row.fact.dueDate,
        ownerUserId: row.fact.ownerUserId,
        flags: [...row.flags],
      }),
    );
  byCode.set(
    "decisions",
    o.workstream
      ? { rag: WORKSTREAM_NOT_APPLICABLE, headlines: [], items: [] }
      : {
          rag: r.decisions.rag,
          headlines: [
            headline(
              ctx,
              o,
              "decisions.open",
              "dashboard.headline.open_decisions",
              countValue(r.decisions.decisions.length, "decision"),
            ),
            headline(
              ctx,
              o,
              "decisions.overdue",
              "dashboard.headline.overdue_decisions",
              countValue(r.decisions.overdueCount, "decision"),
            ),
          ],
          // Overdue asks first (REQ-PB-064 "lists the overdue item"), then by due date.
          items: decisionItems(
            [...r.decisions.decisions].sort(
              (a, b) =>
                Number(b.flags.includes("overdue")) - Number(a.flags.includes("overdue")) ||
                (a.fact.dueDate ?? "9999-12-31").localeCompare(b.fact.dueDate ?? "9999-12-31"),
            ),
          ),
        },
  );

  byCode.set(
    "people_adoption",
    o.workstream
      ? { rag: WORKSTREAM_NOT_APPLICABLE, headlines: [], items: [] }
      : {
          rag: r.adoption.rag,
          headlines: [
            headline(
              ctx,
              o,
              "adoption.indicators",
              "dashboard.headline.adoption_indicators",
              countValue(r.adoption.indicators.length, "indicator"),
            ),
          ],
          items: r.adoption.indicators.map((row) =>
            item({
              recordType: "adoption_metric_link",
              recordId: row.fact.metricLinkId,
              code: row.fact.templateKey,
              label: row.fact.status.kpiName,
              href: kpiStatusHref(row.fact.transformationId, row.fact.status.kpiDefinitionId),
              rag: row.status,
              value: kpiActualValue(row.fact.status),
              ownerUserId: row.fact.status.ownerUserId,
              flags: [...row.flags, `target_${row.fact.targetKind}`],
            }),
          ),
        },
  );

  return defs.map((d) => {
    const a = byCode.get(d.code)!;
    return { ...d, rag: rag(a.rag), headlines: a.headlines, items: a.items };
  });
}
