// Fixtures of the KBE-B integration tests and contract exercises (T-DG4-KBE-B; p4-work-split §A.2). All data is
// SYNTHETIC. KPI definitions are created and activated through the DG2 API; data-quality findings have no create
// operation (calculation runs write them, KBE-C's worker), so `insertFinding` writes a synthetic reporting period (with
// its audit event, as p2_attach_guards demands), a completed calculation run and an open finding directly. Nothing here
// grants a business approval or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import { call, createUser, grant, signIn, type Session, type TestApi } from "../../support/harness.ts";
import { ifMatch, type KpiWorld } from "../kpi/fixtures.ts";

export { ifMatch };

export interface KpiDefBody {
  readonly name?: string;
  readonly unitKind?: string;
  readonly unitLabel?: string | null;
  readonly currency?: string | null;
  readonly polarity?: string;
  readonly frequency?: string;
}

/** A DG2 KPI definition created by `session` (KDS by default), activated unless `draft`. */
export async function createKpi(
  api: TestApi,
  k: KpiWorld,
  body: KpiDefBody = {},
  opts: { draft?: boolean; session?: Session } = {},
): Promise<{ id: string; version: number; name: string }> {
  const session = opts.session ?? k.s.kds;
  const name = body.name ?? `Synthetic KPI ${uuidv7().slice(-6)}`;
  const created = await call(api.app, "POST", `${k.base}/kpi-definitions`, {
    session,
    body: { unitKind: "count", unitLabel: "lines", polarity: "higher_is_better", frequency: "monthly", ...body, name },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  if (opts.draft) return { id: created.body.id, version: created.body.version, name };
  const active = await call(api.app, "POST", `${k.base}/kpi-definitions/${created.body.id}/activate`, {
    session,
    headers: ifMatch(created.body.version),
  });
  expect(active.status, JSON.stringify(active.body)).toBe(200);
  return { id: active.body.id, version: active.body.version, name };
}

/** The minimal body of a direct-accept flow KPI version with its aggregation rule. */
export const FLOW_VERSION = Object.freeze({
  measureType: "higher_is_better",
  valueNature: "flow",
  aggregationRule: "sum",
  submissionRoute: "direct_accept",
});

/** POST a version; returns the response. */
export function postVersion(api: TestApi, k: KpiWorld, kpiId: string, body: object, session?: Session) {
  return call(api.app, "POST", `${k.base}/kpi-definitions/${kpiId}/versions`, { session: session ?? k.s.kds, body });
}

/** Creates and activates a version (as KDS); returns the active version body. */
export async function activeVersion(api: TestApi, k: KpiWorld, kpiId: string, body: object = FLOW_VERSION) {
  const v = await postVersion(api, k, kpiId, body);
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  const a = await call(api.app, "POST", `${k.base}/kpi-versions/${v.body.id}/activate`, {
    session: k.s.kds,
    headers: ifMatch(v.body.version),
  });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return a.body;
}

/** The first day the synthetic ad-hoc periods use (far from every calendar period the tests create). */
export const FINDING_PERIOD_FIRST_DAY = "2031-01-02";
/** reporting_period_guard's advisory lock class (migration 0033 `reporting_period_lock_class`; ADR-0016 registry). */
const REPORTING_PERIOD_LOCK_CLASS = 730230;

/**
 * The day of the next synthetic ad-hoc period of `organizationId` (T-DG4-KBE-R1 item 2; D-098, D-105): the day after
 * the organization's latest ad-hoc period, and FINDING_PERIOD_FIRST_DAY for its first. It is read under the advisory
 * lock reporting_period_guard takes for the organization and frequency, so it is deterministic (a fresh organization
 * gets 2031-01-02, 2031-01-03, … in call order) and unique per call, even for concurrent calls. The former
 * `Math.random()` draw could pick a day already used (the data-quality.test.ts "overlaps another ad_hoc period" flake).
 */
export async function nextFindingPeriodDay(tx: Tx, organizationId: string): Promise<string> {
  await sql`SELECT pg_advisory_xact_lock(${REPORTING_PERIOD_LOCK_CLASS}, hashtext(${organizationId}::text || ':ad_hoc'))`.execute(
    tx,
  );
  const next = await sql<{ day: string }>`
    SELECT greatest(coalesce(max(period_end) + 1, ${FINDING_PERIOD_FIRST_DAY}::date), ${FINDING_PERIOD_FIRST_DAY}::date)::text AS day
      FROM reporting_period
     WHERE organization_id = ${organizationId} AND frequency = 'ad_hoc'`.execute(tx);
  return next.rows[0]!.day;
}

/** A synthetic open data-quality finding of `kpiDefinitionId` (with its run and an ad-hoc reporting period). */
export async function insertFinding(
  db: Db,
  k: KpiWorld,
  organizationId: string,
  kpiDefinitionId: string,
  ruleCode = "missing_actual",
): Promise<string> {
  const periodId = uuidv7();
  const runId = uuidv7();
  const findingId = uuidv7();
  await db.transaction().execute(async (tx) => {
    // A distinct one-day ad-hoc period per call (periods of one organization and frequency never overlap).
    const day = await nextFindingPeriodDay(tx, organizationId);
    await tx
      .insertInto("reporting_period")
      .values({
        id: periodId,
        organization_id: organizationId,
        frequency: "ad_hoc",
        period_label: `KBEB-${periodId.slice(-12)}`,
        period_start: day,
        period_end: day,
        created_by: k.users.tl.id,
        updated_by: k.users.tl.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: k.users.tl.id, requestId: `fixture-${periodId}`, source: "api" },
      {
        action: "reporting_period.create",
        recordType: "reporting_period",
        recordId: periodId,
        organizationId,
        newVersion: 1,
      },
    );
    await tx
      .insertInto("calculation_run")
      .values({
        id: runId,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        trigger_kind: "version_activated",
        trigger_record_type: "kpi_version",
        trigger_record_id: uuidv7(),
        trigger_slot: 1,
        idempotency_key: `fixture:${runId}`,
        status: "completed",
        formula_engine_version: "fixture",
        kpi_rules_version: "mth-kpi/1.0.0",
        started_at: sql<Date>`now()`,
      })
      .execute();
    await tx
      .insertInto("data_quality_finding")
      .values({
        id: findingId,
        organization_id: organizationId,
        transformation_id: k.transformationId,
        kpi_definition_id: kpiDefinitionId,
        scope_kind: "transformation",
        scope_id: k.transformationId,
        reporting_period_id: periodId,
        rule_code: ruleCode,
        severity: "warning",
        detail_params: JSON.stringify({ periodLabel: "synthetic" }),
        detected_by_run_id: runId,
      })
      .execute();
  });
  return findingId;
}

/** A fresh user of the KPI world's transformation with `roles` (so a commit-time test can revoke it alone). */
export async function freshUser(
  api: TestApi,
  k: KpiWorld,
  organizationId: string,
  grantorId: string,
  ...roles: string[]
) {
  const u = await createUser(api.db, organizationId);
  for (const role of roles)
    await grant(api.db, grantorId, u.id, role, { type: "transformation", id: k.transformationId }, organizationId);
  return { ...u, session: await signIn(api.app, u.subject) };
}
