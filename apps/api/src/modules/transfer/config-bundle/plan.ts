// The plan of a configuration bundle import (ADR-0065 §4 step 2; p7-work-split §D.1; T-DG7-BE-F).
//
// Each item, in bundle order, gets exactly one action:
//   refused  config_bundle.kind_unavailable    no adapter of the kind is registered in this installation;
//   refused  config_bundle.kind_not_permitted  the caller lacks the kind's OWN configure right (the right its existing
//                                              route checks): config_bundle.import alone never lets a user write a kind
//                                              they could not write by hand (ADR-0065 §8);
//   otherwise the kind's adapter decides: create_draft, new_draft, identical, conflict (an open draft of the key exists:
//   config_bundle.open_draft_exists) or refused (config_bundle.reference_missing).
// The plan writes nothing. Validate stores it; commit re-runs it and refuses with config_bundle.plan_changed when any
// action differs from the stored latest run.
import type { DbOrTx } from "@mth/db";
import type { ConfigBundleAction } from "@mth/shared/transfer";
import type { Principal } from "../../access/index.ts";
import type { BundleItemInput, ConfigBundleAdapterRegistry, PlannedItem } from "./registry.ts";

export interface PlanRow {
  readonly ordinal: number;
  readonly item: BundleItemInput;
  readonly action: ConfigBundleAction;
  readonly problemCode: string | null;
}

export interface PlanCounts {
  createDraft: number;
  newDraft: number;
  identical: number;
  conflict: number;
  refused: number;
}

export async function planBundle(
  db: DbOrTx,
  registry: ConfigBundleAdapterRegistry,
  principal: Principal,
  organizationId: string,
  items: readonly BundleItemInput[],
): Promise<PlanRow[]> {
  const keys = new Set(items.map((i) => `${i.kind}:${i.itemCode}`));
  const permitted = new Map<string, boolean>();
  const out: PlanRow[] = [];
  for (const [index, item] of items.entries()) {
    const adapter = registry.get(item.kind);
    let planned: PlannedItem;
    if (adapter === undefined) {
      planned = { action: "refused", problemCode: "config_bundle.kind_unavailable" };
    } else {
      let may = permitted.get(item.kind);
      if (may === undefined) {
        may = await adapter.permitted(db, principal, organizationId);
        permitted.set(item.kind, may);
      }
      planned = may
        ? await adapter.plan(db, organizationId, item, { keys })
        : { action: "refused", problemCode: "config_bundle.kind_not_permitted" };
    }
    out.push({
      ordinal: index + 1,
      item,
      action: planned.action,
      problemCode: "problemCode" in planned ? planned.problemCode : null,
    });
  }
  return out;
}

export function countPlan(rows: readonly PlanRow[]): PlanCounts {
  const c: PlanCounts = { createDraft: 0, newDraft: 0, identical: 0, conflict: 0, refused: 0 };
  for (const r of rows) {
    if (r.action === "create_draft") c.createDraft += 1;
    else if (r.action === "new_draft") c.newDraft += 1;
    else if (r.action === "identical") c.identical += 1;
    else if (r.action === "conflict") c.conflict += 1;
    else c.refused += 1;
  }
  return c;
}

/** True when two runs plan the same action and problem for every ordinal. */
export function samePlan(
  a: readonly Pick<PlanRow, "ordinal" | "action" | "problemCode">[],
  b: readonly Pick<PlanRow, "ordinal" | "action" | "problemCode">[],
): boolean {
  if (a.length !== b.length) return false;
  const byOrdinal = new Map(b.map((r) => [r.ordinal, r]));
  return a.every((r) => {
    const o = byOrdinal.get(r.ordinal);
    return o !== undefined && o.action === r.action && o.problemCode === r.problemCode;
  });
}
