// The slice E operations declared by T-DG7-ARCH-03 (ADR-0066, ADR-0067) that have no route yet, one list per owning
// implementer task (docs/architecture/p7-work-split.md §E). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p7-pending-<task>.ts.
import { P7_PENDING_BE_G } from "./p7-pending-be-g.ts";

export const P7_PENDING_ARCH_03: readonly string[] = [...P7_PENDING_BE_G];
