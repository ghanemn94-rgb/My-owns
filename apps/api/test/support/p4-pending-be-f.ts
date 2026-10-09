// P4 operations without a route yet, owned by backend-workflow-engineer task BE-F (slice D: forums and participants, meeting series and generation, meetings)
// (docs/architecture/p4-work-split.md §D). Remove an entry in the same change that registers its route and exercises it
// in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_F: readonly string[] = [
  "listForums",
  "createForum",
  "getForum",
  "updateForum",
  "listForumParticipants",
  "addForumParticipant",
  "removeForumParticipant",
  "listMeetingSeries",
  "createMeetingSeries",
  "getMeetingSeries",
  "updateMeetingSeries",
  "endMeetingSeries",
  "listMeetings",
  "createMeeting",
  "getMeeting",
  "updateMeeting",
  "publishMeetingAgenda",
  "startMeeting",
  "closeMeeting",
  "cancelMeeting",
];
