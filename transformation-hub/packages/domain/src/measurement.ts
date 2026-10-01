import type { RagStatus } from './enums';
import { workingDaySlip, WorkingCalendar, DEFAULT_CALENDAR } from './calendar';
import type { ServerMessage } from './messages';
import { planMessage, planningEn } from './planning-messages';

/**
 * Measurement rules (spec §9 "Measurement rules" 1–8).
 *
 * Every explanation is returned twice (QA-P2-04): as the English sentence (`explanation`, `reason` — audit, AI context,
 * compatibility) and as codes + parameters (`explanationI18n`, `reasonI18n`) rendered from the same templates
 * (PLANNING_MESSAGES_EN), which the client translates.
 */

export interface WeightedItem {
  id: string;
  label?: string;
  /** Arabic label of the item when its source record has one (template-seeded deliverables). */
  labelAr?: string | null;
  weight: number; // approved deliverable weight (> 0)
  /** Accepted = counts as complete. Anything else counts as incomplete. */
  state: 'accepted' | 'in_progress' | 'not_started' | 'cancelled' | 'excluded';
  exclusionReason?: string;
  /** Codes of `exclusionReason` (a custom reason without codes is shown as given). */
  exclusionReasonI18n?: ServerMessage[];
}

export interface WeightedProgress {
  percent: number | null; // null when denominator is zero
  numeratorWeight: number;
  denominatorWeight: number;
  includedCount: number;
  exclusions: { id: string; label?: string; labelAr?: string | null; reason: string; reasonI18n: ServerMessage[] | null }[];
  explanation: string;
  explanationI18n: ServerMessage[];
}

/** Rule 1 & 2: weighted progress with an explicit denominator; cancelled items are excluded, never "complete". */
export function weightedProgress(items: WeightedItem[]): WeightedProgress {
  const exclusions: WeightedProgress['exclusions'] = [];
  const excluded = (it: WeightedItem, fallback: string) => {
    const reasonI18n = it.exclusionReason ? (it.exclusionReasonI18n ?? null) : [planMessage(fallback)];
    const reason = it.exclusionReason ?? planningEn(reasonI18n!);
    exclusions.push({ id: it.id, label: it.label, ...(it.labelAr !== undefined ? { labelAr: it.labelAr } : {}), reason, reasonI18n });
  };
  let num = 0, den = 0, included = 0;
  for (const it of items) {
    if (it.state === 'cancelled' || it.state === 'excluded') {
      excluded(it, it.state === 'cancelled' ? 'plan.progress.excluded_cancelled' : 'plan.progress.excluded');
      continue;
    }
    if (!(it.weight > 0)) {
      excluded({ ...it, exclusionReason: undefined }, 'plan.progress.no_approved_weight');
      continue;
    }
    included++;
    den += it.weight;
    if (it.state === 'accepted') num += it.weight;
  }
  const percent = den === 0 ? null : Math.round((num / den) * 1000) / 10;
  const explanationI18n = den === 0 ? [planMessage('plan.progress.none')] : [planMessage('plan.progress.basis', { num, den, count: included, excluded: exclusions.length })];
  return {
    percent,
    numeratorWeight: num,
    denominatorWeight: den,
    includedCount: included,
    exclusions,
    explanation: planningEn(explanationI18n),
    explanationI18n,
  };
}

export interface RagThresholds {
  /** Working days of forecast slip vs baseline at or below which the item is green. */
  greenMaxSlipDays: number;
  /** Working days of slip at or below which the item is amber (above → red). */
  amberMaxSlipDays: number;
  /** Updates older than this are "stale" (not green). */
  staleAfterDays: number;
}

export const DEFAULT_RAG_THRESHOLDS: RagThresholds = { greenMaxSlipDays: 0, amberMaxSlipDays: 10, staleAfterDays: 14 };

/**
 * Which threshold set a calculated RAG used (REQ-PLN-019, DOM-P2-08): the project's approved threshold version, or the
 * proposed default of the pinned template version while no project version was approved. Named in every explanation that
 * compared a value against a threshold.
 */
export interface RagThresholdsRef {
  source: 'approved' | 'template_default';
  /** Project threshold version number (source `approved`), else null. */
  versionNo: number | null;
  /** Version number of the pinned template whose default applies (source `template_default`). */
  templateVersionNo: number;
}

export function ragThresholdsRefMessage(ref: RagThresholdsRef): ServerMessage {
  return ref.source === 'approved' && ref.versionNo !== null
    ? planMessage('plan.rag.thresholds_approved', { version: ref.versionNo })
    : planMessage('plan.rag.thresholds_template_default', { templateVersion: ref.templateVersionNo });
}

export interface RagInput {
  baselineFinish: string | null;
  forecastFinish: string | null;
  lastUpdatedOn: string | null; // local date of last accepted update
  today: string;
  hasOpenBlocker: boolean;
  thresholds?: RagThresholds;
  /** The threshold set `thresholds` comes from; when given, the explanation names it (REQ-PLN-019). */
  thresholdsRef?: RagThresholdsRef;
  calendar?: WorkingCalendar;
}

export interface RagResult {
  status: RagStatus;
  explanation: string;
  /** The explanation as codes + parameters (same content as `explanation`). */
  explanationI18n: ServerMessage[];
  slipDays: number | null;
}

const rag = (status: RagStatus, slipDays: number | null, code: string, params: Record<string, string | number> = {}, ref?: RagThresholdsRef): RagResult => {
  const explanationI18n = [planMessage(code, params), ...(ref ? [ragThresholdsRefMessage(ref)] : [])];
  return { status, explanation: planningEn(explanationI18n), explanationI18n, slipDays };
};

/**
 * Rule 4 & 5: configurable thresholds; unknown/stale/not updated are never green. Every result that consulted a threshold
 * (freshness window, slip limits) names the threshold set it used when `thresholdsRef` is given; an open blocker and a
 * missing update are decided before any threshold applies.
 */
export function calculateRag(input: RagInput): RagResult {
  const t = input.thresholds ?? DEFAULT_RAG_THRESHOLDS;
  const cal = input.calendar ?? DEFAULT_CALENDAR;
  const ref = input.thresholdsRef;
  // A known open blocker is always red — data-quality labels must never hide it (P0 review D-10).
  if (input.hasOpenBlocker) return rag('red', null, 'plan.rag.open_blocker');
  if (!input.lastUpdatedOn) return rag('not_updated', null, 'plan.rag.not_updated');
  const ageDays = Math.round((Date.parse(input.today) - Date.parse(input.lastUpdatedOn)) / 86_400_000);
  if (ageDays > t.staleAfterDays) return rag('stale', null, 'plan.rag.stale', { age: ageDays, limit: t.staleAfterDays }, ref);
  if (!input.baselineFinish || !input.forecastFinish) return rag('unknown', null, 'plan.rag.unknown', {}, ref);
  const slip = workingDaySlip(input.baselineFinish, input.forecastFinish, cal);
  if (slip <= t.greenMaxSlipDays) return rag('green', slip, 'plan.rag.green', { slip }, ref);
  if (slip <= t.amberMaxSlipDays) return rag('amber', slip, 'plan.rag.amber', { slip, limit: t.amberMaxSlipDays }, ref);
  return rag('red', slip, 'plan.rag.red', { slip, limit: t.amberMaxSlipDays }, ref);
}

const SEVERITY: Record<RagStatus, number> = { green: 0, amber: 1, unknown: 2, not_updated: 2, stale: 2, red: 3 };

/**
 * Rule 3: aggregation never lets a green average hide a red item. Worst-of, with unknown/stale ranked above
 * green/amber so data quality issues surface. Red critical items (blocking CPs, blockers) are reported explicitly.
 */
export function aggregateRag(items: { id: string; status: RagStatus; critical?: boolean }[]): {
  status: RagStatus;
  redCritical: string[];
  dataQualityIssues: string[];
  explanation: string;
  explanationI18n: ServerMessage[];
} {
  if (items.length === 0) {
    const explanationI18n = [planMessage('plan.rag.aggregate_empty')];
    return { status: 'unknown', redCritical: [], dataQualityIssues: [], explanation: planningEn(explanationI18n), explanationI18n };
  }
  let worst: RagStatus = 'green';
  for (const it of items) if (SEVERITY[it.status] > SEVERITY[worst]) worst = it.status;
  const redCritical = items.filter((i) => i.status === 'red' && i.critical).map((i) => i.id);
  const dq = items.filter((i) => ['unknown', 'stale', 'not_updated'].includes(i.status)).map((i) => i.id);
  const explanationI18n = [planMessage('plan.rag.aggregate', { count: items.length, status: worst, red: redCritical.length, gaps: dq.length })];
  return {
    status: worst,
    redCritical,
    dataQualityIssues: dq,
    explanation: planningEn(explanationI18n),
    explanationI18n,
  };
}

export interface RagOverride {
  overrideStatus: RagStatus;
  reason: string;
  expiresOn: string;
  reviewerUserId: string | null;
  approved: boolean;
}

/** Rule 6: overrides need reason/expiry/reviewer; calculated value is always retained. */
export function effectiveRag(calculated: RagResult, override: RagOverride | null, today: string) {
  const active = !!override && override.approved && !!override.reviewerUserId && override.reason.trim().length > 0 && override.expiresOn >= today;
  const explanationI18n: ServerMessage[] = active
    ? [planMessage('plan.rag.override', { reason: override!.reason, until: override!.expiresOn, calculated: calculated.status })]
    : (calculated.explanationI18n ?? []);
  return {
    calculated: calculated.status,
    effective: active ? override!.overrideStatus : calculated.status,
    overridden: active,
    overrideExpired: !!override && override.expiresOn < today,
    explanation: active ? planningEn(explanationI18n) : calculated.explanation,
    explanationI18n,
  };
}

/**
 * Rules 3 + 6 (DOM-P2-10, REQ-PLN-018): a manual override never displays a status better than RED while a red critical
 * item exists (an open blocker, a missed / overdue critical milestone — `openCriticalRed`). The approved override stays on
 * record (and applies again once the blockers are cleared, until it expires), but it is not applied meanwhile.
 */
export function capOverrideAtOpenBlockers(eff: ReturnType<typeof effectiveRag>, openCriticalRed: number): ReturnType<typeof effectiveRag> {
  if (!eff.overridden || openCriticalRed <= 0 || eff.effective === 'red') return eff;
  const explanationI18n = [planMessage('plan.rag.override_capped', { status: eff.effective, count: openCriticalRed, calculated: eff.calculated })];
  return {
    ...eff,
    effective: 'red',
    overridden: false,
    explanation: planningEn(explanationI18n),
    explanationI18n,
  };
}
