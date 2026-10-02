// The fourteen primary navigation areas (master prompt §3, REQ-S03-007). Transformations and Administration are
// working screens. Since P2, Strategy and KPIs, Target Operating Model, Governance and Evidence are "partial": their
// P2 content (Define, Design, gates and decisions, evidence) lives in each transformation's workspace, and the area
// page leads into it; the cross-portfolio views of those areas are still planned. The others are honest landing
// pages that state what the area will contain and that it is planned for a later stage.
import type { Permission } from "@mth/shared";
import { ADMIN_PERMISSIONS } from "../auth/permissions.ts";

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
  readonly workspaceTab?: "define" | "design" | "gates" | "evidence";
}

export const NAV_AREAS: readonly NavArea[] = [
  { id: "myWork", path: "/my-work", availability: "partial" },
  { id: "executive", path: "/executive-overview", availability: "planned" },
  { id: "transformations", path: "/transformations", availability: "available" },
  { id: "playbook", path: "/playbook", availability: "planned" },
  { id: "strategy", path: "/strategy-kpis", availability: "partial", workspaceTab: "define" },
  { id: "tom", path: "/target-operating-model", availability: "partial", workspaceTab: "design" },
  { id: "initiatives", path: "/initiatives-roadmaps", availability: "planned" },
  { id: "governance", path: "/governance", availability: "partial", workspaceTab: "gates" },
  { id: "risks", path: "/risks-actions", availability: "planned" },
  { id: "benefits", path: "/benefits-finance", availability: "planned" },
  { id: "change", path: "/change-adoption", availability: "planned" },
  { id: "evidence", path: "/evidence-reports", availability: "partial", workspaceTab: "evidence" },
  { id: "bau", path: "/bau-improvement", availability: "planned" },
  { id: "admin", path: "/admin", availability: "available", requiresAny: ADMIN_PERMISSIONS },
];
