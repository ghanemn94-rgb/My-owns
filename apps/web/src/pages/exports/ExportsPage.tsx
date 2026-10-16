// Your exports (T-DG5-FE-E; REQ-S13-005; ADR-0046 §5, §8): the export jobs YOU requested, newest first (others' jobs are
// never listed: the API answers only the requester), with status, stage and progress, polled while a job is queued or
// running. A succeeded job's file downloads with its name, size and SHA-256; a failed job shows its error code
// translated (render failed, too large, source unavailable, retries exhausted); a queued or running job can be
// cancelled (If-Match). Download re-checks access on the server: a job whose records you can no longer read answers 404.
// Under a transformation the list shows that transformation's jobs only.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ApiError, buildUrl } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime, formatDecimal } from "../../lib/format.ts";
import { problemText } from "../../lib/problem.ts";
import { FormAlert } from "../my-work/p4ui.tsx";
import { reportPaths, useExports, useReportsRefresh, type ExportJob } from "../reports/api.ts";
import { ExportStatusChip, FEE_NS, NotAnApprovalNote, useRunner } from "../reports/ui.tsx";

const STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

/** Progress of one job: stage, percent and sections, as the worker reports them (only moving forward). */
export function ExportProgress({ job: j }: { job: ExportJob }) {
  const { t } = useTranslation();
  const label = t("reportsP5.exports.progressLabel", { format: j.format.toUpperCase() });
  return (
    <div className="export-progress" data-export={j.id} data-export-status={j.status} data-export-stage={j.stage}>
      <ExportStatusChip status={j.status} />{" "}
      <span className="small">
        {t(`reportsP5.exportStage.${j.stage}`)}
        {j.sectionsTotal !== null
          ? ` · ${t("reportsP5.exports.sections", { done: j.sectionsDone, total: j.sectionsTotal })}`
          : ""}
      </span>
      <div>
        <progress max={100} value={j.percent} aria-label={label} />{" "}
        <bdi dir="ltr" className="small">
          {j.percent} %
        </bdi>
      </div>
      {j.status === "failed" && j.errorCode ? <ExportError code={j.errorCode} /> : null}
    </div>
  );
}

function ExportError({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <p className="small" data-export-error={code}>
      <Icon name="alert" /> {problemText(t, code)}
    </p>
  );
}

function fileSize(bytes: number | null, locale: "en" | "ar"): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${formatDecimal(String(Math.round(kib * 10) / 10), locale)} KB`;
  return `${formatDecimal(String(Math.round((kib / 1024) * 10) / 10), locale)} MB`;
}

/** Downloads a finished file through fetch, so a refusal (409/422/404) is shown as its translated problem. */
function useDownload() {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (j: ExportJob) => {
    const action = beginSessionGuard();
    setError(null);
    setBusy(j.id);
    try {
      const res = await fetch(buildUrl(reportPaths.download(j.id)), {
        credentials: "same-origin",
        headers: { Accept: `${j.contentType ?? "application/octet-stream"}, application/problem+json` },
      });
      if (action.stale()) return;
      if (!res.ok) {
        let problem: unknown = null;
        try {
          problem = await res.json();
        } catch {
          problem = null;
        }
        setError(new ApiError(res.status, problem as never));
        return;
      }
      const blob = await res.blob();
      if (action.stale()) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = j.fileName ?? `export.${j.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      if (!action.stale(e)) setError(e);
    } finally {
      if (action.current()) setBusy(null);
    }
  };
  return { error, busy, download };
}

export function ExportsPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const locale = useLocale();
  usePageTitle(t("reportsP5.exports.title"));
  const [status, setStatus] = useState("");
  const jobs = useExports(status ? { status } : {});
  const refresh = useReportsRefresh();
  const cancel = useRunner(refresh);
  const dl = useDownload();
  return (
    <div className="page" data-p5-screen="exports">
      <PageHeader
        title={t("reportsP5.exports.title")}
        subtitle={t("reportsP5.exports.intro")}
        crumbs={[
          { label: t("nav.areas.evidence.label"), to: "/evidence-reports" },
          ...(id ? [{ label: t("reportsP5.reports.title"), to: `/transformations/${id}/reports` }] : []),
          { label: t("reportsP5.exports.title") },
        ]}
      />
      <NotAnApprovalNote />
      <p className="small">{t("reportsP5.exports.howTo")}</p>
      <div className="filters" role="group" aria-label={t("reportsP5.exports.filters")}>
        <div className="field">
          <label className="field__label" htmlFor="export-filter-status">
            {t("reportsP5.field.status")}
          </label>
          <select id="export-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("reportsP5.generate.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`reportsP5.exportStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {cancel.alert}
      <FormAlert error={dl.error} namespaces={FEE_NS} />
      <QueryState
        query={jobs}
        isEmpty={(items) => items.filter((j) => !id || j.transformationId === id).length === 0}
        empty={<EmptyState title={t("reportsP5.exports.none")} body={t("reportsP5.exports.noneBody")} />}
      >
        {(all) => {
          const items = all.filter((j) => !id || j.transformationId === id);
          return (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("reportsP5.exports.title")}>
              <table className="table" data-table="exports">
                <caption className="visually-hidden">{t("reportsP5.exports.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("reportsP5.exports.requested")}</th>
                    <th scope="col">{t("reportsP5.exports.format")}</th>
                    <th scope="col">{t("reportsP5.exports.language")}</th>
                    <th scope="col">{t("reportsP5.exports.progress")}</th>
                    <th scope="col">{t("reportsP5.exports.file")}</th>
                    <th scope="col">{t("reportsP5.field.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((j) => (
                    <tr key={j.id} data-export-row={j.id}>
                      <th scope="row">
                        {formatDateTime(j.createdAt, locale)}
                        <span className="block small">
                          <Link className="link" to={`/transformations/${j.transformationId}/reports/${j.snapshotId}`}>
                            {t("reportsP5.exports.openSnapshot")}
                          </Link>
                        </span>
                      </th>
                      <td>{t(`reportsP5.format.${j.format}`)}</td>
                      <td>{t(`reportsP5.language.${j.language}`)}</td>
                      <td>
                        <ExportProgress job={j} />
                        {j.attemptCount > 1 ? (
                          <span className="block small muted">
                            {t("reportsP5.exports.attempts", { n: j.attemptCount })}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {j.status === "succeeded" ? (
                          <>
                            <bdi dir="ltr">{j.fileName}</bdi>
                            <span className="block small">{fileSize(j.fileSizeBytes, locale)}</span>
                            <span className="block small">
                              {t("reportsP5.evidence.checksum")}:{" "}
                              <bdi dir="ltr" className="code">
                                {j.fileSha256}
                              </bdi>
                            </span>
                          </>
                        ) : (
                          <span className="muted">{t("reportsP5.exports.noFile")}</span>
                        )}
                      </td>
                      <td>
                        {j.status === "succeeded" ? (
                          <button
                            type="button"
                            className="button button--small"
                            disabled={dl.busy === j.id}
                            onClick={() => void dl.download(j)}
                          >
                            {t("reportsP5.exports.download")}
                            <span className="visually-hidden"> {j.fileName}</span>
                          </button>
                        ) : null}
                        {j.status === "queued" || j.status === "running" ? (
                          <button
                            type="button"
                            className="button button--small"
                            disabled={cancel.busy}
                            onClick={() => void cancel.run(reportPaths.cancelExport(j.id), { ifMatch: j.version })}
                          >
                            {t("reportsP5.exports.cancel")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}
