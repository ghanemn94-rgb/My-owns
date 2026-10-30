// Administration > Integrations: create a connector, or edit its names and configuration (T-DG6-FE-C; ADR-0055 §1;
// REQ-S17-001 "Admins configure connectors in the UI"). connector.configure (ADM_TECH) only; everyone else gets the
// no-permission state, and the server decides anyway.
//  - A connector is created disabled at configuration version 1; a configuration change is a new version, and the
//    connector is "Not verified" again until a test run succeeds on it.
//  - Credentials are secret references (provider and name) that IT provisions; the form never asks for a value, and the
//    server refuses one (connector.secret_value_refused).
//  - Field mappings are edited on their own screen (they are a configuration version too); this form keeps them.
//  - One form-level alert; If-Match is the connector's version (409 shows the conflict and reloads it).
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { apiRequest, ApiError } from "../../api/client.ts";
import { useAllTransformations } from "../../api/queries.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction, useSessionNavigate } from "../../auth/sessionBound.ts";
import { Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { NoPermissionState, QueryState } from "../../components/States.tsx";
import { errorMessage, fieldErrorMessage } from "../../lib/problem.ts";
import { useSelectedOrganization } from "../admin/UsersPage.tsx";
import {
  CONNECTOR_ADAPTER_KINDS,
  CONNECTOR_CADENCES,
  integrationPaths,
  useConnector,
  useIntegrationsRefresh,
  type Connector,
  type ConnectorAdapterKind,
  type ConnectorCadence,
  type ConnectorConfigInput,
  type ConnectorTargetKind,
} from "./api.ts";

interface CredentialRow {
  key: string;
  provider: string;
  name: string;
}

export interface ConnectorFormValues {
  code: string;
  nameEn: string;
  nameAr: string;
  adapterKind: ConnectorAdapterKind;
  targetKind: ConnectorTargetKind;
  sourceSystemId: string;
  endpointUrl: string;
  credentials: CredentialRow[];
  targetTransformationId: string;
  cadence: ConnectorCadence;
  retryMaxAttempts: string;
  retryBackoffSeconds: string;
  commitMode: "manual" | "auto";
  commitOnBehalfOf: string;
  outboundStatusPush: boolean;
  reconciliationRule: "none" | "row_count" | "row_count_and_total";
  adapterMode: "healthy" | "failing" | "stopped";
  adapterConfirm: "immediate" | "never";
  reason: string;
}

type Errors = Partial<Record<keyof ConnectorFormValues | `credential.${number}`, string>>;

const blank = (): ConnectorFormValues => ({
  code: "",
  nameEn: "",
  nameAr: "",
  adapterKind: "test_adapter",
  targetKind: "kpi_actual",
  sourceSystemId: "",
  endpointUrl: "",
  credentials: [],
  targetTransformationId: "",
  cadence: "manual",
  retryMaxAttempts: "2",
  retryBackoffSeconds: "60",
  commitMode: "manual",
  commitOnBehalfOf: "",
  outboundStatusPush: false,
  reconciliationRule: "row_count",
  adapterMode: "healthy",
  adapterConfirm: "immediate",
  reason: "",
});

function fromConnector(c: Connector): ConnectorFormValues {
  const cfg = c.config;
  const mode = cfg.adapterSettings["mode"];
  const confirm = cfg.adapterSettings["confirm"];
  return {
    code: c.code,
    nameEn: c.nameEn,
    nameAr: c.nameAr,
    adapterKind: c.adapterKind,
    targetKind: c.targetKind,
    sourceSystemId: cfg.sourceSystemId,
    endpointUrl: cfg.endpointUrl ?? "",
    credentials: Object.entries(cfg.credentialRefs).map(([key, r]) => ({ key, provider: r.provider, name: r.name })),
    targetTransformationId: cfg.targetTransformationId ?? "",
    cadence: cfg.cadence,
    retryMaxAttempts: String(cfg.retryMaxAttempts),
    retryBackoffSeconds: String(cfg.retryBackoffSeconds),
    commitMode: cfg.commitMode,
    commitOnBehalfOf: cfg.commitOnBehalfOf ?? "",
    outboundStatusPush: cfg.outboundActions.includes("deliverable_status_push"),
    reconciliationRule: cfg.reconciliationRule,
    adapterMode: mode === "failing" || mode === "stopped" ? mode : "healthy",
    adapterConfirm: confirm === "never" ? "never" : "immediate",
    reason: "",
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configuration body from the form, or the field errors (problem codes or `integrations.form.*` keys). */
export function toConfig(
  v: ConnectorFormValues,
  keepSettings: Readonly<Record<string, unknown>> = {},
  keepMappings: ConnectorConfigInput["fieldMappings"] = [],
): { ok: true; config: ConnectorConfigInput } | { ok: false; errors: Errors } {
  const errors: Errors = {};
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(v.sourceSystemId.trim()))
    errors.sourceSystemId = "integrations.form.sourceSystemIdInvalid";
  if (v.adapterKind === "http_pull" && !/^https:\/\/\S{1,492}$/.test(v.endpointUrl.trim()))
    errors.endpointUrl = "integrations.form.httpsRequired";
  if (v.targetKind === "kpi_actual" && !UUID.test(v.targetTransformationId))
    errors.targetTransformationId = "validation.required";
  const attempts = /^\d$/.test(v.retryMaxAttempts.trim()) ? Number(v.retryMaxAttempts) : NaN;
  if (!(attempts >= 0 && attempts <= 5)) errors.retryMaxAttempts = "integrations.form.attemptsRange";
  const backoff = /^\d{2,4}$/.test(v.retryBackoffSeconds.trim()) ? Number(v.retryBackoffSeconds) : NaN;
  if (!(backoff >= 10 && backoff <= 3600)) errors.retryBackoffSeconds = "integrations.form.backoffRange";
  if (v.commitMode === "auto" && !UUID.test(v.commitOnBehalfOf.trim()))
    errors.commitOnBehalfOf = "integrations.form.userIdRequired";
  const credentialRefs: Record<string, { provider: string; name: string }> = {};
  v.credentials.forEach((row, i) => {
    const ok =
      /^[a-z][a-z0-9_]{0,31}$/.test(row.key) &&
      /^[a-z][a-z0-9_]{0,31}$/.test(row.provider) &&
      /^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/.test(row.name) &&
      !(row.key in credentialRefs);
    if (!ok) errors[`credential.${i}`] = "integrations.form.credentialInvalid";
    else credentialRefs[row.key] = { provider: row.provider, name: row.name };
  });
  if (v.reason.trim().length < 3) errors.reason = "admin.reason_required";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const adapterSettings: Record<string, unknown> =
    v.adapterKind === "test_adapter"
      ? { ...keepSettings, mode: v.adapterMode, confirm: v.adapterConfirm }
      : { ...keepSettings };
  return {
    ok: true,
    config: {
      sourceSystemId: v.sourceSystemId.trim(),
      endpointUrl: v.adapterKind === "http_pull" ? v.endpointUrl.trim() : null,
      credentialRefs,
      fieldMappings: [...keepMappings],
      targetTransformationId: v.targetKind === "kpi_actual" ? v.targetTransformationId : null,
      cadence: v.cadence,
      retryMaxAttempts: attempts,
      retryBackoffSeconds: backoff,
      commitMode: v.commitMode,
      commitOnBehalfOf: v.commitMode === "auto" ? v.commitOnBehalfOf.trim() : null,
      outboundActions: v.adapterKind === "test_adapter" && v.outboundStatusPush ? ["deliverable_status_push"] : [],
      reconciliationRule: v.reconciliationRule,
      adapterSettings,
      reason: v.reason,
    },
  };
}

export function ConnectorCreatePage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("integrations.connectors.new"));
  if (!canAnywhere(me, "connector.configure")) return <NoPermissionState />;
  return (
    <div className="page" data-p6-screen="integrations-connector-new">
      <PageHeader
        title={t("integrations.connectors.new")}
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("integrations.title"), to: "/admin/integrations" },
          { label: t("integrations.connectors.new") },
        ]}
      />
      <ConnectorForm connector={null} />
    </div>
  );
}

export function ConnectorEditPage() {
  const { t } = useTranslation();
  const me = useMe();
  const { connectorId = "" } = useParams();
  usePageTitle(t("integrations.connector.edit"));
  const q = useConnector(connectorId);
  if (!canAnywhere(me, "connector.configure")) return <NoPermissionState />;
  return (
    <div className="page" data-p6-screen="integrations-connector-edit">
      <PageHeader
        title={t("integrations.connector.edit")}
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("integrations.title"), to: "/admin/integrations" },
          {
            label: q.data?.code ?? t("integrations.connector.title"),
            to: `/admin/integrations/connectors/${connectorId}`,
          },
          { label: t("integrations.connector.edit") },
        ]}
      />
      <QueryState query={q}>{(c) => <ConnectorForm key={c.version} connector={c} />}</QueryState>
    </div>
  );
}

function ConnectorForm({ connector }: { connector: Connector | null }) {
  const { t } = useTranslation();
  const org = useSelectedOrganization();
  const begin = useSessionBoundAction();
  const cancelNavigate = useSessionNavigate();
  const refresh = useIntegrationsRefresh();
  const transformations = useAllTransformations({ sort: "updatedAt:desc" });
  const [values, setValues] = useState<ConnectorFormValues>(() => (connector ? fromConnector(connector) : blank()));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const editing = connector !== null;
  const set =
    <K extends keyof ConnectorFormValues>(key: K) =>
    (e: { target: { value: string } }) =>
      setValues((v) => ({ ...v, [key]: e.target.value as ConnectorFormValues[K] }));
  const errorText = (key: keyof Errors) => {
    const code = errors[key];
    if (!code) return undefined;
    return code.startsWith("integrations.") ? t(code) : fieldErrorMessage(t, code);
  };
  const setCredential = (i: number, patch: Partial<CredentialRow>) =>
    setValues((v) => ({ ...v, credentials: v.credentials.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errs: Errors = {};
    if (!editing && !/^[a-z][a-z0-9_-]{1,62}$/.test(values.code)) errs.code = "integrations.form.codeInvalid";
    if (values.nameEn.trim() === "") errs.nameEn = "validation.required";
    if (values.nameAr.trim() === "") errs.nameAr = "validation.required";
    const parsed = toConfig(
      values,
      connector
        ? Object.fromEntries(
            Object.entries(connector.config.adapterSettings).filter(([k]) => k !== "mode" && k !== "confirm"),
          )
        : {},
      connector ? [...connector.config.fieldMappings] : [],
    );
    if (!parsed.ok || Object.keys(errs).length > 0) {
      setErrors({ ...errs, ...(parsed.ok ? {} : parsed.errors) });
      return;
    }
    setErrors({});
    const action = begin();
    setBusy(true);
    try {
      const res = editing
        ? await apiRequest<Connector>(integrationPaths.connector(connector.id), {
            method: "PUT",
            body: { nameEn: values.nameEn.trim(), nameAr: values.nameAr.trim(), config: parsed.config },
            ifMatch: connector.version,
          })
        : await apiRequest<Connector>(integrationPaths.connectors, {
            method: "POST",
            body: {
              organizationId: org.organizationId,
              code: values.code,
              nameEn: values.nameEn.trim(),
              nameAr: values.nameAr.trim(),
              adapterKind: values.adapterKind,
              targetKind: values.targetKind,
              config: parsed.config,
            },
          });
      if (action.stale()) return;
      setBusy(false);
      await refresh();
      action.navigate(`/admin/integrations/connectors/${res.data.id}`);
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      setFormError(err);
      if (err instanceof ApiError && err.status === 409 && editing) await refresh();
    }
  };

  return (
    <section className="card" aria-labelledby="connector-form-h">
      <h2 id="connector-form-h" className="card__title">
        {editing ? t("integrations.connector.edit") : t("integrations.connectors.new")}
      </h2>
      <p className="small muted">{t("integrations.form.intro")}</p>
      <form className="stack" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy} data-connector-form>
        {formError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
          </p>
        ) : null}
        <Field
          label={t("integrations.field.code")}
          hint={editing ? t("integrations.form.fixedAfterCreate") : t("integrations.form.codeHint")}
          error={errorText("code")}
          required={!editing}
        >
          {(c) => (
            <input {...c} dir="ltr" value={values.code} maxLength={63} onChange={set("code")} disabled={editing} />
          )}
        </Field>
        <Field label={t("integrations.field.nameEn")} error={errorText("nameEn")} required>
          {(c) => <input {...c} dir="ltr" lang="en" value={values.nameEn} maxLength={200} onChange={set("nameEn")} />}
        </Field>
        <Field label={t("integrations.field.nameAr")} error={errorText("nameAr")} required>
          {(c) => <input {...c} dir="rtl" lang="ar" value={values.nameAr} maxLength={200} onChange={set("nameAr")} />}
        </Field>
        <Field
          label={t("integrations.field.adapterKind")}
          hint={editing ? t("integrations.form.fixedAfterCreate") : t("integrations.form.adapterHint")}
        >
          {(c) => (
            <select {...c} value={values.adapterKind} onChange={set("adapterKind")} disabled={editing}>
              {CONNECTOR_ADAPTER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`integrations.adapter.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("integrations.field.targetKind")}
          hint={editing ? t("integrations.form.fixedAfterCreate") : undefined}
        >
          {(c) => (
            <select {...c} value={values.targetKind} onChange={set("targetKind")} disabled={editing}>
              <option value="kpi_actual">{t("integrations.target.kpi_actual")}</option>
              <option value="none">{t("integrations.target.none")}</option>
            </select>
          )}
        </Field>
        <Field
          label={t("integrations.field.sourceSystemId")}
          hint={t("integrations.form.sourceSystemIdHint")}
          error={errorText("sourceSystemId")}
          required
        >
          {(c) => (
            <input {...c} dir="ltr" value={values.sourceSystemId} maxLength={200} onChange={set("sourceSystemId")} />
          )}
        </Field>
        {values.adapterKind === "http_pull" ? (
          <Field label={t("integrations.field.endpointUrl")} error={errorText("endpointUrl")} required>
            {(c) => (
              <input
                {...c}
                dir="ltr"
                type="url"
                value={values.endpointUrl}
                maxLength={500}
                onChange={set("endpointUrl")}
              />
            )}
          </Field>
        ) : null}
        {values.adapterKind === "test_adapter" ? (
          <>
            <Field label={t("integrations.field.adapterMode")} hint={t("integrations.form.adapterModeHint")}>
              {(c) => (
                <select {...c} value={values.adapterMode} onChange={set("adapterMode")}>
                  {(["healthy", "failing", "stopped"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`integrations.adapterMode.${m}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("integrations.field.adapterConfirm")} hint={t("integrations.form.adapterConfirmHint")}>
              {(c) => (
                <select {...c} value={values.adapterConfirm} onChange={set("adapterConfirm")}>
                  <option value="immediate">{t("integrations.adapterConfirm.immediate")}</option>
                  <option value="never">{t("integrations.adapterConfirm.never")}</option>
                </select>
              )}
            </Field>
          </>
        ) : null}
        {values.targetKind === "kpi_actual" ? (
          <Field
            label={t("integrations.field.targetTransformation")}
            error={errorText("targetTransformationId")}
            required
          >
            {(c) => (
              <select {...c} value={values.targetTransformationId} onChange={set("targetTransformationId")}>
                <option value="">{t("common.form.choose")}</option>
                {(transformations.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.code} · {x.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}
        <fieldset className="fieldset" data-credentials-editor>
          <legend>{t("integrations.credentials.title")}</legend>
          <p className="small muted">{t("integrations.credentials.hint")}</p>
          {values.credentials.map((row, i) => (
            <div className="integrations-credential" key={i}>
              <Field label={t("integrations.credentials.purpose")} error={errorText(`credential.${i}`)}>
                {(c) => (
                  <input
                    {...c}
                    dir="ltr"
                    value={row.key}
                    maxLength={32}
                    onChange={(e) => setCredential(i, { key: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("integrations.credentials.provider")}>
                {(c) => (
                  <input
                    {...c}
                    dir="ltr"
                    autoComplete="off"
                    value={row.provider}
                    maxLength={32}
                    onChange={(e) => setCredential(i, { provider: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("integrations.credentials.secretName")}>
                {(c) => (
                  <input
                    {...c}
                    dir="ltr"
                    autoComplete="off"
                    value={row.name}
                    maxLength={128}
                    onChange={(e) => setCredential(i, { name: e.target.value })}
                  />
                )}
              </Field>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setValues((v) => ({ ...v, credentials: v.credentials.filter((_, j) => j !== i) }))}
              >
                {t("integrations.credentials.remove")}
                <span className="visually-hidden">: {row.key}</span>
              </button>
            </div>
          ))}
          {values.credentials.length < 8 ? (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() =>
                setValues((v) => ({ ...v, credentials: [...v.credentials, { key: "", provider: "env", name: "" }] }))
              }
            >
              <Icon name="plus" /> {t("integrations.credentials.add")}
            </button>
          ) : null}
        </fieldset>
        <Field label={t("integrations.field.cadence")}>
          {(c) => (
            <select {...c} value={values.cadence} onChange={set("cadence")}>
              {CONNECTOR_CADENCES.map((k) => (
                <option key={k} value={k}>
                  {t(`integrations.cadence.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field
          label={t("integrations.field.retryMaxAttempts")}
          hint={t("integrations.form.attemptsRange")}
          error={errorText("retryMaxAttempts")}
          required
        >
          {(c) => (
            <input
              {...c}
              dir="ltr"
              inputMode="numeric"
              value={values.retryMaxAttempts}
              onChange={set("retryMaxAttempts")}
            />
          )}
        </Field>
        <Field
          label={t("integrations.field.retryBackoffSeconds")}
          hint={t("integrations.form.backoffRange")}
          error={errorText("retryBackoffSeconds")}
          required
        >
          {(c) => (
            <input
              {...c}
              dir="ltr"
              inputMode="numeric"
              value={values.retryBackoffSeconds}
              onChange={set("retryBackoffSeconds")}
            />
          )}
        </Field>
        <Field label={t("integrations.field.commitMode")} hint={t("integrations.form.commitModeHint")}>
          {(c) => (
            <select {...c} value={values.commitMode} onChange={set("commitMode")}>
              <option value="manual">{t("integrations.commitMode.manual")}</option>
              <option value="auto">{t("integrations.commitMode.auto")}</option>
            </select>
          )}
        </Field>
        {values.commitMode === "auto" ? (
          <Field
            label={t("integrations.field.commitOnBehalfOf")}
            hint={t("integrations.form.commitOnBehalfOfHint")}
            error={errorText("commitOnBehalfOf")}
            required
          >
            {(c) => (
              <input
                {...c}
                dir="ltr"
                value={values.commitOnBehalfOf}
                maxLength={36}
                onChange={set("commitOnBehalfOf")}
              />
            )}
          </Field>
        ) : null}
        <Field label={t("integrations.field.reconciliationRule")}>
          {(c) => (
            <select {...c} value={values.reconciliationRule} onChange={set("reconciliationRule")}>
              {(["none", "row_count", "row_count_and_total"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`integrations.reconciliationRule.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {values.adapterKind === "test_adapter" ? (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={values.outboundStatusPush}
              onChange={(e) => setValues((v) => ({ ...v, outboundStatusPush: e.target.checked }))}
            />
            {t("integrations.form.outboundStatusPush")}
          </label>
        ) : null}
        <Field
          label={t("integrations.field.reason")}
          hint={t("common.form.reasonHint")}
          error={errorText("reason")}
          required
        >
          {(c) => <textarea {...c} rows={3} value={values.reason} maxLength={1000} onChange={set("reason")} />}
        </Field>
        <div className="toolbar">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? t("integrations.form.saving") : t("integrations.form.save")}
          </button>
          <button
            type="button"
            className="button button--secondary"
            disabled={busy}
            onClick={() =>
              cancelNavigate(editing ? `/admin/integrations/connectors/${connector.id}` : "/admin/integrations")
            }
          >
            {t("integrations.form.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}
