// code-security-reviewer, DG5 round 2 (T-DG5-RG-SEC-R2): F-DG5-100 re-verification on the real stack (API + the run's
// disposable PostgreSQL), en and ar. Disposable: copied into the review clone as
// apps/api/test/integration/zz-sec-r2-migration-order-stack.test.ts and removed afterwards; never part of the candidate.
// The CLI half (mth-db migrate / status on a scratch database with a gap file in the shipped directory) is
// repro/f100-cli.sh.
//
// 1. The real server's /readyz, with the build's migration list plus a file in each of the eight retired P5 gaps,
//    answers 503 {database: ok, migrations: fail} with Accept-Language en AND ar (readiness is language-independent);
//    a file ABOVE the highest id answers 503 `pending` (a forward migration to apply), never `fail`.
// 2. The runner's own migrate() on a scratch database migrated to 0097 refuses a gap file (all eight gaps), applies
//    nothing (not even a valid 0098 in the same build), and a duplicate id (0097_other.sql) is refused by the listing.
// 3. A database migrated only up to 0065 (an old, not-yet-upgraded database) still accepts 0066 in place: the rule is
//    "above the highest APPLIED id", the same order as a fresh database (no false refusal).
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsDir,
  listMigrationFiles,
  migrate,
  MigrationError,
  migrationStatus,
} from "../../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../../../../packages/db/test/helpers.ts";
import { call, startApi } from "../support/harness.ts";

const GAPS = [66, 67, 73, 77, 78, 79, 83, 84];
const scratch: string[] = [];
const dirs: string[] = [];
const adminUrl = () => testDatabase().adminUrl;

function copyMigrations(upTo = 9999): string {
  const dir = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "sec-r2-mig-"));
  dirs.push(dir);
  for (const f of readdirSync(defaultMigrationsDir()))
    if (Number(f.slice(0, 4)) <= upTo) cpSync(join(defaultMigrationsDir(), f), join(dir, f));
  return dir;
}
async function statusOf(url: string, dir: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await migrationStatus(c, listMigrationFiles(dir));
  } finally {
    await c.end();
  }
}
afterAll(async () => {
  for (const n of scratch) await dropScratchDatabase(adminUrl(), n);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("F-DG5-100 /readyz on the real server, en and ar", () => {
  const files = listMigrationFiles();
  for (const id of GAPS)
    it.each(["en", "ar"])(`a build with a file in the retired gap ${id} is 503 migrations: fail (%s)`, async (lang) => {
      const gap = { id, name: `${String(id).padStart(4, "0")}_p6_example.sql`, sha256: "0".repeat(64), sql: "" };
      const late = await startApi({ migrationFiles: [...files, gap].sort((x, y) => x.id - y.id) });
      try {
        const r = await call(late.app, "GET", "/readyz", { headers: { "accept-language": lang } });
        console.log(`SEC-R2 readyz gap ${gap.name} ${lang}: ${r.status} ${JSON.stringify(r.body)}`);
        expect([r.status, r.body]).toEqual([503, { status: "not_ready", checks: { database: "ok", migrations: "fail" } }]);
      } finally {
        await late.close();
      }
    });
  it.each(["en", "ar"])("control: a forward file 0098 is 503 migrations: pending (%s)", async (lang) => {
    const fwd = { id: 98, name: "0098_p6_forward.sql", sha256: "0".repeat(64), sql: "" };
    const late = await startApi({ migrationFiles: [...files, fwd] });
    try {
      const r = await call(late.app, "GET", "/readyz", { headers: { "accept-language": lang } });
      console.log(`SEC-R2 readyz forward 0098 ${lang}: ${r.status} ${JSON.stringify(r.body)}`);
      expect([r.status, r.body]).toEqual([503, { status: "not_ready", checks: { database: "ok", migrations: "pending" } }]);
    } finally {
      await late.close();
    }
  });
  it.each(["en", "ar"])("control: the shipped build is 200 ready (%s)", async (lang) => {
    const api = await startApi();
    try {
      const r = await call(api.app, "GET", "/readyz", { headers: { "accept-language": lang } });
      expect([r.status, r.body]).toEqual([200, { status: "ready", checks: { database: "ok", migrations: "ok" } }]);
    } finally {
      await api.close();
    }
  });
});

describe("F-DG5-100 migrate() on scratch databases", () => {
  it("an upgraded database (0001-0097) refuses every gap file and applies nothing, not even a valid 0098", async () => {
    const name = await createScratchDatabase(adminUrl(), "sec_r2_mig");
    scratch.push(name);
    const owner = roleUrl(adminUrl(), name, "mth_owner");
    await migrate(owner);
    for (const id of GAPS) {
      const dir = copyMigrations();
      const gap = `${String(id).padStart(4, "0")}_p6_example.sql`;
      writeFileSync(join(dir, gap), `CREATE TABLE sec_r2_gap_${id} (id int);\n`);
      writeFileSync(join(dir, "0098_p6_forward.sql"), "CREATE TABLE sec_r2_fwd (id int);\n");
      const err = await migrate(owner, { dir }).catch((e: unknown) => e);
      console.log(`SEC-R2 migrate with ${gap}: ${(err as Error).message}`);
      expect(err).toBeInstanceOf(MigrationError);
      expect((err as Error).message).toContain(`pending migration(s) ${gap} have an id not above the highest applied`);
      const s = await statusOf(owner, dir);
      expect(s.outOfOrderPending).toEqual([gap]);
      expect(s.pending).toEqual([gap, "0098_p6_forward.sql"]);
    }
    const c = new pg.Client({ connectionString: owner });
    await c.connect();
    const { rows } = await c.query(
      `SELECT (SELECT count(*) FROM pg_class WHERE relname LIKE 'sec_r2_%')::int AS tables,
              (SELECT count(*) FROM schema_migration)::int AS applied`,
    );
    await c.end();
    console.log(`SEC-R2 after the refusals: ${JSON.stringify(rows[0])}`);
    expect(rows[0]).toEqual({ tables: 0, applied: listMigrationFiles().length });
  });

  it("a duplicate id (0097_other.sql) is refused by the listing itself", () => {
    const dir = copyMigrations();
    writeFileSync(join(dir, "0097_other.sql"), "SELECT 1;\n");
    expect(() => listMigrationFiles(dir)).toThrow();
  });

  it("no false refusal: a database migrated only to 0065 applies 0066 in place, in the fresh-database order", async () => {
    const name = await createScratchDatabase(adminUrl(), "sec_r2_old");
    scratch.push(name);
    const owner = roleUrl(adminUrl(), name, "mth_owner");
    const old = copyMigrations(65);
    await migrate(owner, { dir: old });
    const later = copyMigrations(65);
    writeFileSync(join(later, "0066_p6_example.sql"), "SELECT 1;\n");
    expect(await migrate(owner, { dir: later })).toEqual(["0066_p6_example.sql"]);
  });
});
