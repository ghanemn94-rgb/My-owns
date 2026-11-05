// G6 "Benefits evidence" facts (T-DG4-BE-K; ADR-0035 §2; REQ-PB-015): every active benefit of the transformation with
// its Finance-validated measurements (benefit_measurement.status = 'validated', ADR-0030) and its approved transition
// decisions (ADR-0034 §3). A pending value is never counted as validated. Read-only; wired into workflows'
// GateFactsProvider by server.ts.
import type { DbOrTx } from "@mth/db";

export interface BenefitEvidenceGateFact {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly validatedMeasurementIds: readonly string[];
  readonly approvedTransitionDecisionIds: readonly string[];
  /** Marked sensitive (record_sensitivity.is_sensitive; ADR-0051 §2): the readiness item is then neutral (g6.ts). */
  readonly sensitive: boolean;
}

export async function loadBenefitsGateFacts(
  db: DbOrTx,
  transformationId: string,
): Promise<{ transformationId: string; benefits: BenefitEvidenceGateFact[] }> {
  const benefits = await db
    .selectFrom("benefit")
    .select(["id", "code", "title"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .orderBy("code")
    .orderBy("id")
    .execute();
  const measurements = await db
    .selectFrom("benefit_measurement")
    .select(["id", "benefit_id"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "validated")
    .orderBy("measurement_no")
    .orderBy("id")
    .execute();
  const transitions = await db
    .selectFrom("transition_decision")
    .select(["id", "benefit_id"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "approved")
    .orderBy("code")
    .orderBy("id")
    .execute();
  const marked = await db
    .selectFrom("record_sensitivity")
    .select("record_id")
    .where("transformation_id", "=", transformationId)
    .where("record_type", "=", "benefit")
    .where("is_sensitive", "=", true)
    .execute();
  const sensitive = new Set(marked.map((m) => m.record_id));
  return {
    transformationId,
    benefits: benefits.map((b) => ({
      sensitive: sensitive.has(b.id),
      id: b.id,
      code: b.code,
      title: b.title,
      validatedMeasurementIds: measurements.filter((m) => m.benefit_id === b.id).map((m) => m.id),
      approvedTransitionDecisionIds: transitions.filter((t) => t.benefit_id === b.id).map((t) => t.id),
    })),
  };
}
