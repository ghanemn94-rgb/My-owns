// Prioritization (T06) API hooks (T-DG3-FE-B; ADR-0022). Types are the SHARED mirrors from @mth/shared/schemas; the
// query keys are FE-A0's p3Keys, so useP3Refresh(tid) refreshes every one of them after a mutation.
import type {
  InitiativeScoreSheet,
  PrioritizationQuery,
  PrioritizationView,
  RankingChange,
  RankingOverride,
  RankingSnapshot,
  RankingSnapshotView,
  WeightSet,
} from "@mth/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { p3Keys, shouldRetry } from "../../api/queries.ts";

const base = (tid: string) => `/api/v1/transformations/${tid}/prioritization`;

export type PrioritizationFilters = Required<{ [K in keyof PrioritizationQuery]: string }>;
export const NO_FILTERS: PrioritizationFilters = { status: "", waveId: "", completeness: "", funding: "", flag: "" };

/** GET /prioritization with the server-side filters (empty values are omitted). */
export function usePrioritizationView(tid: string, filters: PrioritizationFilters) {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) if (v) query[k] = v;
  return useQuery({
    queryKey: p3Keys.prioritizationPart(
      tid,
      "view",
      filters.status,
      filters.waveId,
      filters.completeness,
      filters.funding,
      filters.flag,
    ),
    queryFn: () => api.get<PrioritizationView>(base(tid), query),
    retry: shouldRetry,
  });
}

export function useWeightSets(tid: string) {
  return useQuery({
    queryKey: p3Keys.prioritizationPart(tid, "weight-sets"),
    queryFn: async () => (await api.get<{ items: WeightSet[] }>(`${base(tid)}/weight-sets`)).items,
    retry: shouldRetry,
  });
}

export function useScoreSheet(tid: string, initiativeId: string | null) {
  return useQuery({
    queryKey: p3Keys.prioritizationPart(tid, "scores", initiativeId ?? ""),
    queryFn: () => api.get<InitiativeScoreSheet>(`/api/v1/initiatives/${initiativeId}/scores`),
    enabled: initiativeId !== null,
    retry: shouldRetry,
  });
}

export function useRankingSnapshots(tid: string) {
  return useQuery({
    queryKey: p3Keys.prioritizationPart(tid, "rankings"),
    queryFn: async () =>
      (await api.get<{ items: RankingSnapshot[]; nextCursor: string | null }>(`${base(tid)}/rankings`, { limit: "50" }))
        .items,
    retry: shouldRetry,
  });
}

export function useRankingSnapshot(tid: string, snapshotNo: number | null) {
  return useQuery({
    queryKey: p3Keys.prioritizationPart(tid, "ranking", snapshotNo ?? 0),
    queryFn: () => api.get<RankingSnapshotView>(`${base(tid)}/rankings/${snapshotNo}`),
    enabled: snapshotNo !== null,
    retry: shouldRetry,
  });
}

export function useRankingHistory(tid: string) {
  return useQuery({
    queryKey: p3Keys.prioritizationPart(tid, "ranking-history"),
    queryFn: async () =>
      (
        await api.get<{ items: RankingChange[]; nextCursor: string | null }>(`${base(tid)}/ranking-history`, {
          limit: "100",
        })
      ).items,
    retry: shouldRetry,
  });
}

export function useOverrides(tid: string) {
  return useQuery({
    queryKey: p3Keys.prioritizationPart(tid, "overrides"),
    queryFn: async () =>
      (
        await api.get<{ items: RankingOverride[]; nextCursor: string | null }>(`${base(tid)}/overrides`, {
          limit: "100",
        })
      ).items,
    retry: shouldRetry,
  });
}

export const prioritizationUrls = {
  weightSets: (tid: string) => `${base(tid)}/weight-sets`,
  approveWeightSet: (tid: string, no: number) => `${base(tid)}/weight-sets/${no}/approve`,
  withdrawWeightSet: (tid: string, no: number) => `${base(tid)}/weight-sets/${no}/withdraw`,
  scores: (initiativeId: string) => `/api/v1/initiatives/${initiativeId}/scores`,
  score: (initiativeId: string, criterion: string) => `/api/v1/initiatives/${initiativeId}/scores/${criterion}`,
  rankings: (tid: string) => `${base(tid)}/rankings`,
  overrides: (tid: string) => `${base(tid)}/overrides`,
  decideOverride: (tid: string, id: string) => `${base(tid)}/overrides/${id}/decision`,
  revokeOverride: (tid: string, id: string) => `${base(tid)}/overrides/${id}/revoke`,
};
