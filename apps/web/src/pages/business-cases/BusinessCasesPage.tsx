// Business cases of a transformation (REQ-PB-053, REQ-PB-054; ADR-0024 §1-§5; T-DG3-FE-C). One transformation case
// holds all ten B0085 sections; lighter initiative cases link to it, and the transformation case rolls their lines up
// by reference (each distinct line counted once). Finance validation of each baseline is a business approval shown
// as Validated, Rejected, Stale or Not validated, never green when stale. A saved case is a draft, never "approved".
import { businessCaseCreate, type BusinessCase, type BusinessCaseLevel } from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api, newIdempotencyKey } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Dialog, Field, isBlankText, issueCode, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus } from "../../components/P2Badges.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { CASES_URL, useBusinessCases, useInitiativeOptions } from "./api.ts";
import { FinanceStateChip } from "./finance.tsx";
import { caseFieldMessage, FormAlert, splitProblem } from "./formKit.tsx";

/** Permissions that make the business-case screens editable (the server re-checks each request). */
export const CASE_WRITE_PERMISSIONS = ["business_case.edit", "finance.validate"] as const;

export function BusinessCasesPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="business-cases"
      title={t("businessCases.title")}
      subtitle={t("businessCases.intro")}
      writePermissions={CASE_WRITE_PERMISSIONS}
    >
      <CaseRegister />
    </WorkspaceFrame>
  );
}

/** "Complete" or "N sections missing", always with text and an icon. */
export function CompletenessChip({ missing }: { missing: readonly string[] }) {
  const { t } = useTranslation();
  return missing.length === 0 ? (
    <span className="status-chip status-chip--on-track" data-sections="complete">
      <Icon name="check" /> {t("businessCases.sections.complete")}
    </span>
  ) : (
    <span className="status-chip status-chip--at-risk" data-sections={`missing-${missing.length}`}>
      <Icon name="alert" /> {t("businessCases.sections.missingCount", { count: missing.length })}
    </span>
  );
}

function CaseRegister() {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const [includeArchived, setIncludeArchived] = useState(false);
  const cases = useBusinessCases(ws.tid, includeArchived);
  const initiatives = useInitiativeOptions(ws.tid);
  const [creating, setCreating] = useState(false);
  const canEdit = ws.can("business_case.edit");
  const initiativeName = (id: string | null) => {
    const ini = initiatives.data?.find((i) => i.id === id);
    return ini ? `${ini.code} ${ini.name}` : null;
  };
  const codeOf = (list: readonly BusinessCase[], id: string | null) => list.find((c) => c.id === id)?.code ?? null;

  const columns = (list: readonly BusinessCase[]): RegisterColumn<BusinessCase>[] => [
    {
      id: "code",
      header: t("businessCases.field.code"),
      cell: (c) => (
        <Link className="link" to={`/transformations/${ws.tid}/business-cases/${c.id}`}>
          <bdi dir="ltr" className="code">
            {c.code}
          </bdi>
          <span className="visually-hidden">: {c.title}</span>
        </Link>
      ),
      sortValue: (c) => c.code,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "title",
      header: t("businessCases.field.title"),
      cell: (c) => <span className="text-cell">{c.title}</span>,
      sortValue: (c) => c.title,
    },
    {
      id: "level",
      header: t("businessCases.field.level"),
      cell: (c) => (
        <span className="lifecycle-chip" data-level={c.level}>
          <Icon name={c.level === "transformation" ? "columns" : "dot"} /> {t(`businessCases.level.${c.level}`)}
        </span>
      ),
      sortValue: (c) => t(`businessCases.level.${c.level}`),
    },
    {
      id: "initiative",
      header: t("businessCases.field.initiative"),
      cell: (c) =>
        c.level === "initiative" ? (
          (initiativeName(c.initiativeId) ?? <span className="muted">{t("businessCases.initiativeNotVisible")}</span>)
        ) : (
          <span className="muted">{t("businessCases.notApplicable")}</span>
        ),
      sortValue: (c) => initiativeName(c.initiativeId),
    },
    {
      id: "parent",
      header: t("businessCases.field.parent"),
      cell: (c) =>
        c.parentCaseId ? (
          <bdi dir="ltr" className="code">
            {codeOf(list, c.parentCaseId) ?? c.parentCaseId.slice(-4)}
          </bdi>
        ) : (
          <span className="muted">{t("businessCases.notApplicable")}</span>
        ),
    },
    {
      id: "baseline",
      header: t("businessCases.finance.baselineColumn"),
      cell: (c) => <FinanceStateChip state={c.baselineValidation} />,
      sortValue: (c) => c.baselineValidation,
    },
    {
      id: "sections",
      header: t("businessCases.sections.column"),
      cell: (c) => <CompletenessChip missing={c.missingSections} />,
      sortValue: (c) => c.missingSections.length,
    },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (c) => <RecordStatus status={c.status} />,
      sortValue: (c) => c.status,
    },
    {
      id: "updated",
      header: t("businessCases.field.updatedAt"),
      cell: (c) => formatDateTime(c.updatedAt, locale, ws.tr.timezone),
      sortValue: (c) => c.updatedAt,
    },
  ];

  return (
    <Section
      id="business-cases"
      title={t("businessCases.registerTitle")}
      intro={t("businessCases.registerIntro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--primary button--small" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("businessCases.create.action")}
          </button>
        ) : null
      }
    >
      <QueryState query={cases}>
        {(list) => (
          <RegisterTable
            id="p3-business-cases"
            caption={t("businessCases.registerTitle")}
            rows={list}
            columns={columns(list)}
            getRowId={(c) => c.id}
            emptyTitle={t("businessCases.empty")}
            emptyBody={t("businessCases.emptyBody")}
            defaultSort={{ id: "code", dir: "asc" }}
            toolbar={
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                />
                {t("businessCases.showArchived")}
              </label>
            }
          />
        )}
      </QueryState>
      {creating ? (
        <CreateCaseDialog
          cases={cases.data ?? []}
          initiatives={(initiatives.data ?? []).map((i) => ({ id: i.id, label: `${i.code} ${i.name}` }))}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </Section>
  );
}

const CREATE_FIELDS: Record<string, string> = {
  "/level": "level",
  "/initiativeId": "initiativeId",
  "/title": "title",
  "/currency": "currency",
};

function CreateCaseDialog({
  cases,
  initiatives,
  onClose,
}: {
  cases: readonly BusinessCase[];
  initiatives: readonly { id: string; label: string }[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const begin = useSessionBoundAction();
  const refresh = useP3Refresh(ws.tid);
  const active = cases.filter((c) => c.status !== "archived");
  const hasTransformationCase = active.some((c) => c.level === "transformation");
  const withCase = new Set(active.map((c) => c.initiativeId).filter(Boolean));
  const [level, setLevel] = useState<BusinessCaseLevel>(hasTransformationCase ? "initiative" : "transformation");
  const [initiativeId, setInitiativeId] = useState("");
  const [title, setTitle] = useState("");
  const [currency, setCurrency] = useState(ws.tr.currency);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  /** Stable for this dialog, so a retried create can never create the case twice. */
  const idempotencyKey = useRef(newIdempotencyKey());
  const err = (name: string) => (codes[name] ? caseFieldMessage(t, codes[name]) : undefined);

  const submit = async () => {
    setServerError(null);
    const body: Record<string, unknown> = { transformationId: ws.tid, level, title, currency };
    if (level === "initiative" && initiativeId) body["initiativeId"] = initiativeId;
    const next: Record<string, string> = {};
    const other: string[] = [];
    if (isBlankText(title)) next["title"] = BLANK_CODE;
    if (level === "initiative" && !initiativeId) next["initiativeId"] = "validation.required";
    const parsed = businessCaseCreate.safeParse(body);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? "");
        if (["title", "currency", "level", "initiativeId"].includes(name)) next[name] ??= issueCode(issue);
        else other.push(issueCode(issue));
      }
    setCodes(next);
    setFormCodes(other);
    if (Object.keys(next).length > 0 || other.length > 0) {
      focusInvalid();
      return;
    }
    const action = begin();
    setBusy(true);
    try {
      const created = await api.send<BusinessCase>(CASES_URL, {
        method: "POST",
        body: parsed.data,
        idempotencyKey: idempotencyKey.current,
      });
      if (action.stale()) return;
      if (!(await refresh())) return;
      action.navigate(`/transformations/${ws.tid}/business-cases/${created.id}`);
    } catch (e) {
      if (action.stale(e)) return;
      const split = splitProblem(e, (p) => CREATE_FIELDS[p] ?? null);
      setCodes(split.fields);
      if (split.formLevel) setServerError(e);
      if (Object.keys(split.fields).length > 0) focusInvalid();
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("businessCases.create.title")}
      onClose={onClose}
      dialogRef={dialogRef}
      footer={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            {t("common.action.cancel")}
          </button>
          <button type="button" className="button button--primary" onClick={() => void submit()} disabled={busy}>
            {busy ? t("common.state.saving") : t("common.action.create")}
          </button>
        </>
      }
    >
      <p>{t("businessCases.create.description")}</p>
      <FormAlert error={serverError} codes={formCodes} />
      <form
        className="form form--dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className={`field field--group${err("level") ? " field--invalid" : ""}`}>
          <legend className="field__label">
            {t("businessCases.field.level")} <span className="field__required">({t("common.form.required")})</span>
          </legend>
          {(["transformation", "initiative"] as const).map((l) => (
            <label key={l} className="checkbox">
              <input
                type="radio"
                name="case-level"
                value={l}
                checked={level === l}
                disabled={l === "transformation" && hasTransformationCase}
                onChange={() => setLevel(l)}
              />
              {t(`businessCases.level.${l}`)}
            </label>
          ))}
          <p className="field__hint">
            {hasTransformationCase ? t("businessCases.create.levelHintExists") : t("businessCases.create.levelHint")}
          </p>
          {err("level") ? (
            <p className="field__error">
              <Icon name="alert" /> {err("level")}
            </p>
          ) : null}
        </fieldset>
        {level === "initiative" ? (
          <Field
            label={t("businessCases.field.initiative")}
            hint={t("businessCases.create.initiativeHint")}
            error={err("initiativeId")}
            required
          >
            {(control) => (
              <select {...control} value={initiativeId} onChange={(e) => setInitiativeId(e.target.value)}>
                <option value="">{t("common.form.choose")}</option>
                {initiatives
                  .filter((i) => !withCase.has(i.id))
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        ) : null}
        <Field label={t("businessCases.field.title")} error={err("title")} required>
          {(control) => (
            <input {...control} type="text" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
        </Field>
        <Field
          label={t("businessCases.field.currency")}
          hint={t("businessCases.field.currencyHint")}
          error={err("currency")}
          required
        >
          {(control) => (
            <input
              {...control}
              type="text"
              dir="ltr"
              maxLength={3}
              autoComplete="off"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
