// retention module suite (P7; T-DG7-BE-A created the module, p7-plan §2, §5.1). T-DG7-BE-G routed its 10 operations:
// the module wires every route file through its hook and reports "active", its guard tables use exactly the slice E
// codes, and the E.5 refusal order is pinned here; the behaviour tests are under test/integration/retention/.
import { readdirSync } from "node:fs";
import { P7_RETENTION_PERMISSIONS } from "@mth/shared";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { classRefusal } from "./classes/service.ts";
import { registerRetentionModule, RETENTION_ROUTE_GUARDS } from "./index.ts";

describe("retention module (P7)", () => {
  it("registers through its hook and reports its registration (active: T-DG7-BE-G routed all 10 operations)", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerRetentionModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("retention");
      expect(registration.deliversIn).toBe("P7");
      expect(registration.status).toBe("active");
      await app.ready();
      // Every guard's method and path is a registered route, and the registration lists exactly those.
      const guards = Object.values(RETENTION_ROUTE_GUARDS);
      expect([...registration.routes].sort()).toEqual(guards.map((g) => `${g.method} ${g.path}`).sort());
      for (const g of guards)
        expect(app.hasRoute({ method: g.method, url: g.path }), `${g.method} ${g.path}`).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("classRefusal: the E.5 codes in order (retain-only, not-archivable, period, reference); `retain` is always allowed", () => {
    const op = { category: "operational", managed_by_job: null };
    const purgeable = [{ age_column: "processed_at", purge_eligible: true }];
    const ok = { action: "archive" as const, periodDays: 30, itApprovalReference: "TEST-ONLY ref" };
    const code = (c: typeof op, t: typeof purgeable, b: Parameters<typeof classRefusal>[2]) =>
      classRefusal(c, t, b)?.code ?? null;
    expect(code({ category: "business", managed_by_job: null }, [], { ...ok, action: "retain" })).toBeNull();
    expect(code({ category: "business", managed_by_job: null }, purgeable, ok)).toBe("retention.class_retain_only");
    expect(code({ category: "operational", managed_by_job: "platform.purge-expired" } as never, purgeable, ok)).toBe(
      "retention.class_retain_only",
    );
    expect(code(op, [{ age_column: null, purge_eligible: false }] as never, ok)).toBe("retention.class_not_archivable");
    expect(
      code(op, [{ age_column: "finished_at", purge_eligible: false }], { ...ok, action: "archive_then_purge" }),
    ).toBe("retention.class_not_archivable");
    expect(code(op, purgeable, { ...ok, periodDays: null })).toBe("retention.class_period_required");
    expect(code(op, purgeable, { ...ok, itApprovalReference: null })).toBe("retention.class_reference_required");
    expect(code(op, purgeable, { ...ok, action: "archive_then_purge" })).toBeNull();
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
