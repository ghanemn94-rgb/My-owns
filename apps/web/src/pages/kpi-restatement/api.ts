// KPI restatement web seams (T-DG5-FE-F; slice G: ADR-0047 §1-§3, §6-§9; REQ-S07-016): the request paths of the 8
// operations of the tag `kpi-restatements` (operationId in the comment), their query keys under ["p5", "fef", …], and
// the read hooks. The shapes are the @mth/shared mirrors (kpi-restatement.ts, KBE-E and KBE-E2).
//
// A reconciliation side whose status is not `ok` carries no number: Unknown, Stale, Not computable and "no value" are
// never shown as 0 or green, and the difference exists only when both sides are `ok`.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { KpiRestatement, KpiRestatementReconciliation, KpiRestatementReissueOffer } from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type { KpiRestatement, KpiRestatementReconciliation, KpiRestatementReissueOffer };

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;
const rBase = (tid: string, rid: string) => `${tBase(tid)}/kpi-restatements/${rid}`;

export const restatementPaths = {
  list: (tid: string, kpiId: string) => `${tBase(tid)}/kpi-definitions/${kpiId}/restatements`, // listKpiRestatements, createKpiRestatement
  one: (tid: string, rid: string) => rBase(tid, rid), // getKpiRestatement
  reconciliation: (tid: string, rid: string) => `${rBase(tid, rid)}/reconciliation`, // getKpiRestatementReconciliation
  submit: (tid: string, rid: string) => `${rBase(tid, rid)}/submit`, // submitKpiRestatement
  decision: (tid: string, rid: string) => `${rBase(tid, rid)}/decision`, // decideKpiRestatement
  withdraw: (tid: string, rid: string) => `${rBase(tid, rid)}/withdraw`, // withdrawKpiRestatement
  reissueOffers: (tid: string, rid: string) => `${rBase(tid, rid)}/reissue-offers`, // listKpiRestatementReissueOffers
};

export const restatementKeys = {
  all: (tid: string) => ["p5", "fef", "kpi-restatements", tid] as const,
  list: (tid: string, kpiId: string) => ["p5", "fef", "kpi-restatements", tid, "kpi", kpiId] as const,
  one: (tid: string, rid: string) => ["p5", "fef", "kpi-restatements", tid, rid] as const,
};

export function useKpiRestatements(tid: string, kpiId: string) {
  return useQuery({
    queryKey: restatementKeys.list(tid, kpiId),
    queryFn: () => fetchAllPages<KpiRestatement>(restatementPaths.list(tid, kpiId)),
    enabled: Boolean(tid && kpiId),
    retry: shouldRetry,
  });
}

export function useKpiRestatement(tid: string, rid: string) {
  return useQuery({
    queryKey: restatementKeys.one(tid, rid),
    queryFn: () => api.get<KpiRestatement>(restatementPaths.one(tid, rid)),
    enabled: Boolean(tid && rid),
    retry: shouldRetry,
  });
}

export function useKpiRestatementReconciliation(tid: string, rid: string, version: number | undefined) {
  return useQuery({
    queryKey: [...restatementKeys.one(tid, rid), "reconciliation", version ?? 0],
    queryFn: () => api.get<KpiRestatementReconciliation>(restatementPaths.reconciliation(tid, rid)),
    enabled: Boolean(tid && rid && version !== undefined),
    retry: shouldRetry,
  });
}

export function useKpiRestatementOffers(tid: string, rid: string, enabled: boolean) {
  return useQuery({
    queryKey: [...restatementKeys.one(tid, rid), "reissue-offers"],
    queryFn: () => fetchAllPages<KpiRestatementReissueOffer>(restatementPaths.reissueOffers(tid, rid)),
    enabled: Boolean(tid && rid) && enabled,
    retry: shouldRetry,
  });
}

export function useRestatementRefresh(tid: string): () => Promise<unknown> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: restatementKeys.all(tid) });
}
