// The slice D operations declared by T-DG4-ARCH-05 (ADR-0032) that have no route yet, one list per owning implementer task
// (docs/architecture/p4-work-split.md §D). This file only aggregates them and is frozen (solution-architect); each task
// edits only its own p4-pending-<task>.ts.
import { P4_PENDING_BE_F } from "./p4-pending-be-f.ts";
import { P4_PENDING_BE_F2 } from "./p4-pending-be-f2.ts";
import { P4_PENDING_BE_G } from "./p4-pending-be-g.ts";

export const P4_PENDING_ARCH_05: readonly string[] = [...P4_PENDING_BE_F, ...P4_PENDING_BE_G, ...P4_PENDING_BE_F2];
