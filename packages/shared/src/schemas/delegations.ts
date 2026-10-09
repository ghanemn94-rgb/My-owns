// zod mirrors of the P4 delegations tag (docs/api/openapi.yaml; ADR-0026 §3; REQ-S10-010; T-DG4-BE-B). Structural
// rules only: the window (start before end, end in the future, at most 366 days), self-delegation, loops and the
// pending-requester rule are business rules answered with 422 by the API (exact codes in ADR-0026 §3).
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";

export const delegationStatus = z.enum(["active", "revoked", "expired"]);
export const delegationReasonCode = z.enum(["absence", "other"]);
export const delegationScopeType = z.enum([
  "organization",
  "business_unit",
  "transformation",
  "portfolio",
  "workstream",
  "initiative",
  "performance_area",
  "forum",
  "record",
]);

export const delegation = z.strictObject({
  id: uuid,
  organizationId: uuid,
  delegatorUserId: uuid,
  delegateUserId: uuid,
  scopeType: z.string().nullable(),
  scopeId: uuid.nullable(),
  recordTypes: z.array(z.string()).nullable(),
  reasonCode: delegationReasonCode,
  reasonText: z.string().nullable(),
  absenceNote: z.string().nullable(),
  requestedByUserId: uuid.nullable(),
  effectiveFrom: timestamp,
  effectiveTo: timestamp,
  status: delegationStatus,
  revokedAt: timestamp.nullable(),
  revokedBy: uuid.nullable(),
  revokeReason: z.string().nullable(),
  version,
  createdAt: timestamp,
});
export type Delegation = z.infer<typeof delegation>;
export const delegationPage = z.strictObject({ items: z.array(delegation), nextCursor: z.string().nullable() });

export const delegationCreate = z.strictObject({
  /** Omitted = the caller. Another person only with delegation.manage, on that person's request. */
  delegatorUserId: uuid.optional(),
  delegateUserId: uuid,
  scopeType: delegationScopeType.optional(),
  scopeId: uuid.optional(),
  recordTypes: z
    .array(
      z
        .string()
        .max(64)
        .regex(/^[a-z_]+$/, "validation.pattern"),
    )
    .min(1)
    .max(20)
    .optional(),
  reasonCode: delegationReasonCode,
  reasonText: freeText(1, 1000).optional(),
  absenceNote: freeText(1, 1000).optional(),
  effectiveFrom: timestamp,
  effectiveTo: timestamp,
});
export type DelegationCreate = z.infer<typeof delegationCreate>;
