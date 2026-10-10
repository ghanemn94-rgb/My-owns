// Product gates G5 "Scale" and G6 "Sustain" (T-DG4-BE-K; ADR-0035 §2, §5; REQ-PB-015, REQ-PB-020, REQ-PB-021,
// REQ-S04-002, REQ-S04-007, REQ-S04-008) against a real PostgreSQL:
//  - G5 with an open High-impact risk and no approved disposition -> 422 whose detail and errors list "Risk closure";
//    with an approved disposition (decided by the Sponsor through the approval service) the criterion is complete;
//  - G5 configured to BO: an SP decision -> 403 gate.not_approver, a BO decision -> 201;
//  - the scale-scope rules: a G5 approval without scaleScope -> 422; scaleScope on G4 or on a G5 rejection -> 422;
//    an item outside the organization -> 422 at /scaleScope/items/0; nothing written;
//  - G6 without an accepted BAU handover -> 422 listing "Ownership transfer"; with every fact present G6 is submitted
//    with a `g6` snapshot member that does not change when a record is edited afterwards; its approval changes no phase,
//    closes nothing, and writes none of the engineering delivery records a G6 approval could be confused with
//    (docs/delivery/gates/**, stages.json, findings.json, reviews/**, decisions.md, requirements.csv; directory listing
//    and hashes before/after; T-DG4-BE-R3 narrowed it from all of docs/delivery/, see DELIVERY_RECORDS);
//  - G1-G4 keep the DG2 key form of the 422 detail; AUD 403 on every write; an ADM-only caller 403 on the decision.
// G1-G4 (and G5 for G6) are staged approved with audited fixtures. All data is SYNTHETIC; every decision here is a demo
// business decision by a test person that approves nothing real, and nothing touches the engineering gates DG0-DG7.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { G5_EVALUATORS, g5SnapshotOf, type G5Facts } from "../../../src/modules/workflows/g5.ts";
import { G6_EVALUATORS, type G6Facts } from "../../../src/modules/workflows/g6.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { areaInBau } from "../contract/p4-exercises-be-i.ts";
import {
  g5Approval,
  highRisk,
  pendingGate,
  seedGateWorld,
  stageGates,
  type GateWorld,
} from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const RATIONALE = "Synthetic demo decision; approves nothing real.";
const submissionsOf = async (g: GateWorld, gateCode: string) =>
  (
    await api.db
      .selectFrom("gate_submission")
      .select(["id", "status"])
      .where("transformation_id", "=", g.b.transformationId)
      .where("gate_code", "=", gateCode)
      .execute()
  ).length;
const decisionsOf = async (g: GateWorld) =>
  (
    await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute()
  ).length;
const gateVersion = async (g: GateWorld, code: string) =>
  (
    await api.db
      .selectFrom("gate_instance")
      .select("version")
      .where("transformation_id", "=", g.b.transformationId)
      .where("gate_code", "=", code)
      .executeTakeFirstOrThrow()
  ).version;
const submit = async (g: GateWorld, code: string, session = g.b.s.tl) =>
  send("POST", `${g.gates}/${code}/submissions`, {
    session,
    headers: ifm(await gateVersion(g, code)),
    body: { submissionNote: "Synthetic submission" },
  });
const criterion = async (g: GateWorld, code: string, key: string) => {
  const view = await send("GET", `${g.gates}/${code}`, { session: g.b.s.auditor });
  expect(view.status).toBe(200);
  return (view.body as Body).criteria.find((c: Body) => c.key === key);
};

/** The SP decides a pending approval (the canonical approval service; a synthetic business decision). */
async function approveApproval(approvalId: string, session: GateWorld["sp"]["session"]) {
  const r = await send("POST", `/api/v1/approvals/${approvalId}/decisions`, {
    session,
    headers: ifm(1),
    body: { outcome: "approve", rationale: RATIONALE, subjectVersion: 1 },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as Body;
}

describe("G5 Scale (REQ-PB-020, REQ-PB-015)", () => {
  it("an open High-impact risk without an approved disposition: 422 whose detail and errors list 'Risk closure'; nothing written", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const risk = await highRisk(send, g);
    const before = await submissionsOf(g, "G5");
    const res = await submit(g, "G5");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe("gate_criteria_incomplete");
    // The G5 label form (ADR-0035 §2): labels, not keys.
    expect(res.body.detail).toBe(
      "Mandatory required outputs are incomplete: Performance evidence, Adoption, Risk closure, Decision log.",
    );
    const riskError = (res.body.errors as Body[]).find((e) => e.pointer === "/criteria/g5.risk_closure");
    expect(riskError.message).toBe(
      `Risk closure: ${risk.code} has High impact and is neither closed nor dispositioned.`,
    );
    for (const e of res.body.errors as Body[])
      expect(e.message).toMatch(/^(Performance evidence|Adoption|Risk closure|Decision log): /);
    expect(await submissionsOf(g, "G5")).toBe(before);
  });

  it("an approved disposition completes Risk closure (a pending one does not; a medium risk never counts)", async () => {
    const g = await seedGateWorld(api, w);
    const risk = await highRisk(send, g);
    await highRisk(send, g, "medium");
    expect((await criterion(g, "G5", "g5.risk_closure")).completeness).toBe("incomplete");
    const d = await send("POST", `${g.b.base}/risk-dispositions`, {
      session: g.wl.session,
      body: {
        raidEntryId: risk.id,
        disposition: "accept",
        rationale: "Synthetic: residual risk accepted for the scale wave.",
        residualOwnerUserId: g.b.users.bo.id,
      },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const pending = await criterion(g, "G5", "g5.risk_closure");
    expect([pending.completeness, pending.missing[0].message]).toEqual([
      "incomplete",
      `Risk closure: ${risk.code} has High impact and is neither closed nor dispositioned.`,
    ]);
    await approveApproval(d.body.approvalId, g.sp.session);
    const done = await criterion(g, "G5", "g5.risk_closure");
    expect([done.completeness, done.missing]).toEqual(["complete", []]);
    const read = await send("GET", `${g.b.base}/risk-dispositions/${d.body.id}`, { session: g.b.s.auditor });
    expect(read.body.approvalStatus).toBe("approved");
  });

  it("G5 configured to BO: an SP decision is 403 gate.not_approver, a BO decision with the scale scope is 201", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const configured = await send("PATCH", `${g.gates}/G5`, {
      session: g.s.to.session,
      headers: ifm(await gateVersion(g, "G5")),
      body: { approverRoleCode: "BO" },
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
    const no = await pendingGate(api, g, "G5");
    const bySp = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
    expect([bySp.status, bySp.body.code, bySp.body.detail]).toEqual([
      403,
      "gate.not_approver",
      "Only the configured approver of this gate can decide it.",
    ]);
    expect(await decisionsOf(g)).toBe(0);
    // REQ-PB-015: approving a stale submission number is refused (DG2 409), nothing written.
    const stale = await send("POST", `${g.gates}/G5/decision`, { session: g.b.s.bo, body: g5Approval(g, no + 1) });
    expect([stale.status, stale.body.code]).toEqual([409, "gate.submission_superseded"]);
    expect(await decisionsOf(g)).toBe(0);
    const byBo = await send("POST", `${g.gates}/G5/decision`, { session: g.b.s.bo, body: g5Approval(g, no) });
    expect(byBo.status, JSON.stringify(byBo.body)).toBe(201);
    expect([byBo.body.outcome, byBo.body.approverRoleCode, byBo.body.decidedBy]).toEqual([
      "approved",
      "BO",
      g.b.users.bo.id,
    ]);
    // An approved G5 moves the phase transform -> realize through the existing next_phase path (ADR-0015 §2).
    const t = await api.db
      .selectFrom("transformation")
      .select("current_phase")
      .where("id", "=", g.b.transformationId)
      .executeTakeFirstOrThrow();
    expect(t.current_phase).toBe("realize");
    const scope = await send("GET", `${g.b.base}/scale-scope`, { session: g.b.s.auditor });
    expect(scope.body.items).toEqual([
      {
        id: expect.any(String),
        initiativeId: g.initiativeId,
        businessUnitId: g.businessUnitId,
        note: "Synthetic pilot BU",
      },
    ]);
    // One audit event per scope row and condition row, in the decision transaction.
    expect((await auditOf(api.db, scope.body.items[0].id)).map((e) => e.action)).toEqual([
      "gate_decision_scale_scope.create",
    ]);
    expect((await auditOf(api.db, scope.body.conditions[0].id)).map((e) => e.action)).toEqual([
      "gate_decision_condition.create",
    ]);
  });

  it("the scale-scope rules (ADR-0035 §5): required with a G5 approval, refused elsewhere, items inside the organization", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3"], "mobilize");
    const g4 = await pendingGate(api, g, "G4");
    const onG4 = await send("POST", `${g.gates}/G4/decision`, {
      session: g.sp.session,
      body: { ...g5Approval(g, g4) },
    });
    expect([onG4.status, onG4.body.code, onG4.body.detail, onG4.body.errors[0].pointer]).toEqual([
      422,
      "gate.scale_scope_not_applicable",
      "A scale scope is recorded only with a G5 approval.",
      "/scaleScope",
    ]);
    expect(await decisionsOf(g)).toBe(0);
    const g5w = await seedGateWorld(api, w);
    await stageGates(api, g5w, ["G1", "G2", "G3", "G4"], "transform");
    await rulesOnG5(g5w);
  });
});

async function rulesOnG5(g: GateWorld): Promise<void> {
  {
    const no = await pendingGate(api, g, "G5");
    const { scaleScope: _omit, ...withoutScope } = g5Approval(g, no);
    const missing = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: withoutScope });
    expect([missing.status, missing.body.code, missing.body.detail, missing.body.errors[0].pointer]).toEqual([
      422,
      "gate.scale_scope_required",
      "A G5 approval must record the approved scale scope.",
      "/scaleScope",
    ]);
    const rejected = await send("POST", `${g.gates}/G5/decision`, {
      session: g.sp.session,
      body: g5Approval(g, no, { outcome: "rejected" }),
    });
    expect([rejected.status, rejected.body.code]).toEqual([422, "gate.scale_scope_not_applicable"]);
    const foreign = await send("POST", `${g.gates}/G5/decision`, {
      session: g.sp.session,
      body: g5Approval(g, no, {
        scaleScope: { items: [{ initiativeId: g.initiativeId, businessUnitId: w.b1 }] },
      }),
    });
    expect([foreign.status, foreign.body.code, foreign.body.detail, foreign.body.errors[0].pointer]).toEqual([
      422,
      "gate.scale_scope_invalid",
      "Each scope item names an initiative of this transformation and a business unit of its organization.",
      "/scaleScope/items/0",
    ]);
    const duplicate = await send("POST", `${g.gates}/G5/decision`, {
      session: g.sp.session,
      body: g5Approval(g, no, {
        scaleScope: {
          items: [
            { initiativeId: g.initiativeId, businessUnitId: g.businessUnitId },
            { initiativeId: g.initiativeId, businessUnitId: g.businessUnitId },
          ],
        },
      }),
    });
    expect(duplicate.status).toBe(400);
    expect(await decisionsOf(g)).toBe(0);
    // A rejection without a scope is the DG2 decision, unchanged.
    const { scaleScope: _x, ...reject } = g5Approval(g, no, { outcome: "rejected" });
    expect((await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: reject })).status).toBe(201);
  }
}

describe("G5 decision rights (D-094; ADR-0035 §8)", () => {
  it("AUD 403 on the G5 submission and decision; an ADM-only caller 403 on the decision (D-094); nothing written", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    expect((await submit(g, "G5", g.b.s.auditor)).status).toBe(403);
    const no = await pendingGate(api, g, "G5");
    for (const session of [g.b.s.auditor, g.b.s.admin]) {
      const r = await send("POST", `${g.gates}/G5/decision`, { session, body: g5Approval(g, no) });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
    }
    expect(await decisionsOf(g)).toBe(0);
  });
});

describe("G1-G4 refusals keep the DG2 key form (ADR-0035 §2: the label form is G5/G6 only)", () => {
  it("a G4 submission with gaps names the criterion keys in its detail, as in DG3", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3"], "mobilize");
    const res = await submit(g, "G4");
    expect([res.status, res.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    expect(res.body.detail).toMatch(/^Mandatory required outputs are incomplete: g4\.[a-z_]+(, g4\.[a-z_]+)*\.$/);
  });
});

// ------------------------------------------------------------------------------------------------ G6

const DELIVERY = fileURLToPath(new URL("../../../../../docs/delivery", import.meta.url));
/**
 * T-DG4-BE-R3 (ARCH-R2 handback): the engineering delivery records a product G6 approval could be confused with - the
 * DG gate records, the stage state, the findings, the reviews, the decisions and the requirement register. The
 * assertion's intent is unchanged (product G6 never implies DG7, M0412). `runs/**` (live agent transcripts that the
 * agent runner appends to while concurrent agents work), handbacks, assignments, test evidence and progress notes are
 * excluded: they are not gate state, and a concurrent agent's transcript made the whole-tree check fail by interference.
 */
const DELIVERY_RECORDS = [
  "gates",
  "stages.json",
  "findings.json",
  "reviews",
  "decisions.md",
  "requirements.csv",
] as const;
/** Every file of DELIVERY_RECORDS with its SHA-256 (a missing path is listed as missing, never skipped). */
function deliveryTree(): string[] {
  const out: string[] = [];
  const add = (p: string) => {
    if (statSync(p).isDirectory()) for (const name of readdirSync(p).sort()) add(join(p, name));
    else out.push(`${relative(DELIVERY, p)} ${createHash("sha256").update(readFileSync(p)).digest("hex")}`);
  };
  for (const entry of DELIVERY_RECORDS) {
    const p = join(DELIVERY, entry);
    if (existsSync(p)) add(p);
    else out.push(`${entry} missing`);
  }
  return out;
}

describe("G6 Sustain (REQ-PB-021, REQ-S04-008, REQ-S04-002)", () => {
  it("without an accepted BAU handover: 422 listing 'Ownership transfer'; nothing written", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4", "G5"], "realize");
    const res = await submit(g, "G6");
    expect([res.status, res.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    expect(res.body.detail).toContain("Ownership transfer");
    const ownership = (res.body.errors as Body[]).find((e) => e.pointer === "/criteria/g6.ownership_transfer");
    expect(ownership.message).toBe("Ownership transfer: the transformation has no performance area.");
    expect(await submissionsOf(g, "G6")).toBe(0);
  });

  it("with every fact: 201 with a frozen g6 snapshot; an edit afterwards leaves it unchanged; the SP approval changes no phase, closes nothing and writes no DG delivery record", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4", "G5"], "realize");
    const { area, handover } = await areaInBau(api, g.s);
    // An area without an accepted handover still blocks: the criterion names it.
    const ci = await send("POST", `${g.b.base}/improvement-items`, {
      session: g.b.s.bo,
      body: { title: "Synthetic: automate the churn extract", sourceKind: "manual", performanceAreaId: area.id },
    });
    expect(ci.status, JSON.stringify(ci.body)).toBe(201);
    const benefit = await measuredBenefit(api, g.b);
    const pendingValue = await submit(g, "G6");
    expect([pendingValue.status, pendingValue.body.detail]).toEqual([
      422,
      "Mandatory required outputs are incomplete: Benefits evidence.",
    ]);
    const v = await submittedValue(api, g.b, benefit.id, "250000");
    // A value pending Finance is never counted as validated.
    expect((await criterion(g, "G6", "g6.benefits_evidence")).completeness).toBe("incomplete");
    await approve(api, g.b, v, "240000");
    expect((await criterion(g, "G6", "g6.benefits_evidence")).completeness).toBe("complete");

    const submitted = await submit(g, "G6");
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const snap = submitted.body.snapshot as Body;
    expect(snap.g6).toEqual({
      benefits: [
        {
          id: benefit.id,
          code: benefit.code,
          validatedMeasurementIds: [v.measurementId],
          approvedTransitionDecisionIds: [],
        },
      ],
      handoverIds: [handover.id],
      performanceAreas: [{ id: area.id, cycleNo: 1, acceptedHandoverId: handover.id }],
      controlIds: [expect.any(String)],
      improvementItemIds: [ci.body.id],
    });
    // REQ-S04-002: editing a record after submission leaves the snapshot shown to approvers unchanged.
    const edited = await send("PATCH", `${g.b.base}/improvement-items/${ci.body.id}`, {
      session: g.b.s.bo,
      headers: ifm(ci.body.version),
      body: { title: "Synthetic: edited after the G6 submission" },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const shown = await send("GET", `${g.gates}/G6/submissions/${submitted.body.submissionNo}`, {
      session: g.sp.session,
    });
    expect([shown.body.submission.snapshotSha256, shown.body.submission.snapshot]).toEqual([
      submitted.body.snapshotSha256,
      snap,
    ]);

    const tBefore = await api.db
      .selectFrom("transformation")
      .select(["current_phase", "status", "version"])
      .where("id", "=", g.b.transformationId)
      .executeTakeFirstOrThrow();
    const treeBefore = deliveryTree();
    // The covered set is real: the stage state, the findings and the DG3 gate record are among the hashed files.
    for (const required of ["stages.json ", "findings.json ", "gates/DG3.json ", "decisions.md ", "requirements.csv "])
      expect(
        treeBefore.some((l) => l.startsWith(required)),
        required,
      ).toBe(true);
    expect(treeBefore.some((l) => l.startsWith("runs/"))).toBe(false);
    const decided = await send("POST", `${g.gates}/G6/decision`, {
      session: g.sp.session,
      body: { submissionNo: submitted.body.submissionNo, outcome: "approved", rationale: RATIONALE },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    const tAfter = await api.db
      .selectFrom("transformation")
      .select(["current_phase", "status", "version"])
      .where("id", "=", g.b.transformationId)
      .executeTakeFirstOrThrow();
    // No phase change (next_phase NULL), no closure (D-089 Q4), no change to the transformation row at all.
    expect(tAfter).toEqual(tBefore);
    expect(
      await api.db
        .selectFrom("closure_record")
        .select("id")
        .where("transformation_id", "=", g.b.transformationId)
        .execute(),
    ).toEqual([]);
    // Product G6 approval changes no engineering DG record (M0412): the delivery records are byte-identical.
    expect(deliveryTree()).toEqual(treeBefore);
    const event = await api.db
      .selectFrom("outbox_event")
      .select(["payload"])
      .where("event_type", "=", "gate.decided")
      .where("idempotency_key", "=", `gate.decided:${decided.body.id}`)
      .executeTakeFirstOrThrow();
    expect((event.payload as Body).nextPhase).toBeNull();
  }, 120_000);

  it("G6 allows SP only: a BO cannot be configured as its approver (DG2 422 gate.approver_role_not_allowed)", async () => {
    const g = await seedGateWorld(api, w);
    const r = await send("PATCH", `${g.gates}/G6`, {
      session: g.s.to.session,
      headers: ifm(await gateVersion(g, "G6")),
      body: { approverRoleCode: "BO" },
    });
    expect([r.status, r.body.code]).toEqual([422, "gate.approver_role_not_allowed"]);
    // A second SP-holding person who is not configured by name may decide; an extra BO never can.
    const bo3 = await extraUser(api, w, g.b, "BO");
    expect(bo3.id).not.toBe(g.sp.id);
  });
});

// ------------------------------------------------------------------------------------------------ pure evaluators

describe("the G5/G6 evaluators as pure functions of the facts (ADR-0035 §2, §10: Unknown never counts)", () => {
  const evalOf = <F>(
    list: ReadonlyArray<readonly [string, (f: F | undefined) => { missing: { message: string }[] }]>,
    key: string,
  ) => list.find(([k]) => k === key)![1];
  const g5 = (over: Partial<G5Facts> = {}): G5Facts => ({
    kpis: [
      { kpiDefinitionId: "k1", name: "Synthetic ARPU", hasAcceptedActual: true, evaluationId: "e1", valueStatus: "ok" },
    ],
    pilotEvidenceIds: ["ev1"],
    raid: { transformationId: "t", highRisks: [] },
    adoption: {
      transformationId: "t",
      indicators: [
        { metricLinkId: "m1", templateKey: "usage", kpiDefinitionId: null, valueStatus: "ok", valueReason: null },
      ],
    },
    governance: {
      transformationId: "t",
      businessDate: "2026-10-09",
      decisions: [{ id: "d1", t16Id: "DEC-01", status: "decided", decisionDate: "2026-10-01" }],
    },
    ...over,
  });

  it("every G5 criterion is complete with complete facts and incomplete without facts (fail closed)", () => {
    for (const [key, evaluate] of G5_EVALUATORS) {
      expect([key, evaluate(g5()).missing]).toEqual([key, []]);
      expect(evaluate(undefined).missing.length, key).toBeGreaterThan(0);
    }
    for (const [key, evaluate] of G6_EVALUATORS) expect(evaluate(undefined).missing.length, key).toBeGreaterThan(0);
  });

  it("Unknown, Stale and Not computable KPIs and indicators never complete G5; a missing T16 date is listed, not overdue", () => {
    const perf = evalOf(G5_EVALUATORS, "g5.performance_evidence");
    for (const status of ["unknown", "stale", "not_computable"]) {
      const f = g5({
        kpis: [
          {
            kpiDefinitionId: "k1",
            name: "Synthetic ARPU",
            hasAcceptedActual: true,
            evaluationId: "e1",
            valueStatus: status,
          },
        ],
      });
      expect(perf(f).missing.map((m) => m.message)).toEqual([
        `Performance evidence: Synthetic ARPU is ${status.replace("_", " ")}.`,
      ]);
    }
    expect(perf(g5({ pilotEvidenceIds: [] })).missing[0]!.message).toBe(
      'Performance evidence: no verified evidence is linked to the Transform step "deliver pilots".',
    );
    const adoption = evalOf(G5_EVALUATORS, "g5.adoption");
    expect(
      adoption(
        g5({
          adoption: {
            transformationId: "t",
            indicators: [
              {
                metricLinkId: "m1",
                templateKey: "usage",
                kpiDefinitionId: null,
                valueStatus: "unknown",
                valueReason: "x",
              },
            ],
          },
        }),
      ).missing[0]!.message,
    ).toBe("Adoption: indicator usage has no current value (unknown).");
    const log = evalOf(G5_EVALUATORS, "g5.decision_log");
    const decisions = (decisionDate: string | null) =>
      g5({
        governance: {
          transformationId: "t",
          businessDate: "2026-10-09",
          decisions: [{ id: "d1", t16Id: "DEC-01", status: "open", decisionDate }],
        },
      });
    expect(log(decisions(null)).missing[0]!.message).toBe(
      "Decision log: DEC-01 is open and its decision date is missing.",
    );
    expect(log(decisions("2026-10-08")).missing[0]!.message).toBe(
      "Decision log: DEC-01 is open past its decision date 2026-10-08.",
    );
    expect(log(decisions("2026-10-09")).missing).toEqual([]);
    expect(
      log(g5({ governance: { transformationId: "t", businessDate: "2026-10-09", decisions: [] } })).missing[0]!.message,
    ).toBe("Decision log: the T16 decision log has no entry.");
  });

  it("Risk closure: closed or an APPROVED disposition only; the G5 snapshot member records risks, dispositions and approvals", () => {
    const rc = evalOf(G5_EVALUATORS, "g5.risk_closure");
    const risk = (status: string, approvalStatus: string | null) =>
      g5({
        raid: {
          transformationId: "t",
          highRisks: [
            {
              id: "r1",
              code: "R-03",
              status,
              dispositions:
                approvalStatus === null ? [] : [{ id: "rd1", disposition: "accept", approvalId: "a1", approvalStatus }],
            },
          ],
        },
      });
    expect(rc(risk("open", null)).missing[0]!.message).toBe(
      "Risk closure: R-03 has High impact and is neither closed nor dispositioned.",
    );
    expect(rc(risk("in_progress", "pending")).missing).toHaveLength(1);
    expect(rc(risk("open", "rejected")).missing).toHaveLength(1);
    expect(rc(risk("open", "approved")).missing).toEqual([]);
    expect(rc(risk("closed", null)).missing).toEqual([]);
    expect(g5SnapshotOf(risk("open", "approved"))).toMatchObject({
      kpis: [{ kpiDefinitionId: "k1", evaluationId: "e1", valueStatus: "ok", hasAcceptedActual: true }],
      pilotEvidenceIds: ["ev1"],
      indicators: [{ metricLinkId: "m1", valueStatus: "ok" }],
      risks: [
        {
          id: "r1",
          code: "R-03",
          status: "open",
          dispositions: [{ id: "rd1", approvalId: "a1", approvalStatus: "approved" }],
        },
      ],
      t16: [{ id: "d1", t16Id: "DEC-01", status: "decided" }],
    });
  });

  it("G6: a benefit without a validated value or approved transition, an area without a control, an empty backlog are listed", () => {
    const f: G6Facts = {
      benefits: {
        transformationId: "t",
        benefits: [
          {
            id: "b1",
            code: "BEN-01",
            title: "Synthetic churn",
            validatedMeasurementIds: [],
            approvedTransitionDecisionIds: [],
          },
        ],
      },
      sustainment: {
        transformationId: "t",
        performanceAreas: [
          {
            id: "a1",
            code: "PA-01",
            name: "Synthetic area",
            cycleNo: 1,
            acceptedHandoverId: "h1",
            activeControlIds: [],
          },
        ],
        improvementItemIds: [],
      },
    };
    const msgs = (key: string) => evalOf(G6_EVALUATORS, key)(f).missing.map((m) => m.message);
    expect(msgs("g6.benefits_evidence")).toEqual([
      "Benefits evidence: BEN-01 Synthetic churn has no Finance-validated measurement and no approved transition decision.",
    ]);
    expect(msgs("g6.ownership_transfer")).toEqual([]);
    expect(msgs("g6.controls")).toEqual(["Controls: PA-01 Synthetic area has no active control."]);
    expect(msgs("g6.improvement_backlog")).toEqual([
      "Continuous improvement backlog: the improvement backlog is empty.",
    ]);
  });
});
