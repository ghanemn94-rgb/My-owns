// Impact preview and frozen impact assessments (P4 slice H; ADR-0036 §2, §4, §5, §9; T-DG4-BE-L; REQ-S04-014,
// REQ-S07-015). Proofs:
//  - the item derivation is a pure function of the facts: the same facts give the same items and the same SHA-256;
//  - a TOM change after G3 approval lists the TOM gap of that dimension, the G3 gate item naming the preserved decision
//    (reapproval_required) and the T10 Portfolio area; it is routed through T11 target_state_design to BO;
//  - a returned request (changes requested) is edited, submitted again with a NEW frozen assessment for the new version
//    (one per submitted version, the first unchanged), resubmitted through the approval engine and approved;
//  - a charter scope change after G1 approval writes a new charter version and keeps the earlier one readable;
//  - reads: AUD 200; another organization's office and the ADM-only technical admin 404; an assessment of another
//    transformation is 404 through this one.
// All data is SYNTHETIC; every decision is a demo BUSINESS approval by a named synthetic person and approves nothing
// real; nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveImpactItems, impactContentSha256, type ImpactFacts } from "../../../src/modules/workflows/impact.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { setGateStatus } from "../portfolio/fixtures.ts";
import {
  approveGate,
  decide,
  insertAudited,
  RATIONALE,
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

describe("the item derivation (pure)", () => {
  it("the same facts give the same items and SHA-256; an approved gate is reapproval_required naming its decision", () => {
    const facts: ImpactFacts = {
      changeKind: "target",
      subjectType: "kpi_definition",
      subject: { id: "01920000-0000-7000-8000-0000000000a1", code: null, label: "Synthetic KPI" },
      outcomes: [{ id: "01920000-0000-7000-8000-0000000000a2", code: null, label: "Synthetic outcome" }],
      dependentKpis: [],
      benefits: [{ id: "01920000-0000-7000-8000-0000000000a3", code: "B01", label: "Synthetic benefit" }],
      benefitFormulas: [],
      initiatives: [],
      dependentInitiatives: [],
      businessCaseLines: [],
      tomGaps: [],
      decisions: [],
      gates: [
        {
          gateCode: "G2",
          status: "approved",
          submissionId: "01920000-0000-7000-8000-0000000000a4",
          submissionNo: 1,
          decisionId: "01920000-0000-7000-8000-0000000000a5",
        },
      ],
    };
    const a = deriveImpactItems(facts);
    const b = deriveImpactItems(structuredClone(facts));
    expect(a).toEqual(b);
    expect(impactContentSha256(a)).toBe(impactContentSha256(b));
    expect(impactContentSha256(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(a.map((i) => [i.ordinal, i.itemType, i.effect])).toEqual([
      [1, "outcome", "value_changes"],
      [2, "benefit", "value_changes"],
      [3, "gate", "reapproval_required"],
      [4, "report", "informational"],
    ]);
    expect(a[2]).toMatchObject({
      gateSubmissionId: "01920000-0000-7000-8000-0000000000a4",
      gateDecisionId: "01920000-0000-7000-8000-0000000000a5",
    });
    expect(a[3]!.detail).toEqual({ area: "T10.outcomes" });
  });
});

describe("TOM change after G3: preview, T11 routing, a returned request with one assessment per submitted version", () => {
  it("lists the gap, the preserved G3 decision and T10 Portfolio; changes requested -> edit -> submit -> resubmit -> approve", async () => {
    const cell = await api.db
      .selectFrom("tom_canvas_cell")
      .select(["id", "dimension_code", "version", "target_design"])
      .where("transformation_id", "=", c.transformationId)
      .orderBy("dimension_code")
      .executeTakeFirstOrThrow();
    const gapId = await insertAudited(api.db, c, "tom_gap", {
      dimension_code: cell.dimension_code,
      gap: "Synthetic gap: manual hand-offs",
    });
    const g3 = await approveGate(api.db, c, "G3");
    const CR = `${c.base}/change-requests`;
    const body = {
      changeKind: "tom",
      subjectType: "tom_canvas_cell",
      subjectId: cell.id,
      subjectVersion: cell.version,
      proposedChange: { targetDesign: { from: cell.target_design, to: "Synthetic target: one digital hand-off" } },
      reason: "Synthetic: the design authority simplified the target",
    };
    const preview = await send("POST", `${CR}/impact-preview`, { session: c.auditor.session, body });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recordType: "tom_gap", recordId: gapId }),
        expect.objectContaining({ itemType: "gate", gateDecisionId: g3.gateDecisionId, effect: "reapproval_required" }),
        expect.objectContaining({ itemType: "report", detail: { area: "T10.portfolio" } }),
      ]),
    );
    expect((await send("POST", `${CR}/impact-preview`, { session: outsider, body })).status).toBe(404);
    expect((await send("POST", `${CR}/impact-preview`, { session: admin, body })).status).toBe(404);

    const created = await send("POST", CR, { session: c.lead.session, body });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const I = `${CR}/${created.body.id}`;
    const live = await send("GET", `${I}/impact-preview`, { session: c.auditor.session });
    expect(live.body.items).toEqual(preview.body.items);
    const first = await send("POST", `${I}/submit`, { session: c.lead.session, headers: ifm(1) });
    expect([first.status, first.body.routePartyCode, first.body.decisionRightId]).toEqual([
      200,
      "BO",
      c.rights["target_state_design"],
    ]);
    const firstIa = (
      await send("GET", `${c.base}/impact-assessments/${first.body.currentImpactAssessmentId}`, {
        session: c.auditor.session,
      })
    ).body;

    // BO returns it for changes: the request is changes_requested; the requester edits and submits a new version.
    const returned = await decide(send, first.body.approvalId, c.bo.session, "request_changes");
    expect(returned.status, JSON.stringify(returned.body)).toBe(200);
    const r1 = await send("GET", I, { session: c.lead.session });
    expect([r1.body.status, r1.body.version]).toEqual(["changes_requested", 3]);
    const edited = await send("PATCH", I, {
      session: c.lead.session,
      headers: ifm(3),
      body: { proposedChange: { targetDesign: { from: cell.target_design, to: "Synthetic target: two hand-offs" } } },
    });
    expect([edited.status, edited.body.version]).toEqual([200, 4]);
    const second = await send("POST", `${I}/submit`, { session: c.lead.session, headers: ifm(4) });
    expect([second.status, second.body.status, second.body.version]).toEqual([200, "submitted", 5]);
    expect(second.body.currentImpactAssessmentId).not.toBe(first.body.currentImpactAssessmentId);
    const list = await send("GET", `${I}/impact-assessments`, { session: c.auditor.session });
    expect(list.body.items.map((x: { changeRequestVersion: number }) => x.changeRequestVersion)).toEqual([2, 5]);
    expect(list.body.items[0]).toEqual(firstIa);
    // The approval engine's resubmission on the request's new version (ADR-0036 §4), then BO approves.
    const appr = (await send("GET", `/api/v1/approvals/${first.body.approvalId}`, { session: c.lead.session })).body;
    const resubmitted = await send("POST", `/api/v1/approvals/${first.body.approvalId}/resubmit`, {
      session: c.lead.session,
      headers: ifm(appr.version),
      body: { subjectVersion: 5 },
    });
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);
    const ok = await decide(send, first.body.approvalId, c.bo.session);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = await api.db
      .selectFrom("tom_canvas_cell")
      .select(["target_design", "version"])
      .where("id", "=", cell.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual({ target_design: "Synthetic target: two hand-offs", version: cell.version + 1 });
    const gate = await api.db
      .selectFrom("gate_decision")
      .selectAll()
      .where("id", "=", g3.gateDecisionId)
      .executeTakeFirstOrThrow();
    expect([gate.outcome, gate.rationale]).toEqual(["approved", RATIONALE]);
  });
});

describe("charter scope change after G1: a new charter version; the earlier one stays readable", () => {
  it("SP approves; charter version + 1 with its charter_version snapshot; reads are scoped", async () => {
    const made = await send("POST", `${c.base}/charter`, {
      session: c.lead.session,
      body: { inScope: "Synthetic: prepaid consumer base", outOfScope: "Synthetic: enterprise accounts" },
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const charter = await api.db
      .selectFrom("charter")
      .select(["id", "version", "in_scope"])
      .where("transformation_id", "=", c.transformationId)
      .executeTakeFirstOrThrow();
    // G1 staged approved by status (an approved G1 decision row needs the three leadership agreements, not under test).
    await setGateStatus(api, c, "G1", "approved");
    const CR = `${c.base}/change-requests`;
    const created = await send("POST", CR, {
      session: c.lead.session,
      body: {
        changeKind: "business_scope",
        subjectType: "charter",
        subjectId: charter.id,
        subjectVersion: charter.version,
        proposedChange: { scopeIn: { from: charter.in_scope, to: "Synthetic: prepaid and postpaid consumer base" } },
        reason: "Synthetic: the sponsor widened the charter scope",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const submitted = await send("POST", `${CR}/${created.body.id}/submit`, {
      session: c.lead.session,
      headers: ifm(1),
    });
    expect([submitted.status, submitted.body.routePartyCode]).toEqual([200, "SP"]);
    const ia = submitted.body.currentImpactAssessmentId as string;
    for (const s of [outsider, admin])
      expect((await send("GET", `${c.base}/impact-assessments/${ia}`, { session: s })).status).toBe(404);
    const other = await setupChangeWorld(api, w);
    expect(
      (await send("GET", `${other.base}/impact-assessments/${ia}`, { session: other.auditor.session })).status,
    ).toBe(404);
    expect(
      (
        await send("GET", `${other.base}/change-requests/${created.body.id}/impact-assessments`, {
          session: other.auditor.session,
        })
      ).status,
    ).toBe(404);
    const ok = await decide(send, submitted.body.approvalId, c.sponsor.session);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const versions = await api.db
      .selectFrom("charter_version")
      .select(["version_no", "in_scope"])
      .where("charter_id", "=", charter.id)
      .orderBy("version_no")
      .execute();
    expect(versions.at(-1)).toEqual({
      version_no: charter.version + 1,
      in_scope: "Synthetic: prepaid and postpaid consumer base",
    });
    // The snapshot of the version the G1 approval saw is still there (charter_version is append-only).
    expect(versions.map((v) => v.version_no)).toContain(charter.version);
  });
});
