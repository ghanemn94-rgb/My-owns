// The slice B operations declared by T-DG4-ARCH-03 (ADR-0029, ADR-0030) that have no route yet, one list per owning
// implementer task (docs/architecture/p4-work-split.md §B). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p4-pending-<task>.ts.
import { P4_PENDING_KBE_D } from "./p4-pending-kbe-d.ts";
import { P4_PENDING_KBE_D2 } from "./p4-pending-kbe-d2.ts";
import { P4_PENDING_KBE_E } from "./p4-pending-kbe-e.ts";

export const P4_PENDING_ARCH_03: readonly string[] = [...P4_PENDING_KBE_D, ...P4_PENDING_KBE_D2, ...P4_PENDING_KBE_E];
