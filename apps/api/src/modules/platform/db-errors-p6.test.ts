// P6 slices E and F (T-DG6-BE-A; p6-work-split §E/F.1, exact): the 0098/0099 guard mappings, through the dispatcher
// that the error hook calls, each with the SQLSTATE its constraint or trigger raises, and with the exact ADR-0051 §2
// codes and English texts. The four constraints the API never violates answer 500, never the generic 422/409.
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError, mapP6AccessHardeningError } from "./db-errors.ts";

const map = (code: string, constraint: string) =>
  mapDatabaseGuardError({ code, constraint, message: "synthetic guard message" })?.toBody("req-1");

describe("P6 slices E/F database guard mapping (0098, 0099)", () => {
  it("sensitive_record_grant_one_active_key (23505) -> 409 sensitive_grant.duplicate", () => {
    expect(map("23505", "sensitive_record_grant_one_active_key")).toMatchObject({
      status: 409,
      code: "sensitive_grant.duplicate",
      detail: "This person already has an active grant for this record.",
    });
  });

  it("sensitive_record_grant_not_self (23514) -> 422 sensitive_grant.not_self", () => {
    expect(map("23514", "sensitive_record_grant_not_self")).toMatchObject({
      status: 422,
      code: "sensitive_grant.not_self",
      detail: "You cannot grant access to yourself.",
    });
  });

  it("sensitive_record_grant_transition (23514) -> 422 invalid_transition", () => {
    expect(map("23514", "sensitive_record_grant_transition")).toMatchObject({
      status: 422,
      code: "invalid_transition",
      detail: "Only an active grant can be revoked.",
    });
  });

  it.each(["record_sensitivity_record_ref", "sensitive_record_grant_record_ref"])(
    "%s (23503) -> 404 not_found, never the generic 422 validation.reference",
    (constraint) => {
      const body = map("23503", constraint);
      expect([body?.status, body?.code]).toEqual([404, "not_found"]);
      expect(body?.detail).toBeUndefined();
    },
  );

  it.each(["record_sensitivity_record_key", "upload_policy_organization_key"])(
    '%s (23505) -> 409 version_conflict (a concurrent If-Match "0" create)',
    (constraint) => {
      expect(map("23505", constraint)).toMatchObject({
        status: 409,
        code: "version_conflict",
        detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      });
    },
  );

  it.each([
    ["upload_policy_allowed_types", "/allowedTypes"],
    ["upload_policy_max_bytes", "/maxBytes"],
  ])("%s (23514) -> 400 validation at %s", (constraint, pointer) => {
    const body = map("23514", constraint);
    expect([body?.status, body?.code]).toEqual([400, "validation"]);
    expect(body?.errors?.map((e) => e.pointer)).toEqual([pointer]);
  });

  it.each([
    ["23514", "inbox_notification_deep_link_once"],
    ["23505", "inbox_notification_link_token_key"],
    ["23514", "evidence_content_detected_type"],
    ["23514", "evidence_content_detected_media_type"],
  ])("%s %s -> 500 internal (no business code; the API never violates it)", (code, constraint) => {
    const body = map(code, constraint);
    expect([body?.status, body?.code]).toEqual([500, "internal"]);
  });

  it("leaves other constraints to the other mappers", () => {
    expect(mapP6AccessHardeningError({ code: "23514", constraint: "some_other_check", message: "x" })).toBeNull();
    expect(mapP6AccessHardeningError({ code: "23514", message: "x" })).toBeNull();
  });
});
