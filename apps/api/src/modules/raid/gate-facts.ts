// G5 "Risk closure" facts (T-DG4-BE-K; ADR-0035 §2, §6; REQ-PB-020, REQ-S04-007): every RAID risk of the transformation
// with High impact, its status and its dispositions with the status of each disposition's canonical approval (type
// risk_disposition). Read-only; wired into workflows' GateFactsProvider by server.ts (the G4 pattern, ADR-0021 §7), so
// workflows never imports raid. "High-impact" is REQ-PB-020's materiality threshold (raid_entry.impact = 'high').
// Nothing here approves anything: an approved disposition is a person's decision through the approval service.
import type { DbOrTx } from "@mth/db";

export interface RaidHighRiskGateFact {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly dispositions: ReadonlyArray<{
    readonly id: string;
    readonly disposition: string;
    readonly approvalId: string | null;
    readonly approvalStatus: string | null;
  }>;
}

export async function loadRaidGateFacts(
  db: DbOrTx,
  transformationId: string,
): Promise<{ transformationId: string; highRisks: RaidHighRiskGateFact[] }> {
  const risks = await db
    .selectFrom("raid_entry")
    .select(["id", "code", "status"])
    .where("transformation_id", "=", transformationId)
    .where("entry_type", "=", "risk")
    .where("impact", "=", "high")
    .orderBy("code")
    .orderBy("id")
    .execute();
  const ids = risks.map((r) => r.id);
  const dispositions =
    ids.length === 0
      ? []
      : await db
          .selectFrom("risk_disposition as d")
          .leftJoin("approval as a", (j) =>
            j
              .onRef("a.subject_id", "=", "d.id")
              .on("a.approval_type", "=", "risk_disposition")
              .onRef("a.transformation_id", "=", "d.transformation_id"),
          )
          .select(["d.id", "d.raid_entry_id", "d.disposition", "a.id as approval_id", "a.status as approval_status"])
          .where("d.transformation_id", "=", transformationId)
          .where("d.raid_entry_id", "in", ids)
          .orderBy("d.created_at")
          .orderBy("d.id")
          .orderBy("a.created_at")
          .execute();
  return {
    transformationId,
    highRisks: risks.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      dispositions: dispositions
        .filter((d) => d.raid_entry_id === r.id)
        .map((d) => ({
          id: d.id,
          disposition: d.disposition,
          approvalId: d.approval_id,
          approvalStatus: d.approval_status,
        })),
    })),
  };
}
