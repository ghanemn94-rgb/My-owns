// P4 web seams (T-DG4-FE-A; p4-plan §5.1 and §5.3, p4-work-split §I+C.5).
//
//  1. `p4Keys`: the query keys of EVERY P4 area, added up front so FE-B…FE-G only add hooks in their own
//     `pages/<feature>/api.ts` and never edit `api/**` (missing keys go into their handback; the orchestrator merges
//     them append-only). Keys of one transformation start with ["p4", <area>, tid] so `useP4Refresh(tid)` refreshes
//     all of them after a mutation; personal keys (My Work, inbox, approvals, delegations) start with ["p4", "me", …].
//  2. The read hooks and request paths of the 51 slice I+C operations (ADR-0025, ADR-0026; tags calendar, jobs,
//     tasks, groups, role-mappings, delegations, approvals, decision-rights, raci). Writes are sent by the screens with
//     `api.send` (If-Match from the record's `version`), inside a session guard (auth/sessionBound.ts).
//
// Unknown is data, never a default: a null due date stays null here and renders as Unknown with its reason.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Approval,
  ApprovalDecisionRecord,
  BusinessCalendar,
  CalendarHoliday,
  DecisionRight,
  DecisionRightTemplate,
  Delegation,
  DueDatePreview,
  GovernanceMatrix,
  GovernanceParty,
  Group,
  GroupMember,
  InboxNotification,
  JobSchedule,
  PartyResolution,
  Raci,
  RaciTemplate,
  RoleMapping,
  TransformReadiness,
  WorkItem,
  WorkingDayComputation,
} from "@mth/shared/schemas";
import { api, getSessionGeneration } from "./client.ts";
import { fetchAllPages, shouldRetry } from "./queries.ts";

export type {
  Approval,
  ApprovalDecisionRecord,
  BusinessCalendar,
  CalendarHoliday,
  DecisionRight,
  DecisionRightTemplate,
  Delegation,
  DueDatePreview,
  GovernanceMatrix,
  GovernanceParty,
  Group,
  GroupMember,
  InboxNotification,
  JobSchedule,
  PartyResolution,
  Raci,
  RaciTemplate,
  RoleMapping,
  TransformReadiness,
  WorkItem,
  WorkingDayComputation,
};

/** The inbox answer carries the unread count beside the page (ADR-0025 §4). */
export interface InboxPage {
  readonly items: InboxNotification[];
  readonly nextCursor: string | null;
  readonly unreadCount: number;
}

// ------------------------------------------------------------------------------------------------ query keys

/** The transformation-scoped P4 areas (p4-plan §4/§5.1); each FE task uses the ones of its slice. */
export const P4_TRANSFORMATION_AREAS = [
  // FE-A (slices I and C)
  "decision-rights",
  "raci",
  "governance-matrices",
  "role-mappings",
  "approval-decisions",
  "transform-readiness",
  // FE-B (slice A)
  "kpis",
  "kpi-actuals",
  "reporting-periods",
  "calculation-runs",
  "kpi-status",
  "rag-overrides",
  "data-quality",
  // FE-C (slice B)
  "benefits",
  "benefit-allocations",
  "benefit-groups",
  "benefit-overlaps",
  "benefit-scenarios",
  "benefit-measurements",
  "benefit-totals",
  "finance-validations",
  // FE-D (slices E and D)
  "raid",
  "actions",
  "corrective-actions",
  "budget-lines",
  "schedule-network",
  "forums",
  "meeting-series",
  "meetings",
  "executive-decisions",
  "escalations",
  // FE-E (slices F and G)
  "stakeholder-groups",
  "adoption",
  "performance-areas",
  "bau-handovers",
  "controls",
  "improvement-items",
  "lessons",
  // FE-F (slice H)
  "gate-exceptions",
  "change-requests",
  "closure",
  // FE-G (slices J and K)
  "dashboards",
  "workspace-header",
  "traceability",
] as const;
export type P4TransformationArea = (typeof P4_TRANSFORMATION_AREAS)[number];

export const p4Keys = {
  all: ["p4"] as const,
  /** Everything of one transformation in one P4 area: ["p4", area, tid, ...rest]. */
  area: (area: P4TransformationArea, tid: string, ...rest: (string | number)[]) => ["p4", area, tid, ...rest] as const,
  // Personal (the signed-in user's) views: My Work items, inbox, approvals, delegations.
  me: ["p4", "me"] as const,
  workItems: (query: Record<string, string> = {}) => ["p4", "me", "work-items", query] as const,
  workItem: (id: string) => ["p4", "me", "work-item", id] as const,
  inbox: (query: Record<string, string> = {}) => ["p4", "me", "inbox", query] as const,
  approvals: (query: Record<string, string> = {}) => ["p4", "me", "approvals", query] as const,
  approval: (id: string) => ["p4", "me", "approval", id] as const,
  delegations: (query: Record<string, string> = {}) => ["p4", "me", "delegations", query] as const,
  delegation: (id: string) => ["p4", "me", "delegation", id] as const,
  // Organization configuration: calendars, holidays, job schedules, groups, governance parties, templates.
  calendars: (orgId: string) => ["p4", "org", orgId, "calendars"] as const,
  calendar: (calendarId: string) => ["p4", "calendar", calendarId] as const,
  holidays: (calendarId: string, year: number | null) => ["p4", "calendar", calendarId, "holidays", year] as const,
  workingDays: (calendarId: string, from: string, workingDays: number) =>
    ["p4", "calendar", calendarId, "working-days", from, workingDays] as const,
  jobSchedules: ["p4", "job-schedules"] as const,
  groups: (orgId: string) => ["p4", "org", orgId, "groups"] as const,
  group: (groupId: string) => ["p4", "group", groupId] as const,
  groupMembers: (groupId: string) => ["p4", "group", groupId, "members"] as const,
  governanceParties: ["p4", "governance-parties"] as const,
  decisionRightTemplates: ["p4", "decision-right-templates"] as const,
  raciTemplate: ["p4", "raci-template"] as const,
  // Organization-wide queues of later slices (FE-C Finance queue, FE-G dashboards and Executive Overview).
  financeQueue: (orgId: string) => ["p4", "org", orgId, "finance-queue"] as const,
  dashboard: (kind: string, query: Record<string, string> = {}) => ["p4", "dashboard", kind, query] as const,
  executiveOverview: (query: Record<string, string> = {}) => ["p4", "executive-overview", query] as const,
};

/** True for every P4 key of one transformation (["p4", area, tid, ...]). */
export function isP4KeyOf(tid: string, key: readonly unknown[]): boolean {
  return (
    key[0] === "p4" &&
    typeof key[1] === "string" &&
    (P4_TRANSFORMATION_AREAS as readonly string[]).includes(key[1]) &&
    key[2] === tid
  );
}

/**
 * Refreshes after a mutation: every P4 key of the transformation (when given) and the personal views (a decision or a
 * mapping changes My Work). Returns false when the session changed meanwhile (the caller then does nothing more).
 */
export function useP4Refresh(tid?: string): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return async () => {
    const generation = getSessionGeneration();
    await Promise.all([
      tid ? queryClient.invalidateQueries({ predicate: (q) => isP4KeyOf(tid, q.queryKey) }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: p4Keys.me }),
    ]);
    return getSessionGeneration() === generation;
  };
}

/** Refreshes one organization-level key family (calendars, groups, job schedules…) and the personal views. */
export function useP4KeyRefresh(): (key: readonly unknown[]) => Promise<boolean> {
  const queryClient = useQueryClient();
  return async (key) => {
    const generation = getSessionGeneration();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({ queryKey: p4Keys.me }),
    ]);
    return getSessionGeneration() === generation;
  };
}

// ------------------------------------------------------------------------------------------------ request paths

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;

/** The paths of the 51 slice I+C operations (operationId in the comment). */
export const p4Paths = {
  // calendar
  orgCalendars: (orgId: string) => `${v1}/organizations/${orgId}/calendars`, // list/createBusinessCalendar
  calendar: (calendarId: string) => `${v1}/calendars/${calendarId}`, // get/updateBusinessCalendar
  holidays: (calendarId: string) => `${v1}/calendars/${calendarId}/holidays`, // list/createCalendarHoliday
  holiday: (calendarId: string, holidayId: string) => `${v1}/calendars/${calendarId}/holidays/${holidayId}`, // updateCalendarHoliday
  workingDays: (calendarId: string) => `${v1}/calendars/${calendarId}/working-days`, // computeWorkingDayDueDate
  // jobs
  jobSchedules: `${v1}/admin/job-schedules`, // listJobSchedules
  jobSchedule: (jobCode: string) => `${v1}/admin/job-schedules/${encodeURIComponent(jobCode)}`, // updateJobSchedule
  // tasks
  myWorkItems: `${v1}/me/work-items`, // listMyWorkItems
  workItem: (id: string) => `${v1}/work-items/${id}`, // getWorkItem
  completeWorkItem: (id: string) => `${v1}/work-items/${id}/complete`, // completeWorkItem
  myInbox: `${v1}/me/inbox`, // listMyInbox
  markRead: (id: string) => `${v1}/me/inbox/${id}/read`, // markInboxNotificationRead
  // groups
  orgGroups: (orgId: string) => `${v1}/organizations/${orgId}/groups`, // list/createGroup
  group: (groupId: string) => `${v1}/groups/${groupId}`, // get/updateGroup
  groupMembers: (groupId: string) => `${v1}/groups/${groupId}/members`, // list/addGroupMember
  removeGroupMember: (groupId: string, memberId: string) => `${v1}/groups/${groupId}/members/${memberId}/remove`, // removeGroupMember
  // role mappings
  governanceParties: `${v1}/governance-parties`, // listGovernanceParties
  roleMappings: (tid: string) => `${tBase(tid)}/role-mappings`, // list/createRoleMapping
  endRoleMapping: (tid: string, mappingId: string) => `${tBase(tid)}/role-mappings/${mappingId}/end`, // endRoleMapping
  resolveParty: (tid: string) => `${tBase(tid)}/role-mappings/resolve`, // resolveGovernanceParty
  // delegations
  delegations: `${v1}/delegations`, // list/createDelegation
  delegation: (id: string) => `${v1}/delegations/${id}`, // getDelegation
  revokeDelegation: (id: string) => `${v1}/delegations/${id}/revoke`, // revokeDelegation
  // approvals
  myApprovals: `${v1}/approvals`, // listMyApprovals
  requestApproval: (tid: string) => `${tBase(tid)}/approvals`, // requestApproval
  approval: (id: string) => `${v1}/approvals/${id}`, // getApproval
  decideApproval: (id: string) => `${v1}/approvals/${id}/decisions`, // decideApproval
  resubmitApproval: (id: string) => `${v1}/approvals/${id}/resubmit`, // resubmitApproval
  withdrawApproval: (id: string) => `${v1}/approvals/${id}/withdraw`, // withdrawApproval
  approvalDecisionRecords: (tid: string) => `${tBase(tid)}/approval-decisions`, // listApprovalDecisionRecords
  // decision rights (T11)
  decisionRightTemplates: `${v1}/decision-right-templates`, // listDecisionRightTemplates
  decisionRights: (tid: string) => `${tBase(tid)}/decision-rights`, // list/createDecisionRight
  decisionRight: (tid: string, id: string) => `${tBase(tid)}/decision-rights/${id}`, // get/updateDecisionRight
  decisionRightDueDate: (tid: string, id: string) => `${tBase(tid)}/decision-rights/${id}/due-date`, // previewDecisionRightDueDate
  // RACI (T12), governance matrices, Transform readiness
  raciTemplate: `${v1}/raci-template`, // getRaciTemplate
  raci: (tid: string) => `${tBase(tid)}/raci`, // getTransformationRaci
  raciDeliverables: (tid: string) => `${tBase(tid)}/raci/deliverables`, // createRaciDeliverable
  raciDeliverable: (tid: string, id: string) => `${tBase(tid)}/raci/deliverables/${id}`, // updateRaciDeliverable
  governanceMatrices: (tid: string) => `${tBase(tid)}/governance-matrices`, // listGovernanceMatrices
  submitMatrix: (tid: string, kind: "decision_rights" | "raci") => `${tBase(tid)}/governance-matrices/${kind}/submit`, // submitGovernanceMatrix
  transformReadiness: (tid: string) => `${tBase(tid)}/readiness/transform`, // getTransformReadiness
};

// ------------------------------------------------------------------------------------------------ read hooks

const items = async <T>(path: string): Promise<T[]> => (await api.get<{ items: T[] }>(path)).items;

// calendar and jobs
export function useCalendars(orgId: string | undefined) {
  return useQuery({
    queryKey: p4Keys.calendars(orgId ?? ""),
    queryFn: () => fetchAllPages<BusinessCalendar>(p4Paths.orgCalendars(orgId ?? "")),
    enabled: Boolean(orgId),
    retry: shouldRetry,
  });
}
export function useCalendar(calendarId: string | undefined) {
  return useQuery({
    queryKey: p4Keys.calendar(calendarId ?? ""),
    queryFn: () => api.get<BusinessCalendar>(p4Paths.calendar(calendarId ?? "")),
    enabled: Boolean(calendarId),
    retry: shouldRetry,
  });
}
export function useHolidays(calendarId: string | undefined, year: number | null) {
  return useQuery({
    queryKey: p4Keys.holidays(calendarId ?? "", year),
    queryFn: () =>
      fetchAllPages<CalendarHoliday>(p4Paths.holidays(calendarId ?? ""), year === null ? {} : { year: String(year) }),
    enabled: Boolean(calendarId),
    retry: shouldRetry,
  });
}
export function useWorkingDayComputation(calendarId: string | undefined, from: string, workingDays: number | null) {
  return useQuery({
    queryKey: p4Keys.workingDays(calendarId ?? "", from, workingDays ?? 0),
    queryFn: () =>
      api.get<WorkingDayComputation>(p4Paths.workingDays(calendarId ?? ""), {
        from,
        workingDays: String(workingDays),
      }),
    enabled: Boolean(calendarId) && from !== "" && workingDays !== null,
    retry: shouldRetry,
  });
}
export function useJobSchedules(enabled = true) {
  return useQuery({
    queryKey: p4Keys.jobSchedules,
    queryFn: () => fetchAllPages<JobSchedule>(p4Paths.jobSchedules),
    enabled,
    retry: shouldRetry,
  });
}

// tasks and inbox
export function useMyWorkItems(query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.workItems(query),
    queryFn: () => fetchAllPages<WorkItem>(p4Paths.myWorkItems, query),
    retry: shouldRetry,
  });
}
export function useWorkItem(id: string | undefined) {
  return useQuery({
    queryKey: p4Keys.workItem(id ?? ""),
    queryFn: () => api.get<WorkItem>(p4Paths.workItem(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
/** The first inbox page (newest first, at most 100) with the unread count. */
export function useMyInbox(query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.inbox(query),
    queryFn: () => api.get<InboxPage>(p4Paths.myInbox, { ...query, limit: 100 }),
    retry: shouldRetry,
  });
}

// groups and role mappings
export function useGroups(orgId: string | undefined) {
  return useQuery({
    queryKey: p4Keys.groups(orgId ?? ""),
    queryFn: () => fetchAllPages<Group>(p4Paths.orgGroups(orgId ?? "")),
    enabled: Boolean(orgId),
    retry: shouldRetry,
  });
}
export function useGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: p4Keys.group(groupId ?? ""),
    queryFn: () => api.get<Group>(p4Paths.group(groupId ?? "")),
    enabled: Boolean(groupId),
    retry: shouldRetry,
  });
}
export function useGroupMembers(groupId: string | undefined) {
  return useQuery({
    queryKey: p4Keys.groupMembers(groupId ?? ""),
    queryFn: () => fetchAllPages<GroupMember>(p4Paths.groupMembers(groupId ?? "")),
    enabled: Boolean(groupId),
    retry: shouldRetry,
  });
}
export function useGovernanceParties() {
  return useQuery({
    queryKey: p4Keys.governanceParties,
    queryFn: () => items<GovernanceParty>(p4Paths.governanceParties),
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  });
}
export function useRoleMappings(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("role-mappings", tid, JSON.stringify(query)),
    queryFn: () => fetchAllPages<RoleMapping>(p4Paths.roleMappings(tid), query),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function usePartyResolution(tid: string, party: string, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("role-mappings", tid, "resolve", party),
    queryFn: () => api.get<PartyResolution>(p4Paths.resolveParty(tid), { party }),
    enabled: Boolean(tid) && Boolean(party) && enabled,
    retry: shouldRetry,
  });
}

// delegations
export function useDelegations(query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.delegations(query),
    queryFn: () => fetchAllPages<Delegation>(p4Paths.delegations, query),
    retry: shouldRetry,
  });
}

// approvals
export function useMyApprovals(query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.approvals(query),
    queryFn: () => fetchAllPages<Approval>(p4Paths.myApprovals, query),
    retry: shouldRetry,
  });
}
export function useApproval(id: string | undefined) {
  return useQuery({
    queryKey: p4Keys.approval(id ?? ""),
    queryFn: () => api.get<Approval>(p4Paths.approval(id ?? "")),
    enabled: Boolean(id),
    retry: shouldRetry,
  });
}
export function useApprovalDecisionRecords(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("approval-decisions", tid),
    queryFn: () => fetchAllPages<ApprovalDecisionRecord>(p4Paths.approvalDecisionRecords(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

// decision rights, RACI, matrices, Transform readiness
export function useDecisionRightTemplates() {
  return useQuery({
    queryKey: p4Keys.decisionRightTemplates,
    queryFn: () => items<DecisionRightTemplate>(p4Paths.decisionRightTemplates),
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  });
}
export function useDecisionRights(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("decision-rights", tid),
    queryFn: () => fetchAllPages<DecisionRight>(p4Paths.decisionRights(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useDecisionRightDueDate(tid: string, id: string, raisedOn: string, urgent: boolean, enabled = true) {
  return useQuery({
    queryKey: p4Keys.area("decision-rights", tid, id, "due-date", raisedOn, urgent ? "urgent" : "normal"),
    queryFn: () =>
      api.get<DueDatePreview>(p4Paths.decisionRightDueDate(tid, id), {
        raisedOn,
        ...(urgent ? { urgent: "true" } : {}),
      }),
    enabled: Boolean(tid) && Boolean(id) && raisedOn !== "" && enabled,
    retry: shouldRetry,
  });
}
export function useRaciTemplate() {
  return useQuery({
    queryKey: p4Keys.raciTemplate,
    queryFn: () => api.get<RaciTemplate>(p4Paths.raciTemplate),
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  });
}
export function useRaci(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("raci", tid),
    queryFn: () => api.get<Raci>(p4Paths.raci(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useGovernanceMatrices(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("governance-matrices", tid),
    queryFn: () => items<GovernanceMatrix>(p4Paths.governanceMatrices(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
export function useTransformReadiness(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("transform-readiness", tid),
    queryFn: () => api.get<TransformReadiness>(p4Paths.transformReadiness(tid)),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}
