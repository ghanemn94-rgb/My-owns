// Kill the worker partway through kpi.reporting_period_open and restart it (T-DG4-KBE-R1 item 4; the KBE-C handback §7
// "not tested: a kill mid-run"; REQ-S12-005, REQ-S16-005; ADR-0025 §3-§4). Against a real PostgreSQL with pg-boss:
//  1. one organization has one active monthly KPI with an owner and two scheduled, due periods (2026-01, 2026-02);
//  2. the parent holds an uncommitted work item with the 2026-02 task's dedupe key, so the REAL handler (in a REAL
//     worker process, test/kpi-period-open-child.ts) commits 2026-01 (period opened, audit event, task, ledger row) and
//     then blocks inside 2026-02's transaction, after opening the period and writing its audit event, on that key;
//  3. the process is killed with SIGKILL partway through the job: 2026-01 stays committed, nothing of 2026-02 is;
//  4. a restarted worker gets the same job again (pg-boss expires the dead worker's active job and retries it) and
//     completes it: 2026-02 is opened once; in total exactly one open per period (version 2, one
//     reporting_period.open audit event each), one task and one reminder per period, one ledger row per period;
//  5. a redelivery of the job opens nothing and creates no task.
// All data is SYNTHETIC; no job decides a business approval or touches the engineering gates DG0-DG7.
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { insertAuditEvent, sql, type Db } from "@mth/db";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KPI_HANDLERS, PERIOD_OPEN_CONSUMER, PERIOD_OPEN_QUEUE } from "../../src/handlers/kpi.ts";
import { createWorkItemOnce, jobActor } from "../../src/kit.ts";
import { createBoss, ensureQueues, QUEUES } from "../../src/queues/index.ts";
import { startWorker, type RunningWorker } from "../../src/worker.ts";
import { bossFor, seedTransformationWithOutbox, waitFor, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
  // This file's database only: an active period-open job expires after 2 s (a dead worker never completes it), then
  // it is retried after 1 s. The retry budget covers the blocked child's own expiries before it is killed.
  await boss.updateQueue(PERIOD_OPEN_QUEUE, {
    name: PERIOD_OPEN_QUEUE,
    policy: "standard",
    expireInSeconds: 2,
    retryLimit: 10,
    retryDelay: 1,
    deadLetter: QUEUES.failed,
  });
}, 60_000);
afterAll(async () => {
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const CHILD = fileURLToPath(new URL("../kpi-period-open-child.ts", import.meta.url));
const CHILD_DB_APPLICATION = "kpi-open-child-db";

function startChild(): { child: ChildProcess; ready: Promise<void>; exited: Promise<number | null> } {
  const child = spawn(process.execPath, ["--conditions=@mth/source", CHILD], {
    env: { ...process.env, CHILD_DB_URL: env.appUrl },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (b: Buffer) => {
      out += b.toString();
      if (out.includes("READY")) resolve();
    });
    child.stderr!.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.once("exit", () => reject(new Error(`child exited before READY: ${out}`)));
  });
  ready.catch(() => undefined);
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, ready, exited };
}

interface Seeded {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly userId: string;
  readonly kpiId: string;
  readonly periods: readonly { readonly id: string; readonly label: string }[];
}

/** One active monthly KPI with an owner and two scheduled monthly periods, due long ago, each with its audit event. */
async function seed(db: Db): Promise<Seeded> {
  const { transformationId, userId } = await seedTransformationWithOutbox(db);
  const { organization_id: organizationId } = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const kpiId = randomUUID();
  const periods = [
    { id: randomUUID(), label: "2026-01", start: "2026-01-01", end: "2026-01-31" },
    { id: randomUUID(), label: "2026-02", start: "2026-02-01", end: "2026-02-28" },
  ];
  const actor = { actorType: "user", actorUserId: userId, requestId: `test-${randomUUID()}`, source: "api" } as const;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: organizationId,
        transformation_id: transformationId,
        name: "Synthetic period-open KPI",
        unit_kind: "count",
        polarity: "higher_is_better",
        frequency: "monthly",
        status: "active",
        owner_user_id: userId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "kpi_definition.create",
      recordType: "kpi_definition",
      recordId: kpiId,
      organizationId,
      transformationId,
      newVersion: 1,
    });
    for (const p of periods) {
      await tx
        .insertInto("reporting_period")
        .values({
          id: p.id,
          organization_id: organizationId,
          frequency: "monthly",
          period_label: p.label,
          period_start: p.start,
          period_end: p.end,
          created_by: userId,
          updated_by: userId,
        })
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "reporting_period.create",
        recordType: "reporting_period",
        recordId: p.id,
        organizationId,
        newVersion: 1,
      });
    }
  });
  return { organizationId, transformationId, userId, kpiId, periods: periods.map(({ id, label }) => ({ id, label })) };
}

const taskKey = (s: Seeded, label: string) => `kpi.period_open:${s.kpiId}:${label}:${s.userId}`;

/** Per period, in order: [status, version, open audit events, tasks, reminders, ledger rows] - all committed rows. */
async function state(s: Seeded) {
  const out: unknown[] = [];
  for (const p of s.periods) {
    const period = await env.db
      .selectFrom("reporting_period")
      .select(["status", "version"])
      .where("id", "=", p.id)
      .executeTakeFirstOrThrow();
    const n = async (q: Promise<{ n: string | number | bigint }>) => Number((await q).n);
    const opens = await n(
      env.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("record_id", "=", p.id)
        .where("action", "=", "reporting_period.open")
        .executeTakeFirstOrThrow(),
    );
    const tasks = await n(
      env.db
        .selectFrom("work_item")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("organization_id", "=", s.organizationId)
        .where("dedupe_key", "=", taskKey(s, p.label))
        .executeTakeFirstOrThrow(),
    );
    const reminders = await n(
      env.db
        .selectFrom("inbox_notification")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("organization_id", "=", s.organizationId)
        .where("dedupe_key", "=", taskKey(s, p.label))
        .executeTakeFirstOrThrow(),
    );
    const ledger = await n(
      env.db
        .selectFrom("processed_message")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("consumer", "=", PERIOD_OPEN_CONSUMER)
        .where("idempotency_key", "=", `kpi.reporting_period_open:${p.id}`)
        .executeTakeFirstOrThrow(),
    );
    out.push([period.status, period.version, opens, tasks, reminders, ledger]);
  }
  return out;
}

const jobState = async (id: string) =>
  (await env.owner.query("SELECT state, retry_count, output FROM pgboss.job WHERE id = $1", [id])).rows[0] as
    | { state: string; retry_count: number; output: unknown }
    | undefined;

const childBackends = async () =>
  (
    await env.owner.query(
      "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1",
      [CHILD_DB_APPLICATION],
    )
  ).rows[0].n as number;
/** Lock requests of the child's backends that wait (pg_locks; wait_event_type is not visible to the test role). */
const childLockWaits = async () =>
  (
    await env.owner.query(
      `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE NOT l.granted AND a.datname = current_database() AND a.application_name = $1`,
      [CHILD_DB_APPLICATION],
    )
  ).rows[0].n as number;

describe("kill the worker partway through kpi.reporting_period_open and restart it (T-DG4-KBE-R1 item 4)", () => {
  it(
    "the restart opens the remaining period once and creates no duplicate period or task",
    { timeout: 120_000 },
    async () => {
      const s = await seed(env.db);
      expect(await state(s)).toEqual([
        ["scheduled", 1, 0, 0, 0, 0],
        ["scheduled", 1, 0, 0, 0, 0],
      ]);

      // The blocker: an uncommitted work item with 2026-02's dedupe key (the same kit function the handler calls). It is
      // released well within the pool's 30 s idle-in-transaction timeout.
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let blockerHeld!: () => void;
      const held = new Promise<void>((r) => (blockerHeld = r));
      const blocker = env.db
        .transaction()
        .execute(async (tx) => {
          await createWorkItemOnce(tx, jobActor("blocker"), {
            organizationId: s.organizationId,
            transformationId: s.transformationId,
            kind: "kpi_update_due",
            assigneeUserId: s.userId,
            subjectType: "kpi_definition",
            subjectId: s.kpiId,
            linkPath: `/transformations/${s.transformationId}/kpis/${s.kpiId}/actuals`,
            messageKey: "kpi.update_due",
            periodLabel: "2026-02",
            dedupeKey: taskKey(s, "2026-02"),
          });
          blockerHeld();
          await released;
          throw new Error("rollback the blocker");
        })
        .catch((e: Error) => {
          if (e.message !== "rollback the blocker") throw e;
        });
      await held;

      const jobId = (await boss.send(PERIOD_OPEN_QUEUE, { organizationId: s.organizationId }))!;
      const run = startChild();
      let worker: RunningWorker | null = null;
      let restartedBoss: PgBoss | null = null;
      try {
        await run.ready;
        // 1. The child is partway through the job: 2026-01 committed, and a child backend waits on 2026-02's task key.
        await waitFor(async () => (await childLockWaits()) > 0, 20_000, 50);
        expect((await jobState(jobId))?.state).toBe("active");
        expect(await state(s)).toEqual([
          ["open", 2, 1, 1, 1, 1],
          ["scheduled", 1, 0, 0, 0, 0],
        ]);
        // Inside the blocked transaction the child has already opened 2026-02 (uncommitted): its row is locked.
        const locked = await env.owner.query("SELECT id FROM reporting_period WHERE id = $1 FOR UPDATE SKIP LOCKED", [
          s.periods[1]!.id,
        ]);
        expect(locked.rows).toEqual([]);

        // 2. Kill it (no graceful shutdown, no COMMIT), then let the blocker go. A backend waiting on a lock does not
        //    notice that its client died; once unblocked it finds the socket closed and aborts its transaction (a dead
        //    client can never send COMMIT), so its backends end and nothing of 2026-02 commits.
        run.child.kill("SIGKILL");
        expect(await run.exited).toBeNull();
        release();
        await blocker;
        await waitFor(async () => (await childBackends()) === 0, 20_000, 100);
        expect(await state(s)).toEqual([
          ["open", 2, 1, 1, 1, 1],
          ["scheduled", 1, 0, 0, 0, 0],
        ]);

        // 3. Restart: a worker with supervision on (pg-boss expires the dead worker's job and retries it).
        restartedBoss = createBoss(env.appUrl, {
          schedule: false,
          supervise: true,
          superviseIntervalSeconds: 1,
          monitorIntervalSeconds: 1,
          applicationName: "kpi-open-restarted-boss",
        });
        restartedBoss.on("error", () => undefined);
        await restartedBoss.start();
        worker = await startWorker({
          db: env.db,
          boss: restartedBoss,
          timeZone: "Asia/Riyadh",
          jobPollingIntervalSeconds: 0.5,
          pollIntervalMs: 200,
          log: { info: () => undefined, error: () => undefined },
          handlers: KPI_HANDLERS.filter((h) => h.queue === PERIOD_OPEN_QUEUE),
        });
        await waitFor(async () => (await jobState(jobId))?.state === "completed", 60_000, 250);
        const done = (await jobState(jobId))!;
        expect(done.retry_count).toBeGreaterThanOrEqual(1);
        // The restarted run found only 2026-02 still scheduled: it opened one period and created one task.
        expect(done.output).toEqual({ outcome: { opened: 1, tasks: 1 } });
        expect(await state(s)).toEqual([
          ["open", 2, 1, 1, 1, 1],
          ["open", 2, 1, 1, 1, 1],
        ]);
        const audit = await env.db
          .selectFrom("audit_event")
          .select(["action", "actor_type", "source"])
          .where("record_id", "=", s.periods[1]!.id)
          .where("action", "=", "reporting_period.open")
          .execute();
        expect(audit).toEqual([{ action: "reporting_period.open", actor_type: "service", source: "worker" }]);

        // 4. A redelivery of the job opens nothing and creates no task.
        const again = (await restartedBoss.send(PERIOD_OPEN_QUEUE, { organizationId: s.organizationId }))!;
        await waitFor(async () => (await jobState(again))?.state === "completed", 30_000, 250);
        expect((await jobState(again))!.output).toEqual({ outcome: { opened: 0, tasks: 0 } });
        expect(await state(s)).toEqual([
          ["open", 2, 1, 1, 1, 1],
          ["open", 2, 1, 1, 1, 1],
        ]);
        const allTasks = await env.db
          .selectFrom("work_item")
          .select(sql<number>`count(*)::int`.as("n"))
          .where("subject_id", "=", s.kpiId)
          .executeTakeFirstOrThrow();
        expect(allTasks.n).toBe(2);
      } finally {
        release();
        await blocker.catch(() => undefined);
        if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGKILL");
        await worker?.stop();
        await restartedBoss?.stop({ graceful: false, wait: true, timeout: 5000 });
      }
    },
  );
});
