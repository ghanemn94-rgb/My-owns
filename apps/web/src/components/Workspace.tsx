// Transformation workspace frame for the P2 and P3 screens (REQ-S03-011): breadcrumbs, the transformation's code and
// name, the workspace tabs (P2: Overview, Diagnose, Charter, Define, Design, Decisions, Gates, Evidence, Team; P3:
// Portfolio, Prioritization, Roadmap, Dependencies, Capacity, Business cases, Benefit formulas, Readiness,
// Dispensations) and a context with the permission hints for this transformation.
//
// Permission hints decide only what the UI OFFERS (ADR-0006): a read-only auditor (AUD) or anyone without the write
// permission sees no enabled write control and a "read-only view" note. The server still re-checks every request and
// answers 403, which the forms show as a translated message.
import { createContext, useContext, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useParams } from "react-router";
import type { Permission } from "@mth/shared";
import { useMethodology, useTransformation } from "../api/queries.ts";
import type { MethodologyCatalogue, Transformation } from "../api/types.ts";
import { canOn, type PermissionTarget } from "../auth/permissions.ts";
import { useMe } from "../auth/session.tsx";
import { useTransformationTarget } from "../pages/transformations/common.tsx";
import { isNoPermission } from "../lib/problem.ts";
import { LifecycleChip } from "./Badges.tsx";
import { Icon } from "./Icon.tsx";
import { PageHeader, usePageTitle } from "./Page.tsx";
import { NoPermissionState, QueryState } from "./States.tsx";

/**
 * The tabs in display order. A tab's id is also its path segment (the area entry pages link to
 * `/transformations/<id>/<tab id>`). P2 tabs are labelled from `transformations.tabs.<id>`; each P3 tab is labelled
 * from its own page namespace (`labelKey`), which the owning FE task maintains (p3-work-split §4).
 */
export const WORKSPACE_TABS = [
  { id: "overview", path: "" },
  { id: "diagnose", path: "/diagnose" },
  { id: "charter", path: "/charter" },
  { id: "define", path: "/define" },
  { id: "design", path: "/design" },
  { id: "portfolio", path: "/portfolio", labelKey: "portfolio.tab" },
  { id: "prioritization", path: "/prioritization", labelKey: "prioritization.tab" },
  { id: "roadmap", path: "/roadmap", labelKey: "roadmap.tab" },
  { id: "dependencies", path: "/dependencies", labelKey: "dependencies.tab" },
  { id: "capacity", path: "/capacity", labelKey: "capacity.tab" },
  { id: "business-cases", path: "/business-cases", labelKey: "businessCases.tab" },
  { id: "benefit-formulas", path: "/benefit-formulas", labelKey: "benefitFormulas.tab" },
  { id: "decisions", path: "/decisions" },
  { id: "gates", path: "/gates" },
  { id: "readiness", path: "/readiness", labelKey: "readiness.tab" },
  { id: "dispensations", path: "/dispensations", labelKey: "dispensations.tab" },
  { id: "evidence", path: "/evidence" },
  { id: "team", path: "/team" },
  // P4 slices I and C (T-DG4-FE-A; labels from each page's own namespace).
  { id: "role-mappings", path: "/role-mappings", labelKey: "groups.roleMappings.tab" },
  { id: "decision-rights", path: "/decision-rights", labelKey: "decisionRights.tab" },
  { id: "raci", path: "/raci", labelKey: "raci.tab" },
  { id: "transform-readiness", path: "/transform-readiness", labelKey: "decisionRights.readiness.tab" },
  { id: "approval-decisions", path: "/approval-decisions", labelKey: "approvals.records.tab" },
  // P4 slices A and B (FE-B, FE-C screens; workspace entries added by T-DG4-FE-D, D-109 carry-forward).
  { id: "kpis", path: "/kpis", labelKey: "nav.p4.kpis.title" },
  { id: "benefits", path: "/benefits", labelKey: "nav.p4.benefits.title" },
  // P4 slices E and D (T-DG4-FE-D; labels from each page's own namespace).
  { id: "raid", path: "/raid", labelKey: "raidP4.tab.raid" },
  { id: "actions", path: "/actions", labelKey: "raidP4.tab.actions" },
  { id: "corrective-actions", path: "/corrective-actions", labelKey: "raidP4.tab.corrective" },
  { id: "forums", path: "/forums", labelKey: "governanceP4.tab.forums" },
  { id: "meetings", path: "/meetings", labelKey: "governanceP4.tab.meetings" },
  { id: "executive-decisions", path: "/executive-decisions", labelKey: "governanceP4.tab.decisions" },
  // P4 slices F and G (T-DG4-FE-E; labels from each page's own namespace).
  { id: "adoption", path: "/adoption", labelKey: "adoptionP4.tab.adoption" },
  { id: "bau", path: "/bau", labelKey: "sustainP4.tab.bau" },
  { id: "improvement", path: "/improvement", labelKey: "sustainP4.tab.improvement" },
  { id: "lessons", path: "/lessons", labelKey: "sustainP4.tab.lessons" },
  // P4 slice G closure and transition decisions (T-DG4-FE-F; p4-work-split §F+G FG.8).
  { id: "closure", path: "/closure", labelKey: "closureP4.tab" },
] as const satisfies readonly { id: string; path: string; labelKey?: string }[];
export type WorkspaceTabId = (typeof WORKSPACE_TABS)[number]["id"];

/** The i18n key of a workspace tab's label. */
export function workspaceTabLabelKey(id: WorkspaceTabId): string {
  const tab: { id: string; labelKey?: string } | undefined = WORKSPACE_TABS.find((x) => x.id === id);
  return tab?.labelKey ?? `transformations.tabs.${id}`;
}

export interface WorkspaceContextValue {
  readonly tr: Transformation;
  readonly tid: string;
  readonly target: PermissionTarget;
  readonly methodology: MethodologyCatalogue;
  /** UI hint only: the caller may (probably) perform this on this transformation, and it is not archived. */
  readonly can: (permission: Permission) => boolean;
  readonly canAny: (...permissions: Permission[]) => boolean;
  /**
   * Row-level hint (ADR-0020 §3): `edit` on any row, or `contribute` on rows the caller created or owns. Mirrors the
   * server's record rules; the server still decides.
   */
  readonly canWriteRow: (
    edit: Permission,
    contribute: Permission | null,
    row: { createdBy?: string | null; ownerUserId?: string | null } | null,
  ) => boolean;
  readonly meId: string;
  readonly archived: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace() used outside <WorkspaceFrame>");
  return ctx;
}

/** The workspace tab bar (also used on the transformation overview page). */
export function WorkspaceTabs({ tid }: { tid: string }) {
  const { t } = useTranslation();
  return (
    <nav className="workspace-tabs" aria-label={t("transformations.tabs.label")}>
      <ul className="workspace-tabs__list">
        {WORKSPACE_TABS.map((tab) => (
          <li key={tab.id}>
            <NavLink end to={`/transformations/${tid}${tab.path}`} className="workspace-tabs__link" data-tab={tab.id}>
              {t(workspaceTabLabelKey(tab.id))}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Loads the transformation and its pinned methodology catalogue, then renders the page with the workspace context.
 * `writePermissions` are the permissions that make this page editable; without any of them a read-only note shows.
 */
export function WorkspaceFrame({
  tab,
  title,
  subtitle,
  writePermissions,
  children,
}: {
  tab: Exclude<WorkspaceTabId, "overview">;
  title: string;
  subtitle?: string;
  writePermissions: readonly Permission[];
  children: ReactNode;
}) {
  const { id = "" } = useParams();
  const query = useTransformation(id);
  const methodology = useMethodology(id);
  usePageTitle(query.data ? `${title} · ${query.data.code}` : title);
  if (query.isError && isNoPermission(query.error)) {
    return (
      <div className="page">
        <NoPermissionState error={query.error} />
      </div>
    );
  }
  return (
    <div className="page" data-workspace-tab={tab}>
      <QueryState query={query}>
        {(tr) => (
          <QueryState query={methodology}>
            {(m) => (
              <FrameBody
                tr={tr}
                methodology={m}
                tab={tab}
                title={title}
                subtitle={subtitle}
                writePermissions={writePermissions}
              >
                {children}
              </FrameBody>
            )}
          </QueryState>
        )}
      </QueryState>
    </div>
  );
}

function FrameBody({
  tr,
  methodology,
  title,
  subtitle,
  writePermissions,
  children,
}: {
  tr: Transformation;
  methodology: MethodologyCatalogue;
  tab: string;
  title: string;
  subtitle?: string | undefined;
  writePermissions: readonly Permission[];
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const target = useTransformationTarget(tr)!;
  const archived = tr.archivedAt !== null;
  const can = (p: Permission) => !archived && canOn(me, p, target);
  const value: WorkspaceContextValue = {
    tr,
    tid: tr.id,
    target,
    methodology,
    can,
    canAny: (...ps) => ps.some(can),
    canWriteRow: (edit, contribute, row) =>
      can(edit) ||
      (contribute !== null &&
        can(contribute) &&
        (row === null || row.createdBy === me.user.id || row.ownerUserId === me.user.id)),
    meId: me.user.id,
    archived,
  };
  const readOnly = !writePermissions.some(can);
  return (
    <WorkspaceContext.Provider value={value}>
      <PageHeader
        crumbs={[
          { label: t("transformations.listTitle"), to: "/transformations" },
          { label: tr.code, to: `/transformations/${tr.id}` },
          { label: title },
        ]}
        title={title}
        subtitle={
          <span className="chip-row">
            <bdi dir="ltr" className="code">
              {tr.code}
            </bdi>
            <span>{tr.name}</span>
            <LifecycleChip status={tr.status} />
            {archived ? <LifecycleChip status="archived" /> : null}
            <span className="muted">
              {t("transformations.field.currentPhase")}: {t(`transformations.phase.${tr.currentPhase}`)}
            </span>
          </span>
        }
      />
      <WorkspaceTabs tid={tr.id} />
      {subtitle ? <p className="page-intro">{subtitle}</p> : null}
      {readOnly ? (
        <p className="banner banner--info" role="note" data-state="read-only">
          <Icon name="lock" />{" "}
          {archived ? t("transformations.tabs.archivedReadOnly") : t("transformations.tabs.readOnly")}
        </p>
      ) : null}
      {children}
    </WorkspaceContext.Provider>
  );
}
