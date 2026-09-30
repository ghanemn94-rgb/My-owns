import { z } from "zod";
import {
  locale,
  name,
  permissionCode,
  uniqueArray,
  reason,
  roleCode,
  scopeRef,
  timestamp,
  timeZone,
  userStatus,
  uuid,
  version,
} from "./common.ts";
import { organization } from "./organization.ts";

export const userIdentity = z.strictObject({
  issuer: z.string().max(512),
  subject: z.string().max(255),
  createdAt: timestamp,
  lastLoginAt: timestamp.nullable(),
});
export const user = z.strictObject({
  id: uuid,
  organizationId: uuid,
  displayName: name,
  email: z.email().max(320).nullable(),
  preferredLocale: locale,
  timezone: timeZone.nullable(),
  status: userStatus,
  identities: z.array(userIdentity),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const userCreate = z.strictObject({
  organizationId: uuid,
  displayName: name,
  email: z.email().max(320).optional(),
  preferredLocale: locale.optional(),
  identity: z.strictObject({ issuer: z.string().max(512), subject: z.string().min(1).max(255) }).optional(),
});
export const userUpdate = z
  .strictObject({
    displayName: name,
    email: z.email().max(320).nullable(),
    preferredLocale: locale,
    status: userStatus,
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "validation.empty_update");
export const preferencesUpdate = z
  .strictObject({ preferredLocale: locale, timezone: timeZone.nullable() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "validation.empty_update");

export const role = z.strictObject({
  id: uuid,
  code: roleCode,
  nameEn: name,
  nameAr: name,
  kind: z.enum(["source", "implementation", "technical_admin"]),
  inheritsDownward: z.boolean(),
  permissions: uniqueArray(permissionCode),
});
export const permissionEntry = z.strictObject({
  code: permissionCode,
  category: z.enum(["read", "write", "configure", "business_approval", "finance_validation"]),
});

export const roleAssignment = z.strictObject({
  id: uuid,
  organizationId: uuid,
  userId: uuid,
  roleCode,
  scope: scopeRef,
  effectiveFrom: timestamp,
  effectiveTo: timestamp.nullable(),
  reason,
  grantedBy: uuid,
  revokedAt: timestamp.nullable(),
  revokedBy: uuid.nullable(),
  revokeReason: z.string().nullable(),
  version,
  createdAt: timestamp,
});
export const roleAssignmentCreate = z
  .strictObject({
    userId: uuid,
    roleCode,
    scope: scopeRef,
    effectiveFrom: timestamp.optional(),
    effectiveTo: timestamp.optional(),
    reason,
  })
  // Compare instants, not strings: "2026-01-01T10:00:00+03:00" is BEFORE "2026-01-01T08:00:00Z".
  .refine((a) => !a.effectiveFrom || !a.effectiveTo || Date.parse(a.effectiveFrom) < Date.parse(a.effectiveTo), {
    message: "validation.effective_range",
    path: ["effectiveTo"],
  });

export const devLoginRequest = z.strictObject({ username: z.string().regex(/^[a-z0-9._-]{2,64}$/) });
export const logoutResult = z.strictObject({ endSessionUrl: z.string().nullable() });

export const me = z.strictObject({
  user,
  authMode: z.enum(["oidc", "dev"]),
  csrfToken: z.string().min(32),
  productName: z.string(),
  organization,
  assignments: z.array(roleAssignment),
  effectivePermissions: z.array(
    z.strictObject({ scope: scopeRef, inheritsDownward: z.boolean(), permissions: uniqueArray(permissionCode) }),
  ),
});

export type User = z.infer<typeof user>;
export type UserCreate = z.infer<typeof userCreate>;
export type UserUpdate = z.infer<typeof userUpdate>;
export type PreferencesUpdate = z.infer<typeof preferencesUpdate>;
export type Role = z.infer<typeof role>;
export type RoleAssignment = z.infer<typeof roleAssignment>;
export type RoleAssignmentCreate = z.infer<typeof roleAssignmentCreate>;
export type Me = z.infer<typeof me>;
