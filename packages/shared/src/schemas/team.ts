// P2 team mirrors (backend-workflow-engineer; ADR-0020 §5-6): role accountability text (B0018 verbatim for the six
// source roles; platform text for implementation roles; Arabic provisional), the transformation team view and the
// non-approver team assignment body. Mirrors docs/api/openapi.yaml RoleAccountability*, TeamAssignment*.
import { z } from "zod";
import { freeText, reason, roleCode, timestamp, uuid, version } from "./common.ts";
import { roleAssignment } from "./access.ts";

export const roleAccountability = z.strictObject({
  roleId: uuid,
  accountabilityEn: freeText(1, 1000),
  accountabilityAr: freeText(1, 1000),
  isSourceText: z.boolean(),
  sourceRef: freeText(1, 50),
  version,
  createdAt: timestamp,
  createdBy: uuid.nullable(),
  updatedAt: timestamp,
  updatedBy: uuid.nullable(),
  roleCode,
});
export type RoleAccountability = z.infer<typeof roleAccountability>;
export const roleAccountabilityList = z.strictObject({ items: z.array(roleAccountability) });

export const teamAssignment = z.strictObject({
  assignment: roleAssignment,
  accountability: roleAccountability.nullable(),
  inherited: z.boolean(),
});
export const teamAssignmentPage = z.strictObject({ items: z.array(teamAssignment), nextCursor: z.string().nullable() });

/** Team roles a TL/TO may assign under team.assign: no approval permission and no assignment rights (ADR-0020 §3). */
export const TEAM_ASSIGNABLE_ROLES = ["WL", "KDS", "TD", "CM", "SEC"] as const;
export const teamAssignmentCreate = z.strictObject({
  userId: uuid,
  roleCode: z.enum(TEAM_ASSIGNABLE_ROLES),
  effectiveFrom: timestamp.optional(),
  effectiveTo: timestamp.optional(),
  reason,
});
