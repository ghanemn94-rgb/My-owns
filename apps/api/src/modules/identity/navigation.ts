// GET /api/v1/me/navigation (getMyNavigation; ADR-0049 §9; REQ-S03-007; T-DG5-BE-R2, p5-work-split §I.4).
//
// The fourteen primary navigation areas of master prompt §3 (M0100-M0113), in their order, each with its §3 contents,
// as DATA (NAVIGATION_AREAS below). Visibility comes from the caller's held permissions: an item is visible when the
// caller holds one of its permissions in at least one scope (`holdsAnywhere`), or when it needs only a session; an area
// is visible when at least one of its items is. Hidden areas and items are OMITTED by the server, never sent with a
// flag. The answer is the same for every scope of one user (no transformation parameter): scoped hiding inside an area
// stays with each screen's own read checks.
//
// Labels are i18n keys of the web catalogue `apps/web/src/i18n/{en,ar}/nav.json`, translated at render time:
// `nav.areas.<webId>.label` for an area and `nav.contents.<webId>.<code>` for an item.
//
// `availability` is `planned` only while the P5 screen an item opens is not delivered (F-DG4-160): DELIVERED_P5_SCREENS
// is the list the FE tasks update in the same change that delivers a screen. Reading navigation approves nothing; it
// is not a business approval and it names no engineering delivery gate.
import type { Permission } from "@mth/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { holdsAnywhere, principalOf, type Principal } from "../access/index.ts";
import { parseQuery, type ModuleDeps } from "../platform/index.ts";

const ROUTE = "/api/v1/me/navigation";

export type NavigationAreaCode =
  | "my_work"
  | "executive_overview"
  | "transformations"
  | "playbook_procedures"
  | "strategy_kpis"
  | "target_operating_model"
  | "initiatives_roadmaps"
  | "governance"
  | "risks_actions"
  | "benefits_finance"
  | "change_adoption"
  | "evidence_reports"
  | "bau_improvement"
  | "administration";

/**
 * The P5 screens (the web's P5_SUBPAGES ids, `apps/web/src/app/nav.ts`) that a navigation item opens. An item that
 * opens one of these is `planned` until the screen is in DELIVERED_P5_SCREENS.
 */
export type P5Screen =
  | "reader"
  | "myProcedures"
  | "reports"
  | "studio"
  | "formBuilder"
  | "procedureBuilder"
  | "automation"
  | "branding"
  | "demo";

/**
 * The delivered P5 screens. FE tasks add their screen here in the same change that replaces its "not available yet"
 * placeholder (F-DG4-160). At this release every P5 screen a navigation item opens is delivered: FE-B's Playbook Studio
 * (`/admin/studio`), FE-C's form builder (`/admin/forms`), FE-D's procedure builder, my procedures and automation
 * (`/admin/procedures`, `/playbook/procedures`, `/admin/automation`), FE-E's reports (`/evidence-reports/reports`), and
 * FE-G's playbook reader, Branding Settings and environment screen (`/playbook/reader`, `/admin/branding`,
 * `/admin/demo`; T-DG5-FE-G, which also added the screens of FE-C to FE-E that had not been listed here).
 */
export const DELIVERED_P5_SCREENS: ReadonlySet<P5Screen> = new Set<P5Screen>([
  "studio",
  "formBuilder",
  "procedureBuilder",
  "myProcedures",
  "automation",
  "reports",
  "reader",
  "branding",
  "demo",
]);

/**
 * The P6 Administration screens (D-198; the web's P6_SUBPAGES ids, `apps/web/src/app/nav.ts`). Each is the web's
 * "not available yet" placeholder until T-DG6-FE-B replaces it, so an item that opens one is `planned` until the
 * screen joins DELIVERED_P6_SCREENS (F-DG4-160: the FE task adds it in the same change that ships the screen).
 */
export type P6Screen =
  | "audit"
  | "security"
  | "sensitiveGrants"
  | "operations"
  | "identity"
  | "storage"
  | "notifications";

/** The delivered P6 screens: none yet at this release (FE-B adds each one with its screen). */
export const DELIVERED_P6_SCREENS: ReadonlySet<P6Screen> = new Set<P6Screen>([]);

/** "session": every signed-in user; otherwise the caller must hold ANY of the codes in at least one scope. */
export type ItemAccess = "session" | readonly Permission[];

export interface NavigationItemDefinition {
  readonly code: string;
  readonly path: string;
  readonly access: ItemAccess;
  /** The P5 screen this item opens, when it is one (decides `availability`). */
  readonly screen?: P5Screen;
  /** The P6 screen this item opens, when it is one (decides `availability`; D-198). */
  readonly p6Screen?: P6Screen;
}

export interface NavigationAreaDefinition {
  readonly code: NavigationAreaCode;
  /** The web's area id (`AreaId` of apps/web/src/app/nav.ts). */
  readonly webId: string;
  readonly path: string;
  readonly items: readonly NavigationItemDefinition[];
}

const READ: readonly Permission[] = ["transformation.read"];

/** Items of an area whose contents all need `transformation.read` and open the area's own landing page. */
const readItems = (path: string, codes: readonly string[]): NavigationItemDefinition[] =>
  codes.map((code) => ({ code, path, access: READ }));

/** The ADR-0049 §9 table (M0100-M0113), in order. */
export const NAVIGATION_AREAS: readonly NavigationAreaDefinition[] = [
  // M0100: assigned actions, drafts, reviews, approvals, missing updates and upcoming deadlines (every signed-in user).
  {
    code: "my_work",
    webId: "myWork",
    path: "/my-work",
    items: [
      { code: "assignedActions", path: "/my-work", access: "session" },
      { code: "drafts", path: "/my-work", access: "session" },
      { code: "reviews", path: "/my-work", access: "session" },
      { code: "approvals", path: "/my-work/approvals", access: "session" },
      { code: "missingUpdates", path: "/my-work", access: "session" },
      { code: "upcomingDeadlines", path: "/my-work", access: "session" },
    ],
  },
  // M0101: outcomes, value, critical initiatives, adoption, blockers and decisions.
  {
    code: "executive_overview",
    webId: "executive",
    path: "/executive-overview",
    items: readItems("/executive-overview", [
      "outcomes",
      "value",
      "criticalInitiatives",
      "adoption",
      "blockers",
      "decisions",
    ]),
  },
  // M0102: portfolio and individual transformation workspaces.
  {
    code: "transformations",
    webId: "transformations",
    path: "/transformations",
    items: readItems("/transformations", ["portfolio", "workspaces"]),
  },
  // M0103: searchable source, guidance and executable procedures.
  {
    code: "playbook_procedures",
    webId: "playbook",
    path: "/playbook",
    items: [
      { code: "source", path: "/playbook/reader", access: "session", screen: "reader" },
      { code: "guidance", path: "/playbook/phases", access: "session" },
      { code: "procedures", path: "/playbook/procedures", access: ["procedure.read"], screen: "myProcedures" },
    ],
  },
  // M0104: outcome trees, definitions, targets, actuals and performance reviews.
  {
    code: "strategy_kpis",
    webId: "strategy",
    path: "/strategy-kpis",
    items: readItems("/strategy-kpis", ["outcomeTrees", "definitions", "targets", "actuals", "performanceReviews"]),
  },
  // M0105: canvas, gaps, capabilities, processes and design decisions.
  {
    code: "target_operating_model",
    webId: "tom",
    path: "/target-operating-model",
    items: readItems("/target-operating-model", ["canvas", "gaps", "capabilities", "processes", "designDecisions"]),
  },
  // M0106: cases, prioritization, waves, resources, milestones and dependencies.
  {
    code: "initiatives_roadmaps",
    webId: "initiatives",
    path: "/initiatives-roadmaps",
    items: readItems("/initiatives-roadmaps", [
      "cases",
      "prioritization",
      "waves",
      "resources",
      "milestones",
      "dependencies",
    ]),
  },
  // M0107: forums, meetings, decision rights, RACI, approvals and stage gates.
  {
    code: "governance",
    webId: "governance",
    path: "/governance",
    items: readItems("/governance", ["forums", "meetings", "decisionRights", "raci", "approvals", "stageGates"]),
  },
  // M0108: integrated RAID, corrective actions and escalations.
  {
    code: "risks_actions",
    webId: "risks",
    path: "/risks-actions",
    items: readItems("/risks-actions", ["raid", "correctiveActions", "escalations"]),
  },
  // M0109: formulas, realization, validation and forecasts.
  {
    code: "benefits_finance",
    webId: "benefits",
    path: "/benefits-finance",
    items: readItems("/benefits-finance", ["formulas", "realization", "validation", "forecasts"]),
  },
  // M0110: stakeholders, interventions and adoption indicators.
  {
    code: "change_adoption",
    webId: "change",
    path: "/change-adoption",
    items: readItems("/change-adoption", ["stakeholders", "interventions", "adoptionIndicators"]),
  },
  // M0111: native deliverables, attachments, snapshots and generated packs (the packs are FE-E's P5 report screens).
  {
    code: "evidence_reports",
    webId: "evidence",
    path: "/evidence-reports",
    items: [
      ...readItems("/evidence-reports", ["deliverables", "attachments", "snapshots"]),
      { code: "packs", path: "/evidence-reports/reports", access: READ, screen: "reports" },
    ],
  },
  // M0112: handovers, controls, lessons and improvement backlog.
  {
    code: "bau_improvement",
    webId: "bau",
    path: "/bau-improvement",
    items: readItems("/bau-improvement", ["handovers", "controls", "lessons", "improvementBacklog"]),
  },
  // M0113: methodology, forms, workflows, automation, organization, access and branding; plus the environment
  // (ADR-0049 §9 row 14).
  {
    code: "administration",
    webId: "admin",
    path: "/admin",
    items: [
      {
        code: "methodology",
        path: "/admin/studio",
        access: ["methodology.publish", "methodology.review", "config_review_policy.configure"],
        screen: "studio",
      },
      { code: "forms", path: "/admin/forms", access: ["methodology.publish"], screen: "formBuilder" },
      { code: "workflows", path: "/admin/procedures", access: ["methodology.publish"], screen: "procedureBuilder" },
      {
        code: "automation",
        path: "/admin/automation",
        access: ["automation.configure", "job.read"],
        screen: "automation",
      },
      { code: "organization", path: "/admin/organizations", access: ["organization.manage", "business_unit.manage"] },
      { code: "access", path: "/admin/users", access: ["user.read", "user.manage", "access.read", "access.assign"] },
      { code: "branding", path: "/admin/branding", access: ["branding.configure"], screen: "branding" },
      { code: "environment", path: "/admin/demo", access: ["demo.reset"], screen: "demo" },
      // P6 (D-198; T-DG6-BE-B2): the Administration items of slices E, F, J and C, labelled nav.contents.admin.<code>.
      { code: "audit", path: "/admin/audit", access: ["audit_event.read"], p6Screen: "audit" },
      {
        code: "security",
        path: "/admin/security",
        access: ["security.read", "upload_policy.configure"],
        p6Screen: "security",
      },
      {
        code: "sensitiveGrants",
        path: "/admin/sensitive-grants",
        access: ["sensitive_record.read", "sensitive_record.grant"],
        p6Screen: "sensitiveGrants",
      },
      {
        code: "operations",
        path: "/admin/operations",
        access: ["operations.read", "service_identity.configure"],
        p6Screen: "operations",
      },
      { code: "identity", path: "/admin/identity", access: ["identity.read"], p6Screen: "identity" },
      { code: "storage", path: "/admin/storage", access: ["storage.configure"], p6Screen: "storage" },
      {
        code: "notifications",
        path: "/admin/notification-channels",
        access: ["notification_channel.configure"],
        p6Screen: "notifications",
      },
    ],
  },
];

export interface NavigationItem {
  readonly code: string;
  readonly labelKey: string;
  readonly path: string;
  readonly availability: "working" | "planned";
}

export interface NavigationArea {
  readonly code: NavigationAreaCode;
  readonly webId: string;
  readonly labelKey: string;
  readonly path: string;
  readonly items: readonly NavigationItem[];
}

export interface Navigation {
  readonly areas: readonly NavigationArea[];
}

/** The i18n key of an area's label (nav.json). */
export const areaLabelKey = (area: NavigationAreaDefinition): string => `nav.areas.${area.webId}.label`;
/** The i18n key of an item's label (nav.json). */
export const itemLabelKey = (area: NavigationAreaDefinition, item: NavigationItemDefinition): string =>
  `nav.contents.${area.webId}.${item.code}`;

function visible(principal: Principal, access: ItemAccess): boolean {
  if (access === "session") return true;
  return access.some((permission) => holdsAnywhere(principal, permission));
}

/** The caller's navigation: only the visible areas and items, in the §9 order. */
export function navigationFor(
  principal: Principal,
  delivered: ReadonlySet<P5Screen> = DELIVERED_P5_SCREENS,
  deliveredP6: ReadonlySet<P6Screen> = DELIVERED_P6_SCREENS,
): Navigation {
  const areas: NavigationArea[] = [];
  for (const area of NAVIGATION_AREAS) {
    const items: NavigationItem[] = [];
    for (const item of area.items) {
      if (!visible(principal, item.access)) continue;
      items.push({
        code: item.code,
        labelKey: itemLabelKey(area, item),
        path: item.path,
        availability:
          (item.screen === undefined || delivered.has(item.screen)) &&
          (item.p6Screen === undefined || deliveredP6.has(item.p6Screen))
            ? "working"
            : "planned",
      });
    }
    if (items.length === 0) continue;
    areas.push({ code: area.code, webId: area.webId, labelKey: areaLabelKey(area), path: area.path, items });
  }
  return { areas };
}

const noQuery = z.strictObject({});

/** Registers GET /me/navigation (session: every signed-in user) and returns it as "METHOD /path". */
export function registerNavigationRoutes(app: FastifyInstance, _deps: ModuleDeps): string[] {
  app.get(ROUTE, { config: { access: { permission: "authenticated" } } }, async (request) => {
    parseQuery(noQuery, request.query);
    return navigationFor(principalOf(request));
  });
  return [`GET ${ROUTE}`];
}
