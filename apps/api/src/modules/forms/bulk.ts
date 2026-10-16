// Bulk editing of one native form's records (OpenAPI tag "forms"; ADR-0041 §5 "Bulk editing where suitable", §9,
// §10; REQ-S05-001; p5-work-split §B.4; T-DG5-BE-E2):
//   POST /transformations/{t}/form-records/{recordType}/bulk   bulkUpdateFormRecords
// 1-100 items `{recordId, version, sourceFields?, customFieldValues?}`, ALL-OR-NOTHING in one transaction:
//   - allowed only where form_record_type.bulk_edit_allowed (422 form_record.bulk_not_allowed); more than 100 items
//     422 form_record.bulk_too_many;
//   - `sourceFields` names source columns by their form field key (T15 `owner`, T08 `needed_by_date`, ...). Only the
//     columns marked bulk_editable (owner, due dates, impact/probability/stance, confidence) of a register whose own
//     update function is exposed (transformations/register-kit.ts `registerUpdaterOf`, or a module core in the
//     FormBulkUpdaters map below: T04, T05, T13, T14, T15, T16; T-DG5-BE-E3) are accepted; any other key is
//     422 form_record.bulk_field_not_editable. Each item goes through that update function: the register's own gates,
//     validation, business checks, version step, audit event and follow-up writes, exactly as a single PATCH;
//   - `customFieldValues` sets extension-field values (merged into the record's stored values; null clears one),
//     validated before persistence against the pinned form_schema version as putFormRecordCustomFields does (ADR-0041
//     §3, §4), with one audit event per values row written;
//   - every item carries the record version the user saw. All items are locked and checked first: any stale item is
//     409 form_record.bulk_conflict, listing every stale item as an error at `/items/<i>/version` with the record id
//     and its current version, and NOTHING is saved. A refusal of any item later in the run rolls back every item.
// Authorization: the transformation in scope (404) and the record type's write permission, re-checked on the
// principal reloaded inside the transaction (403; AUD holds none). No remote I/O in the transaction. A bulk edit
// approves nothing: no G1-G6 business approval is granted here.
import { sql, type FormCustomValueRow, type FormRecordTypeRow, type Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { FIELD_VALUE_MESSAGES, validateRecordValues, type DeferredCheck, type FieldValueCode } from "@mth/shared/calc";
import {
  FORM_BULK_MAX_ITEMS,
  formBulkUpdate,
  formRecordTypeCode,
  uuid,
  type FormBulkUpdateResult,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { createConfigResolver } from "../methodology/index.ts";
import { HttpProblem, parse, parseBody, problems, type ModuleDeps } from "../platform/index.ts";
import { registerUpdaterOf, type RegisterUpdater } from "../transformations/index.ts";
import { currentRecordVersion } from "./drafts.ts";
import { extensionDefinitions, mapFormDbError, resolveForm, type ResolvedFormField } from "./provider.ts";
import { assertWorking, formRefusals, loadRecordType, recordExists, requireRecordWrite } from "./record-types.ts";

export const FORM_BULK = "/api/v1/transformations/:transformationId/form-records/:recordType/bulk";
const JSON_BODY = ["application/json"] as const;
const params = z.strictObject({ transformationId: uuid, recordType: formRecordTypeCode });
const resolver = createConfigResolver();

/** ADR-0041 §10 refusals of the bulk edit (exact English texts). */
export const bulkRefusals = {
  notAllowed: () =>
    problems.businessRule("form_record.bulk_not_allowed", "Bulk editing is not available for this form."),
  fieldNotEditable: () =>
    problems.businessRule("form_record.bulk_field_not_editable", "This field cannot be bulk edited."),
  tooMany: () => problems.businessRule("form_record.bulk_too_many", "Edit at most 100 records at a time."),
  conflict: (stale: readonly { index: number; recordId: string; currentVersion: number }[]) =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "form_record.bulk_conflict",
      title: "Version conflict",
      detail: "One of the selected records changed. Nothing was saved; reload and try again.",
      errors: stale.map((s) => ({
        pointer: `/items/${s.index}/version`,
        code: "form_record.bulk_conflict",
        message: `Record ${s.recordId} is at version ${s.currentVersion}.`,
      })),
    }),
};

/**
 * T-DG5-BE-E3 (D-159 a; ADR-0041 §5): the forms bulk map of the registers whose PATCH core lives in their own module.
 * Under the ADR-0002 module graph forms imports none of these modules (and no P5 module imports workflows), so each
 * module exports its core through its index.ts and the composition root passes it in here, one line per register (the
 * meeting-pack assembler pattern, D-159). Each core runs inside the bulk transaction exactly as its single PATCH does:
 * the module's own authorization, validation, optimistic concurrency, audit event and follow-up writes.
 */
export interface FormBulkUpdaters {
  readonly T04: RegisterUpdater; // Design Decision Log: workflows/decisions.ts updateDesignDecision
  readonly T05: RegisterUpdater; // Initiative Card: portfolio/initiatives.ts updateInitiative
  readonly T13: RegisterUpdater; // Stakeholder & Adoption Plan: adoption/register.ts updateStakeholderGroup
  readonly T14: RegisterUpdater; // Benefits Register: benefits/register.ts updateBenefitRecord
  readonly T15: RegisterUpdater; // RAID: raid/register.ts updateRaidEntry
  readonly T16: RegisterUpdater; // Executive Decision Log: governance/executive-decisions.ts updateExecutiveDecision
}
const MODULE_UPDATERS = new Map<string, RegisterUpdater>();
/** Wires the module cores (server.ts). Unwired, their source fields stay 422 bulk_field_not_editable (fail closed). */
export function setFormBulkUpdaters(updaters: FormBulkUpdaters): void {
  MODULE_UPDATERS.clear();
  for (const [recordType, updater] of Object.entries(updaters)) MODULE_UPDATERS.set(recordType, updater);
}
/** The update function a bulk item of `rt` goes through: its module's core, else its register-kit update. */
const updaterOf = (rt: FormRecordTypeRow): RegisterUpdater | undefined =>
  MODULE_UPDATERS.get(rt.code) ?? (rt.table_name === null ? undefined : registerUpdaterOf(rt.table_name));

/** The register's PATCH body key of a typed column (`owner_user_id` -> `ownerUserId`). */
const bodyKeyOf = (column: string) => column.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/** The bulk-editable source columns of the form, by field key (only `column` storage in the type's own table). */
function bulkColumns(fields: readonly ResolvedFormField[], rt: FormRecordTypeRow): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fields) {
    if (f.origin !== "source" || !f.bulkEditable || f.storageKind !== "column" || f.storageRef === null) continue;
    const [table, column] = f.storageRef.split(".");
    if (table === rt.table_name && column !== undefined) out.set(f.key, column);
  }
  return out;
}

function fieldProblem(index: number, field: string, code: FieldValueCode) {
  return {
    pointer: `/items/${index}/customFieldValues/${field}`,
    code,
    message: new Map(Object.entries(FIELD_VALUE_MESSAGES)).get(code) ?? code,
  };
}

/**
 * The deferred checks of the validators, in the transaction (ADR-0041 §3 reference, attachment, lookup). The same
 * rules as forms/custom-values.ts (T-DG5-BE-D), whose checker is module-private; the handback asks for it to be shared.
 */
async function deferredProblems(
  tx: Tx,
  index: number,
  checks: readonly DeferredCheck[],
  transformationId: string,
  organizationId: string,
): Promise<ReturnType<typeof fieldProblem>[]> {
  const errors: ReturnType<typeof fieldProblem>[] = [];
  const exists = async (q: { executeTakeFirst(): Promise<unknown> }) => (await q.executeTakeFirst()) !== undefined;
  for (const c of checks) {
    if (c.kind === "reference") {
      const target = await tx
        .selectFrom("form_record_type")
        .selectAll()
        .where("code", "=", c.targetRecordType)
        .executeTakeFirst();
      if (target === undefined || !(await recordExists(tx, target, transformationId, c.id)))
        errors.push(fieldProblem(index, c.field, "validation.reference"));
    } else if (c.kind === "attachment") {
      const found = await tx
        .selectFrom("evidence")
        .select("id")
        .where("transformation_id", "=", transformationId)
        .where("id", "in", [...c.evidenceIds])
        .execute();
      if (found.length !== c.evidenceIds.length) errors.push(fieldProblem(index, c.field, "validation.attachment"));
    } else {
      let ok: boolean;
      switch (c.lookupSet) {
        case "users":
          ok = await exists(
            tx
              .selectFrom("app_user")
              .select("id")
              .where("id", "=", c.value)
              .where("organization_id", "=", organizationId)
              .where("status", "=", "active"),
          );
          break;
        case "business_units":
          ok = await exists(
            tx
              .selectFrom("business_unit")
              .select("id")
              .where("id", "=", c.value)
              .where("organization_id", "=", organizationId)
              .where("status", "=", "active"),
          );
          break;
        case "roles":
          ok = await exists(tx.selectFrom("role").select("id").where("code", "=", c.value));
          break;
        case "tom_dimensions":
          ok = await exists(tx.selectFrom("tom_dimension").select("id").where("code", "=", c.value));
          break;
        case "phases":
          ok = await exists(tx.selectFrom("phase_definition").select("id").where("code", "=", c.value));
          break;
        case "gates":
          ok = await exists(tx.selectFrom("gate_definition").select("id").where("code", "=", c.value));
          break;
        case "currencies":
          ok = /^[A-Z]{3}$/.test(c.value); // no currency registry: the ISO 4217 letter shape is the rule
          break;
        default:
          ok = false;
      }
      if (!ok) errors.push(fieldProblem(index, c.field, "validation.lookup"));
    }
  }
  return errors;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};

async function bulkUpdate(tx: Tx, request: FastifyRequest, p: z.infer<typeof params>): Promise<FormBulkUpdateResult> {
  const rt = await loadRecordType(tx, p.recordType);
  assertWorking(rt);
  const actor = await requireRecordWrite(tx, request, p.transformationId, rt);
  if (!rt.bulk_edit_allowed) throw bulkRefusals.notAllowed();
  const body = parseBody(formBulkUpdate, request.body);
  if (body.items.length > FORM_BULK_MAX_ITEMS) throw bulkRefusals.tooMany();
  const seen = new Set<string>();
  body.items.forEach((item, i) => {
    if (seen.has(item.recordId))
      throw problems.badRequest("validation.unique_items", "Each record may appear once.", `/items/${i}/recordId`);
    seen.add(item.recordId);
    if (item.sourceFields === undefined && item.customFieldValues === undefined)
      throw problems.badRequest("validation.required", "Name the fields to change.", `/items/${i}`);
  });

  const t = await tx
    .selectFrom("transformation")
    .select(["currency", "organization_id"])
    .where("id", "=", p.transformationId)
    .executeTakeFirstOrThrow();
  const pinned = await resolver.pinnedVersion(tx, p.transformationId, "form_schema");
  const form = await resolveForm(tx, pinned.versionId, rt);
  const columns = bulkColumns(form.fields, rt);
  const updater = updaterOf(rt);

  // Business rules on the request as a whole, before any record is read or written.
  for (const item of body.items) {
    for (const key of Object.keys(item.sourceFields ?? {}))
      if (!columns.has(key) || updater === undefined) throw bulkRefusals.fieldNotEditable();
    if (item.customFieldValues !== undefined && !rt.custom_fields_allowed) throw formRefusals.extensionsNotAllowed();
  }

  // Lock every record and check every version first: one stale item and nothing is saved.
  // Locks are taken in record-id order, so two concurrent bulk edits of the same records never deadlock.
  const stale: { index: number; recordId: string; currentVersion: number }[] = [];
  const byId = [...body.items.entries()].sort(([, a], [, b]) => (a.recordId < b.recordId ? -1 : 1));
  for (const [index, item] of byId) {
    const current = await currentRecordVersion(tx, rt, p.transformationId, item.recordId, true);
    if (current === null) throw problems.notFound();
    if (current !== item.version) stale.push({ index, recordId: item.recordId, currentVersion: current });
  }
  if (stale.length > 0) throw bulkRefusals.conflict(stale.sort((a, b) => a.index - b.index));

  const defs = extensionDefinitions(form, t.currency);
  const audit = auditContextOf(request);
  const result: FormBulkUpdateResult["items"] = [];
  for (const [index, item] of body.items.entries()) {
    let version = item.version;
    if (item.sourceFields !== undefined && Object.keys(item.sourceFields).length > 0) {
      const patch = Object.fromEntries(
        Object.entries(item.sourceFields).map(([key, v]) => [bodyKeyOf(columns.get(key)!), v]),
      );
      const updated = await updater!(tx, request, {
        transformationId: p.transformationId,
        recordId: item.recordId,
        expectedVersion: item.version,
        body: patch,
      });
      version = updated.version;
    }
    if (item.customFieldValues !== undefined)
      await writeCustomValues(tx, index, item.recordId, item.customFieldValues, {
        rt,
        defs,
        versionId: pinned.versionId,
        transformationId: p.transformationId,
        organizationId: t.organization_id,
        userId: actor.userId,
        audit,
      });
    result.push({ recordId: item.recordId, version });
  }
  return { items: result };
}

/** Merges and validates one record's extension values, then writes its values row with one audit event. */
async function writeCustomValues(
  tx: Tx,
  index: number,
  recordId: string,
  changes: Record<string, unknown>,
  c: {
    rt: FormRecordTypeRow;
    defs: ReturnType<typeof extensionDefinitions>;
    versionId: string;
    transformationId: string;
    organizationId: string;
    userId: string;
    audit: ReturnType<typeof auditContextOf>;
  },
): Promise<void> {
  const current = await tx
    .selectFrom("form_custom_value")
    .selectAll()
    .where("record_type", "=", c.rt.code)
    .where("record_id", "=", recordId)
    .forUpdate()
    .executeTakeFirst();
  const known = new Set(c.defs.map((d) => d.key));
  // Stored keys of fields this version no longer has stay in history, not in the new row (the guard refuses them).
  const prior = Object.fromEntries(Object.entries(asObject(current?.field_values)).filter(([k]) => known.has(k)));
  const merged = { ...prior, ...changes };
  const v = validateRecordValues(c.defs, merged, { percentageBareAs: "fraction" });
  if (!v.ok) {
    if (v.status === 400)
      throw problems.validation(
        v.problems.map((x) => ({
          pointer: `/items/${index}/customFieldValues/${x.field}`,
          code: x.code,
          message: x.message,
        })),
      );
    throw v.code === "form_record.custom_field_required"
      ? formRefusals.customFieldRequired()
      : formRefusals.customFieldUnknown();
  }
  const errors = await deferredProblems(tx, index, v.checks, c.transformationId, c.organizationId);
  if (errors.length > 0) throw problems.validation(errors);
  const next = Object.fromEntries(Object.entries(v.values).filter(([, x]) => x !== null));
  let row: FormCustomValueRow;
  if (current === undefined) {
    row = await tx
      .insertInto("form_custom_value")
      .values({
        id: uuidv7(),
        organization_id: c.organizationId,
        transformation_id: c.transformationId,
        record_type: c.rt.code,
        record_id: recordId,
        form_schema_version_id: c.versionId,
        field_values: JSON.stringify(next),
        created_by: c.userId,
        updated_by: c.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } else {
    row = await tx
      .updateTable("form_custom_value")
      .set({
        form_schema_version_id: c.versionId,
        field_values: JSON.stringify(next),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: c.userId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  await record(tx, c.audit, {
    action: current === undefined ? "form_custom_value.create" : "form_custom_value.update",
    recordType: "form_custom_value",
    recordId: row.id,
    organizationId: c.organizationId,
    transformationId: c.transformationId,
    priorVersion: current?.version ?? null,
    newVersion: row.version,
    changes: {
      field_values: { from: current === undefined ? null : current.field_values, to: next },
      ...(current === undefined || current.form_schema_version_id !== c.versionId
        ? { form_schema_version_id: { from: current?.form_schema_version_id ?? null, to: c.versionId } }
        : {}),
      ...(current === undefined
        ? { record_type: { from: null, to: c.rt.code }, record_id: { from: null, to: recordId } }
        : {}),
    },
  });
}

export function registerFormBulkRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // The write permission depends on the record type (ADR-0041 §9) and is checked in the handler.
  const config = { access: { permission: "transformation.read" as const }, consumes: JSON_BODY };
  app.post(FORM_BULK, { config }, async (request) => {
    const p = parse(params, request.params, "params");
    return db
      .transaction()
      .execute((tx) => bulkUpdate(tx, request, p))
      .catch((err: unknown) => {
        if (err instanceof HttpProblem) throw err;
        throw mapFormDbError(err) ?? err;
      });
  });
  return [`POST ${FORM_BULK}`];
}
