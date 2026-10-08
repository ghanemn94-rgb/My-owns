// Totals of one business case (REQ-S05-005, REQ-PB-054; ADR-0024 §3, §9). Gross benefits, implementation cost
// (cash and non-cash shown apart) and net value are shown SEPARATELY, per currency (no FX). A total whose lines are
// all Unknown is Unknown, never 0; a total that leaves Unknown lines out says so; net value is Unknown unless both
// sides are known. A transformation case rolls up its initiative cases by reference: each distinct line once.
import type { BusinessCase, BusinessCaseTotals, MoneyTotal } from "@mth/shared/schemas";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Unknown } from "../../components/Badges.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Section } from "../../components/Section.tsx";
import { QueryState } from "../../components/States.tsx";
import { useWorkspace } from "../../components/Workspace.tsx";
import { useBusinessCases, useCaseTotals } from "./api.ts";
import { Money, ownProblemText } from "./formKit.tsx";

function TotalValue({ total, unknownHint }: { total: MoneyTotal | undefined; unknownHint: string }) {
  const { t } = useTranslation();
  if (!total || total.amount === null) return <Unknown hint={unknownHint} />;
  return (
    <span>
      <Money value={total.amount} currency={total.currency} />
      {total.unknownLineCount > 0 ? (
        <span className="status-chip status-chip--at-risk small" data-partial={total.unknownLineCount}>
          <Icon name="alert" /> {t("businessCases.totals.partial", { count: total.unknownLineCount })}
        </span>
      ) : null}
    </span>
  );
}

const byCurrency = (list: readonly MoneyTotal[], currency: string) => list.find((m) => m.currency === currency);

export function CaseTotals({ bc }: { bc: BusinessCase }) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const totals = useCaseTotals(ws.tid, bc.id);
  const cases = useBusinessCases(ws.tid);
  return (
    <Section id="totals" title={t("businessCases.totals.title")} intro={t("businessCases.totals.intro")}>
      <QueryState query={totals}>{(data) => <TotalsBody data={data} bc={bc} cases={cases.data ?? []} />}</QueryState>
    </Section>
  );
}

function TotalsBody({
  data,
  bc,
  cases,
}: {
  data: BusinessCaseTotals;
  bc: BusinessCase;
  cases: readonly BusinessCase[];
}) {
  const { t } = useTranslation();
  const ws = useWorkspace();
  const currencies = [
    ...new Set([...data.grossBenefits, ...data.implementationCost, ...data.netValue].map((m) => m.currency)),
  ];
  if (currencies.length === 0) currencies.push(bc.currency);
  const others = data.includedCaseIds.filter((id) => id !== bc.id);
  return (
    <div data-totals={bc.id}>
      {bc.level === "transformation" ? (
        <p data-roll-up={data.includedCaseIds.length}>
          <Icon name="info" /> {t("businessCases.totals.rollUp", { count: others.length })}{" "}
          {others.map((id) => {
            const c = cases.find((x) => x.id === id);
            return (
              <Link key={id} className="link" to={`/transformations/${ws.tid}/business-cases/${id}`}>
                <bdi dir="ltr" className="code">
                  {c?.code ?? id.slice(-4)}
                </bdi>{" "}
              </Link>
            );
          })}
        </p>
      ) : (
        <p className="muted">{t("businessCases.totals.ownOnly")}</p>
      )}
      {currencies.map((currency) => {
        const gross = byCurrency(data.grossBenefits, currency);
        const cost = byCurrency(data.implementationCost, currency);
        const net = byCurrency(data.netValue, currency);
        return (
          <div key={currency} className="card" data-currency={currency}>
            <h3 className="card__subtitle">{t("businessCases.totals.inCurrency", { currency })}</h3>
            <dl className="details">
              <div data-total="gross">
                <dt>{t("businessCases.totals.gross")}</dt>
                <dd>
                  <TotalValue total={gross} unknownHint={t("businessCases.totals.unknownSide")} />
                </dd>
              </div>
              <div data-total="cost">
                <dt>{t("businessCases.totals.cost")}</dt>
                <dd>
                  <TotalValue total={cost} unknownHint={t("businessCases.totals.unknownSide")} />
                  <span className="block small">
                    {t("businessCases.totals.cash")}:{" "}
                    <TotalValue
                      total={byCurrency(data.implementationCostCash, currency)}
                      unknownHint={t("businessCases.totals.unknownSide")}
                    />
                  </span>
                  <span className="block small">
                    {t("businessCases.totals.nonCash")}:{" "}
                    <TotalValue
                      total={byCurrency(data.implementationCostNonCash, currency)}
                      unknownHint={t("businessCases.totals.unknownSide")}
                    />
                  </span>
                </dd>
              </div>
              <div data-total="net">
                <dt>{t("businessCases.totals.net")}</dt>
                <dd>
                  <TotalValue total={net} unknownHint={t("businessCases.totals.netUnknown")} />
                  <span className="block small muted">{t("businessCases.totals.netNote")}</span>
                </dd>
              </div>
            </dl>
            <Breakdown
              title={t("businessCases.totals.byClass")}
              entries={Object.entries(data.grossBenefitsByClass)}
              label={(k) => t(`businessCases.class.${k}`, { defaultValue: k })}
              currency={currency}
            />
            <Breakdown
              title={t("businessCases.totals.byValueBasis")}
              entries={Object.entries(data.grossBenefitsByValueBasis)}
              label={(k) => t(`businessCases.valueBasis.${k}`, { defaultValue: k })}
              currency={currency}
            />
          </div>
        );
      })}
      {data.nonFinancialBenefitCount > 0 ? (
        <p className="muted" data-non-financial={data.nonFinancialBenefitCount}>
          {t("businessCases.totals.nonFinancial", { count: data.nonFinancialBenefitCount })}
        </p>
      ) : null}
      {data.warnings.length > 0 ? (
        <ul className="plain-list" aria-label={t("businessCases.totals.warnings")}>
          {data.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="banner banner--warning" data-warning={w.code}>
              <Icon name="alert" /> {ownProblemText(t, w.code) || t("businessCases.totals.otherWarning")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Breakdown({
  title,
  entries,
  label,
  currency,
}: {
  title: string;
  entries: readonly [string, readonly MoneyTotal[]][];
  label: (key: string) => string;
  currency: string;
}) {
  const rows = entries
    .map(([key, list]) => [key, list.find((m) => m.currency === currency)] as const)
    .filter((r): r is readonly [string, MoneyTotal] => r[1] !== undefined);
  if (rows.length === 0) return null;
  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <caption>{title}</caption>
        <tbody>
          {rows.map(([key, total]) => (
            <tr key={key}>
              <th scope="row">{label(key)}</th>
              <td>
                <TotalValue total={total} unknownHint={title} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
