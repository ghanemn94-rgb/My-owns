// Users: searchable, paged list per organization; pre-provisioning (optionally bound to an IdP subject); edit and
// disable with optimistic concurrency; the user's role assignments.
import { useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { userCreate, userUpdate } from "@mth/shared/schemas";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { api, ApiError } from "../../api/client.ts";
import { keys, useOrganizations, useUser, useUsers } from "../../api/queries.ts";
import type { User } from "../../api/types.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere, canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { ActiveChip } from "../../components/Badges.tsx";
import {
  ColumnPicker,
  DataTable,
  Pager,
  useCursorPager,
  usePersistentVisibility,
} from "../../components/DataTable.tsx";
import { Field, payloadResolver } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { EmptyState, NoPermissionState, QueryState } from "../../components/States.tsx";
import { useVersionedSave } from "../../components/useVersionedSave.ts";
import { errorMessage, fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { formatDateTime } from "../../lib/format.ts";
import { AssignmentsTable } from "./AssignmentsPage.tsx";
import { AdminConflict, LocaleSelect, diffForm } from "./common.tsx";
import { RootError } from "./OrganizationsPage.tsx";

/** Organization selector shared by the users and assignments screens (defaults to the caller's organization). */
export function useSelectedOrganization() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const orgs = useOrganizations();
  const organizationId = params.get("org") ?? me.organization.id;
  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("org", id);
    setParams(next, { replace: true });
  };
  return { organizationId, organizations: orgs.data ?? [me.organization], select };
}

export function OrganizationPicker({
  organizationId,
  organizations,
  onSelect,
}: {
  organizationId: string;
  organizations: readonly { id: string; code: string; nameEn: string; nameAr: string }[];
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  if (organizations.length < 2) return null;
  return (
    <div className="filters__select">
      <label htmlFor={id}>{t("admin.organization")}</label>
      <select id={id} value={organizationId} onChange={(e) => onSelect(e.target.value)}>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {localName(o, locale)} ({o.code})
          </option>
        ))}
      </select>
    </div>
  );
}

const col = createColumnHelper<User>();

export function UsersPage() {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  usePageTitle(t("admin.users.title"));
  const org = useSelectedOrganization();
  const pager = useCursorPager();
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | "disabled">("");
  const [limit, setLimit] = useState(25);
  const [creating, setCreating] = useState(false);
  const [visibility, setVisibility] = usePersistentVisibility("users");
  const formId = useId();
  const { reset } = pager;
  useEffect(() => reset(), [q, status, limit, org.organizationId, reset]);

  const canRead = canOn(me, "user.read", { level: "organization", organizationId: org.organizationId });
  const canManage = canOn(me, "user.manage", { level: "organization", organizationId: org.organizationId });
  const query = useUsers(
    canRead
      ? {
          organizationId: org.organizationId,
          limit,
          ...(q ? { q } : {}),
          ...(status ? { status } : {}),
          ...(pager.cursor ? { cursor: pager.cursor } : {}),
        }
      : null,
  );
  const columns = useMemo(
    () => [
      col.accessor("displayName", {
        header: () => t("admin.users.displayName"),
        cell: (c) => (
          <Link to={`/admin/users/${c.row.original.id}`} className="link">
            {c.getValue()}
          </Link>
        ),
        enableSorting: false,
        enableHiding: false,
      }),
      col.accessor("email", {
        header: () => t("admin.users.email"),
        cell: (c) =>
          c.getValue() ? <bdi dir="ltr">{c.getValue()}</bdi> : <span className="muted">{t("common.value.none")}</span>,
        enableSorting: false,
      }),
      col.accessor("preferredLocale", {
        header: () => t("admin.users.language"),
        cell: (c) => t(`common.language.name.${c.getValue()}`),
        enableSorting: false,
      }),
      col.accessor("identities", {
        header: () => t("admin.users.identities"),
        cell: (c) => {
          const last = c.getValue()[0]?.lastLoginAt ?? null;
          return c.getValue().length === 0 ? (
            <span className="muted">{t("admin.users.notBound")}</span>
          ) : (
            <span>
              {t("admin.users.boundCount", { n: c.getValue().length })}
              {last ? ` · ${t("admin.users.lastLogin")} ${formatDateTime(last, locale)}` : ""}
            </span>
          );
        },
        enableSorting: false,
      }),
      col.accessor("status", {
        header: () => t("common.field.status"),
        cell: (c) => <ActiveChip status={c.getValue()} />,
        enableSorting: false,
      }),
    ],
    [t, locale],
  );

  if (!canAnywhere(me, "user.read")) return <NoPermissionState />;

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(search.trim());
  };

  return (
    <div className="page">
      <PageHeader
        title={t("admin.users.title")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("admin.users.title") }]}
        actions={
          canManage && !creating ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("admin.users.new")}
            </button>
          ) : null
        }
      />
      {creating ? <CreateUser organizationId={org.organizationId} onDone={() => setCreating(false)} /> : null}
      <form className="filters" role="search" aria-label={t("common.filter.title")} onSubmit={submitSearch}>
        <OrganizationPicker
          organizationId={org.organizationId}
          organizations={org.organizations}
          onSelect={org.select}
        />
        <div className="filters__search">
          <label htmlFor={`${formId}-q`}>{t("common.filter.search")}</label>
          <input
            id={`${formId}-q`}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={200}
          />
          <button type="submit" className="button button--secondary button--small">
            {t("common.filter.apply")}
          </button>
        </div>
        <div className="filters__select">
          <label htmlFor={`${formId}-status`}>{t("common.field.status")}</label>
          <select id={`${formId}-status`} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">{t("common.filter.any")}</option>
            <option value="active">{t("common.activeStatus.active")}</option>
            <option value="disabled">{t("common.activeStatus.disabled")}</option>
          </select>
        </div>
      </form>
      <div className="toolbar">
        <ColumnPicker
          columns={[
            { id: "email", label: t("admin.users.email") },
            { id: "preferredLocale", label: t("admin.users.language") },
            { id: "identities", label: t("admin.users.identities") },
            { id: "status", label: t("common.field.status") },
          ]}
          visibility={visibility}
          onChange={setVisibility}
        />
      </div>
      {!canRead ? (
        <NoPermissionState />
      ) : (
        <QueryState
          query={query}
          isEmpty={(d) => d.items.length === 0}
          empty={<EmptyState title={t("admin.users.empty")} />}
        >
          {(page) => (
            <>
              <DataTable
                caption={t("admin.users.title")}
                data={page.items}
                columns={columns}
                getRowId={(u) => u.id}
                columnVisibility={visibility}
                onColumnVisibilityChange={setVisibility}
                busy={query.isFetching}
              />
              <Pager
                pageNumber={pager.pageNumber}
                hasPrevious={pager.hasPrevious}
                hasNext={Boolean(page.nextCursor)}
                onPrevious={pager.previous}
                onNext={() => pager.next(page.nextCursor)}
                pageSize={limit}
                onPageSizeChange={setLimit}
                shownCount={page.items.length}
              />
            </>
          )}
        </QueryState>
      )}
    </div>
  );
}

interface UserCreateValues {
  displayName: string;
  email: string;
  preferredLocale: string;
  issuer: string;
  subject: string;
}

function userCreatePayload(organizationId: string) {
  return (v: UserCreateValues) => {
    const out: Record<string, unknown> = {
      organizationId,
      displayName: v.displayName.trim(),
      preferredLocale: v.preferredLocale,
    };
    if (v.email.trim()) out["email"] = v.email.trim();
    if (v.issuer.trim() || v.subject.trim()) out["identity"] = { issuer: v.issuer.trim(), subject: v.subject.trim() };
    return out;
  };
}

function CreateUser({ organizationId, onDone }: { organizationId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const begin = useSessionBoundAction();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<unknown>(null);
  const toPayload = userCreatePayload(organizationId);
  const { register, handleSubmit, formState, setError } = useForm<UserCreateValues>({
    defaultValues: { displayName: "", email: "", preferredLocale: "ar", issuer: "", subject: "" },
    resolver: payloadResolver(userCreate, toPayload),
  });
  const err = (f: string) => {
    const m = (formState.errors as Record<string, { message?: string } | undefined>)[f]?.message;
    return m ? fieldErrorMessage(t, m) : undefined;
  };
  const onSubmit = handleSubmit(async (v) => {
    const action = begin(); // F-DG2-530: every effect below belongs to this session generation
    setServerError(null);
    try {
      const user = await api.send<User>("/api/v1/users", { method: "POST", body: toPayload(v) });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      if (action.stale()) return;
      onDone();
      action.navigate(`/admin/users/${user.id}`);
    } catch (e) {
      if (action.stale(e)) return; // F-DG2-530: silent, the session state was already reset
      if (e instanceof ApiError) {
        for (const fe of e.fieldErrors) {
          const field = pointerToField(fe.pointer).replace(/^identity\./, "");
          if (field) setError(field as keyof UserCreateValues, { type: "server", message: fe.code });
        }
      }
      setServerError(e);
    }
  });
  return (
    <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby="new-user">
      <h2 id="new-user" className="card__title">
        {t("admin.users.new")}
      </h2>
      {serverError ? (
        <p className="banner banner--error" role="alert">
          {errorMessage(t, serverError)}
        </p>
      ) : null}
      <div className="grid grid--3">
        <Field label={t("admin.users.displayName")} error={err("displayName")} required>
          {(c) => <input {...c} {...register("displayName")} maxLength={200} />}
        </Field>
        <Field label={t("admin.users.email")} error={err("email")}>
          {(c) => <input {...c} {...register("email")} type="email" dir="ltr" maxLength={320} />}
        </Field>
        <LocaleSelect label={t("admin.users.language")} registration={register("preferredLocale")} />
      </div>
      <fieldset className="field field--group">
        <legend className="field__label">{t("admin.users.identityBinding")}</legend>
        <p className="field__hint">{t("admin.users.identityHint")}</p>
        <div className="grid grid--2">
          <Field label={t("admin.users.issuer")} error={err("issuer") ?? err("identity.issuer")}>
            {(c) => <input {...c} {...register("issuer")} dir="ltr" maxLength={512} />}
          </Field>
          <Field label={t("admin.users.subject")} error={err("subject") ?? err("identity.subject")}>
            {(c) => <input {...c} {...register("subject")} dir="ltr" maxLength={255} />}
          </Field>
        </div>
      </fieldset>
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
interface UserEditValues extends Record<string, string> {
  displayName: string;
  email: string;
  preferredLocale: string;
  status: string;
}
const userValues = (u: User): UserEditValues => ({
  displayName: u.displayName,
  email: u.email ?? "",
  preferredLocale: u.preferredLocale,
  status: u.status,
});

export function UserDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  usePageTitle(t("admin.users.detailTitle"));
  const query = useUser(id);
  return (
    <div className="page">
      <QueryState query={query}>{(user) => <UserEdit key={user.id} user={user} />}</QueryState>
    </div>
  );
}

function UserEdit({ user }: { user: User }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const canManage = canOn(me, "user.manage", { level: "organization", organizationId: user.organizationId });
  const vs = useVersionedSave<User, UserEditValues>({
    initial: user,
    url: (u) => `/api/v1/users/${u.id}`,
    toValues: userValues,
    diff: (a, b) => diffForm(a, b, ["email"]),
    onSaved: (updated, action) => {
      action.setQueryData(keys.user(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: ["users"] });
      setSaved(true);
    },
  });
  const { register, handleSubmit, formState, getValues, reset, setError } = useForm<UserEditValues>({
    defaultValues: userValues(user),
    resolver: payloadResolver(userUpdate, (v: UserEditValues) => diffForm(userValues(vs.base), v, ["email"])),
  });
  const err = (f: keyof UserEditValues & string) => {
    const m = formState.errors[f]?.message;
    return m ? fieldErrorMessage(t, m) : undefined;
  };
  const labels = {
    displayName: t("admin.users.displayName"),
    email: t("admin.users.email"),
    preferredLocale: t("admin.users.language"),
    status: t("common.field.status"),
  };
  const onSubmit = handleSubmit(async (v) => {
    setSaved(false);
    const r = await vs.save(v);
    if (r.outcome === "saved") reset(v);
    if (r.outcome === "error" && r.error instanceof ApiError) {
      for (const fe of r.error.fieldErrors) {
        const field = pointerToField(fe.pointer);
        if (field) setError(field as keyof UserEditValues & string, { type: "server", message: fe.code });
      }
    }
  });
  const isSelf = user.id === me.user.id;
  return (
    <>
      <PageHeader
        title={vs.base.displayName}
        subtitle={<ActiveChip status={vs.base.status} />}
        crumbs={[
          { label: t("nav.areas.admin.label"), to: "/admin" },
          { label: t("admin.users.title"), to: "/admin/users" },
          { label: vs.base.displayName },
        ]}
      />
      {vs.conflict ? (
        <AdminConflict
          conflict={vs.conflict}
          baseVersion={vs.base.version}
          labels={labels}
          mine={diffForm(userValues(vs.base), getValues(), ["email"])}
          latestValues={vs.conflict.latest ? userValues(vs.conflict.latest) : null}
          busy={vs.busy}
          onReapply={() => void vs.reapply(getValues())}
          onDiscard={() => reset(vs.discard())}
        />
      ) : null}
      <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby="user-edit">
        <h2 id="user-edit" className="card__title">
          {t("admin.users.profile")}
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
          <div className="grid grid--2">
            <Field label={labels.displayName} error={err("displayName")} required>
              {(c) => <input {...c} {...register("displayName")} maxLength={200} />}
            </Field>
            <Field label={labels.email} error={err("email")}>
              {(c) => <input {...c} {...register("email")} type="email" dir="ltr" maxLength={320} />}
            </Field>
            <LocaleSelect label={labels.preferredLocale} registration={register("preferredLocale")} />
            <Field
              label={labels.status}
              hint={isSelf ? t("admin.users.cannotDisableSelf") : t("admin.users.disableHint")}
              error={err("status")}
            >
              {(c) => (
                <select {...c} {...register("status")} disabled={isSelf || !canManage}>
                  <option value="active">{t("common.activeStatus.active")}</option>
                  <option value="disabled">{t("common.activeStatus.disabled")}</option>
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
      </form>
      <section className="card" aria-labelledby="identities-title">
        <h2 id="identities-title" className="card__title">
          {t("admin.users.identities")}
        </h2>
        {vs.base.identities.length === 0 ? (
          <p className="muted">{t("admin.users.notBound")}</p>
        ) : (
          <table className="table table--compact">
            <caption className="visually-hidden">{t("admin.users.identities")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("admin.users.issuer")}</th>
                <th scope="col">{t("admin.users.subject")}</th>
                <th scope="col">{t("admin.users.lastLogin")}</th>
              </tr>
            </thead>
            <tbody>
              {vs.base.identities.map((i) => (
                <tr key={`${i.issuer}|${i.subject}`}>
                  <td>
                    <bdi dir="ltr" className="code">
                      {i.issuer}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="code">
                      {i.subject}
                    </bdi>
                  </td>
                  <td>
                    {formatDateTime(i.lastLoginAt, locale) ?? <span className="muted">{t("admin.users.never")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {canOn(me, "access.read", { level: "organization", organizationId: user.organizationId }) ? (
        <section className="card" aria-labelledby="user-assignments">
          <div className="card__header">
            <h2 id="user-assignments" className="card__title">
              {t("admin.assignments.title")}
            </h2>
            {canOn(me, "access.assign", { level: "organization", organizationId: user.organizationId }) ? (
              <Link
                to={`/admin/assignments?org=${user.organizationId}&user=${user.id}&grant=1`}
                className="button button--secondary button--small"
              >
                <Icon name="plus" /> {t("admin.assignments.new")}
              </Link>
            ) : null}
          </div>
          <AssignmentsTable organizationId={user.organizationId} userId={user.id} includeRevoked={false} />
        </section>
      ) : null}
    </>
  );
}
