// P6 slice F (T-DG6-BE-E; ADR-0052 §4; REQ-S16-030 "rate limiting"): the security view's rate-limit matrix,
// getSecurityRateLimits (Administration > Security; security.read on the organization: ADM_TECH, AUD). It reads
// configuration only: the effective per-minute budget of each class, how the class is keyed and the operations wired
// to it. It reports no counters, no client IPs and no user ids. Reading it changes and approves nothing.
import { type RateLimitMatrix } from "@mth/shared/schemas";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireAction, resolveTarget } from "../access/index.ts";
import { parseQuery, problems, RATE_LIMIT_CLASSES, type ModuleDeps } from "../platform/index.ts";

const query = z.strictObject({ organizationId: uuid });

/** The matrix for a configuration: global and auth from `rateLimit`, the others from `rateLimitClasses`. */
export function rateLimitMatrix(config: ModuleDeps["config"]): RateLimitMatrix {
  const budgets = new Map<string, number>([
    ["global", config.rateLimit.perMinute],
    ["auth", config.rateLimit.authPerMinute],
    ...Object.entries(config.rateLimitClasses),
  ]);
  return {
    classes: RATE_LIMIT_CLASSES.map((spec) => ({
      name: spec.name,
      variable: spec.variable,
      perMinute: budgets.get(spec.name)!,
      keyedBy: spec.keyedBy,
      operationIds: [...spec.operationIds],
    })),
  };
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerSecurityRoutes(app: FastifyInstance, { db, config }: ModuleDeps): string[] {
  app.get(
    "/api/v1/admin/security/rate-limits",
    { config: { access: { permission: "security.read" } } },
    async (request) => {
      const { organizationId } = parseQuery(query, request.query);
      const principal = principalOf(request);
      const target = await resolveTarget(db, { type: "organization", id: organizationId });
      if (!target) {
        // The contract declares no 404: an unknown organization is refused like one the caller cannot read.
        principal.tracker.decisions += 1;
        throw problems.forbidden();
      }
      await requireAction(db, principal, "security.read", target);
      return rateLimitMatrix(config);
    },
  );
  return ["GET /api/v1/admin/security/rate-limits"];
}
