// Administration > Security > Upload policy (T-DG6-BE-D; ADR-0052 §1; REQ-S13-011 "Allowed types; Max size"; D-195 Q4
// "IT-configurable"; p6-work-split §E/F.6) against a real PostgreSQL. getUploadPolicy and putUploadPolicy cover, for the
// mutation (§2 rule 4): authorization at request start (ADM_TECH only; AUD, TO, a user without grants and another
// organization's TO 403; an unknown organization 404) and at commit (the right revoked while the request waits on the
// row lock is 403 and nothing is written), validation (400 for a type outside the set, a duplicate, an empty list,
// maxBytes 0 or above 26214400, a short or blank reason, an unknown member), If-Match (428 missing, 409 stale, "0"
// creates; concurrent "0" creates: one 200 and 409s), one audit event upload_policy.changed with prior and new version,
// the trigger-written history, and the reads (default view with ETag "0", AUD and ADM_TECH 200). All data is
// SYNTHETIC; changing a policy approves nothing and nothing here touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeAll } from "../calendar/session-lock.ts";
import {
  call,
  createOrg,
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

let api: TestApi;
let w: World;
let admin: Session; // ADM_TECH + ADM_ACCESS @ A
let auditor: Session; // AUD @ A
let office: Session; // TO @ A
let nobody: Session;
let officeB: Session; // TO @ B
const ALL = ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif", "svg"];
const url = (organizationId: string) => `/api/v1/admin/upload-policy?organizationId=${organizationId}`;
const body = (over: Record<string, unknown> = {}) => ({
  allowedTypes: ["pdf", "png"],
  maxBytes: 1048576,
  reason: "Synthetic IT narrowing",
  ...over,
});

async function freshOrg() {
  const org = await createOrg(api.db);
  const grantor = await createUser(api.db, org.id);
  const user = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, user.id, "ADM_TECH", { type: "organization", id: org.id }, org.id);
  return { id: org.id, grantorId: grantor.id, adminId: user.id, admin: await signIn(api.app, user.subject) };
}
const policyRow = (organizationId: string) =>
  api.db.selectFrom("upload_policy").selectAll().where("organization_id", "=", organizationId).executeTakeFirst();
const auditsOf = (recordId: string) =>
  api.db
    .selectFrom("audit_event")
    .selectAll()
    .where("record_id", "=", recordId)
    .where("action", "=", "upload_policy.changed")
    .orderBy("occurred_at")
    .execute();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  officeB = await signIn(api.app, w.officeB.subject);
}, 120_000);
afterAll(() => api.close());

describe("getUploadPolicy", () => {
  it('no row: the default (all ten types, 26214400 bytes), isDefault, inline types png/jpeg/gif, ETag "0"', async () => {
    const org = await freshOrg();
    const res = await call(api.app, "GET", url(org.id), { session: org.admin });
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"0"');
    expect(res.body).toEqual({
      organizationId: org.id,
      allowedTypes: ALL,
      maxBytes: 26214400,
      isDefault: true,
      inlinePreviewTypes: ["png", "jpeg", "gif"],
      reason: null,
      version: 0,
      updatedAt: null,
    });
  });

  it("AUD (security.read) reads it; TO, a user without grants and another organization's TO get 403; unknown org 404", async () => {
    expect((await call(api.app, "GET", url(w.orgA.id), { session: auditor })).status).toBe(200);
    expect((await call(api.app, "GET", url(w.orgA.id), { session: admin })).status).toBe(200);
    for (const s of [office, nobody, officeB])
      expect((await call(api.app, "GET", url(w.orgA.id), { session: s })).status).toBe(403);
    expect((await call(api.app, "GET", url(crypto.randomUUID()), { session: admin })).status).toBe(404);
    expect((await call(api.app, "GET", url("not-a-uuid"), { session: admin })).status).toBe(400);
    expect((await call(api.app, "GET", "/api/v1/admin/upload-policy", { session: admin })).status).toBe(400);
    expect((await call(api.app, "GET", url(w.orgA.id), { session: null })).status).toBe(401);
  });
});

describe("putUploadPolicy", () => {
  it('If-Match "0" creates version 1 (types in contract order); one audit event with prior null and new 1; history row', async () => {
    const org = await freshOrg();
    const res = await call(api.app, "PUT", url(org.id), {
      session: org.admin,
      headers: ifm(0),
      body: body({ allowedTypes: ["png", "csv", "pdf"] }),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({
      organizationId: org.id,
      allowedTypes: ["pdf", "csv", "png"],
      maxBytes: 1048576,
      isDefault: false,
      inlinePreviewTypes: ["png"],
      reason: "Synthetic IT narrowing",
      version: 1,
    });
    const row = (await policyRow(org.id))!;
    const audits = await auditsOf(row.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ prior_version: null, new_version: 1, reason: "Synthetic IT narrowing" });
    expect(audits[0]!.changes).toEqual({
      allowed_types: { from: null, to: ["pdf", "csv", "png"] },
      max_bytes: { from: null, to: 1048576 },
    });
    const history = await api.db
      .selectFrom("upload_policy_change")
      .selectAll()
      .where("upload_policy_id", "=", row.id)
      .execute();
    expect(history.map((h) => h.record_version)).toEqual([1]);
    // GET now shows the row.
    const read = await call(api.app, "GET", url(org.id), { session: org.admin });
    expect([read.headers["etag"], read.body.version, read.body.isDefault]).toEqual(['"1"', 1, false]);

    // An update with the current version: version 2, prior 1, its own audit event and history row.
    const upd = await call(api.app, "PUT", url(org.id), {
      session: org.admin,
      headers: ifm(1),
      body: body({ allowedTypes: ["jpeg", "gif", "svg"], maxBytes: 26214400, reason: "Synthetic widening" }),
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(upd.body).toMatchObject({
      version: 2,
      allowedTypes: ["jpeg", "gif", "svg"],
      inlinePreviewTypes: ["jpeg", "gif"],
    });
    const after = await auditsOf(row.id);
    expect(after.map((a) => [a.prior_version, a.new_version])).toEqual([
      [null, 1],
      [1, 2],
    ]);
    expect(after[1]!.changes).toEqual({
      allowed_types: { from: ["pdf", "csv", "png"], to: ["jpeg", "gif", "svg"] },
      max_bytes: { from: 1048576, to: 26214400 },
    });
  });

  it('If-Match: 428 missing, 409 stale ("0" against a row, an old version), nothing written', async () => {
    const org = await freshOrg();
    const missing = await call(api.app, "PUT", url(org.id), { session: org.admin, body: body() });
    expect(missing.status).toBe(428);
    const stale = await call(api.app, "PUT", url(org.id), { session: org.admin, headers: ifm(3), body: body() });
    expect(stale.status).toBe(409);
    expect(await policyRow(org.id)).toBeUndefined();
    expect(
      (await call(api.app, "PUT", url(org.id), { session: org.admin, headers: ifm(0), body: body() })).status,
    ).toBe(200);
    const again = await call(api.app, "PUT", url(org.id), { session: org.admin, headers: ifm(0), body: body() });
    expect([again.status, again.body.currentVersion]).toEqual([409, 1]);
    expect((await policyRow(org.id))!.version).toBe(1);
    expect(await auditsOf((await policyRow(org.id))!.id)).toHaveLength(1);
  });

  it("validation: 400 for a type outside the set, a duplicate, an empty list, maxBytes 0 or above 26214400, a bad reason", async () => {
    const org = await freshOrg();
    for (const bad of [
      body({ allowedTypes: ["exe"] }),
      body({ allowedTypes: ["html", "pdf"] }),
      body({ allowedTypes: ["pdf", "pdf"] }),
      body({ allowedTypes: [] }),
      body({ maxBytes: 0 }),
      body({ maxBytes: 26214401 }),
      body({ maxBytes: 1.5 }),
      body({ maxBytes: "100" }),
      body({ reason: "ab" }),
      body({ reason: "   " }),
      body({ reason: "x".repeat(1001) }),
      body({ extra: true }),
      { allowedTypes: ["pdf"], maxBytes: 10 },
    ]) {
      const res = await call(api.app, "PUT", url(org.id), { session: org.admin, headers: ifm(0), body: bad });
      expect([res.status, res.body.code], JSON.stringify(bad)).toEqual([400, "validation"]);
    }
    expect(await policyRow(org.id)).toBeUndefined();
  });

  it("authorization at request start: AUD, TO, no grants and another organization's TO 403; unknown org 404; nothing written", async () => {
    const org = await freshOrg();
    for (const s of [auditor, office, nobody, officeB]) {
      const res = await call(api.app, "PUT", url(w.orgA.id), { session: s, headers: ifm(0), body: body() });
      expect(res.status).toBe(403);
    }
    // ADM_TECH of one organization cannot change another's.
    expect(
      (await call(api.app, "PUT", url(w.orgA.id), { session: org.admin, headers: ifm(0), body: body() })).status,
    ).toBe(403);
    expect(await policyRow(w.orgA.id)).toBeUndefined();
    expect(
      (await call(api.app, "PUT", url(crypto.randomUUID()), { session: org.admin, headers: ifm(0), body: body() }))
        .status,
    ).toBe(404);
    // CSRF: a PUT without the token is refused before anything else.
    const noCsrf = await call(api.app, "PUT", url(org.id), {
      session: org.admin,
      headers: ifm(0),
      body: body(),
      csrf: false,
    });
    expect([noCsrf.status, noCsrf.body.code]).toEqual([403, "csrf"]);
    expect(await policyRow(org.id)).toBeUndefined();
  });

  it("commit-time re-authorization: the configure right revoked while the request waits on the row lock is 403; nothing written", async () => {
    const org = await freshOrg();
    expect(
      (await call(api.app, "PUT", url(org.id), { session: org.admin, headers: ifm(0), body: body() })).status,
    ).toBe(200);
    const row = (await policyRow(org.id))!;
    const locker = await api.owner.connect();
    let res;
    try {
      await locker.query("begin");
      const pid = (await locker.query("select pg_backend_pid() as pid")).rows[0].pid as number;
      await locker.query("select id from upload_policy where id = $1 for update", [row.id]);
      // The request passes its request-start gate, then waits on the row lock inside its transaction.
      const pending = call(api.app, "PUT", url(org.id), {
        session: org.admin,
        headers: ifm(1),
        body: body({ reason: "Synthetic commit-time check" }),
        contract: false,
      });
      let waited = false;
      for (let i = 0; i < 400 && !waited; i++) {
        const r = await api.owner.query(
          "select count(*)::int as n from pg_locks where not granted and $1 = any (pg_blocking_pids(pid))",
          [pid],
        );
        waited = r.rows[0].n > 0;
        if (!waited) await new Promise((r2) => setTimeout(r2, 25));
      }
      expect(waited, "the PUT waits on the upload_policy row lock").toBe(true);
      await revokeAll(api, org.grantorId, org.adminId);
      await locker.query("commit");
      res = await pending;
    } finally {
      locker.release();
    }
    expect(res.status).toBe(403);
    const after = (await policyRow(org.id))!;
    expect([after.version, after.reason]).toEqual([1, "Synthetic IT narrowing"]);
    expect(await auditsOf(row.id)).toHaveLength(1);
  });

  it('concurrent "0" creates: one 200, the others 409 version_conflict; one row and one audit event', async () => {
    const org = await freshOrg();
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        call(api.app, "PUT", url(org.id), {
          session: org.admin,
          headers: ifm(0),
          body: body({ reason: `Synthetic concurrent create ${i}` }),
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.code).toBe("version_conflict");
    const row = (await policyRow(org.id))!;
    expect(row.version).toBe(1);
    expect(await auditsOf(row.id)).toHaveLength(1);
  });

  it("the history and the audit trail cannot be written by the application role (trigger-written; append-only)", async () => {
    const org = await freshOrg();
    expect(
      (await call(api.app, "PUT", url(org.id), { session: org.admin, headers: ifm(0), body: body() })).status,
    ).toBe(200);
    const row = (await policyRow(org.id))!;
    await expect(
      api.db
        .insertInto("upload_policy_change")
        .values({
          id: crypto.randomUUID(),
          upload_policy_id: row.id,
          organization_id: org.id,
          record_version: 9,
          allowed_types: ["pdf"],
          max_bytes: "1",
          reason: "forged",
          changed_by: org.adminId,
          changed_at: new Date(),
        })
        .execute(),
    ).rejects.toThrow(/permission denied/);
  });
});
