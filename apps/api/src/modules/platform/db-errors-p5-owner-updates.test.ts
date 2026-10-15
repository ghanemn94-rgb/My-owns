// Unit tests of the P5 slice F owner-update database-error mapping (T-DG5-KBE-D; ADR-0045 §6, §11; p5-work-split
// §F.3). Pure: no database. The errors are shaped as node-postgres reports the 0080 guards; codes and English texts are
// exactly ADR-0045 §11 (p5-work-split §2 rule 15) and equal the shared OWNER_UPDATE_REFUSALS table.
import { OWNER_UPDATE_REFUSALS } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "./db-errors.ts";

const map = (constraint: string, code = "23514") => mapDatabaseGuardError({ code, constraint })!;
const triple = (p: ReturnType<typeof map>) => [p.status, p.code, p.detail];

describe("P5 slice F owner-update guard mapping", () => {
  it("a concurrent create of the same subject and period maps to 409 owner_update.exists", () => {
    expect(triple(map("owner_update_subject_period_key", "23505"))).toEqual([
      409,
      "owner_update.exists",
      "An update for this subject and reporting period already exists.",
    ]);
  });

  it("a period closed under the write, a frozen submission and an empty submission map to their 422 refusals", () => {
    expect(triple(map("owner_update_period_open"))).toEqual([
      422,
      "owner_update.period_not_open",
      "Updates can be written only while their reporting period is open.",
    ]);
    expect(triple(map("owner_update_submitted_frozen"))).toEqual([
      422,
      "owner_update.not_draft",
      "Only a draft update can be changed or submitted.",
    ]);
    expect(triple(map("owner_update_submitted_has_content"))).toEqual([
      422,
      "owner_update.empty",
      "Write at least one of the eight fields before submitting.",
    ]);
  });

  it("the mapped texts equal the shared refusal table (one source for the API and the web)", () => {
    for (const [constraint, code] of [
      ["owner_update_subject_period_key", "owner_update.exists"],
      ["owner_update_period_open", "owner_update.period_not_open"],
      ["owner_update_submitted_frozen", "owner_update.not_draft"],
      ["owner_update_submitted_has_content", "owner_update.empty"],
    ] as const)
      expect(map(constraint).detail).toBe(new Map<string, string>(Object.entries(OWNER_UPDATE_REFUSALS)).get(code));
  });

  it("the guards the API always refuses first stay unmapped by this table (a programming error if reached)", () => {
    for (const c of [
      "owner_update_created_draft",
      "owner_update_identity_immutable",
      "owner_update_revision_step",
      "owner_update_reopen_reason",
      "owner_update_revision_present",
      "owner_update_subject_ref",
    ]) {
      const p = mapDatabaseGuardError({ code: "23514", constraint: c });
      expect(p?.code ?? null, c).not.toMatch(/^owner_update\./);
    }
  });
});
