// The automation engine and its evaluation handler (ADR-0043 §2, §3, §5; REQ-S12-001, REQ-S12-021; p5-work-split
// §D.2; T-DG5-BE-H2) against a real PostgreSQL, driven as the relay would deliver the outbox envelopes:
//  - REQ-S12-001: an enabled admin rule on `gate.decided` records ONE execution naming its rule version, its trigger
//    event (code and key) and its outcome; conditions not met -> `skipped` (conditions_met false), nothing created;
//  - REQ-S12-021: the same event x3 (sequential and concurrent) -> one execution, one action result, one task;
//  - scope: disabled rules, other organizations' rules and other transformations' rules never run; a target outside
//    the rule's scope -> the execution fails with automation.action_forbidden, nothing created (never retried);
//  - retries: a thrown error leaves the execution running for the next attempt; the LAST attempt marks it failed
//    (automation.retries_exhausted) and rethrows; a redelivery resumes a running execution and completes it once;
//  - ticks: one execution per rule and slot, whatever the number of deliveries;
//  - the queue map feeds every admin-selectable event trigger of the catalogue to automation.evaluate, and each event
//    keeps its DG4 consumer first (D-102 fan-out);
//  - parity (ADR-0002 rule 5): the worker's condition evaluator and its create_task / notify / escalate planners give
//    the same answers as the API's (the dry run's) on the same fixtures.
// Synthetic people and data. No rule decides anything: the engine creates tasks and notifications only.
import { sql, type Tx } from "@mth/db";
import type { AutomationCondition } from "@mth/shared/schemas";
import { businessDateOf } from "@mth/shared/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  automationActionKey as workerKey,
  planRecipients,
  type WorkerActionContext,
} from "../../../../worker/src/automation/actions/common.ts";
import {
  candidates,
  evaluateConditions as workerConditions,
  evaluateEvent,
  evaluateTick,
  executeRule,
  tickSlot,
  type Candidate,
} from "../../../../worker/src/automation/engine.ts";
import { AUTOMATION_HANDLERS } from "../../../../worker/src/handlers/automation.ts";
import { DOMAIN_HANDLERS } from "../../../../worker/src/handlers/index.ts";
import { AUTOMATION_EVENT_QUEUES, AUTOMATION_QUEUES } from "../../../../worker/src/queues/automation.ts";
import { DOMAIN_QUEUES, QUEUES_FOR_EVENT } from "../../../../worker/src/queues/index.ts";
import { evaluateConditions as apiConditions } from "../../../src/modules/automation/conditions.ts";
import { createTaskAction, escalateAction, notifyAction } from "../../../src/modules/tasks/automation-actions.ts";
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

let api: TestApi;
let w: World;
let admin: Session;
let adminId: string;
let office: Session;
let txA: string;
let txA2: string;
let txB: string;
let leadId: string;

const R = "/api/v1/admin/automation-rules";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  office = await signIn(api.app, w.office.subject);
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  txA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
  txB = await createTransformationRow(api.db, w.orgB.id, w.b1, w.grantor.id);
  const lead = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, lead.id, "TL", { type: "transformation", id: txA }, w.orgA.id);
  leadId = lead.id;
}, 60_000);
afterAll(() => api.close());

const task = (extra: Record<string, unknown> = {}) => ({
  type: "create_task",
  parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up", ...extra },
});
const gateDecidedPayload = (transformationId: string, gateCode = "G3") => ({
  gateInstanceId: crypto.randomUUID(),
  transformationId,
  gateCode,
  submissionId: crypto.randomUUID(),
  submissionNo: 1,
  gateDecisionId: crypto.randomUUID(),
  outcome: "approved",
  decidedBy: crypto.randomUUID(),
  nextPhase: null,
  scaleScopeItemIds: [],
  conditionIds: [],
});
const envelope = (organizationId: string, payload: Record<string, unknown>, eventType = "gate.decided") => ({
  outboxEventId: crypto.randomUUID(),
  eventType,
  schemaVersion: 1,
  idempotencyKey: `${eventType}:${crypto.randomUUID()}`,
  organizationId,
  payload,
});
const handler = (queue: string) => AUTOMATION_HANDLERS.find((h) => h.queue === queue)!;

/** Creates, dry-runs, submits, has TO review, publishes and (optionally) enables an admin rule through the API. */
async function liveRule(opts: {
  content: Record<string, unknown>;
  sample: { triggerCode: string; payload: Record<string, unknown> };
  scopeLevel?: "organization" | "transformation";
  transformationId?: string;
  enable?: boolean;
}): Promise<{ id: string; code: string; versionId: string }> {
  const code = `engine.${uniq("e").toLowerCase()}`;
  const created = await call<Body>(api.app, "POST", R, {
    session: admin,
    body: {
      code,
      nameEn: "Synthetic engine rule",
      nameAr: "قاعدة محرك تجريبية",
      scopeLevel: opts.scopeLevel ?? "organization",
      organizationId: w.orgA.id,
      ...(opts.transformationId !== undefined ? { transformationId: opts.transformationId } : {}),
      ownerUserId: adminId,
      content: opts.content,
    },
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const v1 = `${R}/${id}/versions/1`;
  const run = await call<Body>(api.app, "POST", `${v1}/dry-runs`, { session: admin, body: opts.sample });
  expect([run.status, run.body.outcome]).toEqual([201, "pass"]);
  expect((await call(api.app, "POST", `${v1}/submit`, { session: admin, headers: ifm(1) })).status).toBe(200);
  expect(
    (await call(api.app, "POST", `${v1}/review`, { session: office, headers: ifm(2), body: { outcome: "approve" } }))
      .status,
  ).toBe(200);
  const pub = await call<Body>(api.app, "POST", `${v1}/publish`, { session: admin, headers: ifm(1) });
  expect(pub.status).toBe(200);
  if (opts.enable !== false)
    expect((await call(api.app, "POST", `${R}/${id}/enable`, { session: admin, headers: ifm(2) })).status).toBe(200);
  return { id, code, versionId: pub.body.id as string };
}

const executionsOf = (ruleId: string) =>
  api.db.selectFrom("automation_execution").selectAll().where("automation_rule_id", "=", ruleId).execute();
const resultsOf = (executionId: string) =>
  api.db
    .selectFrom("automation_action_result")
    .selectAll()
    .where("automation_execution_id", "=", executionId)
    .orderBy("attempt_no")
    .orderBy("ordinal")
    .execute();
const tasksOf = (executionId: string) =>
  api.db
    .selectFrom("work_item")
    .selectAll()
    .where("subject_type", "=", "automation_execution")
    .where("subject_id", "=", executionId)
    .execute();

describe("the queue map (ADR-0043 §5, §7)", () => {
  it("feeds every admin-selectable event trigger to automation.evaluate; each event keeps its DG4 consumer first", async () => {
    const triggers = await api.db
      .selectFrom("automation_trigger")
      .select("code")
      .where("trigger_kind", "=", "event")
      .where("admin_selectable", "=", true)
      .orderBy("code")
      .execute();
    expect(Object.keys(AUTOMATION_EVENT_QUEUES).sort()).toEqual(triggers.map((t) => t.code));
    for (const t of triggers) expect(QUEUES_FOR_EVENT[t.code], t.code).toContain("automation.evaluate");
    expect(QUEUES_FOR_EVENT["gate.decided"]).toEqual(["gates.decided", "automation.evaluate"]);
    expect(AUTOMATION_QUEUES.map((q) => q.name)).toEqual([
      "automation.evaluate",
      "automation.tick_hourly",
      "automation.tick_daily",
    ]);
    // Standard bounded retries (no override): 5 attempts with backoff, then ops.failed (ADR-0008 §4).
    for (const q of AUTOMATION_QUEUES) expect(q.retryLimit).toBeUndefined();
    expect(DOMAIN_QUEUES.map((q) => q.name)).toEqual(expect.arrayContaining(AUTOMATION_QUEUES.map((q) => q.name)));
    expect(DOMAIN_HANDLERS.map((h) => h.queue)).toEqual(expect.arrayContaining(AUTOMATION_QUEUES.map((q) => q.name)));
    // The two ticks are job_schedule rows of 0074 whose queues now have a handler.
    const ticks = await api.db
      .selectFrom("job_schedule")
      .select(["code", "queue_name"])
      .where("owner_module", "=", "automation")
      .orderBy("code")
      .execute();
    expect(ticks).toEqual([
      { code: "automation.tick_daily", queue_name: "automation.tick_daily" },
      { code: "automation.tick_hourly", queue_name: "automation.tick_hourly" },
    ]);
  });
});

describe("REQ-S12-001: each execution is recorded with rule version, trigger event and outcome", () => {
  it("an enabled admin rule on gate.decided records one execution and creates its task; conditions not met -> skipped", async () => {
    const rule = await liveRule({
      content: {
        triggerCodes: ["gate.decided"],
        conditions: [{ field: "gateCode", op: "eq", value: "G3" }],
        actions: [task({ dueInWorkingDays: 3 })],
        runAs: "service",
      },
      sample: { triggerCode: "gate.decided", payload: gateDecidedPayload(txA) },
    });
    const ev = envelope(w.orgA.id, gateDecidedPayload(txA));
    const reports = await handler("automation.evaluate").handle(api.db, ev, "job-1", { retryCount: 0, retryLimit: 5 });
    expect(reports).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleCode: rule.code, outcome: "succeeded" })]),
    );
    const [exec, ...more] = await executionsOf(rule.id);
    expect(more).toEqual([]);
    expect(exec).toMatchObject({
      automation_rule_version_id: rule.versionId,
      trigger_code: "gate.decided",
      trigger_key: ev.idempotencyKey,
      status: "succeeded",
      conditions_met: true,
      run_as: "service",
      initiating_user_id: null,
      attempt_no: 1,
      organization_id: w.orgA.id,
      transformation_id: txA,
      error_code: null,
    });
    expect(exec!.finished_at).not.toBeNull();
    const results = await resultsOf(exec!.id);
    expect(results).toEqual([
      expect.objectContaining({
        ordinal: 1,
        action_type: "create_task",
        outcome: "done",
        idempotency_key: `automation:${rule.code}:${ev.idempotencyKey}:1`,
        result_record_type: "work_item",
      }),
    ]);
    const tasks = await tasksOf(exec!.id);
    expect(tasks).toEqual([
      expect.objectContaining({
        kind: "automation_task",
        assignee_user_id: leadId,
        transformation_id: txA,
        message_key: "automation.message.follow_up",
        dedupe_key: `automation:${rule.code}:${ev.idempotencyKey}:1:${leadId}`,
        status: "open",
      }),
    ]);
    // The organization has no business calendar yet: the due date is Unknown (null), never guessed in elapsed days.
    expect(tasks[0]!.due_date).toBeNull();
    // Audited as the service identity from the worker.
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_type", "source"])
      .where("record_id", "=", exec!.id)
      .orderBy("occurred_at")
      .execute();
    expect(audit.map((a) => a.action)).toEqual(["automation_execution.start", "automation_execution.succeed"]);
    expect(audit.every((a) => a.actor_type === "service" && a.source === "worker")).toBe(true);

    // With a default calendar (Sunday-Thursday), the due date is the calendar's own answer for 3 working days.
    const adminTech = await signIn(api.app, w.admin.subject);
    const cal = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/calendars`, {
      session: adminTech,
      body: { code: uniq("CAL"), nameEn: "Synthetic calendar", nameAr: "تقويم اصطناعي", isDefault: true },
    });
    expect(cal.status).toBe(201);
    const today = businessDateOf(new Date(), "Asia/Riyadh");
    const expected = await call<Body>(
      api.app,
      "GET",
      `/api/v1/calendars/${cal.body.id}/working-days?from=${today}&workingDays=3`,
      {
        session: adminTech,
      },
    );
    expect(expected.status).toBe(200);
    const withCalendar = envelope(w.orgA.id, gateDecidedPayload(txA));
    await handler("automation.evaluate").handle(api.db, withCalendar, "job-1b");
    const dated = (await executionsOf(rule.id)).find((e) => e.trigger_key === withCalendar.idempotencyKey)!;
    expect((await tasksOf(dated.id))[0]!.due_date).toBe(expected.body.dueDate);

    const other = envelope(w.orgA.id, gateDecidedPayload(txA, "G2"));
    await handler("automation.evaluate").handle(api.db, other, "job-2");
    const skipped = (await executionsOf(rule.id)).find((e) => e.trigger_key === other.idempotencyKey)!;
    expect(skipped).toMatchObject({ status: "skipped", conditions_met: false, error_code: null });
    expect(await resultsOf(skipped.id)).toEqual([]);
    expect(await tasksOf(skipped.id)).toEqual([]);
  });

  it("never runs a disabled rule, another organization's event, or a transformation rule on another transformation", async () => {
    const off = await liveRule({
      content: { triggerCodes: ["gate.decided"], actions: [task()], runAs: "service" },
      sample: { triggerCode: "gate.decided", payload: gateDecidedPayload(txA) },
      enable: false,
    });
    const scoped = await liveRule({
      content: { triggerCodes: ["gate.decided"], actions: [task()], runAs: "service" },
      sample: { triggerCode: "gate.decided", payload: gateDecidedPayload(txA) },
      scopeLevel: "transformation",
      transformationId: txA,
    });
    await evaluateEvent(api.db, envelope(w.orgA.id, gateDecidedPayload(txA2)), "job-3");
    await evaluateEvent(api.db, envelope(w.orgB.id, gateDecidedPayload(txB)), "job-4");
    expect(await executionsOf(off.id)).toEqual([]);
    expect(await executionsOf(scoped.id)).toEqual([]);
    await evaluateEvent(api.db, envelope(w.orgA.id, gateDecidedPayload(txA)), "job-5");
    expect(await executionsOf(off.id)).toEqual([]);
    expect((await executionsOf(scoped.id)).map((e) => e.status)).toEqual(["succeeded"]);
  });

  it("a target outside the rule's scope fails with automation.action_forbidden at once; nothing is created", async () => {
    const rule = await liveRule({
      content: {
        triggerCodes: ["gate.decided"],
        actions: [task({ targetTransformationId: txA })],
        runAs: "service",
      },
      sample: { triggerCode: "gate.decided", payload: gateDecidedPayload(txA) },
      scopeLevel: "transformation",
      transformationId: txA,
    });
    // A rule whose action targets a transformation outside its scope cannot pass a dry run (the planner refuses it),
    // so it is never published; the engine refuses it again on its own: the same published version, evaluated as if
    // its scope were transformation A2 (a forged candidate), may not create anything in A.
    const [cand] = (
      await candidates(api.db, "gate.decided", { organizationId: w.orgA.id, transformationId: txA })
    ).filter((c) => c.ruleId === rule.id);
    const forged: Candidate = { ...cand!, scopeLevel: "transformation", transformationId: txA2 };
    const report = await executeRule(
      api.db,
      forged,
      { triggerCode: "gate.decided", triggerKey: `forged:${crypto.randomUUID()}`, payload: {}, transformationId: txA2 },
      "job-6",
    );
    expect(report.outcome).toBe("failed");
    const exec = (await executionsOf(rule.id)).find((e) => e.id === report.executionId)!;
    expect(exec).toMatchObject({ status: "failed", error_code: "automation.action_forbidden" });
    expect(await resultsOf(exec.id)).toEqual([
      expect.objectContaining({ outcome: "forbidden", error_code: "automation.action_forbidden" }),
    ]);
    expect(await tasksOf(exec.id)).toEqual([]);
  });
});

describe("REQ-S12-021: the same event x3 -> one execution, one action, one task", () => {
  it("sequential and concurrent replays create exactly one of each", async () => {
    const rule = await liveRule({
      content: {
        triggerCodes: ["gate.decided"],
        actions: [
          task(),
          { type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } },
        ],
        runAs: "service",
      },
      sample: { triggerCode: "gate.decided", payload: gateDecidedPayload(txA) },
    });
    const ev = envelope(w.orgA.id, gateDecidedPayload(txA));
    for (let i = 0; i < 3; i += 1) await handler("automation.evaluate").handle(api.db, ev, `job-r${i}`);
    const ev2 = envelope(w.orgA.id, gateDecidedPayload(txA));
    await Promise.all([1, 2, 3].map((i) => handler("automation.evaluate").handle(api.db, ev2, `job-c${i}`)));
    for (const key of [ev.idempotencyKey, ev2.idempotencyKey]) {
      const execs = (await executionsOf(rule.id)).filter((e) => e.trigger_key === key);
      expect(execs.map((e) => e.status)).toEqual(["succeeded"]);
      const results = await resultsOf(execs[0]!.id);
      expect(results.map((r) => [r.ordinal, r.outcome])).toEqual([
        [1, "done"],
        [2, "done"],
      ]);
      expect(await tasksOf(execs[0]!.id)).toHaveLength(1);
      const notes = await api.db
        .selectFrom("inbox_notification")
        .select("id")
        .where("dedupe_key", "=", `automation:${rule.code}:${key}:2:${leadId}`)
        .execute();
      expect(notes).toHaveLength(1);
    }
  });
});

describe("retries (ADR-0043 §5; ADR-0008 §4)", () => {
  it("a thrown error leaves the execution running; the last attempt marks it failed; a redelivery resumes and completes once", async () => {
    const rule = await liveRule({
      content: {
        triggerCodes: ["gate.decided"],
        actions: [task(), task({ messageKey: "automation.message.review_needed" })],
        runAs: "service",
      },
      sample: { triggerCode: "gate.decided", payload: gateDecidedPayload(txA) },
    });
    const [cand] = (
      await candidates(api.db, "gate.decided", { organizationId: w.orgA.id, transformationId: txA })
    ).filter((c) => c.ruleId === rule.id);
    // The second action throws (settings that do not parse: a transient fault of this attempt).
    const broken: Candidate = {
      ...cand!,
      actions: [cand!.actions[0]!, { type: "create_task", parameters: { bad: 1 } }],
    };
    const o = {
      triggerCode: "gate.decided",
      triggerKey: `retry:${crypto.randomUUID()}`,
      payload: {},
      transformationId: txA,
    };
    await expect(executeRule(api.db, broken, o, "job-a1", { retryCount: 0, retryLimit: 5 })).rejects.toThrow();
    let [exec] = await executionsOf(rule.id);
    expect(exec).toMatchObject({ status: "running", attempt_no: 1 });
    expect((await resultsOf(exec!.id)).map((r) => [r.ordinal, r.outcome])).toEqual([[1, "done"]]);
    // A redelivery resumes: action 1 is not repeated, action 2 now runs; one task each.
    const ok = await executeRule(api.db, cand!, o, "job-a2", { retryCount: 1, retryLimit: 5 });
    expect(ok.outcome).toBe("succeeded");
    [exec] = await executionsOf(rule.id);
    expect(exec).toMatchObject({ status: "succeeded" });
    expect((await resultsOf(exec!.id)).map((r) => [r.ordinal, r.outcome])).toEqual([
      [1, "done"],
      [2, "done"],
    ]);
    expect(await tasksOf(exec!.id)).toHaveLength(2);
    // The last attempt of another occurrence: failed with automation.retries_exhausted, then rethrown.
    const o2 = { ...o, triggerKey: `retry:${crypto.randomUUID()}` };
    await expect(executeRule(api.db, broken, o2, "job-a3", { retryCount: 5, retryLimit: 5 })).rejects.toThrow();
    const last = (await executionsOf(rule.id)).find((e) => e.trigger_key === o2.triggerKey)!;
    expect(last).toMatchObject({ status: "failed", error_code: "automation.retries_exhausted" });
    expect(last.error_detail).not.toBeNull();
    // A finished execution is never re-run by a later delivery.
    expect((await executeRule(api.db, cand!, o2, "job-a4")).outcome).toBe("duplicate");
  });
});

describe("engine ticks (ADR-0043 §2: automation.tick_hourly / automation.tick_daily)", () => {
  it("runs a tick rule once per slot, whatever the number of deliveries", async () => {
    const rule = await liveRule({
      content: { triggerCodes: ["automation.tick_daily"], actions: [task()], runAs: "service" },
      sample: { triggerCode: "automation.tick_daily", payload: {} },
      scopeLevel: "transformation",
      transformationId: txA,
    });
    const day1 = new Date("2026-10-14T21:30:00Z"); // 00:30 on 15 October in Riyadh (UTC+3)
    const day1later = new Date("2026-10-15T08:00:00Z");
    const day2 = new Date("2026-10-15T21:10:00Z");
    expect(tickSlot("automation.tick_daily", day1, "Asia/Riyadh")).toBe("2026-10-14T21:00");
    expect(tickSlot("automation.tick_daily", day1later, "Asia/Riyadh")).toBe("2026-10-14T21:00");
    expect(tickSlot("automation.tick_hourly", new Date("2026-10-14T09:07:42Z"), "Asia/Riyadh")).toBe(
      "2026-10-14T09:00",
    );
    await evaluateTick(api.db, "automation.tick_daily", "job-t1", undefined, day1);
    await evaluateTick(api.db, "automation.tick_daily", "job-t2", undefined, day1later);
    await evaluateTick(api.db, "automation.tick_daily", "job-t3", undefined, day2);
    const execs = await executionsOf(rule.id);
    expect(execs.map((e) => e.trigger_key).sort()).toEqual([
      "automation.tick_daily:2026-10-14T21:00",
      "automation.tick_daily:2026-10-15T21:00",
    ]);
    expect(execs.every((e) => e.status === "succeeded" && e.transformation_id === txA)).toBe(true);
  });
});

describe("parity with the API (ADR-0002 rule 5: the worker imports no API code)", () => {
  it("conditions: the worker twin and the API evaluator agree on every case", () => {
    const cases: [AutomationCondition[], Record<string, unknown>][] = [
      [[], {}],
      [[{ field: "gateCode", op: "eq", value: "G3" }], { gateCode: "G3" }],
      [[{ field: "gateCode", op: "neq", value: "G3" }], { gateCode: "G2" }],
      [[{ field: "gateCode", op: "neq", value: "G3" }], {}],
      [[{ field: "gateCode", op: "in", value: ["G2", "G3"] }], { gateCode: "G3" }],
      [[{ field: "slipDays", op: "gt", value: "3" }], { slipDays: 4 }],
      [[{ field: "slipDays", op: "gt", value: "3" }], { slipDays: "3.000001" }],
      [[{ field: "slipDays", op: "gte", value: "3" }], { slipDays: 2.5 }],
      [[{ field: "slipDays", op: "lt", value: "-1.5" }], { slipDays: "-2" }],
      [[{ field: "slipDays", op: "lte", value: "0" }], { slipDays: null }],
      [[{ field: "slipDays", op: "lte", value: "0" }], { slipDays: "abc" }],
      [[{ field: "flag", op: "eq", value: true }], { flag: true }],
      [[{ field: "x", op: "present" }], { x: null }],
      [[{ field: "x", op: "absent" }], {}],
      [
        [
          { field: "gateCode", op: "eq", value: "G3" },
          { field: "slipDays", op: "gt", value: "10" },
        ],
        { gateCode: "G3", slipDays: "10" },
      ],
    ];
    for (const [conditions, payload] of cases) {
      const a = apiConditions(conditions, payload);
      const b = workerConditions(conditions, payload);
      expect({ met: b.met, findings: b.findings }, JSON.stringify([conditions, payload])).toEqual({
        met: a.met,
        findings: a.findings,
      });
    }
    expect(apiConditions([{ field: "slipDays", op: "gt", value: "3" }], { slipDays: 2.5 })).toEqual({
      met: false,
      findings: [{ code: "automation.condition_unknown_value", pointer: "/conditions/0", field: "slipDays" }],
    });
  });

  it("create_task, notify and escalate: the worker planners equal the API planners (outcome, target, key)", async () => {
    const descriptors = [
      {
        api: createTaskAction,
        type: "create_task",
        params: { assigneeRole: "TL", messageKey: "automation.message.follow_up" },
      },
      {
        api: notifyAction,
        type: "notify",
        params: { recipientRole: "TL", messageKey: "automation.message.update_due" },
      },
      {
        api: escalateAction,
        type: "escalate",
        params: { toRole: "TO", messageKey: "automation.message.attention_required" },
      },
    ];
    const scopes = [
      { level: "organization" as const, organizationId: w.orgA.id, transformationId: null },
      { level: "transformation" as const, organizationId: w.orgA.id, transformationId: txA2 },
    ];
    const identities = [
      { runAs: "service" as const, permissions: [] },
      { runAs: "initiating_user" as const, userId: w.office.id },
      { runAs: "initiating_user" as const, userId: w.officeB.id },
    ];
    const targets = [txA, txB, null];
    let compared = 0;
    for (const d of descriptors)
      for (const scope of scopes)
        for (const identity of identities)
          for (const transformationId of targets) {
            const base = {
              ruleCode: "parity.rule",
              triggerKey: "parity:key",
              ordinal: 2,
              scope,
              transformationId,
              identity,
            };
            const fromApi = await d.api.plan(api.db, { ...base, parameters: d.params });
            const fromWorker = await api.db.transaction().execute((tx: Tx) => {
              const ctx: WorkerActionContext = {
                ...base,
                ruleName: "Parity",
                triggerCode: "gate.decided",
                triggerLabel: "Gate decided",
                executionId: crypto.randomUUID(),
                jobId: "parity",
              };
              const p = new Map(Object.entries(d.params as Record<string, string>));
              return planRecipients(tx, ctx, d.type, {
                role: p.get("assigneeRole") ?? p.get("recipientRole") ?? p.get("toRole") ?? "",
                messageKey: p.get("messageKey") ?? "",
              });
            });
            const expected =
              d.type === "create_task" && fromApi.outcome === "would_run"
                ? { ...fromWorker.planned, target: { ...fromWorker.planned.target, dueInWorkingDays: null } }
                : fromWorker.planned;
            expect(expected, `${d.type} ${scope.level} ${identity.runAs} ${transformationId}`).toEqual(fromApi);
            compared += 1;
          }
    expect(compared).toBe(54);
    expect(workerKey({ ruleCode: "r.x", triggerKey: "k", ordinal: 3 })).toBe("automation:r.x:k:3");
    // The fixture exercises each outcome at least once.
    const outcomes = new Set<string>();
    for (const t of [txA, txB, null]) {
      const p = await createTaskAction.plan(api.db, {
        ruleCode: "parity.rule",
        triggerKey: "k",
        ordinal: 1,
        scope: scopes[0]!,
        transformationId: t,
        identity: identities[0]!,
        parameters: descriptors[0]!.params,
      });
      outcomes.add(p.outcome);
    }
    expect([...outcomes].sort()).toEqual(["forbidden", "invalid", "would_run"]);
    // No row was written by planning (read-only planners).
    expect(
      (
        await sql<{
          n: number;
        }>`SELECT count(*)::int AS n FROM work_item WHERE dedupe_key LIKE 'automation:parity.rule:%'`.execute(api.db)
      ).rows[0]!.n,
    ).toBe(0);
  });
});
