// The T09 formula builder (REQ-PB-056, REQ-S08-007; ADR-0024 §6). While the user types, the SHARED engine
// (`validateFormula` / `evaluateFormula` from @mth/shared/calc, the same code the API runs) parses, type-checks and
// previews the formula: the translated message and the error position show BEFORE saving, including an undefined
// variable and a period mismatch (monthly ARPU × annual population). Variables are typed (kind, unit, currency,
// period); fractions are entered as percent / percentage points and stored as fractions. Saving creates the next
// immutable version (If-Match = the T09 row's version); it starts "Not validated" until Finance validates it.
import {
  BENEFIT_FORMULA_KINDS,
  BENEFIT_FORMULA_PERIODS,
  benefitFormulaVersionCreate,
  type BenefitFormula,
  type FormulaVariableView,
} from "@mth/shared/schemas";
import { evaluateFormula, type FormulaKind, type FormulaPeriod, type FormulaProblem } from "@mth/shared/calc";
import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../../api/client.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Field, isBlankText, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { ConflictPanel } from "../../components/States.tsx";
import { FormAlert } from "../business-cases/formKit.tsx";
import { formulaUrl } from "./api.ts";
import { engineProblemText, engineVariable, entryUnit, FormulaValue, toEntry, typeLabel } from "./values.tsx";

export interface VariableRow {
  key: string;
  name: string;
  kind: FormulaKind;
  period: FormulaPeriod;
  unit: string;
  currency: string;
  entry: string;
  source: string;
}

let rowSeq = 0;
const newKey = () => `v${++rowSeq}`;

export function rowsOf(variables: readonly FormulaVariableView[]): VariableRow[] {
  return variables.map((v) => ({
    key: newKey(),
    name: v.name,
    kind: v.kind,
    period: v.period,
    unit: v.unit ?? "",
    currency: v.currency ?? "",
    entry: toEntry(v.kind, v.value),
    source: v.source ?? "",
  }));
}

const emptyRow = (name = "", currency = "SAR"): VariableRow => ({
  key: newKey(),
  name,
  kind: "number",
  period: "none",
  unit: "",
  currency,
  entry: "",
  source: "",
});

/** The live check of an expression with its rows: the shared engine, nothing sent to the server. */
export function useLiveCheck(expression: string, rows: readonly VariableRow[]) {
  return useMemo(() => {
    const variables = rows.map(engineVariable);
    return { variables, evaluation: evaluateFormula(expression, variables) };
  }, [expression, rows]);
}

/** The expression with the error position marked (code points, as the engine counts them). */
export function MarkedExpression({ expression, offset }: { expression: string; offset: number | undefined }) {
  const chars = [...expression];
  if (offset === undefined || chars.length === 0)
    return (
      <code dir="ltr" className="text-cell">
        {expression}
      </code>
    );
  const at = Math.min(offset, chars.length);
  return (
    <code dir="ltr" className="text-cell" data-error-offset={offset}>
      {chars.slice(0, at).join("")}
      <mark>{chars[at] ?? " "}</mark>
      {chars.slice(at + 1).join("")}
    </code>
  );
}

/** The live parse / type-check / preview panel (one polite status region). */
export function LivePreview({
  expression,
  rows,
  onDeclare,
}: {
  expression: string;
  rows: readonly VariableRow[];
  onDeclare?: (name: string) => void;
}) {
  const { t } = useTranslation();
  const { evaluation } = useLiveCheck(expression, rows);
  const problem: FormulaProblem | undefined = evaluation.errors[0];
  let body;
  if (expression.trim() === "") {
    body = <p className="muted">{t("benefitFormulas.builder.typeToCheck")}</p>;
  } else if (evaluation.resultType === null && problem) {
    body = (
      <>
        <p className="status-chip status-chip--off-track" data-check="invalid" data-error-code={problem.code}>
          <Icon name="cross" /> {t("benefitFormulas.builder.invalid")}
        </p>
        <p data-check-message>{engineProblemText(t, problem)}</p>
        <p className="small">
          <MarkedExpression expression={expression} offset={problem.offset} />
        </p>
        {problem.code === "formula.undefined_variable" && onDeclare && problem.params["name"] ? (
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => onDeclare(problem.params["name"]!)}
          >
            <Icon name="plus" /> {t("benefitFormulas.builder.declare", { name: problem.params["name"] })}
          </button>
        ) : null}
      </>
    );
  } else {
    const type = evaluation.resultType!;
    body = (
      <>
        <p className="status-chip status-chip--on-track" data-check="valid">
          <Icon name="check" /> {t("benefitFormulas.builder.valid")}
        </p>
        <dl className="details details--compact">
          <div>
            <dt>{t("benefitFormulas.builder.resultType")}</dt>
            <dd data-result-kind={type.kind}>{typeLabel(t, type)}</dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.builder.preview")}</dt>
            <dd data-preview>
              <FormulaValue
                value={evaluation.result}
                type={type}
                unknownHint={problem ? engineProblemText(t, problem) : t("benefitFormulas.builder.noValues")}
              />
            </dd>
          </div>
        </dl>
        {problem ? <p className="muted small">{engineProblemText(t, problem)}</p> : null}
        {evaluation.rounding.inexactIntermediate ? (
          <p className="muted small">{t("benefitFormulas.builder.inexact")}</p>
        ) : null}
      </>
    );
  }
  return (
    <div className="card" role="status" aria-live="polite" data-live-check>
      <h3 className="card__subtitle">{t("benefitFormulas.builder.liveTitle")}</h3>
      {body}
    </div>
  );
}

/** The editable typed-variable table. */
export function VariablesEditor({
  rows,
  onChange,
  invalidName,
}: {
  rows: readonly VariableRow[];
  onChange: (rows: VariableRow[]) => void;
  invalidName?: string | undefined;
}) {
  const { t } = useTranslation();
  const id = useId();
  const update = (key: string, patch: Partial<VariableRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <fieldset className="plain-fieldset form-section" data-variables>
      <legend className="card__subtitle">{t("benefitFormulas.variables.title")}</legend>
      <p className="muted small">{t("benefitFormulas.variables.hint")}</p>
      {rows.length === 0 ? <p className="muted">{t("benefitFormulas.variables.none")}</p> : null}
      {rows.map((r, i) => {
        const unit = entryUnit(r.kind);
        const p = `${id}-${r.key}`;
        const invalid = invalidName !== undefined && invalidName === r.name;
        return (
          <fieldset key={r.key} className="field field--group" data-variable={r.name || `#${i + 1}`}>
            <legend className="field__label">
              {t("benefitFormulas.variables.rowLegend", { n: i + 1, name: r.name || "…" })}
            </legend>
            <div className="grid grid--3">
              <div className={`field${invalid ? " field--invalid" : ""}`}>
                <label className="field__label" htmlFor={`${p}-name`}>
                  {t("benefitFormulas.variables.name")}
                </label>
                <input
                  id={`${p}-name`}
                  type="text"
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={48}
                  value={r.name}
                  aria-invalid={invalid ? true : undefined}
                  onChange={(e) => update(r.key, { name: e.target.value })}
                />
              </div>
              <div className="field">
                <label className="field__label" htmlFor={`${p}-kind`}>
                  {t("benefitFormulas.variables.kind")}
                </label>
                <select
                  id={`${p}-kind`}
                  value={r.kind}
                  onChange={(e) => update(r.key, { kind: e.target.value as FormulaKind })}
                >
                  {BENEFIT_FORMULA_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`benefitFormulas.kind.${k}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor={`${p}-period`}>
                  {t("benefitFormulas.variables.period")}
                </label>
                <select
                  id={`${p}-period`}
                  value={r.period}
                  onChange={(e) => update(r.key, { period: e.target.value as FormulaPeriod })}
                >
                  {BENEFIT_FORMULA_PERIODS.map((x) => (
                    <option key={x} value={x}>
                      {t(`benefitFormulas.period.${x}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field__label" htmlFor={`${p}-value`}>
                  {unit
                    ? t(`benefitFormulas.variables.valueIn.${unit}`)
                    : r.kind === "currency"
                      ? t("benefitFormulas.variables.valueCurrency", { currency: r.currency || "…" })
                      : t("benefitFormulas.variables.value")}
                </label>
                <input
                  id={`${p}-value`}
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  value={r.entry}
                  aria-describedby={`${p}-value-hint`}
                  onChange={(e) => update(r.key, { entry: e.target.value })}
                />
                <p id={`${p}-value-hint`} className="field__hint">
                  {unit
                    ? t(`benefitFormulas.variables.valueHint.${unit}`)
                    : t("benefitFormulas.variables.valueHint.plain")}
                </p>
              </div>
              {r.kind === "currency" ? (
                <div className="field">
                  <label className="field__label" htmlFor={`${p}-currency`}>
                    {t("benefitFormulas.variables.currency")}
                  </label>
                  <input
                    id={`${p}-currency`}
                    type="text"
                    dir="ltr"
                    maxLength={3}
                    autoComplete="off"
                    value={r.currency}
                    onChange={(e) => update(r.key, { currency: e.target.value.toUpperCase() })}
                  />
                </div>
              ) : (
                <div className="field">
                  <label className="field__label" htmlFor={`${p}-unit`}>
                    {t("benefitFormulas.variables.unit")}
                  </label>
                  <input
                    id={`${p}-unit`}
                    type="text"
                    maxLength={50}
                    value={r.unit}
                    onChange={(e) => update(r.key, { unit: e.target.value })}
                  />
                </div>
              )}
              <div className="field">
                <label className="field__label" htmlFor={`${p}-source`}>
                  {t("benefitFormulas.variables.source")}
                </label>
                <input
                  id={`${p}-source`}
                  type="text"
                  maxLength={500}
                  value={r.source}
                  onChange={(e) => update(r.key, { source: e.target.value })}
                />
              </div>
            </div>
            <button
              type="button"
              className="button button--link button--small"
              onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
            >
              <Icon name="cross" /> {t("benefitFormulas.variables.remove")}
              <span className="visually-hidden">: {r.name || i + 1}</span>
            </button>
          </fieldset>
        );
      })}
      <button
        type="button"
        className="button button--secondary button--small"
        onClick={() => onChange([...rows, emptyRow()])}
      >
        <Icon name="plus" /> {t("benefitFormulas.variables.add")}
      </button>
    </fieldset>
  );
}

/**
 * Create the next version of a T09 row. `onSaved` refreshes (resolves false when the session changed meanwhile).
 */
export function FormulaBuilder({
  formula,
  onSaved,
  onReload,
}: {
  formula: BenefitFormula;
  onSaved: () => Promise<boolean>;
  onReload: () => Promise<BenefitFormula | null>;
}) {
  const { t } = useTranslation();
  const current = formula.currentVersion;
  // If-Match is the T09 row's CURRENT version (the prop follows every refresh), so a saved version never leaves the
  // builder on a stale row version.
  const base = formula;
  const [expression, setExpression] = useState(current?.expression ?? "");
  const [rows, setRows] = useState<VariableRow[]>(() => rowsOf(current?.variables ?? []));
  const [changeNote, setChangeNote] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<{ latest: BenefitFormula | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusFirstInvalid(formRef);
  const { variables, evaluation } = useLiveCheck(expression, rows);
  const problem = evaluation.resultType === null ? evaluation.errors[0] : undefined;
  const invalidName = problem?.code === "formula.invalid_variable" ? problem.params["name"] : undefined;

  const send = async (on: BenefitFormula) => {
    setSaved(null);
    setServerError(null);
    const next: Record<string, string> = {};
    const other: string[] = [];
    if (isBlankText(changeNote)) next["changeNote"] = BLANK_CODE;
    if (expression.trim() === "") next["expression"] = "validation.required";
    else if (problem) next["expression"] = problem.code;
    const body = {
      expression,
      variables: variables.map((v) => ({ ...v, value: v.value })),
      ...(changeNote !== "" ? { changeNote } : {}),
    };
    if (Object.keys(next).length === 0) {
      const parsed = benefitFormulaVersionCreate.safeParse(body);
      if (!parsed.success) other.push("variables_invalid");
    }
    setCodes(next);
    setFormCodes(other);
    if (Object.keys(next).length > 0 || other.length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard(); // F-DG2-530: every effect below belongs to this session generation
    setBusy(true);
    try {
      const created = await api.send<{ versionNo: number }>(`${formulaUrl(on.id)}/versions`, {
        method: "POST",
        body,
        ifMatch: on.version,
      });
      if (action.stale()) return;
      if (!(await onSaved())) return;
      setChangeNote("");
      setSaved(created.versionNo);
    } catch (e) {
      if (action.stale(e)) return;
      if (e instanceof ApiError && e.isConflict) {
        const latest = await onReload().catch(() => null);
        if (action.stale()) return;
        setConflict({ latest });
        return;
      }
      if (e instanceof ApiError && e.fieldErrors.some((fe) => fe.pointer.startsWith("/expression"))) {
        setCodes({ expression: e.code ?? "validation.invalid" });
        focusInvalid();
      }
      setServerError(e);
    } finally {
      if (!action.stale()) setBusy(false);
    }
  };

  const expressionError =
    codes["expression"] === undefined
      ? undefined
      : problem && codes["expression"] === problem.code
        ? engineProblemText(t, problem)
        : t(`benefitFormulas.problems.${codes["expression"].replace(/\./g, "__")}`, {
            defaultValue: t("benefitFormulas.builder.invalid"),
          });

  return (
    <form
      ref={formRef}
      className="form"
      noValidate
      data-formula-builder
      onSubmit={(e) => {
        e.preventDefault();
        void send(base);
      }}
    >
      {conflict ? (
        <ConflictPanel
          yourVersion={base.version}
          currentVersion={conflict.latest?.version ?? null}
          rows={[]}
          busy={busy}
          {...(conflict.latest
            ? {
                onReapply: () => {
                  const latest = conflict.latest!;
                  setConflict(null);
                  void send(latest);
                },
              }
            : {})}
          onDiscard={() => {
            const latest = conflict.latest ?? base;
            setExpression(latest.currentVersion?.expression ?? "");
            setRows(rowsOf(latest.currentVersion?.variables ?? []));
            setConflict(null);
          }}
        />
      ) : null}
      <p className="muted small">{t("benefitFormulas.builder.grammarHint")}</p>
      <Field
        label={t("benefitFormulas.builder.expression")}
        hint={t("benefitFormulas.builder.expressionHint")}
        error={expressionError}
        required
      >
        {(control) => (
          <textarea
            {...control}
            dir="ltr"
            rows={3}
            spellCheck={false}
            autoComplete="off"
            maxLength={2000}
            value={expression}
            onChange={(e) => {
              setSaved(null);
              setExpression(e.target.value);
              if (codes["expression"]) setCodes(({ expression: _drop, ...rest }) => rest);
            }}
          />
        )}
      </Field>
      <LivePreview expression={expression} rows={rows} onDeclare={(name) => setRows((r) => [...r, emptyRow(name)])} />
      <VariablesEditor rows={rows} onChange={setRows} invalidName={invalidName} />
      <Field
        label={t("benefitFormulas.builder.changeNote")}
        error={codes["changeNote"] ? t("problems.validation__blank") : undefined}
      >
        {(control) => (
          <textarea
            {...control}
            rows={2}
            maxLength={2000}
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
          />
        )}
      </Field>
      <FormAlert error={serverError} codes={formCodes} />
      {saved !== null ? (
        <p className="banner banner--success" role="status" data-state="version-saved">
          <Icon name="check" /> {t("benefitFormulas.builder.saved", { n: saved })}
        </p>
      ) : null}
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={busy || conflict !== null}>
          {busy ? t("common.state.saving") : t("benefitFormulas.builder.save")}
        </button>
      </div>
    </form>
  );
}
