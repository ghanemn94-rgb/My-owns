// identity routes (ADR-0005): authentication hook (session -> principal), CSRF/Origin checks, dev login (only when
// AUTH_MODE=dev), OIDC login/callback, logout, GET /me and PUT /me/preferences.
import { randomBytes } from "node:crypto";
import type {} from "@fastify/cookie";
import type {} from "@fastify/rate-limit";
import { secureOriginAllowed } from "@mth/config";
import { DEV_ISSUER, type Db } from "@mth/db";
import type { Permission, ScopeType } from "@mth/shared";
import { devLoginRequest, preferencesUpdate } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { activeAssignmentsOf, auditContextOf, loadGrants, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { findOrganization, toOrganization } from "../organization/index.ts";
import { parseBody, parseQuery, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { LOGIN_STATE_TTL_MINUTES, loginCookieName, OidcService, resolveOidcUser } from "./oidc.ts";
import {
  createSession,
  csrfMatches,
  csrfTokenFor,
  resolveSession,
  revokeSession,
  sessionCookieName,
  touchSession,
  type ActiveSession,
} from "./sessions.ts";
import { loadUser, updatePreferences } from "./users.ts";

declare module "fastify" {
  interface FastifyRequest {
    session: ActiveSession | null;
  }
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Origin (or Referer when Origin is absent) must be the configured APP_BASE_URL origin (ADR-0005 §4). */
export function sameOrigin(request: FastifyRequest, appOrigin: string): boolean {
  const origin = request.headers.origin;
  if (typeof origin === "string") return origin === appOrigin;
  const referer = request.headers.referer;
  if (typeof referer === "string") {
    try {
      return new URL(referer).origin === appOrigin;
    } catch {
      return false;
    }
  }
  return false;
}

export interface IdentityOptions {
  /** Injected OIDC service (tests pass one bound to a local fake IdP); defaults to one built from config. */
  readonly oidc?: OidcService | null;
}

export function registerIdentity(
  app: FastifyInstance,
  { db, config }: ModuleDeps,
  options: IdentityOptions = {},
): void {
  if (!config.appBaseUrl) throw new Error("APP_BASE_URL is required by the API");
  // Defence in depth for F-DG1-112 (the loader already refuses this): never issue non-Secure, non-__Host- session
  // cookies in production because of a plain-http origin, even with a hand-built configuration.
  if (!secureOriginAllowed(config.appBaseUrl, config.nodeEnv))
    throw new Error("refusing to start: APP_BASE_URL must use https when NODE_ENV=production (loopback excepted)");
  const appOrigin = config.appBaseUrl.origin;
  const cookieName = sessionCookieName(config.appBaseUrl);
  const secureCookie = config.appBaseUrl.protocol === "https:";
  const oidc = options.oidc !== undefined ? options.oidc : config.oidc ? new OidcService(config) : null;
  const authRateLimit = {
    max: config.rateLimit.authPerMinute,
    timeWindow: "1 minute",
    keyGenerator: (r: FastifyRequest) => r.ip,
  };

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(cookieName, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/",
      maxAge: config.session.absoluteHours * 3600,
    });
  const clearSessionCookie = (reply: FastifyReply) =>
    reply.clearCookie(cookieName, { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/" });
  // Pre-session login cookie (F-DG1-103): binds the OIDC state to the browser that started the login. SameSite=Lax
  // (the IdP returns with a top-level cross-site GET, which Strict would drop), HttpOnly, Secure + __Host- on https,
  // and it lives no longer than the login state itself.
  const loginCookie = loginCookieName(config.appBaseUrl);
  const loginCookieOptions = { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/" } as const;

  app.decorateRequest("principal", null);
  app.decorateRequest("session", null);

  // ------------------------------------------------------------ authentication + CSRF (every route)
  // preValidation: runs after the per-route rate limiter (onRequest), so floods are rejected before any DB lookup.
  app.addHook("preValidation", async (request) => {
    request.principal = null;
    request.session = null;
    const access = request.routeOptions.config?.access;
    if (!access) return; // unknown route: the not-found handler answers
    const token = request.cookies[cookieName];
    if (token) {
      const session = await resolveSession(db, token);
      if (session) {
        await touchSession(db, session, config.session.idleMinutes);
        request.session = session;
        request.principal = {
          kind: "user",
          userId: session.userId,
          organizationId: session.organizationId,
          grants: await loadGrants(db, session.userId),
          tracker: request.authz,
        };
      }
    }
    if ("public" in access) return;
    if (!request.session) throw problems.unauthenticated();
    if (UNSAFE.has(request.method)) {
      if (!sameOrigin(request, appOrigin))
        throw problems.csrf("The Origin header does not match the application origin.");
      const header = request.headers["x-csrf-token"];
      if (!csrfMatches(typeof header === "string" ? header : undefined, request.session.csrfTokenHash)) {
        throw problems.csrf("The X-CSRF-Token header is missing or does not match the session.");
      }
    }
  });

  async function startSession(
    request: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    organizationId: string,
    mode: "oidc" | "dev",
    issuer: string,
  ) {
    const { sessionId, token } = await db.transaction().execute(async (tx) => {
      // Session rotation on login: a previous session presented by this browser is revoked.
      if (request.session) await revokeSession(tx, request.session.id);
      const s = await createSession(tx, {
        userId,
        authMode: mode,
        idpIssuer: issuer,
        idpSessionId: null,
        userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null,
        idleMinutes: config.session.idleMinutes,
        absoluteHours: config.session.absoluteHours,
      });
      await record(
        tx,
        { actorUserId: userId, requestId: request.id },
        {
          action: "session.create",
          recordType: "session",
          recordId: s.sessionId,
          organizationId,
          reason: mode === "dev" ? "dev login (AUTH_MODE=dev, synthetic user)" : "OIDC sign-in",
        },
      );
      return s;
    });
    setSessionCookie(reply, token);
    return sessionId;
  }

  async function auditLoginFailure(
    request: FastifyRequest,
    detail: { userId: string | null; organizationId: string | null; reason: string },
  ) {
    await db.transaction().execute((tx) =>
      record(
        tx,
        detail.userId
          ? { actorUserId: detail.userId, requestId: request.id }
          : { actorUserId: null, actorType: "system", requestId: request.id },
        {
          action: "session.login_failed",
          recordType: "session",
          recordId: uuidv7(),
          organizationId: detail.organizationId,
          reason: detail.reason,
        },
      ),
    );
  }

  // ------------------------------------------------------------ dev login (AUTH_MODE=dev only; 404 otherwise)
  if (config.authMode === "dev") {
    if (config.nodeEnv === "production") throw new Error("refusing to register dev login with NODE_ENV=production");
    app.post(
      "/api/v1/auth/dev-login",
      { config: { access: { public: true }, rateLimit: authRateLimit } },
      async (request, reply) => {
        if (!sameOrigin(request, appOrigin))
          throw problems.csrf("The Origin header does not match the application origin.");
        const { username } = parseBody(devLoginRequest, request.body);
        const found = await db
          .selectFrom("user_identity as i")
          .innerJoin("app_user as u", "u.id", "i.user_id")
          .select(["u.id", "u.organization_id", "u.status"])
          .where("i.issuer", "=", DEV_ISSUER)
          .where("i.subject", "=", username)
          .executeTakeFirst();
        if (!found || found.status !== "active") {
          await auditLoginFailure(request, {
            userId: found?.id ?? null,
            organizationId: found?.organization_id ?? null,
            reason: found ? "dev login refused: user disabled" : `dev login refused: no synthetic user "${username}"`,
          });
          throw problems.loginFailed();
        }
        await startSession(request, reply, found.id, found.organization_id, "dev", DEV_ISSUER);
        return reply.code(204).send();
      },
    );
  }

  // ------------------------------------------------------------ OIDC (404 when not configured)
  if (oidc) {
    const loginQuery = z.strictObject({
      returnTo: z
        .string()
        .max(2048)
        .regex(/^\/(?!\/)[^\s\\]*$/)
        .optional(),
    });
    app.get(
      "/api/v1/auth/login",
      { config: { access: { public: true }, rateLimit: authRateLimit } },
      async (request, reply) => {
        const { returnTo } = parseQuery(loginQuery, request.query);
        try {
          const binding = randomBytes(32).toString("base64url");
          const url = await db.transaction().execute((tx) => oidc.startLogin(tx, returnTo ?? "/", binding));
          reply.setCookie(loginCookie, binding, { ...loginCookieOptions, maxAge: LOGIN_STATE_TTL_MINUTES * 60 });
          return reply.redirect(url.toString(), 302);
        } catch (err) {
          request.log.warn({ err }, "OIDC login could not start");
          return reply.redirect("/login?error=idp_unavailable", 302);
        }
      },
    );

    const callbackQuery = z.object({
      state: z.string().max(512).optional(),
      code: z.string().max(4096).optional(),
      error: z.string().max(256).optional(),
    });
    app.get(
      "/api/v1/auth/callback",
      { config: { access: { public: true }, rateLimit: authRateLimit } },
      async (request, reply) => {
        // The login cookie is single use: cleared on every callback outcome.
        const browserBinding = request.cookies[loginCookie];
        reply.clearCookie(loginCookie, loginCookieOptions);
        const fail = (code: string) => reply.redirect(`/login?error=${code}`, 302);
        const q = callbackQuery.safeParse(request.query);
        if (!q.success || !q.data.state) return fail("invalid_request");
        const state = q.data.state;
        const stored = await db.transaction().execute((tx) => oidc.consumeState(tx, state, browserBinding));
        if (!stored.ok) {
          if (stored.reason === "browser_mismatch") {
            // Login CSRF / leaked callback URL: a live state presented by a browser that did not start the login.
            // Refused and audited; the presenting browser's own session (if any) is left untouched.
            await auditLoginFailure(request, {
              userId: null,
              organizationId: null,
              reason: browserBinding
                ? "OIDC callback refused: the login state is bound to a different browser"
                : "OIDC callback refused: no login cookie (the state is not bound to this browser)",
            });
          }
          return fail("state_invalid");
        }
        if (q.data.error || !q.data.code) return fail("idp_denied"); // IdP error text is never rendered verbatim
        let claims: Awaited<ReturnType<OidcService["exchange"]>>;
        try {
          claims = await oidc.exchange(new URL(request.url, appOrigin), {
            state,
            nonce: stored.nonce,
            codeVerifier: stored.code_verifier,
          });
        } catch (err) {
          request.log.warn({ err }, "OIDC code exchange or ID token validation failed");
          await auditLoginFailure(request, {
            userId: null,
            organizationId: null,
            reason: "OIDC token exchange or ID token validation failed",
          });
          return fail("token_invalid");
        }
        const resolved = await db.transaction().execute((tx) => resolveOidcUser(tx, claims, request.id));
        if (!resolved.ok) {
          await auditLoginFailure(request, {
            userId: resolved.userId,
            organizationId: resolved.organizationId,
            reason: `OIDC sign-in refused: ${resolved.error}`,
          });
          return fail(resolved.error);
        }
        await startSession(request, reply, resolved.userId, resolved.organizationId, "oidc", claims.iss);
        return reply.redirect(stored.return_to, 302);
      },
    );
  }

  // ------------------------------------------------------------ logout
  app.post("/api/v1/auth/logout", { config: { access: { permission: "authenticated" } } }, async (request, reply) => {
    const principal = principalOf(request);
    const session = request.session!;
    await db.transaction().execute(async (tx) => {
      await revokeSession(tx, session.id);
      await record(tx, auditContextOf(request), {
        action: "session.revoke",
        recordType: "session",
        recordId: session.id,
        organizationId: principal.organizationId,
        reason: "logout",
      });
    });
    clearSessionCookie(reply);
    const endSessionUrl = session.authMode === "oidc" && oidc ? await oidc.endSessionUrl() : null;
    return { endSessionUrl };
  });

  // ------------------------------------------------------------ /me
  app.get("/api/v1/me", { config: { access: { permission: "authenticated" } } }, async (request, reply) => {
    const principal = principalOf(request);
    const session = request.session!;
    const [user, org, assignments] = await Promise.all([
      loadUser(db, principal.userId!),
      findOrganization(db, principal.organizationId!),
      activeAssignmentsOf(db, principal.userId!),
    ]);
    if (!user || !org) throw problems.unauthenticated();
    reply.header("ETag", `"${user.version}"`);
    return {
      user,
      authMode: session.authMode,
      csrfToken: csrfTokenFor(session.token),
      productName: config.productName,
      organization: toOrganization(org),
      assignments,
      effectivePermissions: effectivePermissions(principal.grants),
    };
  });

  app.put("/api/v1/me/preferences", { config: { access: { permission: "authenticated" } } }, async (request, reply) => {
    const principal = principalOf(request);
    const body = parseBody(preferencesUpdate, request.body);
    const expected = requireIfMatch(request);
    const user = await db
      .transaction()
      .execute((tx) => updatePreferences(tx, auditContextOf(request), principal.userId!, expected, body));
    return sendVersioned(reply, 200, user);
  });
}

/** Permissions per granted scope (UI hint; the server re-checks every request). */
export function effectivePermissions(
  grants: readonly {
    scopeType: ScopeType;
    scopeId: string;
    inheritsDownward: boolean;
    permissions: ReadonlySet<Permission>;
  }[],
) {
  const byKey = new Map<
    string,
    { scope: { type: ScopeType; id: string }; inheritsDownward: boolean; permissions: Set<Permission> }
  >();
  for (const g of grants) {
    const key = `${g.scopeType}:${g.scopeId}:${g.inheritsDownward}`;
    const entry = byKey.get(key) ?? {
      scope: { type: g.scopeType, id: g.scopeId },
      inheritsDownward: g.inheritsDownward,
      permissions: new Set<Permission>(),
    };
    for (const p of g.permissions) entry.permissions.add(p);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .sort((a, b) =>
      `${a.scope.type}:${a.scope.id}:${a.inheritsDownward}`.localeCompare(
        `${b.scope.type}:${b.scope.id}:${b.inheritsDownward}`,
      ),
    )
    .map((e) => ({ ...e, permissions: [...e.permissions].sort() }));
}

export type { Db };
