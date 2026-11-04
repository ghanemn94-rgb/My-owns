// F-DG6-181 (ADR-0052 amendment of 2026-11-04 §D; D-209; T-DG6-BE-Z2): a SecretRef binding refusal is the refusal of a
// mutation on authorization grounds (the secret is not the caller's to use), so it is audited like
// `authorization.denied` (denials.ts): the request's own transaction rolled back, and this hook writes one
// `secret_ref.refused` event per refused request in a separate short transaction. The event names the actor (record
// type `user`, the actor's own id: a create has no row yet and the installation settings have no organization), the
// setting's organization (null for storage and the assistant), and in `reason` each refused reference's provider and
// name (and host for a host refusal). It carries no `changes` and never a value: no value is ever read here.
import type { Db } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { record } from "../audit/index.ts";
import { HttpProblem, secretRefusalOf } from "../platform/index.ts";

/** The reason text's bound (ADR-0052 amendment §D). */
const MAX_REASON = 1000;

const hostText = (h: { hostname: string; port: number }) => `${h.hostname}:${h.port}`;

export function registerSecretRefusalAudit(app: FastifyInstance, db: Db): void {
  app.addHook("onError", async (request, _reply, error) => {
    if (!(error instanceof HttpProblem) || !request.principal?.userId) return;
    const refusal = secretRefusalOf(error);
    if (refusal === undefined) return;
    const route = `${request.method} ${request.routeOptions.url ?? request.url}`;
    const lines = refusal.refs.map(
      (r) =>
        `${route}: ${refusal.consumer} reference ${r.provider}:${r.name} not bound` +
        (r.reason === "host_not_bound" && r.host ? ` to host ${hostText(r.host)}` : ""),
    );
    let reason = lines.join("; ");
    if (reason.length > MAX_REASON) reason = `${reason.slice(0, MAX_REASON - 1)}…`;
    try {
      const userId = request.principal.userId;
      // Tracked (T-DG2-BE18A): this runs after the handler settled, and shutdown must not close the pool under it.
      const audit = db.transaction().execute((tx) =>
        record(
          tx,
          { actorUserId: userId, requestId: request.id },
          {
            action: "secret_ref.refused",
            recordType: "user",
            recordId: userId,
            organizationId: refusal.organizationId,
            reason,
          },
        ),
      );
      await (app.hasDecorator("inFlight") ? app.inFlight.track(audit) : audit);
    } catch (err) {
      request.log.error({ err }, "could not audit a SecretRef binding refusal");
    }
  });
}
