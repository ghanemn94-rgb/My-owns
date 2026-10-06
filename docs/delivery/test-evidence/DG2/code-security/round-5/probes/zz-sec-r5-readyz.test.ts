// code-security-reviewer DG2 round-5 /readyz + UTF8 guard probe (T-DG2-REV-SEC-R5). NOT part of the candidate: copied
// into a disposable clone (96a3c293) at apps/api/test/integration/ and run against a disposable PostgreSQL 16.
// All data SYNTHETIC.
//  1. Positive-cache masking: an API process whose /readyz has cached "UTF8" keeps running while its database is
//     dropped and recreated under the SAME name as SQL_ASCII. Expect: never 200 (the empty database has no migrations,
//     and `mth-db migrate` refuses SQL_ASCII, so it cannot be made "up to date" by the product's tooling); a fresh
//     process on it reports database: fail.
//  2. Not-ready path writes nothing: 5 probes on a SQL_ASCII database leave it with zero user objects.
//  3. No internals in the body: exactly { status, checks: { database, migrations } }.
//  4. migrate() through a URL whose options try to change client_encoding still sees the server encoding.
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseEncodingError } from "../../../../packages/db/src/encoding.ts";
import { migrate } from "../../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../../../../packages/db/test/helpers.ts";
import { call, startApi } from "../support/harness.ts";

const { adminUrl } = testDatabase();
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const cleanup: string[] = [];
afterAll(async () => {
  for (const d of cleanup) await dropScratchDatabase(adminUrl, d).catch(() => undefined);
});
async function admin<R extends pg.QueryResultRow>(text: string, url = adminUrl): Promise<R[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<R>(text)).rows;
  } finally {
    await c.end();
  }
}
const objects = async (db: string) =>
  (await admin<{ n: string }>(`SELECT count(*) n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname NOT IN ('pg_catalog','information_schema') AND s.nspname NOT LIKE 'pg_toast%'`, roleUrl(adminUrl, db, null)))[0]!.n;

describe("/readyz positive cache cannot produce a false ready", () => {
  it("UTF8 db (migrated) -> 200; dropped and recreated as SQL_ASCII under the same name -> never 200", async () => {
    const db = await createScratchDatabase(adminUrl, "mth_r5_swap");
    cleanup.push(db);
    await migrate(roleUrl(adminUrl, db, "mth_owner"));
    const api = await startApi({ database: db });
    try {
      const r1 = await call(api.app, "GET", "/readyz");
      log("swap.before", [r1.status, r1.body]);
      expect(r1.status).toBe(200);
      expect(Object.keys(r1.body).sort()).toEqual(["checks", "status"]);
      expect(Object.keys(r1.body.checks).sort()).toEqual(["database", "migrations"]);
      await admin(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${db}' AND pid <> pg_backend_pid()`);
      await admin(`DROP DATABASE ${db} WITH (FORCE)`);
      await admin(`CREATE DATABASE ${db} OWNER mth_owner ENCODING 'SQL_ASCII' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
      const seen: unknown[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await call(api.app, "GET", "/readyz", { contract: false });
        seen.push([r.status, r.body]);
      }
      const mig = await migrate(roleUrl(adminUrl, db, "mth_owner")).then(() => "migrated", (e: unknown) => (e instanceof DatabaseEncodingError ? `refused: ${e.message}` : String(e)));
      const r3 = await call(api.app, "GET", "/readyz", { contract: false });
      log("swap.after", { probes: seen, migrateAttempt: mig, afterMigrateAttempt: [r3.status, r3.body], objects: await objects(db) });
      for (const s of seen) expect((s as [number])[0]).toBe(503);
      expect(mig).toMatch(/^refused/);
      expect(r3.status).toBe(503);
    } finally {
      await api.close();
    }
    const fresh = await startApi({ database: db });
    try {
      const r = await call(fresh.app, "GET", "/readyz");
      log("swap.freshProcess", [r.status, r.body]);
      expect([r.status, r.body]).toEqual([503, { status: "not_ready", checks: { database: "fail", migrations: "fail" } }]);
    } finally {
      await fresh.close();
    }
  });
});

describe("not-ready path writes nothing; no internals", () => {
  it("5 probes on SQL_ASCII: 503, body has only status/checks, zero objects created", async () => {
    const db = await createScratchDatabase(adminUrl, "mth_r5_ascii", { encoding: "SQL_ASCII" });
    cleanup.push(db);
    const before = await objects(db);
    const api = await startApi({ database: db });
    const bodies: string[] = [];
    try {
      for (let i = 0; i < 5; i++) {
        const r = await call(api.app, "GET", "/readyz");
        bodies.push(JSON.stringify([r.status, r.body]));
      }
    } finally {
      await api.close();
    }
    const after = await objects(db);
    log("ascii.readyz", { bodies: [...new Set(bodies)], before, after });
    expect(new Set(bodies)).toEqual(new Set([JSON.stringify([503, { status: "not_ready", checks: { database: "fail", migrations: "fail" } }])]));
    expect(bodies.join("")).not.toMatch(/SQL_ASCII|UTF8|encoding|postgres|mth_/i);
    expect(after).toBe(before);
  });

  it("migrate() with options=-c client_encoding=LATIN1 on SQL_ASCII still refuses; on UTF8 still sees UTF8", async () => {
    const ascii = await createScratchDatabase(adminUrl, "mth_r5_ce", { encoding: "SQL_ASCII" });
    cleanup.push(ascii);
    const u = new URL(roleUrl(adminUrl, ascii, "mth_owner"));
    u.searchParams.set("options", `${u.searchParams.get("options") ?? ""} -c client_encoding=LATIN1`.trim());
    const r = await migrate(u.toString()).then(() => "migrated", (e: unknown) => (e instanceof DatabaseEncodingError ? `refused(${e.found})` : `other: ${String(e)}`));
    log("clientEncoding.ascii", { url_options: u.searchParams.get("options"), result: r, objects: await objects(ascii) });
    expect(r).toBe("refused(SQL_ASCII)");
    expect(await objects(ascii)).toBe("0");
  });
});
