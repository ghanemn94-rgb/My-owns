// Business-case totals and the transformation roll-up (ADR-0024 §3; REQ-S05-005, REQ-PB-054; T-DG3-KBE-B). PURE: no
// I/O, unit-tested in totals.test.ts with worked fixtures. The route (business-cases.ts) loads the active lines of the
// included cases and calls `computeTotals`.
//
// Rules:
//  - The line set is a SET OF LINE IDS: own lines ∪ lines of the active initiative cases (for a transformation case),
//    taken by reference, never copied. Each distinct line is counted exactly once, even if it is handed in twice.
//  - Gross benefits (financial benefit lines), implementation cost (all investment lines, with cash and non-cash
//    subtotals) and net value (gross − implementation cost) are reported SEPARATELY; net is shown next to, never
//    instead of, its two inputs, and a cost is subtracted exactly once (it is one line in one case).
//  - Revenue uplift and margin uplift are reported apart (`grossBenefitsByValueBasis`), and avoided cost apart from cash
//    savings; a case holding revenue AND margin uplift lines gets the warning `business_case.revenue_and_margin`.
//  - Strategic / non-financial benefits are never monetised: they are counted (`nonFinancialBenefitCount`), never
//    summed.
//  - Unknown is never 0: a line with a null amount is Unknown and counted in `unknownLineCount`; a total whose lines
//    are all Unknown has `amount: null`. Net value is Unknown unless BOTH gross benefits and implementation cost have a
//    known amount in that currency (a case without cost lines has an unknown cost, not a zero cost).
//  - Per currency, no FX: amounts in different currencies are never added; each currency has its own MoneyTotal.
//  - Decimal arithmetic only (decimal.js); no JavaScript number ever holds an amount.
import type {
  BusinessCaseLineClass,
  BusinessCaseTotals,
  LineKind,
  MoneyTotal,
  ValueBasis,
  Warning,
} from "@mth/shared/schemas";
import { Decimal } from "decimal.js";

const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -80, toExpPos: 80 });
type Dec = InstanceType<typeof D>;

/** One active line as the totals read it. `amount` is the stored decimal string, or null when Unknown. */
export interface TotalsLine {
  readonly id: string;
  readonly businessCaseId: string;
  readonly lineKind: LineKind;
  readonly class: BusinessCaseLineClass;
  readonly valueBasis: ValueBasis;
  readonly title: string;
  readonly amount: string | null;
  readonly currency: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
}

export interface TotalsInput {
  /** The case whose totals are asked for. */
  readonly businessCaseId: string;
  /** The case itself, then (for a transformation case) its active initiative cases. */
  readonly includedCaseIds: readonly string[];
  /** The transformation-level case among the included ones (for the overlap warning), or null. */
  readonly transformationCaseId: string | null;
  readonly lines: readonly TotalsLine[];
}

const canonical = (d: Dec): string => (d.isZero() ? "0" : d.toFixed());

/** Per-currency totals of `lines` (each already distinct), sorted by currency code. */
export function moneyTotals(lines: readonly TotalsLine[]): MoneyTotal[] {
  const by = new Map<string, { sum: Dec; known: number; unknown: number }>();
  for (const l of lines) {
    const t = by.get(l.currency) ?? { sum: new D(0), known: 0, unknown: 0 };
    if (l.amount === null) t.unknown += 1;
    else {
      t.sum = t.sum.plus(new D(l.amount));
      t.known += 1;
    }
    by.set(l.currency, t);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, t]) => ({
      currency,
      amount: t.known === 0 ? null : canonical(t.sum),
      unknownLineCount: t.unknown,
      lineCount: t.known + t.unknown,
    }));
}

/** Net value per currency: gross − cost, Unknown unless both sides have a known amount in that currency. */
export function netTotals(gross: readonly MoneyTotal[], cost: readonly MoneyTotal[]): MoneyTotal[] {
  const currencies = [...new Set([...gross.map((g) => g.currency), ...cost.map((c) => c.currency)])].sort();
  return currencies.map((currency) => {
    const g = gross.find((x) => x.currency === currency);
    const c = cost.find((x) => x.currency === currency);
    const amount =
      g?.amount === null || g?.amount === undefined || c?.amount === null || c?.amount === undefined
        ? null
        : canonical(new D(g.amount).minus(new D(c.amount)));
    return {
      currency,
      amount,
      unknownLineCount: (g?.unknownLineCount ?? 0) + (c?.unknownLineCount ?? 0),
      lineCount: (g?.lineCount ?? 0) + (c?.lineCount ?? 0),
    };
  });
}

function groupedTotals<K extends string>(lines: readonly TotalsLine[], key: (l: TotalsLine) => K) {
  const groups = new Map<K, TotalsLine[]>();
  for (const l of lines) groups.set(key(l), [...(groups.get(key(l)) ?? []), l]);
  return Object.fromEntries([...groups.keys()].sort().map((k) => [k, moneyTotals(groups.get(k)!)] as const)) as Record<
    string,
    MoneyTotal[]
  >;
}

/** Title comparison key for the overlap warning: NFKC, lower case, inner whitespace collapsed, trimmed. */
export function normaliseTitle(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Do two [start, end] date ranges overlap? A missing bound is open (unknown periods are treated as overlapping). */
export function periodsOverlap(
  a: { periodStart: string | null; periodEnd: string | null },
  b: { periodStart: string | null; periodEnd: string | null },
): boolean {
  const startsBeforeEnd = (s: string | null, e: string | null) => s === null || e === null || s <= e;
  return startsBeforeEnd(a.periodStart, b.periodEnd) && startsBeforeEnd(b.periodStart, a.periodEnd);
}

export const REVENUE_AND_MARGIN_MESSAGE =
  "The case holds both revenue uplift and margin uplift lines; check that the margin is not the same revenue counted twice.";

/** 'Possible duplicate: {title} ({class}) appears at the transformation level and in an initiative case' */
export function possibleDuplicateMessage(title: string, cls: string): string {
  return `Possible duplicate: ${title} (${cls}) appears at the transformation level and in an initiative case with an overlapping period; Finance resolves the overlap.`;
}

/** The totals of one case (ADR-0024 §3), each distinct line counted once. */
export function computeTotals(input: TotalsInput): BusinessCaseTotals {
  const included = new Set(input.includedCaseIds);
  // The set of distinct lines, by id: a line handed in twice is still one line.
  const distinct = new Map<string, TotalsLine>();
  for (const l of input.lines) if (included.has(l.businessCaseId) && !distinct.has(l.id)) distinct.set(l.id, l);
  const lines = [...distinct.values()];

  const benefits = lines.filter((l) => l.lineKind === "benefit");
  const financial = benefits.filter((l) => l.class !== "strategic_non_financial");
  const investment = lines.filter((l) => l.lineKind === "investment");

  const grossBenefits = moneyTotals(financial);
  const implementationCost = moneyTotals(investment);

  const warnings: Warning[] = [];
  if (
    financial.some((l) => l.valueBasis === "revenue_uplift") &&
    financial.some((l) => l.valueBasis === "margin_uplift")
  )
    warnings.push({ code: "business_case.revenue_and_margin", message: REVENUE_AND_MARGIN_MESSAGE });
  if (input.transformationCaseId !== null) {
    const top = lines.filter((l) => l.businessCaseId === input.transformationCaseId);
    const below = lines.filter((l) => l.businessCaseId !== input.transformationCaseId);
    const seen = new Set<string>();
    for (const t of top)
      for (const i of below) {
        if (t.class !== i.class || normaliseTitle(t.title) !== normaliseTitle(i.title) || !periodsOverlap(t, i))
          continue;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        warnings.push({
          code: "business_case.possible_duplicate",
          message: possibleDuplicateMessage(t.title, t.class),
        });
      }
  }

  return {
    businessCaseId: input.businessCaseId,
    includedCaseIds: [...input.includedCaseIds],
    grossBenefits,
    grossBenefitsByClass: groupedTotals(financial, (l) => l.class),
    grossBenefitsByValueBasis: groupedTotals(financial, (l) => l.valueBasis),
    implementationCost,
    implementationCostCash: moneyTotals(investment.filter((l) => l.valueBasis === "cash")),
    implementationCostNonCash: moneyTotals(investment.filter((l) => l.valueBasis === "non_cash")),
    netValue: netTotals(grossBenefits, implementationCost),
    nonFinancialBenefitCount: benefits.length - financial.length,
    warnings,
  };
}
