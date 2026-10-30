// The four explanation panels of ADR-0061 §8 (T-DG6-FE-F; REQ-S15-014): E1 weighted score, E2 benefit realized value,
// E4 NPV, ROI and payback, E5 health check score and band. Each takes the operation responses its page already loads,
// builds KBE-B's view model (`@mth/shared/calc` explain*: decimal.js, the shared calculation functions, no second
// implementation) and displays it. Nothing here computes a business number: a component only formats the view model's
// decimal strings for display. Unknown, incomplete, not computable and n/a are labelled states, never 0 or green.
import {
  explainBenefitRealized,
  explainFinancialMetrics,
  explainHealthScore,
  explainWeightedScore,
  type BenefitKpiActualInput,
  type BenefitValuesInput,
  type CashFlowsInput,
  type ExplainAmount,
  type FinancialMetricsInput,
  type HealthCheckInput,
  type HealthSchemeVersionInput,
  type WeightedScoreSheetInput,
  type WeightedScoreWeightSetInput,
} from "@mth/shared/calc";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocale } from "../../app/locale.ts";
import { formatBusinessDate, formatDateTime, formatDecimal, formatMoney, formatPercent } from "../../lib/format.ts";
import { ExplanationPanel, NoValue, Num, type ExplanationTable } from "./ExplanationPanel.tsx";

const reasonText = (t: TFunction, reason: string) =>
  t(`explanations.reason.${reason.replace(/\./g, "__")}`, { defaultValue: t("explanations.panel.state.unknown") });

// ------------------------------------------------------------------------------------------------ E1 weighted score

export function WeightedScoreExplanation({
  sheet,
  weightSet,
}: {
  sheet: WeightedScoreSheetInput;
  weightSet: WeightedScoreWeightSetInput | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const e = explainWeightedScore(sheet, weightSet);
  const criterion = (code: string) => t(`prioritization.criterion.${code}`);
  const dec = (v: string, min: number, max: number) => (
    <Num>{formatDecimal(v, locale, { minFractionDigits: min, maxFractionDigits: max })}</Num>
  );
  const noScore = <NoValue label={t("explanations.weightedScore.noScore")} />;
  const table: ExplanationTable | null =
    e.rows.length === 0
      ? null
      : {
          caption: t("explanations.panel.inputs"),
          columns: [
            { key: "criterion", label: t("explanations.weightedScore.criterion") },
            { key: "score", label: t("explanations.weightedScore.score"), numeric: true },
            { key: "weight", label: t("explanations.weightedScore.weight"), numeric: true },
            { key: "contribution", label: t("explanations.weightedScore.contribution"), numeric: true },
          ],
          rows: e.rows.map((r) => ({
            key: r.criterionCode,
            cells: {
              criterion: criterion(r.criterionCode),
              score: r.score === null ? noScore : dec(r.score, 0, 0),
              weight: <Num>{formatPercent(r.weightPercent, locale, { maxFractionDigits: 2 })}</Num>,
              contribution:
                r.contribution === null ? (
                  <NoValue label={t("explanations.panel.state.incomplete")} />
                ) : (
                  dec(r.contribution, 2, 4)
                ),
            },
          })),
          foot:
            e.state === "complete"
              ? {
                  key: "sum",
                  cells: {
                    criterion: t("explanations.weightedScore.sum"),
                    score: "",
                    weight: "",
                    contribution: <strong>{dec(e.sum, 2, 4)}</strong>,
                  },
                }
              : undefined,
        };
  const stateText =
    e.state === "incomplete"
      ? t("explanations.weightedScore.incomplete", {
          criteria: e.missingCriteria.map(criterion).join(t("prioritization.shared.listSeparator")),
        })
      : e.state === "unknown"
        ? reasonText(t, e.reason)
        : null;
  const facts =
    e.state === "complete" && e.display100 !== null
      ? [
          {
            key: "display100",
            node: (
              <>
                {t("explanations.weightedScore.display100")}: {dec(e.display100, 0, 2)}
              </>
            ),
          },
        ]
      : [];
  return (
    <ExplanationPanel
      kind="e1-weighted-score"
      valueName={t("explanations.weightedScore.value")}
      state={e.state}
      formula={[t("explanations.weightedScore.formula")]}
      period={
        e.computedAt
          ? t("explanations.weightedScore.computedAt", { at: formatDateTime(e.computedAt, locale) })
          : t("explanations.panel.notCalculated")
      }
      version={t("explanations.weightedScore.version", { n: e.weightSetVersionNo })}
      stateText={stateText}
      tables={table ? [table] : []}
      facts={facts}
    />
  );
}

// ------------------------------------------------------------------------------------------------ E2 benefit realized

function AmountText({ a }: { a: ExplainAmount }) {
  const { t } = useTranslation();
  const locale = useLocale();
  switch (a.status) {
    case "known":
      return <Num>{a.currency ? formatMoney(a.amount, a.currency, locale) : formatDecimal(a.amount, locale)}</Num>;
    case "no_lines":
      return <NoValue label={t("explanations.benefitRealized.noLines")} />;
    case "not_applicable":
      return <span data-na="">{t(a.textKey)}</span>;
    default:
      return <NoValue label={t("common.value.unknown")} />;
  }
}

function periodRange(t: TFunction, locale: "ar" | "en", from: string | null, to: string | null): ReactNode {
  if (from === null && to === null) return t("explanations.panel.noPeriod");
  return t("explanations.panel.range", {
    from: formatBusinessDate(from, locale) ?? t("common.value.unknown"),
    to: formatBusinessDate(to, locale) ?? t("common.value.unknown"),
  });
}

export function BenefitRealizedExplanation({
  values,
  kpiActual,
}: {
  values: BenefitValuesInput;
  kpiActual: BenefitKpiActualInput | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const e = explainBenefitRealized(values, kpiActual);
  const tables: ExplanationTable[] = e.nonFinancial
    ? []
    : e.groups.map((g) => ({
        caption: t(`explanations.benefitRealized.group.${g.key}`),
        columns: [
          { key: "period", label: t("explanations.benefitRealized.periodCol") },
          { key: "amount", label: t("explanations.benefitRealized.amount"), numeric: true },
          { key: "basis", label: t("explanations.benefitRealized.basis") },
        ],
        rows: g.lines.map((l) => ({
          key: l.recordId,
          cells: {
            period: periodRange(t, locale, l.periodStart, l.periodEnd),
            amount: <AmountText a={l.amount} />,
            basis: l.basis ? t(`explanations.benefitRealized.basisKind.${l.basis}`) : "",
          },
        })),
        foot: {
          key: `${g.key}-total`,
          cells: {
            period: t("explanations.benefitRealized.total", { count: g.count }),
            amount: (
              <strong data-total={g.key}>
                <AmountText a={g.total} />
              </strong>
            ),
            basis: "",
          },
        },
      }));
  const validated = e.groups[0];
  const state = e.nonFinancial
    ? e.kpiActual?.status === "known"
      ? "complete"
      : "unknown"
    : validated.total.status === "known"
      ? "complete"
      : validated.total.status === "no_lines"
        ? "incomplete"
        : "unknown";
  const facts: { key: string; node: ReactNode }[] = [
    { key: "currency", node: t("explanations.benefitRealized.currency", { currency: e.currency }) },
  ];
  if (e.kpiActual)
    facts.push({
      key: "kpiActual",
      node: (
        <>
          {t("explanations.benefitRealized.kpiActual")}:{" "}
          {e.kpiActual.status === "known" ? (
            <Num>{formatDecimal(e.kpiActual.value, locale, { maxFractionDigits: 4 })}</Num>
          ) : (
            <NoValue label={t(e.kpiActual.status === "stale" ? "common.status.stale" : "common.value.unknown")} />
          )}
        </>
      ),
    });
  return (
    <ExplanationPanel
      kind="e2-benefit-realized"
      valueName={t("explanations.benefitRealized.value")}
      state={state}
      formula={
        e.nonFinancial
          ? [t("explanations.benefitRealized.formulaNonFinancial")]
          : [t("explanations.benefitRealized.formula")]
      }
      period={periodRange(t, locale, e.firstPeriodStart, e.lastPeriodEnd)}
      version={null}
      tables={tables}
      facts={facts}
    />
  );
}

// ------------------------------------------------------------------------------------------------ E4 financial metrics

export function FinancialMetricsExplanation({
  cashFlows,
  metrics,
}: {
  cashFlows: CashFlowsInput;
  metrics: FinancialMetricsInput;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const e = explainFinancialMetrics(cashFlows, metrics);
  const formula = [
    t("explanations.financialMetrics.formulaNpv"),
    t("explanations.financialMetrics.formulaRoi"),
    t("explanations.financialMetrics.formulaPayback"),
    t("explanations.financialMetrics.formulaNotes"),
  ];
  const version = t("explanations.financialMetrics.revision", { n: cashFlows.revision });
  if (e.state !== "shown") {
    const stateText =
      e.state === "disabled"
        ? t("explanations.financialMetrics.disabled")
        : e.state === "incomplete"
          ? t(`explanations.financialMetrics.incomplete.${e.reason}`)
          : reasonText(t, e.reason);
    return (
      <ExplanationPanel
        kind="e4-financial-metrics"
        valueName={t("explanations.financialMetrics.value")}
        state={e.state === "disabled" ? "disabled" : e.state}
        formula={formula}
        period={t("explanations.panel.noPeriod")}
        version={version}
        stateText={stateText}
      />
    );
  }
  const money = (v: string | null) =>
    v === null ? (
      <NoValue label={t("explanations.financialMetrics.noRate")} />
    ) : (
      <Num>{formatMoney(v, e.currency, locale)}</Num>
    );
  const table: ExplanationTable = {
    caption: t("explanations.panel.inputs"),
    columns: [
      { key: "period", label: t("explanations.financialMetrics.periodCol") },
      { key: "outflow", label: t("explanations.financialMetrics.outflow"), numeric: true },
      { key: "inflow", label: t("explanations.financialMetrics.inflow"), numeric: true },
      { key: "net", label: t("explanations.financialMetrics.net"), numeric: true },
      { key: "exponent", label: t("explanations.financialMetrics.exponent"), numeric: true },
      { key: "factor", label: t("explanations.financialMetrics.factor"), numeric: true },
      { key: "discounted", label: t("explanations.financialMetrics.discountedNet"), numeric: true },
      { key: "cumulative", label: t("explanations.financialMetrics.cumulative"), numeric: true },
    ],
    rows: e.rows.map((r) => ({
      key: String(r.periodIndex),
      cells: {
        period: (
          <>
            {t("launchHealthP5.finance.paybackPeriod", { n: r.periodIndex })}
            {r.payback ? (
              <span className="lifecycle-chip" data-payback="">
                {" "}
                {t("explanations.financialMetrics.paybackRow")}
              </span>
            ) : null}
          </>
        ),
        outflow: money(r.outflow),
        inflow: money(r.inflow),
        net: money(r.net),
        exponent: <Num>{r.discountExponent}</Num>,
        factor:
          r.discountFactor === null ? (
            <NoValue label={t("explanations.financialMetrics.noRate")} />
          ) : (
            <Num>{formatDecimal(r.discountFactor, locale, { minFractionDigits: 6, maxFractionDigits: 6 })}</Num>
          ),
        discounted: money(r.discountedNet),
        cumulative: money(r.cumulativeNet),
      },
    })),
  };
  const reason = (r: string | null) => t(`launchHealthP5.finance.reason.${r ?? "not_shown"}`);
  const facts = [
    {
      key: "totals",
      node: t("explanations.financialMetrics.totals", {
        inflow: formatMoney(e.totalInflow, e.currency, locale),
        outflow: formatMoney(e.totalOutflow, e.currency, locale),
      }),
    },
    {
      key: "npv",
      node: (
        <>
          {t("launchHealthP5.finance.npv")}:{" "}
          {e.npv !== null ? (
            <Num>{formatMoney(e.npv, e.currency, locale)}</Num>
          ) : (
            <NoValue label={reason(e.npvReason)} />
          )}
          {e.npvExact !== null ? (
            <span className="small muted">
              {" "}
              ({t("explanations.financialMetrics.npvExact", { value: "" })}
              <Num>{e.npvExact}</Num>)
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "roi",
      node: (
        <>
          {t("launchHealthP5.finance.roi")}:{" "}
          {e.roi !== null ? (
            <Num>{formatPercent(e.roi, locale, { fraction: true, maxFractionDigits: 4 })}</Num>
          ) : (
            <NoValue label={reason(e.roiReason)} />
          )}
        </>
      ),
    },
    {
      key: "payback",
      node: (
        <>
          {t("launchHealthP5.finance.payback")}:{" "}
          {e.paybackPeriodIndex !== null ? (
            t("launchHealthP5.finance.paybackPeriod", { n: e.paybackPeriodIndex })
          ) : (
            <NoValue label={reason(e.paybackReason)} />
          )}
        </>
      ),
    },
  ];
  const p = e.messageParams;
  return (
    <ExplanationPanel
      kind="e4-financial-metrics"
      valueName={t("explanations.financialMetrics.value")}
      state="complete"
      formula={formula}
      period={
        <>
          {t("explanations.financialMetrics.periods", { count: p.periodCount })} ·{" "}
          {t(`launchHealthP5.finance.basisKind.${p.periodBasis}`)} ·{" "}
          {t(`launchHealthP5.finance.timingKind.${p.timing}`)} ·{" "}
          {p.discountRate === null
            ? t("launchHealthP5.finance.noDiscountRate")
            : t("launchHealthP5.finance.rateValue", {
                rate: formatPercent(p.discountRate, locale, { fraction: true, maxFractionDigits: 4 }),
              })}
        </>
      }
      version={version}
      tables={[table]}
      facts={facts}
    />
  );
}

// ------------------------------------------------------------------------------------------------ E5 health score

export function HealthScoreExplanation({
  check,
  scheme,
  responseLabel,
}: {
  check: HealthCheckInput;
  scheme: HealthSchemeVersionInput | null;
  responseLabel: (key: string) => string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const e = explainHealthScore(check, scheme);
  const dec = (v: string) => <Num>{formatDecimal(v, locale, { maxFractionDigits: 2 })}</Num>;
  const table: ExplanationTable | null =
    e.state === "unknown"
      ? null
      : {
          caption: t("explanations.panel.inputs"),
          columns: [
            { key: "response", label: t("explanations.healthScore.response") },
            { key: "count", label: t("explanations.healthScore.count"), numeric: true },
            { key: "credit", label: t("explanations.healthScore.credit"), numeric: true },
            { key: "points", label: t("explanations.healthScore.points"), numeric: true },
          ],
          rows: e.responses.map((r) => ({
            key: r.key,
            cells: {
              response: responseLabel(r.key),
              count: <Num>{r.count}</Num>,
              credit: r.credit === null ? t("explanations.healthScore.notApplicable") : dec(r.credit),
              points: r.points === null ? t("explanations.healthScore.notApplicable") : dec(r.points),
            },
          })),
        };
  const facts: { key: string; node: ReactNode }[] = [
    { key: "answered", node: t("explanations.healthScore.answered", { answered: e.answered, total: e.total }) },
  ];
  if (e.state !== "unknown")
    facts.push({ key: "applicable", node: t("explanations.healthScore.applicable", { applicable: e.applicable }) });
  if (e.state === "scored") {
    facts.push({
      key: "points",
      node: (
        <>
          {t("explanations.healthScore.pointsTotal", { points: "" })}
          {dec(e.points)}
        </>
      ),
    });
    facts.push({
      key: "score",
      node: t("explanations.healthScore.score", {
        score: formatDecimal(e.score, locale, { maxFractionDigits: 2 }),
        max: formatDecimal(e.scoreMax, locale, { maxFractionDigits: 2 }),
      }),
    });
    if (e.band)
      facts.push({
        key: "band",
        node: (
          <>
            {t("explanations.healthScore.band", { range: "" })}
            <bdi dir="ltr">{e.band.rangeLabel}</bdi>
          </>
        ),
      });
  }
  if (e.scoringAssumption) facts.push({ key: "assumption", node: t("explanations.healthScore.assumption") });
  const stateText =
    e.state === "incomplete"
      ? t("explanations.healthScore.incomplete", { count: e.unanswered.length })
      : e.state === "not_computable"
        ? t("explanations.healthScore.notComputable")
        : e.state === "unknown"
          ? reasonText(t, e.reason)
          : null;
  return (
    <ExplanationPanel
      kind="e5-health-score"
      valueName={t("explanations.healthScore.value")}
      state={e.state === "scored" ? "complete" : e.state === "not_computable" ? "notComputable" : e.state}
      formula={[t("explanations.healthScore.formula"), t("explanations.healthScore.formulaNotes")]}
      period={t("explanations.healthScore.assessmentDate", {
        date: formatBusinessDate(e.assessmentDate, locale) ?? e.assessmentDate,
      })}
      version={t("explanations.healthScore.scheme", { n: e.schemeVersionNo })}
      stateText={stateText}
      tables={table ? [table] : []}
      facts={facts}
    />
  );
}
