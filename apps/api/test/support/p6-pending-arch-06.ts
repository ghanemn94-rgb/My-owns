// The slice I operation declared by T-DG6-ARCH-06 (ADR-0061, UX hardening: the branding contrast report) that has no
// route yet, one list per owning implementer task (docs/architecture/p6-work-split.md §I/K). This file only aggregates
// them and is frozen (solution-architect); each task edits only its own p6-pending-<task>.ts. Slice K adds no operation.
import { P6_PENDING_BE_W } from "./p6-pending-be-w.ts";

export const P6_PENDING_ARCH_06: readonly string[] = [...P6_PENDING_BE_W];
