// The guided walkthrough against a real PostgreSQL (ADR-0050 §7, §8, §9; REQ-S18-004; M0349; p5-work-split §J.4;
// T-DG5-BE-T2). Literal tests of §J.4:
//  - on a fresh demo database the twelve steps are incomplete for a new transformation (step 1, "create
//    transformation", is the one the new transformation itself completes), and each step's rule becomes true after the
//    native workflow writes its record: every step 2-12 is read false, its workflow is performed through the product
//    API by the role that performs it, and the step is read true;
//  - production gives 409 environment.not_demo (exact text).
// Plus: the twelve verbatim M0349 titles, areas and routes in order; a seeded (dataset) transformation is not "created
// in this demo database"; 404 outside the caller's scope and for an unknown id; 400; 401; the read writes nothing.
//
// Each step's world creates its own transformation in the demo database (the P2 world through the API; the KPI,
// benefit and sustainment worlds with the shared test fixture), because the workflows need different role sets; a
// step is judged on its own transformation. Where an existing test fixture stages a prerequisite that is not the
// step's own record (G1-G3 statuses and the G4 submission for step 5, as gates/g4.test.ts does), the step's own record
// is still written by the native workflow: the Sponsor's G4 decision, FIN's validation decision, the receiving owner's
// acceptance. Everything is SYNTHETIC: each decision is a synthetic demonstration decision that approves nothing real,
// product gates G1-G6 are business approvals inside the product, and nothing here touches the engineering gates
// DG0-DG7. Each database is a scratch database of this run's disposable cluster.
import { createDb, createPool, migrate, seedDemo, sql, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { TEST_DEMO_MODULES } from "../../../../../packages/db/test/demo-fixture.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { runControlCheckScan } from "../../../../worker/src/handlers/sustainment.ts";
import { record } from "../../../src/modules/audit/index.ts";
import {
  auditCount,
  call,
  createTransformationRow,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { gateVersion, ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { extraUser, seedBenefitWorld } from "../benefits/fixtures.ts";
import { approve, measuredBenefit, submittedValue } from "../benefits/value-fixtures.ts";
import { seedSustainmentWorld } from "../contract/p4-exercises-be-i.ts";
import { financeUser } from "../contract/p3-exercises-kbe-b.ts";
import { makeDirection } from "../contract/p3-exercises-be-b.ts";
import { insertInitiative } from "../contract/p3-exercises-be-d.ts";
import { setupMeetingWorld } from "../governance/meeting-fixtures.ts";
import { askBody } from "../governance/t16-fixtures.ts";
import { seedKpiWorld } from "../kpi/fixtures.ts";
import { monthlyPeriod, ownedKpi, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";
import { pendingSubmission, setGateStatus } from "../portfolio/fixtures.ts";
import { draftHandover } from "../reporting/kbe-d2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const W = "/api/v1/demo/walkthrough";
const NOT_DEMO = "This is available only in the demo environment.";
const RATIONALE = "Synthetic demonstration decision; approves nothing real.";

/** M0349, verbatim, in order (the catalogue's English titles). */
const M0349_STEPS = [
  "create transformation",
  "diagnose and agree baseline",
  "define outcomes/KPIs",
  "design TOM",
  "prioritize initiatives and approve mobilization",
  "update delivery/adoption",
  "submit KPI actual",
  "validate benefit",
  "resolve executive decision",
  "generate report",
  "accept BAU handover",
  "continue performance monitoring",
];
const CODES = [
  "create_transformation",
  "diagnose_baseline",
  "define_outcomes_kpis",
  "design_tom",
  "prioritize_mobilize",
  "update_delivery_adoption",
  "submit_kpi_actual",
  "validate_benefit",
  "resolve_decision",
  "generate_report",
  "accept_bau_handover",
  "continue_monitoring",
] as const;
type StepCode = (typeof CODES)[number];

let api: TestApi;
let prod: TestApi;
let w: World;
let pw: World;
let owner: Db;
const scratch: string[] = [];
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  const demoDb = await createScratchDatabase(adminUrl, "mth_walk_demo");
  const prodDb = await createScratchDatabase(adminUrl, "mth_walk_prod");
  scratch.push(demoDb, prodDb);
  for (const db of [demoDb, prodDb]) await migrate(roleUrl(adminUrl, db, "mth_owner"));
  // A fresh demo database: seeded with the synthetic test dataset (no transformation), as `mth-db seed-demo` does.
  await seedDemo(roleUrl(adminUrl, demoDb, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    modules: TEST_DEMO_MODULES,
  });
  owner = createDb(createPool(roleUrl(adminUrl, demoDb, "mth_owner"), { max: 1 }));
  api = await startApi({ database: demoDb, env: { MTH_ENV: "demo" } });
  w = await seedWorld(api.db);
  // The production database: no marker (reads as production, ADR-0050 §1 fail-safe).
  prod = await startApi({ database: prodDb });
  pw = await seedWorld(prod.db);
}, 180_000);

afterAll(async () => {
  await owner?.destroy();
  await api?.close();
  await prod?.close();
  for (const name of scratch) await dropScratchDatabase(inject("mthDb").adminUrl, name);
}, 60_000);

const ok = (res: { status: number; body: Body }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body;
};

/** The walkthrough of transformation `t` as `session` sees it. */
async function walk(t: string, session: Session): Promise<Body> {
  return ok(await call<Body>(api.app, "GET", `${W}?transformationId=${t}`, { session }), 200, "getDemoWalkthrough");
}

/** {step code: completed} of transformation `t`. */
async function completion(t: string, session: Session): Promise<Record<StepCode, boolean>> {
  const body = await walk(t, session);
  return Object.fromEntries(body.steps.map((s: Body) => [s.code, s.completed])) as Record<StepCode, boolean>;
}

/** Step `code` of `t`: false before `workflow`, true after it (the step's rule, read from persisted records). */
async function becomesTrue(t: string, session: Session, code: StepCode, workflow: () => Promise<void>) {
  expect((await completion(t, session))[code], `${code} before its workflow`).toBe(false);
  await workflow();
  const after = await completion(t, session);
  expect(after[code], `${code} after its workflow`).toBe(true);
  return after;
}

// ------------------------------------------------------------------------------------------------ production
describe("production gives 409 environment.not_demo (ADR-0050 §9)", () => {
  it("with and without a transformation, for every signed-in user; nothing is written", async () => {
    const t = await createTransformationRow(prod.db, pw.orgA.id, pw.a1, pw.office.id);
    const sessions = [];
    for (const subject of [pw.office.subject, pw.leadA1.subject, pw.auditor.subject, pw.admin.subject])
      sessions.push(await signIn(prod.app, subject));
    const before = await auditCount(prod.db);
    for (const session of sessions) {
      for (const url of [W, `${W}?transformationId=${t}`, `${W}?transformationId=${uuidv7()}`]) {
        const res = await call<Body>(prod.app, "GET", url, { session });
        expect([res.status, res.body.code, res.body.detail]).toEqual([409, "environment.not_demo", NOT_DEMO]);
      }
    }
    expect(await auditCount(prod.db)).toBe(before);
  });
});

// ------------------------------------------------------------------------------------------------ the catalogue
describe("the twelve M0349 steps (REQ-S18-004)", () => {
  it("without a transformation: twelve verbatim steps in order, none completed; step 1 opens the create form", async () => {
    const lead = await signIn(api.app, w.leadA1.subject);
    const body = ok(await call<Body>(api.app, "GET", W, { session: lead }), 200, "walkthrough");
    expect([body.transformationId, body.total, body.completedCount]).toEqual([null, 12, 0]);
    expect(body.steps.map((s: Body) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(body.steps.map((s: Body) => s.code)).toEqual(CODES);
    expect(body.steps.map((s: Body) => s.titleEn)).toEqual(M0349_STEPS);
    expect(body.steps.every((s: Body) => s.titleAr.length > 0 && s.completed === false)).toBe(true);
    expect(body.steps.map((s: Body) => s.areaCode)).toEqual([
      "transformations",
      "strategy_kpis",
      "strategy_kpis",
      "target_operating_model",
      "initiatives_roadmaps",
      "change_adoption",
      "strategy_kpis",
      "benefits_finance",
      "governance",
      "evidence_reports",
      "bau_improvement",
      "bau_improvement",
    ]);
    expect(body.steps.map((s: Body) => s.route)).toEqual([
      "/transformations/new",
      "/strategy-kpis",
      "/strategy-kpis",
      "/target-operating-model",
      "/initiatives-roadmaps",
      "/change-adoption",
      "/strategy-kpis",
      "/benefits-finance",
      "/governance",
      "/evidence-reports",
      "/bau-improvement",
      "/bau-improvement",
    ]);
  });

  it("a fresh demo database: a transformation created through the API completes step 1 only; 2-12 incomplete", async () => {
    const p = await setupP2World(api, w);
    const before = await auditCount(api.db);
    const body = await walk(p.transformationId, p.lead.session);
    expect(body.transformationId).toBe(p.transformationId);
    expect(body.steps.map((s: Body) => s.completed)).toEqual([true, ...Array<boolean>(11).fill(false)]);
    expect(body.completedCount).toBe(1);
    const T = `/transformations/${p.transformationId}`;
    expect(body.steps.map((s: Body) => s.route)).toEqual([
      T,
      `${T}/diagnose`,
      `${T}/define`,
      `${T}/design`,
      `${T}/prioritization`,
      `${T}/adoption`,
      `${T}/kpis`,
      `${T}/finance-validations`,
      `${T}/executive-decisions`,
      `${T}/reports`,
      `${T}/bau-handovers`,
      `${T}/bau`,
    ]);
    // The guide writes nothing (no audit event, no stored completion), and AUD reads it as any signed-in user.
    expect((await walk(p.transformationId, p.auditor.session)).completedCount).toBe(1);
    expect(await auditCount(api.db)).toBe(before);
  });

  it("a seeded (dataset) transformation is not one 'created in this demo database': step 1 stays incomplete", async () => {
    const t = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const lead = await signIn(api.app, w.office.subject);
    expect((await completion(t, lead)).create_transformation).toBe(true);
    // Registered as a dataset fixture, as `seed-demo` registers every seeded row (demo_seed_record, owner-written).
    await owner
      .insertInto("demo_seed_record")
      .values({ record_type: "transformation", record_id: t, fixture_key: `test.walkthrough.${t}` })
      .execute();
    expect((await completion(t, lead)).create_transformation).toBe(false);
  });

  it("404 outside the caller's scope and for an unknown id (never disclosed); 400; 401", async () => {
    const p = await setupP2World(api, w);
    for (const subject of [w.officeB.subject, w.nobody.subject]) {
      const session = await signIn(api.app, subject);
      const res = await call<Body>(api.app, "GET", `${W}?transformationId=${p.transformationId}`, { session });
      expect([res.status, res.body.code]).toEqual([404, "not_found"]);
    }
    const unknown = await call<Body>(api.app, "GET", `${W}?transformationId=${uuidv7()}`, {
      session: p.lead.session,
    });
    expect([unknown.status, unknown.body.code]).toEqual([404, "not_found"]);
    expect((await call(api.app, "GET", `${W}?transformationId=x`, { session: p.lead.session })).status).toBe(400);
    expect((await call(api.app, "GET", `${W}?other=1`, { session: p.lead.session })).status).toBe(400);
    expect((await call(api.app, "GET", W)).status).toBe(401);
  });
});

// ------------------------------------------------------------------------------------------------ the twelve rules
describe("each step's rule becomes true after the native workflow writes its record (ADR-0050 §7)", () => {
  it("2 diagnose and agree baseline: FIN validates the baseline; a later edit makes it stale again", async () => {
    const p = await setupP2World(api, w);
    const fin = await financeUser(api, w, p);
    const T = `/api/v1/transformations/${p.transformationId}`;
    let baseline: Body;
    await becomesTrue(p.transformationId, p.lead.session, "diagnose_baseline", async () => {
      baseline = ok(
        await send("POST", `${T}/baselines`, {
          session: p.lead.session,
          body: {
            metric: "Roaming revenue per month (synthetic)",
            unit: "SAR",
            scope: "revenue",
            value: "1250000",
            currency: "SAR",
            source: "Synthetic finance extract",
            baselineDate: "2026-01-31",
          },
        }),
        201,
        "createBaseline",
      );
      expect((await completion(p.transformationId, p.lead.session)).diagnose_baseline).toBe(false);
      ok(
        await send("POST", `${T}/baselines/${baseline.id}/validation`, {
          session: fin.session,
          headers: ifm(baseline.version),
          body: { result: "validated", note: "Synthetic: matches the extract." },
        }),
        200,
        "validateBaseline",
      );
    });
    const validated = await api.db
      .selectFrom("baseline")
      .select("version")
      .where("id", "=", baseline.id)
      .executeTakeFirstOrThrow();
    ok(
      await send("PATCH", `${T}/baselines/${baseline.id}`, {
        session: p.lead.session,
        headers: ifm(validated.version),
        body: { value: "1300000" },
      }),
      200,
      "updateBaseline",
    );
    expect((await completion(p.transformationId, p.lead.session)).diagnose_baseline).toBe(false);
  });

  it("3 define outcomes/KPIs: an outcome, a KPI definition and their T02 link", async () => {
    const p = await setupP2World(api, w);
    await becomesTrue(p.transformationId, p.lead.session, "define_outcomes_kpis", async () => {
      await makeDirection(send, p);
    });
  });

  it("4 design TOM: a target-state canvas cell and a TOM gap (either alone is not enough)", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    await becomesTrue(p.transformationId, p.lead.session, "design_tom", async () => {
      const cell = ok(await send("GET", `${T}/tom-canvas/technology`, { session: p.lead.session }), 200, "cell");
      ok(
        await send("PATCH", `${T}/tom-canvas/technology`, {
          session: p.lead.session,
          headers: ifm(cell.cell.version),
          body: { targetDesign: "Synthetic: cloud-native roaming rating", ownerUserId: p.lead.id, status: "ready" },
        }),
        200,
        "updateTomCanvasCell",
      );
      expect((await completion(p.transformationId, p.lead.session)).design_tom).toBe(false);
      ok(
        await send("POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology" } }),
        201,
        "createTomGap",
      );
    });
  });

  it("5 prioritize and approve mobilization: an initiative scored, then the Sponsor's G4 decision (synthetic)", async () => {
    const p = await setupP2World(api, w);
    await mobilize(p);
    await becomesTrue(p.transformationId, p.lead.session, "prioritize_mobilize", async () => {
      const ini = await insertInitiative(api, p.transformationId, p.lead.id);
      ok(
        await send("POST", `/api/v1/initiatives/${ini.id}/scores`, {
          session: p.contributor.session,
          body: { criterionCode: "strategic_fit", score: 4 },
        }),
        201,
        "scoreInitiative",
      );
      expect((await completion(p.transformationId, p.lead.session)).prioritize_mobilize).toBe(false);
      // The G4 submission is staged by the shared fixture (the state submit writes); the decision is the Sponsor's.
      const submissionNo = await pendingSubmission(api, p, "G4");
      ok(
        await send("POST", `/api/v1/transformations/${p.transformationId}/gates/G4/decision`, {
          session: p.sponsor.session,
          body: { submissionNo, outcome: "approved", rationale: RATIONALE },
        }),
        201,
        "decideGate G4",
      );
    });
    expect(await gateVersion(api, p, "G4")).toBeGreaterThan(1);
  });

  it("6 update delivery/adoption: a submitted owner update, then a completed training record", async () => {
    const b = await seedBenefitWorld(api, w);
    const wl = await extraUser(api, w, b, "WL");
    const period = await monthlyPeriod(api, w);
    await becomesTrue(b.transformationId, b.s.tl, "update_delivery_adoption", async () => {
      const ws = ok(
        await send("POST", `${b.base}/workstreams`, {
          session: b.s.tl,
          body: { name: "Synthetic roaming bundles", leadUserId: wl.id },
        }),
        201,
        "createWorkstream",
      );
      const u = ok(
        await send("POST", `${b.base}/updates`, {
          session: wl.session,
          body: {
            subjectType: "workstream",
            subjectId: ws.id,
            reportingPeriodId: period.id,
            achievements: "Synthetic: launched the roaming day-pass pilot.",
          },
        }),
        201,
        "createOwnerUpdate",
      );
      ok(
        await send("POST", `${b.base}/updates/${u.id}/submit`, { session: wl.session, headers: ifm(u.version) }),
        200,
        "submitOwnerUpdate",
      );
      expect((await completion(b.transformationId, b.s.tl)).update_delivery_adoption).toBe(false);
      const group = ok(
        await send("POST", `${b.base}/stakeholder-groups`, {
          session: b.s.tl,
          body: {
            name: "Synthetic frequent travellers",
            impact: "H",
            influence: "L",
            currentStance: "support",
            requiredBehavior: "Synthetic: activate roaming in the app",
            interventionTypes: ["training"],
            ownerUserId: b.users.bo.id,
          },
        }),
        201,
        "createStakeholderGroup",
      );
      const tr = ok(
        await send("POST", `${b.base}/training-records`, {
          session: b.s.bo,
          body: { stakeholderGroupId: group.id, participantUserId: b.users.fin.id, trainingTitle: "Synthetic app" },
        }),
        201,
        "createTrainingRecord",
      );
      expect((await completion(b.transformationId, b.s.tl)).update_delivery_adoption).toBe(false);
      ok(
        await send("PATCH", `${b.base}/training-records/${tr.id}`, {
          session: b.s.bo,
          headers: ifm(tr.version),
          body: { status: "completed", completedOn: "2026-10-01" },
        }),
        200,
        "completeTrainingRecord",
      );
    });
  });

  it("7 submit KPI actual: the KPI owner submits the period's actual", async () => {
    const k = await seedKpiWorld(api, w);
    const period = await monthlyPeriod(api, w);
    const kpi = await ownedKpi(api, k);
    await becomesTrue(k.transformationId, k.s.tl, "submit_kpi_actual", async () => {
      const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: "120.5" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });
  });

  it("8 validate benefit: a submitted measurement is not enough; FIN's approval validates it (synthetic)", async () => {
    const b = await seedBenefitWorld(api, w);
    await becomesTrue(b.transformationId, b.s.tl, "validate_benefit", async () => {
      const ben = await measuredBenefit(api, b);
      const v = await submittedValue(api, b, ben.id, "250000");
      expect((await completion(b.transformationId, b.s.tl)).validate_benefit).toBe(false);
      await approve(api, b, v, "240000");
    });
  });

  it("9 resolve executive decision: an open ask is not resolved; the owner records the outcome", async () => {
    const x = await setupMeetingWorld(api, w);
    const T = `/api/v1/transformations/${x.transformationId}`;
    await becomesTrue(x.transformationId, x.lead.session, "resolve_decision", async () => {
      const created = ok(
        await send("POST", `${T}/executive-decisions`, {
          session: x.lead.session,
          body: askBody(x.bo.id, "2041-06-30"),
        }),
        201,
        "createExecutiveDecision",
      );
      expect((await completion(x.transformationId, x.lead.session)).resolve_decision).toBe(false);
      ok(
        await send("POST", `${T}/executive-decisions/${created.id}/outcome`, {
          session: x.bo.session,
          headers: ifm(created.version),
          body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic: switch vendor" },
        }),
        200,
        "recordExecutiveDecisionOutcome",
      );
    });
  });

  it("10 generate report: a generated snapshot completes it; a discarded one does not", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const first = ok(
      await send("POST", `${T}/reports/charter/generate`, { session: p.lead.session, body: {} }),
      201,
      "generate",
    );
    expect((await completion(p.transformationId, p.lead.session)).generate_report).toBe(true);
    ok(
      await send("POST", `${T}/report-snapshots/${first.id}/discard`, {
        session: p.lead.session,
        headers: ifm(first.version),
        body: { reason: "Synthetic: wrong period" },
      }),
      200,
      "discard",
    );
    await becomesTrue(p.transformationId, p.lead.session, "generate_report", async () => {
      ok(await send("POST", `${T}/reports/charter/generate`, { session: p.lead.session, body: {} }), 201, "generate");
    });
  });

  it("11 and 12: the receiving owner accepts the handover; then only a check performed after it continues monitoring", async () => {
    const s = await seedSustainmentWorld(api, w);
    const t = s.b.transformationId;
    const d = await draftHandover(api, s);
    // A control check performed BEFORE the acceptance (it does not count for step 12).
    await performedCheck(s, d.areaId, "2025-03-10");
    await becomesTrue(t, s.b.s.tl, "accept_bau_handover", async () => {
      const sub = ok(
        await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(d.version) }),
        200,
        "submitHandover",
      );
      expect((await completion(t, s.b.s.tl)).accept_bau_handover).toBe(false);
      ok(
        await send("POST", `${d.H}/accept`, { session: s.b.s.bo, headers: ifm(sub.version), body: {} }),
        200,
        "acceptHandover",
      );
    });
    await becomesTrue(t, s.b.s.tl, "continue_monitoring", async () => {
      await performedCheck(s, d.areaId, "2025-04-10");
    });
  });
});

describe("each rule reads only the given transformation", () => {
  it("after every workflow above ran in this database, a new transformation still has step 1 only", async () => {
    const p = await setupP2World(api, w);
    const body = await walk(p.transformationId, p.lead.session);
    expect([body.completedCount, body.steps[0].completed]).toEqual([1, true]);
  });
});

// ------------------------------------------------------------------------------------------------ helpers

/** G1-G3 staged approved and the phase moved to `mobilize`, with their audit events (the gates/g4.test.ts fixture). */
async function mobilize(p: P2World): Promise<void> {
  for (const g of ["G1", "G2", "G3"]) await setGateStatus(api, p, g, "approved");
  await api.db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .selectAll()
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    await tx
      .updateTable("transformation")
      .set({ current_phase: "mobilize", version: sql<number>`version + 1`, updated_by: p.lead.id })
      .where("id", "=", t.id)
      .execute();
    await record(
      tx,
      { actorUserId: p.lead.id, requestId: `fixture-${uuidv7()}` },
      {
        action: "transformation.fixture_phase",
        recordType: "transformation",
        recordId: t.id,
        organizationId: t.organization_id,
        transformationId: t.id,
        priorVersion: t.version,
        newVersion: t.version + 1,
        changes: { current_phase: { from: t.current_phase, to: "mobilize" } },
      },
    );
  });
}

/** A control of the area created by TO, its check created by the worker's scan, and BO recording it passed. */
async function performedCheck(
  s: Awaited<ReturnType<typeof seedSustainmentWorld>>,
  areaId: string,
  due: string,
): Promise<void> {
  const ctl = ok(
    await send("POST", `${s.b.base}/controls`, {
      session: s.to.session,
      body: {
        performanceAreaId: areaId,
        name: `Synthetic roaming reconciliation ${due}`,
        frequency: "monthly",
        ownerUserId: s.b.users.bo.id,
        nextCheckDate: due,
      },
    }),
    201,
    "createControl",
  );
  const scan = await runControlCheckScan(api.db, `walkthrough-${ctl.id}`, {
    asOf: due,
    organizationId: s.b.organizationId,
  });
  const step = scan.steps.find((x) => x.subjectId === ctl.id)!;
  expect(step.outcome).toBe("created");
  ok(
    await send("POST", `${s.b.base}/control-checks/${step.recordId}/record`, {
      session: s.b.s.bo,
      headers: ifm(1),
      body: { result: "passed" },
    }),
    200,
    "recordControlCheck",
  );
}
