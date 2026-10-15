// Export jobs (OpenAPI tag "exports"; ADR-0046 §2, §5, §6, §8; REQ-S13-005, REQ-S13-006, REQ-S13-009; p5-work-split
// §F.5; T-DG5-BE-M; filled from BE-A's stub):
//   GET  /exports                       listExports     (authenticated; own jobs only, transformation.read re-checked)
//   POST /exports                       createExport    (export.create; + report.generate for a live selection)
//   GET  /exports/{exportId}            getExport       (requester; transformation.read re-checked; others 404)
//   GET  /exports/{exportId}/download   downloadExport  (requester; transformation.read re-checked; others 404)
//   POST /exports/{exportId}/cancel     cancelExport    (requester; If-Match)
//
// The API never renders (ADR-0046 §1): it writes the job and its outbox event, and streams the stored file through the
// dependency-free export-file store `@mth/reporting/storage`. Rendering is the worker's (apps/worker reports.export).
// Every write: authorization re-checked at commit time, Zod validation, If-Match on cancel (428 missing, 409 stale;
// create is version 1), one audit event per job transition in the same transaction, no remote I/O inside it (jobs.ts).
// The create body is application/json; cancel is a bodiless action and declares no media type (shared rule 3).
import { createExportStore, type ExportFileStore } from "@mth/reporting/storage";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../../platform/index.ts";
import {
  cancelExport,
  createExport,
  downloadableExport,
  exportCreate,
  exportListQuery,
  getExport,
  listExports,
} from "./jobs.ts";

const JSON_BODY = ["application/json"] as const;
const BASE = "/api/v1/exports";
const ONE = `${BASE}/:exportId`;
const idParams = z.strictObject({ exportId: z.uuid() });

/** RFC 6266: the stored name is ASCII already (the 0081 file_name CHECK). */
const attachment = (fileName: string) => `attachment; filename="${fileName.replace(/[^A-Za-z0-9_.-]/g, "_")}"`;

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerExportRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  // Created on first use: the store reads the configured evidence storage (ADR-0046 §5) only when a file is served.
  let store: ExportFileStore | null = null;
  const fileStore = (): ExportFileStore => (store ??= createExportStore(deps.config.evidenceStorage));

  app.get(BASE, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(exportListQuery, request.query);
    return listExports(db, request, query);
  });

  app.post(
    BASE,
    { config: { access: { permission: "export.create" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const raw = request.headers["idempotency-key"];
      const key = Array.isArray(raw) ? raw[0] : raw;
      const result = await createExport(db, request, () => parseBody(exportCreate, request.body), key);
      return sendVersioned(reply, result.status, result.job, `${BASE}/${result.job.id}`);
    },
  );

  app.get(ONE, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { exportId } = parse(idParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    return sendVersioned(reply, 200, await getExport(db, request, exportId));
  });

  app.get(`${ONE}/download`, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { exportId } = parse(idParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const file = await downloadableExport(db, request, exportId);
    let stream: AsyncIterable<Uint8Array>;
    try {
      stream = await fileStore().get(file.storageKey);
    } catch (err) {
      request.log.error({ err, exportId }, "export file missing from the store");
      throw problems.unavailable();
    }
    return reply
      .code(200)
      .header("Content-Type", file.contentType)
      .header("Content-Disposition", attachment(file.fileName))
      .header("Content-Length", String(file.size))
      .header("X-Content-Type-Options", "nosniff")
      .header("Cache-Control", "private, no-store")
      .header("ETag", `"${file.sha256}"`)
      .send(stream);
  });

  app.post(`${ONE}/cancel`, { config: { access: { permission: "export.create" } } }, async (request, reply) => {
    const { exportId } = parse(idParams, request.params, "params");
    const job = await db
      .transaction()
      .execute((tx) => cancelExport(tx, request, exportId, () => requireIfMatch(request)));
    return sendVersioned(reply, 200, job);
  });

  return [`GET ${BASE}`, `POST ${BASE}`, `GET ${ONE}`, `GET ${ONE}/download`, `POST ${ONE}/cancel`];
}
