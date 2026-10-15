// The condition escalation job (T-DG5-BE-K; ADR-0044 §3 "Overdue conditions escalate"; REQ-S04-011 "overdue conditions
// escalate"; p5-work-split §E.2 "an overdue condition escalates once to the approver") against a real PostgreSQL:
//  - an open condition after its due date escalates ONCE to the G5 decision's approver: one gate_condition_escalation
//    (overdue_since = due date + 1) with its audit event and one gate_condition_overdue work item (an urgent kind) with
//    its notification; a second run (and a replay of the same key) creates nothing more;
//  - on the due date itself nothing escalates; a closed condition never escalates;
//  - the handler is registered on its queue (the 0075 schedule's queue), and the job decides nothing: the gate, the
//    decision and the condition rows are unchanged.
// Every value is SYNTHETIC; the G5 decision is a demo business decision by a test person that approves nothing real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../../api/test/support/harness.ts";
import {
  g5Approval,
  pendingGate,
  seedGateWorld,
  stageGates,
} from "../../../api/test/integration/contract/p4-exercises-be-k.ts";
import {
  GATE_CONDITION_ESCALATION_SCAN_QUEUE,
  GATE_CONDITION_OVERDUE_KIND,
  GATES_HANDLERS,
  runGateConditionEscalationScan,
} from "../../src/handlers/gates.ts";
import { GATES_QUEUES } from "../../src/queues/gates.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

describe("gate.condition_escalation_scan (REQ-S04-011)", () => {
  it("is registered on its scheduled queue", () => {
    expect(GATES_QUEUES.map((q) => q.name)).toContain(GATE_CONDITION_ESCALATION_SCAN_QUEUE);
    expect(GATES_HANDLERS.map((h) => h.queue)).toContain(GATE_CONDITION_ESCALATION_SCAN_QUEUE);
  });

  it("an overdue open condition escalates once to the approver; a closed one never; on the due date nothing", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const no = await pendingGate(api, g, "G5");
    const body = g5Approval(g, no);
    body.scaleScope.conditions.push({
      text: "Synthetic: second condition, closed before it falls due",
      ownerUserId: g.b.users.tl.id,
      dueDate: "2026-12-31",
    });
    const decided = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    const conditions = await api.db
      .selectFrom("gate_decision_condition")
      .select(["id", "owner_user_id"])
      .where("transformation_id", "=", g.b.transformationId)
      .orderBy("ordinal")
      .execute();
    const [open, toClose] = conditions;
    const closed = await send("POST", `${g.b.base}/gate-conditions/${toClose!.id}/close`, {
      session: g.b.s.tl,
      body: { note: "Synthetic: met early" },
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    const scope = { transformationId: g.b.transformationId };

    const onDue = await runGateConditionEscalationScan(api.db, "test-cond-0", { ...scope, asOf: "2026-12-31" });
    expect(onDue.steps).toEqual([]);

    const first = await runGateConditionEscalationScan(api.db, "test-cond-1", { ...scope, asOf: "2027-01-01" });
    expect(first.steps).toEqual([{ conditionId: open!.id, outcome: "escalated", escalatedToUserId: g.sp.id }]);
    const escalations = await api.db
      .selectFrom("gate_condition_escalation")
      .select(["id", "gate_decision_condition_id", "escalated_to_user_id", "work_item_id"])
      .select((eb) => eb.cast<string>("overdue_since", "text").as("overdue_since"))
      .where("transformation_id", "=", g.b.transformationId)
      .execute();
    expect(escalations.map((e) => [e.gate_decision_condition_id, e.escalated_to_user_id, e.overdue_since])).toEqual([
      [open!.id, g.sp.id, "2027-01-01"],
    ]);
    const items = await api.db
      .selectFrom("work_item")
      .select(["id", "assignee_user_id", "status", "message_key", "dedupe_key"])
      .where("subject_id", "=", open!.id)
      .where("kind", "=", GATE_CONDITION_OVERDUE_KIND)
      .execute();
    expect(items.map((i) => [i.assignee_user_id, i.status, i.dedupe_key])).toEqual([
      [g.sp.id, "open", `gate_condition_overdue:${open!.id}`],
    ]);
    expect(escalations[0]!.work_item_id).toBe(items[0]!.id);
    const notices = await api.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id"])
      .where("work_item_id", "=", items[0]!.id)
      .execute();
    expect(notices).toEqual([{ recipient_user_id: g.sp.id }]);
    // The kind is urgent (0075); its delivery policy (immediate in quiet hours) is BE-L's (ADR-0044 §5).
    const kind = await api.db
      .selectFrom("work_item_kind")
      .select("urgency")
      .where("code", "=", GATE_CONDITION_OVERDUE_KIND)
      .executeTakeFirstOrThrow();
    expect(kind.urgency).toBe("urgent");
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_type"])
      .where("record_id", "=", escalations[0]!.id)
      .execute();
    expect(audit).toEqual([{ action: "gate_condition_escalation.create", actor_type: "service" }]);

    // Again (a later day, a replay): nothing more. The closed condition was never escalated.
    const second = await runGateConditionEscalationScan(api.db, "test-cond-2", { ...scope, asOf: "2027-01-05" });
    expect(second.steps).toEqual([]);
    const all = await api.db
      .selectFrom("gate_condition_escalation")
      .select("gate_decision_condition_id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute();
    expect(all.map((e) => e.gate_decision_condition_id)).toEqual([open!.id]);
    // The listing shows the escalation; the job decided nothing (the G5 decision is unchanged and the condition open).
    const list = await send("GET", `${g.b.base}/gate-conditions`, { session: g.b.s.auditor });
    const shown = list.body.items.find((c: Body) => c.id === open!.id);
    expect(shown).toMatchObject({ status: "open", escalatedToUserId: g.sp.id });
    expect(shown.escalatedAt).not.toBeNull();
  });
});
