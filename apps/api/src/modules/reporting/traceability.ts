// Traceability chain (P4 slice K; ADR-0038 §1-§4, §10-§12; T-DG4-BE-M; REQ-S03-006, REQ-PB-044, REQ-PB-010):
//   GET  /transformations/{t}/traceability                       nodes and edges of the chain (transformation.read)
//   GET  /transformations/{t}/trace-links                        trace links (transformation.read)
//   POST /transformations/{t}/trace-links                        link two records (traceability.link; TL, BO, WL, TO)
//   GET  /transformations/{t}/trace-links/{id}                   one link (transformation.read)
//   PATCH /transformations/{t}/trace-links/{id}                  statement, share, basis (traceability.link; If-Match)
//   POST /transformations/{t}/trace-links/{id}/remove            active -> removed with a reason (If-Match)
//   GET  /transformations/{t}/allocation-sets/{type}/{id}        members, decimal total, unallocated share
//
// - The chain is read in place through the view `traceability_edge` (0055); nothing is copied and no read model is
//   stored (JK.10 item 2). Every node carries the `href` of its record's existing read operation (clickable nodes).
// - The 100 % rule is enforced twice (JK.10 item 6): the API takes the advisory lock of class traceAllocationSet (ADR-0016 §6; key = the target id) before it
//   reads a set and refuses a total above 1 with 422 trace_link.allocation_exceeds_total and the exact ADR text; the
//   0055 trigger takes the same lock and refuses again (constraint trace_allocation_total, platform/db-errors.ts).
// - Every mutation: authorization re-checked at commit, validation (shared free-text and UTF-8 rules), If-Match on
//   update and remove (428 missing, 409 stale; creates are version 1), one audit event in the transaction, no remote I/O
//   inside it. A removed link is never deleted (no DELETE grant).
// - Nothing here is a business approval, and nothing reads or writes the engineering gates DG0-DG7.
import { sql, type DbOrTx, type TraceLinkRow, type Tx } from "@mth/db";
import {
  allocationExceedsText,
  allocationTargetType,
  SHARE_LINK_KINDS,
  TRACE_EDGE_KINDS,
  TRACE_NODE_TYPES,
  traceAllocationTotals,
  traceDirection,
  traceLinkCreate,
  traceLinkKind,
  traceLinkUpdate,
  traceNodeType,
  reasonRequest,
  type AllocationSet,
  type AllocationSetMember,
  type AllocationTargetType,
  type TraceabilityGraph,
  type TraceDirection,
  type TraceEdge,
  type TraceLink,
  type TraceLinkCreate,
  type TraceNode,
  type TraceNodeType,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { bumpStamps, maybeIdempotent, openWrite, sendCreated, type WriteContext } from "../transformations/index.ts";

const T_BASE = "/api/v1/transformations/:transformationId";
const LINKS = `${T_BASE}/trace-links`;
const LINK_ITEM = `${LINKS}/:traceLinkId`;
const JSON_BODY = ["application/json"] as const;
export const TRACE_LINK_PERMISSION = "traceability.link" as const;
const LINK_RULES = [{ permission: TRACE_LINK_PERMISSION }];
/** The graph cap of ADR-0038 §4: `truncated` is true when it is reached. */
export const TRACE_NODE_CAP = 2000;
/** The longest walk (ADR-0038 §4, §6). */
export const TRACE_MAX_DEPTH = 8;

// ------------------------------------------------------------------------------------------------ problems (§12, exact)

export const traceRule = (code: string, detail: string, pointer: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

const invalidTransition = (code: string, detail: string): HttpProblem =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:invalid-transition",
    code,
    title: "Invalid transition",
    detail,
    errors: [{ pointer: "", code, message: detail }],
  });

export const TRACE_TEXT = Object.freeze({
  pairNotAllowed: "This kind of link cannot connect these two records.",
  recordNotFound: "The linked record does not exist in this transformation.",
  recordInactive: "The linked record is archived or removed.",
  duplicate: "These two records are already linked.",
  shareNotAllowed: "A share can be set only on a link into a KPI or a benefit.",
  notActive: "This link has been removed.",
  allocationNeedsKpi: "A share needs the contribution's KPI; name the KPI first.",
  contributionNotActive: "This contribution has been removed.",
});

/** 422 trace_link.allocation_exceeds_total with the exact ADR-0038 §12 text ("…would total 110%, more than 100%."). */
export function allocationExceeds(total: string): HttpProblem {
  return traceRule("trace_link.allocation_exceeds_total", allocationExceedsText(total), "/allocationShare");
}

const basisNeedsShare = () =>
  problems.badRequest("validation.basis_needs_share", "An allocation basis needs a share.", "/allocationBasis");

// ------------------------------------------------------------------------------------------------ chain records

/** One record of the chain, read in place (never copied). */
export interface ChainRecord {
  readonly type: TraceNodeType;
  readonly id: string;
  readonly code: string | null;
  readonly label: string | null;
  readonly status: string | null;
  /** Shown in the whole-transformation graph (not archived, rejected or cancelled). */
  readonly shown: boolean;
  /** Linkable: the records a trace link joins must be active (§2: archived or removed -> record_inactive). */
  readonly linkable: boolean;
  /** Subject to the orphan rules of §5 (drafts are work in progress, never orphans). */
  readonly orphanEligible: boolean;
  /** Deliverables: their initiative (for the workstream dashboard of the impact). */
  readonly initiativeId?: string | null;
  /** Outcome KPIs: their KPI definition (adoption metric links name the definition). */
  readonly kpiDefinitionId?: string | null;
}

/** The `href` of a record's existing read operation in docs/api/openapi.yaml (clickable nodes, ADR-0038 §4). */
export function hrefOf(type: TraceNodeType, transformationId: string, id: string): string {
  const t = `/api/v1/transformations/${transformationId}`;
  switch (type) {
    case "diagnostic_finding":
      return `${t}/diagnostic-findings/${id}`;
    case "tom_gap":
      return `${t}/tom-gaps/${id}`;
    case "initiative":
      return `/api/v1/initiatives/${id}`;
    case "deliverable":
      return `/api/v1/deliverables/${id}`;
    case "capability":
      return `${t}/capability-heatmap/${id}`;
    case "outcome":
      return `${t}/outcomes/${id}`;
    case "outcome_kpi":
      return `${t}/outcome-kpis/${id}`;
    case "benefit":
      return `${t}/benefits/${id}`;
  }
}

/** Every chain record of one transformation (all eight node types), keyed by id. Read-only. */
export async function loadChainRecords(
  db: DbOrTx,
  transformationId: string,
  ids?: readonly string[],
): Promise<Map<string, ChainRecord>> {
  if (ids !== undefined && ids.length === 0) return new Map();
  const only = ids === undefined ? null : [...ids];
  const out = new Map<string, ChainRecord>();
  const put = (r: ChainRecord) => out.set(r.id, r);
  const t = transformationId;
  for (const r of await db
    .selectFrom("diagnostic_finding")
    .select(["id", "statement", "status"])
    .where("transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("id", "in", only!))
    .execute())
    put({
      type: "diagnostic_finding",
      id: r.id,
      code: null,
      label: r.statement,
      status: r.status,
      shown: r.status !== "archived" && r.status !== "rejected",
      linkable: r.status !== "archived" && r.status !== "rejected",
      orphanEligible: r.status === "confirmed",
    });
  for (const r of await db
    .selectFrom("tom_gap")
    .select(["id", "dimension_code", "gap", "target_state", "status"])
    .where("transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("id", "in", only!))
    .execute())
    put({
      type: "tom_gap",
      id: r.id,
      code: r.dimension_code,
      label: r.gap ?? r.target_state ?? r.dimension_code,
      status: r.status,
      shown: r.status !== "archived",
      linkable: r.status !== "archived",
      orphanEligible: r.status === "open" || r.status === "resolved",
    });
  for (const r of await db
    .selectFrom("initiative")
    .select(["id", "code", "name", "status"])
    .where("transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("id", "in", only!))
    .execute())
    put({
      type: "initiative",
      id: r.id,
      code: r.code,
      label: r.name,
      status: r.status,
      shown: r.status !== "cancelled",
      linkable: r.status !== "cancelled",
      orphanEligible: r.status !== "draft" && r.status !== "cancelled",
    });
  for (const r of await db
    .selectFrom("deliverable")
    .select(["id", "title", "status", "initiative_id"])
    .where("transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("id", "in", only!))
    .execute())
    put({
      type: "deliverable",
      id: r.id,
      code: null,
      label: r.title,
      status: r.status,
      shown: r.status === "active",
      linkable: r.status === "active",
      orphanEligible: r.status === "active",
      initiativeId: r.initiative_id,
    });
  for (const r of await db
    .selectFrom("capability")
    .select(["id", "name", "status"])
    .where("transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("id", "in", only!))
    .execute())
    put({
      type: "capability",
      id: r.id,
      code: null,
      label: r.name,
      status: r.status,
      shown: r.status === "active",
      linkable: r.status === "active",
      orphanEligible: r.status === "active",
    });
  for (const r of await db
    .selectFrom("outcome")
    .select(["id", "statement", "status"])
    .where("transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("id", "in", only!))
    .execute())
    put({
      type: "outcome",
      id: r.id,
      code: null,
      label: r.statement,
      status: r.status,
      shown: r.status !== "archived",
      linkable: r.status !== "archived",
      orphanEligible: false,
    });
  for (const r of await db
    .selectFrom("outcome_kpi as k")
    .innerJoin("kpi_definition as d", "d.id", "k.kpi_definition_id")
    .select(["k.id", "k.status", "k.kpi_definition_id", "d.name"])
    .where("k.transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("k.id", "in", only!))
    .execute())
    put({
      type: "outcome_kpi",
      id: r.id,
      code: null,
      label: r.name,
      status: r.status,
      shown: r.status === "active",
      linkable: r.status === "active",
      orphanEligible: r.status === "active",
      kpiDefinitionId: r.kpi_definition_id,
    });
  for (const r of await db
    .selectFrom("benefit")
    .select(["id", "code", "title", "status"])
    .where("transformation_id", "=", t)
    .$if(only !== null, (q) => q.where("id", "in", only!))
    .execute())
    put({
      type: "benefit",
      id: r.id,
      code: r.code,
      label: r.title,
      status: r.status,
      shown: r.status === "active",
      linkable: r.status === "active",
      orphanEligible: r.status === "active",
    });
  return out;
}

/** One active chain edge (a row of the view `traceability_edge`; every column of a view row is set by its branch). */
export interface ChainEdge {
  readonly edge_kind: string;
  readonly from_type: string;
  readonly from_id: string;
  readonly to_type: string;
  readonly to_id: string;
  readonly link_table: string;
  readonly link_id: string;
  readonly contribution_statement: string | null;
  readonly allocation_share: string | null;
}

/** Every active chain edge of one transformation, from the view `traceability_edge` (read in place). */
export async function loadEdges(db: DbOrTx, transformationId: string): Promise<ChainEdge[]> {
  const raw = await db
    .selectFrom("traceability_edge")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .execute();
  const rows: ChainEdge[] = [];
  for (const r of raw)
    if (r.edge_kind && r.from_type && r.from_id && r.to_type && r.to_id && r.link_table && r.link_id)
      rows.push({
        edge_kind: r.edge_kind,
        from_type: r.from_type,
        from_id: r.from_id,
        to_type: r.to_type,
        to_id: r.to_id,
        link_table: r.link_table,
        link_id: r.link_id,
        contribution_statement: r.contribution_statement,
        allocation_share: r.allocation_share,
      });
  const order = new Map(TRACE_EDGE_KINDS.map((k, i) => [k as string, i]));
  return rows.sort(
    (a, b) =>
      (order.get(a.edge_kind) ?? 99) - (order.get(b.edge_kind) ?? 99) ||
      (a.link_id < b.link_id ? -1 : a.link_id > b.link_id ? 1 : 0),
  );
}

// ------------------------------------------------------------------------------------------------ orphan rules (§5)

export interface OrphanFlags {
  readonly upstream: boolean;
  readonly downstream: boolean;
  /** The missing steps, e.g. "tom_gap → initiative". */
  readonly expected: readonly string[];
}

const NO_ORPHAN: OrphanFlags = Object.freeze({ upstream: false, downstream: false, expected: Object.freeze([]) });

/** The §5 rules for one record over the edges into and out of it. Pure. */
export function orphanFlagsOf(
  rec: ChainRecord,
  incoming: readonly ChainEdge[],
  outgoing: readonly ChainEdge[],
): OrphanFlags {
  if (!rec.orphanEligible) return NO_ORPHAN;
  const has = (edges: readonly ChainEdge[], ...kinds: string[]) => edges.some((e) => kinds.includes(e.edge_kind));
  let up: string | null = null;
  let down: string | null = null;
  switch (rec.type) {
    case "diagnostic_finding":
      if (!has(outgoing, "issue_gap", "gap_initiative")) down = "diagnostic_finding → tom_gap";
      break;
    case "tom_gap":
      if (!has(incoming, "issue_gap")) up = "diagnostic_finding → tom_gap";
      if (!has(outgoing, "gap_initiative")) down = "tom_gap → initiative";
      break;
    case "initiative":
      // A link to a finding only still reports the TOM-gap step (§5).
      if (!incoming.some((e) => e.edge_kind === "gap_initiative" && e.from_type === "tom_gap"))
        up = "tom_gap → initiative";
      if (!has(outgoing, "initiative_deliverable")) down = "initiative → deliverable";
      break;
    case "deliverable":
      if (!has(outgoing, "deliverable_capability")) down = "deliverable → capability";
      break;
    case "capability":
      if (!has(incoming, "deliverable_capability")) up = "deliverable → capability";
      if (!has(outgoing, "capability_kpi")) down = "capability → outcome_kpi";
      break;
    case "outcome_kpi":
      if (!has(incoming, "capability_kpi", "initiative_kpi")) up = "capability → outcome_kpi";
      if (!has(outgoing, "kpi_benefit", "kpi_benefit_measure")) down = "outcome_kpi → benefit";
      break;
    case "benefit":
      if (!has(incoming, "kpi_benefit", "kpi_benefit_measure", "initiative_benefit")) up = "outcome_kpi → benefit";
      break;
    case "outcome":
      break;
  }
  return {
    upstream: up !== null,
    downstream: down !== null,
    expected: [up, down].filter((s): s is string => s !== null),
  };
}

/** Incoming and outgoing edges per record id. */
export function indexEdges(edges: readonly ChainEdge[]): {
  incoming: Map<string, ChainEdge[]>;
  outgoing: Map<string, ChainEdge[]>;
} {
  const incoming = new Map<string, ChainEdge[]>();
  const outgoing = new Map<string, ChainEdge[]>();
  for (const e of edges) {
    if (!outgoing.has(e.from_id)) outgoing.set(e.from_id, []);
    outgoing.get(e.from_id)!.push(e);
    if (!incoming.has(e.to_id)) incoming.set(e.to_id, []);
    incoming.get(e.to_id)!.push(e);
  }
  return { incoming, outgoing };
}

const NODE_ORDER = new Map(TRACE_NODE_TYPES.map((t, i) => [t as string, i]));
export const nodeOrder = (t: string): number => NODE_ORDER.get(t) ?? 99;

// ------------------------------------------------------------------------------------------------ allocation sets (§3)

/** Takes the allocation-set lock of one target (class traceAllocationSet, key = the target id; the 0055 trigger takes the same). */
export async function lockAllocationSet(tx: Tx, targetId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.traceAllocationSet}::int4, hashtext(${targetId}::text))`.execute(
    tx,
  );
}

/** The active members of a target's allocation set: links into it that carry a share. Read after the lock. */
export async function allocationMembers(
  db: DbOrTx,
  targetType: AllocationTargetType,
  targetId: string,
): Promise<AllocationSetMember[]> {
  const kind = targetType === "outcome_kpi" ? "capability_kpi" : "kpi_benefit";
  const column = targetType === "outcome_kpi" ? "outcome_kpi_id" : "benefit_id";
  const links = await db
    .selectFrom("trace_link")
    .select(["id", "capability_id", "outcome_kpi_id", "allocation_share", "allocation_basis", "version"])
    .where(column, "=", targetId)
    .where("link_kind", "=", kind)
    .where("status", "=", "active")
    .where("allocation_share", "is not", null)
    .orderBy("id")
    .execute();
  const members: AllocationSetMember[] = links.map((l) => ({
    linkTable: "trace_link",
    linkId: l.id,
    fromType: targetType === "outcome_kpi" ? "capability" : "outcome_kpi",
    fromId: (targetType === "outcome_kpi" ? l.capability_id : l.outcome_kpi_id)!,
    allocationShare: l.allocation_share!,
    allocationBasis: l.allocation_basis,
    version: l.version,
  }));
  if (targetType === "outcome_kpi") {
    const contributions = await db
      .selectFrom("initiative_outcome_contribution")
      .select(["id", "initiative_id", "allocation_share", "allocation_basis", "version"])
      .where("outcome_kpi_id", "=", targetId)
      .where("status", "=", "active")
      .where("allocation_share", "is not", null)
      .orderBy("id")
      .execute();
    for (const c of contributions)
      members.push({
        linkTable: "initiative_outcome_contribution",
        linkId: c.id,
        fromType: "initiative",
        fromId: c.initiative_id,
        allocationShare: c.allocation_share!,
        allocationBasis: c.allocation_basis,
        version: c.version,
      });
  }
  return members;
}

/** Refuses a set whose shares, with `share` in place of the member `excludeLinkId`, would exceed 1 (100 %). */
export async function assertWithinHundred(
  tx: Tx,
  targetType: AllocationTargetType,
  targetId: string,
  share: string,
  excludeLinkId: string | null,
): Promise<void> {
  const others = (await allocationMembers(tx, targetType, targetId)).filter((m) => m.linkId !== excludeLinkId);
  const totals = traceAllocationTotals([...others.map((m) => m.allocationShare), share]);
  if (totals.overHundred) throw allocationExceeds(totals.total);
}

// ------------------------------------------------------------------------------------------------ presenters

export function toTraceLink(r: TraceLinkRow): TraceLink {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    linkKind: r.link_kind as TraceLink["linkKind"],
    diagnosticFindingId: r.diagnostic_finding_id,
    tomGapId: r.tom_gap_id,
    deliverableId: r.deliverable_id,
    capabilityId: r.capability_id,
    outcomeKpiId: r.outcome_kpi_id,
    benefitId: r.benefit_id,
    contributionStatement: r.contribution_statement,
    allocationShare: r.allocation_share,
    allocationBasis: r.allocation_basis,
    status: r.status as TraceLink["status"],
    removedAt: isoOrNull(r.removed_at),
    removedBy: r.removed_by,
    removeReason: r.remove_reason,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

/** The node types a trace link can join (each has its own column on `trace_link`). */
type LinkEndType = "diagnostic_finding" | "tom_gap" | "deliverable" | "capability" | "outcome_kpi" | "benefit";
/** The six typed reference columns of `trace_link` (ADR-0038 §2). */
const LINK_COLUMNS = [
  "diagnostic_finding_id",
  "tom_gap_id",
  "deliverable_id",
  "capability_id",
  "outcome_kpi_id",
  "benefit_id",
] as const;
type LinkColumns = Record<(typeof LINK_COLUMNS)[number], string | null>;

/** The two records a kind joins, from -> to (ADR-0038 §1). */
function linkEnds(kind: TraceLinkCreate["linkKind"]): { from: LinkEndType; to: LinkEndType } {
  switch (kind) {
    case "issue_gap":
      return { from: "diagnostic_finding", to: "tom_gap" };
    case "deliverable_capability":
      return { from: "deliverable", to: "capability" };
    case "capability_kpi":
      return { from: "capability", to: "outcome_kpi" };
    case "kpi_benefit":
      return { from: "outcome_kpi", to: "benefit" };
  }
}

/** The six reference columns of a new link of `kind` (exactly the two it names are set; CHECK trace_link_kind_shape). */
function linkColumns(kind: TraceLinkCreate["linkKind"], fromId: string, toId: string): LinkColumns {
  const none: LinkColumns = {
    diagnostic_finding_id: null,
    tom_gap_id: null,
    deliverable_id: null,
    capability_id: null,
    outcome_kpi_id: null,
    benefit_id: null,
  };
  switch (kind) {
    case "issue_gap":
      return { ...none, diagnostic_finding_id: fromId, tom_gap_id: toId };
    case "deliverable_capability":
      return { ...none, deliverable_id: fromId, capability_id: toId };
    case "capability_kpi":
      return { ...none, capability_id: fromId, outcome_kpi_id: toId };
    case "kpi_benefit":
      return { ...none, outcome_kpi_id: fromId, benefit_id: toId };
  }
}

/** The target of a link's share: its outcome KPI (capability_kpi) or benefit (kpi_benefit); null for other kinds. */
function shareTargetOf(row: Pick<TraceLinkRow, "link_kind" | "outcome_kpi_id" | "benefit_id">): {
  type: AllocationTargetType;
  id: string;
} | null {
  if (row.link_kind === "capability_kpi") return { type: "outcome_kpi", id: row.outcome_kpi_id! };
  if (row.link_kind === "kpi_benefit") return { type: "benefit", id: row.benefit_id! };
  return null;
}

// ------------------------------------------------------------------------------------------------ mutations

/** One end of a new link: must exist in the transformation as the type the kind names, and be active (§2, §12). */
async function assertLinkEnd(
  tx: Tx,
  transformationId: string,
  type: LinkEndType,
  id: string,
  pointer: "/fromId" | "/toId",
): Promise<void> {
  const rec = (await loadChainRecords(tx, transformationId, [id])).get(id);
  if (rec === undefined) throw traceRule("trace_link.record_not_found", TRACE_TEXT.recordNotFound, pointer);
  if (rec.type !== type) throw traceRule("trace_link.pair_not_allowed", TRACE_TEXT.pairNotAllowed, "/linkKind");
  if (!rec.linkable) throw traceRule("trace_link.record_inactive", TRACE_TEXT.recordInactive, pointer);
}

async function auditLink(
  ctx: WriteContext,
  action: string,
  linkId: string,
  versions: { prior?: number; next: number },
  changes: Record<string, { from: unknown; to: unknown }>,
  reason?: string,
): Promise<void> {
  await record(ctx.tx, ctx.audit, {
    action,
    recordType: "trace_link",
    recordId: linkId,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    ...(versions.prior !== undefined ? { priorVersion: versions.prior } : {}),
    newVersion: versions.next,
    ...(reason !== undefined ? { reason } : {}),
    changes,
  });
}

async function createTraceLink(ctx: WriteContext, body: TraceLinkCreate): Promise<TraceLink> {
  const { tx, transformationId } = ctx;
  const ends = linkEnds(body.linkKind);
  const share = body.allocationShare ?? null;
  const basis = body.allocationBasis ?? null;
  await assertLinkEnd(tx, transformationId, ends.from, body.fromId, "/fromId");
  await assertLinkEnd(tx, transformationId, ends.to, body.toId, "/toId");
  if (share !== null && !SHARE_LINK_KINDS.has(body.linkKind))
    throw traceRule("trace_link.share_not_allowed", TRACE_TEXT.shareNotAllowed, "/allocationShare");
  if (basis !== null && share === null) throw basisNeedsShare();
  const columns = linkColumns(body.linkKind, body.fromId, body.toId);
  const target = shareTargetOf({ link_kind: body.linkKind, ...columns });
  // The set lock first (the trigger's order), then the duplicate and total checks on the locked set.
  if (target !== null) await lockAllocationSet(tx, target.id);
  let dup = tx
    .selectFrom("trace_link")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("link_kind", "=", body.linkKind)
    .where("status", "=", "active");
  for (const [col, value] of Object.entries(columns) as [(typeof LINK_COLUMNS)[number], string | null][])
    dup = value === null ? dup.where(col, "is", null) : dup.where(col, "=", value);
  if (await dup.executeTakeFirst()) throw problems.duplicate("trace_link.duplicate", TRACE_TEXT.duplicate);
  if (share !== null && target !== null) await assertWithinHundred(tx, target.type, target.id, share, null);
  const id = uuidv7();
  const row = await tx
    .insertInto("trace_link")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      link_kind: body.linkKind,
      ...columns,
      contribution_statement: body.contributionStatement,
      allocation_share: share,
      allocation_basis: basis,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const changes: Record<string, { from: unknown; to: unknown }> = {
    link_kind: { from: null, to: body.linkKind },
    ...Object.fromEntries(
      Object.entries(columns)
        .filter(([, value]) => value !== null)
        .map(([col, value]) => [col, { from: null, to: value }]),
    ),
    contribution_statement: { from: null, to: body.contributionStatement },
    allocation_share: { from: null, to: share },
    allocation_basis: { from: null, to: basis },
  };
  await auditLink(ctx, "trace_link.create", id, { next: 1 }, changes);
  return toTraceLink(row);
}

/** Reads a link of the transformation (404 otherwise). */
async function linkOf(db: DbOrTx, transformationId: string, linkId: string): Promise<TraceLinkRow> {
  const row = await db
    .selectFrom("trace_link")
    .selectAll()
    .where("id", "=", linkId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

/** Locks the link's allocation set (when it has one), then the link row; checks If-Match. */
async function lockLink(tx: Tx, transformationId: string, linkId: string, expected: number): Promise<TraceLinkRow> {
  const peek = await linkOf(tx, transformationId, linkId);
  const target = shareTargetOf(peek);
  if (target !== null) await lockAllocationSet(tx, target.id);
  const current = await tx
    .selectFrom("trace_link")
    .selectAll()
    .where("id", "=", linkId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "active") throw invalidTransition("trace_link.not_active", TRACE_TEXT.notActive);
  return current;
}

async function updateTraceLink(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  linkId: string,
): Promise<TraceLink> {
  const ctx = await openWrite(tx, request, transformationId, LINK_RULES, null, { atCommit: true });
  const body = parseBody(traceLinkUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await lockLink(tx, transformationId, linkId, expected);
  const share = body.allocationShare !== undefined ? body.allocationShare : current.allocation_share;
  // Clearing the share clears its basis unless a basis is sent (which is then refused: a basis needs a share).
  const basis =
    body.allocationBasis !== undefined
      ? body.allocationBasis
      : body.allocationShare === null
        ? null
        : current.allocation_basis;
  if (
    body.allocationShare !== undefined &&
    body.allocationShare !== null &&
    !SHARE_LINK_KINDS.has(current.link_kind as never)
  )
    throw traceRule("trace_link.share_not_allowed", TRACE_TEXT.shareNotAllowed, "/allocationShare");
  if (basis !== null && share === null) throw basisNeedsShare();
  const target = shareTargetOf(current);
  if (share !== null && target !== null) await assertWithinHundred(tx, target.type, target.id, share, current.id);
  const statement = body.contributionStatement ?? current.contribution_statement;
  const updated = await tx
    .updateTable("trace_link")
    .set({
      contribution_statement: statement,
      allocation_share: share,
      allocation_basis: basis,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", linkId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (statement !== current.contribution_statement)
    changes["contribution_statement"] = { from: current.contribution_statement, to: statement };
  if (updated.allocation_share !== current.allocation_share)
    changes["allocation_share"] = { from: current.allocation_share, to: updated.allocation_share };
  if (basis !== current.allocation_basis) changes["allocation_basis"] = { from: current.allocation_basis, to: basis };
  await auditLink(ctx, "trace_link.update", linkId, { prior: current.version, next: updated.version }, changes);
  return toTraceLink(updated);
}

async function removeTraceLink(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  linkId: string,
): Promise<TraceLink> {
  const ctx = await openWrite(tx, request, transformationId, LINK_RULES, null, { atCommit: true });
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const current = await lockLink(tx, transformationId, linkId, expected);
  const updated = await tx
    .updateTable("trace_link")
    .set({
      status: "removed",
      removed_at: new Date(),
      removed_by: ctx.userId,
      remove_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", linkId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await auditLink(
    ctx,
    "trace_link.remove",
    linkId,
    { prior: current.version, next: updated.version },
    { status: { from: "active", to: "removed" } },
    body.reason,
  );
  return toTraceLink(updated);
}

// ------------------------------------------------------------------------------------------------ graph (§4)

const graphQuery = z
  .strictObject({
    rootType: traceNodeType.optional(),
    rootId: z.uuid().optional(),
    direction: traceDirection.default("both"),
    depth: z.coerce.number().int().min(1).max(TRACE_MAX_DEPTH).default(TRACE_MAX_DEPTH),
  })
  .refine((q) => (q.rootType === undefined) === (q.rootId === undefined), {
    message: "validation.root_pair",
    path: ["rootId"],
  });

/** The node of one record, with its §5 orphan flags and, for an outcome KPI or benefit, its allocation totals. */
function toNode(rec: ChainRecord, transformationId: string, index: ReturnType<typeof indexEdges>): TraceNode {
  const flags = orphanFlagsOf(rec, index.incoming.get(rec.id) ?? [], index.outgoing.get(rec.id) ?? []);
  let allocation: TraceNode["allocation"] = null;
  if (rec.type === "outcome_kpi" || rec.type === "benefit") {
    const into = (index.incoming.get(rec.id) ?? []).filter(
      (e) =>
        e.allocation_share !== null &&
        (rec.type === "outcome_kpi"
          ? e.edge_kind === "capability_kpi" || e.edge_kind === "initiative_kpi"
          : e.edge_kind === "kpi_benefit"),
    );
    const totals = traceAllocationTotals(into.map((e) => e.allocation_share!));
    allocation = { total: totals.total, unallocatedShare: totals.unallocatedShare };
  }
  return {
    recordType: rec.type,
    recordId: rec.id,
    code: rec.code,
    label: rec.label,
    status: rec.status,
    href: hrefOf(rec.type, transformationId, rec.id),
    orphan: { upstream: flags.upstream, downstream: flags.downstream },
    allocation,
  };
}

function toEdge(e: ChainEdge): TraceEdge {
  return {
    edgeKind: e.edge_kind as TraceEdge["edgeKind"],
    fromType: e.from_type,
    fromId: e.from_id,
    toType: e.to_type,
    toId: e.to_id,
    linkTable: e.link_table,
    linkId: e.link_id,
    contributionStatement: e.contribution_statement,
    allocationShare: e.allocation_share === null ? null : traceAllocationTotals([e.allocation_share]).total,
  };
}

/**
 * Walks `edges` from `rootId` in `direction`, at most `depth` steps, with a visited set (the graph is acyclic by
 * construction, §4, but the walk never relies on it). Returns the reached ids with their distance (the root at 0).
 */
export function walk(
  edges: readonly ChainEdge[],
  rootId: string,
  direction: TraceDirection,
  depth: number,
): Map<string, number> {
  const { incoming, outgoing } = indexEdges(edges);
  const seen = new Map<string, number>([[rootId, 0]]);
  let frontier = [rootId];
  for (let d = 1; d <= depth && frontier.length > 0; d += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const steps = [
        ...(direction !== "upstream" ? (outgoing.get(id) ?? []).map((e) => e.to_id) : []),
        ...(direction !== "downstream" ? (incoming.get(id) ?? []).map((e) => e.from_id) : []),
      ];
      for (const n of steps)
        if (!seen.has(n)) {
          seen.set(n, d);
          next.push(n);
        }
    }
    frontier = next;
  }
  return seen;
}

async function buildGraph(
  db: DbOrTx,
  transformationId: string,
  query: z.infer<typeof graphQuery>,
): Promise<TraceabilityGraph> {
  const records = await loadChainRecords(db, transformationId);
  const edges = await loadEdges(db, transformationId);
  let ids: string[];
  if (query.rootId !== undefined) {
    const root = records.get(query.rootId);
    if (root === undefined || root.type !== query.rootType)
      throw problems.businessRule("trace_link.record_not_found", TRACE_TEXT.recordNotFound);
    ids = [...walk(edges, root.id, query.direction, query.depth).keys()];
  } else {
    const set = new Set<string>();
    for (const r of records.values()) if (r.shown) set.add(r.id);
    for (const e of edges) {
      set.add(e.from_id);
      set.add(e.to_id);
    }
    ids = [...set];
  }
  const known = ids
    .map((id) => records.get(id))
    .filter((r): r is ChainRecord => r !== undefined)
    .sort((a, b) => nodeOrder(a.type) - nodeOrder(b.type) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const truncated = known.length > TRACE_NODE_CAP;
  const kept = known.slice(0, TRACE_NODE_CAP);
  const keptIds = new Set(kept.map((r) => r.id));
  const index = indexEdges(edges);
  return {
    transformationId,
    rootType: query.rootType ?? null,
    rootId: query.rootId ?? null,
    direction: query.direction,
    depth: query.depth,
    nodes: kept.map((r) => toNode(r, transformationId, index)),
    edges: edges.filter((e) => keptIds.has(e.from_id) && keptIds.has(e.to_id)).map(toEdge),
    truncated,
  };
}

/** Runs a read model in one read-only transaction (nothing is stored; JK.10 item 2). */
export function readOnly<T>(db: ModuleDeps["db"], fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().setIsolationLevel("repeatable read").setAccessMode("read only").execute(fn);
}

// ------------------------------------------------------------------------------------------------ routes

const tParams = z.strictObject({ transformationId: z.uuid() });
const linkParams = z.strictObject({ transformationId: z.uuid(), traceLinkId: z.uuid() });
const setParams = z.strictObject({
  transformationId: z.uuid(),
  allocationTargetType: allocationTargetType,
  allocationTargetId: z.uuid(),
});
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  kind: traceLinkKind.optional(),
  recordId: z.uuid().optional(),
  includeRemoved: z.stringbool().default(false),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerTraceabilityRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: TRACE_LINK_PERMISSION }, consumes: JSON_BODY };

  app.get(`${T_BASE}/traceability`, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(graphQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return readOnly(db, (tx) => buildGraph(tx, transformationId, query));
  });

  app.get(LINKS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "trace_link",
      transformationId,
      kind: query.kind,
      recordId: query.recordId,
      includeRemoved: query.includeRemoved,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("trace_link").selectAll().where("transformation_id", "=", transformationId);
    if (!query.includeRemoved) q = q.where("status", "=", "active");
    if (query.kind !== undefined) q = q.where("link_kind", "=", query.kind);
    if (query.recordId !== undefined) {
      const rid = query.recordId;
      q = q.where((eb) => eb.or(LINK_COLUMNS.map((col) => eb(col, "=", rid))));
    }
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toTraceLink), nextCursor: page.nextCursor };
  });

  app.post(LINKS, { config: write }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, LINK_RULES, null, { atCommit: true });
      const body = parseBody(traceLinkCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
        status: 201,
        body: await createTraceLink(ctx, body),
      }));
    });
    return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/trace-links`);
  });

  app.get(LINK_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, traceLinkId } = parse(linkParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, toTraceLink(await linkOf(db, transformationId, traceLinkId)));
  });

  app.patch(LINK_ITEM, { config: write }, async (request, reply) => {
    const { transformationId, traceLinkId } = parse(linkParams, request.params, "params");
    const body = await db.transaction().execute((tx) => updateTraceLink(tx, request, transformationId, traceLinkId));
    return sendVersioned(reply, 200, body);
  });

  app.post(`${LINK_ITEM}/remove`, { config: write }, async (request, reply) => {
    const { transformationId, traceLinkId } = parse(linkParams, request.params, "params");
    const body = await db.transaction().execute((tx) => removeTraceLink(tx, request, transformationId, traceLinkId));
    return sendVersioned(reply, 200, body);
  });

  const SET = `${T_BASE}/allocation-sets/:allocationTargetType/:allocationTargetId`;
  app.get(SET, { config: read }, async (request): Promise<AllocationSet> => {
    const {
      transformationId,
      allocationTargetType: targetType,
      allocationTargetId: targetId,
    } = parse(setParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    // READ COMMITTED: the statements after the lock see every write committed by a writer that held it (§3).
    return db
      .transaction()
      .setAccessMode("read only")
      .execute(async (tx) => {
        const table = targetType === "outcome_kpi" ? "outcome_kpi" : "benefit";
        const target = await tx
          .selectFrom(table)
          .select("id")
          .where("id", "=", targetId)
          .where("transformation_id", "=", transformationId)
          .executeTakeFirst();
        if (!target) throw problems.notFound();
        await lockAllocationSet(tx, targetId);
        const members = await allocationMembers(tx, targetType, targetId);
        const totals = traceAllocationTotals(members.map((m) => m.allocationShare));
        return { targetType, targetId, members, total: totals.total, unallocatedShare: totals.unallocatedShare };
      });
  });

  return [
    `GET ${T_BASE}/traceability`,
    `GET ${LINKS}`,
    `POST ${LINKS}`,
    `GET ${LINK_ITEM}`,
    `PATCH ${LINK_ITEM}`,
    `POST ${LINK_ITEM}/remove`,
    `GET ${SET}`,
  ];
}
