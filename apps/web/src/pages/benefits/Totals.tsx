// Benefit totals (T-DG4-FE-C; ADR-0030 §7): one block per currency (never converted), one line per value class ×
// state, gross, implementation cost (cash / non-cash) and net. A total is for ONE state and states are never added
// together: pending (submitted) is its own column beside validated and sustained (REQ-S08-016). Values of a benefit with
// an open overlap warning are on their own "pending overlap" lines, outside validated and sustained (REQ-S08-014).
// Non-financial benefits without a valuation method are counted apart (n/a), never as 0 (REQ-PB-076). Excluded
// benefits are listed with their reason and never summed. An Unknown amount shows Unknown with its reason, never 0.
import { useTranslation } from "react-i18next";
import { Icon } from "../../components/Icon.tsx";
import { useLocale } from "../../app/locale.ts";
import { formatDateTime } from "../../lib/format.ts";
import type { BenefitTotalLine, BenefitTotals, BenefitTotalsCurrency } from "./api.ts";
import { Amount, BenefitLink, Code } from "./ui.tsx";

/** The states shown as columns of the class table, in order. Measured is not a total of its own (it overlaps). */
export const TOTAL_STATES = ["planned", "forecast", "submitted", "validated", "sustained", "rejected"] as const;
export const TOTAL_CLASSES = [
  "revenue_uplift",
  "margin_uplift",
  "cash_saving",
  "avoided_cost",
  "working_capital_release",
  "non_financial_valued",
] as const;

function lineOf(lines: readonly BenefitTotalLine[], cls: string, state: string): BenefitTotalLine | undefined {
  return lines.find((l) => l.valueClass === cls && l.state === state);
}

export function TotalsView({ totals, tid }: { totals: BenefitTotals; tid?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div data-totals-scope={totals.scope}>
      {totals.allocated ? (
        <p className="banner banner--info" role="note" data-state="allocated">
          <Icon name="info" /> {t("benefitsP4.totals.allocatedNote")}
        </p>
      ) : null}
      {totals.currencies.length === 0 ? (
        <p className="muted" data-state="no-financial-values">
          {t("benefitsP4.totals.noCurrency")}
        </p>
      ) : (
        totals.currencies.map((c) => <CurrencyBlock key={c.currency} block={c} />)
      )}
      <dl className="details">
        <div>
          <dt>{t("benefitsP4.totals.nonFinancialCount")}</dt>
          <dd data-total="non-financial-count">
            <bdi dir="ltr">{totals.nonFinancialCount}</bdi>{" "}
            <span className="small muted">{t("benefitsP4.totals.nonFinancialNote")}</span>
          </dd>
        </div>
        <div>
          <dt>{t("benefitsP4.totals.computedAt")}</dt>
          <dd>{formatDateTime(totals.computedAt, locale) ?? ""}</dd>
        </div>
      </dl>
      {totals.excluded.length > 0 ? (
        <div data-totals="excluded">
          <h3 className="card__subtitle">{t("benefitsP4.totals.excludedTitle")}</h3>
          <ul className="plain-list">
            {totals.excluded.map((e) => (
              <li key={e.benefitId} data-excluded={e.code}>
                {tid ? (
                  <BenefitLink tid={tid} id={e.benefitId}>
                    <Code>{e.code}</Code>
                  </BenefitLink>
                ) : (
                  <Code>{e.code}</Code>
                )}{" "}
                — {t(`benefitsP4.exclusion.${e.reason}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function CurrencyBlock({ block }: { block: BenefitTotalsCurrency }) {
  const { t } = useTranslation();
  const classes = TOTAL_CLASSES.filter(
    (c) => block.lines.some((l) => l.valueClass === c) || block.pendingOverlap.some((l) => l.valueClass === c),
  );
  return (
    <div data-currency={block.currency}>
      <h3 className="card__subtitle">
        {t("benefitsP4.totals.currencyTitle")} <Code>{block.currency}</Code>
      </h3>
      <div className="table-wrap" role="region" aria-label={t("benefitsP4.totals.byClassCaption")} tabIndex={0}>
        <table className="table" data-totals="by-class">
          <caption className="visually-hidden">{t("benefitsP4.totals.byClassCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("benefitsP4.totals.class")}</th>
              {TOTAL_STATES.map((s) => (
                <th scope="col" key={s}>
                  {t(`benefitsP4.state.${s}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.length === 0 ? (
              <tr>
                <td colSpan={TOTAL_STATES.length + 1} className="muted">
                  {t("benefitsP4.totals.noLines")}
                </td>
              </tr>
            ) : (
              classes.map((cls) => (
                <tr key={cls} data-class={cls}>
                  <th scope="row">{t(`benefitsP4.totalClass.${cls}`)}</th>
                  {TOTAL_STATES.map((s) => {
                    const line = lineOf(block.lines, cls, s);
                    return (
                      <td key={s} data-state={s}>
                        {line ? (
                          <>
                            <Amount amount={line.total} />
                            <span className="block small muted">
                              {t("benefitsP4.totals.count", { count: line.count })}
                            </span>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {block.pendingOverlap.length > 0 ? (
        <div className="banner banner--warning" data-totals="pending-overlap">
          <p>
            <Icon name="alert" /> <strong>{t("benefitsP4.totals.pendingOverlapTitle")}</strong>:{" "}
            {t("benefitsP4.totals.pendingOverlapNote")}
          </p>
          <ul className="plain-list">
            {block.pendingOverlap.map((l) => (
              <li key={`${l.valueClass}:${l.state}`}>
                {t(`benefitsP4.totalClass.${l.valueClass}`)} · {t(`benefitsP4.state.${l.state}`)}:{" "}
                <Amount amount={l.total} /> ({t("benefitsP4.totals.count", { count: l.count })})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="table-wrap" role="region" aria-label={t("benefitsP4.totals.netCaption")} tabIndex={0}>
        <table className="table" data-totals="net">
          <caption className="visually-hidden">{t("benefitsP4.totals.netCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("benefitsP4.totals.measure")}</th>
              <th scope="col">{t("benefitsP4.state.planned")}</th>
              <th scope="col">{t("benefitsP4.state.validated")}</th>
            </tr>
          </thead>
          <tbody>
            <tr data-row="gross">
              <th scope="row">{t("benefitsP4.totals.gross")}</th>
              <td data-state="planned">
                <Amount amount={block.gross.planned} />
              </td>
              <td data-state="validated">
                <Amount amount={block.gross.validated} />
              </td>
            </tr>
            <tr data-row="cost">
              <th scope="row">
                {t("benefitsP4.totals.cost")}
                <span className="block small muted">
                  {t("benefitsP4.totals.costCash")}: <Amount amount={block.implementationCost.cash} /> ·{" "}
                  {t("benefitsP4.totals.costNonCash")}: <Amount amount={block.implementationCost.nonCash} />
                </span>
              </th>
              <td colSpan={2} data-state="cost">
                <Amount amount={block.implementationCost.total} />
              </td>
            </tr>
            <tr data-row="net">
              <th scope="row">{t("benefitsP4.totals.net")}</th>
              <td data-state="planned">
                <Amount amount={block.net.planned} />
              </td>
              <td data-state="validated">
                <Amount amount={block.net.validated} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="small muted">{t("benefitsP4.totals.netNote")}</p>
    </div>
  );
}
