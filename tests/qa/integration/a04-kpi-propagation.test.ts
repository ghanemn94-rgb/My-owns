// A04 "KPI propagation" (master prompt §20): "Submit a period actual; validate and accept it; linked
// dashboards/RAG/calculations update once; benefit needing Finance review remains pending."
//
// End-to-end acceptance suite (qa-verifier, T-DG4-QA-A): the REAL API (Fastify inject; every response validated against
// docs/api/openapi.yaml), the REAL worker (outbox relay loop + pg-boss + every production domain handler, started with
// startWorker exactly as apps/worker/src/main.ts does) and a REAL PostgreSQL. The file uses its own freshly migrated
// scratch database (pg-boss queue state is global), so nothing else's outbox rows are on its relay.
// Synthetic transformation X: an outcome linked to a KPI (approved trajectory) and a benefit at Measure that needs
// Finance validation and is measured by that KPI. Transformation Y (same organization) holds records that a user scoped
// to X must never see. All data is SYNTHETIC; the trajectory and Finance approvals are synthetic in-product approvals.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../packages/db/test/helpers.ts";
import { createBoss, ensureQueues, startWorker, type RunningWorker } from "../../../apps/worker/src/index.ts";
import {
  adoptionLink,
  askDue,
  openDependency,
  plannedMilestone,
} from "../../../apps/api/test/integration/contract/p4-exercises-kbe-g.ts";
import { auditOf, call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import {
  activeOutcome,
  actualAction,
  approvedTrajectory,
  asBenefitWorld,
  canon,
  dashboardWorld,
  DIRECT_FLOW,
  get200,
  launchedInitiative,
  mapPartyTo,
  measuredBenefit,
  openPeriod,
  outcomeKpi,
  ownedKpi,
  REVIEW_FLOW,
  revenueFormula,
  riyadhToday,
  seedWorld,
  submitActual,
  waitFor,
  workstreamOf,
  type Body,
  type BenefitWorld,
  type KpiWorld,
  type World,
} from "../support/p4.ts";

let dbName: string;
let api: TestApi;
let boss: ReturnType<typeof createBoss>;
let worker: RunningWorker;
let w: World;
let x: KpiWorld;
let y: KpiWorld;
let today: string;
type Period = { id: string; label: string; start: string; end: string };
let current: Period;
let mar: Period;
let q1: Period;
/** X: the KPI linked to the outcome and to the benefit; its outcome KPI row; the benefit (B0087 revenue formula). */
let kpi: { id: string };
let okRow: string;
let bx: BenefitWorld;
let benefit: { id: string };
/** A second outcome KPI of X whose KPI never gets an actual. */
let okNoData: string;
let wsX: string;
let wsY: string;
let yIds: string[];

const quiet = { info: () => undefined, error: () => undefined };

beforeAll(async () => {
  const { adminUrl } = testDatabase();
  dbName = await createScratchDatabase(adminUrl, "mth_qa_a04");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  const appUrl = roleUrl(adminUrl, dbName, "mth_app");
  api = await startApi({ database: dbName });
  boss = createBoss(appUrl, { schedule: false, supervise: false, applicationName: "qa-a04" });
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss);
  worker = await startWorker({
    db: api.db,
    boss,
    timeZone: "Asia/Riyadh",
    log: quiet,
    pollIntervalMs: 200,
    jobPollingIntervalSeconds: 0.5,
  });

  w = await seedWorld(api.db);
  x = await dashboardWorld(api, w);
  y = await dashboardWorld(api, w);
  ({ today } = await riyadhToday(api));
  const [yy, mm] = today.split("-").map(Number) as [number, number];
  const label = `${yy}-${String(mm).padStart(2, "0")}`;
  const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  mar = await openPeriod(api, w, "monthly", "2026-03", "2026-03-01", "2026-03-31");
  q1 = await openPeriod(api, w, "quarterly", "2026-Q1", "2026-01-01", "2026-03-31");
  if (label === mar.label) throw new Error(`BLOCKED: A04 fixtures assume today (${today}) is after 2026-03`);
  current = await openPeriod(api, w, "monthly", label, `${label}-01`, `${label}-${String(lastDay).padStart(2, "0")}`);

  // X: the KPI (customers, flow, direct accept), its approved trajectory, the outcome link and the measured benefit.
  await mapPartyTo(api, x, "BO", x.users.bo.id);
  kpi = await ownedKpi(api, x, DIRECT_FLOW, { unitKind: "count", unitLabel: "customers" });
  await approvedTrajectory(api, x, kpi.id, [
    { pointDate: "2026-01-01", expectedValue: "90000" },
    { pointDate: current.end, expectedValue: "90000" },
  ]);
  okRow = await outcomeKpi(api.db, x, x.outcomeId, kpi.id, w.orgA.id);
  bx = asBenefitWorld(x, w, kpi.id);
  const formula = await revenueFormula(api, bx);
  benefit = await measuredBenefit(api, bx, {
    formula,
    extra: { measurementKpiDefinitionId: kpi.id, measurementKpiVariable: "eligible_customers" },
  });
  const silent = await ownedKpi(api, x, DIRECT_FLOW);
  okNoData = await outcomeKpi(
    api.db,
    x,
    await activeOutcome(api.db, w.orgA.id, x.transformationId, x.users.tl.id, "Synthetic outcome without data"),
    silent.id,
    w.orgA.id,
  );
  const iniX = await launchedInitiative(api.db, x, w.orgA.id, "INI-01");
  wsX = await workstreamOf(api.db, x, w.orgA.id, [iniX], { code: "WS-01" });

  // Y: its own KPI actual, outcome KPI, benefit and workstream (never visible to a user scoped to X).
  const ky = await ownedKpi(api, y, DIRECT_FLOW, { unitKind: "count", unitLabel: "customers" });
  const okY = await outcomeKpi(api.db, y, y.outcomeId, ky.id, w.orgA.id);
  const ay = await submitActual(api, y, ky.id, { reportingPeriodId: current.id, value: "777", dataAsOf: today });
  expect(ay.status, JSON.stringify(ay.body)).toBe(201);
  const by = asBenefitWorld(y, w, ky.id);
  const benY = await measuredBenefit(api, by);
  const iniY = await launchedInitiative(api.db, y, w.orgA.id, "INI-01");
  wsY = await workstreamOf(api.db, y, w.orgA.id, [iniY], { code: "WS-09" });
  const yCode = (await api.db
    .selectFrom("transformation")
    .select("code")
    .where("id", "=", y.transformationId)
    .executeTakeFirst())!.code;
  yIds = [y.transformationId, yCode, y.outcomeId, ky.id, okY, ay.body.actual.id, benY.id, iniY, wsY];
}, 240_000);

afterAll(async () => {
  await worker?.stop();
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 });
  await api?.close();
  if (dbName) await dropScratchDatabase(testDatabase().adminUrl, dbName);
}, 60_000);

// ------------------------------------------------------------------------------------------------ helpers

const runsOf = (actualId: string) =>
  api.db
    .selectFrom("calculation_run")
    .select(["id", "status", "trigger_kind"])
    .where("trigger_record_id", "=", actualId)
    .execute();
const pendingOf = (runId: string) =>
  api.db
    .selectFrom("benefit_measurement")
    .select(["id", "status", "amount", "benefit_id"])
    .where("calculation_run_id", "=", runId)
    .execute();
const queueOf = (measurementId: string) =>
  api.db
    .selectFrom("finance_validation")
    .select(["id", "status"])
    .where("benefit_measurement_id", "=", measurementId)
    .execute();
/** Every outbox row of these aggregates (if any) is published and the worker's queues are drained. */
async function settled(aggregateIds: string[]) {
  await waitFor(async () => {
    const rows = await api.db
      .selectFrom("outbox_event")
      .select("published_at")
      .where("aggregate_id", "in", aggregateIds)
      .execute();
    return rows.every((r) => r.published_at !== null);
  }, "outbox rows published");
  await waitFor(async () => {
    const r = await api.owner.query(
      "SELECT count(*)::int AS n FROM pgboss.job WHERE state IN ('created','retry','active') AND name NOT LIKE '__pgboss%'",
    );
    return r.rows[0].n === 0;
  }, "worker queues drained");
}
const areaOf = (body: Body, code: string): Body => (body.areas as Body[]).find((a) => a.code === code);
const overview = (s: Session, q = "") => get200(api, s, `/api/v1/overview?organizationId=${w.orgA.id}${q}`);

// ------------------------------------------------------------------------------------------------ the propagation

describe("A04: submit, accept, propagate once; the benefit stays pending", () => {
  let actualId: string;
  let runId: string;

  it("REQ-S07-017, REQ-S07-013: the direct-accept submission lists the downstream views and 'Finance review pending'; one audit event", async () => {
    const res = await submitActual(api, x, kpi.id, {
      reportingPeriodId: current.id,
      value: "100000",
      dataAsOf: today,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    actualId = res.body.actual.id;
    expect([res.body.actual.status, res.body.reviewPending, res.body.financeReview]).toEqual([
      "accepted",
      false,
      "pending",
    ]);
    const kinds = (res.body.downstream as Body[]).map((d) => d.kind);
    expect(kinds).toContain("benefit");
    expect(kinds.some((k) => k === "dashboard" || k === "executive_overview_outcomes")).toBe(true);
    expect((res.body.downstream as Body[]).find((d) => d.kind === "benefit").id).toBe(benefit.id);
    expect(await auditOf(api.db, actualId)).toHaveLength(1);
  });

  it("REQ-S07-013, REQ-S12-006: the worker makes exactly one calculation run and one pending benefit value with one queue item", async () => {
    const [run] = await waitFor(async () => {
      const r = await runsOf(actualId);
      return r.length > 0 ? r : null;
    }, "the calculation run");
    runId = run!.id;
    expect([run!.status, run!.trigger_kind]).toEqual(["completed", "actual_accepted"]);
    const [pending] = await waitFor(async () => {
      const p = await pendingOf(runId);
      return p.length > 0 ? p : null;
    }, "the pending benefit value");
    await waitFor(async () => ((await queueOf(pending!.id)).length > 0 ? true : null), "the Finance queue item");
    await settled([actualId, runId, pending!.id]);
    // Still exactly one of each once every event is consumed (no redelivery duplicates).
    expect(await runsOf(actualId)).toHaveLength(1);
    expect(await pendingOf(runId)).toHaveLength(1);
    expect((await queueOf(pending!.id)).map((q) => q.status)).toEqual(["queued"]);
    expect(await auditOf(api.db, actualId)).toHaveLength(1);
    const listed = await get200(api, x.s.auditor, `${x.base}/calculation-runs/${runId}`);
    expect(listed.triggerRecordId).toBe(actualId);
  });

  it("REQ-S03-009, REQ-S13-003: the overview's Outcomes area shows the new actual once and its drill-down lists the source record", async () => {
    const res = await overview(x.s.auditor, `&transformationId=${x.transformationId}`);
    const area = areaOf(res, "outcomes");
    const shown = (area.items as Body[]).filter((i) => i.value && canon(i.value.value) === "100000");
    expect(shown.map((i) => i.recordId)).toEqual([okRow]);
    const drill = await get200(
      api,
      x.s.auditor,
      `/api/v1/dashboard-drilldown?metric=outcomes.kpi_status&organizationId=${w.orgA.id}&subjectId=${okRow}`,
    );
    expect([drill.value.state, canon(drill.value.value)]).toEqual(["value", "100000"]);
    expect((drill.items as Body[]).filter((i) => i.recordType === "kpi_actual").map((i) => i.recordId)).toEqual([
      actualId,
    ]);
    // The transformation dashboard shows the same figure once, and the KPI panel's RAG comes from this run.
    const dash = await get200(api, x.s.auditor, `${x.base}/dashboard`);
    expect(
      (areaOf(dash, "outcomes").items as Body[]).filter((i) => i.value && canon(i.value.value) === "100000"),
    ).toHaveLength(1);
    const st = await get200(api, x.s.auditor, `${x.base}/kpi-definitions/${kpi.id}/status`);
    expect([canon(st.actual), st.calculationRunId, st.calculatedRag]).toEqual(["100000", runId, "green"]);
  });

  it("REQ-S07-014: the linked benefit shows a pending amount and the validated total is unchanged", async () => {
    // The worker writes the pending value asynchronously: wait until the benefit has one (never by sleeping).
    const s = await waitFor(async () => {
      const values = await get200(api, x.s.auditor, `${x.base}/benefits/${benefit.id}/values`);
      const byState = Object.fromEntries((values.series as Body[]).map((v) => [v.state, v])) as Body;
      return byState.submitted.count > 0 ? byState : null;
    }, "the pending benefit value");
    // (0.12 - 0.10) x 100000 customers x 50 SAR = 100000 SAR, pending Finance.
    expect([canon(s.submitted.total.amount), canon(s.validated.total.amount)]).toEqual(["100000", "0"]);
    const t = await get200(api, x.s.auditor, `${x.base}/benefit-totals`);
    const sar = (t.currencies as Body[]).find((c) => c.currency === "SAR");
    const validated = (sar?.lines as Body[] | undefined)?.find(
      (l) => l.valueClass === "revenue_uplift" && l.state === "validated",
    );
    expect(canon(validated?.total.amount ?? "0")).toBe("0");
    const fd = await get200(
      api,
      x.s.auditor,
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${x.transformationId}`,
    );
    expect(fd.pendingValidationCount).toBeGreaterThanOrEqual(1);
  });

  it("REQ-S07-012: with review configured, a submitted actual is not used until accepted; after acceptance one run", async () => {
    const reviewed = await ownedKpi(api, x, REVIEW_FLOW);
    const res = await submitActual(api, x, reviewed.id, {
      reportingPeriodId: current.id,
      value: "42",
      dataAsOf: today,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect([res.body.actual.status, res.body.reviewPending]).toEqual(["submitted", true]);
    const a = res.body.actual;
    await settled([a.id]);
    expect(await runsOf(a.id)).toHaveLength(0);
    let st = await get200(api, x.s.auditor, `${x.base}/kpi-definitions/${reviewed.id}/status`);
    expect([st.actual, st.actualStatus]).toEqual([null, "unknown"]);
    const ok = await actualAction(api, x, a.id, "accept", a.version, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await waitFor(async () => ((await runsOf(a.id)).length > 0 ? true : null), "the run after acceptance");
    await settled([a.id]);
    expect(await runsOf(a.id)).toHaveLength(1);
    st = await get200(api, x.s.auditor, `${x.base}/kpi-definitions/${reviewed.id}/status`);
    expect([canon(st.actual), st.actualStatus]).toEqual(["42", "ok"]);
  });

  it("REQ-S13-003, REQ-S07-006: a KPI with no actual shows Unknown on the dashboards, not 0", async () => {
    const res = await overview(x.s.auditor, `&transformationId=${x.transformationId}`);
    const item = (areaOf(res, "outcomes").items as Body[]).find((i) => i.recordId === okNoData);
    expect([item.rag, item.value.state, item.value.value]).toEqual(["unknown", "unknown", null]);
    const drill = await get200(
      api,
      x.s.auditor,
      `/api/v1/dashboard-drilldown?metric=outcomes.kpi_status&organizationId=${w.orgA.id}&subjectId=${okNoData}`,
    );
    expect([drill.value.state, drill.value.value]).toEqual(["unknown", null]);
  });
});

// ------------------------------------------------------------------------------------------------ scope and filters

describe("A04: dashboards are scoped and filtered on the server", () => {
  it("REQ-S13-001: a user scoped to transformation X sees nothing of Y on any of the six dashboards", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "BO", { type: "transformation", id: x.transformationId }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const leaks = (label: string, body: unknown) => {
      const text = JSON.stringify(body);
      for (const id of yIds) expect(text.includes(id), `${label} contains Y record ${id}`).toBe(false);
    };
    const exec = await overview(s);
    expect((exec.transformations as Body[]).map((t) => t.transformationId)).toEqual([x.transformationId]);
    leaks("executive overview", exec);
    for (const area of exec.areas as Body[])
      for (const h of area.headlines as Body[]) leaks(`drill-down ${h.metric}`, await get200(api, s, h.drilldownHref));
    leaks("transformation dashboard", await get200(api, s, `${x.base}/dashboard`));
    leaks("workstream dashboard", await get200(api, s, `${x.base}/workstreams/${wsX}/dashboard`));
    const fin = await get200(api, s, `/api/v1/dashboards/finance?organizationId=${w.orgA.id}`);
    expect((fin.transformations as Body[]).map((t) => t.transformationId)).toEqual([x.transformationId]);
    leaks("finance dashboard", fin);
    leaks("adoption dashboard", await get200(api, s, `/api/v1/dashboards/adoption?organizationId=${w.orgA.id}`));
    leaks("my work", await get200(api, s, "/api/v1/me/work"));
    // Y's own dashboards are not found for this user (no disclosure).
    expect((await call(api.app, "GET", `${y.base}/dashboard`, { session: s })).status).toBe(404);
    expect((await call(api.app, "GET", `${y.base}/workstreams/${wsY}/dashboard`, { session: s })).status).toBe(404);
    const forced = await call<Body>(
      api.app,
      "GET",
      `/api/v1/overview?organizationId=${w.orgA.id}&transformationId=${y.transformationId}`,
      { session: s },
    );
    if (forced.status === 200) leaks("overview filtered to Y", forced.body);
    else expect([403, 404, 422]).toContain(forced.status);
  });

  it("REQ-S13-002: a Q1 filter changes every tile to Q1 values", async () => {
    // Fixture figures inside and outside Q1 2026 (X only).
    const kq = await ownedKpi(api, x, DIRECT_FLOW);
    const okQ = await outcomeKpi(api.db, x, x.outcomeId, kq.id, w.orgA.id);
    for (const [period, value] of [
      [mar, "150"],
      [current, "50"],
    ] as const) {
      const r = await submitActual(api, x, kq.id, { reportingPeriodId: period.id, value, dataAsOf: today });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const indicator = await ownedKpi(api, x, DIRECT_FLOW);
    const linkId = await adoptionLink(api.db, x, w.orgA.id, indicator.id);
    for (const [period, value] of [
      [mar, "140"],
      [current, "60"],
    ] as const) {
      const r = await submitActual(api, x, indicator.id, { reportingPeriodId: period.id, value, dataAsOf: today });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    for (const [start, end, amount] of [
      ["2026-02-01", "2026-02-28", "1000"],
      ["2026-06-01", "2026-06-30", "2000"],
    ] as const) {
      const r = await call<Body>(api.app, "POST", `${x.base}/benefits/${benefit.id}/plan-values`, {
        session: bx.s.bo,
        body: { valueKind: "planned", periodStart: start, periodEnd: end, amount },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const ini = await launchedInitiative(api.db, x, w.orgA.id, "INI-02");
    await plannedMilestone(api.db, x, w.orgA.id, ini, "2026-05-01");
    await openDependency(api.db, x, w.orgA.id, "DEP-01", "2026-02-15");
    await openDependency(api.db, x, w.orgA.id, "DEP-02", "2026-08-01");
    await askDue(api, x, "2026-02-20");
    await askDue(api, x, "2026-08-20");
    const outboxIds = (
      await api.db
        .selectFrom("outbox_event")
        .select("aggregate_id")
        .where("event_type", "=", "kpi.actual_accepted")
        .execute()
    ).map((r) => r.aggregate_id);
    await settled(outboxIds);

    const q = `&transformationId=${x.transformationId}`;
    const all = await overview(x.s.auditor, q);
    const inQ1 = await overview(x.s.auditor, `${q}&periodId=${q1.id}`);
    expect(inQ1.appliedFilters).toMatchObject({
      periodId: q1.id,
      periodLabel: "2026-Q1",
      windowStart: "2026-01-01",
      windowEnd: "2026-03-31",
    });
    const figures = (area: Body) =>
      JSON.stringify([
        area.rag.status,
        (area.headlines as Body[]).map((h) => [h.metric, h.value]),
        (area.items as Body[]).map((i) => [i.recordId, i.rag, i.value]),
      ]);
    for (const code of ["outcomes", "value", "portfolio", "dependencies", "decisions", "people_adoption"])
      expect(figures(areaOf(inQ1, code)), code).not.toBe(figures(areaOf(all, code)));
    const itemValue = (body: Body, area: string, recordId: string) =>
      canon((areaOf(body, area).items as Body[]).find((i) => i.recordId === recordId)?.value?.value ?? null);
    expect([itemValue(all, "outcomes", okQ), itemValue(inQ1, "outcomes", okQ)]).toEqual(["50", "150"]);
    expect([itemValue(all, "people_adoption", linkId), itemValue(inQ1, "people_adoption", linkId)]).toEqual([
      "60",
      "140",
    ]);
    const planned = (body: Body) =>
      canon((areaOf(body, "value").headlines as Body[]).find((h) => h.metric === "value.planned").value.value);
    expect([planned(all), planned(inQ1)]).toEqual(["3000", "1000"]);
    const first = (body: Body, area: string) => canon(areaOf(body, area).headlines[0].value.value);
    expect([first(all, "dependencies"), first(inQ1, "dependencies")]).toEqual(["2", "1"]);
    expect([first(all, "decisions"), first(inQ1, "decisions")]).toEqual(["2", "1"]);
    const iniFlags = (body: Body) =>
      ((areaOf(body, "portfolio").items as Body[]).find((i) => i.recordId === ini)?.flags ?? []) as string[];
    expect(iniFlags(all)).toContain("milestone_red");
    expect(iniFlags(inQ1)).toContain("milestone_green");
    // The same filter on the transformation and Finance dashboards.
    const t = await get200(api, x.s.auditor, `${x.base}/dashboard?periodId=${q1.id}`);
    expect(itemValue(t, "outcomes", okQ)).toBe("150");
    const fd = await get200(
      api,
      x.s.auditor,
      `/api/v1/dashboards/finance?organizationId=${w.orgA.id}&transformationId=${x.transformationId}&periodId=${q1.id}`,
    );
    expect(fd.appliedFilters.periodId).toBe(q1.id);
  });
});
