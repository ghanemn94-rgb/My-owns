// Closes the rows QA-A's handback (T-DG4-QA-A, "Partial or not covered") left partial, as NEW test cases in a NEW file
// beside QA-A's suites (qa-verifier, T-DG4-QA-B). QA-A's files are unchanged.
//  - REQ-S07-007 (A04/A05): "with all tasks complete and actual below the red threshold the KPI is Red";
//  - REQ-S13-003 (A04/A05): "the validated benefit total drills to its benefit records";
//  - REQ-S08-015 (A10): the exact refusal code of a Finance validation lacking its measurement-period item;
//  - REQ-PB-075 (A10): "T14 persists all 10 columns" (B0123: ID, Benefit, Type, Baseline, Target, Value (SAR),
//    Realized, Owner, Evidence, Status).
// Black-box through the REAL API (every request and response validated against docs/api/openapi.yaml) on the run's
// disposable PostgreSQL. The synthetic worlds come from the backend's fixtures re-exported by tests/qa/support/p4.ts
// (QA-A's support module); the Finance queue item is written by the worker's real consumer with the relay's envelope.
// Amounts are compared as canonical decimal strings, never floats. All data is SYNTHETIC; every Finance decision is a
// synthetic in-product approval of test data, and nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queueFinanceValidation } from "../../../apps/worker/src/handlers/benefits.ts";
import { call, startApi, type TestApi } from "../support/api.ts";
import { completePhaseSteps, ifm } from "../support/gates-native.ts";
import {
  approvedTrajectory,
  canon,
  dashboardWorld,
  DIRECT_FLOW,
  envelopeOf,
  evidenceItem,
  expectCode,
  get200,
  measuredBenefit,
  openPeriod,
  ownedKpi,
  riyadhToday,
  runRecalculation,
  seedBenefitWorld,
  seedWorld,
  SIX_ACCEPTED,
  submitActual,
  type BenefitWorld,
  type Body,
  type World,
} from "../support/p4.ts";

let api: TestApi;
let w: World;
let today: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  ({ today } = await riyadhToday(api));
}, 60_000);
afterAll(() => api?.close());

/** Exact decimal addition of decimal strings (BigInt with a common scale); never a float. */
function decimalSum(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map((v) => (v.split(".")[1] ?? "").length));
  let total = 0n;
  for (const v of values) {
    const neg = v.startsWith("-");
    const [i, f = ""] = (neg ? v.slice(1) : v).split(".");
    const n = BigInt(`${i}${f.padEnd(scale, "0")}`);
    total += neg ? -n : n;
  }
  const neg = total < 0n;
  const digits = (neg ? -total : total).toString().padStart(scale + 1, "0");
  const out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
  return canon(`${neg ? "-" : ""}${out}`)!;
}

// ------------------------------------------------------------------------------------------------ Finance helpers

async function submitMeasurement(b: BenefitWorld, benefitId: string, amount: string, start = "2036-01-01") {
  const ev = await evidenceItem(api, b);
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/measurements`, {
    session: b.s.bo,
    body: {
      periodStart: start,
      periodEnd: `${start.slice(0, 8)}28`,
      amount,
      attribution: "Synthetic QA: untreated control group",
      assumptions: "Synthetic QA: ARPU stable",
      evidenceIds: [ev],
      submit: true,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { measurement: r.body, evidenceId: ev };
}
async function queued(b: BenefitWorld, benefitId: string, amount: string, start?: string) {
  const { measurement, evidenceId } = await submitMeasurement(b, benefitId, amount, start);
  const env = await envelopeOf(api, measurement.id, "benefit.evidence_submitted");
  expect(env, "submitting a measurement writes benefit.evidence_submitted").toBeDefined();
  await queueFinanceValidation(api.db, env, `qa-b-${measurement.id}`);
  const item = await api.db
    .selectFrom("finance_validation")
    .select(["id", "version"])
    .where("benefit_measurement_id", "=", measurement.id)
    .executeTakeFirstOrThrow();
  return { id: item.id, version: item.version, measurementId: measurement.id as string, evidenceId };
}
const decide = (b: BenefitWorld, item: { id: string; version: number }, body: Record<string, unknown>) =>
  call<Body>(api.app, "POST", `${b.base}/finance-validations/${item.id}/decision`, {
    session: b.s.fin,
    headers: ifm(item.version),
    body,
  });

// ================================================================================================ REQ-S07-007

describe("QA-A partial: REQ-S07-007 'with all tasks complete'", () => {
  it("REQ-S07-007: with every Diagnose phase task and every action complete, an actual below the red threshold is Red", async () => {
    const k = await dashboardWorld(api, w);
    const [y, m] = today.split("-").map(Number) as [number, number];
    const label = `${y}-${String(m).padStart(2, "0")}`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const current = await openPeriod(
      api,
      w,
      "monthly",
      label,
      `${label}-01`,
      `${label}-${String(last).padStart(2, "0")}`,
    );
    // Every task of the transformation is complete: all Diagnose phase steps (accepted) and two actions (done).
    const tl = { id: k.users.tl.id, session: k.s.tl };
    const to = { id: k.users.to.id, session: k.s.to };
    const keys = await completePhaseSteps(api, { base: k.base, tl, to, reader: k.s.auditor });
    const phases = await get200(api, k.s.auditor, `${k.base}/phases`);
    expect((phases.phases[0].steps as Body[]).map((s) => s.status)).toEqual(keys.map(() => "complete"));
    for (const title of ["Synthetic QA: prepare the data extract", "Synthetic QA: brief the call centre"]) {
      const a = await call<Body>(api.app, "POST", `${k.base}/actions`, {
        session: k.s.tl,
        body: { title, ownerUserId: k.users.tl.id, dueDate: today },
      });
      expect(a.status, JSON.stringify(a.body)).toBe(201);
      const done = await call<Body>(api.app, "PATCH", `${k.base}/actions/${a.body.id}`, {
        session: k.s.tl,
        headers: ifm(a.body.version),
        body: { status: "done" },
      });
      expect([done.status, done.body.status], JSON.stringify(done.body)).toEqual([200, "done"]);
    }
    // The KPI: approved trajectory expects 100 by the end of the current period; the accepted actual is 80.
    const kpi = await ownedKpi(api, k, DIRECT_FLOW);
    await approvedTrajectory(api, k, kpi.id, [{ pointDate: current.end, expectedValue: "100" }]);
    const r = await submitActual(api, k, kpi.id, { dataAsOf: today, reportingPeriodId: current.id, value: "80" });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await runRecalculation(api, r.body.actual.id);
    const s = await get200(
      api,
      k.s.auditor,
      `${k.base}/kpi-definitions/${kpi.id}/status?reportingPeriodId=${current.id}`,
    );
    expect([canon(s.actual), canon(s.expectedToDate), s.calculatedRag], JSON.stringify(s)).toEqual([
      "80",
      "100",
      "red",
    ]);
    // The KPI list agrees: completion of tasks never turns the KPI green.
    expect(s.displayedRag).not.toBe("green");
  });
});

// ================================================================================================ REQ-S13-003

describe("QA-A partial: REQ-S13-003 'the validated benefit total drills to its benefit records'", () => {
  // Measurement periods lie inside the dashboards' "to date" window (a future period is not yet realized).
  it("REQ-S13-003: the Value area's validated headline drills to exactly the validated benefit records, whose decimal sum equals the headline", async () => {
    const b = await seedBenefitWorld(api, w);
    const one = await measuredBenefit(api, b);
    const two = await measuredBenefit(api, b);
    const pending = await measuredBenefit(api, b);
    const a1 = await queued(b, one.id, "1000.50", "2026-01-01");
    expect((await decide(b, a1, { decision: "approved", items: SIX_ACCEPTED, approvedAmount: "1000.50" })).status).toBe(
      200,
    );
    const a2 = await queued(b, two.id, "2000.25", "2026-02-01");
    expect((await decide(b, a2, { decision: "approved", items: SIX_ACCEPTED, approvedAmount: "2000.25" })).status).toBe(
      200,
    );
    await queued(b, pending.id, "999", "2026-03-01"); // submitted, not validated: never part of the validated total
    const overview = await get200(
      api,
      b.s.auditor,
      `/api/v1/overview?organizationId=${b.organizationId}&transformationId=${b.transformationId}`,
    );
    const value = (overview.areas as Body[]).find((a) => a.code === "value");
    const headline = (value.headlines as Body[]).find((h) => h.metric === "value.validated");
    expect(headline, JSON.stringify(value.headlines)).toBeTruthy();
    expect([headline.value.state, canon(headline.value.value)]).toEqual(["value", "3000.75"]);
    const drill = await get200(api, b.s.auditor, headline.drilldownHref);
    expect(drill.metric).toBe("value.validated");
    expect(canon(drill.value.value)).toBe("3000.75");
    const items = drill.items as Body[];
    // Each contributing item is (or links to) one of the two validated benefits; the pending one never appears.
    const text = JSON.stringify(items);
    expect(text).toContain(one.id);
    expect(text).toContain(two.id);
    expect(text).not.toContain(pending.id);
    expect(drill.nextCursor).toBeNull();
    expect(decimalSum(items.map((i) => i.value.value as string))).toBe("3000.75");
  });
});

// ================================================================================================ REQ-S08-015

describe("QA-A partial: REQ-S08-015 exact refusal codes", () => {
  it("REQ-S08-015: a Finance decision without the measurement-period item is 422 finance_validation.content_incomplete; with the item not accepted it is 422 finance_validation.items_not_accepted; nothing is validated", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b);
    const item = await queued(b, ben.id, "1500");
    const { measurementPeriod: _omit, ...fiveItems } = SIX_ACCEPTED;
    void _omit;
    const missing = await decide(b, item, { decision: "approved", items: fiveItems, approvedAmount: "1500" });
    expectCode(missing, 422, "finance_validation.content_incomplete");
    const notAccepted = await decide(b, item, {
      decision: "approved",
      items: { ...SIX_ACCEPTED, measurementPeriod: { decision: "rejected", note: "Synthetic QA: period overlaps" } },
      approvedAmount: "1500",
    });
    expectCode(notAccepted, 422, "finance_validation.items_not_accepted");
    const row = await get200(api, b.s.auditor, `${b.base}/finance-validations/${item.id}`);
    expect(row.status).toBe("queued");
  });
});

// ================================================================================================ REQ-PB-075

describe("QA-A partial: REQ-PB-075 'T14 persists all 10 columns'", () => {
  it("REQ-PB-075: the T14 register row carries ID, Benefit, Type, Baseline, Target, Value (SAR), Realized, Owner, Evidence and Status", async () => {
    const b = await seedBenefitWorld(api, w);
    const ben = await measuredBenefit(api, b, { extra: { plannedValue: "250000.10" } });
    const row = async () => {
      const page = await get200(api, b.s.auditor, `${b.base}/benefits?limit=100`);
      return (page.items as Body[]).find((r) => r.id === ben.id);
    };
    // Status is Unknown until set, never green.
    expect((await row()).status).toBe("unknown");
    const item = await queued(b, ben.id, "1000.50");
    expect(
      (await decide(b, item, { decision: "approved", items: SIX_ACCEPTED, approvedAmount: "1000.50" })).status,
    ).toBe(200);
    const current = await get200(api, b.s.auditor, `${b.base}/benefits/${ben.id}`);
    const rag = await call<Body>(api.app, "PATCH", `${b.base}/benefits/${ben.id}`, {
      session: b.s.bo,
      headers: ifm(current.version),
      body: { statusRag: "amber", statusRagNote: "Synthetic QA: ramp-up slower than planned" },
    });
    expect(rag.status, JSON.stringify(rag.body)).toBe(200);
    const r = await row();
    expect(r.code).toBe(ben.code); // ID
    expect(r.title).toBe("Synthetic churn reduction"); // Benefit
    expect(r.benefitType).toBe("revenue"); // Type
    expect(canon(r.baseline.value)).toBe("1000000"); // Baseline
    expect(canon(r.target.value)).toBe("1200000"); // Target
    expect([r.valueSar.status, canon(r.valueSar.amount), r.valueSar.currency]).toEqual(["known", "250000.1", "SAR"]); // Value (SAR)
    expect([canon(r.realized.validated.amount), r.realized.validatedCount]).toEqual(["1000.5", 1]); // Realized
    expect(r.ownerUserId).toBe(b.users.bo.id); // Owner
    expect(r.evidenceCount).toBeGreaterThanOrEqual(1); // Evidence
    expect(r.latestEvidenceIds).toContain(item.evidenceId);
    expect(r.status).toBe("amber"); // Status
    // Persisted: the same values come back from the database row.
    const db = await api.db.selectFrom("benefit").selectAll().where("id", "=", ben.id).executeTakeFirstOrThrow();
    expect([db.code, db.title, db.benefit_type, db.owner_user_id, db.status_rag]).toEqual([
      ben.code,
      "Synthetic churn reduction",
      "revenue",
      b.users.bo.id,
      "amber",
    ]);
    expect([canon(String(db.baseline_value)), canon(String(db.target_value)), canon(String(db.planned_value))]).toEqual(
      ["1000000", "1200000", "250000.1"],
    );
  });
});
