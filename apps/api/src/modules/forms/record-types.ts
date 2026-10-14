// The native-form registry (ADR-0041 §1; REQ-S05-001, REQ-S05-006; p5-work-split §B.2; T-DG5-BE-D): reads of
// `form_record_type` (read-only for mth_app; 0068 seed) and the authorization helpers every slice B route uses:
//  - reads of a transformation's forms need `transformation.read` in scope (outside scope -> 404);
//  - writes of a record's form data need the record type's `write_permission_code` in the same scope, re-checked on the
//    principal reloaded inside the write transaction (commit-time authorization, ADR-0006): a grant revoked while the
//    request waits gives 403 and nothing is written. AUD holds no write code and gets 403 (ADR-0041 §9).
// A planned record type (no table yet: the 90-day launch plan and the health check, slice H) is refused 422
// `form_record.type_planned`. Nothing here is a business approval.
import { type DbOrTx, type FormRecordTypeRow, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import type { FormRecordType } from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import { commitTimeDenial, principalOf, refreshPrincipal, requireAction, requireRead } from "../access/index.ts";
import { problems } from "../platform/index.ts";

/** ADR-0041 §10 refusals of the slice B record and schema operations (exact English texts). */
export const formRefusals = {
  typePlanned: () => problems.businessRule("form_record.type_planned", "This form is not available in this release."),
  extensionsNotAllowed: () =>
    problems.businessRule("form_schema.extensions_not_allowed", "This form does not take extension fields."),
  sourceColumnProtected: () =>
    problems.businessRule(
      "form_schema.source_column_protected",
      "Source columns cannot be deleted. Relabel the column or add help instead.",
    ),
  sourceColumnTypeFixed: () =>
    problems.businessRule("form_schema.source_column_type_fixed", "The type of a source column cannot be changed."),
  extensionKeyInvalid: () =>
    problems.businessRule(
      "form_schema.extension_key_invalid",
      "An extension field needs a new key of lowercase letters, digits and underscores that is not a source column.",
    ),
  fieldTypeUnknown: () =>
    problems.businessRule("form_schema.field_type_unknown", "Choose one of the eleven field types."),
  fieldSettingsInvalid: () =>
    problems.businessRule("form_schema.field_settings_invalid", "This field type is missing a required setting."),
  calculatedFormulaInvalid: () =>
    problems.businessRule(
      "form_schema.calculated_formula_invalid",
      "The calculated field's formula is invalid or refers to an unknown field.",
    ),
  formFixed: () => problems.businessRule("form_schema.form_fixed", "Native forms cannot be added or removed."),
  customFieldUnknown: () =>
    problems.businessRule(
      "form_record.custom_field_unknown",
      "This field is not an extension field of this form in the version your transformation uses.",
    ),
  customFieldRequired: () =>
    problems.businessRule("form_record.custom_field_required", "Fill in the required extension fields."),
};

/** Every Arabic title of the registry is a provisional translation (ADR-0041 §1; none is verified yet). */
const TITLE_AR_PROVISIONAL = true;

export function toFormRecordType(r: FormRecordTypeRow): FormRecordType {
  return {
    code: r.code,
    ordinal: r.ordinal,
    kind: r.kind as FormRecordType["kind"],
    titleEn: r.title_en,
    titleAr: r.title_ar,
    titleArProvisional: TITLE_AR_PROVISIONAL,
    sourceRef: r.source_ref,
    writePermission: r.write_permission_code,
    extensionBadge: r.extension_badge,
    customFieldsAllowed: r.custom_fields_allowed,
    bulkEditAllowed: r.bulk_edit_allowed,
    featureStatus: r.feature_status as FormRecordType["featureStatus"],
  };
}

/** The registry, in ordinal order, optionally of one kind. */
export async function listRecordTypes(db: DbOrTx, kind?: string): Promise<FormRecordTypeRow[]> {
  let q = db.selectFrom("form_record_type").selectAll().orderBy("ordinal");
  if (kind !== undefined) q = q.where("kind", "=", kind);
  return q.execute();
}

/** One record type; 404 when the code is not registered. */
export async function loadRecordType(db: DbOrTx, code: string): Promise<FormRecordTypeRow> {
  const row = await db.selectFrom("form_record_type").selectAll().where("code", "=", code).executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  return row;
}

/** A record type that has stored records in this release (else 422 form_record.type_planned). */
export function assertWorking(r: FormRecordTypeRow): asserts r is FormRecordTypeRow & { table_name: string } {
  if (r.feature_status !== "working" || r.table_name === null) throw formRefusals.typePlanned();
}

/** Read access to a transformation's forms: `transformation.read` in scope (404 outside it). */
export async function requireTransformationRead(db: DbOrTx, request: FastifyRequest, transformationId: string) {
  return requireRead(db, principalOf(request), "transformation.read", { type: "transformation", id: transformationId });
}

/**
 * Write access to a record's form data, re-checked inside the write transaction on the principal reloaded there: the
 * transformation in scope (404) and the record type's write permission (403; ADR-0041 §9). Returns the acting user.
 */
export async function requireRecordWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  recordType: FormRecordTypeRow,
): Promise<{ userId: string; organizationId: string }> {
  // Scope on the request-start principal first: outside it the transformation does not exist for the caller (404).
  await requireRead(tx, principalOf(request), "transformation.read", { type: "transformation", id: transformationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    const target = await requireRead(tx, fresh, "transformation.read", {
      type: "transformation",
      id: transformationId,
    });
    if (recordType.write_permission_code === null) throw problems.forbidden();
    await requireAction(tx, fresh, recordType.write_permission_code as Permission, target);
    return { userId: fresh.userId!, organizationId: target.organizationId };
  } catch (err) {
    // A grant revoked while the request waited: 403 with the denial, never a silent 404 (commit-time authorization).
    throw commitTimeDenial(err);
  }
}

/** True when `recordId` is a stored record of the type in the transformation (T04/T16: of the right decision kind). */
export async function recordExists(
  db: DbOrTx,
  recordType: FormRecordTypeRow,
  transformationId: string,
  recordId: string,
): Promise<boolean> {
  if (recordType.table_name === null || recordType.table_name === "procedure_definition") return false;
  // Table and column names come from the read-only registry (0068 seed), never from input.
  let q = db
    .selectFrom(recordType.table_name as "tom_gap")
    .select("id")
    .where("id", "=", recordId)
    .where("transformation_id", "=", transformationId);
  if (recordType.discriminator_column !== null && recordType.discriminator_value !== null)
    q = q.where(recordType.discriminator_column as "id", "=", recordType.discriminator_value);
  return (await q.executeTakeFirst()) !== undefined;
}
