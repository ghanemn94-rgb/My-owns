// integrations job handlers (P6; ADR-0055 §2, ADR-0053 §1-§3; REQ-S17-001, REQ-S17-005; p6-work-split §B/A.2;
// T-DG6-BE-L2; stub by T-DG6-BE-A). Both run under their own service identity (`defineJob`; migration 0116) and never
// approve anything; nothing here reads or writes DG0-DG7.
//
// integrations.connector_run (every minute): the cadence schedule. For every ENABLED pull connector (test adapter or
// http_pull) whose current configuration has an hourly, daily or weekly cadence, the slot that contains now (in the
// organization's time zone; weeks start on Sunday) becomes ONE queued run with idempotency key
// `schedule:<connector id>:<slot start ISO>`, under lock 730310 (connectorRun, key connector id), with its audit event
// (actor service, source worker). A slot is skipped while the connector has an active run (one active run per
// connector) and created at the next minute once it has none; a replay finds the key and creates nothing (exactly once:
// the run's unique key per connector is the backstop). The run is executed by the API's run watch.
//
// integrations.connector_exception (outbox consumer): `connector.run_failed` (the LAST failure of a run chain, written in
// the run's failing transaction) opens or recurs the connector's operational exception of its failure class, linked to
// the KPIs the event names (the KPIs the run feeds, computed by the API; T-DG6-BE-X2), and
// `connector.run_recovered` resolves the connector's active exceptions `recovered` (ADR-0053 §2), each with the BE-K kit
// twin under lock 730305, once per outbox event (processed_message ledger).
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import { connectorRunFailedV1, connectorRunRecoveredV1, outboxEnvelope } from "@mth/shared/schemas";
import {
  defineJob,
  jobActor,
  raiseOperationalExceptionTwin,
  recoverOperationalExceptionTwin,
  runOnce,
  ServiceScopeViolation,
  type ExceptionKey,
  type JobRunContext,
} from "../kit.ts";
import type { JobHandler } from "./spec.ts";

export const CONNECTOR_RUN_QUEUE = "integrations.connector_run";
export const CONNECTOR_EXCEPTION_QUEUE = "integrations.connector_exception";
/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `connectorRun` (the worker imports no API code). */
export const CONNECTOR_RUN_LOCK = 730310;
const CONNECTOR_FAILURE_CLASSES = [
  "connector_run_failed",
  "connector_unreachable",
  "connector_credentials_rejected",
] as const;

export interface CadenceSlot {
  readonly connectorId: string;
  readonly organizationId: string;
  readonly cadence: "hourly" | "daily" | "weekly";
  /** The slot's start (ISO, UTC). */
  readonly slotStart: string;
}

export interface CadenceOutcome {
  readonly created: readonly { readonly connectorId: string; readonly runId: string; readonly key: string }[];
  /** Slots whose run exists already (a replay) or that wait for an active run to finish. */
  readonly skipped: readonly {
    readonly connectorId: string;
    readonly key: string;
    readonly why: "exists" | "active";
  }[];
}

/**
 * The due slots of every enabled pull connector with a cadence, at `at` (default now()). The slot start is computed in
 * the organization's configured time zone (`organization.default_timezone`, default Asia/Riyadh; never hard-coded).
 */
export async function dueCadenceSlots(
  db: Db | Tx,
  at: Date | null = null,
  onlyConnectors: readonly string[] | null = null,
): Promise<CadenceSlot[]> {
  const now = at === null ? sql<Date>`now()` : sql<Date>`${at.toISOString()}::timestamptz`;
  const scope = onlyConnectors === null ? sql<boolean>`true` : sql<boolean>`c.id = ANY(${[...onlyConnectors]}::uuid[])`;
  const r = await sql<{ connector_id: string; organization_id: string; cadence: CadenceSlot["cadence"]; slot: Date }>`
    SELECT c.id AS connector_id, c.organization_id, v.cadence,
           CASE v.cadence
             WHEN 'hourly' THEN date_trunc('hour', ${now} AT TIME ZONE o.default_timezone) AT TIME ZONE o.default_timezone
             WHEN 'daily' THEN date_trunc('day', ${now} AT TIME ZONE o.default_timezone) AT TIME ZONE o.default_timezone
             ELSE (date_trunc('week', (${now} AT TIME ZONE o.default_timezone) + interval '1 day') - interval '1 day')
                  AT TIME ZONE o.default_timezone
           END AS slot
      FROM connector c
      JOIN connector_config_version v ON v.connector_id = c.id AND v.version_no = c.config_version_no
      JOIN organization o ON o.id = c.organization_id
     WHERE ${scope} AND c.status = 'enabled' AND c.adapter_kind IN ('test_adapter', 'http_pull')
       AND v.cadence IN ('hourly', 'daily', 'weekly')
     ORDER BY c.id`.execute(db);
  return r.rows.map((row) => ({
    connectorId: row.connector_id,
    organizationId: row.organization_id,
    cadence: row.cadence,
    slotStart: new Date(row.slot).toISOString(),
  }));
}

export const scheduleKey = (connectorId: string, slotStart: string) => `schedule:${connectorId}:${slotStart}`;

/** Creates the due slots' runs once each (see the file header). */
export async function createCadenceRuns(
  db: Db,
  jobId: string,
  run: Pick<JobRunContext, "principal">,
  at: Date | null = null,
  /** Tests: only these connectors (suites share one database). */
  onlyConnectors: readonly string[] | null = null,
): Promise<CadenceOutcome> {
  const created: { connectorId: string; runId: string; key: string }[] = [];
  const skipped: { connectorId: string; key: string; why: "exists" | "active" }[] = [];
  for (const slot of await dueCadenceSlots(db, at, onlyConnectors)) {
    // The job reads connectors through its declared identity: connector.read in the connector's organization.
    if (!run.principal(slot.organizationId).permissions.has("connector.read")) throw new ServiceScopeViolation();
    const key = scheduleKey(slot.connectorId, slot.slotStart);
    const outcome = await db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(${CONNECTOR_RUN_LOCK}::int4, hashtext(${slot.connectorId}::text))`.execute(
        tx,
      );
      const connector = await tx
        .selectFrom("connector")
        .select(["id", "organization_id", "status", "config_version_no"])
        .where("id", "=", slot.connectorId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (connector.status !== "enabled") return null;
      const existing = await tx
        .selectFrom("integration_run")
        .select("id")
        .where("connector_id", "=", connector.id)
        .where("idempotency_key", "=", key)
        .executeTakeFirst();
      if (existing) return { why: "exists" as const };
      const active = await tx
        .selectFrom("integration_run")
        .select("id")
        .where("connector_id", "=", connector.id)
        .where("status", "in", ["queued", "running"])
        .executeTakeFirst();
      if (active) return { why: "active" as const };
      const identity = await tx
        .selectFrom("service_identity")
        .select("id")
        .where("connector_id", "=", connector.id)
        .where("subject_kind", "=", "connector")
        .executeTakeFirstOrThrow();
      const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
      await tx
        .insertInto("integration_run")
        .values({
          id,
          organization_id: connector.organization_id,
          connector_id: connector.id,
          config_version_no: connector.config_version_no,
          trigger_kind: "schedule",
          idempotency_key: key,
          requested_by: null,
          service_identity_id: identity.id,
          queued_at: sql<Date>`now()`,
        })
        .execute();
      await insertAuditEvent(tx, jobActor(jobId), {
        action: "integration_run.queued",
        recordType: "integration_run",
        recordId: id,
        organizationId: connector.organization_id,
        newVersion: 1,
        changes: {
          connector_id: { from: null, to: connector.id },
          trigger_kind: { from: null, to: "schedule" },
          attempt_no: { from: null, to: 1 },
          retry_of_run_id: { from: null, to: null },
          config_version_no: { from: null, to: connector.config_version_no },
          status: { from: null, to: "queued" },
        },
      });
      return { runId: id };
    });
    if (outcome === null) continue;
    if ("runId" in outcome) created.push({ connectorId: slot.connectorId, runId: outcome.runId, key });
    else skipped.push({ connectorId: slot.connectorId, key, why: outcome.why });
  }
  return { created, skipped };
}

export const connectorRunHandler: JobHandler = defineJob({
  queue: CONNECTOR_RUN_QUEUE,
  handle: (db, _data, jobId, _attempt, run) => createCadenceRuns(db, jobId, run),
});

export interface ConnectorExceptionOutcome {
  readonly outcome: "raised" | "recovered" | "duplicate";
  readonly exceptionIds: readonly string[];
}

/** The `integrations.connector_exception` consumer (see the file header). */
export async function handleConnectorException(
  db: Db,
  data: unknown,
  jobId: string,
): Promise<ConnectorExceptionOutcome> {
  const envelope = outboxEnvelope.parse(data);
  const actor = jobActor(jobId);
  const r = await runOnce(db, CONNECTOR_EXCEPTION_QUEUE, envelope.idempotencyKey, async (tx) => {
    if (envelope.eventType === "connector.run_failed") {
      const p = connectorRunFailedV1.parse(envelope.payload);
      const raised = await raiseOperationalExceptionTwin(tx, actor, {
        organizationId: envelope.organizationId,
        sourceKind: "connector",
        sourceCode: p.connectorCode,
        failureClass: p.failureClass,
        errorCode: p.errorCode,
        errorMessage: p.errorMessage,
        serviceIdentityId: p.serviceIdentityId,
        // T-DG6-BE-X2 (F-DG6-QA-A-2; ADR-0053 §2): the KPIs the failing run feeds, as the API computed them in the run's
        // failing transaction (this job's identity reads no business record).
        kpiLinks: p.kpiLinks ?? [],
      });
      return { outcome: "raised" as const, exceptionIds: [raised.exceptionId] };
    }
    if (envelope.eventType === "connector.run_recovered") {
      const p = connectorRunRecoveredV1.parse(envelope.payload);
      const ids: string[] = [];
      for (const failureClass of CONNECTOR_FAILURE_CLASSES) {
        const key: ExceptionKey = {
          organizationId: envelope.organizationId,
          sourceKind: "connector",
          sourceCode: p.connectorCode,
          failureClass,
        };
        const id = await recoverOperationalExceptionTwin(tx, actor, key);
        if (id !== null) ids.push(id);
      }
      return { outcome: "recovered" as const, exceptionIds: ids };
    }
    throw new Error(`${CONNECTOR_EXCEPTION_QUEUE}: unexpected event ${envelope.eventType}`);
  });
  return r.outcome === "duplicate" ? { outcome: "duplicate", exceptionIds: [] } : r.result;
}

export const connectorExceptionHandler: JobHandler = defineJob({
  queue: CONNECTOR_EXCEPTION_QUEUE,
  handle: (db, data, jobId) => handleConnectorException(db, data, jobId),
});

export const INTEGRATIONS_HANDLERS: readonly JobHandler[] = [connectorRunHandler, connectorExceptionHandler];
