// Administration > Data export: whole-installation migration exports (P7 slice C; ADR-0064 §7; REQ-S19-014,
// REQ-S19-016). Route file created as a stub by T-DG7-BE-A; filled by T-DG7-BE-C (p7-work-split §C.1):
//   GET  /admin/migration-exports                                     listMigrationExports
//   POST /admin/migration-exports                                     createMigrationExport (Idempotency-Key)
//   GET  /admin/migration-exports/:migrationExportId                  getMigrationExport
//   GET  /admin/migration-exports/:migrationExportId/manifest         downloadMigrationExportManifest
//   GET  /admin/migration-exports/:migrationExportId/attachment-manifest  downloadMigrationExportAttachmentManifest
// Every operation needs migration.export (ADM_TECH) at organization scope (service.ts); the request takes the
// migrationExport advisory lock (the registry's class) and writes its audit event; the worker job transfer.export audits every later
// transition. No response contains a row value or evidence bytes. An export moves records and configuration; it is
// never a business, Finance or IT approval (G1-G6), and never DG0-DG7.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf } from "../../access/index.ts";
import {
  idempotencyKeySchema,
  keysetPage,
  pageQueryFields,
  parse,
  parseBody,
  parseQuery,
  problems,
  requestHash,
  sendVersioned,
  withIdempotency,
  type ModuleDeps,
  type SortKey,
} from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";
import {
  filesystemPackageReader,
  findExport,
  migrationExportCreate,
  migrationExportPage,
  presentExport,
  readManifest,
  requestExport,
  requireExportRight,
  type ManifestKind,
  type MigrationExportView,
  type PackageReader,
} from "./service.ts";

/** The route guard of every migration-export operation (docs/api/openapi.yaml, tag `transfer`; ADR-0064 §9). */
export const MIGRATION_EXPORT_ROUTE_GUARDS = {
  listMigrationExports: { method: "GET", path: "/api/v1/admin/migration-exports", permission: "migration.export" },
  createMigrationExport: { method: "POST", path: "/api/v1/admin/migration-exports", permission: "migration.export" },
  getMigrationExport: {
    method: "GET",
    path: "/api/v1/admin/migration-exports/:migrationExportId",
    permission: "migration.export",
  },
  downloadMigrationExportManifest: {
    method: "GET",
    path: "/api/v1/admin/migration-exports/:migrationExportId/manifest",
    permission: "migration.export",
  },
  downloadMigrationExportAttachmentManifest: {
    method: "GET",
    path: "/api/v1/admin/migration-exports/:migrationExportId/attachment-manifest",
    permission: "migration.export",
  },
} as const satisfies Record<string, P7RouteGuard>;

const G = MIGRATION_EXPORT_ROUTE_GUARDS;
const JSON_BODY = ["application/json"] as const;
const idempotencyHeader = z.object({ "idempotency-key": idempotencyKeySchema.optional() }).passthrough();
const idParams = z.strictObject({ migrationExportId: z.uuid() });
const listQuery = z.strictObject({ ...pageQueryFields });
const noQuery = z.strictObject({});
/** Newest first (the contract's order), id as the tiebreak. */
const EXPORT_SORT: readonly SortKey[] = [
  { name: "created_at", type: "timestamptz", desc: true },
  { name: "id", type: "uuid", desc: true },
];

export interface MigrationExportRouteOptions {
  /** Where the stored package is read from (default: the evidence store's filesystem root). */
  readonly reader?: PackageReader;
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerMigrationExportRoutes(
  app: FastifyInstance,
  deps: ModuleDeps,
  options: MigrationExportRouteOptions = {},
): string[] {
  // Lazy: the module test registers with empty deps.
  const reader = options.reader ?? filesystemPackageReader(() => deps.config.evidenceStorage.path);
  const access = { access: { permission: "migration.export" as const } };

  app.get(G.listMigrationExports.path, { config: access }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireExportRight(deps.db, principalOf(request));
    const page = await keysetPage(deps.db.selectFrom("migration_export").selectAll(), EXPORT_SORT, query, {
      list: "migration-exports",
    });
    return migrationExportPage.parse({ items: page.items.map(presentExport), nextCursor: page.nextCursor });
  });

  app.post(G.createMigrationExport.path, { config: { ...access, consumes: JSON_BODY } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const key = parse(idempotencyHeader, request.headers, "header")["idempotency-key"];
    const principal = principalOf(request);
    // A replay answers from the idempotency record, so the right itself is decided first (403 for every role but
    // ADM_TECH, AUD included); the request re-checks it on reloaded grants inside its transaction.
    await requireExportRight(deps.db, principal);
    const body = parseBody(migrationExportCreate, request.body);
    const userId = principal.userId;
    const result = await deps.db.transaction().execute(async (tx) => {
      const run = async () => ({ status: 202, body: presentExport(await requestExport(tx, request, body.reason)) });
      return key === undefined || userId === null
        ? { ...(await run()), replayed: false }
        : withIdempotency<MigrationExportView>(
            tx,
            { userId, key, requestHash: requestHash(request.method, G.createMigrationExport.path, request.body) },
            run,
          );
    });
    if (result.replayed) {
      // The existing request, in its current state (it may have run since).
      const row = await findExport(deps.db, result.body.id);
      if (row === undefined) throw problems.notFound();
      return sendVersioned(reply, 200, presentExport(row));
    }
    return sendVersioned(reply, 202, result.body, `${G.createMigrationExport.path}/${result.body.id}`);
  });

  app.get(G.getMigrationExport.path, { config: access }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    const { migrationExportId } = parse(idParams, request.params, "params");
    await requireExportRight(deps.db, principalOf(request));
    const row = await findExport(deps.db, migrationExportId);
    if (row === undefined) throw problems.notFound();
    return sendVersioned(reply, 200, presentExport(row));
  });

  const download = (kind: ManifestKind) => async (request: FastifyRequest, reply: FastifyReply) => {
    parseQuery(noQuery, request.query);
    const { migrationExportId } = parse(idParams, request.params, "params");
    await requireExportRight(deps.db, principalOf(request));
    const row = await findExport(deps.db, migrationExportId);
    if (row === undefined) throw problems.notFound();
    const { bytes, sha256 } = await readManifest(reader, row, kind);
    const name = kind === "manifest" ? "migration-manifest" : "migration-attachments";
    return reply
      .code(200)
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${name}-${row.id}.json"`)
      .header("ETag", `"${sha256}"`)
      .header("Cache-Control", "no-store")
      .send(Buffer.from(bytes));
  };
  app.get(G.downloadMigrationExportManifest.path, { config: access }, download("manifest"));
  app.get(G.downloadMigrationExportAttachmentManifest.path, { config: access }, download("attachments"));

  return Object.values(G).map((g) => `${g.method} ${g.path}`);
}
