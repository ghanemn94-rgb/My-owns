// Administration > Audit (T-DG6-FE-B; ADR-0052 §8; REQ-S16-032): the global audit trail, read-only. listAuditEvents
// (audit_event.read; organizationId required; newest first; cursor pages) with the contract's filters, and
// getAuditEvent for one event with its field changes. Audit data is append-only: no write operation exists, and the
// page offers none. An event of a sensitive record the caller is not admitted to arrives `redacted` (reason and changes
// null, ADR-0051 §2) and is shown as redacted, never as "no reason". Versions are shown as the server records them
// (prior → new; a create has no prior version).
import { auditEventListQuery, type GlobalAuditEvent } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useAuditEvent, useAuditEvents, type P6Query } from "../../../api/p6.ts";
import { useAllTransformations } from "../../../api/queries.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { QueryState } from "../../../components/States.tsx";
import { formatDateTime, zonedLocalToUtcIso } from "../../../lib/format.ts";
import { Chip } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  Code,
  CursorPagerControls,
  Fact,
  useCursorPager,
  useHomeOrganizationId,
} from "../security/shared.tsx";

const AUDIT_TIME_ZONE = "Asia/Riyadh";

function Versions({ e }: { e: Pick<GlobalAuditEvent, "priorVersion" | "newVersion"> }) {
  const { t } = useTranslation();
  if (e.priorVersion === null && e.newVersion === null) return <>{t("adminP6.common.none")}</>;
  return (
    <span data-versions={`${e.priorVersion ?? ""}-${e.newVersion ?? ""}`}>
      {t("adminP6.audit.versionsValue", {
        prior: e.priorVersion ?? t("adminP6.audit.created"),
        next: e.newVersion ?? t("adminP6.common.none"),
      })}
    </span>
  );
}

function Actor({ e }: { e: GlobalAuditEvent }) {
  const { t } = useTranslation();
  return (
    <span className="block">
      {e.actor.displayName ?? t(`adminP6.audit.actorType.${e.actor.type}`)}
      <span className="block small muted">{t(`adminP6.audit.actorType.${e.actor.type}`)}</span>
    </span>
  );
}

export function RedactedChip() {
  const { t } = useTranslation();
  return <Chip tone="neutral" icon="lock" label={t("adminP6.audit.redacted")} data="redacted" />;
}

interface Filters {
  transformationId: string;
  recordType: string;
  action: string;
  from: string;
  to: string;
}
const NO_FILTERS: Filters = { transformationId: "", recordType: "", action: "", from: "", to: "" };

/** The query of listAuditEvents from the form; null when a filter fails the contract's own pattern. */
function toQuery(organizationId: string, f: Filters): P6Query | null {
  const q: P6Query = { organizationId };
  if (f.transformationId) q["transformationId"] = f.transformationId;
  if (f.recordType.trim()) q["recordType"] = f.recordType.trim();
  if (f.action.trim()) q["action"] = f.action.trim();
  if (f.from) {
    const iso = zonedLocalToUtcIso(`${f.from}T00:00`, AUDIT_TIME_ZONE);
    if (!iso) return null;
    q["from"] = iso;
  }
  if (f.to) {
    const iso = zonedLocalToUtcIso(`${f.to}T23:59`, AUDIT_TIME_ZONE);
    if (!iso) return null;
    q["to"] = iso;
  }
  return auditEventListQuery.safeParse(q).success ? q : null;
}

export function AuditEventsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.audit.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [applied, setApplied] = useState<P6Query>({ organizationId });
  const [invalid, setInvalid] = useState(false);
  const pager = useCursorPager();
  const events = useAuditEvents<GlobalAuditEvent>(applied, pager.cursor);
  const transformations = useAllTransformations({ organizationId, sort: "name:asc" });
  const trName = new Map((transformations.data ?? []).map((tr) => [tr.id, tr.name]));
  const apply = (f: Filters) => {
    const q = toQuery(organizationId, f);
    setInvalid(q === null);
    if (!q) return;
    pager.reset();
    setApplied(q);
  };
  const columns: RegisterColumn<GlobalAuditEvent>[] = [
    {
      id: "time",
      header: t("adminP6.audit.time"),
      rowHeader: true,
      hideable: false,
      cell: (e) => (
        <Link className="link" to={`/admin/audit/${encodeURIComponent(e.id)}`}>
          {formatDateTime(e.occurredAt, locale)}
        </Link>
      ),
      sortValue: (e) => e.seq.padStart(20, "0"),
    },
    {
      id: "action",
      header: t("adminP6.audit.action"),
      cell: (e) => <Code>{e.action}</Code>,
      sortValue: (e) => e.action,
    },
    {
      id: "record",
      header: t("adminP6.audit.record"),
      cell: (e) => (
        <span className="block">
          <Code>{e.recordType}</Code>
          <span className="block small muted">
            {e.transformationId ? (trName.get(e.transformationId) ?? <Code>{e.transformationId}</Code>) : null}
          </span>
        </span>
      ),
      sortValue: (e) => e.recordType,
      filterText: (e) => `${e.recordType} ${e.recordId}`,
    },
    {
      id: "actor",
      header: t("adminP6.audit.actor"),
      cell: (e) => <Actor e={e} />,
      sortValue: (e) => e.actor.displayName ?? e.actor.type,
    },
    { id: "versions", header: t("adminP6.audit.versions"), cell: (e) => <Versions e={e} /> },
    {
      id: "reason",
      header: t("adminP6.audit.reason"),
      cell: (e) => (e.redacted ? <RedactedChip /> : (e.reason ?? t("adminP6.common.none"))),
      filterText: (e) => e.reason ?? "",
    },
    {
      id: "source",
      header: t("adminP6.audit.source"),
      cell: (e) => t(`adminP6.audit.sourceKind.${e.source}`),
      sortValue: (e) => e.source,
    },
  ];
  return (
    <div className="page" data-p6-screen="audit">
      <PageHeader title={title} subtitle={t("nav.p6.audit.summary")} crumbs={adminCrumbs(t, { label: title })} />
      <p className="banner banner--info" role="note" data-state="append-only">
        <Icon name="lock" /> {t("adminP6.audit.appendOnly")}
      </p>
      <p className="small muted">{t("adminP6.audit.scopeNote")}</p>
      <Section id="audit-filters" title={t("adminP6.common.filters")}>
        <form
          className="form form--inset"
          noValidate
          data-form="audit-filters"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          {invalid ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" /> {t("adminP6.audit.invalidFilter")}
            </p>
          ) : null}
          <div className="grid grid--3">
            <div className="field">
              <label className="field__label" htmlFor="audit-transformation">
                {t("adminP6.common.transformation")}
              </label>
              <select
                id="audit-transformation"
                value={draft.transformationId}
                onChange={(e) => setDraft({ ...draft, transformationId: e.target.value })}
              >
                <option value="">{t("adminP6.common.allOption")}</option>
                {(transformations.data ?? []).map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="audit-record-type">
                {t("adminP6.audit.recordType")}
              </label>
              <p id="audit-record-type-hint" className="field__hint">
                {t("adminP6.audit.recordTypeHint")}
              </p>
              <input
                id="audit-record-type"
                dir="ltr"
                aria-describedby="audit-record-type-hint"
                value={draft.recordType}
                onChange={(e) => setDraft({ ...draft, recordType: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="audit-action">
                {t("adminP6.audit.action")}
              </label>
              <p id="audit-action-hint" className="field__hint">
                {t("adminP6.audit.actionHint")}
              </p>
              <input
                id="audit-action"
                dir="ltr"
                aria-describedby="audit-action-hint"
                value={draft.action}
                onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="audit-from">
                {t("adminP6.audit.from")}
              </label>
              <input
                id="audit-from"
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="audit-to">
                {t("adminP6.audit.to")}
              </label>
              <input
                id="audit-to"
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </div>
          </div>
          <div className="form__actions">
            <button type="submit" className="button button--primary">
              {t("adminP6.common.apply")}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => {
                setDraft(NO_FILTERS);
                apply(NO_FILTERS);
              }}
            >
              {t("adminP6.common.clear")}
            </button>
          </div>
        </form>
      </Section>
      <Section id="audit-events" title={t("adminP6.audit.listTitle")}>
        <QueryState query={events}>
          {(page) => (
            <>
              <RegisterTable
                id="p6-audit-events"
                caption={t("adminP6.audit.listTitle")}
                rows={page.items}
                columns={columns}
                getRowId={(e) => e.id}
                emptyTitle={t("adminP6.audit.empty")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={events.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function valueText(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export function AuditEventPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { auditEventId } = useParams();
  const title = t("nav.p6.auditEvent.title");
  usePageTitle(title);
  const event = useAuditEvent<GlobalAuditEvent>(auditEventId);
  return (
    <div className="page" data-p6-screen="audit-event">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.auditEvent.summary")}
        crumbs={adminCrumbs(t, { label: t("nav.p6.audit.title"), to: "/admin/audit" }, { label: title })}
      />
      <QueryState query={event}>
        {(e) => (
          <>
            <section className="card" aria-labelledby="audit-event-facts" data-audit-event={e.id}>
              <h2 id="audit-event-facts" className="card__title">
                <Code>{e.action}</Code>
              </h2>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.audit.time")}>{formatDateTime(e.occurredAt, locale)}</Fact>
                <Fact label={t("adminP6.audit.actor")}>
                  <Actor e={e} />
                </Fact>
                {e.onBehalfOfUserId ? (
                  <Fact label={t("adminP6.audit.onBehalfOf")}>
                    <Code>{e.onBehalfOfUserId}</Code>
                  </Fact>
                ) : null}
                <Fact label={t("adminP6.audit.record")}>
                  <Code>
                    {e.recordType} · {e.recordId}
                  </Code>
                </Fact>
                <Fact label={t("adminP6.audit.versions")}>
                  <Versions e={e} />
                </Fact>
                <Fact label={t("adminP6.audit.reason")}>
                  {e.redacted ? <RedactedChip /> : (e.reason ?? t("adminP6.common.none"))}
                </Fact>
                <Fact label={t("adminP6.audit.source")}>{t(`adminP6.audit.sourceKind.${e.source}`)}</Fact>
                <Fact label={t("adminP6.audit.requestId")}>
                  {e.requestId ? <Code>{e.requestId}</Code> : t("adminP6.common.none")}
                </Fact>
              </dl>
            </section>
            <Section id="audit-event-changes" title={t("adminP6.audit.changesTitle")}>
              {e.redacted ? (
                <RedactedChip />
              ) : !e.changes || Object.keys(e.changes).length === 0 ? (
                <p className="muted">{t("adminP6.audit.noChanges")}</p>
              ) : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={t("adminP6.audit.changesTitle")}>
                  <table className="table" data-table="audit-changes">
                    <caption className="visually-hidden">{t("adminP6.audit.changesTitle")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("adminP6.audit.field")}</th>
                        <th scope="col">{t("adminP6.audit.fromValue")}</th>
                        <th scope="col">{t("adminP6.audit.toValue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(e.changes).map(([field, change]) => (
                        <tr key={field}>
                          <th scope="row">
                            <Code>{field}</Code>
                          </th>
                          <td>
                            <bdi>{valueText(change.from)}</bdi>
                          </td>
                          <td>
                            <bdi>{valueText(change.to)}</bdi>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
            <p className="small">
              <Link className="link" to="/admin/audit">
                {t("adminP6.common.back")}
              </Link>
            </p>
          </>
        )}
      </QueryState>
    </div>
  );
}
