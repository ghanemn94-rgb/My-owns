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
  identity: {
    responsibility: "OIDC login, dev login, sessions, CSRF, /me",
    dependsOn: ["platform", "audit", "access", "organization"],
  },
  access: {
    responsibility: "Roles, permissions, scoped assignments, delegation, the policy function",
    dependsOn: ["platform", "audit"],
  },
  organization: {
    responsibility: "Organizations, business units, calendars (later)",
    dependsOn: ["platform", "audit", "access"],
  },
  transformations: {
    responsibility: "Transformation records and workspace header data",
    dependsOn: ["platform", "audit", "access", "organization", "jobs"],
  },
  methodology: {
    responsibility: "Methodology/form/formula versions and publishing (P2/P5)",
    dependsOn: ["platform", "audit", "access"],
  },
  workflows: {
    responsibility: "Gates, approvals, decisions, SoD rules (P2+)",
    // ADR-0015: the G1-G3 criterion evaluators read through the public interfaces of transformations, kpi and
    // evidence. None of those depends on workflows, so the graph stays acyclic.
    dependsOn: ["platform", "audit", "access", "transformations", "methodology", "kpi", "evidence"],
  },
  kpi: {
    responsibility: "KPI and benefit calculations via @mth/calc (P4)",
    dependsOn: ["platform", "audit", "access", "transformations", "methodology"],
  },
  reporting: {
    responsibility: "Report snapshots and exports via @mth/reporting (P5)",
    dependsOn: ["platform", "audit", "access", "transformations", "kpi"],
  },
  evidence: {
    responsibility: "Evidence metadata and the storage adapter (P2/P6)",
    // transformations: the P2 register kit (evidence items are transformation-scoped registers).
    dependsOn: ["platform", "audit", "access", "transformations"],
  },
  jobs: { responsibility: "Outbox writer and job/automation administration views", dependsOn: ["platform", "audit"] },
  admin: {
    responsibility: "Administration endpoints composed from other modules",
    dependsOn: ["platform", "audit", "access", "organization", "identity", "jobs"],
  },
} as const satisfies Record<string, { responsibility: string; dependsOn: readonly string[] }>;

export type ApiModule = keyof typeof API_MODULES;

/**
 * Modules that exist since P1 (each with a public index.ts and, for the §16 business modules, its own test suite).
 * `workflows`, `kpi` and `reporting` were P1 SCAFFOLDS (D-048): boundary, public interface, wiring hook and suite
 * existed from DG1; their business behaviour lands in P2 / P4 / P5. `methodology` and `evidence` were reserved names
 * in P1 and get their directories in P2 (P2_MODULES).
 */
export const P1_MODULES: readonly ApiModule[] = [
  "platform",
  "audit",
  "identity",
  "access",
  "organization",
  "transformations",
  "jobs",
  "admin",
  "workflows",
  "kpi",
  "reporting",
];

/** Modules added in P2 (ADR-0015, ADR-0018; p2-work-split §2): each with a public index.ts and its own test suite. */
export const P2_MODULES: readonly ApiModule[] = ["methodology", "evidence"];

/** Every module directory that exists under src/modules (P1 + P2). */
export const IMPLEMENTED_MODULES: readonly ApiModule[] = [...P1_MODULES, ...P2_MODULES];

/** The six §16 business modules (master prompt M0308; REQ-S16-003 / A12): each exists with its own test suite. */
export const SECTION16_MODULES = {
  "identity/access": ["identity", "access"],
  transformations: ["transformations"],
  workflows: ["workflows"],
  "formulas/KPI": ["kpi"],
  reporting: ["reporting"],
  admin: ["admin"],
} as const satisfies Record<string, readonly ApiModule[]>;

/** P1 scaffolds: they exist, but deliver behaviour in a later stage and register no routes in P1 (D-048). */
export const P1_SCAFFOLD_MODULES = ["workflows", "kpi", "reporting"] as const satisfies readonly ApiModule[];
