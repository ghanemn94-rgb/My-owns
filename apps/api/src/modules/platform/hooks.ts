// HTTP plumbing shared by every module (ADR-0007): request IDs, problem+json errors, the not-found handler and the
// two fail-closed authorization guards (ADR-0006):
//   1. at REGISTRATION: every route must declare `config.access` (`{ public: true }` or `{ permission }`), otherwise
//      the server refuses to start;
//   2. at RESPONSE time: a successful response from a route that declares a business permission must have consulted
//      the policy function at least once (request.authz.decisions > 0), otherwise the response is replaced by a 500.
import type { Permission } from "@mth/shared";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { mapDatabaseGuardError } from "./db-errors.ts";
import { consumesOf, undeclaredMediaTypeProblem, type RouteConsumesSource } from "./media-types.ts";
import { HttpProblem, problems } from "./problem.ts";
import { assertDecodableQuery } from "./request-encoding.ts";
import { assertNoInvalidCharacters } from "./validation.ts";

/** `authenticated`: any signed-in user (e.g. /me); the handler scopes the data to the caller itself. */
export type RouteAccess = { readonly public: true } | { readonly permission: Permission | "authenticated" };

export interface AuthzTracker {
  decisions: number;
}

declare module "fastify" {
  interface FastifyContextConfig {
    access?: RouteAccess;
    /**
     * F-DG2-231: `"route"` exempts the route from the central U+0000 request check because the route rejects such
     * input itself in the form its contract declares (the OIDC callback answers with a redirect, never a problem).
     */
    invalidCharacters?: "route";
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
  request: RouteConsumesSource,
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
      // F-DG2-351: like every media-type refusal, the detail names the media types the operation declares. The central
      // preParsing decision normally prevents this (it canonicalises every accepted Content-Type), so this is a backstop.
      return undeclaredMediaTypeProblem(consumesOf(request));
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return problems.badRequest("validation.body_too_large", "The request body is too large.");
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      // F-DG2-290: the body's byte count differs from its Content-Length. The JSON parser now counts raw bytes, so a
      // well-framed request no longer gets here; any that does is the client's framing error, never a 500.
      return problems.badRequest("validation.malformed_request", "The request body does not match its Content-Length.");
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

/**
 * The problem for any error that reaches an error handler: the specific mapping, else 500 internal (never a plain or
 * internal-leaking body). Shared by `setErrorHandler` and the router-level `frameworkErrors` handler (T-DG2-BE12).
 */
export function problemForError(error: FastifyError, request: RouteConsumesSource): HttpProblem {
  return mapError(error, request) ?? problems.internal();
}

export interface NotFoundOptions {
  /** Serve the SPA's index.html for unknown GET paths outside /api/ (needs @fastify/static's reply.sendFile). */
  readonly spaFallback?: boolean;
  /**
   * T-DG2-BE16: preHandler hooks of the not-found handler. An unmatched route has no route, so no `onRoute`-attached
   * hook (the rate limiter's) runs for it; server.ts passes `app.rateLimit()` here (@fastify/rate-limit's documented
   * form for the not-found handler).
   */
  readonly preHandler?: preHandlerAsyncHookHandler | readonly preHandlerAsyncHookHandler[];
}

export interface PlatformOptions extends NotFoundOptions {
  /**
   * `"deferred"`: do not set the not-found handler here; the caller registers it with `registerNotFoundHandler` once
   * the plugins its preHandler needs (the rate limiter) are registered.
   */
  readonly notFound?: "deferred";
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

  // F-DG2-231: the central request check. preHandler runs after authentication and CSRF (identity's preValidation
  // hook), so 401/403 keep their precedence, and before every handler, so a U+0000 in any body, query or path
  // parameter is a 400 validation problem and never reaches PostgreSQL (SQLSTATE 22021 -> undeclared 500).
  // F-DG2-290: a query component that is not valid percent-encoded UTF-8 (`%FF`, CESU-8 `%ED%A0%80`) is a 400
  // validation.format problem first; it never reaches a handler as raw percent text.
  app.addHook("preHandler", async (request) => {
    if (request.routeOptions.config?.invalidCharacters === "route") return;
    assertDecodableQuery(request);
    assertNoInvalidCharacters(request);
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
    const problem = mapError(error, request);
    if (problem) {
      if (problem.status >= 500) request.log.error({ err: error }, "request failed");
      return sendProblem(reply, request, problem);
    }
    request.log.error({ err: error }, "unhandled error");
    return sendProblem(reply, request, problemForError(error, request));
  });

  if (options.notFound !== "deferred") registerNotFoundHandler(app, options);
}

/** The not-found handler: the SPA's index.html for unknown non-API GETs (when enabled), else 404 not_found. */
export function registerNotFoundHandler(app: FastifyInstance, options: NotFoundOptions = {}): void {
  const preHandler = options.preHandler === undefined ? [] : [options.preHandler].flat();
  app.setNotFoundHandler({ preHandler }, (request, reply) => {
    if (options.spaFallback && request.method === "GET" && !request.url.startsWith("/api/")) {
      return (reply as unknown as { sendFile(name: string): FastifyReply }).sendFile("index.html");
    }
    return sendProblem(reply, request, problems.notFound());
  });
}
