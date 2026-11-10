// The slice J and C operations declared by T-DG6-ARCH-02 (ADR-0053, ADR-0054) that have no route yet, one list per owning
// implementer task (docs/architecture/p6-work-split.md §J/C). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p6-pending-<task>.ts.
import { P6_PENDING_BE_G } from "./p6-pending-be-g.ts";
import { P6_PENDING_BE_H2 } from "./p6-pending-be-h2.ts";
import { P6_PENDING_BE_I } from "./p6-pending-be-i.ts";
import { P6_PENDING_BE_I2 } from "./p6-pending-be-i2.ts";
import { P6_PENDING_BE_J } from "./p6-pending-be-j.ts";
import { P6_PENDING_BE_K } from "./p6-pending-be-k.ts";

export const P6_PENDING_ARCH_02: readonly string[] = [
  ...P6_PENDING_BE_G,
  ...P6_PENDING_BE_H2,
  ...P6_PENDING_BE_I,
  ...P6_PENDING_BE_I2,
  ...P6_PENDING_BE_J,
  ...P6_PENDING_BE_K,
];
