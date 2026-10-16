// The claim rule (ADR-0049 §7; REQ-PB-001, M0089) in TypeScript: the exact mirror of the SQL function
// `p5_claims_official_pmi(text)` of `packages/db/migrations/0089_p5_reader_provenance_branding.sql` (T-DG5-BE-R2,
// p5-work-split §I.4). A text CLAIMS official PMI status when, after every negated mention is removed, it still matches
// one of the claim patterns (case-insensitive). A negated mention ("Not an official PMI standard.", "ليس معيارًا رسميًا
// من PMI") is a true disclaimer and is allowed. The patterns below are character for character the SQL constants
// `claim` and `neg`; the API's agreement test runs both over one corpus, so a change to one without the other fails.
//
// Regex dialect notes (PostgreSQL ARE vs JavaScript, both checked by the agreement corpus):
//  - the pinned test and demo clusters use the C ctype (ADR-0003), where `\s`/`\S` know only the ASCII whitespace
//    characters and case folding is ASCII-only (Arabic has no case). The patterns are therefore compiled through
//    `postgresCClasses` (ascii-classes.ts) and without the `u` flag, which gives JavaScript the same two rules. A
//    database created with a Unicode ctype (e.g. en_US.utf8) also treats non-ASCII spaces such as U+00A0 as `\s`;
//    the product-text scans cover that by also testing a copy whose Unicode spaces are made ASCII (apps/api/test/text-scan/scan.ts);
//  - PostgreSQL alternation is leftmost-longest and JavaScript's is leftmost-first. That changes only how much of a
//    negated phrase is removed, never whether a claim remains: the removal replaces a negated phrase with one space
//    and the claim pattern is then re-tested on the rest.

import { postgresCClasses } from "./ascii-classes.ts";

/** The SQL constant `claim` (0089), verbatim. */
export const PMI_CLAIM_PATTERN =
  String.raw`(official(ly)?\s+(an?\s+)?PMI|PMI[\s-]*(certified|certification|accredited|endorsed|approved)` +
  String.raw`|certified\s+(by|under)\s+(the\s+)?PMI|PMI\s+standard\s+(product|application|platform|tool|software)` +
  String.raw`|(معتمد|معتمدة|مُعتمد|مُعتمدة)\s+من\s+(قبل\s+)?(PMI|معهد\s+إدارة\s+المشاريع)` +
  String.raw`|(معيار|معايير|منهجية)\s+(PMI|معهد\s+إدارة\s+المشاريع)\s+(الرسمي|الرسمية)` +
  String.raw`|شهادة\s+(PMI|معهد\s+إدارة\s+المشاريع)|(PMI|معهد\s+إدارة\s+المشاريع)\s+(الرسمي|الرسمية|المعتمد|المعتمدة)` +
  String.raw`|(رسمي|رسمية|رسميًا|رسمياً)\s+من\s+(PMI|معهد\s+إدارة\s+المشاريع))`;

/** The SQL constant `neg` (0089), verbatim (the SQL doubles the apostrophe of `isn''t`/`aren''t` inside its literal). */
export const PMI_NEGATION_PATTERN = String.raw`((not|never|no|nor|without|isn't|aren't)\s+((an?|the)\s+)?|(ليس|ليست|لا|غير|دون)\s+(\S+\s+)?)`;

const CLAIM = new RegExp(postgresCClasses(PMI_CLAIM_PATTERN), "i");
const NEGATED_CLAIM = new RegExp(postgresCClasses(PMI_NEGATION_PATTERN + PMI_CLAIM_PATTERN), "gi");

/**
 * True when `text` claims official PMI status or certification (en or ar), after removing negated mentions; false for
 * null, undefined and empty text. Mirrors `p5_claims_official_pmi(text)`:
 * `regexp_replace(t, neg || claim, ' ', 'gi') ~* claim`.
 */
export function claimsOfficialPmi(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  return CLAIM.test(text.replace(NEGATED_CLAIM, " "));
}
