// Commit-time authorisation helper for P4 slice I tests (T-DG4-BE-A; the BE18A technique of portfolio/be18a.ts): the
// request is sent while the caller's session row is locked, so it stops in the identity hook's touchSession AFTER its
// grants were loaded and BEFORE the handler runs; `between` then changes the world (revokes a grant, ends the session)
// and the lock is released. A handler that authorised on the request-start snapshot would commit; one that
// re-authorises inside its transaction answers 403 (grant revoked) or 401 (session ended). All data is SYNTHETIC.
import type pg from "pg";
import { expect } from "vitest";
import type { Res, TestApi } from "../../support/harness.ts";

export async function afterIdentity(
  api: TestApi,
  userId: string,
  send: () => Promise<Res>,
  /** Runs while the request waits; `locker` holds the session row lock (use it to change the session row itself). */
  between: (locker: pg.PoolClient) => Promise<void>,
): Promise<Res> {
  await api.owner.query(`update session set last_seen_at = now() - interval '5 minutes' where user_id = $1`, [userId]);
  const locker = await api.owner.connect();
  try {
    await locker.query("begin");
    const lockerPid = (await locker.query("select pg_backend_pid() as pid")).rows[0].pid as number;
    await locker.query("select id from session where user_id = $1 for update", [userId]);
    const pending = send();
    let waited = false;
    for (let i = 0; i < 200 && !waited; i++) {
      const r = await api.owner.query(
        "select count(*)::int as n from pg_locks where not granted and $1 = any (pg_blocking_pids(pid))",
        [lockerPid],
      );
      waited = r.rows[0].n > 0;
      if (!waited) await new Promise((r2) => setTimeout(r2, 25));
    }
    expect(waited, "the request reached touchSession and waits on the session row").toBe(true);
    await between(locker);
    await locker.query("commit");
    return await pending;
  } finally {
    locker.release();
  }
}

/** Revokes every live grant of `userId` (owner role; test-only). */
export async function revokeAll(api: TestApi, grantorId: string, userId: string): Promise<void> {
  await api.owner.query(
    `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic commit-time test' where user_id = $2 and revoked_at is null`,
    [grantorId, userId],
  );
}

/** Ends every session of `userId` on the given connection (the one holding the session row lock; test-only). */
export async function endSessions(client: pg.PoolClient, userId: string): Promise<void> {
  await client.query(`update session set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
}
