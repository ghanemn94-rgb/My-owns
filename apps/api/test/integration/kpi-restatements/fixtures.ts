// Fixtures of the KPI restatement tests and contract exercises (T-DG5-KBE-E; ADR-0047 §1-§2; p5-work-split §G.1). All
// data is SYNTHETIC. Reporting periods are quarterly (no other suite or exercise uses the quarterly frequency, so the
// non-overlap guard never meets another test's period); they are created, opened and closed through the API by the
// organization's TO. KPI definitions, versions and actuals go through the DG2/DG4 APIs, and the worker's own
// kpi.recalculate consumer writes the evaluations (runRecalculation). A change request is decided by the synthetic
// Business Owner through the approval API: a demo business approval that approves nothing real. Nothing here touches
// the engineering gates DG0-DG7.
import { expect } from "vitest";
import { call, signIn, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifMatch, type KpiWorld } from "../kpi/fixtures.ts";
import { createKpi, postVersion } from "../kpi-p4/kbe-b-fixtures.ts";
import { runRecalculation, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

export interface Quarter {
  readonly id: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  version: number;
}

const QUARTER = [
  ["01-01", "03-31"],
  ["04-01", "06-30"],
  ["07-01", "09-30"],
  ["10-01", "12-31"],
] as const;

/** A quarterly period `<year>-Q<q>` of orgA, created scheduled by the TO. */
export async function quarter(api: TestApi, w: World, year: number, q: 1 | 2 | 3 | 4, s?: Session): Promise<Quarter> {
  const session = s ?? (await signIn(api.app, w.office.subject));
  const [a, b] = QUARTER[q - 1]!;
  const body = {
    frequency: "quarterly",
    periodLabel: `${year}-Q${q}`,
    periodStart: `${year}-${a}`,
    periodEnd: `${year}-${b}`,
  };
  const res = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/reporting-periods`, {
    session,
    body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    id: res.body.id,
    label: body.periodLabel,
    start: body.periodStart,
    end: body.periodEnd,
    version: res.body.version,
  };
}

/** Opens or closes a period (TO). */
export async function stepQuarter(
  api: TestApi,
  w: World,
  p: Quarter,
  to: "open" | "close",
  s?: Session,
): Promise<void> {
  const session = s ?? (await signIn(api.app, w.office.subject));
  const res = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/reporting-periods/${p.id}/${to}`, {
    session,
    headers: ifMatch(p.version),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  p.version = res.body.version;
}

/** The minimal direct-accept flow version, target 100, with the given data-quality staleness. */
export const RESTATED_FLOW = Object.freeze({
  measureType: "higher_is_better",
  valueNature: "flow",
  aggregationRule: "sum",
  submissionRoute: "direct_accept",
  targetValue: "100",
  targetDate: "2079-12-31",
});

/** An active quarterly KPI (KDS owner) with an active version 1 (`version` body). */
export async function quarterlyKpi(
  api: TestApi,
  k: KpiWorld,
  version: object = RESTATED_FLOW,
): Promise<{ id: string; v1: Body }> {
  const kpi = await createKpi(api, k, { frequency: "quarterly", ownerUserId: k.users.kds.id } as never);
  const v = await postVersion(api, k, kpi.id, version);
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  const a = await call<Body>(api.app, "POST", `${k.base}/kpi-versions/${v.body.id}/activate`, {
    session: k.s.kds,
    headers: ifMatch(v.body.version),
  });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return { id: kpi.id, v1: a.body };
}

/**
 * A directly accepted actual of the transformation scope for an OPEN period, then the worker's calculation run for it.
 * Returns the actual id.
 */
export async function acceptedActual(
  api: TestApi,
  k: KpiWorld,
  kpiId: string,
  period: Quarter,
  value: string,
  dataAsOf: string = period.end,
): Promise<string> {
  const res = await submitActual(api, k, kpiId, { reportingPeriodId: period.id, value, dataAsOf });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  expect(res.body.actual.status).toBe("accepted");
  const runs = await runRecalculation(api, res.body.actual.id);
  expect(runs.map((r) => r.outcome)).toEqual(["done"]);
  return res.body.actual.id as string;
}

/** The latest evaluation (highest run seq) of a slot, or undefined. */
export async function latestEvaluation(
  api: TestApi,
  kpiId: string,
  periodId: string,
  basis: "period" | "cumulative" = "period",
) {
  return api.db
    .selectFrom("kpi_evaluation as e")
    .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
    .select(["e.id", "e.kpi_version_id", "e.value", "e.value_status", "e.calculated_rag", "e.final_target", "r.seq"])
    .where("e.kpi_definition_id", "=", kpiId)
    .where("e.reporting_period_id", "=", periodId)
    .where("e.value_basis", "=", basis)
    .orderBy("r.seq", "desc")
    .limit(1)
    .executeTakeFirst();
}

/** POST createKpiRestatement. */
export function createRestatement(api: TestApi, k: KpiWorld, kpiId: string, body: object, session?: Session) {
  return call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${kpiId}/restatements`, {
    session: session ?? k.s.kds,
    body,
  });
}

/** POST submit or withdraw of a restatement (no body). */
export function restatementAction(
  api: TestApi,
  k: KpiWorld,
  id: string,
  action: "submit" | "withdraw",
  version: number | null,
  session?: Session,
) {
  return call<Body>(api.app, "POST", `${k.base}/kpi-restatements/${id}/${action}`, {
    session: session ?? k.s.kds,
    ...(version === null ? {} : { headers: ifMatch(version) }),
  });
}

export const reconciliationOf = (api: TestApi, k: KpiWorld, id: string, session?: Session) =>
  call<Body>(api.app, "GET", `${k.base}/kpi-restatements/${id}/reconciliation`, { session: session ?? k.s.auditor });
