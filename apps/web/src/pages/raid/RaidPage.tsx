// Risks and Actions > RAID (T15) (T-DG4-FE-D; p4-work-split §E.5; ADR-0031 §1-§3 and its 2026-10-09 amendment A1).
// SYNTHETIC data only in tests and demos.
//  - The nine T15 columns (B0128): ID, Type, Description, Impact, Probability, Owner, Due, Mitigation / action, Status.
//    Probability is H/M/L for a Risk and "n/a" for Assumption, Issue and Dependency (REQ-PB-080); the Mitigation /
//    action cell carries its per-type header (Action, Validate, Resolve, Mitigate).
//  - A Dependency entry IS the canonical T08 dependency (REQ-PB-078): it links to T08, is created with a required
//    'To' initiative (amendment A1.3), has no 'In progress' (A1.1), and once closed shows no closure fields: its note
//    lives in the dependency's record history (A1.2).
//  - Type outside the four is refused by the server (400 raid.type_invalid); the form only offers the four.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { RAID_ENTRY_TYPES, RAID_LEVELS } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { Dialog } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import { ActionsTable, actionCreateFields, actionCreateBody } from "../actions/ActionsPage.tsx";
import { raidPaths, useRaidEntries, useRaidEntryActions, useRaidInitiativeOptions, type RaidEntry } from "./api.ts";
import {
  Code,
  dateOrNull,
  LevelCell,
  NS,
  RAID_WRITE_PERMISSIONS,
  RaidSubNav,
  StatusText,
  TypeLabel,
  vocabOptions,
} from "./ui.tsx";

/** The per-type header of the Mitigation / action column (B0128: Action, Validate, Resolve, Mitigate). */
export const MITIGATION_HEADER: Record<string, string> = {
  risk: "action",
  assumption: "validate",
  issue: "resolve",
  dependency: "mitigate",
};

export function RaidPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="raid"
      title={t("raidP4.register.title")}
      subtitle={t("raidP4.register.intro")}
      writePermissions={[...RAID_WRITE_PERMISSIONS, "dependency.edit", "action.edit"]}
    >
      <RaidBody />
    </WorkspaceFrame>
  );
}

function RaidBody() {
  const ws = useWorkspace();
  return (
    <>
      <RaidSubNav tid={ws.tid} />
      <Register />
    </>
  );
}

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; entry: RaidEntry }
  | { kind: "close"; entry: RaidEntry }
  | { kind: "actions"; entry: RaidEntry };

function Register() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const query = { ...(type ? { type } : {}), ...(status ? { status } : {}) };
  const entries = useRaidEntries(ws.tid, query);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const canEdit = (e: RaidEntry) => ws.can(e.type === "dependency" ? "dependency.edit" : "raid.edit");
  const columns: RegisterColumn<RaidEntry>[] = [
    {
      id: "code",
      header: t("raidP4.col.id"),
      rowHeader: true,
      hideable: false,
      cell: (e) => <Code>{e.code}</Code>,
      sortValue: (e) => e.code,
    },
    {
      id: "type",
      header: t("raidP4.col.type"),
      cell: (e) => <TypeLabel type={e.type} />,
      sortValue: (e) => RAID_ENTRY_TYPES.indexOf(e.type),
      filterText: (e) => t(`raidP4.type.${e.type}`),
    },
    {
      id: "description",
      header: t("raidP4.col.description"),
      cell: (e) => (
        <span className="block">
          <TextCell value={e.description} />
          {e.recordTable === "dependency" ? (
            <Link className="link block small" to={`/transformations/${ws.tid}/dependencies`} data-t08-link={e.id}>
              {t("raidP4.register.openT08")}
            </Link>
          ) : null}
        </span>
      ),
      sortValue: (e) => e.description,
    },
    {
      id: "impact",
      header: t("raidP4.col.impact"),
      cell: (e) => <LevelCell level={e.impact} />,
      sortValue: (e) => (e.impact ? RAID_LEVELS.indexOf(e.impact) : null),
    },
    {
      id: "probability",
      header: t("raidP4.col.probability"),
      cell: (e) => <LevelCell level={e.probability} notApplicable={e.type !== "risk"} />,
      sortValue: (e) => (e.probability ? RAID_LEVELS.indexOf(e.probability) : null),
    },
    {
      id: "owner",
      header: t("raidP4.col.owner"),
      cell: (e) => <PersonName id={e.ownerUserId} people={byId} />,
      sortValue: (e) => (e.ownerUserId ? (byId.get(e.ownerUserId)?.label ?? e.ownerUserId) : null),
    },
    {
      id: "due",
      header: t("raidP4.col.due"),
      cell: (e) => (e.dueDate ? <DueDate date={e.dueDate} /> : <span className="muted">{t("raidP4.noDueDate")}</span>),
      sortValue: (e) => e.dueDate,
    },
    {
      id: "mitigation",
      header: t("raidP4.col.mitigation"),
      cell: (e) => (
        <span className="block" data-mitigation-header={MITIGATION_HEADER[e.type]}>
          <strong className="small">{t(`raidP4.mitigationHeader.${MITIGATION_HEADER[e.type]}`)}:</strong>{" "}
          <TextCell value={e.mitigation} />
        </span>
      ),
      filterText: (e) => e.mitigation,
    },
    {
      id: "status",
      header: t("raidP4.col.status"),
      cell: (e) => <EntryStatus entry={e} />,
      sortValue: (e) => e.status,
      filterText: (e) => t(`raidP4.status.${e.status}`),
    },
    {
      id: "rowActions",
      header: t("raidP4.col.actions"),
      hideable: false,
      cell: (e) => (
        <span className="chip-row">
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "actions", entry: e })}
            data-entry-actions={e.code}
          >
            {t("raidP4.register.entryActions")}
            <span className="visually-hidden"> {e.code}</span>
          </button>
          {e.status !== "closed" && canEdit(e) ? (
            <>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setDialog({ kind: "edit", entry: e })}
                data-edit={e.code}
              >
                <Icon name="pencil" /> {t("raidP4.register.edit")}
                <span className="visually-hidden"> {e.code}</span>
              </button>
              <button
                type="button"
                className="button button--secondary button--small"
                onClick={() => setDialog({ kind: "close", entry: e })}
                data-close={e.code}
              >
                <Icon name="check" /> {t("raidP4.register.close")}
                <span className="visually-hidden"> {e.code}</span>
              </button>
            </>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Section
      id="raid-register"
      title={t("raidP4.register.tableTitle")}
      intro={t("raidP4.register.tableIntro")}
      actions={
        ws.can("raid.edit") ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("raidP4.register.create")}
          </button>
        ) : null
      }
    >
      <div className="filters" role="group" aria-label={t("raidP4.register.filters")}>
        <div className="filters__select">
          <label htmlFor="raid-filter-type">{t("raidP4.col.type")}</label>
          <select id="raid-filter-type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{t("raidP4.all")}</option>
            {RAID_ENTRY_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`raidP4.type.${v}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="filters__select">
          <label htmlFor="raid-filter-status">{t("raidP4.col.status")}</label>
          <select id="raid-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("raidP4.all")}</option>
            {["open", "in_progress", "closed"].map((v) => (
              <option key={v} value={v}>
                {t(`raidP4.status.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <QueryState query={entries}>
        {(rows) => (
          <RegisterTable
            id="raid-register"
            caption={t("raidP4.register.tableTitle")}
            rows={rows}
            columns={columns}
            getRowId={(e) => e.id}
            emptyTitle={t("raidP4.register.empty")}
            emptyBody={t("raidP4.register.emptyBody")}
            defaultSort={{ id: "code", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" ? <CreateEntryDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <EditEntryDialog entry={dialog.entry} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "close" ? <CloseEntryDialog entry={dialog.entry} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "actions" ? <EntryActionsDialog entry={dialog.entry} onClose={() => setDialog(null)} /> : null}
    </Section>
  );
}

/** Status: Open / In progress / Closed. A closed Dependency was resolved on T08 and carries no closure fields (A1.2). */
function EntryStatus({ entry }: { entry: RaidEntry }) {
  const { t } = useTranslation();
  return (
    <span className="block" data-entry-status={entry.status}>
      <StatusText status={entry.status} />
      {entry.status === "closed" && entry.recordTable === "dependency" ? (
        <span className="block small muted" data-closure="record-history">
          {t("raidP4.register.dependencyClosed")}
        </span>
      ) : null}
      {entry.status === "closed" && entry.recordTable === "raid_entry" && entry.closureNote ? (
        <span className="block small" data-closure="note">
          {t("raidP4.register.closureNote")}: {entry.closureNote}
        </span>
      ) : null}
    </span>
  );
}

function useEntryFieldOptions(tid: string) {
  const { people } = usePeople(tid);
  const initiatives = useRaidInitiativeOptions(tid);
  return {
    people: people.map((p) => ({ value: p.id, label: p.label })),
    initiatives: (initiatives.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })),
  };
}

function CreateEntryDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const options = useEntryFieldOptions(ws.tid);
  const isDep = (v: P4Values) => v["type"] === "dependency";
  const fields: P4FieldSpec[] = [
    {
      name: "type",
      label: t("raidP4.col.type"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "type", RAID_ENTRY_TYPES),
    },
    { name: "description", label: t("raidP4.col.description"), kind: "textarea", required: true, max: 4000 },
    {
      name: "impact",
      label: t("raidP4.col.impact"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "level", RAID_LEVELS),
    },
    {
      name: "probability",
      label: t("raidP4.col.probability"),
      kind: "select",
      required: true,
      hint: t("raidP4.form.probabilityHint"),
      options: vocabOptions(t, "level", RAID_LEVELS),
      when: (v) => v["type"] === "risk",
    },
    { name: "ownerUserId", label: t("raidP4.col.owner"), kind: "select", required: true, options: options.people },
    { name: "dueDate", label: t("raidP4.col.due"), kind: "date" },
    { name: "mitigation", label: t("raidP4.col.mitigation"), kind: "textarea", max: 4000 },
    {
      name: "initiativeId",
      label: t("raidP4.form.initiative"),
      kind: "select",
      options: options.initiatives,
      when: (v) => !isDep(v),
    },
    {
      name: "fromInitiativeId",
      label: t("raidP4.form.fromInitiative"),
      kind: "select",
      hint: t("raidP4.form.fromHint"),
      options: options.initiatives,
      when: isDep,
    },
    {
      name: "toInitiativeId",
      label: t("raidP4.form.toInitiative"),
      kind: "select",
      required: true,
      hint: t("raidP4.form.toHint"),
      options: options.initiatives,
      when: isDep,
    },
  ];
  return (
    <P4FormDialog
      title={t("raidP4.register.create")}
      description={t("raidP4.form.createIntro")}
      fields={fields}
      initial={{ type: "", impact: "", ownerUserId: ws.meId }}
      submitLabel={t("raidP4.register.createSubmit")}
      url={raidPaths.entries(ws.tid)}
      namespaces={NS}
      toBody={(v) => ({
        type: v["type"],
        description: v["description"],
        impact: v["impact"],
        ...(v["type"] === "risk" ? { probability: v["probability"] } : {}),
        ownerUserId: v["ownerUserId"],
        ...(dateOrNull(v["dueDate"]) ? { dueDate: v["dueDate"] } : {}),
        ...(textOf(v["mitigation"]) ? { mitigation: v["mitigation"] } : {}),
        ...(!isDep(v) && v["initiativeId"] ? { initiativeId: v["initiativeId"] } : {}),
        ...(isDep(v) && v["fromInitiativeId"] ? { fromInitiativeId: v["fromInitiativeId"] } : {}),
        ...(isDep(v) ? { toInitiativeId: v["toInitiativeId"] } : {}),
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function EditEntryDialog({ entry, onClose }: { entry: RaidEntry; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const options = useEntryFieldOptions(ws.tid);
  const isDep = entry.type === "dependency";
  const initial: P4Values = {
    description: entry.description,
    impact: entry.impact ?? "",
    probability: entry.probability ?? "",
    ownerUserId: entry.ownerUserId ?? "",
    dueDate: entry.dueDate ?? "",
    mitigation: entry.mitigation ?? "",
    status: entry.status,
  };
  const fields: P4FieldSpec[] = [
    { name: "description", label: t("raidP4.col.description"), kind: "textarea", required: true, max: 4000 },
    {
      name: "impact",
      label: t("raidP4.col.impact"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "level", RAID_LEVELS),
    },
    ...(entry.type === "risk"
      ? [
          {
            name: "probability",
            label: t("raidP4.col.probability"),
            kind: "select",
            required: true,
            options: vocabOptions(t, "level", RAID_LEVELS),
          } satisfies P4FieldSpec,
        ]
      : []),
    { name: "ownerUserId", label: t("raidP4.col.owner"), kind: "select", required: true, options: options.people },
    { name: "dueDate", label: t("raidP4.col.due"), kind: "date" },
    { name: "mitigation", label: t("raidP4.col.mitigation"), kind: "textarea", max: 4000 },
    // A Dependency entry has no 'In progress' (amendment A1.1): its status changes only by closing it.
    ...(isDep
      ? []
      : [
          {
            name: "status",
            label: t("raidP4.col.status"),
            kind: "select",
            required: true,
            options: vocabOptions(t, "status", ["open", "in_progress"]),
          } satisfies P4FieldSpec,
        ]),
  ];
  return (
    <P4FormDialog
      title={t("raidP4.register.editTitle", { code: entry.code })}
      description={isDep ? t("raidP4.form.dependencyEditIntro") : undefined}
      fields={fields}
      initial={initial}
      submitLabel={t("raidP4.form.save")}
      method="PATCH"
      url={raidPaths.entry(ws.tid, entry.id)}
      version={entry.version}
      namespaces={NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {};
        for (const f of fields) {
          const now = v[f.name] ?? "";
          if (now === (initial[f.name] ?? "")) continue;
          body[f.name] = now === "" ? null : now;
        }
        return Object.keys(body).length === 0 ? { fieldErrors: { description: "validation.empty_patch" } } : body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function CloseEntryDialog({ entry, onClose }: { entry: RaidEntry; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("raidP4.register.closeTitle", { code: entry.code })}
      description={entry.type === "dependency" ? t("raidP4.form.dependencyCloseIntro") : t("raidP4.form.closeIntro")}
      fields={[
        {
          name: "closureNote",
          label: t("raidP4.register.closureNote"),
          kind: "textarea",
          required: true,
          min: 3,
          max: 2000,
        },
      ]}
      submitLabel={t("raidP4.register.close")}
      url={raidPaths.close(ws.tid, entry.id)}
      version={entry.version}
      namespaces={NS}
      toBody={(v) => ({ closureNote: v["closureNote"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

/** The actions of one RAID entry (source = this entry), with "add action". */
function EntryActionsDialog({ entry, onClose }: { entry: RaidEntry; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const actions = useRaidEntryActions(ws.tid, entry.id);
  const { people } = usePeople(ws.tid);
  const [adding, setAdding] = useState(false);
  if (adding)
    return (
      <P4FormDialog
        title={t("raidP4.actions.addTitle", { code: entry.code })}
        fields={actionCreateFields(
          t,
          people.map((p) => ({ value: p.id, label: p.label })),
        )}
        initial={{ ownerUserId: ws.meId }}
        submitLabel={t("raidP4.actions.add")}
        url={raidPaths.entryActions(ws.tid, entry.id)}
        namespaces={NS}
        toBody={actionCreateBody}
        onDone={refresh}
        onClose={() => setAdding(false)}
      />
    );
  return (
    <Dialog
      title={t("raidP4.actions.ofEntry", { code: entry.code })}
      onClose={onClose}
      footer={
        <>
          {ws.can("action.edit") && entry.status !== "closed" ? (
            <button type="button" className="button button--primary" onClick={() => setAdding(true)}>
              <Icon name="plus" /> {t("raidP4.actions.add")}
            </button>
          ) : null}
          <button type="button" className="button button--secondary" onClick={onClose}>
            {t("raidP4.closeDialog")}
          </button>
        </>
      }
    >
      <QueryState query={actions}>
        {(rows) => <ActionsTable id={`raid-entry-actions-${entry.id}`} rows={rows} compact />}
      </QueryState>
    </Dialog>
  );
}
