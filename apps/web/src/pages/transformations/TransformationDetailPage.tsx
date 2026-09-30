// Transformation workspace (REQ-S03-011 P1 increment): the header shows the eight elements named in §3 — phase, gate
// readiness, North Star, owners, outcome health, benefits, key decisions, next required action. Elements whose records
// arrive in later stages show Unknown (never 0 or green). Archive needs a reason and If-Match.
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router";
import { ApiError, api } from "../../api/client.ts";
import { keys, useTransformation, useTransformationAudit } from "../../api/queries.ts";
import type { Transformation } from "../../api/types.ts";
import { useForwardArrow, useLocale } from "../../app/locale.ts";
import { ancestryOf, canOn, type PermissionTarget } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { HealthChip, LifecycleChip, Unknown } from "../../components/Badges.tsx";
import { Pager, useCursorPager } from "../../components/DataTable.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessUnitName, PhaseStepper, UserName, useBusinessUnitIndex } from "./common.tsx";

export function useTransformationTarget(t: Transformation | undefined): PermissionTarget | null {
  const bu = useBusinessUnitIndex();
  if (!t) return null;
  return {
    level: "transformation",
    organizationId: t.organizationId,
    businessUnitId: t.businessUnitId,
    transformationId: t.id,
    businessUnitAncestry: ancestryOf(t.businessUnitId, bu.units),
  };
}

export function TransformationDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const query = useTransformation(id);
  const location = useLocation();
  const justCreated = (location.state as { created?: boolean } | null)?.created === true;
  usePageTitle(query.data ? `${query.data.code} · ${query.data.name}` : t("transformations.detailTitle"));
  return (
    <div className="page">
      <QueryState query={query}>
        {(tr) => (
          <>
            {justCreated ? (
              <p className="banner banner--success" role="status">
                <Icon name="check" /> {t("transformations.created")}
              </p>
            ) : null}
            <Workspace tr={tr} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function Workspace({ tr }: { tr: Transformation }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const bu = useBusinessUnitIndex();
  const queryClient = useQueryClient();
  const target = useTransformationTarget(tr)!;
  const [archiving, setArchiving] = useState(false);
  const archived = tr.archivedAt !== null;
  const canUpdate = !archived && canOn(me, "transformation.update", target);
  const canArchive = !archived && canOn(me, "transformation.archive", target);
  const canAudit = canOn(me, "audit.read", target);

  const archive = async (reason: string) => {
    try {
      const updated = await api.send<Transformation>(`/api/v1/transformations/${tr.id}/archive`, {
        method: "POST",
        body: { reason },
        ifMatch: tr.version,
      });
      queryClient.setQueryData(keys.transformation(tr.id), updated);
      await queryClient.invalidateQueries({ queryKey: ["transformations"] });
      await queryClient.invalidateQueries({ queryKey: ["transformation-audit", tr.id] });
      setArchiving(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone changed the record meanwhile: reload it so the user sees the current state before retrying.
        await queryClient.invalidateQueries({ queryKey: keys.transformation(tr.id) });
      }
      throw err;
    }
  };

  return (
    <>
      <PageHeader
        crumbs={[{ label: t("transformations.listTitle"), to: "/transformations" }, { label: tr.code }]}
        title={
          <>
            <bdi dir="ltr" className="code page-header__code">
              {tr.code}
            </bdi>{" "}
            {tr.name}
          </>
        }
        subtitle={
          <span className="chip-row">
            <LifecycleChip status={tr.status} />
            {archived ? <LifecycleChip status="archived" /> : null}
            <span className="muted">{t(`transformations.mode.${tr.mode}`)}</span>
          </span>
        }
        actions={
          <>
            {canUpdate ? (
              <Link to={`/transformations/${tr.id}/edit`} className="button button--primary">
                <Icon name="pencil" /> {t("common.action.edit")}
              </Link>
            ) : null}
            {canArchive ? (
              <button type="button" className="button button--secondary" onClick={() => setArchiving(true)}>
                <Icon name="archive" /> {t("transformations.archive.action")}
              </button>
            ) : null}
          </>
        }
      />

      {archived ? (
        <div className="banner banner--info" role="note">
          <Icon name="lock" />{" "}
          {t("transformations.archive.readOnly", {
            when: formatDateTime(tr.archivedAt, locale, tr.timezone) ?? t("common.value.unknown"),
          })}{" "}
          {tr.archiveReason ? (
            <span>
              {t("transformations.archive.reasonLabel")}: {tr.archiveReason}
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="workspace-header card" aria-labelledby="ws-title">
        <h2 id="ws-title" className="visually-hidden">
          {t("transformations.workspace.title")}
        </h2>
        <div className="workspace-header__phase">
          <h3 className="workspace-header__label">{t("transformations.workspace.phase")}</h3>
          <PhaseStepper current={tr.currentPhase} entry={tr.entryPhase} />
        </div>
        <dl className="workspace-header__grid">
          <div>
            <dt>{t("transformations.workspace.gateReadiness")}</dt>
            <dd>
              <Unknown hint={t("transformations.workspace.laterStage")} />
            </dd>
          </div>
          <div>
            <dt>{t("transformations.workspace.northStar")}</dt>
            <dd>
              <Unknown hint={t("transformations.workspace.laterStage")} />
            </dd>
          </div>
          <div>
            <dt>{t("transformations.workspace.owners")}</dt>
            <dd>
              <span className="block">
                {t("transformations.field.sponsor")}: <UserName id={tr.sponsorUserId} />
              </span>
              <span className="block">
                {t("transformations.field.lead")}: <UserName id={tr.leadUserId} />
              </span>
            </dd>
          </div>
          <div>
            <dt>{t("transformations.workspace.outcomeHealth")}</dt>
            <dd>
              <HealthChip health="unknown" />
            </dd>
          </div>
          <div>
            <dt>{t("transformations.workspace.benefits")}</dt>
            <dd>
              <Unknown hint={t("transformations.workspace.laterStage")} />
            </dd>
          </div>
          <div>
            <dt>{t("transformations.workspace.keyDecisions")}</dt>
            <dd>
              <Unknown hint={t("transformations.workspace.laterStage")} />
            </dd>
          </div>
          <div>
            <dt>{t("transformations.workspace.nextAction")}</dt>
            <dd>
              <Unknown hint={t("transformations.workspace.laterStage")} />
            </dd>
          </div>
        </dl>
        <p className="muted small">{t("transformations.workspace.unknownNote")}</p>
      </section>

      <section className="card" aria-labelledby="details-title">
        <h2 id="details-title" className="card__title">
          {t("transformations.detailsTitle")}
        </h2>
        <dl className="details">
          <div>
            <dt>{t("transformations.field.businessUnit")}</dt>
            <dd>
              <BusinessUnitName id={tr.businessUnitId} index={bu.byId} />
            </dd>
          </div>
          <div>
            <dt>{t("transformations.field.mode")}</dt>
            <dd>{t(`transformations.mode.${tr.mode}`)}</dd>
          </div>
          <div>
            <dt>{t("transformations.field.entryPhase")}</dt>
            <dd>{tr.entryPhase ? t(`transformations.phase.${tr.entryPhase}`) : t("transformations.form.fromStart")}</dd>
          </div>
          <div>
            <dt>{t("transformations.field.standaloneDeliverable")}</dt>
            <dd>
              {tr.standaloneDeliverableType
                ? t(`transformations.deliverable.${tr.standaloneDeliverableType}`)
                : t("common.value.none")}
            </dd>
          </div>
          <div>
            <dt>{t("transformations.field.description")}</dt>
            <dd>{tr.description ?? <span className="muted">{t("common.value.none")}</span>}</dd>
          </div>
          <div>
            <dt>{t("common.field.timezone")}</dt>
            <dd>
              <bdi dir="ltr">{tr.timezone}</bdi>
            </dd>
          </div>
          <div>
            <dt>{t("common.field.currency")}</dt>
            <dd>
              <bdi dir="ltr">{tr.currency}</bdi>
            </dd>
          </div>
          <div>
            <dt>{t("transformations.field.createdAt")}</dt>
            <dd>
              <span className="block">{formatDateTime(tr.createdAt, locale, tr.timezone)}</span>
              <span className="block muted">
                <UserName id={tr.createdBy} />
              </span>
            </dd>
          </div>
          <div>
            <dt>{t("transformations.field.updatedAt")}</dt>
            <dd>
              <span className="block">{formatDateTime(tr.updatedAt, locale, tr.timezone)}</span>
              <span className="block muted">
                <UserName id={tr.updatedBy} />
              </span>
            </dd>
          </div>
          <div>
            <dt>{t("common.field.version")}</dt>
            <dd>
              <bdi dir="ltr">{tr.version}</bdi>
            </dd>
          </div>
        </dl>
      </section>

      {canAudit ? <AuditTrail tr={tr} /> : null}

      {archiving ? (
        <ReasonDialog
          title={t("transformations.archive.title", { code: tr.code })}
          description={t("transformations.archive.description")}
          confirmLabel={t("transformations.archive.confirm")}
          onConfirm={archive}
          onClose={() => setArchiving(false)}
        />
      ) : null}
    </>
  );
}

function AuditTrail({ tr }: { tr: Transformation }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const arrow = useForwardArrow();
  const pager = useCursorPager();
  const query = useTransformationAudit(tr.id, pager.cursor, true);
  return (
    <section className="card" aria-labelledby="audit-title">
      <h2 id="audit-title" className="card__title">
        {t("transformations.audit.title")}
      </h2>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title={t("transformations.audit.empty")} />}
      >
        {(page) => (
          <>
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">{t("transformations.audit.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("transformations.audit.when")}</th>
                    <th scope="col">{t("transformations.audit.action")}</th>
                    <th scope="col">{t("transformations.audit.actor")}</th>
                    <th scope="col">{t("transformations.audit.versions")}</th>
                    <th scope="col">{t("transformations.audit.changes")}</th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDateTime(e.occurredAt, locale, tr.timezone)}</td>
                      <td>
                        {t(`transformations.audit.actions.${e.action.replace(/\./g, "_")}`, {
                          defaultValue: "",
                        }) || (
                          <bdi dir="ltr" className="code">
                            {e.action}
                          </bdi>
                        )}
                      </td>
                      <td>
                        {e.actor.type === "user"
                          ? (e.actor.displayName ?? t("common.value.unknown"))
                          : t(`transformations.audit.actorType.${e.actor.type}`)}
                      </td>
                      <td>
                        <bdi dir="ltr">
                          {e.priorVersion ?? "—"} → {e.newVersion ?? "—"}
                        </bdi>
                      </td>
                      <td>
                        {e.changes ? (
                          <ul className="plain-list">
                            {Object.entries(e.changes).map(([field, change]) => (
                              <li key={field}>
                                <bdi dir="ltr" className="code">
                                  {field}
                                </bdi>
                                : <bdi>{display(change.from)}</bdi> {arrow} <bdi>{display(change.to)}</bdi>
                              </li>
                            ))}
                          </ul>
                        ) : e.reason ? (
                          <span>
                            {t("common.form.reason")}: {e.reason}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              pageNumber={pager.pageNumber}
              hasPrevious={pager.hasPrevious}
              hasNext={Boolean(page.nextCursor)}
              onPrevious={pager.previous}
              onNext={() => pager.next(page.nextCursor)}
              pageSize={10}
              shownCount={page.items.length}
            />
          </>
        )}
      </QueryState>
    </section>
  );
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  return typeof value === "string" ? value : JSON.stringify(value);
}
