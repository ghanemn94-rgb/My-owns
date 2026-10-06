// The product requires a UTF8 database (ADR-0003 "Database encoding", T-DG2-BE9).
//  - the per-run test database is UTF8 whatever the shell locale (global-setup creates it explicitly);
//  - `mth-db migrate` (and status/bootstrap/seed-dev, same connection path) refuses a SQL_ASCII database with a
//    clear message and exit 1, BEFORE creating anything: no schema_migration table, no row, no other object;
//  - the library entry point `migrate()` refuses the same way (DatabaseEncodingError).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseEncodingError } from "../../src/encoding.ts";
import { migrate } from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl, database, ownerUrl } = testDatabase();
const cli = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const REFUSAL =
  "mth-db: the database must use UTF8 encoding (found SQL_ASCII); create it with ENCODING 'UTF8' TEMPLATE template0";

async function query<R extends pg.QueryResultRow>(url: string, text: string): Promise<R[]> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query<R>(text)).rows;
  } finally {
    await c.end();
  }
}

function runCli(url: string, args: string[]) {
  return spawnSync(process.execPath, ["--conditions=@mth/source", cli, ...args], {
    // seed-dev is allowed only in a dev/test setting; give it one so the ONLY possible refusal is the encoding.
    env: { ...process.env, NODE_ENV: "test", AUTH_MODE: "dev", DATABASE_OWNER_URL: url },
    encoding: "utf8",
  });
}

/** Every relation, function and type the owner could have created in `public` (empty on a fresh database). */
async function userObjects(url: string): Promise<string[]> {
  const rows = await query<{ obj: string }>(
    url,
    `SELECT 'rel ' || relname AS obj FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%'
     UNION ALL
     SELECT 'schema ' || nspname FROM pg_namespace
       WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public') AND nspname NOT LIKE 'pg_t%'
     ORDER BY 1`,
  );
  return rows.map((r) => r.obj);
}

describe("the per-run test database", () => {
  it("is UTF8 (C locale), independent of the shell's LANG/LC_*", async () => {
    const [enc] = await query<{ server_encoding: string }>(ownerUrl, "SHOW server_encoding");
    expect(enc?.server_encoding).toBe("UTF8");
    const [db] = await query<{ encoding: string; datcollate: string; datctype: string }>(
      adminUrl,
      `SELECT pg_encoding_to_char(encoding) AS encoding, datcollate, datctype FROM pg_database WHERE datname = '${database}'`,
    );
    expect(db).toEqual({ encoding: "UTF8", datcollate: "C", datctype: "C" });
  });

  it("counts characters, not bytes: a 200-code-point astral string has char_length 200 (F-DG2-181 root cause)", async () => {
    const [r] = await query<{ chars: number; bytes: number }>(
      ownerUrl,
      `SELECT char_length(repeat(U&'\\+01F600', 200)) AS chars, octet_length(repeat(U&'\\+01F600', 200)) AS bytes`,
    );
    expect(r).toEqual({ chars: 200, bytes: 800 });
  });
});

describe("a SQL_ASCII database is refused before anything is created", () => {
  let sqlAscii: string;
  let owner: string;
  beforeAll(async () => {
    sqlAscii = await createScratchDatabase(adminUrl, "mth_ascii", { encoding: "SQL_ASCII" });
    owner = roleUrl(adminUrl, sqlAscii, "mth_owner");
    const [enc] = await query<{ server_encoding: string }>(owner, "SHOW server_encoding");
    expect(enc?.server_encoding).toBe("SQL_ASCII"); // the precondition of this suite
  });
  afterAll(async () => {
    if (sqlAscii) await dropScratchDatabase(adminUrl, sqlAscii);
  });

  it("mth-db migrate: exit 1, the message on stderr, nothing applied, no schema_migration table", async () => {
    const run = runCli(owner, ["migrate"]);
    expect(run.status).toBe(1);
    expect(run.stderr.trim()).toBe(REFUSAL);
    expect(run.stdout).not.toMatch(/applying/);
    const [t] = await query<{ t: string | null }>(owner, "SELECT to_regclass('public.schema_migration')::text AS t");
    expect(t?.t).toBeNull();
    expect(await userObjects(owner)).toEqual([]);
  });

  it.each([["status"], ["seed-dev"]])("mth-db %s: exit 1 with the same message, nothing written", async (cmd) => {
    const run = runCli(owner, [cmd]);
    expect([run.status, run.stderr.trim()]).toEqual([1, REFUSAL]);
    expect(await userObjects(owner)).toEqual([]);
  });

  it("mth-db bootstrap: exit 1 with the same message (checked before the arguments are used)", async () => {
    const run = runCli(owner, [
      "bootstrap",
      "--org-code",
      "ENC",
      "--org-name-en",
      "Encoding check",
      "--org-name-ar",
      "فحص الترميز",
      "--admin-name",
      "مسؤول",
      "--admin-issuer",
      "https://idp.example.invalid",
      "--admin-subject",
      "enc-admin",
    ]);
    expect([run.status, run.stderr.trim()]).toEqual([1, REFUSAL]);
    expect(await userObjects(owner)).toEqual([]);
  });

  it("migrate() (library entry point) throws DatabaseEncodingError and creates nothing", async () => {
    const err = await migrate(owner).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DatabaseEncodingError);
    expect((err as DatabaseEncodingError).found).toBe("SQL_ASCII");
    expect(await userObjects(owner)).toEqual([]);
  });

  it("control: the same CLI migrates a UTF8 scratch database created the same way", async () => {
    const utf8 = await createScratchDatabase(adminUrl, "mth_utf8");
    try {
      const run = runCli(roleUrl(adminUrl, utf8, "mth_owner"), ["migrate"]);
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toMatch(/applied \d+ migration\(s\)/);
    } finally {
      await dropScratchDatabase(adminUrl, utf8);
    }
  });
});
