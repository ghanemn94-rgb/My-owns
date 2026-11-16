// The slice C and D operations declared by T-DG7-ARCH-02 (ADR-0064, ADR-0065) that have no route yet, one list per
// owning implementer task (docs/architecture/p7-work-split.md §C, §D). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p7-pending-<task>.ts.
import { P7_PENDING_BE_C } from "./p7-pending-be-c.ts";
import { P7_PENDING_BE_D } from "./p7-pending-be-d.ts";
import { P7_PENDING_BE_F } from "./p7-pending-be-f.ts";

export const P7_PENDING_ARCH_02: readonly string[] = [...P7_PENDING_BE_C, ...P7_PENDING_BE_D, ...P7_PENDING_BE_F];
