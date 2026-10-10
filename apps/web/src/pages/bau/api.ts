// Slice G web seams (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0034 §4-§6, §8): the request paths and read hooks of
// performance areas (with their append-only cycle history), area links, BAU handovers (with `missingItems`), controls,
// control checks, recurring sustainment reviews, the continuous-improvement backlog and lessons (with the
// cross-transformation search). Query keys come from FE-A's `p4Keys.area("performance-areas" / "bau-handovers" /
// "controls" / "improvement-items" / "lessons", tid, …)`, so `useP4Refresh(tid)` refreshes every view of the
// transformation after a mutation. SYNTHETIC data only in tests and demos.
//
// Unknown is data, never a default: an area without a BAU owner or a next review date stays null here and renders as
// Unknown / "not scheduled", never a guessed value (ADR-0034 §11).
import { useQuery } from "@tanstack/react-query";
import type {
  BauHandover,
  Control,
  ControlCheck,
  ImprovementItem,
  Lesson,
  LessonSearchHit,
  PerformanceArea,
  PerformanceAreaLink,
  SustainmentReview,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  BauHandover,
  Control,
  ControlCheck,
  ImprovementItem,
  Lesson,
  LessonSearchHit,
  PerformanceArea,
  PerformanceAreaLink,
  SustainmentReview,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the slice G operations the screens call (operationId in the comment). */
export const sustainPaths = {
  areas: (tid: string) => `${tBase(tid)}/performance-areas`, // listPerformanceAreas / createPerformanceArea
  area: (tid: string, id: string) => `${tBase(tid)}/performance-areas/${id}`, // getPerformanceArea / updatePerformanceArea
  areaReopen: (tid: string, id: string) => `${tBase(tid)}/performance-areas/${id}/reopen`, // reopenPerformanceArea
  areaRetire: (tid: string, id: string) => `${tBase(tid)}/performance-areas/${id}/retire`, // retirePerformanceArea
  areaLinks: (tid: string, id: string) => `${tBase(tid)}/performance-areas/${id}/links`, // listPerformanceAreaLinks / createPerformanceAreaLink
  areaLinkRemove: (tid: string, id: string, linkId: string) =>
    `${tBase(tid)}/performance-areas/${id}/links/${linkId}/remove`, // removePerformanceAreaLink
  handovers: (tid: string) => `${tBase(tid)}/bau-handovers`, // listBauHandovers / createBauHandover
  handover: (tid: string, id: string) => `${tBase(tid)}/bau-handovers/${id}`, // getBauHandover / updateBauHandover
  handoverEvidence: (tid: string, id: string) => `${tBase(tid)}/bau-handovers/${id}/evidence`, // addBauHandoverEvidence
  handoverSubmit: (tid: string, id: string) => `${tBase(tid)}/bau-handovers/${id}/submit`, // submitBauHandover
  handoverAccept: (tid: string, id: string) => `${tBase(tid)}/bau-handovers/${id}/accept`, // acceptBauHandover
  handoverReturn: (tid: string, id: string) => `${tBase(tid)}/bau-handovers/${id}/return`, // returnBauHandover
  controls: (tid: string) => `${tBase(tid)}/controls`, // listControls / createControl
  control: (tid: string, id: string) => `${tBase(tid)}/controls/${id}`, // updateControl
  checks: (tid: string) => `${tBase(tid)}/control-checks`, // listControlChecks
  checkRecord: (tid: string, id: string) => `${tBase(tid)}/control-checks/${id}/record`, // recordControlCheck
  reviews: (tid: string) => `${tBase(tid)}/sustainment-reviews`, // listSustainmentReviews
  reviewComplete: (tid: string, id: string) => `${tBase(tid)}/sustainment-reviews/${id}/complete`, // completeSustainmentReview
  improvement: (tid: string) => `${tBase(tid)}/improvement-items`, // listImprovementItems / createImprovementItem
  improvementItem: (tid: string, id: string) => `${tBase(tid)}/improvement-items/${id}`, // updateImprovementItem
  lessons: (tid: string) => `${tBase(tid)}/lessons`, // listLessons / createLesson
  lesson: (tid: string, id: string) => `${tBase(tid)}/lessons/${id}`, // updateLesson
  lessonPublish: (tid: string, id: string) => `${tBase(tid)}/lessons/${id}/publish`, // publishLesson
  lessonSearch: () => `${v1}/lessons/search`, // searchLessons
} as const;

const opts = { retry: shouldRetry, staleTime: 15_000 } as const;

export function usePerformanceAreas(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("performance-areas", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<PerformanceArea>(sustainPaths.areas(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function usePerformanceArea(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("performance-areas", tid, "area", id),
    queryFn: () => api.get<PerformanceArea>(sustainPaths.area(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useAreaLinks(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("performance-areas", tid, "links", id),
    queryFn: () => fetchAllPages<PerformanceAreaLink>(sustainPaths.areaLinks(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useHandovers(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("bau-handovers", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<BauHandover>(sustainPaths.handovers(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useHandover(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("bau-handovers", tid, "handover", id),
    queryFn: () => api.get<BauHandover>(sustainPaths.handover(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useControls(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("controls", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<Control>(sustainPaths.controls(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useControlChecks(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("controls", tid, "checks", JSON.stringify(query)),
    queryFn: () => fetchAllPages<ControlCheck>(sustainPaths.checks(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useSustainmentReviews(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("performance-areas", tid, "reviews", JSON.stringify(query)),
    queryFn: () => fetchAllPages<SustainmentReview>(sustainPaths.reviews(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useImprovementItems(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("improvement-items", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<ImprovementItem>(sustainPaths.improvement(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useLessons(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("lessons", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<Lesson>(sustainPaths.lessons(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** Published lessons across transformations in the caller's scope (`lesson.search`; REQ-S11-008). */
export function useLessonSearch(query: { q?: string; tag?: string }, enabled = true) {
  const params: Record<string, string> = {
    ...(query.q ? { q: query.q } : {}),
    ...(query.tag ? { tag: query.tag } : {}),
  };
  return useQuery({
    queryKey: ["p4", "lesson-search", params],
    queryFn: () => fetchAllPages<LessonSearchHit>(sustainPaths.lessonSearch(), params),
    enabled,
    retry: shouldRetry,
    // Organization-wide: not a key of one transformation, so it is always re-read (a lesson published elsewhere).
    staleTime: 0,
  });
}
