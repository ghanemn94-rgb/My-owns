// Benefit transition decisions (T-DG4-BE-J; ADR-0034 §3, §6, §9, §12; REQ-S11-007; M0218). Proves, against the run's
// disposable PostgreSQL:
//  - create (BO, FIN): TD-nn, version 1, audited; 422 transition_decision.monitoring_after_end at /firstMonitoringDate,
//    422 transition_decision.benefit_validated, 409 transition_decision.exists, 422 validation.reference (exact texts);
//    AUD/WL/TL 403, ADM-only and an outsider 404; S-1 rationale; nothing written on a refusal;
//  - update and withdraw: If-Match 428/409; a withdrawn decision is final (422 transition_decision.final, exact text);
//  - submit: the canonical approval of type benefit_transition_decision routed to SP; the decision shows `submitted`
//    and its content is frozen (422 transition_decision.frozen); the requester cannot decide it (SoD); the SP approves:
//    `approved`, decided stamps, nextMonitoringDate = firstMonitoringDate; changes requested -> editable draft, resubmit
//    through the decision's own submit (T-DG4-BE-R2), then approve; reject -> `rejected`, final; a decision withdrawn
//    while its approval is pending withdraws that approval in the same transaction (T-DG4-BE-R2);
//  - REQ-S11-007 A11: after the transition decision the benefit's forecast is still reported as forecast (the value
//    series, the benefit row, its lifecycle step and its measurements are unchanged; nothing is validated or sustained;
//    the value status is `transition`), and monitoring tasks appear for the residual owner (a `sustainment_review` of
//    subject transition_decision and a `benefit_monitoring_due` work item in their My Work), exactly once;
//  - parity (D-102 (2)): the worker's runMonitoringScan writes the same rows as the API's scheduleMonitoringReviews.
// All data is SYNTHETIC; the decisions are synthetic in-product business approvals of test data made by a test user,
// never by the requester, a job or an agent, and nothing touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMonitoringScan } from "../../../../worker/src/handlers/sustainment.ts";
import { organizationBusinessDate } from "../../../src/modules/sustainment/controls.ts";
import { valueStatusOf } from "../../../src/modules/sustainment/status-model.ts";
import { scheduleMonitoringReviews } from "../../../src/modules/sustainment/transition-decisions.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  decideDecision,
  draftDecision,
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  validatedBenefit,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";

let api: TestApi;
let w: World;
let c: ClosureWorld;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const decisionRow = (id: string) =>
  api.db.selectFrom("transition_decision").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
/** A pending benefit of a fresh launched initiative of world `x`. */
async function freshBenefit(x: ClosureWorld = c) {
  const ini = await launchedInitiative(api.db, x.b);
  return { ini, ...(await pendingBenefit(api, x, ini)) };
}
const plusDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

describe("create (ADR-0034 §3, §12)", () => {
  it("BO and FIN draft; TD-nn, version 1, audited; one live decision per benefit (409 transition_decision.exists)", async () => {
    const ben = await freshBenefit();
    const td = await draftDecision(send, c, ben.id);
    expect([td.code.startsWith("TD-"), td.version, td.status]).toEqual([true, 1, "draft"]);
    const audit = await auditOf(api.db, td.id);
    expect(audit.map((a) => [a.action, a.new_version])).toEqual([["transition_decision.create", 1]]);
    const dup = await send("POST", c.transitions, {
      session: c.b.s.fin,
      body: {
        benefitId: ben.id,
        residualOwnerUserId: c.b.users.fin.id,
        rationale: "Synthetic duplicate",
        expectedRealizationEnd: "2031-12-31",
        monitoringFrequency: "quarterly",
        firstMonitoringDate: "2030-03-01",
      },
    });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "transition_decision.exists",
      "This benefit already has a transition decision in progress or approved.",
    ]);
    const other = await freshBenefit();
    const byFin = await send("POST", c.transitions, {
      session: c.b.s.fin,
      body: {
        benefitId: other.id,
        residualOwnerUserId: c.b.users.fin.id,
        rationale: "Synthetic: FIN proposes",
        expectedRealizationEnd: "2031-12-31",
        monitoringFrequency: "quarterly",
        monitoringInterval: 2,
        firstMonitoringDate: "2030-03-01",
      },
    });
    expect([byFin.status, byFin.body.monitoringInterval, byFin.body.nextMonitoringDate]).toEqual([201, 2, null]);
  });

  it("422 monitoring_after_end, benefit_validated and validation.reference (exact texts); nothing written", async () => {
    const ben = await freshBenefit();
    const late = await send("POST", c.transitions, {
      session: c.b.s.bo,
      body: {
        benefitId: ben.id,
        residualOwnerUserId: c.b.users.bo2.id,
        rationale: "Synthetic",
        expectedRealizationEnd: "2030-01-01",
        monitoringFrequency: "monthly",
        firstMonitoringDate: "2030-01-02",
      },
    });
    expect([late.status, late.body.code, late.body.detail, late.body.errors[0].pointer]).toEqual([
      422,
      "transition_decision.monitoring_after_end",
      "The first monitoring date must be on or before the expected realization end.",
      "/firstMonitoringDate",
    ]);
    const ini = await launchedInitiative(api.db, c.b);
    const validated = await validatedBenefit(api, c, ini);
    const v = await send("POST", c.transitions, {
      session: c.b.s.bo,
      body: {
        benefitId: validated.id,
        residualOwnerUserId: c.b.users.bo2.id,
        rationale: "Synthetic",
        expectedRealizationEnd: "2031-01-01",
        monitoringFrequency: "monthly",
        firstMonitoringDate: "2030-01-02",
      },
    });
    expect([v.status, v.body.code, v.body.detail]).toEqual([
      422,
      "transition_decision.benefit_validated",
      "This benefit already has Finance-validated value; a transition decision is for value still to be realized.",
    ]);
    const missing = await send("POST", c.transitions, {
      session: c.b.s.bo,
      body: {
        benefitId: randomUUID(),
        residualOwnerUserId: c.b.users.bo2.id,
        rationale: "Synthetic",
        expectedRealizationEnd: "2031-01-01",
        monitoringFrequency: "monthly",
        firstMonitoringDate: "2030-01-02",
      },
    });
    expect([missing.status, missing.body.code, missing.body.errors[0].pointer]).toEqual([
      422,
      "validation.reference",
      "/benefitId",
    ]);
    const n = await api.db
      .selectFrom("transition_decision")
      .select("id")
      .where("benefit_id", "in", [ben.id, validated.id])
      .execute();
    expect(n).toEqual([]);
  }, 60_000);

  it("AUD, WL and TL 403; ADM-only and an outsider 404; S-1 rationale; nothing written", async () => {
    const ben = await freshBenefit();
    const body = {
      benefitId: ben.id,
      residualOwnerUserId: c.b.users.bo2.id,
      rationale: "Synthetic",
      expectedRealizationEnd: "2031-01-01",
      monitoringFrequency: "monthly",
      firstMonitoringDate: "2030-01-02",
    };
    for (const session of [c.b.s.auditor, c.s.wl.session, c.b.s.tl])
      expect((await send("POST", c.transitions, { session, body })).status).toBe(403);
    for (const session of [c.b.s.admin, c.b.s.outsider]) {
      expect((await send("POST", c.transitions, { session, body })).status).toBe(404);
      expect((await send("GET", c.transitions, { session })).status).toBe(404);
    }
    const blank = await send("POST", c.transitions, { session: c.b.s.bo, body: { ...body, rationale: "   " } });
    expect([blank.status, blank.body.errors[0].pointer]).toEqual([400, "/rationale"]);
    const nul = await send("POST", c.transitions, { session: c.b.s.bo, body: { ...body, rationale: "Bad\u0000text" } });
    expect([nul.status, nul.body.errors[0].pointer]).toEqual([400, "/rationale"]);
    const n = await api.db.selectFrom("transition_decision").select("id").where("benefit_id", "=", ben.id).execute();
    expect(n).toEqual([]);
  });
});

describe("commit-time authorization (S-4)", () => {
  it("a BO revoked after the identity hook gets 403 on create and on submit; nothing is written", async () => {
    const bo3 = await extraUser(api, w, c.b, "BO");
    const ben = await freshBenefit();
    const body = {
      benefitId: ben.id,
      residualOwnerUserId: c.b.users.bo2.id,
      rationale: "Synthetic",
      expectedRealizationEnd: "2031-01-01",
      monitoringFrequency: "monthly",
      firstMonitoringDate: "2030-01-02",
    };
    const res = await afterIdentity(
      api,
      bo3.id,
      () => call(api.app, "POST", c.transitions, { session: bo3.session, body, contract: false }),
      () => revokeAll(api, w.grantor.id, bo3.id),
    );
    expect(res.status).toBe(403);
    expect(
      await api.db.selectFrom("transition_decision").select("id").where("benefit_id", "=", ben.id).execute(),
    ).toEqual([]);
    const fin2 = await extraUser(api, w, c.b, "FIN");
    const td = await draftDecision(send, c, ben.id);
    const sub = await afterIdentity(
      api,
      fin2.id,
      () =>
        call(api.app, "POST", `${c.transitions}/${td.id}/submit`, {
          session: fin2.session,
          headers: ifm(1),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, fin2.id),
    );
    expect(sub.status).toBe(403);
    expect(await api.db.selectFrom("approval").select("id").where("subject_id", "=", td.id).execute()).toEqual([]);
  });
});

describe("update and withdraw (ADR-0034 §3)", () => {
  it("edits a draft (If-Match 428/409, audited); withdraws; a withdrawn decision is final; the benefit is free again", async () => {
    const ben = await freshBenefit();
    const td = await draftDecision(send, c, ben.id);
    const D = `${c.transitions}/${td.id}`;
    expect((await send("PATCH", D, { session: c.b.s.bo, body: { monitoringInterval: 3 } })).status).toBe(428);
    expect(
      (await send("PATCH", D, { session: c.b.s.bo, headers: ifm(9), body: { monitoringInterval: 3 } })).status,
    ).toBe(409);
    const after = await send("PATCH", D, {
      session: c.b.s.bo,
      headers: ifm(1),
      body: { firstMonitoringDate: "2032-01-01" },
    });
    expect([after.status, after.body.code]).toEqual([422, "transition_decision.monitoring_after_end"]);
    const ok = await send("PATCH", D, {
      session: c.b.s.fin,
      headers: ifm(1),
      body: { monitoringInterval: 3, residualOwnerUserId: c.b.users.fin.id },
    });
    expect([ok.status, ok.body.version, ok.body.monitoringInterval, ok.body.residualOwnerUserId]).toEqual([
      200,
      2,
      3,
      c.b.users.fin.id,
    ]);
    const wd = await send("PATCH", D, { session: c.b.s.bo, headers: ifm(2), body: { status: "withdrawn" } });
    expect([wd.status, wd.body.status, wd.body.version]).toEqual([200, "withdrawn", 3]);
    const fin = await send("PATCH", D, { session: c.b.s.bo, headers: ifm(3), body: { rationale: "Synthetic" } });
    expect([fin.status, fin.body.code, fin.body.detail]).toEqual([
      422,
      "transition_decision.final",
      "This transition decision is withdrawn and can no longer be changed.",
    ]);
    const sub = await send("POST", `${D}/submit`, { session: c.b.s.bo, headers: ifm(3) });
    expect([sub.status, sub.body.code]).toEqual([422, "transition_decision.final"]);
    expect((await auditOf(api.db, td.id)).map((a) => a.action)).toEqual([
      "transition_decision.create",
      "transition_decision.update",
      "transition_decision.withdraw",
    ]);
    // A withdrawn decision is not live: a new one may be drafted for the benefit.
    expect((await draftDecision(send, c, ben.id)).status).toBe("draft");
  });
});

describe("decision through the canonical approval (ADR-0034 §3; ADR-0026 §4)", () => {
  it("submit routes to SP; the decision is frozen; the requester cannot decide; SP approves", async () => {
    const ben = await freshBenefit();
    const td = await draftDecision(send, c, ben.id);
    const D = `${c.transitions}/${td.id}`;
    expect((await send("POST", `${D}/submit`, { session: c.b.s.bo })).status).toBe(428);
    for (const session of [c.b.s.auditor, c.s.wl.session])
      expect((await send("POST", `${D}/submit`, { session, headers: ifm(1) })).status).toBe(403);
    const sub = await send("POST", `${D}/submit`, { session: c.b.s.bo, headers: ifm(1) });
    expect([sub.status, sub.body.status, sub.body.version]).toEqual([200, "submitted", 1]);
    const approval = await api.db
      .selectFrom("approval")
      .selectAll()
      .where("id", "=", sub.body.approvalId)
      .executeTakeFirstOrThrow();
    expect([
      approval.approval_type,
      approval.subject_type,
      approval.subject_id,
      approval.subject_version,
      approval.assignee_party_code,
      approval.assignee_user_id,
      approval.sod_policy,
      approval.requested_by,
      approval.status,
    ]).toEqual([
      "benefit_transition_decision",
      "transition_decision",
      td.id,
      1,
      "SP",
      c.sp.id,
      "requester_excluded",
      c.b.users.bo.id,
      "pending",
    ]);
    const again = await send("POST", `${D}/submit`, { session: c.b.s.bo, headers: ifm(1) });
    expect([again.status, again.body.code]).toEqual([422, "transition_decision.final"]);
    const frozen = await send("PATCH", D, {
      session: c.b.s.bo,
      headers: ifm(1),
      body: { rationale: "Synthetic edit" },
    });
    expect([frozen.status, frozen.body.code, frozen.body.detail]).toEqual([
      422,
      "transition_decision.frozen",
      "A submitted transition decision cannot be edited.",
    ]);
    const listed = await send("GET", `${c.transitions}?status=submitted&benefitId=${ben.id}`, {
      session: c.b.s.auditor,
    });
    expect(listed.body.items.map((x: { id: string }) => x.id)).toEqual([td.id]);
    const drafts = await send("GET", `${c.transitions}?status=draft&benefitId=${ben.id}`, { session: c.b.s.auditor });
    expect(drafts.body.items).toEqual([]);
    // The requester (a BO, who holds approval.decide) cannot decide their own request (SoD requester_excluded).
    const own = await send("POST", `/api/v1/approvals/${approval.id}/decisions`, {
      session: c.b.s.bo,
      headers: ifm(approval.version),
      body: { outcome: "approve", rationale: "Synthetic self-approval", subjectVersion: 1 },
    });
    expect(own.status).toBe(403);
    const decided = await send("POST", `/api/v1/approvals/${approval.id}/decisions`, {
      session: c.sp.session,
      headers: ifm(approval.version),
      body: { outcome: "approve", rationale: "Synthetic decision on synthetic data", subjectVersion: 1 },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const got = await send("GET", D, { session: c.b.s.auditor });
    expect([got.body.status, got.body.decidedBy, typeof got.body.decidedAt, got.body.nextMonitoringDate]).toEqual([
      "approved",
      c.sp.id,
      "string",
      "2030-01-15",
    ]);
    expect((await auditOf(api.db, td.id)).map((a) => a.action)).toEqual([
      "transition_decision.create",
      "transition_decision.submit",
      "transition_decision.approve",
    ]);
    const fin = await send("PATCH", D, {
      session: c.b.s.bo,
      headers: ifm(got.body.version),
      body: { status: "withdrawn" },
    });
    expect([fin.status, fin.body.detail]).toEqual([
      422,
      "This transition decision is approved and can no longer be changed.",
    ]);
  });

  it("changes requested: an editable draft again; resubmitted through the approval; then approved", async () => {
    const ben = await freshBenefit();
    const td = await draftDecision(send, c, ben.id);
    const D = `${c.transitions}/${td.id}`;
    const approvalId = await decideDecision(send, c, td, "request_changes");
    const back = await send("GET", D, { session: c.b.s.bo });
    expect([back.body.status, back.body.approvalId]).toEqual(["draft", approvalId]);
    const edited = await send("PATCH", D, {
      session: c.b.s.bo,
      headers: ifm(back.body.version),
      body: { rationale: "Synthetic: realization curve documented as requested" },
    });
    expect(edited.status).toBe(200);
    // T-DG4-BE-R2 (ADR-0026 amendment A4): submitting the edited draft resubmits the same approval on its version.
    const re = await send("POST", `${D}/submit`, { session: c.b.s.bo, headers: ifm(edited.body.version) });
    expect([re.status, re.body.status, re.body.approvalId], JSON.stringify(re.body)).toEqual([
      200,
      "submitted",
      approvalId,
    ]);
    const a = await send("GET", `/api/v1/approvals/${approvalId}`, { session: c.b.s.bo });
    expect([a.body.status, a.body.roundNo, a.body.subjectVersion]).toEqual(["pending", 2, edited.body.version]);
    const frozen = await send("PATCH", D, {
      session: c.b.s.bo,
      headers: ifm(edited.body.version),
      body: { monitoringInterval: 2 },
    });
    expect(frozen.body.code).toBe("transition_decision.frozen");
    const a2 = await send("GET", `/api/v1/approvals/${approvalId}`, { session: c.sp.session });
    const ok = await send("POST", `/api/v1/approvals/${approvalId}/decisions`, {
      session: c.sp.session,
      headers: ifm(a2.body.version),
      body: { outcome: "approve", rationale: "Synthetic decision", subjectVersion: edited.body.version },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await send("GET", D, { session: c.b.s.auditor })).body.status).toBe("approved");
  });

  it("reject: rejected and final; withdrawing a decision in approval withdraws its approval (nothing left undecidable)", async () => {
    const ben = await freshBenefit();
    const td = await draftDecision(send, c, ben.id);
    await decideDecision(send, c, td, "reject");
    const row = await decisionRow(td.id);
    expect([row.status, row.decided_by, row.next_monitoring_date]).toEqual(["rejected", c.sp.id, null]);

    const ben2 = await freshBenefit();
    const td2 = await draftDecision(send, c, ben2.id);
    const D2 = `${c.transitions}/${td2.id}`;
    const sub = await send("POST", `${D2}/submit`, { session: c.b.s.bo, headers: ifm(1) });
    const wd = await send("PATCH", D2, { session: c.b.s.bo, headers: ifm(1), body: { status: "withdrawn" } });
    expect([wd.status, wd.body.status]).toEqual([200, "withdrawn"]);
    // T-DG4-BE-R2 (ADR-0026 amendment A4): the approval was withdrawn first, in the same transaction; it is final.
    const a = await send("GET", `/api/v1/approvals/${sub.body.approvalId}`, { session: c.sp.session });
    expect(a.body.status).toBe("withdrawn");
    const closed = await send("POST", `/api/v1/approvals/${sub.body.approvalId}/decisions`, {
      session: c.sp.session,
      headers: ifm(a.body.version),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect([closed.status, closed.body.code]).toEqual([422, "approval.not_open"]);
    expect((await decisionRow(td2.id)).status).toBe("withdrawn");
  });
});

describe("REQ-S11-007: forecast stays forecast; monitoring tasks for the residual owner (ADR-0034 §3, §6)", () => {
  it("after the decision nothing is validated or sustained, and the residual owner gets the monitoring task once", async () => {
    const ini = await launchedInitiative(api.db, c.b);
    const ben = await pendingBenefit(api, c, ini);
    const B = `${c.b.base}/benefits/${ben.id}`;
    const beforeValues = await send("GET", `${B}/values`, { session: c.b.s.auditor });
    expect(beforeValues.status).toBe(200);
    const beforeRow = await api.db.selectFrom("benefit").selectAll().where("id", "=", ben.id).executeTakeFirstOrThrow();
    const measurements = () =>
      api.db.selectFrom("benefit_measurement").select("id").where("benefit_id", "=", ben.id).execute();
    const beforeMeasurements = await measurements();
    const today = await organizationBusinessDate(api.db, c.b.organizationId, new Date());
    const first = plusDays(today, 3);
    const td = await draftDecision(send, c, ben.id, {
      firstMonitoringDate: first,
      expectedRealizationEnd: plusDays(today, 400),
    });
    await decideDecision(send, c, td);

    // Forecast stays forecast: the value series, the benefit and its measurements are exactly as before.
    expect((await send("GET", `${B}/values`, { session: c.b.s.auditor })).body).toEqual(beforeValues.body);
    const afterRow = await api.db.selectFrom("benefit").selectAll().where("id", "=", ben.id).executeTakeFirstOrThrow();
    expect([afterRow.version, afterRow.lifecycle_step, afterRow.bau_owner_user_id]).toEqual([
      beforeRow.version,
      beforeRow.lifecycle_step,
      beforeRow.bau_owner_user_id,
    ]);
    expect(await measurements()).toEqual(beforeMeasurements);
    const value = await valueStatusOf(api.db, {
      kind: "initiative",
      transformationId: c.b.transformationId,
      initiativeId: ini,
    });
    expect([value.status, value.benefits.map((b) => b.state)]).toEqual(["validated_with_transition", ["transition"]]);
    const sm = await send("GET", `/api/v1/initiatives/${ini}/status-model`, { session: c.b.s.auditor });
    expect(sm.body.value).toBe("validated_with_transition");

    // Monitoring tasks for the residual owner (BO2), created with the approval because the date is inside the horizon.
    const reviews = await api.db
      .selectFrom("sustainment_review")
      .selectAll()
      .where("transition_decision_id", "=", td.id)
      .execute();
    expect(reviews.map((r) => [r.subject_kind, String(r.due_date).slice(0, 10), r.assignee_user_id, r.status])).toEqual(
      [["transition_decision", first, c.b.users.bo2.id, "due"]],
    );
    const mine = await send("GET", "/api/v1/me/work-items?status=open", { session: c.b.s.bo2 });
    const task = mine.body.items.find((i: { subjectId: string }) => i.subjectId === reviews[0]!.id);
    expect([task?.kind, task?.dueDate, task?.assigneeUserId]).toEqual([
      "benefit_monitoring_due",
      first,
      c.b.users.bo2.id,
    ]);
    const listed = await send("GET", `${c.b.base}/sustainment-reviews?status=due`, { session: c.b.s.bo2 });
    expect(listed.body.items.map((r: { id: string }) => r.id)).toContain(reviews[0]!.id);
    const row = await decisionRow(td.id);
    expect(String(row.next_monitoring_date).slice(0, 10)).toBe(nextMonth(first));

    // Exactly once: the API service and the worker scan, run again for the same day, create nothing.
    await api.db.transaction().execute((tx) => scheduleMonitoringReviews(tx, today, { decisionId: td.id }));
    const scan = await runMonitoringScan(api.db, `test-${td.id}`, { asOf: today, organizationId: c.b.organizationId });
    expect(scan.steps.filter((s) => s.subjectId === td.id)).toEqual([]);
    expect(
      await api.db.selectFrom("sustainment_review").select("id").where("transition_decision_id", "=", td.id).execute(),
    ).toHaveLength(1);
    // The residual owner completes the monitoring review (the assignee only).
    const done = await send("POST", `${c.b.base}/sustainment-reviews/${reviews[0]!.id}/complete`, {
      session: c.b.s.bo2,
      headers: ifm(1),
      body: { outcomeNote: "Synthetic: realization on track", performanceSignal: "on_track" },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  }, 60_000);

  it("parity (D-102 (2)): the worker's runMonitoringScan writes the same rows as the API's scheduleMonitoringReviews", async () => {
    // A separate organization, so the worker scan sees only this test's decisions.
    const w2 = await seedWorld(api.db);
    const x = await seedClosureWorld(api, w2);
    const a = await draftDecision(send, x, (await freshBenefit(x)).id, { firstMonitoringDate: "2031-06-05" });
    const b = await draftDecision(send, x, (await freshBenefit(x)).id, { firstMonitoringDate: "2031-06-05" });
    await decideDecision(send, x, a);
    await decideDecision(send, x, b);
    const asOf = "2031-06-01";
    const viaApi = await api.db
      .transaction()
      .execute((tx) => scheduleMonitoringReviews(tx, asOf, { decisionId: a.id }));
    const viaWorker = await runMonitoringScan(api.db, `test-parity-${b.id}`, {
      asOf,
      organizationId: x.b.organizationId,
    });
    expect(viaApi.map((s) => [s.dueDate, s.outcome])).toEqual([["2031-06-05", "created"]]);
    expect(viaWorker.steps.map((s) => [s.subjectId, s.dueDate, s.outcome])).toEqual([[b.id, "2031-06-05", "created"]]);
    const shape = async (decisionId: string) => {
      const r = await api.db
        .selectFrom("sustainment_review")
        .selectAll()
        .where("transition_decision_id", "=", decisionId)
        .executeTakeFirstOrThrow();
      const wi = await api.db
        .selectFrom("work_item")
        .selectAll()
        .where("subject_id", "=", r.id)
        .executeTakeFirstOrThrow();
      const d = await decisionRow(decisionId);
      const audit = await auditOf(api.db, r.id);
      return {
        review: [
          r.subject_kind,
          String(r.due_date).slice(0, 10),
          r.assignee_user_id,
          r.status,
          r.cycle_no,
          r.created_source,
          r.created_by,
          r.version,
        ],
        workItem: [
          wi.kind,
          wi.assignee_user_id,
          wi.subject_type,
          wi.message_key,
          String(wi.due_date).slice(0, 10),
          wi.status,
          wi.dedupe_key === `sustainment.monitoring:${decisionId}:2031-06-05`,
        ],
        decision: [String(d.next_monitoring_date).slice(0, 10), d.status],
        audit: audit.map((e) => [e.action, e.actor_type]),
        decisionAudit: (await auditOf(api.db, decisionId))
          .slice(-1)
          .map((e) => [e.action, e.actor_type, e.prior_version !== null]),
      };
    };
    const fromApi = await shape(a.id);
    expect(await shape(b.id)).toEqual(fromApi);
    expect(fromApi.review).toEqual([
      "transition_decision",
      "2031-06-05",
      x.b.users.bo2.id,
      "due",
      null,
      "worker",
      null,
      1,
    ]);
    expect(fromApi.decision).toEqual(["2031-07-05", "approved"]);
  }, 60_000);
});

/** One calendar month after a YYYY-MM-DD date (the monthly monitoring step; day-of-month kept, as PostgreSQL does). */
function nextMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
