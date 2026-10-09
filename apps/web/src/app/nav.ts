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
  | "transform-readiness";

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
  { id: "executive", path: "/executive-overview", availability: "planned" },
  { id: "transformations", path: "/transformations", availability: "available" },
  { id: "playbook", path: "/playbook", availability: "planned" },
  { id: "strategy", path: "/strategy-kpis", availability: "partial", workspaceTab: "define" },
  { id: "tom", path: "/target-operating-model", availability: "partial", workspaceTab: "design" },
  { id: "initiatives", path: "/initiatives-roadmaps", availability: "partial", workspaceTab: "portfolio" },
  {
    id: "governance",
    path: "/governance",
    availability: "partial",
    workspaceTab: "gates",
    moreWorkspaceTabs: ["decision-rights", "raci", "role-mappings", "transform-readiness"],
  },
  { id: "risks", path: "/risks-actions", availability: "planned" },
  { id: "benefits", path: "/benefits-finance", availability: "partial", workspaceTab: "business-cases" },
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
  readonly id: "myWorkItems" | "approvals" | "delegations" | "calendar" | "jobs" | "groups";
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
];
