// Administration > AI assistant (T-DG6-FE-E; p6-work-split §D.3; ADR-0059 §3, §10, §11; REQ-S17-009).
//  - Status: "Off (not configured)" with no saved row, "Off" or "On" from the server's `enabled`; never "On" by guess,
//    and an unreadable setting is the no-permission or error state, never a status.
//  - The fixed statements of ADR-0059 §3: telemetry is off (no client exists), and the authorization reference is
//    recorded as entered and not checked with IT. The HTTP endpoint is the one IT provides; nothing here calls it live.
//  - ADM_TECH (assistant.configure) edits the setting (If-Match: 0 creates the row DISABLED), and turns the assistant on
//    or off with a reason. While on, the provider, endpoint, API style, model, credential and authorization reference
//    are locked (the server refuses with assistant.locked_while_enabled; the form disables them and says why).
//  - Holders of operations.read only (TO, KDS, TD, AUD) see the setting read-only, with no write control.
//  - One form-level alert per form; every write belongs to the session its click started under.
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest, ApiError } from "../../../api/client.ts";
import { useLocale } from "../../../app/locale.ts";
import { canAnywhere } from "../../../auth/permissions.ts";
import { useMe } from "../../../auth/session.tsx";
import { beginSessionGuard } from "../../../auth/sessionBound.ts";
import { Field } from "../../../components/Form.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../../components/Page.tsx";
import { ReasonDialog } from "../../../components/ReasonDialog.tsx";
import { QueryState } from "../../../components/States.tsx";
import "../../../components/assistant/assistant.css";
import {
  assistantKeys,
  assistantPaths,
  useAssistantSetting,
  type AssistantProviderKind,
  type AssistantSetting,
  type AssistantSettingUpdate,
} from "../../../components/assistant/api.ts";
import { formatDateTime } from "../../../lib/format.ts";
import { errorMessage, fieldErrorMessage } from "../../../lib/problem.ts";

const LIMITS = {
  requestTimeoutMs: [1000, 120000],
  maxOutputTokens: [64, 8192],
  maxContextRecords: [1, 20],
} as const;
type LimitKey = keyof typeof LIMITS;

export function AssistantSettingsPage() {
  const { t } = useTranslation();
  usePageTitle(t("assistant.admin.title"));
  const q = useAssistantSetting();
  return (
    <div className="page" data-page="admin-assistant">
      <PageHeader
        title={t("assistant.admin.title")}
        subtitle={t("assistant.admin.subtitle")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("assistant.admin.title") }]}
      />
      <QueryState query={q}>{(setting) => <SettingView setting={setting} />}</QueryState>
    </div>
  );
}

function statusText(t: (k: string) => string, s: AssistantSetting): string {
  if (!s.configured) return t("assistant.admin.statusNotConfigured");
  return s.enabled ? t("assistant.admin.statusOn") : t("assistant.admin.statusOff");
}

function SettingView({ setting }: { setting: AssistantSetting }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const canConfigure = canAnywhere(me, "assistant.configure");
  const [editing, setEditing] = useState(false);
  const [toggle, setToggle] = useState<"enable" | "disable" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: assistantKeys.all });
  const notSet = t("assistant.admin.notSet");
  const value = (v: string | number | null) => (v === null || v === "" ? notSet : String(v));

  const runToggle = async (kind: "enable" | "disable", reason: string) => {
    const action = beginSessionGuard();
    await apiRequest<AssistantSetting>(kind === "enable" ? assistantPaths.enable : assistantPaths.disable, {
      method: "POST",
      body: { reason },
      ifMatch: setting.version,
    });
    if (action.stale()) return;
    setToggle(null);
    setNotice(t(kind === "enable" ? "assistant.admin.turnedOn" : "assistant.admin.turnedOff"));
    await refresh();
  };

  return (
    <>
      <section className="card" aria-labelledby="assistant-status-h">
        <h2 id="assistant-status-h">{t("assistant.admin.status")}</h2>
        <p data-assistant-status={!setting.configured ? "not-configured" : setting.enabled ? "on" : "off"}>
          <span className={`badge${setting.enabled ? "" : " badge--provisional"}`}>
            <Icon name={setting.enabled ? "check" : "pause"} /> {statusText(t, setting)}
          </span>
          {setting.enabled && setting.enabledAt ? (
            <span className="small muted">
              {" "}
              {t("assistant.admin.enabledSince", { date: formatDateTime(setting.enabledAt, locale) })}
            </span>
          ) : null}
        </p>
        <p data-telemetry>{t("assistant.admin.telemetry")}</p>
        <p className="small muted">{t("assistant.admin.noLiveClaim")}</p>
        {notice ? (
          <p className="banner banner--success" role="status">
            <Icon name="check" /> <span>{notice}</span>
          </p>
        ) : null}
        {canConfigure ? (
          <div className="assistant-admin__actions">
            {!editing ? (
              <button type="button" className="button button--secondary" onClick={() => setEditing(true)}>
                <Icon name="pencil" /> {t("assistant.admin.edit")}
              </button>
            ) : null}
            {setting.configured && !setting.enabled ? (
              <button type="button" className="button button--primary" onClick={() => setToggle("enable")}>
                {t("assistant.admin.enable")}
              </button>
            ) : null}
            {setting.configured && setting.enabled ? (
              <button type="button" className="button button--danger" onClick={() => setToggle("disable")}>
                {t("assistant.admin.disable")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="banner banner--info" data-read-only>
            <Icon name="lock" /> <span>{t("assistant.admin.readOnly")}</span>
          </p>
        )}
      </section>

      {editing && canConfigure ? (
        <SettingForm
          setting={setting}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            setNotice(t(setting.enabled ? "assistant.admin.savedEnabled" : "assistant.admin.saved"));
            await refresh();
          }}
          onConflict={refresh}
        />
      ) : (
        <section className="card" aria-labelledby="assistant-settings-h">
          <h2 id="assistant-settings-h">{t("assistant.admin.settings")}</h2>
          <dl className="assistant-admin__facts">
            <dt>{t("assistant.admin.field.providerKind")}</dt>
            <dd>{t(`assistant.admin.provider.${setting.providerKind ?? "none"}`)}</dd>
            <dt>{t("assistant.admin.field.endpointUrl")}</dt>
            <dd dir="ltr">{value(setting.endpointUrl)}</dd>
            <dt>{t("assistant.admin.field.apiStyle")}</dt>
            <dd>{t(`assistant.admin.apiStyleValue.${setting.apiStyle ?? "none"}`)}</dd>
            <dt>{t("assistant.admin.field.modelName")}</dt>
            <dd dir="ltr">{value(setting.modelName)}</dd>
            <dt>{t("assistant.admin.field.credentialProvider")}</dt>
            <dd dir="ltr">
              {setting.credentialRef ? setting.credentialRef.provider : t("assistant.admin.credentialNone")}
            </dd>
            <dt>{t("assistant.admin.field.credentialName")}</dt>
            <dd dir="ltr">
              {setting.credentialRef ? setting.credentialRef.name : t("assistant.admin.credentialNone")}
            </dd>
            <dt>{t("assistant.admin.field.authorizationReference")}</dt>
            <dd>
              {value(setting.authorizationReference)}
              <p className="small muted" data-authorization-limit>
                {t("assistant.admin.authorizationLimit")}
              </p>
            </dd>
            <dt>{t("assistant.admin.field.requestTimeoutMs")}</dt>
            <dd>{setting.requestTimeoutMs}</dd>
            <dt>{t("assistant.admin.field.maxOutputTokens")}</dt>
            <dd>{setting.maxOutputTokens}</dd>
            <dt>{t("assistant.admin.field.maxContextRecords")}</dt>
            <dd>{setting.maxContextRecords}</dd>
            <dt>{t("assistant.admin.field.version")}</dt>
            <dd>{setting.version}</dd>
            <dt>{t("assistant.admin.field.updatedAt")}</dt>
            <dd>{setting.updatedAt ? formatDateTime(setting.updatedAt, locale) : notSet}</dd>
          </dl>
        </section>
      )}

      {toggle ? (
        <ReasonDialog
          title={t(toggle === "enable" ? "assistant.admin.enableTitle" : "assistant.admin.disableTitle")}
          description={t(toggle === "enable" ? "assistant.admin.enableBody" : "assistant.admin.disableBody")}
          confirmLabel={t(toggle === "enable" ? "assistant.admin.enable" : "assistant.admin.disable")}
          onConfirm={(reason) => runToggle(toggle, reason)}
          onClose={() => setToggle(null)}
        />
      ) : null}
    </>
  );
}

interface FormValues {
  providerKind: "" | AssistantProviderKind;
  endpointUrl: string;
  apiStyle: "" | "openai_chat_completions";
  modelName: string;
  credentialProvider: string;
  credentialName: string;
  authorizationReference: string;
  requestTimeoutMs: string;
  maxOutputTokens: string;
  maxContextRecords: string;
  reason: string;
}

function initialValues(s: AssistantSetting): FormValues {
  return {
    providerKind: s.providerKind ?? "",
    endpointUrl: s.endpointUrl ?? "",
    apiStyle: s.apiStyle ?? "",
    modelName: s.modelName ?? "",
    credentialProvider: s.credentialRef?.provider ?? "",
    credentialName: s.credentialRef?.name ?? "",
    authorizationReference: s.authorizationReference ?? "",
    requestTimeoutMs: String(s.requestTimeoutMs),
    maxOutputTokens: String(s.maxOutputTokens),
    maxContextRecords: String(s.maxContextRecords),
    reason: "",
  };
}

const orNull = (v: string): string | null => (v.trim() === "" ? null : v);

/** The request body from the form, or the field errors (as problem codes or ready texts). */
export function toUpdate(
  v: FormValues,
): { ok: true; body: AssistantSettingUpdate } | { ok: false; errors: Partial<Record<keyof FormValues, string>> } {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  const ints = {} as Record<LimitKey, number>;
  for (const key of Object.keys(LIMITS) as LimitKey[]) {
    const [min, max] = LIMITS[key];
    const n = /^\d{1,6}$/.test(v[key].trim()) ? Number(v[key].trim()) : Number.NaN;
    if (!Number.isInteger(n) || n < min || n > max) errors[key] = `range:${min}:${max}`;
    else ints[key] = n;
  }
  const cp = v.credentialProvider.trim();
  const cn = v.credentialName.trim();
  if ((cp === "") !== (cn === "")) errors.credentialName = "credentialPair";
  if (v.reason.trim().length < 3) errors.reason = "admin.reason_required";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      providerKind: v.providerKind === "" ? null : v.providerKind,
      endpointUrl: orNull(v.endpointUrl),
      apiStyle: v.apiStyle === "" ? null : v.apiStyle,
      modelName: orNull(v.modelName),
      credentialRef: cp === "" ? null : { provider: cp, name: cn },
      authorizationReference: orNull(v.authorizationReference),
      requestTimeoutMs: ints.requestTimeoutMs,
      maxOutputTokens: ints.maxOutputTokens,
      maxContextRecords: ints.maxContextRecords,
      reason: v.reason,
    },
  };
}

/** The JSON pointer of a server field error -> the form field. */
const POINTER_FIELD: Readonly<Record<string, keyof FormValues>> = {
  "/providerKind": "providerKind",
  "/endpointUrl": "endpointUrl",
  "/apiStyle": "apiStyle",
  "/modelName": "modelName",
  "/credentialRef": "credentialName",
  "/credentialRef/provider": "credentialProvider",
  "/credentialRef/name": "credentialName",
  "/authorizationReference": "authorizationReference",
  "/requestTimeoutMs": "requestTimeoutMs",
  "/maxOutputTokens": "maxOutputTokens",
  "/maxContextRecords": "maxContextRecords",
  "/reason": "reason",
};

function SettingForm({
  setting,
  onCancel,
  onSaved,
  onConflict,
}: {
  setting: AssistantSetting;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<FormValues>(() => initialValues(setting));
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [formError, setFormError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const locked = setting.enabled;
  const set = (key: keyof FormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));
  const errorText = (key: keyof FormValues): string | undefined => {
    const code = errors[key];
    if (!code) return undefined;
    if (code.startsWith("range:")) {
      const [, min, max] = code.split(":");
      return t("assistant.admin.rangeError", { min, max });
    }
    if (code === "credentialPair") return t("assistant.admin.credentialPairError");
    return fieldErrorMessage(t, code);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = toUpdate(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await apiRequest<AssistantSetting>(assistantPaths.setting, {
        method: "PUT",
        body: parsed.body,
        ifMatch: setting.version,
      });
      if (action.stale()) return;
      setBusy(false);
      await onSaved();
    } catch (err) {
      if (action.stale(err)) return;
      setBusy(false);
      const fieldErrors: Partial<Record<keyof FormValues, string>> = {};
      if (err instanceof ApiError)
        for (const fe of err.fieldErrors) {
          const field = POINTER_FIELD[fe.pointer];
          if (field && !fieldErrors[field]) fieldErrors[field] = fe.code;
        }
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length === 0 || !(err instanceof ApiError) || err.status !== 400) setFormError(err);
      // A stale version: load the current setting; the typed values stay so the administrator can review them.
      if (err instanceof ApiError && err.status === 409) await onConflict();
    }
  };

  const lockHint = locked ? t("assistant.admin.lockedField") : undefined;
  return (
    <section className="card" aria-labelledby="assistant-form-h">
      <h2 id="assistant-form-h">{t("assistant.admin.edit")}</h2>
      <form className="assistant-admin__form" onSubmit={(e) => void submit(e)} noValidate aria-busy={busy}>
        {formError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> <span>{errorMessage(t, formError)}</span>
          </p>
        ) : null}
        {locked ? (
          <p className="banner banner--info">
            <Icon name="lock" /> <span>{t("assistant.admin.lockedNote")}</span>
          </p>
        ) : null}
        <Field label={t("assistant.admin.field.providerKind")} hint={lockHint} error={errorText("providerKind")}>
          {(c) => (
            <select {...c} value={values.providerKind} onChange={set("providerKind")} disabled={locked}>
              <option value="">{t("assistant.admin.provider.none")}</option>
              <option value="http_endpoint">{t("assistant.admin.provider.http_endpoint")}</option>
              <option value="test_adapter">{t("assistant.admin.provider.test_adapter")}</option>
            </select>
          )}
        </Field>
        <Field
          label={t("assistant.admin.field.endpointUrl")}
          hint={lockHint ?? t("assistant.admin.field.endpointHint")}
          error={errorText("endpointUrl")}
        >
          {(c) => (
            <input
              {...c}
              dir="ltr"
              type="url"
              value={values.endpointUrl}
              maxLength={2048}
              onChange={set("endpointUrl")}
              disabled={locked}
            />
          )}
        </Field>
        <Field label={t("assistant.admin.field.apiStyle")} hint={lockHint} error={errorText("apiStyle")}>
          {(c) => (
            <select {...c} value={values.apiStyle} onChange={set("apiStyle")} disabled={locked}>
              <option value="">{t("assistant.admin.apiStyleValue.none")}</option>
              <option value="openai_chat_completions">
                {t("assistant.admin.apiStyleValue.openai_chat_completions")}
              </option>
            </select>
          )}
        </Field>
        <Field label={t("assistant.admin.field.modelName")} hint={lockHint} error={errorText("modelName")}>
          {(c) => (
            <input
              {...c}
              dir="ltr"
              value={values.modelName}
              maxLength={200}
              onChange={set("modelName")}
              disabled={locked}
            />
          )}
        </Field>
        <Field
          label={t("assistant.admin.field.credentialProvider")}
          hint={lockHint ?? t("assistant.admin.field.credentialHint")}
          error={errorText("credentialProvider")}
        >
          {(c) => (
            <input
              {...c}
              dir="ltr"
              autoComplete="off"
              value={values.credentialProvider}
              maxLength={32}
              onChange={set("credentialProvider")}
              disabled={locked}
            />
          )}
        </Field>
        <Field label={t("assistant.admin.field.credentialName")} hint={lockHint} error={errorText("credentialName")}>
          {(c) => (
            <input
              {...c}
              dir="ltr"
              autoComplete="off"
              value={values.credentialName}
              maxLength={128}
              onChange={set("credentialName")}
              disabled={locked}
            />
          )}
        </Field>
        <Field
          label={t("assistant.admin.field.authorizationReference")}
          hint={
            lockHint ?? `${t("assistant.admin.field.authorizationHint")} ${t("assistant.admin.authorizationLimit")}`
          }
          error={errorText("authorizationReference")}
        >
          {(c) => (
            <input
              {...c}
              value={values.authorizationReference}
              maxLength={200}
              onChange={set("authorizationReference")}
              disabled={locked}
            />
          )}
        </Field>
        {(Object.keys(LIMITS) as LimitKey[]).map((key) => (
          <Field
            key={key}
            label={t(`assistant.admin.field.${key}`)}
            hint={t("assistant.admin.rangeError", { min: LIMITS[key][0], max: LIMITS[key][1] })}
            error={errorText(key)}
            required
          >
            {(c) => <input {...c} inputMode="numeric" dir="ltr" value={values[key]} onChange={set(key)} />}
          </Field>
        ))}
        <Field
          label={t("assistant.admin.field.reason")}
          hint={t("common.form.reasonHint")}
          error={errorText("reason")}
          required
        >
          {(c) => <textarea {...c} rows={3} value={values.reason} maxLength={1000} onChange={set("reason")} />}
        </Field>
        <div className="assistant-admin__actions">
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? t("assistant.admin.saving") : t("assistant.admin.save")}
          </button>
          <button type="button" className="button button--secondary" onClick={onCancel} disabled={busy}>
            {t("assistant.admin.cancel")}
          </button>
        </div>
      </form>
    </section>
  );
}
