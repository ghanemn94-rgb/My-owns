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
  orphanReportPage,
  recordImpact,
  traceabilityGraph,
  traceLink,
  traceLinkPage,
} from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import type { z } from "zod";
import { call, type P4ExerciseContext, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { insertDeliverable, seedBenefitWorld, type BenefitWorld, type Caller } from "../benefits/fixtures.ts";
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
}
