// P4 contract exercises of KBE-G (T-DG4-KBE-G; p4-work-split §J+K JK.4, §1 S-10): the 6 slice J operations of the
// T10 area engine (getExecutiveOverview, getTransformationDashboard, getWorkstreamDashboard, getDashboardDrilldown,
// getDashboardRagPolicy, putDashboardRagPolicy). Every call goes through `ctx.mirrored` (OpenAPI status/body/headers +
// problem mirror) and every success body is parsed with the zod mirror in P4_MIRRORS_KBE_G. KBE-G2 appends its
// exercises (Finance and adoption dashboards, My Work, header) below, after this task.
//
// The fixtures below are shared with test/integration/reporting/*.test.ts. All data is SYNTHETIC: outcomes, outcome
// KPIs, initiatives, milestones, contributions and workstreams are written directly with their audit event in the same
// transaction (the p2 guards demand it; the routes that own them are other tasks'), exactly like the DG2-DG4 fixtures;
// KPI actuals, trajectories, periods, T16 asks and benefit values go through their APIs. A trajectory approval or a
// Finance validation here is a synthetic in-product business approval of test data; it approves nothing real, and
// nothing here reads or writes the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import {
  adoptionDashboard,
  dashboardDrilldown,
  dashboardRagPolicy,
  executiveOverview,
  financeDashboard,
  myWork,
  transformationDashboard,
  workspaceHeader,
  workstreamDashboard,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  signIn,
  type P4ExerciseContext,
  type RequestOptions,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { ensureDefaultCalendar } from "../approvals/approval-world.ts";
import type { BenefitWorld } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { askBody, moveAskDates } from "../governance/t16-fixtures.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { approvedTrajectory, DIRECT_FLOW, ownedKpi, runRecalculation, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";

export const P4_MIRRORS_KBE_G: Readonly<Record<string, z.ZodType>> = {
  getExecutiveOverview: executiveOverview,
  getTransformationDashboard: transformationDashboard,
  getWorkstreamDashboard: workstreamDashboard,
  getDashboardDrilldown: dashboardDrilldown,
  getDashboardRagPolicy: dashboardRagPolicy,
  putDashboardRagPolicy: dashboardRagPolicy,
  // KBE-G2 (T-DG4-KBE-G2; p4-work-split §J+K JK.5): the Finance and adoption dashboards, My Work and the header.
  getFinanceDashboard: financeDashboard,
  getAdoptionDashboard: adoptionDashboard,
  getMyWork: myWork,
  getWorkspaceHeader: workspaceHeader,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;
export type Send = (method: string, url: string, opts?: RequestOptions) => Promise<Res<Body>>;

// ------------------------------------------------------------------------------------------------ shared fixtures

const fixtureActor = (userId: string, id: string) =>
  ({ actorType: "user", actorUserId: userId, requestId: `fixture-${id}`, source: "api" }) as const;

/** Today in Asia/Riyadh (the organization default) and the day before (the "business date injected" of A09). */
export async function riyadhToday(api: TestApi): Promise<{ today: string; yesterday: string }> {
  const r = await sql<{ d: string; y: string }>`
    SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d, (p4_business_date(now(), 'Asia/Riyadh') - 1)::text AS y`.execute(
    api.db,
  );
  return { today: r.rows[0]!.d, yesterday: r.rows[0]!.y };
}

/**
 * A KPI world (the kbe-c fixtures' shape) on a NEW transformation of `businessUnitId` in org A, with one user per role
 * granted at transformation scope, the organization's default calendar ensured and the P4 governance instantiated (so
 * T16 asks can be raised). Transformation-scoped users read only this transformation (the REQ-S13-001 sweep).
 */
export async function dashboardWorld(api: TestApi, w: World, businessUnitId: string = w.a1): Promise<KpiWorld> {
  await ensureDefaultCalendar(api, w, (m, u, o) => call(api.app, m, u, o));
  const transformationId = await createTransformationRow(api.db, w.orgA.id, businessUnitId, w.office.id);
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
    await Promise.all(Object.entries(users).map(async ([k, u]) => [k, await signIn(api.app, u.subject)] as const)),
  ) as Record<keyof typeof users, Session>;
  await sql`SELECT p4_instantiate_transformation(${transformationId}::uuid, ${users.tl.id}::uuid, 'test:dashboard-world', 'api')`.execute(
    api.db,
  );
  const outcomeId = await activeOutcome(api.db, w.orgA.id, transformationId, users.tl.id);
  return {
    transformationId,
    outcomeId,
    archivedOutcomeId: outcomeId,
    users,
    s,
    base: `/api/v1/transformations/${transformationId}`,
  };
}

/** An ACTIVE outcome (direct write with its audit event). */
export async function activeOutcome(
  db: Db,
  organizationId: string,
  transformationId: string,
  by: string,
  statement?: string,
) {
  const id = uuidv7();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("outcome")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: transformationId,
        statement: statement ?? `Synthetic outcome ${id.slice(-6)}`,
        status: "active",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, fixtureActor(by, id), {
      action: "outcome.create",
      recordType: "outcome",
      recordId: id,
      organizationId,
      transformationId,
      newVersion: 1,
    });
  });
  return id;
}

/** A T02 outcome KPI row linking an outcome to a KPI definition (direct write with its audit event). */
export async function outcomeKpi(
  db: Db,
  k: KpiWorld,
  outcomeId: string,
  kpiDefinitionId: string,
  organizationId: string,
) {
  const id = uuidv7();
  const by = k.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("outcome_kpi")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        outcome_id: outcomeId,
        kpi_definition_id: kpiDefinitionId,
        target_value: "200",
        target_date: "2026-12-31",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, fixtureActor(by, id), {
      action: "outcome_kpi.create",
      recordType: "outcome_kpi",
      recordId: id,
      organizationId,
      transformationId: k.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

/** A reporting period of org A created and opened through the API by the organization's TO. */
export async function openPeriod(
  api: TestApi,
  w: World,
  frequency: string,
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ id: string; label: string; start: string; end: string }> {
  const s = await signIn(api.app, w.office.subject);
  const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
  const created = await call(api.app, "POST", base, {
    session: s,
    body: { frequency, periodLabel, periodStart, periodEnd },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const opened = await call(api.app, "POST", `${base}/${created.body.id}/open`, {
    session: s,
    headers: ifm(created.body.version),
  });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  return { id: created.body.id, label: periodLabel, start: periodStart, end: periodEnd };
}

/** An active monthly KPI owned by KDS with an approved trajectory 100 (2026-01-01) -> 200 (2026-12-31). */
export async function trajectoryKpi(api: TestApi, k: KpiWorld): Promise<{ id: string; name: string }> {
  const kpi = await ownedKpi(api, k, { ...DIRECT_FLOW, targetValue: "200", targetDate: "2026-12-31" });
  await approvedTrajectory(api, k, kpi.id, [
    { pointDate: "2026-01-01", expectedValue: "100" },
    { pointDate: "2026-12-31", expectedValue: "200" },
  ]);
  return { id: kpi.id, name: kpi.name };
}

/** An accepted actual (direct-accept route) of the KPI for a period, recalculated by the worker's consumer. */
export async function acceptedActual(
  api: TestApi,
  k: KpiWorld,
  kpiId: string,
  periodId: string,
  value: string,
  dataAsOf: string,
) {
  const res = await submitActual(api, k, kpiId, { reportingPeriodId: periodId, value, dataAsOf });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await runRecalculation(api, res.body.actual.id);
  return res.body.actual.id as string;
}

/** A launched initiative (direct write with its audit event). */
export async function launchedInitiative(db: Db, k: KpiWorld, organizationId: string, code: string): Promise<string> {
  const id = uuidv7();
  const by = k.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("initiative")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        code,
        name: `Synthetic initiative ${code}`,
        status: "launched",
        launched_at: new Date(),
        launched_by: by,
        executive_owner_user_id: k.users.bo.id,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, fixtureActor(by, id), {
      action: "initiative.create",
      recordType: "initiative",
      recordId: id,
      organizationId,
      transformationId: k.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

/**
 * Every delivery signal of an initiative COMPLETE (REQ-PB-063 probe): an accepted deliverable and an achieved milestone
 * with an approved date, plus its contribution to the outcome (direct writes with their audit events).
 */
export async function completedDelivery(
  db: Db,
  k: KpiWorld,
  organizationId: string,
  initiativeId: string,
  outcomeId: string,
) {
  const by = k.users.tl.id;
  const t = k.transformationId;
  const ids = { milestone: uuidv7(), contribution: uuidv7(), deliverable: uuidv7() };
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("milestone")
      .values({
        id: ids.milestone,
        organization_id: organizationId,
        transformation_id: t,
        initiative_id: initiativeId,
        title: "Synthetic milestone (achieved)",
        approved_date: "2026-02-01",
        approved_by: k.users.sp.id,
        approved_at: new Date(),
        approval_reason: "Synthetic approved date",
        actual_date: "2026-02-01",
        status: "achieved",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await tx
      .insertInto("initiative_outcome_contribution")
      .values({
        id: ids.contribution,
        organization_id: organizationId,
        transformation_id: t,
        initiative_id: initiativeId,
        outcome_id: outcomeId,
        contribution_statement: "Synthetic contribution",
        created_by: by,
        updated_by: by,
      })
      .execute();
    for (const [table, id] of [
      ["milestone", ids.milestone],
      ["initiative_outcome_contribution", ids.contribution],
    ] as const)
      await insertAuditEvent(tx, fixtureActor(by, id), {
        action: `${table}.create`,
        recordType: table,
        recordId: id,
        organizationId,
        transformationId: t,
        newVersion: 1,
      });
  });
  return ids;
}

/** A workstream with its active initiatives (direct writes with their audit events; BE-M3 owns the routes). */
export async function workstreamOf(
  db: Db,
  k: KpiWorld,
  organizationId: string,
  initiativeIds: readonly string[],
  opts: { code?: string; archived?: boolean } = {},
): Promise<string> {
  const id = uuidv7();
  const by = k.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("workstream")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        code: opts.code ?? "WS-01",
        name: "Synthetic workstream",
        ...(opts.archived
          ? { status: "archived", archived_at: new Date(), archived_by: by, archive_reason: "Synthetic" }
          : {}),
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, fixtureActor(by, id), {
      action: "workstream.create",
      recordType: "workstream",
      recordId: id,
      organizationId,
      transformationId: k.transformationId,
      newVersion: 1,
    });
    for (const initiativeId of initiativeIds) {
      const linkId = uuidv7();
      await tx
        .insertInto("workstream_initiative")
        .values({
          id: linkId,
          organization_id: organizationId,
          transformation_id: k.transformationId,
          workstream_id: id,
          initiative_id: initiativeId,
          created_by: by,
          updated_by: by,
        })
        .execute();
      await insertAuditEvent(tx, fixtureActor(by, linkId), {
        action: "workstream_initiative.create",
        recordType: "workstream_initiative",
        recordId: linkId,
        organizationId,
        transformationId: k.transformationId,
        newVersion: 1,
      });
    }
  });
  return id;
}

/** An open dependency of the transformation (direct write with its audit event). */
export async function openDependency(
  db: Db,
  k: KpiWorld,
  organizationId: string,
  code: string,
  neededBy: string | null,
  extra: { toInitiativeId?: string; ownerUserId?: string } = {},
): Promise<string> {
  const id = uuidv7();
  const by = k.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("dependency")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        code,
        description: `Synthetic dependency ${code}`,
        from_kind: "external",
        to_kind: extra.toInitiativeId ? "initiative" : "other",
        to_initiative_id: extra.toInitiativeId ?? null,
        dependency_type: "vendor",
        needed_by: neededBy,
        owner_user_id: extra.ownerUserId ?? null,
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, fixtureActor(by, id), {
      action: "dependency.create",
      recordType: "dependency",
      recordId: id,
      organizationId,
      transformationId: k.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

/** A planned milestone with an approved date (direct write with its audit event). */
export async function plannedMilestone(
  db: Db,
  k: KpiWorld,
  organizationId: string,
  initiativeId: string,
  approvedDate: string,
) {
  const id = uuidv7();
  const by = k.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("milestone")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        initiative_id: initiativeId,
        title: "Synthetic milestone (planned)",
        approved_date: approvedDate,
        approved_by: k.users.sp.id,
        approved_at: new Date(),
        approval_reason: "Synthetic approved date",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, fixtureActor(by, id), {
      action: "milestone.create",
      recordType: "milestone",
      recordId: id,
      organizationId,
      transformationId: k.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

/**
 * A KPI-fed adoption metric link of the transformation naming `kpiDefinitionId` (direct write with its audit event; the
 * 0047 guard requires exactly that a KPI-fed template names a KPI).
 */
export async function adoptionLink(
  db: Db,
  k: KpiWorld,
  organizationId: string,
  kpiDefinitionId: string,
): Promise<string> {
  const id = uuidv7();
  const by = k.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto("adoption_metric_link")
      .values({
        id,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        template_key: "usage_activation_rate",
        kpi_definition_id: kpiDefinitionId,
        target_kind: "transformation",
        created_by: by,
        updated_by: by,
      })
      .execute();
    await insertAuditEvent(tx, fixtureActor(by, id), {
      action: "adoption_metric_link.create",
      recordType: "adoption_metric_link",
      recordId: id,
      organizationId,
      transformationId: k.transformationId,
      newVersion: 1,
    });
  });
  return id;
}

/** Raises a complete T16 ask through the API (TL) owned by BO, then moves its dates (the T16 test clock). */
export async function askDue(api: TestApi, k: KpiWorld, dueDate: string): Promise<{ id: string; version: number }> {
  const { today } = await riyadhToday(api);
  const res = await call(api.app, "POST", `${k.base}/executive-decisions`, {
    session: k.s.tl,
    body: askBody(k.users.bo.id, today),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  await moveAskDates(api.db, res.body.id, dueDate, dueDate);
  return { id: res.body.id, version: res.body.version + 1 };
}

/** The ask's owner (BO) records the outcome `decided` (If-Match), which closes the ask. */
export async function decideAsk(api: TestApi, k: KpiWorld, ask: { id: string; version: number }) {
  const res = await call(api.app, "POST", `${k.base}/executive-decisions/${ask.id}/outcome`, {
    session: k.s.bo,
    headers: ifm(ask.version),
    body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic: switch vendor" },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/**
 * The slice B benefit world (benefits/fixtures.ts seedBenefitWorld) on a transformation of `businessUnitId`: the same
 * users, KPI and T09 formula, created through the same APIs.
 */
export async function benefitWorldIn(api: TestApi, w: World, businessUnitId: string): Promise<BenefitWorld> {
  const transformationId = await createTransformationRow(api.db, w.orgA.id, businessUnitId, w.office.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const mk = async (...roles: string[]) => {
    const u = await createUser(api.db, w.orgA.id);
    for (const role of roles) await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
    return u;
  };
  const users = {
    tl: await mk("TL"),
    bo: await mk("BO"),
    bo2: await mk("BO"),
    fin: await mk("FIN"),
    auditor: w.auditor,
    admin: w.admin,
    outsider: w.officeB,
  };
  const s = Object.fromEntries(
    await Promise.all(Object.entries(users).map(async ([k, u]) => [k, await signIn(api.app, u.subject)] as const)),
  ) as Record<keyof typeof users, Session>;
  const base = `/api/v1/transformations/${transformationId}`;
  const kpi = await call(api.app, "POST", `${base}/kpi-definitions`, {
    session: s.tl,
    body: { name: "Synthetic NPS (CX)", unitKind: "score", polarity: "higher_is_better" },
  });
  expect(kpi.status, JSON.stringify(kpi.body)).toBe(201);
  const formula = await call(api.app, "POST", "/api/v1/benefit-formulas", {
    session: s.tl,
    body: { transformationId, benefitName: "Synthetic churn reduction formula" },
  });
  expect(formula.status, JSON.stringify(formula.body)).toBe(201);
  return {
    transformationId,
    organizationId: w.orgA.id,
    base,
    users,
    s,
    kpiDefinitionId: kpi.body.id,
    benefitFormulaId: formula.body.id,
  };
}

/** A planned value of a benefit for one period (BO, through the API). */
export async function planValue(
  api: TestApi,
  b: BenefitWorld,
  benefitId: string,
  amount: string,
  start: string,
  end: string,
) {
  const r = await call(api.app, "POST", `${b.base}/benefits/${benefitId}/plan-values`, {
    session: b.s.bo,
    body: { valueKind: "planned", periodStart: start, periodEnd: end, amount },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

/**
 * A financial benefit (revenue uplift, SAR) with planned values and one value submitted by BO and validated by FIN for
 * `period` (a synthetic Finance validation of test data). Returns the benefit and measurement ids.
 */
export async function validatedBenefit(
  api: TestApi,
  b: BenefitWorld,
  planned: readonly { amount: string; start: string; end: string }[],
  validated: { amount: string; start: string; end: string } | null,
): Promise<{ benefitId: string; code: string; measurementId: string | null }> {
  const ben = await measuredBenefit(api, b);
  for (const p of planned) await planValue(api, b, ben.id, p.amount, p.start, p.end);
  if (validated === null) return { benefitId: ben.id, code: ben.code, measurementId: null };
  const v = await submittedValue(api, b, ben.id, validated.amount, {
    periodStart: validated.start,
    periodEnd: validated.end,
  });
  await approve(api, b, v, validated.amount);
  return { benefitId: ben.id, code: ben.code, measurementId: v.measurementId };
}

/** The area of a dashboard response by code. */
export const areaOf = (body: Body, code: string): Body => (body.areas as Body[]).find((a) => a.code === code);

// ------------------------------------------------------------------------------------------------ exercises

export async function exerciseP4KbeGOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const { api, world: w } = ctx;
  const k = await dashboardWorld(api, w);
  const office = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);

  // putDashboardRagPolicy / getDashboardRagPolicy (If-Match "0" creates; the GET of version 0 is not exercised through
  // the contract: its ETag "0" is outside the contract's ETag pattern, the BE-L precedent reported for the architect).
  const P = `/api/v1/organizations/${w.orgA.id}/dashboard-rag-policy`;
  const put = await m("PUT", P, { session: office, headers: ifm(0), body: { decisionDueSoonWorkingDays: 5 } });
  expect([put.status, put.body.version, put.body.policySource], JSON.stringify(put.body)).toEqual([
    200,
    1,
    "configured",
  ]);
  expect((await m("PUT", P, { session: auditor, headers: ifm(1), body: { topInitiativeCount: 3 } })).status).toBe(403);
  const got = await m("GET", P, { session: auditor });
  expect([got.status, got.headers.etag, got.body.effective.decisionDueSoonWorkingDays]).toEqual([200, '"1"', 5]);

  // getTransformationDashboard
  const dash = await m("GET", `${k.base}/dashboard`, { session: k.s.auditor });
  expect(dash.status, JSON.stringify(dash.body)).toBe(200);
  expect((dash.body.areas as Body[]).map((a) => a.code)).toEqual([
    "outcomes",
    "value",
    "portfolio",
    "dependencies",
    "decisions",
    "people_adoption",
  ]);

  // getWorkstreamDashboard
  const ini = await launchedInitiative(api.db, k, w.orgA.id, "INI-01");
  const ws = await workstreamOf(api.db, k, w.orgA.id, [ini]);
  const wsd = await m("GET", `${k.base}/workstreams/${ws}/dashboard`, { session: k.s.auditor });
  expect([wsd.status, areaOf(wsd.body, "decisions").rag.status]).toEqual([200, "not_applicable"]);

  // getExecutiveOverview
  const ov = await m("GET", `/api/v1/overview?organizationId=${w.orgA.id}&transformationId=${k.transformationId}`, {
    session: k.s.auditor,
  });
  expect([ov.status, ov.body.transformationCount], JSON.stringify(ov.body)).toEqual([200, 1]);

  // getDashboardDrilldown (each headline's own href)
  const href = areaOf(dash.body, "decisions").headlines[0].drilldownHref as string;
  const dd = await m("GET", href, { session: k.s.auditor });
  expect([dd.status, dd.body.metric]).toEqual([200, "decisions.open"]);
  const bad = await m(
    "GET",
    `/api/v1/dashboard-drilldown?metric=dependencies.open&organizationId=${w.orgA.id}&subjectId=${ini}`,
    {
      session: k.s.auditor,
    },
  );
  expect([bad.status, bad.body.code]).toEqual([422, "dashboard.metric_subject_mismatch"]);
  // T-DG4-KBE-R4 (ADR-0037 amendment K1): a value-state metric added by K1, narrowed by `valueClass`, and the K2
  // refusal of a value class with any other metric, both through the validating client.
  const byClass = await m(
    "GET",
    `/api/v1/dashboard-drilldown?metric=value.sustained&organizationId=${w.orgA.id}&valueClass=margin_uplift`,
    { session: k.s.auditor },
  );
  expect([byClass.status, byClass.body.metric, byClass.body.items]).toEqual([200, "value.sustained", []]);
  const notApplicable = await m(
    "GET",
    `/api/v1/dashboard-drilldown?metric=decisions.open&organizationId=${w.orgA.id}&valueClass=revenue_uplift`,
    { session: k.s.auditor },
  );
  expect([notApplicable.status, notApplicable.body.code]).toEqual([422, "dashboard.value_class_not_applicable"]);

  // KBE-G2 (appended after KBE-G, p4-work-split JK.0/JK.5): the 4 operations of p4-pending-kbe-g2.ts.
  await exerciseP4KbeG2Operations(ctx, k);
}

/** The KBE-G2 exercises: getFinanceDashboard, getAdoptionDashboard, getMyWork, getWorkspaceHeader. */
async function exerciseP4KbeG2Operations(ctx: P4ExerciseContext, k: KpiWorld): Promise<void> {
  const m = ctx.mirrored;
  const { world: w } = ctx;
  const q = `organizationId=${w.orgA.id}&transformationId=${k.transformationId}`;

  // getFinanceDashboard (a scoped reader; 404 for an organization without a grant)
  const fin = await m("GET", `/api/v1/dashboards/finance?${q}`, { session: k.s.fin });
  expect([fin.status, fin.body.transformations.length], JSON.stringify(fin.body)).toEqual([200, 1]);
  expect((await m("GET", `/api/v1/dashboards/finance?organizationId=${w.orgB.id}`, { session: k.s.fin })).status).toBe(
    404,
  );

  // getAdoptionDashboard
  const ad = await m("GET", `/api/v1/dashboards/adoption?${q}`, { session: k.s.auditor });
  expect([ad.status, ad.body.area.code], JSON.stringify(ad.body)).toEqual([200, "people_adoption"]);

  // getMyWork (overview, then one section)
  const mw = await m("GET", "/api/v1/me/work", { session: k.s.tl });
  expect([mw.status, mw.body.sections.length], JSON.stringify(mw.body)).toEqual([200, 6]);
  const drafts = await m("GET", "/api/v1/me/work?section=drafts&limit=10", { session: k.s.tl });
  expect([drafts.status, drafts.body.sections.map((x: Body) => x.section)]).toEqual([200, ["drafts"]]);

  // getWorkspaceHeader (404 outside the scope)
  const h = await m("GET", `${k.base}/summary`, { session: k.s.auditor });
  expect([h.status, h.body.transformationId], JSON.stringify(h.body)).toEqual([200, k.transformationId]);
  expect((await m("GET", `${k.base}/summary`, { session: k.s.outsider })).status).toBe(404);
}
