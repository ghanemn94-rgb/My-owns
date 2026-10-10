// T-DG4-KBE-R4 byte-stability transcript (the BE-M2/BE-R3 A/B recorded-response method; response-transcript.ts).
// Evidence only: copied into apps/api/test/integration/reporting/ of the base tree (A, 48eba10) and of the KBE-R4 tree
// (B) for one run each, then removed. It records, with MTH_KBE_R4_TRANSCRIPT set, every dashboard, drill-down and KPI
// calculation-run response over one fixture built only with base-commit APIs:
//  - the Finance dashboard (X-scoped, org-wide for the auditor), the executive overview, the X transformation dashboard
//    and the adoption dashboard;
//  - every href those responses carry (headlines and Finance lines), first page (limit=1) and second page (cursor);
//  - every base DashboardMetric org-wide (no valueClass), and the four value metrics with a benefit subjectId;
//  - getCalculationRun of every KPI run: period and cumulative evaluations, entered and rolled up.
// Normalization: ids, instants, 64-hex hashes and opaque cursors are replaced by first-appearance placeholders;
// every other byte is kept. All data is synthetic.
import { afterAll, beforeAll, it } from "vitest";
import { call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { responseTranscript } from "../../support/response-transcript.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { cxBody, financialBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { ALL_ACCEPTED, approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { benefitWorldIn, planValue, type Body } from "../contract/p4-exercises-kbe-g.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { DIRECT_FLOW, monthlyPeriod, ownedKpi, runRecalculation, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";

const BASE_METRICS = [
  "outcomes.area",
  "value.planned",
  "value.forecast",
  "value.validated",
  "value.submitted",
  "value.investment",
  "value.gap",
  "portfolio.initiatives",
  "dependencies.open",
  "decisions.open",
  "decisions.overdue",
  "adoption.indicators",
  "finance.pending_validation",
];

const t = responseTranscript(call, "MTH_KBE_R4_TRANSCRIPT");
let api: TestApi;
let w: World;
let x: BenefitWorld;
let k: KpiWorld;
let xUser: Session;
let auditor: Session;
let revenueId: string;
const runIds: string[] = [];

/** Cursors are opaque (they embed a hash over the filters, i.e. over run-specific ids): first-appearance placeholders. */
const cursors = new Map<string, string>();
const cursorTag = (c: string) => {
  if (!cursors.has(c)) cursors.set(c, `<cursor${cursors.size}>`);
  return cursors.get(c)!;
};
async function get(url: string, session: Session) {
  const r = await call<Body>(api.app, "GET", url, { session });
  const body =
    r.body && typeof r.body === "object" && typeof r.body.nextCursor === "string"
      ? { ...r.body, nextCursor: cursorTag(r.body.nextCursor) }
      : r.body;
  t.note(`GET ${url.replace(/cursor=[^&]+/, (m) => `cursor=${cursorTag(decodeURIComponent(m.slice(7)))}`)}`, {
    status: r.status,
    headers: r.headers,
    body,
  });
  return r;
}

async function reject(b: BenefitWorld, v: { validationId: string; validationVersion: number }) {
  const r = await call<Body>(api.app, "POST", `${b.base}/finance-validations/${v.validationId}/decision`, {
    session: b.s.fin,
    headers: ifm(v.validationVersion),
    body: {
      decision: "rejected",
      items: { ...ALL_ACCEPTED, evidence: { decision: "rejected", note: "Synthetic: extract unsigned" } },
      note: "Synthetic rejection",
    },
  });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
}
async function toSustain(b: BenefitWorld, benefitId: string) {
  const cur = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}`, { session: b.s.bo });
  const p = await call<Body>(api.app, "PATCH", `${b.base}/benefits/${benefitId}`, {
    session: b.s.bo,
    headers: ifm(cur.body.version),
    body: { bauOwnerUserId: b.users.bo2.id, controlCadence: "quarterly" },
  });
  const s = await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/lifecycle`, {
    session: b.s.bo,
    headers: ifm(p.body.version),
    body: { toStep: "sustain" },
  });
  if (s.status !== 200) throw new Error(JSON.stringify(s.body));
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
  // Benefits: the K1 fixture (two SAR financial classes and two more, USD, an overlap hold, a valued CX benefit, all
  // seven states).
  x = await benefitWorldIn(api, w, w.a1);
  const a = await measuredBenefit(api, x);
  revenueId = a.id;
  await planValue(api, x, a.id, "1000", "2026-02-01", "2026-02-28");
  await planValue(api, x, a.id, "500", "2026-03-01", "2026-03-31");
  await call(api.app, "POST", `${x.base}/benefits/${a.id}/plan-values`, {
    session: x.s.bo,
    body: { valueKind: "forecast", periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: "300" },
  });
  await validated(x, a.id, "900", "2026-02-01", "2026-02-28");
  await reject(x, await submittedValue(api, x, a.id, "40", { periodStart: "2026-04-01", periodEnd: "2026-04-30" }));
  await toSustain(x, a.id);
  await validated(x, a.id, "120", "2026-05-01", "2026-05-31");
  const b = await measuredBenefit(api, x, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, x, b.id, "70.05", "2026-02-01", "2026-02-28");
  await validated(x, b.id, "30.5", "2026-03-01", "2026-03-31");
  await submittedValue(api, x, b.id, "12.25", { periodStart: "2026-04-01", periodEnd: "2026-04-30" });
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const window = { driverKey: "synthetic-k1-driver", realizationStart: "2026-01-01", realizationEnd: "2026-12-31" };
  const d = await measuredBenefit(api, x, { extra: { valueClass: "avoided_cost", ...cost, ...window } });
  await planValue(api, x, d.id, "400", "2026-02-01", "2026-02-28");
  await validated(x, d.id, "350", "2026-02-01", "2026-02-28");
  const d2 = await identified(x, financialBody(x, { valueClass: "cash_saving", ...cost, ...window }));
  await planValue(api, x, d2.id, "5", "2026-02-01", "2026-02-28");
  const m = await call<Body>(api.app, "POST", `${x.base}/benefit-valuation-methods`, {
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
  await call(api.app, "POST", `${x.base}/benefit-valuation-methods/${m.body.id}/decision`, {
    session: x.s.fin,
    headers: ifm(1),
    body: { decision: "approved", note: "Synthetic approval" },
  });
  const e = await identified(x, cxBody(x, { valuationMethodId: m.body.id }));
  await planValue(api, x, e.id, "125000", "2026-02-01", "2026-02-28");
  await identified(x, cxBody(x, { title: "Synthetic unvalued CX" }));
  const u = await identified(x, financialBody(x, { currency: "USD" }));
  await planValue(api, x, u.id, "2000", "2026-02-01", "2026-02-28");

  // KPIs: a business-unit flow KPI over two periods (period and cumulative, entered and rolled up, one missing-scope
  // run) and a transformation KPI with an incomplete window.
  k = await seedKpiWorld(api, w);
  let p1 = await monthlyPeriod(api, w);
  while (p1.start.slice(5, 7) === "12") p1 = await monthlyPeriod(api, w);
  const p2 = await monthlyPeriod(api, w);
  const ytdStartMonth = Number(p1.start.slice(5, 7));
  const bu = await ownedKpi(api, k, { ...DIRECT_FLOW, entryScopeKind: "business_unit", ytdStartMonth });
  const tr = await ownedKpi(api, k, { ...DIRECT_FLOW, ytdStartMonth });
  const accept = async (kpiId: string, scopeKind: string, scopeId: string, periodId: string, value: string) => {
    const r = await submitActual(api, k, kpiId, { reportingPeriodId: periodId, scopeKind, scopeId, value });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    const runs = await runRecalculation(api, r.body.actual.id);
    for (const run of runs) if (run.runId) runIds.push(run.runId);
  };
  await accept(bu.id, "business_unit", w.a1, p1.id, "4");
  await accept(bu.id, "business_unit", w.a2, p1.id, "6");
  await accept(bu.id, "business_unit", w.a1, p2.id, "10");
  await accept(bu.id, "business_unit", w.a2, p2.id, "20");
  await accept(tr.id, "transformation", k.transformationId, p2.id, "7");

  const user = await createUser(api.db, w.orgA.id);
  for (const role of ["FIN", "TL"])
    await grant(api.db, w.grantor.id, user.id, role, { type: "transformation", id: x.transformationId }, w.orgA.id);
  xUser = await signIn(api.app, user.subject);
  auditor = await signIn(api.app, w.auditor.subject);
}, 300_000);
afterAll(async () => {
  t.flush();
  await api.close();
});

it("records the transcript", async () => {
  const hrefs: string[] = [];
  const collect = (body: Body) => {
    for (const h of (body.headlines ?? []) as Body[]) if (h.drilldownHref) hrefs.push(h.drilldownHref);
    for (const l of (body.lines ?? []) as Body[]) if (l.drilldownHref) hrefs.push(l.drilldownHref);
    for (const a of (body.areas ?? []) as Body[]) for (const h of a.headlines ?? []) if (h.drilldownHref) hrefs.push(h.drilldownHref);
    for (const i of (body.indicators ?? []) as Body[]) if (i.drilldownHref) hrefs.push(i.drilldownHref);
  };
  const org = w.orgA.id;
  collect((await get(`/api/v1/dashboards/finance?organizationId=${org}&transformationId=${x.transformationId}`, xUser)).body);
  collect((await get(`/api/v1/dashboards/finance?organizationId=${org}`, auditor)).body);
  collect((await get(`/api/v1/overview?organizationId=${org}`, auditor)).body);
  collect((await get(`${x.base}/dashboard`, xUser)).body);
  collect((await get(`/api/v1/dashboards/adoption?organizationId=${org}`, auditor)).body);
  // Each distinct href once, in first-appearance order. The hrefs with a valueClass (only B has them: K1) are followed
  // LAST, after every response A also records, so the first-appearance placeholders of the common part line up.
  const unique = [...new Set(hrefs)];
  const follow = async (h: string) => {
    const first = await get(`${h}&limit=1`, auditor);
    if (first.body?.nextCursor) await get(`${h}&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`, auditor);
  };
  for (const h of unique.filter((h) => !h.includes("valueClass="))) await follow(h);
  for (const metric of BASE_METRICS) await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}`, auditor);
  for (const metric of ["value.planned", "value.forecast", "value.validated", "value.submitted"])
    await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}&subjectId=${revenueId}`, auditor);
  for (const runId of runIds) await get(`${k.base}/calculation-runs/${runId}`, k.s.auditor);
  t.note("---- K1 value-class hrefs (B only) ----", { status: 0, headers: {}, body: { count: unique.filter((h) => h.includes("valueClass=")).length } });
  for (const h of unique.filter((h) => h.includes("valueClass="))) await follow(h);
});
