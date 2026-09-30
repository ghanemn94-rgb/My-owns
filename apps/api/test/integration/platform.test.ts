// Platform behaviour: readiness (DB + migrations shipped with the build), rate limits with problem+json and
// Retry-After, body limits, malformed JSON, unknown routes, security headers (strict same-origin CSP), and the
// fail-closed authorization guard.
import { listMigrationFiles } from "@mth/db";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerPlatformHooks } from "../../src/modules/platform/index.ts";
import { call, seedWorld, signIn, startApi, type TestApi, type World } from "../support/harness.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

describe("health and readiness", () => {
  it("reports ready when the database answers and every shipped migration is applied", async () => {
    const res = await call(api.app, "GET", "/readyz");
    expect([res.status, res.body]).toEqual([200, { status: "ready", checks: { database: "ok", migrations: "ok" } }]);
    expect((await call(api.app, "GET", "/healthz")).body).toEqual({ status: "ok" });
  });

  it("reports 503 not_ready/pending when the build ships a migration the database lacks, and fail on checksum drift", async () => {
    const files = listMigrationFiles();
    const pending = await startApi({
      migrationFiles: [...files, { id: 9999, name: "9999_future.sql", sha256: "0".repeat(64), sql: "" }],
    });
    const drift = await startApi({
      migrationFiles: files.map((f, i) => (i === 0 ? { ...f, sha256: "f".repeat(64) } : f)),
    });
    try {
      const p = await call(pending.app, "GET", "/readyz");
      expect([p.status, p.body]).toEqual([
        503,
        { status: "not_ready", checks: { database: "ok", migrations: "pending" } },
      ]);
      const d = await call(drift.app, "GET", "/readyz");
      expect([d.status, d.body.checks.migrations]).toEqual([503, "fail"]);
    } finally {
      await pending.close();
      await drift.close();
    }
  });
});

describe("rate limiting (ADR-0007 T-3)", () => {
  it("limits auth endpoints per IP with a 429 problem and Retry-After", async () => {
    const limited = await startApi({ env: { AUTH_RATE_LIMIT_PER_MINUTE: "2" } });
    try {
      for (let i = 0; i < 2; i++)
        expect(
          (await call(limited.app, "POST", "/api/v1/auth/dev-login", { body: { username: "nobody.x" } })).status,
        ).toBe(401);
      const res = await call(limited.app, "POST", "/api/v1/auth/dev-login", { body: { username: "nobody.x" } });
      expect(res.status).toBe(429);
      expect(res.body).toMatchObject({ type: "urn:mth:problem:rate-limited", code: "rate_limited" });
      expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });

  it("limits general API traffic per session, never the health endpoints", async () => {
    const limited = await startApi({ env: { RATE_LIMIT_PER_MINUTE: "3" } });
    try {
      // dev-login counts under the IP key (no session yet); signIn's /me is the session key's 1st request.
      const s = await signIn(limited.app, w.office.subject);
      for (let i = 0; i < 2; i++)
        expect((await call(limited.app, "GET", "/api/v1/me", { session: s })).status).toBe(200);
      // Most operations do not declare 429 in the contract yet (handback: contract gap), so skip the assertion here.
      const res = await call(limited.app, "GET", "/api/v1/me", { session: s, contract: false });
      expect(res.status).toBe(429);
      for (let i = 0; i < 5; i++) expect((await call(limited.app, "GET", "/healthz")).status).toBe(200);
    } finally {
      await limited.close();
    }
  });
});

describe("request hygiene", () => {
  it("rejects malformed JSON, non-JSON bodies and bodies over 1 MiB with 400 problems", async () => {
    const s = await signIn(api.app, w.office.subject);
    const base = { cookie: s.cookie, origin: "http://localhost:3000", "x-csrf-token": s.csrf };
    const bad = await api.app.inject({
      method: "POST",
      url: "/api/v1/transformations",
      headers: { ...base, "content-type": "application/json" },
      payload: "{nope",
    });
    expect([bad.statusCode, bad.json().code]).toEqual([400, "validation"]);
    const text = await api.app.inject({
      method: "POST",
      url: "/api/v1/transformations",
      headers: { ...base, "content-type": "text/plain" },
      payload: "x",
    });
    expect(text.statusCode).toBe(400);
    const big = await api.app.inject({
      method: "POST",
      url: "/api/v1/transformations",
      headers: { ...base, "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
    });
    expect(big.statusCode).toBe(400);
  });

  it("answers unknown API paths with a 404 problem", async () => {
    const res = await api.app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toMatch(/application\/problem\+json/);
    expect(res.json()).toMatchObject({ type: "urn:mth:problem:not-found", requestId: res.headers["x-request-id"] });
  });

  it("sends a strict same-origin Content-Security-Policy and other security headers", async () => {
    const res = await api.app.inject({ method: "GET", url: "/healthz" });
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("fail-closed guards (ADR-0006)", () => {
  it("refuses to start with an /api route that declares no access", async () => {
    const app = Fastify();
    registerPlatformHooks(app);
    expect(() => app.get("/api/v1/undeclared", async () => ({}))).toThrow(/declares no config.access/);
  });

  it("turns a success from a route that never consulted the policy function into a 500", async () => {
    const app = Fastify();
    registerPlatformHooks(app);
    app.get("/api/v1/forgot-to-authorize", { config: { access: { permission: "transformation.read" } } }, async () => ({
      secret: true,
    }));
    app.get("/api/v1/checked", { config: { access: { permission: "transformation.read" } } }, async (request) => {
      request.authz.decisions += 1;
      return { ok: true };
    });
    const leaked = await app.inject({ method: "GET", url: "/api/v1/forgot-to-authorize" });
    expect(leaked.statusCode).toBe(500);
    expect(leaked.body).not.toContain("secret");
    expect((await app.inject({ method: "GET", url: "/api/v1/checked" })).statusCode).toBe(200);
  });
});
