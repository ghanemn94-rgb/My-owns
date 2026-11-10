// Sequential and parallel approval routes (T-DG5-BE-K; ADR-0044 §4, §9, §10; REQ-S10-015 "in a sequential route step 2
// is not notified until step 1 approves; in a parallel route both are notified at once"; p5-work-split §E.2) against a
// real PostgreSQL:
//  - sequential: step 2 has no work item and no notification until step 1 approves; then its holder is notified; the
//    last approval decides the canonical approval `approved` with the last decider (one decision row);
//  - parallel: every step's holders are notified at once; one person deciding two steps -> 403
//    approval_route.one_step_per_person; a request-changes step -> approval changes_requested, the other open step
//    cancelled; a resubmission creates the next round's steps;
//  - the requester deciding -> 403 approval_route.self_decision; a non-holder -> 403 approval_route.not_step_approver;
//    a waiting step -> 422 approval_route.step_not_active; DG4 decideApproval on a routed approval -> 422
//    approval.decide_through_route, nothing written; If-Match 428/409; AUD 403; commit-time re-authorization;
//  - a DG4 single-step approval (no route element, or mode `any`) is unchanged (regression); withdraw cancels steps;
//  - listApprovalRoutes reads the version's routes (methodology.read; a BO without it -> 403).
// Every value is SYNTHETIC; each step decision is a demo business decision by a test person that approves nothing real.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  grant,
  seedWorld,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { editDecision } from "../approvals/approval-world.ts";
import {
  decisionItems,
  holderOf,
  plainCaller,
  requestRouted,
  ROUTE_KEY,
  routedWorld,
  stepUrl,
} from "./route-fixtures.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const routeOf = (approvalId: string, opts: { session: Session }) =>
  send("GET", `/api/v1/approvals/${approvalId}/route`, opts);
const approvalRow = (id: string) =>
  api.db.selectFrom("approval").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const notificationsOf = (approvalId: string, userId: string) =>
  api.db
    .selectFrom("inbox_notification as n")
    .innerJoin("work_item as i", "i.id", "n.work_item_id")
    .select(["n.id"])
    .where("i.subject_id", "=", approvalId)
    .where("n.recipient_user_id", "=", userId)
    .execute();
const decide = (
  approvalId: string,
  stepNo: number,
  session: Body,
  version: number,
  body: Body = { outcome: "approve" },
) => send("POST", stepUrl(approvalId, stepNo), { session, headers: ifm(version), body });

describe("sequential route (REQ-S10-015)", () => {
  it("step 2 has no work item or notification until step 1 approves; the last step decides the approval", async () => {
    const { q } = await routedWorld(api, w, "sequential");
    const a = await requestRouted(plainCaller(api), q);
    const view = await routeOf(a.id, { session: q.auditor.session });
    expect(view.status).toBe(200);
    expect(view.headers.etag).toBe('"1"');
    expect(view.body).toMatchObject({ routed: true, routeKey: ROUTE_KEY, mode: "sequential", currentRoundNo: 1 });
    expect(view.body.steps.map((s: Body) => [s.stepNo, s.approverRoleCode, s.status])).toEqual([
      [1, "BO", "active"],
      [2, "FIN", "waiting"],
    ]);
    // Step 1's holders are notified; step 2's holder has nothing yet; no DG4 assignee task.
    expect((await decisionItems(api, a.id, q.bo.id)).map((i) => i.dedupe_key)).toEqual([
      `approval_route:${a.id}:1:1:${q.bo.id}`,
    ]);
    expect(await decisionItems(api, a.id, q.bo2.id)).toHaveLength(1);
    expect(await decisionItems(api, a.id, q.fin.id)).toEqual([]);
    expect(await notificationsOf(a.id, q.fin.id)).toEqual([]);
    expect(await notificationsOf(a.id, q.bo.id)).toHaveLength(1);

    // A waiting step cannot be decided; a non-holder cannot decide; the auditor is refused.
    const early = await decide(a.id, 2, q.fin.session, 1);
    expect([early.status, early.body.code]).toEqual([422, "approval_route.step_not_active"]);
    const notHolder = await decide(a.id, 1, q.fin.session, 1);
    expect([notHolder.status, notHolder.body.code]).toEqual([403, "approval_route.not_step_approver"]);
    expect((await decide(a.id, 1, q.auditor.session, 1)).status).toBe(403);
    // If-Match on the approval: 428 missing, 409 stale.
    const missing = await send("POST", stepUrl(a.id, 1), { session: q.bo.session, body: { outcome: "approve" } });
    expect(missing.status).toBe(428);
    const stale = await decide(a.id, 1, q.bo.session, 7);
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect((await routeOf(a.id, { session: q.auditor.session })).body.steps[0].status).toBe("active");

    // DG4 decideApproval on a routed approval: 422, nothing written.
    const dg4 = await send("POST", `/api/v1/approvals/${a.id}/decisions`, {
      session: q.bo.session,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect([dg4.status, dg4.body.code, dg4.body.detail]).toEqual([
      422,
      "approval.decide_through_route",
      "This approval follows a configured route; decide your route step instead.",
    ]);
    expect((await approvalRow(a.id)).version).toBe(1);

    // Step 1 approves -> step 2 becomes active and only now its holder is notified.
    const one = await decide(a.id, 1, q.bo.session, 1, { outcome: "approve", note: "Synthetic step 1 approval" });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.headers.etag).toBe('"1"');
    expect(one.body.steps.map((s: Body) => s.status)).toEqual(["approved", "active"]);
    expect(one.body.steps[0]).toMatchObject({ decidedBy: q.bo.id, decisionNote: "Synthetic step 1 approval" });
    expect(one.body.approvalStatus).toBe("pending");
    expect((await decisionItems(api, a.id, q.bo.id))[0]!.status).toBe("done");
    expect((await decisionItems(api, a.id, q.bo2.id))[0]!.status).toBe("done");
    expect((await decisionItems(api, a.id, q.fin.id)).map((i) => [i.status, i.dedupe_key])).toEqual([
      ["open", `approval_route:${a.id}:1:2:${q.fin.id}`],
    ]);
    expect(await notificationsOf(a.id, q.fin.id)).toHaveLength(1);
    // A BO holder cannot take step 2.
    const wrong = await decide(a.id, 2, q.bo2.session, 1);
    expect([wrong.status, wrong.body.code]).toEqual([403, "approval_route.not_step_approver"]);

    // Step 2 approves -> the approval is approved by the last decider (one canonical decision row).
    const two = await decide(a.id, 2, q.fin.session, 1);
    expect(two.status, JSON.stringify(two.body)).toBe(200);
    expect([two.body.approvalStatus, two.body.approvalVersion, two.headers.etag]).toEqual(["approved", 2, '"2"']);
    const row = await approvalRow(a.id);
    expect([row.status, row.decided_by]).toEqual(["approved", q.fin.id]);
    const decisions = await api.db
      .selectFrom("approval_decision")
      .select(["outcome", "decided_by"])
      .where("approval_id", "=", a.id)
      .execute();
    expect(decisions).toEqual([{ outcome: "approve", decided_by: q.fin.id }]);
    // One audit event per step row written: create x2, decide x2, activate x1.
    const steps = await api.db.selectFrom("approval_route_step").select("id").where("approval_id", "=", a.id).execute();
    const actions = (await Promise.all(steps.map((s) => auditOf(api.db, s.id)))).flat().map((e) => e.action);
    expect(actions.sort()).toEqual([
      "approval_route_step.activate",
      "approval_route_step.create",
      "approval_route_step.create",
      "approval_route_step.decide",
      "approval_route_step.decide",
    ]);
    // A decided step cannot be decided again.
    const again = await decide(a.id, 2, q.fin.session, 2);
    expect([again.status, again.body.code]).toEqual([422, "approval_route.step_not_active"]);
  });

  it("the requester never decides a step (403 approval_route.self_decision) and gets no step task", async () => {
    const { q } = await routedWorld(api, w, "sequential");
    await grant(api.db, w.grantor.id, q.lead.id, "BO", { type: "transformation", id: q.transformationId }, w.orgA.id);
    const a = await requestRouted(plainCaller(api), q);
    expect(await decisionItems(api, a.id, q.lead.id)).toEqual([]);
    const self = await decide(a.id, 1, q.lead.session, 1);
    expect([self.status, self.body.code, self.body.detail]).toEqual([
      403,
      "approval_route.self_decision",
      "You cannot decide a step of your own request.",
    ]);
    expect((await routeOf(a.id, { session: q.auditor.session })).body.steps[0].status).toBe("active");
  });

  it("commit-time re-authorization: a BO whose grant is revoked after sign-in is refused, nothing written", async () => {
    const { q } = await routedWorld(api, w, "sequential");
    const a = await requestRouted(plainCaller(api), q);
    await sql`UPDATE scoped_assignment SET revoked_at = now(), revoked_by = ${w.grantor.id}::uuid, revoke_reason = 'Synthetic revocation'
              WHERE user_id = ${q.bo.id}::uuid AND revoked_at IS NULL`.execute(api.db);
    const res = await decide(a.id, 1, q.bo.session, 1);
    expect([403, 404]).toContain(res.status);
    expect((await routeOf(a.id, { session: q.auditor.session })).body.steps[0].status).toBe("active");
  });
});

describe("parallel route (REQ-S10-015)", () => {
  it("every step is notified at once; one person decides at most one step; request changes -> next round", async () => {
    const { q } = await routedWorld(api, w, "parallel");
    const both = await holderOf(api, w, q, ["BO", "FIN"]);
    const a = await requestRouted(plainCaller(api), q);
    const view = await routeOf(a.id, { session: q.lead.session });
    expect(view.body.steps.map((s: Body) => s.status)).toEqual(["active", "active"]);
    for (const p of [q.bo, q.bo2, q.fin, both]) {
      expect(await decisionItems(api, a.id, p.id)).not.toEqual([]);
      expect(await notificationsOf(a.id, p.id)).not.toEqual([]);
    }
    const first = await decide(a.id, 1, both.session, 1);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.approvalStatus).toBe("pending");
    const twice = await decide(a.id, 2, both.session, 1);
    expect([twice.status, twice.body.code, twice.body.detail]).toEqual([
      403,
      "approval_route.one_step_per_person",
      "You have already decided another step of this approval.",
    ]);
    const changes = await decide(a.id, 2, q.fin.session, 1, {
      outcome: "request_changes",
      note: "Synthetic: add the cost breakdown",
    });
    expect(changes.status, JSON.stringify(changes.body)).toBe(200);
    expect(changes.body.approvalStatus).toBe("changes_requested");
    expect(changes.body.steps.map((s: Body) => s.status)).toEqual(["approved", "changes_requested"]);

    // Resubmission (a newer subject version) creates round 2's steps, all active again.
    const v2 = await editDecision(plainCaller(api), q, q.decisionId, 1);
    const resubmitted = await send("POST", `/api/v1/approvals/${a.id}/resubmit`, {
      session: q.lead.session,
      headers: ifm(changes.body.approvalVersion),
      body: { subjectVersion: v2 },
    });
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(200);
    const round2 = await routeOf(a.id, { session: q.lead.session });
    expect(round2.body.currentRoundNo).toBe(2);
    expect(round2.body.steps.map((s: Body) => [s.roundNo, s.stepNo, s.status])).toEqual([
      [1, 1, "approved"],
      [1, 2, "changes_requested"],
      [2, 1, "active"],
      [2, 2, "active"],
    ]);
    // In the new round the same person may decide again (one step per round).
    const r2 = await decide(a.id, 1, both.session, round2.body.approvalVersion);
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    const rej = await decide(a.id, 2, q.fin.session, round2.body.approvalVersion, {
      outcome: "reject",
      note: "Synthetic rejection",
    });
    expect([rej.status, rej.body.approvalStatus]).toEqual([200, "rejected"]);
  });

  it("a reject on one step cancels the other open step and rejects the approval", async () => {
    const { q } = await routedWorld(api, w, "parallel");
    const a = await requestRouted(plainCaller(api), q);
    const rej = await decide(a.id, 1, q.bo.session, 1, { outcome: "reject", note: "Synthetic rejection" });
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    expect([rej.body.approvalStatus, rej.body.steps.map((s: Body) => s.status)]).toEqual([
      "rejected",
      ["rejected", "cancelled"],
    ]);
    expect((await decisionItems(api, a.id, q.fin.id)).map((i) => i.status)).toEqual(["cancelled"]);
  });
});

describe("DG4 single-step approvals are unchanged (regression)", () => {
  for (const mode of [null, "any"] as const) {
    it(`no route (${mode ?? "shipped v1"}): no steps, the DG4 decision route decides it`, async () => {
      const { q } = await routedWorld(api, w, mode);
      const a = await requestRouted(plainCaller(api), q);
      const view = await routeOf(a.id, { session: q.auditor.session });
      expect(view.body).toMatchObject({ routed: false, routeKey: null, mode: null, steps: [] });
      expect(
        (await api.db.selectFrom("approval_route_step").select("id").where("approval_id", "=", a.id).execute()).length,
      ).toBe(0);
      // The DG4 assignee task exists (key approval.assign:...).
      const assignee = a.assignee.userId as string;
      expect((await decisionItems(api, a.id, assignee)).map((i) => i.dedupe_key.split(":")[0])).toEqual([
        "approval.assign",
      ]);
      const res = await send("POST", `/api/v1/approvals/${a.id}/decisions`, {
        session: assignee === q.bo.id ? q.bo.session : q.sponsor.session,
        headers: ifm(1),
        body: { outcome: "approve", rationale: "Synthetic demo decision", subjectVersion: 1 },
      });
      expect([res.status, res.body.status]).toEqual([200, "approved"]);
      const step = await send("POST", stepUrl(a.id, 1), {
        session: q.bo.session,
        headers: ifm(2),
        body: { outcome: "approve" },
      });
      expect(step.status).toBe(404);
    });
  }
});

describe("withdrawal and the admin route list", () => {
  it("withdrawing a routed approval cancels its open steps", async () => {
    const { q } = await routedWorld(api, w, "sequential");
    const a = await requestRouted(plainCaller(api), q);
    const res = await send("POST", `/api/v1/approvals/${a.id}/withdraw`, {
      session: q.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic withdrawal" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const view = await routeOf(a.id, { session: q.lead.session });
    expect(view.body.steps.map((s: Body) => s.status)).toEqual(["cancelled", "cancelled"]);
  });

  it("listApprovalRoutes: the version's routes (TL, AUD read); BO without methodology.read 403; unknown 400", async () => {
    const { q, versionId } = await routedWorld(api, w, "sequential", ["BO", "FIN", "SP"]);
    const res = await send("GET", `/api/v1/admin/approval-routes?versionId=${versionId}`, { session: q.lead.session });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      methodologyVersionId: versionId,
      items: [
        {
          routeKey: ROUTE_KEY,
          mode: "sequential",
          roleCodes: ["BO", "FIN", "SP"],
          source: "approver_route",
          labelEn: "Synthetic decision route",
          labelAr: "مسار قرار تجريبي",
        },
      ],
      nextCursor: null, // cursor-paged since T-DG6-BE-V (ADR-0007 §4a)
    });
    expect((await send("GET", "/api/v1/admin/approval-routes", { session: q.auditor.session })).status).toBe(200);
    expect((await send("GET", "/api/v1/admin/approval-routes", { session: q.bo.session })).status).toBe(403);
    const unknown = await send("GET", `/api/v1/admin/approval-routes?versionId=${q.decisionId}`, {
      session: q.lead.session,
    });
    expect(unknown.status).toBe(400);
  });
});
