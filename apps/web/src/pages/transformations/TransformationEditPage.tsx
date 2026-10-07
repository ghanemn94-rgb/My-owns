// Edit a transformation with optimistic concurrency (REQ-S16-026, A14). Only changed fields are sent, with If-Match
// set to the version the form was loaded from. A 409 writes nothing: the user sees their unsaved values next to the
// latest saved values and can re-apply their change on the latest version, or discard it.
import { useQueryClient } from "@tanstack/react-query";
import { TRANSFORMATION_STATUS_TRANSITIONS, type TransformationStatus } from "@mth/shared";
import { transformationUpdate } from "@mth/shared/schemas";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { api, ApiError, isSessionChangedError } from "../../api/client.ts";
import { keys, useAllUsers, useTransformation } from "../../api/queries.ts";
import type { Transformation } from "../../api/types.ts";
import { canAnywhere, canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { Field, payloadResolver } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { ConflictPanel, NoPermissionState, QueryState, type ConflictRow } from "../../components/States.tsx";
import { errorMessage, fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { useTransformationTarget } from "./TransformationDetailPage.tsx";

export interface EditFormValues {
  name: string;
  description: string;
  status: TransformationStatus;
  sponsorUserId: string;
  leadUserId: string;
  timezone: string;
  currency: string;
}

export function formValuesOf(tr: Transformation): EditFormValues {
  return {
    name: tr.name,
    description: tr.description ?? "",
    status: tr.status,
    sponsorUserId: tr.sponsorUserId ?? "",
    leadUserId: tr.leadUserId ?? "",
    timezone: tr.timezone,
    currency: tr.currency,
  };
}

/** Only the fields that differ from `base`, in API form (empty optional text -> null). */
export function changedFields(base: EditFormValues, values: EditFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const norm = (k: keyof EditFormValues, v: string): unknown => {
    const s = v.trim();
    if (k === "description" || k === "sponsorUserId" || k === "leadUserId") return s === "" ? null : s;
    if (k === "currency") return s.toUpperCase();
    return s;
  };
  for (const k of Object.keys(values) as (keyof EditFormValues)[]) {
    const a = norm(k, base[k]);
    const b = norm(k, values[k]);
    if (a !== b) out[k] = b;
  }
  return out;
}

/**
 * Target statuses the API refuses as a status edit in P1 (F-DG1-001). Mirrors `GOVERNED_TARGET_STATUSES` in
 * apps/api/src/modules/transformations/routes.ts: `→closed` returns 422 `invalid-transition`, because closing a
 * transformation is governed by the G6 (Sustain) business approval, which arrives in P2+. The web must not offer a
 * transition the API refuses. TODO(P2): lift this shared source of truth into `@mth/shared` and import it here.
 */
export const P1_GOVERNED_STATUSES: readonly TransformationStatus[] = ["closed"];

/**
 * The statuses the edit form offers: the current status (always, so even a defensively-handled already-closed record
 * renders its own value) plus the allowed next statuses, minus the governed targets the API refuses in P1.
 */
export function offeredStatusOptions(current: TransformationStatus): TransformationStatus[] {
  return [current, ...TRANSFORMATION_STATUS_TRANSITIONS[current].filter((s) => !P1_GOVERNED_STATUSES.includes(s))];
}

export function TransformationEditPage() {
  const { id } = useParams();
  const query = useTransformation(id);
  const { t } = useTranslation();
  usePageTitle(t("transformations.editTitle"));
  return (
    <div className="page">
      <QueryState query={query}>{(tr) => <EditForm key={tr.id} loaded={tr} />}</QueryState>
    </div>
  );
}

function EditForm({ loaded }: { loaded: Transformation }) {
  const { t } = useTranslation();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const target = useTransformationTarget(loaded)!;
  const canReadUsers = canAnywhere(me, "user.read");
  const users = useAllUsers(me.organization.id, canReadUsers);
  // The version (and values) the user's edit is based on. Replaced when re-applying on a newer version.
  const [base, setBase] = useState<Transformation>(loaded);
  const [conflict, setConflict] = useState<{ latest: Transformation | null; currentVersion: number | null } | null>(
    null,
  );
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const form = useForm<EditFormValues>({
    defaultValues: formValuesOf(loaded),
    resolver: payloadResolver(transformationUpdate, (v: EditFormValues) => changedFields(formValuesOf(base), v)),
  });
  const { register, handleSubmit, formState, setError, getValues, reset } = form;
  const err = (field: keyof EditFormValues) => {
    const e = formState.errors[field];
    return e?.message ? fieldErrorMessage(t, e.message) : undefined;
  };

  /** Sends `body` (the user's own changes) as a PATCH on version `on`. */
  const save = async (body: Record<string, unknown>, on: Transformation) => {
    if (Object.keys(body).length === 0) {
      void navigate(`/transformations/${on.id}`);
      return;
    }
    setServerError(null);
    setBusy(true);
    try {
      const updated = await api.send<Transformation>(`/api/v1/transformations/${on.id}`, {
        method: "PATCH",
        body,
        ifMatch: on.version,
      });
      queryClient.setQueryData(keys.transformation(on.id), updated);
      await queryClient.invalidateQueries({ queryKey: ["transformations"] });
      await queryClient.invalidateQueries({ queryKey: ["transformation-audit", on.id] });
      void navigate(`/transformations/${on.id}`);
    } catch (e) {
      setBusy(false);
      if (isSessionChangedError(e)) return; // F-DG2-530: silent, the session state was already reset
      if (e instanceof ApiError && e.isConflict) {
        let latest: Transformation | null = null;
        try {
          latest = await api.get<Transformation>(`/api/v1/transformations/${on.id}`);
          queryClient.setQueryData(keys.transformation(on.id), latest);
        } catch (ge) {
          if (isSessionChangedError(ge)) return; // F-DG2-530: silent, the session state was already reset
          latest = null;
        }
        setConflict({ latest, currentVersion: e.currentVersion ?? latest?.version ?? null });
        return;
      }
      if (e instanceof ApiError) {
        for (const fe of e.fieldErrors) {
          const field = pointerToField(fe.pointer) as keyof EditFormValues;
          if (field) setError(field, { type: "server", message: fe.code });
        }
      }
      setServerError(e);
    }
  };

  const onSubmit = handleSubmit((values) => save(changedFields(formValuesOf(base), values), base));

  if (loaded.archivedAt !== null) {
    return (
      <p className="banner banner--info" role="note">
        <Icon name="lock" /> {t("transformations.archive.readOnlyShort")}
      </p>
    );
  }
  if (!canOn(me, "transformation.update", target)) return <NoPermissionState />;

  const statusOptions = offeredStatusOptions(base.status);
  const userOptions = canReadUsers
    ? (users.data ?? []).map((u) => ({ id: u.id, label: u.displayName }))
    : [{ id: me.user.id, label: t("transformations.form.me", { name: me.user.displayName }) }];
  const withCurrent = (current: string) =>
    current && !userOptions.some((u) => u.id === current)
      ? [...userOptions, { id: current, label: t("common.value.notVisible") }]
      : userOptions;

  /** Sponsor/lead ids are shown as names where the caller can see them. */
  const nameOf = (field: string, value: unknown): unknown =>
    (field === "sponsorUserId" || field === "leadUserId") && typeof value === "string" && value
      ? (userOptions.find((u) => u.id === value)?.label ?? t("common.value.notVisible"))
      : value;
  const conflictRows = (): ConflictRow[] => {
    if (!conflict) return [];
    const mine = changedFields(formValuesOf(base), getValues());
    const latestValues = conflict.latest ? formValuesOf(conflict.latest) : null;
    return Object.entries(mine).map(([field, value]) => ({
      field,
      label: t(
        `transformations.field.${field === "sponsorUserId" ? "sponsor" : field === "leadUserId" ? "lead" : field}`,
        {
          defaultValue: t(`common.field.${field}`),
        },
      ),
      mine: displayValue(t, field, nameOf(field, value)),
      current: latestValues
        ? displayValue(t, field, nameOf(field, latestValues[field as keyof EditFormValues]))
        : t("common.value.unknown"),
    }));
  };

  return (
    <>
      <PageHeader
        title={t("transformations.editTitle")}
        subtitle={
          <>
            <bdi dir="ltr" className="code">
              {base.code}
            </bdi>{" "}
            {base.name}
          </>
        }
        crumbs={[
          { label: t("transformations.listTitle"), to: "/transformations" },
          { label: base.code, to: `/transformations/${base.id}` },
          { label: t("common.action.edit") },
        ]}
      />
      {conflict ? (
        <ConflictPanel
          yourVersion={base.version}
          currentVersion={conflict.currentVersion}
          rows={conflictRows()}
          busy={busy}
          {...(conflict.latest
            ? {
                onReapply: () => {
                  // Only the fields THIS user changed (relative to the version they edited) are sent on top of the
                  // latest version, so the other user's changes to other fields are kept.
                  const latest = conflict.latest!;
                  const mine = changedFields(formValuesOf(base), getValues());
                  setConflict(null);
                  setBase(latest);
                  reset({ ...formValuesOf(latest), ...pickFormValues(getValues(), Object.keys(mine)) });
                  void save(mine, latest);
                },
              }
            : {})}
          onDiscard={() => {
            const latest = conflict.latest ?? base;
            setConflict(null);
            setBase(latest);
            reset(formValuesOf(latest));
          }}
        />
      ) : null}
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {serverError ? (
          <p className="banner banner--error" role="alert">
            <Icon name="alert" /> {errorMessage(t, serverError)}
          </p>
        ) : null}
        {formState.errors.root?.message ? (
          <p className="banner banner--info" role="status">
            <Icon name="info" /> {fieldErrorMessage(t, formState.errors.root.message)}
          </p>
        ) : null}
        <p className="muted small">{t("transformations.form.editingVersion", { version: base.version })}</p>
        <Field label={t("transformations.field.name")} error={err("name")} required>
          {(c) => <input {...c} {...register("name")} maxLength={200} />}
        </Field>
        <Field label={t("transformations.field.description")} error={err("description")}>
          {(c) => <textarea {...c} {...register("description")} rows={3} maxLength={4000} />}
        </Field>
        <Field
          label={t("transformations.field.status")}
          hint={t("transformations.form.statusHint")}
          error={err("status")}
        >
          {(c) => (
            <select {...c} {...register("status")}>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {t(`transformations.status.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="grid grid--2">
          <Field label={t("transformations.field.sponsor")} error={err("sponsorUserId")}>
            {(c) => (
              <select {...c} {...register("sponsorUserId")}>
                <option value="">{t("common.value.notAssigned")}</option>
                {withCurrent(base.sponsorUserId ?? "").map((u) => (
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
                {withCurrent(base.leadUserId ?? "").map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="grid grid--2">
          <Field label={t("common.field.timezone")} error={err("timezone")}>
            {(c) => <input {...c} {...register("timezone")} dir="ltr" />}
          </Field>
          <Field label={t("common.field.currency")} error={err("currency")}>
            {(c) => <input {...c} {...register("currency")} dir="ltr" maxLength={3} />}
          </Field>
        </div>
        <p className="muted small">{t("transformations.form.lockedFields")}</p>
        <div className="form__actions">
          <button type="submit" className="button button--primary" disabled={busy || conflict !== null}>
            {busy ? t("common.state.saving") : t("common.action.save")}
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void navigate(`/transformations/${base.id}`)}
          >
            {t("common.action.cancel")}
          </button>
        </div>
      </form>
    </>
  );
}

function pickFormValues(values: EditFormValues, keys: readonly string[]): Partial<EditFormValues> {
  return Object.fromEntries(keys.map((k) => [k, values[k as keyof EditFormValues]]));
}

function displayValue(t: (k: string) => string, field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return t("common.value.none");
  if (field === "status") return t(`transformations.status.${String(value)}`);
  return String(value);
}
