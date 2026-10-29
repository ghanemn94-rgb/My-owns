// P6 contract exercises of BE-L (p6-plan §5.1, p6-work-split §2 rule 16, §B/A.1; T-DG6-BE-L): the nine connector
// operations (ADR-0055 §1, §4, §9), each with a success and every declared refusal it can reach, through the validating
// client. No shared zod mirror exists for Connector in packages/shared (outside BE-L's files); the mirrors below restate
// the contract schemas for the success bodies. testConnector runs against a test double of the adapter port registered
// for the duration of this seam only (BE-L2 ships the real local test adapter), then the process registry is restored.
// Every value is SYNTHETIC; configuring a connector approves nothing and never touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { expect } from "vitest";
import { z } from "zod";
import {
  ConnectorAdapterError,
  createConnectorAdapterRegistry,
  setConnectorAdapters,
  type ConnectorAdapter,
} from "../../../src/modules/integrations/adapters/port.ts";
import { executeIntegrationRun } from "../../../src/modules/integrations/runs.ts";
import { signIn, uniq, type P6ExerciseContext } from "../../support/harness.ts";

const decimal = z.string().regex(/^-?[0-9]{1,18}(\.[0-9]{1,6})?$/);
const fieldMapping = z.strictObject({ source: z.string().min(1).max(100), target: z.string() });
const integrationRun = z.strictObject({
  id: z.uuid(),
  connectorId: z.uuid(),
  configVersionNo: z.number().int().min(1),
  triggerKind: z.enum(["schedule", "manual", "retry", "test", "webhook"]),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  attemptNo: z.number().int().min(1).max(6),
  retryOfRunId: z.uuid().nullable(),
  idempotencyKey: z.string(),
  requestedBy: z.uuid().nullable(),
  serviceIdentityId: z.uuid(),
  queuedAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  rowsRead: z.number().int().min(0).nullable(),
  rowsStaged: z.number().int().min(0).nullable(),
  rowsCommitted: z.number().int().min(0).nullable(),
  rowsRejected: z.number().int().min(0).nullable(),
  rowsDuplicate: z.number().int().min(0).nullable(),
  errorCount: z.number().int().min(0).nullable(),
  errorCode: z.string().max(100).nullable(),
  errorMessage: z.string().max(2000).nullable(),
  reconciliation: z.strictObject({
    status: z.enum(["not_checked", "matched", "mismatched", "not_applicable"]),
    sourceRowCount: z.number().int().min(0).nullable(),
    sourceControlTotal: decimal.nullable(),
    stagedControlTotal: decimal.nullable(),
  }),
  importBatchId: z.uuid().nullable(),
  version: z.number().int().min(1),
});
const connector = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  code: z.string().regex(/^[a-z][a-z0-9_-]{1,62}$/),
  nameEn: z.string().max(200),
  nameAr: z.string().max(200),
  adapterKind: z.enum(["test_adapter", "webhook", "http_pull"]),
  targetKind: z.enum(["kpi_actual", "none"]),
  status: z.enum(["disabled", "enabled"]),
  statusReason: z.string().nullable(),
  config: z.strictObject({
    versionNo: z.number().int().min(1),
    sourceSystemId: z.string(),
    endpointUrl: z.string().nullable(),
    credentialRefs: z.record(
      z.string(),
      z.strictObject({ provider: z.string(), name: z.string(), resolvable: z.boolean().nullable() }),
    ),
    fieldMappings: z.array(fieldMapping),
    targetTransformationId: z.uuid().nullable(),
    cadence: z.enum(["manual", "hourly", "daily", "weekly"]),
    retryMaxAttempts: z.number().int().min(0).max(5),
    retryBackoffSeconds: z.number().int().min(10).max(3600),
    commitMode: z.enum(["manual", "auto"]),
    commitOnBehalfOf: z.uuid().nullable(),
    outboundActions: z.array(z.enum(["deliverable_status_push"])),
    reconciliationRule: z.enum(["none", "row_count", "row_count_and_total"]),
    adapterSettings: z.record(z.string(), z.unknown()),
    reason: z.string(),
    createdAt: z.string(),
    createdBy: z.uuid(),
  }),
  verification: z.enum(["verified", "not_verified"]),
  lastSuccessAt: z.string().nullable(),
  lastRun: integrationRun.nullable(),
  actionableError: z
    .strictObject({
      runId: z.uuid(),
      triggerKind: z.enum(["schedule", "manual", "retry", "test", "webhook"]),
      attemptNo: z.number().int().min(1),
      finishedAt: z.string(),
      errorCode: z.enum([
        "connector.source_unavailable",
        "connector.stopped",
        "connector.credentials_rejected",
        "connector.secret_unresolvable",
        "connector.mapping_mismatch",
        "connector.response_invalid",
      ]),
      params: z.record(z.string(), z.string()),
      fallbacks: z.array(z.enum(["kpi_form", "import_file"])),
    })
    .nullable(),
  serviceIdentityId: z.uuid(),
  version: z.number().int().min(1),
  updatedAt: z.string(),
});
const connectorPage = z.strictObject({ items: z.array(connector), nextCursor: z.string().nullable() });
const connectorMappings = z.strictObject({
  connectorId: z.uuid(),
  configVersionNo: z.number().int().min(1),
  fieldMappings: z.array(fieldMapping),
  targetColumns: z.array(
    z.strictObject({
      key: z.string(),
      labelEn: z.string(),
      labelAr: z.string(),
      required: z.boolean(),
      kind: z.enum(["text", "uuid", "decimal", "date", "boolean", "enum"]),
      example: z.string().nullable(),
    }),
  ),
});

// T-DG6-BE-L2 (ADR-0055 §2, §4): the run list and the run detail (IntegrationRunPage, IntegrationRunDetail).
const integrationRunPage = z.strictObject({ items: z.array(integrationRun), nextCursor: z.string().nullable() });
const integrationRunDetail = z.strictObject({
  run: integrationRun,
  retriedByRunId: z.uuid().nullable(),
  events: z.array(
    z.strictObject({
      recordVersion: z.number().int().min(1),
      status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
      rowsRead: z.number().int().min(0).nullable(),
      rowsStaged: z.number().int().min(0).nullable(),
      rowsCommitted: z.number().int().min(0).nullable(),
      rowsRejected: z.number().int().min(0).nullable(),
      rowsDuplicate: z.number().int().min(0).nullable(),
      errorCount: z.number().int().min(0).nullable(),
      errorCode: z.string().nullable(),
      occurredAt: z.string(),
    }),
  ),
  actionableError: z
    .strictObject({
      runId: z.uuid(),
      triggerKind: z.enum(["schedule", "manual", "retry", "test", "webhook"]),
      attemptNo: z.number().int().min(1),
      finishedAt: z.string(),
      errorCode: z.string(),
      params: z.record(z.string(), z.string()),
      fallbacks: z.array(z.enum(["kpi_form", "import_file"])),
    })
    .nullable(),
});

export const P6_MIRRORS_BE_L: Readonly<Record<string, z.ZodType>> = {
  listConnectors: connectorPage,
  createConnector: connector,
  getConnector: connector,
  putConnector: connector,
  enableConnector: connector,
  disableConnector: connector,
  testConnector: integrationRun,
  getConnectorMappings: connectorMappings,
  putConnectorMappings: connectorMappings,
  // T-DG6-BE-L2
  listIntegrationRuns: integrationRunPage,
  runConnector: integrationRun,
  getIntegrationRun: integrationRunDetail,
  retryIntegrationRun: integrationRun,
};

/** The seam's test double of the adapter port: healthy returns two text rows; stopped throws connector.stopped. */
const exerciseAdapter: ConnectorAdapter = {
  kind: "test_adapter",
  async fetch(config) {
    if (config.adapterSettings["mode"] === "stopped") throw new ConnectorAdapterError("connector.stopped");
    return { rows: [{ a: "1" }, { a: "2" }], sourceRowCount: 2, sourceControlTotal: null };
  },
  async dispatch() {
    return { outcome: "no_response" };
  },
  async outcome() {
    return { outcome: "no_response" };
  },
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });

export async function exerciseP6BeLOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: connector.read + configure
  const auditor = await signIn(api.app, w.auditor.subject); // AUD @ A: connector.read only
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const L = "/api/v1/admin/connectors";
  const configBody = (over: Record<string, unknown> = {}) => ({
    sourceSystemId: "synthetic.contract-source",
    endpointUrl: null,
    credentialRefs: {},
    fieldMappings: [],
    targetTransformationId: null,
    cadence: "manual",
    retryMaxAttempts: 3,
    retryBackoffSeconds: 60,
    commitMode: "manual",
    commitOnBehalfOf: null,
    outboundActions: [],
    reconciliationRule: "row_count",
    adapterSettings: { mode: "healthy" },
    reason: "Synthetic contract exercise.",
    ...over,
  });
  const code = uniq("ce-").toLowerCase();
  const createBody = {
    organizationId: w.orgA.id,
    code,
    nameEn: "Synthetic contract connector",
    nameAr: "موصل اصطناعي",
    adapterKind: "test_adapter",
    targetKind: "none",
    config: configBody(),
  };

  // createConnector: 201; 400; 401; 403 (AUD); 404 (unknown organization); 409 (code taken); 422 (secret value).
  const created = await mirrored("POST", L, { session: admin, body: createBody });
  expect(created.status).toBe(201);
  expect(created.headers["etag"]).toBe('"1"');
  const id = created.body.id as string;
  const one = `${L}/${id}`;
  expect((await mirrored("POST", L, { session: admin, body: { ...createBody, code: "X" } })).status).toBe(400);
  expect((await mirrored("POST", L, { body: createBody })).status).toBe(401);
  expect((await mirrored("POST", L, { session: auditor, body: { ...createBody, code: `${code}-a` } })).status).toBe(
    403,
  );
  expect(
    (await mirrored("POST", L, { session: admin, body: { ...createBody, code: `${code}-b`, organizationId: missing } }))
      .status,
  ).toBe(404);
  const taken = await mirrored("POST", L, { session: admin, body: createBody });
  expect(taken.status).toBe(409);
  expect(taken.body.code).toBe("connector.code_taken");
  const secret = await mirrored("POST", L, {
    session: admin,
    body: {
      ...createBody,
      code: `${code}-c`,
      config: configBody({ credentialRefs: { api: { provider: "env", name: "X", value: "synthetic" } } }),
    },
  });
  expect(secret.status).toBe(422);
  expect(secret.body.code).toBe("connector.secret_value_refused");

  // listConnectors: 200 (AUD); 400; 401; 403 (outsider); 404 (unknown organization).
  const list = await mirrored("GET", `${L}?organizationId=${w.orgA.id}&limit=100`, { session: auditor });
  expect(list.status).toBe(200);
  expect(list.body.items.some((c: { id: string }) => c.id === id)).toBe(true);
  expect((await mirrored("GET", `${L}?organizationId=x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`)).status).toBe(401);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${L}?organizationId=${missing}`, { session: admin })).status).toBe(404);

  // getConnector: 200 (AUD); 400; 401; 404 (missing; outsider).
  const got = await mirrored("GET", one, { session: auditor });
  expect(got.status).toBe(200);
  expect(got.body.verification).toBe("not_verified");
  expect((await mirrored("GET", `${L}/x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", `${L}/${missing}`, { session: admin })).status).toBe(404);
  expect((await mirrored("GET", one, { session: nobody })).status).toBe(404);

  // putConnector: 200 (a new configuration version); 400; 401; 403 (AUD); 404; 409; 422; 428.
  const putBody = { nameEn: "Renamed contract connector", nameAr: "موصل", config: configBody({ cadence: "daily" }) };
  expect((await mirrored("PUT", one, { session: admin, body: putBody })).status).toBe(428);
  expect((await mirrored("PUT", one, { session: admin, body: putBody, headers: ifm(7) })).status).toBe(409);
  expect((await mirrored("PUT", one, { session: admin, body: { nameEn: "x" }, headers: ifm(1) })).status).toBe(400);
  expect((await mirrored("PUT", one, { body: putBody, headers: ifm(1) })).status).toBe(401);
  expect((await mirrored("PUT", one, { session: auditor, body: putBody, headers: ifm(1) })).status).toBe(403);
  expect((await mirrored("PUT", `${L}/${missing}`, { session: admin, body: putBody, headers: ifm(1) })).status).toBe(
    404,
  );
  const badSettings = await mirrored("PUT", one, {
    session: admin,
    body: { ...putBody, config: configBody({ adapterSettings: {} }) },
    headers: ifm(1),
  });
  expect(badSettings.status).toBe(422);
  expect(badSettings.body.code).toBe("connector.adapter_settings_invalid");
  const put = await mirrored("PUT", one, { session: admin, body: putBody, headers: ifm(1) });
  expect(put.status).toBe(200);
  expect(put.body.config.versionNo).toBe(2);

  // getConnectorMappings: 200; 400; 401; 404.
  const maps = `${one}/mappings`;
  const mappings = await mirrored("GET", maps, { session: auditor });
  expect(mappings.status).toBe(200);
  expect(mappings.headers["etag"]).toBe('"2"');
  expect((await mirrored("GET", `${L}/x/mappings`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", maps)).status).toBe(401);
  expect((await mirrored("GET", `${L}/${missing}/mappings`, { session: admin })).status).toBe(404);

  // putConnectorMappings: 200; 400; 401; 403 (AUD); 404; 409; 422 (an action-only connector has no mappings); 428.
  const mapBody = { fieldMappings: [], reason: "Synthetic: no mappings for an action-only connector." };
  expect((await mirrored("PUT", maps, { session: admin, body: mapBody })).status).toBe(428);
  expect((await mirrored("PUT", maps, { session: admin, body: mapBody, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("PUT", maps, { session: admin, body: { fieldMappings: [] }, headers: ifm(2) })).status).toBe(
    400,
  );
  expect((await mirrored("PUT", maps, { body: mapBody, headers: ifm(2) })).status).toBe(401);
  expect((await mirrored("PUT", maps, { session: auditor, body: mapBody, headers: ifm(2) })).status).toBe(403);
  expect(
    (await mirrored("PUT", `${L}/${missing}/mappings`, { session: admin, body: mapBody, headers: ifm(2) })).status,
  ).toBe(404);
  const mapRefused = await mirrored("PUT", maps, {
    session: admin,
    body: { ...mapBody, fieldMappings: [{ source: "a", target: "value" }] },
    headers: ifm(2),
  });
  expect(mapRefused.status).toBe(422);
  expect(mapRefused.body.code).toBe("connector.target_invalid");
  const mapped = await mirrored("PUT", maps, { session: admin, body: mapBody, headers: ifm(2) });
  expect(mapped.status).toBe(200);
  expect(mapped.body.configVersionNo).toBe(3);

  // enableConnector: 200; 400; 401; 403 (AUD); 404; 409; 422 (already enabled); 428.
  const en = `${one}/enable`;
  expect((await mirrored("POST", en, { session: admin, body: { reason: null } })).status).toBe(428);
  expect((await mirrored("POST", en, { session: admin, body: { reason: null }, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("POST", en, { session: admin, body: {}, headers: ifm(3) })).status).toBe(400);
  expect((await mirrored("POST", en, { body: { reason: null }, headers: ifm(3) })).status).toBe(401);
  expect((await mirrored("POST", en, { session: auditor, body: { reason: null }, headers: ifm(3) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${L}/${missing}/enable`, { session: admin, body: { reason: null }, headers: ifm(3) }))
      .status,
  ).toBe(404);
  const enabled = await mirrored("POST", en, {
    session: admin,
    body: { reason: "Synthetic enable." },
    headers: ifm(3),
  });
  expect(enabled.status).toBe(200);
  expect(enabled.body.status).toBe("enabled");
  expect((await mirrored("POST", en, { session: admin, body: { reason: null }, headers: ifm(4) })).status).toBe(422);

  // testConnector: 200 (succeeded, then verified); 400; 401; 403 (AUD); 404; 409 (a run is active); 422 (webhook).
  const test = `${one}/test`;
  const previous = setConnectorAdapters(createConnectorAdapterRegistry([exerciseAdapter]));
  try {
    const ran = await mirrored("POST", test, { session: admin, body: {} });
    expect(ran.status).toBe(200);
    expect(ran.body).toMatchObject({ status: "succeeded", triggerKind: "test", rowsRead: 2 });
    expect((await mirrored("GET", one, { session: admin })).body.verification).toBe("verified");
    expect((await mirrored("POST", test, { session: admin, body: { x: 1 } })).status).toBe(400);
    expect((await mirrored("POST", test, { body: {} })).status).toBe(401);
    expect((await mirrored("POST", test, { session: auditor, body: {} })).status).toBe(403);
    expect((await mirrored("POST", `${L}/${missing}/test`, { session: admin, body: {} })).status).toBe(404);
    const runId = crypto.randomUUID();
    await api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("integration_run")
        .values({
          id: runId,
          organization_id: w.orgA.id,
          connector_id: id,
          config_version_no: 3,
          trigger_kind: "schedule",
          idempotency_key: `schedule:${id}:2026-10-29T00:00:00Z`,
          service_identity_id: created.body.serviceIdentityId,
          queued_at: sql<Date>`now()`,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "system", actorUserId: null, source: "worker" },
        {
          action: "integration_run.queued",
          recordType: "integration_run",
          recordId: runId,
          organizationId: w.orgA.id,
          newVersion: 1,
        },
      );
    });
    const busy = await mirrored("POST", test, { session: admin, body: {} });
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("connector.run_active");
    const hook = await mirrored("POST", L, {
      session: admin,
      body: {
        ...createBody,
        code: `${code}-w`,
        adapterKind: "webhook",
        targetKind: "kpi_actual",
        config: configBody({ adapterSettings: {}, targetTransformationId: null }),
      },
    });
    // A webhook connector needs a target transformation (422 connector.target_invalid) …
    expect(hook.status).toBe(422);
    expect(hook.body.code).toBe("connector.target_invalid");
  } finally {
    setConnectorAdapters(previous);
  }
  // … and with no pull adapter registered, a test is 422 connector.adapter_unavailable. Since T-DG6-BE-L2 the process
  // registers the local test adapter and http_pull at start, so the seam empties the registry for this check only.
  const noAdapter = await mirrored("POST", L, {
    session: admin,
    body: { ...createBody, code: `${code}-n` },
  });
  expect(noAdapter.status).toBe(201);
  const registered = setConnectorAdapters(createConnectorAdapterRegistry());
  try {
    const unavailable = await mirrored("POST", `${L}/${noAdapter.body.id}/test`, { session: admin, body: {} });
    expect(unavailable.status).toBe(422);
    expect(unavailable.body.code).toBe("connector.adapter_unavailable");
  } finally {
    setConnectorAdapters(registered);
  }

  // disableConnector: 200 (the queued run is cancelled); 400; 401; 403 (AUD); 404; 409; 422 (already disabled); 428.
  const dis = `${one}/disable`;
  const reason = { reason: "Synthetic disable." };
  expect((await mirrored("POST", dis, { session: admin, body: reason })).status).toBe(428);
  expect((await mirrored("POST", dis, { session: admin, body: reason, headers: ifm(9) })).status).toBe(409);
  expect((await mirrored("POST", dis, { session: admin, body: {}, headers: ifm(4) })).status).toBe(400);
  expect((await mirrored("POST", dis, { body: reason, headers: ifm(4) })).status).toBe(401);
  expect((await mirrored("POST", dis, { session: auditor, body: reason, headers: ifm(4) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${L}/${missing}/disable`, { session: admin, body: reason, headers: ifm(4) })).status,
  ).toBe(404);
  const disabled = await mirrored("POST", dis, { session: admin, body: reason, headers: ifm(4) });
  expect(disabled.status).toBe(200);
  expect(disabled.body.status).toBe("disabled");
  expect((await mirrored("POST", dis, { session: admin, body: reason, headers: ifm(5) })).status).toBe(422);

  await exerciseP6BeL2Operations(ctx);
}

// ------------------------------------------------------------------------------------------------ BE-L2: runs
// T-DG6-BE-L2 (ADR-0055 §2-§4, §9): the four run operations, each with its success and every declared refusal it can
// reach, through the validating client. The run executes with the real local test adapter (mode failing, so the
// retry operations have a failed run) through the run engine, as the API's run watch would.
async function exerciseP6BeL2Operations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: connector.read + configure + run
  const auditor = await signIn(api.app, w.auditor.subject); // AUD @ A: connector.read only
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const L = "/api/v1/admin/connectors";
  const config = (retryMaxAttempts: number) => ({
    sourceSystemId: "synthetic.contract-runs",
    endpointUrl: null,
    credentialRefs: {},
    fieldMappings: [],
    targetTransformationId: null,
    cadence: "manual",
    retryMaxAttempts,
    retryBackoffSeconds: 60,
    commitMode: "manual",
    commitOnBehalfOf: null,
    outboundActions: [],
    reconciliationRule: "row_count",
    adapterSettings: { mode: "failing" },
    reason: "Synthetic contract exercise of the runs.",
  });
  const created = await mirrored("POST", L, {
    session: admin,
    body: {
      organizationId: w.orgA.id,
      code: uniq("ce-runs-").toLowerCase(),
      nameEn: "Synthetic contract run connector",
      nameAr: "موصل تشغيل اصطناعي",
      adapterKind: "test_adapter",
      targetKind: "none",
      config: config(0),
    },
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const runs = `${L}/${id}/runs`;
  // runConnector before enabling: 409 connector.disabled.
  const off = await mirrored("POST", runs, { session: admin, body: {} });
  expect(off.status).toBe(409);
  expect(off.body.code).toBe("connector.disabled");
  expect(
    (await mirrored("POST", `${L}/${id}/enable`, { session: admin, body: { reason: null }, headers: ifm(1) })).status,
  ).toBe(200);

  // runConnector: 202; 200 (same Idempotency-Key); 400; 401; 403 (AUD); 404; 409 (a run is active).
  const key = uniq("ce-key-");
  const queued = await mirrored("POST", runs, { session: admin, body: {}, headers: { "idempotency-key": key } });
  expect(queued.status).toBe(202);
  expect(queued.body).toMatchObject({ status: "queued", rowsRead: null });
  const replay = await mirrored("POST", runs, { session: admin, body: {}, headers: { "idempotency-key": key } });
  expect(replay.status).toBe(200);
  expect(replay.body.id).toBe(queued.body.id);
  expect((await mirrored("POST", runs, { session: admin, body: { x: 1 } })).status).toBe(400);
  expect((await mirrored("POST", runs, { body: {} })).status).toBe(401);
  expect((await mirrored("POST", runs, { session: auditor, body: {} })).status).toBe(403);
  expect((await mirrored("POST", `${L}/${missing}/runs`, { session: admin, body: {} })).status).toBe(404);
  const active = await mirrored("POST", runs, { session: admin, body: {} });
  expect(active.status).toBe(409);
  expect(active.body.code).toBe("connector.run_active");

  // The run executes (outside any request) and fails: the test adapter is in mode failing.
  const runId = queued.body.id as string;
  const executed = await executeIntegrationRun(api.db, runId);
  expect(executed.outcome).toBe("failed");

  // listIntegrationRuns: 200 (AUD); 400; 401; 404 (missing; outsider).
  const list = await mirrored("GET", `${runs}?limit=5`, { session: auditor });
  expect(list.status).toBe(200);
  expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([runId]);
  expect((await mirrored("GET", `${runs}?status=done`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", runs)).status).toBe(401);
  expect((await mirrored("GET", `${L}/${missing}/runs`, { session: admin })).status).toBe(404);
  expect((await mirrored("GET", runs, { session: nobody })).status).toBe(404);

  // getIntegrationRun: 200 (the actionable error); 400; 401; 404.
  const one = `${runs}/${runId}`;
  const detail = await mirrored("GET", one, { session: auditor });
  expect(detail.status).toBe(200);
  expect(detail.headers["etag"]).toBe('"3"');
  expect(detail.body.actionableError).toMatchObject({ errorCode: "connector.source_unavailable" });
  expect((await mirrored("GET", `${runs}/x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", `${runs}/${missing}`, { session: admin })).status).toBe(404);

  // retryIntegrationRun: 422 (limit 1 attempt with retryMaxAttempts 0); 202 after raising the bound; 409 (once);
  // 400; 401; 403 (AUD); 404.
  const retry = `${one}/retry`;
  const limited = await mirrored("POST", retry, { session: admin, body: {} });
  expect(limited.status).toBe(422);
  expect(limited.body.code).toBe("integration_run.retry_limit_reached");
  const put = await mirrored("PUT", `${L}/${id}`, {
    session: admin,
    body: { nameEn: "Synthetic contract run connector", nameAr: "موصل تشغيل اصطناعي", config: config(1) },
    headers: ifm(2),
  });
  expect(put.status).toBe(200);
  expect((await mirrored("POST", retry, { session: admin, body: { x: 1 } })).status).toBe(400);
  expect((await mirrored("POST", retry, { body: {} })).status).toBe(401);
  expect((await mirrored("POST", retry, { session: auditor, body: {} })).status).toBe(403);
  expect((await mirrored("POST", `${runs}/${missing}/retry`, { session: admin, body: {} })).status).toBe(404);
  const retried = await mirrored("POST", retry, { session: admin, body: {} });
  expect(retried.status).toBe(202);
  expect(retried.body).toMatchObject({ triggerKind: "retry", attemptNo: 2, retryOfRunId: runId, status: "queued" });
  const again = await mirrored("POST", retry, { session: admin, body: {} });
  expect(again.status).toBe(409);
  expect(again.body.code).toBe("integration_run.not_retryable");
}
