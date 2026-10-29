import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  HEARTBEAT_INTERVAL_SECONDS,
  isLoopbackHost,
  loadConfig,
  secureOriginAllowed,
  SUPERVISE_INTERVAL_SECONDS,
} from "./index.ts";

const base = {
  NODE_ENV: "test",
  APP_BASE_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://mth_app:x@127.0.0.1:5432/mth",
  AUTH_MODE: "dev",
};

function problemsOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  throw new Error("expected ConfigError");
}

describe("loadConfig", () => {
  it("applies catalogue defaults (Asia/Riyadh, SAR, session limits, rate limits)", () => {
    const c = loadConfig("api", base);
    expect(c.defaultTimezone).toBe("Asia/Riyadh");
    expect(c.defaultCurrency).toBe("SAR");
    expect(c.port).toBe(3000);
    expect(c.session).toEqual({ idleMinutes: 30, absoluteHours: 10 });
    expect(c.rateLimit).toEqual({ perMinute: 300, authPerMinute: 20 });
    expect(c.productName).toBe("Mobily Transformation Hub");
    expect(c.oidc).toBeNull();
    expect(c.appBaseUrl?.origin).toBe("http://localhost:3000");
  });

  describe("WORKER_SUPERVISE_INTERVAL_SECONDS (F-DG4-128: pg-boss gives supervision no default cadence)", () => {
    const worker = { NODE_ENV: "test", DATABASE_URL: base.DATABASE_URL };

    it("defaults to the 60 s cadence pg-boss documents when unset or empty", () => {
      expect(SUPERVISE_INTERVAL_SECONDS).toEqual({ min: 1, max: 600, default: 60 });
      expect(loadConfig("worker", worker).worker).toEqual({ superviseIntervalSeconds: 60, heartbeatSeconds: 30 });
      expect(loadConfig("worker", { ...worker, WORKER_SUPERVISE_INTERVAL_SECONDS: "" }).worker).toEqual({
        superviseIntervalSeconds: 60,
        heartbeatSeconds: 30,
      });
    });

    it.each([
      ["1", 1],
      ["17", 17],
      ["600", 600],
    ])("accepts %s (inside 1-600)", (value, expected) => {
      const c = loadConfig("worker", { ...worker, WORKER_SUPERVISE_INTERVAL_SECONDS: value });
      expect(c.worker.superviseIntervalSeconds).toBe(expected);
      expect(Number.isFinite(c.worker.superviseIntervalSeconds)).toBe(true);
    });

    it.each(["0", "-5", "601", "86400", "1.5", "NaN", "abc", "Infinity"])(
      "refuses %s, naming the variable",
      (value) => {
        const problems = problemsOf(() =>
          loadConfig("worker", { ...worker, WORKER_SUPERVISE_INTERVAL_SECONDS: value }),
        );
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/^WORKER_SUPERVISE_INTERVAL_SECONDS is invalid/);
      },
    );
  });

  describe("WORKER_HEARTBEAT_SECONDS (ADR-0053 §6; T-DG6-DO-D)", () => {
    const worker = { NODE_ENV: "test", DATABASE_URL: base.DATABASE_URL };

    it("defaults to 30 s and accepts 1-30", () => {
      expect(HEARTBEAT_INTERVAL_SECONDS).toEqual({ min: 1, max: 30, default: 30 });
      expect(loadConfig("worker", worker).worker.heartbeatSeconds).toBe(30);
      expect(loadConfig("worker", { ...worker, WORKER_HEARTBEAT_SECONDS: "1" }).worker.heartbeatSeconds).toBe(1);
      expect(loadConfig("worker", { ...worker, WORKER_HEARTBEAT_SECONDS: "15" }).worker.heartbeatSeconds).toBe(15);
    });

    it.each(["0", "31", "90", "1.5", "abc"])("refuses %s, naming the variable", (value) => {
      const problems = problemsOf(() => loadConfig("worker", { ...worker, WORKER_HEARTBEAT_SECONDS: value }));
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/^WORKER_HEARTBEAT_SECONDS is invalid/);
    });
  });

  it("refuses AUTH_MODE=dev with NODE_ENV=production (ADR-0005)", () => {
    const problems = problemsOf(() => loadConfig("api", { ...base, NODE_ENV: "production" }));
    expect(problems).toContain("AUTH_MODE=dev is refused when NODE_ENV=production");
  });

  it("requires OIDC settings when AUTH_MODE=oidc for the api", () => {
    const problems = problemsOf(() => loadConfig("api", { ...base, AUTH_MODE: "oidc" }));
    expect(problems.join("\n")).toMatch(/OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET are required/);
  });

  describe("APP_BASE_URL in production (F-DG1-112: Secure + __Host- session cookies cannot be silently lost)", () => {
    const prod = {
      ...base,
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: "https://idp.example.internal/realms/mth",
      OIDC_CLIENT_ID: "mth",
      OIDC_CLIENT_SECRET: "s",
    };
    const message =
      "APP_BASE_URL must use https when NODE_ENV=production (plain http is accepted only for a loopback host: " +
      "localhost, 127.0.0.1 or [::1])";

    it.each(["http://hub.example.internal", "http://10.0.0.5:3000", "http://hub.localhost.example.com"])(
      "refuses a plain-http origin %s at startup",
      (url) => {
        expect(problemsOf(() => loadConfig("api", { ...prod, APP_BASE_URL: url }))).toContain(message);
      },
    );

    it.each(["https://hub.example.internal", "http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])(
      "accepts %s (https, or plain http only on a loopback host)",
      (url) => {
        expect(loadConfig("api", { ...prod, APP_BASE_URL: url }).appBaseUrl?.origin).toBe(new URL(url).origin);
      },
    );

    it("leaves non-production environments unchanged (http allowed)", () => {
      expect(loadConfig("api", { ...base, APP_BASE_URL: "http://hub.example.internal" }).appBaseUrl?.protocol).toBe(
        "http:",
      );
    });

    it("exposes the same rule for the API session setup (defence in depth)", () => {
      expect(secureOriginAllowed(new URL("http://hub.example.internal"), "production")).toBe(false);
      expect(secureOriginAllowed(new URL("http://hub.example.internal"), "development")).toBe(true);
      expect(secureOriginAllowed(new URL("https://hub.example.internal"), "production")).toBe(true);
      expect(isLoopbackHost(new URL("http://LOCALHOST:8080"))).toBe(true);
      expect(isLoopbackHost(new URL("http://localhost.evil.example"))).toBe(false);
    });
  });

  it("requires https issuers in production", () => {
    const problems = problemsOf(() =>
      loadConfig("api", {
        ...base,
        NODE_ENV: "production",
        AUTH_MODE: "oidc",
        APP_BASE_URL: "https://hub.example.internal",
        OIDC_ISSUER_URL: "http://idp.example.internal/realms/mth",
        OIDC_CLIENT_ID: "mth",
        OIDC_CLIENT_SECRET: "s",
      }),
    );
    expect(problems).toContain("OIDC_ISSUER_URL must use https when NODE_ENV=production");
  });

  it("reports missing required variables per service without echoing values", () => {
    const problems = problemsOf(() => loadConfig("api", { NODE_ENV: "test", DATABASE_URL: "not a url" }));
    expect(problems).toContain("APP_BASE_URL is required for api");
    expect(problems.join("\n")).toMatch(/DATABASE_URL is invalid/);
    expect(problems.join("\n")).not.toContain("not a url");
    // The db CLI needs the owner URL, not the app URL or the base URL.
    const cli = problemsOf(() => loadConfig("db-cli", { NODE_ENV: "test" }));
    expect(cli).toEqual(["DATABASE_OWNER_URL is required for db-cli"]);
  });

  it("reads secrets from *_FILE and refuses both forms at once", () => {
    const dir = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "cfg-"));
    const file = join(dir, "db-url");
    writeFileSync(file, "postgresql://mth_app:fromfile@127.0.0.1:5432/mth\n");
    const { DATABASE_URL: _omit, ...rest } = base;
    const c = loadConfig("api", { ...rest, DATABASE_URL_FILE: file });
    expect(c.databaseUrl).toBe("postgresql://mth_app:fromfile@127.0.0.1:5432/mth");
    const problems = problemsOf(() => loadConfig("api", { ...base, DATABASE_URL_FILE: file }));
    expect(problems).toContain("DATABASE_URL and DATABASE_URL_FILE are both set; set only one");
  });

  it("validates time zone, currency, base URL shape and numeric ranges", () => {
    const problems = problemsOf(() =>
      loadConfig("api", {
        ...base,
        DEFAULT_TIMEZONE: "Mars/Olympus",
        DEFAULT_CURRENCY: "sar",
        APP_BASE_URL: "http://localhost:3000/app",
        SESSION_IDLE_MINUTES: "0",
      }),
    );
    expect(problems.some((p) => p.startsWith("DEFAULT_TIMEZONE is invalid"))).toBe(true);
    expect(problems.some((p) => p.startsWith("DEFAULT_CURRENCY is invalid"))).toBe(true);
    expect(problems.some((p) => p.startsWith("APP_BASE_URL is invalid"))).toBe(true);
    expect(problems.some((p) => p.startsWith("SESSION_IDLE_MINUTES is invalid"))).toBe(true);
  });

  it("parses TRUST_PROXY as a list", () => {
    expect(loadConfig("api", { ...base, TRUST_PROXY: "10.0.0.1, 10.0.0.2" }).trustProxy).toEqual([
      "10.0.0.1",
      "10.0.0.2",
    ]);
  });
});

// T-DG5-BE-S (ADR-0050 §1, §6; D-142 Q7): the deployment environment and the demo reset's admin URL.
describe("MTH_ENV and MTH_DEMO_ADMIN_DATABASE_URL (ADR-0050)", () => {
  const prodBase = {
    ...base,
    NODE_ENV: "production",
    AUTH_MODE: "oidc",
    APP_BASE_URL: "https://hub.example.invalid",
    OIDC_ISSUER_URL: "https://idp.example.invalid/realms/mth",
    OIDC_CLIENT_ID: "mth",
    OIDC_CLIENT_SECRET: "synthetic-test-value",
  };

  it("defaults to production when NODE_ENV=production, else to the NODE_ENV value", () => {
    expect(loadConfig("api", prodBase).mthEnv).toBe("production");
    expect(loadConfig("api", base).mthEnv).toBe("test");
    expect(loadConfig("api", { ...base, NODE_ENV: "development" }).mthEnv).toBe("development");
    expect(loadConfig("db-cli", { NODE_ENV: "production", DATABASE_OWNER_URL: "postgres://o@h/d" }).mthEnv).toBe(
      "production",
    );
  });

  it("an explicit value wins, including demo on a production build (the demo deployment)", () => {
    expect(loadConfig("api", { ...prodBase, MTH_ENV: "demo" }).mthEnv).toBe("demo");
    expect(loadConfig("worker", { ...base, MTH_ENV: "production" }).mthEnv).toBe("production");
  });

  it("refuses an unknown value, naming the variable", () => {
    expect(problemsOf(() => loadConfig("api", { ...base, MTH_ENV: "staging" }))).toEqual([
      expect.stringMatching(/^MTH_ENV is invalid/),
    ]);
  });

  it("the demo admin URL is optional, must be a postgres URL, and is a secret (never in the error text)", () => {
    expect(loadConfig("worker", base).demoAdminDatabaseUrl).toBeNull();
    const url = "postgresql://mth_demo_admin:pw@127.0.0.1:5432/postgres";
    expect(loadConfig("worker", { ...base, MTH_DEMO_ADMIN_DATABASE_URL: url }).demoAdminDatabaseUrl).toBe(url);
    const problems = problemsOf(() =>
      loadConfig("worker", { ...base, MTH_DEMO_ADMIN_DATABASE_URL: "http://x/secret" }),
    );
    expect(problems).toEqual([expect.stringMatching(/^MTH_DEMO_ADMIN_DATABASE_URL is invalid/)]);
    expect(problems.join("\n")).not.toContain("secret");
    const dir = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "cfg-"));
    const file = join(dir, "demo-admin-url");
    writeFileSync(file, `${url}\n`);
    expect(
      loadConfig("db-cli", { NODE_ENV: "test", DATABASE_OWNER_URL: url, MTH_DEMO_ADMIN_DATABASE_URL_FILE: file })
        .demoAdminDatabaseUrl,
    ).toBe(url);
  });
});
