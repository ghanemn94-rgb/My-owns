// T-DG6-BE-X9 (D-203; QA-H handback §6 O-1, O-2): the automation engine under a backlog, with the REAL API (inject),
// the REAL relay and the REAL worker (startWorker) on one scratch database (the relay publishes every unpublished row of
// the database it reads, so this file owns its database).
//  - O-2, enablement time (D-203: "an automation rule applies only to events that occurred at or after the moment its
//    effective version became enabled"): QA-H's reproduction. 12 transformation.created events are written with NO
//    worker running, THEN an organization-scoped transformation.created rule is enabled, THEN the worker relays and
//    evaluates them: 0 executions for the 12 older events; one new event after the enabling yields exactly 1 execution.
//    The comparison uses the event's stored occurrence time (outbox_event.created_at), never the evaluation time: the
//    12 older events are evaluated AFTER the rule was enabled and still do not match. Disabling and re-enabling moves
//    the moment forward (an event of the disabled window is never acted on), and an envelope with no outbox row has an
//    unknown occurrence time: the job throws, and nothing is executed.
//  - O-1, throughput (D-203 "process a bounded batch per fetch with bounded concurrency, keep exactly-once"): a backlog
//    of 240 automation.evaluate jobs on one queue drains with the default batch (8) and concurrency (4); each event gets
//    exactly one execution and one task, also when 60 replays of 20 events (new job ids, the same idempotency keys) run
//    concurrently with them (ADR-0043: UNIQUE (rule version, trigger key) under lock 730258, action keys). The
//    measured jobs/s is printed (the handback reports it). The bound is load-tolerant: the 300 jobs within 180 s, where
//    the batch-of-one worker needs at least 2 s per job (600 s); a quiet host drains them in well under a minute.
// All data is SYNTHETIC. No rule decides or approves anything (create_task only), and nothing touches DG0-DG7.
import { migrate, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { OCCURRENCE_UNKNOWN } from "../../../../worker/src/automation/engine.ts";
import { AUTOMATION_HANDLERS } from "../../../../worker/src/handlers/automation.ts";
import { createBoss, ensureQueues } from "../../../../worker/src/queues/index.ts";
import { relayOnce } from "../../../../worker/src/relay.ts";
import { startWorker, type RunningWorker } from "../../../../worker/src/worker.ts";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const R = "/api/v1/admin/automation-rules";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const EVALUATE = "automation.evaluate";

let scratch: string | null = null;
let api: TestApi;
let boss: ReturnType<typeof createBoss>;
let worker: RunningWorker | null = null;
let w: World;
let admin: Session;
let adminId: string;
let office: Session;
let lead: Session;

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 60_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`waitFor: timed out (${what})`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function stopWorker(): Promise<void> {
  await worker?.stop();
  worker = null;
}

const task = { type: "create_task", parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up" } };

/** Creates, dry-runs, submits, has TO review, publishes and enables an admin rule through the API. */
async function liveRule(
  triggerCode: string,
  samplePayload: Record<string, unknown>,
): Promise<{ id: string; code: string }> {
  const code = `backlog.${uniq("b").toLowerCase()}`;
  const created = await call<Body>(api.app, "POST", R, {
    session: admin,
    body: {
      code,
      nameEn: "Synthetic backlog rule",
      nameAr: "قاعدة تراكم تجريبية",
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      ownerUserId: adminId,
      content: { triggerCodes: [triggerCode], conditions: [], actions: [task], runAs: "service" },
    },
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const v1 = `${R}/${id}/versions/1`;
  const run = await call<Body>(api.app, "POST", `${v1}/dry-runs`, {
    session: admin,
    body: { triggerCode, payload: samplePayload },
  });
  expect([run.status, run.body.outcome]).toEqual([201, "pass"]);
  expect((await call(api.app, "POST", `${v1}/submit`, { session: admin, headers: ifm(1) })).status).toBe(200);
  expect(
    (await call(api.app, "POST", `${v1}/review`, { session: office, headers: ifm(2), body: { outcome: "approve" } }))
      .status,
  ).toBe(200);
  expect((await call(api.app, "POST", `${v1}/publish`, { session: admin, headers: ifm(1) })).status).toBe(200);
  expect((await call(api.app, "POST", `${R}/${id}/enable`, { session: admin, headers: ifm(2) })).status).toBe(200);
  return { id, code };
}

const executionsOf = (ruleId: string) =>
  api.db.selectFrom("automation_execution").selectAll().where("automation_rule_id", "=", ruleId).execute();

async function createTransformation(name: string): Promise<{ id: string; key: string }> {
  const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: lead,
    body: { businessUnitId: w.a1, name, mode: "end_to_end" },
  });
  expect(t.status).toBe(201);
  const ev = await api.db
    .selectFrom("outbox_event")
    .select("idempotency_key")
    .where("event_type", "=", "transformation.created")
    .where("aggregate_id", "=", t.body.id as string)
    .executeTakeFirstOrThrow();
  return { id: t.body.id as string, key: ev.idempotency_key };
}

/** The automation.evaluate jobs of the given outbox events, by state. */
async function evaluateJobStates(outboxIds: readonly string[]): Promise<Record<string, number>> {
  const rows = await sql<{ state: string; n: string }>`
    SELECT state::text AS state, count(*)::text AS n FROM pgboss.job
     WHERE name = ${EVALUATE} AND (data->>'outboxEventId') = ANY (${outboxIds as string[]}::text[])
     GROUP BY state`.execute(api.db);
  return Object.fromEntries(rows.rows.map((r) => [r.state, Number(r.n)]));
}

async function relayAll(): Promise<void> {
  for (;;) {
    const r = await relayOnce(api.db, boss);
    if (r.published === 0) return;
  }
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_x9_backlog");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  api = await startApi({ database: scratch });
  boss = createBoss(roleUrl(adminUrl, scratch, "mth_app"), {
    schedule: false,
    supervise: false,
    applicationName: "be-x9-backlog-boss",
  });
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
  w = await seedWorld(api.db);
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  office = await signIn(api.app, w.office.subject);
  lead = await signIn(api.app, w.leadA1.subject);
}, 120_000);

afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("O-2: a rule applies only to events that occurred at or after its effective version became enabled (D-203)", () => {
  it("12 events written with no worker, then the rule enabled: 0 executions for them; a new event after enabling: 1", async () => {
    const older: { id: string; key: string }[] = [];
    for (let i = 1; i <= 12; i += 1) older.push(await createTransformation(`Synthetic BE-X9 older event ${i}`));
    const rule = await liveRule("transformation.created", {
      transformationId: older[0]!.id,
      organizationId: w.orgA.id,
      businessUnitId: w.a1,
      mode: "end_to_end",
      entryPhase: null,
      standaloneDeliverableType: null,
      createdBy: w.leadA1.id,
      occurredAt: new Date().toISOString(),
    });
    // The enabling is recorded with its own time, after every older event's stored occurrence time.
    const ledger = await api.db
      .selectFrom("automation_rule_enablement")
      .selectAll()
      .where("automation_rule_id", "=", rule.id)
      .execute();
    expect(ledger.map((l) => l.source)).toEqual(["enable"]);
    const olderOutbox = await api.db
      .selectFrom("outbox_event")
      .select(["id", "created_at"])
      .where(
        "idempotency_key",
        "in",
        older.map((o) => o.key),
      )
      .execute();
    expect(olderOutbox).toHaveLength(12);
    for (const o of olderOutbox) expect(o.created_at.getTime()).toBeLessThanOrEqual(ledger[0]!.enabled_from.getTime());

    // Now the worker starts: the 12 older events are relayed and evaluated AFTER the rule was enabled.
    worker = await startWorker({ db: api.db, boss, timeZone: "Asia/Riyadh", handlers: AUTOMATION_HANDLERS });
    const olderIds = olderOutbox.map((o) => o.id);
    await waitFor("the 12 older evaluations", async () => (await evaluateJobStates(olderIds))["completed"] === 12);
    expect(await executionsOf(rule.id)).toEqual([]);

    const fresh = await createTransformation("Synthetic BE-X9 event after enabling");
    const [exec, ...more] = await waitFor("the new event's execution", async () => {
      const e = await executionsOf(rule.id);
      return e.length > 0 && e.every((x) => x.status !== "running") ? e : null;
    });
    expect(more).toEqual([]);
    expect(exec).toMatchObject({ trigger_code: "transformation.created", trigger_key: fresh.key });
    // The 12 older events still have none, also after the new one was handled.
    expect((await executionsOf(rule.id)).map((x) => x.trigger_key)).toEqual([fresh.key]);
    await stopWorker();
  }, 180_000);

  it("disable then re-enable: an event of the disabled window is never acted on; one after re-enabling is", async () => {
    const t0 = await createTransformation("Synthetic BE-X9 sample");
    const rule = await liveRule("transformation.created", {
      transformationId: t0.id,
      organizationId: w.orgA.id,
      businessUnitId: w.a1,
      mode: "end_to_end",
      entryPhase: null,
      standaloneDeliverableType: null,
      createdBy: w.leadA1.id,
      occurredAt: new Date().toISOString(),
    });
    const disable = await call(api.app, "POST", `${R}/${rule.id}/disable`, {
      session: admin,
      headers: ifm(3),
      body: { reason: "Synthetic pause for the enablement test" },
    });
    expect(disable.status).toBe(200);
    const inWindow = await createTransformation("Synthetic BE-X9 event while disabled");
    expect((await call(api.app, "POST", `${R}/${rule.id}/enable`, { session: admin, headers: ifm(4) })).status).toBe(
      200,
    );
    const ledger = await api.db
      .selectFrom("automation_rule_enablement")
      .select("source")
      .where("automation_rule_id", "=", rule.id)
      .orderBy("enabled_from")
      .execute();
    // 0123 (T-DG6-BE-X10, D-204) also records the disable, so the ledger holds the whole interval history.
    expect(ledger.map((l) => l.source)).toEqual(["enable", "disable", "enable"]);
    const after = await createTransformation("Synthetic BE-X9 event after re-enabling");

    worker = await startWorker({ db: api.db, boss, timeZone: "Asia/Riyadh", handlers: AUTOMATION_HANDLERS });
    const ids = (
      await api.db
        .selectFrom("outbox_event")
        .select("id")
        .where("idempotency_key", "in", [t0.key, inWindow.key, after.key])
        .execute()
    ).map((r) => r.id);
    await waitFor("the three evaluations", async () => (await evaluateJobStates(ids))["completed"] === 3);
    const execs = await waitFor("the re-enabled rule's execution", async () => {
      const e = await executionsOf(rule.id);
      return e.length > 0 && e.every((x) => x.status !== "running") ? e : null;
    });
    expect(execs.map((x) => x.trigger_key)).toEqual([after.key]);
    await stopWorker();
  }, 180_000);

  it("an envelope without its outbox row has an unknown occurrence time: the job throws and nothing is executed", async () => {
    const handler = AUTOMATION_HANDLERS.find((h) => h.queue === EVALUATE)!;
    const before = await api.db
      .selectFrom("automation_execution")
      .select(sql<string>`count(*)::text`.as("n"))
      .executeTakeFirstOrThrow();
    const envelope = {
      outboxEventId: crypto.randomUUID(),
      eventType: "transformation.created",
      schemaVersion: 2,
      idempotencyKey: `transformation.created:${crypto.randomUUID()}`,
      organizationId: w.orgA.id,
      payload: { transformationId: crypto.randomUUID() },
    };
    await expect(handler.handle(api.db, envelope, "job-unknown", { retryCount: 0, retryLimit: 5 })).rejects.toThrow(
      OCCURRENCE_UNKNOWN,
    );
    const after = await api.db
      .selectFrom("automation_execution")
      .select(sql<string>`count(*)::text`.as("n"))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});

describe("O-1: a backlog on one queue drains in bounded batches with bounded concurrency, exactly once (D-203)", () => {
  it("240 automation.evaluate jobs plus 60 concurrent replays: one execution and one task per event", async () => {
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
    // One TL of the target transformation: each execution's create_task makes exactly one task.
    const tl = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, tl.id, "TL", { type: "transformation", id: tx }, w.orgA.id);
    const payload = () => ({
      gateInstanceId: crypto.randomUUID(),
      transformationId: tx,
      gateCode: "G3",
      submissionId: crypto.randomUUID(),
      submissionNo: 1,
      gateDecisionId: crypto.randomUUID(),
      outcome: "approved",
      decidedBy: crypto.randomUUID(),
      nextPhase: null,
      scaleScopeItemIds: [],
      conditionIds: [],
    });
    const rule = await liveRule("gate.decided", payload());
    // The backlog: 240 gate.decided outbox rows, as the API writes them, relayed with no worker running.
    const N = 240;
    const rows = Array.from({ length: N }, () => {
      const id = crypto.randomUUID();
      return {
        id,
        organization_id: w.orgA.id,
        aggregate_type: "gate_instance",
        aggregate_id: crypto.randomUUID(),
        event_type: "gate.decided",
        schema_version: 1,
        payload: JSON.stringify(payload()),
        idempotency_key: `gate.decided:${id}`,
      };
    });
    await api.db.insertInto("outbox_event").values(rows).execute();
    await relayAll();
    const ids = rows.map((r) => r.id);
    expect(await evaluateJobStates(ids)).toEqual({ created: N });

    // 60 replays of 20 events under NEW job ids (a redelivery), queued with the backlog.
    const replayed = rows.slice(0, 20);
    for (let i = 0; i < 3; i += 1)
      for (const r of replayed)
        await boss.send(EVALUATE, {
          outboxEventId: r.id,
          eventType: "gate.decided",
          schemaVersion: 1,
          idempotencyKey: r.idempotency_key,
          organizationId: w.orgA.id,
          payload: JSON.parse(r.payload) as Record<string, unknown>,
        });

    const started = Date.now();
    worker = await startWorker({ db: api.db, boss, timeZone: "Asia/Riyadh", handlers: AUTOMATION_HANDLERS });
    const deadlineMs = Number(process.env["MTH_X9_BACKLOG_DEADLINE_MS"] ?? 180_000);
    // Every job of the queue's backlog: the 240 relayed jobs and the 60 replays (which share their outbox ids).
    const total = N + 60;
    let done = 0;
    try {
      await waitFor(
        "the backlog",
        async () => {
          done = (await evaluateJobStates(ids))["completed"] ?? 0;
          return done === total;
        },
        deadlineMs,
      );
    } finally {
      const seconds = (Date.now() - started) / 1000;
      console.log(
        JSON.stringify({
          measurement: "automation.evaluate backlog (T-DG6-BE-X9)",
          backlogJobs: total,
          completedJobs: done,
          seconds,
          jobsPerSecond: Number((done / seconds).toFixed(2)),
        }),
      );
    }
    await stopWorker();

    const execs = await executionsOf(rule.id);
    expect(execs).toHaveLength(N);
    expect(new Set(execs.map((x) => x.trigger_key)).size).toBe(N);
    expect(execs.every((x) => x.status === "succeeded")).toBe(true);
    const tasks = await api.db
      .selectFrom("work_item")
      .select("subject_id")
      .where("subject_type", "=", "automation_execution")
      .where(
        "subject_id",
        "in",
        execs.map((x) => x.id),
      )
      .execute();
    expect(tasks).toHaveLength(N);
    expect(new Set(tasks.map((t) => t.subject_id)).size).toBe(N);
  }, 300_000);
});
