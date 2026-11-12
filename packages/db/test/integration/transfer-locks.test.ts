// T-C13 (ADR-0064 §10; ADR-0016 §6; p7-work-split §C.2, §C.6; T-DG7-BE-D): the migration CLI's two lock constants equal
// the registry's `migrationImport` and `identityRebind` entries (read as TEXT from apps/api's advisory-locks.ts: this
// package cannot import apps/api, ADR-0002; the demoReset precedent), and a second import (or re-check) waits on the
// session lock while another holds it; a rebind waits on its own class. Own scratch database. Nothing here approves
// anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../src/migrate.ts";
import { createDb, createPool, type Db } from "../../src/pool.ts";
import {
  applyRebind,
  IDENTITY_REBIND_LOCK_CLASS,
  IDENTITY_REBIND_LOCK_KEY,
  MIGRATION_IMPORT_LOCK_CLASS,
  MIGRATION_IMPORT_LOCK_KEY,
  withMigrationImportLock,
} from "../../src/transfer/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const REGISTRY = fileURLToPath(new URL("../../../../apps/api/src/modules/platform/advisory-locks.ts", import.meta.url));

const { adminUrl } = testDatabase();
let name: string;
let ownerUrl: string;
let db: Db;

beforeAll(async () => {
  name = await createScratchDatabase(adminUrl, "mth_transfer_locks");
  ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  db = createDb(createPool(ownerUrl, { max: 3 }));
}, 120_000);

afterAll(async () => {
  await db?.destroy();
  if (name) await dropScratchDatabase(adminUrl, name);
});

/** Whether some backend of this database waits on an advisory lock. */
async function someoneWaits(client: pg.Client): Promise<boolean> {
  const r = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
  );
  return r.rows[0]!.n !== "0";
}

async function waitsWhileHeld(lockClass: number, key: string, run: () => Promise<unknown>): Promise<void> {
  const holder = new pg.Client({ connectionString: ownerUrl });
  await holder.connect();
  try {
    await holder.query("SELECT pg_advisory_lock($1::int, hashtext($2))", [lockClass, key]);
    let done = false;
    const pending = run().then((v) => {
      done = true;
      return v;
    });
    let waited = false;
    for (let i = 0; i < 50 && !waited; i += 1) {
      waited = await someoneWaits(holder);
      if (!waited) await new Promise((r) => setTimeout(r, 50));
    }
    expect(waited).toBe(true);
    expect(done).toBe(false);
    await holder.query("SELECT pg_advisory_unlock($1::int, hashtext($2))", [lockClass, key]);
    await pending;
    expect(done).toBe(true);
  } finally {
    await holder.end();
  }
}

describe("T-C13: the migration CLI's lock classes", () => {
  it("equal the registry's migrationImport (730403) and identityRebind (730404), read as text", () => {
    const text = readFileSync(REGISTRY, "utf8");
    const entry = (n: string) => Number(new RegExp(`^\\s*${n}: (\\d+),`, "m").exec(text)?.[1]);
    expect(MIGRATION_IMPORT_LOCK_CLASS).toBe(entry("migrationImport"));
    expect(IDENTITY_REBIND_LOCK_CLASS).toBe(entry("identityRebind"));
    expect([MIGRATION_IMPORT_LOCK_CLASS, IDENTITY_REBIND_LOCK_CLASS]).toEqual([730403, 730404]);
    expect(text).toContain(`One class-wide key: "${MIGRATION_IMPORT_LOCK_KEY}"`);
    expect(text).toContain(`One class-wide key: "${IDENTITY_REBIND_LOCK_KEY}"`);
  });

  it("a second import waits on the session lock while another session holds it", async () => {
    await waitsWhileHeld(MIGRATION_IMPORT_LOCK_CLASS, MIGRATION_IMPORT_LOCK_KEY, () =>
      withMigrationImportLock(db, async () => "ran"),
    );
    // Released after the run: the lock is free again.
    const probe = await db.connection().execute(async (c) => {
      const r = await sql<{
        ok: boolean;
      }>`SELECT pg_try_advisory_lock(${MIGRATION_IMPORT_LOCK_CLASS}::int, hashtext(${MIGRATION_IMPORT_LOCK_KEY})) AS ok`.execute(
        c,
      );
      await sql`SELECT pg_advisory_unlock(${MIGRATION_IMPORT_LOCK_CLASS}::int, hashtext(${MIGRATION_IMPORT_LOCK_KEY}))`.execute(
        c,
      );
      return r.rows[0]!.ok;
    });
    expect(probe).toBe(true);
  });

  it("a rebind waits on the identityRebind lock", async () => {
    const mapping = Buffer.from("user_id,action,new_issuer,new_subject\n", "utf8");
    await waitsWhileHeld(IDENTITY_REBIND_LOCK_CLASS, IDENTITY_REBIND_LOCK_KEY, () =>
      applyRebind(db, mapping, "Synthetic operator"),
    );
  });
});
