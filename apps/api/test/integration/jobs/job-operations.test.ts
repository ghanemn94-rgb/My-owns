// The jobs operations view (ADR-0043 §6, §8, §9; REQ-S12-022; p5-work-split §D.4; T-DG5-BE-I2) against a real
// PostgreSQL. Literal tests of §D.4:
//  - the view shows last success and next run for each scheduled job: a never-run job "Never run" (lastSuccessAt
//    null), a disabled job "Disabled" (nextRunAt null, reason disabled), a cron with no match in 366 days "Unknown"
//    (null, reason unknown); never a guessed time;
//  - a non-admin (TL, AUD) gets 403 (and TO, a user without grants);
//  - run now on a disabled schedule -> 422 job.schedule_disabled (exact ADR text), nothing written;
//  - run now twice in one minute sends one job (one job.run_requested outbox event, one audit event, the same job id);
//  - AUD 403 on the write; commit-time re-authorization; one audit event per run-now request that writes.
// This suite disables schedules and changes crons, so it runs on its OWN scratch database (integration files of one
// run can execute concurrently against the shared per-run database). All data is synthetic; a job only starts work
// and never decides a business approval.
import { migrate } from "@mth/db";
import { nextCronRun } from "@mth/shared/time";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { captureJobFailure } from "../../../../worker/src/kit.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let scratchDb: string;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_jobops");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
}, 120_000);
afterAll(async () => {
  await api?.close();
  if (scratchDb) await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const J = "/api/v1/admin/jobs";
const S = "/api/v1/admin/job-schedules";

const scheduleOf = (code: string) =>
  api.db.selectFrom("job_schedule").selectAll().where("code", "=", code).executeTakeFirstOrThrow();

async function patchSchedule(code: string, body: Record<string, unknown>): Promise<void> {
  const v = (await scheduleOf(code)).version;
  const res = await call<Body>(api.app, "PATCH", `${S}/${code}`, { session: admin, headers: ifm(v), body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function insertRun(code: string, jobId: string, outcome: "succeeded" | "failed", finishedAt: string) {
  const finished = new Date(finishedAt);
  await api.db
    .insertInto("job_run")
    .values({
      id: crypto.randomUUID(),
      job_schedule_code: code,
      job_id: jobId,
      attempt_no: 1,
      outcome,
      started_at: new Date(finished.getTime() - 1000),
      finished_at: finished,
      error_code: outcome === "failed" ? "automation.action_failed" : null,
    })
    .execute();
}

const runNowEvents = (singletonKey: string) =>
  api.db
    .selectFrom("outbox_event")
    .select(["id", "event_type", "payload", "organization_id"])
    .where("idempotency_key", "=", singletonKey)
    .execute();

describe("jobs operations view (REQ-S12-022)", () => {
  it("lists every schedule with last success, next run (never guessed), last outcome, open failures and actions", async () => {
    // A schedule with runs: last success is the newest SUCCEEDED run, last run/outcome the newest run.
    await insertRun("delegation.expiry_sweep", "jobops-1", "succeeded", "2026-10-01T09:00:00.000Z");
    await insertRun("delegation.expiry_sweep", "jobops-2", "succeeded", "2026-10-02T09:00:00.000Z");
    await insertRun("delegation.expiry_sweep", "jobops-3", "failed", "2026-10-03T09:00:00.000Z");
    // One open failure of a scheduled job (the worker's capture on the last attempt).
    await captureJobFailure(api.db, {
      queue: "delegation.expiry_sweep",
      jobId: "jobops-3",
      data: {},
      createdOn: new Date("2026-10-03T08:59:00.000Z"),
      attempts: 6,
      error: new Error("Synthetic failure of a scheduled job"),
    });
    // A disabled schedule and one whose cron never matches (30 February).
    await patchSchedule("kpi.reporting_period_open", { enabled: false });
    await patchSchedule("approval.escalation_scan", { cron: "0 0 30 2 *" });
    try {
      const before = new Date();
      const res = await call<Body>(api.app, "GET", J, { session: admin });
      const after = new Date();
      expect(res.status).toBe(200);
      const all = await api.db.selectFrom("job_schedule").select("code").orderBy("code").execute();
      expect(res.body.items.map((i: Body) => i.code)).toEqual(all.map((r) => r.code));
      const byCode = new Map<string, Body>(res.body.items.map((i: Body) => [i.code, i]));

      const ran = byCode.get("delegation.expiry_sweep");
      expect(ran).toMatchObject({
        lastSuccessAt: "2026-10-02T09:00:00.000Z",
        lastRunAt: "2026-10-03T09:00:00.000Z",
        lastOutcome: "failed",
        openFailures: 1,
        enabled: true,
        nextRunUnknownReason: null,
      });
      expect(ran.allowedActions).toEqual(["run_now", "retry_failures"]);
      // Next run = the cron's next instant in its zone after the request time (computed, not guessed).
      const candidates = [nextCronRun(ran.cron, ran.timezone, before), nextCronRun(ran.cron, ran.timezone, after)].map(
        (d) => d!.toISOString(),
      );
      expect(candidates).toContain(ran.nextRunAt);

      // Never run: no last success, no last run, no outcome; still a computed next run.
      const never = byCode.get("gate.condition_escalation_scan");
      expect(never).toMatchObject({ lastSuccessAt: null, lastRunAt: null, lastOutcome: null, openFailures: 0 });
      expect(never.allowedActions).toEqual(["run_now"]);
      expect(typeof never.nextRunAt).toBe("string");
      expect(
        [nextCronRun("0 1 * * *", never.timezone, before), nextCronRun("0 1 * * *", never.timezone, after)].map((d) =>
          d!.toISOString(),
        ),
      ).toContain(never.nextRunAt);

      // Disabled: next run null with reason disabled; run now not offered.
      expect(byCode.get("kpi.reporting_period_open")).toMatchObject({
        enabled: false,
        nextRunAt: null,
        nextRunUnknownReason: "disabled",
        allowedActions: [],
      });
      // No match in 366 days: null with reason unknown (never a guessed time).
      expect(byCode.get("approval.escalation_scan")).toMatchObject({
        enabled: true,
        nextRunAt: null,
        nextRunUnknownReason: "unknown",
      });

      // The view takes no query parameter: an undeclared one is a 400.
      expect((await call<Body>(api.app, "GET", `${J}?limit=5`, { session: admin })).status).toBe(400);
    } finally {
      await patchSchedule("kpi.reporting_period_open", { enabled: true });
      await patchSchedule("approval.escalation_scan", { cron: "*/15 * * * *" });
    }
  });

  it("a non-admin (TL, AUD, TO, no grants) gets 403 on the view, the detail and run now; nothing is written", async () => {
    const code = "gate.exception_expiry_scan";
    const row = await scheduleOf(code);
    for (const subject of [
      w.leadA1.subject,
      w.auditor.subject,
      w.office.subject,
      w.nobody.subject,
      w.officeB.subject,
    ]) {
      const s = await signIn(api.app, subject);
      expect((await call<Body>(api.app, "GET", J, { session: s })).status, subject).toBe(403);
      expect((await call<Body>(api.app, "GET", `${J}/${code}`, { session: s })).status, subject).toBe(403);
      expect((await call<Body>(api.app, "POST", `${J}/${code}/run`, { session: s })).status, subject).toBe(403);
    }
    expect((await auditOf(api.db, row.id)).filter((a) => a.action === "job_schedule.run_now")).toEqual([]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select("id")
      .where("aggregate_id", "=", row.id)
      .where("event_type", "=", "job.run_requested")
      .execute();
    expect(events).toEqual([]);
  });

  it("detail: the job and its runs newest first, paginated; 404 unknown job; 400 malformed code or cursor", async () => {
    const code = "sustainment.review_scan";
    await insertRun(code, "jobops-d1", "succeeded", "2026-09-01T00:00:00.000Z");
    await insertRun(code, "jobops-d2", "failed", "2026-09-02T00:00:00.000Z");
    await insertRun(code, "jobops-d3", "succeeded", "2026-09-03T00:00:00.000Z");
    const first = await call<Body>(api.app, "GET", `${J}/${code}?limit=2`, { session: admin });
    expect(first.status).toBe(200);
    expect(first.body.job).toMatchObject({ code, lastSuccessAt: "2026-09-03T00:00:00.000Z", lastOutcome: "succeeded" });
    expect(first.body.runs.map((r: Body) => [r.jobId, r.outcome, r.errorCode])).toEqual([
      ["jobops-d3", "succeeded", null],
      ["jobops-d2", "failed", "automation.action_failed"],
    ]);
    expect(typeof first.body.nextCursor).toBe("string");
    const second = await call<Body>(
      api.app,
      "GET",
      `${J}/${code}?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { session: admin },
    );
    expect([second.status, second.body.runs.map((r: Body) => r.jobId), second.body.nextCursor]).toEqual([
      200,
      ["jobops-d1"],
      null,
    ]);
    // A cursor of another job is refused.
    const other = await call<Body>(
      api.app,
      "GET",
      `${J}/delegation.expiry_sweep?limit=2&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { session: admin },
    );
    expect(other.status).toBe(400);
    expect((await call<Body>(api.app, "GET", `${J}/no_such.job`, { session: admin })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${J}/Not-A-Code`, { session: admin })).status).toBe(400);
    // A never-run job: empty history, "Never run".
    const never = await call<Body>(api.app, "GET", `${J}/governance.meeting_series_generate`, { session: admin });
    expect([never.status, never.body.runs, never.body.job.lastSuccessAt, never.body.nextCursor]).toEqual([
      200,
      [],
      null,
      null,
    ]);
  });

  it("run now on a disabled schedule -> 422 job.schedule_disabled (exact text); nothing written", async () => {
    const code = "governance.decision_sla_scan";
    await patchSchedule(code, { enabled: false });
    try {
      const row = await scheduleOf(code);
      const res = await call<Body>(api.app, "POST", `${J}/${code}/run`, { session: admin });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "job.schedule_disabled",
        "Enable the schedule before running it now.",
      ]);
      expect((await auditOf(api.db, row.id)).filter((a) => a.action === "job_schedule.run_now")).toEqual([]);
      const events = await api.db
        .selectFrom("outbox_event")
        .select("id")
        .where("aggregate_id", "=", row.id)
        .where("event_type", "=", "job.run_requested")
        .execute();
      expect(events).toEqual([]);
    } finally {
      await patchSchedule(code, { enabled: true });
    }
    expect((await call<Body>(api.app, "POST", `${J}/no_such.job/run`, { session: admin })).status).toBe(404);
  });

  it("run now twice in one minute sends one job: one outbox event, one audit event, the same job id", async () => {
    const code = "governance.blocker_escalation_scan";
    const row = await scheduleOf(code);
    // The two requests must fall in the same minute; if a minute boundary separates them, the pair is repeated (the
    // property is about one minute, and the check never depends on the clock).
    let pair: [Body, Body] | null = null;
    for (let i = 0; i < 3 && pair === null; i++) {
      const a = await call<Body>(api.app, "POST", `${J}/${code}/run`, { session: admin });
      const b = await call<Body>(api.app, "POST", `${J}/${code}/run`, { session: admin });
      expect([a.status, b.status]).toEqual([202, 202]);
      if (a.body.singletonKey === b.body.singletonKey) pair = [a.body, b.body];
    }
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    expect(a.singletonKey).toMatch(/^run-now:governance\.blocker_escalation_scan:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(a.code).toBe(code);
    expect(b).toEqual(a);
    const events = await runNowEvents(a.singletonKey);
    expect(events).toEqual([
      {
        id: a.jobId,
        event_type: "job.run_requested",
        organization_id: w.orgA.id,
        payload: {
          jobScheduleCode: code,
          queueName: row.queue_name,
          requestedBy: w.admin.id,
          singletonKey: a.singletonKey,
        },
      },
    ]);
    const audits = (await auditOf(api.db, row.id)).filter(
      (x) => x.action === "job_schedule.run_now" && (x.changes as Body)?.run_now?.to === a.singletonKey,
    );
    expect(audits.map((x) => [x.actor_user_id, x.organization_id])).toEqual([[w.admin.id, w.orgA.id]]);
    // The schedule itself is unchanged (run now changes no versioned record).
    expect((await scheduleOf(code)).version).toBe(row.version);
  });

  it("run now twice at the same time (concurrent requests): one job, one outbox event, one audit event", async () => {
    const code = "sustainment.control_check_scan";
    const row = await scheduleOf(code);
    let pair: [Body, Body] | null = null;
    for (let i = 0; i < 3 && pair === null; i++) {
      const [a, b] = await Promise.all([
        call<Body>(api.app, "POST", `${J}/${code}/run`, { session: admin }),
        call<Body>(api.app, "POST", `${J}/${code}/run`, { session: admin }),
      ]);
      expect([a.status, b.status]).toEqual([202, 202]);
      if (a.body.singletonKey === b.body.singletonKey) pair = [a.body, b.body];
    }
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    expect(b.jobId).toBe(a.jobId);
    expect((await runNowEvents(a.singletonKey)).map((e) => e.id)).toEqual([a.jobId]);
    const audits = (await auditOf(api.db, row.id)).filter(
      (x) => x.action === "job_schedule.run_now" && (x.changes as Body)?.run_now?.to === a.singletonKey,
    );
    expect(audits).toHaveLength(1);
  });

  it("commit-time authorization: job.repair revoked while the request waits -> 403 (audited); nothing written", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const code = "governance.meeting_cutoff_scan";
    const row = await scheduleOf(code);
    const res = await afterIdentity(
      api,
      user.id,
      () => call<Body>(api.app, "POST", `${J}/${code}/run`, { session: s, contract: false }),
      () => revokeAll(api, w.grantor.id, user.id),
    );
    expect(res.status).toBe(403);
    const events = await api.db
      .selectFrom("outbox_event")
      .select("id")
      .where("aggregate_id", "=", row.id)
      .where("event_type", "=", "job.run_requested")
      .execute();
    expect(events).toEqual([]);
    const denied = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("actor_user_id", "=", user.id)
      .where("action", "=", "authorization.denied")
      .execute();
    expect(denied).toHaveLength(1);
  });
});
