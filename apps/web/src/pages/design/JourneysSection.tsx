// Journeys and processes (REQ-PB-025): current and future journey/process maps with ordered steps (actor, hand-off,
// systems, controls, cycle time) and pain points linked to a step and, optionally, to a T01 row. Steps keep a stable
// key across edits so pain points stay attached to them.
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  journeyCreate,
  journeyPainPointCreate,
  journeyPainPointUpdate,
  journeyUpdate,
  type JourneyStep,
} from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { usePainPoints, useP2Refresh, useRegister } from "../../api/queries.ts";
import type { DiagnosticItem, Journey, JourneyPainPoint } from "../../api/types.ts";
import { useLocale } from "../../app/locale.ts";
import { Unknown } from "../../components/Badges.tsx";
import { Amount } from "../../components/Amount.tsx";
import { BLANK_CODE, Dialog, Field, isBlankText, issueCode, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RecordDialog, type FieldSpec } from "../../components/RecordForm.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { ArchiveAction } from "../../components/RowActions.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { diagnosticDimensionLabel, tomDimensionLabel, tomDimensionOptions } from "../../lib/methodology.ts";
import { errorMessage, fieldErrorMessage } from "../../lib/problem.ts";

const DURATION_UNITS = ["minutes", "hours", "days", "weeks"] as const;

export function JourneysSection() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const journeys = useRegister<Journey>(ws.tid, "journeys");
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP2Refresh(ws.tid);
  const [dialog, setDialog] = useState<{ record: Journey | null } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canCreate = ws.canAny("tom.edit", "tom.contribute");

  const fields: FieldSpec[] = [
    { name: "name", kind: "text", label: t("common.field.name"), required: true, maxLength: 300 },
    {
      name: "kind",
      kind: "select",
      label: t("design.journeys.kind"),
      required: true,
      options: (["journey", "process"] as const).map((k) => ({ value: k, label: t(`design.journeys.kinds.${k}`) })),
    },
    {
      name: "state",
      kind: "select",
      label: t("design.journeys.state"),
      required: true,
      options: (["current", "future"] as const).map((s) => ({ value: s, label: t(`design.journeys.states.${s}`) })),
    },
    { name: "description", kind: "textarea", label: t("common.field.description") },
    {
      name: "dimensionCode",
      kind: "select",
      label: t("design.dimension"),
      options: tomDimensionOptions(ws.methodology, locale),
    },
    {
      name: "cycleTimeValue",
      kind: "decimal",
      label: t("design.journeys.cycleTime"),
      hint: t("design.journeys.cycleTimeHint"),
    },
    {
      name: "cycleTimeUnit",
      kind: "select",
      label: t("design.journeys.cycleTimeUnit"),
      options: DURATION_UNITS.map((u) => ({ value: u, label: t(`design.journeys.units.${u}`) })),
    },
    { name: "failureDemand", kind: "textarea", label: t("design.journeys.failureDemand") },
    {
      name: "status",
      kind: "select",
      label: t("common.field.status"),
      options: (["draft", "active"] as const).map((s) => ({ value: s, label: t(`common.recordStatus.${s}`) })),
    },
    { name: "ownerUserId", kind: "person", label: t("common.field.owner") },
  ];

  const columns: RegisterColumn<Journey>[] = [
    {
      id: "name",
      header: t("common.field.name"),
      cell: (j) => j.name,
      sortValue: (j) => j.name,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "kind",
      header: t("design.journeys.kind"),
      cell: (j) => t(`design.journeys.kinds.${j.kind}`),
      sortValue: (j) => j.kind,
    },
    {
      id: "state",
      header: t("design.journeys.state"),
      cell: (j) => t(`design.journeys.states.${j.state}`),
      sortValue: (j) => j.state,
    },
    {
      id: "dimension",
      header: t("design.dimension"),
      cell: (j) =>
        tomDimensionLabel(ws.methodology, j.dimensionCode, locale) ?? (
          <span className="muted">{t("common.value.none")}</span>
        ),
    },
    {
      id: "steps",
      header: t("design.journeys.steps"),
      cell: (j) => <bdi dir="ltr">{j.steps.length}</bdi>,
      sortValue: (j) => j.steps.length,
    },
    {
      id: "cycle",
      header: t("design.journeys.cycleTime"),
      cell: (j) =>
        j.cycleTimeValue === null ? (
          <Unknown />
        ) : (
          <span>
            <Amount value={j.cycleTimeValue} maxFractionDigits={4} />{" "}
            {j.cycleTimeUnit ? t(`design.journeys.units.${j.cycleTimeUnit}`) : ""}
          </span>
        ),
    },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (j) => <RecordStatus status={j.status} />,
      sortValue: (j) => j.status,
    },
    { id: "owner", header: t("common.field.owner"), cell: (j) => <PersonName id={j.ownerUserId} people={byId} /> },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (j) => (
        <span className="row-actions">
          <button
            type="button"
            className="button button--link button--small"
            aria-expanded={selectedId === j.id}
            aria-controls="journey-detail"
            onClick={() => setSelectedId(selectedId === j.id ? null : j.id)}
          >
            <Icon name="info" /> {t("design.journeys.open")}
            <span className="visually-hidden">: {j.name}</span>
          </button>
          {ws.canWriteRow("tom.edit", "tom.contribute", j) ? (
            <>
              <button
                type="button"
                className="button button--link button--small"
                onClick={() => setDialog({ record: j })}
              >
                <Icon name="pencil" /> {t("common.action.edit")}
                <span className="visually-hidden">: {j.name}</span>
              </button>
              <ArchiveAction
                url={`/api/v1/transformations/${ws.tid}/journeys/${j.id}`}
                version={j.version}
                name={j.name}
                onDone={refresh}
              />
            </>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <Section
      id="journeys"
      title={t("design.journeys.title")}
      intro={t("design.journeys.intro")}
      actions={
        canCreate ? (
          <button
            type="button"
            className="button button--primary button--small"
            onClick={() => setDialog({ record: null })}
          >
            <Icon name="plus" /> {t("design.journeys.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={journeys}>
        {(list) => {
          const active = list.filter((j) => j.status !== "archived");
          const selected = active.find((j) => j.id === selectedId) ?? null;
          return (
            <>
              <RegisterTable
                id="journeys"
                caption={t("design.journeys.title")}
                rows={active}
                columns={columns}
                getRowId={(j) => j.id}
                emptyTitle={t("design.journeys.empty")}
              />
              <div id="journey-detail" aria-live="polite">
                {selected ? <JourneyDetail journey={selected} onClose={() => setSelectedId(null)} /> : null}
              </div>
            </>
          );
        }}
      </QueryState>
      {dialog ? (
        <RecordDialog<Journey>
          title={dialog.record ? t("design.journeys.editTitle") : t("design.journeys.add")}
          fields={fields}
          record={dialog.record}
          defaults={{ kind: "journey", state: "current", status: "draft", ownerUserId: ws.meId }}
          createSchema={journeyCreate}
          updateSchema={journeyUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/journeys`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/journeys/${r.id}`}
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

function JourneyDetail({ journey, onClose }: { journey: Journey; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const pains = usePainPoints(ws.tid, journey.id);
  const items = useRegister<DiagnosticItem>(ws.tid, "diagnostic-items");
  const refresh = useP2Refresh(ws.tid);
  const [editingSteps, setEditingSteps] = useState(false);
  const [painDialog, setPainDialog] = useState<{ record: JourneyPainPoint | null } | null>(null);
  const canEdit = ws.canWriteRow("tom.edit", "tom.contribute", journey);
  const steps = [...journey.steps].sort((a, b) => a.ordinal - b.ordinal);
  const stepName = (key: string | null) => (key ? (steps.find((s) => s.key === key)?.name ?? null) : null);

  const painFields: FieldSpec[] = [
    { name: "description", kind: "textarea", label: t("design.journeys.painPoint"), required: true, maxLength: 2000 },
    {
      name: "stepKey",
      kind: "select",
      label: t("design.journeys.step"),
      options: steps.map((s) => ({ value: s.key, label: `${s.ordinal}. ${s.name}` })),
    },
    {
      name: "diagnosticItemId",
      kind: "select",
      label: t("diagnose.finding.t01Row"),
      options: (items.data ?? []).map((i) => ({
        value: i.id,
        label: diagnosticDimensionLabel(ws.methodology, i.dimensionCode, locale) ?? i.dimensionCode,
      })),
    },
  ];
  const painColumns: RegisterColumn<JourneyPainPoint>[] = [
    {
      id: "description",
      header: t("design.journeys.painPoint"),
      cell: (p) => <TextCell value={p.description} />,
      sortValue: (p) => p.description,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "step",
      header: t("design.journeys.step"),
      cell: (p) => stepName(p.stepKey) ?? <span className="muted">{t("design.journeys.wholeJourney")}</span>,
      sortValue: (p) => stepName(p.stepKey),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (p) =>
        canEdit ? (
          <span className="row-actions">
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => setPainDialog({ record: p })}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
            </button>
            <ArchiveAction
              url={`/api/v1/transformations/${ws.tid}/journeys/${journey.id}/pain-points/${p.id}`}
              version={p.version}
              name={p.description}
              onDone={refresh}
            />
          </span>
        ) : (
          <span className="muted small">{t("common.readOnly")}</span>
        ),
    },
  ];

  return (
    <section className="journey-detail" aria-labelledby="journey-detail-title" data-journey={journey.id}>
      <div className="card__header">
        <h3 id="journey-detail-title" className="card__subtitle">
          {journey.name}{" "}
          <span className="muted small">
            ({t(`design.journeys.kinds.${journey.kind}`)} · {t(`design.journeys.states.${journey.state}`)})
          </span>
        </h3>
        <span className="section__actions">
          {canEdit ? (
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => setEditingSteps(true)}
            >
              <Icon name="pencil" /> {t("design.journeys.editSteps")}
            </button>
          ) : null}
          <button type="button" className="button button--secondary button--small" onClick={onClose}>
            {t("common.action.close")}
          </button>
        </span>
      </div>
      {journey.failureDemand ? (
        <p>
          <strong>{t("design.journeys.failureDemand")}:</strong> {journey.failureDemand}
        </p>
      ) : null}
      <h4 className="small-heading">{t("design.journeys.steps")}</h4>
      {steps.length === 0 ? (
        <EmptyState title={t("design.journeys.noSteps")} />
      ) : (
        <ol className="journey-steps">
          {steps.map((s) => {
            const stepPains = (pains.data ?? []).filter((p) => p.stepKey === s.key && p.status !== "archived");
            return (
              <li key={s.key} className="journey-step" data-step={s.ordinal}>
                <strong>{s.name}</strong>
                <dl className="details details--compact">
                  <div>
                    <dt>{t("design.journeys.actor")}</dt>
                    <dd>{s.actor ?? <span className="muted">{t("common.value.none")}</span>}</dd>
                  </div>
                  <div>
                    <dt>{t("design.journeys.handoffTo")}</dt>
                    <dd>{s.handoffTo ?? <span className="muted">{t("common.value.none")}</span>}</dd>
                  </div>
                  <div>
                    <dt>{t("design.journeys.systems")}</dt>
                    <dd>
                      {s.systems && s.systems.length > 0 ? (
                        s.systems.join(", ")
                      ) : (
                        <span className="muted">{t("common.value.none")}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("design.journeys.controls")}</dt>
                    <dd>
                      {s.controls && s.controls.length > 0 ? (
                        s.controls.join(", ")
                      ) : (
                        <span className="muted">{t("common.value.none")}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("design.journeys.cycleTime")}</dt>
                    <dd>
                      {s.cycleTimeValue ? (
                        <>
                          <Amount value={s.cycleTimeValue} maxFractionDigits={4} />{" "}
                          {s.cycleTimeUnit ? t(`design.journeys.units.${s.cycleTimeUnit}`) : ""}
                        </>
                      ) : (
                        <Unknown />
                      )}
                    </dd>
                  </div>
                </dl>
                {stepPains.length > 0 ? (
                  <p className="pain-flag">
                    <span className="status-chip status-chip--at-risk">
                      <Icon name="alert" /> {t("design.journeys.painCount", { n: stepPains.length })}
                    </span>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div className="card__header">
        <h4 className="small-heading">{t("design.journeys.painPoints")}</h4>
        {canEdit ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => setPainDialog({ record: null })}
          >
            <Icon name="plus" /> {t("design.journeys.addPainPoint")}
          </button>
        ) : null}
      </div>
      <QueryState query={pains}>
        {(list) => (
          <RegisterTable
            id={`pain-points`}
            caption={t("design.journeys.painPoints")}
            rows={list.filter((p) => p.status !== "archived")}
            columns={painColumns}
            getRowId={(p) => p.id}
            emptyTitle={t("design.journeys.noPainPoints")}
            pageSize={5}
          />
        )}
      </QueryState>
      {editingSteps ? <StepsEditor journey={journey} onClose={() => setEditingSteps(false)} /> : null}
      {painDialog ? (
        <RecordDialog<JourneyPainPoint>
          title={painDialog.record ? t("design.journeys.editPainPoint") : t("design.journeys.addPainPoint")}
          fields={painFields}
          record={painDialog.record}
          createSchema={journeyPainPointCreate}
          updateSchema={journeyPainPointUpdate}
          createUrl={`/api/v1/transformations/${ws.tid}/journeys/${journey.id}/pain-points`}
          updateUrl={(r) => `/api/v1/transformations/${ws.tid}/journeys/${journey.id}/pain-points/${r.id}`}
          submitLabel={painDialog.record ? t("common.action.save") : t("common.action.create")}
          onSaved={async () => {
            await refresh();
            setPainDialog(null);
          }}
          onCancel={() => setPainDialog(null)}
        />
      ) : null}
    </section>
  );
}

interface StepDraft {
  key: string;
  name: string;
  actor: string;
  handoffTo: string;
  systems: string;
  controls: string;
  cycleTimeValue: string;
  cycleTimeUnit: string;
}

const toDraft = (s: JourneyStep): StepDraft => ({
  key: s.key,
  name: s.name,
  actor: s.actor ?? "",
  handoffTo: s.handoffTo ?? "",
  systems: (s.systems ?? []).join(", "),
  controls: (s.controls ?? []).join(", "),
  cycleTimeValue: s.cycleTimeValue ?? "",
  cycleTimeUnit: s.cycleTimeUnit ?? "",
});

/** A comma-separated list control: the commas and the spaces around them are list syntax; empty items are dropped. */
const list = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");

/** The editable text controls of a step, in screen order (their order decides which invalid control gets focus). */
const STEP_TEXT_FIELDS = ["name", "actor", "handoffTo", "systems", "controls", "cycleTimeValue"] as const;
type StepTextField = (typeof STEP_TEXT_FIELDS)[number];
const isStepTextField = (f: unknown): f is StepTextField =>
  typeof f === "string" && (STEP_TEXT_FIELDS as readonly string[]).includes(f);

/**
 * F-DG2-210: the blank-text rule on a step. A control that holds text but nothing visible is `validation.blank` (also a
 * list item such as "\u200f" between commas); "" keeps its meaning (a required name is "required", the others are
 * "no value").
 */
function blankStepFields(s: StepDraft): StepTextField[] {
  return STEP_TEXT_FIELDS.filter((f) =>
    f === "systems" || f === "controls"
      ? isBlankText(s[f]) || list(s[f]).some((item) => isBlankText(item))
      : isBlankText(s[f]),
  );
}

/** The PATCH body: free text verbatim ("" is null); a cycle time is a decimal, so only its outer spaces are dropped. */
const stepBody = (s: StepDraft, i: number) => ({
  key: s.key,
  ordinal: i + 1,
  name: s.name,
  actor: s.actor === "" ? null : s.actor,
  handoffTo: s.handoffTo === "" ? null : s.handoffTo,
  systems: list(s.systems),
  controls: list(s.controls),
  cycleTimeValue: s.cycleTimeValue === "" ? null : s.cycleTimeValue.trim(),
  cycleTimeUnit: s.cycleTimeUnit || null,
});

/** Ordered step editor: add, remove, reorder; saved as one PATCH {steps} with If-Match. */
function StepsEditor({ journey, onClose }: { journey: Journey; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP2Refresh(ws.tid);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    [...journey.steps].sort((a, b) => a.ordinal - b.ordinal).map(toDraft),
  );
  const [error, setError] = useState<string | null>(null);
  /** Field errors keyed "<step key>/<field>", so they follow a step when it is moved. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const showFieldErrors = (next: Record<string, string>) => {
    setFieldErrors(next);
    if (Object.keys(next).length > 0) focusInvalid();
  };

  const update = (i: number, patch: Partial<StepDraft>) =>
    setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: -1 | 1) =>
    setSteps((s) => {
      const next = [...s];
      const [item] = next.splice(i, 1);
      next.splice(i + by, 0, item!);
      return next;
    });

  const save = async () => {
    const next: Record<string, string> = {};
    for (const s of steps) for (const f of blankStepFields(s)) next[`${s.key}/${f}`] = fieldErrorMessage(t, BLANK_CODE);
    const body = { steps: steps.map(stepBody) };
    const parsed = journeyUpdate.safeParse(body);
    let other: string | null = null;
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const [, i, field] = issue.path;
        const step = typeof i === "number" ? steps[i] : undefined;
        if (step && isStepTextField(field)) next[`${step.key}/${field}`] ??= fieldErrorMessage(t, issueCode(issue));
        else if (other === null) {
          const at = typeof i === "number" ? `${t("design.journeys.step")} ${i + 1}: ` : "";
          other = `${at}${fieldErrorMessage(t, issueCode(issue))}`;
        }
      }
    }
    setError(other);
    if (other !== null || Object.keys(next).length > 0) {
      showFieldErrors(next);
      return;
    }
    setFieldErrors({});
    setServerError(null);
    setBusy(true);
    try {
      await api.send(`/api/v1/transformations/${ws.tid}/journeys/${journey.id}`, {
        method: "PATCH",
        body,
        ifMatch: journey.version,
      });
      await refresh();
      onClose();
    } catch (e) {
      const mapped: Record<string, string> = {};
      if (e instanceof ApiError) {
        for (const fe of e.fieldErrors) {
          const m = /^\/steps\/(\d+)\/([A-Za-z]+)$/.exec(fe.pointer);
          const step = m ? steps[Number(m[1])] : undefined;
          if (step && isStepTextField(m?.[2])) mapped[`${step.key}/${m[2]}`] ??= fieldErrorMessage(t, fe.code);
        }
      }
      if (Object.keys(mapped).length > 0) showFieldErrors(mapped);
      else setServerError(e);
      if (e instanceof ApiError && e.status === 409) await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("design.journeys.editStepsTitle", { name: journey.name })}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void save()} disabled={busy}>
            {busy ? t("common.state.saving") : t("common.action.save")}
          </button>
        </>
      }
    >
      {serverError ? (
        <p
          className="banner banner--error"
          role="alert"
          data-state={serverError instanceof ApiError && serverError.status === 409 ? "conflict" : "error"}
        >
          <Icon name="alert" /> {errorMessage(t, serverError)}
        </p>
      ) : null}
      {/* F-DG2-340: a client message identical to the (earlier) server banner is not announced a second time. */}
      {error && !(serverError && errorMessage(t, serverError) === error) ? (
        <p className="banner banner--error" role="alert">
          <Icon name="alert" /> {error}
        </p>
      ) : null}
      <ol className="steps-editor">
        {steps.map((s, i) => (
          <li key={s.key}>
            <fieldset className="plain-fieldset step-fieldset">
              <legend className="field__label">{t("design.journeys.stepN", { n: i + 1 })}</legend>
              <div className="grid grid--2">
                <Field label={t("common.field.name")} error={fieldErrors[`${s.key}/name`]} required>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      value={s.name}
                      maxLength={300}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t("design.journeys.actor")} error={fieldErrors[`${s.key}/actor`]}>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      value={s.actor}
                      maxLength={200}
                      onChange={(e) => update(i, { actor: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t("design.journeys.handoffTo")} error={fieldErrors[`${s.key}/handoffTo`]}>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      value={s.handoffTo}
                      maxLength={200}
                      onChange={(e) => update(i, { handoffTo: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t("design.journeys.systemsHint")} error={fieldErrors[`${s.key}/systems`]}>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      value={s.systems}
                      onChange={(e) => update(i, { systems: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t("design.journeys.controlsHint")} error={fieldErrors[`${s.key}/controls`]}>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      value={s.controls}
                      onChange={(e) => update(i, { controls: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={t("design.journeys.cycleTime")} error={fieldErrors[`${s.key}/cycleTimeValue`]}>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      inputMode="decimal"
                      dir="ltr"
                      value={s.cycleTimeValue}
                      onChange={(e) => update(i, { cycleTimeValue: e.target.value })}
                    />
                  )}
                </Field>
                <label className="field">
                  <span className="field__label">{t("design.journeys.cycleTimeUnit")}</span>
                  <select value={s.cycleTimeUnit} onChange={(e) => update(i, { cycleTimeUnit: e.target.value })}>
                    <option value="">{t("common.value.none")}</option>
                    {DURATION_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {t(`design.journeys.units.${u}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="row-actions">
                <button
                  type="button"
                  className="button button--link button--small"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="chevronUp" /> {t("design.journeys.moveUp")}
                  <span className="visually-hidden">: {t("design.journeys.stepN", { n: i + 1 })}</span>
                </button>
                <button
                  type="button"
                  className="button button--link button--small"
                  disabled={i === steps.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="chevronDown" /> {t("design.journeys.moveDown")}
                  <span className="visually-hidden">: {t("design.journeys.stepN", { n: i + 1 })}</span>
                </button>
                <button
                  type="button"
                  className="button button--link button--small"
                  onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}
                >
                  <Icon name="cross" /> {t("design.journeys.removeStep")}
                  <span className="visually-hidden">: {t("design.journeys.stepN", { n: i + 1 })}</span>
                </button>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() => {
          // Generated outside the updater, which stays pure (F-DG2-430 sweep): a re-run updater gets the same key.
          const key = globalThis.crypto.randomUUID();
          setSteps((s) => [
            ...s,
            {
              key,
              name: "",
              actor: "",
              handoffTo: "",
              systems: "",
              controls: "",
              cycleTimeValue: "",
              cycleTimeUnit: "",
            },
          ]);
        }}
      >
        <Icon name="plus" /> {t("design.journeys.addStep")}
      </button>
    </Dialog>
  );
}
