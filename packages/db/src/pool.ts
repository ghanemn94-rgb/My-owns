// Pool and Kysely factory (ADR-0003). Every connection runs with TimeZone=UTC; the business time zone is applied
// only when deriving business dates or presenting (ADR-0003 "Time").
import { Kysely, PostgresDialect, type Transaction } from "kysely";
import pg from "pg";
import type { Database } from "./schema.ts";

// Business dates (`date`, type OID 1082) stay "YYYY-MM-DD" strings (ADR-0003 "Time", ADR-0016). node-postgres'
// default parser builds a JS Date at LOCAL midnight, which shifts a business date by a day whenever the process time
// zone differs from UTC. Registered once per process, for every pool (T-DG2-ARCH-01).
const PG_DATE_OID = 1082;
pg.types.setTypeParser(PG_DATE_OID, (value: string) => value);

export type Db = Kysely<Database>;
export type Tx = Transaction<Database>;
/** Either a plain handle or a transaction; read helpers accept both. */
export type DbOrTx = Kysely<Database> | Transaction<Database>;

export interface PoolOptions {
  readonly max?: number;
  readonly applicationName?: string;
  readonly statementTimeoutMs?: number;
}

/**
 * node-postgres lets an `options` query parameter in the URL silently REPLACE an explicit `options` setting.
 * This merges both (URL options first, e.g. `-c role=...`, then ours) and strips the parameter from the URL.
 */
export function connectionWithSessionOptions(
  connectionString: string,
  extra: string,
): { connectionString: string; options: string } {
  const url = new URL(connectionString);
  const fromUrl = url.searchParams.get("options");
  url.searchParams.delete("options");
  return {
    connectionString: url.toString(),
    options: [fromUrl, extra].filter((s) => s !== null && s !== "").join(" "),
  };
}

export function createPool(connectionString: string, options: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    // UTC sessions; a bounded statement timeout so a stuck query cannot hold a request forever.
    ...connectionWithSessionOptions(
      connectionString,
      `-c TimeZone=UTC -c statement_timeout=${options.statementTimeoutMs ?? 30_000}`,
    ),
    max: options.max ?? 10,
    application_name: options.applicationName ?? "mth",
  });
  // An idle client error must not crash the process; the next checkout gets a fresh client.
  pool.on("error", () => undefined);
  return pool;
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Runs `fn` in one transaction; commits on success, rolls back on any thrown error. */
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}
