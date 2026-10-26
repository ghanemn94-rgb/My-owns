// Record sensitivity flags and explicit sensitive-record grants (T-DG6-BE-B; ADR-0051 §2, §6, §7; REQ-S10-002), against
// the run's disposable PostgreSQL through the contract-validating client. Every value is SYNTHETIC. A grant is an
// access decision, never a business approval (G1-G6), and nothing here touches the engineering gates DG0-DG7.
//   - mark/unmark with IfMatchOrZero ("0" creates; 428 missing; 409 stale), one audit event with prior/new version,
//     the trigger-written history, and the business record's own version untouched;
//   - grant, duplicate 409, self 422, grantee in another organization 422, revoke, revoke again 422 invalid_transition;
//   - ADM_ACCESS (organization-level assignment) grants through the structural rule but reads no title it is not
//     admitted to; AUD 403 on every write and 200 on the reads;
//   - commit-time re-authorization: a grant right revoked between load and commit is 403 and nothing is written;
//   - concurrent "0" creates and concurrent duplicate grants leave one row (lock 730300 and the unique backstops).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialBody, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let b: BenefitWorld;
let office: Session; // TO @ org A (sensitive_record.grant, .read; inherits)
let nobody: Session; // a user of org A with no assignment
let benefitId: string;
let evidenceId: string;
const GRANTS = "/api/v1/admin/sensitive-grants";

const flagUrl = (type: string, id: string, tr = b.transformationId) =>
  `/api/v1/transformations/${tr}/records/${type}/${id}/sensitivity`;
const getFlag = (s: Session, type = "benefit", id = benefitId) =>
  call<Body>(api.app, "GET", flagUrl(type, id), { session: s });
const putFlag = (s: Session, body: unknown, headers: Record<string, string>, type = "benefit", id = benefitId) =>
  call<Body>(api.app, "PUT", flagUrl(type, id), { session: s, body, headers });
const createGrant = (s: Session, body: Record<string, unknown>) =>
  call<Body>(api.app, "POST", GRANTS, { session: s, body });
const grantBody = (granteeUserId: string, over: Record<string, unknown> = {}) => ({
  transformationId: b.transformationId,
  recordType: "benefit",
  recordId: benefitId,
  granteeUserId,
  reason: "Synthetic need to know",
  ...over,
});
const expectProblem = (res: Res<Body>, status: number, code: string) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.code).toBe(code);
};
const flagRow = (id: string) =>
  api.db.selectFrom("record_sensitivity").selectAll().where("record_id", "=", id).executeTakeFirst();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  const created = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  benefitId = created.body.id;
  const ev = await call<Body>(api.app, "POST", `${b.base}/evidence`, {
    session: b.s.tl,
    body: { kind: "note", title: "Synthetic evidence note", noteBody: "Synthetic", ownerUserId: b.users.tl.id },
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  evidenceId = ev.body.id;
});
afterAll(() => api.close());

describe("getRecordSensitivity (never marked)", () => {
  it('answers version 0 with ETag "0" to a reader; canManage only for sensitive_record.grant', async () => {
    const tl = await getFlag(b.s.tl);
    expect(tl.status, JSON.stringify(tl.body)).toBe(200);
    expect(tl.headers.etag).toBe('"0"');
    expect(tl.body).toMatchObject({ isSensitive: false, reason: null, version: 0, updatedAt: null, canManage: false });
    const to = await getFlag(office);
    expect(to.body.canManage).toBe(true);
    // ADM_ACCESS reads the flag as metadata (structural sensitive_record.read) and may manage it.
    const adm = await getFlag(b.s.admin);
    expect([adm.status, adm.body.canManage]).toEqual([200, true]);
    expect((await getFlag(b.s.auditor)).status).toBe(200);
  });

  it("404 for a caller who cannot read the record, an unknown record, or a record of another transformation", async () => {
    expectProblem(await getFlag(b.s.outsider), 404, "not_found");
    expectProblem(await getFlag(nobody), 404, "not_found");
    expectProblem(await getFlag(office, "benefit", "01900000-0000-7000-8000-000000000000"), 404, "not_found");
    expectProblem(await getFlag(office, "business_case", benefitId), 404, "not_found");
  });

  it("400 for a record type that cannot be sensitive", async () => {
    const res = await call<Body>(api.app, "GET", flagUrl("kpi", benefitId), { session: office });
    expect(res.status).toBe(400);
  });
});

describe("putRecordSensitivity (mark and unmark)", () => {
  it("refuses AUD, a reader without the right (403) and an outsider (404); nothing is written", async () => {
    const body = { isSensitive: true, reason: "Synthetic commercial terms" };
    expectProblem(await putFlag(b.s.auditor, body, ifm(0)), 403, "forbidden");
    expectProblem(await putFlag(b.s.tl, body, ifm(0)), 403, "forbidden");
    expectProblem(await putFlag(b.s.outsider, body, ifm(0)), 404, "not_found");
    expect(await flagRow(benefitId)).toBeUndefined();
  });

  it("validates: 428 without If-Match, 422 sensitivity.reason_required, 400 for a malformed body", async () => {
    expectProblem(await putFlag(office, { isSensitive: true, reason: "Synthetic" }, {}), 428, "precondition_required");
    for (const reason of ["ab", "   ", "x".repeat(1001)])
      expectProblem(await putFlag(office, { isSensitive: true, reason }, ifm(0)), 422, "sensitivity.reason_required");
    expect((await putFlag(office, { isSensitive: true }, ifm(0))).status).toBe(400);
    expect((await putFlag(office, { isSensitive: "yes", reason: "Synthetic" }, ifm(0))).status).toBe(400);
    expect(await flagRow(benefitId)).toBeUndefined();
  });

  it('If-Match "0" creates the row (version 1) with one audit event and one history row; the benefit is untouched', async () => {
    const before = await api.db
      .selectFrom("benefit")
      .select("version")
      .where("id", "=", benefitId)
      .executeTakeFirstOrThrow();
    const res = await putFlag(office, { isSensitive: true, reason: "Synthetic commercial terms" }, ifm(0));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers.etag).toBe('"1"');
    expect(res.body).toMatchObject({
      isSensitive: true,
      version: 1,
      reason: "Synthetic commercial terms",
      canManage: true,
    });
    const row = (await flagRow(benefitId))!;
    const events = await auditOf(api.db, row.id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["record_sensitivity.marked", null, 1],
    ]);
    const history = await api.db
      .selectFrom("record_sensitivity_change")
      .select(["record_version", "is_sensitive"])
      .where("record_sensitivity_id", "=", row.id)
      .execute();
    expect(history).toEqual([{ record_version: 1, is_sensitive: true }]);
    const after = await api.db
      .selectFrom("benefit")
      .select("version")
      .where("id", "=", benefitId)
      .executeTakeFirstOrThrow();
    expect(after.version).toBe(before.version);
  });

  it('409 for "0" once the row exists and for a stale version', async () => {
    expectProblem(await putFlag(office, { isSensitive: false, reason: "Synthetic" }, ifm(0)), 409, "version_conflict");
    expectProblem(await putFlag(office, { isSensitive: false, reason: "Synthetic" }, ifm(7)), 409, "version_conflict");
    expect((await flagRow(benefitId))!.version).toBe(1);
  });

  it("a marked record is hidden from a non-party member (404) and visible to its owner, TO and AUD (metadata)", async () => {
    expectProblem(await getFlag(b.s.bo2), 404, "not_found");
    expectProblem(await getFlag(b.s.tl), 404, "not_found");
    expect((await getFlag(b.s.bo)).status).toBe(200); // owner and creator: named party
    expect((await getFlag(office)).status).toBe(200);
    expect((await getFlag(b.s.auditor)).status).toBe(200);
  });

  it('concurrent If-Match "0" creates leave one row: one 200 and one 409', async () => {
    const body = { isSensitive: true, reason: "Synthetic concurrent mark" };
    const results = await Promise.all([
      putFlag(office, body, ifm(0), "evidence", evidenceId),
      putFlag(office, body, ifm(0), "evidence", evidenceId),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await api.db
      .selectFrom("record_sensitivity")
      .select("id")
      .where("record_id", "=", evidenceId)
      .execute();
    expect(rows).toHaveLength(1);
  });
});

describe("sensitive-record grants", () => {
  let grantId: string;

  it("refuses AUD (403), a reader without the right (403) and an outsider (404)", async () => {
    expectProblem(await createGrant(b.s.auditor, grantBody(b.users.bo2.id)), 403, "forbidden");
    expectProblem(await createGrant(b.s.bo, grantBody(b.users.bo2.id)), 403, "forbidden");
    expectProblem(await createGrant(b.s.outsider, grantBody(b.users.bo2.id)), 404, "not_found");
  });

  it("refuses a grant to yourself (422) and to a user of another organization (422)", async () => {
    expectProblem(await createGrant(office, grantBody(w.office.id)), 422, "sensitive_grant.not_self");
    expectProblem(
      await createGrant(office, grantBody(w.officeB.id)),
      422,
      "sensitive_grant.grantee_not_in_organization",
    );
    expectProblem(
      await createGrant(office, grantBody(b.users.bo2.id, { reason: " " })),
      422,
      "sensitivity.reason_required",
    );
  });

  it('grants (201, ETag "1", Location, one audit event) and the grantee is admitted on the next request', async () => {
    const res = await createGrant(office, grantBody(b.users.bo2.id));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    grantId = res.body.id;
    expect(res.headers.location).toBe(`${GRANTS}/${grantId}`);
    expect(res.body).toMatchObject({
      status: "active",
      version: 1,
      granteeUserId: b.users.bo2.id,
      grantedBy: w.office.id,
      recordTitle: "Synthetic churn reduction",
      recordTitleRedacted: false,
    });
    const events = await auditOf(api.db, grantId);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["sensitive_record_grant.granted", null, 1],
    ]);
    expect((await getFlag(b.s.bo2)).status).toBe(200);
  });

  it("409 sensitive_grant.duplicate for a second active grant", async () => {
    expectProblem(await createGrant(office, grantBody(b.users.bo2.id)), 409, "sensitive_grant.duplicate");
  });

  it("ADM_ACCESS (organization level) grants by record id but reads no title it is not admitted to", async () => {
    const res = await createGrant(b.s.admin, grantBody(b.users.fin.id, { reason: "Synthetic Finance review" }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ recordTitle: null, recordTitleRedacted: true });
    const asOffice = await call<Body>(api.app, "GET", `${GRANTS}/${res.body.id}`, { session: office });
    expect(asOffice.body).toMatchObject({ recordTitle: "Synthetic churn reduction", recordTitleRedacted: false });
    const asAdmin = await call<Body>(api.app, "GET", `${GRANTS}/${res.body.id}`, { session: b.s.admin });
    expect(asAdmin.body).toMatchObject({ recordTitle: null, recordTitleRedacted: true });
    // The grant changes nothing about ADM_ACCESS's own read of the record.
    expect((await call(api.app, "GET", `${b.base}/benefits/${benefitId}`, { session: b.s.admin })).status).toBe(404);
  });

  it("lists (AUD 200; filters; cursor), 403 for a reader without sensitive_record.read, 404 for an outsider", async () => {
    const all = await call<Body>(api.app, "GET", `${GRANTS}?transformationId=${b.transformationId}`, {
      session: b.s.auditor,
    });
    expect(all.status).toBe(200);
    expect(all.body.items.map((g: Body) => g.granteeUserId)).toEqual([b.users.fin.id, b.users.bo2.id]);
    // AUD reads transformation.read but is not admitted to the sensitive benefit: the title is redacted.
    expect(all.body.items.every((g: Body) => g.recordTitle === null && g.recordTitleRedacted)).toBe(true);
    const one = await call<Body>(api.app, "GET", `${GRANTS}?transformationId=${b.transformationId}&limit=1`, {
      session: office,
    });
    expect(one.body.items).toHaveLength(1);
    expect(one.body.nextCursor).not.toBeNull();
    const next = await call<Body>(
      api.app,
      "GET",
      `${GRANTS}?transformationId=${b.transformationId}&limit=1&cursor=${encodeURIComponent(one.body.nextCursor)}`,
      { session: office },
    );
    expect(next.body.items.map((g: Body) => g.id)).toEqual([grantId]);
    expect(next.body.nextCursor).toBeNull();
    const byGrantee = await call<Body>(
      api.app,
      "GET",
      `${GRANTS}?transformationId=${b.transformationId}&granteeUserId=${b.users.bo2.id}&status=active&recordType=benefit&recordId=${benefitId}`,
      { session: office },
    );
    expect(byGrantee.body.items.map((g: Body) => g.id)).toEqual([grantId]);
    expectProblem(
      await call<Body>(api.app, "GET", `${GRANTS}?transformationId=${b.transformationId}`, { session: b.s.tl }),
      403,
      "forbidden",
    );
    expectProblem(
      await call<Body>(api.app, "GET", `${GRANTS}?transformationId=${b.transformationId}`, { session: b.s.outsider }),
      404,
      "not_found",
    );
    expect((await call<Body>(api.app, "GET", GRANTS, { session: office })).status).toBe(400);
  });

  it("getSensitiveGrant: AUD 200, a reader without sensitive_record.read 404", async () => {
    const aud = await call<Body>(api.app, "GET", `${GRANTS}/${grantId}`, { session: b.s.auditor });
    expect([aud.status, aud.headers.etag]).toEqual([200, '"1"']);
    expectProblem(await call<Body>(api.app, "GET", `${GRANTS}/${grantId}`, { session: b.s.tl }), 404, "not_found");
    expectProblem(
      await call<Body>(api.app, "GET", `${GRANTS}/${grantId}`, { session: b.s.outsider }),
      404,
      "not_found",
    );
  });

  it("revoke: AUD 403, 428, stale 409, then active -> revoked with one audit event; revoke again 422", async () => {
    const REVOKE = `${GRANTS}/${grantId}/revoke`;
    const body = { reason: "Synthetic need ended" };
    expectProblem(
      await call<Body>(api.app, "POST", REVOKE, { session: b.s.auditor, body, headers: ifm(1) }),
      403,
      "forbidden",
    );
    expectProblem(
      await call<Body>(api.app, "POST", REVOKE, { session: b.s.outsider, body, headers: ifm(1) }),
      404,
      "not_found",
    );
    expectProblem(await call<Body>(api.app, "POST", REVOKE, { session: office, body }), 428, "precondition_required");
    expectProblem(
      await call<Body>(api.app, "POST", REVOKE, { session: office, body, headers: ifm(3) }),
      409,
      "version_conflict",
    );
    expectProblem(
      await call<Body>(api.app, "POST", REVOKE, { session: office, body: { reason: "no" }, headers: ifm(1) }),
      422,
      "sensitivity.reason_required",
    );
    const res = await call<Body>(api.app, "POST", REVOKE, { session: office, body, headers: ifm(1) });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.headers.etag).toBe('"2"');
    expect(res.body).toMatchObject({
      status: "revoked",
      version: 2,
      revokedBy: w.office.id,
      revokeReason: "Synthetic need ended",
    });
    const events = await auditOf(api.db, grantId);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["sensitive_record_grant.granted", null, 1],
      ["sensitive_record_grant.revoked", 1, 2],
    ]);
    // The revocation applies to the next request.
    expectProblem(await getFlag(b.s.bo2), 404, "not_found");
    const again = await call<Body>(api.app, "POST", REVOKE, { session: office, body, headers: ifm(2) });
    expectProblem(again, 422, "invalid_transition");
    expect(again.body.detail).toBe("Only an active grant can be revoked.");
    // After a revocation a new grant is a new row.
    const regrant = await createGrant(office, grantBody(b.users.bo2.id));
    expect(regrant.status).toBe(201);
    expect(regrant.body.id).not.toBe(grantId);
  });

  it("concurrent duplicate grants leave one active grant: one 201 and one 409", async () => {
    const u = await createUser(api.db, w.orgA.id);
    const results = await Promise.all([createGrant(office, grantBody(u.id)), createGrant(office, grantBody(u.id))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const rows = await api.db
      .selectFrom("sensitive_record_grant")
      .select("id")
      .where("grantee_user_id", "=", u.id)
      .where("status", "=", "active")
      .execute();
    expect(rows).toHaveLength(1);
  });

  it("unmark (an UPDATE to is_sensitive false, version 2) admits every reader again", async () => {
    const res = await putFlag(office, { isSensitive: false, reason: "Synthetic: terms published" }, ifm(1));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ isSensitive: false, version: 2 });
    const row = (await flagRow(benefitId))!;
    const events = await auditOf(api.db, row.id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["record_sensitivity.marked", null, 1],
      ["record_sensitivity.unmarked", 1, 2],
    ]);
    expect((await getFlag(b.s.tl)).status).toBe(200);
  });
});

describe("commit-time re-authorization", () => {
  it("a grant right revoked between load and commit: the mark is 403 and nothing is written", async () => {
    const to = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, to.id, "TO", { type: "transformation", id: b.transformationId }, w.orgA.id);
    const session = await signIn(api.app, to.subject);
    const before = (await flagRow(benefitId))!;
    const res = await afterIdentity(
      api,
      to.id,
      () =>
        call(api.app, "PUT", flagUrl("benefit", benefitId), {
          session,
          headers: ifm(before.version),
          body: { isSensitive: true, reason: "Synthetic remark" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, to.id),
    );
    expect(res.status).toBe(403);
    const after = (await flagRow(benefitId))!;
    expect([after.version, after.is_sensitive]).toEqual([before.version, before.is_sensitive]);
  });

  it("a grant right revoked between load and commit: the grant is 403 and nothing is written", async () => {
    const to = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, to.id, "TO", { type: "transformation", id: b.transformationId }, w.orgA.id);
    const session = await signIn(api.app, to.subject);
    const grantee = await createUser(api.db, w.orgA.id);
    const res = await afterIdentity(
      api,
      to.id,
      () => call(api.app, "POST", GRANTS, { session, body: grantBody(grantee.id), contract: false }),
      () => revokeAll(api, w.grantor.id, to.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db
      .selectFrom("sensitive_record_grant")
      .select("id")
      .where("grantee_user_id", "=", grantee.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  // Continuation T-DG6-BE-BB: the third mutation, revoke, under the same commit-time rule.
  it("a grant right revoked between load and commit: the revoke is 403 and nothing is written", async () => {
    const to = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, to.id, "TO", { type: "transformation", id: b.transformationId }, w.orgA.id);
    const session = await signIn(api.app, to.subject);
    const grantee = await createUser(api.db, w.orgA.id);
    const created = await createGrant(office, grantBody(grantee.id));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id: string = created.body.id;
    const res = await afterIdentity(
      api,
      to.id,
      () =>
        call(api.app, "POST", `${GRANTS}/${id}/revoke`, {
          session,
          headers: ifm(1),
          body: { reason: "Synthetic need ended" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, to.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("sensitive_record_grant")
      .select(["status", "version"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect([row.status, row.version]).toEqual(["active", 1]);
    expect((await auditOf(api.db, id)).map((e) => e.action)).toEqual(["sensitive_record_grant.granted"]);
  });
});
