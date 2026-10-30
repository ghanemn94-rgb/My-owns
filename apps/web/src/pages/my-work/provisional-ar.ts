// The provisional-Arabic label of the T-DG6-FE-F2 strings (p6-work-split §I/K.4). The catalogues are JSON files, which
// cannot carry comments, so the label lives here as data that home-regions.test.tsx checks: every Arabic text under a
// listed prefix exists, is Arabic, and differs from the English. All of it is PROVISIONAL, written by T-DG6-FE-F2 (ADR-0061
// gives no Arabic for the region names), and awaits a Mobily language review. FE-A's list (i18n/provisional-ar-p6.ts) is
// FE-A's file: the handback asks the orchestrator to fold this entry into it at merge.
export const FE_F2_PROVISIONAL_ARABIC: Readonly<Record<string, "fe-f2">> = {
  // myWork.json: the "at a glance" regions of the home and executive pages (ADR-0061 §4.1)
  "myWork.home.": "fe-f2",
};
