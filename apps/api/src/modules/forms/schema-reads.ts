// Form schema reads (OpenAPI tag "forms"; ADR-0041 §1, §2, §5 "inline help", §9; REQ-S05-001, REQ-S05-002,
// REQ-S05-006; p5-work-split §B.2; T-DG5-BE-D):
//   GET /admin/form-schemas                                          listFormRecordTypes (methodology.read)
//   GET /admin/form-schemas/{recordType}?versionId=                  getFormSchemaAdmin (methodology.read)
//   GET /transformations/{transformationId}/form-schemas/{recordType} getTransformationFormSchema (transformation.read)
// The registry lists the native forms with the extension badge (true exactly for the twelve M0149 record types). A form
// schema resolves the protected source columns (form_source_field) and the extension fields of one form_schema version:
// the admin read defaults to the newest published `forms` version; the transformation read uses the version the
// transformation is pinned to, else forms v1 (ADR-0039 §3; DG1-DG4 transformations read forms v1). Read-only.
import type { DbOrTx, FormRecordTypeRow } from "@mth/db";
import { formRecordTypeCode, formRecordTypeListQuery, uuid, type FormSchema } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { holdsAnywhere, principalOf } from "../access/index.ts";
import { createConfigResolver } from "../methodology/index.ts";
import { parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import { resolveForm, settingsOf } from "./provider.ts";
import { FORMS_KEY } from "./pin-initializer.ts";
import {
  assertWorking,
  listRecordTypes,
  loadRecordType,
  requireTransformationRead,
  toFormRecordType,
} from "./record-types.ts";

export const ADMIN_FORM_SCHEMAS = "/api/v1/admin/form-schemas";
const ADMIN_FORM_SCHEMA = `${ADMIN_FORM_SCHEMAS}/:recordType`;
const TRANSFORMATION_FORM_SCHEMA = "/api/v1/transformations/:transformationId/form-schemas/:recordType";
const DEFAULT_CURRENCY = "SAR";

const recordTypeParams = z.strictObject({ recordType: formRecordTypeCode });
const transformationParams = z.strictObject({ transformationId: uuid, recordType: formRecordTypeCode });
const adminSchemaQuery = z.strictObject({ versionId: uuid.optional() });
const resolver = createConfigResolver();

/**
 * methodology.read (Studio configuration is global, ADR-0041 §9, as slice A's Studio reads): 403 without it. The
 * registry and form schemas are platform configuration, not records of an organization, so there is no 404 scope.
 */
function requireMethodologyRead(request: FastifyRequest): void {
  if (!holdsAnywhere(principalOf(request), "methodology.read")) throw problems.forbidden();
}

/** The FormSchema body of one record type in one form_schema version. */
export async function toFormSchema(
  db: DbOrTx,
  version: { readonly id: string; readonly versionNo: number },
  rt: FormRecordTypeRow,
  currency: string,
): Promise<FormSchema> {
  const form = await resolveForm(db, version.id, rt);
  return {
    recordType: toFormRecordType(rt),
    formSchemaVersionId: version.id,
    versionNo: version.versionNo,
    labelEn: form.labelEn,
    labelAr: form.labelAr,
    helpEn: form.helpEn,
    helpAr: form.helpAr,
    fields: form.fields.map((f) => ({
      key: f.key,
      origin: f.origin,
      protected: f.origin === "source",
      extension: f.origin === "admin",
      fieldType: f.fieldType,
      labelEn: f.labelEn,
      labelAr: f.labelAr,
      helpEn: f.helpEn,
      helpAr: f.helpAr,
      required: f.required,
      bulkEditable: f.bulkEditable,
      storageKind: f.storageKind,
      sourceRef: f.sourceRef,
      ordinal: f.ordinal,
      settings: settingsOf(f, currency),
    })),
  };
}

/** The admin read's version: `versionId` (any form_schema version), else the newest published `forms` version. */
async function adminVersion(db: DbOrTx, versionId: string | undefined) {
  let q = db.selectFrom("methodology_version").select(["id", "version_no"]).where("config_kind", "=", "form_schema");
  q =
    versionId !== undefined
      ? q.where("id", "=", versionId)
      : q.where("key", "=", FORMS_KEY).where("status", "=", "published").orderBy("version_no", "desc").limit(1);
  const v = await q.executeTakeFirst();
  if (v === undefined) throw problems.notFound();
  return { id: v.id, versionNo: v.version_no };
}

export function registerFormSchemaReadRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const methodologyRead = { access: { permission: "methodology.read" as const } };

  app.get(ADMIN_FORM_SCHEMAS, { config: methodologyRead }, async (request) => {
    const query = parseQuery(formRecordTypeListQuery, request.query);
    requireMethodologyRead(request);
    const rows = await listRecordTypes(db, query.kind);
    return { items: rows.map(toFormRecordType) };
  });

  app.get(ADMIN_FORM_SCHEMA, { config: methodologyRead }, async (request) => {
    const { recordType } = parse(recordTypeParams, request.params, "params");
    const query = parseQuery(adminSchemaQuery, request.query);
    requireMethodologyRead(request);
    const rt = await loadRecordType(db, recordType);
    const version = await adminVersion(db, query.versionId);
    return toFormSchema(db, version, rt, DEFAULT_CURRENCY);
  });

  app.get(
    TRANSFORMATION_FORM_SCHEMA,
    { config: { access: { permission: "transformation.read" as const } } },
    async (request) => {
      const { transformationId, recordType } = parse(transformationParams, request.params, "params");
      parseQuery(z.strictObject({}), request.query);
      await requireTransformationRead(db, request, transformationId);
      const rt = await loadRecordType(db, recordType);
      assertWorking(rt);
      const t = await db
        .selectFrom("transformation")
        .select("currency")
        .where("id", "=", transformationId)
        .executeTakeFirstOrThrow();
      const pinned = await resolver.pinnedVersion(db, transformationId, "form_schema");
      return toFormSchema(db, { id: pinned.versionId, versionNo: pinned.versionNo }, rt, t.currency);
    },
  );

  return [`GET ${ADMIN_FORM_SCHEMAS}`, `GET ${ADMIN_FORM_SCHEMA}`, `GET ${TRANSFORMATION_FORM_SCHEMA}`];
}
