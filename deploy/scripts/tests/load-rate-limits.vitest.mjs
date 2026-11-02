// The load stack's rate-limit budgets (deploy/load/rate-limits.mjs and deploy/compose/compose.load.yaml; T-DG6-DO-Y2,
// D-207). Runs in `pnpm test` (Vitest project unit-node, through the deploy/scripts/tests/**/*.vitest.mjs include). No
// database, no network, no Docker.
//
// Pins: (1) the helper raises exactly the API's own P6 class variables (RATE_LIMIT_CLASS_VARIABLES, packages/config),
// so a class added later cannot be left at its production budget in a load run unnoticed; (2) an explicit value, direct
// or through <NAME>_FILE, is kept; (3) the shell output is `export NAME=100000` lines only; (4) the Compose overlay
// sets the same five variables for the api service with the same default, and nothing else changes a limit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_CLASS_VARIABLES, loadConfig } from "../../../packages/config/src/load.ts";
import {
  LOAD_RATE_LIMIT_PER_MINUTE,
  LOAD_RATE_LIMIT_VARIABLES,
  loadRateLimitEnv,
  shellExports,
} from "../../load/rate-limits.mjs";

describe("load stack rate limits (deploy/load/rate-limits.mjs)", () => {
  it("raises exactly the API's P6 class variables, in the config's order", () => {
    expect([...LOAD_RATE_LIMIT_VARIABLES]).toEqual(Object.values(RATE_LIMIT_CLASS_VARIABLES));
    expect(LOAD_RATE_LIMIT_VARIABLES).not.toContain("RATE_LIMIT_PER_MINUTE");
    expect(LOAD_RATE_LIMIT_VARIABLES).not.toContain("AUTH_RATE_LIMIT_PER_MINUTE");
  });

  it("sets every unset class budget to the load value, and the API's configuration accepts it", () => {
    const { set, kept } = loadRateLimitEnv({});
    expect(kept).toEqual([]);
    expect(Object.keys(set)).toEqual([...LOAD_RATE_LIMIT_VARIABLES]);
    for (const v of Object.values(set)) expect(v).toBe(String(LOAD_RATE_LIMIT_PER_MINUTE));
    const env = {
      NODE_ENV: "production",
      AUTH_MODE: "oidc",
      MTH_ENV: "load",
      APP_BASE_URL: "http://localhost:3000",
      DATABASE_URL: "postgresql://mth_app@localhost:5432/mth",
      OIDC_ISSUER_URL: "https://idp.example.invalid/realms/mth-load",
      OIDC_CLIENT_ID: "mth-load",
      OIDC_CLIENT_SECRET: "not-used-load-test",
      EVIDENCE_STORAGE_DRIVER: "filesystem",
      EVIDENCE_STORAGE_PATH: "/var/lib/mth/evidence",
      ...set,
    };
    const config = loadConfig("api", env);
    expect(config.rateLimitClasses).toEqual({
      upload: LOAD_RATE_LIMIT_PER_MINUTE,
      search: LOAD_RATE_LIMIT_PER_MINUTE,
      assistant: LOAD_RATE_LIMIT_PER_MINUTE,
      webhook: LOAD_RATE_LIMIT_PER_MINUTE,
      export: LOAD_RATE_LIMIT_PER_MINUTE,
    });
    // The global and auth limits keep the product defaults (300 and 20).
    expect(config.rateLimit).toEqual({ perMinute: 300, authPerMinute: 20 });
  });

  it("keeps an explicit value, direct or through _FILE, and treats an empty value as unset", () => {
    const { set, kept } = loadRateLimitEnv({
      EXPORT_RATE_LIMIT_PER_MINUTE: "10",
      SEARCH_RATE_LIMIT_PER_MINUTE_FILE: "/run/secrets/search",
      UPLOAD_RATE_LIMIT_PER_MINUTE: "",
    });
    expect(kept).toEqual(["SEARCH_RATE_LIMIT_PER_MINUTE", "EXPORT_RATE_LIMIT_PER_MINUTE"]);
    expect(Object.keys(set)).toEqual([
      "UPLOAD_RATE_LIMIT_PER_MINUTE",
      "ASSISTANT_RATE_LIMIT_PER_MINUTE",
      "WEBHOOK_RATE_LIMIT_PER_MINUTE",
    ]);
  });

  it("prints shell export lines only", () => {
    const out = shellExports(loadRateLimitEnv({}).set);
    expect(out.split("\n")).toEqual(LOAD_RATE_LIMIT_VARIABLES.map((n) => `export ${n}=100000`));
  });

  it("the Compose load overlay sets the same five budgets for the api service, with the same default", () => {
    const yaml = readFileSync(new URL("../../compose/compose.load.yaml", import.meta.url), "utf8");
    const limits = [
      ...yaml.matchAll(/^\s+([A-Z_]+_RATE_LIMIT_PER_MINUTE): \$\{MTH_LOAD_[A-Z]+_RATE_LIMIT:-(\d+)\}$/gm),
    ];
    expect(limits.map((m) => m[1])).toEqual([...LOAD_RATE_LIMIT_VARIABLES]);
    for (const m of limits) expect(Number(m[2])).toBe(LOAD_RATE_LIMIT_PER_MINUTE);
    expect(yaml).not.toMatch(/^\s+(AUTH_)?RATE_LIMIT_PER_MINUTE:/m);
  });
});
