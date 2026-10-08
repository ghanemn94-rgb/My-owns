// T09 benefit-formula data hooks (T-DG3-FE-C; ADR-0024 §5-§6). Keys come from the FE-A0 seam `p3Keys`: every
// per-transformation key starts with ["benefit-formulas", transformationId] so useP3Refresh(tid) refreshes them; the
// B0087 example catalogue is global. Values stay decimal strings (fractions, never "12" for 12%).
import { useQuery } from "@tanstack/react-query";
import type {
  BenefitCalculation,
  BenefitFormula,
  BenefitFormulaExample,
  BenefitFormulaVersion,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { fetchAllPages, p3Keys, shouldRetry } from "../../api/queries.ts";

export const FORMULAS_URL = "/api/v1/benefit-formulas";
export const formulaUrl = (id: string) => `${FORMULAS_URL}/${id}`;
export const versionUrl = (id: string, versionNo: number) => `${formulaUrl(id)}/versions/${versionNo}`;

/** The T09 register of a transformation. */
export function useBenefitFormulas(tid: string, includeArchived = false) {
  return useQuery({
    queryKey: [...p3Keys.benefitFormulas(tid), { includeArchived }],
    queryFn: () =>
      fetchAllPages<BenefitFormula>(FORMULAS_URL, {
        transformationId: tid,
        ...(includeArchived ? { includeArchived: "true" } : {}),
      }),
    retry: shouldRetry,
  });
}

export function useBenefitFormula(tid: string, id: string) {
  return useQuery({
    queryKey: p3Keys.benefitFormula(tid, id),
    queryFn: () => api.get<BenefitFormula>(formulaUrl(id)),
    retry: shouldRetry,
  });
}

/** Every version, newest first, with its Finance validation state. */
export function useFormulaVersions(tid: string, id: string) {
  return useQuery({
    queryKey: p3Keys.benefitFormulaPart(tid, id, "versions"),
    queryFn: async () => (await api.get<{ items: BenefitFormulaVersion[] }>(`${formulaUrl(id)}/versions`)).items,
    retry: shouldRetry,
  });
}

/** The calculation lineage of one version (newest first). */
export function useCalculations(tid: string, id: string, versionNo: number | null) {
  return useQuery({
    queryKey: p3Keys.benefitFormulaPart(tid, id, "versions", versionNo ?? 0, "calculations"),
    queryFn: () => fetchAllPages<BenefitCalculation>(`${versionUrl(id, versionNo ?? 0)}/calculations`),
    enabled: versionNo !== null,
    retry: shouldRetry,
  });
}

/** The two B0087 source examples (illustrative, synthetic values). */
export function useFormulaExamples() {
  return useQuery({
    queryKey: p3Keys.benefitFormulaExamples,
    queryFn: async () => (await api.get<{ items: BenefitFormulaExample[] }>("/api/v1/benefit-formula-examples")).items,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  });
}
