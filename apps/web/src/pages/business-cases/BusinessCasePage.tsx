// One business case (REQ-PB-053/054/055, REQ-S05-005; ADR-0024 §1-§5, §9; T-DG3-FE-C):
//  - the ten B0085 sections, edited with If-Match (409 → the standard conflict panel); an initiative case is lighter
//    (sections 1, 4, 5, 6, 7 and 9 are required for it) and links to the transformation case;
//  - Finance validation of the baseline: a BUSINESS APPROVAL by FIN, never the case author, shown as Validated,
//    Rejected, Stale (the baseline changed after validation: never green) or Not validated;
//  - totals (gross benefits, implementation cost and net value apart) and the investment and benefit lines.
// A saved case is a "Draft – not submitted": nothing on this screen approves, funds or submits it.
import {
  BUSINESS_CASE_SECTION_CODES,
  DECISION_ASK_TYPES,
  INITIATIVE_CASE_SECTION_CODES,
  businessCaseUpdate,
  type BusinessCase,
  type BusinessCaseSectionCode,
} from "@mth/shared/schemas";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { useP3Refresh } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { BLANK_CODE, Field, isBlankText, issueCode, useFocusFirstInvalid } from "../../components/Form.tsx";
import { Icon } from "../../components/Icon.tsx";
import { RecordStatus } from "../../components/P2Badges.tsx";
import { PersonName, usePeople, type Person } from "../../components/People.tsx";
import { Section, SectionNav, TextCell } from "../../components/Section.tsx";
import { ConflictPanel, QueryState } from "../../components/States.tsx";
import { useVersionedSave } from "../../components/useVersionedSave.ts";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime } from "../../lib/format.ts";
import { caseUrl, useBusinessCase, useBusinessCases, useInitiativeOptions } from "./api.ts";
import { CASE_WRITE_PERMISSIONS, CompletenessChip } from "./BusinessCasesPage.tsx";
import { CaseLines } from "./CaseLines.tsx";
import { CaseTotals } from "./CaseTotals.tsx";
import { FinanceStateChip, FinanceValidationDialog } from "./finance.tsx";
import { caseFieldMessage, FormAlert, splitProblem } from "./formKit.tsx";

export function BusinessCasePage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="business-cases"
      title={t("businessCases.detailTitle")}
      writePermissions={CASE_WRITE_PERMISSIONS}
    >
      <CaseDetail />
    </WorkspaceFrame>
  );
}

function CaseDetail() {
  const { businessCaseId = "" } = useParams();
  const ws = useWorkspace();
  const bc = useBusinessCase(ws.tid, businessCaseId);
  return <QueryState query={bc}>{(c) => <CaseBody bc={c} />}</QueryState>;
}

function CaseBody({ bc }: { bc: BusinessCase }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const initiatives = useInitiativeOptions(ws.tid);
  const cases = useBusinessCases(ws.tid);
  const archived = bc.status === "archived";
  const editable = ws.can("business_case.edit") && !archived;
  const initiative = initiatives.data?.find((i) => i.id === bc.initiativeId);
  const parent = cases.data?.find((c) => c.id === bc.parentCaseId);
  const sections = [
    { id: "summary", title: t("businessCases.summaryTitle") },
    { id: "finance", title: t("businessCases.finance.title") },
    { id: "sections", title: t("businessCases.sections.title") },
    { id: "totals", title: t("businessCases.totals.title") },
    { id: "lines-investment", title: t("businessCases.lineKind.investmentLines") },
    { id: "lines-benefit", title: t("businessCases.lineKind.benefitLines") },
  ];
  return (
    <div data-business-case={bc.code}>
      <SectionNav sections={sections} />
      <Section id="summary" title={t("businessCases.summaryTitle")}>
        <dl className="details">
          <div>
            <dt>{t("businessCases.field.code")}</dt>
            <dd>
              <bdi dir="ltr" className="code">
                {bc.code}
              </bdi>
            </dd>
          </div>
          <div>
            <dt>{t("businessCases.field.title")}</dt>
            <dd>{bc.title}</dd>
          </div>
          <div>
            <dt>{t("businessCases.field.level")}</dt>
            <dd data-level={bc.level}>{t(`businessCases.level.${bc.level}`)}</dd>
          </div>
          {bc.level === "initiative" ? (
            <>
              <div>
                <dt>{t("businessCases.field.initiative")}</dt>
                <dd>
                  {initiative ? (
                    <Link className="link" to={`/transformations/${ws.tid}/initiatives/${initiative.id}`}>
                      <bdi dir="ltr" className="code">
                        {initiative.code}
                      </bdi>{" "}
                      {initiative.name}
                    </Link>
                  ) : (
                    <span className="muted">{t("businessCases.initiativeNotVisible")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>{t("businessCases.field.parent")}</dt>
                <dd>
                  {bc.parentCaseId ? (
                    <Link className="link" to={`/transformations/${ws.tid}/business-cases/${bc.parentCaseId}`}>
                      <bdi dir="ltr" className="code">
                        {parent?.code ?? t("businessCases.level.transformation")}
                      </bdi>
                    </Link>
                  ) : null}
                </dd>
              </div>
            </>
          ) : null}
          <div>
            <dt>{t("businessCases.field.currency")}</dt>
            <dd>
              <bdi dir="ltr" className="code">
                {bc.currency}
              </bdi>
            </dd>
          </div>
          <div>
            <dt>{t("common.field.status")}</dt>
            <dd>
              <RecordStatus status={bc.status} />
            </dd>
          </div>
          <div>
            <dt>{t("businessCases.sections.column")}</dt>
            <dd>
              <CompletenessChip missing={bc.missingSections} />
            </dd>
          </div>
          <div>
            <dt>{t("businessCases.field.updatedAt")}</dt>
            <dd>{formatDateTime(bc.updatedAt, locale, ws.tr.timezone)}</dd>
          </div>
        </dl>
        <p className="muted small">{t("businessCases.draftNote")}</p>
        {archived ? (
          <p className="banner banner--info" role="note">
            <Icon name="archive" /> {t("businessCases.archivedNote")}
          </p>
        ) : null}
      </Section>
      <BaselineValidation bc={bc} />
      <CaseSections key={bc.id} bc={bc} editable={editable} />
      <CaseTotals bc={bc} />
      <CaseLines bc={bc} editable={editable} />
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ Finance validation

function BaselineValidation({ bc }: { bc: BusinessCase }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const { byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [open, setOpen] = useState(false);
  const mayValidate = ws.can("finance.validate") && bc.status !== "archived";
  const isAuthor = bc.createdBy === ws.meId;
  const hasBaseline = bc.sections.baselineSummary !== null;
  const state = bc.baselineValidation;
  return (
    <Section
      id="finance"
      title={t("businessCases.finance.title")}
      intro={t("businessCases.finance.intro")}
      actions={
        mayValidate && !isAuthor && hasBaseline ? (
          <button type="button" className="button button--primary button--small" onClick={() => setOpen(true)}>
            <Icon name="check" /> {t("businessCases.finance.action")}
          </button>
        ) : null
      }
    >
      <p data-baseline-validation={state}>
        <FinanceStateChip state={state} />
      </p>
      {state === "stale" ? (
        <p className="banner banner--warning" role="note" data-state="baseline-stale">
          <Icon name="clock" /> {t("businessCases.finance.staleBody")}
        </p>
      ) : null}
      {state === "unvalidated" ? <p className="muted">{t("businessCases.finance.unvalidatedBody")}</p> : null}
      {bc.baselineValidatedAt ? (
        <dl className="details details--compact">
          <div>
            <dt>{t("businessCases.finance.by")}</dt>
            <dd>
              <PersonName id={bc.baselineValidatedBy} people={byId} />
            </dd>
          </div>
          <div>
            <dt>{t("businessCases.finance.at")}</dt>
            <dd>{formatDateTime(bc.baselineValidatedAt, locale, ws.tr.timezone)}</dd>
          </div>
          <div>
            <dt>{t("businessCases.finance.note")}</dt>
            <dd>
              <TextCell value={bc.baselineValidationNote} />
            </dd>
          </div>
        </dl>
      ) : null}
      {mayValidate && isAuthor ? (
        <p className="muted small" data-state="validator-is-author">
          <Icon name="lock" /> {t("businessCases.finance.authorCannot")}
        </p>
      ) : null}
      {mayValidate && !isAuthor && !hasBaseline ? (
        <p className="muted small">{t("businessCases.finance.noBaseline")}</p>
      ) : null}
      {open ? (
        <FinanceValidationDialog
          title={t("businessCases.finance.dialogTitle", { code: bc.code })}
          description={t("businessCases.finance.dialogBody")}
          url={`${caseUrl(bc.id)}/baseline-validation`}
          version={bc.version}
          onDone={refresh}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ ten sections

type TextField =
  | "strategicRationale"
  | "baselineSummary"
  | "valuePoolsSummary"
  | "interventionsSummary"
  | "investmentSummary"
  | "benefitsSummary"
  | "benefitRamp"
  | "recurrenceSummary"
  | "implementationHorizon"
  | "keyAssumptions"
  | "downsideCase"
  | "upsideCase"
  | "decisionAskText";
type PersonField = "benefitOwnerUserId" | "initiativeOwnerUserId" | "financeValidatorUserId";
type SectionField = TextField | PersonField;

const MAX: Record<TextField, number> = {
  strategicRationale: 20000,
  baselineSummary: 20000,
  valuePoolsSummary: 20000,
  interventionsSummary: 20000,
  investmentSummary: 20000,
  benefitsSummary: 20000,
  benefitRamp: 4000,
  recurrenceSummary: 4000,
  implementationHorizon: 4000,
  keyAssumptions: 20000,
  downsideCase: 8000,
  upsideCase: 8000,
  decisionAskText: 8000,
};

/** The ten B0085 sections and their fields, in source order (ADR-0024 §1). */
const SECTIONS: readonly { code: BusinessCaseSectionCode; fields: readonly SectionField[]; asks?: true }[] = [
  { code: "strategic_rationale", fields: ["strategicRationale"] },
  { code: "baseline", fields: ["baselineSummary"] },
  { code: "value_pools", fields: ["valuePoolsSummary"] },
  { code: "interventions", fields: ["interventionsSummary"] },
  { code: "investment", fields: ["investmentSummary"] },
  { code: "benefits", fields: ["benefitsSummary"] },
  { code: "timing", fields: ["benefitRamp", "recurrenceSummary", "implementationHorizon"] },
  { code: "risks", fields: ["keyAssumptions", "downsideCase", "upsideCase"] },
  { code: "ownership", fields: ["benefitOwnerUserId", "initiativeOwnerUserId", "financeValidatorUserId"] },
  { code: "decision_ask", fields: ["decisionAskText"], asks: true },
];
const PERSON_FIELDS: readonly PersonField[] = ["benefitOwnerUserId", "initiativeOwnerUserId", "financeValidatorUserId"];
const isPerson = (f: SectionField): f is PersonField => (PERSON_FIELDS as readonly string[]).includes(f);

interface SectionValues {
  title: string;
  fields: Record<SectionField, string>;
  asks: string[];
}

function toValues(bc: BusinessCase): SectionValues {
  const fields = {} as Record<SectionField, string>;
  for (const s of SECTIONS) for (const f of s.fields) fields[f] = bc.sections[f] ?? "";
  return { title: bc.title, fields, asks: [...bc.sections.decisionAskTypes] };
}

/** Only changed fields; "" clears a section field (null). */
function diff(before: SectionValues, now: SectionValues): Record<string, unknown> {
  const sections: Record<string, unknown> = {};
  for (const s of SECTIONS)
    for (const f of s.fields)
      if (before.fields[f] !== now.fields[f]) sections[f] = now.fields[f] === "" ? null : now.fields[f];
  const sortAsks = (a: string[]) => [...a].sort().join(",");
  if (sortAsks(before.asks) !== sortAsks(now.asks))
    sections["decisionAskTypes"] = DECISION_ASK_TYPES.filter((a) => now.asks.includes(a));
  const body: Record<string, unknown> = {};
  if (before.title !== now.title) body["title"] = now.title;
  if (Object.keys(sections).length > 0) body["sections"] = sections;
  return body;
}

function fieldOfPointer(pointer: string): string | null {
  if (pointer === "/title") return "title";
  const m = /^\/sections\/([A-Za-z]+)/.exec(pointer);
  return m ? m[1]! : null;
}

function CaseSections({ bc, editable }: { bc: BusinessCase; editable: boolean }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { people, byId } = usePeople(ws.tid);
  const refresh = useP3Refresh(ws.tid);
  const [values, setValues] = useState<SectionValues>(() => toValues(bc));
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [formCodes, setFormCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useFocusFirstInvalid(formRef);
  const save = useVersionedSave<BusinessCase, SectionValues>({
    initial: bc,
    url: (r) => caseUrl(r.id),
    toValues,
    diff,
    onSaved: async () => {
      await refresh();
    },
  });
  const required = new Set<BusinessCaseSectionCode>(
    bc.level === "transformation" ? BUSINESS_CASE_SECTION_CODES : INITIATIVE_CASE_SECTION_CODES,
  );
  const missing = new Set(bc.missingSections);
  const err = (name: string) => (codes[name] ? caseFieldMessage(t, codes[name]) : undefined);
  const setField = (f: SectionField, v: string) => {
    setSaved(false);
    setValues((x) => ({ ...x, fields: { ...x.fields, [f]: v } }));
  };

  const submit = async () => {
    setSaved(false);
    const before = toValues(save.base);
    const body = diff(before, values);
    const next: Record<string, string> = {};
    const other: string[] = [];
    if (values.title !== before.title && isBlankText(values.title)) next["title"] = BLANK_CODE;
    for (const s of SECTIONS)
      for (const f of s.fields)
        if (!isPerson(f) && values.fields[f] !== before.fields[f] && isBlankText(values.fields[f]))
          next[f] = BLANK_CODE;
    if (Object.keys(body).length === 0 && Object.keys(next).length === 0) {
      setCodes({});
      setFormCodes(["validation.empty_update"]);
      return;
    }
    const parsed = businessCaseUpdate.safeParse(body);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const name = issue.path[0] === "sections" ? String(issue.path[1] ?? "") : String(issue.path[0] ?? "");
        if (name && name !== "decisionAskTypes") next[name] ??= issueCode(issue);
        else other.push(issueCode(issue));
      }
    setCodes(next);
    setFormCodes(other);
    if (Object.keys(next).length > 0 || other.length > 0) {
      focusInvalid();
      return;
    }
    const result = await save.save(values);
    if (result.outcome === "saved") setSaved(true);
    if (result.outcome === "error") {
      const split = splitProblem(result.error, fieldOfPointer);
      setCodes(split.fields);
      if (Object.keys(split.fields).length > 0) focusInvalid();
    }
  };

  const conflictRows = (() => {
    const latest = save.conflict?.latest;
    if (!latest) return [];
    const lv = toValues(latest);
    const rows: { field: string; label: string; mine: string; current: string }[] = SECTIONS.flatMap((s) => s.fields)
      .filter((f) => lv.fields[f] !== values.fields[f])
      .map((f) => ({
        field: f,
        label: t(`businessCases.sectionField.${f}`),
        mine: values.fields[f] || t("common.value.none"),
        current: lv.fields[f] || t("common.value.none"),
      }));
    if (lv.title !== values.title)
      rows.unshift({ field: "title", label: t("businessCases.field.title"), mine: values.title, current: lv.title });
    return rows;
  })();

  const personLabel = (id: string) => people.find((p) => p.id === id)?.label;

  return (
    <Section
      id="sections"
      title={t("businessCases.sections.title")}
      intro={t(`businessCases.sections.intro.${bc.level}`)}
    >
      {save.conflict ? (
        <ConflictPanel
          yourVersion={save.base.version}
          currentVersion={save.conflict.currentVersion}
          rows={conflictRows}
          busy={save.busy}
          {...(save.conflict.latest
            ? {
                onReapply: () =>
                  void save.reapply(values).then((r) => {
                    if (r.outcome === "saved") setSaved(true);
                  }),
              }
            : {})}
          onDiscard={() => setValues(save.discard())}
        />
      ) : null}
      {editable ? (
        <form
          ref={formRef}
          className="form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label={t("businessCases.field.title")} error={err("title")} required>
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={300}
                value={values.title}
                onChange={(e) => {
                  setSaved(false);
                  setValues((x) => ({ ...x, title: e.target.value }));
                }}
              />
            )}
          </Field>
          {SECTIONS.map((s, i) => (
            <fieldset key={s.code} className="plain-fieldset form-section" data-section={s.code}>
              <legend className="card__subtitle">
                {i + 1}. {t(`businessCases.section.${s.code}.title`)}{" "}
                <SectionMarks required={required.has(s.code)} missing={missing.has(s.code)} />
              </legend>
              <p className="muted small">{t(`businessCases.section.${s.code}.hint`)}</p>
              {s.code === "baseline" && bc.baselineValidation === "validated" ? (
                <p className="field__hint" data-state="baseline-edit-warning">
                  <Icon name="info" /> {t("businessCases.finance.editMakesStale")}
                </p>
              ) : null}
              {s.asks ? (
                <fieldset className="field field--group">
                  <legend className="field__label">{t("businessCases.sectionField.decisionAskTypes")}</legend>
                  {DECISION_ASK_TYPES.map((a) => (
                    <label key={a} className="checkbox">
                      <input
                        type="checkbox"
                        checked={values.asks.includes(a)}
                        onChange={(e) => {
                          setSaved(false);
                          setValues((x) => ({
                            ...x,
                            asks: e.target.checked ? [...x.asks, a] : x.asks.filter((y) => y !== a),
                          }));
                        }}
                      />
                      {t(`businessCases.decisionAsk.${a}`)}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {s.fields.map((f) =>
                isPerson(f) ? (
                  <Field key={f} label={t(`businessCases.sectionField.${f}`)} error={err(f)}>
                    {(control) => (
                      <select {...control} value={values.fields[f]} onChange={(e) => setField(f, e.target.value)}>
                        <option value="">{t("common.value.notAssigned")}</option>
                        {people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                        {values.fields[f] && !personLabel(values.fields[f]) ? (
                          <option value={values.fields[f]}>{t("common.people.outsideTeam")}</option>
                        ) : null}
                      </select>
                    )}
                  </Field>
                ) : (
                  <Field key={f} label={t(`businessCases.sectionField.${f}`)} error={err(f)}>
                    {(control) => (
                      <textarea
                        {...control}
                        rows={MAX[f] > 8000 ? 4 : 2}
                        maxLength={MAX[f]}
                        value={values.fields[f]}
                        onChange={(e) => setField(f, e.target.value)}
                      />
                    )}
                  </Field>
                ),
              )}
            </fieldset>
          ))}
          <FormAlert error={save.error} codes={formCodes} />
          {saved ? (
            <p className="banner banner--success" role="status" data-state="saved">
              <Icon name="check" /> {t("businessCases.sections.saved")}
            </p>
          ) : null}
          <div className="form__actions">
            <button type="submit" className="button button--primary" disabled={save.busy || save.conflict !== null}>
              {save.busy ? t("common.state.saving") : t("businessCases.sections.save")}
            </button>
          </div>
        </form>
      ) : (
        <ReadOnlySections bc={bc} people={byId} required={required} missing={missing} />
      )}
    </Section>
  );
}

function SectionMarks({ required, missing }: { required: boolean; missing: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="small muted">
        ({required ? t("businessCases.sections.required") : t("businessCases.sections.optional")})
      </span>{" "}
      {missing ? (
        <span className="status-chip status-chip--at-risk small" data-missing="true">
          <Icon name="alert" /> {t("businessCases.sections.missing")}
        </span>
      ) : null}
    </>
  );
}

function ReadOnlySections({
  bc,
  people,
  required,
  missing,
}: {
  bc: BusinessCase;
  people: ReadonlyMap<string, Person>;
  required: ReadonlySet<string>;
  missing: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  return (
    <div data-state="sections-read-only">
      {SECTIONS.map((s, i) => (
        <div key={s.code} className="form-section" data-section={s.code}>
          <h3 className="card__subtitle">
            {i + 1}. {t(`businessCases.section.${s.code}.title`)}{" "}
            <SectionMarks required={required.has(s.code)} missing={missing.has(s.code)} />
          </h3>
          <dl className="details">
            {s.asks ? (
              <div>
                <dt>{t("businessCases.sectionField.decisionAskTypes")}</dt>
                <dd>
                  {bc.sections.decisionAskTypes.length === 0 ? (
                    <span className="muted">{t("common.value.none")}</span>
                  ) : (
                    bc.sections.decisionAskTypes.map((a) => t(`businessCases.decisionAsk.${a}`)).join(" · ")
                  )}
                </dd>
              </div>
            ) : null}
            {s.fields.map((f) => (
              <div key={f}>
                <dt>{t(`businessCases.sectionField.${f}`)}</dt>
                <dd>
                  {isPerson(f) ? (
                    <PersonName id={bc.sections[f]} people={people} />
                  ) : (
                    <TextCell value={bc.sections[f]} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
