// ADR-0004 coverage rule: a FAILED AUTHORIZATION OF A MUTATION writes an audit event. The mutation's own transaction
// rolls back when the policy denies it, so the denial is recorded here, in a separate short transaction, from the
// details the policy attached to the problem (existing target only; a missing record is not an authorization event).
import type { Db } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { record } from "../audit/index.ts";
import { HttpProblem } from "../platform/index.ts";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function registerDeniedMutationAudit(app: FastifyInstance, db: Db): void {
  app.addHook("onError", async (request, _reply, error) => {
    if (!(error instanceof HttpProblem) || !error.denial || !UNSAFE.has(request.method) || !request.principal?.userId)
      return;
    const d = error.denial;
    try {
      await db.transaction().execute((tx) =>
        record(
          tx,
          { actorUserId: request.principal!.userId, requestId: request.id },
          {
            action: "authorization.denied",
            recordType: d.recordType,
            recordId: d.recordId,
            organizationId: d.organizationId,
            transformationId: d.transformationId,
            reason: `${request.method} ${request.routeOptions.url ?? request.url} requires ${d.permission}`,
          },
        ),
      );
    } catch (err) {
      request.log.error({ err }, "could not audit an authorization denial");
    }
  });
}
