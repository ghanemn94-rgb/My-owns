// zod mirrors of the P5 slice B form-framework components of BE-E2 (docs/api/openapi.yaml tag `forms`:
// FormRecordExport, FormBulkItem, FormBulkUpdate, FormBulkUpdateResult, FormDraft, FormDraftPage, FormDraftCreate,
// FormDraftUpdate, FormDraftClose and the ExportFormatQuery/ExportLanguageQuery/FormDraftStatusQuery parameters;
// ADR-0041 §5, §6, §10; T-DG5-BE-E2, p5-work-split §B.4). The OpenAPI file is the source of truth; the contract test
// parses every success body with these. Drafts and bulk edits approve nothing: no G1-G6 business approval is granted
// or recorded here.
import { z } from "zod";
import { cursorQuery, timestamp, uuid, version } from "./common.ts";
import { formFieldType, formRecordTypeCode } from "./forms.ts";

/** A JSON object (never an array or a scalar): a draft payload, a bulk item's source fields or extension values. */
const jsonObject = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------------------------------------- export

export const FORM_EXPORT_FORMATS = ["csv", "json"] as const;
export const FORM_EXPORT_LANGUAGES = ["en", "ar"] as const;
/** The query of exportFormRecords (format default csv or the Accept header; lang default the caller's language). */
export const formRecordExportQuery = z.strictObject({
  format: z.enum(FORM_EXPORT_FORMATS).optional(),
  lang: z.enum(FORM_EXPORT_LANGUAGES).optional(),
});
/** The row cap of the form export (ADR-0041 §5; above it 422 form_export.too_large). */
export const FORM_EXPORT_MAX_ROWS = 5000;
export const FORM_VALUE_STATUSES = ["unknown", "not_computable"] as const;
export const formRecordExport = z.strictObject({
  recordType: formRecordTypeCode,
  formSchemaVersionId: uuid,
  language: z.enum(FORM_EXPORT_LANGUAGES),
  columns: z.array(
    z.strictObject({ key: z.string(), label: z.string(), fieldType: formFieldType, extension: z.boolean() }),
  ),
  rows: z
    .array(
      z.strictObject({
        recordId: uuid,
        version,
        values: z.record(z.string(), z.string().nullable()),
        statuses: z.record(z.string(), z.enum(FORM_VALUE_STATUSES)),
      }),
    )
    .max(FORM_EXPORT_MAX_ROWS),
});
export type FormRecordExport = z.infer<typeof formRecordExport>;

// ------------------------------------------------------------------------------------------------------------ bulk

/** At most 100 items per bulk edit (ADR-0041 §5); above it 422 form_record.bulk_too_many, checked by the API. */
export const FORM_BULK_MAX_ITEMS = 100;
export const formBulkItem = z.strictObject({
  recordId: uuid,
  version,
  sourceFields: jsonObject
    .refine((o) => Object.keys(o).length <= 20, { message: "validation.max_properties" })
    .optional(),
  customFieldValues: jsonObject
    .refine((o) => Object.keys(o).length <= 200, { message: "validation.max_properties" })
    .optional(),
});
export type FormBulkItem = z.infer<typeof formBulkItem>;
/** The request; the 100-item cap is a business rule (422), so the schema only requires one item. */
export const formBulkUpdate = z.strictObject({ items: z.array(formBulkItem).min(1) });
export const formBulkUpdateResult = z.strictObject({
  items: z.array(z.strictObject({ recordId: uuid, version })),
});
export type FormBulkUpdateResult = z.infer<typeof formBulkUpdateResult>;

// ---------------------------------------------------------------------------------------------------------- drafts

export const FORM_DRAFT_STATUSES = ["open", "closed"] as const;
export const FORM_DRAFT_CLOSE_REASONS = ["saved", "discarded"] as const;
/** The payload cap of a draft (ADR-0041 §5; 0068 CHECK on pg_column_size), measured on the UTF-8 JSON text. */
export const FORM_DRAFT_MAX_PAYLOAD_BYTES = 262144;
export const formDraftListQuery = z.strictObject({
  ...cursorQuery.shape,
  recordType: formRecordTypeCode.optional(),
  status: z.enum(FORM_DRAFT_STATUSES).optional(),
});
export const formDraftCreate = z
  .strictObject({
    recordType: formRecordTypeCode,
    recordId: uuid.nullable().optional(),
    baseRecordVersion: z.number().int().min(1).nullable().optional(),
    payload: jsonObject,
  })
  .refine((b) => ((b.recordId ?? null) === null) === ((b.baseRecordVersion ?? null) === null), {
    message: "validation.required",
    path: ["baseRecordVersion"],
  });
export type FormDraftCreate = z.infer<typeof formDraftCreate>;
export const formDraftUpdate = z.strictObject({ payload: jsonObject });
export const formDraftClose = z.strictObject({ reason: z.enum(FORM_DRAFT_CLOSE_REASONS) });
export const formDraft = z.strictObject({
  id: uuid,
  recordType: formRecordTypeCode,
  recordId: uuid.nullable(),
  baseRecordVersion: z.number().int().min(1).nullable(),
  baseChanged: z.boolean(),
  payload: jsonObject,
  status: z.enum(FORM_DRAFT_STATUSES),
  closedReason: z.enum(FORM_DRAFT_CLOSE_REASONS).nullable(),
  closedAt: timestamp.nullable(),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type FormDraft = z.infer<typeof formDraft>;
export const formDraftPage = z.strictObject({ items: z.array(formDraft), nextCursor: z.string().nullable() });
