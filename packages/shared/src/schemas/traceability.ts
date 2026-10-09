// P4 slice K mirrors of BE-M (backend-workflow-engineer, T-DG4-BE-M; ADR-0038 §1-§6, §8, §11, §12; p4-work-split
// §J+K JK.1): trace links with their contribution statement and optional share, allocation sets into an outcome KPI or
// a benefit, the traceability graph, the orphan report and the downstream impact of a record.
//
// - Shares are decimal fractions (0.6 = 60 %), numeric(7,6), 0 < share <= 1, never floats (S-5, ADR-0038 §11). Below a
//   total of 1 the rest is shown as `unallocatedShare` (1 - total), never as "0 %".
// - Free text goes through the shared `freeText` rule (S-1).
// - Nothing here grants or records any business approval; nothing reads or writes the engineering gates DG0-DG7.
import { z } from "zod";
import { compareDecimal, sumDecimals, toColumnString } from "../value.ts";
import { SHARE_COLUMN, percentText } from "./benefits.ts";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { columnDecimal, decimal } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

// ------------------------------------------------------------------------------------------------ vocabularies

/** The eight node types of the chain (B0070), in chain order: every edge points forward in this order. */
export const TRACE_NODE_TYPES = [
  "diagnostic_finding",
  "tom_gap",
  "initiative",
  "deliverable",
  "capability",
  "outcome",
  "outcome_kpi",
  "benefit",
] as const;
export const traceNodeType = z.enum(TRACE_NODE_TYPES);
export type TraceNodeType = z.infer<typeof traceNodeType>;

/** The impact roots: the eight node types plus a KPI definition (walked from each of its active outcome KPIs). */
export const IMPACT_RECORD_TYPES = [...TRACE_NODE_TYPES, "kpi_definition"] as const;
export const impactRecordType = z.enum(IMPACT_RECORD_TYPES);
export type ImpactRecordType = z.infer<typeof impactRecordType>;

export const TRACE_LINK_KINDS = ["issue_gap", "deliverable_capability", "capability_kpi", "kpi_benefit"] as const;
export const traceLinkKind = z.enum(TRACE_LINK_KINDS);
export type TraceLinkKind = z.infer<typeof traceLinkKind>;

/** The two records each trace-link kind joins (ADR-0038 §1, §2): from -> to. */
export const TRACE_LINK_ENDS: Readonly<Record<TraceLinkKind, { from: TraceNodeType; to: TraceNodeType }>> = {
  issue_gap: { from: "diagnostic_finding", to: "tom_gap" },
  deliverable_capability: { from: "deliverable", to: "capability" },
  capability_kpi: { from: "capability", to: "outcome_kpi" },
  kpi_benefit: { from: "outcome_kpi", to: "benefit" },
};

/** Kinds that may carry a share: links into a value-bearing record (an outcome KPI or a benefit; TL05). */
export const SHARE_LINK_KINDS: ReadonlySet<TraceLinkKind> = new Set(["capability_kpi", "kpi_benefit"]);

export const TRACE_EDGE_KINDS = [
  "issue_gap",
  "gap_initiative",
  "initiative_deliverable",
  "deliverable_capability",
  "capability_kpi",
  "initiative_kpi",
  "outcome_kpi_of",
  "kpi_benefit",
  "kpi_benefit_measure",
  "initiative_benefit",
] as const;
export const traceEdgeKind = z.enum(TRACE_EDGE_KINDS);

export const TRACE_DIRECTIONS = ["upstream", "downstream", "both"] as const;
export const traceDirection = z.enum(TRACE_DIRECTIONS);
export type TraceDirection = z.infer<typeof traceDirection>;

export const ALLOCATION_TARGET_TYPES = ["outcome_kpi", "benefit"] as const;
export const allocationTargetType = z.enum(ALLOCATION_TARGET_TYPES);
export type AllocationTargetType = z.infer<typeof allocationTargetType>;

export const T10_AREA_CODES_K = [
  "outcomes",
  "value",
  "portfolio",
  "dependencies",
  "decisions",
  "people_adoption",
] as const;
export const IMPACT_DASHBOARDS = [
  "executive",
  "transformation",
  "workstream",
  "finance",
  "adoption",
  "personal",
] as const;

// ------------------------------------------------------------------------------------------------ shares (pure)

/** A request share: a decimal fraction that fits numeric(7,6) without rounding and lies in (0, 1]. */
export const traceShareDecimal = columnDecimal(SHARE_COLUMN).refine(
  (v) => compareDecimal(v, "0") > 0 && compareDecimal(v, "1") <= 0,
  "validation.share_range",
);

/**
 * The decimal total of an allocation set and its unallocated rest (1 - total), both as numeric(7,6) strings; a total
 * above 1 keeps its exact value and the rest is "0.000000". Pure; decimal arithmetic only (no floats).
 */
export function traceAllocationTotals(shares: readonly string[]): {
  readonly total: string;
  readonly unallocatedShare: string;
  readonly overHundred: boolean;
} {
  const sum = sumDecimals(shares);
  const overHundred = compareDecimal(sum, "1") > 0;
  const rest = sumDecimals(["1", sum.startsWith("-") ? sum.slice(1) : `-${sum}`]);
  return {
    total: toColumnString(sum, SHARE_COLUMN),
    unallocatedShare: overHundred ? "0.000000" : toColumnString(rest, SHARE_COLUMN),
    overHundred,
  };
}

/** ADR-0038 §12 (exact): the refusal text of a set that would exceed 100 %, e.g. "…would total 110%, more than 100%.". */
export function allocationExceedsText(total: string): string {
  return `The allocations into this record would total ${percentText(total)}%, more than 100%.`;
}

// ------------------------------------------------------------------------------------------------ trace links

export const traceLinkCreate = z.strictObject({
  linkKind: traceLinkKind,
  fromId: uuid,
  toId: uuid,
  contributionStatement: freeText(1, 2000),
  allocationShare: traceShareDecimal.nullable().optional(),
  allocationBasis: freeText(1, 1000).nullable().optional(),
});
export type TraceLinkCreate = z.infer<typeof traceLinkCreate>;

export const traceLinkUpdate = z
  .strictObject({
    contributionStatement: freeText(1, 2000).optional(),
    allocationShare: traceShareDecimal.nullable().optional(),
    allocationBasis: freeText(1, 1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type TraceLinkUpdate = z.infer<typeof traceLinkUpdate>;

export const traceLink = z.strictObject({
  id: uuid,
  transformationId: uuid,
  linkKind: traceLinkKind,
  diagnosticFindingId: nullableUuid,
  tomGapId: nullableUuid,
  deliverableId: nullableUuid,
  capabilityId: nullableUuid,
  outcomeKpiId: nullableUuid,
  benefitId: nullableUuid,
  contributionStatement: z.string(),
  allocationShare: decimal.nullable(),
  allocationBasis: z.string().nullable(),
  status: z.enum(["active", "removed"]),
  removedAt: nullableTimestamp,
  removedBy: nullableUuid,
  removeReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type TraceLink = z.infer<typeof traceLink>;
export const traceLinkPage = z.strictObject({ items: z.array(traceLink), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ allocation sets

export const allocationSetMember = z.strictObject({
  linkTable: z.enum(["trace_link", "initiative_outcome_contribution"]),
  linkId: uuid,
  fromType: traceNodeType,
  fromId: uuid,
  allocationShare: decimal,
  allocationBasis: z.string().nullable(),
  version,
});
export type AllocationSetMember = z.infer<typeof allocationSetMember>;

export const allocationSet = z.strictObject({
  targetType: allocationTargetType,
  targetId: uuid,
  members: z.array(allocationSetMember),
  total: decimal,
  unallocatedShare: decimal,
});
export type AllocationSet = z.infer<typeof allocationSet>;

export const contributionAllocationUpdate = z.strictObject({
  allocationShare: traceShareDecimal.nullable(),
  allocationBasis: freeText(1, 1000).nullable(),
});
export type ContributionAllocationUpdate = z.infer<typeof contributionAllocationUpdate>;

export const contributionAllocation = z.strictObject({
  linkId: uuid,
  initiativeId: uuid,
  outcomeId: uuid,
  outcomeKpiId: nullableUuid,
  allocationShare: decimal.nullable(),
  allocationBasis: z.string().nullable(),
  version,
});
export type ContributionAllocation = z.infer<typeof contributionAllocation>;

// ------------------------------------------------------------------------------------------------ graph

export const traceNode = z.strictObject({
  recordType: traceNodeType,
  recordId: uuid,
  code: z.string().nullable(),
  label: z.string().nullable(),
  status: z.string().nullable(),
  href: z.string(),
  orphan: z.strictObject({ upstream: z.boolean(), downstream: z.boolean() }),
  allocation: z.strictObject({ total: decimal, unallocatedShare: decimal }).nullable(),
});
export type TraceNode = z.infer<typeof traceNode>;

export const traceEdge = z.strictObject({
  edgeKind: traceEdgeKind,
  fromType: z.string(),
  fromId: uuid,
  toType: z.string(),
  toId: uuid,
  linkTable: z.string(),
  linkId: uuid,
  contributionStatement: z.string().nullable(),
  allocationShare: decimal.nullable(),
});
export type TraceEdge = z.infer<typeof traceEdge>;

export const traceabilityGraph = z.strictObject({
  transformationId: uuid,
  rootType: traceNodeType.nullable(),
  rootId: nullableUuid,
  direction: traceDirection,
  depth: z.number().int().min(1).max(8),
  nodes: z.array(traceNode),
  edges: z.array(traceEdge),
  truncated: z.boolean(),
});
export type TraceabilityGraph = z.infer<typeof traceabilityGraph>;

// ------------------------------------------------------------------------------------------------ orphans

export const orphanItem = z.strictObject({
  recordType: traceNodeType,
  recordId: uuid,
  code: z.string().nullable(),
  label: z.string().nullable(),
  href: z.string(),
  missing: traceDirection,
  expected: z.array(z.string()),
});
export type OrphanItem = z.infer<typeof orphanItem>;
export const orphanReportPage = z.strictObject({ items: z.array(orphanItem), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ impact

export const impactRecord = z.strictObject({
  recordType: traceNodeType,
  recordId: uuid,
  code: z.string().nullable(),
  label: z.string().nullable(),
  href: z.string(),
  distance: z.number().int().min(1).max(8),
  edgeKinds: z.array(z.string()),
  valueAffected: z.boolean(),
});
export type ImpactRecord = z.infer<typeof impactRecord>;

export const impactDashboardRef = z.strictObject({
  dashboard: z.enum(IMPACT_DASHBOARDS),
  areaCode: z.enum(T10_AREA_CODES_K).nullable(),
  transformationId: nullableUuid,
  workstreamId: nullableUuid,
});
export type ImpactDashboardRef = z.infer<typeof impactDashboardRef>;

export const recordImpact = z.strictObject({
  recordType: z.string(),
  recordId: uuid,
  records: z.array(impactRecord),
  dashboards: z.array(impactDashboardRef),
  hiddenCount: z.number().int().min(0),
  nextCursor: z.string().nullable(),
});
export type RecordImpact = z.infer<typeof recordImpact>;

// ------------------------------------------------------------------------------------------------ one source of truth

/** ADR-0038 §8: an initiative named by join (`BenefitRegisterRow.initiatives[]`); never a stored copy of its name. */
export const initiativeRef = z.strictObject({ id: uuid, code: z.string(), name: z.string() });
export type InitiativeRef = z.infer<typeof initiativeRef>;
