// Administration > Approval routes (T-DG5-FE-D; REQ-S10-015; ADR-0044 §4): the sequential and parallel approval routes
// resolved from the published methodology (`approver_route` elements) and from procedure approval paths, read-only
// (methodology.read; routes are configured in the Playbook Studio). And one approval's route: each step with its role,
// status and decider. In a sequential route a later step is "Waiting — not notified yet" until the earlier steps
// approve; in a parallel route every step is active (notified) at once. A route step is a business approval decided
// by a person holding the step's role — never by an automation or a technical administrator.
import type { ApprovalRouteDefinition } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, useUserNames } from "../my-work/p4ui.tsx";
import { fedPaths, useApprovalRoute, useApprovalRoutes, useFedRefresh, type ApprovalRoute } from "../automation/api.ts";
import { NoteForm, StatusChip, pick, useRunner } from "../automation/ui.tsx";
import { ConfigurationNote } from "../studio/ui.tsx";

type RouteDefinition = ApprovalRouteDefinition;

export const ROUTE_STEP_CHIP = {
  waiting: ["neutral", "clock"],
  active: ["warn", "dot"],
  approved: ["good", "check"],
  rejected: ["bad", "cross"],
  changes_requested: ["warn", "pencil"],
  cancelled: ["closed", "stop"],
} as const;

export function ApprovalRoutesPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("nav.p5.approvalRoutes.title"));
  const routes = useApprovalRoutes();
  const columns: RegisterColumn<RouteDefinition>[] = [
    {
      id: "route",
      header: t("workflowsP5.routes.route"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <span className="block">
          {pick(locale, r.labelEn, r.labelAr) ?? <bdi dir="ltr">{r.routeKey}</bdi>}
          <span className="block small muted">
            <bdi dir="ltr">{r.routeKey}</bdi>
          </span>
        </span>
      ),
      sortValue: (r) => r.routeKey,
      filterText: (r) => `${r.routeKey} ${r.labelEn ?? ""} ${r.labelAr ?? ""} ${r.roleCodes.join(" ")}`,
    },
    {
      id: "mode",
      header: t("workflowsP5.routes.mode"),
      cell: (r) => <span data-mode={r.mode}>{t(`workflowsP5.approvalMode.${r.mode}`)}</span>,
      sortValue: (r) => r.mode,
    },
    {
      id: "roles",
      header: t("workflowsP5.routes.roles"),
      cell: (r) => (
        <ol className="plain-list">
          {r.roleCodes.map((c, i) => (
            <li key={`${c}-${i}`}>
              {r.mode === "sequential" ? `${i + 1}. ` : ""}
              <bdi dir="ltr">{c}</bdi>
            </li>
          ))}
        </ol>
      ),
    },
    {
      id: "source",
      header: t("workflowsP5.routes.source"),
      cell: (r) => t(`workflowsP5.routes.sourceKind.${r.source}`),
      sortValue: (r) => r.source,
    },
  ];
  return (
    <div className="page" data-p5-screen="approval-routes">
      <PageHeader
        title={t("nav.p5.approvalRoutes.title")}
        subtitle={t("nav.p5.approvalRoutes.summary")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("nav.p5.approvalRoutes.title") }]}
      />
      <ConfigurationNote />
      <p className="small">
        {t("workflowsP5.routes.configuredIn")}{" "}
        <Link className="link" to="/admin/studio">
          {t("nav.p5.studio.title")}
        </Link>
      </p>
      <QueryState query={routes}>
        {(list) => (
          <Section id="routes" title={t("workflowsP5.routes.listTitle")} intro={t("workflowsP5.routes.listIntro")}>
            <RegisterTable
              id="p5-approval-routes"
              caption={t("workflowsP5.routes.listTitle")}
              rows={list.items}
              columns={columns}
              getRowId={(r) => r.routeKey}
              emptyTitle={t("workflowsP5.routes.empty")}
              defaultSort={{ id: "route", dir: "asc" }}
            />
          </Section>
        )}
      </QueryState>
    </div>
  );
}

/** The route of one approval, and the decision of the current user's active step. */
export function ApprovalRoutePage() {
  const { t } = useTranslation();
  const { approvalId } = useParams();
  usePageTitle(t("workflowsP5.routes.oneTitle"));
  const route = useApprovalRoute(approvalId);
  return (
    <div className="page" data-p5-screen="approval-route">
      <PageHeader
        title={t("workflowsP5.routes.oneTitle")}
        crumbs={[
          { label: t("nav.sub.approvals"), to: "/my-work/approvals" },
          { label: t("workflowsP5.routes.approval"), to: `/my-work/approvals/${approvalId ?? ""}` },
          { label: t("workflowsP5.routes.oneTitle") },
        ]}
      />
      <BusinessApprovalNote body={t("workflowsP5.routes.businessNote")} />
      <QueryState query={route}>{(r) => <RouteView route={r} />}</QueryState>
    </div>
  );
}

function RouteView({ route: r }: { route: ApprovalRoute }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const names = useUserNames(r.steps.flatMap((s) => [s.assigneeUserId, s.decidedBy]));
  const canDecide = canAnywhere(me, "approval.decide");
  const [outcome, setOutcome] = useState<"approve" | "reject" | "request_changes">("approve");
  const current = r.steps.filter((s) => s.roundNo === r.currentRoundNo).sort((a, b) => a.stepNo - b.stepNo);
  const active = current.filter((s) => s.status === "active");
  if (!r.routed)
    return (
      <p className="banner banner--info" role="note" data-routed="false">
        {t("workflowsP5.routes.notRouted")}{" "}
        <Link className="link" to={`/my-work/approvals/${r.approvalId}`}>
          {t("workflowsP5.routes.openApproval")}
        </Link>
      </p>
    );
  return (
    <>
      <section className="card" aria-labelledby="route-facts" data-routed="true" data-mode={r.mode}>
        <h2 id="route-facts" className="card__title">
          <bdi dir="ltr">{r.routeKey}</bdi>
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("workflowsP5.routes.mode")}</dt>
          <dd>{r.mode ? t(`workflowsP5.approvalMode.${r.mode}`) : "—"}</dd>
          <dt>{t("workflowsP5.routes.round")}</dt>
          <dd>{r.currentRoundNo}</dd>
          <dt>{t("workflowsP5.routes.approvalStatus")}</dt>
          <dd>{t(`approvals.status.${r.approvalStatus}`, { defaultValue: r.approvalStatus })}</dd>
        </dl>
        <p className="small muted">
          {r.mode === "sequential" ? t("workflowsP5.routes.sequentialNote") : t("workflowsP5.routes.parallelNote")}
        </p>
      </section>
      {runner.alert}
      <Section id="route-steps" title={t("workflowsP5.routes.stepsTitle")}>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.routes.stepsTitle")}>
          <table className="table" data-table="route-steps">
            <caption className="visually-hidden">{t("workflowsP5.routes.stepsTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("workflowsP5.procedures.ordinal")}</th>
                <th scope="col">{t("workflowsP5.routes.role")}</th>
                <th scope="col">{t("workflowsP5.field.status")}</th>
                <th scope="col">{t("workflowsP5.routes.notified")}</th>
                <th scope="col">{t("workflowsP5.routes.decision")}</th>
              </tr>
            </thead>
            <tbody>
              {current.map((s) => (
                <tr key={`${s.roundNo}-${s.stepNo}`} data-step={s.stepNo} data-step-status={s.status}>
                  <td>{s.stepNo}</td>
                  <th scope="row">
                    <bdi dir="ltr">{s.approverRoleCode}</bdi>
                    {s.assigneeUserId ? <span className="block small">{names(s.assigneeUserId)}</span> : null}
                  </th>
                  <td>
                    <StatusChip value={s.status} table={ROUTE_STEP_CHIP} labelKey="workflowsP5.routeStepStatus" />
                  </td>
                  <td data-notified={s.activatedAt ? "true" : "false"}>
                    {s.activatedAt ? formatDateTime(s.activatedAt, locale) : t("workflowsP5.routes.notNotified")}
                  </td>
                  <td>
                    {s.decidedAt ? (
                      <>
                        {names(s.decidedBy)} · {formatDateTime(s.decidedAt, locale)}
                        {s.decisionNote ? <span className="block small">{s.decisionNote}</span> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {canDecide && active.length > 0 ? (
        <Section id="decide" title={t("workflowsP5.routes.decideTitle")} intro={t("workflowsP5.routes.decideIntro")}>
          {active.map((s) => (
            <div key={s.stepNo} className="card form--inset" data-decide-step={s.stepNo}>
              <h3>{t("workflowsP5.routes.stepN", { n: s.stepNo, role: s.approverRoleCode })}</h3>
              <div className="field">
                <label className="field__label" htmlFor={`route-outcome-${s.stepNo}`}>
                  {t("workflowsP5.routes.decision")}
                </label>
                <select
                  id={`route-outcome-${s.stepNo}`}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as typeof outcome)}
                >
                  {(["approve", "reject", "request_changes"] as const).map((o) => (
                    <option key={o} value={o}>
                      {t(`workflowsP5.reviewOutcome.${o}`)}
                    </option>
                  ))}
                </select>
              </div>
              <NoteForm
                id={`route-decision-${s.stepNo}`}
                label={t("workflowsP5.field.note")}
                submitLabel={t("workflowsP5.routes.recordDecision")}
                required={outcome !== "approve"}
                min={outcome !== "approve" ? 3 : 0}
                max={2000}
                busy={runner.busy}
                onSubmit={(note) =>
                  void runner.run(fedPaths.decideRouteStep(r.approvalId, s.stepNo), {
                    body: { outcome, ...(note ? { note } : {}) },
                    ifMatch: r.approvalVersion,
                  })
                }
              />
            </div>
          ))}
        </Section>
      ) : null}
    </>
  );
}
