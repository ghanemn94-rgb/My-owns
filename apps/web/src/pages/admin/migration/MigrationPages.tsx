// Administration > Data export and Migration status (T-DG7-FE-B; p7-work-split §C.7/C.8; ADR-0064; REQ-S19-014,
// REQ-S19-016). Every screen reads the real API through the P7 client (api/p7.ts).
//  - Data export (migration.export, ADM_TECH): the exports list, "Request export" with a reason (createMigrationExport,
//    with an Idempotency-Key kept for retries of the same submission), each export's status, counts and checksums, and
//    the two manifest downloads once the export has succeeded. A queued or running export is polled until it ends.
//  - Migration status (migration_import.read, ADM_TECH, ADM_ACCESS, AUD): the imports into this installation, each
//    one's reconciliation reports (per-table counts and digests, every attachment difference) and the identity rebind
//    list. READ-ONLY: imports and rebinds are run by IT with the CLI tools (§C.11); no control here starts one.
//  - A `null` count, checksum or environment is "Unknown", never 0 or green; a demo source is labelled synthetic.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { newIdempotencyKey } from "../../../api/client.ts";
import {
  IDENTITY_REBIND_STATES,
  p7Keys,
  p7Paths,
  useIdentityRebinds,
  useMigrationExport,
  useMigrationExports,
  useMigrationImport,
  useMigrationImports,
  useMigrationReconciliation,
  useMigrationReconciliations,
  useP7AdminRefresh,
} from "../../../api/p7.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useRunner } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  CursorPagerControls,
  isValidReason,
  ReasonField,
  useCan,
  useCursorPager,
} from "../security/shared.tsx";
import {
  ATTACHMENT_PROBLEM_CHIPS,
  Count,
  ENVIRONMENT_CHIPS,
  JOB_STATUS_CHIPS,
  Mono,
  NotApprovalNote,
  REBIND_STATE_CHIPS,
  RECONCILIATION_CHIPS,
  Row,
  TransferChip,
  UnknownChip,
  usePollWhile,
  When,
} from "./ui.tsx";

// ------------------------------------------------------------------------------------------------ contract shapes

export interface MigrationExport {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  requestedVia: "api" | "cli";
  schemaVersion: string;
  sourceEnvironment: "production" | "demo" | "unmarked" | null;
  migrationLevel: string | null;
  tableCount: number | null;
  rowCount: string | null;
  attachmentCount: number | null;
  attachmentBytes: string | null;
  manifestSha256: string | null;
  attachmentManifestSha256: string | null;
  demoChecksum: string | null;
  failureReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  version: number;
}

export interface ReconciliationSummary {
  id: string;
  runKind: "import" | "recheck";
  result: "matched" | "mismatched";
  tablesChecked: number;
  tablesMismatched: number;
  rowsExpected: string;
  rowsActual: string;
  attachmentsChecked: number;
  attachmentsMismatched: number;
  operatorName: string;
  runAt: string;
}

export interface MigrationImport {
  id: string;
  schemaVersion: string;
  sourceEnvironment: "production" | "demo" | "unmarked";
  sourceExportReference: string;
  migrationLevel: string;
  manifestSha256: string;
  attachmentManifestSha256: string;
  demoChecksum: string | null;
  tableCount: number;
  rowCount: string;
  attachmentCount: number;
  attachmentBytes: string;
  operatorName: string;
  startedAt: string;
  importedAt: string;
  latestReconciliation: ReconciliationSummary;
  identities: { unbound: number; rebound: number; retained: number };
}

export interface MigrationReconciliation {
  summary: ReconciliationSummary;
  tables: {
    tableName: string;
    expectedRows: string;
    actualRows: string;
    expectedDigest: string;
    actualDigest: string;
    matched: boolean;
  }[];
  attachmentMismatches: {
    parentTable: string;
    objectName: string;
    problem: "missing" | "size_mismatch" | "sha256_mismatch";
    expectedSize: string;
    actualSize: string | null;
    expectedSha256: string;
    actualSha256: string | null;
  }[];
}

export interface IdentityRebind {
  id: string;
  userId: string;
  displayName: string;
  migrationImportId: string;
  state: "unbound" | "rebound" | "retained";
  issuer: string;
  subject: string;
  newIssuer: string | null;
  newSubject: string | null;
  operatorName: string | null;
  resolvedAt: string | null;
  version: number;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const EXPORTS_PATH = "/admin/migration/exports";
const IMPORTS_PATH = "/admin/migration/imports";
const exportPath = (id: string) => `${EXPORTS_PATH}/${encodeURIComponent(id)}`;
const importPath = (id: string) => `${IMPORTS_PATH}/${encodeURIComponent(id)}`;
const reconciliationPath = (importId: string, id: string) =>
  `${importPath(importId)}/reconciliations/${encodeURIComponent(id)}`;

/** True while the export can still change (the screen polls it). */
export const isInProgress = (e: Pick<MigrationExport, "status">) => e.status === "queued" || e.status === "running";

function useFmt() {
  const locale = useLocale();
  return { locale, dt: (v: string) => formatDateTime(v, locale) };
}

function ReadOnlyCliNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="read-only">
      <Icon name="info" /> {t("transfer.import.cliOnly")}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ Data export

function RequestExportForm({ onDone }: { onDone: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [requested, setRequested] = useState(false);
  // One key per submission: a retry of the same submission (network failure) reuses it, a new request gets a new one.
  const [key, setKey] = useState(newIdempotencyKey);
  const runner = useRunner(onDone);
  return (
    <form
      className="form"
      noValidate
      data-form="request-migration-export"
      onSubmit={(e) => {
        e.preventDefault();
        setRequested(false);
        if (!isValidReason(reason)) {
          setInvalid(true);
          document.getElementById("migration-export-reason")?.focus();
          return;
        }
        setInvalid(false);
        void runner
          .run<MigrationExport>(p7Paths.migrationExports, { method: "POST", body: { reason }, idempotencyKey: key })
          .then((created) => {
            if (!created) return;
            setReason("");
            setKey(newIdempotencyKey());
            setRequested(true);
          });
      }}
    >
      <p className="field__hint">{t("transfer.export.requestHint")}</p>
      {runner.alert}
      {requested ? (
        <p className="banner banner--info" role="status" data-state="export-requested">
          <Icon name="info" /> {t("transfer.export.requested")}
        </p>
      ) : null}
      <ReasonField
        id="migration-export-reason"
        value={reason}
        onChange={(v) => {
          setReason(v);
          setRequested(false);
        }}
        invalid={invalid}
        label={t("transfer.export.reason")}
      />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy} data-action="request-export">
          {t("transfer.export.request")}
        </button>
      </div>
    </form>
  );
}

export function DataExportPage() {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  const title = t("transfer.export.title");
  usePageTitle(title);
  const canExport = useCan("migration.export");
  const pager = useCursorPager();
  const exports = useMigrationExports<MigrationExport>(pager.cursor);
  const refresh = useP7AdminRefresh("migration-exports");
  usePollWhile((exports.data?.items ?? []).some(isInProgress), [p7Keys.migrationExports]);
  const columns: RegisterColumn<MigrationExport>[] = [
    {
      id: "created",
      header: t("transfer.common.createdAt"),
      rowHeader: true,
      hideable: false,
      cell: (e) => (
        <Link className="link" to={exportPath(e.id)}>
          {dt(e.createdAt) ?? e.id}
        </Link>
      ),
      sortValue: (e) => e.createdAt,
    },
    {
      id: "status",
      header: t("transfer.export.status.label"),
      cell: (e) => <TransferChip value={e.status} table={JOB_STATUS_CHIPS} labelKey="transfer.export.status" />,
      sortValue: (e) => e.status,
    },
    {
      id: "environment",
      header: t("transfer.export.environment.label"),
      cell: (e) => (
        <TransferChip value={e.sourceEnvironment} table={ENVIRONMENT_CHIPS} labelKey="transfer.export.environment" />
      ),
      sortValue: (e) => e.sourceEnvironment ?? "",
    },
    { id: "tables", header: t("transfer.export.tables"), cell: (e) => <Count value={e.tableCount} locale={locale} /> },
    { id: "rows", header: t("transfer.export.rows"), cell: (e) => <Count value={e.rowCount} locale={locale} /> },
    {
      id: "attachments",
      header: t("transfer.export.attachments"),
      cell: (e) => <Count value={e.attachmentCount} locale={locale} />,
    },
    {
      id: "finished",
      header: t("transfer.export.finishedAt"),
      cell: (e) => <When value={e.finishedAt} format={dt} />,
      sortValue: (e) => e.finishedAt ?? "",
    },
  ];
  return (
    <div className="page" data-p7-screen="data-export">
      <PageHeader title={title} subtitle={t("transfer.export.intro")} crumbs={adminCrumbs(t, { label: title })} />
      <NotApprovalNote />
      {canExport ? (
        <Section id="request-export" title={t("transfer.export.requestTitle")}>
          <RequestExportForm onDone={refresh} />
        </Section>
      ) : null}
      <Section id="migration-exports" title={t("transfer.export.listTitle")}>
        <QueryState query={exports}>
          {(page: Page<MigrationExport>) => (
            <>
              <RegisterTable
                id="p7-migration-exports"
                caption={t("transfer.export.listTitle")}
                rows={page.items}
                columns={columns}
                getRowId={(e) => e.id}
                emptyTitle={t("transfer.export.empty")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={exports.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
    </div>
  );
}

function ExportDownloads({ e }: { e: MigrationExport }) {
  const { t } = useTranslation();
  if (e.status === "failed")
    return (
      <p className="banner banner--error" role="note" data-state="downloads-failed">
        <Icon name="alert" /> {t("transfer.export.downloadsFailed")}
      </p>
    );
  if (e.status !== "succeeded")
    return (
      <p className="muted" data-state="downloads-not-ready">
        <Icon name="clock" /> {t("transfer.export.downloadsNotReady")}
      </p>
    );
  // Plain same-origin links: the browser saves the server's exact bytes (the manifest's checksum stays verifiable).
  return (
    <div className="form__actions" data-state="downloads-ready">
      <a
        className="button button--secondary"
        href={p7Paths.migrationExportManifest(e.id)}
        download={`migration-manifest-${e.id}.json`}
        data-action="download-manifest"
      >
        {t("transfer.export.downloadManifest")}
      </a>
      <a
        className="button button--secondary"
        href={p7Paths.migrationExportAttachmentManifest(e.id)}
        download={`attachment-manifest-${e.id}.json`}
        data-action="download-attachment-manifest"
      >
        {t("transfer.export.downloadAttachments")}
      </a>
    </div>
  );
}

export function MigrationExportPage() {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  const { migrationExportId } = useParams();
  const title = t("nav.p7.migrationExport.title");
  usePageTitle(title);
  const query = useMigrationExport<MigrationExport>(migrationExportId);
  usePollWhile(query.data ? isInProgress(query.data) : false, [p7Keys.migrationExport(migrationExportId ?? "")]);
  return (
    <div className="page" data-p7-screen="migration-export">
      <PageHeader
        title={title}
        subtitle={t("nav.p7.migrationExport.summary")}
        crumbs={adminCrumbs(t, { label: t("transfer.export.title"), to: EXPORTS_PATH }, { label: title })}
      />
      <QueryState query={query}>
        {(e) => (
          <>
            <section className="card" aria-labelledby="export-facts" data-export={e.id} data-export-status={e.status}>
              <h2 id="export-facts" className="card__title">
                <TransferChip value={e.status} table={JOB_STATUS_CHIPS} labelKey="transfer.export.status" />
              </h2>
              {e.status === "failed" ? (
                <p className="banner banner--error" role="note">
                  <Icon name="alert" /> {t("transfer.export.failureReason")}:{" "}
                  {e.failureReason ?? t("transfer.common.unknown")}
                </p>
              ) : null}
              {e.status !== "succeeded" ? <p className="small muted">{t("transfer.export.unknownUntilDone")}</p> : null}
              <dl className="workspace-header__grid">
                <Row label={t("transfer.export.environment.label")}>
                  <TransferChip
                    value={e.sourceEnvironment}
                    table={ENVIRONMENT_CHIPS}
                    labelKey="transfer.export.environment"
                  />
                </Row>
                <Row label={t("transfer.export.requestedVia.label")}>
                  {t(`transfer.export.requestedVia.${e.requestedVia}`)}
                </Row>
                <Row label={t("transfer.export.migrationLevel")}>
                  <Mono>{e.migrationLevel}</Mono>
                </Row>
                <Row label={t("transfer.export.tables")}>
                  <Count value={e.tableCount} locale={locale} />
                </Row>
                <Row label={t("transfer.export.rows")}>
                  <Count value={e.rowCount} locale={locale} />
                </Row>
                <Row label={t("transfer.export.attachments")}>
                  <Count value={e.attachmentCount} locale={locale} />
                </Row>
                <Row label={t("transfer.export.attachmentBytes")}>
                  <Count value={e.attachmentBytes} locale={locale} />
                </Row>
                <Row label={t("transfer.export.manifestSha256")}>
                  <Mono>{e.manifestSha256}</Mono>
                </Row>
                <Row label={t("transfer.export.attachmentManifestSha256")}>
                  <Mono>{e.attachmentManifestSha256}</Mono>
                </Row>
                {e.sourceEnvironment === "demo" || e.demoChecksum ? (
                  <Row label={t("transfer.export.demoChecksum")}>
                    <Mono>{e.demoChecksum}</Mono>
                  </Row>
                ) : null}
                <Row label={t("transfer.common.createdAt")}>{dt(e.createdAt) ?? <UnknownChip />}</Row>
                <Row label={t("transfer.export.startedAt")}>
                  <When value={e.startedAt} format={dt} />
                </Row>
                <Row label={t("transfer.export.finishedAt")}>
                  <When value={e.finishedAt} format={dt} />
                </Row>
              </dl>
              <p className="small muted">{t("transfer.common.copyNote")}</p>
            </section>
            <Section id="export-downloads" title={t("transfer.export.downloadsTitle")}>
              <ExportDownloads e={e} />
            </Section>
            <p>
              <Link className="link" to={EXPORTS_PATH}>
                {t("transfer.common.back")}
              </Link>
            </p>
          </>
        )}
      </QueryState>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Migration status

function ReconciliationResult({ r }: { r: Pick<ReconciliationSummary, "result"> | null | undefined }) {
  return <TransferChip value={r?.result} table={RECONCILIATION_CHIPS} labelKey="transfer.import.result" />;
}

/** The identity rebind list (listIdentityRebinds), with the state filter kept in the URL. Read-only. */
export function IdentityRebindList({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const { t } = useTranslation();
  const { dt } = useFmt();
  const [search, setSearch] = useSearchParams();
  const state = search.get("state") ?? "";
  const pager = useCursorPager();
  const rebinds = useIdentityRebinds<IdentityRebind>(state ? { state } : {}, pager.cursor);
  const columns: RegisterColumn<IdentityRebind>[] = [
    {
      id: "user",
      header: t("transfer.rebind.user"),
      rowHeader: true,
      hideable: false,
      cell: (r) => r.displayName,
      sortValue: (r) => r.displayName,
    },
    {
      id: "state",
      header: t("transfer.rebind.state.label"),
      cell: (r) => <TransferChip value={r.state} table={REBIND_STATE_CHIPS} labelKey="transfer.rebind.state" />,
      sortValue: (r) => r.state,
    },
    {
      id: "carried",
      header: t("transfer.rebind.carried"),
      cell: (r) => (
        <span className="block">
          <Mono>{r.issuer}</Mono> <Mono>{r.subject}</Mono>
        </span>
      ),
    },
    {
      id: "new",
      header: t("transfer.rebind.newIdentity"),
      cell: (r) =>
        r.newIssuer || r.newSubject ? (
          <span className="block">
            <Mono>{r.newIssuer}</Mono> <Mono>{r.newSubject}</Mono>
          </span>
        ) : (
          t("transfer.common.none")
        ),
    },
    {
      id: "resolved",
      header: t("transfer.rebind.resolvedAt"),
      cell: (r) => <When value={r.resolvedAt} format={dt} />,
      sortValue: (r) => r.resolvedAt ?? "",
    },
    { id: "operator", header: t("transfer.rebind.operator"), cell: (r) => r.operatorName ?? t("transfer.common.none") },
  ];
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div data-p7-list="identity-rebinds">
      <Heading className="visually-hidden">{t("transfer.rebind.listTitle")}</Heading>
      <div className="field">
        <label className="field__label" htmlFor="rebind-state">
          {t("transfer.rebind.state.label")}
        </label>
        <select
          id="rebind-state"
          value={state}
          onChange={(e) => {
            const next = new URLSearchParams(search);
            if (e.target.value) next.set("state", e.target.value);
            else next.delete("state");
            pager.reset();
            setSearch(next, { replace: true });
          }}
        >
          <option value="">{t("transfer.common.allOption")}</option>
          {IDENTITY_REBIND_STATES.map((s) => (
            <option key={s} value={s}>
              {t(`transfer.rebind.state.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <QueryState query={rebinds}>
        {(page: Page<IdentityRebind>) => (
          <>
            <RegisterTable
              id="p7-identity-rebinds"
              caption={t("transfer.rebind.listTitle")}
              rows={page.items}
              columns={columns}
              getRowId={(r) => r.id}
              emptyTitle={t("transfer.rebind.empty")}
              pageSize={50}
            />
            <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={rebinds.isFetching} />
          </>
        )}
      </QueryState>
    </div>
  );
}

export function MigrationStatusPage() {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  const title = t("transfer.import.title");
  usePageTitle(title);
  const pager = useCursorPager();
  const imports = useMigrationImports<MigrationImport>(pager.cursor);
  const columns: RegisterColumn<MigrationImport>[] = [
    {
      id: "imported",
      header: t("transfer.import.importedAt"),
      rowHeader: true,
      hideable: false,
      cell: (i) => (
        <Link className="link" to={importPath(i.id)}>
          {dt(i.importedAt) ?? i.id}
        </Link>
      ),
      sortValue: (i) => i.importedAt,
    },
    {
      id: "environment",
      header: t("transfer.export.environment.label"),
      cell: (i) => (
        <TransferChip value={i.sourceEnvironment} table={ENVIRONMENT_CHIPS} labelKey="transfer.export.environment" />
      ),
    },
    {
      id: "result",
      header: t("transfer.import.result.label"),
      cell: (i) => <ReconciliationResult r={i.latestReconciliation} />,
      sortValue: (i) => i.latestReconciliation?.result ?? "",
    },
    { id: "rows", header: t("transfer.export.rows"), cell: (i) => <Count value={i.rowCount} locale={locale} /> },
    {
      id: "attachments",
      header: t("transfer.export.attachments"),
      cell: (i) => <Count value={i.attachmentCount} locale={locale} />,
    },
    {
      id: "identities",
      header: t("transfer.import.identities"),
      cell: (i) => t("transfer.import.identitiesValue", i.identities),
    },
    { id: "operator", header: t("transfer.import.operator"), cell: (i) => i.operatorName },
  ];
  return (
    <div className="page" data-p7-screen="migration-status">
      <PageHeader title={title} crumbs={adminCrumbs(t, { label: title })} />
      <ReadOnlyCliNote />
      <NotApprovalNote />
      <Section id="migration-imports" title={t("transfer.import.listTitle")}>
        <QueryState query={imports}>
          {(page: Page<MigrationImport>) => (
            <>
              <RegisterTable
                id="p7-migration-imports"
                caption={t("transfer.import.listTitle")}
                rows={page.items}
                columns={columns}
                getRowId={(i) => i.id}
                emptyTitle={t("transfer.import.empty")}
                pageSize={50}
              />
              <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={imports.isFetching} />
            </>
          )}
        </QueryState>
      </Section>
      <Section id="identity-rebinds" title={t("transfer.rebind.title")}>
        <IdentityRebindList headingLevel={3} />
      </Section>
    </div>
  );
}

export function IdentityRebindsPage() {
  const { t } = useTranslation();
  const title = t("transfer.rebind.title");
  usePageTitle(title);
  return (
    <div className="page" data-p7-screen="identity-rebinds">
      <PageHeader
        title={title}
        subtitle={t("nav.p7.identityRebinds.summary")}
        crumbs={adminCrumbs(t, { label: t("transfer.import.title"), to: IMPORTS_PATH }, { label: title })}
      />
      <ReadOnlyCliNote />
      <Section id="identity-rebinds" title={t("transfer.rebind.listTitle")}>
        <IdentityRebindList headingLevel={3} />
      </Section>
    </div>
  );
}

function SummaryFacts({ s }: { s: ReconciliationSummary }) {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  return (
    <dl className="workspace-header__grid">
      <Row label={t("transfer.import.result.label")}>
        <ReconciliationResult r={s} />
      </Row>
      <Row label={t("transfer.import.runKind.label")}>{t(`transfer.import.runKind.${s.runKind}`)}</Row>
      <Row label={t("transfer.import.runAt")}>{dt(s.runAt) ?? <UnknownChip />}</Row>
      <Row label={t("transfer.import.operator")}>{s.operatorName}</Row>
      <Row label={t("transfer.import.tablesChecked")}>
        <Count value={s.tablesChecked} locale={locale} />
      </Row>
      <Row label={t("transfer.import.tablesMismatched")}>
        <Count value={s.tablesMismatched} locale={locale} />
      </Row>
      <Row label={t("transfer.import.rowsExpected")}>
        <Count value={s.rowsExpected} locale={locale} />
      </Row>
      <Row label={t("transfer.import.rowsActual")}>
        <Count value={s.rowsActual} locale={locale} />
      </Row>
      <Row label={t("transfer.import.attachmentsChecked")}>
        <Count value={s.attachmentsChecked} locale={locale} />
      </Row>
      <Row label={t("transfer.import.attachmentsMismatched")}>
        <Count value={s.attachmentsMismatched} locale={locale} />
      </Row>
    </dl>
  );
}

export function MigrationImportPage() {
  const { t } = useTranslation();
  const { locale, dt } = useFmt();
  const { migrationImportId } = useParams();
  const title = t("nav.p7.migrationImport.title");
  usePageTitle(title);
  const query = useMigrationImport<MigrationImport>(migrationImportId);
  const reconciliations = useMigrationReconciliations<ReconciliationSummary>(migrationImportId);
  const columns: RegisterColumn<ReconciliationSummary>[] = [
    {
      id: "runAt",
      header: t("transfer.import.runAt"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link className="link" to={reconciliationPath(migrationImportId ?? "", r.id)}>
          {dt(r.runAt) ?? r.id}
        </Link>
      ),
      sortValue: (r) => r.runAt,
    },
    { id: "kind", header: t("transfer.import.runKind.label"), cell: (r) => t(`transfer.import.runKind.${r.runKind}`) },
    {
      id: "result",
      header: t("transfer.import.result.label"),
      cell: (r) => <ReconciliationResult r={r} />,
      sortValue: (r) => r.result,
    },
    {
      id: "tablesMismatched",
      header: t("transfer.import.tablesMismatched"),
      cell: (r) => <Count value={r.tablesMismatched} locale={locale} />,
    },
    {
      id: "attachmentsMismatched",
      header: t("transfer.import.attachmentsMismatched"),
      cell: (r) => <Count value={r.attachmentsMismatched} locale={locale} />,
    },
    { id: "operator", header: t("transfer.import.operator"), cell: (r) => r.operatorName },
  ];
  return (
    <div className="page" data-p7-screen="migration-import">
      <PageHeader
        title={title}
        subtitle={t("nav.p7.migrationImport.summary")}
        crumbs={adminCrumbs(t, { label: t("transfer.import.title"), to: IMPORTS_PATH }, { label: title })}
      />
      <ReadOnlyCliNote />
      <QueryState query={query}>
        {(i) => (
          <section className="card" aria-labelledby="import-facts" data-import={i.id}>
            <h2 id="import-facts" className="card__title">
              <ReconciliationResult r={i.latestReconciliation} />
            </h2>
            <dl className="workspace-header__grid">
              <Row label={t("transfer.export.environment.label")}>
                <TransferChip
                  value={i.sourceEnvironment}
                  table={ENVIRONMENT_CHIPS}
                  labelKey="transfer.export.environment"
                />
              </Row>
              <Row label={t("transfer.import.sourceExport")}>
                <Mono>{i.sourceExportReference}</Mono>
              </Row>
              <Row label={t("transfer.export.migrationLevel")}>
                <Mono>{i.migrationLevel}</Mono>
              </Row>
              <Row label={t("transfer.export.tables")}>
                <Count value={i.tableCount} locale={locale} />
              </Row>
              <Row label={t("transfer.export.rows")}>
                <Count value={i.rowCount} locale={locale} />
              </Row>
              <Row label={t("transfer.export.attachments")}>
                <Count value={i.attachmentCount} locale={locale} />
              </Row>
              <Row label={t("transfer.export.attachmentBytes")}>
                <Count value={i.attachmentBytes} locale={locale} />
              </Row>
              <Row label={t("transfer.export.manifestSha256")}>
                <Mono>{i.manifestSha256}</Mono>
              </Row>
              <Row label={t("transfer.export.attachmentManifestSha256")}>
                <Mono>{i.attachmentManifestSha256}</Mono>
              </Row>
              {i.sourceEnvironment === "demo" || i.demoChecksum ? (
                <Row label={t("transfer.export.demoChecksum")}>
                  <Mono>{i.demoChecksum}</Mono>
                </Row>
              ) : null}
              <Row label={t("transfer.import.operator")}>{i.operatorName}</Row>
              <Row label={t("transfer.export.startedAt")}>{dt(i.startedAt) ?? <UnknownChip />}</Row>
              <Row label={t("transfer.import.importedAt")}>{dt(i.importedAt) ?? <UnknownChip />}</Row>
              <Row label={t("transfer.import.identities")}>
                <Link className="link" to="/admin/migration/identity-rebinds?state=unbound">
                  {t("transfer.import.identitiesValue", i.identities)}
                </Link>
              </Row>
            </dl>
            <p className="small muted">{t("transfer.common.copyNote")}</p>
          </section>
        )}
      </QueryState>
      <Section id="reconciliations" title={t("transfer.import.reconciliationsTitle")}>
        <QueryState query={reconciliations}>
          {(rows) => (
            <RegisterTable
              id="p7-migration-reconciliations"
              caption={t("transfer.import.reconciliationsTitle")}
              rows={rows}
              columns={columns}
              getRowId={(r) => r.id}
              emptyTitle={t("transfer.import.reconciliationsEmpty")}
              pageSize={50}
            />
          )}
        </QueryState>
      </Section>
    </div>
  );
}

export function MigrationReconciliationPage() {
  const { t } = useTranslation();
  const { locale } = useFmt();
  const { migrationImportId, migrationReconciliationId } = useParams();
  const title = t("nav.p7.migrationReconciliation.title");
  usePageTitle(title);
  const query = useMigrationReconciliation<MigrationReconciliation>(migrationImportId, migrationReconciliationId);
  type TableRow = MigrationReconciliation["tables"][number];
  type MismatchRow = MigrationReconciliation["attachmentMismatches"][number];
  const tableColumns: RegisterColumn<TableRow>[] = [
    {
      id: "table",
      header: t("transfer.import.tableName"),
      rowHeader: true,
      hideable: false,
      cell: (r) => <Mono>{r.tableName}</Mono>,
      sortValue: (r) => r.tableName,
    },
    {
      id: "matched",
      header: t("transfer.import.tableMatched.label"),
      cell: (r) => (
        <TransferChip
          value={String(r.matched)}
          table={{ true: ["good", "check"], false: ["bad", "alert"] }}
          labelKey="transfer.import.tableMatched"
        />
      ),
      // Differences first when sorted ascending.
      sortValue: (r) => (r.matched ? 1 : 0),
    },
    {
      id: "expectedRows",
      header: t("transfer.import.expectedRows"),
      cell: (r) => <Count value={r.expectedRows} locale={locale} />,
    },
    {
      id: "actualRows",
      header: t("transfer.import.actualRows"),
      cell: (r) => <Count value={r.actualRows} locale={locale} />,
    },
    { id: "expectedDigest", header: t("transfer.import.expectedDigest"), cell: (r) => <Mono>{r.expectedDigest}</Mono> },
    { id: "actualDigest", header: t("transfer.import.actualDigest"), cell: (r) => <Mono>{r.actualDigest}</Mono> },
  ];
  const mismatchColumns: RegisterColumn<MismatchRow>[] = [
    {
      id: "object",
      header: t("transfer.import.objectName"),
      rowHeader: true,
      hideable: false,
      cell: (r) => <Mono>{r.objectName}</Mono>,
      sortValue: (r) => r.objectName,
    },
    { id: "parent", header: t("transfer.import.parentTable"), cell: (r) => <Mono>{r.parentTable}</Mono> },
    {
      id: "problem",
      header: t("transfer.import.problem.label"),
      cell: (r) => (
        <TransferChip value={r.problem} table={ATTACHMENT_PROBLEM_CHIPS} labelKey="transfer.import.problem" />
      ),
      sortValue: (r) => r.problem,
    },
    {
      id: "expectedSize",
      header: t("transfer.import.expectedSize"),
      cell: (r) => <Count value={r.expectedSize} locale={locale} />,
    },
    {
      id: "actualSize",
      header: t("transfer.import.actualSize"),
      // A missing object has no size: "Not found", never 0.
      cell: (r) =>
        r.actualSize === null ? t("transfer.import.notFound") : <Count value={r.actualSize} locale={locale} />,
    },
    { id: "expectedSha", header: t("transfer.import.expectedSha256"), cell: (r) => <Mono>{r.expectedSha256}</Mono> },
    {
      id: "actualSha",
      header: t("transfer.import.actualSha256"),
      cell: (r) => (r.actualSha256 === null ? t("transfer.import.notFound") : <Mono>{r.actualSha256}</Mono>),
    },
  ];
  return (
    <div className="page" data-p7-screen="migration-reconciliation">
      <PageHeader
        title={title}
        subtitle={t("nav.p7.migrationReconciliation.summary")}
        crumbs={adminCrumbs(
          t,
          { label: t("transfer.import.title"), to: IMPORTS_PATH },
          { label: t("nav.p7.migrationImport.title"), to: importPath(migrationImportId ?? "") },
          { label: title },
        )}
      />
      <ReadOnlyCliNote />
      <QueryState query={query}>
        {(rec) => (
          <>
            <section className="card" aria-labelledby="reconciliation-facts" data-result={rec.summary.result}>
              <h2 id="reconciliation-facts" className="card__title">
                <ReconciliationResult r={rec.summary} />
              </h2>
              <SummaryFacts s={rec.summary} />
            </section>
            <Section id="reconciliation-tables" title={t("transfer.import.tablesTitle")}>
              <RegisterTable
                id="p7-reconciliation-tables"
                caption={t("transfer.import.tablesTitle")}
                rows={rec.tables}
                columns={tableColumns}
                getRowId={(r) => r.tableName}
                emptyTitle={t("transfer.common.none")}
                defaultSort={{ id: "matched", dir: "asc" }}
                pageSize={50}
              />
            </Section>
            <Section id="reconciliation-attachments" title={t("transfer.import.attachmentMismatchesTitle")}>
              <RegisterTable
                id="p7-reconciliation-attachments"
                caption={t("transfer.import.attachmentMismatchesTitle")}
                rows={rec.attachmentMismatches}
                columns={mismatchColumns}
                getRowId={(r) => `${r.parentTable}/${r.objectName}`}
                emptyTitle={t("transfer.import.attachmentMismatchesEmpty")}
                pageSize={50}
              />
            </Section>
          </>
        )}
      </QueryState>
    </div>
  );
}
