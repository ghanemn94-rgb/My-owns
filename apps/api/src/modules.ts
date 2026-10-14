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
    responsibility: "Organizations, business units, business calendars and working-day arithmetic (P4, ADR-0025 §1)",
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
    // P4 (ADR-0026 §6; p4-work-split §I+C.2): the approval service computes working-day due dates with organization's
    // calendar and creates My Work items through tasks' createWorkItemOnce. Neither depends on workflows.
    dependsOn: [
      "platform",
      "audit",
      "access",
      "transformations",
      "methodology",
      "kpi",
      "evidence",
      "organization",
      "tasks",
    ],
  },
  kpi: {
    responsibility: "KPI and benefit calculations via @mth/calc (P4)",
    // P4 (ADR-0025 §2, §4): business dates in the organization's calendar timezone; owner tasks through tasks.
    dependsOn: ["platform", "audit", "access", "transformations", "methodology", "organization", "tasks"],
  },
  reporting: {
    responsibility:
      "Report snapshots and exports via @mth/reporting (P5); P4 traceability, dashboards and My Work views",
    // P4 (p4-plan §5.1 BE-M, KBE-G): read-only views over every P4 engine. Never workflows directly (the read model of
    // approvals comes through governance or tasks), so the P1 scaffold self-check (reporting -> workflows) still holds.
    dependsOn: [
      "platform",
      "audit",
      "access",
      "transformations",
      "kpi",
      "tasks",
      "benefits",
      "raid",
      "adoption",
      "sustainment",
      "governance",
      "portfolio",
      // P5 (p5-plan §2; T-DG5-BE-A): report snapshots record the pinned configuration versions through ConfigResolver.
      "methodology",
    ],
  },
  evidence: {
    responsibility: "Evidence metadata and the storage adapter (P2/P6)",
    // transformations: the P2 register kit (evidence items are transformation-scoped registers).
    dependsOn: ["platform", "audit", "access", "transformations"],
  },
  jobs: {
    responsibility: "Outbox writer and job/automation administration views (P4: job schedules, ADR-0025 §3)",
    dependsOn: ["platform", "audit", "access"],
  },
  portfolio: {
    responsibility:
      "Initiatives (T05) and their links, waves, deliverables, milestones, prioritization, capacity, selection, funding, readiness, outcome hierarchy and gate dispensations (P3)",
    // ADR-0021 §1: portfolio reads gate status and creates canonical decision rows through workflows' public interface.
    // workflows never imports portfolio: its G4 evaluators read portfolio facts through the GateFactsProvider interface
    // it defines (workflows/g4.ts), wired by server.ts, so the graph stays acyclic.
    // P4 (p4-plan §5.1 BE-E): working-day schedule slip uses organization's calendar; tasks for follow-ups.
    dependsOn: [
      "platform",
      "audit",
      "access",
      "transformations",
      "kpi",
      "evidence",
      "workflows",
      "organization",
      "tasks",
    ],
  },
  tasks: {
    responsibility:
      "My Work items and the in-app inbox (P4, ADR-0025 §4): createWorkItemOnce and the five task and inbox operations",
    // A leaf business module: every domain module that creates tasks depends on it, and it depends on none of them.
    dependsOn: ["platform", "audit", "access"],
  },
  governance: {
    responsibility:
      "Decision rights (T11), RACI (T12), governance matrices, forums, meetings, T16 executive decisions, escalations (P4)",
    // p4-plan §2: governance is the only new module that imports workflows (decision rows, the approval service).
    // T-DG4-BE-R3 (ADR-0032 amendment G1): raid, for the one action insert (insertActionItem). raid never imports
    // governance (that edge would close a cycle through reporting and sustainment).
    dependsOn: ["platform", "audit", "access", "organization", "transformations", "workflows", "tasks", "raid"],
  },
  raid: {
    responsibility: "RAID (T15) on canonical records, actions and corrective-action cases (P4, ADR-0031)",
    dependsOn: ["platform", "audit", "access", "organization", "transformations", "kpi", "tasks"],
  },
  benefits: {
    responsibility: "Benefit register (T14), allocations, measurements, Finance validation and totals (P4)",
    dependsOn: ["platform", "audit", "access", "organization", "transformations", "kpi", "evidence", "tasks"],
  },
  adoption: {
    responsibility: "Adoption (T13): stakeholder groups, indicators, interventions and assessments (P4)",
    dependsOn: ["platform", "audit", "access", "organization", "transformations", "kpi", "tasks"],
  },
  sustainment: {
    responsibility:
      "BAU handover, performance areas, controls, continuous improvement, lessons, status model and closure (P4)",
    dependsOn: [
      "platform",
      "audit",
      "access",
      "organization",
      "transformations",
      "kpi",
      "benefits",
      "adoption",
      "raid",
      "tasks",
    ],
  },
  admin: {
    responsibility: "Administration endpoints composed from other modules",
    dependsOn: ["platform", "audit", "access", "organization", "identity", "jobs"],
  },
  // P5 modules (p5-plan §3 seam 24; T-DG5-BE-A). Each reads configuration through methodology's ConfigResolver port
  // (ADR-0039 §3); methodology imports none of them. automation imports no domain module: domain modules register
  // their actions into its AutomationActionRegistry at composition (server.ts), the GateFactsProvider pattern.
  forms: {
    responsibility:
      "Form schemas, field types, custom-field values, the form framework and extension record types (P5 slice B)",
    dependsOn: ["platform", "audit", "access", "organization", "transformations", "methodology", "evidence", "tasks"],
  },
  procedures: {
    responsibility: "Procedure definitions, instances, step outputs and the seeded procedures (P5 slice C)",
    dependsOn: [
      "platform",
      "audit",
      "access",
      "organization",
      "transformations",
      "methodology",
      "forms",
      "evidence",
      "tasks",
    ],
  },
  automation: {
    responsibility:
      "Rule versions, event/schedule evaluation, dry run, execution history, failure queue and service identity (P5 slices D-E)",
    dependsOn: ["platform", "audit", "access", "organization", "methodology", "tasks", "jobs"],
  },
  launch: {
    responsibility: "The 90-day launch plan and the Day-90 test (P5 slice H)",
    dependsOn: ["platform", "audit", "access", "organization", "transformations", "methodology", "tasks"],
  },
  health: {
    responsibility: "The 25-question health check, scoring schemes and assessments (P5 slice H)",
    dependsOn: ["platform", "audit", "access", "organization", "transformations", "methodology", "tasks"],
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

/** Modules added in P3 (ADR-0021 §1; p3-work-split §2 BE-A): each with a public index.ts and its own test suite. */
export const P3_MODULES: readonly ApiModule[] = ["portfolio"];

/**
 * Modules added in P4 (p4-plan §2 seam 19; p4-work-split §I+C.1 BE-A): each with a public index.ts and its own test
 * suite. BE-A creates them with stub route files; the owning tasks fill them (p4-plan §5.1).
 */
export const P4_MODULES: readonly ApiModule[] = ["tasks", "governance", "raid", "benefits", "adoption", "sustainment"];

/**
 * Modules added in P5 (p5-plan §3 seam 24; p5-work-split §A.1 BE-A): each with a public index.ts and its own test
 * suite. BE-A creates them with stub route files; the owning tasks fill them (p5-plan §5.1).
 */
export const P5_MODULES: readonly ApiModule[] = ["forms", "procedures", "automation", "launch", "health"];

/** Every module directory that exists under src/modules (P1 + P2 + P3 + P4 + P5). */
export const IMPLEMENTED_MODULES: readonly ApiModule[] = [
  ...P1_MODULES,
  ...P2_MODULES,
  ...P3_MODULES,
  ...P4_MODULES,
  ...P5_MODULES,
];

/** The six §16 business modules (master prompt M0308; REQ-S16-003 / A12): each exists with its own test suite. */
export const SECTION16_MODULES = {
  "identity/access": ["identity", "access"],
  // P5 (p5-plan §3 seam 24): the launch plan is part of the transformation record.
  transformations: ["transformations", "launch"],
  // P5: procedures and the rule engine join workflows.
  workflows: ["workflows", "procedures", "automation"],
  // P4 (p4-plan §3 seam 19): the benefit engine joins the KPI engine under "formulas/KPI". P5: health-check scoring.
  "formulas/KPI": ["kpi", "benefits", "health"],
  reporting: ["reporting"],
  // P5: the form builder is administration (Playbook Studio's form_schema kind, ADR-0041).
  admin: ["admin", "forms"],
} as const satisfies Record<string, readonly ApiModule[]>;

/** P1 scaffolds: they exist, but deliver behaviour in a later stage and register no routes in P1 (D-048). */
export const P1_SCAFFOLD_MODULES = ["workflows", "kpi", "reporting"] as const satisfies readonly ApiModule[];
