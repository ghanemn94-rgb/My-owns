// KPI actuals against a real PostgreSQL (T-DG4-KBE-C; ADR-0027 §6, §8, §11-§13):
//  - REQ-S07-003 "a second actual for the same KPI, scope and period is stored as a new version, not a duplicate row";
//  - REQ-S07-012 "on the review route a submitted value is not used until accepted; on the direct-accept route it is
//    used at once" (accepted_value_no is the value in force);
//  - REQ-S07-013 (API half) one accept writes exactly one audit event on the slot and one kpi.actual_accepted event;
//  - REQ-S07-017 the routine update in one request: the response lists downstream, reviewPending and financeReview;
//  - "not available" is NULL with a reason, never 0; the exact ADR-0027 §13 refusals; owner, reviewer and SoD rules;
//  - review tasks and the correction task through createWorkItemOnce; the review queue;
//  - every mutation: If-Match 428/409, AUD 403, ADM-only 403, nothing written on a refusal.
// All data is synthetic; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import {
  actualAction,
  DIRECT_FLOW,
  evidenceItem,
  mapPartyTo,
  monthlyPeriod,
  outboxOf,
  ownedKpi,
  REVIEW_FLOW,
  submitActual,
  type Body,
} from "./kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let adm: Session;
let period: { id: string; label: string };
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  adm = await signIn(api.app, w.admin.subject);
  await mapPartyTo(api, k, "BO", k.users.bo.id);
  period = await monthlyPeriod(api, w);
}, 60_000);
afterAll(() => api.close());

const problem = (res: { status: number; body: Body }, status: number, code: string, detail?: string) => {
  expect([res.status, res.body.code], JSON.stringify(res.body)).toEqual([status, code]);
  if (detail !== undefined) expect(res.body.detail).toBe(detail);
};
const getActual = (id: string) => call<Body>(api.app, "GET", `${k.base}/kpi-actuals/${id}`, { session: k.s.auditor });
const slotsOf = (kpiId: string) =>
  api.db.selectFrom("kpi_actual").selectAll().where("kpi_definition_id", "=", kpiId).execute();

describe("direct-accept route (REQ-S07-012, REQ-S07-013, REQ-S07-017)", () => {
  it("accepts at once: one slot, value 1 in force, one audit event, one kpi.actual_accepted event", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const res = await submitActual(api, k, kpi.id, {
      reportingPeriodId: period.id,
      value: "120.5",
      comment: "Synthetic",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.location).toBe(`${k.base}/kpi-actuals/${res.body.actual.id}`);
    expect(res.headers.etag).toBe(`"${res.body.actual.version}"`);
    const a = res.body.actual;
    expect([a.status, a.route, a.currentValueNo, a.acceptedValueNo, a.periodLabel]).toEqual([
      "accepted",
      "direct_accept",
      1,
      1,
      period.label,
    ]);
    expect(a.values[0]).toMatchObject({ valueNo: 1, value: "120.5", missingReason: null, kpiVersionId: kpi.versionId });
    expect(a.reviews).toEqual([
      expect.objectContaining({ valueNo: 1, outcome: "direct_accept", decidedBy: k.users.kds.id }),
    ]);
    // REQ-S07-017: the response lists the downstream views, whether review is pending and the Finance review state.
    expect(res.body.reviewPending).toBe(false);
    // T-DG4-KBE-E registers slice B's DownstreamImpactProvider (ADR-0030 §6): this KPI feeds no benefit.
    expect(res.body.financeReview).toBe("not_applicable");
    expect(res.body.downstream.map((d: Body) => d.kind)).toEqual(["kpi_panel", "executive_overview_outcomes"]);
    expect(res.body.downstream[0]).toEqual({ kind: "kpi_panel", id: kpi.id, labelKey: "kpi.downstream.kpi_panel" });
    // Exactly one audit event on the slot and one outbox event for the accepted value.
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual(["kpi_actual.accepted"]);
    const events = await outboxOf(api, a.id);
    expect(events.map((e) => [e.event_type, e.idempotency_key])).toEqual([
      ["kpi.actual_accepted", `kpi.actual_accepted:${a.id}:1`],
    ]);
    expect(events[0]!.payload).toMatchObject({ kpiActualId: a.id, valueNo: 1, kpiDefinitionId: kpi.id });
  });

  it("REQ-S07-003: a second actual for the same slot is value version 2 of the same row, never a duplicate row", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const first = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "10" });
    expect(first.status).toBe(201);
    // The routine-update POST on an existing slot is 409 (use addKpiActualValue); nothing written.
    const dup = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "11" });
    expect([dup.status, dup.body.currentVersion]).toEqual([409, first.body.actual.version]);
    const second = await actualAction(api, k, first.body.actual.id, "values", first.body.actual.version, {
      action: "submit",
      value: "12",
      dataAsOf: "2041-01-31",
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect([
      second.body.actual.currentValueNo,
      second.body.actual.acceptedValueNo,
      second.body.actual.values.length,
    ]).toEqual([2, 2, 2]);
    expect((await slotsOf(kpi.id)).length).toBe(1);
    expect((await outboxOf(api, first.body.actual.id)).map((e) => e.idempotency_key)).toEqual([
      `kpi.actual_accepted:${first.body.actual.id}:1`,
      `kpi.actual_accepted:${first.body.actual.id}:2`,
    ]);
  });

  it("'not available' is stored as NULL with its reason, never 0", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const res = await submitActual(api, k, kpi.id, {
      reportingPeriodId: period.id,
      missingReason: "Synthetic: the source system was down",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.actual.values[0]).toMatchObject({
      value: null,
      missingReason: "Synthetic: the source system was down",
    });
  });
});

describe("review route (REQ-S07-012)", () => {
  it("a submitted value is not used until a reviewer accepts it; the accept writes one audit event", async () => {
    const kpi = await ownedKpi(api, k, REVIEW_FLOW);
    const ev = await evidenceItem(api, k);
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "7", evidenceIds: [ev] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = res.body.actual;
    expect([a.status, a.acceptedValueNo, res.body.reviewPending]).toEqual(["submitted", null, true]);
    expect(a.values[0].evidenceIds).toEqual([ev]);
    expect(await outboxOf(api, a.id)).toEqual([]);
    // One review task for the mapped Business Owner.
    const tasks = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "dedupe_key", "status"])
      .where("subject_id", "=", a.id)
      .execute();
    expect(tasks).toEqual([
      {
        kind: "kpi_actual_review",
        assignee_user_id: k.users.bo.id,
        dedupe_key: `kpi.actual_review:${a.id}:1:${k.users.bo.id}`,
        status: "open",
      },
    ]);
    // The review queue of the Business Owner lists it; the submitter's does not.
    const queue = await call<Body>(api.app, "GET", `${k.base}/kpi-actual-reviews`, { session: k.s.bo });
    expect(queue.body.items.map((i: Body) => i.id)).toContain(a.id);
    const own = await call<Body>(api.app, "GET", `${k.base}/kpi-actual-reviews`, { session: k.s.kds });
    expect(own.body.items).toEqual([]);

    // Not the submitter (SoD), not someone outside the reviewer party, not without If-Match.
    problem(await actualAction(api, k, a.id, "accept", a.version, {}, k.s.kds), 403, "forbidden");
    problem(
      await actualAction(api, k, a.id, "accept", a.version, {}, k.s.sp),
      403,
      "kpi_actual.not_reviewer",
      "Only the KPI's configured reviewer can accept or reject this actual.",
    );
    expect((await actualAction(api, k, a.id, "accept", null, {})).status).toBe(428);
    expect((await actualAction(api, k, a.id, "accept", a.version + 3, {})).status).toBe(409);
    expect((await auditOf(api.db, a.id)).length).toBe(1);

    const before = (await auditOf(api.db, a.id)).length;
    const accepted = await actualAction(api, k, a.id, "accept", a.version, { comment: "Synthetic check" });
    expect(
      [accepted.status, accepted.body.status, accepted.body.acceptedValueNo],
      JSON.stringify(accepted.body),
    ).toEqual([200, "accepted", 1]);
    expect(accepted.headers.etag).toBe(`"${accepted.body.version}"`);
    const events = await auditOf(api.db, a.id);
    expect(events.length - before).toBe(1);
    expect(events.at(-1)!.action).toBe("kpi_actual.accepted");
    expect((await outboxOf(api, a.id)).map((e) => e.event_type)).toEqual(["kpi.actual_accepted"]);
    const closed = await api.db.selectFrom("work_item").select("status").where("subject_id", "=", a.id).execute();
    expect(closed).toEqual([{ status: "done" }]);
    problem(
      await actualAction(api, k, a.id, "accept", accepted.body.version, {}),
      422,
      "kpi_actual.not_submitted",
      "Only a submitted value can be accepted or rejected.",
    );
  });

  it("the submitter who is also a reviewer is refused by separation of duties", async () => {
    const kpi = await ownedKpi(api, k, { ...REVIEW_FLOW }, { stewardUserId: k.users.bo.id });
    // The Business Owner is the steward, so may submit, and is the reviewer party: SoD refuses the self-accept.
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "3" }, k.s.bo);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    problem(
      await actualAction(api, k, res.body.actual.id, "accept", res.body.actual.version, {}),
      403,
      "kpi_actual.sod_submitter",
      "You submitted this value, so you cannot accept or reject it.",
    );
  });

  it("a rejection needs a reason and gives the submitter a correction task; a new value answers it", async () => {
    const kpi = await ownedKpi(api, k, REVIEW_FLOW);
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "9" });
    const a = res.body.actual;
    problem(
      await actualAction(api, k, a.id, "reject", a.version, {}),
      422,
      "kpi_actual.reject_reason_required",
      "A rejection needs a reason.",
    );
    const rejected = await actualAction(api, k, a.id, "reject", a.version, { reason: "Synthetic: wrong month" });
    expect([rejected.status, rejected.body.status, rejected.body.decisionReason]).toEqual([
      200,
      "rejected",
      "Synthetic: wrong month",
    ]);
    const correction = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "status"])
      .where("subject_id", "=", a.id)
      .where("kind", "=", "kpi_actual_rejected")
      .execute();
    expect(correction).toEqual([{ kind: "kpi_actual_rejected", assignee_user_id: k.users.kds.id, status: "open" }]);
    // A corrected value (draft, then submit) answers the correction task.
    const draft = await actualAction(api, k, a.id, "values", rejected.body.version, {
      action: "save_draft",
      value: "10",
      dataAsOf: "2041-01-31",
    });
    expect([draft.status, draft.body.actual.status, draft.body.actual.currentValueNo]).toEqual([200, "draft", 2]);
    const submitted = await actualAction(api, k, a.id, "submit", draft.body.actual.version);
    expect([submitted.status, submitted.body.actual.status, submitted.body.reviewPending]).toEqual([
      200,
      "submitted",
      true,
    ]);
    const after = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", a.id)
      .where("kind", "=", "kpi_actual_rejected")
      .execute();
    expect(after).toEqual([{ status: "done" }]);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual([
      "kpi_actual.submit",
      "kpi_actual.rejected",
      "kpi_actual.save_draft",
      "kpi_actual.submit",
    ]);
  });

  it("an unmapped reviewer party is 422 routing.role_unmapped and nothing is written", async () => {
    const other = await seedKpiWorld(api, w);
    const kpi = await ownedKpi(api, other, REVIEW_FLOW);
    const res = await submitActual(api, other, kpi.id, { reportingPeriodId: period.id, value: "1" });
    expect([res.status, res.body.code]).toEqual([422, "routing.role_unmapped"]);
    expect(await slotsOf(kpi.id)).toEqual([]);
  });
});

describe("refusals of the routine update (ADR-0027 §13)", () => {
  it("no active version, period, frequency, scope, currency, shape and evidence, with the exact texts", async () => {
    const draftOnly = await call<Body>(api.app, "POST", `${k.base}/kpi-definitions`, {
      session: k.s.kds,
      body: {
        name: "Synthetic KPI without version",
        unitKind: "count",
        unitLabel: "lines",
        polarity: "higher_is_better",
        frequency: "monthly",
        ownerUserId: k.users.kds.id,
      },
    });
    problem(
      await submitActual(api, k, draftOnly.body.id, { reportingPeriodId: period.id, value: "1" }),
      422,
      "kpi_actual.no_active_version",
      "This KPI has no active version. Activate a version with its aggregation rule before entering actuals.",
    );
    const kpi = await ownedKpi(api, k, {
      ...DIRECT_FLOW,
      dataQuality: { evidenceRequired: true, staleAfterDays: 45, validMin: null, validMax: null },
    });
    const scheduled = await monthlyPeriod(api, w, { scheduled: true });
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: scheduled.id, value: "1" }),
      422,
      "kpi_actual.period_not_open",
      `The reporting period ${scheduled.label} is scheduled. Actuals are entered only for an open period; a closed period is corrected through a restatement.`,
    );
    const to = await signIn(api.app, w.office.subject);
    const quarter = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/reporting-periods`, {
      session: to,
      body: { frequency: "quarterly", periodLabel: "2048-Q1", periodStart: "2048-01-01", periodEnd: "2048-03-31" },
    });
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: quarter.body.id, value: "1" }),
      422,
      "kpi_actual.period_frequency",
      "A monthly KPI is reported for monthly periods.",
    );
    problem(
      await submitActual(api, k, kpi.id, {
        reportingPeriodId: period.id,
        value: "1",
        scopeKind: "business_unit",
        scopeId: w.a1,
      }),
      422,
      "kpi_actual.scope_kind",
      "This KPI is reported per transformation.",
    );
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "1", scopeId: w.a2 }),
      422,
      "kpi.scope_invalid",
    );
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "1", currency: "SAR" }),
      422,
      "kpi_actual.currency_mismatch",
      "The value is in SAR, but the KPI is measured in no currency. Values are never converted.",
    );
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, numerator: "1", denominator: "2" }),
      422,
      "kpi_actual.value_shape",
      "Enter a value for this KPI, or state why the value is not available.",
    );
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "1" }),
      422,
      "kpi_actual.evidence_required",
      "This KPI's data-quality rule requires evidence with every submitted value.",
    );
    // A draft does not need the evidence yet.
    const draft = await submitActual(api, k, kpi.id, {
      reportingPeriodId: period.id,
      value: "1",
      action: "save_draft",
    });
    expect([draft.status, draft.body.actual.status]).toEqual([201, "draft"]);
    problem(
      await actualAction(api, k, draft.body.actual.id, "submit", draft.body.actual.version),
      422,
      "kpi_actual.evidence_required",
    );
    // JSON numbers are 400 (decimal strings only).
    expect((await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: 1 })).status).toBe(400);
  });

  it("SAR + USD: a currency KPI refuses another currency (never converted)", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "currency", unitLabel: null, currency: "SAR" });
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "100", currency: "USD" }),
      422,
      "kpi_actual.currency_mismatch",
      "The value is in USD, but the KPI is measured in SAR. Values are never converted.",
    );
    const ok = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "100" });
    expect([ok.status, ok.body.actual.values[0].currency]).toEqual([201, "SAR"]);
  });

  it("only the owner, steward or update assignee submits; AUD and ADM-only 403; nothing written", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    problem(
      await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "1" }, k.s.bo),
      403,
      "kpi_actual.not_owner",
      "Only the KPI's owner or steward, or the person assigned its update, can submit its actuals.",
    );
    expect((await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "1" }, k.s.auditor)).status).toBe(
      403,
    );
    expect((await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "1" }, adm)).status).toBe(403);
    expect(await slotsOf(kpi.id)).toEqual([]);
  });

  it("reads: the slot and the KPI's slots (AUD 200), 404 outside the transformation", async () => {
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "5" });
    const got = await getActual(res.body.actual.id);
    expect([got.status, got.headers.etag, got.body.id]).toEqual([200, `"${got.body.version}"`, res.body.actual.id]);
    const list = await call<Body>(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}/actuals?status=accepted`, {
      session: k.s.auditor,
    });
    expect(list.body.items.map((i: Body) => i.id)).toEqual([res.body.actual.id]);
    const outsider = await signIn(api.app, w.officeB.subject);
    expect(
      (await call(api.app, "GET", `${k.base}/kpi-actuals/${res.body.actual.id}`, { session: outsider })).status,
    ).toBe(404);
  });
});
