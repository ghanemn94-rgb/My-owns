// The provisional-Arabic label of the slice H texts (T-DG6-FE-D; p6-work-split §H/G.6; ADR-0057 §10 "Arabic
// provisional"). JSON catalogues cannot carry comments, so the label lives here as data that productivity-i18n.test.ts
// binds to the catalogues: every Arabic text of the `productivity` namespace and of the slice H block of `problems` is
// PROVISIONAL (written by T-DG6-FE-D) and awaits a Mobily language review. A key ending in "." stands for every key
// below that prefix. When a reviewed translation replaces a text, remove its entry here in the same change.
// The help topic texts come from the API (0108 seeds) and carry their own `arabicProvisional` flag.

export const PRODUCTIVITY_PROVISIONAL_ARABIC: readonly string[] = [
  "productivity.",
  "problems.search__query_too_short",
  "problems.search__index_unavailable",
  "problems.saved_view__unknown_key",
  "problems.saved_view__unknown_key_noParams",
  "problems.saved_view__name_taken",
  "problems.saved_view__not_owner",
  "problems.saved_view__deleted",
  "problems.saved_view__default_conflict",
  "problems.form_record__compare_versions_invalid",
];
