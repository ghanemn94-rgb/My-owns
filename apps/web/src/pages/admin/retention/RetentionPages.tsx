// Administration > Retention (T-DG7-FE-C2; p7-work-split §E.6; ADR-0066 §6, ADR-0067; REQ-S16-024, REQ-S20-022).
// Every screen reads the real API through the P7 client (api/p7.ts); nothing here is a browser-side store.
//  - Retention (retention.read; ADM_TECH, ADM_ACCESS, AUD): every record class with its category, action, period and
//    IT approval reference text; the runs and dry runs, newest first; "Dry run" and "Run now" with a reason for holders
//    of retention.run (ADM_TECH), each with an Idempotency-Key kept for retries of the same submission. A queued or
//    running run is polled until it ends.
//  - Retention class (retention.read): its tables (age column, purge eligibility) and, for holders of
//    retention.configure (ADM_TECH) on an operational class not managed by an expiry job, the change form: action,
//    period in days and the IT approval reference, with a reason, sent with If-Match from the class's version. A 409
//    shows the conflict panel (nothing was saved; re-apply on the latest version or discard); a 422 shows the E.5 text.
//  - Retention run (retention.read): its status, counts, archive set and its per-record action log (cursor paged).
//  - Archived records (retention.read): the markers, filtered by table and run (URL parameters).
//  - Backup sets (backup.read; ADM_TECH, AUD): READ-ONLY. Backups and restores are run by IT with the scripts; no
//    control here starts one.
// The server decides every right (a 403 shows the no-permission state); the `useCan` checks only hide controls.
// A NULL period is "Not set (IT to agree)", never 0 or a default; a NULL count, checksum or size is "Unknown", never 0
// and never green. The reference field is labelled as a reference, never as an approval: nothing here grants a
// business, Finance or IT approval.
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { ApiError, newIdempotencyKey } from "../../../api/client.ts";
import {
  p7Keys,
  p7Paths,
  useBackupSets,
  useP7AdminRefresh,
  useRetentionArchivedRecords,
  useRetentionClass,
  useRetentionClasses,
  useRetentionRun,
  useRetentionRunActions,
  useRetentionRuns,
  type P7Page,
  type P7Query,
  type RetentionAction,
  type RetentionCategory,
} from "../../../api/p7.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { ConflictPanel, QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { Chip, useRunner } from "../../automation/ui.tsx";
import { Count, Mono, Row, type ChipTable, usePollWhile } from "../migration/ui.tsx";
import {
  adminCrumbs,
  CursorPagerControls,
  isValidReason,
  ReasonField,
  useCan,
  useCursorPager,
} from "../security/shared.tsx";

// ------------------------------------------------------------------------------------------------ contract shapes

export interface RetentionClassTable {
  tableName: string;
  ageColumn: string | null;
  purgeEligible: boolean;
}

export interface RetentionClass {
  id: string;
  code: string;
  category: RetentionCategory;
  labelEn: string;
  labelAr: string;
  descriptionEn: string;
  descriptionAr: string;
  managedByJob: string | null;
  action: RetentionAction;
  periodDays: number | null;
  itApprovalReference: string | null;
  tables: RetentionClassTable[];
  updatedAt: string;
  updatedBy: string | null;
  version: number;
}

export interface RetentionRun {
  id: string;
  mode: "dry_run" | "run";
  status: "queued" | "running" | "succeeded" | "failed";
  requestedVia: "api" | "schedule";
  asOf: string;
  candidateCount: number | null;
  archivedCount: number | null;
  purgedCount: number | null;
  skippedCount: number | null;
  archiveSetKey: string | null;
  archiveSetSha256: string | null;
  archiveSetBytes: string | null;
  failureReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  version: number;
}

export interface RetentionRunAction {
  id: string;
  retentionRunId: string;
  retentionClassCode: string;
  tableName: string;
  recordKey: Record<string, string>;
  action: "would_archive" | "would_purge" | "archived" | "purged" | "skipped_referenced";
  periodDays: number;
  recordAgeAt: string;
  occurredAt: string;
}

export interface RetentionArchivedRecord {
  tableName: string;
  recordKey: Record<string, string>;
  retentionClassCode: string;
  retentionRunId: string;
  archiveSetKey: string;
  recordAgeAt: string;
  archivedAt: string;
  purgedAt: string | null;
  purgeRunId: string | null;
}

export interface BackupSet {
  id: string;
  label: string;
  status: "succeeded" | "failed";
  manifestSchemaVersion: string;
  startedAt: string;
  finishedAt: string;
  migrationLevel: string | null;
  serverMajor: number | null;
  dumpFormat: string | null;
  dumpBytes: string | null;
  dumpSha256: string | null;
  evidenceBackend: string | null;
  evidenceObjectCount: number | null;
  evidenceBytes: string | null;
  attachmentManifestSha256: string | null;
  configBundleSha256: string | null;
  manifestSha256: string | null;
  failureReason: string | null;
  operatorName: string;
  recordedAt: string;
}

// ------------------------------------------------------------------------------------------------ paths and chips

export const RETENTION_PATH = "/admin/retention";
export const ARCHIVED_PATH = `${RETENTION_PATH}/archived`;
export const BACKUPS_PATH = `${RETENTION_PATH}/backups`;
export const classPath = (code: string) => `${RETENTION_PATH}/classes/${encodeURIComponent(code)}`;
export const runPath = (id: string) => `${RETENTION_PATH}/runs/${encodeURIComponent(id)}`;

/** `RetentionAction`: "Keep" is neutral; an enabled action is a warning, never "good" (blue never means favourable). */
export const ACTION_CHIPS: ChipTable = {
  retain: ["neutral", "lock"],
  archive: ["warn", "archive"],
  archive_then_purge: ["warn", "alert"],
};
/** `RetentionRun.status`: a queued or running run is neutral, never "good". */
export const RUN_STATUS_CHIPS: ChipTable = {
  queued: ["neutral", "clock"],
  running: ["neutral", "refresh"],
  succeeded: ["good", "check"],
  failed: ["bad", "cross"],
};
/** `RetentionRunAction.action`: a dry run's `would_*` actions are drafts (nothing changed). */
export const RUN_ACTION_CHIPS: ChipTable = {
  would_archive: ["draft", "archive"],
  would_purge: ["draft", "alert"],
  archived: ["neutral", "archive"],
  purged: ["neutral", "cross"],
  skipped_referenced: ["warn", "info"],
};
export const BACKUP_STATUS_CHIPS: ChipTable = { succeeded: ["good", "check"], failed: ["bad", "cross"] };
/** Business, audit and snapshot classes are always kept (D-243 Q3); only operational classes can leave "Keep". */
export const isConfigurable = (c: Pick<RetentionClass, "category" | "managedByJob">) =>
  c.category === "operational" && c.managedByJob === null;
export const isRunInProgress = (r: Pick<RetentionRun, "status">) => r.status === "queued" || r.status === "running";
/** The inbox table whose read items an archived marker makes read-only (§E.6 `effect.inbox`). */
const INBOX_TABLE = "inbox_notification";
const TABLE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The archived-records query from the URL: only the two contract filters, and only well-formed values. */
export function archivedQuery(search: URLSearchParams): P7Query {
  const q: Record<string, string> = {};
  const table = search.get("table") ?? "";
  const run = search.get("retentionRunId") ?? "";
  if (TABLE_NAME.test(table)) q["table"] = table;
  if (UUID.test(run)) q["retentionRunId"] = run.toLowerCase();
  return q;
}

/** The period field: "" is null (not set); otherwise a whole number 1-36500, or undefined when invalid. */
export function parsePeriod(text: string): number | null | undefined {
  const v = text.trim();
  if (v === "") return null;
  if (!/^[0-9]{1,5}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 && n <= 36500 ? n : undefined;
}

/** The reference field: "" is null; otherwise 3-500 characters after trimming, or undefined when invalid. */
export function parseReference(text: string): string | null | undefined {
  const v = text.trim();
  if (v === "") return null;
  return v.length >= 3 && v.length <= 500 ? v : undefined;
}

// ------------------------------------------------------------------------------------------------ small parts

function useFmt() {
  const locale = useLocale();
  return { locale, dt: (v: string | null | undefined) => (v ? formatDateTime(v, locale) : null) };
}

function UnknownValue() {
  const { t } = useTranslation();
  return <Chip tone="neutral" icon="question" label={t("retention.common.unknown")} data="unknown" />;
}

function RChip({ value, table, labelKey }: { value: string | null | undefined; table: ChipTable; labelKey: string }) {
  const { t } = useTranslation();
  const entry = value ? table[value] : undefined;
  if (!value || !entry) return <UnknownValue />;
  return <Chip tone={entry[0]} icon={entry[1]} label={t(`${labelKey}.${value}`)} data={value} wrap />;
}

/** A period in days, or "Not set (IT to agree)": never 0 and never a default number. */
export function Period({ days }: { days: number | null | undefined }) {
  const { t } = useTranslation();
  if (days === null || days === undefined)
    return <Chip tone="neutral" icon="question" label={t("retention.period.notSet")} data="period-not-set" wrap />;
  return <span data-period={days}>{t("retention.period.days", { count: days })}</span>;
}

function When({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  const { dt } = useFmt();
  return <>{dt(value) ?? t("retention.common.notYet")}</>;
}

/** A record key: the primary key columns and their text values only (never row content), left to right. */
function RecordKey({ value }: { value: Record<string, string> }) {
  const text = Object.entries(value)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return <Mono>{text}</Mono>;
}

function classLabel(c: Pick<RetentionClass, "labelEn" | "labelAr">, locale: string) {
  return locale === "ar" ? c.labelAr : c.labelEn;
}

/** The links between the Retention pages (a labelled navigation, keyboard reachable). */
function RetentionLinks() {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("retention.nav.sectionsLabel")} className="form__actions" data-retention-links>
      <Link className="link" to={RETENTION_PATH}>
        {t("retention.title")}
      </Link>
      <Link className="link" to={ARCHIVED_PATH}>
        {t("retention.nav.archived")}
      </Link>
      <Link className="link" to={BACKUPS_PATH}>
        {t("retention.nav.backups")}
      </Link>
    </nav>
  );
}

function retentionCrumbs(t: (k: string) => string, label: string) {
  return adminCrumbs(t, { label: t("retention.title"), to: RETENTION_PATH }, { label });
}

// ------------------------------------------------------------------------------------------------ Retention

function RequestRunForm({ onDone }: { onDone: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [requested, setRequested] = useState<RetentionRun | null>(null);
  // One key per submission and mode: a retry of the same submission reuses it, a new request gets a new one.
  const [keys, setKeys] = useState(() => ({ dry_run: newIdempotencyKey(), run: newIdempotencyKey() }));
  const runner = useRunner(onDone);
  const submit = (mode: "dry_run" | "run") => {
    setRequested(null);
    if (!isValidReason(reason)) {
      setInvalid(true);
      document.getElementById("retention-run-reason")?.focus();
      return;
    }
    setInvalid(false);
    void runner
      .run<RetentionRun>(mode === "dry_run" ? p7Paths.retentionDryRuns : p7Paths.retentionRuns, {
        method: "POST",
        body: { reason },
        idempotencyKey: keys[mode],
      })
      .then((created) => {
        if (!created) return;
        setReason("");
        setKeys((k) => ({ ...k, [mode]: newIdempotencyKey() }));
        setRequested(created);
      });
  };
  return (
    <form
      className="form"
      noValidate
      data-form="request-retention-run"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit("dry_run");
      }}
    >
      <p className="field__hint">{t("retention.run.dryRunHelp")}</p>
      <p className="field__hint">{t("retention.run.runHelp")}</p>
      {runner.alert}
      {requested ? (
        <p className="banner banner--info" role="status" data-state="run-requested">
          <Icon name="info" /> {t("retention.run.requested")}{" "}
          <Link className="link" to={runPath(requested.id)}>
            {t("retention.run.open")}
          </Link>
        </p>
      ) : null}
      <ReasonField
        id="retention-run-reason"
        value={reason}
        onChange={(v) => {
          setReason(v);
          setRequested(null);
        }}
        invalid={invalid}
        label={t("retention.run.reason")}
      />
      <div className="form__actions">
        <button type="submit" className="button button--secondary" disabled={runner.busy} data-action="dry-run">
          {t("retention.run.dryRun")}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={runner.busy}
          data-action="run-now"
          onClick={() => submit("run")}
        >
          {t("retention.run.run")}
        </button>
      </div>
    </form>
  );
}

function useRunColumns(): RegisterColumn<RetentionRun>[] {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  return [
    {
      id: "created",
      header: t("retention.run.createdAt"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link className="link" to={runPath(r.id)}>
          {dt(r.createdAt) ?? r.id}
        </Link>
      ),
      sortValue: (r) => r.createdAt,
    },
    {
      id: "mode",
      header: t("retention.run.mode.label"),
      cell: (r) => t(`retention.run.mode.${r.mode}`),
      sortValue: (r) => r.mode,
    },
    {
      id: "status",
      header: t("retention.run.status.label"),
      cell: (r) => <RChip value={r.status} table={RUN_STATUS_CHIPS} labelKey="retention.run.status" />,
      sortValue: (r) => r.status,
    },
    {
      id: "candidates",
      header: t("retention.run.candidates"),
      cell: (r) => <Count value={r.candidateCount} locale={locale} />,
    },
    {
      id: "archived",
      header: t("retention.run.archived"),
      cell: (r) => <Count value={r.archivedCount} locale={locale} />,
    },
    { id: "purged", header: t("retention.run.purged"), cell: (r) => <Count value={r.purgedCount} locale={locale} /> },
    {
      id: "skipped",
      header: t("retention.run.skipped"),
      cell: (r) => <Count value={r.skippedCount} locale={locale} />,
    },
    {
      id: "finished",
      header: t("retention.run.finishedAt"),
      cell: (r) => <When value={r.finishedAt} />,
      sortValue: (r) => r.finishedAt ?? "",
    },
  ];
}

export function RetentionPage() {
  const { t } = useTranslation();
  const { locale } = useFmt();
  const title = t("retention.title");
  usePageTitle(title);
  const canRun = useCan("retention.run");
  const classes = useRetentionClasses<RetentionClass>();
  const pager = useCursorPager();
  const runs = useRetentionRuns<RetentionRun>(pager.cursor);
  const refresh = useP7AdminRefresh("retention");
  usePollWhile((runs.data?.items ?? []).some(isRunInProgress), [p7Keys.retentionRuns]);
  const runColumns = useRunColumns();
  const classColumns: RegisterColumn<RetentionClass>[] = [
    {
      id: "class",
      header: t("retention.classes.class"),
      rowHeader: true,
      hideable: false,
      cell: (c) => (
        <Link className="link" to={classPath(c.code)}>
          {classLabel(c, locale)}
        </Link>
      ),
      sortValue: (c) => classLabel(c, locale),
    },
    { id: "code", header: t("retention.classes.code"), cell: (c) => <Mono>{c.code}</Mono>, sortValue: (c) => c.code },
    {
      id: "category",
      header: t("retention.classes.category.label"),
      cell: (c) => t(`retention.classes.category.${c.category}`),
      sortValue: (c) => c.category,
    },
    {
      id: "action",
      header: t("retention.action.label"),
      cell: (c) => (
        <span className="block">
          <RChip value={c.action} table={ACTION_CHIPS} labelKey="retention.action" />
          {c.managedByJob ? <span className="small muted block">{t("retention.managedByJob")}</span> : null}
          {!isConfigurable(c) && !c.managedByJob ? (
            <span className="small muted block">{t("retention.classes.alwaysKept")}</span>
          ) : null}
        </span>
      ),
      sortValue: (c) => c.action,
    },
    {
      id: "period",
      header: t("retention.period.label"),
      cell: (c) => <Period days={c.periodDays} />,
      sortValue: (c) => c.periodDays,
    },
    {
      id: "reference",
      header: t("retention.reference.label"),
      cell: (c) => (c.itApprovalReference ? <bdi>{c.itApprovalReference}</bdi> : t("retention.reference.none")),
      sortValue: (c) => c.itApprovalReference,
    },
    {
      id: "tables",
      header: t("retention.classes.tableCount"),
      cell: (c) => <Count value={c.tables.length} locale={locale} />,
      sortValue: (c) => c.tables.length,
    },
  ];
  return (
    <div className="page" data-p7-screen="retention">
      <PageHeader title={title} subtitle={t("retention.intro")} crumbs={adminCrumbs(t, { label: title })} />
      <RetentionLinks />
      <Section id="retention-classes" title={t("retention.classes.title")}>
        <QueryState query={classes}>
          {(items: RetentionClass[]) => (
            <RegisterTable
              id="p7-retention-classes"
              caption={t("retention.classes.title")}
              rows={items}
              columns={classColumns}
              getRowId={(c) => c.code}
              emptyTitle={t("retention.classes.empty")}
              pageSize={25}
            />
          )}
        </QueryState>
      </Section>
      {canRun ? (
        <Section id="retention-request-run" title={t("retention.run.requestTitle")}>
          <RequestRunForm onDone={refresh} />
        </Section>
      ) : null}
      <Section id="retention-runs" title={t("retention.run.listTitle")}>
        <QueryState query={runs}>
          {(page: P7Page<RetentionRun>) => (
            <>
              <RegisterTable
                id="p7-retention-runs"
                caption={t("retention.run.listTitle")}
                rows={page.items}
                columns={runColumns}
                getRowId={(r) => r.id}
                emptyTitle={t("retention.run.empty")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={runs.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Retention class

interface ClassFormValues {
  action: RetentionAction;
  period: string;
  reference: string;
}

const valuesOf = (c: RetentionClass): ClassFormValues => ({
  action: c.action,
  period: c.periodDays === null ? "" : String(c.periodDays),
  reference: c.itApprovalReference ?? "",
});

function ClassEditForm({ c, onSaved }: { c: RetentionClass; onSaved: () => void }) {
  const { t } = useTranslation();
  const refresh = useP7AdminRefresh("retention");
  const runner = useRunner(refresh);
  const [values, setValues] = useState<ClassFormValues>(() => valuesOf(c));
  // The version this form was opened on: If-Match sends it, so a change saved meanwhile is a 409 (nothing saved).
  const [base, setBase] = useState(c.version);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState({ period: false, reference: false, reason: false });
  const conflict = runner.error instanceof ApiError && runner.error.status === 409;

  const send = (ifMatch: number) => {
    const periodDays = parsePeriod(values.period);
    const itApprovalReference = parseReference(values.reference);
    const next = {
      period: periodDays === undefined,
      reference: itApprovalReference === undefined,
      reason: !isValidReason(reason),
    };
    setInvalid(next);
    if (next.period || next.reference || next.reason) {
      const first = next.period
        ? "retention-period"
        : next.reference
          ? "retention-reference"
          : "retention-class-reason";
      document.getElementById(first)?.focus();
      return;
    }
    void runner
      .run<RetentionClass>(p7Paths.retentionClass(c.code), {
        method: "PUT",
        ifMatch,
        body: { action: values.action, periodDays, itApprovalReference, reason },
      })
      .then((saved) => {
        if (!saved) return;
        setValues(valuesOf(saved));
        setBase(saved.version);
        setReason("");
        onSaved();
      });
  };

  const show = (v: ClassFormValues) => ({
    action: t(`retention.action.${v.action}`),
    period:
      v.period.trim() === "" ? t("retention.period.notSet") : t("retention.period.days", { count: Number(v.period) }),
    reference: v.reference.trim() === "" ? t("retention.reference.none") : v.reference.trim(),
  });

  return (
    <form
      className="form"
      noValidate
      data-form="update-retention-class"
      data-base-version={base}
      onSubmit={(e) => {
        e.preventDefault();
        send(base);
      }}
    >
      <p className="small muted" data-state="not-approval">
        {t("retention.class.notApproval")}
      </p>
      {conflict ? (
        <ConflictPanel
          yourVersion={base}
          currentVersion={c.version}
          rows={(["action", "period", "reference"] as const).map((field) => ({
            field,
            label:
              field === "action"
                ? t("retention.action.label")
                : field === "period"
                  ? t("retention.period.label")
                  : t("retention.reference.label"),
            mine: show(values)[field],
            current: show(valuesOf(c))[field],
          }))}
          busy={runner.busy}
          onReapply={() => {
            setBase(c.version);
            send(c.version);
          }}
          onDiscard={() => {
            runner.clear();
            setValues(valuesOf(c));
            setBase(c.version);
          }}
        />
      ) : (
        runner.alert
      )}
      <div className="field">
        <label className="field__label" htmlFor="retention-action">
          {t("retention.action.label")}
        </label>
        <select
          id="retention-action"
          value={values.action}
          onChange={(e) => setValues((v) => ({ ...v, action: e.target.value as RetentionAction }))}
        >
          {(["retain", "archive", "archive_then_purge"] as const).map((a) => (
            <option key={a} value={a}>
              {t(`retention.action.${a}`)}
            </option>
          ))}
        </select>
      </div>
      <div className={`field${invalid.period ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="retention-period">
          {t("retention.class.periodInput")}
        </label>
        <p id="retention-period-hint" className="field__hint">
          {t("retention.class.periodHint")}
        </p>
        <input
          id="retention-period"
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={values.period}
          aria-invalid={invalid.period || undefined}
          aria-describedby={invalid.period ? "retention-period-hint retention-period-error" : "retention-period-hint"}
          onChange={(e) => setValues((v) => ({ ...v, period: e.target.value }))}
        />
        {invalid.period ? (
          <p id="retention-period-error" className="field__error">
            <Icon name="alert" /> {t("retention.class.periodInvalid")}
          </p>
        ) : null}
      </div>
      <div className={`field${invalid.reference ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="retention-reference">
          {t("retention.reference.label")}
        </label>
        <p id="retention-reference-hint" className="field__hint">
          {t("retention.reference.help")}
        </p>
        <input
          id="retention-reference"
          type="text"
          maxLength={500}
          value={values.reference}
          aria-invalid={invalid.reference || undefined}
          aria-describedby={
            invalid.reference ? "retention-reference-hint retention-reference-error" : "retention-reference-hint"
          }
          onChange={(e) => setValues((v) => ({ ...v, reference: e.target.value }))}
        />
        {invalid.reference ? (
          <p id="retention-reference-error" className="field__error">
            <Icon name="alert" /> {t("retention.class.referenceInvalid")}
          </p>
        ) : null}
      </div>
      <ReasonField
        id="retention-class-reason"
        value={reason}
        onChange={setReason}
        invalid={invalid.reason}
        label={t("retention.class.reason")}
      />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy} data-action="save-class">
          {t("retention.class.save")}
        </button>
      </div>
    </form>
  );
}

export function RetentionClassPage() {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  const { retentionClassCode } = useParams();
  const title = t("nav.p7.retentionClass.title");
  usePageTitle(title);
  const canConfigure = useCan("retention.configure");
  const query = useRetentionClass<RetentionClass>(retentionClassCode);
  const [saved, setSaved] = useState(false);
  const tableColumns: RegisterColumn<RetentionClassTable>[] = [
    {
      id: "table",
      header: t("retention.class.table"),
      rowHeader: true,
      hideable: false,
      cell: (r) => <Mono>{r.tableName}</Mono>,
      sortValue: (r) => r.tableName,
    },
    {
      id: "age",
      header: t("retention.class.ageColumn"),
      cell: (r) => (r.ageColumn ? <Mono>{r.ageColumn}</Mono> : t("retention.class.ageColumnNone")),
      sortValue: (r) => r.ageColumn,
    },
    {
      id: "purge",
      header: t("retention.class.purgeEligible"),
      cell: (r) => (r.purgeEligible ? t("retention.class.yes") : t("retention.class.no")),
      sortValue: (r) => (r.purgeEligible ? 1 : 0),
    },
  ];
  return (
    <div className="page" data-p7-screen="retention-class">
      <PageHeader title={title} subtitle={t("nav.p7.retentionClass.summary")} crumbs={retentionCrumbs(t, title)} />
      <RetentionLinks />
      <QueryState query={query}>
        {(c) => (
          <>
            <section className="card" aria-labelledby="class-facts" data-class={c.code} data-class-action={c.action}>
              <h2 id="class-facts" className="card__title">
                {classLabel(c, locale)}
              </h2>
              <p>{locale === "ar" ? c.descriptionAr : c.descriptionEn}</p>
              {saved ? (
                <p className="banner banner--info" role="status" data-state="saved">
                  <Icon name="check" /> {t("retention.class.saved")}
                </p>
              ) : null}
              <dl className="workspace-header__grid">
                <Row label={t("retention.classes.code")}>
                  <Mono>{c.code}</Mono>
                </Row>
                <Row label={t("retention.classes.category.label")}>{t(`retention.classes.category.${c.category}`)}</Row>
                <Row label={t("retention.action.label")}>
                  <RChip value={c.action} table={ACTION_CHIPS} labelKey="retention.action" />
                </Row>
                <Row label={t("retention.period.label")}>
                  <Period days={c.periodDays} />
                </Row>
                <Row label={t("retention.reference.label")}>
                  {c.itApprovalReference ? <bdi>{c.itApprovalReference}</bdi> : t("retention.reference.none")}
                </Row>
                <Row label={t("retention.class.updatedAt")}>{dt(c.updatedAt) ?? <UnknownValue />}</Row>
                <Row label={t("retention.class.version")}>
                  <Mono>{String(c.version)}</Mono>
                </Row>
              </dl>
              {c.managedByJob ? (
                <p className="small" data-state="managed-by-job">
                  <Icon name="clock" /> {t("retention.managedByJob")} (<Mono>{c.managedByJob}</Mono>)
                </p>
              ) : null}
              {c.tables.some((tb) => tb.tableName === INBOX_TABLE) ? (
                <p className="banner banner--info" role="note" data-state="inbox-effect">
                  <Icon name="info" /> {t("retention.effect.inbox")}
                </p>
              ) : null}
            </section>
            <Section id="class-edit" title={t("retention.class.editTitle")}>
              {!isConfigurable(c) ? (
                <p className="banner banner--info" role="note" data-state="always-kept">
                  <Icon name="lock" /> {c.managedByJob ? t("retention.managedByJob") : t("retention.class.fixed")}
                </p>
              ) : canConfigure ? (
                <ClassEditForm c={c} onSaved={() => setSaved(true)} />
              ) : (
                <p className="banner banner--info" role="note" data-state="read-only">
                  <Icon name="info" /> {t("retention.class.readOnly")}
                </p>
              )}
            </Section>
            <Section id="class-tables" title={t("retention.class.tablesTitle")}>
              <RegisterTable
                id="p7-retention-class-tables"
                caption={t("retention.class.tablesTitle")}
                rows={c.tables}
                columns={tableColumns}
                getRowId={(r) => r.tableName}
                emptyTitle={t("retention.classes.empty")}
                pageSize={25}
              />
            </Section>
          </>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Retention run

function RunActions({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const { dt } = useFmt();
  const pager = useCursorPager();
  const actions = useRetentionRunActions<RetentionRunAction>(runId, pager.cursor);
  const columns: RegisterColumn<RetentionRunAction>[] = [
    {
      id: "table",
      header: t("retention.actions.table"),
      rowHeader: true,
      hideable: false,
      cell: (a) => <Mono>{a.tableName}</Mono>,
      sortValue: (a) => a.tableName,
    },
    { id: "record", header: t("retention.actions.record"), cell: (a) => <RecordKey value={a.recordKey} /> },
    {
      id: "action",
      header: t("retention.actions.kind.label"),
      cell: (a) => <RChip value={a.action} table={RUN_ACTION_CHIPS} labelKey="retention.actions.kind" />,
      sortValue: (a) => a.action,
    },
    {
      id: "class",
      header: t("retention.actions.class"),
      cell: (a) => <Mono>{a.retentionClassCode}</Mono>,
      sortValue: (a) => a.retentionClassCode,
    },
    { id: "period", header: t("retention.actions.period"), cell: (a) => <Period days={a.periodDays} /> },
    {
      id: "age",
      header: t("retention.actions.recordAge"),
      cell: (a) => dt(a.recordAgeAt) ?? <UnknownValue />,
      sortValue: (a) => a.recordAgeAt,
    },
    {
      id: "occurred",
      header: t("retention.actions.occurredAt"),
      cell: (a) => dt(a.occurredAt) ?? <UnknownValue />,
      sortValue: (a) => a.occurredAt,
    },
  ];
  return (
    <QueryState query={actions}>
      {(page: P7Page<RetentionRunAction>) => (
        <>
          <RegisterTable
            id="p7-retention-run-actions"
            caption={t("retention.actions.title")}
            rows={page.items}
            columns={columns}
            getRowId={(a) => a.id}
            emptyTitle={t("retention.actions.empty")}
            pageSize={50}
          />
          <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={actions.isFetching} />
        </>
      )}
    </QueryState>
  );
}

export function RetentionRunPage() {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  const { retentionRunId } = useParams();
  const title = t("nav.p7.retentionRun.title");
  usePageTitle(title);
  const query = useRetentionRun<RetentionRun>(retentionRunId);
  usePollWhile(query.data ? isRunInProgress(query.data) : false, [
    p7Keys.retentionRun(retentionRunId ?? ""),
    p7Keys.retentionRunActions(retentionRunId ?? ""),
  ]);
  return (
    <div className="page" data-p7-screen="retention-run">
      <PageHeader title={title} subtitle={t("nav.p7.retentionRun.summary")} crumbs={retentionCrumbs(t, title)} />
      <RetentionLinks />
      <QueryState query={query}>
        {(r) => (
          <>
            <section className="card" aria-labelledby="run-facts" data-run={r.id} data-run-status={r.status}>
              <h2 id="run-facts" className="card__title">
                {t(`retention.run.mode.${r.mode}`)}{" "}
                <RChip value={r.status} table={RUN_STATUS_CHIPS} labelKey="retention.run.status" />
              </h2>
              {r.status === "failed" ? (
                <p className="banner banner--error" role="note">
                  <Icon name="alert" /> {t("retention.run.failureReason")}:{" "}
                  {r.failureReason ?? t("retention.common.unknown")}
                </p>
              ) : null}
              {r.status !== "succeeded" ? <p className="small muted">{t("retention.run.unknownUntilDone")}</p> : null}
              {r.mode === "dry_run" ? <p className="small">{t("retention.run.dryRunHelp")}</p> : null}
              <dl className="workspace-header__grid">
                <Row label={t("retention.run.requestedVia.label")}>
                  {t(`retention.run.requestedVia.${r.requestedVia}`)}
                </Row>
                <Row label={t("retention.run.asOf")}>{dt(r.asOf) ?? <UnknownValue />}</Row>
                <Row label={t("retention.run.candidates")}>
                  <Count value={r.candidateCount} locale={locale} />
                </Row>
                <Row label={t("retention.run.archived")}>
                  <Count value={r.archivedCount} locale={locale} />
                </Row>
                <Row label={t("retention.run.purged")}>
                  <Count value={r.purgedCount} locale={locale} />
                </Row>
                <Row label={t("retention.run.skipped")}>
                  <Count value={r.skippedCount} locale={locale} />
                </Row>
                <Row label={t("retention.run.archiveSetKey")}>
                  {r.mode === "dry_run" ? t("retention.run.noArchiveSet") : <Mono>{r.archiveSetKey}</Mono>}
                </Row>
                {r.mode === "run" ? (
                  <>
                    <Row label={t("retention.run.archiveSetSha256")}>
                      <Mono>{r.archiveSetSha256}</Mono>
                    </Row>
                    <Row label={t("retention.run.archiveSetBytes")}>
                      <Count value={r.archiveSetBytes} locale={locale} />
                    </Row>
                  </>
                ) : null}
                <Row label={t("retention.run.createdAt")}>{dt(r.createdAt) ?? <UnknownValue />}</Row>
                <Row label={t("retention.run.startedAt")}>
                  <When value={r.startedAt} />
                </Row>
                <Row label={t("retention.run.finishedAt")}>
                  <When value={r.finishedAt} />
                </Row>
              </dl>
              {r.mode === "run" ? (
                <p>
                  <Link className="link" to={`${ARCHIVED_PATH}?retentionRunId=${encodeURIComponent(r.id)}`}>
                    {t("retention.archived.forRun")}
                  </Link>
                </p>
              ) : null}
            </section>
            <Section id="run-actions" title={t("retention.actions.title")}>
              <RunActions runId={r.id} />
            </Section>
          </>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Archived records

export function RetentionArchivedPage() {
  const { t } = useTranslation();
  const { dt } = useFmt();
  const title = t("retention.archived.title");
  usePageTitle(title);
  const [search, setSearch] = useSearchParams();
  const query = archivedQuery(search);
  const [table, setTable] = useState(query["table"] ?? "");
  const [run, setRun] = useState(query["retentionRunId"] ?? "");
  const [invalid, setInvalid] = useState({ table: false, run: false });
  const pager = useCursorPager();
  const records = useRetentionArchivedRecords<RetentionArchivedRecord>(query, pager.cursor);
  const columns: RegisterColumn<RetentionArchivedRecord>[] = [
    {
      id: "table",
      header: t("retention.archived.table"),
      rowHeader: true,
      hideable: false,
      cell: (a) => <Mono>{a.tableName}</Mono>,
      sortValue: (a) => a.tableName,
    },
    { id: "record", header: t("retention.archived.record"), cell: (a) => <RecordKey value={a.recordKey} /> },
    {
      id: "live",
      header: t("retention.archived.liveRow"),
      cell: (a) =>
        a.purgedAt === null ? (
          <Chip tone="neutral" icon="lock" label={t("retention.archived.kept")} data="kept" wrap />
        ) : (
          <Chip
            tone="neutral"
            icon="cross"
            label={t("retention.archived.purgedOn", { date: dt(a.purgedAt) ?? t("retention.common.unknown") })}
            data="purged"
            wrap
          />
        ),
      sortValue: (a) => a.purgedAt ?? "",
    },
    {
      id: "class",
      header: t("retention.archived.class"),
      cell: (a) => <Mono>{a.retentionClassCode}</Mono>,
      sortValue: (a) => a.retentionClassCode,
    },
    {
      id: "run",
      header: t("retention.archived.run"),
      cell: (a) => (
        <Link className="link" to={runPath(a.retentionRunId)}>
          <Mono>{a.retentionRunId}</Mono>
        </Link>
      ),
    },
    { id: "set", header: t("retention.archived.archiveSet"), cell: (a) => <Mono>{a.archiveSetKey}</Mono> },
    {
      id: "age",
      header: t("retention.archived.recordAge"),
      cell: (a) => dt(a.recordAgeAt) ?? <UnknownValue />,
      sortValue: (a) => a.recordAgeAt,
    },
    {
      id: "archivedAt",
      header: t("retention.archived.archivedAt"),
      cell: (a) => dt(a.archivedAt) ?? <UnknownValue />,
      sortValue: (a) => a.archivedAt,
    },
  ];
  return (
    <div className="page" data-p7-screen="retention-archived">
      <PageHeader title={title} subtitle={t("retention.archived.intro")} crumbs={retentionCrumbs(t, title)} />
      <RetentionLinks />
      <Section id="archived-filters" title={t("retention.archived.filters")}>
        <form
          className="form"
          noValidate
          role="search"
          aria-label={t("retention.archived.filters")}
          data-form="archived-filters"
          onSubmit={(e) => {
            e.preventDefault();
            const tv = table.trim();
            const rv = run.trim();
            const next = { table: tv !== "" && !TABLE_NAME.test(tv), run: rv !== "" && !UUID.test(rv) };
            setInvalid(next);
            if (next.table || next.run) {
              document.getElementById(next.table ? "archived-table" : "archived-run")?.focus();
              return;
            }
            const params = new URLSearchParams();
            if (tv) params.set("table", tv);
            if (rv) params.set("retentionRunId", rv.toLowerCase());
            pager.reset();
            setSearch(params);
          }}
        >
          <div className={`field${invalid.table ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="archived-table">
              {t("retention.archived.filterTable")}
            </label>
            <p id="archived-table-hint" className="field__hint">
              {t("retention.archived.filterTableHint")}
            </p>
            <input
              id="archived-table"
              type="text"
              dir="ltr"
              value={table}
              aria-invalid={invalid.table || undefined}
              aria-describedby={invalid.table ? "archived-table-hint archived-table-error" : "archived-table-hint"}
              onChange={(e) => setTable(e.target.value)}
            />
            {invalid.table ? (
              <p id="archived-table-error" className="field__error">
                <Icon name="alert" /> {t("retention.archived.filterTableInvalid")}
              </p>
            ) : null}
          </div>
          <div className={`field${invalid.run ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="archived-run">
              {t("retention.archived.filterRun")}
            </label>
            <input
              id="archived-run"
              type="text"
              dir="ltr"
              value={run}
              aria-invalid={invalid.run || undefined}
              onChange={(e) => setRun(e.target.value)}
            />
          </div>
          <div className="form__actions">
            <button type="submit" className="button button--secondary" data-action="apply-filters">
              {t("retention.archived.apply")}
            </button>
            <button
              type="button"
              className="button button--secondary"
              data-action="clear-filters"
              onClick={() => {
                setTable("");
                setRun("");
                setInvalid({ table: false, run: false });
                pager.reset();
                setSearch(new URLSearchParams());
              }}
            >
              {t("retention.archived.clear")}
            </button>
          </div>
        </form>
      </Section>
      <Section id="archived-records" title={title}>
        <QueryState query={records}>
          {(page: P7Page<RetentionArchivedRecord>) => (
            <>
              <RegisterTable
                id="p7-retention-archived"
                caption={title}
                rows={page.items}
                columns={columns}
                getRowId={(a) => `${a.tableName}:${JSON.stringify(a.recordKey)}`}
                emptyTitle={t("retention.archived.empty")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={records.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Backup sets

export function BackupSetsPage() {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  const title = t("retention.backups.title");
  usePageTitle(title);
  const pager = useCursorPager();
  const sets = useBackupSets<BackupSet>(pager.cursor);
  const columns: RegisterColumn<BackupSet>[] = [
    {
      id: "label",
      header: t("retention.backups.label"),
      rowHeader: true,
      hideable: false,
      cell: (b) => <Mono>{b.label}</Mono>,
      sortValue: (b) => b.label,
    },
    {
      id: "status",
      header: t("retention.backups.status.label"),
      cell: (b) => (
        <span className="block">
          <RChip value={b.status} table={BACKUP_STATUS_CHIPS} labelKey="retention.backups.status" />
          {b.status === "failed" ? (
            <span className="small block">
              {t("retention.backups.failureReason")}: {b.failureReason ?? t("retention.common.unknown")}
            </span>
          ) : null}
        </span>
      ),
      sortValue: (b) => b.status,
    },
    {
      id: "finished",
      header: t("retention.backups.finishedAt"),
      cell: (b) => dt(b.finishedAt) ?? <UnknownValue />,
      sortValue: (b) => b.finishedAt,
    },
    {
      id: "started",
      header: t("retention.backups.startedAt"),
      cell: (b) => dt(b.startedAt) ?? <UnknownValue />,
      sortValue: (b) => b.startedAt,
    },
    { id: "level", header: t("retention.backups.migrationLevel"), cell: (b) => <Mono>{b.migrationLevel}</Mono> },
    {
      id: "major",
      header: t("retention.backups.serverMajor"),
      cell: (b) => <Count value={b.serverMajor} locale={locale} />,
    },
    {
      id: "dumpBytes",
      header: t("retention.backups.dumpBytes"),
      cell: (b) => <Count value={b.dumpBytes} locale={locale} />,
    },
    {
      id: "evidenceObjects",
      header: t("retention.backups.evidenceObjects"),
      cell: (b) => <Count value={b.evidenceObjectCount} locale={locale} />,
    },
    {
      id: "evidenceBytes",
      header: t("retention.backups.evidenceBytes"),
      cell: (b) => <Count value={b.evidenceBytes} locale={locale} />,
    },
    {
      id: "evidenceBackend",
      header: t("retention.backups.evidenceBackend"),
      cell: (b) => <Mono>{b.evidenceBackend}</Mono>,
    },
    { id: "dumpSha", header: t("retention.backups.dumpSha256"), cell: (b) => <Mono>{b.dumpSha256}</Mono> },
    { id: "manifestSha", header: t("retention.backups.manifestSha256"), cell: (b) => <Mono>{b.manifestSha256}</Mono> },
    {
      id: "operator",
      header: t("retention.backups.operator"),
      cell: (b) => b.operatorName,
      sortValue: (b) => b.operatorName,
    },
    {
      id: "recorded",
      header: t("retention.backups.recordedAt"),
      cell: (b) => dt(b.recordedAt) ?? <UnknownValue />,
      sortValue: (b) => b.recordedAt,
    },
  ];
  return (
    <div className="page" data-p7-screen="backup-sets">
      <PageHeader title={title} subtitle={t("retention.backups.readOnly")} crumbs={retentionCrumbs(t, title)} />
      <RetentionLinks />
      <p className="banner banner--info" role="note" data-state="read-only">
        <Icon name="info" /> {t("retention.backups.readOnly")}
      </p>
      <Section id="backup-sets" title={title}>
        <QueryState query={sets}>
          {(page: P7Page<BackupSet>) => (
            <>
              <RegisterTable
                id="p7-backup-sets"
                caption={title}
                rows={page.items}
                columns={columns}
                getRowId={(b) => b.id}
                emptyTitle={t("retention.backups.none")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={sets.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}
