// Permission catalogue and seeded role defaults (ADR-0006). Source: docs/analysis/permissions-matrix.md.
// These are a CONFIGURABLE STARTING POINT, not a Mobily-approved access policy. The database is the runtime
// source of truth (role, permission, role_permission tables); the P1 seed migration inserts exactly these rows,
// and a unit test in @mth/db asserts the seed matches this file.

export const PERMISSION_CATEGORIES = ["read", "write", "configure", "business_approval", "finance_validation"] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const PERMISSIONS = {
  "organization.read": "read",
  "organization.manage": "configure",
  "business_unit.read": "read",
  "business_unit.manage": "configure",
  "user.read": "read",
  "user.manage": "configure",
  "role.read": "read",
  "access.read": "read",
  "access.assign": "configure",
  "transformation.read": "read",
  "transformation.create": "write",
  "transformation.update": "write",
  "transformation.archive": "write",
  "audit.read": "read",
  // Catalogue entries that exist from P1 so separation-of-duties constraints are enforced from the start
  // (ADR-0006: a technical_admin role can never hold these). No P1 route uses them.
  "gate.decide": "business_approval",
  "finance.validate": "finance_validation",
} as const satisfies Record<string, PermissionCategory>;
export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_KINDS = ["source", "implementation", "technical_admin"] as const;
export type RoleKind = (typeof ROLE_KINDS)[number];

export interface RoleDefinition {
  readonly kind: RoleKind;
  /** A grant at a wider scope also applies to narrower scopes inside it (permissions matrix rule 1). */
  readonly inheritsDownward: boolean;
  readonly permissions: readonly Permission[];
}

const BASE_READ = ["organization.read", "business_unit.read", "role.read", "transformation.read"] as const;

export const ROLES = {
  SP: { kind: "source", inheritsDownward: false, permissions: [...BASE_READ, "gate.decide"] },
  TL: {
    kind: "source",
    inheritsDownward: false,
    permissions: [...BASE_READ, "transformation.create", "transformation.update", "transformation.archive", "audit.read"],
  },
  BO: { kind: "source", inheritsDownward: false, permissions: [...BASE_READ, "gate.decide"] },
  WL: { kind: "source", inheritsDownward: false, permissions: [...BASE_READ] },
  FIN: { kind: "source", inheritsDownward: false, permissions: [...BASE_READ, "finance.validate"] },
  TO: {
    kind: "source",
    inheritsDownward: true,
    permissions: [...BASE_READ, "transformation.create", "transformation.update", "transformation.archive", "audit.read"],
  },
  KDS: { kind: "implementation", inheritsDownward: false, permissions: [...BASE_READ] },
  TD: { kind: "implementation", inheritsDownward: false, permissions: [...BASE_READ] },
  CM: { kind: "implementation", inheritsDownward: false, permissions: [...BASE_READ] },
  SEC: { kind: "implementation", inheritsDownward: false, permissions: [...BASE_READ] },
  AUD: {
    kind: "implementation",
    inheritsDownward: true,
    permissions: [...BASE_READ, "audit.read", "user.read", "access.read"],
  },
  // Technical administrators: configuration only, no business-record access and never an approver
  // (REQ-S10-003, REQ-S06-010; permissions matrix: Transformation row "— (technical support only)").
  ADM_TECH: {
    kind: "technical_admin",
    inheritsDownward: false,
    permissions: ["organization.read", "organization.manage", "business_unit.read", "business_unit.manage", "role.read"],
  },
  ADM_ACCESS: {
    kind: "technical_admin",
    inheritsDownward: false,
    permissions: ["organization.read", "business_unit.read", "role.read", "user.read", "user.manage", "access.read", "access.assign"],
  },
  ADM_METHOD: { kind: "technical_admin", inheritsDownward: false, permissions: ["organization.read", "role.read"] },
} as const satisfies Record<string, RoleDefinition>;
export type RoleCode = keyof typeof ROLES;
export const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

/** Categories a technical_admin role may never hold (enforced again by a DB trigger, ADR-0006). */
export const APPROVAL_CATEGORIES: readonly PermissionCategory[] = ["business_approval", "finance_validation"];
