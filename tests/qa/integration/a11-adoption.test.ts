// A11 "Adoption and sustainment", part 1: poor adoption triggers intervention (qa-verifier, T-DG4-QA-C).
// Scenario (master prompt §20 A11): "Poor adoption triggers intervention; delivery completion alone does not close value
// realization; accepted handover creates recurring BAU tasks." Every assertion below is derived from the acceptance text
// of the requirement row named in its title (docs/delivery/requirements.csv) and from docs/api/openapi.yaml:
//  - REQ-PB-069, REQ-PB-071, REQ-S20-011: an adoption actual below its approved trajectory, accepted through the real
//    actual pipeline and evaluated by the worker's real recalculation, creates EXACTLY ONE intervention with an owner
//    (the worker's adoption consumer, as the relay delivers the real outbox row; a redelivery and a second evaluation
//    create none); the seven indicators are available by name (the playbook's B0109-B0115 names); an initiative with
//    delivery Complete and adoption below trajectory shows adoption at risk;
//  - REQ-PB-072: 100 % training completion with no proficiency observation shows proficiency Unknown (never 0), not
//    adopted;
//  - REQ-S11-002: a proficiency observation submitted through a published form links to the stakeholder group and counts
//    in the proficiency indicator;
//  - REQ-PB-073: a champion's constraint links to a T04 decision and is visible on that decision;
//  - REQ-S11-001: a stakeholder group records influence and impact separately; an intervention with owner and due date
//    appears in the owner's My Work;
//  - REQ-S16-020: each entity of the people and adoption group is created and read through the API, with authorization
//    (an auditor cannot write, an outsider cannot read).
// All data is SYNTHETIC. The trajectory approval is a synthetic in-product approval of test data; nothing here grants a
// real business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signIn, startApi, unknownId, type Session, type TestApi } from "../support/api.ts";
import {
  approvedTrajectory,
  asBenefitWorld,
  canon,
  DIRECT_FLOW,
  get200,
  ifMatch,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  runRecalculation,
  seedBenefitWorld,
  seedKpiWorld,
  seedWorld,
  submitActual,
  type BenefitWorld,
  type Body,
  type KpiWorld,
  type World,
} from "../support/p4.ts";
import { envelopesOf, extraUser, handleIndicatorEvaluated, launchedInitiative } from "../support/a11.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

async function stakeholderGroup(base: string, session: Session, ownerUserId: string, name: string, extra = {}) {
  const g = await send("POST", `${base}/stakeholder-groups`, {
    session,
    body: {
      name,
      impact: "H",
      currentStance: "neutral",
      requiredBehavior: "Synthetic QA: use the new journey for every order",
      interventionTypes: ["training"],
      ownerUserId,
      ...extra,
    },
  });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
  return g.body as Body;
}

// ================================================================================================ templates

describe("A11 REQ-PB-071: the seven leading adoption indicators are available by name", () => {
  // The seven indicator names of the playbook, B0109-B0115 (docs/source/playbook.md), verbatim.
  const PLAYBOOK_SEVEN = [
    "Usage / activation rate",
    "Compliance with new process",
    "Cycle-time shift",
    "Training completion + observed proficiency",
    "Decision turnaround time",
    "Percentage of transactions handled through the new journey",
    "Exception / workaround rate",
  ];
  it("REQ-PB-071: GET /adoption-indicator-templates lists exactly the seven playbook indicators by name, in order", async () => {
    const b = await seedBenefitWorld(api, w);
    const r = await send("GET", "/api/v1/adoption-indicator-templates", { session: b.s.tl });
    expect(r.status).toBe(200);
    const names = [...new Set((r.body.items as Body[]).map((t) => t.sourceIndicatorEn as string))];
    expect(names).toEqual(PLAYBOOK_SEVEN);
    // Every template carries an Arabic text (bilingual), and is attachable (a template key).
    for (const t of r.body.items as Body[]) {
      expect(typeof t.key).toBe("string");
      expect(String(t.indicatorAr)).not.toBe("");
    }
    // Unauthenticated: 401.
    expect((await send("GET", "/api/v1/adoption-indicator-templates")).status).toBe(401);
  });
});

// ================================================================================================ below trajectory

describe("A11 REQ-PB-069, REQ-PB-071, REQ-S20-011: an adoption actual below trajectory creates exactly one intervention", () => {
  let k: KpiWorld;
  let kw: World;
  let initiativeId: string;
  let groupId: string;
  let kpi: { id: string; name: string };
  let green: { id: string; name: string };
  let p1: { id: string; start: string; end: string };
  let link: Body;

  /** The worker's real evaluation of (kpi, scope, period), read through the stored row (never computed here). */
  const evaluationOf = (kpiId: string, scopeId: string) =>
    api.db
      .selectFrom("kpi_evaluation")
      .select(["id", "calculated_rag", "deviation", "value"])
      .where("kpi_definition_id", "=", kpiId)
      .where("scope_id", "=", scopeId)
      .where("reporting_period_id", "=", p1.id)
      .where("value_basis", "=", "period")
      .executeTakeFirstOrThrow();

  beforeAll(async () => {
    kw = await seedWorld(api.db);
    k = await seedKpiWorld(api, kw);
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    p1 = await monthlyPeriod(api, kw);
    // A launched initiative of the KPI world's transformation, then delivery Complete through the API (TL).
    initiativeId = await launchedInitiative(api.db, asBenefitWorld(k, kw, ""));
    const done = await send("POST", `/api/v1/initiatives/${initiativeId}/complete-delivery`, {
      session: k.s.tl,
      headers: ifMatch(1),
      body: { note: "Synthetic QA: all deliverables in production" },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.delivery).toBe("completed");
    const pct = { unitKind: "percentage", unitLabel: null, polarity: "higher_is_better" };
    // KPIs reported per initiative (the version's entry scope), so the actual describes the initiative itself.
    const perInitiative = { ...DIRECT_FLOW, entryScopeKind: "initiative" };
    kpi = await ownedKpi(api, k, perInitiative, pct as never);
    green = await ownedKpi(api, k, perInitiative, pct as never);
    const scope = { scopeKind: "initiative", scopeId: initiativeId };
    await approvedTrajectory(api, k, kpi.id, [{ pointDate: p1.end, expectedValue: "0.8" }], scope);
    await approvedTrajectory(api, k, green.id, [{ pointDate: p1.end, expectedValue: "0.8" }], scope);
    groupId = (await stakeholderGroup(k.base, k.s.tl, k.users.bo.id, "Synthetic QA store agents")).id;
    const l = await send("POST", `${k.base}/adoption-metric-links`, {
      session: k.s.tl,
      body: {
        templateKey: "usage_activation_rate",
        targetKind: "initiative",
        targetId: initiativeId,
        kpiDefinitionId: kpi.id,
      },
    });
    expect(l.status, JSON.stringify(l.body)).toBe(201);
    link = l.body;
    const g = await send("POST", `${k.base}/adoption-metric-links`, {
      session: k.s.tl,
      body: {
        templateKey: "new_journey_share",
        targetKind: "stakeholder_group",
        targetId: groupId,
        kpiDefinitionId: green.id,
      },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    // Adoption actuals for the initiative: 0.4 against 0.8 (below trajectory) and 0.9 against 0.8 (on trajectory).
    for (const [id, value] of [
      [kpi.id, "0.4"],
      [green.id, "0.9"],
    ] as const) {
      const res = await submitActual(api, k, id, { ...scope, reportingPeriodId: p1.id, value });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      const [run] = await runRecalculation(api, res.body.actual.id);
      expect(run).toMatchObject({ outcome: "done" });
    }
  }, 240_000);

  const interventions = async (origin?: string) => {
    const r = await send("GET", `${k.base}/adoption-interventions?limit=100${origin ? `&origin=${origin}` : ""}`, {
      session: k.s.auditor,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body.items as Body[];
  };

  it("REQ-PB-069: the below-trajectory actual is evaluated red/adverse; the worker creates exactly one owned intervention", async () => {
    const e = await evaluationOf(kpi.id, initiativeId);
    expect(e.calculated_rag).toBe("red");
    expect(e.deviation).toBe("adverse");
    expect(await interventions()).toEqual([]);
    const [envelope] = await envelopesOf(api, e.id, "kpi.deviation_evaluated");
    await handleIndicatorEvaluated(api.db, envelope!, "qa-a11-deviation-1");
    const list = await interventions("below_trajectory");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ origin: "below_trajectory", metricLinkId: link.id });
    // "with owner": a named owner; a due date, or an explicit Unknown reason (never a silent blank).
    expect(typeof list[0].ownerUserId).toBe("string");
    expect(list[0].dueDate !== null || list[0].dueUnknownReason !== null).toBe(true);
  });

  it("REQ-PB-069 'exactly one': a redelivered event and a second evaluation of the same period create no second intervention", async () => {
    const e = await evaluationOf(kpi.id, initiativeId);
    const [envelope] = await envelopesOf(api, e.id, "kpi.deviation_evaluated");
    await handleIndicatorEvaluated(api.db, envelope!, "qa-a11-deviation-redelivery");
    await handleIndicatorEvaluated(
      api.db,
      { ...envelope!, idempotencyKey: `${envelope!.idempotencyKey}:qa-second-run` },
      "qa-a11-deviation-second-run",
    );
    expect(await interventions("below_trajectory")).toHaveLength(1);
  });

  it("REQ-PB-071: an on-trajectory actual creates no intervention", async () => {
    const e = await evaluationOf(green.id, initiativeId);
    expect(e.calculated_rag).toBe("green");
    const [envelope] = await envelopesOf(api, e.id, "kpi.deviation_evaluated");
    await handleIndicatorEvaluated(api.db, envelope!, "qa-a11-green");
    const all = await interventions();
    expect(all).toHaveLength(1);
    expect(all[0].metricLinkId).toBe(link.id);
  });

  it("REQ-PB-069: the initiative with delivery Complete and adoption below trajectory shows adoption at risk", async () => {
    const m = await get200(api, k.s.auditor, `/api/v1/initiatives/${initiativeId}/status-model`);
    expect(m.delivery).toBe("completed");
    expect(m.adoption).toBe("at_risk");
    // Delivery completion did not close value realization.
    expect(m.closure).toBe("open");
    expect(m.label).not.toMatch(/success/i);
  });

  it("REQ-PB-069: the intervention's owner sees it in My Work", async () => {
    const [iv] = await interventions("below_trajectory");
    const owner = [k.users.bo, k.users.tl, k.users.kds].find((u) => u.id === iv.ownerUserId);
    expect(owner, `owner ${iv.ownerUserId} is one of the world's people`).toBeTruthy();
    const mine = await get200(api, await signIn(api.app, owner!.subject), "/api/v1/me/work-items?limit=100");
    expect((mine.items as Body[]).filter((x) => x.subjectId === iv.id)).toHaveLength(1);
  });
});

// ================================================================================================ training, proficiency

describe("A11 REQ-PB-072, REQ-S11-002: training completion and observed proficiency are separate", () => {
  let b: BenefitWorld;
  let wl: Awaited<ReturnType<typeof extraUser>>;
  let g1: string;
  let period: { id: string; start: string; end: string };
  let formId: string;
  const PROFICIENCY_FORM = {
    questions: [
      {
        key: "unaided",
        type: "yes_no",
        label_en: "Completed the new journey unaided?",
        label_ar: "هل أكمل المسار الجديد دون مساعدة؟",
        required: true,
        proficiency: true,
      },
    ],
  };
  const measures = async () => {
    const r = await send(
      "GET",
      `${b.base}/adoption-indicators?targetKind=stakeholder_group&targetId=${g1}&reportingPeriodId=${period.id}`,
      { session: b.s.auditor },
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return Object.fromEntries((r.body.measures as Body[]).map((m) => [m.templateKey, m])) as Record<string, Body>;
  };

  beforeAll(async () => {
    b = await seedBenefitWorld(api, w);
    wl = await extraUser(api, w, b, "WL");
    period = await monthlyPeriod(api, w);
    g1 = (await stakeholderGroup(b.base, b.s.tl, b.users.bo.id, "Synthetic QA branch tellers")).id;
    // Two people trained, both completed inside the period, through the training-record API (BO).
    for (const label of ["Synthetic QA teller A", "Synthetic QA teller B"]) {
      const t = await send("POST", `${b.base}/training-records`, {
        session: b.s.bo,
        body: { stakeholderGroupId: g1, participantLabel: label, trainingTitle: "Synthetic QA new-journey course" },
      });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      const c = await send("PATCH", `${b.base}/training-records/${t.body.id}`, {
        session: b.s.bo,
        headers: ifMatch(t.body.version),
        body: { status: "completed", completedOn: `${period.start.slice(0, 8)}12` },
      });
      expect(c.status, JSON.stringify(c.body)).toBe(200);
    }
    // A proficiency form created and published through the API (WL).
    const f = await send("POST", `${b.base}/assessment-forms`, {
      session: wl.session,
      body: {
        kind: "proficiency_assessment",
        name: "Synthetic QA proficiency check",
        stakeholderGroupId: g1,
        schema: PROFICIENCY_FORM,
      },
    });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    const cur = await get200(api, wl.session, `${b.base}/assessment-forms/${f.body.id}`);
    const p = await send("POST", `${b.base}/assessment-forms/${f.body.id}/publish`, {
      session: wl.session,
      headers: ifMatch(cur.version),
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    formId = f.body.id;
  }, 120_000);

  it("REQ-PB-072: 100% training completion with no proficiency observation: proficiency Unknown (not 0), not adopted", async () => {
    const m = await measures();
    expect(canon(m["training_completion"].value)).toBe("1");
    expect([m["training_completion"].numerator, m["training_completion"].denominator]).toEqual([2, 2]);
    const prof = m["observed_proficiency"];
    expect(prof.valueStatus).toBe("unknown");
    expect(prof.value).toBeNull();
    // Not adopted: no green RAG and no value derived from training.
    expect(prof.calculatedRag === null || prof.calculatedRag === "unknown").toBe(true);
    expect(prof.numerator ?? 0).toBe(0);
  });

  it("REQ-S11-002: an observation submitted through the published form links to the group and counts in the proficiency indicator", async () => {
    const r = await send("POST", `${b.base}/assessment-records`, {
      session: wl.session,
      body: {
        formId,
        stakeholderGroupId: g1,
        observedOn: `${period.start.slice(0, 8)}15`,
        subjectLabel: "Synthetic QA teller A",
        answers: { unaided: true },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.stakeholderGroupId).toBe(g1);
    expect(r.body.kind).toBe("proficiency_observation");
    expect(r.body.proficiencyResult).toBe("proficient");
    const byGroup = await get200(
      api,
      b.s.auditor,
      `${b.base}/assessment-records?stakeholderGroupId=${g1}&kind=proficiency_observation`,
    );
    expect((byGroup.items as Body[]).map((x) => x.id)).toEqual([r.body.id]);
    const m = await measures();
    expect(m["observed_proficiency"].valueStatus).toBe("ok");
    expect([m["observed_proficiency"].numerator, m["observed_proficiency"].denominator]).toEqual([1, 1]);
    expect(canon(m["observed_proficiency"].value)).toBe("1");
    // Training completion is a separate measure and did not move.
    expect([m["training_completion"].numerator, m["training_completion"].denominator]).toEqual([2, 2]);
  });
});

// ================================================================================================ champions, groups, My Work

describe("A11 REQ-PB-073, REQ-S11-001, REQ-S16-020: champions, stakeholder groups, interventions in My Work", () => {
  let b: BenefitWorld;
  let wl: Awaited<ReturnType<typeof extraUser>>;
  let group: Body;
  let intervention: Body;

  beforeAll(async () => {
    b = await seedBenefitWorld(api, w);
    wl = await extraUser(api, w, b, "WL");
    group = await stakeholderGroup(b.base, b.s.tl, b.users.bo.id, "Synthetic QA contact-centre agents", {
      influence: "L",
      impact: "H",
    });
  }, 90_000);

  it("REQ-S11-001: a group records influence and impact separately (L and H kept apart, readable back)", async () => {
    expect([group.influence, group.impact]).toEqual(["L", "H"]);
    const read = await get200(api, b.s.auditor, `${b.base}/stakeholder-groups/${group.id}`);
    expect([read.influence, read.impact]).toEqual(["L", "H"]);
    const patched = await send("PATCH", `${b.base}/stakeholder-groups/${group.id}`, {
      session: b.s.tl,
      headers: ifMatch(read.version),
      body: { influence: "H" },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect([patched.body.influence, patched.body.impact]).toEqual(["H", "H"]);
  });

  it("REQ-S11-001: an intervention with owner and due date appears in the owner's My Work with that due date", async () => {
    const r = await send("POST", `${b.base}/adoption-interventions`, {
      session: b.s.tl,
      body: {
        stakeholderGroupId: group.id,
        interventionType: "training",
        title: "Synthetic QA: console floor-walk sessions",
        ownerUserId: wl.id,
        dueDate: "2041-03-19",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    intervention = r.body;
    expect([r.body.ownerUserId, r.body.dueDate]).toEqual([wl.id, "2041-03-19"]);
    const mine = await get200(api, wl.session, "/api/v1/me/work-items?limit=100");
    const item = (mine.items as Body[]).find((x) => x.subjectId === r.body.id);
    expect(item).toMatchObject({ dueDate: "2041-03-19", status: "open" });
    // Nobody else gets it.
    const other = await get200(api, b.s.bo, "/api/v1/me/work-items?limit=100");
    expect((other.items as Body[]).some((x) => x.subjectId === r.body.id)).toBe(false);
  });

  it("REQ-PB-073: a champion's constraint links to a T04 decision and is visible on that decision", async () => {
    const champ = await send("POST", `${b.base}/stakeholder-groups/${group.id}/champions`, {
      session: b.s.tl,
      body: { userId: wl.id },
    });
    expect(champ.status, JSON.stringify(champ.body)).toBe(201);
    const decision = await send("POST", "/api/v1/decisions", {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        title: "Synthetic QA design decision: agent console layout",
        ownerUserId: b.users.tl.id,
        tomDimensionCode: "journeys_processes",
        options: [{ title: "Synthetic option A" }, { title: "Synthetic option B" }],
      },
    });
    expect(decision.status, JSON.stringify(decision.body)).toBe(201);
    const other = await send("POST", "/api/v1/decisions", {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        title: "Synthetic QA design decision: unrelated",
        ownerUserId: b.users.tl.id,
        tomDimensionCode: "journeys_processes",
        options: [{ title: "Synthetic option A" }, { title: "Synthetic option B" }],
      },
    });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const c = await send("POST", `${b.base}/champion-constraints`, {
      session: wl.session,
      body: {
        championId: champ.body.id,
        decisionId: decision.body.id,
        constraintText: "Synthetic QA: agents need the console to work offline",
      },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect([c.body.decisionId, c.body.stakeholderGroupId]).toEqual([decision.body.id, group.id]);
    const onDecision = await get200(api, b.s.auditor, `${b.base}/champion-constraints?decisionId=${decision.body.id}`);
    expect((onDecision.items as Body[]).map((x) => [x.id, x.decisionCode, x.constraintText])).toEqual([
      [c.body.id, decision.body.code, "Synthetic QA: agents need the console to work offline"],
    ]);
    const onOther = await get200(api, b.s.auditor, `${b.base}/champion-constraints?decisionId=${other.body.id}`);
    expect(onOther.items).toEqual([]);
    // Someone who is not a champion cannot raise one in the champion's name.
    const notChampion = await send("POST", `${b.base}/champion-constraints`, {
      session: b.s.bo,
      body: { championId: champ.body.id, decisionId: decision.body.id, constraintText: "Synthetic QA: not mine" },
    });
    expect(notChampion.status).toBe(403);
  });

  it("REQ-S16-020: every entity of the people and adoption group is created and read through the API with authorization", async () => {
    // TrainingRecord, AssessmentRecord (through a published form), AdoptionMetricLink; StakeholderGroup and
    // AdoptionIntervention were created above.
    const t = await send("POST", `${b.base}/training-records`, {
      session: b.s.bo,
      body: {
        stakeholderGroupId: group.id,
        participantLabel: "Synthetic QA agent",
        trainingTitle: "Synthetic QA course",
      },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const f = await send("POST", `${b.base}/assessment-forms`, {
      session: b.s.bo,
      body: {
        kind: "feedback",
        name: "Synthetic QA launch feedback",
        stakeholderGroupId: group.id,
        schema: {
          questions: [
            { key: "clear", type: "yes_no", label_en: "Was it clear?", label_ar: "هل كان واضحاً؟", required: true },
          ],
        },
      },
    });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    const fv = await get200(api, b.s.bo, `${b.base}/assessment-forms/${f.body.id}`);
    expect(
      (
        await send("POST", `${b.base}/assessment-forms/${f.body.id}/publish`, {
          session: b.s.bo,
          headers: ifMatch(fv.version),
        })
      ).status,
    ).toBe(200);
    const inv = await send("POST", `${b.base}/assessment-forms/${f.body.id}/invitations`, {
      session: b.s.bo,
      body: { userIds: [wl.id], stakeholderGroupId: group.id },
    });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const a = await send("POST", `${b.base}/assessment-records`, {
      session: wl.session,
      body: {
        formId: f.body.id,
        invitationId: inv.body.items[0].id,
        stakeholderGroupId: group.id,
        observedOn: "2041-02-02",
        answers: { clear: true },
      },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const l = await send("POST", `${b.base}/adoption-metric-links`, {
      session: b.s.tl,
      body: {
        templateKey: "process_compliance_rate",
        targetKind: "stakeholder_group",
        targetId: group.id,
        createKpi: true,
        kpiOwnerUserId: b.users.bo.id,
      },
    });
    expect(l.status, JSON.stringify(l.body)).toBe(201);
    const reads: [string, string][] = [
      ["stakeholder-groups", group.id],
      ["adoption-interventions", intervention.id],
      ["assessment-records", a.body.id],
      ["adoption-metric-links", l.body.id],
    ];
    for (const [path, id] of reads) {
      const r = await send("GET", `${b.base}/${path}/${id}`, { session: b.s.auditor });
      expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(r.body.id).toBe(id);
      expect(typeof r.body.version).toBe("number");
      // Another organization's user cannot read it (not disclosed).
      expect((await send("GET", `${b.base}/${path}/${id}`, { session: b.s.outsider })).status).toBe(404);
    }
    const trainings = await get200(api, b.s.auditor, `${b.base}/training-records?stakeholderGroupId=${group.id}`);
    expect((trainings.items as Body[]).map((x) => x.id)).toContain(t.body.id);
    // The auditor reads but cannot write any of them.
    const audWrites: [string, Record<string, unknown>][] = [
      [
        "stakeholder-groups",
        {
          name: "Synthetic QA auditor group",
          impact: "L",
          currentStance: "support",
          requiredBehavior: "Synthetic",
          interventionTypes: ["comms"],
          ownerUserId: b.users.bo.id,
        },
      ],
      [
        "adoption-interventions",
        { stakeholderGroupId: group.id, interventionType: "comms", title: "Synthetic QA", ownerUserId: wl.id },
      ],
      ["training-records", { stakeholderGroupId: group.id, participantLabel: "Synthetic", trainingTitle: "Synthetic" }],
    ];
    for (const [path, body] of audWrites)
      expect((await send("POST", `${b.base}/${path}`, { session: b.s.auditor, body })).status, path).toBe(403);
    // An unknown id is 404.
    expect((await send("GET", `${b.base}/stakeholder-groups/${unknownId()}`, { session: b.s.auditor })).status).toBe(
      404,
    );
  });
});
