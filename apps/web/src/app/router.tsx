// Routes (React Router 7, data-router library mode; ADR-0009). Everything below the shell needs a session.
import { lazy, Suspense, useState, type ComponentType } from "react";
import { Navigate, createBrowserRouter, matchRoutes, type RouteObject } from "react-router";
import { RequireSession } from "../auth/session.tsx";
import { RouteLoadFailed, RouteLoadingFallback } from "../components/RouteFallback.tsx";
import { LoginPage } from "../pages/LoginPage.tsx";
import { NAV_AREAS, NAV_SUBPAGES } from "./nav.ts";
import { Shell } from "./Shell.tsx";

/**
 * T-DG4-FE-R2 (D-111): route-level code splitting. Every page of the shell is loaded on first use with React.lazy and
 * a dynamic import(), so a page load no longer parses every screen of the product. The chunks are emitted by Vite and
 * served by the app itself (no CDN, no remote loading). The shell, the session guard (RequireSession), the sign-in page
 * and the redirects stay eager. While a chunk loads, the ONE shared fallback (components/RouteFallback.tsx) shows a
 * translated status; a chunk that fails to load shows an error with a reload.
 *
 * Each page keeps its own name in this file and its own route element (`element: <Page />`): the route tree and the
 * props are unchanged. `load()` resolves to the page component itself (from its fixed file and export), for the seam
 * tests and for preloading.
 */
export type LazyPage<P extends object> = ComponentType<P> & { load: () => Promise<ComponentType<P>> };

export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>): LazyPage<P> {
  // One load per page (shared by the render and by preloadRoute); a failed load may be tried again.
  let pending: Promise<ComponentType<P>> | undefined;
  let resolved: ComponentType<P> | undefined;
  const once = () =>
    (pending ??= load().then(
      (Page) => (resolved = Page),
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    ));
  const Lazy = lazy(() =>
    once().then(
      (Page) => ({ default: Page }),
      // A chunk that cannot be fetched: an error with a reload in the page's place, never a blank main area.
      () => ({ default: RouteLoadFailed as ComponentType<P> }),
    ),
  );
  function RoutePage(props: P) {
    // Decided once per mount, so the tree never changes shape under a mounted page: a page whose chunk is already
    // loaded (preloaded, or visited before) renders at once, without a fallback flash.
    const [Page] = useState<ComponentType<P>>(() => resolved ?? Lazy);
    return (
      <Suspense fallback={<RouteLoadingFallback />}>
        <Page {...props} />
      </Suspense>
    );
  }
  return Object.assign(RoutePage, { load: once });
}

const AdminHomePage = lazyPage(() => import("../pages/admin/AdminHomePage.tsx").then((m) => m.AdminHomePage));
const AssignmentsPage = lazyPage(() => import("../pages/admin/AssignmentsPage.tsx").then((m) => m.AssignmentsPage));
const BusinessUnitEditPage = lazyPage(() =>
  import("../pages/admin/OrganizationsPage.tsx").then((m) => m.BusinessUnitEditPage),
);
const OrganizationDetailPage = lazyPage(() =>
  import("../pages/admin/OrganizationsPage.tsx").then((m) => m.OrganizationDetailPage),
);
const OrganizationsPage = lazyPage(() =>
  import("../pages/admin/OrganizationsPage.tsx").then((m) => m.OrganizationsPage),
);
const UserDetailPage = lazyPage(() => import("../pages/admin/UsersPage.tsx").then((m) => m.UserDetailPage));
const UsersPage = lazyPage(() => import("../pages/admin/UsersPage.tsx").then((m) => m.UsersPage));
const AboutPage = lazyPage(() => import("../pages/AreaPages.tsx").then((m) => m.AboutPage));
const AreaEntryPage = lazyPage(() => import("../pages/AreaPages.tsx").then((m) => m.AreaEntryPage));
const AreaPlaceholderPage = lazyPage(() => import("../pages/AreaPages.tsx").then((m) => m.AreaPlaceholderPage));
const NotFoundPage = lazyPage(() => import("../pages/AreaPages.tsx").then((m) => m.NotFoundPage));
const P4BeingBuiltPage = lazyPage(() => import("../pages/AreaPages.tsx").then((m) => m.P4BeingBuiltPage));
const ApprovalDetailPage = lazyPage(() =>
  import("../pages/approvals/ApprovalsPage.tsx").then((m) => m.ApprovalDetailPage),
);
const ApprovalsPage = lazyPage(() => import("../pages/approvals/ApprovalsPage.tsx").then((m) => m.ApprovalsPage));
const ApprovalRecordsPage = lazyPage(() =>
  import("../pages/approvals/ApprovalRecordsPage.tsx").then((m) => m.ApprovalRecordsPage),
);
const CalendarPage = lazyPage(() => import("../pages/calendar/CalendarPage.tsx").then((m) => m.CalendarPage));
const JobsPage = lazyPage(() => import("../pages/calendar/JobsPage.tsx").then((m) => m.JobsPage));
const DecisionRightsPage = lazyPage(() =>
  import("../pages/decision-rights/DecisionRightsPage.tsx").then((m) => m.DecisionRightsPage),
);
const TransformReadinessPage = lazyPage(() =>
  import("../pages/decision-rights/TransformReadinessPage.tsx").then((m) => m.TransformReadinessPage),
);
const DelegationsPage = lazyPage(() =>
  import("../pages/delegations/DelegationsPage.tsx").then((m) => m.DelegationsPage),
);
const GroupDetailPage = lazyPage(() => import("../pages/groups/GroupsPage.tsx").then((m) => m.GroupDetailPage));
const GroupsPage = lazyPage(() => import("../pages/groups/GroupsPage.tsx").then((m) => m.GroupsPage));
const RoleMappingsPage = lazyPage(() => import("../pages/groups/RoleMappingsPage.tsx").then((m) => m.RoleMappingsPage));
const DataQualityPage = lazyPage(() => import("../pages/kpi/DataQualityPage.tsx").then((m) => m.DataQualityPage));
const KpiActualPage = lazyPage(() => import("../pages/kpi/KpiActualPage.tsx").then((m) => m.KpiActualPage));
const KpiReviewPage = lazyPage(() => import("../pages/kpi/KpiActualPage.tsx").then((m) => m.KpiReviewPage));
const KpiPage = lazyPage(() => import("../pages/kpi/KpiPage.tsx").then((m) => m.KpiPage));
const KpisPage = lazyPage(() => import("../pages/kpi/KpisPage.tsx").then((m) => m.KpisPage));
const KpiUpdatePage = lazyPage(() => import("../pages/kpi/KpiUpdatePage.tsx").then((m) => m.KpiUpdatePage));
const BenefitPage = lazyPage(() => import("../pages/benefits/BenefitPage.tsx").then((m) => m.BenefitPage));
const BenefitsPage = lazyPage(() => import("../pages/benefits/BenefitsPage.tsx").then((m) => m.BenefitsPage));
const MeasurementPage = lazyPage(() => import("../pages/benefits/MeasurementPage.tsx").then((m) => m.MeasurementPage));
const BenefitGroupsPage = lazyPage(() =>
  import("../pages/benefits/RegisterPages.tsx").then((m) => m.BenefitGroupsPage),
);
const BenefitOverlapPage = lazyPage(() =>
  import("../pages/benefits/RegisterPages.tsx").then((m) => m.BenefitOverlapPage),
);
const BenefitOverlapsPage = lazyPage(() =>
  import("../pages/benefits/RegisterPages.tsx").then((m) => m.BenefitOverlapsPage),
);
const BenefitScenariosPage = lazyPage(() =>
  import("../pages/benefits/RegisterPages.tsx").then((m) => m.BenefitScenariosPage),
);
const ValuationMethodsPage = lazyPage(() =>
  import("../pages/benefits/RegisterPages.tsx").then((m) => m.ValuationMethodsPage),
);
const FinanceValidationDetailPage = lazyPage(() =>
  import("../pages/finance-validation/FinanceValidationPages.tsx").then((m) => m.FinanceValidationDetailPage),
);
const FinanceValidationPage = lazyPage(() =>
  import("../pages/finance-validation/FinanceValidationPages.tsx").then((m) => m.FinanceValidationPage),
);
const TransformationFinanceQueuePage = lazyPage(() =>
  import("../pages/finance-validation/FinanceValidationPages.tsx").then((m) => m.TransformationFinanceQueuePage),
);
const MyWorkPage = lazyPage(() => import("../pages/my-work/MyWorkPage.tsx").then((m) => m.MyWorkPage));
const DashboardPage = lazyPage(() => import("../pages/dashboards/DashboardsPage.tsx").then((m) => m.DashboardPage));
const DashboardsHubPage = lazyPage(() =>
  import("../pages/dashboards/DashboardsPage.tsx").then((m) => m.DashboardsHubPage),
);
const TransformationDashboardPage = lazyPage(() =>
  import("../pages/dashboards/TransformationDashboardPage.tsx").then((m) => m.TransformationDashboardPage),
);
const WorkstreamDashboardPage = lazyPage(() =>
  import("../pages/dashboards/TransformationDashboardPage.tsx").then((m) => m.WorkstreamDashboardPage),
);
const ExecutiveOverviewPage = lazyPage(() =>
  import("../pages/executive-overview/ExecutiveOverviewPage.tsx").then((m) => m.ExecutiveOverviewPage),
);
const RagPolicyPage = lazyPage(() => import("../pages/dashboards/RagPolicyPage.tsx").then((m) => m.RagPolicyPage));
const TraceabilityPage = lazyPage(() =>
  import("../pages/traceability/TraceabilityPage.tsx").then((m) => m.TraceabilityPage),
);
const ModularEntryPage = lazyPage(() =>
  import("../pages/traceability/ModularPage.tsx").then((m) => m.ModularEntryPage),
);
const PortfolioDetailPage = lazyPage(() =>
  import("../pages/traceability/StructurePages.tsx").then((m) => m.PortfolioDetailPage),
);
const PortfoliosPage = lazyPage(() => import("../pages/traceability/StructurePages.tsx").then((m) => m.PortfoliosPage));
const WorkstreamPage = lazyPage(() => import("../pages/traceability/StructurePages.tsx").then((m) => m.WorkstreamPage));
const WorkstreamsPage = lazyPage(() =>
  import("../pages/traceability/StructurePages.tsx").then((m) => m.WorkstreamsPage),
);
const ActionItemPage = lazyPage(() => import("../pages/actions/ActionsPage.tsx").then((m) => m.ActionItemPage));
const ActionsPage = lazyPage(() => import("../pages/actions/ActionsPage.tsx").then((m) => m.ActionsPage));
const EscalationsPage = lazyPage(() =>
  import("../pages/executive-decisions/ExecutiveDecisionsPage.tsx").then((m) => m.EscalationsPage),
);
const ExecutiveDecisionPage = lazyPage(() =>
  import("../pages/executive-decisions/ExecutiveDecisionsPage.tsx").then((m) => m.ExecutiveDecisionPage),
);
const ExecutiveDecisionsPage = lazyPage(() =>
  import("../pages/executive-decisions/ExecutiveDecisionsPage.tsx").then((m) => m.ExecutiveDecisionsPage),
);
const ForumPage = lazyPage(() => import("../pages/forums/ForumsPage.tsx").then((m) => m.ForumPage));
const ForumsPage = lazyPage(() => import("../pages/forums/ForumsPage.tsx").then((m) => m.ForumsPage));
const MeetingPage = lazyPage(() => import("../pages/meetings/MeetingPage.tsx").then((m) => m.MeetingPage));
const MeetingsPage = lazyPage(() => import("../pages/meetings/MeetingsPage.tsx").then((m) => m.MeetingsPage));
const CorrectiveActionsPage = lazyPage(() =>
  import("../pages/raid/CorrectivePages.tsx").then((m) => m.CorrectiveActionsPage),
);
const CorrectiveCasePage = lazyPage(() =>
  import("../pages/raid/CorrectivePages.tsx").then((m) => m.CorrectiveCasePage),
);
const CorrectiveRulesPage = lazyPage(() =>
  import("../pages/raid/CorrectivePages.tsx").then((m) => m.CorrectiveRulesPage),
);
const RaidDecisionLogPage = lazyPage(() =>
  import("../pages/raid/DecisionLogPage.tsx").then((m) => m.RaidDecisionLogPage),
);
const RaidPage = lazyPage(() => import("../pages/raid/RaidPage.tsx").then((m) => m.RaidPage));
const RaciPage = lazyPage(() => import("../pages/raci/RaciPage.tsx").then((m) => m.RaciPage));
const AdoptionPage = lazyPage(() => import("../pages/adoption/AdoptionPage.tsx").then((m) => m.AdoptionPage));
const FormPage = lazyPage(() => import("../pages/adoption/FormsPage.tsx").then((m) => m.FormPage));
const FormsPage = lazyPage(() => import("../pages/adoption/FormsPage.tsx").then((m) => m.FormsPage));
const IndicatorsPage = lazyPage(() => import("../pages/adoption/IndicatorsPage.tsx").then((m) => m.IndicatorsPage));
const InterventionPage = lazyPage(() =>
  import("../pages/adoption/InterventionsPage.tsx").then((m) => m.InterventionPage),
);
const InterventionsPage = lazyPage(() =>
  import("../pages/adoption/InterventionsPage.tsx").then((m) => m.InterventionsPage),
);
const RecordPage = lazyPage(() => import("../pages/adoption/RecordPage.tsx").then((m) => m.RecordPage));
const TrainingPage = lazyPage(() => import("../pages/adoption/TrainingPage.tsx").then((m) => m.TrainingPage));
const AreaPage = lazyPage(() => import("../pages/bau/BauPage.tsx").then((m) => m.AreaPage));
const BauPage = lazyPage(() => import("../pages/bau/BauPage.tsx").then((m) => m.BauPage));
const ControlsPage = lazyPage(() => import("../pages/bau/ControlsPage.tsx").then((m) => m.ControlsPage));
const ReviewsPage = lazyPage(() => import("../pages/bau/ControlsPage.tsx").then((m) => m.ReviewsPage));
const HandoverPage = lazyPage(() => import("../pages/bau/HandoverPage.tsx").then((m) => m.HandoverPage));
const HandoversPage = lazyPage(() => import("../pages/bau/HandoverPage.tsx").then((m) => m.HandoversPage));
const ImprovementPage = lazyPage(() =>
  import("../pages/improvement/ImprovementPage.tsx").then((m) => m.ImprovementPage),
);
const LessonSearchPage = lazyPage(() => import("../pages/lessons/LessonsPage.tsx").then((m) => m.LessonSearchPage));
const LessonsPage = lazyPage(() => import("../pages/lessons/LessonsPage.tsx").then((m) => m.LessonsPage));
const ClosurePage = lazyPage(() => import("../pages/closure/ClosurePage.tsx").then((m) => m.ClosurePage));
const ChangeRequestPage = lazyPage(() =>
  import("../pages/change-requests/ChangeRequestPage.tsx").then((m) => m.ChangeRequestPage),
);
const ChangeRequestsPage = lazyPage(() =>
  import("../pages/change-requests/ChangeRequestsPage.tsx").then((m) => m.ChangeRequestsPage),
);
const PhasesPage = lazyPage(() => import("../pages/phases/PhasesPage.tsx").then((m) => m.PhasesPage));
const BenefitFormulaPage = lazyPage(() =>
  import("../pages/benefit-formulas/BenefitFormulaPage.tsx").then((m) => m.BenefitFormulaPage),
);
const BenefitFormulasPage = lazyPage(() =>
  import("../pages/benefit-formulas/BenefitFormulasPage.tsx").then((m) => m.BenefitFormulasPage),
);
const BusinessCasePage = lazyPage(() =>
  import("../pages/business-cases/BusinessCasePage.tsx").then((m) => m.BusinessCasePage),
);
const BusinessCasesPage = lazyPage(() =>
  import("../pages/business-cases/BusinessCasesPage.tsx").then((m) => m.BusinessCasesPage),
);
const CapacityPage = lazyPage(() => import("../pages/capacity/CapacityPage.tsx").then((m) => m.CapacityPage));
const DecisionsPage = lazyPage(() => import("../pages/decisions/DecisionsPage.tsx").then((m) => m.DecisionsPage));
const CharterPage = lazyPage(() => import("../pages/define/CharterPage.tsx").then((m) => m.CharterPage));
const DefinePage = lazyPage(() => import("../pages/define/DefinePage.tsx").then((m) => m.DefinePage));
const DependenciesPage = lazyPage(() =>
  import("../pages/dependencies/DependenciesPage.tsx").then((m) => m.DependenciesPage),
);
const DesignPage = lazyPage(() => import("../pages/design/DesignPage.tsx").then((m) => m.DesignPage));
const DiagnosePage = lazyPage(() => import("../pages/diagnose/DiagnosePage.tsx").then((m) => m.DiagnosePage));
const DispensationsPage = lazyPage(() =>
  import("../pages/dispensations/DispensationsPage.tsx").then((m) => m.DispensationsPage),
);
const EvidencePage = lazyPage(() => import("../pages/evidence/EvidencePage.tsx").then((m) => m.EvidencePage));
const GateDetailPage = lazyPage(() => import("../pages/gates/GateDetailPage.tsx").then((m) => m.GateDetailPage));
const GatesPage = lazyPage(() => import("../pages/gates/GatesPage.tsx").then((m) => m.GatesPage));
const InitiativePage = lazyPage(() => import("../pages/portfolio/InitiativePage.tsx").then((m) => m.InitiativePage));
const PortfolioPage = lazyPage(() => import("../pages/portfolio/PortfolioPage.tsx").then((m) => m.PortfolioPage));
const PrioritizationPage = lazyPage(() =>
  import("../pages/prioritization/PrioritizationPage.tsx").then((m) => m.PrioritizationPage),
);
const ReadinessPage = lazyPage(() => import("../pages/readiness/ReadinessPage.tsx").then((m) => m.ReadinessPage));
const RoadmapPage = lazyPage(() => import("../pages/roadmap/RoadmapPage.tsx").then((m) => m.RoadmapPage));
const TeamPage = lazyPage(() => import("../pages/team/TeamPage.tsx").then((m) => m.TeamPage));
const TransformationCreatePage = lazyPage(() =>
  import("../pages/transformations/TransformationCreatePage.tsx").then((m) => m.TransformationCreatePage),
);
const TransformationDetailPage = lazyPage(() =>
  import("../pages/transformations/TransformationDetailPage.tsx").then((m) => m.TransformationDetailPage),
);
const TransformationEditPage = lazyPage(() =>
  import("../pages/transformations/TransformationEditPage.tsx").then((m) => m.TransformationEditPage),
);
const TransformationListPage = lazyPage(() =>
  import("../pages/transformations/TransformationListPage.tsx").then((m) => m.TransformationListPage),
);

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
  // FE-E (slices F and G: adoption, BAU, improvement, lessons): built by T-DG4-FE-E, see the routes below.
  // FE-F (slice H: G5/G6 views live in pages/gates; change control and closure)
  // change requests: built by T-DG4-FE-F2 (pages/change-requests), see the routes below.
  // closure: built by T-DG4-FE-F (pages/closure), see the routes below.
  // FE-G (slices J and K): the six dashboards and the Executive Overview are built by T-DG4-FE-G, see the routes below;
  // traceability, Modular entry, portfolios and workstreams are built by T-DG4-FE-G2, see the routes below.
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
      // P4 slices F and G: adoption, BAU and performance areas, improvement, lessons (T-DG4-FE-E; p4-work-split §F+G
      // FG.8). The intervention, form, record, area and handover detail paths are the backend's work-item links
      // (adoption_intervention_due, assessment_invitation, assessment_to_review, performance_review_due,
      // control_check_due, bau_handover_to_accept), so a reminder never leads to "page not found".
      { path: "transformations/:id/adoption", element: <AdoptionPage /> },
      { path: "transformations/:id/adoption-interventions", element: <InterventionsPage /> },
      { path: "transformations/:id/adoption-interventions/:interventionId", element: <InterventionPage /> },
      { path: "transformations/:id/adoption-indicators", element: <IndicatorsPage /> },
      { path: "transformations/:id/adoption-training", element: <TrainingPage /> },
      { path: "transformations/:id/assessment-forms", element: <FormsPage /> },
      { path: "transformations/:id/assessment-forms/:formId", element: <FormPage /> },
      { path: "transformations/:id/assessment-records/:recordId", element: <RecordPage /> },
      { path: "transformations/:id/bau", element: <BauPage /> },
      { path: "transformations/:id/performance-areas/:areaId", element: <AreaPage /> },
      { path: "transformations/:id/bau-handovers", element: <HandoversPage /> },
      { path: "transformations/:id/bau-handovers/:handoverId", element: <HandoverPage /> },
      { path: "transformations/:id/bau-controls", element: <ControlsPage /> },
      { path: "transformations/:id/bau-reviews", element: <ReviewsPage /> },
      { path: "transformations/:id/improvement", element: <ImprovementPage /> },
      { path: "transformations/:id/lessons", element: <LessonsPage /> },
      { path: "lessons", element: <LessonSearchPage /> },
      // P4 slice J: the six dashboards, the Executive Overview and the workstream dashboard (T-DG4-FE-G; p4-work-split
      // §J+K JK.7). The transformation dashboard is a workspace tab; /dashboards/executive opens the Executive Overview.
      { path: "executive-overview", element: <ExecutiveOverviewPage /> },
      { path: "dashboards", element: <DashboardsHubPage /> },
      { path: "dashboards/:kind", element: <DashboardPage /> },
      { path: "transformations/:id/dashboard", element: <TransformationDashboardPage /> },
      { path: "transformations/:id/workstreams/:workstreamId/dashboard", element: <WorkstreamDashboardPage /> },
      // P4 slice K and the RAG policy (T-DG4-FE-G2; p4-work-split §J+K JK.7; ADR-0038, ADR-0037 §3/§10).
      { path: "transformations/:id/traceability", element: <TraceabilityPage /> },
      { path: "transformations/:id/modular-entry", element: <ModularEntryPage /> },
      { path: "transformations/:id/workstreams", element: <WorkstreamsPage /> },
      { path: "transformations/:id/workstreams/:workstreamId", element: <WorkstreamPage /> },
      { path: "portfolios", element: <PortfoliosPage /> },
      { path: "portfolios/:portfolioId", element: <PortfolioDetailPage /> },
      { path: "dashboards/rag-policy", element: <RagPolicyPage /> },
      // P4 slice G closure and transition decisions (T-DG4-FE-F; p4-work-split §F+G FG.8; ADR-0034 §1-§3, §7).
      { path: "transformations/:id/closure", element: <ClosurePage /> },
      // P4 slice H change control and the phase workspace (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0035 §1, ADR-0036).
      { path: "transformations/:id/change-requests", element: <ChangeRequestsPage /> },
      { path: "transformations/:id/change-requests/:changeRequestId", element: <ChangeRequestPage /> },
      { path: "transformations/:id/phases", element: <PhasesPage /> },
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

/**
 * Starts loading the chunk of the page at `pathname` without rendering it. At start-up this runs in parallel with the
 * session check (GET /me in RequireSession), so a full page load does not wait for /me and THEN for the page's chunk.
 * A failure is ignored here: the page's own render shows it (RouteLoadFailed).
 */
export function preloadRoute(pathname: string): void {
  // RouteObject vs matchRoutes' agnostic route type under exactOptionalPropertyTypes: the same objects, read only.
  const matches = matchRoutes(routes as unknown as Parameters<typeof matchRoutes>[0], pathname) ?? [];
  for (const match of matches) {
    const type = ((match.route as { element?: unknown }).element as { type?: unknown } | null | undefined)?.type;
    if (typeof type === "function" && "load" in type) void (type as LazyPage<object>).load().catch(() => undefined);
  }
}

export function createAppRouter() {
  preloadRoute(window.location.pathname);
  return createBrowserRouter(routes);
}
