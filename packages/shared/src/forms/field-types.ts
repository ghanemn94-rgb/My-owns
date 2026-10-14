// The eleven Studio field types (REQ-S06-005; ADR-0041 §3, §7, §10). Owner: kpi-benefits-engineer (T-DG5-KBE-B,
// p5-work-split §B.1). Pure: no I/O, no clock, no float. Exported through `@mth/shared/calc`.
//
// This file holds the field-type catalogue, the exact refusal codes and English texts of ADR-0041 §10 that the
// validators return, and the Zod settings schema of each type. The settings live flat in a `form_field` element's
// `attributes` (migration 0068 reads `attributes->'expression'`, `attributes->'options'`, ...), so each settings schema
// is a non-strict object: `parseFieldSettings` keeps only the keys of its type (`FIELD_SETTINGS_KEYS`) and ignores the
// element's other attributes (`fieldType`, `labelEn`, `helpAr`, `required`, ...), which the forms provider (BE-D)
// validates itself.
//
// Settings that are numbers in the business sense (number/percentage bounds) are DECIMAL STRINGS compared with
// decimal.js (shared rule 5). Settings that are counts or lengths (`maxLength`, `scale`, `maxCount`) are JSON integers,
// as every count in the contract is.
import { Decimal } from "decimal.js";
import { z } from "zod";
import { freeText, hasInvalidCharacter, hasVisibleContent } from "../schemas/common.ts";
import { KPI_UNIT_KINDS } from "../schemas/kpi.ts";
import { isBusinessDate } from "../time/working-days.ts";

/** decimal.js clone for comparisons only (nothing here rounds a stored value). */
export const FD = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });

// ------------------------------------------------------------------------------------------------ types

/** The eleven field types, in the M0154 / REQ-S06-005 order (OpenAPI `FormFieldType`; CHECK `methodology_element_field_type`). */
export const FIELD_TYPES = [
  "text",
  "rich_text",
  "number",
  "currency",
  "percentage",
  "date",
  "reference",
  "attachment",
  "lookup",
  "choice",
  "calculated",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

/** The field types whose values a calculated field may read (ADR-0041 §3: "the record's number/currency/percentage fields"). */
export const NUMERIC_FIELD_TYPES = ["number", "currency", "percentage"] as const;
export type NumericFieldType = (typeof NUMERIC_FIELD_TYPES)[number];

/** The lookup sets of ADR-0041 §3. */
export const LOOKUP_SETS = [
  "users",
  "roles",
  "tom_dimensions",
  "phases",
  "gates",
  "currencies",
  "business_units",
] as const;
export type LookupSet = (typeof LOOKUP_SETS)[number];

/** ADR-0037 N5 unit kinds (the KPI `unit_kind` list), which a calculated field's result states. */
export const RESULT_UNIT_KINDS = KPI_UNIT_KINDS;
export type ResultUnitKind = (typeof RESULT_UNIT_KINDS)[number];

/** Transport limits of ADR-0041 §3 (and the 0068 `form_custom_value_type_shape` guard). */
export const FIELD_LIMITS = Object.freeze({
  textMaxLength: 2000,
  richTextMaxLength: 20000,
  /** Integer digits of a number, percentage fraction or currency amount: `^-?\d{1,15}(\.\d{1,6})?$`. */
  maxIntegerDigits: 15,
  /** Fraction digits of any stored decimal. */
  maxScale: 6,
  /** Fraction digits of a currency amount. */
  currencyMaxScale: 2,
  attachmentMaxCount: 20,
  choiceMaxOptions: 100,
  /** Characters of a choice value or a lookup value (the 0068 shape guard). */
  tokenMaxLength: 100,
  expressionMaxLength: 2000,
});

/** The default currency of a field when neither the settings nor the transformation name one (CLAUDE.md: SAR). */
export const DEFAULT_CURRENCY = "SAR";

// ------------------------------------------------------------------------------------------------ codes and texts

/** ADR-0041 §10: the 400 field codes, one per type (two for currency), with their exact English texts. */
export const FIELD_VALUE_MESSAGES = Object.freeze({
  "validation.text": "Enter text within the allowed length.",
  "validation.rich_text": "Enter formatted text within the allowed length.",
  "validation.decimal": "Enter a number within the allowed range, with at most the allowed decimals.",
  "validation.currency_amount": "Enter an amount with at most two decimals.",
  "validation.currency_code": "Enter a three-letter currency code.",
  "validation.percentage": "Enter a percentage within the allowed range, for example 12%.",
  "validation.date": "Enter a valid date as YYYY-MM-DD.",
  "validation.reference": "Choose an existing record of the expected type in this transformation.",
  "validation.attachment": "Choose evidence from this transformation (at most the allowed number).",
  "validation.lookup": "Choose an active value from the list.",
  "validation.choice": "Choose one of the listed options.",
} as const);
export type FieldValueCode = keyof typeof FIELD_VALUE_MESSAGES;

/** ADR-0041 §10: the 422 codes this module returns (definition time and record level), with their exact English texts. */
export const FORM_SCHEMA_MESSAGES = Object.freeze({
  "form_schema.field_type_unknown": "Choose one of the eleven field types.",
  "form_schema.field_settings_invalid": "This field type is missing a required setting.",
  "form_schema.calculated_formula_invalid": "The calculated field's formula is invalid or refers to an unknown field.",
  "form_record.custom_field_unknown":
    "This field is not an extension field of this form in the version your transformation uses.",
  "form_record.custom_field_required": "Fill in the required extension fields.",
} as const);
export type FormSchemaCode = keyof typeof FORM_SCHEMA_MESSAGES;

/** The field code each type refuses with (ADR-0041 §3 last column; currency's code-specific refusal is separate). */
export const FIELD_TYPE_CODE: Readonly<Record<Exclude<FieldType, "calculated">, FieldValueCode>> = Object.freeze({
  text: "validation.text",
  rich_text: "validation.rich_text",
  number: "validation.decimal",
  currency: "validation.currency_amount",
  percentage: "validation.percentage",
  date: "validation.date",
  reference: "validation.reference",
  attachment: "validation.attachment",
  lookup: "validation.lookup",
  choice: "validation.choice",
});

// ------------------------------------------------------------------------------------------------ shared patterns

/** A stored decimal (ADR-0041 §3 `number`; 0068 `dec`). ASCII digits only: Arabic-Indic digits never match. */
export const FIELD_DECIMAL_PATTERN = /^-?[0-9]{1,15}(\.[0-9]{1,6})?$/;
/** A lowercase uuid (the 0068 shape guard for references). Input is lower-cased before this test. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** ISO 4217 letters (OpenAPI `Currency`). */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
/** OpenAPI `FormRecordTypeCode`. */
export const RECORD_TYPE_CODE_PATTERN = /^(T(0[1-9]|1[0-6])|[a-z][a-z0-9_]{1,39})$/;

/** Fraction digits of a decimal string that matter (trailing zeros do not): "1.50" → 1. */
export function significantScale(value: string): number {
  const dot = value.indexOf(".");
  if (dot === -1) return 0;
  return value.slice(dot + 1).replace(/0+$/, "").length;
}

const decimalSetting = z.string().regex(FIELD_DECIMAL_PATTERN);
const dateSetting = z.string().refine((v) => isBusinessDate(v));
/** A choice value or a stored token: 1-100 characters, visible, storable (shared free-text predicates, rule 1). */
const tokenText = z
  .string()
  .min(1)
  .max(FIELD_LIMITS.tokenMaxLength)
  .refine((v) => !hasInvalidCharacter(v) && hasVisibleContent(v));

/**
 * min <= max. Zod 4 runs an object refinement even when a member already failed, so the bounds are only compared when
 * both are valid decimal strings (an invalid one is already reported at its own path; never a thrown DecimalError).
 */
function boundsOrdered(min: unknown, max: unknown): boolean {
  if (typeof min !== "string" || typeof max !== "string") return true;
  if (!FIELD_DECIMAL_PATTERN.test(min) || !FIELD_DECIMAL_PATTERN.test(max)) return true;
  return new FD(min).lte(new FD(max));
}

// ------------------------------------------------------------------------------------------------ settings schemas

export const textSettingsSchema = z.object({
  maxLength: z.number().int().min(1).max(FIELD_LIMITS.textMaxLength).default(FIELD_LIMITS.textMaxLength),
});
export const richTextSettingsSchema = z.object({
  maxLength: z.number().int().min(1).max(FIELD_LIMITS.richTextMaxLength).default(FIELD_LIMITS.richTextMaxLength),
});
export const numberSettingsSchema = z
  .object({
    min: decimalSetting.optional(),
    max: decimalSetting.optional(),
    scale: z.number().int().min(0).max(FIELD_LIMITS.maxScale).default(FIELD_LIMITS.maxScale),
  })
  .refine((s) => boundsOrdered(s.min, s.max), { path: ["max"] });
export const currencySettingsSchema = z.object({
  /** Absent → the transformation currency (`parseFieldSettings` option `defaultCurrency`, default SAR). */
  currencyCode: z.string().regex(CURRENCY_CODE_PATTERN).optional(),
  scale: z.number().int().min(0).max(FIELD_LIMITS.currencyMaxScale).default(FIELD_LIMITS.currencyMaxScale),
});
export const percentageSettingsSchema = z
  .object({
    /** Bounds are FRACTIONS (0.12 = 12 %); default 0-1. */
    min: decimalSetting.default("0"),
    max: decimalSetting.default("1"),
  })
  .refine((s) => boundsOrdered(s.min, s.max), { path: ["max"] });
export const dateSettingsSchema = z
  .object({ min: dateSetting.optional(), max: dateSetting.optional() })
  .refine(
    (s) =>
      typeof s.min !== "string" ||
      typeof s.max !== "string" ||
      !isBusinessDate(s.min) ||
      !isBusinessDate(s.max) ||
      s.min <= s.max,
    { path: ["max"] },
  );
export const referenceSettingsSchema = z.object({
  targetRecordType: z.string().regex(RECORD_TYPE_CODE_PATTERN),
});
export const attachmentSettingsSchema = z.object({
  maxCount: z.number().int().min(1).max(FIELD_LIMITS.attachmentMaxCount).default(FIELD_LIMITS.attachmentMaxCount),
});
export const lookupSettingsSchema = z.object({ lookupSet: z.enum(LOOKUP_SETS) });
export const choiceOptionSchema = z.strictObject({
  value: tokenText,
  labelEn: freeText(1, 200),
  labelAr: freeText(1, 200),
});
export const choiceSettingsSchema = z.object({
  options: z
    .array(choiceOptionSchema)
    .min(1)
    .max(FIELD_LIMITS.choiceMaxOptions)
    .refine((xs) => new Set(xs.map((o) => o.value)).size === xs.length, "validation.unique_items"),
  multiple: z.boolean().default(false),
});
export const calculatedSettingsSchema = z.object({
  expression: z
    .string()
    .min(1)
    .max(FIELD_LIMITS.expressionMaxLength)
    .refine((v) => !hasInvalidCharacter(v) && hasVisibleContent(v)),
  resultUnitKind: z.enum(RESULT_UNIT_KINDS),
});

export const FIELD_SETTINGS_SCHEMAS = Object.freeze({
  text: textSettingsSchema,
  rich_text: richTextSettingsSchema,
  number: numberSettingsSchema,
  currency: currencySettingsSchema,
  percentage: percentageSettingsSchema,
  date: dateSettingsSchema,
  reference: referenceSettingsSchema,
  attachment: attachmentSettingsSchema,
  lookup: lookupSettingsSchema,
  choice: choiceSettingsSchema,
  calculated: calculatedSettingsSchema,
} as const);

/** The settings keys of each type: the only attributes `parseFieldSettings` reads. */
export const FIELD_SETTINGS_KEYS: Readonly<Record<FieldType, readonly string[]>> = Object.freeze({
  text: ["maxLength"],
  rich_text: ["maxLength"],
  number: ["min", "max", "scale"],
  currency: ["currencyCode", "scale"],
  percentage: ["min", "max"],
  date: ["min", "max"],
  reference: ["targetRecordType"],
  attachment: ["maxCount"],
  lookup: ["lookupSet"],
  choice: ["options", "multiple"],
  calculated: ["expression", "resultUnitKind"],
});

export type TextSettings = z.output<typeof textSettingsSchema>;
export type RichTextSettings = z.output<typeof richTextSettingsSchema>;
export type NumberSettings = z.output<typeof numberSettingsSchema>;
/** Resolved currency settings: the code is always present after `parseFieldSettings`. */
export type CurrencySettings = { readonly currencyCode: string; readonly scale: number };
export type PercentageSettings = z.output<typeof percentageSettingsSchema>;
export type DateSettings = z.output<typeof dateSettingsSchema>;
export type ReferenceSettings = z.output<typeof referenceSettingsSchema>;
export type AttachmentSettings = z.output<typeof attachmentSettingsSchema>;
export type LookupSettings = z.output<typeof lookupSettingsSchema>;
export type ChoiceSettings = z.output<typeof choiceSettingsSchema>;
export type CalculatedSettings = z.output<typeof calculatedSettingsSchema>;

export interface FieldSettingsByType {
  text: TextSettings;
  rich_text: RichTextSettings;
  number: NumberSettings;
  currency: CurrencySettings;
  percentage: PercentageSettings;
  date: DateSettings;
  reference: ReferenceSettings;
  attachment: AttachmentSettings;
  lookup: LookupSettings;
  choice: ChoiceSettings;
  calculated: CalculatedSettings;
}

/** A field with its resolved settings: what the validators take (BE-D builds it from the pinned form schema). */
export type FieldDefinition = {
  [T in FieldType]: {
    readonly key: string;
    readonly fieldType: T;
    readonly settings: FieldSettingsByType[T];
    readonly required?: boolean;
  };
}[FieldType];

export type FieldSettingsResult =
  | { readonly ok: true; readonly fieldType: FieldType; readonly settings: FieldSettingsByType[FieldType] }
  | {
      readonly ok: false;
      readonly code: "form_schema.field_type_unknown" | "form_schema.field_settings_invalid";
      readonly message: string;
      /** `path`: the first failing setting (e.g. "options.0.labelAr"), so the Studio can point at it. */
      readonly params: Readonly<Record<string, string>>;
    };

export interface ParseSettingsOptions {
  /** The transformation (or organization) currency used when a currency field names none. Default SAR. */
  readonly defaultCurrency?: string;
}

/**
 * Validates a field type and its settings (ADR-0041 §2-§3; the API twin of CHECK `methodology_element_field_type` and
 * `methodology_element_field_settings`, which are the last line). `attributes` is the element's attribute object; only
 * the keys of the type are read. An unknown type → `form_schema.field_type_unknown`; a missing or invalid setting →
 * `form_schema.field_settings_invalid`. Whether a calculated field's expression is a VALID formula over the record
 * type's fields is checked separately (`validateCalculatedField`, which needs the resolved fields).
 */
export function parseFieldSettings(
  fieldType: unknown,
  attributes: unknown,
  options: ParseSettingsOptions = {},
): FieldSettingsResult {
  if (!isFieldType(fieldType)) {
    return {
      ok: false,
      code: "form_schema.field_type_unknown",
      message: FORM_SCHEMA_MESSAGES["form_schema.field_type_unknown"],
      params: { fieldType: typeof fieldType === "string" ? fieldType : typeof fieldType },
    };
  }
  const source = typeof attributes === "object" && attributes !== null && !Array.isArray(attributes) ? attributes : {};
  const picked: Record<string, unknown> = {};
  for (const k of FIELD_SETTINGS_KEYS[fieldType]) {
    if (Object.prototype.hasOwnProperty.call(source, k)) picked[k] = (source as Record<string, unknown>)[k];
  }
  const parsed = FIELD_SETTINGS_SCHEMAS[fieldType].safeParse(picked);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      code: "form_schema.field_settings_invalid",
      message: FORM_SCHEMA_MESSAGES["form_schema.field_settings_invalid"],
      params: { fieldType, path: issue ? issue.path.map(String).join(".") : "" },
    };
  }
  if (fieldType === "currency") {
    const s = parsed.data as z.output<typeof currencySettingsSchema>;
    const fallback = options.defaultCurrency ?? DEFAULT_CURRENCY;
    if (s.currencyCode === undefined && !CURRENCY_CODE_PATTERN.test(fallback)) {
      return {
        ok: false,
        code: "form_schema.field_settings_invalid",
        message: FORM_SCHEMA_MESSAGES["form_schema.field_settings_invalid"],
        params: { fieldType, path: "currencyCode" },
      };
    }
    const settings: CurrencySettings = { currencyCode: s.currencyCode ?? fallback, scale: s.scale };
    return { ok: true, fieldType, settings };
  }
  return { ok: true, fieldType, settings: parsed.data as FieldSettingsByType[FieldType] };
}

/** Builds a `FieldDefinition` from a key, a type and raw attributes, or returns the settings refusal. */
export function defineField(
  key: string,
  fieldType: unknown,
  attributes: unknown,
  options: ParseSettingsOptions & { readonly required?: boolean } = {},
): { readonly ok: true; readonly field: FieldDefinition } | Extract<FieldSettingsResult, { ok: false }> {
  const r = parseFieldSettings(fieldType, attributes, options);
  if (!r.ok) return r;
  return {
    ok: true,
    field: {
      key,
      fieldType: r.fieldType,
      settings: r.settings,
      required: options.required ?? false,
    } as FieldDefinition,
  };
}
