// Create a transformation (REQ-PB-003): business unit, name, mode (End-to-End or Modular) and, for Modular, the
// entry phase and optional standalone deliverable. Validated with the shared `transformationCreate` schema; the
// Idempotency-Key is generated once per form so a retried submission never creates a duplicate.
import { useQueryClient } from "@tanstack/react-query";
import { PHASES, STANDALONE_DELIVERABLE_TYPES } from "@mth/shared";
import { transformationCreate } from "@mth/shared/schemas";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ApiError, api, newIdempotencyKey } from "../../api/client.ts";
import { useAllUsers } from "../../api/queries.ts";
import type { Transformation } from "../../api/types.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { ancestryOf, canAnywhere, canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Field, payloadResolver } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { LoadingState, NoPermissionState } from "../../components/States.tsx";
import { errorMessage, fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { useBusinessUnitIndex } from "./common.tsx";

export interface CreateFormValues {
  businessUnitId: string;
  name: string;
  code: string;
  description: string;
  mode: "end_to_end" | "modular";
  entryPhase: string;
  standaloneDeliverableType: string;
  sponsorUserId: string;
  leadUserId: string;
  timezone: string;
  currency: string;
}

/** Form values -> API payload: trims, drops empty optionals, and drops Modular-only fields for End-to-End. */
export function toCreatePayload(v: CreateFormValues): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: keyof CreateFormValues, value: string) => {
    const trimmed = value.trim();
    if (trimmed) out[key] = trimmed;
  };
  put("businessUnitId", v.businessUnitId);
  put("name", v.name);
  put("code", v.code.toUpperCase());
  put("description", v.description);
  out["mode"] = v.mode;
  if (v.mode === "modular") {
    put("entryPhase", v.entryPhase);
    put("standaloneDeliverableType", v.standaloneDeliverableType);
  }
  put("sponsorUserId", v.sponsorUserId);
  put("leadUserId", v.leadUserId);
  put("timezone", v.timezone);
  put("currency", v.currency.toUpperCase());
  return out;
}

export function TransformationCreatePage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  usePageTitle(t("transformations.createTitle"));
  const bu = useBusinessUnitIndex();
  const canReadUsers = canAnywhere(me, "user.read");
  const users = useAllUsers(me.organization.id, canReadUsers);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [serverError, setServerError] = useState<unknown>(null);

  const form = useForm<CreateFormValues>({
    defaultValues: {
      businessUnitId: "",
      name: "",
      code: "",
      description: "",
      mode: "end_to_end",
      entryPhase: "",
      standaloneDeliverableType: "",
      sponsorUserId: "",
      leadUserId: "",
      timezone: "",
      currency: "",
    },
    resolver: payloadResolver(transformationCreate, toCreatePayload),
  });
  const { register, handleSubmit, watch, formState, setError } = form;
  const mode = watch("mode");
  const err = (field: keyof CreateFormValues) => {
    const e = formState.errors[field];
    return e?.message ? fieldErrorMessage(t, e.message) : undefined;
  };

  const allowedUnits = bu.units.filter(
    (u) =>
      u.status === "active" &&
      canOn(me, "transformation.create", {
        level: "business_unit",
        organizationId: u.organizationId,
        businessUnitId: u.id,
        businessUnitAncestry: ancestryOf(u.id, bu.units),
      }),
  );

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const created = await api.send<Transformation>("/api/v1/transformations", {
        method: "POST",
        body: toCreatePayload(values),
        idempotencyKey,
      });
      queryClient.setQueryData(["transformation", created.id], created);
      await queryClient.invalidateQueries({ queryKey: ["transformations"] });
      void navigate(`/transformations/${created.id}`, { state: { created: true } });
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors.length > 0) {
        for (const fe of e.fieldErrors) {
          const field = pointerToField(fe.pointer) as keyof CreateFormValues;
          if (field) setError(field, { type: "server", message: fe.code });
        }
      }
      if (e instanceof ApiError && e.status === 409 && e.code?.startsWith("duplicate")) {
        setError("code", { type: "server", message: "duplicate.code" });
      }
      setServerError(e);
    }
  });

  if (!canAnywhere(me, "transformation.create")) return <NoPermissionState />;

  const userOptions = canReadUsers
    ? (users.data ?? []).filter((u) => u.status === "active").map((u) => ({ id: u.id, label: u.displayName }))
    : [{ id: me.user.id, label: t("transformations.form.me", { name: me.user.displayName }) }];

  return (
    <div className="page">
      <PageHeader
        title={t("transformations.createTitle")}
        crumbs={[
          { label: t("transformations.listTitle"), to: "/transformations" },
          { label: t("transformations.createTitle") },
        ]}
      />
      {!bu.loaded ? (
        <LoadingState />
      ) : (
        <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate>
          {serverError ? (
            <p className="banner banner--error" role="alert">
              <Icon name="alert" /> {errorMessage(t, serverError)}
            </p>
          ) : null}
          <p className="muted">{t("transformations.form.draftNote")}</p>

          <Field label={t("transformations.field.businessUnit")} error={err("businessUnitId")} required>
            {(c) => (
              <select {...c} {...register("businessUnitId")}>
                <option value="">{t("common.form.choose")}</option>
                {allowedUnits.map((u) => (
                  <option key={u.id} value={u.id}>
                    {localName(u, locale)} ({u.code})
                  </option>
                ))}
              </select>
            )}
          </Field>
          {allowedUnits.length === 0 ? <p className="field__hint">{t("transformations.form.noUnits")}</p> : null}

          <Field label={t("transformations.field.name")} error={err("name")} required>
            {(c) => <input {...c} {...register("name")} maxLength={200} autoComplete="off" />}
          </Field>
          <Field label={t("transformations.field.code")} hint={t("transformations.form.codeHint")} error={err("code")}>
            {(c) => <input {...c} {...register("code")} dir="ltr" maxLength={32} autoComplete="off" />}
          </Field>
          <Field label={t("transformations.field.description")} error={err("description")}>
            {(c) => <textarea {...c} {...register("description")} rows={3} maxLength={4000} />}
          </Field>

          <fieldset className="field field--group">
            <legend className="field__label">
              {t("transformations.field.mode")} <span className="field__required">({t("common.form.required")})</span>
            </legend>
            {(["end_to_end", "modular"] as const).map((m) => (
              <label key={m} className="radio-card">
                <input type="radio" value={m} {...register("mode")} />
                <span>
                  <strong>{t(`transformations.mode.${m}`)}</strong>
                  <span className="muted small block">{t(`transformations.form.modeHelp.${m}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === "modular" ? (
            <>
              <Field
                label={t("transformations.field.entryPhase")}
                hint={t("transformations.form.entryPhaseHint")}
                error={err("entryPhase")}
                required
              >
                {(c) => (
                  <select {...c} {...register("entryPhase")}>
                    <option value="">{t("common.form.choose")}</option>
                    {PHASES.map((p) => (
                      <option key={p} value={p}>
                        {t(`transformations.phase.${p}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                label={t("transformations.field.standaloneDeliverable")}
                hint={t("transformations.form.deliverableHint")}
                error={err("standaloneDeliverableType")}
              >
                {(c) => (
                  <select {...c} {...register("standaloneDeliverableType")}>
                    <option value="">{t("common.value.none")}</option>
                    {STANDALONE_DELIVERABLE_TYPES.map((d) => (
                      <option key={d} value={d}>
                        {t(`transformations.deliverable.${d}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </>
          ) : null}

          <div className="grid grid--2">
            <Field label={t("transformations.field.sponsor")} error={err("sponsorUserId")}>
              {(c) => (
                <select {...c} {...register("sponsorUserId")}>
                  <option value="">{t("common.value.notAssigned")}</option>
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("transformations.field.lead")} error={err("leadUserId")}>
              {(c) => (
                <select {...c} {...register("leadUserId")}>
                  <option value="">{t("common.value.notAssigned")}</option>
                  {userOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          {!canReadUsers ? <p className="field__hint">{t("transformations.form.ownersHint")}</p> : null}

          <div className="grid grid--2">
            <Field
              label={t("common.field.timezone")}
              hint={t("transformations.form.defaultHint", { value: me.organization.defaultTimezone })}
              error={err("timezone")}
            >
              {(c) => (
                <input {...c} {...register("timezone")} dir="ltr" placeholder={me.organization.defaultTimezone} />
              )}
            </Field>
            <Field
              label={t("common.field.currency")}
              hint={t("transformations.form.defaultHint", { value: me.organization.defaultCurrency })}
              error={err("currency")}
            >
              {(c) => (
                <input
                  {...c}
                  {...register("currency")}
                  dir="ltr"
                  maxLength={3}
                  placeholder={me.organization.defaultCurrency}
                />
              )}
            </Field>
          </div>

          <div className="form__actions">
            <button type="submit" className="button button--primary" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? t("common.state.saving") : t("transformations.form.create")}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void navigate("/transformations")}
            >
              {t("common.action.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
