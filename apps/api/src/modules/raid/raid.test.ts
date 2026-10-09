// raid module suite (P4; T-DG4-BE-A created the module, p4-plan §2 seam 19). The owning tasks add their behaviour
// tests here and under test/integration/raid/. Until then: the module wires every route file through its hook, and
// reports "scaffold" while no route exists (a route-free module promises no behaviour).
import { readdirSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { registerRaidModule } from "./index.ts";

describe("raid module (P4)", () => {
  it("registers through its hook and reports its registration", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerRaidModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("raid");
      expect(registration.deliversIn).toBe("P4");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
    } finally {
      await app.close();
    }
  });

  it("has its route files in place (1 created by T-DG4-BE-A, p4-plan §5.1)", () => {
    const files = readdirSync(new URL(".", import.meta.url), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts" && f !== "routes.ts");
    expect(
      files.length + (readdirSync(new URL(".", import.meta.url)).includes("routes.ts") ? 1 : 0),
    ).toBeGreaterThanOrEqual(1);
  });
});
