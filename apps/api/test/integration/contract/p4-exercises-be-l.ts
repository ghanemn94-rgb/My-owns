// P4 contract exercises of BE-L (change requests, impact, phase steps; p4-plan §5.1, p4-work-split §1 S-10). Stub created by T-DG4-BE-A and
// already called by contract.test.ts: BE-L exercises each operation it routes here, through `ctx.mirrored`, in the
// same change that removes the operation from its p4-pending list, and lists each success body's zod mirror below.
// T-DG4-BE-L (ADR-0036): the 12 change-control operations. All data is SYNTHETIC; the approval decided here is a demo
// BUSINESS approval by a named synthetic person, approves nothing real, and nothing touches DG0-DG7. BE-L2 appends
// its phase-step exercises below (p4-work-split §H.0).
import {
  changeControlPolicy,
  changeRequest,
  changeRequestPage,
  impactAssessment,
  impactAssessmentPage,
  impactPreview,
  phaseDefinitionList,
  phaseStep,
  phaseStepEvidence,
  phaseStepEvidencePage,
  phaseStepPage,
  phaseWorkspace,
} from "@mth/shared/schemas";
import { sql } from "kysely";
import { expect } from "vitest";
import type { z } from "zod";
import {
  createTransformationRow,
  createUser,
  grant,
  signIn,
  type P4ExerciseContext,
  type RequestOptions,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { approvedMilestone, decide, selectedInitiative, setupChangeWorld } from "../workflows/change-fixtures.ts";

export const P4_MIRRORS_BE_L: Readonly<Record<string, z.ZodType>> = {
  getChangeControlPolicy: changeControlPolicy,
  putChangeControlPolicy: changeControlPolicy,
  listChangeRequests: changeRequestPage,
  createChangeRequest: changeRequest,
  previewChangeImpact: impactPreview,
  getChangeRequest: changeRequest,
  updateChangeRequest: changeRequest,
  submitChangeRequest: changeRequest,
  withdrawChangeRequest: changeRequest,
  getChangeRequestImpactPreview: impactPreview,
  listImpactAssessments: impactAssessmentPage,
  getImpactAssessment: impactAssessment,
  // T-DG4-BE-L2 (ADR-0035 §1): the 10 phase operations.
  listPhases: phaseDefinitionList,
  getPhaseWorkspace: phaseWorkspace,
  listPhaseSteps: phaseStepPage,
  getPhaseStep: phaseStep,
  updatePhaseStep: phaseStep,
  requestPhaseStepReview: phaseStep,
  reviewPhaseStep: phaseStep,
  listPhaseStepEvidence: phaseStepEvidencePage,
  linkPhaseStepEvidence: phaseStepEvidence,
  removePhaseStepEvidence: phaseStepEvidence,
};

export async function exerciseP4BeLOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const c = await setupChangeWorld(ctx.api, ctx.world, m);
  const P = `${c.base}/change-control-policy`;
  const put = await m("PUT", P, {
    session: c.lead.session,
    headers: ifm(0),
    body: { materialDateShiftWorkingDays: 10, materialBudgetChangeRatio: "0.05" },
  });
  expect([put.status, put.body.version, put.body.materialBudgetChangeRatio], JSON.stringify(put.body)).toEqual([
    200,
    1,
    "0.050000",
  ]);
  expect(
    (
      await m("PUT", P, {
        session: c.auditor.session,
        headers: ifm(1),
        body: { materialDateShiftWorkingDays: 1, materialBudgetChangeRatio: null },
      })
    ).status,
  ).toBe(403);
  const bad = await m("PUT", P, {
    session: c.lead.session,
    headers: ifm(1),
    body: { materialDateShiftWorkingDays: -1, materialBudgetChangeRatio: null },
  });
  expect([bad.status, bad.body.code]).toEqual([422, "change_control.threshold_invalid"]);
  const got = await m("GET", P, { session: c.auditor.session });
  expect([got.status, got.headers.etag]).toEqual([200, '"1"']);

  const ini = await selectedInitiative(ctx.api.db, c);
  const mid = await approvedMilestone(ctx.api.db, c, ini, "2026-11-02", "2026-11-23");
  const L = `${c.base}/change-requests`;
  const body = {
    changeKind: "schedule_rebaseline",
    subjectType: "milestone",
    subjectId: mid,
    subjectVersion: 1,
    proposedChange: { approvedDate: { from: "2026-11-02", to: "2026-11-23" } },
    reason: "Synthetic: rebaseline to the forecast",
  };
  const preview = await m("POST", `${L}/impact-preview`, { session: c.auditor.session, body });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  expect((await m("POST", L, { session: c.auditor.session, body })).status).toBe(403);
  const created = await m("POST", L, { session: c.lead.session, body });
  expect([created.status, created.headers.etag], JSON.stringify(created.body)).toEqual([201, '"1"']);
  const dup = await m("POST", L, { session: c.lead.session, body });
  expect([dup.status, dup.body.code]).toEqual([409, "change_request.already_open"]);
  const I = `${L}/${created.body.id}`;
  expect((await m("GET", I, { session: c.auditor.session })).status).toBe(200);
  expect((await m("PATCH", I, { session: c.lead.session, body: { reason: "Synthetic reason" } })).status).toBe(428);
  const updated = await m("PATCH", I, {
    session: c.lead.session,
    headers: ifm(1),
    body: { reason: "Synthetic: vendor delay" },
  });
  expect([updated.status, updated.body.version]).toEqual([200, 2]);
  const live = await m("GET", `${I}/impact-preview`, { session: c.auditor.session });
  expect(live.status).toBe(200);
  expect((await m("POST", `${I}/submit`, { session: c.lead.session, headers: ifm(1) })).status).toBe(409);
  const submitted = await m("POST", `${I}/submit`, { session: c.lead.session, headers: ifm(2) });
  expect([submitted.status, submitted.body.status, submitted.body.routePartyCode]).toEqual([200, "submitted", "SP"]);
  const list = await m("GET", `${L}?status=submitted&kind=schedule_rebaseline`, { session: c.auditor.session });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);
  const assessments = await m("GET", `${I}/impact-assessments`, { session: c.auditor.session });
  expect([assessments.status, assessments.body.items.length]).toEqual([200, 1]);
  const one = await m("GET", `${c.base}/impact-assessments/${submitted.body.currentImpactAssessmentId}`, {
    session: c.auditor.session,
  });
  expect([one.status, one.body.changeRequestVersion]).toEqual([200, 3]);
  const approved = await decide(m, submitted.body.approvalId, c.sponsor.session);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  const final = await m("POST", `${I}/withdraw`, { session: c.lead.session, headers: ifm(4) });
  expect([final.status, final.body.code]).toEqual([422, "change_request.not_withdrawable"]);

  // A second request on another milestone, withdrawn while still a draft.
  const mid2 = await approvedMilestone(ctx.api.db, c, ini, "2026-11-02", null);
  const second = await m("POST", L, { session: c.lead.session, body: { ...body, subjectId: mid2 } });
  expect(second.status).toBe(201);
  const withdrawn = await m("POST", `${L}/${second.body.id}/withdraw`, { session: c.lead.session, headers: ifm(1) });
  expect([withdrawn.status, withdrawn.body.status]).toEqual([200, "withdrawn"]);

  // T-DG4-BE-L2: the phase operations (appended here, p4-work-split §H.0).
  await exerciseP4BeL2PhaseOperations(ctx);
}

// ------------------------------------------------------------------------------------------------ T-DG4-BE-L2 (phases)
// The phase catalogue, workspace, guided steps, step evidence and the review queue (ADR-0035 §1, §7 item 3, §8, §11;
// REQ-PB-014, REQ-S04-001). All people and records are SYNTHETIC; accepting a step is a procedural review, not a business
// approval, and no gate (G1-G6) or engineering gate (DG0-DG7) is touched.

// Test responses are asserted structurally; the body type is deliberately loose (as in `call`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Caller = (method: string, url: string, opts?: RequestOptions) => Promise<Res<any>>;

export interface PhaseActor {
  readonly id: string;
  readonly subject: string;
  readonly session: Session;
}

/** A transformation with its six gate instances and the slice H step roles (TL owner, TO reviewer, BO, SP, FIN, WL). */
export interface PhaseWorld {
  readonly transformationId: string;
  readonly organizationId: string;
  /** /api/v1/transformations/{id} */
  readonly base: string;
  readonly tl: PhaseActor;
  readonly to: PhaseActor;
  readonly bo: PhaseActor;
  readonly sp: PhaseActor;
  readonly fin: PhaseActor;
  readonly wl: PhaseActor;
  /** AUD (organization, read-only), ADM-only (no transformation read), an outsider of another organization. */
  readonly auditor: Session;
  readonly admin: Session;
  readonly outsider: Session;
}

export async function seedPhaseWorld(api: TestApi, w: World): Promise<PhaseWorld> {
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  await sql`SELECT p2_instantiate_transformation(${transformationId}::uuid, ${w.office.id}::uuid, 'test:phase-world', 'api')`.execute(
    api.db,
  );
  const mk = async (role: string): Promise<PhaseActor> => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, role, { type: "transformation", id: transformationId }, w.orgA.id);
    return { ...u, session: await signIn(api.app, u.subject) };
  };
  return {
    transformationId,
    organizationId: w.orgA.id,
    base: `/api/v1/transformations/${transformationId}`,
    tl: await mk("TL"),
    to: await mk("TO"),
    bo: await mk("BO"),
    sp: await mk("SP"),
    fin: await mk("FIN"),
    wl: await mk("WL"),
    auditor: await signIn(api.app, w.auditor.subject),
    admin: await signIn(api.app, w.admin.subject),
    outsider: await signIn(api.app, w.officeB.subject),
  };
}

/** A note evidence item created by the TL and verified by the TO (ADR-0018), through the API; returns its id. */
export async function verifiedEvidence(
  send: Caller,
  p: PhaseWorld,
  title = "Synthetic phase evidence",
): Promise<string> {
  const created = await send("POST", `${p.base}/evidence`, {
    session: p.tl.session,
    body: { kind: "note", title, noteBody: "Synthetic: evidence for a phase step", ownerUserId: p.tl.id },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = (created.body as { id: string }).id;
  const reviewed = await send("POST", `${p.base}/evidence/${id}/review`, {
    session: p.to.session,
    headers: ifm(1),
    body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: checked" },
  });
  expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
  return id;
}

/** Owner assigned + started (If-Match "0" creates the row), as the TL; returns the step's version (2 after start). */
export async function startStep(send: Caller, p: PhaseWorld, stepKey: string, owner: PhaseActor = p.tl) {
  const r = await send("PATCH", `${p.base}/phase-steps/${stepKey}`, {
    session: p.tl.session,
    headers: ifm(0),
    body: { ownerUserId: owner.id, start: true },
  });
  expect([r.status, r.body.status, r.body.version], JSON.stringify(r.body)).toEqual([200, "in_progress", 1]);
  return r.body as { id: string; version: number };
}

export async function exerciseP4BeL2PhaseOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const p = await seedPhaseWorld(ctx.api, ctx.world);
  const phases = await m("GET", "/api/v1/phases", { session: p.auditor });
  expect([phases.status, phases.body.items.length]).toEqual([200, 6]);
  const ws = await m("GET", `${p.base}/phases`, { session: p.auditor });
  expect([ws.status, ws.body.currentPhase, ws.body.phases.length]).toEqual([200, "diagnose", 6]);
  const steps = await m("GET", `${p.base}/phase-steps?phase=diagnose&limit=2`, { session: p.auditor });
  expect([steps.status, steps.body.items.length, typeof steps.body.nextCursor]).toEqual([200, 2, "string"]);

  const key = "diagnose.register_scope_sponsor";
  const S = `${p.base}/phase-steps/${key}`;
  expect((await m("PATCH", S, { session: p.auditor, headers: ifm(0), body: { start: true } })).status).toBe(403);
  expect((await m("PATCH", S, { session: p.tl.session, body: { start: true } })).status).toBe(428);
  const created = await m("PATCH", S, { session: p.tl.session, headers: ifm(0), body: { ownerUserId: p.tl.id } });
  expect([created.status, created.headers.etag, created.body.status]).toEqual([200, '"1"', "not_started"]);
  const started = await m("PATCH", S, { session: p.tl.session, headers: ifm(1), body: { start: true } });
  expect([started.status, started.body.status, started.body.version]).toEqual([200, "in_progress", 2]);
  const got = await m("GET", S, { session: p.auditor });
  expect([got.status, got.headers.etag]).toEqual([200, '"2"']);

  const unmet = await m("POST", `${S}/request-review`, { session: p.tl.session, headers: ifm(2) });
  expect([unmet.status, unmet.body.code]).toEqual([422, "phase_step.completion_rule_unmet"]);
  const evidenceId = await verifiedEvidence(m, p);
  const L = `${S}/evidence`;
  const first = await m("POST", L, { session: p.tl.session, body: { evidenceId } });
  expect([first.status, first.headers.etag], JSON.stringify(first.body)).toEqual([201, '"1"']);
  const dup = await m("POST", L, { session: p.tl.session, body: { evidenceId } });
  expect([dup.status, dup.body.code]).toEqual([409, "phase_step_evidence.exists"]);
  const removed = await m("POST", `${L}/${first.body.id}/remove`, { session: p.tl.session, headers: ifm(1) });
  expect([removed.status, removed.body.status]).toEqual([200, "removed"]);
  const again = await m("POST", L, { session: p.tl.session, body: { evidenceId } });
  expect(again.status).toBe(201);
  const links = await m("GET", L, { session: p.auditor });
  expect([links.status, links.body.items.length]).toEqual([200, 2]);

  const inReview = await m("POST", `${S}/request-review`, { session: p.tl.session, headers: ifm(2) });
  expect([inReview.status, inReview.body.status], JSON.stringify(inReview.body)).toEqual([200, "in_review"]);
  const queue = await m("GET", `${p.base}/phase-steps?status=in_review`, { session: p.auditor });
  expect(queue.body.items.map((s: { stepKey: string }) => s.stepKey)).toEqual([key]);
  const noNote = await m("POST", `${S}/review`, {
    session: p.to.session,
    headers: ifm(3),
    body: { outcome: "returned" },
  });
  expect([noNote.status, noNote.body.code]).toEqual([400, "phase_step.return_note_required"]);
  const own = await m("POST", `${S}/review`, { session: p.tl.session, headers: ifm(3), body: { outcome: "accepted" } });
  expect(own.status).toBe(403);
  const accepted = await m("POST", `${S}/review`, {
    session: p.to.session,
    headers: ifm(3),
    body: { outcome: "accepted" },
  });
  expect([accepted.status, accepted.body.status, accepted.body.reviewOutcome]).toEqual([200, "complete", "accepted"]);
}
