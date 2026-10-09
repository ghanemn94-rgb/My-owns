// The slice H operations declared by T-DG4-ARCH-07 (ADR-0035, ADR-0036) that have no route yet, one list per owning
// implementer task (docs/architecture/p4-work-split.md §H). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p4-pending-<task>.ts.
import { P4_PENDING_BE_K } from "./p4-pending-be-k.ts";
import { P4_PENDING_BE_K2 } from "./p4-pending-be-k2.ts";
import { P4_PENDING_BE_L } from "./p4-pending-be-l.ts";
import { P4_PENDING_BE_L2 } from "./p4-pending-be-l2.ts";

export const P4_PENDING_ARCH_07: readonly string[] = [
  ...P4_PENDING_BE_K,
  ...P4_PENDING_BE_K2,
  ...P4_PENDING_BE_L,
  ...P4_PENDING_BE_L2,
];
