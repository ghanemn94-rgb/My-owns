// The failure queue, execution history, retry and dismiss, and the service identity (ADR-0043 §3, §5, §8, §9;
// p5-work-split §D.3; T-DG5-BE-I) against a real PostgreSQL, the engine driven as the relay would deliver events:
//  - REQ-S12-003: a rule on transformation A configured to create a task in transformation B fails with
//    automation.action_forbidden and appears in the failure queue at once (never retried; nothing created);
//  - REQ-S12-002: a failed execution appears in the queue and succeeds on retry without duplicating actions (one `done`
//    result per key, one task, one notification);
//  - REQ-S12-021: the same retry delivered x3 and the same failing event replayed x3 add nothing;
//  - 422 automation_failure.not_open (resolved, dismissed), the 21st retry -> 422 automation_failure.retry_limit;
//  - AUD 403 on every write; job failures need job.repair; If-Match 428/409; one audit event per row written;
//    commit-time re-authorization; readers see only their organizations' entries;
//  - parity (ADR-0002 rule 5): the API's identity.ts and the worker's give the same decision on every combination.
// Synthetic people and data. Nothing here approves anything: retry and dismiss are operational repairs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTOMATION_EXECUTORS } from "../../../../worker/src/automation/engine.ts";
import { decideActionAuthorization as workerDecide } from "../../../../worker/src/automation/identity.ts";
import { resumeExecution } from "../../../../worker/src/automation/retry.ts";
import { AUTOMATION_HANDLERS } from "../../../../worker/src/handlers/automation.ts";
import { captureJobFailure, failureRetryJobId } from "../../../../worker/src/kit.ts";
import {
  decideActionAuthorization as apiDecide,
  type AuthorizationInput,
} from "../../../src/modules/automation/identity.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  gateDecidedEnvelope,
  gateDecidedPayload,
  liveRule,
  ruleAuthor,
  type RuleAuthor,
} from "../../support/automation-failures.ts";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

let api: TestApi;
let w: World;
let author: RuleAuthor;
let tech: Session;
let auditor: Session;
let officeB: Session;
let txA: string;
let txA2: string;

const F = "/api/v1/admin/automation-failures";
const E = "/api/v1/admin/automation-executions";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const evaluate = AUTOMATION_HANDLERS.find((h) => h.queue === "automation.evaluate")!;
const LAST = { retryCount: 5, retryLimit: 5 };

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  author = await ruleAuthor(api, w);
  tech = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: automation.repair, job.read, job.repair
  auditor = await signIn(api.app, w.auditor.subject);
  officeB = await signIn(api.app, w.officeB.subject);
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  txA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
  for (const t of [txA, txA2]) {
    const lead = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, lead.id, "TL", { type: "transformation", id: t }, w.orgA.id);
  }
}, 60_000);
afterAll(() => api.close());

const task = (extra: Record<string, unknown> = {}) => ({
  type: "create_task",
  parameters: { assigneeRole: "TL", messageKey: "automation.message.follow_up", ...extra },
});
const notify = { type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } };

const executionsOf = (ruleId: string) =>
  api.db.selectFrom("automation_execution").selectAll().where("automation_rule_id", "=", ruleId).execute();
const failuresOf = (executionId: string) =>
  api.db.selectFrom("operational_failure").selectAll().where("automation_execution_id", "=", executionId).execute();
const resultsOf = (executionId: string) =>
  api.db
    .selectFrom("automation_action_result")
    .selectAll()
    .where("automation_execution_id", "=", executionId)
    .orderBy("attempt_no")
    .orderBy("ordinal")
    .execute();
const itemsOf = (executionId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["id", "dedupe_key", "transformation_id"])
    .where("subject_type", "=", "automation_execution")
    .where("subject_id", "=", executionId)
    .execute();
const notificationsLike = (prefix: string) =>
  api.db.selectFrom("inbox_notification").select("id").where("dedupe_key", "like", `${prefix}%`).execute();

/** A rule whose second action throws on the event's LAST attempt: the execution fails with retries_exhausted. */
async function failedTransientExecution(): Promise<{ ruleCode: string; executionId: string; failureId: string }> {
  // Its own transformation (and TL), so no other test's rule matches its event.
  const tx = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  const lead = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, lead.id, "TL", { type: "transformation", id: tx }, w.orgA.id);
  const rule = await liveRule(api, w, author, {
    content: { triggerCodes: ["gate.decided"], actions: [task(), notify], runAs: "service" },
    sampleTransformationId: tx,
    scopeLevel: "transformation",
    transformationId: tx,
  });
  const executors = AUTOMATION_EXECUTORS as Map<string, unknown>;
  const real = executors.get("notify");
  executors.set("notify", async () => {
    throw new Error("synthetic transient fault");
  });
  try {
    await expect(
      evaluate.handle(api.db, gateDecidedEnvelope(w.orgA.id, gateDecidedPayload(tx)), "job-transient", LAST),
    ).rejects.toThrow("synthetic transient fault");
  } finally {
    executors.set("notify", real);
  }
  const [exec] = await executionsOf(rule.id);
  expect(exec).toMatchObject({ status: "failed", error_code: "automation.retries_exhausted", attempt_no: 1 });
  const [failure] = await failuresOf(exec!.id);
  return { ruleCode: rule.code, executionId: exec!.id, failureId: failure!.id };
}

describe("REQ-S12-003: an out-of-scope action fails with automation.action_forbidden and appears in the failure queue", () => {
  it("a rule on transformation A configured to create a task in transformation B fails at once, never retried", async () => {
    const rule = await liveRule(api, w, author, {
      content: { triggerCodes: ["gate.decided"], actions: [task({ targetTransformationId: txA })], runAs: "service" },
      sampleTransformationId: txA,
      scopeLevel: "transformation",
      transformationId: txA,
      plant: [task({ targetTransformationId: txA2 })],
    });
    const envelope = gateDecidedEnvelope(w.orgA.id, gateDecidedPayload(txA));
    // Delivered on its FIRST attempt: an authorization failure is not thrown (so pg-boss does not retry it); it is a
    // recorded result and enters the queue at once.
    const reports = (await evaluate.handle(api.db, envelope, "job-a12", { retryCount: 0, retryLimit: 5 })) as Body[];
    expect(reports).toEqual([{ ruleCode: rule.code, executionId: expect.any(String), outcome: "failed" }]);
    const [exec] = await executionsOf(rule.id);
    expect(exec).toMatchObject({ status: "failed", error_code: "automation.action_forbidden", attempt_no: 1 });
    expect(await resultsOf(exec!.id)).toEqual([
      expect.objectContaining({ outcome: "forbidden", error_code: "automation.action_forbidden" }),
    ]);
    expect(await itemsOf(exec!.id)).toEqual([]);
    const failures = await failuresOf(exec!.id);
    expect(failures).toEqual([
      expect.objectContaining({
        source: "rule_execution",
        status: "open",
        organization_id: w.orgA.id,
        queue_name: "automation.evaluate",
        idempotency_key: `execution:${exec!.id}`,
        error_code: "automation.action_forbidden",
        error_message:
          "The acting identity lacks the permission for this action, or its target is outside the rule's scope.",
        attempts: 1,
        retry_count: 0,
      }),
    ]);
    expect((await auditOf(api.db, failures[0]!.id)).map((a) => [a.action, a.actor_type, a.source])).toEqual([
      ["operational_failure.create", "service", "worker"],
    ]);

    // The queue shows it (ADM_METHOD and AUD read rule-execution entries), with the execution behind it.
    const listed = await call<Body>(api.app, "GET", `${F}?source=rule_execution&status=open&limit=100`, {
      session: author.session,
    });
    expect(listed.status).toBe(200);
    const entry = listed.body.items.find((i: Body) => i.executionId === exec!.id);
    expect(entry).toMatchObject({
      errorCode: "automation.action_forbidden",
      status: "open",
      allowedActions: ["retry", "dismiss"],
    });
    const asAud = await call<Body>(api.app, "GET", `${F}/${entry.id}`, { session: auditor });
    expect([asAud.status, asAud.body.allowedActions, asAud.headers["etag"]]).toEqual([200, [], '"1"']);
    const execution = await call<Body>(api.app, "GET", `${E}/${exec!.id}`, { session: auditor });
    expect(execution.status).toBe(200);
    expect(execution.body).toMatchObject({
      ruleId: rule.id,
      ruleCode: rule.code,
      versionId: rule.versionId,
      versionNo: 1,
      triggerCode: "gate.decided",
      triggerKey: envelope.idempotencyKey,
      runAs: "service",
      status: "failed",
      errorCode: "automation.action_forbidden",
      actionResults: [expect.objectContaining({ outcome: "forbidden", ordinal: 1, attemptNo: 1 })],
    });

    // REQ-S12-021: the same event replayed x3 adds nothing (one execution, one entry, attempts unchanged).
    for (let i = 0; i < 3; i += 1)
      await evaluate.handle(api.db, envelope, `job-a12-${i}`, { retryCount: 0, retryLimit: 5 });
    expect((await executionsOf(rule.id)).length).toBe(1);
    expect((await failuresOf(exec!.id)).map((f) => [f.status, f.attempts])).toEqual([["open", 1]]);
  });
});

describe("REQ-S12-002: a failed execution appears in the queue and succeeds on retry without duplicating actions", () => {
  it("retry resumes the execution; the done action is not repeated; the entry resolves", async () => {
    const { ruleCode, executionId, failureId } = await failedTransientExecution();
    // Attempt 1: action 1 done (one task per TL of A), action 2 threw (no result).
    expect((await resultsOf(executionId)).map((r) => [r.attempt_no, r.ordinal, r.outcome])).toEqual([[1, 1, "done"]]);
    const recipients = (await itemsOf(executionId)).length;
    expect(recipients).toBeGreaterThanOrEqual(1);

    const before = await call<Body>(api.app, "GET", `${F}/${failureId}`, { session: tech });
    expect(before.body).toMatchObject({ status: "open", errorCode: "automation.retries_exhausted", retryCount: 0 });
    const retried = await call<Body>(api.app, "POST", `${F}/${failureId}/retry`, { session: tech, headers: ifm(1) });
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ status: "retrying", retryCount: 1, lastRetryBy: w.admin.id, version: 2 });
    expect(retried.headers["etag"]).toBe('"2"');
    // One transaction: the execution resumed at attempt 2, both audit events, and the retry event for the worker.
    const exec = await api.db
      .selectFrom("automation_execution")
      .selectAll()
      .where("id", "=", executionId)
      .executeTakeFirstOrThrow();
    expect(exec).toMatchObject({ status: "running", attempt_no: 2, error_code: null, finished_at: null });
    expect((await auditOf(api.db, executionId)).map((a) => a.action).slice(-1)).toEqual(["automation_execution.retry"]);
    expect((await auditOf(api.db, failureId)).map((a) => a.action)).toEqual([
      "operational_failure.create",
      "operational_failure.retry",
    ]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "payload", "idempotency_key", "organization_id"])
      .where("aggregate_id", "=", failureId)
      .execute();
    expect(events).toEqual([
      {
        event_type: "automation_failure.retry_requested",
        payload: { failureId, retryCount: 1 },
        idempotency_key: `automation_failure.retry_requested:${failureId}:1`,
        organization_id: w.orgA.id,
      },
    ]);

    // The worker's dispatcher resumes it; delivered x3 (REQ-S12-021), it completes once.
    const first = await resumeExecution(api.db, executionId, "job-retry-1");
    expect(first.outcome).toBe("succeeded");
    for (let i = 2; i <= 3; i += 1)
      expect((await resumeExecution(api.db, executionId, `job-retry-${i}`)).outcome).toBe("stale");
    expect((await resultsOf(executionId)).map((r) => [r.attempt_no, r.ordinal, r.outcome])).toEqual([
      [1, 1, "done"],
      [2, 2, "done"],
    ]);
    // One done result per key; action 1's tasks were not created again; action 2 notified each recipient once.
    const keys = (await resultsOf(executionId)).map((r) => r.idempotency_key);
    expect(new Set(keys).size).toBe(2);
    expect((await itemsOf(executionId)).length).toBe(recipients);
    // Each recipient: the task's reminder (action 1) and the notification (action 2), once each.
    expect((await notificationsLike(`automation:${ruleCode}:`)).length).toBe(2 * recipients);
    const after = await call<Body>(api.app, "GET", `${F}/${failureId}`, { session: tech });
    expect(after.body).toMatchObject({ status: "resolved", allowedActions: [], version: 3 });
    expect(after.body.resolvedAt).not.toBeNull();
    const done = await call<Body>(api.app, "GET", `${E}/${executionId}`, { session: tech });
    expect(done.body).toMatchObject({ status: "succeeded", attemptNo: 2, errorCode: null });

    // A resolved entry cannot be retried or dismissed.
    const again = await call<Body>(api.app, "POST", `${F}/${failureId}/retry`, { session: tech, headers: ifm(3) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "automation_failure.not_open",
      "Only an open failure can be retried or dismissed.",
    ]);
  });
});

describe("dismiss, refusals, access (ADR-0043 §8, §9)", () => {
  it("dismiss: 400, 428, 409, AUD 403, 200 with its audit reason; then not_open for retry and dismiss", async () => {
    const { failureId } = await failedTransientExecution();
    const url = `${F}/${failureId}/dismiss`;
    const reason = { reason: "Synthetic: cause fixed by configuration." };
    expect((await call(api.app, "POST", url, { session: tech, headers: ifm(1), body: { reason: "x" } })).status).toBe(
      400,
    );
    expect((await call(api.app, "POST", url, { session: tech, body: reason })).status).toBe(428);
    expect((await call(api.app, "POST", url, { session: tech, headers: ifm(7), body: reason })).status).toBe(409);
    expect((await call(api.app, "POST", url, { session: auditor, headers: ifm(1), body: reason })).status).toBe(403);
    expect((await call(api.app, "POST", `${F}/${failureId}/retry`, { session: auditor, headers: ifm(1) })).status).toBe(
      403,
    );
    expect((await auditOf(api.db, failureId)).map((a) => a.action)).toEqual(["operational_failure.create"]);
    const ok = await call<Body>(api.app, "POST", url, { session: author.session, headers: ifm(1), body: reason });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      status: "dismissed",
      dismissedBy: author.userId,
      dismissReason: reason.reason,
      allowedActions: [],
    });
    const audit = await auditOf(api.db, failureId);
    expect(audit.map((a) => [a.action, a.reason, a.new_version])).toEqual([
      ["operational_failure.create", null, 1],
      ["operational_failure.dismiss", reason.reason, 2],
    ]);
    for (const path of ["retry", "dismiss"]) {
      const r = await call<Body>(api.app, "POST", `${F}/${failureId}/${path}`, {
        session: tech,
        headers: ifm(2),
        ...(path === "dismiss" ? { body: reason } : {}),
      });
      expect([r.status, r.body.code]).toEqual([422, "automation_failure.not_open"]);
    }
  });

  it("the 21st retry -> 422 automation_failure.retry_limit (each failed retry reopens the entry)", async () => {
    const envelope = gateDecidedEnvelope(w.orgA.id, { synthetic: true });
    const first = await captureJobFailure(api.db, {
      queue: "gates.decided",
      jobId: crypto.randomUUID(),
      data: envelope,
      attempts: 6,
      error: new Error("synthetic job fault"),
    });
    let version = 1;
    for (let n = 1; n <= 20; n += 1) {
      const r = await call<Body>(api.app, "POST", `${F}/${first.failureId}/retry`, {
        session: tech,
        headers: ifm(version),
      });
      expect([r.status, r.body.retryCount]).toEqual([200, n]);
      // The re-sent job fails again on its last attempt: the worker reopens the same entry.
      const again = await captureJobFailure(api.db, {
        queue: "gates.decided",
        jobId: failureRetryJobId(first.failureId, n),
        data: envelope,
        attempts: 6,
        error: new Error("synthetic job fault"),
      });
      expect(again).toEqual({ failureId: first.failureId, outcome: "reopened" });
      version += 2;
    }
    const entry = await call<Body>(api.app, "GET", `${F}/${first.failureId}`, { session: tech });
    expect(entry.body).toMatchObject({ status: "open", retryCount: 20, allowedActions: ["dismiss"] });
    const limit = await call<Body>(api.app, "POST", `${F}/${first.failureId}/retry`, {
      session: tech,
      headers: ifm(version),
    });
    expect([limit.status, limit.body.code, limit.body.detail]).toEqual([
      422,
      "automation_failure.retry_limit",
      "This failure has been retried 20 times; dismiss it or fix its cause first.",
    ]);
  });

  it("job failures are read with job.read and repaired with job.repair; rule readers never see them", async () => {
    const envelope = gateDecidedEnvelope(w.orgA.id, { synthetic: true });
    const job = await captureJobFailure(api.db, {
      queue: "benefits.finance_queue",
      jobId: crypto.randomUUID(),
      data: envelope,
      attempts: 6,
      error: new Error("synthetic job fault"),
    });
    const row = await api.db
      .selectFrom("operational_failure")
      .selectAll()
      .where("id", "=", job.failureId)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      source: "job",
      queue_name: "benefits.finance_queue",
      idempotency_key: envelope.idempotencyKey,
      organization_id: w.orgA.id,
      attempts: 6,
      status: "open",
    });
    // The internal job.failed event (ADR-0043 §7) is written with the entry.
    const failedEvents = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "payload"])
      .where("aggregate_id", "=", job.failureId)
      .execute();
    expect(failedEvents).toEqual([
      {
        event_type: "job.failed",
        payload: { queueName: "benefits.finance_queue", jobScheduleCode: null, failureId: job.failureId },
      },
    ]);
    // ADM_METHOD (automation.read/repair, no job.read): not visible, not repairable.
    expect((await call(api.app, "GET", `${F}/${job.failureId}`, { session: author.session })).status).toBe(404);
    const methodList = await call<Body>(api.app, "GET", `${F}?source=job&limit=100`, { session: author.session });
    expect(methodList.body.items).toEqual([]);
    expect(
      (await call(api.app, "POST", `${F}/${job.failureId}/retry`, { session: author.session, headers: ifm(1) })).status,
    ).toBe(404);
    // AUD (automation.read only): 404 to read, 403 to write.
    expect((await call(api.app, "GET", `${F}/${job.failureId}`, { session: auditor })).status).toBe(404);
    expect(
      (await call(api.app, "POST", `${F}/${job.failureId}/retry`, { session: auditor, headers: ifm(1) })).status,
    ).toBe(403);
    // ADM_TECH (job.read, job.repair): sees and retries it.
    const listed = await call<Body>(api.app, "GET", `${F}?source=job&limit=100`, { session: tech });
    expect(listed.body.items.find((i: Body) => i.id === job.failureId)?.allowedActions).toEqual(["retry", "dismiss"]);
    const r = await call<Body>(api.app, "POST", `${F}/${job.failureId}/retry`, { session: tech, headers: ifm(1) });
    expect([r.status, r.body.status]).toEqual([200, "retrying"]);
  });

  it("a reader of another organization sees none of org A's entries or executions; a no-grant user gets 403", async () => {
    const { executionId, failureId } = await failedTransientExecution();
    expect((await call(api.app, "GET", `${F}/${failureId}`, { session: officeB })).status).toBe(404);
    expect((await call(api.app, "GET", `${E}/${executionId}`, { session: officeB })).status).toBe(404);
    const list = await call<Body>(api.app, "GET", `${F}?limit=100`, { session: officeB });
    expect(list.body.items.some((i: Body) => i.organizationId === w.orgA.id)).toBe(false);
    const execs = await call<Body>(api.app, "GET", `${E}?limit=100`, { session: officeB });
    expect(execs.body.items.some((i: Body) => i.organizationId === w.orgA.id)).toBe(false);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", F, { session: nobody })).status).toBe(403);
    expect((await call(api.app, "GET", E, { session: nobody })).status).toBe(403);
    // Readable (AUD @ A) but repair only in org B: 403 on org A's entry.
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "AUD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgB.id }, w.orgB.id);
    const split = await signIn(api.app, u.subject);
    expect((await call(api.app, "GET", `${F}/${failureId}`, { session: split })).status).toBe(200);
    expect((await call(api.app, "POST", `${F}/${failureId}/retry`, { session: split, headers: ifm(1) })).status).toBe(
      403,
    );
  });

  it("commit-time re-authorization: a repair right revoked mid-request -> 403, nothing written", async () => {
    const { failureId, executionId } = await failedTransientExecution();
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", `${F}/${failureId}/retry`, { session: s, headers: ifm(1) }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("operational_failure")
      .select(["status", "version"])
      .where("id", "=", failureId)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "open", version: 1 });
    const exec = await api.db
      .selectFrom("automation_execution")
      .select(["status", "attempt_no"])
      .where("id", "=", executionId)
      .executeTakeFirstOrThrow();
    expect(exec).toEqual({ status: "failed", attempt_no: 1 });
  });

  it("lists executions newest first with filters and a stable cursor", async () => {
    const { executionId } = await failedTransientExecution();
    const exec = await api.db
      .selectFrom("automation_execution")
      .select("automation_rule_id")
      .where("id", "=", executionId)
      .executeTakeFirstOrThrow();
    const byRule = await call<Body>(api.app, "GET", `${E}?ruleId=${exec.automation_rule_id}&status=failed`, {
      session: author.session,
    });
    expect(byRule.status).toBe(200);
    expect(byRule.body.items.map((i: Body) => i.id)).toEqual([executionId]);
    const page1 = await call<Body>(api.app, "GET", `${E}?limit=1`, { session: author.session });
    expect(page1.body.items).toHaveLength(1);
    expect(page1.body.nextCursor).not.toBeNull();
    const page2 = await call<Body>(api.app, "GET", `${E}?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`, {
      session: author.session,
    });
    expect(page2.status).toBe(200);
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
  });
});

describe("parity: the API's identity.ts and the worker's decide alike (ADR-0002 rule 5)", () => {
  it("gives the same decision on every scope x target x identity x permission combination", () => {
    const orgs = ["o1", "o2"];
    const txs = ["t1", "t2"];
    const scopes: AuthorizationInput["scope"][] = [
      { level: "platform", organizationId: null, transformationId: null },
      { level: "organization", organizationId: "o1", transformationId: null },
      { level: "transformation", organizationId: "o1", transformationId: "t1" },
    ];
    const identities: AuthorizationInput["identity"][] = [
      { runAs: "service", permissions: [] },
      { runAs: "service", permissions: ["procedure.launch"] },
      { runAs: "initiating_user", userId: "u1" },
    ];
    let n = 0;
    const outcomes = new Set<string>();
    for (const scope of scopes)
      for (const o of orgs)
        for (const t of txs)
          for (const identity of identities)
            for (const requiredPermission of [null, "procedure.launch"])
              for (const initiatingUserHolds of identity.runAs === "initiating_user" ? [true, false] : [null]) {
                const input: AuthorizationInput = {
                  scope,
                  target: { organizationId: o, transformationId: t },
                  identity,
                  requiredPermission,
                  initiatingUserHolds,
                };
                const a = apiDecide(input);
                expect(workerDecide(input)).toEqual(a);
                outcomes.add(a.allowed ? "allowed" : a.reason);
                n += 1;
              }
    expect(n).toBe(3 * 2 * 2 * 4 * 2);
    expect([...outcomes].sort()).toEqual([
      "allowed",
      "identity_lacks_permission",
      "outside_rule_scope",
      "service_permission_missing",
    ]);
  });
});
