// Routes (React Router 7, data-router library mode; ADR-0009). Everything below the shell needs a session.
import { Navigate, createBrowserRouter, type RouteObject } from "react-router";
import { RequireSession } from "../auth/session.tsx";
import { AdminHomePage } from "../pages/admin/AdminHomePage.tsx";
import { AssignmentsPage } from "../pages/admin/AssignmentsPage.tsx";
import { BusinessUnitEditPage, OrganizationDetailPage, OrganizationsPage } from "../pages/admin/OrganizationsPage.tsx";
import { UserDetailPage, UsersPage } from "../pages/admin/UsersPage.tsx";
import { AboutPage, AreaPlaceholderPage, MyWorkPage, NotFoundPage } from "../pages/AreaPages.tsx";
import { LoginPage } from "../pages/LoginPage.tsx";
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
      { path: "admin", element: <AdminHomePage /> },
      { path: "admin/organizations", element: <OrganizationsPage /> },
      { path: "admin/organizations/:id", element: <OrganizationDetailPage /> },
      { path: "admin/business-units/:id", element: <BusinessUnitEditPage /> },
      { path: "admin/users", element: <UsersPage /> },
      { path: "admin/users/:id", element: <UserDetailPage /> },
      { path: "admin/assignments", element: <AssignmentsPage /> },
      { path: "about", element: <AboutPage /> },
      ...placeholderRoutes,
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
