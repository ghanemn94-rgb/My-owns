// T-DG2-BE17 (F-DG2-411, defence in depth): every pool from createPool bounds the wait for a connection
// (connectionTimeoutMillis) and the time a session may sit idle inside a transaction
// (idle_in_transaction_session_timeout), against the run's disposable PostgreSQL. It also pins node-postgres' checkout
// timeout messages that isPoolCheckoutTimeout matches (pg 8.16.3 / pg-pool 3.14.0). Synthetic data only.
import { sql } from "kysely";
import { afterAll, describe, expect, it } from "vitest";
import {
  createDb,
  createPool,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  isPoolCheckoutTimeout,
} from "../../src/pool.ts";
import { testDatabase } from "../helpers.ts";

const { appUrl } = testDatabase();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const closers: Array<() => Promise<void>> = [];
afterAll(async () => {
  // Each close is capped: a pool whose checkout never ends (the defect this file tests) must not hang the run.
  for (const c of closers.reverse()) await Promise.race([c(), sleep(3_000)]);
});

describe("createPool session settings", () => {
  it("every session runs with the documented statement, idle-in-transaction and UTC settings", async () => {
    const pool = createPool(appUrl, { max: 1, applicationName: "pool-bounds-defaults" });
    closers.push(() => pool.end());
    const r = await pool.query<{ s: string; i: string; tz: string }>(
      "select current_setting('statement_timeout') s, current_setting('idle_in_transaction_session_timeout') i, current_setting('TimeZone') tz",
    );
    expect(r.rows[0]).toEqual({ s: "30s", i: `${DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS / 1000}s`, tz: "UTC" });
    expect((pool as unknown as { options: { connectionTimeoutMillis: number } }).options.connectionTimeoutMillis).toBe(
      DEFAULT_CONNECTION_TIMEOUT_MS,
    );
  });

  it("keeps a role (or other) option given in the URL next to the pool's own session options", async () => {
    const url = new URL(appUrl);
    url.searchParams.set("options", "-c search_path=public");
    const pool = createPool(url.toString(), { max: 1, applicationName: "pool-bounds-url-options" });
    closers.push(() => pool.end());
    const r = await pool.query<{ p: string; i: string }>(
      "select current_setting('search_path') p, current_setting('idle_in_transaction_session_timeout') i",
    );
    expect(r.rows[0]).toEqual({ p: "public", i: "30s" });
  });
});

describe("bounded checkout (connectionTimeoutMillis)", () => {
  it("a checkout from an exhausted pool fails after the timeout (never hangs) and is recognised", async () => {
    const pool = createPool(appUrl, { max: 1, connectionTimeoutMs: 300, applicationName: "pool-bounds-checkout" });
    closers.push(() => pool.end());
    const held = await pool.connect();
    const t0 = Date.now();
    // Capped at 5 s: without a bound the checkout would wait forever (status "hang").
    const err = await Promise.race([
      pool.connect().then(
        (c) => {
          c.release();
          return null;
        },
        (e: unknown) => e,
      ),
      sleep(5_000).then(() => "hang"),
    ]);
    const waited = Date.now() - t0;
    held.release();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("timeout exceeded when trying to connect");
    expect(isPoolCheckoutTimeout(err)).toBe(true);
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(2_000);
    // The pool recovers as soon as a connection is free again.
    const c = await pool.connect();
    c.release();
  });

  it("through Kysely the same error reaches the caller", async () => {
    const pool = createPool(appUrl, { max: 1, connectionTimeoutMs: 300, applicationName: "pool-bounds-kysely" });
    const db = createDb(pool);
    closers.push(() => db.destroy());
    await sql`select 1`.execute(db); // Kysely adopts the pool
    const held = await pool.connect();
    const err = await Promise.race([
      sql`select 1`.execute(db).then(
        () => null,
        (e: unknown) => e,
      ),
      sleep(5_000).then(() => "hang"),
    ]);
    held.release();
    expect(isPoolCheckoutTimeout(err)).toBe(true);
  });

  it("other errors are not mistaken for a checkout timeout", () => {
    expect(isPoolCheckoutTimeout(new Error("read ECONNRESET"))).toBe(false);
    expect(isPoolCheckoutTimeout(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isPoolCheckoutTimeout("timeout exceeded when trying to connect")).toBe(false);
    expect(isPoolCheckoutTimeout(null)).toBe(false);
  });
});

describe("bounded idle-in-transaction time (idle_in_transaction_session_timeout)", () => {
  it("PostgreSQL ends a transaction left idle past the limit, releasing its row lock; the pool recovers", async () => {
    const pool = createPool(appUrl, { max: 2, idleInTransactionTimeoutMs: 400, applicationName: "pool-bounds-idle" });
    const db = createDb(pool);
    closers.push(() => db.destroy());
    const stalled = await pool.connect();
    // No listener of our own: createPool's per-client listener must keep the server-side termination (an 'error'
    // event on a checked-out client) from becoming an uncaught exception.
    await stalled.query("BEGIN");
    // A lock only this transaction holds (no table data touched): an advisory transaction lock.
    await stalled.query("select pg_advisory_xact_lock(424242)");
    await sleep(1_200);
    const after = await stalled.query("select 1").then(
      () => null,
      (e: unknown) => e as { code?: string; message: string },
    );
    stalled.release(true);
    // 25P03 idle_in_transaction_session_timeout (or the connection already closed by it).
    expect(after).not.toBeNull();
    expect(after?.code === "25P03" || /terminat|not queryable|closed/i.test(after?.message ?? "")).toBe(true);
    // The lock is gone: another session takes it at once.
    const other = await pool.connect();
    try {
      const r = await other.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(424242) ok");
      expect(r.rows[0]?.ok).toBe(true);
    } finally {
      other.release();
    }
  });

  it("a transaction that keeps running statements is not affected", async () => {
    const pool = createPool(appUrl, { max: 1, idleInTransactionTimeoutMs: 400, applicationName: "pool-bounds-busy" });
    const db = createDb(pool);
    closers.push(() => db.destroy());
    const n = await db.transaction().execute(async (tx) => {
      let count = 0;
      for (let i = 0; i < 5; i++) {
        await sql`select pg_sleep(0.2)`.execute(tx); // active, not idle: 1 s in total
        count++;
      }
      return count;
    });
    expect(n).toBe(5);
  });
});
