// Deliverables and milestones on the Initiative Card (T-DG3-FE-E; ADR-0023 §2-§3; REQ-PB-045 "Key deliverables 3-7",
// REQ-S09-006). SYNTHETIC data only in tests and demos.
//  - Deliverables: create, edit and archive (title, description, owner, due date) with `initiative.edit`. Archive is a
//    PATCH with a required `archiveReason` and If-Match (ActionDialog; never a delete). The 3-7 count is the server's `countWarning`: a warning,
//    never a block.
//  - Milestones: create (`initiative.edit`) and edit (`roadmap.edit`: title, description, owner, wave, forecast date).
//    The approved (baseline) date is set only by approve-date on the roadmap, so it is never an edit field here.
//  - A cancelled or completed initiative shows these read-only; a write that races a closure is refused by the server
//    with 422 `initiative.read_only`, translated (`portfolio.problem.*`) as the dialog's one alert.
//  - Every save runs useP3Refresh, which invalidates the card parts AND the single ["roadmap", tid] entry, so the
//    roadmap's timeline, table and board follow.
import { deliverableCreate, deliverableUpdate, milestoneCreate } from "@mth/shared/schemas";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useDeliverables, useMilestones, useWaves } from "../../api/portfolio.ts";
import { useP3Refresh } from "../../api/queries.ts";
import type { Deliverable, Initiative, Milestone } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { ActionDialog, PORTFOLIO_NS, waveName } from "./common.tsx";

type DeliverableEdit = { kind: "create" } | { kind: "edit"; d: Deliverable } | { kind: "archive"; d: Deliverable };

export function DeliverablesSection({ initiative: i, readOnly }: { initiative: Initiative; readOnly: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useDeliverables(ws.tid, i.id);
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [editing, setEditing] = useState<DeliverableEdit | null>(null);
  const canEdit = !readOnly && ws.can("initiative.edit");
  const fields: FieldSpec[] = [
    { name: "title", kind: "text", label: t("portfolio.deliverable.fieldTitle"), required: true, maxLength: 300 },
    {
      name: "description",
      kind: "textarea",
      label: t("portfolio.deliverable.description"),
      maxLength: 4000,
    },
    { name: "ownerUserId", kind: "person", label: t("portfolio.deliverable.owner") },
    { name: "dueDate", kind: "date", label: t("portfolio.deliverable.dueDate") },
  ];
  const close = async () => {
    if (!(await refresh())) return;
    setEditing(null);
  };
  return (
    <Section
      id="deliverables"
      title={t("portfolio.deliverable.title")}
      intro={t("portfolio.deliverable.intro")}
      actions={
        <>
          {canEdit ? (
            <button
              type="button"
              className="button button--secondary button--small"
              data-action="add-deliverable"
              onClick={() => setEditing({ kind: "create" })}
            >
              <Icon name="plus" /> {t("portfolio.deliverable.add")}
            </button>
          ) : null}
          <Link className="link" to={`/transformations/${ws.tid}/roadmap`}>
            {t("portfolio.card.openRoadmap")}
          </Link>
        </>
      }
    >
      <QueryState query={list}>
        {(d) => {
          const active = d.items.filter((x) => x.status === "active").sort((a, b) => a.ordinal - b.ordinal);
          return (
            <>
              <p data-deliverable-count={active.length}>{t("portfolio.deliverable.count", { count: active.length })}</p>
              {d.countWarning ? (
                <p className="banner banner--warning" role="note" data-warning={d.countWarning.code}>
                  <Icon name="alert" /> {t("portfolio.warning.initiative__deliverable_count")}{" "}
                  {t("portfolio.deliverable.notABlock")}
                </p>
              ) : null}
              {active.length === 0 ? null : (
                <ul className="plain-list">
                  {active.map((x) => (
                    <li key={x.id} data-deliverable={x.id}>
                      <bdi dir="ltr">{x.ordinal}.</bdi> <span className="text-cell">{x.title}</span>{" "}
                      <span className="small muted">
                        <PersonName id={x.ownerUserId} people={byId} /> ·{" "}
                        {formatBusinessDate(x.dueDate, locale) ?? t("common.value.none")} ·{" "}
                        {t(`portfolio.deliverable.acceptance.${x.acceptanceStatus}`)}
                      </span>
                      {canEdit ? (
                        <span className="toolbar">
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            onClick={() => setEditing({ kind: "edit", d: x })}
                          >
                            {t("portfolio.deliverable.edit")}
                            <span className="visually-hidden">: {x.title}</span>
                          </button>
                          <button
                            type="button"
                            className="button button--secondary button--small"
                            onClick={() => setEditing({ kind: "archive", d: x })}
                          >
                            {t("portfolio.deliverable.archive")}
                            <span className="visually-hidden">: {x.title}</span>
                          </button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        }}
      </QueryState>
      {editing?.kind === "create" ? (
        <RecordDialog
          title={t("portfolio.deliverable.addTitle", { code: i.code })}
          fields={fields}
          record={null}
          createSchema={deliverableCreate}
          createUrl={`/api/v1/initiatives/${i.id}/deliverables`}
          people={people}
          namespaces={PORTFOLIO_NS}
          submitLabel={t("portfolio.deliverable.add")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "edit" ? (
        <RecordDialog<Deliverable>
          title={t("portfolio.deliverable.editTitle", { title: editing.d.title })}
          fields={fields}
          record={editing.d}
          updateSchema={deliverableUpdate}
          updateUrl={(r) => `/api/v1/deliverables/${r.id}`}
          people={people}
          namespaces={PORTFOLIO_NS}
          submitLabel={t("common.action.save")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "archive" ? (
        <ActionDialog
          title={t("portfolio.deliverable.archiveTitle", { title: editing.d.title })}
          description={<p>{t("portfolio.deliverable.archiveBody")}</p>}
          text={{
            label: t("portfolio.deliverable.archiveReason"),
            name: "archiveReason",
            required: true,
            min: 3,
            max: 1000,
          }}
          confirmLabel={t("portfolio.deliverable.archive")}
          url={`/api/v1/deliverables/${editing.d.id}`}
          method="PATCH"
          version={editing.d.version}
          namespaces={PORTFOLIO_NS}
          onDone={refresh}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}

export function MilestonesSection({ initiative: i, readOnly }: { initiative: Initiative; readOnly: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const list = useMilestones(ws.tid, i.id);
  const waves = useWaves(ws.tid);
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [editing, setEditing] = useState<{ kind: "create" } | { kind: "edit"; m: Milestone } | null>(null);
  const canCreate = !readOnly && ws.can("initiative.edit");
  const canEdit = !readOnly && ws.can("roadmap.edit");
  const fields: FieldSpec[] = [
    { name: "title", kind: "text", label: t("portfolio.milestone.fieldTitle"), required: true, maxLength: 300 },
    { name: "description", kind: "textarea", label: t("portfolio.milestone.description"), maxLength: 4000 },
    { name: "ownerUserId", kind: "person", label: t("portfolio.milestone.owner") },
    {
      name: "waveId",
      kind: "select",
      label: t("portfolio.field.wave"),
      options: (waves.data ?? [])
        .filter((w) => w.status === "active")
        .map((w) => ({ value: w.id, label: waveName(w, locale) ?? w.code })),
    },
    {
      name: "forecastDate",
      kind: "date",
      label: t("portfolio.milestone.forecast"),
      hint: t("portfolio.milestone.forecastHint"),
    },
  ];
  const close = async () => {
    if (!(await refresh())) return;
    setEditing(null);
  };
  return (
    <Section
      id="milestones"
      title={t("portfolio.milestone.title")}
      intro={t("portfolio.milestone.intro")}
      actions={
        <>
          {canCreate ? (
            <button
              type="button"
              className="button button--secondary button--small"
              data-action="add-milestone"
              onClick={() => setEditing({ kind: "create" })}
            >
              <Icon name="plus" /> {t("portfolio.milestone.add")}
            </button>
          ) : null}
          <Link className="link" to={`/transformations/${ws.tid}/roadmap`}>
            {t("portfolio.card.openRoadmap")}
          </Link>
        </>
      }
    >
      <QueryState query={list}>
        {(items) =>
          items.length === 0 ? (
            <p className="muted" data-state="empty">
              {t("portfolio.milestone.empty")}
            </p>
          ) : (
            <ul className="plain-list">
              {items.map((m) => (
                <li key={m.id} data-milestone={m.id}>
                  <span className="text-cell">{m.title}</span>{" "}
                  <span className="small muted">
                    {t("portfolio.milestone.approved")}:{" "}
                    {formatBusinessDate(m.approvedDate, locale) ?? t("portfolio.milestone.notApproved")} ·{" "}
                    {t("portfolio.milestone.forecast")}:{" "}
                    {formatBusinessDate(m.forecastDate, locale) ?? t("common.value.none")}
                    {m.ownerUserId ? (
                      <>
                        {" · "}
                        <PersonName id={m.ownerUserId} people={byId} />
                      </>
                    ) : null}
                  </span>
                  {canEdit ? (
                    <button
                      type="button"
                      className="button button--secondary button--small"
                      onClick={() => setEditing({ kind: "edit", m })}
                    >
                      {t("portfolio.milestone.edit")}
                      <span className="visually-hidden">: {m.title}</span>
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
      {editing?.kind === "create" ? (
        <RecordDialog
          title={t("portfolio.milestone.addTitle", { code: i.code })}
          fields={fields}
          record={null}
          defaults={{ waveId: i.waveId }}
          createSchema={milestoneCreate}
          createUrl={`/api/v1/initiatives/${i.id}/milestones`}
          people={people}
          namespaces={PORTFOLIO_NS}
          submitLabel={t("portfolio.milestone.add")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
      {editing?.kind === "edit" ? (
        <RecordDialog<Milestone>
          title={t("portfolio.milestone.editTitle", { title: editing.m.title })}
          fields={fields}
          record={editing.m}
          updateUrl={(r) => `/api/v1/milestones/${r.id}`}
          people={people}
          namespaces={PORTFOLIO_NS}
          submitLabel={t("common.action.save")}
          onSaved={close}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </Section>
  );
}
