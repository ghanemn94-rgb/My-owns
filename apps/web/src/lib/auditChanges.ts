// Audit-trail "Changes" in human terms (F-DG1-005, REQ-S15-007, M0302). The API records changed fields with their
// storage keys (snake_case, e.g. `current_phase`, or camelCase such as `archivedAt`) and raw values (enum codes, ids,
// ISO timestamps). This module turns each change into a localized field label and typed values so the screen shows
// catalogue labels for domain values. Anything without a catalogue label falls back to the raw key/code, LTR-isolated
// and explicitly marked "without a translation": never blank, never a guessed label.
//
// F-DG1-008: a transformation's trail also carries the role-assignment events written on it (`scoped_assignment.*`,
// e.g. the derived creator assignment of F-DG1-106: userId, roleCode, scope, effectiveTo, derivedFromAssignmentId),
// so their action, fields and values (user, role, scope) have catalogue labels too.
//
// P3 (T-DG3-FE-A0): creating a transformation also writes the P3 starter structure (0024/0025
// p3_instantiate_transformation): `roadmap_wave.create` (no changes) and `scoring_weight_set.create` with
// `weights: {criterion: "25.00", …}`. The weights are shown as localized criterion names with their exact decimal
// percentages (never converted to numbers).
//
// P3 (T-DG3-FE-A): every P3 record type that writes to a transformation's trail has labelled actions and fields:
// initiative and its links, selection, funding decision, weight set, score, ranking, override, wave, deliverable,
// milestone, dependency and dependency type, capacity and resource demand, business case and line, benefit formula,
// version and calculation, dispensation and the G1 gate agreement. Statuses of P3 records fall back from the
// transformation catalogue to `transformations.audit.status.*`; P3 enum codes (kind, action, link target type,
// acceptance, decision result) have `transformations.audit.value.<field>.*` labels. Decimal strings (amounts, scores,
// FTE) are shown exactly as recorded (never converted to numbers); dates, ids, counts and engine codes are shown as
// technical identifiers; structured values (trajectories, variables, agreements) as compact LTR JSON.
//
// T-DG3-FE-E: the remaining P3 enum codes are labelled too (`line_kind`, `benefit_class`, `investment_class`,
// `unit_kind`, `polarity`, `confidence`, `result_kind`, `result_period`, `frequency`, `recurrence`). `result_unit` and
// `result_currency` stay technical codes: they are a free unit text and an ISO 4217 code, not enums.
import type { TFunction } from "i18next";
import { CRITERION_CODES, isCriterionCode } from "@mth/shared/calc";
import {
  BENEFIT_CLASSES,
  BENEFIT_FORMULA_KINDS,
  BENEFIT_FORMULA_PERIODS,
  CONFIDENCES,
  INVESTMENT_CLASSES,
  KPI_FREQUENCIES,
  KPI_POLARITIES,
  KPI_UNIT_KINDS,
  LINE_KINDS,
} from "@mth/shared/schemas";

/** How one side (from / to) of a change is shown. */
export type AuditValue =
  | { readonly kind: "none" }
  /** A domain enum code with a catalogue label (status, mode, phase, deliverable). */
  | { readonly kind: "label"; readonly text: string; readonly code: string }
  /** A value that should have a label but has none in the catalogue: shown raw and marked. */
  | { readonly kind: "untranslated"; readonly raw: string }
  /** Free text entered by a user (name, description, reason). */
  | { readonly kind: "text"; readonly text: string }
  /** A technical identifier kept readable as-is, LTR (code, time zone, currency). */
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "user"; readonly id: string }
  | { readonly kind: "businessUnit"; readonly id: string }
  /** The scope of a role assignment ({ type, id }): shown as the scope type plus the scope's name. */
  | { readonly kind: "scope"; readonly scopeType: ScopeType; readonly id: string }
  | { readonly kind: "datetime"; readonly iso: string };

/** Scope types a role assignment can carry (ADR-0006; packages/shared assignment schema). */
export const AUDIT_SCOPE_TYPES = ["organization", "business_unit", "transformation"] as const;
export type ScopeType = (typeof AUDIT_SCOPE_TYPES)[number];

export interface AuditFieldChange {
  /** The field key as recorded by the API. */
  readonly field: string;
  /** Localized field label, or null when the catalogue has none (the caller shows the key, marked). */
  readonly label: string | null;
  readonly from: AuditValue;
  readonly to: AuditValue;
}

type ValueKind =
  | { readonly kind: "enum"; readonly prefix: string }
  | { readonly kind: "p3enum"; readonly prefix: string; readonly codes?: readonly string[] }
  | {
      readonly kind:
        | "text"
        | "code"
        | "user"
        | "businessUnit"
        | "datetime"
        | "role"
        | "scope"
        | "weights"
        | "status"
        | "boolean"
        | "json"
        | "criterion";
    };

const TEXT = { kind: "text" } as const;
const CODE = { kind: "code" } as const;
const USER = { kind: "user" } as const;
const DATETIME = { kind: "datetime" } as const;
const JSON_VALUE = { kind: "json" } as const;
const BOOL = { kind: "boolean" } as const;
/** Business-case line recurrence (shared business-case schema: `z.enum(["one_off", "recurring"])`). */
const RECURRENCES = ["one_off", "recurring"] as const;
const p3enum = (field: string, codes?: readonly string[]): ValueKind => ({
  kind: "p3enum",
  prefix: `transformations.audit.value.${field}`,
  ...(codes ? { codes } : {}),
});

/**
 * P3 record fields (T-DG3-FE-A): initiative (T05) and its links, selection, ranking and scores, waves, deliverables,
 * milestones, overrides, weight sets, dispensations, gate submissions and agreements, business cases and lines,
 * benefit formulas and versions, funding and capacity. Ids, dates, counts and decimal strings are `code` (exact, LTR).
 */
const P3_FIELDS: Readonly<Record<string, ValueKind>> = {
  // initiative (T05)
  executive_owner_user_id: USER,
  workstream_lead_user_id: USER,
  problem_statement: TEXT,
  objective: TEXT,
  scope_in: TEXT,
  scope_out: TEXT,
  financial_benefit_summary: TEXT,
  customer_benefit_summary: TEXT,
  risks_summary: TEXT,
  wave_id: CODE,
  planned_start: CODE,
  planned_end: CODE,
  launched_at: DATETIME,
  launched_by: USER,
  cancelled_at: DATETIME,
  cancelled_by: USER,
  cancel_reason: TEXT,
  // links, selection, ranking, scores, overrides
  initiative_id: CODE,
  decision_id: CODE,
  outcome_id: CODE,
  outcome_kpi_id: CODE,
  tom_gap_id: CODE,
  diagnostic_finding_id: CODE,
  target_type: p3enum("target_type"),
  note: TEXT,
  contribution_statement: TEXT,
  expected_kpi_movement: TEXT,
  remove_reason: TEXT,
  action: p3enum("action"),
  rationale: TEXT,
  ranking_snapshot_id: CODE,
  snapshot_no: CODE,
  weight_set_version_no: CODE,
  ranked: CODE,
  incomplete: CODE,
  supersedes: CODE,
  superseded_by: CODE,
  rank: CODE,
  override_rank: CODE,
  criterion_code: { kind: "criterion" },
  score: CODE,
  version_no: CODE,
  current_version_no: CODE,
  approved_by: USER,
  decided_by: USER,
  revoked_by: USER,
  submitted_by: USER,
  validated_by: USER,
  recorded_by: USER,
  rescored_initiatives: JSON_VALUE,
  // waves, deliverables, milestones
  ordinal: CODE,
  name_en: TEXT,
  name_ar: TEXT,
  purpose_en: TEXT,
  purpose_ar: TEXT,
  horizon_en: TEXT,
  horizon_ar: TEXT,
  entry_criteria_en: TEXT,
  entry_criteria_ar: TEXT,
  exit_evidence_en: TEXT,
  exit_evidence_ar: TEXT,
  horizon_from_weeks: CODE,
  horizon_to_weeks: CODE,
  owner_user_id: USER,
  notes: TEXT,
  title: TEXT,
  due_date: CODE,
  acceptance_status: p3enum("acceptance_status"),
  acceptance_note: TEXT,
  approved_date: CODE,
  approval_reason: TEXT,
  forecast_date: CODE,
  actual_date: CODE,
  achieved: BOOL,
  // dispensations, gate submissions and decisions (G1 agreements)
  kind: p3enum("kind"),
  gate_code: CODE,
  approving_body: TEXT,
  approved_on: CODE,
  evidence_id: CODE,
  expires_on: CODE,
  reason: TEXT,
  decision_note: TEXT,
  revoke_reason: TEXT,
  result: p3enum("result"),
  outcome: p3enum("outcome"),
  submission_no: CODE,
  latest_submission_no: CODE,
  snapshot_sha256: CODE,
  charter_version_no: CODE,
  agreements: JSON_VALUE,
  // business cases and lines, formulas, versions and calculations
  level: CODE,
  amount: CODE,
  upside_amount: CODE,
  downside_amount: CODE,
  baseline_value: CODE,
  target_value: CODE,
  value: CODE,
  fte: CODE,
  baseline_date: CODE,
  target_date: CODE,
  period_start: CODE,
  period_end: CODE,
  baseline_driver: TEXT,
  baseline_id: CODE,
  baseline_validated_by: USER,
  baseline_validation_note: TEXT,
  baseline_validation_status: p3enum("validation_status"),
  validation_status: p3enum("validation_status"),
  validation_note: TEXT,
  benefit_class: p3enum("benefit_class", BENEFIT_CLASSES),
  benefit_name: TEXT,
  business_purpose: TEXT,
  change_assumption: TEXT,
  change_note: TEXT,
  confidence: p3enum("confidence", CONFIDENCES),
  data_source: TEXT,
  decision_ask_types: JSON_VALUE,
  driver: TEXT,
  engine_version: CODE,
  example_code: CODE,
  expression: CODE,
  frequency: p3enum("frequency", KPI_FREQUENCIES),
  investment_class: p3enum("investment_class", INVESTMENT_CLASSES),
  is_illustrative: BOOL,
  is_leading: BOOL,
  kpi_definition_id: CODE,
  leading_indicator_text: TEXT,
  leading_kpi_definition_id: CODE,
  line_kind: p3enum("line_kind", LINE_KINDS),
  materiality: CODE,
  metric: TEXT,
  polarity: p3enum("polarity", KPI_POLARITIES),
  preview_result: JSON_VALUE,
  quantification_status: CODE,
  ramp: JSON_VALUE,
  recurrence: p3enum("recurrence", RECURRENCES),
  result_currency: CODE,
  result_kind: p3enum("result_kind", BENEFIT_FORMULA_KINDS),
  result_period: p3enum("result_period", BENEFIT_FORMULA_PERIODS),
  result_unit: CODE,
  source: TEXT,
  steward_user_id: USER,
  trajectory_points: JSON_VALUE,
  trajectory_status: CODE,
  unit: CODE,
  unit_kind: p3enum("unit_kind", KPI_UNIT_KINDS),
  unit_label: TEXT,
  unquantified_reason: TEXT,
  value_basis: CODE,
  workstream_code: CODE,
  variables: JSON_VALUE,
  id: CODE,
  // funding, capacity and resource demand (BE-E; checked against apps/api/src/modules/portfolio/{funding,capacity,
  // resource-demands}.ts by T-DG3-FE-E: resource_role.* writes `code`, `label_en`, `label_ar` and `status`)
  label_en: TEXT,
  label_ar: TEXT,
  funding_source: TEXT,
  conditions: TEXT,
  business_case_id: CODE,
  approver_role_code: { kind: "role" },
  decision_code: CODE,
  resource_role_id: CODE,
  role_id: CODE,
  period: CODE,
  period_month: CODE,
  available_fte: CODE,
  demand_fte: CODE,
  committed_by: USER,
  committed_at: DATETIME,
  released_at: DATETIME,
};

/** Audited transformation fields (apps/api transformations repository) and how their values are presented. */
const FIELDS: Readonly<Record<string, ValueKind>> = {
  code: { kind: "code" },
  name: { kind: "text" },
  description: { kind: "text" },
  mode: { kind: "enum", prefix: "transformations.mode" },
  entry_phase: { kind: "enum", prefix: "transformations.phase" },
  current_phase: { kind: "enum", prefix: "transformations.phase" },
  standalone_deliverable_type: { kind: "enum", prefix: "transformations.deliverable" },
  status: { kind: "status" },
  sponsor_user_id: { kind: "user" },
  lead_user_id: { kind: "user" },
  timezone: { kind: "code" },
  currency: { kind: "code" },
  business_unit_id: { kind: "businessUnit" },
  archived_at: { kind: "datetime" },
  archive_reason: { kind: "text" },
  // Role-assignment events (apps/api access/assignments.ts) shown on the transformation they were written on.
  user_id: { kind: "user" },
  role_code: { kind: "role" },
  scope: { kind: "scope" },
  effective_from: { kind: "datetime" },
  effective_to: { kind: "datetime" },
  derived_from_assignment_id: { kind: "code" },
  revoked_at: { kind: "datetime" },
  // P3 prioritization weight set (scoring_weight_set.create): criterion code -> percent as a decimal string.
  weights: { kind: "weights" },
  ...P3_FIELDS,
};

/** A weight percent as recorded: a decimal string 0-100 with at most two fraction digits (ADR-0022). */
const PERCENT = /^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/;

/** Catalogue key of an audit action ("transformation.create" -> "...actions.transformation_create"), or null. */
export function auditActionKey(action: string, changes?: Readonly<Record<string, unknown>> | null): string | null {
  // Only a plain dotted code may become a catalogue key (it must not address another catalogue entry).
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(action)) return null;
  // The creator assignment carried over from a business-unit grant (F-DG1-106) reads differently from a manual grant.
  const derived =
    action === "scoped_assignment.create" &&
    changes !== null &&
    changes !== undefined &&
    "derivedFromAssignmentId" in changes;
  return `transformations.audit.actions.${action.replace(/\./g, "_")}${derived ? "_derived" : ""}`;
}

/** Localized action label, or null when the catalogue has none (the caller shows the raw code, marked). */
export function describeAuditAction(
  t: TFunction,
  action: string,
  changes?: Readonly<Record<string, unknown>> | null,
): string | null {
  const key = auditActionKey(action, changes);
  return key ? t(key, { defaultValue: "" }) || null : null;
}

const ROLE_CODE = /^[A-Z][A-Z_]*$/;

/** `archivedAt` -> `archived_at`; snake_case keys are returned unchanged. */
export function auditFieldKey(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const ENUM_CODE = /^[a-z][a-z0-9_]*$/;

function raw(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function describeAuditValue(t: TFunction, field: string, value: unknown): AuditValue {
  if (value === null || value === undefined || value === "") return { kind: "none" };
  const spec = FIELDS[auditFieldKey(field)];
  if (!spec) return { kind: "untranslated", raw: raw(value) };
  switch (spec.kind) {
    case "enum": {
      // Only a plain code may become a catalogue key (no dots: a value must not address another catalogue entry).
      if (typeof value !== "string" || !ENUM_CODE.test(value)) return { kind: "untranslated", raw: raw(value) };
      const text = t(`${spec.prefix}.${value}`, { defaultValue: "" });
      return text ? { kind: "label", text, code: value } : { kind: "untranslated", raw: value };
    }
    case "status": {
      // A transformation status first (DG1), then the statuses of the P2/P3 records on the same trail.
      if (typeof value !== "string" || !ENUM_CODE.test(value)) return { kind: "untranslated", raw: raw(value) };
      const text =
        t(`transformations.status.${value}`, { defaultValue: "" }) ||
        t(`transformations.audit.status.${value}`, { defaultValue: "" });
      return text ? { kind: "label", text, code: value } : { kind: "untranslated", raw: value };
    }
    case "p3enum": {
      if (spec.codes) {
        // A closed code set (T-DG3-FE-E): only a listed code becomes a key. `confidence` is stored as char(1)-like
        // H/M/L, so surrounding spaces are trimmed first.
        const code = typeof value === "string" ? value.trim() : "";
        if (!spec.codes.includes(code)) return { kind: "untranslated", raw: raw(value) };
        const text = t(`${spec.prefix}.${code}`, { defaultValue: "" });
        return text ? { kind: "label", text, code } : { kind: "untranslated", raw: code };
      }
      if (typeof value !== "string" || !ENUM_CODE.test(value)) return { kind: "untranslated", raw: raw(value) };
      const text = t(`${spec.prefix}.${value}`, { defaultValue: "" });
      return text ? { kind: "label", text, code: value } : { kind: "untranslated", raw: value };
    }
    case "criterion": {
      if (typeof value !== "string" || !isCriterionCode(value)) return { kind: "untranslated", raw: raw(value) };
      return { kind: "label", text: t(`transformations.audit.criterion.${value}`), code: value };
    }
    case "boolean":
      return typeof value === "boolean"
        ? { kind: "label", text: t(`transformations.audit.value.${value ? "yes" : "no"}`), code: String(value) }
        : { kind: "untranslated", raw: raw(value) };
    case "json":
      return { kind: "code", text: raw(value) };
    case "text":
      return { kind: "text", text: raw(value) };
    case "code":
      // Ids, dates, counts and decimal strings exactly as recorded (a number is printed, never re-computed).
      return { kind: "code", text: raw(value) };
    case "user":
      return typeof value === "string" ? { kind: "user", id: value } : { kind: "untranslated", raw: raw(value) };
    case "businessUnit":
      return typeof value === "string"
        ? { kind: "businessUnit", id: value }
        : { kind: "untranslated", raw: raw(value) };
    case "datetime":
      // The API records a revocation time as "now" (the event's own time, shown in the "When" column).
      if (value === "now") return { kind: "label", text: t("transformations.audit.value.eventTime"), code: "now" };
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? { kind: "datetime", iso: value }
        : { kind: "untranslated", raw: raw(value) };
    case "role": {
      if (typeof value !== "string" || !ROLE_CODE.test(value)) return { kind: "untranslated", raw: raw(value) };
      const text = t(`transformations.audit.role.${value}`, { defaultValue: "" });
      return text ? { kind: "label", text, code: value } : { kind: "untranslated", raw: value };
    }
    case "weights": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { kind: "untranslated", raw: raw(value) };
      }
      const entries = Object.entries(value as Record<string, unknown>);
      const valid =
        entries.length > 0 &&
        entries.every(([code, pct]) => isCriterionCode(code) && typeof pct === "string" && PERCENT.test(pct));
      if (!valid) return { kind: "untranslated", raw: raw(value) };
      const byCode = new Map(entries);
      const text = CRITERION_CODES.filter((c) => byCode.has(c))
        .map((c) =>
          t("transformations.audit.value.weight", {
            criterion: t(`transformations.audit.criterion.${c}`),
            percent: byCode.get(c) as string,
          }),
        )
        .join(t("transformations.audit.value.listSeparator"));
      return { kind: "label", text, code: "weights" };
    }
    case "scope": {
      // A business case's `scope` is free text; a role assignment's is { type, id }.
      if (typeof value === "string") return { kind: "text", text: value };
      const v = value as { type?: unknown; id?: unknown };
      return typeof v === "object" &&
        typeof v.type === "string" &&
        (AUDIT_SCOPE_TYPES as readonly string[]).includes(v.type) &&
        typeof v.id === "string" &&
        v.id !== ""
        ? { kind: "scope", scopeType: v.type as ScopeType, id: v.id }
        : { kind: "untranslated", raw: raw(value) };
    }
  }
}

export function describeAuditChange(
  t: TFunction,
  field: string,
  change: { readonly from: unknown; readonly to: unknown },
): AuditFieldChange {
  const key = auditFieldKey(field);
  const label = FIELDS[key] ? t(`transformations.audit.field.${key}`, { defaultValue: "" }) || null : null;
  return {
    field,
    label,
    from: describeAuditValue(t, field, change.from),
    to: describeAuditValue(t, field, change.to),
  };
}

/** Fields in a stable, readable order (the catalogue order above), unknown fields last. */
export function describeAuditChanges(
  t: TFunction,
  changes: Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>,
): AuditFieldChange[] {
  const order = Object.keys(FIELDS);
  const rank = (f: string) => {
    const i = order.indexOf(auditFieldKey(f));
    return i === -1 ? order.length : i;
  };
  return Object.entries(changes)
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([field, change]) => describeAuditChange(t, field, change));
}
