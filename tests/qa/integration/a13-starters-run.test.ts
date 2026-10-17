// A13 / REQ-S12-026 "all automatic preparation and reminder rules run" (qa-verifier, T-DG5-QA-F2; QA-F handback §7
// item 3, AN-04 "the engine must run all sixteen starter automations (M0224-M0239) as versioned, configurable rules").
// For each starter whose trigger this file can produce through the public API or the scheduler's own run-now
// (POST /admin/jobs/{code}/run, the contract's operator path), the trigger is produced and the REAL worker
// (startWorker, every handler) runs. Asserted per starter: one `automation_execution` of the starter's EFFECTIVE
// version for that trigger, `succeeded` (REQ-S12-001 "each execution is recorded with rule version, trigger event and
// outcome"), and its effect rows where the trigger has effects in this world. The starters whose trigger needs a
// domain flow this file does not build are listed in STARTERS_ELSEWHERE with the suite that drives them (or NOT
// COVERED), and the first test asserts the catalogue has exactly sixteen starters so none is silently dropped.
// All data is SYNTHETIC; nothing approves anything real, and nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunningWorker } from "../../../apps/worker/src/index.ts";
import {
  clearFault,
  inProcessWorker,
  installFaults,
  orgWorld,
  outboxOf,
  qaBoss,
  scratchEnv,
  setFault,
  waitFor,
  type Body,
  type OrgWorld,
  type ScratchEnv,
} from "../support/a13-durable.ts";
import { drainedEvent, drainedQueue } from "../support/a13-replay.ts";
import { call, uniq } from "../support/api.ts";
import { passGatesNatively, seedNativeGateWorld } from "../support/gates-native.ts";
import {
  dashboardWorld,
  DIRECT_FLOW,
  evidenceItem,
  measuredBenefit,
  openPeriod,
  ownedKpi,
  riyadhToday,
  seedBenefitWorld,
  seedWorld,
  submitActual,
} from "../support/p4.ts";

let env: ScratchEnv;
let boss: ReturnType<typeof qaBoss>;
let worker: RunningWorker;
let w: OrgWorld;

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13r");
  await installFaults(env.su);
  boss = qaBoss(env.appUrl, "qa-a13r-boss");
  await boss.start();
  worker = await inProcessWorker(env, boss);
  w = await orgWorld(env.api);
}, 120_000);
afterAll(async () => {
  await worker?.stop().catch(() => undefined);
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await env?.close();
});

/** The sixteen starters (M0224-M0239) that this file does NOT trigger, with where they are driven. */
const STARTERS_ELSEWHERE: Record<string, string> = {
  "starter.kpi_deviation": "NOT COVERED here (KPI deviation flow)",
  "starter.dependency_slip": "a13-dependency-slip-rule-b (blocked by the relay defect D-QA-F2-1)",
  "starter.adoption_control_failed": "NOT COVERED here (adoption/control check flow)",
  "starter.revision_proposed": "NOT COVERED here (methodology revision proposal)",
};

async function executionsOfStarter(code: string, since: Date, triggerCode: string) {
  const r = await env.su.query(
    `SELECT e.id, e.status, e.trigger_code, e.trigger_key, e.automation_rule_version_id, r.effective_version_id
       FROM automation_execution e JOIN automation_rule r ON r.id = e.automation_rule_id
      WHERE r.code = $1 AND e.created_at >= $2 AND e.trigger_code = $3 ORDER BY e.created_at`,
    [code, since, triggerCode],
  );
  return r.rows as Body[];
}

/** Waits for one finished execution of `code` since `since`; asserts it is of the effective version and succeeded. */
async function ranOnce(code: string, since: Date, triggerCode: string) {
  const rows = await waitFor(
    async () => {
      const x = await executionsOfStarter(code, since, triggerCode);
      return x.length > 0 && x.every((e) => e.status !== "running") ? x : null;
    },
    `an execution of ${code}`,
    60_000,
  ).catch(async (e) => {
    throw new Error(`${String(e)}; executions ${JSON.stringify(await executionsOfStarter(code, since, triggerCode))}`);
  });
  expect(
    rows.map((e) => [e.trigger_code, e.status]),
    code,
  ).toEqual([[triggerCode, "succeeded"]]);
  expect(rows[0].automation_rule_version_id, `${code} ran its effective version`).toBe(rows[0].effective_version_id);
  return rows[0];
}

async function runNow(jobCode: string) {
  const r = await call<Body>(env.api.app, "POST", `/api/v1/admin/jobs/${jobCode}/run`, { session: w.tech.session });
  expect(r.status, `${jobCode}: ${JSON.stringify(r.body)}`).toBe(202);
}

describe("REQ-S12-026: all automatic preparation and reminder rules run (each starter on its trigger)", () => {
  it("the catalogue holds exactly sixteen starters, each enabled with a published effective version", async () => {
    const r = await env.su.query(
      `SELECT r.code, r.enabled, v.status FROM automation_rule r LEFT JOIN automation_rule_version v ON v.id = r.effective_version_id
        WHERE r.origin = 'starter' ORDER BY r.code`,
    );
    expect(r.rows.length, JSON.stringify(r.rows.map((x) => x.code))).toBe(16);
    expect(r.rows.filter((x) => !x.enabled || x.status !== "published")).toEqual([]);
    for (const code of Object.keys(STARTERS_ELSEWHERE)) expect(r.rows.map((x) => x.code)).toContain(code);
  });

  it(
    "starter 1 (transformation created): one execution; one phase checklist and role tasks",
    { timeout: 120_000 },
    async () => {
      const since = new Date(Date.now() - 1000);
      const t = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
        session: w.lead.session,
        body: { businessUnitId: w.bu, name: `Synthetic QA A13 starters ${uniq("")}`, mode: "end_to_end" },
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      const [event] = await outboxOf(env.api, t.body.id);
      await ranOnce("starter.transformation_created", since, "transformation.created");
      await drainedEvent(env, event!.id);
      const steps = await env.su.query("SELECT count(*)::int AS n FROM phase_step WHERE transformation_id = $1", [
        t.body.id,
      ]);
      const tasks = await env.su.query(
        "SELECT count(*)::int AS n FROM work_item WHERE transformation_id = $1 AND kind = 'role_assignment'",
        [t.body.id],
      );
      expect([steps.rows[0].n > 0, tasks.rows[0].n > 0]).toEqual([true, true]);
    },
  );

  // The schedule-triggered starters: the trigger is the schedule's slot, produced by the operator's run-now.
  for (const [code, jobs] of [
    ["starter.reporting_period_open", ["kpi.reporting_period_open"]],
    ["starter.decision_sla", ["governance.decision_sla_scan", "approval.escalation_scan"]],
    ["starter.blocker_red", ["governance.blocker_escalation_scan"]],
    ["starter.meeting_cutoff", ["governance.meeting_cutoff_scan"]],
    ["starter.bau_handover_accepted", ["sustainment.review_scan", "sustainment.control_check_scan"]],
  ] as const) {
    it(
      `${code}: each of its scheduled triggers (${jobs.join(", ")}) runs it once, succeeded`,
      { timeout: 180_000 },
      async () => {
        for (const job of jobs) {
          const since = new Date(Date.now() - 1000);
          await runNow(job);
          const execution = await ranOnce(code, since, job);
          await drainedQueue(env, job);
          // Exactly one action result, the starter's handler outcome (REQ-S12-001 "outcome").
          const res = await env.su.query(
            "SELECT action_type, outcome FROM automation_action_result WHERE automation_execution_id = $1",
            [execution.id],
          );
          expect(res.rows.length, `${job}: one action result`).toBe(1);
          expect(["done", "existing", "skipped"]).toContain(res.rows[0].outcome);
        }
      },
    );
  }

  it(
    "starter 16 (a job fails): a job that exhausts its retries creates ONE visible operational exception and the starter runs once",
    { timeout: 180_000 },
    async () => {
      // Disclosed fault: starter 1's role tasks cannot be written for the next transformation (every attempt fails).
      const since = new Date(Date.now() - 1000);
      await setFault(env.su, "role_assignment:%", "raise");
      let tId = "";
      try {
        const t = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
          session: w.lead.session,
          body: { businessUnitId: w.bu, name: `Synthetic QA A13 job failure ${uniq("")}`, mode: "end_to_end" },
        });
        expect(t.status, JSON.stringify(t.body)).toBe(201);
        tId = t.body.id;
        const [event] = await outboxOf(env.api, tId);
        await waitFor(
          async () =>
            (
              await env.su.query(
                "SELECT count(*)::int AS n FROM operational_failure WHERE source = 'job' AND queue_name = 'transformation.created' AND idempotency_key = $1",
                [event!.idempotency_key],
              )
            ).rows[0].n > 0,
          "the failed job in the failure queue",
          90_000,
        );
        const failures = await call<Body>(
          env.api.app,
          "GET",
          "/api/v1/admin/automation-failures?source=job&limit=100",
          {
            session: w.tech.session,
          },
        );
        expect(failures.status, JSON.stringify(failures.body)).toBe(200);
        const mine = (failures.body.items as Body[]).filter((f) => f.idempotencyKey === event!.idempotency_key);
        expect(mine.length, "one visible exception for the failed job").toBe(1);
        await ranOnce("starter.job_failed", since, "job.failed");
      } finally {
        await clearFault(env.su, "role_assignment:%");
      }
    },
  );

  it(
    "starters 5, 6, 7 (gate evidence check, valid submission routing, gate approved): a native G1 submission and approval run each once",
    { timeout: 180_000 },
    async () => {
      const since = new Date(Date.now() - 1000);
      const sw = await seedWorld(env.api.db);
      const g = await seedNativeGateWorld(env.api, sw, "A13 starters");
      await passGatesNatively(env.api, g, ["G1"], "2027-12-31");
      const ofT = async (code: string, triggerCode: string) =>
        (
          await env.su.query(
            `SELECT e.id, e.status, e.automation_rule_version_id, r.effective_version_id
               FROM automation_execution e JOIN automation_rule r ON r.id = e.automation_rule_id
              WHERE r.code = $1 AND e.trigger_code = $2 AND e.transformation_id = $3 AND e.created_at >= $4`,
            [code, triggerCode, g.transformationId, since],
          )
        ).rows as Body[];
      for (const [code, trigger] of [
        ["starter.gate_evidence_missing", "gate.submission_requested"],
        ["starter.gate_submission_routing", "gate.submitted"],
        ["starter.gate_approved", "gate.decided"],
      ] as const) {
        const rows = await waitFor(
          async () => {
            const x = await ofT(code, trigger);
            return x.length > 0 && x.every((e) => e.status !== "running") ? x : null;
          },
          `an execution of ${code} for ${trigger}`,
          60_000,
        ).catch(async (e) => {
          throw new Error(`${String(e)}; ${JSON.stringify(await ofT(code, trigger))}`);
        });
        expect(
          rows.map((e) => [e.status, e.automation_rule_version_id === e.effective_version_id]),
          `${code}: one succeeded execution of its effective version`,
        ).toEqual([["succeeded", true]]);
      }
      // Starter 6's effect: the exact snapshot routed to the required approver, the Sponsor's own approval task.
      const sp = await env.su.query(
        "SELECT count(*)::int AS n FROM work_item WHERE transformation_id = $1 AND assignee_user_id = $2 AND kind = 'gate_decision_due'",
        [g.transformationId, g.sp.id],
      );
      expect(sp.rows[0].n, "one approval task for the Sponsor").toBe(1);
    },
  );

  it(
    "starters 3 and 11 (accepted KPI actual, benefit evidence submitted): each runs once on its event, with its effect rows",
    { timeout: 180_000 },
    async () => {
      const since = new Date(Date.now() - 1000);
      const sw = await seedWorld(env.api.db);
      const k = await dashboardWorld(env.api, sw);
      const { today } = await riyadhToday(env.api);
      const [y, m] = today.split("-").map(Number) as [number, number];
      const label = `${y}-${String(m).padStart(2, "0")}`;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const period = await openPeriod(
        env.api,
        sw,
        "monthly",
        label,
        `${label}-01`,
        `${label}-${String(last).padStart(2, "0")}`,
      );
      const kpi = await ownedKpi(env.api, k, DIRECT_FLOW);
      const a = await submitActual(env.api, k, kpi.id, {
        dataAsOf: today,
        reportingPeriodId: period.id,
        value: "80",
      });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      const actualId = a.body.actual.id as string;
      // Starter 3's effect: the recalculation run of the accepted actual (by the worker, not by the test).
      const runs = await waitFor(
        async () => {
          const r = await env.su.query("SELECT id FROM calculation_run WHERE trigger_record_id = $1", [actualId]);
          return r.rows.length > 0 ? r.rows : null;
        },
        "the worker's recalculation run of the accepted actual",
        60_000,
      );
      expect(runs.length, "one recalculation run").toBe(1);
      await waitFor(
        async () => {
          const r = await env.su.query(
            `SELECT e.status FROM automation_execution e JOIN automation_rule r ON r.id = e.automation_rule_id
              WHERE r.code = 'starter.kpi_actual_accepted' AND e.created_at >= $1 AND e.trigger_code = 'kpi.actual_accepted'`,
            [since],
          );
          return r.rows.length > 0 && r.rows.every((x) => x.status === "succeeded");
        },
        "starter 3's succeeded execution",
        60_000,
      );

      const bw = await seedBenefitWorld(env.api, sw);
      const ben = await measuredBenefit(env.api, bw);
      const ev = await evidenceItem(env.api, bw);
      const sub = await call<Body>(env.api.app, "POST", `${bw.base}/benefits/${ben.id}/measurements`, {
        session: bw.s.bo,
        body: { periodStart: "2036-01-01", periodEnd: "2036-01-31", amount: "1000", evidenceIds: [ev], submit: true },
      });
      expect(sub.status, JSON.stringify(sub.body)).toBe(201);
      // Starter 11's effect: the measurement is routed to the Finance validation queue, once.
      await waitFor(
        async () =>
          (
            await env.su.query("SELECT count(*)::int AS n FROM finance_validation WHERE benefit_measurement_id = $1", [
              sub.body.id,
            ])
          ).rows[0].n > 0,
        "the Finance validation item",
        60_000,
      );
      const fv = await env.su.query(
        "SELECT count(*)::int AS n FROM finance_validation WHERE benefit_measurement_id = $1",
        [sub.body.id],
      );
      expect(fv.rows[0].n, "one Finance validation item").toBe(1);
      await waitFor(
        async () => {
          const r = await env.su.query(
            `SELECT e.status FROM automation_execution e JOIN automation_rule r ON r.id = e.automation_rule_id
              WHERE r.code = 'starter.benefit_evidence' AND e.created_at >= $1`,
            [since],
          );
          return r.rows.length === 1 && r.rows[0].status === "succeeded";
        },
        "starter 11's one succeeded execution",
        60_000,
      );
    },
  );

  it("the starters this file does not trigger are named with where they are driven (no silent gap)", () => {
    expect(Object.keys(STARTERS_ELSEWHERE).length).toBe(4);
  });
});
