// The slice F operations declared by T-DG5-ARCH-04 (ADR-0045, ADR-0046) that have no route yet, one list per owning
// implementer task (docs/architecture/p5-work-split.md §F). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p5-pending-<task>.ts.
import { P5_PENDING_KBE_C } from "./p5-pending-kbe-c.ts";
import { P5_PENDING_KBE_D } from "./p5-pending-kbe-d.ts";
import { P5_PENDING_BE_M } from "./p5-pending-be-m.ts";
import { P5_PENDING_BE_O } from "./p5-pending-be-o.ts";

export const P5_PENDING_ARCH_04: readonly string[] = [
  ...P5_PENDING_KBE_C,
  ...P5_PENDING_KBE_D,
  ...P5_PENDING_BE_M,
  ...P5_PENDING_BE_O,
];
