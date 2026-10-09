// Job schedules of the scheduled-job kit (OpenAPI tag "jobs"; ADR-0025 §3; REQ-S16-005; T-DG4-BE-A):
//   GET   /admin/job-schedules           the recurring jobs (job.read; ADM_TECH)
//   PATCH /admin/job-schedules/{jobCode}  enable, disable or reschedule (job.configure; ADM_TECH; If-Match).
//                                         422 job.cron_invalid, job.timezone_unknown
// Rows come only from migrations (mth_app has no INSERT on job_schedule). A change writes its audit event and the
// outbox event `job_schedule.updated` in the same transaction; the worker then re-registers the schedules with
// pg-boss (apps/worker/src/schedules.ts). A schedule only starts a job: no job ever decides a business approval.
//
// The table is platform-wide (one deployment), so the permission is required in the caller's organization, decided
// on grants reloaded inside the write transaction (commit-time authorisation, the dependency-types precedent).
import { sql, type Db, type JobScheduleRow, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { isFiveFieldCron, jobCode, jobScheduleUpdate, type JobSchedule } from "@mth/shared/schemas";
import { isKnownTimeZone } from "@mth/shared/time";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContextOf, denialOf, principalOf, refreshPrincipal, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
} from "../platform/index.ts";
import { enqueueOutboxEvent } from "./outbox.ts";

const JSON_BODY = ["application/json"] as const;
const BASE = "/api/v1/admin/job-schedules";

export const jobRefusals = {
  cronInvalid: () =>
    new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "job.cron_invalid",
      title: "Business rule violated",
      detail: "The schedule must be a cron expression with five fields.",
      errors: [
        {
          pointer: "/cron",
          code: "job.cron_invalid",
          message: "The schedule must be a cron expression with five fields.",
        },
      ],
    }),
  timezoneUnknown: (timezone: string) =>
    new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "job.timezone_unknown",
      title: "Business rule violated",
      detail: `The time zone ${timezone} is not a known time zone.`,
      errors: [
        {
          pointer: "/timezone",
          code: "job.timezone_unknown",
          message: `The time zone ${timezone} is not a known time zone.`,
        },
      ],
    }),
} as const;

export const toJobSchedule = (r: JobScheduleRow): JobSchedule => ({
  code: r.code,
  queueName: r.queue_name,
  cron: r.cron,
  timezone: r.timezone,
  enabled: r.enabled,
  descriptionEn: r.description_en,
  descriptionAr: r.description_ar,
  ownerModule: r.owner_module,
  version: r.version,
  updatedAt: iso(r.updated_at),
});

/** `permission` in the caller's organization, else 403 with the denial attached for the failed-mutation audit. */
function requireInOwnOrganization(
  principal: Principal,
  permission: Permission,
): { userId: string; organizationId: string } {
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  const allowed =
    org !== null && principal.grants.some((g) => g.permissions.has(permission) && g.organizationId === org);
  if (!allowed || org === null || principal.userId === null) {
    const denied = problems.forbidden();
    throw org === null
      ? denied
      : denied.withDenial(
          denialOf(permission, {
            level: "organization",
            organizationId: org,
            businessUnitId: null,
            transformationId: null,
            businessUnitAncestry: [],
          }),
        );
  }
  return { userId: principal.userId, organizationId: org };
}

const AUDIT_FIELDS = ["cron", "timezone", "enabled"] as const;

async function updateSchedule(tx: Tx, request: FastifyRequest, code: string): Promise<JobScheduleRow> {
  principalOf(request);
  const actor = requireInOwnOrganization(await refreshPrincipal(tx, request), "job.configure");
  const body = parseBody(jobScheduleUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("job_schedule")
    .selectAll()
    .where("code", "=", code)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (body.cron !== undefined && !isFiveFieldCron(body.cron)) throw jobRefusals.cronInvalid();
  if (body.timezone !== undefined && !isKnownTimeZone(body.timezone)) throw jobRefusals.timezoneUnknown(body.timezone);
  const updated = await tx
    .updateTable("job_schedule")
    .set({
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.cron !== undefined ? { cron: body.cron } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const changes = new Map<string, { from: unknown; to: unknown }>();
  for (const f of AUDIT_FIELDS) {
    const from = new Map(Object.entries(current)).get(f);
    const to = new Map(Object.entries(updated)).get(f);
    if (from !== to) changes.set(f, { from, to });
  }
  await record(tx, auditContextOf(request), {
    action: "job_schedule.update",
    recordType: "job_schedule",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: changes.size > 0 ? Object.fromEntries(changes) : null,
  });
  await enqueueOutboxEvent(tx, {
    organizationId: actor.organizationId,
    aggregateType: "job_schedule",
    aggregateId: current.id,
    eventType: "job_schedule.updated",
    schemaVersion: 1,
    payload: {
      jobScheduleId: current.id,
      code: updated.code,
      queueName: updated.queue_name,
      cron: updated.cron,
      timezone: updated.timezone,
      enabled: updated.enabled,
      version: updated.version,
      updatedBy: actor.userId,
      occurredAt: iso(updated.updated_at),
    },
    idempotencyKey: `job_schedule.updated:${current.id}:${updated.version}`,
  });
  return updated;
}

const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const codeParams = z.strictObject({ jobCode });

export function registerJobScheduleRoutes(app: FastifyInstance, db: Db): string[] {
  app.get(BASE, { config: { access: { permission: "job.read" } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    requireInOwnOrganization(principalOf(request), "job.read");
    const hash = filterHash({});
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("job_schedule").selectAll();
    if (after) q = q.where("code", ">", String(after[0]));
    const rows = await q
      .orderBy("code")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.code], hash);
    return { items: page.items.map(toJobSchedule), nextCursor: page.nextCursor };
  });

  app.patch(
    `${BASE}/:jobCode`,
    { config: { access: { permission: "job.configure" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { jobCode: code } = parse(codeParams, request.params, "params");
      const row = await db.transaction().execute((tx) => updateSchedule(tx, request, code));
      return sendVersioned(reply, 200, toJobSchedule(row));
    },
  );

  return [`GET ${BASE}`, `PATCH ${BASE}/:jobCode`];
}
