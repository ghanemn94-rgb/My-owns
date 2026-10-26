// The slice E and F operations declared by T-DG6-ARCH-01 (ADR-0051, ADR-0052) that have no route yet, one list per owning
// implementer task (docs/architecture/p6-work-split.md §E/F). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p6-pending-<task>.ts.
import { P6_PENDING_BE_B } from "./p6-pending-be-b.ts";
import { P6_PENDING_BE_C } from "./p6-pending-be-c.ts";
import { P6_PENDING_BE_D } from "./p6-pending-be-d.ts";
import { P6_PENDING_BE_E } from "./p6-pending-be-e.ts";

export const P6_PENDING_ARCH_01: readonly string[] = [
  ...P6_PENDING_BE_B,
  ...P6_PENDING_BE_C,
  ...P6_PENDING_BE_D,
  ...P6_PENDING_BE_E,
];
