// A13 "Durable automation" for the remaining P5 jobs (qa-verifier, T-DG5-QA-F2; QA-F handback §7 item 3).
// Scenario text (master prompt §20, A13): "Retried events, worker restarts and partial failures do not duplicate
// approvals, measurements or notifications; failed jobs remain recoverable". Applied to:
//  1. the export job (reports.export; REQ-S12-020 "killing the worker mid-job and restarting completes the job once",
//     REQ-S12-021 "replaying the same event three times yields one ..."): the same Idempotency-Key gives the same job;
//     a worker process SIGKILLed inside the job's final transaction, then restarted, completes it ONCE with ONE file;
//     the export_job.requested event replayed three times changes nothing;
//  2. the Day-90 job (launch.day_ninety_tests; ADR-0048 §4 "once per open test ... a replay creates nothing"): run now,
//     re-delivered three times and run again after a worker restart -> one day_ninety_test_due item per holder;
//  3. the health check: ADR-0048 §8 defines NO health-check job (only launch.day_ninety_tests); the A13 retry of its
//     only state change, the submit, is tested instead: the same submit replayed (and two concurrent submits) leaves
//     one submitted assessment with one score, one band and three actions.
// Through the REAL API (inject; responses validated against docs/api/openapi.yaml) and the REAL worker (startWorker,
// every handler), on this file's own scratch database. The kill uses the disclosed fault of a13-durable.ts, extended to
// export_job by a trigger installed HERE in the scratch database (a test-environment intervention, not product code).
// All data is SYNTHETIC; nothing approves anything real, and nothing here touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunningWorker } from "../../../apps/worker/src/index.ts";
import { testEvidenceDir } from "../../../apps/api/test/support/harness.ts";
import {
  CHILD_APP_NAME,
  childWorker,
  inProcessWorker,
  orgWorld,
  outboxOf,
  qaBoss,
  scratchEnv,
  waitFor,
  type Body,
  type OrgWorld,
  type ScratchEnv,
} from "../support/a13-durable.ts";
import { drainedQueue, replayEvent } from "../support/a13-replay.ts";
import { call, uniq } from "../support/api.ts";

// The worker's export store is the API's evidence directory of this run (the A15 suites' convention; never /var/lib).
process.env["EVIDENCE_STORAGE_PATH"] = testEvidenceDir();

let env: ScratchEnv;
let boss: ReturnType<typeof qaBoss>;
let worker: RunningWorker | null = null;
let w: OrgWorld;

async function startInProcess() {
  worker = await inProcessWorker(env, boss);
}
async function stopInProcess() {
  await worker?.stop().catch(() => undefined);
  worker = null;
}

beforeAll(async () => {
  env = await scratchEnv("mth_qa_a13j");
  boss = qaBoss(env.appUrl, "qa-a13j-boss");
  await boss.start();
  w = await orgWorld(env.api);
}, 120_000);
afterAll(async () => {
  await stopInProcess();
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
  await env?.close();
});

const ok = (r: { status: number; body: Body }, status: number, what: string) =>
  expect(r.status, `${what}: ${JSON.stringify(r.body).slice(0, 800)}`).toBe(status);

/** Every file below `dir` (recursive). */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe("A13 export job: one job per Idempotency-Key; a killed worker restarts and completes it once with one file; replays add nothing", () => {
  let tId: string;
  let job: Body;

  it(
    "the same Idempotency-Key returns the existing job (200) and queues nothing more",
    { timeout: 120_000 },
    async () => {
      const t = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
        session: w.lead.session,
        body: { businessUnitId: w.bu, name: `Synthetic QA A13 export ${uniq("")}`, mode: "end_to_end" },
      });
      ok(t, 201, "create transformation");
      tId = t.body.id;
      const key = `qa-a13-export-${uniq("")}`;
      const body = { report: { definitionCode: "charter", subjectId: tId }, format: "pdf", language: "en" };
      const first = await call<Body>(env.api.app, "POST", "/api/v1/exports", {
        session: w.lead.session,
        body,
        headers: { "idempotency-key": key },
      });
      ok(first, 202, "create export");
      job = first.body;
      const again = await call<Body>(env.api.app, "POST", "/api/v1/exports", {
        session: w.lead.session,
        body,
        headers: { "idempotency-key": key },
      });
      ok(again, 200, "same Idempotency-Key");
      expect(again.body.id).toBe(job.id);
      const rows = await env.su.query("SELECT count(*)::int AS n FROM export_job WHERE transformation_id = $1", [tId]);
      expect(rows.rows[0].n, "one export job").toBe(1);
      const events = await outboxOf(env.api, job.id, "export_job.requested");
      expect(events.length, "one export_job.requested event").toBe(1);
    },
  );

  it(
    "a worker process SIGKILLed inside the job's final transaction, then restarted, completes the job ONCE with ONE file",
    { timeout: 240_000 },
    async () => {
      expect(job, "the job of the first test").toBeDefined();
      // Disclosed fault (scratch database only): the job's success UPDATE waits on an advisory lock the test holds, so
      // the worker is "mid-job": the file is rendered and stored, the success is not committed.
      await env.su.query(`
        CREATE OR REPLACE FUNCTION public.qa_a13_export_block() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          IF NEW.status = 'succeeded' AND OLD.status = 'running' THEN PERFORM pg_advisory_xact_lock_shared(7313014); END IF;
          RETURN NEW;
        END $f$;
        DROP TRIGGER IF EXISTS qa_a13_export_block ON public.export_job;
        CREATE TRIGGER qa_a13_export_block BEFORE UPDATE ON public.export_job FOR EACH ROW EXECUTE FUNCTION public.qa_a13_export_block();`);
      const holder = await env.su.connect();
      try {
        await holder.query("SELECT pg_advisory_lock(7313014)");
        const before = new Set(filesUnder(testEvidenceDir()));
        const c = await childWorker(env.appUrl);
        // Mid-job: the child's session waits on the lock inside the success transaction.
        await waitFor(
          async () => {
            const r = await env.su.query(
              "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE $1 AND wait_event_type = 'Lock'",
              [`${CHILD_APP_NAME}%`],
            );
            return r.rows[0].n > 0;
          },
          "the child worker blocked inside the export's success transaction",
          90_000,
        ).catch(async (e) => {
          throw new Error(`${String(e)}; child: ${c.output().slice(-3000)}`);
        });
        // A job of a killed worker is re-delivered after its expiry (pg-boss): 20 s on THIS job instead of the queue's
        // 15 min (disclosed; set on the job row because the worker re-applies its queue policy when it starts).
        const exp = await env.su.query(
          "UPDATE pgboss.job SET expire_seconds = 20 WHERE name = 'reports.export' AND state = 'active' RETURNING id",
        );
        expect(exp.rows.length, "the export's job is active in the killed worker").toBe(1);
        c.child.kill("SIGKILL");
        await new Promise((r) => c.child.once("exit", r));
        // The server ends the dead process's sessions (standing in for TCP keepalive / idle timeouts).
        await env.su.query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE $1",
          [`${CHILD_APP_NAME}%`],
        );
        const mid = await call<Body>(env.api.app, "GET", `/api/v1/exports/${job.id}`, { session: w.lead.session });
        ok(mid, 200, "read the job after the kill");
        expect(mid.body.status, "nothing was committed as succeeded").not.toBe("succeeded");
        const orphanAfterKill = filesUnder(testEvidenceDir()).filter((f) => !before.has(f));
        await holder.query("SELECT pg_advisory_unlock(7313014)");
        // Restart: the production worker in this process.
        await startInProcess();
        const done = await waitFor(
          async () => {
            const r = await call<Body>(env.api.app, "GET", `/api/v1/exports/${job.id}`, { session: w.lead.session });
            return r.body?.status === "succeeded" ? r.body : null;
          },
          "the export to succeed after the restart",
          120_000,
        ).catch(async (e) => {
          const j = await env.su.query(
            "SELECT state, retry_count, retry_limit FROM pgboss.job WHERE name = 'reports.export'",
          );
          const x = await env.su.query("SELECT status, attempt_count, error_code FROM export_job WHERE id = $1", [
            job.id,
          ]);
          throw new Error(`${String(e)}; jobs ${JSON.stringify(j.rows)}; export ${JSON.stringify(x.rows)}`);
        });
        await drainedQueue(env, "reports.export");
        // Completed once: one job row, one stored file referenced, and the download is that file.
        const rows = await env.su.query(
          "SELECT id, status, storage_key, file_sha256 FROM export_job WHERE transformation_id = $1",
          [tId],
        );
        expect(rows.rows.length).toBe(1);
        expect(rows.rows[0].status).toBe("succeeded");
        const dl = await call<Body>(env.api.app, "GET", `/api/v1/exports/${job.id}/download`, {
          session: w.lead.session,
        });
        ok(dl, 200, "download");
        const bytes = dl.raw.rawPayload;
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(done.fileSha256);
        // "Without a duplicate file": the store holds ONE file for this job after the kill and the restart.
        const added = filesUnder(testEvidenceDir()).filter((f) => !before.has(f));
        expect(
          added,
          `files the job left in the store (after the kill: ${JSON.stringify(orphanAfterKill)})`,
        ).toHaveLength(1);
      } finally {
        await holder.query("SELECT pg_advisory_unlock_all()").catch(() => undefined);
        holder.release();
        await env.su.query("DROP TRIGGER IF EXISTS qa_a13_export_block ON public.export_job");
      }
    },
  );

  it(
    "the export_job.requested event replayed three times changes nothing: same file, same version, no new file",
    { timeout: 180_000 },
    async () => {
      expect(job, "the job of the first test").toBeDefined();
      if (worker === null) await startInProcess();
      const before = await call<Body>(env.api.app, "GET", `/api/v1/exports/${job.id}`, { session: w.lead.session });
      ok(before, 200, "read");
      expect(before.body.status).toBe("succeeded");
      const filesBefore = filesUnder(testEvidenceDir()).length;
      const [event] = await outboxOf(env.api, job.id, "export_job.requested");
      await replayEvent(env, boss, event, 3);
      const after = await call<Body>(env.api.app, "GET", `/api/v1/exports/${job.id}`, { session: w.lead.session });
      expect(after.body).toEqual(before.body);
      expect(filesUnder(testEvidenceDir()).length, "no new file in the store").toBe(filesBefore);
      expect(
        (await env.su.query("SELECT count(*)::int AS n FROM export_job WHERE transformation_id = $1", [tId])).rows[0].n,
      ).toBe(1);
    },
  );
});

describe("A13 Day-90 job: run now, re-delivered x3 and re-run after a worker restart -> one day_ninety_test_due item per holder", () => {
  it(
    "a plan started 2026-01-01 (Day 90 = 2026-04-01, reached): one item per holder, unchanged by re-runs and a restart",
    { timeout: 240_000 },
    async () => {
      if (worker === null) await startInProcess();
      const created = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
        session: w.lead.session,
        body: {
          businessUnitId: w.bu,
          name: `Synthetic QA A13 Day-90 ${uniq("")}`,
          mode: "end_to_end",
          launchPlan: { startDate: "2026-01-01" },
        },
      });
      ok(created, 201, "create transformation with a plan");
      const tId = created.body.id as string;
      await waitFor(
        async () =>
          (await env.su.query("SELECT count(*)::int AS n FROM day_ninety_test WHERE transformation_id = $1", [tId]))
            .rows[0].n === 1,
        "starter 1 generated the plan and its Day-90 test",
        60_000,
      );
      const items = async () =>
        (
          await env.su.query(
            "SELECT id, assignee_user_id FROM work_item WHERE kind = 'day_ninety_test_due' AND transformation_id = $1 ORDER BY id",
            [tId],
          )
        ).rows.map((r) => `${r.assignee_user_id}:${r.id}`);
      const runNow = async () => {
        const r = await call<Body>(env.api.app, "POST", "/api/v1/admin/jobs/launch.day_ninety_tests/run", {
          session: w.tech.session,
        });
        expect([202, 409], JSON.stringify(r.body)).toContain(r.status);
        return r;
      };
      ok(await runNow(), 202, "run now");
      await waitFor(async () => (await items()).length > 0, "the Day-90 job created its items", 60_000);
      await drainedQueue(env, "launch.day_ninety_tests");
      const first = await items();
      const holders = first.map((k) => k.split(":")[0]);
      expect(new Set(holders).size, "one item per holder: nobody twice").toBe(holders.length);
      // The holders see it in their own My Work (public API): the Lead holds day_ninety_test.respond here.
      const mine = await call<Body>(
        env.api.app,
        "GET",
        `/api/v1/me/work-items?kind=day_ninety_test_due&transformationId=${tId}&limit=100`,
        { session: w.lead.session },
      );
      ok(mine, 200, "my work items");
      expect((mine.body.items as Body[]).length, "the Lead's own Day-90 item").toBe(1);

      // Re-delivered three times (same job data), then a worker restart and another run.
      const [last] = (
        await env.su.query(
          "SELECT data FROM pgboss.job WHERE name = 'launch.day_ninety_tests' ORDER BY created_on DESC LIMIT 1",
        )
      ).rows;
      for (let i = 0; i < 3; i++) await boss.send("launch.day_ninety_tests", last?.data ?? {});
      await drainedQueue(env, "launch.day_ninety_tests");
      expect(await items(), "three re-deliveries add nothing").toEqual(first);
      await stopInProcess();
      await startInProcess();
      await boss.send("launch.day_ninety_tests", last?.data ?? {});
      await drainedQueue(env, "launch.day_ninety_tests");
      expect(await items(), "a re-run after a worker restart adds nothing").toEqual(first);
      const jobs = await env.su.query(
        "SELECT state, count(*)::int AS n FROM pgboss.job WHERE name = 'launch.day_ninety_tests' GROUP BY 1 ORDER BY 1",
      );
      expect(
        jobs.rows.map((r) => r.state),
        "every run completed",
      ).toEqual(["completed"]);
    },
  );
});

describe("A13 health check (no job exists, ADR-0048 §8): the retried submit leaves one submitted assessment, one score, three actions", () => {
  it(
    "the same submit replayed, and two concurrent submits, change nothing after the first",
    { timeout: 120_000 },
    async () => {
      const t = await call<Body>(env.api.app, "POST", "/api/v1/transformations", {
        session: w.lead.session,
        body: { businessUnitId: w.bu, name: `Synthetic QA A13 health ${uniq("")}`, mode: "end_to_end" },
      });
      ok(t, 201, "create transformation");
      const HC = `/api/v1/transformations/${t.body.id}/health-checks`;
      const s = w.lead.session;
      const draft = await call<Body>(env.api.app, "POST", HC, { session: s, body: { assessmentDate: "2026-10-05" } });
      ok(draft, 201, "start a health check");
      const qs = await call<Body>(env.api.app, "GET", "/api/v1/health-check-questions", { session: s });
      ok(qs, 200, "questions");
      const codes = ((qs.body.items ?? qs.body) as Body[]).map((q) => q.code as string);
      expect(codes.length).toBe(25);
      let cur = draft.body;
      for (const [i, code] of codes.entries()) {
        const r = await call<Body>(env.api.app, "PUT", `${HC}/${cur.id}/answers/${code}`, {
          session: s,
          headers: { "if-match": `"${cur.version}"` },
          body: { response: i < 17 ? "yes" : "no" },
        });
        ok(r, 200, `answer ${code}`);
        cur = r.body;
      }
      const acts = await call<Body>(env.api.app, "PUT", `${HC}/${cur.id}/actions`, {
        session: s,
        headers: { "if-match": `"${cur.version}"` },
        body: { actions: [1, 2, 3].map((rank) => ({ rank, actionText: `Synthetic QA improvement action ${rank}` })) },
      });
      ok(acts, 200, "three actions");
      const submit = () =>
        call<Body>(env.api.app, "POST", `${HC}/${cur.id}/submit`, {
          session: s,
          headers: { "if-match": `"${acts.body.version}"` },
        });
      const [a, b] = await Promise.all([submit(), submit()]);
      const statuses = [a.status, b.status].sort();
      expect(statuses[0], `one submit wins: ${JSON.stringify([a.body, b.body])}`).toBe(200);
      expect([409, 422], `the concurrent duplicate is refused: ${JSON.stringify([a.body, b.body])}`).toContain(
        statuses[1],
      );
      const replay = await submit();
      expect([409, 422], JSON.stringify(replay.body)).toContain(replay.status);
      const read = await call<Body>(env.api.app, "GET", `${HC}/${cur.id}`, { session: s });
      ok(read, 200, "read");
      expect([read.body.status, read.body.score, read.body.band?.rangeLabel]).toEqual(["submitted", "17", "16-20"]);
      const list = await call<Body>(env.api.app, "GET", `${HC}?limit=100`, { session: s });
      ok(list, 200, "list");
      expect((list.body.items as Body[]).length, "one assessment").toBe(1);
      const actions = await env.su.query(
        "SELECT count(*)::int AS n FROM health_assessment_action WHERE assessment_id = $1",
        [cur.id],
      );
      expect(actions.rows[0].n, "three actions, not duplicated").toBe(3);
    },
  );
});
