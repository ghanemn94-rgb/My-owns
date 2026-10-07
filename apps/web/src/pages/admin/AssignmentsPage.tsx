// Scoped role assignments (ADR-0006): list with filters, grant (mandatory reason, optional effective window entered in
// the organization's time zone) and revoke (mandatory reason, If-Match). The server rejects a grant that would make
// a technical administrator a business approver (422 sod.admin_approver); the UI shows that message translated.
import { useQueryClient } from "@tanstack/react-query";
import { createColumnHelper } from "@tanstack/react-table";
import { P1_SCOPE_TYPES } from "@mth/shared";
import { roleAssignmentCreate } from "@mth/shared/schemas";
import { useEffect, useId, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { api, ApiError } from "../../api/client.ts";
import {
  useAllUsers,
  useAssignments,
  useBusinessUnits,
  useOrganizations,
  useRoles,
  useTransformations,
} from "../../api/queries.ts";
import type { RoleAssignment } from "../../api/types.ts";
import { localName, useLocale } from "../../app/locale.ts";
import { canAnywhere, canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
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
import { ReasonDialog } from "../../components/ReasonDialog.tsx";
import { EmptyState, NoPermissionState, QueryState } from "../../components/States.tsx";
import { errorMessage, fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { formatDateTime, zonedLocalToUtcIso } from "../../lib/format.ts";
import { OrganizationPicker, useSelectedOrganization } from "./UsersPage.tsx";

/** Active / scheduled / expired / revoked, derived from the assignment's dates (never from colour alone). */
export function assignmentState(
  a: RoleAssignment,
  now: number = Date.now(),
): "active" | "scheduled" | "expired" | "revoked" {
  if (a.revokedAt) return "revoked";
  if (Date.parse(a.effectiveFrom) > now) return "scheduled";
  if (a.effectiveTo && Date.parse(a.effectiveTo) <= now) return "expired";
  return "active";
}

const col = createColumnHelper<RoleAssignment>();

export function AssignmentsTable({
  organizationId,
  userId,
  scopeType,
  includeRevoked,
}: {
  organizationId: string;
  userId?: string;
  scopeType?: string;
  includeRevoked: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const begin = useSessionBoundAction();
  const pager = useCursorPager();
  const [limit, setLimit] = useState(25);
  const [revoking, setRevoking] = useState<RoleAssignment | null>(null);
  const [visibility, setVisibility] = usePersistentVisibility("assignments");
  const { reset } = pager;
  useEffect(() => reset(), [organizationId, userId, scopeType, includeRevoked, limit, reset]);
  const canReadUsers = canAnywhere(me, "user.read");
  const users = useAllUsers(organizationId, canReadUsers);
  const roles = useRoles();
  const units = useBusinessUnits(organizationId);
  const orgs = useOrganizations();
  const canAssign = canOn(me, "access.assign", { level: "organization", organizationId });
  const org = (orgs.data ?? [me.organization]).find((o) => o.id === organizationId);
  const tz = org?.defaultTimezone ?? me.organization.defaultTimezone;

  const query = useAssignments({
    organizationId,
    limit,
    ...(userId ? { userId } : {}),
    ...(scopeType ? { scopeType } : {}),
    ...(includeRevoked ? { includeRevoked: true } : {}),
    ...(pager.cursor ? { cursor: pager.cursor } : {}),
  });

  const userName = useMemo(() => {
    const m = new Map((users.data ?? []).map((u) => [u.id, u.displayName]));
    return (id: string) => m.get(id) ?? (id === me.user.id ? me.user.displayName : null);
  }, [users.data, me.user]);
  const roleName = useMemo(() => {
    const m = new Map((roles.data ?? []).map((r) => [r.code, r]));
    return (code: string) => localName(m.get(code as never), locale) ?? code;
  }, [roles.data, locale]);
  const scopeName = useMemo(() => {
    const bu = new Map((units.data ?? []).map((u) => [u.id, u]));
    return (a: RoleAssignment) => {
      if (a.scope.type === "organization") return localName(org, locale) ?? t("common.value.unknown");
      if (a.scope.type === "business_unit") return localName(bu.get(a.scope.id), locale) ?? t("common.value.unknown");
      return null;
    };
  }, [units.data, org, locale, t]);

  const columns = useMemo(
    () => [
      col.accessor("userId", {
        id: "user",
        header: () => t("admin.assignments.user"),
        cell: (c) =>
          userName(c.getValue()) ?? (
            <bdi dir="ltr" className="code">
              {c.getValue().slice(0, 8)}…
            </bdi>
          ),
        enableHiding: false,
        enableSorting: false,
      }),
      col.accessor("roleCode", {
        id: "role",
        header: () => t("admin.assignments.role"),
        cell: (c) => (
          <span>
            {roleName(c.getValue())}{" "}
            <bdi dir="ltr" className="code muted">
              {c.getValue()}
            </bdi>
          </span>
        ),
        enableHiding: false,
        enableSorting: false,
      }),
      col.accessor("scope", {
        header: () => t("admin.assignments.scope"),
        cell: (c) => {
          const name = scopeName(c.row.original);
          return (
            <span>
              {t(`admin.scopeType.${c.getValue().type}`)}
              {": "}
              {name ?? (
                <bdi dir="ltr" className="code">
                  {c.getValue().id.slice(0, 8)}…
                </bdi>
              )}
            </span>
          );
        },
        enableSorting: false,
      }),
      col.display({
        id: "window",
        header: () => t("admin.assignments.window"),
        cell: (c) => (
          <span>
            {t("admin.assignments.windowRange", {
              from: formatDateTime(c.row.original.effectiveFrom, locale, tz) ?? t("common.value.unknown"),
              to: c.row.original.effectiveTo
                ? (formatDateTime(c.row.original.effectiveTo, locale, tz) ?? t("common.value.unknown"))
                : t("admin.assignments.noEnd"),
            })}
          </span>
        ),
      }),
      col.accessor("reason", {
        header: () => t("common.form.reason"),
        cell: (c) => c.getValue(),
        enableSorting: false,
      }),
      col.display({
        id: "state",
        header: () => t("common.field.status"),
        cell: (c) => {
          const s = assignmentState(c.row.original);
          return (
            <span
              className={`lifecycle-chip lifecycle-chip--${s === "active" ? "active" : s === "scheduled" ? "draft" : "closed"}`}
            >
              <Icon name={s === "active" ? "dot" : s === "scheduled" ? "clock" : "stop"} />{" "}
              {t(`admin.assignments.state.${s}`)}
            </span>
          );
        },
      }),
      col.display({
        id: "actions",
        header: () => <span className="visually-hidden">{t("common.field.actions")}</span>,
        cell: (c) =>
          canAssign && !c.row.original.revokedAt ? (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setRevoking(c.row.original)}
            >
              {t("admin.assignments.revoke")}
            </button>
          ) : null,
        enableHiding: false,
      }),
    ],
    [t, locale, tz, userName, roleName, scopeName, canAssign],
  );

  const revoke = async (reason: string) => {
    if (!revoking) return;
    const action = begin(); // F-DG2-530: every effect below belongs to this session generation
    try {
      await api.send<RoleAssignment>(`/api/v1/role-assignments/${revoking.id}/revoke`, {
        method: "POST",
        body: { reason },
        ifMatch: revoking.version,
      });
    } catch (e) {
      if (!action.stale(e) && e instanceof ApiError && e.status === 409)
        await queryClient.invalidateQueries({ queryKey: ["role-assignments"] });
      throw e; // ReasonDialog shows it, or drops it silently when the session generation moved
    }
    if (!action.run(() => setRevoking(null))) return;
    await queryClient.invalidateQueries({ queryKey: ["role-assignments"] });
  };

  return (
    <>
      <div className="toolbar">
        <ColumnPicker
          columns={[
            { id: "scope", label: t("admin.assignments.scope") },
            { id: "window", label: t("admin.assignments.window") },
            { id: "reason", label: t("common.form.reason") },
            { id: "state", label: t("common.field.status") },
          ]}
          visibility={visibility}
          onChange={setVisibility}
        />
      </div>
      <QueryState
        query={query}
        isEmpty={(d) => d.items.length === 0}
        empty={<EmptyState title={t("admin.assignments.empty")} />}
      >
        {(page) => (
          <>
            <DataTable
              caption={t("admin.assignments.title")}
              data={page.items}
              columns={columns}
              getRowId={(a) => a.id}
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
      {revoking ? (
        <ReasonDialog
          title={t("admin.assignments.revokeTitle", { role: roleName(revoking.roleCode) })}
          description={t("admin.assignments.revokeDescription")}
          confirmLabel={t("admin.assignments.revoke")}
          onConfirm={revoke}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </>
  );
}

export function AssignmentsPage() {
  const { t } = useTranslation();
  const me = useMe();
  usePageTitle(t("admin.assignments.title"));
  const org = useSelectedOrganization();
  const [params, setParams] = useSearchParams();
  const id = useId();
  const userId = params.get("user") ?? "";
  const scopeType = params.get("scopeType") ?? "";
  const includeRevoked = params.get("revoked") === "1";
  const creating = params.get("grant") === "1";
  const canReadUsers = canAnywhere(me, "user.read");
  const users = useAllUsers(org.organizationId, canReadUsers);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  if (!canAnywhere(me, "access.read")) return <NoPermissionState />;
  const canAssign = canOn(me, "access.assign", { level: "organization", organizationId: org.organizationId });
  return (
    <div className="page">
      <PageHeader
        title={t("admin.assignments.title")}
        subtitle={t("admin.assignments.subtitle")}
        crumbs={[{ label: t("nav.areas.admin.label"), to: "/admin" }, { label: t("admin.assignments.title") }]}
        actions={
          canAssign && !creating ? (
            <button type="button" className="button button--primary" onClick={() => set("grant", "1")}>
              <Icon name="plus" /> {t("admin.assignments.new")}
            </button>
          ) : null
        }
      />
      {creating && canAssign ? (
        <GrantForm organizationId={org.organizationId} initialUserId={userId} onDone={() => set("grant", "")} />
      ) : null}
      <form className="filters" aria-label={t("common.filter.title")} onSubmit={(e) => e.preventDefault()}>
        <OrganizationPicker
          organizationId={org.organizationId}
          organizations={org.organizations}
          onSelect={org.select}
        />
        {canReadUsers ? (
          <div className="filters__select">
            <label htmlFor={`${id}-user`}>{t("admin.assignments.user")}</label>
            <select id={`${id}-user`} value={userId} onChange={(e) => set("user", e.target.value)}>
              <option value="">{t("common.filter.any")}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="filters__select">
          <label htmlFor={`${id}-scope`}>{t("admin.assignments.scopeType")}</label>
          <select id={`${id}-scope`} value={scopeType} onChange={(e) => set("scopeType", e.target.value)}>
            <option value="">{t("common.filter.any")}</option>
            {P1_SCOPE_TYPES.map((s) => (
              <option key={s} value={s}>
                {t(`admin.scopeType.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={includeRevoked}
            onChange={(e) => set("revoked", e.target.checked ? "1" : "")}
          />
          {t("admin.assignments.includeRevoked")}
        </label>
      </form>
      <AssignmentsTable
        organizationId={org.organizationId}
        {...(userId ? { userId } : {})}
        {...(scopeType ? { scopeType } : {})}
        includeRevoked={includeRevoked}
      />
    </div>
  );
}

interface GrantValues {
  userId: string;
  roleCode: string;
  scopeType: string;
  scopeId: string;
  effectiveFrom: string;
  effectiveTo: string;
  reason: string;
}

function GrantForm({
  organizationId,
  initialUserId,
  onDone,
}: {
  organizationId: string;
  initialUserId: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const queryClient = useQueryClient();
  const begin = useSessionBoundAction();
  const canReadUsers = canAnywhere(me, "user.read");
  const users = useAllUsers(organizationId, canReadUsers);
  const roles = useRoles();
  const units = useBusinessUnits(organizationId);
  const orgs = useOrganizations();
  const org = (orgs.data ?? [me.organization]).find((o) => o.id === organizationId);
  const tz = org?.defaultTimezone ?? me.organization.defaultTimezone;
  const canListTransformations = canAnywhere(me, "transformation.read");
  const transformations = useTransformations({ sort: "code:asc", limit: 100, organizationId });
  const [serverError, setServerError] = useState<unknown>(null);

  const toPayload = (v: GrantValues) => {
    const out: Record<string, unknown> = {
      userId: v.userId,
      roleCode: v.roleCode,
      scope: { type: v.scopeType, id: v.scopeType === "organization" ? organizationId : v.scopeId.trim() },
      reason: v.reason.trim(),
    };
    if (v.effectiveFrom) out["effectiveFrom"] = zonedLocalToUtcIso(v.effectiveFrom, tz) ?? v.effectiveFrom;
    if (v.effectiveTo) out["effectiveTo"] = zonedLocalToUtcIso(v.effectiveTo, tz) ?? v.effectiveTo;
    return out;
  };
  const { register, handleSubmit, formState, watch, setError } = useForm<GrantValues>({
    defaultValues: {
      userId: initialUserId,
      roleCode: "",
      scopeType: "organization",
      scopeId: "",
      effectiveFrom: "",
      effectiveTo: "",
      reason: "",
    },
    resolver: payloadResolver(roleAssignmentCreate, toPayload),
  });
  const scopeType = watch("scopeType");
  const err = (f: string) => {
    const m = (formState.errors as Record<string, { message?: string } | undefined>)[f]?.message;
    return m ? fieldErrorMessage(t, m) : undefined;
  };
  const onSubmit = handleSubmit(async (v) => {
    const action = begin(); // F-DG2-530: every effect below belongs to this session generation
    setServerError(null);
    try {
      await api.send<RoleAssignment>("/api/v1/role-assignments", { method: "POST", body: toPayload(v) });
      await queryClient.invalidateQueries({ queryKey: ["role-assignments"] });
      if (action.stale()) return;
      onDone();
    } catch (e) {
      if (action.stale(e)) return; // F-DG2-530: silent, the session state was already reset
      if (e instanceof ApiError) {
        for (const fe of e.fieldErrors) {
          const field = pointerToField(fe.pointer)
            .replace(/^scope\.id$/, "scopeId")
            .replace(/^scope\.type$/, "scopeType");
          if (field) setError(field as keyof GrantValues, { type: "server", message: fe.code });
        }
      }
      setServerError(e);
    }
  });

  const userOptions = canReadUsers ? (users.data ?? []).filter((u) => u.status === "active") : [];

  return (
    <form className="card form" onSubmit={(e) => void onSubmit(e)} noValidate aria-labelledby="grant-title">
      <h2 id="grant-title" className="card__title">
        {t("admin.assignments.new")}
      </h2>
      <p className="muted small">{t("admin.assignments.grantNote")}</p>
      {serverError ? (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" /> {errorMessage(t, serverError)}
        </p>
      ) : null}
      <div className="grid grid--2">
        <Field label={t("admin.assignments.user")} error={err("userId")} required>
          {(c) =>
            canReadUsers ? (
              <select {...c} {...register("userId")}>
                <option value="">{t("common.form.choose")}</option>
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                    {u.email ? ` (${u.email})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input {...c} {...register("userId")} dir="ltr" />
            )
          }
        </Field>
        <Field
          label={t("admin.assignments.role")}
          hint={t("admin.assignments.roleHint")}
          error={err("roleCode")}
          required
        >
          {(c) => (
            <select {...c} {...register("roleCode")}>
              <option value="">{t("common.form.choose")}</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.code} value={r.code}>
                  {r.code} · {localName(r, locale)} ({t(`admin.roleKind.${r.kind}`)})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("admin.assignments.scopeType")} error={err("scope.type") ?? err("scopeType")} required>
          {(c) => (
            <select {...c} {...register("scopeType")}>
              {P1_SCOPE_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`admin.scopeType.${s}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {scopeType === "business_unit" ? (
          <Field label={t("admin.scopeType.business_unit")} error={err("scope.id") ?? err("scopeId")} required>
            {(c) => (
              <select {...c} {...register("scopeId")}>
                <option value="">{t("common.form.choose")}</option>
                {(units.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {localName(u, locale)} ({u.code})
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : scopeType === "transformation" ? (
          <Field
            label={t("admin.scopeType.transformation")}
            hint={canListTransformations ? undefined : t("admin.assignments.transformationIdHint")}
            error={err("scope.id") ?? err("scopeId")}
            required
          >
            {(c) =>
              canListTransformations ? (
                <select {...c} {...register("scopeId")}>
                  <option value="">{t("common.form.choose")}</option>
                  {(transformations.data?.items ?? []).map((tr) => (
                    <option key={tr.id} value={tr.id}>
                      {tr.code} · {tr.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input {...c} {...register("scopeId")} dir="ltr" />
              )
            }
          </Field>
        ) : (
          <div className="field">
            <p className="field__label">{t("admin.scopeType.organization")}</p>
            <p>{localName(org, locale)}</p>
          </div>
        )}
        <Field
          label={t("admin.assignments.effectiveFrom")}
          hint={t("admin.assignments.zoneHint", { zone: tz })}
          error={err("effectiveFrom")}
        >
          {(c) => <input {...c} {...register("effectiveFrom")} type="datetime-local" dir="ltr" />}
        </Field>
        <Field
          label={t("admin.assignments.effectiveTo")}
          hint={t("admin.assignments.zoneHint", { zone: tz })}
          error={err("effectiveTo")}
        >
          {(c) => <input {...c} {...register("effectiveTo")} type="datetime-local" dir="ltr" />}
        </Field>
      </div>
      <Field label={t("common.form.reason")} hint={t("common.form.reasonHint")} error={err("reason")} required>
        {(c) => <textarea {...c} {...register("reason")} rows={3} maxLength={1000} />}
      </Field>
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={formState.isSubmitting}>
          {t("admin.assignments.grant")}
        </button>
        <button type="button" className="button button--secondary" onClick={onDone}>
          {t("common.action.cancel")}
        </button>
      </div>
    </form>
  );
}
