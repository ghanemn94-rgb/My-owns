// code-security-reviewer DG4 ROUND-4 probe GX (T-DG4-REV-SEC-R4): verifies the F-DG4-105 repair (ADR-0037 amendment N4
// item 3, the `currency` query parameter of the value drill-downs) adversarially, and probes the parameter's input
// handling and scope. NOT product code; runs only in a disposable clone, copied to apps/api/test/integration/zz-sec-dg4/.
// All data synthetic; a Finance approval here is a synthetic in-product approval of test data that approves nothing real.
// World: T1 (org A): SAR margin_uplift planned 70 (Finance-validated 30), USD revenue_uplift planned 11 (no USD
// profit-and-cash benefit). T2 (org A, other TL): USD margin_uplift planned 5000, SAR margin_uplift 7000, EUR cash_saving 900.
// Callers: AUD (org read), TL1 (T1 only), ADM-only (org A admin), OUT (org B office).
import { Decimal } from "decimal.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { financialBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { areaOf, benefitWorldIn, planValue } from "../contract/p4-exercises-kbe-g.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let b1: BenefitWorld;
let b2: BenefitWorld;
let aud: Session;
let tl1: Session;
let adm: Session;
let out: Session;
const t2Ids: string[] = [];
const H1 = ["2026-01-01", "2026-06-30"] as const;
const VALUE_STATE = ["value.planned", "value.forecast", "value.submitted", "value.validated", "value.measured", "value.rejected", "value.sustained"];
const CURRENCY_OK = [...VALUE_STATE, "value.gap", "value.investment"];
const OTHER = ["outcomes.kpi_status", "outcomes.area", "portfolio.initiatives", "dependencies.open", "decisions.open", "decisions.overdue", "adoption.indicators", "finance.pending_validation"];

async function mk(b: BenefitWorld, extra: Record<string, unknown>): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: financialBody(b, extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b1 = await benefitWorldIn(api, w, w.a1);
  b2 = await benefitWorldIn(api, w, w.a1);
  const m = await measuredBenefit(api, b1, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, b1, m.id, "70", ...H1);
  await approve(api, b1, await submittedValue(api, b1, m.id, "30", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "30");
  await planValue(api, b1, await mk(b1, { valueClass: "revenue_uplift", benefitType: "revenue", currency: "USD" }), "11", ...H1);
  for (const [vc, cur, amt, extra] of [
    ["margin_uplift", "USD", "5000", { benefitType: "revenue" }],
    ["margin_uplift", "SAR", "7000", { benefitType: "revenue" }],
    ["cash_saving", "EUR", "900", { benefitType: "cost", financialStatementLine: "Opex - care" }],
  ] as const) {
    const id = await mk(b2, { valueClass: vc, currency: cur, ...extra });
    t2Ids.push(id);
    await planValue(api, b2, id, amt, ...H1);
  }
  t2Ids.push(b2.transformationId);
  aud = await signIn(api.app, w.auditor.subject);
  tl1 = b1.s.tl;
  adm = await signIn(api.app, w.admin.subject);
  out = await signIn(api.app, w.officeB.subject);
}, 600_000);
afterAll(() => api?.close());

const url = (metric: string, extra = "", tids: string[] = []) =>
  `/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}${tids.map((t) => `&transformationId=${t}`).join("")}${extra}&limit=100`;
const leaked = (body: unknown) => t2Ids.filter((x) => JSON.stringify(body).includes(x));
const sum = (items: Body[]) => items.reduce((a, i) => (i.value?.value == null ? a : a.plus(new Decimal(i.value.value))), new Decimal(0)).toFixed();

describe("SEC-DG4-R4 probe GX: F-DG4-105 (currency-exact value drill-downs)", () => {
  it("F-DG4-105 world: USD P&C headline and USD gross line drill to USD n/a with no item; SAR to SAR 70", async () => {
    const q = `organizationId=${w.orgA.id}&transformationId=${b1.transformationId}`;
    const fin = (await call<Body>(api.app, "GET", `/api/v1/dashboards/finance?${q}`, { session: aud })).body;
    const t10 = (await call<Body>(api.app, "GET", `${b1.base}/dashboard`, { session: aud })).body;
    const head = (await call<Body>(api.app, "GET", `${b1.base}/summary`, { session: aud })).body;
    const res: Record<string, Body> = {};
    for (const cur of ["SAR", "USD"]) {
      const gross = fin.lines.find((l: Body) => l.valueClass === "gross" && l.state === "planned" && l.currency === cur);
      const hT10 = areaOf(t10, "value").headlines.find((h: Body) => h.metric === "value.planned" && h.headlineBasis === "profit_and_cash" && h.value.currency === cur);
      const hFin = fin.headlines.find((h: Body) => h.metric === "value.planned" && h.headlineBasis === "profit_and_cash" && h.value.currency === cur);
      const gd = (await call<Body>(api.app, "GET", gross.drilldownHref, { session: aud })).body;
      const hd = (await call<Body>(api.app, "GET", hT10.drilldownHref, { session: aud })).body;
      res[cur] = { grossHref: gross.drilldownHref, t10Href: hT10.drilldownHref, finHref: hFin?.drilldownHref, gross: gross.total, headline: hT10.value, grossDrill: { value: gd.value, currency: gd.currency, items: gd.items.map((i: Body) => [i.code, i.value?.value, i.value?.currency]) }, headDrill: { value: hd.value, currency: hd.currency, items: hd.items.length } };
      expect(gross.drilldownHref).toContain(`currency=${cur}`);
      expect(hT10.drilldownHref).toContain(`currency=${cur}`);
      if (hFin) expect(hFin.drilldownHref).toContain(`currency=${cur}`);
      expect(gd.currency).toBe(cur);
      expect(hd.currency).toBe(cur);
    }
    // every value headline href (T10 value area, header, Finance) names its currency
    const hrefs: string[] = [];
    for (const h of areaOf(t10, "value").headlines) hrefs.push(`${h.metric}|${h.value.currency}|${h.drilldownHref}`);
    for (const h of head.benefits.headlines) hrefs.push(`${h.metric}|${h.value.currency}|${h.drilldownHref}`);
    for (const h of fin.headlines) if (String(h.metric).startsWith("value.")) hrefs.push(`${h.metric}|${h.value.currency}|${h.drilldownHref}`);
    for (const l of fin.lines) hrefs.push(`line:${l.valueClass}:${l.state}|${l.currency}|${l.drilldownHref ?? "null"}`);
    const missing = hrefs.filter((s) => { const [, cur, href] = s.split("|"); return href !== "null" && cur !== "null" && cur !== "undefined" && !href!.includes(`currency=${cur}`); });
    console.log(`[probe-GX F105] ${JSON.stringify(res, null, 1)}\n[probe-GX hrefs] n=${hrefs.length} missingCurrency=${JSON.stringify(missing)}`);
    expect(missing).toEqual([]);
    expect(res.USD.headline.state).toBe("not_applicable");
    expect(res.USD.headDrill.value.state).toBe("not_applicable");
    expect(res.USD.headDrill.value.currency).toBe("USD");
    expect(res.USD.headDrill.items).toBe(0);
    expect(res.USD.grossDrill.value.state).toBe("not_applicable");
    expect(res.USD.grossDrill.items).toEqual([]);
    expect(res.SAR.grossDrill.value).toMatchObject({ state: "value", value: "70", currency: "SAR" });
    expect(res.SAR.grossDrill.items).toEqual([[expect.anything(), "70", "SAR"]]);
  });

  it("re-runs the round-3 REPRO URL (no currency): no longer answers SAR 70 for the scope of two value currencies", async () => {
    const d = (await call<Body>(api.app, "GET", url("value.planned", "", [b1.transformationId]), { session: aud })).body;
    console.log(`[probe-GX nocur] ${JSON.stringify({ value: d.value, currency: d.currency, items: d.items.map((i: Body) => [i.code, i.value?.value, i.value?.currency]) })}`);
    expect(d.value).toMatchObject({ state: "not_applicable", reasonKey: "dashboard.value.multiple_currencies" });
    expect(d.currency).toBeNull();
  });

  it("every Finance line and T10 value headline: sum(items) per its currency equals the figure (all pages)", async () => {
    const q = `organizationId=${w.orgA.id}&transformationId=${b1.transformationId}`;
    const fin = (await call<Body>(api.app, "GET", `/api/v1/dashboards/finance?${q}`, { session: aud })).body;
    const t10 = (await call<Body>(api.app, "GET", `${b1.base}/dashboard`, { session: aud })).body;
    const figs: [string, Body, string][] = [];
    for (const l of fin.lines) if (l.drilldownHref) figs.push([`line ${l.valueClass} ${l.state} ${l.currency}`, l.total, l.drilldownHref]);
    for (const h of areaOf(t10, "value").headlines) if (h.metric !== "value.gap") figs.push([`t10 ${h.metric} ${h.headlineBasis} ${h.value.currency}`, h.value, h.drilldownHref]);
    const bad: string[] = [];
    for (const [name, v, href] of figs) {
      const d = (await call<Body>(api.app, "GET", href, { session: aud })).body;
      const otherCur = d.items.filter((i: Body) => i.value?.currency && i.value.currency !== v.currency);
      const s = sum(d.items);
      const line = `${name}: fig=${JSON.stringify(v)} drill=${JSON.stringify(d.value)} sum=${s} n=${d.items.length} otherCur=${otherCur.length}`;
      console.log(`[probe-GX sum] ${line}`);
      if (otherCur.length > 0) bad.push(line);
      if ((v.state === "value" || v.state === "zero") && new Decimal(v.value).toFixed() !== s) bad.push(line);
      if (v.state === "not_applicable" && d.items.length !== 0) bad.push(line);
    }
    expect(bad).toEqual([]);
  });
});

describe("SEC-DG4-R4 probe GX: currency input handling", () => {
  const badFormats = ["usd", "Usd", "US", "USDD", "", "U5D", "%20USD", "SAR%00", "S%C3%84R", "SAR,USD"];
  it.each(badFormats)("currency=%j -> 400 (not ISO 4217 upper-case three letters)", async (c) => {
    const r = await call<Body>(api.app, "GET", url("value.planned", `&currency=${c}`), { session: aud, contract: false });
    console.log(`[probe-GX fmt] ${JSON.stringify(c)} -> ${r.status} ${r.body?.code ?? ""} ${JSON.stringify(r.body?.errors ?? r.body?.params ?? null)}`);
    expect(r.status).toBe(400);
  });
  it("repeated currency (array) -> 400", async () => {
    const r = await call<Body>(api.app, "GET", url("value.planned", `&currency=SAR&currency=USD`), { session: aud, contract: false });
    console.log(`[probe-GX array] -> ${r.status} ${r.body?.code ?? ""}`);
    expect(r.status).toBe(400);
  });
  it.each(CURRENCY_OK)("%s with an unknown but well-formed code XYZ: 200, no item, nothing summed", async (metric) => {
    const r = await call<Body>(api.app, "GET", url(metric, `&currency=XYZ`), { session: aud });
    console.log(`[probe-GX XYZ] ${metric} -> ${r.status} value=${JSON.stringify(r.body.value)} currency=${r.body.currency} items=${r.body.items.length}`);
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    expect(r.body.currency).toBe("XYZ");
    expect(["not_applicable", "zero"]).toContain(r.body.value.state);
  });
  it.each(OTHER)("%s with currency=SAR -> 422 dashboard.currency_not_applicable", async (metric) => {
    const r = await call<Body>(api.app, "GET", url(metric, `&currency=SAR`), { session: aud });
    console.log(`[probe-GX 422] ${metric} -> ${r.status} ${r.body?.code ?? ""} ${JSON.stringify(r.body?.params ?? null)} ${r.body?.pointer ?? JSON.stringify(r.body?.errors ?? "")}`);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("dashboard.currency_not_applicable");
  });
  it("a cursor issued without currency is refused with currency (hash-bound), and vice versa", async () => {
    // a page of 1 so that a cursor is issued
    const a = (await call<Body>(api.app, "GET", url("value.planned", "", []).replace("limit=100", "limit=1"), { session: aud })).body;
    const c = (await call<Body>(api.app, "GET", url("value.planned", "&currency=SAR", []).replace("limit=100", "limit=1"), { session: aud })).body;
    const r1 = a.nextCursor ? await call<Body>(api.app, "GET", url("value.planned", `&currency=SAR&cursor=${encodeURIComponent(a.nextCursor)}`).replace("limit=100", "limit=1"), { session: aud, contract: false }) : null;
    const r2 = c.nextCursor ? await call<Body>(api.app, "GET", url("value.planned", `&cursor=${encodeURIComponent(c.nextCursor)}`).replace("limit=100", "limit=1"), { session: aud, contract: false }) : null;
    console.log(`[probe-GX cursor] a.next=${!!a.nextCursor} c.next=${!!c.nextCursor} r1=${r1?.status} ${r1?.body?.code ?? ""} r2=${r2?.status} ${r2?.body?.code ?? ""}`);
    expect(a.nextCursor).toBeTruthy();
    expect(c.nextCursor).toBeTruthy();
    expect(r1!.status).toBe(400);
    expect(r2!.status).toBe(400);
  });
});

describe("SEC-DG4-R4 probe GX: currency never widens scope", () => {
  const cases = CURRENCY_OK.flatMap((m) => ["SAR", "USD", "EUR"].flatMap((c) => [undefined, "margin_uplift", "revenue_uplift", "cash_saving", "avoided_cost"].map((vc) => [m, c, vc ?? "-"] as const)))
    .filter(([m, , vc]) => vc === "-" || VALUE_STATE.includes(m) || (m === "value.gap" && (vc === "revenue_uplift" || vc === "avoided_cost")));
  it.each(cases)("TL1 %s currency=%s valueClass=%s: T1 only (== AUD on T1); T2 or T1+T2 -> 404; nothing of T2", async (metric, cur, vc) => {
    const extra = `${vc === "-" ? "" : `&valueClass=${vc}`}&currency=${cur}`;
    const ref = await call<Body>(api.app, "GET", url(metric, extra, [b1.transformationId]), { session: aud });
    for (const [label, tids] of [["none", []], ["T1", [b1.transformationId]], ["T2", [b2.transformationId]], ["T1+T2", [b1.transformationId, b2.transformationId]]] as const) {
      const r = await call<Body>(api.app, "GET", url(metric, extra, [...tids]), { session: tl1, contract: false });
      const l = leaked(r.body);
      console.log(`[probe-GX TL1] ${metric} cur=${cur} vc=${vc} filter=${label} -> ${r.status} ${r.body?.code ?? ""} value=${JSON.stringify(r.body?.value ?? null)} items=${r.body?.items?.length ?? "-"} leaked=${l.length}`);
      expect(l).toEqual([]);
      if (label === "T2" || label === "T1+T2") expect(r.status).toBe(404);
      else {
        expect(r.status).toBe(ref.status);
        if (r.status === 200) expect({ v: r.body.value, i: r.body.items, c: r.body.calculation }).toEqual({ v: ref.body.value, i: ref.body.items, c: ref.body.calculation });
      }
    }
    for (const [who, s] of [["ADM", adm], ["OUT", out]] as const) {
      const r = await call<Body>(api.app, "GET", url(metric, extra, []), { session: s, contract: false });
      const r1 = await call<Body>(api.app, "GET", url(metric, extra, [b1.transformationId]), { session: s, contract: false });
      const l = [...leaked(r.body), ...leaked(r1.body), ...[b1.transformationId].filter((x) => JSON.stringify([r.body, r1.body]).includes(x))];
      console.log(`[probe-GX ${who}] ${metric} cur=${cur} vc=${vc} -> ${r.status} ${r.body?.code ?? ""} / T1 ${r1.status} leaked=${l.length}`);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r1.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
      expect(l).toEqual([]);
    }
  });
  it("TL1 subjectId = a T2 benefit with currency: never 200, nothing disclosed", async () => {
    const seen: string[] = [];
    for (const m of VALUE_STATE) for (const sid of t2Ids.slice(0, 3)) for (const cur of ["USD", "SAR", "EUR"]) {
      const r = await call<Body>(api.app, "GET", url(m, `&subjectId=${sid}&currency=${cur}`), { session: tl1, contract: false });
      seen.push(`${m}/${cur}:${r.status}`);
      expect(r.status).not.toBe(200);
      expect(r.status).toBeLessThan(500);
      expect(leaked(r.body)).toEqual([]);
    }
    console.log(`[probe-GX SUBJ] ${[...new Set(seen.map((s) => s.split(":")[1]))].join(",")} n=${seen.length}`);
  });
  it("control: AUD without a filter, currency=USD, sees T2's USD 5000 (the probe can detect a leak)", async () => {
    const r = (await call<Body>(api.app, "GET", url("value.planned", "&currency=USD"), { session: aud })).body;
    console.log(`[probe-GX control] ${JSON.stringify(r.value)} items=${r.items.length}`);
    expect(r.value).toMatchObject({ state: "value", value: "5000", currency: "USD" });
    expect(leaked(r).length).toBeGreaterThan(0);
  });
});
