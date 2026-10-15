// Unit tests of the P5 slice G KPI-restatement database-error mapping (T-DG5-KBE-E; ADR-0047 §8; p5-work-split §G.1).
// Pure: no database. The errors are shaped as node-postgres reports the 0085 guards; codes and English texts are
// exactly ADR-0047 §8 (p5-work-split §2 rule 15).
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "./db-errors.ts";

const map = (constraint: string, code = "23514") => mapDatabaseGuardError({ code, constraint })!;
const triple = (p: ReturnType<typeof map>) => [p.status, p.code, p.detail];

describe("P5 slice G kpi_restatement guard mapping", () => {
  it("a second restatement in progress (unique index) maps to 409 kpi_restatement.open_exists", () => {
    expect(triple(map("kpi_restatement_one_open_key", "23505"))).toEqual([
      409,
      "kpi_restatement.open_exists",
      "This KPI already has a restatement in progress.",
    ]);
  });

  it("the version and period guards map to their 422 refusals", () => {
    expect(triple(map("kpi_restatement_version_approved"))).toEqual([
      422,
      "kpi_restatement.version_not_approved",
      "A restatement applies an approved KPI version (active or superseded) of this KPI.",
    ]);
    expect(triple(map("kpi_restatement_period_closed"))).toEqual([
      422,
      "kpi_restatement.period_not_closed",
      "Only closed reporting periods of the KPI's frequency can be restated; an open period takes the new version from now on.",
    ]);
  });

  it("a write after the draft state maps to 422 kpi_restatement.not_draft; the COMMIT check to nothing_to_reconcile", () => {
    for (const c of [
      "kpi_restatement_period_draft_only",
      "kpi_restatement_status_step",
      "kpi_restatement_reconciliation_at_submit",
    ])
      expect(triple(map(c))).toEqual([
        422,
        "kpi_restatement.not_draft",
        "Only a draft restatement can be changed or submitted.",
      ]);
    expect(triple(map("kpi_restatement_reconciled", "23000"))).toEqual([
      422,
      "kpi_restatement.nothing_to_reconcile",
      "None of the selected periods has a value to restate.",
    ]);
  });

  it("the decision guards map to the decision refusals (403 self decision; 422 note, not submitted)", () => {
    expect(triple(map("kpi_restatement_sod"))).toEqual([
      403,
      "kpi_restatement.self_decision",
      "The requester of a restatement cannot decide it.",
    ]);
    expect(triple(map("kpi_restatement_reject_note"))).toEqual([
      422,
      "kpi_restatement.note_required",
      "A rejection needs a note.",
    ]);
    expect(triple(map("kpi_restatement_decision_frozen"))).toEqual([
      422,
      "kpi_restatement.not_submitted",
      "Only a submitted restatement can be decided.",
    ]);
  });

  it("the identity, counts and applied-run guards are not user refusals (not mapped here)", () => {
    for (const c of ["kpi_restatement_identity_fixed", "kpi_restatement_counts", "kpi_restatement_applied_run"]) {
      const p = mapDatabaseGuardError({ code: "23514", constraint: c });
      expect(p === null || !p.code.startsWith("kpi_restatement.")).toBe(true);
    }
  });
});
