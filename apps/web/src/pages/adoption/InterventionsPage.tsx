// Change and Adoption > Adoption interventions (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033 §4). SYNTHETIC data
// only in tests and demos.
//  - REQ-S11-001: an intervention has an owner and a due date (it then appears in the owner's My Work; the work item
//    is the API's). The four B0107 types are offered; `corrective` is created only by the worker (below trajectory).
//  - REQ-PB-069: a below-trajectory intervention shows its origin, and an unresolved owner as "Unassigned" and a
//    missing due date as Unknown with its reason (never a guessed date).
//  - `/transformations/:id/adoption-interventions/:interventionId` is the `adoption_intervention_due` work-item link.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import {
  ADOPTION_INTERVENTION_ORIGINS,
  ADOPTION_INTERVENTION_STATUSES,
  STAKEHOLDER_INTERVENTION_TYPES,
} from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  adoptionPaths,
  useIntervention,
  useInterventions,
  useStakeholderGroups,
  type AdoptionIntervention,
} from "./api.ts";
import { ADOPTION_WRITE_PERMISSIONS, AdoptionSubNav, Code, NS, StatusText, vocabOptions } from "./ui.tsx";

export function InterventionsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="adoption"
      title={t("adoptionP4.interventions.title")}
      subtitle={t("adoptionP4.interventions.intro")}
      writePermissions={ADOPTION_WRITE_PERMISSIONS}
    >
      <InterventionsBody />
    </WorkspaceFrame>
  );
}

export function InterventionPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="adoption"
      title={t("adoptionP4.interventions.detailTitle")}
      writePermissions={ADOPTION_WRITE_PERMISSIONS}
    >
      <InterventionDetail />
    </WorkspaceFrame>
  );
}

/** Owner, or "Unassigned" (label + icon) when the worker found nobody (ADR-0033 §4 step 4). */
export function OwnerCell({ row }: { row: AdoptionIntervention }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  if (row.ownerStatus === "unassigned" || !row.ownerUserId)
    return (
      <span className="status-chip status-chip--unknown" data-owner="unassigned">
        <Icon name="question" /> {t("adoptionP4.interventions.unassigned")}
      </span>
    );
  return <PersonName id={row.ownerUserId} people={byId} />;
}

function interventionColumns(t: (k: string) => string, tid: string, groupName: (id: string | null) => string) {
  const columns: RegisterColumn<AdoptionIntervention>[] = [
    {
      id: "code",
      header: t("adoptionP4.col.code"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link className="link" to={`/transformations/${tid}/adoption-interventions/${r.id}`} data-intervention={r.code}>
          <Code>{r.code}</Code>
        </Link>
      ),
      sortValue: (r) => r.code,
    },
    {
      id: "title",
      header: t("adoptionP4.field.title"),
      cell: (r) => <TextCell value={r.title} />,
      sortValue: (r) => r.title,
    },
    {
      id: "type",
      header: t("adoptionP4.col.intervention"),
      cell: (r) => <span data-type={r.interventionType}>{t(`adoptionP4.intervention.${r.interventionType}`)}</span>,
      filterText: (r) => t(`adoptionP4.intervention.${r.interventionType}`),
    },
    { id: "group", header: t("adoptionP4.col.stakeholder"), cell: (r) => groupName(r.stakeholderGroupId) },
    { id: "owner", header: t("adoptionP4.col.owner"), cell: (r) => <OwnerCell row={r} /> },
    {
      id: "due",
      header: t("adoptionP4.col.due"),
      cell: (r) => <DueDate date={r.dueDate} reason={r.dueUnknownReason} />,
      sortValue: (r) => r.dueDate,
    },
    {
      id: "origin",
      header: t("adoptionP4.col.origin"),
      cell: (r) => <span data-origin={r.origin}>{t(`adoptionP4.origin.${r.origin}`)}</span>,
      filterText: (r) => t(`adoptionP4.origin.${r.origin}`),
    },
    {
      id: "status",
      header: t("adoptionP4.col.status"),
      cell: (r) => <StatusText status={r.status} />,
      sortValue: (r) => ADOPTION_INTERVENTION_STATUSES.indexOf(r.status),
      filterText: (r) => t(`adoptionP4.status.${r.status}`),
    },
  ];
  return columns;
}

function useGroupName(tid: string) {
  const { t } = useTranslation();
  const groups = useStakeholderGroups(tid);
  return (id: string | null) => {
    if (!id) return t("adoptionP4.interventions.noGroup");
    const g = (groups.data ?? []).find((x) => x.id === id);
    return g ? `${g.code} · ${g.name}` : t("adoptionP4.interventions.noGroup");
  };
}

function InterventionsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("");
  const list = useInterventions(ws.tid, { ...(status ? { status } : {}), ...(origin ? { origin } : {}) });
  const groupName = useGroupName(ws.tid);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; row: AdoptionIntervention } | null>(null);
  const columns = [
    ...interventionColumns(t, ws.tid, groupName),
    {
      id: "rowActions",
      header: t("adoptionP4.col.actions"),
      hideable: false,
      cell: (r: AdoptionIntervention) =>
        ws.can("adoption.edit") && (r.status === "planned" || r.status === "in_progress") ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "edit", row: r })}
            data-edit={r.code}
          >
            <Icon name="pencil" /> {t("adoptionP4.edit")}
            <span className="visually-hidden"> {r.code}</span>
          </button>
        ) : null,
    } satisfies RegisterColumn<AdoptionIntervention>,
  ];
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <Section
        id="adoption-interventions"
        title={t("adoptionP4.interventions.tableTitle")}
        actions={
          ws.can("adoption.edit") ? (
            <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
              <Icon name="plus" /> {t("adoptionP4.interventions.create")}
            </button>
          ) : null
        }
      >
        <div className="filters" role="group" aria-label={t("adoptionP4.filters")}>
          <div className="filters__select">
            <label htmlFor="iv-filter-status">{t("adoptionP4.col.status")}</label>
            <select id="iv-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("adoptionP4.all")}</option>
              {ADOPTION_INTERVENTION_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`adoptionP4.status.${v}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="filters__select">
            <label htmlFor="iv-filter-origin">{t("adoptionP4.col.origin")}</label>
            <select id="iv-filter-origin" value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">{t("adoptionP4.all")}</option>
              {ADOPTION_INTERVENTION_ORIGINS.map((v) => (
                <option key={v} value={v}>
                  {t(`adoptionP4.origin.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="adoption-interventions"
              caption={t("adoptionP4.interventions.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(r) => r.id}
              emptyTitle={t("adoptionP4.interventions.empty")}
              defaultSort={{ id: "code", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {dialog?.kind === "create" ? <CreateInterventionDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <EditInterventionDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function CreateInterventionDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const groups = useStakeholderGroups(ws.tid, { status: "active" });
  const fields: P4FieldSpec[] = [
    {
      name: "interventionType",
      label: t("adoptionP4.col.intervention"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "intervention", STAKEHOLDER_INTERVENTION_TYPES),
    },
    { name: "title", label: t("adoptionP4.field.title"), kind: "text", required: true, max: 500 },
    { name: "description", label: t("adoptionP4.field.description"), kind: "textarea", max: 8000 },
    {
      name: "stakeholderGroupId",
      label: t("adoptionP4.col.stakeholder"),
      kind: "select",
      options: (groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })),
    },
    {
      name: "ownerUserId",
      label: t("adoptionP4.col.owner"),
      kind: "select",
      required: true,
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    { name: "dueDate", label: t("adoptionP4.col.due"), kind: "date", required: true },
  ];
  return (
    <P4FormDialog
      title={t("adoptionP4.interventions.create")}
      description={t("adoptionP4.interventions.createIntro")}
      fields={fields}
      initial={{ ownerUserId: ws.meId }}
      submitLabel={t("adoptionP4.interventions.createSubmit")}
      url={adoptionPaths.interventions(ws.tid)}
      namespaces={NS}
      toBody={(v) => ({
        interventionType: v["interventionType"],
        title: v["title"],
        ...(textOf(v["description"]) ? { description: v["description"] } : {}),
        ...(v["stakeholderGroupId"] ? { stakeholderGroupId: v["stakeholderGroupId"] } : {}),
        ownerUserId: v["ownerUserId"],
        dueDate: v["dueDate"],
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function EditInterventionDialog({ row, onClose }: { row: AdoptionIntervention; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const next = row.status === "planned" ? ["in_progress", "done", "cancelled"] : ["done", "cancelled"];
  const initial: P4Values = {
    title: row.title,
    ownerUserId: row.ownerUserId ?? "",
    dueDate: row.dueDate ?? "",
    status: "",
    outcomeNote: "",
  };
  const closing = (v: P4Values) => v["status"] === "done" || v["status"] === "cancelled";
  const fields: P4FieldSpec[] = [
    { name: "title", label: t("adoptionP4.field.title"), kind: "text", required: true, max: 500 },
    {
      name: "ownerUserId",
      label: t("adoptionP4.col.owner"),
      kind: "select",
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    { name: "dueDate", label: t("adoptionP4.col.due"), kind: "date" },
    {
      name: "status",
      label: t("adoptionP4.interventions.moveTo"),
      kind: "select",
      options: next.map((s) => ({ value: s, label: t(`adoptionP4.status.${s}`) })),
    },
    {
      name: "outcomeNote",
      label: t("adoptionP4.interventions.outcomeNote"),
      kind: "textarea",
      required: true,
      min: 3,
      max: 2000,
      when: closing,
    },
  ];
  return (
    <P4FormDialog
      title={t("adoptionP4.interventions.editTitle", { code: row.code })}
      fields={fields}
      initial={initial}
      submitLabel={t("adoptionP4.save")}
      method="PATCH"
      url={adoptionPaths.intervention(ws.tid, row.id)}
      version={row.version}
      namespaces={NS}
      toBody={(v) => {
        const body: Record<string, unknown> = {};
        for (const k of ["title", "ownerUserId", "dueDate"])
          if ((v[k] ?? "") !== (initial[k] ?? "") && v[k] !== "") body[k] = v[k];
        if (v["status"]) body["status"] = v["status"];
        if (closing(v)) body["outcomeNote"] = v["outcomeNote"];
        return Object.keys(body).length === 0 ? { fieldErrors: { title: "validation.empty_patch" } } : body;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function InterventionDetail() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { interventionId = "" } = useParams();
  const query = useIntervention(ws.tid, interventionId);
  const groupName = useGroupName(ws.tid);
  const [editing, setEditing] = useState(false);
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <QueryState query={query}>
        {(r) => (
          <Section
            id="adoption-intervention"
            title={`${r.code} · ${r.title}`}
            actions={
              ws.can("adoption.edit") && (r.status === "planned" || r.status === "in_progress") ? (
                <button type="button" className="button button--primary" onClick={() => setEditing(true)}>
                  <Icon name="pencil" /> {t("adoptionP4.edit")}
                </button>
              ) : null
            }
          >
            <dl className="details" data-intervention-detail={r.code}>
              <dt>{t("adoptionP4.col.intervention")}</dt>
              <dd>{t(`adoptionP4.intervention.${r.interventionType}`)}</dd>
              <dt>{t("adoptionP4.col.stakeholder")}</dt>
              <dd>{groupName(r.stakeholderGroupId)}</dd>
              <dt>{t("adoptionP4.col.owner")}</dt>
              <dd>
                <OwnerCell row={r} />
              </dd>
              <dt>{t("adoptionP4.col.due")}</dt>
              <dd>
                <DueDate date={r.dueDate} reason={r.dueUnknownReason} />
              </dd>
              <dt>{t("adoptionP4.col.origin")}</dt>
              <dd>{t(`adoptionP4.origin.${r.origin}`)}</dd>
              <dt>{t("adoptionP4.col.status")}</dt>
              <dd>
                <StatusText status={r.status} />
              </dd>
              <dt>{t("adoptionP4.field.description")}</dt>
              <dd>
                <TextCell value={r.description} />
              </dd>
              <dt>{t("adoptionP4.interventions.outcomeNote")}</dt>
              <dd>
                <TextCell value={r.outcomeNote} />
              </dd>
            </dl>
            {editing ? <EditInterventionDialog row={r} onClose={() => setEditing(false)} /> : null}
          </Section>
        )}
      </QueryState>
    </>
  );
}
