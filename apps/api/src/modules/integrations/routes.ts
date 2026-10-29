// integrations routes (P6 slices B and A; p6-work-split §B/A). Route file created as a stub by T-DG6-BE-A; each owning
// task adds one named block, strictly in the order BE-L (connectors), BE-L2 (runs), BE-M2 (imports), BE-N
// (webhooks), BE-N2 (outbound writes) (p6-work-split §B/A.11).
import type { FastifyInstance } from "fastify";
import { uuid } from "@mth/shared/schemas";
import { z } from "zod";
import { principalOf } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  etag,
  filterHash,
  limitSchema,
  paginate,
  parse,
  parseBody,
  idempotencyKeySchema,
  parseQuery,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import {
  checkConfig,
  checkFieldMappings,
  CONNECTOR_CONFIGURE,
  CONNECTOR_READ,
  connectorCreate,
  connectorDisable,
  connectorEnable,
  connectorMappingsUpdate,
  connectorRefusals,
  connectorTestRequest,
  connectorUpdate,
  createConnector,
  listConnectors,
  putConnector,
  putConnectorMappings,
  requireConnectorChange,
  requireCreate,
  setConnectorStatus,
  testAdapterAvailable,
  testConnector,
  toConnector,
  toConnectorMappings,
  toIntegrationRun,
  visibleConnector,
  type ConnectorTargetKind,
} from "./connectors.ts";
import type { ConnectorAdapterKind } from "./adapters/port.ts";
import {
  CONNECTOR_RUN,
  findRunOf,
  installDefaultConnectorAdapters,
  listRuns,
  queueManualRetry,
  queueManualRun,
  requireConnectorRun,
  toIntegrationRunDetail,
} from "./runs.ts";

const JSON_BODY = ["application/json"] as const;

// ------------------------------------------------------------------------------------------------ BE-L: connectors
// T-DG6-BE-L (ADR-0055 §1, §4, §9; REQ-S17-001):
//   GET  /api/v1/admin/connectors                              listConnectors        (connector.read)
//   POST /api/v1/admin/connectors                              createConnector       (connector.configure)
//   GET  /api/v1/admin/connectors/{connectorId}                getConnector          (connector.read)
//   PUT  /api/v1/admin/connectors/{connectorId}                putConnector          (connector.configure; If-Match)
//   POST /api/v1/admin/connectors/{connectorId}/enable         enableConnector       (connector.configure; If-Match)
//   POST /api/v1/admin/connectors/{connectorId}/disable        disableConnector      (connector.configure; If-Match)
//   POST /api/v1/admin/connectors/{connectorId}/test           testConnector         (connector.configure)
//   GET  /api/v1/admin/connectors/{connectorId}/mappings       getConnectorMappings  (connector.read)
//   PUT  /api/v1/admin/connectors/{connectorId}/mappings       putConnectorMappings  (connector.configure; If-Match)
// Order in every mutation: 400 body, 404 read gate, 403 configure gate, 422 business rules, 428/400 If-Match, then
// the transaction (row lock, commit-time re-check, 409 version, the change and its audit events). Responses that show
// credentials show references and whether each resolves, never a value; they are built after the transaction.

const CONNECTORS = "/api/v1/admin/connectors";
const CONNECTOR = `${CONNECTORS}/:connectorId`;
const CONNECTOR_ENABLE = `${CONNECTOR}/enable`;
const CONNECTOR_DISABLE = `${CONNECTOR}/disable`;
const CONNECTOR_TEST = `${CONNECTOR}/test`;
const CONNECTOR_MAPPINGS = `${CONNECTOR}/mappings`;

const connectorParams = z.strictObject({ connectorId: uuid });
const noQuery = z.strictObject({});
const connectorListQuery = z.strictObject({
  organizationId: uuid,
  status: z.enum(["disabled", "enabled"]).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

function registerConnectorRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // listConnectors: by code (cursor over code, id).
  app.get(CONNECTORS, { config: { access: { permission: CONNECTOR_READ } } }, async (request) => {
    const query = parseQuery(connectorListQuery, request.query);
    const principal = principalOf(request);
    const { cursor, limit, ...filters } = query;
    const hash = filterHash(filters);
    const after = decodeCursor(cursor, hash, 2);
    const rows = await listConnectors(db, principal, {
      organizationId: query.organizationId,
      ...(query.status ? { status: query.status } : {}),
      after: after ? [String(after[0]), String(after[1])] : null,
      limit,
    });
    const page = paginate(rows, limit, (r) => [r.code, r.id], hash);
    const items = [];
    for (const row of page.items) items.push(await toConnector(db, row));
    return { items, nextCursor: page.nextCursor };
  });

  // createConnector: 201 with Location and ETag "1".
  app.post(
    CONNECTORS,
    { config: { access: { permission: CONNECTOR_CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      parseQuery(noQuery, request.query);
      const body = parseBody(connectorCreate, request.body);
      const principal = principalOf(request);
      await requireCreate(db, principal, body.organizationId);
      if (body.adapterKind === "webhook" && body.targetKind !== "kpi_actual")
        throw connectorRefusals.adapterSettingsInvalid("/targetKind");
      const config = await checkConfig(db, body.organizationId, body.adapterKind, body.targetKind, body.config);
      const row = await db.transaction().execute((tx) =>
        createConnector(tx, request, {
          organizationId: body.organizationId,
          code: body.code,
          nameEn: body.nameEn,
          nameAr: body.nameAr,
          adapterKind: body.adapterKind as ConnectorAdapterKind,
          targetKind: body.targetKind as ConnectorTargetKind,
          config,
        }),
      );
      return sendVersioned(reply, 201, await toConnector(db, row), `${CONNECTORS}/${row.id}`);
    },
  );

  // getConnector: 404 when missing or unreadable.
  app.get(CONNECTOR, { config: { access: { permission: CONNECTOR_READ } } }, async (request, reply) => {
    const { connectorId } = parse(connectorParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const row = await visibleConnector(db, principalOf(request), connectorId);
    return sendVersioned(reply, 200, await toConnector(db, row));
  });

  // putConnector: the names; a configuration (not null) is a new configuration version.
  app.put(
    CONNECTOR,
    { config: { access: { permission: CONNECTOR_CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { connectorId } = parse(connectorParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const body = parseBody(connectorUpdate, request.body);
      const current = await requireConnectorChange(db, principalOf(request), connectorId);
      const config =
        body.config === null
          ? null
          : await checkConfig(
              db,
              current.organization_id,
              current.adapter_kind as ConnectorAdapterKind,
              current.target_kind as ConnectorTargetKind,
              body.config,
            );
      const expected = requireIfMatch(request);
      const row = await db
        .transaction()
        .execute((tx) =>
          putConnector(tx, request, connectorId, expected, { nameEn: body.nameEn, nameAr: body.nameAr, config }),
        );
      return sendVersioned(reply, 200, await toConnector(db, row));
    },
  );

  // enableConnector / disableConnector.
  for (const [path, to] of [
    [CONNECTOR_ENABLE, "enabled"],
    [CONNECTOR_DISABLE, "disabled"],
  ] as const) {
    app.post(
      path,
      { config: { access: { permission: CONNECTOR_CONFIGURE }, consumes: JSON_BODY } },
      async (request, reply) => {
        const { connectorId } = parse(connectorParams, request.params, "params");
        parseQuery(noQuery, request.query);
        const reason =
          to === "enabled"
            ? parseBody(connectorEnable, request.body).reason
            : parseBody(connectorDisable, request.body).reason;
        await requireConnectorChange(db, principalOf(request), connectorId);
        const expected = requireIfMatch(request);
        const row = await db
          .transaction()
          .execute((tx) => setConnectorStatus(tx, request, connectorId, expected, to, reason));
        return sendVersioned(reply, 200, await toConnector(db, row));
      },
    );
  }

  // testConnector: 200 with the finished test run (succeeded or failed). No If-Match: it creates a new run.
  app.post(
    CONNECTOR_TEST,
    { config: { access: { permission: CONNECTOR_CONFIGURE }, consumes: JSON_BODY } },
    async (request) => {
      const { connectorId } = parse(connectorParams, request.params, "params");
      parseQuery(noQuery, request.query);
      parseBody(connectorTestRequest, request.body);
      const current = await requireConnectorChange(db, principalOf(request), connectorId);
      if (!testAdapterAvailable(current)) throw connectorRefusals.adapterUnavailable();
      return toIntegrationRun(await testConnector(db, request, connectorId));
    },
  );

  // getConnectorMappings: ETag = the connector's version (the If-Match of putConnectorMappings).
  app.get(CONNECTOR_MAPPINGS, { config: { access: { permission: CONNECTOR_READ } } }, async (request, reply) => {
    const { connectorId } = parse(connectorParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const row = await visibleConnector(db, principalOf(request), connectorId);
    reply.header("ETag", etag(row.version));
    return toConnectorMappings(db, row);
  });

  // putConnectorMappings: a new configuration version with these mappings.
  app.put(
    CONNECTOR_MAPPINGS,
    { config: { access: { permission: CONNECTOR_CONFIGURE }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { connectorId } = parse(connectorParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const body = parseBody(connectorMappingsUpdate, request.body);
      const current = await requireConnectorChange(db, principalOf(request), connectorId);
      const fieldMappings = checkFieldMappings(body.fieldMappings, "/fieldMappings");
      if (current.target_kind === "none" && fieldMappings.length > 0)
        throw connectorRefusals.targetInvalid("/fieldMappings");
      const expected = requireIfMatch(request);
      const row = await db
        .transaction()
        .execute((tx) =>
          putConnectorMappings(tx, request, connectorId, expected, { fieldMappings, reason: body.reason }),
        );
      reply.header("ETag", etag(row.version));
      return toConnectorMappings(db, row);
    },
  );

  return [
    `GET ${CONNECTORS}`,
    `POST ${CONNECTORS}`,
    `GET ${CONNECTOR}`,
    `PUT ${CONNECTOR}`,
    `POST ${CONNECTOR_ENABLE}`,
    `POST ${CONNECTOR_DISABLE}`,
    `POST ${CONNECTOR_TEST}`,
    `GET ${CONNECTOR_MAPPINGS}`,
    `PUT ${CONNECTOR_MAPPINGS}`,
  ];
}

// ------------------------------------------------------------------------------------------------ BE-L2: runs
// T-DG6-BE-L2 (ADR-0055 §2-§4, §9; REQ-S17-001, REQ-S16-022, REQ-S17-005):
//   GET  /api/v1/admin/connectors/{connectorId}/runs                    listIntegrationRuns  (connector.read)
//   POST /api/v1/admin/connectors/{connectorId}/runs                    runConnector         (connector.run; Idempotency-Key)
//   GET  /api/v1/admin/connectors/{connectorId}/runs/{runId}            getIntegrationRun    (connector.read)
//   POST /api/v1/admin/connectors/{connectorId}/runs/{runId}/retry      retryIntegrationRun  (connector.run)
// No If-Match on the two POSTs: each creates a new run (ADR-0055 §9); the one-active-run rule, the run's unique key and
// the retry-once key are the concurrency control. Order: 400 body/header, 404 read gate, 403 run gate, then the
// transaction (the connectorRun lock, commit-time re-check, replay, 409/422 state refusals, the run and its audit event). The run
// itself executes after the commit, outside any request transaction (runs.ts, the run watch).

const RUNS = `${CONNECTOR}/runs`;
const RUN = `${RUNS}/:runId`;
const RUN_RETRY = `${RUN}/retry`;

const runParams = z.strictObject({ connectorId: uuid, runId: uuid });
const runListQuery = z.strictObject({
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const runRequest = z.strictObject({});
const idempotencyHeader = z.object({ "idempotency-key": idempotencyKeySchema.optional() }).passthrough();

function registerRunRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // The adapters this process ships (the local test adapter and http_pull); a test that swapped the registry keeps it.
  installDefaultConnectorAdapters();

  // listIntegrationRuns: newest first (cursor over queued_at, id).
  app.get(RUNS, { config: { access: { permission: CONNECTOR_READ } } }, async (request) => {
    const { connectorId } = parse(connectorParams, request.params, "params");
    const query = parseQuery(runListQuery, request.query);
    await visibleConnector(db, principalOf(request), connectorId);
    const { cursor, limit, ...filters } = query;
    const hash = filterHash(filters);
    const after = decodeCursor(cursor, hash, 2);
    const rows = await listRuns(db, connectorId, {
      ...(query.status ? { status: query.status } : {}),
      after: after ? [String(after[0]), String(after[1])] : null,
      limit,
    });
    const page = paginate(rows, limit, (r) => [r.queued_at.toISOString(), r.id], hash);
    return { items: page.items.map(toIntegrationRun), nextCursor: page.nextCursor };
  });

  // runConnector: 202 with the queued run; 200 with the existing run for the same Idempotency-Key.
  app.post(RUNS, { config: { access: { permission: CONNECTOR_RUN }, consumes: JSON_BODY } }, async (request, reply) => {
    const { connectorId } = parse(connectorParams, request.params, "params");
    parseQuery(noQuery, request.query);
    parseBody(runRequest, request.body);
    const key = parse(idempotencyHeader, request.headers, "header")["idempotency-key"];
    await requireConnectorRun(db, principalOf(request), connectorId);
    const { run, replay } = await queueManualRun(db, request, connectorId, key);
    return reply.code(replay ? 200 : 202).send(toIntegrationRun(run));
  });

  // getIntegrationRun: 404 when the connector is unreadable or the run belongs to another connector.
  app.get(RUN, { config: { access: { permission: CONNECTOR_READ } } }, async (request, reply) => {
    const { connectorId, runId } = parse(runParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const connector = await visibleConnector(db, principalOf(request), connectorId);
    const run = await findRunOf(db, connectorId, runId);
    reply.header("ETag", etag(run.version));
    return toIntegrationRunDetail(db, connector, run);
  });

  // retryIntegrationRun: 202 with the queued retry.
  app.post(
    RUN_RETRY,
    { config: { access: { permission: CONNECTOR_RUN }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { connectorId, runId } = parse(runParams, request.params, "params");
      parseQuery(noQuery, request.query);
      parseBody(runRequest, request.body);
      await requireConnectorRun(db, principalOf(request), connectorId);
      await findRunOf(db, connectorId, runId);
      const run = await queueManualRetry(db, request, connectorId, runId);
      return reply.code(202).send(toIntegrationRun(run));
    },
  );

  return [`GET ${RUNS}`, `POST ${RUNS}`, `GET ${RUN}`, `POST ${RUN_RETRY}`];
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerIntegrationRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    ...registerConnectorRoutes(app, deps), // BE-L: connectors, configuration versions, mappings, test
    ...registerRunRoutes(app, deps), // BE-L2: integration runs and retries
  ];
}
