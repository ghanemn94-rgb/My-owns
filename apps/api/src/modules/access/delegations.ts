// P4 route-file stub (T-DG4-BE-A; p4-plan §5.1, p4-work-split §I+C.1): delegation management, the loop guard and actsFor (ADR-0026 §3; REQ-S10-010).
// Owned and filled by task BE-B. Until then it registers nothing; its registration line already exists, so the
// owning task edits only this file (and its own tests, pending list and contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-B fills it). */
export function registerDelegationRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
