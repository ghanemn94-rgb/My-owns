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
    // T-DG6-BE-N (ADR-0056 §7): + the signed webhook receiver, session-less and authenticated by its signature only.
    expect(publicRoutes).toEqual([
      "GET /healthz",
      "GET /readyz",
      "POST /api/v1/auth/dev-login",
      "POST /api/v1/webhooks/:endpointKey",
    ]);
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
        // P5 (T-DG5-BE-A; p5-plan §3 seam 24): route-free scaffolds until their owners fill them.
        "forms",
        "procedures",
        "automation",
        "launch",
        "health",
        // P6 (T-DG6-BE-A; p6-plan §3 seam 21): route-free scaffolds until their owners fill them.
        "integrations",
        "search",
        "assistant",
        "operations",
        // P7 (T-DG7-BE-A; p7-plan §2, §5.1): route-free scaffolds until their owners fill them.
        "transfer",
        "retention",
        "release",
      ]);
      for (const m of ["integrations", "search", "assistant", "operations"]) {
        const reg = modules.find((x) => x.module === m);
        expect(reg).toMatchObject({ status: reg!.routes.length > 0 ? "active" : "scaffold", deliversIn: "P6" });
      }
      for (const m of ["transfer", "retention", "release"]) {
        const reg = modules.find((x) => x.module === m);
        expect(reg).toMatchObject({ status: reg!.routes.length > 0 ? "active" : "scaffold", deliversIn: "P7" });
      }
      // A P5 module is a scaffold until its first route file is filled, then active (T-DG5-BE-H: automation routes
      // its rules, versions and catalogue; the others stay scaffolds until their owners fill them).
      for (const m of ["forms", "procedures", "automation", "launch", "health"]) {
        const reg = modules.find((x) => x.module === m);
        expect(reg).toMatchObject({ status: reg!.routes.length > 0 ? "active" : "scaffold", deliversIn: "P5" });
      }
      // T-DG5-BE-D (p5-work-split §B.2): forms routes the form-schema reads and custom-field values.
      expect(modules.find((x) => x.module === "forms")).toMatchObject({ status: "active", deliversIn: "P5" });
      expect(modules.find((x) => x.module === "automation")).toMatchObject({ status: "active" });
      // P4: tasks routes the five My Work and inbox operations; the other P4 modules are route-free until filled.
      // T-DG5-BE-L: + the five P5 notification operations (preferences, policy, own digest; ADR-0044 §5).
      expect(modules.find((m) => m.module === "tasks")).toMatchObject({ status: "active", deliversIn: "P4" });
      // T-DG6-BE-C (ADR-0051 §3): + resolveDeepLink (tasks/deep-links.ts).
      expect(modules.find((m) => m.module === "tasks")!.routes).toHaveLength(11);
      // P3 (T-DG3-BE-A): the portfolio module is active and registers routes (readiness, hierarchy, dispensations).
      expect(modules.find((m) => m.module === "portfolio")).toMatchObject({ status: "active", deliversIn: "P3" });
      expect(modules.find((m) => m.module === "portfolio")!.routes.length).toBeGreaterThan(0);
      for (const m of modules.filter((x) => ["workflows", "methodology", "evidence"].includes(x.module))) {
        expect([m.status, m.deliversIn], m.module).toEqual(["active", "P2"]);
        expect(m.routes.length, m.module).toBeGreaterThan(0);
      }
      // T-DG4-BE-M (p4-work-split §J+K JK.1): reporting is active in P4 with the slice K read models and trace links
      // (traceability, trace links, allocation sets, orphans, impact); snapshots and exports still land in P5.
      expect(modules.find((m) => m.module === "reporting")).toMatchObject({ status: "active", deliversIn: "P4" });
      expect(modules.find((m) => m.module === "reporting")!.routes.length).toBeGreaterThan(0);
      // P3 (T-DG3-KBE-C): kpi routes the T09 benefit formulas (/benefit-formulas, /benefit-formula-examples); the
      // reporting module stays route-free until P5. T-DG4-KBE-C: kpi's P4 reporting periods (contract path
      // /organizations/{id}/reporting-periods, ADR-0027 §3) are KPI periods, not reports, so they are excluded here.
      // T-DG5-KBE-C (p5-work-split §F.1; ADR-0045): the report definitions, live reports and report snapshots are
      // routed (reporting/reports/routes.ts); no other report route exists (exports are BE-M's, under /exports).
      expect(
        routes
          .filter((r) => /report/i.test(r.url) && !/\/reporting-periods(\/|$)/.test(r.url) && r.method !== "HEAD")
          .map((r) => `${r.method} ${r.url}`)
          .sort(),
      ).toEqual([
        "GET /api/v1/report-definitions",
        "GET /api/v1/transformations/:transformationId/report-snapshots",
        "GET /api/v1/transformations/:transformationId/report-snapshots/:snapshotId",
        "GET /api/v1/transformations/:transformationId/report-snapshots/:snapshotId/evidence",
        "GET /api/v1/transformations/:transformationId/report-snapshots/:snapshotId/sources",
        "GET /api/v1/transformations/:transformationId/report-snapshots/:snapshotId/versions",
        "GET /api/v1/transformations/:transformationId/reports/:definitionCode/live",
        "POST /api/v1/transformations/:transformationId/report-snapshots/:snapshotId/discard",
        "POST /api/v1/transformations/:transformationId/report-snapshots/:snapshotId/issue",
        "POST /api/v1/transformations/:transformationId/report-snapshots/:snapshotId/reissue",
        "POST /api/v1/transformations/:transformationId/reports/:definitionCode/generate",
      ]);
    } finally {
      await pool.end();
    }
  });
});

// T-B8 (T-DG7-BE-B; ADR-0069 §2; p7-work-split §B.4): the server built by buildServer wires the REAL probes into
// /readyz (evidence/readiness.ts and operations/heartbeat.ts readWorkerHeartbeat). No database: a fake pool answers
// the readiness queries (UTF8, no migration table with no shipped files, no storage_setting row, no worker beat), so
// the filesystem store of the test configuration (a fresh directory) is `ok`, no beat is `unknown`, and the answer
// is 200 ready (the worker never gates).
describe("T-B8: /readyz wiring of the storage and worker probes", () => {
  it("filesystem store -> storage: ok; no beat -> worker: unknown; 200", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "mth-readyz-"));
    const seen: string[] = [];
    const client = {
      query: async (text: string | { text: string }) => {
        const q = typeof text === "string" ? text : text.text;
        seen.push(q);
        if (q === "SHOW server_encoding") return { rows: [{ server_encoding: "UTF8" }] };
        if (q.includes("to_regclass")) return { rows: [{ exists: false }] };
        if (/now\(\) AS now/i.test(q)) return { rows: [{ now: new Date() }], command: "SELECT", rowCount: 1 };
        if (q.includes('"storage_setting"') || q.includes('"worker_heartbeat"'))
          return { rows: [], command: "SELECT", rowCount: 0 };
        return { rows: [{ "?column?": 1 }], command: "SELECT", rowCount: 1 };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client, on: () => pool, end: async () => undefined } as unknown as Parameters<
      typeof buildServer
    >[0]["pool"];
    const config = loadConfig("api", { ...base, AUTH_MODE: "dev", EVIDENCE_STORAGE_PATH: dir });
    const { app } = await buildServer({ config, pool, logger: false, webRoot: null, migrationFiles: [] });
    try {
      const res = await app.inject({ method: "GET", url: "/readyz" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({
        status: "ready",
        checks: { database: "ok", migrations: "ok", storage: "ok", worker: "unknown" },
      });
      // The real probes ran: the storage setting and the heartbeat table were both read.
      expect(seen.some((q) => q.includes('"storage_setting"'))).toBe(true);
      expect(seen.some((q) => q.includes('"worker_heartbeat"'))).toBe(true);
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
