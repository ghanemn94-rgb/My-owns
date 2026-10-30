// Integration runs: queue, start, finish, retry with backoff, counts and reconciliation (ADR-0055 §2-§4, §8, §10;
// ADR-0056 §3-§5 for the run's staged batch; REQ-S17-001, REQ-S16-022, REQ-S17-005; p6-work-split §B/A.2;
// T-DG6-BE-L2). The routes are in routes.ts (run block).
//
// Authorization (0107; ADR-0055 §9): reading runs is `connector.read` exactly as reading the connector (organization
// level, or read-only at the transformation the current configuration targets; an unreadable connector or a run of
// another connector is 404). Queuing a manual run or a retry is `connector.run` (ADM_TECH, KDS) at the organization
// level: a reader without it gets 403 (AUD, TD, TO). `connector.run` is a write code, never a business-approval or
// Finance-validation code: running a connector approves nothing (G1-G6) and never touches DG0-DG7.
//
// The run (ADR-0055 §2 steps 1-4), `executeIntegrationRun`:
//   transaction 1 under the connectorRun advisory lock (key connector id): the run `queued` -> `running` (or, for a disabled
//     connector, `cancelled`); a `running` run is taken over only by the stale-run recovery (a worker or API process
//     that died between start and finish, A13);
//   OUTSIDE any transaction: resolve the credential references (SecretProvider), call the adapter's fetch (timeout),
//     check the rows (every cell text; every mapped source column present), map them to the target's columns and
//     validate them read-only through BE-M's engine (`prepareImport`);
//   transaction 2 under the same lock: stage the rows into an import_batch (`stageImportInTx`, source `connector`), set
//     the counts from the batch, compute the reconciliation with the shared decimal helper, `succeeded`; or `failed` with
//     its ADR-0055 §4 code. After a failure, while `attempt_no <= retry_max_attempts`, a `retry` run is queued in the
//     same transaction (key `retry:<failed run id>`); it becomes due `retry_backoff_seconds x 2^(attempt_no - 1)` after
//     the failure (bounded retries with exponential backoff, M0240). The LAST failure writes the outbox event
//     `connector.run_failed` in the same transaction; the worker's consumer opens or recurs the operational exception
//     (ADR-0053 §2) under the operational-exception lock (integrations never imports operations). A success after a failure writes
//     `connector.run_recovered` (the exception is resolved `recovered`).
//   A run never commits rows: committing a staged batch is ADR-0056 §6 (BE-M2's commit, by a human, or automatically
//   for `commit_mode = auto` through the auto-commit port below once BE-M2 registers it). Until then
//   `rows_committed` stays NULL (Unknown), never 0.
// Exactly once: the run's unique idempotency key per connector (`manual:<user>:<Idempotency-Key>` or
//   `manual:<request id>`, `schedule:<connector id>:<slot start ISO>`, `retry:<run id>`), the one-active-run index and the
//   0104 guard; a replay creates nothing. Counts not known are NULL ("Unknown"), never 0 (ADR-0055 §10).
//
// Who drives due runs (`connectorRunWatchStep`): the API process, every 10 s (registered by index.ts at onReady, the
// BE-K heartbeat-watch precedent). The worker cannot run them: staging validates rows through the import targets that
// the domains register in the API composition (server.ts), and the worker imports no API code (ADR-0002 rule 5). The
// worker's `integrations.connector_run` job creates the cadence slots (`schedule:<connector id>:<slot>`); this watch
// executes them, the manual runs and the due retries, and recovers stale running runs.
import { sql, type Db, type DbOrTx, type Tx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import type { FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, authorize, commitTimeDenial, refreshPrincipal, type Principal } from "../access/index.ts";
import { record as audit, type AuditContext } from "../audit/index.ts";
import { enqueueOutboxEvent } from "../jobs/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, iso, problems } from "../platform/index.ts";
import { createHttpPullAdapter } from "./adapters/http-pull.ts";
import {
  CONNECTOR_ERROR_CODES,
  CONNECTOR_ERROR_WHY,
  ConnectorAdapterError,
  connectorAdapters,
  type ConnectorAdapterKind,
  type ConnectorAdapterRegistry,
  type ConnectorErrorCode,
  type ConnectorFetchResult,
} from "./adapters/port.ts";
import { controlTotal, DECIMAL_TEXT, testAdapter, testAdapterFixtureRows } from "./adapters/test-adapter.ts";
import {
  adapterConfigOf,
  connectorRefusals,
  findConnector,
  toIntegrationRun,
  visibleConnector,
  type ConnectorConfigRow,
  type ConnectorRow,
  type FieldMapping,
  type IntegrationRunBody,
  type IntegrationRunRow,
} from "./connectors.ts";
import { prepareImport, stageImportInTx, type ImportBatchRow, type PreparedImport } from "./imports/staging.ts";
import { importTargetRegistry, type ImportTargetRegistry } from "./imports/targets.ts";
import { tableFromJsonItems } from "./imports/validate.ts";
import { resolveCredentials } from "./secret-refs.ts";

export const CONNECTOR_RUN: Permission = "connector.run";
/** How long a run waits for its adapter before it fails with connector.source_unavailable. */
export const RUN_ADAPTER_TIMEOUT_MS = 30_000;
/** A `running` run whose start is older than this is taken over by the recovery (2 x the adapter timeout + margin). */
export const STALE_RUNNING_SECONDS = 120;
/** How often the API process looks for due runs. */
export const RUN_WATCH_INTERVAL_MS = 10_000;
/** At most this many runs are executed per watch step (the rest wait for the next step). */
export const RUN_WATCH_BATCH = 10;
/** The template column whose decimals make the staged control total (ADR-0055 §10), per target kind. */
const CONTROL_COLUMN = "value";
/** The database cap of `integration_run.attempt_no` (0104: 1..6). */
const MAX_ATTEMPT_NO = 6;

// ------------------------------------------------------------------------------------------------ refusals

const conflict409 = (code: string, detail: string): HttpProblem =>
  new HttpProblem({ status: 409, type: PROBLEM_TYPES.invalidTransition, code, title: "Conflict", detail });

/** The run refusals of ADR-0055 §9 (English verbatim; codes are i18n keys under `problems.`). */
export const runRefusals = {
  disabled: () =>
    conflict409(
      "connector.disabled",
      "This connector is disabled. Enable it, or enter the data by form or import a file.",
    ),
  notRetryable: () => conflict409("integration_run.not_retryable", "Only a failed run can be retried, and only once."),
  retryLimitReached: (max: number) =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "integration_run.retry_limit_reached",
      title: "Business rule violated",
      detail: `This run reached the retry limit of ${max} attempts.`,
      params: { max: String(max) },
    }),
  runActive: connectorRefusals.runActive,
} as const;

// ------------------------------------------------------------------------------------------------ adapters

/** The adapters this process ships: the local test adapter and the generic http_pull adapter (ADR-0055 §3). */
export function installDefaultConnectorAdapters(registry: ConnectorAdapterRegistry = connectorAdapters()): void {
  if (registry.get("test_adapter") === undefined) registry.register(testAdapter);
  if (registry.get("http_pull") === undefined) registry.register(createHttpPullAdapter());
}

// ------------------------------------------------------------------------------------------------ authorization

async function holdsRunAtOrganization(db: DbOrTx, principal: Principal, organizationId: string): Promise<boolean> {
  return (await authorize(db, principal, CONNECTOR_RUN, { type: "organization", id: organizationId })).allowed;
}

/** The read gate (404) and the run gate (403) of runConnector / retryIntegrationRun, before the transaction. */
export async function requireConnectorRun(
  db: DbOrTx,
  principal: Principal,
  connectorId: string,
): Promise<ConnectorRow> {
  const row = await visibleConnector(db, principal, connectorId);
  if (!(await holdsRunAtOrganization(db, principal, row.organization_id))) throw problems.forbidden();
  return row;
}

/** Inside the transaction, after the lock: the caller's grants reloaded (a right lost meanwhile is 403, F-DG2-440). */
async function recheckRun(tx: Tx, request: FastifyRequest, connectorId: string): Promise<Principal> {
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireConnectorRun(tx, fresh, connectorId);
  } catch (err) {
    if (err instanceof HttpProblem && err.status === 404)
      throw problems.forbidden("Your access to this record changed while the request was in progress.");
    throw commitTimeDenial(err);
  }
  return fresh;
}

const lockConnectorRun = (tx: Tx, connectorId: string) =>
  sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.connectorRun}::int4, hashtext(${connectorId}::text))`.execute(
    tx,
  );

async function connectorIdentityId(db: DbOrTx, connectorId: string): Promise<string> {
  const identity = await db
    .selectFrom("service_identity")
    .select("id")
    .where("connector_id", "=", connectorId)
    .where("subject_kind", "=", "connector")
    .executeTakeFirstOrThrow();
  return identity.id;
}

async function activeRunOf(tx: Tx, connectorId: string): Promise<IntegrationRunRow | undefined> {
  return tx
    .selectFrom("integration_run")
    .selectAll()
    .where("connector_id", "=", connectorId)
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
}

interface QueueRunInput {
  readonly connector: ConnectorRow;
  readonly triggerKind: "manual" | "schedule" | "retry";
  readonly idempotencyKey: string;
  readonly requestedBy: string | null;
  readonly retryOf: IntegrationRunRow | null;
}

/** Inserts a `queued` run (version 1) acting as its connector's service identity, with its audit event. */
async function insertQueuedRun(tx: Tx, ctx: AuditContext, input: QueueRunInput): Promise<IntegrationRunRow> {
  const id = uuidv7();
  const attemptNo = input.retryOf === null ? 1 : input.retryOf.attempt_no + 1;
  const row = await tx
    .insertInto("integration_run")
    .values({
      id,
      organization_id: input.connector.organization_id,
      connector_id: input.connector.id,
      config_version_no: input.connector.config_version_no,
      trigger_kind: input.triggerKind,
      attempt_no: attemptNo,
      retry_of_run_id: input.retryOf?.id ?? null,
      idempotency_key: input.idempotencyKey,
      requested_by: input.requestedBy,
      service_identity_id: await connectorIdentityId(tx, input.connector.id),
      queued_at: sql<Date>`now()`,
      created_by: ctx.actorUserId,
      updated_by: ctx.actorUserId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, {
    action: "integration_run.queued",
    recordType: "integration_run",
    recordId: id,
    organizationId: input.connector.organization_id,
    newVersion: 1,
    changes: {
      connector_id: { from: null, to: input.connector.id },
      trigger_kind: { from: null, to: input.triggerKind },
      attempt_no: { from: null, to: attemptNo },
      retry_of_run_id: { from: null, to: input.retryOf?.id ?? null },
      config_version_no: { from: null, to: input.connector.config_version_no },
      status: { from: null, to: "queued" },
    },
  });
  return row;
}

// ------------------------------------------------------------------------------------------------ queue (API)

/** The stored key of a manual run: the caller's Idempotency-Key per user, else the request id. */
export function manualRunKey(userId: string, idempotencyKey: string | undefined, requestId: string): string {
  if (idempotencyKey !== undefined) return `manual:${userId}:${idempotencyKey}`;
  const id = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,150}$/.test(requestId) ? requestId : uuidv7();
  return `manual:${id}`;
}

/**
 * runConnector: queues a manual run of the CURRENT configuration (202). The same Idempotency-Key (per user) returns the
 * existing run (200, `replay`), before any state check, so a retried request never creates a second run.
 * 409 connector.disabled; 409 connector.run_active (one active run per connector).
 */
export async function queueManualRun(
  db: Db,
  request: FastifyRequest,
  connectorId: string,
  idempotencyKey: string | undefined,
): Promise<{ readonly run: IntegrationRunRow; readonly replay: boolean }> {
  return db.transaction().execute(async (tx) => {
    await lockConnectorRun(tx, connectorId);
    const connector = await findConnector(tx, connectorId, true);
    if (!connector) throw problems.notFound();
    const me = (await recheckRun(tx, request, connectorId)).userId!;
    const key = manualRunKey(me, idempotencyKey, request.id);
    const existing = await tx
      .selectFrom("integration_run")
      .selectAll()
      .where("connector_id", "=", connectorId)
      .where("idempotency_key", "=", key)
      .executeTakeFirst();
    if (existing) return { run: existing, replay: true };
    if (connector.status !== "enabled") throw runRefusals.disabled();
    if (await activeRunOf(tx, connectorId)) throw runRefusals.runActive();
    const run = await insertQueuedRun(tx, auditContextOf(request), {
      connector,
      triggerKind: "manual",
      idempotencyKey: key,
      requestedBy: me,
      retryOf: null,
    });
    return { run, replay: false };
  });
}

/** The most attempts a retry chain may reach: the first attempt plus the configured retries (database cap 6). */
export function attemptLimit(config: Pick<ConnectorConfigRow, "retry_max_attempts">): number {
  return Math.min(MAX_ATTEMPT_NO, 1 + config.retry_max_attempts);
}

/**
 * retryIntegrationRun: queues the retry of a FAILED run as its next attempt, once (202). 409
 * integration_run.not_retryable (not failed, or already retried: an automatic retry counts), 422
 * integration_run.retry_limit_reached (the chain is at the configured attempt limit), 409 connector.disabled,
 * 409 connector.run_active. The retry uses the connector's current configuration and is due at once (a human decided).
 */
export async function queueManualRetry(
  db: Db,
  request: FastifyRequest,
  connectorId: string,
  runId: string,
): Promise<IntegrationRunRow> {
  return db.transaction().execute(async (tx) => {
    await lockConnectorRun(tx, connectorId);
    const connector = await findConnector(tx, connectorId, true);
    if (!connector) throw problems.notFound();
    const me = (await recheckRun(tx, request, connectorId)).userId!;
    const failed = await tx
      .selectFrom("integration_run")
      .selectAll()
      .where("id", "=", runId)
      .where("connector_id", "=", connectorId)
      .forUpdate()
      .executeTakeFirst();
    if (!failed) throw problems.notFound();
    if (failed.status !== "failed") throw runRefusals.notRetryable();
    const retried = await tx
      .selectFrom("integration_run")
      .select("id")
      .where("retry_of_run_id", "=", runId)
      .executeTakeFirst();
    if (retried) throw runRefusals.notRetryable();
    const config = await configOf(tx, connector.id, connector.config_version_no);
    const limit = attemptLimit(config);
    if (failed.attempt_no >= limit) throw runRefusals.retryLimitReached(limit);
    if (connector.status !== "enabled") throw runRefusals.disabled();
    if (await activeRunOf(tx, connectorId)) throw runRefusals.runActive();
    return insertQueuedRun(tx, auditContextOf(request), {
      connector,
      triggerKind: "retry",
      idempotencyKey: `retry:${runId}`,
      requestedBy: me,
      retryOf: failed,
    });
  });
}

// ------------------------------------------------------------------------------------------------ reads

async function configOf(db: DbOrTx, connectorId: string, versionNo: number): Promise<ConnectorConfigRow> {
  return db
    .selectFrom("connector_config_version")
    .selectAll()
    .where("connector_id", "=", connectorId)
    .where("version_no", "=", versionNo)
    .executeTakeFirstOrThrow();
}

export interface RunListQuery {
  readonly status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  /** Exclusive bound (queued_at ISO, id) of the page, newest first (decoded cursor). */
  readonly after: readonly [string, string] | null;
  readonly limit: number;
}

/** The runs of a connector the caller may read (the caller checked visibleConnector), newest first. */
export async function listRuns(db: DbOrTx, connectorId: string, query: RunListQuery): Promise<IntegrationRunRow[]> {
  let q = db.selectFrom("integration_run").selectAll().where("connector_id", "=", connectorId);
  if (query.status) q = q.where("status", "=", query.status);
  if (query.after)
    q = q.where(sql<boolean>`(queued_at, id) < (${query.after[0]}::timestamptz, ${query.after[1]}::uuid)`);
  return q
    .orderBy("queued_at", "desc")
    .orderBy("id", "desc")
    .limit(query.limit + 1)
    .execute();
}

export async function findRunOf(db: DbOrTx, connectorId: string, runId: string): Promise<IntegrationRunRow> {
  const run = await db
    .selectFrom("integration_run")
    .selectAll()
    .where("id", "=", runId)
    .where("connector_id", "=", connectorId)
    .executeTakeFirst();
  if (!run) throw problems.notFound();
  return run;
}

/** The message parameters stored at the end of a failed run's message (`{name=…}`, `{column=…}`). */
function errorParams(run: IntegrationRunRow): Record<string, string> {
  const m = /\{(name|column)=([^}]{1,200})\}/g;
  return Object.fromEntries([...(run.error_message ?? "").matchAll(m)].map((hit) => [hit[1]!, hit[2]!]));
}

export interface IntegrationRunDetailBody {
  readonly run: IntegrationRunBody;
  readonly retriedByRunId: string | null;
  readonly events: {
    readonly recordVersion: number;
    readonly status: string;
    readonly rowsRead: number | null;
    readonly rowsStaged: number | null;
    readonly rowsCommitted: number | null;
    readonly rowsRejected: number | null;
    readonly rowsDuplicate: number | null;
    readonly errorCount: number | null;
    readonly errorCode: string | null;
    readonly occurredAt: string;
  }[];
  readonly actionableError: {
    readonly runId: string;
    readonly triggerKind: string;
    readonly attemptNo: number;
    readonly finishedAt: string;
    readonly errorCode: ConnectorErrorCode;
    readonly params: Record<string, string>;
    readonly fallbacks: ("kpi_form" | "import_file")[];
  } | null;
}

/** getIntegrationRun: the run, who retried it, its status history and, when failed, the actionable error. */
export async function toIntegrationRunDetail(
  db: DbOrTx,
  connector: ConnectorRow,
  run: IntegrationRunRow,
): Promise<IntegrationRunDetailBody> {
  const [retriedBy, events] = await Promise.all([
    db.selectFrom("integration_run").select("id").where("retry_of_run_id", "=", run.id).executeTakeFirst(),
    db
      .selectFrom("integration_run_event")
      .selectAll()
      .where("integration_run_id", "=", run.id)
      .orderBy("record_version")
      .execute(),
  ]);
  const actionable =
    run.status === "failed" &&
    run.finished_at !== null &&
    (CONNECTOR_ERROR_CODES as readonly (string | null)[]).includes(run.error_code);
  return {
    run: toIntegrationRun(run),
    retriedByRunId: retriedBy?.id ?? null,
    events: events.map((e) => ({
      recordVersion: e.record_version,
      status: e.status,
      rowsRead: e.rows_read,
      rowsStaged: e.rows_staged,
      rowsCommitted: e.rows_committed,
      rowsRejected: e.rows_rejected,
      rowsDuplicate: e.rows_duplicate,
      errorCount: e.error_count,
      errorCode: e.error_code,
      occurredAt: iso(e.occurred_at),
    })),
    actionableError: actionable
      ? {
          runId: run.id,
          triggerKind: run.trigger_kind,
          attemptNo: run.attempt_no,
          finishedAt: iso(run.finished_at!),
          errorCode: run.error_code as ConnectorErrorCode,
          params: errorParams(run),
          fallbacks: connector.target_kind === "kpi_actual" ? ["kpi_form", "import_file"] : [],
        }
      : null,
  };
}

// ------------------------------------------------------------------------------------------------ reconciliation

export type ReconciliationRule = "none" | "row_count" | "row_count_and_total";

export interface Reconciliation {
  readonly status: "not_checked" | "matched" | "mismatched" | "not_applicable";
  readonly sourceRowCount: number | null;
  readonly sourceControlTotal: string | null;
  readonly stagedControlTotal: string | null;
}

/**
 * ADR-0055 §2 step 3 and §10: `row_count` compares the source's row count with the rows read; `row_count_and_total`
 * also compares the source's control total with the staged control total, as DECIMALS (never floats). A figure the
 * source does not give leaves the check `not_checked` ("Not checked", never "matched" or green); `none` is
 * `not_applicable`. Shapes follow the 0104 CHECK integration_run_reconciliation_shape.
 */
export function reconcile(
  rule: ReconciliationRule,
  rowsRead: number,
  source: Pick<ConnectorFetchResult, "sourceRowCount" | "sourceControlTotal">,
  stagedControlTotal: string | null,
): Reconciliation {
  const none = { sourceRowCount: null, sourceControlTotal: null, stagedControlTotal: null };
  if (rule === "none") return { status: "not_applicable", ...none };
  if (source.sourceRowCount === null) return { status: "not_checked", ...none };
  const countMatches = source.sourceRowCount === rowsRead;
  if (rule === "row_count")
    return { status: countMatches ? "matched" : "mismatched", ...none, sourceRowCount: source.sourceRowCount };
  const sourceTotal =
    source.sourceControlTotal !== null && DECIMAL_TEXT.test(source.sourceControlTotal)
      ? source.sourceControlTotal
      : null;
  if (!countMatches)
    return {
      status: "mismatched",
      sourceRowCount: source.sourceRowCount,
      sourceControlTotal: sourceTotal,
      stagedControlTotal: sourceTotal === null ? null : stagedControlTotal,
    };
  if (sourceTotal === null) return { status: "not_checked", ...none };
  const totalsMatch = stagedControlTotal !== null && new D(sourceTotal).eq(new D(stagedControlTotal));
  return {
    status: totalsMatch ? "matched" : "mismatched",
    sourceRowCount: source.sourceRowCount,
    sourceControlTotal: sourceTotal,
    stagedControlTotal,
  };
}

/** Rows keyed by the target's columns: each mapping's source column becomes its target key (unmapped columns drop). */
export function mapRows(
  rows: readonly Readonly<Record<string, string>>[],
  mappings: readonly FieldMapping[],
): Record<string, string>[] {
  if (mappings.length === 0) return rows.map((r) => ({ ...r }));
  return rows.map((r) => {
    const cells = new Map(Object.entries(r));
    return Object.fromEntries(mappings.map((m) => [m.target, cells.get(m.source) ?? ""]));
  });
}

// ------------------------------------------------------------------------------------------------ the KPIs a run feeds

/** The column of the kpi_actual.v1 template that names the KPI (ADR-0056 §9; kpi/import-target.ts). */
export const KPI_ID_COLUMN = "kpi_id";
/** At most this many KPI links per failure event (the event schema's bound). */
export const MAX_RUN_KPI_LINKS = 100;
/** The connector's newest staged batches whose rows name the KPIs it fed before (bounded read). */
const FED_HISTORY_BATCHES = 10;
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RunKpiLink {
  readonly kpiDefinitionId: string;
  readonly transformationId: string;
}

/**
 * The KPIs a run of this connector feeds (T-DG6-BE-X2, F-DG6-QA-A-2; ADR-0053 §2 "connector classes: the KPIs the
 * connector's mappings feed", ADR-0055 §1-§3), for the operational exception of its last failure. Only a `kpi_actual`
 * connector with a target transformation feeds KPIs. The candidates are the KPI column (after the connector's field
 * mappings, `mapRows`) of
 *   - the rows its source defines without a network call (the test adapter's fixture, whatever its mode), and
 *   - the rows the connector staged before (its newest batches: run or webhook), which is what a failing `http_pull`
 *     source fed when it last answered;
 * kept only when the KPI is a non-archived definition of the connector's organization in its TARGET transformation (a
 * row naming any other KPI is a row reason at staging, never fed). Read-only; no remote I/O. Ordered by KPI id.
 */
export async function kpisFedBy(
  db: DbOrTx,
  connector: ConnectorRow,
  config: ConnectorConfigRow,
): Promise<RunKpiLink[]> {
  if (connector.target_kind !== "kpi_actual" || config.target_transformation_id === null) return [];
  const candidates = new Set<string>();
  if (connector.adapter_kind === "test_adapter") {
    const rows = testAdapterFixtureRows(adapterConfigOf(connector, config));
    for (const row of mapRows(rows, config.field_mappings as FieldMapping[])) {
      const kpi = new Map(Object.entries(row)).get(KPI_ID_COLUMN);
      if (kpi !== undefined) candidates.add(kpi.trim());
    }
  }
  const staged = await sql<{ kpi: string | null }>`
    SELECT DISTINCT coalesce(r.normalized ->> ${KPI_ID_COLUMN}, r.raw ->> ${KPI_ID_COLUMN}) AS kpi
      FROM import_row r
     WHERE r.import_batch_id IN (
             SELECT b.id FROM import_batch b
              WHERE b.connector_id = ${connector.id}::uuid
                AND b.transformation_id = ${config.target_transformation_id}::uuid
              ORDER BY b.created_at DESC, b.id DESC
              LIMIT ${FED_HISTORY_BATCHES})`.execute(db);
  for (const r of staged.rows) if (r.kpi !== null) candidates.add(r.kpi.trim());
  const ids = [...candidates].filter((c) => UUID_TEXT.test(c)).map((c) => c.toLowerCase());
  if (ids.length === 0) return [];
  const defs = await db
    .selectFrom("kpi_definition")
    .select(["id", "transformation_id"])
    .where("id", "in", ids)
    .where("organization_id", "=", connector.organization_id)
    .where("transformation_id", "=", config.target_transformation_id)
    .where("archived_at", "is", null)
    .orderBy("id")
    .limit(MAX_RUN_KPI_LINKS)
    .execute();
  return defs.map((d) => ({ kpiDefinitionId: d.id, transformationId: d.transformation_id }));
}

// ------------------------------------------------------------------------------------------------ the run engine

/** The redacted-by-construction message of a failed run: the code's "why" text and its parameters (as BE-L's test). */
export function failureMessage(code: string, params: Readonly<Record<string, string>>): string {
  const byName = new Map(Object.entries(params));
  const why = (new Map(Object.entries(CONNECTOR_ERROR_WHY)).get(code) ?? code).replace(
    /\{(name|column)\}/g,
    (_, k: string) => byName.get(k) ?? k,
  );
  const tail = Object.entries(params)
    .filter(([k]) => k === "name" || k === "column")
    .map(([k, v]) => ` {${k}=${v.replace(/[{}]/g, "")}}`)
    .join("");
  return `${why}${tail}`.slice(0, 2000);
}

/** The operational-exception class of a run's error code (ADR-0053 §2). */
export function failureClassOf(
  code: string,
): "connector_run_failed" | "connector_unreachable" | "connector_credentials_rejected" {
  if (code === "connector.source_unavailable" || code === "connector.stopped") return "connector_unreachable";
  if (code === "connector.credentials_rejected" || code === "connector.secret_unresolvable")
    return "connector_credentials_rejected";
  return "connector_run_failed";
}

/** What happens between the transactions (no database write; read-only queries for the validation only). */
type FetchStage =
  | {
      readonly ok: true;
      readonly fetched: ConnectorFetchResult;
      readonly mapped: Record<string, string>[];
      readonly prepared: PreparedImport | null;
    }
  | { readonly ok: false; readonly code: string; readonly params: Readonly<Record<string, string>> };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConnectorAdapterError("connector.source_unavailable")), ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The newest template of a target kind (the connector stages into it). */
function templateOf(registry: ImportTargetRegistry, kind: string): string | null {
  const versions = registry
    .list()
    .filter((t) => t.kind === kind)
    .map((t) => t.templateVersion);
  const no = (v: string) => Number(/\.v([1-9][0-9]*)$/.exec(v)?.[1] ?? 0);
  return versions.sort((a, b) => no(b) - no(a)).at(0) ?? null;
}

export interface ExecuteOptions {
  /** The adapters (default: this process's registry). */
  readonly adapters?: ConnectorAdapterRegistry;
  /** The import targets (default: this process's registry). */
  readonly targets?: ImportTargetRegistry;
  /** Take over a `running` run whose start is older than STALE_RUNNING_SECONDS (the crash recovery, A13). */
  readonly recover?: boolean;
  /** Tests: the staleness threshold of the recovery (default STALE_RUNNING_SECONDS). */
  readonly staleAfterSeconds?: number;
  /** Tests: the watch step considers only these connectors' runs (suites share one database). */
  readonly onlyConnectors?: readonly string[];
  readonly adapterTimeoutMs?: number;
  /** Test hook (QA-C's A13 hook): called after transaction 1 and the fetch, before transaction 2; a throw stops there. */
  readonly beforeFinish?: (runId: string) => void | Promise<void>;
}

export interface RunExecution {
  readonly outcome: "succeeded" | "failed" | "cancelled" | "skipped";
  readonly run: IntegrationRunRow | null;
  /** The automatic retry queued by this failure, if any. */
  readonly retryRunId: string | null;
}

const RUN_ACTOR = (runId: string): AuditContext => ({
  actorUserId: null,
  actorType: "service",
  requestId: `integration_run:${runId}`,
});

async function fetchStage(
  db: Db,
  connector: ConnectorRow,
  config: ConnectorConfigRow,
  identityCodes: readonly string[],
  since: Date | null,
  options: ExecuteOptions,
): Promise<FetchStage> {
  const adapter = (options.adapters ?? connectorAdapters()).get(connector.adapter_kind as ConnectorAdapterKind);
  if (!adapter || connector.adapter_kind === "webhook")
    return { ok: false, code: "connector.source_unavailable", params: {} };
  let fetched: ConnectorFetchResult;
  try {
    const credentials = await resolveCredentials(config.credential_refs);
    fetched = await withTimeout(
      adapter.fetch(adapterConfigOf(connector, config), { credentials, since }),
      options.adapterTimeoutMs ?? RUN_ADAPTER_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof ConnectorAdapterError) return { ok: false, code: err.code, params: err.params };
    return { ok: false, code: "connector.source_unavailable", params: {} };
  }
  const rows = Array.isArray(fetched?.rows) ? fetched.rows : null;
  const countOk =
    fetched?.sourceRowCount === null || (Number.isSafeInteger(fetched?.sourceRowCount) && fetched.sourceRowCount >= 0);
  if (rows === null || !countOk) return { ok: false, code: "connector.response_invalid", params: {} };
  for (const r of rows)
    if (r === null || typeof r !== "object" || Object.values(r).some((cell) => typeof cell !== "string"))
      return { ok: false, code: "connector.response_invalid", params: {} };
  const mappings = config.field_mappings as FieldMapping[];
  for (const m of mappings)
    if (rows.some((r) => !Object.hasOwn(r, m.source)))
      return { ok: false, code: "connector.mapping_mismatch", params: { column: m.source } };
  const mapped = mapRows(rows, mappings);
  if (connector.target_kind !== "kpi_actual" || config.target_transformation_id === null)
    return { ok: true, fetched, mapped, prepared: null };
  // The connector's service identity reads the target transformation (ADR-0053 §1: granted transformation.read). An
  // administrator who narrowed the grant stops the staging: the run fails with the identity's own code.
  if (!identityCodes.includes("transformation.read"))
    return { ok: false, code: "service_identity.out_of_scope", params: {} };
  const targets = options.targets ?? importTargetRegistry();
  const template = templateOf(targets, connector.target_kind);
  if (template === null) return { ok: false, code: "connector.response_invalid", params: {} };
  try {
    const prepared = await prepareImport(
      db,
      {
        templateVersion: template,
        transformationId: config.target_transformation_id,
        actorUserId: config.commit_on_behalf_of,
        table: tableFromJsonItems(mapped),
      },
      targets,
    );
    return { ok: true, fetched, mapped, prepared };
  } catch (err) {
    if (!(err instanceof HttpProblem)) throw err;
    if (err.code === "import.header_mismatch") return { ok: false, code: "connector.mapping_mismatch", params: {} };
    return { ok: false, code: "connector.response_invalid", params: {} };
  }
}

/**
 * Executes one run (ADR-0055 §2 steps 1-4). Safe to call twice, concurrently or after a crash: only the caller that
 * moves the run `queued -> running` (or a recovery of a stale `running` run) fetches, and only the first transaction
 * 2 that finds it `running` finishes it; every other call returns `skipped`.
 */
export async function executeIntegrationRun(
  db: Db,
  runId: string,
  options: ExecuteOptions = {},
): Promise<RunExecution> {
  const head = await db.selectFrom("integration_run").select("connector_id").where("id", "=", runId).executeTakeFirst();
  if (!head) return { outcome: "skipped", run: null, retryRunId: null };
  const ctx = RUN_ACTOR(runId);

  // Transaction 1: queued -> running (or cancelled for a disabled connector; or the take-over of a stale run).
  const started = await db.transaction().execute(async (tx) => {
    await lockConnectorRun(tx, head.connector_id);
    const run = await tx
      .selectFrom("integration_run")
      .selectAll()
      .where("id", "=", runId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (run.trigger_kind === "test" || run.trigger_kind === "webhook") return { kind: "skip" as const, run };
    const connector = (await findConnector(tx, run.connector_id))!;
    if (run.status === "running") {
      const stale = await sql<{
        stale: boolean;
      }>`SELECT ${run.started_at}::timestamptz <= now() - make_interval(secs => ${options.staleAfterSeconds ?? STALE_RUNNING_SECONDS}) AS stale`.execute(
        tx,
      );
      if (!options.recover || !stale.rows[0]!.stale) return { kind: "skip" as const, run };
      return { kind: "go" as const, run, connector };
    }
    if (run.status !== "queued") return { kind: "skip" as const, run };
    if (connector.status !== "enabled") {
      const cancelled = await tx
        .updateTable("integration_run")
        .set({ status: "cancelled", version: run.version + 1, updated_at: sql<Date>`now()`, updated_by: null })
        .where("id", "=", run.id)
        .where("version", "=", run.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(tx, ctx, {
        action: "integration_run.cancelled",
        recordType: "integration_run",
        recordId: run.id,
        organizationId: run.organization_id,
        priorVersion: run.version,
        newVersion: cancelled.version,
        reason: "The connector is disabled.",
        changes: { status: { from: "queued", to: "cancelled" } },
      });
      return { kind: "cancelled" as const, run: cancelled };
    }
    const running = await tx
      .updateTable("integration_run")
      .set({
        status: "running",
        started_at: sql<Date>`now()`,
        version: run.version + 1,
        updated_at: sql<Date>`now()`,
        updated_by: null,
      })
      .where("id", "=", run.id)
      .where("version", "=", run.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, ctx, {
      action: "integration_run.started",
      recordType: "integration_run",
      recordId: run.id,
      organizationId: run.organization_id,
      priorVersion: run.version,
      newVersion: running.version,
      changes: { status: { from: "queued", to: "running" } },
    });
    return { kind: "go" as const, run: running, connector };
  });
  if (started.kind === "skip") return { outcome: "skipped", run: started.run, retryRunId: null };
  if (started.kind === "cancelled") return { outcome: "cancelled", run: started.run, retryRunId: null };

  const { run, connector } = started;
  const config = await configOf(db, connector.id, run.config_version_no);
  const [identity, lastSuccess] = await Promise.all([
    db
      .selectFrom("service_identity")
      .select("granted_permission_codes")
      .where("id", "=", run.service_identity_id)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom("integration_run")
      .select("started_at")
      .where("connector_id", "=", connector.id)
      .where("status", "=", "succeeded")
      .where("trigger_kind", "!=", "test")
      .orderBy("finished_at", "desc")
      .limit(1)
      .executeTakeFirst(),
  ]);

  // Outside any transaction: credentials, the adapter call, the read-only validation.
  const stage = await fetchStage(
    db,
    connector,
    config,
    identity.granted_permission_codes,
    lastSuccess?.started_at ?? null,
    options,
  );
  if (options.beforeFinish) await options.beforeFinish(runId);

  // Transaction 2: stage and finish (succeeded), or finish failed and queue the retry or report the last failure.
  const finish = (s: FetchStage) =>
    db.transaction().execute(async (tx) => {
      await lockConnectorRun(tx, connector.id);
      const current = await tx
        .selectFrom("integration_run")
        .selectAll()
        .where("id", "=", runId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (current.status !== "running") return { outcome: "skipped" as const, run: current, retryRunId: null };
      const fresh = (await findConnector(tx, connector.id, true))!;
      return s.ok
        ? succeed(tx, ctx, current, fresh, config, s)
        : fail(tx, ctx, current, fresh, config, s.code, s.params);
    });
  try {
    return await finish(stage);
  } catch (err) {
    // The staging transaction refused (e.g. 409 import.form_schema_changed while the rows were checked): the run fails
    // and its retry (if any) stages again against the current form schema.
    if (!(err instanceof HttpProblem) || !stage.ok) throw err;
    return finish({ ok: false, code: "connector.response_invalid", params: {} });
  }
}

async function succeed(
  tx: Tx,
  ctx: AuditContext,
  run: IntegrationRunRow,
  connector: ConnectorRow,
  config: ConnectorConfigRow,
  s: Extract<FetchStage, { ok: true }>,
): Promise<RunExecution> {
  let batch: ImportBatchRow | null = null;
  if (s.prepared !== null)
    batch = await stageImportInTx(tx, s.prepared, {
      source: {
        kind: "connector",
        connectorId: connector.id,
        integrationRunId: run.id,
        commitMode: config.commit_mode === "auto" ? "auto" : "manual",
        onBehalfOfUserId: config.commit_mode === "auto" ? config.commit_on_behalf_of : null,
      },
      createdBy: null,
      audit: ctx,
    });
  const read = s.fetched.rows.length;
  const recon = reconcile(
    config.reconciliation_rule as ReconciliationRule,
    read,
    s.fetched,
    controlTotal(s.mapped, CONTROL_COLUMN),
  );
  const finished = await tx
    .updateTable("integration_run")
    .set({
      status: "succeeded",
      finished_at: sql<Date>`greatest(now(), ${run.started_at}::timestamptz)`,
      rows_read: read,
      rows_staged: batch?.rows_total ?? 0,
      rows_rejected: batch?.rows_invalid ?? 0,
      rows_duplicate: batch?.rows_duplicate ?? 0,
      error_count: batch?.rows_invalid ?? 0,
      reconciliation_status: recon.status,
      source_row_count: recon.sourceRowCount,
      source_control_total: recon.sourceControlTotal,
      staged_control_total: recon.stagedControlTotal,
      import_batch_id: batch?.id ?? null,
      version: run.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: null,
    })
    .where("id", "=", run.id)
    .where("version", "=", run.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, {
    action: "integration_run.succeeded",
    recordType: "integration_run",
    recordId: run.id,
    organizationId: run.organization_id,
    priorVersion: run.version,
    newVersion: finished.version,
    changes: {
      status: { from: "running", to: "succeeded" },
      rows_read: { from: null, to: finished.rows_read },
      rows_staged: { from: null, to: finished.rows_staged },
      rows_rejected: { from: null, to: finished.rows_rejected },
      rows_duplicate: { from: null, to: finished.rows_duplicate },
      reconciliation_status: { from: run.reconciliation_status, to: finished.reconciliation_status },
      import_batch_id: { from: null, to: finished.import_batch_id },
    },
  });
  // Recovery (ADR-0053 §2): a success right after a failed run resolves the connector's exception (worker consumer).
  const previous = await tx
    .selectFrom("integration_run")
    .select("status")
    .where("connector_id", "=", connector.id)
    .where("id", "!=", run.id)
    .where("trigger_kind", "!=", "test")
    .where("status", "in", ["succeeded", "failed"])
    .orderBy("finished_at", "desc")
    .orderBy("id", "desc")
    .limit(1)
    .executeTakeFirst();
  if (previous?.status === "failed")
    await enqueueOutboxEvent(tx, {
      organizationId: connector.organization_id,
      aggregateType: "integration_run",
      aggregateId: run.id,
      eventType: "connector.run_recovered",
      schemaVersion: 1,
      payload: { connectorId: connector.id, connectorCode: connector.code, runId: run.id },
      idempotencyKey: `connector.run_recovered:${run.id}`,
    });
  return { outcome: "succeeded", run: finished, retryRunId: null };
}

async function fail(
  tx: Tx,
  ctx: AuditContext,
  run: IntegrationRunRow,
  connector: ConnectorRow,
  config: ConnectorConfigRow,
  code: string,
  params: Readonly<Record<string, string>>,
): Promise<RunExecution> {
  const message = failureMessage(code, params);
  const finished = await tx
    .updateTable("integration_run")
    .set({
      status: "failed",
      finished_at: sql<Date>`greatest(now(), ${run.started_at}::timestamptz)`,
      error_code: code,
      error_message: message,
      version: run.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: null,
    })
    .where("id", "=", run.id)
    .where("version", "=", run.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, ctx, {
    action: "integration_run.failed",
    recordType: "integration_run",
    recordId: run.id,
    organizationId: run.organization_id,
    priorVersion: run.version,
    newVersion: finished.version,
    changes: { status: { from: "running", to: "failed" }, error_code: { from: null, to: code } },
  });
  // An automatic retry while the configured bound allows it (attempt n is followed by attempt n + 1 while
  // n <= retry_max_attempts; database cap 6), and only for an enabled connector.
  if (connector.status === "enabled" && run.attempt_no < attemptLimit(config)) {
    const retry = await insertQueuedRun(tx, ctx, {
      connector,
      triggerKind: "retry",
      idempotencyKey: `retry:${run.id}`,
      requestedBy: null,
      retryOf: finished,
    });
    return { outcome: "failed", run: finished, retryRunId: retry.id };
  }
  // The last failure: one outbox event; the worker opens or recurs the operational exception (operationalExceptionUpsert lock).
  if (connector.status === "enabled")
    await enqueueOutboxEvent(tx, {
      organizationId: connector.organization_id,
      aggregateType: "integration_run",
      aggregateId: run.id,
      eventType: "connector.run_failed",
      schemaVersion: 1,
      payload: {
        connectorId: connector.id,
        connectorCode: connector.code,
        runId: run.id,
        serviceIdentityId: run.service_identity_id,
        failureClass: failureClassOf(code),
        errorCode: code,
        errorMessage: message,
        kpiLinks: await kpisFedBy(tx, connector, config), // T-DG6-BE-X2 (ADR-0053 §2)
      },
      idempotencyKey: `connector.run_failed:${run.id}`,
    });
  return { outcome: "failed", run: finished, retryRunId: null };
}

// ------------------------------------------------------------------------------------------------ the watch

export interface DueRun {
  readonly id: string;
  readonly status: "queued" | "running";
}

/**
 * The runs to execute now: queued manual and scheduled runs; queued retries whose backoff has elapsed (the failed
 * parent's finish + retry_backoff_seconds x 2^(parent attempt - 1), with the configuration the retry uses); and
 * `running` runs whose start is older than STALE_RUNNING_SECONDS (crash recovery). Oldest first. `at` defaults to now().
 */
export async function dueRuns(
  db: DbOrTx,
  at: Date | null = null,
  limit = RUN_WATCH_BATCH,
  onlyConnectors: readonly string[] | null = null,
): Promise<DueRun[]> {
  const now = at === null ? sql<Date>`now()` : sql<Date>`${at.toISOString()}::timestamptz`;
  const scope =
    onlyConnectors === null ? sql<boolean>`true` : sql<boolean>`r.connector_id = ANY(${[...onlyConnectors]}::uuid[])`;
  const r = await sql<DueRun>`
    SELECT r.id, r.status
      FROM integration_run r
      JOIN connector_config_version v ON v.connector_id = r.connector_id AND v.version_no = r.config_version_no
      LEFT JOIN integration_run p ON p.id = r.retry_of_run_id
     WHERE r.status IN ('queued', 'running') AND ${scope}
       AND r.trigger_kind IN ('manual', 'schedule', 'retry')
       AND (
         (r.status = 'queued' AND (r.trigger_kind <> 'retry' OR r.requested_by IS NOT NULL
            OR p.finished_at + make_interval(secs => v.retry_backoff_seconds * power(2, p.attempt_no - 1)) <= ${now}))
         OR (r.status = 'running' AND r.started_at < ${now} - make_interval(secs => ${STALE_RUNNING_SECONDS})))
     ORDER BY r.queued_at, r.id
     LIMIT ${limit}`.execute(db);
  return r.rows;
}

/** The time a queued automatic retry becomes due (null for any other run). */
export async function retryDueAt(db: DbOrTx, runId: string): Promise<Date | null> {
  const r = await sql<{ due: Date | null }>`
    SELECT p.finished_at + make_interval(secs => v.retry_backoff_seconds * power(2, p.attempt_no - 1)) AS due
      FROM integration_run r
      JOIN connector_config_version v ON v.connector_id = r.connector_id AND v.version_no = r.config_version_no
      JOIN integration_run p ON p.id = r.retry_of_run_id
     WHERE r.id = ${runId} AND r.requested_by IS NULL`.execute(db);
  return r.rows[0]?.due ?? null;
}

/** One watch step: executes the due runs one after the other (each is safe against a concurrent watch). */
export async function connectorRunWatchStep(db: Db, options: ExecuteOptions = {}): Promise<RunExecution[]> {
  const out: RunExecution[] = [];
  for (const due of await dueRuns(db, null, RUN_WATCH_BATCH, options.onlyConnectors ?? null))
    out.push(await executeIntegrationRun(db, due.id, { ...options, recover: due.status === "running" }));
  return out;
}

export interface RunWatchLogger {
  error(obj: object, msg: string): void;
}

/**
 * Starts the run watch: one step every `intervalMs`, never two at once in this process. A failed step is logged and
 * retried at the next tick (the watch never stops the API). The timer is unref'd; `stop` waits for a running step.
 */
export function startConnectorRunWatch(
  db: Db,
  log: RunWatchLogger,
  intervalMs = RUN_WATCH_INTERVAL_MS,
): { stop(): Promise<void> } {
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = () => {
    if (stopped || running !== null) return;
    running = connectorRunWatchStep(db)
      .then(() => undefined)
      .catch((err: unknown) =>
        log.error({ err: err instanceof Error ? err.message : String(err) }, "connector run watch failed"),
      )
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
