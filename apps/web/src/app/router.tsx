// Routes (React Router 7, data-router library mode; ADR-0009). Everything below the shell needs a session.
import { Navigate, createBrowserRouter, type RouteObject } from "react-router";
import { RequireSession } from "../auth/session.tsx";
import { AdminHomePage } from "../pages/admin/AdminHomePage.tsx";
import { AssignmentsPage } from "../pages/admin/AssignmentsPage.tsx";
import { BusinessUnitEditPage, OrganizationDetailPage, OrganizationsPage } from "../pages/admin/OrganizationsPage.tsx";
import { UserDetailPage, UsersPage } from "../pages/admin/UsersPage.tsx";
import { AboutPage, AreaEntryPage, AreaPlaceholderPage, MyWorkPage, NotFoundPage } from "../pages/AreaPages.tsx";
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
import { NAV_AREAS } from "./nav.ts";
import { Shell } from "./Shell.tsx";

const placeholderRoutes: RouteObject[] = NAV_AREAS.filter((a) => a.availability === "planned").map((a) => ({
  path: a.path.slice(1),
  element: <AreaPlaceholderPage area={a.id} />,
}));

/** Areas whose P2 content lives in each transformation's workspace: the area page leads into that workspace tab. */
const entryRoutes: RouteObject[] = NAV_AREAS.filter((a) => a.workspaceTab).map((a) => ({
  path: a.path.slice(1),
  element: <AreaEntryPage area={a.id} tab={a.workspaceTab!} />,
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
      ...entryRoutes,
      ...placeholderRoutes,
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
