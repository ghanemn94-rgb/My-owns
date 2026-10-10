// Finance class lines drill down by value class against a real PostgreSQL (T-DG4-KBE-R4; ADR-0037 amendment K1-K2;
// ADR-0030 §7; REQ-S13-001 "Finance", REQ-S13-003; M0244 "every headline number drills into its contributing records"):
//  - K1 item 4, the invariant: for EVERY class line (class c, state s, currency k) of the Finance dashboard, the drill-
//    down `metric=value.<s>&valueClass=<c>` with the same filters has items whose decimal sum in k, over every page
//    (limit=1, so each item is its own page), equals the line's total, or both are Unknown. The fixture has two
//    financial classes in SAR plus two more, a second currency (USD), a benefit held back by an open overlap, a valued
//    non-financial benefit, and values in all seven states (planned, forecast, measured, submitted, validated,
//    rejected, sustained);
//  - K1 item 5: every class line carries that href; the gross lines keep theirs; the net lines keep null;
//  - K1 items 1-2: valueClass with another metric is 422 dashboard.value_class_not_applicable (exact K2 text, at
//    /valueClass); a value outside the enum is 400; value.measured/rejected/sustained take a benefit subjectId; their
//    rule keys are dashboard.value.sum_<state>;
//  - ADR-0037 §5 "Unknown, never 0": a class with no benefit in scope drills to an empty, labelled not_applicable
//    result; an eligible class with nothing in the state is a known zero in its currency with no item;
//  - the REQ-S13-001 scope sweep over the new metrics and every metric × class: a user scoped to X sees no Y record or
//    figure, while the organization-wide auditor does (so the sweep can fail).
// All data is synthetic. Finance validations and valuation-method approvals here are synthetic in-product business
// approvals of test data and approve nothing real; nothing here touches DG0-DG7.
import { Decimal } from "decimal.js";
import { FINANCE_VALUE_CLASSES } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { financialBody, cxBody, type BenefitWorld } from "../benefits/fixtures.ts";
import { ALL_ACCEPTED, approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { benefitWorldIn, planValue, type Body } from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let x: BenefitWorld;
let y: BenefitWorld;
let xUser: Session;
let auditor: Session;
const yMarks: string[] = [];
let revenueId: string;

const VALUE_STATE_METRICS = [
  "value.planned",
  "value.forecast",
  "value.measured",
  "value.submitted",
  "value.validated",
  "value.rejected",
  "value.sustained",
] as const;

const get = (url: string, session: Session = xUser) => call<Body>(api.app, "GET", url, { session });
const leaks = (body: unknown) => {
  const text = JSON.stringify(body);
  return yMarks.filter((m) => text.includes(m));
};

/** FIN rejects a queued value (one item rejected, with a note). */
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
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** Moves a measured benefit to Sustain (BAU owner and control cadence first). */
async function toSustain(b: BenefitWorld, benefitId: string) {
  const cur = await call<Body>(api.app, "GET", `${b.base}/benefits/${benefitId}`, { session: b.s.bo });
  expect(cur.status, JSON.stringify(cur.body)).toBe(200);
  const p = await call<Body>(api.app, "PATCH", `${b.base}/benefits/${benefitId}`, {
    session: b.s.bo,
    headers: ifm(cur.body.version),
    body: { bauOwnerUserId: b.users.bo2.id, controlCadence: "quarterly" },
  });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const s = await call<Body>(api.app, "POST", `${b.base}/benefits/${benefitId}/lifecycle`, {
    session: b.s.bo,
    headers: ifm(p.body.version),
    body: { toStep: "sustain" },
  });
  expect([s.status, s.body.lifecycleStep], JSON.stringify(s.body)).toEqual([200, "sustain"]);
}

/** A value submitted and approved (validated; sustained when the benefit is at Sustain). */
async function validated(b: BenefitWorld, benefitId: string, amount: string, start: string, end: string) {
  const v = await submittedValue(api, b, benefitId, amount, { periodStart: start, periodEnd: end });
  await approve(api, b, v, amount);
}

/** A value submitted and rejected by Finance. */
async function rejected(b: BenefitWorld, benefitId: string, amount: string, start: string, end: string) {
  await reject(b, await submittedValue(api, b, benefitId, amount, { periodStart: start, periodEnd: end }));
}

/** A benefit created at Identify through the API (POST /benefits). */
async function identified(b: BenefitWorld, body: Record<string, unknown>): Promise<Body> {
  const r = await call<Body>(api.app, "POST", `${b.base}/benefits`, { session: b.s.bo, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** A Finance-approved valuation method of the world's CX KPI (synthetic). */
async function approvedMethod(b: BenefitWorld): Promise<string> {
  const m = await call<Body>(api.app, "POST", `${b.base}/benefit-valuation-methods`, {
    session: b.s.bo,
    body: {
      name: "Synthetic NPS point value",
      method: "Each NPS point is valued at the synthetic retention value per point.",
      appliesToType: "cx",
      kpiDefinitionId: b.kpiDefinitionId,
      unitValue: "125000",
      currency: "SAR",
    },
  });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  const d = await call<Body>(api.app, "POST", `${b.base}/benefit-valuation-methods/${m.body.id}/decision`, {
    session: b.s.fin,
    headers: ifm(1),
    body: { decision: "approved", note: "Synthetic approval" },
  });
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  return m.body.id as string;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);

  // ---- X (BU a1): the K1 fixture.
  x = await benefitWorldIn(api, w, w.a1);
  // A, revenue uplift SAR: planned 1000 (Feb) + 500 (Mar); forecast 300 (Nov); validated 900 (Feb) -> measured 900;
  // rejected 40 (Apr); at Sustain, validated 120 (May) -> sustained 120 (and measured).
  const a = await measuredBenefit(api, x);
  revenueId = a.id;
  await planValue(api, x, a.id, "1000", "2026-02-01", "2026-02-28");
  await planValue(api, x, a.id, "500", "2026-03-01", "2026-03-31");
  const fc = await call<Body>(api.app, "POST", `${x.base}/benefits/${a.id}/plan-values`, {
    session: x.s.bo,
    body: { valueKind: "forecast", periodStart: "2026-11-01", periodEnd: "2026-11-30", amount: "300" },
  });
  expect(fc.status, JSON.stringify(fc.body)).toBe(201);
  await validated(x, a.id, "900", "2026-02-01", "2026-02-28");
  await rejected(x, a.id, "40", "2026-04-01", "2026-04-30");
  await toSustain(x, a.id);
  await validated(x, a.id, "120", "2026-05-01", "2026-05-31");
  // B, margin uplift SAR (a second financial class in SAR): planned 70.05, validated 30.5, submitted 12.25 (pending).
  const b = await measuredBenefit(api, x, { extra: { valueClass: "margin_uplift" } });
  await planValue(api, x, b.id, "70.05", "2026-02-01", "2026-02-28");
  await validated(x, b.id, "30.5", "2026-03-01", "2026-03-31");
  await submittedValue(api, x, b.id, "12.25", { periodStart: "2026-04-01", periodEnd: "2026-04-30" });
  // D, avoided cost SAR: validated 350, then an overlapping benefit (same driver and period) opens an overlap warning,
  // so D's validated value is held back (ADR-0030 §7 item 4). The other side (cash saving) has a planned value.
  const driverKey = "synthetic-k1-driver";
  const window = { driverKey, realizationStart: "2026-01-01", realizationEnd: "2026-12-31" };
  const cost = { benefitType: "cost", financialStatementLine: "Opex - care" };
  const d = await measuredBenefit(api, x, { extra: { valueClass: "avoided_cost", ...cost, ...window } });
  await planValue(api, x, d.id, "400", "2026-02-01", "2026-02-28");
  await validated(x, d.id, "350", "2026-02-01", "2026-02-28");
  const d2 = await identified(x, financialBody(x, { valueClass: "cash_saving", ...cost, ...window }));
  await planValue(api, x, d2.id, "5", "2026-02-01", "2026-02-28");
  const open = await api.db
    .selectFrom("benefit_counting")
    .select(["benefit_id", "overlap_open"])
    .where("benefit_id", "in", [d.id, d2.id])
    .execute();
  expect(open.map((r) => r.overlap_open)).toEqual([true, true]);
  // E, a non-financial benefit with an approved valuation method: planned 125000 (non_financial_valued).
  const method = await approvedMethod(x);
  const e = await identified(x, cxBody(x, { valuationMethodId: method }));
  await planValue(api, x, e.id, "125000", "2026-02-01", "2026-02-28");
  // F, a non-financial benefit WITHOUT a method: Value n/a, in no line.
  await identified(x, cxBody(x, { title: "Synthetic unvalued CX" }));
  // U, revenue uplift in USD (a second currency): planned 2000.
  const u = await identified(x, financialBody(x, { currency: "USD" }));
  await planValue(api, x, u.id, "2000", "2026-02-01", "2026-02-28");

  // ---- Y (BU a2): non-zero, distinctive figures in every new state.
  y = await benefitWorldIn(api, w, w.a2);
  const yb = await measuredBenefit(api, y);
  await validated(y, yb.id, "66666.6", "2026-02-01", "2026-02-28");
  await rejected(y, yb.id, "55555.5", "2026-03-01", "2026-03-31");
  await toSustain(y, yb.id);
  await validated(y, yb.id, "44444.4", "2026-04-01", "2026-04-30");
  yMarks.push(y.transformationId, yb.id, "66666.6", "55555.5", "44444.4");

  // A user granted FIN and TL at X only; the organization-wide auditor.
  const user = await createUser(api.db, w.orgA.id);
  for (const role of ["FIN", "TL"])
    await grant(api.db, w.grantor.id, user.id, role, { type: "transformation", id: x.transformationId }, w.orgA.id);
  xUser = await signIn(api.app, user.subject);
  auditor = await signIn(api.app, w.auditor.subject);
}, 300_000);
afterAll(() => api.close());

const financeOfX = () =>
  get(`/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${x.transformationId}`);

/** Every page of a drill-down (limit=1): its items, and the decimal sum in `currency` (null when an item is Unknown). */
async function drillAll(href: string, currency: string, session: Session = xUser) {
  const items: Body[] = [];
  const first: { status: number; body: Body } = await get(`${href}&limit=1`, session);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  let page = first;
  for (;;) {
    items.push(...(page.body.items as Body[]));
    if (page.body.nextCursor === null) break;
    page = await get(`${href}&limit=1&cursor=${encodeURIComponent(page.body.nextCursor as string)}`, session);
    expect(page.status, JSON.stringify(page.body)).toBe(200);
  }
  let acc: Decimal | null = new Decimal(0);
  for (const i of items) {
    if (i.value?.currency !== currency) continue;
    if (i.value.value === null) acc = null;
    else if (acc !== null) acc = acc.plus(new Decimal(i.value.value));
  }
  return { first: first.body, items, sum: acc === null ? null : acc.toFixed() };
}

describe("K1 item 4: every Finance class line equals the decimal sum of its drill-down's records", () => {
  it("the fixture has two financial classes in one currency, two currencies, an overlap hold and a valued CX line", async () => {
    const r = await financeOfX();
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const classLines = (r.body.lines as Body[]).filter((l) => l.valueClass !== "gross" && l.valueClass !== "net");
    const sar = new Set(classLines.filter((l) => l.currency === "SAR").map((l) => l.valueClass));
    expect([...sar].sort()).toEqual([
      "avoided_cost",
      "cash_saving",
      "margin_uplift",
      "non_financial_valued",
      "revenue_uplift",
    ]);
    expect([...new Set(classLines.map((l) => l.currency))].sort()).toEqual(["SAR", "USD"]);
    // 5 SAR classes + 1 USD class, each with all seven states.
    expect(classLines).toHaveLength(42);
    const t = (c: string, s: string, k = "SAR") =>
      classLines.find((l) => l.valueClass === c && l.state === s && l.currency === k).total;
    // Worked figures (decimal strings compared exactly after normalising scale).
    const dec = (v: Body) => (v.value === null ? null : new Decimal(v.value).toFixed());
    expect(
      ["planned", "forecast", "measured", "submitted", "validated", "rejected", "sustained"].map((s) =>
        dec(t("revenue_uplift", s)),
      ),
    ).toEqual(["1500", "300", "1020", "0", "900", "40", "120"]);
    expect(["planned", "validated", "submitted"].map((s) => dec(t("margin_uplift", s)))).toEqual([
      "70.05",
      "30.5",
      "12.25",
    ]);
    // The overlap holds back D's validated 350 (a known zero, never shown as validated).
    expect([dec(t("avoided_cost", "validated")), dec(t("avoided_cost", "measured"))]).toEqual(["0", "350"]);
    expect([dec(t("non_financial_valued", "planned")), dec(t("revenue_uplift", "planned", "USD"))]).toEqual([
      "125000",
      "2000",
    ]);
  });

  it("for each of the 42 class lines the drill-down (metric value.<state>, valueClass <class>) sums to the line, over every page", async () => {
    const r = await financeOfX();
    const classLines = (r.body.lines as Body[]).filter((l) => l.valueClass !== "gross" && l.valueClass !== "net");
    let checked = 0;
    for (const l of classLines) {
      const label = `${l.valueClass} ${l.state} ${l.currency}`;
      const href = l.drilldownHref as string;
      expect(href, label).not.toBeNull();
      const q = new URLSearchParams(href.split("?")[1]);
      expect([q.get("metric"), q.get("valueClass"), q.get("transformationId")], label).toEqual([
        `value.${l.state}`,
        l.valueClass,
        x.transformationId,
      ]);
      const d = await drillAll(href, l.currency);
      expect([d.first.metric, d.first.calculation.ruleKey], label).toEqual([
        `value.${l.state}`,
        `dashboard.value.sum_${l.state}`,
      ]);
      if (l.total.state === "unknown") expect(d.sum, label).toBeNull();
      else expect(d.sum, label).toBe(new Decimal(l.total.value).toFixed());
      // Every item is a benefit of that class (no record of another class or state is listed).
      for (const i of d.items) expect(i.recordType, label).toBe("benefit");
      checked += 1;
    }
    expect(checked).toBe(42);
  });

  it("gross lines keep their hrefs (no valueClass); net lines keep null; the drill-down's total_<currency> input equals the line", async () => {
    const r = await financeOfX();
    const lines = r.body.lines as Body[];
    for (const l of lines.filter((x) => x.valueClass === "gross")) {
      expect(l.drilldownHref).not.toContain("valueClass=");
      expect(new URLSearchParams(l.drilldownHref.split("?")[1]).get("metric")).toBe(`value.${l.state}`);
    }
    expect(lines.filter((x) => x.valueClass === "net").map((x) => x.drilldownHref)).toEqual([null, null, null, null]);
    const line = lines.find((x) => x.valueClass === "margin_uplift" && x.state === "validated");
    const d = await get(line.drilldownHref);
    expect(d.body.calculation.inputs).toEqual([
      { name: "total_SAR", value: d.body.value, recordType: null, recordId: null },
    ]);
    expect(d.body.value).toEqual(line.total);
  });
});

describe("K1 items 1-2: the parameter, the refusal and the three metrics", () => {
  const base = () => `/api/v1/dashboard-drilldown?organizationId=${w.orgA.id}&transformationId=${x.transformationId}`;

  it("valueClass with a metric that is not a value state is 422 dashboard.value_class_not_applicable (exact K2 text)", async () => {
    for (const metric of ["value.investment", "value.gap", "finance.pending_validation", "decisions.open"]) {
      const r = await get(`${base()}&metric=${metric}&valueClass=revenue_uplift`);
      expect([r.status, r.body.code, r.body.detail, r.body.errors], metric).toEqual([
        422,
        "dashboard.value_class_not_applicable",
        "A value class narrows only a drill-down of benefit values by state.",
        [
          {
            pointer: "/valueClass",
            code: "dashboard.value_class_not_applicable",
            message: "A value class narrows only a drill-down of benefit values by state.",
          },
        ],
      ]);
    }
  });

  it("a value class outside FinanceValueClass is a 400 validation (gross, net, non_financial are not classes)", async () => {
    for (const bad of ["gross", "net", "non_financial", "REVENUE_UPLIFT"]) {
      const r = await get(`${base()}&metric=value.planned&valueClass=${bad}`);
      expect(r.status, bad).toBe(400);
    }
  });

  it("value.measured, value.rejected and value.sustained without a class sum the five financial classes", async () => {
    const r = await financeOfX();
    const lines = r.body.lines as Body[];
    for (const state of ["measured", "rejected", "sustained"]) {
      const d = await drillAll(`${base()}&metric=value.${state}`, "SAR");
      const expected = lines
        .filter((l) => l.state === state && l.currency === "SAR" && l.valueClass !== "non_financial_valued")
        .filter((l) => !["gross", "net"].includes(l.valueClass))
        .reduce((acc, l) => acc.plus(new Decimal(l.total.value)), new Decimal(0))
        .toFixed();
      expect(d.sum, state).toBe(expected);
      // Two currencies are in scope: the drill-down's own value is not_applicable (never converted), each item keeps its currency.
      expect([d.first.value.state, d.first.value.reasonKey, d.first.calculation.ruleKey], state).toEqual([
        "not_applicable",
        "dashboard.value.multiple_currencies",
        `dashboard.value.sum_${state}`,
      ]);
      expect(
        d.first.calculation.inputs.map((i: Body) => i.name),
        state,
      ).toEqual(["total_SAR", "total_USD"]);
    }
  });

  it("the three metrics take a benefit subjectId, as the four original value metrics do", async () => {
    for (const metric of ["value.measured", "value.rejected", "value.sustained"]) {
      const d = await get(`${base()}&metric=${metric}&subjectId=${revenueId}`);
      expect(d.status, `${metric}: ${JSON.stringify(d.body)}`).toBe(200);
      expect(
        d.body.items.map((i: Body) => i.recordId),
        metric,
      ).toEqual([revenueId]);
    }
    // A benefit outside the selection is the existing 422 dashboard.metric_subject_mismatch.
    const bad = await get(`${base()}&metric=value.rejected&subjectId=${x.transformationId}`);
    expect([bad.status, bad.body.code]).toEqual([422, "dashboard.metric_subject_mismatch"]);
  });

  it("Unknown, never 0: a class with no benefit drills to an empty, labelled n/a; an empty state of a class is a known zero", async () => {
    const none = await get(`${base()}&metric=value.sustained&valueClass=working_capital_release`);
    expect([none.status, none.body.items, none.body.value, none.body.calculation.inputs]).toEqual([
      200,
      [],
      {
        state: "not_applicable",
        value: null,
        unit: "currency",
        currency: null,
        reasonKey: "dashboard.value.no_financial_benefit",
      },
      [],
    ]);
    const empty = await get(`${base()}&metric=value.sustained&valueClass=margin_uplift`);
    expect([empty.status, empty.body.items, empty.body.value.state, empty.body.value.currency]).toEqual([
      200,
      [],
      "zero",
      "SAR",
    ]);
  });

  it("the cursor is bound to the value class", async () => {
    const href = `${base()}&metric=value.planned&valueClass=revenue_uplift&limit=1`;
    const p1 = await get(href);
    expect(p1.body.nextCursor).not.toBeNull();
    const other = await get(
      `${base()}&metric=value.planned&valueClass=margin_uplift&limit=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`,
    );
    expect(other.status).toBe(400);
  });
});

describe("REQ-S13-001: a user scoped to X sees no Y record or figure in the value-class drill-downs", () => {
  it("the organization-wide auditor sees Y in each new metric (so the sweep can fail)", async () => {
    for (const metric of ["value.measured", "value.rejected", "value.sustained"]) {
      const d = await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}`, auditor);
      expect(d.status, metric).toBe(200);
      expect(leaks(d.body).length, metric).toBeGreaterThan(0);
    }
  });

  it("every value-state metric, with and without each value class, holds X only", async () => {
    for (const metric of VALUE_STATE_METRICS)
      for (const valueClass of [null, ...FINANCE_VALUE_CLASSES]) {
        const href =
          `/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}` +
          (valueClass === null ? "" : `&valueClass=${valueClass}`);
        const d = await get(href);
        expect([d.status, leaks(d.body)], href).toEqual([200, []]);
      }
    // Every Finance line href of the organization-wide (X-scoped) Finance dashboard.
    const f = await get(`/api/v1/dashboards/finance?organizationId=${w.orgA.id}`);
    expect([f.status, leaks(f.body)]).toEqual([200, []]);
    for (const l of (f.body.lines as Body[]).filter((l) => l.drilldownHref !== null)) {
      const d = await get(l.drilldownHref);
      expect([d.status, leaks(d.body)], l.drilldownHref).toEqual([200, []]);
    }
  });

  it("an explicit Y transformation with a value class is 404; a Y benefit as subject is not disclosed", async () => {
    const d = await get(
      `/api/v1/dashboard-drilldown?metric=value.sustained&valueClass=revenue_uplift&organizationId=${w.orgA.id}&transformationId=${y.transformationId}`,
    );
    expect(d.status).toBe(404);
    const s = await get(
      `/api/v1/dashboard-drilldown?metric=value.sustained&organizationId=${w.orgA.id}&subjectId=${yMarks[1]}`,
    );
    expect([s.status, leaks(s.body)]).toEqual([422, []]);
  });
});
