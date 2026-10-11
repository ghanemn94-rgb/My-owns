// T-DG4-KBE-R8 (D-124 items 1-3, D-125; ADR-0037 amendment N5), on the real API and a disposable PostgreSQL:
//  - D-124 item 1: an outcome created THROUGH THE API (draft; no API sets an outcome `active`), with its KPI link and an
//    accepted actual also created through the API, is shown by the T10 Outcomes area, the Executive Overview and the
//    outcomes drill-downs (`outcomes.area`, `outcomes.kpi_status`); once archived (through the API) it is not shown.
//    No outcome row or outcome status is written directly to the database in this file.
//  - D-124 items 2-3 (N5): every KPI-derived DashboardValue carries `kpiUnit = {kind, label}` with `unit` unchanged
//    (ARCH-R7 handback §4.3 fixtures F1-F4: a `percentage` KPI with no label, the label '% of users', a `ratio` KPI 1.5,
//    and the value gap with `kpiUnit` null); Stale and Unknown KPI values keep their `kpiUnit`; money, counts and the
//    computed ratio carry `kpiUnit: null`; every DashboardValue of every dashboard operation carries the key.
// All data is SYNTHETIC. A trajectory approval here would be a synthetic in-product approval of test data; nothing here
// grants a business, Finance or IT approval, and nothing reads or writes the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createTransformationRow,
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
import { ensureDefaultCalendar } from "../approvals/approval-world.ts";
import { measuredBenefit } from "../benefits/value-fixtures.ts";
import {
  adoptionLink,
  areaOf,
  benefitWorldIn,
  launchedInitiative,
  openPeriod,
  planValue,
  riyadhToday,
  type Body,
} from "../contract/p4-exercises-kbe-g.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { DIRECT_FLOW, ownedKpi, runRecalculation, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let today: string;
let april: { id: string };
/** The outcome under test, created through the API (status `draft`, the API's only non-archived status). */
let outcomeId: string;
/** An outcome created through the API, linked, then archived through the API: never shown. */
let archivedOutcomeId: string;
let archivedOutcomeKpiId: string;
const ok: Record<"pct" | "pctLabel" | "ratio" | "stale" | "unknown", string> = {
  pct: "",
  pctLabel: "",
  ratio: "",
  stale: "",
  unknown: "",
};
const kpi: Record<keyof typeof ok, string> = { pct: "", pctLabel: "", ratio: "", stale: "", unknown: "" };

/** The KPI world of the dashboard tests WITHOUT the directly inserted outcome of `dashboardWorld`. */
async function apiOnlyWorld(): Promise<KpiWorld> {
  await ensureDefaultCalendar(api, w, (m, u, o) => call(api.app, m, u, o));
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const mk = async (...roles: string[]) => {
    const u = await createUser(api.db, w.orgA.id);
    for (const role of roles) await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
    return u;
  };
  const users = {
    tl: await mk("TL"),
    kds: await mk("KDS"),
    fin: await mk("FIN"),
    finKds: await mk("FIN", "KDS"),
    finTl: await mk("FIN", "TL"),
    sp: await mk("SP"),
    bo: await mk("BO"),
    to: w.office,
    auditor: w.auditor,
    outsider: w.officeB,
    nobody: w.nobody,
  };
  const s = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([n, u]) => [n, await signIn(api.app, u.subject)] as const)),
  ) as Record<keyof typeof users, Session>;
  // The T10 area seed of the transformation (as dashboardWorld; this writes no outcome).
  const { sql } = await import("@mth/db");
  await sql`SELECT p4_instantiate_transformation(${transformationId}::uuid, ${users.tl.id}::uuid, 'test:kbe-r8-world', 'api')`.execute(
    api.db,
  );
  return {
    transformationId,
    outcomeId: "",
    archivedOutcomeId: "",
    users,
    s,
    base: `/api/v1/transformations/${transformationId}`,
  };
}

/** An outcome created through the outcome register (TL holds outcome.edit). */
async function apiOutcome(statement: string): Promise<{ id: string; version: number; status: string }> {
  const r = await call<Body>(api.app, "POST", `${k.base}/outcomes`, {
    session: k.s.tl,
    body: { statement, ownerUserId: k.users.tl.id },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id, version: r.body.version, status: r.body.status };
}

/** An Outcome & KPI Tree row created through the API (POST outcome-kpis). */
async function apiOutcomeKpi(outcome: string, kpiDefinitionId: string): Promise<string> {
  const r = await call<Body>(api.app, "POST", `${k.base}/outcome-kpis`, {
    session: k.s.tl,
    body: { outcomeId: outcome, kpiDefinitionId, targetDate: "2026-12-31" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

/** An accepted actual (direct-accept route, through the API), recalculated by the worker's consumer. */
async function apiActual(kpiId: string, value: string, dataAsOf: string): Promise<string> {
  const r = await submitActual(api, k, kpiId, { reportingPeriodId: april.id, value, dataAsOf });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  await runRecalculation(api, r.body.actual.id);
  return r.body.actual.id as string;
}

const get = async (url: string): Promise<Body> => {
  const r = await call<Body>(api.app, "GET", url, { session: k.s.auditor });
  expect(r.status, `${url} ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};
const overviewUrl = () => `/api/v1/overview?organizationId=${w.orgA.id}&transformationId=${k.transformationId}`;
const kpiStatusDrill = (subjectId: string) =>
  `/api/v1/dashboard-drilldown?metric=outcomes.kpi_status&organizationId=${w.orgA.id}&subjectId=${subjectId}`;
const itemOf = (area: Body, recordId: string): Body | undefined =>
  (area.items as Body[]).find((i) => i.recordId === recordId);

/** Every DashboardValue in a response body (an object with the five §5 members). */
function dashboardValues(body: unknown, out: Body[] = []): Body[] {
  if (Array.isArray(body)) for (const x of body) dashboardValues(x, out);
  else if (body !== null && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (["state", "value", "unit", "currency", "reasonKey"].every((m) => m in o)) out.push(o);
    for (const v of Object.values(o)) dashboardValues(v, out);
  }
  return out;
}
/** N5 classification: a value with `kpiUnit` null is money, the computed ratio, a count, or carries no unit. */
const NON_KPI_UNITS = new Set([
  "currency",
  "ratio",
  "outcome_kpi",
  "initiative",
  "working_day",
  "dependency",
  "decision",
  "indicator",
  "measurement",
]);
function expectEveryValueClassified(body: unknown, where: string) {
  const values = dashboardValues(body);
  expect(values.length, `${where}: no DashboardValue found`).toBeGreaterThan(0);
  for (const v of values) {
    expect(Object.hasOwn(v, "kpiUnit"), `${where}: ${JSON.stringify(v)}`).toBe(true);
    if (v.kpiUnit === null)
      expect(v.unit === null || NON_KPI_UNITS.has(v.unit), `${where}: ${JSON.stringify(v)}`).toBe(true);
    else expect(Object.keys(v.kpiUnit).sort(), `${where}: ${JSON.stringify(v)}`).toEqual(["kind", "label"]);
  }
}

// The ARCH-R7 handback §4.3 fixtures, exactly (F1-F3 KPI-derived; F4 below is the computed value gap).
const F1 = {
  state: "value",
  value: "0.12",
  unit: "percentage",
  currency: null,
  reasonKey: null,
  kpiUnit: { kind: "percentage", label: null },
};
const F2 = {
  state: "value",
  value: "0.12",
  unit: "% of users",
  currency: null,
  reasonKey: null,
  kpiUnit: { kind: "percentage", label: "% of users" },
};
const F3 = {
  state: "value",
  value: "1.5",
  unit: "ratio",
  currency: null,
  reasonKey: null,
  kpiUnit: { kind: "ratio", label: null },
};
const STALE = {
  state: "stale",
  value: "0.12",
  unit: "% of users",
  currency: null,
  reasonKey: "kpi.stale",
  kpiUnit: { kind: "percentage", label: "% of users" },
};
const UNKNOWN = {
  state: "unknown",
  value: null,
  unit: "ratio",
  currency: null,
  reasonKey: "kpi.no_accepted_actual",
  kpiUnit: { kind: "ratio", label: null },
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await apiOnlyWorld();
  ({ today } = await riyadhToday(api));
  april = await openPeriod(api, w, "monthly", "2026-04", "2026-04-01", "2026-04-30");
  const own = async (unitKind: string, unitLabel: string | null) =>
    (await ownedKpi(api, k, DIRECT_FLOW, { unitKind, unitLabel })).id;
  kpi.pct = await own("percentage", null);
  kpi.pctLabel = await own("percentage", "% of users");
  kpi.ratio = await own("ratio", null);
  kpi.stale = await own("percentage", "% of users");
  kpi.unknown = await own("ratio", null);

  const o = await apiOutcome("Raise the self-service share (synthetic, D-124 item 1)");
  // The API creates a draft outcome and has no transition to `active` (D-124 item 1).
  expect(o.status).toBe("draft");
  outcomeId = o.id;
  for (const key of Object.keys(ok) as (keyof typeof ok)[]) ok[key] = await apiOutcomeKpi(outcomeId, kpi[key]);
  await apiActual(kpi.pct, "0.12", today);
  await apiActual(kpi.pctLabel, "0.12", today);
  await apiActual(kpi.ratio, "1.5", today);
  await apiActual(kpi.stale, "0.12", "2020-01-01");

  // A second API outcome, linked to the same percentage KPI, then archived through the API.
  const gone = await apiOutcome("An archived outcome (synthetic, D-124 item 1)");
  archivedOutcomeId = gone.id;
  archivedOutcomeKpiId = await apiOutcomeKpi(archivedOutcomeId, kpi.pct);
  const cur = await call<Body>(api.app, "GET", `${k.base}/outcomes/${archivedOutcomeId}`, { session: k.s.tl });
  const archived = await call<Body>(api.app, "POST", `${k.base}/outcomes/${archivedOutcomeId}/archive`, {
    session: k.s.tl,
    headers: ifm(cur.body.version),
    body: { reason: "Synthetic: replaced by the outcome under test" },
  });
  expect(archived.status, JSON.stringify(archived.body)).toBe(200);
  expect(archived.body.status).toBe("archived");
  // No outcome row in this transformation was written outside the API: both rows carry the API's audit events.
  const created = await api.db
    .selectFrom("audit_event")
    .select(["record_id", "action"])
    .where("record_type", "=", "outcome")
    .where("transformation_id", "=", k.transformationId)
    .orderBy("occurred_at")
    .execute();
  expect(created.filter((e) => e.action === "outcome.create").map((e) => e.record_id)).toEqual([
    outcomeId,
    archivedOutcomeId,
  ]);
}, 240_000);
afterAll(() => api?.close());

describe("D-124 item 1: an outcome created through the API is shown on the dashboards; an archived one is not", () => {
  it("the T10 Outcomes area lists the outcome and its KPI links with their actuals; the archived outcome is absent", async () => {
    const t10 = await get(`${k.base}/dashboard`);
    const area = areaOf(t10, "outcomes");
    const ids = (area.items as Body[]).map((i) => i.recordId);
    expect(ids).toContain(outcomeId);
    for (const id of Object.values(ok)) expect(ids).toContain(id);
    expect(ids).not.toContain(archivedOutcomeId);
    expect(ids).not.toContain(archivedOutcomeKpiId);
    expect(itemOf(area, outcomeId)).toMatchObject({ recordType: "outcome", ownerUserId: k.users.tl.id });
    expect(itemOf(area, ok.pct)!.value).toMatchObject({ state: "value", value: "0.12" });
    // The count headline counts the five live outcome KPI rows, not the archived outcome's.
    expect(area.headlines.find((h: Body) => h.metric === "outcomes.area").value).toMatchObject({
      state: "value",
      value: "5",
      unit: "outcome_kpi",
    });
  });

  it("the Executive Overview shows it, and the outcomes drill-downs list it", async () => {
    const overview = await get(overviewUrl());
    const area = areaOf(overview, "outcomes");
    const ids = (area.items as Body[]).map((i) => i.recordId);
    expect(ids).toContain(outcomeId);
    expect(ids).toContain(ok.ratio);
    expect(ids).not.toContain(archivedOutcomeId);
    expect(itemOf(area, ok.ratio)!.value).toMatchObject({ state: "value", value: "1.5" });

    const t10 = await get(`${k.base}/dashboard`);
    const href = areaOf(t10, "outcomes").headlines.find((h: Body) => h.metric === "outcomes.area").drilldownHref;
    const drill = await get(href);
    expect(drill.metric).toBe("outcomes.area");
    const drillIds = (drill.items as Body[]).map((i) => i.recordId);
    for (const id of Object.values(ok)) expect(drillIds).toContain(id);
    expect(drillIds).not.toContain(archivedOutcomeKpiId);

    const kpiDrill = await get(kpiStatusDrill(ok.pctLabel));
    expect(kpiDrill.value).toMatchObject({ state: "value", value: "0.12" });
  });
});

describe("D-124 items 2-3 (ADR-0037 N5): a KPI-derived dashboard value says its unit kind apart from its label", () => {
  it("F1-F3 on the T10 Outcomes items, the workstream-less Executive Overview and the outcomes.area drill-down", async () => {
    for (const body of [await get(`${k.base}/dashboard`), await get(overviewUrl())]) {
      const area = areaOf(body, "outcomes");
      expect(itemOf(area, ok.pct)!.value).toStrictEqual(F1);
      expect(itemOf(area, ok.pctLabel)!.value).toStrictEqual(F2);
      expect(itemOf(area, ok.ratio)!.value).toStrictEqual(F3);
      // The outcome rows themselves carry no value; the count headline is a count with kpiUnit null.
      expect(area.headlines[0].value).toMatchObject({ unit: "outcome_kpi", kpiUnit: null });
    }
    const t10 = await get(`${k.base}/dashboard`);
    const drill = await get(
      areaOf(t10, "outcomes").headlines.find((h: Body) => h.metric === "outcomes.area").drilldownHref,
    );
    expect(drill.value).toMatchObject({ unit: "outcome_kpi", kpiUnit: null });
    const byId = (id: string) => (drill.items as Body[]).find((i) => i.recordId === id)!.value;
    expect(byId(ok.pct)).toStrictEqual(F1);
    expect(byId(ok.pctLabel)).toStrictEqual(F2);
    expect(byId(ok.ratio)).toStrictEqual(F3);
  });

  it("the outcomes.kpi_status drill-down: its value, the kpi_actual item and the `actual` input carry the kpiUnit", async () => {
    for (const [id, fixture] of [
      [ok.pct, F1],
      [ok.pctLabel, F2],
      [ok.ratio, F3],
    ] as const) {
      const d = await get(kpiStatusDrill(id));
      expect(d.value).toStrictEqual(fixture);
      const actualItem = (d.items as Body[]).find((i) => i.recordType === "kpi_actual");
      expect(actualItem?.value).toStrictEqual(fixture);
      const input = (d.calculation.inputs as Body[]).find((i) => i.name === "actual");
      expect(input?.value).toStrictEqual(fixture);
      expectEveryValueClassified(d, `outcomes.kpi_status ${id}`);
    }
  });

  it("a Stale and an Unknown KPI value keep their kpiUnit (state, value and reason unchanged)", async () => {
    const area = areaOf(await get(`${k.base}/dashboard`), "outcomes");
    expect(itemOf(area, ok.stale)!.value).toStrictEqual(STALE);
    expect(itemOf(area, ok.unknown)!.value).toStrictEqual(UNKNOWN);
    expect((await get(kpiStatusDrill(ok.stale))).value).toStrictEqual(STALE);
    expect((await get(kpiStatusDrill(ok.unknown))).value).toStrictEqual(UNKNOWN);
  });

  it("the adoption dashboard's AdoptionIndicatorRow.value carries the KPI's kpiUnit", async () => {
    await adoptionLink(api.db, k, w.orgA.id, kpi.pctLabel);
    const a = await get(
      `/api/v1/dashboards/adoption?organizationId=${w.orgA.id}&transformationId=${k.transformationId}`,
    );
    const row = (a.indicators as Body[]).find((i) => i.kpiDefinitionId === kpi.pctLabel);
    expect(row?.value).toStrictEqual(F2);
    expectEveryValueClassified(a, "getAdoptionDashboard");
    const t10 = areaOf(await get(`${k.base}/dashboard`), "people_adoption");
    const link = (t10.items as Body[]).find((i) => i.recordType === "adoption_metric_link");
    expect(link?.value).toStrictEqual(F2);
  });

  it("F4: the value gap (planned 70, nothing validated) is the computed ratio 1 with kpiUnit null; money and counts are null", async () => {
    const b = await benefitWorldIn(api, w, w.a1);
    const m = await measuredBenefit(api, b, { extra: { valueClass: "margin_uplift" } });
    await planValue(api, b, m.id, "70", "2026-01-01", "2026-06-30");
    const t10 = await call<Body>(api.app, "GET", `${b.base}/dashboard`, { session: b.s.auditor });
    expect(t10.status, JSON.stringify(t10.body)).toBe(200);
    const value = areaOf(t10.body, "value");
    const gap = (value.headlines as Body[]).find((h) => h.metric === "value.gap");
    expect(gap?.value).toStrictEqual({
      state: "value",
      value: "1",
      unit: "ratio",
      currency: "SAR",
      reasonKey: null,
      kpiUnit: null,
    });
    const gapDrill = await call<Body>(api.app, "GET", gap!.drilldownHref, { session: b.s.auditor });
    expect(gapDrill.status, JSON.stringify(gapDrill.body)).toBe(200);
    expect(gapDrill.body.value).toMatchObject({ value: "1", unit: "ratio", kpiUnit: null });
    // Every money headline of the Value area is money with kpiUnit null.
    for (const h of value.headlines as Body[])
      if (h.metric !== "value.gap") expect(h.value).toMatchObject({ unit: "currency", kpiUnit: null });
    const finance = await call<Body>(
      api.app,
      "GET",
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${b.transformationId}`,
      { session: b.s.auditor },
    );
    expect(finance.status, JSON.stringify(finance.body)).toBe(200);
    expectEveryValueClassified(finance.body, "getFinanceDashboard");
    for (const v of dashboardValues(finance.body)) expect(v.kpiUnit).toBeNull();
    // The workspace header's benefits (CurrencyValue.value) are money: kpiUnit null.
    const header = await call<Body>(api.app, "GET", `${b.base}/summary`, { session: b.s.auditor });
    expect(header.status, JSON.stringify(header.body)).toBe(200);
    expectEveryValueClassified(header.body, "getWorkspaceHeader");
    for (const v of dashboardValues(header.body)) expect(v.kpiUnit).toBeNull();
  });

  it("a Portfolio item and the count headlines carry kpiUnit null", async () => {
    const ini = await launchedInitiative(api.db, k, w.orgA.id, "INI-88");
    const t10 = await get(`${k.base}/dashboard`);
    const portfolio = areaOf(t10, "portfolio");
    expect(itemOf(portfolio, ini)).toBeDefined();
    for (const v of dashboardValues(portfolio)) expect(v.kpiUnit).toBeNull();
    for (const code of ["dependencies", "decisions"])
      for (const h of areaOf(t10, code).headlines as Body[]) expect(h.value.kpiUnit).toBeNull();
  });

  it("every DashboardValue of every dashboard operation carries the kpiUnit key, classified as N5 states", async () => {
    const bodies: [string, unknown][] = [
      ["getTransformationDashboard", await get(`${k.base}/dashboard`)],
      ["getExecutiveOverview", await get(overviewUrl())],
      ["getDashboardDrilldown outcomes.kpi_status", await get(kpiStatusDrill(ok.pct))],
    ];
    for (const [where, body] of bodies) expectEveryValueClassified(body, where);
  });
});
