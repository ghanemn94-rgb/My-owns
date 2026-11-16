// The slice I and H operations declared by T-DG7-ARCH-05 (ADR-0071, ADR-0072) that have no route yet, one list per
// owning implementer task (docs/architecture/p7-work-split.md §I). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p7-pending-<task>.ts. Slice H (ADR-0072) adds no operation.
import { P7_PENDING_BE_H } from "./p7-pending-be-h.ts";

export const P7_PENDING_ARCH_05: readonly string[] = [...P7_PENDING_BE_H];
