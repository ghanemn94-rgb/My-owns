// Server-side value validation of the Studio field types (REQ-S06-005, REQ-S16-010; ADR-0041 §3, §4, §7, §10).
// Owner: kpi-benefits-engineer (T-DG5-KBE-B). Pure: no I/O, no clock, no float.
//
// `validateFieldValue(field, raw)` → `{ok: true, value, checks}` with the value in its STORED shape, or
// `{ok: false, code, message, params}` with the type's exact ADR-0041 §10 field code and English text. The API
// (`forms/custom-values.ts`, BE-D) and procedure inputs (ADR-0042 §2) call it before persistence; the web calls it for
// the same messages. The database (`form_custom_value_type_shape`) repeats the shape check as the last line.
//
// What a pure function cannot know is returned as `checks` for the caller to verify INSIDE its transaction, never
// skipped: a reference names a record of `targetRecordType` in the same transformation; attachments name evidence of
// the same transformation; a lookup value is an active member of its set (unless the caller passed the members).
//
// Unknown is not zero: null (or an absent value) is Unknown and stays null; it is never replaced by "0" or "". A
// JavaScript number is refused on every decimal path (a float may already have lost precision).
import { hasInvalidCharacter, hasVisibleContent } from "../schemas/common.ts";
import {
  CURRENCY_CODE_PATTERN,
  FD,
  FIELD_DECIMAL_PATTERN,
  FIELD_VALUE_MESSAGES,
  FORM_SCHEMA_MESSAGES,
  FIELD_LIMITS,
  significantScale,
  UUID_PATTERN,
  type FieldDefinition,
  type FieldValueCode,
  type FieldType,
  type LookupSet,
} from "./field-types.ts";
import { normalizeCurrency, normalizeDate, normalizePercentage, type CurrencyValue } from "./normalize.ts";

/** A stored field value (JSON): decimal strings, `{amount, currencyCode}`, `YYYY-MM-DD`, uuids, strings, arrays. */
export type StoredFieldValue = string | CurrencyValue | readonly string[];

/** A check the caller must make in its transaction (see the file header). */
export type DeferredCheck =
  | { readonly kind: "reference"; readonly field: string; readonly targetRecordType: string; readonly id: string }
  | { readonly kind: "attachment"; readonly field: string; readonly evidenceIds: readonly string[] }
  | { readonly kind: "lookup"; readonly field: string; readonly lookupSet: LookupSet; readonly value: string };

export type FieldValueResult =
  | { readonly ok: true; readonly value: StoredFieldValue | null; readonly checks: readonly DeferredCheck[] }
  | {
      readonly ok: false;
      /** A 400 field code, or 422 `form_record.custom_field_unknown` for a calculated field (never stored). */
      readonly code: FieldValueCode | "form_record.custom_field_unknown";
      readonly message: string;
      /** `reason` says which rule failed (for logs and i18n detail); `field` names the field. */
      readonly params: Readonly<Record<string, string>>;
    };

export interface ValidateOptions {
  /** How a bare percentage is read: "fraction" (API body, default) or "percent" (typed by a user). */
  readonly percentageBareAs?: "fraction" | "percent";
  /** The active members of a lookup set, when the caller has them; otherwise a `lookup` check is returned. */
  readonly lookupMembers?: Partial<Readonly<Record<LookupSet, ReadonlySet<string>>>>;
}

function refuse(field: string, code: FieldValueCode, reason: string): FieldValueResult {
  return { ok: false, code, message: FIELD_VALUE_MESSAGES[code], params: { field, reason } };
}
function accept(value: StoredFieldValue, checks: readonly DeferredCheck[] = []): FieldValueResult {
  return { ok: true, value, checks };
}

/** A token (choice value, lookup value): a visible, storable string of 1-100 characters. */
function isToken(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length >= 1 &&
    v.length <= FIELD_LIMITS.tokenMaxLength &&
    !hasInvalidCharacter(v) &&
    hasVisibleContent(v)
  );
}

function asUuid(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const lower = v.toLowerCase();
  return UUID_PATTERN.test(lower) ? lower : null;
}

function textRule(field: string, raw: unknown, max: number, code: FieldValueCode): FieldValueResult {
  if (typeof raw !== "string") return refuse(field, code, "not_a_string");
  if (raw.length === 0) return refuse(field, code, "too_short");
  if (raw.length > max) return refuse(field, code, "too_long");
  // The shared free-text predicates (p5-work-split §2 rule 1); text is stored exactly as entered.
  if (hasInvalidCharacter(raw)) return refuse(field, code, "invalid_character");
  if (!hasVisibleContent(raw)) return refuse(field, code, "blank");
  return accept(raw);
}

function inRange(value: string, min: string | undefined, max: string | undefined): boolean {
  const d = new FD(value);
  return (min === undefined || d.gte(new FD(min))) && (max === undefined || d.lte(new FD(max)));
}

/**
 * Validates and normalizes one value against its field (ADR-0041 §3). null/undefined → Unknown (`value: null`); whether
 * the field is required is a record-level rule (`validateRecordValues`).
 */
export function validateFieldValue(
  field: FieldDefinition,
  raw: unknown,
  options: ValidateOptions = {},
): FieldValueResult {
  const key = field.key;
  if (field.fieldType === "calculated") {
    return {
      ok: false,
      code: "form_record.custom_field_unknown",
      message: FORM_SCHEMA_MESSAGES["form_record.custom_field_unknown"],
      params: { field: key, reason: "calculated" },
    };
  }
  if (raw === null || raw === undefined) return { ok: true, value: null, checks: [] };
  switch (field.fieldType) {
    case "text":
      return textRule(key, raw, field.settings.maxLength, "validation.text");
    case "rich_text":
      // The DG2 rich-text subset: plain text stored verbatim (no markup is interpreted or stored as HTML; the web
      // renders it escaped), up to 20000 characters (the DG2 `freeText(1, 20000)` columns such as T03 `gap`).
      return textRule(key, raw, field.settings.maxLength, "validation.rich_text");
    case "number": {
      if (typeof raw !== "string") return refuse(key, "validation.decimal", "not_a_string");
      if (!FIELD_DECIMAL_PATTERN.test(raw)) return refuse(key, "validation.decimal", "format");
      if (significantScale(raw) > field.settings.scale) return refuse(key, "validation.decimal", "scale");
      if (!inRange(raw, field.settings.min, field.settings.max)) return refuse(key, "validation.decimal", "range");
      return accept(raw);
    }
    case "currency": {
      const r = normalizeCurrency(raw, field.settings.currencyCode, field.settings.scale);
      if (!r.ok) {
        return r.reason === "currency_code"
          ? refuse(key, "validation.currency_code", "format")
          : refuse(key, "validation.currency_amount", r.reason);
      }
      // A field holds one currency (its settings); there is no FX conversion, so another code is refused.
      if (r.value.currencyCode !== field.settings.currencyCode) {
        return refuse(key, "validation.currency_code", "currency_mismatch");
      }
      return accept(r.value);
    }
    case "percentage": {
      const r = normalizePercentage(raw, { bareAs: options.percentageBareAs ?? "fraction" });
      if (!r.ok) return refuse(key, "validation.percentage", r.reason);
      if (!inRange(r.value, field.settings.min, field.settings.max)) {
        return refuse(key, "validation.percentage", "range");
      }
      return accept(r.value);
    }
    case "date": {
      const r = normalizeDate(raw);
      if (!r.ok) return refuse(key, "validation.date", r.reason);
      const { min, max } = field.settings;
      if ((min !== undefined && r.value < min) || (max !== undefined && r.value > max)) {
        return refuse(key, "validation.date", "range");
      }
      return accept(r.value);
    }
    case "reference": {
      const id = asUuid(raw);
      if (id === null) return refuse(key, "validation.reference", "format");
      return accept(id, [{ kind: "reference", field: key, targetRecordType: field.settings.targetRecordType, id }]);
    }
    case "attachment": {
      if (!Array.isArray(raw)) return refuse(key, "validation.attachment", "not_an_array");
      if (raw.length === 0) return refuse(key, "validation.attachment", "empty");
      if (raw.length > field.settings.maxCount) return refuse(key, "validation.attachment", "too_many");
      const ids: string[] = [];
      for (const item of raw) {
        const id = asUuid(item);
        if (id === null) return refuse(key, "validation.attachment", "format");
        if (ids.includes(id)) return refuse(key, "validation.attachment", "duplicate");
        ids.push(id);
      }
      return accept(ids, [{ kind: "attachment", field: key, evidenceIds: ids }]);
    }
    case "lookup": {
      const set = field.settings.lookupSet;
      if (!isToken(raw)) return refuse(key, "validation.lookup", "format");
      let value: string = raw;
      if (set === "users" || set === "business_units") {
        const id = asUuid(raw);
        if (id === null) return refuse(key, "validation.lookup", "format");
        value = id;
      } else if (set === "currencies" && !CURRENCY_CODE_PATTERN.test(raw)) {
        return refuse(key, "validation.lookup", "format");
      }
      const members = options.lookupMembers?.[set];
      if (members !== undefined) {
        return members.has(value) ? accept(value) : refuse(key, "validation.lookup", "not_a_member");
      }
      return accept(value, [{ kind: "lookup", field: key, lookupSet: set, value }]);
    }
    case "choice": {
      const allowed = new Set(field.settings.options.map((o) => o.value));
      if (!field.settings.multiple) {
        if (typeof raw !== "string") return refuse(key, "validation.choice", "not_a_string");
        return allowed.has(raw) ? accept(raw) : refuse(key, "validation.choice", "not_an_option");
      }
      if (!Array.isArray(raw)) return refuse(key, "validation.choice", "not_an_array");
      if (raw.length === 0) return refuse(key, "validation.choice", "empty");
      const picked: string[] = [];
      for (const item of raw) {
        if (typeof item !== "string" || !allowed.has(item)) return refuse(key, "validation.choice", "not_an_option");
        if (picked.includes(item)) return refuse(key, "validation.choice", "duplicate");
        picked.push(item);
      }
      return accept(picked);
    }
  }
}

// ------------------------------------------------------------------------------------------------ record level

export interface FieldProblem {
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly params: Readonly<Record<string, string>>;
}

export type RecordValuesResult =
  | {
      readonly ok: true;
      /** Every given key, normalized; null = Unknown (a cleared value). */
      readonly values: Readonly<Record<string, StoredFieldValue | null>>;
      readonly checks: readonly DeferredCheck[];
    }
  | {
      readonly ok: false;
      /** 422 for an unknown, calculated or missing required field; 400 for invalid values (field codes). */
      readonly status: 400 | 422;
      /** The problem code: "validation" for a 400 (the API's `problems.validation`; field codes in `problems`). */
      readonly code: "form_record.custom_field_unknown" | "form_record.custom_field_required" | "validation";
      readonly message: string;
      readonly problems: readonly FieldProblem[];
    };

/**
 * Validates the extension-field values of one record against the active extension fields of its record type in the
 * pinned form schema version (ADR-0041 §4), before persistence. In order:
 *  1. every key must be an active, non-calculated field → else 422 `form_record.custom_field_unknown` (all such keys);
 *  2. every value must pass `validateFieldValue` → else 400 `validation` with every field problem and its field code;
 *  3. every required field must have a value (absent or null is missing) → else 422 `form_record.custom_field_required`.
 * `fields` are the record type's active extension fields (removed fields are not passed).
 */
export function validateRecordValues(
  fields: readonly FieldDefinition[],
  values: unknown,
  options: ValidateOptions = {},
): RecordValuesResult {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return {
      ok: false,
      status: 400,
      code: "validation",
      message: "The request is not valid.",
      problems: [],
    };
  }
  const byKey = new Map(fields.map((f) => [f.key, f] as const));
  const entries = Object.entries(values as Record<string, unknown>);
  const unknown = entries.filter(([k]) => {
    const f = byKey.get(k);
    return f === undefined || f.fieldType === "calculated";
  });
  if (unknown.length > 0) {
    const code = "form_record.custom_field_unknown";
    return {
      ok: false,
      status: 422,
      code,
      message: FORM_SCHEMA_MESSAGES[code],
      problems: unknown.map(([k]) => ({
        field: k,
        code,
        message: FORM_SCHEMA_MESSAGES[code],
        params: { field: k, reason: byKey.has(k) ? "calculated" : "unknown" },
      })),
    };
  }
  const out: Record<string, StoredFieldValue | null> = {};
  const checks: DeferredCheck[] = [];
  const problems: FieldProblem[] = [];
  for (const [k, raw] of entries) {
    const r = validateFieldValue(byKey.get(k)!, raw, options);
    if (r.ok) {
      out[k] = r.value;
      checks.push(...r.checks);
    } else {
      problems.push({ field: k, code: r.code, message: r.message, params: r.params });
    }
  }
  if (problems.length > 0) {
    return { ok: false, status: 400, code: "validation", message: "The request is not valid.", problems };
  }
  const missing = fields.filter(
    (f) => f.required === true && f.fieldType !== "calculated" && (out[f.key] === undefined || out[f.key] === null),
  );
  if (missing.length > 0) {
    const code = "form_record.custom_field_required";
    return {
      ok: false,
      status: 422,
      code,
      message: FORM_SCHEMA_MESSAGES[code],
      problems: missing.map((f) => ({
        field: f.key,
        code,
        message: FORM_SCHEMA_MESSAGES[code],
        params: { field: f.key },
      })),
    };
  }
  return { ok: true, values: out, checks };
}

/** The field types a value is stored for (every type but `calculated`). */
export function isStoredFieldType(t: FieldType): t is Exclude<FieldType, "calculated"> {
  return t !== "calculated";
}
