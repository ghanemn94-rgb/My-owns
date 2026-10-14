// The slice A operations declared by T-DG5-ARCH-01 (ADR-0039, ADR-0040) that have no route yet, one list per owning
// implementer task (docs/architecture/p5-work-split.md §A). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p5-pending-<task>.ts.
import { P5_PENDING_BE_A } from "./p5-pending-be-a.ts";
import { P5_PENDING_BE_B } from "./p5-pending-be-b.ts";
import { P5_PENDING_BE_B2 } from "./p5-pending-be-b2.ts";
import { P5_PENDING_BE_B3 } from "./p5-pending-be-b3.ts";
import { P5_PENDING_BE_C } from "./p5-pending-be-c.ts";
import { P5_PENDING_KBE_A } from "./p5-pending-kbe-a.ts";

export const P5_PENDING_ARCH_01: readonly string[] = [
  ...P5_PENDING_BE_A,
  ...P5_PENDING_BE_B,
  ...P5_PENDING_BE_B2,
  ...P5_PENDING_BE_B3,
  ...P5_PENDING_BE_C,
  ...P5_PENDING_KBE_A,
];
