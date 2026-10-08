// One T09 Benefit Formula (REQ-PB-055, REQ-PB-056, REQ-S08-007; ADR-0024 §5-§6; T-DG3-FE-C):
//  - the six T09 columns, edited with If-Match (409 → the standard conflict panel);
//  - the formula builder (live parse / type-check / preview with the shared engine) that saves the next immutable
//    version; the formula itself only changes through a new version;
//  - every version with its Finance validation: a BUSINESS APPROVAL by FIN, never by the version's author, final once
//    recorded; a new version starts Not validated;
//  - preview calculations with their lineage (inputs, period, assumptions, engine version, rounding). Division by zero
//    or a missing input gives Unknown, never 0.
import {
  T09_CONFIDENCE,
  benefitCalculationCreate,
  benefitFormulaUpdate,
  type BenefitCalculation,
  type BenefitFormula,
  type BenefitFormulaVersion,
} from "@mth/shared/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { api } from "../../api/client.ts";
import { p3Keys, useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { BLANK_CODE, Field, isBlankText, issueCode, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus } from "../../components/P2Badges.tsx";
import { PersonName, usePeople } from "../../components/People.tsx";
import { ArchiveAction } from "../../components/RowActions.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { ConflictPanel, QueryState } from "../../components/States.tsx";
import { useVersionedSave } from "../../components/useVersionedSave.ts";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatBusinessDate, formatDateTime } from "../../lib/format.ts";
import { FinanceStateChip, FinanceValidationDialog } from "../business-cases/finance.tsx";
import { caseFieldMessage, FormAlert, ownProblemText, splitProblem } from "../business-cases/formKit.tsx";
import { formulaUrl, useBenefitFormula, useCalculations, useFormulaVersions, versionUrl } from "./api.ts";
import { ConfidenceChip, FORMULA_WRITE_PERMISSIONS, IllustrativeMarker } from "./BenefitFormulasPage.tsx";
import { FormulaBuilder, MarkedExpression } from "./FormulaBuilder.tsx";
import { entryUnit, FormulaValue, toEntry, toStored, typeLabel } from "./values.tsx";

export function BenefitFormulaPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="benefit-formulas"
      title={t("benefitFormulas.detailTitle")}
      writePermissions={FORMULA_WRITE_PERMISSIONS}
    >
      <FormulaDetail />
    </WorkspaceFrame>
  );
}

function FormulaDetail() {
  const { formulaId = "" } = useParams();
  const ws = useWorkspace();
  const formula = useBenefitFormula(ws.tid, formulaId);
  return <QueryState query={formula}>{(f) => <FormulaBody formula={f} />}</QueryState>;
}

function FormulaBody({ formula }: { formula: BenefitFormula }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const refresh = useP3Refresh(ws.tid);
  const active = formula.status === "active";
  const canEdit = ws.can("benefit_formula.edit") && active;
  const sections = [
    { id: "t09-row", title: t("benefitFormulas.rowTitle") },
    ...(canEdit ? [{ id: "builder", title: t("benefitFormulas.builder.title") }] : []),
    { id: "versions", title: t("benefitFormulas.versions.title") },
    { id: "calculations", title: t("benefitFormulas.calc.title") },
  ];
  return (
    <div data-benefit-formula={formula.code}>
      <SectionNav sections={sections} />
      <RowSection key={`${formula.id}-${formula.version}`} formula={formula} canEdit={canEdit} />
      {canEdit ? (
        <Section id="builder" title={t("benefitFormulas.builder.title")} intro={t("benefitFormulas.builder.intro")}>
          <FormulaBuilder
            key={formula.id}
            formula={formula}
            onSaved={refresh}
            onReload={async () => {
              const action = beginSessionGuard();
              await queryClient.invalidateQueries({ queryKey: p3Keys.benefitFormula(ws.tid, formula.id) });
              if (action.stale()) return null;
              return api.get<BenefitFormula>(formulaUrl(formula.id));
            }}
          />
        </Section>
      ) : null}
      <Versions formula={formula} />
      <Calculations formula={formula} canEdit={canEdit} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ T09 row

type RowValues = Record<
  "benefitName" | "baselineDriver" | "changeAssumption" | "ramp" | "confidence" | "ownerUserId",
  string
>;
const ROW_FIELDS = ["benefitName", "baselineDriver", "changeAssumption", "ramp", "confidence", "ownerUserId"] as const;
const ROW_TEXT = ["benefitName", "baselineDriver", "changeAssumption", "ramp"] as const;
const ROW_MAX: Record<(typeof ROW_TEXT)[number], number> = {
  benefitName: 300,
  baselineDriver: 1000,
  changeAssumption: 1000,
  ramp: 100,
};

const rowValues = (f: BenefitFormula): RowValues => ({
  benefitName: f.benefitName,
  baselineDriver: f.baselineDriver ?? "",
  changeAssumption: f.changeAssumption ?? "",
  ramp: f.ramp ?? "",
  confidence: f.confidence ?? "",
  ownerUserId: f.ownerUserId ?? "",
});
const rowDiff = (before: RowValues, now: RowValues) => {
  const body: Record<string, unknown> = {};
  for (const k of ROW_FIELDS) if (before[k] !== now[k]) body[k] = now[k] === "" && k !== "benefitName" ? null : now[k];
  return body;
};

function RowSection({ formula, canEdit }: { formula: BenefitFormula; canEdit: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(() => rowValues(formula));
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusFirstInvalid(formRef);
  const save = useVersionedSave<BenefitFormula, RowValues>({
    initial: formula,
    url: (r) => formulaUrl(r.id),
    toValues: rowValues,
    diff: rowDiff,
    onSaved: async () => {
      await refresh();
    },
  });
  const err = (name: string) => (codes[name] ? caseFieldMessage(t, codes[name]) : undefined);

  const submit = async () => {
    const before = rowValues(save.base);
    const body = rowDiff(before, values);
    const next: Record<string, string> = {};
    const other: string[] = [];
    for (const f of ROW_TEXT) if (values[f] !== before[f] && isBlankText(values[f])) next[f] = BLANK_CODE;
    if (Object.keys(body).length === 0 && Object.keys(next).length === 0) {
      setFormCodes(["validation.empty_update"]);
      return;
    }
    const parsed = benefitFormulaUpdate.safeParse(body);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0] ?? "");
        if ((ROW_FIELDS as readonly string[]).includes(name)) next[name] ??= issueCode(issue);
        else other.push(issueCode(issue));
      }
    setCodes(next);
    setFormCodes(other);
    if (Object.keys(next).length > 0 || other.length > 0) {
      focusInvalid();
      return;
    }
    const result = await save.save(values);
    if (result.outcome === "saved") setEditing(false);
    if (result.outcome === "error") {
      const split = splitProblem(result.error, (p) => {
        const name = p.replace(/^\//, "");
        return (ROW_FIELDS as readonly string[]).includes(name) ? name : null;
      });
      setCodes(split.fields);
      if (Object.keys(split.fields).length > 0) focusInvalid();
    }
  };

  const version = formula.currentVersion;
  return (
    <Section
      id="t09-row"
      title={t("benefitFormulas.rowTitle")}
      intro={t("benefitFormulas.rowIntro")}
      actions={
        canEdit && !editing ? (
          <span className="row-actions">
            <button
              type="button"
              className="button button--secondary button--small"
              onClick={() => {
                setValues(rowValues(save.base));
                setEditing(true);
              }}
            >
              <Icon name="pencil" /> {t("common.action.edit")}
            </button>
            <ArchiveAction
              url={formulaUrl(formula.id)}
              version={formula.version}
              name={formula.code}
              onDone={refresh}
            />
          </span>
        ) : null
      }
    >
      <p className="chip-row">
        <bdi dir="ltr" className="code">
          {formula.code}
        </bdi>
        <RecordStatus status={formula.status} />
        {formula.isIllustrative ? <IllustrativeMarker /> : null}
      </p>
      {save.conflict ? (
        <ConflictPanel
          yourVersion={save.base.version}
          currentVersion={save.conflict.currentVersion}
          rows={(() => {
            const latest = save.conflict.latest;
            if (!latest) return [];
            const lv = rowValues(latest);
            return ROW_FIELDS.filter((k) => lv[k] !== values[k]).map((k) => ({
              field: k,
              label: t(`benefitFormulas.field.${k}`),
              mine: values[k] || t("common.value.none"),
              current: lv[k] || t("common.value.none"),
            }));
          })()}
          busy={save.busy}
          {...(save.conflict.latest
            ? {
                onReapply: () =>
                  void save.reapply(values).then((r) => {
                    if (r.outcome === "saved") setEditing(false);
                  }),
              }
            : {})}
          onDiscard={() => setValues(save.discard())}
        />
      ) : null}
      {editing ? (
        <form
          ref={formRef}
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {ROW_TEXT.map((f) => (
            <Field key={f} label={t(`benefitFormulas.field.${f}`)} error={err(f)} required={f === "benefitName"}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  maxLength={ROW_MAX[f]}
                  value={values[f]}
                  onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          <Field label={t("benefitFormulas.field.confidence")} error={err("confidence")}>
            {(control) => (
              <select
                {...control}
                value={values.confidence}
                onChange={(e) => setValues((v) => ({ ...v, confidence: e.target.value }))}
              >
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
              <select
                {...control}
                value={values.ownerUserId}
                onChange={(e) => setValues((v) => ({ ...v, ownerUserId: e.target.value }))}
              >
                <option value="">{t("common.value.notAssigned")}</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <FormAlert error={save.error} codes={formCodes} />
          <div className="form__actions">
            <button type="submit" className="button button--primary" disabled={save.busy || save.conflict !== null}>
              {save.busy ? t("common.state.saving") : t("common.action.save")}
            </button>
            <button
              type="button"
              className="button button--secondary"
              onClick={() => setEditing(false)}
              disabled={save.busy}
            >
              {t("common.action.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <dl className="details">
          <div>
            <dt>{t("benefitFormulas.field.benefitName")}</dt>
            <dd>{formula.benefitName}</dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.field.baselineDriver")}</dt>
            <dd>
              <TextCell value={formula.baselineDriver} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.field.changeAssumption")}</dt>
            <dd>
              <TextCell value={formula.changeAssumption} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.field.formula")}</dt>
            <dd>
              {version ? (
                <code dir="ltr" className="text-cell">
                  {version.expression}
                </code>
              ) : (
                <span className="muted">{t("benefitFormulas.noFormulaYet")}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.field.ramp")}</dt>
            <dd>
              <TextCell value={formula.ramp} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.field.confidence")}</dt>
            <dd>
              <ConfidenceChip value={formula.confidence} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.field.ownerUserId")}</dt>
            <dd>
              <PersonName id={formula.ownerUserId} people={byId} />
            </dd>
          </div>
          <div>
            <dt>{t("benefitFormulas.field.preview")}</dt>
            <dd>
              {version ? (
                <FormulaValue
                  value={version.previewResult}
                  type={{
                    kind: version.resultKind,
                    currency: version.resultCurrency,
                    period: version.resultPeriod,
                    unit: version.resultUnit,
                  }}
                />
              ) : (
                <span className="muted">{t("benefitFormulas.noFormulaYet")}</span>
              )}
            </dd>
          </div>
        </dl>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ versions

function Versions({ formula }: { formula: BenefitFormula }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const versions = useFormulaVersions(ws.tid, formula.id);
  const { byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [validating, setValidating] = useState<BenefitFormulaVersion | null>(null);
  const mayValidate = ws.can("finance.validate") && formula.status === "active";
  return (
    <Section id="versions" title={t("benefitFormulas.versions.title")} intro={t("benefitFormulas.versions.intro")}>
      <QueryState
        query={versions}
        isEmpty={(list) => list.length === 0}
        empty={<p className="muted">{t("benefitFormulas.versions.empty")}</p>}
      >
        {(list) => (
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">{t("benefitFormulas.versions.title")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("benefitFormulas.versions.no")}</th>
                  <th scope="col">{t("benefitFormulas.field.formula")}</th>
                  <th scope="col">{t("benefitFormulas.builder.resultType")}</th>
                  <th scope="col">{t("benefitFormulas.field.preview")}</th>
                  <th scope="col">{t("benefitFormulas.versions.created")}</th>
                  <th scope="col">{t("benefitFormulas.field.validation")}</th>
                  <th scope="col">{t("common.field.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const isAuthor = v.createdBy === ws.meId;
                  return (
                    <tr key={v.id} data-version={v.versionNo}>
                      <th scope="row">
                        {t("benefitFormulas.versionN", { n: v.versionNo })}
                        {v.versionNo === formula.currentVersionNo ? (
                          <span className="lifecycle-chip small" data-current="true">
                            <Icon name="dot" /> {t("benefitFormulas.versions.current")}
                          </span>
                        ) : null}
                      </th>
                      <td>
                        <MarkedExpression expression={v.expression} offset={undefined} />
                        {v.changeNote ? <span className="block small muted">{v.changeNote}</span> : null}
                      </td>
                      <td>
                        {typeLabel(t, {
                          kind: v.resultKind,
                          currency: v.resultCurrency,
                          period: v.resultPeriod,
                          unit: v.resultUnit,
                        })}
                      </td>
                      <td>
                        <FormulaValue
                          value={v.previewResult}
                          type={{
                            kind: v.resultKind,
                            currency: v.resultCurrency,
                            period: v.resultPeriod,
                            unit: v.resultUnit,
                          }}
                          unknownHint={t("benefitFormulas.versions.previewUnknown")}
                        />
                      </td>
                      <td>
                        {formatDateTime(v.createdAt, locale, ws.tr.timezone)}
                        <span className="block small">
                          <PersonName id={v.createdBy} people={byId} />
                        </span>
                      </td>
                      <td data-validation={v.validationStatus}>
                        <FinanceStateChip state={v.validationStatus} />
                        {v.validatedAt ? (
                          <span className="block small">
                            {formatDateTime(v.validatedAt, locale, ws.tr.timezone)} ·{" "}
                            <PersonName id={v.validatedBy} people={byId} />
                            {v.validationNote ? <span className="block">{v.validationNote}</span> : null}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {mayValidate && v.validationStatus === "unvalidated" && !isAuthor ? (
                          <button
                            type="button"
                            className="button button--link button--small"
                            onClick={() => setValidating(v)}
                          >
                            <Icon name="check" /> {t("benefitFormulas.versions.validate")}
                            <span className="visually-hidden">
                              : {t("benefitFormulas.versionN", { n: v.versionNo })}
                            </span>
                          </button>
                        ) : mayValidate && v.validationStatus === "unvalidated" && isAuthor ? (
                          <span className="muted small" data-state="validator-is-author">
                            <Icon name="lock" /> {t("benefitFormulas.versions.authorCannot")}
                          </span>
                        ) : (
                          <span className="muted small">{t("common.readOnly")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      {validating ? (
        <FinanceValidationDialog
          title={t("benefitFormulas.versions.dialogTitle", { code: formula.code, n: validating.versionNo })}
          description={t("benefitFormulas.versions.dialogBody")}
          url={`${versionUrl(formula.id, validating.versionNo)}/validation`}
          version={validating.version}
          onDone={refresh}
          onClose={() => setValidating(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ calculations

/** The lineage `source` the API writes for a calculation input (kpi/calculations.ts OVERRIDE_SOURCE), translated. */
const OVERRIDE_SOURCE = "Calculation input (overrides the version value)";

function Calculations({ formula, canEdit }: { formula: BenefitFormula; canEdit: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const versions = useFormulaVersions(ws.tid, formula.id);
  // Follows the current version (a new version becomes current) until the reader picks another one.
  const [selected, setSelected] = useState<number | null>(null);
  const versionNo = selected ?? formula.currentVersionNo;
  const calculations = useCalculations(ws.tid, formula.id, versionNo);
  const { byId } = usePeople(ws.tid);
  const version = versions.data?.find((v) => v.versionNo === versionNo) ?? null;
  return (
    <Section id="calculations" title={t("benefitFormulas.calc.title")} intro={t("benefitFormulas.calc.intro")}>
      {versionNo === null ? (
        <p className="muted">{t("benefitFormulas.versions.empty")}</p>
      ) : (
        <>
          {(versions.data?.length ?? 0) > 1 ? (
            // A view control (which version's lineage to read), not a write control: it stays for the auditor.
            <div data-view-control>
              <Field label={t("benefitFormulas.calc.version")}>
                {(control) => (
                  <select {...control} value={versionNo} onChange={(e) => setSelected(Number(e.target.value))}>
                    {versions.data!.map((v) => (
                      <option key={v.versionNo} value={v.versionNo}>
                        {t("benefitFormulas.versionN", { n: v.versionNo })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          ) : null}
          {canEdit && version ? <RunCalculation key={version.id} formula={formula} version={version} /> : null}
          <QueryState
            query={calculations}
            isEmpty={(list) => list.length === 0}
            empty={<p className="muted">{t("benefitFormulas.calc.empty")}</p>}
          >
            {(list) => (
              <div className="table-wrap">
                <table className="table">
                  <caption>{t("benefitFormulas.calc.lineage", { n: versionNo })}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("benefitFormulas.calc.computedAt")}</th>
                      <th scope="col">{t("benefitFormulas.calc.result")}</th>
                      <th scope="col">{t("benefitFormulas.calc.inputs")}</th>
                      <th scope="col">{t("benefitFormulas.calc.period")}</th>
                      <th scope="col">{t("benefitFormulas.calc.assumptions")}</th>
                      <th scope="col">{t("benefitFormulas.calc.engine")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c: BenefitCalculation) => (
                      <tr key={c.id} data-calculation={c.outcome}>
                        <th scope="row">
                          {formatDateTime(c.computedAt, locale, ws.tr.timezone)}
                          <span className="block small">
                            <PersonName id={c.computedBy} people={byId} />
                          </span>
                        </th>
                        <td>
                          <FormulaValue
                            value={c.result}
                            type={{
                              kind: c.resultKind,
                              currency: c.resultCurrency,
                              period: c.resultPeriod,
                              unit: c.resultUnit,
                            }}
                            unknownHint={
                              c.errorCode ? ownProblemText(t, c.errorCode) : t("benefitFormulas.calc.unknown")
                            }
                          />
                          {c.errorCode ? (
                            <span className="block small" data-error-code={c.errorCode}>
                              {ownProblemText(t, c.errorCode) || t("benefitFormulas.calc.unknown")}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <ul className="plain-list small">
                            {Object.entries(c.inputs).map(([name, v]) => (
                              <li key={name}>
                                <code dir="ltr">{name}</code> = <FormulaValue value={v.value} type={v} />
                                {v.source ? (
                                  <span className="muted">
                                    {" "}
                                    ({v.source === OVERRIDE_SOURCE ? t("benefitFormulas.calc.inputOverride") : v.source}
                                    )
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </td>
                        <td>
                          {c.periodStart || c.periodEnd ? (
                            `${formatBusinessDate(c.periodStart, locale) ?? t("common.value.unknown")} – ${formatBusinessDate(c.periodEnd, locale) ?? t("common.value.unknown")}`
                          ) : (
                            <span className="muted">{t("common.value.none")}</span>
                          )}
                        </td>
                        <td>
                          <TextCell value={c.assumptions} />
                        </td>
                        <td className="small">
                          <bdi dir="ltr" className="code">
                            {c.engineVersion}
                          </bdi>
                          {c.rounded ? <span className="block">{t("benefitFormulas.calc.rounded")}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </>
      )}
    </Section>
  );
}

function RunCalculation({ formula, version }: { formula: BenefitFormula; version: BenefitFormulaVersion }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const refresh = useP3Refresh(ws.tid);
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(version.variables.map((v) => [v.name, toEntry(v.kind, v.value)])),
  );
  const [assumptions, setAssumptions] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusFirstInvalid(formRef);
  const err = (name: string) => (codes[name] ? caseFieldMessage(t, codes[name]) : undefined);

  const submit = async () => {
    setDone(false);
    setServerError(null);
    const next: Record<string, string> = {};
    const values: Record<string, string> = {};
    for (const v of version.variables) {
      const stored = toStored(v.kind, inputs[v.name] ?? "");
      if (stored !== null) values[v.name] = stored;
    }
    if (isBlankText(assumptions)) next["assumptions"] = BLANK_CODE;
    const body = {
      inputs: values,
      ...(assumptions !== "" ? { assumptions } : {}),
      ...(periodStart ? { periodStart } : {}),
      ...(periodEnd ? { periodEnd } : {}),
    };
    const parsed = benefitCalculationCreate.safeParse(body);
    const other: string[] = [];
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const [first, second] = issue.path.map(String);
        if (first === "inputs" && second) next[`input:${second}`] = issueCode(issue);
        else if (first) next[first] ??= issueCode(issue);
        else other.push(issueCode(issue));
      }
    setCodes(next);
    setFormCodes(other);
    if (Object.keys(next).length > 0 || other.length > 0) {
      focusInvalid();
      return;
    }
    const action = beginSessionGuard();
    setBusy(true);
    try {
      await api.send(`${versionUrl(formula.id, version.versionNo)}/calculations`, { method: "POST", body });
      if (action.stale()) return;
      if (!(await refresh())) return;
      setDone(true);
    } catch (e) {
      if (action.stale(e)) return;
      setServerError(e);
    } finally {
      if (!action.stale()) setBusy(false);
    }
  };

  return (
    <form
      ref={formRef}
      className="form form--inset"
      noValidate
      data-run-calculation
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h3 className="card__subtitle">{t("benefitFormulas.calc.runTitle", { n: version.versionNo })}</h3>
      <p className="muted small">{t("benefitFormulas.calc.runIntro")}</p>
      <div className="grid grid--3">
        {version.variables.map((v) => {
          const unit = entryUnit(v.kind);
          return (
            <Field
              key={v.name}
              label={`${v.name} · ${unit ? t(`benefitFormulas.variables.valueIn.${unit}`) : typeLabel(t, v)}`}
              hint={
                unit ? t(`benefitFormulas.variables.valueHint.${unit}`) : t("benefitFormulas.variables.valueHint.plain")
              }
              error={err(`input:${v.name}`)}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  autoComplete="off"
                  value={inputs[v.name] ?? ""}
                  onChange={(e) => setInputs((x) => ({ ...x, [v.name]: e.target.value }))}
                />
              )}
            </Field>
          );
        })}
      </div>
      <div className="grid grid--2">
        <Field label={t("benefitFormulas.calc.periodStart")} error={err("periodStart")}>
          {(control) => (
            <input {...control} type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          )}
        </Field>
        <Field label={t("benefitFormulas.calc.periodEnd")} error={err("periodEnd")}>
          {(control) => (
            <input {...control} type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label={t("benefitFormulas.calc.assumptions")} error={err("assumptions")}>
        {(control) => (
          <textarea
            {...control}
            rows={2}
            maxLength={4000}
            value={assumptions}
            onChange={(e) => setAssumptions(e.target.value)}
          />
        )}
      </Field>
      <FormAlert error={serverError} codes={formCodes} />
      {done ? (
        <p className="banner banner--success" role="status" data-state="calculation-recorded">
          <Icon name="check" /> {t("benefitFormulas.calc.recorded")}
        </p>
      ) : null}
      <div className="form__actions">
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? t("common.state.saving") : t("benefitFormulas.calc.run")}
        </button>
      </div>
    </form>
  );
}
