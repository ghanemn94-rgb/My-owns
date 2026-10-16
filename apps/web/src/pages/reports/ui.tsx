// Shared UI of the FE-E screens (T-DG5-FE-E; p5-plan §5.1 row FE-E; ADR-0045, ADR-0046): generated reports and
// snapshots, exports, presentation mode, owner updates and the evidence register.
//  - A report is rendered from its document model (ADR-0045 §3): system labels are i18n keys translated at render time
//    through the shared content-label table (`REPORT_CONTENT_LABELS`, @mth/shared; KBE-D2, D-159 c), the same table the
//    export files use, so a screen and a file print the same heading. User-authored text is shown as authored.
//  - Every value shows its validation (ADR-0045 §5): "Provisional" next to a provisional value; "Unknown" or "Stale"
//    IN PLACE of the number (never 0, never green); "n/a" for a value that does not apply. A legend explains them.
//  - Status chips always carry a text label and an icon (never colour alone; blue never means favourable).
//  - Every action goes through one guarded runner: If-Match from the record the user saw, session-bound, one
//    form-level alert per form that shows the translated problem code. A 409 or 422 reloads the data.
//  - Issuing a report, submitting an owner update or exporting approves nothing. Product gates G1–G6 are business
//    approvals inside the product; the engineering delivery gates DG0–DG7 are never shown.
import { REPORT_CONTENT_LABELS, type Locale } from "@mth/shared";
import type { ReportDocument, ReportSection, ReportValue } from "@mth/shared/schemas";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api, ApiError } from "../../api/client.ts";
import { useTransformations } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Icon, type IconName } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle, type Crumb } from "../../components/Page.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatBusinessDate, formatDateTime, formatDecimal, formatMoney, formatPercent } from "../../lib/format.ts";
import { FormAlert } from "../my-work/p4ui.tsx";

/** The i18n namespace of every FE-E text (en and ar; `reportsP5.problem.*` overrides come before `problems.*`). */
export const FEE_NS = ["reportsP5"] as const;

// ------------------------------------------------------------------------------------------------ chips

export type ChipTone = "good" | "warn" | "bad" | "neutral" | "stale" | "draft" | "closed";

const TONE_CLASS: Record<ChipTone, string> = {
  good: "status-chip status-chip--on-track",
  warn: "status-chip status-chip--at-risk",
  bad: "status-chip status-chip--off-track",
  neutral: "status-chip status-chip--unknown",
  stale: "status-chip status-chip--stale",
  draft: "lifecycle-chip lifecycle-chip--draft",
  closed: "lifecycle-chip lifecycle-chip--closed",
};

/** A status chip: tone + icon + translated label (the label is always present). */
export function Chip({ tone, icon, label, data }: { tone: ChipTone; icon: IconName; label: string; data?: string }) {
  return (
    <span className={TONE_CLASS[tone]} data-status={data ?? ""}>
      <Icon name={icon} /> {label}
    </span>
  );
}

const SNAPSHOT_STATUS: Record<string, readonly [ChipTone, IconName]> = {
  generated: ["draft", "pencil"],
  issued: ["closed", "lock"],
  superseded: ["neutral", "archive"],
  discarded: ["neutral", "cross"],
};

/** A snapshot's status: "Generated (draft)" is never mistaken for an issued report. */
export function SnapshotStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const entry = SNAPSHOT_STATUS[status] ?? (["neutral", "question"] as const);
  return <Chip tone={entry[0]} icon={entry[1]} label={t(`reportsP5.snapshotStatus.${status}`)} data={status} />;
}

const EXPORT_STATUS: Record<string, readonly [ChipTone, IconName]> = {
  queued: ["neutral", "clock"],
  running: ["neutral", "refresh"],
  succeeded: ["closed", "check"],
  failed: ["bad", "alert"],
  cancelled: ["neutral", "stop"],
};

export function ExportStatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const entry = EXPORT_STATUS[status] ?? (["neutral", "question"] as const);
  return <Chip tone={entry[0]} icon={entry[1]} label={t(`reportsP5.exportStatus.${status}`)} data={status} />;
}

/** The recorded approval state of the sources (ADR-0045 §3): a fact about the records, never an approval. */
export function ApprovalStateText({ state }: { state: string }) {
  const { t } = useTranslation();
  return <span data-approval-state={state}>{t(`reportsP5.approvalState.${state}`)}</span>;
}

// ------------------------------------------------------------------------------------------------ labels and values

/** The text of a content label key in the locale (the shared export table); a missing key is shown as the key. */
export function contentLabel(locale: Locale, key: string | null | undefined): string {
  if (!key) return "";
  return REPORT_CONTENT_LABELS[locale][key] ?? key;
}

/** The validation label next to (provisional) or in place of (unknown, stale) a value. */
export function ValidationChip({ validation }: { validation: string }) {
  const { t } = useTranslation();
  if (validation === "provisional")
    return <Chip tone="warn" icon="alert" label={t("reportsP5.validation.provisional")} data="provisional" />;
  if (validation === "unknown")
    return <Chip tone="neutral" icon="question" label={t("reportsP5.validation.unknown")} data="unknown" />;
  if (validation === "stale")
    return <Chip tone="stale" icon="clock" label={t("reportsP5.validation.stale")} data="stale" />;
  return null;
}

function numberText(v: Extract<ReportValue, { type: "decimal" }>, locale: Locale): string | null {
  if (v.value === null) return null;
  if (v.unitKind === "currency") return formatMoney(v.value, v.currency ?? undefined, locale);
  if (v.unitKind === "percentage") return formatPercent(v.value, locale);
  return formatDecimal(v.value, locale, { maxFractionDigits: 4 });
}

/** One value of a report, with its validation (ADR-0045 §5). Unknown and Stale never show a number. */
export function ReportValueView({ value: v }: { value: ReportValue }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (v.validation === "unknown" || v.validation === "stale")
    return (
      <span className="report-value" data-validation={v.validation} data-reason={v.reason ?? ""}>
        <ValidationChip validation={v.validation} />
        {v.reason ? <span className="small muted"> {t(`reportsP5.reason.${v.reason}`)}</span> : null}
      </span>
    );
  let text: ReactNode;
  switch (v.type) {
    case "text":
      text = v.value === null ? null : <span className="report-text">{v.value}</span>;
      break;
    case "decimal": {
      const n = numberText(v, locale);
      text =
        n === null ? null : (
          <>
            <bdi dir="ltr">{n}</bdi>
            {v.valueBasis ? <span className="small muted"> · {t(`reportsP5.valueBasis.${v.valueBasis}`)}</span> : null}
          </>
        );
      break;
    }
    case "date":
      text = formatBusinessDate(v.value, locale);
      break;
    case "timestamp":
      text = formatDateTime(v.value, locale);
      break;
    case "code":
      text = v.value === null ? null : v.labelKey ? contentLabel(locale, v.labelKey) : <bdi dir="ltr">{v.value}</bdi>;
      break;
    case "count":
      text = v.value === null ? null : <bdi dir="ltr">{formatDecimal(String(v.value), locale)}</bdi>;
      break;
  }
  return (
    <span className="report-value" data-validation={v.validation}>
      {text ?? <span className="muted">{t("reportsP5.notApplicable")}</span>}
      {v.validation === "provisional" ? (
        <>
          {" "}
          <ValidationChip validation="provisional" />
        </>
      ) : null}
    </span>
  );
}

/** The legend of the validation labels (ADR-0045 §5: on the first page of every rendering). */
export function ValidationLegend() {
  const { t } = useTranslation();
  return (
    <p className="small" data-legend="validation">
      <ValidationChip validation="provisional" /> {t("reportsP5.legend.provisional")}{" "}
      <ValidationChip validation="unknown" /> {t("reportsP5.legend.unknown")} <ValidationChip validation="stale" />{" "}
      {t("reportsP5.legend.stale")}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ document

/**
 * The empty text of a list or table section. `report.empty.no_records` is a frame label of the exporters
 * (@mth/reporting FRAME_LABELS, which the web does not import), so it and any empty key missing from the content table
 * are shown with the web's own "No records" text in the screen's language, never as a raw key.
 */
function useEmptyText(): (key: string | null) => string {
  const locale = useLocale();
  const { t } = useTranslation();
  return (key) => (key && REPORT_CONTENT_LABELS[locale][key]) || t("reportsP5.noRecords");
}

function SectionView({ section: s }: { section: ReportSection }) {
  const locale = useLocale();
  const { t } = useTranslation();
  const emptyText = useEmptyText();
  const title = contentLabel(locale, s.titleKey);
  const headingId = `report-section-${s.key}`;
  let body: ReactNode;
  switch (s.kind) {
    case "fields":
    case "metrics":
      body =
        s.fields.length === 0 ? (
          <p className="muted">{t("reportsP5.noRecords")}</p>
        ) : (
          <dl className="workspace-header__grid">
            {s.fields.map((f) => (
              <div key={f.key} className="report-field" data-field={f.key}>
                <dt>{contentLabel(locale, f.labelKey)}</dt>
                <dd>
                  <ReportValueView value={f.value} />
                </dd>
              </div>
            ))}
          </dl>
        );
      break;
    case "text":
      body = (
        <p className="report-text-block">
          <ReportValueView value={s.text} />
        </p>
      );
      break;
    case "list":
      body =
        s.items.length === 0 ? (
          <p className="muted">{emptyText(s.emptyKey)}</p>
        ) : (
          <ul className="plain-list">
            {s.items.map((item, i) => (
              <li key={`${item.record?.recordId ?? "item"}-${i}`}>
                <ReportValueView value={item.value} />
              </li>
            ))}
          </ul>
        );
      break;
    case "table":
      body =
        s.rows.length === 0 ? (
          <p className="muted" data-empty-table={s.key}>
            {emptyText(s.emptyKey)}
          </p>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-labelledby={headingId}>
            <table className="table" data-report-table={s.key}>
              <caption className="visually-hidden">{title}</caption>
              <thead>
                <tr>
                  {s.columns.map((c) => (
                    <th key={c.key} scope="col" data-column={c.key}>
                      {contentLabel(locale, c.labelKey)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.recordId} data-record={r.recordId}>
                    {r.cells.map((cell, j) => (
                      <td key={s.columns[j]?.key ?? j}>
                        <ReportValueView value={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {s.totals.length > 0 ? (
                <tfoot>
                  <tr data-totals="true">
                    {s.columns.map((c, j) => {
                      const total = s.totals.find((x) => x.columnKey === c.key);
                      return j === 0 && !total ? (
                        <th key={c.key} scope="row">
                          {t("reportsP5.total")}
                        </th>
                      ) : (
                        <td key={c.key}>{total ? <ReportValueView value={total.value} /> : null}</td>
                      );
                    })}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        );
      break;
  }
  return (
    <section className="card" aria-labelledby={headingId} data-report-section={s.key} data-section-kind={s.kind}>
      <h3 id={headingId} className="card__title">
        {title}
      </h3>
      {body}
    </section>
  );
}

/** The header facts of a report document: what, about whom, when, under which methodology, in which state. */
export function DocumentFacts({ doc }: { doc: ReportDocument }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <dl className="workspace-header__grid" data-document-facts="true">
      <dt>{t("reportsP5.facts.transformation")}</dt>
      <dd>
        <bdi dir="ltr" className="code" data-transformation-code="true">
          {doc.transformation.code}
        </bdi>{" "}
        {doc.transformation.name}
      </dd>
      <dt>{t("reportsP5.facts.subject")}</dt>
      <dd>
        {doc.subject.code ? (
          <>
            <bdi dir="ltr" className="code">
              {doc.subject.code}
            </bdi>{" "}
          </>
        ) : null}
        {doc.subject.label}
      </dd>
      <dt>{t("reportsP5.facts.period")}</dt>
      <dd>{doc.period ? doc.period.label : t("reportsP5.facts.noPeriod")}</dd>
      <dt>{t("reportsP5.facts.asOf")}</dt>
      <dd data-as-of={doc.asOf}>{formatDateTime(doc.asOf, locale)}</dd>
      <dt>{t("reportsP5.facts.methodology")}</dt>
      <dd>
        <bdi dir="ltr">
          {doc.methodology.key} v{doc.methodology.versionNo}
        </bdi>
      </dd>
      <dt>{t("reportsP5.facts.approvalState")}</dt>
      <dd>
        <ApprovalStateText state={doc.approvalState} />
      </dd>
    </dl>
  );
}

/** A whole report document: legend, then each section in order. Nothing in it is editable (M0212). */
export function ReportDocumentView({ doc, headingLevel = 2 }: { doc: ReportDocument; headingLevel?: 2 | 3 }) {
  const { t } = useTranslation();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="report-document" data-report-document={doc.definitionCode}>
      <section className="card" aria-labelledby="report-facts">
        <Heading id="report-facts" className="card__title">
          {t("reportsP5.facts.title")}
        </Heading>
        <DocumentFacts doc={doc} />
        <ValidationLegend />
      </section>
      {doc.sections.length === 0 ? <p className="muted">{t("reportsP5.noRecords")}</p> : null}
      {doc.sections.map((s) => (
        <SectionView key={s.key} section={s} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ runner

export interface Runner {
  readonly busy: boolean;
  readonly error: unknown;
  readonly clear: () => void;
  run: <T>(
    url: string,
    options: { method?: "POST" | "PATCH"; body?: unknown; ifMatch?: number; idempotencyKey?: string },
  ) => Promise<T | null>;
  /** The form-level alert (one per form). */
  readonly alert: ReactNode;
}

/** A guarded runner for one form's actions, with its one form-level alert (translated problem code). */
export function useRunner(refresh: () => Promise<unknown>): Runner {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async <T,>(
    url: string,
    options: { method?: "POST" | "PATCH"; body?: unknown; ifMatch?: number; idempotencyKey?: string },
  ): Promise<T | null> => {
    const action = beginSessionGuard();
    setBusy(true);
    setError(null);
    try {
      const result = await api.send<T>(url, {
        method: options.method ?? "POST",
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.ifMatch === undefined ? {} : { ifMatch: options.ifMatch }),
        ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      });
      if (action.stale()) return null;
      await refresh();
      if (action.stale()) return null;
      return result;
    } catch (e) {
      if (action.stale(e)) return null;
      setError(e);
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) await refresh();
      return null;
    } finally {
      if (action.current()) setBusy(false);
    }
  };
  return {
    busy,
    error,
    clear: () => setError(null),
    run,
    alert: <FormAlert error={error} namespaces={FEE_NS} />,
  };
}

/** A small labelled text form (reason, note) with one submit button; the value is checked for visible text. */
export function NoteForm({
  id,
  label,
  submitLabel,
  required,
  min = 1,
  max = 1000,
  busy,
  onSubmit,
  danger,
}: {
  id: string;
  label: string;
  submitLabel: string;
  required: boolean;
  min?: number;
  max?: number;
  busy: boolean;
  onSubmit: (value: string) => void;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="form form--inset"
      noValidate
      data-form={id}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if ((required || v.length > 0) && (v.length < Math.max(min, 1) || v.length > max)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        onSubmit(v);
      }}
    >
      <div className={`field${invalid ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor={`${id}-text`}>
          {label}
          {required ? <span className="field__required"> ({t("common.form.required")})</span> : null}
        </label>
        <textarea
          id={`${id}-text`}
          rows={2}
          maxLength={max}
          value={value}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => setValue(e.target.value)}
        />
        {invalid ? (
          <span id={`${id}-error`} className="field__error">
            {t("reportsP5.textLength", { min, max })}
          </span>
        ) : null}
      </div>
      <div className="form__actions">
        <button type="submit" className={`button ${danger ? "button--danger" : "button--primary"}`} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/** The note on every FE-E screen that writes: issuing, submitting or exporting approves nothing. */
export function NotAnApprovalNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="not-an-approval">
      <Icon name="info" /> {t("reportsP5.notAnApproval")}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ entry pages

/**
 * The entry of a navigation sub-entry whose screen belongs to one transformation (reports, presentation, owner
 * updates, the evidence register): the transformations the caller can see, each opening the screen.
 */
export function TransformationEntry({
  screen,
  title,
  summary,
  area,
  to,
}: {
  screen: string;
  title: string;
  summary: string;
  area: { label: string; to: string };
  to: (tid: string) => string;
}) {
  const { t } = useTranslation();
  usePageTitle(title);
  const list = useTransformations({ sort: "updatedAt:desc", limit: 50 });
  const crumbs: Crumb[] = [{ label: area.label, to: area.to }, { label: title }];
  return (
    <div className="page" data-p5-screen={`${screen}-entry`}>
      <PageHeader title={title} subtitle={summary} crumbs={crumbs} />
      <section className="card" aria-labelledby={`${screen}-entry`}>
        <h2 id={`${screen}-entry`} className="card__title">
          {t("reportsP5.chooseTransformation")}
        </h2>
        <QueryState
          query={list}
          isEmpty={(page) => page.items.length === 0}
          empty={<EmptyState title={t("transformations.emptyTitle")} body={t("transformations.emptyBody")} />}
        >
          {(page) => (
            <ul className="plain-list entry-list">
              {page.items.map((tr) => (
                <li key={tr.id}>
                  <Link className="link" to={to(tr.id)}>
                    <bdi dir="ltr" className="code">
                      {tr.code}
                    </bdi>{" "}
                    {tr.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
      </section>
    </div>
  );
}

/** "Not stated" for a missing source or observation date (ADR-0045 §8: never blank). */
export function NotStated() {
  const { t } = useTranslation();
  return (
    <span className="muted" data-not-stated="true">
      {t("reportsP5.notStated")}
    </span>
  );
}
