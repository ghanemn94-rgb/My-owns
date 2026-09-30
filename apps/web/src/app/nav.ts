// The fourteen primary navigation areas (master prompt §3, REQ-S03-007). In P1 only Transformations and
// Administration are working screens; the others are honest landing pages that state what the area will contain
// and that it is planned for a later stage.
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
  /** "available": working P1 screens; "planned": landing page only. */
  readonly availability: "available" | "partial" | "planned";
  /** Shown only to users holding any of these permissions (UI hint; the server still decides). */
  readonly requiresAny?: readonly Permission[];
}

export const NAV_AREAS: readonly NavArea[] = [
  { id: "myWork", path: "/my-work", availability: "partial" },
  { id: "executive", path: "/executive-overview", availability: "planned" },
  { id: "transformations", path: "/transformations", availability: "available" },
  { id: "playbook", path: "/playbook", availability: "planned" },
  { id: "strategy", path: "/strategy-kpis", availability: "planned" },
  { id: "tom", path: "/target-operating-model", availability: "planned" },
  { id: "initiatives", path: "/initiatives-roadmaps", availability: "planned" },
  { id: "governance", path: "/governance", availability: "planned" },
  { id: "risks", path: "/risks-actions", availability: "planned" },
  { id: "benefits", path: "/benefits-finance", availability: "planned" },
  { id: "change", path: "/change-adoption", availability: "planned" },
  { id: "evidence", path: "/evidence-reports", availability: "planned" },
  { id: "bau", path: "/bau-improvement", availability: "planned" },
  { id: "admin", path: "/admin", availability: "available", requiresAny: ADMIN_PERMISSIONS },
];
