// P5 contract exercises of BE-K (p5-work-split §E.2 and §2 rule 14; T-DG5-BE-K): the five approval-route and
// gate-condition operations through the validating client, each with a success and every declared refusal it can
// reach (400, 401, 403, 404, 409, 422, 428). Every value is SYNTHETIC; each step decision and the G5 decision are demo
// business decisions by test persons that approve nothing real, and nothing touches the engineering gates DG0-DG7.
import {
  approvalRoute,
  approvalRouteDefinitionList,
  trackedGateCondition,
  trackedGateConditionPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import type { P5ExerciseContext } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { requestRouted, routedWorld, stepUrl } from "../workflows/route-fixtures.ts";
import { g5Approval, pendingGate, seedGateWorld, stageGates } from "./p4-exercises-be-k.ts";

export const P5_MIRRORS_BE_K: Readonly<Record<string, z.ZodType>> = {
  listApprovalRoutes: approvalRouteDefinitionList,
  getApprovalRoute: approvalRoute,
  decideApprovalRouteStep: approvalRoute,
  listGateConditions: trackedGateConditionPage,
  closeGateCondition: trackedGateCondition,
};

export async function exerciseP5BeKOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;

  // ------------------------------------------------------------------ approval routes (ADR-0044 §4)
  const { q, versionId } = await routedWorld(api, w, "sequential", ["BO", "FIN"], m);
  const ADMIN = "/api/v1/admin/approval-routes";
  const routes = await m("GET", `${ADMIN}?versionId=${versionId}`, { session: q.lead.session });
  expect([routes.status, routes.body.items.length]).toEqual([200, 1]);
  expect((await m("GET", `${ADMIN}?versionId=not-a-uuid`, { session: q.lead.session })).status).toBe(400);
  expect((await m("GET", ADMIN)).status).toBe(401);
  expect((await m("GET", ADMIN, { session: q.bo.session })).status).toBe(403);

  const a = await requestRouted(m, q);
  const ROUTE = `/api/v1/approvals/${a.id}/route`;
  const view = await m("GET", ROUTE, { session: q.auditor.session });
  expect([view.status, view.body.routed, view.body.steps.length]).toEqual([200, true, 2]);
  expect((await m("GET", `/api/v1/approvals/not-a-uuid/route`, { session: q.lead.session })).status).toBe(400);
  expect((await m("GET", ROUTE)).status).toBe(401);
  expect((await m("GET", `/api/v1/approvals/${q.decisionId}/route`, { session: q.lead.session })).status).toBe(404);

  const step1 = stepUrl(a.id, 1);
  const approve = { outcome: "approve", note: "Synthetic step approval" };
  expect((await m("POST", step1, { session: q.bo.session, body: approve })).status).toBe(428);
  expect((await m("POST", step1, { session: q.bo.session, headers: ifm(9), body: approve })).status).toBe(409);
  expect((await m("POST", step1, { session: q.bo.session, headers: ifm(1), body: { outcome: "maybe" } })).status).toBe(
    400,
  );
  expect((await m("POST", step1, { headers: ifm(1), body: approve })).status).toBe(401);
  const notHolder = await m("POST", step1, { session: q.fin.session, headers: ifm(1), body: approve });
  expect([notHolder.status, notHolder.body.code]).toEqual([403, "approval_route.not_step_approver"]);
  const waiting = await m("POST", stepUrl(a.id, 2), { session: q.fin.session, headers: ifm(1), body: approve });
  expect([waiting.status, waiting.body.code]).toEqual([422, "approval_route.step_not_active"]);
  expect(
    (await m("POST", stepUrl(q.decisionId, 1), { session: q.bo.session, headers: ifm(1), body: approve })).status,
  ).toBe(404);
  const decided = await m("POST", step1, { session: q.bo.session, headers: ifm(1), body: approve });
  expect([decided.status, decided.body.steps[1].status]).toEqual([200, "active"]);

  // ------------------------------------------------------------------ gate conditions (ADR-0044 §3)
  const g = await seedGateWorld(api, w, m);
  await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
  const no = await pendingGate(api, g, "G5");
  const g5 = await m("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
  expect(g5.status, JSON.stringify(g5.body)).toBe(201);
  const LIST = `${g.b.base}/gate-conditions`;
  const list = await m("GET", `${LIST}?status=open`, { session: g.b.s.auditor });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);
  expect((await m("GET", `${LIST}?limit=0`, { session: g.b.s.tl })).status).toBe(400);
  expect((await m("GET", LIST)).status).toBe(401);
  expect((await m("GET", LIST, { session: g.b.s.outsider })).status).toBe(404);

  const CLOSE = `${LIST}/${list.body.items[0].id}/close`;
  const note = { note: "Synthetic: condition met" };
  expect((await m("POST", CLOSE, { session: g.b.s.bo, body: {} })).status).toBe(400);
  expect((await m("POST", CLOSE, { body: note })).status).toBe(401);
  const notOwner = await m("POST", CLOSE, { session: g.b.s.tl, body: note });
  expect([notOwner.status, notOwner.body.code]).toEqual([403, "gate_condition.not_owner"]);
  expect((await m("POST", `${LIST}/${g.initiativeId}/close`, { session: g.b.s.bo, body: note })).status).toBe(404);
  const closed = await m("POST", CLOSE, { session: g.b.s.bo, body: note });
  expect([closed.status, closed.body.status]).toEqual([201, "closed"]);
  const again = await m("POST", CLOSE, { session: g.b.s.bo, body: note });
  expect([again.status, again.body.code]).toEqual([422, "gate_condition.already_closed"]);
}
