// Unit tests of the P5 slice F report-snapshot database-error mapping (T-DG5-KBE-C; ADR-0045 §11; p5-work-split §F.1).
// Pure: no database. The errors are shaped as node-postgres reports the 0080 guards; codes and English texts are
// exactly ADR-0045 §11 (p5-work-split §2 rule 15).
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "./db-errors.ts";

const map = (constraint: string, code = "23514") => mapDatabaseGuardError({ code, constraint })!;
const triple = (p: ReturnType<typeof map>) => [p.status, p.code, p.detail];

describe("P5 slice F report-snapshot guard mapping", () => {
  it("a concurrent issue in the series maps to 409 report_snapshot.series_changed", () => {
    for (const [c, code] of [
      ["report_snapshot_one_issued_key", "23505"],
      ["report_snapshot_series_issue_key", "23505"],
      ["report_snapshot_issue_next", "23514"],
      ["report_snapshot_superseded_by_issued", "23000"],
    ] as const)
      expect(triple(map(c, code))).toEqual([
        409,
        "report_snapshot.series_changed",
        "This report was issued or reissued meanwhile; reload it.",
      ]);
  });

  it("the transition, reissue and subject guards map to their 422 refusals", () => {
    expect(triple(map("report_snapshot_transition"))).toEqual([
      422,
      "report_snapshot.not_generated",
      "Only a generated snapshot can be issued or discarded.",
    ]);
    expect(triple(map("report_snapshot_reissue_of_issued"))).toEqual([
      422,
      "report_snapshot.not_issued",
      "Only the current issued snapshot can be reissued.",
    ]);
    expect(triple(map("report_snapshot_subject_ref", "23503"))).toEqual([
      422,
      "report.subject_invalid",
      "The subject must be a record of this transformation of the type this output reports on.",
    ]);
  });

  it("the other 0080 report guards are not mapped to a slice F refusal (reaching them is a programming error)", () => {
    for (const c of [
      "report_snapshot_content_immutable",
      "report_snapshot_stamps_frozen",
      "report_snapshot_created_generated",
    ]) {
      const p = mapDatabaseGuardError({ code: "23514", constraint: c });
      expect(p?.code ?? null).not.toMatch(/^report(_snapshot)?\./);
    }
  });
});
