// P6 slice C (T-DG6-BE-G; ADR-0054 §1; REQ-S16-007): issuer and audience rejection, and Administration > Identity.
// The fake OP hosts two realms, `mth-test` (the issuer the API is configured with) and `mth-other` (its own signing
// key). An ID token from the other issuer, one for another audience, and one signed by the other realm's key each end
// at /login?error=token_invalid with exactly one `session.login_failed` event, no session, and no user created or
// bound. Accepted controls (same flow, the configured realm) prove each refusal is the check under test and not a
// broken harness. Runs on its OWN scratch database with one organization, so a token that slipped through would be
// provisioned just in time and visible. Every value is synthetic.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../../../packages/db/test/helpers.ts";
import { identitySettings } from "../../../src/modules/admin/identity.ts";
import { FakeIdp, type IdTokenClaims, type IssueOptions } from "../../support/fake-idp.ts";
import { call, createOrg, createUser, grant, startApi, type Session, type TestApi } from "../../support/harness.ts";

const { adminUrl } = testDatabase();
let dbName: string;
let idp: FakeIdp;
let api: TestApi;
let orgId: string;
const logLines: string[] = [];

beforeAll(async () => {
  dbName = await createScratchDatabase(adminUrl, "mth_other_realm");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  idp = await new FakeIdp().start();
  api = await startApi({
    env: {
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: idp.issuer,
      OIDC_CLIENT_ID: idp.clientId,
      OIDC_CLIENT_SECRET: idp.clientSecret,
      DATABASE_URL: roleUrl(adminUrl, dbName, "mth_app"),
      LOG_LEVEL: "info",
    },
    logStream: { write: (line: string) => void logLines.push(line) },
  });
  orgId = (await createOrg(api.db, "OTHERREALM")).id;
});
afterAll(async () => {
  await api?.close();
  await idp?.stop();
  if (dbName) await dropScratchDatabase(adminUrl, dbName);
});

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const h = res.headers["set-cookie"];
  return h === undefined ? [] : Array.isArray(h) ? h.map(String) : [String(h)];
}

/** One whole browser login: GET /auth/login, the IdP issues a code minted as `opts` says, GET /auth/callback. */
async function login(claims: IdTokenClaims, opts: IssueOptions = {}) {
  const start = await call(api.app, "GET", "/api/v1/auth/login");
  expect(start.status).toBe(302);
  const loginCookie = setCookies(start)
    .find((c) => c.startsWith("mth_login="))!
    .split(";")[0]!;
  const { code, state } = idp.issueCode(String(start.headers["location"]), claims, opts);
  const cb = await call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, {
    headers: { cookie: loginCookie },
  });
  const session =
    setCookies(cb)
      .find((c) => c.startsWith("mth_session="))
      ?.split(";")[0] ?? null;
  return { cb, session };
}

async function countRows(table: "session" | "app_user" | "user_identity"): Promise<number> {
  const r = await api.db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

async function loginFailures() {
  return api.db
    .selectFrom("audit_event")
    .select(["id", "reason", "actor_type"])
    .where("action", "=", "session.login_failed")
    .orderBy("seq")
    .execute();
}

const freshSubject = () => `other-realm-${randomBytes(5).toString("hex")}`;

/** Asserts the refusal ADR-0054 §1 requires, and that nothing about the token reached a log line. */
async function expectRefused(claims: IdTokenClaims, opts: IssueOptions) {
  const before = {
    failures: (await loginFailures()).length,
    sessions: await countRows("session"),
    users: await countRows("app_user"),
    identities: await countRows("user_identity"),
  };
  const logStart = logLines.length;
  const { cb, session } = await login(claims, opts);
  expect(cb.status).toBe(302);
  expect(cb.headers["location"]).toBe("/login?error=token_invalid");
  expect(session).toBeNull();
  const failures = await loginFailures();
  expect(failures).toHaveLength(before.failures + 1);
  expect(failures.at(-1)!.reason).toBe("OIDC token exchange or ID token validation failed");
  expect(failures.at(-1)!.actor_type).toBe("system");
  expect(await countRows("session")).toBe(before.sessions);
  expect(await countRows("app_user")).toBe(before.users); // no user created
  expect(await countRows("user_identity")).toBe(before.identities); // none bound
  const identity = await api.db
    .selectFrom("user_identity")
    .select("id")
    .where("subject", "=", claims.sub)
    .executeTakeFirst();
  expect(identity).toBeUndefined();
  // The token and its claims are never logged (ADR-0053 §4): neither the JWT, its payload segment nor the subject.
  const token = idp.lastIdToken!;
  const written = logLines.slice(logStart).join("\n");
  expect(written).toContain("OIDC code exchange or ID token validation failed"); // the refusal was logged
  for (const secret of [token, token.split(".")[1]!, claims.sub]) expect(written).not.toContain(secret);
}

describe("ID-token issuer, audience and signing-key rejection (ADR-0054 §1)", () => {
  it("control: a token of the configured realm signs in (provisioned just in time)", async () => {
    const sub = freshSubject();
    const { cb, session } = await login({ sub, email: `${sub}@example.invalid`, email_verified: true });
    expect(cb.status).toBe(302);
    expect(cb.headers["location"]).toBe("/");
    expect(session).toMatch(/^mth_session=/);
  });

  it("refuses an ID token issued by the other issuer (realm mth-other, its own key)", async () => {
    await expectRefused({ sub: freshSubject(), email_verified: true }, { issuedBy: "mth-other" });
  });

  it("refuses an ID token from the right issuer whose audience is another client", async () => {
    await expectRefused({ sub: freshSubject(), aud: "another-client" }, {});
  });

  it("refuses an ID token from the right issuer signed by the other realm's key", async () => {
    await expectRefused({ sub: freshSubject() }, { signedBy: "mth-other" });
  });

  it("refuses an ID token signed by the other realm's key but labelled with the configured realm's key id", async () => {
    await expectRefused({ sub: freshSubject() }, { signedBy: "mth-other", kidOf: "mth-test" });
  });

  it("refuses a multi-audience ID token whose azp is not the client id", async () => {
    await expectRefused({ sub: freshSubject(), aud: [idp.clientId, "another-client"] }, {});
    await expectRefused({ sub: freshSubject(), aud: [idp.clientId, "another-client"], azp: "another-client" }, {});
  });

  it("control: a multi-audience ID token whose azp is the client id signs in", async () => {
    const sub = freshSubject();
    const { cb, session } = await login({ sub, aud: [idp.clientId, "another-client"], azp: idp.clientId });
    expect(cb.headers["location"]).toBe("/");
    expect(session).toMatch(/^mth_session=/);
  });
});

describe("GET /api/v1/admin/identity (Administration > Identity; identity.read)", () => {
  /** A user of the scratch organization with `roles`, signed in through the OIDC flow of the configured realm. */
  async function signedInWith(roles: string[]): Promise<Session> {
    const grantor = await createUser(api.db, orgId);
    const user = await createUser(api.db, orgId);
    for (const role of roles)
      await grant(api.db, grantor.id, user.id, role, { type: "organization", id: orgId }, orgId);
    await api.db
      .insertInto("user_identity")
      .values({ id: crypto.randomUUID(), user_id: user.id, issuer: idp.issuer, subject: user.subject })
      .execute();
    const { session } = await login({ sub: user.subject });
    expect(session).toMatch(/^mth_session=/);
    const me = await call<{ csrfToken: string }>(api.app, "GET", "/api/v1/me", {
      session: { cookie: session!, csrf: "", userId: "" },
    });
    return { cookie: session!, csrf: me.body.csrfToken, userId: user.id };
  }

  it.each([["ADM_TECH"], ["ADM_ACCESS"], ["AUD"]])("%s reads the effective settings", async (role) => {
    const session = await signedInWith([role]);
    const res = await call(api.app, "GET", "/api/v1/admin/identity", { session });
    expect(res.status).toBe(200);
    expect(identitySettings.parse(res.body)).toEqual({
      authMode: "oidc",
      issuer: idp.issuer,
      clientId: idp.clientId,
      clientSecretConfigured: true,
      scopes: ["openid", "profile", "email"],
      expectedAudience: idp.clientId,
      pkceMethod: "S256",
      claimMapping: { subject: "sub", email: "email", displayName: "name" },
      samlBrokerDocument: "docs/operations/identity-saml-broker.md",
    });
  });

  it("never returns the client secret: the canary value is absent from the body and the headers", async () => {
    const session = await signedInWith(["ADM_TECH"]);
    const res = await call(api.app, "GET", "/api/v1/admin/identity", { session });
    expect(res.status).toBe(200);
    expect(idp.clientSecret).toBe("synthetic-test-secret-not-real"); // the canary configured as OIDC_CLIENT_SECRET
    expect(JSON.stringify(res.body)).not.toContain(idp.clientSecret);
    expect(JSON.stringify(res.headers)).not.toContain(idp.clientSecret);
    expect(Object.keys(res.body as object)).not.toContain("clientSecret");
  });

  it("refuses a holder without identity.read with 403, and an anonymous caller with 401", async () => {
    const session = await signedInWith(["TO"]); // Transformation Office: no identity.read
    expect((await call(api.app, "GET", "/api/v1/admin/identity", { session })).status).toBe(403);
    const none = await signedInWith([]);
    expect((await call(api.app, "GET", "/api/v1/admin/identity", { session: none })).status).toBe(403);
    expect((await call(api.app, "GET", "/api/v1/admin/identity")).status).toBe(401);
  });

  it("refuses an unknown query parameter with 400", async () => {
    const session = await signedInWith(["AUD"]);
    expect((await call(api.app, "GET", "/api/v1/admin/identity?secret=1", { session })).status).toBe(400);
  });
});
