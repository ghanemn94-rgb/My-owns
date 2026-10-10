// Routes (React Router 7, data-router library mode; ADR-0009). Everything below the shell needs a session.
import { Navigate, createBrowserRouter, type RouteObject } from "react-router";
import { RequireSession } from "../auth/session.tsx";
import { AdminHomePage } from "../pages/admin/AdminHomePage.tsx";
import { AssignmentsPage } from "../pages/admin/AssignmentsPage.tsx";
import { BusinessUnitEditPage, OrganizationDetailPage, OrganizationsPage } from "../pages/admin/OrganizationsPage.tsx";
import { UserDetailPage, UsersPage } from "../pages/admin/UsersPage.tsx";
import { AboutPage, AreaEntryPage, AreaPlaceholderPage, NotFoundPage, P4BeingBuiltPage } from "../pages/AreaPages.tsx";
import { ApprovalDetailPage, ApprovalsPage } from "../pages/approvals/ApprovalsPage.tsx";
import { ApprovalRecordsPage } from "../pages/approvals/ApprovalRecordsPage.tsx";
import { CalendarPage } from "../pages/calendar/CalendarPage.tsx";
import { JobsPage } from "../pages/calendar/JobsPage.tsx";
import { DecisionRightsPage } from "../pages/decision-rights/DecisionRightsPage.tsx";
import { TransformReadinessPage } from "../pages/decision-rights/TransformReadinessPage.tsx";
import { DelegationsPage } from "../pages/delegations/DelegationsPage.tsx";
import { GroupDetailPage, GroupsPage } from "../pages/groups/GroupsPage.tsx";
import { RoleMappingsPage } from "../pages/groups/RoleMappingsPage.tsx";
import { DataQualityPage } from "../pages/kpi/DataQualityPage.tsx";
import { KpiActualPage, KpiReviewPage } from "../pages/kpi/KpiActualPage.tsx";
import { KpiPage } from "../pages/kpi/KpiPage.tsx";
import { KpisPage } from "../pages/kpi/KpisPage.tsx";
import { KpiUpdatePage } from "../pages/kpi/KpiUpdatePage.tsx";
import { BenefitPage } from "../pages/benefits/BenefitPage.tsx";
import { BenefitsPage } from "../pages/benefits/BenefitsPage.tsx";
import { MeasurementPage } from "../pages/benefits/MeasurementPage.tsx";
import {
  BenefitGroupsPage,
  BenefitOverlapPage,
  BenefitOverlapsPage,
  BenefitScenariosPage,
  ValuationMethodsPage,
} from "../pages/benefits/RegisterPages.tsx";
import {
  FinanceValidationDetailPage,
  FinanceValidationPage,
  TransformationFinanceQueuePage,
} from "../pages/finance-validation/FinanceValidationPages.tsx";
import { MyWorkPage } from "../pages/my-work/MyWorkPage.tsx";
import { ActionItemPage, ActionsPage } from "../pages/actions/ActionsPage.tsx";
import {
  EscalationsPage,
  ExecutiveDecisionPage,
  ExecutiveDecisionsPage,
} from "../pages/executive-decisions/ExecutiveDecisionsPage.tsx";
import { ForumPage, ForumsPage } from "../pages/forums/ForumsPage.tsx";
import { MeetingPage } from "../pages/meetings/MeetingPage.tsx";
import { MeetingsPage } from "../pages/meetings/MeetingsPage.tsx";
import { CorrectiveActionsPage, CorrectiveCasePage, CorrectiveRulesPage } from "../pages/raid/CorrectivePages.tsx";
import { RaidDecisionLogPage } from "../pages/raid/DecisionLogPage.tsx";
import { RaidPage } from "../pages/raid/RaidPage.tsx";
import { RaciPage } from "../pages/raci/RaciPage.tsx";
import { LoginPage } from "../pages/LoginPage.tsx";
import { BenefitFormulaPage } from "../pages/benefit-formulas/BenefitFormulaPage.tsx";
import { BenefitFormulasPage } from "../pages/benefit-formulas/BenefitFormulasPage.tsx";
import { BusinessCasePage } from "../pages/business-cases/BusinessCasePage.tsx";
import { BusinessCasesPage } from "../pages/business-cases/BusinessCasesPage.tsx";
import { CapacityPage } from "../pages/capacity/CapacityPage.tsx";
import { DecisionsPage } from "../pages/decisions/DecisionsPage.tsx";
import { CharterPage } from "../pages/define/CharterPage.tsx";
import { DefinePage } from "../pages/define/DefinePage.tsx";
import { DependenciesPage } from "../pages/dependencies/DependenciesPage.tsx";
import { DesignPage } from "../pages/design/DesignPage.tsx";
import { DiagnosePage } from "../pages/diagnose/DiagnosePage.tsx";
import { DispensationsPage } from "../pages/dispensations/DispensationsPage.tsx";
import { EvidencePage } from "../pages/evidence/EvidencePage.tsx";
import { GateDetailPage } from "../pages/gates/GateDetailPage.tsx";
import { GatesPage } from "../pages/gates/GatesPage.tsx";
import { InitiativePage } from "../pages/portfolio/InitiativePage.tsx";
import { PortfolioPage } from "../pages/portfolio/PortfolioPage.tsx";
import { PrioritizationPage } from "../pages/prioritization/PrioritizationPage.tsx";
import { ReadinessPage } from "../pages/readiness/ReadinessPage.tsx";
import { RoadmapPage } from "../pages/roadmap/RoadmapPage.tsx";
import { TeamPage } from "../pages/team/TeamPage.tsx";
import { TransformationCreatePage } from "../pages/transformations/TransformationCreatePage.tsx";
import { TransformationDetailPage } from "../pages/transformations/TransformationDetailPage.tsx";
import { TransformationEditPage } from "../pages/transformations/TransformationEditPage.tsx";
import { TransformationListPage } from "../pages/transformations/TransformationListPage.tsx";
import { NAV_AREAS, NAV_SUBPAGES } from "./nav.ts";
import { Shell } from "./Shell.tsx";

const placeholderRoutes: RouteObject[] = NAV_AREAS.filter((a) => a.availability === "planned").map((a) => ({
  path: a.path.slice(1),
  element: <AreaPlaceholderPage area={a.id} />,
}));

/** Areas whose P2 content lives in each transformation's workspace: the area page leads into that workspace tab. */
const entryRoutes: RouteObject[] = NAV_AREAS.filter((a) => a.workspaceTab).map((a) => ({
  path: a.path.slice(1),
  element: <AreaEntryPage area={a.id} tab={a.workspaceTab!} moreTabs={a.moreWorkspaceTabs ?? []} />,
}));

/** T-DG4-FE-D: area sub-entries that open one workspace tab of a chosen transformation (nav.ts NAV_SUBPAGES). */
const subEntryRoutes: RouteObject[] = NAV_SUBPAGES.filter((s) => s.workspaceTab).map((s) => ({
  path: s.path.slice(1),
  element: <AreaEntryPage area={s.area} tab={s.workspaceTab!} />,
}));

/**
 * The P4 routes of FE-B…FE-G (p4-plan §5.1), registered up front by T-DG4-FE-A (p4-plan §5.3). Each one shows the
 * `P4BeingBuiltPage` placeholder (`nav.p4.<feature>.*`) until its owning task replaces the element through an
 * orchestrator merge. The paths of work-item links written by the backend (`linkPath`) are among them, so a reminder
 * never leads to "page not found": `/transformations/:id/kpis/:kpiId/actuals/:actualId` (KBE-C) and
 * `/transformations/:id/benefit-overlaps/:overlapId` (KBE-D2).
 */
export const P4_PLANNED_ROUTES: readonly { path: string; feature: string; owner: string }[] = [
  // FE-B (slice A: KPI engine): built by T-DG4-FE-B, see the KPI routes below.
  // FE-C (slice B: benefits and Finance validation): built by T-DG4-FE-C, see the benefit routes below.
  // FE-D (slices E and D: RAID, actions, forums, meetings, T16): built by T-DG4-FE-D, see the routes below.
  // FE-E (slices F and G: adoption, BAU, improvement, lessons)
  { path: "transformations/:id/adoption", feature: "adoption", owner: "FE-E" },
  { path: "transformations/:id/bau", feature: "bau", owner: "FE-E" },
  { path: "transformations/:id/improvement", feature: "improvement", owner: "FE-E" },
  { path: "lessons", feature: "lessons", owner: "FE-E" },
  // FE-F (slice H: G5/G6 views live in pages/gates; change control and closure)
  { path: "transformations/:id/change-requests", feature: "changeRequests", owner: "FE-F" },
  { path: "transformations/:id/change-requests/:changeRequestId", feature: "changeRequest", owner: "FE-F" },
  { path: "transformations/:id/closure", feature: "closure", owner: "FE-F" },
  // FE-G (slices J and K: dashboards, traceability; Executive Overview is the planned area page until then)
  { path: "dashboards/:kind", feature: "dashboards", owner: "FE-G" },
  { path: "transformations/:id/traceability", feature: "traceability", owner: "FE-G" },
];

const p4PlannedRoutes: RouteObject[] = P4_PLANNED_ROUTES.map((r) => ({
  path: r.path,
  element: <P4BeingBuiltPage feature={r.feature} />,
}));

export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireSession>
        <Shell />
      </RequireSession>
    ),
    children: [
      { index: true, element: <Navigate to="/my-work" replace /> },
      { path: "my-work", element: <MyWorkPage /> },
      // P4 slices I and C (T-DG4-FE-A; p4-work-split §I+C.5).
      { path: "my-work/approvals", element: <ApprovalsPage /> },
      { path: "my-work/approvals/:approvalId", element: <ApprovalDetailPage /> },
      { path: "my-work/delegations", element: <DelegationsPage /> },
      { path: "admin/calendar", element: <CalendarPage /> },
      { path: "admin/jobs", element: <JobsPage /> },
      { path: "governance/groups", element: <GroupsPage /> },
      { path: "governance/groups/:groupId", element: <GroupDetailPage /> },
      { path: "transformations/:id/role-mappings", element: <RoleMappingsPage /> },
      { path: "transformations/:id/decision-rights", element: <DecisionRightsPage /> },
      { path: "transformations/:id/raci", element: <RaciPage /> },
      { path: "transformations/:id/transform-readiness", element: <TransformReadinessPage /> },
      { path: "transformations/:id/approval-decisions", element: <ApprovalRecordsPage /> },
      // P4 slice A: the KPI engine screens (T-DG4-FE-B; p4-work-split §A.5). The actual's path is KBE-C's work-item link.
      { path: "transformations/:id/kpis", element: <KpisPage /> },
      { path: "transformations/:id/kpis/:kpiId", element: <KpiPage /> },
      { path: "transformations/:id/kpis/:kpiId/actuals", element: <KpiUpdatePage /> },
      { path: "transformations/:id/kpis/:kpiId/actuals/:actualId", element: <KpiActualPage /> },
      { path: "transformations/:id/kpi-review", element: <KpiReviewPage /> },
      { path: "transformations/:id/data-quality", element: <DataQualityPage /> },
      // P4 slice B: benefits and Finance validation (T-DG4-FE-C; p4-work-split §B.5). The overlap path is KBE-D2's and
      // the Finance validation path KBE-E's work-item link.
      { path: "transformations/:id/benefits", element: <BenefitsPage /> },
      { path: "transformations/:id/benefits/:benefitId", element: <BenefitPage /> },
      { path: "transformations/:id/benefit-measurements/:measurementId", element: <MeasurementPage /> },
      { path: "transformations/:id/benefit-groups", element: <BenefitGroupsPage /> },
      { path: "transformations/:id/benefit-overlaps", element: <BenefitOverlapsPage /> },
      { path: "transformations/:id/benefit-overlaps/:overlapId", element: <BenefitOverlapPage /> },
      { path: "transformations/:id/benefit-scenarios", element: <BenefitScenariosPage /> },
      { path: "transformations/:id/benefit-valuation-methods", element: <ValuationMethodsPage /> },
      // P4 slices E and D: RAID, actions, corrective actions, forums, meetings, T16 (T-DG4-FE-D; p4-work-split §E.5,
      // §D.5). The action-register, corrective-action, meeting and executive-decision detail paths are the backend's
      // work-item links (raid_action_due, corrective_case_follow_up, minutes_to_approve, meeting_action_due,
      // executive_decision_due), so a reminder never leads to "page not found".
      { path: "transformations/:id/raid", element: <RaidPage /> },
      { path: "transformations/:id/raid-decision-log", element: <RaidDecisionLogPage /> },
      { path: "transformations/:id/actions", element: <ActionsPage /> },
      { path: "transformations/:id/action-register/:actionItemId", element: <ActionItemPage /> },
      { path: "transformations/:id/corrective-actions", element: <CorrectiveActionsPage /> },
      { path: "transformations/:id/corrective-actions/:caseId", element: <CorrectiveCasePage /> },
      { path: "transformations/:id/corrective-action-rules", element: <CorrectiveRulesPage /> },
      { path: "transformations/:id/forums", element: <ForumsPage /> },
      { path: "transformations/:id/forums/:forumId", element: <ForumPage /> },
      { path: "transformations/:id/meetings", element: <MeetingsPage /> },
      { path: "transformations/:id/meetings/:meetingId", element: <MeetingPage /> },
      { path: "transformations/:id/executive-decisions", element: <ExecutiveDecisionsPage /> },
      { path: "transformations/:id/executive-decisions/:decisionId", element: <ExecutiveDecisionPage /> },
      { path: "transformations/:id/escalations", element: <EscalationsPage /> },
      { path: "transformations/:id/finance-validations", element: <TransformationFinanceQueuePage /> },
      {
        path: "transformations/:id/finance-validations/:financeValidationId",
        element: <FinanceValidationDetailPage />,
      },
      { path: "finance-validation", element: <FinanceValidationPage /> },
      { path: "transformations", element: <TransformationListPage /> },
      { path: "transformations/new", element: <TransformationCreatePage /> },
      { path: "transformations/:id", element: <TransformationDetailPage /> },
      { path: "transformations/:id/edit", element: <TransformationEditPage /> },
      { path: "transformations/:id/diagnose", element: <DiagnosePage /> },
      { path: "transformations/:id/charter", element: <CharterPage /> },
      { path: "transformations/:id/define", element: <DefinePage /> },
      { path: "transformations/:id/design", element: <DesignPage /> },
      { path: "transformations/:id/decisions", element: <DecisionsPage /> },
      { path: "transformations/:id/gates", element: <GatesPage /> },
      { path: "transformations/:id/gates/:gateCode", element: <GateDetailPage /> },
      { path: "transformations/:id/evidence", element: <EvidencePage /> },
      { path: "transformations/:id/team", element: <TeamPage /> },
      // P3 (DG3) routes; each page file and export is fixed, its FE task owns it (p3-work-split §4).
      { path: "transformations/:id/portfolio", element: <PortfolioPage /> },
      { path: "transformations/:id/initiatives/:initiativeId", element: <InitiativePage /> },
      { path: "transformations/:id/readiness", element: <ReadinessPage /> },
      { path: "transformations/:id/dispensations", element: <DispensationsPage /> },
      { path: "transformations/:id/prioritization", element: <PrioritizationPage /> },
      { path: "transformations/:id/roadmap", element: <RoadmapPage /> },
      { path: "transformations/:id/dependencies", element: <DependenciesPage /> },
      { path: "transformations/:id/capacity", element: <CapacityPage /> },
      { path: "transformations/:id/business-cases", element: <BusinessCasesPage /> },
      { path: "transformations/:id/business-cases/:businessCaseId", element: <BusinessCasePage /> },
      { path: "transformations/:id/benefit-formulas", element: <BenefitFormulasPage /> },
      { path: "transformations/:id/benefit-formulas/:formulaId", element: <BenefitFormulaPage /> },
      { path: "admin", element: <AdminHomePage /> },
      { path: "admin/organizations", element: <OrganizationsPage /> },
      { path: "admin/organizations/:id", element: <OrganizationDetailPage /> },
      { path: "admin/business-units/:id", element: <BusinessUnitEditPage /> },
      { path: "admin/users", element: <UsersPage /> },
      { path: "admin/users/:id", element: <UserDetailPage /> },
      { path: "admin/assignments", element: <AssignmentsPage /> },
      { path: "about", element: <AboutPage /> },
      ...p4PlannedRoutes,
      ...entryRoutes,
      ...subEntryRoutes,
      ...placeholderRoutes,
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
