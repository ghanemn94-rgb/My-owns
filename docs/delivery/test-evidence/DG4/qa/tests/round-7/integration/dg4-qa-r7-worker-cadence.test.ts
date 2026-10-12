// qa-verifier DG4 round 7 (T-DG4-REV-QA-R7): independent probe of the BE-R6 repair (F-DG4-128, REQ-S16-005), beyond
// the candidate's own supervise-cadence.test.ts. This file lives OUTSIDE the frozen candidate
// (docs/delivery/test-evidence/DG4/qa/tests/round-7/) and is copied into a disposable copy's tests/qa/integration/
// only to run, then removed. Differences from the candidate's test:
//  - it starts the BUILT artifact the container runs (deploy/docker/entrypoint.sh: `node apps/worker/dist/main.js`),
//    not src/main.ts with the source condition;
//  - the .env.example shape: WORKER_SUPERVISE_INTERVAL_SECONDS present but EMPTY must mean the 60 s default, not NaN/0;
//  - the range boundaries 1 and 600 start; -5, 601 and "   " refuse with exit 78; the message never echoes the value;
//  - idle cost: with the shipped default, the worker's own database transactions over 8 s of idling stay small
//    (a 1 ms supervision loop produced thousands per second, D-131).
// The interval probe is the candidate's apps/worker/test/interval-probe.mjs (test support, reports setInterval delays).
// All data is SYNTHETIC.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workerEnv, type WorkerEnv } from "../../../apps/worker/test/support.ts";

const DIST_MAIN = fileURLToPath(new URL("../../../apps/worker/dist/main.js", import.meta.url));
const PROBE = fileURLToPath(new URL("../../../apps/worker/test/interval-probe.mjs", import.meta.url));

let env: WorkerEnv;
beforeAll(async () => {
  env = await workerEnv();
}, 60_000);
afterAll(async () => {
  await env.close();
});

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
  supervise: (number | string)[];
  idleXacts?: number;
}

// rev2: through the WorkerEnv's owner pool (rev1 imported `pg`, which the repository root cannot resolve).
// pg_stat_clear_snapshot() so each reading is fresh, not the transaction's cached statistics snapshot.
async function xactCommits(): Promise<number> {
  await env.owner.query("select pg_stat_clear_snapshot()");
  const r = await env.owner.query<{ n: string }>(
    "select xact_commit + xact_rollback as n from pg_stat_database where datname = current_database()",
  );
  return Number(r.rows[0]!.n);
}

function runDist(extra: Record<string, string>, opts: { idleMs?: number } = {}): Promise<Run> {
  const child = spawn(process.execPath, ["--import", PROBE, DIST_MAIN], {
    env: { PATH: process.env["PATH"] ?? "", NODE_ENV: "test", DATABASE_URL: env.appUrl, LOG_LEVEL: "warn", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let started = false;
  let idleXacts: number | undefined;
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  child.stdout.on("data", (b: Buffer) => {
    stdout += b.toString();
    if (!started && stdout.includes('"msg":"mth-worker started"')) {
      started = true;
      void (async () => {
        if (opts.idleMs) {
          await new Promise((r) => setTimeout(r, 1000)); // let start-up work settle
          const before = await xactCommits();
          await new Promise((r) => setTimeout(r, opts.idleMs));
          idleXacts = (await xactCommits()) - before - 1; // minus the measuring transaction itself
        } else {
          await new Promise((r) => setTimeout(r, 1500));
        }
        child.kill("SIGTERM");
      })();
    }
  });
  child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
  return new Promise((resolve) =>
    child.once("exit", (code) => {
      clearTimeout(killTimer);
      const supervise = stderr
        .split("\n")
        .filter((l) => l.startsWith("MTH_INTERVAL_PROBE "))
        .map((l) => JSON.parse(l.slice("MTH_INTERVAL_PROBE ".length)) as { ms: number | string; pgBossSupervise: boolean })
        .filter((p) => p.pgBossSupervise)
        .map((p) => p.ms);
      resolve({ code, stdout, stderr, supervise, ...(idleXacts !== undefined ? { idleXacts } : {}) });
    }),
  );
}

describe("qa-r7 F-DG4-128: the BUILT worker (dist/main.js) supervises on a bounded cadence", () => {
  it("R1 shipped default (variable absent): one 60 000 ms supervision timer, no TimeoutNaNWarning, small idle DB cost", async () => {
    const run = await runDist({}, { idleMs: 8000 });
    expect(run.stderr).not.toContain("TimeoutNaNWarning");
    expect(run.supervise).toEqual([60_000]);
    expect(run.stdout).toContain('"superviseIntervalSeconds":60');
    expect(run.code).toBe(0);
    // A 1 ms loop gave ~6 000-9 000 transactions/s (D-131). Bounded cadence: well under 50/s while idle.
    expect(run.idleXacts!).toBeLessThan(8 * 50);
    console.log(`qa-r7 R1 idle transactions in 8 s: ${run.idleXacts}`);
  }, 90_000);

  it("R2 .env.example shape: WORKER_SUPERVISE_INTERVAL_SECONDS present but empty means the 60 s default", async () => {
    const run = await runDist({ WORKER_SUPERVISE_INTERVAL_SECONDS: "" });
    expect(run.stderr).not.toContain("TimeoutNaNWarning");
    expect(run.supervise).toEqual([60_000]);
    expect(run.code).toBe(0);
  }, 90_000);

  it.each([
    ["1", 1_000],
    ["600", 600_000],
  ])("R3 boundary %s is accepted and honoured", async (value, ms) => {
    const run = await runDist({ WORKER_SUPERVISE_INTERVAL_SECONDS: value });
    expect(run.supervise).toEqual([ms]);
    expect(run.stdout).toContain(`"superviseIntervalSeconds":${value}`);
    expect(run.code).toBe(0);
  }, 90_000);

  it.each(["-5", "601", "   ", "NaN"])("R4 %j is refused at start-up: exit 78, the variable named, the value not echoed", async (value) => {
    const run = await runDist({ WORKER_SUPERVISE_INTERVAL_SECONDS: value });
    expect(run.code).toBe(78);
    expect(run.stderr).toContain("WORKER_SUPERVISE_INTERVAL_SECONDS is invalid");
    const messages = run.stderr.replace(/^MTH_INTERVAL_PROBE .*$/gm, "");
    if (value === "-5" || value === "601") expect(messages).not.toContain(value);
    expect(run.supervise).toEqual([]);
    expect(run.stdout).not.toContain("mth-worker started");
  }, 90_000);
});
