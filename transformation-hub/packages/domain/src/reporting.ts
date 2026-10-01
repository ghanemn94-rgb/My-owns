/**
 * Reporting rules (spec §11, ADR-0011): pure functions shared by the report generator, the renderers and the tests.
 *  - spreadsheet formula neutralisation (REQ-SEC-017, threat-model C-17);
 *  - look-ahead windows on business dates (REQ-RPT-004);
 *  - the deterministic calculators of the proposed KPI catalogue (REQ-RPT-012..014): a KPI is computed only from records
 *    that exist; with no source records it stays a proposal with no value (never a historical figure);
 *  - figure differences between two snapshots (REQ-RPT-006).
 * No I/O.
 */
import { addCalendarDays, workingDaysBetweenInclusive, workingDaySlip, DEFAULT_CALENDAR, type WorkingCalendar } from './calendar';
import { type Classification } from './enums';
import { LOOK_AHEAD_WEEKS, lookAheadWindow, type LookAheadWeeks } from './planning';
import { classificationRank } from './policy/engine';

export const REPORT_SCHEMA_VERSION = 'hub.report/1';

// ---------------------------------------------------------------------------------------------------------------------
// Spreadsheet formula injection (REQ-SEC-017, C-17)

/** First characters that make a spreadsheet application treat a cell as a formula or command (incl. full-width forms). */
export const SPREADSHEET_FORMULA_TRIGGERS: readonly string[] = ['=', '+', '-', '@', '\t', '\r', '＝', '＋', '－', '＠'];

/** True when the first character after leading spaces would start a formula / DDE command in a spreadsheet. */
export function isFormulaLike(value: string): boolean {
  const t = value.replace(/^[  ]+/, '');
  return t.length > 0 && SPREADSHEET_FORMULA_TRIGGERS.includes(t[0]!);
}

/**
 * Text written to a spreadsheet cell or CSV field: a formula-like value gets a leading apostrophe so it is shown as
 * text and never evaluated (C-17). Everything else is returned unchanged.
 */
export function neutralizeSpreadsheetText(value: string): string {
  return isFormulaLike(value) ? `'${value}` : value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Classification

/** Highest classification of a list (`floor` when the list is empty). Derived artefacts take the max of their inputs. */
export function maxClassification(list: readonly (Classification | null | undefined)[], floor: Classification = 'internal'): Classification {
  let best = floor;
  for (const c of list) if (c && classificationRank(c) > classificationRank(best)) best = c;
  return best;
}

// ---------------------------------------------------------------------------------------------------------------------
// Look-ahead windows (REQ-RPT-004)

/**
 * Look-ahead windows reuse the planning rule (`lookAheadWindow`): the N-week window is the N×7 business dates
 * (project-local calendar dates) starting on the as-of date, both ends inclusive — never instants, so the window does not
 * depend on the server's timezone.
 */
/** Smallest look-ahead window (2, 4 or 8 weeks) containing `due`; null when it is before today or after the 8-week window. */
export function lookAheadBucket(today: string, due: string | null | undefined): LookAheadWeeks | null {
  if (!due || due < today) return null;
  for (const w of LOOK_AHEAD_WEEKS) if (due <= lookAheadWindow(today, w).to) return w;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Proposed KPI catalogue (spec §11, REQ-RPT-012..014)

/** Result of a KPI calculator: a value computed from records, or `no_data` (the KPI stays a proposal). */
export interface KpiComputation {
  state: 'computed' | 'no_data';
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  /** Explanation codes (rendered by the screens and the exports), e.g. exclusions or unapproved weights. */
  notes: string[];
}

const noData = (notes: string[] = []): KpiComputation => ({ state: 'no_data', value: null, numerator: null, denominator: null, notes });
const ratio = (num: number, den: number, notes: string[] = []): KpiComputation =>
  den > 0 ? { state: 'computed', value: round1((num / den) * 100), numerator: num, denominator: den, notes } : noData(notes);
const counted = (n: number, notes: string[] = []): KpiComputation => ({ state: 'computed', value: n, numerator: null, denominator: null, notes });
export const round1 = (x: number): number => Math.round(x * 10) / 10;

export interface KpiDeliverableRow {
  status: string;
  dueDate: string | null;
  weight: string | number | null;
  weightApproved: boolean;
}
/**
 * accepted/due deliverables: weighted share of the deliverables due by the as-of date that are accepted; cancelled ones
 * are excluded. Approved weights are used when every due deliverable has one; otherwise each counts 1 and the note says so.
 */
export function kpiDeliverablesAcceptedVsDue(rows: readonly KpiDeliverableRow[], today: string): KpiComputation {
  const due = rows.filter((r) => r.status !== 'cancelled' && !!r.dueDate && r.dueDate <= today);
  if (!due.length) return noData();
  const weighted = due.every((r) => r.weightApproved && r.weight !== null && Number(r.weight) > 0);
  const w = (r: KpiDeliverableRow) => (weighted ? Number(r.weight) : 1);
  const num = due.filter((r) => r.status === 'accepted').reduce((a, r) => a + w(r), 0);
  const den = due.reduce((a, r) => a + w(r), 0);
  const cancelled = rows.filter((r) => r.status === 'cancelled').length;
  const notes = [weighted ? 'kpi.weights_approved' : 'kpi.weights_not_approved_count_based'];
  if (cancelled) notes.push('kpi.cancelled_excluded');
  return ratio(num, den, notes);
}

export interface KpiMilestoneRow {
  status: string;
  isCritical: boolean;
  plannedDate: string | null;
  forecastDate: string | null;
  actualDate: string | null;
  /** Finish date of the approved baseline for this milestone, when a baseline exists. */
  baselineDate: string | null;
}
/**
 * Milestone delay: the largest slip in working days between the baseline (or planned) date and the forecast or actual
 * date over the OPEN critical milestones, floored at zero. No open critical milestone with dates → no data.
 */
export function kpiMilestoneDelayDays(rows: readonly KpiMilestoneRow[], cal: WorkingCalendar = DEFAULT_CALENDAR): KpiComputation {
  const open = rows.filter((r) => r.isCritical && !['achieved_verified', 'cancelled'].includes(r.status));
  const measurable = open.filter((r) => (r.baselineDate ?? r.plannedDate) && (r.actualDate ?? r.forecastDate));
  if (!measurable.length) return noData(open.length ? ['kpi.schedule_incomplete'] : []);
  let max = 0;
  for (const r of measurable) max = Math.max(max, workingDaySlip((r.baselineDate ?? r.plannedDate)!, (r.actualDate ?? r.forecastDate)!, cal));
  const notes = measurable.some((r) => !r.baselineDate) ? ['kpi.planned_date_used_without_baseline'] : [];
  if (measurable.length < open.length) notes.push('kpi.schedule_incomplete');
  return counted(Math.max(0, max), notes);
}

export interface KpiDecisionRow {
  status: string;
  latestSafeDate: string | null;
}
const OPEN_DECISION_STATES = ['draft', 'submitted', 'under_review', 'recommended'];
/** Overdue decisions: open decisions whose latest safe decision date is before the as-of date. No decisions → no data. */
export function kpiOverdueDecisions(rows: readonly KpiDecisionRow[], today: string): KpiComputation {
  if (!rows.length) return noData();
  return counted(rows.filter((r) => OPEN_DECISION_STATES.includes(r.status) && !!r.latestSafeDate && r.latestSafeDate < today).length);
}

export interface KpiActionRow {
  status: string;
  createdOn: string;
  verifiedOn: string | null;
}
/** Action closure time: average working days from creation to verified closure, over verified-closed actions. */
export function kpiActionClosureTime(rows: readonly KpiActionRow[], cal: WorkingCalendar = DEFAULT_CALENDAR): KpiComputation {
  const closed = rows.filter((r) => r.status === 'verified_closed' && r.verifiedOn);
  if (!closed.length) return noData();
  const days = closed.map((r) => Math.max(0, workingDaysBetweenInclusive(r.createdOn, r.verifiedOn!, cal) - 1));
  return { state: 'computed', value: round1(days.reduce((a, b) => a + b, 0) / days.length), numerator: null, denominator: closed.length, notes: [] };
}

export interface KpiPerimeterRow {
  disposition: string;
  transferStatus: string;
  hasPlan: boolean;
}
/** Share of Included perimeter items whose transfer is verified. */
export function kpiPerimeterTransferred(rows: readonly KpiPerimeterRow[]): KpiComputation {
  const inc = rows.filter((r) => r.disposition === 'included' && r.transferStatus !== 'not_applicable');
  return ratio(inc.filter((r) => r.transferStatus === 'transferred_verified').length, inc.length);
}
/** Included / shared / pending items without a transfer plan or verified evidence of transfer. */
export function kpiPerimeterOutstanding(rows: readonly KpiPerimeterRow[]): KpiComputation {
  const scope = rows.filter((r) => ['included', 'shared', 'pending'].includes(r.disposition) && r.transferStatus !== 'not_applicable');
  if (!scope.length) return noData();
  return counted(scope.filter((r) => r.transferStatus !== 'transferred_verified' && (!r.hasPlan || r.transferStatus === 'not_started' || r.transferStatus === 'blocked')).length);
}

export interface KpiConsentRow {
  status: string;
  hasInterimArrangement: boolean;
}
/** Consent / novation records neither granted (incl. conditional) nor covered by an interim arrangement. */
export function kpiContractsAwaitingConsent(rows: readonly KpiConsentRow[]): KpiComputation {
  const relevant = rows.filter((r) => r.status !== 'not_required');
  if (!relevant.length) return noData();
  return counted(relevant.filter((r) => !['granted', 'conditional'].includes(r.status) && !r.hasInterimArrangement).length);
}

export interface KpiReadinessRow {
  siteKey: string;
  mandatory: boolean;
  blocker: boolean;
  status: string;
}
export interface SiteReadiness {
  siteKey: string;
  mandatory: number;
  signedOff: number;
  percent: number | null;
  openBlockers: number;
  rag: 'green' | 'amber' | 'red';
}
const SIGNED_OFF = ['passed', 'waived', 'not_applicable'];
/** Day-1 readiness by site: share of mandatory checks signed off; one open blocker makes the site red. */
export function readinessBySite(rows: readonly KpiReadinessRow[]): SiteReadiness[] {
  const sites = [...new Set(rows.map((r) => r.siteKey))].sort();
  return sites.map((siteKey) => {
    const mine = rows.filter((r) => r.siteKey === siteKey);
    const mand = mine.filter((r) => r.mandatory);
    const signedOff = mand.filter((r) => SIGNED_OFF.includes(r.status)).length;
    const openBlockers = mine.filter((r) => r.blocker && !SIGNED_OFF.includes(r.status)).length;
    const rag: SiteReadiness['rag'] = openBlockers > 0 ? 'red' : signedOff < mand.length ? 'amber' : 'green';
    return { siteKey, mandatory: mand.length, signedOff, percent: mand.length ? round1((signedOff / mand.length) * 100) : null, openBlockers, rag };
  });
}
/** Overall Day-1 readiness KPI (all sites): share of mandatory checks signed off; open blockers in the notes. */
export function kpiDay1Readiness(rows: readonly KpiReadinessRow[]): KpiComputation {
  const mand = rows.filter((r) => r.mandatory);
  const blockers = rows.filter((r) => r.blocker && !SIGNED_OFF.includes(r.status)).length;
  return ratio(mand.filter((r) => SIGNED_OFF.includes(r.status)).length, mand.length, blockers ? ['kpi.open_blockers_red'] : []);
}

export interface KpiCpRow {
  status: string;
}
/** Share of conditions precedent verified or validly waived. */
export function kpiCpsVerified(rows: readonly KpiCpRow[]): KpiComputation {
  return ratio(rows.filter((r) => r.status === 'verified' || r.status === 'waived').length, rows.length);
}

export interface KpiTsaRow {
  status: string;
  endDate: string | null;
  replacementAccepted: boolean;
}
/** Proposed warning window for TSAs (days) until the committee approves another one. */
export const TSA_WARNING_WINDOW_DAYS = 90;
export function isTsaAtRisk(r: KpiTsaRow, today: string, windowDays = TSA_WARNING_WINDOW_DAYS): boolean {
  if (r.status === 'breached' || r.status === 'expired_unresolved') return true;
  if (!['active', 'extended', 'exit_in_progress'].includes(r.status) || r.replacementAccepted || !r.endDate) return false;
  return r.endDate <= addCalendarDays(today, windowDays);
}
/** TSAs breached, expired-unresolved, or ending inside the warning window without an accepted replacement. */
export function kpiTsasAtRisk(rows: readonly KpiTsaRow[], today: string, windowDays = TSA_WARNING_WINDOW_DAYS): KpiComputation {
  if (!rows.length) return noData();
  return counted(rows.filter((r) => isTsaAtRisk(r, today, windowDays)).length, ['kpi.tsa_warning_window_proposed']);
}

export interface KpiBudgetGroup {
  currency: string;
  unitScale: number;
  approved: number;
  committed: number;
  spent: number;
}
/**
 * Separation cost versus approved budget, per currency / unit group — never summed across currencies or units (AT-29).
 * Exactly one group → a value; several → no single value (the per-group figures are reported separately, with a note).
 */
export function kpiSeparationCostVsBudget(groups: readonly KpiBudgetGroup[]): KpiComputation {
  const usable = groups.filter((g) => g.approved > 0);
  if (!usable.length) return noData();
  if (usable.length > 1) return noData(['kpi.mixed_currency_no_single_value']);
  const g = usable[0]!;
  return ratio(g.spent + g.committed, g.approved, ['kpi.single_currency_group']);
}

export interface KpiUpdateRow {
  /** Workstream or task that should be updated. */
  key: string;
  lastAcceptedPeriodEnd: string | null;
}
/** Proposed stale-after window (days) for periodic updates. */
export const UPDATE_STALE_AFTER_DAYS = 14;
/** Share of active workstreams with an accepted update inside the stale-after window. */
export function kpiUpdateFreshness(rows: readonly KpiUpdateRow[], today: string, staleAfterDays = UPDATE_STALE_AFTER_DAYS): KpiComputation {
  if (!rows.length) return noData();
  const limit = addCalendarDays(today, -staleAfterDays);
  return ratio(rows.filter((r) => !!r.lastAcceptedPeriodEnd && r.lastAcceptedPeriodEnd >= limit).length, rows.length, ['kpi.stale_window_proposed']);
}

export interface KpiBenefitRow {
  status: string;
  currency: string | null;
  unitScale: number | null;
  planned: number | null;
  realizedVerified: number | null;
}
/** Verified realized benefits as a share of planned benefits, one currency / unit only (AT-29). */
export function kpiBenefitsRealized(rows: readonly KpiBenefitRow[]): KpiComputation {
  const planned = rows.filter((r) => r.status !== 'cancelled' && r.planned !== null && r.currency);
  if (!planned.length) return noData();
  const groups = new Set(planned.map((r) => `${r.currency}/${r.unitScale}`));
  if (groups.size > 1) return noData(['kpi.mixed_currency_no_single_value']);
  const den = planned.reduce((a, r) => a + (r.planned ?? 0), 0);
  const num = planned.filter((r) => r.status === 'realized_verified').reduce((a, r) => a + (r.realizedVerified ?? 0), 0);
  return ratio(num, den);
}

export interface KpiCriterionRow {
  mandatory: boolean;
  status: string;
}
/** Share of the next gate's mandatory criteria met or validly waived (task progress is not an input). */
export function kpiNextGateCriteriaMet(rows: readonly KpiCriterionRow[]): KpiComputation {
  const mand = rows.filter((r) => r.mandatory && r.status !== 'not_applicable');
  return ratio(mand.filter((r) => r.status === 'met' || r.status === 'waived').length, mand.length);
}

/** Open blockers: unmet blocking gate criteria + open blocker readiness checks + unverified blocking CPs (counted apart). */
export function kpiOpenBlockers(parts: { gateCriteria: number | null; readinessChecks: number | null; cps: number | null }): KpiComputation {
  const known = [parts.gateCriteria, parts.readinessChecks, parts.cps].filter((x): x is number => x !== null);
  if (!known.length) return noData();
  const notes = known.length < 3 ? ['kpi.partial_sources'] : [];
  return counted(known.reduce((a, b) => a + b, 0), notes);
}

/** Keys of the proposed KPIs of spec §11 that have a deterministic calculator (template KPI keys). */
export const KPI_CALCULATOR_KEYS = [
  'deliverables_accepted_vs_due',
  'milestone_delay_days',
  'overdue_decisions',
  'action_closure_time',
  'perimeter_items_transferred',
  'perimeter_items_outstanding',
  'contracts_awaiting_consent',
  'day1_readiness_by_site',
  'cps_verified',
  'tsas_at_risk',
  'separation_cost_vs_budget',
  'update_freshness',
  'benefits_realized',
  'next_gate_mandatory_criteria_met',
  'open_blockers',
] as const;
export type KpiCalculatorKey = (typeof KPI_CALCULATOR_KEYS)[number];

/** Read permission of the records each calculator reads (the KPI value is shown only to readers of its source). */
export const KPI_SOURCE_PERMISSION: Readonly<Record<KpiCalculatorKey, string>> = {
  deliverables_accepted_vs_due: 'planning.plan.read',
  milestone_delay_days: 'planning.plan.read',
  overdue_decisions: 'governance.decision.read',
  action_closure_time: 'governance.decision.read',
  perimeter_items_transferred: 'carveout.register.read',
  perimeter_items_outstanding: 'carveout.register.read',
  contracts_awaiting_consent: 'carveout.register.read',
  day1_readiness_by_site: 'readiness.register.read',
  cps_verified: 'jv.deal.read',
  tsas_at_risk: 'readiness.register.read',
  separation_cost_vs_budget: 'finance.record.read',
  update_freshness: 'planning.plan.read',
  benefits_realized: 'finance.record.read',
  next_gate_mandatory_criteria_met: 'gates.gate.read',
  open_blockers: 'gates.gate.read',
};

// ---------------------------------------------------------------------------------------------------------------------
// Changes since the previous snapshot (REQ-RPT-006)

export interface FigureRef {
  section: string;
  key: string;
  value: number | null;
}
export interface FigureChange {
  section: string;
  key: string;
  before: number | null;
  after: number | null;
  delta: number | null;
}
/** Figures whose value differs between two snapshots (only figures present in both are compared). */
export function diffFigures(before: readonly FigureRef[], after: readonly FigureRef[]): FigureChange[] {
  const prev = new Map(before.map((f) => [`${f.section}\u0000${f.key}`, f.value]));
  const out: FigureChange[] = [];
  for (const f of after) {
    const k = `${f.section}\u0000${f.key}`;
    if (!prev.has(k)) continue;
    const b = prev.get(k) ?? null;
    if (b === f.value) continue;
    out.push({ section: f.section, key: f.key, before: b, after: f.value, delta: b !== null && f.value !== null ? round1(f.value - b) : null });
  }
  return out;
}
