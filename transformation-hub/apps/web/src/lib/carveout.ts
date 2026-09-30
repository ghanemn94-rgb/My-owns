'use client';

/**
 * Carve-out & NewCo data layer (Screens 7 and 8): query keys, types and refresh helpers. Everything goes through the
 * typed `api()` client; the API authorizes every read and command (the UI only hides what the caller cannot do).
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { carveoutRoutes as C, newcoRoutes as N, type RouteResponse } from '@hub/contracts';
import { dqk } from './documents';
import { pk } from './planning';
import { qk } from './queries';

export type PerimeterList = RouteResponse<typeof C.listPerimeterItems>;
export type PerimeterItem = PerimeterList['items'][number];
export type PerimeterDetail = RouteResponse<typeof C.getPerimeterItem>;
export type TransferRecord = PerimeterDetail['transfers'][number];
export type Day1Position = PerimeterDetail['day1'];
export type ImpactAssessment = RouteResponse<typeof C.listPerimeterImpacts>['items'][number];
export type ImpactEntry = ImpactAssessment['entries'][number];
export type Reconciliation = RouteResponse<typeof C.reconciliation>;
export type Day1Positions = RouteResponse<typeof C.day1Positions>;
export type PerimeterVersion = RouteResponse<typeof C.listPerimeterVersions>['items'][number];
export type Site = RouteResponse<typeof C.listSites>['items'][number];
export type AgreementSummary = RouteResponse<typeof C.listAgreements>['items'][number];
export type AgreementDetail = RouteResponse<typeof C.getAgreement>;
export type Consent = RouteResponse<typeof C.listConsents>['items'][number];
export type LegalEntity = RouteResponse<typeof N.listLegalEntities>['items'][number];
export type LegalEntityDetail = RouteResponse<typeof N.getLegalEntity>;
export type Requirement = RouteResponse<typeof N.getRequirement>;
export type IncorporationResult = RouteResponse<typeof N.recordIncorporation>;

export type TransferAspect = 'legal' | 'economic';
export const ASPECTS: readonly TransferAspect[] = ['legal', 'economic'];
export type TransferCmd = 'plan' | 'start' | 'report_transferred' | 'block' | 'unblock' | 'mark_not_applicable';
export const TRANSFER_CMDS: readonly TransferCmd[] = ['plan', 'start', 'report_transferred', 'block', 'unblock', 'mark_not_applicable'];

/** Query keys: carve-out and NewCo data of a project live under one prefix each so a command can refresh them. */
export const ck = {
  all: (pid: string) => ['project', pid, 'carveout'] as const,
  items: (pid: string, q: object) => [...ck.all(pid), 'items', q] as const,
  item: (pid: string, id: string) => [...ck.all(pid), 'item', id] as const,
  impacts: (pid: string, id: string) => [...ck.all(pid), 'impacts', id] as const,
  reconciliation: (pid: string) => [...ck.all(pid), 'reconciliation'] as const,
  day1: (pid: string) => [...ck.all(pid), 'day1'] as const,
  versions: (pid: string) => [...ck.all(pid), 'versions'] as const,
  sites: (pid: string) => [...ck.all(pid), 'sites'] as const,
  transfers: (pid: string, q: object) => [...ck.all(pid), 'transfers', q] as const,
  agreements: (pid: string, q: object) => [...ck.all(pid), 'agreements', q] as const,
  agreement: (pid: string, id: string) => [...ck.all(pid), 'agreement', id] as const,
  consents: (pid: string, q: object) => [...ck.all(pid), 'consents', q] as const,
  newco: (pid: string) => ['project', pid, 'newco'] as const,
  entities: (pid: string) => [...ck.newco(pid), 'entities'] as const,
  entity: (pid: string, id: string) => [...ck.newco(pid), 'entity', id] as const,
  requirements: (pid: string, q: object) => [...ck.newco(pid), 'requirements', q] as const,
  requirement: (pid: string, id: string) => [...ck.newco(pid), 'requirement', id] as const,
  dimensions: (pid: string) => ['project', pid, 'status-dimensions'] as const,
};

export const itemHref = (pid: string, id: string) => `/projects/${pid}/perimeter/items/${id}`;
export const agreementHref = (pid: string, id: string) => `/projects/${pid}/perimeter/agreements/${id}`;
export const entityHref = (pid: string, id: string) => `/projects/${pid}/newco/entities/${id}`;
export const requirementHref = (pid: string, id: string) => `/projects/${pid}/newco/requirements/${id}`;
export const changeRequestHref = (pid: string, id: string) => `/projects/${pid}/raid/changes/${id}`;

/**
 * After any carve-out / NewCo command: refresh both registers, the project (dimensions, setup gaps), planning change
 * requests (a perimeter change raises one) and evidence.
 */
export function useRefreshCarveout(projectId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ck.all(projectId) }),
      queryClient.invalidateQueries({ queryKey: ck.newco(projectId) }),
      queryClient.invalidateQueries({ queryKey: ck.dimensions(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.project(projectId) }),
      queryClient.invalidateQueries({ queryKey: pk.all(projectId) }),
    ]);
  };
}

/**
 * Evidence is written through the documents module (EvidencePanel refreshes its own keys). Records here show evidence
 * counts too, so refetch them whenever an evidence query of the project is refreshed.
 */
export function useFollowEvidence(projectId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const prefix = JSON.stringify(dqk.evidenceAll(projectId)).slice(0, -1);
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      // Only re-fetches after a change (the first load of an evidence list is not a change).
      if (event.query.state.dataUpdateCount < 2) return;
      if (!JSON.stringify(event.query.queryKey).startsWith(prefix)) return;
      void queryClient.invalidateQueries({ queryKey: ck.all(projectId) });
      void queryClient.invalidateQueries({ queryKey: ck.newco(projectId) });
    });
  }, [queryClient, projectId]);
}

export function localToday(timeZone = 'Asia/Riyadh'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
