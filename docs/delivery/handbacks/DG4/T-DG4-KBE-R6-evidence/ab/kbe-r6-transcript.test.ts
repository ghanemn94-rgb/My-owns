// T-DG4-KBE-R6 byte-stability transcript (the BE-M2/BE-R3/KBE-R5 A/B recorded-response method; response-transcript.ts).
// Evidence only: copied into apps/api/test/integration/reporting/ of the base copy (A = HEAD 47d1536 with this task's
// diff reversed) and of the KBE-R6 tree (B) for one run each, then removed. Every request is the same in A and B, so the
// transcripts line up request for request. With MTH_KBE_R6_TRANSCRIPT set it records, per world:
//  - X: all five financial classes in SAR, a USD revenue uplift, an overlap hold, a valued CX benefit, values in every
//    state (the KBE-R5 world); G: profit-and-cash classes only (margin, cash saving, working capital); R: revenue uplift
//    and avoided cost only (variant A); N: a non-financial benefit only; E: a transformation with no benefit;
//  - for each: T10, the workspace header, the Finance dashboard and the overview narrowed to it;
//  - org-wide: the overview, the Finance and adoption dashboards; a workstream dashboard (no benefit);
//  - a FIXED list of drill-downs: every value-state metric without and with each FinanceValueClass, value.gap,
//    value.investment, outcomes.area, finance.pending_validation, for X, G, R and the organization.
// Normalization: ids, instants and 64-hex hashes (response-transcript.ts) and the harness's random TX codes (compare.py).
// All data is SYNTHETIC; a Finance validation or valuation-method approval here is a synthetic in-product business
// approval of test data that approves nothing real; nothing here touches the engineering gates DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { FINANCE_VALUE_CLASSES } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { responseTranscript } from "../../support/response-transcript.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { cxBody, financialBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import {
  benefitWorldIn,
  dashboardWorld,
  launchedInitiative,
  planValue,
  workstreamOf,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";

const VALUE_METRICS = [
  "value.planned",
  "value.forecast",
  "value.measured",
  "value.submitted",
  "value.validated",
  "value.rejected",
  "value.sustained",
];
const OTHER_METRICS = ["value.gap", "value.investment", "outcomes.area", "finance.pending_validation"];

const t = responseTranscript(call, "MTH_KBE_R6_TRANSCRIPT");
let api: TestApi;
let w: World;
const worlds: [string, BenefitWorld][] = [];
let auditor: Session;
let workstreamUrl: string;

async function get(url: string, session: Session = auditor) {
  const r = await call<Body>(api.app, "GET", url, { session });
  t.note(`GET ${url}`, { status: r.status, headers: r.headers, body: r.body });
  return r;
}
/**
 * Pins a fixture transformation's random code (harness uniq "TX" + 6 hex) to a fixed one, with its audit event, so the
 * lists ordered by code (overview, Finance, adoption) have the same order in A and B. Fixture data, the same on both
 * sides; not a product byte.
 */
async function pinCode(transformationId: string, actorUserId: string, code: string) {
  await api.db.transaction().execute(async (tx) => {
    await tx.updateTable("transformation").set({ code }).where("id", "=", transformationId).execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId, requestId: `fixture-${uuidv7()}`, source: "api" },
      {
        action: "transformation.update",
        recordType: "transformation",
        recordId: transformationId,
        organizationId: w.orgA.id,
        transformationId,
        newVersion: 1,
      },
    );
  });
}
async function validated(b: BenefitWorld, id: string, amount: string, start: string, end: string) {
  await approve(api, b, await submittedValue(api, b, id, amount, { periodStart: start, periodEnd: end }), amount);
}
async function identified(b: BenefitWorld, body: Record<string, unknown>): Promise<Body> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  auditor = await signIn(api.app, w.auditor.subject);
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const wcBody = { benefitType: "working_capital", valueClass: "working_capital_release", financialStatementLine: "Working capital - inventory" };
  // X: all five financial classes in SAR, USD revenue, an overlap hold, a valued CX benefit.
  const x = await benefitWorldIn(api, w, w.a1);
  const a = await measuredBenefit(api, x);
  await planValue(api, x, a.id, "1000", "2026-02-01", "2026-02-28");
  await validated(x, a.id, "900", "2026-02-01", "2026-02-28");
  const m = await measuredBenefit(api, x, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, x, m.id, "70.05", "2026-02-01", "2026-02-28");
  await validated(x, m.id, "30.5", "2026-03-01", "2026-03-31");
  await submittedValue(api, x, m.id, "12.25", { periodStart: "2026-04-01", periodEnd: "2026-04-30" });
  const window = { driverKey: "synthetic-r6-driver", realizationStart: "2026-01-01", realizationEnd: "2026-12-31" };
  const d = await measuredBenefit(api, x, { extra: { valueClass: "avoided_cost", ...cost, ...window } });
  await planValue(api, x, d.id, "400", "2026-02-01", "2026-02-28");
  await validated(x, d.id, "350", "2026-02-01", "2026-02-28");
  const d2 = await identified(x, financialBody(x, { valueClass: "cash_saving", ...cost, ...window }));
  await planValue(api, x, d2.id, "5", "2026-02-01", "2026-02-28");
  const wc = await identified(x, financialBody(x, wcBody));
  await planValue(api, x, wc.id, "2.5", "2026-02-01", "2026-02-28");
  const vm = await call<Body>(api.app, "POST", `${x.base}/benefit-valuation-methods`, {
    session: x.s.bo,
    body: {
      name: "Synthetic NPS point value",
      method: "Each NPS point is valued at the synthetic retention value per point.",
      appliesToType: "cx",
      kpiDefinitionId: x.kpiDefinitionId,
      unitValue: "125000",
      currency: "SAR",
    },
  });
  await call(api.app, "POST", `${x.base}/benefit-valuation-methods/${vm.body.id}/decision`, {
    session: x.s.fin,
    headers: ifm(1),
    body: { decision: "approved", note: "Synthetic approval" },
  });
  const e = await identified(x, cxBody(x, { valuationMethodId: vm.body.id }));
  await planValue(api, x, e.id, "125000", "2026-02-01", "2026-02-28");
  const u = await identified(x, financialBody(x, { currency: "USD" }));
  await planValue(api, x, u.id, "2000", "2026-02-01", "2026-02-28");
  const fc = await call<Body>(api.app, "POST", `${x.base}/benefits/${u.id}/plan-values`, {
    session: x.s.bo,
    body: { valueKind: "forecast", periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: "300" },
  });
  if (fc.status !== 201) throw new Error(JSON.stringify(fc.body));
  worlds.push(["X", x]);
  // G: only the profit-and-cash classes.
  const g = await benefitWorldIn(api, w, w.a2);
  const gm = await measuredBenefit(api, g, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, g, gm.id, "100", "2026-02-01", "2026-02-28");
  await validated(g, gm.id, "40", "2026-02-01", "2026-02-28");
  const gc = await identified(g, financialBody(g, { valueClass: "cash_saving", ...cost }));
  await planValue(api, g, gc.id, "10", "2026-02-01", "2026-02-28");
  const gw = await identified(g, financialBody(g, wcBody));
  await planValue(api, g, gw.id, "3", "2026-02-01", "2026-02-28");
  worlds.push(["G", g]);
  // R: revenue uplift 300 and avoided cost 45 only (variant A).
  const r = await benefitWorldIn(api, w, w.a1);
  const rr = await identified(r, financialBody(r, {}));
  await planValue(api, r, rr.id, "300", "2026-01-01", "2026-06-30");
  const ra = await identified(r, financialBody(r, { valueClass: "avoided_cost", ...cost, financialStatementLine: "Opex - network" }));
  await planValue(api, r, ra.id, "45", "2026-01-01", "2026-06-30");
  worlds.push(["R", r]);
  // N: a non-financial benefit only; E: no benefit at all.
  const n = await benefitWorldIn(api, w, w.a1);
  await identified(n, cxBody(n));
  worlds.push(["N", n]);
  worlds.push(["E", await benefitWorldIn(api, w, w.a1)]);
  // A workstream dashboard (no benefit allocated): the non-value headlines.
  const k = await dashboardWorld(api, w, w.a1);
  const ini = await launchedInitiative(api.db, k, w.orgA.id, "INI-01");
  const ws = await workstreamOf(api.db, k, w.orgA.id, [ini], { code: "WS-01" });
  workstreamUrl = `${k.base}/workstreams/${ws}/dashboard`;
  let n0 = 0;
  for (const [, b] of worlds) await pinCode(b.transformationId, b.users.tl.id, `TXA0000${(n0 += 1)}`);
  await pinCode(k.transformationId, k.users.tl.id, "TXB00001");
}, 300_000);
afterAll(async () => {
  t.flush();
  await api.close();
});

it("records the transcript", async () => {
  const org = w.orgA.id;
  for (const [, b] of worlds) {
    await get(`${b.base}/dashboard`);
    await get(`${b.base}/summary`);
    await get(`/api/v1/dashboards/finance?organizationId=${org}&transformationId=${b.transformationId}`);
    await get(`/api/v1/overview?organizationId=${org}&transformationId=${b.transformationId}`);
  }
  await get(`/api/v1/overview?organizationId=${org}`);
  await get(`/api/v1/dashboards/finance?organizationId=${org}`);
  await get(`/api/v1/dashboards/adoption?organizationId=${org}`);
  await get(workstreamUrl);
  const scopes = [...worlds.filter(([n]) => ["X", "G", "R"].includes(n)).map(([, b]) => `&transformationId=${b.transformationId}`), ""];
  for (const scope of scopes) {
    for (const metric of VALUE_METRICS)
      for (const cls of [null, ...FINANCE_VALUE_CLASSES])
        await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}${scope}${cls ? `&valueClass=${cls}` : ""}`);
    for (const metric of OTHER_METRICS) await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}${scope}`);
  }
});
