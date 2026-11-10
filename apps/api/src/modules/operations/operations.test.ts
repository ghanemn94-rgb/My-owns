// operations module suite (P6; T-DG6-BE-A created the module, p6-plan §3 seam 21). The owning tasks add their behaviour
// tests here and under test/integration/operations/. Until then: the module wires every route file through its hook, and
// reports "scaffold" while no route exists (a route-free module promises no behaviour).
import { readdirSync } from "node:fs";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { heartbeatState, registerOperationsModule } from "./index.ts";

describe("operations module (P6)", () => {
  it("registers through its hook and reports its registration", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerOperationsModule(app, {} as ModuleDeps);
      expect(registration.module).toBe("operations");
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

// T-DG6-BE-K (ADR-0053 §6): the heartbeat rule. `unknown` and `stale` are never `alive`.
describe("heartbeatState (ADR-0053 §6)", () => {
  const now = new Date("2026-10-29T12:00:00.000Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);

  it("is unknown with no beat, alive up to 90 s, stale after", () => {
    expect(heartbeatState(null, now)).toBe("unknown");
    expect(heartbeatState(ago(0), now)).toBe("alive");
    expect(heartbeatState(ago(90), now)).toBe("alive");
    expect(heartbeatState(ago(91), now)).toBe("stale");
    expect(heartbeatState(ago(3600), now)).toBe("stale");
  });

  it("registers the five BE-K routes", async () => {
    const app = Fastify({ logger: false });
    try {
      const registration = registerOperationsModule(app, {} as ModuleDeps);
      expect(registration.status).toBe("active");
      expect([...registration.routes].sort()).toEqual(
        [
          "GET /api/v1/admin/operations/exceptions",
          "GET /api/v1/admin/operations/exceptions/:exceptionId",
          "GET /api/v1/admin/operations/heartbeat",
          "POST /api/v1/admin/operations/exceptions/:exceptionId/acknowledge",
          "POST /api/v1/admin/operations/exceptions/:exceptionId/resolve",
        ].sort(),
      );
    } finally {
      await app.close();
    }
  });
});
