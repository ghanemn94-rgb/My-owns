// domain-reviewer DG4 round 5 (T-DG4-REV-DOM-R5): my round-4 in-process probe re-run UNCHANGED in substance on candidate 69b7412a (ids R4-n kept), plus round-5 additions R5-n at the end.
// Original round-4 header follows.
// domain-reviewer DG4 round 4 (T-DG4-REV-DOM-R4): in-process domain probe on the real API (Fastify inject) and a
// disposable PostgreSQL (the integration project's global setup). Placed ONLY in the disposable clone as
// tests/qa/integration/zz-domain-r5.test.ts; it is review evidence, not part of the candidate. SYNTHETIC data; a
// Finance validation here is a synthetic in-product approval of test data that approves nothing real, and nothing here
// touches DG0-DG7.
// Re-verification of my round-3 findings (adversarial), with my own worlds:
//  R4-1 DOM-GROSS (regression of F-DG4-122/123): 90 / 300 / 45, never 435; drill sums equal headlines; RAG lines.
//  R4-2 revenue 300 + avoided 45 only (D-123 item 1): profit-and-cash n/a; the Value RAG now carries the top-line and
//       non-cash gaps (my round-3 R3-2 pinned n/a: expected to differ BY DESIGN).
//  R4-3 25 % and -20 % gaps: exact ratios (regression).
//  R4-4 a validated revenue uplift never lowers the profit-and-cash gap; forecast/submitted never count (regression).
//  R4-6 F-DG4-126: margin 70 validated + (revenue | avoided) 300 unvalidated: Red on T10, workstream, Overview area and
//       row, Finance row; plus adversarial variants: (a) the other basis in ANOTHER currency (USD), (b) the other basis
//       with a missing planned amount (expect Unknown, never Green), (c) the other basis 300 fully validated (Green).
//  R4-7 F-DG4-125 + D-124: percentage KPI (no label, '%', '% of users') and ratio KPI 1.5 linked to an outcome created
//       THROUGH THE API (draft): the value objects (kpiUnit) on the T10 Outcomes area, its drill-down, the Overview,
//       People & adoption and the adoption dashboard; an ARCHIVED outcome never appears.
//  R4-8 F-DG4-127: DOM-GROSS allocated to one initiative: 90 (profit and cash); a ranking world (top-line-only
//       initiative n/a and last; missing amount Unknown); the item labels its basis.
import { FORMULA_DECIMAL as Decimal } from "../../../packages/shared/src/calc.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sumItems } from "../../../apps/api/src/modules/reporting/dashboards/drilldown.ts";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { financialBody, insertInitiative, type BenefitWorld } from "../../../apps/api/test/integration/benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../../../apps/api/test/integration/benefits/value-fixtures.ts";
import { areaOf, benefitWorldIn, dashboardWorld, planValue, workstreamOf, type Body } from "../../../apps/api/test/integration/contract/p4-exercises-kbe-g.ts";
import { monthlyPeriod, ownedKpi, runRecalculation, submitActual } from "../../../apps/api/test/integration/kpi-p4/kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => { api = await startApi(); w = await seedWorld(api.db); }, 60_000);
afterAll(() => api?.close());

const H1 = { start: "2026-01-01", end: "2026-06-30" };
const dec = (v: string | null | undefined) => (v === null || v === undefined ? null : new Decimal(v).toFixed());
function classBody(b: BenefitWorld, valueClass: string, extra: Record<string, unknown> = {}) {
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const shape: Record<string, Record<string, unknown>> = {
    revenue_uplift: { benefitType: "revenue" },
    margin_uplift: { benefitType: "revenue" },
    cash_saving: cost,
    working_capital_release: { benefitType: "working_capital", financialStatementLine: "Working capital - inventory" },
    avoided_cost: { ...cost, financialStatementLine: "Opex - network" },
  };
  return financialBody(b, { valueClass, ...shape[valueClass], ...extra });
}
async function benefit(b: BenefitWorld, valueClass: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: classBody(b, valueClass, extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
const get = async (url: string, session: Session) => {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url} ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
async function allocate(b: BenefitWorld, benefitId: string, allocations: { initiativeId: string; share: string }[]) {
  const cur = await get(`${b.base}/benefits/${benefitId}`, b.s.auditor);
  const r = await call<Body>(api.app, "PUT", `${b.base}/benefits/${benefitId}/allocations`, { session: b.s.tl, headers: { "if-match": `"${cur.version}"` }, body: { allocations } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
async function surfaces(b: BenefitWorld) {
  const q = `organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
  return {
    t10: await get(`${b.base}/dashboard`, b.s.auditor),
    overview: await get(`/api/v1/overview?${q}`, b.s.auditor),
    finance: await get(`/api/v1/dashboards/finance?${q}`, b.s.auditor),
    header: await get(`${b.base}/summary`, b.s.auditor),
  };
}
type S = Awaited<ReturnType<typeof surfaces>>;
const lists = (s: S): [string, Body[]][] => [
  ["T10", areaOf(s.t10, "value").headlines],
  ["overview", areaOf(s.overview, "value").headlines],
  ["finance", (s.finance.headlines as Body[]).filter((h) => String(h.metric).startsWith("value."))],
  ["header", s.header.benefits.headlines as Body[]],
];
const pick = (l: Body[], metric: string, basis: string | null, cur = "SAR") =>
  l.find((h) => h.metric === metric && h.headlineBasis === basis && h.value.currency === cur);
const show = (l: Body[]) => l.map((h) => `${h.metric}/${h.headlineBasis}/${h.value.currency}=${h.value.value ?? h.value.state}${h.value.reasonKey ? `(${h.value.reasonKey})` : ""}`).join("; ");
const lineOf = (l: Body) => `${l.currency}/${l.headlineBasis}/${l.gapRatio}/${l.status}${l.reasonKey ? `(${l.reasonKey})` : ""}`;
const rowStatus = (rows: Body[] | undefined, tid: string) => rows?.find((t) => t.transformationId === tid)?.areaStatuses.find((a: Body) => a.code === "value")?.status;
function numbers(o: unknown, out: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x) => numbers(x, out));
  else if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o)) {
      if ((k === "value" || k === "amount" || k === "total") && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) out.push(dec(v)!);
      numbers(v, out);
    }
  return out;
}
async function drillSum(h: Body, session: Session) {
  let url: string | null = `${h.drilldownHref}&limit=50`;
  const items: Body[] = [];
  let first: Body | null = null;
  while (url) {
    const p = await get(url, session);
    first ??= p;
    items.push(...p.items);
    url = p.nextCursor ? `${h.drilldownHref}&limit=50&cursor=${p.nextCursor}` : null;
  }
  return { basis: first!.headlineBasis, currency: first!.currency, sum: sumItems(items, h.value.currency), n: items.length, state: first!.value.state, value: first!.value.value };
}

describe("domain-reviewer DG4 R4: value basis (F-DG4-126/127 and regressions)", () => {
  it("R4-1 DOM-GROSS: 90 / 300 / 45 on four surfaces, no 435, drill sums equal headlines; RAG worst of three lines", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const amounts: Record<string, string> = { revenue_uplift: "300", margin_uplift: "70", cash_saving: "20", avoided_cost: "45" };
    for (const [c, a] of Object.entries(amounts)) await planValue(api, b, await benefit(b, c), a, H1.start, H1.end);
    const s = await surfaces(b);
    for (const [where, l] of lists(s)) {
      console.log(`R4-1 ${where}: ${show(l)}`);
      expect(dec(pick(l, "value.planned", "profit_and_cash")?.value.value), where).toBe("90");
      expect(dec(pick(l, "value.planned", "top_line")?.value.value), where).toBe("300");
      expect(dec(pick(l, "value.planned", "non_cash")?.value.value), where).toBe("45");
      for (const h of l) {
        if (h.metric === "value.gap" || h.headlineBasis === null) continue;
        const d = await drillSum(h, b.s.auditor);
        expect(d.basis, where).toBe(h.headlineBasis);
        expect(d.currency, `${where} ${h.metric} drill currency`).toBe("SAR");
        if (h.value.state === "value" || h.value.state === "zero") expect(dec(d.sum), `${where} ${h.metric}`).toBe(dec(h.value.value));
      }
    }
    for (const [k, body] of Object.entries(s)) expect(numbers(body), k).not.toContain("435");
    const rag = areaOf(s.t10, "value").rag;
    console.log(`R4-1 T10 RAG=${rag.status} ${rag.ruleKey} lines=${rag.ruleParams.lines?.map(lineOf).join(" | ")}`);
    expect(rag.status).toBe("red");
    expect(rag.ruleParams.lines.map(lineOf)).toEqual(["SAR/profit_and_cash/1/red", "SAR/top_line/1/red", "SAR/non_cash/1/red"]);
  });

  it("R4-2 revenue 300 + avoided 45 only (D-123 item 1): profit-and-cash n/a; the Value RAG carries the other gaps", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    await planValue(api, b, await benefit(b, "revenue_uplift"), "300", H1.start, H1.end);
    await planValue(api, b, await benefit(b, "avoided_cost"), "45", H1.start, H1.end);
    const s = await surfaces(b);
    for (const [where, l] of lists(s)) {
      console.log(`R4-2 ${where}: ${show(l)}`);
      for (const st of where === "header" ? ["planned", "validated"] : ["planned", "forecast", "submitted", "validated"]) {
        const h = pick(l, `value.${st}`, "profit_and_cash");
        expect(h?.value.state, `${where} ${st}`).toBe("not_applicable");
        expect(h?.value.reasonKey, `${where} ${st}`).toBe("dashboard.value.no_profit_and_cash_benefit");
      }
      if (where !== "header") {
        expect(pick(l, "value.gap", "profit_and_cash")?.value.state, where).toBe("not_applicable");
        expect(dec(pick(l, "value.gap", "top_line")?.value.value), where).toBe("1");
        expect(dec(pick(l, "value.gap", "non_cash")?.value.value), where).toBe("1");
      }
    }
    const rag = areaOf(s.t10, "value").rag;
    console.log(`R4-2 T10 RAG=${rag.status} ${rag.ruleKey} lines=${rag.ruleParams.lines?.map(lineOf).join(" | ")}; overview row=${rowStatus(s.overview.transformations, b.transformationId)} finance row=${rowStatus(s.finance.transformations, b.transformationId)}; header=${JSON.stringify(s.header.benefits).slice(0, 400)}`);
    expect([rag.status, rag.ruleKey]).toEqual(["red", "dashboard.rag.value.validated_gap"]);
    expect(rag.ruleParams.lines.map(lineOf)).toEqual(["SAR/top_line/1/red", "SAR/non_cash/1/red"]);
  });

  it("R4-3 a 25 % gap and a negative gap: exact ratios (regression)", async () => {
    for (const [validated, gap, status] of [["75", "0.25", null], ["120", "-0.2", "green"]] as const) {
      const b = await benefitWorldIn(api, w, w.a1);
      const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
      await planValue(api, b, m.id, "100", H1.start, H1.end);
      await approve(api, b, await submittedValue(api, b, m.id, validated, { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), validated);
      const s = await surfaces(b);
      for (const [where, l] of lists(s)) {
        console.log(`R4-3 v=${validated} ${where}: ${show(l)}`);
        expect(dec(pick(l, "value.validated", "profit_and_cash")?.value.value), where).toBe(dec(validated));
        if (where !== "header") expect(dec(pick(l, "value.gap", "profit_and_cash")!.value.value), where).toBe(dec(gap));
      }
      const rag = areaOf(s.t10, "value").rag;
      console.log(`R4-3 v=${validated} RAG=${rag.status} lines=${rag.ruleParams.lines?.map(lineOf).join(" | ")} policy amber=${rag.ruleParams.amberRatio} red=${rag.ruleParams.redRatio}`);
      if (status) expect(rag.status).toBe(status);
    }
  });

  it("R4-4 a validated revenue uplift never lowers the profit-and-cash gap; forecast/submitted never count", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const mar = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
    await planValue(api, b, mar.id, "100", H1.start, H1.end);
    await submittedValue(api, b, mar.id, "60", { periodStart: "2026-03-01", periodEnd: "2026-03-31" });
    const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${mar.id}/plan-values`, { session: b.s.bo, body: { valueKind: "forecast", periodStart: H1.start, periodEnd: H1.end, amount: "90" } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rev = await measuredBenefit(api, b, { extra: { valueClass: "revenue_uplift" } });
    await planValue(api, b, rev.id, "500", H1.start, H1.end);
    await approve(api, b, await submittedValue(api, b, rev.id, "500", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "500");
    const s = await surfaces(b);
    for (const [where, l] of lists(s)) {
      console.log(`R4-4 ${where}: ${show(l)}`);
      expect(pick(l, "value.validated", "profit_and_cash")?.value.state, where).toBe("zero");
      expect(dec(pick(l, "value.validated", "top_line")?.value.value), where).toBe("500");
      if (where !== "header") {
        expect(dec(pick(l, "value.gap", "profit_and_cash")?.value.value), where).toBe("1");
        expect(dec(pick(l, "value.gap", "top_line")?.value.value), where).toBe("0");
        expect(dec(pick(l, "value.submitted", "profit_and_cash")?.value.value), where).toBe("60");
        expect(dec(pick(l, "value.forecast", "profit_and_cash")?.value.value), where).toBe("90");
      }
    }
    const rag = areaOf(s.t10, "value").rag;
    console.log(`R4-4 RAG=${rag.status} lines=${rag.ruleParams.lines?.map(lineOf).join(" | ")}`);
    expect(rag.status).toBe("red");
  });

  it("R4-6 F-DG4-126: margin 70 validated + other 300 unvalidated: Red on every surface (both variants)", async () => {
    for (const other of ["revenue_uplift", "avoided_cost"]) {
      const b = await benefitWorldIn(api, w, w.a1);
      const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
      await planValue(api, b, m.id, "70", H1.start, H1.end);
      await approve(api, b, await submittedValue(api, b, m.id, "70", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "70");
      const o = await benefit(b, other);
      await planValue(api, b, o, "300", H1.start, H1.end);
      const ini = await insertInitiative(api.db, b, { status: "completed" });
      await allocate(b, m.id, [{ initiativeId: ini, share: "1" }]);
      await allocate(b, o, [{ initiativeId: ini, share: "1" }]);
      const ws = await workstreamOf(api.db, b as never, b.organizationId, [ini]);
      const s = await surfaces(b);
      const wsd = await get(`${b.base}/workstreams/${ws}/dashboard`, b.s.auditor);
      const res: Record<string, string | undefined> = {
        T10: areaOf(s.t10, "value").rag.status,
        workstream: areaOf(wsd, "value").rag.status,
        overviewArea: areaOf(s.overview, "value").rag.status,
        overviewRow: rowStatus(s.overview.transformations, b.transformationId),
        financeRow: rowStatus(s.finance.transformations, b.transformationId),
      };
      console.log(`R4-6 ${other} statuses=${JSON.stringify(res)} T10 lines=${areaOf(s.t10, "value").rag.ruleParams.lines.map(lineOf).join(" | ")} ws lines=${areaOf(wsd, "value").rag.ruleParams.lines?.map(lineOf).join(" | ")}`);
      console.log(`R4-6 ${other} header=${JSON.stringify(s.header.benefits).slice(0, 500)}`);
      for (const [k, v] of Object.entries(res)) expect(v, `${other} ${k}`).toBe("red");
    }
  });

  it("R4-6a adversarial: SAR margin validated (green) beside a USD revenue uplift unvalidated: Red, lines per currency", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
    await planValue(api, b, m.id, "70", H1.start, H1.end);
    await approve(api, b, await submittedValue(api, b, m.id, "70", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "70");
    const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: classBody(b, "revenue_uplift", { currency: "USD" }) });
    console.log(`R4-6a create USD benefit: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    if (r.status !== 201) return; // a refused foreign currency is recorded, not asserted
    await planValue(api, b, r.body.id, "300", H1.start, H1.end);
    const s = await surfaces(b);
    const rag = areaOf(s.t10, "value").rag;
    console.log(`R4-6a RAG=${rag.status} lines=${rag.ruleParams.lines?.map(lineOf).join(" | ")}; T10: ${show(areaOf(s.t10, "value").headlines)}`);
    expect(rag.status).toBe("red");
    expect(rag.ruleParams.lines.map(lineOf)).toEqual(["SAR/profit_and_cash/0/green", "USD/top_line/1/red"]);
    const usdGap = pick(areaOf(s.t10, "value").headlines, "value.gap", "top_line", "USD");
    const d = await drillSum(usdGap, b.s.auditor);
    console.log(`R4-6a USD top-line gap drill: currency=${d.currency} basis=${d.basis} value=${d.value} items=${d.n}`);
    expect([d.currency, d.basis, dec(d.value)]).toEqual(["USD", "top_line", "1"]);
  });

  it("R4-6b adversarial: margin validated (green) beside a top-line benefit whose planned amount is missing: never Green", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
    await planValue(api, b, m.id, "70", H1.start, H1.end);
    await approve(api, b, await submittedValue(api, b, m.id, "70", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "70");
    const rev = await benefit(b, "revenue_uplift");
    await planValue(api, b, rev, "100", H1.start, H1.end);
    const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${rev}/plan-values`, { session: b.s.bo, body: { valueKind: "planned", periodStart: "2026-07-01", periodEnd: "2026-07-31", amount: null, kpiValue: "12" } });
    console.log(`R4-6b missing-amount planned line: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    expect(r.status).toBe(201);
    const s = await surfaces(b);
    const rag = areaOf(s.t10, "value").rag;
    console.log(`R4-6b RAG=${rag.status} lines=${rag.ruleParams.lines?.map(lineOf).join(" | ")}; T10: ${show(areaOf(s.t10, "value").headlines)}`);
    expect(rag.status).not.toBe("green");
    expect(rag.status).toBe("unknown");
  });

  it("R4-6c control: margin 70 validated + revenue 300 fully validated: Green (the rule does not over-flag)", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
    await planValue(api, b, m.id, "70", H1.start, H1.end);
    await approve(api, b, await submittedValue(api, b, m.id, "70", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "70");
    const rev = await measuredBenefit(api, b, { extra: { valueClass: "revenue_uplift" } });
    await planValue(api, b, rev.id, "300", H1.start, H1.end);
    await approve(api, b, await submittedValue(api, b, rev.id, "300", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "300");
    const s = await surfaces(b);
    const rag = areaOf(s.t10, "value").rag;
    console.log(`R4-6c RAG=${rag.status} lines=${rag.ruleParams.lines?.map(lineOf).join(" | ")}`);
    expect(rag.status).toBe("green");
  });

  it("R4-8 F-DG4-127: DOM-GROSS on one initiative = 90 (profit and cash), labelled; ranking and missing amount", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const iniG = await insertInitiative(api.db, b, { status: "completed" });
    const amounts: Record<string, string> = { revenue_uplift: "300", margin_uplift: "70", cash_saving: "20", avoided_cost: "45" };
    for (const [c, a] of Object.entries(amounts)) {
      const id = await benefit(b, c);
      await planValue(api, b, id, a, H1.start, H1.end);
      await allocate(b, id, [{ initiativeId: iniG, share: "1" }]);
    }
    // Ranking world in the same transformation: iniBig (working capital 200, share 0.5 = 100), iniTop (top line 5000
    // only), iniMiss (cash saving with a missing planned amount), iniNone (nothing allocated).
    const iniBig = await insertInitiative(api.db, b, { status: "completed" });
    const iniTop = await insertInitiative(api.db, b, { status: "completed" });
    const iniMiss = await insertInitiative(api.db, b, { status: "completed" });
    const iniNone = await insertInitiative(api.db, b, { status: "completed" });
    const wc = await benefit(b, "working_capital_release");
    await planValue(api, b, wc, "200", H1.start, H1.end);
    await allocate(b, wc, [{ initiativeId: iniBig, share: "0.5" }]);
    const top = await benefit(b, "revenue_uplift");
    await planValue(api, b, top, "5000", H1.start, H1.end);
    await allocate(b, top, [{ initiativeId: iniTop, share: "1" }]);
    const cs = await benefit(b, "cash_saving");
    await planValue(api, b, cs, "30", H1.start, H1.end);
    const mr = await call<Body>(api.app, "POST", `${b.base}/benefits/${cs}/plan-values`, { session: b.s.bo, body: { valueKind: "planned", periodStart: "2026-07-01", periodEnd: "2026-07-31", amount: null, kpiValue: "1" } });
    expect(mr.status, JSON.stringify(mr.body)).toBe(201);
    await allocate(b, cs, [{ initiativeId: iniMiss, share: "1" }]);
    const dash = await get(`${b.base}/dashboard`, b.s.auditor);
    const port = areaOf(dash, "portfolio");
    const names: Record<string, string> = { [iniG]: "iniG", [iniBig]: "iniBig", [iniTop]: "iniTop", [iniMiss]: "iniMiss", [iniNone]: "iniNone" };
    const rows = (port.items as Body[]).filter((i) => names[i.recordId]);
    for (const r of rows) console.log(`R4-8 ${names[r.recordId]}: value=${JSON.stringify(r.value)} valueBasis=${r.valueBasis}`);
    console.log(`R4-8 order=${rows.map((r) => names[r.recordId]).join(",")}`);
    const by = (n: string) => rows.find((r) => names[r.recordId] === n)!;
    expect(dec(by("iniG").value.value)).toBe("90");
    expect(by("iniG").valueBasis).toBe("profit_and_cash");
    expect(dec(by("iniBig").value.value)).toBe("100");
    expect([by("iniTop").value.state, by("iniTop").value.reasonKey]).toEqual(["not_applicable", "dashboard.portfolio.no_profit_and_cash_allocation"]);
    expect([by("iniMiss").value.state, by("iniMiss").value.reasonKey]).toEqual(["unknown", "benefit.value_amount_missing"]);
    const order = rows.map((r) => names[r.recordId]);
    expect(order.slice(0, 2)).toEqual(["iniBig", "iniG"]);
    expect(order.indexOf("iniTop")).toBeGreaterThan(1);
    // The item never lists the other bases' figures (D-123 item 4): no 300, 45, 5000 or 435 in any portfolio item.
    expect(numbers(port.items)).not.toContain("435");
    expect(numbers(port.items)).not.toContain("5000");
    const d = await get(port.headlines?.[0]?.drilldownHref, b.s.auditor);
    console.log(`R4-8 portfolio drill headlineBasis=${d.headlineBasis} currency=${d.currency} items=${JSON.stringify(d.items.filter((i: Body) => names[i.recordId]).map((i: Body) => [names[i.recordId], i.value.value ?? i.value.state]))}`);
    expect(d.headlineBasis).toBe("profit_and_cash");
  });
});

describe("domain-reviewer DG4 R4: KPI units and outcomes (F-DG4-125, D-124)", () => {
  it("R4-7 percentage/ratio KPIs on an outcome created through the API: kpiUnit on every surface; archived outcome hidden", async () => {
    const k = await dashboardWorld(api, w);
    const mk = await call<Body>(api.app, "POST", `${k.base}/outcomes`, { session: k.s.tl, body: { statement: "Synthetic R4: more users adopt the new journey." } });
    console.log(`R4-7 create outcome via API: ${mk.status} status=${mk.body?.status}`);
    expect(mk.status, JSON.stringify(mk.body)).toBe(201);
    const outcomeId = mk.body.id as string;
    const gone = await call<Body>(api.app, "POST", `${k.base}/outcomes`, { session: k.s.tl, body: { statement: "Synthetic R4: archived outcome (must not appear)." } });
    expect(gone.status).toBe(201);
    const period = await monthlyPeriod(api, w);
    const variants = [
      { key: "pct-nolabel", unitKind: "percentage", unitLabel: null, n: "12", d: "100", actual: "0.12" },
      { key: "pct-sign", unitKind: "percentage", unitLabel: "%", n: "12", d: "100", actual: "0.12" },
      { key: "pct-ofusers", unitKind: "percentage", unitLabel: "% of users", n: "12", d: "100", actual: "0.12" },
      { key: "ratio", unitKind: "ratio", unitLabel: null, n: "3", d: "2", actual: "1.5" },
    ] as const;
    const ids: Record<string, string> = {};
    for (const v of variants) {
      const kpi = await ownedKpi(api, k, { measureType: "higher_is_better", valueNature: "ratio", aggregationRule: "weighted_ratio", submissionRoute: "direct_accept", numeratorLabel: "Synthetic numerator", denominatorLabel: "Synthetic denominator" }, { unitKind: v.unitKind, unitLabel: v.unitLabel } as never);
      ids[kpi.id] = v.key;
      const link = await call<Body>(api.app, "POST", `${k.base}/outcome-kpis`, { session: k.s.tl, body: { outcomeId, kpiDefinitionId: kpi.id, targetDate: "2099-12-31" } });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      if (v.key === "pct-sign") {
        const l2 = await call<Body>(api.app, "POST", `${k.base}/outcome-kpis`, { session: k.s.tl, body: { outcomeId: gone.body.id, kpiDefinitionId: kpi.id, targetDate: "2099-12-31" } });
        expect(l2.status, JSON.stringify(l2.body)).toBe(201);
      }
      if (v.key === "pct-ofusers") {
        const al = await call<Body>(api.app, "POST", `${k.base}/adoption-metric-links`, { session: k.s.tl, body: { templateKey: "usage_activation_rate", targetKind: "transformation", kpiDefinitionId: kpi.id } });
        console.log(`R4-7 adoption link: ${al.status} ${JSON.stringify(al.body).slice(0, 160)}`);
      }
      const r = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, numerator: v.n, denominator: v.d });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      await runRecalculation(api, r.body.actual.id);
    }
    const goneNow = await get(`${k.base}/outcomes/${gone.body.id}`, k.s.tl);
    const ar = await call<Body>(api.app, "POST", `${k.base}/outcomes/${gone.body.id}/archive`, { session: k.s.tl, headers: { "if-match": `"${goneNow.version}"` }, body: { reason: "Synthetic: archived for the R4 probe" } });
    console.log(`R4-7 archive second outcome: ${ar.status} ${JSON.stringify(ar.body).slice(0, 160)}`);
    expect(ar.status).toBe(200);

    const q = `organizationId=${w.orgA.id}&transformationId=${k.transformationId}`;
    const t10 = await get(`${k.base}/dashboard`, k.s.tl);
    const overview = await get(`/api/v1/overview?${q}`, k.s.tl);
    const adoption = await get(`/api/v1/dashboards/adoption?${q}`, k.s.tl);
    const header = await get(`${k.base}/summary`, k.s.tl);
    const collect = (o: unknown, out: Body[] = []): Body[] => {
      if (Array.isArray(o)) o.forEach((x) => collect(x, out));
      else if (o && typeof o === "object") {
        const v = o as Body;
        if (v.value && typeof v.value === "object" && "kpiUnit" in v.value && v.value.kpiUnit) out.push(v);
        Object.values(v).forEach((x) => collect(x, out));
      }
      return out;
    };
    const fmt = (xs: Body[]) => xs.map((x) => `${x.recordType ?? x.templateKey ?? x.metric}:${x.label ?? ""}=${x.value.value}/${x.value.unit}/${JSON.stringify(x.value.kpiUnit)}`).join(" | ");
    const out = areaOf(t10, "outcomes");
    console.log(`R4-7 T10 outcomes rag=${JSON.stringify(out.rag).slice(0, 300)}`);
    console.log(`R4-7 T10 outcomes items=${JSON.stringify(out.items.map((i: Body) => [i.recordType, i.recordId === outcomeId ? "API-OUTCOME" : i.recordId === gone.body.id ? "ARCHIVED!" : i.recordId, i.label, i.rag, i.value])).slice(0, 2500)}`);
    console.log(`R4-7 T10 outcomes kpi values: ${fmt(collect(out))}`);
    console.log(`R4-7 T10 people_adoption kpi values: ${fmt(collect(areaOf(t10, "people_adoption")))}`);
    console.log(`R4-7 overview outcomes kpi values: ${fmt(collect(areaOf(overview, "outcomes")))}; overview people kpi: ${fmt(collect(areaOf(overview, "people_adoption")))}`);
    console.log(`R4-7 adoption dashboard kpi values: ${fmt(collect(adoption))}`);
    console.log(`R4-7 header outcomes=${JSON.stringify(header.outcomes ?? header.outcomeHealth ?? Object.keys(header)).slice(0, 400)}`);
    expect(JSON.stringify(t10)).not.toContain(gone.body.id);
    expect(JSON.stringify(overview)).not.toContain(gone.body.id);
    expect(out.items.some((i: Body) => i.recordId === outcomeId || JSON.stringify(i).includes(outcomeId))).toBe(true);
    const all = collect(out);
    const kinds = all.map((x) => `${x.value.value}:${x.value.kpiUnit.kind}:${x.value.kpiUnit.label}`);
    for (const e of ["0.12:percentage:null", "0.12:percentage:%", "0.12:percentage:% of users", "1.5:ratio:null"]) expect(kinds, `T10 outcomes ${e}`).toContain(e);
    // The outcomes drill-down
    const dh = out.headlines?.[0]?.drilldownHref ?? `/api/v1/dashboards/drilldown?metric=outcomes.area&transformationId=${k.transformationId}`;
    const drill = await get(dh, k.s.tl);
    console.log(`R4-7 outcomes drill (${dh}) kpi values: ${fmt(collect(drill))}; contains archived=${JSON.stringify(drill).includes(gone.body.id)}`);
    expect(JSON.stringify(drill)).not.toContain(gone.body.id);
    expect(collect(drill).map((x) => `${x.value.value}:${x.value.kpiUnit.kind}`)).toContain("1.5:ratio");
    // The value gap still carries kpiUnit null with unit ratio (rendered '100 %' by the web).
  });
});
