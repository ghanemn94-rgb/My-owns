// Shared helpers for integration tests against the per-run disposable database (see global-setup.ts).
// Also usable by other packages' integration tests (apps/api, apps/worker, tests/qa).
import type pg from "pg";
import { inject } from "vitest";
import { createDb, createPool, type Db } from "../src/pool.ts";
import type { MthTestDatabase } from "./global-setup.ts";

export { createScratchDatabase, dropScratchDatabase, roleUrl, type ScratchEncoding } from "./global-setup.ts";

export function testDatabase(): MthTestDatabase {
  const db = inject("mthDb");
  if (!db) throw new Error("BLOCKED: no database (the integration global setup did not run)");
  return db;
}

export interface RoleHandles {
  readonly pool: pg.Pool;
  readonly db: Db;
  close(): Promise<void>;
}

function handles(url: string, name: string): RoleHandles {
  const pool = createPool(url, { max: 5, applicationName: name });
  const db = createDb(pool);
  return { pool, db, close: () => db.destroy() };
}

/** Connection as the runtime app role (mth_app): what the API and worker use. */
export function appRole(): RoleHandles {
  return handles(testDatabase().appUrl, "test-app");
}

/** Connection as the owner role (mth_owner): migrations and bootstrap only. */
export function ownerRole(): RoleHandles {
  return handles(testDatabase().ownerUrl, "test-owner");
}

/** Expect a promise to reject with a PostgreSQL error; returns the error for further assertions. */
export async function pgError(p: Promise<unknown>): Promise<{ code?: string; constraint?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; constraint?: string; message: string };
  }
  throw new Error("expected a database error, but the statement succeeded");
}
