'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aiRoutes, portfolioRoutes, type RouteQuery, type RouteResponse } from '@hub/contracts';
import { AI_ACTION_PERMISSION, type AiProposableAction } from '@hub/domain';
import { api } from './api';
import { useProjectContext } from './project-context';
import { qk } from './queries';

/**
 * AI PM Center (spec §10 screen 14, spec §12; REQ-AI-*, REQ-UX-017) — types, query keys, hooks and pure helpers.
 *
 * Honesty rules the screens follow:
 *  - the only provider in this environment is the local mock: its output is labelled Simulated everywhere it appears;
 *  - provider / endpoint states are shown exactly as `GET …/ai/status` reports them — nothing here is ever "Connected";
 *  - citations are shown only when the API returned them (retrieval and every re-read are ACL-filtered on the server);
 *  - buttons mirror the server rules (mode, emergency stop, separation of duties, underlying permission), but the API
 *    decides every command.
 */

type R = typeof aiRoutes;
export type AiStatus = RouteResponse<R['status']>;
export type AiEndpoint = AiStatus['endpoints'][number];
export type AiSettings = RouteResponse<R['getSettings']>;
export type AutopilotPolicy = NonNullable<AiSettings['autopilotPolicy']>;
export type AiCosts = RouteResponse<R['costs']>;
export type AiRun = RouteResponse<R['getRun']>;
export type AiRunOutput = NonNullable<AiRun['output']>;
export type AiRunSummary = RouteResponse<R['listRuns']>['items'][number];
export type AiProposal = RouteResponse<R['listProposals']>['items'][number];
export type AiApproval = AiProposal['approvals'][number];
export type AiDetections = RouteResponse<R['detections']>;
export type AiDetection = AiDetections['items'][number];
export type AiCitation = AiDetection['citations'][number];
export type BriefingSchedule = RouteResponse<R['listBriefings']>['items'][number];
export type AiToolMatrix = RouteResponse<R['tools']>;
export type People = Record<string, string>;

export const RUN_SORTS = ['-createdAt', 'createdAt', 'kind', '-kind', 'status', '-status'] as const;
export const PROPOSAL_SORTS = ['-createdAt', 'createdAt', '-updatedAt', 'status', 'actionType'] as const;
export const DETECTION_SEVERITIES = ['critical', 'warning', 'info'] as const;
/** Kinds of briefing schedules a user can subscribe to (default cron per kind is applied by the server). */
export const BRIEFING_KINDS = ['daily', 'weekly'] as const;
/** Payload fields a requester may revise, per proposable action (mirrors the server's argument schemas). */
export const REVISABLE_FIELDS: Record<Exclude<AiProposableAction, 'prepare_approval_request'>, readonly ('title' | 'body' | 'content' | 'description' | 'dueDate')[]> = {
  create_internal_notification: ['title', 'body'],
  request_update_from_owner: ['title', 'body'],
  create_follow_up_task: ['title', 'description', 'dueDate'],
  flag_risk: ['title', 'description'],
  draft_agenda: ['title', 'content'],
  draft_minutes: ['title', 'content'],
  draft_decision_paper: ['title', 'content'],
  draft_status_summary: ['title', 'content'],
};

/** Every AI query lives under ['ai', projectId] so one invalidation refreshes the whole section. */
export const ak = {
  root: (pid: string) => ['ai', pid] as const,
  status: (pid: string) => ['ai', pid, 'status'] as const,
  settings: (pid: string) => ['ai', pid, 'settings'] as const,
  costs: (pid: string) => ['ai', pid, 'costs'] as const,
  runs: (pid: string, q: object) => ['ai', pid, 'runs', q] as const,
  run: (pid: string, id: string) => ['ai', pid, 'run', id] as const,
  proposals: (pid: string, q: object) => ['ai', pid, 'proposals', q] as const,
  proposal: (pid: string, id: string) => ['ai', pid, 'proposal', id] as const,
  briefings: (pid: string) => ['ai', pid, 'briefings'] as const,
  detections: (pid: string) => ['ai', pid, 'detections'] as const,
  tools: (pid: string) => ['ai', pid, 'tools'] as const,
};

export function aiHref(projectId: string, segment = ''): string {
  return `/projects/${projectId}/ai${segment}`;
}

/** Sub-sections of the AI PM Center and the permissions that make each one visible (UI hint; the API decides). */
export const AI_TABS = [
  { key: 'overview', segment: '', permissions: [] as readonly string[] },
  { key: 'ask', segment: '/ask', permissions: ['ai.assistant.use'] },
  { key: 'proposals', segment: '/proposals', permissions: ['ai.proposal.read'] },
  { key: 'runs', segment: '/runs', permissions: ['ai.run.read'] },
  { key: 'briefings', segment: '/briefings', permissions: ['ai.briefing.subscribe', 'planning.plan.read'] },
  { key: 'settings', segment: '/settings', permissions: ['ai.settings.manage', 'ai.autopilot_policy.approve', 'ai.killswitch.activate', 'ai.killswitch.release'] },
] as const;
export type AiTabKey = (typeof AI_TABS)[number]['key'];

export function tabPermissions(key: AiTabKey): readonly string[] {
  return AI_TABS.find((t) => t.key === key)!.permissions;
}

/**
 * Link to the record a citation / detection points at, or null when the product has no page for it (e.g. a CPM
 * computation). Only ever called with references the API returned; opening the link re-checks access on the server.
 */
export function citationHref(projectId: string, c: { type: string; id: string; label?: string | null }): string | null {
  const base = `/projects/${projectId}`;
  switch (c.type) {
    case 'task':
      return `${base}/plan/tasks/${c.id}`;
    case 'milestone':
      return `${base}/plan/milestones/${c.id}`;
    case 'document':
      return `${base}/documents/${c.id}`;
    case 'decision':
      return `${base}/committee/decisions/${c.id}`;
    case 'action_item':
      return `${base}/committee/actions`;
    case 'gate_definition':
      return `${base}/gates/${c.id}`;
    case 'workstream':
      return `${base}/workstreams/${c.id}`;
    case 'closing_condition':
      return `${base}/jv/closing/conditions/${c.id}`;
    case 'partner':
      return `${base}/jv/partners/${c.id}`;
    case 'tsa_service':
      return `${base}/readiness/tsa/${c.id}`;
    case 'readiness_check':
      return `${base}/readiness/checks/${c.id}`;
    case 'financial_snapshot':
      return `${base}/finance/snapshots/${c.id}`;
    case 'status_dimension':
      // The server labels a dimension citation with its key (e.g. "perimeter_transfer").
      return c.label && /^[a-z_]+$/.test(c.label) ? `${base}/dimensions/${c.label}` : null;
    default:
      return null;
  }
}

/** Underlying permission an action exercises when executed (null = prepared request text only, never executable). */
export function underlyingPermission(actionType: string): string | null {
  return (AI_ACTION_PERMISSION as Record<string, string | null | undefined>)[actionType] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Queries

function useP() {
  return useProjectContext();
}

export function useAiRefresh() {
  const queryClient = useQueryClient();
  const { projectId } = useP();
  return useCallback(async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ak.root(projectId) }), queryClient.invalidateQueries({ queryKey: ['project', projectId, 'activity'] })]);
  }, [queryClient, projectId]);
}

export function useAiStatus(enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.status(projectId),
    queryFn: ({ signal }) => api(aiRoutes.status, { params: { projectId }, signal }),
    enabled: enabled && can('ai.run.read'),
  });
}

export function useAiSettings(enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.settings(projectId),
    queryFn: ({ signal }) => api(aiRoutes.getSettings, { params: { projectId }, signal }),
    enabled: enabled && can('ai.settings.manage'),
  });
}

export function useAiCosts(enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.costs(projectId),
    queryFn: ({ signal }) => api(aiRoutes.costs, { params: { projectId }, signal }),
    enabled: enabled && can('ai.operations.read'),
  });
}

export function useAiRuns(query: RouteQuery<R['listRuns']>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.runs(projectId, query),
    queryFn: ({ signal }) => api(aiRoutes.listRuns, { params: { projectId }, query, signal }),
    enabled: enabled && can('ai.run.read'),
    placeholderData: (prev) => prev,
  });
}

export function useAiRun(runId: string) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.run(projectId, runId),
    queryFn: ({ signal }) => api(aiRoutes.getRun, { params: { projectId, runId }, signal }),
    enabled: can('ai.run.read'),
    // A queued/running run is completed by the worker: follow it until it settles.
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'queued' || q.state.data.status === 'running') ? 2000 : false),
  });
}

export function useAiProposals(query: RouteQuery<R['listProposals']>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.proposals(projectId, query),
    queryFn: ({ signal }) => api(aiRoutes.listProposals, { params: { projectId }, query, signal }),
    enabled: enabled && can('ai.proposal.read'),
    placeholderData: (prev) => prev,
  });
}

/**
 * One proposal. The API has no "get proposal" route, so the (ACL-filtered, newest-first) list is paged until the id is
 * found; a proposal the caller may not see is simply never returned → the restricted state. Follows an approved /
 * executing proposal until the worker settles it.
 */
export function useAiProposal(proposalId: string) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.proposal(projectId, proposalId),
    queryFn: async ({ signal }) => {
      for (let page = 1; page <= 50; page++) {
        const r = await api(aiRoutes.listProposals, { params: { projectId }, query: { page, pageSize: 100 }, signal });
        const hit = r.items.find((p) => p.id === proposalId);
        if (hit) return hit;
        if (page * r.pageSize >= r.total) break;
      }
      return null;
    },
    enabled: can('ai.proposal.read'),
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'approved' || q.state.data.status === 'executing') ? 2000 : false),
  });
}

export function useBriefings(enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.briefings(projectId),
    queryFn: ({ signal }) => api(aiRoutes.listBriefings, { params: { projectId }, signal }),
    enabled: enabled && can('ai.briefing.subscribe'),
  });
}

export function useDetections(enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.detections(projectId),
    queryFn: ({ signal }) => api(aiRoutes.detections, { params: { projectId }, signal }),
    enabled: enabled && can('planning.plan.read'),
  });
}

export function useAiTools(enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: ak.tools(projectId),
    queryFn: ({ signal }) => api(aiRoutes.tools, { params: { projectId }, signal }),
    enabled: enabled && can('ai.assistant.use'),
    staleTime: 5 * 60_000,
  });
}

/**
 * Display names of project members (requesters, approvers, recipients). Only for holders of admin.role_assignment.read;
 * everyone else sees "You" or the short id the API returned — never a guessed name.
 */
export function useMemberNames(): People {
  const { projectId, can } = useP();
  const q = useQuery({
    queryKey: qk.members(projectId),
    queryFn: ({ signal }) => api(portfolioRoutes.listMembers, { params: { projectId }, signal }),
    enabled: can('admin.role_assignment.read'),
    staleTime: 60_000,
  });
  return useMemo(() => Object.fromEntries((q.data?.items ?? []).map((m) => [m.userId, m.displayName])), [q.data]);
}
