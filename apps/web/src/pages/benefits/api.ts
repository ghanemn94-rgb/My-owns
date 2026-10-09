// Slice B web seams (T-DG4-FE-C; p4-work-split §B.5): the request paths and read hooks of the benefits and Finance
// validation screens. Query keys come from FE-A's `p4Keys.area(<slice B area>, tid, …)` (api/p4.ts), so
// `useP4Refresh(tid)` refreshes every benefit view of the transformation after a mutation. Writes are sent by the
// screens with `api.send` (If-Match from the record's `version`) inside a session guard.
//
// Unknown is data, never a default: a BenefitAmount with status "unknown" or "not_applicable" stays that way here and
// renders as Unknown (with its reason) or n/a, never as 0 and never green (S-5; ADR-0029 §12, ADR-0030 §8).
import { useQuery } from "@tanstack/react-query";
import type {
  Benefit,
  BenefitAllocations,
  BenefitAmount,
  BenefitEnabler,
  BenefitGroup,
  BenefitLifecycle,
  BenefitMeasurement,
  BenefitOverlap,
  BenefitPlanValue,
  BenefitRegisterRow as BenefitRegisterRowBase,
  BenefitScenario,
  BenefitScenarioValue,
  BenefitTotalLine,
  BenefitTotals,
  BenefitTotalsCurrency,
  BenefitValuationMethod,
  BenefitValueLine,
  BenefitValues,
  BenefitValueSeries,
  FinanceValidation,
  InitiativeRef,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";
import type { Evidence, Initiative, Transformation } from "../../api/types.ts";

/**
 * A T14 register row. `initiatives[]` is the optional OpenAPI member (ADR-0038 §8, D-106 (d)) that BE-M fills on every
 * row by join; the zod mirror in `schemas/benefits.ts` does not list it yet (BE-M handback §2.1), so it is added here.
 */
export type BenefitRegisterRow = BenefitRegisterRowBase & { readonly initiatives?: readonly InitiativeRef[] };

export type {
  Benefit,
  BenefitAllocations,
  BenefitAmount,
  BenefitEnabler,
  BenefitGroup,
  BenefitLifecycle,
  BenefitMeasurement,
  BenefitOverlap,
  BenefitPlanValue,
  BenefitScenario,
  BenefitScenarioValue,
  BenefitTotalLine,
  BenefitTotals,
  BenefitTotalsCurrency,
  BenefitValuationMethod,
  BenefitValueLine,
  BenefitValues,
  BenefitValueSeries,
  Evidence,
  FinanceValidation,
  Initiative,
  InitiativeRef,
  Transformation,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the 45 slice B operations (operationId in the comment). */
export const benefitPaths = {
  // register and lifecycle (KBE-D)
  benefits: (tid: string) => `${tBase(tid)}/benefits`, // listBenefits / createBenefit
  benefit: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}`, // getBenefit / updateBenefit
  archive: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}/archive`, // archiveBenefit
  lifecycle: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}/lifecycle`, // getBenefitLifecycle / advanceBenefitLifecycle
  baselineValidation: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}/baseline-validation`, // decideBenefitBaseline
  enablers: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}/enablers`, // listBenefitEnablers / createBenefitEnabler
  removeEnabler: (tid: string, id: string) => `${tBase(tid)}/benefit-enablers/${id}/remove`, // removeBenefitEnabler
  // values (KBE-E)
  values: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}/values`, // getBenefitValues
  planValues: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}/plan-values`, // createBenefitPlanValue
  planValue: (tid: string, id: string) => `${tBase(tid)}/benefit-plan-values/${id}`, // updateBenefitPlanValue
  // allocations (KBE-D)
  allocations: (tid: string, id: string) => `${tBase(tid)}/benefits/${id}/allocations`, // getBenefitAllocations / replaceBenefitAllocations
  // groups (KBE-D)
  groups: (tid: string) => `${tBase(tid)}/benefit-groups`, // listBenefitGroups / createBenefitGroup
  group: (tid: string, id: string) => `${tBase(tid)}/benefit-groups/${id}`, // getBenefitGroup / updateBenefitGroup
  // overlaps (KBE-D2)
  overlaps: (tid: string) => `${tBase(tid)}/benefit-overlaps`, // listBenefitOverlaps / createBenefitOverlap
  overlap: (tid: string, id: string) => `${tBase(tid)}/benefit-overlaps/${id}`, // getBenefitOverlap
  resolveOverlap: (tid: string, id: string) => `${tBase(tid)}/benefit-overlaps/${id}/resolve`, // resolveBenefitOverlap
  // scenarios (KBE-D2)
  scenarios: (tid: string) => `${tBase(tid)}/benefit-scenarios`, // listBenefitScenarios / createBenefitScenario
  scenario: (tid: string, id: string) => `${tBase(tid)}/benefit-scenarios/${id}`, // getBenefitScenario / updateBenefitScenario
  scenarioValues: (tid: string, id: string) => `${tBase(tid)}/benefit-scenarios/${id}/values`, // createBenefitScenarioValue
  scenarioValue: (tid: string, id: string) => `${tBase(tid)}/benefit-scenario-values/${id}`, // updateBenefitScenarioValue
  // valuation methods (KBE-D2)
  valuationMethods: (tid: string) => `${tBase(tid)}/benefit-valuation-methods`, // listBenefitValuationMethods / createBenefitValuationMethod
  valuationDecision: (tid: string, id: string) => `${tBase(tid)}/benefit-valuation-methods/${id}/decision`, // decideBenefitValuationMethod
  // measurements (KBE-E)
  measurements: (tid: string, benefitId: string) => `${tBase(tid)}/benefits/${benefitId}/measurements`, // listBenefitMeasurements / createBenefitMeasurement
  measurement: (tid: string, id: string) => `${tBase(tid)}/benefit-measurements/${id}`, // getBenefitMeasurement / updateBenefitMeasurement
  submitMeasurement: (tid: string, id: string) => `${tBase(tid)}/benefit-measurements/${id}/submit`, // submitBenefitMeasurement
  // Finance validation (KBE-E)
  financeQueue: (tid: string) => `${tBase(tid)}/finance-validations`, // listFinanceValidationQueue
  financeValidation: (tid: string, id: string) => `${tBase(tid)}/finance-validations/${id}`, // getFinanceValidation
  financeDecision: (tid: string, id: string) => `${tBase(tid)}/finance-validations/${id}/decision`, // decideFinanceValidation
  amendments: (tid: string, id: string) => `${tBase(tid)}/finance-validations/${id}/amendments`, // amendFinanceValidation
  reversals: (tid: string, id: string) => `${tBase(tid)}/finance-validations/${id}/reversals`, // reverseFinanceValidation
  // totals (KBE-E)
  totals: (tid: string) => `${tBase(tid)}/benefit-totals`, // getBenefitTotals
  portfolioTotals: (orgId: string) => `${v1}/organizations/${orgId}/benefit-totals`, // getPortfolioBenefitTotals
};

// ------------------------------------------------------------------------------------------------ read hooks

const opts = { retry: shouldRetry } as const;

export function useBenefitRegister(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("benefits", tid, "register", JSON.stringify(query)),
    queryFn: () => fetchAllPages<BenefitRegisterRow>(benefitPaths.benefits(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useBenefit(tid: string, benefitId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefits", tid, "benefit", benefitId),
    queryFn: () => api.get<Benefit>(benefitPaths.benefit(tid, benefitId)),
    enabled: Boolean(tid && benefitId),
    ...opts,
  });
}

export function useBenefitLifecycle(tid: string, benefitId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefits", tid, "lifecycle", benefitId),
    queryFn: () => api.get<BenefitLifecycle>(benefitPaths.lifecycle(tid, benefitId)),
    enabled: Boolean(tid && benefitId),
    ...opts,
  });
}

export function useBenefitEnablers(tid: string, benefitId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefits", tid, "enablers", benefitId),
    queryFn: () => fetchAllPages<BenefitEnabler>(benefitPaths.enablers(tid, benefitId)),
    enabled: Boolean(tid && benefitId),
    ...opts,
  });
}

export function useBenefitValues(tid: string, benefitId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-measurements", tid, "values", benefitId),
    queryFn: () => api.get<BenefitValues>(benefitPaths.values(tid, benefitId)),
    enabled: Boolean(tid && benefitId),
    ...opts,
  });
}

export function useBenefitAllocations(tid: string, benefitId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-allocations", tid, benefitId),
    queryFn: () => api.get<BenefitAllocations>(benefitPaths.allocations(tid, benefitId)),
    enabled: Boolean(tid && benefitId),
    ...opts,
  });
}

export function useBenefitGroups(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-groups", tid, "list"),
    queryFn: () => fetchAllPages<BenefitGroup>(benefitPaths.groups(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useBenefitOverlaps(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("benefit-overlaps", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<BenefitOverlap>(benefitPaths.overlaps(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useBenefitOverlap(tid: string, overlapId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-overlaps", tid, "overlap", overlapId),
    queryFn: () => api.get<BenefitOverlap>(benefitPaths.overlap(tid, overlapId)),
    enabled: Boolean(tid && overlapId),
    ...opts,
  });
}

export function useBenefitScenarios(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-scenarios", tid, "list"),
    queryFn: () => fetchAllPages<BenefitScenario>(benefitPaths.scenarios(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useValuationMethods(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("benefits", tid, "valuation-methods"),
    queryFn: () => fetchAllPages<BenefitValuationMethod>(benefitPaths.valuationMethods(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useBenefitMeasurements(tid: string, benefitId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-measurements", tid, "list", benefitId),
    queryFn: () => fetchAllPages<BenefitMeasurement>(benefitPaths.measurements(tid, benefitId)),
    enabled: Boolean(tid && benefitId),
    ...opts,
  });
}

export function useBenefitMeasurement(tid: string, measurementId: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-measurements", tid, "measurement", measurementId),
    queryFn: () => api.get<BenefitMeasurement>(benefitPaths.measurement(tid, measurementId)),
    enabled: Boolean(tid && measurementId),
    ...opts,
  });
}

export function useFinanceQueue(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("finance-validations", tid, "queue", JSON.stringify(query)),
    queryFn: () => fetchAllPages<FinanceValidation>(benefitPaths.financeQueue(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useFinanceValidation(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("finance-validations", tid, "validation", id),
    queryFn: () => api.get<FinanceValidation>(benefitPaths.financeValidation(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useBenefitTotals(tid: string, initiativeId?: string) {
  return useQuery({
    queryKey: p4Keys.area("benefit-totals", tid, initiativeId ?? "all"),
    queryFn: () => api.get<BenefitTotals>(benefitPaths.totals(tid), initiativeId ? { initiativeId } : {}),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** The organization's benefit totals over the transformations the caller may read (needs organization.read). */
export function usePortfolioBenefitTotals(orgId: string) {
  return useQuery({
    queryKey: [...p4Keys.financeQueue(orgId), "portfolio-totals"],
    queryFn: () => api.get<BenefitTotals>(benefitPaths.portfolioTotals(orgId)),
    enabled: Boolean(orgId),
    ...opts,
  });
}

/** The transformation's initiatives (DG3), offered as enablers and allocation targets. */
export function useInitiativeOptions(tid: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("benefit-allocations", tid, "initiative-options"),
    queryFn: () => fetchAllPages<Initiative>(`${v1}/initiatives`, { transformationId: tid }),
    enabled: Boolean(tid) && enabled,
    ...opts,
  });
}

/** The transformation's evidence register (DG2), offered as measurement evidence. */
export function useBenefitEvidenceOptions(tid: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("benefit-measurements", tid, "evidence-options"),
    queryFn: async () => (await fetchAllPages<Evidence>(`${tBase(tid)}/evidence`)).filter((e) => e.status === "active"),
    enabled: Boolean(tid) && enabled,
    ...opts,
  });
}

/** The transformations the caller can read (the organization-wide Finance queue lists each one's queue). */
export function useReadableTransformations() {
  return useQuery({
    queryKey: [...p4Keys.all, "finance-queue", "transformations"],
    queryFn: () => fetchAllPages<Transformation>(`${v1}/transformations`),
    ...opts,
  });
}
