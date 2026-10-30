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
      // Registration touches no database; the setting routes read only config.nodeEnv at registration.
      const registration = registerAssistantModule(app, {
        db: {},
        config: { nodeEnv: "test" },
      } as unknown as ModuleDeps);
      expect(registration.module).toBe("assistant");
      expect(registration.deliversIn).toBe("P6");
      expect(registration.status).toBe(registration.routes.length > 0 ? "active" : "scaffold");
      // T-DG6-BE-T: the eight setting and conversation routes (ADR-0059 §3, §9); BE-U adds the to-draft route.
      expect(registration.status).toBe("active");
      expect([...registration.routes].sort()).toEqual([
        "GET /api/v1/admin/assistant",
        "GET /api/v1/assistant/conversations",
        "GET /api/v1/assistant/conversations/:conversationId",
        "POST /api/v1/admin/assistant/disable",
        "POST /api/v1/admin/assistant/enable",
        "POST /api/v1/assistant/conversations",
        "POST /api/v1/assistant/conversations/:conversationId/messages",
        "PUT /api/v1/admin/assistant",
      ]);
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
