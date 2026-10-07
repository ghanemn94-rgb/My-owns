// Request-bound principal (set by the identity module's authentication hook) and the audit context derived from it.
// T-DG2-BE18 (F-DG2-440): authorisation at COMMIT time. The identity hook resolves the session and loads the grants
// once, when the request starts. A write that commits after waiting on the client (the evidence upload receives its
// body for up to requestTimeout after that) re-resolves both inside its write transaction through
// `refreshPrincipal`, which calls the identity module's own resolver (`request.reauthenticate`, the same function the
// hook uses: one source of truth). A session that ended meanwhile gives 401; the reloaded grants replace the
// request-start snapshot, so the policy then decides on the authority the caller holds at commit.
import type { DbOrTx } from "@mth/db";
import type { FastifyRequest } from "fastify";
import type { AuditContext } from "../audit/index.ts";
import { HttpProblem, problems } from "../platform/index.ts";
import type { Principal } from "./policy.ts";

/** Re-resolves the request's session and grants on `db` (a transaction); null when the session is no longer valid. */
export type PrincipalResolver = (db: DbOrTx) => Promise<Principal | null>;

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
    /** Set by the identity hook together with `principal`; null for anonymous requests. */
    reauthenticate: PrincipalResolver | null;
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

/**
 * Commit-time authorisation, step 1 (F-DG2-440): re-resolves the caller's session and reloads their grants inside
 * `tx`, and replaces `request.principal` with the result. Throws 401 `unauthenticated` (the problem the hook gives a
 * request whose session is not valid) when the session was revoked, logged out, or expired (idle or absolute), or the
 * user was disabled, after the request started. Fails closed: a request with no resolver is refused too.
 */
export async function refreshPrincipal(tx: DbOrTx, request: FastifyRequest): Promise<Principal> {
  principalOf(request);
  const resolve = request.reauthenticate;
  if (!resolve) throw problems.unauthenticated();
  const fresh = await resolve(tx);
  if (!fresh) throw problems.unauthenticated();
  request.principal = fresh;
  return fresh;
}

/**
 * Commit-time authorisation, step 2: the policy's answer on the RELOADED grants. The read gate answers 404 when the
 * caller cannot read the record (existence not disclosed), but this caller passed it when the request started and
 * already knows the record exists, so a read right that was revoked meanwhile is a refused action: 403 `forbidden`,
 * with the same denial details, so the failed-mutation audit (denials.ts) records it as `authorization.denied`.
 * Every other error is returned unchanged.
 */
export function commitTimeDenial(err: unknown): unknown {
  if (err instanceof HttpProblem && err.status === 404 && err.denial)
    return problems
      .forbidden("Your access to this record changed while the request was in progress.")
      .withDenial(err.denial);
  return err;
}
