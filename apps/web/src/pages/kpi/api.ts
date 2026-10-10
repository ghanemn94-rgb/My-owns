// Slice A web seams (T-DG4-FE-B; p4-work-split §A.5): the request paths and read hooks of the KPI engine screens.
// Query keys come from FE-A's `p4Keys.area(<slice A area>, tid, …)` (api/p4.ts), so `useP4Refresh(tid)` refreshes
// every KPI view of the transformation after a mutation. Writes are sent by the screens with `api.send` (If-Match from
// the record's `version`) inside a session guard.
//
// Unknown is data, never a default: a null value stays null here and renders as Unknown / Stale / Not computable with
// its reason, never as 0 and never green.
import { useQuery } from "@tanstack/react-query";
import type {
  CalculationRun,
  DataQualityFinding,
  KpiActual,
  KpiActualSubmission,
  KpiDictionaryEntry,
  KpiRagThreshold,
  KpiStatus,
  KpiVersion,
  RagOverride,
  ReportingPeriod,
  TargetTrajectory,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import type { Evidence } from "../../api/types.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  CalculationRun,
  DataQualityFinding,
  Evidence,
  KpiActual,
  KpiActualSubmission,
  KpiDictionaryEntry,
  KpiRagThreshold,
  KpiStatus,
  KpiVersion,
  RagOverride,
  ReportingPeriod,
  TargetTrajectory,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the 39 slice A operations (operationId in the comment). */
export const kpiPaths = {
  // dictionary and versions (KBE-B)
  dictionary: (tid: string) => `${tBase(tid)}/kpi-dictionary`, // listKpiDictionary
  dictionaryEntry: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/dictionary-entry`, // getKpiDictionaryEntry
  versions: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/versions`, // list/createKpiVersion
  version: (tid: string, versionId: string) => `${tBase(tid)}/kpi-versions/${versionId}`, // get/updateKpiVersion
  activateVersion: (tid: string, versionId: string) => `${tBase(tid)}/kpi-versions/${versionId}/activate`, // activateKpiVersion
  withdrawVersion: (tid: string, versionId: string) => `${tBase(tid)}/kpi-versions/${versionId}/withdraw`, // withdrawKpiVersion
  versionApproval: (tid: string, versionId: string) => `${tBase(tid)}/kpi-versions/${versionId}/approval-requests`, // requestKpiVersionApproval
  // thresholds and trajectories (KBE-B)
  thresholds: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/rag-thresholds`, // list/createKpiRagThreshold
  trajectories: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/trajectories`, // list/createTargetTrajectory
  trajectory: (tid: string, id: string) => `${tBase(tid)}/target-trajectories/${id}`, // getTargetTrajectory
  approveTrajectory: (tid: string, id: string) => `${tBase(tid)}/target-trajectories/${id}/approve`, // approveTargetTrajectory
  withdrawTrajectory: (tid: string, id: string) => `${tBase(tid)}/target-trajectories/${id}/withdraw`, // withdrawTargetTrajectory
  // reporting periods (KBE-C; organization level)
  periods: (orgId: string) => `${v1}/organizations/${orgId}/reporting-periods`, // list/createReportingPeriod
  transformationPeriods: (tid: string) => `${tBase(tid)}/reporting-periods`, // listTransformationReportingPeriods
  period: (orgId: string, id: string) => `${v1}/organizations/${orgId}/reporting-periods/${id}`, // getReportingPeriod
  openPeriod: (orgId: string, id: string) => `${v1}/organizations/${orgId}/reporting-periods/${id}/open`, // openReportingPeriod
  closePeriod: (orgId: string, id: string) => `${v1}/organizations/${orgId}/reporting-periods/${id}/close`, // closeReportingPeriod
  // actuals (KBE-C)
  actuals: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/actuals`, // listKpiActuals / submitKpiActual
  actual: (tid: string, id: string) => `${tBase(tid)}/kpi-actuals/${id}`, // getKpiActual
  actualValues: (tid: string, id: string) => `${tBase(tid)}/kpi-actuals/${id}/values`, // addKpiActualValue
  submitDraft: (tid: string, id: string) => `${tBase(tid)}/kpi-actuals/${id}/submit`, // submitKpiActualDraft
  acceptActual: (tid: string, id: string) => `${tBase(tid)}/kpi-actuals/${id}/accept`, // acceptKpiActual
  rejectActual: (tid: string, id: string) => `${tBase(tid)}/kpi-actuals/${id}/reject`, // rejectKpiActual
  reviewQueue: (tid: string) => `${tBase(tid)}/kpi-actual-reviews`, // listKpiActualReviewQueue
  // runs, status, overrides (KBE-C)
  runs: (tid: string) => `${tBase(tid)}/calculation-runs`, // listCalculationRuns
  run: (tid: string, id: string) => `${tBase(tid)}/calculation-runs/${id}`, // getCalculationRun
  statusList: (tid: string) => `${tBase(tid)}/kpi-status`, // listKpiStatus
  status: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/status`, // getKpiStatus
  overrides: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/rag-overrides`, // list/createRagOverride
  revokeOverride: (tid: string, id: string) => `${tBase(tid)}/rag-overrides/${id}/revoke`, // revokeRagOverride
  // data quality (KBE-B)
  findings: (tid: string) => `${tBase(tid)}/data-quality-findings`, // listDataQualityFindings
  finding: (tid: string, id: string) => `${tBase(tid)}/data-quality-findings/${id}`, // getDataQualityFinding
  resolveFinding: (tid: string, id: string) => `${tBase(tid)}/data-quality-findings/${id}/resolve`, // resolveDataQualityFinding
};

// ------------------------------------------------------------------------------------------------ read hooks

const opts = { retry: shouldRetry } as const;

export function useKpiDictionary(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("kpis", tid, "dictionary"),
    queryFn: () => fetchAllPages<KpiDictionaryEntry>(kpiPaths.dictionary(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useKpiDictionaryEntry(tid: string, kpiId: string) {
  return useQuery({
    queryKey: p4Keys.area("kpis", tid, "entry", kpiId),
    queryFn: () => api.get<KpiDictionaryEntry>(kpiPaths.dictionaryEntry(tid, kpiId)),
    enabled: Boolean(tid && kpiId),
    ...opts,
  });
}

export function useKpiVersions(tid: string, kpiId: string) {
  return useQuery({
    queryKey: p4Keys.area("kpis", tid, "versions", kpiId),
    queryFn: () => fetchAllPages<KpiVersion>(kpiPaths.versions(tid, kpiId)),
    enabled: Boolean(tid && kpiId),
    ...opts,
  });
}

export function useKpiThresholds(tid: string, kpiId: string) {
  return useQuery({
    queryKey: p4Keys.area("kpis", tid, "thresholds", kpiId),
    queryFn: () => fetchAllPages<KpiRagThreshold>(kpiPaths.thresholds(tid, kpiId)),
    enabled: Boolean(tid && kpiId),
    ...opts,
  });
}

export function useKpiTrajectories(tid: string, kpiId: string) {
  return useQuery({
    queryKey: p4Keys.area("kpis", tid, "trajectories", kpiId),
    queryFn: () => fetchAllPages<TargetTrajectory>(kpiPaths.trajectories(tid, kpiId)),
    enabled: Boolean(tid && kpiId),
    ...opts,
  });
}

/** The organization's reporting periods; keyed under the transformation so a refresh after an action reloads them. */
export function useReportingPeriods(tid: string, orgId: string | undefined, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("reporting-periods", tid, orgId ?? "", JSON.stringify(query)),
    queryFn: () => fetchAllPages<ReportingPeriod>(kpiPaths.periods(orgId!), query),
    enabled: Boolean(tid && orgId),
    ...opts,
  });
}

export function useKpiActuals(tid: string, kpiId: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("kpi-actuals", tid, kpiId, JSON.stringify(query)),
    queryFn: () => fetchAllPages<KpiActual>(kpiPaths.actuals(tid, kpiId), query),
    enabled: Boolean(tid && kpiId),
    ...opts,
  });
}

export function useKpiActual(tid: string, actualId: string) {
  return useQuery({
    queryKey: p4Keys.area("kpi-actuals", tid, "actual", actualId),
    queryFn: () => api.get<KpiActual>(kpiPaths.actual(tid, actualId)),
    enabled: Boolean(tid && actualId),
    ...opts,
  });
}

export function useKpiReviewQueue(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("kpi-actuals", tid, "review-queue"),
    queryFn: () => fetchAllPages<KpiActual>(kpiPaths.reviewQueue(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useCalculationRuns(tid: string, kpiId?: string) {
  return useQuery({
    queryKey: p4Keys.area("calculation-runs", tid, kpiId ?? "all"),
    queryFn: () => fetchAllPages<CalculationRun>(kpiPaths.runs(tid), kpiId ? { kpiDefinitionId: kpiId } : {}),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useKpiStatusList(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("kpi-status", tid, "list"),
    queryFn: () => fetchAllPages<KpiStatus>(kpiPaths.statusList(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useKpiStatus(tid: string, kpiId: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("kpi-status", tid, kpiId, JSON.stringify(query)),
    queryFn: () => api.get<KpiStatus>(kpiPaths.status(tid, kpiId), query),
    enabled: Boolean(tid && kpiId),
    ...opts,
  });
}

export function useRagOverrides(tid: string, kpiId: string) {
  return useQuery({
    queryKey: p4Keys.area("rag-overrides", tid, kpiId),
    queryFn: () => fetchAllPages<RagOverride>(kpiPaths.overrides(tid, kpiId)),
    enabled: Boolean(tid && kpiId),
    ...opts,
  });
}

export function useDataQualityFindings(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("data-quality", tid, JSON.stringify(query)),
    queryFn: () => fetchAllPages<DataQualityFinding>(kpiPaths.findings(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** The transformation's evidence register (DG2), offered as attachments of an actual or an override. */
export function useEvidenceOptions(tid: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("kpi-actuals", tid, "evidence-options"),
    queryFn: async () => (await fetchAllPages<Evidence>(`${tBase(tid)}/evidence`)).filter((e) => e.status === "active"),
    enabled: Boolean(tid) && enabled,
    ...opts,
  });
}

/**
 * The reporting periods of the transformation's organization, read through the transformation
 * (listTransformationReportingPeriods; ARCH-R1 item 9, REQ-S07-017 "select period"): `transformation.read` is enough, so a
 * Lead or KPI owner without `organization.read` lists them too (the organization list answers 404 to them).
 */
export function useTransformationReportingPeriods(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("reporting-periods", tid, "transformation", JSON.stringify(query)),
    queryFn: () => fetchAllPages<ReportingPeriod>(kpiPaths.transformationPeriods(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** A reporting period the user can pick. */
export interface PeriodChoice {
  readonly id: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly updateDueDate: string | null;
  readonly status: ReportingPeriod["status"];
}

/**
 * The periods a KPI's actual or override can use (T-DG4-FE-R1, KBE-R2): the transformation's reporting periods of the
 * KPI's frequency, latest first as the API orders them; `openOnly` asks the server for open periods only (an actual is
 * entered only in an open period; the server still refuses a closed one, 422 kpi_actual.period_not_open). This replaces
 * FE-B's fallback to the KPI's current period, which was all a transformation-scoped role could choose.
 */
export function usePeriodChoices(tid: string, frequency: string | null | undefined, openOnly: boolean) {
  const query: Record<string, string> = {};
  if (openOnly) query["status"] = "open";
  if (frequency) query["frequency"] = frequency;
  const periods = useTransformationReportingPeriods(frequency === undefined ? "" : tid, query);
  const choices: PeriodChoice[] = (periods.data ?? [])
    .filter((p) => !frequency || p.frequency === frequency)
    .filter((p) => !openOnly || p.status === "open")
    .map((p) => ({
      id: p.id,
      label: p.periodLabel,
      start: p.periodStart,
      end: p.periodEnd,
      updateDueDate: p.updateDueDate,
      status: p.status,
    }));
  return { choices, pending: periods.isPending, error: periods.isError ? periods.error : null };
}
