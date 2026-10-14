// P5 contract exercises of BE-K (p5-plan §5.1, p5-work-split §2 rule 14). Stub created by T-DG5-BE-A and already
// called by contract.test.ts: BE-K exercises each operation it routes here, through `ctx.mirrored`, in the same change
// that removes the operation from its p5-pending list, and lists each success body's zod mirror below.
import type { z } from "zod";
import type { P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_K: Readonly<Record<string, z.ZodType>> = {};

export async function exerciseP5BeKOperations(_ctx: P5ExerciseContext): Promise<void> {
  // Nothing routed yet.
}
