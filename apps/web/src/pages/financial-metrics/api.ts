// Formula-preview and financial-metrics web seams (T-DG5-FE-F; slice G: ADR-0047 §4-§9; REQ-S08-005, REQ-S08-019):
// the request paths of the 8 operations of the tags `formula-previews` and `financial-metrics` (operationId in the
// comment), their query keys under ["p5", "fef", …], and the read hooks. The shapes are the @mth/shared mirrors
// (financial-metrics.ts, KBE-F).
//
// NPV, ROI and payback are an extension, not a playbook requirement: off by default, their assumptions are always
// named, and a metric that is not shown or not computable is null with its reason, never 0. The preview never stores
// anything; it is a POST only because it carries a body.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BusinessCaseCashFlows,
  FinancialMetrics,
  FinancialMetricSettings,
  FormulaPreviewRequest,
  FormulaPreviewResult,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  BusinessCaseCashFlows,
  FinancialMetrics,
  FinancialMetricSettings,
  FormulaPreviewRequest,
  FormulaPreviewResult,
};

const v1 = "/api/v1";

export const financePaths = {
  preview: `${v1}/formula-previews`, // previewFormula
  settings: `${v1}/benefits/financial-metrics/settings`, // getFinancialMetricSettings
  enablement: `${v1}/benefits/financial-metrics/settings/enablement`, // putFinancialMetricEnablement
  assumptions: `${v1}/benefits/financial-metrics/settings/assumptions`, // putFinancialMetricAssumptions
  cashFlows: (caseId: string) => `${v1}/business-cases/${caseId}/cash-flows`, // get/putBusinessCaseCashFlows
  caseMetrics: (caseId: string) => `${v1}/business-cases/${caseId}/financial-metrics`, // getBusinessCaseFinancialMetrics
  transformationMetrics: (tid: string) => `${v1}/transformations/${tid}/benefits/financial-metrics`, // listTransformationFinancialMetrics
};

export const financeKeys = {
  all: ["p5", "fef", "finance"] as const,
  preview: (body: FormulaPreviewRequest) => ["p5", "fef", "finance", "preview", JSON.stringify(body)] as const,
  settings: ["p5", "fef", "finance", "settings"] as const,
  metrics: (tid: string) => ["p5", "fef", "finance", "metrics", tid] as const,
  cashFlows: (caseId: string) => ["p5", "fef", "finance", "cash-flows", caseId] as const,
};

/** The side-effect-free preview of a formula: evaluated examples, the result unit and the edge cases. */
export function useFormulaPreview(body: FormulaPreviewRequest | null) {
  return useQuery({
    queryKey: financeKeys.preview(body ?? {}),
    queryFn: () => api.send<FormulaPreviewResult>(financePaths.preview, { method: "POST", body }),
    enabled: body !== null,
    retry: shouldRetry,
  });
}

export function useFinancialSettings() {
  return useQuery({
    queryKey: financeKeys.settings,
    queryFn: () => api.get<FinancialMetricSettings>(financePaths.settings),
    retry: shouldRetry,
  });
}

export function useTransformationMetrics(tid: string) {
  return useQuery({
    queryKey: financeKeys.metrics(tid),
    queryFn: () => fetchAllPages<FinancialMetrics>(financePaths.transformationMetrics(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useCashFlows(caseId: string | null) {
  return useQuery({
    queryKey: financeKeys.cashFlows(caseId ?? ""),
    queryFn: () => api.get<BusinessCaseCashFlows>(financePaths.cashFlows(caseId ?? "")),
    enabled: Boolean(caseId),
    retry: shouldRetry,
  });
}

export function useFinanceRefresh(): () => Promise<unknown> {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: financeKeys.all });
}
