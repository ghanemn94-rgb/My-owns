// BAU and Improvement > Continuous-improvement backlog (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0034 §8).
// SYNTHETIC data only in tests and demos.
//  - REQ-PB-084: CI items stay visible and editable after the transformation is closed (no status of the
//    transformation hides or freezes them; only an archived transformation is read-only, as everywhere).
//  - An item names its source (manual, a lesson, a control check, a review, a handover); closing it (done or rejected)
//    needs a resolution note, and done/rejected are final.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IMPROVEMENT_ITEM_STATUSES, IMPROVEMENT_PRIORITIES } from "@mth/shared/schemas";
import { useP4Refresh } from "../../api/p4.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec, type P4Values } from "../my-work/p4ui.tsx";
import {
  sustainPaths,
  useImprovementItems,
  useLessons,
  usePerformanceAreas,
  type ImprovementItem,
} from "../bau/api.ts";
import { Code, NS, StatusText, SustainSubNav, vocabOptions } from "../bau/ui.tsx";

export function ImprovementPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="improvement"
      title={t("sustainP4.improvement.title")}
      subtitle={t("sustainP4.improvement.intro")}
      writePermissions={["improvement.edit"]}
    >
      <ImprovementBody />
    </WorkspaceFrame>
  );
}

const OPEN = new Set(["open", "in_progress"]);

function ImprovementBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const list = useImprovementItems(ws.tid, status ? { status } : {});
  const areas = usePerformanceAreas(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit"; row: ImprovementItem } | null>(null);
  const canEdit = ws.can("improvement.edit");
  const areaCode = (id: string | null) => (id ? ((areas.data ?? []).find((a) => a.id === id)?.code ?? "—") : null);
  const columns: RegisterColumn<ImprovementItem>[] = [
    {
      id: "code",
      header: t("sustainP4.col.code"),
      rowHeader: true,
      hideable: false,
      cell: (i) => <Code>{i.code}</Code>,
      sortValue: (i) => i.code,
    },
    {
      id: "title",
      header: t("sustainP4.improvement.itemTitle"),
      cell: (i) => <TextCell value={i.title} />,
      sortValue: (i) => i.title,
    },
    {
      id: "area",
      header: t("sustainP4.handover.area"),
      cell: (i) =>
        areaCode(i.performanceAreaId) ? (
          <Code>{areaCode(i.performanceAreaId)}</Code>
        ) : (
          <span className="muted">{t("sustainP4.none")}</span>
        ),
    },
    {
      id: "priority",
      header: t("sustainP4.improvement.priority"),
      cell: (i) =>
        i.priority ? t(`sustainP4.priority.${i.priority}`) : <span className="muted">{t("sustainP4.none")}</span>,
      sortValue: (i) => (i.priority ? IMPROVEMENT_PRIORITIES.indexOf(i.priority) : null),
    },
    {
      id: "owner",
      header: t("sustainP4.col.owner"),
      cell: (i) =>
        i.ownerUserId ? (
          <PersonName id={i.ownerUserId} people={byId} />
        ) : (
          <span className="muted">{t("common.value.notAssigned")}</span>
        ),
    },
    {
      id: "target",
      header: t("sustainP4.improvement.targetDate"),
      cell: (i) =>
        i.targetDate ? <DueDate date={i.targetDate} /> : <span className="muted">{t("sustainP4.none")}</span>,
      sortValue: (i) => i.targetDate,
    },
    { id: "source", header: t("sustainP4.improvement.source"), cell: (i) => t(`sustainP4.sourceKind.${i.sourceKind}`) },
    {
      id: "status",
      header: t("sustainP4.col.status"),
      cell: (i) => (
        <span className="block">
          <StatusText status={i.status} />
          {i.resolutionNote ? <span className="block small">{i.resolutionNote}</span> : null}
        </span>
      ),
      sortValue: (i) => IMPROVEMENT_ITEM_STATUSES.indexOf(i.status),
      filterText: (i) => t(`sustainP4.status.${i.status}`),
    },
    {
      id: "rowActions",
      header: t("sustainP4.col.actions"),
      hideable: false,
      cell: (i) =>
        canEdit && OPEN.has(i.status) ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "edit", row: i })}
            data-edit={i.code}
          >
            <Icon name="pencil" /> {t("sustainP4.edit")}
            <span className="visually-hidden"> {i.code}</span>
          </button>
        ) : null,
    },
  ];
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <Section
        id="improvement-backlog"
        title={t("sustainP4.improvement.tableTitle")}
        intro={t("sustainP4.improvement.afterClosure")}
        actions={
          canEdit ? (
            <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
              <Icon name="plus" /> {t("sustainP4.improvement.create")}
            </button>
          ) : null
        }
      >
        <div className="filters" role="group" aria-label={t("sustainP4.filters")}>
          <div className="filters__select">
            <label htmlFor="ci-filter-status">{t("sustainP4.col.status")}</label>
            <select id="ci-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("sustainP4.all")}</option>
              {IMPROVEMENT_ITEM_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`sustainP4.status.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <QueryState query={list}>
          {(rows) => (
            <RegisterTable
              id="improvement-backlog"
              caption={t("sustainP4.improvement.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(i) => i.id}
              emptyTitle={t("sustainP4.improvement.empty")}
              defaultSort={{ id: "code", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {dialog?.kind === "create" ? <ItemDialog onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <ItemDialog item={dialog.row} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function ItemDialog({ item, onClose }: { item?: ImprovementItem; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const areas = usePerformanceAreas(ws.tid);
  const lessons = useLessons(ws.tid);
  const next = item
    ? item.status === "open"
      ? ["in_progress", "done", "rejected"]
      : ["open", "done", "rejected"]
    : [];
  const closing = (v: P4Values) => v["status"] === "done" || v["status"] === "rejected";
  const fields: P4FieldSpec[] = [
    { name: "title", label: t("sustainP4.improvement.itemTitle"), kind: "text", required: true, max: 300 },
    { name: "description", label: t("sustainP4.field.description"), kind: "textarea", max: 8000 },
    {
      name: "performanceAreaId",
      label: t("sustainP4.handover.area"),
      kind: "select",
      options: (areas.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
    },
    {
      name: "ownerUserId",
      label: t("sustainP4.col.owner"),
      kind: "select",
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: "priority",
      label: t("sustainP4.improvement.priority"),
      kind: "select",
      options: vocabOptions(t, "priority", IMPROVEMENT_PRIORITIES),
    },
    { name: "targetDate", label: t("sustainP4.improvement.targetDate"), kind: "date" },
    ...(item
      ? [
          {
            name: "status",
            label: t("sustainP4.improvement.moveTo"),
            kind: "select",
            options: next.map((s) => ({ value: s, label: t(`sustainP4.status.${s}`) })),
          } satisfies P4FieldSpec,
          {
            name: "resolutionNote",
            label: t("sustainP4.improvement.resolutionNote"),
            kind: "textarea",
            required: true,
            min: 3,
            max: 2000,
            when: closing,
          } satisfies P4FieldSpec,
        ]
      : [
          {
            name: "sourceKind",
            label: t("sustainP4.improvement.source"),
            kind: "select",
            required: true,
            options: ["manual", "lesson"].map((k) => ({ value: k, label: t(`sustainP4.sourceKind.${k}`) })),
          } satisfies P4FieldSpec,
          {
            name: "sourceId",
            label: t("sustainP4.sourceKind.lesson"),
            kind: "select",
            required: true,
            options: (lessons.data ?? []).map((l) => ({ value: l.id, label: `${l.code} · ${l.title}` })),
            when: (v) => v["sourceKind"] === "lesson",
          } satisfies P4FieldSpec,
        ]),
  ];
  const initial: P4Values = item
    ? {
        title: item.title,
        description: item.description ?? "",
        performanceAreaId: item.performanceAreaId ?? "",
        ownerUserId: item.ownerUserId ?? "",
        priority: item.priority ?? "",
        targetDate: item.targetDate ?? "",
        status: "",
      }
    : { sourceKind: "manual" };
  const build = (v: P4Values): Record<string, unknown> => ({
    title: v["title"],
    description: textOf(v["description"]) ?? null,
    performanceAreaId: v["performanceAreaId"] ? v["performanceAreaId"] : null,
    ownerUserId: v["ownerUserId"] ? v["ownerUserId"] : null,
    priority: v["priority"] ? v["priority"] : null,
    targetDate: v["targetDate"] ? v["targetDate"] : null,
  });
  return (
    <P4FormDialog
      title={item ? t("sustainP4.improvement.editTitle", { code: item.code }) : t("sustainP4.improvement.create")}
      fields={fields}
      initial={initial}
      submitLabel={item ? t("sustainP4.save") : t("sustainP4.improvement.createSubmit")}
      method={item ? "PATCH" : "POST"}
      url={item ? sustainPaths.improvementItem(ws.tid, item.id) : sustainPaths.improvement(ws.tid)}
      {...(item ? { version: item.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if (!item)
          return {
            ...Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null)),
            sourceKind: v["sourceKind"],
            ...(v["sourceKind"] === "lesson" ? { sourceId: v["sourceId"] } : {}),
          };
        const before = build(initial);
        const patch: Record<string, unknown> = Object.fromEntries(
          Object.entries(body).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(before[k])),
        );
        if (v["status"]) patch["status"] = v["status"];
        if (closing(v)) patch["resolutionNote"] = v["resolutionNote"];
        return Object.keys(patch).length === 0 ? { fieldErrors: { title: "validation.empty_patch" } } : patch;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}
