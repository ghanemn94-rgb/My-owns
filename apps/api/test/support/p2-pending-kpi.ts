// P2 kpi-module operations declared in docs/api/openapi.yaml with no route yet (T-DG2-ARCH-01B). Owned by
// kpi-benefits-engineer: remove an entry in the same change that registers its route in apps/api/src/modules/kpi and
// exercises it in apps/api/test/integration/contract/kpi-exercises.ts. Must be empty when the DG2 candidate freezes.
// T-DG2-KBE: all 23 kpi operations are routed (apps/api/src/modules/kpi/routes.ts) and exercised with a success and
// their zod mirror (kpi-exercises.ts), so the list is empty.
export const P2_PENDING_KPI_OPERATIONS: readonly string[] = [];
