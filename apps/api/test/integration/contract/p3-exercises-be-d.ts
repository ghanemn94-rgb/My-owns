// P3 contract exercises: prioritization (BE-D). STUB created by T-DG3-BE-A (p3-work-split §5); owned and filled in by that task.
// contract.test.ts already calls exerciseP3BeDOperations once and merges P3_MIRRORS_BE_D into its zod mirror map,
// so the owning task only edits this file (and its own test/support/p3-pending-be-d.ts) when it routes an operation:
// remove the operation from the pending list, exercise it here through `ctx.mirrored` with at least one success, and
// add "operationId -> zod mirror of the success body" below. All data is synthetic.
import type { z } from "zod";
import type { P3ExerciseContext } from "../../support/harness.ts";

/** operationId -> zod mirror of its success body (from @mth/shared/schemas). */
export const P3_MIRRORS_BE_D: Readonly<Record<string, z.ZodType>> = {};

/** Exercises this task's routed P3 operations (none yet). */
export async function exerciseP3BeDOperations(_ctx: P3ExerciseContext): Promise<void> {}
