// The demo reset: drop and re-create the demo database, migrate, and seed it again (ADR-0050 §6, §10; REQ-S18-001;
// T-DG5-BE-S). Used by `mth-db reset-demo` and by the worker's `demo.reset` job (the in-app reset).
//
//   0. refuse (exit 3, nothing changed) unless MTH_ENV=demo and MTH_DEMO_ADMIN_DATABASE_URL is set;
//   1. take the SESSION advisory lock 730271 (key "demo") on the maintenance database `postgres`, held to the end;
//   2. refuse unless the target database's marker is `demo` (a production or unmarked database is never dropped);
//   3. DROP DATABASE … WITH (FORCE), CREATE DATABASE … OWNER mth_owner ENCODING 'UTF8' (same collation and ctype as
//      before, from template0);
//   4. migrate, then the seed transaction with run_kind = 'reset' (seed.ts).
// Re-creating the database IS the reset: the append-only protections of 0003/0010 are never disabled and nothing is
// truncated in place (p5-work-split §J.8 item 3). The previous demo database's synthetic data and audit trail go with
// it, by design; the reset is recorded in the new database's run 1. Two resets give identical counts and checksums.
import pg from "pg";
import { DB_ROLES } from "../constants.ts";
import { migrate } from "../migrate.ts";
import { DemoRefused, RESET_DEMO_REFUSALS, resetDemoConfigRefusal } from "./guard.ts";
import { maintenanceUrl, seedDemo, withDemoLock, type DemoRunSummary, type DemoSeedOptions } from "./seed.ts";

const DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export interface DemoResetOptions {
  readonly mthEnv: string;
  /** MTH_DEMO_ADMIN_DATABASE_URL: a role with CREATEDB that may drop and re-create the demo database. */
  readonly adminUrl: string | null;
  /** The demo database, as its owner (mth_owner): migrations and the seed run through it. */
  readonly ownerUrl: string;
  readonly requestedVia: "cli" | "api";
  readonly requestedBy: string | null;
  readonly source?: "cli" | "worker";
  readonly requestId?: string | null;
  readonly modules?: DemoSeedOptions["modules"];
  readonly conditions?: DemoSeedOptions["conditions"];
  readonly log?: (line: string) => void;
}

/** The database name of a postgres URL (validated: it is interpolated as an identifier). */
export function databaseNameOf(url: string): string {
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!DATABASE_NAME.test(name)) throw new Error("demo reset: the target database name is not a plain identifier");
  return name;
}

/** `url` pointing at `database` (same server, credentials and options). */
export function urlForDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

async function targetIsDemo(adminUrl: string, database: string): Promise<boolean> {
  const client = new pg.Client({
    connectionString: urlForDatabase(adminUrl, database),
    application_name: "mth-db reset-demo",
  });
  client.on("error", () => undefined);
  try {
    await client.connect();
  } catch {
    return false; // no such database (or not reachable as the admin role): never treat it as a demo database
  }
  try {
    const r = await client.query<{ kind: string }>(
      "SELECT environment_kind AS kind FROM deployment_environment WHERE environment_kind = 'demo'",
    );
    return r.rowCount === 1;
  } catch {
    return false; // not migrated (no marker table): not a demo database
  } finally {
    await client.end();
  }
}

/** Resets the demo database (ADR-0050 §6). Throws DemoRefused (exit 3) when refused; nothing changes then. */
export async function resetDemo(options: DemoResetOptions): Promise<DemoRunSummary> {
  const log = options.log ?? (() => undefined);
  const refusal = resetDemoConfigRefusal(options.mthEnv, options.adminUrl);
  if (refusal !== null) throw new DemoRefused("reset-demo", refusal);
  const adminUrl = options.adminUrl!;
  const database = databaseNameOf(options.ownerUrl);
  if (database === "postgres" || database.startsWith("template"))
    throw new DemoRefused("reset-demo", RESET_DEMO_REFUSALS.notDemoDatabase);

  return withDemoLock(adminUrl, async () => {
    if (!(await targetIsDemo(adminUrl, database)))
      throw new DemoRefused("reset-demo", RESET_DEMO_REFUSALS.notDemoDatabase);
    const admin = new pg.Client({ connectionString: maintenanceUrl(adminUrl), application_name: "mth-db reset-demo" });
    admin.on("error", () => undefined);
    await admin.connect();
    try {
      const locale = await admin.query<{ datcollate: string; datctype: string }>(
        "SELECT datcollate, datctype FROM pg_database WHERE datname = $1",
        [database],
      );
      const { datcollate, datctype } = locale.rows[0]!;
      const ident = pg.escapeIdentifier(database);
      log(`dropping and re-creating the demo database ${database}`);
      await admin.query(`DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`);
      await admin.query(
        `CREATE DATABASE ${ident} OWNER ${pg.escapeIdentifier(DB_ROLES.owner)} ENCODING 'UTF8' ` +
          `LC_COLLATE ${pg.escapeLiteral(datcollate)} LC_CTYPE ${pg.escapeLiteral(datctype)} TEMPLATE template0`,
      );
    } finally {
      await admin.end();
    }
    const applied = await migrate(options.ownerUrl, { log: (l) => log(`migrate: ${l}`) });
    log(`applied ${applied.length} migration(s)`);
    return seedDemo(options.ownerUrl, {
      mthEnv: options.mthEnv,
      runKind: "reset",
      requestedVia: options.requestedVia,
      requestedBy: options.requestedBy,
      lockHeld: true,
      source: options.source ?? "cli",
      requestId: options.requestId ?? null,
      ...(options.modules ? { modules: options.modules } : {}),
      ...(options.conditions ? { conditions: options.conditions } : {}),
    });
  });
}
