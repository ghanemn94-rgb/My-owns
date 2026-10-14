// The slice I and J operations declared by T-DG5-ARCH-06 (ADR-0049, ADR-0050) that have no route yet, one list per owning
// implementer task (docs/architecture/p5-work-split.md §I, §J). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p5-pending-<task>.ts.
import { P5_PENDING_BE_Q } from "./p5-pending-be-q.ts";
import { P5_PENDING_BE_Q2 } from "./p5-pending-be-q2.ts";
import { P5_PENDING_BE_R } from "./p5-pending-be-r.ts";
import { P5_PENDING_BE_R2 } from "./p5-pending-be-r2.ts";
import { P5_PENDING_BE_S } from "./p5-pending-be-s.ts";
import { P5_PENDING_BE_T2 } from "./p5-pending-be-t2.ts";

export const P5_PENDING_ARCH_06: readonly string[] = [
  ...P5_PENDING_BE_Q,
  ...P5_PENDING_BE_Q2,
  ...P5_PENDING_BE_R,
  ...P5_PENDING_BE_R2,
  ...P5_PENDING_BE_S,
  ...P5_PENDING_BE_T2,
];
