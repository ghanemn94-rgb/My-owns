import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./index.ts";

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

  it("refuses AUTH_MODE=dev with NODE_ENV=production (ADR-0005)", () => {
    const problems = problemsOf(() => loadConfig("api", { ...base, NODE_ENV: "production" }));
    expect(problems).toContain("AUTH_MODE=dev is refused when NODE_ENV=production");
  });

  it("requires OIDC settings when AUTH_MODE=oidc for the api", () => {
    const problems = problemsOf(() => loadConfig("api", { ...base, AUTH_MODE: "oidc" }));
    expect(problems.join("\n")).toMatch(/OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET are required/);
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
