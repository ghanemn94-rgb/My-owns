// The slice B and C operations declared by T-DG5-ARCH-02 (ADR-0041, ADR-0042) that have no route yet, one list per owning
// implementer task (docs/architecture/p5-work-split.md §B, §C). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p5-pending-<task>.ts.
import { P5_PENDING_BE_D } from "./p5-pending-be-d.ts";
import { P5_PENDING_BE_E } from "./p5-pending-be-e.ts";
import { P5_PENDING_BE_E2 } from "./p5-pending-be-e2.ts";
import { P5_PENDING_BE_F } from "./p5-pending-be-f.ts";
import { P5_PENDING_BE_F2 } from "./p5-pending-be-f2.ts";
import { P5_PENDING_BE_G } from "./p5-pending-be-g.ts";

export const P5_PENDING_ARCH_02: readonly string[] = [
  ...P5_PENDING_BE_D,
  ...P5_PENDING_BE_E,
  ...P5_PENDING_BE_E2,
  ...P5_PENDING_BE_F,
  ...P5_PENDING_BE_F2,
  ...P5_PENDING_BE_G,
];
