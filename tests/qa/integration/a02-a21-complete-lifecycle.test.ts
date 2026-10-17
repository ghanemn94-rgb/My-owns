// qa-verifier A02 "Complete lifecycle" and A21 "No-AI operation" (DG5, T-DG5-QA-E). Master prompt §20:
//   A02 "Authorized users complete the guided end-to-end scenario using only native application workflows";
//   A21 "Core lifecycle, approvals, calculations and reports still work with AI and external notification channels
//        disabled".
// The binding row texts (docs/delivery/requirements.csv), each tested literally below:
//   REQ-S20-002 / REQ-S18-004  the twelve M0349 walkthrough steps performed with native workflows, resulting records
//                              verified (ADR-0050 §7 completion rules, read through GET /demo/walkthrough);
//   REQ-S18-004                "with the demo role users": the seeded roaming.user.<role> users sign in through the
//                              demo IdP path and perform step 1 themselves;
//   REQ-S01-003                the scenario passes input, validation, approval, output, monitoring, correction and
//                              sustainment on persisted records;
//   REQ-S01-004 (A21)          the A02 scenario completes with exports, email and AI channels disabled; no workflow
//                              step's completion condition references an uploaded spreadsheet, deck or email;
//   REQ-S06-002                a baseline-validation instance shows its current step and assignee; completing it
//                              creates a validated baseline record linked to the instance;
//   REQ-S06-003                the ten procedures exist after initialization and each can be launched and completed;
//   REQ-S09-011                the executive pack's workstream section contains the submitted update text and current
//                              metrics without manual editing;
//   REQ-S18-002                seed coverage: at least one record for each listed condition.
// The database is a scratch database of this run's disposable cluster, migrated and seeded with the REAL synthetic demo
// dataset (`seedDemo`, International Roaming; ADR-0050), and the REAL API runs on it with MTH_ENV=demo. No worker
// export runner, no e-mail adapter and no AI adapter is wired (none exists in P5: p5-plan l.356, D-142 Q11), and the
// scenario never calls an export endpoint: that is the "channels disabled" configuration of this run (see the A21
// test, which also proves that no export job was queued). Everything is SYNTHETIC: every G1-G6 decision, Finance
// validation and executive decision below is a synthetic in-product decision on test data that approves nothing real.
// Nothing names the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { draftHandover } from "../../../apps/api/test/integration/reporting/kbe-d2-fixtures.ts";
import {
  measuredBenefit,
  submittedValue,
  approve,
} from "../../../apps/api/test/integration/benefits/value-fixtures.ts";
import { monthlyPeriod, ownedKpi, submitActual } from "../../../apps/api/test/integration/kpi-p4/kbe-c-fixtures.ts";
import { call, createUser, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { seedWorld, type World } from "../support/p4.ts";
import {
  coverWithException,
  decideGate,
  missingKeys,
  passGatesNatively,
  plusDays,
  submitGate,
  type NativeGateWorld,
} from "../support/gates-native.ts";
import { createKpi, postVersion } from "../../../apps/api/test/integration/kpi-p4/kbe-b-fixtures.ts";
import { DIRECT_FLOW } from "../../../apps/api/test/integration/kpi-p4/kbe-c-fixtures.ts";
import { DEMO_ANCHORS, DEMO_USERS, FakeDemoIdp, demoSignIn, grantedActor, type Actor } from "../support/a02.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const W = "/api/v1/demo/walkthrough";
const ifm = (v: number) => ({ "if-match": `"${v}"` });

const STEPS = [
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
type Step = (typeof STEPS)[number];

/** REQ-S06-003's ten procedures, in the row's order (the published procedure codes are matched by name). */
const TEN_PROCEDURES = [
  "New transformation intake",
  "Baseline validation",
  "KPI submission",
  "TOM approval",
  "Initiative prioritization",
  "Gate review",
  "Scope/target change",
  "Benefit validation",
  "Executive escalation",
  "BAU handover",
];

/** Words that would make a completion condition depend on an off-platform artefact (REQ-S01-004). */
const OFF_PLATFORM = /spreadsheet|excel|\.xlsx|\.xls\b|\bcsv\b|slide|deck|powerpoint|\.pptx|e-?mail/i;

let api: TestApi;
let idp: FakeDemoIdp;
let scratch: string | null = null;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const ok = (res: { status: number; body: Body }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 1200)}`).toBe(status);
  return res.body;
};

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_a02_demo");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  idp = new FakeDemoIdp();
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" }, oidc: idp });
  w = await seedWorld(api.db);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

async function completion(t: string, session: Session): Promise<Record<Step, boolean>> {
  const body = ok(await send("GET", `${W}?transformationId=${t}`, { session }), 200, "getDemoWalkthrough");
  return Object.fromEntries(body.steps.map((s: Body) => [s.code, s.completed])) as Record<Step, boolean>;
}

// ------------------------------------------------------------------------------------------------ demo role users
describe("REQ-S18-004: the demo role users of the demo database", () => {
  it("every seeded demo role user signs in through the demo IdP path and is a synthetic user of the demo organization", async () => {
    const env = ok(
      await send("GET", "/api/v1/environment", { session: await signIn(api.app, w.office.subject) }),
      200,
      "env",
    );
    expect(env).toMatchObject({ kind: "demo", synthetic: true, datasetCode: "international_roaming" });
    expect(DEMO_USERS.map((u) => u.role)).toEqual(["SP", "TL", "BO", "FIN", "KDS", "WL", "TO", "CM"]);
    for (const u of DEMO_USERS) {
      const r = await demoSignIn(api, idp, u.name);
      expect([r.loginStatus, r.callbackStatus, r.callbackLocation], u.name).toEqual([302, 302, "/"]);
      expect(r.session, u.name).not.toBeNull();
      const me = ok(await send("GET", "/api/v1/me", { session: r.session! }), 200, `me ${u.name}`);
      expect([me.user.id, me.user.organizationId ?? DEMO_ANCHORS.organizationId]).toEqual([
        u.id,
        DEMO_ANCHORS.organizationId,
      ]);
    }
    // An unknown subject of the same issuer is not provisioned (negative).
    const stranger = await demoSignIn(api, idp, "roaming.user.nobody");
    expect([stranger.callbackStatus, stranger.callbackLocation, stranger.session]).toEqual([
      302,
      "/login?error=not_provisioned",
      null,
    ]);
  });

  it("step 1 'create transformation' is performed by the demo Transformation Lead in the demo business unit", async () => {
    const tl = DEMO_USERS.find((u) => u.role === "TL")!;
    const r = await demoSignIn(api, idp, tl.name);
    expect(r.session).not.toBeNull();
    const created = await send("POST", "/api/v1/transformations", {
      session: r.session!,
      body: {
        businessUnitId: DEMO_ANCHORS.businessUnitId,
        name: "Synthetic QA A02 demo-user transformation",
        mode: "end_to_end",
      },
    });
    // A02 / REQ-S18-004: the walkthrough's first step is performed by a demo role user. Kept failing on purpose when the
    // demo users cannot do it (see the handback, defect D-QA-E-1).
    expect(created.status, `createTransformation as ${tl.name}: ${JSON.stringify(created.body)}`).toBe(201);
    const steps = await completion(created.body.id, r.session!);
    expect(steps.create_transformation).toBe(true);
  });

  it("the seeded roaming transformation is not 'created in this demo database': step 1 is open for the demo users", async () => {
    const sp = await demoSignIn(api, idp, DEMO_USERS[0]!.name);
    const body = ok(
      await send("GET", `${W}?transformationId=${DEMO_ANCHORS.transformationId}`, { session: sp.session! }),
      200,
      "walkthrough",
    );
    expect([body.total, body.steps.length, body.steps[0].code, body.steps[0].completed]).toEqual([
      12,
      12,
      "create_transformation",
      false,
    ]);
  });
});

// ------------------------------------------------------------------------------------------------ the lifecycle
interface Lifecycle {
  t: string;
  base: string;
  tl: Actor;
  sp: Actor;
  bo: Actor;
  bo2: Actor;
  fin: Actor;
  kds: Actor;
  wl: Actor;
  to: Actor;
  auditor: Actor;
  admin: Session;
  /** Records produced by the scenario (REQ-S01-003 chain). */
  rec: Record<string, string>;
  updateText: string;
  kpiValue: string;
  history: Array<{ step: Step; completed: number }>;
  /** The fixture worlds of the scenario (gate, KPI, benefit and sustainment views of the same transformation). */
  ctx: { g: NativeGateWorld; k: Body; bw: Body; sw: Body };
}
let L: Lifecycle | null = null;

describe("A02 / REQ-S20-002 / REQ-S18-004: one transformation through the twelve walkthrough steps, natively", () => {
  it("each step is false before its native workflow and true after it; all twelve end completed on persisted records", async () => {
    const admin = await signIn(api.app, w.admin.subject);
    const tlUser = { id: w.leadA1.id, subject: w.leadA1.subject, session: await signIn(api.app, w.leadA1.subject) };
    const auditor = { id: w.auditor.id, subject: w.auditor.subject, session: await signIn(api.app, w.auditor.subject) };
    const to = { id: w.office.id, subject: w.office.subject, session: await signIn(api.app, w.office.subject) };
    const history: Lifecycle["history"] = [];
    let gw: NativeGateWorld | null = null;
    let t = "";
    const check = async (step: Step, workflow: () => Promise<void>) => {
      if (t) expect((await completion(t, tlUser.session))[step], `${step} before its workflow`).toBe(false);
      await workflow();
      const after = await completion(t, tlUser.session);
      expect(after[step], `${step} after its workflow`).toBe(true);
      // Monotone: every earlier step stays completed (the records persist).
      const idx = STEPS.indexOf(step);
      expect(
        STEPS.slice(0, idx + 1).filter((s) => !after[s]),
        `earlier steps after ${step}`,
      ).toEqual([]);
      history.push({ step, completed: Object.values(after).filter(Boolean).length });
    };

    // 1. create transformation (the Lead, native POST /transformations).
    await check("create_transformation", async () => {
      const created = ok(
        await send("POST", "/api/v1/transformations", {
          session: tlUser.session,
          body: { businessUnitId: w.a1, name: "Synthetic QA A02 lifecycle", mode: "end_to_end" },
        }),
        201,
        "createTransformation",
      );
      t = created.id;
    });
    const base = `/api/v1/transformations/${t}`;
    const mk = (role: string) => grantedActor(api, admin, w.orgA.id, t, role);
    const sp = await mk("SP");
    const sp2 = await mk("SP");
    const bo = await mk("BO");
    const bo2 = await mk("BO");
    const fin = await mk("FIN");
    const kds = await mk("KDS");
    const wl = await mk("WL");
    for (const [partyCode, userId] of [
      ["SP", sp.id],
      ["BO", bo.id],
    ] as const)
      ok(
        await send("POST", `${base}/role-mappings`, {
          session: tlUser.session,
          body: { partyCode, targetKind: "user", userId },
        }),
        201,
        `role mapping ${partyCode}`,
      );
    const rec: Record<string, string> = {};

    // 2. diagnose and agree baseline (Lead records it, Finance validates it).
    await check("diagnose_baseline", async () => {
      const b = ok(
        await send("POST", `${base}/baselines`, {
          session: tlUser.session,
          body: {
            metric: "Roaming revenue per month (synthetic)",
            unit: "SAR",
            scope: "revenue",
            value: "1250000.00",
            currency: "SAR",
            source: "Synthetic finance extract",
            baselineDate: "2026-01-31",
          },
        }),
        201,
        "createBaseline",
      );
      ok(
        await send("POST", `${base}/baselines/${b.id}/validation`, {
          session: fin.session,
          headers: ifm(b.version),
          body: { result: "validated", note: "Synthetic: matches the extract." },
        }),
        200,
        "validateBaseline",
      );
      rec.baseline = b.id;
    });

    // 3. define outcomes/KPIs (outcome, KPI definition, T02 link).
    await check("define_outcomes_kpis", async () => {
      const o = ok(
        await send("POST", `${base}/outcomes`, {
          session: tlUser.session,
          body: { statement: "Synthetic: roaming revenue grows." },
        }),
        201,
        "createOutcome",
      );
      const k = ok(
        await send("POST", `${base}/kpi-definitions`, {
          session: tlUser.session,
          body: { name: "Synthetic roaming attach rate", unitKind: "count", polarity: "higher_is_better" },
        }),
        201,
        "createKpiDefinition",
      );
      const ok2 = ok(
        await send("POST", `${base}/outcome-kpis`, {
          session: tlUser.session,
          body: { outcomeId: o.id, kpiDefinitionId: k.id, targetDate: "2027-12-31" },
        }),
        201,
        "createOutcomeKpi",
      );
      rec.outcome = o.id;
      rec.outcomeKpi = ok2.id;
    });

    // 4. design TOM (target-state cell and a gap).
    await check("design_tom", async () => {
      const cell = ok(await send("GET", `${base}/tom-canvas/technology`, { session: tlUser.session }), 200, "cell");
      ok(
        await send("PATCH", `${base}/tom-canvas/technology`, {
          session: tlUser.session,
          headers: ifm(cell.cell.version),
          body: { targetDesign: "Synthetic: digital roaming activation", ownerUserId: tlUser.id, status: "ready" },
        }),
        200,
        "updateTomCanvasCell",
      );
      const gap = ok(
        await send("POST", `${base}/tom-gaps`, { session: tlUser.session, body: { dimensionCode: "technology" } }),
        201,
        "createTomGap",
      );
      rec.tomGap = gap.id;
    });

    // 5. prioritize initiatives and approve mobilization: a native initiative and score; G1-G4 passed natively by the
    //    Sponsor (missing criteria covered by accepted exceptions, as a business user would), no fixture staging.
    await check("prioritize_mobilize", async () => {
      const ini = ok(
        await send("POST", "/api/v1/initiatives", {
          session: tlUser.session,
          body: { transformationId: t, name: "Synthetic roaming pass redesign" },
        }),
        201,
        "createInitiative",
      );
      ok(
        await send("POST", `/api/v1/initiatives/${ini.id}/scores`, {
          session: tlUser.session,
          body: { criterionCode: "strategic_fit", score: 4 },
        }),
        201,
        "scoreInitiative",
      );
      rec.initiative = ini.id;
      gw = {
        transformationId: t,
        organizationId: w.orgA.id,
        base,
        gates: `${base}/gates`,
        tl: tlUser,
        to,
        sp,
        sp2,
        bo,
        wl,
        auditor,
        outsider: { id: w.officeB.id, session: await signIn(api.app, w.officeB.subject) },
      };
      await passGatesNatively(api, gw, ["G1", "G2", "G3", "G4"], plusDays("2026-10-17", 120));
    });

    // 6. update delivery/adoption: the workstream lead's structured update, then a completed training record.
    const period = await monthlyPeriod(api, w);
    rec.period = period.id;
    const updateText = "Synthetic QA A02: launched the roaming day-pass pilot in two markets.";
    await check("update_delivery_adoption", async () => {
      const ws = ok(
        await send("POST", `${base}/workstreams`, {
          session: tlUser.session,
          body: { name: "Synthetic roaming bundles", leadUserId: wl.id },
        }),
        201,
        "createWorkstream",
      );
      const u = ok(
        await send("POST", `${base}/updates`, {
          session: wl.session,
          body: {
            subjectType: "workstream",
            subjectId: ws.id,
            reportingPeriodId: period.id,
            achievements: updateText,
            nextSteps: "Synthetic QA A02: extend the pilot.",
          },
        }),
        201,
        "createOwnerUpdate",
      );
      ok(
        await send("POST", `${base}/updates/${u.id}/submit`, { session: wl.session, headers: ifm(u.version) }),
        200,
        "submitOwnerUpdate",
      );
      rec.workstream = ws.id;
      rec.ownerUpdate = u.id;
      const group = ok(
        await send("POST", `${base}/stakeholder-groups`, {
          session: tlUser.session,
          body: {
            name: "Synthetic frequent travellers",
            impact: "H",
            influence: "L",
            currentStance: "support",
            requiredBehavior: "Synthetic: activate roaming in the app",
            interventionTypes: ["training"],
            ownerUserId: bo.id,
          },
        }),
        201,
        "createStakeholderGroup",
      );
      const tr = ok(
        await send("POST", `${base}/training-records`, {
          session: bo.session,
          body: { stakeholderGroupId: group.id, participantUserId: fin.id, trainingTitle: "Synthetic app" },
        }),
        201,
        "createTrainingRecord",
      );
      ok(
        await send("PATCH", `${base}/training-records/${tr.id}`, {
          session: bo.session,
          headers: ifm(tr.version),
          body: { status: "completed", completedOn: "2026-10-01" },
        }),
        200,
        "completeTrainingRecord",
      );
    });

    // 7. submit KPI actual (the KPI owner, for the open period).
    const k = {
      transformationId: t,
      outcomeId: rec.outcome!,
      archivedOutcomeId: rec.outcome!,
      base,
      users: { tl: tlUser, kds, fin, sp, bo, to, auditor },
      s: {
        tl: tlUser.session,
        kds: kds.session,
        fin: fin.session,
        sp: sp.session,
        bo: bo.session,
        to: to.session,
        auditor: auditor.session,
      },
    } as Body;
    const kpi = await ownedKpi(api, k);
    const kpiValue = "120.5";
    await check("submit_kpi_actual", async () => {
      const res = await submitActual(api, k, kpi.id, { reportingPeriodId: period.id, value: kpiValue });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      rec.kpiActual = res.body.actual.id;
    });
    rec.kpi = kpi.id;

    // 8. validate benefit (Business Owner measures and submits; Finance validates: a synthetic decision).
    const kpiForBenefit = ok(
      await send("POST", `${base}/kpi-definitions`, {
        session: tlUser.session,
        body: { name: "Synthetic NPS (CX)", unitKind: "score", polarity: "higher_is_better" },
      }),
      201,
      "kpi for benefit",
    );
    const formula = ok(
      await send("POST", "/api/v1/benefit-formulas", {
        session: tlUser.session,
        body: { transformationId: t, benefitName: "Synthetic roaming revenue uplift formula" },
      }),
      201,
      "createBenefitFormula",
    );
    const bw = {
      transformationId: t,
      organizationId: w.orgA.id,
      base,
      users: { tl: tlUser, bo, bo2, fin, auditor: w.auditor, admin: w.admin, outsider: w.officeB },
      s: {
        tl: tlUser.session,
        bo: bo.session,
        bo2: bo2.session,
        fin: fin.session,
        auditor: auditor.session,
        admin,
        outsider: await signIn(api.app, w.officeB.subject),
      },
      kpiDefinitionId: kpiForBenefit.id,
      benefitFormulaId: formula.id,
    } as Body;
    await check("validate_benefit", async () => {
      const ben = await measuredBenefit(api, bw);
      const v = await submittedValue(api, bw, ben.id, "250000.00");
      await approve(api, bw, v, "240000.00");
      rec.benefit = ben.id;
      rec.benefitMeasurement = v.measurementId;
      rec.financeValidation = v.validationId;
    });

    // 9. resolve executive decision (Lead raises the ask, the owner records the outcome: synthetic).
    await check("resolve_decision", async () => {
      const ask = ok(
        await send("POST", `${base}/executive-decisions`, {
          session: tlUser.session,
          body: {
            title: "Synthetic: approve the roaming partner switch",
            whyNow: "Synthetic: the partner renewal window closes this month",
            options: [{ title: "Switch partner" }, { title: "Renew the current partner", description: "Synthetic" }],
            recommendation: "A",
            impactOfDelay: "Synthetic: a further quarter on the current terms",
            ownerUserId: bo.id,
            requiredDate: "2041-06-30",
          },
        }),
        201,
        "createExecutiveDecision",
      );
      ok(
        await send("POST", `${base}/executive-decisions/${ask.id}/outcome`, {
          session: bo.session,
          headers: ifm(ask.version),
          body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic: switch partner" },
        }),
        200,
        "recordExecutiveDecisionOutcome",
      );
      rec.decision = ask.id;
    });

    // 10. generate report: the executive pack of the period, generated from the records (no slide re-creation).
    await check("generate_report", async () => {
      const snap = ok(
        await send("POST", `${base}/reports/executive_pack/generate`, {
          session: tlUser.session,
          body: { reportingPeriodId: period.id },
        }),
        201,
        "generate executive_pack",
      );
      rec.executivePack = snap.id;
    });

    // 11. accept BAU handover (the workstream lead submits it, the receiving owner accepts it).
    const sw = {
      b: bw,
      wl,
      to,
      bo2: { id: bo2.id, session: bo2.session },
      areas: `${base}/performance-areas`,
      handovers: `${base}/bau-handovers`,
    } as Body;
    await check("accept_bau_handover", async () => {
      const d = await draftHandover(api, sw);
      const sub = ok(
        await send("POST", `${d.H}/submit`, { session: wl.session, headers: ifm(d.version) }),
        200,
        "submitHandover",
      );
      ok(
        await send("POST", `${d.H}/accept`, { session: bo.session, headers: ifm(sub.version), body: {} }),
        200,
        "acceptHandover",
      );
      rec.handover = d.id;
    });

    // 12. continue performance monitoring: the KPI owner submits the next period's actual after the acceptance.
    await check("continue_monitoring", async () => {
      const next = await monthlyPeriod(api, w);
      const res = await submitActual(api, k, kpi.id, { reportingPeriodId: next.id, value: "131.25" });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      rec.kpiActualAfterHandover = res.body.actual.id;
    });

    const final = ok(await send("GET", `${W}?transformationId=${t}`, { session: auditor.session }), 200, "final");
    expect([final.completedCount, final.total]).toEqual([12, 12]);
    expect(final.steps.map((s: Body) => s.code)).toEqual(STEPS);
    expect(history.map((h) => h.completed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    L = {
      t,
      base,
      tl: tlUser,
      sp,
      bo,
      bo2,
      fin,
      kds,
      wl,
      to,
      auditor,
      admin,
      rec,
      updateText,
      kpiValue,
      history,
      ctx: { g: gw!, k, bw, sw },
    };
  }, 300_000);

  it("REQ-S01-003: the chain input -> validation -> approval -> output -> monitoring -> correction -> sustainment is on persisted records", async () => {
    expect(L, "the lifecycle test must run first").not.toBeNull();
    const l = L!;
    const db = api.db;
    const one = async (table: string, id: string): Promise<Body> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await (db as any).selectFrom(table).selectAll().where("id", "=", id).executeTakeFirst();
      expect(row, `${table} ${id}`).toBeDefined();
      return row;
    };
    // input + validation: the baseline is validated server-side by Finance.
    const b = await one("baseline", l.rec.baseline!);
    expect([b.transformation_id, b.validation_status]).toEqual([l.t, "validated"]);
    // approval: G1-G4 approved decisions of this transformation.
    const decisions = await db
      .selectFrom("gate_decision")
      .select(["gate_code", "outcome"])
      .where("transformation_id", "=", l.t)
      .where("outcome", "=", "approved")
      .execute();
    expect(decisions.map((d) => d.gate_code).sort()).toEqual(["G1", "G2", "G3", "G4"]);
    // output: the generated executive pack snapshot.
    const snap = await one("report_snapshot", l.rec.executivePack!);
    expect([snap.transformation_id, snap.status]).toEqual([l.t, "generated"]);
    // monitoring: the KPI actuals, the second after the handover's acceptance.
    const h = await one("bau_handover", l.rec.handover!);
    const actuals = await db
      .selectFrom("kpi_actual")
      .select(["status", "submitted_at"])
      .where("transformation_id", "=", l.t)
      .where("kpi_definition_id", "=", l.rec.kpi!)
      .orderBy("submitted_at")
      .execute();
    expect(actuals.map((a) => a.status).every((x) => x === "submitted" || x === "accepted")).toBe(true);
    expect(actuals).toHaveLength(2);
    const after = actuals[1]!;
    expect(h.status).toBe("accepted");
    expect(after.submitted_at!.getTime()).toBeGreaterThan(h.accepted_at!.getTime());
    // value: Finance-validated benefit measurement with an approved validation, amounts as decimal strings.
    const m = await one("benefit_measurement", l.rec.benefitMeasurement!);
    expect(m.status).toBe("validated");
    const f = await one("finance_validation", l.rec.financeValidation!);
    expect(f.status).toBe("approved");
    expect(String(f.approved_amount)).toMatch(/^240000(\.0+)?$/);
    // correction: a KPI deviating from target opens corrective action (automation "KPI deviates -> corrective action").
    // The P4 corrective-case route is the native correction workflow; the TL raises one against the KPI actual.
    const cc = ok(
      await send("POST", `${l.base}/corrective-actions`, {
        session: l.tl.session,
        body: {
          findingRef: `kpi:${l.rec.kpi}:2026-period-1`,
          title: "Synthetic QA A02: attach rate below the interim target",
          ownerUserId: l.tl.id,
          followUpDate: "2041-01-31",
        },
      }),
      201,
      "openCorrectiveCase",
    );
    const ccRow = await one("corrective_case", cc.id);
    expect(ccRow.transformation_id).toBe(l.t);

    // sustainment: the accepted handover hands the area to the receiving owner.
    expect(h.receiving_owner_user_id).toBe(l.bo.id);
  });
});

// ------------------------------------------------------------------------------------------------ REQ-S09-011
describe("REQ-S09-011: the executive pack's workstream section holds the submitted update and current metrics", () => {
  it("the generated pack contains the workstream lead's update text and the current canonical metrics, without manual editing", async () => {
    expect(L).not.toBeNull();
    const l = L!;
    const snap = ok(
      await send("GET", `${l.base}/report-snapshots/${l.rec.executivePack}`, { session: l.auditor.session }),
      200,
      "snapshot",
    );
    const sections = (snap.content?.sections ?? snap.sections ?? []) as Body[];
    console.log(
      `A02 executive pack sections: ${JSON.stringify(sections.map((x) => [x.key ?? x.code, JSON.stringify(x).length]))}`,
    );
    const wsUpdate = sections.find((x) => /^update_ws_/.test(String(x.key ?? x.code)));
    const wsMetrics = sections.find((x) => /^metrics_ws_/.test(String(x.key ?? x.code)));
    expect(wsUpdate, "the workstream's update section").toBeDefined();
    expect(wsMetrics, "the workstream's metrics section").toBeDefined();
    expect(JSON.stringify(wsUpdate)).toContain(l.updateText);
    expect(JSON.stringify(wsUpdate)).not.toContain("no_update_submitted");
    // Current metrics: the six Template 10 areas of the workstream, and the transformation's validated value equal to
    // Finance's approved amount of step 8 (decimal string), taken from the records at generation.
    expect((wsMetrics.fields as Body[]).filter((f) => String(f.key).startsWith("rag_")).map((f) => f.key)).toEqual([
      "rag_outcomes",
      "rag_value",
      "rag_portfolio",
      "rag_dependencies",
      "rag_decisions",
      "rag_people_adoption",
    ]);
    const tMetrics = sections.find((x) => String(x.key ?? x.code) === "metrics_transformation");
    const packValues = (tMetrics.fields as Body[])
      .filter((f) => /^value_/.test(String(f.key)))
      .map((f) => ({ key: f.key, value: f.value.value, currency: f.value.currency ?? null }));
    const dash = ok(
      await send("GET", `${l.base}/dashboard?periodId=${l.rec.period}`, { session: l.auditor.session }),
      200,
      "getTransformationDashboard",
    );
    // The canonical dashboard's value headlines for the same period, keyed as the pack keys them.
    const canonical = new Map<string, unknown>();
    for (const a of dash.areas as Body[])
      for (const h of (a.headlines ?? []) as Body[]) {
        const m = /^value\.(planned|forecast|submitted|validated)$/.exec(String(h.metric));
        if (m && h.value?.currency)
          canonical.set(
            `value_${m[1]}_${h.headlineBasis}_${String(h.value.currency).toLowerCase()}`,
            h.value.value ?? null,
          );
      }
    console.log(`A02 pack values ${JSON.stringify(packValues)} canonical ${JSON.stringify([...canonical])}`);
    const compared = packValues.filter((v) => canonical.has(v.key));
    expect(compared.map((v) => v.key)).toContain("value_validated_top_line_sar");
    for (const v of compared) expect(v.value, v.key).toEqual(canonical.get(v.key));
    expect(snap.status).toBe("generated");
  });
});

// ------------------------------------------------------------------------------------------------ A21 / REQ-S01-004
describe("A21 / REQ-S01-004: exports, e-mail and AI channels disabled; no completion condition needs an off-platform artefact", () => {
  it("the A02 scenario completed with no export job, no e-mail notification and no AI call", async () => {
    expect(L, "the lifecycle test must run first").not.toBeNull();
    const l = L!;
    const exports = await api.db
      .selectFrom("export_job")
      .select(({ fn }) => fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    expect(Number(exports.n)).toBe(0);
    // In P5 the only notification channel is in-app (D-142 Q11): no notification row of this transformation names
    // another channel.
    const channels = await api.db
      .selectFrom("notification")
      .select("channel")
      .distinct()
      .execute()
      .catch(() => [] as Array<{ channel: string }>);
    expect(channels.map((c) => c.channel).filter((c) => c !== "in_app")).toEqual([]);
    expect((await completion(l.t, l.auditor.session)).continue_monitoring).toBe(true);
  });

  it("no published procedure step's completion condition references an uploaded spreadsheet, deck or e-mail", async () => {
    const page = ok(
      await send("GET", "/api/v1/procedure-definitions?limit=100", {
        session: await signIn(api.app, w.office.subject),
      }),
      200,
      "defs",
    );
    const defs = page.items as Body[];
    expect(defs.length).toBeGreaterThanOrEqual(10);
    const hits: string[] = [];
    for (const d of defs) {
      expect(["all_steps_closed", "all_steps_closed_and_outputs_linked"]).toContain(d.completion.rule);
      for (const field of [d.completion.descriptionEn, d.completion.descriptionAr])
        if (OFF_PLATFORM.test(String(field))) hits.push(`${d.code}: completion "${field}"`);
      for (const s of d.steps as Body[]) {
        if (
          s.output &&
          ![
            "transformation",
            "charter",
            "baseline",
            "kpi_actual",
            "tom_canvas_cell",
            "approval",
            "ranking_snapshot",
            "gate_submission",
            "change_request",
            "finance_validation",
            "decision",
            "bau_handover",
            "evidence",
          ].includes(s.output.recordType)
        )
          hits.push(`${d.code}/${s.stepKey}: output ${s.output.recordType}`);
        if (s.condition && OFF_PLATFORM.test(String(s.condition.inputKey)))
          hits.push(`${d.code}/${s.stepKey}: condition ${s.condition.inputKey}`);
        for (const key of s.requiredInputKeys as string[])
          if (OFF_PLATFORM.test(key)) hits.push(`${d.code}/${s.stepKey}: input ${key}`);
      }
      for (const f of d.inputSchema as Body[])
        if (f.required && (f.type === "file" || OFF_PLATFORM.test(String(f.key))))
          hits.push(`${d.code}: required input ${f.key} (${f.type})`);
    }
    expect(hits).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ procedures
describe("REQ-S06-003 / REQ-S06-002: the ten seeded procedures", () => {
  it("the ten procedures exist as published definitions after initialization", async () => {
    const page = ok(
      await send("GET", "/api/v1/procedure-definitions?limit=100", {
        session: await signIn(api.app, w.office.subject),
      }),
      200,
      "defs",
    );
    const names = (page.items as Body[]).map((d) => String(d.nameEn).toLowerCase());
    console.log(
      `A02 procedures: ${JSON.stringify((page.items as Body[]).map((d) => ({ c: d.code, n: d.nameEn, scope: d.scope, launch: d.launchRoleCodes, inputs: (d.inputSchema as Body[]).map((f) => [f.key, f.type, f.required]), steps: (d.steps as Body[]).map((x) => [x.stepKey, x.stepKind ?? x.kind, x.responsibleRoleCode, x.approvalRoleCode, x.output, x.requiredInputKeys, x.evidenceRequired, x.condition]) })))}`,
    );
    const missing = TEN_PROCEDURES.filter((n) => !names.some((x) => x.includes(n.toLowerCase().split("/")[0]!)));
    expect(missing).toEqual([]);
  });

  it("a baseline-validation instance shows its current step and assignee; completing it creates a validated baseline linked to it", async () => {
    expect(L).not.toBeNull();
    const l = L!;
    const page = ok(
      await send("GET", "/api/v1/procedure-definitions?limit=100", { session: l.tl.session }),
      200,
      "defs",
    );
    const def = (page.items as Body[]).find((d) => /baseline validation/i.test(d.nameEn));
    expect(def, "baseline validation definition").toBeDefined();
    const launched = await send("POST", "/api/v1/procedure-instances", {
      session: l.tl.session,
      body: {
        procedureCode: def.code,
        transformationId: l.t,
        inputValues: {
          metric: "Synthetic QA roaming attach rate",
          value: "12.50",
          unit: "%",
          baselineDate: "2026-08-31",
          source: "Synthetic QA billing extract",
        },
      },
    });
    const inst = ok(launched, 201, "launch baseline validation");
    expect(inst.status).toBe("active");
    expect(inst.currentStepKeys).toEqual(["record_baseline"]);
    const current = (inst.steps as Body[]).find((s) => s.stepKey === "record_baseline");
    // procedures v2 (migration 0095, REQ-PB-027): the baseline is recorded by the Transformation Lead, who holds
    // baseline.edit (D-166; QA-E O-2 repaired).
    expect([current.status, current.assigneeRoleCode]).toEqual(["active", "TL"]);
    expect(inst.nextAction.stepKey).toBe("record_baseline");
    const I = `/api/v1/procedure-instances/${inst.id}`;
    // Completing without the required evidence is refused (negative).
    const early = await send("POST", `${I}/steps/record_baseline/complete`, {
      session: l.tl.session,
      headers: ifm(inst.version),
      body: { note: "Synthetic" },
    });
    expect([early.status, early.body.code]).toEqual([422, "procedure_step.evidence_required"]);
    const ev = ok(
      await send("POST", `${l.base}/evidence`, {
        session: l.tl.session,
        body: { kind: "note", title: "Synthetic QA baseline extract", noteBody: "Synthetic", ownerUserId: l.tl.id },
      }),
      201,
      "createEvidence",
    );
    const linked = await send("POST", `${I}/steps/record_baseline/evidence`, {
      session: l.tl.session,
      headers: ifm(inst.version),
      body: { evidenceId: ev.id },
    });
    expect([200, 201], JSON.stringify(linked.body)).toContain(linked.status);
    const v1 = ok(await send("GET", I, { session: l.tl.session }), 200, "instance").version;
    // "create" output: the step's record is produced by the native DG2 workflow by its assignee (the Lead), then named
    // on completion; without it the completion is refused (ADR-0042 §10).
    const noRecord = await send("POST", `${I}/steps/record_baseline/complete`, {
      session: l.tl.session,
      headers: ifm(v1),
      body: { note: "Synthetic" },
    });
    expect([noRecord.status, noRecord.body.code]).toEqual([422, "procedure_step.output_required"]);
    const created = ok(
      await send("POST", `${l.base}/baselines`, {
        session: l.tl.session,
        body: {
          metric: "Synthetic QA roaming attach rate",
          unit: "%",
          scope: "customer",
          value: "12.50",
          source: "Synthetic QA billing extract",
          baselineDate: "2026-08-31",
        },
      }),
      201,
      "createBaseline (TL)",
    );
    // The Business Owner is not the step's assignee and holds no TL here: refused (contract: 403
    // procedure_step.not_assignee), and nothing advances.
    const byBo = await send("POST", `${I}/steps/record_baseline/complete`, {
      session: l.bo.session,
      headers: ifm(v1),
      body: { note: "Synthetic: not mine", outputRecordId: created.id },
    });
    expect([byBo.status, byBo.body.code], JSON.stringify(byBo.body)).toEqual([403, "procedure_step.not_assignee"]);
    expect(ok(await send("GET", I, { session: l.tl.session }), 200, "instance").currentStepKeys).toEqual([
      "record_baseline",
    ]);
    const s1 = ok(
      await send("POST", `${I}/steps/record_baseline/complete`, {
        session: l.tl.session,
        headers: ifm(v1),
        body: { note: "Synthetic: recorded", outputRecordId: created.id },
      }),
      200,
      "complete record_baseline",
    );
    expect(s1.currentStepKeys).toEqual(["validate_baseline"]);
    expect((s1.steps as Body[]).find((s) => s.stepKey === "validate_baseline").assigneeRoleCode).toBe("FIN");
    const output = (s1.links as Body[]).find((k) => k.linkKind === "output" && k.recordType === "baseline");
    expect(output?.recordId, "baseline output link").toBe(created.id);
    // Advancing before Finance validated the baseline is refused; FIN validates it natively, then completes.
    const notYet = await send("POST", `${I}/steps/validate_baseline/complete`, {
      session: l.fin.session,
      headers: ifm(s1.version),
      body: { note: "Synthetic" },
    });
    expect([notYet.status, notYet.body.code]).toEqual([422, "procedure_step.output_required"]);
    ok(
      await send("POST", `${l.base}/baselines/${created.id}/validation`, {
        session: l.fin.session,
        headers: ifm(created.version),
        body: { result: "validated", note: "Synthetic: matches the extract." },
      }),
      200,
      "validateBaseline",
    );
    const s2 = ok(
      await send("POST", `${I}/steps/validate_baseline/complete`, {
        session: l.fin.session,
        headers: ifm(s1.version),
        body: { note: "Synthetic: matches the extract" },
      }),
      200,
      "complete validate_baseline",
    );
    expect([s2.status, s2.currentStepKeys, s2.nextAction.kind]).toEqual(["completed", [], "none"]);
    const row = await api.db
      .selectFrom("baseline")
      .selectAll()
      .where("id", "=", output.recordId)
      .executeTakeFirstOrThrow();
    expect([row.transformation_id, row.validation_status, row.metric, String(row.value)]).toEqual([
      l.t,
      "validated",
      "Synthetic QA roaming attach rate",
      expect.stringMatching(/^12\.50*$/),
    ]);
  });

  it("each of the ten procedures can be launched in the A02 scenario's transformation (organization scope for intake)", async () => {
    expect(L).not.toBeNull();
    const l = L!;
    const page = ok(
      await send("GET", "/api/v1/procedure-definitions?limit=100", { session: l.tl.session }),
      200,
      "defs",
    );
    const inputs: Record<string, Record<string, unknown>> = {
      new_transformation_intake: { transformationName: "Synthetic QA intake", caseForChange: "Synthetic QA case" },
      baseline_validation: {
        metric: "Synthetic",
        value: "1",
        unit: "SAR",
        baselineDate: "2026-08-31",
        source: "Synthetic",
      },
      kpi_submission: { period: "2026-09" },
      gate_review: { gateCode: "G5", financeReviewRequired: "no" },
      scope_target_change: { reason: "Synthetic QA change" },
      benefit_validation: { belowTarget: "no" },
      executive_escalation: { whyNow: "Synthetic QA escalation" },
    };
    const launched: string[] = [];
    const refused: string[] = [];
    for (const d of page.items as Body[]) {
      const org = d.scope?.level === "organization";
      // The Transformation Office (organization scope) holds a launch role of every one of the ten.
      const r = await send("POST", "/api/v1/procedure-instances", {
        session: l.to.session,
        body: { procedureCode: d.code, transformationId: org ? null : l.t, inputValues: inputs[d.code] ?? {} },
      });
      if (r.status === 201 && r.body.status === "active") launched.push(d.code);
      else refused.push(`${d.code}: ${r.status} ${r.body.code ?? ""} ${String(r.body.detail ?? "").slice(0, 160)}`);
    }
    expect(refused).toEqual([]);
    expect(launched.length).toBeGreaterThanOrEqual(10);
  });
});

// ------------------------------------------------------------------------------------------------ REQ-S18-002
describe("REQ-S18-002: seed coverage of the demo dataset", () => {
  it("the dataset run's coverage finds at least one record per listed condition; spot checks on persisted rows agree", async () => {
    const admin = await signIn(api.app, w.admin.subject);
    const st = ok(await send("GET", "/api/v1/admin/environment", { session: admin }), 200, "getDemoEnvironmentStatus");
    expect(st.kind).toBe("demo");
    const run = st.latestRun;
    expect(run, "a dataset run").not.toBeNull();
    const coverage = (run.coverage ?? {}) as Record<string, number>;
    console.log(`A02 seed coverage: ${JSON.stringify(run.coverage)} complete=${String(run.coverageComplete)}`);
    // The row's list, literally: T01-T16, G1-G6, the six phases, ten TOM dimensions, six dashboard areas, and one each
    // of stale KPI, overdue decision, shared benefit, adoption gap, BAU handover, missing evidence, pending approval.
    const required = [
      ...Array.from({ length: 16 }, (_, i) => `template.t${String(i + 1).padStart(2, "0")}`),
      ...[1, 2, 3, 4, 5, 6].map((n) => `gate.g${n}`),
      ...[1, 2, 3, 4, 5, 6].map((n) => `phase.${n}`),
      ...Array.from({ length: 10 }, (_, i) => `tom.dimension_${String(i + 1).padStart(2, "0")}`),
      ...[1, 2, 3, 4, 5, 6].map((n) => `dashboard.area_${n}`),
      "kpi.stale",
      "decision.overdue",
      "benefit.shared",
      "adoption.gap",
      "bau.handover",
      "evidence.missing",
      "approval.pending",
    ];
    expect(
      required.filter((k) => !(Number(coverage[k]) >= 1)),
      "conditions with no record",
    ).toEqual([]);
    expect(run.coverageComplete).toBe(true);
    // Independent spot checks on the persisted roaming rows (linked to the one transformation, not sample cards).
    const T = DEMO_ANCHORS.transformationId;
    const gates = await api.db
      .selectFrom("gate_instance")
      .select("gate_code")
      .where("transformation_id", "=", T)
      .execute();
    expect(new Set(gates.map((g) => g.gate_code))).toEqual(new Set(["G1", "G2", "G3", "G4", "G5", "G6"]));
    const cells = await api.db
      .selectFrom("tom_canvas_cell")
      .select("dimension_code")
      .where("transformation_id", "=", T)
      .execute();
    expect(new Set(cells.map((c) => c.dimension_code)).size).toBe(10);
    const handovers = await api.db.selectFrom("bau_handover").select("id").where("transformation_id", "=", T).execute();
    expect(handovers.length).toBeGreaterThanOrEqual(1);
  });
});

// ------------------------------------------------------------------------------------------------ REQ-S06-003 (complete)
describe("REQ-S06-003: each of the ten procedures can be launched and completed in the A02 scenario", () => {
  it("drives every instance through its steps with the native workflows; every one ends completed", async () => {
    expect(L, "the lifecycle test must run first").not.toBeNull();
    const l = L!;
    const td = await grantedActor(api, l.admin, w.orgA.id, l.t, "TD");
    const byRole: Record<string, Actor> = {
      TL: l.tl,
      BO: l.bo,
      FIN: l.fin,
      KDS: l.kds,
      TO: l.to,
      SP: l.sp,
      WL: l.wl,
      TD: td,
    };
    // The organization-scope intake is acted on by a Lead of the organization (the BU-scoped Lead cannot see it).
    const tlOrgUser = await createUser(api.db, w.orgA.id);
    ok(
      await send("POST", "/api/v1/role-assignments", {
        session: l.admin,
        body: {
          userId: tlOrgUser.id,
          roleCode: "TL",
          scope: { type: "organization", id: w.orgA.id },
          reason: "Synthetic QA organization Lead for the intake procedure (approves nothing real)",
        },
      }),
      201,
      "org TL",
    );
    const tlOrg: Actor = {
      id: tlOrgUser.id,
      subject: tlOrgUser.subject,
      session: await signIn(api.app, tlOrgUser.subject),
    };
    // Rule A (D-166): once capture_intake names the transformation T it produced, the intake's later steps adopt T, and
    // their approvals are requested on T and routed by T's role mappings. So T is staffed natively: the access
    // administrator assigns a Sponsor on T and T's Lead (its creator) maps that Sponsor; the Sponsor then decides.
    const intake: { t: string | null; sp: Actor | null } = { t: null, sp: null };
    const actorOf = (code: string, role: string, stepKey: string): Actor => {
      if (code !== "new_transformation_intake") return byRole[role] ?? l.tl;
      if (stepKey === "capture_intake") return role === "TL" ? tlOrg : (byRole[role] ?? l.tl);
      // Adopted steps (on T): T's Lead is its creator l.tl (DG1 creator carry-over); T's Sponsor is intake.sp.
      if (role === "SP" && intake.sp) return intake.sp;
      return role === "TL" ? l.tl : (byRole[role] ?? l.tl);
    };
    const { g, k, bw, sw } = l.ctx;
    const boKpi = await createKpi(api, k, { ownerUserId: l.bo.id } as Body);
    const bv = await postVersion(api, k, boKpi.id, DIRECT_FLOW);
    ok(
      await send("POST", `${l.base}/kpi-versions/${bv.body.id}/activate`, {
        session: l.kds.session,
        headers: ifm(bv.body.version),
      }),
      200,
      "activate",
    );
    const kpiPeriod = await monthlyPeriod(api, w);
    const ranked: Record<string, string> = {};
    const page = ok(
      await send("GET", "/api/v1/procedure-definitions?limit=100", { session: l.tl.session }),
      200,
      "defs",
    );
    const defs = page.items as Body[];
    const note = async (session: Session, by: string): Promise<string> =>
      ok(
        await send("POST", `${l.base}/evidence`, {
          session,
          body: { kind: "note", title: "Synthetic QA procedure evidence", noteBody: "Synthetic", ownerUserId: by },
        }),
        201,
        "createEvidence",
      ).id;
    const inputs: Record<string, Record<string, unknown>> = {
      new_transformation_intake: { transformationName: "Synthetic QA intake", caseForChange: "Synthetic QA case" },
      kpi_submission: { period: "current" },
      gate_review: { gateCode: "G5", financeReviewRequired: "no" },
      scope_target_change: { reason: "Synthetic QA change" },
      benefit_validation: { belowTarget: "no" },
      executive_escalation: { whyNow: "Synthetic QA escalation" },
    };
    // Per step: produce the step's record natively and return its id (create/link outputs), or null.
    const produce: Record<string, (inst: Body) => Promise<string | null>> = {
      "new_transformation_intake/draft_charter": async (inst) => {
        const out = (inst.links as Body[]).find((k) => k.recordType === "transformation");
        const c = ok(
          await send("POST", `/api/v1/transformations/${out.recordId}/charter`, {
            session: l.tl.session,
            body: { transformationName: "Synthetic QA intake transformation", caseForChange: "Synthetic QA case" },
          }),
          201,
          "createCharter",
        );
        return (c.charter ?? c).id;
      },
      "new_transformation_intake/capture_intake": async () => {
        const t = ok(
          await send("POST", "/api/v1/transformations", {
            session: l.tl.session,
            body: { businessUnitId: w.a1, name: "Synthetic QA intake transformation", mode: "end_to_end" },
          }),
          201,
          "intake transformation",
        ).id as string;
        // Staff T natively before its Sponsor approval is requested (Rule A routes it by T's role mappings).
        const sp = await grantedActor(api, l.admin, w.orgA.id, t, "SP");
        ok(
          await send("POST", `/api/v1/transformations/${t}/role-mappings`, {
            session: l.tl.session,
            body: { partyCode: "SP", targetKind: "user", userId: sp.id },
          }),
          201,
          "intake transformation: map the Sponsor",
        );
        intake.t = t;
        intake.sp = sp;
        return t;
      },
      "baseline_validation/record_baseline": async () => {
        const b = ok(
          await send("POST", `${l.base}/baselines`, {
            session: l.tl.session,
            body: {
              metric: "Synthetic QA churn",
              unit: "%",
              scope: "customer",
              value: "2.10",
              source: "Synthetic",
              baselineDate: "2026-08-31",
            },
          }),
          201,
          "createBaseline",
        );
        ranked.baseline = b.id;
        ranked.baselineVersion = String(b.version);
        return b.id;
      },
      "baseline_validation/validate_baseline": async () => {
        ok(
          await send("POST", `${l.base}/baselines/${ranked.baseline}/validation`, {
            session: l.fin.session,
            headers: ifm(Number(ranked.baselineVersion)),
            body: { result: "validated", note: "Synthetic" },
          }),
          200,
          "validateBaseline",
        );
        return null;
      },
      "kpi_submission/submit_actual": async () => {
        const r = await submitActual(api, k, boKpi.id, { reportingPeriodId: kpiPeriod.id, value: "7" }, l.bo.session);
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        return r.body.actual.id;
      },
      "gate_review/prepare_submission": async () => {
        for (const key of await missingKeys(api, g, "G5"))
          await coverWithException(api, g, "G5", key, plusDays("2026-10-17", 120));
        const sub = await submitGate(api, g, "G5");
        expect(sub.status, JSON.stringify(sub.body)).toBe(201);
        ranked.g5 = String(sub.body.submissionNo);
        return sub.body.id;
      },
      "benefit_validation/attach_evidence": async () => note(l.bo.session, l.bo.id),
      "benefit_validation/finance_validation": async () => {
        const ben = await measuredBenefit(api, bw);
        const v = await submittedValue(api, bw, ben.id, "1000.00");
        await approve(api, bw, v, "900.00");
        return v.validationId;
      },
      "bau_handover/prepare_handover": async () => {
        const d = await draftHandover(api, sw);
        ranked.handover = d.H;
        ranked.handoverVersion = String(d.version);
        return d.id;
      },
      "tom_approval/complete_canvas": async () =>
        ok(await send("GET", `${l.base}/tom-canvas/technology`, { session: l.tl.session }), 200, "cell").cell.id,
      "initiative_prioritization/record_ranking": async () => {
        const r = ok(
          await send("POST", `${l.base}/prioritization/rankings`, { session: l.to.session, body: {} }),
          201,
          "createRanking",
        );
        return r.snapshot.id;
      },
      "scope_target_change/raise_change": async () => {
        const cell = ok(
          await send("GET", `${l.base}/tom-canvas/technology`, { session: l.tl.session }),
          200,
          "cell",
        ).cell;
        const cr = ok(
          await send("POST", `${l.base}/change-requests`, {
            session: l.tl.session,
            body: {
              changeKind: "tom",
              subjectType: "tom_canvas_cell",
              subjectId: cell.id,
              subjectVersion: cell.version,
              proposedChange: { targetDesign: { from: cell.targetDesign, to: "Synthetic QA: one digital hand-off" } },
              reason: "Synthetic QA: the design authority simplified the target",
            },
          }),
          201,
          "createChangeRequest",
        );
        ok(
          await send("POST", `${l.base}/change-requests/${cr.id}/submit`, {
            session: l.tl.session,
            headers: ifm(cr.version),
          }),
          200,
          "submitChangeRequest",
        );
        ranked.cr = cr.id;
        return cr.id;
      },
      "executive_escalation/raise_escalation": async () =>
        ok(
          await send("POST", `${l.base}/executive-decisions`, {
            session: l.tl.session,
            body: {
              title: "Synthetic QA escalation",
              whyNow: "Synthetic QA escalation",
              options: [{ title: "Option A" }, { title: "Option B" }],
              recommendation: "A",
              impactOfDelay: "Synthetic",
              ownerUserId: l.bo.id,
              requiredDate: "2041-06-30",
            },
          }),
          201,
          "createExecutiveDecision",
        ).id,
    };
    // Before a business approval decides an "advance" step, the record reaches its state through its own native workflow.
    const beforeApproval: Record<string, (inst: Body) => Promise<void>> = {
      "executive_escalation/executive_decision": async (inst) => {
        const out = (inst.links as Body[]).find((x) => x.recordType === "decision");
        const cur = ok(
          await send("GET", `${l.base}/executive-decisions/${out.recordId}`, { session: l.bo.session }),
          200,
          "decision",
        );
        ok(
          await send("POST", `${l.base}/executive-decisions/${out.recordId}/outcome`, {
            session: l.bo.session,
            headers: ifm(cur.version),
            body: { outcome: "decided", chosenOptionLabel: "A", outcomeText: "Synthetic QA" },
          }),
          200,
          "recordOutcome",
        );
      },
      "gate_review/gate_decision": async () => {
        const dec = await decideGate(api, g, "G5", l.sp.session, {
          submissionNo: Number(ranked.g5),
          outcome: "approved",
          rationale: "Synthetic QA approval of G5 (approves nothing real).",
          scaleScope: {
            items: [{ initiativeId: l.rec.initiative, businessUnitId: w.a1, note: "Synthetic QA pilot BU" }],
          },
        });
        expect(dec.status, JSON.stringify(dec.body)).toBe(201);
      },
      "scope_target_change/decide_change": async () => {
        const sub = { id: ranked.cr };
        // The change request's business approval is routed per T11; its assignee (whoever it is) decides it.
        let decided = "";
        for (const [role, who] of Object.entries(byRole)) {
          const list = ok(
            await send("GET", `/api/v1/approvals?role=assignee&transformationId=${l.t}&limit=100`, {
              session: who.session,
            }),
            200,
            "approvals",
          );
          const a = (list.items as Body[]).find((x) => x.subjectId === sub.id && x.status === "pending");
          if (!a) continue;
          const dec = await send("POST", `/api/v1/approvals/${a.id}/decisions`, {
            session: who.session,
            headers: ifm(a.version),
            body: {
              outcome: "approve",
              rationale: "Synthetic QA approval (approves nothing real)",
              subjectVersion: a.subjectVersion,
            },
          });
          expect([dec.status, dec.body.status], "decide change request approval").toEqual([200, "approved"]);
          decided = role;
          break;
        }
        expect(decided, "an assignee of the change request's approval").not.toBe("");
      },
      "bau_handover/accept_handover": async () => {
        const sub = ok(
          await send("POST", `${ranked.handover}/submit`, {
            session: l.wl.session,
            headers: ifm(Number(ranked.handoverVersion)),
          }),
          200,
          "submitHandover",
        );
        ok(
          await send("POST", `${ranked.handover}/accept`, {
            session: l.bo.session,
            headers: ifm(sub.version),
            body: {},
          }),
          200,
          "acceptHandover",
        );
      },
    };
    const results: Record<string, string> = {};
    for (const d of defs) {
      const org = d.scope?.level === "organization";
      const launched = await send("POST", "/api/v1/procedure-instances", {
        session: l.to.session,
        body: {
          procedureCode: d.code,
          transformationId: org ? null : l.t,
          inputValues:
            d.code === "baseline_validation"
              ? { metric: "Synthetic", value: "1", unit: "SAR", baselineDate: "2026-08-31", source: "Synthetic" }
              : (inputs[d.code] ?? {}),
        },
      });
      if (launched.status !== 201) {
        results[d.code] = `launch ${launched.status} ${launched.body.code}`;
        continue;
      }
      const I = `/api/v1/procedure-instances/${launched.body.id}`;
      let outcome = "";
      for (let guard = 0; guard < 12 && !outcome; guard++) {
        const inst = ok(await send("GET", I, { session: l.to.session }), 200, "instance");
        if (inst.status === "completed") {
          outcome = "completed";
          break;
        }
        const key = inst.currentStepKeys[0] as string | undefined;
        if (!key) {
          outcome = `stuck: no current step (status ${inst.status})`;
          break;
        }
        const step = (inst.steps as Body[]).find((s) => s.stepKey === key);
        const def = (d.steps as Body[]).find((s) => s.stepKey === key);
        const actor = actorOf(d.code, step.assigneeRoleCode, key);
        if (step.stepKind === "approval") {
          if (!step.approvalId) {
            outcome = `${key}: approval step without an approval (step ${JSON.stringify(step)}; nextAction ${JSON.stringify(inst.nextAction)}; transformationId ${inst.transformationId}; subject ${inst.subjectRecordType}/${inst.subjectRecordId})`;
            break;
          }
          const a = ok(
            await send("GET", `/api/v1/approvals/${step.approvalId}`, { session: l.to.session }),
            200,
            "approval",
          );
          const approver =
            d.code === "new_transformation_intake" && def.approvalRoleCode === "SP" && intake.sp
              ? intake.sp
              : (byRole[def.approvalRoleCode] ?? l.sp);
          if (d.code === "new_transformation_intake") {
            // Rule A: the adopted approval is on T (the transformation capture_intake produced), not on the launch scope.
            const ap = ok(
              await send("GET", `/api/v1/approvals/${step.approvalId}`, { session: approver.session }),
              200,
              "intake approval (Sponsor)",
            );
            expect(ap.transformationId, "the intake's approval is requested on the adopted transformation").toBe(
              intake.t,
            );
            expect(inst.transformationId, "the instance keeps its organization launch scope").toBeNull();
          }
          const hook = beforeApproval[`${d.code}/${key}`];
          if (hook) await hook(inst);
          const dec = await send("POST", `/api/v1/approvals/${step.approvalId}/decisions`, {
            session: approver.session,
            headers: ifm(a.version),
            body: {
              outcome: "approve",
              rationale: "Synthetic QA approval (approves nothing real)",
              subjectVersion: a.subjectVersion,
            },
          });
          if (dec.status !== 200 && dec.status !== 201)
            outcome = `${key}: decision ${dec.status} ${dec.body.code} ${String(dec.body.detail ?? "")}`;
          continue;
        }
        if (def.evidenceRequired) {
          const ev = await note(actor.session, actor.id);
          const linked = await send("POST", `${I}/steps/${key}/evidence`, {
            session: actor.session,
            headers: ifm(inst.version),
            body: { evidenceId: ev },
          });
          if (linked.status !== 201 && linked.status !== 200) {
            outcome = `${key}: evidence ${linked.status} ${linked.body.code}`;
            break;
          }
        }
        let outputRecordId: string | null = null;
        const producer = produce[`${d.code}/${key}`];
        try {
          if (producer) outputRecordId = await producer(inst);
        } catch (e) {
          outcome = `${key}: producing the output failed: ${String(e).slice(0, 300)}`;
          break;
        }
        const v = ok(await send("GET", I, { session: l.to.session }), 200, "instance").version;
        const done = await send("POST", `${I}/steps/${key}/complete`, {
          session: actor.session,
          headers: ifm(v),
          body: { note: "Synthetic QA step", ...(outputRecordId ? { outputRecordId } : {}) },
        });
        if (done.status !== 200)
          outcome = `${key} (${step.assigneeRoleCode}): ${done.status} ${done.body.code} ${String(done.body.detail ?? "")}`;
      }
      results[d.code] = outcome || "not completed within 12 actions";
    }
    console.log(`A02 procedures driven: ${JSON.stringify(results, null, 1)}`);
    expect(Object.keys(results)).toHaveLength(10);
    expect(Object.entries(results).filter(([, r]) => r !== "completed")).toEqual([]);
  }, 180_000);
});
