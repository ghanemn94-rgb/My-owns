// Product gate G4 "Is the portfolio executable and value-backed?" (ADR-0021 §7; REQ-PB-019, REQ-PB-046, REQ-PB-055,
// REQ-PB-059, REQ-S04-006, REQ-DLV-035; T-DG3-BE-E) against a real PostgreSQL:
//  - a G4 submission with gaps is refused (422 gate_criteria_incomplete) and names 'Owners', 'Finance validation', the
//    initiative without a gap link (by code and name), the missing funding decision and the missing capacity
//    commitment; nothing is written;
//  - the decision contracts are reused: 403 gate.not_approver, 403 gate.submitter_cannot_decide, 409
//    gate.submission_superseded;
//  - G4 end to end with DISTINCT synthetic users: TL builds and submits; FIN validates the case baselines and the formula
//    version and records the funding; the capacity owner (BO) commits the demand; SP approves -> phase `transform`;
//  - the snapshot freezes the in-scope initiatives, ranking, weight set, cases, formula versions, funding and demand;
//  - an Unknown schedule (schedule.unknown) on an unmitigated dependency is 'Schedule unknown: DEP-nn' (D-079).
// G1-G3 statuses and the `mobilize` phase are staged with audited test fixtures. All data is SYNTHETIC; every decision
// here is a demo business decision that approves nothing real, and nothing touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { record } from "../../../src/modules/audit/index.ts";
import {
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
import { gateVersion, ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { financeUser } from "../contract/p3-exercises-kbe-b.ts";
import {
  addMeasurableContribution,
  createInitiative,
  makeDirection,
  stageRanked,
} from "../contract/p3-exercises-be-b.ts";
import { setGateStatus } from "../portfolio/fixtures.ts";

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
const ok = (res: { status: number; body: Body }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body;
};
const G = (p: P2World, code = "G4") => `/api/v1/transformations/${p.transformationId}/gates/${code}`;
const RATIONALE = "Synthetic demo decision; approves nothing real.";

interface Actors {
  readonly p: P2World;
  readonly fin: { id: string; session: Session };
  readonly capacityOwner: { id: string; session: Session };
}

/** A P2 world at `mobilize` (G1-G3 staged approved) with a FIN user and a capacity owner (BO). Synthetic. */
async function mobilizeWorld(): Promise<Actors> {
  const p = await setupP2World(api, w);
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
  const fin = await financeUser(api, w, p);
  const bo = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, bo.id, "BO", { type: "transformation", id: p.transformationId }, w.orgA.id);
  return { p, fin, capacityOwner: { id: bo.id, session: await signIn(api.app, bo.subject) } };
}

const version = async (table: "initiative", id: string) =>
  (await api.db.selectFrom(table).select("version").where("id", "=", id).executeTakeFirstOrThrow()).version;

/** A selected initiative; `complete` adds owners, wave, dates, gap link and an approved milestone. */
async function selectedInitiative(a: Actors, name: string, complete: boolean) {
  const { p } = a;
  const T = `/api/v1/transformations/${p.transformationId}`;
  const wave = await api.db
    .selectFrom("roadmap_wave")
    .select("id")
    .where("transformation_id", "=", p.transformationId)
    .where("ordinal", "=", 1)
    .executeTakeFirstOrThrow();
  const d = await makeDirection(send, p);
  const ini = await createInitiative(send, p, {
    name,
    objective: "Synthetic: grow roaming revenue per user.",
    scopeIn: "Synthetic: consumer roaming bundles.",
    ...(complete
      ? {
          executiveOwnerUserId: p.sponsor.id,
          workstreamLeadUserId: p.contributor.id,
          waveId: wave.id,
          plannedStart: "2027-01-01",
          plannedEnd: "2027-06-30",
        }
      : {}),
  });
  const I = `/api/v1/initiatives/${ini.id}`;
  await addMeasurableContribution(send, p, ini.id, d);
  if (complete) {
    const gap = ok(
      await send("POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology" } }),
      201,
      "gap",
    );
    ok(
      await send("POST", `${I}/gap-links`, {
        session: p.lead.session,
        body: { targetType: "tom_gap", targetId: gap.id },
      }),
      201,
      "gap link",
    );
    const ms = ok(
      await send("POST", `${I}/milestones`, {
        session: p.lead.session,
        body: { title: "Synthetic pilot live", forecastDate: "2027-03-31" },
      }),
      201,
      "milestone",
    );
    ok(
      await send("POST", `/api/v1/milestones/${ms.id}/approve-date`, {
        session: p.lead.session,
        headers: ifm(ms.version),
        body: { approvedDate: "2027-03-31", reason: "Synthetic baseline date." },
      }),
      200,
      "approve date",
    );
  }
  ok(
    await send("POST", `${I}/submit`, {
      session: p.lead.session,
      headers: ifm(await version("initiative", ini.id)),
      body: {},
    }),
    200,
    "submit",
  );
  await stageRanked(api, ini.id, p.lead.id);
  ok(
    await send("POST", `${I}/select`, {
      session: p.sponsor.session,
      headers: ifm(await version("initiative", ini.id)),
      body: { rationale: RATIONALE },
    }),
    200,
    "select",
  );
  return { id: ini.id as string, code: ini["code"] as string, name };
}

const ALL_SECTIONS = (a: Actors) => ({
  strategicRationale: "Synthetic rationale.",
  baselineSummary: "Synthetic baseline: roaming revenue 1.2m SAR per year.",
  valuePoolsSummary: "Synthetic value pools.",
  interventionsSummary: "Synthetic interventions.",
  investmentSummary: "Synthetic investment.",
  benefitsSummary: "Synthetic benefits.",
  benefitRamp: "Synthetic ramp: 25% / 75% / 100%.",
  recurrenceSummary: "Synthetic: recurring.",
  implementationHorizon: "Synthetic: 12 months.",
  keyAssumptions: "Synthetic assumptions.",
  downsideCase: "Synthetic downside.",
  upsideCase: "Synthetic upside.",
  benefitOwnerUserId: a.p.sponsor.id,
  initiativeOwnerUserId: a.p.sponsor.id,
  financeValidatorUserId: a.fin.id,
  decisionAskTypes: ["funding"],
});

/** The value side: cases (TL), a T09 formula (TL) and FIN's validations of both baselines and the formula version. */
async function valueBacked(a: Actors, initiativeId: string, validateFormula = true) {
  const { p, fin } = a;
  const lead = p.lead.session;
  const top = ok(
    await send("POST", "/api/v1/business-cases", {
      session: lead,
      body: {
        transformationId: p.transformationId,
        level: "transformation",
        title: "Synthetic transformation case",
        sections: ALL_SECTIONS(a),
      },
    }),
    201,
    "transformation case",
  );
  const kase = ok(
    await send("POST", "/api/v1/business-cases", {
      session: lead,
      body: {
        transformationId: p.transformationId,
        level: "initiative",
        initiativeId,
        title: "Synthetic initiative case",
        sections: ALL_SECTIONS(a),
      },
    }),
    201,
    "initiative case",
  );
  const formula = ok(
    await send("POST", "/api/v1/benefit-formulas", {
      session: lead,
      body: {
        transformationId: p.transformationId,
        benefitName: "Synthetic revenue uplift",
        fromExample: "revenue_uplift",
      },
    }),
    201,
    "formula",
  );
  const C = `/api/v1/business-cases/${kase.id}`;
  ok(
    await send("POST", `${C}/lines`, {
      session: lead,
      body: {
        lineKind: "investment",
        class: "capex",
        valueBasis: "cash",
        title: "Synthetic platform",
        amount: "40000",
        currency: "SAR",
      },
    }),
    201,
    "investment line",
  );
  ok(
    await send("POST", `${C}/lines`, {
      session: lead,
      body: {
        lineKind: "benefit",
        class: "revenue",
        valueBasis: "revenue_uplift",
        title: "Synthetic attach uplift",
        amount: "100000",
        currency: "SAR",
        benefitFormulaId: formula.id,
      },
    }),
    201,
    "benefit line",
  );
  // FIN (never the author) validates both baselines and the formula's current version.
  for (const c of [top, kase])
    ok(
      await send("POST", `/api/v1/business-cases/${c.id}/baseline-validation`, {
        session: fin.session,
        headers: ifm(c.version),
        body: { result: "validated", note: "Synthetic demo validation; approves nothing real." },
      }),
      200,
      "baseline validation",
    );
  if (validateFormula) await validateFormulaVersion(a, formula.id);
  return { topId: top.id as string, caseId: kase.id as string, formulaId: formula.id as string };
}

/** FIN validates the formula's current version 1 (never the author; a synthetic demo validation). */
async function validateFormulaVersion(a: Actors, formulaId: string) {
  ok(
    await send("POST", `/api/v1/benefit-formulas/${formulaId}/versions/1/validation`, {
      session: a.fin.session,
      headers: ifm(1),
      body: { result: "validated", note: "Synthetic demo validation; approves nothing real." },
    }),
    200,
    "formula validation",
  );
}

/** FIN records the approved funding decision (business approval, synthetic). */
async function fund(a: Actors, initiativeId: string) {
  return ok(
    await send("POST", "/api/v1/funding-decisions", {
      session: a.fin.session,
      body: { initiativeId, outcome: "approved", amount: "1500000.00", currency: "SAR", rationale: RATIONALE },
    }),
    201,
    "funding",
  );
}

/** TL plans a role, capacity (owned by the capacity owner) and demand; the capacity owner commits it. */
async function resourced(a: Actors, initiativeId: string, demandFte = "1.00") {
  const { p } = a;
  const T = `/api/v1/transformations/${p.transformationId}`;
  const role = ok(
    await send("POST", `${T}/resource-roles`, {
      session: p.lead.session,
      body: { code: `analyst_${uuidv7().slice(-6)}`, labelEn: "Synthetic analyst", labelAr: "محلل" },
    }),
    201,
    "role",
  );
  ok(
    await send("POST", "/api/v1/capacity", {
      session: p.lead.session,
      body: {
        transformationId: p.transformationId,
        resourceRoleId: role.id,
        periodMonth: "2027-02-01",
        availableFte: "2.00",
        ownerUserId: a.capacityOwner.id,
      },
    }),
    201,
    "capacity",
  );
  const demand = ok(
    await send("POST", "/api/v1/resource-demands", {
      session: p.lead.session,
      body: { initiativeId, resourceRoleId: role.id, periodMonth: "2027-02-01", demandFte },
    }),
    201,
    "demand",
  );
  const committed = ok(
    await send("POST", `/api/v1/resource-demands/${demand.id}/commit`, {
      session: a.capacityOwner.session,
      headers: ifm(1),
      body: { note: "Synthetic capacity commitment." },
    }),
    200,
    "commit",
  );
  return { roleId: role.id as string, demandId: committed.id as string };
}

async function submitG4(p: P2World, session = p.lead.session) {
  return send("POST", `${G(p)}/submissions`, {
    session,
    headers: ifm(await gateVersion(api, p, "G4")),
    body: { submissionNote: "Synthetic G4 submission" },
  });
}
const decideG4 = (p: P2World, session: Session, submissionNo: number, outcome = "approved") =>
  send("POST", `${G(p)}/decision`, { session, body: { submissionNo, outcome, rationale: RATIONALE } });

// ------------------------------------------------------------------------------------------------ tests

describe("G4 submission refused with the missing items named (ADR-0021 §7)", () => {
  it("422 gate_criteria_incomplete names 'Owners', 'Finance validation', the initiative without a gap link, the missing funding and capacity commitment; nothing written", async () => {
    const a = await mobilizeWorld();
    const ini = await selectedInitiative(a, "Synthetic roaming relaunch", false);
    const before = await gateVersion(api, a.p, "G4");
    const res = await submitG4(a.p);
    expect([res.status, res.body.type, res.body.code]).toEqual([
      422,
      "urn:mth:problem:validation",
      "gate_criteria_incomplete",
    ]);
    const byKey = new Map<string, { code: string; message: string }>(
      res.body.errors.map((e: Body) => [e.pointer.replace("/criteria/", ""), e]),
    );
    const text = JSON.stringify(res.body.errors);
    // The exact labels, literally in the response.
    expect(byKey.get("g4.owners")!.message).toBe(`Owners: ${ini.code} ${ini.name}`);
    expect(byKey.get("g4.owners")!.code).toBe("g4.owner_missing");
    expect(byKey.get("g4.finance_validation")!.message).toContain("Finance validation");
    expect(byKey.get("g4.initiative_cards")!.message).toBe(`Gap link missing: ${ini.code} ${ini.name}`);
    expect(byKey.get("g4.funding")!.message).toBe(`Funding decision missing: ${ini.code} ${ini.name}`);
    expect(byKey.get("g4.capacity")!.message).toBe(`Capacity commitment missing: ${ini.code} ${ini.name}`);
    expect(byKey.get("g4.business_cases")!.code).toBe("g4.business_case_missing");
    expect(byKey.get("g4.roadmap")!.message).toBe(`Roadmap: ${ini.code} ${ini.name}`);
    expect(text).toContain("Owners");
    expect(text).toContain("Finance validation");
    expect(text).toContain(ini.name);
    // The prioritization criterion is satisfied by the staged ranking.
    expect(byKey.has("g4.prioritization")).toBe(false);
    // Nothing written: no submission, no audit event, gate unchanged.
    expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
    expect(await gateVersion(api, a.p, "G4")).toBe(before);
    const view = ok(await send("GET", G(a.p), { session: a.p.lead.session }), 200, "view");
    expect(view.gate.status).toBe("draft");
    expect(view.submissionEnabled).toBe(true);
    expect(view.criteria.map((c: Body) => [c.key, c.completeness])).toEqual([
      ["g4.initiative_cards", "incomplete"],
      ["g4.business_cases", "incomplete"],
      ["g4.finance_validation", "incomplete"],
      ["g4.prioritization", "complete"],
      ["g4.roadmap", "incomplete"],
      ["g4.owners", "incomplete"],
      ["g4.funding", "incomplete"],
      ["g4.capacity", "incomplete"],
    ]);
  });

  it("an empty portfolio is 'Initiative cards' (g4.portfolio_empty); a capacity over-allocation and Unknown are conflicts", async () => {
    const a = await mobilizeWorld();
    const empty = await submitG4(a.p);
    expect(empty.status).toBe(422);
    const cards = empty.body.errors.find((e: Body) => e.pointer === "/criteria/g4.initiative_cards");
    expect([cards.code, cards.message]).toEqual(["g4.portfolio_empty", "Initiative cards"]);

    const ini = await selectedInitiative(a, "Synthetic over-allocated", true);
    await resourced(a, ini.id, "3.00"); // 3.00 committed > 2.00 available
    const over = await submitG4(a.p);
    const cap = over.body.errors.find((e: Body) => e.pointer === "/criteria/g4.capacity");
    expect([cap.code, cap.message]).toEqual(["g4.capacity_conflict", "Capacity conflict: Synthetic analyst 2027-02"]);

    // Committed demand on a role and month WITHOUT a capacity row is Unknown - a conflict, never "no conflict".
    const T = `/api/v1/transformations/${a.p.transformationId}`;
    const role = ok(
      await send("POST", `${T}/resource-roles`, {
        session: a.p.lead.session,
        body: { code: "unknown_role", labelEn: "Synthetic unplanned role", labelAr: "دور" },
      }),
      201,
      "role",
    );
    const d = ok(
      await send("POST", "/api/v1/resource-demands", {
        session: a.p.lead.session,
        body: { initiativeId: ini.id, resourceRoleId: role.id, periodMonth: "2027-04-01", demandFte: "0.50" },
      }),
      201,
      "demand",
    );
    ok(
      await send("POST", `/api/v1/resource-demands/${d.id}/commit`, {
        session: a.capacityOwner.session,
        headers: ifm(1),
        body: {},
      }),
      200,
      "commit",
    );
    const unknown = await submitG4(a.p);
    const cap2 = unknown.body.errors.find((e: Body) => e.pointer === "/criteria/g4.capacity");
    expect(cap2.message).toBe(
      "Capacity conflict: Synthetic analyst 2027-02 Capacity conflict: Synthetic unplanned role 2027-04",
    );
  });
});

describe("G4 treats an Unknown schedule as a missing item (D-079; ADR-0021 §7, §11 item 3)", () => {
  it("'Schedule unknown: DEP-nn' refuses the submission; a mitigation or the missing date clears it", async () => {
    const a = await mobilizeWorld();
    // One in-scope (selected, complete) successor; the internal predecessor is a draft with complete dates.
    const succ = await selectedInitiative(a, "Synthetic roaming analytics", true);
    const pred = await createInitiative(send, a.p, {
      name: "Synthetic data platform",
      plannedStart: "2026-07-01",
      plannedEnd: "2026-12-31",
    });
    const dependency = async (body: Record<string, unknown>) =>
      ok(
        await send("POST", "/api/v1/dependencies", {
          session: a.p.lead.session,
          body: { transformationId: a.p.transformationId, dependencyType: "tech", ...body },
        }),
        201,
        "dependency",
      );
    // External predecessor: the product holds no finish date, so the schedule is Unknown.
    const ext = await dependency({
      description: "Synthetic vendor platform delivery",
      from: { kind: "external", label: "Synthetic vendor" },
      toInitiativeId: succ.id,
      neededBy: "2027-01-01",
    });
    // Initiative predecessor without a needed-by date: Unknown too.
    const internal = await dependency({
      description: "Synthetic: analytics needs the data platform",
      from: { kind: "initiative", initiativeId: pred.id },
      toInitiativeId: succ.id,
    });
    const roadmapItems = async () => {
      const view = ok(await send("GET", G(a.p), { session: a.p.lead.session }), 200, "view");
      return view.criteria.find((c: Body) => c.key === "g4.roadmap").missing as Body[];
    };
    const unknownItems = async () => (await roadmapItems()).filter((m) => m.code === "g4.schedule_unknown");

    const refused = await submitG4(a.p);
    expect([refused.status, refused.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    const roadmap = refused.body.errors.find((e: Body) => e.pointer === "/criteria/g4.roadmap");
    expect(roadmap.code).toBe("g4.schedule_unknown");
    expect(roadmap.message).toContain(`Schedule unknown: ${ext.code}`);
    expect(roadmap.message).toContain(`Schedule unknown: ${internal.code}`);
    expect(String(ext.code)).toMatch(/^DEP-\d+$/);
    expect(await auditOfRequest(api.db, String(refused.headers["x-request-id"]))).toEqual([]);
    expect(await unknownItems()).toEqual(
      [ext, internal]
        .sort((x, y) => String(x.code).localeCompare(String(y.code)))
        .map((d) => ({
          code: "g4.schedule_unknown",
          message: `Schedule unknown: ${d.code}`,
          pointer: `/dependencies/${d.id}`,
        })),
    );

    // A mitigation on the external dependency clears its item (the T08 flag stays visible there).
    ok(
      await send("PATCH", `/api/v1/dependencies/${ext.id}`, {
        session: a.p.lead.session,
        headers: ifm(ext.version),
        body: { mitigation: "Synthetic: weekly vendor checkpoint; fallback to the current platform." },
      }),
      200,
      "mitigation",
    );
    expect((await unknownItems()).map((m) => m.message)).toEqual([`Schedule unknown: ${internal.code}`]);

    // Resolving the unknown date (needed-by after the predecessor's 2026-12-31 finish) clears the other, no conflict.
    ok(
      await send("PATCH", `/api/v1/dependencies/${internal.id}`, {
        session: a.p.lead.session,
        headers: ifm(internal.version),
        body: { neededBy: "2027-12-31" },
      }),
      200,
      "needed-by",
    );
    const after = await roadmapItems();
    expect(after.filter((m) => m.code.startsWith("g4.schedule_"))).toEqual([]);
    const again = await submitG4(a.p);
    const roadmapAgain = again.body.errors?.find((e: Body) => e.pointer === "/criteria/g4.roadmap");
    expect(roadmapAgain?.message ?? "").not.toContain("Schedule unknown");
  });
});

describe("G4 end to end with distinct synthetic TL, FIN, SP and capacity-owner users", () => {
  it("TL submits; FIN validates and funds; the capacity owner commits; 403/403/409 hold; SP approves -> phase transform", async () => {
    const a = await mobilizeWorld();
    const { p, fin, capacityOwner } = a;
    expect(new Set([p.lead.id, fin.id, p.sponsor.id, capacityOwner.id]).size).toBe(4);
    const ini = await selectedInitiative(a, "Synthetic roaming bundle relaunch", true);
    const value = await valueBacked(a, ini.id, false);
    const funding = await fund(a, ini.id);
    expect([funding.approverRoleCode, funding.decidedBy]).toEqual(["FIN", fin.id]);
    const demand = await resourced(a, ini.id);

    // REQ-PB-055: the case's benefit formula is not Finance-validated yet -> 422 listing 'Finance validation', the
    // missing item pointing at the formula version; every other criterion is complete.
    const unvalidated = await submitG4(p);
    expect([unvalidated.status, unvalidated.body.code]).toEqual([422, "gate_criteria_incomplete"]);
    expect(unvalidated.body.errors).toEqual([
      {
        pointer: "/criteria/g4.finance_validation",
        code: "g4.finance_validation_missing",
        message: "Finance validation",
      },
    ]);
    const pending = ok(await send("GET", G(p), { session: p.lead.session }), 200, "view");
    expect(pending.criteria.find((c: Body) => c.key === "g4.finance_validation").missing).toEqual([
      {
        code: "g4.finance_validation_missing",
        message: "Finance validation",
        pointer: `/benefit-formulas/${value.formulaId}/versions/1`,
      },
    ]);
    await validateFormulaVersion(a, value.formulaId);

    const view = ok(await send("GET", G(p), { session: p.lead.session }), 200, "view");
    expect(
      view.criteria.filter((c: Body) => c.completeness !== "complete").map((c: Body) => [c.key, c.missing]),
    ).toEqual([]);

    // TL submits.
    const sub1 = ok(await submitG4(p), 201, "submit 1");
    // A second submission supersedes the first -> a decision on submission 1 is 409.
    const sub2 = ok(await submitG4(p), 201, "submit 2");
    expect(sub2.submissionNo).toBe(sub1.submissionNo + 1);
    const stale = await decideG4(p, p.sponsor.session, sub1.submissionNo);
    expect([stale.status, stale.body.type, stale.body.code]).toEqual([
      409,
      "urn:mth:problem:version-conflict",
      "gate.submission_superseded",
    ]);
    // A non-approver (FIN, the capacity owner, the auditor) -> 403 gate.not_approver.
    for (const s of [fin.session, capacityOwner.session, p.auditor.session]) {
      const res = await decideG4(p, s, sub2.submissionNo);
      expect([res.status, res.body.code]).toEqual([403, "gate.not_approver"]);
    }

    // The snapshot freezes the portfolio (ADR-0021 §7).
    const frozen = ok(
      await send("GET", `${G(p)}/submissions/${sub2.submissionNo}`, { session: p.lead.session }),
      200,
      "submission",
    );
    const g4 = frozen.submission.snapshot.g4;
    expect(g4.initiatives).toEqual([
      {
        id: ini.id,
        code: ini.code,
        version: await version("initiative", ini.id),
        status: "funded",
        waveId: expect.any(String),
      },
    ]);
    expect(g4.rankingSnapshotId).toEqual(expect.any(String));
    expect(g4.weightSet).toEqual({ id: expect.any(String), versionNo: 1 });
    expect(g4.businessCases.map((c: Body) => [c.id, c.baselineValidation])).toEqual([
      [value.topId, "validated"],
      [value.caseId, "validated"],
    ]);
    expect(g4.formulaVersions).toEqual([
      expect.objectContaining({ formulaId: value.formulaId, versionNo: 1, validation: "validated" }),
    ]);
    expect(g4.fundingDecisionIds).toEqual([funding.id]);
    expect(g4.committedDemandIds).toEqual([demand.demandId]);

    // SP approves -> phase mobilize -> transform.
    const approved = ok(await decideG4(p, p.sponsor.session, sub2.submissionNo), 201, "approve");
    expect(approved.outcome).toBe("approved");
    const t = ok(
      await send("GET", `/api/v1/transformations/${p.transformationId}`, { session: p.lead.session }),
      200,
      "t",
    );
    expect(t.currentPhase).toBe("transform");
    const after = ok(await send("GET", G(p), { session: p.lead.session }), 200, "view");
    expect(after.gate.status).toBe("approved");
  });

  it("the submitter cannot decide G4, even holding the approver role (403 gate.submitter_cannot_decide)", async () => {
    const a = await mobilizeWorld();
    const ini = await selectedInitiative(a, "Synthetic self-approval attempt", true);
    await valueBacked(a, ini.id);
    await fund(a, ini.id);
    await resourced(a, ini.id);
    // The sponsor also holds TL here, so they can submit - and then must not decide their own submission.
    await grant(
      api.db,
      w.grantor.id,
      a.p.sponsor.id,
      "TL",
      { type: "transformation", id: a.p.transformationId },
      w.orgA.id,
    );
    const sub = ok(await submitG4(a.p, a.p.sponsor.session), 201, "submit");
    const res = await decideG4(a.p, a.p.sponsor.session, sub.submissionNo);
    expect([res.status, res.body.code]).toEqual([403, "gate.submitter_cannot_decide"]);
    expect(ok(await send("GET", G(a.p), { session: a.p.lead.session }), 200, "view").gate.status).toBe("submitted");
  });
});
