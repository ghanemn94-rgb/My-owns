// automation module suite (P5; T-DG5-BE-A created the module, p5-plan §3 seam 24). The owning tasks add their behaviour
// tests here and under test/integration/automation/. Until then: the module wires every route file through its hook, and
// reports "scaffold" while no route exists (a route-free module promises no behaviour).
import { readdirSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { registerAutomationModule } from "./index.ts";

describe("automation module (P5)", () => {
  it("registers through its hook and reports its registration", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerAutomationModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("automation");
      expect(registration.deliversIn).toBe("P5");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
    } finally {
      await app.close();
    }
  });

  it("has its route files in place (2 created by T-DG5-BE-A, p5-plan §5.1)", () => {
    const files = readdirSync(new URL(".", import.meta.url)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length - 1).toBeGreaterThanOrEqual(2);
  });
});
