// code-security-reviewer DG4 round-1 probe F (T-DG4-REV-SEC-R1). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-dg4/ (it imports the implementers' benefit fixtures read-only).
// All data is synthetic; nothing here is a real Finance approval, and nothing relates to DG0-DG7.
//   F1 two Finance users decide the same queued value at the same time: exactly one 200; validated total = amount once.
//   F2 optimistic concurrency of corrections: FIN-B amends an approved value (If-Match = the validation's version);
//      FIN-A, still holding the SAME ETag (a stale view), then amends it to another amount. Expected for a stale
//      If-Match: 409. Observed and printed either way, with the resulting validated total.
//   F3 an amendment and a reversal of the same validation at the same time: the end state is consistent (validated
//      total = 0 when the reversal succeeded; never a dangling amendment after a reversal).
//   F4 a validated measurement edited in place: 409 benefit_measurement.validated_immutable.
//   F5 decimal: 900719925474099.1234 approved and amended by -0.0001 gives exactly 900719925474099.1233.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { ALL_ACCEPTED, approve, measuredBenefit, submittedValue, type Body } from "../benefits/value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let FV: string;
let finB: { id: string; session: import("../../support/harness.ts").Session };
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  FV = `${b.base}/finance-validations`;
  finB = await extraUser(api, w, b, "FIN");
}, 120_000);
afterAll(() => api.close(), 60_000);

let month = 0;
const period = () => {
  month += 1;
  const m = String(month).padStart(2, "0");
  const end = new Date(Date.UTC(2036, month, 0)).getUTCDate();
  return { periodStart: `2036-${m}-01`, periodEnd: `2036-${m}-${end}` };
};
const validatedOf = async (benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  return (r.body.series as Body[]).find((s) => s.state === "validated");
};

describe("SEC-DG4-R1 probe F: Finance decision and correction integrity", () => {
  it("F1 two Finance users decide the same queued value at once: exactly one 200; counted once", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", period());
    const body = { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "1000" };
    const res = await Promise.all([b.s.fin, finB.session].map((session) =>
      call<Body>(api.app, "POST", `${FV}/${v.validationId}/decision`, { session, headers: ifm(v.validationVersion), body }),
    ));
    const total = (await validatedOf(ben.id)).total.amount;
    console.log(`[probe-F] F1 ${JSON.stringify(res.map((r) => [r.status, r.body.code ?? r.body.status]))}; validated total ${total}`);
    expect(res.filter((r) => r.status === 200).length).toBe(1);
    expect(total).toBe("1000.0000");
  });

  it("F2 a correction sent with a stale ETag after another Finance user's correction (observed)", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", period());
    const decided = await approve(api, b, v, "1000");
    const etag = decided.version;
    const byB = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: finB.session,
      headers: ifm(etag),
      body: { correctedAmount: "900", reason: "Synthetic: FIN-B finds a double count" },
    });
    const afterB = (await validatedOf(ben.id)).total.amount;
    const stale = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(etag),
      body: { correctedAmount: "1100", reason: "Synthetic: FIN-A, working from the screen loaded before FIN-B's change" },
    });
    const afterA = (await validatedOf(ben.id)).total.amount;
    const original = await call<Body>(api.app, "GET", `${FV}/${v.validationId}`, { session: b.s.auditor });
    console.log(`[probe-F] F2 original validation version after approval ${etag}; FIN-B amend (If-Match ${etag}) -> ${byB.status} ${byB.body.approvedAmount ?? byB.body.code}; total ${afterB}; FIN-A amend with the SAME If-Match ${etag} -> ${stale.status} ${stale.body.approvedAmount ?? stale.body.code}; total ${afterA}; original validation ETag now ${original.headers.etag}`);
    expect(byB.status).toBe(201);
    // Recorded for the finding: a stale If-Match on a correction is not refused (expected 409).
    expect([stale.status, afterA]).toEqual([201, "1100.0000"]);
  });

  it("F3 an amendment and a reversal at the same time: consistent end state", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", period());
    const decided = await approve(api, b, v, "1000");
    const [am, rv] = await Promise.all([
      call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, { session: finB.session, headers: ifm(decided.version), body: { correctedAmount: "700", reason: "Synthetic amend" } }),
      call<Body>(api.app, "POST", `${FV}/${v.validationId}/reversals`, { session: b.s.fin, headers: ifm(decided.version), body: { reason: "Synthetic reverse" } }),
    ]);
    const total = (await validatedOf(ben.id)).total.amount;
    const rows = await api.db.selectFrom("benefit_measurement").select(["kind", "amount", "measurement_no"]).where("benefit_id", "=", ben.id).orderBy("measurement_no").execute();
    console.log(`[probe-F] F3 amend ${am.status} ${am.body.approvedAmount ?? am.body.code}; reverse ${rv.status} ${rv.body.approvedAmount ?? rv.body.code}; total ${total}; rows ${JSON.stringify(rows)}`);
    expect(rv.status).toBe(201);
    expect(total).toBe("0.0000");
    if (am.status === 201) expect(rows.map((r) => r.kind)).toEqual(["measurement", "amendment", "reversal"]);
  });

  it("F4 a validated value is never edited in place (409)", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", period());
    await approve(api, b, v, "1000");
    const m = await api.db.selectFrom("benefit_measurement").select(["version"]).where("id", "=", v.measurementId).executeTakeFirstOrThrow();
    const res = await call<Body>(api.app, "PATCH", `${b.base}/benefit-measurements/${v.measurementId}`, { session: b.s.bo, headers: ifm(m.version), body: { amount: "5000" } });
    console.log(`[probe-F] F4 edit validated -> ${res.status} ${res.body.code}`);
    expect([res.status, res.body.code]).toEqual([409, "benefit_measurement.validated_immutable"]);
  });

  it("F5 decimal end to end: 900719925474099.1234 then -0.0001 is exactly ...099.1233", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "900719925474099.1234", period());
    const decided = await approve(api, b, v, "900719925474099.1234");
    const t1 = (await validatedOf(ben.id)).total.amount;
    const am = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, { session: finB.session, headers: ifm(decided.version), body: { correctedAmount: "900719925474099.1233", reason: "Synthetic: rounding" } });
    const t2 = (await validatedOf(ben.id)).total.amount;
    console.log(`[probe-F] F5 approved total ${t1}; amendment ${am.status} ${am.body.approvedAmount}; total ${t2}`);
    expect([t1, am.body.approvedAmount, t2]).toEqual(["900719925474099.1234", "-0.0001", "900719925474099.1233"]);
  });
});
