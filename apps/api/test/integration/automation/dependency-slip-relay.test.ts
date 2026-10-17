// T-DG5-BE-T5 (D-167; QA-F2 D-QA-F2-1, REQ-S12-012): `dependency.slipped` v1 is registered in OUTBOX_EVENT_SCHEMAS, so
// the REAL relay publishes the outbox row the API writes for a critical slip, and starter 9 (`starter.dependency_slip`,
// queue portfolio.dependency_slip) runs ONCE under the real worker: one succeeded execution, one dependency_slip work
// item for the affected owner, and the outbox row published on its first attempt with no last_error (before the fix:
// "no schema for dependency.slipped v1", ten attempts, never published). Runs in its own scratch database because the
// relay publishes every unpublished row of the database it reads. All data is SYNTHETIC; nothing approves anything,
// and nothing touches the engineering gates DG0-DG7.
import { migrate, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { createBoss, ensureQueues } from "../../../../worker/src/queues/index.ts";
import { relayOnce } from "../../../../worker/src/relay.ts";
import { startWorker, type RunningWorker } from "../../../../worker/src/worker.ts";
import { call, seedWorld, startApi, type Res, type TestApi } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { insertAudited, insertMilestone, seedExecutionWorld, type ExecWorld } from "../portfolio/execution-fixtures.ts";

let scratch: string | null = null;
let api: TestApi;
let boss: ReturnType<typeof createBoss>;
let worker: RunningWorker | null = null;
let x: ExecWorld;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]): Promise<Res<Body>> => call(api.app, m, u, o);

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_t5_slip");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  api = await startApi({ database: scratch });
  boss = createBoss(roleUrl(adminUrl, scratch, "mth_app"), {
    schedule: false,
    supervise: false,
    applicationName: "be-t5-slip-boss",
  });
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss); // the queues exist before the relay sends (the worker is started after the relay)
  x = await seedExecutionWorld(api, await seedWorld(api.db));
}, 120_000);

afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("dependency.slipped through the real relay (D-QA-F2-1)", () => {
  it("the outbox row is published on its first attempt and starter 9's execution succeeds once", async () => {
    // P (owner TL) -> S (owner BO, starts on P's finish); needed by 2041-04-03. P's finish moves 04-01 -> 04-06 (5 days):
    // the needed-by date is breached, so the dependency is critical and one slip is recorded.
    const p = await insertAudited(api.db, x, "initiative", {
      code: "INI-71",
      name: "Synthetic predecessor",
      executive_owner_user_id: x.users.tl.id,
      planned_start: "2041-03-01",
      planned_end: "2041-04-01",
    });
    const s = await insertAudited(api.db, x, "initiative", {
      code: "INI-72",
      name: "Synthetic successor",
      executive_owner_user_id: x.users.bo.id,
      planned_start: "2041-04-01",
      planned_end: "2041-05-01",
    });
    const dep = await send("POST", "/api/v1/dependencies", {
      session: x.s.tl,
      body: {
        transformationId: x.transformationId,
        description: "Synthetic delivery dependency",
        from: { kind: "initiative", initiativeId: p },
        toInitiativeId: s,
        dependencyType: "tech",
        neededBy: "2041-04-03",
      },
    });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    const milestone = await insertMilestone(api.db, x, p, null, "2041-04-01");
    await insertMilestone(api.db, x, s, null, "2041-05-01");
    const cur = await send("GET", `/api/v1/milestones/${milestone}`, { session: x.s.tl });
    const moved = await send("PATCH", `/api/v1/milestones/${milestone}`, {
      session: x.s.tl,
      headers: ifm(cur.body.version),
      body: { forecastDate: "2041-04-06" },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const slip = await api.db
      .selectFrom("dependency_slip")
      .select(["id", "slip_days", "critical_reason"])
      .where("dependency_id", "=", dep.body.id)
      .executeTakeFirstOrThrow();
    expect([slip.slip_days, slip.critical_reason]).toEqual([5, "needed_by_breached"]);

    // The real relay over every unpublished row of this database: nothing fails, and the slip's row is published.
    for (let i = 0; i < 50; i += 1) {
      const r = await relayOnce(api.db, boss);
      if (r.failed > 0) {
        const failed = await api.db
          .selectFrom("outbox_event")
          .select(["event_type", "last_error"])
          .where("last_error", "is not", null)
          .execute();
        expect(failed, "a relay failure").toEqual([]);
      }
      if (r.published === 0) break;
    }
    const row = await api.db
      .selectFrom("outbox_event")
      .select(["published_at", "publish_attempts", "last_error", "idempotency_key"])
      .where("idempotency_key", "=", `dependency.slipped:${slip.id}`)
      .executeTakeFirstOrThrow();
    // The successful publish is its first attempt (the relay counts it): 1, not the ten refusals of D-QA-F2-1.
    expect([row.published_at !== null, row.publish_attempts, row.last_error]).toEqual([true, 1, null]);
    const unpublished = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "last_error"])
      .where("published_at", "is", null)
      .execute();
    expect(unpublished).toEqual([]);

    // The real worker (every handler) consumes it: starter 9 records ONE succeeded execution and BO gets one item.
    worker = await startWorker({
      db: api.db,
      boss,
      timeZone: "Asia/Riyadh",
      pollIntervalMs: 200,
      jobPollingIntervalSeconds: 0.5,
      log: { info: () => undefined, error: () => undefined },
    });
    const executions = () =>
      api.db
        .selectFrom("automation_execution as e")
        .innerJoin("automation_rule as r", "r.id", "e.automation_rule_id")
        .select(["e.trigger_code", "e.status"])
        .where("r.code", "=", "starter.dependency_slip")
        .where("e.trigger_key", "=", row.idempotency_key)
        .execute();
    const done = await waitFor(async () => {
      const e = await executions();
      return e.length > 0 && e.every((r) => r.status !== "running") ? e : null;
    });
    expect(done.map((e) => [e.trigger_code, e.status])).toEqual([["dependency.slipped", "succeeded"]]);
    const items = await waitFor(async () => {
      const r = await api.db
        .selectFrom("work_item")
        .select(["assignee_user_id"])
        .where("kind", "=", "dependency_slip")
        .where("subject_id", "=", slip.id)
        .execute();
      return r.length > 0 ? r : null;
    });
    expect(items.map((i) => i.assignee_user_id)).toEqual([x.users.bo.id]);

    // A further relay round publishes nothing more, and the execution stays the only one.
    expect(await relayOnce(api.db, boss)).toEqual({ published: 0, failed: 0 });
    const job = await waitFor(async () => {
      const r = await sql<{ state: string }>`SELECT state FROM pgboss.job
        WHERE name = 'portfolio.dependency_slip' AND data->>'idempotencyKey' = ${row.idempotency_key}`.execute(api.db);
      return r.rows.length > 0 && r.rows.every((j) => j.state === "completed") ? r.rows : null;
    });
    expect(job).toHaveLength(1);
    expect((await executions()).length).toBe(1);
  }, 120_000);
});
