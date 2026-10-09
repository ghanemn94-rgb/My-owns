// P4 route-file stub (T-DG4-BE-A; p4-plan §5.1, p4-work-split §I+C.1): escalations (slice D; REQ-S12-011).
// Owned and filled by task BE-G. Until then it registers nothing; its registration line already exists, so the
// owning task edits only this file (and its own tests, pending list and contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-G fills it). */
export function registerEscalationRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
