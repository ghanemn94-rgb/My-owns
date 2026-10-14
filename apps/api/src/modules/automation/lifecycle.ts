// P5 route-file stub (T-DG5-BE-H; p5-work-split §D.2): submit, review where configured, publish and discard of a rule
// version (ADR-0043 §4; REQ-S12-002). Owned and filled by task BE-H2. Until then it registers nothing; its registration
// line already exists in routes.ts, so the owning task edits only this file (and its own tests, pending list and
// contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-H2 fills it). */
export function registerAutomationLifecycleRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
