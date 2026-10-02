// P2 operations declared in docs/api/openapi.yaml (T-DG2-ARCH-01B, contract-first) that have no route yet.
// The contract test excludes ONLY these from "every operation has a route and is exercised", and fails when a listed
// operation is already routed or exercised, so the lists can only shrink. Each owner removes an entry in the same
// change that adds its route and contract exercise (docs/architecture/p2-work-split.md):
//   - this file: backend-workflow-engineer (transformations, workflows, evidence, methodology, access operations);
//   - p2-pending-kpi.ts: kpi-benefits-engineer (kpi module operations).
// Both MUST be empty when the DG2 candidate freezes; a non-empty list at freeze means unfinished P2 scope.
import { P2_PENDING_KPI_OPERATIONS } from "./p2-pending-kpi.ts";

// Empty since T-DG2-BE: every backend operation is routed and exercised in contract/p2-exercises.ts.
const P2_PENDING_BACKEND_OPERATIONS: readonly string[] = [];

export const P2_PENDING_OPERATIONS: ReadonlySet<string> = new Set([
  ...P2_PENDING_BACKEND_OPERATIONS,
  ...P2_PENDING_KPI_OPERATIONS,
]);
