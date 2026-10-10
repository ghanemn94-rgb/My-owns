// A11 "Adoption and sustainment", part 2: delivery completion alone does not close value realization (qa-verifier,
// T-DG4-QA-C). Every assertion is derived from the acceptance text of the requirement row named in its title
// (docs/delivery/requirements.csv) and from docs/api/openapi.yaml:
//  - REQ-S03-003: setting delivery to Complete leaves adoption, validated value and closure unchanged; the API rejects a
//    closure request while validated value is pending unless a transition decision exists;
//  - REQ-PB-009: delivery Complete and no validated benefit cannot be closed (422 invalid-transition); the label is
//    'Delivered — value validation pending';
//  - REQ-S11-006: with all initiatives complete and value pending the transformation shows 'Delivery complete - value
//    validation pending', never 'successful';
//  - REQ-S08-002: completing the enabling deliverable leaves validated value at zero and marks the benefit 'enabled - not
//    yet measured';
//  - REQ-PB-074: a benefit cannot enter Measure without the Plan outputs; Sustain needs a BAU owner and a control cadence;
//  - REQ-S11-007: after the transition decision the forecast is still forecast and monitoring tasks appear for the
//    residual owner;
//  - REQ-PB-085: a benefit below plan creates one corrective action and a repeated evaluation does not duplicate it; a KPI
//    deviation persisting two cycles under a two-cycle rule creates one case and the third cycle updates it.
// The worker functions are the exported production job functions, given the relay's envelope of the real outbox rows.
// All data is SYNTHETIC. Finance validations, transition approvals and deliverable acceptances here are synthetic
// in-product decisions of test data; nothing grants a real business, Finance or IT approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, startApi, type TestApi } from "../support/api.ts";
import {
  approvedTrajectory,
  canon,
  DIRECT_FLOW,
  expectCode,
  get200,
  ifMatch,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  runRecalculation,
  seedKpiWorld,
  seedWorld,
  submitActual,
  type Body,
  type KpiWorld,
  type World,
} from "../support/p4.ts";
import {
  businessToday,
  decideDecision,
  draftDecision,
  envelopesOf,
  financialBody,
  handleBenefitVariance,
  handleKpiDeviation,
  launchedInitiative,
  pendingBenefit,
  runMonitoringScan,
  seedClosureWorld,
  validatedBenefit,
  type ClosureWorld,
} from "../support/a11.ts";
import { approve, submittedValue } from "../../../apps/api/test/integration/benefits/value-fixtures.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const closureRecords = (transformationId: string) =>
  api.db.selectFrom("closure_record").select("id").where("transformation_id", "=", transformationId).execute();
const plusDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// ================================================================================================ separate statuses

describe("A11 REQ-S03-003, REQ-PB-009: delivery Complete changes neither adoption, validated value nor closure", () => {
  let c: ClosureWorld;
  let initiativeId: string;
  let benefit: { id: string };
  beforeAll(async () => {
    c = await seedClosureWorld(api, w);
    initiativeId = await launchedInitiative(api.db, c.b);
    benefit = await pendingBenefit(api, c, initiativeId);
  }, 120_000);
  const model = () => get200(api, c.b.s.auditor, `/api/v1/initiatives/${initiativeId}/status-model`);

  it("REQ-S03-003: delivery Complete leaves adoption, value and closure exactly as they were", async () => {
    const before = await model();
    expect(before.delivery).not.toBe("completed");
    const r = await send("POST", `/api/v1/initiatives/${initiativeId}/complete-delivery`, {
      session: c.s.wl.session,
      headers: ifMatch(before.version),
      body: { note: "Synthetic QA: every deliverable is live" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = await model();
    expect(after.delivery).toBe("completed");
    expect([after.adoption, after.adoptionSource, after.value, after.closure, after.closureRecordId]).toEqual([
      before.adoption,
      before.adoptionSource,
      before.value,
      before.closure,
      before.closureRecordId,
    ]);
    expect(after.value).toBe("validation_pending");
    expect(after.closure).toBe("open");
  });

  it("REQ-PB-009: the label is exactly 'Delivered — value validation pending', never 'successful'", async () => {
    const m = await model();
    expect(m.label).toBe("Delivered — value validation pending");
    expect(JSON.stringify(m)).not.toMatch(/success/i);
  });

  it("REQ-PB-009, REQ-S03-003: closing while validated value is pending is 422 invalid-transition; nothing is written", async () => {
    const r = await send("POST", `/api/v1/initiatives/${initiativeId}/close`, {
      session: c.b.s.tl,
      body: { note: "Synthetic QA: try to close on delivery alone" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.type).toBe("urn:mth:problem:invalid-transition");
    expect(String(r.headers["content-type"])).toContain("application/problem+json");
    const rows = await api.db
      .selectFrom("closure_record")
      .select("id")
      .where("initiative_id", "=", initiativeId)
      .execute();
    expect(rows).toEqual([]);
    expect((await model()).closure).toBe("open");
  });

  it("REQ-S03-003: with an approved transition decision for the pending benefit the closure is accepted", async () => {
    const td = await draftDecision(send, c, benefit.id);
    // A drafted (not yet approved) decision does not unlock closure.
    const early = await send("POST", `/api/v1/initiatives/${initiativeId}/close`, { session: c.b.s.tl, body: {} });
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    await decideDecision(send, c, td);
    const r = await send("POST", `/api/v1/initiatives/${initiativeId}/close`, { session: c.b.s.tl, body: {} });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const m = await model();
    expect(m.closure).toBe("closed");
    expect(m.closureRecordId).toBe(r.body.id);
    // The value is not relabelled validated by the closure: it is the transition basis.
    expect(m.value).toBe("validated_with_transition");
    expect(m.label).not.toMatch(/success/i);
  });
});

describe("A11 REQ-S11-006: all initiatives complete with value pending: 'Delivery complete - value validation pending'", () => {
  it("REQ-S11-006: the transformation shows delivery complete and value pending as separate states, never successful", async () => {
    const c = await seedClosureWorld(api, w);
    const ids = [await launchedInitiative(api.db, c.b), await launchedInitiative(api.db, c.b)];
    for (const id of ids) {
      await pendingBenefit(api, c, id);
      const r = await send("POST", `/api/v1/initiatives/${id}/complete-delivery`, {
        session: c.s.wl.session,
        headers: ifMatch(1),
        body: {},
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const t = await get200(api, c.b.s.auditor, `${c.b.base}/status-model`);
    expect(t.label).toBe("Delivery complete - value validation pending");
    expect([t.deliveryState, t.valueState, t.closureState]).toEqual([
      "delivery_complete",
      "validation_pending",
      "open",
    ]);
    expect(t.initiatives).toEqual({ total: 2, completed: 2 });
    expect(JSON.stringify(t)).not.toMatch(/success/i);
    // Delivery completion alone does not close the transformation.
    const close = await send("POST", `${c.b.base}/close`, { session: c.b.s.tl, body: {} });
    expect(close.status, JSON.stringify(close.body)).toBe(422);
    expect(await closureRecords(c.b.transformationId)).toEqual([]);
  });
});

// ================================================================================================ benefit lifecycle

describe("A11 REQ-S08-002: completing the enabling deliverable marks the benefit 'enabled - not yet measured'", () => {
  it("REQ-S08-002: realization state enabled_not_yet_measured; validated value stays zero (nothing validated)", async () => {
    const c = await seedClosureWorld(api, w);
    const ini = await launchedInitiative(api.db, c.b);
    // The BO is the initiative's executive owner (the person who accepts its deliverables).
    const owned = await send("PATCH", `/api/v1/initiatives/${ini}`, {
      session: c.b.s.tl,
      headers: ifMatch(1),
      body: { executiveOwnerUserId: c.b.users.bo.id },
    });
    expect(owned.status, JSON.stringify(owned.body)).toBe(200);
    const d = await send("POST", `/api/v1/initiatives/${ini}/deliverables`, {
      session: c.b.s.tl,
      body: { title: "Synthetic QA self-service portal release", ownerUserId: c.b.users.tl.id },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const created = await send("POST", `${c.b.base}/benefits`, {
      session: c.b.s.bo,
      body: financialBody(c.b, {
        baselineValue: "1000000",
        baselineUnit: "SAR",
        targetValue: "1200000",
        benefitFormulaId: c.b.benefitFormulaId,
      }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const B = `${c.b.base}/benefits/${created.body.id}`;
    const e = await send("POST", `${B}/enablers`, {
      session: c.b.s.bo,
      body: { initiativeId: ini, deliverableId: d.body.id },
    });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    expect((await get200(api, c.b.s.auditor, B)).realizationState).toBe("not_enabled");
    const valuesBefore = await get200(api, c.b.s.auditor, `${B}/values`);

    // The enabling deliverable is submitted and accepted through the deliverable API (synthetic acceptance).
    const sub = await send("POST", `/api/v1/deliverables/${d.body.id}/submit`, {
      session: c.b.s.tl,
      headers: ifMatch(d.body.version),
      body: {},
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const acc = await send("POST", `/api/v1/deliverables/${d.body.id}/acceptance`, {
      session: c.b.s.bo,
      headers: ifMatch(sub.body.version),
      body: { result: "accepted", note: "Synthetic QA acceptance of test data" },
    });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);

    const after = await get200(api, c.b.s.auditor, B);
    expect(after.realizationState).toBe("enabled_not_yet_measured");
    const values = await get200(api, c.b.s.auditor, `${B}/values`);
    const byState = Object.fromEntries((values.series as Body[]).map((s) => [s.state, s]));
    for (const state of ["measured", "submitted", "validated", "sustained"]) {
      expect(byState[state].count, state).toBe(0);
      expect(byState[state].lines, state).toEqual([]);
    }
    // The enabler created no value at all: the value series is unchanged.
    expect(values).toEqual(valuesBefore);
    const sm = await get200(api, c.b.s.auditor, `/api/v1/initiatives/${ini}/status-model`);
    expect(sm.value).toBe("validation_pending");
  });
});

describe("A11 REQ-PB-074: Measure needs the Plan outputs; Sustain needs a BAU owner and a control cadence", () => {
  let c: ClosureWorld;
  beforeAll(async () => {
    c = await seedClosureWorld(api, w);
  }, 120_000);

  it("REQ-PB-074: without the Plan outputs a benefit cannot move towards Measure (422); nothing changes", async () => {
    const created = await send("POST", `${c.b.base}/benefits`, { session: c.b.s.bo, body: financialBody(c.b) });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const B = `${c.b.base}/benefits/${created.body.id}`;
    const toPlan = await send("POST", `${B}/lifecycle`, {
      session: c.b.s.bo,
      headers: ifMatch(created.body.version),
      body: { toStep: "plan" },
    });
    expect(toPlan.status, JSON.stringify(toPlan.body)).toBe(200);
    // Straight to Measure: refused.
    const direct = await send("POST", `${B}/lifecycle`, {
      session: c.b.s.bo,
      headers: ifMatch(toPlan.body.version),
      body: { toStep: "measure" },
    });
    expect(direct.status, JSON.stringify(direct.body)).toBe(422);
    // The next step on the way to Measure without baseline, formula and target: refused, naming the Plan outputs.
    const toEnable = await send("POST", `${B}/lifecycle`, {
      session: c.b.s.bo,
      headers: ifMatch(toPlan.body.version),
      body: { toStep: "enable" },
    });
    expectCode(toEnable, 422, "benefit.plan_outputs_missing");
    const now = await get200(api, c.b.s.auditor, B);
    expect([now.lifecycleStep, now.version]).toEqual(["plan", toPlan.body.version]);
  });

  it("REQ-PB-074: at Measure, Sustain without a BAU owner and control cadence is 422; with both it succeeds", async () => {
    const ini = await launchedInitiative(api.db, c.b);
    const ben = await validatedBenefit(api, c, ini, false);
    const B = `${c.b.base}/benefits/${ben.id}`;
    const cur = await get200(api, c.b.s.bo, B);
    expect(cur.lifecycleStep).toBe("measure");
    expect([cur.bauOwnerUserId, cur.controlCadence]).toEqual([null, null]);
    const refused = await send("POST", `${B}/lifecycle`, {
      session: c.b.s.bo,
      headers: ifMatch(cur.version),
      body: { toStep: "sustain" },
    });
    expectCode(refused, 422, "benefit.sustain_outputs_missing");
    // Only a BAU owner: still refused (the control cadence is missing).
    const owner = await send("PATCH", B, {
      session: c.b.s.bo,
      headers: ifMatch(cur.version),
      body: { bauOwnerUserId: c.b.users.bo2.id },
    });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    const half = await send("POST", `${B}/lifecycle`, {
      session: c.b.s.bo,
      headers: ifMatch(owner.body.version),
      body: { toStep: "sustain" },
    });
    expectCode(half, 422, "benefit.sustain_outputs_missing");
    const cadence = await send("PATCH", B, {
      session: c.b.s.bo,
      headers: ifMatch(owner.body.version),
      body: { controlCadence: "quarterly" },
    });
    expect(cadence.status, JSON.stringify(cadence.body)).toBe(200);
    const ok = await send("POST", `${B}/lifecycle`, {
      session: c.b.s.bo,
      headers: ifMatch(cadence.body.version),
      body: { toStep: "sustain" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.lifecycleStep).toBe("sustain");
  });
});

// ================================================================================================ transition decision

describe("A11 REQ-S11-007: after the transition decision the forecast stays forecast; monitoring goes to the residual owner", () => {
  it("REQ-S11-007: forecast unchanged and not sustained/validated; the residual owner gets the monitoring task", async () => {
    const c = await seedClosureWorld(api, w);
    const ini = await launchedInitiative(api.db, c.b);
    const ben = await pendingBenefit(api, c, ini);
    const B = `${c.b.base}/benefits/${ben.id}`;
    const fc = await send("POST", `${B}/plan-values`, {
      session: c.b.s.bo,
      body: { valueKind: "forecast", periodStart: "2027-01-01", periodEnd: "2027-12-31", amount: "500000.00" },
    });
    expect(fc.status, JSON.stringify(fc.body)).toBe(201);
    const before = await get200(api, c.b.s.auditor, `${B}/values`);
    const today = await businessToday(api, c.b.organizationId);
    const first = plusDays(today, 3);
    const td = await draftDecision(send, c, ben.id, {
      firstMonitoringDate: first,
      expectedRealizationEnd: plusDays(today, 500),
    });
    await decideDecision(send, c, td);
    const decided = await get200(api, c.b.s.auditor, `${c.transitions}/${td.id}`);
    expect(decided.status).toBe("approved");
    expect(decided.residualOwnerUserId).toBe(c.b.users.bo2.id);

    const after = await get200(api, c.b.s.auditor, `${B}/values`);
    const state = (v: Body, s: string) => (v.series as Body[]).find((x) => x.state === s);
    expect(canon(state(after, "forecast").total.amount ?? state(after, "forecast").total)).toBe(
      canon(state(before, "forecast").total.amount ?? state(before, "forecast").total),
    );
    expect(state(after, "forecast").count).toBe(1);
    expect(state(after, "sustained").count).toBe(0);
    expect(state(after, "validated").count).toBe(0);
    expect(after).toEqual(before);
    const b = await get200(api, c.b.s.auditor, B);
    expect(["validated", "sustained"]).not.toContain(b.realizationState);

    // The monitoring task for the residual owner (the scan run for today, as the daily job would).
    await runMonitoringScan(api.db, "qa-a11-monitoring", { asOf: today, organizationId: c.b.organizationId });
    const mine = await get200(api, c.b.s.bo2, "/api/v1/me/work-items?status=open&limit=100");
    const tasks = (mine.items as Body[]).filter((i) => i.kind === "benefit_monitoring_due" && i.dueDate === first);
    expect(tasks).toHaveLength(1);
    const notMine = await get200(api, c.b.s.bo, "/api/v1/me/work-items?status=open&limit=100");
    expect((notMine.items as Body[]).filter((i) => i.subjectId === tasks[0].subjectId)).toEqual([]);
  });
});

// ================================================================================================ corrective actions

describe("A11 REQ-PB-085: a benefit below plan creates one corrective action; repeated evaluation does not duplicate it", () => {
  it("REQ-PB-085: two below-plan validated values and a redelivery leave exactly one open case for the benefit", async () => {
    const c = await seedClosureWorld(api, w);
    const ini = await launchedInitiative(api.db, c.b);
    const ben = await validatedBenefit(api, c, ini, false); // one validated value (250000, 2026-09, no plan value)
    const B = `${c.b.base}/benefits/${ben.id}`;
    for (const [start, end] of [
      ["2026-10-01", "2026-10-31"],
      ["2026-11-01", "2026-11-30"],
    ]) {
      const p = await send("POST", `${B}/plan-values`, {
        session: c.b.s.bo,
        body: { valueKind: "planned", periodStart: start, periodEnd: end, amount: "300000" },
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
    }
    const cases = async () => {
      const r = await get200(api, c.b.s.auditor, `${c.b.base}/corrective-actions?limit=100`);
      return (r.items as Body[]).filter((x) => x.benefitId === ben.id);
    };
    expect(await cases()).toEqual([]);
    // October: 200000 measured and validated against 300000 planned (below plan).
    const oct = await submittedValue(api, c.b, ben.id, "200000", {
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
    });
    await approve(api, c.b, oct, "200000");
    const [octEvent] = await envelopesOf(api, oct.measurementId, "benefit.variance_evaluated");
    expect(octEvent!.payload.offTrack).toBe(true);
    await handleBenefitVariance(api.db, octEvent!, "qa-a11-variance-oct");
    const one = await cases();
    expect(one).toHaveLength(1);
    expect(one[0].status).not.toBe("closed");
    // An owner and a follow-up date (or an explicit Unknown reason).
    expect(one[0].ownerUserId !== null || one[0].ownerStatus !== undefined).toBe(true);
    expect(one[0].followUpDate !== null || one[0].followUpUnknownReason !== null).toBe(true);
    // Redelivery of the same evaluation: nothing new.
    await handleBenefitVariance(api.db, octEvent!, "qa-a11-variance-oct-redelivery");
    expect((await cases()).map((x) => [x.id, x.version])).toEqual([[one[0].id, one[0].version]]);
    // November: below plan again (a repeated evaluation): the same case is updated, not duplicated.
    const nov = await submittedValue(api, c.b, ben.id, "100000", {
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
    });
    await approve(api, c.b, nov, "100000");
    const [novEvent] = await envelopesOf(api, nov.measurementId, "benefit.variance_evaluated");
    await handleBenefitVariance(api.db, novEvent!, "qa-a11-variance-nov");
    const still = await cases();
    expect(still).toHaveLength(1);
    expect(still[0].id).toBe(one[0].id);
    expect(still[0].signalCount).toBeGreaterThan(one[0].signalCount);
  });
});

describe("A11 REQ-PB-085: a KPI deviation persisting two cycles under a two-cycle rule creates one case; the third updates it", () => {
  let k: KpiWorld;
  let kw: World;
  it("REQ-PB-085: red in cycle 1 -> no case; red in cycle 2 -> one case; red in cycle 3 -> the same case updated", async () => {
    kw = await seedWorld(api.db);
    k = await seedKpiWorld(api, kw);
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    const rule = await send("POST", `${k.base}/corrective-action-rules`, {
      session: k.s.tl,
      body: { sourceKind: "kpi_deviation", persistenceCycles: 2, followUpWorkingDays: 5, minKpiRag: "red" },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const periods = [await monthlyPeriod(api, kw), await monthlyPeriod(api, kw), await monthlyPeriod(api, kw)];
    const kpi = await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "count", polarity: "higher_is_better" } as never);
    await approvedTrajectory(
      api,
      k,
      kpi.id,
      periods.map((p) => ({ pointDate: p.end, expectedValue: "100" })),
    );
    const kpiCases = async () => {
      const r = await get200(api, k.s.auditor, `${k.base}/corrective-actions?limit=100`);
      return (r.items as Body[]).filter((x) => x.kpiDefinitionId === kpi.id);
    };
    const history: Body[][] = [];
    for (const [i, p] of periods.entries()) {
      const res = await submitActual(api, k, kpi.id, { reportingPeriodId: p.id, value: "40", dataAsOf: p.end });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const [run] = await runRecalculation(api, res.body.actual.id);
      expect(run).toMatchObject({ outcome: "done" });
      const e = await api.db
        .selectFrom("kpi_evaluation")
        .select(["id", "calculated_rag"])
        .where("kpi_definition_id", "=", kpi.id)
        .where("reporting_period_id", "=", p.id)
        .where("value_basis", "=", "period")
        .executeTakeFirstOrThrow();
      expect(e.calculated_rag, `period ${i + 1}`).toBe("red");
      for (const env of await envelopesOf(api, e.id, "kpi.deviation_evaluated"))
        await handleKpiDeviation(api.db, env, `qa-a11-kpi-${i + 1}`);
      history.push(await kpiCases());
    }
    expect(history[0]).toEqual([]);
    expect(history[1]).toHaveLength(1);
    expect(history[1]![0].consecutiveOffTrack).toBe(2);
    expect(history[2]).toHaveLength(1);
    expect(history[2]![0].id).toBe(history[1]![0].id);
    expect(history[2]![0].consecutiveOffTrack).toBe(3);
    expect(history[2]![0].version).toBeGreaterThan(history[1]![0].version);
  });
});
