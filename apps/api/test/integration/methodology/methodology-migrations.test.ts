// Methodology migrations and gate re-approvals (ADR-0040 §1-§4, §6, §8; REQ-S06-008, REQ-S06-010; D-142 Q9;
// p5-work-split §A.5; T-DG5-BE-C) against a real PostgreSQL:
//  - REQ-S06-008 literal: after v2 is published an existing transformation still renders v1; the preview lists a
//    required G2 re-approval (and, with the forms provider, the new required field); execution leaves every historical
//    record, submission, snapshot and decision byte-identical;
//  - D-142 Q9: an approved gate with a required re-approval can be submitted again (G1 here, through the unchanged DG2
//    path, and approved again by a person, which satisfies the re-approval); G2's resubmission passes the approval
//    refusal; the next gate (G3) is refused 422 gate.reapproval_required; an approved gate without a re-approval keeps
//    the DG2 refusal gate.already_approved; a later migration supersedes an earlier required row;
//  - the requester deciding -> 403 methodology_migration.self_approval; decideApproval on the type -> 422
//    approval.decide_through_record; a moved pin -> 409 methodology_migration.pin_moved; lock 730252 serialises creates;
//  - every mutation: AUD 403, outside scope 404, If-Match 428/409, one audit event on the migration per mutation,
//    authorization re-checked at commit time.
// All data is synthetic. Approving a migration and re-approving a gate are demo BUSINESS decisions by people in a test
// world; they approve nothing real, and nothing touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADVISORY_LOCK_CLASSES } from "../../../src/modules/platform/index.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type RequestOptions,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, ifm, makeG1Ready } from "../../support/p2-fixtures.ts";
import { setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { approveGate, type ChangeWorld } from "../workflows/change-fixtures.ts";
import { freshKey, historySnapshot, pinFixture, seedPublishedVersion } from "./migration-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const RATIONALE = "Synthetic demo decision; approves nothing real.";
const req = (m: string, u: string, o?: RequestOptions) => call<Body>(api.app, m, u, o);
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];
const T = (t: string) => `/api/v1/transformations/${t}`;
const MIG = (t: string) => `${T(t)}/methodology-migrations`;
const actions = async (recordId: string) => (await auditOf(api.db, recordId)).map((a) => a.action);

/** The synthetic v2 of a methodology key: G1 relabelled, G3's default approver BO, a new mandatory G2 checklist item. */
const V2_ELEMENTS = [
  { elementType: "gate", stableKey: "G1", attributes: { labelEn: "G1 - Case for Change (synthetic v2)" } },
  { elementType: "gate", stableKey: "G3", attributes: { defaultApproverRoleCode: "BO" } },
  {
    elementType: "checklist_item",
    stableKey: "test.g2-check",
    origin: "admin" as const,
    attributes: { labelEn: "Synthetic G2 check", gateCode: "G2", mandatory: true },
  },
];
/** v3: v2 plus a new G1 checklist item, and the G2 item no longer mandatory (both beyond label/help). */
const V3_ELEMENTS = [
  V2_ELEMENTS[0]!,
  V2_ELEMENTS[1]!,
  { ...V2_ELEMENTS[2]!, attributes: { labelEn: "Synthetic G2 check", gateCode: "G2", mandatory: false } },
  {
    elementType: "checklist_item",
    stableKey: "test.g1-check",
    origin: "admin" as const,
    attributes: { labelEn: "Synthetic G1 check", gateCode: "G1", mandatory: true },
  },
];

interface Fixture {
  readonly p: ApprovalWorld;
  readonly key: string;
  readonly v1: string;
  readonly v2: string;
}

/** An approval world whose methodology pin names v1 of a fresh key with a published v2 (no migration yet). */
async function fixture(opts: { v2?: typeof V2_ELEMENTS } = {}): Promise<Fixture> {
  const p = await setupApprovalWorld(api, w);
  const key = freshKey("methodology");
  const v1 = await seedPublishedVersion(api, "methodology", key, 1);
  await pinFixture(api, {
    organizationId: w.orgA.id,
    transformationId: p.transformationId,
    kind: "methodology",
    versionId: v1,
    by: p.lead.id,
  });
  const v2 = await seedPublishedVersion(api, "methodology", key, 2, opts.v2 ?? V2_ELEMENTS);
  return { p, key, v1, v2 };
}

/** G1 approved through the real DG2 path (TL submits, SP decides with the three B0032 confirmations). */
async function approveG1(p: ApprovalWorld): Promise<void> {
  await makeG1Ready(api, p);
  const sub = await req("POST", `${T(p.transformationId)}/gates/G1/submissions`, {
    session: p.lead.session,
    headers: ifm(await gateVersion(api, p, "G1")),
    body: {},
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const dec = await req("POST", `${T(p.transformationId)}/gates/G1/decision`, {
    session: p.sponsor.session,
    body: { submissionNo: sub.body.submissionNo, outcome: "approved", rationale: RATIONALE, agreements: G1_AGREEMENTS },
  });
  expect(dec.status, JSON.stringify(dec.body)).toBe(201);
}

const changeWorldOf = (p: ApprovalWorld): ChangeWorld =>
  ({ ...p, organizationId: w.orgA.id, base: T(p.transformationId) }) as unknown as ChangeWorld;

/** create -> submit -> SP approves; returns the approved migration. */
async function approvedMigration(f: Fixture, toVersionId = f.v2): Promise<Body> {
  const admin = f.p.methodologyAdmin.session;
  const created = await req("POST", MIG(f.p.transformationId), {
    session: admin,
    body: { configKind: "methodology", toVersionId, reason: "Synthetic migration to the newer methodology" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  const submitted = await req("POST", `${MIG(f.p.transformationId)}/${id}/submit`, {
    session: admin,
    headers: ifm(created.body.version),
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const decided = await req("POST", `${MIG(f.p.transformationId)}/${id}/decision`, {
    session: f.p.sponsor.session,
    headers: ifm(submitted.body.version),
    body: { outcome: "approve", rationale: RATIONALE },
  });
  expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  expect(decided.body.status).toBe("approved");
  return decided.body;
}

async function execute(f: Fixture, m: Body): Promise<Body> {
  const r = await req("POST", `${MIG(f.p.transformationId)}/${m.id}/execute`, {
    session: f.p.methodologyAdmin.session,
    headers: ifm(m.version),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

describe("REQ-S06-008: pinned until a deliberate, approved migration; history never rewritten", () => {
  it("v2 published: the transformation still renders v1; the plan lists the G2 re-approval; execution moves only the pin", async () => {
    const f = await fixture();
    const t = f.p.transformationId;
    await approveG1(f.p);
    const g2 = await approveGate(api.db, changeWorldOf(f.p), "G2");

    // After v2 is published the transformation still renders v1 (the catalogue values, its pin unchanged).
    const before = await req("GET", `${T(t)}/gates/G1`, { session: f.p.lead.session });
    expect(before.body.definition.sourceNameEn).toBe("G1 - Case for Change");
    const g3Before = await req("GET", `${T(t)}/gates/G3`, { session: f.p.lead.session });
    expect(g3Before.body.definition.defaultApproverRoleCode).toBe("SP");
    const pins = await req("GET", `${T(t)}/config-pins`, { session: f.p.methodologyAdmin.session });
    expect(pins.body.items.find((x: Body) => x.kind === "methodology").versionId).toBe(f.v1);

    // The plan (revision 1): the default mappings, the required G2 re-approval, and the unchanged-history statement.
    const created = await req("POST", MIG(t), {
      session: f.p.methodologyAdmin.session,
      body: { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic migration to v2" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    const m = created.body;
    expect([m.status, m.planRevision, m.planReady, m.fromVersionId, m.toVersionId]).toEqual([
      "draft",
      1,
      true,
      f.v1,
      f.v2,
    ]);
    expect(m.items.map((i: Body) => [i.itemKind, i.stableKey, i.gateCode, i.resolution])).toEqual([
      ["mapping", "G1", null, "automatic"],
      ["mapping", "G3", null, "automatic"],
      ["reapproval", "G2", "G2", "automatic"],
      ["unchanged_history", null, null, "automatic"],
    ]);
    const reapprovalItem = m.items[2];
    expect(reapprovalItem.detail.approvedDecisionId).toBe(g2.gateDecisionId);
    expect(reapprovalItem.detail.reasons).toEqual([
      { elementType: "checklist_item", stableKey: "test.g2-check", change: "added" },
    ]);
    expect(m.items[0].detail.fields).toEqual([
      { field: "labelEn", from: "G1 - Case for Change", to: "G1 - Case for Change (synthetic v2)" },
    ]);
    expect(m.items[3].detail.textEn).toBe(
      "Historical records keep the version they were captured with; nothing is rewritten.",
    );
    // Still v1 while the migration is only planned.
    expect((await req("GET", `${T(t)}/gates/G1`, { session: f.p.lead.session })).body.definition.sourceNameEn).toBe(
      "G1 - Case for Change",
    );

    const submitted = await req("POST", `${MIG(t)}/${m.id}/submit`, {
      session: f.p.methodologyAdmin.session,
      headers: ifm(1),
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    expect(submitted.body.status).toBe("submitted");
    // The approval is routed to the SP party (the Sponsor) with its decision task.
    const approval = await api.db
      .selectFrom("approval")
      .selectAll()
      .where("id", "=", submitted.body.approvalId)
      .executeTakeFirstOrThrow();
    expect([
      approval.approval_type,
      approval.assignee_party_code,
      approval.assignee_user_id,
      approval.sod_policy,
    ]).toEqual(["methodology_migration", "SP", f.p.sponsor.id, "requester_excluded"]);
    const decided = await req("POST", `${MIG(t)}/${m.id}/decision`, {
      session: f.p.sponsor.session,
      headers: ifm(submitted.body.version),
      body: { outcome: "approve", rationale: RATIONALE },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    expect([decided.body.status, decided.body.decidedBy]).toEqual(["approved", f.p.sponsor.id]);

    const history = await historySnapshot(api.db, t);
    const executed = await execute(f, decided.body);
    expect([executed.status, executed.executedBy]).toEqual(["executed", f.p.methodologyAdmin.id]);
    // Every historical record, submission, snapshot and decision is byte-identical.
    expect(await historySnapshot(api.db, t)).toBe(history);

    // The pin moved once, with one history row; the transformation now renders v2.
    const pinNow = await req("GET", `${T(t)}/config-pins`, { session: f.p.methodologyAdmin.session });
    const pin = pinNow.body.items.find((x: Body) => x.kind === "methodology");
    expect([pin.versionId, pin.lastMigrationId, pin.version]).toEqual([f.v2, m.id, 2]);
    const pinHistory = await req("GET", `${T(t)}/config-pins/history`, { session: f.p.methodologyAdmin.session });
    expect(
      pinHistory.body.items.map((h: Body) => [h.fromVersionId, h.toVersionId, h.migrationId, h.pinVersion]),
    ).toEqual([[f.v1, f.v2, m.id, 2]]);
    expect((await req("GET", `${T(t)}/gates/G1`, { session: f.p.lead.session })).body.definition.sourceNameEn).toBe(
      "G1 - Case for Change (synthetic v2)",
    );
    expect(
      (await req("GET", `${T(t)}/gates/G3`, { session: f.p.lead.session })).body.definition.defaultApproverRoleCode,
    ).toBe("BO");

    // The G2 re-approval (its approved decision preserved) and its task for the gate.submit holder (TL).
    const reapprovals = await req("GET", `${T(t)}/gate-reapprovals`, { session: f.p.auditor.session });
    expect(reapprovals.status).toBe(200);
    expect(
      reapprovals.body.items.map((r: Body) => [r.gateCode, r.status, r.approvedDecisionId, r.migrationId]),
    ).toEqual([["G2", "required", g2.gateDecisionId, m.id]]);
    const tasks = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "kind", "status", "message_key"])
      .where("subject_id", "=", reapprovals.body.items[0].id)
      .execute();
    expect(tasks).toEqual([
      {
        assignee_user_id: f.p.lead.id,
        kind: "gate_reapproval",
        status: "open",
        message_key: "methodology.task.gate_reapproval",
      },
    ]);
    expect(reapprovals.body.items[0].workItemId).not.toBeNull();
    // G2 is still approved (its decision and snapshot untouched); only its re-approval is required.
    const g2View = await req("GET", `${T(t)}/gates/G2`, { session: f.p.lead.session });
    expect(g2View.body.gate.status).toBe("approved");

    // One audit event on the migration per mutation.
    expect(await actions(m.id)).toEqual([
      "methodology_migration.create",
      "methodology_migration.submit",
      "methodology_migration.decide",
      "methodology_migration.execute",
    ]);

    // Q9: G2 resubmission is allowed while required (it passes the approval refusal; this synthetic world has not
    // completed G2's outputs, so the DG2 criteria check answers); G1 (approved, no re-approval) keeps the DG2 refusal;
    // G3 (after G2) is refused until G2 is re-approved.
    const g2Again = await req("POST", `${T(t)}/gates/G2/submissions`, {
      session: f.p.lead.session,
      headers: ifm(g2View.body.gate.version),
      body: {},
    });
    expect(codeOf(g2Again)).toEqual([422, "gate_criteria_incomplete"]);
    const g1Again = await req("POST", `${T(t)}/gates/G1/submissions`, {
      session: f.p.lead.session,
      headers: ifm(await gateVersion(api, f.p, "G1")),
      body: {},
    });
    expect(codeOf(g1Again)).toEqual([422, "gate.already_approved"]);
    const g3 = await req("POST", `${T(t)}/gates/G3/submissions`, {
      session: f.p.lead.session,
      headers: ifm(await gateVersion(api, f.p, "G3")),
      body: {},
    });
    expect(codeOf(g3)).toEqual([422, "gate.reapproval_required"]);
    expect(g3.body.detail).toBe(
      "An earlier gate needs re-approval after a methodology migration before this gate can be submitted.",
    );

    // A second migration (v2 -> v3) requires G1 and G2 again: the earlier G2 row is superseded.
    const v3 = await seedPublishedVersion(api, "methodology", f.key, 3, V3_ELEMENTS);
    const m2 = await approvedMigration(f, v3);
    expect(m2.items.filter((i: Body) => i.itemKind === "reapproval").map((i: Body) => i.gateCode)).toEqual([
      "G1",
      "G2",
    ]);
    await execute(f, m2);
    const after2 = await req("GET", `${T(t)}/gate-reapprovals`, { session: f.p.lead.session });
    expect(after2.body.items.map((r: Body) => [r.gateCode, r.status, r.migrationId])).toEqual([
      ["G2", "required", m2.id],
      ["G1", "required", m2.id],
      ["G2", "superseded", m.id],
    ]);
    const superseded = after2.body.items[2];
    expect(
      await api.db.selectFrom("work_item").select("status").where("subject_id", "=", superseded.id).execute(),
    ).toEqual([{ status: "cancelled" }]);

    // G1's re-approval: resubmitted through the unchanged DG2 path (approved -> submitted), approved again by the
    // Sponsor: the re-approval is satisfied by the NEW decision; the earlier decision stays in history.
    const g1Before = await api.db
      .selectFrom("gate_decision")
      .selectAll()
      .where("transformation_id", "=", t)
      .where("gate_code", "=", "G1")
      .execute();
    const resubmitted = await req("POST", `${T(t)}/gates/G1/submissions`, {
      session: f.p.lead.session,
      headers: ifm(await gateVersion(api, f.p, "G1")),
      body: {},
    });
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(201);
    expect((await req("GET", `${T(t)}/gates/G1`, { session: f.p.lead.session })).body.gate.status).toBe("submitted");
    const reDecided = await req("POST", `${T(t)}/gates/G1/decision`, {
      session: f.p.sponsor.session,
      body: {
        submissionNo: resubmitted.body.submissionNo,
        outcome: "approved",
        rationale: RATIONALE,
        agreements: G1_AGREEMENTS,
      },
    });
    expect(reDecided.status, JSON.stringify(reDecided.body)).toBe(201);
    const g1Row = (await req("GET", `${T(t)}/gate-reapprovals`, { session: f.p.lead.session })).body.items.find(
      (r: Body) => r.gateCode === "G1",
    );
    expect([g1Row.status, g1Row.satisfiedDecisionId]).toEqual(["satisfied", reDecided.body.id]);
    expect(await actions(g1Row.id)).toContain("gate_reapproval.satisfy");
    expect(await api.db.selectFrom("work_item").select("status").where("subject_id", "=", g1Row.id).execute()).toEqual([
      { status: "done" },
    ]);
    const g1After = await api.db
      .selectFrom("gate_decision")
      .selectAll()
      .where("transformation_id", "=", t)
      .where("gate_code", "=", "G1")
      .where(
        "id",
        "in",
        g1Before.map((d) => d.id),
      )
      .execute();
    expect(JSON.stringify(g1After)).toBe(JSON.stringify(g1Before));
    // G3 is still refused: G2's re-approval is still required.
    const g3Still = await req("POST", `${T(t)}/gates/G3/submissions`, {
      session: f.p.lead.session,
      headers: ifm(await gateVersion(api, f.p, "G3")),
      body: {},
    });
    expect(codeOf(g3Still)).toEqual([422, "gate.reapproval_required"]);
  }, 120_000);

  it("the preview lists the new required field (forms provider) and needs an input before submit", async () => {
    const p = await setupApprovalWorld(api, w);
    const key = freshKey("form_schema");
    const f1 = await seedPublishedVersion(api, "form_schema", key, 1);
    await pinFixture(api, {
      organizationId: w.orgA.id,
      transformationId: p.transformationId,
      kind: "form_schema",
      versionId: f1,
      by: p.lead.id,
    });
    const f2 = await seedPublishedVersion(api, "form_schema", key, 2, [
      {
        elementType: "form_field",
        stableKey: "T01.sponsor_note",
        origin: "admin",
        attributes: { fieldType: "text", labelEn: "Sponsor note", required: true },
      },
    ]);
    const admin = p.methodologyAdmin.session;
    const created = await req("POST", MIG(p.transformationId), {
      session: admin,
      body: { configKind: "form_schema", toVersionId: f2, reason: "Synthetic form migration" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const field = created.body.items.find((i: Body) => i.itemKind === "new_required_field");
    expect([field.stableKey, field.resolution, field.detail.recordCount, created.body.planReady]).toEqual([
      "T01.sponsor_note",
      "needs_input",
      6,
      false,
    ]);
    const id = created.body.id;
    expect(
      codeOf(await req("POST", `${MIG(p.transformationId)}/${id}/submit`, { session: admin, headers: ifm(1) })),
    ).toEqual([422, "methodology_migration.inputs_required"]);
    // An input that names no new required field: 400, nothing written.
    const bad = await req("POST", `${MIG(p.transformationId)}/${id}/preview`, {
      session: admin,
      headers: ifm(1),
      body: { inputs: [{ stableKey: "T01.nope", value: "x" }] },
    });
    expect(bad.status).toBe(400);
    const preview = await req("POST", `${MIG(p.transformationId)}/${id}/preview`, {
      session: admin,
      headers: ifm(1),
      body: { inputs: [{ stableKey: "T01.sponsor_note", value: null }] },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const provided = preview.body.items.find((i: Body) => i.itemKind === "new_required_field");
    expect([
      preview.body.planRevision,
      preview.body.planReady,
      provided.resolution,
      provided.detail.leaveEmptyUntilNextEdit,
    ]).toEqual([2, true, "provided", true]);
    const submitted = await req("POST", `${MIG(p.transformationId)}/${id}/submit`, { session: admin, headers: ifm(2) });
    expect([submitted.status, submitted.body.status]).toEqual([200, "submitted"]);
  }, 60_000);
});

describe("decisions, refusals and authorization", () => {
  it("requester deciding -> 403 self_approval; decideApproval on the type -> 422 decide_through_record; request changes and resubmit", async () => {
    const f = await fixture();
    const t = f.p.transformationId;
    // A person who both plans (ADM_METHOD) and holds the approver role (SP) on the transformation (synthetic).
    const both = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, both.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, both.id, "SP", { type: "transformation", id: t }, w.orgA.id);
    const bothSession = await signIn(api.app, both.subject);
    const created = await req("POST", MIG(t), {
      session: bothSession,
      body: { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic self-approval attempt" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const submitted = await req("POST", `${MIG(t)}/${created.body.id}/submit`, {
      session: bothSession,
      headers: ifm(1),
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const self = await req("POST", `${MIG(t)}/${created.body.id}/decision`, {
      session: bothSession,
      headers: ifm(2),
      body: { outcome: "approve", rationale: RATIONALE },
    });
    expect(codeOf(self)).toEqual([403, "methodology_migration.self_approval"]);
    expect(self.body.detail).toBe("You cannot approve a migration you requested.");
    // The generic decide route refuses the type (the Sponsor holds approval.decide) and writes nothing.
    const approval = await req("GET", `/api/v1/approvals/${submitted.body.approvalId}`, {
      session: f.p.sponsor.session,
    });
    expect(approval.status).toBe(200);
    const generic = await req("POST", `/api/v1/approvals/${submitted.body.approvalId}/decisions`, {
      session: f.p.sponsor.session,
      headers: ifm(approval.body.version),
      body: { outcome: "approve", rationale: RATIONALE, subjectVersion: 1 },
    });
    expect(codeOf(generic)).toEqual([422, "approval.decide_through_record"]);
    expect(generic.body.detail).toBe("Decide this request from its record.");
    expect(
      await api.db
        .selectFrom("approval_decision")
        .select("id")
        .where("approval_id", "=", submitted.body.approvalId)
        .execute(),
    ).toEqual([]);
    // The Sponsor requests changes; the requester resubmits (a new plan revision, the approval's round 2).
    const changes = await req("POST", `${MIG(t)}/${created.body.id}/decision`, {
      session: f.p.sponsor.session,
      headers: ifm(2),
      body: { outcome: "request_changes", rationale: "Synthetic: explain the G3 approver change." },
    });
    expect([changes.status, changes.body.status, changes.body.decidedBy]).toEqual([200, "changes_requested", null]);
    const again = await req("POST", `${MIG(t)}/${created.body.id}/submit`, { session: bothSession, headers: ifm(3) });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect([again.body.status, again.body.approvalId]).toEqual(["submitted", submitted.body.approvalId]);
    // The same approval, round 2, for the migration exactly as resubmitted (its row version).
    const round = await api.db
      .selectFrom("approval")
      .select(["round_no", "subject_version", "status"])
      .where("id", "=", submitted.body.approvalId)
      .executeTakeFirstOrThrow();
    expect(round).toEqual({ round_no: 2, subject_version: again.body.version, status: "pending" });
    // Rejected: final; the migration is no longer open.
    const rejected = await req("POST", `${MIG(t)}/${created.body.id}/decision`, {
      session: f.p.sponsor.session,
      headers: ifm(again.body.version),
      body: { outcome: "reject", rationale: RATIONALE },
    });
    expect([rejected.status, rejected.body.status]).toEqual([200, "rejected"]);
    expect(
      codeOf(
        await req("POST", `${MIG(t)}/${created.body.id}/decision`, {
          session: f.p.sponsor.session,
          headers: ifm(rejected.body.version),
          body: { outcome: "approve", rationale: RATIONALE },
        }),
      ),
    ).toEqual([422, "methodology_migration.not_open"]);
  }, 60_000);

  it("a moved pin -> 409 pin_moved; not approved -> 422 not_approved; target invalid; open exists; withdraw", async () => {
    const f = await fixture();
    const t = f.p.transformationId;
    const admin = f.p.methodologyAdmin.session;
    // Target invalid: the pinned version itself, a version of another key, an unknown id.
    const other = await seedPublishedVersion(api, "methodology", freshKey("methodology"), 1);
    for (const toVersionId of [f.v1, other, crypto.randomUUID()]) {
      const r = await req("POST", MIG(t), {
        session: admin,
        body: { configKind: "methodology", toVersionId, reason: "Synthetic" },
      });
      expect(codeOf(r)).toEqual([422, "methodology_migration.target_invalid"]);
      expect(r.body.detail).toBe(
        "The target must be a published version of the same configuration, other than the pinned one.",
      );
    }
    const created = await req("POST", MIG(t), {
      session: admin,
      body: { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic migration" },
    });
    expect(created.status).toBe(201);
    const dup = await req("POST", MIG(t), {
      session: admin,
      body: { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic duplicate" },
    });
    expect(codeOf(dup)).toEqual([409, "methodology_migration.open_exists"]);
    const id = created.body.id;
    expect(codeOf(await req("POST", `${MIG(t)}/${id}/execute`, { session: admin, headers: ifm(1) }))).toEqual([
      422,
      "methodology_migration.not_approved",
    ]);
    // The pin is pointed elsewhere behind the migration's back (synthetic): preview and submit answer 409.
    const v1b = await seedPublishedVersion(api, "methodology", f.key, 3);
    await pinFixture(api, {
      organizationId: w.orgA.id,
      transformationId: t,
      kind: "methodology",
      versionId: v1b,
      by: f.p.lead.id,
    });
    const moved = await req("POST", `${MIG(t)}/${id}/submit`, { session: admin, headers: ifm(1) });
    expect(codeOf(moved)).toEqual([409, "methodology_migration.pin_moved"]);
    expect(moved.body.detail).toBe(
      "The transformation's pinned version changed after this migration was planned. Plan it again.",
    );
    // Withdraw (still a draft): final; then not open.
    const withdrawn = await req("POST", `${MIG(t)}/${id}/withdraw`, { session: admin, headers: ifm(1) });
    expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);
    expect(codeOf(await req("POST", `${MIG(t)}/${id}/withdraw`, { session: admin, headers: ifm(2) }))).toEqual([
      422,
      "methodology_migration.not_open",
    ]);
    expect(await actions(id)).toEqual(["methodology_migration.create", "methodology_migration.withdraw"]);
  }, 60_000);

  it("an approved migration whose pin moved is not executed (409 pin_moved, nothing written)", async () => {
    const f = await fixture();
    const m = await approvedMigration(f);
    const v3 = await seedPublishedVersion(api, "methodology", f.key, 3);
    await pinFixture(api, {
      organizationId: w.orgA.id,
      transformationId: f.p.transformationId,
      kind: "methodology",
      versionId: v3,
      by: f.p.lead.id,
    });
    const r = await req("POST", `${MIG(f.p.transformationId)}/${m.id}/execute`, {
      session: f.p.methodologyAdmin.session,
      headers: ifm(m.version),
    });
    expect(codeOf(r)).toEqual([409, "methodology_migration.pin_moved"]);
    const row = await api.db
      .selectFrom("methodology_migration")
      .select("status")
      .where("id", "=", m.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("approved");
  }, 60_000);

  it("withdrawing a submitted migration withdraws its approval too", async () => {
    const f = await fixture();
    const t = f.p.transformationId;
    const admin = f.p.methodologyAdmin.session;
    const created = await req("POST", MIG(t), {
      session: admin,
      body: { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic" },
    });
    const submitted = await req("POST", `${MIG(t)}/${created.body.id}/submit`, { session: admin, headers: ifm(1) });
    const withdrawn = await req("POST", `${MIG(t)}/${created.body.id}/withdraw`, { session: admin, headers: ifm(2) });
    expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);
    const a = await api.db
      .selectFrom("approval")
      .select("status")
      .where("id", "=", submitted.body.approvalId)
      .executeTakeFirstOrThrow();
    expect(a.status).toBe("withdrawn");
  }, 60_000);

  it("AUD and TL get 403 on every write, outsiders 404; If-Match 428/409; reads by methodology.read and transformation.read", async () => {
    const f = await fixture();
    const t = f.p.transformationId;
    const admin = f.p.methodologyAdmin.session;
    const nobody = await signIn(api.app, w.nobody.subject);
    const body = { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic" };
    for (const s of [f.p.auditor.session, f.p.lead.session])
      expect((await req("POST", MIG(t), { session: s, body })).status).toBe(403);
    expect((await req("POST", MIG(t), { session: nobody, body })).status).toBe(404);
    const created = await req("POST", MIG(t), { session: admin, body });
    const id = created.body.id;
    const writes: [string, Record<string, unknown> | undefined][] = [
      ["preview", { inputs: [] }],
      ["submit", undefined],
      ["decision", { outcome: "approve", rationale: RATIONALE }],
      ["execute", undefined],
      ["withdraw", undefined],
    ];
    for (const [path, b] of writes) {
      const url = `${MIG(t)}/${id}/${path}`;
      const opts = (s: typeof admin, h?: Record<string, string>) => ({
        session: s,
        ...(h ? { headers: h } : {}),
        ...(b ? { body: b } : {}),
      });
      expect((await req("POST", url, opts(f.p.auditor.session, ifm(1)))).status, path).toBe(403);
      expect((await req("POST", url, opts(nobody, ifm(1)))).status, path).toBe(404);
      const who = path === "decision" ? f.p.sponsor.session : admin;
      expect((await req("POST", url, opts(who))).status, path).toBe(428);
      expect((await req("POST", url, opts(who, ifm(7)))).status, path).toBe(409);
    }
    // ADM_METHOD never decides (no methodology_migration.approve: REQ-S06-010); SP never executes.
    const submitted = await req("POST", `${MIG(t)}/${id}/submit`, { session: admin, headers: ifm(1) });
    expect(
      (
        await req("POST", `${MIG(t)}/${id}/decision`, {
          session: admin,
          headers: ifm(2),
          body: { outcome: "approve", rationale: RATIONALE },
        })
      ).status,
    ).toBe(403);
    expect(submitted.status).toBe(200);
    // Reads: AUD reads (methodology.read), outsiders 404; the re-approval list is transformation.read.
    expect((await req("GET", MIG(t), { session: f.p.auditor.session })).status).toBe(200);
    expect((await req("GET", `${MIG(t)}/${id}`, { session: admin })).body.items.length).toBeGreaterThan(0);
    expect((await req("GET", MIG(t), { session: nobody })).status).toBe(404);
    expect((await req("GET", `${MIG(t)}/${crypto.randomUUID()}`, { session: admin })).status).toBe(404);
    expect((await req("GET", `${T(t)}/gate-reapprovals`, { session: nobody })).status).toBe(404);
    expect((await req("GET", `${T(t)}/gate-reapprovals`, { session: f.p.contributor.session })).status).toBe(200);
  }, 60_000);

  it("authorization is re-checked at commit time: a grant revoked while the request waits -> 403, nothing written", async () => {
    const f = await fixture();
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        req("POST", MIG(f.p.transformationId), {
          session: s,
          body: { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic commit-time check" },
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect([403, 404]).toContain(res.status);
    expect(
      await api.db
        .selectFrom("methodology_migration")
        .select("id")
        .where("transformation_id", "=", f.p.transformationId)
        .execute(),
    ).toEqual([]);
  }, 60_000);

  it("lock class 730252 serialises concurrent creates: exactly one migration, the other 409 open_exists", async () => {
    expect(ADVISORY_LOCK_CLASSES.methodologyMigration).toBe(730252);
    const f = await fixture();
    const body = { configKind: "methodology", toVersionId: f.v2, reason: "Synthetic concurrent create" };
    const [a, b] = await Promise.all([
      req("POST", MIG(f.p.transformationId), { session: f.p.methodologyAdmin.session, body }),
      req("POST", MIG(f.p.transformationId), { session: f.p.methodologyAdmin.session, body }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const rows = await sql<{
      n: string;
    }>`SELECT count(*) AS n FROM methodology_migration WHERE transformation_id = ${f.p.transformationId}::uuid`.execute(
      api.db,
    );
    expect(rows.rows[0]!.n).toBe("1");
  }, 60_000);
});
