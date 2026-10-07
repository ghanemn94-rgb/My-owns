// Initiatives (T05 Initiative Card, B0072; ADR-0021 §2; REQ-PB-045, REQ-S16-016; T-DG3-BE-B):
//   GET   /api/v1/initiatives?transformationId=&status=&waveId=     list, newest change first (transformation.read)
//   POST  /api/v1/initiatives                                       create a draft (initiative.edit); INI-nn generated
//   GET   /api/v1/initiatives/{initiativeId}                        one initiative with warnings and the funding label
//   PATCH /api/v1/initiatives/{initiativeId}                        update T05 fields, wave, planned dates (If-Match)
//
// Drafting is allowed at any time, including before G1 (B0009, ADR-0021 §3). The status changes only through the
// transition actions (transitions.ts, selections.ts). Archive, never delete: there is no DELETE; a cancelled (or
// completed) initiative is read-only. Warnings (deliverable count outside 3-7, no gap link, no executive owner) are
// hints, never rejections. Every mutation: authorization re-checked at commit (BE18A), validation, If-Match (creates are
// version 1) and one audit event; no client or remote I/O inside the transaction.
import { diffFields, type InitiativeRow } from "@mth/db";
import { initiativeCreate, initiativeStatus, initiativeUpdate } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  assertActiveUsers,
  assertSameTransformation,
  bumpStamps,
  maybeIdempotent,
  openWrite,
  pick,
  sendCreated,
  type WriteContext,
} from "../transformations/index.ts";
import {
  assertEditable,
  assertPlannedRange,
  dateText,
  lockInitiativeForWrite,
  loadInitiative,
  nextInitiativeCode,
  presentInitiative,
  presentInitiatives,
  readableInitiative,
} from "./repository.ts";

const BASE = "/api/v1/initiatives";
const idParams = z.strictObject({ initiativeId: z.uuid() });
const JSON_BODY = ["application/json"] as const;
const EDIT = [{ permission: "initiative.edit" as const }];

/** The T05 columns (body field -> column) and the audited columns. */
const FIELD_COLUMNS = [
  ["name", "name"],
  ["executiveOwnerUserId", "executive_owner_user_id"],
  ["workstreamLeadUserId", "workstream_lead_user_id"],
  ["problemStatement", "problem_statement"],
  ["objective", "objective"],
  ["scopeIn", "scope_in"],
  ["scopeOut", "scope_out"],
  ["financialBenefitSummary", "financial_benefit_summary"],
  ["customerBenefitSummary", "customer_benefit_summary"],
  ["risksSummary", "risks_summary"],
  ["waveId", "wave_id"],
  ["plannedStart", "planned_start"],
  ["plannedEnd", "planned_end"],
] as const;
export const INITIATIVE_AUDIT_FIELDS = [...FIELD_COLUMNS.map(([, c]) => c), "status", "code"] as const;

/** The audit diff of a create: every set column as `{ from: null, to }` (the AuditEvent `changes` shape). */
export function createChanges(row: InitiativeRow): Record<string, { from: null; to: unknown }> {
  const values = new Map<string, unknown>(Object.entries(row));
  const out: [string, { from: null; to: unknown }][] = [];
  for (const field of INITIATIVE_AUDIT_FIELDS) {
    const v = values.get(field);
    if (v === null || v === undefined) continue;
    out.push([field, { from: null, to: v instanceof Date ? v.toISOString() : v }]);
  }
  return Object.fromEntries(out);
}

const listQuery = z.strictObject({
  transformationId: z.uuid(),
  status: initiativeStatus.optional(),
  waveId: z.uuid().optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

/** Named people and the wave must be valid references in the transformation (422 with pointers). */
async function checkReferences(
  ctx: WriteContext,
  values: { executive_owner_user_id?: unknown; workstream_lead_user_id?: unknown; wave_id?: unknown },
): Promise<void> {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  await assertActiveUsers(ctx.tx, ctx.organizationId, [
    { id: str(values.executive_owner_user_id), pointer: "/executiveOwnerUserId" },
    { id: str(values.workstream_lead_user_id), pointer: "/workstreamLeadUserId" },
  ]);
  await assertSameTransformation(ctx.tx, "roadmap_wave", ctx.transformationId, values.wave_id, "/waveId");
}

export function registerInitiativeRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: "initiative.edit" as const }, consumes: JSON_BODY };

  app.get(BASE, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({ transformationId: query.transformationId, status: query.status, waveId: query.waveId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("initiative").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.status) q = q.where("status", "=", query.status);
    if (query.waveId) q = q.where("wave_id", "=", query.waveId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("updated_at", "<", new Date(String(after[0]))),
          eb.and([eb("updated_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("updated_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.updated_at.toISOString(), r.id], hash);
    return { items: await presentInitiatives(db, page.items), nextCursor: page.nextCursor };
  });

  app.post(BASE, { config: edit }, async (request, reply) => {
    // The transformation comes from the body; read it leniently first so authorization precedes validation (a read-only
    // auditor gets 403 for any body naming a transformation it can read).
    const raw = (request.body ?? {}) as { transformationId?: unknown };
    const transformationId = parse(z.uuid(), raw.transformationId, "body");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, EDIT, null, { atCommit: true });
      const body = parseBody(initiativeCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        const fields = pick(body, FIELD_COLUMNS);
        assertPlannedRange(body.plannedStart, body.plannedEnd);
        await checkReferences(ctx, fields);
        const id = uuidv7();
        const code = await nextInitiativeCode(tx, transformationId);
        const row = await tx
          .insertInto("initiative")
          .values({
            ...fields,
            name: body.name,
            id,
            organization_id: ctx.organizationId,
            transformation_id: transformationId,
            code,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx.audit, {
          action: "initiative.create",
          recordType: "initiative",
          recordId: id,
          organizationId: ctx.organizationId,
          transformationId,
          newVersion: 1,
          changes: createChanges(row),
        });
        return { status: 201, body: await presentInitiative(tx, row) };
      });
    });
    return sendCreated(request, reply, result, BASE);
  });

  app.get(`${BASE}/:initiativeId`, { config: read }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const { row } = await readableInitiative(db, request, initiativeId);
    return sendVersioned(reply, 200, await presentInitiative(db, row));
  });

  app.patch(`${BASE}/:initiativeId`, { config: edit }, async (request, reply) => {
    const { initiativeId } = parse(idParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      const { row: seen } = await readableInitiative(tx, request, initiativeId);
      const ctx = await openWrite(tx, request, seen.transformation_id, EDIT, null, { atCommit: true });
      const update = parseBody(initiativeUpdate, request.body);
      const current = await lockInitiativeForWrite(tx, request, initiativeId);
      assertEditable(current);
      const changes = pick(update, FIELD_COLUMNS);
      const start =
        "planned_start" in changes ? (changes["planned_start"] as string | null) : dateText(current.planned_start);
      const end = "planned_end" in changes ? (changes["planned_end"] as string | null) : dateText(current.planned_end);
      assertPlannedRange(start, end);
      await checkReferences(ctx, changes);
      const updated = await tx
        .updateTable("initiative")
        .set({ ...changes, ...bumpStamps(ctx.userId) })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "initiative.update",
        recordType: "initiative",
        recordId: current.id,
        organizationId: ctx.organizationId,
        transformationId: ctx.transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        changes: diffFields(current, updated, [...INITIATIVE_AUDIT_FIELDS]),
      });
      return loadInitiative(tx, initiativeId);
    });
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${BASE}`, `POST ${BASE}`, `GET ${BASE}/:initiativeId`, `PATCH ${BASE}/:initiativeId`];
}
