// The worker's demo-reset settings (T-DG5-BE-T4; BE-T3 handback §6.4; D-165): the in-app reset uses the same dev-issuer
// binding rule as `mth-db reset-demo` (`demoDevIssuerBindingAllowed`: AUTH_MODE=dev, never NODE_ENV=production), so a
// dev-mode demo database keeps its dev sign-in after an in-app reset; in every other mode nothing is bound. The
// pass-through to resetDemo against a real database: apps/worker/test/integration/demo-reset-dev-binding.test.ts.
// Every URL here is SYNTHETIC; nothing connects, and nothing here approves anything.
import { describe, expect, it } from "vitest";
import { demoResetSettingsFromEnv } from "./demo.ts";

const base = {
  DATABASE_URL: "postgres://mth_app@127.0.0.1:5432/mth_demo",
  MTH_ENV: "demo",
  MTH_DEMO_ADMIN_DATABASE_URL: "postgres://mth_admin@127.0.0.1:5432/postgres",
};

describe("demoResetSettingsFromEnv", () => {
  it("binds the dev issuer in a dev-mode stack (AUTH_MODE=dev, NODE_ENV not production)", () => {
    for (const NODE_ENV of ["development", "test"]) {
      const s = demoResetSettingsFromEnv({ ...base, NODE_ENV, AUTH_MODE: "dev" });
      expect(s.devIssuerBinding, NODE_ENV).toBe(true);
      expect([s.mthEnv, s.adminUrl, s.databaseUrl]).toEqual([
        "demo",
        base.MTH_DEMO_ADMIN_DATABASE_URL,
        base.DATABASE_URL,
      ]);
    }
  });

  it("binds nothing without AUTH_MODE=dev", () => {
    expect(demoResetSettingsFromEnv({ ...base, NODE_ENV: "development" }).devIssuerBinding).toBe(false);
    expect(demoResetSettingsFromEnv({ ...base, NODE_ENV: "development", AUTH_MODE: "oidc" }).devIssuerBinding).toBe(
      false,
    );
    expect(demoResetSettingsFromEnv({ ...base, NODE_ENV: "production" }).devIssuerBinding).toBe(false);
  });
});
