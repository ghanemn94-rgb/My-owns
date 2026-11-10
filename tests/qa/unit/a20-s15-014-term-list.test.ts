// qa-verifier (DG6, T-DG6-QA-F). Binding row REQ-S15-014 clause 2: "non-admin screens show no stack traces or
// infrastructure terms". Pins the scan's term list (e2e/support/s15-014-terms.ts) to ADR-0061 §8: every term the ADR
// names is detected, in the forms a leak takes, and ordinary bilingual screen text (synthetic) is not flagged. If a
// term is dropped from the list or a pattern stops matching, this test fails, so the e2e and API scans cannot
// silently lose coverage.
import { describe, expect, it } from "vitest";
import { HOSTILE_DIAGNOSTICS, TERM_PATTERNS, scanTerms } from "../../../e2e/support/s15-014-terms.ts";

/** ADR-0061 §8, in the ADR's order; each with a sample leak that must be detected. */
const ADR_8: readonly [string, string][] = [
  ["stack frame", "at runQuery (/srv/app/dist/db.js:10:5)"],
  ["node_modules", "Error in node_modules/pg/lib/client.js"],
  ["ECONNREFUSED", "connect ECONNREFUSED"],
  ["ETIMEDOUT", "read ETIMEDOUT"],
  ["SQLSTATE", "SQLSTATE 23505"],
  ["PostgreSQL", "PostgreSQL is not reachable"],
  ["postgres", "user postgres"],
  ["Kysely", "Kysely query failed"],
  ["Fastify", "Fastify error handler"],
  ["pino", "pino logger"],
  ["mth_app", "role mth_app"],
  ["mth_owner", "role mth_owner"],
  ["outbox", "outbox relay stopped"],
  ["advisory lock", "could not take the advisory lock"],
  ["localhost", "http://localhost:3000/api"],
  ["127.0.0.1", "127.0.0.1:5432"],
  ["TypeError", "TypeError: x is undefined"],
  ["ReferenceError", "ReferenceError: y is not defined"],
  ["[object Object]", "Value: [object Object]"],
  ["S3", "S3 upload failed"],
  ["bucket", "bucket mth-evidence"],
  ["SMTP", "SMTP 550"],
];

describe("REQ-S15-014 clause 2: the ADR-0061 §8 term list", () => {
  it("names every ADR-0061 §8 term (nothing dropped)", () => {
    const names = TERM_PATTERNS.map((p) => p.name);
    for (const [term] of ADR_8) expect(names, term).toContain(term);
  });

  it.each(ADR_8)("detects %s in a leaked message", (term, sample) => {
    expect(scanTerms(sample).map((h) => h.pattern)).toContain(term);
  });

  it("detects SQL in error context and file paths (the assignment's additions)", () => {
    expect(scanTerms('error: relation "kpi" does not exist').map((h) => h.pattern)).toContain(
      "PostgreSQL error sentence",
    );
    expect(scanTerms("duplicate key value violates unique constraint").map((h) => h.pattern)).toContain(
      "PostgreSQL error sentence",
    );
    expect(scanTerms("failed: SELECT id, name FROM transformations").map((h) => h.pattern)).toContain("SQL statement");
    expect(scanTerms("see /srv/app/apps/api/dist/main.js").map((h) => h.pattern)).toContain("file path");
    expect(scanTerms("at /srv/app/x.js:1:2").map((h) => h.pattern)).toContain("stack frame (anonymous)");
    expect(scanTerms("C:\\app\\dist\\main.js").map((h) => h.pattern)).toContain("file path (windows)");
  });

  it("flags every line of the hostile diagnostics body the e2e scan serves", () => {
    for (const line of HOSTILE_DIAGNOSTICS.split("\n")) expect(scanTerms(line), line).not.toEqual([]);
  });

  it("does not flag ordinary SYNTHETIC screen text in English and Arabic", () => {
    const clean = [
      "Something went wrong. Try again. Reference 0193a1b2-0000-7000-8000-000000000001",
      "Weighted score = the sum of each criterion's score (1 to 5) multiplied by its weight, divided by 100.",
      "Select a transformation from the list. Update the KPI actual for Q1 2026.",
      "Benefit realized value: SAR 1,250,000.00 (validated). Period 2026-01-01 to 2026-03-31.",
      "Imports: upload a CSV or XLSX file. Outbound writes: none yet.",
      "تعذر تحميل البيانات. حاول مرة أخرى. المرجع 0193a1b2-0000-7000-8000-000000000001",
      "الدرجة المرجحة = مجموع درجة كل معيار مضروبة في وزنها مقسومة على 100.",
      "Status: Unknown (no accepted actual). KPI-001 12.5%",
    ];
    for (const text of clean) expect(scanTerms(text), text).toEqual([]);
  });
});
