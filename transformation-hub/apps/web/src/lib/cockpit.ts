'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { governanceRoutes, type RouteResponse } from '@hub/contracts';
import type { DecisionStatus } from '@hub/domain';
import { api } from './api';

/**
 * Data for the DC Executive Cockpit (Screen 2, REQ-UX-005) — built only from existing, permission-checked list routes:
 * the decision register (`GET …/decisions`, classification applied in SQL, `sort=latestSafeDate` from its allow-list),
 * the agenda-request list (`GET …/agenda-requests`) and the gate list (`GET …/gates`, see lib/gates.ts). Every item shown
 * is one the API returned to this caller, so nothing the caller cannot read is ever displayed or counted.
 */

export type CockpitDecision = RouteResponse<typeof governanceRoutes.listDecisions>['items'][number];
export type CockpitAgendaItem = RouteResponse<typeof governanceRoutes.listAgendaRequests>['items'][number];

/** How many items each cockpit list shows ("top three"). */
export const COCKPIT_TOP = 3;

/**
 * Decisions still awaiting an outcome (decision state machine, packages/domain/src/workflows.ts): not yet approved,
 * rejected, superseded or in implementation. `recommended` awaits the external authority; `deferred` can be resumed.
 */
export const OPEN_DECISION_STATUSES = ['draft', 'submitted', 'under_review', 'recommended', 'deferred'] as const satisfies readonly DecisionStatus[];

/** Decision papers in the committee's hands: submitted to the secretariat, or under committee review. */
export const AWAITING_COMMITTEE_STATUSES = ['submitted', 'under_review'] as const satisfies readonly (typeof OPEN_DECISION_STATUSES)[number][];

type OpenStatus = (typeof OPEN_DECISION_STATUSES)[number];

/**
 * Query keys live under ['gov', projectId] (the governance root key), so every governance command's refresh
 * (useGovRefresh → invalidate ['gov', projectId]) also refreshes the cockpit.
 */
export const cockpitQk = {
  decisions: (projectId: string, status: OpenStatus) => ['gov', projectId, 'cockpit', 'decisions', status] as const,
  pendingAgenda: (projectId: string) => ['gov', projectId, 'cockpit', 'agenda', 'requested'] as const,
};

/** Latest safe decision date ascending (overdue dates come first), undated last; ties by id like the API's `sort`. */
export function byUrgency(a: CockpitDecision, b: CockpitDecision): number {
  if (a.latestSafeDate !== b.latestSafeDate) {
    if (a.latestSafeDate === null) return 1;
    if (b.latestSafeDate === null) return -1;
    return a.latestSafeDate < b.latestSafeDate ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Overdue = the latest safe decision date is before today in the project's time zone. */
export function isDecisionOverdue(d: Pick<CockpitDecision, 'latestSafeDate'>, today: string): boolean {
  return d.latestSafeDate !== null && d.latestSafeDate < today;
}

export interface OpenDecisions {
  /** Most urgent first; at most COCKPIT_TOP per status were fetched, which is enough for the overall top COCKPIT_TOP. */
  items: CockpitDecision[];
  /** Totals per status within the caller's scope (undefined while loading). */
  totals: Partial<Record<OpenStatus, number>>;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * The most urgent open decisions: one request per open status, each asking the register for its COCKPIT_TOP most urgent
 * rows (`sort=latestSafeDate`: ascending, NULLs last, ties by id). The overall top COCKPIT_TOP is always among those rows,
 * so no more than 3 × 5 visible rows are fetched and the totals come from the same responses.
 */
export function useOpenDecisions(projectId: string, enabled: boolean): OpenDecisions {
  return useQueries({
    queries: OPEN_DECISION_STATUSES.map((status) => ({
      queryKey: cockpitQk.decisions(projectId, status),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        api(governanceRoutes.listDecisions, { params: { projectId }, query: { page: 1, pageSize: COCKPIT_TOP, status, sort: 'latestSafeDate' }, signal }),
      enabled,
    })),
    combine: (results) => {
      const totals: Partial<Record<OpenStatus, number>> = {};
      OPEN_DECISION_STATUSES.forEach((s, i) => {
        const data = results[i]?.data;
        if (data) totals[s] = data.total;
      });
      return {
        items: results.flatMap((r) => r.data?.items ?? []).sort(byUrgency),
        totals,
        isLoading: results.some((r) => r.isLoading),
        error: results.find((r) => r.error)?.error ?? null,
        refetch: () => {
          for (const r of results) if (r.error) void r.refetch();
        },
      };
    },
  });
}

/** Agenda requests awaiting secretariat screening, oldest request first (the list's `createdAt` sort key). */
export function usePendingAgendaRequests(projectId: string, enabled: boolean) {
  return useQuery({
    queryKey: cockpitQk.pendingAgenda(projectId),
    queryFn: ({ signal }) =>
      api(governanceRoutes.listAgendaRequests, { params: { projectId }, query: { page: 1, pageSize: COCKPIT_TOP, screeningStatus: 'requested', sort: 'createdAt' }, signal }),
    enabled,
  });
}

export function decisionHref(projectId: string, decisionId: string): string {
  return `/projects/${projectId}/committee/decisions/${decisionId}`;
}

/** The decision register filtered by status (the list reads `?status=` from the URL). */
export function decisionListHref(projectId: string, status?: DecisionStatus): string {
  return `/projects/${projectId}/committee/decisions${status ? `?status=${status}` : ''}`;
}

/** The agenda-request list on the meetings screen, filtered to requests awaiting screening. */
export function pendingAgendaHref(projectId: string): string {
  return `/projects/${projectId}/committee/meetings?aStatus=requested#agenda-requests`;
}

/**
 * Where an agenda request is opened: its decision paper when the caller may read it (the API sends `decisionCode` only
 * for a visible decision), else its preferred meeting, else the agenda-request list.
 */
export function agendaItemHref(projectId: string, a: Pick<CockpitAgendaItem, 'decisionId' | 'decisionCode' | 'meetingId'>): string {
  if (a.decisionId && a.decisionCode) return decisionHref(projectId, a.decisionId);
  if (a.meetingId) return `/projects/${projectId}/committee/meetings/${a.meetingId}`;
  return pendingAgendaHref(projectId);
}
