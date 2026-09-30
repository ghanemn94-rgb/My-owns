// Vitest global setup for the `integration` project (ADR-0012). One disposable PostgreSQL database per run.
//
//  1. Connects with TEST_DATABASE_ADMIN_URL (a superuser of a disposable/CI cluster). Missing -> the whole project
//     FAILS with "BLOCKED: no database" (never a silent skip; CLAUDE.md).
//  2. Creates the roles mth_owner and mth_app if they are missing (NOLOGIN: tests reach them through the admin
//     connection with the `role` startup parameter, so no test password is created or stored anywhere).
//  3. Creates mth_test_<runId> OWNED BY mth_owner and applies ALL migrations to it as mth_owner (this doubles as the
//     REQ-S19-004 "applied to a fresh database" check).
//  4. Provides the URLs to test files (inject("mthDb")) and as TEST_DATABASE_URL / TEST_DATABASE_OWNER_URL.
//  5. Drops the database at teardown (unless MTH_KEEP_TEST_DB=1, for debugging).
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

export async function dropScratchDatabase(adminUrl: string, name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
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
