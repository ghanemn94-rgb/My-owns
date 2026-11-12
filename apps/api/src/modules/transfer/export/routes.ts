// Administration > Data export: whole-installation migration exports (P7 slice C; ADR-0064 §7; REQ-S19-016). Route file
// created as a STUB by T-DG7-BE-A with its registration line in transfer/index.ts; T-DG7-BE-C fills it (p7-work-split
// §C.1: the 5 operations, the migrationExport advisory lock, audit per transition, the transfer.export job).
//
// Until then it registers NO route: each operation below stays in apps/api/test/support/p7-pending-be-c.ts, and the
// contract test fails as soon as a listed operation is routed (a scaffold answers nothing; platform/deps.ts). The guard
// table is the P7 permission wiring: BE-C declares each route with `{ access: { permission: <the row's permission> } }`.
// An export moves configuration and records, never a business, Finance or IT approval (G1-G6), and never DG0-DG7.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";

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

/** Registers this file's routes and returns them as "METHOD /path". A stub: none yet (T-DG7-BE-C). */
export function registerMigrationExportRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
