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

describe("session cookie security in production (F-DG1-112)", () => {
  const prodEnv = {
    ...base,
    NODE_ENV: "production",
    AUTH_MODE: "oidc",
    OIDC_ISSUER_URL: "https://idp.example.invalid/realms/x",
    OIDC_CLIENT_ID: "c",
    OIDC_CLIENT_SECRET: "s",
  };

  it("the loader fails closed at startup on a plain-http, non-loopback APP_BASE_URL", () => {
    expect(() => loadConfig("api", { ...prodEnv, APP_BASE_URL: "http://hub.example.internal" })).toThrow(
      /APP_BASE_URL must use https when NODE_ENV=production/,
    );
  });

  it("the API refuses to start even with a hand-built configuration that bypassed the loader", async () => {
    const good = loadConfig("api", { ...prodEnv, APP_BASE_URL: "https://hub.example.internal" });
    const config = { ...good, appBaseUrl: new URL("http://hub.example.internal") };
    const pool = createPool(config.databaseUrl!);
    try {
      await expect(buildServer({ config, pool, logger: false, webRoot: null })).rejects.toThrow(
        /APP_BASE_URL must use https when NODE_ENV=production/,
      );
    } finally {
      await pool.end();
    }
  });

  it("an https production origin starts", async () => {
    const config = loadConfig("api", { ...prodEnv, APP_BASE_URL: "https://hub.example.internal" });
    const pool = createPool(config.databaseUrl!);
    try {
      const { app } = await buildServer({ config, pool, logger: false, webRoot: null });
      await app.close();
    } finally {
      await pool.end();
    }
  });
});

describe("module composition (D-048, P2)", () => {
  it("wires the P2 business modules (each registering routes) and keeps reporting a route-free scaffold until P5", async () => {
    const config = loadConfig("api", { ...base, AUTH_MODE: "dev" });
    const pool = createPool(config.databaseUrl!);
    try {
      const { app, modules, routes } = await buildServer({ config, pool, logger: false, webRoot: null });
      await app.close();
      expect(modules.map((m) => m.module)).toEqual([
        "workflows",
        "kpi",
        "reporting",
        "methodology",
        "evidence",
        "portfolio",
        // P4 (T-DG4-BE-A; p4-plan §2 seam 19).
        "tasks",
        "governance",
        "raid",
        "benefits",
        "adoption",
        "sustainment",
      ]);
      // P4: tasks routes the five My Work and inbox operations; the other P4 modules are route-free until filled.
      expect(modules.find((m) => m.module === "tasks")).toMatchObject({ status: "active", deliversIn: "P4" });
      expect(modules.find((m) => m.module === "tasks")!.routes).toHaveLength(5);
      // P3 (T-DG3-BE-A): the portfolio module is active and registers routes (readiness, hierarchy, dispensations).
      expect(modules.find((m) => m.module === "portfolio")).toMatchObject({ status: "active", deliversIn: "P3" });
      expect(modules.find((m) => m.module === "portfolio")!.routes.length).toBeGreaterThan(0);
      for (const m of modules.filter((x) => ["workflows", "methodology", "evidence"].includes(x.module))) {
        expect([m.status, m.deliversIn], m.module).toEqual(["active", "P2"]);
        expect(m.routes.length, m.module).toBeGreaterThan(0);
      }
      expect(modules.find((m) => m.module === "reporting")).toMatchObject({
        status: "scaffold",
        deliversIn: "P5",
        routes: [],
      });
      // P3 (T-DG3-KBE-C): kpi routes the T09 benefit formulas (/benefit-formulas, /benefit-formula-examples); the
      // reporting module stays route-free until P5.
      expect(routes.filter((r) => /report/i.test(r.url))).toEqual([]);
    } finally {
      await pool.end();
    }
  });
});
