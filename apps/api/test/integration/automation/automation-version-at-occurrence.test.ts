// T-DG6-BE-X10 (D-204, extending D-203; BE-X9 handback §6 item 2): a late event is evaluated against the automation
// rule version that was effective AND enabled at its occurrence time, found from the automation_rule_enablement ledger
// (0122, completed by 0123 with disable rows). REAL API (inject), REAL relay and REAL worker (startWorker) on one
// scratch database (the relay publishes every unpublished row of the database it reads, so this file owns it).
//  - 0123 backfill: the scratch database is first migrated only up to 0122; a rule is enabled, disabled and re-enabled
//    through the API (0122 records no disable), and a second rule is enabled then left disabled. Then 0123 is applied:
//    each disable is backfilled from its own audit event, at that event's stored time, with the version that stopped.
//  - Version switch: an event occurs under version N; version N+1 is published BEFORE the event is evaluated. The
//    event is acted on exactly once, by version N (now superseded), also when it is replayed under a new job id; an
//    event that occurs after the publish is acted on by N+1.
//  - Disable/re-enable window: an event under v1, then the rule is disabled, an event occurs in the disabled window,
//    v2 is published while disabled, the rule is re-enabled (on v2), and a third event occurs. Evaluated afterwards:
//    the first by v1, the window event by nobody (D-203), the third by v2.
//  - Kill switch: an event that occurred while the rule was enabled is not acted on when the rule is disabled at
//    evaluation time.
// All data is SYNTHETIC. The rules only create tasks; nothing decides or approves anything (no G1-G6 decision), and
// nothing touches DG0-DG7.
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { defaultMigrationsDir, migrate, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { AUTOMATION_HANDLERS } from "../../../../worker/src/handlers/automation.ts";
import { createBoss, ensureQueues } from "../../../../worker/src/queues/index.ts";
import { startWorker, type RunningWorker } from "../../../../worker/src/worker.ts";
import {
  call,
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
const LAST_BEFORE = "0122"; // the migration this file's scratch database is first migrated to (0123 is under test)

let scratch: string | null = null;
let migDir: string | null = null;
let api: TestApi;
let boss: ReturnType<typeof createBoss>;
let worker: RunningWorker | null = null;
let w: World;
let admin: Session;
let adminId: string;
let office: Session;
let lead: Session;

/** What beforeAll recorded under 0122, for the 0123 backfill test. */
const history = {
  toggled: { id: "", v1: "", disabledAt: new Date(0) },
  stayedOff: { id: "", v1: "", disabledAt: new Date(0) },
  ledgerAt0122: new Map<string, string[]>(),
};

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

function samplePayload(transformationId: string): Record<string, unknown> {
  return {
    transformationId,
    organizationId: w.orgA.id,
    businessUnitId: w.a1,
    mode: "end_to_end",
    entryPhase: null,
    standaloneDeliverableType: null,
    createdBy: w.leadA1.id,
    occurredAt: new Date().toISOString(),
  };
}

async function ruleRow(id: string) {
  return api.db
    .selectFrom("automation_rule")
    .select(["version", "enabled", "effective_version_id"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

async function versionRow(ruleId: string, no: number) {
  return api.db
    .selectFrom("automation_rule_version")
    .select(["id", "status"])
    .where("automation_rule_id", "=", ruleId)
    .where("version_no", "=", no)
    .executeTakeFirstOrThrow();
}

/** Dry-runs, submits, has TO review and publishes version `no` of a rule through the API. */
async function publishVersion(ruleId: string, no: number, sampleTransformationId: string): Promise<void> {
  const url = `${R}/${ruleId}/versions/${no}`;
  const run = await call<Body>(api.app, "POST", `${url}/dry-runs`, {
    session: admin,
    body: { triggerCode: "transformation.created", payload: samplePayload(sampleTransformationId) },
  });
  expect([run.status, run.body.outcome]).toEqual([201, "pass"]);
  expect((await call(api.app, "POST", `${url}/submit`, { session: admin, headers: ifm(1) })).status).toBe(200);
  expect(
    (await call(api.app, "POST", `${url}/review`, { session: office, headers: ifm(2), body: { outcome: "approve" } }))
      .status,
  ).toBe(200);
  const rule = await ruleRow(ruleId);
  expect((await call(api.app, "POST", `${url}/publish`, { session: admin, headers: ifm(rule.version) })).status).toBe(
    200,
  );
}

/** An organization-scoped transformation.created rule with v1 published and enabled, all through the API. */
async function liveRule(sampleTransformationId: string): Promise<{ id: string; v1: string }> {
  const created = await call<Body>(api.app, "POST", R, {
    session: admin,
    body: {
      code: `occurrence.${uniq("o").toLowerCase()}`,
      nameEn: "Synthetic version-at-occurrence rule",
      nameAr: "قاعدة تجريبية لإصدار وقت الحدوث",
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      ownerUserId: adminId,
      content: { triggerCodes: ["transformation.created"], conditions: [], actions: [task], runAs: "service" },
    },
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  await publishVersion(id, 1, sampleTransformationId);
  await enable(id);
  return { id, v1: (await versionRow(id, 1)).id };
}

/** Drafts version `no` (a copy of the effective version) and publishes it, through the API. */
async function publishNextVersion(ruleId: string, no: number, sampleTransformationId: string): Promise<string> {
  const draft = await call<Body>(api.app, "POST", `${R}/${ruleId}/versions`, {
    session: admin,
    headers: ifm((await ruleRow(ruleId)).version),
    body: { changeSummary: `Synthetic version ${no}` },
  });
  expect(draft.status).toBe(201);
  await publishVersion(ruleId, no, sampleTransformationId);
  return (await versionRow(ruleId, no)).id;
}

async function enable(ruleId: string): Promise<void> {
  const r = await ruleRow(ruleId);
  expect(
    (await call(api.app, "POST", `${R}/${ruleId}/enable`, { session: admin, headers: ifm(r.version) })).status,
  ).toBe(200);
}

async function disable(ruleId: string): Promise<void> {
  const r = await ruleRow(ruleId);
  const res = await call(api.app, "POST", `${R}/${ruleId}/disable`, {
    session: admin,
    headers: ifm(r.version),
    body: { reason: "Synthetic pause for the version-at-occurrence test" },
  });
  expect(res.status).toBe(200);
}

const executionsOf = (ruleId: string) =>
  api.db
    .selectFrom("automation_execution")
    .select(["id", "automation_rule_version_id", "trigger_key", "status"])
    .where("automation_rule_id", "=", ruleId)
    .orderBy("started_at")
    .execute();

const ledgerOf = (ruleId: string) =>
  api.db
    .selectFrom("automation_rule_enablement")
    .select(["automation_rule_version_id", "enabled_from", "source"])
    .where("automation_rule_id", "=", ruleId)
    .orderBy("enabled_from")
    .orderBy("id")
    .execute();

interface Ev {
  readonly transformationId: string;
  readonly outboxId: string;
  readonly key: string;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
}

async function createTransformation(name: string): Promise<Ev> {
  const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
    session: lead,
    body: { businessUnitId: w.a1, name, mode: "end_to_end" },
  });
  expect(t.status).toBe(201);
  const ev = await api.db
    .selectFrom("outbox_event")
    .select(["id", "idempotency_key", "schema_version", "payload"])
    .where("event_type", "=", "transformation.created")
    .where("aggregate_id", "=", t.body.id as string)
    .executeTakeFirstOrThrow();
  return {
    transformationId: t.body.id as string,
    outboxId: ev.id,
    key: ev.idempotency_key,
    schemaVersion: ev.schema_version,
    payload: (typeof ev.payload === "string" ? JSON.parse(ev.payload) : ev.payload) as Record<string, unknown>,
  };
}

/** The automation.evaluate jobs of the given outbox events, by state. */
async function evaluateJobStates(outboxIds: readonly string[]): Promise<Record<string, number>> {
  const rows = await sql<{ state: string; n: string }>`
    SELECT state::text AS state, count(*)::text AS n FROM pgboss.job
     WHERE name = ${EVALUATE} AND (data->>'outboxEventId') = ANY (${outboxIds as string[]}::text[])
     GROUP BY state`.execute(api.db);
  return Object.fromEntries(rows.rows.map((r) => [r.state, Number(r.n)]));
}

/** Starts the worker, waits until `expectedJobs` evaluate jobs of the events completed, then stops it. */
async function evaluate(events: readonly Ev[], expectedJobs = events.length): Promise<void> {
  worker = await startWorker({ db: api.db, boss, timeZone: "Asia/Riyadh", handlers: AUTOMATION_HANDLERS });
  try {
    const ids = events.map((e) => e.outboxId);
    await waitFor(
      `${expectedJobs} evaluations`,
      async () => (await evaluateJobStates(ids))["completed"] === expectedJobs,
      120_000,
    );
  } finally {
    await stopWorker();
  }
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_be_x10_occurrence");
  // Up to 0122 only: the history 0123 must backfill is written under 0122's trigger.
  migDir = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "mig-x10-"));
  for (const f of readdirSync(defaultMigrationsDir()))
    if (f.slice(0, 4) <= LAST_BEFORE) cpSync(join(defaultMigrationsDir(), f), join(migDir, f));
  const ownerUrl = roleUrl(adminUrl, scratch, "mth_owner");
  await migrate(ownerUrl, { dir: migDir });
  api = await startApi({ database: scratch });
  boss = createBoss(roleUrl(adminUrl, scratch, "mth_app"), {
    schedule: false,
    supervise: false,
    applicationName: "be-x10-occurrence-boss",
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

  // History under 0122 (no disable rows yet).
  const sample = await createTransformation("Synthetic BE-X10 sample");
  const toggled = await liveRule(sample.transformationId);
  await disable(toggled.id);
  await enable(toggled.id);
  const stayedOff = await liveRule(sample.transformationId);
  await disable(stayedOff.id);
  const disabledAt = async (ruleId: string) =>
    (
      await api.db
        .selectFrom("audit_event")
        .select("occurred_at")
        .where("record_type", "=", "automation_rule")
        .where("record_id", "=", ruleId)
        .where("action", "=", "automation_rule.disable")
        .executeTakeFirstOrThrow()
    ).occurred_at;
  history.toggled = { ...toggled, disabledAt: await disabledAt(toggled.id) };
  history.stayedOff = { ...stayedOff, disabledAt: await disabledAt(stayedOff.id) };
  for (const id of [toggled.id, stayedOff.id])
    history.ledgerAt0122.set(
      id,
      (await ledgerOf(id)).map((l) => l.source),
    );

  // Now 0123 (and every later migration, which this test does not depend on).
  const applied = await migrate(ownerUrl);
  expect(applied[0]).toMatch(/^0123_/);
  expect(applied.slice(1).every((f) => f.slice(0, 4) > "0123")).toBe(true);
}, 180_000);

afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
  if (migDir !== null) rmSync(migDir, { recursive: true, force: true });
}, 60_000);

describe("0123: the enablement ledger records disables, and backfills past ones from their audit events (D-204)", () => {
  it("each disable recorded under 0122 is backfilled at its audit event's time, with the version that stopped", async () => {
    // Under 0122 a disable wrote nothing.
    expect(history.ledgerAt0122.get(history.toggled.id)).toEqual(["enable", "enable"]);
    expect(history.ledgerAt0122.get(history.stayedOff.id)).toEqual(["enable"]);
    const toggled = await ledgerOf(history.toggled.id);
    expect(toggled.map((l) => [l.source, l.automation_rule_version_id])).toEqual([
      ["enable", history.toggled.v1],
      ["backfill_disable", history.toggled.v1],
      ["enable", history.toggled.v1],
    ]);
    // The stored time of the audit event, at full precision (compared in SQL, not through a JS Date).
    const exact = await sql<{ same: boolean }>`
      SELECT bool_and(e.enabled_from = a.occurred_at) AS same
        FROM automation_rule_enablement e
        JOIN audit_event a ON a.record_id = e.automation_rule_id AND a.action = 'automation_rule.disable'
       WHERE e.source = 'backfill_disable' AND e.automation_rule_id IN (${history.toggled.id}, ${history.stayedOff.id})`.execute(
      api.db,
    );
    expect(exact.rows[0]?.same).toBe(true);
    expect(toggled[1]!.enabled_from.getTime()).toBe(history.toggled.disabledAt.getTime());
    const off = await ledgerOf(history.stayedOff.id);
    expect(off.map((l) => [l.source, l.automation_rule_version_id])).toEqual([
      ["enable", history.stayedOff.v1],
      ["backfill_disable", history.stayedOff.v1],
    ]);
  });

  it("after 0123 the trigger writes a disable row (the version that stopped) and nothing for a no-op", async () => {
    const sample = await createTransformation("Synthetic BE-X10 trigger sample");
    const rule = await liveRule(sample.transformationId);
    await disable(rule.id);
    // A second disable is a no-op in the API (no write, no audit) and so writes no row.
    const r = await ruleRow(rule.id);
    const again = await call(api.app, "POST", `${R}/${rule.id}/disable`, {
      session: admin,
      headers: ifm(r.version),
      body: { reason: "Synthetic second pause" },
    });
    expect(again.status).toBe(200);
    expect((await ledgerOf(rule.id)).map((l) => [l.source, l.automation_rule_version_id])).toEqual([
      ["enable", rule.v1],
      ["disable", rule.v1],
    ]);
    // mth_app may read the ledger but never write it (the trigger is the only writer).
    await expect(
      sql`INSERT INTO automation_rule_enablement (id, automation_rule_id, automation_rule_version_id, enabled_from, source)
          VALUES (gen_random_uuid(), ${rule.id}, ${rule.v1}, now(), 'enable')`.execute(api.db),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("a late event is evaluated by the rule version in force at its occurrence (D-204)", () => {
  it("an event under v1, v2 published before evaluation: acted on exactly once, by v1, also when replayed", async () => {
    const sample = await createTransformation("Synthetic BE-X10 switch sample");
    const rule = await liveRule(sample.transformationId);
    const underV1 = await createTransformation("Synthetic BE-X10 event under v1");
    const v2 = await publishNextVersion(rule.id, 2, sample.transformationId);
    const underV2 = await createTransformation("Synthetic BE-X10 event under v2");
    expect((await versionRow(rule.id, 1)).status).toBe("superseded");
    expect((await ledgerOf(rule.id)).map((l) => [l.source, l.automation_rule_version_id])).toEqual([
      ["enable", rule.v1],
      ["effective_version", v2],
    ]);

    // Evaluated only now, after v2 was published (the sample event, before the rule existed, is never acted on).
    await evaluate([sample, underV1, underV2]);
    const execs = await executionsOf(rule.id);
    expect(execs.map((x) => [x.trigger_key, x.automation_rule_version_id]).sort()).toEqual(
      [
        [underV1.key, rule.v1],
        [underV2.key, v2],
      ].sort(),
    );
    expect(execs.every((x) => x.status !== "running")).toBe(true);

    // A replay of the v1 event (a redelivery: a new job id, the same envelope) resolves v1 again: still one execution.
    await boss.send(EVALUATE, {
      outboxEventId: underV1.outboxId,
      eventType: "transformation.created",
      schemaVersion: underV1.schemaVersion,
      idempotencyKey: underV1.key,
      organizationId: w.orgA.id,
      payload: underV1.payload,
    });
    await evaluate([underV1], 2);
    const after = await executionsOf(rule.id);
    expect(after.filter((x) => x.trigger_key === underV1.key).map((x) => x.automation_rule_version_id)).toEqual([
      rule.v1,
    ]);
    expect(after).toHaveLength(2);
    // One action result per execution: the v1 event's action ran once.
    const results = await api.db
      .selectFrom("automation_action_result")
      .select(["automation_execution_id"])
      .where(
        "automation_execution_id",
        "in",
        after.map((x) => x.id),
      )
      .execute();
    expect(results).toHaveLength(2);
    await disable(rule.id);
  }, 240_000);

  it("disable/re-enable window across a version switch: v1 event by v1, window event by nobody, later event by v2", async () => {
    const sample = await createTransformation("Synthetic BE-X10 window sample");
    const rule = await liveRule(sample.transformationId);
    const beforePause = await createTransformation("Synthetic BE-X10 event before the pause");
    await disable(rule.id);
    const inWindow = await createTransformation("Synthetic BE-X10 event while disabled");
    const v2 = await publishNextVersion(rule.id, 2, sample.transformationId); // published while disabled
    await enable(rule.id);
    const afterResume = await createTransformation("Synthetic BE-X10 event after re-enabling");
    expect((await ledgerOf(rule.id)).map((l) => [l.source, l.automation_rule_version_id])).toEqual([
      ["enable", rule.v1],
      ["disable", rule.v1],
      ["enable", v2],
    ]);

    await evaluate([sample, beforePause, inWindow, afterResume]);
    const execs = await executionsOf(rule.id);
    expect(execs.map((x) => [x.trigger_key, x.automation_rule_version_id]).sort()).toEqual(
      [
        [beforePause.key, rule.v1],
        [afterResume.key, v2],
      ].sort(),
    );
    expect(execs.map((x) => x.trigger_key)).not.toContain(inWindow.key);
    await disable(rule.id);
  }, 240_000);

  it("kill switch: an event that occurred while enabled is not acted on when the rule is disabled at evaluation", async () => {
    const sample = await createTransformation("Synthetic BE-X10 kill-switch sample");
    const rule = await liveRule(sample.transformationId);
    const whileOn = await createTransformation("Synthetic BE-X10 event while enabled");
    await disable(rule.id);
    await evaluate([sample, whileOn]);
    expect(await executionsOf(rule.id)).toEqual([]);
  }, 240_000);
});
