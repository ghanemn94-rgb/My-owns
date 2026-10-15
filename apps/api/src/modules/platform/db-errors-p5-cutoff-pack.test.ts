// Unit tests of the P5 slice E cut-off pack database-error mapping (T-DG5-BE-C2; D-155 (c), BE-L2's proposal;
// ADR-0044 §6, §10). Pure: no database. The errors are shaped as node-postgres reports the 0075 guards
// (ERRCODE check_violation, CONSTRAINT = the guard's name). Each mapping must equal the API's own refusal
// (governance/cut-off.ts `cutoffRefusals`, BE-L2) in status, type, code, title and English detail, so a request that
// reaches the database guard in a race gets exactly the answer the API check gives (p5-work-split §2 rule 15). The
// expected values are written out literally: platform may not import governance (ADR-0002, architecture.test.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROBLEM_TYPES } from "@mth/shared";
import { mapDatabaseGuardError, mapP5CutoffPackError } from "./db-errors.ts";
import type { HttpProblem } from "./problem.ts";

const map = (constraint: string, code = "23514") => mapDatabaseGuardError({ code, constraint });
const shape = (p: HttpProblem | null) =>
  p === null ? null : { status: p.status, type: p.type, code: p.code, title: p.title, detail: p.detail };

describe("P5 slice E cut-off pack guard mapping (D-155 (c))", () => {
  it("agenda_item_cutoff_pack_unreviewed maps to 422 agenda_item.pack_not_reviewed, as the API refuses", () => {
    expect(shape(map("agenda_item_cutoff_pack_unreviewed"))).toEqual({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "agenda_item.pack_not_reviewed",
      title: "Business rule violated",
      detail: "Review the meeting's cut-off pack before publishing its items.",
    });
  });

  it("meeting_cutoff_pack_reviewer maps to 403 meeting_cutoff_pack.not_reviewer, as the API refuses", () => {
    expect(shape(map("meeting_cutoff_pack_reviewer"))).toEqual({
      status: 403,
      type: PROBLEM_TYPES.forbidden,
      code: "meeting_cutoff_pack.not_reviewer",
      title: "Forbidden",
      detail: "Only the meeting's chair or secretary can review its pack.",
    });
  });

  it("meeting_cutoff_pack_transition maps to 422 meeting_cutoff_pack.already_reviewed, as the API refuses", () => {
    expect(shape(map("meeting_cutoff_pack_transition"))).toEqual({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "meeting_cutoff_pack.already_reviewed",
      title: "Business rule violated",
      detail: "This pack is already reviewed.",
    });
  });

  it("the three names are the constraints the 0075 guards raise, and nothing else of 0075 is mapped here", () => {
    const sql = readFileSync(
      new URL("../../../../../packages/db/migrations/0075_p5_starters_routes_policies.sql", import.meta.url),
      "utf8",
    );
    for (const c of [
      "agenda_item_cutoff_pack_unreviewed",
      "meeting_cutoff_pack_reviewer",
      "meeting_cutoff_pack_transition",
    ])
      expect(sql).toContain(`CONSTRAINT = '${c}'`);
    for (const c of [
      "meeting_cutoff_pack_content_fixed",
      "meeting_cutoff_pack_once_key",
      "meeting_cutoff_pack_reviewed_complete",
    ])
      expect(mapP5CutoffPackError({ code: "23514", constraint: c })).toBeNull();
  });
});
