// The slices J and K operations declared by T-DG4-ARCH-08 (ADR-0037, ADR-0038) that have no route yet, one list per
// owning implementer task (docs/architecture/p4-work-split.md §J+K). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p4-pending-<task>.ts.
import { P4_PENDING_BE_M } from "./p4-pending-be-m.ts";
import { P4_PENDING_BE_M2 } from "./p4-pending-be-m2.ts";
import { P4_PENDING_BE_M3 } from "./p4-pending-be-m3.ts";
import { P4_PENDING_KBE_G } from "./p4-pending-kbe-g.ts";
import { P4_PENDING_KBE_G2 } from "./p4-pending-kbe-g2.ts";

export const P4_PENDING_ARCH_08: readonly string[] = [
  ...P4_PENDING_BE_M,
  ...P4_PENDING_BE_M2,
  ...P4_PENDING_BE_M3,
  ...P4_PENDING_KBE_G,
  ...P4_PENDING_KBE_G2,
];
