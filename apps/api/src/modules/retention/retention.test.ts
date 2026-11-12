// retention module suite (P7; T-DG7-BE-A created the module, p7-plan §2, §5.1). T-DG7-BE-G adds its behaviour tests
// here and under test/integration/retention/. Until then: the module wires every route file through its hook, reports
// "scaffold" while no route exists, and its guard tables use exactly the slice E codes.
import { readdirSync } from "node:fs";
import { P7_RETENTION_PERMISSIONS } from "@mth/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { registerRetentionModule, RETENTION_ROUTE_GUARDS } from "./index.ts";

describe("retention module (P7)", () => {
  it("registers through its hook and reports its registration (a scaffold while no route exists)", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerRetentionModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("retention");
      expect(registration.deliversIn).toBe("P7");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
      await app.ready();
      expect(app.printRoutes().includes("/api/v1/admin/")).toBe(registration.routes.length > 0);
    } finally {
      await app.close();
    }
  });

  it("has its three route files in place (created by T-DG7-BE-A, p7-work-split §E.7)", () => {
    for (const dir of ["classes", "runs", "backups"])
      expect(readdirSync(new URL(`./${dir}/`, import.meta.url)), dir).toContain("routes.ts");
  });

  it("guards its 10 operations with the slice E codes only, and uses every one of them (ADR-0067 §8, ADR-0066 §6)", () => {
    const guards = Object.values(RETENTION_ROUTE_GUARDS);
    expect(Object.keys(RETENTION_ROUTE_GUARDS)).toHaveLength(10);
    expect([...new Set(guards.map((g) => g.permission))].sort()).toEqual(Object.keys(P7_RETENTION_PERMISSIONS).sort());
    expect(new Set(guards.map((g) => `${g.method} ${g.path}`)).size).toBe(guards.length);
    // The only writes (configure a class, request a run) need a configure-category code; reads need a read code.
    const categories = new Map<string, string>(Object.entries(P7_RETENTION_PERMISSIONS));
    for (const [operationId, g] of Object.entries(RETENTION_ROUTE_GUARDS))
      expect(categories.get(g.permission), operationId).toBe(g.method === "GET" ? "read" : "configure");
  });
});
