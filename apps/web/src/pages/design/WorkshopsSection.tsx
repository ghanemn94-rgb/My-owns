// Workshop mode (REQ-PB-042): TOM design workshops with their contributions and unresolved items. An unresolved item
// is converted, by a person, into a T04 design decision (status Open) or an owned action; the item then links to the
// new record. A workshop with open unresolved items cannot be closed (the server answers 422).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  tomWorkshopCreate,
  tomWorkshopItemConversion,
  tomWorkshopItemCreate,
  tomWorkshopUpdate,
} from "@mth/shared/schemas";
import { api } from "../../api/client.ts";
import { useP2Refresh, useRegister, useWorkshopItems } from "../../api/queries.ts";
import type { ActionItem, TomWorkshop, TomWorkshopItem } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { tomDimensionLabel, tomDimensionOptions } from "../../lib/methodology.ts";
import { errorMessage } from "../../lib/problem.ts";

export function WorkshopsSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const workshops = useRegister<TomWorkshop>(ws.tid, "tom-workshops");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: TomWorkshop | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const canFacilitate = ws.can("workshop.facilitate");

  const fields: FieldSpec[] = [
    { name: "title", kind: "text", label: t("design.workshops.titleField"), required: true, maxLength: 300 },
    { name: "workshopDate", kind: "date", label: t("design.workshops.date"), required: true },
    {
      name: "durationMinutes",
      kind: "integer",
      label: t("design.workshops.duration"),
      required: true,
      min: 15,
      max: 480,
    },
    { name: "agenda", kind: "textarea", label: t("design.workshops.agenda"), rows: 4 },
    { name: "facilitatorUserId", kind: "person", label: t("design.workshops.facilitator"), required: true },
  ];
  const columns: RegisterColumn<TomWorkshop>[] = [
    {
      id: "title",
      header: t("design.workshops.titleField"),
      cell: (w) => w.title,
      sortValue: (w) => w.title,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "date",
      header: t("design.workshops.date"),
      cell: (w) => formatBusinessDate(w.workshopDate, locale),
      sortValue: (w) => w.workshopDate,
    },
    {
      id: "duration",
      header: t("design.workshops.duration"),
      cell: (w) => t("design.workshops.minutes", { n: w.durationMinutes }),
      sortValue: (w) => w.durationMinutes,
    },
    {
      id: "facilitator",
      header: t("design.workshops.facilitator"),
      cell: (w) => <PersonName id={w.facilitatorUserId} people={byId} />,
    },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (w) => <RecordStatus status={w.status} />,
      sortValue: (w) => w.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (w) => (
        <span className="row-actions">
          <button
            type="button"
            className="button button--link button--small"
            aria-expanded={openId === w.id}
            aria-controls="workshop-mode"
            onClick={() => setOpenId(openId === w.id ? null : w.id)}
          >
            <Icon name="info" /> {t("design.workshops.open")}
            <span className="visually-hidden">: {w.title}</span>
          </button>
          {canFacilitate && w.status !== "closed" ? (
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => setDialog({ record: w })}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
              <span className="visually-hidden">: {w.title}</span>
            </button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Section
      id="workshops"
      title={t("design.workshops.title")}
      intro={t("design.workshops.intro")}
      actions={
        canFacilitate ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("design.workshops.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={workshops}>
        {(list) => {
          const open = list.find((w) => w.id === openId) ?? null;
          return (
            <>
              <RegisterTable
                id="workshops"
                caption={t("design.workshops.title")}
                rows={list}
                columns={columns}
                getRowId={(w) => w.id}
                emptyTitle={t("design.workshops.empty")}
                defaultSort={{ id: "date", dir: "desc" }}
              />
              <div id="workshop-mode" aria-live="polite">
                {open ? <WorkshopMode workshop={open} onClose={() => setOpenId(null)} /> : null}
              </div>
            </>
          );
        }}
      </QueryState>
      {dialog ? (
        <RecordDialog<TomWorkshop>
          title={dialog.record ? t("design.workshops.editTitle") : t("design.workshops.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ facilitatorUserId: ws.meId, durationMinutes: 90 }}
          createSchema={tomWorkshopCreate}
          updateSchema={tomWorkshopUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/tom-workshops`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/tom-workshops/${r.id}`}
          people={people}
          submitLabel={dialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setDialog(null);
          }}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </Section>
  );
}

function WorkshopMode({ workshop, onClose }: { workshop: TomWorkshop; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const items = useWorkshopItems(ws.tid, workshop.id);
  const actions = useRegister<ActionItem>(ws.tid, "actions");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [adding, setAdding] = useState(false);
  const [converting, setConverting] = useState<TomWorkshopItem | null>(null);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const canFacilitate = ws.can("workshop.facilitate");
  const canContribute = ws.canAny("tom.edit", "tom.contribute", "workshop.facilitate");
  const closed = workshop.status === "closed";

  const setStatus = async (status: "in_progress" | "closed") => {
    setBusy(true);
    setStatusError(null);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/tom-workshops/${workshop.id}`, {
        method: "PATCH",
        body: { status },
        ifMatch: workshop.version,
      });
      await refresh();
    } catch (e) {
      setStatusError(e);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const itemFields: FieldSpec[] = [
    {
      name: "kind",
      kind: "select",
      label: t("design.workshops.itemKind"),
      required: true,
      options: (["contribution", "unresolved"] as const).map((k) => ({
        value: k,
        label: t(`design.workshops.itemKinds.${k}`),
      })),
    },
    {
      name: "dimensionCode",
      kind: "select",
      label: t("design.dimension"),
      options: tomDimensionOptions(ws.methodology, locale),
    },
    { name: "body", kind: "textarea", label: t("design.workshops.itemBody"), required: true, maxLength: 4000 },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];
  const convertFields: FieldSpec[] = [
    {
      name: "target",
      kind: "select",
      label: t("design.workshops.convertTarget"),
      required: true,
      options: [
        { value: "design_decision", label: t("design.workshops.targets.design_decision") },
        { value: "action", label: t("design.workshops.targets.action") },
      ],
    },
    { name: "title", kind: "text", label: t("design.workshops.convertTitle"), required: true, maxLength: 500 },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner"), required: true },
    { name: "dueDate", kind: "date", label: t("design.workshops.dueDate") },
  ];
  const columns: RegisterColumn<TomWorkshopItem>[] = [
    {
      id: "body",
      header: t("design.workshops.itemBody"),
      cell: (i) => <TextCell value={i.body} />,
      sortValue: (i) => i.body,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "kind",
      header: t("design.workshops.itemKind"),
      cell: (i) => t(`design.workshops.itemKinds.${i.kind}`),
      sortValue: (i) => i.kind,
    },
    {
      id: "dimension",
      header: t("design.dimension"),
      cell: (i) =>
        tomDimensionLabel(ws.methodology, i.dimensionCode, locale) ?? (
          <span className="muted">{t("common.value.none")}</span>
        ),
    },
    { id: "owner", header: t("common.field.owner"), cell: (i) => <PersonName id={i.ownerUserId} people={byId} /> },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (i) => (
        <span>
          <RecordStatus status={i.status} />
          {i.convertedDecisionId ? (
            <span className="block small">{t("design.workshops.convertedToDecision")}</span>
          ) : null}
          {i.convertedActionId ? (
            <span className="block small">
              {t("design.workshops.convertedToAction", {
                title: actions.data?.find((a) => a.id === i.convertedActionId)?.title ?? t("common.value.unknown"),
              })}
            </span>
          ) : null}
        </span>
      ),
      sortValue: (i) => i.status,
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (i) =>
        canFacilitate && i.kind === "unresolved" && i.status === "open" ? (
          <button type="button" className="button button--link button--small" onClick={() => setConverting(i)}>
            <Icon name="refresh" /> {t("design.workshops.convert")}
            <span className="visually-hidden">: {i.body}</span>
          </button>
        ) : (
          <span className="muted small">{t("common.value.none")}</span>
        ),
    },
  ];

  return (
    <section className="workshop-mode" aria-labelledby="workshop-mode-title" data-workshop={workshop.id}>
      <div className="card__header">
        <h3 id="workshop-mode-title" className="card__subtitle">
          {t("design.workshops.modeTitle", { title: workshop.title })} <RecordStatus status={workshop.status} />
        </h3>
        <span className="section__actions">
          {canContribute && !closed ? (
            <button type="button" className="button button--secondary button--small" onClick={() => setAdding(true)}>
              <Icon name="plus" /> {t("design.workshops.addItem")}
            </button>
          ) : null}
          {canFacilitate && workshop.status === "planned" ? (
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={busy}
              onClick={() => void setStatus("in_progress")}
            >
              {t("design.workshops.start")}
            </button>
          ) : null}
          {canFacilitate && workshop.status === "in_progress" ? (
            <button
              type="button"
              className="button button--secondary button--small"
              disabled={busy}
              onClick={() => void setStatus("closed")}
            >
              {t("design.workshops.close")}
            </button>
          ) : null}
          <button type="button" className="button button--secondary button--small" onClick={onClose}>
            {t("common.action.close")}
          </button>
        </span>
      </div>
      {workshop.agenda ? <p className="text-cell">{workshop.agenda}</p> : null}
      {statusError ? (
        <p className="banner banner--error" role="alert" data-state="error">
          <Icon name="alert" /> {errorMessage(t, statusError)}
        </p>
      ) : null}
      <QueryState query={items}>
        {(list) => {
          const unresolved = list.filter((i) => i.kind === "unresolved" && i.status === "open").length;
          return (
            <>
              <p
                className={`banner ${unresolved > 0 ? "banner--warning" : "banner--info"}`}
                role="status"
                data-unresolved={unresolved}
              >
                <Icon name={unresolved > 0 ? "alert" : "info"} />{" "}
                {t("design.workshops.unresolvedCount", { n: unresolved })}
              </p>
              <RegisterTable
                id="workshop-items"
                caption={t("design.workshops.items")}
                rows={list}
                columns={columns}
                getRowId={(i) => i.id}
                emptyTitle={t("design.workshops.noItems")}
              />
            </>
          );
        }}
      </QueryState>
      {adding ? (
        <RecordDialog<TomWorkshopItem>
          title={t("design.workshops.addItem")}
          fields={itemFields}
          record={null}
          defaults={{ kind: "contribution", ownerUserId: ws.meId }}
          createSchema={tomWorkshopItemCreate}
          createUrl={`/api/v1/transformations/${ws.tid}/tom-workshops/${workshop.id}/items`}
          people={people}
          submitLabel={t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {converting ? (
        <ConvertDialog
          item={converting}
          fields={convertFields}
          people={people}
          onDone={async () => {
            await refresh();
            setConverting(null);
          }}
          onCancel={() => setConverting(null)}
        />
      ) : null}
    </section>
  );
}

/** Conversion is a POST with If-Match (the item's version); reuses the record form for validation and errors. */
function ConvertDialog({
  item,
  fields,
  people,
  onDone,
  onCancel,
}: {
  item: TomWorkshopItem;
  fields: FieldSpec[];
  people: ReturnType<typeof usePeople>["people"];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const url = `/api/v1/transformations/${ws.tid}/tom-workshops/${item.workshopId}/items/${item.id}/convert`;
  return (
    <RecordDialog<TomWorkshopItem>
      title={t("design.workshops.convertDialog")}
      description={item.body}
      fields={fields}
      record={null}
      defaults={{ target: "design_decision", title: item.body.slice(0, 500), ownerUserId: item.ownerUserId ?? ws.meId }}
      createSchema={tomWorkshopItemConversion}
      createUrl={url}
      createIfMatch={item.version}
      people={people}
      submitLabel={t("design.workshops.convert")}
      onSaved={onDone}
      onCancel={onCancel}
    />
  );
}
