// domain-reviewer DG4 round 3 (T-DG4-REV-DOM-R3): in-process domain probe on the real API (Fastify inject) and a
// disposable PostgreSQL (the integration project's global setup). Placed ONLY in the disposable clone as
// tests/qa/integration/zz-domain-r3.test.ts; it is review evidence, not part of the candidate. SYNTHETIC data; a
// Finance validation here is a synthetic in-product approval of test data that approves nothing real, and nothing here
// touches DG0-DG7.
// Questions (F-DG4-122, F-DG4-123 re-verification, adversarial):
//  R3-1 DOM-GROSS world: profit-and-cash 90, top line 300, non-cash 45 on T10, Overview, Finance, header; no numeric
//       value 435 anywhere; every value headline's drill items sum to it.
//  R3-2 revenue + avoided cost only: profit-and-cash headlines, gap and Value RAG n/a (never 0 or green); what the
//       Finance gross line shows (KBE-R6 §5.3 (a)).
//  R3-3 a 25 % gap and a negative gap (validated above planned) on the API: the gap value is the exact ratio.
//  R3-4 a VALIDATED revenue uplift must not reduce the profit-and-cash gap (top line never counts as validated
//       profit-and-cash value), and must not raise Validated value (profit and cash).
//  R3-5 forecast and submitted (pending) never count as validated on the profit-and-cash headline.
import { FORMULA_DECIMAL as Decimal } from "../../../packages/shared/src/calc.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sumItems } from "../../../apps/api/src/modules/reporting/dashboards/drilldown.ts";
import { call, seedWorld, startApi, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { financialBody, insertInitiative, type BenefitWorld } from "../../../apps/api/test/integration/benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../../../apps/api/test/integration/benefits/value-fixtures.ts";
import { areaOf, benefitWorldIn, dashboardWorld, outcomeKpi, planValue, type Body } from "../../../apps/api/test/integration/contract/p4-exercises-kbe-g.ts";
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
    avoided_cost: { ...cost, financialStatementLine: "Opex - network" },
  };
  return financialBody(b, { valueClass, ...shape[valueClass], ...extra });
}
async function benefit(b: BenefitWorld, valueClass: string): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body: classBody(b, valueClass) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
const get = async (url: string, session: Session) => {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url} ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
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
/** Every numeric "value"/"amount" member anywhere in a body (to prove 435 is never a figure, independent of ids). */
function numbers(o: unknown, out: string[] = []): string[] {
  if (Array.isArray(o)) o.forEach((x) => numbers(x, out));
  else if (o && typeof o === "object")
    for (const [k, v] of Object.entries(o)) {
      if ((k === "value" || k === "amount" || k === "total") && typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) out.push(dec(v)!);
      numbers(v, out);
    }
  return out;
}
async function drillSum(h: Body, session: Session): Promise<{ basis: string | null; sum: string | null; n: number; state: string }> {
  let url: string | null = `${h.drilldownHref}&limit=50`;
  const items: Body[] = [];
  let first: Body | null = null;
  while (url) {
    const p = await get(url, session);
    first ??= p;
    items.push(...p.items);
    url = p.nextCursor ? `${h.drilldownHref}&limit=50&cursor=${p.nextCursor}` : null;
  }
  return { basis: first!.headlineBasis, sum: sumItems(items, h.value.currency), n: items.length, state: first!.value.state };
}
const gross = (s: S, state: string, cur = "SAR") => (s.finance.lines as Body[]).find((l) => l.valueClass === "gross" && l.state === state && l.currency === cur);

describe("domain-reviewer DG4 R3: value headlines (F-DG4-122/123)", () => {
  it("R3-1 DOM-GROSS: 90 / 300 / 45 on four surfaces, no 435, drill sums equal headlines", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const amounts: Record<string, string> = { revenue_uplift: "300", margin_uplift: "70", cash_saving: "20", avoided_cost: "45" };
    for (const [c, a] of Object.entries(amounts)) await planValue(api, b, await benefit(b, c), a, H1.start, H1.end);
    const s = await surfaces(b);
    for (const [where, l] of lists(s)) {
      console.log(`R3-1 ${where}: ${show(l)}`);
      expect(dec(pick(l, "value.planned", "profit_and_cash")?.value.value), where).toBe("90");
      expect(dec(pick(l, "value.planned", "top_line")?.value.value), where).toBe("300");
      expect(dec(pick(l, "value.planned", "non_cash")?.value.value), where).toBe("45");
      expect(pick(l, "value.validated", "profit_and_cash")?.value.state, where).toBe("zero");
      if (where !== "header") expect(dec(pick(l, "value.gap", "profit_and_cash")?.value.value), where).toBe("1");
      for (const h of l) {
        if (h.metric === "value.gap" || h.headlineBasis === null) continue;
        const d = await drillSum(h, b.s.auditor);
        console.log(`R3-1 drill ${where} ${h.metric}/${h.headlineBasis}: headline=${h.value.value ?? h.value.state} drill-sum=${d.sum} items=${d.n} basis=${d.basis}`);
        expect(d.basis, where).toBe(h.headlineBasis);
        if (h.value.state === "value" || h.value.state === "zero") expect(dec(d.sum), `${where} ${h.metric}`).toBe(dec(h.value.value));
      }
    }
    for (const [k, body] of Object.entries(s)) expect(numbers(body), k).not.toContain("435");
    const g = gross(s, "planned");
    console.log(`R3-1 finance gross planned=${g.total.value} href=${g.drilldownHref}; RAG=${JSON.stringify(areaOf(s.t10, "value").rag)}`);
    expect(dec(g.total.value)).toBe("90");
    expect(g.drilldownHref).toBe(pick(lists(s)[2][1], "value.planned", "profit_and_cash").drilldownHref);
    expect(areaOf(s.t10, "value").rag.status).toBe("red");
  });

  it("R3-2 revenue 300 + avoided 45 only: profit-and-cash n/a, gap n/a, RAG n/a (never 0 / green); gross line recorded", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    await planValue(api, b, await benefit(b, "revenue_uplift"), "300", H1.start, H1.end);
    await planValue(api, b, await benefit(b, "avoided_cost"), "45", H1.start, H1.end);
    const s = await surfaces(b);
    for (const [where, l] of lists(s)) {
      console.log(`R3-2 ${where}: ${show(l)}`);
      for (const st of where === "header" ? ["planned", "validated"] : ["planned", "forecast", "submitted", "validated"]) {
        const h = pick(l, `value.${st}`, "profit_and_cash");
        expect(h?.value.state, `${where} ${st}`).toBe("not_applicable");
        expect(h?.value.reasonKey, `${where} ${st}`).toBe("dashboard.value.no_profit_and_cash_benefit");
      }
      if (where !== "header") expect(pick(l, "value.gap", "profit_and_cash")?.value.state, where).toBe("not_applicable");
      expect(dec(pick(l, "value.planned", "top_line")?.value.value), where).toBe("300");
      expect(dec(pick(l, "value.planned", "non_cash")?.value.value), where).toBe("45");
    }
    const rag = areaOf(s.t10, "value").rag;
    const orow = (s.overview.transformations as Body[]).find((t) => t.transformationId === b.transformationId || t.id === b.transformationId);
    const g = gross(s, "planned");
    console.log(`R3-2 T10 RAG=${JSON.stringify(rag)} overview-row=${JSON.stringify(orow).slice(0, 600)} finance gross planned=${JSON.stringify(g)} header.planned=${JSON.stringify(s.header.benefits.planned)}`);
    expect(rag.status).toBe("not_applicable");
    expect(rag.ruleKey).toBe("dashboard.rag.value.no_profit_and_cash_benefit");
    if (g) {
      const d = await drillSum({ ...g, value: g.total }, b.s.auditor);
      console.log(`R3-2 gross drill: sum=${d.sum} items=${d.n} state=${d.state}`);
    }
  });

  it("R3-3 a 25 % gap (validated 75 of 100) and a negative gap (validated 120 of 100): exact ratios", async () => {
    for (const [validated, gap] of [["75", "0.25"], ["120", "-0.2"]] as const) {
      const b = await benefitWorldIn(api, w, w.a1);
      const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
      await planValue(api, b, m.id, "100", H1.start, H1.end);
      await approve(api, b, await submittedValue(api, b, m.id, validated, { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), validated);
      const s = await surfaces(b);
      for (const [where, l] of lists(s)) {
        console.log(`R3-3 v=${validated} ${where}: ${show(l)}`);
        expect(dec(pick(l, "value.validated", "profit_and_cash")?.value.value), where).toBe(dec(validated));
        if (where !== "header") {
          const g = pick(l, "value.gap", "profit_and_cash")!.value;
          expect({ unit: g.unit, value: dec(g.value) }, where).toEqual({ unit: "ratio", value: dec(gap) });
        }
      }
      const fg = gross(s, "validated");
      console.log(`R3-3 v=${validated} RAG=${JSON.stringify(areaOf(s.t10, "value").rag).slice(0, 300)} finance gross validated=${fg?.total?.value}`);
      expect(dec(fg.total.value)).toBe(dec(validated));
    }
  });

  it("R3-4 a validated revenue uplift never lowers the profit-and-cash gap; R3-5 forecast/submitted never count", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const mar = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
    await planValue(api, b, mar.id, "100", H1.start, H1.end);
    await submittedValue(api, b, mar.id, "60", { periodStart: "2026-03-01", periodEnd: "2026-03-31" }); // pending, not approved
    const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${mar.id}/plan-values`, { session: b.s.bo, body: { valueKind: "forecast", periodStart: H1.start, periodEnd: H1.end, amount: "90" } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rev = await measuredBenefit(api, b, { extra: { valueClass: "revenue_uplift" } });
    await planValue(api, b, rev.id, "500", H1.start, H1.end);
    await approve(api, b, await submittedValue(api, b, rev.id, "500", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "500");
    const s = await surfaces(b);
    for (const [where, l] of lists(s)) {
      console.log(`R3-4 ${where}: ${show(l)}`);
      expect(pick(l, "value.validated", "profit_and_cash")?.value.state, where).toBe("zero");
      expect(dec(pick(l, "value.validated", "top_line")?.value.value), where).toBe("500");
      if (where !== "header") {
        expect(dec(pick(l, "value.gap", "profit_and_cash")?.value.value), where).toBe("1");
        expect(dec(pick(l, "value.submitted", "profit_and_cash")?.value.value), where).toBe("60");
        expect(dec(pick(l, "value.forecast", "profit_and_cash")?.value.value), where).toBe("90");
      }
    }
    expect(areaOf(s.t10, "value").rag.status).toBe("red");
  });
  it("R3-6 margin 70 fully validated; revenue uplift 300 (or avoided cost 300) planned, NOTHING validated: what the Value RAG says", async () => {
    for (const other of ["revenue_uplift", "avoided_cost"]) {
      const b = await benefitWorldIn(api, w, w.a1);
      const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
      await planValue(api, b, m.id, "70", H1.start, H1.end);
      await approve(api, b, await submittedValue(api, b, m.id, "70", { periodStart: "2026-02-01", periodEnd: "2026-02-28" }), "70");
      await planValue(api, b, await benefit(b, other), "300", H1.start, H1.end);
      const s = await surfaces(b);
      const rag = areaOf(s.t10, "value").rag;
      const orow = (s.overview.transformations as Body[]).find((t) => (t.transformationId ?? t.id) === b.transformationId);
      const frow = (s.finance.transformations as Body[] | undefined)?.find((t) => (t.transformationId ?? t.id) === b.transformationId);
      for (const [where, l] of lists(s)) console.log(`R3-6 ${other} ${where}: ${show(l)}`);
      console.log(`R3-6 ${other} T10 Value RAG=${JSON.stringify(rag)}`);
      console.log(`R3-6 ${other} overview area value RAG=${JSON.stringify(areaOf(s.overview, "value").rag).slice(0, 400)} row=${JSON.stringify(orow).slice(0, 700)}`);
      console.log(`R3-6 ${other} finance row=${JSON.stringify(frow).slice(0, 700)}`);
      console.log(`R3-6 ${other} header valueStatus=${JSON.stringify(s.header.benefits).slice(0, 300)}`);
      // Recorded, then asserted as the SOURCE reads (B0095 / M0248: Value RAG based on the validated benefit gap):
      // 300 of the 370 planned benefit (81 %) is not validated, so the Value status must not be green.
      expect.soft(rag.status, `${other}: Value RAG with 300 of planned ${other} unvalidated`).not.toBe("green");
    }
  });
  it("R3-7 a percentage KPI (12 %, stored as the fraction 0.12, ADR-0028 s3 / M0170) on the T10 Outcomes area: the value object the web formats", async () => {
    for (const unitLabel of [null, "%"]) {
      const k = await dashboardWorld(api, w);
      const kpi = await ownedKpi(api, k, { measureType: "higher_is_better", valueNature: "ratio", aggregationRule: "weighted_ratio", submissionRoute: "direct_accept", numeratorLabel: "Synthetic activated", denominatorLabel: "Synthetic eligible" }, { unitKind: "percentage", unitLabel });
      await outcomeKpi(api.db, k, k.outcomeId, kpi.id, w.orgA.id);
      const period = await monthlyPeriod(api, w);
      const r = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, numerator: "12", denominator: "100" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      await runRecalculation(api, r.body.actual.id);
      const dash = await get(`${k.base}/dashboard`, k.s.tl);
      const out = areaOf(dash, "outcomes");
      const vals: Body[] = [];
      const walk = (o: unknown) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { const v = o as Body; if (v.value && typeof v.value === "object" && "unit" in v.value && v.value.unit !== null && v.value.unit !== "outcome_kpi") vals.push(v.value); Object.values(v).forEach(walk); } };
      walk(out);
      console.log(`R3-7 unitLabel=${unitLabel} outcomes area values=${JSON.stringify(vals)}`);
      const drill = await get(out.headlines?.[0]?.drilldownHref ?? `/api/v1/dashboards/drilldown?metric=outcomes.area&transformationId=${k.transformationId}`, k.s.tl).catch((e) => ({ error: String(e) }));
      console.log(`R3-7 unitLabel=${unitLabel} outcomes drill items=${JSON.stringify((drill as Body).items?.map((i: Body) => i.value)).slice(0, 600)}`);
      expect(vals.some((v) => v.value === "0.12" && v.unit === (unitLabel ?? "percentage"))).toBe(true);
    }
  });
  it("R3-8 DOM-GROSS benefits allocated 100 % to one completed initiative: the T10 Portfolio area's initiative value", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const ini = await insertInitiative(api.db, b, { status: "completed" });
    const amounts: Record<string, string> = { revenue_uplift: "300", margin_uplift: "70", cash_saving: "20", avoided_cost: "45" };
    for (const [c, a] of Object.entries(amounts)) {
      const id = await benefit(b, c);
      await planValue(api, b, id, a, H1.start, H1.end);
      const cur = await get(`${b.base}/benefits/${id}`, b.s.auditor);
      const r = await call<Body>(api.app, "PUT", `${b.base}/benefits/${id}/allocations`, { session: b.s.tl, headers: { "if-match": `"${cur.version}"` }, body: { allocations: [{ initiativeId: ini, share: "1" }] } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    const dash = await get(`${b.base}/dashboard`, b.s.auditor);
    const port = areaOf(dash, "portfolio");
    const row = (port.items as Body[]).find((i) => i.recordId === ini);
    console.log(`R3-8 portfolio item=${JSON.stringify(row)}`);
    console.log(`R3-8 value headlines (same world)=${show(areaOf(dash, "value").headlines)}`);
    // As the source reads it (M0172; ADR-0037 N3 item 2 "no unlabelled sum crosses bases"): not 435.
    expect.soft(dec(row?.value?.value), "Portfolio initiative value adds top line + non-cash into one SAR figure").not.toBe("435");
  });
});

