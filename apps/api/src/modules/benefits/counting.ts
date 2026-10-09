// The typed reader of the `benefit_counting` view (0039; ADR-0029 §6; REQ-PB-058). Shared by the register read model
// (KBE-D) and the totals service (KBE-E). A benefit is counted in a total only when `counted` is true: archived
// benefits, parents (roll-up containers), members of a shared-benefit group other than its counted member (every
// member while none is named) and the excluded side of a Finance `duplicate` overlap resolution are never counted.
// `overlapOpen` keeps a counted benefit's values out of validated and sustained totals until Finance resolves the
// overlap (REQ-S08-014). Read-only; no I/O other than the one query.
import type { DbOrTx } from "@mth/db";
import type { BenefitCountingStatus, BenefitExclusionReason, BenefitValueClass } from "@mth/shared/schemas";

export interface BenefitCounting extends BenefitCountingStatus {
  readonly benefitId: string;
  readonly transformationId: string;
  readonly valueClass: BenefitValueClass;
  readonly currency: string;
}

/** Counting status of each given benefit (absent ids are simply missing from the map). */
export async function countingFor(db: DbOrTx, benefitIds: readonly string[]): Promise<Map<string, BenefitCounting>> {
  const out = new Map<string, BenefitCounting>();
  if (benefitIds.length === 0) return out;
  const rows = await db
    .selectFrom("benefit_counting")
    .selectAll()
    .where("benefit_id", "in", [...benefitIds])
    .execute();
  for (const r of rows) out.set(r.benefit_id!, toCounting(r));
  return out;
}

/** Counting status of every benefit of a transformation. */
export async function countingOfTransformation(db: DbOrTx, transformationId: string): Promise<BenefitCounting[]> {
  const rows = await db
    .selectFrom("benefit_counting")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .execute();
  return rows.map(toCounting);
}

function toCounting(r: {
  benefit_id: string | null;
  transformation_id: string | null;
  value_class: string | null;
  currency: string | null;
  counted: boolean | null;
  exclusion_reason: string | null;
  overlap_open: boolean | null;
}): BenefitCounting {
  return {
    benefitId: r.benefit_id!,
    transformationId: r.transformation_id!,
    valueClass: r.value_class as BenefitValueClass,
    currency: (r.currency ?? "").trim(),
    counted: r.counted === true,
    exclusionReason: (r.exclusion_reason ?? null) as BenefitExclusionReason | null,
    overlapOpen: r.overlap_open === true,
  };
}

/** The API status of a benefit absent from the view (cannot happen for a stored row; fail safe: not counted). */
export const NOT_COUNTED: BenefitCountingStatus = Object.freeze({
  counted: false,
  exclusionReason: null,
  overlapOpen: false,
});
