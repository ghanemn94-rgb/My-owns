// The six Template 10 area rules (ADR-0037 §3; B0095; M0245-M0252; REQ-PB-062, REQ-PB-063, REQ-PB-064) as PURE
// functions of facts (no I/O, no clock: the business date, as-of date, window and calendar are inputs), with decimal.js
// for every amount and ratio (FORMULA_DECIMAL; never a JavaScript number for money or ratios).
//
//   Outcomes         outcome = combine(its active outcome KPIs' slice A statuses); no KPI -> unknown; empty -> unknown.
//                    Reads ONLY KPI statuses: never deliverables, milestones, actions, work items or completion.
//   Value            per currency: gap ratio = (plannedToDate - validatedToDate) / plannedToDate over the counted,
//                    monetised financial benefits; <= amber -> green, <= red -> amber, above -> red; planned = 0 ->
//                    not_applicable; an unknown amount -> unknown; nothing due -> not_applicable. Forecast, submitted
//                    and scenario values are shown, never counted as realized.
//   Portfolio        top N initiatives (selected, funded, launched, completed) by planned value allocated; initiative =
//                    combine(milestone component, outcome component).
//   Dependencies     open dependencies: red when needed-by passed or the linked decision is overdue; amber when at risk
//                    or due within N working days (red when the target initiative is on the computed critical path);
//                    unknown without a needed-by date; empty -> green.
//   Decisions        open/deferred T16 asks: red when one is overdue (ADR-0032: due date before the business date),
//                    amber when due within N working days; empty -> green.
//   People & adoption  the slice A statuses of the adoption metric links' KPIs (the adoption curve); empty -> unknown.
//
// The default thresholds are ADR-0037 §3's labelled interpretation (D-106 (a)); `policySource` says which applies.
import { computeWorkingDaySlip, FORMULA_DECIMAL as D } from "@mth/shared/calc";
import type { DashboardRagPolicyValues, DashboardValue, RagStatus } from "@mth/shared/schemas";
import { addWorkingDays, type WorkingCalendar } from "@mth/shared/time";
import { combine, combineOr, fromKpiRag, type InputStatus } from "./combine.ts";

// ------------------------------------------------------------------------------------------------ inputs

/** The read's clock and window (ADR-0037 §3-§4). */
export interface DashboardClock {
  /** Today in the organization's default calendar timezone (Asia/Riyadh unless configured). */
  readonly businessDate: string;
  /** The earlier of the period's end and the business date; the business date without a period filter. */
  readonly asOf: string;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  /** The organization's active default business calendar; null = not configured (working-day rules are Unknown). */
  readonly calendar: WorkingCalendar | null;
}

export interface DashboardPolicy {
  readonly values: DashboardRagPolicyValues;
  readonly source: "default" | "configured";
}

/** The slice A status of one KPI for the selected period (kpi/dashboard-facts.ts). */
export interface KpiStatusFact {
  readonly kpiDefinitionId: string;
  readonly kpiName: string;
  readonly ownerUserId: string | null;
  /** The RAG displayed (an override in force replaces the calculated RAG; ADR-0028, D-106 (b)). */
  readonly displayedRag: string;
  readonly calculatedRag: string;
  readonly overridden: boolean;
  readonly actual: string | null;
  readonly actualStatus: string;
  readonly actualReason: string | null;
  readonly unit: string | null;
  readonly currency: string | null;
  readonly reportingPeriodId: string | null;
  readonly periodLabel: string | null;
  readonly evaluationId: string | null;
  readonly calculationRunId: string | null;
}

export interface OutcomeKpiFact {
  readonly outcomeKpiId: string;
  readonly ownerUserId: string | null;
  readonly status: KpiStatusFact;
}

export interface OutcomeFact {
  readonly outcomeId: string;
  readonly transformationId: string;
  readonly statement: string;
  readonly ownerUserId: string | null;
  readonly kpis: readonly OutcomeKpiFact[];
}

export interface ValueBenefitFact {
  readonly benefitId: string;
  readonly transformationId: string;
  readonly code: string;
  readonly title: string;
  readonly ownerUserId: string | null;
  readonly valueClass: string;
  readonly currency: string;
  readonly counted: boolean;
  readonly overlapOpen: boolean;
  readonly unmonetised: boolean;
}

export interface ValueLineFact {
  readonly benefitId: string;
  readonly transformationId: string;
  readonly state: string;
  readonly amount: string | null;
  readonly currency: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly recordTable: string;
  readonly recordId: string;
}

export interface InvestmentLineFact {
  readonly recordId: string;
  readonly transformationId: string;
  readonly businessCaseId: string;
  readonly label: string | null;
  readonly amount: string | null;
  readonly currency: string;
}

export interface MilestoneFact {
  readonly milestoneId: string;
  readonly title: string;
  readonly status: string;
  readonly approvedDate: string | null;
  readonly forecastDate: string | null;
}

export interface InitiativeFact {
  readonly initiativeId: string;
  readonly transformationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly executiveOwnerUserId: string | null;
  readonly workstreamLeadUserId: string | null;
  /** Σ planned amount × allocation share in the transformation's currency (decimal), null when nothing is allocated. */
  readonly plannedAllocated: string | null;
  readonly plannedCurrency: string | null;
  readonly milestones: readonly MilestoneFact[];
  readonly outcomeIds: readonly string[];
}

export interface DependencyFact {
  readonly dependencyId: string;
  readonly transformationId: string;
  readonly code: string;
  readonly description: string;
  readonly ownerUserId: string | null;
  readonly neededBy: string | null;
  /** The dependency's own status: open or at_risk. */
  readonly status: string;
  readonly decisionId: string | null;
  /** The T16 ask it waits on is overdue (ADR-0032 rule). */
  readonly decisionOverdue: boolean;
  readonly targetInitiativeId: string | null;
  /** true / false / null (not computable; never a guessed false). */
  readonly onCriticalPath: boolean | null;
}

export interface DecisionFact {
  readonly decisionId: string;
  readonly transformationId: string;
  readonly code: string;
  readonly title: string;
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly impactOfDelay: string | null;
}

export interface AdoptionIndicatorFact {
  readonly metricLinkId: string;
  readonly transformationId: string;
  readonly templateKey: string;
  readonly targetKind: string;
  readonly status: KpiStatusFact;
}

// ------------------------------------------------------------------------------------------------ outputs

export interface AreaRag {
  readonly status: RagStatus;
  readonly ruleKey: string;
  readonly ruleParams: Record<string, unknown>;
}

export interface Row<T> {
  readonly fact: T;
  readonly status: RagStatus;
  readonly flags: readonly string[];
}

// ------------------------------------------------------------------------------------------------ values

const ZERO = new D(0);

/** Presentation scale of a ratio (OpenAPI Decimal: at most 6 fraction digits). */
export const RATIO_SCALE = 6;
/** Presentation scale of money (numeric(20,4)). */
export const MONEY_SCALE = 4;
/** The rounding object a drill-down reports for a presented ratio (ADR-0037 §5 `calculation.rounding`). */
export const RATIO_ROUNDING = Object.freeze({ scale: RATIO_SCALE, mode: "half_even", appliesTo: "presentation" });

/** A known decimal value: `zero` when it equals 0 (a fact), else `value` (ADR-0037 §5). */
export function knownValue(value: string, unit: string | null, currency: string | null): DashboardValue {
  const d = new D(value);
  return { state: d.isZero() ? "zero" : "value", value: d.toFixed(), unit, currency, reasonKey: null };
}

export function unknownValue(reasonKey: string, unit: string | null, currency: string | null): DashboardValue {
  return { state: "unknown", value: null, unit, currency, reasonKey };
}

export function notApplicableValue(reasonKey: string, unit: string | null = null): DashboardValue {
  return { state: "not_applicable", value: null, unit, currency: null, reasonKey };
}

export function countValue(n: number, unit: string): DashboardValue {
  return knownValue(String(n), unit, null);
}

/**
 * The exact sum of `amounts` per ADR-0037 §5: an empty set is a known zero, any null makes the sum Unknown with
 * `reasonKey` (a missing amount is never 0). Currencies are never added together: the caller passes one currency.
 */
export function sumValue(
  amounts: readonly (string | null)[],
  currency: string | null,
  unit: string | null,
  reasonKey: string,
): DashboardValue {
  if (amounts.some((a) => a === null)) return unknownValue(reasonKey, unit, currency);
  return knownValue(amounts.reduce((acc, a) => acc.plus(new D(a!)), ZERO).toFixed(), unit, currency);
}

/** The KPI actual of a status as a dashboard value: Stale keeps its value labelled Stale; missing is Unknown. */
export function kpiActualValue(s: KpiStatusFact): DashboardValue {
  if (s.actual !== null && s.actualStatus === "ok") return knownValue(s.actual, s.unit, s.currency);
  if (s.actual !== null && s.actualStatus === "stale")
    return {
      state: "stale",
      value: new D(s.actual).toFixed(),
      unit: s.unit,
      currency: s.currency,
      reasonKey: "kpi.stale",
    };
  return unknownValue(s.actualReason ?? "kpi.no_accepted_actual", s.unit, s.currency);
}

/** The status of a KPI row: the displayed RAG (override in force, else calculated), as a dashboard status. */
export function kpiRowStatus(s: KpiStatusFact): RagStatus {
  return fromKpiRag(s.displayedRag);
}

// ------------------------------------------------------------------------------------------------ dates

/** The last business date that is still "due soon": `from` plus `n` working days (n = 0: `from`); null = Unknown. */
export function dueSoonHorizon(from: string, n: number, calendar: WorkingCalendar | null): string | null {
  if (n === 0) return from;
  return addWorkingDays(from, n, calendar).dueDate;
}

// ------------------------------------------------------------------------------------------------ Outcomes

export interface OutcomesResult {
  readonly rag: AreaRag;
  readonly outcomes: readonly Row<OutcomeFact>[];
}

/** REQ-PB-063: an outcome's status comes only from its KPIs' trajectory statuses (never from task completion). */
export function outcomeStatus(o: OutcomeFact): RagStatus {
  return combineOr(
    o.kpis.map((k) => kpiRowStatus(k.status)),
    "unknown",
  );
}

export function outcomesArea(outcomes: readonly OutcomeFact[]): OutcomesResult {
  const rows = outcomes.map((o) => ({
    fact: o,
    status: outcomeStatus(o),
    flags: o.kpis.length === 0 ? ["no_kpi"] : o.kpis.some((k) => k.status.overridden) ? ["override_in_force"] : [],
  }));
  if (rows.length === 0)
    return { rag: { status: "unknown", ruleKey: "dashboard.rag.outcomes.none", ruleParams: {} }, outcomes: rows };
  return {
    rag: {
      status: combineOr(
        rows.map((r) => r.status),
        "unknown",
      ),
      ruleKey: "dashboard.rag.outcomes.trajectory",
      ruleParams: { outcomeCount: rows.length, kpiCount: outcomes.reduce((n, o) => n + o.kpis.length, 0) },
    },
    outcomes: rows,
  };
}

// ------------------------------------------------------------------------------------------------ Value

/** The five financial value classes (ADR-0030 §7); non-financial benefits are Value n/a, counted separately. */
export const FINANCIAL_VALUE_CLASSES: readonly string[] = [
  "revenue_uplift",
  "margin_uplift",
  "cash_saving",
  "avoided_cost",
  "working_capital_release",
];

/** The value states a Value headline shows, each summed on its own (never added together; ADR-0030 §7). */
export const VALUE_HEADLINE_STATES = ["planned", "forecast", "submitted", "validated"] as const;
export type ValueHeadlineState = (typeof VALUE_HEADLINE_STATES)[number];

/**
 * Whether a benefit's lines may enter a Value sum: counted once (benefit_counting), monetised, of a financial class;
 * validated values of a benefit with an open overlap warning are held back until Finance resolves it (ADR-0030 §7).
 */
export function lineEligible(b: ValueBenefitFact | undefined, state: string): boolean {
  if (!b || !b.counted || b.unmonetised || !FINANCIAL_VALUE_CLASSES.includes(b.valueClass)) return false;
  return !(b.overlapOpen && (state === "validated" || state === "sustained"));
}

/**
 * Whether a value line lies in the window of its state (ADR-0037 §3-§4): planned, submitted and validated are "to date"
 * (period end on or before the as-of date and, with a period filter, on or after its start); forecast lines are those
 * whose period ends inside the period filter's window (all forecast lines without one).
 */
export function lineInWindow(line: ValueLineFact, state: string, clock: DashboardClock): boolean {
  const end = line.periodEnd;
  if (state === "forecast") {
    if (clock.windowStart === null || clock.windowEnd === null) return true;
    return end !== null && end >= clock.windowStart && end <= clock.windowEnd;
  }
  if (end === null) return false;
  if (end > clock.asOf) return false;
  return clock.windowStart === null || end >= clock.windowStart;
}

/** The eligible lines of one state in the window (the drill-down's contributing records; ADR-0037 §5 invariant). */
export function valueLinesOf(
  benefits: ReadonlyMap<string, ValueBenefitFact>,
  lines: readonly ValueLineFact[],
  state: ValueHeadlineState,
  clock: DashboardClock,
): ValueLineFact[] {
  return lines.filter(
    (l) => l.state === state && lineEligible(benefits.get(l.benefitId), state) && lineInWindow(l, state, clock),
  );
}

/** The currencies of the counted, monetised financial benefits (sorted; each is its own line). */
export function valueCurrencies(benefits: Iterable<ValueBenefitFact>): string[] {
  const out = new Set<string>();
  for (const b of benefits) if (lineEligible(b, "planned")) out.add(b.currency);
  return [...out].sort();
}

export interface ValueCurrencyLine {
  readonly currency: string;
  readonly planned: DashboardValue;
  readonly forecast: DashboardValue;
  readonly submitted: DashboardValue;
  readonly validated: DashboardValue;
  /** (planned - validated) / planned, rounded half-even to 6 places for presentation; null when not computable. */
  readonly gapRatio: string | null;
  readonly status: RagStatus;
  readonly reasonKey: string | null;
}

export interface ValueResult {
  readonly rag: AreaRag;
  readonly currencies: readonly ValueCurrencyLine[];
}

/** The Value status of one currency line (ADR-0037 §3). */
export function valueGapStatus(
  planned: DashboardValue,
  validated: DashboardValue,
  policy: DashboardRagPolicyValues,
): { status: RagStatus; gapRatio: string | null; reasonKey: string | null } {
  if (planned.state === "unknown" || validated.state === "unknown")
    return { status: "unknown", gapRatio: null, reasonKey: planned.reasonKey ?? validated.reasonKey };
  const p = new D(planned.value!);
  if (p.isZero()) return { status: "not_applicable", gapRatio: null, reasonKey: "dashboard.value.nothing_planned" };
  const ratio = p.minus(new D(validated.value!)).dividedBy(p);
  const status: RagStatus = ratio.lte(new D(policy.valueGapAmberRatio))
    ? "green"
    : ratio.lte(new D(policy.valueGapRedRatio))
      ? "amber"
      : "red";
  // The status compares the EXACT ratio; only the presented value is rounded (6 places, half-even: the contract's
  // Decimal scale), so a rounding can never move a line across a threshold.
  return { status, gapRatio: ratio.toDecimalPlaces(RATIO_SCALE, D.ROUND_HALF_EVEN).toFixed(), reasonKey: null };
}

export function valueArea(
  benefits: readonly ValueBenefitFact[],
  lines: readonly ValueLineFact[],
  clock: DashboardClock,
  policy: DashboardRagPolicyValues,
): ValueResult {
  const byId = new Map(benefits.map((b) => [b.benefitId, b]));
  const currencies = valueCurrencies(benefits).map((currency): ValueCurrencyLine => {
    const sum = (state: ValueHeadlineState) =>
      sumValue(
        valueLinesOf(byId, lines, state, clock)
          .filter((l) => byId.get(l.benefitId)!.currency === currency)
          .map((l) => l.amount),
        currency,
        "currency",
        "benefit.value_amount_missing",
      );
    const planned = sum("planned");
    const validated = sum("validated");
    const gap = valueGapStatus(planned, validated, policy);
    return {
      currency,
      planned,
      forecast: sum("forecast"),
      submitted: sum("submitted"),
      validated,
      gapRatio: gap.gapRatio,
      status: gap.status,
      reasonKey: gap.reasonKey,
    };
  });
  const status = combine(currencies.map((c) => c.status));
  if (status === null)
    return {
      rag: { status: "not_applicable", ruleKey: "dashboard.rag.value.nothing_due", ruleParams: {} },
      currencies,
    };
  return {
    rag: {
      status,
      ruleKey: "dashboard.rag.value.validated_gap",
      ruleParams: {
        amberRatio: policy.valueGapAmberRatio,
        redRatio: policy.valueGapRedRatio,
        lines: currencies.map((c) => ({ currency: c.currency, gapRatio: c.gapRatio, status: c.status })),
      },
    },
    currencies,
  };
}

// ------------------------------------------------------------------------------------------------ Portfolio

/** The initiative statuses the Portfolio area lists (ADR-0037 §3). */
export const PORTFOLIO_INITIATIVE_STATUSES: readonly string[] = ["selected", "funded", "launched", "completed"];

export interface MilestoneComponent {
  readonly status: RagStatus;
  readonly reasonKey: string;
  readonly maxSlipWorkingDays: number | null;
}

/** The milestone component of one initiative (ADR-0037 §3; REQ-PB-063 keeps it as source logic, AN-04). */
export function milestoneComponent(
  milestones: readonly MilestoneFact[],
  clock: DashboardClock,
  policy: DashboardRagPolicyValues,
): MilestoneComponent {
  const dated = milestones.filter((m) => m.approvedDate !== null && m.status !== "cancelled");
  if (dated.length === 0)
    return { status: "unknown", reasonKey: "dashboard.portfolio.no_approved_milestone", maxSlipWorkingDays: null };
  const open = dated.filter((m) => m.status !== "achieved");
  if (open.some((m) => m.approvedDate! < clock.asOf))
    return { status: "red", reasonKey: "dashboard.portfolio.milestone_overdue", maxSlipWorkingDays: null };
  let max = 0;
  for (const m of open) {
    if (m.forecastDate === null || m.forecastDate <= m.approvedDate!) continue;
    const slip = computeWorkingDaySlip(m.approvedDate, m.forecastDate, clock.calendar);
    if (slip.status === "unknown")
      return { status: "unknown", reasonKey: `dashboard.portfolio.slip_${slip.reason}`, maxSlipWorkingDays: null };
    max = Math.max(max, slip.value);
  }
  const status: RagStatus =
    open.length === 0
      ? "green"
      : max >= policy.milestoneSlipRedWorkingDays
        ? "red"
        : max >= policy.milestoneSlipAmberWorkingDays
          ? "amber"
          : "green";
  return { status, reasonKey: "dashboard.portfolio.milestone_slip", maxSlipWorkingDays: max };
}

export interface PortfolioRow extends Row<InitiativeFact> {
  readonly milestone: MilestoneComponent;
  readonly outcome: RagStatus;
}

export interface PortfolioResult {
  readonly rag: AreaRag;
  readonly initiatives: readonly PortfolioRow[];
}

/** Ordering of the Portfolio list: planned value allocated (decimal) descending, then code (ADR-0037 §3). */
export function comparePortfolio(a: InitiativeFact, b: InitiativeFact): number {
  const va = a.plannedAllocated === null ? null : new D(a.plannedAllocated);
  const vb = b.plannedAllocated === null ? null : new D(b.plannedAllocated);
  if (va !== null && vb !== null && !va.eq(vb)) return vb.comparedTo(va);
  if (va === null && vb !== null) return 1;
  if (va !== null && vb === null) return -1;
  return a.code.localeCompare(b.code) || a.initiativeId.localeCompare(b.initiativeId);
}

export function portfolioArea(
  initiatives: readonly InitiativeFact[],
  outcomeStatuses: ReadonlyMap<string, RagStatus>,
  clock: DashboardClock,
  policy: DashboardRagPolicyValues,
): PortfolioResult {
  const top = initiatives
    .filter((i) => PORTFOLIO_INITIATIVE_STATUSES.includes(i.status))
    .slice()
    .sort(comparePortfolio)
    .slice(0, policy.topInitiativeCount);
  const rows = top.map((i): PortfolioRow => {
    const milestone = milestoneComponent(i.milestones, clock, policy);
    const outcome = combineOr(
      i.outcomeIds.map((id) => outcomeStatuses.get(id) ?? "unknown"),
      "unknown",
    );
    const flags = [`milestone_${milestone.status}`, `outcome_${outcome}`];
    return { fact: i, milestone, outcome, status: combineOr([milestone.status, outcome], "unknown"), flags };
  });
  if (rows.length === 0)
    return {
      rag: { status: "not_applicable", ruleKey: "dashboard.rag.portfolio.none", ruleParams: {} },
      initiatives: rows,
    };
  return {
    rag: {
      status: combineOr(
        rows.map((r) => r.status),
        "unknown",
      ),
      ruleKey: "dashboard.rag.portfolio.milestone_outcome",
      ruleParams: {
        topInitiativeCount: policy.topInitiativeCount,
        amberWorkingDays: policy.milestoneSlipAmberWorkingDays,
        redWorkingDays: policy.milestoneSlipRedWorkingDays,
      },
    },
    initiatives: rows,
  };
}

// ------------------------------------------------------------------------------------------------ Dependencies

export interface DependenciesResult {
  readonly rag: AreaRag;
  readonly dependencies: readonly Row<DependencyFact>[];
}

export function dependencyStatus(
  d: DependencyFact,
  clock: DashboardClock,
  policy: DashboardRagPolicyValues,
): { status: RagStatus; flags: string[] } {
  const flags: string[] = [];
  if (d.onCriticalPath === true) flags.push("critical_path");
  if (d.onCriticalPath === null) flags.push("critical_path_not_computable");
  if (d.decisionOverdue) flags.push("decision_overdue");
  if ((d.neededBy !== null && d.neededBy < clock.asOf) || d.decisionOverdue) {
    if (d.neededBy !== null && d.neededBy < clock.asOf) flags.push("needed_by_passed");
    return { status: "red", flags };
  }
  let amber = d.status === "at_risk";
  if (amber) flags.push("at_risk");
  let unknown = d.neededBy === null;
  if (d.neededBy !== null) {
    const horizon = dueSoonHorizon(clock.asOf, policy.dependencyDueSoonWorkingDays, clock.calendar);
    if (horizon === null) unknown = true;
    else if (d.neededBy <= horizon) {
      amber = true;
      flags.push("due_soon");
    }
  }
  if (amber) return { status: d.onCriticalPath === true ? "red" : "amber", flags };
  return { status: unknown ? "unknown" : "green", flags };
}

export function dependenciesArea(
  dependencies: readonly DependencyFact[],
  clock: DashboardClock,
  policy: DashboardRagPolicyValues,
): DependenciesResult {
  const rows = dependencies.map((d) => ({ fact: d, ...dependencyStatus(d, clock, policy) }));
  if (rows.length === 0)
    return {
      rag: { status: "green", ruleKey: "dashboard.rag.dependencies.none_open", ruleParams: {} },
      dependencies: rows,
    };
  return {
    rag: {
      status: combineOr(
        rows.map((r) => r.status),
        "unknown",
      ),
      ruleKey: "dashboard.rag.dependencies.needed_by_critical_path",
      ruleParams: { dueSoonWorkingDays: policy.dependencyDueSoonWorkingDays, openCount: rows.length },
    },
    dependencies: rows,
  };
}

// ------------------------------------------------------------------------------------------------ Decisions

/** The ADR-0032 overdue rule: open or deferred and due before the business date (organization timezone). */
export function decisionOverdue(d: { status: string; dueDate: string | null }, businessDate: string): boolean {
  return (d.status === "open" || d.status === "deferred") && d.dueDate !== null && d.dueDate < businessDate;
}

export interface DecisionsResult {
  readonly rag: AreaRag;
  readonly decisions: readonly Row<DecisionFact>[];
  readonly overdueCount: number;
}

export function decisionsArea(
  decisions: readonly DecisionFact[],
  clock: DashboardClock,
  policy: DashboardRagPolicyValues,
): DecisionsResult {
  const open = decisions.filter((d) => d.status === "open" || d.status === "deferred");
  const horizon = dueSoonHorizon(clock.businessDate, policy.decisionDueSoonWorkingDays, clock.calendar);
  const rows = open.map((d): Row<DecisionFact> => {
    if (decisionOverdue(d, clock.businessDate)) return { fact: d, status: "red", flags: ["overdue"] };
    if (d.dueDate === null) return { fact: d, status: "unknown", flags: ["no_due_date"] };
    if (horizon === null) return { fact: d, status: "unknown", flags: ["calendar_not_configured"] };
    if (d.dueDate <= horizon) return { fact: d, status: "amber", flags: ["due_soon"] };
    return { fact: d, status: "green", flags: [] };
  });
  const overdueCount = rows.filter((r) => r.flags.includes("overdue")).length;
  if (rows.length === 0)
    return {
      rag: { status: "green", ruleKey: "dashboard.rag.decisions.none_open", ruleParams: {} },
      decisions: rows,
      overdueCount,
    };
  return {
    rag: {
      status: combineOr(
        rows.map((r) => r.status),
        "unknown",
      ),
      ruleKey: overdueCount > 0 ? "dashboard.rag.decisions.overdue" : "dashboard.rag.decisions.due",
      ruleParams: { overdueCount, openCount: rows.length, dueSoonWorkingDays: policy.decisionDueSoonWorkingDays },
    },
    decisions: rows,
    overdueCount,
  };
}

// ------------------------------------------------------------------------------------------------ People & adoption

export interface AdoptionResult {
  readonly rag: AreaRag;
  readonly indicators: readonly Row<AdoptionIndicatorFact>[];
}

export function adoptionArea(indicators: readonly AdoptionIndicatorFact[]): AdoptionResult {
  const rows = indicators.map((i) => ({
    fact: i,
    status: kpiRowStatus(i.status),
    flags: i.status.overridden ? ["override_in_force"] : [],
  }));
  if (rows.length === 0)
    return {
      rag: { status: "unknown", ruleKey: "dashboard.rag.adoption.no_indicators", ruleParams: {} },
      indicators: rows,
    };
  return {
    rag: {
      status: combineOr(
        rows.map((r) => r.status as InputStatus),
        "unknown",
      ),
      ruleKey: "dashboard.rag.adoption.curve",
      ruleParams: { indicatorCount: rows.length },
    },
    indicators: rows,
  };
}

/** The status of a transformation-level area on a workstream dashboard (ADR-0037 §2). */
export const WORKSTREAM_NOT_APPLICABLE: AreaRag = Object.freeze({
  status: "not_applicable",
  ruleKey: "dashboard.rag.workstream_not_applicable",
  ruleParams: {},
});
