// qa-verifier DG4 round 2 (T-DG4-REV-QA-R2B): independent acceptance-side probes of the round-1 repairs that touch
// DG4-final clauses. This file lives OUTSIDE the frozen candidate (docs/delivery/test-evidence/DG4/qa/tests/round-2/)
// and is copied into a disposable clone's tests/qa/integration/ only to run, then removed.
//
//  R1 (REQ-S08-017 + F-DG4-101, reliability/concurrency): two Finance amendments of ONE approved value sent AT THE SAME
//     TIME with the same If-Match: exactly one is 201 and the other 409 with the current version; exactly one amendment
//     row exists; the validated total is the winner's amount; the original stepped exactly once.
//  R2 (migration 0061, negative): the decided-validation trigger refuses, on the original approved validation, (a) a
//     version step together with any other change (approved_amount), (b) a step of 2, and (c) a step of a decided
//     validation that has NO correction. Only the exact +1 step with nothing else changed passes (the product's path).
//  R3 (REQ-S08-009/011, F-DG4-121 as decided in D-117): five benefits, one per financial class, planned in SAR; the
//     transformation totals and the Finance dashboard agree: gross = margin + cash + working capital (revenue uplift and
//     avoided cost are their own lines, never summed); net = gross − implementation cost; the per-class lines are the
//     amounts entered; a gross line whose state has revenue/avoided lines carries no drill-down href (its drill-down
//     would not sum to it).
// All data is SYNTHETIC; every Finance approval is a synthetic in-product approval of test data. No product gate
// (G1-G6) is decided, and nothing here relates to the engineering gates DG0-DG7.
import { sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, startApi, type TestApi } from "../support/api.ts";
import {
  canon,
  financialBody,
  get200,
  ifMatch,
  insertInitiative,
  seedBenefitWorld,
  seedWorld,
  type Body,
  type BenefitWorld,
  type World,
} from "../support/p4.ts";
import { approve, measuredBenefit, submittedValue } from "../../../apps/api/test/integration/benefits/value-fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
}, 120_000);
afterAll(() => api?.close());

let month = 0;
const period = () => {
  month += 1;
  const m = String(month).padStart(2, "0");
  const end = new Date(Date.UTC(2035, month, 0)).getUTCDate();
  return { periodStart: `2035-${m}-01`, periodEnd: `2035-${m}-${end}` };
};
const FV = () => `${b.base}/finance-validations`;
const validatedOf = async (benefitId: string) => {
  const v = await get200(api, b.s.auditor, `${b.base}/benefits/${benefitId}/values`);
  return (v.series as Body[]).find((s) => s.state === "validated");
};

describe("R1 REQ-S08-017 / F-DG4-101: two simultaneous corrections from one view", () => {
  it("exactly one 201 and one 409; one amendment row; the original stepped once", async () => {
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "100000", period());
    const decided = await approve(api, b, v, "90000");
    const send = (amount: string) =>
      call<Body>(api.app, "POST", `${FV()}/${v.validationId}/amendments`, {
        session: b.s.fin,
        headers: ifMatch(decided.version),
        body: { correctedAmount: amount, reason: `Synthetic: concurrent amendment to ${amount}` },
      });
    const [x, y] = await Promise.all([send("80000"), send("70000")]);
    const statuses = [x.status, y.status].sort();
    expect(statuses, JSON.stringify([x.body, y.body])).toEqual([201, 409]);
    const winner = x.status === 201 ? x : y;
    const loser = x.status === 201 ? y : x;
    expect(loser.body.type ?? loser.body.code, JSON.stringify(loser.body)).toBeTruthy();
    const rows = await api.db
      .selectFrom("finance_validation")
      .select(["kind", "approved_amount"])
      .where("corrects_validation_id", "=", v.validationId)
      .execute();
    expect(rows.length).toBe(1);
    const expected = winner.body.approvedAmount === "-10000.0000" ? "80000.0000" : "70000.0000";
    expect((await validatedOf(ben.id)).total.amount).toBe(expected);
    const original = await api.db
      .selectFrom("finance_validation")
      .select(["version", "approved_amount", "status"])
      .where("id", "=", v.validationId)
      .executeTakeFirstOrThrow();
    expect([original.version, original.status, canon(String(original.approved_amount))]).toEqual([
      decided.version + 1,
      "approved",
      "90000",
    ]);
    // The loser can retry from the new ETag (the client re-reads the original).
    const retry = await call<Body>(api.app, "POST", `${FV()}/${v.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifMatch(decided.version + 1),
      body: { correctedAmount: "60000", reason: "Synthetic: retry from the current version" },
    });
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
    expect((await validatedOf(ben.id)).total.amount).toBe("60000.0000");
  });
});

describe("R2 migration 0061: only the exact +1 version step of a corrected original passes the trigger", () => {
  it("refuses a step with another change, a step of 2, and a step without any correction", async () => {
    // A decided validation without any correction.
    const benA = await measuredBenefit(api, b);
    const vA = await submittedValue(api, b, benA.id, "5000", period());
    const dA = await approve(api, b, vA, "5000");
    const tryUpdate = async (id: string, set: string) => {
      try {
        await sql.raw(`UPDATE finance_validation SET ${set} WHERE id = '${id}'`).execute(api.db);
        return "updated";
      } catch (e) {
        return String((e as { constraint?: string }).constraint ?? (e as Error).message);
      }
    };
    expect(await tryUpdate(vA.validationId, "version = version + 1")).toBe("finance_validation_status_step");
    // Now correct it once through the API (the product path steps it to dA.version + 1).
    const am = await call<Body>(api.app, "POST", `${FV()}/${vA.validationId}/amendments`, {
      session: b.s.fin,
      headers: ifMatch(dA.version),
      body: { correctedAmount: "4000", reason: "Synthetic: corrected once" },
    });
    expect(am.status, JSON.stringify(am.body)).toBe(201);
    expect(await tryUpdate(vA.validationId, "version = version + 1, approved_amount = 1")).toBe(
      "finance_validation_status_step",
    );
    expect(await tryUpdate(vA.validationId, "version = version + 2")).toBe("finance_validation_status_step");
    expect(await tryUpdate(vA.validationId, "version = version + 1, decision_note = 'tampered'")).toBe(
      "finance_validation_status_step",
    );
    const row = await api.db
      .selectFrom("finance_validation")
      .select(["version", "approved_amount", "decision_note"])
      .where("id", "=", vA.validationId)
      .executeTakeFirstOrThrow();
    expect([row.version, canon(String(row.approved_amount))]).toEqual([dA.version + 1, "5000"]);
  });
});

describe("R3 REQ-S08-009/011 + F-DG4-121 (D-117): gross over profit and cash classes only, on totals and the Finance dashboard", () => {
  it("gross = margin + cash + working capital; revenue and avoided cost apart; net = gross − cost", async () => {
    const bw = await seedBenefitWorld(api, w);
    const classes: [string, string, string][] = [
      ["revenue", "revenue_uplift", "300"],
      ["revenue", "margin_uplift", "70"],
      ["cost", "cash_saving", "20"],
      ["cost", "avoided_cost", "45"],
      ["working_capital", "working_capital_release", "5"],
    ];
    for (const [benefitType, valueClass, amount] of classes) {
      const r = await call<Body>(api.app, "POST", `${bw.base}/benefits`, {
        session: bw.s.bo,
        body: financialBody(bw, { benefitType, valueClass, title: `Synthetic ${valueClass}`, financialStatementLine: "Synthetic line" }),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const p = await call<Body>(api.app, "POST", `${bw.base}/benefits/${r.body.id}/plan-values`, {
        session: bw.s.bo,
        body: { valueKind: "planned", periodStart: "2026-01-01", periodEnd: "2026-06-30", amount },
      });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
    }
    // A 30 SAR cash investment line on an initiative business case.
    const BC = "/api/v1/business-cases";
    const top = await call<Body>(api.app, "POST", BC, {
      session: bw.s.tl,
      body: { transformationId: bw.transformationId, level: "transformation", title: "Synthetic transformation case" },
    });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    const ini = await insertInitiative(api.db, bw);
    const iniCase = await call<Body>(api.app, "POST", BC, {
      session: bw.s.tl,
      body: { transformationId: bw.transformationId, level: "initiative", initiativeId: ini, title: "Synthetic case" },
    });
    expect(iniCase.status, JSON.stringify(iniCase.body)).toBe(201);
    const cost = await call<Body>(api.app, "POST", `${BC}/${iniCase.body.id}/lines`, {
      session: bw.s.tl,
      body: { lineKind: "investment", class: "capex", valueBasis: "cash", title: "Synthetic platform", amount: "30", currency: "SAR" },
    });
    expect(cost.status, JSON.stringify(cost.body)).toBe(201);

    const t = await get200(api, bw.s.auditor, `${bw.base}/benefit-totals`);
    const sar = (t.currencies as Body[]).find((c) => c.currency === "SAR");
    const planned = (cls: string) =>
      canon((sar.lines as Body[]).find((l) => l.valueClass === cls && l.state === "planned").total.amount);
    expect(classes.map(([, cls]) => planned(cls))).toEqual(["300", "70", "20", "45", "5"]);
    expect([canon(sar.gross.planned.amount), canon(sar.implementationCost.total.amount), canon(sar.net.planned.amount)]).toEqual([
      "95",
      "30",
      "65",
    ]);

    const fd = await get200(
      api,
      bw.s.auditor,
      `/api/v1/dashboards/finance?organizationId=${bw.organizationId}&transformationId=${bw.transformationId}`,
    );
    const fl = (cls: string, state: string) =>
      (fd.lines as Body[]).filter((l) => l.valueClass === cls && l.state === state && l.currency === "SAR");
    const grossP = fl("gross", "planned");
    const netP = fl("net", "planned");
    expect(grossP.map((l) => canon(l.total.value))).toEqual(["95"]);
    expect(netP.map((l) => canon(l.total.value))).toEqual(["65"]);
    // Revenue uplift is present in the planned state, so the five-class drill-down would not sum to gross: no href.
    expect(grossP[0].drilldownHref).toBeNull();
    expect(["revenue_uplift", "margin_uplift", "cash_saving", "avoided_cost", "working_capital_release"].map((c) =>
      fl(c, "planned").map((l) => canon(l.total.value))[0],
    )).toEqual(["300", "70", "20", "45", "5"]);
  });
});
