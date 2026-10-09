// Initiative links (ADR-0021 §2; REQ-PB-040, REQ-PB-046, REQ-PB-032, REQ-PB-045 fields 4, 8 and 14; T-DG3-BE-B):
//   GET  /api/v1/initiatives/{id}/gap-links[?includeArchived]                  T05 "Problem / gap addressed"
//   POST /api/v1/initiatives/{id}/gap-links                                    1..n links to tom_gap | diagnostic_finding
//   POST /api/v1/initiatives/{id}/gap-links/{linkId}/remove                    remove (never delete), with a reason
//   GET|POST /api/v1/initiatives/{id}/outcome-contributions, …/{linkId}/remove T05 "Outcome/KPI contribution" (level 5)
//   GET|POST /api/v1/initiatives/{id}/decision-links, …/{linkId}/remove        T05 "Required decisions" (canonical decision)
//
// TOM/portfolio separation (B0059): an initiative is a VEHICLE linked to a gap or a diagnosed finding. Any other TOM
// record type (tom_canvas_cell, capability, journey, tom_dimension) is an attempt to attach the initiative as G3 TOM
// evidence and is refused with 422 initiative.not_tom_evidence and the exact ADR text. The portfolio module never writes
// a TOM table, and no G3 evaluator reads these links.
//
// A contribution needs an outcome (400 at /outcomeId when missing: the schema requires it; the column is NOT NULL); a
// KPI (T02 row) named by it must belong to that outcome (422 here; the database trigger
// initiative_contribution_kpi_matches_outcome backs it up). Every mutation: authorization re-checked at commit
// (BE18A), validation, If-Match on remove (creates are version 1), one audit event; no client I/O inside the transaction.
import {
  sql,
  type DbOrTx,
  type InitiativeDecisionLinkRow,
  type InitiativeGapLinkRow,
  type InitiativeOutcomeContributionRow,
  type Tx,
} from "@mth/db";
import {
  allocationExceedsText,
  contributionAllocationUpdate,
  traceAllocationTotals,
  type ContributionAllocation,
  initiativeDecisionLinkCreate,
  initiativeGapLinkCreate,
  initiativeOutcomeContributionCreate,
  reasonRequest,
  type InitiativeDecisionLink,
  type InitiativeGapLink,
  type InitiativeOutcomeContribution,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  iso,
  isoOrNull,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { bumpStamps, openWrite, sendCreated, type WriteContext } from "../transformations/index.ts";
import { assertEditable, fieldRule, readableInitiative, transitionProblem } from "./repository.ts";

const BASE = "/api/v1/initiatives/:initiativeId";
const JSON_BODY = ["application/json"] as const;
const EDIT = [{ permission: "initiative.edit" as const }];
const idParams = z.strictObject({ initiativeId: z.uuid() });
const linkParams = z.strictObject({ initiativeId: z.uuid(), linkId: z.uuid() });
const listQuery = z.strictObject({ includeArchived: z.stringbool().default(false) });

/** The exact English text of ADR-0021 §2 (REQ-PB-040). */
export const NOT_TOM_EVIDENCE =
  "A project portfolio is not a Target Operating Model: an initiative cannot be attached as G3 TOM evidence.";
/** TOM record types an initiative must never be attached to (ADR-0021 §2): the 422 initiative.not_tom_evidence. */
export const TOM_RECORD_TYPES: ReadonlySet<string> = new Set([
  "tom_canvas_cell",
  "capability",
  "journey",
  "tom_dimension",
]);
const GAP_TARGETS = new Map([
  ["tom_gap", { table: "tom_gap" as const, column: "tom_gap_id" as const }],
  ["diagnostic_finding", { table: "diagnostic_finding" as const, column: "diagnostic_finding_id" as const }],
]);

// ------------------------------------------------------------------------------------------------ presenters

const linkStamps = (r: {
  status: string;
  removed_at: Date | null;
  removed_by: string | null;
  remove_reason: string | null;
  version: number;
  created_at: Date;
  created_by: string;
  updated_at: Date;
  updated_by: string;
}) => ({
  status: r.status as "active" | "removed",
  removedAt: isoOrNull(r.removed_at),
  removedBy: r.removed_by,
  removeReason: r.remove_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export function toGapLink(r: InitiativeGapLinkRow): InitiativeGapLink {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    initiativeId: r.initiative_id,
    targetType: r.target_type as InitiativeGapLink["targetType"],
    tomGapId: r.tom_gap_id,
    diagnosticFindingId: r.diagnostic_finding_id,
    note: r.note,
    ...linkStamps(r),
  };
}

export function toContribution(r: InitiativeOutcomeContributionRow): InitiativeOutcomeContribution {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    initiativeId: r.initiative_id,
    outcomeId: r.outcome_id,
    outcomeKpiId: r.outcome_kpi_id,
    contributionStatement: r.contribution_statement,
    expectedKpiMovement: r.expected_kpi_movement,
    ...linkStamps(r),
  };
}

export function toDecisionLink(r: InitiativeDecisionLinkRow): InitiativeDecisionLink {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    initiativeId: r.initiative_id,
    decisionId: r.decision_id,
    ...linkStamps(r),
  };
}

// ------------------------------------------------------------------------------------------------ shared steps

type LinkTable = "initiative_gap_link" | "initiative_outcome_contribution" | "initiative_decision_link";

/** Read gate (404) + write gate re-checked at commit (403) on the initiative's transformation; then the body. */
async function openLinkWrite(tx: Tx, request: FastifyRequest, initiativeId: string) {
  const { row } = await readableInitiative(tx, request, initiativeId);
  const ctx = await openWrite(tx, request, row.transformation_id, EDIT, null, { atCommit: true });
  return { initiative: row, ctx };
}

/** A referenced record of the transformation that is not archived; 422 at `pointer` otherwise. */
async function assertLiveTarget(
  db: DbOrTx,
  table: "tom_gap" | "diagnostic_finding" | "outcome" | "outcome_kpi",
  transformationId: string,
  id: string,
  pointer: string,
): Promise<{ readonly id: string }> {
  const row = await db
    .selectFrom(table)
    .select(["id", "status"])
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row)
    throw fieldRule("validation.reference", "The referenced record does not exist in this transformation.", pointer);
  if (row.status === "archived")
    throw fieldRule(
      "initiative.link_target_archived",
      "An archived record cannot be linked to an initiative.",
      pointer,
    );
  return row;
}

/** Remove (never delete) a link: If-Match, row lock, version, active -> removed with the reason; one audit event. */
async function removeLink(
  tx: Tx,
  request: FastifyRequest,
  table: LinkTable,
  initiativeId: string,
  linkId: string,
): Promise<string> {
  const { initiative, ctx } = await openLinkWrite(tx, request, initiativeId);
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom(table)
    .select(["id", "status", "version"])
    .where("id", "=", linkId)
    .where("initiative_id", "=", initiativeId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  assertEditable(initiative);
  if (current.status !== "active") throw transitionProblem("initiative.link_removed", "This link is already removed.");
  const updated = await tx
    .updateTable(table)
    .set({
      status: "removed",
      removed_at: new Date(),
      removed_by: ctx.userId,
      remove_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", linkId)
    .where("version", "=", current.version)
    .returning(["id", "version"])
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: `${table}.remove`,
    recordType: table,
    recordId: linkId,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "active", to: "removed" } },
  });
  return linkId;
}

async function auditCreate(
  ctx: WriteContext,
  table: LinkTable,
  id: string,
  changes: Record<string, unknown>,
): Promise<void> {
  await record(ctx.tx, ctx.audit, {
    action: `${table}.create`,
    recordType: table,
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    changes: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, { from: null, to: v }])),
  });
}

// ------------------------------------------------------------------------------------------------ creates

async function createGapLink(tx: Tx, request: FastifyRequest, initiativeId: string) {
  const { initiative, ctx } = await openLinkWrite(tx, request, initiativeId);
  const body = parseBody(initiativeGapLinkCreate, request.body);
  if (TOM_RECORD_TYPES.has(body.targetType))
    throw fieldRule("initiative.not_tom_evidence", NOT_TOM_EVIDENCE, "/targetType");
  const target = GAP_TARGETS.get(body.targetType);
  if (target === undefined)
    throw fieldRule(
      "initiative.gap_target_type",
      "A gap link points to a TOM gap (tom_gap) or a diagnosed finding (diagnostic_finding).",
      "/targetType",
    );
  assertEditable(initiative);
  await assertLiveTarget(tx, target.table, ctx.transformationId, body.targetId, "/targetId");
  const duplicate = await tx
    .selectFrom("initiative_gap_link")
    .select("id")
    .where("initiative_id", "=", initiativeId)
    .where(target.column, "=", body.targetId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (duplicate)
    throw problems.duplicate("initiative.gap_link_duplicate", "The initiative is already linked to this record.");
  const id = uuidv7();
  const row = await tx
    .insertInto("initiative_gap_link")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: initiativeId,
      target_type: body.targetType,
      tom_gap_id: target.column === "tom_gap_id" ? body.targetId : null,
      diagnostic_finding_id: target.column === "diagnostic_finding_id" ? body.targetId : null,
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditCreate(ctx, "initiative_gap_link", id, {
    initiative_id: initiativeId,
    target_type: body.targetType,
    tom_gap_id: target.column === "tom_gap_id" ? body.targetId : null,
    diagnostic_finding_id: target.column === "diagnostic_finding_id" ? body.targetId : null,
    ...(body.note !== undefined ? { note: body.note } : {}),
  });
  return toGapLink(row);
}

async function createContribution(tx: Tx, request: FastifyRequest, initiativeId: string) {
  const { initiative, ctx } = await openLinkWrite(tx, request, initiativeId);
  const body = parseBody(initiativeOutcomeContributionCreate, request.body);
  assertEditable(initiative);
  await assertLiveTarget(tx, "outcome", ctx.transformationId, body.outcomeId, "/outcomeId");
  const kpiId = body.outcomeKpiId ?? null;
  if (kpiId !== null) {
    await assertLiveTarget(tx, "outcome_kpi", ctx.transformationId, kpiId, "/outcomeKpiId");
    const owner = await tx.selectFrom("outcome_kpi").select("outcome_id").where("id", "=", kpiId).executeTakeFirst();
    if (owner?.outcome_id !== body.outcomeId)
      throw fieldRule(
        "initiative.kpi_not_in_outcome",
        "The KPI (T02 row) must belong to the outcome this contribution names.",
        "/outcomeKpiId",
      );
  }
  const id = uuidv7();
  const row = await tx
    .insertInto("initiative_outcome_contribution")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: initiativeId,
      outcome_id: body.outcomeId,
      outcome_kpi_id: kpiId,
      contribution_statement: body.contributionStatement,
      expected_kpi_movement: body.expectedKpiMovement ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditCreate(ctx, "initiative_outcome_contribution", id, {
    initiative_id: initiativeId,
    outcome_id: body.outcomeId,
    outcome_kpi_id: kpiId,
    contribution_statement: body.contributionStatement,
    expected_kpi_movement: body.expectedKpiMovement ?? null,
  });
  return toContribution(row);
}

async function createDecisionLink(tx: Tx, request: FastifyRequest, initiativeId: string) {
  const { initiative, ctx } = await openLinkWrite(tx, request, initiativeId);
  const body = parseBody(initiativeDecisionLinkCreate, request.body);
  assertEditable(initiative);
  const decision = await tx
    .selectFrom("decision")
    .select("id")
    .where("id", "=", body.decisionId)
    .where("transformation_id", "=", ctx.transformationId)
    .executeTakeFirst();
  if (!decision)
    throw fieldRule("validation.reference", "The decision does not exist in this transformation.", "/decisionId");
  const duplicate = await tx
    .selectFrom("initiative_decision_link")
    .select("id")
    .where("initiative_id", "=", initiativeId)
    .where("decision_id", "=", body.decisionId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (duplicate)
    throw problems.duplicate(
      "initiative.decision_link_duplicate",
      "The initiative is already linked to this decision.",
    );
  const id = uuidv7();
  const row = await tx
    .insertInto("initiative_decision_link")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: initiativeId,
      decision_id: body.decisionId,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditCreate(ctx, "initiative_decision_link", id, { initiative_id: initiativeId, decision_id: body.decisionId });
  return toDecisionLink(row);
}

// ------------------------------------------------------------------------------------------------ BE-M: contribution share
// setOutcomeContributionAllocation (P4 slice K; ADR-0038 §3, §10, §12; T-DG4-BE-M; REQ-S03-006):
//   POST /api/v1/initiatives/{id}/outcome-contributions/{linkId}/allocation   (traceability.link; If-Match)
// Sets or clears the share of a KPI movement credited to a T05 contribution. A share needs the contribution's outcome
// KPI (422 contribution.allocation_needs_kpi); a removed contribution is read-only (422 contribution.not_active). The
// set into the KPI (capability_kpi trace links + contribution shares) is serialized by the advisory lock of class traceAllocationSet (key = the
// outcome KPI id; the 0055 trigger takes the same lock) and may not exceed 100 % (422
// trace_link.allocation_exceeds_total, exact ADR text). The DG3 contribution routes above never write these columns
// and their responses are unchanged. One audit event `initiative_outcome_contribution.allocation_set`.

const allocationParams = z.strictObject({ initiativeId: z.uuid(), linkId: z.uuid() });
const TRACE_LINK = [{ permission: "traceability.link" as const }];

function toContributionAllocation(r: InitiativeOutcomeContributionRow): ContributionAllocation {
  return {
    linkId: r.id,
    initiativeId: r.initiative_id,
    outcomeId: r.outcome_id,
    outcomeKpiId: r.outcome_kpi_id,
    allocationShare: r.allocation_share,
    allocationBasis: r.allocation_basis,
    version: r.version,
  };
}

async function setContributionAllocation(
  tx: Tx,
  request: FastifyRequest,
  initiativeId: string,
  linkId: string,
): Promise<ContributionAllocation> {
  const { row: initiative } = await readableInitiative(tx, request, initiativeId);
  const ctx = await openWrite(tx, request, initiative.transformation_id, TRACE_LINK, null, { atCommit: true });
  const body = parseBody(contributionAllocationUpdate, request.body);
  const expected = requireIfMatch(request);
  const peek = await tx
    .selectFrom("initiative_outcome_contribution")
    .select(["id", "outcome_kpi_id"])
    .where("id", "=", linkId)
    .where("initiative_id", "=", initiativeId)
    .executeTakeFirst();
  if (!peek) throw problems.notFound();
  // The allocation-set lock before the row lock, in the trigger's order.
  if (peek.outcome_kpi_id !== null)
    await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.traceAllocationSet}::int4, hashtext(${peek.outcome_kpi_id}::text))`.execute(
      tx,
    );
  const current = await tx
    .selectFrom("initiative_outcome_contribution")
    .selectAll()
    .where("id", "=", linkId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "active")
    throw transitionProblem("contribution.not_active", "This contribution has been removed.");
  const share = body.allocationShare;
  const basis = body.allocationBasis;
  if (share !== null && current.outcome_kpi_id === null)
    throw fieldRule(
      "contribution.allocation_needs_kpi",
      "A share needs the contribution's KPI; name the KPI first.",
      "/allocationShare",
    );
  if (basis !== null && share === null)
    throw problems.badRequest("validation.basis_needs_share", "An allocation basis needs a share.", "/allocationBasis");
  if (share !== null && current.outcome_kpi_id !== null) {
    const links = await tx
      .selectFrom("trace_link")
      .select("allocation_share")
      .where("outcome_kpi_id", "=", current.outcome_kpi_id)
      .where("link_kind", "=", "capability_kpi")
      .where("status", "=", "active")
      .where("allocation_share", "is not", null)
      .execute();
    const contributions = await tx
      .selectFrom("initiative_outcome_contribution")
      .select("allocation_share")
      .where("outcome_kpi_id", "=", current.outcome_kpi_id)
      .where("status", "=", "active")
      .where("allocation_share", "is not", null)
      .where("id", "<>", linkId)
      .execute();
    const totals = traceAllocationTotals([...[...links, ...contributions].map((r) => r.allocation_share!), share]);
    if (totals.overHundred)
      throw fieldRule("trace_link.allocation_exceeds_total", allocationExceedsText(totals.total), "/allocationShare");
  }
  const updated = await tx
    .updateTable("initiative_outcome_contribution")
    .set({ allocation_share: share, allocation_basis: basis, ...bumpStamps(ctx.userId) })
    .where("id", "=", linkId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "initiative_outcome_contribution.allocation_set",
    recordType: "initiative_outcome_contribution",
    recordId: linkId,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: {
      allocation_share: { from: current.allocation_share, to: updated.allocation_share },
      allocation_basis: { from: current.allocation_basis, to: updated.allocation_basis },
    },
  });
  return toContributionAllocation(updated);
}

/** Registers setOutcomeContributionAllocation; returns its "METHOD /path". */
function registerContributionAllocationRoute(app: FastifyInstance, db: ModuleDeps["db"]): string {
  const path = `${BASE}/outcome-contributions/:linkId/allocation`;
  app.post(
    path,
    { config: { access: { permission: "traceability.link" as const }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { initiativeId, linkId } = parse(allocationParams, request.params, "params");
      const body = await db.transaction().execute((tx) => setContributionAllocation(tx, request, initiativeId, linkId));
      return sendVersioned(reply, 200, body);
    },
  );
  return `POST ${path}`;
}
// ------------------------------------------------------------------------------------------------ end BE-M block

// ------------------------------------------------------------------------------------------------ routes

export function registerInitiativeLinkRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: "initiative.edit" as const }, consumes: JSON_BODY };
  const routes: string[] = [];

  interface LinkKind {
    readonly segment: string;
    readonly table: LinkTable;
    readonly create: (
      tx: Tx,
      request: FastifyRequest,
      initiativeId: string,
    ) => Promise<{ id: string; version: number }>;
    readonly present: (r: unknown) => { id: string; version: number };
  }
  const kinds: readonly LinkKind[] = [
    {
      segment: "gap-links",
      table: "initiative_gap_link" as const,
      create: createGapLink,
      present: (r: unknown) => toGapLink(r as InitiativeGapLinkRow),
    },
    {
      segment: "outcome-contributions",
      table: "initiative_outcome_contribution" as const,
      create: createContribution,
      present: (r: unknown) => toContribution(r as InitiativeOutcomeContributionRow),
    },
    {
      segment: "decision-links",
      table: "initiative_decision_link" as const,
      create: createDecisionLink,
      present: (r: unknown) => toDecisionLink(r as InitiativeDecisionLinkRow),
    },
  ];

  for (const kind of kinds) {
    const path = `${BASE}/${kind.segment}`;

    app.get(path, { config: read }, async (request) => {
      const { initiativeId } = parse(idParams, request.params, "params");
      const query = parseQuery(listQuery, request.query);
      await readableInitiative(db, request, initiativeId);
      let q = db.selectFrom(kind.table).selectAll().where("initiative_id", "=", initiativeId);
      if (!query.includeArchived) q = q.where("status", "=", "active");
      const rows = await q.orderBy("created_at").orderBy("id").execute();
      return { items: rows.map((r) => kind.present(r)) };
    });

    app.post(path, { config: edit }, async (request, reply) => {
      const { initiativeId } = parse(idParams, request.params, "params");
      const link = await db.transaction().execute((tx) => kind.create(tx, request, initiativeId));
      return sendCreated(
        request,
        reply,
        { status: 201, body: link, replayed: false },
        path.replace(":initiativeId", initiativeId),
      );
    });

    app.post(`${path}/:linkId/remove`, { config: edit }, async (request, reply) => {
      const { initiativeId, linkId } = parse(linkParams, request.params, "params");
      await db.transaction().execute((tx) => removeLink(tx, request, kind.table, initiativeId, linkId));
      const row = await db.selectFrom(kind.table).selectAll().where("id", "=", linkId).executeTakeFirstOrThrow();
      return sendVersioned(reply, 200, kind.present(row));
    });

    routes.push(`GET ${path}`, `POST ${path}`, `POST ${path}/:linkId/remove`);
  }
  routes.push(registerContributionAllocationRoute(app, db)); // BE-M (ADR-0038 §3)
  return routes;
}
