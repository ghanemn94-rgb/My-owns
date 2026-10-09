// REQ-S10-003 (ADR-0026 §8; T-DG4-BE-B; D-094; T-DG4-BE-B2): "Never make technical administrators business approvers
// automatically". Acceptance A12: an ADM-only user calling a gate or Finance approval endpoint gets 403. An ADM-only
// user holds every technical-administrator role (ADM_TECH, ADM_ACCESS, ADM_METHOD) in the organization and no business
// role. They get 403 `forbidden` on decideApproval and, since D-094 (T-DG4-BE-B2), on the DG1-DG3 gate decision and
// every Finance validation endpoint (baseline, value pool, business-case baseline, benefit-formula version), whose
// read gate used to answer 404 (or the commit-time 403 text) first. ONE narrow rule (access/technical-admin.ts): only
// a caller whose every grant in the organization is a technical-admin role gets that 403; every other caller's
// response is pinned unchanged below (a reader without the approval right, AUD, a non-member, a user without grants, a
// business user who cannot read, a mixed technical-admin + business user, and a technical admin of another
// organization). Nothing is written in any case but a denial, and the role catalogue gives no technical-admin role a
// business_approval or finance_validation permission.
// Group membership grants nothing: an ADM-only member of the assignee group is refused as well. All data is SYNTHETIC;
// product gate G1 is a business approval inside the product, unrelated to the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOfRequest,
  call,
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
import { ifm } from "../../support/p2-fixtures.ts";
import { requestBody, setupApprovalWorld, type ApprovalWorld } from "./approval-world.ts";

let api: TestApi;
let w: World;
let p: ApprovalWorld;
let adm: { id: string; session: Session };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
  const u = await createUser(api.db, w.orgA.id);
  for (const role of ["ADM_TECH", "ADM_ACCESS", "ADM_METHOD"])
    await grant(api.db, w.grantor.id, u.id, role, { type: "organization", id: w.orgA.id }, w.orgA.id);
  adm = { id: u.id, session: await signIn(api.app, u.subject) };
}, 120_000);
afterAll(() => api.close());

const deniedOnly = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);

describe("REQ-S10-003: an ADM-only user is never a business approver", () => {
  it("no technical-admin role holds a business_approval or finance_validation permission (catalogue)", async () => {
    const rows = await api.db
      .selectFrom("role_permission as rp")
      .innerJoin("role as r", "r.id", "rp.role_id")
      .innerJoin("permission as pm", "pm.code", "rp.permission_code")
      .select(["r.code", "pm.code as permission"])
      .where("r.kind", "=", "technical_admin")
      .where("pm.category", "in", ["business_approval", "finance_validation"])
      .execute();
    expect(rows).toEqual([]);
  });

  it("decideApproval: 403, also as a member of the assignee group; nothing written", async () => {
    // A group with the ADM-only user and a real BO; the BO party is mapped to the group in a fresh transformation.
    const office = await signIn(api.app, w.office.subject);
    const g = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/groups`, {
      session: office,
      body: { code: uniq("G"), nameEn: "Synthetic owners", nameAr: "ملاك اصطناعيون", ownerUserId: w.office.id },
    });
    expect(g.status).toBe(201);
    for (const userId of [adm.id, p.bo2.id])
      expect(
        (await call(api.app, "POST", `/api/v1/groups/${g.body.id}/members`, { session: office, body: { userId } }))
          .status,
      ).toBe(201);
    const q = await setupApprovalWorld(api, w);
    const list = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${q.transformationId}/role-mappings?status=active`,
      {
        session: q.lead.session,
      },
    );
    const bo = list.body.items.find((m: Body) => m.partyCode === "BO");
    await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings/${bo.id}/end`, {
      session: q.lead.session,
      headers: ifm(bo.version),
      body: { reason: "Synthetic: route to the group" },
    });
    await grant(api.db, w.grantor.id, p.bo2.id, "BO", { type: "transformation", id: q.transformationId }, w.orgA.id);
    expect(
      (
        await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings`, {
          session: q.lead.session,
          body: { partyCode: "BO", targetKind: "group", groupId: g.body.id },
        })
      ).status,
    ).toBe(201);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    expect([req.status, req.body.assignee.groupId]).toEqual([201, g.body.id]);
    // Only the group's approver member got a task; the ADM-only member got none.
    const tasks = await api.db
      .selectFrom("work_item")
      .select("assignee_user_id")
      .where("subject_id", "=", req.body.id)
      .execute();
    expect(tasks.map((t) => t.assignee_user_id)).toEqual([p.bo2.id]);
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: adm.session,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
    expect(await deniedOnly(res)).toEqual(["authorization.denied"]);
    // Only a technical-admin-only caller gets that 403: a business user of the organization who cannot read the
    // transformation (TL at its business unit, without inheritance) still gets 404 (existence not disclosed).
    const leadA1 = await signIn(api.app, w.leadA1.subject);
    const hidden = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: leadA1,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect(hidden.status).toBe(404);
    // The group's BO member decides (a member of the assignee group acts as the group).
    const ok = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: p.bo2.session,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic: decided for the group", subjectVersion: 1 },
    });
    expect([ok.status, ok.body.decidedBy]).toEqual([200, p.bo2.id]);
  });

  // ---------------------------------------------------------------------------------------------- D-094 / BE-B2
  // The DG1-DG3 gate and Finance approval endpoints (REQ-S10-003 A12, D-094): an ADM-only caller gets 403 `forbidden`
  // with decideApproval's text; nothing is decided or validated, and only a denial is written (audited for the
  // approval right). Every other caller's response is unchanged (status and code pinned below).

  interface Endpoint {
    readonly name: string;
    readonly permission: string;
    readonly call: (session: Session) => Promise<{ status: number; body: Body; headers: Record<string, unknown> }>;
  }
  let endpoints: Endpoint[];
  let fixtures: { baselineId: string; valuePoolId: string; caseId: string; formulaId: string };

  const FORBIDDEN_DETAIL = "You do not have permission for this action.";

  // One record per Finance approval endpoint (synthetic), created by the transformation lead.
  beforeAll(async () => {
    const T = `/api/v1/transformations/${p.transformationId}`;
    const lead = p.lead.session;
    const baseline = await call<Body>(api.app, "POST", `${T}/baselines`, {
      session: lead,
      body: {
        metric: "Synthetic cost",
        unit: "SAR",
        scope: "cost",
        value: "10",
        source: "Synthetic",
        baselineDate: "2026-06-30",
      },
    });
    expect(baseline.status, JSON.stringify(baseline.body)).toBe(201);
    const pool = await call<Body>(api.app, "POST", `${T}/value-pools`, {
      session: lead,
      body: {
        name: "Synthetic roaming bundles",
        quantificationStatus: "unquantified",
        unquantifiedReason: "Synthetic: sizing pending.",
        materiality: "material",
      },
    });
    expect(pool.status, JSON.stringify(pool.body)).toBe(201);
    const bc = await call<Body>(api.app, "POST", "/api/v1/business-cases", {
      session: lead,
      body: {
        transformationId: p.transformationId,
        level: "transformation",
        title: "Synthetic transformation case",
        sections: { strategicRationale: "Synthetic rationale.", baselineSummary: "Synthetic baseline: 1.2m SAR." },
      },
    });
    expect(bc.status, JSON.stringify(bc.body)).toBe(201);
    const bf = await call<Body>(api.app, "POST", "/api/v1/benefit-formulas", {
      session: lead,
      body: { transformationId: p.transformationId, benefitName: "Synthetic uplift", fromExample: "revenue_uplift" },
    });
    expect(bf.status, JSON.stringify(bf.body)).toBe(201);
    fixtures = { baselineId: baseline.body.id, valuePoolId: pool.body.id, caseId: bc.body.id, formulaId: bf.body.id };
    const fin = { result: "validated", note: "Synthetic" };
    endpoints = [
      {
        name: "decideGate (G1)",
        permission: "gate.decide",
        call: (session) =>
          call<Body>(api.app, "POST", `${T}/gates/G1/decision`, {
            session,
            body: { submissionNo: 1, outcome: "approved", rationale: "Synthetic" },
          }),
      },
      {
        name: "validateBaseline",
        permission: "finance.validate",
        call: (session) =>
          call<Body>(api.app, "POST", `${T}/baselines/${fixtures.baselineId}/validation`, {
            session,
            headers: ifm(1),
            body: fin,
          }),
      },
      {
        name: "validateValuePool",
        permission: "finance.validate",
        call: (session) =>
          call<Body>(api.app, "POST", `${T}/value-pools/${fixtures.valuePoolId}/validation`, {
            session,
            headers: ifm(1),
            body: fin,
          }),
      },
      {
        name: "validateBusinessCaseBaseline",
        permission: "finance.validate",
        call: (session) =>
          call<Body>(api.app, "POST", `/api/v1/business-cases/${fixtures.caseId}/baseline-validation`, {
            session,
            headers: ifm(1),
            body: fin,
          }),
      },
      {
        name: "validateBenefitFormulaVersion",
        permission: "finance.validate",
        call: (session) =>
          call<Body>(api.app, "POST", `/api/v1/benefit-formulas/${fixtures.formulaId}/versions/1/validation`, {
            session,
            headers: ifm(1),
            body: fin,
          }),
      },
    ];
  }, 60_000);

  async function nothingWritten() {
    const decisions = await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(decisions).toEqual([]);
    const versions = await Promise.all([
      api.db.selectFrom("baseline").select("version").where("id", "=", fixtures.baselineId).executeTakeFirstOrThrow(),
      api.db
        .selectFrom("value_pool")
        .select("version")
        .where("id", "=", fixtures.valuePoolId)
        .executeTakeFirstOrThrow(),
      api.db.selectFrom("business_case").select("version").where("id", "=", fixtures.caseId).executeTakeFirstOrThrow(),
    ]);
    expect(versions.map((v) => v.version)).toEqual([1, 1, 1]);
    const fv = await api.db
      .selectFrom("benefit_formula_version")
      .select("validation_status")
      .where("formula_id", "=", fixtures.formulaId)
      .where("version_no", "=", 1)
      .executeTakeFirstOrThrow();
    expect(fv.validation_status).not.toBe("validated");
  }

  it("A12: the ADM-only user gets 403 forbidden on every gate and Finance approval endpoint; only a denial is written", async () => {
    for (const e of endpoints) {
      const res = await e.call(adm.session);
      expect([e.name, res.status, res.body.code, res.body.detail]).toEqual([
        e.name,
        403,
        "forbidden",
        FORBIDDEN_DETAIL,
      ]);
      expect(await deniedOnly(res)).toEqual(["authorization.denied"]);
      const denial = (await auditOfRequest(api.db, String(res.headers["x-request-id"])))[0]!;
      // The denial names the missing approval right, on the transformation (not transformation.read).
      expect([
        e.name,
        denial.record_type,
        denial.record_id,
        String(denial.reason).endsWith(`requires ${e.permission}`),
      ]).toEqual([e.name, "transformation", p.transformationId, true]);
    }
    await nothingWritten();
  });

  it("unchanged: a reader without the approval right, AUD, a non-member, a user with no grant, and a mixed-grant user", async () => {
    // A user holding a technical-admin role AND a business role in the organization (TL at an unrelated business unit,
    // which cannot read this transformation) is not technical-admin-only: still 404, existence not disclosed.
    const mixed = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, mixed.id, "ADM_TECH", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, mixed.id, "TL", { type: "business_unit", id: w.a2 }, w.orgA.id);
    // A technical admin of ANOTHER organization only: no grant in the target organization, so still 404.
    const admB = await createUser(api.db, w.orgB.id);
    await grant(api.db, w.grantor.id, admB.id, "ADM_TECH", { type: "organization", id: w.orgB.id }, w.orgB.id);
    const sessions = {
      reader: p.lead.session, // TL of the transformation: reads, holds neither gate.decide nor finance.validate
      auditor: p.auditor.session, // AUD: reads, never writes
      nonMember: await signIn(api.app, w.officeB.subject), // TO of orgB
      noGrant: await signIn(api.app, w.nobody.subject),
      orgUnitLead: await signIn(api.app, w.leadA1.subject), // TL of orgA at a1, cannot read this transformation
      mixed: await signIn(api.app, mixed.subject),
      admOtherOrg: await signIn(api.app, admB.subject),
    };
    const got: Record<string, Record<string, [number, string]>> = {};
    for (const e of endpoints) {
      got[e.name] = {};
      for (const [who, s] of Object.entries(sessions)) {
        const res = await e.call(s);
        got[e.name]![who] = [res.status, res.body.code];
      }
    }
    // The same answers as before D-094 (DG1-DG3 behaviour): readers are refused by the approval check (403 with the
    // endpoint's own code), callers who cannot read get 404 (the read gate), or at commit time the 403 of
    // commitTimeDenial on the endpoints that re-check there; none of them gets the technical-admin 403 text.
    const hidden: [number, string] = [404, "not_found"];
    const atCommit: [number, string] = [403, "forbidden"];
    expect(got).toEqual({
      "decideGate (G1)": {
        reader: [403, "gate.not_approver"],
        auditor: [403, "gate.not_approver"],
        nonMember: hidden,
        noGrant: hidden,
        orgUnitLead: hidden,
        mixed: hidden,
        admOtherOrg: hidden,
      },
      validateBaseline: {
        reader: [403, "forbidden"],
        auditor: [403, "forbidden"],
        nonMember: hidden,
        noGrant: hidden,
        orgUnitLead: hidden,
        mixed: hidden,
        admOtherOrg: hidden,
      },
      validateValuePool: {
        reader: [403, "forbidden"],
        auditor: [403, "forbidden"],
        nonMember: hidden,
        noGrant: hidden,
        orgUnitLead: hidden,
        mixed: hidden,
        admOtherOrg: hidden,
      },
      validateBusinessCaseBaseline: {
        reader: [403, "forbidden"],
        auditor: [403, "forbidden"],
        nonMember: atCommit,
        noGrant: atCommit,
        orgUnitLead: atCommit,
        mixed: atCommit,
        admOtherOrg: atCommit,
      },
      validateBenefitFormulaVersion: {
        reader: [403, "forbidden"],
        auditor: [403, "forbidden"],
        nonMember: atCommit,
        noGrant: atCommit,
        orgUnitLead: atCommit,
        mixed: atCommit,
        admOtherOrg: atCommit,
      },
    });
    await nothingWritten();
  });
});
