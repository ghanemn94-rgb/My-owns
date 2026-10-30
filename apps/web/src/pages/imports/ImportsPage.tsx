// Strategy and KPIs > Imports (T-DG6-FE-C; p6-work-split §B/A.9; ADR-0056 §2-§6, §9; REQ-S17-002, REQ-S17-003,
// REQ-S17-005; D-195 Q1: under Strategy and KPIs, with an entry from Administration > Integrations).
//  - Templates: kpi_actual.v1 with its columns, downloadable as CSV or XLSX, prefilled with the transformation's KPIs.
//  - Upload: a CSV (UTF-8) or XLSX file is staged and validated; nothing is committed. The 10 MiB limit is checked
//    before sending; every other refusal (type, encoding, rows, header) is the server's, shown as one form-level alert.
//  - Batches: newest first, with their status and counts; counts are "Unknown" while staging, never 0.
//  - import.create (KDS) uploads; import.read (KDS, BO, TO, AUD) reads. AUD and every reader see no upload control.
//  Imports never depend on a connector: this screen works while a connector is stopped or disabled (REQ-S17-005).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { apiRequest } from "../../api/client.ts";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { useCursorPager } from "../../components/DataTable.tsx";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { TableScrollRegion } from "../../components/TableScrollRegion.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import { Count, PagedTable, type Col } from "../integrations/ui.tsx";
import { TransformationEntry } from "../reports/ui.tsx";
import {
  CSV_MEDIA_TYPE,
  IMPORT_BATCH_STATUSES,
  IMPORT_MAX_BYTES,
  IMPORT_SOURCE_KINDS,
  XLSX_MEDIA_TYPE,
  importPaths,
  useImportTemplates,
  useImports,
  useImportsRefresh,
  type ImportBatch,
  type ImportTemplate,
} from "./api.ts";
import { BatchStatusChip } from "./ui.tsx";

/** Strategy and KPIs > Imports: choose the transformation. */
export function ImportsEntryPage() {
  const { t } = useTranslation();
  return (
    <TransformationEntry
      screen="imports"
      title={t("imports.title")}
      summary={t("imports.entryIntro")}
      area={{ label: t("nav.areas.strategy.label"), to: "/strategy-kpis" }}
      to={(tid) => `/transformations/${tid}/imports`}
    />
  );
}

export function ImportsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const { id = "" } = useParams();
  usePageTitle(t("imports.title"));
  const transformation = useTransformation(id);
  const templates = useImportTemplates();
  const pager = useCursorPager();
  const [status, setStatus] = useState("");
  const [sourceKind, setSourceKind] = useState("");
  const { reset } = pager;
  useEffect(() => reset(), [status, sourceKind, reset]);
  const q = useImports(id, { ...(status ? { status } : {}), ...(sourceKind ? { sourceKind } : {}) }, pager.cursor);
  const canUpload = canAnywhere(me, "import.create");
  const cols: Col<ImportBatch>[] = [
    {
      id: "createdAt",
      label: t("imports.field.createdAt"),
      cell: (b) => (
        <Link className="link" to={`/transformations/${id}/imports/${b.id}`}>
          {formatDateTime(b.createdAt, locale)}
        </Link>
      ),
      sort: (b) => b.createdAt,
      hideable: false,
    },
    {
      id: "source",
      label: t("imports.field.source"),
      cell: (b) => (
        <span>
          {t(`imports.sourceKind.${b.sourceKind}`)}
          {b.fileName ? (
            <>
              {" · "}
              <bdi className="text-cell">{b.fileName}</bdi>
            </>
          ) : null}
        </span>
      ),
      sort: (b) => b.sourceKind,
    },
    {
      id: "template",
      label: t("imports.field.template"),
      cell: (b) => <bdi dir="ltr">{b.templateVersion}</bdi>,
    },
    {
      id: "status",
      label: t("imports.field.status"),
      cell: (b) => <BatchStatusChip status={b.status} />,
      sort: (b) => b.status,
    },
    {
      id: "rowsTotal",
      label: t("imports.field.rowsTotal"),
      cell: (b) => <Count value={b.rowsTotal} />,
      sort: (b) => b.rowsTotal,
    },
    {
      id: "rowsValid",
      label: t("imports.field.rowsValid"),
      cell: (b) => <Count value={b.rowsValid} />,
      sort: (b) => b.rowsValid,
    },
    {
      id: "rowsInvalid",
      label: t("imports.field.rowsInvalid"),
      cell: (b) => <Count value={b.rowsInvalid} />,
      sort: (b) => b.rowsInvalid,
    },
    {
      id: "rowsDuplicate",
      label: t("imports.field.rowsDuplicate"),
      cell: (b) => <Count value={b.rowsDuplicate} />,
      sort: (b) => b.rowsDuplicate,
    },
    {
      id: "rowsCommitted",
      label: t("imports.field.rowsCommitted"),
      cell: (b) => <Count value={b.rowsCommitted} />,
      sort: (b) => b.rowsCommitted,
    },
  ];
  return (
    <div className="page" data-p6-screen="imports">
      <PageHeader
        title={t("imports.title")}
        subtitle={t("imports.intro")}
        crumbs={[
          { label: t("nav.areas.strategy.label"), to: "/strategy-kpis/imports" },
          { label: transformation.data?.code ?? t("imports.transformation"), to: `/transformations/${id}` },
          { label: t("imports.title") },
        ]}
      />
      <p className="small">
        {t("imports.formAlternative")}{" "}
        <Link className="link" to={`/transformations/${id}/kpis`}>
          {t("imports.openKpis")}
        </Link>
      </p>
      <section className="card" aria-labelledby="import-templates-h">
        <h2 id="import-templates-h" className="card__title">
          {t("imports.templates.title")}
        </h2>
        <p className="small muted">{t("imports.templates.intro")}</p>
        <QueryState query={templates}>
          {(list) => (
            <ul className="plain-list" data-templates>
              {list.items.map((tpl) => (
                <TemplateItem key={tpl.templateVersion} template={tpl} tid={id} />
              ))}
            </ul>
          )}
        </QueryState>
      </section>
      {canUpload ? (
        <UploadForm tid={id} templates={templates.data?.items ?? []} />
      ) : (
        <p className="banner banner--info" data-read-only>
          <Icon name="lock" /> <span>{t("imports.readOnly")}</span>
        </p>
      )}
      <section className="card" aria-labelledby="import-batches-h">
        <h2 id="import-batches-h" className="card__title">
          {t("imports.batches.title")}
        </h2>
        <form className="filters" aria-label={t("common.filter.title")} onSubmit={(e) => e.preventDefault()}>
          <div className="filters__select">
            <label htmlFor="import-status-filter">{t("imports.field.status")}</label>
            <select id="import-status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("common.filter.any")}</option>
              {IMPORT_BATCH_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`imports.status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="filters__select">
            <label htmlFor="import-source-filter">{t("imports.field.source")}</label>
            <select id="import-source-filter" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
              <option value="">{t("common.filter.any")}</option>
              {IMPORT_SOURCE_KINDS.map((s) => (
                <option key={s} value={s}>
                  {t(`imports.sourceKind.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </form>
        <QueryState
          query={q}
          isEmpty={(p) => p.items.length === 0 && pager.pageNumber === 1}
          empty={<EmptyState title={t("imports.batches.emptyTitle")} body={t("imports.batches.emptyBody")} />}
        >
          {(p) => (
            <PagedTable
              tableId="import-batches"
              caption={t("imports.batches.title")}
              rows={p.items}
              cols={cols}
              getRowId={(b) => b.id}
              pager={pager}
              nextCursor={p.nextCursor}
              busy={q.isFetching}
            />
          )}
        </QueryState>
      </section>
    </div>
  );
}

function TemplateItem({ template: tpl, tid }: { template: ImportTemplate; tid: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = locale === "ar" ? tpl.titleAr : tpl.titleEn;
  return (
    <li data-template={tpl.templateVersion}>
      <strong>{title}</strong>{" "}
      <bdi dir="ltr" className="small muted">
        ({tpl.templateVersion})
      </bdi>
      <span className="toolbar">
        {tpl.mediaTypes.includes(CSV_MEDIA_TYPE) ? (
          <a
            className="button button--secondary button--small"
            href={importPaths.templateDownload(tpl.templateVersion, "csv", tid)}
            download
            data-download="csv"
          >
            <Icon name="archive" /> {t("imports.templates.downloadCsv")}
            <span className="visually-hidden">: {title}</span>
          </a>
        ) : null}
        {tpl.mediaTypes.includes(XLSX_MEDIA_TYPE) ? (
          <a
            className="button button--secondary button--small"
            href={importPaths.templateDownload(tpl.templateVersion, "xlsx", tid)}
            download
            data-download="xlsx"
          >
            <Icon name="archive" /> {t("imports.templates.downloadXlsx")}
            <span className="visually-hidden">: {title}</span>
          </a>
        ) : null}
      </span>
      <details>
        <summary>{t("imports.templates.columns", { count: tpl.columns.length })}</summary>
        <TableScrollRegion caption={t("imports.templates.columnsCaption", { template: title })}>
          <table className="table" data-template-columns>
            <caption className="visually-hidden">{t("imports.templates.columnsCaption", { template: title })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("imports.templates.column")}</th>
                <th scope="col">{t("imports.templates.label")}</th>
                <th scope="col">{t("imports.templates.required")}</th>
                <th scope="col">{t("imports.templates.kind")}</th>
                <th scope="col">{t("imports.templates.example")}</th>
              </tr>
            </thead>
            <tbody>
              {tpl.columns.map((c) => (
                <tr key={c.key}>
                  <td>
                    <bdi dir="ltr">{c.key}</bdi>
                  </td>
                  <td>{locale === "ar" ? c.labelAr : c.labelEn}</td>
                  <td>{c.required ? t("imports.templates.yes") : t("imports.templates.no")}</td>
                  <td>{t(`imports.columnKind.${c.kind}`)}</td>
                  <td>
                    {c.example ? (
                      <bdi dir="ltr">{c.example}</bdi>
                    ) : (
                      <span className="muted">{t("common.value.none")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      </details>
    </li>
  );
}

/** The media type of a chosen file from its extension; the server checks it against the content (ADR-0056 §3). */
export function importMediaType(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return CSV_MEDIA_TYPE;
  if (lower.endsWith(".xlsx")) return XLSX_MEDIA_TYPE;
  return null;
}

/** X-File-Name: printable ASCII as is; anything else percent-encoded (an HTTP header value cannot carry it raw). */
export function fileNameHeader(fileName: string): string {
  return /^[\x20-\x7e]+$/.test(fileName) ? fileName : encodeURIComponent(fileName);
}

function UploadForm({ tid, templates }: { tid: string; templates: readonly ImportTemplate[] }) {
  const { t } = useTranslation();
  const begin = useSessionBoundAction();
  const refresh = useImportsRefresh();
  const fileRef = useRef<HTMLInputElement>(null);
  const [template, setTemplate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const chosenTemplate = template || templates[0]?.templateVersion || "";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setTemplateError(chosenTemplate ? null : "validation.required");
    let fErr: string | null = null;
    if (!file) fErr = "imports.upload.chooseFile";
    else if (!importMediaType(file.name)) fErr = "imports.upload.wrongType";
    else if (file.size === 0) fErr = "imports.upload.emptyFile";
    else if (file.size > IMPORT_MAX_BYTES) fErr = "problems.import__file_too_large";
    setFileError(fErr);
    if (fErr || !chosenTemplate || !file) return;
    const action = begin();
    setBusy(true);
    try {
      const res = await apiRequest<ImportBatch>(importPaths.imports(tid), {
        method: "POST",
        query: { template: chosenTemplate },
        rawBody: file,
        contentType: importMediaType(file.name)!,
        headers: { "X-File-Name": fileNameHeader(file.name) },
      });
      if (action.stale()) return;
      setBusy(false);
      await refresh();
      action.navigate(`/transformations/${tid}/imports/${res.data.id}`);
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
    }
  };
  return (
    <section className="card" aria-labelledby="import-upload-h">
      <h2 id="import-upload-h" className="card__title">
        {t("imports.upload.title")}
      </h2>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} data-upload-form>
        {formError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
          </p>
        ) : null}
        <p className="small muted">{t("imports.upload.intro")}</p>
        <Field
          label={t("imports.field.template")}
          error={templateError ? t("problems.validation__required") : undefined}
          required
        >
          {(c) => (
            <select {...c} value={chosenTemplate} onChange={(e) => setTemplate(e.target.value)}>
              {templates.map((tpl) => (
                <option key={tpl.templateVersion} value={tpl.templateVersion}>
                  {tpl.templateVersion}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("imports.upload.file")}
          hint={t("imports.upload.fileHint")}
          error={fileError ? t(fileError) : undefined}
          required
        >
          {(c) => (
            <input
              {...c}
              ref={fileRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </Field>
        <div className="toolbar">
          <button type="submit" className="button button--primary" disabled={busy}>
            <Icon name="plus" /> {busy ? t("imports.upload.staging") : t("imports.upload.submit")}
          </button>
        </div>
      </form>
    </section>
  );
}
