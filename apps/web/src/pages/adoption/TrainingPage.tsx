// Change and Adoption > Training and observed proficiency (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033 §6).
// SYNTHETIC data only in tests and demos.
//  - REQ-PB-072: training completion and observed proficiency are two separate measures, shown side by side for a
//    stakeholder group. Completion never counts as proficiency: with no observation in the period, proficiency is
//    Unknown with its reason ("not adopted" is never inferred), whatever the completion.
//  - REQ-S11-002: proficiency observations come from the assessment forms (or a direct observation by a recorder);
//    each one links to its stakeholder group and is listed here.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useP4Refresh } from "../../api/p4.ts";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { DueDate, P4FormDialog, textOf, type P4FieldSpec } from "../my-work/p4ui.tsx";
import {
  adoptionPaths,
  useAdoptionIndicators,
  useAssessmentRecords,
  useIndicatorTemplates,
  useInterventions,
  useStakeholderGroups,
  useTrainingRecords,
  type AssessmentRecord,
  type TrainingRecord,
} from "./api.ts";
import {
  AdoptionSubNav,
  isNoReportingPeriod,
  MeasureName,
  MeasureValue,
  NoReportingPeriod,
  NS,
  StatusText,
} from "./ui.tsx";

export function TrainingPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="adoption"
      title={t("adoptionP4.training.title")}
      subtitle={t("adoptionP4.training.intro")}
      writePermissions={["proficiency.record"]}
    >
      <TrainingBody />
    </WorkspaceFrame>
  );
}

function TrainingBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const groups = useStakeholderGroups(ws.tid, { status: "active" });
  const [groupId, setGroupId] = useState("");
  const chosen = groupId || groups.data?.[0]?.id || "";
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <div className="filters" role="group" aria-label={t("adoptionP4.training.groupLabel")}>
        <div className="filters__select">
          <label htmlFor="training-group">{t("adoptionP4.col.stakeholder")}</label>
          <select id="training-group" value={chosen} onChange={(e) => setGroupId(e.target.value)}>
            {(groups.data ?? []).length === 0 ? <option value="">{t("adoptionP4.training.noGroups")}</option> : null}
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} · {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {chosen ? (
        <>
          <SideBySide groupId={chosen} />
          <TrainingRecords groupId={chosen} />
          <Observations groupId={chosen} />
        </>
      ) : (
        <p className="muted">{t("adoptionP4.training.noGroupsBody")}</p>
      )}
    </>
  );
}

/** The two measures of indicator 4 for one group, side by side (never merged, never derived from one another). */
function SideBySide({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const templates = useIndicatorTemplates();
  const report = useAdoptionIndicators(ws.tid, "stakeholder_group", groupId);
  const keys = ["training_completion", "observed_proficiency"] as const;
  return (
    <Section
      id="training-vs-proficiency"
      title={t("adoptionP4.training.sideTitle")}
      intro={t("adoptionP4.training.sideIntro")}
    >
      {report.isError && isNoReportingPeriod(report.error) ? (
        <NoReportingPeriod />
      ) : (
        <QueryState query={report}>
          {(r) => (
            <div className="grid grid--2" data-side-by-side>
              {keys.map((key) => {
                const tpl = templates.data?.find((x) => x.key === key);
                const m = r.measures.find((x) => x.templateKey === key);
                return (
                  <div className="card" key={key} data-measure-card={key}>
                    <h3 className="card__title">
                      {tpl ? <MeasureName template={tpl} /> : t(`adoptionP4.training.${key}`)}
                    </h3>
                    <MeasureValue measure={m} template={tpl} />
                  </div>
                );
              })}
            </div>
          )}
        </QueryState>
      )}
      <p className="small muted">
        <Icon name="info" /> {t("adoptionP4.training.neverDerived")}
      </p>
    </Section>
  );
}

function TrainingRecords({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const list = useTrainingRecords(ws.tid, { stakeholderGroupId: groupId });
  const { byId } = usePeople(ws.tid);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "update"; row: TrainingRecord } | null>(null);
  const canRecord = ws.can("proficiency.record");
  const columns: RegisterColumn<TrainingRecord>[] = [
    {
      id: "title",
      header: t("adoptionP4.training.trainingTitle"),
      rowHeader: true,
      hideable: false,
      cell: (r) => r.trainingTitle,
      sortValue: (r) => r.trainingTitle,
    },
    {
      id: "participant",
      header: t("adoptionP4.training.participant"),
      cell: (r) => (r.participantUserId ? <PersonName id={r.participantUserId} people={byId} /> : r.participantLabel),
    },
    { id: "scheduled", header: t("adoptionP4.training.scheduledOn"), cell: (r) => <DateOrNone date={r.scheduledOn} /> },
    { id: "status", header: t("adoptionP4.col.status"), cell: (r) => <StatusText status={r.status} /> },
    { id: "completed", header: t("adoptionP4.training.completedOn"), cell: (r) => <DateOrNone date={r.completedOn} /> },
    {
      id: "rowActions",
      header: t("adoptionP4.col.actions"),
      hideable: false,
      cell: (r) =>
        canRecord && r.status === "enrolled" ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setDialog({ kind: "update", row: r })}
            data-training-update={r.id}
          >
            {t("adoptionP4.training.recordOutcome")}
            <span className="visually-hidden"> {r.trainingTitle}</span>
          </button>
        ) : null,
    },
  ];
  return (
    <Section
      id="training-records"
      title={t("adoptionP4.training.recordsTitle")}
      intro={t("adoptionP4.training.recordsIntro")}
      actions={
        canRecord ? (
          <button type="button" className="button button--primary" onClick={() => setDialog({ kind: "create" })}>
            <Icon name="plus" /> {t("adoptionP4.training.create")}
          </button>
        ) : null
      }
    >
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="adoption-training"
            caption={t("adoptionP4.training.recordsTitle")}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("adoptionP4.training.empty")}
            defaultSort={{ id: "title", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" ? <CreateTrainingDialog groupId={groupId} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "update" ? <UpdateTrainingDialog row={dialog.row} onClose={() => setDialog(null)} /> : null}
    </Section>
  );
}

function DateOrNone({ date }: { date: string | null }) {
  const { t } = useTranslation();
  if (!date) return <span className="muted">{t("adoptionP4.none")}</span>;
  return <DueDate date={date} />;
}

function CreateTrainingDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const interventions = useInterventions(ws.tid);
  const fields: P4FieldSpec[] = [
    { name: "trainingTitle", label: t("adoptionP4.training.trainingTitle"), kind: "text", required: true, max: 300 },
    {
      name: "participantUserId",
      label: t("adoptionP4.training.participantPerson"),
      kind: "select",
      hint: t("adoptionP4.training.participantHint"),
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    { name: "participantLabel", label: t("adoptionP4.training.participantLabel"), kind: "text", max: 200 },
    { name: "scheduledOn", label: t("adoptionP4.training.scheduledOn"), kind: "date" },
    {
      name: "interventionId",
      label: t("adoptionP4.training.intervention"),
      kind: "select",
      options: (interventions.data ?? [])
        .filter((i) => i.interventionType === "training")
        .map((i) => ({ value: i.id, label: `${i.code} · ${i.title}` })),
    },
  ];
  return (
    <P4FormDialog
      title={t("adoptionP4.training.create")}
      fields={fields}
      submitLabel={t("adoptionP4.training.createSubmit")}
      url={adoptionPaths.training(ws.tid)}
      namespaces={NS}
      toBody={(v) => {
        const person = typeof v["participantUserId"] === "string" && v["participantUserId"] !== "";
        const label = textOf(v["participantLabel"]);
        if (!person && !label) return { fieldErrors: { participantUserId: "validation.required" } };
        if (person && label) return { fieldErrors: { participantLabel: "validation.not_applicable" } };
        return {
          stakeholderGroupId: groupId,
          trainingTitle: v["trainingTitle"],
          ...(person ? { participantUserId: v["participantUserId"] } : { participantLabel: label }),
          ...(v["scheduledOn"] ? { scheduledOn: v["scheduledOn"] } : {}),
          ...(v["interventionId"] ? { interventionId: v["interventionId"] } : {}),
        };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function UpdateTrainingDialog({ row, onClose }: { row: TrainingRecord; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("adoptionP4.training.recordOutcomeTitle", { title: row.trainingTitle })}
      description={t("adoptionP4.training.completionIsAttendance")}
      fields={[
        {
          name: "status",
          label: t("adoptionP4.col.status"),
          kind: "select",
          required: true,
          options: ["completed", "no_show", "withdrawn"].map((s) => ({ value: s, label: t(`adoptionP4.status.${s}`) })),
        },
        {
          name: "completedOn",
          label: t("adoptionP4.training.completedOn"),
          kind: "date",
          required: true,
          when: (v) => v["status"] === "completed",
        },
      ]}
      submitLabel={t("adoptionP4.save")}
      method="PATCH"
      url={adoptionPaths.trainingRecord(ws.tid, row.id)}
      version={row.version}
      namespaces={NS}
      toBody={(v) => ({
        status: v["status"],
        ...(v["status"] === "completed" ? { completedOn: v["completedOn"] } : {}),
      })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function Observations({ groupId }: { groupId: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const list = useAssessmentRecords(ws.tid, { stakeholderGroupId: groupId, kind: "proficiency_observation" });
  const { byId } = usePeople(ws.tid);
  const columns: RegisterColumn<AssessmentRecord>[] = [
    {
      id: "subject",
      header: t("adoptionP4.records.subject"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link className="link" to={`/transformations/${ws.tid}/assessment-records/${r.id}`}>
          {r.subjectUserId ? (byId.get(r.subjectUserId)?.label ?? t("adoptionP4.records.person")) : r.subjectLabel}
        </Link>
      ),
    },
    {
      id: "observedOn",
      header: t("adoptionP4.records.observedOn"),
      cell: (r) => <DueDate date={r.observedOn} />,
      sortValue: (r) => r.observedOn,
    },
    {
      id: "result",
      header: t("adoptionP4.records.result"),
      cell: (r) => <ProficiencyResult result={r.proficiencyResult} />,
    },
    { id: "status", header: t("adoptionP4.col.status"), cell: (r) => <StatusText status={r.status} /> },
  ];
  return (
    <Section
      id="proficiency-observations"
      title={t("adoptionP4.training.observationsTitle")}
      intro={t("adoptionP4.training.observationsIntro")}
      actions={
        <Link className="button button--secondary" to={`/transformations/${ws.tid}/assessment-forms`}>
          <Icon name="pencil" /> {t("adoptionP4.training.openForms")}
        </Link>
      }
    >
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="adoption-observations"
            caption={t("adoptionP4.training.observationsTitle")}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("adoptionP4.training.noObservations")}
            emptyBody={t("adoptionP4.training.noObservationsBody")}
            defaultSort={{ id: "observedOn", dir: "desc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}

/** Proficient / Not yet proficient (label + icon), derived by the API from the answers; never sent by the client. */
export function ProficiencyResult({ result }: { result: string | null }) {
  const { t } = useTranslation();
  if (!result) return <span className="muted">{t("adoptionP4.records.noResult")}</span>;
  return (
    <span className="chip-row" data-proficiency={result}>
      <Icon name={result === "proficient" ? "check" : "dot"} /> {t(`adoptionP4.records.${result}`)}
    </span>
  );
}
