// T-DG4-ARCH-R5 (repair; F-DG4-123, D-119; ADR-0030 and ADR-0037 amendment N3 of 2026-10-11). This repair adds no
// operation, so the operation list (the ARCH-R3 pattern, imported by p4-pending.ts) has nothing to hold.
export const P4_PENDING_ARCH_R5: readonly string[] = [];

// The contract MEMBERS this repair adds that the API does not emit yet. Each is declared in docs/api/openapi.yaml WITHOUT
// being in its schema's `required` list, and `.optional()` in the shared zod mirror
// (packages/shared/src/schemas/dashboards.ts), so the contract test passes against the as-built API.
//
// Rule (as for the operation lists: the list can only shrink, and it must be empty when the DG4 candidate freezes):
//  - T-DG4-KBE-R6 emits each member on every response of the operations named, and removes the entry in the same change.
//  - When the list is empty, the solution-architect (or the orchestrator at the KBE-R6 merge) adds each member to its
//    schema's `required` list in openapi.yaml and drops `.optional()` from the zod mirror, in one change. From then on
//    the contract test enforces them on every response.
//
// Nothing reads this list mechanically: the contract test (apps/api/test/integration/contract/contract.test.ts) is
// outside this task's write scope. The list is the record of what is pending, and the members' openapi descriptions
// say "Not yet required: pending in p4-pending-arch-r5.ts".
export interface PendingMember {
  /** `<OpenAPI schema>.<member path>`. */
  readonly member: string;
  /** The operations whose responses carry it. */
  readonly operations: readonly string[];
  /** The zod mirror export that declares it (`@mth/shared/schemas`). */
  readonly zod: string;
}

export const P4_PENDING_ARCH_R5_MEMBERS: readonly PendingMember[] = [
  {
    member: "DashboardHeadline.headlineBasis",
    operations: [
      "getTransformationDashboard",
      "getWorkstreamDashboard",
      "getExecutiveOverview",
      "getFinanceDashboard",
      "getAdoptionDashboard",
      "getWorkspaceHeader",
    ],
    zod: "dashboardHeadline",
  },
  {
    member: "DashboardDrilldown.headlineBasis",
    operations: ["getDashboardDrilldown"],
    zod: "dashboardDrilldown",
  },
  {
    member: "WorkspaceHeader.benefits.headlines",
    operations: ["getWorkspaceHeader"],
    zod: "workspaceHeader",
  },
];
