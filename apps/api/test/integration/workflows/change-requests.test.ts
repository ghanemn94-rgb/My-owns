// Change control through the API (P4 slice H; ADR-0036; T-DG4-BE-L). Proofs of p4-work-split §H.3:
//  - REQ-S04-014: changing an approved G4 benefit formula (a new version through the DG3 route) creates ONE change
//    request (automatic, benefit_logic, routed to Finance), the DG3 response is unchanged, and the G4 decision and
//    snapshot read back byte-identical before and after the request is approved;
//  - REQ-S07-015: a KPI target change preview lists the bound benefit and the approved G2 decision; a direct second
//    activation is 422 kpi_version.change_request_required; after approval the old KPI version is still readable;
//  - REQ-S09-010: a material date change through a request leaves approved_date unchanged until approval while the
//    forecast is shown separately; a re-approval beyond a configured threshold is 422; budget likewise;
//  - REQ-PB-065: a business_scope request is routed to the person mapped to SP (T11 business_scope_change);
//  - the requester cannot approve (403 SoD); approving a request whose subject moved is 409 and applies nothing; the
//    submitted version's impact assessment is immutable and its SHA-256 matches; AUD 403 on every write; If-Match
//    428/409; one audit event per mutation; decimals as strings.
// All data is SYNTHETIC. Every decision is a demo BUSINESS approval by a named synthetic person; it approves nothing
// real, no job decides anything, and nothing touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  approveGate,
  approvedMilestone,
  insertAudited,
  benefitOn,
  decide,
  exampleFormula,
  kpiWithDraft,
  newFormulaVersion,
  outcomeOf,
  selectedInitiative,
  setupChangeWorld,
  type ChangeWorld,
  type Caller,
} from "./change-fixtures.ts";

let api: TestApi;
let w: World;
let c: ChangeWorld;
let admin: Session;
let outsider: Session;
const send: Caller = (m, u, o) => call(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await setupChangeWorld(api, w);
  admin = await signIn(api.app, w.admin.subject);
  outsider = await signIn(api.app, w.officeB.subject);
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const CR = () => `${c.base}/change-requests`;
/** Canonical JSON (keys sorted at every level), as the API hashes the assessment items. */
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, canonical(x)]),
        )
      : v;
const auditCount = async (recordId: string) =>
  Number(
    (
      await api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("record_id", "=", recordId)
        .executeTakeFirstOrThrow()
    ).n,
  );
const scopeBody = (initiativeId: string, extra: Record<string, unknown> = {}) => ({
  changeKind: "business_scope",
  subjectType: "initiative",
  subjectId: initiativeId,
  subjectVersion: 1,
  proposedChange: { name: { from: "Synthetic initiative", to: "Synthetic initiative, wider scope" } },
  reason: "Synthetic: the sponsor asked to widen the scope",
  ...extra,
});

describe("change-control policy (REQ-S09-010 thresholds; change_control.configure)", () => {
  it('version 0 with null thresholds when none; If-Match "0" creates; 428/409; 422 out of range; AUD 403; outside 404', async () => {
    const P = `${c.base}/change-control-policy`;
    // Outside the validating client: the contract's ETag pattern starts at "1" while this operation documents version 0
    // (a contract defect reported in the handback); every other call here is contract-checked.
    const none = await call(api.app, "GET", P, { session: c.auditor.session, contract: false });
    expect([none.status, none.body.version, none.body.materialDateShiftWorkingDays, none.headers.etag]).toEqual([
      200,
      0,
      null,
      '"0"',
    ]);
    const body = { materialDateShiftWorkingDays: 5, materialBudgetChangeRatio: "0.1" };
    expect((await send("PUT", P, { session: c.auditor.session, headers: ifm(0), body })).status).toBe(403);
    expect((await send("PUT", P, { session: c.contributor.session, headers: ifm(0), body })).status).toBe(403);
    expect((await send("PUT", P, { session: outsider, headers: ifm(0), body })).status).toBe(404);
    expect((await send("GET", P, { session: admin })).status).toBe(404);
    expect((await send("PUT", P, { session: c.lead.session, body })).status).toBe(428);
    expect((await send("PUT", P, { session: c.lead.session, headers: ifm(1), body })).status).toBe(409);
    const bad = await send("PUT", P, {
      session: c.lead.session,
      headers: ifm(0),
      body: { materialDateShiftWorkingDays: 251, materialBudgetChangeRatio: null },
    });
    expect([bad.status, bad.body.code, bad.body.errors[0].pointer, bad.body.detail]).toEqual([
      422,
      "change_control.threshold_invalid",
      "/materialDateShiftWorkingDays",
      "Thresholds are a number of working days from 0 to 250 and a ratio from 0 to 10.",
    ]);
    const badRatio = await send("PUT", P, {
      session: c.lead.session,
      headers: ifm(0),
      body: { materialDateShiftWorkingDays: null, materialBudgetChangeRatio: "10.5" },
    });
    expect([badRatio.status, badRatio.body.code]).toEqual([422, "change_control.threshold_invalid"]);
    // Not configured yet: every change is material, and the DG3 approve-date is unchanged (checked below).
    expect((await call(api.app, "GET", P, { session: c.lead.session, contract: false })).body.version).toBe(0);
  });
});

describe("change requests: create, read, edit, withdraw (S-4)", () => {
  it("draft CR-nn with ETag 1; AUD 403; outside and ADM-only 404; exact 400/409/422 refusals; one audit event per mutation", async () => {
    const ini = await selectedInitiative(api.db, c);
    expect((await send("POST", CR(), { session: c.auditor.session, body: scopeBody(ini) })).status).toBe(403);
    expect((await send("POST", CR(), { session: outsider, body: scopeBody(ini) })).status).toBe(404);
    expect((await send("POST", CR(), { session: admin, body: scopeBody(ini) })).status).toBe(404);
    const noReason = await send("POST", CR(), { session: c.lead.session, body: { ...scopeBody(ini), reason: "  " } });
    expect([noReason.status, noReason.body.errors?.[0]?.code, noReason.body.errors?.[0]?.message]).toEqual([
      400,
      "change_request.reason_required",
      "A reason is required for a change request.",
    ]);
    const mismatch = await send("POST", CR(), { session: c.lead.session, body: scopeBody(ini, { changeKind: "tom" }) });
    expect([mismatch.status, mismatch.body.code, mismatch.body.errors[0].pointer, mismatch.body.detail]).toEqual([
      422,
      "change_request.kind_subject_mismatch",
      "/subjectType",
      "This kind of change does not apply to that record.",
    ]);
    const wrongFrom = await send("POST", CR(), {
      session: c.lead.session,
      body: scopeBody(ini, { proposedChange: { name: { from: "Not the name", to: "X name" } } }),
    });
    expect([wrongFrom.status, wrongFrom.body.code]).toEqual([422, "change_request.proposed_change_invalid"]);
    const badShape = await send("POST", CR(), {
      session: c.lead.session,
      body: scopeBody(ini, { proposedChange: { budgetAmount: { from: "1", to: "2" } } }),
    });
    expect([badShape.status, badShape.body.code, badShape.body.detail]).toEqual([
      422,
      "change_request.proposed_change_invalid",
      "The proposed change does not match the fields of this kind of change.",
    ]);
    const past = await send("POST", CR(), {
      session: c.lead.session,
      body: scopeBody(ini, {
        proposedChange: { name: { from: "Synthetic initiative", to: "Synthetic later" }, effectiveFrom: "2020-01-01" },
      }),
    });
    expect([past.status, past.body.code, past.body.detail]).toEqual([
      422,
      "change_request.retrospective_not_supported",
      "A retrospective restatement is not supported; changes take effect from now on.",
    ]);
    const stale = await send("POST", CR(), { session: c.lead.session, body: scopeBody(ini, { subjectVersion: 9 }) });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);

    const created = await send("POST", CR(), { session: c.lead.session, body: scopeBody(ini) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect([created.body.status, created.body.origin, created.body.version, created.headers.etag]).toEqual([
      "draft",
      "manual",
      1,
      '"1"',
    ]);
    expect(created.body.code).toMatch(/^CR-[0-9]{2,}$/);
    expect(created.headers.location).toBe(`${CR()}/${created.body.id}`);
    expect(await auditCount(created.body.id)).toBe(1);
    const dup = await send("POST", CR(), { session: c.bo.session, body: scopeBody(ini) });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "change_request.already_open",
      `This record already has an open change request (${created.body.code}).`,
    ]);

    const I = `${CR()}/${created.body.id}`;
    const read = await send("GET", I, { session: c.auditor.session });
    expect([read.status, read.body.approvalId, read.headers.etag]).toEqual([200, null, '"1"']);
    expect((await send("GET", I, { session: outsider })).status).toBe(404);
    expect((await send("GET", I, { session: admin })).status).toBe(404);
    const list = await send("GET", `${CR()}?status=draft&kind=business_scope`, { session: c.auditor.session });
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(created.body.id);

    const edit = { reason: "Synthetic: a sharper reason" };
    expect((await send("PATCH", I, { session: c.auditor.session, headers: ifm(1), body: edit })).status).toBe(403);
    expect((await send("PATCH", I, { session: c.lead.session, body: edit })).status).toBe(428);
    expect((await send("PATCH", I, { session: c.lead.session, headers: ifm(7), body: edit })).status).toBe(409);
    const notMine = await send("PATCH", I, { session: c.contributor.session, headers: ifm(1), body: edit });
    expect([notMine.status, notMine.body.code, notMine.body.detail]).toEqual([
      403,
      "change_request.not_requester",
      "Only the requester or the transformation lead can change this request.",
    ]);
    const byOffice = await send("PATCH", I, { session: c.office.session, headers: ifm(1), body: edit });
    expect([byOffice.status, byOffice.body.version, byOffice.body.reason]).toEqual([200, 2, edit.reason]);
    expect(await auditCount(created.body.id)).toBe(2);

    const W = `${I}/withdraw`;
    expect((await send("POST", W, { session: c.auditor.session, headers: ifm(2) })).status).toBe(403);
    expect((await send("POST", W, { session: c.lead.session })).status).toBe(428);
    expect((await send("POST", W, { session: c.lead.session, headers: ifm(1) })).status).toBe(409);
    const withdrawn = await send("POST", W, { session: c.lead.session, headers: ifm(2) });
    expect([withdrawn.status, withdrawn.body.status, withdrawn.body.withdrawnAt === null]).toEqual([
      200,
      "withdrawn",
      false,
    ]);
    const again = await send("POST", W, { session: c.lead.session, headers: ifm(3) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "change_request.not_withdrawable",
      "A decided change request cannot be withdrawn.",
    ]);
    const late = await send("PATCH", I, { session: c.lead.session, headers: ifm(3), body: edit });
    expect([late.status, late.body.code]).toEqual([422, "change_request.not_editable"]);
    expect(await auditCount(created.body.id)).toBe(3);
  });

  it("a record that is not approved yet is edited directly: 422 subject_not_approved", async () => {
    const ini = await selectedInitiative(api.db, c);
    // A milestone without an approved date is a draft for change control.
    const draft = await insertAudited(api.db, c, "milestone", {
      initiative_id: ini,
      title: "Synthetic draft milestone",
    });
    const res = await send("POST", CR(), {
      session: c.lead.session,
      body: {
        changeKind: "schedule_rebaseline",
        subjectType: "milestone",
        subjectId: draft,
        subjectVersion: 1,
        proposedChange: { approvedDate: { from: null, to: "2027-01-10" } },
        reason: "Synthetic rebaseline",
      },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "change_request.subject_not_approved",
      "Only an approved record goes through change control; edit the draft directly.",
    ]);
  });
});

describe("REQ-PB-065 routing, SoD and the frozen impact assessment", () => {
  it("a business_scope request is routed to the person mapped to SP; the requester cannot decide; SP's approval applies it", async () => {
    const ini = await selectedInitiative(api.db, c);
    const created = await send("POST", CR(), { session: c.lead.session, body: scopeBody(ini) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const S = `${CR()}/${created.body.id}/submit`;
    expect((await send("POST", S, { session: c.auditor.session, headers: ifm(1) })).status).toBe(403);
    expect((await send("POST", S, { session: c.lead.session })).status).toBe(428);
    expect((await send("POST", S, { session: c.lead.session, headers: ifm(5) })).status).toBe(409);
    const submitted = await send("POST", S, { session: c.lead.session, headers: ifm(1) });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body).toMatchObject({
      status: "submitted",
      materiality: "material",
      routePartyCode: "SP",
      decisionRightId: c.rights["business_scope_change"],
      submittedBy: c.lead.id,
      version: 2,
    });
    const approval = await send("GET", `/api/v1/approvals/${submitted.body.approvalId}`, { session: c.lead.session });
    expect(approval.body).toMatchObject({
      approvalType: "change_request",
      subjectId: created.body.id,
      subjectVersion: 2,
      assignee: { partyCode: "SP", userId: c.sponsor.id, groupId: null },
      status: "pending",
    });
    // The impact assessment of the submitted version: frozen, its SHA-256 over the canonical items.
    const ia = await send("GET", `${c.base}/impact-assessments/${submitted.body.currentImpactAssessmentId}`, {
      session: c.auditor.session,
    });
    expect([ia.status, ia.body.changeRequestVersion, ia.body.itemCount]).toEqual([200, 2, ia.body.items.length]);
    expect(
      createHash("sha256")
        .update(JSON.stringify(canonical(ia.body.items)))
        .digest("hex"),
    ).toBe(ia.body.contentSha256);
    expect(
      ia.body.items.some(
        (i: { itemType: string; recordId: string }) => i.itemType === "initiative" && i.recordId === ini,
      ),
    ).toBe(true);
    await expect(
      api.db.updateTable("impact_assessment").set({ item_count: 0 }).where("id", "=", ia.body.id).execute(),
    ).rejects.toThrow(/permission denied|append-only/);
    const list = await send("GET", `${CR()}/${created.body.id}/impact-assessments`, { session: c.auditor.session });
    expect(list.body.items.map((x: { id: string }) => x.id)).toEqual([ia.body.id]);
    // While submitted the content is frozen.
    const frozen = await send("PATCH", `${CR()}/${created.body.id}`, {
      session: c.lead.session,
      headers: ifm(2),
      body: { reason: "Synthetic change after submission" },
    });
    expect([frozen.status, frozen.body.code]).toEqual([422, "change_request.not_editable"]);
    // The requester (TL) and a non-assignee cannot decide.
    expect((await decide(send, submitted.body.approvalId, c.lead.session)).status).toBe(403);
    expect((await decide(send, submitted.body.approvalId, c.bo.session)).status).toBe(403);
    expect((await decide(send, submitted.body.approvalId, admin)).status).toBe(403);
    const ok = await decide(send, submitted.body.approvalId, c.sponsor.session);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = await send("GET", `${CR()}/${created.body.id}`, { session: c.auditor.session });
    expect(after.body).toMatchObject({
      status: "approved",
      appliedRecordType: "initiative",
      appliedRecordId: ini,
      appliedVersion: 2,
    });
    const row = await api.db
      .selectFrom("initiative")
      .select(["name", "version"])
      .where("id", "=", ini)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ name: "Synthetic initiative, wider scope", version: 2 });
    // The assessment the approver saw is unchanged after the decision.
    const ia2 = await send("GET", `${c.base}/impact-assessments/${ia.body.id}`, { session: c.auditor.session });
    expect(ia2.body).toEqual(ia.body);
  });
});

describe("REQ-S09-010: schedule rebaseline through change control", () => {
  it("approved_date stays until a person approves; the forecast is shown separately; a moved subject is 409 and applies nothing", async () => {
    const ini = await selectedInitiative(api.db, c);
    const mid = await approvedMilestone(api.db, c, ini, "2026-11-02", "2026-11-30");
    const body = {
      changeKind: "schedule_rebaseline",
      subjectType: "milestone",
      subjectId: mid,
      subjectVersion: 1,
      proposedChange: { approvedDate: { from: "2026-11-02", to: "2026-11-30" } },
      reason: "Synthetic: vendor delay, rebaseline to the forecast",
    };
    const preview = await send("POST", `${CR()}/impact-preview`, { session: c.auditor.session, body });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.materiality).toBe("material");
    expect(
      preview.body.items.map((i: { itemType: string; detail: { area?: string } }) => i.detail.area ?? i.itemType),
    ).toEqual(expect.arrayContaining(["initiative", "T10.portfolio", "T10.dependencies"]));
    const created = await send("POST", CR(), { session: c.lead.session, body });
    const submitted = await send("POST", `${CR()}/${created.body.id}/submit`, {
      session: c.lead.session,
      headers: ifm(1),
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.routePartyCode).toBe("SP");
    const pending = await send("GET", `/api/v1/milestones/${mid}`, { session: c.auditor.session });
    expect([pending.body.approvedDate, pending.body.forecastDate]).toEqual(["2026-11-02", "2026-11-30"]);
    const ok = await decide(send, submitted.body.approvalId, c.sponsor.session);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const done = await send("GET", `/api/v1/milestones/${mid}`, { session: c.auditor.session });
    expect([done.body.approvedDate, done.body.forecastDate]).toEqual(["2026-11-30", "2026-11-30"]);
    const m = await api.db
      .selectFrom("milestone")
      .select(["approved_by", "approval_reason"])
      .where("id", "=", mid)
      .executeTakeFirstOrThrow();
    expect(m.approved_by).toBe(c.sponsor.id);
    expect(m.approval_reason).toBe(`Change request ${created.body.code}: ${body.reason}`);

    // A request whose milestone moves after submission: the approval decision is 409 and nothing is applied.
    const mid2 = await approvedMilestone(api.db, c, ini, "2026-11-02", "2026-12-15");
    const cr2 = await send("POST", CR(), {
      session: c.lead.session,
      body: { ...body, subjectId: mid2, proposedChange: { approvedDate: { from: "2026-11-02", to: "2026-12-15" } } },
    });
    const sub2 = await send("POST", `${CR()}/${cr2.body.id}/submit`, { session: c.lead.session, headers: ifm(1) });
    expect(sub2.status, JSON.stringify(sub2.body)).toBe(200);
    const moved = await send("PATCH", `/api/v1/milestones/${mid2}`, {
      session: c.lead.session,
      headers: ifm(1),
      body: { forecastDate: "2026-12-20" },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const refused = await decide(send, sub2.body.approvalId, c.sponsor.session);
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      409,
      "change_request.subject_moved",
      "The record changed after this request was submitted; withdraw it and raise a new one.",
    ]);
    const still = await api.db
      .selectFrom("milestone")
      .select("approved_date")
      .where("id", "=", mid2)
      .executeTakeFirstOrThrow();
    expect(still.approved_date).toBe("2026-11-02");
    expect((await send("GET", `${CR()}/${cr2.body.id}`, { session: c.lead.session })).body.status).toBe("submitted");
  });

  it("with no policy the DG3 re-approval is unchanged; beyond a configured threshold it is 422, within it 200; budget likewise", async () => {
    const t = await setupChangeWorld(api, w);
    const ini = await selectedInitiative(api.db, t);
    const mid = await approvedMilestone(api.db, t, ini, "2026-11-02", null);
    const A = `/api/v1/milestones/${mid}/approve-date`;
    const free = await send("POST", A, {
      session: t.lead.session,
      headers: ifm(1),
      body: { approvedDate: "2027-03-01", reason: "Synthetic re-approval without a policy" },
    });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    const P = `${t.base}/change-control-policy`;
    const put = await send("PUT", P, {
      session: t.lead.session,
      headers: ifm(0),
      body: { materialDateShiftWorkingDays: 5, materialBudgetChangeRatio: "0.1", note: "Synthetic team thresholds" },
    });
    expect([put.status, put.body.version, put.body.materialBudgetChangeRatio, put.headers.etag]).toEqual([
      200,
      1,
      "0.100000",
      '"1"',
    ]);
    const far = await send("POST", A, {
      session: t.lead.session,
      headers: ifm(2),
      body: { approvedDate: "2027-04-30", reason: "Synthetic big slip" },
    });
    expect([far.status, far.body.code, far.body.detail]).toEqual([
      422,
      "milestone.rebaseline_requires_change_request",
      "This date change exceeds the material threshold; raise a change request to rebaseline it.",
    ]);
    const near = await send("POST", A, {
      session: t.lead.session,
      headers: ifm(2),
      body: { approvedDate: "2027-03-03", reason: "Synthetic small slip" },
    });
    expect(near.status, JSON.stringify(near.body)).toBe(200);

    const line = await send("POST", `/api/v1/initiatives/${ini}/budget-lines`, {
      session: t.lead.session,
      body: { label: "Synthetic licences", budgetAmount: "1000" },
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);
    const L = `/api/v1/budget-lines/${line.body.id}`;
    const big = await send("PATCH", L, { session: t.lead.session, headers: ifm(1), body: { budgetAmount: "1200" } });
    expect([big.status, big.body.code, big.body.detail]).toEqual([
      422,
      "budget_line.rebaseline_requires_change_request",
      "This budget change exceeds the material threshold; raise a change request to rebaseline it.",
    ]);
    const small = await send("PATCH", L, {
      session: t.lead.session,
      headers: ifm(1),
      body: { budgetAmount: "1050.5" },
    });
    expect([small.status, small.body.budgetAmount]).toEqual([200, "1050.5000"]);
    // The rebaseline goes through a request: the preview computes the ratio with decimals (strings), never floats.
    const preview = await send("POST", `${t.base}/change-requests/impact-preview`, {
      session: t.lead.session,
      body: {
        changeKind: "budget_rebaseline",
        subjectType: "budget_line",
        subjectId: line.body.id,
        subjectVersion: 2,
        proposedChange: { budgetAmount: { from: "1050.5", to: "1155.55" }, currency: "SAR" },
        reason: "Synthetic budget rebaseline",
      },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.materialityBasis).toEqual({
      rule: "budget_ratio",
      ratio: "0.100000",
      threshold: "0.100000",
      reason: null,
    });
    expect(preview.body.materiality).toBe("not_material");
  });
});

describe("REQ-S07-015: a KPI target change (preview, refusal, approval, the old version readable)", () => {
  it("the preview lists the bound benefit and the approved G2 decision; a direct second activation is 422; after BO's approval v2 is active and v1 readable", async () => {
    const k = await kpiWithDraft(send, c);
    const outcomeId = await outcomeOf(api.db, c, k.kpiId);
    const benefitId = await benefitOn(send, c, k.kpiId);
    const g2 = await approveGate(api.db, c, "G2");
    const direct = await send("POST", `${c.base}/kpi-versions/${k.v2.id}/activate`, {
      session: c.kds.session,
      headers: ifm(k.v2.version),
    });
    expect([direct.status, direct.body.code, direct.body.detail]).toEqual([
      422,
      "kpi_version.change_request_required",
      "This KPI already has an active version; changing its definition, baseline or target needs an approved change request.",
    ]);
    const body = {
      changeKind: "target",
      subjectType: "kpi_definition",
      subjectId: k.kpiId,
      subjectVersion: k.kpiVersion,
      proposedRecordType: "kpi_version",
      proposedRecordId: k.v2.id,
      proposedChange: { targetValue: { from: "100", to: "120" } },
      reason: "Synthetic: a stretch target agreed by the business owner",
    };
    const preview = await send("POST", `${CR()}/impact-preview`, { session: c.auditor.session, body });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const items = preview.body.items as {
      itemType: string;
      recordId: string | null;
      effect: string;
      gateDecisionId: string | null;
      detail: Record<string, unknown>;
    }[];
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemType: "outcome", recordId: outcomeId }),
        expect.objectContaining({ itemType: "benefit", recordId: benefitId, effect: "value_changes" }),
        expect.objectContaining({
          itemType: "gate",
          recordId: g2.submissionId,
          gateDecisionId: g2.gateDecisionId,
          effect: "reapproval_required",
        }),
        expect.objectContaining({ itemType: "report", detail: { area: "T10.outcomes" } }),
      ]),
    );
    expect(preview.body.hiddenItemCount).toBe(0);

    // A BO raises it, and the routed assignee is BO (mapped to c.bo): the requester cannot decide (SoD).
    const own = await send("POST", CR(), { session: c.bo.session, body });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    const ownSub = await send("POST", `${CR()}/${own.body.id}/submit`, { session: c.bo.session, headers: ifm(1) });
    expect([ownSub.status, ownSub.body.routePartyCode]).toEqual([200, "BO"]);
    const sod = await decide(send, ownSub.body.approvalId, c.bo.session);
    expect([sod.status, sod.body.code]).toEqual([403, "approval.sod_requester"]);
    // Withdrawing a request in approval goes through its approval; the request follows in the same transaction.
    const viaCr = await send("POST", `${CR()}/${own.body.id}/withdraw`, { session: c.bo.session, headers: ifm(2) });
    expect([viaCr.status, viaCr.body.code]).toEqual([422, "change_request.withdraw_via_approval"]);
    const appr = await send("GET", `/api/v1/approvals/${ownSub.body.approvalId}`, { session: c.bo.session });
    const wd = await send("POST", `/api/v1/approvals/${ownSub.body.approvalId}/withdraw`, {
      session: c.bo.session,
      headers: ifm(appr.body.version),
      body: { reason: "Synthetic: raised by the wrong person" },
    });
    expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    expect((await send("GET", `${CR()}/${own.body.id}`, { session: c.bo.session })).body.status).toBe("withdrawn");

    const created = await send("POST", CR(), { session: c.lead.session, body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const submitted = await send("POST", `${CR()}/${created.body.id}/submit`, {
      session: c.lead.session,
      headers: ifm(1),
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const ia = await send("GET", `${c.base}/impact-assessments/${submitted.body.currentImpactAssessmentId}`, {
      session: c.auditor.session,
    });
    expect(ia.body.items.map((i: { itemType: string }) => i.itemType)).toEqual(
      preview.body.items.map((i: { itemType: string }) => i.itemType),
    );
    const ok = await decide(send, submitted.body.approvalId, c.bo.session);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = await send("GET", `${CR()}/${created.body.id}`, { session: c.auditor.session });
    expect([after.body.status, after.body.appliedRecordType, after.body.appliedRecordId]).toEqual([
      "approved",
      "kpi_version",
      k.v2.id,
    ]);
    const v1 = await send("GET", `${c.base}/kpi-versions/${k.v1.id}`, { session: c.auditor.session });
    const v2 = await send("GET", `${c.base}/kpi-versions/${k.v2.id}`, { session: c.auditor.session });
    expect([v1.status, v1.body.status, v1.body.targetValue]).toEqual([200, "superseded", k.v1.targetValue]);
    expect([v2.body.status, v2.body.targetValue]).toEqual(["active", k.v2.targetValue]);
    // Activation through the approved request: one audit event each (supersede, activate) and one outbox event.
    const actions = async (id: string) =>
      (
        await api.db.selectFrom("audit_event").select("action").where("record_id", "=", id).orderBy("seq").execute()
      ).map((a) => a.action);
    expect(await actions(k.v2.id)).toEqual(["kpi_version.create", "kpi_version.activate"]);
    expect(await actions(k.v1.id)).toEqual(["kpi_version.create", "kpi_version.activate", "kpi_version.supersede"]);
    const events = await api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", k.v2.id).execute();
    expect(events.map((e) => [e.event_type, e.idempotency_key])).toEqual([
      ["kpi.version_activated", `kpi.version_activated:${k.v2.id}:2`],
    ]);
    expect(events[0]!.payload).toMatchObject({ kpiVersionId: k.v2.id, supersededKpiVersionId: k.v1.id });
    expect(await actions(created.body.id)).toEqual([
      "change_request.create",
      "change_request.submit",
      "change_request.approve",
    ]);
    // The G2 approval is preserved: its gate stays approved and its rows are unchanged.
    const gate = await api.db
      .selectFrom("gate_instance")
      .select("status")
      .where("transformation_id", "=", c.transformationId)
      .where("gate_code", "=", "G2")
      .executeTakeFirstOrThrow();
    expect(gate.status).toBe("approved");
  });
});

describe("REQ-S04-014: a new version of an approved G4 benefit formula creates one change request", () => {
  it("one automatic benefit_logic request routed to Finance; the DG3 response unchanged; G4 decision and snapshot byte-identical", async () => {
    const pinned = await exampleFormula(send, c);
    const free = await exampleFormula(send, c);
    const g4 = await approveGate(api.db, c, "G4", {
      g4: { formulaVersions: [{ formulaId: pinned.id, versionNo: 1, validation: "validated" }] },
    });
    const gateRows = async () => ({
      submission: await api.db
        .selectFrom("gate_submission")
        .selectAll()
        .where("id", "=", g4.submissionId)
        .executeTakeFirstOrThrow(),
      decision: await api.db
        .selectFrom("gate_decision")
        .selectAll()
        .where("id", "=", g4.gateDecisionId)
        .executeTakeFirstOrThrow(),
      api: (await send("GET", `${c.base}/gates/G4/submissions/1`, { session: c.auditor.session })).body,
    });
    const before = JSON.stringify(await gateRows());

    const control = await newFormulaVersion(send, c, free);
    expect(control.status, JSON.stringify(control.body)).toBe(201);
    const v2 = await newFormulaVersion(send, c, pinned);
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    // The DG3 response is unchanged: the same members as an unpinned formula's new version, and no extra header.
    expect(Object.keys(v2.body).sort()).toEqual(Object.keys(control.body).sort());
    expect(Object.keys(v2.headers).sort()).toEqual(Object.keys(control.headers).sort());

    const list = await send("GET", `${CR()}?kind=benefit_logic`, { session: c.auditor.session });
    const mine = list.body.items.filter((x: { subjectId: string }) => x.subjectId === pinned.id);
    expect(list.body.items.filter((x: { subjectId: string }) => x.subjectId === free.id)).toEqual([]);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      origin: "automatic",
      changeKind: "benefit_logic",
      status: "submitted",
      raisedBy: c.lead.id,
      routePartyCode: "FIN",
      proposedRecordType: "benefit_formula_version",
      proposedRecordId: v2.body.id,
      proposedChange: { fromVersionNo: 1, toVersionNo: 2 },
    });
    const ia = await send("GET", `${c.base}/impact-assessments/${mine[0].currentImpactAssessmentId}`, {
      session: c.auditor.session,
    });
    expect(ia.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemType: "gate",
          gateSubmissionId: g4.submissionId,
          gateDecisionId: g4.gateDecisionId,
        }),
      ]),
    );
    // The editor (requester) cannot decide; Finance approves: the approved basis is version 2, no DG3 row changes.
    expect((await decide(send, mine[0].approvalId, c.lead.session)).status).toBe(403);
    const ok = await decide(send, mine[0].approvalId, c.fin.session);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const done = await send("GET", `${CR()}/${mine[0].id}`, { session: c.auditor.session });
    expect([done.body.status, done.body.appliedRecordType, done.body.appliedRecordId]).toEqual([
      "approved",
      "benefit_formula_version",
      v2.body.id,
    ]);
    expect(JSON.stringify(await gateRows())).toBe(before);
    // A further version raises one new request (the previous one is decided); while it is open, a third raises none.
    const f2 = (await send("GET", `/api/v1/benefit-formulas/${pinned.id}`, { session: c.lead.session })).body;
    expect((await newFormulaVersion(send, c, f2, "Synthetic: another assumption")).status).toBe(201);
    const f3 = (await send("GET", `/api/v1/benefit-formulas/${pinned.id}`, { session: c.lead.session })).body;
    expect((await newFormulaVersion(send, c, f3, "Synthetic: a third assumption")).status).toBe(201);
    const again = await send("GET", `${CR()}?kind=benefit_logic`, { session: c.auditor.session });
    const open = again.body.items.filter((x: { subjectId: string; status: string }) => x.subjectId === pinned.id);
    expect(open.map((x: { status: string }) => x.status).sort()).toEqual(["approved", "submitted"]);
    // Finance decides the open one (on version 3) after version 4 exists: 409 subject_moved, nothing applied.
    const pending = open.find((x: { status: string }) => x.status === "submitted");
    const moved = await decide(send, pending.approvalId, c.fin.session);
    expect([moved.status, moved.body.code]).toEqual([409, "change_request.subject_moved"]);
    expect(JSON.stringify(await gateRows())).toBe(before);
  });
});

describe("S-4 commit-time authorization and S-1 free text", () => {
  const revokedMidRequest = (userId: string, sendIt: () => Promise<Res>) =>
    afterIdentity(api, userId, sendIt, () => revokeAll(api, w.grantor.id, userId));
  const crCount = async () =>
    (
      await api.db
        .selectFrom("change_request")
        .select("id")
        .where("transformation_id", "=", c.transformationId)
        .execute()
    ).length;

  it("raise, edit, submit, withdraw and the policy: a TL revoked mid-request gets 403 and nothing is written", async () => {
    const ini = await selectedInitiative(api.db, c);
    const before = await crCount();
    const t1 = await person(api, w, c.transformationId, "TL");
    const created = await revokedMidRequest(t1.id, () =>
      call(api.app, "POST", CR(), { session: t1.session, body: scopeBody(ini), contract: false }),
    );
    expect(created.status).toBe(403);
    expect(await crCount()).toBe(before);
    const cr = await send("POST", CR(), { session: c.lead.session, body: scopeBody(ini) });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    for (const [method, suffix, body] of [
      ["PATCH", "", { reason: "Synthetic revoked edit" }],
      ["POST", "/submit", undefined],
      ["POST", "/withdraw", undefined],
    ] as const) {
      const t = await person(api, w, c.transformationId, "TL");
      const res = await revokedMidRequest(t.id, () =>
        call(api.app, method, `${CR()}/${cr.body.id}${suffix}`, {
          session: t.session,
          headers: ifm(1),
          ...(body !== undefined ? { body } : {}),
          contract: false,
        }),
      );
      expect([suffix, res.status]).toEqual([suffix, 403]);
    }
    const unchanged = await send("GET", `${CR()}/${cr.body.id}`, { session: c.lead.session });
    expect([unchanged.body.status, unchanged.body.version, unchanged.body.reason]).toEqual([
      "draft",
      1,
      scopeBody(ini).reason,
    ]);
    const t4 = await person(api, w, c.transformationId, "TL");
    const policy = await revokedMidRequest(t4.id, () =>
      call(api.app, "PUT", `${c.base}/change-control-policy`, {
        session: t4.session,
        headers: ifm(0),
        body: { materialDateShiftWorkingDays: 3, materialBudgetChangeRatio: null },
        contract: false,
      }),
    );
    expect(policy.status).toBe(403);
    expect(
      await api.db
        .selectFrom("change_control_policy")
        .select("id")
        .where("transformation_id", "=", c.transformationId)
        .execute(),
    ).toEqual([]);
  });

  it("free text: a reason with U+0000 is 400 validation.invalid_character at /reason; nothing written", async () => {
    const ini = await selectedInitiative(api.db, c);
    const before = await crCount();
    const res = await send("POST", CR(), {
      session: c.lead.session,
      body: scopeBody(ini, { reason: "Synthetic\u0000reason" }),
    });
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { pointer: string; code: string }) => [e.pointer, e.code])).toContainEqual([
      "/reason",
      "validation.invalid_character",
    ]);
    expect(await crCount()).toBe(before);
  });
});
