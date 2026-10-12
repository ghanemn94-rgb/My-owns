// F-DG4-128 (REQ-S16-005; D-131): the shipped worker's pg-boss supervision runs on a bounded, configured cadence.
// pg-boss 11.0.0 gives `superviseIntervalSeconds` no default; the worker used to leave it unset, so Boss.start ran
// setInterval(onSupervise, NaN): a 1 ms loop (TimeoutNaNWarning at start-up), about 6,000-9,000 idle transactions/s.
// Every other worker test passes the cadence explicitly (1 s), so none ran the shipped default. These tests do:
//  1. the REAL entry point (src/main.ts, `node --conditions=@mth/source`, the shipped environment: no
//     WORKER_SUPERVISE_INTERVAL_SECONDS) against a real PostgreSQL. A preload (test/interval-probe.mjs) reports every
//     setInterval delay unchanged. pg-boss's supervision timer must be 60,000 ms, every timer finite, and no
//     TimeoutNaNWarning may be printed. A configured value is honoured; an invalid one stops the worker with exit 78;
//  2. in process: createBoss with no options (the original main.ts call) and with the loaded worker configuration
//     (the current main.ts call) start pg-boss with a 60 s supervision timer and emit no TimeoutNaNWarning.
// All data is SYNTHETIC.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "@mth/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBoss, superviseIntervalSecondsOf } from "../../src/queues/index.ts";
import { workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
beforeAll(async () => {
  env = await workerEnv();
}, 60_000);
afterAll(async () => {
  await env.close();
});

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const PROBE = fileURLToPath(new URL("../interval-probe.mjs", import.meta.url));

interface ProbeLine {
  readonly ms: number | string;
  readonly pgBossSupervise: boolean;
}

interface MainRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly intervals: readonly ProbeLine[];
}

/**
 * Start src/main.ts as the shipped process would run, with ONLY the variables a deployment must set (NODE_ENV,
 * DATABASE_URL) plus `extra`. When it logs "mth-worker started", wait `settleMs` (a 1 ms loop would run thousands of
 * passes meanwhile), then stop it with SIGTERM, the documented graceful shutdown.
 */
function runMain(extra: Record<string, string>, settleMs = 1500): Promise<MainRun> {
  const child = spawn(process.execPath, ["--conditions=@mth/source", "--import", PROBE, MAIN], {
    env: { PATH: process.env["PATH"] ?? "", NODE_ENV: "test", DATABASE_URL: env.appUrl, LOG_LEVEL: "warn", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let stopping = false;
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 40_000);
  child.stdout.on("data", (b: Buffer) => {
    stdout += b.toString();
    if (!stopping && stdout.includes('"msg":"mth-worker started"')) {
      stopping = true;
      setTimeout(() => child.kill("SIGTERM"), settleMs);
    }
  });
  child.stderr.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      clearTimeout(killTimer);
      const intervals = stderr
        .split("\n")
        .filter((l) => l.startsWith("MTH_INTERVAL_PROBE "))
        .map((l) => JSON.parse(l.slice("MTH_INTERVAL_PROBE ".length)) as ProbeLine);
      resolve({ code, signal, stdout, stderr, intervals });
    });
  });
}

describe("the shipped worker entry point supervises on a bounded cadence (F-DG4-128)", () => {
  it("with the shipped defaults: pg-boss supervision every 60 s, every timer finite, no TimeoutNaNWarning", async () => {
    const run = await runMain({});
    expect(run.stderr).not.toContain("TimeoutNaNWarning");
    expect(run.stderr).not.toMatch(/NaN is not a number/);
    const supervise = run.intervals.filter((i) => i.pgBossSupervise);
    expect(supervise).toEqual([{ ms: 60_000, pgBossSupervise: true }]);
    for (const i of run.intervals) {
      expect(typeof i.ms).toBe("number");
      expect(i.ms as number).toBeGreaterThanOrEqual(1);
    }
    expect(run.stdout).toContain('"msg":"mth-worker started"');
    expect(run.stdout).toContain('"superviseIntervalSeconds":60');
    // Graceful SIGTERM shutdown: the worker exits 0 on its own.
    expect({ code: run.code, signal: run.signal }).toEqual({ code: 0, signal: null });
  }, 60_000);

  it("honours a configured WORKER_SUPERVISE_INTERVAL_SECONDS", async () => {
    const run = await runMain({ WORKER_SUPERVISE_INTERVAL_SECONDS: "17" });
    expect(run.stderr).not.toContain("TimeoutNaNWarning");
    expect(run.intervals.filter((i) => i.pgBossSupervise)).toEqual([{ ms: 17_000, pgBossSupervise: true }]);
    expect(run.stdout).toContain('"superviseIntervalSeconds":17');
    expect(run.code).toBe(0);
  }, 60_000);

  it.each(["0", "601", "1.5", "abc"])(
    "refuses WORKER_SUPERVISE_INTERVAL_SECONDS=%s at start-up (exit 78, names the variable, pg-boss never starts)",
    async (value) => {
      const run = await runMain({ WORKER_SUPERVISE_INTERVAL_SECONDS: value });
      expect(run.code).toBe(78);
      expect(run.stderr).toContain("WORKER_SUPERVISE_INTERVAL_SECONDS is invalid");
      expect(run.intervals.filter((i) => i.pgBossSupervise)).toEqual([]);
      expect(run.stdout).not.toContain("mth-worker started");
    },
    60_000,
  );
});

describe("createBoss never leaves the supervision cadence to pg-boss (F-DG4-128)", () => {
  /** Start a boss with every setInterval delay recorded (with the creating stack) and warnings collected. */
  async function startRecorded(make: () => ReturnType<typeof createBoss>) {
    const original = globalThis.setInterval;
    const delays: { ms: unknown; pgBossSupervise: boolean }[] = [];
    const spy = vi.spyOn(globalThis, "setInterval").mockImplementation(((
      fn: (...a: unknown[]) => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      delays.push({ ms, pgBossSupervise: /pg-boss[\\/]src[\\/]boss\.js/.test(new Error().stack ?? "") });
      return original(fn, ms, ...rest);
    }) as typeof setInterval);
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(`${w.name}: ${w.message}`);
    process.on("warning", onWarning);
    const boss = make();
    boss.on("error", () => undefined);
    try {
      await boss.start();
      // Process warnings are emitted on the next tick; give a 1 ms loop time to show itself.
      await new Promise((r) => setTimeout(r, 300));
    } finally {
      spy.mockRestore();
      await boss.stop({ graceful: false, wait: true, timeout: 5000 });
      process.off("warning", onWarning);
    }
    return { delays, warnings };
  }

  it("createBoss(url) with no options (the original main.ts call) supervises every 60 s", async () => {
    const { delays, warnings } = await startRecorded(() =>
      createBoss(env.appUrl, { schedule: false, applicationName: "cadence-default" }),
    );
    expect(delays.filter((d) => d.pgBossSupervise).map((d) => d.ms)).toEqual([60_000]);
    expect(delays.every((d) => typeof d.ms === "number" && Number.isFinite(d.ms))).toBe(true);
    expect(warnings.filter((w) => w.startsWith("TimeoutNaNWarning"))).toEqual([]);
  });

  it("the worker's loaded configuration (the main.ts call) gives the configured cadence", async () => {
    const config = loadConfig("worker", { NODE_ENV: "test", DATABASE_URL: env.appUrl });
    expect(config.worker.superviseIntervalSeconds).toBe(60);
    const { delays, warnings } = await startRecorded(() =>
      createBoss(config.databaseUrl!, {
        superviseIntervalSeconds: config.worker.superviseIntervalSeconds,
        schedule: false,
        applicationName: "cadence-config",
      }),
    );
    expect(delays.filter((d) => d.pgBossSupervise).map((d) => d.ms)).toEqual([60_000]);
    expect(warnings.filter((w) => w.startsWith("TimeoutNaNWarning"))).toEqual([]);
  });

  it("refuses a cadence that is not an integer from 1 to 600 instead of passing it to pg-boss", () => {
    expect(superviseIntervalSecondsOf(undefined)).toBe(60);
    expect(superviseIntervalSecondsOf(1)).toBe(1);
    expect(superviseIntervalSecondsOf(600)).toBe(600);
    for (const bad of [Number.NaN, 0, -1, 601, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() => superviseIntervalSecondsOf(bad)).toThrow(RangeError);
      expect(() => createBoss(env.appUrl, { superviseIntervalSeconds: bad })).toThrow(
        "superviseIntervalSeconds must be an integer from 1 to 600",
      );
    }
  });
});
