// Fastify composition root (ADR-0002, ADR-0007). Builds the app WITHOUT listening, so tests use `inject` against a
// real database and main.ts adds only `listen` and signal handling.
//
// Router-level errors (FST_ERR_BAD_URL ...) and connection-level parser errors are answered as problems by the
// `frameworkErrors` / `clientErrorHandler` server options (platform/framework-errors.ts, T-DG2-BE12).
//
// JSON bodies and query strings are decoded as strict UTF-8 (platform/request-encoding.ts, T-DG2-BE13).
//
// Order matters:
//   1. platform hooks (request IDs, problem+json, route access declarations, fail-closed guard) and the connection
//      hygiene (T-DG2-BE16: an unread body closes its connection; bounded shutdown);
//   2. security headers (helmet, strict same-origin CSP), cookies, rate limiting (per validated-session subject or IP;
//      stricter on auth), then the not-found handler, which the limiter meters too;
//   3. the failed-authorization audit hook, health routes, identity (authentication + CSRF hook), then the modules;
//   4. the built SPA, when present, from the same origin (no CDN).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import helmet, { type FastifyHelmetOptions } from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "@mth/config";
import { createDb, listMigrationFiles, type Db, type MigrationFile } from "@mth/db";
import Fastify, { type FastifyBaseLogger, type FastifyInstance, type FastifyRequest } from "fastify";
import type pg from "pg";
import { registerAccessP2Routes, registerDeniedMutationAudit } from "./modules/access/index.ts";
import { colorTokens, tokensAreProvisional } from "@mth/design-tokens";
import { registerAdminRoutes, registerBrandingRoutes } from "./modules/admin/index.ts";
import { RateLimitSubjects, registerIdentity, sessionCookieName, type OidcService } from "./modules/identity/index.ts";
import { registerEvidenceModule } from "./modules/evidence/index.ts";
import { registerKpiModule } from "./modules/kpi/index.ts";
import { registerMethodologyModule } from "./modules/methodology/index.ts";
import { registerOrganizationRoutes } from "./modules/organization/index.ts";
import {
  createClientErrorHandler,
  createFrameworkErrorHandler,
  createJsonBodyParser,
  DEFAULT_CONSUMES,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_GRACE_MS,
  genReqId,
  JSON_MEDIA_TYPE,
  parseQueryString,
  problems,
  registerConnectionHygiene,
  registerHealthRoutes,
  registerInFlightTracking,
  registerMediaTypeEnforcement,
  registerNotFoundHandler,
  registerPlatformHooks,
  restrictParserTo,
  type InFlight,
  type ModuleRegistration,
  type SecurityHeaders,
} from "./modules/platform/index.ts";
import { registerReportingModule } from "./modules/reporting/index.ts";
import { registerTransformationRoutes } from "./modules/transformations/index.ts";
import { registerWorkflowsModule } from "./modules/workflows/index.ts";

export const JSON_BODY_LIMIT_BYTES = 1_048_576;

export interface ServerOptions {
  readonly config: AppConfig;
  readonly pool: pg.Pool;
  /** Defaults to a pino logger at config.logLevel with credential redaction; tests pass false. */
  readonly logger?: boolean;
  /** Destination of that logger (default stdout); tests capture log lines with it. Ignored when logger is false. */
  readonly logStream?: { write(line: string): unknown };
  /** Override the OIDC service (tests bind it to a local fake IdP). null disables OIDC routes. */
  readonly oidc?: OidcService | null;
  /** Directory of the built SPA; null disables static serving. Default: the first existing candidate. */
  readonly webRoot?: string | null;
  /** Migrations the readiness check expects (default: those shipped with @mth/db). */
  readonly migrationFiles?: readonly MigrationFile[];
  /** T-DG2-BE16: time in-flight requests get after `app.close()` (default DEFAULT_SHUTDOWN_GRACE_MS, 5 s). */
  readonly shutdownGraceMs?: number;
  /** T-DG2-BE16: Node `requestTimeout` for headers + body (default DEFAULT_REQUEST_TIMEOUT_MS, 300 s). */
  readonly requestTimeoutMs?: number;
  /** How often Node checks that timeout (default Node's 30 s; tests shorten it). */
  readonly connectionsCheckingIntervalMs?: number;
}

/** Security headers (helmet) with a strict same-origin CSP. Also applied to router- and connection-level errors. */
export const HELMET_OPTIONS = {
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
} satisfies FastifyHelmetOptions;

const TRANSPORT_HEADERS = new Set(["content-type", "content-length", "date", "connection", "keep-alive"]);

/**
 * T-DG2-BE12: the exact headers helmet adds with HELMET_OPTIONS, captured once from a throwaway Fastify instance with
 * only helmet registered. Router-level (`frameworkErrors`) and connection-level (`clientErrorHandler`) errors run no
 * onRequest/onSend hook, so they set these themselves; the values never drift from the plugin's.
 */
export async function captureSecurityHeaders(options: FastifyHelmetOptions = HELMET_OPTIONS): Promise<SecurityHeaders> {
  const probe = Fastify({ logger: false });
  try {
    await probe.register(helmet, options);
    probe.get("/", async () => "");
    const res = await probe.inject({ method: "GET", url: "/" });
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(res.headers)) {
      if (!TRANSPORT_HEADERS.has(name) && typeof value === "string") headers[name] = value;
    }
    return headers;
  } finally {
    await probe.close();
  }
}

export function defaultWebRoot(): string | null {
  const candidates = [new URL("../public/", import.meta.url), new URL("../../web/dist/", import.meta.url)].map((u) =>
    fileURLToPath(u),
  );
  return candidates.find((dir) => existsSync(`${dir}index.html`)) ?? null;
}

export interface RouteRecord {
  readonly method: string;
  readonly url: string;
  readonly access: unknown;
  /** The request media types the route accepts (F-DG2-320). */
  readonly consumes: readonly string[];
}

export async function buildServer(options: ServerOptions): Promise<{
  app: FastifyInstance;
  db: Db;
  routes: readonly RouteRecord[];
  modules: readonly ModuleRegistration[];
  inFlight: InFlight;
}> {
  const { config, pool } = options;
  if (!config.appBaseUrl) throw new Error("APP_BASE_URL is required by the API");
  const webRoot = options.webRoot === undefined ? defaultWebRoot() : options.webRoot;

  // T-DG2-BE12: errors raised before routing answer the declared problem+json, with the same security headers.
  const securityHeaders = await captureSecurityHeaders();
  let appLog: FastifyBaseLogger | null = null;
  const onClientError = createClientErrorHandler(securityHeaders, (requestId, code) =>
    appLog?.info({ requestId, code }, "request refused by the HTTP parser"),
  );

  const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
            ...(options.logStream ? { stream: options.logStream } : {}),
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                'req.headers["x-csrf-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: "[redacted]",
            },
          },
    genReqId,
    requestIdLogLabel: "requestId",
    bodyLimit: JSON_BODY_LIMIT_BYTES,
    trustProxy: config.trustProxy.length > 0 ? [...config.trustProxy] : false,
    // F-DG2-290: strict percent-decoding; an undecodable component is refused by the central preHandler check.
    routerOptions: { querystringParser: parseQueryString },
    frameworkErrors: createFrameworkErrorHandler(securityHeaders),
    clientErrorHandler: onClientError,
    // T-DG2-BE16: a request (headers and body) must arrive within requestTimeout, else Node answers 408 and closes the
    // connection (Fastify's default 0 let a stalled body hold its connection forever). `forceCloseConnections` stays
    // Fastify's "idle": close() drops idle keep-alive connections at once and in-flight ones get the shutdown grace
    // period (platform/connection-hygiene.ts), instead of `true`, which would cut every in-flight request at close().
    // Node arms the timeout only when it is passed to http.createServer (Fastify's own option is assigned afterwards
    // and alone has no effect: verified on Node 22 and 24), so it is given in `http` as well.
    requestTimeout,
    http: {
      requestTimeout,
      ...(options.connectionsCheckingIntervalMs !== undefined
        ? { connectionsCheckingInterval: options.connectionsCheckingIntervalMs }
        : {}),
    },
    forceCloseConnections: "idle",
  });
  appLog = app.log;
  // F-DG2-290: JSON bodies are read as raw bytes and decoded as strict UTF-8 (never rewritten to U+FFFD), then parsed
  // by Fastify's default JSON parser (same empty/invalid-JSON errors and prototype-poisoning protection). Registered on
  // the root instance, so every module inherits it; the evidence octet-stream parser is separate.
  // F-DG2-320: each route accepts only its declared `config.consumes` media types (platform/media-types.ts): the
  // text/plain parser is removed, a central preParsing hook refuses any other media type with 400
  // validation.content_type before a body byte is read, and each parser re-checks the route's set.
  registerMediaTypeEnforcement(app);
  app.addContentTypeParser(
    JSON_MEDIA_TYPE,
    { parseAs: "buffer" },
    restrictParserTo(JSON_MEDIA_TYPE, createJsonBodyParser(app.getDefaultJsonParser("error", "error"))),
  );
  const db = createDb(pool);
  // Every registered route, for the route-coverage and access-declaration tests.
  const routes: RouteRecord[] = [];
  app.addHook("onRoute", (r) => {
    for (const method of [r.method].flat())
      routes.push({
        method: String(method),
        url: r.url,
        access: r.config?.access,
        consumes: r.config?.consumes ?? DEFAULT_CONSUMES,
      });
  });

  // The not-found handler is registered after the rate limiter, which meters it too (T-DG2-BE16).
  registerPlatformHooks(app, { notFound: "deferred" });
  // T-DG2-BE16: a response sent before its request body was consumed closes the connection (bounded lingering close),
  // and app.close() destroys what is still open after the shutdown grace period.
  registerConnectionHygiene(app, { shutdownGraceMs: options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS });
  // T-DG2-BE18A (F-DG2-460): every route handler registered from here on is tracked until it settles (including its
  // cleanup), so shutdown can wait for it before the pool closes (main.ts).
  const inFlight = registerInFlightTracking(app);

  await app.register(helmet, HELMET_OPTIONS);
  await app.register(cookie);

  const cookieName = sessionCookieName(config.appBaseUrl);
  // F-DG1-142: the limiter never trusts a presented cookie value. Only a cookie the identity hook has RESOLVED to a
  // live session (within the idle timeout) maps to the authenticated subject; everything else - no cookie, forged,
  // expired or revoked - is keyed by the client IP, so rotating fake cookies cannot open fresh buckets.
  const rateLimitSubjects = new RateLimitSubjects(config.session.idleMinutes * 60_000);
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.perMinute,
    timeWindow: "1 minute",
    // Keyed by the authenticated subject (user id) of a validated session, or else the client IP (TRUST_PROXY decides
    // which X-Forwarded-For hops count). Decided without a database lookup, so floods are refused before any query.
    // In-process store (ADR-0007 T-3); a PostgreSQL store comes with multi-instance P6.
    keyGenerator: (request: FastifyRequest) => {
      const token = request.cookies?.[cookieName];
      const subject = token ? rateLimitSubjects.subjectOf(token) : null;
      return subject ? `u:${subject}` : `ip:${request.ip}`;
    },
    allowList: (request: FastifyRequest) => request.url === "/healthz" || request.url === "/readyz",
    errorResponseBuilder: () => problems.rateLimited(),
  });
  // T-DG2-BE16 (audit round 10, P3): `global: true` attaches the limiter through `onRoute`, and an unmatched route has
  // no route, so unmatched-route 404s were never metered. The not-found handler runs it as a preHandler (the plugin's
  // documented form; same key, store and limit). Its 429, like the unmatched 404 itself, belongs to no operation and is
  // outside the contract by design (ADR-0007 §5b).
  registerNotFoundHandler(app, { spaFallback: webRoot !== null, preHandler: app.rateLimit() });

  registerDeniedMutationAudit(app, db);
  registerHealthRoutes(app, pool, options.migrationFiles ?? listMigrationFiles());
  const deps = { db, config };
  registerIdentity(app, deps, {
    rateLimitSubjects,
    ...(options.oidc !== undefined ? { oidc: options.oidc } : {}),
  });
  registerOrganizationRoutes(app, deps);
  registerTransformationRoutes(app, deps);
  registerAdminRoutes(app, deps);
  registerAccessP2Routes(app, deps);
  registerBrandingRoutes(app, { colorTokens, tokensAreProvisional });
  // Business modules reporting their registration (D-048): the P2 modules (workflows, methodology, evidence; kpi by
  // kpi-benefits-engineer) and the remaining scaffold (reporting, P5), which registers no routes until its stage.
  const modules: ModuleRegistration[] = [
    registerWorkflowsModule(app, deps),
    registerKpiModule(app, deps),
    registerReportingModule(app, deps),
    registerMethodologyModule(app, deps),
    registerEvidenceModule(app, deps),
  ];

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false, index: ["index.html"] });
  }

  await app.ready();
  return { app, db, routes, modules, inFlight };
}
