// P5 route-file stub (T-DG5-BE-A; p5-plan §5.1, p5-work-split §A.1): the 90-day launch plan and the Day-90 test (slice H).
// Owned and filled by task BE-P. Until then it registers nothing; its registration line already exists, so the
// owning task edits only this file (and its own tests, pending list and contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-P fills it). */
export function registerLaunchRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
