// assistant module suite (P6; T-DG6-BE-A created the module, p6-plan §3 seam 21). The owning tasks add their behaviour
// tests here and under test/integration/assistant/. Until then: the module wires every route file through its hook, and
// reports "scaffold" while no route exists (a route-free module promises no behaviour).
import { readdirSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { registerAssistantModule } from "./index.ts";

describe("assistant module (P6)", () => {
  it("registers through its hook and reports its registration", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerAssistantModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("assistant");
      expect(registration.deliversIn).toBe("P6");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
    } finally {
      await app.close();
    }
  });

  it("has its route files in place (1 created by T-DG6-BE-A, p6-plan §5.1)", () => {
    const files = readdirSync(new URL(".", import.meta.url)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length - 1).toBeGreaterThanOrEqual(1);
  });
});
