// Administration > Retention: the retention classes (P7 slice E; ADR-0067 §1, §2, §8; REQ-S16-024, REQ-S19-013). Route
// file created as a STUB by T-DG7-BE-A with its registration line in retention/index.ts; T-DG7-BE-G fills it
// (p7-work-split §E.1: list, get, update with If-Match under the retentionRun advisory lock, the E.5 422 codes, audit
// retention_class.updated). Every class ships `retain` with no period; the IT approval reference is text recording an
// approval given outside the platform, never an approval by the platform or an agent.
//
// Until then it registers NO route: each operation below stays in apps/api/test/support/p7-pending-be-g.ts (the
// contract test fails as soon as a listed operation is routed). The guard table is the P7 permission wiring.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";

/** The route guard of every retention-class operation (docs/api/openapi.yaml, tag `retention`; ADR-0067 §8). */
export const RETENTION_CLASS_ROUTE_GUARDS = {
  listRetentionClasses: { method: "GET", path: "/api/v1/admin/retention/classes", permission: "retention.read" },
  getRetentionClass: {
    method: "GET",
    path: "/api/v1/admin/retention/classes/:retentionClassCode",
    permission: "retention.read",
  },
  updateRetentionClass: {
    method: "PUT",
    path: "/api/v1/admin/retention/classes/:retentionClassCode",
    permission: "retention.configure",
  },
} as const satisfies Record<string, P7RouteGuard>;

/** Registers this file's routes and returns them as "METHOD /path". A stub: none yet (T-DG7-BE-G). */
export function registerRetentionClassRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
