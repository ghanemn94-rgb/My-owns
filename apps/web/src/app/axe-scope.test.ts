// T-DG6-FE-F2 (REQ-S15-012; ADR-0061 §7.2; p6-work-split §I/K.4): the axe scope cannot drift. Every route that
// apps/web/src/app/router.tsx registers in P6 must be listed in e2e/support/p6-axe-screens.ts (P6_AXE_ROUTES), which the
// QA-D axe spec scans in chromium-en and chromium-ar; and every entry of that list (and of the key flows) must name a
// route the router really registers, so a typo or a removed screen is caught too.
//  - "Registered in P6" = a path of the router's `routes` (flattened, with a leading "/") that the DG5-approved router
//    did not register. The DG5 set is frozen below: the literal `path:` entries of router.tsx at the DG5-approved source
//    commit 660f40c (D-193), which is a fixed historical fact; the generated routes (area landings, workspace sub-entries,
//    the empty planned-route seams) are DG4/DG5 routes and are recognised by their generator's inputs, read at runtime.
//  - The P6 planned-route seam (P6_PLANNED_ROUTES) counts as P6 too: a placeholder screen is still a screen to scan.
import { describe, expect, it } from "vitest";
import type { RouteObject } from "react-router";
import { KEY_FLOW_AXE_SCREENS, P6_AXE_ROUTES } from "../../../../e2e/support/p6-axe-screens.ts";
import { AREA_CONTENTS, NAV_AREAS, NAV_SUBPAGES } from "./nav.ts";
import { P4_PLANNED_ROUTES, P5_PLANNED_ROUTES, P6_PLANNED_ROUTES, routes } from "./router.tsx";

/** The literal `path:` entries of router.tsx at the DG5-approved source commit 660f40c (D-193), without "/". */
const DG5_LITERAL_PATHS: readonly string[] = [
  "*",
  "/",
  "/login",
  "about",
  "admin",
  "admin/approval-routes",
  "admin/assignments",
  "admin/automation",
  "admin/automation-rules/:ruleId/versions/:versionNo",
  "admin/automation/executions",
  "admin/automation/executions/:executionId",
  "admin/automation/failures",
  "admin/automation/rules/:ruleId",
  "admin/branding",
  "admin/business-units/:id",
  "admin/calendar",
  "admin/coverage",
  "admin/demo",
  "admin/forms",
  "admin/forms/:recordType",
  "admin/health-schemes",
  "admin/jobs",
  "admin/jobs/operations",
  "admin/jobs/operations/:jobCode",
  "admin/methodology-migrations",
  "admin/organizations",
  "admin/organizations/:id",
  "admin/procedures",
  "admin/procedures/:procedureCode",
  "admin/source-coverage",
  "admin/studio",
  "admin/studio/review-policies",
  "admin/studio/revision-proposals",
  "admin/studio/scoring-defaults",
  "admin/studio/versions/:versionId",
  "admin/studio/versions/:versionId/reviews/:reviewId",
  "admin/users",
  "admin/users/:id",
  "dashboards",
  "dashboards/:kind",
  "dashboards/rag-policy",
  "evidence-reports/evidence-register",
  "evidence-reports/exports",
  "evidence-reports/presentation",
  "evidence-reports/reports",
  "executive-overview",
  "finance-validation",
  "governance/groups",
  "governance/groups/:groupId",
  "initiatives-roadmaps/updates",
  "lessons",
  "me/notification-digests/:digestId",
  "my-work",
  "my-work/approvals",
  "my-work/approvals/:approvalId",
  "my-work/approvals/:approvalId/route",
  "my-work/delegations",
  "my-work/notification-preferences",
  "playbook/health-check",
  "playbook/launch-plan",
  "playbook/procedures",
  "playbook/procedures/:instanceId",
  "playbook/reader",
  "playbook/reader/:blockRef",
  "portfolios",
  "portfolios/:portfolioId",
  "transformations",
  "transformations/:id",
  "transformations/:id/action-register/:actionItemId",
  "transformations/:id/actions",
  "transformations/:id/adoption",
  "transformations/:id/adoption-indicators",
  "transformations/:id/adoption-interventions",
  "transformations/:id/adoption-interventions/:interventionId",
  "transformations/:id/adoption-training",
  "transformations/:id/approval-decisions",
  "transformations/:id/assessment-forms",
  "transformations/:id/assessment-forms/:formId",
  "transformations/:id/assessment-records/:recordId",
  "transformations/:id/bau",
  "transformations/:id/bau-controls",
  "transformations/:id/bau-handovers",
  "transformations/:id/bau-handovers/:handoverId",
  "transformations/:id/bau-reviews",
  "transformations/:id/benefit-formulas",
  "transformations/:id/benefit-formulas/:formulaId",
  "transformations/:id/benefit-formulas/:formulaId/preview",
  "transformations/:id/benefit-groups",
  "transformations/:id/benefit-measurements/:measurementId",
  "transformations/:id/benefit-overlaps",
  "transformations/:id/benefit-overlaps/:overlapId",
  "transformations/:id/benefit-scenarios",
  "transformations/:id/benefit-valuation-methods",
  "transformations/:id/benefits",
  "transformations/:id/benefits/:benefitId",
  "transformations/:id/business-cases",
  "transformations/:id/business-cases/:businessCaseId",
  "transformations/:id/capacity",
  "transformations/:id/change-requests",
  "transformations/:id/change-requests/:changeRequestId",
  "transformations/:id/charter",
  "transformations/:id/closure",
  "transformations/:id/config-pins",
  "transformations/:id/corrective-action-rules",
  "transformations/:id/corrective-actions",
  "transformations/:id/corrective-actions/:caseId",
  "transformations/:id/dashboard",
  "transformations/:id/data-quality",
  "transformations/:id/day-90-test",
  "transformations/:id/decision-rights",
  "transformations/:id/decisions",
  "transformations/:id/define",
  "transformations/:id/dependencies",
  "transformations/:id/design",
  "transformations/:id/diagnose",
  "transformations/:id/dispensations",
  "transformations/:id/edit",
  "transformations/:id/escalations",
  "transformations/:id/evidence",
  "transformations/:id/evidence-register",
  "transformations/:id/executive-decisions",
  "transformations/:id/executive-decisions/:decisionId",
  "transformations/:id/exports",
  "transformations/:id/finance-validations",
  "transformations/:id/finance-validations/:financeValidationId",
  "transformations/:id/financial-metrics",
  "transformations/:id/forums",
  "transformations/:id/forums/:forumId",
  "transformations/:id/gate-conditions",
  "transformations/:id/gates",
  "transformations/:id/gates/:gateCode",
  "transformations/:id/health-check",
  "transformations/:id/improvement",
  "transformations/:id/initiatives/:initiativeId",
  "transformations/:id/kpi-restatements/:restatementId",
  "transformations/:id/kpi-review",
  "transformations/:id/kpis",
  "transformations/:id/kpis/:kpiId",
  "transformations/:id/kpis/:kpiId/actuals",
  "transformations/:id/kpis/:kpiId/actuals/:actualId",
  "transformations/:id/kpis/:kpiId/restatements",
  "transformations/:id/launch-plan",
  "transformations/:id/lessons",
  "transformations/:id/meetings",
  "transformations/:id/meetings/:meetingId",
  "transformations/:id/meetings/:meetingId/cutoff-pack",
  "transformations/:id/meetings/:meetingId/presentation",
  "transformations/:id/methodology-migrations",
  "transformations/:id/methodology-migrations/:migrationId",
  "transformations/:id/modular-entry",
  "transformations/:id/owner-updates",
  "transformations/:id/performance-areas/:areaId",
  "transformations/:id/phases",
  "transformations/:id/portfolio",
  "transformations/:id/presentation",
  "transformations/:id/prioritization",
  "transformations/:id/raci",
  "transformations/:id/raid",
  "transformations/:id/raid-decision-log",
  "transformations/:id/readiness",
  "transformations/:id/reports",
  "transformations/:id/reports/:snapshotId",
  "transformations/:id/roadmap",
  "transformations/:id/role-mappings",
  "transformations/:id/team",
  "transformations/:id/traceability",
  "transformations/:id/transform-readiness",
  "transformations/:id/workstreams",
  "transformations/:id/workstreams/:workstreamId",
  "transformations/:id/workstreams/:workstreamId/dashboard",
  "transformations/new",
  "walkthrough",
];

/** "/a" + "b" -> "/a/b"; the root "/" and the catch-all "*" are kept as they are. */
function join(parent: string, path: string): string {
  if (path.startsWith("/")) return path;
  if (path === "*") return "*";
  return `${parent.replace(/\/$/, "")}/${path}`;
}

/** Every path the router registers, with a leading "/" (index routes take their parent's path). */
function flatten(list: readonly RouteObject[], parent = ""): string[] {
  return list.flatMap((r) => {
    const here = r.path === undefined ? parent || "/" : join(parent || "/", r.path);
    return [...(r.path !== undefined ? [here] : []), ...(r.children ? flatten(r.children, here) : [])];
  });
}

const registered = new Set(flatten(routes));
const normal = (p: string) => (p === "*" || p.startsWith("/") ? p : `/${p}`);
const dg5 = new Set<string>([
  ...DG5_LITERAL_PATHS.map(normal),
  // Generated DG4/DG5 routes (router.tsx landingRoutes, subEntryRoutes and the P4/P5 planned seams).
  ...NAV_AREAS.filter((a) => a.id in AREA_CONTENTS).map((a) => a.path),
  ...NAV_SUBPAGES.filter((s) => s.workspaceTab).map((s) => s.path),
  ...P4_PLANNED_ROUTES.map((r) => normal(r.path)),
  ...P5_PLANNED_ROUTES.map((r) => normal(r.path)),
]);
const p6Routes = [...registered].filter(
  (p) => (p !== "*" && !dg5.has(p)) || P6_PLANNED_ROUTES.some((r) => normal(r.path) === p),
);

describe("axe scope (ADR-0061 §7.2)", () => {
  it("finds the P6 routes of the router (the DG5 baseline is not empty and the router adds routes in P6)", () => {
    expect(DG5_LITERAL_PATHS.length).toBeGreaterThan(100);
    expect(registered.size).toBeGreaterThan(DG5_LITERAL_PATHS.length);
    expect(p6Routes.length).toBeGreaterThan(0);
    // Sanity: the DG5 key screens are still registered and are not counted as P6.
    for (const p of ["/my-work", "/executive-overview", "/walkthrough"]) {
      expect(registered.has(p), p).toBe(true);
      expect(p6Routes, p).not.toContain(p);
    }
  });

  it("lists every route added to router.tsx in P6 in e2e/support/p6-axe-screens.ts", () => {
    const listed = new Set(P6_AXE_ROUTES.map((s) => s.route));
    const missing = p6Routes.filter((p) => !listed.has(p)).sort();
    expect(missing, "add these routes to P6_AXE_ROUTES in e2e/support/p6-axe-screens.ts").toEqual([]);
  });

  it("names only routes the router registers, each once, with a name and a user", () => {
    const all = [...P6_AXE_ROUTES, ...KEY_FLOW_AXE_SCREENS];
    for (const s of all) {
      expect(registered.has(s.route), `${s.name}: ${s.route} is not a router route`).toBe(true);
      expect(s.name.trim().length, s.route).toBeGreaterThan(0);
      expect(s.signInAs.trim().length, s.route).toBeGreaterThan(0);
      if (s.detailOf !== undefined) expect(registered.has(s.detailOf), `${s.name}: detailOf ${s.detailOf}`).toBe(true);
    }
    expect(new Set(all.map((s) => s.name)).size, "unique evidence names").toBe(all.length);
    expect(new Set(P6_AXE_ROUTES.map((s) => s.route)).size, "each P6 route once").toBe(P6_AXE_ROUTES.length);
  });

  it("keeps P6_AXE_ROUTES to P6 routes (a DG1-DG5 screen belongs to the key flows or the P5 reflow spec)", () => {
    const notP6 = P6_AXE_ROUTES.filter((s) => !p6Routes.includes(s.route)).map((s) => s.route);
    expect(notP6).toEqual([]);
  });
});
