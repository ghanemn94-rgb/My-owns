// Value series and planned/forecast values (T-DG4-KBE-E; ADR-0030 §1, §6; ADR-0029 §11). Proves, against the run's
// disposable PostgreSQL:
//  - REQ-S08-001 "seven states kept apart": getBenefitValues returns exactly the seven series (planned, forecast,
//    measured, submitted, validated, sustained, rejected), each with its own lines, count and total, never added;
//    a forecast is never validated (a 999999 forecast leaves validated at 0.0000);
//  - REQ-PB-076: a CX benefit without a valuation method shows its totals as n/a, never 0;
//  - plan values: benefit.edit (BO, TL; AUD and ADM-only 403), the §11 refusals (unmonetised, parent roll-up, period
//    taken, archived), If-Match 428/409 on update, one audit event per change; commit-time authorisation.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { benefitAt, cxBody, extraUser, financialBody, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";
import { approve, measuredBenefit, submittedValue, type Body } from "./value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const P = (benefitId: string) => `${b.base}/benefits/${benefitId}/plan-values`;
const PV = (id: string) => `${b.base}/benefit-plan-values/${id}`;
const values = async (benefitId: string) => {
  const r = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}/values`, { session: b.s.auditor });
  expect(r.status).toBe(200);
  return r.body;
};

describe("REQ-S08-001: seven states kept apart", () => {
  it("planned, forecast, measured, submitted, validated, rejected each with its own total; forecast never validated", async () => {
    const ben = await measuredBenefit(api, b);
    for (const [valueKind, amount] of [
      ["planned", "300000"],
      ["forecast", "999999"],
    ] as const) {
      const r = await call<Body>(api.app, "POST", P(ben.id), {
        session: b.s.bo,
        body: { valueKind, periodStart: "2035-01-01", periodEnd: "2035-01-31", amount },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const v1 = await submittedValue(api, b, ben.id, "250000", { periodStart: "2035-01-01", periodEnd: "2035-01-31" });
    await approve(api, b, v1, "240000.5");
    await submittedValue(api, b, ben.id, "1000", { periodStart: "2035-02-01", periodEnd: "2035-02-28" });
    const body = await values(ben.id);
    expect(body.currency).toBe("SAR");
    const s = Object.fromEntries((body.series as Body[]).map((x) => [x.state, x]));
    expect((body.series as Body[]).map((x) => x.state)).toEqual([
      "planned",
      "forecast",
      "measured",
      "submitted",
      "validated",
      "sustained",
      "rejected",
    ]);
    expect(
      Object.fromEntries(
        Object.entries(s as Record<string, Body>).map(([k, x]) => [k, [x.total.status, x.total.amount, x.count]]),
      ),
    ).toEqual({
      planned: ["known", "300000.0000", 1],
      forecast: ["known", "999999.0000", 1],
      measured: ["known", "251000.0000", 2],
      submitted: ["known", "1000.0000", 1],
      validated: ["known", "240000.5000", 1],
      sustained: ["known", "0.0000", 0],
      rejected: ["known", "0.0000", 0],
    });
    expect(s.validated.lines[0]).toMatchObject({ recordType: "benefit_measurement", basis: "validated" });
    expect(s.planned.lines[0]).toMatchObject({ recordType: "benefit_plan_value", basis: null });
  });

  it("REQ-PB-076: a CX benefit's totals are n/a (never 0); its KPI values stay visible", async () => {
    const cx = await benefitAt(api, b, "measure", cxBody(b, { baselineValue: "40", targetValue: "55" }));
    const kpi = await call<Body>(api.app, "POST", P(cx.id), {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2035-03-01", periodEnd: "2035-03-31", kpiValue: "50" },
    });
    expect(kpi.status).toBe(201);
    const body = await values(cx.id);
    const planned = (body.series as Body[]).find((x) => x.state === "planned");
    expect(planned.total).toEqual({ status: "not_applicable", amount: null, currency: null, reason: null });
    expect([planned.count, planned.lines[0].kpiValue]).toEqual([1, "50.000000"]);
  });
});

describe("plan values (ADR-0030 §1)", () => {
  it("create/update by BO with If-Match and audit; the §11 refusals; AUD and ADM-only 403", async () => {
    const ben = await benefitAt(api, b, "plan", financialBody(b));
    const r = await call<Body>(api.app, "POST", P(ben.id), {
      session: b.s.bo,
      body: {
        valueKind: "planned",
        periodStart: "2035-04-01",
        periodEnd: "2035-06-30",
        amount: "0.1",
        note: "Synthetic Q2",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.location).toBe(PV(r.body.id));
    expect([r.body.amount, r.body.currency, r.body.version, r.headers.etag]).toEqual(["0.1000", "SAR", 1, '"1"']);
    const dup = await call<Body>(api.app, "POST", P(ben.id), {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2035-04-01", periodEnd: "2035-04-30", amount: "1" },
    });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "benefit_value.period_taken",
      "This benefit already has a planned value for the period starting 2035-04-01.",
    ]);
    const empty = await call<Body>(api.app, "POST", P(ben.id), {
      session: b.s.bo,
      body: { valueKind: "forecast", periodStart: "2035-04-01", periodEnd: "2035-04-30" },
    });
    expect([empty.status, empty.body.code]).toEqual([422, "benefit_value.value_required"]);
    expect((await call(api.app, "PATCH", PV(r.body.id), { session: b.s.bo, body: { amount: "0.2" } })).status).toBe(
      428,
    );
    expect(
      (await call(api.app, "PATCH", PV(r.body.id), { session: b.s.bo, headers: ifm(9), body: { amount: "0.2" } }))
        .status,
    ).toBe(409);
    const u = await call<Body>(api.app, "PATCH", PV(r.body.id), {
      session: b.s.tl,
      headers: ifm(1),
      body: { amount: "0.2" },
    });
    expect([u.status, u.body.amount, u.body.version]).toEqual([200, "0.2000", 2]);
    expect((await auditOf(api.db, r.body.id)).map((e) => e.action)).toEqual([
      "benefit_plan_value.create",
      "benefit_plan_value.update",
    ]);
    for (const s of [b.s.auditor, b.s.admin, b.s.fin]) {
      expect(
        (
          await call(api.app, "POST", P(ben.id), {
            session: s,
            body: { valueKind: "forecast", periodStart: "2035-07-01", periodEnd: "2035-07-31", amount: "1" },
          })
        ).status,
      ).toBe(403);
      expect(
        (await call(api.app, "PATCH", PV(r.body.id), { session: s, headers: ifm(2), body: { amount: "1" } })).status,
      ).toBe(403);
    }
    expect((await call(api.app, "GET", `${b.base}/benefits/${ben.id}/values`, { session: b.s.outsider })).status).toBe(
      404,
    );
  });

  it("unmonetised CX amount, parent roll-up and archived benefit are refused", async () => {
    const cx = await benefitAt(api, b, "plan", cxBody(b));
    const sar = await call<Body>(api.app, "POST", P(cx.id), {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2035-08-01", periodEnd: "2035-08-31", amount: "10" },
    });
    expect([sar.status, sar.body.code, sar.body.detail]).toEqual([
      422,
      "benefit_value.unmonetised",
      "A non-financial benefit has no SAR value without an approved valuation method. Record its KPI value instead.",
    ]);
    const parent = await benefitAt(api, b, "identify", financialBody(b));
    const child = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
      session: b.s.bo,
      body: financialBody(b, { parentBenefitId: parent.id }),
    });
    expect(child.status, JSON.stringify(child.body)).toBe(201);
    const roll = await call<Body>(api.app, "POST", P(parent.id), {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2035-08-01", periodEnd: "2035-08-31", amount: "10" },
    });
    expect([roll.status, roll.body.code, roll.body.detail]).toEqual([
      422,
      "benefit_value.parent_rollup",
      `Benefit ${parent.code} is a parent: its values come from its children.`,
    ]);
    const gone = await benefitAt(api, b, "identify", financialBody(b));
    const archived = await call<Body>(api.app, "POST", `${b.base}/benefits/${gone.id}/archive`, {
      session: b.s.bo,
      headers: ifm(gone.version),
      body: { reason: "Synthetic: duplicate entry" },
    });
    expect(archived.status).toBe(200);
    const late = await call<Body>(api.app, "POST", P(gone.id), {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: "2035-08-01", periodEnd: "2035-08-31", amount: "10" },
    });
    expect([late.status, late.body.code]).toEqual([422, "benefit.archived"]);
  });

  it("commit-time: a BO grant revoked while the create waited is 403; nothing written", async () => {
    const ben = await benefitAt(api, b, "plan", financialBody(b));
    const u = await extraUser(api, w, b, "BO");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", P(ben.id), {
          session: u.session,
          body: { valueKind: "planned", periodStart: "2035-09-01", periodEnd: "2035-09-30", amount: "1" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db.selectFrom("benefit_plan_value").select("id").where("benefit_id", "=", ben.id).execute();
    expect(rows).toEqual([]);
  });
});
