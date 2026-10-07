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
  /** See DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS. */
  readonly idleInTransactionTimeoutMs?: number;
  /** See DEFAULT_CONNECTION_TIMEOUT_MS. */
  readonly connectionTimeoutMs?: number;
}

/** Longest single statement (server-side `statement_timeout`). */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;
/**
 * T-DG2-BE17 (F-DG2-411, defence in depth): server-side `idle_in_transaction_session_timeout` on every pooled session.
 * A session that sits inside an open transaction without running a statement for this long is terminated by
 * PostgreSQL (SQLSTATE 25P03), which rolls the transaction back and releases its row locks; node-postgres then drops the
 * client from the pool. No application transaction waits on anything but the database (no client I/O, no remote
 * call: T-DG2-BE17 sweep), so its idle gaps are microseconds; 30 s (the statement timeout) is far above any of them and
 * still bounds a lock holder if a future handler regresses. `statement_timeout` does NOT cover idle time.
 */
export const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;
/**
 * T-DG2-BE17 (F-DG2-411, defence in depth): node-postgres `connectionTimeoutMillis`, the longest a caller waits for a
 * pooled connection (checkout from a full pool, or a new connection to the server). pg's default 0 waits forever, so an
 * exhausted pool hung every request. On expiry the caller gets an error (`isPoolCheckoutTimeout`): the API answers
 * 503 `unavailable`, `/readyz` its existing 503 `not_ready`, and the worker's job fails and is retried with backoff.
 * 10 s is far above a healthy checkout (sub-millisecond, or a few ms for a new connection) and below Node's
 * requestTimeout.
 */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000;

/** node-postgres' messages for a checkout that hit `connectionTimeoutMillis` (pg-pool 3.14.0, pinned with pg 8.16.3). */
const CHECKOUT_TIMEOUT_MESSAGES: ReadonlySet<string> = new Set([
  "timeout exceeded when trying to connect", // waiting for a free pooled client
  "Connection terminated due to connection timeout", // a new client did not finish connecting in time
]);

/**
 * True when `err` is a pool checkout that hit `connectionTimeoutMillis`. node-postgres gives these errors no code, so
 * the messages are matched; packages/db/test/integration/pool-bounds.test.ts pins them against the real pg-pool.
 */
export function isPoolCheckoutTimeout(err: unknown): boolean {
  return err instanceof Error && CHECKOUT_TIMEOUT_MESSAGES.has(err.message);
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
  const statementTimeout = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const idleInTransaction = options.idleInTransactionTimeoutMs ?? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS;
  const pool = new pg.Pool({
    // UTC sessions; a bounded statement timeout so a stuck query cannot hold a request forever, and a bounded
    // idle-in-transaction time so a stalled transaction cannot hold its locks and its connection forever.
    ...connectionWithSessionOptions(
      connectionString,
      `-c TimeZone=UTC -c statement_timeout=${statementTimeout} -c idle_in_transaction_session_timeout=${idleInTransaction}`,
    ),
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    application_name: options.applicationName ?? "mth",
  });
  // An idle client error must not crash the process; the next checkout gets a fresh client.
  pool.on("error", () => undefined);
  // T-DG2-BE17: nor may an error on a CHECKED-OUT client. pg-pool removes its own 'error' listener while a client is
  // checked out, and node-postgres emits 'error' when the server ends the session between statements (FATAL 25P03
  // idle_in_transaction_session_timeout, an administrator's termination) or the socket resets: with no listener that
  // is an uncaught exception. The pending query still fails with the error, the client is marked not queryable, and
  // pg-pool discards it on release.
  pool.on("connect", (client) => {
    client.on("error", () => undefined);
  });
  return pool;
}

export function createDb(pool: pg.Pool): Db {
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/** Runs `fn` in one transaction; commits on success, rolls back on any thrown error. */
export function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}
