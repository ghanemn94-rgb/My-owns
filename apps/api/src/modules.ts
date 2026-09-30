// API module map and dependency-direction rules (ADR-0002). backend-workflow-engineer adds an architecture
// test that parses imports under src/modules/** and fails when a module imports anything not allowed here.
//
// Rules:
//  1. A module may import only its own files, the modules listed in `dependsOn`, and the shared packages
//     (@mth/shared, @mth/config, @mth/db). Cross-module calls go through the other module's `index.ts`.
//  2. Every module may call `access` (the single policy function) and `audit` (the audit writer).
//  3. No cycles. `platform` (HTTP plumbing: request IDs, problem+json, ETag/If-Match, CSRF, rate limits)
//     depends on nothing and nothing depends on route files.

export const API_MODULES = {
  platform: { responsibility: "HTTP plumbing, errors, request IDs, health/readiness", dependsOn: [] },
  audit: { responsibility: "Append-only audit writer and audit queries", dependsOn: ["platform"] },
  identity: { responsibility: "OIDC login, dev login, sessions, CSRF, /me", dependsOn: ["platform", "audit", "access", "organization"] },
  access: { responsibility: "Roles, permissions, scoped assignments, delegation, the policy function", dependsOn: ["platform", "audit"] },
  organization: { responsibility: "Organizations, business units, calendars (later)", dependsOn: ["platform", "audit", "access"] },
  transformations: { responsibility: "Transformation records and workspace header data", dependsOn: ["platform", "audit", "access", "organization", "jobs"] },
  methodology: { responsibility: "Methodology/form/formula versions and publishing (P2/P5)", dependsOn: ["platform", "audit", "access"] },
  workflows: { responsibility: "Gates, approvals, decisions, SoD rules (P2+)", dependsOn: ["platform", "audit", "access", "transformations", "methodology"] },
  kpi: { responsibility: "KPI and benefit calculations via @mth/calc (P4)", dependsOn: ["platform", "audit", "access", "transformations", "methodology"] },
  reporting: { responsibility: "Report snapshots and exports via @mth/reporting (P5)", dependsOn: ["platform", "audit", "access", "transformations", "kpi"] },
  evidence: { responsibility: "Evidence metadata and the storage adapter (P2/P6)", dependsOn: ["platform", "audit", "access"] },
  jobs: { responsibility: "Outbox writer and job/automation administration views", dependsOn: ["platform", "audit"] },
  admin: { responsibility: "Administration endpoints composed from other modules", dependsOn: ["platform", "audit", "access", "organization", "identity", "jobs"] },
} as const satisfies Record<string, { responsibility: string; dependsOn: readonly string[] }>;

export type ApiModule = keyof typeof API_MODULES;

/** Modules delivered in P1; the rest are reserved names so later stages add code, not new boundaries. */
export const P1_MODULES: readonly ApiModule[] = ["platform", "audit", "identity", "access", "organization", "transformations", "jobs", "admin"];
