// Administration > Automation > Failure queue (T-DG5-FE-D; REQ-S12-002, REQ-S12-020, REQ-S12-022; ADR-0043 §5): every
// failed unit of work an administrator must see — rule executions and failed jobs — with its error (translated by its
// code), attempts, idempotency key and status. Retry re-runs only the work whose key has no completed result (no
// duplicate actions); dismiss needs a reason. Rule-execution failures need automation.repair, job failures job.repair;
// the server decides (the buttons follow the failure's `allowedActions`). Also: the execution history of every rule,
// and one execution with its per-action results.
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { fedPaths, useExecution, useExecutions, useFailures, useFedRefresh, type OperationalFailure } from "./api.ts";
import { EXECUTION_STATUS_CHIP, ExecutionsTable } from "./RulePage.tsx";
import { AutomationLinks } from "./RulesPage.tsx";
import { HumanDecisionNote, NoteForm, StatusChip, useRunner } from "./ui.tsx";

export const FAILURE_STATUS_CHIP = {
  open: ["bad", "alert"],
  retrying: ["neutral", "refresh"],
  resolved: ["good", "check"],
  dismissed: ["closed", "archive"],
} as const;

const problemText = (t: TFunction, code: string): string =>
  t(`problems.${code.replace(/\./g, "__")}`, { defaultValue: code });

export function FailuresPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("nav.p5.automationFailures.title"));
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("open");
  const failures = useFailures({ ...(source ? { source } : {}), ...(status ? { status } : {}) });
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const [dismissing, setDismissing] = useState<OperationalFailure | null>(null);
  const columns: RegisterColumn<OperationalFailure>[] = [
    {
      id: "failed",
      header: t("workflowsP5.failures.lastFailed"),
      rowHeader: true,
      hideable: false,
      cell: (f) => formatDateTime(f.lastFailedAt, locale),
      sortValue: (f) => f.lastFailedAt,
      filterText: (f) =>
        `${f.queueName} ${f.errorCode} ${f.errorMessage} ${f.idempotencyKey} ${f.jobScheduleCode ?? ""}`,
    },
    {
      id: "source",
      header: t("workflowsP5.failures.source"),
      cell: (f) => (
        <span className="block">
          {t(`workflowsP5.failureSource.${f.source}`)}
          <span className="block small muted">
            <bdi dir="ltr">{f.jobScheduleCode ?? f.queueName}</bdi>
          </span>
          {f.executionId ? (
            <Link className="link small" to={`/admin/automation/executions/${f.executionId}`}>
              {t("workflowsP5.failures.openExecution")}
            </Link>
          ) : null}
        </span>
      ),
      sortValue: (f) => f.source,
    },
    {
      id: "error",
      header: t("workflowsP5.executions.error"),
      cell: (f) => (
        <span className="block" data-error-code={f.errorCode}>
          {problemText(t, f.errorCode)}
          <span className="block small muted">
            <bdi dir="ltr">{f.errorMessage}</bdi>
          </span>
        </span>
      ),
    },
    {
      id: "attempts",
      header: t("workflowsP5.failures.attempts"),
      cell: (f) => f.attempts,
      sortValue: (f) => f.attempts,
    },
    {
      id: "retries",
      header: t("workflowsP5.failures.retries"),
      cell: (f) => f.retryCount,
      sortValue: (f) => f.retryCount,
    },
    {
      id: "key",
      header: t("workflowsP5.failures.key"),
      cell: (f) => (
        <bdi dir="ltr" className="code small">
          {f.idempotencyKey}
        </bdi>
      ),
    },
    {
      id: "status",
      header: t("workflowsP5.field.status"),
      cell: (f) => (
        <span className="block">
          <StatusChip value={f.status} table={FAILURE_STATUS_CHIP} labelKey="workflowsP5.failureStatus" />
          {f.dismissReason ? <span className="block small">{f.dismissReason}</span> : null}
        </span>
      ),
      sortValue: (f) => f.status,
    },
    {
      id: "actions",
      header: t("workflowsP5.actions"),
      hideable: false,
      cell: (f) =>
        f.allowedActions.length === 0 ? (
          <span className="small muted">{t("workflowsP5.readOnly")}</span>
        ) : (
          <span className="row-actions">
            {f.allowedActions.includes("retry") ? (
              <button
                type="button"
                className="button button--secondary button--small"
                data-action="retry-failure"
                disabled={runner.busy}
                onClick={() => void runner.run(fedPaths.retryFailure(f.id), { ifMatch: f.version })}
              >
                {t("workflowsP5.failures.retry")}
                <span className="visually-hidden">: {f.idempotencyKey}</span>
              </button>
            ) : null}
            {f.allowedActions.includes("dismiss") ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="dismiss-failure"
                onClick={() => setDismissing(f)}
              >
                {t("workflowsP5.failures.dismiss")}
                <span className="visually-hidden">: {f.idempotencyKey}</span>
              </button>
            ) : null}
          </span>
        ),
    },
  ];
  return (
    <div className="page" data-p5-screen="automation-failures">
      <PageHeader
        title={t("nav.p5.automationFailures.title")}
        subtitle={t("nav.p5.automationFailures.summary")}
        crumbs={[
          { label: t("nav.p5.automation.title"), to: "/admin/automation" },
          { label: t("nav.p5.automationFailures.title") },
        ]}
      />
      <HumanDecisionNote />
      <AutomationLinks />
      {runner.alert}
      {dismissing ? (
        <Section id="dismiss" title={t("workflowsP5.failures.dismissTitle")}>
          <p className="small">
            <bdi dir="ltr">{dismissing.idempotencyKey}</bdi>
          </p>
          <NoteForm
            id="dismiss-failure"
            label={t("workflowsP5.field.reason")}
            submitLabel={t("workflowsP5.failures.dismiss")}
            required
            min={3}
            busy={runner.busy}
            danger
            onSubmit={(reason) =>
              void runner
                .run(fedPaths.dismissFailure(dismissing.id), { body: { reason }, ifMatch: dismissing.version })
                .then((r) => r && setDismissing(null))
            }
          />
          <button type="button" className="button button--link" onClick={() => setDismissing(null)}>
            {t("workflowsP5.close")}
          </button>
        </Section>
      ) : null}
      <Section
        id="failures"
        title={t("workflowsP5.failures.listTitle")}
        actions={
          <>
            <label className="filters__select">
              <span>{t("workflowsP5.failures.source")}</span>
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">{t("workflowsP5.all")}</option>
                <option value="rule_execution">{t("workflowsP5.failureSource.rule_execution")}</option>
                <option value="job">{t("workflowsP5.failureSource.job")}</option>
              </select>
            </label>
            <label className="filters__select">
              <span>{t("workflowsP5.field.status")}</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t("workflowsP5.all")}</option>
                {(["open", "retrying", "resolved", "dismissed"] as const).map((s) => (
                  <option key={s} value={s}>
                    {t(`workflowsP5.failureStatus.${s}`)}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
      >
        <QueryState query={failures}>
          {(rows) => (
            <RegisterTable
              id="p5-automation-failures"
              caption={t("workflowsP5.failures.listTitle")}
              rows={rows}
              columns={columns}
              getRowId={(f) => f.id}
              emptyTitle={t("workflowsP5.failures.empty")}
              defaultSort={{ id: "failed", dir: "desc" }}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

export function ExecutionsPage() {
  const { t } = useTranslation();
  usePageTitle(t("workflowsP5.executions.title"));
  const [status, setStatus] = useState("");
  const executions = useExecutions(status ? { status } : {});
  return (
    <div className="page" data-p5-screen="automation-executions">
      <PageHeader
        title={t("workflowsP5.executions.title")}
        subtitle={t("workflowsP5.executions.intro")}
        crumbs={[
          { label: t("nav.p5.automation.title"), to: "/admin/automation" },
          { label: t("workflowsP5.executions.title") },
        ]}
      />
      <AutomationLinks />
      <Section
        id="executions"
        title={t("workflowsP5.executions.title")}
        actions={
          <label className="filters__select">
            <span>{t("workflowsP5.executions.outcome")}</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("workflowsP5.all")}</option>
              {(["running", "succeeded", "skipped", "failed"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`workflowsP5.executionStatus.${s}`)}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <QueryState query={executions}>{(rows) => <ExecutionsTable rows={rows} showRule />}</QueryState>
      </Section>
    </div>
  );
}

export function ExecutionPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { executionId } = useParams();
  usePageTitle(t("workflowsP5.executions.one"));
  const execution = useExecution(executionId);
  return (
    <div className="page" data-p5-screen="automation-execution">
      <QueryState query={execution}>
        {(x) => (
          <>
            <PageHeader
              title={t("workflowsP5.executions.one")}
              subtitle={<bdi dir="ltr">{`${x.ruleCode} · v${x.versionNo} · ${x.triggerCode}`}</bdi>}
              crumbs={[
                { label: t("workflowsP5.executions.title"), to: "/admin/automation/executions" },
                { label: x.ruleCode },
              ]}
            />
            <section className="card" aria-labelledby="execution-facts" data-execution-status={x.status}>
              <h2 id="execution-facts" className="card__title">
                {t("workflowsP5.rules.factsTitle")}
              </h2>
              <dl className="workspace-header__grid">
                <dt>{t("workflowsP5.executions.outcome")}</dt>
                <dd>
                  <StatusChip value={x.status} table={EXECUTION_STATUS_CHIP} labelKey="workflowsP5.executionStatus" />
                </dd>
                <dt>{t("workflowsP5.rules.rule")}</dt>
                <dd>
                  <Link className="link" to={`/admin/automation/rules/${x.ruleId}`}>
                    <bdi dir="ltr">{x.ruleCode}</bdi>
                  </Link>{" "}
                  · v{x.versionNo}
                </dd>
                <dt>{t("workflowsP5.executions.trigger")}</dt>
                <dd>
                  <bdi dir="ltr">{x.triggerCode}</bdi>
                  <span className="block small muted">
                    <bdi dir="ltr">{x.triggerKey}</bdi>
                  </span>
                </dd>
                <dt>{t("workflowsP5.rules.runAs")}</dt>
                <dd>{t(`workflowsP5.runAs.${x.runAs}`)}</dd>
                <dt>{t("workflowsP5.executions.started")}</dt>
                <dd>{formatDateTime(x.startedAt, locale)}</dd>
                <dt>{t("workflowsP5.executions.finished")}</dt>
                <dd>{x.finishedAt ? formatDateTime(x.finishedAt, locale) : t("workflowsP5.unknown")}</dd>
                <dt>{t("workflowsP5.executions.attempt")}</dt>
                <dd>{x.attemptNo}</dd>
                {x.errorCode ? (
                  <>
                    <dt>{t("workflowsP5.executions.error")}</dt>
                    <dd data-error-code={x.errorCode}>
                      {problemText(t, x.errorCode)}
                      {x.errorDetail ? <span className="block small muted">{x.errorDetail}</span> : null}
                    </dd>
                  </>
                ) : null}
              </dl>
            </section>
            <Section id="action-results" title={t("workflowsP5.executions.results")}>
              {x.actionResults.length === 0 ? (
                <p className="muted">{t("workflowsP5.executions.noResults")}</p>
              ) : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.executions.results")}>
                  <table className="table" data-table="action-results">
                    <caption className="visually-hidden">{t("workflowsP5.executions.results")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("workflowsP5.executions.attempt")}</th>
                        <th scope="col">#</th>
                        <th scope="col">{t("workflowsP5.rules.action")}</th>
                        <th scope="col">{t("workflowsP5.dryRun.outcome")}</th>
                        <th scope="col">{t("workflowsP5.failures.key")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {x.actionResults.map((a, i) => (
                        <tr key={i} data-result={a.outcome}>
                          <td>{a.attemptNo}</td>
                          <td>{a.ordinal}</td>
                          <th scope="row">
                            <bdi dir="ltr">{a.actionType}</bdi>
                          </th>
                          <td>
                            {t(`workflowsP5.resultOutcome.${a.outcome}`)}
                            {a.errorCode ? <span className="block small">{problemText(t, a.errorCode)}</span> : null}
                          </td>
                          <td>
                            <bdi dir="ltr" className="code small">
                              {a.idempotencyKey}
                            </bdi>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </>
        )}
      </QueryState>
    </div>
  );
}
