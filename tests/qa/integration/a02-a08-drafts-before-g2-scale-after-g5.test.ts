// A02 / A08 / REQ-S03-004 "drafts at any time, gate approvals before execution or scaling" (qa-verifier, T-DG4-QA-D).
// Acceptance text (docs/delivery/requirements.csv): "A02;A08: a Design-phase draft can be saved before G2; a scale
// transition before G5 approval returns 422 invalid-transition naming G5; after approval it succeeds".
//
// Closes the coverage gap T-DG4-AN-P4A recorded: the clause "a Design-phase draft can be saved before G2" was proven
// only implicitly (DG2 registers.test.ts never pins G2's state). The ONE test below walks the whole clause on one
// transformation, in order:
//   1. G2 is asserted NOT approved (API gate view and database; no G2 decision exists) while the transformation is in
//      Diagnose and then, after a native G1 approval, in Define (the phase G2 closes; Design starts only after G2);
//   2. Design-phase drafts are saved through the API and succeed: a T03 TOM gap (201) in Diagnose, and in Define a
//      second T03 gap (201) plus a TOM canvas box edited and kept in `draft` (200); each is persisted with its audit
//      event, and saving them approved nothing (G2 still not approved);
//   3. G2-G4 are passed natively; a scale transition before G5 approval is 422 invalid-transition
//      gate.g5_not_approved naming G5, and writes no scale_transition row;
//   4. G5 is approved natively (with its scale scope), and the same scale transition then succeeds (201), bound to that
//      G5 decision.
//
// Black-box through the REAL API (Fastify inject; every request and response validated against docs/api/openapi.yaml by
// the harness) on the run's disposable PostgreSQL. The world is QA-B's native world builder (tests/qa/support/
// gates-native.ts): transformation created by the Lead, roles granted through the access API, every missing mandatory
// gate criterion covered by an exception the gate's approver accepts, submitted by the Lead, approved by the approver.
// All data is SYNTHETIC. Every gate decision is a synthetic in-product business action by a test person on test data;
// it approves nothing real and never touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "../../../packages/db/src/index.ts";
import { call, startApi, type TestApi } from "../support/api.ts";
import {
  coverWithException,
  decideGate,
  gateView,
  ifm,
  missingKeys,
  passGatesNatively,
  plusDays,
  seedNativeGateWorld,
  submitGate,
  type Body,
  type NativeGateWorld,
  type Person,
} from "../support/gates-native.ts";
import { seedWorld, type World } from "../support/p4.ts";

let api: TestApi;
let w: World;
let today: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const r = await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(api.db);
  today = r.rows[0]!.d;
}, 60_000);
afterAll(() => api?.close());

const send = (method: string, url: string, opts?: Parameters<typeof call>[3]) => call<Body>(api.app, method, url, opts);

const gateRow = (g: NativeGateWorld, code: string) =>
  api.db
    .selectFrom("gate_instance")
    .select(["status", "version"])
    .where("transformation_id", "=", g.transformationId)
    .where("gate_code", "=", code)
    .executeTakeFirstOrThrow();
const decisionCount = async (g: NativeGateWorld, code: string) =>
  (
    await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", g.transformationId)
      .where("gate_code", "=", code)
      .execute()
  ).length;
const auditCountOf = async (recordId: string, action: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("record_id", "=", recordId)
      .where("action", "=", action)
      .execute()
  ).length;
const scaleRows = (g: NativeGateWorld) =>
  api.db
    .selectFrom("scale_transition")
    .select(["initiative_id", "business_unit_id", "gate_decision_id"])
    .where("transformation_id", "=", g.transformationId)
    .execute();

/** G2 is not approved: the API gate view, the gate_instance row and the absence of any G2 decision agree. */
async function expectG2NotApproved(g: NativeGateWorld): Promise<void> {
  const view = await gateView(api, g, "G2", g.auditor.session);
  expect(view.gate.status).not.toBe("approved");
  expect(view.gate.status).toBe("draft");
  expect((await gateRow(g, "G2")).status).toBe("draft");
  expect(await decisionCount(g, "G2")).toBe(0);
}

async function currentPhase(g: NativeGateWorld): Promise<string> {
  const t = await send("GET", g.base, { session: g.auditor.session });
  expect(t.status, JSON.stringify(t.body)).toBe(200);
  return t.body.currentPhase as string;
}

/** Saves a T03 TOM gap (a Design-phase record) as the Lead and checks it is persisted with its audit event. */
async function saveDesignGap(g: NativeGateWorld, dimensionCode: string, label: string): Promise<Body> {
  const gap = await send("POST", `${g.base}/tom-gaps`, {
    session: g.tl.session,
    body: {
      dimensionCode,
      currentState: `Synthetic QA-D current state (${label})`,
      targetState: `Synthetic QA-D target state (${label})`,
      gap: `Synthetic QA-D design gap saved before G2 (${label})`,
    },
  });
  expect(gap.status, JSON.stringify(gap.body)).toBe(201);
  expect([gap.body.transformationId, gap.body.dimensionCode, gap.body.status, gap.body.version]).toEqual([
    g.transformationId,
    dimensionCode,
    "open",
    1,
  ]);
  const row = await api.db
    .selectFrom("tom_gap")
    .select(["gap", "status"])
    .where("id", "=", gap.body.id)
    .executeTakeFirstOrThrow();
  expect(row).toEqual({ gap: `Synthetic QA-D design gap saved before G2 (${label})`, status: "open" });
  expect(await auditCountOf(gap.body.id, "tom_gap.create")).toBe(1);
  return gap.body;
}

describe("REQ-S03-004 (A02, A08): a Design-phase draft saves before G2; scaling is refused before G5 and allowed after", () => {
  it("G2 not approved -> Design drafts saved (201/200); G2-G4 passed; scale before G5 is 422 naming G5; G5 approved -> scale 201", async () => {
    const g = await seedNativeGateWorld(api, w, "A02 A08 QA-D");
    const expiresOn = plusDays(today, 90);

    // ---- 1 + 2a: Diagnose, G2 not approved, a Design-phase T03 gap is saved.
    expect(await currentPhase(g)).toBe("diagnose");
    await expectG2NotApproved(g);
    const canvas = await send("GET", `${g.base}/tom-canvas`, { session: g.tl.session });
    expect(canvas.status, JSON.stringify(canvas.body)).toBe(200);
    const dimensionCode = canvas.body.cells[0].cell.dimensionCode as string;
    await saveDesignGap(g, dimensionCode, "Diagnose");
    await expectG2NotApproved(g);

    // ---- 1 + 2b: G1 approved natively -> Define (the phase G2 closes); G2 still not approved; Design drafts save.
    await passGatesNatively(api, g, ["G1"], expiresOn);
    expect(await currentPhase(g)).toBe("define");
    await expectG2NotApproved(g);
    await saveDesignGap(g, dimensionCode, "Define");
    const box = await send("GET", `${g.base}/tom-canvas/${dimensionCode}`, { session: g.tl.session });
    expect(box.status, JSON.stringify(box.body)).toBe(200);
    expect(box.body.cell.status).toBe("draft");
    const cellAuditsBefore = await auditCountOf(box.body.cell.id, "tom_canvas_cell.update");
    const TARGET = "Synthetic QA-D target design drafted before G2";
    const saved = await send("PATCH", `${g.base}/tom-canvas/${dimensionCode}`, {
      session: g.tl.session,
      headers: ifm(box.body.cell.version),
      body: { targetDesign: TARGET },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    // The response is the TomCanvasCellView (the box with its linked records).
    expect([saved.body.cell.targetDesign, saved.body.cell.status, saved.body.cell.version]).toEqual([
      TARGET,
      "draft",
      box.body.cell.version + 1,
    ]);
    const cellRow = await api.db
      .selectFrom("tom_canvas_cell")
      .select(["target_design", "status"])
      .where("id", "=", box.body.cell.id)
      .executeTakeFirstOrThrow();
    expect(cellRow).toEqual({ target_design: TARGET, status: "draft" });
    expect(await auditCountOf(box.body.cell.id, "tom_canvas_cell.update")).toBe(cellAuditsBefore + 1);
    // Saving drafts approved nothing and moved no phase.
    await expectG2NotApproved(g);
    expect(await currentPhase(g)).toBe("define");

    // ---- 3: G2-G4 passed natively; a scale transition before G5 approval is 422 invalid-transition naming G5.
    await passGatesNatively(api, g, ["G2", "G3", "G4"], expiresOn);
    expect(await currentPhase(g)).toBe("transform");
    const ini = await send("POST", "/api/v1/initiatives", {
      session: g.tl.session,
      body: { transformationId: g.transformationId, name: "Synthetic QA-D scale pilot" },
    });
    expect(ini.status, JSON.stringify(ini.body)).toBe(201);
    const initiativeId = ini.body.id as string;
    expect((await gateView(api, g, "G5", g.auditor.session)).gate.status).not.toBe("approved");
    expect(await decisionCount(g, "G5")).toBe(0);
    const before = await send("POST", `${g.base}/scale-transitions`, {
      session: g.tl.session,
      body: { initiativeId, businessUnitId: w.a1, note: "Synthetic QA-D scale wave" },
    });
    expect(before.status, JSON.stringify(before.body)).toBe(422);
    expect(String(before.headers["content-type"])).toContain("application/problem+json");
    expect([before.body.type, before.body.code]).toEqual([
      "urn:mth:problem:invalid-transition",
      "gate.g5_not_approved",
    ]);
    expect(String(before.body.detail)).toMatch(/\bG5\b/);
    expect(await scaleRows(g)).toEqual([]);

    // ---- 4: G5 approved natively (approver as configured on the gate), then the same scale transition succeeds.
    const g5 = await gateView(api, g, "G5");
    const approverRole = g5.gate.approverRoleCode as string;
    const approver: Person | undefined = ({ SP: g.sp, BO: g.bo } as Record<string, Person>)[approverRole];
    expect(approver, `G5 approver role ${approverRole}`).toBeTruthy();
    for (const key of await missingKeys(api, g, "G5"))
      await coverWithException(api, g, "G5", key, expiresOn, approver!.session);
    const sub = await submitGate(api, g, "G5");
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const decided = await decideGate(api, g, "G5", approver!.session, {
      submissionNo: sub.body.submissionNo,
      outcome: "approved",
      rationale: "Synthetic QA-D approval of G5 (approves nothing real).",
      scaleScope: { items: [{ initiativeId, businessUnitId: w.a1, note: "Synthetic QA-D pilot BU" }] },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    expect((await gateRow(g, "G5")).status).toBe("approved");
    const after = await send("POST", `${g.base}/scale-transitions`, {
      session: g.tl.session,
      body: { initiativeId, businessUnitId: w.a1, note: "Synthetic QA-D scale wave" },
    });
    expect(after.status, JSON.stringify(after.body)).toBe(201);
    expect([after.body.initiativeId, after.body.businessUnitId]).toEqual([initiativeId, w.a1]);
    expect(await scaleRows(g)).toEqual([
      { initiative_id: initiativeId, business_unit_id: w.a1, gate_decision_id: decided.body.id },
    ]);
    expect(await auditCountOf(after.body.id, "scale_transition.create")).toBe(1);
  }, 300_000);
});
