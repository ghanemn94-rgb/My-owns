// Slice J web seams (T-DG4-FE-G; p4-work-split §J+K JK.7, ADR-0037): the request paths and read hooks of the six
// dashboards, the drill-down, My Work's sections and the workspace header. Query keys come from FE-A's `p4Keys`
// (api/p4.ts): `p4Keys.dashboard(kind, query)`, `p4Keys.executiveOverview(query)` and, for one transformation,
// `p4Keys.area("dashboards" | "workspace-header", tid, …)`, so `useP4Refresh(tid)` refreshes them after a mutation.
//
// Every response is a read model computed on each request (ADR-0037 §1): nothing here caches a figure beyond the
// query cache, and a refetch shows the server's current answer. Unknown, Stale and n/a are data, never a default.
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import type {
  AdoptionDashboard,
  DashboardDrilldown,
  ExecutiveOverview,
  FinanceDashboard,
  MyWork,
  ReportingPeriod,
  TransformationDashboard,
  Workstream,
  WorkspaceHeader,
  WorkstreamDashboard,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  AdoptionDashboard,
  DashboardDrilldown,
  ExecutiveOverview,
  FinanceDashboard,
  MyWork,
  ReportingPeriod,
  TransformationDashboard,
  Workstream,
  WorkspaceHeader,
  WorkstreamDashboard,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the slice J reads this task consumes (operationId in the comment). */
export const dashboardPaths = {
  overview: `${v1}/overview`, // getExecutiveOverview
  transformation: (tid: string) => `${tBase(tid)}/dashboard`, // getTransformationDashboard
  workstream: (tid: string, wsId: string) => `${tBase(tid)}/workstreams/${wsId}/dashboard`, // getWorkstreamDashboard
  finance: `${v1}/dashboards/finance`, // getFinanceDashboard
  adoption: `${v1}/dashboards/adoption`, // getAdoptionDashboard
  drilldown: `${v1}/dashboard-drilldown`, // getDashboardDrilldown
  myWork: `${v1}/me/work`, // getMyWork
  header: (tid: string) => `${tBase(tid)}/summary`, // getWorkspaceHeader
  workstreams: (tid: string) => `${tBase(tid)}/workstreams`, // listWorkstreams (BE-M3)
  periods: (orgId: string) => `${v1}/organizations/${orgId}/reporting-periods`, // listReportingPeriods (KBE-C)
};

/**
 * The dashboard filters as query parameters (ADR-0037 §4). `transformationId` is repeatable; empty values are not
 * sent (client.ts `buildUrl`). Organization-wide dashboards always carry `organizationId`.
 */
export interface DashboardQuery {
  readonly organizationId?: string | undefined;
  readonly transformationId?: readonly string[] | undefined;
  readonly ownerUserId?: string | undefined;
  readonly periodId?: string | undefined;
  readonly phase?: string | undefined;
  readonly status?: string | undefined;
}

const opts = { retry: shouldRetry, placeholderData: keepPreviousData } as const;

/**
 * A response without the member a screen reads is an error (shown as "unavailable", every element Unknown), never a
 * crash and never a guessed value. It is not retried: the same request gives the same answer.
 */
export class ResponseShapeError extends Error {}
export function expectShape<T>(body: T, member: string): T {
  if (body === null || typeof body !== "object" || !(member in body))
    throw new ResponseShapeError(`unexpected response: ${member}`);
  return body;
}
const retryUnlessShape = (n: number, e: unknown) => !(e instanceof ResponseShapeError) && shouldRetry(n, e);

/** A stable key part for a query (arrays joined), so equal filters share one cache entry. */
export function queryKeyOf(q: DashboardQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q) as [string, string | readonly string[] | undefined][]) {
    if (v === undefined || v === "") continue;
    out[k] = Array.isArray(v) ? [...(v as readonly string[])].sort().join(",") : (v as string);
  }
  return out;
}

const asQuery = (q: DashboardQuery) => ({ ...q }) as Record<string, string | readonly string[] | undefined>;

/** Executive Overview = the executive dashboard (ADR-0037 §2, §8). Disabled until the query is complete. */
export function useExecutiveOverview(q: DashboardQuery, enabled = true) {
  return useQuery({
    queryKey: p4Keys.executiveOverview(queryKeyOf(q)),
    queryFn: ({ signal }) => api.get<ExecutiveOverview>(dashboardPaths.overview, asQuery(q), signal),
    enabled: enabled && Boolean(q.organizationId),
    ...opts,
  });
}

export function useFinanceDashboard(q: DashboardQuery, enabled = true) {
  return useQuery({
    queryKey: p4Keys.dashboard("finance", queryKeyOf(q)),
    queryFn: ({ signal }) => api.get<FinanceDashboard>(dashboardPaths.finance, asQuery(q), signal),
    enabled: enabled && Boolean(q.organizationId),
    ...opts,
  });
}

export function useAdoptionDashboard(q: DashboardQuery, enabled = true) {
  return useQuery({
    queryKey: p4Keys.dashboard("adoption", queryKeyOf(q)),
    queryFn: ({ signal }) => api.get<AdoptionDashboard>(dashboardPaths.adoption, asQuery(q), signal),
    enabled: enabled && Boolean(q.organizationId),
    ...opts,
  });
}

/** The Template 10 dashboard of one transformation (owner and period filters only, per the contract). */
export function useTransformationDashboard(tid: string, q: DashboardQuery) {
  const query = { ownerUserId: q.ownerUserId, periodId: q.periodId };
  return useQuery({
    queryKey: p4Keys.area("dashboards", tid, "transformation", JSON.stringify(queryKeyOf(query))),
    queryFn: ({ signal }) =>
      api.get<TransformationDashboard>(dashboardPaths.transformation(tid), asQuery(query), signal),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useWorkstreamDashboard(tid: string, wsId: string, q: DashboardQuery) {
  const query = { ownerUserId: q.ownerUserId, periodId: q.periodId };
  return useQuery({
    queryKey: p4Keys.area("dashboards", tid, "workstream", wsId, JSON.stringify(queryKeyOf(query))),
    queryFn: ({ signal }) => api.get<WorkstreamDashboard>(dashboardPaths.workstream(tid, wsId), asQuery(query), signal),
    enabled: Boolean(tid && wsId),
    ...opts,
  });
}

/**
 * One page of a headline's drill-down. `href` is the headline's `drilldownHref` (the same filters as the dashboard,
 * ADR-0037 §5); the page cursor is appended. Only same-origin `/api/v1/dashboard-drilldown` links are followed.
 */
export function useDrilldown(href: string | null, cursor: string | null) {
  const safe = href !== null && href.startsWith(`${dashboardPaths.drilldown}?`) ? href : null;
  return useQuery({
    queryKey: p4Keys.dashboard("drilldown", { href: safe ?? "", cursor: cursor ?? "" }),
    queryFn: ({ signal }) => api.get<DashboardDrilldown>(withPage(safe!, cursor), undefined, signal),
    enabled: safe !== null,
    retry: shouldRetry,
  });
}
export const DRILLDOWN_PAGE = 25;

/** The drill-down href with the page size and cursor merged into its own query string (never a second "?"). */
export function withPage(href: string, cursor: string | null): string {
  const [path, qs = ""] = href.split("?", 2) as [string, string?];
  const params = new URLSearchParams(qs);
  params.set("limit", String(DRILLDOWN_PAGE));
  if (cursor) params.set("cursor", cursor);
  else params.delete("cursor");
  return `${path}?${params.toString()}`;
}

/** My Work's sections and upcoming deadlines (= the personal work dashboard, ADR-0037 §2, §7). */
export function useMyWorkDashboard() {
  return useQuery({
    queryKey: [...p4Keys.me, "work-dashboard"] as const,
    queryFn: async ({ signal }) =>
      expectShape(await api.get<MyWork>(dashboardPaths.myWork, undefined, signal), "sections"),
    retry: retryUnlessShape,
  });
}

/** The further pages of one My Work section (each cursor bound to the section and the user by the server). */
export function useMyWorkSectionPages(section: string, cursors: readonly string[]) {
  return useQueries({
    queries: cursors.map((cursor) => ({
      queryKey: [...p4Keys.me, "work-dashboard", section, cursor] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api.get<MyWork>(dashboardPaths.myWork, { section, cursor, limit: 50 }, signal),
      retry: shouldRetry,
    })),
  });
}

/** The workspace header's eight elements (ADR-0037 §9; REQ-S03-011). */
export function useWorkspaceHeader(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("workspace-header", tid),
    queryFn: async ({ signal }) =>
      expectShape(await api.get<WorkspaceHeader>(dashboardPaths.header(tid), undefined, signal), "gateReadiness"),
    enabled: Boolean(tid),
    retry: retryUnlessShape,
  });
}

/** The active workstreams of a transformation (for the workstream dashboard picker). */
export function useWorkstreamList(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("dashboards", tid, "workstreams"),
    queryFn: () => fetchAllPages<Workstream>(dashboardPaths.workstreams(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

/** The organization's reporting periods for the period chip (organization.read; a 403/404 hides the chip). */
export function useDashboardPeriods(orgId: string | undefined) {
  return useQuery({
    queryKey: p4Keys.dashboard("periods", { orgId: orgId ?? "" }),
    queryFn: () => fetchAllPages<ReportingPeriod>(dashboardPaths.periods(orgId!)),
    enabled: Boolean(orgId),
    retry: shouldRetry,
    staleTime: 60_000,
  });
}

/**
 * The readable transformations of one business unit (DG1 `listTransformations`, server-side unit filter), for the
 * business-unit chip: the dashboard contract has no unit parameter, so the chip narrows by these ids (at most 50).
 */
export function useBusinessUnitTransformations(orgId: string, businessUnitId: string) {
  return useQuery({
    queryKey: p4Keys.dashboard("unit-transformations", { orgId, businessUnitId }),
    queryFn: ({ signal }) =>
      api.get<{ items: { id: string }[]; nextCursor: string | null }>(
        "/api/v1/transformations",
        { organizationId: orgId, businessUnitId, sort: "code:asc", limit: 51 },
        signal,
      ),
    enabled: Boolean(orgId && businessUnitId),
    retry: shouldRetry,
  });
}
