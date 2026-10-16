// The engineering-gate rule (ADR-0049 §7; REQ-S21-001) in TypeScript: the exact mirror of the SQL function
// `p5_mentions_engineering_gate(text)` of `packages/db/migrations/0089_p5_reader_provenance_branding.sql`
// (T-DG5-BE-R2, p5-work-split §I.4). A text names an engineering delivery gate when it contains `DG`, an optional space
// or hyphen, and one digit 0-7 (Western or Arabic-Indic) that is not part of a longer word or number. "G6" (a product
// business gate), "DG8", "DG10" and "EDG7" do not match. Product text never shows engineering gate status: the product
// gates G1-G6 are business approvals inside the product, and product G6 never implies the engineering release gate.
// The API's agreement test runs this function and the SQL function over one corpus.

import { postgresCClasses } from "./ascii-classes.ts";

/** The SQL pattern of `p5_mentions_engineering_gate` (0089), verbatim; applied case-insensitively (`~*`). */
export const ENGINEERING_GATE_PATTERN = String.raw`(^|[^A-Za-z0-9_])DG\s*-?\s*[0-7٠-٧]([^0-9٠-٩]|$)`;

// The C-ctype classes and ASCII-only case folding of PostgreSQL's `~*` (see claims.ts and ascii-classes.ts).
const GATE = new RegExp(postgresCClasses(ENGINEERING_GATE_PATTERN), "i");

/** True when `text` names an engineering delivery gate (DG0-DG7); false for null, undefined and empty text. */
export function mentionsEngineeringGate(text: string | null | undefined): boolean {
  if (text === null || text === undefined) return false;
  return GATE.test(text);
}
