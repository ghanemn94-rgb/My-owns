// Transformation workspace (REQ-S03-011): the header shows the eight elements named in §3 — phase, gate readiness,
// North Star, owners, outcome health, benefits, key decisions, next required action. Since P2 the header composes gate
// readiness, the North Star and the open design decisions from the P2 resources (no dedicated header endpoint);
// elements whose records arrive in later stages show Unknown (never 0 or green). Archive needs a reason and If-Match.
// The workspace tabs lead to the P2 screens (Diagnose, Charter, Define, Design, Decisions, Gates, Evidence).
import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router";
import { ApiError, api } from "../../api/client.ts";
import {
  keys,
  useDecisions,
  useGates,
  useNorthStar,
  useTransformation,
  useTransformationAudit,
} from "../../api/queries.ts";
import type { Transformation } from "../../api/types.ts";
import { localName, useForwardArrow, useLocale } from "../../app/locale.ts";
import { canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { HealthChip, LifecycleChip, Unknown } from "../../components/Badges.tsx";
import { Pager, useCursorPager } from "../../components/DataTable.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { GateStatusChip } from "../../components/P2Badges.tsx";
import { WorkspaceTabs } from "../../components/Workspace.tsx";
import { EmptyState, NoPermissionState, QueryState } from "../../components/States.tsx";
import { describeAuditAction, describeAuditChanges, type AuditValue } from "../../lib/auditChanges.ts";
import { formatDateTime } from "../../lib/format.ts";
import { isNoPermission } from "../../lib/problem.ts";
import { BusinessUnitName, PhaseStepper, UserName, useBusinessUnitIndex, useTransformationTarget } from "./common.tsx";

/**
 * Router state the create page passes to the detail page. It carries the code and name the API returned to the
 * creator in the 201 response, so the creator is never left on a bare "Not found" for the record they just created.
 */
export interface CreatedNavigationState {
  readonly created: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    /**
     * F-DG2-580: the person who created it. The browser keeps router state in its history entry, so Back/Forward (or a
     * reload) can bring this state back after the tab's identity changed: it is shown only to that same person.
     */
    readonly createdBy: { readonly organizationId: string; readonly userId: string };
  };
}

function createdState(
  state: unknown,
  id: string | undefined,
  me: { readonly user: { readonly id: string; readonly organizationId: string } },
): CreatedNavigationState["created"] | null {
  const created = (state as Partial<CreatedNavigationState> | null)?.created;
  if (!created || typeof created !== "object" || created.id !== id) return null;
  const by = created.createdBy;
  if (!by || by.userId !== me.user.id || by.organizationId !== me.user.organizationId) return null;
  return created;
}

export { useTransformationTarget };

export function TransformationDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const query = useTransformation(id);
  const location = useLocation();
  const me = useMe();
  const created = createdState(location.state, id, me);
  usePageTitle(query.data ? `${query.data.code} · ${query.data.name}` : t("transformations.detailTitle"));
  // 403/404 means "not visible to you": never keep showing a cached copy (labelled stale) after the server says so.
  if (query.isError && isNoPermission(query.error)) {
    if (created) {
      return (
        <div className="page">
          <CreatedNotVisible created={created} />
        </div>
      );
    }
    return (
      <div className="page">
        <NoPermissionState error={query.error} />
      </div>
    );
  }
  const justCreated = created !== null;
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

/**
 * The creator got a 201 but may not read the record (F-DG1-004: e.g. a grant that covers create at a business unit
 * but not reads of the new transformation). Instead of a dead "Not found", confirm what was saved — as a draft, not
 * submitted or approved — and say what to do next. Nothing beyond the creator's own 201 response is disclosed.
 */
function CreatedNotVisible({ created }: { created: CreatedNavigationState["created"] }) {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader
        crumbs={[{ label: t("transformations.listTitle"), to: "/transformations" }, { label: created.code }]}
        title={t("transformations.createdNotVisible.title")}
      />
      <div className="state state--no-permission" role="alert" data-state="created-not-visible">
        <Icon name="lock" />
        <div>
          <p className="state__body">
            {t("transformations.createdNotVisible.body", { code: created.code, name: created.name })}
          </p>
          <p className="state__body">{t("transformations.createdNotVisible.next")}</p>
          <div className="state__action">
            <Link to="/transformations" className="button button--secondary">
              {t("transformations.createdNotVisible.back")}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

function Workspace({ tr }: { tr: Transformation }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const bu = useBusinessUnitIndex();
  const queryClient = useQueryClient();
  const begin = useSessionBoundAction();
  const target = useTransformationTarget(tr)!;
  const [archiving, setArchiving] = useState(false);
  const archived = tr.archivedAt !== null;
  const canUpdate = !archived && canOn(me, "transformation.update", target);
  const canArchive = !archived && canOn(me, "transformation.archive", target);
  const canAudit = canOn(me, "audit.read", target);

  const archive = async (reason: string) => {
    const action = begin(); // F-DG2-530: every effect below belongs to this session generation
    try {
      const updated = await api.send<Transformation>(`/api/v1/transformations/${tr.id}/archive`, {
        method: "POST",
        body: { reason },
        ifMatch: tr.version,
      });
      if (!action.setQueryData(keys.transformation(tr.id), updated)) return;
      await queryClient.invalidateQueries({ queryKey: ["transformations"] });
      await queryClient.invalidateQueries({ queryKey: ["transformation-audit", tr.id] });
      action.run(() => setArchiving(false));
    } catch (err) {
      if (action.stale(err)) throw err; // ReasonDialog drops it silently (SessionChangedError) or not at all
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

      <WorkspaceTabs tid={tr.id} />

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
              <HeaderGate tr={tr} />
            </dd>
          </div>
          <div>
            <dt>{t("transformations.workspace.northStar")}</dt>
            <dd>
              <HeaderNorthStar tid={tr.id} />
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
              <HeaderDecisions tid={tr.id} />
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

/** The product gate that closes the current phase (G1 Diagnose … G6 Realize), with its live readiness. */
const PHASE_GATE: Record<string, string> = {
  diagnose: "G1",
  define: "G2",
  design: "G3",
  mobilize: "G4",
  transform: "G5",
  realize: "G6",
};

function HeaderGate({ tr }: { tr: Transformation }) {
  const { t } = useTranslation();
  const gates = useGates(tr.id);
  const code = PHASE_GATE[tr.currentPhase] ?? "G1";
  const view = gates.data?.items.find((g) => g.definition.code === code);
  if (gates.isPending) return <span className="muted">{t("common.state.loading")}</span>;
  if (!view) return <Unknown hint={t("transformations.workspace.notVisible")} />;
  const mandatory = view.criteria.filter((c) => c.mandatory);
  const complete = mandatory.filter((c) => c.completeness === "complete").length;
  return (
    <span className="block">
      <Link className="link" to={`/transformations/${tr.id}/gates/${code}`}>
        {code}
      </Link>{" "}
      <GateStatusChip status={view.gate.status} />
      <span className="block small">
        {view.submissionEnabled ? t("gates.readiness", { complete, total: mandatory.length }) : t("gates.notEnabled")}
      </span>
    </span>
  );
}

function HeaderNorthStar({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const ns = useNorthStar(tid);
  if (ns.isPending) return <span className="muted">{t("common.state.loading")}</span>;
  if (ns.isError) return <Unknown hint={t("transformations.workspace.notVisible")} />;
  return ns.data ? <q>{ns.data.statement}</q> : <Unknown hint={t("define.northStar.notSet")} />;
}

function HeaderDecisions({ tid }: { tid: string }) {
  const { t } = useTranslation();
  const decisions = useDecisions(tid, "design");
  if (decisions.isPending) return <span className="muted">{t("common.state.loading")}</span>;
  if (decisions.isError) return <Unknown hint={t("transformations.workspace.notVisible")} />;
  const open = decisions.data.filter((d) => d.status === "open").length;
  return (
    <Link className="link" to={`/transformations/${tid}/decisions`}>
      {t("transformations.workspace.openDecisions", { n: open, total: decisions.data.length })}
    </Link>
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
                        {describeAuditAction(t, e.action, e.changes) ?? (
                          <>
                            <bdi dir="ltr" className="code">
                              {e.action}
                            </bdi>{" "}
                            <span className="muted small">({t("transformations.audit.untranslatedAction")})</span>
                          </>
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
                            {describeAuditChanges(t, e.changes).map((c) => (
                              <li key={c.field}>
                                {c.label ?? (
                                  <>
                                    <bdi dir="ltr" className="code">
                                      {c.field}
                                    </bdi>{" "}
                                    <span className="muted small">
                                      ({t("transformations.audit.untranslatedField")})
                                    </span>
                                  </>
                                )}
                                : <AuditValueView value={c.from} tz={tr.timezone} transformationId={tr.id} /> {arrow}{" "}
                                <AuditValueView value={c.to} tz={tr.timezone} transformationId={tr.id} />
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

/** One side of an audited change, localized (F-DG1-005). Untranslated codes stay visible, LTR-isolated and marked. */
export function AuditValueView({
  value,
  tz,
  transformationId,
}: {
  value: AuditValue;
  tz: string;
  /** The transformation whose trail this is: a scope on it reads "this transformation". */
  transformationId?: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const bu = useBusinessUnitIndex();
  switch (value.kind) {
    case "none":
      return <span className="muted">{t("common.value.none")}</span>;
    case "label":
    case "text":
      return <bdi>{value.text}</bdi>;
    case "code":
      return (
        <bdi dir="ltr" className="code">
          {value.text}
        </bdi>
      );
    case "user":
      return (
        <bdi>
          <UserName id={value.id} />
        </bdi>
      );
    case "businessUnit":
      return (
        <bdi>
          <BusinessUnitName id={value.id} index={bu.byId} />
        </bdi>
      );
    case "datetime":
      return <bdi>{formatDateTime(value.iso, locale, tz) ?? value.iso}</bdi>;
    case "scope": {
      const type = t(`admin.scopeType.${value.scopeType}`);
      let name: ReactNode;
      if (value.scopeType === "business_unit") name = <BusinessUnitName id={value.id} index={bu.byId} />;
      else if (value.scopeType === "organization")
        name =
          value.id === me.organization.id ? (
            localName(me.organization, locale)
          ) : (
            <Unknown hint={t("common.value.notVisible")} />
          );
      else if (value.id === transformationId) name = t("transformations.audit.value.thisTransformation");
      else
        name = (
          <bdi dir="ltr" className="code">
            {value.id}
          </bdi>
        );
      return (
        <bdi>
          {type}: {name}
        </bdi>
      );
    }
    case "untranslated":
      return (
        <span>
          <bdi dir="ltr" className="code">
            {value.raw}
          </bdi>{" "}
          <span className="muted small">({t("transformations.audit.untranslatedValue")})</span>
        </span>
      );
  }
}
