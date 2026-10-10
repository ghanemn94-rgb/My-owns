// Risks and Actions > Action register (T-DG4-FE-D; p4-work-split §E.5; ADR-0031 §4). SYNTHETIC data only.
//  - One owned action per row with its P4 source (workshop, RAID entry, dependency, corrective case or none), its due
//    date, its follow-up date and the server's `overdue` flag (label + icon, never colour alone).
//  - `/transformations/:id/action-register/:actionItemId` is the work-item link of the `raid_action_due` reminder
//    (apps/api/src/modules/raid/actions.ts), so a reminder never leads to "page not found".
//  - Status changes follow the DG2 action transitions; the server decides (action.edit, or action.update_own on the
//    caller's own actions).
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ACTION_SOURCE_KINDS, RAID_ACTION_STATUSES } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { raidPaths, useActionRegister, useActionRegisterItem, type RaidAction } from "../raid/api.ts";
import {
  ACTION_WRITE_PERMISSIONS,
  dateOrNull,
  NS,
  OverdueFlag,
  RaidSubNav,
  StatusText,
  vocabOptions,
} from "../raid/ui.tsx";

/** The fields of a new action (RAID entry, corrective case). */
export function actionCreateFields(t: TFunction, people: readonly { value: string; label: string }[]): P4FieldSpec[] {
  return [
    { name: "title", label: t("raidP4.actions.col.title"), kind: "text", required: true, max: 500 },
    { name: "description", label: t("raidP4.actions.col.description"), kind: "textarea", max: 4000 },
    { name: "ownerUserId", label: t("raidP4.actions.col.owner"), kind: "select", required: true, options: people },
    { name: "dueDate", label: t("raidP4.actions.col.due"), kind: "date" },
    { name: "followUpDate", label: t("raidP4.actions.col.followUp"), kind: "date" },
  ];
}

export function actionCreateBody(v: P4Values): Record<string, unknown> {
  return {
    title: v["title"],
    ...(textOf(v["description"]) ? { description: v["description"] } : {}),
    ownerUserId: v["ownerUserId"],
    ...(dateOrNull(v["dueDate"]) ? { dueDate: v["dueDate"] } : {}),
    ...(dateOrNull(v["followUpDate"]) ? { followUpDate: v["followUpDate"] } : {}),
  };
}

/** Where an action came from, with a link to its source record. */
export function ActionSource({ action, tid }: { action: RaidAction; tid: string }) {
  const { t } = useTranslation();
  const label = t(`raidP4.actions.source.${action.sourceKind}`);
  const to =
    action.sourceKind === "corrective_case" && action.correctiveCaseId
      ? `/transformations/${tid}/corrective-actions/${action.correctiveCaseId}`
      : action.sourceKind === "raid_entry"
        ? `/transformations/${tid}/raid`
        : action.sourceKind === "dependency"
          ? `/transformations/${tid}/dependencies`
          : action.sourceKind === "workshop"
            ? `/transformations/${tid}/design`
            : null;
  return (
    <span data-source={action.sourceKind}>
      {to ? (
        <Link className="link" to={to}>
          {label}
        </Link>
      ) : (
        label
      )}
    </span>
  );
}

/** The action table used by the register, a RAID entry, a corrective case and a meeting. */
export function ActionsTable({
  id,
  rows,
  compact,
  onEdit,
}: {
  id: string;
  rows: readonly RaidAction[];
  compact?: boolean;
  onEdit?: (a: RaidAction) => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  const columns: RegisterColumn<RaidAction>[] = [
    {
      id: "title",
      header: t("raidP4.actions.col.title"),
      rowHeader: true,
      hideable: false,
      cell: (a) => (
        <Link className="link" to={`/transformations/${ws.tid}/action-register/${a.id}`} data-action-item={a.id}>
          {a.title}
        </Link>
      ),
      sortValue: (a) => a.title,
    },
    {
      id: "source",
      header: t("raidP4.actions.col.source"),
      cell: (a) => <ActionSource action={a} tid={ws.tid} />,
      sortValue: (a) => a.sourceKind,
      filterText: (a) => t(`raidP4.actions.source.${a.sourceKind}`),
    },
    {
      id: "owner",
      header: t("raidP4.actions.col.owner"),
      cell: (a) => <PersonName id={a.ownerUserId} people={byId} />,
      sortValue: (a) => byId.get(a.ownerUserId)?.label ?? a.ownerUserId,
    },
    {
      id: "due",
      header: t("raidP4.actions.col.due"),
      cell: (a) => (a.dueDate ? <DueDate date={a.dueDate} /> : <span className="muted">{t("raidP4.noDueDate")}</span>),
      sortValue: (a) => a.dueDate,
    },
    {
      id: "followUp",
      header: t("raidP4.actions.col.followUp"),
      cell: (a) =>
        a.followUpDate ? <DueDate date={a.followUpDate} /> : <span className="muted">{t("raidP4.noFollowUp")}</span>,
      sortValue: (a) => a.followUpDate,
    },
    {
      id: "status",
      header: t("raidP4.actions.col.status"),
      cell: (a) => (
        <span className="chip-row">
          <StatusText status={a.status} />
          <OverdueFlag overdue={a.overdue} />
        </span>
      ),
      sortValue: (a) => `${a.overdue ? 0 : 1}${a.status}`,
      filterText: (a) => `${t(`raidP4.status.${a.status}`)} ${a.overdue ? t("raidP4.overdue") : ""}`,
    },
    ...(onEdit
      ? [
          {
            id: "rowActions",
            header: t("raidP4.col.actions"),
            hideable: false,
            cell: (a: RaidAction) =>
              ws.canWriteRow("action.edit", "action.update_own", a) ? (
                <button
                  type="button"
                  className="button button--secondary button--small"
                  onClick={() => onEdit(a)}
                  data-edit-action={a.id}
                >
                  <Icon name="pencil" /> {t("raidP4.register.edit")}
                  <span className="visually-hidden"> {a.title}</span>
                </button>
              ) : null,
          } satisfies RegisterColumn<RaidAction>,
        ]
      : []),
  ];
  return (
    <RegisterTable
      id={id}
      caption={t("raidP4.actions.tableTitle")}
      rows={rows}
      columns={columns}
      getRowId={(a) => a.id}
      emptyTitle={t("raidP4.actions.empty")}
      {...(compact ? {} : { emptyBody: t("raidP4.actions.emptyBody") })}
      defaultSort={{ id: "status", dir: "asc" }}
      pageSize={compact ? 5 : 10}
    />
  );
}

export function ActionsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="actions"
      title={t("raidP4.actions.title")}
      subtitle={t("raidP4.actions.intro")}
      writePermissions={ACTION_WRITE_PERMISSIONS}
    >
      <ActionsBody />
    </WorkspaceFrame>
  );
}

function ActionsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [sourceKind, setSourceKind] = useState("");
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState(false);
  const query = {
    ...(sourceKind ? { sourceKind } : {}),
    ...(status ? { status } : {}),
    ...(overdue ? { overdue: "true" } : {}),
  };
  const register = useActionRegister(ws.tid, query);
  const [editing, setEditing] = useState<RaidAction | null>(null);
  return (
    <>
      <RaidSubNav tid={ws.tid} />
      <Section id="action-register" title={t("raidP4.actions.tableTitle")} intro={t("raidP4.actions.tableIntro")}>
        <div className="filters" role="group" aria-label={t("raidP4.register.filters")}>
          <div className="filters__select">
            <label htmlFor="action-filter-source">{t("raidP4.actions.col.source")}</label>
            <select id="action-filter-source" value={sourceKind} onChange={(e) => setSourceKind(e.target.value)}>
              <option value="">{t("raidP4.all")}</option>
              {ACTION_SOURCE_KINDS.map((v) => (
                <option key={v} value={v}>
                  {t(`raidP4.actions.source.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="filters__select">
            <label htmlFor="action-filter-status">{t("raidP4.actions.col.status")}</label>
            <select id="action-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("raidP4.all")}</option>
              {RAID_ACTION_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`raidP4.status.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={overdue}
              onChange={(e) => setOverdue(e.target.checked)}
              data-filter="overdue"
            />
            {t("raidP4.actions.overdueOnly")}
          </label>
        </div>
        <QueryState query={register}>
          {(rows) => <ActionsTable id="action-register" rows={rows} onEdit={setEditing} />}
        </QueryState>
      </Section>
      {editing ? <EditActionDialog action={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

export function EditActionDialog({ action, onClose }: { action: RaidAction; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const initial: P4Values = {
    title: action.title,
    description: action.description ?? "",
    ownerUserId: action.ownerUserId,
    dueDate: action.dueDate ?? "",
    followUpDate: action.followUpDate ?? "",
    status: action.status,
  };
  const fields: P4FieldSpec[] = [
    ...actionCreateFields(
      t,
      people.map((p) => ({ value: p.id, label: p.label })),
    ),
    {
      name: "status",
      label: t("raidP4.actions.col.status"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "status", RAID_ACTION_STATUSES),
    },
  ];
  return (
    <P4FormDialog
      title={t("raidP4.actions.editTitle")}
      fields={fields}
      initial={initial}
      submitLabel={t("raidP4.form.save")}
      method="PATCH"
      url={raidPaths.action(ws.tid, action.id)}
      version={action.version}
      namespaces={NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {};
        for (const f of fields) {
          const now = v[f.name] ?? "";
          if (now === (initial[f.name] ?? "")) continue;
          body[f.name] = now === "" ? null : now;
        }
        return Object.keys(body).length === 0 ? { fieldErrors: { title: "validation.empty_patch" } } : body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

/** `/transformations/:id/action-register/:actionItemId`: one action (the `raid_action_due` work-item link). */
export function ActionItemPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="actions" title={t("raidP4.actions.itemTitle")} writePermissions={ACTION_WRITE_PERMISSIONS}>
      <ActionItemBody />
    </WorkspaceFrame>
  );
}

function ActionItemBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { actionItemId = "" } = useParams();
  const item = useActionRegisterItem(ws.tid, actionItemId);
  const { byId } = usePeople(ws.tid);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <RaidSubNav tid={ws.tid} />
      <QueryState query={item}>
        {(a) => (
          <Section
            id="action-item"
            title={a.title}
            actions={
              ws.canWriteRow("action.edit", "action.update_own", a) ? (
                <button type="button" className="button button--secondary" onClick={() => setEditing(true)}>
                  <Icon name="pencil" /> {t("raidP4.register.edit")}
                </button>
              ) : null
            }
          >
            <dl className="details" data-action-item={a.id}>
              <div>
                <dt>{t("raidP4.actions.col.description")}</dt>
                <dd>
                  <TextCell value={a.description} />
                </dd>
              </div>
              <div>
                <dt>{t("raidP4.actions.col.source")}</dt>
                <dd>
                  <ActionSource action={a} tid={ws.tid} />
                </dd>
              </div>
              <div>
                <dt>{t("raidP4.actions.col.owner")}</dt>
                <dd>
                  <PersonName id={a.ownerUserId} people={byId} />
                </dd>
              </div>
              <div>
                <dt>{t("raidP4.actions.col.due")}</dt>
                <dd>{a.dueDate ? <DueDate date={a.dueDate} /> : t("raidP4.noDueDate")}</dd>
              </div>
              <div>
                <dt>{t("raidP4.actions.col.followUp")}</dt>
                <dd>{a.followUpDate ? <DueDate date={a.followUpDate} /> : t("raidP4.noFollowUp")}</dd>
              </div>
              <div>
                <dt>{t("raidP4.actions.col.status")}</dt>
                <dd className="chip-row">
                  <StatusText status={a.status} />
                  <OverdueFlag overdue={a.overdue} />
                </dd>
              </div>
            </dl>
            {editing ? <EditActionDialog action={a} onClose={() => setEditing(false)} /> : null}
          </Section>
        )}
      </QueryState>
    </>
  );
}
