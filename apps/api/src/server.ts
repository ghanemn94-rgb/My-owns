// Fastify composition root (ADR-0002, ADR-0007). Builds the app WITHOUT listening, so tests use `inject` against a
// real database and main.ts adds only `listen` and signal handling.
//
// Order matters:
//   1. platform hooks (request IDs, problem+json, route access declarations, fail-closed guard);
//   2. security headers (helmet, strict same-origin CSP), cookies, rate limiting (per validated-session subject or IP;
//      stricter on auth);
//   3. the failed-authorization audit hook, health routes, identity (authentication + CSRF hook), then the modules;
//   4. the built SPA, when present, from the same origin (no CDN).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { AppConfig } from "@mth/config";
import { createDb, listMigrationFiles, type Db, type MigrationFile } from "@mth/db";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type pg from "pg";
import { registerDeniedMutationAudit } from "./modules/access/index.ts";
import { colorTokens, tokensAreProvisional } from "@mth/design-tokens";
import { registerAdminRoutes, registerBrandingRoutes } from "./modules/admin/index.ts";
import { RateLimitSubjects, registerIdentity, sessionCookieName, type OidcService } from "./modules/identity/index.ts";
import { registerKpiModule } from "./modules/kpi/index.ts";
import { registerOrganizationRoutes } from "./modules/organization/index.ts";
import {
  genReqId,
  problems,
  registerHealthRoutes,
  registerPlatformHooks,
  type ModuleRegistration,
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
  /** Override the OIDC service (tests bind it to a local fake IdP). null disables OIDC routes. */
  readonly oidc?: OidcService | null;
  /** Directory of the built SPA; null disables static serving. Default: the first existing candidate. */
  readonly webRoot?: string | null;
  /** Migrations the readiness check expects (default: those shipped with @mth/db). */
  readonly migrationFiles?: readonly MigrationFile[];
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
}

export async function buildServer(
  options: ServerOptions,
): Promise<{ app: FastifyInstance; db: Db; routes: readonly RouteRecord[]; modules: readonly ModuleRegistration[] }> {
  const { config, pool } = options;
  if (!config.appBaseUrl) throw new Error("APP_BASE_URL is required by the API");
  const webRoot = options.webRoot === undefined ? defaultWebRoot() : options.webRoot;

  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: config.logLevel,
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
  });
  const db = createDb(pool);
  // Every registered route, for the route-coverage and access-declaration tests.
  const routes: RouteRecord[] = [];
  app.addHook("onRoute", (r) => {
    for (const method of [r.method].flat())
      routes.push({ method: String(method), url: r.url, access: r.config?.access });
  });

  registerPlatformHooks(app, { spaFallback: webRoot !== null });

  await app.register(helmet, {
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
  });
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
  registerBrandingRoutes(app, { colorTokens, tokensAreProvisional });
  // P1 scaffolds (D-048): wired like every module, registering no routes until their stage (P2 / P4 / P5).
  const scaffolds: ModuleRegistration[] = [
    registerWorkflowsModule(app, deps),
    registerKpiModule(app, deps),
    registerReportingModule(app, deps),
  ];

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false, index: ["index.html"] });
  }

  await app.ready();
  return { app, db, routes, modules: scaffolds };
}
