// P5 route-file stub (T-DG5-BE-A; p5-plan §5.1, p5-work-split §A.1): notification policy: business-day timing, quiet hours, digests, urgent (S12-025) (slice E).
// Owned and filled by task BE-L. Until then it registers nothing; its registration line already exists, so the
// owning task edits only this file (and its own tests, pending list and contract exercises).
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-L fills it). */
export function registerNotificationPolicyRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
