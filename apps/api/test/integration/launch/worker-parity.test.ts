// Parity of the worker's launch-plan generator with the API's (T-DG5-BE-P; ADR-0044 §1-§2, ADR-0048 §1; the
// worker-twin precedent of apps/worker/src/automation/actions/common.ts). Starter 1 runs in the worker, which imports
// no API code, so the worker has its own generator: for the same start date it must write the same plan, the same 33
// tasks and the same Day-90 test as the API generator, with one audit event per row, and a replay must write nothing.
// All data is SYNTHETIC; nothing here is a business approval.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workerLaunchPlanGenerator } from "../../../../worker/src/automation/ports/launch-plan-generator.ts";
import { launchPlanGenerator } from "../../../src/modules/launch/port.ts";
import { seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { setupP2World } from "../../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

async function snapshot(transformationId: string) {
  const plan = await api.db
    .selectFrom("launch_plan")
    .select(["id", "start_date", "template_ref", "generated_via", "idempotency_key", "version", "created_by"])
    .where("transformation_id", "=", transformationId)
    .executeTakeFirstOrThrow();
  const tasks = await api.db
    .selectFrom("launch_task")
    .select([
      "id",
      "ordinal",
      "template_item_code",
      "window_code",
      "task_kind",
      "title",
      "notes",
      "start_date",
      "due_date",
      "owner_user_id",
      "status",
      "output_record_type",
      "output_record_id",
      "version",
      "created_by",
    ])
    .where("plan_id", "=", plan.id)
    .orderBy("ordinal")
    .execute();
  const test = await api.db
    .selectFrom("day_ninety_test")
    .select(["id", "scheduled_date", "status", "answered_count", "version", "created_by"])
    .where("plan_id", "=", plan.id)
    .executeTakeFirstOrThrow();
  const audit = await api.db
    .selectFrom("audit_event")
    .select(["record_type", "action", "new_version", "actor_type", "on_behalf_of_user_id", "changes"])
    .where("transformation_id", "=", transformationId)
    .where("record_type", "in", ["launch_plan", "launch_task", "day_ninety_test"])
    .orderBy("seq")
    .execute();
  const strip = <T extends { id: string }>({ id: _id, ...rest }: T) => rest;
  return {
    plan: strip(plan),
    tasks: tasks.map(strip),
    test: strip(test),
    audit: audit.map((a) => ({ ...a, changes: a.changes })),
  };
}

describe("the worker launch-plan generator (parity with the API generator)", () => {
  it("writes the same plan, tasks, test and audit events; a replay writes nothing", async () => {
    const viaApi = await setupP2World(api, w);
    const viaWorker = await setupP2World(api, w);
    const request = (t: string) => ({
      transformationId: t,
      startDate: "2026-10-01",
      idempotencyKey: `launch_plan:${t}`,
    });
    const a = await api.db
      .transaction()
      .execute((tx) => launchPlanGenerator.generate(tx, request(viaApi.transformationId)));
    const outcomes = [];
    for (let i = 0; i < 3; i += 1)
      outcomes.push(
        await api.db
          .transaction()
          .execute((tx) =>
            workerLaunchPlanGenerator.generate(tx, { ...request(viaWorker.transformationId), jobId: `parity-${i}` }),
          ),
      );
    expect([a.outcome, ...outcomes.map((o) => o.outcome)]).toEqual(["created", "created", "existing", "existing"]);
    const left = await snapshot(viaApi.transformationId);
    const right = await snapshot(viaWorker.transformationId);
    const neutral = (s: typeof left, t: string, creator: string) =>
      JSON.parse(JSON.stringify(s).replaceAll(t, "<T>").replaceAll(creator, "<CREATOR>"));
    expect(neutral(right, viaWorker.transformationId, viaWorker.lead.id)).toEqual(
      neutral(left, viaApi.transformationId, viaApi.lead.id),
    );
    expect(right.tasks).toHaveLength(33);
    expect(right.audit).toHaveLength(35);
    const sources = await api.db
      .selectFrom("audit_event")
      .select(["source", "request_id"])
      .where("transformation_id", "=", viaWorker.transformationId)
      .where("record_type", "=", "launch_plan")
      .execute();
    expect(sources).toEqual([{ source: "worker", request_id: "job:parity-0" }]);
  });
});
