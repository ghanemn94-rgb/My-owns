// Business-case data hooks (T-DG3-FE-C; ADR-0024 §1-§5). Every key comes from the FE-A0 seam `p3Keys` and starts with
// ["business-cases", transformationId], so useP3Refresh(tid) refreshes all of them after a mutation. Amounts stay
// decimal strings end to end; nothing here converts them to JavaScript numbers.
import { useQuery } from "@tanstack/react-query";
import type { BusinessCase, BusinessCaseLine, BusinessCaseTotals, Initiative } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { fetchAllPages, p3Keys, shouldRetry } from "../../api/queries.ts";

export const CASES_URL = "/api/v1/business-cases";
export const caseUrl = (id: string) => `${CASES_URL}/${id}`;

/** All business cases of a transformation (the transformation case and its initiative cases). */
export function useBusinessCases(tid: string, includeArchived = false) {
  return useQuery({
    queryKey: [...p3Keys.businessCases(tid), { includeArchived }],
    queryFn: () =>
      fetchAllPages<BusinessCase>(CASES_URL, {
        transformationId: tid,
        ...(includeArchived ? { includeArchived: "true" } : {}),
      }),
    retry: shouldRetry,
  });
}

export function useBusinessCase(tid: string, id: string) {
  return useQuery({
    queryKey: p3Keys.businessCase(tid, id),
    queryFn: () => api.get<BusinessCase>(caseUrl(id)),
    retry: shouldRetry,
  });
}

/** The case's own lines, archived ones included (the screen shows them apart, read-only). */
export function useCaseLines(tid: string, id: string) {
  return useQuery({
    queryKey: p3Keys.businessCasePart(tid, id, "lines"),
    queryFn: async () =>
      (await api.get<{ items: BusinessCaseLine[] }>(`${caseUrl(id)}/lines`, { includeArchived: "true" })).items,
    retry: shouldRetry,
  });
}

/** Gross benefits, implementation cost and net value per currency (REQ-S05-005); a transformation case rolls up. */
export function useCaseTotals(tid: string, id: string) {
  return useQuery({
    queryKey: p3Keys.businessCasePart(tid, id, "totals"),
    queryFn: () => api.get<BusinessCaseTotals>(`${caseUrl(id)}/totals`),
    retry: shouldRetry,
  });
}

/**
 * The transformation's initiatives, for linking an initiative case. Kept under this feature's own key (never FE-A's
 * `p3Keys.initiatives`), so the two screens can never disagree about the cached shape.
 */
export function useInitiativeOptions(tid: string) {
  return useQuery({
    queryKey: [...p3Keys.businessCases(tid), "initiative-options"],
    queryFn: () => fetchAllPages<Initiative>("/api/v1/initiatives", { transformationId: tid }),
    retry: shouldRetry,
    staleTime: 30_000,
  });
}
