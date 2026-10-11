// qa-verifier DG4 round 3 (T-DG4-REV-QA-R3): independent acceptance-side probes of the round-2 repairs F-DG4-122 and
// F-DG4-123 (D-119; ADR-0030 and ADR-0037 amendment N3) beyond the candidate's own tests. This file lives OUTSIDE the
// frozen candidate (docs/delivery/test-evidence/DG4/qa/tests/round-3/) and is copied into a disposable clone's
// tests/qa/integration/ only to run, then removed. Every request goes through the QA `call`, which validates the
// response against docs/api/openapi.yaml (so the now-required headlineBasis / benefits.headlines are contract-checked).
//
//  P1 (REQ-S08-009/011, regression of my round-2 probe R3 under N3): five financial classes (300/70/20/45/5 SAR) and a
//     30 SAR investment: gross 95 and net 65 on totals and Finance; the gross line now DRILLS and its drill-down's
//     decimal sum is exactly 95; T10 profit_and_cash planned 95, top_line 300, non_cash 45; 440 (all five) nowhere.
//  P2 (REQ-S13-003 / REQ-PB-076 / F-DG4-123, non-trivial gap): margin uplift planned 90 with 30 validated, revenue
//     uplift planned 300 with 300 validated: profit_and_cash validated 30 and gap 0.666667 (60/90, half-even, 6 places)
//     on T10, the Executive Overview and Finance; the top line's 300 validated never improves the gap; the RAG status
//     follows the policy thresholds on the exact ratio, its ruleParams name the profit_and_cash basis.
//  P3 (security / scoping): the header, the Executive Overview and the drill-downs of the value headlines are refused
//     (403/404, never 200 with the figures) to a user with no grant in the organization, a user of another
//     organization, and a benefit owner of ANOTHER transformation of the same organization.
//  P4 (negative): a drill-down with valueClass=gross or a bogus class is a 400 (contract enum), and valueClass on a
//     non-value-state metric (value.gap) is the 422 dashboard.value_class_not_applicable; never a 200 with a wrong sum.
//     (Revision 2 of this file: try 1 expected 400 for the value.gap case and used limit=200 above the contract's 100.)
//  P6 (REQ-S13-002 on every basis): with the period filter 2026-Q1, the profit_and_cash, top_line and non_cash planned
//     headlines change to their Q1 sums (70 / 300 / 45, against 100 / 400 / 50 to date) on T10, the Executive Overview
//     and the Finance dashboard.
//  P5 (Unknown, never zero or green): a margin line without an amount makes the profit_and_cash planned, the gap and
//     the Finance gross Unknown; the top line stays known; the Value RAG is unknown, never green.
// All data is SYNTHETIC; a Finance approval here is a synthetic in-product approval of test data. No product gate
// (G1-G6) is decided, and nothing here relates to the engineering gates DG0-DG7.
import { FORMULA_DECIMAL as Decimal } from "../../../packages/shared/src/formula/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signIn, type Session, type TestApi, startApi } from "../support/api.ts";
import { canon, financialBody, insertInitiative, seedBenefitWorld, seedWorld, type Body, type BenefitWorld, type World } from "../support/p4.ts";
import { areaOf, openPeriod, planValue, validatedBenefit } from "../../../apps/api/test/integration/contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 120_000);
afterAll(() => api?.close());

const H1 = { start: "2026-01-01", end: "2026-06-30" };
const get = async (url: string, session: Session) => {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url} ${JSON.stringify(r.body).slice(0, 400)}`).toBe(200);
  return r.body;
};
const dec = (v: string | null | undefined) => (v === null || v === undefined ? null : new Decimal(v).toFixed());
function shape(valueClass: string) {
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const m: Record<string, Record<string, unknown>> = {
    revenue_uplift: { benefitType: "revenue", financialStatementLine: "Revenue - roaming" },
    margin_uplift: { benefitType: "revenue", financialStatementLine: "Gross margin - roaming" },
    cash_saving: cost,
    avoided_cost: { ...cost, financialStatementLine: "Opex - network" },
    working_capital_release: { benefitType: "working_capital", financialStatementLine: "Working capital - inventory" },
  };
  return m[valueClass]!;
}
async function benefit(b: BenefitWorld, valueClass: string): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, {
    session: b.s.bo,
    body: financialBody(b, { valueClass, title: `Synthetic QA-R3 ${valueClass}`, ...shape(valueClass) }),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
const q = (b: BenefitWorld) => `organizationId=${b.organizationId}&transformationId=${b.transformationId}`;
const pick = (list: Body[], metric: string, basis: string | null, currency = "SAR") =>
  list.find((h) => h.metric === metric && h.headlineBasis === basis && h.value.currency === currency);
async function drillSum(href: string, session: Session, currency: string): Promise<{ sum: string | null; body: Body }> {
  const body = await get(`${href}&limit=100`, session);
  expect(body.nextCursor, href).toBeNull();
  let s = new Decimal(0);
  for (const it of body.items as Body[]) {
    const v = it.value;
    if (v.state === "unknown") return { sum: null, body };
    if (v.currency === currency && v.value !== null) s = s.plus(v.value);
  }
  return { sum: s.toFixed(), body };
}

describe("P1 REQ-S08-009/011 under N3: gross drills and sums exactly; bases never summed", () => {
  it("gross 95 / net 65; the gross drill-down sums 95; T10 bases 95 / 300 / 45; 440 nowhere", async () => {
    const b = await seedBenefitWorld(api, w);
    const amounts: [string, string][] = [
      ["revenue_uplift", "300"],
      ["margin_uplift", "70"],
      ["cash_saving", "20"],
      ["avoided_cost", "45"],
      ["working_capital_release", "5"],
    ];
    for (const [c, a] of amounts) await planValue(api, b, await benefit(b, c), a, H1.start, H1.end);
    const BC = "/api/v1/business-cases";
    const top = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "transformation", title: "Synthetic transformation case" },
    });
    expect(top.status, JSON.stringify(top.body)).toBe(201);
    const ini = await insertInitiative(api.db, b);
    const iniCase = await call<Body>(api.app, "POST", BC, {
      session: b.s.tl,
      body: { transformationId: b.transformationId, level: "initiative", initiativeId: ini, title: "Synthetic case" },
    });
    expect(iniCase.status, JSON.stringify(iniCase.body)).toBe(201);
    const cost = await call<Body>(api.app, "POST", `${BC}/${iniCase.body.id}/lines`, {
      session: b.s.tl,
      body: { lineKind: "investment", class: "capex", valueBasis: "cash", title: "Synthetic platform", amount: "30", currency: "SAR" },
    });
    expect(cost.status, JSON.stringify(cost.body)).toBe(201);

    const fd = await get(`/api/v1/dashboards/finance?${q(b)}`, b.s.auditor);
    const line = (cls: string, st: string) =>
      (fd.lines as Body[]).filter((l) => l.valueClass === cls && l.state === st && l.currency === "SAR");
    expect(line("gross", "planned").map((l) => canon(l.total.value))).toEqual(["95"]);
    expect(line("net", "planned").map((l) => canon(l.total.value))).toEqual(["65"]);
    const grossHref = line("gross", "planned")[0].drilldownHref as string | null;
    expect(grossHref, "N3 item 3: a gross line always drills").not.toBeNull();
    const g = await drillSum(grossHref!, b.s.auditor, "SAR");
    expect(g.sum).toBe("95");
    expect(g.body.headlineBasis).toBe("profit_and_cash");
    expect((g.body.items as Body[]).length).toBe(3);

    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const vh = areaOf(t10, "value").headlines as Body[];
    expect(dec(pick(vh, "value.planned", "profit_and_cash")!.value.value)).toBe("95");
    expect(dec(pick(vh, "value.planned", "top_line")!.value.value)).toBe("300");
    expect(dec(pick(vh, "value.planned", "non_cash")!.value.value)).toBe("45");
    // each basis's planned drill-down sums to its headline
    for (const basis of ["profit_and_cash", "top_line", "non_cash"]) {
      const h = pick(vh, "value.planned", basis)!;
      expect((await drillSum(h.drilldownHref, b.s.auditor, "SAR")).sum, basis).toBe(dec(h.value.value));
    }
    const header = await get(`${b.base}/summary`, b.s.auditor);
    expect(header.benefits.planned.map((c: Body) => [c.currency, dec(c.value.value)])).toEqual([["SAR", "95"]]);
    for (const body of [t10, fd, header]) expect(JSON.stringify(body)).not.toMatch(/"440(\.0+)?"/);
  });
});

describe("P2 REQ-S13-003 / F-DG4-123: a non-trivial gap on the profit-and-cash basis only", () => {
  it("validated 30 of 90 -> gap 0.666667 on T10, overview and Finance; top line 300/300 never improves it", async () => {
    const b = await seedBenefitWorld(api, w);
    const m = await validatedBenefit(api, b, [{ amount: "90", ...H1 }], { amount: "30", start: "2026-03-01", end: "2026-03-31" }, { valueClass: "margin_uplift" });
    const r = await validatedBenefit(api, b, [{ amount: "300", ...H1 }], { amount: "300", start: "2026-03-01", end: "2026-03-31" }, { valueClass: "revenue_uplift" });
    expect(m.measurementId && r.measurementId).toBeTruthy();
    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const ov = await get(`/api/v1/overview?${q(b)}`, b.s.auditor);
    const fd = await get(`/api/v1/dashboards/finance?${q(b)}`, b.s.auditor);
    const lists: [string, Body[]][] = [
      ["T10", areaOf(t10, "value").headlines],
      ["overview", areaOf(ov, "value").headlines],
      ["finance", (fd.headlines as Body[]).filter((h) => String(h.metric).startsWith("value."))],
    ];
    for (const [where, list] of lists) {
      expect(dec(pick(list, "value.planned", "profit_and_cash")?.value.value), where).toBe("90");
      expect(dec(pick(list, "value.validated", "profit_and_cash")?.value.value), where).toBe("30");
      expect(pick(list, "value.gap", "profit_and_cash")?.value, where).toMatchObject({ state: "value", unit: "ratio", currency: "SAR", value: "0.666667" });
      expect(dec(pick(list, "value.validated", "top_line")?.value.value), where).toBe("300");
      expect(list.filter((h) => h.metric === "value.gap").length, `${where}: one gap per currency`).toBe(1);
      const vd = pick(list, "value.validated", "profit_and_cash")!;
      expect((await drillSum(vd.drilldownHref, b.s.auditor, "SAR")).sum, `${where} validated drill`).toBe("30");
    }
    for (const body of [t10, ov]) {
      const rag = areaOf(body, "value").rag;
      expect(rag.ruleKey).toBe("dashboard.rag.value.validated_gap");
      expect(rag.ruleParams.headlineBasis).toBe("profit_and_cash");
      const ratio = new Decimal(60).dividedBy(90);
      const want = ratio.lte(rag.ruleParams.amberRatio) ? "green" : ratio.lte(rag.ruleParams.redRatio) ? "amber" : "red";
      expect(rag.status, JSON.stringify(rag.ruleParams)).toBe(want);
    }
  });
});

describe("P3 security: value headlines and their drill-downs are scoped", () => {
  it("no grant, another organization, and another transformation's BO are refused (403/404), never served the figures", async () => {
    const b = await seedBenefitWorld(api, w);
    await planValue(api, b, await benefit(b, "margin_uplift"), "77.77", H1.start, H1.end);
    const other = await seedBenefitWorld(api, w); // same organization, another transformation
    const nobody = await signIn(api.app, w.nobody.subject);
    const outsider = await signIn(api.app, w.officeB.subject);
    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const href = pick(areaOf(t10, "value").headlines, "value.planned", "profit_and_cash")!.drilldownHref as string;
    const urls = [`${b.base}/summary`, `${b.base}/dashboard`, `/api/v1/overview?${q(b)}`, `/api/v1/dashboards/finance?${q(b)}`, href];
    const seen: string[] = [];
    for (const [who, s] of [["nobody", nobody], ["orgB", outsider], ["otherBO", other.s.bo]] as const)
      for (const u of urls) {
        const res = await call<Body>(api.app, "GET", u, { session: s });
        seen.push(`${who} ${res.status} ${u.slice(0, 60)}`);
        expect([403, 404], `${who} GET ${u} -> ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain("77.77");
      }
    console.log("P3 statuses:", seen.join(" | "));
  });
});

describe("P4 negative: malformed drill-down narrowing is refused", () => {
  it("valueClass=gross or a bogus class -> 400; valueClass on value.gap -> 422 value_class_not_applicable", async () => {
    const b = await seedBenefitWorld(api, w);
    await planValue(api, b, await benefit(b, "revenue_uplift"), "300", H1.start, H1.end);
    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const top = pick(areaOf(t10, "value").headlines, "value.planned", "top_line")!.drilldownHref as string;
    expect(top).toContain("valueClass=revenue_uplift");
    const gap = (areaOf(t10, "value").headlines as Body[]).find((h) => h.metric === "value.gap")!.drilldownHref as string;
    for (const u of [top.replace("valueClass=revenue_uplift", "valueClass=gross"), top.replace("valueClass=revenue_uplift", "valueClass=bogus")]) {
      const res = await call<Body>(api.app, "GET", u, { session: b.s.auditor });
      expect(res.status, `${u} ${JSON.stringify(res.body).slice(0, 300)}`).toBe(400);
      expect(res.body.errors?.[0]?.pointer).toBe("/query/valueClass");
    }
    const g = await call<Body>(api.app, "GET", `${gap}&valueClass=revenue_uplift`, { session: b.s.auditor });
    expect(g.status, JSON.stringify(g.body).slice(0, 300)).toBe(422);
    expect(g.body.code).toBe("dashboard.value_class_not_applicable");
  });
});

describe("P5 Unknown, never zero or green", () => {
  it("a margin line without an amount -> profit_and_cash planned, gap and Finance gross Unknown; top line known; RAG not green", async () => {
    const b = await seedBenefitWorld(api, w);
    const mg = await benefit(b, "margin_uplift");
    const r = await call<Body>(api.app, "POST", `${b.base}/benefits/${mg}/plan-values`, {
      session: b.s.bo,
      body: { valueKind: "planned", periodStart: H1.start, periodEnd: H1.end, amount: null, kpiValue: "12" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    await planValue(api, b, await benefit(b, "cash_saving"), "20", H1.start, H1.end);
    await planValue(api, b, await benefit(b, "revenue_uplift"), "300", H1.start, H1.end);
    const t10 = await get(`${b.base}/dashboard`, b.s.auditor);
    const vh = areaOf(t10, "value").headlines as Body[];
    expect(pick(vh, "value.planned", "profit_and_cash")!.value).toMatchObject({ state: "unknown", value: null });
    expect(pick(vh, "value.gap", "profit_and_cash")!.value).toMatchObject({ state: "unknown", value: null });
    expect(dec(pick(vh, "value.planned", "top_line")!.value.value)).toBe("300");
    expect(areaOf(t10, "value").rag.status).toBe("unknown");
    const fd = await get(`/api/v1/dashboards/finance?${q(b)}`, b.s.auditor);
    const gross = (fd.lines as Body[]).find((l) => l.valueClass === "gross" && l.state === "planned" && l.currency === "SAR");
    expect(gross.total).toMatchObject({ state: "unknown", value: null });
    const header = await get(`${b.base}/summary`, b.s.auditor);
    expect(header.benefits.planned[0].value).toMatchObject({ state: "unknown", value: null });
  });
});

describe("P6 REQ-S13-002: the period filter changes every basis's headline", () => {
  it("Q1: profit_and_cash 70, top_line 300, non_cash 45 (to date 100 / 400 / 50) on T10, overview and Finance", async () => {
    const b = await seedBenefitWorld(api, w);
    const q1 = await openPeriod(api, w, "quarterly", "2026-Q1", "2026-01-01", "2026-03-31");
    for (const [c, feb, jun] of [["margin_uplift", "70", "30"], ["revenue_uplift", "300", "100"], ["avoided_cost", "45", "5"]] as const) {
      const id = await benefit(b, c);
      await planValue(api, b, id, feb, "2026-02-01", "2026-02-28");
      await planValue(api, b, id, jun, "2026-06-01", "2026-06-30");
    }
    const figures = async (suffix: string) => {
      const t10 = await get(`${b.base}/dashboard${suffix ? `?${suffix.slice(1)}` : ""}`, b.s.auditor);
      const ov = await get(`/api/v1/overview?${q(b)}${suffix}`, b.s.auditor);
      const fd = await get(`/api/v1/dashboards/finance?${q(b)}${suffix}`, b.s.auditor);
      const lists: Body[][] = [areaOf(t10, "value").headlines, areaOf(ov, "value").headlines, (fd.headlines as Body[]).filter((h) => String(h.metric).startsWith("value."))];
      return lists.map((l) => ["profit_and_cash", "top_line", "non_cash"].map((bs) => dec(pick(l, "value.planned", bs)?.value.value)));
    };
    expect(await figures("")).toEqual(Array(3).fill(["100", "400", "50"]));
    expect(await figures(`&periodId=${q1.id}`)).toEqual(Array(3).fill(["70", "300", "45"]));
  });
});
