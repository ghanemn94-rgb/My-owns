// requestKpiVersionApproval and the kpi_version_activation subject provider against a real PostgreSQL (T-DG4-KBE-C, the
// item carried from KBE-B by D-095; ADR-0027 §2 step 3, §11; ADR-0026 §4; S-14):
//  - the request locks the draft (If-Match: 428/409), routes the approval to the Business Owner party through BE-B's
//    approval service at the draft's version (one approval.request audit event, written by the engine) and returns 201;
//    the draft row is not changed (the 0031 decision guard compares the approval's subject version with the row's);
//  - the business approval is decided by a person other than the requester (SoD); approving does NOT activate the
//    version (the provider's onOutcome changes nothing); the explicit activateKpiVersion then succeeds and stores the
//    approval's id on the version; an approval of earlier content does not count;
//  - a pending approval freezes the draft (409 approval.already_open); a second request is 409; a direct-policy version
//    is refused; an unmapped Business Owner party is 422 routing.role_unmapped with nothing written; AUD 403.
// All data is SYNTHETIC. The approval decided here is a demo BUSINESS approval on a synthetic KPI version: it approves
// nothing real and has nothing to do with the engineering gates DG0-DG7.
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
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { createKpi, FLOW_VERSION, ifMatch, postVersion } from "./kbe-b-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const APPROVAL_VERSION = { ...FLOW_VERSION, definitionApproval: "business_approval" };

async function mapBo(world: KpiWorld): Promise<void> {
  const res = await call(api.app, "POST", `${world.base}/role-mappings`, {
    session: world.s.tl,
    body: { partyCode: "BO", targetKind: "user", userId: world.users.bo.id },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function draftNeedingApproval(world: KpiWorld): Promise<{ id: string; version: number }> {
  const kpi = await createKpi(api, world);
  const v = await postVersion(api, world, kpi.id, APPROVAL_VERSION);
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  return { id: v.body.id, version: v.body.version };
}

const requestApproval = (world: KpiWorld, versionId: string, version: number | null, session?: Session, body = {}) =>
  call<Body>(api.app, "POST", `${world.base}/kpi-versions/${versionId}/approval-requests`, {
    session: session ?? world.s.kds,
    ...(version === null ? {} : { headers: ifMatch(version) }),
    body,
  });

const getVersion = (world: KpiWorld, id: string) =>
  call<Body>(api.app, "GET", `${world.base}/kpi-versions/${id}`, { session: world.s.auditor });

const decide = (
  approvalId: string,
  session: Session,
  approvalVersion: number,
  subjectVersion: number,
  outcome = "approve",
) =>
  call<Body>(api.app, "POST", `/api/v1/approvals/${approvalId}/decisions`, {
    session,
    headers: ifMatch(approvalVersion),
    body: { outcome, rationale: "Synthetic rationale: the KPI version is complete.", subjectVersion },
  });

describe("requestKpiVersionApproval (business approval of a KPI version)", () => {
  beforeAll(async () => {
    await mapBo(k);
  });

  it("requests through the approval service at the draft version; approving does not activate; activation does", async () => {
    const draft = await draftNeedingApproval(k);
    // Activation before any approval: 422 kpi_version.approval_required (KBE-B's rule, unchanged).
    const early = await call<Body>(api.app, "POST", `${k.base}/kpi-versions/${draft.id}/activate`, {
      session: k.s.kds,
      headers: ifMatch(draft.version),
    });
    expect([early.status, early.body.code]).toEqual([422, "kpi_version.approval_required"]);

    const before = (await auditOf(api.db, draft.id)).length;
    const res = await requestApproval(k, draft.id, draft.version, undefined, { requestNote: "Synthetic note" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/approvals/${res.body.id}`);
    expect(res.headers.etag).toBe(`"${res.body.version}"`);
    expect([
      res.body.approvalType,
      res.body.subjectId,
      res.body.subjectVersion,
      res.body.status,
      res.body.assignee.partyCode,
      res.body.assignee.userId,
      res.body.requestedBy,
    ]).toEqual(["kpi_version_activation", draft.id, draft.version, "pending", "BO", k.users.bo.id, k.users.kds.id]);
    // One audit event, on the approval (the engine's approval.request); the draft row is unchanged.
    expect((await auditOf(api.db, res.body.id)).map((e) => e.action)).toEqual(["approval.request"]);
    expect((await auditOf(api.db, draft.id)).length).toBe(before);
    expect((await getVersion(k, draft.id)).body).toMatchObject({
      status: "draft",
      version: draft.version,
      approvalId: null,
    });

    // Pending: the draft is frozen (PATCH and withdraw 409), a second request is 409 approval.already_open.
    const patch = await call<Body>(api.app, "PATCH", `${k.base}/kpi-versions/${draft.id}`, {
      session: k.s.kds,
      headers: ifMatch(draft.version),
      body: { calculationDescription: "Synthetic change while pending" },
    });
    expect([patch.status, patch.body.code]).toEqual([409, "approval.already_open"]);
    const withdraw = await call<Body>(api.app, "POST", `${k.base}/kpi-versions/${draft.id}/withdraw`, {
      session: k.s.kds,
      headers: ifMatch(draft.version),
      body: { reason: "Synthetic withdrawal while pending" },
    });
    expect([withdraw.status, withdraw.body.code]).toEqual([409, "approval.already_open"]);
    const again = await requestApproval(k, draft.id, draft.version);
    expect([again.status, again.body.code]).toEqual([409, "approval.already_open"]);
    expect((await auditOf(api.db, draft.id)).length).toBe(before);

    // The Business Owner (not the requester) decides.
    const approved = await decide(res.body.id, k.s.bo, res.body.version, draft.version);
    expect([approved.status, approved.body.status], JSON.stringify(approved.body)).toEqual([200, "approved"]);

    // onOutcome('approved') does not activate: the version is still a draft, unchanged.
    expect((await getVersion(k, draft.id)).body).toMatchObject({
      status: "draft",
      version: draft.version,
      activatedAt: null,
      approvalId: null,
    });

    // The explicit activation now succeeds and stores the approval's id (one audit event, kpi_version.activate).
    const active = await call<Body>(api.app, "POST", `${k.base}/kpi-versions/${draft.id}/activate`, {
      session: k.s.kds,
      headers: ifMatch(draft.version),
    });
    expect([active.status, active.body.status, active.body.approvalId], JSON.stringify(active.body)).toEqual([
      200,
      "active",
      res.body.id,
    ]);
    expect((await auditOf(api.db, draft.id)).slice(before).map((e) => e.action)).toEqual(["kpi_version.activate"]);
  });

  it("an approval of earlier content does not count: edited after approval, activation is 422", async () => {
    const draft = await draftNeedingApproval(k);
    const res = await requestApproval(k, draft.id, draft.version);
    expect(res.status).toBe(201);
    expect((await decide(res.body.id, k.s.bo, res.body.version, draft.version)).status).toBe(200);
    const edited = await call<Body>(api.app, "PATCH", `${k.base}/kpi-versions/${draft.id}`, {
      session: k.s.kds,
      headers: ifMatch(draft.version),
      body: { calculationDescription: "Synthetic change after the approval" },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const refused = await call<Body>(api.app, "POST", `${k.base}/kpi-versions/${draft.id}/activate`, {
      session: k.s.kds,
      headers: ifMatch(edited.body.version),
    });
    expect([refused.status, refused.body.code]).toEqual([422, "kpi_version.approval_required"]);
  });

  it("the requester cannot decide their own request (SoD 403 approval.sod_requester); BO alone cannot request", async () => {
    const other = await seedKpiWorld(api, w);
    // One synthetic person holding KDS (kpi_version.activate) and BO (approval.decide), mapped as the BO party.
    const u = await createUser(api.db, w.orgA.id);
    for (const role of ["KDS", "BO"])
      await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: other.transformationId }, w.orgA.id);
    const both = await signIn(api.app, u.subject);
    const mapped = await call(api.app, "POST", `${other.base}/role-mappings`, {
      session: other.s.tl,
      body: { partyCode: "BO", targetKind: "user", userId: u.id },
    });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
    const draft = await draftNeedingApproval(other);
    // BO alone holds no kpi_version.activate: 403, nothing written.
    expect((await requestApproval(other, draft.id, draft.version, other.s.bo)).status).toBe(403);
    const ok = await requestApproval(other, draft.id, draft.version, both);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const self = await decide(ok.body.id, both, ok.body.version, draft.version);
    expect([self.status, self.body.code]).toEqual([403, "approval.sod_requester"]);
    expect((await getVersion(other, draft.id)).body.status).toBe("draft");
  });

  it("If-Match: 428 when missing, 409 when stale; AUD 403; a direct-policy version 422; nothing written", async () => {
    const draft = await draftNeedingApproval(k);
    const before = (await auditOf(api.db, draft.id)).length;
    expect((await requestApproval(k, draft.id, null)).status).toBe(428);
    const stale = await requestApproval(k, draft.id, draft.version + 5);
    expect(stale.status).toBe(409);
    expect((await requestApproval(k, draft.id, draft.version, k.s.auditor)).status).toBe(403);
    const kpi = await createKpi(api, k);
    const direct = await postVersion(api, k, kpi.id, FLOW_VERSION);
    const refused = await requestApproval(k, direct.body.id, direct.body.version);
    expect([refused.status, refused.body.code]).toEqual([422, "validation.constraint"]);
    expect((await auditOf(api.db, draft.id)).length).toBe(before);
    const approvals = await api.db
      .selectFrom("approval")
      .select("id")
      .where("subject_id", "in", [draft.id, direct.body.id])
      .execute();
    expect(approvals).toEqual([]);
  });

  it("an unmapped Business Owner party is 422 routing.role_unmapped, nothing written", async () => {
    const other = await seedKpiWorld(api, w);
    const draft = await draftNeedingApproval(other);
    const res = await requestApproval(other, draft.id, draft.version);
    expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([422, "routing.role_unmapped"]);
    expect((await getVersion(other, draft.id)).body).toMatchObject({ version: draft.version, approvalId: null });
  });

  it("after changes are requested the draft can be edited and the approval resubmitted at the new version", async () => {
    const draft = await draftNeedingApproval(k);
    // TL requests here: resubmitting needs approval.request (BE-B's engine rule), which TL holds and KDS does not.
    const res = await requestApproval(k, draft.id, draft.version, k.s.tl);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const changes = await decide(res.body.id, k.s.bo, res.body.version, draft.version, "request_changes");
    expect([changes.status, changes.body.status], JSON.stringify(changes.body)).toEqual([200, "changes_requested"]);
    const edited = await call<Body>(api.app, "PATCH", `${k.base}/kpi-versions/${draft.id}`, {
      session: k.s.kds,
      headers: ifMatch(draft.version),
      body: { calculationDescription: "Synthetic: counted at month end" },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const resubmit = await call<Body>(api.app, "POST", `/api/v1/approvals/${res.body.id}/resubmit`, {
      session: k.s.tl,
      headers: ifMatch(changes.body.version),
      body: { subjectVersion: edited.body.version },
    });
    expect([resubmit.status, resubmit.body.subjectVersion], JSON.stringify(resubmit.body)).toEqual([
      200,
      edited.body.version,
    ]);
    const approved = await decide(res.body.id, k.s.bo, resubmit.body.version, edited.body.version);
    expect([approved.status, approved.body.status], JSON.stringify(approved.body)).toEqual([200, "approved"]);
    const active = await call<Body>(api.app, "POST", `${k.base}/kpi-versions/${draft.id}/activate`, {
      session: k.s.kds,
      headers: ifMatch(edited.body.version),
    });
    expect(active.status, JSON.stringify(active.body)).toBe(200);
  });
});
