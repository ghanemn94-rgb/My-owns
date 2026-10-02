// Pure domain rules of the kpi module (no I/O; unit-tested in rules.test.ts). Each returns null when the rule holds,
// or a violation with a stable code and a JSON pointer into the request body; routes turn it into a 422 problem.
// The database CHECKs of migration 0014 enforce the same invariants as a last line of defence.
import { compareDecimal, type TrajectoryPoint } from "@mth/shared/schemas";

export interface RuleViolation {
  readonly code: string;
  readonly detail: string;
  readonly pointer: string;
}

const v = (code: string, detail: string, pointer: string): RuleViolation => ({ code, detail, pointer });

/** kpi_definition_currency_unit: a currency KPI names its currency, and only a currency KPI does. */
export function kpiDefinitionUnitRule(unitKind: string, currency: string | null): RuleViolation | null {
  if (unitKind === "currency" && currency === null)
    return v("kpi_definition.currency_required", "A currency KPI needs its ISO 4217 currency.", "/currency");
  if (unitKind !== "currency" && currency !== null)
    return v(
      "kpi_definition.currency_not_allowed",
      "Only a KPI whose unit kind is currency can carry a currency.",
      "/currency",
    );
  return null;
}

/** T02 targets are time-bound (REQ-PB-034): a missing or null target date is a business-rule violation (422). */
export function targetDateRule(body: unknown, mode: "create" | "update"): RuleViolation | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null; // parseBody reports it (400)
  const entries = new Map(Object.entries(body));
  const missing = mode === "create" ? !entries.has("targetDate") || entries.get("targetDate") === null : false;
  const nulled = mode === "update" && entries.has("targetDate") && entries.get("targetDate") === null;
  if (missing || nulled)
    return v(
      "outcome_kpi.target_date_required",
      "Every T02 target needs a target date: targets are time-bound.",
      "/targetDate",
    );
  return null;
}

/** Trajectory points: strictly increasing dates, none after the target date. */
export function trajectoryRule(points: readonly TrajectoryPoint[], targetDate: string): RuleViolation | null {
  // `.at(i)`: module source has no runtime-keyed computed member (architecture lint rule 2, F-DG1-124).
  for (let i = 1; i < points.length; i++) {
    if (points.at(i)!.date <= points.at(i - 1)!.date)
      return v(
        "outcome_kpi.trajectory_order",
        "Trajectory points must have strictly increasing dates.",
        `/trajectoryPoints/${i}/date`,
      );
  }
  const last = points.at(-1);
  if (last && last.date > targetDate)
    return v(
      "outcome_kpi.trajectory_after_target",
      "A trajectory point cannot lie after the target date.",
      `/trajectoryPoints/${points.length - 1}/date`,
    );
  return null;
}

/** outcome_kpi_one_baseline_source: a T02 row takes its baseline from a baseline record OR a typed value. */
export function oneBaselineSourceRule(baselineId: string | null, baselineValue: string | null): RuleViolation | null {
  if (baselineId !== null && baselineValue !== null)
    return v(
      "outcome_kpi.one_baseline_source",
      "Give either a baseline record or a baseline value, not both.",
      "/baselineValue",
    );
  return null;
}

/** The target date must lie after the linked baseline's date (a target before its baseline is not a target). */
export function targetAfterBaselineRule(baselineDate: string | null, targetDate: string): RuleViolation | null {
  if (baselineDate !== null && targetDate <= baselineDate)
    return v(
      "outcome_kpi.target_not_after_baseline",
      "The target date must be after the baseline date.",
      "/targetDate",
    );
  return null;
}

export function leadingNotSelfRule(
  kpiDefinitionId: string,
  leadingKpiDefinitionId: string | null,
): RuleViolation | null {
  if (leadingKpiDefinitionId !== null && leadingKpiDefinitionId === kpiDefinitionId)
    return v("outcome_kpi.leading_is_self", "A KPI cannot be its own leading indicator.", "/leadingKpiDefinitionId");
  return null;
}

// ------------------------------------------------------------------------------------------------ T02 approval SoD

/**
 * The T02 columns that make up the target trajectory an approver signs off (F-DG2-141): which KPI, measured from
 * which baseline, to which target value, by which date, along which trajectory points. Changing any of them changes
 * what is approved, so whoever last changed one of them is an author of the current trajectory.
 */
export const TRAJECTORY_CONTENT_FIELDS = [
  "kpi_definition_id",
  "baseline_id",
  "baseline_value",
  "target_value",
  "target_date",
  "trajectory_points",
] as const;

/** One outcome_kpi audit event, as far as authorship is concerned (newest first when passed to targetAuthors). */
export interface AuthorshipEvent {
  readonly actorUserId: string | null;
  readonly onBehalfOfUserId: string | null;
  readonly changes: unknown;
}

/**
 * The people who authored the CURRENT trajectory content: for each content field, the actor (and the person acted
 * for) of the newest audit event whose diff touched that field. A field that no event touched still holds the value
 * the row was created with (a NULL at create time is not in the create diff), so its author is the row's creator.
 * Pure: the caller passes the row's audit events newest first.
 */
export function trajectoryAuthors(events: readonly AuthorshipEvent[], createdBy: string): ReadonlySet<string> {
  const authors = new Set<string>();
  for (const field of TRAJECTORY_CONTENT_FIELDS) {
    const latest = events.find((e) => touches(e.changes, field));
    if (!latest) {
      authors.add(createdBy);
      continue;
    }
    if (latest.actorUserId !== null) authors.add(latest.actorUserId);
    if (latest.onBehalfOfUserId !== null) authors.add(latest.onBehalfOfUserId);
  }
  return authors;
}

function touches(changes: unknown, field: string): boolean {
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) return false;
  return Object.prototype.hasOwnProperty.call(changes, field);
}

// ------------------------------------------------------------------------------------------------ KPI activation

/**
 * A KPI definition can be activated (draft -> active, F-DG2-201) only when it is measurable: a unit kind and a
 * polarity, a currency when the unit is a currency, and a unit label when the unit kind is "other" (the same rule
 * that makes gate facts report hasUnit). The status checks come first: already active or archived is 422.
 */
export function kpiDefinitionActivationRule(d: {
  status: string;
  unitKind: string | null;
  unitLabel: string | null;
  currency: string | null;
  polarity: string | null;
}): RuleViolation | null {
  if (d.status === "active")
    return v("kpi_definition.already_active", "The KPI definition is already active.", "/status");
  if (d.status !== "draft")
    return v("kpi_definition.not_draft", "Only a draft KPI definition can be activated.", "/status");
  if (d.unitKind === null)
    return v("kpi_definition.not_measurable", "A KPI needs a unit kind before it can be activated.", "/unitKind");
  if (d.polarity === null)
    return v("kpi_definition.not_measurable", "A KPI needs a polarity before it can be activated.", "/polarity");
  if (d.unitKind === "currency" && d.currency === null)
    return v(
      "kpi_definition.not_measurable",
      "A currency KPI needs its ISO 4217 currency before it can be activated.",
      "/currency",
    );
  if (d.unitKind === "other" && d.unitLabel === null)
    return v(
      "kpi_definition.not_measurable",
      'A KPI whose unit kind is "other" needs a unit label before it can be activated.',
      "/unitLabel",
    );
  return null;
}

/** A baseline is a measured current state: its date cannot lie in the future (in the transformation's zone). */
export function baselineDateRule(baselineDate: string | null, today: string): RuleViolation | null {
  if (baselineDate !== null && baselineDate > today)
    return v("baseline.date_in_future", "A baseline date cannot be in the future.", "/baselineDate");
  return null;
}

/** Finance can validate only a measurable baseline: value, source and baseline date (REQ-PB-027, CHECK). */
export function baselineMeasurableRule(r: {
  value: string | null;
  source: string | null;
  baselineDate: string | null;
}): RuleViolation | null {
  const missing = [
    r.value === null ? "value" : null,
    r.source === null ? "source" : null,
    r.baselineDate === null ? "baselineDate" : null,
  ].filter((x): x is string => x !== null);
  if (missing.length > 0)
    return v(
      "baseline.not_measurable",
      `A baseline can be validated only with a value, a source and a baseline date (missing: ${missing.join(", ")}).`,
      `/${missing[0]}`,
    );
  return null;
}

// ------------------------------------------------------------------------------------------------ value pools

export interface QuantificationState {
  readonly quantificationStatus: "quantified" | "unquantified";
  readonly upsideAmount: string | null;
  readonly downsideAmount: string | null;
  readonly unquantifiedReason: string | null;
}

export interface QuantificationPatch {
  readonly quantificationStatus?: "quantified" | "unquantified" | undefined;
  readonly upsideAmount?: string | null | undefined;
  readonly downsideAmount?: string | null | undefined;
  readonly unquantifiedReason?: string | null | undefined;
}

export const UNQUANTIFIED: QuantificationState = Object.freeze({
  quantificationStatus: "unquantified",
  upsideAmount: null,
  downsideAmount: null,
  unquantifiedReason: null,
});

/**
 * Resolves the quantification state after a create/update (ADR-0019 §1). Quantified: both amounts present and
 * downside <= upside, no unquantified reason. Unquantified: both amounts NULL - never 0. Switching state clears the
 * fields that no longer apply unless the request sets them explicitly, which is a violation.
 */
export function resolveQuantification(
  current: QuantificationState,
  patch: QuantificationPatch,
): { state: QuantificationState; violation: RuleViolation | null } {
  const status = patch.quantificationStatus ?? current.quantificationStatus;
  if (status === "quantified") {
    if (patch.unquantifiedReason !== undefined && patch.unquantifiedReason !== null)
      return fail(
        "value_pool.reason_with_amounts",
        "A quantified value pool has no unquantified reason.",
        "/unquantifiedReason",
      );
    const up = patch.upsideAmount !== undefined ? patch.upsideAmount : current.upsideAmount;
    const down = patch.downsideAmount !== undefined ? patch.downsideAmount : current.downsideAmount;
    if (up === null || up === undefined)
      return fail("value_pool.amounts_required", "A quantified value pool needs an upside amount.", "/upsideAmount");
    if (down === null || down === undefined)
      return fail("value_pool.amounts_required", "A quantified value pool needs a downside amount.", "/downsideAmount");
    if (compareDecimal(down, up) > 0)
      return fail(
        "value_pool.downside_above_upside",
        "The downside amount cannot exceed the upside amount.",
        "/downsideAmount",
      );
    return {
      state: { quantificationStatus: "quantified", upsideAmount: up, downsideAmount: down, unquantifiedReason: null },
      violation: null,
    };
  }
  for (const [field, value] of [
    ["upsideAmount", patch.upsideAmount],
    ["downsideAmount", patch.downsideAmount],
  ] as const) {
    if (value !== undefined && value !== null)
      return fail(
        "value_pool.unquantified_has_amount",
        "An unquantified value pool has no amounts (set quantificationStatus to quantified to give amounts).",
        `/${field}`,
      );
  }
  const reason = patch.unquantifiedReason !== undefined ? patch.unquantifiedReason : current.unquantifiedReason;
  return {
    state: {
      quantificationStatus: "unquantified",
      upsideAmount: null,
      downsideAmount: null,
      unquantifiedReason: reason,
    },
    violation: null,
  };

  function fail(code: string, detail: string, pointer: string) {
    return { state: current, violation: v(code, detail, pointer) };
  }
}

// ------------------------------------------------------------------------------------------------ dates

/** Today's calendar date "YYYY-MM-DD" in an IANA time zone (default Asia/Riyadh for transformations). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
