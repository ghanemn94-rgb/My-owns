// Capacity editing (T-DG3-FE-E; REQ-PB-059, REQ-S09-004; ADR-0023 §6; T-DG3-BE-E §2 and §7). SYNTHETIC data in tests.
//  - Resourcing roles: create (code, EN and AR labels), edit the labels, archive. A taken code is 409
//    `resource_role.code_taken`; using an archived role is 422 `resource_role.archived`. Both translated.
//  - Capacity rows per role and month: create and edit the available FTE (a decimal string, `numeric(6,2)`), owner and
//    note. A second active row for the same role and month is 409 `capacity.duplicate`.
//  - Resource demand per initiative, role and month: create, and edit while it is planned (422
//    `resource_demand.not_planned` otherwise). Commit and release stay on the demand table (CapacityPage).
//  - Every save runs useP3Refresh, which invalidates the ["capacity", tid, …] entries: the grid's conflict indicator
//    and shortfall are re-read from the server after each save. Unknown capacity stays Unknown (never 0).
// Roles are resourcing roles ("Data engineer"), not access roles. Requires `capacity.edit` (TL, WL, TO by default).
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { api } from "../../api/client.ts";
import { fetchAllPages, p3Keys, shouldRetry, useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Dialog } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldOption, type FieldSpec } from "../../components/RecordForm.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { intlLocale } from "../../lib/format.ts";
import { FormAlert, TableRegion, isVersionConflict, p3ErrorMessage, useDecimal } from "../prioritization/p3ui.tsx";
import type { ResourceDemand, ResourceRole } from "./api.ts";

/** Problem codes of these forms are translated from the `capacity` namespace first. */
export const CAPACITY_NS: readonly string[] = ["capacity"];

/** Contract `Capacity`. availableFte is an exact decimal string. */
export type CapacityRow = {
  readonly id: string;
  readonly transformationId: string;
  readonly resourceRoleId: string;
  readonly periodMonth: string;
  readonly availableFte: string;
  readonly ownerUserId: string | null;
  readonly note: string | null;
  readonly status: "active" | "archived";
  readonly version: number;
};

export function useResourceRoles(tid: string) {
  return useQuery({
    queryKey: [...p3Keys.capacity(tid), "roles"] as const,
    queryFn: async () =>
      (await api.get<{ items: ResourceRole[] }>(`/api/v1/transformations/${tid}/resource-roles`)).items,
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

export function useCapacityRows(tid: string) {
  return useQuery({
    queryKey: [...p3Keys.capacity(tid), "rows"] as const,
    queryFn: () => fetchAllPages<CapacityRow>("/api/v1/capacity", { transformationId: tid }),
    enabled: Boolean(tid),
    retry: shouldRetry,
  });
}

/** Localized "Nov 2026" of a "YYYY-MM-01" period (calendar month, no time-zone shift). */
export function monthLabel(locale: "en" | "ar", period: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(period)) return period;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${period}T00:00:00Z`),
  );
}

/** Month options "YYYY-MM-01": 6 months back to 24 ahead of today, plus any month already recorded. */
export function monthOptions(locale: "en" | "ar", extra: readonly string[] = [], today = new Date()): FieldOption[] {
  const months = new Set(extra.filter((m) => /^\d{4}-\d{2}-01$/.test(m)));
  for (let k = -6; k <= 24; k++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + k, 1));
    months.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`);
  }
  return [...months].sort().map((m) => ({ value: m, label: monthLabel(locale, m) }));
}

const fteHint = (t: TFunction) => t("capacity.edit.fteHint");

// ------------------------------------------------------------------------------------------------ roles

export function RolesSection({ onConflict }: { onConflict: () => void }) {
  const { t } = useTranslation();
  const { tid, can } = useWorkspace();
  const roles = useResourceRoles(tid);
  const refresh = useP3Refresh(tid);
  const [editing, setEditing] = useState<{ kind: "create" } | { kind: "edit"; r: ResourceRole } | null>(null);
  const [archiving, setArchiving] = useState<ResourceRole | null>(null);
  const canEdit = can("capacity.edit");
  const createFields: FieldSpec[] = [
    {
      name: "code",
      kind: "text",
      label: t("capacity.roles.code"),
      hint: t("capacity.roles.codeHint"),
      required: true,
      maxLength: 48,
      dir: "ltr",
      createOnly: true,
    },
    { name: "labelEn", kind: "text", label: t("capacity.roles.labelEn"), required: true, maxLength: 200, dir: "ltr" },
    { name: "labelAr", kind: "text", label: t("capacity.roles.labelAr"), required: true, maxLength: 200, dir: "rtl" },
  ];
  const close = async () => {
    if (!(await refresh())) return;
    setEditing(null);
  };
  return (
    <Section
      id="roles"
      title={t("capacity.roles.title")}
      intro={t("capacity.roles.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--secondary button--small"
            data-action="add-role"
            onClick={() => setEditing({ kind: "create" })}
          >
            <Icon name="plus" /> {t("capacity.roles.add")}
          </button>
        ) : null
      }
    >
      <QueryState
        query={roles}
        isEmpty={(r) => r.length === 0}
        empty={<p className="muted">{t("capacity.roles.empty")}</p>}
      >
        {(list) => (
          <TableRegion label={t("capacity.roles.caption")}>
            <table className="table table--compact" data-testid="roles">
              <caption>{t("capacity.roles.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("capacity.roles.code")}</th>
                  <th scope="col">{t("capacity.roles.labelEn")}</th>
                  <th scope="col">{t("capacity.roles.labelAr")}</th>
                  <th scope="col">{t("capacity.roles.status")}</th>
                  {canEdit ? <th scope="col">{t("capacity.demands.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} data-role-row={r.code} data-status={r.status}>
                    <th scope="row">
                      <bdi dir="ltr" className="code">
                        {r.code}
                      </bdi>
                    </th>
                    <td lang="en" dir="ltr">
                      {r.labelEn}
                    </td>
                    <td lang="ar" dir="rtl">
                      {r.labelAr}
                    </td>
                    <td>
                      {r.status === "archived" ? (
                        <span>
                          <Icon name="lock" /> {t("capacity.status.archived")}
                        </span>
                      ) : (
                        t("capacity.status.active")
                      )}
                    </td>
                    {canEdit ? (
                      <td>
                        {r.status === "active" ? (
                          <div className="toolbar">
                            <button
                              type="button"
                              className="button button--secondary button--small"
                              onClick={() => setEditing({ kind: "edit", r })}
                            >
                              {t("capacity.edit.edit")}
                              <span className="visually-hidden">: {r.code}</span>
                            </button>
                            <button
                              type="button"
                              className="button button--secondary button--small"
                              onClick={() => setArchiving(r)}
                            >
                              {t("capacity.roles.archive")}
                              <span className="visually-hidden">: {r.code}</span>
                            </button>
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </QueryState>
      {editing?.kind === "create" ? (
        <RecordDialog
          title={t("capacity.roles.addTitle")}
          fields={createFields}
          record={null}
          createUrl={`/api/v1/transformations/${tid}/resource-roles`}
          namespaces={CAPACITY_NS}
          submitLabel={t("capacity.roles.add")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "edit" ? (
        <RecordDialog<ResourceRole>
          title={t("capacity.roles.editTitle", { code: editing.r.code })}
          fields={createFields}
          record={editing.r}
          updateUrl={(r) => `/api/v1/transformations/${tid}/resource-roles/${r.id}`}
          loadLatest={async (r) => {
            const all = await api.get<{ items: ResourceRole[] }>(`/api/v1/transformations/${tid}/resource-roles`);
            const latest = all.items.find((x) => x.id === r.id);
            if (!latest) throw new Error("role not found");
            return latest;
          }}
          namespaces={CAPACITY_NS}
          submitLabel={t("common.action.save")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {archiving ? (
        <ConfirmPatchDialog
          title={t("capacity.roles.archiveTitle", { code: archiving.code })}
          body={t("capacity.roles.archiveBody")}
          confirmLabel={t("capacity.roles.archive")}
          url={`/api/v1/transformations/${tid}/resource-roles/${archiving.id}`}
          version={archiving.version}
          patch={{ status: "archived" }}
          onConflict={onConflict}
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </Section>
  );
}

/** A confirmation that sends one PATCH with If-Match; one translated alert; a 409 shows the page conflict notice. */
function ConfirmPatchDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  url: string;
  version: number;
  patch: Record<string, unknown>;
  onConflict: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { tid } = useWorkspace();
  const refresh = useP3Refresh(tid);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setError(null);
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(props.url, { method: "PATCH", body: props.patch, ifMatch: props.version });
      if (action.stale()) return;
      if (!(await refresh())) return;
      props.onClose();
    } catch (e) {
      if (action.stale(e)) return;
      if (isVersionConflict(e)) {
        props.onClose();
        props.onConflict();
        await refresh();
        return;
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={props.onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("common.state.saving") : props.confirmLabel}
          </button>
        </>
      }
    >
      <p>{props.body}</p>
      <FormAlert message={error ? p3ErrorMessage(t, error) : null} />
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------------ capacity rows

export function CapacityRowsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { tid, can } = useWorkspace();
  const roles = useResourceRoles(tid);
  const rows = useCapacityRows(tid);
  const { people, byId } = usePeople(tid);
  const refresh = useP3Refresh(tid);
  const fmt = useDecimal();
  const [editing, setEditing] = useState<{ kind: "create" } | { kind: "edit"; c: CapacityRow } | null>(null);
  const canEdit = can("capacity.edit");
  const roleList = roles.data ?? [];
  const roleLabel = (id: string) => {
    const r = roleList.find((x) => x.id === id);
    return r ? (locale === "ar" ? r.labelAr : r.labelEn) : null;
  };
  const fields: FieldSpec[] = [
    {
      name: "resourceRoleId",
      kind: "select",
      label: t("capacity.grid.role"),
      required: true,
      createOnly: true,
      options: roleList
        .filter((r) => r.status === "active")
        .map((r) => ({ value: r.id, label: locale === "ar" ? r.labelAr : r.labelEn })),
    },
    {
      name: "periodMonth",
      kind: "select",
      label: t("capacity.demands.month"),
      required: true,
      createOnly: true,
      options: monthOptions(
        locale,
        (rows.data ?? []).map((c) => c.periodMonth),
      ),
    },
    {
      name: "availableFte",
      kind: "decimal",
      label: t("capacity.edit.availableFte"),
      hint: fteHint(t),
      required: true,
    },
    { name: "ownerUserId", kind: "person", label: t("capacity.edit.owner") },
    { name: "note", kind: "textarea", label: t("capacity.edit.note"), maxLength: 2000 },
  ];
  const close = async () => {
    if (!(await refresh())) return;
    setEditing(null);
  };
  const active = (rows.data ?? []).filter((c) => c.status === "active");
  return (
    <Section
      id="capacity-rows"
      title={t("capacity.rows.title")}
      intro={t("capacity.rows.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--secondary button--small"
            data-action="add-capacity"
            onClick={() => setEditing({ kind: "create" })}
          >
            <Icon name="plus" /> {t("capacity.rows.add")}
          </button>
        ) : null
      }
    >
      <QueryState
        query={rows}
        isEmpty={() => active.length === 0}
        empty={<p className="muted">{t("capacity.rows.empty")}</p>}
      >
        {() => (
          <TableRegion label={t("capacity.rows.caption")}>
            <table className="table table--compact" data-testid="capacity-rows">
              <caption>{t("capacity.rows.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("capacity.grid.role")}</th>
                  <th scope="col">{t("capacity.demands.month")}</th>
                  <th scope="col">{t("capacity.edit.availableFte")}</th>
                  <th scope="col">{t("capacity.edit.owner")}</th>
                  {canEdit ? <th scope="col">{t("capacity.demands.actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {[...active]
                  .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth))
                  .map((c) => (
                    <tr key={c.id} data-capacity-row={c.periodMonth}>
                      <th scope="row">{roleLabel(c.resourceRoleId) ?? <Unknown />}</th>
                      <td>{monthLabel(locale, c.periodMonth)}</td>
                      <td>
                        <bdi data-fte={c.availableFte}>{fmt(c.availableFte, 0, 2)}</bdi>
                      </td>
                      <td>
                        {c.ownerUserId ? (
                          <PersonName id={c.ownerUserId} people={byId} />
                        ) : (
                          <span className="muted">{t("common.value.none")}</span>
                        )}
                      </td>
                      {canEdit ? (
                        <td>
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            onClick={() => setEditing({ kind: "edit", c })}
                          >
                            {t("capacity.edit.edit")}
                            <span className="visually-hidden">
                              : {roleLabel(c.resourceRoleId)} {monthLabel(locale, c.periodMonth)}
                            </span>
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
              </tbody>
            </table>
          </TableRegion>
        )}
      </QueryState>
      {editing?.kind === "create" ? (
        <RecordDialog
          title={t("capacity.rows.addTitle")}
          fields={fields}
          record={null}
          createUrl="/api/v1/capacity"
          extra={{ transformationId: tid }}
          people={people}
          namespaces={CAPACITY_NS}
          submitLabel={t("capacity.rows.add")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "edit" ? (
        <RecordDialog<CapacityRow>
          title={t("capacity.rows.editTitle", {
            role: roleLabel(editing.c.resourceRoleId) ?? "",
            month: monthLabel(locale, editing.c.periodMonth),
          })}
          fields={fields}
          record={editing.c}
          updateUrl={(r) => `/api/v1/capacity/${r.id}`}
          people={people}
          namespaces={CAPACITY_NS}
          submitLabel={t("common.action.save")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ demand forms

export interface DemandInitiative {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

const CLOSED = new Set(["cancelled", "completed"]);

/** Create a resource demand, or edit a planned one (FTE, month, owner, note). */
export function DemandDialog({
  demand,
  initiatives,
  onClose,
}: {
  demand: ResourceDemand | null;
  initiatives: readonly DemandInitiative[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { tid } = useWorkspace();
  const roles = useResourceRoles(tid);
  const { people } = usePeople(tid);
  const refresh = useP3Refresh(tid);
  const fields: FieldSpec[] = [
    {
      name: "initiativeId",
      kind: "select",
      label: t("capacity.demands.initiative"),
      required: true,
      createOnly: true,
      options: initiatives
        .filter((i) => !CLOSED.has(i.status) || i.id === demand?.initiativeId)
        .map((i) => ({ value: i.id, label: `${i.code} ${i.name}` })),
    },
    {
      name: "resourceRoleId",
      kind: "select",
      label: t("capacity.grid.role"),
      required: true,
      createOnly: true,
      options: (roles.data ?? [])
        .filter((r) => r.status === "active" || r.id === demand?.resourceRoleId)
        .map((r) => ({ value: r.id, label: locale === "ar" ? r.labelAr : r.labelEn })),
    },
    {
      name: "periodMonth",
      kind: "select",
      label: t("capacity.demands.month"),
      required: true,
      options: monthOptions(locale, demand ? [demand.periodMonth] : []),
    },
    { name: "demandFte", kind: "decimal", label: t("capacity.edit.demandFte"), hint: fteHint(t), required: true },
    { name: "ownerUserId", kind: "person", label: t("capacity.edit.owner") },
    { name: "note", kind: "textarea", label: t("capacity.edit.note"), maxLength: 2000 },
  ];
  const done = async () => {
    if (!(await refresh())) return;
    onClose();
  };
  return demand === null ? (
    <RecordDialog
      title={t("capacity.demands.addTitle")}
      fields={fields}
      record={null}
      createUrl="/api/v1/resource-demands"
      people={people}
      namespaces={CAPACITY_NS}
      submitLabel={t("capacity.demands.add")}
      onSaved={done}
      onCancel={onClose}
    />
  ) : (
    <RecordDialog<ResourceDemand>
      title={t("capacity.demands.editTitle")}
      description={t("capacity.demands.editBody")}
      fields={fields}
      record={demand}
      updateUrl={(r) => `/api/v1/resource-demands/${r.id}`}
      people={people}
      namespaces={CAPACITY_NS}
      submitLabel={t("common.action.save")}
      onSaved={done}
      onCancel={onClose}
    />
  );
}
