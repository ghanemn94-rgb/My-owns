'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { documentsRoutes, governanceRoutes, jvRoutes, portfolioRoutes, type Me, type RouteQuery, type RouteResponse } from '@hub/contracts';
import { api } from './api';
import { useProjectContext } from './project-context';
import { qk } from './queries';

/**
 * JV & Diligence (spec §10 screen 11; spec §8) — types, query keys and hooks. The API authorizes every call; the
 * screens only show what it returns (no partner identity, percentage, valuation or term is ever derived here).
 */

export type Partner = RouteResponse<typeof jvRoutes.listPartners>['items'][number];
export type PartnerDetail = RouteResponse<typeof jvRoutes.getPartner>;
export type CriteriaSet = NonNullable<RouteResponse<typeof jvRoutes.getCriteria>['criteriaSet']>;
export type Comparison = RouteResponse<typeof jvRoutes.comparePartners>;
export type Assessment = RouteResponse<typeof jvRoutes.listAssessments>['items'][number];
export type Proposal = RouteResponse<typeof jvRoutes.listProposals>['items'][number];
export type Scenario = RouteResponse<typeof jvRoutes.listScenarios>['items'][number];
export type ScenarioDetail = RouteResponse<typeof jvRoutes.getScenario>;
export type NegotiationIssue = RouteResponse<typeof jvRoutes.listNegotiationIssues>['items'][number];
export type Room = RouteResponse<typeof jvRoutes.listRooms>['items'][number];
export type RoomDetail = RouteResponse<typeof jvRoutes.getRoom>;
export type RoomIndexItem = RouteResponse<typeof jvRoutes.getRoomIndex>['items'][number];
export type RoomGrant = RouteResponse<typeof jvRoutes.listRoomGrants>['items'][number];
export type Disclosure = RouteResponse<typeof jvRoutes.listDisclosures>['items'][number];
export type RoomAccessEvent = RouteResponse<typeof jvRoutes.listRoomAccessLog>['items'][number];
export type DdRequest = RouteResponse<typeof jvRoutes.listDdRequests>['items'][number];
export type DdRequestDetail = RouteResponse<typeof jvRoutes.getDdRequest>;
export type Finding = RouteResponse<typeof jvRoutes.listFindings>['items'][number];
export type TxEvent = RouteResponse<typeof jvRoutes.listClosings>['items'][number];
export type TxEventDetail = RouteResponse<typeof jvRoutes.getClosing>;
export type EventBlocker = TxEventDetail['blockers'][number];
export type ChecklistItem = TxEventDetail['checklist'][number];
export type Condition = RouteResponse<typeof jvRoutes.listConditions>['items'][number];
export type ConditionDetail = RouteResponse<typeof jvRoutes.getCondition>;
export type FundsFlow = RouteResponse<typeof jvRoutes.listFundsFlows>['items'][number];
export type Obligation = RouteResponse<typeof jvRoutes.listObligations>['items'][number];
export type ProgramClosure = RouteResponse<typeof jvRoutes.getProgramClosure>;
export type ExternalRoom = RouteResponse<typeof jvRoutes.listExternalRooms>['items'][number];
export type ExternalDisclosure = RouteResponse<typeof jvRoutes.listExternalDisclosures>['items'][number];
export type ExternalDdRequest = RouteResponse<typeof jvRoutes.listExternalDdRequests>['items'][number];
export type People = Record<string, string>;
export type EventKind = 'signing' | 'closing';

/** Every JV query lives under ['jv', projectId] so one invalidation refreshes the whole screen. */
export const jk = {
  root: (pid: string) => ['jv', pid] as const,
  partners: (pid: string, q: object) => ['jv', pid, 'partners', q] as const,
  partner: (pid: string, id: string) => ['jv', pid, 'partner', id] as const,
  criteria: (pid: string) => ['jv', pid, 'criteria'] as const,
  comparison: (pid: string) => ['jv', pid, 'comparison'] as const,
  assessments: (pid: string, id: string) => ['jv', pid, 'partner', id, 'assessments'] as const,
  proposals: (pid: string, id: string) => ['jv', pid, 'partner', id, 'proposals'] as const,
  scenarios: (pid: string, q: object) => ['jv', pid, 'scenarios', q] as const,
  scenario: (pid: string, id: string) => ['jv', pid, 'scenario', id] as const,
  issues: (pid: string, q: object) => ['jv', pid, 'issues', q] as const,
  rooms: (pid: string, q: object) => ['jv', pid, 'rooms', q] as const,
  room: (pid: string, id: string) => ['jv', pid, 'room', id] as const,
  roomIndex: (pid: string, id: string, q: object) => ['jv', pid, 'room', id, 'index', q] as const,
  roomGrants: (pid: string, id: string) => ['jv', pid, 'room', id, 'grants'] as const,
  disclosures: (pid: string, id: string, q: object) => ['jv', pid, 'room', id, 'disclosures', q] as const,
  accessLog: (pid: string, id: string, q: object) => ['jv', pid, 'room', id, 'log', q] as const,
  ddRequests: (pid: string, q: object) => ['jv', pid, 'dd', q] as const,
  ddRequest: (pid: string, id: string) => ['jv', pid, 'dd-request', id] as const,
  findings: (pid: string, q: object) => ['jv', pid, 'findings', q] as const,
  finding: (pid: string, id: string) => ['jv', pid, 'finding', id] as const,
  events: (pid: string, kind: EventKind, q: object) => ['jv', pid, 'events', kind, q] as const,
  event: (pid: string, kind: EventKind, id: string) => ['jv', pid, 'event', kind, id] as const,
  conditions: (pid: string, q: object) => ['jv', pid, 'conditions', q] as const,
  condition: (pid: string, id: string) => ['jv', pid, 'condition', id] as const,
  flows: (pid: string, closingId: string) => ['jv', pid, 'flows', closingId] as const,
  obligations: (pid: string, q: object) => ['jv', pid, 'obligations', q] as const,
  programClosure: (pid: string) => ['jv', pid, 'program-closure'] as const,
  documents: (pid: string, q: object) => ['jv', pid, 'documents', q] as const,
};

/** Counterparty (external) projection keys — never mixed with the internal ones. */
export const xk = {
  rooms: (pid: string) => ['partner-access', pid, 'rooms'] as const,
  disclosures: (pid: string, roomId: string) => ['partner-access', pid, 'room', roomId, 'disclosures'] as const,
  ddRequests: (pid: string, roomId: string) => ['partner-access', pid, 'room', roomId, 'dd'] as const,
};

/**
 * Projects where the signed-in account acts as a counterparty (external_partner_limited in a partner room). UI hint only:
 * the partner-access routes enforce the permission and the room grant on the server.
 */
export function counterpartyProjects(me: Me | undefined) {
  return (me?.projects ?? []).filter((p) => p.permissions.includes('jv.disclosure.view'));
}

export function jvHref(projectId: string, segment = '') {
  return `/projects/${projectId}/jv${segment}`;
}

export function partnerAccessHref(projectId?: string, roomId?: string) {
  if (!projectId) return '/partner-access';
  return roomId ? `/partner-access/${projectId}/${roomId}` : '/partner-access';
}

/** After any JV command: refresh every JV query, the evidence panels, dimensions and the activity feed. */
export function useJvRefresh() {
  const queryClient = useQueryClient();
  const { projectId } = useProjectContext();
  return useCallback(async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: jk.root(projectId) }), queryClient.invalidateQueries({ queryKey: ['project', projectId] })]);
  }, [queryClient, projectId]);
}

function useP() {
  return useProjectContext();
}

// ---------------------------------------------------------------------------------------------------------------
// Partners, criteria, assessments and proposals

export function usePartners(query: RouteQuery<typeof jvRoutes.listPartners>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.partners(projectId, query),
    queryFn: ({ signal }) => api(jvRoutes.listPartners, { params: { projectId }, query, signal }),
    enabled: enabled && can('jv.partner.read'),
    placeholderData: (prev) => prev,
  });
}

/** Partner labels (code — name) for references on other records; ids are shown when the caller cannot read partners. */
export function usePartnerNames() {
  const list = usePartners({ page: 1, pageSize: 100 });
  const map = useMemo(() => new Map((list.data?.items ?? []).map((p) => [p.id, p])), [list.data]);
  const label = useCallback((id: string | null | undefined) => {
    if (!id) return null;
    const p = map.get(id);
    return p ? `${p.code} — ${p.name}` : `#${id.slice(-6)}`;
  }, [map]);
  return { items: list.data?.items ?? [], label, isDemo: (id: string | null | undefined) => (id ? map.get(id)?.isDemo ?? false : false) };
}

export function usePartner(partnerId: string) {
  const { projectId } = useP();
  return useQuery({ queryKey: jk.partner(projectId, partnerId), queryFn: ({ signal }) => api(jvRoutes.getPartner, { params: { projectId, partnerId }, signal }) });
}

export function useCriteria() {
  const { projectId, can } = useP();
  return useQuery({ queryKey: jk.criteria(projectId), queryFn: ({ signal }) => api(jvRoutes.getCriteria, { params: { projectId }, signal }), enabled: can('jv.partner.read') });
}

export function useComparison() {
  const { projectId, can } = useP();
  return useQuery({ queryKey: jk.comparison(projectId), queryFn: ({ signal }) => api(jvRoutes.comparePartners, { params: { projectId }, signal }), enabled: can('jv.deal.read') });
}

export function useAssessments(partnerId: string | null) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.assessments(projectId, partnerId ?? ''),
    queryFn: ({ signal }) => api(jvRoutes.listAssessments, { params: { projectId, partnerId: partnerId! }, signal }),
    enabled: !!partnerId && can('jv.deal.read'),
  });
}

export function useProposals(partnerId: string | null) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.proposals(projectId, partnerId ?? ''),
    queryFn: ({ signal }) => api(jvRoutes.listProposals, { params: { projectId, partnerId: partnerId! }, signal }),
    enabled: !!partnerId && can('jv.deal.read'),
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Scenarios and negotiation issues

export function useScenarios(query: RouteQuery<typeof jvRoutes.listScenarios>) {
  const { projectId } = useP();
  return useQuery({ queryKey: jk.scenarios(projectId, query), queryFn: ({ signal }) => api(jvRoutes.listScenarios, { params: { projectId }, query, signal }), placeholderData: (prev) => prev });
}

export function useScenario(scenarioId: string) {
  const { projectId } = useP();
  return useQuery({ queryKey: jk.scenario(projectId, scenarioId), queryFn: ({ signal }) => api(jvRoutes.getScenario, { params: { projectId, scenarioId }, signal }) });
}

export function useIssues(query: RouteQuery<typeof jvRoutes.listNegotiationIssues>) {
  const { projectId } = useP();
  return useQuery({ queryKey: jk.issues(projectId, query), queryFn: ({ signal }) => api(jvRoutes.listNegotiationIssues, { params: { projectId }, query, signal }), placeholderData: (prev) => prev });
}

// ---------------------------------------------------------------------------------------------------------------
// Rooms / VDR

export function useRooms(query: RouteQuery<typeof jvRoutes.listRooms>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.rooms(projectId, query),
    queryFn: ({ signal }) => api(jvRoutes.listRooms, { params: { projectId }, query, signal }),
    enabled: enabled && can('jv.room.read'),
    placeholderData: (prev) => prev,
  });
}

/** Room names for references (DD requests, findings). Rooms the caller cannot see are shown by short id only. */
export function useRoomNames() {
  const list = useRooms({ page: 1, pageSize: 100 });
  const map = useMemo(() => new Map((list.data?.items ?? []).map((r) => [r.id, r])), [list.data]);
  const label = useCallback((id: string | null | undefined) => (id ? map.get(id)?.name ?? `#${id.slice(-6)}` : null), [map]);
  return { items: list.data?.items ?? [], isLoading: list.isLoading, label, get: (id: string | null | undefined) => (id ? map.get(id) : undefined) };
}

export function useRoom(roomId: string) {
  const { projectId } = useP();
  return useQuery({ queryKey: jk.room(projectId, roomId), queryFn: ({ signal }) => api(jvRoutes.getRoom, { params: { projectId, roomId }, signal }) });
}

// ---------------------------------------------------------------------------------------------------------------
// Diligence

export function useDdRequests(query: RouteQuery<typeof jvRoutes.listDdRequests>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.ddRequests(projectId, query),
    queryFn: ({ signal }) => api(jvRoutes.listDdRequests, { params: { projectId }, query, signal }),
    enabled: enabled && can('jv.dd_request.read'),
    placeholderData: (prev) => prev,
  });
}

export function useFindings(query: RouteQuery<typeof jvRoutes.listFindings>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.findings(projectId, query),
    queryFn: ({ signal }) => api(jvRoutes.listFindings, { params: { projectId }, query, signal }),
    enabled: enabled && can('jv.dd_request.read'),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Signing & closing, CPs, funds flow, post-close

export function useEvents(kind: EventKind, query: RouteQuery<typeof jvRoutes.listClosings>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.events(projectId, kind, query),
    queryFn: ({ signal }) => (kind === 'closing' ? api(jvRoutes.listClosings, { params: { projectId }, query, signal }) : api(jvRoutes.listSignings, { params: { projectId }, query, signal })),
    enabled: enabled && can('jv.deal.read'),
    placeholderData: (prev) => prev,
  });
}

export function useEvent(kind: EventKind, eventId: string) {
  const { projectId } = useP();
  return useQuery({
    queryKey: jk.event(projectId, kind, eventId),
    queryFn: ({ signal }) => (kind === 'closing' ? api(jvRoutes.getClosing, { params: { projectId, eventId }, signal }) : api(jvRoutes.getSigning, { params: { projectId, eventId }, signal })),
  });
}

export function useConditions(query: RouteQuery<typeof jvRoutes.listConditions>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.conditions(projectId, query),
    queryFn: ({ signal }) => api(jvRoutes.listConditions, { params: { projectId }, query, signal }),
    enabled: enabled && can('jv.deal.read'),
    placeholderData: (prev) => prev,
  });
}

export function useFlows(closingId: string | null) {
  const { projectId } = useP();
  return useQuery({
    queryKey: jk.flows(projectId, closingId ?? ''),
    queryFn: ({ signal }) => api(jvRoutes.listFundsFlows, { params: { projectId, eventId: closingId! }, signal }),
    enabled: !!closingId,
  });
}

export function useObligations(query: RouteQuery<typeof jvRoutes.listObligations>, enabled = true) {
  const { projectId, can } = useP();
  return useQuery({
    queryKey: jk.obligations(projectId, query),
    queryFn: ({ signal }) => api(jvRoutes.listObligations, { params: { projectId }, query, signal }),
    enabled: enabled && can('jv.deal.read'),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Documents used by JV commands (the documents module owns them; the API re-checks visibility and room filing)

export function useJvDocuments(q: string, enabled: boolean) {
  const { projectId, can } = useP();
  const query = { page: 1, pageSize: 50, q: q || undefined };
  return useQuery({
    queryKey: jk.documents(projectId, query),
    queryFn: ({ signal }) => api(documentsRoutes.listDocuments, { params: { projectId }, query, signal }),
    enabled: enabled && can('documents.document.read'),
  });
}

/**
 * Governance decisions that can be linked (governance owns them): of the given types, or any type when `typeKeys` is
 * null. Rejected / superseded decisions are not offered; the server re-validates type, project and final approval.
 */
export function useDecisionOptions(typeKeys: readonly string[] | null, enabled = true) {
  const { projectId, can } = useP();
  const q = useQuery({
    queryKey: ['jv', projectId, 'decision-options'],
    queryFn: ({ signal }) => api(governanceRoutes.listDecisions, { params: { projectId }, query: { page: 1, pageSize: 100 }, signal }),
    enabled: enabled && can('governance.decision.read'),
  });
  const items = (q.data?.items ?? []).filter((d) => (typeKeys === null || (d.decisionTypeKey && typeKeys.includes(d.decisionTypeKey))) && d.status !== 'rejected' && d.status !== 'superseded');
  return { ...q, items };
}

/**
 * Display names of project members (for records whose response carries no people map, e.g. a finding's remediation
 * owner). Only for holders of admin.role_assignment.read; everyone else sees the short id the API returned.
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

/** Governance decision types that authorize a signing / closing confirmation (single source: @hub/domain). */
export { CLOSING_DECISION_TYPE_KEYS, SIGNING_DECISION_TYPE_KEYS, FUNDS_FLOW_NOTICE, EXTERNAL_GRANT_MAX_DAYS } from '@hub/domain';
