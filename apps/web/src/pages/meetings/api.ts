// Slice D web seams (T-DG4-FE-D; p4-work-split §D.5; ADR-0032): the request paths and read hooks of forums, meeting
// series, meetings and the committee workflow (agenda, attendance, minutes, outputs, actions, blocker status), the T16
// executive decision log, escalations and escalation rules. Query keys come from FE-A's `p4Keys.area(<slice D area>,
// tid, …)`, so `useP4Refresh(tid)` refreshes every view after a mutation. SYNTHETIC data only in tests and demos.
import { useQuery } from "@tanstack/react-query";
import type {
  AgendaItem,
  BlockerStatus,
  DecisionEscalation,
  EscalationRule,
  ExecutiveDecision,
  Forum,
  ForumParticipant,
  Meeting,
  MeetingAction,
  MeetingAttendance,
  MeetingMinutes,
  MeetingOutput,
  MeetingSeries,
  MeetingSeriesResult,
} from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { p4Keys } from "../../api/p4.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type {
  AgendaItem,
  BlockerStatus,
  DecisionEscalation,
  EscalationRule,
  ExecutiveDecision,
  Forum,
  ForumParticipant,
  Meeting,
  MeetingAction,
  MeetingAttendance,
  MeetingMinutes,
  MeetingOutput,
  MeetingSeries,
  MeetingSeriesResult,
};

const v1 = "/api/v1";
const tBase = (tid: string) => `${v1}/transformations/${tid}`;
const mBase = (tid: string, mid: string) => `${tBase(tid)}/meetings/${mid}`;

/** The paths of the slice D operations the screens call (operationId in the comment). */
export const govPaths = {
  // forums (BE-F)
  forums: (tid: string) => `${tBase(tid)}/forums`, // listForums / createForum
  forum: (tid: string, id: string) => `${tBase(tid)}/forums/${id}`, // getForum / updateForum
  participants: (tid: string, id: string) => `${tBase(tid)}/forums/${id}/participants`, // listForumParticipants / addForumParticipant
  removeParticipant: (tid: string, id: string, pid: string) => `${tBase(tid)}/forums/${id}/participants/${pid}/remove`, // removeForumParticipant
  // meeting series (BE-F)
  series: (tid: string) => `${tBase(tid)}/meeting-series`, // listMeetingSeries / createMeetingSeries
  oneSeries: (tid: string, id: string) => `${tBase(tid)}/meeting-series/${id}`, // getMeetingSeries / updateMeetingSeries
  endSeries: (tid: string, id: string) => `${tBase(tid)}/meeting-series/${id}/end`, // endMeetingSeries
  // meetings (BE-F)
  meetings: (tid: string) => `${tBase(tid)}/meetings`, // listMeetings / createMeeting
  meeting: (tid: string, id: string) => mBase(tid, id), // getMeeting / updateMeeting
  publishAgenda: (tid: string, id: string) => `${mBase(tid, id)}/publish-agenda`, // publishMeetingAgenda
  start: (tid: string, id: string) => `${mBase(tid, id)}/start`, // startMeeting
  close: (tid: string, id: string) => `${mBase(tid, id)}/close`, // closeMeeting
  cancel: (tid: string, id: string) => `${mBase(tid, id)}/cancel`, // cancelMeeting
  // committee workflow (BE-F2)
  agenda: (tid: string, id: string) => `${mBase(tid, id)}/agenda-items`, // listAgendaItems / createAgendaItem
  agendaItem: (tid: string, id: string, aid: string) => `${mBase(tid, id)}/agenda-items/${aid}`, // updateAgendaItem
  publishItem: (tid: string, id: string, aid: string) => `${mBase(tid, id)}/agenda-items/${aid}/publish`, // publishAgendaItem
  withdrawItem: (tid: string, id: string, aid: string) => `${mBase(tid, id)}/agenda-items/${aid}/withdraw`, // withdrawAgendaItem
  itemOutcome: (tid: string, id: string, aid: string) => `${mBase(tid, id)}/agenda-items/${aid}/outcome`, // recordAgendaItemOutcome
  attendance: (tid: string, id: string) => `${mBase(tid, id)}/attendance`, // listMeetingAttendance / recordMeetingAttendance
  attendanceRow: (tid: string, id: string, rid: string) => `${mBase(tid, id)}/attendance/${rid}`, // updateMeetingAttendance
  minutes: (tid: string, id: string) => `${mBase(tid, id)}/minutes`, // getMeetingMinutes / createMeetingMinutes / updateMeetingMinutes
  approveMinutes: (tid: string, id: string) => `${mBase(tid, id)}/minutes/approve`, // approveMeetingMinutes
  publishMinutes: (tid: string, id: string) => `${mBase(tid, id)}/minutes/publish`, // publishMeetingMinutes
  outputs: (tid: string, id: string) => `${mBase(tid, id)}/outputs`, // listMeetingOutputs / createMeetingOutput
  actions: (tid: string, id: string) => `${mBase(tid, id)}/actions`, // listMeetingActions / createMeetingAction
  blockers: (tid: string, id: string) => `${mBase(tid, id)}/blocker-statuses`, // listBlockerStatuses / recordBlockerStatus
  // T16 and escalation (BE-G)
  decisions: (tid: string) => `${tBase(tid)}/executive-decisions`, // listExecutiveDecisions / createExecutiveDecision
  decision: (tid: string, id: string) => `${tBase(tid)}/executive-decisions/${id}`, // getExecutiveDecision / updateExecutiveDecision
  decisionOutcome: (tid: string, id: string) => `${tBase(tid)}/executive-decisions/${id}/outcome`, // recordExecutiveDecisionOutcome
  escalations: (tid: string) => `${tBase(tid)}/escalations`, // listDecisionEscalations
  escalationRules: (tid: string) => `${tBase(tid)}/escalation-rules`, // listEscalationRules / createEscalationRule
  escalationRule: (tid: string, kind: string) => `${tBase(tid)}/escalation-rules/${kind}`, // updateEscalationRule
} as const;

const opts = { retry: shouldRetry, staleTime: 15_000 } as const;

export function useForums(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("forums", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<Forum>(govPaths.forums(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useForum(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("forums", tid, "forum", id),
    queryFn: () => api.get<Forum>(govPaths.forum(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useForumParticipants(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("forums", tid, "participants", id),
    queryFn: () => fetchAllPages<ForumParticipant>(govPaths.participants(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useMeetingSeries(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("meeting-series", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<MeetingSeries>(govPaths.series(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useMeetings(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("meetings", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<Meeting>(govPaths.meetings(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useMeeting(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("meetings", tid, "meeting", id),
    queryFn: () => api.get<Meeting>(govPaths.meeting(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useAgendaItems(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("meetings", tid, "agenda", id),
    queryFn: () => fetchAllPages<AgendaItem>(govPaths.agenda(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useAttendance(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("meetings", tid, "attendance", id),
    queryFn: () => fetchAllPages<MeetingAttendance>(govPaths.attendance(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

/** The meeting's minutes, or null when none exist yet (404 on a readable meeting means "no minutes"). */
export function useMinutes(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("meetings", tid, "minutes", id),
    queryFn: async () => {
      try {
        return await api.get<MeetingMinutes>(govPaths.minutes(tid, id));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useMeetingOutputs(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("meetings", tid, "outputs", id),
    queryFn: () => fetchAllPages<MeetingOutput>(govPaths.outputs(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useMeetingActions(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("meetings", tid, "actions", id),
    queryFn: () => fetchAllPages<MeetingAction>(govPaths.actions(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useBlockerStatuses(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("escalations", tid, "blockers", id),
    queryFn: () => fetchAllPages<BlockerStatus>(govPaths.blockers(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useExecutiveDecisions(tid: string, query: Record<string, string> = {}) {
  return useQuery({
    queryKey: p4Keys.area("executive-decisions", tid, "list", JSON.stringify(query)),
    queryFn: () => fetchAllPages<ExecutiveDecision>(govPaths.decisions(tid), query),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useExecutiveDecision(tid: string, id: string) {
  return useQuery({
    queryKey: p4Keys.area("executive-decisions", tid, "decision", id),
    queryFn: () => api.get<ExecutiveDecision>(govPaths.decision(tid, id)),
    enabled: Boolean(tid && id),
    ...opts,
  });
}

export function useDecisionEscalations(tid: string, decisionId?: string) {
  return useQuery({
    queryKey: p4Keys.area("escalations", tid, "list", decisionId ?? "all"),
    queryFn: () => fetchAllPages<DecisionEscalation>(govPaths.escalations(tid), decisionId ? { decisionId } : {}),
    enabled: Boolean(tid),
    ...opts,
  });
}

export function useEscalationRules(tid: string) {
  return useQuery({
    queryKey: p4Keys.area("escalations", tid, "rules"),
    queryFn: () => fetchAllPages<EscalationRule>(govPaths.escalationRules(tid)),
    enabled: Boolean(tid),
    ...opts,
  });
}
