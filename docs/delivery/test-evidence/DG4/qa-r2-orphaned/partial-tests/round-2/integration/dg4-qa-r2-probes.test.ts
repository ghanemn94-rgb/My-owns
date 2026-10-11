// qa-verifier DG4 round 2 (T-DG4-REV-QA-R2): independent probes of the round-1 repairs that touch DG4-final acceptance
// texts, on the frozen candidate 3f51b79d (source 93a7dd7). This file lives OUTSIDE the frozen candidate and is copied
// into a disposable clone only to run.
//
//  P1 REQ-S08-009 / REQ-S08-011 on the FINANCE DASHBOARD (not the benefit-totals endpoint the product tests use for
//     DOM-GROSS), with all five financial classes present, including working_capital_release, which no product test of
//     the D-117 rule plans: "the Finance dashboard shows revenue uplift and margin benefit on separate lines; cost
//     avoidance is not counted in cash savings"; gross (D-117) = margin + cash + working capital only; net = gross -
//     implementation cost; a gross line whose state holds a revenue or avoided-cost line has no drill-down href.
//  P2 F-DG4-101 reliability: two Finance users send an amendment of the same original with the SAME ETag at the same
//     moment (Promise.all, not one after the other). Exactly one may win (201); the other must get 409 with the current
//     version; exactly one correction row is written and the original's version steps exactly once.
//
// All data is SYNTHETIC; every Finance approval is a synthetic in-product approval of test data, approves nothing real
// and never relates to the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import {
  extraUser,
  financialBody,
  insertInitiative,
  seedBenefitWorld,
  type BenefitWorld,
} from "../../../apps/api/test/integration/benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../../../apps/api/test/integration/benefits/value-fixtures.ts";
import { signIn } from "../../../apps/api/test/support/harness.ts";
import { canon } from "../support/p4.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let auditor: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  auditor = await signIn(api.app, w.auditor.subject);
}, 300_000);
afterAll(async () => {
  await api.close();
}, 60_000);

// Revision 2: decimal.js is not resolvable from tests/qa (run 1 failed to import it); canon() is the QA kit's pure
// string decimal canonicaliser (never a float).
const dec = (v: unknown) => (v === null || v === undefined ? null : canon(String(v)));

describe("P1 REQ-S08-009 / S08-011 on the Finance dashboard with all five financial classes", () => {
  it("revenue 300, margin 70, cash 20, avoided 45, working capital 10 planned; cost 30 -> separate lines, cash 20, gross 100, net 70", async () => {
    const b: BenefitWorld = await seedBenefitWorld(api, w);
    const mk = async (extra: Record<string, unknown>) => {
      const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, extra) });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body as Body;
    };
    const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
    const set: [Body, string][] = [
      [await mk({ valueClass: "revenue_uplift" }), "300"],
      [await mk({ valueClass: "margin_uplift" }), "70"],
      [await mk({ ...cost, valueClass: "cash_saving" }), "20"],
      [await mk({ ...cost, valueClass: "avoided_cost" }), "45"],
      [
        await mk({
          benefitType: "working_capital",
          valueClass: "working_capital_release",
          financialStatementLine: "Working capital",
        }),
        "10",
      ],
    ];
    // Past period: planned values are 'to date' on the Finance dashboard (period end on or before the as-of date).
    for (const [ben, amount] of set) {
      const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${ben.id}/plan-values`, {
        session: b.s.bo,
        body: { valueKind: "planned", periodStart: "2026-02-01", periodEnd: "2026-02-28", amount },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    // Implementation cost 30 SAR on an initiative case (the A10 path).
    const BC = "/api/v1/business-cases";
    const top = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "transformation", title: "Synthetic QA-R2 case" },
    });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    const ini = await insertInitiative(api.db, b);
    const iniCase = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "initiative", initiativeId: ini, title: "Synthetic QA-R2" },
    });
    expect(iniCase.status, JSON.stringify(iniCase.body)).toBe(201);
    const line = await call<Body>(api.app, "POST", `${BC}/${iniCase.body.id}/lines`, {
      session: b.s.tl,
      body: { lineKind: "investment", class: "capex", valueBasis: "cash", title: "Synthetic", amount: "30", currency: "SAR" },
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);

    const r = await call<Body>(
      api.app,
      "GET",
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${b.transformationId}`,
      { session: auditor },
    );
    expect(r.status, JSON.stringify(r.body).slice(0, 800)).toBe(200);
    const lines = r.body.lines as Body[];
    const of = (cls: string, state = "planned") =>
      lines.filter((l) => l.valueClass === cls && l.state === state && l.currency === "SAR");
    // Separate lines: one line per class; revenue and margin are not merged; avoided cost is not in cash saving.
    for (const cls of ["revenue_uplift", "margin_uplift", "cash_saving", "avoided_cost", "working_capital_release"])
      expect(of(cls), cls).toHaveLength(1);
    expect(
      ["revenue_uplift", "margin_uplift", "cash_saving", "avoided_cost", "working_capital_release"].map((c) =>
        dec(of(c)[0].total.value),
      ),
    ).toEqual(["300", "70", "20", "45", "10"]);
    // D-117 gross: margin + cash + working capital = 100 (never 445 or 400 or 145); net = 100 - 30 = 70.
    const gross = of("gross");
    expect(gross).toHaveLength(1);
    expect(dec(gross[0].total.value)).toBe("100");
    expect(gross[0].drilldownHref, "revenue and avoided-cost lines enter SAR planned: no gross drill-down").toBeNull();
    const net = of("net");
    expect(net).toHaveLength(1);
    expect(dec(net[0].total.value)).toBe("70");
    console.log(
      "QA-R2-P1",
      JSON.stringify(
        lines
          .filter((l) => l.currency === "SAR" && l.state === "planned")
          .map((l) => [l.valueClass, dec(l.total.value), l.drilldownHref === null ? "href:null" : "href"]),
      ),
    );
  });
});

describe("P2 F-DG4-101 under true concurrency: two simultaneous amendments with the same ETag", () => {
  it("exactly one 201 and one 409 version_conflict; one correction row; the original steps once", async () => {
    const b: BenefitWorld = await seedBenefitWorld(api, w);
    const finB = await extraUser(api, w, b, "FIN");
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "1000", { periodStart: "2034-03-01", periodEnd: "2034-03-31" });
    const decided = await approve(api, b, v, "1000");
    const held = decided.version as number;
    const FV = `${b.base}/finance-validations/${v.validationId}/amendments`;
    const [x, y] = await Promise.all([
      call<Body>(api.app, "POST", FV, {
        session: b.s.fin,
        headers: ifm(held),
        body: { correctedAmount: "1100", reason: "Synthetic: FIN-A concurrent" },
      }),
      call<Body>(api.app, "POST", FV, {
        session: finB.session,
        headers: ifm(held),
        body: { correctedAmount: "900", reason: "Synthetic: FIN-B concurrent" },
      }),
    ]);
    const statuses = [x.status, y.status].sort();
    console.log("QA-R2-P2", JSON.stringify([[x.status, x.body.code ?? x.body.approvedAmount], [y.status, y.body.code ?? y.body.approvedAmount]]));
    expect(statuses).toEqual([201, 409]);
    const loser = x.status === 409 ? x : y;
    const winner = x.status === 201 ? x : y;
    expect([loser.body.code, loser.body.currentVersion]).toEqual(["version_conflict", held + 1]);
    const corrections = await api.db
      .selectFrom("finance_validation")
      .select(["kind", "approved_amount"])
      .where("corrects_validation_id", "=", v.validationId)
      .execute();
    expect(corrections).toHaveLength(1);
    expect(dec(corrections[0]!.approved_amount)).toBe(dec(winner.body.approvedAmount));
    const orig = await api.db
      .selectFrom("finance_validation")
      .select(["version", "approved_amount", "status"])
      .where("id", "=", v.validationId)
      .executeTakeFirstOrThrow();
    expect([orig.version, dec(orig.approved_amount), orig.status]).toEqual([held + 1, "1000", "approved"]);
    const stepAudits = await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("record_id", "=", v.validationId)
      .where("action", "=", "finance_validation.corrected")
      .execute();
    expect(stepAudits).toHaveLength(1);
  });
});
