// Unit tests of the P5 slice A database-error mapping (T-DG5-BE-A; p5-work-split §A.1, §A.10 item 2). Pure: no
// database. The errors are shaped as node-postgres reports the guards of migrations 0062-0064; codes and English texts
// are exactly ADR-0039 §13 and ADR-0040 §8 (p5-work-split §2 rule 15).
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "./db-errors.ts";

const map = (constraint: string, code = "23514") => mapDatabaseGuardError({ code, constraint })!;
const triple = (p: ReturnType<typeof map>) => [p.status, p.code, p.detail];

describe("P5 slice A database guard mapping", () => {
  it("the Studio version and element guards map to the ADR-0039 §13 refusals with their exact texts", () => {
    expect(triple(map("methodology_version_one_open_draft_key", "23505"))).toEqual([
      409,
      "config_version.draft_exists",
      "A draft of this configuration already exists. Continue it or discard it first.",
    ]);
    for (const c of [
      "methodology_version_content_frozen",
      "methodology_element_draft_only",
      "methodology_version_stage_transition",
      "methodology_version_status_transition",
    ])
      expect(triple(map(c))).toEqual([
        409,
        "config_version.not_editable",
        "This configuration version is published or no longer being edited. Create a new draft to change it.",
      ]);
    for (const c of ["methodology_version_identity_fixed", "methodology_element_identity_fixed"])
      expect(triple(map(c))).toEqual([
        422,
        "config_version.stable_id_change",
        "Stable identifiers cannot be changed. Change the label instead.",
      ]);
    expect(triple(map("methodology_element_fixed_sets"))).toEqual([
      422,
      "config_version.source_element_protected",
      "Source phases, gates and TOM dimensions cannot be added or deleted.",
    ]);
    expect(triple(map("methodology_element_source_identity", "23503"))).toEqual([
      422,
      "config_version.unknown_element",
      "This element does not exist in the methodology.",
    ]);
    expect(triple(map("methodology_element_no_admin_approver"))).toEqual([
      422,
      "config_version.admin_approver_forbidden",
      "An administrator role or the auditor cannot be configured as an approver.",
    ]);
    expect(triple(map("methodology_version_preview_required"))).toEqual([
      422,
      "config_version.preview_required",
      "Run a successful preview and test of the current draft first.",
    ]);
    expect(triple(map("methodology_version_review_required"))).toEqual([
      422,
      "config_version.review_required",
      "This change needs an approved review before it can be published.",
    ]);
    expect(triple(map("methodology_version_checks_required"))).toEqual([
      422,
      "config_version.checks_required",
      "Run the compatibility and source-coverage checks for the current draft first.",
    ]);
    expect(triple(map("methodology_version_weights_total"))).toEqual([
      422,
      "config_version.weights_total",
      "Default weights must total exactly 100% over 2 to 6 criteria.",
    ]);
    const weight = map("methodology_element_weight_decimal");
    expect([weight.status, weight.errors?.[0]?.code]).toEqual([400, "validation.weight_percent"]);
    expect(triple(map("methodology_version_rollback_complete"))).toEqual([
      422,
      "config_version.rollback_target_invalid",
      "Only an earlier published version of the same configuration can be restored.",
    ]);
  });

  it("the review and migration guards map to their refusals; separation of duties is a 403", () => {
    for (const c of ["config_review_request_reviewer_not_requester", "config_review_request_reviewer_not_author"])
      expect(triple(map(c))).toEqual([
        403,
        "config_review.self_review",
        "You cannot review a configuration change you authored or requested.",
      ]);
    for (const c of ["config_review_policy_reviewer_not_auditor", "config_review_policy_reviewer_not_admin"])
      expect(map(c).code).toBe("config_review.reviewer_not_allowed");
    expect(triple(map("methodology_migration_one_open_key", "23505"))).toEqual([
      409,
      "methodology_migration.open_exists",
      "This transformation already has an open migration for this configuration.",
    ]);
    expect(triple(map("methodology_migration_decider_not_requester"))).toEqual([
      403,
      "methodology_migration.self_approval",
      "You cannot approve a migration you requested.",
    ]);
    expect(triple(map("transformation_config_pin_moves_by_migration"))).toEqual([
      409,
      "methodology_migration.pin_moved",
      "The transformation's pinned version changed after this migration was planned. Plan it again.",
    ]);
    expect(map("methodology_migration_target_published").code).toBe("methodology_migration.target_invalid");
    expect(map("methodology_migration_status_transition").code).toBe("methodology_migration.not_open");
  });

  it("guards only a programming error reaches map to 500; the version step of the new tables stays a 409", () => {
    for (const c of [
      "methodology_version_next_number",
      "methodology_version_seed_only",
      "methodology_version_created_as_draft",
      "methodology_version_publish_ready",
      "transformation_config_pin_kind_matches",
      "transformation_config_pin_history_required",
      "revision_proposal_dedupe_shape",
    ])
      expect(map(c).status, c).toBe(500);
    for (const t of ["methodology_version", "methodology_element", "config_review_request", "config_review_policy"])
      expect(map(`${t}_version_step`).status).toBe(409);
  });
});
