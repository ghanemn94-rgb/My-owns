// Slice F web seams (T-DG5-FE-E; p5-plan §5.1 row FE-E; ADR-0045, ADR-0046; D-144 "slices D–K add their own clients"):
// the request paths of the 26 slice F operations these screens send (operationId in the comment), their query keys
// under ["p5", "reports", …], and the read hooks. The shapes are the @mth/shared mirrors (report.ts of KBE-C,
// owner-updates.ts of KBE-D, and export-jobs.ts, presentation.ts and evidence-register.ts promoted by this task, D-155 d
// and D-159 e). The OpenAPI file is the source of truth.
//
// Unknown is data: a value whose `validation` is unknown or stale has no number and is shown as "Unknown"/"Stale",
// never 0; a snapshot is shown with its own status (generated is a draft, not an issued report).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  EvidenceRegisterItem,
  EvidenceVersion,
  ExportJob,
  LiveReport,
  MeetingPresentation,
  OwnerUpdate,
  OwnerUpdateRevision,
  ReportDefinition,
  ReportSnapshot,
  ReportSnapshotEvidenceItem,
  ReportSnapshotSource,
  ReportSnapshotSummary,
  ReportSnapshotVersion,
} from "@mth/shared/schemas";
import { api, getSessionGeneration } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  EvidenceRegisterItem,
  EvidenceVersion,
  ExportJob,
  LiveReport,
  MeetingPresentation,
  OwnerUpdate,
  OwnerUpdateRevision,
  ReportDefinition,
  ReportSnapshot,
  ReportSnapshotEvidenceItem,
  ReportSnapshotSource,
  ReportSnapshotSummary,
  ReportSnapshotVersion,
};

type Q = Record<string, string>;

const v1 = "/api/v1";
const seg = encodeURIComponent;
const tBase = (tid: string) => `${v1}/transformations/${tid}`;
const snapBase = (tid: string, id: string) => `${tBase(tid)}/report-snapshots/${id}`;
const updateBase = (tid: string, id: string) => `${tBase(tid)}/updates/${id}`;

export const reportPaths = {
  // reports (ADR-0045 §1, §2)
  definitions: `${v1}/report-definitions`, // listReportDefinitions
  live: (tid: string, code: string) => `${tBase(tid)}/reports/${seg(code)}/live`, // getLiveReport
  generate: (tid: string, code: string) => `${tBase(tid)}/reports/${seg(code)}/generate`, // generateReportSnapshot
  // report-snapshots (ADR-0045 §2–§4, §8)
  snapshots: (tid: string) => `${tBase(tid)}/report-snapshots`, // listReportSnapshots
  snapshot: (tid: string, id: string) => snapBase(tid, id), // getReportSnapshot
  sources: (tid: string, id: string) => `${snapBase(tid, id)}/sources`, // listReportSnapshotSources
  versions: (tid: string, id: string) => `${snapBase(tid, id)}/versions`, // listReportSnapshotVersions
  evidence: (tid: string, id: string) => `${snapBase(tid, id)}/evidence`, // listReportSnapshotEvidence
  issue: (tid: string, id: string) => `${snapBase(tid, id)}/issue`, // issueReportSnapshot
  discard: (tid: string, id: string) => `${snapBase(tid, id)}/discard`, // discardReportSnapshot
  reissue: (tid: string, id: string) => `${snapBase(tid, id)}/reissue`, // reissueReportSnapshot
  // exports (ADR-0046 §5)
  exports: `${v1}/exports`, // listExports, createExport
  export: (id: string) => `${v1}/exports/${id}`, // getExport
  download: (id: string) => `${v1}/exports/${id}/download`, // downloadExport
  cancelExport: (id: string) => `${v1}/exports/${id}/cancel`, // cancelExport
  // meetings: presentation (ADR-0045 §7)
  presentation: (tid: string, meetingId: string) => `${tBase(tid)}/meetings/${meetingId}/presentation`, // getMeetingPresentation
  // owner-updates (ADR-0045 §6)
  updates: (tid: string) => `${tBase(tid)}/updates`, // listOwnerUpdates, createOwnerUpdate
  update: (tid: string, id: string) => updateBase(tid, id), // getOwnerUpdate, updateOwnerUpdate
  submitUpdate: (tid: string, id: string) => `${updateBase(tid, id)}/submit`, // submitOwnerUpdate
  reopenUpdate: (tid: string, id: string) => `${updateBase(tid, id)}/reopen`, // reopenOwnerUpdate
  updateRevisions: (tid: string, id: string) => `${updateBase(tid, id)}/revisions`, // listOwnerUpdateRevisions
  // evidence: register and versions (ADR-0045 §8)
  evidenceRegister: (tid: string) => `${tBase(tid)}/evidence-register`, // listEvidenceRegister
  evidenceVersions: (tid: string, evidenceId: string) => `${tBase(tid)}/evidence/${evidenceId}/versions`, // listEvidenceVersions
};

export const reportKeys = {
  all: ["p5", "reports"] as const,
  definitions: ["p5", "reports", "definitions"] as const,
  live: (tid: string, code: string, query: Q) => ["p5", "reports", tid, "live", code, query] as const,
  snapshots: (tid: string, query: Q) => ["p5", "reports", tid, "snapshots", query] as const,
  snapshot: (tid: string, id: string) => ["p5", "reports", tid, "snapshot", id] as const,
  snapshotPart: (tid: string, id: string, part: string) => ["p5", "reports", tid, "snapshot", id, part] as const,
  exports: (query: Q) => ["p5", "reports", "exports", query] as const,
  export: (id: string) => ["p5", "reports", "export", id] as const,
  presentation: (tid: string, meetingId: string, snapshotId: string) =>
    ["p5", "reports", tid, "presentation", meetingId, snapshotId] as const,
  updates: (tid: string, query: Q) => ["p5", "reports", tid, "updates", query] as const,
  updateRevisions: (tid: string, id: string) => ["p5", "reports", tid, "update", id, "revisions"] as const,
  evidenceRegister: (tid: string, query: Q) => ["p5", "reports", tid, "evidence-register", query] as const,
  evidenceVersions: (tid: string, evidenceId: string) =>
    ["p5", "reports", tid, "evidence", evidenceId, "versions"] as const,
};

/** Refreshes every slice F key after a write; false when the session changed meanwhile (the caller then stops). */
export function useReportsRefresh(): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await queryClient.invalidateQueries({ queryKey: reportKeys.all });
    return getSessionGeneration() === generation;
  };
}

const opts = { retry: shouldRetry } as const;

export function useReportDefinitions() {
  return useQuery({
    queryKey: reportKeys.definitions,
    queryFn: () => api.get<{ items: ReportDefinition[] }>(reportPaths.definitions),
    ...opts,
  });
}

/** The live report (never stored). Enabled only when the caller asks for it (a preview button). */
export function useLiveReport(tid: string, code: string | undefined, query: Q, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.live(tid, code ?? "", query),
    queryFn: () => api.get<LiveReport>(reportPaths.live(tid, code!), query),
    enabled: Boolean(tid && code && enabled),
    ...opts,
  });
}

export function useReportSnapshots(tid: string, query: Q = {}) {
  return useQuery({
    queryKey: reportKeys.snapshots(tid, query),
    queryFn: () => fetchAllPages<ReportSnapshotSummary>(reportPaths.snapshots(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useReportSnapshot(tid: string, id: string | undefined) {
  return useQuery({
    queryKey: reportKeys.snapshot(tid, id ?? ""),
    queryFn: () => api.get<ReportSnapshot>(reportPaths.snapshot(tid, id!)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useSnapshotSources(tid: string, id: string) {
  return useQuery({
    queryKey: reportKeys.snapshotPart(tid, id, "sources"),
    queryFn: () => fetchAllPages<ReportSnapshotSource>(reportPaths.sources(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useSnapshotVersions(tid: string, id: string) {
  return useQuery({
    queryKey: reportKeys.snapshotPart(tid, id, "versions"),
    queryFn: () => api.get<{ items: ReportSnapshotVersion[] }>(reportPaths.versions(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useSnapshotEvidence(tid: string, id: string) {
  return useQuery({
    queryKey: reportKeys.snapshotPart(tid, id, "evidence"),
    queryFn: () => fetchAllPages<ReportSnapshotEvidenceItem>(reportPaths.evidence(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

const ACTIVE_EXPORT = new Set(["queued", "running"]);
/** Poll interval of an unfinished export (every export is asynchronous, ADR-0046 §5 step 5). */
export const EXPORT_POLL_MS = 2_000;

/** The caller's own export jobs (newest first); polled while any job is queued or running. */
export function useExports(query: Q = {}) {
  return useQuery({
    queryKey: reportKeys.exports(query),
    queryFn: () => fetchAllPages<ExportJob>(reportPaths.exports, query),
    refetchInterval: (q) => ((q.state.data ?? []).some((j) => ACTIVE_EXPORT.has(j.status)) ? EXPORT_POLL_MS : false),
    ...opts,
  });
}

export function useMeetingPresentation(tid: string, meetingId: string, snapshotId: string) {
  return useQuery({
    queryKey: reportKeys.presentation(tid, meetingId, snapshotId),
    queryFn: () =>
      api.get<MeetingPresentation>(reportPaths.presentation(tid, meetingId), snapshotId ? { snapshotId } : {}),
    enabled: Boolean(tid && meetingId),
    ...opts,
  });
}

export function useOwnerUpdates(tid: string, query: Q = {}) {
  return useQuery({
    queryKey: reportKeys.updates(tid, query),
    queryFn: () => fetchAllPages<OwnerUpdate>(reportPaths.updates(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useOwnerUpdateRevisions(tid: string, id: string, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.updateRevisions(tid, id),
    queryFn: () => fetchAllPages<OwnerUpdateRevision>(reportPaths.updateRevisions(tid, id)),
    enabled: Boolean(tid && id && enabled),
    ...opts,
  });
}

export function useEvidenceRegister(tid: string, query: Q = {}) {
  return useQuery({
    queryKey: reportKeys.evidenceRegister(tid, query),
    queryFn: () => fetchAllPages<EvidenceRegisterItem>(reportPaths.evidenceRegister(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useEvidenceVersions(tid: string, evidenceId: string, enabled: boolean) {
  return useQuery({
    queryKey: reportKeys.evidenceVersions(tid, evidenceId),
    queryFn: () => fetchAllPages<EvidenceVersion>(reportPaths.evidenceVersions(tid, evidenceId)),
    enabled: Boolean(tid && evidenceId && enabled),
    ...opts,
  });
}
