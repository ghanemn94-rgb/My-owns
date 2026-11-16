// transfer (P7; p7-plan §2, ADR-0064, ADR-0065): whole-installation migration exports and their read-only import,
// reconciliation and identity-rebind views (slice C), and configuration bundles imported as drafts (slice D).
// Created by T-DG7-BE-A with stub route files; the owning tasks fill them (p7-plan §5.1: BE-C export, BE-D import,
// BE-F config-bundle). transfer imports no domain module except evidence (the EvidenceStore port): the export reads
// every table through the catalogue-driven plan (packages/db), writes only through the owner-role CLI, and each
// configuration kind reaches it through the ConfigBundleKindAdapter registry wired in server.ts (ADR-0065 §6).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps, ModuleRegistration } from "../platform/index.ts";
import { CONFIG_BUNDLE_ROUTE_GUARDS, registerConfigBundleRoutes } from "./config-bundle/routes.ts";
import { MIGRATION_EXPORT_ROUTE_GUARDS, registerMigrationExportRoutes } from "./export/routes.ts";
import { MIGRATION_IMPORT_ROUTE_GUARDS, registerMigrationImportRoutes } from "./import/routes.ts";

export type { P7RouteGuard } from "./guards.ts";
export {
  configBundleAdapters,
  createConfigBundleAdapterRegistry,
  setConfigBundleAdapters,
  type ConfigBundleAdapterRegistry,
  type ConfigBundleKindAdapter,
} from "./config-bundle/registry.ts";

/** Every route guard of the module, by operation id (the P7 permission wiring; T-DG7-BE-A). */
export const TRANSFER_ROUTE_GUARDS = Object.freeze({
  ...MIGRATION_EXPORT_ROUTE_GUARDS,
  ...MIGRATION_IMPORT_ROUTE_GUARDS,
  ...CONFIG_BUNDLE_ROUTE_GUARDS,
});

/**
 * Wiring hook called by the composition root (server.ts). Every route file of the module registers here (T-DG7-BE-A
 * created them as stubs; p7-plan §5.1). The module reports "scaffold" until a route exists, then "active".
 */
export function registerTransferModule(app: FastifyInstance, deps: ModuleDeps): ModuleRegistration {
  const routes = [
    ...registerMigrationExportRoutes(app, deps), // T-DG7-BE-C
    ...registerMigrationImportRoutes(app, deps), // T-DG7-BE-D
    ...registerConfigBundleRoutes(app, deps), // T-DG7-BE-F
  ];
  return Object.freeze({
    module: "transfer",
    status: routes.length > 0 ? "active" : "scaffold",
    deliversIn: "P7",
    routes: Object.freeze(routes),
  });
}
