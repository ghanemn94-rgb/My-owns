// T-DG4-KBE-R8 byte-stability transcript: KBE-R7's transcript test (evidence/ab of T-DG4-KBE-R7; its worlds and
// requests unchanged, in the same order) extended with one KPI world for D-124 items 1-3, appended after KBE-R7's:
//  - K8: dashboardWorld (its directly inserted ACTIVE outcome, as the earlier probes used), a draft outcome created
//    through the API, and an outcome created then archived through the API; percentage (no label, '% of users'),
//    ratio and an Unknown KPI linked through the API, accepted actuals 0.12 / 0.12 / 1.5, one Stale actual, and an
//    adoption metric link on the labelled percentage KPI;
//  - its requests: T10, the summary header, the overview narrowed to it, the adoption dashboard narrowed to it, and the
//    drill-downs outcomes.area, outcomes.kpi_status (each outcome KPI) and adoption.indicators.
// Evidence only: copied into apps/api/test/integration/reporting/ for one run on A (the KBE-R8 tree before any source
// edit) and one on B (the final tree), then removed. Env: MTH_KBE_R7_TRANSCRIPT (the name is kept from KBE-R7).
// ----- KBE-R7's header follows, unchanged -----
// T-DG4-KBE-R7 byte-stability transcript: KBE-R6's transcript test (its worlds and requests unchanged, in the same
// order) extended with the worlds and requests of F-DG4-126, F-DG4-127 and F-DG4-105 (appended after KBE-R6's).
// Evidence only: copied into apps/api/test/integration/reporting/ of the base tree (A = HEAD 5f0f016, run before any
// edit) and of the KBE-R7 tree (B) for one run each, then removed. Every request is the same in A and B, so the
// transcripts line up request for request. With MTH_KBE_R7_TRANSCRIPT set it records, per world:
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
import { insertInitiative } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import {
  adoptionLink,
  benefitWorldIn,
  dashboardWorld,
  launchedInitiative,
  openPeriod,
  planValue,
  riyadhToday,
  workstreamOf,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { DIRECT_FLOW, ownedKpi, runRecalculation, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";

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

const t = responseTranscript(call, "MTH_KBE_R7_TRANSCRIPT");
let api: TestApi;
let w: World;
const worlds: [string, BenefitWorld][] = [];
let auditor: Session;
let workstreamUrl: string;
let k8: KpiWorld;
const k8OutcomeKpis: string[] = [];

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
  // KBE-R7 worlds. GC: SAR margin 70 and USD revenue uplift 11, nothing validated (probe GC, F-DG4-105).
  const gcw = await benefitWorldIn(api, w, w.a1);
  const gcm = await identified(gcw, financialBody(gcw, { valueClass: "margin_uplift" }));
  await planValue(api, gcw, gcm.id, "70", "2026-01-01", "2026-06-30");
  const gcu = await identified(gcw, financialBody(gcw, { currency: "USD" }));
  await planValue(api, gcw, gcu.id, "11", "2026-01-01", "2026-06-30");
  worlds.push(["GC", gcw]);
  // S6: margin 70 validated 70 beside revenue uplift 300 unvalidated (R3-6a, F-DG4-126).
  const s6 = await benefitWorldIn(api, w, w.a1);
  const s6m = await measuredBenefit(api, s6, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, s6, s6m.id, "70", "2026-01-01", "2026-06-30");
  await validated(s6, s6m.id, "70", "2026-02-01", "2026-02-28");
  const s6r = await identified(s6, financialBody(s6, {}));
  await planValue(api, s6, s6r.id, "300", "2026-01-01", "2026-06-30");
  worlds.push(["S6", s6]);
  // P: the Portfolio basis (F-DG4-127): INI-A revenue 300 only; INI-B margin 70; INI-C nothing; INI-D margin 70 at
  // share 0.5 and avoided cost 45 (35 on the profit-and-cash basis); all completed.
  const p = await benefitWorldIn(api, w, w.a1);
  const iniA = await insertInitiative(api.db, p, { status: "completed" });
  const iniB = await insertInitiative(api.db, p, { status: "completed" });
  await insertInitiative(api.db, p, { status: "completed" });
  const iniD = await insertInitiative(api.db, p, { status: "completed" });
  const allocate = async (id: string, allocations: { initiativeId: string; share: string }[]) => {
    const cur = await call<Body>(api.app, "GET", `${p.base}/benefits/${id}`, { session: auditor });
    const r = await call<Body>(api.app, "PUT", `${p.base}/benefits/${id}/allocations`, {
      session: p.s.tl,
      headers: { "if-match": `"${cur.body.version}"` },
      body: { allocations },
    });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  };
  const pr = await identified(p, financialBody(p, {}));
  await planValue(api, p, pr.id, "300", "2026-01-01", "2026-06-30");
  await allocate(pr.id, [{ initiativeId: iniA, share: "1" }]);
  const pm = await identified(p, financialBody(p, { valueClass: "margin_uplift" }));
  await planValue(api, p, pm.id, "70", "2026-01-01", "2026-06-30");
  await allocate(pm.id, [
    { initiativeId: iniB, share: "0.5" },
    { initiativeId: iniD, share: "0.5" },
  ]);
  const pa = await identified(p, financialBody(p, { valueClass: "avoided_cost", ...cost, financialStatementLine: "Opex - network" }));
  await planValue(api, p, pa.id, "45", "2026-01-01", "2026-06-30");
  await allocate(pa.id, [{ initiativeId: iniD, share: "1" }]);
  worlds.push(["P", p]);
  // A workstream dashboard (no benefit allocated): the non-value headlines.
  const k = await dashboardWorld(api, w, w.a1);
  const ini = await launchedInitiative(api.db, k, w.orgA.id, "INI-01");
  const ws = await workstreamOf(api.db, k, w.orgA.id, [ini], { code: "WS-01" });
  workstreamUrl = `${k.base}/workstreams/${ws}/dashboard`;
  let n0 = 0;
  for (const [, b] of worlds) await pinCode(b.transformationId, b.users.tl.id, `TXA0000${(n0 += 1)}`);
  await pinCode(k.transformationId, k.users.tl.id, "TXB00001");
  // KBE-R8 (appended): the K8 world.
  k8 = await dashboardWorld(api, w, w.a1);
  const { today } = await riyadhToday(api);
  const april = await openPeriod(api, w, "monthly", "2026-04", "2026-04-01", "2026-04-30");
  let kpiNo = 0;
  const kpiOf = async (unitKind: string, unitLabel: string | null) =>
    (await ownedKpi(api, k8, DIRECT_FLOW, { unitKind, unitLabel, name: `Synthetic K8 KPI ${(kpiNo += 1)}` })).id;
  const actual = async (kpiId: string, value: string, dataAsOf: string) => {
    const r = await submitActual(api, k8, kpiId, { reportingPeriodId: april.id, value, dataAsOf });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    await runRecalculation(api, r.body.actual.id);
  };
  const outcome = async (statement: string) => {
    const r = await call<Body>(api.app, "POST", `${k8.base}/outcomes`, { session: k8.s.tl, body: { statement, ownerUserId: k8.users.tl.id } });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body as Body;
  };
  const link = async (outcomeId: string, kpiDefinitionId: string) => {
    const r = await call<Body>(api.app, "POST", `${k8.base}/outcome-kpis`, { session: k8.s.tl, body: { outcomeId, kpiDefinitionId, targetDate: "2026-12-31" } });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    k8OutcomeKpis.push(r.body.id);
  };
  const pct = await kpiOf("percentage", null);
  const pctLabel = await kpiOf("percentage", "% of users");
  const ratio = await kpiOf("ratio", null);
  const stale = await kpiOf("percentage", "% of users");
  const unknown = await kpiOf("ratio", null);
  const draft = await outcome("Synthetic K8 draft outcome (API)");
  await link(draft.id, pctLabel);
  await link(draft.id, stale);
  await link(k8.outcomeId, pct);
  await link(k8.outcomeId, ratio);
  await link(k8.outcomeId, unknown);
  const gone = await outcome("Synthetic K8 archived outcome (API)");
  await link(gone.id, pct);
  const ar = await call<Body>(api.app, "POST", `${k8.base}/outcomes/${gone.id}/archive`, { session: k8.s.tl, headers: ifm(gone.version), body: { reason: "Synthetic K8 archive" } });
  if (ar.status !== 200) throw new Error(JSON.stringify(ar.body));
  await actual(pct, "0.12", today);
  await actual(pctLabel, "0.12", today);
  await actual(ratio, "1.5", today);
  await actual(stale, "0.12", "2020-01-01");
  await adoptionLink(api.db, k8, w.orgA.id, pctLabel);
  await pinCode(k8.transformationId, k8.users.tl.id, "TXB00002");
}, 400_000);
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
  // KBE-R7 (appended): the new worlds' drill-downs, the `currency` parameter, value.gap by basis, portfolio.initiatives.
  const more = [
    ...worlds.filter(([n]) => ["GC", "S6", "P"].includes(n)).map(([, b]) => `&transformationId=${b.transformationId}`),
  ];
  for (const scope of more) {
    for (const metric of VALUE_METRICS)
      for (const cls of [null, ...FINANCE_VALUE_CLASSES])
        await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}${scope}${cls ? `&valueClass=${cls}` : ""}`);
    for (const metric of OTHER_METRICS) await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}${scope}`);
  }
  for (const scope of [...scopes, ...more]) {
    for (const metric of ["value.planned", "value.validated", "value.gap", "value.investment"])
      for (const cur of ["SAR", "USD"])
        await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}${scope}&currency=${cur}`);
    for (const cls of ["revenue_uplift", "avoided_cost", "margin_uplift"]) {
      await get(`/api/v1/dashboard-drilldown?metric=value.gap&organizationId=${org}${scope}&valueClass=${cls}`);
      await get(`/api/v1/dashboard-drilldown?metric=value.gap&organizationId=${org}${scope}&valueClass=${cls}&currency=SAR`);
    }
    await get(`/api/v1/dashboard-drilldown?metric=value.planned&organizationId=${org}${scope}&valueClass=revenue_uplift&currency=USD`);
    await get(`/api/v1/dashboard-drilldown?metric=portfolio.initiatives&organizationId=${org}${scope}`);
    await get(`/api/v1/dashboard-drilldown?metric=decisions.open&organizationId=${org}${scope}&currency=SAR`);
    await get(`/api/v1/dashboard-drilldown?metric=value.planned&organizationId=${org}${scope}&currency=sar`);
  }
  // KBE-R8 (appended): the K8 world.
  const k8s = `&transformationId=${k8.transformationId}`;
  await get(`${k8.base}/dashboard`);
  await get(`${k8.base}/summary`);
  await get(`/api/v1/overview?organizationId=${org}${k8s}`);
  await get(`/api/v1/dashboards/adoption?organizationId=${org}${k8s}`);
  await get(`/api/v1/dashboard-drilldown?metric=outcomes.area&organizationId=${org}${k8s}`);
  await get(`/api/v1/dashboard-drilldown?metric=adoption.indicators&organizationId=${org}${k8s}`);
  for (const id of k8OutcomeKpis) await get(`/api/v1/dashboard-drilldown?metric=outcomes.kpi_status&organizationId=${org}&subjectId=${id}`);
  await get(`/api/v1/overview?organizationId=${org}`);
});
