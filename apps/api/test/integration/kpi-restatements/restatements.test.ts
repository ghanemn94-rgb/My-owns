// KPI prospective change and restatement (T-DG5-KBE-E; ADR-0047 §1, §2, §6-§9; p5-work-split §G.1; REQ-S07-016):
//  - (a) a target change approved through a DG4 change request and activated while Q2 is `scheduled` leaves Q1's
//    latest evaluation and RAG unchanged, and the next opened period is evaluated with the new version;
//  - the create refusals: an open period 422 period_not_closed; a draft version 422 version_not_approved; 25 periods
//    422 too_many_periods; none 422 periods_required; a second restatement in progress 409 open_exists; submitting a
//    draft whose periods have no value 422 nothing_to_reconcile;
//  - the retained reconciliation equals the draft preview, and Unknown/stale rows carry no number;
//  - one decision task per holder of kpi_restatement.approve except the requester, created once;
//  - withdrawing a decided restatement 422 not_withdrawable; only the requester withdraws;
//  - AUD 403 on every write; If-Match 428/409; one audit event per mutation; commit-time re-authorization.
// All data is SYNTHETIC. The change request is decided by a synthetic Business Owner (a demo business approval that
// approves nothing real). The one "decided" restatement below is a synthetic fixture row written directly, because the
// decision operation is KBE-E2's; it is labelled so and approves nothing. Nothing touches the engineering gates DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { seedKpiWorld, ifMatch, type KpiWorld } from "../kpi/fixtures.ts";
import { freshUser, postVersion } from "../kpi-p4/kbe-b-fixtures.ts";
import { approvedTrajectory, mapPartyTo, runRecalculation } from "../kpi-p4/kbe-c-fixtures.ts";
import {
  acceptedActual,
  createRestatement,
  latestEvaluation,
  quarter,
  quarterlyKpi,
  RESTATED_FLOW,
  reconciliationOf,
  restatementAction,
  stepQuarter,
  type Body,
  type Quarter,
} from "./fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let office: Session;
/** Quarters of 2072: q1 and q2 closed with values on the main KPI, q3 closed with no value, q4 open. */
let q1: Quarter;
let q2: Quarter;
let q3: Quarter;
let q4: Quarter;
let kpi: { id: string; v1: Body };
let staleKpi: { id: string; v1: Body };

const auditActions = async (recordId: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("record_id", "=", recordId)
      .orderBy("occurred_at")
      .orderBy("id")
      .execute()
  ).map((a) => a.action);
const restatementCount = async (kpiId: string) =>
  Number(
    (
      await api.db
        .selectFrom("kpi_restatement")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("kpi_definition_id", "=", kpiId)
        .executeTakeFirstOrThrow()
    ).n,
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  q1 = await quarter(api, w, 2072, 1, office);
  q2 = await quarter(api, w, 2072, 2, office);
  q3 = await quarter(api, w, 2072, 3, office);
  q4 = await quarter(api, w, 2072, 4, office);
  kpi = await quarterlyKpi(api, k);
  // A KPI whose actual is stale for ever (data as of 2026-01-15, stale after 30 days; the business date is later).
  staleKpi = await quarterlyKpi(api, k, {
    ...RESTATED_FLOW,
    dataQuality: { staleAfterDays: 30, validMin: null, validMax: null, evidenceRequired: false },
  });
  await stepQuarter(api, w, q1, "open", office);
  await acceptedActual(api, k, kpi.id, q1, "90");
  await acceptedActual(api, k, staleKpi.id, q1, "40", "2026-01-15");
  await stepQuarter(api, w, q1, "close", office);
  await stepQuarter(api, w, q2, "open", office);
  await acceptedActual(api, k, kpi.id, q2, "95");
  await stepQuarter(api, w, q2, "close", office);
  await stepQuarter(api, w, q3, "open", office);
  await stepQuarter(api, w, q3, "close", office);
  await stepQuarter(api, w, q4, "open", office);
}, 240_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-S07-016 (a): a KPI change applies prospectively", () => {
  it("a target change approved through a change request and activated while Q2 is scheduled leaves Q1's latest evaluation and RAG unchanged; the next opened period uses the new version", async () => {
    // Its own organization and quarters (2073), so 'Q2 scheduled' is literally true: no later period is open.
    const w2 = await seedWorld(api.db);
    const k2 = await seedKpiWorld(api, w2);
    const office2 = await signIn(api.app, w2.office.subject);
    const a1 = await quarter(api, w2, 2073, 1, office2);
    const a2 = await quarter(api, w2, 2073, 2, office2);
    const target = await quarterlyKpi(api, k2);
    // An approved trajectory (expected 100 all year) makes the RAG a real deviation (90 vs 100), not Unknown.
    await approvedTrajectory(api, k2, target.id, [
      { pointDate: "2073-01-01", expectedValue: "100" },
      { pointDate: "2073-12-31", expectedValue: "100" },
    ]);
    await stepQuarter(api, w2, a1, "open", office2);
    await acceptedActual(api, k2, target.id, a1, "90");
    await stepQuarter(api, w2, a1, "close", office2);
    const before = await latestEvaluation(api, target.id, a1.id);
    expect(before?.kpi_version_id).toBe(target.v1.id);
    expect(["green", "amber", "red"]).toContain(before?.calculated_rag);
    // The same rule for a trajectory approved now (expected 80 would make 90 green): no open period, no evaluation.
    const later = await approvedTrajectory(api, k2, target.id, [
      { pointDate: "2073-01-01", expectedValue: "80" },
      { pointDate: "2073-12-31", expectedValue: "80" },
    ]);
    expect((await runRecalculation(api, later.id)).map((r) => [r.outcome, r.evaluationCount])).toEqual([["done", 0]]);
    expect(await latestEvaluation(api, target.id, a1.id)).toEqual(before);

    // The target change: a draft version 2 (target 120), a DG4 change request decided by the Business Owner.
    const v2 = await postVersion(api, k2, target.id, {
      ...RESTATED_FLOW,
      targetValue: "120",
      changeReason: "Synthetic uplift",
    });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    await mapPartyTo(api, k2, "BO", k2.users.bo.id);
    const def = await call<Body>(api.app, "GET", `${k2.base}/kpi-definitions/${target.id}`, { session: k2.s.tl });
    const CR = `${k2.base}/change-requests`;
    const cr = await call<Body>(api.app, "POST", CR, {
      session: k2.s.tl,
      body: {
        changeKind: "target",
        subjectType: "kpi_definition",
        subjectId: target.id,
        subjectVersion: def.body.version,
        proposedRecordType: "kpi_version",
        proposedRecordId: v2.body.id,
        proposedChange: { targetValue: { from: "100", to: "120" } },
        reason: "Synthetic: a stretch target agreed by the business owner",
      },
    });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    const sub = await call<Body>(api.app, "POST", `${CR}/${cr.body.id}/submit`, {
      session: k2.s.tl,
      headers: ifMatch(1),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const appr = await call<Body>(api.app, "GET", `/api/v1/approvals/${sub.body.approvalId}`, { session: k2.s.bo });
    const decided = await call<Body>(api.app, "POST", `/api/v1/approvals/${sub.body.approvalId}/decisions`, {
      session: k2.s.bo,
      headers: ifMatch(appr.body.version),
      body: {
        outcome: "approve",
        rationale: "Synthetic demo decision; approves nothing real.",
        subjectVersion: appr.body.subjectVersion,
      },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const v2Now = await call<Body>(api.app, "GET", `${k2.base}/kpi-versions/${v2.body.id}`, { session: k2.s.tl });
    expect(v2Now.body.status).toBe("active");
    expect(
      (await call<Body>(api.app, "GET", `${k2.base}/kpi-versions/${target.v1.id}`, { session: k2.s.tl })).body.status,
    ).toBe("superseded");

    // The activation's run: Q2 is scheduled, Q1 closed, so there is no open period: zero evaluations, run completed.
    const runs = await runRecalculation(api, v2.body.id);
    expect(runs.map((r) => [r.outcome, r.evaluationCount])).toEqual([["done", 0]]);
    const run = await api.db
      .selectFrom("calculation_run")
      .select(["status", "evaluation_count"])
      .where("trigger_kind", "=", "version_activated")
      .where("trigger_record_id", "=", v2.body.id)
      .executeTakeFirstOrThrow();
    expect([run.status, run.evaluation_count]).toEqual(["completed", 0]);
    const after = await latestEvaluation(api, target.id, a1.id);
    expect(after).toEqual(before);
    const status = await call<Body>(
      api.app,
      "GET",
      `${k2.base}/kpi-definitions/${target.id}/status?reportingPeriodId=${a1.id}`,
      {
        session: k2.s.auditor,
        contract: false,
      },
    );
    expect(status.status).toBeLessThan(500);

    // The next period, opened later, is evaluated with the new version (target 120).
    await stepQuarter(api, w2, a2, "open", office2);
    await acceptedActual(api, k2, target.id, a2, "110");
    const q2Eval = await latestEvaluation(api, target.id, a2.id);
    expect([q2Eval?.kpi_version_id, q2Eval?.final_target]).toEqual([v2.body.id, "120.000000"]);
    // Q1 still reads its pre-change evaluation.
    expect(await latestEvaluation(api, target.id, a1.id)).toEqual(before);
  });
});

describe("createKpiRestatement refusals (ADR-0047 §8)", () => {
  it("open period 422; draft version 422; 25 periods 422; none 422; duplicate ids 400; outsiders 403; AUD 403; nothing written", async () => {
    const own = await quarterlyKpi(api, k);
    const draft = await postVersion(api, k, own.id, {
      ...RESTATED_FLOW,
      targetValue: "130",
      changeReason: "Synthetic draft",
    });
    expect(draft.status).toBe(201);
    const base = {
      kpiVersionId: own.v1.id,
      reportingPeriodIds: [q1.id],
      reason: "Synthetic: a corrected source extract",
    };
    const refusal = async (body: object, session?: Session) => {
      const r = await createRestatement(api, k, own.id, body, session);
      return [r.status, r.body.code, r.body.detail, r.body.errors?.[0]?.pointer];
    };
    expect(await refusal({ ...base, reportingPeriodIds: [q1.id, q4.id] })).toEqual([
      422,
      "kpi_restatement.period_not_closed",
      "Only closed reporting periods of the KPI's frequency can be restated; an open period takes the new version from now on.",
      "/reportingPeriodIds/1",
    ]);
    expect(await refusal({ ...base, kpiVersionId: draft.body.id })).toEqual([
      422,
      "kpi_restatement.version_not_approved",
      "A restatement applies an approved KPI version (active or superseded) of this KPI.",
      "/kpiVersionId",
    ]);
    // A version of another KPI is not "of this KPI".
    expect((await refusal({ ...base, kpiVersionId: kpi.v1.id }))[1]).toBe("kpi_restatement.version_not_approved");
    const ids25 = Array.from({ length: 25 }, () => crypto.randomUUID());
    expect(await refusal({ ...base, reportingPeriodIds: ids25 })).toEqual([
      422,
      "kpi_restatement.too_many_periods",
      "A restatement covers at most 24 reporting periods.",
      "/reportingPeriodIds",
    ]);
    expect(await refusal({ ...base, reportingPeriodIds: [] })).toEqual([
      422,
      "kpi_restatement.periods_required",
      "Select at least one closed reporting period to restate.",
      "/reportingPeriodIds",
    ]);
    expect((await refusal({ ...base, reportingPeriodIds: [q1.id, q1.id] }))[0]).toBe(400);
    expect((await refusal({ ...base, reason: "  " }))[0]).toBe(400);
    expect((await refusal({ ...base, extra: 1 }))[0]).toBe(400);
    expect((await refusal({ ...base, reportingPeriodIds: [crypto.randomUUID()] }))[1]).toBe("validation.reference");
    expect((await refusal(base, k.s.auditor))[0]).toBe(403);
    // A write is authorized at commit time, so a caller outside the transformation gets 403 (commitTimeDenial).
    expect((await refusal(base, k.s.outsider))[0]).toBe(403);
    expect((await refusal(base, k.s.nobody))[0]).toBe(403);
    expect(await restatementCount(own.id)).toBe(0);
  });

  it("a second restatement in progress is 409 open_exists; submitting periods without a value is 422 nothing_to_reconcile", async () => {
    const own = await quarterlyKpi(api, k);
    const first = await createRestatement(api, k, own.id, {
      kpiVersionId: own.v1.id,
      reportingPeriodIds: [q3.id],
      reason: "Synthetic: nothing was reported",
    });
    expect([first.status, first.body.status, first.body.version, first.headers.etag]).toEqual([201, "draft", 1, '"1"']);
    expect(first.headers.location).toBe(`${k.base}/kpi-restatements/${first.body.id}`);
    const second = await createRestatement(api, k, own.id, {
      kpiVersionId: own.v1.id,
      reportingPeriodIds: [q1.id],
      reason: "Synthetic: a second attempt",
    });
    expect([second.status, second.body.code, second.body.detail]).toEqual([
      409,
      "kpi_restatement.open_exists",
      "This KPI already has a restatement in progress.",
    ]);
    const empty = await restatementAction(api, k, first.body.id, "submit", 1);
    expect([empty.status, empty.body.code, empty.body.detail]).toEqual([
      422,
      "kpi_restatement.nothing_to_reconcile",
      "None of the selected periods has a value to restate.",
    ]);
    const still = await call<Body>(api.app, "GET", `${k.base}/kpi-restatements/${first.body.id}`, {
      session: k.s.auditor,
    });
    expect([still.body.status, still.body.version]).toEqual(["draft", 1]);
    // A KPI with a value in q1 but none in q3: the period without a value is named, nothing is written.
    const mixed = await createRestatement(api, k, kpi.id, {
      kpiVersionId: kpi.v1.id,
      reportingPeriodIds: [q1.id, q3.id],
      reason: "Synthetic: two quarters",
    });
    expect(mixed.status).toBe(201);
    const partial = await restatementAction(api, k, mixed.body.id, "submit", 1);
    expect([partial.status, partial.body.code, partial.body.errors[0].pointer]).toEqual([
      422,
      "kpi_restatement.nothing_to_reconcile",
      "/periods/1",
    ]);
    const rows = await api.db
      .selectFrom("kpi_restatement_reconciliation")
      .select("id")
      .where("restatement_id", "=", mixed.body.id)
      .execute();
    expect(rows).toEqual([]);
    expect((await restatementAction(api, k, mixed.body.id, "withdraw", 1)).status).toBe(200);
    expect((await restatementAction(api, k, first.body.id, "withdraw", 1)).status).toBe(200);
    // Once withdrawn, a new restatement may start.
    const third = await createRestatement(api, k, own.id, {
      kpiVersionId: own.v1.id,
      reportingPeriodIds: [q3.id],
      reason: "Synthetic: after the withdrawal",
    });
    expect(third.status).toBe(201);
    expect((await restatementAction(api, k, third.body.id, "withdraw", 1)).status).toBe(200);
  });
});

describe("submitKpiRestatement: the retained reconciliation (M0163)", () => {
  it("the retained reconciliation equals the draft preview; Unknown/stale rows carry no number; one decision task per approver except the requester", async () => {
    const requester = k.s.finKds; // holds kpi_restatement.request (KDS) and .approve (FIN): never their own task
    const created = await createRestatement(
      api,
      k,
      kpi.id,
      { kpiVersionId: kpi.v1.id, reportingPeriodIds: [q2.id, q1.id], reason: "Synthetic: corrected extracts" },
      requester,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.periods.map((p: Body) => p.periodLabel)).toEqual(["2072-Q1", "2072-Q2"]);
    expect(created.body.requestedBy).toBe(k.users.finKds.id);
    const preview = await reconciliationOf(api, k, created.body.id);
    expect([preview.status, preview.body.retained]).toEqual([200, false]);
    // Nothing is stored by the preview.
    expect(
      await api.db
        .selectFrom("kpi_restatement_reconciliation")
        .select("id")
        .where("restatement_id", "=", created.body.id)
        .execute(),
    ).toEqual([]);
    const rows = preview.body.rows as Body[];
    // q1 and q2, transformation scope, bases period and cumulative: 4 rows, in period order.
    expect(rows.map((r) => [r.periodLabel, r.scopeKind, r.valueBasis])).toEqual([
      ["2072-Q1", "transformation", "period"],
      ["2072-Q1", "transformation", "cumulative"],
      ["2072-Q2", "transformation", "period"],
      ["2072-Q2", "transformation", "cumulative"],
    ]);
    const q1Period = rows[0];
    const q1Eval = await latestEvaluation(api, kpi.id, q1.id);
    expect(q1Period.before).toEqual({
      evaluationId: q1Eval!.id,
      kpiVersionId: kpi.v1.id,
      value: "90",
      valueStatus: "ok",
      rag: q1Eval!.calculated_rag,
      target: "100",
    });
    expect(q1Period.after).toMatchObject({ value: "90", valueStatus: "ok", target: "100" });
    expect(q1Period.difference).toBe("0");
    expect([q1Period.unitKind, q1Period.currency]).toEqual(["count", null]);
    expect(rows[3].before.value).toBe("185"); // YTD flow: 90 + 95

    const submitted = await restatementAction(api, k, created.body.id, "submit", 1, requester);
    expect([submitted.status, submitted.body.status, submitted.body.version, submitted.headers.etag]).toEqual([
      200,
      "submitted",
      2,
      '"2"',
    ]);
    expect(submitted.body.submittedAt).not.toBeNull();
    const retained = await reconciliationOf(api, k, created.body.id);
    expect(retained.body.retained).toBe(true);
    expect(retained.body.rows).toEqual(rows);
    const stored = await api.db
      .selectFrom("kpi_restatement")
      .select(["period_count", "reconciliation_count"])
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect([stored.period_count, stored.reconciliation_count]).toEqual([2, 4]);
    // Retained, not recomputed: a later evaluation of the slot does not change the stored reconciliation.
    expect((await reconciliationOf(api, k, created.body.id)).body.rows).toEqual(rows);

    // One decision task per holder of kpi_restatement.approve in the transformation (SP, BO, FIN roles), never the
    // requester, with the dedupe key kpi_restatement:<restatementId>:<userId>.
    const items = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "dedupe_key", "kind", "message_key", "link_path", "status"])
      .where("subject_type", "=", "kpi_restatement")
      .where("subject_id", "=", created.body.id)
      .orderBy("assignee_user_id")
      .execute();
    const approvers = [k.users.sp.id, k.users.bo.id, k.users.fin.id, k.users.finTl.id].sort();
    expect(items.map((i) => i.assignee_user_id)).toEqual(approvers);
    for (const i of items) {
      expect(i.dedupe_key).toBe(`kpi_restatement:${created.body.id}:${i.assignee_user_id}`);
      expect([i.kind, i.message_key, i.status]).toEqual([
        "kpi_restatement_to_decide",
        "kpi_restatement.to_decide",
        "open",
      ]);
      expect(i.link_path).toBe(`/transformations/${k.transformationId}/kpi-restatements/${created.body.id}`);
    }
    // Submitting again: 422 not_draft, nothing more written.
    const again = await restatementAction(api, k, created.body.id, "submit", 2, requester);
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "kpi_restatement.not_draft",
      "Only a draft restatement can be changed or submitted.",
    ]);
    expect(await auditActions(created.body.id)).toEqual(["kpi_restatement.create", "kpi_restatement.submit"]);

    // Withdrawn by the requester: the decision tasks are cancelled.
    const bo = await restatementAction(api, k, created.body.id, "withdraw", 2, k.s.bo);
    expect([bo.status, bo.body.code]).toEqual([403, "forbidden"]);
    const withdrawn = await restatementAction(api, k, created.body.id, "withdraw", 2, requester);
    expect([withdrawn.status, withdrawn.body.status, withdrawn.body.withdrawnBy]).toEqual([
      200,
      "withdrawn",
      k.users.finKds.id,
    ]);
    const after = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_type", "=", "kpi_restatement")
      .where("subject_id", "=", created.body.id)
      .execute();
    expect(after.map((i) => i.status)).toEqual(["cancelled", "cancelled", "cancelled", "cancelled"]);
    // The retained reconciliation stays readable after the withdrawal.
    expect((await reconciliationOf(api, k, created.body.id)).body).toEqual({
      restatementId: created.body.id,
      retained: true,
      rows,
    });
  });

  it("stale and unknown sides carry no number (never 0) and no difference", async () => {
    const created = await createRestatement(api, k, staleKpi.id, {
      kpiVersionId: staleKpi.v1.id,
      reportingPeriodIds: [q1.id],
      reason: "Synthetic: an old extract",
    });
    expect(created.status).toBe(201);
    const preview = await reconciliationOf(api, k, created.body.id);
    const rows = preview.body.rows as Body[];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect([r.before.valueStatus, r.before.value, r.before.rag]).toEqual(["stale", null, "stale"]);
      expect([r.after.valueStatus, r.after.value, r.after.rag]).toEqual(["stale", null, "stale"]);
      expect(r.difference).toBeNull();
    }
    expect((await restatementAction(api, k, created.body.id, "submit", 1)).status).toBe(200);
    const retained = await reconciliationOf(api, k, created.body.id);
    expect(retained.body).toEqual({ restatementId: created.body.id, retained: true, rows });
    // The database keeps the stale number (its CHECK requires one), the API never shows it.
    const stored = await api.db
      .selectFrom("kpi_restatement_reconciliation")
      .select(["before_value", "before_value_status", "difference"])
      .where("restatement_id", "=", created.body.id)
      .where("value_basis", "=", "period")
      .executeTakeFirstOrThrow();
    expect([stored.before_value, stored.before_value_status, stored.difference]).toEqual(["40.000000", "stale", null]);
    expect((await restatementAction(api, k, created.body.id, "withdraw", 2)).status).toBe(200);
  });
});

describe("the reconciliation of a formula KPI", () => {
  it("a formula KPI's after side binds each input to its source's latest evaluation (a + a over 21 gives 42, difference 0)", async () => {
    const p = await quarter(api, w, 2075, 1, office);
    await stepQuarter(api, w, p, "open", office);
    const source = await quarterlyKpi(api, k);
    const formula = await quarterlyKpi(api, k, {
      ...RESTATED_FLOW,
      calculationMethod: "formula",
      formulaExpression: "a + a",
      formulaInputs: [{ variableName: "a", sourceKpiDefinitionId: source.id, inputBasis: "period" }],
    });
    // The source's accepted value; its run also evaluates the formula KPI that reads it (the DG4 reader rule).
    await acceptedActual(api, k, source.id, p, "21");
    await stepQuarter(api, w, p, "close", office);
    const evaluated = await latestEvaluation(api, formula.id, p.id);
    expect([evaluated?.value, evaluated?.value_status]).toEqual(["42.000000", "ok"]);
    const created = await createRestatement(api, k, formula.id, {
      kpiVersionId: formula.v1.id,
      reportingPeriodIds: [p.id],
      reason: "Synthetic: formula check",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const rows = (await reconciliationOf(api, k, created.body.id)).body.rows as Body[];
    expect(rows.map((r) => [r.valueBasis, r.before.value, r.after.value, r.after.valueStatus, r.difference])).toEqual([
      ["period", "42", "42", "ok", "0"],
      ["cumulative", "42", "42", "ok", "0"],
    ]);
    expect((await restatementAction(api, k, created.body.id, "withdraw", 1)).status).toBe(200);
  });
});

describe("withdrawKpiRestatement and the shared mutation rules", () => {
  it("withdrawing a decided restatement is 422 not_withdrawable (synthetic decided fixture)", async () => {
    const created = await createRestatement(api, k, kpi.id, {
      kpiVersionId: kpi.v1.id,
      reportingPeriodIds: [q1.id],
      reason: "Synthetic: to be decided",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await restatementAction(api, k, created.body.id, "submit", 1)).status).toBe(200);
    // SYNTHETIC fixture: the decision operation is KBE-E2's, so the approved state is written directly, with the
    // authority the database requires and its audit event. It approves nothing real.
    await api.db.transaction().execute(async (tx) => {
      await tx
        .updateTable("kpi_restatement")
        .set({
          status: "approved",
          decided_by: k.users.bo.id,
          decided_at: new Date(),
          authority_permission: "kpi_restatement.approve",
          authority_role_code: "BO",
          version: 3,
          updated_by: k.users.bo.id,
        })
        .where("id", "=", created.body.id)
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: k.users.bo.id, requestId: `fixture-${created.body.id}`, source: "api" },
        {
          action: "kpi_restatement.decide",
          recordType: "kpi_restatement",
          recordId: created.body.id,
          organizationId: w.orgA.id,
          transformationId: k.transformationId,
          priorVersion: 2,
          newVersion: 3,
        },
      );
    });
    const r = await restatementAction(api, k, created.body.id, "withdraw", 3);
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "kpi_restatement.not_withdrawable",
      "A decided restatement cannot be withdrawn.",
    ]);
  });

  it("AUD 403 on every write; If-Match 428/409; one audit event per mutation; commit-time re-authorization", async () => {
    const own = await quarterlyKpi(api, k);
    const body = { kpiVersionId: own.v1.id, reportingPeriodIds: [q3.id], reason: "Synthetic: rules probe" };
    expect((await createRestatement(api, k, own.id, body, k.s.auditor)).status).toBe(403);
    const c = await createRestatement(api, k, own.id, body);
    expect(c.status).toBe(201);
    expect(await auditActions(c.body.id)).toEqual(["kpi_restatement.create"]);
    for (const action of ["submit", "withdraw"] as const) {
      expect((await restatementAction(api, k, c.body.id, action, 1, k.s.auditor)).status).toBe(403);
      expect((await restatementAction(api, k, c.body.id, action, null)).status).toBe(428);
      expect((await restatementAction(api, k, c.body.id, action, 7)).status).toBe(409);
      expect((await restatementAction(api, k, crypto.randomUUID(), action, 1)).status).toBe(404);
      expect((await restatementAction(api, k, c.body.id, action, 1, k.s.outsider)).status).toBe(403);
    }
    // Every refusal of the AUD user is audited as authorization.denied (the create and the two actions).
    const denied = await api.db
      .selectFrom("audit_event")
      .select("action")
      .where("action", "=", "authorization.denied")
      .where("actor_user_id", "=", k.users.auditor.id)
      .where("transformation_id", "=", k.transformationId)
      .execute();
    expect(denied.length).toBeGreaterThanOrEqual(3);
    const w1 = await restatementAction(api, k, c.body.id, "withdraw", 1);
    expect([w1.status, w1.body.status, w1.body.version]).toEqual([200, "withdrawn", 2]);
    expect(await auditActions(c.body.id)).toEqual(
      expect.arrayContaining(["kpi_restatement.create", "kpi_restatement.withdraw"]),
    );
    expect((await auditActions(c.body.id)).filter((a) => a.startsWith("kpi_restatement.")).length).toBe(2);
    // Withdrawn is terminal.
    expect((await restatementAction(api, k, c.body.id, "withdraw", 2)).body.code).toBe(
      "kpi_restatement.not_withdrawable",
    );

    // Commit-time: a KDS whose grant is revoked while the request waits gets 403, and nothing is written.
    const kds = await freshUser(api, k, w.orgA.id, w.grantor.id, "KDS");
    const revoked = await afterIdentity(
      api,
      kds.id,
      () => createRestatement(api, k, own.id, body, kds.session),
      () => revokeAll(api, w.grantor.id, kds.id),
    );
    expect(revoked.status).toBe(403);
    expect(await restatementCount(own.id)).toBe(1);
    // ... and on submit: a fresh requester's draft, the grant revoked meanwhile.
    const kds2 = await freshUser(api, k, w.orgA.id, w.grantor.id, "KDS");
    const d = await createRestatement(api, k, own.id, body, kds2.session);
    expect(d.status).toBe(201);
    const late = await afterIdentity(
      api,
      kds2.id,
      () => restatementAction(api, k, d.body.id, "submit", 1, kds2.session),
      () => revokeAll(api, w.grantor.id, kds2.id),
    );
    expect(late.status).toBe(403);
    const still = await call<Body>(api.app, "GET", `${k.base}/kpi-restatements/${d.body.id}`, { session: k.s.auditor });
    expect([still.body.status, still.body.version]).toEqual(["draft", 1]);
  });

  it("reads: list newest first with periods; get 404 outside the transformation; 400 on a malformed id", async () => {
    const list = await call<Body>(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/restatements?limit=1`, {
      session: k.s.auditor,
    });
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(1);
    expect(list.body.nextCursor).not.toBeNull();
    const next = await call<Body>(
      api.app,
      "GET",
      `${k.base}/kpi-definitions/${kpi.id}/restatements?limit=1&cursor=${encodeURIComponent(list.body.nextCursor)}`,
      { session: k.s.auditor },
    );
    expect(next.status).toBe(200);
    expect(next.body.items[0].id < list.body.items[0].id).toBe(true);
    const id = list.body.items[0].id;
    expect((await call(api.app, "GET", `${k.base}/kpi-restatements/${id}`, { session: k.s.outsider })).status).toBe(
      404,
    );
    expect((await call(api.app, "GET", `${k.base}/kpi-restatements/not-a-uuid`, { session: k.s.auditor })).status).toBe(
      400,
    );
    expect(
      (
        await call(api.app, "GET", `${k.base}/kpi-definitions/${crypto.randomUUID()}/restatements`, {
          session: k.s.auditor,
        })
      ).status,
    ).toBe(404);
  });
});
