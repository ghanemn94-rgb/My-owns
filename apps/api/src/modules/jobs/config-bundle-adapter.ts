// Configuration transfer adapter of job schedules (P7 slice D; ADR-0065 §1, §6; p7-plan §3 seam 4; T-DG7-BE-F).
//
// Content { cron, timezone }, keyed by job_schedule.code. `enabled` is NEVER transferred: an import always applies a
// schedule DISABLED, so an import never starts a job (p7-work-split §D.7). Schedules are seeded by migrations, so a code
// that does not exist in the target is `refused` (config_bundle.kind_unavailable): updateJobSchedule never creates one.
// Applied on commit like updateJobSchedule: job.configure in the caller's organization, the cron and time-zone rules,
// version + 1, audit job_schedule.update and the job_schedule.updated outbox event (no remote I/O in the transaction).
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { isFiveFieldCron } from "@mth/shared/schemas";
import { isKnownTimeZone } from "@mth/shared/time";
import { jobScheduleContent } from "@mth/shared/transfer";
import type { ConfigBundleKindAdapterPort, PlannedBundleItem, WrittenBundleRecord } from "@mth/shared/transfer";
import type { FastifyRequest } from "fastify";
import { auditContextOf, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { iso, problems } from "../platform/index.ts";
import { enqueueOutboxEvent } from "./outbox.ts";

// The ConfigBundleKindAdapter port with the API's types (@mth/shared/transfer; this module never imports transfer).
type ConfigBundleKindAdapter = ConfigBundleKindAdapterPort<DbOrTx, Tx, FastifyRequest, Principal>;
type PlannedItem = PlannedBundleItem;
type WrittenRecord = WrittenBundleRecord;

const content = jobScheduleContent.refine((c) => isFiveFieldCron(c.cron) && isKnownTimeZone(c.timezone), {
  message: "cron must have five fields and the time zone must be known",
});

export const jobScheduleBundleAdapter: ConfigBundleKindAdapter = {
  kind: "job_schedule",
  contentSchema: content,
  permitted: async (_db, principal, organizationId) =>
    principal.organizationId === organizationId &&
    principal.userId !== null &&
    principal.grants.some((g) => g.permissions.has("job.configure") && g.organizationId === organizationId),
  async exportPublished(db) {
    const rows = await db.selectFrom("job_schedule").selectAll().orderBy("code").execute();
    return rows.map((r) => ({
      itemCode: r.code,
      sourceVersionNo: r.version,
      content: { cron: r.cron, timezone: r.timezone },
    }));
  },
  async plan(db, _organizationId, item): Promise<PlannedItem> {
    const c = content.parse(item.content);
    const row = await db.selectFrom("job_schedule").selectAll().where("code", "=", item.itemCode).executeTakeFirst();
    if (row === undefined) return { action: "refused", problemCode: "config_bundle.kind_unavailable" };
    // Identical only when nothing would change, enabled included (an import leaves every schedule disabled).
    const same = row.cron === c.cron && row.timezone === c.timezone && !row.enabled;
    return { action: same ? "identical" : "new_draft" };
  },
  async write(ctx, item): Promise<WrittenRecord> {
    const { tx, request, userId, principal } = ctx;
    const org = principal.organizationId;
    if (org === null || !principal.grants.some((g) => g.permissions.has("job.configure") && g.organizationId === org))
      throw problems.forbidden();
    const c = content.parse(item.content);
    const current = await tx
      .selectFrom("job_schedule")
      .selectAll()
      .where("code", "=", item.itemCode)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const updated = await tx
      .updateTable("job_schedule")
      .set({
        cron: c.cron,
        timezone: c.timezone,
        enabled: false,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: userId,
      })
      .where("id", "=", current.id)
      .where("version", "=", current.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    const changes = new Map<string, { from: unknown; to: unknown }>();
    if (current.cron !== updated.cron) changes.set("cron", { from: current.cron, to: updated.cron });
    if (current.timezone !== updated.timezone)
      changes.set("timezone", { from: current.timezone, to: updated.timezone });
    if (current.enabled !== updated.enabled) changes.set("enabled", { from: current.enabled, to: updated.enabled });
    await record(tx, auditContextOf(request), {
      action: "job_schedule.update",
      recordType: "job_schedule",
      recordId: current.id,
      organizationId: org,
      priorVersion: current.version,
      newVersion: updated.version,
      reason: `Configuration bundle import ${ctx.importId}`,
      changes: changes.size > 0 ? Object.fromEntries(changes) : null,
    });
    await enqueueOutboxEvent(tx, {
      organizationId: org,
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
        updatedBy: userId,
        occurredAt: iso(updated.updated_at),
      },
      idempotencyKey: `job_schedule.updated:${current.id}:${updated.version}`,
    });
    return { targetRecordType: "job_schedule", targetRecordId: current.id };
  },
};
