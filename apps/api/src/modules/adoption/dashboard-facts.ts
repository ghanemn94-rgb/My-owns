// Read-only adoption facts for the slice J dashboards (T-DG4-KBE-G; ADR-0037 §1 item 2, §3 People & adoption; ADR-0033
// metric links; p4-work-split §J+K JK.4): the KPI-fed adoption metric links of the transformations with the KPI scope
// their indicator is measured at (the KBE-F rule: an initiative target is measured at the initiative, every other
// target at the transformation), and the open interventions. The KPI statuses themselves come from the slice A status
// service (kpi/dashboard-facts.ts). Training completion alone is never an input (REQ-PB-072). Nothing is written.
import type { DbOrTx } from "@mth/db";

export interface AdoptionDashboardIndicator {
  readonly metricLinkId: string;
  readonly transformationId: string;
  readonly templateKey: string;
  readonly targetKind: string;
  readonly targetId: string | null;
  readonly kpiDefinitionId: string;
  readonly scopeKind: "initiative" | "transformation";
  readonly scopeId: string;
}

/** The active, KPI-fed adoption metric links of the transformations (ordered; read-only). */
export async function loadAdoptionDashboardIndicators(
  db: DbOrTx,
  transformationIds: readonly string[],
): Promise<AdoptionDashboardIndicator[]> {
  if (transformationIds.length === 0) return [];
  const rows = await db
    .selectFrom("adoption_metric_link")
    .select([
      "id",
      "transformation_id",
      "template_key",
      "target_kind",
      "kpi_definition_id",
      "outcome_id",
      "initiative_id",
      "stakeholder_group_id",
    ])
    .where("transformation_id", "in", [...transformationIds])
    .where("status", "=", "active")
    .where("kpi_definition_id", "is not", null)
    .orderBy("transformation_id")
    .orderBy("template_key")
    .orderBy("id")
    .execute();
  return rows.map((r) => ({
    metricLinkId: r.id,
    transformationId: r.transformation_id,
    templateKey: r.template_key,
    targetKind: r.target_kind,
    targetId: r.initiative_id ?? r.outcome_id ?? r.stakeholder_group_id ?? null,
    kpiDefinitionId: r.kpi_definition_id!,
    scopeKind: r.target_kind === "initiative" ? "initiative" : "transformation",
    scopeId: r.target_kind === "initiative" ? r.initiative_id! : r.transformation_id,
  }));
}
