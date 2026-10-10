// The Finance and adoption dashboards against a real PostgreSQL (T-DG4-KBE-G2; ADR-0037 §2-§6, §12; ADR-0030 §7;
// REQ-S13-001 "Finance" and "adoption"; p4-work-split §J+K JK.5):
//  - Finance: one line per value class × state × currency, each state on its own (planned, forecast, measured,
//    submitted, validated, rejected, sustained); gross = the Value area's planned/validated headline and drills to it
//    with an equal decimal sum; net = gross − implementation cost; the count awaiting Finance equals its drill-down;
//    a non-financial benefit is counted in nonFinancialCount, is in no line and is n/a, never 0;
//  - adoption: the People & adoption area, each indicator with its KPI status (an indicator without an actual is
//    unknown, never 0 or green), the open interventions;
//  - the X/Y scope sweep (REQ-S13-001): a user scoped to transformation X sees no transformation Y record or figure in
//    any tile, total or drill-down of the two dashboards; an explicit Y or an ungranted organization is 404.
// Worked fixture (SAR, revenue uplift, X): planned 1000.0000 (Feb) + 500.0000 (Mar), validated 900.0000 (Feb), one
// value 250.0000 (Mar) submitted and awaiting Finance. To the business date (2026-10 or later): planned 1500, validated
// 900, submitted 250 (pending is never validated), gross planned 1500, gross validated 900, net = gross (no investment
// line: implementation cost is a known 0). All data is synthetic; a Finance validation here is a synthetic in-product
// business approval of test data and approves nothing real.
import { Decimal } from "decimal.js";
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
import type { KpiWorld } from "../kpi/fixtures.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";
import { benefitAt, cxBody } from "../benefits/fixtures.ts";
import { submittedValue } from "../benefits/value-fixtures.ts";
import {
  acceptedActual,
  adoptionLink,
  benefitWorldIn,
  dashboardWorld,
  openPeriod,
  riyadhToday,
  trajectoryKpi,
  validatedBenefit,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let xb: BenefitWorld; // X: financial + non-financial benefits (BU a1)
let yb: BenefitWorld; // Y: non-zero figures in BU a2
let cxOnly: BenefitWorld; // a transformation with only a non-financial benefit
let xk: KpiWorld; // X's adoption side (BU a1)
let xk2: KpiWorld; // a second X transformation: an indicator without an actual (one link per template and target)
let yk: KpiWorld; // Y's adoption side (BU a2)
let xUser: Session; // granted FIN + TL at the X transformations only
const yMarks: string[] = [];
let xIndicatorKpi: string;
let xUnknownKpi: string;

const get = (url: string, session: Session = xUser) => call<Body>(api.app, "GET", url, { session });
const leaks = (body: unknown) => {
  const text = JSON.stringify(body);
  return yMarks.filter((m) => text.includes(m));
};
const dec = (v: string | null) => (v === null ? null : new Decimal(v).toFixed());

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const { today } = await riyadhToday(api);

  // Finance X.
  xb = await benefitWorldIn(api, w, w.a1);
  const xv = await validatedBenefit(
    api,
    xb,
    [
      { amount: "1000", start: "2026-02-01", end: "2026-02-28" },
      { amount: "500", start: "2026-03-01", end: "2026-03-31" },
    ],
    { amount: "900", start: "2026-02-01", end: "2026-02-28" },
  );
  await submittedValue(api, xb, xv.benefitId, "250", { periodStart: "2026-03-01", periodEnd: "2026-03-31" });
  await benefitAt(api, xb, "plan", cxBody(xb));

  // Finance Y (non-zero, distinct figures).
  yb = await benefitWorldIn(api, w, w.a2);
  const yv = await validatedBenefit(api, yb, [{ amount: "77777.7", start: "2026-02-01", end: "2026-02-28" }], {
    amount: "66666.6",
    start: "2026-02-01",
    end: "2026-02-28",
  });
  // (Benefit codes are per transformation, so X also has a B01: ids and figures are the marks.)
  yMarks.push(yb.transformationId, yv.benefitId, "77777.7", "66666.6");

  // Only a non-financial benefit.
  cxOnly = await benefitWorldIn(api, w, w.a1);
  await benefitAt(api, cxOnly, "plan", cxBody(cxOnly));

  // Adoption X and Y: one indicator with an accepted actual, one without (X); one with a distinctive actual (Y).
  const april = await openPeriod(api, w, "monthly", "2026-04", "2026-04-01", "2026-04-30");
  xk = await dashboardWorld(api, w, w.a1);
  const xi = await trajectoryKpi(api, xk);
  xIndicatorKpi = xi.id;
  await adoptionLink(api.db, xk, w.orgA.id, xi.id);
  await acceptedActual(api, xk, xi.id, april.id, "130", today);
  xk2 = await dashboardWorld(api, w, w.a1);
  const xu = await trajectoryKpi(api, xk2);
  xUnknownKpi = xu.id;
  await adoptionLink(api.db, xk2, w.orgA.id, xu.id);
  const iv = await call<Body>(api.app, "POST", `${xk.base}/adoption-interventions`, {
    session: xk.s.tl,
    body: {
      interventionType: "training",
      title: "Synthetic training wave",
      ownerUserId: xk.users.bo.id,
      dueDate: "2026-12-01",
    },
  });
  expect(iv.status, JSON.stringify(iv.body)).toBe(201);
  yk = await dashboardWorld(api, w, w.a2);
  const yi = await trajectoryKpi(api, yk);
  const yLink = await adoptionLink(api.db, yk, w.orgA.id, yi.id);
  await acceptedActual(api, yk, yi.id, april.id, "987654.321", today);
  yMarks.push(yk.transformationId, yi.id, yLink, "987654.321");

  // A user granted FIN and TL at the X transformations only.
  const u = await createUser(api.db, w.orgA.id);
  for (const t of [xb.transformationId, cxOnly.transformationId, xk.transformationId, xk2.transformationId]) {
    await grant(api.db, w.grantor.id, u.id, "FIN", { type: "transformation", id: t }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: t }, w.orgA.id);
  }
  xUser = await signIn(api.app, u.subject);
}, 300_000);
afterAll(() => api.close());

const lineOf = (body: Body, valueClass: string, state: string, currency = "SAR"): Body =>
  (body.lines as Body[]).find((l) => l.valueClass === valueClass && l.state === state && l.currency === currency);

/** The decimal sum of a drill-down's item values in a currency, over every page. */
async function drillSum(href: string, currency: string, session: Session = xUser): Promise<string> {
  let acc = new Decimal(0);
  let url: string | null = href;
  while (url !== null) {
    const d: { status: number; body: Body } = await get(url, session);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    for (const i of d.body.items as Body[])
      if (i.value?.currency === currency && i.value.value !== null) acc = acc.plus(new Decimal(i.value.value));
    url = d.body.nextCursor === null ? null : `${href}&cursor=${encodeURIComponent(d.body.nextCursor as string)}`;
  }
  return acc.toFixed();
}

describe("Finance dashboard (REQ-S13-001 Finance; ADR-0030 §7)", () => {
  it("shows class × state × currency lines, each state on its own, with gross, net and the Finance queue", async () => {
    const r = await get(
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${xb.transformationId}`,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = (state: string) => dec(lineOf(r.body, "revenue_uplift", state).total.value);
    expect([v("planned"), v("validated"), v("submitted"), v("forecast"), v("rejected"), v("sustained")]).toEqual([
      "1500",
      "900",
      "250",
      "0",
      "0",
      "0",
    ]);
    expect(lineOf(r.body, "revenue_uplift", "forecast").total.state).toBe("zero");
    // measured = what was measured (validated 900 + submitted 250); it is its own state, never added to the others.
    expect(v("measured")).toBe("1150");
    expect([
      dec(lineOf(r.body, "gross", "planned").total.value),
      dec(lineOf(r.body, "gross", "validated").total.value),
    ]).toEqual(["1500", "900"]);
    // No investment line: implementation cost is a known 0, so net = gross.
    expect([
      dec(lineOf(r.body, "net", "planned").total.value),
      dec(lineOf(r.body, "net", "validated").total.value),
    ]).toEqual(["1500", "900"]);
    expect([r.body.pendingValidationCount, r.body.nonFinancialCount]).toEqual([1, 1]);
    // A non-financial benefit is in no line and never summed as 0.
    expect(
      (r.body.lines as Body[]).some((l) => l.valueClass === "non_financial" || l.valueClass === "non_financial_valued"),
    ).toBe(false);
    expect(r.body.transformations.map((t: Body) => t.transformationId)).toEqual([xb.transformationId]);
  });

  it("gross lines and headlines drill to their records with an equal decimal sum; the queue count drills to its records", async () => {
    const r = await get(
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${xb.transformationId}`,
    );
    for (const state of ["planned", "validated"]) {
      const line = lineOf(r.body, "gross", state);
      expect(line.drilldownHref, state).not.toBeNull();
      expect(await drillSum(line.drilldownHref, "SAR"), state).toBe(dec(line.total.value));
    }
    // Every class line drills to its state's metric narrowed to its class (ADR-0037 amendment K1; T-DG4-KBE-R4), so
    // its drill-down sums exactly its records; net is derived (from gross and investment) and keeps no href.
    const cls = lineOf(r.body, "revenue_uplift", "validated");
    expect(await drillSum(cls.drilldownHref, "SAR")).toBe("900");
    const measured = lineOf(r.body, "revenue_uplift", "measured");
    expect(measured.drilldownHref).toContain("metric=value.measured");
    expect(measured.drilldownHref).toContain("valueClass=revenue_uplift");
    expect(await drillSum(measured.drilldownHref, "SAR")).toBe("1150");
    expect(lineOf(r.body, "net", "planned").drilldownHref).toBeNull();
    const pending = (r.body.headlines as Body[]).find((h) => h.metric === "finance.pending_validation");
    expect(pending.value).toMatchObject({ state: "value", value: "1" });
    const d = await get(pending.drilldownHref);
    expect([d.status, d.body.items.length, d.body.items[0].recordType]).toEqual([200, 1, "benefit_measurement"]);
    for (const h of r.body.headlines as Body[]) {
      const dd = await get(h.drilldownHref);
      expect(dd.status, h.metric).toBe(200);
      expect(dd.body.metric).toBe(h.metric);
    }
  });

  it("a transformation with only a non-financial benefit: Value n/a, never 0; no line", async () => {
    const r = await get(
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${cxOnly.transformationId}`,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([r.body.lines, r.body.nonFinancialCount, r.body.pendingValidationCount]).toEqual([[], 1, 0]);
    const validated = (r.body.headlines as Body[]).find((h) => h.metric === "value.validated");
    expect(validated.value).toEqual({
      state: "not_applicable",
      value: null,
      unit: "currency",
      currency: null,
      reasonKey: "dashboard.value.no_financial_benefit",
    });
  });

  it("an owner filter keeps that owner's benefits and shows no net line (investment lines have no owner)", async () => {
    const r = await get(
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${xb.transformationId}&ownerUserId=${xb.users.bo.id}`,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(dec(lineOf(r.body, "gross", "planned").total.value)).toBe("1500");
    expect((r.body.lines as Body[]).some((l) => l.valueClass === "net")).toBe(false);
    const other = await get(
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${xb.transformationId}&ownerUserId=${xb.users.bo2.id}`,
    );
    expect([other.body.lines, other.body.pendingValidationCount]).toEqual([[], 0]);
  });
});

describe("Adoption dashboard (REQ-S13-001 adoption; ADR-0033)", () => {
  it("shows the People & adoption area, each indicator with its status, and the open interventions", async () => {
    const r = await get(
      `/api/v1/dashboards/adoption?organizationId=${w.orgA.id}&transformationId=${xk.transformationId}&transformationId=${xk2.transformationId}`,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.area.code).toBe("people_adoption");
    expect(r.body.area.sourceAreaEn).toBeTruthy();
    expect(r.body.area.areaAr).toBeTruthy();
    const ind = (kpi: string) => (r.body.indicators as Body[]).find((i) => i.kpiDefinitionId === kpi);
    expect(ind(xIndicatorKpi).value).toMatchObject({ state: "value" });
    expect(dec(ind(xIndicatorKpi).value.value)).toBe("130");
    // No actual: Unknown, never 0 and never green.
    expect([ind(xUnknownKpi).rag, ind(xUnknownKpi).value.state, ind(xUnknownKpi).value.value]).toEqual([
      "unknown",
      "unknown",
      null,
    ]);
    expect(r.body.area.rag.status).not.toBe("green");
    expect(r.body.openInterventionCount).toBe(1);
    for (const i of r.body.indicators as Body[]) {
      const d = await get(i.drilldownHref);
      expect([d.status, d.body.metric]).toEqual([200, "adoption.indicators"]);
    }
  });
});

describe("REQ-S13-001: a user scoped to X sees no Y record or figure on the Finance and adoption dashboards", () => {
  it("the organization-wide auditor sees Y (so the sweep can fail)", async () => {
    const auditor = await signIn(api.app, w.auditor.subject);
    const f = await get(`/api/v1/dashboards/finance?organizationId=${w.orgA.id}`, auditor);
    const a = await get(`/api/v1/dashboards/adoption?organizationId=${w.orgA.id}`, auditor);
    expect(leaks(f.body).length + leaks(a.body).length).toBeGreaterThan(0);
  });

  it("no tile, total or drill-down holds a Y record or figure", async () => {
    for (const path of ["/api/v1/dashboards/finance", "/api/v1/dashboards/adoption"]) {
      const r = await get(`${path}?organizationId=${w.orgA.id}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(leaks(r.body), path).toEqual([]);
      expect((r.body.transformations as Body[]).map((t) => t.transformationId).sort()).toEqual(
        [xb.transformationId, cxOnly.transformationId, xk.transformationId, xk2.transformationId].sort(),
      );
      const hrefs: string[] = [
        ...((r.body.headlines ?? r.body.area.headlines) as Body[]).map((h) => h.drilldownHref as string),
        ...((r.body.lines ?? []) as Body[])
          .map((l) => l.drilldownHref as string | null)
          .filter((h): h is string => h !== null),
        ...((r.body.indicators ?? []) as Body[]).map((i) => i.drilldownHref as string),
      ];
      expect(hrefs.length).toBeGreaterThan(0);
      for (const h of hrefs) {
        const d = await get(h);
        expect([d.status, leaks(d.body)], h).toEqual([200, []]);
      }
    }
  });

  it("an explicit Y transformation or an ungranted organization is 404; AUD reads, ADM-only is 404", async () => {
    for (const path of ["/api/v1/dashboards/finance", "/api/v1/dashboards/adoption"]) {
      expect((await get(`${path}?organizationId=${w.orgA.id}&transformationId=${yb.transformationId}`)).status).toBe(
        404,
      );
      expect((await get(`${path}?organizationId=${w.orgB.id}`)).status).toBe(404);
      const admin = await signIn(api.app, w.admin.subject);
      expect((await get(`${path}?organizationId=${w.orgA.id}`, admin)).status).toBe(404);
      const bad = await get(`${path}?organizationId=${w.orgA.id}&periodId=${w.orgA.id}`);
      expect([bad.status, bad.body.code]).toEqual([422, "dashboard.period_not_found"]);
    }
  });

  it("stores nothing: two reads give the same figures and no table changes", async () => {
    const count = async () =>
      Number(
        (
          await api.db
            .selectFrom("audit_event")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .executeTakeFirstOrThrow()
        ).n,
      );
    const before = await count();
    const a = await get(`/api/v1/dashboards/finance?organizationId=${w.orgA.id}`);
    const b = await get(`/api/v1/dashboards/finance?organizationId=${w.orgA.id}`);
    expect(a.body.lines).toEqual(b.body.lines);
    expect(await count()).toBe(before);
  });
});
