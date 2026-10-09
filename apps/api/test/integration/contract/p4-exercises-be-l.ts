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
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P4ExerciseContext } from "../../support/harness.ts";
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
}
