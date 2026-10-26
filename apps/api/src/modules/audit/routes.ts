// P6 route-file stub (T-DG6-BE-A; p6-plan §5.1, p6-work-split §E/F.1): the global audit API, listAuditEvents and
// getAuditEvent (slice F; ADR-0052 §8). Owned and filled by task BE-E. Until then it registers nothing; its
// registration line already exists in server.ts, so the owning task edits only this file and the members of the port
// object on that line (and its own tests, pending list and contract exercises).
//
// audit cannot import access: access depends on audit (ADR-0002 rule 5; modules.ts), so the import would close a
// cycle. The authorization this file needs (the request's principal and the audit_event.read scope of ADR-0052 §8,
// with the ADR-0051 §2 sensitivity redaction) is therefore passed in by the composition root as AuditRouteAccess,
// the GateFactsProvider pattern. BE-E declares the members it uses here and fills them on the server.ts line.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";

/** The access functions the audit routes use, injected by server.ts (BE-E declares the members). */
export type AuditRouteAccess = Readonly<Record<string, never>>;

/** Registers this file's routes and returns them as "METHOD /path" (none until BE-E fills it). */
export function registerAuditRoutes(_app: FastifyInstance, _deps: ModuleDeps, _access: AuditRouteAccess): string[] {
  return [];
}
