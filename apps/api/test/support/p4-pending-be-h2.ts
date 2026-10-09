// P4 operations without a route yet, owned by backend-workflow-engineer task BE-H2 (slice F: feedback and assessment forms, invitations, assessment records and training records)
// (docs/architecture/p4-work-split.md §F+G). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_H2: readonly string[] = [
  "listAssessmentForms",
  "createAssessmentForm",
  "getAssessmentForm",
  "updateAssessmentForm",
  "publishAssessmentForm",
  "retireAssessmentForm",
  "listAssessmentInvitations",
  "createAssessmentInvitations",
  "cancelAssessmentInvitation",
  "listAssessmentRecords",
  "createAssessmentRecord",
  "getAssessmentRecord",
  "reviewAssessmentRecord",
  "withdrawAssessmentRecord",
  "listTrainingRecords",
  "createTrainingRecord",
  "updateTrainingRecord",
];
