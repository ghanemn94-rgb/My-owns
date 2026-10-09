// G6 "Ownership transfer", "Controls" and "Continuous improvement backlog" facts (T-DG4-BE-K; ADR-0035 §2, ADR-0034;
// REQ-PB-021, REQ-S04-008): every non-retired performance area of the transformation with the accepted BAU handover of
// its CURRENT cycle (or none) and its active controls, and the improvement items whose origin transformation is this
// one. Read-only; wired into workflows' GateFactsProvider by server.ts.
import type { DbOrTx } from "@mth/db";

export interface PerformanceAreaGateFact {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly cycleNo: number;
  readonly acceptedHandoverId: string | null;
  readonly activeControlIds: readonly string[];
}

export async function loadSustainmentGateFacts(
  db: DbOrTx,
  transformationId: string,
): Promise<{ transformationId: string; performanceAreas: PerformanceAreaGateFact[]; improvementItemIds: string[] }> {
  const areas = await db
    .selectFrom("performance_area")
    .select(["id", "code", "name", "cycle_no"])
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "retired")
    .orderBy("code")
    .orderBy("id")
    .execute();
  const handovers = await db
    .selectFrom("bau_handover")
    .select(["id", "performance_area_id", "cycle_no"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "accepted")
    .orderBy("accepted_at", "desc")
    .orderBy("id")
    .execute();
  const controls = await db
    .selectFrom("control")
    .select(["id", "performance_area_id"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .orderBy("code")
    .orderBy("id")
    .execute();
  const items = await db
    .selectFrom("improvement_item")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .orderBy("code")
    .orderBy("id")
    .execute();
  return {
    transformationId,
    performanceAreas: areas.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      cycleNo: a.cycle_no,
      acceptedHandoverId:
        handovers.find((h) => h.performance_area_id === a.id && h.cycle_no === a.cycle_no)?.id ?? null,
      activeControlIds: controls.filter((c) => c.performance_area_id === a.id).map((c) => c.id),
    })),
    improvementItemIds: items.map((i) => i.id),
  };
}
