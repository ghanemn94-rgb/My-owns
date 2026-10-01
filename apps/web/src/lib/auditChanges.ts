// Audit-trail "Changes" in human terms (F-DG1-005, REQ-S15-007, M0302). The API records changed fields with their
// storage keys (snake_case, e.g. `current_phase`, or camelCase such as `archivedAt`) and raw values (enum codes, ids,
// ISO timestamps). This module turns each change into a localized field label and typed values so the screen shows
// catalogue labels for domain values. Anything without a catalogue label falls back to the raw key/code, LTR-isolated
// and explicitly marked "without a translation": never blank, never a guessed label.
import type { TFunction } from "i18next";

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
  | { readonly kind: "datetime"; readonly iso: string };

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
  | { readonly kind: "text" | "code" | "user" | "businessUnit" | "datetime" };

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
};

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
      return typeof value === "string" && !Number.isNaN(Date.parse(value))
        ? { kind: "datetime", iso: value }
        : { kind: "untranslated", raw: raw(value) };
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
