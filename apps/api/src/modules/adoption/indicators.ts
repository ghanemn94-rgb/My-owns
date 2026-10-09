// P4 route-file stub (T-DG4-BE-A; p4-plan §5.1, p4-work-split §I+C.1): adoption indicators (slice F).
// Owned and filled by task KBE-F. Until then it registers nothing; its registration line already exists, so the
// owning task edits only this file (and its own tests, pending list and contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until KBE-F fills it). */
export function registerAdoptionIndicatorRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
