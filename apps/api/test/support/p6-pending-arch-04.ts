// The slice H and G operations declared by T-DG6-ARCH-04 (ADR-0057, ADR-0058) that have no route yet, one list per owning
// implementer task (docs/architecture/p6-work-split.md §H/G). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p6-pending-<task>.ts. BE-R adds query parameters to routed
// operations only, so it has no pending list.
import { P6_PENDING_BE_P } from "./p6-pending-be-p.ts";
import { P6_PENDING_BE_Q } from "./p6-pending-be-q.ts";
import { P6_PENDING_BE_Q2 } from "./p6-pending-be-q2.ts";

export const P6_PENDING_ARCH_04: readonly string[] = [...P6_PENDING_BE_P, ...P6_PENDING_BE_Q, ...P6_PENDING_BE_Q2];
