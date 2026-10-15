// Methodology-migration web seams (T-DG5-FE-B; REQ-S06-008, REQ-S06-010; ADR-0040 §1-§4, §8): typed hooks over FE-A's
// `api/p5.ts` and the pure helpers of the migration screens. Approving a migration and re-approving a gate are BUSINESS
// approvals inside the product, made by people; nothing here relates to the engineering delivery gates DG0-DG7.
import type {
  GateReapproval,
  MethodologyMigration,
  MethodologyMigrationItem,
  MigrationItemKind,
} from "@mth/shared/schemas";
import { MIGRATION_ITEM_KINDS, OPEN_METHODOLOGY_MIGRATION_STATUSES } from "@mth/shared/schemas";
import { useGateReapprovals, useMethodologyMigration, useMethodologyMigrations } from "../../api/p5.ts";

export type { GateReapproval, MethodologyMigration, MethodologyMigrationItem, MigrationItemKind };

export const useMigrations = (tid: string) => useMethodologyMigrations<MethodologyMigration>(tid);
export const useMigration = (tid: string, migrationId: string | undefined) =>
  useMethodologyMigration<MethodologyMigration>(tid, migrationId);
export const useReapprovals = (tid: string) => useGateReapprovals<GateReapproval>(tid);

/** True while the migration is open (draft, submitted, changes requested, approved; the 0063 unique index). */
export const isOpenMigration = (m: Pick<MethodologyMigration, "status">): boolean =>
  (OPEN_METHODOLOGY_MIGRATION_STATUSES as readonly string[]).includes(m.status);

/** The plan items grouped by kind, in the ADR-0040 §2 order; empty groups are left out. */
export function itemsByKind(
  items: readonly MethodologyMigrationItem[],
): { kind: MigrationItemKind; items: MethodologyMigrationItem[] }[] {
  return MIGRATION_ITEM_KINDS.map((kind) => ({
    kind,
    items: items.filter((i) => i.itemKind === kind).sort((a, b) => a.ordinal - b.ordinal),
  })).filter((g) => g.items.length > 0);
}

/**
 * The preview inputs of the items that need one, keyed by stable key: the typed text, or null ("leave empty until the
 * record's next edit", ADR-0040 §2) when the admin leaves it blank. Items without a stable key are skipped.
 */
export function previewInputs(
  items: readonly MethodologyMigrationItem[],
  values: Readonly<Record<string, string>>,
): { stableKey: string; value: unknown }[] {
  const seen = new Set<string>();
  const out: { stableKey: string; value: unknown }[] = [];
  for (const item of items) {
    if (item.itemKind !== "new_required_field" || !item.stableKey || seen.has(item.stableKey)) continue;
    if (item.resolution !== "needs_input" && item.resolution !== "provided") continue;
    seen.add(item.stableKey);
    const raw = values[item.stableKey] ?? "";
    out.push({ stableKey: item.stableKey, value: raw.trim() === "" ? null : raw });
  }
  return out;
}
