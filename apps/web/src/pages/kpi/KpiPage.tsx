// Strategy and KPIs > KPI (T-DG4-FE-B; p4-work-split §A.5; ADR-0027 §1, §2, §4, §5, §7, §10; ADR-0028 §5, §6).
// SYNTHETIC data only.
//  - The RAG panel (REQ-S07-008): displayed RAG plus the SEVEN elements: actual, expected to date, final target,
//    variance, trend, data freshness and the rule explanation, which names the threshold used (configured version N,
//    or the default rule) and the trajectory version. An override in force shows the calculated RAG beside it.
//  - Versions (draft → active; business approval when the policy asks for it), RAG thresholds (versioned), target
//    trajectories (draft → business approval by someone other than the author), manual RAG overrides (reason,
//    evidence and expiry; revoke), and the calculation runs that touched this KPI.
//  - Unknown, Stale and Not computable are grey and labelled, never 0 and never green (REQ-S07-006).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { measureDecimal } from "@mth/shared/schemas";
import { useGovernanceParties, useP4Refresh } from "../../api/p4.ts";
import { useLocale } from "../../app/locale.ts";
import { Icon } from "../../components/Icon.tsx";
import { RegisterTable, type RegisterColumn } from "../../components/RegisterTable.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace, WorkspaceFrame } from "../../components/Workspace.tsx";
import { formatDateTime, formatDecimal, zonedLocalToUtcIso } from "../../lib/format.ts";
import {
  BusinessApprovalNote,
  P4FormDialog,
  textOf,
  useUserNames,
  type P4FieldSpec,
  type P4Values,
} from "../my-work/p4ui.tsx";
import {
  kpiPaths,
  useCalculationRuns,
  useEvidenceOptions,
  useKpiDictionary,
  useKpiDictionaryEntry,
  useKpiStatus,
  useKpiThresholds,
  useKpiTrajectories,
  useKpiVersions,
  useRagOverrides,
  usePeriodChoices,
  type CalculationRun,
  type KpiDictionaryEntry,
  type KpiRagThreshold,
  type KpiStatus,
  type KpiVersion,
  type RagOverride,
  type TargetTrajectory,
} from "./api.ts";
import {
  BusinessDate,
  ConfirmActionDialog,
  formatKpiValue,
  formatThreshold,
  KpiSubNav,
  KpiValue,
  NS,
  RagChip,
  RecordChip,
  reasonText,
  times100,
  toStoredValue,
  ValueState,
  type UnitKind,
} from "./ui.tsx";

export function KpiPage() {
  const { t } = useTranslation();
  return (
    <WorkspaceFrame
      tab="define"
      title={t("kpiP4.kpi.title")}
      subtitle={t("kpiP4.kpi.intro")}
      writePermissions={[
        "kpi_version.edit",
        "kpi_version.activate",
        "kpi_threshold.configure",
        "target_trajectory.edit",
        "kpi_target.approve",
        "rag.override",
      ]}
    >
      <KpiBody />
    </WorkspaceFrame>
  );
}

function KpiBody() {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const { kpiId = "" } = useParams();
  const entry = useKpiDictionaryEntry(ws.tid, kpiId);
  return (
    <>
      <KpiSubNav tid={ws.tid} kpiId={kpiId} />
      <QueryState query={entry}>
        {(e) => (
          <>
            <h2 className="small-heading" data-kpi-name={e.definition.name}>
              {e.definition.name}
            </h2>
            {e.missingForUse.length > 0 ? (
              <div className="banner banner--warning" role="note" data-state="missing-for-use">
                <p>
                  <Icon name="alert" /> {t("kpiP4.kpi.missingIntro")}
                </p>
                <ul>
                  {e.missingForUse.map((m) => (
                    <li key={m}>{t(`kpiP4.missing.${m}`)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <RagPanel kpiId={kpiId} />
            <p>
              <Link className="button button--primary" to={`/transformations/${ws.tid}/kpis/${kpiId}/actuals`}>
                <Icon name="pencil" /> {t("kpiP4.update.start")}
              </Link>
            </p>
            <Versions entry={e} />
            <Thresholds kpiId={kpiId} />
            <Trajectories entry={e} />
            <Overrides entry={e} />
            <Runs kpiId={kpiId} />
          </>
        )}
      </QueryState>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ RAG panel

/** The variance with its change label: percentage points for a percentage KPI, else the unit (and the ratio in %). */
function Variance({ s }: { s: KpiStatus }) {
  const { t } = useTranslation();
  const locale = useLocale();
  if (s.variance === null) return <ValueState status="unknown" reason={s.actualReason ?? s.expectedReason} />;
  const sign = s.variance.trim().startsWith("-") ? "" : "+";
  if (s.changeLabel === "pp") {
    const pp = formatDecimal(times100(s.variance), locale, { maxFractionDigits: 2 });
    return (
      <bdi dir="ltr" data-change-label="pp">
        {sign}
        {pp} {t("kpiP4.panel.pp")}
      </bdi>
    );
  }
  const inUnit = formatKpiValue(s.variance, s.unitKind, s.currency, locale);
  const ratio =
    s.varianceRatio === null ? null : formatDecimal(times100(s.varianceRatio), locale, { maxFractionDigits: 2 });
  return (
    <span data-change-label={s.changeLabel}>
      <bdi dir="ltr">
        {sign}
        {inUnit}
      </bdi>
      {ratio !== null ? (
        <>
          {" "}
          <bdi dir="ltr">
            ({s.varianceRatio!.trim().startsWith("-") ? "" : "+"}
            {ratio} %)
          </bdi>
        </>
      ) : null}
    </span>
  );
}

/** The plain-language rule explanation: what decided the RAG, which threshold (and version) and which trajectory. */
export function RuleExplanation({ s }: { s: KpiStatus }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const e = s.explanation;
  const keyPart = e.key.replace(/^kpi\.rag\./, "");
  const why = reasonText(t, typeof e.params["reason"] === "string" ? (e.params["reason"] as string) : null);
  const amber = formatThreshold(e.amberThreshold, e.toleranceMode, locale) ?? t("common.value.unknown");
  const red = formatThreshold(e.redThreshold, e.toleranceMode, locale) ?? t("common.value.unknown");
  const mode = e.toleranceMode ? t(`kpiP4.threshold.modes.${e.toleranceMode}`) : t("common.value.unknown");
  return (
    <div className="block" data-explanation={e.key} data-threshold-source={e.thresholdSource}>
      <p>
        {t(`kpiP4.explanation.${keyPart}`, { defaultValue: t("kpiP4.explanation.other") })}
        {why ? ` ${t("kpiP4.explanation.reason", { reason: why })}` : ""}
      </p>
      <p data-threshold-version={e.thresholdVersion ?? ""}>
        {e.thresholdSource === "configured"
          ? t("kpiP4.explanation.thresholdConfigured", { version: e.thresholdVersion ?? "?", amber, red, mode })
          : e.thresholdSource === "default"
            ? t("kpiP4.explanation.thresholdDefault", { amber, red, mode })
            : t("kpiP4.explanation.thresholdNone")}
      </p>
      <p className="small muted">
        {e.trajectoryVersion !== null
          ? t("kpiP4.explanation.trajectory", { version: e.trajectoryVersion })
          : t("kpiP4.explanation.noTrajectory")}
      </p>
    </div>
  );
}

function RagPanel({ kpiId }: { kpiId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const status = useKpiStatus(ws.tid, kpiId);
  const names = useUserNames(status.data?.override ? [status.data.override.createdBy] : []);
  return (
    <Section id="rag-panel" title={t("kpiP4.panel.title")} intro={t("kpiP4.panel.intro")}>
      <QueryState query={status}>
        {(s) => (
          <div data-rag-panel={s.kpiDefinitionId}>
            <p className="chip-row">
              <RagChip rag={s.displayedRag} label={t("kpiP4.field.displayedRag")} />
              {s.periodLabel ? (
                <span>
                  {t("kpiP4.field.period")}:{" "}
                  <bdi dir="ltr" className="code">
                    {s.periodLabel}
                  </bdi>
                </span>
              ) : (
                <span>
                  {t("kpiP4.field.period")}: <ValueState status="unknown" />
                </span>
              )}
            </p>
            {s.override ? (
              <p className="banner banner--info" role="note" data-state="override-in-force">
                <Icon name="info" />{" "}
                {t("kpiP4.panel.overrideNote", {
                  rag: t(`kpiP4.rag.${s.override.rag}`),
                  calculated: t(`kpiP4.rag.${s.calculatedRag}`),
                  until: formatDateTime(s.override.expiresAt, locale, ws.tr.timezone) ?? "",
                  by: names(s.override.createdBy),
                })}{" "}
                <span className="block">
                  {t("kpiP4.override.reason")}: {s.override.reason}
                </span>
              </p>
            ) : (
              <p className="small muted">
                {t("kpiP4.panel.calculatedIs")} <RagChip rag={s.calculatedRag} />
              </p>
            )}
            <dl className="details">
              <div data-element="actual">
                <dt>{t("kpiP4.field.actual")}</dt>
                <dd>
                  <KpiValue
                    value={s.actual}
                    status={s.actualStatus}
                    reason={s.actualReason}
                    unitKind={s.unitKind}
                    currency={s.currency}
                  />
                </dd>
              </div>
              <div data-element="expected">
                <dt>{t("kpiP4.field.expectedToDate")}</dt>
                <dd>
                  <KpiValue
                    value={s.expectedToDate}
                    status={s.expectedToDate === null ? "unknown" : "ok"}
                    reason={s.expectedReason}
                    unitKind={s.unitKind}
                    currency={s.currency}
                  />
                </dd>
              </div>
              <div data-element="target">
                <dt>{t("kpiP4.field.finalTarget")}</dt>
                <dd>
                  <KpiValue
                    value={s.finalTarget}
                    status={s.finalTarget === null ? "unknown" : "ok"}
                    unitKind={s.unitKind}
                    currency={s.currency}
                  />
                  {s.finalTargetDate ? (
                    <span className="block small muted">
                      {t("kpiP4.field.by")} <BusinessDate date={s.finalTargetDate} />
                    </span>
                  ) : null}
                </dd>
              </div>
              <div data-element="variance">
                <dt>{t("kpiP4.field.variance")}</dt>
                <dd>
                  <Variance s={s} />
                </dd>
              </div>
              <div data-element="trend">
                <dt>{t("kpiP4.field.trend")}</dt>
                <dd>
                  {s.trend === "unknown" || s.trend === "not_comparable" ? (
                    <span className="status-chip status-chip--unknown" data-trend={s.trend}>
                      <Icon name="question" /> {t(`kpiP4.trend.${s.trend}`)}
                    </span>
                  ) : (
                    <span data-trend={s.trend}>{t(`kpiP4.trend.${s.trend}`)}</span>
                  )}
                </dd>
              </div>
              <div data-element="freshness">
                <dt>{t("kpiP4.field.freshness")}</dt>
                <dd>
                  {s.freshness.status === "fresh" ? (
                    <span data-freshness="fresh">{t("kpiP4.freshness.fresh")}</span>
                  ) : (
                    <ValueState status={s.freshness.status} />
                  )}
                  <span className="block small muted">
                    {t("kpiP4.field.dataAsOf")}: <BusinessDate date={s.freshness.dataAsOf} />
                    {s.freshness.staleAfterDays !== null
                      ? ` · ${t("kpiP4.field.staleAfter", { n: s.freshness.staleAfterDays })}`
                      : ""}
                  </span>
                </dd>
              </div>
              <div data-element="explanation">
                <dt>{t("kpiP4.field.explanation")}</dt>
                <dd>
                  <RuleExplanation s={s} />
                </dd>
              </div>
            </dl>
          </div>
        )}
      </QueryState>
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ versions

const MEASURE_TYPES = ["higher_is_better", "lower_is_better", "acceptable_band", "binary_milestone"] as const;
const VALUE_NATURES = ["flow", "stock", "ratio", "milestone"] as const;
const SCOPE_KINDS = ["transformation", "business_unit", "initiative"] as const;
const AGGREGATIONS = ["sum", "last_value", "weighted_ratio", "custom_formula", "none"] as const;

/** A decimal typed by a person, checked with the API's own measure shape; percent inputs become fractions. */
function decimalField(
  v: P4Values,
  name: string,
  unitKind: UnitKind | string,
  errors: Record<string, string>,
  asPercent = true,
): string | null {
  const raw = typeof v[name] === "string" ? (v[name] as string).trim() : "";
  if (raw === "") return null;
  if (!measureDecimal.safeParse(raw).success) {
    errors[name] = "validation.decimal";
    return null;
  }
  const stored = asPercent ? toStoredValue(raw, unitKind) : raw;
  if (!measureDecimal.safeParse(stored).success) {
    errors[name] = "validation.decimal";
    return null;
  }
  return stored;
}

function versionInitial(v: KpiVersion | null, unitKind: string): P4Values {
  const show = (x: string | null) => (x === null ? "" : unitKind === "percentage" ? (times100(x) ?? "") : x);
  if (!v)
    return {
      measureType: "higher_is_better",
      valueNature: "flow",
      entryScopeKind: "transformation",
      aggregationRule: "sum",
      calculationMethod: "entered",
      submissionRoute: "review",
      definitionApproval: "direct",
      staleAfterDays: "45",
      evidenceRequired: false,
    };
  return {
    measureType: v.measureType,
    valueNature: v.valueNature,
    entryScopeKind: v.entryScopeKind,
    aggregationRule: v.aggregationRule ?? "",
    calculationMethod: v.calculationMethod,
    unitLabel: v.unitLabel ?? "",
    numeratorLabel: v.numeratorLabel ?? "",
    denominatorLabel: v.denominatorLabel ?? "",
    calculationDescription: v.calculationDescription ?? "",
    baselineValue: show(v.baselineValue),
    baselineDate: v.baselineDate ?? "",
    targetValue: show(v.targetValue),
    targetDate: v.targetDate ?? "",
    bandLower: show(v.bandLower),
    bandUpper: show(v.bandUpper),
    milestoneDueDate: v.milestoneDueDate ?? "",
    staleAfterDays: String(v.dataQuality.staleAfterDays),
    evidenceRequired: v.dataQuality.evidenceRequired,
    submissionRoute: v.submissionRoute,
    reviewerPartyCode: v.reviewerPartyCode ?? "",
    definitionApproval: v.definitionApproval,
    changeReason: "",
  };
}

function Versions({ entry }: { entry: KpiDictionaryEntry }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const kpiId = entry.definition.id;
  const unitKind = entry.definition.unitKind ?? "other";
  const versions = useKpiVersions(ws.tid, kpiId);
  const dictionary = useKpiDictionary(ws.tid);
  const parties = useGovernanceParties();
  const refresh = useP4Refresh(ws.tid);
  const canEdit = ws.can("kpi_version.edit");
  const canActivate = ws.can("kpi_version.activate");
  const [form, setForm] = useState<{ version: KpiVersion | null } | null>(null);
  const [activating, setActivating] = useState<KpiVersion | null>(null);
  const [withdrawing, setWithdrawing] = useState<KpiVersion | null>(null);
  const [requesting, setRequesting] = useState<KpiVersion | null>(null);
  const hasVersion = (versions.data ?? []).length > 0;
  const pct = unitKind === "percentage";
  const otherKpis = (dictionary.data ?? []).filter((d) => d.definition.id !== kpiId);

  const option = <T extends string>(group: string, values: readonly T[]) =>
    values.map((x) => ({ value: x, label: t(`kpiP4.${group}.${x}`) }));
  const formulaFields: P4FieldSpec[] = [
    {
      name: "calculationMethod",
      label: t("kpiP4.version.calculationMethod"),
      kind: "select",
      required: true,
      options: [
        { value: "entered", label: t("kpiP4.version.methods.entered") },
        { value: "formula", label: t("kpiP4.version.methods.formula") },
      ],
    },
    {
      name: "formulaExpression",
      label: t("kpiP4.version.formulaExpression"),
      kind: "text",
      required: true,
      ltr: true,
      max: 2000,
      hint: t("kpiP4.version.formulaHint"),
      when: (v) => v["calculationMethod"] === "formula",
    },
    ...[1, 2, 3].flatMap((i): P4FieldSpec[] => [
      {
        name: `input${i}Var`,
        label: t("kpiP4.version.inputVariable", { n: i }),
        kind: "text",
        ltr: true,
        max: 48,
        when: (v) => v["calculationMethod"] === "formula",
      },
      {
        name: `input${i}Kpi`,
        label: t("kpiP4.version.inputKpi", { n: i }),
        kind: "select",
        options: otherKpis.map((d) => ({ value: d.definition.id, label: d.definition.name })),
        when: (v) => v["calculationMethod"] === "formula",
      },
    ]),
  ];
  const fields = (isEdit: boolean): P4FieldSpec[] => [
    {
      name: "measureType",
      label: t("kpiP4.version.measureType"),
      kind: "select",
      required: true,
      options: option("measureType", MEASURE_TYPES),
    },
    {
      name: "valueNature",
      label: t("kpiP4.version.valueNature"),
      kind: "select",
      required: true,
      options: option("valueNature", VALUE_NATURES),
    },
    {
      name: "entryScopeKind",
      label: t("kpiP4.version.entryScopeKind"),
      kind: "select",
      required: true,
      options: option("scopeKind", SCOPE_KINDS),
    },
    {
      name: "aggregationRule",
      label: t("kpiP4.version.aggregationRule"),
      kind: "select",
      hint: t("kpiP4.version.aggregationHint"),
      options: option("aggregation", AGGREGATIONS),
    },
    ...(isEdit ? [] : formulaFields),
    { name: "unitLabel", label: t("kpi.definition.unitLabel"), kind: "text", max: 50 },
    {
      name: "numeratorLabel",
      label: t("kpiP4.version.numeratorLabel"),
      kind: "text",
      required: true,
      max: 200,
      when: (v) => v["valueNature"] === "ratio",
    },
    {
      name: "denominatorLabel",
      label: t("kpiP4.version.denominatorLabel"),
      kind: "text",
      required: true,
      max: 200,
      when: (v) => v["valueNature"] === "ratio",
    },
    { name: "calculationDescription", label: t("kpiP4.version.calculationDescription"), kind: "textarea", max: 4000 },
    {
      name: "baselineValue",
      label: t("kpiP4.version.baselineValue"),
      kind: "text",
      ltr: true,
      hint: pct ? t("kpiP4.version.percentHint") : t("kpi.decimalHint"),
    },
    { name: "baselineDate", label: t("kpiP4.version.baselineDate"), kind: "date" },
    {
      name: "targetValue",
      label: t("kpiP4.version.targetValue"),
      kind: "text",
      ltr: true,
      hint: pct ? t("kpiP4.version.percentHint") : t("kpi.decimalHint"),
      when: (v) => v["measureType"] !== "binary_milestone",
    },
    {
      name: "targetDate",
      label: t("kpiP4.version.targetDate"),
      kind: "date",
      when: (v) => v["measureType"] !== "binary_milestone",
    },
    {
      name: "bandLower",
      label: t("kpiP4.version.bandLower"),
      kind: "text",
      ltr: true,
      required: true,
      when: (v) => v["measureType"] === "acceptable_band",
    },
    {
      name: "bandUpper",
      label: t("kpiP4.version.bandUpper"),
      kind: "text",
      ltr: true,
      required: true,
      when: (v) => v["measureType"] === "acceptable_band",
    },
    {
      name: "milestoneDueDate",
      label: t("kpiP4.version.milestoneDueDate"),
      kind: "date",
      required: true,
      when: (v) => v["measureType"] === "binary_milestone",
    },
    {
      name: "staleAfterDays",
      label: t("kpiP4.version.staleAfterDays"),
      kind: "number",
      required: true,
      min: 1,
      max: 3660,
    },
    { name: "evidenceRequired", label: t("kpiP4.version.evidenceRequired"), kind: "checkbox" },
    {
      name: "submissionRoute",
      label: t("kpiP4.version.submissionRoute"),
      kind: "select",
      required: true,
      options: [
        { value: "review", label: t("kpiP4.version.routes.review") },
        { value: "direct_accept", label: t("kpiP4.version.routes.direct_accept") },
      ],
    },
    {
      name: "reviewerPartyCode",
      label: t("kpiP4.version.reviewer"),
      kind: "select",
      required: true,
      options: (parties.data ?? []).map((p) => ({
        value: p.code,
        label: `${locale === "ar" ? p.labelAr : p.labelEn} (${p.code})`,
      })),
      when: (v) => v["submissionRoute"] === "review",
    },
    {
      name: "definitionApproval",
      label: t("kpiP4.version.definitionApproval"),
      kind: "select",
      required: true,
      options: [
        { value: "direct", label: t("kpiP4.version.approvals.direct") },
        { value: "business_approval", label: t("kpiP4.version.approvals.business_approval") },
      ],
    },
    {
      name: "changeReason",
      label: t("kpiP4.version.changeReason"),
      kind: "textarea",
      required: hasVersion,
      min: 3,
      max: 2000,
      hint: t("kpiP4.version.changeReasonHint"),
    },
  ];

  const toBody = (isEdit: boolean) => (v: P4Values) => {
    const errors: Record<string, string> = {};
    const dec = (name: string) => decimalField(v, name, unitKind, errors);
    const band = v["measureType"] === "acceptable_band";
    const milestone = v["measureType"] === "binary_milestone";
    const ratio = v["valueNature"] === "ratio";
    const body: Record<string, unknown> = {
      measureType: v["measureType"],
      valueNature: v["valueNature"],
      entryScopeKind: v["entryScopeKind"],
      aggregationRule: v["aggregationRule"] ? v["aggregationRule"] : null,
      unitLabel: textOf(v["unitLabel"]) ?? null,
      numeratorLabel: ratio ? (textOf(v["numeratorLabel"]) ?? null) : null,
      denominatorLabel: ratio ? (textOf(v["denominatorLabel"]) ?? null) : null,
      calculationDescription: textOf(v["calculationDescription"]) ?? null,
      baselineValue: dec("baselineValue"),
      baselineDate: v["baselineDate"] ? v["baselineDate"] : null,
      targetValue: milestone ? null : dec("targetValue"),
      targetDate: !milestone && v["targetDate"] ? v["targetDate"] : null,
      bandLower: band ? dec("bandLower") : null,
      bandUpper: band ? dec("bandUpper") : null,
      milestoneDueDate: milestone && v["milestoneDueDate"] ? v["milestoneDueDate"] : null,
      dataQuality: {
        staleAfterDays: Number(v["staleAfterDays"]),
        validMin: null,
        validMax: null,
        evidenceRequired: v["evidenceRequired"] === true,
      },
      submissionRoute: v["submissionRoute"],
      reviewerPartyCode: v["submissionRoute"] === "review" ? v["reviewerPartyCode"] || null : null,
      definitionApproval: v["definitionApproval"],
      changeReason: textOf(v["changeReason"]) ?? null,
    };
    if (!isEdit) {
      body["calculationMethod"] = v["calculationMethod"];
      if (v["calculationMethod"] === "formula") {
        body["formulaExpression"] = textOf(v["formulaExpression"]) ?? null;
        body["formulaInputs"] = [1, 2, 3]
          .filter((i) => textOf(v[`input${i}Var`]) && v[`input${i}Kpi`])
          .map((i) => ({
            variableName: String(v[`input${i}Var`]).trim(),
            sourceKpiDefinitionId: v[`input${i}Kpi`],
            inputBasis: "period",
          }));
      }
    }
    return Object.keys(errors).length > 0 ? { fieldErrors: errors } : body;
  };

  const columns: RegisterColumn<KpiVersion>[] = [
    {
      id: "no",
      header: t("kpiP4.version.no"),
      rowHeader: true,
      hideable: false,
      cell: (v) => <span data-version-no={v.versionNo}>{t("kpiP4.version.label", { n: v.versionNo })}</span>,
      sortValue: (v) => v.versionNo,
    },
    {
      id: "status",
      header: t("kpiP4.field.status"),
      cell: (v) => <RecordChip group="version" status={v.status} />,
      sortValue: (v) => v.status,
    },
    {
      id: "measure",
      header: t("kpiP4.version.measureType"),
      cell: (v) => (
        <span className="block">
          {t(`kpiP4.measureType.${v.measureType}`)}
          <span className="block small muted">{t(`kpiP4.valueNature.${v.valueNature}`)}</span>
        </span>
      ),
    },
    {
      id: "aggregation",
      header: t("kpiP4.version.aggregationRule"),
      cell: (v) =>
        v.aggregationRule ? (
          t(`kpiP4.aggregation.${v.aggregationRule}`)
        ) : (
          <span className="status-chip status-chip--unknown status-chip--wrap">
            <Icon name="alert" /> <span>{t("kpiP4.aggregation.missing")}</span>
          </span>
        ),
    },
    {
      id: "target",
      header: t("kpiP4.version.targetValue"),
      cell: (v) =>
        v.targetValue === null ? (
          <ValueState status="unknown" />
        ) : (
          <bdi dir="ltr">{formatKpiValue(v.targetValue, v.unitKind, v.currency, locale)}</bdi>
        ),
    },
    {
      id: "route",
      header: t("kpiP4.version.submissionRoute"),
      cell: (v) =>
        `${t(`kpiP4.version.routes.${v.submissionRoute}`)}${v.reviewerPartyCode ? ` (${v.reviewerPartyCode})` : ""}`,
    },
    {
      id: "approval",
      header: t("kpiP4.version.definitionApproval"),
      cell: (v) => t(`kpiP4.version.approvals.${v.definitionApproval}`),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (v) =>
        v.status !== "draft" || !(canEdit || canActivate) ? (
          <span className="muted small">{v.status === "draft" ? t("common.readOnly") : "—"}</span>
        ) : (
          <span className="row-actions">
            {canEdit ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="edit-version"
                onClick={() => setForm({ version: v })}
              >
                {t("common.action.edit")}
                <span className="visually-hidden">: {t("kpiP4.version.label", { n: v.versionNo })}</span>
              </button>
            ) : null}
            {canActivate ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="activate-version"
                onClick={() => setActivating(v)}
              >
                {t("kpiP4.version.activate")}
                <span className="visually-hidden">: {t("kpiP4.version.label", { n: v.versionNo })}</span>
              </button>
            ) : null}
            {canEdit && v.definitionApproval === "business_approval" ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="request-approval"
                onClick={() => setRequesting(v)}
              >
                {t("kpiP4.version.requestApproval")}
                <span className="visually-hidden">: {t("kpiP4.version.label", { n: v.versionNo })}</span>
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="withdraw-version"
                onClick={() => setWithdrawing(v)}
              >
                {t("kpiP4.action.withdraw")}
                <span className="visually-hidden">: {t("kpiP4.version.label", { n: v.versionNo })}</span>
              </button>
            ) : null}
          </span>
        ),
    },
  ];

  return (
    <Section
      id="kpi-versions"
      title={t("kpiP4.version.title")}
      intro={t("kpiP4.version.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--secondary"
            data-action="new-version"
            onClick={() => setForm({ version: null })}
          >
            <Icon name="plus" /> {t("kpiP4.version.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={versions}>
        {(rows) => (
          <RegisterTable
            id="kpi-versions"
            caption={t("kpiP4.version.title")}
            rows={rows}
            columns={columns}
            getRowId={(v) => v.id}
            emptyTitle={t("kpiP4.version.empty")}
            emptyBody={t("kpiP4.version.emptyBody")}
            defaultSort={{ id: "no", dir: "desc" }}
          />
        )}
      </QueryState>
      {form ? (
        <P4FormDialog
          title={form.version ? t("kpiP4.version.editTitle", { n: form.version.versionNo }) : t("kpiP4.version.add")}
          namespaces={NS}
          method={form.version ? "PATCH" : "POST"}
          url={form.version ? kpiPaths.version(ws.tid, form.version.id) : kpiPaths.versions(ws.tid, kpiId)}
          {...(form.version ? { version: form.version.version } : {})}
          initial={versionInitial(form.version, unitKind)}
          fields={fields(form.version !== null)}
          submitLabel={form.version ? t("common.action.save") : t("kpiP4.version.createDraft")}
          note={<p className="small muted">{t("kpiP4.version.draftNote")}</p>}
          toBody={toBody(form.version !== null)}
          onDone={() => refresh()}
          onClose={() => setForm(null)}
        />
      ) : null}
      {activating ? (
        <ConfirmActionDialog
          title={t("kpiP4.version.activateTitle", { n: activating.versionNo })}
          body={t("kpiP4.version.activateBody")}
          confirmLabel={t("kpiP4.version.activate")}
          url={kpiPaths.activateVersion(ws.tid, activating.id)}
          version={activating.version}
          onDone={() => refresh()}
          onClose={() => setActivating(null)}
        />
      ) : null}
      {requesting ? (
        <P4FormDialog
          title={t("kpiP4.version.requestApprovalTitle", { n: requesting.versionNo })}
          namespaces={NS}
          url={kpiPaths.versionApproval(ws.tid, requesting.id)}
          version={requesting.version}
          note={<BusinessApprovalNote body={t("kpiP4.version.requestApprovalNote")} />}
          fields={[{ name: "requestNote", label: t("kpiP4.version.requestNote"), kind: "textarea", max: 4000 }]}
          submitLabel={t("kpiP4.version.requestApproval")}
          toBody={(v) => ({ requestNote: textOf(v["requestNote"]) ?? null })}
          onDone={() => refresh()}
          onClose={() => setRequesting(null)}
        />
      ) : null}
      {withdrawing ? (
        <ReasonForm
          title={t("kpiP4.version.withdrawTitle", { n: withdrawing.versionNo })}
          url={kpiPaths.withdrawVersion(ws.tid, withdrawing.id)}
          version={withdrawing.version}
          submitLabel={t("kpiP4.action.withdraw")}
          onDone={() => refresh()}
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
    </Section>
  );
}

/** A reason-only action (withdraw a version or a trajectory, revoke an override): ReasonRequest, 3–1000 characters. */
export function ReasonForm({
  title,
  url,
  version,
  submitLabel,
  onDone,
  onClose,
}: {
  title: string;
  url: string;
  version: number;
  submitLabel: string;
  onDone: () => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <P4FormDialog
      title={title}
      namespaces={NS}
      url={url}
      version={version}
      danger
      fields={[
        { name: "reason", label: t("kpiP4.action.reason"), kind: "textarea", required: true, min: 3, max: 1000 },
      ]}
      submitLabel={submitLabel}
      toBody={(v) => ({ reason: String(v["reason"]).trim() })}
      onDone={onDone}
      onClose={onClose}
    />
  );
}

// ------------------------------------------------------------------------------------------------ thresholds

function Thresholds({ kpiId }: { kpiId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const thresholds = useKpiThresholds(ws.tid, kpiId);
  const refresh = useP4Refresh(ws.tid);
  const canConfigure = ws.can("kpi_threshold.configure");
  const [creating, setCreating] = useState(false);
  const columns: RegisterColumn<KpiRagThreshold>[] = [
    {
      id: "no",
      header: t("kpiP4.version.no"),
      rowHeader: true,
      hideable: false,
      cell: (x) => t("kpiP4.version.label", { n: x.versionNo }),
      sortValue: (x) => x.versionNo,
    },
    { id: "status", header: t("kpiP4.field.status"), cell: (x) => <RecordChip group="threshold" status={x.status} /> },
    { id: "mode", header: t("kpiP4.threshold.mode"), cell: (x) => t(`kpiP4.threshold.modes.${x.toleranceMode}`) },
    {
      id: "amber",
      header: t("kpiP4.threshold.amber"),
      cell: (x) => <bdi dir="ltr">{formatThreshold(x.amberThreshold, x.toleranceMode, locale)}</bdi>,
    },
    {
      id: "red",
      header: t("kpiP4.threshold.red"),
      cell: (x) => <bdi dir="ltr">{formatThreshold(x.redThreshold, x.toleranceMode, locale)}</bdi>,
    },
    { id: "reason", header: t("kpiP4.action.reason"), cell: (x) => <span className="clamp">{x.reason}</span> },
    {
      id: "created",
      header: t("kpiP4.field.createdAt"),
      cell: (x) => formatDateTime(x.createdAt, locale, ws.tr.timezone),
    },
  ];
  return (
    <Section
      id="kpi-thresholds"
      title={t("kpiP4.threshold.title")}
      intro={t("kpiP4.threshold.intro")}
      actions={
        canConfigure ? (
          <button
            type="button"
            className="button button--secondary"
            data-action="new-threshold"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> {t("kpiP4.threshold.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={thresholds}>
        {(rows) => (
          <RegisterTable
            id="kpi-thresholds"
            caption={t("kpiP4.threshold.title")}
            rows={rows}
            columns={columns}
            getRowId={(x) => x.id}
            emptyTitle={t("kpiP4.threshold.empty")}
            emptyBody={t("kpiP4.threshold.emptyBody")}
            defaultSort={{ id: "no", dir: "desc" }}
          />
        )}
      </QueryState>
      {creating ? (
        <P4FormDialog
          title={t("kpiP4.threshold.add")}
          namespaces={NS}
          url={kpiPaths.thresholds(ws.tid, kpiId)}
          initial={{ toleranceMode: "relative" }}
          fields={[
            {
              name: "toleranceMode",
              label: t("kpiP4.threshold.mode"),
              kind: "select",
              required: true,
              options: [
                { value: "relative", label: t("kpiP4.threshold.modes.relative") },
                { value: "absolute", label: t("kpiP4.threshold.modes.absolute") },
              ],
            },
            {
              name: "amberThreshold",
              label: t("kpiP4.threshold.amber"),
              kind: "text",
              required: true,
              ltr: true,
              hint: t("kpiP4.threshold.valueHint"),
            },
            {
              name: "redThreshold",
              label: t("kpiP4.threshold.red"),
              kind: "text",
              required: true,
              ltr: true,
              hint: t("kpiP4.threshold.valueHint"),
            },
            { name: "reason", label: t("kpiP4.action.reason"), kind: "textarea", required: true, min: 3, max: 2000 },
          ]}
          submitLabel={t("kpiP4.threshold.create")}
          toBody={(v) => {
            const errors: Record<string, string> = {};
            const rel = v["toleranceMode"] === "relative";
            const amber = decimalField(v, "amberThreshold", rel ? "percentage" : "other", errors);
            const red = decimalField(v, "redThreshold", rel ? "percentage" : "other", errors);
            if (Object.keys(errors).length > 0) return { fieldErrors: errors };
            return {
              toleranceMode: v["toleranceMode"],
              amberThreshold: amber,
              redThreshold: red,
              reason: String(v["reason"]).trim(),
            };
          }}
          onDone={() => refresh()}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ trajectories

/** "YYYY-MM-DD value" per line → points; a line that does not parse is reported on the field. */
export function parsePoints(
  text: string,
  unitKind: string,
): { points: { pointDate: string; expectedValue: string }[] } | { error: string } {
  const points: { pointDate: string; expectedValue: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (s === "") continue;
    const m = /^(\d{4}-\d{2}-\d{2})[\s,;]+(-?\d+(?:\.\d+)?)$/.exec(s);
    if (!m) return { error: "validation.trajectory_point" };
    const stored = toStoredValue(m[2]!, unitKind);
    if (!measureDecimal.safeParse(stored).success) return { error: "validation.trajectory_point" };
    points.push({ pointDate: m[1]!, expectedValue: stored });
  }
  if (points.length === 0) return { error: "validation.required" };
  if (new Set(points.map((p) => p.pointDate)).size !== points.length)
    return { error: "validation.trajectory_point_dates_distinct" };
  return { points };
}

function Trajectories({ entry }: { entry: KpiDictionaryEntry }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const kpiId = entry.definition.id;
  const unitKind = entry.definition.unitKind ?? "other";
  const currency = entry.definition.currency;
  const trajectories = useKpiTrajectories(ws.tid, kpiId);
  const refresh = useP4Refresh(ws.tid);
  const canEdit = ws.can("target_trajectory.edit");
  const canApprove = ws.can("kpi_target.approve");
  const [creating, setCreating] = useState(false);
  const [approving, setApproving] = useState<TargetTrajectory | null>(null);
  const [withdrawing, setWithdrawing] = useState<TargetTrajectory | null>(null);
  const names = useUserNames((trajectories.data ?? []).flatMap((x) => [x.createdBy, x.approvedBy]));
  const columns: RegisterColumn<TargetTrajectory>[] = [
    {
      id: "no",
      header: t("kpiP4.version.no"),
      rowHeader: true,
      hideable: false,
      cell: (x) => t("kpiP4.version.label", { n: x.versionNo }),
      sortValue: (x) => x.versionNo,
    },
    { id: "status", header: t("kpiP4.field.status"), cell: (x) => <RecordChip group="trajectory" status={x.status} /> },
    { id: "scope", header: t("kpiP4.field.scope"), cell: (x) => t(`kpiP4.scopeKind.${x.scopeKind}`) },
    {
      id: "points",
      header: t("kpiP4.trajectory.points"),
      cell: (x) => (
        <ul className="plain-list small" data-points={x.points.length}>
          {x.points.map((p) => (
            <li key={p.pointDate}>
              <BusinessDate date={p.pointDate} />:{" "}
              <bdi dir="ltr">{formatKpiValue(p.expectedValue, unitKind, currency, locale)}</bdi>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "shape",
      header: t("kpiP4.trajectory.interpolation"),
      cell: (x) =>
        `${t(`kpiP4.trajectory.interpolations.${x.interpolation}`)} · ${t(`kpiP4.trajectory.bases.${x.basis}`)}`,
    },
    {
      id: "approved",
      header: t("kpiP4.trajectory.approvedBy"),
      cell: (x) =>
        x.approvedBy ? (
          <span className="block">
            {names(x.approvedBy)}
            <span className="block small muted">{formatDateTime(x.approvedAt, locale, ws.tr.timezone)}</span>
          </span>
        ) : (
          <span className="muted">{t("kpiP4.trajectory.notApproved")}</span>
        ),
    },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (x) =>
        x.status !== "draft" ? (
          "—"
        ) : (
          <span className="row-actions">
            {canApprove ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="approve-trajectory"
                onClick={() => setApproving(x)}
              >
                {t("kpiP4.trajectory.approve")}
                <span className="visually-hidden">: {t("kpiP4.version.label", { n: x.versionNo })}</span>
              </button>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                className="button button--link button--small"
                data-action="withdraw-trajectory"
                onClick={() => setWithdrawing(x)}
              >
                {t("kpiP4.action.withdraw")}
                <span className="visually-hidden">: {t("kpiP4.version.label", { n: x.versionNo })}</span>
              </button>
            ) : null}
            {!canApprove && !canEdit ? <span className="muted small">{t("common.readOnly")}</span> : null}
          </span>
        ),
    },
  ];
  return (
    <Section
      id="kpi-trajectories"
      title={t("kpiP4.trajectory.title")}
      intro={t("kpiP4.trajectory.intro")}
      actions={
        canEdit ? (
          <button
            type="button"
            className="button button--secondary"
            data-action="new-trajectory"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> {t("kpiP4.trajectory.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={trajectories}>
        {(rows) => (
          <RegisterTable
            id="kpi-trajectories"
            caption={t("kpiP4.trajectory.title")}
            rows={rows}
            columns={columns}
            getRowId={(x) => x.id}
            emptyTitle={t("kpiP4.trajectory.empty")}
            emptyBody={t("kpiP4.trajectory.emptyBody")}
            defaultSort={{ id: "no", dir: "desc" }}
          />
        )}
      </QueryState>
      {creating ? (
        <P4FormDialog
          title={t("kpiP4.trajectory.add")}
          namespaces={NS}
          url={kpiPaths.trajectories(ws.tid, kpiId)}
          initial={{ basis: "period", interpolation: "linear" }}
          note={<p className="small muted">{t("kpiP4.trajectory.appendOnly")}</p>}
          fields={[
            {
              name: "basis",
              label: t("kpiP4.trajectory.basis"),
              kind: "select",
              required: true,
              options: [
                { value: "period", label: t("kpiP4.trajectory.bases.period") },
                { value: "cumulative", label: t("kpiP4.trajectory.bases.cumulative") },
              ],
            },
            {
              name: "interpolation",
              label: t("kpiP4.trajectory.interpolation"),
              kind: "select",
              required: true,
              options: [
                { value: "linear", label: t("kpiP4.trajectory.interpolations.linear") },
                { value: "step", label: t("kpiP4.trajectory.interpolations.step") },
              ],
            },
            {
              name: "points",
              label: t("kpiP4.trajectory.points"),
              kind: "textarea",
              required: true,
              ltr: true,
              hint:
                unitKind === "percentage" ? t("kpiP4.trajectory.pointsHintPercent") : t("kpiP4.trajectory.pointsHint"),
            },
          ]}
          submitLabel={t("kpiP4.trajectory.create")}
          toBody={(v) => {
            const parsed = parsePoints(String(v["points"] ?? ""), unitKind);
            if ("error" in parsed) return { fieldErrors: { points: parsed.error } };
            return {
              scopeKind: "transformation",
              scopeId: ws.tid,
              basis: v["basis"],
              interpolation: v["interpolation"],
              points: parsed.points,
            };
          }}
          onDone={() => refresh()}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {approving ? (
        <P4FormDialog
          title={t("kpiP4.trajectory.approveTitle", { n: approving.versionNo })}
          namespaces={NS}
          url={kpiPaths.approveTrajectory(ws.tid, approving.id)}
          version={approving.version}
          note={<BusinessApprovalNote body={t("kpiP4.trajectory.approveNote")} />}
          fields={[{ name: "comment", label: t("kpiP4.action.comment"), kind: "textarea", max: 2000 }]}
          submitLabel={t("kpiP4.trajectory.approve")}
          toBody={(v) => ({ comment: textOf(v["comment"]) ?? null })}
          onDone={() => refresh()}
          onClose={() => setApproving(null)}
        />
      ) : null}
      {withdrawing ? (
        <ReasonForm
          title={t("kpiP4.trajectory.withdrawTitle", { n: withdrawing.versionNo })}
          url={kpiPaths.withdrawTrajectory(ws.tid, withdrawing.id)}
          version={withdrawing.version}
          submitLabel={t("kpiP4.action.withdraw")}
          onDone={() => refresh()}
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ overrides

function Overrides({ entry }: { entry: KpiDictionaryEntry }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const kpiId = entry.definition.id;
  const overrides = useRagOverrides(ws.tid, kpiId);
  const canOverride = ws.can("rag.override");
  const frequency = entry.definition.frequency;
  const periods = usePeriodChoices(ws.tid, frequency, false);
  const evidence = useEvidenceOptions(ws.tid, canOverride);
  const refresh = useP4Refresh(ws.tid);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<RagOverride | null>(null);
  const names = useUserNames((overrides.data ?? []).map((o) => o.createdBy));
  const periodOptions = periods.choices.map((p) => ({
    value: p.id,
    label: p.status ? `${p.label} · ${t(`kpiP4.period.status.${p.status}`)}` : p.label,
  }));
  const columns: RegisterColumn<RagOverride>[] = [
    {
      id: "rag",
      header: t("kpiP4.override.rag"),
      rowHeader: true,
      hideable: false,
      cell: (o) => <RagChip rag={o.overrideRag} />,
    },
    { id: "calculated", header: t("kpiP4.field.calculatedRag"), cell: (o) => <RagChip rag={o.calculatedRag} /> },
    {
      id: "state",
      header: t("kpiP4.field.status"),
      cell: (o) =>
        o.inForce ? (
          <span className="lifecycle-chip lifecycle-chip--draft" data-in-force="true">
            <Icon name="dot" /> {t("kpiP4.override.inForce")}
          </span>
        ) : (
          <RecordChip group="override" status={o.status === "active" ? "expired" : o.status} />
        ),
    },
    { id: "reason", header: t("kpiP4.override.reason"), cell: (o) => <span className="clamp">{o.reason}</span> },
    {
      id: "expires",
      header: t("kpiP4.override.expiresAt"),
      cell: (o) => formatDateTime(o.expiresAt, locale, ws.tr.timezone),
      sortValue: (o) => o.expiresAt,
    },
    { id: "by", header: t("kpiP4.field.createdBy"), cell: (o) => names(o.createdBy) },
    {
      id: "actions",
      header: t("common.field.actions"),
      hideable: false,
      cell: (o) =>
        o.inForce && canOverride ? (
          <button
            type="button"
            className="button button--link button--small"
            data-action="revoke-override"
            onClick={() => setRevoking(o)}
          >
            {t("kpiP4.override.revoke")}
            <span className="visually-hidden">: {t(`kpiP4.rag.${o.overrideRag}`)}</span>
          </button>
        ) : (
          "—"
        ),
    },
  ];
  return (
    <Section
      id="kpi-overrides"
      title={t("kpiP4.override.title")}
      intro={t("kpiP4.override.intro")}
      actions={
        canOverride ? (
          <button
            type="button"
            className="button button--secondary"
            data-action="new-override"
            onClick={() => setCreating(true)}
          >
            <Icon name="plus" /> {t("kpiP4.override.add")}
          </button>
        ) : null
      }
    >
      <QueryState query={overrides}>
        {(rows) => (
          <RegisterTable
            id="kpi-overrides"
            caption={t("kpiP4.override.title")}
            rows={rows}
            columns={columns}
            getRowId={(o) => o.id}
            emptyTitle={t("kpiP4.override.empty")}
            defaultSort={{ id: "expires", dir: "desc" }}
          />
        )}
      </QueryState>
      {creating ? (
        <P4FormDialog
          title={t("kpiP4.override.add")}
          namespaces={NS}
          url={kpiPaths.overrides(ws.tid, kpiId)}
          note={<p className="small muted">{t("kpiP4.override.displayOnly")}</p>}
          fields={[
            {
              name: "reportingPeriodId",
              label: t("kpiP4.field.period"),
              kind: "select",
              required: true,
              options: periodOptions,
            },
            {
              name: "overrideRag",
              label: t("kpiP4.override.rag"),
              kind: "select",
              required: true,
              options: (["green", "amber", "red"] as const).map((r) => ({ value: r, label: t(`kpiP4.rag.${r}`) })),
            },
            { name: "reason", label: t("kpiP4.override.reason"), kind: "textarea", required: true, max: 2000 },
            {
              name: "evidenceId",
              label: t("kpiP4.field.evidence"),
              kind: "select",
              required: true,
              options: (evidence.data ?? []).map((e) => ({ value: e.id, label: e.title })),
            },
            {
              name: "expiresAt",
              label: t("kpiP4.override.expiresAt"),
              kind: "datetime",
              required: true,
              hint: t("kpiP4.override.expiresHint", { zone: ws.tr.timezone }),
            },
          ]}
          submitLabel={t("kpiP4.override.create")}
          toBody={(v) => {
            const expiresAt = zonedLocalToUtcIso(String(v["expiresAt"] ?? ""), ws.tr.timezone);
            if (!expiresAt) return { fieldErrors: { expiresAt: "validation.date" } };
            return {
              scopeKind: "transformation",
              scopeId: ws.tid,
              reportingPeriodId: v["reportingPeriodId"],
              overrideRag: v["overrideRag"],
              reason: String(v["reason"]).trim(),
              evidenceId: v["evidenceId"],
              expiresAt,
            };
          }}
          onDone={() => refresh()}
          onClose={() => setCreating(false)}
        />
      ) : null}
      {revoking ? (
        <ReasonForm
          title={t("kpiP4.override.revokeTitle")}
          url={kpiPaths.revokeOverride(ws.tid, revoking.id)}
          version={revoking.version}
          submitLabel={t("kpiP4.override.revoke")}
          onDone={() => refresh()}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </Section>
  );
}

// ------------------------------------------------------------------------------------------------ runs

function Runs({ kpiId }: { kpiId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const ws = useWorkspace();
  const runs = useCalculationRuns(ws.tid, kpiId);
  const columns: RegisterColumn<CalculationRun>[] = [
    {
      id: "seq",
      header: t("kpiP4.run.seq"),
      rowHeader: true,
      hideable: false,
      cell: (r) => (
        <bdi dir="ltr" className="code">
          #{r.seq}
        </bdi>
      ),
      sortValue: (r) => r.seq.padStart(19, "0"),
    },
    { id: "trigger", header: t("kpiP4.run.trigger"), cell: (r) => t(`kpiP4.run.triggers.${r.triggerKind}`) },
    {
      id: "status",
      header: t("kpiP4.field.status"),
      cell: (r) =>
        r.status === "completed" ? (
          <span>{t("kpiP4.run.completed")}</span>
        ) : (
          <span className="status-chip status-chip--off-track">
            <Icon name="cross" /> {t("kpiP4.run.failed")}
          </span>
        ),
    },
    { id: "evaluations", header: t("kpiP4.run.evaluations"), cell: (r) => r.evaluationCount },
    { id: "findings", header: t("kpiP4.run.findings"), cell: (r) => r.findingCount },
    {
      id: "rules",
      header: t("kpiP4.run.rules"),
      cell: (r) => (
        <bdi dir="ltr" className="code small">
          {r.kpiRulesVersion} · {r.formulaEngineVersion}
        </bdi>
      ),
    },
    {
      id: "completed",
      header: t("kpiP4.run.completedAt"),
      cell: (r) => formatDateTime(r.completedAt, locale, ws.tr.timezone),
      sortValue: (r) => r.completedAt,
    },
  ];
  return (
    <Section id="kpi-runs" title={t("kpiP4.run.title")} intro={t("kpiP4.run.intro")}>
      <QueryState query={runs}>
        {(rows) => (
          <RegisterTable
            id="kpi-runs"
            caption={t("kpiP4.run.title")}
            rows={rows}
            columns={columns}
            getRowId={(r) => r.id}
            emptyTitle={t("kpiP4.run.empty")}
            defaultSort={{ id: "seq", dir: "desc" }}
          />
        )}
      </QueryState>
    </Section>
  );
}
