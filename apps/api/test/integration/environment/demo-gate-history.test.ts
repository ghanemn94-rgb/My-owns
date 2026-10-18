// T-DG5-BE-V3 (F-DG5-120; D-170; REQ-S18-002, REQ-S21-001; M0348, B0009, B0023): the seeded International Roaming
// transformation carries the product-gate history its phase implies. It is an End-to-End transformation in Transform,
// so G1-G4 are approved and G5 and G6 are not submitted.
//
// The domain reviewer's reproduction, as a product test: on the REAL synthetic dataset (`seedDemo`) in a scratch
// database with the REAL API on it (MTH_ENV=demo), signed in as demo role users (roaming.user.tl, roaming.user.sp),
// GET /transformations/{id} and GET /transformations/{id}/gates through the product's own operations:
//   - G1-G4 are approved, each with one decided submission by the demo user who submits gates (TL) and an approved
//     decision by the gate's routed approver (the demo Sponsor, SP), never the submitter; G1 carries its three B0032
//     agreements; each decision is dated, in phase order, before the Transform-phase records that depend on it;
//   - every mandatory criterion of G1-G4 is complete today, or covered today by an accepted gate exception;
//   - every seeded G-decision carries the label 'Synthetic demonstration - approves nothing real' (en and ar);
//   - G5 and G6 stay not submitted.
// Everything is SYNTHETIC demo data in a demo-initialized database: a seeded decision approves nothing real (M0412),
// and nothing here names or implies the engineering delivery gates DG0-DG7.
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const user = (role: string) => DEMO_USERS.find((u) => u.role === role)!;
const LABEL_EN = "Synthetic demonstration - approves nothing real";
const LABEL_AR = "عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي";

let api: TestApi;
let scratch: string | null = null;
const s: Record<string, Session> = {};
const get = async (role: string, url: string) => {
  const r = await call<Body>(api.app, "GET", url, { session: s[role]! });
  expect(r.status, `${url}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
};

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_demo_gate_history");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  for (const u of DEMO_USERS) s[u.role] = await signIn(api.app, u.name);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("F-DG5-120: the seeded roaming transformation carries the gate history its phase implies", () => {
  it("an End-to-End transformation in Transform: G1-G4 approved by the routed approver, G5-G6 not submitted", async () => {
    const t = await get("TL", `/api/v1/transformations/${T}`);
    expect([t.mode, t.currentPhase]).toEqual(["end_to_end", "transform"]);

    const gates = (await get("TL", `/api/v1/transformations/${T}/gates`)).items as Body[];
    expect(gates.map((v) => v.gate.gateCode)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    const tl = user("TL");
    const sp = user("SP");
    const timeline: { code: string; submittedAt: string; decidedAt: string }[] = [];
    for (const v of gates.slice(0, 4)) {
      const code = v.gate.gateCode as string;
      expect([code, v.gate.status, v.gate.latestSubmissionNo], code).toEqual([code, "approved", 1]);
      expect(v.gate.approvedAt, code).not.toBeNull();
      expect(v.canSubmit, `${code} is approved: no resubmission`).toBe(false);
      expect(v.currentSubmission, code).toMatchObject({ submissionNo: 1, status: "decided", submittedBy: tl.id });
      // The gate's routed approver is the demo Sponsor's role (no named user), and the submission was routed to it.
      expect([v.gate.approverRoleCode, v.gate.approverUserId], code).toEqual(["SP", null]);
      expect(v.currentSubmission.approverRoleCode, code).toBe("SP");

      // Every mandatory criterion: complete today, or covered today by an accepted exception (ADR-0035 §4).
      const exceptions = (await get("TL", `/api/v1/transformations/${T}/gate-exceptions?gateCode=${code}&limit=100`))
        .items as Body[];
      const covered = new Set(
        exceptions.filter((e) => e.covering && e.status === "accepted").map((e) => e.criterionKey),
      );
      for (const c of (v.criteria as Body[]).filter((x) => x.mandatory))
        expect(
          c.completeness === "complete" || covered.has(c.key),
          `${code} ${c.key}: ${c.completeness} ${JSON.stringify(c.missing)}`,
        ).toBe(true);
      // Only the two G4 criteria the dataset cannot evidence (no portfolio selection, no ranking snapshot) are excepted;
      // every G1-G3 criterion and every other G4 criterion is complete on its own evidence.
      expect(
        (v.criteria as Body[]).filter((c) => c.completeness !== "complete").map((c) => c.key),
        `${code} incomplete criteria`,
      ).toEqual(code === "G4" ? ["g4.initiative_cards", "g4.prioritization"] : []);
      expect([...covered].sort(), `${code} covering exceptions`).toEqual(
        code === "G4" ? ["g4.initiative_cards", "g4.prioritization"] : [],
      );
      for (const e of exceptions.filter((x) => x.status === "accepted")) {
        expect(e.decidedBy, `${code} exception ${e.criterionKey} decided by the gate's approver`).toBe(sp.id);
        expect(e.requestedBy).toBe(tl.id);
        expect(e.reason).toContain(LABEL_EN);
      }

      // The decision: approved by the demo Sponsor (routed approver, default role), never the submitter, labelled.
      const one = await get("SP", `/api/v1/transformations/${T}/gates/${code}/submissions/1`);
      expect(one.decision, code).toMatchObject({
        gateCode: code,
        submissionNo: 1,
        outcome: "approved",
        decidedBy: sp.id,
        onBehalfOfUserId: null,
        approverBasis: "default_role",
        approverRoleCode: "SP",
      });
      expect(one.decision.decidedBy).not.toBe(one.submission.submittedBy);
      expect(one.decision.rationale, code).toContain(LABEL_EN);
      expect(one.decision.rationale, code).toContain(LABEL_AR);
      expect(
        one.decision.agreements.map((a: Body) => a.agreementCode),
        code,
      ).toEqual(code === "G1" ? ["problem", "baseline", "material_value_pools"] : []);
      // The frozen criteria: every mandatory one complete, or incomplete with the exception that covered it.
      for (const c of (one.criteria as Body[]).filter((x) => x.mandatory))
        expect(c.completeness === "complete" || covered.has(c.criterionKey), `${code} frozen ${c.criterionKey}`).toBe(
          true,
        );
      expect(one.submission.snapshot).toMatchObject({ schema: "mth.gate-submission/1", gateCode: code });
      expect(one.submission.submittedAt < one.decision.decidedAt, code).toBe(true);
      timeline.push({ code, submittedAt: one.submission.submittedAt, decidedAt: one.decision.decidedAt });
    }
    // Phase order: G(n) is decided before G(n+1) is submitted.
    for (let i = 1; i < timeline.length; i += 1)
      expect(timeline[i - 1]!.decidedAt < timeline[i]!.submittedAt, `${timeline[i]!.code} after its predecessor`).toBe(
        true,
      );
    // G4 (Mobilize -> Transform) is decided before the Transform-phase records that depend on it start.
    const plan = await api.db
      .selectFrom("launch_plan")
      .select("start_date")
      .where("transformation_id", "=", T)
      .executeTakeFirstOrThrow();
    const starts = await api.db
      .selectFrom("initiative")
      .select("planned_start")
      .where("transformation_id", "=", T)
      .execute();
    const g4 = timeline[3]!.decidedAt.slice(0, 10);
    const day = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
    for (const d of [plan.start_date, ...starts.map((i) => i.planned_start)] as unknown[]) {
      expect(d, "a dated Transform-phase record").not.toBeNull();
      expect(g4 < day(d), `G4 ${g4} before ${day(d)}`).toBe(true);
    }

    // G5 and G6 stay not submitted; the product computes their readiness (not pinned here).
    for (const v of gates.slice(4))
      expect([v.gate.gateCode, v.gate.status, v.gate.latestSubmissionNo, v.currentSubmission]).toEqual([
        v.gate.gateCode,
        "draft",
        0,
        null,
      ]);
    // The reviewer's final assertion, reversed by the fix: not every gate is a never-submitted draft any more.
    expect(gates.map((v) => v.gate.status)).toEqual(["approved", "approved", "approved", "approved", "draft", "draft"]);
  });

  it("the phase history: four phase advances, one per approved gate, ending in Transform", async () => {
    const advances = await api.db
      .selectFrom("audit_event")
      .select(["action", "changes", "reason"])
      .where("record_type", "=", "transformation")
      .where("record_id", "=", T)
      .where("action", "=", "transformation.phase_advance")
      .orderBy("seq")
      .execute();
    expect(advances.map((a) => (a.changes as Body).currentPhase)).toEqual([
      { from: "diagnose", to: "define" },
      { from: "define", to: "design" },
      { from: "design", to: "mobilize" },
      { from: "mobilize", to: "transform" },
    ]);
  });
});
