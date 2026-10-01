'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { integrationsRoutes, type RouteQuery, type RouteResponse } from '@hub/contracts';
import { api } from './api';

/**
 * Integration connectors with honest status (spec §17; REQ-INT-006..010/013/014; screen 16b integrations part). The status
 * comes from the API only: "Verified" appears only after a real connectivity check (or, inbound, a validly signed ping).
 */
type R = typeof integrationsRoutes;
export type IntegrationAdapter = RouteResponse<R['listIntegrations']>['items'][number];
export type IntegrationLog = RouteResponse<R['integrationLogs']>['items'][number];
export type WebhookDelivery = RouteResponse<R['integrationDeliveries']>['items'][number];

export const gk = {
  root: ['integrations'] as const,
  org: ['integrations', 'org'] as const,
  project: (pid: string) => ['integrations', 'project', pid] as const,
  logs: (key: string, q: object) => ['integrations', 'logs', key, q] as const,
  deliveries: (key: string, q: object) => ['integrations', 'deliveries', key, q] as const,
};

export function useOrgIntegrations(enabled: boolean) {
  return useQuery({ queryKey: gk.org, queryFn: ({ signal }) => api(integrationsRoutes.listIntegrations, { signal }), enabled });
}

export function useProjectIntegrations(projectId: string, enabled: boolean) {
  return useQuery({ queryKey: gk.project(projectId), queryFn: ({ signal }) => api(integrationsRoutes.listProjectIntegrations, { params: { projectId }, signal }), enabled });
}

export function useIntegrationLogs(adapterKey: string, query: RouteQuery<R['integrationLogs']>, enabled: boolean) {
  return useQuery({ queryKey: gk.logs(adapterKey, query), queryFn: ({ signal }) => api(integrationsRoutes.integrationLogs, { params: { adapterKey }, query, signal }), enabled, placeholderData: (prev) => prev });
}

export function useIntegrationDeliveries(adapterKey: string, query: RouteQuery<R['integrationDeliveries']>, enabled: boolean) {
  return useQuery({ queryKey: gk.deliveries(adapterKey, query), queryFn: ({ signal }) => api(integrationsRoutes.integrationDeliveries, { params: { adapterKey }, query, signal }), enabled, placeholderData: (prev) => prev });
}

export function useIntegrationsRefresh() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: gk.root });
  }, [qc]);
}

/** Tone of an honest status: only Verified is a success; Simulated / Configured-unverified are warnings. */
export function integrationTone(status: IntegrationAdapter['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'verified') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'configured_unverified' || status === 'simulated') return 'warning';
  return 'neutral';
}
