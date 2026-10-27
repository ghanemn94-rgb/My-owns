// The slice D operations declared by T-DG6-ARCH-05 (ADR-0059, the optional assistant) that have no route yet, one list
// per owning implementer task (docs/architecture/p6-work-split.md §D). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p6-pending-<task>.ts.
import { P6_PENDING_BE_T } from "./p6-pending-be-t.ts";
import { P6_PENDING_BE_U } from "./p6-pending-be-u.ts";

export const P6_PENDING_ARCH_05: readonly string[] = [...P6_PENDING_BE_T, ...P6_PENDING_BE_U];
