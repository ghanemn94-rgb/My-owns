// Administration > Retention: runs, dry runs, their per-record actions and the archived-record markers (P7 slice E;
// ADR-0067 §4-§6, §8; REQ-S16-024). Route file created as a stub by T-DG7-BE-A; filled by T-DG7-BE-G (p7-work-split
// §E.1):
//   GET  /admin/retention/runs                           listRetentionRuns            (retention.read)
//   POST /admin/retention/runs                           createRetentionRun           (retention.run; Idempotency-Key)
//   POST /admin/retention/dry-runs                       createRetentionDryRun        (retention.run; Idempotency-Key)
//   GET  /admin/retention/runs/:retentionRunId           getRetentionRun              (retention.read)
//   GET  /admin/retention/runs/:retentionRunId/actions   listRetentionRunActions      (retention.read)
//   GET  /admin/retention/archived                       listRetentionArchivedRecords (retention.read)
// A run is requested by a person (service.ts: the retentionRun lock, 422 retention.run_in_progress, audit
// retention_run.requested, the outbox event) and executed by the worker job retention.archive under its own service
// identity. No response contains row content: only table names and primary key values.
import { sql } from "@mth/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import {
  idempotencyKeySchema,
  iso,
  isoOrNull,
  keysetPage,
  pageQueryFields,
  parse,
  parseBody,
  parseQuery,
  problems,
  requestHash,
  sendVersioned,
  withIdempotency,
  type ModuleDeps,
  type SortKey,
} from "../../platform/index.ts";
import { requireRetentionRight } from "../classes/service.ts";
import type { P7RouteGuard } from "../guards.ts";
import {
  findRun,
  keyOf,
  presentRun,
  requestRun,
  retentionArchivedRecordPage,
  retentionRunActionPage,
  retentionRunCreate,
  retentionRunPage,
  type RetentionRunMode,
  type RetentionRunView,
} from "./service.ts";

/** The route guard of every retention-run operation (docs/api/openapi.yaml, tag `retention`; ADR-0067 §8). */
export const RETENTION_RUN_ROUTE_GUARDS = {
  listRetentionRuns: { method: "GET", path: "/api/v1/admin/retention/runs", permission: "retention.read" },
  createRetentionRun: { method: "POST", path: "/api/v1/admin/retention/runs", permission: "retention.run" },
  createRetentionDryRun: { method: "POST", path: "/api/v1/admin/retention/dry-runs", permission: "retention.run" },
  getRetentionRun: {
    method: "GET",
    path: "/api/v1/admin/retention/runs/:retentionRunId",
    permission: "retention.read",
  },
  listRetentionRunActions: {
    method: "GET",
    path: "/api/v1/admin/retention/runs/:retentionRunId/actions",
    permission: "retention.read",
  },
  listRetentionArchivedRecords: {
    method: "GET",
    path: "/api/v1/admin/retention/archived",
    permission: "retention.read",
  },
} as const satisfies Record<string, P7RouteGuard>;

const G = RETENTION_RUN_ROUTE_GUARDS;
const JSON_BODY = ["application/json"] as const;
const idempotencyHeader = z.object({ "idempotency-key": idempotencyKeySchema.optional() }).passthrough();
const idParams = z.strictObject({ retentionRunId: z.uuid() });
const listQuery = z.strictObject({ ...pageQueryFields });
const archivedQuery = z.strictObject({
  ...pageQueryFields,
  table: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .optional(),
  retentionRunId: z.uuid().optional(),
});
const noQuery = z.strictObject({});
/** Newest first, id as the tiebreak. */
const RUN_SORT: readonly SortKey[] = [
  { name: "created_at", type: "timestamptz", desc: true },
  { name: "id", type: "uuid", desc: true },
];
/** The action log in order. */
const ACTION_SORT: readonly SortKey[] = [
  { name: "occurred_at", type: "timestamptz", expr: sql`a.occurred_at` },
  { name: "id", type: "uuid", expr: sql`a.id` },
];
/** Newest first; a marker's identity is (table, key). */
const ARCHIVED_SORT: readonly SortKey[] = [
  { name: "archived_at", type: "timestamptz", desc: true, expr: sql`m.archived_at` },
  { name: "table_name", type: "text", desc: true, expr: sql`m.table_name` },
  { name: "record_key", type: "text", desc: true, expr: sql`m.record_key::text` },
];

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerRetentionRunRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const read = { access: { permission: "retention.read" as const } };
  const run = { access: { permission: "retention.run" as const }, consumes: JSON_BODY };

  app.get(G.listRetentionRuns.path, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireRetentionRight(deps.db, principalOf(request), "retention.read");
    const page = await keysetPage(deps.db.selectFrom("retention_run").selectAll(), RUN_SORT, query, {
      list: "retention-runs",
    });
    return retentionRunPage.parse({ items: page.items.map(presentRun), nextCursor: page.nextCursor });
  });

  const create =
    (mode: RetentionRunMode, path: string) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      parseQuery(noQuery, request.query);
      const key = parse(idempotencyHeader, request.headers, "header")["idempotency-key"];
      const principal = principalOf(request);
      // A replay answers from the idempotency record, so the right itself is decided first (403 for every role but
      // ADM_TECH, AUD and ADM_ACCESS included); the request re-checks it on reloaded grants inside its transaction.
      await requireRetentionRight(deps.db, principal, "retention.run");
      const body = parseBody(retentionRunCreate, request.body);
      const userId = principal.userId;
      const result = await deps.db.transaction().execute(async (tx) => {
        const exec = async () => ({ status: 202, body: presentRun(await requestRun(tx, request, mode, body.reason)) });
        return key === undefined || userId === null
          ? { ...(await exec()), replayed: false }
          : withIdempotency<RetentionRunView>(
              tx,
              { userId, key, requestHash: requestHash(request.method, path, request.body) },
              exec,
            );
      });
      if (result.replayed) {
        // The existing request, in its current state (it may have run since).
        const row = await findRun(deps.db, result.body.id);
        if (row === undefined) throw problems.notFound();
        return sendVersioned(reply, 200, presentRun(row));
      }
      return sendVersioned(reply, 202, result.body, `${G.listRetentionRuns.path}/${result.body.id}`);
    };
  app.post(G.createRetentionRun.path, { config: run }, create("run", G.createRetentionRun.path));
  app.post(G.createRetentionDryRun.path, { config: run }, create("dry_run", G.createRetentionDryRun.path));

  app.get(G.getRetentionRun.path, { config: read }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const { retentionRunId } = parse(idParams, request.params, "params");
    await requireRetentionRight(deps.db, principalOf(request), "retention.read");
    const row = await findRun(deps.db, retentionRunId);
    if (row === undefined) throw problems.notFound();
    return sendVersioned(reply, 200, presentRun(row));
  });

  app.get(G.listRetentionRunActions.path, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const { retentionRunId } = parse(idParams, request.params, "params");
    await requireRetentionRight(deps.db, principalOf(request), "retention.read");
    if ((await findRun(deps.db, retentionRunId)) === undefined) throw problems.notFound();
    const page = await keysetPage(
      deps.db
        .selectFrom("retention_run_action as a")
        .innerJoin("retention_class as c", "c.id", "a.retention_class_id")
        .select([
          "a.id",
          "a.retention_run_id",
          "c.code",
          "a.table_name",
          "a.record_key",
          "a.action",
          "a.period_days",
          "a.record_age_at",
          "a.occurred_at",
        ])
        .where("a.retention_run_id", "=", retentionRunId),
      ACTION_SORT,
      query,
      { list: "retention-run-actions", retentionRunId },
    );
    return retentionRunActionPage.parse({
      items: page.items.map((r) => ({
        id: r.id,
        retentionRunId: r.retention_run_id,
        retentionClassCode: r.code,
        tableName: r.table_name,
        recordKey: keyOf(r.record_key),
        action: r.action,
        periodDays: r.period_days,
        recordAgeAt: iso(r.record_age_at),
        occurredAt: iso(r.occurred_at),
      })),
      nextCursor: page.nextCursor,
    });
  });

  app.get(G.listRetentionArchivedRecords.path, { config: read }, async (request) => {
    const query = parseQuery(archivedQuery, request.query);
    await requireRetentionRight(deps.db, principalOf(request), "retention.read");
    let q = deps.db
      .selectFrom("retention_archived_record as m")
      .innerJoin("retention_class as c", "c.id", "m.retention_class_id")
      .select([
        "m.table_name",
        "m.record_key",
        "c.code",
        "m.retention_run_id",
        "m.archive_set_key",
        "m.record_age_at",
        "m.archived_at",
        "m.purged_at",
        "m.purge_run_id",
      ]);
    if (query.table !== undefined) q = q.where("m.table_name", "=", query.table);
    if (query.retentionRunId !== undefined) q = q.where("m.retention_run_id", "=", query.retentionRunId);
    const page = await keysetPage(q, ARCHIVED_SORT, query, {
      list: "retention-archived",
      table: query.table ?? null,
      retentionRunId: query.retentionRunId ?? null,
    });
    return retentionArchivedRecordPage.parse({
      items: page.items.map((r) => ({
        tableName: r.table_name,
        recordKey: keyOf(r.record_key),
        retentionClassCode: r.code,
        retentionRunId: r.retention_run_id,
        archiveSetKey: r.archive_set_key,
        recordAgeAt: iso(r.record_age_at),
        archivedAt: iso(r.archived_at),
        purgedAt: isoOrNull(r.purged_at),
        purgeRunId: r.purge_run_id,
      })),
      nextCursor: page.nextCursor,
    });
  });

  return Object.values(G).map((g) => `${g.method} ${g.path}`);
}
