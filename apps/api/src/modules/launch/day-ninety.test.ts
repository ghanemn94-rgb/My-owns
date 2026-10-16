// Unit tests of the Day-90 leadership test (T-DG5-BE-P2; ADR-0048 §4, §9; p5-work-split §H.2). Pure: no database.
//  - the 0086 day_ninety_* guards map to the ADR-0048 §9 refusals with their exact English texts (the database's last
//    line behind the API's own checks), and the unreachable ones to 500;
//  - the request body mirror of DayNinetyResponsePut: yes/no only, a comment through the shared free-text rule, a
//    nullable evidence id, nothing else.
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "../platform/index.ts";
import { dayNinetyResponsePut, TEST_COMPLETED, TEST_INCOMPLETE } from "./day-ninety.ts";

const map = (constraint: string, code = "23514") => mapDatabaseGuardError({ code, constraint })!;
const triple = (p: { status: number; code: string; detail?: string | undefined }) => [p.status, p.code, p.detail];

describe("Day-90 test database guard mapping (ADR-0048 §9)", () => {
  it("maps the reachable guards to the exact refusals", () => {
    const incomplete = [
      422,
      "day_ninety_test.incomplete",
      "Answer all six questions before completing the Day-90 leadership test.",
    ];
    const completed = [
      422,
      "day_ninety_test.completed",
      "The Day-90 leadership test is complete; its responses can no longer change.",
    ];
    expect(triple(map("day_ninety_test_completed_complete"))).toEqual(incomplete);
    expect(triple(TEST_INCOMPLETE())).toEqual(incomplete);
    for (const c of ["day_ninety_test_completed_final", "day_ninety_response_test_open"])
      expect(triple(map(c))).toEqual(completed);
    expect(triple(TEST_COMPLETED())).toEqual(completed);
    expect(triple(map("day_ninety_response_evidence_fkey", "23503"))).toEqual([
      422,
      "validation.reference",
      "No such evidence in this transformation.",
    ]);
  });

  it("maps the guards a request never reaches to 500", () => {
    for (const c of [
      "day_ninety_response_key",
      "day_ninety_test_created_open",
      "day_ninety_response_identity_fixed",
      "day_ninety_test_answered_count",
    ])
      expect(map(c).status).toBe(500);
  });
});

describe("DayNinetyResponsePut mirror", () => {
  it("accepts yes/no with an optional comment and evidence id", () => {
    expect(dayNinetyResponsePut.safeParse({ answer: "yes" }).success).toBe(true);
    expect(dayNinetyResponsePut.safeParse({ answer: "no", comment: "Synthetic", evidenceId: null }).success).toBe(true);
    expect(dayNinetyResponsePut.safeParse({ answer: "maybe" }).success).toBe(false);
    expect(dayNinetyResponsePut.safeParse({ answer: "yes", comment: "" }).success).toBe(false);
    expect(dayNinetyResponsePut.safeParse({ answer: "yes", comment: "   " }).success).toBe(false);
    expect(dayNinetyResponsePut.safeParse({ answer: "yes", comment: "x".repeat(2001) }).success).toBe(false);
    expect(dayNinetyResponsePut.safeParse({ answer: "yes", score: 1 }).success).toBe(false);
  });
});
