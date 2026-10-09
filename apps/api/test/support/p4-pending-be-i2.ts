// P4 operations without a route yet, owned by backend-workflow-engineer task BE-I2 (slice G: controls, control checks, sustainment reviews, the CI backlog and lessons)
// (docs/architecture/p4-work-split.md §F+G). Remove an entry in the same change that registers its route and exercises
// it in the contract test. Must be empty when the DG4 candidate freezes. Only the owning task edits this file.
export const P4_PENDING_BE_I2: readonly string[] = [
  "listControls",
  "createControl",
  "updateControl",
  "listControlChecks",
  "recordControlCheck",
  "listSustainmentReviews",
  "completeSustainmentReview",
  "listImprovementItems",
  "createImprovementItem",
  "updateImprovementItem",
  "listLessons",
  "createLesson",
  "updateLesson",
  "publishLesson",
  "searchLessons",
];
