// Identity (ADR-0005; REQ-S16-030 increment): dev login only in AUTH_MODE=dev, server-side sessions (hash only),
// CSRF synchronizer token + Origin, /me with effective permissions per scope, preferences with If-Match, logout,
// idle/absolute expiry, disabled users, and audit of every session event.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  APP_ORIGIN,
  auditOf,
  call,
  createUser,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../support/harness.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

const tokenOf = (cookie: string) => cookie.split("=")[1]!;

describe("dev login (AUTH_MODE=dev)", () => {
  it("signs in a synthetic user: 204, HttpOnly SameSite=Lax cookie, only the SHA-256 of the token stored, audited", async () => {
    const res = await call(api.app, "POST", "/api/v1/auth/dev-login", { body: { username: w.office.subject } });
    expect(res.status).toBe(204);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/^mth_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    const token = cookie.split(";")[0]!.split("=")[1]!;
    const stored = await api.db
      .selectFrom("session")
      .selectAll()
      .where("token_hash", "=", createHash("sha256").update(token).digest())
      .executeTakeFirstOrThrow();
    expect(stored).toMatchObject({
      user_id: w.office.id,
      auth_mode: "dev",
      idp_issuer: "urn:mth:dev-local",
      revoked_at: null,
    });
    const session = await api.db
      .selectFrom("session")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("user_id", "=", w.office.id)
      .executeTakeFirstOrThrow();
    expect(Number(session.n)).toBeGreaterThanOrEqual(1);
    const audit = await auditOf(api.db, stored.id);
    expect(audit.map((a) => a.action)).toEqual(["session.create"]);
  });

  it("refuses unknown and disabled users with 401 and audits the failure", async () => {
    const unknown = await call(api.app, "POST", "/api/v1/auth/dev-login", { body: { username: "no.such.user" } });
    expect([unknown.status, unknown.body.code]).toEqual([401, "auth.login_failed"]);
    const disabled = await call(api.app, "POST", "/api/v1/auth/dev-login", { body: { username: w.disabled.subject } });
    expect(disabled.status).toBe(401);
    const failures = await api.db
      .selectFrom("audit_event")
      .select(["actor_user_id", "reason"])
      .where("action", "=", "session.login_failed")
      .execute();
    expect(failures.some((f) => f.reason?.includes('no synthetic user "no.such.user"'))).toBe(true);
    expect(failures.some((f) => f.actor_user_id === w.disabled.id)).toBe(true);
  });

  it("needs a same-origin Origin header (login CSRF) and a valid body", async () => {
    expect(
      (
        await call(api.app, "POST", "/api/v1/auth/dev-login", {
          origin: "https://evil.example",
          body: { username: w.office.subject },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(api.app, "POST", "/api/v1/auth/dev-login", { origin: null, body: { username: w.office.subject } }))
        .status,
    ).toBe(403);
    expect((await call(api.app, "POST", "/api/v1/auth/dev-login", { body: { username: "UPPER CASE" } })).status).toBe(
      400,
    );
  });

  it("rotates the session: a login presented with an existing session revokes it", async () => {
    const first = await signIn(api.app, w.office.subject);
    const again = await call(api.app, "POST", "/api/v1/auth/dev-login", {
      session: first,
      body: { username: w.office.subject },
    });
    expect(again.status).toBe(204);
    expect((await call(api.app, "GET", "/api/v1/me", { session: first })).status).toBe(401);
  });

  it("does not exist (404) when AUTH_MODE=oidc", async () => {
    const oidcApi = await startApi({
      env: {
        AUTH_MODE: "oidc",
        OIDC_ISSUER_URL: "http://127.0.0.1:9/realms/none",
        OIDC_CLIENT_ID: "mth",
        OIDC_CLIENT_SECRET: "synthetic-test-secret",
      },
    });
    try {
      const res = await call(oidcApi.app, "POST", "/api/v1/auth/dev-login", { body: { username: w.office.subject } });
      expect([res.status, res.body.type]).toEqual([404, "urn:mth:problem:not-found"]);
    } finally {
      await oidcApi.close();
    }
  });
});

describe("GET /api/v1/me", () => {
  it("returns the user, CSRF token, product name, home organization, active assignments and permissions per scope", async () => {
    const s = await signIn(api.app, w.office.subject);
    const me = await call(api.app, "GET", "/api/v1/me", { session: s });
    expect(me.status).toBe(200);
    expect(me.headers["etag"]).toBe(`"${me.body.user.version}"`);
    expect(me.body).toMatchObject({
      authMode: "dev",
      productName: "Mobily Transformation Hub",
      user: { id: w.office.id },
      organization: { id: w.orgA.id },
    });
    expect(me.body.csrfToken.length).toBeGreaterThanOrEqual(32);
    expect(me.body.assignments.map((a: { roleCode: string }) => a.roleCode)).toEqual(["TO"]);
    expect(me.body.effectivePermissions).toEqual([
      {
        scope: { type: "organization", id: w.orgA.id },
        inheritsDownward: true,
        // TO = P1 defaults (0005) + P2 defaults (0018) + P3 defaults (0024) + P4 slice I/C defaults (0031) + P4 slice A
        // defaults (0036) + P4 slice E defaults (0043) + P4 slice D defaults (0046) + P4 slice F/G defaults
        // (0049) + P4 slice H defaults (0053) + P4 slices J/K defaults (0057), sorted.
        permissions: [
          "action.edit",
          "approval.request",
          "assessment.respond",
          "audit.read",
          "business_case.edit",
          "business_unit.read",
          "capacity.commit",
          "capacity.edit",
          "change_control.configure",
          "change_request.raise",
          "charter.edit",
          "control.manage",
          "control_check.record",
          "corrective_rule.configure",
          "dashboard.configure",
          "decision_right.configure",
          "delegation.create_own",
          "dependency.edit",
          "diagnostic.edit",
          "escalation_rule.configure",
          "evidence.create",
          "evidence.review",
          "executive_decision.create",
          "forum.configure",
          "gate.configure",
          "gate.review",
          "group.manage",
          "improvement.edit",
          "inherited_record.record",
          "initiative.edit",
          "lesson.edit",
          "lesson.search",
          "meeting.chair",
          "meeting.prepare",
          "organization.read",
          "performance_area.manage",
          "phase_step.manage",
          "phase_step.progress",
          "phase_step.review",
          "portfolio.manage",
          "prioritization.edit",
          "raci.edit",
          "raid.edit",
          "reporting_period.manage",
          "roadmap.approve",
          "roadmap.edit",
          "role.read",
          "role_mapping.assign",
          "team.assign",
          "traceability.link",
          "transformation.archive",
          "transformation.create",
          "transformation.read",
          "transformation.update",
          "workstream.manage",
        ],
      },
    ]);
  });

  it("answers 401 without a session, with a forged cookie, after logout and after expiry", async () => {
    expect((await call(api.app, "GET", "/api/v1/me")).status).toBe(401);
    expect(
      (
        await call(api.app, "GET", "/api/v1/me", {
          session: { cookie: "mth_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", csrf: "", userId: "" },
        })
      ).status,
    ).toBe(401);

    const idle = await signIn(api.app, w.auditor.subject);
    await api.db
      .updateTable("session")
      .set({ idle_expires_at: new Date(Date.now() - 1000) })
      .where("token_hash", "=", createHash("sha256").update(tokenOf(idle.cookie)).digest())
      .execute();
    expect((await call(api.app, "GET", "/api/v1/me", { session: idle })).status).toBe(401);

    const absolute = await signIn(api.app, w.auditor.subject);
    await api.db
      .updateTable("session")
      .set({ absolute_expires_at: new Date(Date.now() - 1000) })
      .where("token_hash", "=", createHash("sha256").update(tokenOf(absolute.cookie)).digest())
      .execute();
    expect((await call(api.app, "GET", "/api/v1/me", { session: absolute })).status).toBe(401);
  });

  it("stops accepting a session as soon as its user is disabled", async () => {
    const u = await createUser(api.db, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    await api.db.updateTable("app_user").set({ status: "disabled" }).where("id", "=", u.id).execute();
    expect((await call(api.app, "GET", "/api/v1/me", { session: s })).status).toBe(401);
  });
});

describe("PUT /api/v1/me/preferences", () => {
  it("persists the language and time zone with If-Match (428, 409, 200) and audits the change", async () => {
    const u = await createUser(api.db, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const url = "/api/v1/me/preferences";
    expect((await call(api.app, "PUT", url, { session: s, body: { preferredLocale: "en" } })).status).toBe(428);
    expect((await call(api.app, "PUT", url, { session: s, headers: { "if-match": '"1"' }, body: {} })).status).toBe(
      400,
    );
    expect(
      (await call(api.app, "PUT", url, { session: s, headers: { "if-match": '"1"' }, body: { timezone: "Not/AZone" } }))
        .status,
    ).toBe(400);
    const ok = await call(api.app, "PUT", url, {
      session: s,
      headers: { "if-match": '"1"' },
      body: { preferredLocale: "en", timezone: "Asia/Riyadh" },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ preferredLocale: "en", timezone: "Asia/Riyadh", version: 2 });
    const stale = await call(api.app, "PUT", url, {
      session: s,
      headers: { "if-match": '"1"' },
      body: { preferredLocale: "ar" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
    const audit = (await auditOf(api.db, u.id)).filter((a) => a.action === "app_user.update_preferences");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.changes).toEqual({
      preferred_locale: { from: "ar", to: "en" },
      timezone: { from: null, to: "Asia/Riyadh" },
    });
  });

  it("needs the CSRF token", async () => {
    const s = await signIn(api.app, w.nobody.subject);
    const res = await call(api.app, "PUT", "/api/v1/me/preferences", {
      session: s,
      csrf: false,
      headers: { "if-match": '"1"' },
      body: { preferredLocale: "en" },
    });
    expect([res.status, res.body.code]).toEqual([403, "csrf"]);
  });
});

describe("logout", () => {
  it("needs CSRF, revokes the session, clears the cookie, audits, and returns no end-session URL in dev mode", async () => {
    const s = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "POST", "/api/v1/auth/logout", { session: s, csrf: false })).status).toBe(403);
    expect(
      (await call(api.app, "POST", "/api/v1/auth/logout", { session: { ...s, csrf: "x".repeat(43) } })).status,
    ).toBe(403);
    const res = await call(api.app, "POST", "/api/v1/auth/logout", { session: s });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ endSessionUrl: null });
    expect(String(res.headers["set-cookie"])).toMatch(/^mth_session=;.*Expires=Thu, 01 Jan 1970/);
    expect((await call(api.app, "GET", "/api/v1/me", { session: s })).status).toBe(401);
    const row = await api.db
      .selectFrom("session")
      .select(["id", "revoked_at"])
      .where("token_hash", "=", createHash("sha256").update(tokenOf(s.cookie)).digest())
      .executeTakeFirstOrThrow();
    expect(row.revoked_at).not.toBeNull();
    expect((await auditOf(api.db, row.id)).map((a) => a.action)).toEqual(["session.create", "session.revoke"]);
    expect((await call(api.app, "POST", "/api/v1/auth/logout", { session: s })).status).toBe(401);
  });

  it("uses the __Host- cookie with Secure on an https base URL", async () => {
    const httpsApi = await startApi({ env: { APP_BASE_URL: "https://hub.example.internal" } });
    try {
      const res = await call(httpsApi.app, "POST", "/api/v1/auth/dev-login", {
        origin: "https://hub.example.internal",
        body: { username: w.office.subject },
      });
      expect(res.status).toBe(204);
      expect(String(res.headers["set-cookie"])).toMatch(/^__Host-mth_session=.*; Secure/);
    } finally {
      await httpsApi.close();
    }
  });
});

describe("request IDs", () => {
  it("echoes a well-formed X-Request-Id and replaces a malformed one", async () => {
    const good = await call(api.app, "GET", "/healthz", { headers: { "x-request-id": "trace-123.abc" } });
    expect(good.headers["x-request-id"]).toBe("trace-123.abc");
    const bad = await call(api.app, "GET", "/healthz", { headers: { "x-request-id": "bad id with spaces" } });
    expect(bad.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    const problem = await call(api.app, "GET", "/api/v1/me", { headers: { "x-request-id": "trace-401" } });
    expect(problem.body.requestId).toBe("trace-401");
    expect(APP_ORIGIN).toBe("http://localhost:3000");
  });
});
