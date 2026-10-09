// The slice A operations declared by T-DG4-ARCH-02 (ADR-0027, ADR-0028) that have no route yet, one list per owning
// implementer task (docs/architecture/p4-work-split.md §A). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p4-pending-<task>.ts.
import { P4_PENDING_KBE_B } from "./p4-pending-kbe-b.ts";
import { P4_PENDING_KBE_C } from "./p4-pending-kbe-c.ts";

export const P4_PENDING_ARCH_02: readonly string[] = [...P4_PENDING_KBE_B, ...P4_PENDING_KBE_C];
