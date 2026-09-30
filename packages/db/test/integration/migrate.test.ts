// Migration runner against real PostgreSQL (ADR-0003, REQ-S19-004): fresh database, idempotent re-run, checksum
// lock, database-newer-than-build refusal, atomic failure, owner-only execution.
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defaultMigrationsDir,
  listMigrationFiles,
  migrate,
  MigrationError,
  migrationStatus,
} from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const scratch: string[] = [];
const dirs: string[] = [];

async function freshDb(): Promise<string> {
  const name = await createScratchDatabase(adminUrl, "mth_mig");
  scratch.push(name);
  return name;
}

function copyMigrations(): string {
  const dir = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", "mig-"));
  dirs.push(dir);
  for (const f of readdirSync(defaultMigrationsDir())) cpSync(join(defaultMigrationsDir(), f), join(dir, f));
  return dir;
}

async function statusOf(url: string, dir?: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await migrationStatus(c, listMigrationFiles(dir));
  } finally {
    await c.end();
  }
}

afterAll(async () => {
  for (const name of scratch) await dropScratchDatabase(adminUrl, name);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("mth-db migrate on a fresh database", () => {
  let owner: string;
  beforeAll(async () => {
    owner = roleUrl(adminUrl, await freshDb(), "mth_owner");
  });

  it("applies every shipped migration, then reports up to date", async () => {
    const before = await statusOf(owner);
    expect(before.applied).toHaveLength(0);
    const applied = await migrate(owner);
    expect(applied).toEqual(listMigrationFiles().map((f) => f.name));
    const after = await statusOf(owner);
    expect(after.upToDate).toBe(true);
    expect(after.pending).toEqual([]);
  });

  it("is idempotent on an up-to-date database", async () => {
    expect(await migrate(owner)).toEqual([]);
  });

  it("records id, name, sha256, applied_at and applied_by = mth_owner", async () => {
    const c = new pg.Client({ connectionString: owner });
    await c.connect();
    const { rows } = await c.query("SELECT id, name, sha256, applied_by FROM schema_migration ORDER BY id");
    await c.end();
    expect(rows.map((r) => [r.id, r.name, r.sha256, r.applied_by])).toEqual(
      listMigrationFiles().map((f) => [f.id, f.name, f.sha256, "mth_owner"]),
    );
  });

  it("refuses to run when an applied file changed on disk", async () => {
    const dir = copyMigrations();
    writeFileSync(join(dir, "0003_audit_event.sql"), "-- tampered\n", { flag: "a" });
    await expect(migrate(owner, { dir })).rejects.toThrow(
      /applied migration\(s\) changed on disk: 0003_audit_event.sql/,
    );
    expect((await statusOf(owner, dir)).checksumMismatches).toEqual(["0003_audit_event.sql"]);
  });

  it("refuses to run when the database has a migration the build does not ship", async () => {
    const dir = copyMigrations();
    rmSync(join(dir, "0006_pgboss_schema_v25.sql"));
    await expect(migrate(owner, { dir })).rejects.toBeInstanceOf(MigrationError);
    expect((await statusOf(owner, dir)).unknownApplied).toEqual(["0006_pgboss_schema_v25.sql"]);
  });

  it("applies a new forward migration atomically: a failing file leaves no trace", async () => {
    const dir = copyMigrations();
    writeFileSync(join(dir, "0099_broken.sql"), "CREATE TABLE should_not_exist (id int);\nSELECT 1/0;\n");
    await expect(migrate(owner, { dir })).rejects.toThrow(/0099_broken.sql failed/);
    const c = new pg.Client({ connectionString: owner });
    await c.connect();
    const { rows } = await c.query(
      "SELECT to_regclass('should_not_exist') AS t, (SELECT count(*) FROM schema_migration WHERE name = '0099_broken.sql')::int AS n",
    );
    await c.end();
    expect(rows[0]).toEqual({ t: null, n: 0 });
  });
});

describe("mth-db migrate guards", () => {
  it("refuses to run as the app role (objects must be owned by mth_owner)", async () => {
    const name = await freshDb();
    // mth_app cannot even create the bookkeeping table in a schema it does not own... unless PUBLIC has CREATE.
    // Either way the 0001 guard stops it before any object is created.
    const err = await migrate(roleUrl(adminUrl, name, "mth_app")).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/must run as mth_owner|permission denied/);
  });
});
