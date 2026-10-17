// The ten seeded procedures and their output adapters (ADR-0042 §3, §5; REQ-S06-003, REQ-S06-002's output clause;
// p5-work-split §C.3; T-DG5-BE-G) against a real PostgreSQL:
//  - REQ-S06-003: the ten procedures exist after initialization (procedures v1, published, in the M0153 order, 31
//    steps, each with a trigger and a completion condition) and each launches;
//  - REQ-S06-002 (literal): completing `baseline_validation` creates a baseline (recorded through the DG2 baseline
//    operation by a baseline.edit holder and taken as the step's output by the `baseline` adapter), the FIN step
//    validates it (the DG2 validation by Finance, verified by the adapter's `advance`), and the validated baseline is
//    linked to the instance; a baseline from before the launch, from another transformation, or not yet validated is
//    refused with the ADR-0042 §10 codes and nothing is written;
//  - an approval step whose output is an `advance` (executive_escalation): the business approver's approval completes
//    the step only once the decision is decided; approving earlier is refused and the approval stays pending;
//  - kpi_submission: a KPI actual submitted and then accepted through the DG4 review route;
//  - scope_target_change: a change request raised (DG4 change control) and decided before its approval step;
//  - gate_review: the G1 submission (DG2 gate operations), a not-applicable finance review and the gate decision;
//  - bau_handover: prepared (DG4 sustainment), accepted by the receiving BO before the BO's step approval;
//  - benefit_validation: evidence and a Finance decision (DG4 Finance queue) in parallel; recovery not applicable;
//  - initiative_prioritization: DG3 scores, a ranking snapshot by the TO and the Sponsor's approval;
//  - tom_approval: a `link` output (a ready canvas cell), two parallel reviews and the Sponsor's approval;
//  - new_transformation_intake (organization scope): the intake creates the transformation and links its charter; its
//    Sponsor step then waits unrouted while the new transformation has no mapped Sponsor (D-166 Rule A; the routed
//    and decided path: intake-adoption.test.ts).
// Every value is SYNTHETIC. The approvals decided here are demo BUSINESS approvals on synthetic records, decided by a
// synthetic business approver (the Sponsor) through the canonical approval; they approve nothing real and have nothing
// to do with the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  type Session,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { G1_AGREEMENTS, gateVersion, makeG1Ready } from "../../support/p2-fixtures.ts";
import { pinProcedures } from "../../support/procedure-instance-fixtures.ts";
import { person, setupApprovalWorld, type ApprovalWorld, type Person } from "../approvals/approval-world.ts";
import {
  createArea,
  createNoteEvidence,
  fullContent,
  insertControl,
  seedSustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";
import { seedBenefitWorld } from "../benefits/fixtures.ts";
import { approve as approveValue, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { insertInitiative } from "../contract/p3-exercises-be-d.ts";
import { seedKpiWorld } from "../kpi/fixtures.ts";
import { decide, selectedInitiative, setupChangeWorld } from "../workflows/change-fixtures.ts";
import {
  actualAction,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  submitActual,
} from "../kpi-p4/kbe-c-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const I = "/api/v1/procedure-instances";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];

/** The seeded `procedures` v1 (0069). */
const PROCEDURES_V1 = "01920005-0300-7000-8000-000000000001";
/** The M0153 list, in its order. */
const TEN = [
  "new_transformation_intake",
  "baseline_validation",
  "kpi_submission",
  "tom_approval",
  "initiative_prioritization",
  "gate_review",
  "scope_target_change",
  "benefit_validation",
  "executive_escalation",
  "bau_handover",
];

let api: TestApi;
let w: World;
let p: ApprovalWorld;
let kds: Person;

const launch = (session: Session, body: Body) => call<Body>(api.app, "POST", I, { session, body });
const get = async (session: Session, id: string) => (await call<Body>(api.app, "GET", `${I}/${id}`, { session })).body;
const step = (session: Session, id: string, key: string, action: string, version: number, body: Body = {}) =>
  call<Body>(api.app, "POST", `${I}/${id}/steps/${key}/${action}`, { session, headers: ifm(version), body });
const outputs = (b: Body) =>
  b.links.filter((l: Body) => l.linkKind === "output").map((l: Body) => [l.stepKey, l.recordType, l.recordId]);

async function evidence(transformationId: string, session: Session, ownerUserId: string): Promise<string> {
  const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${transformationId}/evidence`, {
    session,
    body: { kind: "note", title: "Synthetic baseline extract", noteBody: "Synthetic", ownerUserId },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

/** A baseline recorded through the DG2 operation by a baseline.edit holder (KDS). */
async function baseline(transformationId: string, session: Session): Promise<{ id: string; version: number }> {
  const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${transformationId}/baselines`, {
    session,
    body: {
      metric: "Roaming revenue per month (synthetic)",
      unit: "SAR",
      scope: "revenue",
      value: "1250000.10",
      currency: "SAR",
      source: "Synthetic finance extract",
      baselineDate: "2026-01-31",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id, version: res.body.version };
}

const BASELINE_INPUTS = {
  metric: "Roaming revenue per month (synthetic)",
  value: "1250000.10",
  unit: "SAR",
  baselineDate: "2026-01-31",
  source: "Synthetic finance extract",
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
  // Deterministic on the shared run database: this transformation is pinned to the seeded v1 (other suites publish
  // newer synthetic versions of the same key).
  await pinProcedures(api, w.orgA.id, p.transformationId, PROCEDURES_V1, p.lead.id);
  kds = await person(api, w, p.transformationId, "KDS");
}, 180_000);
afterAll(() => api.close());

describe("the ten seeded procedures (REQ-S06-003)", () => {
  it("exist after initialization: procedures v1 is published with the ten M0153 procedures and 31 steps", async () => {
    const v1 = await api.db
      .selectFrom("methodology_version")
      .select(["config_kind", "key", "version_no", "status"])
      .where("id", "=", PROCEDURES_V1)
      .executeTakeFirstOrThrow();
    expect(v1).toEqual({ config_kind: "procedure", key: "procedures", version_no: 1, status: "published" });
    const defs = await api.db
      .selectFrom("procedure_definition")
      .select(["code", "origin", "removed", "trigger_kind", "completion_rule", "id"])
      .where("methodology_version_id", "=", PROCEDURES_V1)
      .orderBy("ordinal")
      .execute();
    expect(defs.map((d) => d.code)).toEqual(TEN);
    for (const d of defs) {
      expect(d.removed, d.code).toBe(false);
      expect(d.trigger_kind, d.code).not.toBeNull();
      expect(d.completion_rule, d.code).not.toBeNull();
    }
    const steps = await api.db
      .selectFrom("procedure_step_definition")
      .select(["procedure_definition_id", "output_record_type"])
      .where(
        "procedure_definition_id",
        "in",
        defs.map((d) => d.id),
      )
      .execute();
    expect(steps).toHaveLength(31);
    // Every output record type the seed names has an adapter, or is the step's own approval.
    const { PROCEDURE_OUTPUT_ADAPTERS } = await import("../../../src/modules/procedures/outputs/index.ts");
    const adapted = new Set(PROCEDURE_OUTPUT_ADAPTERS.map((a) => a.recordType));
    for (const s of steps)
      if (s.output_record_type !== null && s.output_record_type !== "approval")
        expect(adapted.has(s.output_record_type), s.output_record_type).toBe(true);
    // Read through the API by any signed-in reader (AUD included).
    const list = await call<Body>(api.app, "GET", "/api/v1/procedure-definitions", { session: p.auditor.session });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    for (const code of TEN) expect(list.body.items.map((d: Body) => d.code)).toContain(code);
  });

  it("each of the ten launches (nine in the transformation, the intake in the organization)", async () => {
    for (const code of TEN.filter((c) => c !== "new_transformation_intake")) {
      const res = await launch(p.office.session, { procedureCode: code, transformationId: p.transformationId });
      expect(res.status, `${code}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.methodologyVersionId, code).toBe(PROCEDURES_V1);
      expect(res.body.status, code).toBe("active");
      expect(res.body.currentStepKeys.length, code).toBeGreaterThan(0);
    }
    const intake = await launch(p.office.session, {
      procedureCode: "new_transformation_intake",
      transformationId: null,
    });
    expect(intake.status, JSON.stringify(intake.body)).toBe(201);
    expect([intake.body.transformationId, intake.body.currentStepKeys]).toEqual([null, ["capture_intake"]]);
  });
});

describe("baseline_validation creates, validates and links a baseline (REQ-S06-002, A02 part)", () => {
  it("completing it creates a baseline, the FIN step validates it, and the validated baseline is linked", async () => {
    const res = await launch(p.bo.session, {
      procedureCode: "baseline_validation",
      transformationId: p.transformationId,
      inputValues: BASELINE_INPUTS,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    expect([res.body.currentStepKeys, res.body.steps[0].assigneeRoleCode]).toEqual([["record_baseline"], "BO"]);
    await step(p.bo.session, id, "record_baseline", "evidence", 1, {
      evidenceId: await evidence(p.transformationId, p.lead.session, p.lead.id),
    });
    // The baseline is recorded through the DG2 operation by a baseline.edit holder (KDS; BO does not hold it).
    const b = await baseline(p.transformationId, kds.session);
    // Naming nothing -> 422 output_required; nothing written.
    const none = await step(p.bo.session, id, "record_baseline", "complete", 2);
    expect(codeOf(none)).toEqual([422, "procedure_step.output_required"]);
    expect(none.body.detail).toBe("This step must produce or link its output record.");
    const done1 = await step(p.bo.session, id, "record_baseline", "complete", 2, { outputRecordId: b.id });
    expect(done1.status, JSON.stringify(done1.body)).toBe(200);
    expect(done1.body.currentStepKeys).toEqual(["validate_baseline"]);
    expect(outputs(done1.body)).toEqual([["record_baseline", "baseline", b.id]]);
    // One audit event per row written, in the request (the link, the step completion and activation, the instance).
    const events = (await auditOfRequest(api.db, done1.headers["x-request-id"] as string)).map((e) => e.action);
    expect(events.filter((a) => a === "procedure_instance_link.output")).toHaveLength(1);
    // FIN completes before validating: the baseline is not validated -> 422 output_required, nothing written.
    const early = await step(p.fin.session, id, "validate_baseline", "complete", 3);
    expect(codeOf(early)).toEqual([422, "procedure_step.output_required"]);
    expect((await get(p.fin.session, id)).version).toBe(3);
    // Finance validates through the DG2 operation (a human action recorded by kpi), then completes the step.
    const v = await call<Body>(
      api.app,
      "POST",
      `/api/v1/transformations/${p.transformationId}/baselines/${b.id}/validation`,
      { session: p.fin.session, headers: ifm(b.version), body: { result: "validated", note: "Synthetic check." } },
    );
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    // An advance names nothing, or the record the earlier step produced: another record -> 422 output_record_invalid.
    const other = await step(p.fin.session, id, "validate_baseline", "complete", 3, {
      outputRecordId: crypto.randomUUID(),
    });
    expect(codeOf(other)).toEqual([422, "procedure_step.output_record_invalid"]);
    const done2 = await step(p.fin.session, id, "validate_baseline", "complete", 3);
    expect(done2.status, JSON.stringify(done2.body)).toBe(200);
    expect([done2.body.status, done2.body.currentStepKeys]).toEqual(["completed", []]);
    expect(outputs(done2.body)).toEqual([["record_baseline", "baseline", b.id]]);
    const linked = await api.db
      .selectFrom("baseline")
      .select("validation_status")
      .where("id", "=", b.id)
      .executeTakeFirstOrThrow();
    expect(linked.validation_status).toBe("validated");
  });

  it("refuses a baseline from before the launch, from another transformation, or already another instance's output", async () => {
    const before = await baseline(p.transformationId, kds.session);
    const res = await launch(p.bo.session, {
      procedureCode: "baseline_validation",
      transformationId: p.transformationId,
      inputValues: BASELINE_INPUTS,
    });
    const id = res.body.id as string;
    await step(p.bo.session, id, "record_baseline", "evidence", 1, {
      evidenceId: await evidence(p.transformationId, p.lead.session, p.lead.id),
    });
    const old = await step(p.bo.session, id, "record_baseline", "complete", 2, { outputRecordId: before.id });
    expect(codeOf(old)).toEqual([422, "procedure_step.output_record_invalid"]);
    expect(old.body.detail).toBe("The linked record is not of the expected type or not in this scope.");
    // Another transformation's baseline (its own world).
    const q = await setupApprovalWorld(api, w);
    const foreign = await baseline(q.transformationId, q.lead.session);
    expect(
      codeOf(await step(p.bo.session, id, "record_baseline", "complete", 2, { outputRecordId: foreign.id })),
    ).toEqual([422, "procedure_step.output_record_invalid"]);
    // A record that is not a baseline at all.
    expect(
      codeOf(await step(p.bo.session, id, "record_baseline", "complete", 2, { outputRecordId: p.decisionId })),
    ).toEqual([422, "procedure_step.output_record_invalid"]);
    // A baseline another instance already took as its output.
    const res2 = await launch(p.bo.session, {
      procedureCode: "baseline_validation",
      transformationId: p.transformationId,
      inputValues: BASELINE_INPUTS,
    });
    const fresh = await baseline(p.transformationId, kds.session);
    await step(p.bo.session, res2.body.id, "record_baseline", "evidence", 1, {
      evidenceId: await evidence(p.transformationId, p.lead.session, p.lead.id),
    });
    expect(
      (await step(p.bo.session, res2.body.id, "record_baseline", "complete", 2, { outputRecordId: fresh.id })).status,
    ).toBe(200);
    expect(
      codeOf(await step(p.bo.session, id, "record_baseline", "complete", 2, { outputRecordId: fresh.id })),
    ).toEqual([422, "procedure_step.output_record_invalid"]);
    // Nothing was written by the refusals.
    const after = await get(p.bo.session, id);
    expect([after.version, outputs(after)]).toEqual([2, []]);
    // AUD never acts.
    expect(
      (await step(p.auditor.session, id, "record_baseline", "complete", 2, { outputRecordId: fresh.id })).status,
    ).toBe(403);
  });
});

describe("an approval step with an `advance` output (executive_escalation)", () => {
  it("the Sponsor's approval completes the step only once the decision is decided; then the instance completes", async () => {
    const res = await launch(p.lead.session, {
      procedureCode: "executive_escalation",
      transformationId: p.transformationId,
      inputValues: { whyNow: "Synthetic: the roaming partner deadline moved." },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    // The decision is raised through the DG2 decision register (TL), owned by the Sponsor.
    const d = await call<Body>(api.app, "POST", "/api/v1/decisions", {
      session: p.lead.session,
      body: {
        transformationId: p.transformationId,
        title: "Synthetic executive decision",
        ownerUserId: p.sponsor.id,
        options: [{ title: "Proceed" }, { title: "Pause" }],
      },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const raised = await step(p.lead.session, id, "raise_escalation", "complete", 1, { outputRecordId: d.body.id });
    expect(raised.status, JSON.stringify(raised.body)).toBe(200);
    const approvalStep = raised.body.steps.find((s: Body) => s.stepKey === "executive_decision");
    expect([approvalStep.status, typeof approvalStep.approvalId]).toEqual(["active", "string"]);
    const a = (
      await call<Body>(api.app, "GET", `/api/v1/approvals/${approvalStep.approvalId}`, { session: p.sponsor.session })
    ).body;
    const approve = () =>
      call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
        session: p.sponsor.session,
        headers: ifm(a.version),
        body: { outcome: "approve", rationale: "Synthetic demo approval.", subjectVersion: a.subjectVersion },
      });
    // Approving before the decision is decided: the step's output is not there -> 422; the approval stays pending.
    const early = await approve();
    expect(codeOf(early)).toEqual([422, "procedure_step.output_required"]);
    const still = await call<Body>(api.app, "GET", `/api/v1/approvals/${a.id}`, { session: p.sponsor.session });
    expect(still.body.status).toBe("pending");
    // The Sponsor (the decision's owner) records the choice in the decision register, then approves the step.
    const decided = await call<Body>(api.app, "POST", `/api/v1/decisions/${d.body.id}/decide`, {
      session: p.sponsor.session,
      headers: ifm(1),
      body: { chosenOptionId: d.body.options[0].id, outcomeText: "Proceed (synthetic)." },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    const ok = await approve();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const mid = await get(p.lead.session, id);
    expect(mid.steps.find((s: Body) => s.stepKey === "executive_decision")).toMatchObject({
      status: "completed",
      approvalId: a.id,
      completedBy: p.sponsor.id,
    });
    expect(mid.currentStepKeys).toEqual(["communicate_decision"]);
    const done = await step(p.lead.session, id, "communicate_decision", "complete", mid.version);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(outputs(done.body)).toEqual([["raise_escalation", "decision", d.body.id]]);
  });
});

describe("tom_approval: a linked canvas cell, parallel reviews and the Sponsor's approval", () => {
  it("links a ready canvas cell, runs both reviews in parallel and completes when the Sponsor approves", async () => {
    const td = await person(api, w, p.transformationId, "TD");
    const res = await launch(p.office.session, { procedureCode: "tom_approval", transformationId: p.transformationId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    const T = `/api/v1/transformations/${p.transformationId}`;
    const cell = (await call<Body>(api.app, "GET", `${T}/tom-canvas/data_analytics`, { session: p.lead.session })).body
      .cell;
    // A draft cell is not a completed canvas: 422 output_record_invalid, nothing written.
    expect(
      codeOf(await step(p.lead.session, id, "complete_canvas", "complete", 1, { outputRecordId: cell.id })),
    ).toEqual([422, "procedure_step.output_record_invalid"]);
    // The TL fills the cell through the DG2 canvas operation and marks it ready (target design and owner).
    const ready = await call<Body>(api.app, "PATCH", `${T}/tom-canvas/data_analytics`, {
      session: p.lead.session,
      headers: ifm(cell.version),
      body: { targetDesign: "Synthetic target data design.", ownerUserId: p.lead.id, status: "ready" },
    });
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    const c1 = await step(p.lead.session, id, "complete_canvas", "complete", 1, { outputRecordId: cell.id });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.currentStepKeys.sort()).toEqual(["business_review", "technology_review"]);
    const c2 = await step(td.session, id, "technology_review", "complete", 2);
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    const c3 = await step(p.bo.session, id, "business_review", "complete", 3);
    expect(c3.status, JSON.stringify(c3.body)).toBe(200);
    const approvalStep = c3.body.steps.find((s: Body) => s.stepKey === "sponsor_approval");
    expect([approvalStep.status, typeof approvalStep.approvalId]).toEqual(["active", "string"]);
    const a = (
      await call<Body>(api.app, "GET", `/api/v1/approvals/${approvalStep.approvalId}`, { session: p.sponsor.session })
    ).body;
    const ok = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
      session: p.sponsor.session,
      headers: ifm(a.version),
      body: { outcome: "approve", rationale: "Synthetic demo approval.", subjectVersion: a.subjectVersion },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const done = await get(p.lead.session, id);
    expect(done.status).toBe("completed");
    expect(outputs(done)).toEqual([
      ["complete_canvas", "tom_canvas_cell", cell.id],
      ["sponsor_approval", "approval", a.id],
    ]);
  });
});

describe("kpi_submission: a KPI actual submitted, then accepted, through the DG4 review route", () => {
  it("links the submitted actual and completes once its reviewer accepted it", async () => {
    const k = await seedKpiWorld(api, w);
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    await pinProcedures(api, w.orgA.id, k.transformationId, PROCEDURES_V1, k.users.tl.id);
    const period = await monthlyPeriod(api, w);
    const kpi = await ownedKpi(api, k, REVIEW_FLOW);
    const res = await launch(k.s.bo, {
      procedureCode: "kpi_submission",
      transformationId: k.transformationId,
      inputValues: { period: period.label },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    // The KPI owner submits the actual through the DG4 operation (review route: it waits for its reviewer).
    const sub = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "7.25" });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const actual = sub.body.actual;
    expect(actual.status).toBe("submitted");
    const c1 = await step(k.s.bo, id, "submit_actual", "complete", 1, { outputRecordId: actual.id });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.currentStepKeys).toEqual(["accept_actual"]);
    // Not accepted yet -> 422 output_required; the reviewer (BO, the configured party) accepts through DG4.
    expect(codeOf(await step(k.s.kds, id, "accept_actual", "complete", 2))).toEqual([
      422,
      "procedure_step.output_required",
    ]);
    const acc = await actualAction(api, k, actual.id, "accept", actual.version, {});
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    const c2 = await step(k.s.kds, id, "accept_actual", "complete", 2);
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    expect(c2.body.status).toBe("completed");
    expect(outputs(c2.body)).toEqual([["submit_actual", "kpi_actual", actual.id]]);
  });
});

describe("scope_target_change: a change request raised, assessed and decided by its business approver", () => {
  it("links the submitted request and completes when the Sponsor approves the step after deciding the request", async () => {
    const c = await setupChangeWorld(api, w);
    await pinProcedures(api, w.orgA.id, c.transformationId, PROCEDURES_V1, c.lead.id);
    const res = await launch(c.office.session, {
      procedureCode: "scope_target_change",
      transformationId: c.transformationId,
      inputValues: { reason: "Synthetic: widen the scope." },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    // The TL raises and submits the change request through the DG4 change control (an approved initiative).
    const ini = await selectedInitiative(api.db, c);
    const cr = await call<Body>(api.app, "POST", `${c.base}/change-requests`, {
      session: c.lead.session,
      body: {
        changeKind: "business_scope",
        subjectType: "initiative",
        subjectId: ini,
        subjectVersion: 1,
        proposedChange: { name: { from: "Synthetic initiative", to: "Synthetic initiative, wider scope" } },
        reason: "Synthetic: the sponsor asked to widen the scope",
      },
    });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    // A draft request is not raised yet: 422 output_required.
    expect(
      codeOf(await step(c.lead.session, id, "raise_change", "complete", 1, { outputRecordId: cr.body.id })),
    ).toEqual([422, "procedure_step.output_required"]);
    const submitted = await call<Body>(api.app, "POST", `${c.base}/change-requests/${cr.body.id}/submit`, {
      session: c.lead.session,
      headers: ifm(1),
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
    const c1 = await step(c.lead.session, id, "raise_change", "complete", 1, { outputRecordId: cr.body.id });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    const c2 = await step(c.office.session, id, "assess_impact", "complete", 2);
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    const approvalStep = c2.body.steps.find((s: Body) => s.stepKey === "decide_change");
    expect([approvalStep.status, typeof approvalStep.approvalId]).toEqual(["active", "string"]);
    // The Sponsor decides the change request through its own canonical approval, then approves the procedure step.
    const crDecided = await decide((m, u, o) => call(api.app, m, u, o), submitted.body.approvalId, c.sponsor.session);
    expect(crDecided.status, JSON.stringify(crDecided.body)).toBe(200);
    const stepApproval = await decide((m, u, o) => call(api.app, m, u, o), approvalStep.approvalId, c.sponsor.session);
    expect(stepApproval.status, JSON.stringify(stepApproval.body)).toBe(200);
    const done = await get(c.lead.session, id);
    expect(done.status).toBe("completed");
    expect(outputs(done)).toEqual([["raise_change", "change_request", cr.body.id]]);
  });
});

describe("gate_review: the G1 submission prepared, reviewed and decided by its business approver", () => {
  it("links the G1 submission; the finance review is not applicable; the step approval needs the gate decision", async () => {
    const q = await setupApprovalWorld(api, w);
    await pinProcedures(api, w.orgA.id, q.transformationId, PROCEDURES_V1, q.lead.id);
    const T = `/api/v1/transformations/${q.transformationId}`;
    const res = await launch(q.lead.session, {
      procedureCode: "gate_review",
      transformationId: q.transformationId,
      inputValues: { gateCode: "G1" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    await step(q.lead.session, id, "prepare_submission", "evidence", 1, {
      evidenceId: await evidence(q.transformationId, q.lead.session, q.lead.id),
    });
    // The TL submits G1 through the DG2 gate operation (the business decision stays with the Sponsor).
    await makeG1Ready(api, q);
    const sub = await call<Body>(api.app, "POST", `${T}/gates/G1/submissions`, {
      session: q.lead.session,
      headers: ifm(await gateVersion(api, q, "G1")),
      body: {},
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const submission = await api.db
      .selectFrom("gate_submission")
      .select("id")
      .where("transformation_id", "=", q.transformationId)
      .where("gate_code", "=", "G1")
      .where("submission_no", "=", sub.body.submissionNo)
      .executeTakeFirstOrThrow();
    const c1 = await step(q.lead.session, id, "prepare_submission", "complete", 2, { outputRecordId: submission.id });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    // financeReviewRequired is absent: the conditional finance review is not applicable (never shown as completed).
    const byKey = new Map(c1.body.steps.map((s: Body) => [s.stepKey, s.status]));
    expect([byKey.get("criteria_review"), byKey.get("finance_review")]).toEqual(["active", "not_applicable"]);
    const c2 = await step(q.office.session, id, "criteria_review", "complete", 3);
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    const approvalStep = c2.body.steps.find((s: Body) => s.stepKey === "gate_decision");
    expect([approvalStep.status, typeof approvalStep.approvalId]).toEqual(["active", "string"]);
    const a = (
      await call<Body>(api.app, "GET", `/api/v1/approvals/${approvalStep.approvalId}`, { session: q.sponsor.session })
    ).body;
    const approve = () =>
      call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
        session: q.sponsor.session,
        headers: ifm(a.version),
        body: { outcome: "approve", rationale: "Synthetic demo approval.", subjectVersion: a.subjectVersion },
      });
    // Before the G1 decision the step's output (a decided submission) is not there: 422, the approval stays pending.
    expect(codeOf(await approve())).toEqual([422, "procedure_step.output_required"]);
    // The Sponsor decides G1 (a synthetic demo business decision; it approves nothing real and is not DG0-DG7).
    const decided = await call<Body>(api.app, "POST", `${T}/gates/G1/decision`, {
      session: q.sponsor.session,
      body: {
        submissionNo: sub.body.submissionNo,
        outcome: "approved",
        rationale: "Synthetic demo decision; approves nothing real.",
        agreements: G1_AGREEMENTS,
      },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    const ok = await approve();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const done = await get(q.lead.session, id);
    expect(done.status).toBe("completed");
    expect(outputs(done)).toEqual([["prepare_submission", "gate_submission", submission.id]]);
  });
});

describe("bau_handover: prepared, accepted by the receiving business owner, then the recurring reviews", () => {
  it("links the handover; the BO's step approval needs the handover accepted; the TO closes the procedure", async () => {
    const s = await seedSustainmentWorld(api, w);
    const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
    await pinProcedures(api, w.orgA.id, s.b.transformationId, PROCEDURES_V1, s.b.users.tl.id);
    await mapPartyTo(api, s.b as never, "BO", s.b.users.bo.id);
    const res = await launch(s.b.s.tl, { procedureCode: "bau_handover", transformationId: s.b.transformationId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    await step(s.b.s.tl, id, "prepare_handover", "evidence", 1, {
      evidenceId: await createNoteEvidence(send, s.b, s.b.s.tl, s.b.users.tl.id),
    });
    // The WL prepares and submits the handover through the DG4 sustainment operations.
    const area = await createArea(send, s);
    await insertControl(api.db, s.b, area.id, null);
    const created = await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id, ...fullContent(s.b.users.bo.id) },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const H = `${s.handovers}/${(created.body as Body).id}`;
    const ev = await send("POST", `${H}/evidence`, {
      session: s.wl.session,
      headers: ifm(1),
      body: { evidenceId: await createNoteEvidence(send, s.b, s.wl.session, s.wl.id) },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const sub = await send("POST", `${H}/submit`, { session: s.wl.session, headers: ifm((ev.body as Body).version) });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const handoverId = (created.body as Body).id as string;
    const c1 = await step(s.b.s.tl, id, "prepare_handover", "complete", 2, { outputRecordId: handoverId });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    const approvalStep = c1.body.steps.find((x: Body) => x.stepKey === "accept_handover");
    expect([approvalStep.status, typeof approvalStep.approvalId]).toEqual(["active", "string"]);
    const a = (await call<Body>(api.app, "GET", `/api/v1/approvals/${approvalStep.approvalId}`, { session: s.b.s.bo }))
      .body;
    const approve = () =>
      call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
        session: s.b.s.bo,
        headers: ifm(a.version),
        body: { outcome: "approve", rationale: "Synthetic demo approval.", subjectVersion: a.subjectVersion },
      });
    expect(codeOf(await approve())).toEqual([422, "procedure_step.output_required"]);
    // The receiving owner accepts the handover through DG4 (bau_handover.accept), then approves the step.
    const accepted = await send("POST", `${H}/accept`, {
      session: s.b.s.bo,
      headers: ifm((sub.body as Body).version),
      body: {},
    });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect((await approve()).status).toBe(200);
    const mid = await get(s.b.s.tl, id);
    expect(mid.currentStepKeys).toEqual(["schedule_reviews"]);
    const done = await step(s.to.session, id, "schedule_reviews", "complete", mid.version);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe("completed");
    expect(outputs(done.body)).toEqual([["prepare_handover", "bau_handover", handoverId]]);
  });
});

describe("benefit_validation: evidence and the Finance validation in parallel; no recovery when on target", () => {
  it("links the evidence and the Finance decision; the recovery plan is not applicable", async () => {
    const b = await seedBenefitWorld(api, w);
    await pinProcedures(api, w.orgA.id, b.transformationId, PROCEDURES_V1, b.users.tl.id);
    const res = await launch(b.s.bo, {
      procedureCode: "benefit_validation",
      transformationId: b.transformationId,
      inputValues: { belowTarget: "no" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    const c1 = await step(b.s.bo, id, "measure_benefit", "complete", 1);
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(c1.body.currentStepKeys.sort()).toEqual(["attach_evidence", "finance_validation"]);
    // The evidence (DG2 evidence operation) is linked to the step and is its output.
    const ev = await evidence(b.transformationId, b.s.tl, b.users.tl.id);
    await step(b.s.bo, id, "attach_evidence", "evidence", 2, { evidenceId: ev });
    const c2 = await step(b.s.bo, id, "attach_evidence", "complete", 3, { outputRecordId: ev });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    // A benefit value is submitted (DG4) and queued for Finance; queued is not a Finance decision: 422.
    const ben = await measuredBenefit(api, b);
    const v = await submittedValue(api, b, ben.id, "250000", { periodStart: "2033-01-01", periodEnd: "2033-01-31" });
    expect(
      codeOf(await step(b.s.fin, id, "finance_validation", "complete", 4, { outputRecordId: v.validationId })),
    ).toEqual([422, "procedure_step.output_required"]);
    // Finance decides through the DG4 Finance queue (a human action by FIN), then completes the step.
    await approveValue(api, b, v, "240000.5");
    const c3 = await step(b.s.fin, id, "finance_validation", "complete", 4, { outputRecordId: v.validationId });
    expect(c3.status, JSON.stringify(c3.body)).toBe(200);
    expect(c3.body.status).toBe("completed");
    expect(c3.body.steps.find((x: Body) => x.stepKey === "recovery_plan").status).toBe("not_applicable");
    expect(outputs(c3.body).sort()).toEqual(
      [
        ["attach_evidence", "evidence", ev],
        ["finance_validation", "finance_validation", v.validationId],
      ].sort(),
    );
  });
});

describe("initiative_prioritization: scores, the ranking snapshot and the Sponsor's approval", () => {
  it("links the ranking snapshot the TO recorded and completes when the Sponsor approves", async () => {
    const q = await setupApprovalWorld(api, w);
    await pinProcedures(api, w.orgA.id, q.transformationId, PROCEDURES_V1, q.lead.id);
    const res = await launch(q.lead.session, {
      procedureCode: "initiative_prioritization",
      transformationId: q.transformationId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    // The TL scores an initiative through the DG3 scoring operation, then closes the scoring step.
    const ini = await insertInitiative(api, q.transformationId, q.lead.id, { code: "INI-01" });
    for (const [criterionCode, score] of Object.entries({
      strategic_fit: 4,
      financial_value: 3,
      customer_impact: 3,
      feasibility: 3,
      time_to_value: 3,
    })) {
      const r = await call<Body>(api.app, "POST", `/api/v1/initiatives/${ini.id}/scores`, {
        session: q.lead.session,
        body: { criterionCode, score },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const c1 = await step(q.lead.session, id, "score_initiatives", "complete", 1);
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    // The TO records the ranking snapshot through the DG3 operation and completes the step naming it.
    const snap = await call<Body>(
      api.app,
      "POST",
      `/api/v1/transformations/${q.transformationId}/prioritization/rankings`,
      {
        session: q.office.session,
        body: { note: "Synthetic ranking" },
      },
    );
    expect(snap.status, JSON.stringify(snap.body)).toBe(201);
    const snapshot = await api.db
      .selectFrom("ranking_snapshot")
      .select("id")
      .where("transformation_id", "=", q.transformationId)
      .where("status", "=", "current")
      .executeTakeFirstOrThrow();
    const c2 = await step(q.office.session, id, "record_ranking", "complete", 2, { outputRecordId: snapshot.id });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    const approvalStep = c2.body.steps.find((x: Body) => x.stepKey === "approve_ranking");
    const a = (
      await call<Body>(api.app, "GET", `/api/v1/approvals/${approvalStep.approvalId}`, { session: q.sponsor.session })
    ).body;
    const ok = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
      session: q.sponsor.session,
      headers: ifm(a.version),
      body: { outcome: "approve", rationale: "Synthetic demo approval.", subjectVersion: a.subjectVersion },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const done = await get(q.lead.session, id);
    expect(done.status).toBe("completed");
    expect(outputs(done)).toEqual([
      ["record_ranking", "ranking_snapshot", snapshot.id],
      ["approve_ranking", "approval", a.id],
    ]);
  });
});

describe("new_transformation_intake (organization scope)", () => {
  it("the intake creates the transformation and links its charter; the Sponsor step then waits for its approval", async () => {
    const tl = await createUser(api.db, w.orgA.id);
    // TL in the organization (acts on the organization-scope steps) and at the business unit (creates there, as DG1).
    await grant(api.db, w.grantor.id, tl.id, "TL", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, tl.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const tlSession = await signIn(api.app, tl.subject);
    const res = await launch(tlSession, {
      procedureCode: "new_transformation_intake",
      transformationId: null,
      inputValues: { transformationName: "Synthetic intake", caseForChange: "Synthetic case for change." },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    // Not yet created: naming nothing -> 422 output_required.
    expect(codeOf(await step(tlSession, id, "capture_intake", "complete", 1))).toEqual([
      422,
      "procedure_step.output_required",
    ]);
    const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
      session: tlSession,
      body: { businessUnitId: w.a1, name: "Synthetic intake", mode: "end_to_end" },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const c1 = await step(tlSession, id, "capture_intake", "complete", 1, { outputRecordId: t.body.id });
    expect(c1.status, JSON.stringify(c1.body)).toBe(200);
    expect(outputs(c1.body)).toEqual([["capture_intake", "transformation", t.body.id]]);
    // The charter is drafted through the DG2 charter operation (TL).
    const drafted = await call<Body>(api.app, "POST", `/api/v1/transformations/${t.body.id}/charter`, {
      session: tlSession,
      body: { transformationName: "Synthetic intake", caseForChange: "Synthetic case for change." },
    });
    expect(drafted.status, JSON.stringify(drafted.body)).toBe(201);
    const charterId = (
      await api.db
        .selectFrom("charter")
        .select("id")
        .where("transformation_id", "=", t.body.id)
        .executeTakeFirstOrThrow()
    ).id;
    expect(typeof charterId).toBe("string");
    // Another transformation's charter is not this intake's.
    const foreignCharter = await api.db
      .selectFrom("charter")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .executeTakeFirst();
    if (foreignCharter !== undefined)
      expect(
        codeOf(await step(tlSession, id, "draft_charter", "complete", 2, { outputRecordId: foreignCharter.id })),
      ).toEqual([422, "procedure_step.output_record_invalid"]);
    const c2 = await step(tlSession, id, "draft_charter", "complete", 2, { outputRecordId: charterId });
    expect(c2.status, JSON.stringify(c2.body)).toBe(200);
    expect(outputs(c2.body)).toEqual([
      ["capture_intake", "transformation", t.body.id],
      ["draft_charter", "charter", charterId],
    ]);
    expect(c2.body.currentStepKeys).toEqual(["confirm_sponsor"]);
    expect(c2.body.status).toBe("active");
    // D-166 Rule A (T-DG5-BE-T4): the later steps adopted the intake's transformation, so the Sponsor's approval is
    // requested there, routed by ITS role mappings. No Sponsor is mapped in it yet, so the step waits, truthfully
    // unrouted, and is never shown as approved or completed (the mapped and decided path: intake-adoption.test.ts).
    const sponsorStep = c2.body.steps.find((s: Body) => s.stepKey === "confirm_sponsor");
    expect([sponsorStep.status, sponsorStep.approvalId]).toEqual(["active", null]);
    expect([c2.body.nextAction.kind, c2.body.nextAction.messageKey]).toEqual([
      "await_approval",
      "procedures.next_action.await_approval_unrouted",
    ]);
  });
});
