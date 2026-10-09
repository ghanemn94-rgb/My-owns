// Benefit totals counted once (P4 slice B; ADR-0030 §7, §8; T-DG4-KBE-E; REQ-PB-058, REQ-PB-075, REQ-PB-076,
// REQ-S08-009, REQ-S08-011, REQ-S08-014, REQ-S08-016, REQ-S16-025):
//   GET /transformations/{t}/benefit-totals[?initiativeId=]   the transformation (or one initiative's allocated view)
//   GET /organizations/{o}/benefit-totals                     the transformations of the organization the caller may read
//
// The arithmetic is `computeTotals`, a PURE function over decimal strings (decimal.js, FORMULA_DECIMAL precision 80;
// never a JavaScript number for money, rates or shares; rounding to the money scale only at presentation):
//  1. benefits counted once: only `benefit_counting.counted` benefits are summed, whatever their allocations; a parent
//     is a roll-up container, so values are summed at its children once (REQ-PB-058); excluded benefits are listed with
//     their reason and never summed;
//  2. one line per value class × state × currency; revenue uplift vs margin and avoided cost vs cash savings are
//     separate lines, never converted (REQ-S08-009); currencies are never converted (each its own block); a total is
//     always for ONE state (planned, forecast, measured, submitted, validated, sustained, rejected): pending
//     (submitted) is never validated (REQ-S08-016) and scenarios are never read (REQ-S08-018);
//  3. non-financial benefits without an approved valuation method are counted in `nonFinancialCount` (Value n/a) and
//     are in no SAR line: never summed as 0 (REQ-PB-076);
//  4. an open overlap warning moves a benefit's validated and sustained values to `pendingOverlap` lines, out of the
//     validated lines, until Finance resolves it (REQ-S08-014);
//  5. gross (planned, validated) = the sum of the five financial classes' lines of that state; implementationCost =
//     each active business-case investment line once (transformation and initiative cases; a line belongs to exactly
//     one case), cash and non-cash apart; net = gross − implementationCost, so a 1 M SAR initiative cost reduces the
//     transformation's net by exactly 1 M SAR (REQ-S08-011). A missing amount anywhere makes that total Unknown with a
//     reason, never 0;
//  6. an initiative view (`initiativeId`) shows share × value of the benefits allocated to it (labelled `allocated`)
//     and that initiative's own cost lines; it is a view, never added to a transformation total.
// Reads only; no state change. Nothing here relates to the engineering gates DG0-DG7.
import { sql, type DbOrTx } from "@mth/db";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import {
  BENEFIT_TOTAL_CLASSES,
  BENEFIT_VALUE_STATES,
  benefitTotalsQuery,
  type BenefitAmount,
  type BenefitExclusionReason,
  type BenefitTotalClass,
  type BenefitTotalLine,
  type BenefitTotals,
  type BenefitTotalsCurrency,
  type BenefitValueState,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { organizationsWith, principalOf, requireTransformationRead, scopeFilter } from "../access/index.ts";
import { parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import { money4 } from "./values.ts";

// ------------------------------------------------------------------------------------------------ the pure core

/** A benefit as the totals see it (from benefit_counting + benefit). */
export interface TotalsBenefit {
  readonly id: string;
  readonly code: string;
  readonly valueClass: string;
  readonly currency: string;
  readonly counted: boolean;
  readonly exclusionReason: BenefitExclusionReason | null;
  readonly overlapOpen: boolean;
  /** Non-financial without an approved valuation method: Value n/a, never in a SAR line. */
  readonly unmonetised: boolean;
  /** The allocated share (fraction) in an initiative view; undefined in a transformation or portfolio total. */
  readonly share?: string;
}

/** One stored value (a benefit_value_line row). `amount` null = no amount (Unknown, or a KPI-only value). */
export interface TotalsValueLine {
  readonly benefitId: string;
  readonly state: string;
  readonly amount: string | null;
}

/** One business-case investment line (its DG3 value_basis is cash or non_cash). */
export interface TotalsCostLine {
  readonly amount: string | null;
  readonly currency: string;
  readonly valueBasis: string;
}

export interface TotalsInput {
  readonly benefits: readonly TotalsBenefit[];
  readonly lines: readonly TotalsValueLine[];
  readonly costLines: readonly TotalsCostLine[];
}

export interface TotalsResult {
  readonly currencies: BenefitTotalsCurrency[];
  readonly nonFinancialCount: number;
  readonly excluded: { benefitId: string; code: string; reason: BenefitExclusionReason }[];
}

const FINANCIAL_TOTAL_CLASSES: readonly BenefitTotalClass[] = [
  "revenue_uplift",
  "margin_uplift",
  "cash_saving",
  "avoided_cost",
  "working_capital_release",
];

/** Known amount at the money presentation scale. */
export function known(value: string, currency: string): BenefitAmount {
  return { status: "known", amount: money4(value), currency, reason: null };
}

export function unknownAmount(currency: string, reason: string): BenefitAmount {
  return { status: "unknown", amount: null, currency, reason };
}

/**
 * The exact sum of amounts, or Unknown with `reason` when one is null (a missing input is never 0). An empty list is a
 * known 0 ("0.0000").
 */
export function sumOrUnknown(amounts: readonly (string | null)[], currency: string, reason: string): BenefitAmount {
  if (amounts.some((a) => a === null)) return unknownAmount(currency, reason);
  return known(amounts.reduce((acc, a) => acc.plus(new D(a!)), new D(0)).toFixed(), currency);
}

/** a + b of known amounts (exact); Unknown when either is unknown (the first reason wins). */
export function addAmounts(a: BenefitAmount, b: BenefitAmount, currency: string): BenefitAmount {
  if (a.status !== "known") return unknownAmount(currency, a.reason ?? "benefit.value_amount_missing");
  if (b.status !== "known") return unknownAmount(currency, b.reason ?? "benefit.value_amount_missing");
  return known(new D(a.amount!).plus(new D(b.amount!)).toFixed(), currency);
}

/** a − b of known amounts (exact); Unknown when either is unknown (the first reason wins). */
export function subtractAmounts(a: BenefitAmount, b: BenefitAmount, currency: string): BenefitAmount {
  if (a.status !== "known") return unknownAmount(currency, a.reason ?? "benefit.value_amount_missing");
  if (b.status !== "known") return unknownAmount(currency, b.reason ?? "benefit.cost_amount_missing");
  return known(new D(a.amount!).minus(new D(b.amount!)).toFixed(), currency);
}

function totalClassOf(b: TotalsBenefit): BenefitTotalClass {
  return b.valueClass === "non_financial" ? "non_financial_valued" : (b.valueClass as BenefitTotalClass);
}

/** share × amount (exact; the initiative view). */
function scaled(amount: string | null, share: string | undefined): string | null {
  if (amount === null || share === undefined) return amount;
  return new D(amount).times(new D(share)).toFixed();
}

/**
 * The totals of ADR-0030 §7 over plain decimal strings. Deterministic: currencies sorted, lines in class × state order.
 */
export function computeTotals(input: TotalsInput): TotalsResult {
  const excluded = input.benefits
    .filter((b) => !b.counted)
    .map((b) => ({ benefitId: b.id, code: b.code, reason: b.exclusionReason ?? ("archived" as const) }))
    .sort((x, y) => x.code.localeCompare(y.code) || x.benefitId.localeCompare(y.benefitId));
  const counted = input.benefits.filter((b) => b.counted);
  const nonFinancialCount = counted.filter((b) => b.unmonetised).length;
  const summed = new Map(counted.filter((b) => !b.unmonetised).map((b) => [b.id, b]));
  const currencies = [
    ...new Set([...[...summed.values()].map((b) => b.currency), ...input.costLines.map((c) => c.currency)]),
  ].sort();
  const out: BenefitTotalsCurrency[] = [];
  for (const currency of currencies) {
    const mine = [...summed.values()].filter((b) => b.currency === currency);
    const classes = BENEFIT_TOTAL_CLASSES.filter((c) => mine.some((b) => totalClassOf(b) === c));
    const lines: BenefitTotalLine[] = [];
    const pendingOverlap: BenefitTotalLine[] = [];
    const amountsOf = (cls: BenefitTotalClass, state: BenefitValueState, overlap: boolean) =>
      input.lines
        .filter((l) => l.state === state)
        .filter((l) => {
          const b = summed.get(l.benefitId);
          if (!b || b.currency !== currency || totalClassOf(b) !== cls) return false;
          const heldBack = b.overlapOpen && (state === "validated" || state === "sustained");
          return overlap ? heldBack : !heldBack;
        })
        .map((l) => scaled(l.amount, summed.get(l.benefitId)!.share));
    for (const cls of classes)
      for (const state of BENEFIT_VALUE_STATES) {
        const amounts = amountsOf(cls, state, false);
        lines.push({
          valueClass: cls,
          state,
          total: sumOrUnknown(amounts, currency, "benefit.value_amount_missing"),
          count: amounts.length,
        });
        if (state === "validated" || state === "sustained") {
          const held = amountsOf(cls, state, true);
          if (held.length > 0)
            pendingOverlap.push({
              valueClass: cls,
              state,
              total: sumOrUnknown(held, currency, "benefit.value_amount_missing"),
              count: held.length,
            });
        }
      }
    const gross = (state: BenefitValueState): BenefitAmount =>
      lines
        .filter((l) => l.state === state && FINANCIAL_TOTAL_CLASSES.includes(l.valueClass))
        .reduce<BenefitAmount>((acc, l) => addAmounts(acc, l.total, currency), known("0", currency));
    const costs = input.costLines.filter((c) => c.currency === currency);
    const reason = "benefit.cost_amount_missing";
    const cash = sumOrUnknown(
      costs.filter((c) => c.valueBasis === "cash").map((c) => c.amount),
      currency,
      reason,
    );
    const nonCash = sumOrUnknown(
      costs.filter((c) => c.valueBasis !== "cash").map((c) => c.amount),
      currency,
      reason,
    );
    const costTotal = addAmounts(cash, nonCash, currency);
    const grossPlanned = gross("planned");
    const grossValidated = gross("validated");
    out.push({
      currency,
      lines,
      pendingOverlap,
      gross: { planned: grossPlanned, validated: grossValidated },
      implementationCost: { cash, nonCash, total: costTotal },
      net: {
        planned: subtractAmounts(grossPlanned, costTotal, currency),
        validated: subtractAmounts(grossValidated, costTotal, currency),
      },
    });
  }
  return { currencies: out, nonFinancialCount, excluded };
}

// ------------------------------------------------------------------------------------------------ loading

/** Benefits of the transformations with their counting status and whether they are unmonetised. */
async function loadBenefits(db: DbOrTx, transformationIds: readonly string[]): Promise<TotalsBenefit[]> {
  if (transformationIds.length === 0) return [];
  const rows = await db
    .selectFrom("benefit_counting as c")
    .innerJoin("benefit as b", "b.id", "c.benefit_id")
    .leftJoin("benefit_valuation_method as m", "m.id", "b.valuation_method_id")
    .select([
      "b.id",
      "b.code",
      "b.value_class",
      "b.currency",
      "c.counted",
      "c.exclusion_reason",
      "c.overlap_open",
      "m.status as method_status",
    ])
    .where("b.transformation_id", "in", [...transformationIds])
    .orderBy("b.code")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    valueClass: r.value_class,
    currency: r.currency.trim(),
    counted: r.counted === true,
    exclusionReason: (r.exclusion_reason ?? null) as BenefitExclusionReason | null,
    overlapOpen: r.overlap_open === true,
    unmonetised: r.value_class === "non_financial" && r.method_status !== "approved",
  }));
}

async function loadLines(db: DbOrTx, benefitIds: readonly string[]): Promise<TotalsValueLine[]> {
  if (benefitIds.length === 0) return [];
  const rows = await db
    .selectFrom("benefit_value_line")
    .select(["benefit_id", "value_state", "amount"])
    .where("benefit_id", "in", [...benefitIds])
    .execute();
  // View columns are typed nullable; benefit_id and value_state are never NULL in benefit_value_line (0039).
  return rows.map((r) => ({ benefitId: r.benefit_id!, state: r.value_state!, amount: r.amount }));
}

/** Active investment lines of the non-archived business cases (each line once); optionally one initiative's own. */
async function loadCostLines(
  db: DbOrTx,
  transformationIds: readonly string[],
  initiativeId: string | null,
): Promise<TotalsCostLine[]> {
  if (transformationIds.length === 0) return [];
  let q = db
    .selectFrom("business_case_line as l")
    .innerJoin("business_case as c", "c.id", "l.business_case_id")
    .select(["l.amount", "l.currency", "l.value_basis"])
    .where("l.transformation_id", "in", [...transformationIds])
    .where("l.line_kind", "=", "investment")
    .where("l.status", "=", "active")
    .where("c.status", "<>", "archived");
  if (initiativeId !== null) q = q.where("c.level", "=", "initiative").where("c.initiative_id", "=", initiativeId);
  const rows = await q.execute();
  return rows.map((r) => ({ amount: r.amount, currency: r.currency.trim(), valueBasis: r.value_basis }));
}

/** The totals of a set of transformations (or one initiative's allocated view). */
export async function totalsOf(
  db: DbOrTx,
  transformationIds: readonly string[],
  initiativeId: string | null,
): Promise<TotalsResult> {
  let benefits = await loadBenefits(db, transformationIds);
  if (initiativeId !== null) {
    const shares = await db
      .selectFrom("benefit_allocation as a")
      .innerJoin("benefit as b", (j) =>
        j.onRef("b.id", "=", "a.benefit_id").onRef("b.allocation_set_no", "=", "a.set_no"),
      )
      .select(["a.benefit_id", "a.share"])
      .where("a.initiative_id", "=", initiativeId)
      .execute();
    const shareOf = new Map(shares.map((s) => [s.benefit_id, s.share]));
    benefits = benefits.filter((b) => shareOf.has(b.id)).map((b) => ({ ...b, share: shareOf.get(b.id)! }));
  }
  const lines = await loadLines(
    db,
    benefits.map((b) => b.id),
  );
  const costLines = await loadCostLines(db, transformationIds, initiativeId);
  return computeTotals({ benefits, lines, costLines });
}

// ------------------------------------------------------------------------------------------------ routes

const TOTALS = "/api/v1/transformations/:transformationId/benefit-totals";
const PORTFOLIO_TOTALS = "/api/v1/organizations/:organizationId/benefit-totals";

export function registerBenefitTotalRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(TOTALS, { config: read }, async (request): Promise<BenefitTotals> => {
    const { transformationId } = parse(z.strictObject({ transformationId: z.uuid() }), request.params, "params");
    const query = parseQuery(benefitTotalsQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const initiativeId = query.initiativeId ?? null;
    if (initiativeId !== null) {
      const ini = await db
        .selectFrom("initiative")
        .select("id")
        .where("id", "=", initiativeId)
        .where("transformation_id", "=", transformationId)
        .executeTakeFirst();
      if (!ini) throw problems.notFound();
    }
    const t = await totalsOf(db, [transformationId], initiativeId);
    return {
      scope: initiativeId === null ? "transformation" : "initiative",
      scopeId: initiativeId ?? transformationId,
      allocated: initiativeId !== null,
      transformationIds: [transformationId],
      currencies: t.currencies,
      nonFinancialCount: t.nonFinancialCount,
      excluded: t.excluded,
      computedAt: new Date().toISOString(),
    };
  });

  app.get(
    PORTFOLIO_TOTALS,
    { config: { access: { permission: "organization.read" as const } } },
    async (request): Promise<BenefitTotals> => {
      const { organizationId } = parse(z.strictObject({ organizationId: z.uuid() }), request.params, "params");
      const principal = principalOf(request);
      if (!organizationsWith(principal, "organization.read").includes(organizationId)) throw problems.notFound();
      const rows = await db
        .selectFrom("transformation as t")
        .select("t.id")
        .where("t.organization_id", "=", organizationId)
        .where(
          scopeFilter(principal, "transformation.read", {
            level: "transformation",
            organizationId: sql.ref("t.organization_id"),
            businessUnitId: sql.ref("t.business_unit_id"),
            transformationId: sql.ref("t.id"),
          }),
        )
        .orderBy("t.id")
        .execute();
      const ids = rows.map((r) => r.id);
      const t = await totalsOf(db, ids, null);
      return {
        scope: "organization",
        scopeId: organizationId,
        allocated: false,
        transformationIds: ids,
        currencies: t.currencies,
        nonFinancialCount: t.nonFinancialCount,
        excluded: t.excluded,
        computedAt: new Date().toISOString(),
      };
    },
  );

  return [`GET ${TOTALS}`, `GET ${PORTFOLIO_TOTALS}`];
}
