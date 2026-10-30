// Strategy and KPIs > Imports > one batch (T-DG6-FE-C; ADR-0056 §2, §5, §6; REQ-S17-002).
//  - The source (file name, size and SHA-256; webhook receipt; or connector run), the pinned form schema version, the
//    status and the counts ("Unknown" while staging). A staged batch is labelled "Staged – not committed": it is a
//    draft, never shown as committed data.
//  - The staged rows in source order with their raw cells (text), validation status, row-level reasons in English or
//    Arabic, duplicate pointer, commit status and lineage (the KPI actual a committed row created).
//  - Commit (valid rows only; each through the DG4 submission path, never accepted directly) and Cancel (with a reason)
//    for import.commit (KDS); If-Match is the batch version; a 409 reloads it. AUD and readers see no action.
import type { TFunction } from "i18next";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { apiRequest, ApiError } from "../../api/client.ts";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { useCursorPager } from "../../components/DataTable.tsx";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { errorMessage } from "../../lib/problem.ts";
import { Count, PagedTable, type Col } from "../integrations/ui.tsx";
import {
  IMPORT_ROW_STATUSES,
  importPaths,
  useImport,
  useImportRows,
  useImportTemplates,
  useImportsRefresh,
  type ImportBatch,
  type ImportRow,
  type ImportTemplateColumn,
} from "./api.ts";
import { BatchStatusChip, CommitStatusText, RowStatusChip, columnLabel, reasonText } from "./ui.tsx";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ImportPage() {
  const { t } = useTranslation();
  const { id = "", importId = "" } = useParams();
  usePageTitle(t("imports.batch.title"));
  const transformation = useTransformation(id);
  const q = useImport(id, importId);
  return (
    <div className="page" data-p6-screen="import-batch">
      <PageHeader
        title={t("imports.batch.title")}
        crumbs={[
          { label: t("nav.areas.strategy.label"), to: "/strategy-kpis/imports" },
          { label: transformation.data?.code ?? t("imports.transformation"), to: `/transformations/${id}` },
          { label: t("imports.title"), to: `/transformations/${id}/imports` },
          { label: t("imports.batch.title") },
        ]}
      />
      <QueryState query={q}>{(b) => <BatchView key={b.version} batch={b} tid={id} />}</QueryState>
    </div>
  );
}

function BatchView({ batch: b, tid }: { batch: ImportBatch; tid: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useImportsRefresh();
  const templates = useImportTemplates();
  const columns = templates.data?.items.find((x) => x.templateVersion === b.templateVersion)?.columns;
  const canCommit = canAnywhere(me, "import.commit") && b.status === "staged";
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const cancel = async (reason: string) => {
    const action = beginSessionGuard();
    await apiRequest<ImportBatch>(importPaths.cancel(tid, b.id), {
      method: "POST",
      body: { reason },
      ifMatch: b.version,
    });
    if (action.stale()) return;
    setCancelling(false);
    setNotice(t("imports.batch.cancelled"));
    await refresh();
  };

  return (
    <>
      {b.status === "staged" ? (
        <p className="banner banner--warning" data-draft-label>
          <Icon name="pencil" /> <span>{t("imports.batch.stagedNotCommitted")}</span>
        </p>
      ) : null}
      {notice ? (
        <p className="banner banner--success" role="status">
          <Icon name="check" /> <span>{notice}</span>
        </p>
      ) : null}
      <section className="card" aria-labelledby="batch-facts-h">
        <h2 id="batch-facts-h" className="card__title">
          {t("imports.batch.factsTitle")}
        </h2>
        <dl className="facts">
          <dt>{t("imports.field.status")}</dt>
          <dd>
            <BatchStatusChip status={b.status} />
            {b.failureCode ? <span className="small muted"> {errorMessageFromCode(t, b.failureCode)}</span> : null}
          </dd>
          <dt>{t("imports.field.source")}</dt>
          <dd>
            {t(`imports.sourceKind.${b.sourceKind}`)}
            {b.fileName ? (
              <>
                {" · "}
                <bdi className="text-cell">{b.fileName}</bdi>
              </>
            ) : null}
            {b.connectorId && b.integrationRunId ? (
              <>
                {" · "}
                <Link
                  className="link"
                  to={`/admin/integrations/connectors/${b.connectorId}/runs/${b.integrationRunId}`}
                >
                  {t("imports.batch.openRun")}
                </Link>
              </>
            ) : null}
          </dd>
          {b.byteSize !== null ? (
            <>
              <dt>{t("imports.batch.size")}</dt>
              <dd>
                <bdi dir="ltr">{t("imports.batch.bytes", { n: b.byteSize })}</bdi>
              </dd>
            </>
          ) : null}
          {b.contentSha256 ? (
            <>
              <dt>{t("imports.batch.sha256")}</dt>
              <dd>
                <bdi dir="ltr" className="mono small">
                  {b.contentSha256}
                </bdi>
              </dd>
            </>
          ) : null}
          <dt>{t("imports.field.template")}</dt>
          <dd>
            <bdi dir="ltr">{b.templateVersion}</bdi>
          </dd>
          <dt>{t("imports.batch.formSchemaVersion")}</dt>
          <dd>
            <bdi dir="ltr" className="mono small">
              {b.formSchemaVersionId}
            </bdi>
          </dd>
          <dt>{t("imports.field.createdAt")}</dt>
          <dd>{formatDateTime(b.createdAt, locale)}</dd>
          <dt>{t("imports.field.rowsTotal")}</dt>
          <dd>
            <Count value={b.rowsTotal} />
          </dd>
          <dt>{t("imports.field.rowsValid")}</dt>
          <dd>
            <Count value={b.rowsValid} />
          </dd>
          <dt>{t("imports.field.rowsInvalid")}</dt>
          <dd>
            <Count value={b.rowsInvalid} />
          </dd>
          <dt>{t("imports.field.rowsDuplicate")}</dt>
          <dd>
            <Count value={b.rowsDuplicate} />
          </dd>
          <dt>{t("imports.field.rowsCommitted")}</dt>
          <dd>
            <Count value={b.rowsCommitted} />
          </dd>
          {b.committedAt ? (
            <>
              <dt>{t("imports.batch.committedAt")}</dt>
              <dd>
                {formatDateTime(b.committedAt, locale)}
                {b.commitMode === "auto" ? (
                  <span className="small muted"> {t("imports.batch.autoCommitted")}</span>
                ) : null}
              </dd>
            </>
          ) : null}
          {b.cancelledAt ? (
            <>
              <dt>{t("imports.batch.cancelledAt")}</dt>
              <dd>
                {formatDateTime(b.cancelledAt, locale)}
                {b.cancelReason ? <span className="small muted"> {b.cancelReason}</span> : null}
              </dd>
            </>
          ) : null}
        </dl>
        {b.status === "staging" ? (
          <p className="small muted" role="status">
            {t("imports.batch.stagingNote")}
          </p>
        ) : null}
      </section>

      {canCommit ? (
        <CommitForm
          batch={b}
          tid={tid}
          onCancel={() => setCancelling(true)}
          onCommitted={() => setNotice(t("imports.batch.committed"))}
        />
      ) : b.status === "staged" && !canAnywhere(me, "import.commit") ? (
        <p className="banner banner--info" data-read-only>
          <Icon name="lock" /> <span>{t("imports.readOnly")}</span>
        </p>
      ) : null}

      <RowsSection batch={b} tid={tid} columns={columns} />

      {cancelling ? (
        <ReasonDialog
          title={t("imports.batch.cancelTitle")}
          description={t("imports.batch.cancelBody")}
          confirmLabel={t("imports.batch.cancel")}
          onConfirm={cancel}
          onClose={() => setCancelling(false)}
        />
      ) : null}
    </>
  );
}

/** The text of a stored failure code (a problem code without params): its no-params text, its text, or the code. */
function errorMessageFromCode(t: TFunction, code: string): string {
  const key = `problems.${code.replace(/\./g, "__")}`;
  return t(`${key}_noParams`, { defaultValue: "" }) || t(key, { defaultValue: "" }) || code;
}

function CommitForm({
  batch: b,
  tid,
  onCancel,
  onCommitted,
}: {
  batch: ImportBatch;
  tid: string;
  onCancel: () => void;
  onCommitted: () => void;
}) {
  const { t } = useTranslation();
  const refresh = useImportsRefresh();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmed = note.trim();
    if (trimmed !== "" && trimmed.length < 3) {
      setNoteError(true);
      return;
    }
    setNoteError(false);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await apiRequest<ImportBatch>(importPaths.commit(tid, b.id), {
        method: "POST",
        body: { note: trimmed === "" ? null : note },
        ifMatch: b.version,
      });
      if (action.stale()) return;
      setBusy(false);
      onCommitted();
      await refresh();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
      if (err instanceof ApiError && err.status === 409) await refresh();
    }
  };
  return (
    <section className="card" aria-labelledby="batch-commit-h">
      <h2 id="batch-commit-h" className="card__title">
        {t("imports.batch.commitTitle")}
      </h2>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} data-commit-form>
        {formError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
          </p>
        ) : null}
        {(b.rowsValid ?? 0) === 0 ? (
          <p data-nothing-to-commit>{t("imports.batch.nothingToCommit")}</p>
        ) : (
          <>
            <p>{t("imports.batch.commitIntro", { valid: b.rowsValid ?? 0 })}</p>
            <p className="small muted">{t("imports.batch.commitPath")}</p>
          </>
        )}
        {(b.rowsValid ?? 0) === 0 ? null : (
          <Field
            label={t("imports.batch.note")}
            hint={t("imports.batch.noteHint")}
            error={noteError ? t("imports.batch.noteTooShort") : undefined}
          >
            {(c) => (
              <textarea {...c} rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
            )}
          </Field>
        )}
        <div className="toolbar">
          {(b.rowsValid ?? 0) === 0 ? null : (
            <button type="submit" className="button button--primary" disabled={busy}>
              <Icon name="check" /> {busy ? t("imports.batch.committing") : t("imports.batch.commit")}
            </button>
          )}
          <button type="button" className="button button--secondary" disabled={busy} onClick={onCancel}>
            {t("imports.batch.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}

function RowsSection({
  batch: b,
  tid,
  columns,
}: {
  batch: ImportBatch;
  tid: string;
  columns: readonly ImportTemplateColumn[] | undefined;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const pager = useCursorPager();
  const [status, setStatus] = useState("");
  const { reset } = pager;
  useEffect(() => reset(), [status, reset]);
  const q = useImportRows(tid, b.id, status ? { validationStatus: status } : {}, pager.cursor);
  const cols: Col<ImportRow>[] = [
    {
      id: "rowNumber",
      label: t("imports.rows.rowNumber"),
      cell: (r) => <bdi dir="ltr">{r.rowNumber}</bdi>,
      sort: (r) => r.rowNumber,
      hideable: false,
    },
    {
      id: "sourceRecordId",
      label: t("imports.rows.sourceRecordId"),
      cell: (r) =>
        r.sourceRecordId ? (
          <bdi dir="ltr">{r.sourceRecordId}</bdi>
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
      sort: (r) => r.sourceRecordId,
    },
    {
      id: "validation",
      label: t("imports.rows.validation"),
      cell: (r) => <RowStatusChip status={r.validationStatus} />,
      sort: (r) => r.validationStatus,
    },
    {
      id: "reasons",
      label: t("imports.rows.reasons"),
      cell: (r) =>
        r.reasons.length === 0 ? (
          <span className="muted">{t("common.value.none")}</span>
        ) : (
          <ul className="plain-list" data-reasons>
            {r.reasons.map((x, i) => (
              <li key={i} data-reason={x.code}>
                {reasonText(t, x, columns, locale)}
              </li>
            ))}
          </ul>
        ),
      hideable: false,
    },
    {
      id: "commit",
      label: t("imports.rows.commitStatus"),
      cell: (r) => <CommitStatusText status={r.commitStatus} />,
      sort: (r) => r.commitStatus,
    },
    {
      id: "lineage",
      label: t("imports.rows.lineage"),
      cell: (r) => {
        if (!r.lineage) return <span className="muted">{t("common.value.none")}</span>;
        const kpiId = r.raw["kpi_id"];
        const text = t("imports.rows.lineageText", { valueNo: r.lineage.targetValueNo });
        return kpiId && UUID.test(kpiId) ? (
          <Link
            className="link"
            to={`/transformations/${tid}/kpis/${kpiId}/actuals/${r.lineage.targetRecordId}`}
            data-lineage
          >
            {text}
          </Link>
        ) : (
          <span data-lineage>{text}</span>
        );
      },
    },
    {
      id: "cells",
      label: t("imports.rows.cells"),
      cell: (r) => (
        <details>
          <summary>{t("imports.rows.showCells", { count: Object.keys(r.raw).length })}</summary>
          <dl className="facts small">
            {Object.entries(r.raw).map(([k, v]) => (
              <div key={k}>
                <dt>{columnLabel(k, columns, locale)}</dt>
                <dd>
                  {v === null ? (
                    <span className="muted">{t("imports.rows.emptyCell")}</span>
                  ) : (
                    <bdi className="text-cell">{v}</bdi>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ),
    },
  ];
  return (
    <section className="card" aria-labelledby="batch-rows-h">
      <h2 id="batch-rows-h" className="card__title">
        {t("imports.rows.title")}
      </h2>
      <form className="filters" aria-label={t("common.filter.title")} onSubmit={(e) => e.preventDefault()}>
        <div className="filters__select">
          <label htmlFor="row-status-filter">{t("imports.rows.validation")}</label>
          <select id="row-status-filter" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("common.filter.any")}</option>
            {IMPORT_ROW_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`imports.rowStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
      </form>
      <QueryState
        query={q}
        isEmpty={(p) => p.items.length === 0 && pager.pageNumber === 1}
        empty={
          b.status === "staging" ? (
            <EmptyState title={t("imports.rows.emptyTitle")} body={t("imports.batch.stagingNote")} />
          ) : (
            <EmptyState title={t("imports.rows.emptyTitle")} />
          )
        }
      >
        {(p) => (
          <PagedTable
            tableId="import-rows"
            caption={t("imports.rows.title")}
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
