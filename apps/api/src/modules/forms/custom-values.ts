// Custom-field (extension-field) values of one record (OpenAPI tag "forms"; ADR-0041 §3, §4, §7, §9, §10;
// REQ-S16-010, REQ-S06-005, REQ-S05-002; p5-work-split §B.2; T-DG5-BE-D):
//   GET /transformations/{t}/form-records/{recordType}/{recordId}/custom-fields   getFormRecordCustomFields
//   PUT /transformations/{t}/form-records/{recordType}/{recordId}/custom-fields   putFormRecordCustomFields
// Values live in `form_custom_value` (one row per record; core entity columns stay typed and unchanged) and are
// VALIDATED BEFORE PERSISTENCE against the form_schema version the transformation is pinned to (ConfigResolver; forms
// v1 when unpinned): every key an active extension field of the record type (422 form_record.custom_field_unknown;
// calculated fields are never stored), every value by the KBE-B validators of its type (400 with the field codes:
// decimals as strings, a percentage as a fraction, "12%" -> "0.12"; currency as {amount, currencyCode}, no float on
// any path), references, attachments and lookups checked in the transaction, required extension fields present (422
// form_record.custom_field_required). The database guard form_custom_value_guard repeats the structural part.
// The PUT: transformation in scope (404), the record type's write permission re-checked on the principal reloaded in
// the transaction (403; AUD holds none), If-Match = the values' version, "0" creates (428 missing; 409
// form_record.conflict with currentVersion when stale), one audit event in the same transaction, no remote I/O.
// GET returns the stored values (every active extension field, null = Unknown, never 0), the calculated fields
// evaluated through the DG3 engine (Not computable with the missing fields named), and version 0 when none stored.
import { sql, type DbOrTx, type FormCustomValueRow, type FormRecordTypeRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  evaluateCalculatedField,
  FIELD_VALUE_MESSAGES,
  toCalculatedEntry,
  validateRecordValues,
  type DeferredCheck,
  type FieldValueCode,
} from "@mth/shared/calc";
import { formCustomValuesPut, formRecordTypeCode, uuid, type FormCustomValues } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { createConfigResolver } from "../methodology/index.ts";
import {
  HttpProblem,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  calculatedSettingsOf,
  extensionDefinitions,
  mapFormDbError,
  numericVariables,
  resolveForm,
  sourceInputs,
  type ResolvedForm,
} from "./provider.ts";
import {
  assertWorking,
  formRefusals,
  loadRecordType,
  recordExists,
  requireRecordWrite,
  requireTransformationRead,
} from "./record-types.ts";

export const CUSTOM_FIELDS =
  "/api/v1/transformations/:transformationId/form-records/:recordType/:recordId/custom-fields";
const JSON_BODY = ["application/json"] as const;
const params = z.strictObject({ transformationId: uuid, recordType: formRecordTypeCode, recordId: uuid });
type Params = z.infer<typeof params>;
const resolver = createConfigResolver();

/** 409 form_record.conflict (ADR-0041 §5 "recoverable conflict"); currentVersion when a row exists. */
function conflict(currentVersion: number | null): HttpProblem {
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "form_record.conflict",
    title: "Version conflict",
    detail: "This record changed since you opened it. Review the current version, then apply your changes again.",
    ...(currentVersion !== null ? { currentVersion } : {}),
  });
}

/** If-Match of the PUT: `"0"` creates the values row (IfMatchOrZero). */
function valuesIfMatch(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

async function loadValuesRow(db: DbOrTx, recordType: string, recordId: string, forUpdate = false) {
  let q = db
    .selectFrom("form_custom_value")
    .selectAll()
    .where("record_type", "=", recordType)
    .where("record_id", "=", recordId);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

/** The FormCustomValues body: every active extension field (null = Unknown) and the calculated fields evaluated. */
async function present(
  db: DbOrTx,
  p: Params,
  rt: FormRecordTypeRow,
  form: ResolvedForm,
  versionId: string,
  currency: string,
  row: FormCustomValueRow | undefined,
): Promise<FormCustomValues> {
  const stored = asObject(row?.field_values);
  const values = new Map<string, unknown>();
  const calculated = new Map<string, FormCustomValues["calculated"][string]>();
  const storedMap = new Map(Object.entries(stored));
  const active = form.fields.filter((f) => f.origin === "admin" && !f.removed);
  for (const f of active) if (f.fieldType !== "calculated") values.set(f.key, storedMap.get(f.key) ?? null);
  // A value of a field this version no longer has stays in the row (history); it is shown, never dropped.
  for (const [k, v] of storedMap) if (!values.has(k)) values.set(k, v);
  const calc = active.filter((f) => f.fieldType === "calculated");
  if (calc.length > 0) {
    const inputs = { ...(await sourceInputs(db, rt, form, p.recordId)), ...stored };
    const vars = numericVariables(form, currency);
    for (const f of calc) {
      const cs = calculatedSettingsOf(f);
      if (cs === null) continue;
      calculated.set(f.key, toCalculatedEntry(evaluateCalculatedField(cs, vars, inputs)));
    }
  }
  return {
    recordType: rt.code,
    recordId: p.recordId,
    formSchemaVersionId: row?.form_schema_version_id ?? versionId,
    values: Object.fromEntries(values),
    calculated: Object.fromEntries(calculated),
    version: row?.version ?? 0,
    updatedAt: row === undefined ? null : row.updated_at.toISOString(),
    updatedBy: row?.updated_by ?? null,
  };
}

function fieldProblem(field: string, code: FieldValueCode) {
  return {
    pointer: `/values/${field}`,
    code,
    message: new Map(Object.entries(FIELD_VALUE_MESSAGES)).get(code) ?? code,
  };
}

/** The deferred checks of the validators, in the transaction (ADR-0041 §3 reference, attachment, lookup). */
async function runDeferredChecks(
  tx: Tx,
  checks: readonly DeferredCheck[],
  transformationId: string,
  organizationId: string,
): Promise<void> {
  const errors: ReturnType<typeof fieldProblem>[] = [];
  for (const c of checks) {
    if (c.kind === "reference") {
      const target = await tx
        .selectFrom("form_record_type")
        .selectAll()
        .where("code", "=", c.targetRecordType)
        .executeTakeFirst();
      if (target === undefined || !(await recordExists(tx, target, transformationId, c.id)))
        errors.push(fieldProblem(c.field, "validation.reference"));
    } else if (c.kind === "attachment") {
      const found = await tx
        .selectFrom("evidence")
        .select("id")
        .where("transformation_id", "=", transformationId)
        .where("id", "in", [...c.evidenceIds])
        .execute();
      if (found.length !== c.evidenceIds.length) errors.push(fieldProblem(c.field, "validation.attachment"));
    } else if (!(await lookupMember(tx, c.lookupSet, c.value, organizationId))) {
      errors.push(fieldProblem(c.field, "validation.lookup"));
    }
  }
  if (errors.length > 0) throw problems.validation(errors);
}

/** True when `value` is an active member of the lookup set (ADR-0041 §3 `lookup`). */
async function lookupMember(tx: Tx, set: string, value: string, organizationId: string): Promise<boolean> {
  const exists = async (q: { executeTakeFirst(): Promise<unknown> }) => (await q.executeTakeFirst()) !== undefined;
  switch (set) {
    case "users":
      return exists(
        tx
          .selectFrom("app_user")
          .select("id")
          .where("id", "=", value)
          .where("organization_id", "=", organizationId)
          .where("status", "=", "active"),
      );
    case "business_units":
      return exists(
        tx
          .selectFrom("business_unit")
          .select("id")
          .where("id", "=", value)
          .where("organization_id", "=", organizationId)
          .where("status", "=", "active"),
      );
    case "roles":
      return exists(tx.selectFrom("role").select("id").where("code", "=", value));
    case "tom_dimensions":
      return exists(tx.selectFrom("tom_dimension").select("id").where("code", "=", value));
    case "phases":
      return exists(tx.selectFrom("phase_definition").select("id").where("code", "=", value));
    case "gates":
      return exists(tx.selectFrom("gate_definition").select("id").where("code", "=", value));
    case "currencies":
      // No currency registry exists: the ISO 4217 letter shape (checked by the validator) is the membership rule.
      return /^[A-Z]{3}$/.test(value);
    default:
      return false;
  }
}

async function putValues(tx: Tx, request: FastifyRequest, p: Params): Promise<FormCustomValues> {
  const rt = await loadRecordType(tx, p.recordType);
  assertWorking(rt);
  const actor = await requireRecordWrite(tx, request, p.transformationId, rt);
  if (!rt.custom_fields_allowed) throw formRefusals.extensionsNotAllowed();
  const body = parseBody(formCustomValuesPut, request.body);
  const expected = valuesIfMatch(request);
  if (!(await recordExists(tx, rt, p.transformationId, p.recordId))) throw problems.notFound();
  const t = await tx
    .selectFrom("transformation")
    .select(["currency", "organization_id"])
    .where("id", "=", p.transformationId)
    .executeTakeFirstOrThrow();
  const pinned = await resolver.pinnedVersion(tx, p.transformationId, "form_schema");
  const form = await resolveForm(tx, pinned.versionId, rt);

  // Validation before persistence (REQ-S16-010): unknown keys 422, invalid values 400, missing required 422.
  const v = validateRecordValues(extensionDefinitions(form, t.currency), body.values, { percentageBareAs: "fraction" });
  if (!v.ok) {
    if (v.status === 400)
      throw problems.validation(
        v.problems.map((x) => ({ pointer: `/values/${x.field}`, code: x.code, message: x.message })),
      );
    throw v.code === "form_record.custom_field_required"
      ? formRefusals.customFieldRequired()
      : formRefusals.customFieldUnknown();
  }
  await runDeferredChecks(tx, v.checks, p.transformationId, t.organization_id);

  const current = await loadValuesRow(tx, rt.code, p.recordId, true);
  if ((current?.version ?? 0) !== expected) throw conflict(current?.version ?? null);
  // Unknown (null) is stored as absent: the row holds only known values; absent keys are cleared.
  const next = Object.fromEntries(Object.entries(v.values).filter(([, x]) => x !== null));
  const audit = auditContextOf(request);
  let row: FormCustomValueRow;
  if (current === undefined) {
    row = await tx
      .insertInto("form_custom_value")
      .values({
        id: uuidv7(),
        organization_id: t.organization_id,
        transformation_id: p.transformationId,
        record_type: rt.code,
        record_id: p.recordId,
        form_schema_version_id: pinned.versionId,
        field_values: JSON.stringify(next),
        created_by: actor.userId,
        updated_by: actor.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } else {
    row = await tx
      .updateTable("form_custom_value")
      .set({
        form_schema_version_id: pinned.versionId,
        field_values: JSON.stringify(next),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: actor.userId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  await record(tx, audit, {
    action: current === undefined ? "form_custom_value.create" : "form_custom_value.update",
    recordType: "form_custom_value",
    recordId: row.id,
    organizationId: t.organization_id,
    transformationId: p.transformationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes: {
      field_values: { from: current === undefined ? null : current.field_values, to: next },
      ...(current === undefined || current.form_schema_version_id !== pinned.versionId
        ? { form_schema_version_id: { from: current?.form_schema_version_id ?? null, to: pinned.versionId } }
        : {}),
      ...(current === undefined
        ? { record_type: { from: null, to: rt.code }, record_id: { from: null, to: p.recordId } }
        : {}),
    },
  });
  return present(tx, p, rt, form, pinned.versionId, t.currency, row);
}

export function registerCustomValueRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // The write permission depends on the record type (ADR-0041 §9) and is checked in the handler; the route declares
  // the read permission every caller needs first.
  const read = { access: { permission: "transformation.read" as const } };

  app.get(CUSTOM_FIELDS, { config: read }, async (request, reply) => {
    const p = parse(params, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, request, p.transformationId);
    const rt = await loadRecordType(db, p.recordType);
    if (!(await recordExists(db, rt, p.transformationId, p.recordId))) throw problems.notFound();
    const t = await db
      .selectFrom("transformation")
      .select("currency")
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    const pinned = await resolver.pinnedVersion(db, p.transformationId, "form_schema");
    const form = await resolveForm(db, pinned.versionId, rt);
    const row = await loadValuesRow(db, rt.code, p.recordId);
    const body = await present(db, p, rt, form, pinned.versionId, t.currency, row);
    reply.header("ETag", `"${body.version}"`);
    return body;
  });

  app.put(CUSTOM_FIELDS, { config: { ...read, consumes: JSON_BODY } }, async (request, reply) => {
    const p = parse(params, request.params, "params");
    const body = await db
      .transaction()
      .execute((tx) => putValues(tx, request, p))
      .catch((err: unknown) => {
        const e = err as { code?: string; constraint?: string };
        // Two first writes raced on the one row per record: the loser sees the recoverable conflict.
        if (e.code === "23505" && e.constraint === "form_custom_value_record_key") throw conflict(null);
        const mapped = err instanceof HttpProblem ? null : mapFormDbError(err);
        throw mapped ?? err;
      });
    reply.header("ETag", `"${body.version}"`);
    return body;
  });

  return [`GET ${CUSTOM_FIELDS}`, `PUT ${CUSTOM_FIELDS}`];
}
