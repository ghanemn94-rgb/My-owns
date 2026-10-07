// Server state through TanStack Query (ADR-0009). One query key family per resource; mutations invalidate them.
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { PAGINATION } from "@mth/shared";
import { ApiError, api, apiRequest, markSessionActive, setCsrfToken } from "./client.ts";
import type {
  AuditEvent,
  CharterVersion,
  CharterView,
  Decision,
  GateSubmission,
  GateSubmissionView,
  GateView,
  JourneyPainPoint,
  MethodologyCatalogue,
  NorthStar,
  RoleAccountability,
  TeamAssignment,
  TomCanvasCellView,
  TomWorkshopItem,
  BusinessUnit,
  Me,
  Organization,
  Page,
  PermissionEntry,
  Role,
  RoleAssignment,
  Transformation,
  TransformationSort,
  User,
} from "./types.ts";

export const keys = {
  me: ["me"] as const,
  organizations: ["organizations"] as const,
  organization: (id: string) => ["organizations", id] as const,
  businessUnits: (orgId: string) => ["business-units", orgId] as const,
  businessUnit: (id: string) => ["business-unit", id] as const,
  users: (params: object) => ["users", params] as const,
  user: (id: string) => ["user", id] as const,
  roles: ["roles"] as const,
  permissions: ["permissions"] as const,
  assignments: (params: object) => ["role-assignments", params] as const,
  transformations: (params: object) => ["transformations", params] as const,
  transformation: (id: string) => ["transformation", id] as const,
  audit: (id: string, cursor: string | null) => ["transformation-audit", id, cursor] as const,
};

/** No retry for 4xx (they will not change by retrying); two retries for network/5xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 2;
}

// ------------------------------------------------------------------------------------------------ session
/**
 * GET /me. A success makes the session phase "active"; a 401 while it was active is a session end like any other
 * request's (apps/web/src/api/client.ts), and a 401 with no session yet is just "not signed in".
 */
export async function fetchMe(): Promise<Me> {
  const me = (await apiRequest<Me>("/api/v1/me")).data;
  setCsrfToken(me.csrfToken);
  markSessionActive();
  return me;
}

export function useMeQuery(options: { enabled?: boolean; refetchOnMount?: boolean | "always" } = {}) {
  return useQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 60_000, retry: shouldRetry, ...options });
}

// ------------------------------------------------------------------------------------------------ organizations
export function useOrganizations() {
  return useQuery({
    queryKey: keys.organizations,
    queryFn: () => fetchAllPages<Organization>("/api/v1/organizations"),
  });
}
export function useOrganization(id: string | undefined) {
  return useQuery({
    queryKey: keys.organization(id ?? ""),
    queryFn: () => api.get<Organization>(`/api/v1/organizations/${id}`),
    enabled: Boolean(id),
  });
}

/** Fetches every page of a small catalogue (organizations, business units): bounded to 20 pages of 100. */
export async function fetchAllPages<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const page: Page<T> = await api.get<Page<T>>(path, {
      ...query,
      limit: PAGINATION.maxLimit,
      ...(cursor ? { cursor } : {}),
    });
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

export function useBusinessUnits(orgId: string | undefined) {
  return useQuery({
    queryKey: keys.businessUnits(orgId ?? ""),
    queryFn: () => fetchAllPages<BusinessUnit>(`/api/v1/organizations/${orgId}/business-units`),
    enabled: Boolean(orgId),
    staleTime: 60_000,
  });
}
export function useBusinessUnit(id: string | undefined) {
  return useQuery({
    queryKey: keys.businessUnit(id ?? ""),
    queryFn: () => api.get<BusinessUnit>(`/api/v1/business-units/${id}`),
    enabled: Boolean(id),
  });
}

// ------------------------------------------------------------------------------------------------ users & access
export interface UserListParams {
  readonly organizationId: string;
  readonly q?: string;
  readonly status?: "active" | "disabled";
  readonly cursor?: string;
  readonly limit?: number;
}
export function useUsers(params: UserListParams | null) {
  return useQuery({
    queryKey: keys.users(params ?? {}),
    queryFn: () => api.get<Page<User>>("/api/v1/users", { ...params }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
  });
}
/** All users of an organization, for pickers and name lookups (only when the caller holds user.read). */
export function useAllUsers(orgId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["users-all", orgId],
    queryFn: () => fetchAllPages<User>("/api/v1/users", { organizationId: orgId ?? "" }),
    enabled: Boolean(orgId) && enabled,
    staleTime: 60_000,
  });
}
export function useUser(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.user(id ?? ""),
    queryFn: () => api.get<User>(`/api/v1/users/${id}`),
    enabled: Boolean(id),
    retry: shouldRetry,
    staleTime: 60_000,
  });
}
export function useRoles(enabled = true) {
  return useQuery({
    queryKey: keys.roles,
    queryFn: async () => (await api.get<{ items: Role[] }>("/api/v1/roles")).items,
    enabled,
    staleTime: 300_000,
  });
}
export function usePermissionCatalogue(enabled = true) {
  return useQuery({
    queryKey: keys.permissions,
    queryFn: async () => (await api.get<{ items: PermissionEntry[] }>("/api/v1/permissions")).items,
    enabled,
    staleTime: 300_000,
  });
}
export interface AssignmentListParams {
  readonly organizationId: string;
  readonly userId?: string;
  readonly scopeType?: string;
  readonly scopeId?: string;
  readonly includeRevoked?: boolean;
  readonly cursor?: string;
  readonly limit?: number;
}
export function useAssignments(params: AssignmentListParams | null) {
  return useQuery({
    queryKey: keys.assignments(params ?? {}),
    queryFn: () => api.get<Page<RoleAssignment>>("/api/v1/role-assignments", { ...params }),
    enabled: params !== null,
    placeholderData: keepPreviousData,
  });
}

// ------------------------------------------------------------------------------------------------ transformations
export interface TransformationListParams {
  readonly organizationId?: string;
  readonly businessUnitId?: string;
  readonly status?: readonly string[];
  readonly mode?: string;
  readonly phase?: string;
  readonly q?: string;
  readonly includeArchived?: boolean;
  readonly sort: TransformationSort;
  readonly cursor?: string;
  readonly limit: number;
}
export function useTransformations(params: TransformationListParams) {
  return useQuery({
    queryKey: keys.transformations(params),
    queryFn: ({ signal }) =>
      api.get<Page<Transformation>>(
        "/api/v1/transformations",
        { ...params, includeArchived: params.includeArchived ? true : undefined },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}
export function useTransformation(id: string | undefined) {
  return useQuery({
    queryKey: keys.transformation(id ?? ""),
    queryFn: () => api.get<Transformation>(`/api/v1/transformations/${id}`),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useTransformationAudit(id: string, cursor: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keys.audit(id, cursor),
    queryFn: () =>
      api.get<Page<AuditEvent>>(`/api/v1/transformations/${id}/audit`, { limit: 10, ...(cursor ? { cursor } : {}) }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useInvalidate(): QueryClient {
  return useQueryClient();
}

// ------------------------------------------------------------------------------------------------ P2 (DG2)
// Every P2 query key starts with ["p2", transformationId], so one invalidation after a mutation refreshes every
// register of that transformation, including the LIVE gate readiness that depends on all of them.

export const p2Keys = {
  all: (tid: string) => ["p2", tid] as const,
  methodology: (tid: string) => ["p2", tid, "methodology"] as const,
  register: (tid: string, resource: string, query: Record<string, string>) => ["p2", tid, resource, query] as const,
  charter: (tid: string) => ["p2", tid, "charter"] as const,
  charterVersions: (tid: string) => ["p2", tid, "charter-versions"] as const,
  northStar: (tid: string) => ["p2", tid, "north-star"] as const,
  northStarHistory: (tid: string) => ["p2", tid, "north-star-history"] as const,
  canvas: (tid: string) => ["p2", tid, "tom-canvas"] as const,
  decisions: (tid: string, kind: string) => ["p2", tid, "decisions", kind] as const,
  gates: (tid: string) => ["p2", tid, "gates"] as const,
  gate: (tid: string, code: string) => ["p2", tid, "gate", code] as const,
  gateSubmissions: (tid: string, code: string) => ["p2", tid, "gate-submissions", code] as const,
  gateSubmission: (tid: string, code: string, no: number) => ["p2", tid, "gate-submission", code, no] as const,
  team: (tid: string) => ["p2", tid, "team"] as const,
  roleAccountabilities: ["role-accountabilities"] as const,
};

const base = (tid: string) => `/api/v1/transformations/${tid}`;

/** A 404 whose code says "not created yet" is an empty state (null); any other error stays an error. */
async function orNull<T>(load: () => Promise<T>, notFoundCode: string): Promise<T | null> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === notFoundCode) return null;
    throw e;
  }
}

export function useMethodology(tid: string) {
  return useQuery({
    queryKey: p2Keys.methodology(tid),
    queryFn: () => api.get<MethodologyCatalogue>(`${base(tid)}/methodology`),
    staleTime: 300_000,
    retry: shouldRetry,
  });
}

/**
 * A whole P2 register of one transformation (bounded: 20 pages of 100). The registers are small per transformation;
 * the screens sort, filter and paginate them client-side.
 */
export function useRegister<T>(tid: string, resource: string, query: Record<string, string> = {}, enabled = true) {
  return useQuery({
    queryKey: p2Keys.register(tid, resource, query),
    queryFn: () => fetchAllPages<T>(`${base(tid)}/${resource}`, query),
    enabled: Boolean(tid) && enabled,
    retry: shouldRetry,
  });
}

export function useCharter(tid: string) {
  return useQuery({
    queryKey: p2Keys.charter(tid),
    queryFn: () => orNull(() => api.get<CharterView>(`${base(tid)}/charter`), "charter_not_found"),
    retry: shouldRetry,
  });
}

export function useCharterVersions(tid: string, enabled = true) {
  return useQuery({
    queryKey: p2Keys.charterVersions(tid),
    queryFn: () => fetchAllPages<CharterVersion>(`${base(tid)}/charter/versions`),
    enabled,
    retry: shouldRetry,
  });
}

export function useNorthStar(tid: string) {
  return useQuery({
    queryKey: p2Keys.northStar(tid),
    queryFn: () => orNull(() => api.get<NorthStar>(`${base(tid)}/north-star`), "north_star_not_found"),
    retry: shouldRetry,
  });
}

export function useNorthStarHistory(tid: string, enabled = true) {
  return useQuery({
    queryKey: p2Keys.northStarHistory(tid),
    queryFn: () => fetchAllPages<NorthStar>(`${base(tid)}/north-star/history`),
    enabled,
    retry: shouldRetry,
  });
}

export function useTomCanvas(tid: string) {
  return useQuery({
    queryKey: p2Keys.canvas(tid),
    queryFn: () => api.get<{ cells: TomCanvasCellView[] }>(`${base(tid)}/tom-canvas`),
    retry: shouldRetry,
  });
}

/** The canonical decision register filtered by kind (`design` = T04 Design Decision Log). */
export function useDecisions(tid: string, kind: "design" | "gate" | "executive") {
  return useQuery({
    queryKey: p2Keys.decisions(tid, kind),
    queryFn: () => fetchAllPages<Decision>("/api/v1/decisions", { transformationId: tid, kind }),
    retry: shouldRetry,
  });
}

export function useGates(tid: string) {
  return useQuery({
    queryKey: p2Keys.gates(tid),
    queryFn: () => api.get<{ items: GateView[] }>(`${base(tid)}/gates`),
    retry: shouldRetry,
  });
}

export function useGate(tid: string, code: string) {
  return useQuery({
    queryKey: p2Keys.gate(tid, code),
    queryFn: () => api.get<GateView>(`${base(tid)}/gates/${code}`),
    retry: shouldRetry,
  });
}

export function useGateSubmissions(tid: string, code: string) {
  return useQuery({
    queryKey: p2Keys.gateSubmissions(tid, code),
    queryFn: () => fetchAllPages<GateSubmission>(`${base(tid)}/gates/${code}/submissions`),
    retry: shouldRetry,
  });
}

export function useGateSubmission(tid: string, code: string, no: number | null) {
  return useQuery({
    queryKey: p2Keys.gateSubmission(tid, code, no ?? 0),
    queryFn: () => api.get<GateSubmissionView>(`${base(tid)}/gates/${code}/submissions/${no}`),
    enabled: no !== null,
    retry: shouldRetry,
  });
}

/** The transformation team (active scoped assignments here and inherited), used for owner pickers. */
export function useTeam(tid: string) {
  return useQuery({
    queryKey: p2Keys.team(tid),
    queryFn: () => fetchAllPages<TeamAssignment>(`${base(tid)}/scoped-assignments`),
    retry: shouldRetry,
    staleTime: 60_000,
  });
}

/** Accountability text per role (B0018 verbatim for the six source roles; platform text for the others). */
export function useRoleAccountabilities() {
  return useQuery({
    queryKey: p2Keys.roleAccountabilities,
    queryFn: async () => (await api.get<{ items: RoleAccountability[] }>("/api/v1/role-accountabilities")).items,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  });
}

export function usePainPoints(tid: string, journeyId: string | null) {
  return useRegister<JourneyPainPoint>(tid, `journeys/${journeyId}/pain-points`, {}, journeyId !== null);
}

export function useWorkshopItems(tid: string, workshopId: string | null) {
  return useRegister<TomWorkshopItem>(tid, `tom-workshops/${workshopId}/items`, {}, workshopId !== null);
}

/** Refreshes everything of one transformation after a P2 mutation (registers, live gate readiness, header, phase). */
export function useP2Refresh(tid: string): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: p2Keys.all(tid) }),
      queryClient.invalidateQueries({ queryKey: keys.transformation(tid) }),
    ]);
  };
}
