// The fourteen primary navigation areas (master prompt §3, REQ-S03-007). Transformations and Administration are
// working screens. Since P2, Strategy and KPIs, Target Operating Model, Governance and Evidence are "partial": their
// P2 content (Define, Design, gates and decisions, evidence) lives in each transformation's workspace, and the area
// page leads into it; the cross-portfolio views of those areas are still planned. Since P3, Initiatives and Roadmaps
// (the transformation's Portfolio tab) and Benefits and Finance (its Business cases tab) are "partial" the same way. The others are honest landing
// pages that state what the area will contain and that it is planned for a later stage.
// Since P4 (T-DG4-FE-A), My Work is "available" (work items and inbox, approvals, delegations), and areas can carry
// sub-entries (NAV_SUBPAGES): Administration > Calendar and Jobs, Governance > Groups. The transformation-scoped P4
// screens are workspace tabs (components/Workspace.tsx); the routes of FE-B…FE-G are registered up front in
// app/router.tsx (P4_PLANNED_ROUTES) and show a "being built" placeholder until their task replaces the element.
// Since P5 (T-DG5-FE-A; p5-plan §5.1 row FE-A, §3 rows 18 and 26; D-144): no area is "planned" any more. Playbook and
// Procedures, Risks and Actions, Change and Adoption and BAU and Improvement have delivered screens in each
// transformation's workspace (DG4), so they are "partial" like the others. Every non-"available" area has a landing page
// (pages/AreaPages.tsx) that lists the contents §3 names for it (AREA_CONTENTS, REQ-S03-007), each with where it lives:
// a workspace tab, a screen of the product, or a P5 screen that is not available yet. The P5 screens of FE-B…FE-G are
// nav sub-entries and routes registered up front (P5_SUBPAGES here, P5_PLANNED_ROUTES in app/router.tsx); each shows an
// honest "not available yet" placeholder until its owning task replaces the route element.
// Since P6 (T-DG6-FE-A; p6-plan §5.1 row FE-A; p6-work-split §E/F.12, §J/C.13): the Administration screens of slices
// E, F, J and C (Audit, Security, Sensitive grants, Operations, Identity, Storage, Notifications) are sub-entries
// registered up front (P6_SUBPAGES here, P6_PLANNED_ROUTES in app/router.tsx), each with an honest "not available yet"
// placeholder until FE-B replaces the route element. Which areas a caller sees is still decided by the server
// (GET /me/navigation, ADR-0049 §9); `requiresAny` is a UI hint for the sub-entries only.
import type { Permission } from "@mth/shared";
import { ADMIN_PERMISSIONS } from "../auth/permissions.ts";

/** Workspace tabs an area page can lead into (each is a WORKSPACE_TABS id and path segment). */
export type AreaWorkspaceTab =
  | "define"
  | "design"
  | "gates"
  | "evidence"
  | "portfolio"
  | "business-cases"
  | "decision-rights"
  | "raci"
  | "role-mappings"
  | "transform-readiness"
  // P4 slices A, B, E and D (T-DG4-FE-D; D-109 carry-forward: KPI and benefit screens reachable from the areas).
  | "kpis"
  | "benefits"
  | "raid"
  | "actions"
  | "corrective-actions"
  | "forums"
  | "meetings"
  | "executive-decisions"
  // P4 slices F and G (T-DG4-FE-E).
  | "adoption"
  | "bau"
  | "improvement"
  | "lessons"
  // P4 slice H (T-DG4-FE-F2).
  | "phases"
  | "change-requests"
  // T-DG5-FE-A: further workspace tabs the area landing pages name for their §3 contents (AREA_CONTENTS).
  | "diagnose"
  | "decisions"
  | "prioritization"
  | "roadmap"
  | "dependencies"
  | "capacity"
  | "benefit-formulas"
  | "approval-decisions"
  | "closure"
  | "traceability"
  | "dashboard";

export type AreaId =
  | "myWork"
  | "executive"
  | "transformations"
  | "playbook"
  | "strategy"
  | "tom"
  | "initiatives"
  | "governance"
  | "risks"
  | "benefits"
  | "change"
  | "evidence"
  | "bau"
  | "admin";

export interface NavArea {
  readonly id: AreaId;
  readonly path: string;
  /**
   * "available": working screens; "partial": its contents live in the transformation workspaces and in screens listed
   * on its landing page (see workspaceTab, AREA_CONTENTS); "planned": landing page only (no area since P5).
   */
  readonly availability: "available" | "partial" | "planned";
  /** Shown only to users holding any of these permissions (UI hint; the server still decides). */
  readonly requiresAny?: readonly Permission[];
  /** "partial" areas whose content is a transformation workspace tab (e.g. "define"). */
  readonly workspaceTab?: AreaWorkspaceTab;
  /** More workspace tabs the area entry page also leads into (P4: Governance -> decision rights, RACI, …). */
  readonly moreWorkspaceTabs?: readonly AreaWorkspaceTab[];
}

/**
 * The read permissions of the P6 Administration screens (0100, 0103; ADR-0051 §7, ADR-0052 §10, ADR-0053 §9, ADR-0054
 * §5). A UI hint only (the server decides). At the seeded defaults AUD reads Audit, Security, Sensitive grants,
 * Operations and Identity; TO reads Sensitive grants and Operations; KDS and TD read Operations.
 */
export const P6_ADMIN_READ_PERMISSIONS: readonly Permission[] = [
  "audit_event.read",
  "security.read",
  "upload_policy.configure",
  "sensitive_record.read",
  "sensitive_record.grant",
  "operations.read",
  "service_identity.configure",
  "identity.read",
  "storage.configure",
  "notification_channel.configure",
];

export const NAV_AREAS: readonly NavArea[] = [
  { id: "myWork", path: "/my-work", availability: "available" },
  // T-DG4-FE-G: the Executive Overview (the executive dashboard, ADR-0037 §8) is a working screen.
  { id: "executive", path: "/executive-overview", availability: "available" },
  { id: "transformations", path: "/transformations", availability: "available" },
  // T-DG5-FE-A: guidance is the phase workspace (DG4); the reader and executable procedures are P5 screens (FE-G, FE-D).
  { id: "playbook", path: "/playbook", availability: "partial", workspaceTab: "phases" },
  {
    id: "strategy",
    path: "/strategy-kpis",
    availability: "partial",
    workspaceTab: "define",
    moreWorkspaceTabs: ["kpis"],
  },
  { id: "tom", path: "/target-operating-model", availability: "partial", workspaceTab: "design" },
  { id: "initiatives", path: "/initiatives-roadmaps", availability: "partial", workspaceTab: "portfolio" },
  {
    id: "governance",
    path: "/governance",
    availability: "partial",
    workspaceTab: "gates",
    moreWorkspaceTabs: [
      "decision-rights",
      "raci",
      "role-mappings",
      "transform-readiness",
      "forums",
      "meetings",
      "executive-decisions",
    ],
  },
  {
    id: "risks",
    path: "/risks-actions",
    availability: "partial",
    workspaceTab: "raid",
    moreWorkspaceTabs: ["actions", "corrective-actions", "executive-decisions"],
  },
  {
    id: "benefits",
    path: "/benefits-finance",
    availability: "partial",
    workspaceTab: "business-cases",
    moreWorkspaceTabs: ["benefits"],
  },
  { id: "change", path: "/change-adoption", availability: "partial", workspaceTab: "adoption" },
  { id: "evidence", path: "/evidence-reports", availability: "partial", workspaceTab: "evidence" },
  {
    id: "bau",
    path: "/bau-improvement",
    availability: "partial",
    workspaceTab: "bau",
    moreWorkspaceTabs: ["improvement", "lessons"],
  },
  // T-DG5-FE-A: the methodology administrator (ADM_METHOD: methodology.configure, methodology.publish) configures the
  // Playbook Studio under Administration (§3 M0113), so Administration is shown to it too. A UI hint only.
  {
    id: "admin",
    path: "/admin",
    availability: "available",
    requiresAny: [...ADMIN_PERMISSIONS, "methodology.configure", "methodology.publish", ...P6_ADMIN_READ_PERMISSIONS],
  },
];

/**
 * Sub-entries of an area in the primary navigation (P4, T-DG4-FE-A). Labels are `nav.sub.<id>`; they never repeat the
 * area's own label, so "My Work" still names exactly one link. `requiresAny` is a UI hint only: the server decides.
 */
export interface NavSubPage {
  readonly id:
    | "myWorkItems"
    | "approvals"
    | "delegations"
    | "calendar"
    | "jobs"
    | "groups"
    // T-DG4-FE-D: area entry pages that list the transformations and open the matching workspace tab.
    | "kpis"
    | "benefitsRegister"
    | "raid"
    | "actions"
    | "correctiveActions"
    | "forums"
    | "meetings"
    | "executiveDecisions"
    // T-DG4-FE-E: the adoption, BAU, improvement and lesson screens of each transformation, and the lesson search.
    | "adoptionPlan"
    | "performanceAreas"
    | "improvementBacklog"
    | "lessons"
    | "lessonSearch"
    // T-DG4-FE-G: the six dashboards (M0244) under the Executive Overview.
    | "dashboards"
    // T-DG4-FE-F2: the phase workspace (Playbook and Phases) and change requests (Governance).
    | "phaseWorkspace"
    | "changeRequests"
    // T-DG4-FE-G2: the organization's portfolios (ADR-0038 §9) and the dashboard RAG policy (ADR-0037 §3).
    | "portfolios"
    | "ragPolicy"
    // T-DG5-FE-A: the P5 screens of FE-B…FE-G (P5_SUBPAGES), "not available yet" until their task builds them.
    | P5SubPageId
    // T-DG5-FE-D: the jobs operations view (REQ-S12-022: last success, next run, failures, repair).
    | "jobOperations"
    // T-DG5-FE-E: the evidence register (REQ-S13-010) and owner updates (REQ-S09-011) of each transformation.
    | "evidenceRegister"
    | "ownerUpdates"
    // T-DG5-FE-F: the health check scoring schemes (REQ-S14-003; Administration > Playbook Studio > Health check scoring).
    | "healthSchemes"
    // T-DG6-FE-A: the P6 Administration screens of FE-B (P6_SUBPAGES), "not available yet" until FE-B builds them.
    | P6SubPageId
    // T-DG6-FE-E: Administration > AI assistant (ADR-0059 §3).
    | "assistant";
  /** T-DG4-FE-D: the workspace tab an area-entry sub-page opens (the route renders AreaEntryPage for it). */
  readonly workspaceTab?: AreaWorkspaceTab;
  readonly area: AreaId;
  readonly path: string;
  readonly requiresAny?: readonly Permission[];
  /** T-DG5-FE-A: a P5 screen registered up front; its route shows the "not available yet" placeholder of this feature. */
  readonly p5Feature?: P5SubPageId;
  /** T-DG6-FE-A: a P6 screen registered up front; its route shows the "not available yet" placeholder of this feature. */
  readonly p6Feature?: P6SubPageId;
}

/** The P5 navigation sub-entries (p5-plan §1.1, §5.1; D-144 item 1). Each id is also its placeholder's feature id. */
export type P5SubPageId =
  | "notificationPreferences"
  | "reader"
  | "myProcedures"
  | "launchPlan"
  | "healthCheck"
  | "reports"
  | "exports"
  | "presentation"
  | "studio"
  | "methodologyMigrations"
  | "sourceCoverage"
  | "formBuilder"
  | "procedureBuilder"
  | "automation"
  | "approvalRoutes"
  | "branding"
  | "demo";

/**
 * T-DG5-FE-A: the P5 sub-entries, with the FE task that replaces each placeholder (p5-plan §5.1). `requiresAny` is a UI
 * hint (the server decides); the Studio entries need `methodology.read` (ADR-0039 §10), the others are under an area
 * that is already permission-filtered or are personal.
 */
export const P5_SUBPAGES: readonly (NavSubPage & { readonly p5Feature: P5SubPageId; readonly owner: string })[] = [
  // FE-D (slice E): quiet hours, digests and urgent escalation preferences (REQ-S12-025).
  {
    id: "notificationPreferences",
    p5Feature: "notificationPreferences",
    owner: "FE-D",
    area: "myWork",
    path: "/my-work/notification-preferences",
  },
  // FE-G (slice I): the searchable playbook reader (REQ-S03-010); FE-D (slice C): my procedures (REQ-S06-002).
  { id: "reader", p5Feature: "reader", owner: "FE-G", area: "playbook", path: "/playbook/reader" },
  { id: "myProcedures", p5Feature: "myProcedures", owner: "FE-D", area: "playbook", path: "/playbook/procedures" },
  // FE-F (slice H): the 90-day launch plan and the 25-question health check of a transformation.
  { id: "launchPlan", p5Feature: "launchPlan", owner: "FE-F", area: "playbook", path: "/playbook/launch-plan" },
  { id: "healthCheck", p5Feature: "healthCheck", owner: "FE-F", area: "playbook", path: "/playbook/health-check" },
  // FE-E (slice F): generated reports and snapshots, exports, presentation mode.
  { id: "reports", p5Feature: "reports", owner: "FE-E", area: "evidence", path: "/evidence-reports/reports" },
  { id: "exports", p5Feature: "exports", owner: "FE-E", area: "evidence", path: "/evidence-reports/exports" },
  {
    id: "presentation",
    p5Feature: "presentation",
    owner: "FE-E",
    area: "evidence",
    path: "/evidence-reports/presentation",
  },
  // FE-B (slice A): the Playbook Studio, methodology migrations and the source-coverage report.
  {
    id: "studio",
    p5Feature: "studio",
    owner: "FE-B",
    area: "admin",
    path: "/admin/studio",
    requiresAny: ["methodology.read"],
  },
  {
    id: "methodologyMigrations",
    p5Feature: "methodologyMigrations",
    owner: "FE-B",
    area: "admin",
    path: "/admin/methodology-migrations",
    requiresAny: ["methodology.read"],
  },
  {
    id: "sourceCoverage",
    p5Feature: "sourceCoverage",
    owner: "FE-B",
    area: "admin",
    path: "/admin/source-coverage",
    requiresAny: ["methodology.read"],
  },
  // FE-C (slice B): the form builder; FE-D (slices C, D, E): procedures, automation, approval routes.
  { id: "formBuilder", p5Feature: "formBuilder", owner: "FE-C", area: "admin", path: "/admin/forms" },
  { id: "procedureBuilder", p5Feature: "procedureBuilder", owner: "FE-D", area: "admin", path: "/admin/procedures" },
  { id: "automation", p5Feature: "automation", owner: "FE-D", area: "admin", path: "/admin/automation" },
  { id: "approvalRoutes", p5Feature: "approvalRoutes", owner: "FE-D", area: "admin", path: "/admin/approval-routes" },
  // FE-G (slices I, J): Branding Settings and the demo environment.
  { id: "branding", p5Feature: "branding", owner: "FE-G", area: "admin", path: "/admin/branding" },
  { id: "demo", p5Feature: "demo", owner: "FE-G", area: "admin", path: "/admin/demo" },
];

/** The P6 navigation sub-entries (p6-work-split §E/F.12, §J/C.13). Each id is also its placeholder's feature id. */
export type P6SubPageId =
  | "audit"
  | "security"
  | "sensitiveGrants"
  | "operations"
  | "identity"
  | "storage"
  | "notifications";

/**
 * T-DG6-FE-A: the P6 Administration sub-entries, with the FE task that replaces each placeholder (p6-plan §5.1 row
 * FE-B). `requiresAny` is a UI hint (the server decides and answers 403/404). Security covers the upload policy and the
 * rate-limit matrix (ADR-0052 §1, §4); Operations covers operational exceptions, the worker heartbeat and the service
 * identities (ADR-0053 §7). Labels say "Operations", never an engineering delivery gate.
 */
export const P6_SUBPAGES: readonly (NavSubPage & { readonly p6Feature: P6SubPageId; readonly owner: string })[] = [
  // slice F (ADR-0052 §8): the global audit view, read-only for everyone.
  {
    id: "audit",
    p6Feature: "audit",
    owner: "FE-B",
    area: "admin",
    path: "/admin/audit",
    requiresAny: ["audit_event.read"],
  },
  // slice F (ADR-0052 §1, §4): the upload policy and the rate-limit classes.
  {
    id: "security",
    p6Feature: "security",
    owner: "FE-B",
    area: "admin",
    path: "/admin/security",
    requiresAny: ["security.read", "upload_policy.configure"],
  },
  // slice E (ADR-0051 §2): explicit grants to sensitive records.
  {
    id: "sensitiveGrants",
    p6Feature: "sensitiveGrants",
    owner: "FE-B",
    area: "admin",
    path: "/admin/sensitive-grants",
    requiresAny: ["sensitive_record.read", "sensitive_record.grant"],
  },
  // slice J (ADR-0053 §7): operational exceptions, the worker heartbeat and the service identities.
  {
    id: "operations",
    p6Feature: "operations",
    owner: "FE-B",
    area: "admin",
    path: "/admin/operations",
    requiresAny: ["operations.read", "service_identity.configure"],
  },
  // slice C (ADR-0054 §1-§3): identity (never the client secret), evidence storage, notification channels.
  {
    id: "identity",
    p6Feature: "identity",
    owner: "FE-B",
    area: "admin",
    path: "/admin/identity",
    requiresAny: ["identity.read"],
  },
  {
    id: "storage",
    p6Feature: "storage",
    owner: "FE-B",
    area: "admin",
    path: "/admin/storage",
    requiresAny: ["storage.configure"],
  },
  {
    id: "notifications",
    p6Feature: "notifications",
    owner: "FE-B",
    area: "admin",
    path: "/admin/notification-channels",
    requiresAny: ["notification_channel.configure"],
  },
];

export const NAV_SUBPAGES: readonly NavSubPage[] = [
  { id: "myWorkItems", area: "myWork", path: "/my-work" },
  { id: "approvals", area: "myWork", path: "/my-work/approvals" },
  { id: "delegations", area: "myWork", path: "/my-work/delegations" },
  { id: "calendar", area: "admin", path: "/admin/calendar", requiresAny: ["organization.read"] },
  { id: "jobs", area: "admin", path: "/admin/jobs", requiresAny: ["job.read"] },
  { id: "groups", area: "governance", path: "/governance/groups", requiresAny: ["organization.read"] },
  // T-DG4-FE-D (D-109 carry-forward): the KPI, benefit, RAID and governance screens of each transformation.
  { id: "kpis", area: "strategy", path: "/strategy-kpis/kpis", workspaceTab: "kpis" },
  { id: "benefitsRegister", area: "benefits", path: "/benefits-finance/benefits", workspaceTab: "benefits" },
  { id: "raid", area: "risks", path: "/risks-actions/raid", workspaceTab: "raid" },
  { id: "actions", area: "risks", path: "/risks-actions/actions", workspaceTab: "actions" },
  {
    id: "correctiveActions",
    area: "risks",
    path: "/risks-actions/corrective-actions",
    workspaceTab: "corrective-actions",
  },
  { id: "forums", area: "governance", path: "/governance/forums", workspaceTab: "forums" },
  { id: "meetings", area: "governance", path: "/governance/meetings", workspaceTab: "meetings" },
  {
    id: "executiveDecisions",
    area: "governance",
    path: "/governance/executive-decisions",
    workspaceTab: "executive-decisions",
  },
  // T-DG4-FE-E: the transformation screens of Change and Adoption and BAU and Improvement, reachable through these
  // sub-entries and the workspace tabs (their cross-portfolio views are planned for a later release).
  { id: "adoptionPlan", area: "change", path: "/change-adoption/adoption", workspaceTab: "adoption" },
  { id: "performanceAreas", area: "bau", path: "/bau-improvement/bau", workspaceTab: "bau" },
  { id: "improvementBacklog", area: "bau", path: "/bau-improvement/improvement", workspaceTab: "improvement" },
  { id: "lessons", area: "bau", path: "/bau-improvement/lessons", workspaceTab: "lessons" },
  { id: "lessonSearch", area: "bau", path: "/lessons", requiresAny: ["lesson.search"] },
  // T-DG4-FE-G: the dashboards hub (executive, transformation, workstream, Finance, adoption, personal).
  { id: "dashboards", area: "executive", path: "/dashboards" },
  // T-DG4-FE-F2: the guided phase steps of each transformation, and its change requests.
  { id: "phaseWorkspace", area: "playbook", path: "/playbook/phases", workspaceTab: "phases" },
  { id: "changeRequests", area: "governance", path: "/governance/change-requests", workspaceTab: "change-requests" },
  // T-DG4-FE-G2: portfolios (read: organization.read) and the RAG policy (read: organization.read; edit: dashboard.configure).
  { id: "portfolios", area: "initiatives", path: "/portfolios", requiresAny: ["organization.read"] },
  { id: "ragPolicy", area: "executive", path: "/dashboards/rag-policy", requiresAny: ["organization.read"] },

  // T-DG5-FE-A: the P5 screens, appended after the DG4 entries of each area.
  ...P5_SUBPAGES,
  // T-DG5-FE-D: Administration > Operations > Jobs (REQ-S12-022; job.read, ADR-0043 §6).
  { id: "jobOperations", area: "admin", path: "/admin/jobs/operations", requiresAny: ["job.read"] },
  // T-DG5-FE-E: Evidence and Reports > Evidence register (REQ-S13-010); Initiatives and Roadmaps > Updates (REQ-S09-011).
  { id: "evidenceRegister", area: "evidence", path: "/evidence-reports/evidence-register" },
  { id: "ownerUpdates", area: "initiatives", path: "/initiatives-roadmaps/updates" },
  // T-DG5-FE-F: Administration > Health check scoring (REQ-S14-003), beside the Studio entries (methodology.read).
  { id: "healthSchemes", area: "admin", path: "/admin/health-schemes", requiresAny: ["methodology.read"] },
  // T-DG6-FE-A: the P6 Administration screens, appended after the P5 entries.
  ...P6_SUBPAGES,
  // T-DG6-FE-E (ADR-0059 §3, §10): Administration > AI assistant; read with assistant.configure or operations.read.
  {
    id: "assistant",
    area: "admin",
    path: "/admin/assistant",
    requiresAny: ["assistant.configure", "operations.read"],
  },
];

/**
 * T-DG5-FE-A (REQ-S03-007: "each area's landing page lists the contents named in §3"): the contents master prompt §3
 * (M0100–M0113) names for each area whose landing page is pages/AreaPages.tsx, in §3's order, and where each one lives
 * at the time of this release:
 *  - `tabs`: delivered screens in each transformation's workspace (the landing page lists the transformations);
 *  - `links`: delivered screens outside a workspace (`requiresAny` is a UI hint; the server decides);
 *  - `p5`: P5 screens registered up front that are not available yet (each shows its placeholder until its FE task
 *    replaces it; that task also moves the entry from "not available yet" to delivered, F-DG4-160).
 * Labels are `nav.contents.<area>.<item>`. The four "available" areas (My Work, Executive Overview, Transformations,
 * Administration) are their own working screens and are not listed here.
 */
export interface AreaContentItem {
  readonly id: string;
  readonly tabs?: readonly AreaWorkspaceTab[];
  readonly links?: readonly {
    readonly path: string;
    readonly labelKey: string;
    readonly requiresAny?: readonly Permission[];
  }[];
  readonly p5?: readonly P5SubPageId[];
}

export type LandingAreaId = Exclude<AreaId, "myWork" | "executive" | "transformations" | "admin">;

export const AREA_CONTENTS: Readonly<Record<LandingAreaId, readonly AreaContentItem[]>> = {
  // M0103: searchable source, guidance and executable procedures.
  playbook: [
    // T-DG5-FE-G: the searchable playbook reader is delivered (F-DG4-160).
    { id: "source", links: [{ path: "/playbook/reader", labelKey: "nav.sub.reader" }] },
    // T-DG5-FE-F: the 90-day launch plan and the health check are delivered (F-DG4-160).
    {
      id: "guidance",
      tabs: ["phases"],
      links: [
        { path: "/playbook/launch-plan", labelKey: "nav.sub.launchPlan" },
        { path: "/playbook/health-check", labelKey: "nav.sub.healthCheck" },
      ],
    },
    // T-DG5-FE-D: my procedures is delivered (F-DG4-160).
    { id: "procedures", links: [{ path: "/playbook/procedures", labelKey: "nav.sub.myProcedures" }] },
  ],
  // M0104: outcome trees, definitions, targets, actuals and performance reviews.
  strategy: [
    { id: "outcomeTrees", tabs: ["define"] },
    { id: "definitions", tabs: ["kpis"] },
    { id: "targets", tabs: ["define", "kpis"] },
    { id: "actuals", tabs: ["kpis"] },
    { id: "performanceReviews", tabs: ["kpis", "dashboard"] },
  ],
  // M0105: canvas, gaps, capabilities, processes and design decisions.
  tom: [
    { id: "canvas", tabs: ["design"] },
    { id: "gaps", tabs: ["design"] },
    { id: "capabilities", tabs: ["design"] },
    { id: "processes", tabs: ["design"] },
    { id: "designDecisions", tabs: ["design", "decisions"] },
  ],
  // M0106: cases, prioritization, waves, resources, milestones and dependencies.
  initiatives: [
    {
      id: "cases",
      tabs: ["portfolio", "business-cases"],
      links: [{ path: "/portfolios", labelKey: "nav.sub.portfolios", requiresAny: ["organization.read"] }],
    },
    { id: "prioritization", tabs: ["prioritization"] },
    { id: "waves", tabs: ["roadmap"] },
    { id: "resources", tabs: ["capacity"] },
    { id: "milestones", tabs: ["roadmap"] },
    { id: "dependencies", tabs: ["dependencies"] },
  ],
  // M0107: forums, meetings, decision rights, RACI, approvals and stage gates.
  governance: [
    { id: "forums", tabs: ["forums"] },
    { id: "meetings", tabs: ["meetings"] },
    { id: "decisionRights", tabs: ["decision-rights"] },
    { id: "raci", tabs: ["raci"] },
    {
      id: "approvals",
      tabs: ["approval-decisions"],
      // T-DG5-FE-D: the approval routes screen is delivered (F-DG4-160).
      links: [
        { path: "/my-work/approvals", labelKey: "nav.sub.approvals" },
        { path: "/admin/approval-routes", labelKey: "nav.sub.approvalRoutes", requiresAny: ["methodology.read"] },
      ],
    },
    { id: "stageGates", tabs: ["gates"] },
  ],
  // M0108: integrated RAID, corrective actions and escalations.
  risks: [
    { id: "raid", tabs: ["raid"] },
    { id: "correctiveActions", tabs: ["corrective-actions", "actions"] },
    { id: "escalations", tabs: ["executive-decisions"] },
  ],
  // M0109: formulas, realization, validation and forecasts.
  benefits: [
    { id: "formulas", tabs: ["benefit-formulas"] },
    { id: "realization", tabs: ["benefits"] },
    {
      id: "validation",
      tabs: ["benefits"],
      links: [{ path: "/finance-validation", labelKey: "benefitsP4.finance.orgTitle" }],
    },
    { id: "forecasts", tabs: ["benefits", "business-cases"] },
  ],
  // M0110: stakeholders, interventions and adoption indicators.
  change: [
    { id: "stakeholders", tabs: ["adoption"] },
    { id: "interventions", tabs: ["adoption"] },
    { id: "adoptionIndicators", tabs: ["adoption"] },
  ],
  // M0111: native deliverables, attachments, snapshots and generated packs.
  evidence: [
    { id: "deliverables", tabs: ["evidence", "traceability"] },
    {
      id: "attachments",
      tabs: ["evidence"],
      links: [{ path: "/evidence-reports/evidence-register", labelKey: "nav.sub.evidenceRegister" }],
    },
    // T-DG5-FE-E: reports and snapshots, exports, presentation mode and the evidence register are delivered (F-DG4-160).
    {
      id: "snapshots",
      tabs: ["gates"],
      links: [{ path: "/evidence-reports/reports", labelKey: "nav.sub.reports" }],
    },
    {
      id: "packs",
      links: [
        { path: "/evidence-reports/reports", labelKey: "nav.sub.reports" },
        { path: "/evidence-reports/exports", labelKey: "nav.sub.exports" },
        { path: "/evidence-reports/presentation", labelKey: "nav.sub.presentation" },
      ],
    },
  ],
  // M0112: handovers, controls, lessons and improvement backlog.
  bau: [
    { id: "handovers", tabs: ["bau", "closure"] },
    { id: "controls", tabs: ["bau"] },
    {
      id: "lessons",
      tabs: ["lessons"],
      links: [{ path: "/lessons", labelKey: "nav.sub.lessonSearch", requiresAny: ["lesson.search"] }],
    },
    { id: "improvementBacklog", tabs: ["improvement"] },
  ],
};
