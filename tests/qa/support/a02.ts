// qa-verifier acceptance support for A02 "Complete lifecycle" and A21 "No-AI operation" (DG5, T-DG5-QA-E). Setup only:
// no assertion about an acceptance criterion lives here.
//
// 1. A stand-in for the EXTERNAL demo identity provider. A demo deployment names its demo IdP issuer
//    (`DEMO_IDP_ISSUER`, ADR-0050 §3), and the seeded demo role users `roaming.user.<role>` hold an identity of that
//    issuer only. No demo IdP exists in this sandbox, so `FakeDemoIdp` replaces only the two steps that talk to the IdP
//    (`prepareLogin`'s discovery and `exchange`'s code grant). Everything the product does (the login state, the
//    browser binding cookie, the single-use state, the user resolution by issuer and subject, the session) runs
//    unchanged through GET /auth/login and GET /auth/callback.
// 2. A person creator that also returns the subject (the shared fixtures need `{id, subject}`).
// All data is SYNTHETIC. Nothing here grants a real business, Finance or IT approval, or names DG0-DG7.
import { randomBytes } from "node:crypto";
import { OidcService } from "../../../apps/api/src/modules/identity/index.ts";
import { testConfig } from "../../../apps/api/test/support/harness.ts";
import { DEMO_IDP_ISSUER } from "../../../packages/db/src/demo/data/roaming.ts";
import { call, createUser, signIn, type Session, type TestApi } from "./api.ts";

export { DEMO_IDP_ISSUER };
export { DEMO_USERS } from "../../../packages/db/src/demo/data/roaming.ts";
export { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";

type PreparedLogin = Awaited<ReturnType<OidcService["prepareLogin"]>>;

/** The external demo IdP replaced at its two network steps; the product's login and callback code is unchanged. */
export class FakeDemoIdp extends OidcService {
  /** The subject the next code exchange answers with (set by `demoSignIn`; one login at a time). */
  nextSubject = "";
  constructor() {
    super(
      testConfig({
        OIDC_ISSUER_URL: DEMO_IDP_ISSUER,
        OIDC_CLIENT_ID: "mth-demo",
        OIDC_CLIENT_SECRET: "synthetic-not-a-secret",
      }),
    );
  }
  override async prepareLogin(returnTo: string, browserBinding: string): Promise<PreparedLogin> {
    const state = randomBytes(24).toString("base64url");
    const url = new URL(`${DEMO_IDP_ISSUER}/protocol/openid-connect/auth`);
    url.searchParams.set("state", state);
    return {
      url,
      state,
      nonce: randomBytes(16).toString("base64url"),
      codeVerifier: randomBytes(32).toString("base64url"),
      returnTo,
      browserBinding,
    } as PreparedLogin;
  }
  override async exchange(): Promise<Awaited<ReturnType<OidcService["exchange"]>>> {
    return { iss: DEMO_IDP_ISSUER, sub: this.nextSubject, aud: "mth-demo", iat: 0, exp: 0 } as Awaited<
      ReturnType<OidcService["exchange"]>
    >;
  }
}

function cookieOf(setCookie: unknown, name: string): string | null {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [String(setCookie)] : [];
  for (const c of all as string[]) {
    const first = c.split(";")[0]!;
    if (first.startsWith(`${name}=`) && first.length > name.length + 1) return first;
  }
  return null;
}

export interface DemoSignIn {
  readonly loginStatus: number;
  readonly callbackStatus: number;
  readonly callbackLocation: string;
  readonly session: Session | null;
}

/** Signs `subject` in through GET /auth/login and GET /auth/callback with the demo IdP stand-in. */
export async function demoSignIn(api: TestApi, idp: FakeDemoIdp, subject: string): Promise<DemoSignIn> {
  const login = await api.app.inject({ method: "GET", url: "/api/v1/auth/login" });
  const location = String(login.headers.location ?? "");
  const state = location.startsWith(DEMO_IDP_ISSUER) ? new URL(location).searchParams.get("state") : null;
  const binding =
    cookieOf(login.headers["set-cookie"], "mth_login") ?? cookieOf(login.headers["set-cookie"], "__Host-mth_login");
  if (!state || !binding)
    return { loginStatus: login.statusCode, callbackStatus: 0, callbackLocation: location, session: null };
  idp.nextSubject = subject;
  const cb = await api.app.inject({
    method: "GET",
    url: `/api/v1/auth/callback?state=${encodeURIComponent(state)}&code=synthetic-code`,
    headers: { cookie: binding },
  });
  const sessionCookie =
    cookieOf(cb.headers["set-cookie"], "mth_session") ?? cookieOf(cb.headers["set-cookie"], "__Host-mth_session");
  let session: Session | null = null;
  if (sessionCookie) {
    const me = await call<{ csrfToken: string; user: { id: string } }>(api.app, "GET", "/api/v1/me", {
      session: { cookie: sessionCookie, csrf: "", userId: "" },
    });
    if (me.status === 200) session = { cookie: sessionCookie, csrf: me.body.csrfToken, userId: me.body.user.id };
  }
  return {
    loginStatus: login.statusCode,
    callbackStatus: cb.statusCode,
    callbackLocation: String(cb.headers.location ?? ""),
    session,
  };
}

export interface Actor {
  readonly id: string;
  readonly subject: string;
  readonly session: Session;
}

/** A fresh synthetic person of `organizationId` granted `role` on the transformation by the access administrator. */
export async function grantedActor(
  api: TestApi,
  admin: Session,
  organizationId: string,
  transformationId: string,
  role: string,
): Promise<Actor> {
  const u = await createUser(api.db, organizationId);
  const r = await call(api.app, "POST", "/api/v1/role-assignments", {
    session: admin,
    body: {
      userId: u.id,
      roleCode: role,
      scope: { type: "transformation", id: transformationId },
      reason: `Synthetic QA ${role} for the A02 acceptance suite (approves nothing real)`,
    },
  });
  if (r.status !== 201) throw new Error(`role assignment ${role}: ${r.status} ${JSON.stringify(r.body)}`);
  return { id: u.id, subject: u.subject, session: await signIn(api.app, u.subject) };
}
