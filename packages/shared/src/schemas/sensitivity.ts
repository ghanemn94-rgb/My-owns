// zod mirrors of the P6 slice E record-sensitivity and sensitive-record-grant components (docs/api/openapi.yaml
// 1.5.0-p6; ADR-0051 §2; REQ-S10-002; T-DG6-BE-B). Free-text fields use the shared `reason` rule (trimmed, 3-1000
// characters, never blank, no invalid character). A grant is an access decision, never a business approval.
import { z } from "zod";
import { page, reason, timestamp, uuid, version } from "./common.ts";

/** The record types that can be marked sensitive (D-195 Q3; the closed CHECK set of 0098). */
export const SENSITIVE_RECORD_TYPES = ["benefit", "business_case", "evidence"] as const;
export const sensitiveRecordType = z.enum(SENSITIVE_RECORD_TYPES);

export const SENSITIVE_GRANT_STATUSES = ["active", "revoked"] as const;
export const sensitiveGrantStatus = z.enum(SENSITIVE_GRANT_STATUSES);

/** RecordSensitivity: the flag of one record; version 0 (and isSensitive false) when it was never marked. */
export const recordSensitivity = z.strictObject({
  transformationId: uuid,
  recordType: sensitiveRecordType,
  recordId: uuid,
  isSensitive: z.boolean(),
  reason: z.string().max(1000).nullable(),
  version: z.number().int().min(0),
  updatedAt: timestamp.nullable(),
  updatedBy: uuid.nullable(),
  canManage: z.boolean(),
});
export type RecordSensitivity = z.infer<typeof recordSensitivity>;

/** RecordSensitivityUpdate (PUT body; If-Match "0" creates the flag row). */
export const recordSensitivityUpdate = z.strictObject({ isSensitive: z.boolean(), reason });
export type RecordSensitivityUpdate = z.infer<typeof recordSensitivityUpdate>;

/** SensitiveGrant: one explicit grant; the record title only when the caller can read the record. */
export const sensitiveGrant = z.strictObject({
  id: uuid,
  transformationId: uuid,
  recordType: sensitiveRecordType,
  recordId: uuid,
  recordTitle: z.string().nullable(),
  recordTitleRedacted: z.boolean(),
  granteeUserId: uuid,
  granteeDisplayName: z.string().nullable(),
  reason: z.string().min(3).max(1000),
  status: sensitiveGrantStatus,
  grantedBy: uuid,
  grantedAt: timestamp,
  revokedAt: timestamp.nullable(),
  revokedBy: uuid.nullable(),
  revokeReason: z.string().max(1000).nullable(),
  version,
});
export type SensitiveGrant = z.infer<typeof sensitiveGrant>;

export const sensitiveGrantPage = page(sensitiveGrant);
export type SensitiveGrantPage = z.infer<typeof sensitiveGrantPage>;

/** SensitiveGrantCreate (POST /admin/sensitive-grants). */
export const sensitiveGrantCreate = z.strictObject({
  transformationId: uuid,
  recordType: sensitiveRecordType,
  recordId: uuid,
  granteeUserId: uuid,
  reason,
});
export type SensitiveGrantCreate = z.infer<typeof sensitiveGrantCreate>;

/** SensitiveGrantRevoke (POST /admin/sensitive-grants/{grantId}/revoke). */
export const sensitiveGrantRevoke = z.strictObject({ reason });
export type SensitiveGrantRevoke = z.infer<typeof sensitiveGrantRevoke>;
