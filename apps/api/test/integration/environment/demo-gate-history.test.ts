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
//   - every mandatory criterion of G1-G4 is complete today on its own records, with no gate exception (T-DG5-BE-X2,
//     D-172: G4 rests on a real approved portfolio of INI-01..03, F-DG5-122);
//   - every seeded G-decision carries the label 'Synthetic demonstration - approves nothing real' (en and ar);
//   - G5 and G6 stay not submitted.
// Everything is SYNTHETIC demo data in a demo-initialized database: a seeded decision approves nothing real (M0412),
// and nothing here names or implies the engineering delivery gates DG0-DG7.
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { weightedScore } from "@mth/shared/calc";
import { loadActiveWeightSet, loadScoreMaps } from "../../../src/modules/portfolio/scores.ts";
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
      // T-DG5-BE-X2 (D-172; F-DG5-122): no criterion of G1-G4 is incomplete and none rests on an exception: G4 is
      // complete on the seeded approved portfolio (INI-01..03), not on accepted exceptions.
      expect(
        (v.criteria as Body[]).filter((c) => c.completeness !== "complete").map((c) => c.key),
        `${code} incomplete criteria`,
      ).toEqual([]);
      expect([...covered].sort(), `${code} covering exceptions`).toEqual([]);
      expect(exceptions, `${code} has no gate exception at all`).toEqual([]);
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

  // T-DG5-BE-X2 (D-172; F-DG5-120 remaining part, F-DG5-122): the domain reviewer's round-2 reproduction, as a product
  // test. Signed in as demo role users, through the product's own read operations: the approved G4 rests on a REAL
  // approved portfolio of INI-01..03, with every per-initiative fact the G4 evaluator reads present in the records, and
  // no exception. The test does not depend on the evaluator's empty-portfolio rule (T-DG5-BE-X1): it asserts the
  // portfolio and its facts directly.
  it("G4 is approved on a real approved portfolio of INI-01..03: every criterion complete, no exception", async () => {
    const tl = user("TL");
    const sp = user("SP");
    const fin = user("FIN");
    const bo = user("BO");
    const all = (await get("TL", `/api/v1/initiatives?transformationId=${T}&limit=100`)).items as Body[];
    const byCode = new Map(all.map((i) => [i.code as string, i]));
    const codes = ["INI-01", "INI-02", "INI-03"];
    const ini = codes.map((c) => byCode.get(c)!);

    // The live G4 view: approved, 8 of 8 mandatory criteria complete, nothing missing, no exception.
    const g4 = await get("TL", `/api/v1/transformations/${T}/gates/G4`);
    expect(g4.gate.status).toBe("approved");
    const mandatory = (g4.criteria as Body[]).filter((c) => c.mandatory);
    expect(mandatory.map((c) => c.key).sort()).toEqual([
      "g4.business_cases",
      "g4.capacity",
      "g4.finance_validation",
      "g4.funding",
      "g4.initiative_cards",
      "g4.owners",
      "g4.prioritization",
      "g4.roadmap",
    ]);
    for (const c of mandatory) expect([c.key, c.completeness, c.missing], c.key).toEqual([c.key, "complete", []]);
    const exceptions = (await get("TL", `/api/v1/transformations/${T}/gate-exceptions?limit=100`)).items as Body[];
    expect(exceptions, "no gate exception anywhere in the demo").toEqual([]);

    // The frozen G4 submission: every criterion complete, no exception, and the snapshot names the approved portfolio.
    const one = await get("SP", `/api/v1/transformations/${T}/gates/G4/submissions/1`);
    for (const c of one.criteria as Body[])
      expect([c.criterionKey, c.completeness, c.gateExceptionId ?? null], c.criterionKey).toEqual([
        c.criterionKey,
        "complete",
        null,
      ]);
    const snap = one.submission.snapshot.g4;
    const decidedAt = one.decision.decidedAt as string;
    const submittedAt = one.submission.submittedAt as string;
    // The reviewer's final assertion, reversed by the fix: the frozen approved portfolio is not empty.
    expect(snap.initiatives.map((i: Body) => i.code)).toEqual(codes);
    expect(snap.rankingSnapshotId).not.toBeNull();
    expect(snap.fundingDecisionIds).toHaveLength(3);
    expect(snap.committedDemandIds.length).toBeGreaterThanOrEqual(3);
    expect(snap.businessCases).toHaveLength(4);
    for (const c of snap.businessCases as Body[]) expect(c.baselineValidation, c.code).toBe("validated");
    for (const f of snap.formulaVersions as Body[]) expect(f.validation, f.lineId).toBe("validated");

    // The approved portfolio: INI-01..03 selected by the demo Sponsor from the current ranking, then funded.
    const rankings = (await get("TL", `/api/v1/transformations/${T}/prioritization/rankings`)).items as Body[];
    const current = rankings.filter((r) => r.status === "current");
    expect(current).toHaveLength(1);
    const ranking = await get("TL", `/api/v1/transformations/${T}/prioritization/rankings/${current[0].snapshotNo}`);
    expect(ranking.id ?? ranking.snapshot?.id).toBe(snap.rankingSnapshotId);
    const entries = (ranking.entries ?? ranking.snapshot?.entries) as Body[];
    const active = await loadActiveWeightSet(api.db, T);
    const maps = await loadScoreMaps(
      api.db,
      ini.map((i) => i.id),
    );
    for (const i of ini) {
      const e = entries.find((x) => x.initiativeId === i.id);
      expect([i.code, e?.completeness, e?.rank === null]).toEqual([i.code, "complete", false]);
      // The stored weighted score is the scoring engine's result of the initiative's T06 scores under the active set.
      const stored = await api.db
        .selectFrom("ranking_entry")
        .select("weighted_score")
        .where("snapshot_id", "=", snap.rankingSnapshotId)
        .where("initiative_id", "=", i.id)
        .executeTakeFirstOrThrow();
      expect(String(stored.weighted_score), i.code).toBe(weightedScore(maps.get(i.id)!, active!.weights).weightedScore);
    }
    const funding = (await get("FIN", `/api/v1/funding-decisions?transformationId=${T}&limit=100`)).items as Body[];
    for (const i of ini) {
      // Funded when G4 was submitted (the frozen snapshot), launched on its planned start after G4 was approved.
      expect([i.code, i.status, i.fundingState]).toEqual([i.code, "launched", "funded"]);
      expect(snap.initiatives.find((x: Body) => x.id === i.id).status, i.code).toBe("funded");
      expect(decidedAt < i.launchedAt && i.launchedBy === tl.id, `${i.code} launched after G4`).toBe(true);
      // Card, owners and roadmap facts the G4 evaluator reads.
      expect(i.objective, i.code).toBeTruthy();
      expect(i.scopeIn, i.code).toBeTruthy();
      expect([i.executiveOwnerUserId, i.workstreamLeadUserId], i.code).not.toContain(null);
      expect([i.waveId, i.plannedStart, i.plannedEnd], i.code).not.toContain(null);
      const sel = (await get("TL", `/api/v1/initiatives/${i.id}/selections`)).items as Body[];
      expect(sel[0], i.code).toMatchObject({ action: "selected", decidedBy: sp.id });
      expect(sel[0].rankingSnapshotId, i.code).toBe(snap.rankingSnapshotId);
      expect(sel[0].decidedAt < submittedAt, `${i.code} selected before G4`).toBe(true);
      // A funding decision, recorded by the demo Finance user after the selection and before the G4 submission.
      const f = funding.filter((x) => x.initiativeId === i.id);
      expect(f, i.code).toHaveLength(1);
      expect(f[0], i.code).toMatchObject({ outcome: "approved", decidedBy: fin.id, approverRoleCode: "FIN" });
      expect(snap.fundingDecisionIds).toContain(f[0].id);
      expect(sel[0].decidedAt < f[0].decidedAt && f[0].decidedAt < submittedAt, `${i.code} funded in order`).toBe(true);
      // Approved roadmap milestones, inside the initiative's planned window, approved before the G4 submission.
      const ms = (await get("TL", `/api/v1/initiatives/${i.id}/milestones`)).items as Body[];
      const approved = ms.filter((m) => m.approvedDate !== null && m.status !== "cancelled");
      expect(approved.length, `${i.code} approved milestones`).toBeGreaterThanOrEqual(1);
      for (const m of approved) {
        expect(m.approvedBy, m.title).toBe(tl.id);
        expect(m.approvedAt < submittedAt, m.title).toBe(true);
        expect(m.approvedDate >= i.plannedStart && m.approvedDate <= i.plannedEnd, m.title).toBe(true);
      }
      // No schedule conflict G4 would list on this initiative.
      expect(
        (i.flags as Body[]).filter((x) => x.code === "schedule.needed_by_conflict" || x.code === "schedule.unknown"),
        `${i.code} schedule`,
      ).toEqual([]);
    }

    // Committed resource demand for each initiative, by the capacity owner, within the active capacity: no conflict.
    const demands = (await get("TL", `/api/v1/resource-demands?transformationId=${T}&limit=100`)).items as Body[];
    for (const i of ini) {
      const mine = demands.filter((d) => d.initiativeId === i.id && d.status === "committed");
      expect(mine.length, `${i.code} committed demand`).toBeGreaterThanOrEqual(1);
      for (const d of mine) {
        expect(d.committedBy, i.code).toBe(bo.id);
        expect(d.committedAt < submittedAt, i.code).toBe(true);
        expect(snap.committedDemandIds).toContain(d.id);
      }
    }
    const plan = await get("TL", `/api/v1/transformations/${T}/capacity-plan?from=2026-07-01&to=2026-12-31`);
    expect((plan.roles as Body[]).length).toBeGreaterThanOrEqual(1);
    const committedCells = (plan.cells as Body[]).filter(
      (c) => c.committedDemandFte !== "0" && c.committedDemandFte !== "0.00",
    );
    expect(committedCells.length).toBeGreaterThanOrEqual(3);
    for (const c of plan.cells as Body[])
      expect([c.periodMonth, c.flag], c.resourceRoleId).toEqual([c.periodMonth, null]);

    // An initiative business case per initiative, complete, its baseline validated by the demo Finance user (never its
    // author), under the transformation case.
    const cases = (await get("TL", `/api/v1/business-cases?transformationId=${T}&limit=100`)).items as Body[];
    const top = cases.filter((c) => c.level === "transformation");
    expect(top).toHaveLength(1);
    for (const i of ini) {
      const c = cases.filter((x) => x.level === "initiative" && x.initiativeId === i.id);
      expect(c, i.code).toHaveLength(1);
      expect(c[0], i.code).toMatchObject({
        parentCaseId: top[0].id,
        missingSections: [],
        baselineValidation: "validated",
        baselineValidatedBy: fin.id,
      });
      expect(c[0].createdBy, i.code).not.toBe(fin.id);
      expect(c[0].baselineValidatedAt < submittedAt, i.code).toBe(true);
    }

    // Keep the totals (D-172): the lines are split across the initiative cases, and the transformation case's totals
    // read them by reference, so every figure BC-01 showed when all seven lines were its own is unchanged.
    const totals = await get("TL", `/api/v1/business-cases/${top[0].id}/totals`);
    const sar = (list: Body[]) => {
      const x = list.find((m) => m.currency === "SAR");
      return [x?.amount === null || x === undefined ? null : Number(x.amount).toFixed(4), x?.lineCount ?? 0];
    };
    expect([...totals.includedCaseIds].sort()).toEqual(
      [top[0].id, ...cases.filter((c) => c.level === "initiative").map((c) => c.id)].sort(),
    );
    expect({
      revenue: sar(totals.grossBenefitsByValueBasis.revenue_uplift),
      avoided: sar(totals.grossBenefitsByValueBasis.avoided_cost),
      margin: sar(totals.grossBenefitsByValueBasis.margin_uplift),
      cash: sar(totals.implementationCostCash),
      nonCash: sar(totals.implementationCostNonCash),
    }).toEqual({
      revenue: ["7128000.0000", 1],
      avoided: ["1584000.0000", 1],
      margin: ["1920000.0000", 1],
      cash: ["3660000.0000", 3],
      nonCash: ["1170000.0000", 1],
    });

    // GD-04 is true to the records: the rationale names the selected, funded and resourced portfolio, labelled.
    expect(one.decision.rationale).toContain("The portfolio is executable and value-backed");
    expect(one.decision.rationale).not.toContain("exception");
    expect(one.decision.rationale).toContain(LABEL_EN);
    expect(submittedAt < decidedAt).toBe(true);
  });

  // F-DG5-123 (T-DG5-BE-Y1, D-174; REQ-S18-002; B0072 T05 "Key deliverables [3-7 deliverables]"): the domain
  // reviewer's reproduction as a product test. Through the product's own reads (listInitiatives, getInitiative,
  // listDeliverables, getOrphanReport), signed in as the demo Transformation Lead: each launched initiative of the
  // approved portfolio carries 3 to 7 active key deliverables, the portfolio reports no `initiative.deliverable_count`
  // warning for it, and the orphan report lists none of them (nor any of their deliverables).
  it("F-DG5-123: the launched portfolio INI-01..03 carries 3-7 key deliverables: no count warning, no orphan", async () => {
    const tl = user("TL");
    const all = (await get("TL", `/api/v1/initiatives?transformationId=${T}&limit=100`)).items as Body[];
    const ini = ["INI-01", "INI-02", "INI-03"].map((c) => all.find((i) => i.code === c)!);
    const g4 = await get("TL", `/api/v1/transformations/${T}/gates/G4`);
    const submittedAt = g4.currentSubmission.submittedAt as string;
    const deliverableIds: string[] = [];
    for (const i of ini) {
      expect(i.status, i.code).toBe("launched");
      const listed = (i.warnings as Body[]).map((w) => w.code);
      const one = (await get("TL", `/api/v1/initiatives/${i.id}`)).warnings as Body[];
      expect.soft(listed, `${i.code} on the portfolio list`).not.toContain("initiative.deliverable_count");
      expect
        .soft(
          one.map((w) => w.code),
          `${i.code} on the initiative`,
        )
        .not.toContain("initiative.deliverable_count");
      const d = await get("TL", `/api/v1/initiatives/${i.id}/deliverables`);
      const active = (d.items as Body[]).filter((x) => x.status === "active");
      expect.soft(active.length >= 3 && active.length <= 7, `${i.code}: ${active.length} key deliverables`).toBe(true);
      expect.soft(d.countWarning, i.code).toBeNull();
      // Ordinals in order; written by the demo TL (initiative.edit) on the card before the initiative was submitted;
      // owned by the workstream lead; due inside the planned window, by the initiative's last approved milestone, and
      // after the synthetic clock (2026-09-01), so none reads overdue; not accepted (acceptance is deliverable.accept).
      expect(active.map((x) => x.ordinal)).toEqual(active.map((_, k) => k + 1));
      const ms = (await get("TL", `/api/v1/initiatives/${i.id}/milestones`)).items as Body[];
      const lastMilestone = ms.map((m) => m.approvedDate as string).sort()[ms.length - 1]!;
      for (const x of active) {
        expect([x.createdBy, x.ownerUserId, x.acceptanceStatus, x.submittedBy], x.title).toEqual([
          tl.id,
          i.workstreamLeadUserId,
          "pending",
          null,
        ]);
        expect(x.createdAt < submittedAt, x.title).toBe(true);
        expect(x.dueDate >= i.plannedStart && x.dueDate <= lastMilestone && x.dueDate > "2026-09-01", x.title).toBe(
          true,
        );
        // en and ar, marked synthetic like the rest of the dataset.
        expect(x.title, x.title).toMatch(/\(synthetic\) \/ .*[؀-ۿ].*\(اصطناعي\)$/u);
        deliverableIds.push(x.id as string);
      }
    }
    // Exactly one audit event per seeded write: each deliverable has its one `deliverable.create`.
    const events =
      deliverableIds.length === 0
        ? []
        : await api.db
            .selectFrom("audit_event")
            .select(["record_id", "action"])
            .where("record_type", "=", "deliverable")
            .where("record_id", "in", deliverableIds)
            .execute();
    expect(events.map((e) => e.action).sort()).toEqual(deliverableIds.map(() => "deliverable.create"));
    expect(new Set(events.map((e) => e.record_id)).size).toBe(deliverableIds.length);

    // The orphan report (the traceability screen's getOrphanReport) lists none of the three, nor their deliverables.
    const orphans = (await get("TL", `/api/v1/transformations/${T}/orphans?limit=100`)).items as Body[];
    const listedIds = orphans.map((o) => o.recordId as string);
    for (const id of deliverableIds) expect(listedIds, `deliverable ${id}`).not.toContain(id);
    // Each deliverable reaches a capability change and each capability a chain KPI, so the only orphan left is the
    // fourth diagnosed issue, which is no B0147 line and stays the report's illustrative entry.
    expect(
      orphans.filter((o) => o.recordType !== "diagnostic_finding").map((o) => [o.recordType, o.label]),
      "no initiative, deliverable or capability is an orphan",
    ).toEqual([]);
    expect(
      orphans.filter((o) => o.recordType === "initiative").map((o) => o.code),
      "the orphan report lists no launched initiative",
    ).toEqual([]);
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
