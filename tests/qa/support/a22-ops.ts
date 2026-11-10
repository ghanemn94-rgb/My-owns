// qa-verifier acceptance support for the A22 operability extension (DG6, T-DG6-QA-E): the REAL API on a scratch
// database of the run's disposable PostgreSQL with its log lines captured (the exact lines server.ts composes, redaction
// included), and the BUILT production worker (`node apps/worker/dist/main.js`, the `mth worker` entry point) as its own
// OS process with its stdout/stderr captured. Every value is SYNTHETIC; nothing here approves anything (G1-G6) or
// touches the engineering gates.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../packages/db/test/helpers.ts";
import { createPool, startApi, type TestApi } from "./api.ts";

export const HEARTBEAT = "/api/v1/admin/operations/heartbeat";
export const OPS_EXCEPTIONS = "/api/v1/admin/operations/exceptions";
export const JOBS = "/api/v1/admin/jobs";

/** The repository root (tests/qa/support -> ../../..). */
export const REPO_ROOT = new URL("../../../", import.meta.url).pathname;

export interface CapturedApi {
  readonly dbName: string;
  readonly appUrl: string;
  readonly api: TestApi;
  /** Cluster superuser on this scratch database: only to age heartbeat rows (simulating elapsed time). */
  readonly su: ReturnType<typeof createPool>;
  /** The API's log lines so far (raw strings, as written to the stream). */
  readonly lines: string[];
  /** The directory every captured line is appended to (api.log), for the post-suite log scan. */
  readonly logDir: string;
  close(): Promise<void>;
}

export async function capturedApi(prefix: string): Promise<CapturedApi> {
  const { adminUrl } = testDatabase();
  const dbName = await createScratchDatabase(adminUrl, prefix);
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  const appUrl = roleUrl(adminUrl, dbName, "mth_app");
  const logDir = mkdtempSync(join(tmpdir(), "qa-a22-logs-"));
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, "api.log");
  const lines: string[] = [];
  const api = await startApi({
    database: dbName,
    env: { LOG_LEVEL: "info" },
    logStream: {
      write: (line: string) => {
        lines.push(line);
        appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`);
      },
    },
  });
  const su = createPool(roleUrl(adminUrl, dbName, null), { max: 2, applicationName: "qa-a22-su" });
  return {
    dbName,
    appUrl,
    api,
    su,
    lines,
    logDir,
    async close() {
      await api.close().catch(() => undefined);
      await su.end().catch(() => undefined);
      await dropScratchDatabase(adminUrl, dbName);
    },
  };
}

/** Parses JSON log lines; a non-JSON line is returned as `{ __raw }` so a structure assertion can name it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parsed(lines: readonly string[]): any[] {
  return lines
    .flatMap((l) => l.split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l) => {
      try {
        return JSON.parse(l) as unknown;
      } catch {
        return { __raw: l };
      }
    });
}

export interface WorkerProcess {
  readonly child: ChildProcess;
  output(): string;
  stop(signal?: NodeJS.Signals): Promise<number | null>;
}

/** The BUILT production worker in its own process; resolves when it logs "mth-worker started". */
export async function startBuiltWorker(appUrl: string, env: Record<string, string> = {}): Promise<WorkerProcess> {
  const child = spawn(process.execPath, [join(REPO_ROOT, "apps/worker/dist/main.js")], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "",
      TMPDIR: process.env["TMPDIR"] ?? tmpdir(),
      NODE_ENV: "test",
      APP_BASE_URL: "http://localhost:3000",
      DATABASE_URL: appUrl,
      WORKER_HEARTBEAT_SECONDS: "1",
      LOG_LEVEL: "info",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout!.on("data", (b: Buffer) => (out += b.toString()));
  child.stderr!.on("data", (b: Buffer) => (out += b.toString()));
  const until = Date.now() + 60_000;
  while (!out.includes("mth-worker started")) {
    if (child.exitCode !== null) throw new Error(`the worker exited (${child.exitCode}) before it started: ${out}`);
    if (Date.now() > until) throw new Error(`the worker did not start within 60 s: ${out}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    child,
    output: () => out,
    async stop(signal: NodeJS.Signals = "SIGTERM") {
      if (child.exitCode !== null) return child.exitCode;
      const exited = new Promise<void>((r) => child.once("exit", () => r()));
      child.kill(signal);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 25_000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5_000))]);
      return child.exitCode;
    },
  };
}

export interface ScanResult {
  readonly status: number | null;
  readonly output: string;
}

/** Runs deploy/scripts/log-scan.mjs as an operator would (its own process, the given environment). */
export function logScan(args: readonly string[], env: Record<string, string>): ScanResult {
  const r = spawnSync(process.execPath, [join(REPO_ROOT, "deploy/scripts/log-scan.mjs"), ...args], {
    cwd: REPO_ROOT,
    env: { PATH: process.env["PATH"] ?? "", ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
