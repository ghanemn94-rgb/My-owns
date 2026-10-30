// Administration > Integrations > Connectors (T-DG6-FE-C; p6-work-split §B/A.9; ADR-0055 §1-§4; REQ-S17-001,
// REQ-S17-005). The list of an organization's connectors, one connector's detail with its run history, and one run's
// detail with its retry chain.
//  - Verification is "Not verified" until a test run succeeds on the current configuration; the last success is "Never
//    succeeded" when none; a null row count is "Unknown"; a reconciliation not checked is "Not checked".
//  - The newest failed run's actionable error shows which run, why and what to do, with the two fallback links.
//  - ADM_TECH (connector.configure) tests, enables, disables and edits; ADM_TECH and KDS (connector.run) run now and
//    retry. AUD, TD and TO read only: no write control is shown, and the server answers 403 to every write anyway.
//  - One form-level alert per form or dialog; every write belongs to the session its click started under.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { apiRequest, ApiError, newIdempotencyKey } from "../../api/client.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard, useSessionBoundAction } from "../../auth/sessionBound.ts";
import { useCursorPager } from "../../components/DataTable.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { TableScrollRegion } from "../../components/TableScrollRegion.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import { OrganizationPicker, useSelectedOrganization } from "../admin/UsersPage.tsx";
import {
  INTEGRATION_RUN_STATUSES,
  integrationPaths,
  useConnector,
  useConnectors,
  useIntegrationRun,
  useIntegrationRuns,
  useIntegrationsRefresh,
  type Connector,
  type IntegrationRun,
  type IntegrationRunDetail,
} from "./api.ts";
import {
  ActionableErrorPanel,
  ConnectorStatusChip,
  Count,
  IntegrationsTabs,
  LastSuccess,
  PagedTable,
  ReconciliationChip,
  RunStatusChip,
  SecretRefText,
  VerificationChip,
  codeKey,
  type Col,
} from "./ui.tsx";

const adminCrumb = (t: (k: string) => string) => ({ label: t("nav.areas.admin.label"), to: "/admin" });
const integrationsCrumb = (t: (k: string) => string) => ({
  label: t("integrations.title"),
  to: "/admin/integrations",
});

// ------------------------------------------------------------------------------------------------ list

export function ConnectorsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("integrations.connectors.title"));
  const org = useSelectedOrganization();
  const pager = useCursorPager();
  const [status, setStatus] = useState<"" | "enabled" | "disabled">("");
  const { reset } = pager;
  useEffect(() => reset(), [status, org.organizationId, reset]);
  const query = useConnectors({ organizationId: org.organizationId, ...(status ? { status } : {}) }, pager.cursor);
  const canConfigure = canAnywhere(me, "connector.configure");
  const cols: Col<Connector>[] = [
    {
      id: "name",
      label: t("integrations.field.name"),
      cell: (c) => (
        <Link className="link" to={`/admin/integrations/connectors/${c.id}`}>
          {localName(c, locale)}
        </Link>
      ),
      sort: (c) => localName(c, locale) ?? "",
      hideable: false,
    },
    {
      id: "code",
      label: t("integrations.field.code"),
      cell: (c) => <bdi dir="ltr">{c.code}</bdi>,
      sort: (c) => c.code,
    },
    {
      id: "adapter",
      label: t("integrations.field.adapterKind"),
      cell: (c) => t(`integrations.adapter.${c.adapterKind}`),
      sort: (c) => c.adapterKind,
    },
    {
      id: "status",
      label: t("integrations.field.status"),
      cell: (c) => <ConnectorStatusChip status={c.status} />,
      sort: (c) => c.status,
    },
    {
      id: "verification",
      label: t("integrations.field.verification"),
      cell: (c) => <VerificationChip verification={c.verification} />,
      sort: (c) => c.verification,
    },
    {
      id: "lastSuccess",
      label: t("integrations.field.lastSuccess"),
      cell: (c) => <LastSuccess at={c.lastSuccessAt} />,
      sort: (c) => c.lastSuccessAt,
    },
    {
      id: "lastRun",
      label: t("integrations.field.lastRun"),
      cell: (c) =>
        c.lastRun ? (
          <span>
            <RunStatusChip status={c.lastRun.status} />{" "}
            <span className="small muted">{formatDateTime(c.lastRun.queuedAt, locale)}</span>
          </span>
        ) : (
          <span className="muted">{t("integrations.runs.none")}</span>
        ),
      sort: (c) => c.lastRun?.queuedAt ?? null,
    },
    {
      id: "error",
      label: t("integrations.field.actionableError"),
      cell: (c) =>
        c.actionableError ? (
          <span className="status-chip status-chip--off-track" data-has-error>
            <Icon name="alert" /> {t(`integrations.actionable.${codeKey(c.actionableError.errorCode)}.short`)}
          </span>
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
    },
  ];
  return (
    <div className="page" data-p6-screen="integrations-connectors">
      <PageHeader
        title={t("integrations.connectors.title")}
        subtitle={t("integrations.connectors.intro")}
        crumbs={[adminCrumb(t), { label: t("integrations.title") }]}
        actions={
          canConfigure ? (
            <Link className="button button--primary" to="/admin/integrations/connectors/new">
              <Icon name="plus" /> {t("integrations.connectors.new")}
            </Link>
          ) : null
        }
      />
      <IntegrationsTabs current="connectors" />
      <form className="filters" aria-label={t("common.filter.title")} onSubmit={(e) => e.preventDefault()}>
        <OrganizationPicker
          organizationId={org.organizationId}
          organizations={org.organizations}
          onSelect={org.select}
        />
        <div className="filters__select">
          <label htmlFor="connector-status-filter">{t("integrations.field.status")}</label>
          <select
            id="connector-status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">{t("common.filter.any")}</option>
            <option value="enabled">{t("integrations.status.enabled")}</option>
            <option value="disabled">{t("integrations.status.disabled")}</option>
          </select>
        </div>
      </form>
      <QueryState
        query={query}
        isEmpty={(p) => p.items.length === 0 && pager.pageNumber === 1}
        empty={
          <EmptyState title={t("integrations.connectors.emptyTitle")} body={t("integrations.connectors.emptyBody")} />
        }
      >
        {(p) => (
          <PagedTable
            tableId="connectors"
            caption={t("integrations.connectors.title")}
            rows={p.items}
            cols={cols}
            getRowId={(c) => c.id}
            pager={pager}
            nextCursor={p.nextCursor}
            busy={query.isFetching}
          />
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ detail

export function ConnectorPage() {
  const { t } = useTranslation();
  const { connectorId = "" } = useParams();
  const q = useConnector(connectorId);
  usePageTitle(t("integrations.connector.title"));
  return (
    <div className="page" data-p6-screen="integrations-connector">
      <QueryState query={q}>{(c) => <ConnectorView connector={c} />}</QueryState>
    </div>
  );
}

function ConnectorView({ connector: c }: { connector: Connector }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useIntegrationsRefresh();
  const canConfigure = canAnywhere(me, "connector.configure");
  const canRun = canAnywhere(me, "connector.run");
  const [dialog, setDialog] = useState<"enable" | "disable" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A failed test is reported as a warning, never in the success style (status is never implied favourable).
  const [noticeTone, setNoticeTone] = useState<"success" | "warning">("success");
  const [actionError, setActionError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"test" | "run" | null>(null);
  const name = localName(c, locale) ?? c.code;
  const cfg = c.config;

  const toggle = async (kind: "enable" | "disable", reason: string) => {
    const action = beginSessionGuard();
    await apiRequest<Connector>(kind === "enable" ? integrationPaths.enable(c.id) : integrationPaths.disable(c.id), {
      method: "POST",
      body: { reason },
      ifMatch: c.version,
    });
    if (action.stale()) return;
    setDialog(null);
    setNoticeTone("success");
    setNotice(t(kind === "enable" ? "integrations.connector.enabled" : "integrations.connector.disabled"));
    await refresh();
  };

  const start = async (kind: "test" | "run") => {
    setActionError(null);
    setNotice(null);
    const action = beginSessionGuard();
    setBusy(kind);
    try {
      const res = await apiRequest<IntegrationRun>(
        kind === "test" ? integrationPaths.test(c.id) : integrationPaths.runs(c.id),
        {
          method: "POST",
          body: {},
          ...(kind === "run" ? { idempotencyKey: newIdempotencyKey() } : {}),
        },
      );
      if (action.stale()) return;
      setBusy(null);
      // The notice states the run's own status: a test is "verified" only when its run succeeded (ADR-0055 §1).
      const status = res.data.status;
      setNoticeTone(kind === "test" && status === "failed" ? "warning" : "success");
      setNotice(
        kind === "run"
          ? t("integrations.connector.runQueued")
          : status === "succeeded"
            ? t("integrations.connector.testSucceeded")
            : status === "failed"
              ? t("integrations.connector.testFailed")
              : t("integrations.connector.testStarted"),
      );
      await refresh();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(null);
      setActionError(err);
      if (err instanceof ApiError && err.status === 409) await refresh();
    }
  };

  return (
    <>
      <PageHeader
        title={name}
        subtitle={t("integrations.connector.subtitle", { code: c.code })}
        crumbs={[adminCrumb(t), integrationsCrumb(t), { label: name }]}
      />
      <p className="banner banner--info" data-honest-status>
        <Icon name="info" /> <span>{t("integrations.honestStatus")}</span>
      </p>
      <section className="card" aria-labelledby="connector-status-h">
        <h2 id="connector-status-h" className="card__title">
          {t("integrations.connector.statusTitle")}
        </h2>
        <dl className="facts">
          <dt>{t("integrations.field.status")}</dt>
          <dd>
            <ConnectorStatusChip status={c.status} />
            {c.statusReason ? <span className="small muted"> {c.statusReason}</span> : null}
          </dd>
          <dt>{t("integrations.field.verification")}</dt>
          <dd>
            <VerificationChip verification={c.verification} />{" "}
            <span className="small muted">{t("integrations.verification.hint")}</span>
          </dd>
          <dt>{t("integrations.field.lastSuccess")}</dt>
          <dd>
            <LastSuccess at={c.lastSuccessAt} />
          </dd>
          <dt>{t("integrations.field.lastRun")}</dt>
          <dd>
            {c.lastRun ? (
              <Link className="link" to={`/admin/integrations/connectors/${c.id}/runs/${c.lastRun.id}`}>
                <RunStatusChip status={c.lastRun.status} /> {formatDateTime(c.lastRun.queuedAt, locale)}
              </Link>
            ) : (
              <span className="muted">{t("integrations.runs.none")}</span>
            )}
          </dd>
        </dl>
        {notice ? (
          <p className={`banner banner--${noticeTone}`} role="status" data-notice={noticeTone}>
            <Icon name={noticeTone === "warning" ? "alert" : "check"} /> <span>{notice}</span>
          </p>
        ) : null}
        {actionError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, actionError)}</span>
          </p>
        ) : null}
        {canConfigure || canRun ? (
          <div className="toolbar" data-connector-actions>
            {canConfigure ? (
              <button
                type="button"
                className="button button--secondary"
                disabled={busy !== null}
                onClick={() => void start("test")}
              >
                {busy === "test" ? t("integrations.connector.testing") : t("integrations.connector.test")}
              </button>
            ) : null}
            {canRun && c.status === "enabled" ? (
              <button
                type="button"
                className="button button--primary"
                disabled={busy !== null}
                onClick={() => void start("run")}
              >
                {busy === "run" ? t("integrations.connector.running") : t("integrations.connector.runNow")}
              </button>
            ) : null}
            {canConfigure ? (
              <>
                <Link className="button button--secondary" to={`/admin/integrations/connectors/${c.id}/edit`}>
                  <Icon name="pencil" /> {t("integrations.connector.edit")}
                </Link>
                {c.status === "disabled" ? (
                  <button type="button" className="button button--secondary" onClick={() => setDialog("enable")}>
                    {t("integrations.connector.enable")}
                  </button>
                ) : (
                  <button type="button" className="button button--danger" onClick={() => setDialog("disable")}>
                    {t("integrations.connector.disable")}
                  </button>
                )}
              </>
            ) : null}
          </div>
        ) : (
          <p className="banner banner--info" data-read-only>
            <Icon name="lock" /> <span>{t("integrations.readOnly")}</span>
          </p>
        )}
      </section>

      {c.actionableError ? (
        <ActionableErrorPanel
          error={c.actionableError}
          connectorId={c.id}
          targetTransformationId={cfg.targetTransformationId}
        />
      ) : null}

      <section className="card" aria-labelledby="connector-config-h">
        <h2 id="connector-config-h" className="card__title">
          {t("integrations.connector.configTitle", { version: cfg.versionNo })}
        </h2>
        <dl className="facts">
          <dt>{t("integrations.field.adapterKind")}</dt>
          <dd>{t(`integrations.adapter.${c.adapterKind}`)}</dd>
          <dt>{t("integrations.field.targetKind")}</dt>
          <dd>{t(`integrations.target.${c.targetKind}`)}</dd>
          <dt>{t("integrations.field.sourceSystemId")}</dt>
          <dd>
            <bdi dir="ltr">{cfg.sourceSystemId}</bdi>
          </dd>
          {c.adapterKind === "http_pull" ? (
            <>
              <dt>{t("integrations.field.endpointUrl")}</dt>
              <dd>
                <bdi dir="ltr">{cfg.endpointUrl ?? t("common.value.none")}</bdi>
              </dd>
            </>
          ) : null}
          {c.adapterKind === "test_adapter" ? (
            <>
              <dt>{t("integrations.field.adapterMode")}</dt>
              <dd data-adapter-mode={String(cfg.adapterSettings["mode"] ?? "")}>
                {t(`integrations.adapterMode.${String(cfg.adapterSettings["mode"] ?? "unknown")}`, {
                  defaultValue: t("common.value.unknown"),
                })}
              </dd>
            </>
          ) : null}
          <dt>{t("integrations.field.targetTransformation")}</dt>
          <dd>
            {cfg.targetTransformationId ? (
              <Link className="link" to={`/transformations/${cfg.targetTransformationId}`}>
                {t("integrations.connector.openTransformation")}
              </Link>
            ) : (
              <span className="muted">{t("common.value.none")}</span>
            )}
          </dd>
          <dt>{t("integrations.field.cadence")}</dt>
          <dd>{t(`integrations.cadence.${cfg.cadence}`)}</dd>
          <dt>{t("integrations.field.retry")}</dt>
          <dd>
            {t("integrations.connector.retryPolicy", {
              attempts: cfg.retryMaxAttempts,
              seconds: cfg.retryBackoffSeconds,
            })}
          </dd>
          <dt>{t("integrations.field.commitMode")}</dt>
          <dd>{t(`integrations.commitMode.${cfg.commitMode}`)}</dd>
          <dt>{t("integrations.field.reconciliationRule")}</dt>
          <dd>{t(`integrations.reconciliationRule.${cfg.reconciliationRule}`)}</dd>
          <dt>{t("integrations.field.mappings")}</dt>
          <dd>
            {t("integrations.connector.mappingCount", { count: cfg.fieldMappings.length })}{" "}
            <Link className="link" to={`/admin/integrations/connectors/${c.id}/mappings`}>
              {canConfigure ? t("integrations.mappings.edit") : t("integrations.mappings.view")}
            </Link>
          </dd>
          <dt>{t("integrations.field.configReason")}</dt>
          <dd>{cfg.reason}</dd>
          <dt>{t("integrations.field.configCreatedAt")}</dt>
          <dd>{formatDateTime(cfg.createdAt, locale)}</dd>
        </dl>
        <h3>{t("integrations.credentials.title")}</h3>
        <p className="small muted">{t("integrations.credentials.hint")}</p>
        {Object.keys(cfg.credentialRefs).length === 0 ? (
          <p className="muted">{t("integrations.credentials.none")}</p>
        ) : (
          <TableScrollRegion caption={t("integrations.credentials.title")}>
            <table className="table" data-credentials>
              <caption className="visually-hidden">{t("integrations.credentials.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("integrations.credentials.purpose")}</th>
                  <th scope="col">{t("integrations.credentials.reference")}</th>
                  <th scope="col">{t("integrations.credentials.resolvable")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(cfg.credentialRefs).map(([key, ref]) => (
                  <tr key={key}>
                    <td>
                      <bdi dir="ltr">{key}</bdi>
                    </td>
                    <td>
                      <SecretRefText value={ref} />
                    </td>
                    <td data-resolvable={String(ref.resolvable)}>
                      {ref.resolvable === null ? (
                        <span className="status-chip status-chip--unknown">
                          <Icon name="question" /> {t("integrations.credentials.notChecked")}
                        </span>
                      ) : ref.resolvable ? (
                        <span className="status-chip status-chip--on-track">
                          <Icon name="check" /> {t("integrations.credentials.resolves")}
                        </span>
                      ) : (
                        <span className="status-chip status-chip--off-track">
                          <Icon name="cross" /> {t("integrations.credentials.doesNotResolve")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollRegion>
        )}
        {c.adapterKind === "webhook" ? (
          <p>
            <Link className="link" to={`/admin/integrations/webhooks?connector=${c.id}`}>
              {t("integrations.webhooks.forConnector")}
            </Link>
          </p>
        ) : null}
      </section>

      <RunHistory connector={c} />

      {dialog ? (
        <ReasonDialog
          title={t(dialog === "enable" ? "integrations.connector.enableTitle" : "integrations.connector.disableTitle")}
          description={t(
            dialog === "enable" ? "integrations.connector.enableBody" : "integrations.connector.disableBody",
          )}
          confirmLabel={t(dialog === "enable" ? "integrations.connector.enable" : "integrations.connector.disable")}
          onConfirm={(reason) => toggle(dialog, reason)}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}

function RunHistory({ connector: c }: { connector: Connector }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const pager = useCursorPager();
  const [status, setStatus] = useState("");
  const { reset } = pager;
  useEffect(() => reset(), [status, reset]);
  const q = useIntegrationRuns(c.id, status ? { status } : {}, pager.cursor);
  const cols: Col<IntegrationRun>[] = [
    {
      id: "queuedAt",
      label: t("integrations.run.queuedAt"),
      cell: (r) => (
        <Link className="link" to={`/admin/integrations/connectors/${c.id}/runs/${r.id}`}>
          {formatDateTime(r.queuedAt, locale)}
        </Link>
      ),
      sort: (r) => r.queuedAt,
      hideable: false,
    },
    {
      id: "trigger",
      label: t("integrations.run.trigger"),
      cell: (r) => t(`integrations.trigger.${r.triggerKind}`),
      sort: (r) => r.triggerKind,
    },
    {
      id: "attempt",
      label: t("integrations.run.attempt"),
      cell: (r) => <Count value={r.attemptNo} />,
      sort: (r) => r.attemptNo,
    },
    {
      id: "status",
      label: t("integrations.field.status"),
      cell: (r) => <RunStatusChip status={r.status} />,
      sort: (r) => r.status,
    },
    {
      id: "rowsRead",
      label: t("integrations.run.rowsRead"),
      cell: (r) => <Count value={r.rowsRead} />,
      sort: (r) => r.rowsRead,
    },
    {
      id: "rowsStaged",
      label: t("integrations.run.rowsStaged"),
      cell: (r) => <Count value={r.rowsStaged} />,
      sort: (r) => r.rowsStaged,
    },
    {
      id: "rowsCommitted",
      label: t("integrations.run.rowsCommitted"),
      cell: (r) => <Count value={r.rowsCommitted} />,
      sort: (r) => r.rowsCommitted,
    },
    {
      id: "rowsRejected",
      label: t("integrations.run.rowsRejected"),
      cell: (r) => <Count value={r.rowsRejected} />,
      sort: (r) => r.rowsRejected,
    },
    {
      id: "rowsDuplicate",
      label: t("integrations.run.rowsDuplicate"),
      cell: (r) => <Count value={r.rowsDuplicate} />,
      sort: (r) => r.rowsDuplicate,
    },
    {
      id: "errorCount",
      label: t("integrations.run.errorCount"),
      cell: (r) => <Count value={r.errorCount} />,
      sort: (r) => r.errorCount,
    },
    {
      id: "error",
      label: t("integrations.run.error"),
      cell: (r) =>
        r.errorCode ? (
          <span data-error-code={r.errorCode}>
            {t(`integrations.actionable.${codeKey(r.errorCode)}.short`, { defaultValue: r.errorCode })}
          </span>
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
    },
    {
      id: "reconciliation",
      label: t("integrations.run.reconciliation"),
      cell: (r) => <ReconciliationChip status={r.reconciliation.status} />,
    },
    {
      id: "retryOf",
      label: t("integrations.run.retryOf"),
      cell: (r) =>
        r.retryOfRunId ? (
          <Link className="link" to={`/admin/integrations/connectors/${c.id}/runs/${r.retryOfRunId}`}>
            {t("integrations.run.openPrevious")}
          </Link>
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
    },
  ];
  return (
    <section className="card" aria-labelledby="connector-runs-h">
      <h2 id="connector-runs-h" className="card__title">
        {t("integrations.runs.title")}
      </h2>
      <p className="small muted">{t("integrations.runs.intro")}</p>
      <form className="filters" aria-label={t("common.filter.title")} onSubmit={(e) => e.preventDefault()}>
        <div className="filters__select">
          <label htmlFor="run-status-filter">{t("integrations.field.status")}</label>
          <select id="run-status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("common.filter.any")}</option>
            {INTEGRATION_RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`integrations.runStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </form>
      <QueryState
        query={q}
        isEmpty={(p) => p.items.length === 0 && pager.pageNumber === 1}
        empty={<EmptyState title={t("integrations.runs.none")} body={t("integrations.runs.emptyBody")} />}
      >
        {(p) => (
          <PagedTable
            tableId="runs"
            caption={t("integrations.runs.title")}
            rows={p.items}
            cols={cols}
            getRowId={(r) => r.id}
            pager={pager}
            nextCursor={p.nextCursor}
            busy={q.isFetching}
          />
        )}
      </QueryState>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ run detail

export function IntegrationRunPage() {
  const { t } = useTranslation();
  const { connectorId = "", runId = "" } = useParams();
  usePageTitle(t("integrations.run.title"));
  const connector = useConnector(connectorId);
  const q = useIntegrationRun(connectorId, runId);
  return (
    <div className="page" data-p6-screen="integrations-run">
      <QueryState query={q}>
        {(d) => <RunView detail={d} connector={connector.data ?? null} connectorId={connectorId} />}
      </QueryState>
    </div>
  );
}

function RunView({
  detail,
  connector,
  connectorId,
}: {
  detail: IntegrationRunDetail;
  connector: Connector | null;
  connectorId: string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useIntegrationsRefresh();
  const begin = useSessionBoundAction();
  const r = detail.run;
  const [retryError, setRetryError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const name = connector ? (localName(connector, locale) ?? connector.code) : t("integrations.connector.title");
  const canRetry = canAnywhere(me, "connector.run") && r.status === "failed" && detail.retriedByRunId === null;
  const tid = connector?.config.targetTransformationId ?? null;

  const retry = async () => {
    setRetryError(null);
    const action = begin();
    setBusy(true);
    try {
      const next = await apiRequest<IntegrationRun>(integrationPaths.retry(connectorId, r.id), {
        method: "POST",
        body: {},
      });
      if (action.stale()) return;
      setBusy(false);
      await refresh();
      action.navigate(`/admin/integrations/connectors/${connectorId}/runs/${next.data.id}`);
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setRetryError(err);
      if (err instanceof ApiError && err.status === 409) await refresh();
    }
  };

  return (
    <>
      <PageHeader
        title={t("integrations.run.heading", {
          trigger: t(`integrations.trigger.${r.triggerKind}`),
          attempt: r.attemptNo,
        })}
        crumbs={[
          adminCrumb(t),
          integrationsCrumb(t),
          { label: name, to: `/admin/integrations/connectors/${connectorId}` },
          { label: t("integrations.run.title") },
        ]}
      />
      <section className="card" aria-labelledby="run-facts-h">
        <h2 id="run-facts-h" className="card__title">
          {t("integrations.run.factsTitle")}
        </h2>
        <dl className="facts">
          <dt>{t("integrations.field.status")}</dt>
          <dd>
            <RunStatusChip status={r.status} />
          </dd>
          <dt>{t("integrations.run.trigger")}</dt>
          <dd>{t(`integrations.trigger.${r.triggerKind}`)}</dd>
          <dt>{t("integrations.run.attempt")}</dt>
          <dd>{r.attemptNo}</dd>
          <dt>{t("integrations.run.configVersion")}</dt>
          <dd>{r.configVersionNo}</dd>
          <dt>{t("integrations.run.queuedAt")}</dt>
          <dd>{formatDateTime(r.queuedAt, locale)}</dd>
          <dt>{t("integrations.run.startedAt")}</dt>
          <dd>
            {r.startedAt ? (
              formatDateTime(r.startedAt, locale)
            ) : (
              <span className="muted">{t("integrations.run.notStarted")}</span>
            )}
          </dd>
          <dt>{t("integrations.run.finishedAt")}</dt>
          <dd>
            {r.finishedAt ? (
              formatDateTime(r.finishedAt, locale)
            ) : (
              <span className="muted">{t("integrations.run.notFinished")}</span>
            )}
          </dd>
          <dt>{t("integrations.run.rowsRead")}</dt>
          <dd>
            <Count value={r.rowsRead} />
          </dd>
          <dt>{t("integrations.run.rowsStaged")}</dt>
          <dd>
            <Count value={r.rowsStaged} />
          </dd>
          <dt>{t("integrations.run.rowsCommitted")}</dt>
          <dd>
            <Count value={r.rowsCommitted} />
          </dd>
          <dt>{t("integrations.run.rowsRejected")}</dt>
          <dd>
            <Count value={r.rowsRejected} />
          </dd>
          <dt>{t("integrations.run.rowsDuplicate")}</dt>
          <dd>
            <Count value={r.rowsDuplicate} />
          </dd>
          <dt>{t("integrations.run.errorCount")}</dt>
          <dd>
            <Count value={r.errorCount} />
          </dd>
          <dt>{t("integrations.run.reconciliation")}</dt>
          <dd>
            <ReconciliationChip status={r.reconciliation.status} />{" "}
            <span className="small muted">
              {t("integrations.run.sourceRowCount")}: <Count value={r.reconciliation.sourceRowCount} />
              {" · "}
              {t("integrations.run.sourceControlTotal")}:{" "}
              {r.reconciliation.sourceControlTotal === null ? (
                <Count value={null} />
              ) : (
                <bdi dir="ltr">{r.reconciliation.sourceControlTotal}</bdi>
              )}
              {" · "}
              {t("integrations.run.stagedControlTotal")}:{" "}
              {r.reconciliation.stagedControlTotal === null ? (
                <Count value={null} />
              ) : (
                <bdi dir="ltr">{r.reconciliation.stagedControlTotal}</bdi>
              )}
            </span>
          </dd>
          <dt>{t("integrations.run.idempotencyKey")}</dt>
          <dd>
            <bdi dir="ltr" className="mono">
              {r.idempotencyKey}
            </bdi>
          </dd>
          <dt>{t("integrations.run.importBatch")}</dt>
          <dd>
            {r.importBatchId && tid ? (
              <Link className="link" to={`/transformations/${tid}/imports/${r.importBatchId}`}>
                {t("integrations.run.openImport")}
              </Link>
            ) : (
              <span className="muted">{t("common.value.none")}</span>
            )}
          </dd>
        </dl>
      </section>

      {detail.actionableError ? (
        <ActionableErrorPanel
          error={detail.actionableError}
          connectorId={connectorId}
          targetTransformationId={tid}
          showRunLink={detail.actionableError.runId !== r.id}
        />
      ) : r.errorCode ? (
        <p className="banner banner--error" data-run-error={r.errorCode}>
          <Icon name="alert" />{" "}
          <span>{t(`integrations.actionable.${codeKey(r.errorCode)}.short`, { defaultValue: r.errorCode })}</span>
        </p>
      ) : null}

      <section className="card" aria-labelledby="run-chain-h">
        <h2 id="run-chain-h" className="card__title">
          {t("integrations.run.chainTitle")}
        </h2>
        <dl className="facts" data-retry-chain>
          <dt>{t("integrations.run.retryOf")}</dt>
          <dd>
            {r.retryOfRunId ? (
              <Link className="link" to={`/admin/integrations/connectors/${connectorId}/runs/${r.retryOfRunId}`}>
                {t("integrations.run.openPrevious")}
              </Link>
            ) : (
              <span className="muted">{t("integrations.run.firstAttempt")}</span>
            )}
          </dd>
          <dt>{t("integrations.run.retriedBy")}</dt>
          <dd>
            {detail.retriedByRunId ? (
              <Link className="link" to={`/admin/integrations/connectors/${connectorId}/runs/${detail.retriedByRunId}`}>
                {t("integrations.run.openNext")}
              </Link>
            ) : (
              <span className="muted">{t("integrations.run.notRetried")}</span>
            )}
          </dd>
        </dl>
        {retryError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, retryError)}</span>
          </p>
        ) : null}
        {canRetry ? (
          <button type="button" className="button button--primary" disabled={busy} onClick={() => void retry()}>
            <Icon name="refresh" /> {busy ? t("integrations.run.retrying") : t("integrations.run.retry")}
          </button>
        ) : null}
      </section>

      <section className="card" aria-labelledby="run-events-h">
        <h2 id="run-events-h" className="card__title">
          {t("integrations.run.eventsTitle")}
        </h2>
        <TableScrollRegion caption={t("integrations.run.eventsTitle")}>
          <table className="table" data-run-events>
            <caption className="visually-hidden">{t("integrations.run.eventsTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("integrations.run.occurredAt")}</th>
                <th scope="col">{t("integrations.field.status")}</th>
                <th scope="col">{t("integrations.run.rowsRead")}</th>
                <th scope="col">{t("integrations.run.rowsStaged")}</th>
                <th scope="col">{t("integrations.run.rowsCommitted")}</th>
                <th scope="col">{t("integrations.run.errorCount")}</th>
                <th scope="col">{t("integrations.run.error")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.events.map((e) => (
                <tr key={e.recordVersion}>
                  <td>{formatDateTime(e.occurredAt, locale)}</td>
                  <td>
                    <RunStatusChip status={e.status} />
                  </td>
                  <td>
                    <Count value={e.rowsRead} />
                  </td>
                  <td>
                    <Count value={e.rowsStaged} />
                  </td>
                  <td>
                    <Count value={e.rowsCommitted} />
                  </td>
                  <td>
                    <Count value={e.errorCount} />
                  </td>
                  <td>
                    {e.errorCode ? (
                      t(`integrations.actionable.${codeKey(e.errorCode)}.short`, { defaultValue: e.errorCode })
                    ) : (
                      <span className="muted">{t("common.value.none")}</span>
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
