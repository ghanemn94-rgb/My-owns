// Transformation records (OpenAPI tags "transformations", "audit"). Every mutation runs in ONE transaction that holds:
// the policy check, validation, the optimistic-concurrency check (If-Match; 428/409), the write, exactly one audit
// event, and (create only) the outbox event `transformation.created`. Archived records are read-only (422).
import { diffFields, sql, type TransformationRow, type Tx } from "@mth/db";
import { TRANSFORMATION_STATUS_TRANSITIONS, type TransformationStatus } from "@mth/shared";
import {
  reasonRequest,
  transformationCreate,
  transformationListQuery,
  transformationUpdate,
  uuid,
  type Transformation,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  grantCreatorTransformationRoles,
  principalOf,
  requireAction,
  requireRead,
  scopeFilter,
  targetFor,
} from "../access/index.ts";
import { listTransformationAudit, record } from "../audit/index.ts";
import { enqueueOutboxEvent } from "../jobs/index.ts";
import { findBusinessUnit, findOrganization } from "../organization/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  idempotencyKeySchema,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requestHash,
  requireIfMatch,
  sendVersioned,
  withIdempotency,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  activeUsersExist,
  findTransformation,
  nextTransformationCode,
  toTransformation,
  TRANSFORMATION_AUDIT_FIELDS,
  UPDATABLE_AUDIT_FIELDS,
} from "./repository.ts";

const idParams = z.strictObject({ transformationId: uuid });
const listQuery = z.strictObject({ ...transformationListQuery.shape, cursor: cursorSchema, limit: limitSchema });
const auditQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/**
 * Statuses that an ordinary status edit can NEVER set (F-DG1-001). Closure is terminal and is the outcome of the
 * product's G6 (Sustain) business approval with validated benefits and a sustainment owner (playbook B0014
 * "Benefits before closure"; M0092; REQ-S03-003, REQ-PB-009). Neither G6 nor the benefit register exists in P1, and an
 * API edit must never stand in for a business approval, so P1 refuses every client-driven close (422
 * invalid-transition) and the record keeps its prior state. The governed close lands with the G6 workflow (P2+/P4).
 * This is a PRODUCT gate (G6), unrelated to the engineering delivery gates DG0-DG7.
 */
export const GOVERNED_TARGET_STATUSES: ReadonlySet<TransformationStatus> = new Set<TransformationStatus>(["closed"]);

export function isAllowedTransition(from: TransformationStatus, to: TransformationStatus): boolean {
  if (from === to) return true;
  if (GOVERNED_TARGET_STATUSES.has(to)) return false;
  return TRANSFORMATION_STATUS_TRANSITIONS[from].includes(to);
}

const SORTS = {
  "updatedAt:desc": { col: "t.updated_at", dir: "desc" },
  "updatedAt:asc": { col: "t.updated_at", dir: "asc" },
  "name:asc": { col: "t.name", dir: "asc" },
  "name:desc": { col: "t.name", dir: "desc" },
  "code:asc": { col: "t.code", dir: "asc" },
  "code:desc": { col: "t.code", dir: "desc" },
} as const;

export function registerTransformationRoutes(app: FastifyInstance, { db }: ModuleDeps): void {
  // ---------------------------------------------------------------- list (scope-filtered in SQL)
  app.get("/api/v1/transformations", { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const principal = principalOf(request);
    const query = parseQuery(listQuery, request.query);
    const statuses =
      query.status === undefined ? undefined : Array.isArray(query.status) ? query.status : [query.status];
    const hash = filterHash({ ...query, status: statuses?.slice().sort() });
    const after = decodeCursor(query.cursor, hash, 2);
    const sort = SORTS[query.sort];
    const keyExpr =
      sort.col === "t.updated_at"
        ? sql<string>`to_char(t.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
        : sql<string>`${sql.ref(sort.col)}`;

    let q = db
      .selectFrom("transformation as t")
      .selectAll("t")
      .select(keyExpr.as("sort_key"))
      .where(
        scopeFilter(principal, "transformation.read", {
          level: "transformation",
          organizationId: sql.ref("t.organization_id"),
          businessUnitId: sql.ref("t.business_unit_id"),
          transformationId: sql.ref("t.id"),
        }),
      );
    if (query.organizationId) q = q.where("t.organization_id", "=", query.organizationId);
    if (query.businessUnitId) q = q.where("t.business_unit_id", "=", query.businessUnitId);
    if (statuses) q = q.where("t.status", "in", statuses);
    if (query.mode) q = q.where("t.mode", "=", query.mode);
    if (query.phase) q = q.where("t.current_phase", "=", query.phase);
    if (!query.includeArchived) q = q.where("t.archived_at", "is", null);
    if (query.q) {
      const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      q = q.where((eb) => eb.or([eb("t.code", "ilike", like), eb("t.name", "ilike", like)]));
    }
    if (after) {
      const op = sort.dir === "desc" ? sql.raw("<") : sql.raw(">");
      const value = sort.col === "t.updated_at" ? sql`${String(after[0])}::timestamptz` : sql`${String(after[0])}`;
      q = q.where(sql<boolean>`(${sql.ref(sort.col)}, t.id) ${op} (${value}, ${String(after[1])}::uuid)`);
    }
    const rows = await q
      .orderBy(sql.ref(sort.col), sort.dir)
      .orderBy("t.id", sort.dir)
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
    return { items: page.items.map(({ sort_key: _k, ...r }) => toTransformation(r)), nextCursor: page.nextCursor };
  });

  // ---------------------------------------------------------------- create (+ audit + outbox, optional Idempotency-Key)
  app.post(
    "/api/v1/transformations",
    { config: { access: { permission: "transformation.create" } } },
    async (request, reply) => {
      const principal = principalOf(request);
      const body = parseBody(transformationCreate, request.body);
      const rawKey = request.headers["idempotency-key"];
      const key = rawKey === undefined ? undefined : parse(idempotencyKeySchema, rawKey, "header");
      const audit = auditContextOf(request);

      const result = await db.transaction().execute(async (tx) => {
        const run = async (): Promise<{ status: number; body: Transformation }> => {
          const bu = await findBusinessUnit(tx, body.businessUnitId);
          if (!bu) throw problems.notFound();
          const target = await requireRead(
            tx,
            principal,
            "business_unit.read",
            await targetFor(tx, "business_unit", { organizationId: bu.organization_id, businessUnitId: bu.id }),
          );
          await requireAction(tx, principal, "transformation.create", target);
          if (bu.status !== "active")
            throw problems.businessRule(
              "transformation.business_unit_inactive",
              "An inactive business unit cannot receive new transformations.",
            );
          const org = await findOrganization(tx, bu.organization_id);
          if (!org) throw problems.notFound();
          const named = [body.sponsorUserId, body.leadUserId].filter((v): v is string => v !== undefined);
          if (!(await activeUsersExist(tx, named)))
            throw problems.businessRule(
              "transformation.user_invalid",
              "The sponsor and lead must be existing active users.",
            );

          const id = uuidv7();
          const code = body.code ?? (await nextTransformationCode(tx, org.id));
          const row = await tx
            .insertInto("transformation")
            .values({
              id,
              organization_id: org.id,
              business_unit_id: bu.id,
              code,
              name: body.name,
              description: body.description ?? null,
              mode: body.mode,
              entry_phase: body.entryPhase ?? null,
              standalone_deliverable_type: body.standaloneDeliverableType ?? null,
              // End-to-End starts in Diagnose; Modular enters at the selected phase (B0009, REQ-PB-003).
              current_phase: body.mode === "modular" ? body.entryPhase! : "diagnose",
              sponsor_user_id: body.sponsorUserId ?? null,
              lead_user_id: body.leadUserId ?? null,
              timezone: body.timezone ?? org.default_timezone,
              currency: body.currency ?? org.default_currency,
              created_by: principal.userId!,
              updated_by: principal.userId!,
            })
            .returningAll()
            .executeTakeFirstOrThrow()
            .catch((e: { code?: string; constraint?: string }) => {
              if (e.code === "23505" && e.constraint === "transformation_org_code_key") {
                throw problems.duplicate(
                  "duplicate.code",
                  "A transformation with this code already exists in the organization.",
                );
              }
              throw e;
            });
          await record(tx, audit, {
            action: "transformation.create",
            recordType: "transformation",
            recordId: id,
            organizationId: org.id,
            transformationId: id,
            newVersion: 1,
            changes: diffFields({} as Record<string, unknown>, row as unknown as Record<string, unknown>, [
              ...TRANSFORMATION_AUDIT_FIELDS,
            ]),
          });
          // F-DG1-106: a creator authorized only by a non-inheriting business-unit grant (TL) gets an explicit,
          // audited transformation-scope assignment, so create and the following read resolve the same scope.
          await grantCreatorTransformationRoles(
            tx,
            principal,
            audit,
            { transformationId: id, organizationId: org.id, code },
            target,
          );
          await enqueueOutboxEvent(tx, {
            organizationId: org.id,
            aggregateType: "transformation",
            aggregateId: id,
            eventType: "transformation.created",
            schemaVersion: 1,
            idempotencyKey: `transformation.created:${id}`,
            payload: {
              transformationId: id,
              organizationId: org.id,
              businessUnitId: bu.id,
              mode: row.mode,
              entryPhase: row.entry_phase,
              standaloneDeliverableType: row.standalone_deliverable_type,
              createdBy: principal.userId!,
              occurredAt: row.created_at.toISOString(),
            },
          });
          return { status: 201, body: toTransformation(row) };
        };
        if (key === undefined) return { ...(await run()), replayed: false };
        return withIdempotency(
          tx,
          { userId: principal.userId!, key, requestHash: requestHash("POST", "/api/v1/transformations", body) },
          run,
        );
      });
      if (result.replayed) {
        // The replay repeats the original response; it still counts as a policy-checked request for the guard.
        request.authz.decisions += 1;
        reply.header("Idempotent-Replayed", "true");
      }
      return sendVersioned(reply, result.status, result.body, `/api/v1/transformations/${result.body.id}`);
    },
  );

  // ---------------------------------------------------------------- read
  app.get(
    "/api/v1/transformations/:transformationId",
    { config: { access: { permission: "transformation.read" } } },
    async (request, reply) => {
      const { transformationId } = parse(idParams, request.params, "params");
      const principal = principalOf(request);
      await requireRead(db, principal, "transformation.read", { type: "transformation", id: transformationId });
      const row = await findTransformation(db, transformationId);
      if (!row) throw problems.notFound();
      return sendVersioned(reply, 200, toTransformation(row));
    },
  );

  // ---------------------------------------------------------------- update
  app.patch(
    "/api/v1/transformations/:transformationId",
    { config: { access: { permission: "transformation.update" } } },
    async (request, reply) => {
      const { transformationId } = parse(idParams, request.params, "params");
      const body = parseBody(transformationUpdate, request.body);
      const principal = principalOf(request);
      const audit = auditContextOf(request);
      const row = await db.transaction().execute(async (tx) => {
        const current = await lockForChange(tx, request, transformationId, "transformation.update");
        if (current.archived_at !== null)
          throw problems.businessRule("transformation.archived", "Archived transformations are read-only.");
        const from = current.status as TransformationStatus;
        if (body.status !== undefined && !isAllowedTransition(from, body.status)) {
          if (GOVERNED_TARGET_STATUSES.has(body.status))
            throw problems.invalidTransition(
              "A transformation cannot be closed by a status edit. Closure requires the G6 (Sustain) business " +
                "approval with validated benefits, which is not available in this release.",
            );
          throw problems.invalidTransition(`A transformation cannot move from ${from} to ${body.status}.`);
        }
        const named = [body.sponsorUserId, body.leadUserId].filter((v): v is string => typeof v === "string");
        if (!(await activeUsersExist(tx, named)))
          throw problems.businessRule(
            "transformation.user_invalid",
            "The sponsor and lead must be existing active users.",
          );
        const updated = await tx
          .updateTable("transformation")
          .set({
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.sponsorUserId !== undefined ? { sponsor_user_id: body.sponsorUserId } : {}),
            ...(body.leadUserId !== undefined ? { lead_user_id: body.leadUserId } : {}),
            ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
            ...(body.currency !== undefined ? { currency: body.currency } : {}),
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: principal.userId!,
          })
          .where("id", "=", transformationId)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, audit, {
          action: "transformation.update",
          recordType: "transformation",
          recordId: transformationId,
          organizationId: current.organization_id,
          transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          changes: diffFields(current, updated, [...UPDATABLE_AUDIT_FIELDS]),
        });
        return updated;
      });
      return sendVersioned(reply, 200, toTransformation(row));
    },
  );

  // ---------------------------------------------------------------- archive (never delete)
  app.post(
    "/api/v1/transformations/:transformationId/archive",
    { config: { access: { permission: "transformation.archive" } } },
    async (request, reply) => {
      const { transformationId } = parse(idParams, request.params, "params");
      const { reason } = parseBody(reasonRequest, request.body);
      const principal = principalOf(request);
      const audit = auditContextOf(request);
      const row = await db.transaction().execute(async (tx) => {
        const current = await lockForChange(tx, request, transformationId, "transformation.archive");
        if (current.archived_at !== null)
          throw problems.businessRule("transformation.already_archived", "The transformation is already archived.");
        const updated = await tx
          .updateTable("transformation")
          .set({
            archived_at: sql<Date>`now()`,
            archived_by: principal.userId!,
            archive_reason: reason,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: principal.userId!,
          })
          .where("id", "=", transformationId)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, audit, {
          action: "transformation.archive",
          recordType: "transformation",
          recordId: transformationId,
          organizationId: current.organization_id,
          transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          reason,
          changes: { archivedAt: { from: null, to: updated.archived_at?.toISOString() ?? null } },
        });
        return updated;
      });
      return sendVersioned(reply, 200, toTransformation(row));
    },
  );

  // ---------------------------------------------------------------- audit trail
  app.get(
    "/api/v1/transformations/:transformationId/audit",
    { config: { access: { permission: "audit.read" } } },
    async (request) => {
      const { transformationId } = parse(idParams, request.params, "params");
      const query = parseQuery(auditQuery, request.query);
      const principal = principalOf(request);
      const target = await requireRead(db, principal, "transformation.read", {
        type: "transformation",
        id: transformationId,
      });
      await requireAction(db, principal, "audit.read", target);
      return listTransformationAudit(db, transformationId, query);
    },
  );
}

/**
 * Shared prologue of every change: read gate (404), action gate (403), If-Match present (428), row lock,
 * version equal (409). Nothing is written, and no audit event is recorded, before all of these pass.
 */
async function lockForChange(
  tx: Tx,
  request: FastifyRequest,
  id: string,
  permission: "transformation.update" | "transformation.archive",
): Promise<TransformationRow> {
  const principal = principalOf(request);
  const target = await requireRead(tx, principal, "transformation.read", { type: "transformation", id });
  await requireAction(tx, principal, permission, target);
  const expected = requireIfMatch(request);
  const current = await findTransformation(tx, id, true);
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  return current;
}
