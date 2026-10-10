// Slice G closure web seams (T-DG4-FE-F; p4-work-split §F+G FG.8; ADR-0034 §1-§3, §7): the transformation and
// initiative status models (four separate statuses and the ADR-0034 §2 label), closure records, transition decisions
// and the benefits they name. Query keys live under FE-A's `p4Keys.area("closure", tid, …)`, so `useP4Refresh(tid)`
// refreshes every one of them after a mutation. SYNTHETIC data only in tests and demos.
//
// Nothing here derives one status from another: delivery, adoption, validated value and closure are read as the server
// returns them, side by side (REQ-S03-003). A missing model is shown as Unknown, never as a status.
import { useQueries, useQuery } from "@tanstack/react-query";
import type {
  Benefit,
  ClosureRecord,
  InitiativeStatusModel,
  TransformationStatusModel,
  TransitionDecision,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type { Benefit, ClosureRecord, InitiativeStatusModel, TransformationStatusModel, TransitionDecision };

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the closure operations the screen calls (operationId in the comment). */
export const closurePaths = {
  statusModel: (tid: string) => `${tBase(tid)}/status-model`, // getTransformationStatusModel
  closeTransformation: (tid: string) => `${tBase(tid)}/close`, // closeTransformation
  closureRecords: (tid: string) => `${tBase(tid)}/closure-records`, // listClosureRecords
  initiativeStatusModel: (id: string) => `${v1}/initiatives/${id}/status-model`, // getInitiativeStatusModel
  completeDelivery: (id: string) => `${v1}/initiatives/${id}/complete-delivery`, // completeInitiativeDelivery
  adoptionStatus: (id: string) => `${v1}/initiatives/${id}/adoption-status`, // setInitiativeAdoptionStatus
  closeInitiative: (id: string) => `${v1}/initiatives/${id}/close`, // closeInitiative
  decisions: (tid: string) => `${tBase(tid)}/transition-decisions`, // listTransitionDecisions / createTransitionDecision
  decision: (tid: string, id: string) => `${tBase(tid)}/transition-decisions/${id}`, // getTransitionDecision / updateTransitionDecision
  submitDecision: (tid: string, id: string) => `${tBase(tid)}/transition-decisions/${id}/submit`, // submitTransitionDecision
  benefits: (tid: string) => `${tBase(tid)}/benefits`, // listBenefits (KBE-D)
} as const;

const opts = { retry: shouldRetry, staleTime: 10_000 } as const;

export function useTransformationStatusModel(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("closure", tid, "status-model"),
    queryFn: () => api.get<TransformationStatusModel>(closurePaths.statusModel(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** One status model per initiative (each read separately; a failed read is that initiative's Unknown). */
export function useInitiativeStatusModels(tid: string, initiativeIds: readonly string[]) {
  return useQueries({
    queries: initiativeIds.map((id) => ({
      queryKey: p4Keys.area("closure", tid, "initiative-status-model", id),
      queryFn: () => api.get<InitiativeStatusModel>(closurePaths.initiativeStatusModel(id)),
      ...opts,
    })),
  });
}

export function useClosureRecords(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("closure", tid, "records"),
    queryFn: () => fetchAllPages<ClosureRecord>(closurePaths.closureRecords(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useTransitionDecisions(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("closure", tid, "transition-decisions"),
    queryFn: () => fetchAllPages<TransitionDecision>(closurePaths.decisions(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** The transformation's benefits (to name a transition decision's benefit and to choose one). */
export function useClosureBenefits(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("closure", tid, "benefits"),
    queryFn: () => fetchAllPages<Benefit>(closurePaths.benefits(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}
