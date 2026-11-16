// The slice B and F operations declared by T-DG7-ARCH-04 (ADR-0069, ADR-0070) that have no route yet, one list per
// owning implementer task (docs/architecture/p7-work-split.md §B). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p7-pending-<task>.ts. Slice F (ADR-0070) adds no operation.
import { P7_PENDING_BE_B } from "./p7-pending-be-b.ts";

export const P7_PENDING_ARCH_04: readonly string[] = [...P7_PENDING_BE_B];
