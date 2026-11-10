// The slice B and A operations declared by T-DG6-ARCH-03 (ADR-0055, ADR-0056) that have no route yet, one list per owning
// implementer task (docs/architecture/p6-work-split.md §B/A). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p6-pending-<task>.ts.
import { P6_PENDING_BE_L } from "./p6-pending-be-l.ts";
import { P6_PENDING_BE_L2 } from "./p6-pending-be-l2.ts";
import { P6_PENDING_BE_M2 } from "./p6-pending-be-m2.ts";
import { P6_PENDING_BE_N } from "./p6-pending-be-n.ts";
import { P6_PENDING_BE_N2 } from "./p6-pending-be-n2.ts";
import { P6_PENDING_BE_O } from "./p6-pending-be-o.ts";

export const P6_PENDING_ARCH_03: readonly string[] = [
  ...P6_PENDING_BE_L,
  ...P6_PENDING_BE_L2,
  ...P6_PENDING_BE_M2,
  ...P6_PENDING_BE_N,
  ...P6_PENDING_BE_N2,
  ...P6_PENDING_BE_O,
];
