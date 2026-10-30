// Administration > Storage (T-DG6-FE-B; ADR-0054 §2; REQ-S16-006; D-195 Q2, Q6). getStorageSetting shows the effective
// evidence store (the private file system by default; `source` says whether the server environment or a saved setting
// decides) and states that evidence is never served from a public URL (`publicUrls` is always false). A holder of
// storage.configure tests candidate values (testStorageSetting: write, read back, checksum, delete, anonymous read
// refused; no URL is ever returned) and saves them (putStorageSetting, If-Match the setting's version or "0"; the server
// answers 422 storage.test_required for object-store values that have not passed a test). Credentials are SecretRefs
// (a provider and a name), never values. A reader with operations.read only (the auditor) sees the page read-only.
// The live object store is Mobily IT's (a disclosed residual).
// Response types are written from docs/api/openapi.yaml 1.5.0-p6 (no zod mirror exists for slice C at this revision).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { p6Paths, useP6AdminRefresh, useStorageSetting } from "../../../api/p6.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { Section } from "../../../components/Section.tsx";
import { QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { StatusChip, useRunner, type Runner } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  Code,
  EMPTY_SECRET_REF,
  Fact,
  isValidReason,
  isValidSecretRef,
  NotApprovalNote,
  ReadOnlyNote,
  ReasonField,
  SecretRefFields,
  SecretRefNote,
  secretRefOrNull,
  useCan,
  type SecretRefValue,
  useSavedNotice,
  type SavedNotice,
} from "../security/shared.tsx";

interface SecretRef {
  readonly provider: string;
  readonly name: string;
}
export interface StorageS3 {
  readonly endpoint: string;
  readonly region: string;
  readonly bucket: string;
  readonly keyPrefix: string | null;
  readonly forcePathStyle: boolean;
  readonly accessKeyRef: SecretRef;
  readonly secretKeyRef: SecretRef;
}
export interface StorageSetting {
  readonly driver: "filesystem" | "s3";
  readonly source: "environment" | "setting";
  readonly s3: StorageS3 | null;
  readonly publicUrls: false;
  readonly reason: string | null;
  readonly version: number;
  readonly updatedAt: string | null;
}
export interface StorageTestResult {
  readonly outcome: "passed" | "failed";
  readonly driver: "filesystem" | "s3";
  readonly checks: readonly { readonly name: string; readonly outcome: "passed" | "failed" | "skipped" }[];
  readonly errorCode: string | null;
  readonly durationMs: number;
  readonly testedAt: string;
}

const OUTCOME_TABLE = {
  passed: ["good", "check"],
  failed: ["bad", "cross"],
  skipped: ["neutral", "dot"],
} as const;

const PATTERNS = {
  endpoint: /^https?:\/\/\S{1,292}$/,
  region: /^[a-z0-9][a-z0-9-]{0,62}$/,
  bucket: /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
  keyPrefix: /^[a-z0-9][a-z0-9_/-]{0,99}$/,
};

interface S3Form {
  endpoint: string;
  region: string;
  bucket: string;
  keyPrefix: string;
  forcePathStyle: boolean;
  accessKeyRef: SecretRefValue;
  secretKeyRef: SecretRefValue;
}
const toForm = (s3: StorageS3 | null): S3Form => ({
  endpoint: s3?.endpoint ?? "",
  region: s3?.region ?? "",
  bucket: s3?.bucket ?? "",
  keyPrefix: s3?.keyPrefix ?? "",
  forcePathStyle: s3?.forcePathStyle ?? false,
  accessKeyRef: s3 ? { ...s3.accessKeyRef } : EMPTY_SECRET_REF,
  secretKeyRef: s3 ? { ...s3.secretKeyRef } : EMPTY_SECRET_REF,
});
type S3Invalid = Partial<Record<keyof S3Form, boolean>>;
function checkS3(f: S3Form): S3Invalid {
  return {
    endpoint: !PATTERNS.endpoint.test(f.endpoint.trim()),
    region: !PATTERNS.region.test(f.region.trim()),
    bucket: !PATTERNS.bucket.test(f.bucket.trim()),
    keyPrefix: f.keyPrefix.trim() !== "" && !PATTERNS.keyPrefix.test(f.keyPrefix.trim()),
    accessKeyRef: !isValidSecretRef(f.accessKeyRef, true),
    secretKeyRef: !isValidSecretRef(f.secretKeyRef, true),
  };
}
const s3Body = (f: S3Form) => ({
  endpoint: f.endpoint.trim(),
  region: f.region.trim(),
  bucket: f.bucket.trim(),
  keyPrefix: f.keyPrefix.trim() || null,
  forcePathStyle: f.forcePathStyle,
  accessKeyRef: secretRefOrNull(f.accessKeyRef),
  secretKeyRef: secretRefOrNull(f.secretKeyRef),
});

export function TestResult({ r }: { r: StorageTestResult }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <section className="card" aria-labelledby="storage-test-result" data-test-outcome={r.outcome} role="status">
      <h3 id="storage-test-result" className="card__subtitle">
        {t("adminP6.storage.testTitle")}:{" "}
        <StatusChip value={r.outcome} table={OUTCOME_TABLE} labelKey="adminP6.storage.testOutcome" />
      </h3>
      <ul className="plain-list" data-list="storage-checks">
        {r.checks.map((c) => (
          <li key={c.name} data-check={c.name}>
            {t(`adminP6.storage.checkName.${c.name}`, { defaultValue: c.name })}:{" "}
            <StatusChip value={c.outcome} table={OUTCOME_TABLE} labelKey="adminP6.storage.checkOutcome" />
          </li>
        ))}
      </ul>
      <p className="small muted">
        {r.errorCode ? (
          <>
            <Code>{r.errorCode}</Code> ·{" "}
          </>
        ) : null}
        {t("adminP6.storage.duration")}: {t("adminP6.storage.milliseconds", { count: r.durationMs })} ·{" "}
        {formatDateTime(r.testedAt, locale)}
      </p>
    </section>
  );
}

function StorageForm({ setting, runner, notice }: { setting: StorageSetting; runner: Runner; notice: SavedNotice }) {
  const { t } = useTranslation();
  const [driver, setDriver] = useState<"filesystem" | "s3">(setting.driver);
  const [form, setForm] = useState<S3Form>(() => toForm(setting.s3));
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<S3Invalid & { reason?: boolean }>({});
  const [result, setResult] = useState<StorageTestResult | null>(null);
  const { saved, setSaved } = notice;
  const set = <K extends keyof S3Form>(k: K, v: S3Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setResult(null);
  };
  const s3Invalid = () => {
    const bad = driver === "s3" ? checkS3(form) : {};
    return { bad, any: Object.values(bad).some(Boolean) };
  };
  const test = async () => {
    setSaved(false);
    const { bad, any } = s3Invalid();
    setInvalid(bad);
    if (any) return;
    const r = await runner.run<StorageTestResult>(p6Paths.testStorageSetting, {
      body: { candidate: driver === "s3" ? s3Body(form) : null },
    });
    setResult(r);
  };
  const save = async () => {
    setSaved(false);
    const { bad, any } = s3Invalid();
    const badReason = !isValidReason(reason);
    setInvalid({ ...bad, reason: badReason });
    if (any || badReason) return;
    const r = await runner.run<StorageSetting>(p6Paths.storageSetting, {
      method: "PUT",
      body: { driver, s3: driver === "s3" ? s3Body(form) : null, reason },
      ifMatch: setting.version,
    });
    if (r) {
      setReason("");
      setSaved(true);
    }
  };
  const text = (k: "endpoint" | "region" | "bucket" | "keyPrefix", label: string, required: boolean) => (
    <div className={`field${invalid[k] ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`storage-${k}`}>
        {label}
        {required ? <span className="field__required"> ({t("common.form.required")})</span> : null}
      </label>
      <input
        id={`storage-${k}`}
        dir="ltr"
        autoComplete="off"
        value={form[k]}
        aria-required={required || undefined}
        aria-invalid={invalid[k] || undefined}
        aria-describedby={invalid[k] ? `storage-${k}-error` : undefined}
        onChange={(e) => set(k, e.target.value)}
      />
      {invalid[k] ? (
        <p id={`storage-${k}-error`} className="field__error">
          <Icon name="alert" /> {t("adminP6.storage.fieldInvalid")}
        </p>
      ) : null}
    </div>
  );
  return (
    <form
      className="form"
      noValidate
      data-form="storage-setting"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {saved ? (
        <p className="banner banner--success" role="status">
          <Icon name="check" /> {t("adminP6.common.saved")}
        </p>
      ) : null}
      <fieldset className="field">
        <legend className="field__label">{t("adminP6.storage.driver")}</legend>
        {(["filesystem", "s3"] as const).map((d) => (
          <label key={d} className="checkbox">
            <input
              type="radio"
              name="storage-driver"
              value={d}
              checked={driver === d}
              onChange={() => {
                setDriver(d);
                setResult(null);
              }}
            />{" "}
            {t(`adminP6.storage.driverValue.${d}`)}
          </label>
        ))}
      </fieldset>
      {driver === "s3" ? (
        <>
          <SecretRefNote />
          <div className="grid grid--2">
            {text("endpoint", t("adminP6.storage.endpoint"), true)}
            {text("region", t("adminP6.storage.region"), true)}
            {text("bucket", t("adminP6.storage.bucket"), true)}
            {text("keyPrefix", t("adminP6.storage.keyPrefix"), false)}
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.forcePathStyle}
              onChange={(e) => set("forcePathStyle", e.target.checked)}
            />{" "}
            {t("adminP6.storage.forcePathStyle")}
          </label>
          <div className="grid grid--2">
            <SecretRefFields
              id="storage-access-key"
              legend={t("adminP6.storage.accessKey")}
              value={form.accessKeyRef}
              onChange={(v) => set("accessKeyRef", v)}
              invalid={Boolean(invalid.accessKeyRef)}
            />
            <SecretRefFields
              id="storage-secret-key"
              legend={t("adminP6.storage.secretKey")}
              value={form.secretKeyRef}
              onChange={(v) => set("secretKeyRef", v)}
              invalid={Boolean(invalid.secretKeyRef)}
            />
          </div>
          <p className="small muted">
            <Icon name="info" /> {t("adminP6.storage.testRequired")}
          </p>
        </>
      ) : null}
      <div className="form__actions">
        <button
          type="button"
          className="button button--secondary"
          data-action="test-storage"
          disabled={runner.busy}
          onClick={() => void test()}
        >
          {runner.busy ? t("adminP6.storage.testing") : t("adminP6.storage.test")}
        </button>
      </div>
      {result ? <TestResult r={result} /> : null}
      <ReasonField id="storage-reason" value={reason} onChange={setReason} invalid={Boolean(invalid.reason)} />
      <p className="small muted">
        <Icon name="info" /> {t("adminP6.storage.earlierFiles")}
      </p>
      <NotApprovalNote />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy}>
          {t("adminP6.common.save")}
        </button>
      </div>
    </form>
  );
}

export function StoragePage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.storage.title");
  usePageTitle(title);
  const setting = useStorageSetting<StorageSetting>();
  // The read needs storage.configure or operations.read (the auditor reads); changes and tests need storage.configure.
  const canConfigure = useCan("storage.configure");
  const refresh = useP6AdminRefresh("storage", "audit");
  const runner = useRunner(refresh);
  const notice = useSavedNotice();
  return (
    <div className="page" data-p6-screen="storage">
      <PageHeader title={title} subtitle={t("nav.p6.storage.summary")} crumbs={adminCrumbs(t, { label: title })} />
      <QueryState query={setting}>
        {(s) => (
          <>
            <section className="card" aria-labelledby="storage-current" data-storage-driver={s.driver}>
              <h2 id="storage-current" className="card__title">
                {t("adminP6.storage.currentTitle")}
              </h2>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.storage.driver")}>{t(`adminP6.storage.driverValue.${s.driver}`)}</Fact>
                <Fact label={t("adminP6.storage.source")}>{t(`adminP6.storage.sourceValue.${s.source}`)}</Fact>
                <Fact label={t("adminP6.storage.publicUrls")}>
                  <span data-status="no-public-urls">
                    <Icon name="lock" /> {t("adminP6.storage.publicUrlsValue")}
                  </span>
                </Fact>
                {s.s3 ? (
                  <>
                    <Fact label={t("adminP6.storage.endpoint")}>
                      <Code>{s.s3.endpoint}</Code>
                    </Fact>
                    <Fact label={t("adminP6.storage.bucket")}>
                      <Code>
                        {s.s3.bucket}
                        {s.s3.keyPrefix ? `/${s.s3.keyPrefix}` : ""}
                      </Code>
                    </Fact>
                    <Fact label={t("adminP6.storage.accessKey")}>
                      <Code>
                        {s.s3.accessKeyRef.provider}:{s.s3.accessKeyRef.name}
                      </Code>
                    </Fact>
                    <Fact label={t("adminP6.storage.secretKey")}>
                      <Code>
                        {s.s3.secretKeyRef.provider}:{s.s3.secretKeyRef.name}
                      </Code>
                    </Fact>
                  </>
                ) : null}
                <Fact label={t("adminP6.common.lastChanged")}>
                  {s.updatedAt ? formatDateTime(s.updatedAt, locale) : t("adminP6.common.neverChanged")}
                </Fact>
                {s.reason ? <Fact label={t("adminP6.common.reason")}>{s.reason}</Fact> : null}
              </dl>
              <p className="small muted" data-state="residual">
                <Icon name="info" /> {t("adminP6.storage.residual")}
              </p>
            </section>
            {canConfigure ? (
              <Section id="storage-form" title={t("adminP6.storage.formTitle")}>
                {runner.alert}
                <StorageForm key={s.version} setting={s} runner={runner} notice={notice} />
              </Section>
            ) : (
              <ReadOnlyNote />
            )}
          </>
        )}
      </QueryState>
    </div>
  );
}
