// The slice I + C operations declared by T-DG4-ARCH-01 (ADR-0025, ADR-0026) that have no route yet, one list per owning
// implementer task (docs/architecture/p4-work-split.md §I+C). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p4-pending-<task>.ts.
import { P4_PENDING_BE_A } from "./p4-pending-be-a.ts";
import { P4_PENDING_BE_B } from "./p4-pending-be-b.ts";
import { P4_PENDING_BE_C } from "./p4-pending-be-c.ts";

export const P4_PENDING_ARCH_01: readonly string[] = [...P4_PENDING_BE_A, ...P4_PENDING_BE_B, ...P4_PENDING_BE_C];
