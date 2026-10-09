// The downstream impact of a KPI value (ADR-0027 §6 "the four-step update"; REQ-S07-017; T-DG4-KBE-C): which views
// change when a value of this KPI is used, listed in the KpiActualSubmission response.
//
// Slice A lists, in this order: the KPI panel; every formula KPI whose ACTIVE version reads this KPI, transitively
// (the formula graph of ADR-0027 §4); the T02 outcome rows that use the KPI; the Executive Overview Outcomes area.
// Benefits are slice B's: a slice B module registers a DownstreamImpactProvider (KBE-E) that adds the benefit items and
// says whether a Finance review follows. Until one is registered, `financeReview` is `unknown`: never guessed.
// Items carry i18n label keys (S-6), translated at render time; reads only, no writes.
import type { DbOrTx } from "@mth/db";
import type { KpiDownstreamItem } from "@mth/shared/schemas";

export type FinanceReview = "pending" | "not_applicable" | "unknown";

/** What slice B reports for the KPIs whose values change (the accepted KPI and the formula KPIs reading it). */
export interface DownstreamImpact {
  readonly items: readonly KpiDownstreamItem[];
  readonly financeReview: Exclude<FinanceReview, "unknown">;
}

/** The interface slice B implements (ADR-0027 §6; p4-work-split §A.5 KBE-E). Reads only, in the caller's transaction. */
export interface DownstreamImpactProvider {
  readonly impactOf: (
    db: DbOrTx,
    transformationId: string,
    kpiDefinitionIds: readonly string[],
  ) => Promise<DownstreamImpact>;
}

let provider: DownstreamImpactProvider | null = null;

/** Registers (or, with null, removes) slice B's provider. A second registration replaces the first. */
export function registerDownstreamImpactProvider(p: DownstreamImpactProvider | null): void {
  provider = p;
}

/** The KPIs whose active formula version reads `kpiDefinitionId`, transitively (breadth first, each once). */
export async function formulaReadersOf(
  db: DbOrTx,
  transformationId: string,
  kpiDefinitionId: string,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>([kpiDefinitionId]);
  let frontier = [kpiDefinitionId];
  while (frontier.length > 0) {
    const rows = await db
      .selectFrom("kpi_formula_input as i")
      .innerJoin("kpi_version as v", "v.id", "i.kpi_version_id")
      .select("v.kpi_definition_id")
      .distinct()
      .where("v.transformation_id", "=", transformationId)
      .where("v.status", "=", "active")
      .where("i.source_kpi_definition_id", "in", frontier)
      .orderBy("v.kpi_definition_id")
      .execute();
    frontier = [];
    for (const r of rows) {
      if (seen.has(r.kpi_definition_id)) continue;
      seen.add(r.kpi_definition_id);
      out.push(r.kpi_definition_id);
      frontier.push(r.kpi_definition_id);
    }
  }
  return out;
}

/** The downstream list and the Finance review state of a value of `kpiDefinitionId`. */
export async function downstreamOf(
  db: DbOrTx,
  transformationId: string,
  kpiDefinitionId: string,
): Promise<{ downstream: KpiDownstreamItem[]; financeReview: FinanceReview }> {
  const readers = await formulaReadersOf(db, transformationId, kpiDefinitionId);
  const outcomeRows = await db
    .selectFrom("outcome_kpi")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("kpi_definition_id", "in", [kpiDefinitionId, ...readers])
    .orderBy("id")
    .execute();
  const downstream: KpiDownstreamItem[] = [
    { kind: "kpi_panel", id: kpiDefinitionId, labelKey: "kpi.downstream.kpi_panel" },
    ...readers.map((id) => ({ kind: "formula_kpi" as const, id, labelKey: "kpi.downstream.formula_kpi" })),
    ...outcomeRows.map((r) => ({ kind: "outcome_kpi" as const, id: r.id, labelKey: "kpi.downstream.outcome_kpi" })),
    { kind: "executive_overview_outcomes", id: null, labelKey: "kpi.downstream.executive_overview_outcomes" },
  ];
  if (provider === null) return { downstream, financeReview: "unknown" };
  const impact = await provider.impactOf(db, transformationId, [kpiDefinitionId, ...readers]);
  return { downstream: [...downstream, ...impact.items], financeReview: impact.financeReview };
}
