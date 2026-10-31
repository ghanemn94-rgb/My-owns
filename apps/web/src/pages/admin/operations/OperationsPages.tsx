// Administration > Operations (T-DG6-FE-B; ADR-0053 §2, §6, §7; REQ-S12-019). The worker heartbeat (getWorkerHeartbeat)
// and the operational exceptions (listOperationalExceptions, getOperationalException) with acknowledge and resolve
// (operations.acknowledge; If-Match the exception's version; resolve needs a note). The screen follows the contract's
// values and never improves them:
//  - the heartbeat `unknown` (no beat recorded) and `stale` are never shown as running, and never green;
//  - a linked KPI shows the DG4 freshness label the server sends (Fresh, Stale, Unknown), its last known value as the
//    decimal string the server sends and its date; a null value is "Unknown", never 0;
//  - a resolved exception is final (no action is offered on it).
// The response types are written from docs/api/openapi.yaml 1.5.0-p6 (no zod mirror exists for slice J at this
// revision); the OpenAPI file is the source of truth.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import {
  p6Paths,
  useOperationalException,
  useOperationalExceptions,
  useP6AdminRefresh,
  useWorkerHeartbeat,
  type P6Query,
} from "../../../api/p6.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { HumanDecisionNote, NoteForm, StatusChip, useRunner } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  Code,
  CursorPagerControls,
  Fact,
  ReadOnlyNote,
  useCan,
  useCursorPager,
  useHomeOrganizationId,
} from "../security/shared.tsx";

export type ExceptionStatus = "open" | "acknowledged" | "resolved";

export interface OperationalException {
  readonly id: string;
  readonly organizationId: string | null;
  readonly sourceKind: "job" | "connector" | "data_freshness" | "worker";
  readonly sourceCode: string;
  readonly failureClass: string;
  readonly dedupKey: string;
  readonly status: ExceptionStatus;
  readonly occurrenceCount: number;
  readonly firstOccurredAt: string;
  readonly lastOccurredAt: string;
  readonly lastErrorCode: string;
  readonly lastErrorMessage: string;
  readonly serviceIdentityId: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly acknowledgeNote: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
  readonly resolution: "manual" | "recovered" | null;
  readonly resolutionNote: string | null;
  readonly linkedKpiCount: number;
  readonly version: number;
}

export interface LinkedKpi {
  readonly kpiDefinitionId: string;
  readonly transformationId: string;
  readonly name: string;
  readonly unitKind: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly lastValue: string | null;
  readonly lastValueAt: string | null;
}

export interface OperationalExceptionDetail extends OperationalException {
  readonly linkedKpis: readonly LinkedKpi[];
  readonly hiddenKpiCount: number;
  readonly events: readonly {
    readonly recordVersion: number;
    readonly eventKind: string;
    readonly status: ExceptionStatus;
    readonly occurrenceCount: number;
    readonly errorCode: string;
    readonly actorUserId: string | null;
    readonly note: string | null;
    readonly occurredAt: string;
  }[];
}

export interface WorkerHeartbeat {
  readonly status: "alive" | "stale" | "unknown";
  readonly checkedAt: string;
  readonly staleAfterSeconds: number;
  readonly newestBeatAt: string | null;
  readonly instances: readonly {
    readonly instanceKey: string;
    readonly appVersion: string;
    readonly startedAt: string;
    readonly lastBeatAt: string;
    readonly beatCount: string;
    readonly queueCount: number;
    readonly status: "alive" | "stale";
  }[];
}

/** Status → chip tone and icon. "unknown" and "stale" are never the favourable tone. */
const HEARTBEAT_TABLE = {
  alive: ["good", "check"],
  stale: ["stale", "clock"],
  unknown: ["neutral", "question"],
} as const;
const EXCEPTION_TABLE = {
  open: ["bad", "alert"],
  acknowledged: ["warn", "clock"],
  resolved: ["closed", "check"],
} as const;
const FRESHNESS_TABLE = {
  fresh: ["good", "check"],
  stale: ["stale", "clock"],
  unknown: ["neutral", "question"],
} as const;

export function HeartbeatChip({ status }: { status: string }) {
  return <StatusChip value={status} table={HEARTBEAT_TABLE} labelKey="adminP6.operations.heartbeatStatus" />;
}
export function ExceptionStatusChip({ status }: { status: string }) {
  return <StatusChip value={status} table={EXCEPTION_TABLE} labelKey="adminP6.operations.statusValue" />;
}

function OperationsLinks() {
  const { t } = useTranslation();
  return (
    <p className="small">
      <Link className="link" to="/admin/service-identities">
        {t("adminP6.operations.serviceIdentitiesLink")}
      </Link>{" "}
      ·{" "}
      <Link className="link" to="/admin/jobs/operations">
        {t("adminP6.operations.jobsLink")}
      </Link>
    </p>
  );
}

function HeartbeatCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const heartbeat = useWorkerHeartbeat<WorkerHeartbeat>();
  return (
    <Section id="worker-heartbeat" title={t("adminP6.operations.heartbeatTitle")}>
      <QueryState query={heartbeat}>
        {(h) => (
          <>
            {/* The overall worker status: exactly one labelled chip. The per-instance chips follow in their own
                table, outside this element, so the overall status is never confused with one instance's. */}
            <div data-heartbeat={h.status}>
              <p>
                <HeartbeatChip status={h.status} />
              </p>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.operations.newestBeat")}>
                  {h.newestBeatAt ? formatDateTime(h.newestBeatAt, locale) : t("adminP6.common.unknown")}
                </Fact>
                <Fact label={t("adminP6.operations.staleAfter")}>
                  {t("adminP6.operations.seconds", { count: h.staleAfterSeconds })}
                </Fact>
                <Fact label={t("adminP6.operations.checkedAt")}>{formatDateTime(h.checkedAt, locale)}</Fact>
              </dl>
            </div>
            {h.instances.length === 0 ? (
              <p className="muted small">{t("adminP6.operations.noInstances")}</p>
            ) : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t("adminP6.operations.instances")}>
                <table className="table" data-table="worker-instances">
                  <caption className="visually-hidden">{t("adminP6.operations.instances")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("adminP6.operations.instance")}</th>
                      <th scope="col">{t("adminP6.operations.status")}</th>
                      <th scope="col">{t("adminP6.operations.lastBeat")}</th>
                      <th scope="col">{t("adminP6.operations.startedAt")}</th>
                      <th scope="col">{t("adminP6.operations.appVersion")}</th>
                      <th scope="col">{t("adminP6.operations.queueCount")}</th>
                      <th scope="col">{t("adminP6.operations.beatCount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.instances.map((i) => (
                      <tr key={i.instanceKey}>
                        <th scope="row">
                          <Code>{i.instanceKey}</Code>
                        </th>
                        <td>
                          <HeartbeatChip status={i.status} />
                        </td>
                        <td>{formatDateTime(i.lastBeatAt, locale)}</td>
                        <td>{formatDateTime(i.startedAt, locale)}</td>
                        <td>
                          <Code>{i.appVersion}</Code>
                        </td>
                        <td>{i.queueCount}</td>
                        <td>
                          <bdi dir="ltr">{i.beatCount}</bdi>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </QueryState>
    </Section>
  );
}

export function OperationsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.operations.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const [search, setSearch] = useSearchParams();
  const status = search.get("status") ?? "open,acknowledged";
  const pager = useCursorPager();
  // The contract's `status` is an exploded array (style form): "open,acknowledged" is sent as two `status` parameters
  // (buildUrl repeats array values), so the server filters and the cursor pages stay exact.
  const query = {
    organizationId,
    ...(status ? { status: status.split(",") } : {}),
  } as unknown as P6Query;
  const exceptions = useOperationalExceptions<OperationalException>(query, pager.cursor);
  const columns: RegisterColumn<OperationalException>[] = [
    {
      id: "source",
      header: t("adminP6.operations.source"),
      rowHeader: true,
      hideable: false,
      cell: (x) => (
        <span className="block">
          <Link className="link" to={`/admin/operations/exceptions/${encodeURIComponent(x.id)}`}>
            {t(`adminP6.operations.failureClassValue.${x.failureClass}`, { defaultValue: x.failureClass })}
          </Link>
          <span className="block small muted">
            {t(`adminP6.operations.sourceKind.${x.sourceKind}`)} · <Code>{x.sourceCode}</Code>
          </span>
        </span>
      ),
      sortValue: (x) => x.sourceCode,
      filterText: (x) => `${x.sourceCode} ${x.failureClass} ${x.lastErrorCode}`,
    },
    {
      id: "status",
      header: t("adminP6.operations.status"),
      cell: (x) => <ExceptionStatusChip status={x.status} />,
      sortValue: (x) => x.status,
    },
    {
      id: "occurrences",
      header: t("adminP6.operations.occurrences"),
      cell: (x) => <span data-occurrences={x.occurrenceCount}>{x.occurrenceCount}</span>,
      sortValue: (x) => x.occurrenceCount,
    },
    {
      id: "last",
      header: t("adminP6.operations.lastOccurred"),
      cell: (x) => formatDateTime(x.lastOccurredAt, locale),
      sortValue: (x) => x.lastOccurredAt,
    },
    {
      id: "kpis",
      header: t("adminP6.operations.linkedKpis"),
      cell: (x) => x.linkedKpiCount,
      sortValue: (x) => x.linkedKpiCount,
    },
    { id: "error", header: t("adminP6.operations.lastErrorCode"), cell: (x) => <Code>{x.lastErrorCode}</Code> },
  ];
  const setStatus = (value: string) => {
    const next = new URLSearchParams(search);
    next.set("status", value);
    pager.reset();
    setSearch(next, { replace: true });
  };
  return (
    <div className="page" data-p6-screen="operations">
      <PageHeader title={title} subtitle={t("nav.p6.operations.summary")} crumbs={adminCrumbs(t, { label: title })} />
      <HumanDecisionNote />
      <OperationsLinks />
      <HeartbeatCard />
      <Section
        id="operational-exceptions"
        title={t("adminP6.operations.exceptionsTitle")}
        intro={t("adminP6.operations.exceptionsIntro")}
      >
        <div className="field">
          <label className="field__label" htmlFor="exceptions-status">
            {t("adminP6.operations.status")}
          </label>
          <select id="exceptions-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open,acknowledged">
              {t("adminP6.operations.statusValue.open")} + {t("adminP6.operations.statusValue.acknowledged")}
            </option>
            <option value="open">{t("adminP6.operations.statusValue.open")}</option>
            <option value="acknowledged">{t("adminP6.operations.statusValue.acknowledged")}</option>
            <option value="resolved">{t("adminP6.operations.statusValue.resolved")}</option>
            <option value="">{t("adminP6.common.allOption")}</option>
          </select>
        </div>
        <QueryState query={exceptions}>
          {(page) => (
            <>
              <RegisterTable
                id="p6-operational-exceptions"
                caption={t("adminP6.operations.exceptionsTitle")}
                rows={page.items}
                columns={columns}
                getRowId={(x) => x.id}
                emptyTitle={t("adminP6.operations.empty")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={exceptions.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function KpiValue({ k }: { k: LinkedKpi }) {
  const { t } = useTranslation();
  // The decimal string as sent (never parsed to a float, never defaulted to 0); null is Unknown.
  return k.lastValue === null ? (
    <span data-last-value="unknown">{t("adminP6.operations.noLastValue")}</span>
  ) : (
    <bdi dir="ltr" data-last-value={k.lastValue}>
      {k.lastValue}
    </bdi>
  );
}

export function OperationalExceptionPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { exceptionId } = useParams();
  const title = t("nav.p6.operationalException.title");
  usePageTitle(title);
  const detail = useOperationalException<OperationalExceptionDetail>(exceptionId);
  const canAct = useCan("operations.acknowledge");
  const refresh = useP6AdminRefresh("operations", "audit");
  const runner = useRunner(refresh);
  const [acting, setActing] = useState<"acknowledge" | "resolve" | null>(null);
  return (
    <div className="page" data-p6-screen="operational-exception">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.operationalException.summary")}
        crumbs={adminCrumbs(t, { label: t("nav.p6.operations.title"), to: "/admin/operations" }, { label: title })}
      />
      {runner.alert}
      <QueryState query={detail}>
        {(x) => (
          <>
            <section className="card" aria-labelledby="exception-facts" data-exception={x.id} data-status={x.status}>
              <h2 id="exception-facts" className="card__title">
                {t(`adminP6.operations.failureClassValue.${x.failureClass}`, { defaultValue: x.failureClass })}{" "}
                <ExceptionStatusChip status={x.status} />
              </h2>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.operations.source")}>
                  {t(`adminP6.operations.sourceKind.${x.sourceKind}`)} · <Code>{x.sourceCode}</Code>
                </Fact>
                <Fact label={t("adminP6.operations.occurrences")}>{x.occurrenceCount}</Fact>
                <Fact label={t("adminP6.operations.firstOccurred")}>{formatDateTime(x.firstOccurredAt, locale)}</Fact>
                <Fact label={t("adminP6.operations.lastOccurred")}>{formatDateTime(x.lastOccurredAt, locale)}</Fact>
                <Fact label={t("adminP6.operations.lastErrorCode")}>
                  <Code>{x.lastErrorCode}</Code>
                </Fact>
                <Fact label={t("adminP6.operations.lastError")}>
                  <bdi>{x.lastErrorMessage}</bdi>
                </Fact>
                {x.serviceIdentityId ? (
                  <Fact label={t("adminP6.operations.serviceIdentity")}>
                    <Link className="link" to={`/admin/service-identities/${encodeURIComponent(x.serviceIdentityId)}`}>
                      <Code>{x.serviceIdentityId}</Code>
                    </Link>
                  </Fact>
                ) : null}
                {x.acknowledgedAt ? (
                  <Fact label={t("adminP6.operations.acknowledgedBy")}>
                    {formatDateTime(x.acknowledgedAt, locale)}
                    {x.acknowledgeNote ? ` · ${x.acknowledgeNote}` : ""}
                  </Fact>
                ) : null}
                {x.resolvedAt ? (
                  <Fact label={t("adminP6.operations.resolvedBy")}>
                    {formatDateTime(x.resolvedAt, locale)}
                    {x.resolution ? ` · ${t(`adminP6.operations.resolutionValue.${x.resolution}`)}` : ""}
                    {x.resolutionNote ? ` · ${x.resolutionNote}` : ""}
                  </Fact>
                ) : null}
              </dl>
              {x.status === "resolved" ? (
                <p className="small muted">
                  <Icon name="info" /> {t("adminP6.operations.resolvedFinal")}
                </p>
              ) : canAct ? (
                <div className="form__actions">
                  {x.status === "open" ? (
                    <button
                      type="button"
                      className="button button--secondary"
                      data-action="acknowledge"
                      disabled={runner.busy}
                      onClick={() => setActing("acknowledge")}
                    >
                      {t("adminP6.operations.acknowledge")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button button--primary"
                    data-action="resolve"
                    disabled={runner.busy}
                    onClick={() => setActing("resolve")}
                  >
                    {t("adminP6.operations.resolve")}
                  </button>
                </div>
              ) : (
                <ReadOnlyNote />
              )}
              {acting && x.status !== "resolved" ? (
                <NoteForm
                  key={`${acting}-${x.version}`}
                  id={`exception-${acting}`}
                  label={
                    acting === "acknowledge"
                      ? t("adminP6.operations.acknowledgeNote")
                      : t("adminP6.operations.resolveNote")
                  }
                  submitLabel={
                    acting === "acknowledge" ? t("adminP6.operations.acknowledge") : t("adminP6.operations.resolve")
                  }
                  required={acting === "resolve"}
                  min={3}
                  busy={runner.busy}
                  onSubmit={(note) =>
                    void runner
                      .run(
                        acting === "acknowledge"
                          ? p6Paths.acknowledgeOperationalException(x.id)
                          : p6Paths.resolveOperationalException(x.id),
                        { body: { note: acting === "acknowledge" ? note || null : note }, ifMatch: x.version },
                      )
                      .then((r) => {
                        if (r) setActing(null);
                      })
                  }
                />
              ) : null}
            </section>
            <Section id="exception-kpis" title={t("adminP6.operations.linkedKpis")}>
              {x.linkedKpis.length === 0 && x.hiddenKpiCount === 0 ? (
                <p className="muted">{t("adminP6.operations.noLinkedKpis")}</p>
              ) : null}
              {x.linkedKpis.length > 0 ? (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={t("adminP6.operations.linkedKpis")}>
                  <table className="table" data-table="exception-kpis">
                    <caption className="visually-hidden">{t("adminP6.operations.linkedKpis")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("adminP6.operations.kpiName")}</th>
                        <th scope="col">{t("adminP6.operations.freshness")}</th>
                        <th scope="col">{t("adminP6.operations.lastValue")}</th>
                        <th scope="col">{t("adminP6.operations.lastValueAt")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {x.linkedKpis.map((k) => (
                        <tr key={k.kpiDefinitionId} data-kpi-freshness={k.freshness}>
                          <th scope="row">
                            <Link
                              className="link"
                              to={`/transformations/${encodeURIComponent(k.transformationId)}/kpis/${encodeURIComponent(k.kpiDefinitionId)}`}
                            >
                              {k.name}
                            </Link>
                          </th>
                          <td>
                            <StatusChip
                              value={k.freshness}
                              table={FRESHNESS_TABLE}
                              labelKey="adminP6.operations.freshnessValue"
                            />
                          </td>
                          <td>
                            <KpiValue k={k} />
                          </td>
                          <td>{k.lastValueAt ? formatDateTime(k.lastValueAt, locale) : t("adminP6.common.unknown")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {x.hiddenKpiCount > 0 ? (
                <p className="small muted" data-hidden-kpis={x.hiddenKpiCount}>
                  <Icon name="lock" /> {t("adminP6.operations.hiddenKpis", { count: x.hiddenKpiCount })}
                </p>
              ) : null}
            </Section>
            <Section id="exception-history" title={t("adminP6.operations.eventsTitle")}>
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t("adminP6.operations.eventsTitle")}>
                <table className="table" data-table="exception-events">
                  <caption className="visually-hidden">{t("adminP6.operations.eventsTitle")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("adminP6.audit.time")}</th>
                      <th scope="col">{t("adminP6.operations.eventsTitle")}</th>
                      <th scope="col">{t("adminP6.operations.status")}</th>
                      <th scope="col">{t("adminP6.operations.occurrences")}</th>
                      <th scope="col">{t("adminP6.operations.lastErrorCode")}</th>
                      <th scope="col">{t("adminP6.operations.note")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.events.map((ev) => (
                      <tr key={ev.recordVersion}>
                        <th scope="row">{formatDateTime(ev.occurredAt, locale)}</th>
                        <td>{t(`adminP6.operations.eventKind.${ev.eventKind}`, { defaultValue: ev.eventKind })}</td>
                        <td>
                          <ExceptionStatusChip status={ev.status} />
                        </td>
                        <td>{ev.occurrenceCount}</td>
                        <td>
                          <Code>{ev.errorCode}</Code>
                        </td>
                        <td>{ev.note ?? t("adminP6.common.none")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
      </QueryState>
    </div>
  );
}
