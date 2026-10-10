// P4 contract exercises of BE-M (traceability, orphans, modular flags; p4-plan §5.1, p4-work-split §1 S-10). Stub created by T-DG4-BE-A and
// already called by contract.test.ts: BE-M exercises each operation it routes here, through `ctx.mirrored`, in the
// same change that removes the operation from its p4-pending list, and lists each success body's zod mirror below.
// T-DG4-BE-M (ADR-0038 §1-§6): the 10 slice K operations (trace links, allocation sets and contribution shares, the
// traceability view, the orphan report, downstream impact), and `seedTraceWorld`, the chain fixture the BE-M
// integration tests reuse. All data is SYNTHETIC; nothing here is a business approval, and nothing touches DG0-DG7.
// BE-M2 and BE-M3 append their exercises below (p4-work-split §J+K JK.0).
import { insertAuditEvent, type Db } from "@mth/db";
import {
  allocationSet,
  contributionAllocation,
  inheritedRecord,
  inheritedRecordPage,
  missingLinks,
  orphanReportPage,
  recordImpact,
  traceabilityGraph,
  traceLink,
  traceLinkPage,
  portfolio,
  portfolioPage,
  portfolioTransformation,
  portfolioTransformationPage,
  workstream,
  workstreamInitiative,
  workstreamInitiativePage,
  workstreamPage,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import {
  call,
  createUser,
  grant,
  signIn,
  type P4ExerciseContext,
  type Session,
  type TestApi,
  type World,
  uniq,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  insertDeliverable,
  insertInitiative,
  seedBenefitWorld,
  type BenefitWorld,
  type Caller,
} from "../benefits/fixtures.ts";
import { createOutcomeRow } from "../kpi/fixtures.ts";

export const P4_MIRRORS_BE_M: Readonly<Record<string, z.ZodType>> = {
  getTraceability: traceabilityGraph,
  getOrphanReport: orphanReportPage,
  getRecordImpact: recordImpact,
  listTraceLinks: traceLinkPage,
  createTraceLink: traceLink,
  getTraceLink: traceLink,
  updateTraceLink: traceLink,
  removeTraceLink: traceLink,
  getAllocationSet: allocationSet,
  setOutcomeContributionAllocation: contributionAllocation,
  // T-DG4-BE-M2 (ADR-0038 §7): Modular entry.
  getMissingLinks: missingLinks,
  listInheritedRecords: inheritedRecordPage,
  createInheritedRecord: inheritedRecord,
  withdrawInheritedRecord: inheritedRecord,
  // T-DG4-BE-M3 (ADR-0038 §9): portfolios and workstreams.
  listPortfolios: portfolioPage,
  createPortfolio: portfolio,
  getPortfolio: portfolio,
  updatePortfolio: portfolio,
  listPortfolioTransformations: portfolioTransformationPage,
  addPortfolioTransformation: portfolioTransformation,
  removePortfolioTransformation: portfolioTransformation,
  listWorkstreams: workstreamPage,
  createWorkstream: workstream,
  getWorkstream: workstream,
  updateWorkstream: workstream,
  listWorkstreamInitiatives: workstreamInitiativePage,
  addWorkstreamInitiative: workstreamInitiative,
  removeWorkstreamInitiative: workstreamInitiative,
};

// ------------------------------------------------------------------------------------------------ fixture

/** One synthetic transformation with a record of every chain node type (ADR-0038 §1). */
export interface TraceWorld extends BenefitWorld {
  readonly findingId: string;
  readonly gap1Id: string;
  readonly gap2Id: string;
  readonly initiativeId: string;
  readonly initiativeCode: string;
  readonly deliverableId: string;
  readonly capability1Id: string;
  readonly capability2Id: string;
  readonly outcomeId: string;
  /** Outcome KPIs (T02 rows) of the world's first KPI definition and of a second one. */
  readonly kpi1Id: string;
  readonly kpi2Id: string;
  readonly kpiDefinition2Id: string;
  /** A financial benefit (no measurement KPI) for kpi_benefit links. */
  readonly benefitId: string;
}

/** Inserts one row with its audit event (the P2 audit guard demands one; the routes belong to other modules). */
export async function insertAudited(
  db: Db,
  b: BenefitWorld,
  table: "diagnostic_finding" | "tom_gap" | "capability" | "outcome_kpi" | "initiative",
  values: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  const by = b.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto(table)
      .values({
        id,
        organization_id: b.organizationId,
        transformation_id: b.transformationId,
        created_by: by,
        updated_by: by,
        ...values,
      } as never)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: `${table}.create`,
        recordType: table,
        recordId: id,
        organizationId: b.organizationId,
        transformationId: b.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

let traceSeq = 0;

/** A submitted (not draft) initiative: subject to the orphan rules and editable by the DG3 link routes. */
export async function insertSubmittedInitiative(
  db: Db,
  b: BenefitWorld,
  status: "draft" | "submitted" = "submitted",
): Promise<{ id: string; code: string }> {
  traceSeq += 1;
  const code = `INI-${String(500 + traceSeq).padStart(4, "0")}`;
  const id = await insertAudited(db, b, "initiative", { code, name: `Synthetic trace initiative ${traceSeq}`, status });
  return { id, code };
}

export async function seedTraceWorld(api: TestApi, w: World, send?: Caller): Promise<TraceWorld> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const b = await seedBenefitWorld(api, w, req);
  const db = api.db;
  const ws = await db.selectFrom("diagnostic_workstream").select("code").orderBy("code").executeTakeFirstOrThrow();
  const dim = await db.selectFrom("tom_dimension").select("code").orderBy("code").executeTakeFirstOrThrow();
  const findingId = await insertAudited(db, b, "diagnostic_finding", {
    workstream_code: ws.code,
    kind: "root_cause",
    statement: "Synthetic finding: manual order hand-offs",
    status: "confirmed",
  });
  const gap1Id = await insertAudited(db, b, "tom_gap", { dimension_code: dim.code, gap: "Synthetic gap 1" });
  const gap2Id = await insertAudited(db, b, "tom_gap", { dimension_code: dim.code, gap: "Synthetic gap 2" });
  const capability1Id = await insertAudited(db, b, "capability", { name: "Synthetic order automation" });
  const capability2Id = await insertAudited(db, b, "capability", { name: "Synthetic self-service" });
  const outcomeId = await createOutcomeRow(db, b.transformationId, b.organizationId, b.users.tl.id);
  const def2 = await req("POST", `${b.base}/kpi-definitions`, {
    session: b.s.tl,
    body: { name: "Synthetic order cycle time", unitKind: "count", polarity: "lower_is_better" },
  });
  expect(def2.status, JSON.stringify(def2.body)).toBe(201);
  const kpiDefinition2Id = (def2.body as { id: string }).id;
  const kpi1Id = await insertAudited(db, b, "outcome_kpi", {
    outcome_id: outcomeId,
    kpi_definition_id: b.kpiDefinitionId,
    target_date: "2027-12-31",
  });
  const kpi2Id = await insertAudited(db, b, "outcome_kpi", {
    outcome_id: outcomeId,
    kpi_definition_id: kpiDefinition2Id,
    target_date: "2027-12-31",
  });
  const initiative = await insertSubmittedInitiative(db, b);
  const deliverableId = await insertDeliverable(db, b, initiative.id);
  const benefit = await req("POST", `${b.base}/benefits`, {
    session: b.s.bo,
    body: {
      title: "Synthetic order-handling saving",
      description: "Lower handling cost on synthetic orders.",
      benefitType: "cost",
      valueClass: "avoided_cost",
      ownerUserId: b.users.bo.id,
      currency: "SAR",
      financialStatementLine: "Opex - operations",
    },
  });
  expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
  return {
    ...b,
    findingId,
    gap1Id,
    gap2Id,
    initiativeId: initiative.id,
    initiativeCode: initiative.code,
    deliverableId,
    capability1Id,
    capability2Id,
    outcomeId,
    kpi1Id,
    kpi2Id,
    kpiDefinition2Id,
    benefitId: (benefit.body as { id: string }).id,
  };
}

// ------------------------------------------------------------------------------------------------ exercises

export async function exerciseP4BeMOperations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const t = await seedTraceWorld(ctx.api, ctx.world, m);
  const L = `${t.base}/trace-links`;
  const s = t.s;

  // createTraceLink: the four kinds; a share only into a KPI or benefit; AUD 403.
  const issueGap = await m("POST", L, {
    session: s.tl,
    body: {
      linkKind: "issue_gap",
      fromId: t.findingId,
      toId: t.gap1Id,
      contributionStatement: "Hand-offs cause gap 1",
    },
  });
  expect([issueGap.status, issueGap.body.version, issueGap.body.status], JSON.stringify(issueGap.body)).toEqual([
    201,
    1,
    "active",
  ]);
  expect(
    (
      await m("POST", L, {
        session: s.auditor,
        body: { linkKind: "issue_gap", fromId: t.findingId, toId: t.gap2Id, contributionStatement: "AUD write" },
      })
    ).status,
  ).toBe(403);
  const delCap = await m("POST", L, {
    session: s.bo,
    body: {
      linkKind: "deliverable_capability",
      fromId: t.deliverableId,
      toId: t.capability1Id,
      contributionStatement: "The deliverable builds the automation",
    },
  });
  expect(delCap.status, JSON.stringify(delCap.body)).toBe(201);
  const capKpi = await m("POST", L, {
    session: s.bo,
    body: {
      linkKind: "capability_kpi",
      fromId: t.capability1Id,
      toId: t.kpi1Id,
      contributionStatement: "Automation moves the KPI",
      allocationShare: "0.6",
      allocationBasis: "Synthetic estimate",
    },
  });
  expect([capKpi.status, capKpi.body.allocationShare], JSON.stringify(capKpi.body)).toEqual([201, "0.600000"]);
  const kpiBen = await m("POST", L, {
    session: s.bo,
    body: {
      linkKind: "kpi_benefit",
      fromId: t.kpi1Id,
      toId: t.benefitId,
      contributionStatement: "The KPI movement yields the saving",
      allocationShare: "0.5",
    },
  });
  expect(kpiBen.status, JSON.stringify(kpiBen.body)).toBe(201);
  // 409 duplicate; 422 share into a gap.
  expect(
    (
      await m("POST", L, {
        session: s.bo,
        body: { linkKind: "issue_gap", fromId: t.findingId, toId: t.gap1Id, contributionStatement: "Again" },
      })
    ).status,
  ).toBe(409);
  const badShare = await m("POST", L, {
    session: s.bo,
    body: {
      linkKind: "issue_gap",
      fromId: t.findingId,
      toId: t.gap2Id,
      contributionStatement: "Share on a gap",
      allocationShare: "0.2",
    },
  });
  expect([badShare.status, badShare.body.code]).toEqual([422, "trace_link.share_not_allowed"]);

  // setOutcomeContributionAllocation: a DG3 contribution naming KPI 1 takes 0.4 (total 1); AUD 403; 428 without If-Match.
  const contribution = await call(ctx.api.app, "POST", `/api/v1/initiatives/${t.initiativeId}/outcome-contributions`, {
    session: s.tl,
    body: { outcomeId: t.outcomeId, outcomeKpiId: t.kpi1Id, contributionStatement: "The initiative moves KPI 1" },
  });
  expect(contribution.status, JSON.stringify(contribution.body)).toBe(201);
  const C = `/api/v1/initiatives/${t.initiativeId}/outcome-contributions/${(contribution.body as { id: string }).id}/allocation`;
  expect(
    (
      await m("POST", C, {
        session: s.auditor,
        headers: ifm(1),
        body: { allocationShare: "0.4", allocationBasis: null },
      })
    ).status,
  ).toBe(403);
  expect((await m("POST", C, { session: s.bo, body: { allocationShare: "0.4", allocationBasis: null } })).status).toBe(
    428,
  );
  const share = await m("POST", C, {
    session: s.bo,
    headers: ifm(1),
    body: { allocationShare: "0.4", allocationBasis: "Synthetic split" },
  });
  expect([share.status, share.body.allocationShare, share.body.version], JSON.stringify(share.body)).toEqual([
    200,
    "0.400000",
    2,
  ]);

  // getAllocationSet: 0.6 + 0.4 = 1, nothing unallocated.
  const set = await m("GET", `${t.base}/allocation-sets/outcome_kpi/${t.kpi1Id}`, { session: s.auditor });
  expect([set.status, set.body.total, set.body.unallocatedShare, set.body.members.length]).toEqual([
    200,
    "1.000000",
    "0.000000",
    2,
  ]);

  // listTraceLinks, getTraceLink, updateTraceLink (If-Match), removeTraceLink.
  const list = await m("GET", `${L}?kind=capability_kpi`, { session: s.auditor });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);
  const one = await m("GET", `${L}/${kpiBen.body.id}`, { session: s.auditor });
  expect([one.status, one.headers["etag"]]).toEqual([200, '"1"']);
  const upd = await m("PATCH", `${L}/${kpiBen.body.id}`, {
    session: s.bo,
    headers: ifm(1),
    body: { allocationShare: "0.7" },
  });
  expect([upd.status, upd.body.allocationShare, upd.body.version], JSON.stringify(upd.body)).toEqual([
    200,
    "0.700000",
    2,
  ]);
  expect(
    (await m("PATCH", `${L}/${kpiBen.body.id}`, { session: s.bo, headers: ifm(1), body: { allocationShare: "0.1" } }))
      .status,
  ).toBe(409);
  const removed = await m("POST", `${L}/${issueGap.body.id}/remove`, {
    session: s.bo,
    headers: ifm(1),
    body: { reason: "Synthetic: superseded" },
  });
  expect([removed.status, removed.body.status], JSON.stringify(removed.body)).toEqual([200, "removed"]);
  expect(
    (await m("POST", `${L}/${issueGap.body.id}/remove`, { session: s.bo, headers: ifm(2), body: { reason: "Again" } }))
      .status,
  ).toBe(422);

  // getTraceability, getOrphanReport, getRecordImpact.
  const graph = await m("GET", `${t.base}/traceability`, { session: s.auditor });
  expect(graph.status, JSON.stringify(graph.body).slice(0, 300)).toBe(200);
  expect(graph.body.nodes.length).toBeGreaterThan(5);
  const rooted = await m(
    "GET",
    `${t.base}/traceability?rootType=capability&rootId=${t.capability1Id}&direction=downstream&depth=2`,
    {
      session: s.auditor,
    },
  );
  expect([rooted.status, rooted.body.rootId]).toEqual([200, t.capability1Id]);
  const orphans = await m("GET", `${t.base}/orphans?recordType=initiative`, { session: s.auditor });
  expect(orphans.status).toBe(200);
  const impact = await m("GET", `/api/v1/records/outcome_kpi/${t.kpi1Id}/impact`, { session: s.auditor });
  expect(impact.status, JSON.stringify(impact.body)).toBe(200);
  expect(
    impact.body.records.some(
      (r: { recordId: string; valueAffected: boolean }) => r.recordId === t.benefitId && r.valueAffected,
    ),
  ).toBe(true);
  expect((await m("GET", `/api/v1/records/benefit/${t.benefitId}/impact`, { session: s.outsider })).status).toBe(404);

  // T-DG4-BE-M2 (appended after BE-M, p4-work-split §J+K JK.0): the four Modular-entry operations.
  await exerciseP4BeM2Operations(ctx);
  // T-DG4-BE-M3 (appended after BE-M2, p4-work-split §J+K JK.0): the 14 portfolio and workstream operations.
  await exerciseP4BeM3Operations(ctx);
}

// ------------------------------------------------------------------------------------------------ BE-M2: Modular entry
// T-DG4-BE-M2 (ADR-0038 §7; REQ-PB-005, REQ-S03-005): `seedModularWorld`, the Modular-entry fixture the BE-M2 tests
// reuse (a SYNTHETIC transformation entering at Design), its helpers, and the exercises of the four operations. Every
// approval here (the inherited G2 approval accepted by the synthetic Sponsor, the fixture gate exceptions and waiver)
// is synthetic demo data and approves nothing real.

export type ModularActor = "tl" | "sp" | "bo" | "to" | "auditor" | "outsider";

/** A Modular transformation entering at Design, with a KPI definition and one outcome WITHOUT a KPI row. */
export interface ModularWorld {
  readonly transformationId: string;
  readonly organizationId: string;
  readonly base: string;
  readonly kpiDefinitionId: string;
  readonly outcomeId: string;
  readonly users: Readonly<Record<ModularActor, { id: string }>>;
  readonly s: Readonly<Record<ModularActor, Session>>;
}

/** tl: TL (BU scope; creates it); sp: SP and bo: BO (transformation scope); to: TO, auditor: AUD (org); outsider: TO
 *  of org B. `mode` defaults to modular at Design; `end_to_end` gives the same world as an End-to-End transformation. */
export async function seedModularWorld(
  api: TestApi,
  w: World,
  send?: Caller,
  mode: "modular" | "end_to_end" = "modular",
): Promise<ModularWorld> {
  const req: Caller = send ?? ((m, u, o) => call(api.app, m, u, o));
  const tl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tl.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  const tlSession = await signIn(api.app, tl.subject);
  const t = await req("POST", "/api/v1/transformations", {
    session: tlSession,
    body:
      mode === "modular"
        ? { businessUnitId: w.a1, name: "Synthetic Modular entry at Design", mode: "modular", entryPhase: "design" }
        : { businessUnitId: w.a1, name: "Synthetic End-to-End transformation", mode: "end_to_end" },
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const transformationId = (t.body as { id: string }).id;
  const scope = { type: "transformation" as const, id: transformationId };
  const mk = async (role: string) => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
    return u;
  };
  const sp = await mk("SP");
  const bo = await mk("BO");
  const base = `/api/v1/transformations/${transformationId}`;
  const def = await req("POST", `${base}/kpi-definitions`, {
    session: tlSession,
    body: { name: "Synthetic order cycle time", unitKind: "count", polarity: "lower_is_better" },
  });
  expect(def.status, JSON.stringify(def.body)).toBe(201);
  const outcomeId = await createOutcomeRow(api.db, transformationId, w.orgA.id, tl.id);
  return {
    transformationId,
    organizationId: w.orgA.id,
    base,
    kpiDefinitionId: (def.body as { id: string }).id,
    outcomeId,
    users: { tl, sp, bo, to: w.office, auditor: w.auditor, outsider: w.officeB },
    s: {
      tl: tlSession,
      sp: await signIn(api.app, sp.subject),
      bo: await signIn(api.app, bo.subject),
      to: await signIn(api.app, w.office.subject),
      auditor: await signIn(api.app, w.auditor.subject),
      outsider: await signIn(api.app, w.officeB.subject),
    },
  };
}

/** Inserts one fixture row with its audit event (the P2 audit guard demands one; the routes belong to other modules). */
export async function insertModularFixture(
  db: Db,
  mw: ModularWorld,
  table: "outcome_kpi" | "gate_exception" | "gate_dispensation",
  values: Record<string, unknown>,
): Promise<string> {
  const id = uuidv7();
  const by = mw.users.tl.id;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto(table)
      .values({
        id,
        organization_id: mw.organizationId,
        transformation_id: mw.transformationId,
        created_by: by,
        updated_by: by,
        ...values,
      } as never)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: by, requestId: `fixture-${id}`, source: "api" },
      {
        action: `${table}.create`,
        recordType: table,
        recordId: id,
        organizationId: mw.organizationId,
        transformationId: mw.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

/** A baseline with a value, through the kpi module's route (TL holds baseline.edit). */
export async function addBaseline(req: Caller, mw: ModularWorld, value: string | null = "42"): Promise<string> {
  const res = await req("POST", `${mw.base}/baselines`, {
    session: mw.s.tl,
    body: {
      metric: "Synthetic order cycle time",
      unit: "days",
      scope: "operational",
      ...(value !== null ? { value } : {}),
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return (res.body as { id: string }).id;
}

/** An active outcome KPI row (T02) on the world's outcome. */
export function addOutcomeKpi(db: Db, mw: ModularWorld): Promise<string> {
  return insertModularFixture(db, mw, "outcome_kpi", {
    outcome_id: mw.outcomeId,
    kpi_definition_id: mw.kpiDefinitionId,
    target_date: "2027-12-31",
  });
}

/** A note evidence item, verified by the TO when `verify` (an inherited approval counts only on verified evidence). */
export async function addEvidence(req: Caller, mw: ModularWorld, verify = true): Promise<string> {
  const ev = await req("POST", `${mw.base}/evidence`, {
    session: mw.s.tl,
    body: {
      kind: "note",
      title: "Synthetic prior-programme document",
      noteBody: "Synthetic minutes.",
      ownerUserId: mw.users.tl.id,
    },
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const body = ev.body as { id: string; version: number };
  if (verify) {
    const review = await req("POST", `${mw.base}/evidence/${body.id}/review`, {
      session: mw.s.to,
      headers: ifm(body.version),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: document read." },
    });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
  }
  return body.id;
}

/** The inherited G2 approval (ADR-0021 §5, the DG3 route), accepted by the synthetic Sponsor when `accept`. */
export async function addInheritedApproval(
  req: Caller,
  mw: ModularWorld,
  evidenceId: string,
  accept = true,
  gateCode = "G2",
): Promise<string> {
  const D = `${mw.base}/gate-dispensations`;
  const created = await req("POST", D, {
    session: mw.s.tl,
    body: {
      kind: "inherited_approval",
      gateCode,
      approvingBody: "Synthetic prior programme board",
      approvedOn: "2026-01-15",
      evidenceId,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const d = created.body as { id: string; version: number };
  if (accept) {
    const decided = await req("POST", `${D}/${d.id}/decision`, {
      session: mw.s.sp,
      headers: ifm(d.version),
      body: { result: "accepted", note: "Synthetic demo decision." },
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
  }
  return d.id;
}

export async function exerciseP4BeM2Operations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const mw = await seedModularWorld(ctx.api, ctx.world, m);
  const R = `${mw.base}/inherited-records`;
  const s = mw.s;

  // getMissingLinks: the empty Modular entry at Design lists both blocking items; G2 inherited once accepted.
  const empty = await m("GET", `${mw.base}/missing-links`, { session: s.auditor });
  expect(empty.status, JSON.stringify(empty.body)).toBe(200);
  expect(empty.body.items.filter((i: { severity: string }) => i.severity === "blocking").length).toBe(2);
  const g2Evidence = await addEvidence(m, mw);
  await addInheritedApproval(m, mw, g2Evidence);
  const labelled = await m("GET", `${mw.base}/missing-links`, { session: s.tl });
  expect(labelled.body.gates.find((g: { gateCode: string }) => g.gateCode === "G2").label).toBe("inherited");
  expect((await m("GET", `${mw.base}/missing-links`, { session: s.outsider })).status).toBe(404);

  // createInheritedRecord: evidence and baseline 201; AUD 403; prior_approval 422; duplicate 409.
  const evidenceId = await addEvidence(m, mw, false);
  const ev = await m("POST", R, {
    session: s.tl,
    body: { kind: "evidence", evidenceId, sourceDescription: "Synthetic: prior programme archive" },
  });
  expect([ev.status, ev.body.version, ev.body.label], JSON.stringify(ev.body)).toEqual([201, 1, "inherited"]);
  const baselineId = await addBaseline(m, mw);
  const bl = await m("POST", R, {
    session: s.to,
    body: {
      kind: "baseline",
      baselineId,
      sourceDescription: "Synthetic: 2025 operations report",
      originalOwner: "Synthetic operations office",
      originalDate: "2025-12-31",
    },
  });
  expect(bl.status, JSON.stringify(bl.body)).toBe(201);
  expect(
    (await m("POST", R, { session: s.auditor, body: { kind: "evidence", evidenceId, sourceDescription: "AUD" } }))
      .status,
  ).toBe(403);
  const prior = await m("POST", R, { session: s.tl, body: { kind: "prior_approval", sourceDescription: "Board" } });
  expect([prior.status, prior.body.code]).toEqual([422, "inherited_record.prior_approval_use_dispensation"]);
  const dup = await m("POST", R, { session: s.tl, body: { kind: "evidence", evidenceId, sourceDescription: "Again" } });
  expect([dup.status, dup.body.code]).toEqual([409, "inherited_record.duplicate"]);

  // listInheritedRecords: the two records and the prior_approval entry.
  const list = await m("GET", R, { session: s.auditor });
  expect(list.status).toBe(200);
  expect(list.body.items.map((i: { kind: string }) => i.kind).sort()).toEqual([
    "baseline",
    "evidence",
    "prior_approval",
  ]);

  // withdrawInheritedRecord: 428 without If-Match, 409 stale, 200, then 422 not_active.
  const W = `${R}/${ev.body.id}/withdraw`;
  expect((await m("POST", W, { session: s.tl, body: { reason: "Synthetic: superseded" } })).status).toBe(428);
  expect((await m("POST", W, { session: s.tl, headers: ifm(7), body: { reason: "Synthetic" } })).status).toBe(409);
  const withdrawn = await m("POST", W, { session: s.tl, headers: ifm(1), body: { reason: "Synthetic: superseded" } });
  expect([withdrawn.status, withdrawn.body.status, withdrawn.body.version]).toEqual([200, "withdrawn", 2]);
  const again = await m("POST", W, { session: s.tl, headers: ifm(2), body: { reason: "Synthetic: again" } });
  expect([again.status, again.body.code]).toEqual([422, "inherited_record.not_active"]);
}

// ------------------------------------------------------------------------------------------------ BE-M3: structure
// T-DG4-BE-M3 (ADR-0038 §9-§12; REQ-S03-001): portfolios with their transformations and workstreams with their
// initiatives. All data is SYNTHETIC; a portfolio or workstream grants no access and approves nothing.

export async function exerciseP4BeM3Operations(ctx: P4ExerciseContext): Promise<void> {
  const m = ctx.mirrored;
  const w = ctx.world;
  const b = await seedBenefitWorld(ctx.api, w, m);
  const office = await signIn(ctx.api.app, w.office.subject);
  const s = b.s;
  const P = `/api/v1/organizations/${w.orgA.id}/portfolios`;

  // createPortfolio: TO 201 (version 1); AUD 403; a taken code 409.
  const code = uniq("PF");
  const created = await m("POST", P, { session: office, body: { code, name: "Synthetic customer portfolio" } });
  expect([created.status, created.body.version, created.body.status], JSON.stringify(created.body)).toEqual([
    201,
    1,
    "active",
  ]);
  expect((await m("POST", P, { session: s.auditor, body: { code: uniq("PF"), name: "AUD" } })).status).toBe(403);
  const taken = await m("POST", P, { session: office, body: { code, name: "Again" } });
  expect([taken.status, taken.body.code]).toEqual([409, "portfolio.code_taken"]);
  const PF = `/api/v1/portfolios/${created.body.id}`;

  // listPortfolios, getPortfolio (organization.read); updatePortfolio: 428, 409, 200.
  const list = await m("GET", P, { session: s.auditor });
  expect(list.status).toBe(200);
  expect(list.body.items.some((p: { id: string }) => p.id === created.body.id)).toBe(true);
  expect((await m("GET", PF, { session: s.auditor })).status).toBe(200);
  expect((await m("GET", PF, { session: s.outsider })).status).toBe(404);
  expect((await m("PATCH", PF, { session: office, body: { name: "Renamed" } })).status).toBe(428);
  expect((await m("PATCH", PF, { session: office, headers: ifm(9), body: { name: "Renamed" } })).status).toBe(409);
  const renamed = await m("PATCH", PF, { session: office, headers: ifm(1), body: { name: "Synthetic portfolio 2" } });
  expect([renamed.status, renamed.body.version, renamed.body.name]).toEqual([200, 2, "Synthetic portfolio 2"]);

  // addPortfolioTransformation: 201; a second placement 422; listPortfolioTransformations; remove: 428, 409, 200, 422.
  const M = `${PF}/transformations`;
  const placed = await m("POST", M, { session: office, body: { transformationId: b.transformationId } });
  expect([placed.status, placed.body.status], JSON.stringify(placed.body)).toEqual([201, "active"]);
  const twice = await m("POST", M, { session: office, body: { transformationId: b.transformationId } });
  expect([twice.status, twice.body.code]).toEqual([422, "portfolio.transformation_already_placed"]);
  const members = await m("GET", M, { session: s.auditor });
  expect([members.status, members.body.items.length]).toEqual([200, 1]);
  const R = `${M}/${placed.body.id}/remove`;
  expect((await m("POST", R, { session: office, body: { reason: "Synthetic: moved" } })).status).toBe(428);
  expect((await m("POST", R, { session: office, headers: ifm(5), body: { reason: "Synthetic" } })).status).toBe(409);
  const removed = await m("POST", R, { session: office, headers: ifm(1), body: { reason: "Synthetic: moved" } });
  expect([removed.status, removed.body.status, removed.body.version]).toEqual([200, "removed", 2]);
  const again = await m("POST", R, { session: office, headers: ifm(2), body: { reason: "Synthetic: again" } });
  expect([again.status, again.body.code]).toEqual([422, "membership.not_active"]);

  // createWorkstream: TL 201 WS-01; AUD 403; listWorkstreams, getWorkstream; updateWorkstream: 428, 409, 200.
  const W = `${b.base}/workstreams`;
  const ws = await m("POST", W, { session: s.tl, body: { name: "Synthetic digital channels" } });
  expect([ws.status, ws.body.code, ws.body.version], JSON.stringify(ws.body)).toEqual([201, "WS-01", 1]);
  expect((await m("POST", W, { session: s.auditor, body: { name: "AUD" } })).status).toBe(403);
  expect((await m("GET", W, { session: s.auditor })).body.items.length).toBe(1);
  const WS = `${W}/${ws.body.id}`;
  expect((await m("GET", WS, { session: s.auditor })).status).toBe(200);
  expect((await m("PATCH", WS, { session: s.tl, body: { name: "Renamed" } })).status).toBe(428);
  expect((await m("PATCH", WS, { session: s.tl, headers: ifm(4), body: { name: "Renamed" } })).status).toBe(409);
  const wsRenamed = await m("PATCH", WS, { session: s.tl, headers: ifm(1), body: { name: "Synthetic channels" } });
  expect([wsRenamed.status, wsRenamed.body.version]).toEqual([200, 2]);

  // addWorkstreamInitiative: 201; listWorkstreamInitiatives; removeWorkstreamInitiative: 428, 200.
  const initiativeId = await insertInitiative(ctx.api.db, b);
  const I = `${WS}/initiatives`;
  const assigned = await m("POST", I, { session: s.tl, body: { initiativeId } });
  expect([assigned.status, assigned.body.initiativeId], JSON.stringify(assigned.body)).toEqual([201, initiativeId]);
  expect((await m("POST", I, { session: s.auditor, body: { initiativeId } })).status).toBe(403);
  expect((await m("GET", I, { session: s.auditor })).body.items.length).toBe(1);
  const IR = `${I}/${assigned.body.id}/remove`;
  expect((await m("POST", IR, { session: s.tl, body: { reason: "Synthetic: regrouped" } })).status).toBe(428);
  const unassigned = await m("POST", IR, { session: s.tl, headers: ifm(1), body: { reason: "Synthetic: regrouped" } });
  expect([unassigned.status, unassigned.body.status]).toEqual([200, "removed"]);
}
