// STUB created by T-DG3-BE-A (p3-work-split §2): resource roles, capacity and the capacity plan (ADR-0023 §6).
// Owned and filled in by BE-E; portfolio/index.ts already calls this hook, so BE-E only adds routes here.
// Each route declares `config.access`, `config.consumes` (the contract's request media type) and its §5b statuses.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none yet). */
export function registerCapacityRoutes(_app: FastifyInstance, _deps: ModuleDeps): readonly string[] {
  return [];
}
