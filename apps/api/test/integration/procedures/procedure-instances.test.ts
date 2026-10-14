// Procedure instances, steps and my procedures (ADR-0042 §2-§4, §7, §9-§11; REQ-S06-002, REQ-S06-001 (the launch half),
// REQ-S16-015 (ProcedureInstance create/read); p5-work-split §C.2; T-DG5-BE-F2) against a real PostgreSQL:
//  - REQ-S06-002 (A02 part): a `baseline_validation` instance shows `record_baseline` as its current step with its
//    assignee role and a working-day due date; its missing inputs are listed; completing without them -> 422
//    procedure_step.inputs_missing with `missingInputs`; the evidence rule; with an output adapter registered (a
//    synthetic stand-in for BE-G's baseline adapter) both steps complete, the baseline is linked and the instance
//    completes; without one -> 422 procedure_step.output_required, nothing written;
//  - a published Studio definition with a parallel and a conditional step launches: both parallel steps are active
//    together, a false condition -> not_applicable; its approval step completes only after the canonical approval is
//    approved by its business approver (the requester cannot decide it; completing it directly -> 422);
//  - a published v2 does not change a running v1 instance; a launch key twice creates one instance (409 replay);
//    Idempotency-Key replays the launch;
//  - every mutation: AUD 403; If-Match 428/409; one audit event per row written; launch by a role outside the launch
//    roles -> 403 procedure.launch_role; a non-assignee -> 403 procedure_step.not_assignee; commit-time authorization;
//  - my procedures lists the caller's active steps (assigned, or unassigned of a role held in scope).
// Every value is SYNTHETIC. The approvals decided here are demo BUSINESS approvals on synthetic records, decided by a
// synthetic business approver through the canonical approval; they approve nothing real and have nothing to do with the
// engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchProcedureInTx, registerProcedureOutputAdapter } from "../../../src/modules/procedures/index.ts";
import { unregisterProcedureOutputAdapter } from "../../../src/modules/procedures/steps.ts";
import { loadGrants } from "../../../src/modules/access/index.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { pinProcedures, publishProcedures } from "../../support/procedure-instance-fixtures.ts";
import { syntheticDefinitionBody } from "../../support/procedures-fixtures.ts";
import { methodologyAdmin } from "../../support/studio-fixtures.ts";
import { person, setupApprovalWorld, type ApprovalWorld, type Person } from "../approvals/approval-world.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const I = "/api/v1/procedure-instances";
const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];

let api: TestApi;
let w: World;
let p: ApprovalWorld;
let admin: Session;
let td: Person;
let wl: Session;
let auditor: Session;
/** The published synthetic `procedure` version (the ten seeded procedures plus vendor_onboarding). */
let published: string;

/** A fresh transformation of the same world (TL lead), with its own BO/SP/FIN mapping, pinned to `versionId`. */
async function freshWorld(versionId: string): Promise<ApprovalWorld> {
  const q = await setupApprovalWorld(api, w);
  await pinProcedures(api, w.orgA.id, q.transformationId, versionId, q.lead.id);
  return q;
}

const launch = (session: Session, body: Body, headers: Record<string, string> = {}) =>
  call<Body>(api.app, "POST", I, { session, body, headers });
const get = (session: Session, id: string) => call<Body>(api.app, "GET", `${I}/${id}`, { session });
const step = (session: Session, id: string, key: string, action: string, version: number | null, body: Body = {}) =>
  call<Body>(api.app, "POST", `${I}/${id}/steps/${key}/${action}`, {
    session,
    headers: version === null ? {} : ifm(version),
    body,
  });
const inputs = (session: Session, id: string, version: number | null, values: Body) =>
  call<Body>(api.app, "PATCH", `${I}/${id}/inputs`, {
    session,
    headers: version === null ? {} : ifm(version),
    body: { inputValues: values },
  });

async function evidence(q: ApprovalWorld): Promise<string> {
  const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/evidence`, {
    session: q.lead.session,
    body: { kind: "note", title: "Synthetic baseline extract", noteBody: "Synthetic", ownerUserId: q.lead.id },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function baseline(q: ApprovalWorld): Promise<string> {
  const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/baselines`, {
    session: q.lead.session,
    body: {
      metric: "Roaming revenue per month (synthetic)",
      unit: "SAR",
      scope: "revenue",
      value: "1250000",
      currency: "SAR",
      source: "Synthetic finance extract",
      baselineDate: "2026-01-31",
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
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
  admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  auditor = await signIn(api.app, w.auditor.subject);
  const reviewer = await signIn(api.app, w.office.subject);
  published = await publishProcedures(api, admin, reviewer);
  p = await freshWorld(published);
  td = await person(api, w, p.transformationId, "TD");
  wl = p.contributor.session;
}, 180_000);
afterAll(() => api.close());

describe("launch and the read model (REQ-S06-002, A02 part)", () => {
  it("a baseline_validation instance shows record_baseline as its current step with assignee, due date and missing inputs", async () => {
    const res = await launch(p.bo.session, {
      procedureCode: "baseline_validation",
      transformationId: p.transformationId,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers["location"]).toBe(`${I}/${res.body.id}`);
    expect(res.headers["etag"]).toBe('"1"');
    const b = res.body;
    expect(b).toMatchObject({
      procedureCode: "baseline_validation",
      transformationId: p.transformationId,
      methodologyVersionId: published,
      status: "active",
      currentStepKeys: ["record_baseline"],
      version: 1,
    });
    const [first, second] = b.steps;
    expect([first.stepKey, first.status, first.assigneeRoleCode, first.assigneeUserId]).toEqual([
      "record_baseline",
      "active",
      "BO",
      null,
    ]);
    // Working-day due date on the organization's calendar (never Unknown here: the world has a default calendar).
    expect(first.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([first.dueDateUnknownReason, first.overdue]).toEqual([null, false]);
    expect(b.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([second.stepKey, second.status, second.dueDate, second.dueDateUnknownReason]).toEqual([
      "validate_baseline",
      "pending",
      null,
      "not_active",
    ]);
    // Missing inputs: every required input, with its labels; the next action asks for the first.
    expect(b.missingInputs.map((m: Body) => m.key)).toEqual(["metric", "value", "unit", "baselineDate", "source"]);
    expect(b.missingInputs[0]).toEqual({ key: "metric", labelEn: "Metric", labelAr: "المقياس" });
    expect(b.nextAction).toMatchObject({
      kind: "provide_input",
      stepKey: "record_baseline",
      messageKey: "procedures.next_action.provide_input",
    });
    expect(first.missingInputs).toEqual(["metric", "value", "unit", "baselineDate", "source"]);
    // One audit event per row written (instance + 2 steps created + 1 activation), all in the request.
    const events = await auditOfRequest(api.db, res.headers["x-request-id"] as string);
    expect(events.map((e) => e.action).sort()).toEqual([
      "procedure_instance.launch",
      "procedure_step_instance.activate",
      "procedure_step_instance.create",
      "procedure_step_instance.create",
    ]);
    // The activation is on the outbox for the slice E rule actions (exactly once per step).
    const out = await api.db
      .selectFrom("outbox_event")
      .select(["event_type", "idempotency_key"])
      .where("aggregate_type", "=", "procedure_step_instance")
      .where("payload", "@>", sql<never>`${JSON.stringify({ instanceId: b.id })}::jsonb`)
      .execute();
    expect(out.map((o) => o.event_type)).toEqual(["procedure_step.activated"]);
    // GET reads the same; AUD reads; a person without procedure.read outside scope gets 404.
    expect((await get(auditor, b.id)).body.currentStepKeys).toEqual(["record_baseline"]);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await get(nobody, b.id)).status).toBe(404);
  });

  it("completing without the inputs -> 422 inputs_missing with missingInputs; then the evidence rule; then output_required", async () => {
    const res = await launch(p.bo.session, {
      procedureCode: "baseline_validation",
      transformationId: p.transformationId,
    });
    const id = res.body.id as string;
    const miss = await step(p.bo.session, id, "record_baseline", "complete", 1);
    expect(codeOf(miss)).toEqual([422, "procedure_step.inputs_missing"]);
    expect(miss.body.detail).toBe("Provide the missing inputs before completing this step.");
    expect(miss.body.missingInputs.map((m: Body) => m.key)).toEqual([
      "metric",
      "value",
      "unit",
      "baselineDate",
      "source",
    ]);
    // An input that does not match its field type -> 422 procedure.input_invalid (Arabic-Indic digits are no decimal).
    expect(codeOf(await inputs(p.bo.session, id, 1, { value: "١٢" }))).toEqual([422, "procedure.input_invalid"]);
    expect(codeOf(await inputs(p.bo.session, id, 1, { notDeclared: "x" }))).toEqual([422, "procedure.input_invalid"]);
    const put = await inputs(p.bo.session, id, 1, BASELINE_INPUTS);
    expect([put.status, put.body.version, put.body.missingInputs]).toEqual([200, 2, []]);
    expect(put.body.inputValues.value).toBe("1250000.10"); // decimal string, exactly
    expect(put.body.nextAction.kind).toBe("link_evidence");
    expect(codeOf(await step(p.bo.session, id, "record_baseline", "complete", 2))).toEqual([
      422,
      "procedure_step.evidence_required",
    ]);
    const ev = await evidence(p);
    const linked = await step(p.bo.session, id, "record_baseline", "evidence", 2, { evidenceId: ev });
    expect([linked.status, linked.body.version]).toEqual([200, 3]);
    expect(linked.body.links.map((l: Body) => [l.stepKey, l.linkKind, l.recordType, l.recordId])).toEqual([
      ["record_baseline", "evidence", "evidence", ev],
    ]);
    // No output adapter for `baseline` (BE-G's): the completion is refused and nothing is written.
    const refused = await step(p.bo.session, id, "record_baseline", "complete", 3);
    expect(codeOf(refused)).toEqual([422, "procedure_step.output_required"]);
    expect((await get(p.bo.session, id)).body).toMatchObject({ version: 3, currentStepKeys: ["record_baseline"] });
  });

  it("with a baseline adapter both steps complete, the validated baseline is linked and the instance completes", async () => {
    const baselineId = await baseline(p);
    // A synthetic stand-in for BE-G's adapter: it names the baseline record the test created through the DG3 API.
    registerProcedureOutputAdapter({ recordType: "baseline", produce: async () => ({ recordId: baselineId }) });
    try {
      const res = await launch(p.bo.session, {
        procedureCode: "baseline_validation",
        transformationId: p.transformationId,
        inputValues: BASELINE_INPUTS,
      });
      const id = res.body.id as string;
      await step(p.bo.session, id, "record_baseline", "evidence", 1, { evidenceId: await evidence(p) });
      const done1 = await step(p.bo.session, id, "record_baseline", "complete", 2, { note: "Recorded (synthetic)." });
      expect(done1.status, JSON.stringify(done1.body)).toBe(200);
      expect(done1.body.currentStepKeys).toEqual(["validate_baseline"]);
      expect(done1.body.steps[1]).toMatchObject({ assigneeRoleCode: "FIN", status: "active" });
      // The BO cannot act on the FIN step (not the assignee, not a holder of its role).
      expect(codeOf(await step(p.bo.session, id, "validate_baseline", "complete", 3))).toEqual([
        403,
        "procedure_step.not_assignee",
      ]);
      const done2 = await step(p.fin.session, id, "validate_baseline", "complete", 3);
      expect(done2.status, JSON.stringify(done2.body)).toBe(200);
      expect([done2.body.status, done2.body.currentStepKeys, done2.body.nextAction.kind]).toEqual([
        "completed",
        [],
        "none",
      ]);
      expect(
        done2.body.links.filter((l: Body) => l.linkKind === "output").map((l: Body) => [l.recordType, l.recordId]),
      ).toEqual([["baseline", baselineId]]);
      expect(codeOf(await step(p.fin.session, id, "validate_baseline", "complete", done2.body.version))).toEqual([
        422,
        "procedure.not_active",
      ]);
    } finally {
      unregisterProcedureOutputAdapter("baseline");
    }
  });
});

describe("parallel, conditional and approval steps (a published Studio definition)", () => {
  it("both parallel steps are active, a false condition is not applicable, the approval step completes only through the canonical approval", async () => {
    const res = await launch(p.lead.session, {
      procedureCode: "vendor_onboarding",
      transformationId: p.transformationId,
      inputValues: {
        vendorName: "Synthetic Co",
        contractValue: { amount: "1000000.00", currencyCode: "SAR" },
        legalReview: "no",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.id as string;
    expect(res.body.currentStepKeys).toEqual(["collect"]);
    const c = await step(p.lead.session, id, "collect", "complete", 1);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    // contractValue >= 1000000.00 (decimal comparison) -> finance_check runs; legalReview = "no" -> legal_check N/A.
    const byKey = new Map(c.body.steps.map((s: Body) => [s.stepKey, s.status]));
    expect([byKey.get("finance_check"), byKey.get("legal_check"), byKey.get("sponsor_approval")]).toEqual([
      "active",
      "not_applicable",
      "pending",
    ]);
    expect(c.body.currentStepKeys).toEqual(["finance_check"]);
    const f = await step(p.fin.session, id, "finance_check", "complete", 2);
    expect(f.status, JSON.stringify(f.body)).toBe(200);
    const approvalStep = f.body.steps.find((s: Body) => s.stepKey === "sponsor_approval");
    expect([approvalStep.status, approvalStep.assigneeRoleCode, typeof approvalStep.approvalId]).toEqual([
      "active",
      "SP",
      "string",
    ]);
    expect(f.body.nextAction).toMatchObject({
      kind: "await_approval",
      messageKey: "procedures.next_action.await_approval",
    });
    // Completing the approval step directly -> 422 decided_through_approval (nothing written).
    expect(codeOf(await step(p.lead.session, id, "sponsor_approval", "complete", 3))).toEqual([
      422,
      "procedure_step.decided_through_approval",
    ]);
    expect(codeOf(await step(p.lead.session, id, "sponsor_approval", "skip", 3, { reason: "Not needed." }))).toEqual([
      422,
      "procedure_step.not_skippable",
    ]);
    // The canonical approval: requested by the person whose action activated the step (FIN), routed to SP.
    const a = await call<Body>(api.app, "GET", `/api/v1/approvals/${approvalStep.approvalId}`, {
      session: p.sponsor.session,
    });
    expect([a.status, a.body.approvalType, a.body.requestedBy, a.body.status]).toEqual([
      200,
      "procedure_step",
      p.fin.id,
      "pending",
    ]);
    // The requester cannot decide it (separation of duties); the business approver does.
    const self = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.body.id}/decisions`, {
      session: p.fin.session,
      headers: ifm(a.body.version),
      body: { outcome: "approve", rationale: "Synthetic.", subjectVersion: a.body.subjectVersion },
    });
    expect(self.status).toBe(403);
    expect((await get(p.lead.session, id)).body.status).toBe("active");
    const ok = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.body.id}/decisions`, {
      session: p.sponsor.session,
      headers: ifm(a.body.version),
      body: { outcome: "approve", rationale: "Synthetic demo approval.", subjectVersion: a.body.subjectVersion },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = (await get(p.lead.session, id)).body;
    expect(after.status).toBe("completed");
    const done = after.steps.find((s: Body) => s.stepKey === "sponsor_approval");
    expect([done.status, done.approvalId, done.completedBy]).toEqual(["completed", a.body.id, p.sponsor.id]);
    expect(after.links.map((l: Body) => [l.stepKey, l.recordType, l.recordId])).toEqual([
      ["sponsor_approval", "approval", a.body.id],
    ]);
  });

  it("a running instance stays on its definition version when a newer version is published", async () => {
    const q = await freshWorld(published);
    const res = await launch(q.lead.session, {
      procedureCode: "vendor_onboarding",
      transformationId: q.transformationId,
      inputValues: {
        vendorName: "Synthetic Co",
        contractValue: { amount: "5.00", currencyCode: "SAR" },
        legalReview: "yes",
      },
    });
    const id = res.body.id as string;
    const pinnedDef = res.body.procedureDefinitionId as string;
    // v2: a new draft of the same key edits the procedure and is published; the pin moves to v2 (as a migration would).
    const reviewer = await signIn(api.app, w.office.subject);
    const d = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: published } });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const v2 = d.body.id as string;
    const versionOf = async () => (await call<Body>(api.app, "GET", `${V}/${v2}`, { session: admin })).body.version;
    const body = syntheticDefinitionBody({ nameEn: "Synthetic vendor onboarding v2" });
    expect(
      (
        await call<Body>(api.app, "PUT", `/api/v1/admin/procedure-definitions/${v2}/vendor_onboarding`, {
          session: admin,
          headers: ifm(await versionOf()),
          body,
        })
      ).status,
    ).toBe(200);
    for (const [path, b] of [
      ["preview", { samples: [] }],
      ["compatibility-checks", undefined],
    ] as const)
      expect(
        (
          await call<Body>(api.app, "POST", `${V}/${v2}/${path}`, {
            session: admin,
            headers: ifm(await versionOf()),
            body: b,
          })
        ).status,
      ).toBe(201);
    const sub = await call<Body>(api.app, "POST", `${V}/${v2}/submit-review`, {
      session: admin,
      headers: ifm(await versionOf()),
      body: {},
    });
    await call(api.app, "POST", `${V}/${v2}/reviews/${sub.body.id}/decision`, {
      session: reviewer,
      headers: ifm(1),
      body: { outcome: "approve" },
    });
    const pub = await call<Body>(api.app, "POST", `${V}/${v2}/publish`, {
      session: admin,
      headers: ifm(await versionOf()),
    });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const after = (await get(q.lead.session, id)).body;
    expect([after.procedureDefinitionId, after.methodologyVersionId, after.nameEn]).toEqual([
      pinnedDef,
      published,
      "Synthetic vendor onboarding",
    ]);
    // A launch in a transformation pinned to v2 uses v2.
    const r = await freshWorld(v2);
    const l2 = await launch(r.lead.session, {
      procedureCode: "vendor_onboarding",
      transformationId: r.transformationId,
      inputValues: {
        vendorName: "Synthetic Co",
        contractValue: { amount: "5.00", currencyCode: "SAR" },
        legalReview: "yes",
      },
    });
    expect([l2.status, l2.body.methodologyVersionId, l2.body.nameEn]).toEqual([
      201,
      v2,
      "Synthetic vendor onboarding v2",
    ]);
  });
});

describe("exactly once", () => {
  it("a launch key twice creates one instance (409 procedure.launch_replayed); Idempotency-Key replays a user launch", async () => {
    const key = `test:launch:${uuidv7()}`;
    const run = () =>
      api.db.transaction().execute(async (tx) => {
        const principal = {
          kind: "user" as const,
          userId: p.lead.id,
          organizationId: w.orgA.id,
          grants: await loadGrants(tx, p.lead.id),
          tracker: { decisions: 0 },
        };
        return launchProcedureInTx(tx, { actorUserId: p.lead.id, requestId: uuidv7() }, principal, {
          procedureCode: "baseline_validation",
          transformationId: p.transformationId,
          launchKey: key,
        });
      });
    const first = await run();
    await expect(run()).rejects.toMatchObject({ status: 409, code: "procedure.launch_replayed" });
    const rows = await api.db.selectFrom("procedure_instance").select("id").where("launch_key", "=", key).execute();
    expect(rows.map((r) => r.id)).toEqual([first.instance.id]);

    const headers = { "idempotency-key": `idem-${uuidv7()}` };
    const body = { procedureCode: "baseline_validation", transformationId: p.transformationId };
    const a = await launch(p.bo.session, body, headers);
    const b = await launch(p.bo.session, body, headers);
    expect([a.status, b.status, b.body.id]).toEqual([201, 201, a.body.id]);
  });
});

describe("authorization, If-Match and refusals", () => {
  it("launch: AUD 403, a role outside the launch roles 403 procedure.launch_role, scope and publication refusals, 404", async () => {
    const body = { procedureCode: "baseline_validation", transformationId: p.transformationId };
    expect((await launch(auditor, body)).status).toBe(403);
    expect(codeOf(await launch(wl, body))).toEqual([403, "procedure.launch_role"]);
    // An organization-level reader (TO, a launch role) launching a transformation-scope procedure without one -> 422.
    expect(codeOf(await launch(p.office.session, { ...body, transformationId: null }))).toEqual([
      422,
      "procedure.scope_mismatch",
    ]);
    expect((await launch(p.lead.session, { ...body, procedureCode: "no_such_procedure" })).status).toBe(404);
    expect((await launch(p.lead.session, { ...body, procedureCode: "Bad" })).status).toBe(400);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await launch(nobody, body)).status).toBe(403);
    // A launcher who cannot read the transformation gets 404 (existence never disclosed).
    expect(
      (await launch(p.bo.session, { ...body, transformationId: (await setupApprovalWorld(api, w)).transformationId }))
        .status,
    ).toBe(404);
  });

  it("step writes: 428 without If-Match, 409 when stale, AUD 403, not_active, skip and assign rules, cancel", async () => {
    const res = await launch(p.lead.session, {
      procedureCode: "baseline_validation",
      transformationId: p.transformationId,
    });
    const id = res.body.id as string;
    expect((await step(p.bo.session, id, "record_baseline", "complete", null)).status).toBe(428);
    const stale = await step(p.bo.session, id, "record_baseline", "complete", 7);
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect((await step(auditor, id, "record_baseline", "complete", 1)).status).toBe(403);
    expect((await inputs(auditor, id, 1, { metric: "x" })).status).toBe(403);
    expect((await inputs(p.bo.session, id, null, { metric: "x" })).status).toBe(428);
    // FIN holds the (pending) FIN step's role: 422 not_active; the BO does not: 403 not_assignee.
    expect(codeOf(await step(p.fin.session, id, "validate_baseline", "complete", 1))).toEqual([
      422,
      "procedure_step.not_active",
    ]);
    expect(codeOf(await step(p.bo.session, id, "validate_baseline", "complete", 1))).toEqual([
      403,
      "procedure_step.not_assignee",
    ]);
    expect(codeOf(await step(p.bo.session, id, "record_baseline", "skip", 1, { reason: "Synthetic skip." }))).toEqual([
      422,
      "procedure_step.not_skippable",
    ]);
    expect((await step(p.bo.session, id, "no_such_step", "complete", 1)).status).toBe(404);
    // Assign: procedure.manage (TL) to a holder of the step's role; a person without it -> 422; BO cannot assign.
    expect((await step(p.bo.session, id, "validate_baseline", "assign", 1, { assigneeUserId: p.fin.id })).status).toBe(
      403,
    );
    expect(
      codeOf(await step(p.lead.session, id, "validate_baseline", "assign", 1, { assigneeUserId: p.bo.id })),
    ).toEqual([422, "validation.user_invalid"]);
    const assigned = await step(p.lead.session, id, "validate_baseline", "assign", 1, { assigneeUserId: p.fin.id });
    expect([assigned.status, assigned.body.version, assigned.body.steps[1].assigneeUserId]).toEqual([200, 2, p.fin.id]);
    expect(codeOf(await step(p.bo.session, id, "validate_baseline", "complete", 2))).toEqual([
      403,
      "procedure_step.not_assignee",
    ]);
    expect(codeOf(await step(p.fin.session, id, "validate_baseline", "complete", 2))).toEqual([
      422,
      "procedure_step.not_active",
    ]);
    // Cancel: procedure.manage, a reason; open steps are cancelled; then nothing moves (not_active).
    const C = `${I}/${id}/cancel`;
    expect((await call(api.app, "POST", C, { session: p.lead.session, body: { reason: "Synthetic." } })).status).toBe(
      428,
    );
    expect(
      (await call(api.app, "POST", C, { session: p.bo.session, headers: ifm(2), body: { reason: "Synthetic." } }))
        .status,
    ).toBe(403);
    expect(
      (await call(api.app, "POST", C, { session: p.lead.session, headers: ifm(2), body: { reason: "  " } })).status,
    ).toBe(400);
    const cancelled = await call<Body>(api.app, "POST", C, {
      session: p.lead.session,
      headers: ifm(2),
      body: { reason: "Synthetic: no longer needed." },
    });
    expect([cancelled.status, cancelled.body.status, cancelled.body.cancelReason]).toEqual([
      200,
      "cancelled",
      "Synthetic: no longer needed.",
    ]);
    expect(cancelled.body.steps.map((s: Body) => s.status)).toEqual(["cancelled", "cancelled"]);
    expect(cancelled.body.nextAction).toMatchObject({
      kind: "none",
      messageKey: "procedures.next_action.none_cancelled",
    });
    const events = await auditOfRequest(api.db, cancelled.headers["x-request-id"] as string);
    expect(events.map((e) => e.action).sort()).toEqual([
      "procedure_instance.cancel",
      "procedure_step_instance.cancel",
      "procedure_step_instance.cancel",
    ]);
    expect(
      codeOf(
        await call<Body>(api.app, "POST", C, { session: p.lead.session, headers: ifm(3), body: { reason: "Again." } }),
      ),
    ).toEqual([422, "procedure.not_active"]);
    expect(codeOf(await inputs(p.lead.session, id, 3, { metric: "x" }))).toEqual([422, "procedure.not_active"]);
  });

  it("commit-time authorization: a grant revoked during the request -> 403, nothing written", async () => {
    const holder = await createUser(api.db, w.orgA.id);
    const assignment = await grant(
      api.db,
      w.grantor.id,
      holder.id,
      "BO",
      { type: "transformation", id: p.transformationId },
      w.orgA.id,
    );
    const s = await signIn(api.app, holder.subject);
    const res = await launch(s, { procedureCode: "baseline_validation", transformationId: p.transformationId });
    expect(res.status).toBe(201);
    const id = res.body.id as string;
    await api.db
      .updateTable("scoped_assignment")
      .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "Synthetic revocation" })
      .where("id", "=", assignment)
      .execute();
    const r = await inputs(s, id, 1, { metric: "x" });
    expect([403, 404]).toContain(r.status);
    expect((await auditOf(api.db, id)).map((e) => e.action)).toEqual(["procedure_instance.launch"]);
  });
});

describe("lists", () => {
  it("lists instances in scope (filters, cursor) and my procedures (assigned or unassigned of my role)", async () => {
    const q = await freshWorld(published);
    const a = await launch(q.bo.session, {
      procedureCode: "baseline_validation",
      transformationId: q.transformationId,
    });
    const b = await launch(q.bo.session, {
      procedureCode: "baseline_validation",
      transformationId: q.transformationId,
    });
    const L = `${I}?transformationId=${q.transformationId}&limit=1`;
    const page1 = await call<Body>(api.app, "GET", L, { session: auditor });
    expect([page1.status, page1.body.items.map((x: Body) => x.id), typeof page1.body.nextCursor]).toEqual([
      200,
      [b.body.id],
      "string",
    ]);
    const page2 = await call<Body>(api.app, "GET", `${L}&cursor=${page1.body.nextCursor}`, { session: auditor });
    expect(page2.body.items.map((x: Body) => x.id)).toEqual([a.body.id]);
    expect(
      (
        await call<Body>(api.app, "GET", `${I}?transformationId=${q.transformationId}&status=completed`, {
          session: auditor,
        })
      ).body.items,
    ).toEqual([]);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", I, { session: nobody })).status).toBe(403);
    // A BO of ANOTHER transformation does not see these instances.
    const other = await call<Body>(api.app, "GET", `${I}?transformationId=${q.transformationId}`, {
      session: p.bo.session,
    });
    expect(other.body.items).toEqual([]);

    const mine = await call<Body>(api.app, "GET", "/api/v1/me/procedure-steps?limit=50", { session: q.bo.session });
    expect(mine.status).toBe(200);
    expect(
      mine.body.items
        .filter((x: Body) => [a.body.id, b.body.id].includes(x.instanceId))
        .map((x: Body) => x.step.stepKey),
    ).toEqual(["record_baseline", "record_baseline"]);
    const fin = await call<Body>(api.app, "GET", "/api/v1/me/procedure-steps", { session: q.fin.session });
    expect(fin.body.items.filter((x: Body) => [a.body.id, b.body.id].includes(x.instanceId))).toEqual([]);
    expect((await call(api.app, "GET", "/api/v1/me/procedure-steps", { session: nobody })).status).toBe(403);
    // TD is a user of another transformation's world; unrelated steps never appear.
    const tdMine = await call<Body>(api.app, "GET", "/api/v1/me/procedure-steps", { session: td.session });
    expect(tdMine.body.items.filter((x: Body) => [a.body.id, b.body.id].includes(x.instanceId))).toEqual([]);
  });
});
