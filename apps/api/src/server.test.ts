// Unit test of the composition root without a database (pg connects lazily): every governed route declares its
// access, the dev login exists only in AUTH_MODE=dev, and OIDC routes only when OIDC is configured (ADR-0005/0006).
import { loadConfig } from "@mth/config";
import { createPool } from "@mth/db";
import { describe, expect, it } from "vitest";
import { buildServer } from "./server.ts";

const base = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://mth_app@127.0.0.1:1/none",
};

async function routesFor(env: Record<string, string>) {
  const config = loadConfig("api", { ...base, ...env });
  const pool = createPool(config.databaseUrl!);
  const { app, routes } = await buildServer({ config, pool, logger: false, webRoot: null });
  await app.close();
  await pool.end();
  return routes.filter((r) => r.method !== "HEAD").map((r) => ({ key: `${r.method} ${r.url}`, access: r.access }));
}

describe("route registration", () => {
  it("declares access on every /api route and on the health endpoints", async () => {
    const routes = await routesFor({ AUTH_MODE: "dev" });
    const governed = routes.filter(
      (r) => r.key.includes(" /api/") || r.key.endsWith("/healthz") || r.key.endsWith("/readyz"),
    );
    expect(governed.length).toBeGreaterThanOrEqual(30);
    for (const r of governed) expect(r.access, r.key).toBeTruthy();
    const publicRoutes = governed
      .filter((r) => (r.access as { public?: boolean }).public)
      .map((r) => r.key)
      .sort();
    expect(publicRoutes).toEqual(["GET /healthz", "GET /readyz", "POST /api/v1/auth/dev-login"]);
  });

  it("registers dev login only in AUTH_MODE=dev; production configuration refuses dev mode entirely", async () => {
    const oidc = await routesFor({
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: "https://idp.example.invalid/realms/x",
      OIDC_CLIENT_ID: "c",
      OIDC_CLIENT_SECRET: "s",
    });
    expect(oidc.map((r) => r.key)).not.toContain("POST /api/v1/auth/dev-login");
    expect(oidc.map((r) => r.key)).toEqual(
      expect.arrayContaining(["GET /api/v1/auth/login", "GET /api/v1/auth/callback"]),
    );
    const dev = await routesFor({ AUTH_MODE: "dev" });
    expect(dev.map((r) => r.key)).toContain("POST /api/v1/auth/dev-login");
    expect(dev.map((r) => r.key)).not.toContain("GET /api/v1/auth/login");
    expect(() => loadConfig("api", { ...base, NODE_ENV: "production", AUTH_MODE: "dev" })).toThrow(
      /AUTH_MODE=dev is refused/,
    );
  });
});
