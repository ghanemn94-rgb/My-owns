// The question builder of the short native feedback and assessment forms (T-DG4-FE-E; ADR-0033 §5; REQ-S11-002).
// It edits the validated form JSON {"questions": [...]} (1-20 questions; key, type, label_en, label_ar, required;
// options for single_choice; min/max for scale; proficiency and pass_min). The server is the judge: a refusal is 400
// `assessment_form.schema_invalid` at the failing pointer, which this builder marks on the question it names (and
// translates; the English reason is not shown in Arabic). Saving questions creates the next form version; the
// published version stays what respondents answer until the form is published again.
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ASSESSMENT_FORM_KINDS,
  ASSESSMENT_QUESTION_KEY,
  ASSESSMENT_QUESTION_TYPES,
  type AssessmentQuestion,
} from "@mth/shared/calc";
import { ApiError, api } from "../../api/client.ts";
import { useP4Refresh } from "../../api/p4.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { Dialog, Field, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { fieldErrorMessage } from "../../lib/problem.ts";
import { FormAlert } from "../my-work/p4ui.tsx";
import { adoptionPaths, useStakeholderGroups, type AssessmentForm } from "./api.ts";
import { NS } from "./ui.tsx";

interface DraftOption {
  value: string;
  label_en: string;
  label_ar: string;
}
interface DraftQuestion {
  key: string;
  type: AssessmentQuestion["type"];
  label_en: string;
  label_ar: string;
  required: boolean;
  options: DraftOption[];
  min: string;
  max: string;
  proficiency: boolean;
  pass_min: string;
}

const blankQuestion = (n: number): DraftQuestion => ({
  key: `q${n}`,
  type: "yes_no",
  label_en: "",
  label_ar: "",
  required: true,
  options: [
    { value: "a", label_en: "", label_ar: "" },
    { value: "b", label_en: "", label_ar: "" },
  ],
  min: "1",
  max: "5",
  proficiency: false,
  pass_min: "",
});

const fromQuestion = (q: AssessmentQuestion): DraftQuestion => ({
  key: q.key,
  type: q.type,
  label_en: q.label_en,
  label_ar: q.label_ar,
  required: q.required,
  options: q.options ? q.options.map((o) => ({ ...o })) : blankQuestion(0).options,
  min: q.min === undefined ? "1" : String(q.min),
  max: q.max === undefined ? "5" : String(q.max),
  proficiency: q.proficiency === true,
  pass_min: q.pass_min === undefined ? "" : String(q.pass_min),
});

/** The form JSON of the draft (only the members each question type takes). */
export function toSchema(questions: readonly DraftQuestion[], kind: string): { questions: Record<string, unknown>[] } {
  return {
    questions: questions.map((q) => {
      const out: Record<string, unknown> = {
        key: q.key,
        type: q.type,
        label_en: q.label_en,
        label_ar: q.label_ar,
        required: q.required,
      };
      if (q.type === "single_choice") out["options"] = q.options.map((o) => ({ ...o }));
      if (q.type === "scale") {
        out["min"] = Number(q.min);
        out["max"] = Number(q.max);
      }
      if (kind === "proficiency_assessment" && q.proficiency && (q.type === "scale" || q.type === "yes_no")) {
        out["proficiency"] = true;
        if (q.type === "scale") out["pass_min"] = q.pass_min === "" ? null : Number(q.pass_min);
      }
      return out;
    }),
  };
}

/** The index of the question a schema pointer names (`/schema/questions/2/label_ar` → 2), or null. */
export function questionIndexOf(pointer: string): number | null {
  const m = /\/questions\/(\d+)/.exec(pointer);
  return m ? Number(m[1]) : null;
}

export function FormBuilderDialog({ form, onClose }: { form?: AssessmentForm; onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP4Refresh(ws.tid);
  const groups = useStakeholderGroups(ws.tid, { status: "active" });
  const [kind, setKind] = useState<string>(form?.kind ?? "feedback");
  const [name, setName] = useState(form?.name ?? "");
  const [description, setDescription] = useState(form?.description ?? "");
  const [groupId, setGroupId] = useState(form?.stakeholderGroupId ?? "");
  const [questions, setQuestions] = useState<DraftQuestion[]>(
    form ? form.currentVersion.schema.questions.map(fromQuestion) : [blankQuestion(1)],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [badQuestions, setBadQuestions] = useState<Set<number>>(new Set());
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(ref);
  const baseId = useId();

  const update = (i: number, patch: Partial<DraftQuestion>) =>
    setQuestions((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, d: -1 | 1) =>
    setQuestions((qs) => {
      const j = i + d;
      if (j < 0 || j >= qs.length) return qs;
      const out = [...qs];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });

  const submit = async () => {
    setServerError(null);
    const next: Record<string, string> = {};
    if (!form && name.trim() === "") next["name"] = "validation.required";
    questions.forEach((q, i) => {
      if (!ASSESSMENT_QUESTION_KEY.test(q.key)) next[`q${i}.key`] = "validation.invalid";
      if (q.label_en.trim() === "") next[`q${i}.label_en`] = "validation.required";
      if (q.label_ar.trim() === "") next[`q${i}.label_ar`] = "validation.required";
    });
    setErrors(next);
    setBadQuestions(new Set());
    if (Object.keys(next).length > 0) {
      focusInvalid();
      return;
    }
    const schema = toSchema(questions, kind);
    const body: Record<string, unknown> = form
      ? { schema }
      : {
          kind,
          name,
          schema,
          ...(description.trim() ? { description } : {}),
          ...(groupId ? { stakeholderGroupId: groupId } : {}),
        };
    if (form) {
      if (name !== form.name) body["name"] = name;
      if ((description || null) !== form.description) body["description"] = description.trim() ? description : null;
      if ((groupId || null) !== form.stakeholderGroupId) body["stakeholderGroupId"] = groupId || null;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(form ? adoptionPaths.form(ws.tid, form.id) : adoptionPaths.forms(ws.tid), {
        method: form ? "PATCH" : "POST",
        body,
        ...(form ? { ifMatch: form.version } : {}),
      });
      if (action.stale()) return;
      if (!(await refresh())) return;
      onClose();
    } catch (e) {
      if (action.stale(e)) return;
      setServerError(e);
      if (e instanceof ApiError) {
        const idx = new Set<number>();
        for (const fe of e.fieldErrors) {
          const n = questionIndexOf(fe.pointer);
          if (n !== null) idx.add(n);
        }
        setBadQuestions(idx);
        if (e.status === 409) await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const err = (k: string) => (errors[k] ? fieldErrorMessage(t, errors[k]) : undefined);
  return (
    <Dialog
      title={form ? t("adoptionP4.forms.editTitle", { name: form.name }) : t("adoptionP4.forms.create")}
      onClose={onClose}
      dialogRef={ref}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void submit()}
            disabled={busy}
            data-action="submit"
          >
            {busy
              ? t("common.state.saving")
              : form
                ? t("adoptionP4.forms.saveVersion")
                : t("adoptionP4.forms.createSubmit")}
          </button>
        </>
      }
    >
      <div className="dialog__description">
        {form ? t("adoptionP4.forms.newVersionNote") : t("adoptionP4.forms.createIntro")}
      </div>
      <FormAlert error={serverError} namespaces={NS} />
      {form ? null : (
        <Field label={t("adoptionP4.forms.kind")} required>
          {(c) => (
            <select {...c} value={kind} onChange={(e) => setKind(e.target.value)} data-field="kind">
              {ASSESSMENT_FORM_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`adoptionP4.formKind.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label={t("adoptionP4.forms.name")} required error={err("name")}>
        {(c) => (
          <input
            {...c}
            type="text"
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-field="name"
          />
        )}
      </Field>
      <Field label={t("adoptionP4.field.description")}>
        {(c) => (
          <textarea
            {...c}
            rows={2}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <Field label={t("adoptionP4.col.stakeholder")} hint={t("adoptionP4.forms.groupHint")}>
        {(c) => (
          <select {...c} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">{t("adoptionP4.forms.anyGroup")}</option>
            {(groups.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} · {g.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {kind === "proficiency_assessment" ? (
        <p className="small muted">{t("adoptionP4.forms.proficiencyRule")}</p>
      ) : null}
      <ol className="plain-list" data-question-builder>
        {questions.map((q, i) => (
          <li
            key={i}
            className="card form--inset"
            data-question={i}
            data-invalid={badQuestions.has(i) ? "true" : undefined}
          >
            <fieldset
              className="plain-fieldset"
              aria-describedby={badQuestions.has(i) ? `${baseId}-q${i}-bad` : undefined}
            >
              <legend className="small-heading">{t("adoptionP4.forms.question", { n: i + 1 })}</legend>
              {badQuestions.has(i) ? (
                <p id={`${baseId}-q${i}-bad`} className="field__error">
                  <Icon name="alert" /> {t("adoptionP4.forms.questionInvalid")}
                </p>
              ) : null}
              <Field
                label={t("adoptionP4.forms.key")}
                hint={t("adoptionP4.forms.keyHint")}
                required
                error={err(`q${i}.key`)}
              >
                {(c) => (
                  <input
                    {...c}
                    dir="ltr"
                    type="text"
                    maxLength={40}
                    value={q.key}
                    onChange={(e) => update(i, { key: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("adoptionP4.forms.type")} required>
                {(c) => (
                  <select
                    {...c}
                    value={q.type}
                    onChange={(e) => update(i, { type: e.target.value as DraftQuestion["type"] })}
                  >
                    {ASSESSMENT_QUESTION_TYPES.map((x) => (
                      <option key={x} value={x}>
                        {t(`adoptionP4.questionType.${x}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t("adoptionP4.forms.labelEn")} required error={err(`q${i}.label_en`)}>
                {(c) => (
                  <input
                    {...c}
                    lang="en"
                    dir="ltr"
                    type="text"
                    maxLength={500}
                    value={q.label_en}
                    onChange={(e) => update(i, { label_en: e.target.value })}
                  />
                )}
              </Field>
              <Field label={t("adoptionP4.forms.labelAr")} required error={err(`q${i}.label_ar`)}>
                {(c) => (
                  <input
                    {...c}
                    lang="ar"
                    dir="rtl"
                    type="text"
                    maxLength={500}
                    value={q.label_ar}
                    onChange={(e) => update(i, { label_ar: e.target.value })}
                  />
                )}
              </Field>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) => update(i, { required: e.target.checked })}
                />
                {t("adoptionP4.forms.required")}
              </label>
              {q.type === "single_choice" ? (
                <fieldset className="plain-fieldset">
                  <legend className="small">{t("adoptionP4.forms.options")}</legend>
                  {q.options.map((o, k) => (
                    <div key={k} className="p4-inline-field">
                      <Field label={t("adoptionP4.forms.optionValue", { n: k + 1 })}>
                        {(c) => (
                          <input
                            {...c}
                            dir="ltr"
                            type="text"
                            maxLength={40}
                            value={o.value}
                            onChange={(e) =>
                              update(i, {
                                options: q.options.map((x, m) => (m === k ? { ...x, value: e.target.value } : x)),
                              })
                            }
                          />
                        )}
                      </Field>
                      <Field label={t("adoptionP4.forms.optionLabelEn", { n: k + 1 })}>
                        {(c) => (
                          <input
                            {...c}
                            lang="en"
                            dir="ltr"
                            type="text"
                            maxLength={200}
                            value={o.label_en}
                            onChange={(e) =>
                              update(i, {
                                options: q.options.map((x, m) => (m === k ? { ...x, label_en: e.target.value } : x)),
                              })
                            }
                          />
                        )}
                      </Field>
                      <Field label={t("adoptionP4.forms.optionLabelAr", { n: k + 1 })}>
                        {(c) => (
                          <input
                            {...c}
                            lang="ar"
                            dir="rtl"
                            type="text"
                            maxLength={200}
                            value={o.label_ar}
                            onChange={(e) =>
                              update(i, {
                                options: q.options.map((x, m) => (m === k ? { ...x, label_ar: e.target.value } : x)),
                              })
                            }
                          />
                        )}
                      </Field>
                    </div>
                  ))}
                  <span className="chip-row">
                    <button
                      type="button"
                      className="button button--link button--small"
                      disabled={q.options.length >= 10}
                      onClick={() =>
                        update(i, {
                          options: [...q.options, { value: `o${q.options.length + 1}`, label_en: "", label_ar: "" }],
                        })
                      }
                    >
                      <Icon name="plus" /> {t("adoptionP4.forms.addOption")}
                    </button>
                    <button
                      type="button"
                      className="button button--link button--small"
                      disabled={q.options.length <= 2}
                      onClick={() => update(i, { options: q.options.slice(0, -1) })}
                    >
                      {t("adoptionP4.forms.removeOption")}
                    </button>
                  </span>
                </fieldset>
              ) : null}
              {q.type === "scale" ? (
                <div className="p4-inline-field">
                  <Field label={t("adoptionP4.forms.min")}>
                    {(c) => (
                      <input
                        {...c}
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        value={q.min}
                        onChange={(e) => update(i, { min: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label={t("adoptionP4.forms.max")}>
                    {(c) => (
                      <input
                        {...c}
                        type="number"
                        min={0}
                        max={10}
                        step={1}
                        value={q.max}
                        onChange={(e) => update(i, { max: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              ) : null}
              {kind === "proficiency_assessment" && (q.type === "scale" || q.type === "yes_no") ? (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={q.proficiency}
                    onChange={(e) => update(i, { proficiency: e.target.checked })}
                  />
                  {t("adoptionP4.forms.proficiencyQuestion")}
                </label>
              ) : null}
              {kind === "proficiency_assessment" && q.proficiency && q.type === "scale" ? (
                <Field label={t("adoptionP4.forms.passMin")} hint={t("adoptionP4.forms.passMinHint")}>
                  {(c) => (
                    <input
                      {...c}
                      type="number"
                      min={0}
                      max={10}
                      step={1}
                      value={q.pass_min}
                      onChange={(e) => update(i, { pass_min: e.target.value })}
                    />
                  )}
                </Field>
              ) : null}
              <span className="chip-row">
                <button
                  type="button"
                  className="button button--link button--small"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="chevronUp" /> {t("adoptionP4.forms.moveUp")}
                  <span className="visually-hidden"> {t("adoptionP4.forms.question", { n: i + 1 })}</span>
                </button>
                <button
                  type="button"
                  className="button button--link button--small"
                  disabled={i === questions.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="chevronDown" /> {t("adoptionP4.forms.moveDown")}
                  <span className="visually-hidden"> {t("adoptionP4.forms.question", { n: i + 1 })}</span>
                </button>
                <button
                  type="button"
                  className="button button--link button--small"
                  disabled={questions.length <= 1}
                  onClick={() => setQuestions((qs) => qs.filter((_, j) => j !== i))}
                >
                  <Icon name="cross" /> {t("adoptionP4.forms.removeQuestion")}
                  <span className="visually-hidden"> {t("adoptionP4.forms.question", { n: i + 1 })}</span>
                </button>
              </span>
            </fieldset>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="button button--secondary button--small"
        disabled={questions.length >= 20}
        onClick={() => setQuestions((qs) => [...qs, blankQuestion(qs.length + 1)])}
        data-add-question
      >
        <Icon name="plus" /> {t("adoptionP4.forms.addQuestion")}
      </button>
    </Dialog>
  );
}
