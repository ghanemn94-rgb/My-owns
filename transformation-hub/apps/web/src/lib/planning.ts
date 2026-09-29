'use client';

/**
 * Planning data layer: query keys, hooks and types for the Integrated Plan, RAID & Change Control, the workstream
 * workspace and My Work. Everything goes through the typed `api()` client; the API authorizes every call.
 */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { planningRoutes as P, type RouteQuery, type RouteResponse } from '@hub/contracts';
import { api } from './api';
import { qk } from './queries';

export type TaskList = RouteResponse<typeof P.listTasks>;
export type Task = TaskList['items'][number];
export type Milestone = RouteResponse<typeof P.getMilestone>;
export type Deliverable = RouteResponse<typeof P.getDeliverable>;
export type Schedule = RouteResponse<typeof P.getSchedule>;
export type ScheduleNode = Schedule['nodes'][number];
export type DelayImpact = RouteResponse<typeof P.delayImpact>;
export type Dependency = RouteResponse<typeof P.listDependencies>['items'][number];
export type Baseline = RouteResponse<typeof P.listBaselines>['items'][number];
export type BaselineDetail = RouteResponse<typeof P.getBaseline>;
export type ChangeRequest = RouteResponse<typeof P.getChangeRequest>;
export type RaidItem = RouteResponse<typeof P.getRaid>;
export type RaidKindPath = 'risks' | 'issues' | 'assumptions' | 'dependencies';
export type StatusUpdate = RouteResponse<typeof P.getStatusUpdate>;
export type RagOverride = RouteResponse<typeof P.listRagOverrides>['items'][number];
export type Progress = RouteResponse<typeof P.progress>;
export type WorkstreamHealth = Progress['workstreams'][number];
export type LookAhead = RouteResponse<typeof P.lookAhead>;
export type LookAheadItem = LookAhead['due'][number];
export type MyWork = RouteResponse<typeof P.myWork>;
export type MyWorkItem = MyWork['items'][number];

export const RAID_KIND_PATHS: readonly RaidKindPath[] = ['risks', 'issues', 'assumptions', 'dependencies'];

/** Query keys: everything planning-related for a project lives under one prefix so a command can refresh it all. */
export const pk = {
  all: (pid: string) => ['project', pid, 'planning'] as const,
  tasks: (pid: string, q: object) => [...pk.all(pid), 'tasks', q] as const,
  allTasks: (pid: string, q: object) => [...pk.all(pid), 'all-tasks', q] as const,
  task: (pid: string, id: string) => [...pk.all(pid), 'task', id] as const,
  milestones: (pid: string, q: object) => [...pk.all(pid), 'milestones', q] as const,
  milestone: (pid: string, id: string) => [...pk.all(pid), 'milestone', id] as const,
  deliverables: (pid: string, q: object) => [...pk.all(pid), 'deliverables', q] as const,
  deliverable: (pid: string, id: string) => [...pk.all(pid), 'deliverable', id] as const,
  schedule: (pid: string, target: string | undefined) => [...pk.all(pid), 'schedule', target ?? 'project'] as const,
  dependencies: (pid: string, nodeId?: string) => [...pk.all(pid), 'dependencies', nodeId ?? 'all'] as const,
  holidays: (pid: string) => [...pk.all(pid), 'holidays'] as const,
  lookAhead: (pid: string, q: object) => [...pk.all(pid), 'look-ahead', q] as const,
  baselines: (pid: string) => [...pk.all(pid), 'baselines'] as const,
  baseline: (pid: string, id: string) => [...pk.all(pid), 'baseline', id] as const,
  changeRequests: (pid: string, q: object) => [...pk.all(pid), 'change-requests', q] as const,
  changeRequest: (pid: string, id: string) => [...pk.all(pid), 'change-request', id] as const,
  raid: (pid: string, kind: RaidKindPath, q: object) => [...pk.all(pid), 'raid', kind, q] as const,
  raidItem: (pid: string, kind: RaidKindPath, id: string) => [...pk.all(pid), 'raid-item', kind, id] as const,
  updates: (pid: string, q: object) => [...pk.all(pid), 'status-updates', q] as const,
  update: (pid: string, id: string) => [...pk.all(pid), 'status-update', id] as const,
  overrides: (pid: string) => [...pk.all(pid), 'rag-overrides'] as const,
  progress: (pid: string) => [...pk.all(pid), 'progress'] as const,
  raci: (pid: string, type: string, id: string) => [...pk.all(pid), 'raci', type, id] as const,
  responsibility: (pid: string) => [...pk.all(pid), 'responsibility'] as const,
  myWork: ['me', 'work'] as const,
};

/** After any planning command: refresh the project's planning data, its counts and the inbox. */
export function useRefreshPlanning(projectId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: pk.all(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.workstreams(projectId) }),
      queryClient.invalidateQueries({ queryKey: pk.myWork }),
    ]);
  };
}

export type TaskQuery = RouteQuery<typeof P.listTasks>;

export function useTasks(projectId: string, query: TaskQuery, enabled = true) {
  return useQuery({
    queryKey: pk.tasks(projectId, query),
    queryFn: ({ signal }) => api(P.listTasks, { params: { projectId }, query, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Every task matching the filters (for the WBS tree), fetched page by page (bounded). */
export function useAllTasks(projectId: string, query: Omit<TaskQuery, 'page' | 'pageSize'>, enabled = true) {
  return useQuery({
    queryKey: pk.allTasks(projectId, query),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const items: Task[] = [];
      let total = 0;
      for (let page = 1; page <= 20; page++) {
        const r = await api(P.listTasks, { params: { projectId }, query: { ...query, page, pageSize: 100 }, signal });
        items.push(...r.items);
        total = r.total;
        if (items.length >= r.total || r.items.length === 0) break;
      }
      return { items, total };
    },
  });
}

export function useTask(projectId: string, taskId: string) {
  return useQuery({ queryKey: pk.task(projectId, taskId), queryFn: ({ signal }) => api(P.getTask, { params: { projectId, taskId }, signal }) });
}

export function useSchedule(projectId: string, targetNodeId?: string, enabled = true) {
  return useQuery({
    queryKey: pk.schedule(projectId, targetNodeId),
    queryFn: ({ signal }) => api(P.getSchedule, { params: { projectId }, query: targetNodeId ? { targetNodeId } : {}, signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useProgress(projectId: string, enabled = true) {
  return useQuery({ queryKey: pk.progress(projectId), queryFn: ({ signal }) => api(P.progress, { params: { projectId }, signal }), enabled });
}

export function useBaselines(projectId: string, enabled = true) {
  return useQuery({ queryKey: pk.baselines(projectId), queryFn: ({ signal }) => api(P.listBaselines, { params: { projectId }, signal }), enabled });
}

export function useMyWork() {
  return useQuery({ queryKey: pk.myWork, queryFn: ({ signal }) => api(P.myWork, { signal }) });
}

/** Tone for a RAG value (text + icon + colour are rendered by StatusBadge; never colour alone). */
export function ragTone(v: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (v === 'green') return 'success';
  if (v === 'amber') return 'warning';
  if (v === 'red') return 'danger';
  if (v === 'stale' || v === 'not_updated' || v === 'unknown') return 'warning';
  return 'neutral';
}

/** Today in the project time zone as YYYY-MM-DD (display filters only — the API computes "overdue"). */
export function localToday(timeZone = 'Asia/Riyadh'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function taskHref(projectId: string, id: string) {
  return `/projects/${projectId}/plan/tasks/${id}`;
}
export function milestoneHref(projectId: string, id: string) {
  return `/projects/${projectId}/plan/milestones/${id}`;
}
export function deliverableHref(projectId: string, id: string) {
  return `/projects/${projectId}/plan/deliverables/${id}`;
}
export function nodeHref(projectId: string, type: 'task' | 'milestone' | 'deliverable', id: string) {
  return type === 'task' ? taskHref(projectId, id) : type === 'milestone' ? milestoneHref(projectId, id) : deliverableHref(projectId, id);
}
export function raidHref(projectId: string, kind: RaidKindPath, id: string) {
  return `/projects/${projectId}/raid/${kind}/${id}`;
}
export function changeRequestHref(projectId: string, id: string) {
  return `/projects/${projectId}/raid/changes/${id}`;
}
export function baselineHref(projectId: string, id: string) {
  return `/projects/${projectId}/plan/baselines/${id}`;
}
export function updateHref(projectId: string, id: string) {
  return `/projects/${projectId}/plan/updates/${id}`;
}
export function workstreamHref(projectId: string, id: string, tab?: string) {
  return `/projects/${projectId}/workstreams/${id}${tab ? `?tab=${tab}` : ''}`;
}
