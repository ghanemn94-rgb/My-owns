// KPI dictionary entries (P2 subset of REQ-S07-001; OpenAPI tag "kpi"): list, create, read, update, activate,
// archive. Activate (F-DG2-201) is the only draft -> active path; G2's g2.kpi_definitions criterion needs it.
// Permission kpi_definition.edit (TL, KDS); reads need transformation.read.
import { diffFields, sql, type Tx } from "@mth/db";
import { kpiDefinitionCreate, kpiDefinitionUpdate, reasonRequest } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import {
  findKpiDefinition,
  KPI_DEFINITION_AUDIT_FIELDS,
  kpiDefinitionInUse,
  toKpiDefinition,
  type KpiDefinitionRow,
} from "./repository.ts";
import { kpiDefinitionActivationRule, kpiDefinitionUnitRule } from "./rules.ts";
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

/** The columns a new KPI definition takes (the createKpiDefinition body, already validated, plus its scope). */
export interface KpiDefinitionRowInput {
  readonly organizationId: string;
  readonly transformationId: string;
  /** The acting user: created_by and updated_by. */
  readonly actorUserId: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly businessPurpose?: string | null | undefined;
  readonly unitKind: KpiDefinitionRow["unit_kind"];
  readonly unitLabel?: string | null | undefined;
  readonly currency?: string | null | undefined;
  readonly polarity: KpiDefinitionRow["polarity"];
  /** Omitted: the column default (monthly). */
  readonly frequency?: KpiDefinitionRow["frequency"] | undefined;
  /** Omitted: the column default (false). */
  readonly isLeading?: boolean | undefined;
  readonly dataSource?: string | null | undefined;
  readonly ownerUserId?: string | null | undefined;
  readonly stewardUserId?: string | null | undefined;
}

/**
 * Slice A's KPI create service (T-DG4-KBE-R1; the KBE-F handback item 2): inserts one draft `kpi_definition` row
 * (version 1) and its `kpi_definition.create` audit event in the caller's transaction, and returns the row. A name
 * already taken in the transformation is 409 `duplicate.name`. The caller has already authorized the write, validated
 * the input (including the unit rule and the active owner and steward) and holds the transaction; createKpiDefinition
 * and adoption's createAdoptionMetricLink (createKpi) both call it, so the row and the audit event are one shape.
 */
export async function createKpiDefinitionRow(
  tx: Tx,
  audit: AuditContext,
  input: KpiDefinitionRowInput,
): Promise<KpiDefinitionRow> {
  const id = uuidv7();
  const row = await tx
    .insertInto("kpi_definition")
    .values({
      id,
      organization_id: input.organizationId,
      transformation_id: input.transformationId,
      name: input.name,
      description: input.description ?? null,
      business_purpose: input.businessPurpose ?? null,
      unit_kind: input.unitKind,
      unit_label: input.unitLabel ?? null,
      currency: input.currency ?? null,
      polarity: input.polarity,
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.isLeading !== undefined ? { is_leading: input.isLeading } : {}),
      data_source: input.dataSource ?? null,
      owner_user_id: input.ownerUserId ?? null,
      steward_user_id: input.stewardUserId ?? null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
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
    transformationId: input.transformationId,
    newVersion: 1,
    changes: diffFields({} as typeof row, row, [...KPI_DEFINITION_AUDIT_FIELDS]),
  });
  return row;
}

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
        const row = await createKpiDefinitionRow(tx, audit, {
          organizationId: transformation.organization_id,
          transformationId,
          actorUserId: principal.userId!,
          name: body.name,
          description: body.description,
          businessPurpose: body.businessPurpose,
          unitKind: body.unitKind,
          unitLabel: body.unitLabel,
          currency: body.currency,
          polarity: body.polarity,
          frequency: body.frequency,
          isLeading: body.isLeading,
          dataSource: body.dataSource,
          ownerUserId: body.ownerUserId,
          stewardUserId: body.stewardUserId,
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

  add(app, "POST", `${ITEM}/activate`, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "kpiDefinitionId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const current = await findKpiDefinition(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("kpi_definition");
      check(
        kpiDefinitionActivationRule({
          status: current.status,
          unitKind: current.unit_kind,
          unitLabel: current.unit_label,
          currency: current.currency,
          polarity: current.polarity,
        }),
      );
      const updated = await tx
        .updateTable("kpi_definition")
        .set({
          status: "active",
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId!,
        })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .where("status", "=", "draft")
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "kpi_definition.activate",
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
