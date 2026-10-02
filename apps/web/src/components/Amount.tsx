// Decimal amounts and value-pool totals (ADR-0019, REQ-PB-028). Amounts are decimal strings formatted by
// @mth/shared value.ts (never a JavaScript number). A missing amount is Unknown; an unquantified value pool is labelled
// "Unquantified", never 0; a total that leaves pools out says "partial: N unquantified"; currencies are never summed.
import { useTranslation } from "react-i18next";
import { formatDecimal, isPartialTotal, totalValuePools, type ValuePoolForTotal } from "@mth/shared/schemas";
import { useLocale } from "../app/locale.ts";
import { Unknown } from "./Badges.tsx";
import { Icon } from "./Icon.tsx";

export function Amount({
  value,
  currency,
  maxFractionDigits = 2,
}: {
  value: string | null | undefined;
  currency?: string | null;
  maxFractionDigits?: number;
}) {
  const locale = useLocale();
  const text = formatDecimal(value, { locale, currency: currency ?? null, maxFractionDigits });
  if (text === null) return <Unknown />;
  return (
    <bdi dir="ltr" className="amount" data-amount={value ?? ""}>
      {text}
    </bdi>
  );
}

/** "Unquantified" label for a value pool without amounts (never rendered as 0). */
export function Unquantified() {
  const { t } = useTranslation();
  return (
    <span className="status-chip status-chip--unknown" data-quantification="unquantified">
      <Icon name="question" /> {t("kpi.valuePool.unquantified")}
    </span>
  );
}

/** Downside–upside range of one quantified value pool. */
export function AmountRange({
  downside,
  upside,
  currency,
}: {
  downside: string | null;
  upside: string | null;
  currency: string;
}) {
  const { t } = useTranslation();
  return (
    <span className="amount-range">
      <span className="block">
        {t("kpi.valuePool.downside")}: <Amount value={downside} currency={currency} />
      </span>
      <span className="block">
        {t("kpi.valuePool.upside")}: <Amount value={upside} currency={currency} />
      </span>
    </span>
  );
}

/** Value-pool totals per currency, with the partial and unknown states made explicit. */
export function ValuePoolTotals({ pools }: { pools: readonly ValuePoolForTotal[] }) {
  const { t } = useTranslation();
  const totals = totalValuePools(pools);
  if (totals.length === 0) {
    return (
      <p className="value-total" data-total="none">
        {t("kpi.valuePool.totalLabel")}: <Unknown hint={t("kpi.valuePool.noPools")} />
      </p>
    );
  }
  return (
    <ul className="plain-list value-totals">
      {totals.map((total) => (
        <li key={total.currency} className="value-total" data-total-currency={total.currency}>
          <span className="value-total__label">{t("kpi.valuePool.totalIn", { currency: total.currency })}:</span>{" "}
          {total.quantifiedTotal === null ? (
            <Unknown hint={t("kpi.valuePool.noneQuantified")} />
          ) : (
            <AmountRange
              downside={total.quantifiedTotal.downside}
              upside={total.quantifiedTotal.upside}
              currency={total.currency}
            />
          )}{" "}
          {isPartialTotal(total) ? (
            <span className="status-chip status-chip--at-risk" data-partial={total.unquantifiedCount}>
              <Icon name="alert" /> {t("kpi.valuePool.partial", { n: total.unquantifiedCount })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
