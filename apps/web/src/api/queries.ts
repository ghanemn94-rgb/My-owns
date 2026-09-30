// Server state through TanStack Query (ADR-0009). One query key family per resource; mutations invalidate them.
import { keepPreviousData, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { PAGINATION } from "@mth/shared";
import { ApiError, api, apiRequest, setCsrfToken } from "./client.ts";
import type {
  AuditEvent,
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
export async function fetchMe(): Promise<Me> {
  const me = (await apiRequest<Me>("/api/v1/me", { silent401: true })).data;
  setCsrfToken(me.csrfToken);
  return me;
}

export function useMeQuery() {
  return useQuery({ queryKey: keys.me, queryFn: fetchMe, staleTime: 60_000, retry: shouldRetry });
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
