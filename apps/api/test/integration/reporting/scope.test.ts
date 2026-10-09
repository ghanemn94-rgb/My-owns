// Scope enforcement of the dashboards against a real PostgreSQL (T-DG4-KBE-G; ADR-0037 §6; REQ-S13-001 "a user scoped
// to transformation X opens each of the six dashboards and no tile, total or drill-down contains a transformation Y
// record or figure"; KBE-G's half: the executive, transformation and workstream dashboards and every drill-down metric):
//  - X (BU a1) and Y (BU a2) both hold non-zero figures (KPI actuals, validated value, decisions, dependencies,
//    initiatives, an adoption indicator); users granted at X only see X: no Y id, code or figure appears anywhere;
//  - an explicit Y transformation, a Y workstream or an organization without a grant is 404 (never 403, never an
//    empty 200); a technical-admin-only caller gets 404 on the transformation dashboards.
// All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DASHBOARD_METRICS } from "@mth/shared/schemas";
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
import {
  acceptedActual,
  adoptionLink,
  askDue,
  benefitWorldIn,
  dashboardWorld,
  launchedInitiative,
  openDependency,
  openPeriod,
  outcomeKpi,
  riyadhToday,
  trajectoryKpi,
  validatedBenefit,
  workstreamOf,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";

let api: TestApi;
let w: World;
let x: KpiWorld;
let y: KpiWorld;
let yb: BenefitWorld;
let xWorkstream: string;
let yWorkstream: string;
/** Every id, code and figure of transformation Y that must never appear in an X-scoped response. */
const yMarks: string[] = [];
let xUser: Session;

async function populate(k: KpiWorld, period: { id: string }, today: string, actual: string, code: string) {
  const kpi = await trajectoryKpi(api, k);
  const ok = await outcomeKpi(api.db, k, k.outcomeId, kpi.id, w.orgA.id);
  const actualId = await acceptedActual(api, k, kpi.id, period.id, actual, today);
  const indicator = await trajectoryKpi(api, k);
  const link = await adoptionLink(api.db, k, w.orgA.id, indicator.id);
  const ini = await launchedInitiative(api.db, k, w.orgA.id, code);
  const dep = await openDependency(api.db, k, w.orgA.id, "DEP-01", "2026-12-01", { toInitiativeId: ini });
  const ask = await askDue(api, k, "2026-12-01");
  const ws = await workstreamOf(api.db, k, w.orgA.id, [ini]);
  return { ids: [k.transformationId, k.outcomeId, ok, kpi.id, actualId, link, ini, dep, ask.id, ws], ws };
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const { today } = await riyadhToday(api);
  const april = await openPeriod(api, w, "monthly", "2026-04", "2026-04-01", "2026-04-30");
  x = await dashboardWorld(api, w, w.a1);
  y = await dashboardWorld(api, w, w.a2);
  xWorkstream = (await populate(x, april, today, "41", "INI-01")).ws;
  const yData = await populate(y, april, today, "987654.321", "INI-99");
  yWorkstream = yData.ws;
  yMarks.push(...yData.ids, "987654.321", "INI-99");
  // Y also holds validated value (a benefit world in BU a2).
  yb = await benefitWorldIn(api, w, w.a2);
  const v = await validatedBenefit(api, yb, [{ amount: "55555.5", start: "2026-02-01", end: "2026-02-28" }], {
    amount: "44444.4",
    start: "2026-02-01",
    end: "2026-02-28",
  });
  yMarks.push(yb.transformationId, v.benefitId, v.code, "55555.5", "44444.4");
  // A user granted only at transformation X (TL there; the transformation-scoped grant of REQ-S13-001).
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: x.transformationId }, w.orgA.id);
  xUser = await signIn(api.app, u.subject);
}, 300_000);
afterAll(() => api.close());

const get = (url: string, session: Session = xUser) => call<Body>(api.app, "GET", url, { session });
const leaks = (body: unknown) => {
  const text = JSON.stringify(body);
  return yMarks.filter((m) => text.includes(m));
};

describe("REQ-S13-001: a user scoped to X sees no Y record or figure", () => {
  it("the executive overview, X's transformation and workstream dashboards hold X only", async () => {
    // Sanity: the organization-wide auditor sees Y's figures (so the sweep below can fail).
    const all = await get(`/api/v1/overview?organizationId=${w.orgA.id}`, x.s.auditor);
    expect(all.body.transformationCount).toBe(3);
    expect(leaks(all.body).length).toBeGreaterThan(0);

    const ov = await get(`/api/v1/overview?organizationId=${w.orgA.id}`);
    expect(ov.status, JSON.stringify(ov.body)).toBe(200);
    expect([ov.body.transformationCount, ov.body.transformations.map((t: Body) => t.transformationId)]).toEqual([
      1,
      [x.transformationId],
    ]);
    expect(leaks(ov.body)).toEqual([]);
    const t = await get(`${x.base}/dashboard`);
    expect([t.status, leaks(t.body)]).toEqual([200, []]);
    const ws = await get(`${x.base}/workstreams/${xWorkstream}/dashboard`);
    expect([ws.status, leaks(ws.body)]).toEqual([200, []]);
  });

  it("every drill-down metric and every headline href holds X only", async () => {
    for (const metric of DASHBOARD_METRICS) {
      if (metric === "outcomes.kpi_status") continue; // per record: covered below
      const d = await get(`/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${w.orgA.id}`);
      expect(d.status, `${metric}: ${JSON.stringify(d.body)}`).toBe(200);
      expect(leaks(d.body), metric).toEqual([]);
    }
    const ov = await get(`/api/v1/overview?organizationId=${w.orgA.id}`);
    for (const area of ov.body.areas)
      for (const h of area.headlines) {
        const d = await get(h.drilldownHref);
        expect([d.status, leaks(d.body)], h.metric).toEqual([200, []]);
      }
  });

  it("an explicit Y transformation, Y workstream, Y record subject or ungranted organization is 404", async () => {
    expect(
      (await get(`/api/v1/overview?organizationId=${w.orgA.id}&transformationId=${y.transformationId}`)).status,
    ).toBe(404);
    expect((await get(`/api/v1/overview?organizationId=${w.orgB.id}`)).status).toBe(404);
    expect((await get(`${y.base}/dashboard`)).status).toBe(404);
    expect((await get(`${y.base}/workstreams/${yWorkstream}/dashboard`)).status).toBe(404);
    expect((await get(`${x.base}/workstreams/${yWorkstream}/dashboard`)).status).toBe(404);
    const yOk = yMarks[2]!;
    const d = await get(
      `/api/v1/dashboard-drilldown?metric=outcomes.kpi_status&organizationId=${w.orgA.id}&subjectId=${yOk}`,
    );
    expect(d.status).toBe(404);
    expect(
      (
        await get(
          `/api/v1/dashboard-drilldown?metric=decisions.open&organizationId=${w.orgA.id}&transformationId=${y.transformationId}`,
        )
      ).status,
    ).toBe(404);
    // A technical-admin-only caller holds no transformation.read: 404 on the transformation dashboard and overview.
    const admin = await signIn(api.app, w.admin.subject);
    expect((await get(`${x.base}/dashboard`, admin)).status).toBe(404);
    expect((await get(`/api/v1/overview?organizationId=${w.orgA.id}`, admin)).status).toBe(404);
  });
});
