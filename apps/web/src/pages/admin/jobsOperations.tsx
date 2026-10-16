// Administration > Operations > Jobs (T-DG5-FE-D; REQ-S12-022; ADR-0043 §6): the jobs view extension. For each
// scheduled job: last success, next run, last outcome, open failures and the repair actions (run now; retry or dismiss
// its failures in the failure queue). A job that never succeeded shows "Never run", a disabled schedule "Disabled",
// a next run the server cannot compute "Unknown" — never a guessed time and never "OK". The schedule itself (enable,
// cron, time zone) is still edited on the DG4 jobs screen (/admin/jobs). The view needs job.read: anyone else, the
// auditor included, gets the server's 403 and sees the no-permission state.
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useLocale } from "../../app/locale.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { fedPaths, useFedRefresh, useJobOperation, useJobOperations, type JobOperation } from "../automation/api.ts";
import { Chip, HumanDecisionNote, pick, useRunner, type Runner } from "../automation/ui.tsx";

/** Last success: a time, or "Never run" (null is never shown as a time or as OK). */
export function LastSuccess({ job }: { job: Pick<JobOperation, "lastSuccessAt"> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return job.lastSuccessAt ? (
    <span data-last-success={job.lastSuccessAt}>{formatDateTime(job.lastSuccessAt, locale)}</span>
  ) : (
    <Chip tone="neutral" icon="question" label={t("workflowsP5.jobs.neverRun")} data="never_run" />
  );
}

/** Next run: a time, or "Disabled" / "Unknown" by the server's reason. */
export function NextRun({ job }: { job: Pick<JobOperation, "nextRunAt" | "nextRunUnknownReason"> }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (job.nextRunAt) return <span data-next-run={job.nextRunAt}>{formatDateTime(job.nextRunAt, locale)}</span>;
  return job.nextRunUnknownReason === "disabled" ? (
    <Chip tone="closed" icon="pause" label={t("workflowsP5.jobs.disabled")} data="disabled" />
  ) : (
    <Chip tone="neutral" icon="question" label={t("workflowsP5.unknown")} data="unknown" />
  );
}

function LastOutcome({ job }: { job: Pick<JobOperation, "lastOutcome"> }) {
  const { t } = useTranslation();
  if (job.lastOutcome === "succeeded")
    return <Chip tone="good" icon="check" label={t("workflowsP5.jobs.succeeded")} data="succeeded" />;
  if (job.lastOutcome === "failed")
    return <Chip tone="bad" icon="cross" label={t("workflowsP5.jobs.failed")} data="failed" />;
  return <Chip tone="neutral" icon="question" label={t("workflowsP5.jobs.neverRun")} data="never_run" />;
}

function RunNow({ job, runner }: { job: JobOperation; runner: Runner }) {
  const { t } = useTranslation();
  if (!job.allowedActions.includes("run_now")) return null;
  return (
    <button
      type="button"
      className="button button--secondary button--small"
      data-action="run-now"
      disabled={runner.busy}
      onClick={() => void runner.run(fedPaths.runJob(job.code), {})}
    >
      {t("workflowsP5.jobs.runNow")}
      <span className="visually-hidden">: {job.code}</span>
    </button>
  );
}

function JobsCrumbs() {
  const { t } = useTranslation();
  return (
    <p className="small">
      <Link className="link" to="/admin/jobs">
        {t("workflowsP5.jobs.schedules")}
      </Link>{" "}
      ·{" "}
      <Link className="link" to="/admin/automation/failures">
        {t("nav.p5.automationFailures.title")}
      </Link>
    </p>
  );
}

export function JobsOperationsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  usePageTitle(t("workflowsP5.jobs.title"));
  const jobs = useJobOperations();
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  const columns: RegisterColumn<JobOperation>[] = [
    {
      id: "job",
      header: t("workflowsP5.jobs.job"),
      rowHeader: true,
      hideable: false,
      cell: (j) => (
        <span className="block">
          <Link className="link" to={`/admin/jobs/operations/${encodeURIComponent(j.code)}`}>
            {pick(locale, j.descriptionEn, j.descriptionAr)}
          </Link>
          <span className="block small muted">
            <bdi dir="ltr" className="code">
              {j.code}
            </bdi>
          </span>
        </span>
      ),
      sortValue: (j) => j.code,
      filterText: (j) => `${j.code} ${j.descriptionEn} ${j.descriptionAr} ${j.ownerModule}`,
    },
    {
      id: "lastSuccess",
      header: t("workflowsP5.jobs.lastSuccess"),
      cell: (j) => <LastSuccess job={j} />,
      sortValue: (j) => j.lastSuccessAt ?? "",
    },
    {
      id: "nextRun",
      header: t("workflowsP5.jobs.nextRun"),
      cell: (j) => <NextRun job={j} />,
      sortValue: (j) => j.nextRunAt ?? "",
    },
    { id: "lastOutcome", header: t("workflowsP5.jobs.lastOutcome"), cell: (j) => <LastOutcome job={j} /> },
    {
      id: "failures",
      header: t("workflowsP5.jobs.openFailures"),
      cell: (j) => <span data-open-failures={j.openFailures}>{j.openFailures}</span>,
      sortValue: (j) => j.openFailures,
    },
    {
      id: "schedule",
      header: t("workflowsP5.jobs.schedule"),
      cell: (j) => (
        <bdi dir="ltr" className="code">
          {j.cron} · {j.timezone}
        </bdi>
      ),
    },
    {
      id: "actions",
      header: t("workflowsP5.actions"),
      hideable: false,
      cell: (j) => <RunNow job={j} runner={runner} />,
    },
  ];
  return (
    <div className="page" data-p5-screen="jobs-operations">
      <PageHeader
        title={t("workflowsP5.jobs.title")}
        subtitle={t("workflowsP5.jobs.intro")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("workflowsP5.jobs.title") }]}
      />
      <HumanDecisionNote />
      <JobsCrumbs />
      {runner.alert}
      <Section id="jobs-operations" title={t("workflowsP5.jobs.listTitle")}>
        <QueryState query={jobs}>
          {(rows) => (
            <RegisterTable
              id="p5-jobs-operations"
              caption={t("workflowsP5.jobs.listTitle")}
              rows={rows}
              columns={columns}
              getRowId={(j) => j.code}
              emptyTitle={t("workflowsP5.jobs.empty")}
              defaultSort={{ id: "job", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

export function JobOperationPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { jobCode } = useParams();
  usePageTitle(t("workflowsP5.jobs.title"));
  const detail = useJobOperation(jobCode);
  const refresh = useFedRefresh();
  const runner = useRunner(refresh);
  return (
    <div className="page" data-p5-screen="job-operation">
      <PageHeader
        title={<bdi dir="ltr">{jobCode}</bdi>}
        subtitle={t("workflowsP5.jobs.detailIntro")}
        crumbs={[{ label: t("workflowsP5.jobs.title"), to: "/admin/jobs/operations" }, { label: jobCode ?? "" }]}
      />
      <JobsCrumbs />
      {runner.alert}
      <QueryState query={detail}>
        {(d) => (
          <>
            <section className="card" aria-labelledby="job-facts" data-job={d.job.code}>
              <h2 id="job-facts" className="card__title">
                {pick(locale, d.job.descriptionEn, d.job.descriptionAr)}
              </h2>
              <dl className="workspace-header__grid">
                <dt>{t("workflowsP5.jobs.lastSuccess")}</dt>
                <dd>
                  <LastSuccess job={d.job} />
                </dd>
                <dt>{t("workflowsP5.jobs.nextRun")}</dt>
                <dd>
                  <NextRun job={d.job} />
                </dd>
                <dt>{t("workflowsP5.jobs.lastOutcome")}</dt>
                <dd>
                  <LastOutcome job={d.job} />
                </dd>
                <dt>{t("workflowsP5.jobs.openFailures")}</dt>
                <dd>{d.job.openFailures}</dd>
                <dt>{t("workflowsP5.jobs.schedule")}</dt>
                <dd>
                  <bdi dir="ltr" className="code">
                    {d.job.cron} · {d.job.timezone} · {d.job.queueName}
                  </bdi>
                </dd>
              </dl>
              <div className="form__actions">
                <RunNow job={d.job} runner={runner} />
              </div>
            </section>
            <Section id="job-runs" title={t("workflowsP5.jobs.runsTitle")}>
              {d.runs.length === 0 ? (
                <p className="muted">{t("workflowsP5.jobs.noRuns")}</p>
              ) : (
                <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.jobs.runsTitle")}>
                  <table className="table" data-table="job-runs">
                    <caption className="visually-hidden">{t("workflowsP5.jobs.runsTitle")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("workflowsP5.executions.started")}</th>
                        <th scope="col">{t("workflowsP5.executions.finished")}</th>
                        <th scope="col">{t("workflowsP5.executions.attempt")}</th>
                        <th scope="col">{t("workflowsP5.jobs.lastOutcome")}</th>
                        <th scope="col">{t("workflowsP5.executions.error")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.runs.map((r) => (
                        <tr key={r.id} data-run={r.outcome}>
                          <th scope="row">{formatDateTime(r.startedAt, locale)}</th>
                          <td>{formatDateTime(r.finishedAt, locale)}</td>
                          <td>{r.attemptNo}</td>
                          <td>{t(`workflowsP5.jobs.${r.outcome}`)}</td>
                          <td>{r.errorCode ? <bdi dir="ltr">{r.errorCode}</bdi> : "—"}</td>
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
