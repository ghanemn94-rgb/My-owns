// P6 route-file stub (T-DG6-BE-A; p6-plan §5.1, p6-work-split §E/F.1): the organization's upload policy, allowed types and size limit (slice F; ADR-0052 §1).
// Owned and filled by task BE-D. Until then it registers nothing; its registration line already exists, so the
// owning task edits only this file (and its own tests, pending list and contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-D fills it). */
export function registerUploadPolicyRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
