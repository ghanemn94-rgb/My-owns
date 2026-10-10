// Slice H phase-workspace web seams (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0035 §1, §7 item 3; BE-L2): the phase
// catalogue, the transformation's phase workspace, guided steps (a step with no row yet is read at version 0 and its
// first save sends `If-Match: "0"`, D-109), step evidence and the review queue. Query keys live under FE-F's
// `p4Keys.area("gate-exceptions", tid, "phases", …)` (slice H's key family), so `useP4Refresh(tid)` refreshes them after
// every mutation; the catalogue is global. SYNTHETIC data only in tests and demos. Steps never move a product gate.
import { useQuery } from "@tanstack/react-query";
import type {
  PhaseDefinitionList,
  PhaseStep,
  PhaseStepEvidence,
  PhaseWorkspace,
  PhaseWorkspacePhase,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type { PhaseDefinitionList, PhaseStep, PhaseStepEvidence, PhaseWorkspace, PhaseWorkspacePhase };

const tBase = (tid: string) => `/api/v1/transformations/${tid}`;

/** The paths of the phase operations the screen calls (operationId in the comment). */
export const phasePaths = {
  catalogue: () => `/api/v1/phases`, // listPhases
  workspace: (tid: string) => `${tBase(tid)}/phases`, // getPhaseWorkspace
  steps: (tid: string) => `${tBase(tid)}/phase-steps`, // listPhaseSteps (status=in_review is the review queue)
  step: (tid: string, key: string) => `${tBase(tid)}/phase-steps/${key}`, // getPhaseStep / updatePhaseStep
  requestReview: (tid: string, key: string) => `${tBase(tid)}/phase-steps/${key}/request-review`, // requestPhaseStepReview
  review: (tid: string, key: string) => `${tBase(tid)}/phase-steps/${key}/review`, // reviewPhaseStep
  evidence: (tid: string, key: string) => `${tBase(tid)}/phase-steps/${key}/evidence`, // listPhaseStepEvidence / linkPhaseStepEvidence
  removeEvidence: (tid: string, key: string, id: string) => `${tBase(tid)}/phase-steps/${key}/evidence/${id}/remove`, // removePhaseStepEvidence
} as const;

const opts = { retry: shouldRetry, staleTime: 10_000 } as const;
const key = (tid: string, ...rest: (string | number)[]) => p4Keys.area("gate-exceptions", tid, "phases", ...rest);

/** The six phases of the playbook (B0021), in order; read-only catalogue. */
export function usePhaseCatalogue() {
  return useQuery({
    queryKey: ["p4", "phase-catalogue"],
    queryFn: () => api.get<PhaseDefinitionList>(phasePaths.catalogue()),
    ...opts,
    staleTime: 300_000,
  });
}

export function usePhaseWorkspace(tid: string) {
  return useQuery({
    queryKey: key(tid, "workspace"),
    queryFn: () => api.get<PhaseWorkspace>(phasePaths.workspace(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** The review queue: every step of the transformation that is in review. */
export function useReviewQueue(tid: string) {
  return useQuery({
    queryKey: key(tid, "review-queue"),
    queryFn: () => fetchAllPages<PhaseStep>(phasePaths.steps(tid), { status: "in_review" }),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useStepEvidence(tid: string, stepKey: string, enabled: boolean) {
  return useQuery({
    queryKey: key(tid, "evidence", stepKey),
    queryFn: () => fetchAllPages<PhaseStepEvidence>(phasePaths.evidence(tid, stepKey)),
    enabled: Boolean(tid && stepKey && enabled),
    ...opts,
  });
}

/** `{rule, met}` of a frozen completion check, or null when none was evaluated yet. */
export function completionMetOf(check: Record<string, unknown> | null): boolean | null {
  if (!check) return null;
  return typeof check["met"] === "boolean" ? check["met"] : null;
}
