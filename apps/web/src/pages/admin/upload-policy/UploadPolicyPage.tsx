// Administration > Security > Upload policy (T-DG6-FE-B; ADR-0052 §1; REQ-S13-011; D-195 Q4): the file types and the
// size limit of new evidence uploads in the caller's organization. getUploadPolicy (security.read or
// upload_policy.configure) shows the effective policy, the default one when no row exists ("isDefault"); putUploadPolicy
// (upload_policy.configure) saves it with If-Match: the row's version, or "0" to create it (IfMatchOrZero). A 409 shows
// the conflict and reloads; without the configure permission (the auditor, a security reader) the page is read-only.
// SVG may be uploaded but is never previewed; only PNG, JPEG and GIF are shown inline (ADR-0052 §2).
import {
  UPLOAD_POLICY_MAX_BYTES,
  UPLOAD_TYPES,
  uploadPolicyUpdate,
  type UploadPolicy,
  type UploadType,
} from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { p6Paths, useP6AdminRefresh, useUploadPolicy } from "../../../api/p6.ts";
import { useLocale } from "../../../app/locale.ts";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { Section } from "../../../components/Section.tsx";
import { QueryState } from "../../../components/States.tsx";
import { formatDateTime } from "../../../lib/format.ts";
import { Chip, useRunner, type Runner } from "../../automation/ui.tsx";
import {
  adminCrumbs,
  Fact,
  isValidReason,
  NotApprovalNote,
  ReadOnlyNote,
  ReasonField,
  useCan,
  useHomeOrganizationId,
  useSavedNotice,
  type SavedNotice,
} from "../security/shared.tsx";

const MIB = 1024 * 1024;
const MAX_MIB = Math.floor(UPLOAD_POLICY_MAX_BYTES / MIB);

/** Bytes as MiB for display, with up to two decimals (the server may hold a limit that is not whole MiB). */
export function mibText(bytes: number): string {
  const mib = bytes / MIB;
  return Number.isInteger(mib) ? String(mib) : mib.toFixed(2);
}

/** The form; the runner (and its one alert) lives in the page, so a 409 reload that remounts the form keeps it. */
function PolicyForm({ policy, runner, notice }: { policy: UploadPolicy; runner: Runner; notice: SavedNotice }) {
  const { t } = useTranslation();
  const [types, setTypes] = useState<UploadType[]>([...policy.allowedTypes]);
  const [maxMiB, setMaxMiB] = useState(mibText(policy.maxBytes));
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<{ types?: boolean; max?: boolean; reason?: boolean }>({});
  const { saved, setSaved } = notice;
  const toggle = (type: UploadType) =>
    setTypes((cur) => (cur.includes(type) ? cur.filter((x) => x !== type) : [...cur, type]));
  const submit = async () => {
    setSaved(false);
    const mib = Number(maxMiB);
    const next = {
      types: types.length === 0,
      max: !/^[0-9]+$/.test(maxMiB.trim()) || mib < 1 || mib > MAX_MIB,
      reason: !isValidReason(reason),
    };
    setInvalid(next);
    if (next.types || next.max || next.reason) return;
    const body = { allowedTypes: UPLOAD_TYPES.filter((x) => types.includes(x)), maxBytes: mib * MIB, reason };
    if (!uploadPolicyUpdate.safeParse(body).success) {
      setInvalid({ reason: true });
      return;
    }
    // putUploadPolicy: the organization is the required query parameter; If-Match "0" creates the row.
    const url = `${p6Paths.uploadPolicy}?organizationId=${encodeURIComponent(policy.organizationId)}`;
    const result = await runner.run<UploadPolicy>(url, {
      method: "PUT",
      body,
      ifMatch: policy.version,
    });
    if (result) {
      setReason("");
      setSaved(true);
    }
  };
  return (
    <form
      className="form"
      noValidate
      data-form="upload-policy"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {saved ? (
        <p className="banner banner--success" role="status" data-state="saved">
          <Icon name="check" /> {t("adminP6.common.saved")}
        </p>
      ) : null}
      <fieldset className={`field${invalid.types ? " field--invalid" : ""}`} aria-describedby="upload-types-hint">
        <legend className="field__label">
          {t("adminP6.uploadPolicy.allowedTypes")}
          <span className="field__required"> ({t("common.form.required")})</span>
        </legend>
        <p id="upload-types-hint" className="field__hint">
          {t("adminP6.uploadPolicy.allowedTypesHint")}
        </p>
        <div className="checkbox-grid">
          {UPLOAD_TYPES.map((type) => (
            <label key={type} className="checkbox">
              <input
                type="checkbox"
                name="allowedTypes"
                value={type}
                checked={types.includes(type)}
                onChange={() => toggle(type)}
              />{" "}
              {t(`adminP6.uploadPolicy.type.${type}`)}
            </label>
          ))}
        </div>
        {invalid.types ? (
          <p className="field__error">
            <Icon name="alert" /> {t("adminP6.uploadPolicy.typesRequired")}
          </p>
        ) : null}
      </fieldset>
      <div className={`field${invalid.max ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="upload-max-mib">
          {t("adminP6.uploadPolicy.maxMiB")}
          <span className="field__required"> ({t("common.form.required")})</span>
        </label>
        <p id="upload-max-mib-hint" className="field__hint">
          {t("adminP6.uploadPolicy.maxMiBHint")}
        </p>
        <input
          id="upload-max-mib"
          inputMode="numeric"
          dir="ltr"
          value={maxMiB}
          aria-required
          aria-invalid={invalid.max || undefined}
          aria-describedby={invalid.max ? "upload-max-mib-hint upload-max-mib-error" : "upload-max-mib-hint"}
          onChange={(e) => setMaxMiB(e.target.value)}
        />
        {invalid.max ? (
          <p id="upload-max-mib-error" className="field__error">
            <Icon name="alert" /> {t("adminP6.uploadPolicy.maxInvalid")}
          </p>
        ) : null}
      </div>
      <ReasonField id="upload-policy-reason" value={reason} onChange={setReason} invalid={Boolean(invalid.reason)} />
      <NotApprovalNote />
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={runner.busy}>
          {t("adminP6.common.save")}
        </button>
      </div>
    </form>
  );
}

export function UploadPolicyPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const title = t("nav.p6.uploadPolicy.title");
  usePageTitle(title);
  const organizationId = useHomeOrganizationId();
  const policy = useUploadPolicy<UploadPolicy>(organizationId);
  const canConfigure = useCan("upload_policy.configure");
  const refresh = useP6AdminRefresh("upload-policy", "audit");
  const runner = useRunner(refresh);
  const notice = useSavedNotice();
  return (
    <div className="page" data-p6-screen="upload-policy">
      <PageHeader
        title={title}
        subtitle={t("nav.p6.uploadPolicy.summary")}
        crumbs={adminCrumbs(t, { label: t("nav.p6.security.title"), to: "/admin/security" }, { label: title })}
      />
      <QueryState query={policy}>
        {(p) => (
          <>
            <section className="card" aria-labelledby="upload-policy-current" data-policy-default={p.isDefault}>
              <h2 id="upload-policy-current" className="card__title">
                {p.isDefault ? (
                  <Chip tone="neutral" icon="info" label={t("adminP6.uploadPolicy.isDefault")} data="default" />
                ) : (
                  <Chip tone="draft" icon="lock" label={t("adminP6.uploadPolicy.isSaved")} data="saved" />
                )}
              </h2>
              <dl className="workspace-header__grid">
                <Fact label={t("adminP6.uploadPolicy.allowedTypes")}>
                  <ul className="plain-list" data-list="allowed-types">
                    {p.allowedTypes.map((type) => (
                      <li key={type} data-type={type}>
                        {t(`adminP6.uploadPolicy.type.${type}`)}
                      </li>
                    ))}
                  </ul>
                </Fact>
                <Fact label={t("adminP6.uploadPolicy.currentLimit")}>
                  <span data-max-bytes={p.maxBytes}>
                    <bdi dir="ltr">{mibText(p.maxBytes)} MiB</bdi>
                  </span>
                </Fact>
                <Fact label={t("adminP6.uploadPolicy.inlinePreview")}>
                  {t("adminP6.uploadPolicy.inlinePreviewValue")}
                </Fact>
                <Fact label={t("adminP6.common.lastChanged")}>
                  {p.updatedAt ? formatDateTime(p.updatedAt, locale) : t("adminP6.common.neverChanged")}
                </Fact>
                {p.reason ? <Fact label={t("adminP6.common.reason")}>{p.reason}</Fact> : null}
                <Fact label={t("adminP6.common.version", { version: "" }).trim()}>
                  <bdi dir="ltr">{p.version}</bdi>
                </Fact>
              </dl>
              <p className="small muted">
                <Icon name="info" /> {t("adminP6.uploadPolicy.svgNote")}
              </p>
            </section>
            {canConfigure ? (
              <Section id="upload-policy-form" title={t("adminP6.uploadPolicy.formTitle")}>
                {runner.alert}
                <PolicyForm key={p.version} policy={p} runner={runner} notice={notice} />
              </Section>
            ) : (
              <ReadOnlyNote />
            )}
            <p className="small">
              <Link className="link" to="/admin/security">
                {t("nav.p6.security.title")}
              </Link>
            </p>
          </>
        )}
      </QueryState>
    </div>
  );
}
