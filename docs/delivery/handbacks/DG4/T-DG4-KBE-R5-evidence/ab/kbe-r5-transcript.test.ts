// T-DG4-KBE-R5 byte-stability transcript (the BE-M2/BE-R3 A/B recorded-response method; response-transcript.ts).
// Evidence only: copied into apps/api/test/integration/benefits/ of the base copy (A = HEAD f5579e7 with this task's
// diff reversed) and of the KBE-R5 tree (B) for one run each, then removed. Every request is the same in A and B (the
// ETag of each correction is read from a GET first, as a client does), so the transcripts line up request for request.
// It records, with MTH_KBE_R5_TRANSCRIPT set:
//  - benefit totals of X (all five financial classes, USD, an overlap hold, a valued CX benefit), of G (gross classes
//    only: margin, cash saving, working capital) and of the organization (portfolio);
//  - the Finance dashboard of X, of G and org-wide; the executive overview; the X and G transformation dashboards;
//  - a FIXED list of drill-downs (every value-state metric, without and with each FinanceValueClass, for X, G and the
//    organization), so that the list does not depend on which hrefs a response carries;
//  - a correction chain in C: the original validation, an amendment and a reversal, each made with the ETag a GET just
//    returned, the original after each, the queue, the benefit's values and C's totals;
//  - every slice B mutation (26) attempted as AUD and as the ADM-only user, against C's records: the 403 bodies.
// Normalization: ids, instants and 64-hex hashes (response-transcript.ts); every other byte is kept. Synthetic data.
import { FINANCE_VALUE_CLASSES } from "@mth/shared/schemas";
import { afterAll, beforeAll, it } from "vitest";
import { operations } from "../../support/contract.ts";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { responseTranscript } from "../../support/response-transcript.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { cxBody, financialBody, insertInitiative, type BenefitWorld } from "./fixtures.ts";
import { ALL_ACCEPTED, approve, measuredBenefit, submittedValue } from "./value-fixtures.ts";
import { benefitWorldIn, planValue, type Body } from "../contract/p4-exercises-kbe-g.ts";

const SLICE_B_MUTATIONS = [
  "createBenefit",
  "updateBenefit",
  "archiveBenefit",
  "advanceBenefitLifecycle",
  "createBenefitEnabler",
  "removeBenefitEnabler",
  "replaceBenefitAllocations",
  "createBenefitGroup",
  "updateBenefitGroup",
  "createBenefitOverlap",
  "resolveBenefitOverlap",
  "createBenefitScenario",
  "updateBenefitScenario",
  "createBenefitScenarioValue",
  "updateBenefitScenarioValue",
  "createBenefitValuationMethod",
  "decideBenefitValuationMethod",
  "decideBenefitBaseline",
  "createBenefitPlanValue",
  "updateBenefitPlanValue",
  "createBenefitMeasurement",
  "updateBenefitMeasurement",
  "submitBenefitMeasurement",
  "decideFinanceValidation",
  "amendFinanceValidation",
  "reverseFinanceValidation",
];
const VALUE_METRICS = [
  "value.planned",
  "value.forecast",
  "value.measured",
  "value.submitted",
  "value.validated",
  "value.rejected",
  "value.sustained",
];

const t = responseTranscript(call, "MTH_KBE_R5_TRANSCRIPT");
let api: TestApi;
let w: World;
let x: BenefitWorld;
let g: BenefitWorld;
let c: BenefitWorld;
let auditor: Session;
let cBenefit: string;
let cValue: { measurementId: string; validationId: string; validationVersion: number };
const params = new Map<string, string>();

async function get(url: string, session: Session = auditor) {
  const r = await call<Body>(api.app, "GET", url, { session });
  t.note(`GET ${url}`, { status: r.status, headers: r.headers, body: r.body });
  return r;
}
async function send(label: string, method: string, url: string, session: Session, headers: Record<string, string>, body: unknown) {
  const r = await call<Body>(api.app, method, url, { session, headers, body });
  t.note(`${label} ${method} ${url}`, { status: r.status, headers: r.headers, body: r.body });
  return r;
}
async function validated(b: BenefitWorld, id: string, amount: string, start: string, end: string) {
  await approve(api, b, await submittedValue(api, b, id, amount, { periodStart: start, periodEnd: end }), amount);
}
async function identified(b: BenefitWorld, body: Record<string, unknown>): Promise<Body> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return r.body;
}
async function created(url: string, session: Session, body: unknown): Promise<Body> {
  const r = await call<Body>(api.app, "POST", url, { session, body });
  if (r.status !== 201) throw new Error(`${url} ${JSON.stringify(r.body)}`);
  return r.body;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  // X: all five financial classes in SAR, USD revenue, an overlap hold, a valued CX benefit.
  x = await benefitWorldIn(api, w, w.a1);
  const a = await measuredBenefit(api, x);
  await planValue(api, x, a.id, "1000", "2026-02-01", "2026-02-28");
  await validated(x, a.id, "900", "2026-02-01", "2026-02-28");
  const m = await measuredBenefit(api, x, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, x, m.id, "70.05", "2026-02-01", "2026-02-28");
  await validated(x, m.id, "30.5", "2026-03-01", "2026-03-31");
  const window = { driverKey: "synthetic-r5-driver", realizationStart: "2026-01-01", realizationEnd: "2026-12-31" };
  const d = await measuredBenefit(api, x, { extra: { valueClass: "avoided_cost", ...cost, ...window } });
  await planValue(api, x, d.id, "400", "2026-02-01", "2026-02-28");
  await validated(x, d.id, "350", "2026-02-01", "2026-02-28");
  const d2 = await identified(x, financialBody(x, { valueClass: "cash_saving", ...cost, ...window }));
  await planValue(api, x, d2.id, "5", "2026-02-01", "2026-02-28");
  const wc = await identified(x, financialBody(x, { benefitType: "working_capital", valueClass: "working_capital_release", financialStatementLine: "Working capital - inventory" }));
  await planValue(api, x, wc.id, "2.5", "2026-02-01", "2026-02-28");
  const method = await created(`${x.base}/benefit-valuation-methods`, x.s.bo, {
    name: "Synthetic NPS point value",
    method: "Each NPS point is valued at the synthetic retention value per point.",
    appliesToType: "cx",
    kpiDefinitionId: x.kpiDefinitionId,
    unitValue: "125000",
    currency: "SAR",
  });
  await call(api.app, "POST", `${x.base}/benefit-valuation-methods/${method.id}/decision`, {
    session: x.s.fin,
    headers: ifm(1),
    body: { decision: "approved", note: "Synthetic approval" },
  });
  const e = await identified(x, cxBody(x, { valuationMethodId: method.id }));
  await planValue(api, x, e.id, "125000", "2026-02-01", "2026-02-28");
  const u = await identified(x, financialBody(x, { currency: "USD" }));
  await planValue(api, x, u.id, "2000", "2026-02-01", "2026-02-28");
  // G: only the gross classes (margin, cash saving, working capital): its figures must not change.
  g = await benefitWorldIn(api, w, w.a2);
  const gm = await measuredBenefit(api, g, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, g, gm.id, "100", "2026-02-01", "2026-02-28");
  await validated(g, gm.id, "40", "2026-02-01", "2026-02-28");
  const gc = await identified(g, financialBody(g, { valueClass: "cash_saving", ...cost }));
  await planValue(api, g, gc.id, "10", "2026-02-01", "2026-02-28");
  const gw = await identified(g, financialBody(g, { benefitType: "working_capital", valueClass: "working_capital_release", financialStatementLine: "Working capital - inventory" }));
  await planValue(api, g, gw.id, "3", "2026-02-01", "2026-02-28");
  // C: the correction chain and the refused mutations.
  c = await benefitWorldIn(api, w, w.a1);
  const cb = await measuredBenefit(api, c);
  cBenefit = cb.id;
  cValue = await submittedValue(api, c, cb.id, "1000", { periodStart: "2026-02-01", periodEnd: "2026-02-28" });
  const queued = await submittedValue(api, c, cb.id, "50", { periodStart: "2026-03-01", periodEnd: "2026-03-31" });
  const initiativeId = await insertInitiative(api.db, c);
  const enabler = await created(`${c.base}/benefits/${cb.id}/enablers`, c.s.bo, { initiativeId });
  const pv = await created(`${c.base}/benefits/${cb.id}/plan-values`, c.s.bo, {
    valueKind: "planned",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amount: "1000",
  });
  const group = await created(`${c.base}/benefit-groups`, c.s.tl, { title: "Synthetic group" });
  const scenario = await created(`${c.base}/benefit-scenarios`, c.s.tl, { kind: "base", title: "Synthetic base" });
  const sv = await created(`${c.base}/benefit-scenarios/${scenario.id}/values`, c.s.tl, {
    benefitId: cb.id,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amount: "500",
  });
  const cm = await created(`${c.base}/benefit-valuation-methods`, c.s.bo, {
    name: "Synthetic NPS point value",
    method: "Each NPS point is valued at a synthetic retention value per point.",
    appliesToType: "cx",
    kpiDefinitionId: c.kpiDefinitionId,
    unitValue: "125000",
    currency: "SAR",
  });
  for (const [k, v] of [
    ["transformationId", c.transformationId],
    ["benefitId", cb.id],
    ["benefitEnablerId", enabler.id],
    ["benefitPlanValueId", pv.id],
    ["benefitGroupId", group.id],
    ["benefitOverlapId", "01920000-0000-7000-8000-00000000f001"],
    ["benefitScenarioId", scenario.id],
    ["benefitScenarioValueId", sv.id],
    ["benefitValuationMethodId", cm.id],
    ["benefitMeasurementId", queued.measurementId],
    ["financeValidationId", queued.validationId],
  ] as const)
    params.set(k, v);
  auditor = c.s.auditor;
}, 300_000);
afterAll(async () => {
  t.flush();
  await api.close();
});

it("records the transcript", async () => {
  const org = w.orgA.id;
  for (const b of [x, g]) await get(`${b.base}/benefit-totals`);
  await get(`/api/v1/organizations/${org}/benefit-totals`);
  for (const b of [x, g]) await get(`/api/v1/dashboards/finance?organizationId=${org}&transformationId=${b.transformationId}`);
  await get(`/api/v1/dashboards/finance?organizationId=${org}`);
  await get(`/api/v1/overview?organizationId=${org}`);
  for (const b of [x, g]) await get(`${b.base}/dashboard`);
  for (const scope of [`&transformationId=${x.transformationId}`, `&transformationId=${g.transformationId}`, ""])
    for (const metric of VALUE_METRICS)
      for (const cls of [null, ...FINANCE_VALUE_CLASSES])
        await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${org}${scope}${cls ? `&valueClass=${cls}` : ""}`);

  // The correction chain: each correction names the ETag a GET of the original just returned.
  const FV = `${c.base}/finance-validations/${cValue.validationId}`;
  await approve(api, c, cValue, "1000");
  const etag = async () => String((await get(FV)).headers.etag).replace(/"/g, "");
  await send("amend", "POST", `${FV}/amendments`, c.s.fin, ifm(await etag()), {
    correctedAmount: "900",
    reason: "Synthetic: a double count",
  });
  await send("reverse", "POST", `${FV}/reversals`, c.s.fin, ifm(await etag()), { reason: "Synthetic: withdrawn" });
  await get(FV);
  await get(`${c.base}/finance-validations`);
  await get(`${c.base}/benefits/${cBenefit}/values`);
  await get(`${c.base}/benefits/${cBenefit}/measurements`);
  await get(`${c.base}/benefit-totals`);

  // Every slice B mutation refused for AUD and for the ADM-only user (the 403 bodies).
  const byId = new Map(operations.map((o) => [o.operationId, o]));
  for (const [who, session] of [
    ["AUD", c.s.auditor],
    ["ADM", c.s.admin],
  ] as const)
    for (const id of SLICE_B_MUTATIONS) {
      const op = byId.get(id)!;
      const url = op.path.replace(/\{(\w+)\}/g, (_m, name: string) => params.get(name)!);
      await send(`${who} ${id}`, op.method, url, session, ifm(1), id === "decideFinanceValidation" ? { decision: "approved", items: ALL_ACCEPTED, approvedAmount: "50" } : {});
    }
});
