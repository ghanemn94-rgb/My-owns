// P3 portfolio, readiness, outcome-hierarchy and dispensation reads (T-DG3-FE-A; ADR-0021). Every key comes from
// `p3Keys` (api/queries.ts), so `useP3Refresh(tid)` refreshes all of them after a mutation. Writes are sent by the
// screens through `api.send` with If-Match (transitions, removals, decisions) or an Idempotency-Key (creates).
import { useQuery } from "@tanstack/react-query";
import { api } from "./client.ts";
import { fetchAllPages, p3Keys, shouldRetry } from "./queries.ts";
import type {
  DeliverableList,
  GateDispensation,
  Initiative,
  InitiativeDecisionLink,
  InitiativeGapLink,
  InitiativeOutcomeContribution,
  Milestone,
  OutcomeHierarchy,
  PortfolioSelection,
  RoadmapWave,
  TransformationReadiness,
} from "./types.ts";

const tBase = (tid: string) => `/api/v1/transformations/${tid}`;

/** The initiatives (T05) of a transformation; `query` carries the server filters `status` and `waveId`. */
export function useInitiatives(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p3Keys.initiatives(tid, query),
    queryFn: () => fetchAllPages<Initiative>("/api/v1/initiatives", { transformationId: tid, ...query }),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useInitiative(tid: string, initiativeId: string) {
  return useQuery({
    queryKey: p3Keys.initiative(tid, initiativeId),
    queryFn: () => api.get<Initiative>(`/api/v1/initiatives/${initiativeId}`),
    enabled: Boolean(tid) && Boolean(initiativeId),
    retry: shouldRetry,
  });
}

/** A whole (unpaged) list answer `{ items }`: these endpoints take no cursor or limit (strict query, 400 otherwise). */
async function getList<T>(path: string): Promise<T[]> {
  return (await api.get<{ items: T[] }>(path)).items;
}

function usePart<T>(tid: string, initiativeId: string, part: string, paged = false) {
  return useQuery({
    queryKey: p3Keys.initiativePart(tid, initiativeId, part),
    queryFn: () =>
      paged
        ? fetchAllPages<T>(`/api/v1/initiatives/${initiativeId}/${part}`)
        : getList<T>(`/api/v1/initiatives/${initiativeId}/${part}`),
    enabled: Boolean(initiativeId),
    retry: shouldRetry,
  });
}

export const useGapLinks = (tid: string, iid: string) => usePart<InitiativeGapLink>(tid, iid, "gap-links");
export const useOutcomeContributions = (tid: string, iid: string) =>
  usePart<InitiativeOutcomeContribution>(tid, iid, "outcome-contributions");
export const useDecisionLinks = (tid: string, iid: string) =>
  usePart<InitiativeDecisionLink>(tid, iid, "decision-links");
export const useMilestones = (tid: string, iid: string) => usePart<Milestone>(tid, iid, "milestones");
export const useSelections = (tid: string, iid: string) => usePart<PortfolioSelection>(tid, iid, "selections", true);

/** Deliverables keep the list answer whole: it carries the 3-7 `countWarning` (a warning, never a block). */
export function useDeliverables(tid: string, initiativeId: string) {
  return useQuery({
    queryKey: p3Keys.initiativePart(tid, initiativeId, "deliverables"),
    queryFn: () => api.get<DeliverableList>(`/api/v1/initiatives/${initiativeId}/deliverables`),
    enabled: Boolean(initiativeId),
    retry: shouldRetry,
  });
}

/** The T07 waves (wave filter and the wave of an initiative). Kept under the portfolio key of this screen. */
export function useWaves(tid: string) {
  return useQuery({
    queryKey: [...p3Keys.portfolio(tid), "waves"] as const,
    queryFn: () => getList<RoadmapWave>(`${tBase(tid)}/waves`),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useReadiness(tid: string) {
  return useQuery({
    queryKey: p3Keys.readiness(tid),
    queryFn: () => api.get<TransformationReadiness>(`${tBase(tid)}/readiness`),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useOutcomeHierarchy(tid: string) {
  return useQuery({
    queryKey: p3Keys.outcomeHierarchy(tid),
    queryFn: () => api.get<OutcomeHierarchy>(`${tBase(tid)}/outcome-hierarchy`),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useDispensations(tid: string) {
  return useQuery({
    queryKey: p3Keys.dispensations(tid),
    queryFn: () => fetchAllPages<GateDispensation>(`${tBase(tid)}/gate-dispensations`),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

/** The proposed rank per initiative id, read from the prioritization view (ADR-0022). Its own key part, so it never
 * shares a cache entry with FE-B's prioritization screen. A transformation without a ranking answers an empty map. */
export function useProposedRanks(tid: string) {
  return useQuery({
    queryKey: p3Keys.prioritizationPart(tid, "portfolio-ranks"),
    queryFn: async () => {
      const view = await api.get<{ items: { initiative: { id: string }; rank: number | null }[] }>(
        `${tBase(tid)}/prioritization`,
      );
      return new Map(view.items.map((i) => [i.initiative.id, i.rank]));
    },
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
