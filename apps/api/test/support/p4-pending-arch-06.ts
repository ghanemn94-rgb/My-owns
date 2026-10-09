// The slice F and G operations declared by T-DG4-ARCH-06 (ADR-0033, ADR-0034) that have no route yet, one list per owning
// implementer task (docs/architecture/p4-work-split.md §F+G). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p4-pending-<task>.ts.
import { P4_PENDING_KBE_F } from "./p4-pending-kbe-f.ts";
import { P4_PENDING_BE_H } from "./p4-pending-be-h.ts";
import { P4_PENDING_BE_H2 } from "./p4-pending-be-h2.ts";
import { P4_PENDING_BE_I } from "./p4-pending-be-i.ts";
import { P4_PENDING_BE_I2 } from "./p4-pending-be-i2.ts";
import { P4_PENDING_BE_J } from "./p4-pending-be-j.ts";

export const P4_PENDING_ARCH_06: readonly string[] = [
  ...P4_PENDING_BE_H,
  ...P4_PENDING_BE_H2,
  ...P4_PENDING_KBE_F,
  ...P4_PENDING_BE_I,
  ...P4_PENDING_BE_I2,
  ...P4_PENDING_BE_J,
];
