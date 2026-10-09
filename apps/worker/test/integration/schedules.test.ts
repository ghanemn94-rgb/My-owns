// Schedule registration of the scheduled-job kit (ADR-0025 §3; REQ-S16-005; T-DG4-BE-A) against a real PostgreSQL:
//  - at start the worker registers every ENABLED job_schedule row whose queue has a handler, in the row's timezone;
//  - a row whose domain has no handler yet is reported `unhandled` and not scheduled (no job without a consumer);
//  - after a change (disable, reschedule) the job_schedule.updated consumer re-registers: disabled rows are
//    unscheduled, rescheduled rows get the new cron. Idempotent.
// All data is SYNTHETIC; a schedule only starts a job and no job decides a business approval.
import { insertAuditEvent, sql } from "@mth/db";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureQueues, QUEUES } from "../../src/queues/index.ts";
import { handleJobScheduleUpdated, syncSchedules } from "../../src/schedules.ts";
import { bossFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
const ESCALATION = "approval.escalation_scan";
const SWEEP = "delegation.expiry_sweep";
const PERIODS = "kpi.reporting_period_open";
// Seeded by 0050 (T-DG4-ARCH-06); unhandled until BE-I2 registers the sustainment handlers (rows are listed by code).
const SUSTAINMENT_SCANS = ["sustainment.control_check_scan", "sustainment.review_scan"];
// Seeded by 0054 (T-DG4-ARCH-07); unhandled until BE-K registers the gate-exception expiry handler.
const GATE_EXCEPTION_SCAN = "gate.exception_expiry_scan";

beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
  // The tests stand in for the domain handlers (BE-B's queues do not exist yet): create the two queues they use.
  for (const name of [ESCALATION, SWEEP])
    await boss.createQueue(name, {
      name,
      policy: "standard",
      retryLimit: 5,
      retryDelay: 10,
      deadLetter: QUEUES.failed,
    });
}, 60_000);
afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const schedules = async () =>
  new Map((await boss.getSchedules()).map((s) => [s.name, { cron: s.cron, timezone: s.timezone }]));

/** Changes a job_schedule row as the API would (version + 1 and its audit event in the same transaction). */
async function change(code: string, set: { enabled?: boolean; cron?: string }) {
  await env.db.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom("job_schedule")
      .select(["id", "version"])
      .where("code", "=", code)
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("job_schedule")
      .set({ ...set, version: sql<number>`version + 1`, updated_at: sql<Date>`now()` })
      .where("id", "=", row.id)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "system", actorUserId: null, source: "worker" },
      {
        action: "job_schedule.update",
        recordType: "job_schedule",
        recordId: row.id,
        organizationId: null,
        priorVersion: row.version,
        newVersion: row.version + 1,
      },
    );
  });
}

const envelope = (code: string) => ({
  outboxEventId: crypto.randomUUID(),
  eventType: "job_schedule.updated",
  schemaVersion: 1,
  idempotencyKey: `job_schedule.updated:${code}:${Date.now()}`,
  organizationId: crypto.randomUUID(),
  payload: { code },
});

describe("job schedule registration (ADR-0025 §3)", () => {
  it("registers enabled, handled rows in their timezone; reports rows without a handler; idempotent", async () => {
    const handled = new Set([ESCALATION, SWEEP]);
    const first = await syncSchedules(env.db, boss, handled);
    expect(first).toEqual({
      scheduled: [ESCALATION, SWEEP],
      unscheduled: [],
      unhandled: [GATE_EXCEPTION_SCAN, PERIODS, ...SUSTAINMENT_SCANS],
    });
    const s = await schedules();
    expect(s.get(ESCALATION)).toEqual({ cron: "*/15 * * * *", timezone: "Asia/Riyadh" });
    expect(s.get(SWEEP)).toEqual({ cron: "*/15 * * * *", timezone: "Asia/Riyadh" });
    expect(s.has(PERIODS)).toBe(false);
    expect(await syncSchedules(env.db, boss, handled)).toEqual(first);
    expect((await boss.getSchedules()).filter((x) => x.name === ESCALATION)).toHaveLength(1);
  });

  it("job_schedule.updated re-registers: a disabled row is unscheduled, a new cron replaces the old one", async () => {
    const handled = new Set([ESCALATION, SWEEP]);
    await syncSchedules(env.db, boss, handled);
    await change(SWEEP, { enabled: false });
    await change(ESCALATION, { cron: "*/5 * * * *" });
    const r = await handleJobScheduleUpdated(env.db, boss, handled, envelope(SWEEP));
    expect(r).toEqual({
      scheduled: [ESCALATION],
      unscheduled: [SWEEP],
      unhandled: [GATE_EXCEPTION_SCAN, PERIODS, ...SUSTAINMENT_SCANS],
    });
    const s = await schedules();
    expect(s.get(ESCALATION)).toEqual({ cron: "*/5 * * * *", timezone: "Asia/Riyadh" });
    expect(s.has(SWEEP)).toBe(false);
    await expect(
      handleJobScheduleUpdated(env.db, boss, handled, { ...envelope(SWEEP), eventType: "transformation.created" }),
    ).rejects.toThrow(/unexpected event/);
  });
});
