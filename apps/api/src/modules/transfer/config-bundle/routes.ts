// Administration > Configuration transfer: configuration bundles exported and imported AS DRAFTS through the existing
// review and publish pipeline (P7 slice D; ADR-0065; REQ-S19-008). Route file created as a STUB by T-DG7-BE-A with its
// registration line in transfer/index.ts; T-DG7-BE-F fills it (p7-work-split §D.1: the 9 operations, the
// ConfigBundleKindAdapter port and registry in config-bundle/registry.ts, the configBundleImport advisory lock).
//
// Until then it registers NO route: each operation below stays in apps/api/test/support/p7-pending-be-f.ts (the
// contract test fails as soon as a listed operation is routed). The guard table is the P7 permission wiring. The commit
// also needs each written kind's OWN configure right, checked by that kind's adapter (ADR-0065 §8): config_bundle.import
// alone never lets a user write a kind they could not write by hand. An import never publishes and approves nothing.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";

/** The route guard of every configuration-bundle operation (docs/api/openapi.yaml, tag `transfer`; ADR-0065 §8). */
export const CONFIG_BUNDLE_ROUTE_GUARDS = {
  listConfigBundleExports: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/exports",
    permission: "config_bundle.export",
  },
  createConfigBundleExport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/exports",
    permission: "config_bundle.export",
  },
  getConfigBundleExport: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/exports/:configBundleExportId",
    permission: "config_bundle.export",
  },
  downloadConfigBundleExport: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/exports/:configBundleExportId/download",
    permission: "config_bundle.export",
  },
  listConfigBundleImports: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/imports",
    permission: "config_bundle.import",
  },
  uploadConfigBundleImport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/imports",
    permission: "config_bundle.import",
  },
  getConfigBundleImport: {
    method: "GET",
    path: "/api/v1/admin/config-bundles/imports/:configBundleImportId",
    permission: "config_bundle.import",
  },
  validateConfigBundleImport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/imports/:configBundleImportId/validate",
    permission: "config_bundle.import",
  },
  commitConfigBundleImport: {
    method: "POST",
    path: "/api/v1/admin/config-bundles/imports/:configBundleImportId/commit",
    permission: "config_bundle.import",
  },
} as const satisfies Record<string, P7RouteGuard>;

/** Registers this file's routes and returns them as "METHOD /path". A stub: none yet (T-DG7-BE-F). */
export function registerConfigBundleRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
