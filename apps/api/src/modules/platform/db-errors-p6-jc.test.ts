// P6 slices J and C (T-DG6-BE-K; p6-work-split §J/C.3, exact): the 0101/0102 guard mappings, through the dispatcher that
// the error hook calls, with the exact ADR-0053 §2 and ADR-0054 §4 codes and English texts.
import { describe, expect, it } from "vitest";
import { mapDatabaseGuardError, mapP6OperationsChannelsError } from "./db-errors.ts";

const map = (code: string, constraint: string) =>
  mapDatabaseGuardError({ code, constraint, message: "synthetic guard message" })?.toBody("req-1");

type Row = readonly [constraint: string, status: number, code: string, detail: string];

describe("P6 slices J/C database guard mapping (0101, 0102)", () => {
  it.each<Row>([
    [
      "operational_exception_transition",
      409,
      "operations.exception_not_open",
      "Only an open operational exception can be acknowledged.",
    ],
    [
      "operational_exception_resolved_final",
      409,
      "operations.exception_resolved",
      "This operational exception is already resolved.",
    ],
    [
      "service_identity_grant_within_declaration",
      422,
      "service_identity.grant_exceeds_declaration",
      "A service identity can be granted only permissions that its job or connector declares.",
    ],
    [
      "service_identity_permission_category",
      422,
      "service_identity.grant_exceeds_declaration",
      "A service identity can be granted only permissions that its job or connector declares.",
    ],
    [
      "storage_setting_s3_complete",
      422,
      "storage.s3_incomplete",
      "The object store needs an endpoint, a region, a bucket and both credential references.",
    ],
    ...[
      "storage_setting_access_key_ref",
      "storage_setting_secret_key_ref",
      "notification_channel_username_ref",
      "notification_channel_password_ref",
    ].map(
      (c) =>
        [
          c,
          422,
          "storage.secret_ref_invalid",
          "A credential must be a reference to a secret (provider and name), never the secret itself.",
        ] as Row,
    ),
    ...["notification_channel_email_complete", "notification_channel_credentials_pair"].map(
      (c) =>
        [
          c,
          422,
          "notification_channel.email_incomplete",
          "Email needs an SMTP host, a port, a security mode and a sender address.",
        ] as Row,
    ),
    [
      "notification_channel_no_messaging_adapter",
      422,
      "notification_channel.adapter_unavailable",
      "No adapter is installed for this channel. In-app notifications continue to work.",
    ],
    ...["storage_setting_singleton_key", "notification_channel_kind_key"].map(
      (c) =>
        [
          c,
          409,
          "version_conflict",
          "The record was changed by someone else. Review the current version and re-apply your change.",
        ] as Row,
    ),
  ])("%s -> %i %s", (constraint, status, code, detail) => {
    expect(map(constraint.endsWith("_key") ? "23505" : "23514", constraint)).toMatchObject({ status, code, detail });
  });

  it("leaves other constraints to the other mappers", () => {
    expect(mapP6OperationsChannelsError({ code: "23514", constraint: "some_other_check", message: "x" })).toBeNull();
    expect(mapP6OperationsChannelsError({ code: "23514", message: "x" })).toBeNull();
  });
});
