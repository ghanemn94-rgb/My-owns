// HTTP plumbing shared by every module (ADR-0007): request IDs, problem+json errors, the not-found handler and the
// two fail-closed authorization guards (ADR-0006):
//   1. at REGISTRATION: every route must declare `config.access` (`{ public: true }` or `{ permission }`), otherwise
//      the server refuses to start;
//   2. at RESPONSE time: a successful response from a route that declares a business permission must have consulted
//      the policy function at least once (request.authz.decisions > 0), otherwise the response is replaced by a 500.
import type { Permission } from "@mth/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { mapDatabaseGuardError } from "./db-errors.ts";
import { HttpProblem, problems } from "./problem.ts";

/** `authenticated`: any signed-in user (e.g. /me); the handler scopes the data to the caller itself. */
export type RouteAccess = { readonly public: true } | { readonly permission: Permission | "authenticated" };

export interface AuthzTracker {
  decisions: number;
}

declare module "fastify" {
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
  interface FastifyRequest {
    authz: AuthzTracker;
  }
}

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Fastify `genReqId`: accept a well-formed inbound X-Request-Id, otherwise generate a UUIDv7 (ADR-0007 §8). */
export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const inbound = req.headers["x-request-id"];
  const value = Array.isArray(inbound) ? inbound[0] : inbound;
  return value !== undefined && REQUEST_ID.test(value) ? value : uuidv7();
}

export function isValidAccess(access: unknown): access is RouteAccess {
  if (!access || typeof access !== "object") return false;
  const a = access as Record<string, unknown>;
  return a["public"] === true || typeof a["permission"] === "string";
}

export function sendProblem(reply: FastifyReply, request: FastifyRequest, problem: HttpProblem): FastifyReply {
  return reply.code(problem.status).type("application/problem+json").send(problem.toBody(request.id));
}

function mapError(
  error: FastifyError & { code?: string; constraint?: string; table?: string; column?: string },
): HttpProblem | null {
  if (error instanceof HttpProblem) return error;
  // P2 database record guards and template constraints (ADR-0016 §3, ADR-0015) first: they are more specific.
  const guarded = mapDatabaseGuardError(error);
  if (guarded) return guarded;
  switch (error.code) {
    case "FST_ERR_CTP_INVALID_JSON_BODY":
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return problems.badRequest("validation.json", "The request body is not valid JSON.");
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return problems.badRequest("validation.content_type", "Send the request body as application/json.");
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return problems.badRequest("validation.body_too_large", "The request body is too large.");
    case "23505": // unique_violation that a service did not map more precisely
      return problems.duplicate("duplicate", "A record with the same unique value already exists.");
    case "23503": // foreign_key_violation
      return problems.businessRule("validation.reference", "A referenced record does not exist.");
    case "23514": // check_violation (the database is the last line of defence)
      return problems.businessRule("validation.constraint", "The change violates a data rule.");
    case "22P02": // invalid_text_representation
      return problems.badRequest("validation.format", "A value has an invalid format.");
    default:
      if (error.statusCode === 429) return problems.rateLimited();
      return null;
  }
}

export interface PlatformOptions {
  /** Serve the SPA's index.html for unknown GET paths outside /api/ (needs @fastify/static's reply.sendFile). */
  readonly spaFallback?: boolean;
}

export function registerPlatformHooks(app: FastifyInstance, options: PlatformOptions = {}): void {
  app.addHook("onRoute", (route) => {
    // Every API route and the health endpoints must declare their access. Plugin routes outside /api (static assets)
    // serve no data and pass no hook checks.
    const governed = route.url.startsWith("/api/") || route.url === "/healthz" || route.url === "/readyz";
    if (governed && !isValidAccess(route.config?.access)) {
      const methods = Array.isArray(route.method) ? route.method.join(",") : route.method;
      throw new Error(
        `route ${methods} ${route.url} declares no config.access ({ public: true } or { permission }); refusing to start`,
      );
    }
  });

  app.decorateRequest("authz", null as unknown as AuthzTracker);
  app.addHook("onRequest", async (request, reply) => {
    request.authz = { decisions: 0 };
    reply.header("X-Request-Id", request.id);
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const access = request.routeOptions.config?.access;
    if (
      access &&
      "permission" in access &&
      access.permission !== "authenticated" &&
      reply.statusCode < 400 &&
      request.authz.decisions === 0
    ) {
      request.log.error(
        { route: request.routeOptions.url },
        "fail-closed: handler returned success without consulting the policy function",
      );
      reply.code(500).type("application/problem+json");
      return JSON.stringify(problems.internal().toBody(request.id));
    }
    return payload;
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const problem = mapError(error);
    if (problem) {
      if (problem.status >= 500) request.log.error({ err: error }, "request failed");
      return sendProblem(reply, request, problem);
    }
    request.log.error({ err: error }, "unhandled error");
    return sendProblem(reply, request, problems.internal());
  });

  app.setNotFoundHandler((request, reply) => {
    if (options.spaFallback && request.method === "GET" && !request.url.startsWith("/api/")) {
      return (reply as unknown as { sendFile(name: string): FastifyReply }).sendFile("index.html");
    }
    return sendProblem(reply, request, problems.notFound());
  });
}
