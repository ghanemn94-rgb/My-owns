// retention (P7; p7-plan §2, ADR-0066 §6, ADR-0067): retention classes, retention runs and dry runs, the per-record
// action log, archived-record markers, and the read-only backup-set status (slice E). Created by T-DG7-BE-A with stub
// route files; T-DG7-BE-G fills them (p7-plan §5.1; p7-work-split §E.1: "the three route registrations" below).
// retention imports no domain module except evidence (the EvidenceStore port, for the archive set): which tables a
// class covers is data (0143 `retention_table_class`, generated from the catalogue), never an import of the owning
// module. The RetentionClassRegistry wiring point is in server.ts (see the P7 block there).
//
// Nothing here approves anything: a retention class's IT approval reference is text recording an approval given
// outside the platform (D-243 Q3), and no class leaves `retain` unless a person changes it with that reference.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { BACKUP_ROUTE_GUARDS, registerBackupRoutes } from "./backups/routes.ts";
import { registerRetentionClassRoutes, RETENTION_CLASS_ROUTE_GUARDS } from "./classes/routes.ts";
import { registerRetentionRunRoutes, RETENTION_RUN_ROUTE_GUARDS } from "./runs/routes.ts";

export type { P7RouteGuard } from "./guards.ts";

/** Every route guard of the module, by operation id (the P7 permission wiring; T-DG7-BE-A). */
export const RETENTION_ROUTE_GUARDS = Object.freeze({
  ...RETENTION_CLASS_ROUTE_GUARDS,
  ...RETENTION_RUN_ROUTE_GUARDS,
  ...BACKUP_ROUTE_GUARDS,
});

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG7-BE-A
 * created them as stubs; p7-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerRetentionModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [
    ...registerRetentionClassRoutes(app, deps), // T-DG7-BE-G
    ...registerRetentionRunRoutes(app, deps), // T-DG7-BE-G
    ...registerBackupRoutes(app, deps), // T-DG7-BE-G
  ];
  return Object.freeze({
    module: "retention",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P7",
    routes: Object.freeze(routes),
  });
}
