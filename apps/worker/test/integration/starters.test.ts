// The sixteen starters as versioned rules, worker side (T-DG5-BE-J; ADR-0044 §1, §2; D-142 R3; p5-work-split §E.1)
// against a fresh, migrated PostgreSQL:
//  - REQ-S12-001: every event and schedule starter registered on its DG4 queue records ONE execution per trigger
//    occurrence naming its rule's effective version, the trigger event (code and key) and the outcome, with one
//    `starter_handler` action result; its output is the DG4 handler's own (the wrapped registration returns exactly
//    what the unwrapped DG4 handler returns for the same occurrence);
//  - REQ-S12-021 / R3: replaying each occurrence three times creates nothing more (one execution, one result; the DG4
//    handler's own ledger answers `duplicate`), keeping the handler's queue, consumer and runOnce key;
//  - the last failed attempt finishes the execution `failed` (automation.retries_exhausted) and rethrows; the job's
//    failure-queue retry (same slot key) resumes the SAME execution at attempt 2;
//  - REQ-S12-004 (worker part): one transformation -> one set of entry-phase checklist rows and one role task per
//    unassigned source role (SP, BO, WL, FIN, TO) to the creator; a retry or replay x3 creates no duplicates; the due
//    date is Unknown (null) without a business calendar; the v2 `launchPlan` reaches the launch-plan port with the
//    start date and the key `launch_plan:<id>` (the no-op default until BE-P).
// Every value is SYNTHETIC. No starter decides an approval; nothing touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { insertAuditEvent } from "@mth/db";
import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerLaunchPlanPort, type LaunchPlanRequest } from "../../src/automation/ports/launch-plan.ts";
import { workerLaunchPlanGenerator } from "../../src/automation/ports/launch-plan-generator.ts";
import { runAsStarter, STARTER_RULE_BY_QUEUE, starterOutcome, withStarterRule } from "../../src/automation/starters.ts";
import { DOMAIN_HANDLERS, handleTransformationCreated } from "../../src/handlers/index.ts";
import { handleTransformationCreated as dg4TransformationCreated } from "../../src/handlers/platform.ts";
import { APPROVALS_HANDLERS } from "../../src/handlers/approvals.ts";
import { AUTOMATION_HANDLERS } from "../../src/handlers/automation.ts";
import { ADOPTION_HANDLERS } from "../../src/handlers/adoption.ts";
import { BENEFITS_HANDLERS } from "../../src/handlers/benefits.ts";
import { ESCALATIONS_HANDLERS } from "../../src/handlers/escalations.ts";
import { GATES_HANDLERS } from "../../src/handlers/gates.ts";
import { KPI_HANDLERS } from "../../src/handlers/kpi.ts";
import { PORTFOLIO_HANDLERS } from "../../src/handlers/portfolio.ts";
import { RAID_HANDLERS } from "../../src/handlers/raid.ts";
import { SUSTAINMENT_HANDLERS } from "../../src/handlers/sustainment.ts";
import type { JobHandler } from "../../src/handlers/spec.ts";
import { failureRetryJobId } from "../../src/kit.ts";
import { ensureQueues } from "../../src/queues/index.ts";
import { bossFor, seedTransformationWithOutbox, workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
let boss: PgBoss;
let org: string;
let tx: string;
let user: string;
let kpiId: string;
let benefitId: string;
let periodId: string;

const fixtureActor = () =>
  ({ actorType: "user", actorUserId: user, requestId: `fixture-${randomUUID()}`, source: "api" }) as const;

/** A KPI definition and a benefit of the seeded transformation (direct writes with their audit events; synthetic). */
async function seedRecords(): Promise<void> {
  kpiId = randomUUID();
  benefitId = randomUUID();
  periodId = randomUUID();
  await env.db.transaction().execute(async (t) => {
    await t
      .insertInto("reporting_period")
      .values({
        id: periodId,
        organization_id: org,
        frequency: "monthly",
        period_label: "2026-09",
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        created_by: user,
        updated_by: user,
      })
      .execute();
    await insertAuditEvent(t, fixtureActor(), {
      action: "reporting_period.create",
      recordType: "reporting_period",
      recordId: periodId,
      organizationId: org,
      newVersion: 1,
    });
    await t
      .insertInto("kpi_definition")
      .values({
        id: kpiId,
        organization_id: org,
        transformation_id: tx,
        name: "Synthetic KPI",
        unit_kind: "count",
        unit_label: "lines",
        polarity: "higher_is_better",
        frequency: "monthly",
        status: "active",
        owner_user_id: user,
        created_by: user,
        updated_by: user,
      })
      .execute();
    await insertAuditEvent(t, fixtureActor(), {
      action: "kpi_definition.create",
      recordType: "kpi_definition",
      recordId: kpiId,
      organizationId: org,
      transformationId: tx,
      newVersion: 1,
    });
    await t
      .insertInto("benefit")
      .values({
        id: benefitId,
        organization_id: org,
        transformation_id: tx,
        code: "B01",
        title: "Synthetic opex saving",
        description: "Synthetic benefit for the starter regression test",
        benefit_type: "cost",
        value_class: "cash_saving",
        owner_user_id: user,
        financial_statement_line: "Synthetic opex",
        currency: "SAR",
        created_by: user,
        updated_by: user,
      })
      .execute();
    await insertAuditEvent(t, fixtureActor(), {
      action: "benefit.create",
      recordType: "benefit",
      recordId: benefitId,
      organizationId: org,
      transformationId: tx,
      newVersion: 1,
    });
  });
}

beforeAll(async () => {
  env = await workerEnv();
  boss = bossFor(env.appUrl);
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
  const seed = await seedTransformationWithOutbox(env.db);
  tx = seed.transformationId;
  user = seed.userId;
  org = (
    await env.db.selectFrom("transformation").select("organization_id").where("id", "=", tx).executeTakeFirstOrThrow()
  ).organization_id;
  await seedRecords();
}, 120_000);
afterAll(async () => {
  registerLaunchPlanPort(null);
  await boss.stop({ graceful: false, wait: true, timeout: 5000 });
  await env.close();
});

const envelope = (eventType: string, payload: Record<string, unknown>, key = `${eventType}:${randomUUID()}`) => ({
  outboxEventId: randomUUID(),
  eventType,
  schemaVersion: 1,
  idempotencyKey: key,
  organizationId: org,
  payload,
});

/** Generated identifiers (a run id, a case id) differ between two runs by construction; everything else must match. */
const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const masked = (v: unknown) => JSON.parse(JSON.stringify(v ?? null).replace(UUID_TEXT, "<uuid>")) as unknown;

/** The DG4 (unwrapped) registration of a queue, from its domain's own list. */
const DG4: readonly JobHandler[] = [
  ...APPROVALS_HANDLERS,
  ...KPI_HANDLERS,
  ...BENEFITS_HANDLERS,
  ...RAID_HANDLERS,
  ...ESCALATIONS_HANDLERS,
  ...ADOPTION_HANDLERS,
  ...SUSTAINMENT_HANDLERS,
  ...GATES_HANDLERS,
  ...AUTOMATION_HANDLERS,
  ...PORTFOLIO_HANDLERS,
];
const dg4 = (queue: string) => DG4.find((h) => h.queue === queue)!;
const wrapped = (queue: string) => DOMAIN_HANDLERS.find((h) => h.queue === queue)!;

const executionsOf = (ruleCode: string, triggerKey: string) =>
  env.db
    .selectFrom("automation_execution as e")
    .innerJoin("automation_rule as r", "r.id", "e.automation_rule_id")
    .select([
      "e.id",
      "e.automation_rule_version_id",
      "e.trigger_code",
      "e.trigger_key",
      "e.status",
      "e.attempt_no",
      "e.error_code",
      "e.organization_id",
    ])
    .where("r.code", "=", ruleCode)
    .where("e.trigger_key", "=", triggerKey)
    .execute();
const resultsOf = (executionId: string) =>
  env.db
    .selectFrom("automation_action_result")
    .select(["attempt_no", "ordinal", "action_type", "outcome", "idempotency_key", "error_code"])
    .where("automation_execution_id", "=", executionId)
    .orderBy("attempt_no")
    .execute();
const effectiveVersion = async (ruleCode: string) =>
  (
    await env.db
      .selectFrom("automation_rule")
      .select("effective_version_id")
      .where("code", "=", ruleCode)
      .executeTakeFirstOrThrow()
  ).effective_version_id!;

/** Every event starter queue with a synthetic DG4 occurrence (ids that name no record: the handlers' own no-op paths). */
const EVENT_CASES: readonly { queue: string; eventType: string; payload: () => Record<string, unknown> }[] = [
  {
    queue: "kpi.recalculate",
    eventType: "kpi.actual_accepted",
    payload: () => ({
      kpiActualId: randomUUID(),
      valueNo: 1,
      kpiDefinitionId: randomUUID(),
      transformationId: tx,
      scopeKind: "transformation",
      scopeId: tx,
      reportingPeriodId: randomUUID(),
    }),
  },
  {
    queue: "benefits.recalculate_pending",
    eventType: "kpi.values_recalculated",
    payload: () => ({ runId: randomUUID(), transformationId: tx, kpiDefinitionIds: [], reportingPeriodId: null }),
  },
  {
    queue: "raid.corrective_kpi",
    eventType: "kpi.deviation_evaluated",
    payload: () => ({
      evaluationId: randomUUID(),
      transformationId: tx,
      kpiDefinitionId: kpiId,
      scopeKind: "transformation",
      scopeId: tx,
      reportingPeriodId: periodId,
      calculatedRag: "green",
      deviation: "within",
      previousCalculatedRag: null,
    }),
  },
  {
    queue: "raid.corrective_benefit",
    eventType: "benefit.variance_evaluated",
    payload: () => ({
      benefitId,
      measurementId: randomUUID(),
      periodStart: "2026-07-01",
      periodEnd: "2026-09-30",
      plannedAmount: null,
      measuredAmount: null,
      variance: null,
      offTrack: null,
    }),
  },
  {
    queue: "raid.corrective_adoption",
    eventType: "adoption.check_failed",
    payload: () => ({
      checkId: randomUUID(),
      checkRecordType: "adoption_check",
      transformationId: tx,
      ownerUserId: user,
      subjectLabel: "Synthetic adoption check",
      failedAt: "2026-10-14T09:00:00.000Z",
      businessDate: "2026-10-14",
    }),
  },
  {
    queue: "raid.corrective_control",
    eventType: "control_check.failed",
    payload: () => ({
      checkId: randomUUID(),
      checkRecordType: "control_check",
      transformationId: tx,
      ownerUserId: user,
      subjectLabel: "Synthetic control check",
      failedAt: "2026-10-14T09:00:00.000Z",
      businessDate: "2026-10-14",
    }),
  },
  {
    queue: "benefits.finance_queue",
    eventType: "benefit.evidence_submitted",
    payload: () => ({ benefitId: randomUUID(), measurementId: randomUUID(), transformationId: tx }),
  },
  {
    queue: "automation.job_failed",
    eventType: "job.failed",
    payload: () => ({ queueName: "kpi.recalculate", jobScheduleCode: null, failureId: randomUUID() }),
  },
  {
    queue: "portfolio.dependency_slip",
    eventType: "dependency.slipped",
    payload: () => ({ slipId: randomUUID(), dependencyId: randomUUID(), transformationId: tx, slipDays: 5 }),
  },
];

/** Every schedule starter queue (job_schedule rows of DG4); each scan runs over the fresh database. */
const SCHEDULE_QUEUES = [
  "kpi.reporting_period_open",
  "governance.decision_sla_scan",
  "approval.escalation_scan",
  "governance.blocker_escalation_scan",
  "sustainment.review_scan",
  "sustainment.control_check_scan",
] as const;

describe("registration (ADR-0044 §1; D-142 R3)", () => {
  it("every starter queue with a registered handler is wrapped on its OWN queue; every other handler is untouched", () => {
    const queues = new Map(Object.entries(STARTER_RULE_BY_QUEUE));
    for (const h of DOMAIN_HANDLERS) {
      const original = DG4.find((d) => d.queue === h.queue);
      if (!queues.has(h.queue) && original !== undefined) expect(h, h.queue).toBe(original);
      if (queues.has(h.queue)) expect(h, h.queue).not.toBe(original);
    }
    // Starters 2-4, 6-11, 13, 14 (scans), 16: each mapped queue that has a handler is registered exactly once.
    const registered = DOMAIN_HANDLERS.map((h) => h.queue).filter((q) => queues.has(q));
    expect(new Set(registered).size).toBe(registered.length);
    // Not registered here: transformation.created (worker.ts wires it through handlers/index.ts) and, until BE-L2
    // registers its handler (REQ-S12-015), governance.meeting_cutoff_scan, which is then wrapped automatically.
    const unregistered = [...queues.keys()].filter((q) => !registered.includes(q));
    expect(unregistered).toContain("transformation.created");
    for (const q of unregistered) expect(["transformation.created", "governance.meeting_cutoff_scan"], q).toContain(q);
    // The rule codes are the sixteen seeded starters minus the three request starters (5, 14's accept, 15).
    expect(new Set(queues.values()).size).toBe(14);
  });

  it("starterOutcome: duplicate -> existing, skipped -> skipped, anything else -> done", () => {
    expect(
      [
        "duplicate",
        "skipped",
        "done",
        { outcome: "duplicate" },
        { outcome: "skipped", n: 1 },
        { outcome: "done" },
        { scanned: 3 },
        [1],
        null,
      ].map(starterOutcome),
    ).toEqual(["existing", "skipped", "done", "existing", "skipped", "done", "done", "done", "done"]);
  });
});

describe("REQ-S12-001 / REQ-S12-021: each event starter, recorded once, output unchanged, replay x3 adds nothing", () => {
  for (const c of EVENT_CASES) {
    it(`${STARTER_RULE_BY_QUEUE[c.queue]} on ${c.queue} (${c.eventType})`, async () => {
      const ruleCode = STARTER_RULE_BY_QUEUE[c.queue]!;
      const payload = c.payload();
      // DG4 output for the occurrence, unwrapped, under its own key; then the wrapped registration under a fresh key.
      // The baseline gets its own occurrence (a handler may dedupe on a payload id as well as on the key).
      const dg4Occurrence = envelope(c.eventType, c.payload());
      const expected = await dg4(c.queue).handle(env.db, dg4Occurrence, `dg4-${randomUUID()}`);
      const expectedReplay = await dg4(c.queue).handle(env.db, dg4Occurrence, `dg4-replay-${randomUUID()}`);
      const occurrence = envelope(c.eventType, payload);
      const first = await wrapped(c.queue).handle(env.db, occurrence, `wrap-${randomUUID()}`, {
        retryCount: 0,
        retryLimit: 5,
      });
      expect(masked(first)).toEqual(masked(expected));
      const replays = [];
      for (let i = 0; i < 3; i += 1)
        replays.push(await wrapped(c.queue).handle(env.db, occurrence, `replay-${i}-${randomUUID()}`));
      const execs = await executionsOf(ruleCode, occurrence.idempotencyKey);
      expect(execs).toHaveLength(1);
      expect(execs[0]).toMatchObject({
        automation_rule_version_id: await effectiveVersion(ruleCode),
        trigger_code: c.eventType,
        trigger_key: occurrence.idempotencyKey,
        status: "succeeded",
        attempt_no: 1,
        error_code: null,
        organization_id: org,
      });
      const results = await resultsOf(execs[0]!.id);
      expect(results).toEqual([
        {
          attempt_no: 1,
          ordinal: 1,
          action_type: "starter_handler",
          outcome: starterOutcome(first),
          idempotency_key: `automation:${ruleCode}:${occurrence.idempotencyKey}:1`,
          error_code: null,
        },
      ]);
      // The replays are the DG4 handler's own replays (its ledger answers), never a second execution.
      for (const r of replays) expect(masked(r)).toEqual(masked(expectedReplay));
    });
  }
});

describe("REQ-S12-001 / REQ-S12-021: each schedule starter, one execution per slot, output unchanged", () => {
  for (const queue of SCHEDULE_QUEUES) {
    it(`${STARTER_RULE_BY_QUEUE[queue]} on ${queue}`, async () => {
      const ruleCode = STARTER_RULE_BY_QUEUE[queue]!;
      // A scan's output depends on the state it finds: the DG4 baseline runs until steady (its own work done), and the
      // wrapped run must then return exactly what the DG4 handler returns in that same state.
      await dg4(queue).handle(env.db, {}, `dg4-${randomUUID()}`);
      const expected = await dg4(queue).handle(env.db, {}, `dg4-${randomUUID()}`);
      // A real pg-boss job of the queue: its createdOn is the slot (as BE-I's failure capture keys it).
      const jobId = (await boss.send(queue, {}, { startAfter: 3600 }))!;
      const created = (
        await env.owner.query<{ created_on: Date }>("SELECT created_on FROM pgboss.job WHERE id = $1", [jobId])
      ).rows[0]!.created_on;
      const schedule = (
        await env.db.selectFrom("job_schedule").select("code").where("queue_name", "=", queue).executeTakeFirstOrThrow()
      ).code;
      const triggerKey = `${schedule}:${created.toISOString().slice(0, 16)}`;
      const first = await wrapped(queue).handle(env.db, {}, jobId, { retryCount: 0, retryLimit: 5 });
      expect(first).toEqual(expected);
      for (let i = 0; i < 3; i += 1) await wrapped(queue).handle(env.db, {}, jobId);
      const execs = await executionsOf(ruleCode, triggerKey);
      expect(execs).toHaveLength(1);
      expect(execs[0]).toMatchObject({
        automation_rule_version_id: await effectiveVersion(ruleCode),
        trigger_code: schedule,
        status: "succeeded",
        organization_id: null,
      });
      expect(await resultsOf(execs[0]!.id)).toHaveLength(1);
      await boss.cancel(queue, jobId);
    });
  }
});

describe("failure on the last attempt; the failure-queue retry resumes the same execution", () => {
  it("failed (automation.retries_exhausted) then attempt 2 succeeded; nothing duplicated", async () => {
    const queue = "kpi.recalculate";
    const ruleCode = STARTER_RULE_BY_QUEUE[queue]!;
    const occurrence = envelope("kpi.actual_accepted", EVENT_CASES[0]!.payload());
    let fail = true;
    const flaky = withStarterRule(ruleCode, {
      queue,
      handle: async () => {
        if (fail) throw new Error("synthetic transient failure");
        return { outcome: "done" };
      },
    });
    // Not the last attempt: rethrown, the execution stays running (pg-boss retries it).
    await expect(flaky.handle(env.db, occurrence, "j1", { retryCount: 0, retryLimit: 5 })).rejects.toThrow(
      "synthetic transient failure",
    );
    expect((await executionsOf(ruleCode, occurrence.idempotencyKey))[0]).toMatchObject({ status: "running" });
    // The last attempt: failed with retries_exhausted, the action result `failed`, and still rethrown.
    await expect(flaky.handle(env.db, occurrence, "j1", { retryCount: 5, retryLimit: 5 })).rejects.toThrow();
    const failed = (await executionsOf(ruleCode, occurrence.idempotencyKey))[0]!;
    expect(failed).toMatchObject({ status: "failed", error_code: "automation.retries_exhausted", attempt_no: 1 });
    // The job's retry from the failure queue re-sends the same envelope: the same execution resumes at attempt 2.
    fail = false;
    await flaky.handle(env.db, occurrence, failureRetryJobId(randomUUID(), 1), { retryCount: 0, retryLimit: 5 });
    await flaky.handle(env.db, occurrence, "j3");
    const execs = await executionsOf(ruleCode, occurrence.idempotencyKey);
    expect(execs).toHaveLength(1);
    expect(execs[0]).toMatchObject({ id: failed.id, status: "succeeded", attempt_no: 2, error_code: null });
    expect((await resultsOf(failed.id)).map((r) => [r.attempt_no, r.outcome, r.error_code])).toEqual([
      [1, "failed", "automation.action_failed"],
      [2, "done", null],
    ]);
  });

  it("the handler's result object is returned as it is, and its error is rethrown as it is", async () => {
    const result = { outcome: "done", marker: randomUUID() };
    const error = new Error("synthetic identity");
    const same = withStarterRule("starter.kpi_actual_accepted", {
      queue: "kpi.recalculate",
      handle: async () => result,
    });
    expect(await same.handle(env.db, envelope("kpi.actual_accepted", EVENT_CASES[0]!.payload()), "id-1")).toBe(result);
    const thrower = withStarterRule("starter.kpi_actual_accepted", {
      queue: "kpi.recalculate",
      handle: async () => {
        throw error;
      },
    });
    await expect(
      thrower.handle(env.db, envelope("kpi.actual_accepted", EVENT_CASES[0]!.payload()), "id-2"),
    ).rejects.toBe(error);
  });

  it("starter 13 on adoption.indicator_evaluated: the DG4 refusal of an unknown evaluation is rethrown unchanged and recorded", async () => {
    const queue = "adoption.indicator_evaluated";
    const payload = {
      evaluationId: randomUUID(),
      transformationId: tx,
      kpiDefinitionId: kpiId,
      scopeKind: "transformation",
      scopeId: tx,
      reportingPeriodId: periodId,
      calculatedRag: "red",
      deviation: "adverse",
      previousCalculatedRag: null,
    };
    const dg4Error = await dg4(queue)
      .handle(env.db, envelope("kpi.deviation_evaluated", payload), "dg4-adoption")
      .then(
        () => null,
        (e: unknown) => (e as Error).message,
      );
    const occurrence = envelope("kpi.deviation_evaluated", payload);
    const wrappedError = await wrapped(queue)
      .handle(env.db, occurrence, "wrap-adoption", { retryCount: 5, retryLimit: 5 })
      .then(
        () => null,
        (e: unknown) => (e as Error).message,
      );
    expect(wrappedError).toBe(dg4Error);
    expect(wrappedError).not.toBeNull();
    const execs = await executionsOf("starter.adoption_control_failed", occurrence.idempotencyKey);
    expect(execs).toHaveLength(1);
    expect(execs[0]).toMatchObject({ status: "failed", error_code: "automation.retries_exhausted" });
  });

  it("a trigger the version does not name runs the handler unrecorded", async () => {
    const occurrence = envelope("kpi.threshold_changed", { kpiId: randomUUID() });
    const r = await runAsStarter(
      env.db,
      "starter.gate_approved",
      "gates.decided",
      occurrence,
      "x",
      undefined,
      async () => "ran",
    );
    expect(r).toBe("ran");
    expect(await executionsOf("starter.gate_approved", occurrence.idempotencyKey)).toHaveLength(0);
  });
});

describe("REQ-S12-004: new transformation instantiation (starter 1, worker part)", () => {
  const v2 = (t: { transformationId: string; userId: string }, launchPlan: { startDate: string } | null) => ({
    outboxEventId: randomUUID(),
    eventType: "transformation.created",
    schemaVersion: 2,
    idempotencyKey: `transformation.created:${t.transformationId}`,
    organizationId: org,
    payload: {
      transformationId: t.transformationId,
      organizationId: org,
      businessUnitId: randomUUID(),
      mode: "end_to_end",
      entryPhase: null,
      standaloneDeliverableType: null,
      createdBy: t.userId,
      occurredAt: "2026-10-14T09:00:00.000Z",
      launchPlan,
    },
  });
  const stepsOf = (t: string) =>
    env.db
      .selectFrom("phase_step")
      .select(["step_key", "phase_code", "status"])
      .where("transformation_id", "=", t)
      .execute();
  const roleTasksOf = (t: string) =>
    env.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "dedupe_key", "due_date", "message_params", "status"])
      .where("transformation_id", "=", t)
      .where("kind", "=", "role_assignment")
      .orderBy("dedupe_key")
      .execute();

  it("one set of entry-phase checklist rows and role tasks; replay x3 and a retry create no duplicates", async () => {
    const seed = await seedTransformationWithOutbox(env.db);
    const t = { transformationId: seed.transformationId, userId: seed.userId };
    const t0 = (
      await env.db
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", t.transformationId)
        .executeTakeFirstOrThrow()
    ).organization_id;
    const e = { ...v2(t, null), organizationId: t0, payload: { ...v2(t, null).payload, organizationId: t0 } };
    expect(await handleTransformationCreated(env.db, e, "tc-1")).toBe("done");
    for (let i = 0; i < 3; i += 1)
      expect(await handleTransformationCreated(env.db, e, `tc-replay-${i}`)).toBe("duplicate");
    const definitions = await env.db
      .selectFrom("phase_step_definition")
      .select("key")
      .where("phase_code", "=", "diagnose")
      .execute();
    const steps = await stepsOf(t.transformationId);
    expect(definitions.length).toBeGreaterThan(0);
    expect(steps.map((s) => s.step_key).sort()).toEqual(definitions.map((d) => d.key).sort());
    expect(steps.every((s) => s.phase_code === "diagnose" && s.status === "not_started")).toBe(true);
    const tasks = await roleTasksOf(t.transformationId);
    expect(tasks.map((x) => x.dedupe_key)).toEqual(
      ["BO", "FIN", "SP", "TO", "WL"].map((r) => `role_assignment:${t.transformationId}:${r}`),
    );
    // To the creator; the organization has no business calendar: the due date is Unknown (null), never guessed.
    expect(tasks.every((x) => x.assignee_user_id === t.userId && x.due_date === null && x.status === "open")).toBe(
      true,
    );
    // One execution of starter 1 naming its version and trigger.
    const execs = await executionsOf("starter.transformation_created", e.idempotencyKey);
    expect(execs).toHaveLength(1);
    expect(execs[0]).toMatchObject({ trigger_code: "transformation.created", status: "succeeded" });
    // The handler run again directly (a DG4 retry path) also creates nothing more.
    expect(await dg4TransformationCreated(env.db, e, "tc-direct")).toBe("duplicate");
    expect(await stepsOf(t.transformationId)).toHaveLength(steps.length);
    expect(await roleTasksOf(t.transformationId)).toHaveLength(5);
  });

  it("a role already held in the transformation gets no task; the v1 event is still consumed", async () => {
    const seed = await seedTransformationWithOutbox(env.db);
    const row = await env.db
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", seed.transformationId)
      .executeTakeFirstOrThrow();
    const role = await env.db.selectFrom("role").select("id").where("code", "=", "SP").executeTakeFirstOrThrow();
    await env.owner.query(
      `INSERT INTO scoped_assignment (id, organization_id, user_id, role_id, scope_type, scope_id, reason, granted_by)
       VALUES ($1, $2, $3, $4, 'transformation', $5, 'synthetic fixture', $3)`,
      [randomUUID(), row.organization_id, seed.userId, role.id, seed.transformationId],
    );
    const v1 = await env.db
      .selectFrom("outbox_event")
      .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
      .where("id", "=", seed.outboxId)
      .executeTakeFirstOrThrow();
    const e = {
      outboxEventId: v1.id,
      eventType: v1.event_type,
      schemaVersion: v1.schema_version,
      idempotencyKey: v1.idempotency_key,
      organizationId: v1.organization_id,
      payload: v1.payload as Record<string, unknown>,
    };
    expect(await handleTransformationCreated(env.db, e, "tc-v1")).toBe("done");
    expect((await roleTasksOf(seed.transformationId)).map((x) => x.dedupe_key.split(":").pop())).toEqual([
      "BO",
      "FIN",
      "TO",
      "WL",
    ]);
  });

  it("with launchPlan, the port receives the start date and key launch_plan:<id>; the no-op default writes nothing", async () => {
    const calls: LaunchPlanRequest[] = [];
    registerLaunchPlanPort({
      generate: async (_tx, request) => {
        calls.push(request);
        return { outcome: "port_unavailable" };
      },
    });
    try {
      const seed = await seedTransformationWithOutbox(env.db);
      const row = await env.db
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", seed.transformationId)
        .executeTakeFirstOrThrow();
      const base = v2({ transformationId: seed.transformationId, userId: seed.userId }, { startDate: "2026-10-01" });
      const e = {
        ...base,
        organizationId: row.organization_id,
        payload: { ...base.payload, organizationId: row.organization_id },
      };
      expect(await handleTransformationCreated(env.db, e, "tc-plan")).toBe("done");
      for (let i = 0; i < 3; i += 1) await handleTransformationCreated(env.db, e, `tc-plan-${i}`);
      expect(calls.map((c) => [c.transformationId, c.startDate, c.idempotencyKey])).toEqual([
        [seed.transformationId, "2026-10-01", `launch_plan:${seed.transformationId}`],
      ]);
      const audit = await env.db
        .selectFrom("audit_event")
        .select("reason")
        .where("record_id", "=", seed.transformationId)
        .where("action", "=", "transformation.starter_automation_requested")
        .executeTakeFirstOrThrow();
      expect(audit.reason).toContain("automation.port_unavailable");
    } finally {
      registerLaunchPlanPort(null);
    }
  });

  // T-DG5-BE-P (ADR-0048 §1; D-142 Q6): REQ-S12-004 "with the plan flag the 90-day tasks are dated from the start date".
  it("with the plan flag the 90-day tasks are dated from the start date (day d = start date + d calendar days)", async () => {
    registerLaunchPlanPort(workerLaunchPlanGenerator);
    try {
      const seed = await seedTransformationWithOutbox(env.db);
      const row = await env.db
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", seed.transformationId)
        .executeTakeFirstOrThrow();
      const base = v2({ transformationId: seed.transformationId, userId: seed.userId }, { startDate: "2026-10-01" });
      const e = {
        ...base,
        organizationId: row.organization_id,
        payload: { ...base.payload, organizationId: row.organization_id },
      };
      expect(await handleTransformationCreated(env.db, e, "tc-plan-real")).toBe("done");
      for (let i = 0; i < 3; i += 1) await handleTransformationCreated(env.db, e, `tc-plan-real-${i}`);
      const plans = await env.db
        .selectFrom("launch_plan")
        .select(["id", "start_date", "generated_via"])
        .where("transformation_id", "=", seed.transformationId)
        .execute();
      expect(plans).toEqual([{ id: plans[0]!.id, start_date: "2026-10-01", generated_via: "automation" }]);
      const tasks = await env.db
        .selectFrom("launch_task")
        .select(["window_code", "task_kind", "start_date", "due_date"])
        .where("plan_id", "=", plans[0]!.id)
        .execute();
      expect(tasks).toHaveLength(33);
      const span = (w: string) => [
        ...new Set(tasks.filter((t) => t.window_code === w).map((t) => `${t.start_date}..${t.due_date}`)),
      ];
      expect(span("days_0_30")).toEqual(["2026-10-01..2026-10-31"]);
      expect(span("days_31_60")).toEqual(["2026-11-01..2026-11-30"]);
      expect(span("days_61_90").sort()).toEqual(["2026-12-01..2026-12-30", "2026-12-30..2026-12-30"]);
      const test = await env.db
        .selectFrom("day_ninety_test")
        .select("scheduled_date")
        .where("plan_id", "=", plans[0]!.id)
        .executeTakeFirstOrThrow();
      expect(test.scheduled_date).toBe("2026-12-30");
      const audit = await env.db
        .selectFrom("audit_event")
        .select(["reason"])
        .where("record_id", "=", seed.transformationId)
        .where("action", "=", "transformation.starter_automation_requested")
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]!.reason).toContain("90-day plan: created from 2026-10-01");
      const planAudit = await env.db
        .selectFrom("audit_event")
        .select(["action", "actor_type", "source", "on_behalf_of_user_id"])
        .where("record_id", "=", plans[0]!.id)
        .execute();
      expect(planAudit).toEqual([
        { action: "launch_plan.generate", actor_type: "service", source: "worker", on_behalf_of_user_id: seed.userId },
      ]);
    } finally {
      registerLaunchPlanPort(null);
    }
  });
});
