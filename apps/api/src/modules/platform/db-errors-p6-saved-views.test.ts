// P6 slice H (T-DG6-BE-Q; p6-work-split §H/G.3, exact): the 0108 saved_view guard mappings, through the dispatcher
// that the error hook calls, with the exact ADR-0057 §10 codes and English texts.
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError, mapP6SavedViewError } from "./db-errors.ts";

const map = (code: string, constraint: string) =>
  mapDatabaseGuardError({ code, constraint, message: "synthetic guard message" })?.toBody("req-1");

type Row = readonly [sqlstate: string, constraint: string, status: number, code: string, detail: string | undefined];

describe("P6 slice H saved-view database guard mapping (0108)", () => {
  it.each<Row>([
    [
      "23505",
      "saved_view_name_key",
      409,
      "saved_view.name_taken",
      "You already have a view with this name for this list.",
    ],
    ["23514", "saved_view_final", 409, "saved_view.deleted", "This view was deleted."],
    [
      "23514",
      "saved_view_owner_only",
      403,
      "saved_view.not_owner",
      "Only the person who created this view can change it.",
    ],
    [
      "23505",
      "saved_view_one_default_key",
      409,
      "saved_view.default_conflict",
      "Another view was made the default for this list at the same time. Reload the list and try again.",
    ],
    ["23514", "saved_view_organization_matches", 404, "not_found", undefined],
    ["23514", "saved_view_cross_transformation_lists", 404, "not_found", undefined],
  ])("%s %s -> %i %s", (sqlstate, constraint, status, code, detail) => {
    const body = map(sqlstate, constraint);
    expect(body?.status).toBe(status);
    expect(body?.code).toBe(code);
    expect(body?.detail).toBe(detail);
  });

  it.each([
    ["saved_view_columns_valid", "/columns"],
    ["saved_view_filters_valid", "/filters"],
    ["saved_view_sort_valid", "/sort"],
  ])("%s -> 400 validation at %s", (constraint, pointer) => {
    const body = map("23514", constraint);
    expect(body?.status).toBe(400);
    expect(body?.code).toBe("validation");
    expect(body?.errors?.[0]?.pointer).toBe(pointer);
  });

  it("maps nothing else", () => {
    expect(mapP6SavedViewError({ code: "23514", constraint: "saved_view_something_else", message: "x" })).toBeNull();
    expect(mapP6SavedViewError({ code: "23505", message: "x" })).toBeNull();
  });
});
