// code-security-reviewer DG4 round 7 probe (F-DG4-128 repair, T-DG4-BE-R6). Runs the BUILT worker (apps/worker/dist/main.js,
// what the image ships; `pnpm -r build` first) with plain `node` (no source condition), an INDEPENDENT preload
// (sec-dg4-r7-preload.mjs), and only NODE_ENV + DATABASE_URL (+ the variable under test). Asserts the pg-boss supervision
// timer delay, no NaN/non-number timer, no TimeoutNaNWarning, start-up refusal (exit 78) for bad values, and the
// parsing of edge spellings (z.coerce.number accepts "1e1", "0x10", " 17 "). SYNTHETIC data only.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workerEnv, type WorkerEnv } from "../../support.ts";

const DIST = fileURLToPath(new URL("../../../dist/main.js", import.meta.url));
const PRELOAD = process.env["SECR7_PRELOAD"]!;
let env: WorkerEnv;
beforeAll(async () => { env = await workerEnv(); }, 60_000);
afterAll(async () => { await env.close(); });

type Ev = { kind: string; type?: string; delay?: string; pgboss?: boolean; name?: string; message?: string };
function run(extra: Record<string, string>, settleMs = 2500): Promise<{ code: number | null; stdout: string; stderr: string; ev: Ev[] }> {
  const child = spawn(process.execPath, ["--import", PRELOAD, DIST], {
    env: { PATH: process.env["PATH"] ?? "", NODE_ENV: "test", DATABASE_URL: env.appUrl, LOG_LEVEL: "warn", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "", stopping = false;
  const kill = setTimeout(() => child.kill("SIGKILL"), 40_000);
  child.stdout.on("data", (b: Buffer) => {
    stdout += b.toString();
    if (!stopping && stdout.includes('"msg":"mth-worker started"')) { stopping = true; setTimeout(() => child.kill("SIGTERM"), settleMs); }
  });
  child.stderr.on("data", (b: Buffer) => { stderr += b.toString(); });
  return new Promise((res) => child.once("exit", (code) => {
    clearTimeout(kill);
    const ev = stderr.split("\n").filter((l) => l.startsWith("SECR7 ")).map((l) => JSON.parse(l.slice(6)) as Ev);
    res({ code, stdout, stderr, ev });
  }));
}
const sup = (ev: Ev[]) => ev.filter((e) => e.kind === "interval" && e.pgboss).map((e) => `${e.type}:${e.delay}`);

describe("SEC-R7 built worker dist/main.js supervision cadence", () => {
  it.each([
    [{}, "60000"],
    [{ WORKER_SUPERVISE_INTERVAL_SECONDS: "" }, "60000"],
    [{ WORKER_SUPERVISE_INTERVAL_SECONDS: "1" }, "1000"],
    [{ WORKER_SUPERVISE_INTERVAL_SECONDS: "600" }, "600000"],
    [{ WORKER_SUPERVISE_INTERVAL_SECONDS: "1e1" }, "10000"],
    [{ WORKER_SUPERVISE_INTERVAL_SECONDS: "0x10" }, "16000"],
    [{ WORKER_SUPERVISE_INTERVAL_SECONDS: " 17 " }, "17000"],
  ] as [Record<string, string>, string][])("%o -> pg-boss supervise timer %s ms, all timers numeric, no TimeoutNaNWarning", async (extra, ms) => {
    const r = await run(extra);
    console.log(`SECR7-RESULT ${JSON.stringify(extra)} code=${r.code} supervise=${JSON.stringify(sup(r.ev))} timers=${JSON.stringify(r.ev.filter((e) => e.kind === "interval").map((e) => `${e.type}:${e.delay}`))} warnings=${JSON.stringify(r.ev.filter((e) => e.kind === "warning").map((e) => e.name))}`);
    expect(sup(r.ev)).toEqual([`number:${ms}`]);
    expect(r.ev.filter((e) => e.kind === "interval").every((e) => e.type === "number" && Number(e.delay) >= 1)).toBe(true);
    expect(r.ev.filter((e) => e.kind === "warning" && e.name === "TimeoutNaNWarning")).toEqual([]);
    expect(r.code).toBe(0);
  }, 60_000);

  it("WORKER_SUPERVISE_INTERVAL_SECONDS_FILE is honoured like the other variables", async () => {
    const d = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "secr7-")); const f = join(d, "v"); writeFileSync(f, "42\n");
    const r = await run({ WORKER_SUPERVISE_INTERVAL_SECONDS_FILE: f });
    console.log(`SECR7-RESULT _FILE=42 code=${r.code} supervise=${JSON.stringify(sup(r.ev))}`);
    expect(sup(r.ev)).toEqual(["number:42000"]);
  }, 60_000);

  it.each(["0", "-1", "601", "1.5", "NaN", "Infinity", "abc", "17abc", "   "])("refuses %j at start-up: exit 78, names the variable, pg-boss never starts", async (v) => {
    const r = await run({ WORKER_SUPERVISE_INTERVAL_SECONDS: v });
    console.log(`SECR7-RESULT ${JSON.stringify(v)} code=${r.code} supervise=${JSON.stringify(sup(r.ev))} stderr0=${JSON.stringify(r.stderr.split("\n").find((l) => !l.startsWith("SECR7")) ?? "")}`);
    expect(r.code).toBe(78);
    expect(r.stderr).toContain("WORKER_SUPERVISE_INTERVAL_SECONDS is invalid");
    expect(r.stderr).not.toContain(v.trim() === "" ? "\u0000" : `=${v}`); // the value itself is not echoed as NAME=value
    expect(sup(r.ev)).toEqual([]);
  }, 60_000);
});
