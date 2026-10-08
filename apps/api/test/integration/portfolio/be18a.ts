// BE18A test helper (T-DG3-BE-E; the technique of BE-D's prioritization.test.ts): sends a mutation while the caller's
// session row is locked, so the request stops in the identity hook's touchSession AFTER its grants were loaded and
// BEFORE the handler runs; the caller's grants are then revoked and the lock released. A handler that authorised on the
// request-start snapshot would commit; one that re-authorises inside its transaction (openWrite atCommit) answers 403.
// All data is SYNTHETIC.
import { expect } from "vitest";
import { call, createUser, grant, signIn, type Res, type TestApi, type World } from "../../support/harness.ts";

export async function revokedAfterIdentity(
  api: TestApi,
  w: World,
  transformationId: string,
  role: string,
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  const user = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, user.id, role, { type: "transformation", id: transformationId }, w.orgA.id);
  const session = await signIn(api.app, user.subject);
  await api.owner.query(`update session set last_seen_at = now() - interval '5 minutes' where user_id = $1`, [user.id]);
  const locker = await api.owner.connect();
  try {
    await locker.query("begin");
    const lockerPid = (await locker.query("select pg_backend_pid() as pid")).rows[0].pid as number;
    await locker.query("select id from session where user_id = $1 for update", [user.id]);
    const pending = call(api.app, method, url, { session, body, headers, contract: false });
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
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-E BE18A' where user_id = $2 and revoked_at is null`,
      [w.grantor.id, user.id],
    );
    await locker.query("commit");
    return await pending;
  } finally {
    locker.release();
  }
}
