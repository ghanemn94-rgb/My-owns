// Organizations: list, create (organization.manage), edit with optimistic concurrency, and the organization's
// business units (list, create, edit).
import { useQueryClient } from "@tanstack/react-query";
import { businessUnitCreate, businessUnitUpdate, organizationCreate, organizationUpdate } from "@mth/shared/schemas";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { api, ApiError } from "../../api/client.ts";
import { keys, useBusinessUnit, useBusinessUnits, useOrganization, useOrganizations } from "../../api/queries.ts";
import type { BusinessUnit, Organization } from "../../api/types.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere, canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { ActiveChip } from "../../components/Badges.tsx";
import { Field, payloadResolver } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, NoPermissionState, QueryState } from "../../components/States.tsx";
import { useVersionedSave } from "../../components/useVersionedSave.ts";
import { errorMessage, fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { AdminConflict, LocaleSelect, diffForm } from "./common.tsx";

function useFieldError<F extends object>(errors: Partial<Record<keyof F, { message?: string }>>) {
  const { t } = useTranslation();
  return (field: keyof F) => {
    const m = errors[field]?.message;
    return m ? fieldErrorMessage(t, m) : undefined;
  };
}

function applyServerErrors(e: unknown, setError: (field: never, error: { type: string; message: string }) => void) {
  if (e instanceof ApiError) {
    for (const fe of e.fieldErrors) {
      const field = pointerToField(fe.pointer);
      if (field) setError(field as never, { type: "server", message: fe.code });
    }
    if (e.status === 409 && e.code?.startsWith("duplicate"))
      setError("code" as never, { type: "server", message: "duplicate.code" });
  }
}

/** Form-level validation message, e.g. "There are no changes to save". */
export function RootError({ message }: { message?: string | undefined }) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <p className="banner banner--info" role="status">
      <Icon name="info" /> {fieldErrorMessage(t, message)}
    </p>
  );
}

// ------------------------------------------------------------------------------------------------ list + create
export function OrganizationsPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("admin.organizations.title"));
  const query = useOrganizations();
  const [creating, setCreating] = useState(false);
  const canCreate = canAnywhere(me, "organization.manage");
  return (
    <div className="page">
      <PageHeader
        title={t("admin.organizations.title")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("admin.organizations.title") }]}
        actions={
          canCreate && !creating ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("admin.organizations.new")}
            </button>
          ) : null
        }
      />
      {creating ? <CreateOrganization onDone={() => setCreating(false)} /> : null}
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t("admin.organizations.empty")} />}
      >
        {(orgs) => (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">{t("admin.organizations.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("common.field.code")}</th>
                  <th scope="col">{t("common.field.name")}</th>
                  <th scope="col">{t("common.field.timezone")}</th>
                  <th scope="col">{t("common.field.currency")}</th>
                  <th scope="col">{t("common.field.defaultLocale")}</th>
                  <th scope="col">{t("common.field.status")}</th>
                </tr>
              </thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/admin/organizations/${o.id}`} className="link">
                        <bdi dir="ltr" className="code">
                          {o.code}
                        </bdi>
                      </Link>
                    </td>
                    <td>{localName(o, locale)}</td>
                    <td>
                      <bdi dir="ltr">{o.defaultTimezone}</bdi>
                    </td>
                    <td>
                      <bdi dir="ltr">{o.defaultCurrency}</bdi>
                    </td>
                    <td>{t(`common.language.name.${o.defaultLocale}`)}</td>
                    <td>
                      <ActiveChip status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
    </div>
  );
}

interface OrgCreateValues {
  code: string;
  nameEn: string;
  nameAr: string;
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLocale: string;
}
const orgCreatePayload = (v: OrgCreateValues) =>
  Object.fromEntries(
    Object.entries(v)
      .map(([k, x]) => [k, x.trim()])
      .filter(([, x]) => x !== ""),
  );

function CreateOrganization({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const begin = useSessionBoundAction();
  const [serverError, setServerError] = useState<unknown>(null);
  const { register, handleSubmit, formState, setError } = useForm<OrgCreateValues>({
    defaultValues: { code: "", nameEn: "", nameAr: "", defaultTimezone: "", defaultCurrency: "", defaultLocale: "ar" },
    resolver: payloadResolver(organizationCreate, orgCreatePayload),
  });
  const err = useFieldError<OrgCreateValues>(formState.errors);
  const onSubmit = handleSubmit(async (v) => {
    const action = begin(); // F-DG2-530: every effect below belongs to this session generation
    setServerError(null);
    try {
      const org = await api.send<Organization>("/api/v1/organizations", { method: "POST", body: orgCreatePayload(v) });
      await queryClient.invalidateQueries({ queryKey: keys.organizations });
      if (action.stale()) return;
      onDone();
      action.navigate(`/admin/organizations/${org.id}`);
    } catch (e) {
      if (action.stale(e)) return; // F-DG2-530: silent, the session state was already reset
      applyServerErrors(e, setError as never);
      setServerError(e);
    }
  });
  return (
    <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby="new-org">
      <h2 id="new-org" className="card__title">
        {t("admin.organizations.new")}
      </h2>
      {serverError ? (
        <p className="banner banner--error" role="alert">
          {errorMessage(t, serverError)}
        </p>
      ) : null}
      <div className="grid grid--3">
        <Field label={t("common.field.code")} hint={t("admin.codeHint")} error={err("code")} required>
          {(c) => <input {...c} {...register("code")} dir="ltr" maxLength={32} />}
        </Field>
        <Field label={t("common.field.nameEn")} error={err("nameEn")} required>
          {(c) => <input {...c} {...register("nameEn")} dir="ltr" lang="en" maxLength={200} />}
        </Field>
        <Field label={t("common.field.nameAr")} error={err("nameAr")} required>
          {(c) => <input {...c} {...register("nameAr")} dir="rtl" lang="ar" maxLength={200} />}
        </Field>
        <Field label={t("common.field.timezone")} hint={t("admin.defaultTimezoneHint")} error={err("defaultTimezone")}>
          {(c) => <input {...c} {...register("defaultTimezone")} dir="ltr" placeholder="Asia/Riyadh" />}
        </Field>
        <Field label={t("common.field.currency")} hint={t("admin.defaultCurrencyHint")} error={err("defaultCurrency")}>
          {(c) => <input {...c} {...register("defaultCurrency")} dir="ltr" maxLength={3} placeholder="SAR" />}
        </Field>
        <LocaleSelect label={t("common.field.defaultLocale")} registration={register("defaultLocale")} />
      </div>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={formState.isSubmitting}>
          {t("common.action.create")}
        </button>
        <button type="button" className="button button--secondary" onClick={onDone}>
          {t("common.action.cancel")}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ detail / edit
interface OrgEditValues extends Record<string, string> {
  nameEn: string;
  nameAr: string;
  defaultTimezone: string;
  defaultCurrency: string;
  defaultLocale: string;
  status: string;
}
const orgValues = (o: Organization): OrgEditValues => ({
  nameEn: o.nameEn,
  nameAr: o.nameAr,
  defaultTimezone: o.defaultTimezone,
  defaultCurrency: o.defaultCurrency,
  defaultLocale: o.defaultLocale,
  status: o.status,
});

export function OrganizationDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  usePageTitle(t("admin.organizations.detailTitle"));
  const query = useOrganization(id);
  return (
    <div className="page">
      <QueryState query={query}>
        {(org) => (
          <>
            <OrganizationEdit key={`${org.id}`} org={org} />
            <BusinessUnitsSection org={org} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function OrganizationEdit({ org }: { org: Organization }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const canManage = canOn(me, "organization.manage", { level: "organization", organizationId: org.id });
  const vs = useVersionedSave<Organization, OrgEditValues>({
    initial: org,
    url: (o) => `/api/v1/organizations/${o.id}`,
    toValues: orgValues,
    diff: (a, b) => diffForm(a, b),
    onSaved: (updated, action) => {
      action.setQueryData(keys.organization(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.organizations });
      setSaved(true);
    },
  });
  const { register, handleSubmit, formState, getValues, reset, setError } = useForm<OrgEditValues>({
    defaultValues: orgValues(org),
    resolver: payloadResolver(organizationUpdate, (v: OrgEditValues) => diffForm(orgValues(vs.base), v)),
  });
  const err = useFieldError<OrgEditValues>(formState.errors);
  const labels = {
    nameEn: t("common.field.nameEn"),
    nameAr: t("common.field.nameAr"),
    defaultTimezone: t("common.field.timezone"),
    defaultCurrency: t("common.field.currency"),
    defaultLocale: t("common.field.defaultLocale"),
    status: t("common.field.status"),
  };
  const onSubmit = handleSubmit(async (v) => {
    setSaved(false);
    const r = await vs.save(v);
    if (r.outcome === "saved") reset(v);
    if (r.outcome === "error") applyServerErrors(r.error, setError as never);
  });
  return (
    <>
      <PageHeader
        title={
          <>
            <bdi dir="ltr" className="code page-header__code">
              {vs.base.code}
            </bdi>{" "}
            {localName(vs.base, locale)}
          </>
        }
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("admin.organizations.title"), to: "/admin/organizations" },
          { label: vs.base.code },
        ]}
      />
      {vs.conflict ? (
        <AdminConflict
          conflict={vs.conflict}
          baseVersion={vs.base.version}
          labels={labels}
          mine={diffForm(orgValues(vs.base), getValues())}
          latestValues={vs.conflict.latest ? orgValues(vs.conflict.latest) : null}
          busy={vs.busy}
          onReapply={() => void vs.reapply(getValues())}
          onDiscard={() => reset(vs.discard())}
        />
      ) : null}
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby="org-edit">
        <h2 id="org-edit" className="card__title">
          {t("admin.organizations.settings")}
        </h2>
        {saved ? (
          <p className="banner banner--success" role="status">
            <Icon name="check" /> {t("common.state.saved")}
          </p>
        ) : null}
        {vs.error ? (
          <p className="banner banner--error" role="alert">
            {errorMessage(t, vs.error)}
          </p>
        ) : null}
        <RootError message={formState.errors.root?.message} />
        <fieldset disabled={!canManage} className="plain-fieldset">
          <div className="grid grid--3">
            <Field label={labels.nameEn} error={err("nameEn")} required>
              {(c) => <input {...c} {...register("nameEn")} dir="ltr" lang="en" />}
            </Field>
            <Field label={labels.nameAr} error={err("nameAr")} required>
              {(c) => <input {...c} {...register("nameAr")} dir="rtl" lang="ar" />}
            </Field>
            <Field label={labels.defaultTimezone} error={err("defaultTimezone")}>
              {(c) => <input {...c} {...register("defaultTimezone")} dir="ltr" />}
            </Field>
            <Field label={labels.defaultCurrency} error={err("defaultCurrency")}>
              {(c) => <input {...c} {...register("defaultCurrency")} dir="ltr" maxLength={3} />}
            </Field>
            <LocaleSelect label={labels.defaultLocale} registration={register("defaultLocale")} />
            <Field label={labels.status}>
              {(c) => (
                <select {...c} {...register("status")}>
                  <option value="active">{t("common.activeStatus.active")}</option>
                  <option value="inactive">{t("common.activeStatus.inactive")}</option>
                </select>
              )}
            </Field>
          </div>
          <p className="muted small">{t("admin.defaultsAffectNew")}</p>
          {canManage ? (
            <div className="form__actions">
              <button type="submit" className="button button--primary" disabled={vs.busy || vs.conflict !== null}>
                {vs.busy ? t("common.state.saving") : t("common.action.save")}
              </button>
            </div>
          ) : null}
        </fieldset>
        {!canManage ? <p className="muted small">{t("admin.readOnlyHint")}</p> : null}
      </form>
    </>
  );
}

function BusinessUnitsSection({ org }: { org: Organization }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const query = useBusinessUnits(org.id);
  const [creating, setCreating] = useState(false);
  const canManage =
    canOn(me, "business_unit.manage", { level: "organization", organizationId: org.id }) ||
    canAnywhere(me, "business_unit.manage");
  return (
    <section className="card" aria-labelledby="bu-title">
      <div className="card__header">
        <h2 id="bu-title" className="card__title">
          {t("admin.businessUnits.title")}
        </h2>
        {canManage && !creating ? (
          <button type="button" className="button button--secondary button--small" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("admin.businessUnits.new")}
          </button>
        ) : null}
      </div>
      {creating ? <CreateBusinessUnit org={org} units={query.data ?? []} onDone={() => setCreating(false)} /> : null}
      <QueryState
        query={query}
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState title={t("admin.businessUnits.empty")} />}
      >
        {(units) => {
          const byId = new Map(units.map((u) => [u.id, u]));
          return (
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">{t("admin.businessUnits.title")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("common.field.code")}</th>
                    <th scope="col">{t("common.field.name")}</th>
                    <th scope="col">{t("admin.businessUnits.parent")}</th>
                    <th scope="col">{t("common.field.status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <Link to={`/admin/business-units/${u.id}`} className="link">
                          <bdi dir="ltr" className="code">
                            {u.code}
                          </bdi>
                        </Link>
                      </td>
                      <td>{localName(u, locale)}</td>
                      <td>
                        {u.parentBusinessUnitId ? (
                          (localName(byId.get(u.parentBusinessUnitId), locale) ?? t("common.value.unknown"))
                        ) : (
                          <span className="muted">{t("admin.businessUnits.topLevel")}</span>
                        )}
                      </td>
                      <td>
                        <ActiveChip status={u.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }}
      </QueryState>
    </section>
  );
}

interface BuCreateValues {
  code: string;
  nameEn: string;
  nameAr: string;
  parentBusinessUnitId: string;
}
const buCreatePayload = (v: BuCreateValues) =>
  Object.fromEntries(
    Object.entries(v)
      .map(([k, x]) => [k, x.trim()])
      .filter(([, x]) => x !== ""),
  );

function CreateBusinessUnit({
  org,
  units,
  onDone,
}: {
  org: Organization;
  units: readonly BusinessUnit[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const begin = useSessionBoundAction();
  const [serverError, setServerError] = useState<unknown>(null);
  const { register, handleSubmit, formState, setError } = useForm<BuCreateValues>({
    defaultValues: { code: "", nameEn: "", nameAr: "", parentBusinessUnitId: "" },
    resolver: payloadResolver(businessUnitCreate, buCreatePayload),
  });
  const err = useFieldError<BuCreateValues>(formState.errors);
  const onSubmit = handleSubmit(async (v) => {
    const action = begin(); // F-DG2-530: every effect below belongs to this session generation
    setServerError(null);
    try {
      await api.send<BusinessUnit>(`/api/v1/organizations/${org.id}/business-units`, {
        method: "POST",
        body: buCreatePayload(v),
      });
      await queryClient.invalidateQueries({ queryKey: keys.businessUnits(org.id) });
      if (action.stale()) return;
      onDone();
    } catch (e) {
      if (action.stale(e)) return; // F-DG2-530: silent, the session state was already reset
      applyServerErrors(e, setError as never);
      setServerError(e);
    }
  });
  return (
    <form
      className="form form--inset"
      onSubmit={(e) => void onSubmit(e)}
      noValidate
      aria-label={t("admin.businessUnits.new")}
    >
      {serverError ? (
        <p className="banner banner--error" role="alert">
          {errorMessage(t, serverError)}
        </p>
      ) : null}
      <div className="grid grid--2">
        <Field label={t("common.field.code")} hint={t("admin.codeHint")} error={err("code")} required>
          {(c) => <input {...c} {...register("code")} dir="ltr" maxLength={32} />}
        </Field>
        <Field label={t("admin.businessUnits.parent")} error={err("parentBusinessUnitId")}>
          {(c) => (
            <select {...c} {...register("parentBusinessUnitId")}>
              <option value="">{t("admin.businessUnits.topLevel")}</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {localName(u, locale)} ({u.code})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("common.field.nameEn")} error={err("nameEn")} required>
          {(c) => <input {...c} {...register("nameEn")} dir="ltr" lang="en" maxLength={200} />}
        </Field>
        <Field label={t("common.field.nameAr")} error={err("nameAr")} required>
          {(c) => <input {...c} {...register("nameAr")} dir="rtl" lang="ar" maxLength={200} />}
        </Field>
      </div>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={formState.isSubmitting}>
          {t("common.action.create")}
        </button>
        <button type="button" className="button button--secondary" onClick={onDone}>
          {t("common.action.cancel")}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ business unit edit
interface BuEditValues extends Record<string, string> {
  nameEn: string;
  nameAr: string;
  parentBusinessUnitId: string;
  status: string;
}
const buValues = (u: BusinessUnit): BuEditValues => ({
  nameEn: u.nameEn,
  nameAr: u.nameAr,
  parentBusinessUnitId: u.parentBusinessUnitId ?? "",
  status: u.status,
});

export function BusinessUnitEditPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  usePageTitle(t("admin.businessUnits.editTitle"));
  const query = useBusinessUnit(id);
  return (
    <div className="page">
      <QueryState query={query}>{(unit) => <BusinessUnitEdit key={unit.id} unit={unit} />}</QueryState>
    </div>
  );
}

function BusinessUnitEdit({ unit }: { unit: BusinessUnit }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const siblings = useBusinessUnits(unit.organizationId);
  const [saved, setSaved] = useState(false);
  const canManage = canOn(me, "business_unit.manage", {
    level: "business_unit",
    organizationId: unit.organizationId,
    businessUnitId: unit.id,
  });
  const vs = useVersionedSave<BusinessUnit, BuEditValues>({
    initial: unit,
    url: (u) => `/api/v1/business-units/${u.id}`,
    toValues: buValues,
    diff: (a, b) => diffForm(a, b, ["parentBusinessUnitId"]),
    onSaved: (updated, action) => {
      action.setQueryData(keys.businessUnit(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.businessUnits(updated.organizationId) });
      setSaved(true);
    },
  });
  const { register, handleSubmit, formState, getValues, reset, setError } = useForm<BuEditValues>({
    defaultValues: buValues(unit),
    resolver: payloadResolver(businessUnitUpdate, (v: BuEditValues) =>
      diffForm(buValues(vs.base), v, ["parentBusinessUnitId"]),
    ),
  });
  const err = useFieldError<BuEditValues>(formState.errors);
  const labels = {
    nameEn: t("common.field.nameEn"),
    nameAr: t("common.field.nameAr"),
    parentBusinessUnitId: t("admin.businessUnits.parent"),
    status: t("common.field.status"),
  };
  if (!canManage && !canAnywhere(me, "business_unit.read")) return <NoPermissionState />;
  const onSubmit = handleSubmit(async (v) => {
    setSaved(false);
    const r = await vs.save(v);
    if (r.outcome === "saved") reset(v);
    if (r.outcome === "error") applyServerErrors(r.error, setError as never);
  });
  return (
    <>
      <PageHeader
        title={
          <>
            <bdi dir="ltr" className="code page-header__code">
              {vs.base.code}
            </bdi>{" "}
            {localName(vs.base, locale)}
          </>
        }
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("admin.organizations.title"), to: "/admin/organizations" },
          { label: t("admin.businessUnits.title"), to: `/admin/organizations/${vs.base.organizationId}` },
          { label: vs.base.code },
        ]}
      />
      {vs.conflict ? (
        <AdminConflict
          conflict={vs.conflict}
          baseVersion={vs.base.version}
          labels={labels}
          mine={diffForm(buValues(vs.base), getValues(), ["parentBusinessUnitId"])}
          latestValues={vs.conflict.latest ? buValues(vs.conflict.latest) : null}
          busy={vs.busy}
          onReapply={() => void vs.reapply(getValues())}
          onDiscard={() => reset(vs.discard())}
        />
      ) : null}
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate>
        {saved ? (
          <p className="banner banner--success" role="status">
            <Icon name="check" /> {t("common.state.saved")}
          </p>
        ) : null}
        {vs.error ? (
          <p className="banner banner--error" role="alert">
            {errorMessage(t, vs.error)}
          </p>
        ) : null}
        <RootError message={formState.errors.root?.message} />
        <fieldset disabled={!canManage} className="plain-fieldset">
          <div className="grid grid--2">
            <Field label={labels.nameEn} error={err("nameEn")} required>
              {(c) => <input {...c} {...register("nameEn")} dir="ltr" lang="en" />}
            </Field>
            <Field label={labels.nameAr} error={err("nameAr")} required>
              {(c) => <input {...c} {...register("nameAr")} dir="rtl" lang="ar" />}
            </Field>
            <Field label={labels.parentBusinessUnitId} error={err("parentBusinessUnitId")}>
              {(c) => (
                <select {...c} {...register("parentBusinessUnitId")}>
                  <option value="">{t("admin.businessUnits.topLevel")}</option>
                  {(siblings.data ?? [])
                    .filter((u) => u.id !== vs.base.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {localName(u, locale)} ({u.code})
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label={labels.status}>
              {(c) => (
                <select {...c} {...register("status")}>
                  <option value="active">{t("common.activeStatus.active")}</option>
                  <option value="inactive">{t("common.activeStatus.inactive")}</option>
                </select>
              )}
            </Field>
          </div>
          {canManage ? (
            <div className="form__actions">
              <button type="submit" className="button button--primary" disabled={vs.busy || vs.conflict !== null}>
                {vs.busy ? t("common.state.saving") : t("common.action.save")}
              </button>
            </div>
          ) : null}
        </fieldset>
        {!canManage ? <p className="muted small">{t("admin.readOnlyHint")}</p> : null}
      </form>
    </>
  );
}
