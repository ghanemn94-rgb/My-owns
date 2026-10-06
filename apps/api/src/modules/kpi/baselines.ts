// Baseline registry (REQ-PB-027; OpenAPI tag "kpi"): measurable baseline - metric, value, unit, source, baseline
// date. A missing value is Unknown (null), never zero. Permission baseline.edit (TL, KDS); reads transformation.read.
// Finance validation (finance.validate, FIN; never the record's creator) records the decision on the version that
// results from it (validatedRecordVersion); any later edit makes the validation STALE (ADR-0019 §3), so an edited
// figure never reads as validated until Finance decides again.
import { diffFields, sql } from "@mth/db";
import { baselineCreate, baselineUpdate, hasText, reasonRequest, validationDecision } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { BASELINE_AUDIT_FIELDS, findBaseline, referenceStatus, toBaseline } from "./repository.ts";
import { baselineDateRule, baselineMeasurableRule, todayIn } from "./rules.ts";
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

const BASE = "/api/v1/transformations/:transformationId/baselines";
const ITEM = `${BASE}/:baselineId`;
const PERMISSION = "baseline.edit";

async function requireKpiDefinition(db: DbOrTx, transformationId: string, id: string | null | undefined) {
  if (typeof id !== "string") return;
  const ref = await referenceStatus(db, "kpi_definition", transformationId, id);
  if (!ref || ref.status === "archived")
    throw referenceProblem(
      "/kpiDefinitionId",
      "The KPI definition does not exist in this transformation or is archived.",
    );
}

export function registerBaselineRoutes(app: FastifyInstance, { db }: ModuleDeps, add: RouteAdder): void {
  add(app, "GET", BASE, "transformation.read", async (request) => listPage(db, request, "baseline", toBaseline));

  add(app, "POST", BASE, PERMISSION, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    return idempotentCreate(
      db,
      request,
      reply,
      `/api/v1/transformations/${transformationId}/baselines`,
      (tx) => writeScope(tx, request, transformationId, PERMISSION),
      async (tx, { transformation }) => {
        const body = parseBody(baselineCreate, request.body);
        check(baselineDateRule(body.baselineDate ?? null, todayIn(transformation.timezone)));
        await requireKpiDefinition(tx, transformationId, body.kpiDefinitionId);
        await requireActiveUsers(tx, transformation.organization_id, [["ownerUserId", body.ownerUserId]]);
        const id = uuidv7();
        const row = await tx
          .insertInto("baseline")
          .values({
            id,
            organization_id: transformation.organization_id,
            transformation_id: transformationId,
            metric: body.metric,
            kpi_definition_id: body.kpiDefinitionId ?? null,
            value: body.value ?? null,
            unit: body.unit,
            currency: body.currency ?? null,
            source: body.source ?? null,
            baseline_date: body.baselineDate ?? null,
            scope: body.scope,
            owner_user_id: body.ownerUserId ?? null,
            created_by: principal.userId!,
            updated_by: principal.userId!,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, audit, {
          action: "baseline.create",
          recordType: "baseline",
          recordId: id,
          organizationId: row.organization_id,
          transformationId,
          newVersion: 1,
          changes: diffFields({} as typeof row, row, [...BASELINE_AUDIT_FIELDS]),
        });
        return toBaseline(row);
      },
    );
  });

  add(app, "GET", ITEM, "transformation.read", async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "baselineId");
    await readScope(db, request, transformationId);
    const row = await findBaseline(db, transformationId, id);
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toBaseline(row));
  });

  add(app, "PATCH", ITEM, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "baselineId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      const { transformation } = await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const body = parseBody(baselineUpdate, request.body);
      const current = await findBaseline(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("baseline");
      if (body.baselineDate !== undefined) check(baselineDateRule(body.baselineDate, todayIn(transformation.timezone)));
      await requireKpiDefinition(tx, transformationId, body.kpiDefinitionId);
      await requireActiveUsers(tx, transformation.organization_id, [["ownerUserId", body.ownerUserId]]);
      // Corrections: the record keeps its id; the audit event stores every changed field's prior and new value, and
      // a validation on an earlier version becomes stale (validatedRecordVersion < version).
      const updated = await tx
        .updateTable("baseline")
        .set({
          ...(body.metric !== undefined ? { metric: body.metric } : {}),
          ...(body.kpiDefinitionId !== undefined ? { kpi_definition_id: body.kpiDefinitionId } : {}),
          ...(body.value !== undefined ? { value: body.value } : {}),
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          ...(body.currency !== undefined ? { currency: body.currency } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
          ...(body.baselineDate !== undefined ? { baseline_date: body.baselineDate } : {}),
          ...(body.scope !== undefined ? { scope: body.scope } : {}),
          ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
          ...validationResetIfUnmeasurable(current, body),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId!,
        })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "baseline.update",
        recordType: "baseline",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(current, updated, [...BASELINE_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toBaseline(row));
  });

  add(app, "POST", `${ITEM}/archive`, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "baselineId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const { reason } = parseBody(reasonRequest, request.body);
      const current = await findBaseline(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived")
        throw problems.businessRule("baseline.already_archived", "The baseline is already archived.");
      const updated = await tx
        .updateTable("baseline")
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
        action: "baseline.archive",
        recordType: "baseline",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason,
        changes: diffFields(current, updated, [...BASELINE_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toBaseline(row));
  });

  add(app, "POST", `${ITEM}/validation`, "finance.validate", async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "baselineId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, "finance.validate");
      const expected = requireIfMatch(request);
      const decision = parseBody(validationDecision, request.body);
      const current = await findBaseline(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.created_by === principal.userId)
        throw creatorDenied(
          "kpi.creator_cannot_validate",
          "Finance validation is never done by the person who created the baseline.",
          "finance.validate",
          {
            recordType: "baseline",
            recordId: id,
            organizationId: current.organization_id,
            transformationId,
          },
        );
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("baseline");
      if (decision.result === "validated")
        check(
          baselineMeasurableRule({
            value: current.value,
            source: current.source,
            baselineDate: current.baseline_date,
          }),
        );
      const updated = await tx
        .updateTable("baseline")
        .set({
          validation_status: decision.result,
          validated_by: principal.userId!,
          validated_at: sql<Date>`now()`,
          validation_note: decision.note,
          // The decision covers the content of the version it creates (same content, version + 1).
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
        action: decision.result === "validated" ? "baseline.validate" : "baseline.reject",
        recordType: "baseline",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: decision.note,
        changes: diffFields(current, updated, [...BASELINE_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toBaseline(row));
  });
}

/**
 * CHECK baseline_validated_measurable: a validated baseline keeps value, source and date. An edit that clears one of
 * them withdraws the validation (unvalidated; the audit diff keeps the prior decision) instead of failing.
 */
function validationResetIfUnmeasurable(
  current: { validation_status: string; value: string | null; source: string | null; baseline_date: string | null },
  body: {
    value?: string | null | undefined;
    source?: string | null | undefined;
    baselineDate?: string | null | undefined;
  },
) {
  if (current.validation_status !== "validated") return {};
  const value = body.value !== undefined ? body.value : current.value;
  const source = body.source !== undefined ? body.source : current.source;
  const date = body.baselineDate !== undefined ? body.baselineDate : current.baseline_date;
  if (value !== null && hasText(source) && date !== null) return {};
  return {
    validation_status: "unvalidated",
    validated_by: null,
    validated_at: null,
    validation_note: null,
    validated_record_version: null,
  };
}
