// tasks module suite (P4; ADR-0025 §4; T-DG4-BE-A). Pure checks of the public surface; the persistence, authorization
// and idempotency behaviour is proven against PostgreSQL in test/integration/tasks/*.test.ts.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleDeps } from "../platform/index.ts";
import { createWorkItemOnce, registerTasksModule, SYSTEM_MANAGED_KINDS, taskRefusals, toWorkItem } from "./index.ts";

describe("tasks module (P4)", () => {
  it("registers the five task and inbox operations", async () => {
    const app = Fastify({ logger: false });
    try {
      const r = registerTasksModule(app, {} as ModuleDeps);
      expect(r).toMatchObject({ module: "tasks", status: "active", deliversIn: "P4" });
      expect([...r.routes].sort()).toEqual(
        [
          "GET /api/v1/me/work-items",
          "GET /api/v1/work-items/:workItemId",
          "POST /api/v1/work-items/:workItemId/complete",
          "GET /api/v1/me/inbox",
          "POST /api/v1/me/inbox/:notificationId/read",
        ].sort(),
      );
    } finally {
      await app.close();
    }
  });

  it("approval tasks and the corrective follow-up are system managed (ADR-0025 §4, ADR-0031 §5.6)", () => {
    expect([...SYSTEM_MANAGED_KINDS].sort()).toEqual([
      "approval_decision",
      "approval_escalated",
      "corrective_case_follow_up",
    ]);
    expect(SYSTEM_MANAGED_KINDS.has("kpi_update_due")).toBe(false);
    expect(SYSTEM_MANAGED_KINDS.has("raid_action_due")).toBe(false);
  });

  it("refusals carry the ADR-0025 §4 codes and English texts", () => {
    const pick = (p: ReturnType<(typeof taskRefusals)[keyof typeof taskRefusals]>) => [p.status, p.code, p.detail];
    expect(pick(taskRefusals.notAssignee())).toEqual([
      403,
      "work_item.not_assignee",
      "Only the person this task is assigned to can complete it.",
    ]);
    expect(pick(taskRefusals.closed())).toEqual([422, "work_item.closed", "This task is already closed."]);
    expect(pick(taskRefusals.systemManaged())).toEqual([
      422,
      "work_item.system_managed",
      "This task closes automatically when the record it belongs to is decided or closed.",
    ]);
    expect(pick(taskRefusals.alreadyRead())).toEqual([
      422,
      "inbox.already_read",
      "This reminder is already marked as read.",
    ]);
  });

  it("a work item renders an i18n key and parameters, never a sentence", () => {
    const now = new Date("2026-10-09T05:00:00Z");
    const item = toWorkItem({
      id: "01920000-0000-7000-8000-000000000001",
      organization_id: "01920000-0000-7000-8000-000000000002",
      transformation_id: null,
      kind: "kpi_update_due",
      assignee_user_id: "01920000-0000-7000-8000-000000000003",
      subject_type: "kpi_definition",
      subject_id: "01920000-0000-7000-8000-000000000004",
      link_path: "/kpi/1",
      message_key: "tasks.kpi_update_due",
      message_params: { period: "2026-10" },
      due_date: null,
      period_label: "2026-10",
      status: "open",
      completed_at: null,
      completed_by: null,
      dedupe_key: "kpi.period_open:x:2026-10:y",
      created_source: "worker",
      version: 1,
      created_at: now,
      created_by: null,
      updated_at: now,
      updated_by: null,
    });
    expect(item).toMatchObject({
      messageKey: "tasks.kpi_update_due",
      messageParams: { period: "2026-10" },
      dueDate: null,
    });
  });

  it("createWorkItemOnce refuses an absolute link before touching the database", async () => {
    const input = {
      organizationId: "o",
      kind: "kpi_update_due",
      assigneeUserId: "u",
      subjectType: "kpi_definition",
      subjectId: "s",
      messageKey: "tasks.kpi_update_due",
      dedupeKey: "k",
    };
    const actor = { actorType: "service", actorUserId: null, source: "worker" } as const;
    const noTx = {} as Parameters<typeof createWorkItemOnce>[0];
    await expect(createWorkItemOnce(noTx, actor, { ...input, linkPath: "https://evil.example/" })).rejects.toThrow(
      /relative/,
    );
    await expect(createWorkItemOnce(noTx, actor, { ...input, linkPath: "//evil.example/" })).rejects.toThrow(
      /relative/,
    );
  });
});
