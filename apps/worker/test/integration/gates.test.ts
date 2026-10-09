// The gate consumers (T-DG4-BE-K; ADR-0035 §7; REQ-S12-009, REQ-S12-010) against a real PostgreSQL, driven by the
// outbox events the API wrote (as the relay would deliver them):
//  - gate.submitted: each required approver gets exactly ONE gate_decision_due task referencing the snapshot SHA-256; a
//    redelivered event creates none; a superseding submission cancels the old tasks; no approver -> one
//    routing.role_unmapped notice to the submitter;
//  - gate.decided: the decider's task is done; on approval the next phase's steps and their tasks are created once (G2
//    -> the four Design steps; redelivery: none); a G5 approval creates tasks only for its approved scope items and
//    conditions;
//  - parity (D-102): the worker's approver resolution equals the API's `canDecide` for the same people;
//  - the queue map: each gate event feeds its one gates.* queue (D-102 fan-out list).
// Synthetic data; the decisions are demo business decisions by test persons that approve nothing real. No job decides
// anything, and nothing touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../../api/test/support/harness.ts";
import {
  G1_AGREEMENTS,
  gateVersion,
  ifm,
  makeG1Ready,
  setupP2World,
  type P2World,
} from "../../../api/test/support/p2-fixtures.ts";
import { insertInitiative } from "../../../api/test/integration/benefits/fixtures.ts";
import { pendingSubmission } from "../../../api/test/integration/portfolio/fixtures.ts";
import { seedSustainmentWorld } from "../../../api/test/integration/contract/p4-exercises-be-i.ts";
import {
  g5Approval,
  pendingGate,
  seedGateWorld,
  stageGates,
} from "../../../api/test/integration/contract/p4-exercises-be-k.ts";
import {
  approverRoleHolders,
  GATE_DECISION_DUE_KIND,
  handleGateDecided,
  handleGateSubmitted,
} from "../../src/handlers/gates.ts";
import { QUEUES_FOR_EVENT } from "../../src/queues/index.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

/** The relay's envelope of the outbox event with this idempotency key. */
async function envelope(idempotencyKey: string) {
  const r = await api.db
    .selectFrom("outbox_event")
    .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
    .where("idempotency_key", "=", idempotencyKey)
    .executeTakeFirstOrThrow();
  return {
    outboxEventId: r.id,
    eventType: r.event_type,
    schemaVersion: r.schema_version,
    idempotencyKey: r.idempotency_key,
    organizationId: r.organization_id,
    payload: r.payload as Record<string, unknown>,
  };
}
const itemsOf = (kind: string, subjectIds: readonly string[]) =>
  subjectIds.length === 0
    ? Promise.resolve([])
    : api.db
        .selectFrom("work_item")
        .select(["assignee_user_id", "status", "message_params", "subject_id", "due_date", "dedupe_key"])
        .where("kind", "=", kind)
        .where("subject_id", "in", [...subjectIds])
        .orderBy("dedupe_key")
        .execute();

const submitG1 = async (p: P2World) => {
  const r = await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G1/submissions`, {
    session: p.lead.session,
    headers: ifm(await gateVersion(api, p, "G1")),
    body: { submissionNote: "Synthetic" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; submissionNo: number; snapshotSha256: string };
};

describe("gate.submitted -> approver tasks (REQ-S12-009)", () => {
  it("one task per required approver referencing the snapshot; redelivery none; supersession cancels; the decider's task is done", async () => {
    const p = await setupP2World(api, w);
    // A second Sponsor on the transformation: both hold the approver role with gate.decide.
    const sp2 = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, sp2.id, "SP", { type: "transformation", id: p.transformationId }, w.orgA.id);
    await makeG1Ready(api, p);
    const first = await submitG1(p);
    const r1 = await handleGateSubmitted(api.db, await envelope(`gate.submitted:${first.id}`), "test-g1-1");
    expect([r1.outcome, [...r1.approverUserIds].sort(), r1.created]).toEqual([
      "done",
      [p.sponsor.id, sp2.id].sort(),
      2,
    ]);
    const tasks = await itemsOf(GATE_DECISION_DUE_KIND, [first.id]);
    expect(tasks.map((t) => [t.assignee_user_id, t.status, t.message_params]).sort()).toEqual(
      [p.sponsor.id, sp2.id]
        .sort()
        .map((u) => [
          u,
          "open",
          { gateCode: "G1", submissionNo: first.submissionNo, snapshotSha256: first.snapshotSha256 },
        ]),
    );
    // Redelivery (same envelope, another job id): nothing new.
    const again = await handleGateSubmitted(api.db, await envelope(`gate.submitted:${first.id}`), "test-g1-1-retry");
    expect(again.outcome).toBe("duplicate");
    expect(await itemsOf(GATE_DECISION_DUE_KIND, [first.id])).toHaveLength(2);
    // A superseding submission: the old tasks are cancelled and the new ones reference the new snapshot.
    const second = await submitG1(p);
    const r2 = await handleGateSubmitted(api.db, await envelope(`gate.submitted:${second.id}`), "test-g1-2");
    expect([r2.cancelled, r2.created]).toEqual([2, 2]);
    expect((await itemsOf(GATE_DECISION_DUE_KIND, [first.id])).map((t) => t.status)).toEqual([
      "cancelled",
      "cancelled",
    ]);
    expect(
      (await itemsOf(GATE_DECISION_DUE_KIND, [second.id])).map(
        (t) => (t.message_params as { snapshotSha256: string }).snapshotSha256,
      ),
    ).toEqual([second.snapshotSha256, second.snapshotSha256]);
    // The Sponsor decides: their task is done, the other approver's is cancelled.
    const d = await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G1/decision`, {
      session: p.sponsor.session,
      body: {
        submissionNo: second.submissionNo,
        outcome: "approved",
        rationale: "Synthetic demo",
        agreements: G1_AGREEMENTS,
      },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const decided = await handleGateDecided(api.db, await envelope(`gate.decided:${d.body.id}`), "test-g1-d");
    expect([decided.closedDone, decided.closedCancelled]).toEqual([1, 1]);
    const closed = await itemsOf(GATE_DECISION_DUE_KIND, [second.id]);
    expect(Object.fromEntries(closed.map((t) => [t.assignee_user_id, t.status]))).toEqual({
      [p.sponsor.id]: "done",
      [sp2.id]: "cancelled",
    });
    // G1 approved -> the three Define steps and their tasks for the lead (no lead on the row: the submitter).
    expect([decided.stepsInserted, decided.phaseStepItems]).toEqual([3, 3]);
  });

  it("no approver on the transformation: one routing.role_unmapped notice to the submitter, never a silent skip", async () => {
    // A slice B world has no Sponsor at all: nobody holds SP with gate.decide on the transformation.
    const s = await seedSustainmentWorld(api, w);
    const b = s.b;
    await sql`SELECT p4_instantiate_transformation(${b.transformationId}::uuid, ${b.users.tl.id}::uuid, 'test:unmapped', 'api')`.execute(
      api.db,
    );
    const p = { transformationId: b.transformationId, lead: { id: b.users.tl.id } } as unknown as P2World;
    const no = await pendingSubmission(api, p, "G1");
    const sub = await api.db
      .selectFrom("gate_submission")
      .select(["id", "gate_instance_id", "snapshot_sha256"])
      .where("transformation_id", "=", b.transformationId)
      .where("submission_no", "=", no)
      .executeTakeFirstOrThrow();
    // The fixture submission wrote no event; this is the envelope the API's submitGate writes for it.
    const env = {
      outboxEventId: randomUUID(),
      eventType: "gate.submitted",
      schemaVersion: 1,
      idempotencyKey: `gate.submitted:${sub.id}`,
      organizationId: b.organizationId,
      payload: {
        gateInstanceId: sub.gate_instance_id,
        transformationId: b.transformationId,
        gateCode: "G1",
        submissionId: sub.id,
        submissionNo: no,
        snapshotSha256: sub.snapshot_sha256,
        approverRoleCode: "SP",
        approverUserId: null,
        submittedBy: b.users.tl.id,
        supersededSubmissionId: null,
      },
    };
    const r = await handleGateSubmitted(api.db, env, "test-unmapped");
    expect([r.unmapped, r.created, r.approverUserIds]).toEqual([true, 0, []]);
    const notices = await api.db
      .selectFrom("inbox_notification")
      .select(["recipient_user_id", "message_key"])
      .where("dedupe_key", "=", `gate_submission_unrouted:${sub.id}`)
      .execute();
    expect(notices).toEqual([{ recipient_user_id: b.users.tl.id, message_key: "routing.role_unmapped" }]);
    expect((await handleGateSubmitted(api.db, env, "test-unmapped-retry")).outcome).toBe("duplicate");
  });
});

describe("gate.decided -> enable the next phase and the approved scope (REQ-S12-010)", () => {
  it("G2 approval creates the four Design steps and their tasks once; a redelivery creates none", async () => {
    const p = await setupP2World(api, w);
    await makeG1Ready(api, p);
    const s1 = await submitG1(p);
    const d1 = await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G1/decision`, {
      session: p.sponsor.session,
      body: { submissionNo: s1.submissionNo, outcome: "approved", rationale: "Synthetic", agreements: G1_AGREEMENTS },
    });
    expect(d1.status, JSON.stringify(d1.body)).toBe(201);
    const no = await pendingSubmission(api, p, "G2");
    const d2 = await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G2/decision`, {
      session: p.sponsor.session,
      body: { submissionNo: no, outcome: "approved", rationale: "Synthetic demo decision" },
    });
    expect(d2.status, JSON.stringify(d2.body)).toBe(201);
    const env = await envelope(`gate.decided:${d2.body.id}`);
    const r = await handleGateDecided(api.db, env, "test-g2");
    expect([r.stepsInserted, r.phaseStepItems]).toEqual([4, 4]);
    const steps = await api.db
      .selectFrom("phase_step")
      .select(["id", "step_key", "status", "enabled_by_gate_decision_id"])
      .where("transformation_id", "=", p.transformationId)
      .where("phase_code", "=", "design")
      .orderBy("step_key")
      .execute();
    expect(steps.map((s) => [s.status, s.enabled_by_gate_decision_id])).toEqual(
      steps.map(() => ["not_started", d2.body.id]),
    );
    expect(steps).toHaveLength(4);
    const tasks = await itemsOf(
      "phase_step_enabled",
      steps.map((s) => s.id),
    );
    expect(tasks.map((t) => [t.assignee_user_id, t.status])).toEqual(steps.map(() => [p.lead.id, "open"]));
    expect((await handleGateDecided(api.db, env, "test-g2-retry")).outcome).toBe("duplicate");
    expect(
      await itemsOf(
        "phase_step_enabled",
        steps.map((s) => s.id),
      ),
    ).toHaveLength(4);
  });

  it("a G5 approval creates tasks only for its approved scope item and condition (a second initiative gets none)", async () => {
    const g = await seedGateWorld(api, w);
    const other = await insertInitiative(api.db, g.b);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const no = await pendingGate(api, g, "G5");
    const d = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const r = await handleGateDecided(api.db, await envelope(`gate.decided:${d.body.id}`), "test-g5");
    expect([r.scopeItems, r.conditionItems, r.stepsInserted]).toEqual([1, 1, 4]);
    const scope = await send("GET", `${g.b.base}/scale-scope`, { session: g.b.s.auditor });
    const scopeTasks = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "subject_id", "message_params"])
      .where("transformation_id", "=", g.b.transformationId)
      .where("kind", "=", "scale_scope_enabled")
      .execute();
    // The initiative has no executive owner or workstream lead: the submitter (TL) gets the task.
    expect(scopeTasks.map((t) => [t.subject_id, t.assignee_user_id])).toEqual([
      [scope.body.items[0].id, g.b.users.tl.id],
    ]);
    expect(JSON.stringify(scopeTasks)).not.toContain(other);
    const conditionTasks = await itemsOf("gate_condition_due", [scope.body.conditions[0].id]);
    expect(conditionTasks.map((t) => [t.assignee_user_id, t.due_date])).toEqual([[g.b.users.bo.id, "2026-12-31"]]);
  });
});

describe("parity and wiring (D-102)", () => {
  it("the worker's approver resolution equals the API's canDecide for the same people", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    await pendingGate(api, g, "G5");
    const people = [
      { id: g.sp.id, session: g.sp.session },
      { id: g.b.users.bo.id, session: g.b.s.bo },
      { id: g.b.users.fin.id, session: g.b.s.fin },
      { id: g.b.users.tl.id, session: g.b.s.tl },
      { id: w.auditor.id, session: g.b.s.auditor },
    ];
    const extra = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, extra.id, "SP", { type: "organization", id: w.orgA.id }, w.orgA.id);
    people.push({ id: extra.id, session: await signIn(api.app, extra.subject) });
    const worker = await api.db.transaction().execute((tx) => approverRoleHolders(tx, g.b.transformationId, "SP"));
    for (const person of people) {
      const view = await send("GET", `${g.gates}/G5`, { session: person.session });
      const canDecide = view.status === 200 && view.body.canDecide === true;
      // The submitter (TL) is excluded by both: the API's canDecide and the consumer's filter.
      const workerSays = worker.includes(person.id) && person.id !== g.b.users.tl.id;
      expect([person.id, workerSays]).toEqual([person.id, canDecide]);
    }
  });

  it("each gate event maps to its gates.* queue", () => {
    expect(QUEUES_FOR_EVENT["gate.submitted"]).toEqual(["gates.submitted"]);
    expect(QUEUES_FOR_EVENT["gate.decided"]).toEqual(["gates.decided"]);
  });
});
