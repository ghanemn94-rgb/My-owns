// Resource capacity screen (T-DG3-FE-B; REQ-PB-059, REQ-S09-004; ADR-0023 §6). Replaces FE-A0's seam stub.
//  - a role × month grid of decimal FTE: available, demand (planned + committed) and committed; a conflict
//    (capacity.over_allocated) shows its shortfall (demand − available, decimal); a month without a capacity row is
//    Unknown (capacity.unknown), never 0 and never "no conflict";
//  - resource demands with commit (capacity.commit: a resourcing commitment, NOT a business approval) and release
//    (reason required), both with If-Match; a 409 shows the conflict notice and reloads.
// FTE strings are formatted with the shared formatDecimal; nothing is converted to a JS number.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { intlLocale } from "../../lib/format.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { WorkspaceFrame, useWorkspace } from "../../components/Workspace.tsx";
import {
  ConflictNotice,
  FormAlert,
  TableRegion,
  isVersionConflict,
  p3ErrorMessage,
  useDecimal,
} from "../prioritization/p3ui.tsx";
import { useRoadmap } from "../roadmap/api.ts";
import {
  capacityUrls,
  useCapacityPlan,
  useResourceDemands,
  type CapacityPlan,
  type ResourceDemand,
  type ResourceRole,
} from "./api.ts";

export function CapacityPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="capacity"
      title={t("capacity.title")}
      subtitle={t("capacity.subtitle")}
      writePermissions={["capacity.edit", "capacity.commit"]}
    >
      <CapacityBody />
    </WorkspaceFrame>
  );
}

function useRoleLabel() {
  const locale = useLocale();
  return (r: ResourceRole | undefined) => (r ? (locale === "ar" ? r.labelAr : r.labelEn) : null);
}

/** "2026-11-01" -> localized "Nov 2026" (calendar month, no time-zone shift). */
function useMonthLabel() {
  const locale = useLocale();
  return (period: string) => {
    if (!/^\d{4}-\d{2}-01$/.test(period)) return period;
    const d = new Date(`${period}T00:00:00Z`);
    return new Intl.DateTimeFormat(intlLocale(locale), {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  };
}

function CapacityBody() {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const plan = useCapacityPlan(tid);
  const [conflict, setConflict] = useState(false);
  return (
    <>
      {conflict ? <ConflictNotice onDismiss={() => setConflict(false)} /> : null}
      <Section id="grid" title={t("capacity.grid.title")} intro={t("capacity.grid.intro")}>
        <QueryState
          query={plan}
          isEmpty={(p) => p.roles.length === 0}
          empty={<EmptyState title={t("capacity.grid.emptyTitle")} body={t("capacity.grid.emptyBody")} />}
        >
          {(p) => <Grid plan={p} />}
        </QueryState>
      </Section>
      <DemandsSection roles={plan.data?.roles ?? []} onConflict={() => setConflict(true)} />
    </>
  );
}

function Grid({ plan }: { plan: CapacityPlan }) {
  const { t } = useTranslation();
  const fmt = useDecimal();
  const roleLabel = useRoleLabel();
  const month = useMonthLabel();
  const months = [...new Set(plan.cells.map((c) => c.periodMonth))].sort();
  const cell = (roleId: string, m: string) =>
    plan.cells.find((c) => c.resourceRoleId === roleId && c.periodMonth === m);
  const conflicts = plan.cells.filter((c) => c.flag === "capacity.over_allocated").length;
  const unknowns = plan.cells.filter((c) => c.flag === "capacity.unknown").length;
  return (
    <>
      <p role="status" data-testid="capacity-summary">
        {conflicts > 0 ? (
          <span className="status-chip status-chip--at-risk">
            <Icon name="alert" /> {t("capacity.grid.conflicts", { n: conflicts })}
          </span>
        ) : (
          <span className="muted">{t("capacity.grid.noConflicts")}</span>
        )}{" "}
        {unknowns > 0 ? (
          <span className="status-chip status-chip--unknown">
            <Icon name="question" /> {t("capacity.grid.unknowns", { n: unknowns })}
          </span>
        ) : null}
      </p>
      <TableRegion label={t("capacity.grid.caption")}>
        <table className="table table--compact" data-testid="capacity-grid">
          <caption>{t("capacity.grid.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("capacity.grid.role")}</th>
              {months.map((m) => (
                <th key={m} scope="col">
                  {month(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {plan.roles.map((r) => (
              <tr key={r.id} data-role={r.code}>
                <th scope="row">{roleLabel(r)}</th>
                {months.map((m) => {
                  const c = cell(r.id, m);
                  if (!c) {
                    return (
                      <td key={m} data-flag="none">
                        <span className="muted">{t("capacity.grid.noDemand")}</span>
                      </td>
                    );
                  }
                  return (
                    <td key={m} data-flag={c.flag ?? "ok"} data-month={m}>
                      <div>
                        {t("capacity.grid.available")}:{" "}
                        {c.availableFte === null ? <Unknown /> : <bdi>{fmt(c.availableFte, 0, 2)}</bdi>}
                      </div>
                      <div>
                        {t("capacity.grid.demand")}: <bdi>{fmt(c.demandFte, 0, 2) ?? "—"}</bdi>
                      </div>
                      <div className="muted">
                        {t("capacity.grid.committed")}: <bdi>{fmt(c.committedDemandFte, 0, 2) ?? "—"}</bdi>
                      </div>
                      {c.flag === "capacity.over_allocated" ? (
                        <span className="status-chip status-chip--at-risk" data-testid="shortfall">
                          <Icon name="alert" />{" "}
                          {t("capacity.grid.shortfall", {
                            fte: fmt(c.shortfallFte, 0, 2) ?? t("common.value.unknown"),
                          })}
                        </span>
                      ) : c.flag === "capacity.unknown" ? (
                        <span className="status-chip status-chip--unknown">
                          <Icon name="question" /> {t("capacity.grid.unknownCapacity")}
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableRegion>
      <p className="muted">{t("capacity.grid.rule")}</p>
    </>
  );
}

function DemandsSection({ roles, onConflict }: { roles: readonly ResourceRole[]; onConflict: () => void }) {
  const { t } = useTranslation();
  const { tid, can } = useWorkspace();
  const demands = useResourceDemands(tid);
  const roadmap = useRoadmap(tid);
  const refresh = useP3Refresh(tid);
  const fmt = useDecimal();
  const roleLabel = useRoleLabel();
  const month = useMonthLabel();
  const [releasing, setReleasing] = useState<ResourceDemand | null>(null);
  const [error, setError] = useState<unknown>(null);
  const canCommit = can("capacity.commit");
  const ini = new Map((roadmap.data?.initiatives ?? []).map((i) => [i.id, i]));

  const commit = async (d: ResourceDemand) => {
    setError(null);
    const action = beginSessionGuard();
    try {
      await api.send(capacityUrls.commit(d.id), { method: "POST", body: {}, ifMatch: d.version });
      if (action.stale()) return;
      await refresh();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        onConflict();
        await refresh();
        return;
      }
      setError(e);
    }
  };

  return (
    <Section id="demands" title={t("capacity.demands.title")} intro={t("capacity.demands.intro")}>
      <FormAlert message={error ? p3ErrorMessage(t, error) : null} />
      <QueryState
        query={demands}
        isEmpty={(d) => d.length === 0}
        empty={<p className="muted">{t("capacity.demands.empty")}</p>}
      >
        {(list) => (
          <TableRegion label={t("capacity.demands.caption")}>
            <table className="table table--compact" data-testid="demands">
              <caption>{t("capacity.demands.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("capacity.demands.initiative")}</th>
                  <th scope="col">{t("capacity.grid.role")}</th>
                  <th scope="col">{t("capacity.demands.month")}</th>
                  <th scope="col">{t("capacity.demands.fte")}</th>
                  <th scope="col">{t("capacity.demands.status")}</th>
                  {canCommit ? <th scope="col">{t("capacity.demands.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {list
                  .filter((d) => d.status !== "archived")
                  .map((d) => {
                    const i = ini.get(d.initiativeId);
                    return (
                      <tr key={d.id} data-demand-status={d.status}>
                        <th scope="row">
                          {i ? (
                            <>
                              <bdi dir="ltr" className="code">
                                {i.code}
                              </bdi>{" "}
                              {i.name}
                            </>
                          ) : (
                            <Unknown />
                          )}
                        </th>
                        <td>{roleLabel(roles.find((r) => r.id === d.resourceRoleId)) ?? <Unknown />}</td>
                        <td>{month(d.periodMonth)}</td>
                        <td>
                          <bdi>{fmt(d.demandFte, 0, 2)}</bdi>
                        </td>
                        <td>{t(`capacity.demands.state.${d.status}`)}</td>
                        {canCommit ? (
                          <td>
                            <div className="toolbar">
                              {d.status === "planned" ? (
                                <button
                                  type="button"
                                  className="button button--primary button--small"
                                  onClick={() => void commit(d)}
                                >
                                  {t("capacity.demands.commit")}
                                </button>
                              ) : null}
                              {d.status === "committed" || d.status === "planned" ? (
                                <button
                                  type="button"
                                  className="button button--secondary button--small"
                                  onClick={() => setReleasing(d)}
                                >
                                  {t("capacity.demands.release")}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </TableRegion>
        )}
      </QueryState>
      <p className="muted">{t("capacity.demands.notApproval")}</p>
      {releasing ? (
        <ReasonDialog
          title={t("capacity.demands.releaseTitle")}
          description={t("capacity.demands.releaseBody")}
          confirmLabel={t("capacity.demands.release")}
          onClose={() => setReleasing(null)}
          onConfirm={async (reason) => {
            try {
              await api.send(capacityUrls.release(releasing.id), {
                method: "POST",
                body: { reason },
                ifMatch: releasing.version,
              });
            } catch (e) {
              if (isVersionConflict(e)) {
                setReleasing(null);
                onConflict();
                await refresh();
                return;
              }
              throw e;
            }
            if (!(await refresh())) return;
            setReleasing(null);
          }}
        />
      ) : null}
    </Section>
  );
}
