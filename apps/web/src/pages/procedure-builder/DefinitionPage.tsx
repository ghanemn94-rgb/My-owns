// One procedure definition (T-DG5-FE-D; REQ-S06-001; ADR-0042 §1–§2, §10): purpose, trigger, scope, prerequisites,
// inputs and input schema, ordered / conditional / parallel steps, responsible roles, SLA, validation rules, approval
// path, escalation path, expected outputs, completion condition, exceptions, version and effective date.
//  - Read-only for every reader (procedure.read); in an editable `procedures` draft the methodology administrator edits
//    it in the builder below. "Validate" returns EVERY finding of the body (validateProcedureDefinition); "Save to
//    draft" sends If-Match with the draft's version (putProcedureDefinition); a seeded procedure can be edited but not
//    removed (422 procedure_definition.source_protected). The draft is published in the Playbook Studio.
//  - A draft is never shown as published: the version chip says "Draft — editing" until the Studio publishes it.
import {
  procedureInputField,
  PROCEDURE_APPROVAL_MODES,
  PROCEDURE_COMPLETION_RULES,
  PROCEDURE_CONDITION_OPERATORS,
  PROCEDURE_OUTPUT_MODES,
  PROCEDURE_OUTPUT_RECORD_TYPES,
  PROCEDURE_SCOPE_LEVELS,
  PROCEDURE_STEP_KINDS,
  PROCEDURE_TRIGGER_KINDS,
} from "@mth/shared/schemas";
import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import { api } from "../../api/client.ts";
import { p5Paths, useConfigVersion, useStudioRefresh, type ConfigVersion } from "../../api/p5.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import { beginSessionGuard } from "../../auth/sessionBound.ts";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { formatBusinessDate } from "../../lib/format.ts";
import { problemKey } from "../../lib/problem.ts";
import { FormAlert, ReadOnlyNote } from "../my-work/p4ui.tsx";
import { isEditableDraft, versionState } from "../studio/api.ts";
import { ConfigurationNote, VersionStateChip } from "../studio/ui.tsx";
import { FED_NS, pick, useRunner } from "../automation/ui.tsx";
import { useDefinition, type ProcedureDefinition, type ProcedureValidationReport } from "../procedures/api.ts";

// ------------------------------------------------------------------------------------------------ the editable model

/** The eleven field types (ADR-0041 §3), read from the shared input-field mirror (no second list). */
const FIELD_TYPES = procedureInputField.shape.fieldType.options;

/** Every value of the builder is a string (or boolean); the body is built from it when validating or saving. */
interface StepDraft {
  stepKey: string;
  ordinal: string;
  parallelGroup: string;
  stepKind: string;
  nameEn: string;
  nameAr: string;
  instructionsEn: string;
  instructionsAr: string;
  responsibleRoleCode: string;
  approvalRoleCode: string;
  slaWorkingDays: string;
  conditionInputKey: string;
  conditionOperator: string;
  conditionValue: string;
  requiredInputKeys: string;
  evidenceRequired: boolean;
  skippable: boolean;
  outputRecordType: string;
  outputMode: string;
}
interface InputDraft {
  key: string;
  fieldType: string;
  labelEn: string;
  labelAr: string;
  required: boolean;
  options: string;
}
export interface DefinitionDraft {
  [k: string]: unknown;
  nameEn: string;
  nameAr: string;
  purposeEn: string;
  purposeAr: string;
  triggerKind: string;
  triggerEvent: string;
  triggerDescriptionEn: string;
  triggerDescriptionAr: string;
  scopeLevel: string;
  scopeDescriptionEn: string;
  scopeDescriptionAr: string;
  prerequisitesEn: string;
  prerequisitesAr: string;
  launchRoleCodes: string;
  responsibleRoleCodes: string;
  slaWorkingDays: string;
  validationRulesEn: string;
  validationRulesAr: string;
  approvalMode: string;
  approvalRoleCodes: string;
  escalationRoleCode: string;
  escalationAfterWorkingDays: string;
  expectedOutputsEn: string;
  expectedOutputsAr: string;
  completionRule: string;
  completionDescriptionEn: string;
  completionDescriptionAr: string;
  exceptionsEn: string;
  exceptionsAr: string;
  effectiveFrom: string;
  inputs: InputDraft[];
  steps: StepDraft[];
}

const s = (v: string | null | undefined): string => v ?? "";
const list = (v: readonly string[]): string => v.join(", ");
const today = (): string => new Date().toISOString().slice(0, 10);

const emptyStep = (ordinal: number): StepDraft => ({
  stepKey: "",
  ordinal: String(ordinal),
  parallelGroup: "",
  stepKind: "task",
  nameEn: "",
  nameAr: "",
  instructionsEn: "",
  instructionsAr: "",
  responsibleRoleCode: "",
  approvalRoleCode: "",
  slaWorkingDays: "5",
  conditionInputKey: "",
  conditionOperator: "",
  conditionValue: "",
  requiredInputKeys: "",
  evidenceRequired: false,
  skippable: false,
  outputRecordType: "",
  outputMode: "",
});

/** The builder's model of a definition (or of a new one: no trigger, no completion until the author picks them). */
export function toDraft(d: ProcedureDefinition | null): DefinitionDraft {
  if (!d)
    return {
      nameEn: "",
      nameAr: "",
      purposeEn: "",
      purposeAr: "",
      triggerKind: "",
      triggerEvent: "",
      triggerDescriptionEn: "",
      triggerDescriptionAr: "",
      scopeLevel: "transformation",
      scopeDescriptionEn: "",
      scopeDescriptionAr: "",
      prerequisitesEn: "",
      prerequisitesAr: "",
      launchRoleCodes: "",
      responsibleRoleCodes: "",
      slaWorkingDays: "10",
      validationRulesEn: "",
      validationRulesAr: "",
      approvalMode: "none",
      approvalRoleCodes: "",
      escalationRoleCode: "",
      escalationAfterWorkingDays: "",
      expectedOutputsEn: "",
      expectedOutputsAr: "",
      completionRule: "",
      completionDescriptionEn: "",
      completionDescriptionAr: "",
      exceptionsEn: "",
      exceptionsAr: "",
      effectiveFrom: today(),
      inputs: [],
      steps: [emptyStep(1)],
    };
  return {
    nameEn: d.nameEn,
    nameAr: d.nameAr,
    purposeEn: d.purposeEn,
    purposeAr: d.purposeAr,
    triggerKind: d.trigger.kind,
    triggerEvent: s(d.trigger.event),
    triggerDescriptionEn: d.trigger.descriptionEn,
    triggerDescriptionAr: d.trigger.descriptionAr,
    scopeLevel: d.scope.level,
    scopeDescriptionEn: d.scope.descriptionEn,
    scopeDescriptionAr: d.scope.descriptionAr,
    prerequisitesEn: s(d.prerequisitesEn),
    prerequisitesAr: s(d.prerequisitesAr),
    launchRoleCodes: list(d.launchRoleCodes),
    responsibleRoleCodes: list(d.responsibleRoleCodes),
    slaWorkingDays: String(d.slaWorkingDays),
    validationRulesEn: d.validationRulesEn,
    validationRulesAr: d.validationRulesAr,
    approvalMode: d.approval.mode,
    approvalRoleCodes: list(d.approval.roleCodes),
    escalationRoleCode: s(d.escalation?.roleCode),
    escalationAfterWorkingDays: d.escalation ? String(d.escalation.afterWorkingDays) : "",
    expectedOutputsEn: d.expectedOutputsEn,
    expectedOutputsAr: d.expectedOutputsAr,
    completionRule: d.completion.rule,
    completionDescriptionEn: d.completion.descriptionEn,
    completionDescriptionAr: d.completion.descriptionAr,
    exceptionsEn: s(d.exceptionsEn),
    exceptionsAr: s(d.exceptionsAr),
    effectiveFrom: d.effectiveFrom,
    inputs: d.inputSchema.map((f) => ({
      key: f.key,
      fieldType: f.fieldType,
      labelEn: f.labelEn,
      labelAr: f.labelAr,
      required: f.required,
      options: list(f.options ?? []),
    })),
    steps: d.steps
      .filter((x) => !x.removed)
      .map((x) => ({
        stepKey: x.stepKey,
        ordinal: String(x.ordinal),
        parallelGroup: s(x.parallelGroup),
        stepKind: x.stepKind,
        nameEn: x.nameEn,
        nameAr: x.nameAr,
        instructionsEn: s(x.instructionsEn),
        instructionsAr: s(x.instructionsAr),
        responsibleRoleCode: x.responsibleRoleCode,
        approvalRoleCode: s(x.approvalRoleCode),
        slaWorkingDays: String(x.slaWorkingDays),
        conditionInputKey: s(x.condition?.inputKey),
        conditionOperator: s(x.condition?.operator),
        conditionValue:
          x.condition?.value === undefined || x.condition.value === null
            ? ""
            : Array.isArray(x.condition.value)
              ? (x.condition.value as unknown[]).join(", ")
              : String(x.condition.value as string),
        requiredInputKeys: list(x.requiredInputKeys),
        evidenceRequired: x.evidenceRequired,
        skippable: x.skippable,
        outputRecordType: s(x.output?.recordType),
        outputMode: s(x.output?.mode),
      })),
  };
}

const codes = (v: string): string[] =>
  v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const opt = (v: string): string | undefined => (v.trim() === "" ? undefined : v.trim());
const int = (v: string): number => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

/**
 * The request body (OpenAPI `ProcedureDefinitionInput`) of the builder's model. A trigger or completion the author
 * left unset is OMITTED, so the server answers 422 procedure_definition.trigger_required / completion_required.
 */
export function toBody(d: DefinitionDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    nameEn: d.nameEn.trim(),
    nameAr: d.nameAr.trim(),
    purposeEn: d.purposeEn.trim(),
    purposeAr: d.purposeAr.trim(),
    scope: {
      level: d.scopeLevel,
      descriptionEn: d.scopeDescriptionEn.trim(),
      descriptionAr: d.scopeDescriptionAr.trim(),
    },
    launchRoleCodes: codes(d.launchRoleCodes),
    responsibleRoleCodes: codes(d.responsibleRoleCodes),
    slaWorkingDays: int(d.slaWorkingDays),
    validationRulesEn: d.validationRulesEn.trim(),
    validationRulesAr: d.validationRulesAr.trim(),
    approval: { mode: d.approvalMode, roleCodes: codes(d.approvalRoleCodes) },
    escalation: opt(d.escalationRoleCode)
      ? { roleCode: d.escalationRoleCode.trim(), afterWorkingDays: int(d.escalationAfterWorkingDays) }
      : null,
    expectedOutputsEn: d.expectedOutputsEn.trim(),
    expectedOutputsAr: d.expectedOutputsAr.trim(),
    effectiveFrom: d.effectiveFrom,
    inputSchema: d.inputs.map((f) => ({
      key: f.key.trim(),
      fieldType: f.fieldType,
      labelEn: f.labelEn.trim(),
      labelAr: f.labelAr.trim(),
      required: f.required,
      ...(codes(f.options).length > 0 ? { options: codes(f.options) } : {}),
    })),
    steps: d.steps.map((x) => {
      const condValue = x.conditionOperator === "in" ? codes(x.conditionValue) : opt(x.conditionValue);
      return {
        stepKey: x.stepKey.trim(),
        ordinal: int(x.ordinal),
        stepKind: x.stepKind,
        nameEn: x.nameEn.trim(),
        nameAr: x.nameAr.trim(),
        responsibleRoleCode: x.responsibleRoleCode.trim(),
        slaWorkingDays: int(x.slaWorkingDays),
        parallelGroup: opt(x.parallelGroup) ?? null,
        instructionsEn: opt(x.instructionsEn) ?? null,
        instructionsAr: opt(x.instructionsAr) ?? null,
        approvalRoleCode: opt(x.approvalRoleCode) ?? null,
        condition: opt(x.conditionInputKey)
          ? {
              inputKey: x.conditionInputKey.trim(),
              operator: x.conditionOperator || "present",
              ...(condValue === undefined ? {} : { value: condValue }),
            }
          : null,
        requiredInputKeys: codes(x.requiredInputKeys),
        evidenceRequired: x.evidenceRequired,
        skippable: x.skippable,
        output: x.outputRecordType ? { recordType: x.outputRecordType, mode: x.outputMode || "create" } : null,
      };
    }),
  };
  for (const k of ["prerequisitesEn", "prerequisitesAr", "exceptionsEn", "exceptionsAr"] as const)
    body[k] = opt(d[k]) ?? null;
  if (d.triggerKind)
    body["trigger"] = {
      kind: d.triggerKind,
      event: d.triggerKind === "event" ? (opt(d.triggerEvent) ?? null) : null,
      descriptionEn: d.triggerDescriptionEn.trim(),
      descriptionAr: d.triggerDescriptionAr.trim(),
    };
  if (d.completionRule)
    body["completion"] = {
      rule: d.completionRule,
      descriptionEn: d.completionDescriptionEn.trim(),
      descriptionAr: d.completionDescriptionAr.trim(),
    };
  return body;
}

// ------------------------------------------------------------------------------------------------ the page

export function DefinitionPage() {
  const { t } = useTranslation();
  const { procedureCode } = useParams();
  const [search] = useSearchParams();
  const versionId = search.get("versionId");
  const isNew = search.get("new") === "1";
  usePageTitle(t("nav.p5.procedureDefinition.title"));
  const definition = useDefinition(isNew ? undefined : procedureCode, versionId);
  const version = useConfigVersion(versionId ?? undefined);
  return (
    <div className="page" data-p5-screen="procedure-definition">
      <PageHeader
        demoBadge
        title={t("nav.p5.procedureDefinition.title")}
        subtitle={<bdi dir="ltr">{procedureCode}</bdi>}
        crumbs={[
          { label: t("nav.p5.procedureBuilder.title"), to: "/admin/procedures" },
          { label: procedureCode ?? "" },
        ]}
      />
      <ConfigurationNote />
      {isNew ? (
        <QueryState query={version}>
          {(v) => <Body code={procedureCode ?? ""} definition={null} draftVersion={v} />}
        </QueryState>
      ) : (
        <QueryState query={definition}>
          {(d) => <Body code={d.code} definition={d} draftVersion={version.data ?? null} />}
        </QueryState>
      )}
    </div>
  );
}

function Body({
  code,
  definition,
  draftVersion,
}: {
  code: string;
  definition: ProcedureDefinition | null;
  draftVersion: ConfigVersion | null;
}) {
  const { t } = useTranslation();
  const me = useMe();
  const canEdit = canAnywhere(me, "methodology.configure");
  const editable = Boolean(
    draftVersion && isEditableDraft(draftVersion) && canEdit && draftVersion.configKind === "procedure",
  );
  const [editing, setEditing] = useState(definition === null);
  return (
    <>
      {draftVersion ? (
        <p data-version-state={versionState(draftVersion)}>
          <VersionStateChip state={versionState(draftVersion)} />{" "}
          <span className="small muted">
            {t("workflowsP5.builder.inVersion", { no: draftVersion.versionNo })}{" "}
            <Link className="link" to={`/admin/studio/versions/${draftVersion.id}`}>
              {t("workflowsP5.builder.openInStudio")}
            </Link>
          </span>
        </p>
      ) : null}
      {!editable ? <ReadOnlyNote body={t("workflowsP5.builder.readOnlyDefinition")} /> : null}
      {definition ? <DefinitionView d={definition} /> : null}
      {editable && draftVersion ? (
        editing ? (
          <Builder code={code} definition={definition} draftVersion={draftVersion} onClose={() => setEditing(false)} />
        ) : (
          <div className="form__actions">
            <button type="button" className="button button--primary" onClick={() => setEditing(true)}>
              {t("workflowsP5.builder.edit")}
            </button>
          </div>
        )
      ) : null}
      {editable && draftVersion && definition && !definition.removed ? (
        <RemoveSection code={code} draftVersion={draftVersion} />
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </>
  );
}

/** The read view of every element REQ-S06-001 names. */
function DefinitionView({ d }: { d: ProcedureDefinition }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const tx = (en: string | null, ar: string | null) => pick(locale, en, ar) ?? "—";
  return (
    <>
      <Section id="definition" title={tx(d.nameEn, d.nameAr)}>
        <dl className="workspace-header__grid" data-definition={d.code}>
          <Row label={t("workflowsP5.builder.purpose")}>{tx(d.purposeEn, d.purposeAr)}</Row>
          <Row label={t("workflowsP5.builder.trigger")}>
            {t(`workflowsP5.triggerKind.${d.trigger.kind}`)}
            {d.trigger.event ? (
              <bdi dir="ltr" className="code">
                {" "}
                {d.trigger.event}
              </bdi>
            ) : null}{" "}
            · {tx(d.trigger.descriptionEn, d.trigger.descriptionAr)}
          </Row>
          <Row label={t("workflowsP5.builder.scope")}>
            {t(`workflowsP5.scopeLevel.${d.scope.level}`)} · {tx(d.scope.descriptionEn, d.scope.descriptionAr)}
          </Row>
          <Row label={t("workflowsP5.builder.prerequisites")}>{tx(d.prerequisitesEn, d.prerequisitesAr)}</Row>
          <Row label={t("workflowsP5.builder.launchRoles")}>
            <bdi dir="ltr">{d.launchRoleCodes.join(", ")}</bdi>
          </Row>
          <Row label={t("workflowsP5.builder.responsibleRoles")}>
            <bdi dir="ltr">{d.responsibleRoleCodes.join(", ")}</bdi>
          </Row>
          <Row label={t("workflowsP5.builder.sla")}>
            {t("workflowsP5.builder.workingDays", { count: d.slaWorkingDays })}
          </Row>
          <Row label={t("workflowsP5.builder.validationRules")}>{tx(d.validationRulesEn, d.validationRulesAr)}</Row>
          <Row label={t("workflowsP5.builder.approval")}>
            {t(`workflowsP5.approvalMode.${d.approval.mode}`)}
            {d.approval.roleCodes.length ? <bdi dir="ltr"> · {d.approval.roleCodes.join(", ")}</bdi> : null}
          </Row>
          <Row label={t("workflowsP5.builder.escalation")}>
            {d.escalation ? (
              <>
                <bdi dir="ltr">{d.escalation.roleCode}</bdi> ·{" "}
                {t("workflowsP5.builder.workingDays", { count: d.escalation.afterWorkingDays })}
              </>
            ) : (
              t("workflowsP5.none")
            )}
          </Row>
          <Row label={t("workflowsP5.builder.expectedOutputs")}>{tx(d.expectedOutputsEn, d.expectedOutputsAr)}</Row>
          <Row label={t("workflowsP5.builder.completion")}>
            {t(`workflowsP5.completionRule.${d.completion.rule}`)} ·{" "}
            {tx(d.completion.descriptionEn, d.completion.descriptionAr)}
          </Row>
          <Row label={t("workflowsP5.builder.exceptions")}>{tx(d.exceptionsEn, d.exceptionsAr)}</Row>
          <Row label={t("workflowsP5.builder.versionEffective")}>
            v{d.versionNo} · {t(`workflowsP5.builder.versionStatus.${d.versionStatus}`)} ·{" "}
            {formatBusinessDate(d.effectiveFrom, locale)}
          </Row>
        </dl>
      </Section>
      <Section id="inputs" title={t("workflowsP5.builder.inputsTitle")}>
        {d.inputSchema.length === 0 ? (
          <p className="muted">{t("workflowsP5.builder.noInputs")}</p>
        ) : (
          <ul className="plain-list">
            {d.inputSchema.map((f) => (
              <li key={f.key}>
                {tx(f.labelEn, f.labelAr)} ·{" "}
                <bdi dir="ltr" className="code">
                  {f.key}
                </bdi>{" "}
                · {t(`workflowsP5.fieldType.${f.fieldType}`)}
                {f.required ? ` · ${t("workflowsP5.builder.required")}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="steps" title={t("workflowsP5.builder.stepsTitle")}>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t("workflowsP5.builder.stepsTitle")}>
          <table className="table" data-table="definition-steps">
            <caption className="visually-hidden">{t("workflowsP5.builder.stepsTitle")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("workflowsP5.procedures.ordinal")}</th>
                <th scope="col">{t("workflowsP5.procedures.step")}</th>
                <th scope="col">{t("workflowsP5.builder.responsibleRole")}</th>
                <th scope="col">{t("workflowsP5.builder.sla")}</th>
                <th scope="col">{t("workflowsP5.builder.condition")}</th>
                <th scope="col">{t("workflowsP5.builder.output")}</th>
              </tr>
            </thead>
            <tbody>
              {[...d.steps]
                .filter((x) => !x.removed)
                .sort((a, b) => a.ordinal - b.ordinal)
                .map((x) => (
                  <tr key={x.stepKey} data-step={x.stepKey}>
                    <td>
                      <bdi dir="ltr">{x.ordinal}</bdi>
                      {x.parallelGroup ? (
                        <span className="block small" data-parallel={x.parallelGroup}>
                          {t("workflowsP5.procedures.parallel")} <bdi dir="ltr">{x.parallelGroup}</bdi>
                        </span>
                      ) : null}
                    </td>
                    <th scope="row">
                      {tx(x.nameEn, x.nameAr)}
                      <span className="block small muted">
                        {t(`workflowsP5.stepKind.${x.stepKind}`)} · <bdi dir="ltr">{x.stepKey}</bdi>
                      </span>
                    </th>
                    <td>
                      <bdi dir="ltr">
                        {x.responsibleRoleCode}
                        {x.approvalRoleCode ? ` → ${x.approvalRoleCode}` : ""}
                      </bdi>
                    </td>
                    <td>{t("workflowsP5.builder.workingDays", { count: x.slaWorkingDays })}</td>
                    <td data-conditional={x.condition ? "true" : "false"}>
                      {x.condition ? (
                        <bdi dir="ltr" className="code">
                          {x.condition.inputKey} {x.condition.operator}{" "}
                          {x.condition.value === undefined ? "" : JSON.stringify(x.condition.value)}
                        </bdi>
                      ) : (
                        <span className="muted">{t("workflowsP5.builder.always")}</span>
                      )}
                    </td>
                    <td>
                      {x.output
                        ? `${t(`workflowsP5.recordType.${x.output.recordType}`)} · ${t(`workflowsP5.outputMode.${x.output.mode}`)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ the builder

function TextInput({
  label,
  value,
  onChange,
  ltr,
  area,
  type,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
  area?: boolean;
  type?: "date" | "text";
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {area ? (
        <textarea
          id={id}
          rows={2}
          value={value}
          dir={ltr ? "ltr" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          id={id}
          type={type ?? "text"}
          value={value}
          dir={ltr ? "ltr" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function Select({
  id,
  label,
  value,
  options,
  onChange,
  allowNone,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
  allowNone?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone !== undefined ? <option value="">{allowNone}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="field">
      <label className="checkbox" htmlFor={id}>
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
    </div>
  );
}

function Builder({
  code,
  definition,
  draftVersion,
  onClose,
}: {
  code: string;
  definition: ProcedureDefinition | null;
  draftVersion: ConfigVersion;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<DefinitionDraft>(() => toDraft(definition));
  const [report, setReport] = useState<ProcedureValidationReport | null>(null);
  const [validateError, setValidateError] = useState<unknown>(null);
  const studioRefresh = useStudioRefresh();
  const runner = useRunner(studioRefresh);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<DefinitionDraft>) => {
    setSaved(false);
    setD({ ...d, ...patch });
  };
  const setStep = (i: number, patch: Partial<StepDraft>) =>
    set({ steps: d.steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const setInput = (i: number, patch: Partial<InputDraft>) =>
    set({ inputs: d.inputs.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const pair = (base: string, label: string, area = true) => (
    <div className="grid grid--2">
      <TextInput
        label={`${label} (${t("workflowsP5.lang.en")})`}
        value={String(d[`${base}En`] ?? "")}
        ltr
        area={area}
        onChange={(v) => set({ [`${base}En`]: v })}
      />
      <TextInput
        label={`${label} (${t("workflowsP5.lang.ar")})`}
        value={String(d[`${base}Ar`] ?? "")}
        area={area}
        onChange={(v) => set({ [`${base}Ar`]: v })}
      />
    </div>
  );
  const optionsOf = (values: readonly string[], prefix: string) =>
    values.map((v) => ({ value: v, label: t(`${prefix}.${v}`) }));

  const validate = async () => {
    const guard = beginSessionGuard();
    setValidateError(null);
    try {
      const r = await api.send<ProcedureValidationReport>(p5Paths.validateProcedureDefinition, {
        method: "POST",
        body: toBody(d),
      });
      if (!guard.stale()) setReport(r);
    } catch (e) {
      if (!guard.stale(e)) {
        setReport(null);
        setValidateError(e);
      }
    }
  };

  return (
    <Section id="builder" title={t("workflowsP5.builder.editorTitle")} intro={t("workflowsP5.builder.editorIntro")}>
      <form
        className="form"
        noValidate
        data-form="procedure-builder"
        onSubmit={(e) => {
          e.preventDefault();
          void runner
            .run(p5Paths.adminProcedureDefinition(draftVersion.id, code), {
              method: "PUT",
              body: toBody(d),
              ifMatch: draftVersion.version,
            })
            .then((r) => setSaved(r !== null));
        }}
      >
        {runner.alert}
        {saved ? (
          <p className="banner banner--info" role="status" data-state="saved-draft">
            {t("workflowsP5.builder.savedDraft")}
          </p>
        ) : null}
        <fieldset>
          <legend>{t("workflowsP5.builder.basics")}</legend>
          {pair("name", t("workflowsP5.builder.name"), false)}
          {pair("purpose", t("workflowsP5.builder.purpose"))}
          <TextInput
            label={t("workflowsP5.builder.effectiveFrom")}
            type="date"
            ltr
            value={d.effectiveFrom}
            onChange={(v) => set({ effectiveFrom: v })}
          />
        </fieldset>
        <fieldset>
          <legend>{t("workflowsP5.builder.trigger")}</legend>
          <Select
            id="b-trigger-kind"
            label={t("workflowsP5.builder.triggerKind")}
            value={d.triggerKind}
            allowNone={t("workflowsP5.builder.notSet")}
            options={optionsOf(PROCEDURE_TRIGGER_KINDS, "workflowsP5.triggerKind")}
            onChange={(v) => set({ triggerKind: v })}
          />
          {d.triggerKind === "event" ? (
            <TextInput
              label={t("workflowsP5.builder.triggerEvent")}
              ltr
              value={d.triggerEvent}
              onChange={(v) => set({ triggerEvent: v })}
            />
          ) : null}
          {pair("triggerDescription", t("workflowsP5.builder.description"))}
        </fieldset>
        <fieldset>
          <legend>{t("workflowsP5.builder.scope")}</legend>
          <Select
            id="b-scope"
            label={t("workflowsP5.builder.scopeLevel")}
            value={d.scopeLevel}
            options={optionsOf(PROCEDURE_SCOPE_LEVELS, "workflowsP5.scopeLevel")}
            onChange={(v) => set({ scopeLevel: v })}
          />
          {pair("scopeDescription", t("workflowsP5.builder.description"))}
          {pair("prerequisites", t("workflowsP5.builder.prerequisites"))}
        </fieldset>
        <fieldset>
          <legend>{t("workflowsP5.builder.roles")}</legend>
          <p className="field__hint">{t("workflowsP5.builder.rolesHint")}</p>
          <TextInput
            label={t("workflowsP5.builder.launchRoles")}
            ltr
            value={d.launchRoleCodes}
            onChange={(v) => set({ launchRoleCodes: v })}
          />
          <TextInput
            label={t("workflowsP5.builder.responsibleRoles")}
            ltr
            value={d.responsibleRoleCodes}
            onChange={(v) => set({ responsibleRoleCodes: v })}
          />
          <TextInput
            label={t("workflowsP5.builder.slaDays")}
            ltr
            value={d.slaWorkingDays}
            onChange={(v) => set({ slaWorkingDays: v })}
          />
          {pair("validationRules", t("workflowsP5.builder.validationRules"))}
        </fieldset>
        <fieldset>
          <legend>{t("workflowsP5.builder.approvalEscalation")}</legend>
          <Select
            id="b-approval"
            label={t("workflowsP5.builder.approval")}
            value={d.approvalMode}
            options={optionsOf(PROCEDURE_APPROVAL_MODES, "workflowsP5.approvalMode")}
            onChange={(v) => set({ approvalMode: v })}
          />
          <TextInput
            label={t("workflowsP5.builder.approvalRoles")}
            ltr
            value={d.approvalRoleCodes}
            onChange={(v) => set({ approvalRoleCodes: v })}
          />
          <TextInput
            label={t("workflowsP5.builder.escalationRole")}
            ltr
            value={d.escalationRoleCode}
            onChange={(v) => set({ escalationRoleCode: v })}
          />
          <TextInput
            label={t("workflowsP5.builder.escalationAfter")}
            ltr
            value={d.escalationAfterWorkingDays}
            onChange={(v) => set({ escalationAfterWorkingDays: v })}
          />
        </fieldset>
        <fieldset>
          <legend>{t("workflowsP5.builder.outcome")}</legend>
          {pair("expectedOutputs", t("workflowsP5.builder.expectedOutputs"))}
          <Select
            id="b-completion"
            label={t("workflowsP5.builder.completion")}
            value={d.completionRule}
            allowNone={t("workflowsP5.builder.notSet")}
            options={optionsOf(PROCEDURE_COMPLETION_RULES, "workflowsP5.completionRule")}
            onChange={(v) => set({ completionRule: v })}
          />
          {pair("completionDescription", t("workflowsP5.builder.description"))}
          {pair("exceptions", t("workflowsP5.builder.exceptions"))}
        </fieldset>
        <fieldset data-builder="inputs">
          <legend>{t("workflowsP5.builder.inputsTitle")}</legend>
          {d.inputs.map((f, i) => (
            <div key={i} className="card form--inset" data-input-row={i}>
              <div className="grid grid--3">
                <TextInput
                  label={`${t("workflowsP5.builder.inputKey")} ${i + 1}`}
                  ltr
                  value={f.key}
                  onChange={(v) => setInput(i, { key: v })}
                />
                <Select
                  id={`b-input-type-${i}`}
                  label={`${t("workflowsP5.builder.fieldType")} ${i + 1}`}
                  value={f.fieldType}
                  options={optionsOf(FIELD_TYPES, "workflowsP5.fieldType")}
                  onChange={(v) => setInput(i, { fieldType: v })}
                />
                <Check
                  id={`b-input-required-${i}`}
                  label={`${t("workflowsP5.builder.required")} ${i + 1}`}
                  checked={f.required}
                  onChange={(v) => setInput(i, { required: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.labelEn")} ${i + 1}`}
                  ltr
                  value={f.labelEn}
                  onChange={(v) => setInput(i, { labelEn: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.labelAr")} ${i + 1}`}
                  value={f.labelAr}
                  onChange={(v) => setInput(i, { labelAr: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.options")} ${i + 1}`}
                  value={f.options}
                  onChange={(v) => setInput(i, { options: v })}
                />
              </div>
              <button
                type="button"
                className="button button--link button--small"
                onClick={() => set({ inputs: d.inputs.filter((_, j) => j !== i) })}
              >
                {t("workflowsP5.builder.removeInput", { n: i + 1 })}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() =>
              set({
                inputs: [
                  ...d.inputs,
                  { key: "", fieldType: "text", labelEn: "", labelAr: "", required: false, options: "" },
                ],
              })
            }
          >
            {t("workflowsP5.builder.addInput")}
          </button>
        </fieldset>
        <fieldset data-builder="steps">
          <legend>{t("workflowsP5.builder.stepsTitle")}</legend>
          <p className="field__hint">{t("workflowsP5.builder.stepsHint")}</p>
          {d.steps.map((x, i) => (
            <div key={i} className="card form--inset" data-step-row={i}>
              <h3 className="small">{t("workflowsP5.builder.stepN", { n: i + 1 })}</h3>
              <div className="grid grid--3">
                <TextInput
                  label={`${t("workflowsP5.builder.stepKey")} ${i + 1}`}
                  ltr
                  value={x.stepKey}
                  onChange={(v) => setStep(i, { stepKey: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.procedures.ordinal")} ${i + 1}`}
                  ltr
                  value={x.ordinal}
                  onChange={(v) => setStep(i, { ordinal: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.parallelGroup")} ${i + 1}`}
                  ltr
                  value={x.parallelGroup}
                  onChange={(v) => setStep(i, { parallelGroup: v })}
                />
                <Select
                  id={`b-step-kind-${i}`}
                  label={`${t("workflowsP5.builder.stepKind")} ${i + 1}`}
                  value={x.stepKind}
                  options={optionsOf(PROCEDURE_STEP_KINDS, "workflowsP5.stepKind")}
                  onChange={(v) => setStep(i, { stepKind: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.labelEn")} ${i + 1}`}
                  ltr
                  value={x.nameEn}
                  onChange={(v) => setStep(i, { nameEn: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.labelAr")} ${i + 1}`}
                  value={x.nameAr}
                  onChange={(v) => setStep(i, { nameAr: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.responsibleRole")} ${i + 1}`}
                  ltr
                  value={x.responsibleRoleCode}
                  onChange={(v) => setStep(i, { responsibleRoleCode: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.approverRole")} ${i + 1}`}
                  ltr
                  value={x.approvalRoleCode}
                  onChange={(v) => setStep(i, { approvalRoleCode: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.slaDays")} ${i + 1}`}
                  ltr
                  value={x.slaWorkingDays}
                  onChange={(v) => setStep(i, { slaWorkingDays: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.conditionInput")} ${i + 1}`}
                  ltr
                  value={x.conditionInputKey}
                  onChange={(v) => setStep(i, { conditionInputKey: v })}
                />
                <Select
                  id={`b-step-op-${i}`}
                  label={`${t("workflowsP5.builder.conditionOperator")} ${i + 1}`}
                  value={x.conditionOperator}
                  allowNone={t("workflowsP5.builder.notSet")}
                  options={PROCEDURE_CONDITION_OPERATORS.map((o) => ({
                    value: o,
                    label: t(`workflowsP5.operator.${o}`),
                  }))}
                  onChange={(v) => setStep(i, { conditionOperator: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.conditionValue")} ${i + 1}`}
                  ltr
                  value={x.conditionValue}
                  onChange={(v) => setStep(i, { conditionValue: v })}
                />
                <TextInput
                  label={`${t("workflowsP5.builder.requiredInputs")} ${i + 1}`}
                  ltr
                  value={x.requiredInputKeys}
                  onChange={(v) => setStep(i, { requiredInputKeys: v })}
                />
                <Select
                  id={`b-step-output-${i}`}
                  label={`${t("workflowsP5.builder.output")} ${i + 1}`}
                  value={x.outputRecordType}
                  allowNone={t("workflowsP5.none")}
                  options={optionsOf(PROCEDURE_OUTPUT_RECORD_TYPES, "workflowsP5.recordType")}
                  onChange={(v) => setStep(i, { outputRecordType: v })}
                />
                <Select
                  id={`b-step-output-mode-${i}`}
                  label={`${t("workflowsP5.builder.outputMode")} ${i + 1}`}
                  value={x.outputMode}
                  allowNone={t("workflowsP5.builder.notSet")}
                  options={optionsOf(PROCEDURE_OUTPUT_MODES, "workflowsP5.outputMode")}
                  onChange={(v) => setStep(i, { outputMode: v })}
                />
                <Check
                  id={`b-step-evidence-${i}`}
                  label={`${t("workflowsP5.builder.evidenceRequired")} ${i + 1}`}
                  checked={x.evidenceRequired}
                  onChange={(v) => setStep(i, { evidenceRequired: v })}
                />
                <Check
                  id={`b-step-skippable-${i}`}
                  label={`${t("workflowsP5.builder.skippable")} ${i + 1}`}
                  checked={x.skippable}
                  onChange={(v) => setStep(i, { skippable: v })}
                />
              </div>
              <button
                type="button"
                className="button button--link button--small"
                onClick={() => set({ steps: d.steps.filter((_, j) => j !== i) })}
              >
                {t("workflowsP5.builder.removeStep", { n: i + 1 })}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() => set({ steps: [...d.steps, emptyStep(d.steps.length + 1)] })}
          >
            {t("workflowsP5.builder.addStep")}
          </button>
        </fieldset>
        <div className="form__actions">
          <button type="button" className="button button--secondary" onClick={() => void validate()}>
            {t("workflowsP5.builder.validate")}
          </button>
          <button type="submit" className="button button--primary" disabled={runner.busy}>
            {t("workflowsP5.builder.save")}
          </button>
          <button type="button" className="button button--link" onClick={onClose}>
            {t("workflowsP5.close")}
          </button>
        </div>
      </form>
      <ValidationReport report={report} error={validateError} />
    </Section>
  );
}

/** Every finding of a validation, translated by its code, with the pointer to the part of the body it concerns. */
function ValidationReport({ report, error }: { report: ProcedureValidationReport | null; error: unknown }) {
  const { t } = useTranslation();
  if (error) return <FormAlert error={error} namespaces={FED_NS} />;
  if (!report) return null;
  if (report.valid)
    return (
      <p className="banner banner--info" role="status" data-validation="valid">
        {t("workflowsP5.builder.valid")}
      </p>
    );
  return (
    <div className="banner banner--error" role="status" data-validation="invalid">
      <p>{t("workflowsP5.builder.invalid", { count: report.findings.length })}</p>
      <ul>
        {report.findings.map((f, i) => (
          <li key={i} data-finding={f.code}>
            {t(problemKey(f.code), { defaultValue: f.message })}{" "}
            <bdi dir="ltr" className="code small">
              {f.pointer}
            </bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RemoveSection({ code, draftVersion }: { code: string; draftVersion: ConfigVersion }) {
  const { t } = useTranslation();
  const refresh = useStudioRefresh();
  const runner = useRunner(refresh);
  return (
    <Section id="remove" title={t("workflowsP5.builder.removeTitle")} intro={t("workflowsP5.builder.removeIntro")}>
      {runner.alert}
      <button
        type="button"
        className="button button--danger"
        disabled={runner.busy}
        onClick={() =>
          void runner.run(p5Paths.removeProcedureDefinition(draftVersion.id, code), { ifMatch: draftVersion.version })
        }
      >
        {t("workflowsP5.builder.remove")}
      </button>
    </Section>
  );
}
