// Read-only benefit facts for the slice J dashboards (T-DG4-KBE-G; ADR-0037 §1 item 2, §3 Value, §5; ADR-0030 §6-§7;
// p4-work-split §J+K JK.4). The counting rules are slice B's: `benefit_counting.counted` (a shared or parent benefit
// counts once), `overlap_open` (validated values held back until Finance resolves the overlap), and the unmonetised
// rule of the totals service (a non-financial benefit without an approved valuation method is Value n/a, never 0).
// Values come from the `benefit_value_line` view, one row per value and state; scenarios are never read (REQ-S08-018).
// Investment is the business-case investment lines, each once (as `totals.ts` loadCostLines). Nothing is written.
import type { DbOrTx } from "@mth/db";

export interface BenefitDashboardBenefit {
  readonly benefitId: string;
  readonly transformationId: string;
  readonly code: string;
  readonly title: string;
  readonly ownerUserId: string | null;
  readonly valueClass: string;
  readonly currency: string;
  readonly counted: boolean;
  readonly overlapOpen: boolean;
  readonly unmonetised: boolean;
}

export interface BenefitDashboardLine {
  readonly benefitId: string;
  readonly transformationId: string;
  readonly state: string;
  readonly amount: string | null;
  readonly currency: string;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly recordTable: string;
  readonly recordId: string;
}

export interface BenefitDashboardInvestment {
  readonly recordId: string;
  readonly transformationId: string;
  readonly businessCaseId: string;
  readonly label: string | null;
  readonly amount: string | null;
  readonly currency: string;
}

export interface BenefitDashboardAllocation {
  readonly benefitId: string;
  readonly initiativeId: string;
  readonly share: string;
}

export interface BenefitDashboardFacts {
  readonly benefits: BenefitDashboardBenefit[];
  readonly lines: BenefitDashboardLine[];
  readonly investment: BenefitDashboardInvestment[];
  /** The current allocation set of every benefit (share is a decimal fraction). */
  readonly allocations: BenefitDashboardAllocation[];
}

/** The value states the dashboards read (measured, sustained and rejected are not dashboard headlines). */
const DASHBOARD_STATES = ["planned", "forecast", "submitted", "validated"] as const;

/** Benefit facts of the transformations (all of them; the dashboards apply the window and the owner filter). */
export async function loadBenefitDashboardFacts(
  db: DbOrTx,
  transformationIds: readonly string[],
): Promise<BenefitDashboardFacts> {
  if (transformationIds.length === 0) return { benefits: [], lines: [], investment: [], allocations: [] };
  const ids = [...transformationIds];
  const rows = await db
    .selectFrom("benefit_counting as c")
    .innerJoin("benefit as b", "b.id", "c.benefit_id")
    .leftJoin("benefit_valuation_method as m", "m.id", "b.valuation_method_id")
    .select([
      "b.id",
      "b.transformation_id",
      "b.code",
      "b.title",
      "b.owner_user_id",
      "b.value_class",
      "b.currency",
      "c.counted",
      "c.overlap_open",
      "m.status as method_status",
    ])
    .where("b.transformation_id", "in", ids)
    .orderBy("b.code")
    .orderBy("b.id")
    .execute();
  const benefits = rows.map((r) => ({
    benefitId: r.id,
    transformationId: r.transformation_id,
    code: r.code,
    title: r.title,
    ownerUserId: r.owner_user_id,
    valueClass: r.value_class,
    currency: r.currency.trim(),
    counted: r.counted === true,
    overlapOpen: r.overlap_open === true,
    unmonetised: r.value_class === "non_financial" && r.method_status !== "approved",
  }));
  const lineRows =
    benefits.length === 0
      ? []
      : await db
          .selectFrom("benefit_value_line")
          .select([
            "benefit_id",
            "transformation_id",
            "value_state",
            "amount",
            "currency",
            "period_start",
            "period_end",
            "record_table",
            "record_id",
          ])
          .where("transformation_id", "in", ids)
          .where("value_state", "in", [...DASHBOARD_STATES])
          .orderBy("benefit_id")
          .orderBy("record_id")
          .execute();
  // View columns are typed nullable; benefit_id, value_state, currency, record_* are never NULL in 0039.
  const lines = lineRows.map((r) => ({
    benefitId: r.benefit_id!,
    transformationId: r.transformation_id!,
    state: r.value_state!,
    amount: r.amount,
    currency: r.currency!.trim(),
    periodStart: r.period_start,
    periodEnd: r.period_end,
    recordTable: r.record_table!,
    recordId: r.record_id!,
  }));
  const investmentRows = await db
    .selectFrom("business_case_line as l")
    .innerJoin("business_case as c", "c.id", "l.business_case_id")
    .select(["l.id", "l.transformation_id", "l.business_case_id", "l.title", "l.amount", "l.currency"])
    .where("l.transformation_id", "in", ids)
    .where("l.line_kind", "=", "investment")
    .where("l.status", "=", "active")
    .where("c.status", "<>", "archived")
    .orderBy("l.id")
    .execute();
  const investment = investmentRows.map((r) => ({
    recordId: r.id,
    transformationId: r.transformation_id,
    businessCaseId: r.business_case_id,
    label: r.title,
    amount: r.amount,
    currency: r.currency.trim(),
  }));
  const allocationRows =
    benefits.length === 0
      ? []
      : await db
          .selectFrom("benefit_allocation as a")
          .innerJoin("benefit as b", (j) =>
            j.onRef("b.id", "=", "a.benefit_id").onRef("b.allocation_set_no", "=", "a.set_no"),
          )
          .select(["a.benefit_id", "a.initiative_id", "a.share"])
          .where("a.transformation_id", "in", ids)
          .orderBy("a.benefit_id")
          .orderBy("a.initiative_id")
          .execute();
  const allocations = allocationRows.map((r) => ({
    benefitId: r.benefit_id,
    initiativeId: r.initiative_id,
    share: r.share,
  }));
  return { benefits, lines, investment, allocations };
}

/** The evidence linked to value lines (benefit_evidence of the measurements): the validated drill-down's evidence. */
export async function loadBenefitLineEvidence(db: DbOrTx, measurementIds: readonly string[]) {
  if (measurementIds.length === 0) return [];
  return db
    .selectFrom("benefit_evidence as l")
    .innerJoin("evidence as e", "e.id", "l.evidence_id")
    .select(["e.id", "e.title", "e.review_status", "l.measurement_id"])
    .where("l.measurement_id", "in", [...measurementIds])
    .orderBy("e.id")
    .execute();
}
