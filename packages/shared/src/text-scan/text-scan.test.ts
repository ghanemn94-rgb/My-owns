// The two text rules (ADR-0049 §7; REQ-PB-001, REQ-S21-001; T-DG5-BE-R2): the TypeScript mirrors against the shared
// corpus. The SQL/TypeScript agreement on the same corpus runs against a real PostgreSQL in
// apps/api/test/integration/text-scan/sql-agreement.test.ts.
import { describe, expect, it } from "vitest";
import { claimsOfficialPmi, PMI_CLAIM_PATTERN, PMI_NEGATION_PATTERN } from "./claims.ts";
import { CLAIM_CORPUS, ENGINEERING_GATE_CORPUS } from "./corpus.ts";
import { ENGINEERING_GATE_PATTERN, mentionsEngineeringGate } from "./engineering-gates.ts";
import * as entry from "../index.ts";
import { postgresCClasses } from "./ascii-classes.ts";

describe("the claim rule (p5_claims_official_pmi mirror)", () => {
  it.each(CLAIM_CORPUS.map((s) => [JSON.stringify(s.text), s] as const))("%s", (_label, sample) => {
    expect(claimsOfficialPmi(sample.text)).toBe(sample.expected);
  });

  it("is stateless: the same text gives the same answer on repeated calls (no lastIndex carry-over)", () => {
    const claim = "certified by PMI";
    expect([claimsOfficialPmi(claim), claimsOfficialPmi(claim), claimsOfficialPmi(claim)]).toEqual([true, true, true]);
    const fine = "Not an official PMI standard.";
    expect([claimsOfficialPmi(fine), claimsOfficialPmi(fine)]).toEqual([false, false]);
  });

  it("uses the 0089 constants verbatim (the SQL literal doubles the apostrophes of isn't/aren't)", () => {
    expect(PMI_CLAIM_PATTERN.startsWith("(official(ly)?\\s+(an?\\s+)?PMI|PMI[\\s-]*(certified|")).toBe(true);
    expect(PMI_NEGATION_PATTERN).toBe(
      "((not|never|no|nor|without|isn't|aren't)\\s+((an?|the)\\s+)?|(ليس|ليست|لا|غير|دون)\\s+(\\S+\\s+)?)",
    );
  });
});

describe("the engineering-gate rule (p5_mentions_engineering_gate mirror)", () => {
  it.each(ENGINEERING_GATE_CORPUS.map((s) => [JSON.stringify(s.text), s] as const))("%s", (_label, sample) => {
    expect(mentionsEngineeringGate(sample.text)).toBe(sample.expected);
  });

  it("uses the 0089 pattern verbatim and is stateless", () => {
    expect(ENGINEERING_GATE_PATTERN).toBe("(^|[^A-Za-z0-9_])DG\\s*-?\\s*[0-7٠-٧]([^0-9٠-٩]|$)");
    expect([mentionsEngineeringGate("DG7"), mentionsEngineeringGate("DG7")]).toEqual([true, true]);
  });
});

describe("the package entry", () => {
  it("exports both rules", () => {
    expect(entry.claimsOfficialPmi).toBe(claimsOfficialPmi);
    expect(entry.mentionsEngineeringGate).toBe(mentionsEngineeringGate);
  });
});

describe("postgresCClasses (the C-ctype classes of the pinned clusters)", () => {
  it("rewrites \\s and \\S outside and inside bracket expressions, and keeps every other escape", () => {
    expect(postgresCClasses(String.raw`a\s+b\S+c`)).toBe(String.raw`a[\t\n\v\f\r ]+b[^\t\n\v\f\r ]+c`);
    expect(postgresCClasses(String.raw`PMI[\s-]*x`)).toBe(String.raw`PMI[\t\n\v\f\r -]*x`);
    expect(postgresCClasses(String.raw`\d\.\(`)).toBe(String.raw`\d\.\(`);
    expect(() => postgresCClasses(String.raw`[\S]`)).toThrow();
  });

  it("makes a no-break space a non-space, as PostgreSQL's C ctype does", () => {
    expect(new RegExp(postgresCClasses(String.raw`^a\sb$`)).test("a\u00a0b")).toBe(false);
    expect(new RegExp(postgresCClasses(String.raw`^a\Sb$`)).test("a\u00a0b")).toBe(true);
    expect(new RegExp(postgresCClasses(String.raw`^a\sb$`)).test("a\tb")).toBe(true);
  });
});
