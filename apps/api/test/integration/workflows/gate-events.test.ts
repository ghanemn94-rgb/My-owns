// The gate outbox events (T-DG4-BE-K; ADR-0035 §7, R1; REQ-S12-009, REQ-S12-010) against a real PostgreSQL: a gate
// submission writes ONE gate.submitted event in its transaction (payload: the snapshot SHA-256, the approver, the
// superseded submission), a decision writes ONE gate.decided event (outcome, next phase, the G5 scope item and condition
// ids); a refused submission or decision writes none. The worker's consumers are tested in
// apps/worker/test/integration/gates.test.ts. Synthetic data; the decisions are demo business decisions by test persons
// that approve nothing real; nothing touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, ifm, makeG1Ready, setupP2World } from "../../support/p2-fixtures.ts";
import { g5Approval, pendingGate, seedGateWorld, stageGates } from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const eventsOf = (transformationId: string, eventType: string) =>
  api.db
    .selectFrom("outbox_event")
    .select(["event_type", "aggregate_type", "idempotency_key", "payload", "schema_version"])
    .where("event_type", "=", eventType)
    .where(sql<string>`payload->>'transformationId'`, "=", transformationId)
    .orderBy("seq")
    .execute();

describe("gate.submitted / gate.decided (ADR-0035 §7)", () => {
  it("submission, supersession and decision each write exactly one event in their transaction; refusals write none", async () => {
    const p = await setupP2World(api, w);
    const G = `/api/v1/transformations/${p.transformationId}/gates/G1`;
    // A refused submission (criteria incomplete) writes no event.
    const refused = await send("POST", `${G}/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    });
    expect(refused.status).toBe(422);
    expect(await eventsOf(p.transformationId, "gate.submitted")).toEqual([]);
    await makeG1Ready(api, p);
    const first = await send("POST", `${G}/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: { submissionNote: "Synthetic first" },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await send("POST", `${G}/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: { submissionNote: "Synthetic second" },
    });
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const submitted = await eventsOf(p.transformationId, "gate.submitted");
    expect(submitted.map((e) => [e.aggregate_type, e.idempotency_key, e.schema_version])).toEqual([
      ["gate_instance", `gate.submitted:${first.body.id}`, 1],
      ["gate_instance", `gate.submitted:${second.body.id}`, 1],
    ]);
    expect(submitted[1]!.payload).toEqual({
      gateInstanceId: second.body.gateInstanceId,
      transformationId: p.transformationId,
      gateCode: "G1",
      submissionId: second.body.id,
      submissionNo: 2,
      snapshotSha256: second.body.snapshotSha256,
      approverRoleCode: "SP",
      approverUserId: null,
      submittedBy: p.lead.id,
      supersededSubmissionId: first.body.id,
    });
    // A refused decision (the submitter) writes no event; the Sponsor's decision writes one.
    const bySubmitter = await send("POST", `${G}/decision`, {
      session: p.lead.session,
      body: { submissionNo: 2, outcome: "approved", rationale: "Synthetic", agreements: G1_AGREEMENTS },
    });
    expect(bySubmitter.status).toBe(403);
    expect(await eventsOf(p.transformationId, "gate.decided")).toEqual([]);
    const decided = await send("POST", `${G}/decision`, {
      session: p.sponsor.session,
      body: { submissionNo: 2, outcome: "approved", rationale: "Synthetic demo decision", agreements: G1_AGREEMENTS },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    const events = await eventsOf(p.transformationId, "gate.decided");
    expect(events.map((e) => [e.idempotency_key, e.payload])).toEqual([
      [
        `gate.decided:${decided.body.id}`,
        {
          gateInstanceId: second.body.gateInstanceId,
          transformationId: p.transformationId,
          gateCode: "G1",
          submissionId: second.body.id,
          submissionNo: 2,
          gateDecisionId: decided.body.id,
          outcome: "approved",
          decidedBy: p.sponsor.id,
          nextPhase: "define",
          scaleScopeItemIds: [],
          conditionIds: [],
        },
      ],
    ]);
  });

  it("a G5 approval's event names its scope item and condition ids and the next phase realize", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const no = await pendingGate(api, g, "G5");
    const d = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const scope = await send("GET", `${g.b.base}/scale-scope`, { session: g.b.s.auditor });
    const [e] = await eventsOf(g.b.transformationId, "gate.decided");
    expect(e!.payload).toMatchObject({
      gateCode: "G5",
      outcome: "approved",
      nextPhase: "realize",
      scaleScopeItemIds: [scope.body.items[0].id],
      conditionIds: [scope.body.conditions[0].id],
    });
  });
});
