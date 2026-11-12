// The in-app requirement register and About (P7 slice I; p7-plan §4 T-DG7-ARCH-05, §5.1 BE-H: `/admin/requirements`,
// `/admin/about`). Route file created as a STUB by T-DG7-BE-A with its registration line in release/index.ts. Its
// operations, permission codes and texts are designed by T-DG7-ARCH-05 (not yet in the contract, so there is no guard
// table here yet); T-DG7-BE-H fills it. The register shown in the product is a build-time snapshot: release reads no
// delivery record at run time and imports no module, and nothing it shows is a DG0-DG7 or G1-G6 approval.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path". A stub: none yet (T-DG7-BE-H). */
export function registerReleaseRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
