// A13 "Durable automation" for P5 (qa-verifier, T-DG5-QA-F): "Retried events, worker restarts and partial failures do
// not duplicate approvals, measurements or notifications; failed jobs remain recoverable" (master prompt §20).
//
// Binding row texts (docs/delivery/requirements.csv), each tested literally:
//  - REQ-S12-001 "each execution is recorded with rule version, trigger event and outcome";
//  - REQ-S12-002 "a dry-run creates no tasks; a failed execution appears in the queue and succeeds on retry without
//    duplicating actions";
//  - REQ-S12-020 "killing the worker mid-job and restarting completes the job once; after the retry limit it lands in
//    the failure queue";
//  - REQ-S12-021 "replaying the same event three times yields one reminder, one action and one approval task";
//  - REQ-S12-026 "saving a rule with action 'approve gate' is rejected; all automatic preparation and reminder rules
//    run".
// Derived from docs/api/openapi.yaml (automation and failure-queue operations) and ADR-0043 §2-§5, §9. Driven through
// the REAL API (inject) and the REAL worker (startWorker; one run in a separate OS process that is SIGKILLed) on this
// file's own scratch database; "no duplicate" is asserted on database rows. The disclosed fault injection is described
// in tests/qa/support/a13-durable.ts. All data is SYNTHETIC; nothing approves anything real.
import type { RunningWorker } from "../../../apps/worker/src/index.ts";
import { ensureQueues, QUEUES } from "../../../apps/worker/src/index.ts";
import { QUEUES_FOR_EVENT } from "../../../apps/worker/src/queues/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  actionResultsOf,
  CHILD_APP_NAME,
  childWorker,
  clearFault,
  EXECUTIONS,
  effectsOf,
  etagOf,
  executionsOf,
  FAILURES,
  followUpTask,
  inProcessWorker,
  installFaults,
  liveRule,
  newTransformation,
  orgWorld,
  outboxOf,
  QA_QUEUE_POLICY,
  qaBoss,
  RULES,
  sampleFrom,
  scratchEnv,
  setFault,
  taskAndReminder,
  updateDueReminder,
  waitFor,
  type Body,
  type OrgWorld,
  type ScratchEnv,
} from "../support/a13-durable.ts";
import { call, expectProblem, uniq } from "../support/api.ts";
import { seedNativeGateWorld, submitGate, missingKeys, coverWithException } from "../support/gates-native.ts";
import { seedWorld } from "../support/p4.ts";

let env: ScratchEnv;
let boss: ReturnType<typeof qaBoss>;
let worker: RunningWorker | null = null;

const LOCK = 7313013;

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13f");
  await installFaults(env.su);
  boss = qaBoss(env.appUrl, "qa-a13f-boss");
  await boss.start();
  await ensureQueues(boss, QA_QUEUE_POLICY);
  // A killed worker's jobs are re-delivered after their expiry (ADR-0043 §5): 3 s for the queue under test and 20 s
  // for every other queue (the killed worker may also hold, e.g., a transformation.created job) instead of pg-boss's
  // 15 min. Expiry is copied into each job when it is created, so this is set before any event exists.
  await env.su.query("UPDATE pgboss.queue SET expire_seconds = 20 WHERE name <> 'automation.evaluate'");
  await boss.updateQueue("automation.evaluate", { name: "automation.evaluate", expireInSeconds: 3 } as never);
}, 120_000);

afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await env?.close();
});

/** Effects of `ruleCode` for one transformation: tasks (create_task, ordinal 1) and reminders (notify, ordinal 2). */
async function effectsFor(ruleCode: string, transformationId: string) {
  const { items, notes } = await effectsOf(env.api, ruleCode);
  const [event] = await outboxOf(env.api, transformationId);
  const key = event!.idempotency_key;
  return {
    tasks: items.filter((i) => i.dedupe_key.includes(`${key}:1:`)),
    reminders: notes.filter((n) => String(n.dedupe_key).includes(`${key}:2:`)),
    allItems: items.filter((i) => i.dedupe_key.includes(key)),
    allNotes: notes.filter((n) => String(n.dedupe_key).includes(key)),
    key,
  };
}

async function executionFor(ruleId: string, triggerKey: string) {
  return (await executionsOf(env.api, ruleId)).filter((e) => e.trigger_key === triggerKey);
}

/** No pg-boss job is waiting, active or retrying (the worker is idle); ops.failed is the dead letter, never consumed. */
async function queueDrained(ms = 60_000) {
  const pending = async () =>
    (
      await env.su.query(
        "SELECT name, state, count(*)::int AS n FROM pgboss.job WHERE name <> 'ops.failed' AND state IN ('created', 'retry', 'active') AND start_after <= now() + interval '2 seconds' GROUP BY 1, 2",
      )
    ).rows;
  await waitFor(async () => (await pending()).length === 0, "the worker's queues drained", ms).catch(async (e) => {
    throw new Error(`${String(e)}: ${JSON.stringify(await pending())}`);
  });
}

async function openFailuresOfExecution(executionId: string) {
  return env.api.db
    .selectFrom("operational_failure")
    .selectAll()
    .where("automation_execution_id", "=", executionId)
    .execute();
}

describe("REQ-S12-020: killing the worker mid-job and restarting completes the job once", () => {
  it(
    "a real worker process is SIGKILLed inside the rule's action; the restarted worker completes it exactly once",
    { timeout: 180_000 },
    async () => {
      const w = await orgWorld(env.api);
      const t0 = await newTransformation(env.api, w, "sample");
      const rule = await liveRule(env.api, w, "qa_a13_kill", taskAndReminder(), await sampleFrom(env.api, t0.id));

      // The fault: the rule's task insert waits on a lock this test holds, i.e. the job is inside its transaction.
      await setFault(env.su, `automation:${rule.code}:%`, "block");
      const holder = await env.su.connect();
      await holder.query("SELECT pg_advisory_lock($1)", [LOCK]);
      let released = false;
      try {
        const t1 = await newTransformation(env.api, w, "killed");
        const { child, output } = await childWorker(env.appUrl);
        const exited = new Promise<number | null>((r) => child.once("exit", (code) => r(code)));
        await waitFor(
          async () =>
            (
              await env.su.query(
                `SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE l.locktype = 'advisory' AND NOT l.granted AND a.application_name = $1`,
                [CHILD_APP_NAME],
              )
            ).rowCount! > 0,
          "the child worker blocked inside the rule's task insert",
          60_000,
        ).catch((e) => {
          throw new Error(`${String(e)}\nchild output:\n${output()}`);
        });
        child.kill("SIGKILL");
        expect(await exited, "the child was killed by a signal").toBeNull();
        // The database server ends the dead client's sessions (in production: TCP keepalive / idle-in-transaction
        // timeout); their open transactions roll back. Nothing of the killed attempt is committed.
        await env.su.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1", [
          CHILD_APP_NAME,
        ]);
        await waitFor(
          async () =>
            (await env.su.query("SELECT 1 FROM pg_stat_activity WHERE application_name = $1", [CHILD_APP_NAME]))
              .rowCount === 0,
          "the killed worker's sessions are gone",
        );
        const before = await effectsFor(rule.code, t1.id);
        expect(before.tasks, "no task was committed by the killed attempt").toHaveLength(0);
        expect(before.reminders).toHaveLength(0);

        // Restart: the cause is gone, the production worker starts again in this process.
        await clearFault(env.su, `automation:${rule.code}:%`);
        await holder.query("SELECT pg_advisory_unlock($1)", [LOCK]);
        released = true;
        worker = await inProcessWorker(env, boss);

        const [exec] = await waitFor(
          async () => {
            const rows = await executionFor(rule.id, before.key);
            return rows[0]?.status === "succeeded" ? rows : null;
          },
          "the restarted worker completes the execution",
          90_000,
        );
        expect(await executionFor(rule.id, before.key), "one execution for the event").toHaveLength(1);
        const after = await effectsFor(rule.code, t1.id);
        expect(after.tasks, "exactly one task").toHaveLength(1);
        expect(after.reminders, "exactly one reminder").toHaveLength(1);
        expect(after.tasks[0]!.assignee_user_id).toBe(w.office.id);
        const results = await actionResultsOf(env.api, exec!.id);
        for (const ordinal of [1, 2])
          expect(
            results.filter((r) => r.ordinal === ordinal && r.outcome === "done"),
            `one done result for action ${ordinal}`,
          ).toHaveLength(1);
        expect(await openFailuresOfExecution(exec!.id), "a recovered job never enters the failure queue").toEqual([]);
      } finally {
        if (!released) await holder.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => undefined);
        holder.release();
      }
    },
  );
});

describe("REQ-S12-001: each execution is recorded with rule version, trigger event and outcome", () => {
  beforeAll(async () => {
    worker ??= await inProcessWorker(env, boss); // when the first suite failed before its restart
  });
  it("the execution history names the rule, its version, the trigger event and the outcome, per action", async () => {
    const w = await orgWorld(env.api);
    const t0 = await newTransformation(env.api, w, "history-sample");
    const rule = await liveRule(env.api, w, "qa_a13_hist", taskAndReminder(), await sampleFrom(env.api, t0.id));
    const t1 = await newTransformation(env.api, w, "history");
    const { key } = await effectsFor(rule.code, t1.id);
    await waitFor(async () => (await executionFor(rule.id, key))[0]?.status === "succeeded", "execution succeeded");

    const page = await call<Body>(env.api.app, "GET", `${EXECUTIONS}?ruleId=${rule.id}&limit=100`, {
      session: w.auditor.session,
    });
    expect(page.status).toBe(200);
    const listed = (page.body.items as Body[]).filter((e) => e.triggerKey === key);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      ruleId: rule.id,
      ruleCode: rule.code,
      versionId: rule.versionId,
      versionNo: rule.versionNo,
      triggerCode: "transformation.created",
      triggerKey: key,
      organizationId: w.orgId,
      status: "succeeded",
      attemptNo: 1,
      errorCode: null,
    });
    const one = await call<Body>(env.api.app, "GET", `${EXECUTIONS}/${listed[0].id}`, { session: w.auditor.session });
    expect(one.status).toBe(200);
    expect(
      (one.body.actionResults as Body[]).map((r) => [r.ordinal, r.actionType ?? r.type, r.outcome]).sort(),
    ).toEqual([
      [1, "create_task", "done"],
      [2, "notify", "done"],
    ]);
    // A non-reader of automation (a TL) cannot read the history.
    const lead = await call<Body>(env.api.app, "GET", `${EXECUTIONS}?ruleId=${rule.id}`, { session: w.lead.session });
    expectProblem(lead, 403, lead.body.type);
  });
});

describe("REQ-S12-002: a dry-run creates no tasks", () => {
  it(
    "evaluates the draft against a sample event and writes no task, notification, execution or outbox event",
    { timeout: 90_000 },
    async () => {
      const w = await orgWorld(env.api);
      const t0 = await newTransformation(env.api, w, "dry-run-sample");
      const code = `qa_a13_dry_${uniq("").toLowerCase()}`;
      const created = await call<Body>(env.api.app, "POST", RULES, {
        session: w.method.session,
        headers: { "if-match": '"0"' },
        body: {
          code,
          nameEn: "Synthetic A13 dry-run rule",
          nameAr: "قاعدة تجريبية للتشغيل التجريبي",
          scopeLevel: "organization",
          organizationId: w.orgId,
          ownerUserId: w.method.id,
          content: taskAndReminder(),
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      // Let the worker settle what the setup produced (the starter's work for t0): every job finished, then count.
      await waitFor(async () => ((await outboxOf(env.api, t0.id))[0]?.published_at ?? null) !== null, "t0 relayed");
      await queueDrained();
      const count = async () => {
        const n = async (table: "work_item" | "inbox_notification" | "automation_execution" | "outbox_event") =>
          Number(
            (
              await env.api.db
                .selectFrom(table)
                .select((eb) => eb.fn.countAll<string>().as("n"))
                .executeTakeFirstOrThrow()
            ).n,
          );
        return {
          workItems: await n("work_item"),
          notifications: await n("inbox_notification"),
          executions: await n("automation_execution"),
          outbox: await n("outbox_event"),
        };
      };
      const before = await count();
      const dry = await call<Body>(env.api.app, "POST", `${RULES}/${created.body.id}/versions/1/dry-runs`, {
        session: w.method.session,
        body: await sampleFrom(env.api, t0.id),
      });
      expect(dry.status, JSON.stringify(dry.body)).toBe(201);
      expect(dry.body.outcome).toBe("pass");
      expect((dry.body.plannedActions as Body[]).map((p) => [p.actionType, p.outcome])).toEqual([
        ["create_task", "would_run"],
        ["notify", "would_run"],
      ]);
      await new Promise((r) => setTimeout(r, 1500));
      await queueDrained();
      const after = await count();
      const newItems = await env.api.db
        .selectFrom("work_item")
        .select(["kind", "dedupe_key", "created_at"])
        .where("organization_id", "=", w.orgId)
        .execute();
      expect(
        after,
        `a dry run writes no task, notification, execution or event; org work items: ${JSON.stringify(newItems)}`,
      ).toEqual(before);
      expect((await effectsOf(env.api, code)).items).toEqual([]);
      expect((await effectsOf(env.api, code)).notes).toEqual([]);
    },
  );
});

describe("REQ-S12-020 + REQ-S12-002: after the retry limit the execution lands in the failure queue; it succeeds on retry without duplicating actions", () => {
  let w: OrgWorld;
  let rule: Awaited<ReturnType<typeof liveRule>>;
  beforeAll(async () => {
    w = await orgWorld(env.api);
    const t0 = await newTransformation(env.api, w, "retry-sample");
    rule = await liveRule(env.api, w, "qa_a13_retry", taskAndReminder(), await sampleFrom(env.api, t0.id));
    worker ??= await inProcessWorker(env, boss); // when the first suite failed before its restart
  }, 60_000);

  async function failedOnce(label: string) {
    // Partial failure: the task (action 1) is written, the reminder (action 2) throws on every attempt.
    const t = await newTransformation(env.api, w, label);
    const [event] = await outboxOf(env.api, t.id);
    const pattern = `automation:${rule.code}:${event!.idempotency_key}:2:%`;
    await setFault(env.su, pattern, "raise");
    const failure = await waitFor(
      async () => {
        const r = await call<Body>(env.api.app, "GET", `${FAILURES}?source=rule_execution&status=open&limit=100`, {
          session: w.method.session,
        });
        expect(r.status).toBe(200);
        const [exec] = await executionFor(rule.id, event!.idempotency_key);
        return exec ? (r.body.items as Body[]).find((f) => f.executionId === exec.id) : null;
      },
      "the failed execution appears in the failure queue",
      60_000,
    );
    // The pg-boss attempt the entry appeared in (retry_count counts the retries already started).
    const atAppearance = (
      await env.su.query(
        "SELECT retry_count FROM pgboss.job WHERE name = 'automation.evaluate' AND data->>'outboxEventId' = $1",
        [event!.id],
      )
    ).rows.map((j) => j.retry_count as number);
    return { t, pattern, failure, key: event!.idempotency_key, atAppearance };
  }

  it(
    "bounded retries: after 1 + retryLimit attempts ONE rule-execution entry is in the queue; the task is not doubled",
    { timeout: 120_000 },
    async () => {
      const { t, failure: first, key, pattern, atAppearance } = await failedOnce("retry");
      try {
        // Let pg-boss finish every attempt of the event's automation.evaluate job, then read the entry again.
        const [event] = await outboxOf(env.api, t.id);
        const jobs = await waitFor(
          async () => {
            const r = await env.su.query(
              "SELECT id, state, retry_count, retry_limit FROM pgboss.job WHERE name = 'automation.evaluate' AND data->>'outboxEventId' = $1",
              [event!.id],
            );
            return r.rows.length > 0 && r.rows.every((j) => ["completed", "failed", "cancelled"].includes(j.state))
              ? r.rows
              : null;
          },
          "the event's automation.evaluate job reached a final state",
          60_000,
        );
        const failure = (await call<Body>(env.api.app, "GET", `${FAILURES}/${first.id}`, { session: w.method.session }))
          .body;
        const execNow = (await executionFor(rule.id, key))[0];
        const diag = JSON.stringify({
          jobs,
          failure: { attempts: failure.attempts, errorCode: failure.errorCode, status: failure.status },
          execution: { status: execNow?.status, error_code: execNow?.error_code, attempt_no: execNow?.attempt_no },
        });
        expect(failure).toMatchObject({ source: "rule_execution", status: "open", retryCount: 0 });
        // Bounded: the job was attempted 1 + retryLimit times and then dead-lettered (pg-boss state failed) ...
        expect(
          jobs.map((j) => [j.state, j.retry_count]),
          diag,
        ).toEqual([["failed", QA_QUEUE_POLICY.retryLimit]]);
        // ... and the entry appeared only on the LAST attempt, not before (no queue entry for a transient error).
        expect(atAppearance, `the entry appeared during attempt retry_count=${atAppearance}; ${diag}`).toEqual([
          QA_QUEUE_POLICY.retryLimit,
        ]);
        expect(failure.errorCode, diag).toBe("automation.retries_exhausted");
        // ONE rule-execution entry for the failed execution. (The worker's generic job capture also files a `job` entry
        // for the same delivery, ADR-0043 §5; the next test retries both and checks that nothing is duplicated.)
        const sameWork = await env.api.db
          .selectFrom("operational_failure")
          .select(["id", "source", "queue_name", "idempotency_key", "status"])
          .where((eb) => eb.or([eb("automation_execution_id", "=", execNow!.id), eb("idempotency_key", "=", key)]))
          .execute();
        expect(
          sameWork.filter((f) => f.source === "rule_execution"),
          `one rule-execution entry: ${JSON.stringify(sameWork)}`,
        ).toHaveLength(1);
        expect(sameWork.filter((f) => f.source === "job").length, JSON.stringify(sameWork)).toBeLessThanOrEqual(1);
        expect(failure.allowedActions).toEqual(["retry", "dismiss"]);
        const execs = await executionFor(rule.id, key);
        expect(execs).toHaveLength(1);
        expect(execs[0]).toMatchObject({ status: "failed" });
        expect(await openFailuresOfExecution(execs[0]!.id)).toHaveLength(1);
        const e = await effectsFor(rule.code, t.id);
        expect(e.tasks, "the completed action is not repeated by the automatic retries").toHaveLength(1);
        expect(e.reminders).toHaveLength(0);
      } finally {
        await clearFault(env.su, pattern);
      }
    },
  );

  it(
    "an admin retries it from the queue: it succeeds once; completed actions are not repeated; a second retry is refused",
    { timeout: 120_000 },
    async () => {
      const { t, failure, key, pattern } = await failedOnce("retry-ok");
      await clearFault(env.su, pattern); // the cause is fixed
      const url = `${FAILURES}/${failure.id}/retry`;
      expectProblem(
        await call<Body>(env.api.app, "POST", url, { session: w.method.session }),
        428,
        expect.any(String) as never,
      );
      const asAud = await call<Body>(env.api.app, "POST", url, {
        session: w.auditor.session,
        headers: { "if-match": `"${failure.version}"` },
      });
      expectProblem(asAud, 403, asAud.body.type);
      const stale = await call<Body>(env.api.app, "POST", url, {
        session: w.method.session,
        headers: { "if-match": `"${failure.version + 7}"` },
      });
      expectProblem(stale, 409, stale.body.type);

      const retried = await call<Body>(env.api.app, "POST", url, {
        session: w.method.session,
        headers: { "if-match": `"${failure.version}"` },
      });
      expect(retried.status, JSON.stringify(retried.body)).toBe(200);
      expect(["retrying", "resolved"]).toContain(retried.body.status);
      expect(retried.body.retryCount).toBe(1);
      expect(retried.body.idempotencyKey, "a retry keeps the original idempotency key").toBe(failure.idempotencyKey);
      const resolved = await waitFor(
        async () => {
          const r = await call<Body>(env.api.app, "GET", `${FAILURES}/${failure.id}`, { session: w.method.session });
          return r.body.status === "resolved" ? r.body : null;
        },
        "the retried failure is resolved",
        60_000,
      );
      expect(resolved.resolvedAt).not.toBeNull();
      const [exec] = await executionFor(rule.id, key);
      expect(exec).toMatchObject({ status: "succeeded" });
      expect(await executionFor(rule.id, key)).toHaveLength(1);
      const e = await effectsFor(rule.code, t.id);
      expect(e.tasks, "one task after the retry (not two)").toHaveLength(1);
      expect(e.reminders, "one reminder after the retry").toHaveLength(1);
      const results = await actionResultsOf(env.api, exec!.id);
      for (const ordinal of [1, 2])
        expect(results.filter((r) => r.ordinal === ordinal && r.outcome === "done")).toHaveLength(1);

      const again = await call<Body>(env.api.app, "POST", url, {
        session: w.method.session,
        headers: { "if-match": `"${resolved.version}"` },
      });
      expectProblem(again, 422, again.body.type);
      expect(again.body.code).toBe("automation_failure.not_open");
      await new Promise((r) => setTimeout(r, 1500));
      expect((await effectsFor(rule.code, t.id)).tasks).toHaveLength(1);
      expect((await effectsFor(rule.code, t.id)).reminders).toHaveLength(1);
    },
  );

  it(
    "both queue entries of one failed execution (the job entry and the rule-execution entry) are retried: one task, one reminder",
    { timeout: 120_000 },
    async () => {
      const { t, failure, key, pattern } = await failedOnce("retry-both");
      // The worker files its job entry on the same last attempt; wait for it, then fix the cause.
      const jobEntry = await waitFor(
        async () => {
          const r = await call<Body>(env.api.app, "GET", `${FAILURES}?source=job&status=open&limit=100`, {
            session: w.tech.session,
          });
          expect(r.status).toBe(200);
          return (r.body.items as Body[]).find((f) => f.idempotencyKey === key) ?? null;
        },
        "the job entry of the same delivery (ADR-0043 §5 job capture)",
        15_000,
      );
      await clearFault(env.su, pattern);
      if (jobEntry) {
        expect(jobEntry).toMatchObject({ source: "job", queueName: "automation.evaluate", status: "open" });
        const viaJob = await call<Body>(env.api.app, "POST", `${FAILURES}/${jobEntry.id}/retry`, {
          session: w.tech.session,
          headers: { "if-match": `"${jobEntry.version}"` },
        });
        expect(viaJob.status, JSON.stringify(viaJob.body)).toBe(200);
        await waitFor(
          async () => {
            const r = await call<Body>(env.api.app, "GET", `${FAILURES}/${jobEntry.id}`, { session: w.tech.session });
            return ["resolved", "open"].includes(r.body.status) ? r.body : null;
          },
          "the job entry's retry finished",
          60_000,
        );
        await queueDrained();
      }
      const current = (await call<Body>(env.api.app, "GET", `${FAILURES}/${failure.id}`, { session: w.method.session }))
        .body;
      if (current.status === "open") {
        const viaRule = await call<Body>(env.api.app, "POST", `${FAILURES}/${failure.id}/retry`, {
          session: w.method.session,
          headers: { "if-match": `"${current.version}"` },
        });
        expect(viaRule.status, JSON.stringify(viaRule.body)).toBe(200);
        await waitFor(
          async () => {
            const r = await call<Body>(env.api.app, "GET", `${FAILURES}/${failure.id}`, { session: w.method.session });
            return r.body.status === "resolved" ? r.body : null;
          },
          "the rule-execution entry resolved",
          60_000,
        );
      }
      await queueDrained();
      const [exec] = await executionFor(rule.id, key);
      expect(exec, "the execution succeeded after the repairs").toMatchObject({ status: "succeeded" });
      expect(await executionFor(rule.id, key)).toHaveLength(1);
      const e = await effectsFor(rule.code, t.id);
      expect(e.tasks, "one task after both repairs").toHaveLength(1);
      expect(e.reminders, "one reminder after both repairs").toHaveLength(1);
      const left = await env.api.db
        .selectFrom("operational_failure")
        .select(["source", "status"])
        .where((eb) => eb.or([eb("automation_execution_id", "=", exec!.id), eb("idempotency_key", "=", key)]))
        .execute();
      expect(
        left.filter((f) => f.status === "open" || f.status === "retrying"),
        `no entry of the repaired work stays open: ${JSON.stringify(left)}`,
      ).toEqual([]);
    },
  );

  it(
    "a dismissed failure records who and why, adds no effect, and can no longer be retried",
    { timeout: 120_000 },
    async () => {
      const { t, failure, pattern } = await failedOnce("dismiss");
      try {
        const url = `${FAILURES}/${failure.id}/dismiss`;
        const d = await call<Body>(env.api.app, "POST", url, {
          session: w.method.session,
          headers: { "if-match": `"${failure.version}"` },
          body: { reason: "Synthetic QA: the reminder is no longer needed." },
        });
        expect(d.status, JSON.stringify(d.body)).toBe(200);
        expect(d.body).toMatchObject({
          status: "dismissed",
          dismissedBy: w.method.id,
          dismissReason: "Synthetic QA: the reminder is no longer needed.",
        });
        const r = await call<Body>(env.api.app, "POST", `${FAILURES}/${failure.id}/retry`, {
          session: w.method.session,
          headers: { "if-match": `"${d.body.version}"` },
        });
        expectProblem(r, 422, r.body.type);
        expect(r.body.code).toBe("automation_failure.not_open");
        const e = await effectsFor(rule.code, t.id);
        expect(e.tasks).toHaveLength(1);
        expect(e.reminders).toHaveLength(0);
      } finally {
        await clearFault(env.su, pattern);
      }
    },
  );
});

describe("REQ-S12-021: replaying the same event three times yields one reminder, one action and one approval task", () => {
  it(
    "the admin rule's event re-relayed x3 and re-delivered x3: one execution, one task (action), one reminder",
    { timeout: 120_000 },
    async () => {
      const w = await orgWorld(env.api);
      const t0 = await newTransformation(env.api, w, "replay-sample");
      const rule = await liveRule(env.api, w, "qa_a13_replay", taskAndReminder(), await sampleFrom(env.api, t0.id));
      const t = await newTransformation(env.api, w, "replay");
      const [event] = await outboxOf(env.api, t.id);
      await waitFor(
        async () => (await executionFor(rule.id, event!.idempotency_key))[0]?.status === "succeeded",
        "first processing",
      );
      const envelope = {
        outboxEventId: event!.id,
        eventType: event!.event_type,
        schemaVersion: event!.schema_version,
        idempotencyKey: event!.idempotency_key,
        organizationId: event!.organization_id,
        payload: typeof event!.payload === "string" ? JSON.parse(event!.payload) : event!.payload,
      };
      for (let i = 0; i < 3; i++) {
        // A relay crash window: the row looks unpublished again and is sent again.
        await env.su.query("UPDATE outbox_event SET published_at = NULL WHERE id = $1", [event!.id]);
        await waitFor(
          async () => ((await outboxOf(env.api, t.id))[0]?.published_at ?? null) !== null,
          `re-relay ${i + 1}`,
        );
        // A redelivery of the same message under a new job id.
        const id = await boss.send("automation.evaluate", envelope);
        await waitFor(
          async () => {
            const r = await env.su.query("SELECT state FROM pgboss.job WHERE id = $1", [id]);
            return r.rows[0]?.state === "completed";
          },
          `redelivery ${i + 1} completed`,
        );
      }
      expect(await executionFor(rule.id, event!.idempotency_key), "one execution").toHaveLength(1);
      const e = await effectsFor(rule.code, t.id);
      expect(e.tasks, "one action (task)").toHaveLength(1);
      expect(e.reminders, "one reminder").toHaveLength(1);
      expect(e.allItems).toHaveLength(1);
    },
  );

  it(
    "a gate submission's event re-relayed x3 and re-delivered x3 to every consumer: one approval task",
    { timeout: 180_000 },
    async () => {
      const world = await seedWorld(env.api.db);
      const g = await seedNativeGateWorld(env.api, world, "A13");
      for (const key of await missingKeys(env.api, g, "G1"))
        await coverWithException(env.api, g, "G1", key, "2027-12-31");
      const sub = await submitGate(env.api, g, "G1");
      expect(sub.status, JSON.stringify(sub.body)).toBe(201);
      const submitted = await waitFor(async () => {
        const rows = await outboxOf(env.api, sub.body.gateInstanceId ?? sub.body.id, "gate.submitted");
        if (rows.length) return rows[0];
        const any = await env.api.db
          .selectFrom("outbox_event")
          .selectAll()
          .where("event_type", "=", "gate.submitted")
          .where("organization_id", "=", g.organizationId)
          .execute();
        return any.find((r) => JSON.stringify(r.payload).includes(g.transformationId));
      }, "the gate.submitted event");
      const approvalTasks = () =>
        env.api.db
          .selectFrom("work_item")
          .selectAll()
          .where("transformation_id", "=", g.transformationId)
          .where("assignee_user_id", "=", g.sp.id)
          .where("kind", "=", "gate_decision_due") // the approver task of a gate submission (My Work: approvals)
          .execute();
      const settled = async () => {
        await waitFor(async () => {
          const r = await env.su.query(
            "SELECT count(*)::int AS n FROM pgboss.job WHERE data->>'outboxEventId' = $1 AND state NOT IN ('completed','failed','cancelled')",
            [submitted.id],
          );
          return r.rows[0].n === 0;
        }, "every job of the gate.submitted event finished");
      };
      await waitFor(async () => (await approvalTasks()).length > 0, "the Sponsor's approval task", 60_000).catch(
        async (e) => {
          const kinds = await env.api.db
            .selectFrom("work_item")
            .select(["kind", "assignee_user_id"])
            .where("transformation_id", "=", g.transformationId)
            .execute();
          throw new Error(`${String(e)}; work items of the transformation: ${JSON.stringify(kinds)}; sp=${g.sp.id}`);
        },
      );
      await settled();
      const snapshot = async () => ({
        tasks: (await approvalTasks()).map((r) => r.id).sort(),
        allItems: (
          await env.api.db
            .selectFrom("work_item")
            .select("id")
            .where("transformation_id", "=", g.transformationId)
            .execute()
        )
          .map((r) => r.id)
          .sort(),
        notifications: Number(
          (
            await env.su.query("SELECT count(*)::int AS n FROM inbox_notification WHERE organization_id = $1", [
              g.organizationId,
            ])
          ).rows[0].n,
        ),
      });
      const first = await snapshot();
      expect(first.tasks, "one approval task for the Sponsor").toHaveLength(1);

      const envelope = {
        outboxEventId: submitted.id,
        eventType: submitted.event_type,
        schemaVersion: submitted.schema_version,
        idempotencyKey: submitted.idempotency_key,
        organizationId: submitted.organization_id,
        payload: typeof submitted.payload === "string" ? JSON.parse(submitted.payload) : submitted.payload,
      };
      const consumers = QUEUES_FOR_EVENT["gate.submitted"] ?? [];
      expect(consumers.length, "gate.submitted has consumers").toBeGreaterThan(0);
      for (let i = 0; i < 3; i++) {
        await env.su.query("UPDATE outbox_event SET published_at = NULL WHERE id = $1", [submitted.id]);
        await waitFor(
          async () => {
            const r = await env.su.query("SELECT published_at FROM outbox_event WHERE id = $1", [submitted.id]);
            return (r.rows[0].published_at ?? null) !== null;
          },
          `re-relay ${i + 1}`,
        );
        for (const q of consumers) await boss.send(q, envelope);
        await settled();
      }
      expect(await snapshot(), "three replays add no approval task, work item or notification").toEqual(first);
    },
  );
});

describe("REQ-S12-026: saving a rule with action 'approve gate' is rejected; all automatic preparation and reminder rules run", () => {
  it("every human-only action type is refused with 422 automation_rule.human_only_action and nothing is saved", async () => {
    const w = await orgWorld(env.api);
    const cat = await call<Body>(env.api.app, "GET", "/api/v1/admin/automation-catalogue", {
      session: w.method.session,
    });
    expect(cat.status).toBe(200);
    const humanOnly = (cat.body.actionTypes as Body[]).filter((a) => a.actionClass === "human_only").map((a) => a.code);
    expect(humanOnly).toContain("approve_gate");
    expect(humanOnly.length).toBeGreaterThanOrEqual(1);
    for (const type of humanOnly) {
      const code = `qa_a13_human_${uniq("").toLowerCase()}`;
      const r = await call<Body>(env.api.app, "POST", RULES, {
        session: w.method.session,
        headers: { "if-match": '"0"' },
        body: {
          code,
          nameEn: "Synthetic human-only rule",
          nameAr: "قاعدة تجريبية لقرار بشري",
          scopeLevel: "organization",
          organizationId: w.orgId,
          ownerUserId: w.method.id,
          content: taskAndReminder([{ type, parameters: {} }]),
        },
      });
      expectProblem(r, 422, r.body.type);
      expect([type, r.body.code]).toEqual([type, "automation_rule.human_only_action"]);
      expect(
        await env.api.db.selectFrom("automation_rule").select("id").where("code", "=", code).execute(),
        `${type}: no rule saved`,
      ).toEqual([]);
    }
    // ... and a draft cannot be changed to one either.
    const code = `qa_a13_human_draft_${uniq("").toLowerCase()}`;
    const created = await call<Body>(env.api.app, "POST", RULES, {
      session: w.method.session,
      headers: { "if-match": '"0"' },
      body: {
        code,
        nameEn: "Synthetic draft",
        nameAr: "مسودة تجريبية",
        scopeLevel: "organization",
        organizationId: w.orgId,
        ownerUserId: w.method.id,
        content: taskAndReminder([followUpTask]),
      },
    });
    expect(created.status).toBe(201);
    const v1 = `${RULES}/${created.body.id}/versions/1`;
    const draft = await call<Body>(env.api.app, "GET", v1, { session: w.method.session });
    const patched = await call<Body>(env.api.app, "PATCH", v1, {
      session: w.method.session,
      headers: { "if-match": etagOf(draft) },
      body: { content: taskAndReminder([followUpTask, { type: "approve_gate", parameters: {} }]) },
    });
    expectProblem(patched, 422, patched.body.type);
    expect(patched.body.code).toBe("automation_rule.human_only_action");
    const still = await call<Body>(env.api.app, "GET", v1, { session: w.method.session });
    expect((still.body.content.actions as Body[]).map((a) => a.type)).toEqual(["create_task"]);
  });

  it("the sixteen starters (preparation, routing, calculation, reminders) are all enabled, cannot be disabled, and run", async () => {
    const w = await orgWorld(env.api);
    const list = await call<Body>(env.api.app, "GET", `${RULES}?origin=starter&limit=100`, {
      session: w.method.session,
    });
    expect(list.status).toBe(200);
    const starters = list.body.items as Body[];
    expect(starters).toHaveLength(16);
    for (const s of starters) expect([s.code, s.enabled, s.effectiveVersionId !== null]).toEqual([s.code, true, true]);
    const created = starters.find((s) => s.code === "starter.transformation_created")!;
    const one = await call<Body>(env.api.app, "GET", `${RULES}/${created.id}`, { session: w.method.session });
    const off = await call<Body>(env.api.app, "POST", `${RULES}/${created.id}/disable`, {
      session: w.method.session,
      headers: { "if-match": etagOf(one) },
      body: { reason: "Synthetic QA attempt to switch a guarantee off" },
    });
    expectProblem(off, 422, off.body.type);
    expect(off.body.code).toBe("automation_rule.guarantee_protected");
    // ... and it ran: the starter's execution for a new transformation of this organization is recorded.
    const t = await newTransformation(env.api, w, "starter-runs");
    const [event] = await outboxOf(env.api, t.id);
    const exec = await waitFor(
      async () => {
        const r = await call<Body>(env.api.app, "GET", `${EXECUTIONS}?ruleId=${created.id}&limit=100`, {
          session: w.method.session,
        });
        return (r.body.items as Body[]).find((e) => e.triggerKey === event!.idempotency_key && e.status !== "running");
      },
      "the transformation-created starter's execution",
      60_000,
    );
    expect(exec).toMatchObject({ ruleCode: "starter.transformation_created", status: "succeeded" });
  });
});

// The queue names used above are the contract's queues; a typo would make a replay test vacuous.
describe("A13 harness self-check", () => {
  it("automation.evaluate is a worker queue and the bounded QA policy is in force", async () => {
    expect(Object.values(QUEUES)).toEqual(expect.arrayContaining([expect.any(String)]));
    const r = await env.su.query(
      "SELECT retry_limit, expire_seconds FROM pgboss.queue WHERE name = 'automation.evaluate'",
    );
    expect(r.rows[0]).toMatchObject({ retry_limit: QA_QUEUE_POLICY.retryLimit, expire_seconds: 3 });
    expect(updateDueReminder.type).toBe("notify");
  });
});
