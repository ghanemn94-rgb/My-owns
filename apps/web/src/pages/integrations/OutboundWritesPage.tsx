// Administration > Integrations > Outbound writes (T-DG6-FE-C; ADR-0055 §5; REQ-S17-006 read side). The connector-defined
// downstream writes of a transformation. A write left "requested" or "pending_confirmation" is shown "Pending
// confirmation", never done; it is "Confirmed" only on a confirmed response from the adapter. There is no manual
// confirmation: "Check confirmation" asks the adapter for the outcome of the write's idempotency key (no second effect)
// and records it (outbound_write.execute, TD by default). outbound_write.read (TD, KDS, TO, AUD) reads.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { apiRequest, ApiError } from "../../api/client.ts";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { useCursorPager } from "../../components/DataTable.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { TableScrollRegion } from "../../components/TableScrollRegion.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import { TransformationEntry } from "../reports/ui.tsx";
import {
  OUTBOUND_WRITE_STATUSES,
  integrationPaths,
  outboundDisplayStatus,
  useIntegrationsRefresh,
  useOutboundWrite,
  useOutboundWrites,
  type OutboundWrite,
  type OutboundWriteDetail,
} from "./api.ts";
import { OutboundStatusChip, PagedTable, type Col } from "./ui.tsx";

/** Administration > Integrations > Outbound writes: choose the transformation. */
export function OutboundWritesEntryPage() {
  const { t } = useTranslation();
  return (
    <TransformationEntry
      screen="outbound-writes"
      title={t("integrations.outbound.title")}
      summary={t("integrations.outbound.intro")}
      area={{ label: t("integrations.title"), to: "/admin/integrations" }}
      to={(tid) => `/transformations/${tid}/outbound-writes`}
    />
  );
}

export function OutboundWritesPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { id = "" } = useParams();
  usePageTitle(t("integrations.outbound.title"));
  const transformation = useTransformation(id);
  const pager = useCursorPager();
  const [status, setStatus] = useState("");
  const { reset } = pager;
  useEffect(() => reset(), [status, reset]);
  const q = useOutboundWrites(id, status ? { status } : {}, pager.cursor);
  const cols: Col<OutboundWrite>[] = [
    {
      id: "createdAt",
      label: t("integrations.outbound.createdAt"),
      cell: (w) => (
        <Link className="link" to={`/transformations/${id}/outbound-writes/${w.id}`}>
          {formatDateTime(w.createdAt, locale)}
        </Link>
      ),
      sort: (w) => w.createdAt,
      hideable: false,
    },
    {
      id: "action",
      label: t("integrations.outbound.action"),
      cell: (w) => t(`integrations.outbound.actionCode.${w.actionCode}`),
    },
    {
      id: "status",
      label: t("integrations.field.status"),
      cell: (w) => <OutboundStatusChip status={w.status} />,
      sort: (w) => outboundDisplayStatus(w.status),
    },
    {
      id: "key",
      label: t("integrations.outbound.idempotencyKey"),
      cell: (w) => (
        <bdi dir="ltr" className="mono">
          {w.idempotencyKey}
        </bdi>
      ),
      sort: (w) => w.idempotencyKey,
    },
    {
      id: "attempts",
      label: t("integrations.outbound.attempts"),
      cell: (w) => w.attemptCount,
      sort: (w) => w.attemptCount,
    },
    {
      id: "reference",
      label: t("integrations.outbound.externalReference"),
      cell: (w) =>
        w.externalReference ? (
          <bdi dir="ltr">{w.externalReference}</bdi>
        ) : (
          <span className="muted">{t("integrations.outbound.noReference")}</span>
        ),
    },
    {
      id: "confirmedAt",
      label: t("integrations.outbound.confirmedAt"),
      cell: (w) =>
        w.confirmedAt ? (
          formatDateTime(w.confirmedAt, locale)
        ) : (
          <span className="muted">{t("integrations.outbound.notConfirmed")}</span>
        ),
      sort: (w) => w.confirmedAt,
    },
  ];
  return (
    <div className="page" data-p6-screen="integrations-outbound">
      <PageHeader
        title={t("integrations.outbound.title")}
        subtitle={t("integrations.outbound.intro")}
        crumbs={[
          { label: t("integrations.title"), to: "/admin/integrations/outbound-writes" },
          { label: transformation.data?.code ?? t("integrations.transformation"), to: `/transformations/${id}` },
          { label: t("integrations.outbound.title") },
        ]}
      />
      <p className="banner banner--info">
        <Icon name="info" /> <span>{t("integrations.outbound.noManualConfirmation")}</span>
      </p>
      <form className="filters" aria-label={t("common.filter.title")} onSubmit={(e) => e.preventDefault()}>
        <div className="filters__select">
          <label htmlFor="outbound-status-filter">{t("integrations.field.status")}</label>
          <select id="outbound-status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("common.filter.any")}</option>
            {OUTBOUND_WRITE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`integrations.outbound.filterStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </form>
      <QueryState
        query={q}
        isEmpty={(p) => p.items.length === 0 && pager.pageNumber === 1}
        empty={<EmptyState title={t("integrations.outbound.emptyTitle")} body={t("integrations.outbound.emptyBody")} />}
      >
        {(p) => (
          <PagedTable
            tableId="outbound"
            caption={t("integrations.outbound.title")}
            rows={p.items}
            cols={cols}
            getRowId={(w) => w.id}
            pager={pager}
            nextCursor={p.nextCursor}
            busy={q.isFetching}
          />
        )}
      </QueryState>
    </div>
  );
}

export function OutboundWritePage() {
  const { t } = useTranslation();
  const { id = "", writeId = "" } = useParams();
  usePageTitle(t("integrations.outbound.detailTitle"));
  const transformation = useTransformation(id);
  const q = useOutboundWrite(id, writeId);
  return (
    <div className="page" data-p6-screen="integrations-outbound-write">
      <PageHeader
        title={t("integrations.outbound.detailTitle")}
        crumbs={[
          { label: t("integrations.title"), to: "/admin/integrations/outbound-writes" },
          { label: transformation.data?.code ?? t("integrations.transformation"), to: `/transformations/${id}` },
          { label: t("integrations.outbound.title"), to: `/transformations/${id}/outbound-writes` },
          { label: t("integrations.outbound.detailTitle") },
        ]}
      />
      <QueryState query={q}>{(d) => <OutboundWriteView detail={d} tid={id} />}</QueryState>
    </div>
  );
}

function OutboundWriteView({ detail, tid }: { detail: OutboundWriteDetail; tid: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useIntegrationsRefresh();
  const w = detail.write;
  const final = w.status === "confirmed" || w.status === "failed";
  const canCheck = canAnywhere(me, "outbound_write.execute") && !final;
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setError(null);
    setNotice(null);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      const res = await apiRequest<OutboundWriteDetail>(integrationPaths.confirmOutboundWrite(tid, w.id), {
        method: "POST",
        body: {},
        ifMatch: w.version,
      });
      if (action.stale()) return;
      setBusy(false);
      setNotice(t(`integrations.outbound.checked.${outboundDisplayStatus(res.data.write.status)}`));
      await refresh();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setError(err);
      if (err instanceof ApiError && err.status === 409) await refresh();
    }
  };
  return (
    <>
      <section className="card" aria-labelledby="outbound-facts-h">
        <h2 id="outbound-facts-h" className="card__title">
          {t(`integrations.outbound.actionCode.${w.actionCode}`)}
        </h2>
        <dl className="facts">
          <dt>{t("integrations.field.status")}</dt>
          <dd>
            <OutboundStatusChip status={w.status} />
          </dd>
          <dt>{t("integrations.outbound.idempotencyKey")}</dt>
          <dd>
            <bdi dir="ltr" className="mono">
              {w.idempotencyKey}
            </bdi>
          </dd>
          <dt>{t("integrations.outbound.connector")}</dt>
          <dd>
            <Link className="link" to={`/admin/integrations/connectors/${w.connectorId}`}>
              {t("integrations.webhooks.openConnector")}
            </Link>{" "}
            <span className="small muted">
              {t("integrations.run.configVersion")}: {w.configVersionNo}
            </span>
          </dd>
          <dt>{t("integrations.outbound.attempts")}</dt>
          <dd>{w.attemptCount}</dd>
          <dt>{t("integrations.outbound.lastAttemptAt")}</dt>
          <dd>
            {w.lastAttemptAt ? (
              formatDateTime(w.lastAttemptAt, locale)
            ) : (
              <span className="muted">{t("integrations.outbound.noAttempt")}</span>
            )}
          </dd>
          <dt>{t("integrations.outbound.externalReference")}</dt>
          <dd>
            {w.externalReference ? (
              <bdi dir="ltr">{w.externalReference}</bdi>
            ) : (
              <span className="muted">{t("integrations.outbound.noReference")}</span>
            )}
          </dd>
          <dt>{t("integrations.outbound.confirmedAt")}</dt>
          <dd>
            {w.confirmedAt ? (
              formatDateTime(w.confirmedAt, locale)
            ) : (
              <span className="muted">{t("integrations.outbound.notConfirmed")}</span>
            )}
          </dd>
          {w.failureCode ? (
            <>
              <dt>{t("integrations.outbound.failure")}</dt>
              <dd>
                <bdi dir="ltr">{w.failureCode}</bdi>
              </dd>
            </>
          ) : null}
          <dt>{t("integrations.outbound.payloadHash")}</dt>
          <dd>
            <bdi dir="ltr" className="mono small">
              {w.payloadSha256}
            </bdi>
          </dd>
        </dl>
        <p className="small muted">{t("integrations.outbound.noManualConfirmation")}</p>
        {notice ? (
          <p className="banner banner--success" role="status">
            <Icon name="check" /> <span>{notice}</span>
          </p>
        ) : null}
        {error ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, error)}</span>
          </p>
        ) : null}
        {canCheck ? (
          <button type="button" className="button button--primary" disabled={busy} onClick={() => void check()}>
            <Icon name="refresh" /> {busy ? t("integrations.outbound.checking") : t("integrations.outbound.check")}
          </button>
        ) : null}
      </section>
      <section className="card" aria-labelledby="outbound-events-h">
        <h2 id="outbound-events-h" className="card__title">
          {t("integrations.outbound.eventsTitle")}
        </h2>
        <TableScrollRegion caption={t("integrations.outbound.eventsTitle")}>
          <table className="table" data-outbound-events>
            <caption className="visually-hidden">{t("integrations.outbound.eventsTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("integrations.run.occurredAt")}</th>
                <th scope="col">{t("integrations.field.status")}</th>
                <th scope="col">{t("integrations.outbound.attempts")}</th>
                <th scope="col">{t("integrations.outbound.externalReference")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((e) => (
                <tr key={e.recordVersion}>
                  <td>{formatDateTime(e.occurredAt, locale)}</td>
                  <td>
                    <OutboundStatusChip status={e.status} />
                  </td>
                  <td>{e.attemptCount}</td>
                  <td>
                    {e.externalReference ? (
                      <bdi dir="ltr">{e.externalReference}</bdi>
                    ) : (
                      <span className="muted">{t("integrations.outbound.noReference")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </section>
    </>
  );
}
