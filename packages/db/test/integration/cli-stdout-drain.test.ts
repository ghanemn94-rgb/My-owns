// T-R23 (ADR-0064 Amendment 3 §A3.10, DO-D3 Q1; p7-work-split §C.14; REQ-S19-017; T-DG7-BE-R3): `mth-db` ends only
// when stdout has drained. On a migrated database seeded with the SYNTHETIC demo dataset, the built CLI's
// `table-digest --table audit_event --rows` piped through a slow reader gives the same bytes (count and SHA-256) as the
// same command written to a file; the output exceeds 256 KiB, the exit code is 0 and the process ends within 30 s.
// Every value is synthetic. Nothing here approves anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { seedDemo } from "../../src/demo/seed.ts";
import { migrate } from "../../src/migrate.ts";
import { createDb, createPool } from "../../src/pool.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const ROOT = new URL("../../../../", import.meta.url).pathname;
const CLI = join(ROOT, "packages/db/dist/cli.js");
const ARGS = [CLI, "table-digest", "--table", "audit_event", "--rows"];
let name: string;
let appUrl: string;
let dir: string;

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

beforeAll(async () => {
  // Built first: the test runs the shipped entry point, not the TypeScript source.
  execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json"], {
    cwd: join(ROOT, "packages/db"),
    stdio: "inherit",
  });
  name = await createScratchDatabase(adminUrl, "mth_drain");
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  await seedDemo(ownerUrl, {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: false,
  });
  // A freshly seeded demo trail digests to about 118 KB (measured), below the 256 KiB the test needs, so SYNTHETIC
  // service events are appended (INSERT only; the trail stays append-only and both of its triggers stay on).
  const owner = createDb(createPool(ownerUrl, { max: 1 }));
  try {
    await sql`
      INSERT INTO audit_event (id, actor_type, action, record_type, record_id, reason, request_id, source)
      SELECT mth_uuid_v7(), 'service', 'synthetic.drain_probe', 'organization', o.id,
             'SYNTHETIC T-R23 drain probe event ' || g || ' ' || repeat('x', 120), 'job:t-r23', 'worker'
        FROM (SELECT id FROM organization ORDER BY id LIMIT 1) o, generate_series(1, 2000) g`.execute(owner);
  } finally {
    await owner.destroy();
  }
  appUrl = roleUrl(adminUrl, name, "mth_app");
  dir = mkdtempSync(join(tmpdir(), "mth-drain-"));
}, 900_000);

afterAll(async () => {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  if (name !== undefined) await dropScratchDatabase(adminUrl, name);
}, 120_000);

/** Runs the CLI with stdout on `stdout`; resolves with the exit code and the elapsed milliseconds (30 s cap). */
function run(
  stdout: "pipe" | number,
  onPipe?: (s: NodeJS.ReadableStream) => void,
): Promise<{ code: number | null; ms: number }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ARGS, {
      env: { ...process.env, DATABASE_URL: appUrl },
      stdio: ["ignore", stdout, "inherit"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("mth-db table-digest did not end within 30 s (a handle left open?)"));
    }, 30_000);
    if (stdout === "pipe") onPipe!(child.stdout!);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, ms: Date.now() - started });
    });
  });
}

describe("T-R23: mth-db drains a piped stdout before it exits (DO-D3 Q1)", () => {
  it("table-digest --rows piped through a slow reader equals the file output, byte for byte, above 256 KiB", async () => {
    const file = join(dir, "digest.out");
    const fd = openSync(file, "w");
    const toFile = await run(fd);
    closeSync(fd);
    expect(toFile.code).toBe(0);
    const fileBytes = readFileSync(file);
    expect(fileBytes.length).toBeGreaterThan(256 * 1024);

    const chunks: Buffer[] = [];
    const piped = await run("pipe", (s) => {
      // A slow reader: nothing is read for the first second, so the pipe buffer (64 KiB) fills while the CLI writes.
      s.pause();
      s.on("data", (c: Buffer) => chunks.push(c));
      setTimeout(() => s.resume(), 1_000);
    });
    const pipeBytes = Buffer.concat(chunks);
    expect(piped.code).toBe(0);
    expect(piped.ms).toBeLessThan(30_000);
    expect(pipeBytes.length).toBe(fileBytes.length);
    expect(sha(pipeBytes)).toBe(sha(fileBytes));
    expect(pipeBytes.toString("utf8").endsWith("\n")).toBe(true);
  }, 120_000);
});
