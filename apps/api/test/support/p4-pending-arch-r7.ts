// T-DG4-ARCH-R7 (repair; D-124 items 2 and 3; ADR-0037 amendment N5 of 2026-10-11): the KPI unit kind on dashboard
// values. This repair adds no operation, so the operation list (the ARCH-R3 pattern) has nothing to hold; like
// ARCH-R5's and ARCH-R6's, it is not imported by p4-pending.ts.
export const P4_PENDING_ARCH_R7: readonly string[] = [];

// The contract MEMBERS this repair adds that the API does not emit yet. Each is declared in docs/api/openapi.yaml WITHOUT
// being in its schema's `required` list, and `.optional()` in the shared zod mirror
// (packages/shared/src/schemas/dashboards.ts), so the contract test passes against the as-built API.
//
// Rule (as for ARCH-R5 and ARCH-R6, D-120: the list can only shrink, and it must be empty when the DG4 candidate
// freezes):
//  - T-DG4-KBE-R8 emits the member on EVERY DashboardValue of the operations named (null where the value is not
//    KPI-derived), and removes the entry in the same change.
//  - The closing step, also T-DG4-KBE-R8, in the same change:
//    1. openapi.yaml: add `kpiUnit` to `DashboardValue.required`, after `reasonKey`
//       (`required: [state, value, unit, currency, reasonKey, kpiUnit]`). `DashboardKpiUnit.required` is already
//       `[kind, label]` and does not change.
//    2. openapi.yaml: in the `DashboardValue.kpiUnit` description, replace "Not yet required: pending in
//       p4-pending-arch-r7.ts." by "Required since the API emits it (T-DG4-KBE-R8).".
//    3. openapi.yaml: in the info paragraph "P4 repairs (T-DG4-ARCH-R7 …)", replace "The member is declared but not yet
//       required: pending in `p4-pending-arch-r7.ts` until the API emits it." (on one line) by "The member
//       is required since the API emits it (T-DG4-KBE-R8).".
//    4. dashboards.ts: `kpiUnit: dashboardKpiUnit.nullable().optional()` becomes `kpiUnit: dashboardKpiUnit.nullable()`,
//       and in the `dashboardValue` doc comment the sentence "`kpiUnit` is `.optional()` until T-DG4-KBE-R8 emits it
//       (pending in apps/api/test/support/p4-pending-arch-r7.ts)." becomes "`kpiUnit` is required: the API emits it
//       (T-DG4-KBE-R8)."
//    5. This file: empty `P4_PENDING_ARCH_R7_MEMBERS`, with a removal note as KBE-R7 wrote in p4-pending-arch-r6.ts.
//    Nothing else in these files changes.
//  - Warning (the D-121 lesson): step 4 makes `kpiUnit` a required key of the `DashboardValue` TYPE. Every web literal
//    typed as a DashboardValue (the fixtures in apps/web/src/pages/dashboards/dashboardFixtures.ts and the tests, and
//    the two value objects the web builds itself: DashboardsPage.tsx, the Finance non-financial n/a; ui.tsx
//    ValueRagLines, the gap lines) then fails typecheck unless it has `kpiUnit`. FE-R7 adds `kpiUnit` (null, or the
//    KPI's unit) to each of them first, which typechecks while the member is optional. The API's own value builders
//    (reporting/dashboards/areas.ts knownValue, unknownValue, notApplicableValue, kpiActualValue) are KBE-R8's.
//
// Nothing reads this list mechanically: the contract test (apps/api/test/integration/contract/contract.test.ts) is
// outside this task's write scope. The list is the record of what is pending, and the member's openapi description
// says "Not yet required: pending in p4-pending-arch-r7.ts".
export interface PendingMember {
  /** `<OpenAPI schema>.<member path>`. */
  readonly member: string;
  /** The operations whose responses carry it. */
  readonly operations: readonly string[];
  /** The zod mirror export that declares it (`@mth/shared/schemas`). */
  readonly zod: string;
}

export const P4_PENDING_ARCH_R7_MEMBERS: readonly PendingMember[] = [
  {
    // Every DashboardValue the API sends, wherever it is nested: headlines, items, drill-down value/items/inputs,
    // Finance line totals, AdoptionIndicatorRow.value and the header's CurrencyValue.value.
    member: "DashboardValue.kpiUnit",
    operations: [
      "getTransformationDashboard",
      "getWorkstreamDashboard",
      "getExecutiveOverview",
      "getAdoptionDashboard",
      "getFinanceDashboard",
      "getDashboardDrilldown",
      "getWorkspaceHeader",
    ],
    zod: "dashboardValue",
  },
];
