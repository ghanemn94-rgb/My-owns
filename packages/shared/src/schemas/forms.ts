// zod mirrors of the P5 slice B form-schema components (docs/api/openapi.yaml tag `forms`: FormRecordType,
// FormRecordTypeList, FormSchema, FormField, FormCustomValues, FormCustomValuesPut; ADR-0041 §1-§4; T-DG5-BE-D,
// p5-work-split §B.2). The OpenAPI file is the source of truth; the contract test parses every success body with these.
// Also the attribute schemas of the two `form_schema` element types (`form`, `form_field`; ADR-0041 §2): Studio writes
// validate `methodology_element.attributes` here first (never an unvalidated blob); the forms kind provider then checks
// the field type, its settings and a calculated formula, with the ADR-0041 §10 codes.
// A form schema is configuration, not a business approval: nothing here grants or records a G1-G6 decision.
import { z } from "zod";
import { FIELD_TYPES, RECORD_TYPE_CODE_PATTERN } from "../forms/field-types.ts";
import { freeText, timestamp, uuid } from "./common.ts";

/** OpenAPI `FormRecordTypeCode`. */
export const formRecordTypeCode = z.string().regex(RECORD_TYPE_CODE_PATTERN, "validation.pattern");
export const FORM_RECORD_KINDS = ["template", "source_deliverable", "extension", "product"] as const;
export const formRecordKind = z.enum(FORM_RECORD_KINDS);
/** OpenAPI `FormFieldType` (the eleven Studio field types, REQ-S06-005). */
export const formFieldType = z.enum(FIELD_TYPES);
/** A field key: a source column key or an extension field key (ADR-0041 §2). */
export const FORM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
export const formFieldKey = z.string().regex(FORM_FIELD_KEY_PATTERN, "validation.pattern");

/** listFormRecordTypes query (`FormRecordKindQuery`). */
export const formRecordTypeListQuery = z.strictObject({ kind: formRecordKind.optional() });

export const formRecordType = z.strictObject({
  code: formRecordTypeCode,
  ordinal: z.number().int().min(1),
  kind: formRecordKind,
  titleEn: z.string().min(1).max(200),
  titleAr: z.string().min(1).max(200),
  titleArProvisional: z.boolean(),
  sourceRef: z.string(),
  writePermission: z.string().nullable(),
  extensionBadge: z.boolean(),
  customFieldsAllowed: z.boolean(),
  bulkEditAllowed: z.boolean(),
  featureStatus: z.enum(["working", "planned"]),
});
export type FormRecordType = z.infer<typeof formRecordType>;
export const formRecordTypeList = z.strictObject({ items: z.array(formRecordType) });

const nullableHelp = z.string().min(1).max(2000).nullable();

export const formField = z.strictObject({
  key: formFieldKey,
  origin: z.enum(["source", "admin"]),
  protected: z.boolean(),
  extension: z.boolean(),
  fieldType: formFieldType,
  labelEn: z.string().min(1).max(200),
  labelAr: z.string().min(1).max(200),
  helpEn: nullableHelp,
  helpAr: nullableHelp,
  required: z.boolean(),
  bulkEditable: z.boolean(),
  storageKind: z.enum(["column", "composite", "computed"]).nullable(),
  sourceRef: z.string().nullable(),
  ordinal: z.number().int().nullable(),
  settings: z.record(z.string(), z.unknown()),
});
export type FormField = z.infer<typeof formField>;

export const formSchema = z.strictObject({
  recordType: formRecordType,
  formSchemaVersionId: uuid,
  versionNo: z.number().int().min(1),
  labelEn: z.string().min(1).max(200),
  labelAr: z.string().min(1).max(200),
  helpEn: nullableHelp,
  helpAr: nullableHelp,
  fields: z.array(formField),
});
export type FormSchema = z.infer<typeof formSchema>;

/** A calculated field's read-time value (ADR-0041 §7): Not computable is never 0. */
export const formCalculatedValue = z.strictObject({
  status: z.enum(["computed", "not_computable"]),
  value: z
    .string()
    .regex(/^-?[0-9]+(\.[0-9]+)?$/, "validation.decimal")
    .nullable(),
  missingFields: z.array(z.string()),
});

export const formCustomValues = z.strictObject({
  recordType: formRecordTypeCode,
  recordId: uuid,
  formSchemaVersionId: uuid,
  values: z.record(z.string(), z.unknown()),
  calculated: z.record(z.string(), formCalculatedValue),
  version: z.number().int().min(0),
  updatedAt: timestamp.nullable(),
  updatedBy: uuid.nullable(),
});
export type FormCustomValues = z.infer<typeof formCustomValues>;

/** putFormRecordCustomFields body: the complete set of extension-field values (absent keys are cleared). */
export const formCustomValuesPut = z.strictObject({
  values: z
    .record(z.string(), z.unknown())
    .refine((v) => Object.keys(v).length <= 200, { message: "validation.too_many" }),
});
export type FormCustomValuesPut = z.infer<typeof formCustomValuesPut>;

// ------------------------------------------------------------------------------------------------ element attributes

const labelsAndHelp = {
  labelEn: freeText(1, 200).optional(),
  labelAr: freeText(1, 200).optional(),
  helpEn: freeText(1, 2000).optional(),
  helpAr: freeText(1, 2000).optional(),
};

/** `form` element (stable key = a form_record_type code): form-level labels and help only (ADR-0041 §2). */
export const formElementAttributes = z.strictObject(labelsAndHelp);

/**
 * `form_field` element (stable key `<recordType>.<fieldKey>`). Labels, help and `required` for every field; the type
 * and its settings for an extension field. The settings' values are typed loosely here on purpose: the forms provider
 * checks them per type (`parseFieldSettings`) and refuses with 422 `form_schema.field_type_unknown` /
 * `form_schema.field_settings_invalid` (ADR-0041 §10), not with a generic 400. Unknown attribute names are a 400.
 */
export const formFieldElementAttributes = z.strictObject({
  ...labelsAndHelp,
  required: z.boolean().optional(),
  fieldType: z.string().min(1).max(40).optional(),
  maxLength: z.unknown().optional(),
  min: z.unknown().optional(),
  max: z.unknown().optional(),
  scale: z.unknown().optional(),
  currencyCode: z.unknown().optional(),
  targetRecordType: z.unknown().optional(),
  maxCount: z.unknown().optional(),
  lookupSet: z.unknown().optional(),
  options: z.unknown().optional(),
  multiple: z.unknown().optional(),
  expression: z.unknown().optional(),
  resultUnitKind: z.unknown().optional(),
});

/** The settings attribute names of a form field (everything but labels, help, `required` and `fieldType`). */
export const FORM_FIELD_SETTING_ATTRIBUTES = [
  "maxLength",
  "min",
  "max",
  "scale",
  "currencyCode",
  "targetRecordType",
  "maxCount",
  "lookupSet",
  "options",
  "multiple",
  "expression",
  "resultUnitKind",
] as const;
