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
  | "change-requests";

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
  /** "available": working screens; "partial": some content works (see workspaceTab); "planned": landing page only. */
  readonly availability: "available" | "partial" | "planned";
  /** Shown only to users holding any of these permissions (UI hint; the server still decides). */
  readonly requiresAny?: readonly Permission[];
  /** "partial" areas whose content is a transformation workspace tab (e.g. "define"). */
  readonly workspaceTab?: AreaWorkspaceTab;
  /** More workspace tabs the area entry page also leads into (P4: Governance -> decision rights, RACI, …). */
  readonly moreWorkspaceTabs?: readonly AreaWorkspaceTab[];
}

export const NAV_AREAS: readonly NavArea[] = [
  { id: "myWork", path: "/my-work", availability: "available" },
  // T-DG4-FE-G: the Executive Overview (the executive dashboard, ADR-0037 §8) is a working screen.
  { id: "executive", path: "/executive-overview", availability: "available" },
  { id: "transformations", path: "/transformations", availability: "available" },
  { id: "playbook", path: "/playbook", availability: "planned" },
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
  { id: "risks", path: "/risks-actions", availability: "planned" },
  {
    id: "benefits",
    path: "/benefits-finance",
    availability: "partial",
    workspaceTab: "business-cases",
    moreWorkspaceTabs: ["benefits"],
  },
  { id: "change", path: "/change-adoption", availability: "planned" },
  { id: "evidence", path: "/evidence-reports", availability: "partial", workspaceTab: "evidence" },
  { id: "bau", path: "/bau-improvement", availability: "planned" },
  { id: "admin", path: "/admin", availability: "available", requiresAny: ADMIN_PERMISSIONS },
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
    | "changeRequests";
  /** T-DG4-FE-D: the workspace tab an area-entry sub-page opens (the route renders AreaEntryPage for it). */
  readonly workspaceTab?: AreaWorkspaceTab;
  readonly area: AreaId;
  readonly path: string;
  readonly requiresAny?: readonly Permission[];
}

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
  // T-DG4-FE-E: Change and Adoption and BAU and Improvement stay "planned" (their cross-portfolio views are planned);
  // their transformation screens are reachable through these sub-entries and the workspace tabs.
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
];
