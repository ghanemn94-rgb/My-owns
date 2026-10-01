// Vitest global setup for the `integration` project (ADR-0012). One disposable PostgreSQL database per run.
//
//  1. Connects with TEST_DATABASE_ADMIN_URL (a superuser of a disposable/CI cluster). Missing -> the whole project
//     FAILS with "BLOCKED: no database" (never a silent skip; CLAUDE.md).
//  2. Creates the roles mth_owner and mth_app if they are missing (NOLOGIN: tests reach them through the admin
//     connection with the `role` startup parameter, so no test password is created or stored anywhere).
//  3. Creates mth_test_<runId> OWNED BY mth_owner and applies ALL migrations to it as mth_owner (this doubles as the
//     REQ-S19-004 "applied to a fresh database" check).
//  4. Provides the URLs to test files (inject("mthDb")) and as TEST_DATABASE_URL / TEST_DATABASE_OWNER_URL.
//  5. Drops the database at teardown (unless MTH_KEEP_TEST_DB=1, for debugging), only after every client of it has
//     disconnected (dropScratchDatabase, F-DG1-009).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type PgModule from "pg";
import type {} from "vitest";
import type { TestProject } from "vitest/node";

// Vitest loads global-setup files through a runner that cannot resolve this package's own dependencies (bare
// `import "pg"` fails there, while it works in test workers and in plain Node). Loading pg with createRequire
// relative to this file avoids that, and the migrations are applied by the REAL `mth-db migrate` CLI in a child
// process, which is also the most faithful check of REQ-S19-004 "applied to a fresh database".
const pg = createRequire(import.meta.url)("pg") as typeof PgModule;

export interface MthTestDatabase {
  readonly database: string;
  /** Superuser URL pointing at the maintenance database (for tests that create their own scratch databases). */
  readonly adminUrl: string;
  /** Runs as mth_owner in the run database. */
  readonly ownerUrl: string;
  /** Runs as mth_app in the run database (the API/worker runtime role). */
  readonly appUrl: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    mthDb: MthTestDatabase;
  }
}

/** URL for `database`, acting as `role` via the startup `options` parameter. */
export function roleUrl(adminUrl: string, database: string, role: string | null): string {
  const u = new URL(adminUrl);
  u.pathname = `/${database}`;
  if (role) u.searchParams.set("options", `-c role=${role}`);
  else u.searchParams.delete("options");
  return u.toString();
}

export async function ensureRoles(admin: PgModule.Client): Promise<void> {
  for (const role of ["mth_owner", "mth_app"]) {
    const { rowCount } = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
    if (rowCount === 0) {
      try {
        await admin.query(`CREATE ROLE ${role} NOLOGIN`);
      } catch (e) {
        // A parallel run may have created it between the check and the CREATE.
        if ((e as { code?: string }).code !== "42710") throw e;
      }
    }
  }
}

/** Creates an empty database owned by mth_owner. */
export async function createScratchDatabase(adminUrl: string, prefix: string): Promise<string> {
  const name = `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await ensureRoles(admin);
    await admin.query(`CREATE DATABASE ${name} OWNER mth_owner`);
  } finally {
    await admin.end();
  }
  return name;
}

/**
 * Thrown when a scratch database still has client connections after the grace period: a test left a pool or client
 * open. The database is NOT force-dropped then, because terminating a live client is exactly what surfaces as an
 * unhandled FATAL 57P01 "terminating connection due to administrator command" (F-DG1-009). The leak is named instead.
 */
export class ScratchDatabaseInUse extends Error {}

/** Lists the other backends connected to `database` (application name and state), excluding this session. */
async function otherBackends(admin: PgModule.Client, database: string): Promise<string[]> {
  const { rows } = await admin.query<{ application_name: string; state: string | null }>(
    "SELECT application_name, state FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
    [database],
  );
  return rows.map((r) => `${r.application_name || "?"} (${r.state ?? "?"})`);
}

/**
 * Drops a scratch database only once NO client is connected to it any more (F-DG1-009, generalizing F-DG1-110).
 *
 * node-postgres' `pool.end()` / `db.destroy()` resolve as soon as the pool has *asked* its clients to end, before the
 * server has processed their Terminate messages, so their backends can still exist for a moment. A `DROP DATABASE ...
 * WITH (FORCE)` in that window terminates them and the server sends FATAL 57P01 to a client that may still carry the
 * pool's idle listener, which re-emits it as a pool `error` event - an uncaught exception when the pool has no
 * listener. So this waits (bounded, polling pg_stat_activity) until the closing backends have exited, and only then
 * drops. `WITH (FORCE)` remains only as a guard against a connection racing in between; it then has nobody to
 * terminate. A connection that is still there after `timeoutMs` is a leak: it fails with ScratchDatabaseInUse naming
 * it, rather than being terminated into an unhandled error somewhere else.
 */
export async function dropScratchDatabase(
  adminUrl: string,
  name: string,
  options: { readonly timeoutMs?: number } = {},
): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`refusing to drop an unexpected database name: ${name}`);
  const admin = new pg.Client({ connectionString: adminUrl, application_name: "mth-test-drop" });
  await admin.connect();
  try {
    const until = Date.now() + (options.timeoutMs ?? 10_000);
    for (;;) {
      const open = await otherBackends(admin, name);
      if (open.length === 0) break;
      if (Date.now() > until)
        throw new ScratchDatabaseInUse(
          `test teardown: ${open.length} connection(s) to ${name} are still open, so it is not dropped ` +
            `(a pool or client was not ended): ${open.join(", ")}`,
        );
      await new Promise((r) => setTimeout(r, 25));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const adminUrl = process.env["TEST_DATABASE_ADMIN_URL"];
  if (!adminUrl) {
    throw new Error(
      "BLOCKED: no database. The integration project needs TEST_DATABASE_ADMIN_URL " +
        "(superuser URL of a disposable PostgreSQL 16+ cluster, e.g. postgresql://postgres@127.0.0.1:5432/postgres).",
    );
  }
  const database = await createScratchDatabase(adminUrl, "mth_test");
  const ownerUrl = roleUrl(adminUrl, database, "mth_owner");
  const appUrl = roleUrl(adminUrl, database, "mth_app");
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const run = spawnSync(process.execPath, ["--conditions=@mth/source", cli, "migrate"], {
    env: { ...process.env, NODE_ENV: "test", DATABASE_OWNER_URL: ownerUrl },
    encoding: "utf8",
  });
  if (run.status !== 0) {
    await dropScratchDatabase(adminUrl, database);
    throw new Error(
      `mth-db migrate failed on the fresh test database (exit ${run.status}):\n${run.stdout}${run.stderr}`,
    );
  }
  const applied = run.stdout.split("\n").filter((l) => l.startsWith("mth-db migrate: applying "));
  const version = await (async () => {
    const c = new pg.Client({ connectionString: adminUrl });
    await c.connect();
    try {
      return (await c.query<{ server_version: string }>("SHOW server_version")).rows[0]?.server_version ?? "unknown";
    } finally {
      await c.end();
    }
  })();
  console.log(
    `[integration] PostgreSQL ${version}; database ${database}; applied ${applied.length} migrations to a fresh database`,
  );

  project.provide("mthDb", { database, adminUrl, ownerUrl, appUrl });
  process.env["TEST_DATABASE_URL"] = appUrl;
  process.env["TEST_DATABASE_OWNER_URL"] = ownerUrl;

  return async () => {
    if (process.env["MTH_KEEP_TEST_DB"] === "1") {
      console.log(`[integration] keeping ${database} (MTH_KEEP_TEST_DB=1)`);
      return;
    }
    await dropScratchDatabase(adminUrl, database);
  };
}
