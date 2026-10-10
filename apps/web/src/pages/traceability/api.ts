// Slice K web seams (T-DG4-FE-G2; p4-work-split §J+K JK.7, ADR-0038) and the dashboard RAG policy (ADR-0037 §3, §10;
// ARCH-R1 A1): the request paths and read hooks of the traceability graph, the orphan report, downstream impact, trace
// links and allocation sets, Modular entry (missing links, inherited records), portfolios and workstreams.
//
// - Query keys of one transformation start with ["p4", "traceability", tid] (FE-A's `p4Keys.area`), so
//   `useP4Refresh(tid)` refreshes every one of them after a mutation; organization-level keys (portfolios, the RAG
//   policy) start with ["p4", "org", orgId, …] and are refreshed with `useP4KeyRefresh`.
// - Every read here is a live read model computed on each request (ADR-0038 §4–§7; nothing is stored). Unknown stays
//   data: a null share is "unallocated", never 0 %.
// - Writes are sent by the screens with `api.send` inside a session guard; If-Match comes from the record's `version`
//   (the RAG policy's first save sends If-Match "0", ARCH-R1 A1).
import { useQuery } from "@tanstack/react-query";
import type {
  AllocationSet,
  AllocationTargetType,
  Baseline,
  DashboardRagPolicy,
  Evidence,
  GateDispensation,
  ImpactRecordType,
  InheritedRecord,
  Initiative,
  KpiDefinition,
  MissingLinks,
  OrphanItem,
  Portfolio,
  PortfolioTransformation,
  RecordImpact,
  TraceabilityGraph,
  TraceDirection,
  TraceLink,
  TraceNodeType,
  Workstream,
  WorkstreamInitiative,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  AllocationSet,
  AllocationTargetType,
  Baseline,
  DashboardRagPolicy,
  Evidence,
  GateDispensation,
  ImpactRecordType,
  InheritedRecord,
  Initiative,
  KpiDefinition,
  MissingLinks,
  OrphanItem,
  Portfolio,
  PortfolioTransformation,
  RecordImpact,
  TraceabilityGraph,
  TraceDirection,
  TraceLink,
  TraceNodeType,
  Workstream,
  WorkstreamInitiative,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The request paths this task consumes (operationId in the comment). */
export const tracePaths = {
  graph: (tid: string) => `${tBase(tid)}/traceability`, // getTraceability
  orphans: (tid: string) => `${tBase(tid)}/orphans`, // getOrphanReport
  impact: (type: string, id: string) => `${v1}/records/${type}/${id}/impact`, // getRecordImpact
  links: (tid: string) => `${tBase(tid)}/trace-links`, // listTraceLinks, createTraceLink
  link: (tid: string, id: string) => `${tBase(tid)}/trace-links/${id}`, // getTraceLink, updateTraceLink
  removeLink: (tid: string, id: string) => `${tBase(tid)}/trace-links/${id}/remove`, // removeTraceLink
  allocationSet: (tid: string, type: string, id: string) => `${tBase(tid)}/allocation-sets/${type}/${id}`, // getAllocationSet
  contributionAllocation: (initiativeId: string, linkId: string) =>
    `${v1}/initiatives/${initiativeId}/outcome-contributions/${linkId}/allocation`, // setOutcomeContributionAllocation
  missingLinks: (tid: string) => `${tBase(tid)}/missing-links`, // getMissingLinks
  inherited: (tid: string) => `${tBase(tid)}/inherited-records`, // listInheritedRecords, createInheritedRecord
  inheritedOne: (tid: string, id: string) => `${tBase(tid)}/inherited-records/${id}`, // getInheritedRecord
  withdrawInherited: (tid: string, id: string) => `${tBase(tid)}/inherited-records/${id}/withdraw`, // withdrawInheritedRecord
  dispensations: (tid: string) => `${tBase(tid)}/gate-dispensations`, // listGateDispensations (DG3)
  evidence: (tid: string) => `${tBase(tid)}/evidence`, // DG2 evidence register
  baselines: (tid: string) => `${tBase(tid)}/baselines`, // DG2 baselines
  kpiDefinitions: (tid: string) => `${tBase(tid)}/kpi-definitions`, // DG2 KPI definitions
  initiatives: `${v1}/initiatives`, // listInitiatives (DG3; ?transformationId=)
  portfolios: (orgId: string) => `${v1}/organizations/${orgId}/portfolios`, // listPortfolios, createPortfolio
  portfolio: (id: string) => `${v1}/portfolios/${id}`, // getPortfolio, updatePortfolio
  portfolioTransformations: (id: string) => `${v1}/portfolios/${id}/transformations`, // list/addPortfolioTransformation
  removePortfolioTransformation: (id: string, memberId: string) =>
    `${v1}/portfolios/${id}/transformations/${memberId}/remove`, // removePortfolioTransformation
  workstreams: (tid: string) => `${tBase(tid)}/workstreams`, // listWorkstreams, createWorkstream
  workstream: (tid: string, id: string) => `${tBase(tid)}/workstreams/${id}`, // getWorkstream, updateWorkstream
  workstreamInitiatives: (tid: string, id: string) => `${tBase(tid)}/workstreams/${id}/initiatives`, // list/addWorkstreamInitiative
  removeWorkstreamInitiative: (tid: string, id: string, memberId: string) =>
    `${tBase(tid)}/workstreams/${id}/initiatives/${memberId}/remove`, // removeWorkstreamInitiative
  ragPolicy: (orgId: string) => `${v1}/organizations/${orgId}/dashboard-rag-policy`, // get/putDashboardRagPolicy
  transformations: `${v1}/transformations`, // listTransformations (DG1, scope-filtered)
};

const key = (tid: string, ...rest: (string | number)[]) => p4Keys.area("traceability", tid, ...rest);
const orgKey = (orgId: string, ...rest: string[]) => ["p4", "org", orgId, ...rest] as const;

// ------------------------------------------------------------------------------------------------ traceability

export interface GraphQuery {
  readonly rootType?: TraceNodeType | undefined;
  readonly rootId?: string | undefined;
  readonly direction?: TraceDirection | undefined;
  readonly depth?: number | undefined;
}

/** The chain graph of one transformation (whole graph without a root; ADR-0038 §4). */
export function useTraceGraph(tid: string, q: GraphQuery = {}) {
  const query: Record<string, string> = {};
  if (q.rootType && q.rootId) {
    query["rootType"] = q.rootType;
    query["rootId"] = q.rootId;
  }
  if (q.direction) query["direction"] = q.direction;
  if (q.depth) query["depth"] = String(q.depth);
  return useQuery({
    queryKey: key(tid, "graph", JSON.stringify(query)),
    queryFn: ({ signal }) => api.get<TraceabilityGraph>(tracePaths.graph(tid), query, signal),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

/** One page of the orphan report (server-side filters and cursor). */
export function useOrphans(tid: string, filters: { recordType: string; missing: string }, cursor: string | null) {
  const query: Record<string, string> = { limit: "50" };
  if (filters.recordType) query["recordType"] = filters.recordType;
  if (filters.missing) query["missing"] = filters.missing;
  if (cursor) query["cursor"] = cursor;
  return useQuery({
    queryKey: key(tid, "orphans", JSON.stringify(query)),
    queryFn: ({ signal }) =>
      api.get<{ items: OrphanItem[]; nextCursor: string | null }>(tracePaths.orphans(tid), query, signal),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

/** Downstream impact of one record (live; unreadable records are counted in `hiddenCount`, never listed). */
export function useImpact(tid: string, root: { type: ImpactRecordType; id: string } | null, cursor: string | null) {
  return useQuery({
    queryKey: key(tid, "impact", root?.type ?? "", root?.id ?? "", cursor ?? ""),
    queryFn: ({ signal }) =>
      api.get<RecordImpact>(
        tracePaths.impact(root!.type, root!.id),
        { limit: "50", ...(cursor ? { cursor } : {}) },
        signal,
      ),
    enabled: Boolean(tid && root),
    retry: shouldRetry,
  });
}

export function useTraceLinks(tid: string, includeRemoved: boolean) {
  return useQuery({
    queryKey: key(tid, "links", includeRemoved ? "all" : "active"),
    queryFn: () => fetchAllPages<TraceLink>(tracePaths.links(tid), includeRemoved ? { includeRemoved: "true" } : {}),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useAllocationSet(tid: string, target: { type: AllocationTargetType; id: string } | null) {
  return useQuery({
    queryKey: key(tid, "allocation", target?.type ?? "", target?.id ?? ""),
    queryFn: ({ signal }) =>
      api.get<AllocationSet>(tracePaths.allocationSet(tid, target!.type, target!.id), undefined, signal),
    enabled: Boolean(tid && target),
    retry: shouldRetry,
  });
}

/** KPI definitions of the transformation (an impact root: changing a KPI target, REQ-S03-006). */
export function useKpiDefinitionsForImpact(tid: string) {
  return useQuery({
    queryKey: key(tid, "kpi-definitions"),
    queryFn: () => fetchAllPages<KpiDefinition>(tracePaths.kpiDefinitions(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

// ------------------------------------------------------------------------------------------------ Modular entry

export function useMissingLinks(tid: string) {
  return useQuery({
    queryKey: key(tid, "missing-links"),
    queryFn: ({ signal }) => api.get<MissingLinks>(tracePaths.missingLinks(tid), undefined, signal),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useInheritedRecords(tid: string, includeRemoved: boolean) {
  return useQuery({
    queryKey: key(tid, "inherited", includeRemoved ? "all" : "active"),
    queryFn: () =>
      fetchAllPages<InheritedRecord>(tracePaths.inherited(tid), includeRemoved ? { includeRemoved: "true" } : {}),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

/** `getInheritedRecord` (BE-R3): one inherited evidence item or baseline, active or withdrawn. */
export function useInheritedRecord(tid: string, id: string | null) {
  return useQuery({
    queryKey: key(tid, "inherited-one", id ?? ""),
    queryFn: ({ signal }) => api.get<InheritedRecord>(tracePaths.inheritedOne(tid, id!), undefined, signal),
    enabled: Boolean(tid && id),
    retry: shouldRetry,
  });
}

/** The DG3 gate dispensations, read to show a Modular-links waiver (G3, no initiative) when one is in force. */
export function useDispensations(tid: string) {
  return useQuery({
    queryKey: key(tid, "dispensations"),
    queryFn: () => fetchAllPages<GateDispensation>(tracePaths.dispensations(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useEvidenceOptions(tid: string, enabled: boolean) {
  return useQuery({
    queryKey: key(tid, "evidence-options"),
    queryFn: () => fetchAllPages<Evidence>(tracePaths.evidence(tid)),
    enabled: Boolean(tid) && enabled,
    retry: shouldRetry,
  });
}

export function useBaselineOptions(tid: string, enabled: boolean) {
  return useQuery({
    queryKey: key(tid, "baseline-options"),
    queryFn: () => fetchAllPages<Baseline>(tracePaths.baselines(tid)),
    enabled: Boolean(tid) && enabled,
    retry: shouldRetry,
  });
}

// ------------------------------------------------------------------------------------------------ workstreams

export function useWorkstreams(tid: string, includeArchived: boolean) {
  return useQuery({
    queryKey: key(tid, "workstreams", includeArchived ? "all" : "active"),
    queryFn: () =>
      fetchAllPages<Workstream>(tracePaths.workstreams(tid), includeArchived ? { includeArchived: "true" } : {}),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useWorkstream(tid: string, id: string) {
  return useQuery({
    queryKey: key(tid, "workstream", id),
    queryFn: ({ signal }) => api.get<Workstream>(tracePaths.workstream(tid, id), undefined, signal),
    enabled: Boolean(tid && id),
    retry: shouldRetry,
  });
}

export function useWorkstreamInitiatives(tid: string, id: string, includeRemoved: boolean) {
  return useQuery({
    queryKey: key(tid, "workstream-initiatives", id, includeRemoved ? "all" : "active"),
    queryFn: () =>
      fetchAllPages<WorkstreamInitiative>(
        tracePaths.workstreamInitiatives(tid, id),
        includeRemoved ? { includeRemoved: "true" } : {},
      ),
    enabled: Boolean(tid && id),
    retry: shouldRetry,
  });
}

export function useInitiativeOptions(tid: string, enabled = true) {
  return useQuery({
    queryKey: key(tid, "initiative-options"),
    queryFn: () => fetchAllPages<Initiative>(tracePaths.initiatives, { transformationId: tid }),
    enabled: Boolean(tid) && enabled,
    retry: shouldRetry,
  });
}

// ------------------------------------------------------------------------------------------------ portfolios

export const portfolioKeys = {
  list: (orgId: string) => orgKey(orgId, "portfolios"),
};

export function usePortfolios(orgId: string, includeArchived: boolean) {
  return useQuery({
    queryKey: [...portfolioKeys.list(orgId), includeArchived ? "all" : "active"],
    queryFn: () =>
      fetchAllPages<Portfolio>(tracePaths.portfolios(orgId), includeArchived ? { includeArchived: "true" } : {}),
    enabled: Boolean(orgId),
    retry: shouldRetry,
  });
}

export function usePortfolio(orgId: string, id: string) {
  return useQuery({
    queryKey: [...portfolioKeys.list(orgId), "one", id],
    queryFn: ({ signal }) => api.get<Portfolio>(tracePaths.portfolio(id), undefined, signal),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}

export function usePortfolioTransformations(orgId: string, id: string, includeRemoved: boolean) {
  return useQuery({
    queryKey: [...portfolioKeys.list(orgId), "members", id, includeRemoved ? "all" : "active"],
    queryFn: () =>
      fetchAllPages<PortfolioTransformation>(
        tracePaths.portfolioTransformations(id),
        includeRemoved ? { includeRemoved: "true" } : {},
      ),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}

/** The transformations the caller may read in the organization (DG1 `listTransformations`, scope-filtered). */
export function useReadableTransformations(orgId: string, enabled = true) {
  return useQuery({
    queryKey: orgKey(orgId, "readable-transformations"),
    queryFn: () =>
      fetchAllPages<{ id: string; code: string; name: string; businessUnitId: string | null }>(
        tracePaths.transformations,
        { organizationId: orgId, sort: "code:asc" },
      ),
    enabled: Boolean(orgId) && enabled,
    retry: shouldRetry,
    staleTime: 30_000,
  });
}

// ------------------------------------------------------------------------------------------------ RAG policy

export const ragPolicyKey = (orgId: string) => orgKey(orgId, "dashboard-rag-policy");

/** The organization's dashboard RAG policy; version 0 (`ETag: "0"`) while only the defaults exist (ARCH-R1 A1). */
export function useRagPolicy(orgId: string) {
  return useQuery({
    queryKey: ragPolicyKey(orgId),
    queryFn: ({ signal }) => api.get<DashboardRagPolicy>(tracePaths.ragPolicy(orgId), undefined, signal),
    enabled: Boolean(orgId),
    retry: shouldRetry,
  });
}
