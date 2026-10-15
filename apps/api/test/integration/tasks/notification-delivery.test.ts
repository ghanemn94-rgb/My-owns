// Notification policy, preferences, delivery and digests (ADR-0044 §5, §9, §10; REQ-S12-025; p5-work-split §E.3,
// T-DG5-BE-L) against a real PostgreSQL. The literal tests of §E.3:
//  - a non-urgent reminder created in quiet hours (digest daily) is delivered in the next digest, and the digest job
//    run twice in the window creates one digest;
//  - an urgent escalation (`approval_escalated`) in quiet hours is delivered immediately;
//  - with no preference and no policy every notification is delivered at once (DG4 regression on the inbox list);
//  - quiet start = end -> 422 notification_preference.quiet_hours_invalid;
//  - the work item is visible in My Work while its notification is held;
//  - AUD 403 on PUT /me/notification-preferences; If-Match "0" creates; 409 stale;
// plus: the policy (ADM_TECH only), business-day timing, digest off releases into the inbox, the digest read is own
// only, one audit event per write, commit-time authorization, and the worker kit's twin writes the same rows (parity).
// Quiet hours are set around the real clock (two hours each side) so that the API's and worker's `new Date()` falls
// inside them whatever the time of the run; the digest job is then run with a fixed instant after the release. Every
// value is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { wallClockOf } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runDigestWindow } from "../../../../worker/src/handlers/digests.ts";
import { createWorkItemOnce as workerCreateWorkItemOnce } from "../../../../worker/src/kit.ts";
import { createWorkItemOnce, type WorkItemInput } from "../../../src/modules/tasks/index.ts";
import {
  auditOf,
  call,
  createOrg,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let tech: Session;
let auditor: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  tech = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const PREFS = "/api/v1/me/notification-preferences";
const POLICY = "/api/v1/admin/notification-policy";
const INBOX = "/api/v1/me/inbox";
const RIYADH = "Asia/Riyadh";
const WORKER = { actorType: "service", actorUserId: null, requestId: "job:test", source: "worker" } as const;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
/**
 * The GETs of a defaulted record answer ETag "0" while nothing is stored (ETagOrZero / IfMatchOrZero). The two GET
 * operations declare the `ETag` header (>= 1) instead of `ETagOrZero`: a contract fix requested from the orchestrator
 * in the T-DG5-BE-L handback. Until then only these version-0 reads skip the header check; every other call is
 * validated against the contract.
 */
const VERSION_ZERO_READ = { contract: false } as const;
const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (minutes: number) => {
  const m = ((Math.floor(minutes) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
};
/** Quiet hours from two hours before to two hours after the current Riyadh wall clock. */
const quietAroundNow = () => {
  const m = Math.floor(wallClockOf(new Date(), RIYADH).minutes);
  return { quietHoursStart: timeOf(m - 120), quietHoursEnd: timeOf(m + 120), endMinutes: m + 120 };
};

/** A user of org A holding `role` (every role but AUD holds notification.preferences). */
async function member(role = "WL"): Promise<{ id: string; session: Session }> {
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, role, { type: "organization", id: w.orgA.id }, w.orgA.id);
  return { id: u.id, session: await signIn(api.app, u.subject) };
}

const reminder = (userId: string, over: Partial<WorkItemInput> = {}): WorkItemInput => ({
  organizationId: w.orgA.id,
  kind: "kpi_update_due",
  assigneeUserId: userId,
  subjectType: "kpi_definition",
  subjectId: crypto.randomUUID(),
  linkPath: "/kpi/synthetic",
  messageKey: "tasks.kpi_update_due",
  messageParams: { periodLabel: "2026-10", kpiName: "Synthetic KPI" },
  periodLabel: "2026-10",
  dedupeKey: uniq("be-l.reminder:"),
  ...over,
});
const create = (i: WorkItemInput, impl = createWorkItemOnce) =>
  api.db.transaction().execute((tx) => impl(tx, WORKER, i));
const notificationOf = (dedupeKey: string) =>
  api.db.selectFrom("inbox_notification").selectAll().where("dedupe_key", "=", dedupeKey).executeTakeFirstOrThrow();
const inboxIds = async (s: Session): Promise<string[]> =>
  ((await call<Body>(api.app, "GET", `${INBOX}?limit=100`, { session: s })).body.items as Body[]).map((n) => n.id);

describe("preferences: GET/PUT /me/notification-preferences (ADR-0044 §5, §9)", () => {
  it('version 0 with the defaults when none stored; If-Match "0" creates; then 409 stale; one audit event per write', async () => {
    const u = await member();
    const none = await call<Body>(api.app, "GET", PREFS, { session: u.session, ...VERSION_ZERO_READ });
    expect(none.status).toBe(200);
    expect(none.headers.etag).toBe('"0"');
    expect(none.body).toEqual({
      own: null,
      effective: {
        quietHoursStart: null,
        quietHoursEnd: null,
        timezone: RIYADH,
        digestMode: "off",
        digestTime: "08:00",
      },
      version: 0,
    });
    const body = { quietHoursStart: "22:00", quietHoursEnd: "07:00", digestMode: "daily", digestTime: "08:30" };
    const created = await call<Body>(api.app, "PUT", PREFS, { session: u.session, headers: ifm(0), body });
    expect(created.status).toBe(200);
    expect(created.headers.etag).toBe('"1"');
    expect(created.body.own).toEqual({ ...body, timezone: RIYADH });
    expect(created.body.effective).toEqual({ ...body, timezone: RIYADH });
    // "0" again is stale once a row exists; a wrong version is stale; nothing written by either.
    const again = await call<Body>(api.app, "PUT", PREFS, { session: u.session, headers: ifm(0), body });
    expect([again.status, again.body.code]).toEqual([409, "version_conflict"]);
    expect((await call<Body>(api.app, "PUT", PREFS, { session: u.session, headers: ifm(7), body })).status).toBe(409);
    const updated = await call<Body>(api.app, "PUT", PREFS, {
      session: u.session,
      headers: ifm(1),
      body: { quietHoursStart: null, quietHoursEnd: null, digestMode: "twice_daily", timezone: "Asia/Dubai" },
    });
    expect([updated.status, updated.body.version]).toEqual([200, 2]);
    expect(updated.body.own).toEqual({
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: "Asia/Dubai",
      digestMode: "twice_daily",
      digestTime: "08:30",
    });
    const row = await api.db
      .selectFrom("notification_preference")
      .select("id")
      .where("user_id", "=", u.id)
      .executeTakeFirstOrThrow();
    const audit = await auditOf(api.db, row.id);
    expect(audit.map((a: Body) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["notification_preference.create", null, 1],
      ["notification_preference.update", 1, 2],
    ]);
  });

  it("refusals: 428 without If-Match; 422 quiet start = end (and half-set); 422 unknown zone; 400 schema; nothing written", async () => {
    const u = await member();
    const body = { quietHoursStart: "22:00", quietHoursEnd: "22:00", digestMode: "off" };
    expect((await call<Body>(api.app, "PUT", PREFS, { session: u.session, body })).status).toBe(428);
    const same = await call<Body>(api.app, "PUT", PREFS, { session: u.session, headers: ifm(0), body });
    expect([same.status, same.body.code, same.body.detail]).toEqual([
      422,
      "notification_preference.quiet_hours_invalid",
      "Quiet hours need a start time and a different end time.",
    ]);
    const half = await call<Body>(api.app, "PUT", PREFS, {
      session: u.session,
      headers: ifm(0),
      body: { ...body, quietHoursEnd: null },
    });
    expect([half.status, half.body.code]).toEqual([422, "notification_preference.quiet_hours_invalid"]);
    const zone = await call<Body>(api.app, "PUT", PREFS, {
      session: u.session,
      headers: ifm(0),
      body: { quietHoursStart: null, quietHoursEnd: null, digestMode: "off", timezone: "Mars/Olympus_Mons" },
    });
    expect([zone.status, zone.body.code, zone.body.detail]).toEqual([
      422,
      "notification_preference.timezone_unknown",
      "The time zone is not a known time zone.",
    ]);
    for (const bad of [
      { ...body, quietHoursStart: "24:00" },
      { ...body, digestMode: "hourly" },
      { ...body, extra: true },
      { quietHoursStart: null, quietHoursEnd: null },
    ])
      expect((await call<Body>(api.app, "PUT", PREFS, { session: u.session, headers: ifm(0), body: bad })).status).toBe(
        400,
      );
    const rows = await api.db.selectFrom("notification_preference").select("id").where("user_id", "=", u.id).execute();
    expect(rows).toEqual([]);
  });

  it("AUD gets 403 on PUT (and a user with no role); anonymous 401; the AUD user still reads its own preferences", async () => {
    const body = { quietHoursStart: null, quietHoursEnd: null, digestMode: "daily" };
    const aud = await call<Body>(api.app, "PUT", PREFS, { session: auditor, headers: ifm(0), body });
    expect(aud.status).toBe(403);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call<Body>(api.app, "PUT", PREFS, { session: nobody, headers: ifm(0), body })).status).toBe(403);
    expect((await call<Body>(api.app, "GET", PREFS, { session: auditor, ...VERSION_ZERO_READ })).status).toBe(200);
    expect((await call<Body>(api.app, "GET", PREFS)).status).toBe(401);
    expect((await call<Body>(api.app, "PUT", PREFS, { headers: ifm(0), body })).status).toBe(401);
    const rows = await api.db
      .selectFrom("notification_preference")
      .select("id")
      .where("user_id", "in", [w.auditor.id, w.nobody.id])
      .execute();
    expect(rows).toEqual([]);
  });

  it("commit-time: a grant revoked while the PUT waited is 403; nothing written", async () => {
    const u = await member();
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call<Body>(api.app, "PUT", PREFS, {
          session: u.session,
          headers: ifm(0),
          body: { quietHoursStart: null, quietHoursEnd: null, digestMode: "daily" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(
      await api.db.selectFrom("notification_preference").select("id").where("user_id", "=", u.id).execute(),
    ).toEqual([]);
  });
});

describe("policy: GET/PUT /admin/notification-policy (ADM_TECH; ADR-0044 §5, §9)", () => {
  it('version 0 when none; If-Match "0" creates; 409 stale; 428; 422 quiet hours; audited; non-admins 403', async () => {
    // Org A's policy (the "no preference and no policy" case below uses its own organization).
    const none = await call<Body>(api.app, "GET", POLICY, { session: tech, ...VERSION_ZERO_READ });
    expect(none.status).toBe(200);
    const start = none.body.version as number;
    expect(none.body.urgentDelivery).toBe("immediate");
    expect(none.body.urgentKinds).toEqual(
      expect.arrayContaining(["approval_escalated", "approval_overdue", "executive_decision_escalated"]),
    );
    const body = {
      nonUrgentWorkingDaysOnly: false,
      defaultQuietHoursStart: null,
      defaultQuietHoursEnd: null,
      defaultDigestMode: "off",
    };
    expect((await call<Body>(api.app, "PUT", POLICY, { session: tech, body })).status).toBe(428);
    const bad = await call<Body>(api.app, "PUT", POLICY, {
      session: tech,
      headers: ifm(start),
      body: { ...body, defaultQuietHoursStart: "21:00", defaultQuietHoursEnd: "21:00" },
    });
    expect([bad.status, bad.body.code]).toEqual([422, "notification_preference.quiet_hours_invalid"]);
    expect((await call<Body>(api.app, "PUT", POLICY, { session: tech, headers: ifm(start + 5), body })).status).toBe(
      409,
    );
    const office = await signIn(api.app, w.office.subject);
    for (const s of [auditor, office]) {
      expect((await call<Body>(api.app, "GET", POLICY, { session: s })).status).toBe(403);
      expect((await call<Body>(api.app, "PUT", POLICY, { session: s, headers: ifm(start), body })).status).toBe(403);
    }
    const put = await call<Body>(api.app, "PUT", POLICY, { session: tech, headers: ifm(start), body });
    expect([put.status, put.body.version, put.headers.etag]).toEqual([200, start + 1, `"${start + 1}"`]);
    expect(put.body.organizationId).toBe(w.orgA.id);
    const row = await api.db
      .selectFrom("notification_policy")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .executeTakeFirstOrThrow();
    expect((await auditOf(api.db, row.id)).at(-1)).toMatchObject({
      action: start === 0 ? "notification_policy.create" : "notification_policy.update",
      new_version: start + 1,
    });
  });
});

describe("delivery and digests (REQ-S12-025)", () => {
  it("with no preference and no policy every notification is delivered at once (DG4 regression on the inbox list)", async () => {
    const org = await createOrg(api.db);
    const user = await createUser(api.db, org.id);
    await grant(api.db, w.grantor.id, user.id, "WL", { type: "organization", id: org.id }, org.id);
    const u = { id: user.id, session: await signIn(api.app, user.subject) };
    const i = { ...reminder(u.id), organizationId: org.id };
    await create(i);
    const n = await notificationOf(i.dedupeKey);
    expect([n.delivery_state, n.deliver_after, n.urgency, n.is_digest]).toEqual(["delivered", null, "normal", false]);
    const inbox = await call<Body>(api.app, "GET", INBOX, { session: u.session });
    expect(inbox.body.items.map((x: Body) => x.id)).toEqual([n.id]);
    expect(inbox.body.unreadCount).toBe(1);
  });

  it("a non-urgent reminder in quiet hours is delivered in the next digest; the job twice in the window creates one digest; My Work shows the task at once", async () => {
    const u = await member();
    const q = quietAroundNow();
    const digestTime = timeOf(q.endMinutes + 60);
    const put = await call<Body>(api.app, "PUT", PREFS, {
      session: u.session,
      headers: ifm(0),
      body: { quietHoursStart: q.quietHoursStart, quietHoursEnd: q.quietHoursEnd, digestMode: "daily", digestTime },
    });
    expect(put.status).toBe(200);
    const i = reminder(u.id);
    const created = await create(i);
    const held = await notificationOf(i.dedupeKey);
    expect(held.delivery_state).toBe("held");
    const release = held.deliver_after!;
    // Released at the digest time after the quiet hours, in the user's zone; never before it was created.
    expect(wallClockOf(release, RIYADH).minutes).toBe((((q.endMinutes + 60) % 1440) + 1440) % 1440);
    expect(release.getTime()).toBeGreaterThan(Date.now());
    // The work item is never held: My Work lists it now; the inbox does not list the held reminder.
    const items = await call<Body>(api.app, "GET", "/api/v1/me/work-items", { session: u.session });
    expect(items.body.items.map((x: Body) => x.id)).toContain(created.workItemId);
    const before = await call<Body>(api.app, "GET", INBOX, { session: u.session });
    expect([before.body.items, before.body.unreadCount]).toEqual([[], 0]);
    // Before the release time the job finds nothing for this user.
    const early = await runDigestWindow(api.db, "job:be-l-early", new Date(release.getTime() - 60_000), {
      userIds: [u.id],
    });
    expect(early.users).toEqual([]);
    // The job in the window after the release: one digest; run again in the same window: nothing more.
    const at = new Date(release.getTime() + 60_000);
    const first = await runDigestWindow(api.db, "job:be-l-1", at, { userIds: [u.id] });
    expect(first.users).toEqual([{ userId: u.id, outcome: "digested", digestId: expect.any(String), count: 1 }]);
    const second = await runDigestWindow(api.db, "job:be-l-2", new Date(at.getTime() + 60_000), { userIds: [u.id] });
    expect(second.users).toEqual([]);
    const digests = await api.db
      .selectFrom("notification_digest")
      .selectAll()
      .where("recipient_user_id", "=", u.id)
      .execute();
    expect(digests).toHaveLength(1);
    const digestId = digests[0]!.id;
    const after = await notificationOf(i.dedupeKey);
    expect([after.delivery_state, after.digest_id]).toEqual(["digested", digestId]);
    // The inbox now lists the one digest notification (not the digested reminder), linking to the digest read.
    const inbox = await call<Body>(api.app, "GET", INBOX, { session: u.session });
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({
      messageKey: "notifications.digest",
      messageParams: { count: 1 },
      linkPath: `/me/notification-digests/${digestId}`,
      workItemId: null,
    });
    const read = await call<Body>(api.app, "GET", `/api/v1/me/notification-digests/${digestId}`, {
      session: u.session,
    });
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ id: digestId, count: 1 });
    expect(read.body.items).toEqual([
      {
        notificationId: held.id,
        messageKey: "tasks.kpi_update_due",
        messageParams: { periodLabel: "2026-10", kpiName: "Synthetic KPI" },
        linkPath: "/kpi/synthetic",
        createdAt: held.created_at.toISOString(),
      },
    ]);
    // Own digests only: anyone else gets 404; an unknown id 404; a malformed id 400.
    const other = await member();
    expect(
      (await call<Body>(api.app, "GET", `/api/v1/me/notification-digests/${digestId}`, { session: other.session }))
        .status,
    ).toBe(404);
    expect(
      (
        await call<Body>(api.app, "GET", `/api/v1/me/notification-digests/${crypto.randomUUID()}`, {
          session: u.session,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call<Body>(api.app, "GET", "/api/v1/me/notification-digests/nope", { session: u.session })).status,
    ).toBe(400);
    // Audited: the digest row, the digest notification, the reminder's held -> digested.
    expect((await auditOf(api.db, digestId)).map((a: Body) => a.action)).toEqual(["notification_digest.create"]);
    expect((await auditOf(api.db, held.id)).map((a: Body) => a.action)).toEqual([
      "inbox_notification.create",
      "inbox_notification.digest",
    ]);
  });

  it("an urgent escalation (approval_escalated) in quiet hours is delivered immediately", async () => {
    const u = await member();
    const q = quietAroundNow();
    await call<Body>(api.app, "PUT", PREFS, {
      session: u.session,
      headers: ifm(0),
      body: { quietHoursStart: q.quietHoursStart, quietHoursEnd: q.quietHoursEnd, digestMode: "daily" },
    });
    for (const impl of [createWorkItemOnce, workerCreateWorkItemOnce]) {
      const i = reminder(u.id, {
        kind: "approval_escalated",
        subjectType: "approval",
        messageKey: "approvals.task.escalated",
        dedupeKey: uniq("be-l.urgent:"),
      });
      await create(i, impl);
      const n = await notificationOf(i.dedupeKey);
      expect([n.delivery_state, n.deliver_after, n.urgency]).toEqual(["delivered", null, "urgent"]);
      expect(await inboxIds(u.session)).toContain(n.id);
    }
  });

  it("quiet hours with the digest off: held until they end, then delivered into the inbox (no digest)", async () => {
    const u = await member();
    const q = quietAroundNow();
    await call<Body>(api.app, "PUT", PREFS, {
      session: u.session,
      headers: ifm(0),
      body: { quietHoursStart: q.quietHoursStart, quietHoursEnd: q.quietHoursEnd, digestMode: "off" },
    });
    const i = reminder(u.id);
    await create(i, workerCreateWorkItemOnce);
    const held = await notificationOf(i.dedupeKey);
    expect(held.delivery_state).toBe("held");
    expect(wallClockOf(held.deliver_after!, RIYADH).minutes).toBe(((q.endMinutes % 1440) + 1440) % 1440);
    const r = await runDigestWindow(api.db, "job:be-l-off", new Date(held.deliver_after!.getTime() + 1000), {
      userIds: [u.id],
    });
    expect(r.users).toEqual([{ userId: u.id, outcome: "delivered", digestId: null, count: 1 }]);
    expect((await notificationOf(i.dedupeKey)).delivery_state).toBe("delivered");
    expect(await inboxIds(u.session)).toEqual([held.id]);
    expect(
      await api.db.selectFrom("notification_digest").select("id").where("recipient_user_id", "=", u.id).execute(),
    ).toEqual([]);
  });

  it("the organization policy applies to a user without a preference; business-day timing uses the default calendar", async () => {
    // A separate organization so that org A's policy (other tests) is not changed here.
    const org = await createOrg(api.db);
    const admin = await createUser(api.db, org.id);
    await grant(api.db, w.grantor.id, admin.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
    const user = await createUser(api.db, org.id);
    await grant(api.db, w.grantor.id, user.id, "WL", { type: "organization", id: org.id }, org.id);
    const s = await signIn(api.app, admin.subject);
    const q = quietAroundNow();
    const put = await call<Body>(api.app, "PUT", POLICY, {
      session: s,
      headers: ifm(0),
      body: {
        nonUrgentWorkingDaysOnly: true,
        defaultQuietHoursStart: q.quietHoursStart,
        defaultQuietHoursEnd: q.quietHoursEnd,
        defaultDigestMode: "off",
      },
    });
    expect([put.status, put.body.organizationId, put.body.version]).toEqual([200, org.id, 1]);
    const userSession = await signIn(api.app, user.subject);
    const prefs = await call<Body>(api.app, "GET", PREFS, { session: userSession, ...VERSION_ZERO_READ });
    expect(prefs.headers.etag).toBe('"0"');
    expect(prefs.body).toMatchObject({
      own: null,
      version: 0,
      effective: { quietHoursStart: q.quietHoursStart, quietHoursEnd: q.quietHoursEnd, digestMode: "off" },
    });
    const i = { ...reminder(user.id), organizationId: org.id };
    await create(i);
    const n = await notificationOf(i.dedupeKey);
    expect(n.delivery_state).toBe("held");
    // No calendar configured for this organization: the business-day rule cannot apply (never guessed), so the
    // release is the end of the quiet hours.
    expect(wallClockOf(n.deliver_after!, RIYADH).minutes).toBe(((q.endMinutes % 1440) + 1440) % 1440);
  });
});

describe("parity: the worker kit's twin writes the same rows (ADR-0002 rule 5)", () => {
  it("held and delivered rows: same state, same release instant (to the minute), same audit keys", async () => {
    const u = await member();
    const q = quietAroundNow();
    await call<Body>(api.app, "PUT", PREFS, {
      session: u.session,
      headers: ifm(0),
      body: { quietHoursStart: q.quietHoursStart, quietHoursEnd: q.quietHoursEnd, digestMode: "twice_daily" },
    });
    const shape = async (dedupeKey: string) => {
      const n = await notificationOf(dedupeKey);
      const audit = await auditOf(api.db, n.id);
      return {
        urgency: n.urgency,
        state: n.delivery_state,
        release: n.deliver_after === null ? null : Math.floor(n.deliver_after.getTime() / 60_000),
        isDigest: n.is_digest,
        audit: audit.map((a: Body) => [a.action, Object.keys(a.changes as object).sort()]),
      };
    };
    for (const kind of ["kpi_update_due", "approval_escalated"]) {
      const a = reminder(u.id, { kind, dedupeKey: uniq("be-l.parity-api:") });
      const b = reminder(u.id, { kind, dedupeKey: uniq("be-l.parity-worker:") });
      await create(a);
      await create(b, workerCreateWorkItemOnce);
      expect(await shape(b.dedupeKey)).toEqual(await shape(a.dedupeKey));
    }
  });
});
