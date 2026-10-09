// Job schedules of the scheduled-job kit (ADR-0025 §3; REQ-S16-005 "view-jobs:ADM"; T-DG4-BE-A) against a real
// PostgreSQL:
//  - the three seeded schedules are listed for ADM_TECH (job.read); AUD, TO and others get 403;
//  - PATCH (job.configure): If-Match 428/409; 422 job.cron_invalid / job.timezone_unknown with the ADR texts; one audit
//    event and the outbox event job_schedule.updated in the same transaction (the worker re-registers from it);
//  - commit-time authorisation: job.configure revoked while the request waits -> 403 (audited); nothing written.
// A schedule only starts a job; no job decides a business approval. All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const J = "/api/v1/admin/job-schedules";
const versionOf = async (code: string) =>
  (await api.db.selectFrom("job_schedule").select("version").where("code", "=", code).executeTakeFirstOrThrow())
    .version;

describe("job schedules (REQ-S16-005)", () => {
  it("ADM_TECH lists the seeded schedules (Asia/Riyadh); everyone else is 403", async () => {
    const res = await call<Body>(api.app, "GET", J, { session: admin });
    expect(res.status).toBe(200);
    const byCode = new Map(res.body.items.map((j: { code: string }) => [j.code, j]));
    expect(byCode.get("approval.escalation_scan")).toMatchObject({ cron: "*/15 * * * *", timezone: "Asia/Riyadh" });
    expect(byCode.get("delegation.expiry_sweep")).toMatchObject({ queueName: "delegation.expiry_sweep" });
    expect(byCode.get("kpi.reporting_period_open")).toMatchObject({ cron: "5 0 * * *", ownerModule: "kpi" });
    const page = await call<Body>(api.app, "GET", `${J}?limit=1`, { session: admin });
    expect([page.body.items.length, typeof page.body.nextCursor]).toEqual([1, "string"]);
    for (const subject of [w.auditor.subject, w.office.subject, w.nobody.subject, w.officeB.subject]) {
      const s = await signIn(api.app, subject);
      expect((await call<Body>(api.app, "GET", J, { session: s })).status, subject).toBe(403);
    }
  });

  it("PATCH: If-Match, ADR refusals, one audit event and one job_schedule.updated outbox event", async () => {
    const code = "kpi.reporting_period_open";
    const U = `${J}/${code}`;
    const v = await versionOf(code);
    expect((await call<Body>(api.app, "PATCH", U, { session: admin, body: { enabled: false } })).status).toBe(428);
    expect(
      (await call<Body>(api.app, "PATCH", U, { session: admin, headers: ifm(v + 5), body: { enabled: false } })).status,
    ).toBe(409);
    for (const cron of ["61 * * * *", "* * * * * *", "a b c d e", "5-1 * * * *", "*/0 * * * *"]) {
      const bad = await call<Body>(api.app, "PATCH", U, { session: admin, headers: ifm(v), body: { cron } });
      expect([bad.status, bad.body.code, bad.body.detail], cron).toEqual([
        422,
        "job.cron_invalid",
        "The schedule must be a cron expression with five fields.",
      ]);
    }
    const tz = await call<Body>(api.app, "PATCH", U, {
      session: admin,
      headers: ifm(v),
      body: { timezone: "Mars/Olympus" },
    });
    expect([tz.status, tz.body.code, tz.body.detail]).toEqual([
      422,
      "job.timezone_unknown",
      "The time zone Mars/Olympus is not a known time zone.",
    ]);
    const auditor = await signIn(api.app, w.auditor.subject);
    expect(
      (await call<Body>(api.app, "PATCH", U, { session: auditor, headers: ifm(v), body: { enabled: false } })).status,
    ).toBe(403);
    expect(
      (
        await call<Body>(api.app, "PATCH", `${J}/no_such.job`, {
          session: admin,
          headers: ifm(1),
          body: { enabled: false },
        })
      ).status,
    ).toBe(404);
    const ok = await call<Body>(api.app, "PATCH", U, {
      session: admin,
      headers: ifm(v),
      body: { enabled: false, cron: "10 1 * * 0-4", timezone: "Asia/Riyadh" },
    });
    expect([ok.status, ok.body.enabled, ok.body.cron, ok.body.version, ok.headers.etag]).toEqual([
      200,
      false,
      "10 1 * * 0-4",
      v + 1,
      `"${v + 1}"`,
    ]);
    const row = await api.db.selectFrom("job_schedule").select("id").where("code", "=", code).executeTakeFirstOrThrow();
    const audit = (await auditOf(api.db, row.id)).filter((a) => a.action === "job_schedule.update");
    expect(audit.map((a) => [a.actor_user_id, a.prior_version, a.new_version])).toEqual([[w.admin.id, v, v + 1]]);
    expect(Object.keys(audit[0]!.changes as object).sort()).toEqual(["cron", "enabled"]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "payload", "idempotency_key", "organization_id"])
      .where("aggregate_id", "=", row.id)
      .execute();
    expect(events).toEqual([
      {
        event_type: "job_schedule.updated",
        organization_id: w.orgA.id,
        idempotency_key: `job_schedule.updated:${row.id}:${v + 1}`,
        payload: expect.objectContaining({ code, enabled: false, cron: "10 1 * * 0-4", version: v + 1 }),
      },
    ]);
    // Restore (another audited change).
    const back = await call<Body>(api.app, "PATCH", U, {
      session: admin,
      headers: ifm(v + 1),
      body: { enabled: true, cron: "5 0 * * *" },
    });
    expect(back.status).toBe(200);
  });

  it("commit-time authorisation: job.configure revoked while the request waits -> 403 (audited); nothing written", async () => {
    const user = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, user.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, user.subject);
    const code = "delegation.expiry_sweep";
    const v = await versionOf(code);
    const res = await afterIdentity(
      api,
      user.id,
      () =>
        call<Body>(api.app, "PATCH", `${J}/${code}`, {
          session: s,
          headers: ifm(v),
          body: { enabled: false },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, user.id),
    );
    expect(res.status).toBe(403);
    expect(await versionOf(code)).toBe(v);
    const denied = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("actor_user_id", "=", user.id)
      .where("action", "=", "authorization.denied")
      .execute();
    expect(denied).toHaveLength(1);
  });
});
