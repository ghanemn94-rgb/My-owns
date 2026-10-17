// Optional financial metrics (T-DG5-FE-F; REQ-S08-019; ADR-0047 §5-§9; Benefits and Finance > Financial metrics).
// NPV, ROI and payback are an extension, not a playbook requirement:
//  - disabled by default; an administrator (financial_metrics.enable) switches the extension on or off for the
//    organization, and Finance (financial_metrics.define) sets the methodology statement, timing, period basis and the
//    discount rate (a decimal fraction per period: 0.10 = 10 %);
//  - every metric names its assumptions; with no discount rate there is no NPV ("Not shown: no discount rate"), and a
//    metric that is not computable is never 0;
//  - cash flows are entered per business case, in the business case's currency, one row per period index from 0.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { FINANCIAL_METRIC_PERIOD_BASES, FINANCIAL_METRIC_TIMINGS, type BusinessCase } from "@mth/shared/schemas";
import { useTransformation } from "../../api/queries.ts";
import { useLocale } from "../../app/locale.ts";
import { canAnywhere, canOn } from "../../auth/permissions.ts";
import { useMe } from "../../auth/session.tsx";
import type { IconName } from "../../components/Icon.tsx";
import { PageHeader, usePageTitle } from "../../components/Page.tsx";
import { Section } from "../../components/Section.tsx";
import { EmptyState, QueryState } from "../../components/States.tsx";
import { formatDateTime, formatMoney, formatPercent } from "../../lib/format.ts";
import { ReadOnlyNote } from "../my-work/p4ui.tsx";
import { useTransformationTarget } from "../transformations/common.tsx";
import { Chip, StatusChip, type ChipTone } from "../automation/ui.tsx";
import { useBusinessCases } from "../business-cases/api.ts";
import { useFefRunner } from "../launch-plan/ui.tsx";
import {
  financePaths,
  useCashFlows,
  useFinanceRefresh,
  useFinancialSettings,
  useTransformationMetrics,
  type BusinessCaseCashFlows,
  type FinancialMetrics,
  type FinancialMetricSettings,
} from "./api.ts";

const METRICS_STATUS: Record<string, readonly [ChipTone, IconName]> = {
  shown: ["good", "check"],
  disabled: ["neutral", "pause"],
  assumptions_missing: ["neutral", "question"],
  cash_flows_missing: ["neutral", "question"],
};

/** "Extension, not a playbook requirement" (H.6 item 6; REQ-S08-019). */
export function ExtensionLabel() {
  const { t } = useTranslation();
  return (
    <p className="banner banner--info" role="note" data-state="extension">
      <span className="lifecycle-chip lifecycle-chip--draft" data-extension="true">
        {t("launchHealthP5.finance.extension")}
      </span>{" "}
      {t("launchHealthP5.finance.extensionBody")}
    </p>
  );
}

export function FinancialMetricsPage() {
  const { t } = useTranslation();
  const { id = "" } = useParams();
  usePageTitle(t("launchHealthP5.finance.title"));
  const transformation = useTransformation(id);
  const settings = useFinancialSettings();
  return (
    <div className="page" data-p5-screen="financial-metrics">
      <PageHeader
        demoBadge
        title={t("launchHealthP5.finance.title")}
        subtitle={t("launchHealthP5.finance.intro")}
        crumbs={[
          { label: transformation.data?.name ?? t("launchHealthP5.transformation"), to: `/transformations/${id}` },
          { label: t("launchHealthP5.finance.cases"), to: `/transformations/${id}/business-cases` },
          { label: t("launchHealthP5.finance.title") },
        ]}
      />
      <ExtensionLabel />
      <QueryState query={settings}>
        {(s) => (
          <>
            <SettingsCard s={s} />
            <Metrics tid={id} enabled={s.enabled} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function SettingsCard({ s }: { s: FinancialMetricSettings }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const refresh = useFinanceRefresh();
  const toggle = useFefRunner(refresh);
  const assumptions = useFefRunner(refresh);
  const mayEnable = canAnywhere(me, "financial_metrics.enable");
  const mayDefine = canAnywhere(me, "financial_metrics.define");
  const [note, setNote] = useState(s.methodologyNote ?? "");
  const [timing, setTiming] = useState<string>(s.timing ?? "end_of_period");
  const [basis, setBasis] = useState<string>(s.periodBasis ?? "annual");
  const [rate, setRate] = useState(s.discountRate ?? "");
  return (
    <section className="card" aria-labelledby="fm-settings" data-enabled={String(s.enabled)}>
      <h2 id="fm-settings" className="card__title">
        {t("launchHealthP5.finance.settings")}{" "}
        {s.enabled ? (
          <Chip tone="neutral" icon="check" label={t("launchHealthP5.finance.on")} data="on" />
        ) : (
          <Chip tone="neutral" icon="pause" label={t("launchHealthP5.finance.off")} data="off" />
        )}
      </h2>
      <dl className="workspace-header__grid" data-assumptions="settings">
        <dt>{t("launchHealthP5.finance.methodology")}</dt>
        <dd>
          {t(`launchHealthP5.finance.methodologyKind.${s.methodology}`)}
          {s.methodologyNote ? <span className="block small">{s.methodologyNote}</span> : null}
        </dd>
        <dt>{t("launchHealthP5.finance.timing")}</dt>
        <dd>{s.timing ? t(`launchHealthP5.finance.timingKind.${s.timing}`) : t("launchHealthP5.finance.notSet")}</dd>
        <dt>{t("launchHealthP5.finance.periodBasis")}</dt>
        <dd>
          {s.periodBasis ? t(`launchHealthP5.finance.basisKind.${s.periodBasis}`) : t("launchHealthP5.finance.notSet")}
        </dd>
        <dt>{t("launchHealthP5.finance.discountRate")}</dt>
        <dd data-discount-rate={s.discountRate ?? ""}>
          {s.discountRate === null
            ? t("launchHealthP5.finance.noDiscountRate")
            : formatPercent(s.discountRate, locale, { fraction: true, maxFractionDigits: 4 })}
        </dd>
        {s.assumptionsSetAt ? (
          <>
            <dt>{t("launchHealthP5.finance.setAt")}</dt>
            <dd>{formatDateTime(s.assumptionsSetAt, locale)}</dd>
          </>
        ) : null}
      </dl>
      {mayEnable ? (
        <div data-form="fm-enablement">
          {toggle.alert}
          <button
            type="button"
            className="button"
            disabled={toggle.busy}
            onClick={() =>
              void toggle.run(financePaths.enablement, {
                method: "PUT",
                body: { enabled: !s.enabled },
                ifMatch: s.version,
              })
            }
          >
            {s.enabled ? t("launchHealthP5.finance.disable") : t("launchHealthP5.finance.enable")}
          </button>
        </div>
      ) : null}
      {mayDefine ? (
        <form
          className="form form--inset"
          noValidate
          data-form="fm-assumptions"
          onSubmit={(e) => {
            e.preventDefault();
            void assumptions.run(financePaths.assumptions, {
              method: "PUT",
              body: { methodologyNote: note.trim(), timing, periodBasis: basis, discountRate: rate.trim() || null },
              ifMatch: s.version,
            });
          }}
        >
          {assumptions.alert}
          <div className="field">
            <label className="field__label" htmlFor="fm-note">
              {t("launchHealthP5.finance.methodologyNote")}
            </label>
            <textarea id="fm-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="fm-timing">
              {t("launchHealthP5.finance.timing")}
            </label>
            <select id="fm-timing" value={timing} onChange={(e) => setTiming(e.target.value)}>
              {FINANCIAL_METRIC_TIMINGS.map((x) => (
                <option key={x} value={x}>
                  {t(`launchHealthP5.finance.timingKind.${x}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="fm-basis">
              {t("launchHealthP5.finance.periodBasis")}
            </label>
            <select id="fm-basis" value={basis} onChange={(e) => setBasis(e.target.value)}>
              {FINANCIAL_METRIC_PERIOD_BASES.map((x) => (
                <option key={x} value={x}>
                  {t(`launchHealthP5.finance.basisKind.${x}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="fm-rate">
              {t("launchHealthP5.finance.discountRate")}
            </label>
            <input
              id="fm-rate"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-describedby="fm-rate-hint"
            />
            <span id="fm-rate-hint" className="field__hint">
              {t("launchHealthP5.finance.discountRateHint")}
            </span>
          </div>
          <div className="form__actions">
            <button
              type="submit"
              className="button button--primary"
              disabled={assumptions.busy || note.trim().length < 3}
            >
              {t("launchHealthP5.finance.saveAssumptions")}
            </button>
          </div>
        </form>
      ) : null}
      {!mayEnable && !mayDefine ? <ReadOnlyNote /> : null}
    </section>
  );
}

function Metrics({ tid, enabled }: { tid: string; enabled: boolean }) {
  const { t } = useTranslation();
  const metrics = useTransformationMetrics(tid);
  const cases = useBusinessCases(tid);
  const [selected, setSelected] = useState<string | null>(null);
  const byId = new Map((cases.data ?? []).map((c) => [c.id, c]));
  return (
    <QueryState query={metrics}>
      {(items) => (
        <>
          <Section
            id="fm-metrics"
            title={t("launchHealthP5.finance.metrics")}
            intro={enabled ? undefined : t("launchHealthP5.finance.disabledBody")}
          >
            {items.length === 0 ? (
              <EmptyState title={t("launchHealthP5.finance.noCases")} />
            ) : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label={t("launchHealthP5.finance.metrics")}>
                <table className="table" data-table="financial-metrics">
                  <caption className="visually-hidden">{t("launchHealthP5.finance.metrics")}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("launchHealthP5.finance.case")}</th>
                      <th scope="col">{t("launchHealthP5.field.status")}</th>
                      <th scope="col">{t("launchHealthP5.finance.npv")}</th>
                      <th scope="col">{t("launchHealthP5.finance.roi")}</th>
                      <th scope="col">{t("launchHealthP5.finance.payback")}</th>
                      <th scope="col">{t("launchHealthP5.finance.assumptions")}</th>
                      <th scope="col">{t("launchHealthP5.finance.cashFlows")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((m) => (
                      <MetricRow
                        key={m.businessCaseId}
                        m={m}
                        c={byId.get(m.businessCaseId)}
                        onCashFlows={setSelected}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {selected ? <CashFlows key={selected} tid={tid} caseId={selected} c={byId.get(selected)} /> : null}
        </>
      )}
    </QueryState>
  );
}

function MetricRow({
  m,
  c,
  onCashFlows,
}: {
  m: FinancialMetrics;
  c: BusinessCase | undefined;
  onCashFlows: (id: string) => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const reason = (r: string | null) => (
    <span className="status-chip status-chip--unknown status-chip--wrap" data-reason={r ?? ""}>
      {t(`launchHealthP5.finance.reason.${r ?? "not_shown"}`)}
    </span>
  );
  const name = c ? `${c.code} · ${c.title}` : t("launchHealthP5.finance.case");
  return (
    <tr data-case={c?.code ?? m.businessCaseId} data-metrics-status={m.status}>
      <th scope="row">{name}</th>
      <td>
        <StatusChip value={m.status} table={METRICS_STATUS} labelKey="launchHealthP5.finance.status" />
      </td>
      <td data-npv={m.npv ?? ""}>{m.npv !== null ? formatMoney(m.npv, m.currency, locale) : reason(m.npvReason)}</td>
      <td data-roi={m.roi ?? ""}>
        {m.roi !== null ? formatPercent(m.roi, locale, { fraction: true, maxFractionDigits: 2 }) : reason(m.roiReason)}
      </td>
      <td data-payback={m.paybackPeriodIndex ?? ""}>
        {m.paybackPeriodIndex !== null
          ? t("launchHealthP5.finance.paybackPeriod", { n: m.paybackPeriodIndex })
          : reason(m.paybackReason)}
      </td>
      <td className="small">
        {m.assumptions ? (
          <span data-named-assumptions="true">
            {t(`launchHealthP5.finance.timingKind.${m.assumptions.timing}`)} ·{" "}
            {t(`launchHealthP5.finance.basisKind.${m.assumptions.periodBasis}`)} ·{" "}
            {m.assumptions.discountRate === null
              ? t("launchHealthP5.finance.noDiscountRate")
              : t("launchHealthP5.finance.rateValue", {
                  rate: formatPercent(m.assumptions.discountRate, locale, { fraction: true, maxFractionDigits: 4 }),
                })}
          </span>
        ) : (
          <span className="muted">{t("launchHealthP5.finance.noAssumptions")}</span>
        )}
      </td>
      <td>
        <button type="button" className="button button--small" onClick={() => onCashFlows(m.businessCaseId)}>
          {t("launchHealthP5.finance.openCashFlows")}
          <span className="visually-hidden"> {name}</span>
        </button>
      </td>
    </tr>
  );
}

interface FlowRow {
  periodIndex: number;
  outflow: string;
  inflow: string;
}

function CashFlows({ tid, caseId, c }: { tid: string; caseId: string; c: BusinessCase | undefined }) {
  const cf = useCashFlows(caseId);
  return <QueryState query={cf}>{(d) => <CashFlowEditor key={d.version} tid={tid} cf={d} c={c} />}</QueryState>;
}

function CashFlowEditor({ tid, cf, c }: { tid: string; cf: BusinessCaseCashFlows; c: BusinessCase | undefined }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const me = useMe();
  const transformation = useTransformation(tid);
  const target = useTransformationTarget(transformation.data);
  const mayDefine = target ? canOn(me, "financial_metrics.define", target) : false;
  const refresh = useFinanceRefresh();
  const runner = useFefRunner(refresh);
  const [rows, setRows] = useState<FlowRow[]>(
    cf.rows.length > 0
      ? cf.rows.map((r) => ({ periodIndex: r.periodIndex, outflow: r.outflow, inflow: r.inflow }))
      : [{ periodIndex: 0, outflow: "", inflow: "" }],
  );
  const [basisNote, setBasisNote] = useState(cf.basisNote ?? "");
  const set = (i: number, patch: Partial<FlowRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const title = t("launchHealthP5.finance.cashFlowsOf", { name: c ? `${c.code} · ${c.title}` : "" });
  return (
    <Section
      id="fm-cash-flows"
      title={title}
      intro={t("launchHealthP5.finance.cashFlowsIntro", { currency: cf.currency })}
    >
      <p className="small muted" data-revision={cf.revision}>
        {t("launchHealthP5.finance.revision", { n: cf.revision })}
        {cf.updatedAt ? ` · ${formatDateTime(cf.updatedAt, locale)}` : ""}
      </p>
      <form
        className="form form--inset"
        noValidate
        data-form="fm-cash-flows"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mayDefine) return;
          void runner.run(financePaths.cashFlows(cf.businessCaseId), {
            method: "PUT",
            body: {
              basisNote: basisNote.trim() || null,
              rows: rows.map((r) => ({
                periodIndex: r.periodIndex,
                outflow: r.outflow.trim(),
                inflow: r.inflow.trim(),
              })),
            },
            ifMatch: cf.version,
          });
        }}
      >
        {runner.alert}
        <div className="table-wrap" tabIndex={0} role="region" aria-label={title}>
          <table className="table" data-table="cash-flows">
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">{t("launchHealthP5.finance.period")}</th>
                <th scope="col">{t("launchHealthP5.finance.outflow", { currency: cf.currency })}</th>
                <th scope="col">{t("launchHealthP5.finance.inflow", { currency: cf.currency })}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.periodIndex} data-period-index={r.periodIndex}>
                  <th scope="row">{r.periodIndex}</th>
                  <td>
                    {mayDefine ? (
                      <input
                        aria-label={t("launchHealthP5.finance.outflowOf", { n: r.periodIndex })}
                        inputMode="decimal"
                        value={r.outflow}
                        onChange={(e) => set(i, { outflow: e.target.value })}
                      />
                    ) : (
                      formatMoney(r.outflow, cf.currency, locale)
                    )}
                  </td>
                  <td>
                    {mayDefine ? (
                      <input
                        aria-label={t("launchHealthP5.finance.inflowOf", { n: r.periodIndex })}
                        inputMode="decimal"
                        value={r.inflow}
                        onChange={(e) => set(i, { inflow: e.target.value })}
                      />
                    ) : (
                      formatMoney(r.inflow, cf.currency, locale)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mayDefine ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="fm-basis-note">
                {t("launchHealthP5.finance.basisNote")}
              </label>
              <input
                id="fm-basis-note"
                maxLength={2000}
                value={basisNote}
                onChange={(e) => setBasisNote(e.target.value)}
              />
            </div>
            <div className="form__actions">
              <button
                type="button"
                className="button"
                disabled={rows.length >= 121}
                onClick={() => setRows((rs) => [...rs, { periodIndex: rs.length, outflow: "", inflow: "" }])}
              >
                {t("launchHealthP5.finance.addPeriod")}
              </button>
              <button
                type="button"
                className="button"
                disabled={rows.length <= 1}
                onClick={() => setRows((rs) => rs.slice(0, -1))}
              >
                {t("launchHealthP5.finance.removePeriod")}
              </button>
              <button type="submit" className="button button--primary" disabled={runner.busy}>
                {t("launchHealthP5.finance.saveCashFlows")}
              </button>
            </div>
          </>
        ) : (
          <ReadOnlyNote />
        )}
      </form>
    </Section>
  );
}
