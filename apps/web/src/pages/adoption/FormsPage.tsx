// Change and Adoption > Feedback and assessment forms (T-DG4-FE-E; p4-work-split §F+G FG.8; ADR-0033 §5).
// SYNTHETIC data only in tests and demos.
//  - REQ-S11-002: short native forms built in the platform (question builder), published, sent as invitations,
//    answered (feedback or a proficiency observation) and reviewed. A response always answers the PUBLISHED version.
//  - `/transformations/:id/assessment-forms/:formId` is the `assessment_invitation` work-item link (respond there);
//    `/transformations/:id/assessment-records/:recordId` the `assessment_to_review` link (RecordPage.tsx).
//  - The derived proficiency result is the API's; the client never sends it.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { AssessmentQuestion } from "@mth/shared/calc";
import { ASSESSMENT_FORM_STATUSES } from "@mth/shared/schemas";
import { ApiError, api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog, Field } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { fieldErrorMessage, pointerToField } from "../../lib/problem.ts";
import { DueDate, FormAlert, P4FormDialog, textOf, type P4FieldSpec } from "../my-work/p4ui.tsx";
import { useActionRunner } from "./actions.tsx";
import {
  adoptionPaths,
  useAssessmentForm,
  useAssessmentForms,
  useAssessmentRecords,
  useInvitations,
  useStakeholderGroups,
  type AssessmentForm,
  type AssessmentInvitation,
  type AssessmentRecord,
} from "./api.ts";
import { FormBuilderDialog } from "./FormBuilder.tsx";
import { ProficiencyResult } from "./TrainingPage.tsx";
import { AdoptionSubNav, FORM_WRITE_PERMISSIONS, NS, StatusText } from "./ui.tsx";

export function FormsPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="adoption"
      title={t("adoptionP4.forms.title")}
      subtitle={t("adoptionP4.forms.intro")}
      writePermissions={FORM_WRITE_PERMISSIONS}
    >
      <FormsBody />
    </WorkspaceFrame>
  );
}

export function FormPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame tab="adoption" title={t("adoptionP4.forms.detailTitle")} writePermissions={FORM_WRITE_PERMISSIONS}>
      <FormDetail />
    </WorkspaceFrame>
  );
}

function FormsBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [status, setStatus] = useState("");
  const forms = useAssessmentForms(ws.tid, status ? { status } : {});
  const [creating, setCreating] = useState(false);
  const columns: RegisterColumn<AssessmentForm>[] = [
    {
      id: "name",
      header: t("adoptionP4.forms.name"),
      rowHeader: true,
      hideable: false,
      cell: (f) => (
        <Link className="link" to={`/transformations/${ws.tid}/assessment-forms/${f.id}`} data-form-link={f.name}>
          {f.name}
        </Link>
      ),
      sortValue: (f) => f.name,
    },
    { id: "kind", header: t("adoptionP4.forms.kind"), cell: (f) => t(`adoptionP4.formKind.${f.kind}`) },
    { id: "status", header: t("adoptionP4.col.status"), cell: (f) => <StatusText status={f.status} /> },
    {
      id: "versions",
      header: t("adoptionP4.forms.versions"),
      cell: (f) => <VersionText form={f} />,
    },
  ];
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <Section
        id="assessment-forms"
        title={t("adoptionP4.forms.tableTitle")}
        actions={
          ws.can("assessment_form.manage") ? (
            <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> {t("adoptionP4.forms.create")}
            </button>
          ) : null
        }
      >
        <div className="filters" role="group" aria-label={t("adoptionP4.filters")}>
          <div className="filters__select">
            <label htmlFor="form-filter-status">{t("adoptionP4.col.status")}</label>
            <select id="form-filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t("adoptionP4.all")}</option>
              {ASSESSMENT_FORM_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {t(`adoptionP4.status.${v}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <QueryState query={forms}>
          {(rows) => (
            <RegisterTable
              id="assessment-forms"
              caption={t("adoptionP4.forms.tableTitle")}
              rows={rows}
              columns={columns}
              getRowId={(f) => f.id}
              emptyTitle={t("adoptionP4.forms.empty")}
              defaultSort={{ id: "name", dir: "asc" }}
            />
          )}
        </QueryState>
      </Section>
      {creating ? <FormBuilderDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

/** "Published v1 · draft v2 not yet published" (a draft version is clearly not what respondents answer). */
function VersionText({ form }: { form: AssessmentForm }) {
  const { t } = useTranslation();
  const current = form.currentVersion.versionNo;
  const published = form.publishedVersionNo;
  return (
    <span className="block small" data-versions={`${published ?? "-"}/${current}`}>
      {published === null
        ? t("adoptionP4.forms.neverPublished")
        : t("adoptionP4.forms.publishedVersion", { n: published })}
      {published !== null && current > published ? (
        <span className="block">{t("adoptionP4.forms.draftVersion", { n: current })}</span>
      ) : null}
    </span>
  );
}

/** The question label in the shown language. */
export function questionLabel(q: AssessmentQuestion, locale: string): string {
  return locale === "ar" ? q.label_ar : q.label_en;
}

function FormDetail() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { formId = "" } = useParams();
  const query = useAssessmentForm(ws.tid, formId);
  const runner = useActionRunner(ws.tid, NS);
  const [dialog, setDialog] = useState<"edit" | "invite" | "respond" | null>(null);
  return (
    <>
      <AdoptionSubNav tid={ws.tid} />
      <QueryState query={query}>
        {(f) => {
          const canManage = ws.can("assessment_form.manage") && f.status !== "retired";
          const publishable =
            canManage && (f.status === "draft" || (f.publishedVersionNo ?? 0) < f.currentVersion.versionNo);
          const canRespond = f.status === "published" && (ws.can("assessment.respond") || ws.can("proficiency.record"));
          return (
            <>
              <Section
                id="assessment-form"
                title={f.name}
                intro={f.description ?? undefined}
                actions={
                  <span className="chip-row">
                    {canRespond ? (
                      <button
                        type="button"
                        className="button button--primary"
                        onClick={() => setDialog("respond")}
                        data-respond
                      >
                        <Icon name="pencil" /> {t("adoptionP4.forms.respond")}
                      </button>
                    ) : null}
                    {canManage ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() => setDialog("edit")}
                        data-edit-questions
                      >
                        <Icon name="pencil" /> {t("adoptionP4.forms.editQuestions")}
                      </button>
                    ) : null}
                    {publishable ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={runner.busy !== null}
                        onClick={() => void runner.run("publish", adoptionPaths.formPublish(ws.tid, f.id), f.version)}
                        data-publish
                      >
                        <Icon name="lock" /> {t("adoptionP4.forms.publish", { n: f.currentVersion.versionNo })}
                      </button>
                    ) : null}
                    {canManage && f.status === "published" ? (
                      <button
                        type="button"
                        className="button button--secondary"
                        disabled={runner.busy !== null}
                        onClick={() => void runner.run("retire", adoptionPaths.formRetire(ws.tid, f.id), f.version)}
                      >
                        <Icon name="archive" /> {t("adoptionP4.forms.retire")}
                      </button>
                    ) : null}
                  </span>
                }
              >
                {runner.alert}
                <dl className="details">
                  <dt>{t("adoptionP4.forms.kind")}</dt>
                  <dd>{t(`adoptionP4.formKind.${f.kind}`)}</dd>
                  <dt>{t("adoptionP4.col.status")}</dt>
                  <dd>
                    <StatusText status={f.status} />
                  </dd>
                  <dt>{t("adoptionP4.forms.versions")}</dt>
                  <dd>
                    <VersionText form={f} />
                  </dd>
                </dl>
                {f.status === "draft" ? (
                  <p className="banner banner--info" role="note" data-state="draft">
                    <Icon name="pencil" /> {t("adoptionP4.forms.draftNote")}
                  </p>
                ) : null}
                <h3>{t("adoptionP4.forms.questionsOf", { n: f.currentVersion.versionNo })}</h3>
                <ol data-questions>
                  {f.currentVersion.schema.questions.map((q) => (
                    <li key={q.key} data-question-key={q.key}>
                      {questionLabel(q, locale)}{" "}
                      <span className="small muted">
                        ({t(`adoptionP4.questionType.${q.type}`)}
                        {q.required ? `, ${t("adoptionP4.forms.required")}` : ""}
                        {q.proficiency ? `, ${t("adoptionP4.forms.proficiencyQuestion")}` : ""})
                      </span>
                    </li>
                  ))}
                </ol>
              </Section>
              <InvitationsSection form={f} onInvite={() => setDialog("invite")} />
              <RecordsSection form={f} />
              {dialog === "edit" ? <FormBuilderDialog form={f} onClose={() => setDialog(null)} /> : null}
              {dialog === "invite" ? <InviteDialog form={f} onClose={() => setDialog(null)} /> : null}
              {dialog === "respond" ? <RespondDialog form={f} onClose={() => setDialog(null)} /> : null}
            </>
          );
        }}
      </QueryState>
    </>
  );
}

function InvitationsSection({ form, onInvite }: { form: AssessmentForm; onInvite: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const list = useInvitations(ws.tid, form.id);
  const { byId } = usePeople(ws.tid);
  const runner = useActionRunner(ws.tid, NS);
  const canManage = ws.can("assessment_form.manage");
  const columns: RegisterColumn<AssessmentInvitation>[] = [
    {
      id: "user",
      header: t("adoptionP4.forms.invitee"),
      rowHeader: true,
      hideable: false,
      cell: (i) => <PersonName id={i.userId} people={byId} />,
    },
    {
      id: "due",
      header: t("adoptionP4.col.due"),
      cell: (i) => (i.dueDate ? <DueDate date={i.dueDate} /> : t("adoptionP4.none")),
    },
    { id: "status", header: t("adoptionP4.col.status"), cell: (i) => <StatusText status={i.status} /> },
    {
      id: "rowActions",
      header: t("adoptionP4.col.actions"),
      hideable: false,
      cell: (i) =>
        canManage && i.status === "open" ? (
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={runner.busy !== null}
            onClick={() => void runner.run(i.id, adoptionPaths.invitationCancel(ws.tid, i.id), i.version)}
          >
            {t("adoptionP4.forms.cancelInvitation")}
          </button>
        ) : null,
    },
  ];
  return (
    <Section
      id="assessment-invitations"
      title={t("adoptionP4.forms.invitationsTitle")}
      actions={
        canManage && form.status === "published" ? (
          <button type="button" className="button button--secondary" onClick={onInvite} data-invite>
            <Icon name="plus" /> {t("adoptionP4.forms.invite")}
          </button>
        ) : null
      }
    >
      {runner.alert}
      {form.status !== "published" ? <p className="small muted">{t("adoptionP4.forms.inviteNeedsPublished")}</p> : null}
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="assessment-invitations"
            caption={t("adoptionP4.forms.invitationsTitle")}
            rows={rows}
            columns={columns}
            getRowId={(i) => i.id}
            emptyTitle={t("adoptionP4.forms.noInvitations")}
            defaultSort={{ id: "user", dir: "asc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}

function InviteDialog({ form, onClose }: { form: AssessmentForm; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const groups = useStakeholderGroups(ws.tid, { status: "active" });
  const fields: P4FieldSpec[] = [
    {
      name: "stakeholderGroupId",
      label: t("adoptionP4.col.stakeholder"),
      kind: "select",
      required: true,
      options: (groups.data ?? []).map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` })),
    },
    {
      name: "userId",
      label: t("adoptionP4.forms.invitee"),
      kind: "select",
      required: true,
      options: people.map((p) => ({ value: p.id, label: p.label })),
    },
    ...(form.kind === "proficiency_assessment"
      ? [
          {
            name: "subjectUserId",
            label: t("adoptionP4.records.subject"),
            kind: "select",
            options: people.map((p) => ({ value: p.id, label: p.label })),
          } satisfies P4FieldSpec,
        ]
      : []),
    { name: "dueDate", label: t("adoptionP4.col.due"), kind: "date" },
  ];
  return (
    <P4FormDialog
      title={t("adoptionP4.forms.inviteTitle", { name: form.name })}
      description={t("adoptionP4.forms.inviteIntro")}
      fields={fields}
      initial={{ stakeholderGroupId: form.stakeholderGroupId ?? "" }}
      submitLabel={t("adoptionP4.forms.inviteSubmit")}
      url={adoptionPaths.invitations(ws.tid, form.id)}
      namespaces={NS}
      toBody={(v) => {
        return {
          userIds: [v["userId"]],
          stakeholderGroupId: v["stakeholderGroupId"],
          ...(v["subjectUserId"] ? { subjectUserId: v["subjectUserId"] } : {}),
          ...(v["dueDate"] ? { dueDate: v["dueDate"] } : {}),
        };
      }}
      onDone={refresh}
      onClose={onClose}
    />
  );
}

/** Answers a published form: feedback, or a proficiency observation that links to its stakeholder group. */
function RespondDialog({ form, onClose }: { form: AssessmentForm; onClose: () => void }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const invitations = useInvitations(ws.tid, form.id);
  const groups = useStakeholderGroups(ws.tid, { status: "active" });
  const { people } = usePeople(ws.tid);
  const mine = (invitations.data ?? []).filter((i) => i.userId === ws.meId && i.status === "open");
  const observation = form.kind === "proficiency_assessment";
  const [invitationId, setInvitationId] = useState("");
  const [groupId, setGroupId] = useState(form.stakeholderGroupId ?? "");
  const [subjectUserId, setSubjectUserId] = useState("");
  const [subjectLabel, setSubjectLabel] = useState("");
  const [observedOn, setObservedOn] = useState(new Date().toISOString().slice(0, 10));
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // The published version is what a respondent answers; the current one is shown only when it is the published one.
  const questions =
    form.currentVersion.versionNo === form.publishedVersionNo ? form.currentVersion.schema.questions : null;
  const invitation = mine.find((i) => i.id === invitationId);

  const value = (q: AssessmentQuestion): unknown => {
    const raw = answers[q.key] ?? "";
    if (raw === "") return undefined;
    if (q.type === "scale") return Number(raw);
    if (q.type === "yes_no") return raw === "yes";
    return raw;
  };

  const submit = async () => {
    if (!questions) return;
    setServerError(null);
    const next: Record<string, string> = {};
    const group = invitation?.stakeholderGroupId ?? groupId;
    if (!group) next["group"] = "validation.required";
    if (!observedOn) next["observedOn"] = "validation.required";
    if (observation && !invitation?.subjectUserId && !subjectUserId && subjectLabel.trim() === "")
      next["subject"] = "assessment_record.subject_required";
    for (const q of questions)
      if (q.required && value(q) === undefined) next[`a.${q.key}`] = "assessment_record.answer_required";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const body: Record<string, unknown> = {
      formId: form.id,
      stakeholderGroupId: group,
      observedOn,
      answers: Object.fromEntries(questions.map((q) => [q.key, value(q)]).filter(([, v]) => v !== undefined)),
      ...(invitation ? { invitationId: invitation.id } : {}),
    };
    if (observation && !invitation?.subjectUserId) {
      if (subjectUserId) body["subjectUserId"] = subjectUserId;
      else if (textOf(subjectLabel)) body["subjectLabel"] = subjectLabel;
    }
    if (observation && invitation?.subjectUserId) body["subjectUserId"] = invitation.subjectUserId;
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(adoptionPaths.records(ws.tid), { method: "POST", body });
      if (action.stale()) return;
      if (!(await refresh())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      const fe = e instanceof ApiError ? e.fieldErrors : [];
      const onAnswers = fe.filter((x) => x.pointer.startsWith("/answers/"));
      if (onAnswers.length > 0 && onAnswers.length === fe.length) {
        setErrors(
          Object.fromEntries(
            onAnswers.map((x) => [`a.${pointerToField(x.pointer).replace(/^answers\./, "")}`, x.code]),
          ),
        );
      } else setServerError(e);
      if (e instanceof ApiError && e.status === 409) await refresh();
    } finally {
      setBusy(false);
    }
  };
  const err = (k: string) => (errors[k] ? fieldErrorMessage(t, errors[k]) : undefined);
  return (
    <Dialog
      title={t("adoptionP4.forms.respondTitle", { name: form.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || !questions}
            onClick={() => void submit()}
            data-action="submit"
          >
            {busy ? t("common.state.saving") : t("adoptionP4.forms.submitResponse")}
          </button>
        </>
      }
    >
      <div className="dialog__description">
        {observation ? t("adoptionP4.forms.observationIntro") : t("adoptionP4.forms.feedbackIntro")}
      </div>
      <FormAlert error={serverError} namespaces={NS} />
      {!questions ? <p className="banner banner--info">{t("adoptionP4.forms.publishedNotLoaded")}</p> : null}
      <Field label={t("adoptionP4.forms.invitation")} hint={t("adoptionP4.forms.invitationHint")}>
        {(c) => (
          <select {...c} value={invitationId} onChange={(e) => setInvitationId(e.target.value)}>
            <option value="">{t("adoptionP4.forms.noInvitation")}</option>
            {mine.map((i) => (
              <option key={i.id} value={i.id}>
                {t("adoptionP4.forms.invitationOption", { due: i.dueDate ?? t("adoptionP4.none") })}
              </option>
            ))}
          </select>
        )}
      </Field>
      {invitation ? null : (
        <Field label={t("adoptionP4.col.stakeholder")} required error={err("group")}>
          {(c) => (
            <select {...c} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">{t("common.form.choose")}</option>
              {(groups.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.code} · {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {observation && !invitation?.subjectUserId ? (
        <>
          <Field
            label={t("adoptionP4.records.subject")}
            hint={t("adoptionP4.forms.subjectHint")}
            required
            error={err("subject")}
          >
            {(c) => (
              <select {...c} value={subjectUserId} onChange={(e) => setSubjectUserId(e.target.value)}>
                <option value="">{t("adoptionP4.forms.subjectByLabel")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {subjectUserId ? null : (
            <Field label={t("adoptionP4.forms.subjectLabel")}>
              {(c) => (
                <input
                  {...c}
                  type="text"
                  maxLength={200}
                  value={subjectLabel}
                  onChange={(e) => setSubjectLabel(e.target.value)}
                />
              )}
            </Field>
          )}
        </>
      ) : null}
      <Field label={t("adoptionP4.records.observedOn")} required error={err("observedOn")}>
        {(c) => <input {...c} type="date" value={observedOn} onChange={(e) => setObservedOn(e.target.value)} />}
      </Field>
      {(questions ?? []).map((q) => (
        <Field key={q.key} label={questionLabel(q, locale)} required={q.required} error={err(`a.${q.key}`)}>
          {(c) => {
            const common = { ...c, "data-answer": q.key, value: answers[q.key] ?? "" };
            const set = (v: string) => setAnswers((a) => ({ ...a, [q.key]: v }));
            if (q.type === "text")
              return <textarea {...common} rows={3} maxLength={2000} onChange={(e) => set(e.target.value)} />;
            const opts =
              q.type === "yes_no"
                ? [
                    { value: "yes", label: t("adoptionP4.forms.yes") },
                    { value: "no", label: t("adoptionP4.forms.no") },
                  ]
                : q.type === "scale"
                  ? Array.from({ length: (q.max ?? 0) - (q.min ?? 0) + 1 }, (_, k) => {
                      const n = String((q.min ?? 0) + k);
                      return { value: n, label: n };
                    })
                  : (q.options ?? []).map((o) => ({
                      value: o.value,
                      label: locale === "ar" ? o.label_ar : o.label_en,
                    }));
            return (
              <select {...common} onChange={(e) => set(e.target.value)}>
                <option value="">{t("common.form.choose")}</option>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
          }}
        </Field>
      ))}
    </Dialog>
  );
}

function RecordsSection({ form }: { form: AssessmentForm }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const list = useAssessmentRecords(ws.tid, { assessmentFormId: form.id });
  const { byId } = usePeople(ws.tid);
  const columns: RegisterColumn<AssessmentRecord>[] = [
    {
      id: "respondent",
      header: t("adoptionP4.records.respondent"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <Link className="link" to={`/transformations/${ws.tid}/assessment-records/${r.id}`} data-record-link={r.id}>
          <PersonName id={r.respondentUserId} people={byId} />
        </Link>
      ),
    },
    {
      id: "observedOn",
      header: t("adoptionP4.records.observedOn"),
      cell: (r) => <DueDate date={r.observedOn} />,
      sortValue: (r) => r.observedOn,
    },
    { id: "version", header: t("adoptionP4.records.formVersion"), cell: (r) => `v${r.formVersionNo}` },
    ...(form.kind === "proficiency_assessment"
      ? [
          {
            id: "result",
            header: t("adoptionP4.records.result"),
            cell: (r: AssessmentRecord) => <ProficiencyResult result={r.proficiencyResult} />,
          } satisfies RegisterColumn<AssessmentRecord>,
        ]
      : []),
    { id: "status", header: t("adoptionP4.col.status"), cell: (r) => <StatusText status={r.status} /> },
  ];
  return (
    <Section id="assessment-records" title={t("adoptionP4.records.title")}>
      <QueryState query={list}>
        {(rows) => (
          <RegisterTable
            id="assessment-records"
            caption={t("adoptionP4.records.title")}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("adoptionP4.records.empty")}
            defaultSort={{ id: "observedOn", dir: "desc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}
