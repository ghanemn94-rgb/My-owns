// A procedure instance (T-DG5-FE-D; REQ-S06-002; ADR-0042 §4–§6): its pinned definition version, current step(s),
// assignee, due date, missing inputs, completed evidence, next action and the linked output records. The step actions
// (complete, skip, assign, link evidence) and the instance actions (inputs, cancel) send If-Match with the instance
// version the user saw; the server re-checks every rule (inputs, evidence, assignee, approval through the canonical
// business approval). An approval step is completed only by its business approver's decision, never from here.
// T-DG5-FE-D4 (D-166): a step whose output is `create` or `link` is completed by choosing its output record
// (CompleteWithOutput.tsx; `outputRecordId`); an `advance` step keeps the note-only form.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { Evidence, User } from "../../api/types.ts";
import { p5Paths, useP5Refresh } from "../../api/p5.ts";
import { useAllUsers, useRegister, useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { Field } from "../../components/Form.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { BusinessApprovalNote, DueDate, useUserNames } from "../my-work/p4ui.tsx";
import { NoteForm, StatusChip, pick, useRunner, type Runner } from "../automation/ui.tsx";
import { OverdueCell } from "./MyProceduresPage.tsx";
import { CompleteWithOutput } from "./CompleteWithOutput.tsx";
import { chosenOutputOf, scopeTransformationOf } from "./outputs.ts";
import {
  INSTANCE_STATUS_CHIP,
  STEP_STATUS_CHIP,
  useDefinition,
  useInstance,
  type ProcedureDefinition,
  type ProcedureInstance,
  type ProcedureStepInstance,
} from "./api.ts";

export function InstancePage() {
  const { t } = useTranslation();
  const { instanceId } = useParams();
  const instance = useInstance(instanceId);
  usePageTitle(t("nav.p5.procedureInstance.title"));
  return (
    <div className="page" data-p5-screen="procedure-instance">
      <QueryState query={instance}>{(i) => <InstanceView instance={i} />}</QueryState>
    </div>
  );
}

function InstanceView({ instance: i }: { instance: ProcedureInstance }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const refresh = useP5Refresh(i.transformationId ?? undefined);
  const runner = useRunner(refresh);
  const definition = useDefinition(i.procedureCode, i.methodologyVersionId);
  const names = useUserNames([i.launchedBy, ...i.steps.map((s) => s.assigneeUserId)]);
  const active = i.status === "active";
  const evidence = i.links.filter((l) => l.linkKind === "evidence");
  const outputs = i.links.filter((l) => l.linkKind === "output");
  return (
    <>
      <PageHeader
        title={pick(locale, i.nameEn, i.nameAr)}
        subtitle={t("workflowsP5.procedures.instanceSummary")}
        crumbs={[
          { label: t("nav.p5.myProcedures.title"), to: "/playbook/procedures" },
          { label: pick(locale, i.nameEn, i.nameAr) ?? i.procedureCode },
        ]}
      />
      {runner.alert}
      <section className="card" aria-labelledby="instance-facts" data-instance-status={i.status}>
        <h2 id="instance-facts" className="card__title">
          {t("workflowsP5.procedures.factsTitle")}
        </h2>
        <dl className="workspace-header__grid">
          <dt>{t("workflowsP5.field.status")}</dt>
          <dd>
            <StatusChip value={i.status} table={INSTANCE_STATUS_CHIP} labelKey="workflowsP5.instanceStatus" />
          </dd>
          <dt>{t("workflowsP5.procedures.definitionVersion")}</dt>
          <dd>
            <bdi dir="ltr">
              {i.procedureCode} · v{i.versionNo}
            </bdi>{" "}
            <span className="small muted">{t("workflowsP5.procedures.pinnedNote")}</span>
          </dd>
          <dt>{t("workflowsP5.procedures.dueDate")}</dt>
          <dd>
            <DueDate date={i.dueDate} />
          </dd>
          <dt>{t("workflowsP5.procedures.nextAction")}</dt>
          <dd data-next-action={i.nextAction.kind}>{t(`workflowsP5.nextAction.${i.nextAction.kind}`)}</dd>
          <dt>{t("workflowsP5.procedures.launchedAt")}</dt>
          <dd>
            {formatDateTime(i.launchedAt, locale)} · {names(i.launchedBy)}
          </dd>
          {i.transformationId ? (
            <>
              <dt>{t("workflowsP5.field.transformation")}</dt>
              <dd>
                <Link className="link" to={`/transformations/${i.transformationId}`}>
                  {t("workflowsP5.procedures.openTransformation")}
                </Link>
              </dd>
            </>
          ) : null}
          {i.cancelReason ? (
            <>
              <dt>{t("workflowsP5.procedures.cancelReason")}</dt>
              <dd>{i.cancelReason}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <Section id="missing-inputs" title={t("workflowsP5.procedures.missingInputsTitle")}>
        {i.missingInputs.length === 0 ? (
          <p className="muted" data-missing-inputs="0">
            {t("workflowsP5.procedures.noMissingInputs")}
          </p>
        ) : (
          <ul className="plain-list" data-missing-inputs={i.missingInputs.length}>
            {i.missingInputs.map((m) => (
              <li key={m.key}>
                {pick(locale, m.labelEn, m.labelAr)}{" "}
                <bdi dir="ltr" className="small muted code">
                  {m.key}
                </bdi>
              </li>
            ))}
          </ul>
        )}
        {active && definition.data ? <InputsForm instance={i} definition={definition.data} runner={runner} /> : null}
      </Section>

      <Section id="steps" title={t("workflowsP5.procedures.stepsTitle")}>
        <BusinessApprovalNote body={t("workflowsP5.procedures.approvalStepNote")} />
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.procedures.stepsTitle")}>
          <table className="table" data-table="instance-steps">
            <caption className="visually-hidden">{t("workflowsP5.procedures.stepsTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("workflowsP5.procedures.ordinal")}</th>
                <th scope="col">{t("workflowsP5.procedures.step")}</th>
                <th scope="col">{t("workflowsP5.field.status")}</th>
                <th scope="col">{t("workflowsP5.procedures.assignee")}</th>
                <th scope="col">{t("workflowsP5.procedures.dueDate")}</th>
                <th scope="col">{t("workflowsP5.procedures.overdue")}</th>
              </tr>
            </thead>
            <tbody>
              {[...i.steps]
                .sort((a, b) => a.ordinal - b.ordinal)
                .map((s) => (
                  <tr key={s.stepKey} data-step={s.stepKey} data-step-status={s.status}>
                    <td>
                      <bdi dir="ltr">
                        {s.ordinal}
                        {s.parallelGroup ? ` · ${s.parallelGroup}` : ""}
                      </bdi>
                      {s.parallelGroup ? (
                        <span className="block small muted">{t("workflowsP5.procedures.parallel")}</span>
                      ) : null}
                    </td>
                    <th scope="row">
                      {pick(locale, s.nameEn, s.nameAr)}
                      <span className="block small muted">{t(`workflowsP5.stepKind.${s.stepKind}`)}</span>
                      {s.skipReason ? <span className="block small">{s.skipReason}</span> : null}
                    </th>
                    <td>
                      <StatusChip value={s.status} table={STEP_STATUS_CHIP} labelKey="workflowsP5.stepStatus" />
                    </td>
                    <td>
                      <bdi dir="ltr">{s.assigneeRoleCode}</bdi>
                      <span className="block small">{names(s.assigneeUserId)}</span>
                    </td>
                    <td>
                      <DueDate date={s.dueDate} reason={s.dueDateUnknownReason} />
                    </td>
                    <td>
                      <OverdueCell overdue={s.overdue} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>

      {active
        ? i.steps
            .filter((s) => s.status === "active")
            .map((s) => (
              <StepActions key={s.stepKey} instance={i} step={s} runner={runner} definition={definition.data ?? null} />
            ))
        : null}

      <Section id="evidence" title={t("workflowsP5.procedures.evidenceTitle")}>
        <LinkList links={evidence} empty={t("workflowsP5.procedures.noEvidence")} />
      </Section>
      <Section id="outputs" title={t("workflowsP5.procedures.outputsTitle")}>
        <LinkList links={outputs} empty={t("workflowsP5.procedures.noOutputs")} />
      </Section>

      {active ? (
        <Section id="cancel" title={t("workflowsP5.procedures.cancelTitle")}>
          <NoteForm
            id="cancel-instance"
            label={t("workflowsP5.field.reason")}
            submitLabel={t("workflowsP5.procedures.cancel")}
            required
            min={3}
            busy={runner.busy}
            danger
            onSubmit={(reason) =>
              void runner.run(p5Paths.cancelProcedureInstance(i.id), { body: { reason }, ifMatch: i.version })
            }
          />
        </Section>
      ) : null}
    </>
  );
}

function LinkList({ links, empty }: { links: ProcedureInstance["links"]; empty: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (links.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="plain-list" data-links={links.length}>
      {links.map((l) => (
        <li key={l.id} data-record-type={l.recordType}>
          {t(`workflowsP5.recordType.${l.recordType}`, { defaultValue: l.recordType })}{" "}
          <bdi dir="ltr" className="code small">
            {l.recordId.slice(0, 8)}
          </bdi>
          {l.stepKey ? <span className="small muted"> · {l.stepKey}</span> : null}
          <span className="small muted"> · {formatDateTime(l.createdAt, locale)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Inputs of the instance: one control per declared input (values are strings; decimals stay decimal strings). */
function InputsForm({
  instance: i,
  definition,
  runner,
}: {
  instance: ProcedureInstance;
  definition: ProcedureDefinition;
  runner: Runner;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const initial = Object.fromEntries(
    definition.inputSchema.map((f) => {
      const v = i.inputValues[f.key];
      return [f.key, v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)];
    }),
  ) as Record<string, string>;
  const [values, setValues] = useState(initial);
  if (definition.inputSchema.length === 0) return null;
  return (
    <form
      className="form form--inset"
      noValidate
      data-form="procedure-inputs"
      onSubmit={(e) => {
        e.preventDefault();
        const inputValues: Record<string, unknown> = {};
        for (const f of definition.inputSchema) {
          const v = values[f.key];
          if (typeof v === "string" && v.trim() !== "") inputValues[f.key] = v.trim();
        }
        void runner.run(p5Paths.procedureInstanceInputs(i.id), {
          method: "PATCH",
          body: { inputValues },
          ifMatch: i.version,
        });
      }}
    >
      <h3>{t("workflowsP5.procedures.inputsTitle")}</h3>
      {definition.inputSchema.map((f) => (
        <Field
          key={f.key}
          label={pick(locale, f.labelEn, f.labelAr) ?? f.key}
          hint={pick(locale, f.helpEn, f.helpAr) ?? undefined}
          required={f.required}
        >
          {(p) =>
            f.options && f.options.length > 0 ? (
              <select
                {...p}
                value={String(values[f.key] ?? "")}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                <option value="">{t("workflowsP5.choose")}</option>
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...p}
                type={f.fieldType === "date" ? "date" : "text"}
                inputMode={
                  ["number", "decimal", "currency", "percentage"].includes(f.fieldType) ? "decimal" : undefined
                }
                dir={["number", "decimal", "currency", "percentage", "date"].includes(f.fieldType) ? "ltr" : undefined}
                value={String(values[f.key] ?? "")}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )
          }
        </Field>
      ))}
      <div className="form__actions">
        <button type="submit" className="button button--secondary" disabled={runner.busy}>
          {t("workflowsP5.procedures.saveInputs")}
        </button>
      </div>
    </form>
  );
}

/** The actions of one active step: complete, skip, assign, link evidence (the server decides each). */
function StepActions({
  instance: i,
  step: s,
  runner,
  definition,
}: {
  instance: ProcedureInstance;
  step: ProcedureStepInstance;
  runner: Runner;
  /** null while it loads or when it cannot be read: the note-only form (the server still refuses a missing output). */
  definition: ProcedureDefinition | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  // An organization-scope instance acts in the transformation an earlier step produced (kit.inScope; D-166 Rule A).
  const tid = scopeTransformationOf(i) ?? "";
  const transformation = useTransformation(tid || undefined);
  const users = useAllUsers(transformation.data?.organizationId, Boolean(transformation.data));
  const evidence = useRegister<Evidence>(tid, "evidence", {}, Boolean(tid));
  const [assignee, setAssignee] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const name = pick(locale, s.nameEn, s.nameAr) ?? s.stepKey;
  // A `create` or `link` output is named in `outputRecordId` (D-166); an `advance` output, or a step with no output,
  // keeps the note-only form (the server reads the record an earlier step linked).
  const output = chosenOutputOf(definition, s.stepKey);
  return (
    <Section id={`step-${s.stepKey}`} title={t("workflowsP5.procedures.stepActionsTitle", { step: name })}>
      {s.stepKind === "approval" ? (
        <p className="banner banner--info" role="note" data-state="approval-step">
          {t("workflowsP5.procedures.approvalStepWaiting")}
          {s.approvalId ? (
            <>
              {" "}
              <Link className="link" to={`/my-work/approvals/${s.approvalId}`}>
                {t("workflowsP5.procedures.openApproval")}
              </Link>
            </>
          ) : null}
        </p>
      ) : output ? (
        <CompleteWithOutput instance={i} step={s} recordType={output.recordType} mode={output.mode} runner={runner} />
      ) : (
        <NoteForm
          id={`complete-${s.stepKey}`}
          label={t("workflowsP5.field.note")}
          submitLabel={t("workflowsP5.procedures.complete")}
          required={false}
          max={2000}
          busy={runner.busy}
          onSubmit={(note) =>
            void runner.run(p5Paths.completeProcedureStep(i.id, s.stepKey), {
              body: note ? { note } : {},
              ifMatch: i.version,
            })
          }
        />
      )}
      <div className="grid grid--3">
        <form
          className="form form--inset"
          noValidate
          data-form={`assign-${s.stepKey}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!assignee) return;
            void runner.run(p5Paths.assignProcedureStep(i.id, s.stepKey), {
              body: { assigneeUserId: assignee },
              ifMatch: i.version,
            });
          }}
        >
          <Field label={t("workflowsP5.procedures.assignee")}>
            {(p) => (
              <select {...p} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">{t("workflowsP5.choose")}</option>
                {(users.data ?? []).map((u: User) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="form__actions">
            <button type="submit" className="button button--secondary" disabled={runner.busy || !assignee}>
              {t("workflowsP5.procedures.assign")}
            </button>
          </div>
        </form>
        <form
          className="form form--inset"
          noValidate
          data-form={`evidence-${s.stepKey}`}
          onSubmit={(e) => {
            e.preventDefault();
            if (!evidenceId) return;
            void runner.run(p5Paths.linkProcedureStepEvidence(i.id, s.stepKey), {
              body: { evidenceId },
              ifMatch: i.version,
            });
          }}
        >
          <Field label={t("workflowsP5.procedures.evidence")}>
            {(p) => (
              <select {...p} value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)}>
                <option value="">{t("workflowsP5.choose")}</option>
                {(evidence.data ?? []).map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="form__actions">
            <button type="submit" className="button button--secondary" disabled={runner.busy || !evidenceId}>
              {t("workflowsP5.procedures.linkEvidence")}
            </button>
          </div>
        </form>
        <NoteForm
          id={`skip-${s.stepKey}`}
          label={t("workflowsP5.field.reason")}
          submitLabel={t("workflowsP5.procedures.skip")}
          required
          min={3}
          busy={runner.busy}
          onSubmit={(reason) =>
            void runner.run(p5Paths.skipProcedureStep(i.id, s.stepKey), { body: { reason }, ifMatch: i.version })
          }
        />
      </div>
    </Section>
  );
}
