// Automation, jobs-operations, approval-route, gate-condition, notification and cut-off-pack web seams (T-DG5-FE-D;
// slices D and E: ADR-0043, ADR-0044; D-144 "slices D–K add their own clients"). The request paths of the 39 slice D
// and E operations this task's screens send (operationId in the comment), their query keys under ["p5", "fed", …],
// and the read hooks. The shapes are the @mth/shared mirrors of BE-H…BE-L2 (the OpenAPI file is the source of truth).
//
// Unknown is data: `lastSuccessAt: null` is "Never run", `nextRunAt: null` is "Disabled" or "Unknown" by its reason,
// never a guessed time; a dry run that has not run for the current content is "Not run", never "Pass".
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApprovalRoute,
  ApprovalRouteDefinitionList,
  AutomationCatalogue,
  AutomationDryRun,
  AutomationExecution,
  AutomationRule,
  AutomationRuleVersion,
  JobOperation,
  JobOperationDetail,
  MeetingCutoffPack,
  NotificationDigest,
  NotificationPolicy,
  NotificationPreferences,
  OperationalFailure,
  TrackedGateCondition,
} from "@mth/shared/schemas";
import { api, getSessionGeneration } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  ApprovalRoute,
  ApprovalRouteDefinitionList,
  AutomationCatalogue,
  AutomationDryRun,
  AutomationExecution,
  AutomationRule,
  AutomationRuleVersion,
  JobOperation,
  JobOperationDetail,
  MeetingCutoffPack,
  NotificationDigest,
  NotificationPolicy,
  NotificationPreferences,
  OperationalFailure,
  TrackedGateCondition,
};

type Q = Record<string, string>;

const v1 = "/api/v1";
const seg = encodeURIComponent;
const ruleBase = (ruleId: string) => `${v1}/admin/automation-rules/${ruleId}`;
const versionBase = (ruleId: string, no: number) => `${ruleBase(ruleId)}/versions/${no}`;
const meetingBase = (tid: string, meetingId: string) => `${v1}/transformations/${tid}/meetings/${meetingId}`;

export const fedPaths = {
  // automation: catalogue, rules, versions (ADR-0043 §1–§4)
  catalogue: `${v1}/admin/automation-catalogue`, // getAutomationCatalogue
  rules: `${v1}/admin/automation-rules`, // listAutomationRules, createAutomationRule
  rule: (ruleId: string) => ruleBase(ruleId), // getAutomationRule, updateAutomationRule
  enableRule: (ruleId: string) => `${ruleBase(ruleId)}/enable`, // enableAutomationRule
  disableRule: (ruleId: string) => `${ruleBase(ruleId)}/disable`, // disableAutomationRule
  versions: (ruleId: string) => `${ruleBase(ruleId)}/versions`, // listAutomationRuleVersions, createAutomationRuleVersion
  version: (ruleId: string, no: number) => versionBase(ruleId, no), // getAutomationRuleVersion, updateAutomationRuleVersion
  dryRuns: (ruleId: string, no: number) => `${versionBase(ruleId, no)}/dry-runs`, // listAutomationDryRuns, runAutomationDryRun
  submit: (ruleId: string, no: number) => `${versionBase(ruleId, no)}/submit`, // submitAutomationRuleVersion
  review: (ruleId: string, no: number) => `${versionBase(ruleId, no)}/review`, // decideAutomationRuleReview
  publish: (ruleId: string, no: number) => `${versionBase(ruleId, no)}/publish`, // publishAutomationRuleVersion
  discard: (ruleId: string, no: number) => `${versionBase(ruleId, no)}/discard`, // discardAutomationRuleVersion
  // automation: executions and the failure queue (ADR-0043 §5)
  executions: `${v1}/admin/automation-executions`, // listAutomationExecutions
  execution: (id: string) => `${v1}/admin/automation-executions/${id}`, // getAutomationExecution
  failures: `${v1}/admin/automation-failures`, // listAutomationFailures
  failure: (id: string) => `${v1}/admin/automation-failures/${id}`, // getAutomationFailure
  retryFailure: (id: string) => `${v1}/admin/automation-failures/${id}/retry`, // retryAutomationFailure
  dismissFailure: (id: string) => `${v1}/admin/automation-failures/${id}/dismiss`, // dismissAutomationFailure
  // jobs operations (ADR-0043 §6)
  jobs: `${v1}/admin/jobs`, // listJobOperations
  job: (code: string) => `${v1}/admin/jobs/${seg(code)}`, // getJobOperation
  runJob: (code: string) => `${v1}/admin/jobs/${seg(code)}/run`, // runJobNow
  // approval routes and gate conditions (ADR-0044 §3, §4)
  approvalRoutes: `${v1}/admin/approval-routes`, // listApprovalRoutes
  approvalRoute: (approvalId: string) => `${v1}/approvals/${approvalId}/route`, // getApprovalRoute
  decideRouteStep: (approvalId: string, stepNo: number) =>
    `${v1}/approvals/${approvalId}/route/steps/${stepNo}/decision`, // decideApprovalRouteStep
  gateConditions: (tid: string) => `${v1}/transformations/${tid}/gate-conditions`, // listGateConditions
  closeGateCondition: (tid: string, id: string) => `${v1}/transformations/${tid}/gate-conditions/${id}/close`, // closeGateCondition
  // notification policy and preferences (ADR-0044 §5)
  myPreferences: `${v1}/me/notification-preferences`, // getMyNotificationPreferences, putMyNotificationPreferences
  myDigest: (digestId: string) => `${v1}/me/notification-digests/${digestId}`, // getMyNotificationDigest
  policy: `${v1}/admin/notification-policy`, // getNotificationPolicy, putNotificationPolicy
  // meeting cut-off pack (ADR-0044 §6)
  cutoffPack: (tid: string, meetingId: string) => `${meetingBase(tid, meetingId)}/cutoff-pack`, // getMeetingCutoffPack
  reviewCutoffPack: (tid: string, meetingId: string) => `${meetingBase(tid, meetingId)}/cutoff-pack/review`, // reviewMeetingCutoffPack
};

export const fedKeys = {
  all: ["p5", "fed"] as const,
  catalogue: ["p5", "fed", "catalogue"] as const,
  rules: (q: Q) => ["p5", "fed", "rules", q] as const,
  rule: (id: string) => ["p5", "fed", "rule", id] as const,
  versions: (id: string) => ["p5", "fed", "rule", id, "versions"] as const,
  dryRuns: (id: string, no: number) => ["p5", "fed", "rule", id, "dry-runs", no] as const,
  executions: (q: Q) => ["p5", "fed", "executions", q] as const,
  execution: (id: string) => ["p5", "fed", "execution", id] as const,
  failures: (q: Q) => ["p5", "fed", "failures", q] as const,
  jobs: ["p5", "fed", "jobs"] as const,
  job: (code: string) => ["p5", "fed", "job", code] as const,
  approvalRoutes: ["p5", "fed", "approval-routes"] as const,
  approvalRoute: (id: string) => ["p5", "fed", "approval-route", id] as const,
  gateConditions: (tid: string, q: Q) => ["p5", "fed", "gate-conditions", tid, q] as const,
  preferences: ["p5", "fed", "preferences"] as const,
  digest: (id: string) => ["p5", "fed", "digest", id] as const,
  policy: ["p5", "fed", "policy"] as const,
  cutoffPack: (tid: string, meetingId: string) => ["p5", "fed", "cutoff-pack", tid, meetingId] as const,
};

/** Refreshes every FE-D key after a write (and My Work: a review, a retry or a decision changes work items). */
export function useFedRefresh(): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: fedKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["p5", "me"] }),
    ]);
    return getSessionGeneration() === generation;
  };
}

function useFedQuery<T>(key: readonly unknown[], fn: () => Promise<T>, enabled = true) {
  return useQuery({ queryKey: key, queryFn: fn, enabled, retry: shouldRetry });
}

export const useCatalogue = (enabled = true) =>
  useFedQuery(fedKeys.catalogue, () => api.get<AutomationCatalogue>(fedPaths.catalogue), enabled);
export const useRules = (query: Q = {}, enabled = true) =>
  useFedQuery(fedKeys.rules(query), () => fetchAllPages<AutomationRule>(fedPaths.rules, query), enabled);
export const useRule = (id: string | undefined) =>
  useFedQuery(fedKeys.rule(id ?? ""), () => api.get<AutomationRule>(fedPaths.rule(id ?? "")), Boolean(id));
export const useVersions = (id: string | undefined) =>
  useFedQuery(
    fedKeys.versions(id ?? ""),
    () => fetchAllPages<AutomationRuleVersion>(fedPaths.versions(id ?? "")),
    Boolean(id),
  );
export const useDryRuns = (id: string, no: number | null) =>
  useFedQuery(
    fedKeys.dryRuns(id, no ?? 0),
    () => fetchAllPages<AutomationDryRun>(fedPaths.dryRuns(id, no ?? 0)),
    no !== null,
  );
export const useExecutions = (query: Q = {}, enabled = true) =>
  useFedQuery(fedKeys.executions(query), () => fetchAllPages<AutomationExecution>(fedPaths.executions, query), enabled);
export const useExecution = (id: string | undefined) =>
  useFedQuery(
    fedKeys.execution(id ?? ""),
    () => api.get<AutomationExecution>(fedPaths.execution(id ?? "")),
    Boolean(id),
  );
export const useFailures = (query: Q = {}, enabled = true) =>
  useFedQuery(fedKeys.failures(query), () => fetchAllPages<OperationalFailure>(fedPaths.failures, query), enabled);
export const useJobOperations = (enabled = true) =>
  useFedQuery(fedKeys.jobs, async () => (await api.get<{ items: JobOperation[] }>(fedPaths.jobs)).items, enabled);
export const useJobOperation = (code: string | undefined) =>
  useFedQuery(fedKeys.job(code ?? ""), () => api.get<JobOperationDetail>(fedPaths.job(code ?? "")), Boolean(code));
export const useApprovalRoutes = () =>
  useFedQuery(fedKeys.approvalRoutes, () => api.get<ApprovalRouteDefinitionList>(fedPaths.approvalRoutes));
export const useApprovalRoute = (approvalId: string | undefined) =>
  useFedQuery(
    fedKeys.approvalRoute(approvalId ?? ""),
    () => api.get<ApprovalRoute>(fedPaths.approvalRoute(approvalId ?? "")),
    Boolean(approvalId),
  );
export const useGateConditions = (tid: string, query: Q = {}) =>
  useFedQuery(
    fedKeys.gateConditions(tid, query),
    () => fetchAllPages<TrackedGateCondition>(fedPaths.gateConditions(tid), query),
    Boolean(tid),
  );
export const useMyPreferences = () =>
  useFedQuery(fedKeys.preferences, () => api.get<NotificationPreferences>(fedPaths.myPreferences));
export const useMyDigest = (id: string | undefined) =>
  useFedQuery(fedKeys.digest(id ?? ""), () => api.get<NotificationDigest>(fedPaths.myDigest(id ?? "")), Boolean(id));
export const useNotificationPolicy = (enabled = true) =>
  useFedQuery(fedKeys.policy, () => api.get<NotificationPolicy>(fedPaths.policy), enabled);
export const useCutoffPack = (tid: string, meetingId: string | undefined) =>
  useFedQuery(
    fedKeys.cutoffPack(tid, meetingId ?? ""),
    () => api.get<MeetingCutoffPack>(fedPaths.cutoffPack(tid, meetingId ?? "")),
    Boolean(tid && meetingId),
  );
