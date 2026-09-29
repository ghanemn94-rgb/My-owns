'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsRoutes, gatesRoutes, governanceRoutes, type RouteResponse } from '@hub/contracts';
import type { RoleKey } from '@hub/domain';
import { api } from './api';

export type GateSummary = RouteResponse<typeof gatesRoutes.listGates>['items'][number];
export type GateDetail = RouteResponse<typeof gatesRoutes.getGate>;
export type GateCriterion = GateDetail['criteria'][number];
export type GateWaiver = GateDetail['waivers'][number];
export type GateBlocker = GateSummary['blockers'][number];
export type GateCycle = GateDetail['cycles'][number];
export type StatusDimensions = RouteResponse<typeof gatesRoutes.getStatusDimensions>;
export type EvidenceLink = RouteResponse<typeof documentsRoutes.listEvidence>['items'][number];

export const gatesQk = {
  all: (projectId: string) => ['project', projectId, 'gates'] as const,
  list: (projectId: string) => ['project', projectId, 'gates', 'list'] as const,
  detail: (projectId: string, gateId: string) => ['project', projectId, 'gates', 'detail', gateId] as const,
  waivers: (projectId: string) => ['project', projectId, 'gates', 'waivers'] as const,
  evidence: (projectId: string, criterionId: string) => ['project', projectId, 'gates', 'evidence', criterionId] as const,
  dimensions: (projectId: string) => ['project', projectId, 'status-dimensions'] as const,
  decisionOptions: (projectId: string) => ['project', projectId, 'gates', 'decision-options'] as const,
  documentOptions: (projectId: string) => ['project', projectId, 'gates', 'document-options'] as const,
};

export function useGates(projectId: string, enabled = true) {
  return useQuery({
    queryKey: gatesQk.list(projectId),
    queryFn: ({ signal }) => api(gatesRoutes.listGates, { params: { projectId }, signal }),
    enabled,
  });
}

export function useGate(projectId: string, gateId: string) {
  return useQuery({
    queryKey: gatesQk.detail(projectId, gateId),
    queryFn: ({ signal }) => api(gatesRoutes.getGate, { params: { projectId, gateId }, signal }),
  });
}

export function useGateWaivers(projectId: string, enabled = true) {
  return useQuery({
    queryKey: gatesQk.waivers(projectId),
    queryFn: ({ signal }) => api(gatesRoutes.listWaivers, { params: { projectId }, query: {}, signal }),
    enabled,
  });
}

/** Evidence links of a criterion from the DOCUMENTS module (links to documents the caller cannot read are omitted). */
export function useCriterionEvidence(projectId: string, criterionId: string, enabled = true) {
  return useQuery({
    queryKey: gatesQk.evidence(projectId, criterionId),
    queryFn: ({ signal }) =>
      api(documentsRoutes.listEvidence, { params: { projectId }, query: { targetType: 'gate_criterion', targetId: criterionId, includeInactive: 'true' }, signal }),
    enabled,
  });
}

export function useStatusDimensions(projectId: string, enabled = true) {
  return useQuery({
    queryKey: gatesQk.dimensions(projectId),
    queryFn: ({ signal }) => api(gatesRoutes.getStatusDimensions, { params: { projectId }, signal }),
    enabled,
  });
}

/** Decisions the caller may link (governance register; the server re-validates the link and the decision state). */
export function useDecisionOptions(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: gatesQk.decisionOptions(projectId),
    queryFn: ({ signal }) => api(governanceRoutes.listDecisions, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }),
    enabled,
  });
}

export function useDocumentOptions(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: gatesQk.documentOptions(projectId),
    queryFn: ({ signal }) => api(documentsRoutes.listDocuments, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }),
    enabled,
  });
}

/** Invalidate everything a gate command can change (gate views, waivers, cockpit project summary). */
export function useInvalidateGates(projectId: string) {
  const qc = useQueryClient();
  return async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: gatesQk.all(projectId) }),
      qc.invalidateQueries({ queryKey: gatesQk.dimensions(projectId) }),
      qc.invalidateQueries({ queryKey: ['project', projectId], exact: true }),
    ]);
  };
}

/** Gates whose decision the given roles may record (approver role of the gate — the server enforces it). */
export function holdsRole(roles: readonly RoleKey[] | undefined, role: RoleKey): boolean {
  return Boolean(roles?.includes(role));
}

/**
 * Whether the caller is the criterion's DESIGNATED reviewer (mirrors the server rule, which stays authoritative):
 * a project-wide role, or, for `workstream_lead`, a workstream lead role on any workstream of the project.
 */
export function isDesignatedReviewer(access: { roles: readonly RoleKey[]; workstreamRoles: readonly { role: RoleKey }[] } | undefined, reviewerRole: RoleKey): boolean {
  if (!access) return false;
  return access.roles.includes(reviewerRole) || (reviewerRole === 'workstream_lead' && access.workstreamRoles.some((w) => w.role === 'workstream_lead'));
}

/** First gate (template order) whose current cycle is not approved — the cockpit's "next gate". */
export function nextGate(gates: GateSummary[]): GateSummary | null {
  return [...gates].sort((a, b) => a.sortOrder - b.sortOrder).find((g) => g.assessment.status !== 'approved' && g.assessment.status !== 'approved_with_exceptions') ?? null;
}

export const DIMENSION_GATES: Record<string, string[]> = {
  incorporation: ['G2'],
  perimeter_transfer: ['G1', 'G3', 'G4'],
  operational_readiness: ['G3', 'G4', 'G7'],
  jv_transaction: ['G5', 'G6'],
};
