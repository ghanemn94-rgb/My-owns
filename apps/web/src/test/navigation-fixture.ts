// The scripted API's default answer to GET /api/v1/me/navigation (T-DG5-FE-G2; D-163 option (a)). The shell shows the
// areas the SERVER returns (REQ-S03-007, ADR-0049 §9), so every unit test that renders the shell needs an answer. A test
// that does not script one gets this mirror of the server rule (apps/api/src/modules/identity/navigation.ts
// NAVIGATION_AREAS): an item is visible when the caller holds one of its permissions in any scope, or when it needs only
// a session; an area is visible when at least one of its items is. The API's own tests are authoritative; this mirror
// only keeps web tests realistic. SYNTHETIC: it reads the scripted GET /api/v1/me answer of the same test.
import type { Me } from "../api/types.ts";
import type { MeNavigation, MeNavigationArea } from "../app/me-navigation.ts";

type Access = "session" | readonly string[];
interface ItemDef {
  readonly code: string;
  readonly path: string;
  readonly access: Access;
}
const READ = ["transformation.read"] as const;
const readItems = (path: string, codes: readonly string[]): ItemDef[] =>
  codes.map((code) => ({ code, path, access: READ }));

/** [webId, path, items] in the ADR-0049 §9 order (M0100-M0113). */
const AREAS: readonly (readonly [string, string, readonly ItemDef[]])[] = [
  [
    "myWork",
    "/my-work",
    ["assignedActions", "drafts", "reviews", "approvals", "missingUpdates", "upcomingDeadlines"].map((code) => ({
      code,
      path: code === "approvals" ? "/my-work/approvals" : "/my-work",
      access: "session" as const,
    })),
  ],
  [
    "executive",
    "/executive-overview",
    readItems("/executive-overview", ["outcomes", "value", "criticalInitiatives", "adoption", "blockers", "decisions"]),
  ],
  ["transformations", "/transformations", readItems("/transformations", ["portfolio", "workspaces"])],
  [
    "playbook",
    "/playbook",
    [
      { code: "source", path: "/playbook/reader", access: "session" },
      { code: "guidance", path: "/playbook/phases", access: "session" },
      { code: "procedures", path: "/playbook/procedures", access: ["procedure.read"] },
    ],
  ],
  [
    "strategy",
    "/strategy-kpis",
    readItems("/strategy-kpis", ["outcomeTrees", "definitions", "targets", "actuals", "performanceReviews"]),
  ],
  [
    "tom",
    "/target-operating-model",
    readItems("/target-operating-model", ["canvas", "gaps", "capabilities", "processes", "designDecisions"]),
  ],
  [
    "initiatives",
    "/initiatives-roadmaps",
    readItems("/initiatives-roadmaps", ["cases", "prioritization", "waves", "resources", "milestones", "dependencies"]),
  ],
  [
    "governance",
    "/governance",
    readItems("/governance", ["forums", "meetings", "decisionRights", "raci", "approvals", "stageGates"]),
  ],
  ["risks", "/risks-actions", readItems("/risks-actions", ["raid", "correctiveActions", "escalations"])],
  [
    "benefits",
    "/benefits-finance",
    readItems("/benefits-finance", ["formulas", "realization", "validation", "forecasts"]),
  ],
  [
    "change",
    "/change-adoption",
    readItems("/change-adoption", ["stakeholders", "interventions", "adoptionIndicators"]),
  ],
  [
    "evidence",
    "/evidence-reports",
    [
      ...readItems("/evidence-reports", ["deliverables", "attachments", "snapshots"]),
      { code: "packs", path: "/evidence-reports/reports", access: READ },
    ],
  ],
  [
    "bau",
    "/bau-improvement",
    readItems("/bau-improvement", ["handovers", "controls", "lessons", "improvementBacklog"]),
  ],
  [
    "admin",
    "/admin",
    [
      {
        code: "methodology",
        path: "/admin/studio",
        access: ["methodology.publish", "methodology.review", "config_review_policy.configure"],
      },
      { code: "forms", path: "/admin/forms", access: ["methodology.publish"] },
      { code: "workflows", path: "/admin/procedures", access: ["methodology.publish"] },
      { code: "automation", path: "/admin/automation", access: ["automation.configure", "job.read"] },
      { code: "organization", path: "/admin/organizations", access: ["organization.manage", "business_unit.manage"] },
      { code: "access", path: "/admin/users", access: ["user.read", "user.manage", "access.read", "access.assign"] },
      { code: "branding", path: "/admin/branding", access: ["branding.configure"] },
      { code: "environment", path: "/admin/demo", access: ["demo.reset"] },
    ],
  ],
];

/** The navigation the server would return for this scripted `/me` answer. */
export function navigationForMe(me: Pick<Me, "effectivePermissions">): MeNavigation {
  const held = new Set<string>(me.effectivePermissions.flatMap((g) => g.permissions));
  const areas: MeNavigationArea[] = [];
  for (const [webId, path, defs] of AREAS) {
    const items = defs
      .filter((d) => d.access === "session" || d.access.some((p) => held.has(p)))
      .map((d) => ({
        code: d.code,
        labelKey: `nav.contents.${webId}.${d.code}`,
        path: d.path,
        availability: "working" as const,
      }));
    if (items.length > 0) areas.push({ code: webId, webId, labelKey: `nav.areas.${webId}.label`, path, items });
  }
  return { areas };
}
