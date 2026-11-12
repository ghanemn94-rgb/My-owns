// Administration > Backups: the read-only status of the backup sets the backup job reported (P7 slice E; ADR-0066 §6;
// REQ-S19-012, "view:IT"; D-248 O2). Route file created as a STUB by T-DG7-BE-A with its registration line in
// retention/index.ts; T-DG7-BE-G fills it (p7-work-split §E.1). No content of a backup is ever returned.
//
// Until then it registers NO route: the operation below stays in apps/api/test/support/p7-pending-be-g.ts (the
// contract test fails as soon as it is routed). The guard table is the P7 permission wiring.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";

/** The route guard of the backup-status operation (docs/api/openapi.yaml, tag `retention`; ADR-0066 §6). */
export const BACKUP_ROUTE_GUARDS = {
  listBackupSets: { method: "GET", path: "/api/v1/admin/backups", permission: "backup.read" },
} as const satisfies Record<string, P7RouteGuard>;

/** Registers this file's routes and returns them as "METHOD /path". A stub: none yet (T-DG7-BE-G). */
export function registerBackupRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
