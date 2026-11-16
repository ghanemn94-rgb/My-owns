// transfer module suite (P7; T-DG7-BE-A created the module, p7-plan §2, §5.1). The owning tasks (BE-C, BE-D, BE-F) add
// their behaviour tests here and under test/integration/transfer/. Until then: the module wires every route file
// through its hook, reports "scaffold" while no route exists, and its guard tables use exactly the slice C/D codes.
import { readdirSync } from "node:fs";
import { P7_TRANSFER_PERMISSIONS } from "@mth/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { registerTransferModule, TRANSFER_ROUTE_GUARDS } from "./index.ts";

describe("transfer module (P7)", () => {
  it("registers through its hook and reports its registration (a scaffold while no route exists)", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerTransferModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("transfer");
      expect(registration.deliversIn).toBe("P7");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
      await app.ready();
      // A stub registers exactly the routes it reports, so a pending operation is never half-routed.
      // printRoutes() prints a radix tree, so the prefix appears without its leading slash (T-DG7-BE-C).
      expect(app.printRoutes().includes("api/v1/admin/")).toBe(registration.routes.length > 0);
    } finally {
      await app.close();
    }
  });

  it("has its three route files in place (created by T-DG7-BE-A, p7-work-split §C.7)", () => {
    for (const dir of ["export", "import", "config-bundle"])
      expect(readdirSync(new URL(`./${dir}/`, import.meta.url)), dir).toContain("routes.ts");
  });

  it("guards its 19 operations with the slice C/D codes only, and uses every one of them (ADR-0064 §9, ADR-0065 §8)", () => {
    const guards = Object.values(TRANSFER_ROUTE_GUARDS);
    expect(Object.keys(TRANSFER_ROUTE_GUARDS)).toHaveLength(19);
    expect([...new Set(guards.map((g) => g.permission))].sort()).toEqual(Object.keys(P7_TRANSFER_PERMISSIONS).sort());
    // One operation per method and path.
    expect(new Set(guards.map((g) => `${g.method} ${g.path}`)).size).toBe(guards.length);
  });
});
