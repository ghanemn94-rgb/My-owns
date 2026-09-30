// Request-bound principal (set by the identity module's authentication hook) and the audit context derived from it.
import type { FastifyRequest } from "fastify";
import type { AuditContext } from "../audit/index.ts";
import { problems } from "../platform/index.ts";
import type { Principal } from "./policy.ts";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}

/** The signed-in principal, or 401. */
export function principalOf(request: FastifyRequest): Principal {
  if (!request.principal) throw problems.unauthenticated();
  return request.principal;
}

export function auditContextOf(request: FastifyRequest): AuditContext {
  const p = principalOf(request);
  return { actorUserId: p.userId, actorType: p.kind === "service" ? "service" : "user", requestId: request.id };
}
