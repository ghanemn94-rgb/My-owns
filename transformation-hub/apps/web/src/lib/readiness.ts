'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { carveoutRoutes, governanceRoutes, readinessRoutes, type RouteQuery, type RouteResponse } from '@hub/contracts';
import { api } from './api';
import { useProjectContext } from './project-context';

/** Day-1 & TSA Center (spec §10 screen 9) — types, query keys and hooks. The API authorizes every call. */

export type ReadinessSummary = RouteResponse<typeof readinessRoutes.getReadinessSummary>;
export type ReadinessCheck = RouteResponse<typeof readinessRoutes.listReadinessChecks>['items'][number];
export type ReadinessCheckDetail = RouteResponse<typeof readinessRoutes.getReadinessCheck>;
export type ReadinessWaiver = RouteResponse<typeof readinessRoutes.listReadinessWaivers>['items'][number];
export type CutoverPlan = RouteResponse<typeof readinessRoutes.listCutoverPlans>['items'][number];
export type CutoverPlanDetail = RouteResponse<typeof readinessRoutes.getCutoverPlan>;
export type TsaService = RouteResponse<typeof readinessRoutes.listTsaServices>['items'][number];
export type TsaServiceDetail = RouteResponse<typeof readinessRoutes.getTsaService>;
export type People = Record<string, string>;

export const rk = {
  root: (pid: string) => ['readiness', pid] as const,
  summary: (pid: string) => ['readiness', pid, 'summary'] as const,
  checks: (pid: string, q: object) => ['readiness', pid, 'checks', q] as const,
  check: (pid: string, id: string) => ['readiness', pid, 'check', id] as const,
  waivers: (pid: string, q: object) => ['readiness', pid, 'waivers', q] as const,
  plans: (pid: string, q: object) => ['readiness', pid, 'plans', q] as const,
  plan: (pid: string, id: string) => ['readiness', pid, 'plan', id] as const,
  tsas: (pid: string, q: object) => ['readiness', pid, 'tsas', q] as const,
  tsa: (pid: string, id: string) => ['readiness', pid, 'tsa', id] as const,
  sites: (pid: string) => ['readiness', pid, 'sites'] as const,
  decisions: (pid: string) => ['readiness', pid, 'decisions'] as const,
};

export function rdHref(projectId: string, segment = '') {
  return `/projects/${projectId}/readiness${segment}`;
}

/** After any readiness command: refresh every readiness query, evidence, dimensions and the activity feed. */
export function useReadinessRefresh() {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: rk.root(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
    ]);
  }, [queryClient, projectId]);
}

export function useReadinessSummary() {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: rk.summary(projectId), queryFn: ({ signal }) => api(readinessRoutes.getReadinessSummary, { params: { projectId }, signal }) });
}

export function useChecks(query: RouteQuery<typeof readinessRoutes.listReadinessChecks>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: rk.checks(projectId, query),
    queryFn: ({ signal }) => api(readinessRoutes.listReadinessChecks, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function usePlans(query: RouteQuery<typeof readinessRoutes.listCutoverPlans>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: rk.plans(projectId, query),
    queryFn: ({ signal }) => api(readinessRoutes.listCutoverPlans, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

export function useTsas(query: RouteQuery<typeof readinessRoutes.listTsaServices>) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: rk.tsas(projectId, query),
    queryFn: ({ signal }) => api(readinessRoutes.listTsaServices, { params: { projectId }, query, signal }),
    placeholderData: (prev) => prev,
  });
}

/** Sites of the project (carve-out register) — only for holders of carveout.register.read; otherwise ids are shown. */
export function useSites(enabled = true) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: rk.sites(projectId),
    queryFn: ({ signal }) => api(carveoutRoutes.listSites, { params: { projectId }, signal }),
    enabled: enabled && can('carveout.register.read'),
    staleTime: 60_000,
  });
}

/** Governance decisions (governance owns them; readiness only links them) filtered to the given decision types. */
export function useDecisionsOfTypes(typeKeys: readonly string[], enabled: boolean) {
  const { projectId, can } = useProjectContext();
  const q = useQuery({
    queryKey: rk.decisions(projectId),
    queryFn: ({ signal }) => api(governanceRoutes.listDecisions, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }),
    enabled: enabled && can('governance.decision.read'),
  });
  const items = (q.data?.items ?? []).filter((d) => d.decisionTypeKey && typeKeys.includes(d.decisionTypeKey) && d.status !== 'rejected' && d.status !== 'superseded');
  return { ...q, items };
}

/** Decision types (authority-matrix keys) the server accepts for go-live / TSA decisions (single source: @hub/domain). */
export { GO_DECISION_TYPE_KEYS, TSA_DECISION_TYPE_KEYS } from '@hub/domain';
