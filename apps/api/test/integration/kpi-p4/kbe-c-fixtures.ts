// Fixtures of the KBE-C integration tests and contract exercises (T-DG4-KBE-C; p4-work-split §A.3). All data is
// SYNTHETIC. Reporting periods are created and opened through the API by the organization's TO; KPI definitions and
// versions through the DG2 and KBE-B APIs, with the KDS user as the KPI's owner; the reviewer party is mapped to the
// world's Business Owner through the role-mapping API. Evidence is created through the evidence API. Nothing here
// grants a business approval or touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import { call, signIn, type Session, type TestApi, type World } from "../../support/harness.ts";
import { recalculate, RECALCULATE_EVENTS } from "../../../../worker/src/handlers/kpi.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { createKpi, ifMatch, postVersion, type KpiDefBody } from "./kbe-b-fixtures.ts";

export { ifMatch };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The next free calendar month of the organization (monthly periods never overlap), from 2041-01. */
async function nextMonth(api: TestApi, organizationId: string): Promise<{ y: number; m: number }> {
  const last = await api.db
    .selectFrom("reporting_period")
    .select("period_end")
    .where("organization_id", "=", organizationId)
    .where("frequency", "=", "monthly")
    .orderBy("period_end", "desc")
    .executeTakeFirst();
  if (!last || last.period_end < "2041-01-01") return { y: 2041, m: 1 };
  const [y, m] = last.period_end.split("-").map(Number) as [number, number];
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

/** A monthly reporting period of orgA (created by the TO), opened unless `scheduled`. */
export async function monthlyPeriod(
  api: TestApi,
  w: World,
  opts: { scheduled?: boolean; session?: Session } = {},
): Promise<{ id: string; label: string; version: number; start: string; end: string }> {
  const s = opts.session ?? (await signIn(api.app, w.office.subject));
  const { y, m } = await nextMonth(api, w.orgA.id);
  const start = `${y}-${pad(m)}-01`;
  const end = `${y}-${pad(m)}-${pad(lastDay(y, m))}`;
  const label = `${y}-${pad(m)}`;
  const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
  const created = await call(api.app, "POST", base, {
    session: s,
    body: { frequency: "monthly", periodLabel: label, periodStart: start, periodEnd: end },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  if (opts.scheduled) return { id: created.body.id, label, version: created.body.version, start, end };
  const opened = await call(api.app, "POST", `${base}/${created.body.id}/open`, {
    session: s,
    headers: ifMatch(created.body.version),
  });
  expect(opened.status, JSON.stringify(opened.body)).toBe(200);
  return { id: opened.body.id, label, version: opened.body.version, start, end };
}

/** Maps a governance party to a user of the KPI world (TL holds role_mapping.assign at the transformation). */
export async function mapPartyTo(api: TestApi, k: KpiWorld, partyCode: string, userId: string): Promise<void> {
  const res = await call(api.app, "POST", `${k.base}/role-mappings`, {
    session: k.s.tl,
    body: { partyCode, targetKind: "user", userId },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

export const REVIEW_FLOW = Object.freeze({
  measureType: "higher_is_better",
  valueNature: "flow",
  aggregationRule: "sum",
  submissionRoute: "review",
  reviewerPartyCode: "BO",
});
export const DIRECT_FLOW = Object.freeze({
  measureType: "higher_is_better",
  valueNature: "flow",
  aggregationRule: "sum",
  submissionRoute: "direct_accept",
});

/** An active monthly KPI owned by the KDS user, with an active version (`version` body). */
export async function ownedKpi(
  api: TestApi,
  k: KpiWorld,
  version: object = DIRECT_FLOW,
  def: KpiDefBody & { stewardUserId?: string } = {},
): Promise<{ id: string; versionId: string; name: string }> {
  const kpi = await createKpi(api, k, { ...def, ownerUserId: k.users.kds.id } as KpiDefBody);
  const v = await postVersion(api, k, kpi.id, version);
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  const a = await call(api.app, "POST", `${k.base}/kpi-versions/${v.body.id}/activate`, {
    session: k.s.kds,
    headers: ifMatch(v.body.version),
  });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return { id: kpi.id, versionId: a.body.id, name: kpi.name };
}

/** A synthetic note evidence item of the transformation (created by TL). */
export async function evidenceItem(api: TestApi, k: KpiWorld): Promise<string> {
  const res = await call(api.app, "POST", `${k.base}/evidence`, {
    session: k.s.tl,
    body: { kind: "note", title: "Synthetic KPI extract", noteBody: "Synthetic", ownerUserId: k.users.tl.id },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

/** POST the routine update (submitKpiActual). */
export function submitActual(api: TestApi, k: KpiWorld, kpiId: string, body: object, session?: Session) {
  return call<Body>(api.app, "POST", `${k.base}/kpi-definitions/${kpiId}/actuals`, {
    session: session ?? k.s.kds,
    body: {
      scopeKind: "transformation",
      scopeId: k.transformationId,
      action: "submit",
      dataAsOf: "2041-01-31",
      ...body,
    },
  });
}

export function actualAction(
  api: TestApi,
  k: KpiWorld,
  actualId: string,
  action: "values" | "submit" | "accept" | "reject",
  version: number | null,
  body?: object,
  session?: Session,
) {
  return call<Body>(api.app, "POST", `${k.base}/kpi-actuals/${actualId}/${action}`, {
    session: session ?? (action === "accept" || action === "reject" ? k.s.bo : k.s.kds),
    ...(version === null ? {} : { headers: ifMatch(version) }),
    ...(body === undefined ? {} : { body }),
  });
}

/** Outbox rows of one aggregate (scope-local counts). */
export async function outboxOf(api: TestApi, aggregateId: string) {
  return api.db
    .selectFrom("outbox_event")
    .select(["event_type", "idempotency_key", "payload"])
    .where("aggregate_id", "=", aggregateId)
    .orderBy("seq")
    .execute();
}

/**
 * Runs the worker's kpi.recalculate consumer (apps/worker/src/handlers/kpi.ts) for every pending trigger event of
 * `aggregateId` (as the relay would deliver it: the outbox row's envelope). Returns the handler results in order.
 */
export async function runRecalculation(api: TestApi, aggregateId: string) {
  const rows = await api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("aggregate_id", "=", aggregateId)
    .where("event_type", "in", [...RECALCULATE_EVENTS])
    .orderBy("seq")
    .execute();
  const results = [];
  for (const r of rows)
    results.push(
      await recalculate(
        api.db,
        {
          outboxEventId: r.id,
          eventType: r.event_type,
          schemaVersion: r.schema_version,
          idempotencyKey: r.idempotency_key,
          organizationId: r.organization_id,
          payload: r.payload,
        },
        `test-${r.id}`,
      ),
    );
  return results;
}

/** An approved trajectory of the KPI and scope (created by KDS, approved by SP: a synthetic business approval). */
export async function approvedTrajectory(
  api: TestApi,
  k: KpiWorld,
  kpiId: string,
  points: readonly { pointDate: string; expectedValue: string }[],
  scope: { scopeKind: string; scopeId: string } = { scopeKind: "transformation", scopeId: k.transformationId },
  extra: object = {},
): Promise<{ id: string; versionNo: number }> {
  const created = await call(api.app, "POST", `${k.base}/kpi-definitions/${kpiId}/trajectories`, {
    session: k.s.kds,
    body: { ...scope, points, ...extra },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const approved = await call(api.app, "POST", `${k.base}/target-trajectories/${created.body.id}/approve`, {
    session: k.s.sp,
    headers: ifMatch(created.body.version),
    body: {},
  });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return { id: approved.body.id, versionNo: approved.body.versionNo };
}

export const statusOf = (api: TestApi, k: KpiWorld, kpiId: string, query = "") =>
  call<Body>(api.app, "GET", `${k.base}/kpi-definitions/${kpiId}/status${query}`, { session: k.s.auditor });
