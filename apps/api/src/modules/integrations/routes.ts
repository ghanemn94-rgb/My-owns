// integrations routes (P6 slices B and A; p6-work-split §B/A). Route file created as a stub by T-DG6-BE-A; each owning
// task adds one named block, strictly in the order BE-L (connectors), BE-L2 (runs), BE-M2 (imports), BE-N
// (webhooks), BE-N2 (outbound writes) (p6-work-split §B/A.11).
import type { FastifyInstance, RawRequestDefaultExpression } from "fastify";
import { freeText, uuid } from "@mth/shared/schemas";
import { z } from "zod";
import { holdsAnywhere, principalOf } from "../access/index.ts";
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
  problems,
  requireIfMatch,
  restrictParserTo,
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
import {
  cancelUpload,
  commitPermissions,
  commitUpload,
  findBatch,
  IMPORT_READ,
  listBatchRows,
  listBatches,
  requireImportAction,
  requireImportRead,
  stageUpload,
  toImportBatch,
  toImportRow,
} from "./imports/commit.ts";
import { templateCsv, templateFileName, templateRows, templateXlsx, toImportTemplate } from "./imports/templates.ts";
import { importTargetRegistry, CSV_MEDIA_TYPE, XLSX_MEDIA_TYPE } from "./imports/targets.ts";
import { importRefusals, IMPORT_LIMITS } from "./imports/validate.ts";

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

// ------------------------------------------------------------------------------------------------ BE-M2: imports
// T-DG6-BE-M2 (ADR-0056 §2-§6, §9; REQ-S17-002, REQ-S17-003):
//   GET  /api/v1/transformations/{transformationId}/imports                       listImports             (import.read)
//   POST /api/v1/transformations/{transformationId}/imports?template=             createImport            (import.create)
//   GET  /api/v1/transformations/{transformationId}/imports/{importId}            getImport               (import.read)
//   GET  /api/v1/transformations/{transformationId}/imports/{importId}/rows       listImportRows          (import.read)
//   POST /api/v1/transformations/{transformationId}/imports/{importId}/commit     commitImport            (import.commit
//                                                                                 + kpi_actual.submit; If-Match)
//   POST /api/v1/transformations/{transformationId}/imports/{importId}/cancel     cancelImport            (import.commit; If-Match)
//   GET  /api/v1/import-templates                                                 listImportTemplates     (import.read)
//   GET  /api/v1/import-templates/{templateVersion}/download                      downloadImportTemplate  (import.read)
// createImport's body is the file itself (`text/csv` or the XLSX media type; `X-File-Name` names it). Its parser only
// collects the bytes, refusing more than 10 MiB with 413 import.file_too_large while reading (before any parse); the
// file is parsed in the handler, after authentication and the 404/403 gates. Order in every mutation: 400
// query/header/body, 404 read gate, 403 permission gate, 413/415/422 file refusals (upload), 428/400 If-Match, then the
// transaction (the importCommit lock, the row lock, commit-time re-check on reloaded grants, 409 state and version,
// the change and its audit event).

const IMPORTS = "/api/v1/transformations/:transformationId/imports";
const IMPORT = `${IMPORTS}/:importId`;
const IMPORT_ROWS = `${IMPORT}/rows`;
const IMPORT_COMMIT_PATH = `${IMPORT}/commit`;
const IMPORT_CANCEL_PATH = `${IMPORT}/cancel`;
const IMPORT_TEMPLATES = "/api/v1/import-templates";
const IMPORT_TEMPLATE_DOWNLOAD = `${IMPORT_TEMPLATES}/:templateVersion/download`;

/** createImport's request media types, in the contract's (sorted) order: the 400 text lists them in this order. */
const IMPORT_FILE_CONSUMES = [XLSX_MEDIA_TYPE, CSV_MEDIA_TYPE] as const;
const TEMPLATE_VERSION = /^[a-z][a-z0-9_]*\.v[1-9][0-9]*$/;

const transformationParams = z.strictObject({ transformationId: uuid });
const importParams = z.strictObject({ transformationId: uuid, importId: uuid });
const templateParams = z.strictObject({ templateVersion: z.string().max(100).regex(TEMPLATE_VERSION) });
const importListQuery = z.strictObject({
  status: z.enum(["staging", "staged", "committed", "cancelled", "failed"]).optional(),
  sourceKind: z.enum(["csv_upload", "xlsx_upload", "webhook", "connector"]).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const importRowsQuery = z.strictObject({
  validationStatus: z.enum(["valid", "invalid", "duplicate_in_batch", "duplicate_committed"]).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const createImportQuery = z.strictObject({ template: z.string().max(100).regex(TEMPLATE_VERSION) });
const fileNameHeader = z.object({ "x-file-name": freeText(1, 255) }).passthrough();
const importCommitBody = z.strictObject({ note: freeText(3, 1000).nullable() });
const importCancelBody = z.strictObject({ reason: freeText(3, 1000) });
const templateDownloadQuery = z.strictObject({
  format: z.enum(["csv", "xlsx"]).default("csv"),
  transformationId: uuid,
});

/**
 * The upload body parser of one file media type: collects the raw bytes (never decoded here), refusing a declared or
 * actual size above 10 MiB with 413 import.file_too_large as soon as it is known. Registered once on the root instance;
 * `restrictParserTo` limits it to routes that declare the media type (createImport only).
 */
function fileBodyParser(mediaType: string) {
  return restrictParserTo<RawRequestDefaultExpression>(mediaType, (request, payload, done) => {
    const declared = Number(request.headers["content-length"] ?? "0");
    if (Number.isFinite(declared) && declared > IMPORT_LIMITS.fileBytes) {
      done(importRefusals.fileTooLarge());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (err: Error | null, value?: Buffer) => {
      if (settled) return;
      settled = true;
      payload.removeListener("data", onData);
      done(err, value);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > IMPORT_LIMITS.fileBytes) {
        // The rest of the body is never read: the connection is closed after the response (connection hygiene).
        payload.pause();
        settle(importRefusals.fileTooLarge());
        return;
      }
      chunks.push(chunk);
    };
    payload.on("data", onData);
    payload.once("end", () => settle(null, Buffer.concat(chunks, size)));
    payload.once("error", (err) => settle(err));
  });
}

function registerImportRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  for (const mediaType of IMPORT_FILE_CONSUMES) app.addContentTypeParser(mediaType, fileBodyParser(mediaType));

  // listImports: newest first (cursor over created_at, id).
  app.get(IMPORTS, { config: { access: { permission: IMPORT_READ } } }, async (request) => {
    const { transformationId } = parse(transformationParams, request.params, "params");
    const query = parseQuery(importListQuery, request.query);
    const principal = principalOf(request);
    await requireImportRead(db, principal, transformationId);
    const { cursor, limit, ...filters } = query;
    const hash = filterHash(filters);
    const after = decodeCursor(cursor, hash, 2);
    const rows = await listBatches(db, principal, transformationId, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceKind ? { sourceKind: query.sourceKind } : {}),
      after: after ? [String(after[0]), String(after[1])] : null,
      limit,
    });
    const page = paginate(rows, limit, (r) => [r.created_at.toISOString(), r.id], hash);
    return { items: page.items.map(toImportBatch), nextCursor: page.nextCursor };
  });

  // createImport: 201 with Location and ETag (the staged batch, version 2).
  app.post(
    IMPORTS,
    { config: { access: { permission: "import.create" }, consumes: IMPORT_FILE_CONSUMES } },
    async (request, reply) => {
      const { transformationId } = parse(transformationParams, request.params, "params");
      const { template } = parseQuery(createImportQuery, request.query);
      const fileName = parse(fileNameHeader, request.headers, "header")["x-file-name"];
      const body = request.body;
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(0);
      const contentType = request.headers["content-type"];
      const batch = await stageUpload(db, request, {
        transformationId,
        templateVersion: template,
        fileName,
        contentType: typeof contentType === "string" ? contentType : null,
        bytes,
      });
      return sendVersioned(
        reply,
        201,
        toImportBatch(batch),
        `${IMPORTS.replace(":transformationId", transformationId)}/${batch.id}`,
      );
    },
  );

  // getImport: 404 when the batch is not in a transformation the caller can read.
  app.get(IMPORT, { config: { access: { permission: IMPORT_READ } } }, async (request, reply) => {
    const { transformationId, importId } = parse(importParams, request.params, "params");
    parseQuery(noQuery, request.query);
    await requireImportRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, toImportBatch(await findBatch(db, transformationId, importId)));
  });

  // listImportRows: source order (cursor over row_number).
  app.get(IMPORT_ROWS, { config: { access: { permission: IMPORT_READ } } }, async (request) => {
    const { transformationId, importId } = parse(importParams, request.params, "params");
    const query = parseQuery(importRowsQuery, request.query);
    await requireImportRead(db, principalOf(request), transformationId);
    await findBatch(db, transformationId, importId);
    const { cursor, limit, ...filters } = query;
    const hash = filterHash(filters);
    const after = decodeCursor(cursor, hash, 1);
    const afterRowNumber = after === null ? null : Number(after[0]);
    if (afterRowNumber !== null && !Number.isSafeInteger(afterRowNumber))
      throw problems.badRequest(
        "validation.cursor",
        "The cursor is invalid or belongs to other filters.",
        "/query/cursor",
      );
    const rows = await listBatchRows(db, importId, {
      ...(query.validationStatus ? { validationStatus: query.validationStatus } : {}),
      afterRowNumber,
      limit,
    });
    const page = paginate(rows, limit, (r) => [r.row_number], hash);
    return { items: page.items.map(toImportRow), nextCursor: page.nextCursor };
  });

  // commitImport: 200 with the committed batch.
  app.post(
    IMPORT_COMMIT_PATH,
    { config: { access: { permission: "import.commit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, importId } = parse(importParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const { note } = parseBody(importCommitBody, request.body);
      const principal = principalOf(request);
      await requireImportRead(db, principal, transformationId);
      const batch = await findBatch(db, transformationId, importId);
      await requireImportAction(
        db,
        principal,
        transformationId,
        commitPermissions(importTargetRegistry().get(batch.template_version)),
      );
      const expected = requireIfMatch(request);
      const row = await commitUpload(db, request, transformationId, importId, expected, note);
      return sendVersioned(reply, 200, toImportBatch(row));
    },
  );

  // cancelImport: 200 with the cancelled batch; its rows are kept.
  app.post(
    IMPORT_CANCEL_PATH,
    { config: { access: { permission: "import.commit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, importId } = parse(importParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const { reason } = parseBody(importCancelBody, request.body);
      const principal = principalOf(request);
      await requireImportRead(db, principal, transformationId);
      await findBatch(db, transformationId, importId);
      await requireImportAction(db, principal, transformationId, ["import.commit"]);
      const expected = requireIfMatch(request);
      const row = await cancelUpload(db, request, transformationId, importId, expected, reason);
      return sendVersioned(reply, 200, toImportBatch(row));
    },
  );

  // listImportTemplates: the registered templates (403 for a caller who holds import.read nowhere).
  app.get(IMPORT_TEMPLATES, { config: { access: { permission: IMPORT_READ } } }, async (request) => {
    parseQuery(noQuery, request.query);
    if (!holdsAnywhere(principalOf(request), IMPORT_READ)) throw problems.forbidden();
    return { items: importTargetRegistry().list().map(toImportTemplate) };
  });

  // downloadImportTemplate: the file, prefilled for a transformation the caller can read (404 for an unknown template).
  app.get(IMPORT_TEMPLATE_DOWNLOAD, { config: { access: { permission: IMPORT_READ } } }, async (request, reply) => {
    const { templateVersion } = parse(templateParams, request.params, "params");
    const { format, transformationId } = parseQuery(templateDownloadQuery, request.query);
    await requireImportRead(db, principalOf(request), transformationId);
    const target = importTargetRegistry().get(templateVersion);
    if (!target) throw problems.notFound();
    const rows = await templateRows(db, target, transformationId);
    const bytes = format === "csv" ? templateCsv(target, rows) : templateXlsx(target, rows);
    return reply
      .code(200)
      .header("Content-Type", format === "csv" ? `${CSV_MEDIA_TYPE}; charset=utf-8` : XLSX_MEDIA_TYPE)
      .header("Content-Disposition", `attachment; filename="${templateFileName(target, format)}"`)
      .header("Cache-Control", "no-store")
      .send(Buffer.from(bytes));
  });

  return [
    `GET ${IMPORTS}`,
    `POST ${IMPORTS}`,
    `GET ${IMPORT}`,
    `GET ${IMPORT_ROWS}`,
    `POST ${IMPORT_COMMIT_PATH}`,
    `POST ${IMPORT_CANCEL_PATH}`,
    `GET ${IMPORT_TEMPLATES}`,
    `GET ${IMPORT_TEMPLATE_DOWNLOAD}`,
  ];
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerIntegrationRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    ...registerConnectorRoutes(app, deps), // BE-L: connectors, configuration versions, mappings, test
    ...registerRunRoutes(app, deps), // BE-L2: integration runs and retries
    ...registerImportRoutes(app, deps), // BE-M2: imports (upload, staged rows, commit, cancel) and templates
  ];
}
