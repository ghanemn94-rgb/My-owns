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
import type { TFunction } from "i18next";
import { CRITERION_CODES, isCriterionCode } from "@mth/shared/calc";

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
  | { readonly kind: "text" | "code" | "user" | "businessUnit" | "datetime" | "role" | "scope" | "weights" };

/** Audited transformation fields (apps/api transformations repository) and how their values are presented. */
const FIELDS: Readonly<Record<string, ValueKind>> = {
  code: { kind: "code" },
  name: { kind: "text" },
  description: { kind: "text" },
  mode: { kind: "enum", prefix: "transformations.mode" },
  entry_phase: { kind: "enum", prefix: "transformations.phase" },
  current_phase: { kind: "enum", prefix: "transformations.phase" },
  standalone_deliverable_type: { kind: "enum", prefix: "transformations.deliverable" },
  status: { kind: "enum", prefix: "transformations.status" },
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
    case "text":
      return { kind: "text", text: raw(value) };
    case "code":
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
