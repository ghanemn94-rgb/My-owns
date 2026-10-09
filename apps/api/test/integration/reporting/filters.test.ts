// Dashboard filters against a real PostgreSQL (T-DG4-KBE-G; ADR-0037 §4; REQ-S13-002 "filtering by period Q1 changes
// all tiles to Q1 values"): the period filter changes EVERY area (KPI statuses of the period, value lines inside the
// window, decisions and dependencies due inside it, milestones against the as-of date), the owner filter keeps the
// owner's rows, the filters are echoed in appliedFilters, and an unknown period or owner is the exact 422.
// All data is synthetic; the Finance validation and trajectory approvals are synthetic business approvals of test data.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";
import {
  acceptedActual,
  adoptionLink,
  areaOf,
  askDue,
  benefitWorldIn,
  dashboardWorld,
  launchedInitiative,
  openDependency,
  openPeriod,
  outcomeKpi,
  plannedMilestone,
  riyadhToday,
  trajectoryKpi,
  validatedBenefit,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let b: BenefitWorld;
let q1: { id: string };
let initiative: string;

const overview = (query = "") =>
  call<Body>(api.app, "GET", `/api/v1/overview?organizationId=${w.orgA.id}${query}`, { session: k.s.auditor });

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await dashboardWorld(api, w);
  const { today } = await riyadhToday(api);
  await openPeriod(api, w, "monthly", "2026-01", "2026-01-01", "2026-01-31");
  await openPeriod(api, w, "monthly", "2026-02", "2026-02-01", "2026-02-28");
  const mar = await openPeriod(api, w, "monthly", "2026-03", "2026-03-01", "2026-03-31");
  const apr = await openPeriod(api, w, "monthly", "2026-04", "2026-04-01", "2026-04-30");
  q1 = await openPeriod(api, w, "quarterly", "2026-Q1", "2026-01-01", "2026-03-31");
  // Outcomes and adoption: the March and April actuals differ.
  const kpi = await trajectoryKpi(api, k);
  await outcomeKpi(api.db, k, k.outcomeId, kpi.id, w.orgA.id);
  await acceptedActual(api, k, kpi.id, mar.id, "150", today);
  await acceptedActual(api, k, kpi.id, apr.id, "50", today);
  const indicator = await trajectoryKpi(api, k);
  await adoptionLink(api.db, k, w.orgA.id, indicator.id);
  await acceptedActual(api, k, indicator.id, mar.id, "140", today);
  await acceptedActual(api, k, indicator.id, apr.id, "60", today);
  // Portfolio: a milestone approved for 2026-05-01 is overdue today, not at the end of Q1.
  initiative = await launchedInitiative(api.db, k, w.orgA.id, "INI-01");
  await plannedMilestone(api.db, k, w.orgA.id, initiative, "2026-05-01");
  // Dependencies and decisions: one due inside Q1, one after it.
  await openDependency(api.db, k, w.orgA.id, "DEP-01", "2026-02-15");
  await openDependency(api.db, k, w.orgA.id, "DEP-02", "2026-08-01");
  await askDue(api, k, "2026-02-20");
  await askDue(api, k, "2026-08-20");
  // Value: planned 1000 in February and 2000 in June; 900 validated in February.
  b = await benefitWorldIn(api, w, w.a1);
  await validatedBenefit(
    api,
    b,
    [
      { amount: "1000", start: "2026-02-01", end: "2026-02-28" },
      { amount: "2000", start: "2026-06-01", end: "2026-06-30" },
    ],
    { amount: "900", start: "2026-02-01", end: "2026-02-28" },
  );
}, 240_000);
afterAll(() => api.close());

/** The figures of an area (statuses, headline values, item values and ids), compared across filters. */
const figures = (area: Body) =>
  JSON.stringify({
    rag: area.rag.status,
    headlines: area.headlines.map((h: Body) => [h.metric, h.value]),
    items: area.items.map((i: Body) => [i.recordId, i.rag, i.value]),
  });

describe("REQ-S13-002: period Q1 changes every area to its Q1 values", () => {
  it("all six areas differ between no period and Q1, each to the Q1 figure", async () => {
    const all = await overview();
    const q = await overview(`&periodId=${q1.id}`);
    expect([all.status, q.status], JSON.stringify(q.body)).toEqual([200, 200]);
    for (const code of ["outcomes", "value", "portfolio", "dependencies", "decisions", "people_adoption"])
      expect(figures(areaOf(q.body, code)), code).not.toEqual(figures(areaOf(all.body, code)));

    expect(q.body.appliedFilters).toMatchObject({
      periodId: q1.id,
      periodLabel: "2026-Q1",
      windowStart: "2026-01-01",
      windowEnd: "2026-03-31",
      asOf: "2026-03-31",
    });
    const value = (body: Body, area: string, recordType: string) =>
      areaOf(body, area).items.find((i: Body) => i.recordType === recordType)?.value?.value;
    // Outcomes and adoption: the latest monthly period of the window (March) instead of the current one (April).
    expect([value(all.body, "outcomes", "outcome_kpi"), value(q.body, "outcomes", "outcome_kpi")]).toEqual([
      "50",
      "150",
    ]);
    expect([
      value(all.body, "people_adoption", "adoption_metric_link"),
      value(q.body, "people_adoption", "adoption_metric_link"),
    ]).toEqual(["60", "140"]);
    // Value: planned to date 3000 vs 1000 in Q1; validated 900 in both; the gap 0.7 (red) vs 0.1 (amber).
    const head = (body: Body, metric: string) =>
      areaOf(body, "value").headlines.find((h: Body) => h.metric === metric).value.value;
    expect([head(all.body, "value.planned"), head(q.body, "value.planned")]).toEqual(["3000", "1000"]);
    expect([head(all.body, "value.validated"), head(q.body, "value.validated")]).toEqual(["900", "900"]);
    expect([head(all.body, "value.gap"), head(q.body, "value.gap")]).toEqual(["0.7", "0.1"]);
    expect([areaOf(all.body, "value").rag.status, areaOf(q.body, "value").rag.status]).toEqual(["red", "amber"]);
    // Portfolio: the milestone is overdue against today, not against the end of Q1.
    const ini = (body: Body) => areaOf(body, "portfolio").items.find((i: Body) => i.recordId === initiative);
    expect(ini(all.body).flags).toContain("milestone_red");
    expect(ini(q.body).flags).toContain("milestone_green");
    // Dependencies and decisions: only those due inside the window.
    const count = (body: Body, area: string) => areaOf(body, area).headlines[0].value.value;
    expect([count(all.body, "dependencies"), count(q.body, "dependencies")]).toEqual(["2", "1"]);
    expect([count(all.body, "decisions"), count(q.body, "decisions")]).toEqual(["2", "1"]);
    // The same filter applies to the transformation dashboard and to every drill-down.
    const t = await call<Body>(api.app, "GET", `${k.base}/dashboard?periodId=${q1.id}`, { session: k.s.auditor });
    expect(figures(areaOf(t.body, "outcomes"))).toEqual(figures(areaOf(q.body, "outcomes")));
    const href = areaOf(q.body, "dependencies").headlines[0].drilldownHref;
    expect(href).toContain(`periodId=${q1.id}`);
    const d = await call<Body>(api.app, "GET", href, { session: k.s.auditor });
    expect(d.body.items).toHaveLength(1);
  });

  it("the owner filter keeps the owner's rows; phase and status filters narrow the transformations", async () => {
    const res = await overview(`&ownerUserId=${k.users.bo.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.appliedFilters.ownerUserId).toBe(k.users.bo.id);
    // BO is the initiative's executive owner and the asks' owner; no outcome or dependency is BO's.
    expect(areaOf(res.body, "portfolio").items.map((i: Body) => i.recordId)).toEqual([initiative]);
    expect(areaOf(res.body, "decisions").items).toHaveLength(2);
    expect(areaOf(res.body, "dependencies").items).toHaveLength(0);
    expect(areaOf(res.body, "outcomes").rag).toMatchObject({
      status: "unknown",
      ruleKey: "dashboard.rag.outcomes.none",
    });
    const closed = await overview("&status=closed");
    expect([closed.body.transformationCount, closed.body.appliedFilters.status]).toEqual([0, "closed"]);
    const phase = await overview("&phase=diagnose");
    expect(phase.body.transformationCount).toBe(2);
  });

  it("an unknown period or owner is 422 with the exact ADR-0037 §13 texts; a bad enum is 400", async () => {
    const p = await overview(`&periodId=${k.transformationId}`);
    expect([p.status, p.body.code, p.body.detail, p.body.errors[0].pointer]).toEqual([
      422,
      "dashboard.period_not_found",
      "The reporting period does not exist in this organization.",
      "/periodId",
    ]);
    const o = await overview(`&ownerUserId=${w.officeB.id}`);
    expect([o.status, o.body.code, o.body.detail]).toEqual([
      422,
      "dashboard.owner_not_found",
      "The owner is not a user of this organization.",
    ]);
    expect((await overview("&status=nonsense")).status).toBe(400);
  });
});
