// Signed webhooks against the run's disposable PostgreSQL (ADR-0056 §7-§9; REQ-S17-003; p6-work-split §B/A.6;
// T-DG6-BE-N). Every request goes through the API except where a test says otherwise:
//  1. a signed delivery -> 202 and a staged batch (the A17 8/1/1 items: 10 = 8 + 1 + 1), its receipt, its webhook run
//     (succeeded, the connector's service identity) and service-actor audit events, all in one transaction;
//  2. with `auto` commit -> committed on behalf of the configured user (re-authorized at commit); a refused auto commit
//     leaves the batch staged with the audit event import_batch.auto_commit_refused;
//  3. unsigned, wrong signature, stale timestamp, unknown key, disabled endpoint, disabled connector, malformed header
//     -> the same 401 webhook.unauthenticated, no row, a redacted log reason;
//  4. the same delivery id and body -> 200 replay (nothing new); another body -> 409 webhook.delivery_id_reused;
//  5. the previous secret accepted inside the grace period and refused after it;
//  6. a body > 1 MiB -> 413 webhook.payload_too_large; JSON numbers -> row reason; bad JSON or shape -> 400;
//  7. endpoint administration: create (server-generated key, SecretRef only), rotate, disable (final); 422s; If-Match
//     428/409; AUD and KDS 403 on every mutation, an outsider 404; the commit-time re-check; no secret value in any
//     response, row or audit event.
// Every value and secret is SYNTHETIC. An auto commit submits KPI actuals through DG4 and approves nothing; nothing
// here touches DG0-DG7.
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createImportTargetRegistry, importTargetRegistry } from "../../../src/modules/integrations/imports/targets.ts";
import { setConnectorSecretProviders } from "../../../src/modules/integrations/secret-refs.ts";
import {
  receiveWebhook,
  rotateSecret,
  webhookRejectionCounts,
  webhookSignature,
} from "../../../src/modules/integrations/webhooks.ts";
import {
  createSecretProviderRegistry,
  HttpProblem,
  secretValue,
  type SecretProviderRegistry,
} from "../../../src/modules/platform/index.ts";
import {
  auditOf,
  auditOfRequest,
  call,
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
import { assertAcceptedRequest, assertContract } from "../../support/contract.ts";
import { DIRECT_FLOW, mapPartyTo, monthlyPeriod, ownedKpi, REVIEW_FLOW } from "../kpi-p4/kbe-c-fixtures.ts";
import { seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ADMIN = "/api/v1/admin/webhooks";
const SECRET_A = "whsec-SYNTHETIC-a-7d1f0c";
const SECRET_B = "whsec-SYNTHETIC-b-91ce44";
const NAME_A = "MTH_TEST_WEBHOOK_SECRET_A";
const NAME_B = "MTH_TEST_WEBHOOK_SECRET_B";
const refA = { provider: "env", name: NAME_A };
const refB = { provider: "env", name: NAME_B };

let api: TestApi;
let w: World;
let k: KpiWorld;
let admin: Session; // ADM_TECH @ A: connector.read + webhook.configure
let kdsOrg: Session; // KDS @ A: connector.read, no webhook.configure
let direct: { id: string; versionId: string; name: string };
let review: { id: string; versionId: string; name: string };
let previousSecrets: SecretProviderRegistry | null;

const silentLog = {
  warn() {},
  info() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return silentLog;
  },
  level: "silent",
} as unknown as FastifyBaseLogger;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  await mapPartyTo(api, k, "BO", k.users.bo.id); // the review-route KPI's reviewer (as imports.test.ts)
  direct = await ownedKpi(api, k, DIRECT_FLOW);
  review = await ownedKpi(api, k, REVIEW_FLOW);
  admin = await signIn(api.app, w.admin.subject);
  const kdsUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, kdsUser.id, "KDS", { type: "organization", id: w.orgA.id }, w.orgA.id);
  kdsOrg = await signIn(api.app, kdsUser.subject);
  const secrets = createSecretProviderRegistry();
  secrets.register({
    id: "env",
    get: async (name) =>
      name === NAME_A ? secretValue(SECRET_A) : name === NAME_B ? secretValue(SECRET_B) : undefined,
  });
  previousSecrets = setConnectorSecretProviders(secrets);
}, 120_000);

afterAll(async () => {
  setConnectorSecretProviders(previousSecrets);
  await api?.close();
});

// ------------------------------------------------------------------------------------------------ helpers

const ifm = (v: number) => ({ "if-match": `"${v}"` });

/** A webhook connector targeting the KPI world's transformation, enabled (version 2). */
async function webhookConnector(
  over: { commitMode?: "manual" | "auto"; commitOnBehalfOf?: string | null; fieldMappings?: unknown[] } = {},
): Promise<string> {
  const created = await call<Body>(api.app, "POST", "/api/v1/admin/connectors", {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("wh-").toLowerCase(),
      nameEn: "Synthetic webhook source",
      nameAr: "مصدر ويب هوك اصطناعي",
      adapterKind: "webhook",
      targetKind: "kpi_actual",
      config: {
        sourceSystemId: "synthetic.webhook:v1",
        endpointUrl: null,
        credentialRefs: {},
        fieldMappings: over.fieldMappings ?? [],
        targetTransformationId: k.transformationId,
        cadence: "manual",
        retryMaxAttempts: 0,
        retryBackoffSeconds: 60,
        commitMode: over.commitMode ?? "manual",
        commitOnBehalfOf: over.commitOnBehalfOf ?? null,
        outboundActions: [],
        reconciliationRule: "none",
        adapterSettings: {},
        reason: "Synthetic webhook connector for the BE-N suite.",
      },
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const enabled = await call<Body>(api.app, "POST", `/api/v1/admin/connectors/${created.body.id}/enable`, {
    session: admin,
    headers: ifm(1),
    body: { reason: null },
  });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(200);
  return created.body.id as string;
}

async function endpoint(connectorId: string, toleranceSeconds = 300): Promise<Body> {
  const res = await call<Body>(api.app, "POST", ADMIN, {
    session: admin,
    body: { connectorId, label: "Synthetic sender", signingSecretRef: refA, toleranceSeconds },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

interface DeliverOptions {
  secret?: string;
  deliveryId?: string;
  timestamp?: number;
  headers?: Record<string, string | undefined>;
  raw?: Buffer;
  /**
   * The body is deliberately outside the contract's WebhookDelivery schema (a JSON number as an item value: ADR-0056 §7
   * makes it a row reason, while the contract types item values as string | null; reported in the T-DG6-BE-N handback).
   * The response is still checked against the contract.
   */
  offContract?: boolean;
}

async function deliver(key: string, body: unknown, o: DeliverOptions = {}) {
  const raw = o.raw ?? Buffer.from(JSON.stringify(body));
  const ts = String(o.timestamp ?? Math.floor(Date.now() / 1000));
  const deliveryId = o.deliveryId ?? uniq("dlv-");
  const sig = `v1=${webhookSignature(o.secret ?? SECRET_A, ts, deliveryId, raw)}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-mth-webhook-timestamp": ts,
    "x-mth-webhook-delivery": deliveryId,
    "x-mth-webhook-signature": sig,
  };
  for (const [h, v] of Object.entries(o.headers ?? {})) {
    if (v === undefined) delete headers[h];
    else headers[h] = v;
  }
  // The signature covers the exact bytes, so they are sent raw; the validating client's contract checks run here on the
  // response and (for an accepted delivery) on the parsed body, as `call` does for a JSON object body.
  const url = `/api/v1/webhooks/${key}`;
  const res = await call<Body>(api.app, "POST", url, { headers, body: raw, contract: false });
  assertContract("POST", url, { statusCode: res.raw.statusCode, headers: res.raw.headers, body: res.raw.body });
  if (!o.offContract && res.status >= 200 && res.status < 300)
    assertAcceptedRequest("POST", url, res.status, JSON.parse(raw.toString("utf8")) as unknown);
  return res;
}

async function periods(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await monthlyPeriod(api, w)).label);
  return out;
}

const item = (kpiId: string, periodLabel: string, extra: Record<string, unknown> = {}) => ({
  kpi_id: kpiId,
  scope_kind: "transformation",
  scope_id: k.transformationId,
  period_label: periodLabel,
  data_as_of: "2041-01-31",
  ...extra,
});

/** ADR-0056 §6's A17 fixture as webhook items: 8 valid, item 9 `12,5` (invalid), item 10 a duplicate of item 1. */
function fixture(ps: readonly string[]) {
  const [p1, p2, p3, p4] = ps as [string, string, string, string];
  return {
    templateVersion: "kpi_actual.v1",
    items: [
      item(direct.id, p1, { source_record_id: "WH-01", value: "120.5" }),
      item(direct.id, p2, { source_record_id: "WH-02", value: "121" }),
      item(direct.id, p3, { source_record_id: "WH-03", value: "0.000001" }),
      item(direct.id, p4, { source_record_id: "WH-04", value: "-3.25" }),
      item(review.id, p1, { source_record_id: "WH-05", value: "1000" }),
      item(review.id, p2, { source_record_id: "WH-06", value: "1000.000000" }),
      item(review.id, p3, { source_record_id: "WH-07", missing_reason: "Synthetic: the source was down" }),
      item(review.id, p4, { source_record_id: "WH-08", value: "999999999999999999.999999" }),
      item(direct.id, p1, { source_record_id: "WH-09", value: "12,5" }),
      item(direct.id, p1, { source_record_id: "WH-10", value: "7" }),
    ],
  };
}

/** Rows written for these endpoints (scope-local; never a global count, F-DG1-110). */
async function counts(...endpoints: readonly Body[]) {
  const endpointIds = endpoints.map((e) => e.id as string);
  const connectorIds = endpoints.map((e) => e.connectorId as string);
  const receipts = await api.db
    .selectFrom("webhook_receipt")
    .select("id")
    .where("webhook_endpoint_id", "in", endpointIds)
    .execute();
  const batches = await api.db
    .selectFrom("import_batch")
    .select("id")
    .where("connector_id", "in", connectorIds)
    .execute();
  const runs = await api.db
    .selectFrom("integration_run")
    .select("id")
    .where("connector_id", "in", connectorIds)
    .execute();
  return { receipts: receipts.length, batches: batches.length, runs: runs.length };
}

const batchRow = (id: string) =>
  api.db.selectFrom("import_batch").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

// ------------------------------------------------------------------------------------------------ 1. accepted

describe("receiveWebhook: a signed delivery is staged (ADR-0056 §7; REQ-S17-003)", () => {
  it("answers 202 and stages 10 = 8 + 1 + 1 with its receipt and webhook run, as the connector's service identity", async () => {
    const connectorId = await webhookConnector();
    const e = await endpoint(connectorId);
    const ps = await periods(4);
    const res = await deliver(e.endpointKey, fixture(ps), { deliveryId: "dlv-a17-0001" });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body).toMatchObject({
      replay: false,
      rowsTotal: 10,
      rowsValid: 8,
      rowsInvalid: 1,
      rowsDuplicate: 1,
    });
    const b = await batchRow(res.body.importBatchId);
    expect(b).toMatchObject({
      status: "staged",
      source_kind: "webhook",
      media_type: "application/json",
      connector_id: connectorId,
      webhook_receipt_id: res.body.receiptId,
      commit_mode: "manual",
      created_by: null,
      transformation_id: k.transformationId,
    });
    const receipt = await api.db
      .selectFrom("webhook_receipt")
      .selectAll()
      .where("id", "=", res.body.receiptId)
      .executeTakeFirstOrThrow();
    expect(receipt).toMatchObject({ delivery_id: "dlv-a17-0001", secret_slot: "current", item_count: 10 });
    const run = await api.db
      .selectFrom("integration_run")
      .selectAll()
      .where("import_batch_id", "=", b.id)
      .executeTakeFirstOrThrow();
    const identity = await api.db
      .selectFrom("service_identity")
      .select("id")
      .where("connector_id", "=", connectorId)
      .executeTakeFirstOrThrow();
    expect(run).toMatchObject({
      trigger_kind: "webhook",
      status: "succeeded",
      idempotency_key: `webhook:${receipt.id}`,
      service_identity_id: identity.id,
      rows_read: 10,
      rows_staged: 10,
      rows_rejected: 1,
      rows_duplicate: 1,
      requested_by: null,
    });
    // One request, one transaction: every event is the service actor's, with the request's id.
    const events = await auditOfRequest(api.db, String(res.headers["x-request-id"]));
    expect(events.map((a) => a.action)).toEqual([
      "webhook_receipt.accepted",
      "integration_run.queued",
      "integration_run.started",
      "import_batch.created",
      "import_batch.staged",
      "integration_run.succeeded",
    ]);
    expect(events.every((a) => a.actor_type === "service" && a.actor_user_id === null)).toBe(true);
    // The 2 others are isolated with their reasons; the manual batch waits for a KDS commit.
    const rows = await call<Body>(api.app, "GET", `${k.base}/imports/${b.id}/rows?limit=100`, { session: k.s.kds });
    expect(rows.status).toBe(200);
    const byRow = new Map<number, Body>(rows.body.items.map((r: Body) => [r.rowNumber, r]));
    expect(byRow.get(10).reasons.map((x: Body) => x.code)).toEqual(["import.row.value_not_decimal"]);
    expect([byRow.get(11).validationStatus, byRow.get(11).duplicateOfRowNumber]).toEqual(["duplicate_in_batch", 2]);
    const committed = await call<Body>(api.app, "POST", `${k.base}/imports/${b.id}/commit`, {
      session: k.s.kds,
      headers: ifm(2),
      body: { note: null },
    });
    expect([committed.status, committed.body.rowsCommitted]).toEqual([200, 8]);
  });

  it("applies the connector's field mappings and turns a JSON number into the row reason value_not_decimal", async () => {
    const connectorId = await webhookConnector({
      fieldMappings: [
        { source: "sourceRecordId", target: "source_record_id" },
        { source: "kpiId", target: "kpi_id" },
        { source: "scopeKind", target: "scope_kind" },
        { source: "scopeId", target: "scope_id" },
        { source: "periodLabel", target: "period_label" },
        { source: "value", target: "value" },
        { source: "dataAsOf", target: "data_as_of" },
      ],
    });
    const e = await endpoint(connectorId);
    const [p1, p2] = await periods(2);
    const res = await deliver(
      e.endpointKey,
      {
        templateVersion: "kpi_actual.v1",
        items: [
          {
            sourceRecordId: "M-1",
            kpiId: direct.id,
            scopeKind: "transformation",
            scopeId: k.transformationId,
            periodLabel: p1,
            value: "12.5",
            dataAsOf: "2041-01-31",
          },
          {
            sourceRecordId: "M-2",
            kpiId: direct.id,
            scopeKind: "transformation",
            scopeId: k.transformationId,
            periodLabel: p2,
            value: 12.5,
            dataAsOf: "2041-01-31",
          },
        ],
      },
      { offContract: true },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect([res.body.rowsValid, res.body.rowsInvalid]).toEqual([1, 1]);
    const rows = await call<Body>(api.app, "GET", `${k.base}/imports/${res.body.importBatchId}/rows`, {
      session: k.s.kds,
    });
    const second = rows.body.items.find((r: Body) => r.rowNumber === 3);
    // The engine's reason first (never coerced); the target then sees no value (import.row.value_shape).
    expect(second.reasons[0]).toEqual({
      code: "import.row.value_not_decimal",
      field: "value",
      params: { field: "value", value: "12.5" },
    });
    expect(second.validationStatus).toBe("invalid");
    expect(second.raw.value).toBe("12.5"); // the JSON text, kept for display; never coerced into a number
  });
});

// ------------------------------------------------------------------------------------------------ 2. auto commit

describe("receiveWebhook: auto commit on behalf of the configured user (ADR-0056 §7 step 3)", () => {
  it("commits the valid rows after the staging transaction, on behalf of the configured KDS", async () => {
    const connectorId = await webhookConnector({ commitMode: "auto", commitOnBehalfOf: k.users.kds.id });
    const e = await endpoint(connectorId);
    const res = await deliver(e.endpointKey, fixture(await periods(4)));
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    const b = await batchRow(res.body.importBatchId);
    expect(b).toMatchObject({
      status: "committed",
      commit_mode: "auto",
      on_behalf_of_user_id: k.users.kds.id,
      committed_by: null,
      rows_committed: 8,
    });
    const lineage = await api.db
      .selectFrom("import_row_commit")
      .select("target_record_id")
      .where("import_batch_id", "=", b.id)
      .execute();
    expect(lineage).toHaveLength(8);
    const committed = (await auditOf(api.db, b.id)).find((a) => a.action === "import_batch.committed")!;
    expect(committed).toMatchObject({
      actor_type: "service",
      actor_user_id: null,
      on_behalf_of_user_id: k.users.kds.id,
      prior_version: 2,
      new_version: 3,
    });
  });

  it("leaves the batch staged and records import_batch.auto_commit_refused when the commit-time re-check refuses", async () => {
    const connectorId = await webhookConnector({ commitMode: "auto", commitOnBehalfOf: k.users.kds.id });
    const e = await endpoint(connectorId);
    // The real target, but its commit needs a code the on-behalf-of user does not hold (the re-check at commit).
    const real = importTargetRegistry().get("kpi_actual.v1")!;
    const targets = createImportTargetRegistry();
    targets.register({ ...real, requiredPermissions: [...real.requiredPermissions, "webhook.configure"] });
    const body = Buffer.from(JSON.stringify(fixture(await periods(4))));
    const ts = String(Math.floor(Date.now() / 1000));
    const result = await receiveWebhook(api.db, {
      endpointKey: e.endpointKey,
      headers: {
        "x-mth-webhook-timestamp": ts,
        "x-mth-webhook-delivery": "dlv-auto-refused-1",
        "x-mth-webhook-signature": `v1=${webhookSignature(SECRET_A, ts, "dlv-auto-refused-1", body)}`,
      },
      body,
      parseJson: async (text) => JSON.parse(text) as unknown,
      requestId: "be-n-auto-refused",
      log: silentLog,
      targets,
    });
    expect(result.replay).toBe(false);
    const b = await batchRow(result.importBatchId);
    expect([b.status, b.rows_committed, b.version]).toEqual(["staged", null, 2]);
    const refused = (await auditOf(api.db, b.id)).find((a) => a.action === "import_batch.auto_commit_refused")!;
    expect(refused).toMatchObject({ actor_type: "service", on_behalf_of_user_id: k.users.kds.id });
    expect(JSON.stringify(refused.changes)).toContain("forbidden");
  });
});

// ------------------------------------------------------------------------------------------------ 3. one 401

describe("receiveWebhook: every authentication failure is the same 401 and stores nothing", () => {
  it("refuses unsigned, wrongly signed, stale, malformed, unknown, disabled-endpoint and disabled-connector deliveries", async () => {
    const connectorId = await webhookConnector();
    const e = await endpoint(connectorId, 60);
    const other = await endpoint(await webhookConnector());
    const disabled = await call<Body>(api.app, "POST", `${ADMIN}/${other.id}/disable`, {
      session: admin,
      headers: ifm(1),
      body: { reason: "Synthetic: retired sender" },
    });
    expect(disabled.status).toBe(200);
    const stopped = await endpoint(await webhookConnector());
    const off = await call<Body>(api.app, "POST", `/api/v1/admin/connectors/${stopped.connectorId}/disable`, {
      session: admin,
      headers: ifm(2),
      body: { reason: "Synthetic: paused" },
    });
    expect(off.status).toBe(200);
    const body = fixture(await periods(4));
    const scope = [e, other, stopped];
    const before = await counts(...scope);
    const rejectedBefore = new Map(webhookRejectionCounts());
    const cases: Array<[string, Promise<{ status: number; body: Body }>]> = [
      [
        "unsigned",
        deliver(e.endpointKey, body, {
          headers: {
            "x-mth-webhook-signature": undefined,
            "x-mth-webhook-timestamp": undefined,
            "x-mth-webhook-delivery": undefined,
          },
        }),
      ],
      ["no signature", deliver(e.endpointKey, body, { headers: { "x-mth-webhook-signature": undefined } })],
      ["wrong secret", deliver(e.endpointKey, body, { secret: "not-the-secret" })],
      ["malformed signature", deliver(e.endpointKey, body, { headers: { "x-mth-webhook-signature": "v1=zz" } })],
      ["malformed delivery id", deliver(e.endpointKey, body, { headers: { "x-mth-webhook-delivery": "short" } })],
      ["stale timestamp", deliver(e.endpointKey, body, { timestamp: Math.floor(Date.now() / 1000) - 61 })],
      ["future timestamp", deliver(e.endpointKey, body, { timestamp: Math.floor(Date.now() / 1000) + 61 })],
      ["unknown key", deliver("A".repeat(43), body)],
      ["disabled endpoint", deliver(other.endpointKey, body)],
      ["disabled connector", deliver(stopped.endpointKey, body)],
    ];
    const bodies = new Set<string>();
    for (const [name, pending] of cases) {
      const res = await pending;
      expect(res.status, name).toBe(401);
      expect(res.body).toMatchObject({
        type: "urn:mth:problem:unauthenticated",
        code: "webhook.unauthenticated",
        detail: "The webhook request is not signed correctly.",
      });
      const { instance: _i, requestId: _r, ...rest } = res.body;
      bodies.add(JSON.stringify(rest));
    }
    expect(bodies.size).toBe(1); // one code and one text: a caller learns nothing about which check failed
    expect(await counts(...scope)).toEqual(before);
    const after = webhookRejectionCounts();
    const delta = (r: Parameters<typeof after.get>[0]) => (after.get(r) ?? 0) - (rejectedBefore.get(r) ?? 0);
    expect([
      delta("header_missing"),
      delta("signature_mismatch"),
      delta("header_malformed"),
      delta("timestamp_outside_window"),
      delta("endpoint_unknown"),
      delta("endpoint_disabled"),
      delta("connector_disabled"),
    ]).toEqual([2, 1, 2, 2, 1, 1, 1]);
  });
});

// ------------------------------------------------------------------------------------------------ 4. replay

describe("receiveWebhook: replay and delivery id reuse (exactly once)", () => {
  it("answers 200 with the original result for the same delivery id and body; 409 for another body", async () => {
    const e = await endpoint(await webhookConnector());
    const body = fixture(await periods(4));
    const first = await deliver(e.endpointKey, body, { deliveryId: "dlv-replay-0001" });
    expect(first.status).toBe(202);
    const before = await counts(e);
    const again = await deliver(e.endpointKey, body, { deliveryId: "dlv-replay-0001" });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ ...first.body, replay: true });
    expect(await counts(e)).toEqual(before);
    const reused = await deliver(
      e.endpointKey,
      { ...body, items: body.items.slice(0, 1) },
      { deliveryId: "dlv-replay-0001" },
    );
    expect([reused.status, reused.body.code]).toEqual([409, "webhook.delivery_id_reused"]);
    expect(await counts(e)).toEqual(before);
  });

  it("two concurrent deliveries with one id create one receipt and one batch", async () => {
    const e = await endpoint(await webhookConnector());
    const body = fixture(await periods(4));
    const ts = Math.floor(Date.now() / 1000);
    const [a, b] = await Promise.all([
      deliver(e.endpointKey, body, { deliveryId: "dlv-race-00001", timestamp: ts }),
      deliver(e.endpointKey, body, { deliveryId: "dlv-race-00001", timestamp: ts }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 202]);
    expect(a.body.receiptId).toBe(b.body.receiptId);
    const receipts = await api.db
      .selectFrom("webhook_receipt")
      .select("id")
      .where("webhook_endpoint_id", "=", e.id)
      .execute();
    expect(receipts).toHaveLength(1);
  });
});

// ------------------------------------------------------------------------------------------------ 5. rotation

describe("rotateWebhookSecret: the previous secret is valid for the grace period only", () => {
  it("accepts the new and the previous secret inside the grace period and refuses the previous one after it", async () => {
    const e = await endpoint(await webhookConnector());
    const rotated = await call<Body>(api.app, "POST", `${ADMIN}/${e.id}/rotate-secret`, {
      session: admin,
      headers: ifm(1),
      body: { signingSecretRef: refB, graceHours: 1, reason: "Synthetic scheduled rotation" },
    });
    expect(rotated.status, JSON.stringify(rotated.body)).toBe(200);
    expect(rotated.headers["etag"]).toBe('"2"');
    expect(rotated.body).toMatchObject({ signingSecretRef: refB, previousSecretRef: refA, version: 2 });
    const graceEnd = Date.parse(rotated.body.previousValidUntil);
    expect(graceEnd - Date.parse(rotated.body.secretRotatedAt)).toBe(3_600_000);

    const ps = await periods(8);
    const viaNew = await deliver(e.endpointKey, fixture(ps.slice(0, 4)), { secret: SECRET_B });
    expect(viaNew.status).toBe(202);
    const viaOld = await deliver(e.endpointKey, fixture(ps.slice(4, 8)), { secret: SECRET_A });
    expect(viaOld.status).toBe(202);
    const slots = await api.db
      .selectFrom("webhook_receipt")
      .select(["id", "secret_slot"])
      .where("id", "in", [viaNew.body.receiptId, viaOld.body.receiptId])
      .execute();
    expect(new Map(slots.map((s) => [s.id, s.secret_slot]))).toEqual(
      new Map([
        [viaNew.body.receiptId, "current"],
        [viaOld.body.receiptId, "previous"],
      ]),
    );
    // After the grace period (the service's clock moved past previous_valid_until): the old secret no longer matches.
    const later = graceEnd + 60_000;
    const body = Buffer.from(JSON.stringify(fixture(await periods(4))));
    const ts = String(Math.floor(later / 1000));
    const before = await counts(e);
    let caught: unknown;
    try {
      await receiveWebhook(api.db, {
        endpointKey: e.endpointKey,
        headers: {
          "x-mth-webhook-timestamp": ts,
          "x-mth-webhook-delivery": "dlv-after-grace-1",
          "x-mth-webhook-signature": `v1=${webhookSignature(SECRET_A, ts, "dlv-after-grace-1", body)}`,
        },
        body,
        parseJson: async (text) => JSON.parse(text) as unknown,
        requestId: "be-n-after-grace",
        log: silentLog,
        now: () => later,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpProblem);
    expect([(caught as HttpProblem).status, (caught as HttpProblem).code]).toEqual([401, "webhook.unauthenticated"]);
    expect(await counts(e)).toEqual(before);
  });
});

// ------------------------------------------------------------------------------------------------ 6. body

describe("receiveWebhook: body limits and format", () => {
  it("refuses a body over 1 MiB with 413 webhook.payload_too_large and stores nothing", async () => {
    const e = await endpoint(await webhookConnector());
    const raw = Buffer.from(
      JSON.stringify({ templateVersion: "kpi_actual.v1", items: [{ pad: "x".repeat(1_048_600) }] }),
    );
    const before = await counts(e);
    const res = await deliver(e.endpointKey, null, { raw });
    expect([res.status, res.body.code]).toEqual([413, "webhook.payload_too_large"]);
    expect(await counts(e)).toEqual(before);
  });

  it("answers 400 webhook.payload_invalid for a signed body that is not JSON, not UTF-8 or not the documented shape", async () => {
    const e = await endpoint(await webhookConnector());
    const p1 = (await periods(1))[0]!;
    const before = await counts(e);
    const bad: Array<[string, Buffer]> = [
      ["not json", Buffer.from("{nope")],
      ["not utf-8", Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d])],
      ["array", Buffer.from("[]")],
      ["unknown template", Buffer.from(JSON.stringify({ templateVersion: "nope.v1", items: [] }))],
      ["extra property", Buffer.from(JSON.stringify({ templateVersion: "kpi_actual.v1", items: [], x: 1 }))],
      [
        "unknown column",
        Buffer.from(JSON.stringify({ templateVersion: "kpi_actual.v1", items: [item(direct.id, p1, { nope: "1" })] })),
      ],
      [
        "too many items",
        Buffer.from(
          JSON.stringify({ templateVersion: "kpi_actual.v1", items: Array.from({ length: 5001 }, () => ({})) }),
        ),
      ],
    ];
    for (const [name, raw] of bad) {
      const res = await deliver(e.endpointKey, null, { raw });
      expect([res.status, res.body.code], name).toEqual([400, "webhook.payload_invalid"]);
      // The items that do not fit the template name the engine's refusal in errors[] (what the sender must fix).
      if (name === "unknown column")
        expect(res.body.errors[0]).toMatchObject({ pointer: "/items", code: "import.header_mismatch" });
    }
    // An unsigned bad body is never parsed: 401, not 400.
    const unsigned = await deliver(e.endpointKey, null, {
      raw: Buffer.from("{nope"),
      headers: { "x-mth-webhook-signature": undefined },
    });
    expect(unsigned.status).toBe(401);
    expect(await counts(e)).toEqual(before);
  });
});

// ------------------------------------------------------------------------------------------------ 7. administration

describe("webhook endpoint administration (webhook.configure; ADR-0056 §7)", () => {
  it("creates an active endpoint with a server-generated key and a SecretRef; one audit event; no secret value anywhere", async () => {
    const connectorId = await webhookConnector();
    const res = await call<Body>(api.app, "POST", ADMIN, {
      session: admin,
      body: { connectorId, label: "Synthetic sender", signingSecretRef: refA, toleranceSeconds: 120 },
    });
    expect(res.status).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.headers["location"]).toBe(`${ADMIN}/${res.body.id}`);
    expect(res.body).toMatchObject({
      connectorId,
      status: "active",
      signingSecretRef: refA,
      previousSecretRef: null,
      toleranceSeconds: 120,
      lastReceiptAt: null,
      version: 1,
    });
    expect(res.body.endpointKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.body.receivePath).toBe(`/api/v1/webhooks/${res.body.endpointKey}`);
    const events = await auditOf(api.db, res.body.id);
    expect(events.map((a) => [a.action, a.prior_version, a.new_version, a.actor_user_id])).toEqual([
      ["webhook_endpoint.created", null, 1, w.admin.id],
    ]);
    // A delivery, then every read: no secret value in a response, the stored rows or the audit events.
    await deliver(res.body.endpointKey, fixture(await periods(4)));
    const got = await call<Body>(api.app, "GET", `${ADMIN}/${res.body.id}`, { session: admin });
    expect(got.status).toBe(200);
    expect(got.body.lastReceiptAt).not.toBeNull();
    const list = await call<Body>(api.app, "GET", `${ADMIN}?organizationId=${w.orgA.id}&limit=100`, {
      session: kdsOrg,
    });
    expect(list.status).toBe(200);
    expect(list.body.items.some((x: Body) => x.id === res.body.id)).toBe(true);
    const stored = await api.db
      .selectFrom("webhook_endpoint")
      .selectAll()
      .where("id", "=", res.body.id)
      .executeTakeFirstOrThrow();
    const records = [
      res.body.id,
      connectorId,
      ...(
        await api.db.selectFrom("webhook_receipt").select("id").where("webhook_endpoint_id", "=", res.body.id).execute()
      ).map((r) => r.id),
    ];
    const audits = await api.db.selectFrom("audit_event").select("changes").where("record_id", "in", records).execute();
    expect(audits.length).toBeGreaterThanOrEqual(3);
    for (const text of [
      JSON.stringify(res.body),
      JSON.stringify(got.body),
      JSON.stringify(list.body),
      JSON.stringify(stored),
      JSON.stringify(audits),
    ]) {
      expect(text).not.toContain(SECRET_A);
      expect(text).not.toContain(SECRET_B);
    }
  });

  it("lists the organization's endpoints newest first; the cursor walks every endpoint exactly once", async () => {
    const connectorId = await webhookConnector();
    const mine = [await endpoint(connectorId), await endpoint(connectorId), await endpoint(connectorId)];
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const url: string = `${ADMIN}?organizationId=${w.orgA.id}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await call<Body>(api.app, "GET", url, { session: k.s.auditor });
      expect(res.status).toBe(200);
      seen.push(...res.body.items.map((e: Body) => e.id as string));
      cursor = res.body.nextCursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    const order = mine.map((e) => seen.indexOf(e.id as string));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => b - a)).toEqual(order); // newest first
  });

  it("refuses a secret value (422), a non-webhook connector (422), a bad tolerance (400) and an unknown connector (404)", async () => {
    const connectorId = await webhookConnector();
    const post = (body: Record<string, unknown>) =>
      call<Body>(api.app, "POST", ADMIN, {
        session: admin,
        body: { connectorId, label: "Synthetic", signingSecretRef: refA, toleranceSeconds: 300, ...body },
      });
    const value = await post({ signingSecretRef: { ...refA, value: "hunter2" } });
    expect([value.status, value.body.code]).toEqual([422, "connector.secret_value_refused"]);
    expect((await post({ signingSecretRef: "hunter2" })).body.code).toBe("connector.secret_value_refused");
    const pull = await call<Body>(api.app, "POST", "/api/v1/admin/connectors", {
      session: admin,
      body: {
        organizationId: w.orgA.id,
        code: uniq("ta-").toLowerCase(),
        nameEn: "Synthetic test adapter",
        nameAr: "محول اختبار اصطناعي",
        adapterKind: "test_adapter",
        targetKind: "none",
        config: {
          sourceSystemId: "synthetic.test:v1",
          endpointUrl: null,
          credentialRefs: {},
          fieldMappings: [],
          targetTransformationId: null,
          cadence: "manual",
          retryMaxAttempts: 0,
          retryBackoffSeconds: 60,
          commitMode: "manual",
          commitOnBehalfOf: null,
          outboundActions: [],
          reconciliationRule: "none",
          adapterSettings: { mode: "healthy" },
          reason: "Synthetic.",
        },
      },
    });
    expect(pull.status, JSON.stringify(pull.body)).toBe(201);
    const notWebhook = await post({ connectorId: pull.body.id });
    expect([notWebhook.status, notWebhook.body.code]).toEqual([422, "webhook.connector_not_webhook"]);
    expect((await post({ toleranceSeconds: 29 })).status).toBe(400);
    expect((await post({ toleranceSeconds: 901 })).status).toBe(400);
    expect((await post({ connectorId: crypto.randomUUID() })).status).toBe(404);
    const rows = await api.db
      .selectFrom("webhook_endpoint")
      .select("id")
      .where("connector_id", "=", connectorId)
      .execute();
    expect(rows).toEqual([]);
  });

  it("rotates and disables with If-Match (428, 409), refuses a bad grace (422) and any change after disable (409)", async () => {
    const e = await endpoint(await webhookConnector());
    const R = `${ADMIN}/${e.id}/rotate-secret`;
    const D = `${ADMIN}/${e.id}/disable`;
    const rotate = { signingSecretRef: refB, graceHours: 24, reason: "Synthetic rotation" };
    expect((await call<Body>(api.app, "POST", R, { session: admin, body: rotate })).status).toBe(428);
    const stale = await call<Body>(api.app, "POST", R, { session: admin, headers: ifm(2), body: rotate });
    expect(stale.status).toBe(409);
    for (const graceHours of [0, 169]) {
      const res = await call<Body>(api.app, "POST", R, {
        session: admin,
        headers: ifm(1),
        body: { ...rotate, graceHours },
      });
      expect([res.status, res.body.code]).toEqual([422, "webhook.grace_invalid"]);
    }
    const same = await call<Body>(api.app, "POST", R, {
      session: admin,
      headers: ifm(1),
      body: { ...rotate, signingSecretRef: refA },
    });
    expect([same.status, same.body.code]).toEqual([422, "connector.secret_value_refused"]);
    const ok = await call<Body>(api.app, "POST", R, { session: admin, headers: ifm(1), body: rotate });
    expect(ok.status).toBe(200);
    expect((await call<Body>(api.app, "POST", D, { session: admin, body: { reason: "Synthetic" } })).status).toBe(428);
    const off = await call<Body>(api.app, "POST", D, {
      session: admin,
      headers: ifm(2),
      body: { reason: "Synthetic: sender retired" },
    });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ status: "disabled", disableReason: "Synthetic: sender retired", version: 3 });
    expect(off.body.disabledBy).toBe(w.admin.id);
    const again = await call<Body>(api.app, "POST", D, {
      session: admin,
      headers: ifm(3),
      body: { reason: "Synthetic: again" },
    });
    expect([again.status, again.body.code]).toEqual([409, "webhook.endpoint_disabled"]);
    const rot = await call<Body>(api.app, "POST", R, {
      session: admin,
      headers: ifm(3),
      body: { ...rotate, signingSecretRef: refA },
    });
    expect([rot.status, rot.body.code]).toEqual([409, "webhook.endpoint_disabled"]);
    const events = await auditOf(api.db, e.id);
    expect(events.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["webhook_endpoint.created", null, 1],
      ["webhook_endpoint.secret_rotated", 1, 2],
      ["webhook_endpoint.disabled", 2, 3],
    ]);
  });

  it("AUD and KDS get 403 on every mutation, an outsider 404, no session 401; nothing is written", async () => {
    const connectorId = await webhookConnector();
    const e = await endpoint(connectorId);
    const outsider = await signIn(api.app, w.nobody.subject);
    const mutations: Array<[string, Record<string, unknown>]> = [
      [ADMIN, { connectorId, label: "x", signingSecretRef: refA, toleranceSeconds: 300 }],
      [`${ADMIN}/${e.id}/rotate-secret`, { signingSecretRef: refB, graceHours: 1, reason: "Synthetic" }],
      [`${ADMIN}/${e.id}/disable`, { reason: "Synthetic" }],
    ];
    for (const [path, body] of mutations) {
      for (const session of [k.s.auditor, kdsOrg]) {
        const res = await call<Body>(api.app, "POST", path, { session, body, headers: ifm(1) });
        expect(res.status, path).toBe(403);
      }
      const hidden = await call<Body>(api.app, "POST", path, { session: outsider, body, headers: ifm(1) });
      expect([403, 404]).toContain(hidden.status);
      expect((await call<Body>(api.app, "POST", path, { body, headers: ifm(1) })).status).toBe(401);
    }
    expect((await call<Body>(api.app, "GET", `${ADMIN}/${e.id}`, { session: outsider })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", `${ADMIN}/${e.id}`, { session: k.s.auditor })).status).toBe(200);
    const rows = await api.db
      .selectFrom("webhook_endpoint")
      .select("version")
      .where("connector_id", "=", connectorId)
      .execute();
    expect(rows).toEqual([{ version: 1 }]);
    expect((await auditOf(api.db, e.id)).length).toBe(1);
  });

  it("re-checks authorization at commit on the reloaded grants (a right lost meanwhile is 403; nothing written)", async () => {
    const e = await endpoint(await webhookConnector());
    const lost = { kind: "user", userId: w.admin.id, organizationId: w.orgA.id, grants: [], tracker: { decisions: 0 } };
    const request = {
      id: "be-n-commit-time",
      principal: lost,
      reauthenticate: async () => lost,
    } as unknown as FastifyRequest;
    let caught: unknown;
    try {
      await rotateSecret(api.db, request, e.id, 1, { signingSecretRef: refB, graceHours: 1, reason: "Synthetic" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpProblem);
    expect((caught as HttpProblem).status).toBe(403);
    const row = await api.db
      .selectFrom("webhook_endpoint")
      .selectAll()
      .where("id", "=", e.id)
      .executeTakeFirstOrThrow();
    expect(row.version).toBe(1);
    expect((await auditOf(api.db, e.id)).length).toBe(1);
  });
});
