// The slice D and E operations declared by T-DG5-ARCH-03 (ADR-0043, ADR-0044) that have no route yet, one list per owning
// implementer task (docs/architecture/p5-work-split.md §D, §E). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p5-pending-<task>.ts.
import { P5_PENDING_BE_H } from "./p5-pending-be-h.ts";
import { P5_PENDING_BE_H2 } from "./p5-pending-be-h2.ts";
import { P5_PENDING_BE_I } from "./p5-pending-be-i.ts";
import { P5_PENDING_BE_I2 } from "./p5-pending-be-i2.ts";
import { P5_PENDING_BE_J } from "./p5-pending-be-j.ts";
import { P5_PENDING_BE_K } from "./p5-pending-be-k.ts";
import { P5_PENDING_BE_L } from "./p5-pending-be-l.ts";
import { P5_PENDING_BE_L2 } from "./p5-pending-be-l2.ts";

export const P5_PENDING_ARCH_03: readonly string[] = [
  ...P5_PENDING_BE_H,
  ...P5_PENDING_BE_H2,
  ...P5_PENDING_BE_I,
  ...P5_PENDING_BE_I2,
  ...P5_PENDING_BE_J,
  ...P5_PENDING_BE_K,
  ...P5_PENDING_BE_L,
  ...P5_PENDING_BE_L2,
];
