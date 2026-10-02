// KPI dictionary entries (P2 subset of REQ-S07-001; OpenAPI tag "kpi"): list, create, read, update, archive.
// Permission kpi_definition.edit (TL, KDS); reads need transformation.read.
import { diffFields, sql } from "@mth/db";
import { kpiDefinitionCreate, kpiDefinitionUpdate, reasonRequest } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { findKpiDefinition, KPI_DEFINITION_AUDIT_FIELDS, kpiDefinitionInUse, toKpiDefinition } from "./repository.ts";
import { kpiDefinitionUnitRule } from "./rules.ts";
import {
  archivedRecord,
  check,
  idempotentCreate,
  listPage,
  parseRecordParams,
  readScope,
  requireActiveUsers,
  transformationParams,
  writeScope,
} from "./support.ts";
import type { RouteAdder } from "./routes.ts";

const BASE = "/api/v1/transformations/:transformationId/kpi-definitions";
const ITEM = `${BASE}/:kpiDefinitionId`;
const PERMISSION = "kpi_definition.edit";

const duplicateName = (e: { code?: string; constraint?: string }) => {
  if (e.code === "23505" && e.constraint === "kpi_definition_name_key")
    return problems.duplicate("duplicate.name", "A KPI with this name already exists in the transformation.");
  return e;
};

export function registerKpiDefinitionRoutes(app: FastifyInstance, { db }: ModuleDeps, add: RouteAdder): void {
  add(app, "GET", BASE, "transformation.read", async (request) =>
    listPage(db, request, "kpi_definition", toKpiDefinition),
  );

  add(app, "POST", BASE, PERMISSION, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    return idempotentCreate(
      db,
      request,
      reply,
      `/api/v1/transformations/${transformationId}/kpi-definitions`,
      (tx) => writeScope(tx, request, transformationId, PERMISSION),
      async (tx, { transformation }) => {
        const body = parseBody(kpiDefinitionCreate, request.body);
        check(kpiDefinitionUnitRule(body.unitKind, body.currency ?? null));
        await requireActiveUsers(tx, transformation.organization_id, [
          ["ownerUserId", body.ownerUserId],
          ["stewardUserId", body.stewardUserId],
        ]);
        const id = uuidv7();
        const row = await tx
          .insertInto("kpi_definition")
          .values({
            id,
            organization_id: transformation.organization_id,
            transformation_id: transformationId,
            name: body.name,
            description: body.description ?? null,
            business_purpose: body.businessPurpose ?? null,
            unit_kind: body.unitKind,
            unit_label: body.unitLabel ?? null,
            currency: body.currency ?? null,
            polarity: body.polarity,
            ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
            ...(body.isLeading !== undefined ? { is_leading: body.isLeading } : {}),
            data_source: body.dataSource ?? null,
            owner_user_id: body.ownerUserId ?? null,
            steward_user_id: body.stewardUserId ?? null,
            created_by: principal.userId!,
            updated_by: principal.userId!,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((e: { code?: string; constraint?: string }) => {
            throw duplicateName(e);
          });
        await record(tx, audit, {
          action: "kpi_definition.create",
          recordType: "kpi_definition",
          recordId: id,
          organizationId: row.organization_id,
          transformationId,
          newVersion: 1,
          changes: diffFields({} as typeof row, row, [...KPI_DEFINITION_AUDIT_FIELDS]),
        });
        return toKpiDefinition(row);
      },
    );
  });

  add(app, "GET", ITEM, "transformation.read", async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "kpiDefinitionId");
    await readScope(db, request, transformationId);
    const row = await findKpiDefinition(db, transformationId, id);
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toKpiDefinition(row));
  });

  add(app, "PATCH", ITEM, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "kpiDefinitionId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      const { transformation } = await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const body = parseBody(kpiDefinitionUpdate, request.body);
      const current = await findKpiDefinition(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("kpi_definition");
      const unitKind = body.unitKind ?? current.unit_kind;
      const currency = body.currency !== undefined ? body.currency : current.currency;
      check(kpiDefinitionUnitRule(unitKind, currency));
      await requireActiveUsers(tx, transformation.organization_id, [
        ["ownerUserId", body.ownerUserId],
        ["stewardUserId", body.stewardUserId],
      ]);
      const updated = await tx
        .updateTable("kpi_definition")
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.businessPurpose !== undefined ? { business_purpose: body.businessPurpose } : {}),
          ...(body.unitKind !== undefined ? { unit_kind: body.unitKind } : {}),
          ...(body.unitLabel !== undefined ? { unit_label: body.unitLabel } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.polarity !== undefined ? { polarity: body.polarity } : {}),
          ...(body.frequency !== undefined ? { frequency: body.frequency } : {}),
          ...(body.isLeading !== undefined ? { is_leading: body.isLeading } : {}),
          ...(body.dataSource !== undefined ? { data_source: body.dataSource } : {}),
          ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
          ...(body.stewardUserId !== undefined ? { steward_user_id: body.stewardUserId } : {}),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId!,
        })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((e: { code?: string; constraint?: string }) => {
          throw duplicateName(e);
        });
      await record(tx, audit, {
        action: "kpi_definition.update",
        recordType: "kpi_definition",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(current, updated, [...KPI_DEFINITION_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toKpiDefinition(row));
  });

  add(app, "POST", `${ITEM}/archive`, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "kpiDefinitionId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const { reason } = parseBody(reasonRequest, request.body);
      const current = await findKpiDefinition(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived")
        throw problems.businessRule("kpi_definition.already_archived", "The KPI definition is already archived.");
      if (await kpiDefinitionInUse(tx, transformationId, id))
        throw problems.businessRule(
          "kpi_definition.in_use",
          "Active T02 rows or baselines still use this KPI; archive or re-point them first.",
        );
      const updated = await tx
        .updateTable("kpi_definition")
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
        action: "kpi_definition.archive",
        recordType: "kpi_definition",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason,
        changes: diffFields(current, updated, [...KPI_DEFINITION_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toKpiDefinition(row));
  });
}
