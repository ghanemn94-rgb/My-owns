// T02 Outcome & KPI Tree rows (B0050, REQ-PB-034; OpenAPI tag "kpi"): outcome, KPI, baseline, target, target date,
// owner, leading indicator - all seven source columns persist. A row without a target date is refused with 422
// (targets are time-bound). Permission outcome.edit (TL, BO, KDS); reads transformation.read.
// Trajectory approval (kpi_target.approve, SP/BO; a business approval inside the product, never the row's creator).
// ANY later edit of an approved row returns its trajectory to draft (the approval fields are cleared and the audit
// diff keeps the prior approval), so a changed target never reads as approved.
import { diffFields, sql, type DbOrTx } from "@mth/db";
import { outcomeKpiCreate, outcomeKpiUpdate, reasonRequest, trajectoryApproval } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import {
  findOutcomeKpi,
  OUTCOME_KPI_AUDIT_FIELDS,
  referenceStatus,
  toOutcomeKpi,
  trajectoryPointsOf,
} from "./repository.ts";
import {
  leadingNotSelfRule,
  oneBaselineSourceRule,
  targetAfterBaselineRule,
  targetDateRule,
  trajectoryRule,
} from "./rules.ts";
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

const BASE = "/api/v1/transformations/:transformationId/outcome-kpis";
const ITEM = `${BASE}/:outcomeKpiId`;
const PERMISSION = "outcome.edit";

interface Resolved {
  outcomeId: string;
  kpiDefinitionId: string;
  baselineId: string | null;
  baselineValue: string | null;
  targetDate: string;
  leadingKpiDefinitionId: string | null;
  trajectoryPoints: { date: string; value: string }[];
}

/** Every reference must exist in the same transformation and not be archived; then the row-level rules. */
async function checkRow(db: DbOrTx, transformationId: string, r: Resolved, changed: ReadonlySet<string>) {
  const refs: [string, "outcome" | "kpi_definition" | "baseline", string | null][] = [
    ["outcomeId", "outcome", r.outcomeId],
    ["kpiDefinitionId", "kpi_definition", r.kpiDefinitionId],
    ["leadingKpiDefinitionId", "kpi_definition", r.leadingKpiDefinitionId],
    ["baselineId", "baseline", r.baselineId],
  ];
  let baselineDate: string | null = null;
  for (const [field, table, id] of refs) {
    if (id === null || !changed.has(field)) continue;
    const ref = await referenceStatus(db, table, transformationId, id);
    if (!ref || ref.status === "archived")
      throw referenceProblem(
        `/${field}`,
        `The referenced ${table.replace("_", " ")} does not exist here or is archived.`,
      );
  }
  if (r.baselineId !== null)
    baselineDate = (await referenceStatus(db, "baseline", transformationId, r.baselineId))?.baselineDate ?? null;
  check(oneBaselineSourceRule(r.baselineId, r.baselineValue));
  check(leadingNotSelfRule(r.kpiDefinitionId, r.leadingKpiDefinitionId));
  check(targetAfterBaselineRule(baselineDate, r.targetDate));
  check(trajectoryRule(r.trajectoryPoints, r.targetDate));
}

const ALL_FIELDS: ReadonlySet<string> = new Set([
  "outcomeId",
  "kpiDefinitionId",
  "leadingKpiDefinitionId",
  "baselineId",
]);

export function registerOutcomeKpiRoutes(app: FastifyInstance, { db }: ModuleDeps, add: RouteAdder): void {
  add(app, "GET", BASE, "transformation.read", async (request) => listPage(db, request, "outcome_kpi", toOutcomeKpi));

  add(app, "POST", BASE, PERMISSION, async (request, reply) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    return idempotentCreate(
      db,
      request,
      reply,
      `/api/v1/transformations/${transformationId}/outcome-kpis`,
      (tx) => writeScope(tx, request, transformationId, PERMISSION),
      async (tx, { transformation }) => {
        check(targetDateRule(request.body, "create"));
        const body = parseBody(outcomeKpiCreate, request.body);
        const resolved: Resolved = {
          outcomeId: body.outcomeId,
          kpiDefinitionId: body.kpiDefinitionId,
          baselineId: body.baselineId ?? null,
          baselineValue: body.baselineValue ?? null,
          targetDate: body.targetDate,
          leadingKpiDefinitionId: body.leadingKpiDefinitionId ?? null,
          trajectoryPoints: body.trajectoryPoints ?? [],
        };
        await checkRow(tx, transformationId, resolved, ALL_FIELDS);
        await requireActiveUsers(tx, transformation.organization_id, [["ownerUserId", body.ownerUserId]]);
        const id = uuidv7();
        const row = await tx
          .insertInto("outcome_kpi")
          .values({
            id,
            organization_id: transformation.organization_id,
            transformation_id: transformationId,
            outcome_id: resolved.outcomeId,
            kpi_definition_id: resolved.kpiDefinitionId,
            baseline_id: resolved.baselineId,
            baseline_value: resolved.baselineValue,
            target_value: body.targetValue ?? null,
            target_date: resolved.targetDate,
            owner_user_id: body.ownerUserId ?? null,
            leading_indicator_text: body.leadingIndicatorText ?? null,
            leading_kpi_definition_id: resolved.leadingKpiDefinitionId,
            ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
            trajectory_points: JSON.stringify(resolved.trajectoryPoints),
            created_by: principal.userId!,
            updated_by: principal.userId!,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, audit, {
          action: "outcome_kpi.create",
          recordType: "outcome_kpi",
          recordId: id,
          organizationId: row.organization_id,
          transformationId,
          newVersion: 1,
          changes: diffFields({} as typeof row, row, [...OUTCOME_KPI_AUDIT_FIELDS]),
        });
        return toOutcomeKpi(row);
      },
    );
  });

  add(app, "GET", ITEM, "transformation.read", async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "outcomeKpiId");
    await readScope(db, request, transformationId);
    const row = await findOutcomeKpi(db, transformationId, id);
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toOutcomeKpi(row));
  });

  add(app, "PATCH", ITEM, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "outcomeKpiId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      const { transformation } = await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      check(targetDateRule(request.body, "update"));
      const body = parseBody(outcomeKpiUpdate, request.body);
      const current = await findOutcomeKpi(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("outcome_kpi");
      const resolved: Resolved = {
        outcomeId: body.outcomeId ?? current.outcome_id,
        kpiDefinitionId: body.kpiDefinitionId ?? current.kpi_definition_id,
        baselineId: body.baselineId !== undefined ? body.baselineId : current.baseline_id,
        baselineValue: body.baselineValue !== undefined ? body.baselineValue : current.baseline_value,
        targetDate: body.targetDate ?? current.target_date,
        leadingKpiDefinitionId:
          body.leadingKpiDefinitionId !== undefined ? body.leadingKpiDefinitionId : current.leading_kpi_definition_id,
        trajectoryPoints: body.trajectoryPoints ?? trajectoryPointsOf(current.trajectory_points),
      };
      await checkRow(tx, transformationId, resolved, new Set(Object.keys(body)));
      await requireActiveUsers(tx, transformation.organization_id, [["ownerUserId", body.ownerUserId]]);
      const updated = await tx
        .updateTable("outcome_kpi")
        .set({
          ...(body.outcomeId !== undefined ? { outcome_id: body.outcomeId } : {}),
          ...(body.kpiDefinitionId !== undefined ? { kpi_definition_id: body.kpiDefinitionId } : {}),
          ...(body.baselineId !== undefined ? { baseline_id: body.baselineId } : {}),
          ...(body.baselineValue !== undefined ? { baseline_value: body.baselineValue } : {}),
          ...(body.targetValue !== undefined ? { target_value: body.targetValue } : {}),
          ...(body.targetDate !== undefined ? { target_date: body.targetDate } : {}),
          ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
          ...(body.leadingIndicatorText !== undefined ? { leading_indicator_text: body.leadingIndicatorText } : {}),
          ...(body.leadingKpiDefinitionId !== undefined
            ? { leading_kpi_definition_id: body.leadingKpiDefinitionId }
            : {}),
          ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
          ...(body.trajectoryPoints !== undefined ? { trajectory_points: JSON.stringify(body.trajectoryPoints) } : {}),
          // Any change returns an approved trajectory to draft: the approval covered the previous content.
          ...(current.trajectory_status === "approved"
            ? {
                trajectory_status: "draft",
                trajectory_approved_by: null,
                trajectory_approved_at: null,
                trajectory_approved_version: null,
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
        action: "outcome_kpi.update",
        recordType: "outcome_kpi",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(current, updated, [...OUTCOME_KPI_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toOutcomeKpi(row));
  });

  add(app, "POST", `${ITEM}/archive`, PERMISSION, async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "outcomeKpiId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, PERMISSION);
      const expected = requireIfMatch(request);
      const { reason } = parseBody(reasonRequest, request.body);
      const current = await findOutcomeKpi(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived")
        throw problems.businessRule("outcome_kpi.already_archived", "The T02 row is already archived.");
      const updated = await tx
        .updateTable("outcome_kpi")
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
        action: "outcome_kpi.archive",
        recordType: "outcome_kpi",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason,
        changes: diffFields(current, updated, [...OUTCOME_KPI_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toOutcomeKpi(row));
  });

  add(app, "POST", `${ITEM}/trajectory-approval`, "kpi_target.approve", async (request, reply) => {
    const { transformationId, id } = parseRecordParams(request.params, "outcomeKpiId");
    const principal = principalOf(request);
    const audit = auditContextOf(request);
    const row = await db.transaction().execute(async (tx) => {
      await writeScope(tx, request, transformationId, "kpi_target.approve");
      const expected = requireIfMatch(request);
      const { note } = parseBody(trajectoryApproval, request.body);
      const current = await findOutcomeKpi(tx, transformationId, id, true);
      if (!current) throw problems.notFound();
      if (current.created_by === principal.userId)
        throw creatorDenied(
          "kpi.creator_cannot_approve",
          "A target trajectory is never approved by the person who created the T02 row.",
          "kpi_target.approve",
          { recordType: "outcome_kpi", recordId: id, organizationId: current.organization_id, transformationId },
        );
      if (current.version !== expected) throw problems.versionConflict(current.version);
      if (current.status === "archived") throw archivedRecord("outcome_kpi");
      if (current.trajectory_status === "approved")
        throw problems.businessRule("outcome_kpi.already_approved", "This trajectory version is already approved.");
      if (current.target_value === null)
        throw problems.businessRule(
          "outcome_kpi.target_value_required",
          "A trajectory can be approved only with a target value (the target is Unknown).",
        );
      const updated = await tx
        .updateTable("outcome_kpi")
        .set({
          trajectory_status: "approved",
          trajectory_approved_by: principal.userId!,
          trajectory_approved_at: sql<Date>`now()`,
          trajectory_approved_version: current.version + 1,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
          updated_by: principal.userId!,
        })
        .where("id", "=", id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, audit, {
        action: "outcome_kpi.trajectory_approve",
        recordType: "outcome_kpi",
        recordId: id,
        organizationId: current.organization_id,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: note ?? null,
        changes: diffFields(current, updated, [...OUTCOME_KPI_AUDIT_FIELDS]),
      });
      return updated;
    });
    return sendVersioned(reply, 200, toOutcomeKpi(row));
  });
}
