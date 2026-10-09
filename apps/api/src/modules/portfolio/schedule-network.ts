// The initiative schedule network and the critical path (P4 slice E; ADR-0031 §8-§11; T-DG4-BE-E; REQ-S09-009):
//   GET   /transformations/{t}/schedule-network   the network on the canonical dependencies, durations in working days,
//                                                 the critical path by `cpm-fs/1` (transformation.read)
//   POST  /initiatives/{i}/schedule               record the initiative's planned duration (roadmap.edit; TL, WL, TO);
//                                                 409 initiative_schedule.exists
//   PATCH /initiatives/{i}/schedule               change it (roadmap.edit; If-Match); 404 when none is recorded
//
// Critical-path claims come from defined scheduling logic, not cosmetic highlighting (M0184): the computation is the
// pure `computeCriticalPath` of `@mth/shared/calc` (zero total float), run on every read over the current rows, so a
// changed duration or dependency is reflected on the next read ("Critical dependency slips -> recompute"). Nothing is
// stored. With ANY missing duration the response is `not_computable` and nothing is marked critical (REQ-S09-009 "with
// missing durations no critical path is claimed").
// Network (ADR-0031 §8): nodes are the transformation's initiatives that are not cancelled; edges are the non-archived
// canonical `dependency` rows (DG3 T08, read-only here) with both initiative endpoints inside the network, read as
// finish-to-start. Every mutation: the read gate (404 outside scope, so an ADM-only user gets 404), roadmap.edit
// re-checked at commit time (AUD 403), validation, If-Match (428/409; creates are version 1), one audit event in the
// same transaction, no remote I/O inside it (S-4). Nothing here is a business approval or touches DG0-DG7.
import { diffFields, sql, type DbOrTx, type InitiativeScheduleRow, type Tx } from "@mth/db";
import { computeCriticalPath, type ScheduleEdgeInput, type ScheduleNodeInput } from "@mth/shared/calc";
import {
  BUDGET_LINE_REFUSALS,
  initiativeScheduleCreate,
  initiativeScheduleUpdate,
  type InitiativeSchedule,
  type ScheduleNetwork,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type WriteRule } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { iso, parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";

export const SCHEDULE_NETWORK = "/api/v1/transformations/:transformationId/schedule-network";
export const INITIATIVE_SCHEDULE = "/api/v1/initiatives/:initiativeId/schedule";
const JSON_BODY = ["application/json"] as const;
const ROADMAP_EDIT: readonly WriteRule[] = [{ permission: "roadmap.edit" }];

const transformationParams = z.strictObject({ transformationId: z.uuid() });
const initiativeParams = z.strictObject({ initiativeId: z.uuid() });

// ------------------------------------------------------------------------------------------------ the network

/**
 * The schedule network of a transformation, computed now from the canonical rows (ADR-0031 §8). Shared with the
 * execution view (`onCriticalPath`, budget.ts).
 */
export async function loadScheduleNetwork(db: DbOrTx, transformationId: string): Promise<ScheduleNetwork> {
  const nodes = await db
    .selectFrom("initiative as i")
    .leftJoin("initiative_schedule as s", "s.initiative_id", "i.id")
    .select(["i.id", "i.code", "i.name", "s.duration_working_days"])
    .where("i.transformation_id", "=", transformationId)
    .where("i.status", "<>", "cancelled")
    .execute();
  const edges = await db
    .selectFrom("dependency")
    .select(["id", "code", "from_initiative_id", "to_initiative_id"])
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .where("from_initiative_id", "is not", null)
    .where("to_initiative_id", "is not", null)
    .execute();
  const result = computeCriticalPath(
    nodes.map(
      (n): ScheduleNodeInput => ({
        initiativeId: n.id,
        code: n.code,
        name: n.name,
        durationWorkingDays: n.duration_working_days ?? null,
      }),
    ),
    edges.map(
      (e): ScheduleEdgeInput => ({
        dependencyId: e.id,
        code: e.code,
        fromInitiativeId: e.from_initiative_id!,
        toInitiativeId: e.to_initiative_id!,
      }),
    ),
  );
  return {
    transformationId,
    algorithm: result.algorithm,
    status: result.status,
    reason: result.reason,
    projectDurationWorkingDays: result.projectDurationWorkingDays,
    missingDurations: result.missingDurations.map((m) => ({
      initiativeId: m.initiativeId,
      code: m.code,
      name: m.name,
    })),
    nodes: result.nodes.map((n) => ({ ...n })),
    edges: result.edges.map((e) => ({
      dependencyId: e.dependencyId,
      code: e.code,
      fromInitiativeId: e.fromInitiativeId,
      toInitiativeId: e.toInitiativeId,
      critical: e.critical,
    })),
    criticalPaths: result.criticalPaths.map((p) => [...p]),
    truncated: result.truncated,
  };
}

/** Whether the initiative is on a computed critical path: null when not computable (never claimed), false if absent. */
export function onCriticalPath(network: ScheduleNetwork, initiativeId: string): boolean | null {
  if (network.status !== "computed") return null;
  return network.nodes.find((n) => n.initiativeId === initiativeId)?.critical ?? false;
}

// ------------------------------------------------------------------------------------------------ durations

export const toInitiativeSchedule = (r: InitiativeScheduleRow): InitiativeSchedule => ({
  id: r.id,
  initiativeId: r.initiative_id,
  durationWorkingDays: r.duration_working_days,
  note: r.note,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

const SCHEDULE_AUDIT_FIELDS = [
  "initiative_id",
  "duration_working_days",
  "note",
] as const satisfies readonly (keyof InitiativeScheduleRow & string)[];

/** 409 initiative_schedule.exists (ADR-0031 §11). */
export const SCHEDULE_EXISTS = () =>
  problems.duplicate("initiative_schedule.exists", BUDGET_LINE_REFUSALS["initiative_schedule.exists"]);

/**
 * The write gate of an initiative-scoped mutation: the initiative (404 when unknown), the read gate on the request's
 * principal (404 outside scope; ADR-0006 non-disclosure, so an ADM-only user gets 404), then `rules` re-checked on the
 * grants reloaded inside the transaction (403; S-4 commit-time authorization).
 */
export async function openInitiativeWrite(
  tx: Tx,
  request: FastifyRequest,
  initiativeId: string,
  rules: readonly WriteRule[],
): Promise<WriteContext> {
  const ini = await tx
    .selectFrom("initiative")
    .select(["id", "transformation_id"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!ini) throw problems.notFound();
  await requireTransformationRead(tx, principalOf(request), ini.transformation_id);
  return openWrite(tx, request, ini.transformation_id, rules, null, { atCommit: true });
}

async function createSchedule(tx: Tx, request: FastifyRequest): Promise<InitiativeScheduleRow> {
  const { initiativeId } = parse(initiativeParams, request.params, "params");
  const ctx = await openInitiativeWrite(tx, request, initiativeId, ROADMAP_EDIT);
  const body = parseBody(initiativeScheduleCreate, request.body);
  const existing = await tx
    .selectFrom("initiative_schedule")
    .select("id")
    .where("initiative_id", "=", initiativeId)
    .executeTakeFirst();
  if (existing) throw SCHEDULE_EXISTS();
  const id = uuidv7();
  // A concurrent create reaches `initiative_schedule_initiative_key`, mapped to the same 409 (platform/db-errors.ts).
  const row = await tx
    .insertInto("initiative_schedule")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: initiativeId,
      duration_working_days: body.durationWorkingDays,
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "initiative_schedule.create",
    recordType: "initiative_schedule",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as InitiativeScheduleRow, row, [...SCHEDULE_AUDIT_FIELDS]),
  });
  return row;
}

async function updateSchedule(tx: Tx, request: FastifyRequest): Promise<InitiativeScheduleRow> {
  const { initiativeId } = parse(initiativeParams, request.params, "params");
  const ctx = await openInitiativeWrite(tx, request, initiativeId, ROADMAP_EDIT);
  const body = parseBody(initiativeScheduleUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("initiative_schedule")
    .selectAll()
    .where("initiative_id", "=", initiativeId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  const updated = await tx
    .updateTable("initiative_schedule")
    .set({
      ...(body.durationWorkingDays !== undefined ? { duration_working_days: body.durationWorkingDays } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "initiative_schedule.update",
    recordType: "initiative_schedule",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...SCHEDULE_AUDIT_FIELDS]),
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerScheduleNetworkRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: "roadmap.edit" as const }, consumes: JSON_BODY };

  app.get(SCHEDULE_NETWORK, { config: read }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return loadScheduleNetwork(db, transformationId);
  });

  app.post(INITIATIVE_SCHEDULE, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createSchedule(tx, request));
    return sendVersioned(reply, 201, toInitiativeSchedule(row), `/api/v1/initiatives/${row.initiative_id}/schedule`);
  });

  app.patch(INITIATIVE_SCHEDULE, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => updateSchedule(tx, request));
    return sendVersioned(reply, 200, toInitiativeSchedule(row));
  });

  return [`GET ${SCHEDULE_NETWORK}`, `POST ${INITIATIVE_SCHEDULE}`, `PATCH ${INITIATIVE_SCHEDULE}`];
}
