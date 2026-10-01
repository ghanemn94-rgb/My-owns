// F-DG1-009: dropping a scratch database at teardown must never surface as an uncaught FATAL 57P01 ("terminating
// connection due to administrator command"). node-postgres' pool.end() resolves before the server has processed the
// clients' Terminate messages; a DROP DATABASE ... WITH (FORCE) issued at once used to terminate those backends, and
// the 57P01 reached the pool's idle-client listener as a pool 'error' event (uncaught when nobody listens).
// Before the fix the first test reproduced this (see the fail-before evidence in the T-DG1-BE5 handback); now dropScratchDatabase
// waits until the database has no client before dropping, and refuses (naming the leak) instead of terminating one.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { ScratchDatabaseInUse } from "../global-setup.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();

async function exists(name: string): Promise<boolean> {
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  try {
    return (await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name])).rowCount === 1;
  } finally {
    await c.end();
  }
}

describe("dropScratchDatabase never terminates a live client (F-DG1-009)", () => {
  it("a drop right after pool.end() raises no 57P01 on the closing pool (40 rounds, 8 clients each)", async () => {
    const errors: string[] = [];
    for (let i = 0; i < 40; i++) {
      const name = await createScratchDatabase(adminUrl, "mth_drop");
      const pool = new pg.Pool({ connectionString: roleUrl(adminUrl, name, null), max: 8 });
      // A spy instead of no listener, so a regression is an assertion failure rather than a crash of the run.
      pool.on("error", (e: Error & { code?: string }) => errors.push(`${e.code ?? "?"} ${e.message}`));
      await Promise.all(Array.from({ length: 8 }, () => 0).map(() => pool.query("SELECT pg_sleep(0.01)")));
      await pool.end();
      await dropScratchDatabase(adminUrl, name);
      expect(await exists(name)).toBe(false);
    }
    await new Promise((r) => setTimeout(r, 100)); // let any late socket error arrive before asserting
    expect(errors).toEqual([]);
  });

  it("a client that is still connected is NOT terminated: the drop refuses, names it, and succeeds once it ends", async () => {
    const name = await createScratchDatabase(adminUrl, "mth_drop");
    const leaked = new pg.Client({ connectionString: roleUrl(adminUrl, name, null), application_name: "leaky-test" });
    const errors: string[] = [];
    leaked.on("error", (e) => errors.push(e.message));
    await leaked.connect();
    try {
      const err = await dropScratchDatabase(adminUrl, name, { timeoutMs: 300 }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ScratchDatabaseInUse);
      expect((err as Error).message).toMatch(/1 connection\(s\) to mth_drop_\w+ are still open.*leaky-test/);
      expect(await exists(name)).toBe(true);
      expect((await leaked.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]); // still alive, not terminated
    } finally {
      await leaked.end();
    }
    await dropScratchDatabase(adminUrl, name);
    expect(await exists(name)).toBe(false);
    expect(errors).toEqual([]);
  });

  it("refuses a database name that is not a plain identifier (no SQL is built from it)", async () => {
    await expect(dropScratchDatabase(adminUrl, "x; DROP DATABASE postgres")).rejects.toThrow(
      /unexpected database name/,
    );
  });
});
