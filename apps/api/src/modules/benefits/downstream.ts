// The slice B DownstreamImpactProvider (P4; ADR-0027 §6, ADR-0030 §6; T-DG4-KBE-E; REQ-S07-017): when a KPI value is
// used, the benefits it feeds are listed in the KPI actual submission response, and `financeReview` says whether a
// Finance review follows: "pending" when the KPI (or a formula KPI reading it) feeds at least one active benefit with
// finance_validation_required, "not_applicable" when it feeds none. Reads only, in the caller's transaction. A Finance
// review is a human decision inside the product; nothing here decides one, and nothing touches DG0-DG7.
import type { DbOrTx } from "@mth/db";
import type { KpiDownstreamItem } from "@mth/shared/schemas";
import { registerDownstreamImpactProvider, type DownstreamImpact } from "../kpi/index.ts";

/** The benefit items and the Finance review state of a change to `kpiDefinitionIds` in a transformation. */
export async function benefitImpactOf(
  db: DbOrTx,
  transformationId: string,
  kpiDefinitionIds: readonly string[],
): Promise<DownstreamImpact> {
  if (kpiDefinitionIds.length === 0) return { items: [], financeReview: "not_applicable" };
  const rows = await db
    .selectFrom("benefit")
    .select(["id", "finance_validation_required"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .where("measurement_kpi_definition_id", "in", [...kpiDefinitionIds])
    .orderBy("code")
    .execute();
  const items: KpiDownstreamItem[] = rows.map((r) => ({
    kind: "benefit",
    id: r.id,
    labelKey: "kpi.downstream.benefit",
  }));
  return { items, financeReview: rows.some((r) => r.finance_validation_required) ? "pending" : "not_applicable" };
}

/** Registers the provider with slice A (called once from the benefits module's wiring hook). */
export function registerBenefitDownstreamProvider(): void {
  registerDownstreamImpactProvider({ impactOf: benefitImpactOf });
}
