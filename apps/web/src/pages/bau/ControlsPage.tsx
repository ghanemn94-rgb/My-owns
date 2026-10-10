// BAU and Improvement > Controls, control checks and recurring reviews (T-DG4-FE-E; p4-work-split §F+G FG.8;
// ADR-0034 §6). SYNTHETIC data only.
//  - REQ-S11-008: a failed control check (with its result note) creates one recovery action: the check row links to
//    the corrective-action case once slice E has opened it, and says "being opened" until then (never a guess).
//  - REQ-S11-004 / REQ-S03-002: reviews are scheduled by the daily scan whatever the transformation's status; only the
//    assignee completes one, with an outcome note and a performance signal (Unknown is a valid, labelled signal).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  CONTROL_CHECK_STATUSES,
  PERFORMANCE_SIGNALS,
  SUSTAIN_FREQUENCIES,
  SUSTAINMENT_REVIEW_STATUSES,
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
  sustainPaths,
  useControlChecks,
  useControls,
  usePerformanceAreas,
  useSustainmentReviews,
  type Control,
  type ControlCheck,
  type SustainmentReview,
} from "./api.ts";
import {
  Code,
  frequencyText,
  NS,
  ScheduledDate,
  SignalText,
  StatusText,
  SUSTAIN_WRITE_PERMISSIONS,
  SustainSubNav,
  vocabOptions,
} from "./ui.tsx";

export function ControlsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="bau"
      title={t("sustainP4.controls.title")}
      subtitle={t("sustainP4.controls.intro")}
      writePermissions={SUSTAIN_WRITE_PERMISSIONS}
    >
      <ControlsBody />
    </WorkspaceFrame>
  );
}

export function ReviewsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="bau"
      title={t("sustainP4.reviews.title")}
      subtitle={t("sustainP4.reviews.intro")}
      writePermissions={SUSTAIN_WRITE_PERMISSIONS}
    >
      <ReviewsBody />
    </WorkspaceFrame>
  );
}

function ControlsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <Section id="bau-controls" title={t("sustainP4.controls.tableTitle")}>
        <ControlsTable />
      </Section>
      <Section id="bau-checks" title={t("sustainP4.checks.tableTitle")} intro={t("sustainP4.checks.intro")}>
        <ChecksTable />
      </Section>
    </>
  );
}

function ReviewsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  return (
    <>
      <SustainSubNav tid={ws.tid} />
      <Section id="bau-reviews" title={t("sustainP4.reviews.tableTitle")}>
        <ReviewsTable />
      </Section>
    </>
  );
}

function useAreaCode(tid: string) {
  const areas = usePerformanceAreas(tid);
  return {
    areas: areas.data ?? [],
    code: (id: string | null) => (areas.data ?? []).find((a) => a.id === id)?.code ?? "—",
  };
}

export function ControlsTable({ areaId }: { areaId?: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("active");
  const list = useControls(ws.tid, { ...(areaId ? { performanceAreaId: areaId } : {}), ...(status ? { status } : {}) });
  const { byId } = usePeople(ws.tid);
  const area = useAreaCode(ws.tid);
  const [dialog, setDialog] = useState<{ kind: "create" } | { kind: "edit" | "retire"; row: Control } | null>(null);
  const canManage = ws.can("control.manage");
  const columns: RegisterColumn<Control>[] = [
    {
      id: "code",
      header: t("sustainP4.col.code"),
      rowHeader: true,
      hideable: false,
      cell: (c) => <Code>{c.code}</Code>,
      sortValue: (c) => c.code,
    },
    { id: "name", header: t("sustainP4.col.name"), cell: (c) => c.name, sortValue: (c) => c.name },
    ...(areaId
      ? []
      : [
          {
            id: "area",
            header: t("sustainP4.handover.area"),
            cell: (c: Control) => <Code>{area.code(c.performanceAreaId)}</Code>,
          },
        ]),
    {
      id: "owner",
      header: t("sustainP4.col.owner"),
      cell: (c) =>
        c.ownerUserId ? (
          <PersonName id={c.ownerUserId} people={byId} />
        ) : (
          <span className="muted" data-owner="none">
            {t("sustainP4.controls.ownerFromArea")}
          </span>
        ),
    },
    {
      id: "frequency",
      header: t("sustainP4.controls.frequency"),
      cell: (c) => frequencyText(t, c.frequency, c.frequencyInterval),
    },
    {
      id: "next",
      header: t("sustainP4.controls.nextCheck"),
      cell: (c) => <ScheduledDate date={c.nextCheckDate} />,
      sortValue: (c) => c.nextCheckDate,
    },
    { id: "status", header: t("sustainP4.col.status"), cell: (c) => <StatusText status={c.status} /> },
    {
      id: "rowActions",
      header: t("sustainP4.col.actions"),
      hideable: false,
      cell: (c) =>
        canManage && c.status === "active" ? (
          <span className="chip-row">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setDialog({ kind: "edit", row: c })}
            >
              <Icon name="pencil" /> {t("sustainP4.edit")}
              <span className="visually-hidden"> {c.code}</span>
            </button>
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setDialog({ kind: "retire", row: c })}
            >
              <Icon name="archive" /> {t("sustainP4.controls.retire")}
              <span className="visually-hidden"> {c.code}</span>
            </button>
          </span>
        ) : null,
    },
  ];
  return (
    <>
      <div className="filters" role="group" aria-label={t("sustainP4.filters")}>
        <div className="filters__select">
          <label htmlFor={`ctl-filter-${areaId ?? "all"}`}>{t("sustainP4.col.status")}</label>
          <select id={`ctl-filter-${areaId ?? "all"}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("sustainP4.all")}</option>
            {["active", "retired"].map((v) => (
              <option key={v} value={v}>
                {t(`sustainP4.status.${v}`)}
              </option>
            ))}
          </select>
        </div>
        {canManage ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => setDialog({ kind: "create" })}
            data-create-control
          >
            <Icon name="plus" /> {t("sustainP4.controls.create")}
          </button>
        ) : null}
      </div>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id={`bau-controls${areaId ? "-area" : ""}`}
            caption={t("sustainP4.controls.tableTitle")}
            rows={rows}
            columns={columns}
            getRowId={(c) => c.id}
            emptyTitle={t("sustainP4.controls.empty")}
            defaultSort={{ id: "code", dir: "asc" }}
          />
        )}
      </QueryState>
      {dialog?.kind === "create" ? <ControlDialog areaId={areaId} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "edit" ? <ControlDialog control={dialog.row} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "retire" ? <RetireControlDialog control={dialog.row} onClose={() => setDialog(null)} /> : null}
    </>
  );
}

function ControlDialog({
  control,
  areaId,
  onClose,
}: {
  control?: Control;
  areaId?: string | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const area = useAreaCode(ws.tid);
  const fields: P4FieldSpec[] = [
    ...(control || areaId
      ? []
      : [
          {
            name: "performanceAreaId",
            label: t("sustainP4.handover.area"),
            kind: "select",
            required: true,
            options: area.areas
              .filter((a) => a.status !== "retired")
              .map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })),
          } satisfies P4FieldSpec,
        ]),
    { name: "name", label: t("sustainP4.col.name"), kind: "text", required: true, max: 300 },
    { name: "description", label: t("sustainP4.field.description"), kind: "textarea", max: 4000 },
    {
      name: "ownerUserId",
      label: t("sustainP4.col.owner"),
      kind: "select",
      hint: t("sustainP4.controls.ownerHint"),
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    {
      name: "frequency",
      label: t("sustainP4.controls.frequency"),
      kind: "select",
      required: true,
      options: vocabOptions(t, "frequency", SUSTAIN_FREQUENCIES),
    },
    {
      name: "frequencyInterval",
      label: t("sustainP4.controls.interval"),
      kind: "number",
      required: true,
      min: 1,
      max: 12,
    },
    { name: "nextCheckDate", label: t("sustainP4.controls.nextCheck"), kind: "date" },
  ];
  const initial: P4Values = control
    ? {
        name: control.name,
        description: control.description ?? "",
        ownerUserId: control.ownerUserId ?? "",
        frequency: control.frequency,
        frequencyInterval: String(control.frequencyInterval),
        nextCheckDate: control.nextCheckDate ?? "",
      }
    : { frequency: "monthly", frequencyInterval: "1" };
  const build = (v: P4Values): Record<string, unknown> => ({
    name: v["name"],
    description: textOf(v["description"]) ?? null,
    ownerUserId: v["ownerUserId"] ? v["ownerUserId"] : null,
    frequency: v["frequency"],
    frequencyInterval: Number(v["frequencyInterval"]),
    nextCheckDate: v["nextCheckDate"] ? v["nextCheckDate"] : null,
  });
  return (
    <P4FormDialog
      title={control ? t("sustainP4.controls.editTitle", { code: control.code }) : t("sustainP4.controls.create")}
      fields={fields}
      initial={initial}
      submitLabel={control ? t("sustainP4.save") : t("sustainP4.controls.createSubmit")}
      method={control ? "PATCH" : "POST"}
      url={control ? sustainPaths.control(ws.tid, control.id) : sustainPaths.controls(ws.tid)}
      {...(control ? { version: control.version } : {})}
      namespaces={NS}
      toBody={(v) => {
        const body = build(v);
        if (!control)
          return {
            ...Object.fromEntries(Object.entries(body).filter(([, x]) => x !== null)),
            performanceAreaId: areaId ?? v["performanceAreaId"],
          };
        const before = build(initial);
        const patch = Object.fromEntries(
          Object.entries(body).filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(before[k])),
        );
        return Object.keys(patch).length === 0 ? { fieldErrors: { name: "validation.empty_patch" } } : patch;
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

function RetireControlDialog({ control, onClose }: { control: Control; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("sustainP4.controls.retireTitle", { code: control.code })}
      fields={[
        {
          name: "retireReason",
          label: t("sustainP4.field.reason"),
          kind: "textarea",
          required: true,
          min: 3,
          max: 1000,
        },
      ]}
      submitLabel={t("sustainP4.controls.retire")}
      danger
      method="PATCH"
      url={sustainPaths.control(ws.tid, control.id)}
      version={control.version}
      namespaces={NS}
      toBody={(v) => ({ status: "retired", retireReason: v["retireReason"] })}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

export function ChecksTable({ areaId }: { areaId?: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const list = useControlChecks(ws.tid, {
    ...(areaId ? { performanceAreaId: areaId } : {}),
    ...(status ? { status } : {}),
  });
  const controls = useControls(ws.tid);
  const { byId } = usePeople(ws.tid);
  const [recording, setRecording] = useState<ControlCheck | null>(null);
  const controlOf = (id: string) => (controls.data ?? []).find((c) => c.id === id);
  const columns: RegisterColumn<ControlCheck>[] = [
    {
      id: "control",
      header: t("sustainP4.checks.control"),
      rowHeader: true,
      hideable: false,
      cell: (c) => {
        const ctl = controlOf(c.controlId);
        return ctl ? (
          <span>
            <Code>{ctl.code}</Code> {ctl.name}
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      id: "due",
      header: t("sustainP4.col.due"),
      cell: (c) => <DueDate date={c.dueDate} />,
      sortValue: (c) => c.dueDate,
    },
    {
      id: "assignee",
      header: t("sustainP4.checks.assignee"),
      cell: (c) =>
        c.assigneeUserId ? (
          <PersonName id={c.assigneeUserId} people={byId} />
        ) : (
          <span className="muted">{t("common.value.notAssigned")}</span>
        ),
    },
    {
      id: "status",
      header: t("sustainP4.col.status"),
      cell: (c) => (
        <span className="block">
          <StatusText status={c.status} />
          {c.resultNote ? <span className="block small">{c.resultNote}</span> : null}
        </span>
      ),
      sortValue: (c) => CONTROL_CHECK_STATUSES.indexOf(c.status),
      filterText: (c) => t(`sustainP4.status.${c.status}`),
    },
    {
      id: "recovery",
      header: t("sustainP4.checks.recovery"),
      cell: (c) =>
        c.status !== "failed" ? (
          <span className="muted">{t("sustainP4.none")}</span>
        ) : c.correctiveCaseId ? (
          <Link
            className="link"
            to={`/transformations/${ws.tid}/corrective-actions/${c.correctiveCaseId}`}
            data-recovery={c.correctiveCaseId}
          >
            {t("sustainP4.checks.openRecovery")}
          </Link>
        ) : (
          <span className="status-chip status-chip--unknown" data-recovery="pending">
            <Icon name="clock" /> {t("sustainP4.checks.recoveryPending")}
          </span>
        ),
    },
    {
      id: "rowActions",
      header: t("sustainP4.col.actions"),
      hideable: false,
      cell: (c) =>
        ws.can("control_check.record") && c.status === "due" ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setRecording(c)}
            data-record-check={c.id}
          >
            {t("sustainP4.checks.record")}
          </button>
        ) : null,
    },
  ];
  return (
    <>
      <div className="filters" role="group" aria-label={t("sustainP4.filters")}>
        <div className="filters__select">
          <label htmlFor={`chk-filter-${areaId ?? "all"}`}>{t("sustainP4.col.status")}</label>
          <select id={`chk-filter-${areaId ?? "all"}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("sustainP4.all")}</option>
            {CONTROL_CHECK_STATUSES.map((v) => (
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
            id={`bau-checks${areaId ? "-area" : ""}`}
            caption={t("sustainP4.checks.tableTitle")}
            rows={rows}
            columns={columns}
            getRowId={(c) => c.id}
            emptyTitle={t("sustainP4.checks.empty")}
            emptyBody={t("sustainP4.checks.emptyBody")}
            defaultSort={{ id: "due", dir: "asc" }}
          />
        )}
      </QueryState>
      {recording ? <RecordCheckDialog check={recording} onClose={() => setRecording(null)} /> : null}
    </>
  );
}

function RecordCheckDialog({ check, onClose }: { check: ControlCheck; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  return (
    <P4FormDialog
      title={t("sustainP4.checks.recordTitle")}
      description={t("sustainP4.checks.recordIntro")}
      fields={[
        {
          name: "result",
          label: t("sustainP4.checks.result"),
          kind: "select",
          required: true,
          options: ["passed", "failed"].map((r) => ({ value: r, label: t(`sustainP4.status.${r}`) })),
        },
        {
          name: "resultNote",
          label: t("sustainP4.checks.resultNote"),
          kind: "textarea",
          required: true,
          min: 3,
          max: 4000,
          when: (v) => v["result"] === "failed",
        },
        {
          name: "resultNotePassed",
          label: t("sustainP4.checks.resultNote"),
          kind: "textarea",
          max: 4000,
          when: (v) => v["result"] === "passed",
        },
      ]}
      submitLabel={t("sustainP4.checks.recordSubmit")}
      url={sustainPaths.checkRecord(ws.tid, check.id)}
      version={check.version}
      namespaces={NS}
      toBody={(v) => {
        const note = v["result"] === "failed" ? textOf(v["resultNote"]) : textOf(v["resultNotePassed"]);
        return { result: v["result"], ...(note ? { resultNote: note } : {}) };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

export function ReviewsTable({ areaId }: { areaId?: string }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const list = useSustainmentReviews(ws.tid, {
    ...(areaId ? { performanceAreaId: areaId } : {}),
    ...(status ? { status } : {}),
  });
  const { byId } = usePeople(ws.tid);
  const area = useAreaCode(ws.tid);
  const [completing, setCompleting] = useState<SustainmentReview | null>(null);
  const refresh = useP4Refresh(ws.tid);
  const columns: RegisterColumn<SustainmentReview>[] = [
    {
      id: "subject",
      header: t("sustainP4.reviews.subject"),
      rowHeader: true,
      hideable: false,
      cell: (r) =>
        r.subjectKind === "performance_area" ? (
          <span>
            {t("sustainP4.reviews.areaSubject", { code: area.code(r.performanceAreaId) })}
            {r.cycleNo ? (
              <span className="small muted"> · {t("sustainP4.reviews.cycle", { n: r.cycleNo })}</span>
            ) : null}
          </span>
        ) : (
          t("sustainP4.reviews.transitionSubject")
        ),
    },
    {
      id: "due",
      header: t("sustainP4.col.due"),
      cell: (r) => <DueDate date={r.dueDate} />,
      sortValue: (r) => r.dueDate,
    },
    {
      id: "assignee",
      header: t("sustainP4.checks.assignee"),
      cell: (r) => <PersonName id={r.assigneeUserId} people={byId} />,
    },
    {
      id: "status",
      header: t("sustainP4.col.status"),
      cell: (r) => <StatusText status={r.status} />,
      sortValue: (r) => SUSTAINMENT_REVIEW_STATUSES.indexOf(r.status),
      filterText: (r) => t(`sustainP4.status.${r.status}`),
    },
    {
      id: "signal",
      header: t("sustainP4.reviews.signal"),
      cell: (r) =>
        r.status === "done" ? (
          <SignalText signal={r.performanceSignal} />
        ) : (
          <span className="muted">{t("sustainP4.none")}</span>
        ),
    },
    { id: "outcome", header: t("sustainP4.reviews.outcomeNote"), cell: (r) => <TextCell value={r.outcomeNote} /> },
    {
      id: "source",
      header: t("sustainP4.reviews.source"),
      cell: (r) => t(`sustainP4.createdSource.${r.createdSource}`),
    },
    {
      id: "rowActions",
      header: t("sustainP4.col.actions"),
      hideable: false,
      cell: (r) =>
        r.status === "due" && r.assigneeUserId === ws.meId && ws.can("sustainment_review.complete") ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setCompleting(r)}
            data-complete-review={r.id}
          >
            {t("sustainP4.reviews.complete")}
          </button>
        ) : null,
    },
  ];
  return (
    <>
      <div className="filters" role="group" aria-label={t("sustainP4.filters")}>
        <div className="filters__select">
          <label htmlFor={`rv-filter-${areaId ?? "all"}`}>{t("sustainP4.col.status")}</label>
          <select id={`rv-filter-${areaId ?? "all"}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("sustainP4.all")}</option>
            {SUSTAINMENT_REVIEW_STATUSES.map((v) => (
              <option key={v} value={v}>
                {t(`sustainP4.status.${v}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="small muted">
        <Icon name="info" /> {t("sustainP4.reviews.scanNote")}
      </p>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id={`bau-reviews${areaId ? "-area" : ""}`}
            caption={t("sustainP4.reviews.tableTitle")}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("sustainP4.reviews.empty")}
            emptyBody={t("sustainP4.reviews.emptyBody")}
            defaultSort={{ id: "due", dir: "asc" }}
          />
        )}
      </QueryState>
      {completing ? (
        <P4FormDialog
          title={t("sustainP4.reviews.completeTitle")}
          fields={[
            {
              name: "outcomeNote",
              label: t("sustainP4.reviews.outcomeNote"),
              kind: "textarea",
              required: true,
              min: 3,
              max: 4000,
            },
            {
              name: "performanceSignal",
              label: t("sustainP4.reviews.signal"),
              kind: "select",
              required: true,
              hint: t("sustainP4.reviews.signalHint"),
              options: vocabOptions(t, "signal", PERFORMANCE_SIGNALS),
            },
          ]}
          submitLabel={t("sustainP4.reviews.completeSubmit")}
          url={sustainPaths.reviewComplete(ws.tid, completing.id)}
          version={completing.version}
          namespaces={NS}
          toBody={(v) => ({ outcomeNote: v["outcomeNote"], performanceSignal: v["performanceSignal"] })}
          onDone={refresh}
          onClose={() => setCompleting(null)}
        />
      ) : null}
    </>
  );
}
