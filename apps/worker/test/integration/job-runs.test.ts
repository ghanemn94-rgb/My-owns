// REQ-S12-022 "store scheduled runs and execution outcomes in the database" (ADR-0043 §6; p5-work-split §D.4;
// T-DG5-BE-I2), against a real PostgreSQL with pg-boss and the production startWorker (its job_run lines and the
// run-now dispatcher):
//  1. run now, as the API writes it (the job.run_requested outbox event, idempotency key run-now:<code>:<minute>): the
//     relay delivers it after COMMIT, the dispatcher sends the schedule's own job data to the schedule's queue under job
//     id = the event id, the handler runs, and the run is recorded like a scheduled one (one succeeded job_run);
//  2. a replayed dispatch sends nothing new (one pg-boss job), a disabled schedule or a queue without a handler is not
//     sent;
//  3. a failing scheduled job records one failed job_run per attempt (automation.action_failed, then
//     automation.retries_exhausted on the last attempt, when it also enters the failure queue);
//  4. recordJobRun: a job of a queue that no schedule names is not recorded, and a redelivered attempt records once.
// All data is SYNTHETIC; a job only starts work and never decides a business approval.
import { randomUUID } from "node:crypto";
import { insertAuditEvent } from "@mth/db";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNowSingletonKey } from "@mth/shared/schemas";
import type { JobHandler } from "../../src/handlers/spec.ts";
import { jobActor } from "../../src/kit.ts";
import {
  dispatchRunNow,
  JOB_RUN_EXHAUSTED_CODE,
  JOB_RUN_FAILED_CODE,
  recordJobRun,
  RUN_NOW_QUEUE,
} from "../../src/job-runs.ts";
import { QUEUES_FOR_EVENT } from "../../src/queues/index.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
let worker: RunningWorker | null = null;
let org: string;
let userId: string;
const quiet = { info: () => undefined, error: () => undefined };
const OK_CODE = "gate.exception_expiry_scan";
const FAIL_CODE = "governance.decision_sla_scan";
const handled: string[] = [];

beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  const seed = await seedTransformationWithOutbox(env.db);
  userId = seed.userId;
  org = (
    await env.db.selectFrom("app_user").select("organization_id").where("id", "=", userId).executeTakeFirstOrThrow()
  ).organization_id;
  const queueOf = async (code: string) =>
    (await env.db.selectFrom("job_schedule").select("queue_name").where("code", "=", code).executeTakeFirstOrThrow())
      .queue_name;
  const okHandler: JobHandler = {
    queue: await queueOf(OK_CODE),
    handle: async (_db, data, jobId) => {
      expect(data).toEqual({});
      handled.push(jobId);
      return "synthetic run";
    },
  };
  const failHandler: JobHandler = {
    queue: await queueOf(FAIL_CODE),
    handle: async () => {
      throw new Error("Synthetic failure of a scheduled job");
    },
  };
  worker = await startWorker({
    db: env.db,
    boss,
    timeZone: "Asia/Riyadh",
    jobPollingIntervalSeconds: 0.5,
    pollIntervalMs: 200,
    log: quiet,
    // One retry, at once: attempt 1 fails, attempt 2 is the last (the standard limit is pinned in BE-I's suite).
    queuePolicy: { retryLimit: 1, retryDelay: 0, retryBackoff: false },
    handlers: [okHandler, failHandler],
  });
}, 90_000);
afterAll(async () => {
  await worker?.stop();
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

/** Writes the run-now outbox event exactly as the API's runJobNow does; returns its id (= the job id). */
async function requestRunNow(code: string): Promise<{ eventId: string; singletonKey: string; queue: string }> {
  const schedule = await env.db
    .selectFrom("job_schedule")
    .select(["id", "queue_name"])
    .where("code", "=", code)
    .executeTakeFirstOrThrow();
  const eventId = randomUUID();
  const singletonKey = `${runNowSingletonKey(code, new Date())}:${eventId.slice(0, 8)}`;
  await env.db
    .insertInto("outbox_event")
    .values({
      id: eventId,
      organization_id: org,
      aggregate_type: "job_schedule",
      aggregate_id: schedule.id,
      event_type: "job.run_requested",
      schema_version: 1,
      payload: JSON.stringify({
        jobScheduleCode: code,
        queueName: schedule.queue_name,
        requestedBy: userId,
        singletonKey,
      }),
      idempotency_key: singletonKey,
    })
    .execute();
  return { eventId, singletonKey, queue: schedule.queue_name };
}

/** Enables or disables a schedule as an audited change (version + 1 and its audit event in one transaction). */
async function setEnabled(code: string, enabled: boolean): Promise<void> {
  await env.db.transaction().execute(async (tx) => {
    const row = await tx
      .updateTable("job_schedule")
      .set((eb) => ({ enabled, version: eb("version", "+", 1) }))
      .where("code", "=", code)
      .returning(["id", "version"])
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, jobActor("job-runs-test"), {
      action: "job_schedule.update",
      recordType: "job_schedule",
      recordId: row.id,
      organizationId: null,
      priorVersion: row.version - 1,
      newVersion: row.version,
      changes: { enabled: { from: !enabled, to: enabled } },
    });
  });
}

const runsOf = (jobId: string) =>
  env.db.selectFrom("job_run").selectAll().where("job_id", "=", jobId).orderBy("attempt_no").execute();
const jobsWithId = async (queue: string, id: string) =>
  Number(
    (await env.owner.query("SELECT count(*)::int AS n FROM pgboss.job WHERE name = $1 AND id = $2", [queue, id]))
      .rows[0].n,
  );
const envelopeOf = (eventId: string, singletonKey: string, payload: Record<string, unknown>) => ({
  outboxEventId: eventId,
  eventType: "job.run_requested",
  schemaVersion: 1,
  idempotencyKey: singletonKey,
  organizationId: org,
  payload,
});

describe("REQ-S12-022: scheduled runs are stored, run now runs once", () => {
  it("routes job.run_requested to the jobs.run_now dispatcher", () => {
    expect(QUEUES_FOR_EVENT["job.run_requested"]).toEqual([RUN_NOW_QUEUE]);
  });

  it(
    "run now: dispatched after COMMIT, the handler runs once, one succeeded job_run; a replay sends nothing",
    {
      timeout: 60_000,
    },
    async () => {
      const { eventId, singletonKey, queue } = await requestRunNow(OK_CODE);
      const runs = await waitFor(async () => {
        const r = await runsOf(eventId);
        return r.length > 0 ? r : null;
      }, 45_000);
      expect(runs.map((r) => [r.job_schedule_code, r.attempt_no, r.outcome, r.error_code])).toEqual([
        [OK_CODE, 1, "succeeded", null],
      ]);
      expect(runs[0]!.finished_at.getTime()).toBeGreaterThanOrEqual(runs[0]!.started_at.getTime());
      expect(handled.filter((id) => id === eventId)).toHaveLength(1);
      expect(await jobsWithId(queue, eventId)).toBe(1);
      // A replayed dispatch (the relay or pg-boss redelivering the event) sends nothing new.
      const payload = { jobScheduleCode: OK_CODE, queueName: queue, requestedBy: userId, singletonKey };
      const replay = await dispatchRunNow(env.db, boss, new Set([queue]), envelopeOf(eventId, singletonKey, payload));
      expect(replay).toEqual({ outcome: "already_sent", code: OK_CODE, jobId: eventId });
      expect(await jobsWithId(queue, eventId)).toBe(1);
      expect(await runsOf(eventId)).toHaveLength(1);
    },
  );

  it("a disabled schedule or a queue without a handler is not sent", async () => {
    const schedule = await env.db
      .selectFrom("job_schedule")
      .select(["queue_name"])
      .where("code", "=", "sustainment.review_scan")
      .executeTakeFirstOrThrow();
    const eventId = randomUUID();
    const key = `run-now:sustainment.review_scan:test-${eventId}`;
    const payload = {
      jobScheduleCode: "sustainment.review_scan",
      queueName: schedule.queue_name,
      requestedBy: userId,
      singletonKey: key,
    };
    // Not handled by this worker.
    expect(await dispatchRunNow(env.db, boss, new Set(), envelopeOf(eventId, key, payload))).toMatchObject({
      outcome: "unhandled",
    });
    // Disabled since the request (a scratch database of this file only).
    await setEnabled("sustainment.review_scan", false);
    try {
      expect(
        await dispatchRunNow(env.db, boss, new Set([schedule.queue_name]), envelopeOf(eventId, key, payload)),
      ).toMatchObject({ outcome: "disabled" });
    } finally {
      await setEnabled("sustainment.review_scan", true);
    }
    expect(await jobsWithId(schedule.queue_name, eventId)).toBe(0);
  });

  it(
    "a failing scheduled job: one failed job_run per attempt; the last one is exhausted and in the failure queue",
    {
      timeout: 60_000,
    },
    async () => {
      const { eventId, queue } = await requestRunNow(FAIL_CODE);
      const runs = await waitFor(async () => {
        const r = await runsOf(eventId);
        return r.length >= 2 ? r : null;
      }, 45_000);
      expect(runs.map((r) => [r.job_schedule_code, r.attempt_no, r.outcome, r.error_code])).toEqual([
        [FAIL_CODE, 1, "failed", JOB_RUN_FAILED_CODE],
        [FAIL_CODE, 2, "failed", JOB_RUN_EXHAUSTED_CODE],
      ]);
      const failure = await waitFor(() =>
        env.db
          .selectFrom("operational_failure")
          .selectAll()
          .where("queue_name", "=", queue)
          .where("job_id", "=", eventId)
          .executeTakeFirst(),
      );
      expect([failure.source, failure.job_schedule_code, failure.status]).toEqual(["job", FAIL_CODE, "open"]);
    },
  );

  it("recordJobRun: a queue no schedule names is not recorded; a redelivered attempt records once", async () => {
    const base = {
      jobId: `job-runs-${randomUUID()}`,
      retryCount: 0,
      retryLimit: 5,
      startedAt: new Date("2026-10-15T00:00:00.000Z"),
      finishedAt: new Date("2026-10-15T00:00:02.000Z"),
      failed: false,
    };
    expect(await recordJobRun(env.db, { ...base, queue: "test.not_scheduled" })).toBe("not_scheduled");
    const queue = (
      await env.db
        .selectFrom("job_schedule")
        .select("queue_name")
        .where("code", "=", "kpi.reporting_period_open")
        .executeTakeFirstOrThrow()
    ).queue_name;
    expect(await recordJobRun(env.db, { ...base, queue })).toBe("recorded");
    expect(await recordJobRun(env.db, { ...base, queue })).toBe("already_recorded");
    expect((await runsOf(base.jobId)).map((r) => [r.job_schedule_code, r.attempt_no, r.outcome])).toEqual([
      ["kpi.reporting_period_open", 1, "succeeded"],
    ]);
  });
});
