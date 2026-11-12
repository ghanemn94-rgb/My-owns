// release module suite (P7; T-DG7-BE-A created the module, p7-plan §2, §5.1). T-DG7-BE-H adds its behaviour tests here
// and under test/integration/release/. Until then: the module wires its route file through its hook and reports
// "scaffold" while no route exists (a route-free module promises no behaviour).
import { readdirSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { registerReleaseModule } from "./index.ts";

describe("release module (P7)", () => {
  it("registers through its hook and reports its registration (a scaffold while no route exists)", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerReleaseModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("release");
      expect(registration.deliversIn).toBe("P7");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
      await app.ready();
      expect(app.printRoutes().includes("/api/v1/admin/")).toBe(registration.routes.length > 0);
    } finally {
      await app.close();
    }
  });

  it("has its route file in place (created by T-DG7-BE-A, p7-plan §5.1)", () => {
    expect(readdirSync(new URL(".", import.meta.url))).toContain("routes.ts");
  });
});
