// Amendments and reversals of approved values (T-DG4-KBE-E; ADR-0030 §4, §11). Proves, against the run's disposable
// PostgreSQL, REQ-S08-017 "an in-place edit of a validated value is 409; a reversal nets the total and both records
// remain visible": 240000.5 approved -> amended to 239500 (signed delta -500.5000; validated total 239500.0000) ->
// reversed (-239500.0000; validated total 0.0000) with all three validated rows visible and linked to the original;
// once reversed, nothing more; FIN only (BO, AUD, ADM-only 403); If-Match 428/409; one audit event per new row by FIN.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import { approve, measuredBenefit, submittedValue, type Body } from "./value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let FV: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  FV = `${b.base}/finance-validations`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

let month = 0;
const period = () => {
  month += 1;
  const m = String(month).padStart(2, "0");
  const end = new Date(Date.UTC(2034, month, 0)).getUTCDate();
  return { periodStart: `2034-${m}-01`, periodEnd: `2034-${m}-${end}` };
};
const validatedOf = async (benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  return (r.body.series as Body[]).find((s) => s.state === "validated");
};

describe("REQ-S08-017: corrections are linked rows; the original stays visible", () => {
  it("amend 240000.5 -> 239500 (delta -500.5); reverse -> 0.0000; three validated rows; nothing more after", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "250000", period());
    const decided = await approve(api, b, v, "240000.5");
    expect((await validatedOf(ben.id)).total.amount).toBe("240000.5000");

    const amend = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(decided.version),
      body: { correctedAmount: "239500", reason: "Synthetic: one invoice double-counted" },
    });
    expect(amend.status, JSON.stringify(amend.body)).toBe(201);
    expect(amend.headers.location).toBe(`${FV}/${amend.body.id}`);
    expect(amend.body).toMatchObject({
      kind: "amendment",
      correctsValidationId: v.validationId,
      status: "approved",
      approvedAmount: "-500.5000",
      decidedBy: b.users.fin.id,
      reason: "Synthetic: one invoice double-counted",
    });
    expect(Object.keys(amend.body.content).sort()).toEqual(
      ["assumptions", "attribution", "baseline", "calculation", "evidence", "measurementPeriod"].sort(),
    );
    const v1 = await validatedOf(ben.id);
    expect([v1.total.amount, v1.count]).toEqual(["239500.0000", 2]);

    const unchanged = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifm(decided.version),
      body: { correctedAmount: "239500.0000", reason: "Synthetic: no change" },
    });
    expect([unchanged.status, unchanged.body.code, unchanged.body.detail]).toEqual([
      422,
      "finance_validation.amendment_unchanged",
      "The corrected amount equals the current validated amount.",
    ]);

    const rev = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
      session: b.s.fin,
      headers: ifm(decided.version),
      body: { reason: "Synthetic: initiative cancelled, value withdrawn" },
    });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect([rev.body.kind, rev.body.approvedAmount, rev.body.correctsValidationId]).toEqual([
      "reversal",
      "-239500.0000",
      v.validationId,
    ]);
    const v2 = await validatedOf(ben.id);
    expect([v2.total.amount, v2.count]).toEqual(["0.0000", 3]);
    expect((v2.lines as Body[]).map((l) => l.amount)).toEqual(
      expect.arrayContaining(["240000.5000", "-500.5000", "-239500.0000"]),
    );
    // Both corrections are measurements linked to the original, visible in the list.
    const list = await call<Body>(api.app, "GET", `${b.base}/benefits/${ben.id}/measurements`, {
      session: b.s.auditor,
    });
    const rows = list.body.items as Body[];
    expect(rows.map((m) => [m.kind, m.status, m.correctsMeasurementId ?? null])).toEqual([
      ["reversal", "validated", v.measurementId],
      ["amendment", "validated", v.measurementId],
      ["measurement", "validated", null],
    ]);
    // Audit: one event per new row, actor FIN.
    for (const m of rows.filter((x) => x.kind !== "measurement"))
      expect((await auditOf(api.db, m.id)).map((e) => [e.action, e.actor_user_id])).toEqual([
        [`benefit_measurement.${m.kind}`, b.users.fin.id],
      ]);
    expect((await auditOf(api.db, rev.body.id)).map((e) => e.action)).toEqual(["finance_validation.reversal"]);

    // Once reversed: no second reversal and no amendment.
    for (const [path, body] of [
      ["reversals", { reason: "Synthetic: again" }],
      ["amendments", { correctedAmount: "1", reason: "Synthetic: again" }],
    ] as const) {
      const r = await call<Body>(api.app, "POST", `${FV}/${v.validationId}/${path}`, {
        session: b.s.fin,
        headers: ifm(decided.version),
        body,
      });
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        422,
        "finance_validation.already_reversed",
        "This value is already reversed.",
      ]);
    }
  });

  it("only an approved validation is corrected; FIN only; If-Match 428/409; a reason is required", async () => {
    const ben = await measuredBenefit(api, b);
    const queued = await submittedValue(api, b, ben.id, "100", period());
    const notApproved = await call<Body>(api.app, "POST", `${FV}/${queued.validationId}/reversals`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { reason: "Synthetic reason" },
    });
    expect([notApproved.status, notApproved.body.code, notApproved.body.detail]).toEqual([
      422,
      "finance_validation.not_approved",
      "Only an approved validation can be amended or reversed.",
    ]);
    const v = await submittedValue(api, b, ben.id, "100", period());
    const d = await approve(api, b, v, "100");
    for (const s of [b.s.bo, b.s.auditor, b.s.admin, b.s.tl])
      expect(
        (
          await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
            session: s,
            headers: ifm(d.version),
            body: { reason: "Synthetic reason" },
          })
        ).status,
      ).toBe(403);
    expect(
      (
        await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
          session: b.s.fin,
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(428);
    expect(
      (
        await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
          session: b.s.fin,
          headers: ifm(d.version + 5),
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call(api.app, "POST", `${FV}/${v.validationId}/reversals`, {
          session: b.s.fin,
          headers: ifm(d.version),
          body: {},
        })
      ).status,
    ).toBe(400);
    const rows = await api.db
      .selectFrom("benefit_measurement")
      .select("id")
      .where("corrects_measurement_id", "=", v.measurementId)
      .execute();
    expect(rows).toEqual([]);
  });
});
