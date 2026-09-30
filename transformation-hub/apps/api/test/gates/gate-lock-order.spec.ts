import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, gateByKey, ownerFor, addEvidence, evidenceAdderFor, runWorker, Personas } from './gate-test-kit';

/**
 * One writer of a project's gate state at a time. A gate command updates its own cycle row and then refreshes the cached
 * evaluation of every gate of the project, in gate order; the worker (evidence-conflict job) refreshes the same rows. Before
 * the per-project gate lock the two could lock the same gate_assessment rows in opposite orders: PostgreSQL "deadlock
 * detected" and a 409 `db.serialization_failure` (seen in the full Playwright run). Now every gate writer takes the
 * transaction-scoped advisory lock `hub_gates:<projectId>` before it reads the gate state and before its first write.
 *
 * The first test holds that lock in a separate transaction that behaves like a refresh in progress (it already updated one
 * gate row and next updates the row the command writes). Without the lock in the command this interleaving is the
 * reported deadlock; with it the command waits, holding no gate row, and then succeeds on fresh state.
 */
let projectId: string;
let p: Personas;

const lockKey = (pid: string) => `hub_gates:${pid}`;

async function currentCycleId(gateId: string): Promise<string> {
  const r = await owner().query<{ id: string }>('select id from gate_assessment where project_id = $1 and gate_id = $2 and is_current', [projectId, gateId]);
  return r.rows[0]!.id;
}

/** The lock type another backend of this database waits for, once one waits (polls up to ~10 s); null if none waits. */
async function waitingLockType(): Promise<string | null> {
  for (let i = 0; i < 200; i++) {
    const r = await owner().query<{ locktype: string }>(
      `select l.locktype from pg_locks l join pg_stat_activity a on a.pid = l.pid
        where not l.granted and a.datname = current_database() and l.pid <> pg_backend_pid() limit 1`,
    );
    if (r.rows[0]) return r.rows[0].locktype;
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

async function holdGateLock(): Promise<PoolClient> {
  const c = await owner().connect();
  await c.query('begin');
  await c.query(`set local lock_timeout = '10s'`);
  await c.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [lockKey(projectId)]);
  return c;
}

beforeAll(async () => {
  ({ projectId, p } = await setupProject('GATES-LOCK-ORDER'));
});

afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('gate writers serialize per project (deadlock between a gate command and the evaluation refresh)', () => {
  it('a gate command waits for a refresh in progress instead of deadlocking with it, then succeeds on fresh state', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g0.assessment.status).toBe('not_started');
    const g0Cycle = await currentCycleId(g0.id);
    const g1Cycle = await currentCycleId(g1.id);
    // G1's cached evaluation is stale, so the command's refresh must write G1's row after writing G0's.
    await owner().query(`update gate_assessment set evaluation = '{}'::jsonb where id = $1`, [g1Cycle]);

    // "Refresh in progress": holds the project gate lock and has already written G1's row.
    const refresh = await holdGateLock();
    try {
      await refresh.query('update gate_assessment set updated_at = now() where id = $1', [g1Cycle]);

      const command = (async () => ownerFor(p, g0.ownerRole).post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/start`, { expectedVersion: g0.assessment.version }))();
      // The command is blocked. Without the project gate lock it has written G0's row and waits for G1's row.
      const waitedFor = await waitingLockType();
      expect(waitedFor).not.toBeNull();

      // The refresh goes on to the row the command writes. Without the lock in the command: "deadlock detected" here or a
      // 409 for the command. With it: no wait, no deadlock.
      await refresh.query('update gate_assessment set updated_at = now() where id = $1', [g0Cycle]);
      await refresh.query('commit');

      const r = await command;
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.status).toBe('in_assessment');
      // It waited for the project gate lock, before touching any gate row.
      expect(waitedFor).toBe('advisory');
    } finally {
      await refresh.query('rollback').catch(() => undefined);
      refresh.release();
    }
    // The command's refresh ran after the wait and rewrote G1's stale evaluation cache.
    const ev = await owner().query<{ evaluation: Record<string, unknown> }>('select evaluation from gate_assessment where id = $1', [g1Cycle]);
    expect(ev.rows[0]!.evaluation).toHaveProperty('ready');
  });

  it('the worker evidence-conflict job takes the same project gate lock', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const c = g0.criteria[0]!;
    // Linking evidence emits `evidence.changed`, which the worker handles with the gates evidence-conflict job.
    await addEvidence(await evidenceAdderFor(p, projectId, c), projectId, c.id);

    const held = await holdGateLock();
    try {
      const worker = runWorker();
      expect(await waitingLockType()).toBe('advisory');
      await held.query('commit');
      await worker;
    } finally {
      await held.query('rollback').catch(() => undefined);
      held.release();
    }
  });
});
