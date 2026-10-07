// G1 leadership agreement confirmations (REQ-PB-022, B0032; ADR-0021 §8; T-DG3-BE-A) against a real PostgreSQL:
// approving G1 without them is 422 with the three pointers and writes nothing; a partial set is 422; all three -> 201,
// three gate_decision_agreement rows confirmed by the decider and the agreements in the decision's audit diff; sending
// them on G2 or with a non-approve outcome is 422 not-applicable; 403 not-approver, 403 submitter and 409 superseded
// keep their precedence; and migration 0025's deferred guard refuses the COMMIT of an approved G1 decision without the
// three rows. Synthetic data; the demo decisions approve nothing real and never touch the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { record } from "../../../src/modules/audit/index.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  grant,
  seedWorld,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { G1_AGREEMENTS, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { pendingSubmission } from "./fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

const DETAIL =
  "G1 approval requires leadership agreement on the problem, the baseline and the material value pools (B0032)";
const POINTERS = ["/agreements/problem", "/agreements/baseline", "/agreements/materialValuePools"];
const url = (p: P2World, gate = "G1") => `/api/v1/transformations/${p.transformationId}/gates/${gate}/decision`;
type Problem = { code: string; type: string; detail: string; errors: { pointer: string; code: string }[] };

const decide = (p: P2World, body: Record<string, unknown>, session = p.sponsor.session, gate = "G1") =>
  call<Problem & { id: string; agreements: { agreementCode: string; confirmedBy: string }[] }>(
    api.app,
    "POST",
    url(p, gate),
    { session, body: { rationale: "Synthetic rationale for a demo decision.", ...body } },
  );

async function decisionsOf(p: P2World) {
  return api.db.selectFrom("gate_decision").select("id").where("transformation_id", "=", p.transformationId).execute();
}

async function expectNothingWritten(p: P2World, res: { headers: Record<string, unknown> }) {
  expect(await decisionsOf(p)).toEqual([]);
  expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
  const g1 = await api.db
    .selectFrom("gate_instance")
    .select("status")
    .where("transformation_id", "=", p.transformationId)
    .where("gate_code", "=", "G1")
    .executeTakeFirstOrThrow();
  expect(g1.status).toBe("submitted");
}

describe("G1 approval needs the three B0032 leadership agreements (ADR-0021 §8)", () => {
  it("approve without agreements -> 422 gate.g1_agreements_required with the three pointers; nothing written", async () => {
    const p = await setupP2World(api, w);
    const no = await pendingSubmission(api, p, "G1");
    const res = await decide(p, { submissionNo: no, outcome: "approved" });
    expect([res.status, res.body.type, res.body.code, res.body.detail]).toEqual([
      422,
      "urn:mth:problem:validation",
      "gate.g1_agreements_required",
      DETAIL,
    ]);
    expect(res.body.errors.map((e) => e.pointer)).toEqual(POINTERS);
    await expectNothingWritten(p, res);
  });

  it("partial or false confirmations -> 422 naming only the missing ones; nothing written", async () => {
    const p = await setupP2World(api, w);
    const no = await pendingSubmission(api, p, "G1");
    const partial = await decide(p, { submissionNo: no, outcome: "approved", agreements: { problem: true } });
    expect([partial.status, partial.body.code]).toEqual([422, "gate.g1_agreements_required"]);
    expect(partial.body.errors.map((e) => e.pointer)).toEqual(POINTERS.slice(1));
    const falsy = await decide(p, {
      submissionNo: no,
      outcome: "approved",
      agreements: { problem: true, baseline: false, materialValuePools: true },
    });
    expect([falsy.status, falsy.body.errors.map((e) => e.pointer)]).toEqual([422, ["/agreements/baseline"]]);
    // An unknown confirmation or a non-boolean is a malformed request (400), not the rule.
    const unknown = await decide(p, {
      submissionNo: no,
      outcome: "approved",
      agreements: { ...G1_AGREEMENTS, sponsor: true },
    });
    expect(unknown.status).toBe(400);
    await expectNothingWritten(p, falsy);
  });

  it("with all three -> 201, three agreement rows confirmed by the decider, agreements in the response and audit diff", async () => {
    const p = await setupP2World(api, w);
    const no = await pendingSubmission(api, p, "G1");
    const res = await decide(p, { submissionNo: no, outcome: "approved", agreements: G1_AGREEMENTS });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.agreements.map((a) => [a.agreementCode, a.confirmedBy])).toEqual([
      ["problem", p.sponsor.id],
      ["baseline", p.sponsor.id],
      ["material_value_pools", p.sponsor.id],
    ]);
    const rows = await api.db
      .selectFrom("gate_decision_agreement")
      .select(["agreement_code", "confirmed_by"])
      .where("gate_decision_id", "=", res.body.id)
      .orderBy("agreement_code")
      .execute();
    expect(rows).toEqual([
      { agreement_code: "baseline", confirmed_by: p.sponsor.id },
      { agreement_code: "material_value_pools", confirmed_by: p.sponsor.id },
      { agreement_code: "problem", confirmed_by: p.sponsor.id },
    ]);
    const [event] = await auditOf(api.db, res.body.id);
    expect(event!.action).toBe("gate_decision.create");
    expect((event!.changes as Record<string, unknown>)["agreements"]).toEqual({
      from: null,
      to: ["problem", "baseline", "material_value_pools"],
    });
    // The frozen submission view returns the decision with its agreements.
    const view = await call(
      api.app,
      "GET",
      `/api/v1/transformations/${p.transformationId}/gates/G1/submissions/${no}`,
      {
        session: p.auditor.session,
      },
    );
    expect(view.body.decision.agreements).toHaveLength(3);
  });

  it("agreements on G2, or with a non-approve G1 outcome -> 422 gate.agreements_not_applicable; nothing written", async () => {
    const p = await setupP2World(api, w);
    const g2 = await pendingSubmission(api, p, "G2");
    const onG2 = await decide(p, { submissionNo: g2, outcome: "approved", agreements: G1_AGREEMENTS }, undefined, "G2");
    expect([onG2.status, onG2.body.code, onG2.body.errors[0]!.pointer]).toEqual([
      422,
      "gate.agreements_not_applicable",
      "/agreements",
    ]);
    const q = await setupP2World(api, w);
    const g1 = await pendingSubmission(api, q, "G1");
    const rejected = await decide(q, { submissionNo: g1, outcome: "rejected", agreements: G1_AGREEMENTS });
    expect([rejected.status, rejected.body.code]).toEqual([422, "gate.agreements_not_applicable"]);
    await expectNothingWritten(q, rejected);
    // Without agreements, a G1 rejection is unchanged from DG2.
    expect((await decide(q, { submissionNo: g1, outcome: "rejected" })).status).toBe(201);
  });

  it("403 not-approver, 403 submitter and 409 superseded keep their precedence over the agreement rule", async () => {
    const p = await setupP2World(api, w);
    // The sponsor also holds TL here and submits, so the submitter is a configured approver (separation of duties).
    await grant(
      api.db,
      w.grantor.id,
      p.sponsor.id,
      "TL",
      { type: "transformation", id: p.transformationId },
      w.orgA.id,
    );
    const no = await pendingSubmission(api, p, "G1", p.sponsor.id);
    const notApprover = await decide(p, { submissionNo: no, outcome: "approved" }, p.lead.session);
    expect([notApprover.status, notApprover.body.code]).toEqual([403, "gate.not_approver"]);
    const auditorRes = await decide(p, { submissionNo: no, outcome: "approved" }, p.auditor.session);
    expect([auditorRes.status, auditorRes.body.code]).toEqual([403, "gate.not_approver"]);
    const submitter = await decide(p, { submissionNo: no, outcome: "approved" });
    expect([submitter.status, submitter.body.code]).toEqual([403, "gate.submitter_cannot_decide"]);
    const q = await setupP2World(api, w);
    const qNo = await pendingSubmission(api, q, "G1");
    const superseded = await decide(q, { submissionNo: qNo + 5, outcome: "approved" });
    expect([superseded.status, superseded.body.code]).toEqual([409, "gate.submission_superseded"]);
    await expectNothingWritten(q, superseded);
  });
});

describe("migration 0025: the deferred guard refuses an approved G1 decision without three agreements at COMMIT", () => {
  /** Writes an approved G1 gate decision (with its decision row and audit events) directly, as a buggy API would. */
  async function approveDirectly(p: P2World, agreementCodes: readonly string[]) {
    const no = await pendingSubmission(api, p, "G1");
    return api.db.transaction().execute(async (tx) => {
      const sub = await tx
        .selectFrom("gate_submission")
        .select(["id"])
        .where("transformation_id", "=", p.transformationId)
        .where("gate_code", "=", "G1")
        .where("submission_no", "=", no)
        .executeTakeFirstOrThrow();
      const t = await tx
        .selectFrom("transformation")
        .select("organization_id")
        .where("id", "=", p.transformationId)
        .executeTakeFirstOrThrow();
      const audit = { actorUserId: p.sponsor.id, requestId: `guard-${uuidv7()}` };
      const decisionId = uuidv7();
      await tx
        .insertInto("decision")
        .values({
          id: decisionId,
          organization_id: t.organization_id,
          transformation_id: p.transformationId,
          kind: "gate",
          code: "GD-90",
          title: "Synthetic guard probe",
          owner_user_id: p.sponsor.id,
          status: "decided",
          outcome_text: "approved: synthetic",
          decided_by: p.sponsor.id,
          decided_at: sql<Date>`now()`,
          created_by: p.sponsor.id,
          updated_by: p.sponsor.id,
        })
        .execute();
      await record(tx, audit, {
        action: "decision.create",
        recordType: "decision",
        recordId: decisionId,
        organizationId: t.organization_id,
        transformationId: p.transformationId,
        newVersion: 1,
      });
      const gateDecisionId = uuidv7();
      await tx
        .insertInto("gate_decision")
        .values({
          id: gateDecisionId,
          organization_id: t.organization_id,
          transformation_id: p.transformationId,
          gate_submission_id: sub.id,
          decision_id: decisionId,
          gate_code: "G1",
          submission_no: no,
          outcome: "approved",
          rationale: "Synthetic guard probe",
          comments: null,
          decided_by: p.sponsor.id,
          on_behalf_of_user_id: null,
          approver_basis: "default_role",
          approver_role_code: "SP",
        })
        .execute();
      await record(tx, audit, {
        action: "gate_decision.create",
        recordType: "gate_decision",
        recordId: gateDecisionId,
        organizationId: t.organization_id,
        transformationId: p.transformationId,
      });
      for (const code of agreementCodes)
        await tx
          .insertInto("gate_decision_agreement")
          .values({
            id: uuidv7(),
            organization_id: t.organization_id,
            transformation_id: p.transformationId,
            gate_decision_id: gateDecisionId,
            agreement_code: code,
            confirmed_by: p.sponsor.id,
          })
          .execute();
      return gateDecisionId;
    });
  }

  it("no agreement rows -> the COMMIT fails with gate_decision_g1_agreements and nothing persists", async () => {
    const p = await setupP2World(api, w);
    const err = await approveDirectly(p, []).then(
      () => null,
      (e: unknown) => e as { code?: string; constraint?: string },
    );
    expect(err).not.toBeNull();
    expect([err!.code, err!.constraint]).toEqual(["23000", "gate_decision_g1_agreements"]);
    expect(await decisionsOf(p)).toEqual([]);
  });

  it("two of three -> refused at COMMIT; all three -> commits", async () => {
    const p = await setupP2World(api, w);
    const err = await approveDirectly(p, ["problem", "baseline"]).then(
      () => null,
      (e: unknown) => e as { constraint?: string },
    );
    expect(err?.constraint).toBe("gate_decision_g1_agreements");
    const q = await setupP2World(api, w);
    const id = await approveDirectly(q, ["problem", "baseline", "material_value_pools"]);
    expect((await decisionsOf(q)).map((d) => d.id)).toEqual([id]);
  });
});
