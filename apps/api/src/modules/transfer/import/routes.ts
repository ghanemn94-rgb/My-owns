// Administration > Migration status: the read-only migration import, reconciliation and identity rebind views (P7 slice
// C; ADR-0064 §6, §8; REQ-S19-014). The import and the rebind themselves are CLI-only and IT-run (mth-db), never an API
// write. Route file created as a STUB by T-DG7-BE-A with its registration line in transfer/index.ts; T-DG7-BE-D fills
// it (p7-work-split §C.2: the 5 read-only operations, migration_import.read).
//
// Until then it registers NO route: each operation below stays in apps/api/test/support/p7-pending-be-d.ts (the
// contract test fails as soon as a listed operation is routed). The guard table is the P7 permission wiring.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";

/** The route guard of every migration-import operation (docs/api/openapi.yaml, tag `transfer`; ADR-0064 §9). */
export const MIGRATION_IMPORT_ROUTE_GUARDS = {
  listMigrationImports: {
    method: "GET",
    path: "/api/v1/admin/migration-imports",
    permission: "migration_import.read",
  },
  getMigrationImport: {
    method: "GET",
    path: "/api/v1/admin/migration-imports/:migrationImportId",
    permission: "migration_import.read",
  },
  listMigrationReconciliations: {
    method: "GET",
    path: "/api/v1/admin/migration-imports/:migrationImportId/reconciliations",
    permission: "migration_import.read",
  },
  getMigrationReconciliation: {
    method: "GET",
    path: "/api/v1/admin/migration-imports/:migrationImportId/reconciliations/:migrationReconciliationId",
    permission: "migration_import.read",
  },
  listIdentityRebinds: { method: "GET", path: "/api/v1/admin/identity-rebinds", permission: "migration_import.read" },
} as const satisfies Record<string, P7RouteGuard>;

/** Registers this file's routes and returns them as "METHOD /path". A stub: none yet (T-DG7-BE-D). */
export function registerMigrationImportRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
