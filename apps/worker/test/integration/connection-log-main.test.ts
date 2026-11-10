// The worker's A21 connection log through its REAL entry point (T-DG6-BE-X3; QA-D-1; ADR-0059 §12 "one call each in
// apps/api/src/server.ts and apps/worker/src/main.ts"; REQ-S17-009, REQ-S17-010). Before this task neither entry
// point called installConnectionLog, so MTH_CONNECTION_LOG produced no log unless a preload installed the module from
// outside (QA-D's e2e/support/connection-log-preload.mjs). Here src/main.ts runs as the shipped process would
// (`node --conditions=@mth/source`, only the variables a deployment sets), with no preload:
//  1. MTH_CONNECTION_LOG set: the log exists, every line is `process: "worker"` with the six keys only, and the
//     worker's own database connections are in it (the PostgreSQL host and port: the A21 "only the database" case);
//  2. NODE_ENV=production: the variable is ignored with one warning, and no file is written;
//  3. the variable unset: the worker starts and stops as before (no warning).
// All data is SYNTHETIC.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConnectionLogLine } from "@mth/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workerEnv, type WorkerEnv } from "../support.ts";

let env: WorkerEnv;
beforeAll(async () => {
  env = await workerEnv();
}, 60_000);
afterAll(async () => {
  await env.close();
});

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const PRODUCTION_WARNING = "MTH_CONNECTION_LOG is ignored in production";

interface MainRun {
  readonly code: number | null;
  readonly started: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Starts src/main.ts with only NODE_ENV, DATABASE_URL and `extra`. When it logs "mth-worker started" it is stopped
 * with SIGTERM (the documented graceful shutdown) after `settleMs`; a run that exits on its own (a configuration
 * refusal) is reported as it is.
 */
function runMain(extra: Record<string, string>, settleMs = 1000): Promise<MainRun> {
  const child = spawn(process.execPath, ["--conditions=@mth/source", MAIN], {
    env: { PATH: process.env["PATH"] ?? "", NODE_ENV: "test", DATABASE_URL: env.appUrl, LOG_LEVEL: "warn", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let started = false;
  const killTimer = setTimeout(() => child.kill("SIGKILL"), 40_000);
  child.stdout.on("data", (b: Buffer) => {
    stdout += b.toString();
    if (!started && stdout.includes('"msg":"mth-worker started"')) {
      started = true;
      setTimeout(() => child.kill("SIGTERM"), settleMs);
    }
  });
  child.stderr.on("data", (b: Buffer) => {
    stderr += b.toString();
  });
  return new Promise((resolve) => {
    child.once("exit", (code) => {
      clearTimeout(killTimer);
      resolve({ code, started, stdout, stderr });
    });
  });
}

const logFile = (name: string) => join(mkdtempSync(join(tmpdir(), "mth-be-x3-worker-connlog-")), name);
const readLines = (file: string): ConnectionLogLine[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as ConnectionLogLine);

describe("the worker entry point installs the A21 connection log (QA-D-1)", () => {
  it("MTH_CONNECTION_LOG set: one line per outbound connection, process worker, the database among them", async () => {
    const file = logFile("worker.jsonl");
    const run = await runMain({ MTH_CONNECTION_LOG: file });
    expect(run.started, run.stderr).toBe(true);
    expect(run.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    const lines = readLines(file);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(Object.keys(l).sort()).toEqual(["address", "at", "channel", "host", "port", "process"]);
      expect(l.process).toBe("worker");
    }
    const database = new URL(env.appUrl);
    const dbPort = Number(database.port || "5432");
    const toDatabase = lines.filter((l) => l.channel === "net.client.socket" && l.port === dbPort);
    expect(toDatabase.length, JSON.stringify(lines)).toBeGreaterThan(0);
    // The database host is loopback in this harness; every destination of the worker is the database.
    for (const l of lines) expect(l.port, JSON.stringify(l)).toBe(dbPort);
    // Only the destination: no user name, password, database name or query string of the URL.
    const text = readFileSync(file, "utf8");
    if (database.password !== "") expect(text).not.toContain(database.password);
    expect(text).not.toContain(database.pathname.slice(1));
  }, 60_000);

  it("NODE_ENV=production: ignored with one warning, and no file is written", async () => {
    const file = logFile("production.jsonl");
    const run = await runMain({ NODE_ENV: "production", MTH_CONNECTION_LOG: file });
    // Whether production configuration then starts or refuses the worker, the log was never installed.
    expect(run.stderr.split(PRODUCTION_WARNING).length - 1, run.stderr).toBe(1);
    expect(existsSync(file)).toBe(false);
  }, 60_000);

  it("unset: the worker starts and stops as before, with no warning", async () => {
    const run = await runMain({});
    expect(run.started, run.stderr).toBe(true);
    expect(run.code).toBe(0);
    expect(run.stderr).not.toContain(PRODUCTION_WARNING);
  }, 60_000);
});
