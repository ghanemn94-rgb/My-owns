// Roadmap (T07) API hooks (T-DG3-FE-B; ADR-0023 §1-§3). ONE query, key ["roadmap", tid] (p3Keys.roadmap): the
// timeline, the initiative table and the work board all read this single cache entry; there is no per-view copy.
// After a mutation the caller runs useP3Refresh(tid), which invalidates that one key (and the other P3 keys), so all
// three views follow.
//
// `@mth/shared/schemas` has mirrors for Initiative, Milestone and Deliverable but none for RoadmapWave, RoadmapView
// and T08Dependency (contract components in docs/api/openapi.yaml). Those are typed here as read-only TypeScript
// views of the contract (no zod copy; nothing is validated client-side against them). Recorded in the handback.
import type { Deliverable, Initiative, Milestone, ScheduleFlag } from "@mth/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { p3Keys, shouldRetry } from "../../api/queries.ts";

/** Contract `RoadmapWave` (T07). For the four seeded waves the *En text is the B0079 source verbatim. */
export interface RoadmapWave {
  readonly id: string;
  readonly transformationId: string;
  readonly code: string;
  readonly ordinal: number;
  readonly isSourceSeeded: boolean;
  readonly sourceRef: string | null;
  readonly nameEn: string;
  readonly nameAr: string;
  readonly purposeEn: string;
  readonly purposeAr: string;
  readonly horizonEn: string;
  readonly horizonAr: string;
  readonly entryCriteriaEn: string;
  readonly entryCriteriaAr: string;
  readonly exitEvidenceEn: string;
  readonly exitEvidenceAr: string;
  readonly horizonFromWeeks: number;
  readonly horizonToWeeks: number;
  readonly plannedStart: string | null;
  readonly plannedEnd: string | null;
  readonly ownerUserId: string | null;
  readonly notes: string | null;
  readonly status: "active" | "archived";
  readonly version: number;
}

/** Contract `T08Dependency`: the 7 B0081 columns on the canonical dependency record. */
export interface T08Dependency {
  readonly id: string;
  readonly transformationId: string;
  readonly code: string;
  readonly description: string;
  readonly fromKind: "initiative" | "external" | "tom_dimension" | "decision" | "other";
  readonly fromLabel: string | null;
  readonly fromInitiativeId: string | null;
  readonly toKind: "initiative" | "external" | "tom_dimension" | "decision" | "other";
  readonly toLabel: string | null;
  readonly toInitiativeId: string | null;
  readonly dependencyType: string;
  readonly neededBy: string | null;
  readonly ownerUserId: string | null;
  readonly status: "open" | "at_risk" | "resolved" | "archived";
  readonly mitigation: string | null;
  readonly decisionId: string | null;
  readonly flags: readonly ScheduleFlag[];
  readonly archivedAt: string | null;
  readonly version: number;
}

/** Contract `RoadmapView`: the single read model behind the timeline, table and board (REQ-S09-006). */
export interface RoadmapView {
  readonly transformationId: string;
  readonly waves: readonly RoadmapWave[];
  readonly initiatives: readonly Initiative[];
  readonly milestones: readonly Milestone[];
  readonly deliverables: readonly Deliverable[];
  readonly dependencies: readonly T08Dependency[];
}

export function useRoadmap(tid: string) {
  return useQuery({
    queryKey: p3Keys.roadmap(tid),
    queryFn: () => api.get<RoadmapView>(`/api/v1/transformations/${tid}/roadmap`),
    retry: shouldRetry,
  });
}

export const roadmapUrls = {
  milestone: (id: string) => `/api/v1/milestones/${id}`,
  approveDate: (id: string) => `/api/v1/milestones/${id}/approve-date`,
  submitDeliverable: (id: string) => `/api/v1/deliverables/${id}/submit`,
  decideDeliverable: (id: string) => `/api/v1/deliverables/${id}/acceptance`,
};
