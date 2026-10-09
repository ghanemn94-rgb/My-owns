// Permission catalogue and seeded role defaults (ADR-0006). Source: docs/analysis/permissions-matrix.md.
// These are a CONFIGURABLE STARTING POINT, not a Mobily-approved access policy. The database is the runtime
// source of truth (role, permission, role_permission tables); the seed migrations insert exactly these rows (P1:
// 0005_seed_roles_permissions.sql; P2: 0018_p2_access_instantiation.sql; P3: 0024_p3_gates_access_instantiation.sql; P4 slices I and C: 0031_p4_approvals_permissions.sql; P4 slice A: 0036_p4_kpi_permissions_backfill.sql), and a unit test in @mth/db asserts each
// seed matches this file.

export const PERMISSION_CATEGORIES = ["read", "write", "configure", "business_approval", "finance_validation"] as const;
export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const P1_PERMISSIONS = {
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

/** P2 catalogue (Diagnose / Define / Design, product gates G1-G3; ADR-0020). Seeded by migration 0018. */
export const P2_PERMISSIONS = {
  "north_star.edit": "write",
  "charter.edit": "write",
  "outcome.edit": "write",
  "kpi_definition.edit": "write",
  "kpi_target.approve": "business_approval",
  "baseline.edit": "write",
  "diagnostic.edit": "write",
  "diagnostic.contribute": "write",
  "tom.edit": "write",
  "tom.contribute": "write",
  "workshop.facilitate": "write",
  "decision.edit": "write",
  "decision.decide": "write",
  "dependency.edit": "write",
  "action.edit": "write",
  "action.update_own": "write",
  "evidence.create": "write",
  "evidence.review": "write",
  "gate.submit": "write",
  "gate.configure": "configure",
  "team.assign": "configure",
  "methodology.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/** P3 catalogue (Mobilize: portfolio, prioritization, roadmap, capacity, funding, business case, T09, G4; ADR-0021..0024). Seeded by migration 0024. */
export const P3_PERMISSIONS = {
  "initiative.edit": "write",
  "initiative.launch": "write",
  "portfolio.select": "business_approval",
  "prioritization.score": "write",
  "prioritization.edit": "write",
  "prioritization.approve": "business_approval",
  "roadmap.edit": "write",
  "roadmap.approve": "write",
  "deliverable.accept": "write",
  "capacity.edit": "write",
  "capacity.commit": "write",
  "funding.approve": "business_approval",
  "business_case.edit": "write",
  "benefit_formula.edit": "write",
  "dependency_type.configure": "configure",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 catalogue, slices I and C (business calendar, job schedules, groups, role mapping, delegation, approvals, T11 and
 * T12; ADR-0025, ADR-0026 §8). Seeded by migration 0031. Later P4 slices append their own blocks here and in their own
 * migrations. approval.decide is a business approval: no technical_admin role may hold it (REQ-S10-003).
 */
export const P4_PERMISSIONS = {
  "calendar.configure": "configure",
  "job.read": "read",
  "job.configure": "configure",
  "group.manage": "configure",
  "role_mapping.assign": "configure",
  "delegation.create_own": "write",
  "delegation.manage": "configure",
  "approval.request": "write",
  "approval.decide": "business_approval",
  "decision_right.configure": "configure",
  "raci.edit": "write",
} as const satisfies Record<string, PermissionCategory>;

/**
 * P4 catalogue, slice A (KPI engine; ADR-0027 §11). Seeded by migration 0036. Every code is 'write' or 'configure':
 * none is a business approval, so the DG1/DG2 rules keyed on "a role holding an approval permission" (creator-derived
 * assignment, F-DG1-106; team roles, ADR-0020 §3) are unchanged. Trajectory approval reuses kpi_target.approve (P2).
 */
export const P4_KPI_PERMISSIONS = {
  "kpi_version.edit": "write",
  "kpi_version.activate": "write",
  "kpi_threshold.configure": "write",
  "target_trajectory.edit": "write",
  "reporting_period.manage": "configure",
  "kpi_actual.submit": "write",
  "kpi_actual.accept": "write",
  "rag.override": "write",
  "data_quality.manage": "write",
} as const satisfies Record<string, PermissionCategory>;

export const PERMISSIONS = {
  ...P1_PERMISSIONS,
  ...P2_PERMISSIONS,
  ...P3_PERMISSIONS,
  ...P4_PERMISSIONS,
  ...P4_KPI_PERMISSIONS,
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

/**
 * P2 role defaults (seeded by 0018). Kept separate so each seed migration can be compared with its own part.
 * AUD (read-only auditor), CM, SEC, ADM_TECH and ADM_ACCESS get no P2 write permission (ADR-0020).
 */
export const P2_ROLE_PERMISSIONS = {
  SP: ["kpi_target.approve", "decision.decide", "action.update_own"],
  TL: [
    "north_star.edit",
    "charter.edit",
    "outcome.edit",
    "kpi_definition.edit",
    "baseline.edit",
    "diagnostic.edit",
    "tom.edit",
    "workshop.facilitate",
    "decision.edit",
    "decision.decide",
    "dependency.edit",
    "action.edit",
    "evidence.create",
    "evidence.review",
    "gate.submit",
    "team.assign",
  ],
  BO: [
    "outcome.edit",
    "kpi_target.approve",
    "tom.edit",
    "decision.decide",
    "action.update_own",
    "evidence.create",
    "evidence.review",
  ],
  WL: [
    "diagnostic.contribute",
    "tom.contribute",
    "decision.edit",
    "decision.decide",
    "dependency.edit",
    "action.update_own",
    "evidence.create",
  ],
  FIN: ["action.update_own", "evidence.create", "evidence.review"],
  TO: [
    "charter.edit",
    "diagnostic.edit",
    "dependency.edit",
    "action.edit",
    "evidence.create",
    "evidence.review",
    "gate.configure",
    "team.assign",
  ],
  KDS: ["outcome.edit", "kpi_definition.edit", "baseline.edit", "action.update_own", "evidence.create"],
  TD: ["tom.contribute", "dependency.edit", "action.update_own", "evidence.create"],
  ADM_METHOD: ["methodology.configure"],
} as const satisfies Record<string, readonly (keyof typeof P2_PERMISSIONS)[]>;

/**
 * P3 role defaults (seeded by 0024; ADR-0021 §6, permissions matrix "P3"). Business approvals (portfolio selection,
 * weight sets and overrides, funding) go to SP, and funding also to FIN; finance.validate (P1 catalogue) stays FIN's.
 * AUD, CM, SEC, TD, ADM_TECH and ADM_ACCESS get no P3 permission.
 */
export const P3_ROLE_PERMISSIONS = {
  SP: ["portfolio.select", "prioritization.approve", "deliverable.accept", "funding.approve"],
  TL: [
    "initiative.edit",
    "initiative.launch",
    "prioritization.score",
    "prioritization.edit",
    "roadmap.edit",
    "roadmap.approve",
    "deliverable.accept",
    "capacity.edit",
    "business_case.edit",
    "benefit_formula.edit",
  ],
  BO: ["prioritization.score", "deliverable.accept", "capacity.commit", "benefit_formula.edit"],
  WL: ["initiative.edit", "prioritization.score", "roadmap.edit", "capacity.edit", "business_case.edit"],
  FIN: ["funding.approve"],
  TO: [
    "initiative.edit",
    "prioritization.edit",
    "roadmap.edit",
    "roadmap.approve",
    "capacity.edit",
    "capacity.commit",
    "business_case.edit",
  ],
  KDS: ["benefit_formula.edit"],
  ADM_METHOD: ["dependency_type.configure"],
} as const satisfies Record<string, readonly (keyof typeof P3_PERMISSIONS)[]>;

/**
 * P4 role defaults, slices I and C (seeded by 0031; ADR-0026 §8, permissions matrix "P4"). approval.decide
 * (business_approval) goes ONLY to SP, BO and FIN, the roles that already hold an approval permission: TL, TO, WL and CM
 * must stay non-approver roles (creator-derived assignments, F-DG1-106; team roles, ADR-0020 §3). Deciding also needs
 * the approval to be assigned to the caller, their group or someone they act for (record-level rule).
 * ADM_TECH configures calendars and jobs, ADM_ACCESS records delegations on request; neither decides anything.
 * AUD gets no P4 permission (read-only through BASE_READ and its scope).
 */
export const P4_ROLE_PERMISSIONS = {
  SP: ["delegation.create_own", "approval.request", "approval.decide"],
  TL: ["role_mapping.assign", "delegation.create_own", "approval.request", "decision_right.configure", "raci.edit"],
  BO: ["delegation.create_own", "approval.request", "approval.decide"],
  WL: ["delegation.create_own", "approval.request"],
  FIN: ["delegation.create_own", "approval.request", "approval.decide"],
  TO: [
    "group.manage",
    "role_mapping.assign",
    "delegation.create_own",
    "approval.request",
    "decision_right.configure",
    "raci.edit",
  ],
  KDS: ["delegation.create_own"],
  TD: ["delegation.create_own"],
  CM: ["delegation.create_own"],
  SEC: ["delegation.create_own"],
  ADM_TECH: ["calendar.configure", "job.read", "job.configure"],
  ADM_ACCESS: ["delegation.manage"],
} as const satisfies Record<string, readonly (keyof typeof P4_PERMISSIONS)[]>;

/**
 * P4 role defaults, slice A (seeded by 0036; ADR-0027 §11, permissions matrix §11). Owner roles of REQ-S07-001/-003/
 * -007/-009/-012: KDS and TL define KPIs, versions, thresholds and trajectories; KDS and BO submit actuals; SP, TL and
 * BO may accept as the configured reviewer (record-level: they must resolve to the version's reviewer party); TL and BO
 * override RAG. TO manages reporting periods. AUD, CM, SEC, TD, WL, FIN and the technical admins get none.
 */
export const P4_KPI_ROLE_PERMISSIONS = {
  SP: ["kpi_actual.accept"],
  TL: [
    "kpi_version.edit",
    "kpi_version.activate",
    "kpi_threshold.configure",
    "target_trajectory.edit",
    "kpi_actual.accept",
    "rag.override",
    "data_quality.manage",
  ],
  BO: ["kpi_actual.submit", "kpi_actual.accept", "rag.override"],
  TO: ["reporting_period.manage"],
  KDS: [
    "kpi_version.edit",
    "kpi_version.activate",
    "kpi_threshold.configure",
    "target_trajectory.edit",
    "kpi_actual.submit",
    "data_quality.manage",
  ],
} as const satisfies Record<string, readonly (keyof typeof P4_KPI_PERMISSIONS)[]>;

export const ROLES = {
  SP: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "gate.decide",
      ...P2_ROLE_PERMISSIONS.SP,
      ...P3_ROLE_PERMISSIONS.SP,
      ...P4_ROLE_PERMISSIONS.SP,
      ...P4_KPI_ROLE_PERMISSIONS.SP,
    ],
  },
  TL: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "transformation.create",
      "transformation.update",
      "transformation.archive",
      "audit.read",
      ...P2_ROLE_PERMISSIONS.TL,
      ...P3_ROLE_PERMISSIONS.TL,
      ...P4_ROLE_PERMISSIONS.TL,
      ...P4_KPI_ROLE_PERMISSIONS.TL,
    ],
  },
  BO: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "gate.decide",
      ...P2_ROLE_PERMISSIONS.BO,
      ...P3_ROLE_PERMISSIONS.BO,
      ...P4_ROLE_PERMISSIONS.BO,
      ...P4_KPI_ROLE_PERMISSIONS.BO,
    ],
  },
  WL: {
    kind: "source",
    inheritsDownward: false,
    permissions: [...BASE_READ, ...P2_ROLE_PERMISSIONS.WL, ...P3_ROLE_PERMISSIONS.WL, ...P4_ROLE_PERMISSIONS.WL],
  },
  FIN: {
    kind: "source",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      "finance.validate",
      ...P2_ROLE_PERMISSIONS.FIN,
      ...P3_ROLE_PERMISSIONS.FIN,
      ...P4_ROLE_PERMISSIONS.FIN,
    ],
  },
  TO: {
    kind: "source",
    inheritsDownward: true,
    permissions: [
      ...BASE_READ,
      "transformation.create",
      "transformation.update",
      "transformation.archive",
      "audit.read",
      ...P2_ROLE_PERMISSIONS.TO,
      ...P3_ROLE_PERMISSIONS.TO,
      ...P4_ROLE_PERMISSIONS.TO,
      ...P4_KPI_ROLE_PERMISSIONS.TO,
    ],
  },
  KDS: {
    kind: "implementation",
    inheritsDownward: false,
    permissions: [
      ...BASE_READ,
      ...P2_ROLE_PERMISSIONS.KDS,
      ...P3_ROLE_PERMISSIONS.KDS,
      ...P4_ROLE_PERMISSIONS.KDS,
      ...P4_KPI_ROLE_PERMISSIONS.KDS,
    ],
  },
  TD: {
    kind: "implementation",
    inheritsDownward: false,
    permissions: [...BASE_READ, ...P2_ROLE_PERMISSIONS.TD, ...P4_ROLE_PERMISSIONS.TD],
  },
  CM: { kind: "implementation", inheritsDownward: false, permissions: [...BASE_READ, ...P4_ROLE_PERMISSIONS.CM] },
  SEC: { kind: "implementation", inheritsDownward: false, permissions: [...BASE_READ, ...P4_ROLE_PERMISSIONS.SEC] },
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
    permissions: [
      "organization.read",
      "organization.manage",
      "business_unit.read",
      "business_unit.manage",
      "role.read",
      ...P4_ROLE_PERMISSIONS.ADM_TECH,
    ],
  },
  ADM_ACCESS: {
    kind: "technical_admin",
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "business_unit.read",
      "role.read",
      "user.read",
      "user.manage",
      "access.read",
      "access.assign",
      ...P4_ROLE_PERMISSIONS.ADM_ACCESS,
    ],
  },
  ADM_METHOD: {
    kind: "technical_admin",
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "role.read",
      ...P2_ROLE_PERMISSIONS.ADM_METHOD,
      ...P3_ROLE_PERMISSIONS.ADM_METHOD,
    ],
  },
} as const satisfies Record<string, RoleDefinition>;
export type RoleCode = keyof typeof ROLES;
export const ROLE_CODES = Object.keys(ROLES) as RoleCode[];

/** Categories a technical_admin role may never hold (enforced again by a DB trigger, ADR-0006). */
export const APPROVAL_CATEGORIES: readonly PermissionCategory[] = ["business_approval", "finance_validation"];
