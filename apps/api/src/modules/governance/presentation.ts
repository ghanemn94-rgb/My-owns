// P5 route-file stub (T-DG5-BE-A; p5-plan §5.1, p5-work-split §A.1): presentation mode; an issued pack is a snapshot (S10-013) (slice F).
// Owned and filled by task BE-O. Until then it registers nothing; its registration line already exists, so the
// owning task edits only this file (and its own tests, pending list and contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-O fills it). */
export function registerPresentationRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
