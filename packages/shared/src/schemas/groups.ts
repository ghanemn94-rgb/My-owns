// zod mirrors of the P4 groups and role-mappings tags (docs/api/openapi.yaml; ADR-0026 §1-§2; T-DG4-BE-B). The OpenAPI
// file is the source of truth; the contract test parses every success body with these. A group is a ROUTING target: it
// grants no permission (scoped_assignment stays the only source of access, ADR-0006). Free text goes through the shared
// rules (S-1): `name` (trimmed, not blank) and `freeText` (not blank, stored as entered).
import { z } from "zod";
import { code, freeText, name, timestamp, uuid, version } from "./common.ts";

/** A governance party code (governance_party), e.g. SP, BO, STEERCO. */
export const partyCode = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/, "validation.party_code");
export const groupStatus = z.enum(["active", "archived"]);

export const group = z.strictObject({
  id: uuid,
  organizationId: uuid,
  code,
  nameEn: name,
  nameAr: name,
  description: z.string().max(2000).nullable(),
  ownerUserId: uuid,
  status: groupStatus,
  memberCount: z.number().int().min(0),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Group = z.infer<typeof group>;
export const groupPage = z.strictObject({ items: z.array(group), nextCursor: z.string().nullable() });

export const groupCreate = z.strictObject({
  code,
  nameEn: name,
  nameAr: name,
  description: freeText(1, 2000).optional(),
  ownerUserId: uuid,
});
export type GroupCreate = z.infer<typeof groupCreate>;

export const groupUpdate = z
  .strictObject({
    nameEn: name.optional(),
    nameAr: name.optional(),
    description: freeText(1, 2000).nullable().optional(),
    ownerUserId: uuid.optional(),
    status: groupStatus.optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type GroupUpdate = z.infer<typeof groupUpdate>;

export const groupMember = z.strictObject({
  id: uuid,
  groupId: uuid,
  userId: uuid,
  displayName: z.string(),
  effectiveFrom: timestamp,
  effectiveTo: timestamp.nullable(),
  removedAt: timestamp.nullable(),
  removedBy: uuid.nullable(),
  removeReason: z.string().nullable(),
  version,
});
export type GroupMember = z.infer<typeof groupMember>;
export const groupMemberPage = z.strictObject({ items: z.array(groupMember), nextCursor: z.string().nullable() });

export const groupMemberCreate = z.strictObject({
  userId: uuid,
  effectiveFrom: timestamp.optional(),
  effectiveTo: timestamp.optional(),
});
export type GroupMemberCreate = z.infer<typeof groupMemberCreate>;

export const governanceParty = z.strictObject({
  code: partyCode,
  ordinal: z.number().int().min(1),
  kind: z.enum(["role", "forum", "office", "owner_group"]),
  roleCode: z.string().nullable(),
  labelEn: z.string(),
  labelAr: z.string(),
  sourceRef: z.string(),
});
export type GovernanceParty = z.infer<typeof governanceParty>;
export const governancePartyList = z.strictObject({ items: z.array(governanceParty) });

export const roleMappingTargetKind = z.enum(["user", "group"]);
export const roleMapping = z.strictObject({
  id: uuid,
  transformationId: uuid,
  partyCode,
  targetKind: roleMappingTargetKind,
  userId: uuid.nullable(),
  groupId: uuid.nullable(),
  targetDisplayName: z.string(),
  status: z.enum(["active", "ended"]),
  endedAt: timestamp.nullable(),
  endedBy: uuid.nullable(),
  endReason: z.string().nullable(),
  version,
  createdAt: timestamp,
});
export type RoleMapping = z.infer<typeof roleMapping>;
export const roleMappingPage = z.strictObject({ items: z.array(roleMapping), nextCursor: z.string().nullable() });

export const roleMappingCreate = z.strictObject({
  partyCode,
  targetKind: roleMappingTargetKind,
  userId: uuid.optional(),
  groupId: uuid.optional(),
});
export type RoleMappingCreate = z.infer<typeof roleMappingCreate>;

/** Routing preview of a party: `unmapped` is data here; routing itself refuses with 422 routing.role_unmapped. */
export const partyResolution = z.strictObject({
  partyCode,
  status: z.enum(["mapped", "unmapped"]),
  mappingId: uuid.nullable(),
  targetKind: roleMappingTargetKind.nullable(),
  userId: uuid.nullable(),
  groupId: uuid.nullable(),
});
export type PartyResolution = z.infer<typeof partyResolution>;
