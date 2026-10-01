'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { configRoutes as C, type RouteResponse } from '@hub/contracts';
import { api } from './api';
import { qk } from './queries';
import { pk } from './planning';

/** Project configuration (RAG thresholds, template upgrades, setup steps 7–8) and administration reads. */
export type RagThresholds = RouteResponse<typeof C.getRagThresholds>;
export type RagVersion = RagThresholds['versions'][number];
export type TemplateUpgrades = RouteResponse<typeof C.listTemplateUpgrades>;
export type TemplateUpgrade = TemplateUpgrades['items'][number];
export type UpgradePlan = TemplateUpgrade['plan'];
export type SetupState = RouteResponse<typeof C.getSetup>;
export type AdminTemplates = RouteResponse<typeof C.adminTemplates>;
export type DeploymentSettings = RouteResponse<typeof C.deploymentSettings>;

export const ck = {
  all: (pid: string) => ['project', pid, 'config'] as const,
  rag: (pid: string) => [...ck.all(pid), 'rag-thresholds'] as const,
  upgrades: (pid: string) => [...ck.all(pid), 'template-upgrades'] as const,
  setup: (pid: string) => [...ck.all(pid), 'setup'] as const,
  adminTemplates: ['admin', 'templates'] as const,
  adminDiff: (versionId: string, from: string) => ['admin', 'templates', 'diff', versionId, from] as const,
  deployment: ['admin', 'deployment-settings'] as const,
};

export function useRagThresholds(projectId: string, enabled = true) {
  return useQuery({ queryKey: ck.rag(projectId), queryFn: ({ signal }) => api(C.getRagThresholds, { params: { projectId }, signal }), enabled });
}

export function useTemplateUpgrades(projectId: string, enabled = true) {
  return useQuery({ queryKey: ck.upgrades(projectId), queryFn: ({ signal }) => api(C.listTemplateUpgrades, { params: { projectId }, signal }), enabled });
}

export function useSetup(projectId: string, enabled = true) {
  return useQuery({ queryKey: ck.setup(projectId), queryFn: ({ signal }) => api(C.getSetup, { params: { projectId }, signal }), enabled });
}

export function useAdminTemplates(enabled = true) {
  return useQuery({ queryKey: ck.adminTemplates, queryFn: ({ signal }) => api(C.adminTemplates, { signal }), enabled });
}

export function useDeploymentSettings(enabled = true) {
  return useQuery({ queryKey: ck.deployment, queryFn: ({ signal }) => api(C.deploymentSettings, { signal }), enabled });
}

/** After a configuration command: the configuration reads, the project (status, version, phases) and the planning health. */
export function useRefreshConfig(projectId: string) {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ck.all(projectId) }),
      qc.invalidateQueries({ queryKey: qk.project(projectId), exact: true }),
      qc.invalidateQueries({ queryKey: pk.all(projectId) }),
      qc.invalidateQueries({ queryKey: ['project', projectId, 'activity'] }),
    ]);
  };
}

export const settingsHref = (projectId: string, tab?: 'rag' | 'template') => `/projects/${projectId}/settings${tab ? `?tab=${tab}` : ''}`;
