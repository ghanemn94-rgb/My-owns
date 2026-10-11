// T-DG4-ARCH-R6 (repair; F-DG4-126, F-DG4-127, F-DG4-105, D-122; ADR-0030 and ADR-0037 amendment N4 of 2026-10-11).
// This repair adds no operation, so the operation list (the ARCH-R3 pattern) has nothing to hold; like ARCH-R5's, it is
// not imported by p4-pending.ts.
export const P4_PENDING_ARCH_R6: readonly string[] = [];

// The contract MEMBERS this repair adds that the API does not emit yet. Each is declared in docs/api/openapi.yaml WITHOUT
// being in its schema's `required` list, and `.optional()` in the shared zod mirror
// (packages/shared/src/schemas/dashboards.ts), so the contract test passes against the as-built API.
//
// Rule (as for ARCH-R5, D-120: the list can only shrink, and it must be empty when the DG4 candidate freezes):
//  - T-DG4-KBE-R7 emits each member on every response of the operations named, and removes the entry in the same change.
//  - The closing step, also T-DG4-KBE-R7, in the same change: add `valueBasis` to `DashboardItem.required` and
//    `currency` to `DashboardDrilldown.required` in openapi.yaml, drop the two `.optional()` calls in the zod mirror
//    (`dashboardItem.valueBasis`, `dashboardDrilldown.currency`), and replace "Not yet required: pending in
//    p4-pending-arch-r6.ts" in the two member descriptions (and the info paragraph's "declared but not yet required")
//    by "required since the API emits them (T-DG4-KBE-R7)". Nothing else in either file changes.
//
// Nothing reads this list mechanically: the contract test (apps/api/test/integration/contract/contract.test.ts) is
// outside this task's write scope. The list is the record of what is pending, and the members' openapi descriptions
// say "Not yet required: pending in p4-pending-arch-r6.ts".
export interface PendingMember {
  /** `<OpenAPI schema>.<member path>`. */
  readonly member: string;
  /** The operations whose responses carry it. */
  readonly operations: readonly string[];
  /** The zod mirror export that declares it (`@mth/shared/schemas`). */
  readonly zod: string;
}

// T-DG4-KBE-R7 removed both entries (the closing step, D-122, D-123; ARCH-R6 handback §4.1 item 6): the API emits
// `DashboardItem.valueBasis` on every DashboardItem of getTransformationDashboard, getWorkstreamDashboard,
// getExecutiveOverview, getAdoptionDashboard and getWorkspaceHeader, and `DashboardDrilldown.currency` on every
// getDashboardDrilldown response; both are now in their schema's `required` list in openapi.yaml and no longer
// `.optional()` in the zod mirror (dashboardItem, dashboardDrilldown).
export const P4_PENDING_ARCH_R6_MEMBERS: readonly PendingMember[] = [];

// The QUERY PARAMETERS this repair declares that the API does not accept yet. The as-built drill-down query schema
// (reporting/dashboards/drilldown.ts `drilldownQuery`, a strict object) answers 400 to an unknown `currency`, so no
// exercise may send it before T-DG4-KBE-R7. KBE-R7 accepts it, adds the contract exercises listed in the ARCH-R6
// handback (§4.3), and empties this list in the same change. A parameter has no `required` list to change: it stays
// `required: false`.
export interface PendingParameter {
  /** The operation that declares it. */
  readonly operationId: string;
  /** `components/parameters/<name>` and the query name. */
  readonly parameter: string;
  readonly name: string;
}

// T-DG4-KBE-R7 removed the one entry: getDashboardDrilldown accepts `currency` (drilldown.ts `drilldownQuery`), and the
// contract exercises send it through the validating client (p4-exercises-kbe-g.ts, after the K1 exercises): SAR and
// USD on value.planned, value.gap by basis, value.investment, the 422 dashboard.currency_not_applicable and the 400 of
// a lower-case code.
export const P4_PENDING_ARCH_R6_PARAMETERS: readonly PendingParameter[] = [];

// Not pending (already accepted by the as-built schema, only refused by a rule): `valueClass` `revenue_uplift` and
// `avoided_cost` on `value.gap` (was 422 dashboard.value_class_not_applicable; since T-DG4-KBE-R7, 200 with the top_line
// or non_cash gap). T-DG4-KBE-R7 changed the refusal and its test (finance-drilldown-k1.test.ts).
