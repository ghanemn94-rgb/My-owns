// T09 Benefit Formula register (REQ-PB-056, REQ-PB-057, REQ-S08-007; ADR-0024 §6; T-DG3-FE-C). The register shows
// the six T09 columns (Benefit, Baseline driver, Change assumption, Formula, Ramp, Confidence H/M/L) with the current
// version and its Finance validation. The two B0087 source examples are marked "Illustrative calculation, synthetic
// values"; their live previews come from the shared engine (100000 SAR and 500000 SAR per year) and a team can
// instantiate them into its own register (a normal, unvalidated, illustrative row).
import {
  T09_CONFIDENCE,
  benefitFormulaCreate,
  type BenefitFormula,
  type BenefitFormulaExample,
} from "@mth/shared/schemas";
import { evaluateFormula } from "@mth/shared/calc";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { api, newIdempotencyKey } from "../../api/client.ts";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { useSessionBoundAction } from "../../auth/sessionBound.ts";
import { Unknown } from "../../components/Badges.tsx";
import { BLANK_CODE, Dialog, Field, isBlankText, issueCode, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus } from "../../components/P2Badges.tsx";
import { usePeople } from "../../components/People.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section, TextCell } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { FinanceStateChip } from "../business-cases/finance.tsx";
import { caseFieldMessage, FormAlert, splitProblem } from "../business-cases/formKit.tsx";
import { FORMULAS_URL, useBenefitFormulas, useFormulaExamples } from "./api.ts";
import { FormulaValue, typeLabel } from "./values.tsx";

export const FORMULA_WRITE_PERMISSIONS = ["benefit_formula.edit", "finance.validate"] as const;

export function BenefitFormulasPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="benefit-formulas"
      title={t("benefitFormulas.title")}
      subtitle={t("benefitFormulas.intro")}
      writePermissions={FORMULA_WRITE_PERMISSIONS}
    >
      <FormulaRegister />
      <Examples />
    </WorkspaceFrame>
  );
}

/** T09 confidence H / M / L, with an icon and text; missing is Unknown. */
export function ConfidenceChip({ value }: { value: string | null | undefined }) {
  const { t } = useTranslation();
  if (value !== "H" && value !== "M" && value !== "L") return <Unknown hint={t("benefitFormulas.confidence.none")} />;
  return (
    <span className="lifecycle-chip" data-confidence={value}>
      <Icon name={value === "H" ? "chevronUp" : value === "L" ? "chevronDown" : "dot"} />{" "}
      {t(`benefitFormulas.confidence.${value}`)}
    </span>
  );
}

/** "Illustrative calculation, synthetic values" (REQ-PB-057): text and icon, never colour alone. */
export function IllustrativeMarker() {
  const { t } = useTranslation();
  return (
    <span className="badge badge--provisional" data-illustrative="true">
      <Icon name="info" /> {t("benefitFormulas.illustrative")}
    </span>
  );
}

function FormulaRegister() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const [includeArchived, setIncludeArchived] = useState(false);
  const formulas = useBenefitFormulas(ws.tid, includeArchived);
  const [creating, setCreating] = useState(false);
  const canEdit = ws.can("benefit_formula.edit");

  const columns: RegisterColumn<BenefitFormula>[] = [
    {
      id: "code",
      header: t("benefitFormulas.field.code"),
      cell: (f) => (
        <Link className="link" to={`/transformations/${ws.tid}/benefit-formulas/${f.id}`}>
          <bdi dir="ltr" className="code">
            {f.code}
          </bdi>
          <span className="visually-hidden">: {f.benefitName}</span>
        </Link>
      ),
      sortValue: (f) => f.code,
      hideable: false,
      rowHeader: true,
    },
    {
      id: "benefit",
      header: t("benefitFormulas.field.benefitName"),
      cell: (f) => (
        <span>
          <span className="text-cell">{f.benefitName}</span> {f.isIllustrative ? <IllustrativeMarker /> : null}
        </span>
      ),
      sortValue: (f) => f.benefitName,
    },
    {
      id: "baselineDriver",
      header: t("benefitFormulas.field.baselineDriver"),
      cell: (f) => <TextCell value={f.baselineDriver} />,
      sortValue: (f) => f.baselineDriver,
    },
    {
      id: "changeAssumption",
      header: t("benefitFormulas.field.changeAssumption"),
      cell: (f) => <TextCell value={f.changeAssumption} />,
      sortValue: (f) => f.changeAssumption,
    },
    {
      id: "formula",
      header: t("benefitFormulas.field.formula"),
      cell: (f) =>
        f.currentVersion ? (
          <code dir="ltr" className="text-cell">
            {f.currentVersion.expression}
          </code>
        ) : (
          <span className="muted">{t("benefitFormulas.noFormulaYet")}</span>
        ),
      filterText: (f) => f.currentVersion?.expression,
    },
    {
      id: "ramp",
      header: t("benefitFormulas.field.ramp"),
      cell: (f) => <TextCell value={f.ramp} />,
      sortValue: (f) => f.ramp,
    },
    {
      id: "confidence",
      header: t("benefitFormulas.field.confidence"),
      cell: (f) => <ConfidenceChip value={f.confidence} />,
      sortValue: (f) => f.confidence,
    },
    {
      id: "version",
      header: t("benefitFormulas.field.currentVersion"),
      cell: (f) =>
        f.currentVersionNo ? (
          t("benefitFormulas.versionN", { n: f.currentVersionNo })
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
      sortValue: (f) => f.currentVersionNo,
    },
    {
      id: "preview",
      header: t("benefitFormulas.field.preview"),
      cell: (f) =>
        f.currentVersion ? (
          <FormulaValue
            value={f.currentVersion.previewResult}
            type={{
              kind: f.currentVersion.resultKind,
              currency: f.currentVersion.resultCurrency,
              period: f.currentVersion.resultPeriod,
              unit: f.currentVersion.resultUnit,
            }}
          />
        ) : (
          <Unknown />
        ),
    },
    {
      id: "validation",
      header: t("benefitFormulas.field.validation"),
      cell: (f) =>
        f.currentVersion ? (
          <FinanceStateChip state={f.currentVersion.validationStatus} />
        ) : (
          <span className="muted">{t("common.value.none")}</span>
        ),
      sortValue: (f) => f.currentVersion?.validationStatus,
    },
    {
      id: "status",
      header: t("common.field.status"),
      cell: (f) => <RecordStatus status={f.status} />,
      sortValue: (f) => f.status,
    },
  ];

  return (
    <Section
      id="t09"
      title={t("benefitFormulas.registerTitle")}
      intro={t("benefitFormulas.registerIntro")}
      actions={
        canEdit ? (
          <button type="button" className="button button--primary button--small" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t("benefitFormulas.create.action")}
          </button>
        ) : null
      }
    >
      <QueryState query={formulas}>
        {(list) => (
          <RegisterTable
            id="p3-t09"
            caption={t("benefitFormulas.registerTitle")}
            rows={list}
            columns={columns}
            getRowId={(f) => f.id}
            emptyTitle={t("benefitFormulas.empty")}
            emptyBody={t("benefitFormulas.emptyBody")}
            defaultSort={{ id: "code", dir: "asc" }}
            toolbar={
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(e) => setIncludeArchived(e.target.checked)}
                />
                {t("benefitFormulas.showArchived")}
              </label>
            }
          />
        )}
      </QueryState>
      {creating ? <CreateFormulaDialog onClose={() => setCreating(false)} /> : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ examples

function Examples() {
  const { t } = useTranslation();
  const examples = useFormulaExamples();
  return (
    <Section id="examples" title={t("benefitFormulas.examples.title")} intro={t("benefitFormulas.examples.intro")}>
      <QueryState query={examples}>
        {(list) => (
          <div className="grid grid--2">
            {list.map((ex) => (
              <ExampleCard key={ex.code} example={ex} />
            ))}
          </div>
        )}
      </QueryState>
    </Section>
  );
}

function ExampleCard({ example }: { example: BenefitFormulaExample }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const begin = useSessionBoundAction();
  const refresh = useP3Refresh(ws.tid);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  // The preview is computed by the shared engine from the example's own synthetic values (never typed in here).
  const preview = evaluateFormula(example.expression, example.variables);
  const ar = locale === "ar";
  const benefit = ar ? example.benefitAr : example.sourceBenefitEn;

  const instantiate = async () => {
    const action = begin();
    setBusy(true);
    setError(null);
    try {
      const created = await api.send<BenefitFormula>(FORMULAS_URL, {
        method: "POST",
        body: { transformationId: ws.tid, benefitName: benefit, fromExample: example.code },
        idempotencyKey: idempotencyKey.current,
      });
      if (action.stale()) return;
      if (!(await refresh())) return;
      action.navigate(`/transformations/${ws.tid}/benefit-formulas/${created.id}`);
    } catch (e) {
      if (action.stale(e)) return;
      setError(e);
      setBusy(false);
    }
  };

  return (
    <article className="card" data-example={example.code} aria-labelledby={`example-${example.code}`}>
      <h3 className="card__subtitle" id={`example-${example.code}`}>
        {benefit} <IllustrativeMarker />
      </h3>
      <dl className="details details--compact">
        <div>
          <dt>{t("benefitFormulas.field.benefitName")}</dt>
          <dd>{benefit}</dd>
        </div>
        <div>
          <dt>{t("benefitFormulas.field.baselineDriver")}</dt>
          <dd>{ar ? example.baselineDriverAr : example.sourceBaselineDriverEn}</dd>
        </div>
        <div>
          <dt>{t("benefitFormulas.field.changeAssumption")}</dt>
          <dd>{ar ? example.changeAssumptionAr : example.sourceChangeAssumptionEn}</dd>
        </div>
        <div>
          <dt>{t("benefitFormulas.field.formula")}</dt>
          <dd>{ar ? example.formulaAr : example.sourceFormulaEn}</dd>
        </div>
        <div>
          <dt>{t("benefitFormulas.field.ramp")}</dt>
          <dd>
            <bdi dir="ltr">{example.sourceRampEn}</bdi>
          </dd>
        </div>
        <div>
          <dt>{t("benefitFormulas.field.confidence")}</dt>
          <dd>
            <ConfidenceChip value={example.sourceConfidence} />
          </dd>
        </div>
      </dl>
      <p className="small">
        {t("benefitFormulas.builder.expression")}:{" "}
        <code dir="ltr" className="text-cell">
          {example.expression}
        </code>
      </p>
      <h4 className="small-heading">{t("benefitFormulas.examples.variablesCaption")}</h4>
      <ul className="plain-list small" data-example-variables>
        {example.variables.map((v) => (
          <li key={v.name}>
            <code dir="ltr">{v.name}</code> ({typeLabel(t, v)}): <FormulaValue value={v.value} type={v} />
          </li>
        ))}
      </ul>
      <p data-example-preview={preview.result ?? ""}>
        <strong>{t("benefitFormulas.examples.preview")}:</strong>{" "}
        <FormulaValue
          value={preview.result}
          type={
            preview.resultType ?? {
              kind: example.resultKind,
              currency: example.resultCurrency,
              period: example.resultPeriod,
            }
          }
        />
      </p>
      <p className="muted small">{t("benefitFormulas.examples.source", { ref: example.sourceRef })}</p>
      <FormAlert error={error} />
      {ws.can("benefit_formula.edit") ? (
        <button
          type="button"
          className="button button--secondary button--small"
          onClick={() => void instantiate()}
          disabled={busy}
        >
          <Icon name="plus" /> {busy ? t("common.state.saving") : t("benefitFormulas.examples.instantiate")}
          <span className="visually-hidden">: {benefit}</span>
        </button>
      ) : null}
    </article>
  );
}

// ------------------------------------------------------------------------------------------------ create

const CREATE_FIELDS = [
  "benefitName",
  "baselineDriver",
  "changeAssumption",
  "ramp",
  "confidence",
  "ownerUserId",
] as const;
type CreateField = (typeof CREATE_FIELDS)[number];
const FREE_TEXT: readonly CreateField[] = ["benefitName", "baselineDriver", "changeAssumption", "ramp"];

function CreateFormulaDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const begin = useSessionBoundAction();
  const refresh = useP3Refresh(ws.tid);
  const { people } = usePeople(ws.tid);
  const [values, setValues] = useState<Record<CreateField, string>>({
    benefitName: "",
    baselineDriver: "",
    changeAssumption: "",
    ramp: "",
    confidence: "",
    ownerUserId: ws.meId,
  });
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const focusInvalid = useFocusFirstInvalid(dialogRef);
  const idempotencyKey = useRef(newIdempotencyKey());
  const err = (name: string) => (codes[name] ? caseFieldMessage(t, codes[name]) : undefined);
  const set = (name: CreateField, v: string) => setValues((x) => ({ ...x, [name]: v }));

  const submit = async () => {
    setServerError(null);
    const next: Record<string, string> = {};
    const other: string[] = [];
    for (const f of FREE_TEXT) if (isBlankText(values[f])) next[f] = BLANK_CODE;
    const body: Record<string, unknown> = { transformationId: ws.tid };
    for (const f of CREATE_FIELDS) if (values[f] !== "") body[f] = values[f];
    const parsed = benefitFormulaCreate.safeParse(body);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? "");
        if ((CREATE_FIELDS as readonly string[]).includes(name)) next[name] ??= issueCode(issue);
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
      const created = await api.send<BenefitFormula>(FORMULAS_URL, {
        method: "POST",
        body,
        idempotencyKey: idempotencyKey.current,
      });
      if (action.stale()) return;
      if (!(await refresh())) return;
      action.navigate(`/transformations/${ws.tid}/benefit-formulas/${created.id}`);
    } catch (e) {
      if (action.stale(e)) return;
      const split = splitProblem(e, (p) => {
        const name = p.replace(/^\//, "");
        return (CREATE_FIELDS as readonly string[]).includes(name) ? name : null;
      });
      setCodes(split.fields);
      if (split.formLevel) setServerError(e);
      if (Object.keys(split.fields).length > 0) focusInvalid();
      setBusy(false);
    }
  };

  const text = (name: CreateField, max: number, required = false) => (
    <Field key={name} label={t(`benefitFormulas.field.${name}`)} error={err(name)} required={required}>
      {(control) => (
        <input
          {...control}
          type="text"
          maxLength={max}
          value={values[name]}
          onChange={(e) => set(name, e.target.value)}
        />
      )}
    </Field>
  );

  return (
    <Dialog
      title={t("benefitFormulas.create.title")}
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
      <p>{t("benefitFormulas.create.description")}</p>
      <FormAlert error={serverError} codes={formCodes} />
      <form
        className="form form--dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {text("benefitName", 300, true)}
        {text("baselineDriver", 1000)}
        {text("changeAssumption", 1000)}
        {text("ramp", 100)}
        <Field label={t("benefitFormulas.field.confidence")} error={err("confidence")}>
          {(control) => (
            <select {...control} value={values.confidence} onChange={(e) => set("confidence", e.target.value)}>
              <option value="">{t("benefitFormulas.confidence.none")}</option>
              {T09_CONFIDENCE.map((c) => (
                <option key={c} value={c}>
                  {t(`benefitFormulas.confidence.${c}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("benefitFormulas.field.ownerUserId")} error={err("ownerUserId")}>
          {(control) => (
            <select {...control} value={values.ownerUserId} onChange={(e) => set("ownerUserId", e.target.value)}>
              <option value="">{t("common.value.notAssigned")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}
