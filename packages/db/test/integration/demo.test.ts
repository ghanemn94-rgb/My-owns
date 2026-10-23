// The demonstration environment against a real, disposable PostgreSQL (ADR-0050 §1, §3, §4, §6, §9; T-DG5-BE-S).
// Literal tests of p5-work-split §J.1:
//  - REQ-S18-003: after the production path, SELECT count(*) FROM demo_seed_record = 0 and no demo user exists;
//    `seed-demo` with MTH_ENV=production exits 3 and changes nothing (also on a production-marked or non-empty
//    database);
//  - REQ-S18-001: seed, then reset twice, on a disposable cluster: the record counts and checksums are identical.
// Plus the other refusals of §3 and §9 (exit 3, nothing changed), the bootstrap refusal on a demo database, and the
// append-only protections still in force after a reset. Every database here is a scratch database created and dropped
// inside this run's disposable cluster. Everything seeded is SYNTHETIC; a demo approval approves nothing real.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { bootstrap } from "../../src/bootstrap.ts";
import { checksumLines, datasetChecksum, recordCounts } from "../../src/demo/checksum.ts";
import { DEMO_COVERAGE_CONDITIONS } from "../../src/demo/coverage.ts";
import { DemoRefused, readDeploymentEnvironment, SEED_DEMO_REFUSALS } from "../../src/demo/guard.ts";
import { resetDemo } from "../../src/demo/reset.ts";
import { seedDemo } from "../../src/demo/seed.ts";
import { migrate } from "../../src/migrate.ts";
import { createDb, createPool, type Db } from "../../src/pool.ts";
import { FIXTURE_DEMO_ISSUER, FIXTURE_USER_ID, TEST_DEMO_MODULES } from "../demo-fixture.ts";
import { createScratchDatabase, dropScratchDatabase, pgError, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const dropAtEnd: string[] = [];
// D-174: dropping 11 scratch databases took 33.4 s at load 20 (30 s project budget); 120 s is over 3x that measurement.
afterAll(async () => {
  for (const name of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, name);
}, 120_000);

async function scratch(prefix: string, migrated = true): Promise<{ name: string; ownerUrl: string }> {
  const name = await createScratchDatabase(adminUrl, prefix);
  dropAtEnd.push(name);
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  if (migrated) await migrate(ownerUrl);
  return { name, ownerUrl };
}

async function withDb<T>(url: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const db = createDb(createPool(url, { max: 1 }));
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

async function query<T extends pg.QueryResultRow>(url: string, text: string): Promise<T[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<T>(text)).rows;
  } finally {
    await c.end();
  }
}

/** The whole database state the refusals must leave untouched: every table's count plus the marker. */
async function snapshot(url: string): Promise<unknown> {
  return withDb(url, async (db) =>
    db.transaction().execute(async (tx) => ({
      counts: await recordCounts(tx),
      marker: await readDeploymentEnvironment(tx),
      runs: (await tx.selectFrom("demo_dataset_run").select("run_no").execute()).length,
    })),
  );
}

function runCli(args: string[], env: Record<string, string>) {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !k.startsWith("MTH_") && k !== "DATABASE_OWNER_URL") base[k] = v;
  return spawnSync(process.execPath, ["--conditions=@mth/source", cli, ...args], {
    env: { ...base, NODE_ENV: "test", ...env },
    encoding: "utf8",
    timeout: 180_000,
  });
}

const bootstrapInput = {
  orgCode: "PRODORG",
  orgNameEn: "Example Production Organization",
  orgNameAr: "مؤسسة إنتاج مثال",
  defaultTimezone: "Asia/Riyadh",
  defaultCurrency: "SAR",
  adminDisplayName: "First Admin",
  adminEmail: null,
  adminIssuer: "https://idp.example.invalid/realms/mth",
  adminSubject: "first-admin",
};

describe("REQ-S18-003: the empty production initialization and the seed-demo refusals", () => {
  it("after the production path, demo_seed_record is empty and no demo user exists", async () => {
    const { ownerUrl } = await scratch("mth_demo_prod");
    await withDb(ownerUrl, (db) => bootstrap(db, bootstrapInput));
    const [count] = await query<{ n: string }>(ownerUrl, "SELECT count(*) AS n FROM demo_seed_record");
    expect(count!.n).toBe("0");
    // No demo user: no registered app_user, and no identity of a demo IdP (only the bootstrap's two users exist).
    const [demoUsers] = await query<{ n: string }>(
      ownerUrl,
      "SELECT count(*) AS n FROM demo_seed_record WHERE record_type = 'app_user'",
    );
    expect(demoUsers!.n).toBe("0");
    const identities = await query<{ issuer: string }>(ownerUrl, "SELECT issuer FROM user_identity");
    expect(identities.map((i) => i.issuer)).toEqual([bootstrapInput.adminIssuer]);
    const users = await query<{ display_name: string }>(ownerUrl, "SELECT display_name FROM app_user ORDER BY 1");
    expect(users.map((u) => u.display_name)).toEqual(["First Admin", "System (bootstrap)"]);
    const [marker] = await query<{ environment_kind: string; initialized_via: string; dataset_code: string | null }>(
      ownerUrl,
      "SELECT environment_kind, initialized_via, dataset_code FROM deployment_environment",
    );
    expect(marker).toEqual({ environment_kind: "production", initialized_via: "bootstrap", dataset_code: null });

    // seed-demo on the production-marked database: exit 3, the exact line, nothing changed.
    const before = await snapshot(ownerUrl);
    const r = runCli(["seed-demo"], { DATABASE_OWNER_URL: ownerUrl, MTH_ENV: "demo" });
    expect([r.status, r.stderr.trim()]).toEqual([
      3,
      "mth-db seed-demo: refused: this database was initialized for production",
    ]);
    expect(await snapshot(ownerUrl)).toEqual(before);
  }, 120_000);

  it("seed-demo with MTH_ENV=production exits 3 and changes nothing (on an empty, a production-marked and a non-empty database)", async () => {
    const empty = await scratch("mth_demo_envprod");
    const marked = await scratch("mth_demo_envprod_m");
    await withDb(marked.ownerUrl, (db) => bootstrap(db, bootstrapInput));
    for (const { ownerUrl } of [empty, marked]) {
      const before = await snapshot(ownerUrl);
      const r = runCli(["seed-demo"], { DATABASE_OWNER_URL: ownerUrl, MTH_ENV: "production" });
      expect([r.status, r.stderr.trim()]).toEqual([3, "mth-db seed-demo: refused: MTH_ENV is production"]);
      expect(await snapshot(ownerUrl)).toEqual(before);
    }
    // NODE_ENV=production without MTH_ENV defaults to production (ADR-0050 §1).
    const r = runCli(["seed-demo"], { DATABASE_OWNER_URL: empty.ownerUrl, NODE_ENV: "production" });
    expect([r.status, r.stderr.trim()]).toEqual([3, "mth-db seed-demo: refused: MTH_ENV is production"]);
    const [n] = await query<{ n: string }>(empty.ownerUrl, "SELECT count(*) AS n FROM deployment_environment");
    expect(n!.n).toBe("0");
  }, 120_000);

  it("seed-demo on an unmarked database that is not empty exits 3 and changes nothing", async () => {
    const { ownerUrl } = await scratch("mth_demo_nonempty");
    await query(
      ownerUrl,
      `INSERT INTO organization (id, code, name_en, name_ar) VALUES ('0199aaaa-0000-7000-8000-000000000001', 'REALDATA', 'Existing', 'قائم');
       INSERT INTO app_user (id, organization_id, display_name) VALUES ('0199aaaa-0000-7000-8000-000000000002', '0199aaaa-0000-7000-8000-000000000001', 'Existing user')`,
    );
    const before = await snapshot(ownerUrl);
    const r = runCli(["seed-demo"], { DATABASE_OWNER_URL: ownerUrl, MTH_ENV: "demo" });
    expect([r.status, r.stderr.trim()]).toEqual([3, "mth-db seed-demo: refused: this database is not empty"]);
    expect(await snapshot(ownerUrl)).toEqual(before);
  }, 120_000);

  it("a second seed-demo exits 3 (use reset-demo), and bootstrap refuses a demo database (exit 3)", async () => {
    const { ownerUrl } = await scratch("mth_demo_twice");
    const first = runCli(["seed-demo"], { DATABASE_OWNER_URL: ownerUrl, MTH_ENV: "demo" });
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("SYNTHETIC demonstration dataset");
    expect(first.stdout).toMatch(/checksum {2}[0-9a-f]{64}/);
    const before = await snapshot(ownerUrl);
    const again = runCli(["seed-demo"], { DATABASE_OWNER_URL: ownerUrl, MTH_ENV: "demo" });
    expect([again.status, again.stderr.trim()]).toEqual([
      3,
      "mth-db seed-demo: refused: this database is already a demo database; use reset-demo",
    ]);
    const boot = runCli(
      [
        "bootstrap",
        "--org-code",
        "X",
        "--org-name-en",
        "X",
        "--org-name-ar",
        "س",
        "--admin-name",
        "A",
        "--admin-issuer",
        "https://idp.example.invalid",
        "--admin-subject",
        "a",
      ],
      { DATABASE_OWNER_URL: ownerUrl },
    );
    expect([boot.status, boot.stderr.trim()]).toEqual([
      3,
      "mth-db bootstrap: refused: this database is a demo database",
    ]);
    expect(await snapshot(ownerUrl)).toEqual(before);
  }, 120_000);

  it("the guard refuses in the library too (DemoRefused, exit code 3), before any write", async () => {
    const { ownerUrl } = await scratch("mth_demo_lib");
    const err = await seedDemo(ownerUrl, {
      mthEnv: "production",
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
      modules: TEST_DEMO_MODULES,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DemoRefused);
    expect([(err as DemoRefused).exitCode, (err as DemoRefused).reason]).toEqual([3, SEED_DEMO_REFUSALS.production]);
    const [n] = await query<{ n: string }>(ownerUrl, "SELECT count(*) AS n FROM organization");
    expect(n!.n).toBe("0");
  }, 120_000);
});

describe("REQ-S18-001: seed, then reset twice: identical record counts and checksums", () => {
  it("with the synthetic test dataset (library): counts and checksum identical across seed, reset, reset", async () => {
    const { name, ownerUrl } = await scratch("mth_demo_reset");
    const seeded = await seedDemo(ownerUrl, {
      mthEnv: "demo",
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
      modules: TEST_DEMO_MODULES,
    });
    expect([seeded.runNo, seeded.runKind, seeded.seededRecords]).toEqual([1, "seed", 3]);
    expect(seeded.recordCounts["demo_seed_record"]).toBe(3);
    expect(seeded.recordCounts["deployment_environment"]).toBe(1);
    expect(seeded.recordCounts).not.toHaveProperty("demo_dataset_run");
    expect(Object.keys(seeded.recordCounts)).toEqual([...Object.keys(seeded.recordCounts)].sort());
    // Every condition has its SQL (T-DG5-BE-T); this test dataset has no roaming transformation, so every condition
    // counts 0 and the run is not complete.
    expect(seeded.coverage).toEqual(Object.fromEntries(DEMO_COVERAGE_CONDITIONS.map((c) => [c.code, 0])));
    expect(seeded.coverageNotImplemented).toEqual([]);
    expect(seeded.coverageComplete).toBe(false);

    // A demo user adds a record between runs: the reset discards it (a demo reset discards synthetic data by design).
    await query(
      ownerUrl,
      `INSERT INTO organization (id, code, name_en, name_ar) VALUES ('0199bbbb-0000-7000-8000-000000000001', 'ADDED', 'Added in demo', 'مضاف')`,
    );
    const lines1 = await withDb(ownerUrl, (db) => db.transaction().execute((tx) => checksumLines(tx)));

    const resets = [];
    for (let i = 0; i < 2; i++)
      resets.push(
        await resetDemo({
          mthEnv: "demo",
          adminUrl,
          ownerUrl,
          requestedVia: "cli",
          requestedBy: null,
          modules: TEST_DEMO_MODULES,
        }),
      );
    for (const r of resets) {
      expect([r.runNo, r.runKind]).toEqual([1, "reset"]);
      expect(r.recordCounts).toEqual(seeded.recordCounts);
      expect(r.checksumSha256).toBe(seeded.checksumSha256);
    }
    const lines2 = await withDb(ownerUrl, (db) => db.transaction().execute((tx) => checksumLines(tx)));
    expect(lines2).toEqual(lines1);
    // The checksum covers the synthetic-clock time and omits the clock-defaulted created_at.
    const identity = lines2.find((l) => l.startsWith("user_identity\t"))!;
    expect(identity).toContain('"last_login_at": "2026-08-31T08:00:00+00:00"');
    expect(identity).not.toContain("created_at");
    expect(lines2.at(-1)).toMatch(/^demo_seed_record\tuser_identity\t/);
    const [added] = await query<{ n: string }>(ownerUrl, "SELECT count(*) AS n FROM organization WHERE code = 'ADDED'");
    expect(added!.n).toBe("0");

    // The run row, the marker, and the append-only protections are intact after a reset (never disabled).
    const [run] = await query<{ run_no: number; run_kind: string; requested_via: string; checksum_sha256: string }>(
      ownerUrl,
      "SELECT run_no, run_kind, requested_via, checksum_sha256 FROM demo_dataset_run",
    );
    expect(run).toEqual({ run_no: 1, run_kind: "reset", requested_via: "cli", checksum_sha256: seeded.checksumSha256 });
    for (const stmt of [
      "UPDATE deployment_environment SET dataset_version = '9.9.9'",
      "DELETE FROM demo_seed_record",
      "TRUNCATE demo_dataset_run",
      "DELETE FROM audit_event",
    ]) {
      const e = await pgError(query(ownerUrl, stmt));
      expect(e.code, `${stmt}: ${e.message}`).toBeDefined();
    }
    // Same encoding and locale as before the reset.
    const [db] = await query<{ enc: string; datcollate: string }>(
      adminUrl,
      `SELECT pg_encoding_to_char(encoding) AS enc, datcollate FROM pg_database WHERE datname = '${name}'`,
    );
    expect(db).toEqual({ enc: "UTF8", datcollate: "C" });
    // The seeded demo user names the demo IdP issuer only; nothing stores a credential.
    const ids = await query<{ user_id: string; issuer: string }>(ownerUrl, "SELECT user_id, issuer FROM user_identity");
    expect(ids).toEqual([{ user_id: FIXTURE_USER_ID, issuer: FIXTURE_DEMO_ISSUER }]);
  }, 300_000);

  it("through the CLI (the shipped dataset): seed-demo, then reset-demo twice gives identical counts and checksums", async () => {
    const { ownerUrl } = await scratch("mth_demo_cli");
    const outputs: string[] = [];
    const seed = runCli(["seed-demo"], { DATABASE_OWNER_URL: ownerUrl, MTH_ENV: "demo" });
    expect(seed.status, seed.stderr).toBe(0);
    outputs.push(seed.stdout);
    for (let i = 0; i < 2; i++) {
      const r = runCli(["reset-demo"], {
        DATABASE_OWNER_URL: ownerUrl,
        MTH_ENV: "demo",
        MTH_DEMO_ADMIN_DATABASE_URL: adminUrl,
      });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain("run 1 (reset)");
      outputs.push(r.stdout);
    }
    const resultOf = (out: string) =>
      out
        .split("\n")
        .filter((l) => l.startsWith("count  ") || l.startsWith("checksum  "))
        .join("\n");
    expect(resultOf(outputs[1]!)).toBe(resultOf(outputs[0]!));
    expect(resultOf(outputs[2]!)).toBe(resultOf(outputs[0]!));
    expect(resultOf(outputs[0]!)).toMatch(/checksum {2}[0-9a-f]{64}/);
  }, 300_000);

  it("reset-demo refusals exit 3 and drop nothing: MTH_ENV not demo, no admin URL, a production target", async () => {
    const prod = await scratch("mth_demo_rprod");
    await withDb(prod.ownerUrl, (db) => bootstrap(db, bootstrapInput));
    const before = await snapshot(prod.ownerUrl);
    const cases: [Record<string, string>, string][] = [
      [{ MTH_ENV: "production", MTH_DEMO_ADMIN_DATABASE_URL: adminUrl }, "MTH_ENV is not demo"],
      [{ MTH_ENV: "test", MTH_DEMO_ADMIN_DATABASE_URL: adminUrl }, "MTH_ENV is not demo"],
      [{ MTH_ENV: "demo" }, "MTH_DEMO_ADMIN_DATABASE_URL is not set"],
      [{ MTH_ENV: "demo", MTH_DEMO_ADMIN_DATABASE_URL: adminUrl }, "the target database is not a demo database"],
    ];
    for (const [env, reason] of cases) {
      const r = runCli(["reset-demo"], { DATABASE_OWNER_URL: prod.ownerUrl, ...env });
      expect([r.status, r.stderr.trim()]).toEqual([3, `mth-db reset-demo: refused: ${reason}`]);
    }
    expect(await snapshot(prod.ownerUrl)).toEqual(before);
    // An unmarked, migrated database is not a demo database either.
    const unmarked = await scratch("mth_demo_runm");
    const r = runCli(["reset-demo"], {
      DATABASE_OWNER_URL: unmarked.ownerUrl,
      MTH_ENV: "demo",
      MTH_DEMO_ADMIN_DATABASE_URL: adminUrl,
    });
    expect([r.status, r.stderr.trim()]).toEqual([
      3,
      "mth-db reset-demo: refused: the target database is not a demo database",
    ]);
  }, 300_000);

  it("the checksum depends on the registered rows' content (a changed value changes it)", async () => {
    const { ownerUrl } = await scratch("mth_demo_sum");
    const seeded = await seedDemo(ownerUrl, {
      mthEnv: "demo",
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
      modules: TEST_DEMO_MODULES,
    });
    await query(ownerUrl, "UPDATE organization SET name_en = 'Changed' WHERE code = 'SYN-DEMO'");
    const after = await withDb(ownerUrl, (db) => db.transaction().execute((tx) => datasetChecksum(tx)));
    expect(after).not.toBe(seeded.checksumSha256);
  }, 120_000);
});
