import type { INestApplicationContext } from '@nestjs/common';

/**
 * The carve-out module registers no job handlers: its commands emit `perimeter.changed` and the gates module's worker job
 * (`gates.recompute_dimensions`) recomputes the status dimensions. Change requests are decided in planning; the approved
 * change is applied by an explicit carve-out command (apply-change), never automatically.
 */
export function registerCarveoutJobs(_app: INestApplicationContext): void {
  // intentionally empty
}
