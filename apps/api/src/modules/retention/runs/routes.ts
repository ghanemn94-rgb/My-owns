// Administration > Retention: runs, dry runs, their per-record actions and the archived-record markers (P7 slice E;
// ADR-0067 §4-§6, §8; REQ-S19-013). Route file created as a STUB by T-DG7-BE-A with its registration line in
// retention/index.ts; T-DG7-BE-G fills it (p7-work-split §E.1: Idempotency-Key, the retentionRun advisory lock, 422
// retention.run_in_progress, the retention.archive job enqueued with singleton key = run id, audit
// retention_run.requested). A run is requested by a person and executed by the job under its own service identity.
//
// Until then it registers NO route: each operation below stays in apps/api/test/support/p7-pending-be-g.ts (the
// contract test fails as soon as a listed operation is routed). The guard table is the P7 permission wiring.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../../platform/index.ts";
import type { P7RouteGuard } from "../guards.ts";

/** The route guard of every retention-run operation (docs/api/openapi.yaml, tag `retention`; ADR-0067 §8). */
export const RETENTION_RUN_ROUTE_GUARDS = {
  listRetentionRuns: { method: "GET", path: "/api/v1/admin/retention/runs", permission: "retention.read" },
  createRetentionRun: { method: "POST", path: "/api/v1/admin/retention/runs", permission: "retention.run" },
  createRetentionDryRun: { method: "POST", path: "/api/v1/admin/retention/dry-runs", permission: "retention.run" },
  getRetentionRun: {
    method: "GET",
    path: "/api/v1/admin/retention/runs/:retentionRunId",
    permission: "retention.read",
  },
  listRetentionRunActions: {
    method: "GET",
    path: "/api/v1/admin/retention/runs/:retentionRunId/actions",
    permission: "retention.read",
  },
  listRetentionArchivedRecords: {
    method: "GET",
    path: "/api/v1/admin/retention/archived",
    permission: "retention.read",
  },
} as const satisfies Record<string, P7RouteGuard>;

/** Registers this file's routes and returns them as "METHOD /path". A stub: none yet (T-DG7-BE-G). */
export function registerRetentionRunRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
