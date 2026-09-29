import type { RagStatus } from './enums';
import { workingDaySlip, WorkingCalendar, DEFAULT_CALENDAR } from './calendar';

/**
 * Measurement rules (spec §9 "Measurement rules" 1–8).
 */

export interface WeightedItem {
  id: string;
  label?: string;
  weight: number; // approved deliverable weight (> 0)
  /** Accepted = counts as complete. Anything else counts as incomplete. */
  state: 'accepted' | 'in_progress' | 'not_started' | 'cancelled' | 'excluded';
  exclusionReason?: string;
}

export interface WeightedProgress {
  percent: number | null; // null when denominator is zero
  numeratorWeight: number;
  denominatorWeight: number;
  includedCount: number;
  exclusions: { id: string; label?: string; reason: string }[];
  explanation: string;
}

/** Rule 1 & 2: weighted progress with an explicit denominator; cancelled items are excluded, never "complete". */
export function weightedProgress(items: WeightedItem[]): WeightedProgress {
  const exclusions: WeightedProgress['exclusions'] = [];
  let num = 0, den = 0, included = 0;
  for (const it of items) {
    if (it.state === 'cancelled' || it.state === 'excluded') {
      exclusions.push({ id: it.id, label: it.label, reason: it.exclusionReason ?? (it.state === 'cancelled' ? 'Cancelled' : 'Excluded') });
      continue;
    }
    if (!(it.weight > 0)) {
      exclusions.push({ id: it.id, label: it.label, reason: 'No approved weight' });
      continue;
    }
    included++;
    den += it.weight;
    if (it.state === 'accepted') num += it.weight;
  }
  const percent = den === 0 ? null : Math.round((num / den) * 1000) / 10;
  return {
    percent,
    numeratorWeight: num,
    denominatorWeight: den,
    includedCount: included,
    exclusions,
    explanation:
      den === 0
        ? 'No weighted deliverables in scope — progress cannot be calculated.'
        : `${num} of ${den} weight points accepted across ${included} deliverable(s); ${exclusions.length} excluded.`,
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

export interface RagInput {
  baselineFinish: string | null;
  forecastFinish: string | null;
  lastUpdatedOn: string | null; // local date of last accepted update
  today: string;
  hasOpenBlocker: boolean;
  thresholds?: RagThresholds;
  calendar?: WorkingCalendar;
}

export interface RagResult {
  status: RagStatus;
  explanation: string;
  slipDays: number | null;
}

/** Rule 4 & 5: configurable thresholds; unknown/stale/not updated are never green. */
export function calculateRag(input: RagInput): RagResult {
  const t = input.thresholds ?? DEFAULT_RAG_THRESHOLDS;
  const cal = input.calendar ?? DEFAULT_CALENDAR;
  // A known open blocker is always red — data-quality labels must never hide it (P0 review D-10).
  if (input.hasOpenBlocker) return { status: 'red', explanation: 'An open blocker is recorded.', slipDays: null };
  if (!input.lastUpdatedOn) return { status: 'not_updated', explanation: 'No accepted update has been recorded.', slipDays: null };
  const ageDays = Math.round((Date.parse(input.today) - Date.parse(input.lastUpdatedOn)) / 86_400_000);
  if (ageDays > t.staleAfterDays) {
    return { status: 'stale', explanation: `Last accepted update is ${ageDays} days old (stale after ${t.staleAfterDays}).`, slipDays: null };
  }
  if (!input.baselineFinish || !input.forecastFinish) {
    return { status: 'unknown', explanation: 'Baseline or forecast finish is missing.', slipDays: null };
  }
  const slip = workingDaySlip(input.baselineFinish, input.forecastFinish, cal);
  if (slip <= t.greenMaxSlipDays) return { status: 'green', explanation: `Forecast within tolerance (slip ${slip} working days).`, slipDays: slip };
  if (slip <= t.amberMaxSlipDays) return { status: 'amber', explanation: `Forecast slip of ${slip} working days (amber ≤ ${t.amberMaxSlipDays}).`, slipDays: slip };
  return { status: 'red', explanation: `Forecast slip of ${slip} working days exceeds ${t.amberMaxSlipDays}.`, slipDays: slip };
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
} {
  if (items.length === 0) return { status: 'unknown', redCritical: [], dataQualityIssues: [], explanation: 'No items to aggregate.' };
  let worst: RagStatus = 'green';
  for (const it of items) if (SEVERITY[it.status] > SEVERITY[worst]) worst = it.status;
  const redCritical = items.filter((i) => i.status === 'red' && i.critical).map((i) => i.id);
  const dq = items.filter((i) => ['unknown', 'stale', 'not_updated'].includes(i.status)).map((i) => i.id);
  return {
    status: worst,
    redCritical,
    dataQualityIssues: dq,
    explanation: `Worst-of ${items.length} item(s): ${worst}. ${redCritical.length} critical red, ${dq.length} with data-quality gaps.`,
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
  return {
    calculated: calculated.status,
    effective: active ? override!.overrideStatus : calculated.status,
    overridden: active,
    overrideExpired: !!override && override.expiresOn < today,
    explanation: active ? `Manual override (${override!.reason}) until ${override!.expiresOn}; calculated: ${calculated.status}.` : calculated.explanation,
  };
}
