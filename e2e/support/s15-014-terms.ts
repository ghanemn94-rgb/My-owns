// qa-verifier (DG6, T-DG6-QA-F): the term list of the REQ-S15-014 clause 2 scan. Binding row REQ-S15-014: "A05;A20:
// ... non-admin screens show no stack traces or infrastructure terms". The list is ADR-0061 §8 ("No infrastructure
// terms on non-admin screens") verbatim, plus the assignment's "SQL keywords in error context" and "file paths".
// It is shared by the root e2e scan (e2e/a20-s15-014-term-scan.spec.ts), the API suite
// (tests/qa/integration/a20-s15-014-no-infra-terms.test.ts) and the unit test that pins it
// (tests/qa/unit/a20-s15-014-term-list.test.ts). Pure data and one function: no product import.

export interface TermPattern {
  /** A stable name for reports. */
  readonly name: string;
  readonly re: RegExp;
  /** Where the pattern comes from. */
  readonly source: "ADR-0061 §8" | "assignment: SQL in error context" | "assignment: file paths";
}

/** Plain words of ADR-0061 §8, matched as whole words, ignoring case (S3 is matched in upper case only). */
const WORDS: readonly string[] = [
  "node_modules",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "SQLSTATE",
  "PostgreSQL",
  "postgres",
  "Kysely",
  "Fastify",
  "pino",
  "mth_app",
  "mth_owner",
  "outbox",
  "advisory lock",
  "localhost",
  "TypeError",
  "ReferenceError",
  "bucket",
  "SMTP",
];

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const TERM_PATTERNS: readonly TermPattern[] = [
  // ADR-0061 §8 gives the stack-frame pattern literally.
  { name: "stack frame", re: /\bat \S+ \(.*:\d+:\d+\)/, source: "ADR-0061 §8" },
  // A frame without a function name ("at /app/x.js:1:2" or "at file:///app/x.js:1:2") is a stack frame too.
  { name: "stack frame (anonymous)", re: /\bat (?:file:\/\/)?\/\S+:\d+:\d+/, source: "ADR-0061 §8" },
  ...WORDS.map((w) => ({
    name: w,
    re: new RegExp(`(?<![A-Za-z0-9_])${esc(w)}(?![A-Za-z0-9_])`, "i"),
    source: "ADR-0061 §8" as const,
  })),
  { name: "127.0.0.1", re: /(?<![\d.])127\.0\.0\.1(?![\d])/, source: "ADR-0061 §8" },
  { name: "[object Object]", re: /\[object Object\]/, source: "ADR-0061 §8" },
  { name: "S3", re: /(?<![A-Za-z0-9_])S3(?![A-Za-z0-9_])/, source: "ADR-0061 §8" },
  // SQL keywords in error context: a statement (keywords in upper case, as SQL is written in code and logs; ordinary
  // sentences such as "Select a transformation from the list" are not SQL), or PostgreSQL's own error sentences.
  {
    name: "SQL statement",
    re: /\b(?:SELECT\s+[\w*"., ]+\s+FROM|INSERT\s+INTO|UPDATE\s+"?\w+"?\s+SET|DELETE\s+FROM)\b/,
    source: "assignment: SQL in error context",
  },
  {
    name: "PostgreSQL error sentence",
    re: /\b(?:relation|column) "[^"]+" (?:of relation "[^"]+" )?does not exist|duplicate key value violates|violates (?:foreign key|check|unique|not-null) constraint|permission denied for (?:table|relation|schema|function)|syntax error at or near/i,
    source: "assignment: SQL in error context",
  },
  // File paths: a POSIX path of two or more segments ending in a source/bundle file, or a Windows drive path.
  {
    name: "file path",
    re: /(?:^|[\s("'=])(?:file:\/\/)?(?:\/[\w.@-]+){2,}\.(?:m?js|cjs|ts|tsx|jsx|json|sql|node)\b/,
    source: "assignment: file paths",
  },
  { name: "file path (windows)", re: /\b[A-Za-z]:\\[\w.\\-]+/, source: "assignment: file paths" },
];

export interface TermHit {
  readonly pattern: string;
  readonly match: string;
  /** Up to 60 characters around the match. */
  readonly context: string;
}

/** Every pattern that matches `text`, with the matched string and its context (empty when the text is clean). */
export function scanTerms(text: string): TermHit[] {
  const hits: TermHit[] = [];
  for (const p of TERM_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const at = m.index;
    hits.push({
      pattern: p.name,
      match: m[0].trim(),
      context: text.slice(Math.max(0, at - 30), at + m[0].length + 30).replace(/\s+/g, " "),
    });
  }
  return hits;
}

/**
 * A hostile server answer: everything a careless error path could leak. The e2e scan serves it as the body of a
 * forced 500, so a screen that printed any part of it (title, detail, field message) fails the scan.
 */
export const HOSTILE_DIAGNOSTICS = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at handler (/srv/app/apps/api/dist/main.js:1234:56)",
  "    at /srv/app/node_modules/fastify/lib/route.js:12:34",
  'error: relation "transformations" does not exist SQLSTATE 42P01',
  "connect ECONNREFUSED 127.0.0.1:5432 (PostgreSQL mth_app via Kysely; pino logger; outbox advisory lock)",
  "S3 bucket unreachable: ETIMEDOUT; SMTP localhost refused [object Object] ReferenceError",
].join("\n");
