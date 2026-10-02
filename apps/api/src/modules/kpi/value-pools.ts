// Value pools (REQ-PB-028, ADR-0019; OpenAPI tag "diagnose", served by the kpi module): quantified by driver with
// decimal upside/downside, or explicitly `unquantified` with NULL amounts - never 0. Currency defaults to the
// transformation's (SAR by default). Permission diagnostic.edit (TL, TO); reads transformation.read.
// Finance validation (finance.validate, FIN; never the creator; only quantified pools): the decision covers the
// version it creates; a later edit makes it stale, so a validated total (value.ts, basis "validated") never rises
// before Finance decides on the current figures.
import { diffFields, sql } from "@mth/db";
import { reasonRequest, validationDecision, valuePoolCreate, valuePoolUpdate } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { findValuePool, toValuePool, VALUE_POOL_AUDIT_FIELDS, workstreamExists } from "./repository.ts";
import { resolveQuantification, UNQUANTIFIED, type QuantificationState } from "./rules.ts";
import type { RouteAdder } from "./routes.ts";
import {
  archivedRecord,
  check,
  creatorDenied,
  idempotentCreate,
  listPage,
  parseRecordParams,
  readScope,
  referenceProblem,
  requireActiveUsers,
  transformationParams,
  writeScope,
} from "./support.ts";
import type { DbOrTx } from "@mth/db";

const BASE = "/api/v1/transformations/:transformationId/value-pools";
const ITEM = `${BASE}/:valuePoolId`;
const PERMISSION = "diagnostic.edit";

async function requireWorkstream(db: DbOrTx, code: string | null | undefined) {
  if (typeof code === "string" && !(await workstreamExists(db, code)))
    throw referenceProblem("/workstreamCode", "Unknown Diagnose workstream code.");
}

const stateOf = (r: {
  quantification_status: string;
  upside_amount: string | null;
  downside_amount: string | null;
  unquantified_reason: string | null;
}): QuantificationState => ({
  quantificationStatus: r.quantification_status === "quantified" ? "quantified" : "unquantified",
  upsideAmount: r.upside_amount,
  downsideAmount: r.downside_amount,
  unquantifiedReason: r.unquantified_reason,
});

export function registerValuePoolRoutes(app: FastifyInstance, { db }: ModuleDeps, add: RouteAdder): void {
  add(app, "GET", BASE, "transformation.read", async (request) => listPage(db, request, "value_pool", toValuePool));

  add(app, "POST", BASE, PERMISSION, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    return idempotentCreate(
      db,
      request,
      reply,
      `/api/v1/transformations/${transformationId}/value-pools`,
      (tx) => writeScope(tx, request, transformationId, PERMISSION),
      async (tx, { transformation }) => {
        const body = parseBody(valuePoolCreate, request.body);
        const { state, violation } = resolveQuantification(UNQUANTIFIED, body);
        check(violation);
        await requireWorkstream(tx, body.workstreamCode);
        await requireActiveUsers(tx, transformation.organization_id, [["ownerUserId", body.ownerUserId]]);
        const id = uuidv7();
        const row = await tx
          .insertInto("value_pool")
          .values({
            id,
            organization_id: transformation.organization_id,
            transformation_id: transformationId,
            name: body.name,
            driver: body.driver ?? null,
            workstream_code: body.workstreamCode ?? null,
            quantification_status: state.quantificationStatus,
            upside_amount: state.upsideAmount,
            downside_amount: state.downsideAmount,
            currency: body.currency ?? transformation.currency,
            unquantified_reason: state.unquantifiedReason,
            ...(body.materiality !== undefined ? { materiality: body.materiality } : {}),
            confidence: body.confidence ?? null,
            owner_user_id: body.ownerUserId ?? null,
            created_by: principal.userId!,
            updated_by: principal.userId!,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, audit, {
          action: "value_pool.create",
          recordType: "value_pool",
          recordId: id,
          organizationId: row.organization_id,
          transformationId,
          newVersion: 1,
          changes: diffFields({} as typeof row, row, [...VALUE_POOL_AUDIT_FIELDS]),
        });
        return toValuePool(row);
      },
    );
  });

  add(app, "GET", ITEM, "transformation.read", async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "valuePoolId");
    await readScope(db, request, transformationId);
    const row = await findValuePool(db, transformationId, id);
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toValuePool(row));
  });

  add(app, "PATCH", ITEM, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "valuePoolId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      const { transformation } = await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const body = parseBody(valuePoolUpdate, request.body);
      const current = await findValuePool(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("value_pool");
      const { state, violation } = resolveQuantification(stateOf(current), body);
      check(violation);
      await requireWorkstream(tx, body.workstreamCode);
      await requireActiveUsers(tx, transformation.organization_id, [["ownerUserId", body.ownerUserId]]);
      // CHECK value_pool_validated_quantified: a pool that becomes unquantified loses its validation (the audit diff
      // keeps the prior decision). Every other edit keeps the decision, which becomes stale (validatedRecordVersion <
      // version) and stops counting towards a validated total.
      const withdrawValidation =
        current.validation_status === "validated" && state.quantificationStatus === "unquantified";
      const updated = await tx
        .updateTable("value_pool")
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.driver !== undefined ? { driver: body.driver } : {}),
          ...(body.workstreamCode !== undefined ? { workstream_code: body.workstreamCode } : {}),
          quantification_status: state.quantificationStatus,
          upside_amount: state.upsideAmount,
          downside_amount: state.downsideAmount,
          unquantified_reason: state.unquantifiedReason,
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.materiality !== undefined ? { materiality: body.materiality } : {}),
          ...(body.confidence !== undefined ? { confidence: body.confidence } : {}),
          ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
          ...(withdrawValidation
            ? {
                validation_status: "unvalidated",
                validated_by: null,
                validated_at: null,
                validation_note: null,
                validated_record_version: null,
              }
            : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId!,
        })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "value_pool.update",
        recordType: "value_pool",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(current, updated, [...VALUE_POOL_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toValuePool(row));
  });

  add(app, "POST", `${ITEM}/archive`, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "valuePoolId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const { reason } = parseBody(reasonRequest, request.body);
      const current = await findValuePool(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived")
        throw problems.businessRule("value_pool.already_archived", "The value pool is already archived.");
      const updated = await tx
        .updateTable("value_pool")
        .set({
          status: "archived",
          archived_at: sql<Date>`now()`,
          archived_by: principal.userId!,
          archive_reason: reason,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId!,
        })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "value_pool.archive",
        recordType: "value_pool",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason,
        changes: diffFields(current, updated, [...VALUE_POOL_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toValuePool(row));
  });

  add(app, "POST", `${ITEM}/validation`, "finance.validate", async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "valuePoolId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, "finance.validate");
      const expected = requireIfMatch(request);
      const decision = parseBody(validationDecision, request.body);
      const current = await findValuePool(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.created_by === principal.userId)
        throw creatorDenied(
          "kpi.creator_cannot_validate",
          "Finance validation is never done by the person who created the value pool.",
          "finance.validate",
          { recordType: "value_pool", recordId: id, organizationId: current.organization_id, transformationId },
        );
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("value_pool");
      if (current.quantification_status !== "quantified")
        throw problems.businessRule(
          "value_pool.unquantified",
          "Only a quantified value pool can be validated or rejected; quantify it first.",
        );
      const updated = await tx
        .updateTable("value_pool")
        .set({
          validation_status: decision.result,
          validated_by: principal.userId!,
          validated_at: sql<Date>`now()`,
          validation_note: decision.note,
          validated_record_version: current.version + 1,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId!,
        })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: decision.result === "validated" ? "value_pool.validate" : "value_pool.reject",
        recordType: "value_pool",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: decision.note,
        changes: diffFields(current, updated, [...VALUE_POOL_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toValuePool(row));
  });
}
