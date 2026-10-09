// P4 operations without a route yet, owned by backend-workflow-engineer task BE-F2 (slice D: agenda items and executive-ask briefs, attendance and quorum, minutes, meeting outputs and actions)
// (docs/architecture/p4-work-split.md §D). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_F2: readonly string[] = [
  "listAgendaItems",
  "createAgendaItem",
  "updateAgendaItem",
  "publishAgendaItem",
  "withdrawAgendaItem",
  "recordAgendaItemOutcome",
  "listMeetingAttendance",
  "recordMeetingAttendance",
  "updateMeetingAttendance",
  "getMeetingMinutes",
  "createMeetingMinutes",
  "updateMeetingMinutes",
  "approveMeetingMinutes",
  "publishMeetingMinutes",
  "listMeetingOutputs",
  "createMeetingOutput",
  "listMeetingActions",
  "createMeetingAction",
];
