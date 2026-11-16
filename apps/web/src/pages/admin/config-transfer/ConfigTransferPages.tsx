// Administration > Configuration transfer (T-DG7-FE-B; p7-work-split §D.2/D.4; ADR-0065; REQ-S19-008). Every screen
// reads and writes the real API through the P7 client (api/p7.ts); the organization is the caller's home organization.
//  - Export (config_bundle.export): pick kinds (none = every listed kind with a published version) and a reason; the
//    kinds offered are EXPORTABLE_CONFIG_BUNDLE_KINDS. `automation_rule` is not offered (ADR-0065 Amendment 1, A1.2:
//    not carried in this release; naming it is 422 unportable_reference), and the "not carried" note says so. The bundle
//    is listed with its kinds, item count, size, SHA-256 and a download (the server's exact bytes, a plain same-origin
//    link). An export carries published configuration only.
//  - Import (config_bundle.import): upload a bundle file (checked locally for size and JSON first; the server checks
//    the schema version, checksum and each item), then Validate (If-Match the import's version) to see the planned
//    action of every item, then "Commit as drafts" (If-Match) only when the validation has no conflict and no refused
//    item. A commit NEVER publishes: drafting kinds end as drafts that go through the normal review and publishing; the
//    non-draft kinds are applied as a change and job schedules arrive disabled (the §D.2 note is always shown).
//  - A 409/422 reloads the import (useRunner), so the user always acts on the plan the server holds.
//  - The auditor (and anyone without either right) gets the no-permission state; the server decides every request.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { api, buildUrl } from "../../../api/client.ts";
import {
  CONFIG_BUNDLE_KINDS,
  EXPORTABLE_CONFIG_BUNDLE_KINDS,
  p7Paths,
  useConfigBundleExport,
  useConfigBundleExports,
  useConfigBundleImport,
  useConfigBundleImports,
  useP7AdminRefresh,
  UNPORTABLE_CONFIG_BUNDLE_KINDS,
  type ConfigBundleKind,
} from "../../../api/p7.ts";
import { useLocale } from "../../../app/locale.ts";
import { beginSessionGuard, useSessionNavigate } from "../../../auth/sessionBound.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { RegisterTable, type RegisterColumn } from "../../../components/RegisterTable.tsx";
import { Section } from "../../../components/Section.tsx";
import { NoPermissionState, QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { useRunner } from "../../automation/ui.tsx";
import { FormAlert } from "../../my-work/p4ui.tsx";
import {
  adminCrumbs,
  CursorPagerControls,
  isValidReason,
  ReasonField,
  useCan,
  useCursorPager,
  useHomeOrganizationId,
} from "../security/shared.tsx";
import {
  BUNDLE_ACTION_CHIPS,
  BUNDLE_STATUS_CHIPS,
  Count,
  ENVIRONMENT_CHIPS,
  headerSafeFileName,
  Mono,
  NotApprovalNote,
  Row,
  TransferChip,
  UnknownChip,
  When,
} from "../migration/ui.tsx";

// ------------------------------------------------------------------------------------------------ contract shapes

export interface ConfigBundleExport {
  id: string;
  organizationId: string;
  bundleSchemaVersion: string;
  sourceEnvironment: "production" | "demo" | "unmarked";
  kinds: ConfigBundleKind[];
  itemCount: number;
  byteSize: string;
  sha256: string;
  createdAt: string;
  createdBy: string;
}

export interface ConfigBundleImportItem {
  id: string;
  ordinal: number;
  kind: ConfigBundleKind;
  itemCode: string;
  sourceVersionNo: number | null;
  contentSha256: string;
  action: "create_draft" | "new_draft" | "identical" | "conflict" | "refused";
  problemCode: string | null;
  targetRecordType: string | null;
  targetRecordId: string | null;
}

export interface ConfigBundleImport {
  id: string;
  organizationId: string;
  bundleSchemaVersion: string;
  sourceEnvironment: "production" | "demo" | "unmarked";
  fileName: string;
  byteSize: string;
  sha256: string;
  itemCount: number;
  status: "uploaded" | "validated" | "invalid" | "committed";
  validationNo: number;
  counts: { createDraft: number; newDraft: number; identical: number; conflict: number; refused: number } | null;
  items: ConfigBundleImportItem[];
  validatedAt: string | null;
  validatedBy: string | null;
  committedAt: string | null;
  committedBy: string | null;
  createdAt: string;
  createdBy: string;
  version: number;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** The server's limit (ADR-0065 §2): 5 MiB. A larger file is refused here without sending it. */
export const BUNDLE_MAX_BYTES = 5 * 1024 * 1024;

const BASE = "/admin/config-transfer";
const exportPath = (id: string) => `${BASE}/exports/${encodeURIComponent(id)}`;
const importPath = (id: string) => `${BASE}/imports/${encodeURIComponent(id)}`;

/** The translated text of an item's problem code (`config_bundle.x` -> `problems.config_bundle__x`). */
export function itemProblemText(t: (k: string) => string, code: string | null): string | null {
  if (!code) return null;
  const key = `problems.${code.replace(/\./g, "__")}`;
  const text = t(key);
  return text === key ? code : text;
}

/** Commit is offered only for a validated import with no conflict and no refused item (§D.2 `not_committable`). */
export function isCommittable(i: Pick<ConfigBundleImport, "status" | "counts">): boolean {
  return i.status === "validated" && i.counts !== null && i.counts.conflict === 0 && i.counts.refused === 0;
}

function NonDraftNote() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="non-draft-note">
      <Icon name="info" /> {t("transfer.bundle.nonDraftNote")}
    </p>
  );
}

/**
 * What a bundle does not carry, with the reason (ADR-0065 Amendment 1, A1.2): the kinds are not offered for export,
 * and this note says so where the kinds are listed, so the omission is never silent.
 */
function NotCarriedNote() {
  const { t } = useTranslation();
  return (
    <p
      className="field__hint"
      id="bundle-kinds-not-carried"
      data-state="not-carried-note"
      data-kinds={UNPORTABLE_CONFIG_BUNDLE_KINDS.join(" ")}
    >
      <Icon name="info" /> {t("transfer.bundle.notCarriedNote")}
    </p>
  );
}

function KindList({ kinds }: { kinds: readonly string[] }) {
  const { t } = useTranslation();
  return <>{kinds.map((k) => t(`transfer.bundle.kind.${k}`)).join(", ")}</>;
}

// ------------------------------------------------------------------------------------------------ export

function ExportBundleForm({ organizationId, onDone }: { organizationId: string; onDone: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [kinds, setKinds] = useState<ConfigBundleKind[]>([]);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [created, setCreated] = useState<ConfigBundleExport | null>(null);
  const runner = useRunner(onDone);
  return (
    <form
      className="form"
      noValidate
      data-form="export-config-bundle"
      onSubmit={(e) => {
        e.preventDefault();
        setCreated(null);
        if (!isValidReason(reason)) {
          setInvalid(true);
          document.getElementById("bundle-export-reason")?.focus();
          return;
        }
        setInvalid(false);
        // In the contract's kind order; no kind = every kind with a published version (the field is optional).
        const ordered = EXPORTABLE_CONFIG_BUNDLE_KINDS.filter((k) => kinds.includes(k));
        void runner
          .run<ConfigBundleExport>(buildUrl(p7Paths.configBundleExports, { organizationId }), {
            method: "POST",
            body: { reason, ...(ordered.length ? { kinds: ordered } : {}) },
          })
          .then((result) => {
            if (!result) return;
            setCreated(result);
            setReason("");
            setKinds([]);
          });
      }}
    >
      {runner.alert}
      {created ? (
        <p className="banner banner--info" role="status" data-state="bundle-exported">
          <Icon name="info" /> {t("transfer.bundle.exported")}{" "}
          <Link className="link" to={exportPath(created.id)}>
            {t("transfer.bundle.openExport")}
          </Link>
        </p>
      ) : null}
      <fieldset className="field" aria-describedby="bundle-kinds-hint bundle-kinds-not-carried">
        <legend className="field__label">{t("transfer.bundle.kinds")}</legend>
        <p className="field__hint" id="bundle-kinds-hint">
          {t("transfer.bundle.kindsHint")}
        </p>
        <NotCarriedNote />
        <div className="grid grid--3">
          {EXPORTABLE_CONFIG_BUNDLE_KINDS.map((k) => (
            <label key={k} className="checkbox">
              <input
                type="checkbox"
                name="kinds"
                value={k}
                checked={kinds.includes(k)}
                onChange={(e) => setKinds((cur) => (e.target.checked ? [...cur, k] : cur.filter((x) => x !== k)))}
              />{" "}
              {t(`transfer.bundle.kind.${k}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <ReasonField
        id="bundle-export-reason"
        value={reason}
        onChange={setReason}
        invalid={invalid}
        label={t("transfer.bundle.reason")}
      />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy} data-action="export-bundle">
          {t("transfer.bundle.export")}
        </button>
      </div>
    </form>
  );
}

function ExportsList({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const pager = useCursorPager();
  const exports = useConfigBundleExports<ConfigBundleExport>(organizationId, pager.cursor);
  const columns: RegisterColumn<ConfigBundleExport>[] = [
    {
      id: "created",
      header: t("transfer.common.createdAt"),
      rowHeader: true,
      hideable: false,
      cell: (e) => (
        <Link className="link" to={exportPath(e.id)}>
          {formatDateTime(e.createdAt, locale) ?? e.id}
        </Link>
      ),
      sortValue: (e) => e.createdAt,
    },
    {
      id: "kinds",
      header: t("transfer.bundle.kind.label"),
      cell: (e) => <KindList kinds={e.kinds} />,
      filterText: (e) => e.kinds.join(" "),
    },
    { id: "items", header: t("transfer.bundle.itemCount"), cell: (e) => <Count value={e.itemCount} locale={locale} /> },
    {
      id: "environment",
      header: t("transfer.export.environment.label"),
      cell: (e) => (
        <TransferChip value={e.sourceEnvironment} table={ENVIRONMENT_CHIPS} labelKey="transfer.export.environment" />
      ),
    },
    {
      id: "download",
      header: t("transfer.bundle.download"),
      hideable: false,
      cell: (e) => (
        <a
          className="button button--link button--small"
          href={p7Paths.configBundleExportDownload(e.id)}
          download={`config-bundle-${e.id}.json`}
          data-action="download-bundle"
        >
          {t("transfer.bundle.download")}
          <span className="visually-hidden">: {formatDateTime(e.createdAt, locale) ?? e.id}</span>
        </a>
      ),
    },
  ];
  return (
    <QueryState query={exports}>
      {(page: Page<ConfigBundleExport>) => (
        <>
          <RegisterTable
            id="p7-config-bundle-exports"
            caption={t("transfer.bundle.exportsTitle")}
            rows={page.items}
            columns={columns}
            getRowId={(e) => e.id}
            emptyTitle={t("transfer.bundle.exportsEmpty")}
            pageSize={50}
          />
          <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={exports.isFetching} />
        </>
      )}
    </QueryState>
  );
}

// ------------------------------------------------------------------------------------------------ upload

/** The file's text (FileReader: available in every supported browser and in the test DOM). */
function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });
}

/** A local refusal (no request sent): shown in the same form-level alert, translated. */
class LocalProblem extends Error {
  readonly key: string;
  constructor(key: string) {
    super(key);
    this.key = key;
  }
}

function UploadBundleForm({ organizationId, onDone }: { organizationId: string; onDone: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const navigate = useSessionNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setError(null);
    if (!file) {
      setError(new LocalProblem("transfer.bundle.fileRequired"));
      return;
    }
    if (file.size > BUNDLE_MAX_BYTES) {
      setError(new LocalProblem("problems.config_bundle__too_large"));
      return;
    }
    try {
      JSON.parse(await readText(file));
    } catch {
      setError(new LocalProblem("transfer.bundle.fileNotJson"));
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      // The file's own bytes are sent unchanged, so the server checks exactly what IT exported.
      const created = await api.send<ConfigBundleImport>(buildUrl(p7Paths.configBundleImports, { organizationId }), {
        method: "POST",
        rawBody: file,
        contentType: "application/json",
        headers: { "X-File-Name": headerSafeFileName(file.name) },
      });
      if (action.stale()) return;
      await onDone();
      if (action.stale()) return;
      navigate(importPath(created.id));
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
    } finally {
      if (action.current()) setBusy(false);
    }
  };
  return (
    <form
      className="form"
      noValidate
      data-form="upload-config-bundle"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {error instanceof LocalProblem ? (
        <div className="banner banner--error" role="alert" data-state="error" data-problem={error.key}>
          <p>
            <Icon name="alert" /> {t(error.key)}
          </p>
        </div>
      ) : (
        <FormAlert error={error} />
      )}
      <div className="field">
        <label className="field__label" htmlFor="bundle-file">
          {t("transfer.bundle.file")}
          <span className="field__required"> ({t("common.form.required")})</span>
        </label>
        <input
          id="bundle-file"
          type="file"
          accept="application/json,.json"
          aria-required
          onChange={(e) => {
            setError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
        />
      </div>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={busy} data-action="upload-bundle">
          {t("transfer.bundle.upload")}
        </button>
      </div>
    </form>
  );
}

function ImportsList({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const pager = useCursorPager();
  const imports = useConfigBundleImports<ConfigBundleImport>(organizationId, pager.cursor);
  const columns: RegisterColumn<ConfigBundleImport>[] = [
    {
      id: "file",
      header: t("transfer.bundle.fileName"),
      rowHeader: true,
      hideable: false,
      cell: (i) => (
        <Link className="link" to={importPath(i.id)}>
          <bdi>{i.fileName}</bdi>
        </Link>
      ),
      sortValue: (i) => i.fileName,
    },
    {
      id: "status",
      header: t("transfer.bundle.status.label"),
      cell: (i) => <TransferChip value={i.status} table={BUNDLE_STATUS_CHIPS} labelKey="transfer.bundle.status" />,
      sortValue: (i) => i.status,
    },
    { id: "items", header: t("transfer.bundle.itemCount"), cell: (i) => <Count value={i.itemCount} locale={locale} /> },
    {
      id: "environment",
      header: t("transfer.export.environment.label"),
      cell: (i) => (
        <TransferChip value={i.sourceEnvironment} table={ENVIRONMENT_CHIPS} labelKey="transfer.export.environment" />
      ),
    },
    {
      id: "created",
      header: t("transfer.common.createdAt"),
      cell: (i) => formatDateTime(i.createdAt, locale) ?? <UnknownChip />,
      sortValue: (i) => i.createdAt,
    },
  ];
  return (
    <QueryState query={imports}>
      {(page: Page<ConfigBundleImport>) => (
        <>
          <RegisterTable
            id="p7-config-bundle-imports"
            caption={t("transfer.bundle.importsTitle")}
            rows={page.items}
            columns={columns}
            getRowId={(i) => i.id}
            emptyTitle={t("transfer.bundle.importsEmpty")}
            pageSize={50}
          />
          <CursorPagerControls pager={pager} nextCursor={page.nextCursor} busy={imports.isFetching} />
        </>
      )}
    </QueryState>
  );
}

export function ConfigTransferPage() {
  const { t } = useTranslation();
  const title = t("transfer.bundle.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const canExport = useCan("config_bundle.export");
  const canImport = useCan("config_bundle.import");
  const refresh = useP7AdminRefresh("config-bundles");
  return (
    <div className="page" data-p7-screen="config-transfer">
      <PageHeader title={title} subtitle={t("transfer.bundle.intro")} crumbs={adminCrumbs(t, { label: title })} />
      <NonDraftNote />
      <NotApprovalNote />
      {!canExport && !canImport ? <NoPermissionState /> : null}
      {canExport ? (
        <>
          <Section id="bundle-export" title={t("transfer.bundle.exportTitle")}>
            <ExportBundleForm organizationId={organizationId} onDone={refresh} />
          </Section>
          <Section id="bundle-exports" title={t("transfer.bundle.exportsTitle")}>
            <ExportsList organizationId={organizationId} />
          </Section>
        </>
      ) : null}
      {canImport ? (
        <>
          <Section id="bundle-upload" title={t("transfer.bundle.uploadTitle")}>
            <UploadBundleForm organizationId={organizationId} onDone={refresh} />
          </Section>
          <Section id="bundle-imports" title={t("transfer.bundle.importsTitle")}>
            <ImportsList organizationId={organizationId} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ details

export function ConfigBundleExportPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { configBundleExportId } = useParams();
  const title = t("nav.p7.configBundleExport.title");
  usePageTitle(title);
  const query = useConfigBundleExport<ConfigBundleExport>(configBundleExportId);
  return (
    <div className="page" data-p7-screen="config-bundle-export">
      <PageHeader
        title={title}
        subtitle={t("nav.p7.configBundleExport.summary")}
        crumbs={adminCrumbs(t, { label: t("transfer.bundle.title"), to: BASE }, { label: title })}
      />
      <QueryState query={query}>
        {(e) => (
          <section className="card" aria-labelledby="bundle-export-facts" data-bundle-export={e.id}>
            <h2 id="bundle-export-facts" className="card__title">
              <KindList kinds={e.kinds} />
            </h2>
            <dl className="workspace-header__grid">
              <Row label={t("transfer.export.environment.label")}>
                <TransferChip
                  value={e.sourceEnvironment}
                  table={ENVIRONMENT_CHIPS}
                  labelKey="transfer.export.environment"
                />
              </Row>
              <Row label={t("transfer.bundle.schemaVersion")}>
                <Mono>{e.bundleSchemaVersion}</Mono>
              </Row>
              <Row label={t("transfer.bundle.itemCount")}>
                <Count value={e.itemCount} locale={locale} />
              </Row>
              <Row label={t("transfer.bundle.byteSize")}>
                <Count value={e.byteSize} locale={locale} />
              </Row>
              <Row label={t("transfer.bundle.sha256")}>
                <Mono>{e.sha256}</Mono>
              </Row>
              <Row label={t("transfer.common.createdAt")}>{formatDateTime(e.createdAt, locale) ?? <UnknownChip />}</Row>
            </dl>
            <div className="form__actions">
              <a
                className="button button--secondary"
                href={p7Paths.configBundleExportDownload(e.id)}
                download={`config-bundle-${e.id}.json`}
                data-action="download-bundle"
              >
                {t("transfer.bundle.download")}
              </a>
              <Link className="link" to={BASE}>
                {t("transfer.common.back")}
              </Link>
            </div>
          </section>
        )}
      </QueryState>
    </div>
  );
}

function ImportCounts({ i }: { i: ConfigBundleImport }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (!i.counts) return <p className="muted">{t("transfer.bundle.notValidated")}</p>;
  const rows: [string, number][] = [
    ["create_draft", i.counts.createDraft],
    ["new_draft", i.counts.newDraft],
    ["identical", i.counts.identical],
    ["conflict", i.counts.conflict],
    ["refused", i.counts.refused],
  ];
  return (
    <dl className="workspace-header__grid" data-counts>
      {rows.map(([action, n]) => (
        <Row key={action} label={t(`transfer.bundle.action.${action}`)}>
          <span data-action-count={action}>
            <Count value={n} locale={locale} />
          </span>
        </Row>
      ))}
    </dl>
  );
}

export function ConfigBundleImportPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const dt = (v: string) => formatDateTime(v, locale);
  const { configBundleImportId } = useParams();
  const title = t("nav.p7.configBundleImport.title");
  usePageTitle(title);
  const canImport = useCan("config_bundle.import");
  const query = useConfigBundleImport<ConfigBundleImport>(configBundleImportId);
  const refresh = useP7AdminRefresh("config-bundles");
  const runner = useRunner(refresh);
  const [done, setDone] = useState<"validated" | "committed" | null>(null);
  const columns: RegisterColumn<ConfigBundleImportItem>[] = [
    {
      id: "item",
      header: t("transfer.bundle.itemCode"),
      rowHeader: true,
      hideable: false,
      cell: (r) => <Mono>{r.itemCode}</Mono>,
      sortValue: (r) => r.itemCode,
    },
    {
      id: "kind",
      header: t("transfer.bundle.kind.label"),
      cell: (r) => t(`transfer.bundle.kind.${r.kind}`),
      sortValue: (r) => CONFIG_BUNDLE_KINDS.indexOf(r.kind),
    },
    {
      id: "action",
      header: t("transfer.bundle.action.label"),
      cell: (r) => <TransferChip value={r.action} table={BUNDLE_ACTION_CHIPS} labelKey="transfer.bundle.action" />,
      sortValue: (r) => r.action,
    },
    {
      id: "problem",
      header: t("transfer.bundle.problem"),
      cell: (r) => itemProblemText(t, r.problemCode) ?? t("transfer.common.none"),
      filterText: (r) => r.problemCode ?? "",
    },
    {
      id: "sourceVersion",
      header: t("transfer.bundle.sourceVersionNo"),
      cell: (r) =>
        r.sourceVersionNo === null ? t("transfer.common.none") : <Count value={r.sourceVersionNo} locale={locale} />,
    },
    {
      id: "target",
      header: t("transfer.bundle.target"),
      cell: (r) => (r.targetRecordType ? <Mono>{r.targetRecordType}</Mono> : t("transfer.common.none")),
    },
    { id: "sha", header: t("transfer.bundle.sha256"), cell: (r) => <Mono>{r.contentSha256}</Mono> },
  ];
  return (
    <div className="page" data-p7-screen="config-bundle-import">
      <PageHeader
        title={title}
        subtitle={t("nav.p7.configBundleImport.summary")}
        crumbs={adminCrumbs(t, { label: t("transfer.bundle.title"), to: BASE }, { label: title })}
      />
      <NonDraftNote />
      <QueryState query={query}>
        {(i) => {
          const canValidate = canImport && (i.status === "uploaded" || i.status === "validated");
          const committable = canImport && isCommittable(i);
          return (
            <>
              <section
                className="card"
                aria-labelledby="bundle-import-facts"
                data-bundle-import={i.id}
                data-bundle-status={i.status}
              >
                <h2 id="bundle-import-facts" className="card__title">
                  <TransferChip value={i.status} table={BUNDLE_STATUS_CHIPS} labelKey="transfer.bundle.status" />{" "}
                  <bdi>{i.fileName}</bdi>
                </h2>
                {runner.alert}
                {done === "validated" && i.status === "validated" ? (
                  <p className="banner banner--info" role="status">
                    <Icon name="info" /> {t("transfer.bundle.validated")}
                  </p>
                ) : null}
                {i.status === "committed" ? (
                  <p className="banner banner--info" role="status" data-state="committed">
                    <Icon name="check" /> {t("transfer.bundle.committedNote")}
                  </p>
                ) : null}
                {i.status === "invalid" ? (
                  <p className="banner banner--error" role="note" data-state="invalid">
                    <Icon name="alert" /> {t("transfer.bundle.invalidNote")}
                  </p>
                ) : null}
                {i.status === "validated" && !isCommittable(i) ? (
                  <p className="banner banner--warning" role="note" data-state="not-committable">
                    <Icon name="alert" /> {t("transfer.bundle.commitBlocked")}
                  </p>
                ) : null}
                <dl className="workspace-header__grid">
                  <Row label={t("transfer.export.environment.label")}>
                    <TransferChip
                      value={i.sourceEnvironment}
                      table={ENVIRONMENT_CHIPS}
                      labelKey="transfer.export.environment"
                    />
                  </Row>
                  <Row label={t("transfer.bundle.schemaVersion")}>
                    <Mono>{i.bundleSchemaVersion}</Mono>
                  </Row>
                  <Row label={t("transfer.bundle.itemCount")}>
                    <Count value={i.itemCount} locale={locale} />
                  </Row>
                  <Row label={t("transfer.bundle.byteSize")}>
                    <Count value={i.byteSize} locale={locale} />
                  </Row>
                  <Row label={t("transfer.bundle.sha256")}>
                    <Mono>{i.sha256}</Mono>
                  </Row>
                  <Row label={t("transfer.bundle.validationNo")}>
                    {i.validationNo > 0 ? (
                      <Count value={i.validationNo} locale={locale} />
                    ) : (
                      t("transfer.bundle.notValidated")
                    )}
                  </Row>
                  <Row label={t("transfer.bundle.validatedAt")}>
                    <When value={i.validatedAt} format={dt} />
                  </Row>
                  <Row label={t("transfer.bundle.committedAt")}>
                    <When value={i.committedAt} format={dt} />
                  </Row>
                  <Row label={t("transfer.common.version")}>
                    <Mono>{String(i.version)}</Mono>
                  </Row>
                </dl>
                {canValidate || committable ? (
                  <div className="form__actions">
                    {canValidate ? (
                      <button
                        type="button"
                        className={committable ? "button button--secondary" : "button button--primary"}
                        disabled={runner.busy}
                        data-action="validate-bundle"
                        onClick={() => {
                          setDone(null);
                          void runner
                            .run(p7Paths.validateConfigBundleImport(i.id), { method: "POST", ifMatch: i.version })
                            .then((r) => r && setDone("validated"));
                        }}
                      >
                        {t("transfer.bundle.validate")}
                      </button>
                    ) : null}
                    {committable ? (
                      <button
                        type="button"
                        className="button button--primary"
                        disabled={runner.busy}
                        data-action="commit-bundle"
                        onClick={() => {
                          setDone(null);
                          void runner
                            .run(p7Paths.commitConfigBundleImport(i.id), { method: "POST", ifMatch: i.version })
                            .then((r) => r && setDone("committed"));
                        }}
                      >
                        {t("transfer.bundle.commit")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
              <Section id="bundle-counts" title={t("transfer.bundle.countsTitle")}>
                <ImportCounts i={i} />
              </Section>
              <Section id="bundle-items" title={t("transfer.bundle.itemsTitle")}>
                <RegisterTable
                  id="p7-config-bundle-items"
                  caption={t("transfer.bundle.itemsTitle")}
                  rows={i.items}
                  columns={columns}
                  getRowId={(r) => r.id}
                  emptyTitle={t("transfer.bundle.itemsEmpty")}
                  pageSize={50}
                />
              </Section>
              <p>
                <Link className="link" to={BASE}>
                  {t("transfer.common.back")}
                </Link>
              </p>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
