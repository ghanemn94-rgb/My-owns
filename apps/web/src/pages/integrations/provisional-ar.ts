// The provisional-Arabic label of the P6 slice B and A catalogue texts (T-DG6-FE-C; p6-work-split §B/A.9: "Arabic
// labelled provisional"; ADR-0055 §4, ADR-0056 §5: "Arabic in the catalogues, labelled provisional").
//
// JSON catalogues cannot carry comments, so the label lives here as data that a test checks
// (pages/integrations/integrations-i18n.test.ts): every key below its prefix is Arabic awaiting a Mobily language
// review. A key ending in "." stands for every key below that prefix. Sources:
//  - "be-o": the Arabic proposed in the T-DG6-BE-O handback §5 (actionable-error texts, external-change problems and the
//    three confirmation labels), used as proposed;
//  - "kbe-a": the Arabic proposed in the T-DG6-KBE-A handback §5.4 (the row-reason texts), used as proposed;
//  - "fe-c": written by T-DG6-FE-C (the ADRs give English only).
// When a reviewed translation replaces a text, remove or narrow its entry in the same change.

export type ProvisionalArabicSourceBA = "be-o" | "kbe-a" | "fe-c";

export const BA_PROVISIONAL_ARABIC: Readonly<Record<string, ProvisionalArabicSourceBA>> = {
  "integrations.": "fe-c",
  "integrations.actionable.connector__": "be-o",
  "imports.": "fe-c",
  "imports.reason.import__row__": "kbe-a",
  "externalChange.": "fe-c",
  "externalChange.state.": "be-o",
  "nav.sub.integrations": "fe-c",
  "nav.sub.imports": "fe-c",
  "problems.connector__": "fe-c",
  "problems.integration_run__": "fe-c",
  "problems.outbound_write__": "fe-c",
  "problems.external_change__": "be-o",
  "problems.import__": "fe-c",
  "problems.webhook__": "fe-c",
};

/** The most specific entry that covers `key` (the longest matching prefix or the exact key), or undefined. */
export function provisionalSourceOf(key: string): ProvisionalArabicSourceBA | undefined {
  let best: string | undefined;
  for (const k of Object.keys(BA_PROVISIONAL_ARABIC)) {
    const covers = k.endsWith(".") || k.endsWith("__") ? key.startsWith(k) : key === k;
    if (covers && (best === undefined || k.length > best.length)) best = k;
  }
  return best === undefined ? undefined : BA_PROVISIONAL_ARABIC[best];
}
