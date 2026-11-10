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
        "POST /api/v1/assistant/suggestions/:suggestionId/to-draft", // T-DG6-BE-U (§6)
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

// T-DG6-BE-RG1 (F-DG6-920; ADR-0059 §5, §9): the records an answer was generated from. Pure; no database.
describe("the generation context (ADR-0059 §9 amendment; F-DG6-920)", () => {
  const r1 = "01a1c4a5-bfb0-745a-907d-f232a93be725";
  const r2 = "01a1c4a5-bfb0-745a-907d-f232a93be726";
  const record = (recordId: string) =>
    ({ source: "record", recordType: "transformation", recordId, recordVersion: 1 }) as const;
  const playbook = { source: "playbook", blockRef: "B0001", playbookVersion: "1.0" } as const;

  it("contextRecordsOf keeps every record item given (cited or not), distinct, in order; no playbook block", async () => {
    const { contextRecordsOf } = await import("./answer.ts");
    const items = [record(r1), playbook, record(r2), record(r1)].map((citation, i) => ({
      ref: i + 1,
      citation,
      title: "Synthetic title",
      text: "Synthetic text",
    }));
    expect(contextRecordsOf(items)).toEqual([
      { recordType: "transformation", recordId: r1 },
      { recordType: "transformation", recordId: r2 },
    ]);
  });

  it("recordRefsOf is the union of record citations and the stored context; NULL context falls back to citations", async () => {
    const { recordRefsOf } = await import("./conversations.ts");
    const context = [
      { recordType: "transformation", recordId: r1 },
      { recordType: "transformation", recordId: r2 },
    ];
    expect(recordRefsOf({ citations: [record(r1), playbook], context_records: context })).toEqual(context);
    expect(recordRefsOf({ citations: [record(r1), playbook], context_records: null })).toEqual([context[0]]);
    expect(recordRefsOf({ citations: [playbook], context_records: [] })).toEqual([]);
  });
});
