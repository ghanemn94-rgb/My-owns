// Integration runs, retries, the local test adapter and the worker's cadence and exception jobs (ADR-0055 §2-§4, §9,
// §10; ADR-0053 §1-§3; REQ-S17-001, REQ-S16-022, REQ-S17-005; p6-work-split §B/A.2; T-DG6-BE-L2), against the run's
// disposable PostgreSQL:
//  1. the A17 run with the real local test adapter (healthy, the default 10-row fixture): 10 read, 10 staged, counts
//     8 valid / 1 rejected / 1 duplicate in the staged batch, reconciliation `matched` on the row count AND the decimal
//     control total, last success set; counts are NULL (Unknown) while queued and running, never 0; status history and
//     one audit event per transition;
//  2. failing: `failed` with connector.source_unavailable, automatic retries up to the configured bound with
//     exponential backoff (not due before the backoff, due at it), then exactly ONE `connector.run_failed` event and,
//     through the worker consumer, exactly one operational exception (a replay creates nothing); the run detail and the
//     connector show the actionable error; a manual retry past the bound is 422; a success afterwards resolves the
//     exception `recovered`;
//  3. stopped: `failed` with connector.stopped (class connector_unreachable), no retry when the bound is 0;
//  4. the same scheduled slot twice creates one run (`schedule:<connector id>:<slot start>`, the organization's time
//     zone); a replay of the job creates nothing;
//  5. a crash between start and finish leaves the run `running` with Unknown counts; a second executor skips it; the
//     recovery of a stale running run finishes it (A13 hook for QA-C);
//  6. authorization: KDS and ADM_TECH run; AUD, TD (transformation reader) 403 on run and retry, read 200; an
//     outsider 404; 401; the refusals connector.disabled, connector.run_active, integration_run.not_retryable,
//     integration_run.retry_limit_reached; Idempotency-Key replay 200; the commit-time re-check (a right lost meanwhile
//     is 403, nothing written); a disabled connector's queued run is cancelled; a narrowed connector identity stops the
//     staging (service_identity.out_of_scope).
// The import target is a test target defined in this file (KBE-A ships kpi_actual.v1). Every value is SYNTHETIC. A run
// stages and never commits; nothing here approves anything or touches DG0-DG7.
import { sql } from "@mth/db";
import { canonicalDecimal, DECIMAL_PATTERN } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  handleConnectorException,
  createCadenceRuns,
  scheduleKey,
} from "../../../../worker/src/handlers/integrations.ts";
import { principalOfIdentity, loadServiceIdentity } from "../../../../worker/src/kit.ts";
import {
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapterRegistry,
} from "../../../src/modules/integrations/adapters/port.ts";
import { a17Fixture } from "../../../src/modules/integrations/adapters/test-adapter.ts";
import { createImportTargetRegistry, type ImportTarget } from "../../../src/modules/integrations/imports/targets.ts";
import {
  attemptLimit,
  connectorRunWatchStep,
  dueRuns,
  executeIntegrationRun,
  failureClassOf,
  installDefaultConnectorAdapters,
  mapRows,
  reconcile,
  retryDueAt,
  type ExecuteOptions,
} from "../../../src/modules/integrations/runs.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  call,
  createBu,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/connectors";
const TEMPLATE = "kpi_actual.v98";

/** The test target (this file only; KBE-A ships kpi_actual.v1): kpi_id, period_label, value; key kpi + period. */
const testTarget: ImportTarget = {
  kind: "kpi_actual",
  templateVersion: TEMPLATE,
  titleEn: "Synthetic run target",
  titleAr: "هدف تشغيل اصطناعي",
  columns: [
    { key: "source_record_id", labelEn: "Source id", labelAr: "المعرف", required: false, kind: "text", example: null },
    { key: "kpi_id", labelEn: "KPI id", labelAr: "المؤشر", required: true, kind: "text", example: null },
    { key: "period_label", labelEn: "Period", labelAr: "الفترة", required: true, kind: "text", example: null },
    { key: "value", labelEn: "Value", labelAr: "القيمة", required: true, kind: "decimal", example: null },
  ],
  async validateRow(ctx, row) {
    await ctx.db
      .selectFrom("transformation")
      .select("id")
      .where("id", "=", ctx.transformationId)
      .executeTakeFirstOrThrow();
    const c = new Map(Object.entries(row.cells));
    const kpi = c.get("kpi_id") ?? null;
    const period = c.get("period_label") ?? null;
    const value = c.get("value") ?? null;
    const key = kpi && period ? `kpi_actual:${kpi}:${period}` : null;
    if (key === null || value === null || !DECIMAL_PATTERN.test(value))
      return {
        valid: false,
        reasons: [
          { code: "import.row.value_not_decimal", field: "value", params: { field: "value", value: value ?? "" } },
        ],
        duplicateKey: key,
      };
    return {
      valid: true,
      normalized: { kpi_id: kpi, period_label: period, value: canonicalDecimal(value) },
      duplicateKey: key,
    };
  },
  existingKeys: async () => new Map(),
  commitRow: () => Promise.reject(new Error("a run never commits")),
  requiredPermissions: ["kpi_actual.submit"],
};
const targets = createImportTargetRegistry();
targets.register(testTarget);
const run = (id: string, over: ExecuteOptions = {}) => executeIntegrationRun(api.db, id, { targets, ...over });

let api: TestApi;
let w: World;
let admin: Session; // ADM_TECH + ADM_ACCESS @ A: connector.read, configure, run
let kds: Session; // KDS @ A: connector.read + connector.run
let auditor: Session; // AUD @ A: connector.read only
let nobody: Session;
let tdReader: Session; // TD @ T1: connector.read at the transformation only
let kdsUserId: string;
let transformationT1: string;
let previousAdapters: ConnectorAdapterRegistry;

function config(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sourceSystemId: "synthetic.kpi-source:runs",
    endpointUrl: null,
    credentialRefs: {},
    fieldMappings: [],
    targetTransformationId: transformationT1,
    cadence: "manual",
    retryMaxAttempts: 0,
    retryBackoffSeconds: 10,
    commitMode: "manual",
    commitOnBehalfOf: null,
    outboundActions: [],
    reconciliationRule: "row_count_and_total",
    adapterSettings: { mode: "healthy", kpiId: "K-A17" },
    reason: "Synthetic connector for the BE-L2 suite.",
    ...over,
  };
}

/** Creates and enables a connector through the API; returns its id. */
async function connector(
  configOver: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
): Promise<string> {
  const created = await call<Body>(api.app, "POST", L, {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("run-").toLowerCase(),
      nameEn: "Synthetic run source",
      nameAr: "مصدر تشغيل اصطناعي",
      adapterKind: "test_adapter",
      targetKind: "kpi_actual",
      config: config(configOver),
      ...over,
    },
  });
  expect(created.status).toBe(201);
  const enabled = await call<Body>(api.app, "POST", `${L}/${created.body.id}/enable`, {
    session: admin,
    body: { reason: "Synthetic enable." },
    headers: ifm(1),
  });
  expect(enabled.status).toBe(200);
  return created.body.id as string;
}

async function runNow(connectorId: string, session: Session = kds, headers: Record<string, string> = {}) {
  return call<Body>(api.app, "POST", `${L}/${connectorId}/runs`, { session, body: {}, headers });
}

async function runRow(id: string) {
  return api.db.selectFrom("integration_run").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

async function outboxOf(runId: string) {
  return api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", runId).execute();
}

/** The worker's exception consumer, fed the outbox row as the relay would (envelope). */
async function consume(row: {
  id: string;
  event_type: string;
  schema_version: number;
  idempotency_key: string;
  organization_id: string;
  payload: unknown;
}) {
  return handleConnectorException(
    api.db,
    {
      outboxEventId: row.id,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      idempotencyKey: row.idempotency_key,
      organizationId: row.organization_id,
      payload: row.payload,
    },
    `job-${row.id}`,
  );
}

async function exceptionsOf(code: string) {
  return api.db
    .selectFrom("operational_exception")
    .selectAll()
    .where("source_kind", "=", "connector")
    .where("source_code", "=", code)
    .orderBy("first_occurred_at")
    .execute();
}

async function codeOf(connectorId: string): Promise<string> {
  return (await api.db.selectFrom("connector").select("code").where("id", "=", connectorId).executeTakeFirstOrThrow())
    .code;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const bu = await createBu(api.db, w.orgA.id);
  transformationT1 = await createTransformationRow(api.db, w.orgA.id, bu, w.grantor.id);
  const kdsUser = await createUser(api.db, w.orgA.id);
  kdsUserId = kdsUser.id;
  await grant(api.db, w.grantor.id, kdsUser.id, "KDS", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const td = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, td.id, "TD", { type: "transformation", id: transformationT1 }, w.orgA.id);
  admin = await signIn(api.app, w.admin.subject);
  kds = await signIn(api.app, kdsUser.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  tdReader = await signIn(api.app, td.subject);
  // The real local test adapter and http_pull adapter (this file's registry; restored afterwards).
  const registry = createConnectorAdapterRegistry();
  installDefaultConnectorAdapters(registry);
  previousAdapters = setConnectorAdapters(registry);
});

afterAll(async () => {
  setConnectorAdapters(previousAdapters);
  await api?.close();
});

describe("the A17 run with the local test adapter (REQ-S17-001)", () => {
  it("queues, runs and records 10 read, 10 staged, 8/1/1, reconciliation matched and the last success", async () => {
    const id = await connector();
    const before = await call<Body>(api.app, "GET", `${L}/${id}`, { session: kds });
    expect(before.body.lastSuccessAt).toBeNull();

    const queued = await runNow(id);
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({
      status: "queued",
      triggerKind: "manual",
      attemptNo: 1,
      requestedBy: kdsUserId,
      rowsRead: null,
      rowsStaged: null,
      rowsCommitted: null,
      rowsRejected: null,
      rowsDuplicate: null,
      errorCount: null,
      reconciliation: {
        status: "not_checked",
        sourceRowCount: null,
        sourceControlTotal: null,
        stagedControlTotal: null,
      },
      importBatchId: null,
      version: 1,
    });
    const runId = queued.body.id as string;

    // While running, the counts are still Unknown (NULL), never 0.
    let whileRunning: Body = null;
    const done = await run(runId, {
      beforeFinish: async () => {
        whileRunning = (await call<Body>(api.app, "GET", `${L}/${id}/runs/${runId}`, { session: kds })).body.run;
      },
    });
    expect(whileRunning).toMatchObject({ status: "running", rowsRead: null, rowsStaged: null, errorCount: null });
    expect(done.outcome).toBe("succeeded");

    const detail = await call<Body>(api.app, "GET", `${L}/${id}/runs/${runId}`, { session: kds });
    expect(detail.status).toBe(200);
    expect(detail.headers["etag"]).toBe('"3"');
    expect(detail.body.run).toMatchObject({
      status: "succeeded",
      rowsRead: 10,
      rowsStaged: 10,
      rowsCommitted: null,
      rowsRejected: 1,
      rowsDuplicate: 1,
      errorCount: 1,
      errorCode: null,
      reconciliation: { status: "matched", sourceRowCount: 10, sourceControlTotal: "211", stagedControlTotal: "211" },
    });
    expect(detail.body.events.map((e: Body) => e.status)).toEqual(["queued", "running", "succeeded"]);
    expect(detail.body.events[0]).toMatchObject({ rowsRead: null, errorCount: null });
    expect(detail.body.actionableError).toBeNull();
    expect(detail.body.retriedByRunId).toBeNull();

    const batch = await api.db
      .selectFrom("import_batch")
      .selectAll()
      .where("id", "=", detail.body.run.importBatchId)
      .executeTakeFirstOrThrow();
    expect(batch).toMatchObject({
      status: "staged",
      source_kind: "connector",
      connector_id: id,
      integration_run_id: runId,
      template_version: TEMPLATE,
      rows_total: 10,
      rows_valid: 8,
      rows_invalid: 1,
      rows_duplicate: 1,
      commit_mode: "manual",
    });
    const rows = await api.db
      .selectFrom("import_row")
      .select(["row_number", "validation_status", "raw"])
      .where("import_batch_id", "=", batch.id)
      .orderBy("row_number")
      .execute();
    expect(rows.map((r) => r.validation_status)).toEqual([
      ...Array<string>(8).fill("valid"),
      "invalid",
      "duplicate_in_batch",
    ]);
    // Cells stay text from the adapter to the staged row (never a number).
    for (const r of rows)
      for (const v of Object.values(r.raw as Record<string, unknown>)) expect(typeof v).toBe("string");

    const after = await call<Body>(api.app, "GET", `${L}/${id}`, { session: kds });
    expect(after.body.lastSuccessAt).toBe(detail.body.run.finishedAt);
    expect(after.body.lastRun.id).toBe(runId);

    // One audit event per transition, each stepping the version (prior -> new).
    const audit = await auditOf(api.db, runId);
    expect(audit.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["integration_run.queued", null, 1],
      ["integration_run.started", 1, 2],
      ["integration_run.succeeded", 2, 3],
    ]);
    expect(audit[0]!.actor_user_id).toBe(kdsUserId);
    expect(audit[2]!.actor_type).toBe("service");

    // listIntegrationRuns: newest first, readable by AUD and by the transformation-level reader.
    const list = await call<Body>(api.app, "GET", `${L}/${id}/runs?limit=10`, { session: auditor });
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: Body) => r.id)).toEqual([runId]);
    expect(
      (await call<Body>(api.app, "GET", `${L}/${id}/runs?status=failed`, { session: tdReader })).body.items,
    ).toEqual([]);
    // A replay of the execution changes nothing.
    expect((await run(runId)).outcome).toBe("skipped");
  });

  it("a connector without a target stages nothing: counts 0, reconciliation on the row count", async () => {
    const id = await connector(
      { targetTransformationId: null, reconciliationRule: "row_count", adapterSettings: { mode: "healthy" } },
      { targetKind: "none" },
    );
    const queued = await runNow(id, admin);
    expect(queued.status).toBe(202);
    const done = await run(queued.body.id);
    expect(done.run).toMatchObject({
      status: "succeeded",
      rows_read: 10,
      rows_staged: 0,
      rows_rejected: 0,
      rows_duplicate: 0,
      error_count: 0,
      rows_committed: null,
      import_batch_id: null,
      reconciliation_status: "matched",
      source_row_count: 10,
    });
  });
});

describe("failing: bounded retries with backoff, then exactly one operational exception (REQ-S17-005)", () => {
  it("retries up to the bound, raises one exception, shows the actionable error, and recovers", async () => {
    const id = await connector({ adapterSettings: { mode: "failing" }, retryMaxAttempts: 2, retryBackoffSeconds: 10 });
    const code = await codeOf(id);
    const first = await runNow(id);
    const r1 = await run(first.body.id);
    expect(r1.run).toMatchObject({ status: "failed", error_code: "connector.source_unavailable", attempt_no: 1 });
    expect(r1.run!.error_message).toBe("The source system did not respond.");
    expect(r1.run!.rows_read).toBeNull();
    expect(r1.retryRunId).not.toBeNull();
    const retry1 = await runRow(r1.retryRunId!);
    expect(retry1).toMatchObject({
      status: "queued",
      trigger_kind: "retry",
      attempt_no: 2,
      retry_of_run_id: first.body.id,
      idempotency_key: `retry:${first.body.id}`,
      requested_by: null,
    });
    // Backoff: due retry_backoff_seconds x 2^(attempt - 1) after the failure (10 s, then 20 s).
    const due1 = (await retryDueAt(api.db, retry1.id))!;
    expect(due1.getTime() - r1.run!.finished_at!.getTime()).toBe(10_000);
    expect((await dueRuns(api.db, new Date(due1.getTime() - 1000), 50, [id])).map((d) => d.id)).toEqual([]);
    // (+1 ms: PostgreSQL keeps microseconds, a JavaScript Date only milliseconds.)
    expect((await dueRuns(api.db, new Date(due1.getTime() + 1), 50, [id])).map((d) => d.id)).toEqual([retry1.id]);
    // No exception and no failure event while a retry is left.
    expect(await outboxOf(first.body.id)).toEqual([]);

    const r2 = await run(retry1.id);
    expect(r2.run).toMatchObject({ status: "failed", attempt_no: 2 });
    const retry2 = await runRow(r2.retryRunId!);
    expect(retry2.attempt_no).toBe(3);
    const due2 = (await retryDueAt(api.db, retry2.id))!;
    expect(due2.getTime() - r2.run!.finished_at!.getTime()).toBe(20_000);

    const r3 = await run(retry2.id);
    expect(r3.run).toMatchObject({ status: "failed", attempt_no: 3 });
    expect(r3.retryRunId).toBeNull(); // the bound: 1 + retryMaxAttempts (2) = 3 attempts
    const events = [...(await outboxOf(first.body.id)), ...(await outboxOf(retry1.id)), ...(await outboxOf(retry2.id))];
    expect(events.map((e) => e.event_type)).toEqual(["connector.run_failed"]);
    expect(events[0]!.payload).toMatchObject({
      connectorId: id,
      connectorCode: code,
      runId: retry2.id,
      failureClass: "connector_unreachable",
      errorCode: "connector.source_unavailable",
    });

    // The worker consumer opens exactly one exception; a replay of the job creates nothing.
    expect((await consume(events[0]!)).outcome).toBe("raised");
    expect((await consume(events[0]!)).outcome).toBe("duplicate");
    const raised = await exceptionsOf(code);
    expect(raised).toHaveLength(1);
    expect(raised[0]).toMatchObject({
      status: "open",
      failure_class: "connector_unreachable",
      occurrence_count: 1,
      last_error_code: "connector.source_unavailable",
      organization_id: w.orgA.id,
    });

    // The run detail and the connector page show which run failed, why and what to do (with both fallbacks).
    const detail = await call<Body>(api.app, "GET", `${L}/${id}/runs/${retry1.id}`, { session: auditor });
    expect(detail.body.retriedByRunId).toBe(retry2.id);
    expect(detail.body.run.retryOfRunId).toBe(first.body.id);
    expect(detail.body.actionableError).toMatchObject({
      runId: retry1.id,
      triggerKind: "retry",
      attemptNo: 2,
      errorCode: "connector.source_unavailable",
      fallbacks: ["kpi_form", "import_file"],
    });
    const page = await call<Body>(api.app, "GET", `${L}/${id}`, { session: kds });
    expect(page.body.actionableError).toMatchObject({
      runId: retry2.id,
      attemptNo: 3,
      errorCode: "connector.source_unavailable",
    });
    expect(page.body.lastSuccessAt).toBeNull();

    // A manual retry past the bound is refused; an earlier failed run was already retried.
    const limit = await call<Body>(api.app, "POST", `${L}/${id}/runs/${retry2.id}/retry`, { session: kds, body: {} });
    expect(limit.status).toBe(422);
    expect(limit.body.code).toBe("integration_run.retry_limit_reached");
    expect(limit.body.detail).toBe("This run reached the retry limit of 3 attempts.");
    const twice = await call<Body>(api.app, "POST", `${L}/${id}/runs/${first.body.id}/retry`, {
      session: kds,
      body: {},
    });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe("integration_run.not_retryable");

    // The source is back: a success after the failure resolves the exception `recovered` (worker consumer).
    const current = await call<Body>(api.app, "GET", `${L}/${id}`, { session: admin });
    const put = await call<Body>(api.app, "PUT", `${L}/${id}`, {
      session: admin,
      body: { nameEn: current.body.nameEn, nameAr: current.body.nameAr, config: config({ retryMaxAttempts: 2 }) },
      headers: ifm(current.body.version),
    });
    expect(put.status).toBe(200);
    const ok = await runNow(id);
    expect((await run(ok.body.id)).outcome).toBe("succeeded");
    const recovered = await outboxOf(ok.body.id);
    expect(recovered.map((e) => e.event_type)).toEqual(["connector.run_recovered"]);
    expect((await consume(recovered[0]!)).outcome).toBe("recovered");
    const after = await exceptionsOf(code);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "resolved", resolution: "recovered" });
    expect((await call<Body>(api.app, "GET", `${L}/${id}`, { session: kds })).body.actionableError).toBeNull();
  });

  it("a manual retry of a failed run is the next attempt, due at once, and runs", async () => {
    const id = await connector({ adapterSettings: { mode: "failing" }, retryMaxAttempts: 1 });
    // Make the automatic retry impossible: the first failure is the last when the bound is reached by a human retry.
    const first = await runNow(id);
    const r1 = await run(first.body.id);
    // The automatic retry (attempt 2) is queued: the failed run is already retried, so a manual retry is 409.
    expect(r1.retryRunId).not.toBeNull();
    const refused = await call<Body>(api.app, "POST", `${L}/${id}/runs/${first.body.id}/retry`, {
      session: kds,
      body: {},
    });
    expect(refused.body.code).toBe("integration_run.not_retryable");
    // While the retry is queued, a manual run is 409 connector.run_active.
    const busy = await runNow(id);
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("connector.run_active");
  });
});

describe("stopped (REQ-S17-005)", () => {
  it("fails with connector.stopped, no retry at bound 0, one failure event of class connector_unreachable", async () => {
    const id = await connector({ adapterSettings: { mode: "stopped" }, retryMaxAttempts: 0 });
    const q = await runNow(id);
    const r = await run(q.body.id);
    expect(r.run).toMatchObject({ status: "failed", error_code: "connector.stopped" });
    expect(r.retryRunId).toBeNull();
    const ev = await outboxOf(q.body.id);
    expect(ev.map((e) => (e.payload as Body).failureClass)).toEqual(["connector_unreachable"]);
    const page = await call<Body>(api.app, "GET", `${L}/${id}`, { session: auditor });
    expect(page.body.actionableError).toMatchObject({
      errorCode: "connector.stopped",
      fallbacks: ["kpi_form", "import_file"],
    });
    // A failed run with retryMaxAttempts 0 cannot be retried by hand either (limit 1 attempt).
    const retry = await call<Body>(api.app, "POST", `${L}/${id}/runs/${q.body.id}/retry`, { session: kds, body: {} });
    expect(retry.status).toBe(422);
    expect(retry.body.detail).toBe("This run reached the retry limit of 1 attempts.");
  });
});

describe("the cadence schedule (worker job integrations.connector_run)", () => {
  it("creates one run per slot (organization time zone), a replay creates nothing, the watch executes it", async () => {
    const id = await connector({ cadence: "daily" });
    const identity = await loadServiceIdentity(api.db, "job:integrations.connector_run");
    const ctx = { principal: (org: string) => principalOfIdentity(identity, org) };
    // 2026-10-29T10:00Z is 13:00 in Asia/Riyadh (UTC+3): the daily slot starts at 2026-10-28T21:00:00.000Z.
    const at = new Date("2026-10-29T10:00:00.000Z");
    const first = await createCadenceRuns(api.db, "job-cadence-1", ctx, at, [id]);
    expect(first.created).toHaveLength(1);
    expect(first.created[0]!.key).toBe(scheduleKey(id, "2026-10-28T21:00:00.000Z"));
    const again = await createCadenceRuns(api.db, "job-cadence-2", ctx, new Date("2026-10-29T20:59:00.000Z"), [id]);
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual([{ connectorId: id, key: first.created[0]!.key, why: "exists" }]);
    const row = await runRow(first.created[0]!.runId);
    expect(row).toMatchObject({ trigger_kind: "schedule", status: "queued", requested_by: null, attempt_no: 1 });
    expect((await auditOf(api.db, row.id)).map((e) => [e.action, e.actor_type, e.source])).toEqual([
      ["integration_run.queued", "service", "worker"],
    ]);
    // The API's run watch executes the due scheduled run.
    const step = await connectorRunWatchStep(api.db, { targets, onlyConnectors: [id] });
    expect(step.map((s) => s.outcome)).toEqual(["succeeded"]);
    // The next day's slot is a new run.
    const next = await createCadenceRuns(api.db, "job-cadence-3", ctx, new Date("2026-10-29T21:00:00.000Z"), [id]);
    expect(next.created.map((c) => c.key)).toEqual([scheduleKey(id, "2026-10-29T21:00:00.000Z")]);
  });

  it("weekly slots start on Sunday; a slot waits while the connector has an active run", async () => {
    const id = await connector({ cadence: "weekly" });
    const identity = await loadServiceIdentity(api.db, "job:integrations.connector_run");
    const ctx = { principal: (org: string) => principalOfIdentity(identity, org) };
    const busy = await runNow(id);
    expect(busy.status).toBe(202);
    // Thursday 2026-10-29: the week started on Sunday 2026-10-25 00:00 Riyadh = 2026-10-24T21:00Z.
    const waiting = await createCadenceRuns(api.db, "job-weekly-1", ctx, new Date("2026-10-29T10:00:00.000Z"), [id]);
    expect(waiting.skipped).toEqual([
      { connectorId: id, key: scheduleKey(id, "2026-10-24T21:00:00.000Z"), why: "active" },
    ]);
    await run(busy.body.id);
    const later = await createCadenceRuns(api.db, "job-weekly-2", ctx, new Date("2026-10-29T10:01:00.000Z"), [id]);
    expect(later.created.map((c) => c.key)).toEqual([scheduleKey(id, "2026-10-24T21:00:00.000Z")]);
  });
});

describe("crash between start and finish (A13 hook for QA-C)", () => {
  it("leaves the run running with Unknown counts; a second executor skips it; the recovery finishes it", async () => {
    const id = await connector();
    const q = await runNow(id);
    await expect(
      run(q.body.id, {
        beforeFinish: () => {
          throw new Error("synthetic worker kill");
        },
      }),
    ).rejects.toThrow("synthetic worker kill");
    const stuck = await runRow(q.body.id);
    expect(stuck).toMatchObject({ status: "running", rows_read: null, rows_staged: null, error_count: null });
    expect((await run(q.body.id)).outcome).toBe("skipped"); // not stale: another executor may still be on it
    expect((await run(q.body.id, { recover: true })).outcome).toBe("skipped");
    const due = await dueRuns(api.db, new Date(Date.now() + 200_000), 50, [id]);
    expect(due).toEqual([{ id: q.body.id, status: "running" }]);
    const recovered = await run(q.body.id, { recover: true, staleAfterSeconds: 0 });
    expect(recovered.outcome).toBe("succeeded");
    expect(recovered.run).toMatchObject({ rows_read: 10, rows_staged: 10 });
    // Exactly one batch for the run (the crashed attempt staged nothing: its transaction 2 never ran).
    const batches = await api.db
      .selectFrom("import_batch")
      .select("id")
      .where("integration_run_id", "=", q.body.id)
      .execute();
    expect(batches).toHaveLength(1);
  });
});

describe("authorization and refusals (ADR-0055 §9)", () => {
  it("KDS and ADM_TECH run; AUD and TD get 403; an outsider 404; anonymous 401; nothing is written", async () => {
    const id = await connector();
    for (const s of [auditor, tdReader]) {
      const denied = await runNow(id, s);
      expect(denied.status).toBe(403);
    }
    expect((await runNow(id, nobody)).status).toBe(404);
    expect((await call<Body>(api.app, "POST", `${L}/${id}/runs`, { body: {} })).status).toBe(401);
    expect(await api.db.selectFrom("integration_run").select("id").where("connector_id", "=", id).execute()).toEqual(
      [],
    );
    expect((await runNow(id, admin)).status).toBe(202);
    // Reads: AUD and TD 200, outsider 404, unknown run 404, a run of another connector 404.
    const other = await connector();
    const otherRun = await runNow(other);
    for (const s of [auditor, tdReader])
      expect((await call<Body>(api.app, "GET", `${L}/${id}/runs`, { session: s })).status).toBe(200);
    expect((await call<Body>(api.app, "GET", `${L}/${id}/runs`, { session: nobody })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${L}/${id}/runs/${otherRun.body.id}`, { session: kds })).status).toBe(
      404,
    );
    expect(
      (await call<Body>(api.app, "POST", `${L}/${id}/runs/${otherRun.body.id}/retry`, { session: kds, body: {} }))
        .status,
    ).toBe(404);
    // Retry: AUD 403; a queued run is not retryable (409).
    expect(
      (
        await call<Body>(api.app, "POST", `${L}/${other}/runs/${otherRun.body.id}/retry`, {
          session: auditor,
          body: {},
        })
      ).status,
    ).toBe(403);
    const notFailed = await call<Body>(api.app, "POST", `${L}/${other}/runs/${otherRun.body.id}/retry`, {
      session: kds,
      body: {},
    });
    expect(notFailed.status).toBe(409);
    expect(notFailed.body.code).toBe("integration_run.not_retryable");
    // Validation: a body field, a bad id, a bad Idempotency-Key.
    expect((await call<Body>(api.app, "POST", `${L}/${id}/runs`, { session: kds, body: { x: 1 } })).status).toBe(400);
    expect((await call<Body>(api.app, "GET", `${L}/${id}/runs/x`, { session: kds })).status).toBe(400);
    expect((await runNow(id, kds, { "idempotency-key": "bad key!" })).status).toBe(400);
  });

  it("the same Idempotency-Key returns the existing run (200); another key while active is 409", async () => {
    const id = await connector();
    const key = uniq("idem-key-");
    const a = await runNow(id, kds, { "idempotency-key": key });
    expect(a.status).toBe(202);
    const b = await runNow(id, kds, { "idempotency-key": key });
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(a.body.idempotencyKey).toBe(`manual:${kdsUserId}:${key}`);
    const c = await runNow(id, kds, { "idempotency-key": uniq("idem-other-") });
    expect(c.status).toBe(409);
    expect(c.body.code).toBe("connector.run_active");
  });

  it("a disabled connector: run 409 connector.disabled; a run queued before the disable is cancelled", async () => {
    const id = await connector();
    const q = await runNow(id);
    const current = await call<Body>(api.app, "GET", `${L}/${id}`, { session: admin });
    const dis = await call<Body>(api.app, "POST", `${L}/${id}/disable`, {
      session: admin,
      body: { reason: "Synthetic disable." },
      headers: ifm(current.body.version),
    });
    expect(dis.status).toBe(200);
    expect((await runRow(q.body.id)).status).toBe("cancelled"); // BE-L's disable cancels queued runs
    const refused = await runNow(id);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("connector.disabled");
    expect(refused.body.detail).toBe(
      "This connector is disabled. Enable it, or enter the data by form or import a file.",
    );
  });

  it("the commit-time re-check: a right lost while the request waits is 403 and nothing is written", async () => {
    const id = await connector();
    const user = await createUser(api.db, w.orgA.id);
    const assignment = await grant(
      api.db,
      w.grantor.id,
      user.id,
      "KDS",
      { type: "organization", id: w.orgA.id },
      w.orgA.id,
    );
    const session = await signIn(api.app, user.subject);
    // Hold the connector-run lock so the request waits inside its transaction, then revoke the grant (committed).
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holder = api.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(730310, hashtext(${id}::text))`.execute(tx);
      locked();
      await gate;
    });
    await isLocked;
    const pending = runNow(id, session);
    await new Promise((r) => setTimeout(r, 300));
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic BE-L2 revoke' where id = $2`,
      [w.grantor.id, assignment],
    );
    release();
    await holder;
    const lockHolder = pending;
    const res = await lockHolder;
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("integration_run").select("id").where("connector_id", "=", id).execute()).toEqual(
      [],
    );
  });

  it("a narrowed connector identity stops the staging: the run fails with service_identity.out_of_scope", async () => {
    const id = await connector({ retryMaxAttempts: 0 });
    const identity = await api.db
      .selectFrom("service_identity")
      .select(["id", "version"])
      .where("connector_id", "=", id)
      .executeTakeFirstOrThrow();
    const narrowed = await call<Body>(api.app, "PUT", `/api/v1/admin/service-identities/${identity.id}`, {
      session: admin,
      body: { grantedPermissionCodes: [], reason: "Synthetic: narrow the connector identity." },
      headers: ifm(identity.version),
    });
    expect(narrowed.status).toBe(200);
    const q = await runNow(id);
    const r = await run(q.body.id);
    expect(r.run).toMatchObject({
      status: "failed",
      error_code: "service_identity.out_of_scope",
      import_batch_id: null,
    });
  });
});

describe("pure parts", () => {
  it("reconcile: matched, mismatched, not_checked and not_applicable, decimals compared exactly", () => {
    expect(reconcile("none", 3, { sourceRowCount: 3, sourceControlTotal: "1" }, "1").status).toBe("not_applicable");
    expect(reconcile("row_count", 3, { sourceRowCount: null, sourceControlTotal: null }, null)).toEqual({
      status: "not_checked",
      sourceRowCount: null,
      sourceControlTotal: null,
      stagedControlTotal: null,
    });
    expect(reconcile("row_count", 3, { sourceRowCount: 4, sourceControlTotal: null }, null).status).toBe("mismatched");
    expect(reconcile("row_count_and_total", 2, { sourceRowCount: 2, sourceControlTotal: "0.3" }, "0.30")).toMatchObject(
      {
        status: "matched",
        sourceControlTotal: "0.3",
        stagedControlTotal: "0.30",
      },
    );
    expect(reconcile("row_count_and_total", 2, { sourceRowCount: 2, sourceControlTotal: "0.3" }, "0.31").status).toBe(
      "mismatched",
    );
    expect(reconcile("row_count_and_total", 2, { sourceRowCount: 2, sourceControlTotal: null }, "1").status).toBe(
      "not_checked",
    );
    expect(reconcile("row_count_and_total", 2, { sourceRowCount: 2, sourceControlTotal: "1" }, null).status).toBe(
      "mismatched",
    );
  });

  it("mapRows, failure classes and the attempt limit", () => {
    expect(mapRows([{ a: "1", b: "x" }], [{ source: "a", target: "value" }])).toEqual([{ value: "1" }]);
    expect(mapRows(a17Fixture("k").slice(0, 1), [])).toEqual(a17Fixture("k").slice(0, 1));
    expect(failureClassOf("connector.stopped")).toBe("connector_unreachable");
    expect(failureClassOf("connector.secret_unresolvable")).toBe("connector_credentials_rejected");
    expect(failureClassOf("connector.mapping_mismatch")).toBe("connector_run_failed");
    expect(attemptLimit({ retry_max_attempts: 5 })).toBe(6);
    expect(attemptLimit({ retry_max_attempts: 0 })).toBe(1);
  });
});
