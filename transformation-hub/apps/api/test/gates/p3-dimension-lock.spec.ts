import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, Personas } from './gate-test-kit';

/**
 * DOM-P3-14 (P3 domain review, code review — this test was written first and failed before the fix): status-dimension
 * recomputes of a project are serialized. `recomputeDimensions` reads the registers, computes and writes the dimension rows
 * and their history; two unserialized recomputes (HTTP command + worker job) could store a stale state last and drop the
 * second writer's history rows silently. Every recompute now takes the transaction-scoped advisory lock
 * `hub_dimensions:<projectId>` before it reads anything.
 *
 * The test holds that lock in another transaction ("a recompute in progress") and shows that an HTTP recompute WAITS for it
 * (instead of reading and writing concurrently), then completes on fresh state once the lock is released.
 */
let projectId: string;
let p: Personas;

async function waitingLockType(): Promise<string | null> {
  for (let i = 0; i < 100; i++) {
    const r = await owner().query<{ locktype: string }>(
      `select l.locktype from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where not l.granted and a.datname = current_database() and l.pid <> pg_backend_pid() limit 1`,
    );
    if (r.rows[0]) return r.rows[0].locktype;
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P3FIX-DIMLOCK'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P3-14 — status-dimension recomputes of a project are serialized [REQ-LCY-006, AT-06]', () => {
  it('a recompute waits for a recompute in progress (advisory lock hub_dimensions:<projectId>), then succeeds', async () => {
    const held: PoolClient = await owner().connect();
    let settled = false;
    let res: { status: number } | null = null;
    try {
      await held.query('begin');
      await held.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`hub_dimensions:${projectId}`]);
      const req = p.pm.post(`/api/v1/projects/${projectId}/status-dimensions/recompute`, {}).then((r) => {
        settled = true;
        res = r;
        return r;
      });
      const waited = await waitingLockType();
      expect(waited, `the recompute did not wait (settled early: ${settled})`).toBe('advisory');
      expect(settled).toBe(false);
      await held.query('commit');
      await req;
    } finally {
      await held.query('rollback').catch(() => undefined);
      held.release();
    }
    expect(res!.status).toBe(201);
  });
});
