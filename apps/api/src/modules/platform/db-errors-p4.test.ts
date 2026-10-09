// Unit tests of the P4 slice I and C database-error mapping (T-DG4-BE-A; p4-work-split §I+C.1). Pure: no database. The
// errors are shaped as node-postgres reports the guards of migrations 0028-0031 (code, constraint, message, detail);
// codes and English texts are the slice ADRs' (ADR-0025 §1, §3, §4; ADR-0026 §2-§7; S-11).
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError } from "./db-errors.ts";

const map = (constraint: string, extra: { code?: string; message?: string; detail?: string } = {}) =>
  mapDatabaseGuardError({ code: "23514", constraint, ...extra })!;
const triple = (p: ReturnType<typeof map>) => [p.status, p.code, p.detail];

describe("P4 slice I and C database guard mapping", () => {
  it("*_version_step of every P4 slice I table -> 409; *_audit_required -> 500", () => {
    for (const t of [
      "business_calendar",
      "business_calendar_holiday",
      "job_schedule",
      "work_item",
      "inbox_notification",
    ]) {
      expect(map(`${t}_version_step`).status).toBe(409);
      expect(map(`${t}_audit_required`, { code: "P0001" }).status).toBe(500);
    }
  });

  it("calendar rules (ADR-0025 §1)", () => {
    expect(triple(map("business_calendar_workweek_valid"))).toEqual([
      422,
      "calendar.workweek_invalid",
      "The workweek must list one to seven different weekdays (1 = Monday … 7 = Sunday).",
    ]);
    expect(
      triple(map("business_calendar_timezone_known", { message: "business_calendar: unknown time zone Mars/Olympus" })),
    ).toEqual([422, "calendar.timezone_unknown", "The time zone Mars/Olympus is not a known time zone."]);
    const dup = map("business_calendar_org_code_key", {
      code: "23505",
      detail: "Key (organization_id, code)=(01920000-0000-7000-8000-0000000000a1, RIYADH) already exists.",
    });
    expect([dup.status, dup.type, dup.code, dup.detail]).toEqual([
      409,
      "urn:mth:problem:duplicate",
      "calendar.code_taken",
      "A calendar with the code RIYADH already exists in this organization.",
    ]);
    expect(triple(map("business_calendar_holiday_range"))).toEqual([
      422,
      "calendar.holiday_range_invalid",
      "A holiday ends on or after its start date and spans at most 31 days.",
    ]);
  });

  it("job, work item and inbox rules (ADR-0025 §3, §4)", () => {
    expect(triple(map("job_schedule_timezone_known", { message: "job_schedule: unknown time zone X/Y" }))).toEqual([
      422,
      "job.timezone_unknown",
      "The time zone X/Y is not a known time zone.",
    ]);
    expect(triple(map("work_item_closed"))).toEqual([422, "work_item.closed", "This task is already closed."]);
    expect(triple(map("inbox_notification_read_once"))).toEqual([
      422,
      "inbox.already_read",
      "This reminder is already marked as read.",
    ]);
    expect(map("work_item_identity").status).toBe(500);
    expect(map("inbox_notification_identity").status).toBe(500);
  });

  it("slice C rules (ADR-0026 §2-§7)", () => {
    expect(map("delegation_no_loop").code).toBe("delegation.loop");
    expect([map("role_mapping_active_key", { code: "23505" }).status, map("role_mapping_active_key").code]).toEqual([
      409,
      "role_mapping.already_mapped",
    ]);
    expect(triple(map("transformation_raci_assignment_value"))).toEqual([
      422,
      "raci.invalid_value",
      "A RACI cell accepts A, R, C, I or A/R.",
    ]);
    expect(map("transformation_raci_one_accountable").code).toBe("raci.accountable_count");
    for (const t of ["transformation_decision_right", "transformation_raci_assignment"])
      expect(triple(map(`${t}_matrix_in_approval`))).toEqual([
        422,
        "governance_matrix.in_approval",
        "This matrix is waiting for approval. It can change again once the approval is decided or withdrawn.",
      ]);
    expect(triple(map("approval_one_open_per_subject", { code: "23505" }))).toEqual([
      409,
      "approval.already_open",
      "An approval for this record is already open.",
    ]);
    expect(
      triple(map("approval_decision_stale", { message: "approval_decision: the subject moved from version 3 to 4" })),
    ).toEqual([
      409,
      "approval.stale_version",
      "The record changed after this approval was requested: version 3 was submitted and the record is now at version 4. Review the changes before deciding.",
    ]);
    expect(
      map("approval_subject_version_current", {
        message: "approval: requested version 3 but the subject is at version 4",
      }).detail,
    ).toContain("version 3 was submitted and the record is now at version 4");
    expect(triple(map("approval_decision_sod"))).toEqual([
      403,
      "approval.sod_requester",
      "You requested this change, so you cannot decide it. The separation-of-duties policy requires a different approver.",
    ]);
    expect(triple(map("approval_decision_rationale_required"))).toEqual([
      422,
      "approval.rationale_required",
      "Enter a rationale for this decision.",
    ]);
    expect(triple(map("approval_decision_defer_date"))).toEqual([
      422,
      "approval.defer_date_required",
      "A deferral needs a new date after today.",
    ]);
    expect(
      triple(
        map("approval_decision_open", { message: "approval_decision: approval x is approved and cannot be decided" }),
      ),
    ).toEqual([422, "approval.not_open", "This approval is approved and can no longer be decided."]);
    expect(
      map("approval_final_immutable", { message: "approval: a rejected approval is final and immutable" }).detail,
    ).toBe("This approval is rejected and can no longer be decided.");
  });

  it("unrelated constraints are untouched by the P4 mapping", () => {
    expect(map("gate_decision_not_submitter").code).toBe("gate.submitter_cannot_decide");
    expect(mapDatabaseGuardError({ code: "23505", constraint: "something_else_key" })).toBeNull();
  });
});
