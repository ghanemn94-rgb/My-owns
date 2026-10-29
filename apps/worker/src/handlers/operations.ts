// operations job handlers (P6; ADR-0053 §2, §3, §6; REQ-S12-019 "when a connector or job fails or data becomes stale,
// create a visible operational exception and retain last known values with freshness labels"; p6-work-split §J/C.4;
// T-DG6-BE-K2; stub by T-DG6-BE-A). Three jobs, each under its own service identity (ADR-0053 §1; `defineJob`;
// migration 0116), each idempotent:
//
// kpi.freshness_scan (hourly, 0116). Per organization, through the job's principal (`transformation.read` for the KPI
//   reads, `operations.read` for the exception reads; a narrowed grant fails the run with service_identity.out_of_scope):
//   every active KPI definition is read as the DG4 panel reads it for its transformation and current reporting period
//   (the latest period evaluation with the ADR-0028 read-time staleness rule of @mth/shared; the twin of
//   apps/api operations/exceptions.ts `linkedKpiStatus`, itself the parity of kpi/kpi-status.ts). Nothing is written to
//   any KPI table: the value and its freshness label stay DG4's (ADR-0053 §2 "retain last known values").
//     - `stale`  -> one `data.stale` outbox event per stale EPISODE, key `data.stale:<kpiId>:<dataAsOf>` (UNIQUE
//                   outbox_event_idempotency_key: a replay or the next hourly scan of the same episode writes nothing);
//     - `fresh`  -> its active `data_stale` exception (if any) resolved `recovered` (no user), with its audit event;
//     - `unknown`-> nothing (no data is not stale data, and it is not a recovery either).
// operations.exception_raise (consumer of data.stale; starter 16 version 2, `withStarterRule`, so each event is one
//   automation_execution of `starter.job_failed` v2). Once per event (runOnce on the idempotency key), the KPI is read
//   through the principal (`requireServiceRead`), then the `data_freshness:kpi:<id>:data_stale` exception is opened or
//   recurred under lock 730305 (the kit twin of the API raise service), linked to the KPI (operational_exception_kpi).
// operations.exception_alerts (every minute, 0116). ADR-0053 §6 error alerts, for every exception OPENED by any raiser
//   (the kit's job-failure hook, this file's raise consumer, the API heartbeat watch, slice B's connector run): once per
//   exception (processed_message `operations.exception_alert` keyed by the exception id), in one transaction, one
//   in-app notification to each active holder of `operations.acknowledge` (organization-level holders of the
//   exception's organization, or of every organization for a platform exception; plus the holders at a linked
//   transformation, who may acknowledge it too, ADR-0053 §9), dedupe `operational_exception:<id>:opened:<userId>`;
//   after the COMMIT one structured log line at level `error` with `alert: true` and `alertCode` = the failure class.
//   The API heartbeat watch already writes the log line of `heartbeat_missed` itself (the worker is the one that is
//   down), so that class gets only the in-app notification here. A recurrence never alerts (the ledger is per
//   exception). Exceptions opened more than 24 hours before the sweep are not alerted (start-up backlog bound).
//
// Notifications store a message key and parameters, never a sentence (§2 rule 6). Nothing here approves anything:
// acknowledging an operational exception is not a business approval (G1-G6), and nothing reads or writes DG0-DG7.
import { insertAuditEvent, sql, type Db, type DbOrTx, type Tx } from "@mth/db";
import { withReadTimeStaleness, type KpiReasonCode, type KpiValueStatus } from "@mth/shared/calc";
import { canonicalDecimal, dataStaleV1, outboxEnvelope, type DataStaleV1 } from "@mth/shared/schemas";
import { z } from "zod";
import { withStarterRule } from "../automation/starters.ts";
import {
  defineJob,
  jobActor,
  raiseOperationalExceptionTwin,
  recoverOperationalExceptionTwin,
  requireServiceRead,
  runOnce,
  serviceReadScopeFor,
  ServiceScopeViolation,
  type JobRunContext,
  type LoadedServiceIdentity,
  type ServicePrincipal,
} from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const FRESHNESS_SCAN_QUEUE = "kpi.freshness_scan";
export const EXCEPTION_RAISE_QUEUE = "operations.exception_raise";
export const EXCEPTION_ALERTS_QUEUE = "operations.exception_alerts";
export const DATA_STALE_EVENT = "data.stale";
/** The starter rule whose version 2 names data.stale (0116). */
export const STARTER_JOB_FAILED = "starter.job_failed";
/** The exception's `last_error_code` for stale data (an i18n key, ADR-0053 §2). */
export const DATA_STALE_ERROR_CODE = "kpi.stale";
/** The processed_message consumer of the alert sweep (one alert per exception). */
export const EXCEPTION_ALERT_LEDGER = "operations.exception_alert";
/** The inbox message key of an alert (rendered by the web from en/ar catalogues; never a stored sentence). */
export const EXCEPTION_OPENED_MESSAGE = "operations.exception_opened";
/** ADR-0053 §6: the recipients' permission. */
export const ACKNOWLEDGE_PERMISSION = "operations.acknowledge";
/** The DG4 default when a KPI version names no staleness window (kpi-status.ts; ADR-0028). */
export const DEFAULT_STALE_AFTER_DAYS = 45;
/** The sweep alerts exceptions opened at most this long ago (the backlog bound at start-up). */
export const ALERT_LOOKBACK_HOURS = 24;
/** At most this many exceptions are alerted per sweep run (the rest wait for the next minute). */
export const ALERT_BATCH_SIZE = 100;

const TR = "transformation.read";
const OPS_READ = "operations.read";
const ACCESS_READ = "access.read";

// ------------------------------------------------------------------------------------------------ alert log line

/** The structured logger the alert line goes to (ADR-0053 §4, §6); the worker's JSON stderr line by default. */
export interface OperationsAlertLogger {
  error(obj: object, msg: string): void;
}
const stderrLogger: OperationsAlertLogger = {
  error: (obj, msg) => console.error(JSON.stringify({ level: "error", time: Date.now(), msg, ...obj })),
};
let alertLogger: OperationsAlertLogger = stderrLogger;

/** Sets the alert logger (main.ts may pass its redacting pino instance; tests capture the lines). Returns the old one. */
export function setOperationsAlertLogger(logger: OperationsAlertLogger | null): OperationsAlertLogger {
  const previous = alertLogger;
  alertLogger = logger ?? stderrLogger;
  return previous;
}

// ------------------------------------------------------------------------------------------------ helpers

/** The grant a run needs, checked once: a narrowed grant fails the run visibly (ADR-0053 §1 out_of_scope). */
function requireGrant(identity: LoadedServiceIdentity, codes: readonly string[]): void {
  for (const code of codes) if (!identity.grantedPermissionCodes.includes(code)) throw new ServiceScopeViolation();
}

/** Optional job data: `{ organizationId }` limits a run to one organization (run-now, tests); scheduled runs pass none. */
const scopeInput = z.object({ organizationId: z.uuid().optional() }).loose();
function organizationFilter(data: unknown): string | null {
  const r = scopeInput.safeParse(data ?? {});
  return r.success ? (r.data.organizationId ?? null) : null;
}

async function organizationsOf(db: DbOrTx, only: string | null): Promise<string[]> {
  let q = db.selectFrom("organization").select("id").orderBy("id");
  if (only !== null) q = q.where("id", "=", only);
  return (await q.execute()).map((r) => r.id);
}

/** The organization's business date (DG4 `businessDateOf`: the default active calendar's zone, else the organization's). */
async function businessDateOf(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

/** One KPI as the DG4 panel shows it (freshness, last value, data-as-of); the twin of the API's linkedKpiStatus. */
export interface KpiFreshnessRead {
  readonly kpiDefinitionId: string;
  readonly transformationId: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  /** Decimal string; null = Unknown (never 0). */
  readonly lastValue: string | null;
  /** Business date (YYYY-MM-DD) of the last accepted data; null when Unknown. */
  readonly dataAsOf: string | null;
  readonly staleAfterDays: number;
}

/**
 * The DG4 read of one KPI at transformation scope for its current reporting period: the latest open or closed period of
 * its frequency, the newest evaluation of that period (by calculation run), and the read-time staleness rule of
 * @mth/shared (ADR-0028), unchanged. Reads only; a missing version, period or evaluation is Unknown with a null value.
 */
export async function kpiFreshness(
  db: DbOrTx,
  kpi: { id: string; organization_id: string; transformation_id: string; frequency: string },
  businessDate: string,
): Promise<KpiFreshnessRead> {
  const version = await db
    .selectFrom("kpi_version")
    .select("dq_stale_after_days")
    .where("kpi_definition_id", "=", kpi.id)
    .where("status", "=", "active")
    .executeTakeFirst();
  const staleAfterDays = version?.dq_stale_after_days ?? DEFAULT_STALE_AFTER_DAYS;
  const unknown: KpiFreshnessRead = {
    kpiDefinitionId: kpi.id,
    transformationId: kpi.transformation_id,
    freshness: "unknown",
    lastValue: null,
    dataAsOf: null,
    staleAfterDays,
  };
  if (!version) return unknown;
  const period = await db
    .selectFrom("reporting_period")
    .select("id")
    .where("organization_id", "=", kpi.organization_id)
    .where("frequency", "=", kpi.frequency)
    .where("status", "in", ["open", "closed"])
    .orderBy("period_end", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!period) return unknown;
  const evaluation = await db
    .selectFrom("kpi_evaluation as e")
    .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
    .select(["e.value", "e.value_status", "e.value_reason", "e.calculated_rag", "e.explanation_key", "e.data_as_of"])
    .where("e.kpi_definition_id", "=", kpi.id)
    .where("e.scope_kind", "=", "transformation")
    .where("e.scope_id", "=", kpi.transformation_id)
    .where("e.reporting_period_id", "=", period.id)
    .where("e.value_basis", "=", "period")
    .orderBy("r.seq", "desc")
    .limit(1)
    .executeTakeFirst();
  if (!evaluation) return unknown;
  const read = withReadTimeStaleness(
    {
      value: evaluation.value,
      valueStatus: evaluation.value_status as KpiValueStatus,
      valueReason: evaluation.value_reason as KpiReasonCode | null,
      calculatedRag: evaluation.calculated_rag as never,
      explanationKey: evaluation.explanation_key as never,
      dataAsOf: evaluation.data_as_of,
    },
    staleAfterDays,
    businessDate,
  );
  const status = read.freshness.status;
  return {
    ...unknown,
    freshness: status === "stale" ? "stale" : status === "fresh" ? "fresh" : "unknown",
    lastValue: read.value === null ? null : canonicalDecimal(read.value),
    dataAsOf: read.freshness.dataAsOf,
  };
}

/** The exception key of a KPI's stale data (ADR-0053 §2: source `kpi:<kpi definition id>`). */
export const dataStaleKey = (organizationId: string, kpiDefinitionId: string) =>
  ({
    organizationId,
    sourceKind: "data_freshness",
    sourceCode: `kpi:${kpiDefinitionId}`,
    failureClass: "data_stale",
  }) as const;

/** The outbox idempotency key of one stale episode of a KPI. */
export const dataStaleEventKey = (kpiDefinitionId: string, dataAsOf: string) =>
  `${DATA_STALE_EVENT}:${kpiDefinitionId}:${dataAsOf}`;

// ------------------------------------------------------------------------------------------------ kpi.freshness_scan

export interface FreshnessScanResult {
  readonly organizations: number;
  readonly kpis: number;
  readonly stale: number;
  /** data.stale events written (new stale episodes). */
  readonly emitted: number;
  /** `data_stale` exceptions resolved `recovered`. */
  readonly recovered: number;
}

async function activeStaleExceptionIds(db: DbOrTx, organizationId: string): Promise<Set<string>> {
  const rows = await db
    .selectFrom("operational_exception")
    .select("source_code")
    .where("organization_id", "=", organizationId)
    .where("source_kind", "=", "data_freshness")
    .where("failure_class", "=", "data_stale")
    .where("status", "in", ["open", "acknowledged"])
    .execute();
  return new Set(rows.map((r) => r.source_code));
}

export async function runFreshnessScan(
  db: Db,
  data: unknown,
  jobId: string,
  run: JobRunContext,
): Promise<FreshnessScanResult> {
  requireGrant(run.identity, [TR, OPS_READ]);
  const actor = jobActor(jobId);
  let organizations = 0;
  let kpis = 0;
  let stale = 0;
  let emitted = 0;
  let recovered = 0;
  for (const organizationId of await organizationsOf(db, organizationFilter(data))) {
    organizations += 1;
    const principal: ServicePrincipal = run.principal(organizationId);
    const scope = await serviceReadScopeFor(db, principal, TR);
    const definitions = await db
      .selectFrom("kpi_definition as d")
      .select(["d.id", "d.organization_id", "d.transformation_id", "d.frequency"])
      .where("d.status", "=", "active")
      .where(
        scope.predicate({ recordType: null, recordId: sql.ref("d.id"), organizationId: sql.ref("d.organization_id") }),
      )
      .orderBy("d.id")
      .execute();
    if (definitions.length === 0) continue;
    const active = await activeStaleExceptionIds(db, organizationId);
    const businessDate = await businessDateOf(db, organizationId);
    for (const d of definitions) {
      kpis += 1;
      const read = await kpiFreshness(db, d, businessDate);
      if (read.freshness === "stale" && read.dataAsOf !== null) {
        stale += 1;
        const payload: DataStaleV1 = {
          kpiId: d.id,
          transformationId: d.transformation_id,
          dataAsOf: read.dataAsOf,
          staleAfterDays: read.staleAfterDays,
        };
        const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(db)).rows[0]!.id;
        const inserted = await db
          .insertInto("outbox_event")
          .values({
            id,
            organization_id: organizationId,
            aggregate_type: "kpi_definition",
            aggregate_id: d.id,
            event_type: DATA_STALE_EVENT,
            schema_version: 1,
            idempotency_key: dataStaleEventKey(d.id, read.dataAsOf),
            payload: JSON.stringify(dataStaleV1.parse(payload)),
          })
          .onConflict((oc) => oc.column("idempotency_key").doNothing())
          .returning("id")
          .executeTakeFirst();
        if (inserted) emitted += 1;
      } else if (read.freshness === "fresh" && active.has(`kpi:${d.id}`)) {
        const resolved = await db
          .transaction()
          .execute((tx) => recoverOperationalExceptionTwin(tx, actor, dataStaleKey(organizationId, d.id)));
        if (resolved !== null) recovered += 1;
      }
    }
  }
  return { organizations, kpis, stale, emitted, recovered };
}

// ------------------------------------------------------------------------------------------------ operations.exception_raise

export type ExceptionRaiseResult =
  | { readonly outcome: "done"; readonly exceptionId: string; readonly raised: "opened" | "recurred" }
  | { readonly outcome: "duplicate" }
  | { readonly outcome: "skipped"; readonly reason: "kpi_missing" };

export async function raiseFromDataStale(
  db: Db,
  data: unknown,
  jobId: string,
  run: JobRunContext,
): Promise<ExceptionRaiseResult> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== DATA_STALE_EVENT)
    throw new Error(`${EXCEPTION_RAISE_QUEUE}: unexpected event ${envelope.eventType}`);
  const p = dataStaleV1.parse(envelope.payload);
  requireGrant(run.identity, [TR, OPS_READ]);
  const principal = run.principal(envelope.organizationId);
  const scope = await serviceReadScopeFor(db, principal, TR);
  const r = await runOnce(db, EXCEPTION_RAISE_QUEUE, envelope.idempotencyKey, async (tx) => {
    const kpi = await tx
      .selectFrom("kpi_definition")
      .select(["id", "organization_id", "transformation_id"])
      .where("id", "=", p.kpiId)
      .executeTakeFirst();
    if (kpi === undefined || kpi.transformation_id !== p.transformationId) return null;
    requireServiceRead(scope, { recordType: null, recordId: kpi.id, organizationId: kpi.organization_id });
    return raiseOperationalExceptionTwin(tx, jobActor(jobId), {
      ...dataStaleKey(kpi.organization_id, kpi.id),
      errorCode: DATA_STALE_ERROR_CODE,
      errorMessage: `The KPI's last accepted data (as of ${p.dataAsOf}) is older than its ${p.staleAfterDays}-day freshness window.`,
      serviceIdentityId: run.identity.id,
      kpiLinks: [{ kpiDefinitionId: kpi.id, transformationId: kpi.transformation_id }],
    });
  });
  if (r.outcome === "duplicate") return { outcome: "duplicate" };
  if (r.result === null) return { outcome: "skipped", reason: "kpi_missing" };
  return { outcome: "done", exceptionId: r.result.exceptionId, raised: r.result.outcome };
}

// ------------------------------------------------------------------------------------------------ operations.exception_alerts

export interface AlertSweepResult {
  readonly candidates: number;
  readonly alerted: number;
  readonly notifications: number;
}

interface AlertCandidate {
  readonly id: string;
  readonly organization_id: string | null;
  readonly source_kind: string;
  readonly source_code: string;
  readonly failure_class: string;
}

/** The active holders of operations.acknowledge to alert for one exception, with the organization of each notification. */
export async function alertRecipients(
  tx: DbOrTx,
  exception: Pick<AlertCandidate, "id" | "organization_id">,
): Promise<{ userId: string; organizationId: string }[]> {
  const r = await sql<{ user_id: string; organization_id: string }>`
    SELECT DISTINCT sa.user_id, sa.organization_id
    FROM scoped_assignment sa
    JOIN role r ON r.id = sa.role_id
    JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${ACKNOWLEDGE_PERMISSION}
    JOIN app_user u ON u.id = sa.user_id AND u.status = 'active'
    WHERE sa.revoked_at IS NULL AND sa.effective_from <= now() AND (sa.effective_to IS NULL OR sa.effective_to > now())
      AND (
        (sa.scope_type = 'organization' AND sa.scope_id = sa.organization_id
          AND (${exception.organization_id}::uuid IS NULL OR sa.organization_id = ${exception.organization_id}::uuid))
        OR EXISTS (
          SELECT 1 FROM operational_exception_kpi l JOIN transformation t ON t.id = l.transformation_id
          WHERE l.operational_exception_id = ${exception.id}::uuid AND sa.organization_id = t.organization_id
            AND ((sa.scope_type = 'transformation' AND sa.scope_id = t.id)
              OR (r.inherits_downward AND sa.scope_type = 'business_unit'
                  AND sa.scope_id IN (SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = t.business_unit_id))))
      )
    ORDER BY sa.organization_id, sa.user_id`.execute(tx);
  return r.rows.map((x) => ({ userId: x.user_id, organizationId: x.organization_id }));
}

/** The alert of one exception, once (ledger), in one transaction: its in-app notifications. Null when already alerted. */
async function alertOnce(tx: Tx, jobId: string, e: AlertCandidate): Promise<number | null> {
  const ledger = await tx
    .insertInto("processed_message")
    .values({ consumer: EXCEPTION_ALERT_LEDGER, idempotency_key: e.id, outcome: "done" })
    .onConflict((oc) => oc.doNothing())
    .returning("consumer")
    .executeTakeFirst();
  if (!ledger) return null;
  const actor = jobActor(jobId);
  let created = 0;
  for (const to of await alertRecipients(tx, e)) {
    const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
    const dedupeKey = `operational_exception:${e.id}:opened:${to.userId}`;
    const inserted = await tx
      .insertInto("inbox_notification")
      .values({
        id,
        organization_id: to.organizationId,
        transformation_id: null,
        recipient_user_id: to.userId,
        work_item_id: null,
        link_path: `/admin/operations/exceptions/${e.id}`,
        message_key: EXCEPTION_OPENED_MESSAGE,
        message_params: JSON.stringify({
          failureClass: e.failure_class,
          sourceKind: e.source_kind,
          sourceCode: e.source_code,
        }),
        dedupe_key: dedupeKey,
        created_by: null,
        updated_by: null,
      })
      .onConflict((oc) => oc.columns(["organization_id", "dedupe_key"]).doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) continue;
    created += 1;
    await insertAuditEvent(tx, actor, {
      action: "inbox_notification.create",
      recordType: "inbox_notification",
      recordId: id,
      organizationId: to.organizationId,
      newVersion: 1,
      changes: {
        recipient_user_id: { from: null, to: to.userId },
        dedupe_key: { from: null, to: dedupeKey },
        message_key: { from: null, to: EXCEPTION_OPENED_MESSAGE },
      },
    });
  }
  return created;
}

export async function runAlertSweep(
  db: Db,
  data: unknown,
  jobId: string,
  run: JobRunContext,
): Promise<AlertSweepResult> {
  requireGrant(run.identity, [OPS_READ, ACCESS_READ]);
  const only = organizationFilter(data);
  let q = db
    .selectFrom("operational_exception as e")
    .select(["e.id", "e.organization_id", "e.source_kind", "e.source_code", "e.failure_class"])
    .where(sql<boolean>`e.first_occurred_at > now() - make_interval(hours => ${ALERT_LOOKBACK_HOURS})`)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom("processed_message as m")
            .select("m.consumer")
            .where("m.consumer", "=", EXCEPTION_ALERT_LEDGER)
            .whereRef("m.idempotency_key", "=", sql<string>`e.id::text`),
        ),
      ),
    )
    .orderBy("e.first_occurred_at")
    .orderBy("e.id")
    .limit(ALERT_BATCH_SIZE);
  // A run limited to one organization (run-now, tests) alerts that organization's exceptions only.
  if (only !== null) q = q.where("e.organization_id", "=", only);
  const candidates = await q.execute();
  let alerted = 0;
  let notifications = 0;
  for (const e of candidates) {
    const created = await db.transaction().execute((tx) => alertOnce(tx, jobId, e));
    if (created === null) continue;
    alerted += 1;
    notifications += created;
    // ADR-0053 §6 (a), after the COMMIT; the API watch logs heartbeat_missed itself.
    if (e.failure_class !== "heartbeat_missed")
      alertLogger.error(
        {
          alert: true,
          alertCode: e.failure_class,
          exceptionId: e.id,
          organizationId: e.organization_id,
          sourceKind: e.source_kind,
          sourceCode: e.source_code,
          queue: EXCEPTION_ALERTS_QUEUE,
          jobId,
          serviceIdentity: run.identity.code,
        },
        "operational exception opened",
      );
  }
  return { candidates: candidates.length, alerted, notifications };
}

// ------------------------------------------------------------------------------------------------ registration

export const FRESHNESS_SCAN_HANDLER: JobHandler = defineJob({
  queue: FRESHNESS_SCAN_QUEUE,
  handle: (db, data, jobId, _attempt, run) => runFreshnessScan(db, data, jobId, run),
});

/** The data.stale consumer, recorded as an execution of starter 16 (its version 2 names data.stale; 0116). */
export const EXCEPTION_RAISE_HANDLER: JobHandler = withStarterRule(
  STARTER_JOB_FAILED,
  defineJob({
    queue: EXCEPTION_RAISE_QUEUE,
    handle: (db, data, jobId, _attempt, run) => raiseFromDataStale(db, data, jobId, run),
  }),
);

export const EXCEPTION_ALERTS_HANDLER: JobHandler = defineJob({
  queue: EXCEPTION_ALERTS_QUEUE,
  handle: (db, data, jobId, _attempt, run) => runAlertSweep(db, data, jobId, run),
});

export const OPERATIONS_HANDLERS: readonly JobHandler[] = [
  FRESHNESS_SCAN_HANDLER,
  EXCEPTION_RAISE_HANDLER,
  EXCEPTION_ALERTS_HANDLER,
];
