// Launch-plan and Day-90 web seams (T-DG5-FE-F; slice H: ADR-0048 §1-§4; D-144 "slices D–K add their own clients"):
// the request paths of the 12 operations of the tags `launch-plans` and `day-90-tests` (operationId in the comment),
// their query keys under ["p5", "fef", "launch", tid, …], and the read hooks. The shapes are the @mth/shared mirrors
// (launch.ts, BE-P; day-ninety.ts, BE-P2 promoted by FE-F). The OpenAPI file is the source of truth.
//
// Dates are business dates: day d of a plan is the start date + d calendar days, and a date on a non-working day is
// flagged, never shifted (D-142 Q6). No plan yet is a 404, shown as "No launch plan yet", never as an empty plan.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DayNinetyTest, LaunchPlan, LaunchPlanTemplate, LaunchTask } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type { DayNinetyTest, LaunchPlan, LaunchPlanTemplate, LaunchTask };

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

export const launchPaths = {
  template: `${v1}/launch-plan-template`, // getLaunchPlanTemplate
  plan: (tid: string) => `${tBase(tid)}/launch-plan`, // getLaunchPlan, generateLaunchPlan, updateLaunchPlan
  tasks: (tid: string) => `${tBase(tid)}/launch-plan/tasks`, // listLaunchTasks, createLaunchTask
  task: (tid: string, taskId: string) => `${tBase(tid)}/launch-plan/tasks/${taskId}`, // getLaunchTask, updateLaunchTask
  predecessors: (tid: string, taskId: string) => `${tBase(tid)}/launch-plan/tasks/${taskId}/predecessors`, // putLaunchTaskPredecessors
  dayNinety: (tid: string) => `${tBase(tid)}/day-90-test`, // getDayNinetyTest
  dayNinetyResponse: (tid: string, questionCode: string) =>
    `${tBase(tid)}/day-90-test/responses/${encodeURIComponent(questionCode)}`, // putDayNinetyResponse
  dayNinetyComplete: (tid: string) => `${tBase(tid)}/day-90-test/complete`, // completeDayNinetyTest
};

export const launchKeys = {
  template: ["p5", "fef", "launch-template"] as const,
  all: (tid: string) => ["p5", "fef", "launch", tid] as const,
  plan: (tid: string) => ["p5", "fef", "launch", tid, "plan"] as const,
  tasks: (tid: string) => ["p5", "fef", "launch", tid, "tasks"] as const,
  dayNinety: (tid: string) => ["p5", "fef", "launch", tid, "day-90"] as const,
};

export function useLaunchTemplate() {
  return useQuery({
    queryKey: launchKeys.template,
    queryFn: () => api.get<LaunchPlanTemplate>(launchPaths.template),
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

export function useLaunchPlan(tid: string) {
  return useQuery({
    queryKey: launchKeys.plan(tid),
    queryFn: () => api.get<LaunchPlan>(launchPaths.plan(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useLaunchTasks(tid: string, enabled: boolean) {
  return useQuery({
    queryKey: launchKeys.tasks(tid),
    queryFn: () => fetchAllPages<LaunchTask>(launchPaths.tasks(tid)),
    enabled: Boolean(tid) && enabled,
    retry: shouldRetry,
  });
}

export function useDayNinetyTest(tid: string) {
  return useQuery({
    queryKey: launchKeys.dayNinety(tid),
    queryFn: () => api.get<DayNinetyTest>(launchPaths.dayNinety(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

/** Refreshes every launch-plan and Day-90 read of one transformation (after an action, a 409 or a 422). */
export function useLaunchRefresh(tid: string): () => Promise<unknown> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: launchKeys.all(tid) });
}
