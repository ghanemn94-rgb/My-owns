// The export form of a snapshot (T-DG5-FE-E; REQ-S13-005, REQ-S13-009; ADR-0046 §2, §5): one of the formats the output
// offers (PDF, DOCX, XLSX, PPTX, CSV) and the language of the file (English LTR or Arabic RTL, bundled fonts). Every
// export is an asynchronous job rendered by the worker; the form starts it with an Idempotency-Key (a repeated click
// returns the same job, 200) and then shows the job's progress, which is polled until it ends. A generated snapshot is
// exported marked "Draft — not an issued report" in the file.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { newIdempotencyKey } from "../../api/client.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { reportPaths, useExports, useReportsRefresh, type ExportJob } from "../reports/api.ts";
import { useRunner } from "../reports/ui.tsx";
import { ExportProgress } from "./ExportsPage.tsx";

export function ExportForm({
  snapshotId,
  formats,
  draft,
  discarded = false,
}: {
  snapshotId: string;
  formats: readonly string[];
  draft: boolean;
  /** A discarded snapshot is not exported; the section stays so a refusal that discovered it stays visible. */
  discarded?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useReportsRefresh();
  const runner = useRunner(refresh);
  const [format, setFormat] = useState(formats[0] ?? "pdf");
  const [language, setLanguage] = useState<string>(locale);
  // One key per intended export: a retry of the same choice reuses it; a new choice gets a new key.
  const [key, setKey] = useState(() => newIdempotencyKey());
  const [jobId, setJobId] = useState<string | null>(null);
  const jobs = useExports();
  const job = jobId ? (jobs.data ?? []).find((j) => j.id === jobId) : undefined;
  if (!canAnywhere(me, "export.create"))
    return (
      <p className="small muted" data-state="read-only">
        {t("reportsP5.exports.readOnly")}
      </p>
    );
  if (discarded)
    return (
      <>
        {runner.alert}
        <p className="small muted" data-state="export-discarded">
          {t("reportsP5.exports.discarded")}
        </p>
      </>
    );
  return (
    <>
      <form
        className="form"
        noValidate
        data-form="create-export"
        onSubmit={(e) => {
          e.preventDefault();
          void runner
            .run<ExportJob>(reportPaths.exports, { body: { snapshotId, format, language }, idempotencyKey: key })
            .then((j) => {
              if (j) setJobId(j.id);
            });
        }}
      >
        {runner.alert}
        {draft ? (
          <p className="small" data-state="draft-export">
            {t("reportsP5.exports.draftNote")}
          </p>
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor="export-format">
            {t("reportsP5.exports.format")}
          </label>
          <select
            id="export-format"
            value={format}
            onChange={(e) => {
              setFormat(e.target.value);
              setKey(newIdempotencyKey());
            }}
          >
            {formats.map((f) => (
              <option key={f} value={f}>
                {t(`reportsP5.format.${f}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="export-language">
            {t("reportsP5.exports.language")}
          </label>
          <select
            id="export-language"
            value={language}
            onChange={(e) => {
              setLanguage(e.target.value);
              setKey(newIdempotencyKey());
            }}
          >
            <option value="en">{t("reportsP5.language.en")}</option>
            <option value="ar">{t("reportsP5.language.ar")}</option>
          </select>
        </div>
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {t("reportsP5.exports.start")}
          </button>
        </div>
      </form>
      {jobId ? (
        <div className="card" data-started-export={jobId} aria-live="polite">
          {job ? <ExportProgress job={job} /> : <p className="muted">{t("common.state.loading")}</p>}
          <p className="small">
            <Link className="link" to="/evidence-reports/exports">
              {t("reportsP5.exports.openList")}
            </Link>
          </p>
        </div>
      ) : null}
    </>
  );
}
