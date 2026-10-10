// Slice F web seams (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033): the request paths and read hooks of the T13
// Stakeholder & Adoption Plan, stakeholder groups, champions, interventions, involvement, champion constraints, the
// seven leading adoption indicators (templates, metric links, values), feedback and assessment forms, invitations,
// assessment records and training records. Query keys come from FE-A's `p4Keys.area("stakeholder-groups" /
// "adoption", tid, …)`, so `useP4Refresh(tid)` refreshes every view of the transformation after a mutation. Writes are
// sent by the screens with `api.send` (If-Match from the record's `version`) inside a session guard. SYNTHETIC data
// only in tests and demos.
//
// Unknown is data, never a default: a measure without data stays `valueStatus: "unknown"` with `value: null` and
// renders as Unknown with its reason (never 0, never green; ADR-0033 §12).
import { useQuery } from "@tanstack/react-query";
import type {
  AdoptionIndicatorReport,
  AdoptionIndicatorTemplate,
  AdoptionIntervention,
  AdoptionMetricLink,
  AdoptionPlan,
  AssessmentForm,
  AssessmentInvitation,
  AssessmentRecord,
  ChampionConstraint,
  StakeholderChampion,
  StakeholderGroup,
  StakeholderInvolvement,
  TrainingRecord,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  AdoptionIndicatorReport,
  AdoptionIndicatorTemplate,
  AdoptionIntervention,
  AdoptionMetricLink,
  AdoptionPlan,
  AssessmentForm,
  AssessmentInvitation,
  AssessmentRecord,
  ChampionConstraint,
  StakeholderChampion,
  StakeholderGroup,
  StakeholderInvolvement,
  TrainingRecord,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the slice F operations the screens call (operationId in the comment). */
export const adoptionPaths = {
  templates: () => `${v1}/adoption-indicator-templates`, // listAdoptionIndicatorTemplates
  plan: (tid: string) => `${tBase(tid)}/adoption-plan`, // getAdoptionPlan
  groups: (tid: string) => `${tBase(tid)}/stakeholder-groups`, // listStakeholderGroups / createStakeholderGroup
  group: (tid: string, id: string) => `${tBase(tid)}/stakeholder-groups/${id}`, // getStakeholderGroup / updateStakeholderGroup
  groupArchive: (tid: string, id: string) => `${tBase(tid)}/stakeholder-groups/${id}/archive`, // archiveStakeholderGroup
  champions: (tid: string, gid: string) => `${tBase(tid)}/stakeholder-groups/${gid}/champions`, // listStakeholderChampions / addStakeholderChampion
  championRemove: (tid: string, gid: string, id: string) =>
    `${tBase(tid)}/stakeholder-groups/${gid}/champions/${id}/remove`, // removeStakeholderChampion
  interventions: (tid: string) => `${tBase(tid)}/adoption-interventions`, // listAdoptionInterventions / createAdoptionIntervention
  intervention: (tid: string, id: string) => `${tBase(tid)}/adoption-interventions/${id}`, // getAdoptionIntervention / updateAdoptionIntervention
  involvements: (tid: string) => `${tBase(tid)}/stakeholder-involvements`, // listStakeholderInvolvements / createStakeholderInvolvement
  involvementWithdraw: (tid: string, id: string) => `${tBase(tid)}/stakeholder-involvements/${id}/withdraw`, // withdrawStakeholderInvolvement
  constraints: (tid: string) => `${tBase(tid)}/champion-constraints`, // listChampionConstraints / createChampionConstraint
  constraintResolve: (tid: string, id: string) => `${tBase(tid)}/champion-constraints/${id}/resolve`, // resolveChampionConstraint
  metricLinks: (tid: string) => `${tBase(tid)}/adoption-metric-links`, // listAdoptionMetricLinks / createAdoptionMetricLink
  metricLinkRemove: (tid: string, id: string) => `${tBase(tid)}/adoption-metric-links/${id}/remove`, // removeAdoptionMetricLink
  indicators: (tid: string) => `${tBase(tid)}/adoption-indicators`, // getAdoptionIndicators
  forms: (tid: string) => `${tBase(tid)}/assessment-forms`, // listAssessmentForms / createAssessmentForm
  form: (tid: string, id: string) => `${tBase(tid)}/assessment-forms/${id}`, // getAssessmentForm / updateAssessmentForm
  formPublish: (tid: string, id: string) => `${tBase(tid)}/assessment-forms/${id}/publish`, // publishAssessmentForm
  formRetire: (tid: string, id: string) => `${tBase(tid)}/assessment-forms/${id}/retire`, // retireAssessmentForm
  invitations: (tid: string, formId: string) => `${tBase(tid)}/assessment-forms/${formId}/invitations`, // listAssessmentInvitations / createAssessmentInvitations
  invitationCancel: (tid: string, id: string) => `${tBase(tid)}/assessment-invitations/${id}/cancel`, // cancelAssessmentInvitation
  records: (tid: string) => `${tBase(tid)}/assessment-records`, // listAssessmentRecords / createAssessmentRecord
  record: (tid: string, id: string) => `${tBase(tid)}/assessment-records/${id}`, // getAssessmentRecord
  recordReview: (tid: string, id: string) => `${tBase(tid)}/assessment-records/${id}/review`, // reviewAssessmentRecord
  recordWithdraw: (tid: string, id: string) => `${tBase(tid)}/assessment-records/${id}/withdraw`, // withdrawAssessmentRecord
  training: (tid: string) => `${tBase(tid)}/training-records`, // listTrainingRecords / createTrainingRecord
  trainingRecord: (tid: string, id: string) => `${tBase(tid)}/training-records/${id}`, // updateTrainingRecord
} as const;

const opts = { retry: shouldRetry, staleTime: 15_000 } as const;

export function useAdoptionPlan(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("stakeholder-groups", tid, "plan"),
    queryFn: () => api.get<AdoptionPlan>(adoptionPaths.plan(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useStakeholderGroups(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("stakeholder-groups", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<StakeholderGroup>(adoptionPaths.groups(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useChampions(tid: string, groupId: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("stakeholder-groups", tid, "champions", groupId),
    queryFn: () => fetchAllPages<StakeholderChampion>(adoptionPaths.champions(tid, groupId)),
    enabled: Boolean(tid && groupId) && enabled,
    ...opts,
  });
}

export function useInvolvements(tid: string, query: Record<string, string> = {}, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("stakeholder-groups", tid, "involvements", JSON.stringify(query)),
    queryFn: () => fetchAllPages<StakeholderInvolvement>(adoptionPaths.involvements(tid), query),
    enabled: Boolean(tid) && enabled,
    ...opts,
  });
}

export function useChampionConstraints(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("stakeholder-groups", tid, "constraints", JSON.stringify(query)),
    queryFn: () => fetchAllPages<ChampionConstraint>(adoptionPaths.constraints(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useInterventions(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "interventions", JSON.stringify(query)),
    queryFn: () => fetchAllPages<AdoptionIntervention>(adoptionPaths.interventions(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useIntervention(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "intervention", id),
    queryFn: () => api.get<AdoptionIntervention>(adoptionPaths.intervention(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

/** The seven leading adoption indicators (organization-wide, any signed-in user). */
export function useIndicatorTemplates() {
  return useQuery({
    queryKey: ["p4", "adoption-indicator-templates"],
    queryFn: async () => (await api.get<{ items: AdoptionIndicatorTemplate[] }>(adoptionPaths.templates())).items,
    ...opts,
    staleTime: 300_000,
  });
}

export function useMetricLinks(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "metric-links", JSON.stringify(query)),
    queryFn: () => fetchAllPages<AdoptionMetricLink>(adoptionPaths.metricLinks(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

/** The measures of one target (`targetKind` required; `targetId` unless the target is the transformation). */
export function useAdoptionIndicators(tid: string, targetKind: string, targetId: string | null, enabled = true) {
  const query: Record<string, string> = { targetKind, ...(targetId ? { targetId } : {}) };
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "indicators", JSON.stringify(query)),
    queryFn: () => api.get<AdoptionIndicatorReport>(adoptionPaths.indicators(tid), query),
    enabled: Boolean(tid) && enabled && (targetKind === "transformation" || Boolean(targetId)),
    ...opts,
  });
}

export function useAssessmentForms(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "forms", JSON.stringify(query)),
    queryFn: () => fetchAllPages<AssessmentForm>(adoptionPaths.forms(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useAssessmentForm(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "form", id),
    queryFn: () => api.get<AssessmentForm>(adoptionPaths.form(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useInvitations(tid: string, formId: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "invitations", formId),
    queryFn: () => fetchAllPages<AssessmentInvitation>(adoptionPaths.invitations(tid, formId)),
    enabled: Boolean(tid && formId) && enabled,
    ...opts,
  });
}

export function useAssessmentRecords(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "records", JSON.stringify(query)),
    queryFn: () => fetchAllPages<AssessmentRecord>(adoptionPaths.records(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useAssessmentRecord(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "record", id),
    queryFn: () => api.get<AssessmentRecord>(adoptionPaths.record(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useTrainingRecords(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("adoption", tid, "training", JSON.stringify(query)),
    queryFn: () => fetchAllPages<TrainingRecord>(adoptionPaths.training(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}
