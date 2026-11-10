// Unit tests of the pure parts of the search query (ADR-0057 §3, §10; T-DG6-BE-P2): the query length rule and its
// exact refusal text, the cursor binding, and the closed type set. The database behaviour (A12, parity, stale, 503)
// is in test/integration/search/.
import { describe, expect, it } from "vitest";
import { HttpProblem } from "../platform/index.ts";
import { normalizedQuery, SEARCH_RECORD_TYPES, searchFilterHash, searchRefusals } from "./query.ts";

const refusal = (q: string): unknown => {
  try {
    normalizedQuery(q);
    return null;
  } catch (err) {
    return err instanceof HttpProblem ? err.toBody("r").code : err;
  }
};

describe("normalizedQuery (ADR-0057 §3: 2-200 characters after trimming)", () => {
  it("trims and accepts 2 characters or more (code points: one emoji is one character)", () => {
    expect(normalizedQuery("  ab  ")).toBe("ab");
    expect(normalizedQuery("تح")).toBe("تح");
    expect(normalizedQuery("😀😀")).toBe("😀😀");
  });

  it("refuses 1 character after trimming, or no visible content, with search.query_too_short", () => {
    for (const q of ["a", " a ", "‏ a ‏", "😀", "  ", "‏‏"])
      expect(refusal(q), JSON.stringify(q)).toBe("search.query_too_short");
  });

  it("the refusals carry the ADR-0057 §10 English texts verbatim", () => {
    const short = searchRefusals.queryTooShort().toBody("r");
    expect([short.status, short.code, short.detail]).toEqual([
      400,
      "search.query_too_short",
      "Enter at least 2 characters to search.",
    ]);
    const down = searchRefusals.indexUnavailable().toBody("r");
    expect([down.status, down.code, down.detail]).toEqual([
      503,
      "search.index_unavailable",
      "Search is not available right now. Try again later.",
    ]);
  });
});

describe("searchFilterHash (the cursor binding, ADR-0007)", () => {
  const base = {
    q: "tower",
    recordTypes: ["lesson", "benefit"] as const,
    transformationId: null,
    includeArchived: false,
  };
  it("is bound to q and every filter, and ignores the order of the record types", () => {
    const h = searchFilterHash({ ...base, recordTypes: [...base.recordTypes] });
    expect(searchFilterHash({ ...base, recordTypes: ["benefit", "lesson"] })).toBe(h);
    expect(searchFilterHash({ ...base, recordTypes: [...base.recordTypes], q: "towers" })).not.toBe(h);
    expect(searchFilterHash({ ...base, recordTypes: ["lesson"] })).not.toBe(h);
    expect(searchFilterHash({ ...base, recordTypes: [...base.recordTypes], includeArchived: true })).not.toBe(h);
    expect(
      searchFilterHash({
        ...base,
        recordTypes: [...base.recordTypes],
        transformationId: "01995000-0000-7000-8000-000000000001",
      }),
    ).not.toBe(h);
  });
});

describe("the indexed record types", () => {
  it("are exactly the 12 of 0108 p6_search_record_type_valid, in the ADR-0057 §1 order", () => {
    expect([...SEARCH_RECORD_TYPES]).toEqual([
      "transformation",
      "initiative",
      "kpi_definition",
      "benefit",
      "raid_entry",
      "dependency",
      "decision",
      "deliverable",
      "evidence",
      "business_case",
      "lesson",
      "change_request",
    ]);
  });
});
