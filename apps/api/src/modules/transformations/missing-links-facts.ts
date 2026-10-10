// The read-only facts of the Modular-entry missing-link rule (T-DG4-BE-M2; ADR-0038 §7.3; REQ-PB-005, REQ-S03-005).
//
// One query set, read by BOTH the missing-link read model (reporting/modular.ts) and the Modular G3 precondition
// (workflows/gates.ts; D-106 (e)), so the two cannot drift; the rule itself is the pure `deriveMissingLinks` of
// @mth/shared/schemas (missing-links.ts). `reporting` may not import `workflows` and `workflows` may not import
// `reporting` or `portfolio`; both may import `transformations` (p4-work-split JK.10 item 4).
//
// It reads in the caller's connection or transaction (inside the submitting transaction on submit) and writes nothing.
import { sql, type DbOrTx } from "@mth/db";
import type { MissingLinkFacts } from "@mth/shared/schemas";

/** The transformation's entry facts (the `MissingLinks` header). Null when the transformation does not exist. */
export interface ModularEntryFacts {
  readonly mode: "end_to_end" | "modular";
  readonly entryPhase: string | null;
  readonly standaloneDeliverableType: string | null;
}

export async function loadModularEntryFacts(db: DbOrTx, transformationId: string): Promise<ModularEntryFacts | null> {
  const t = await db
    .selectFrom("transformation")
    .select(["mode", "entry_phase", "standalone_deliverable_type"])
    .where("id", "=", transformationId)
    .executeTakeFirst();
  if (!t) return null;
  return {
    mode: t.mode === "modular" ? "modular" : "end_to_end",
    entryPhase: t.entry_phase,
    standaloneDeliverableType: t.standalone_deliverable_type,
  };
}

/**
 * The facts of ADR-0038 §7.3 for one transformation, each list in a stable order (code or creation, then id):
 * - active baselines (inherited or not) and whether each has a value;
 * - active (not archived) outcomes with their count of active outcome KPI rows;
 * - initiatives neither draft nor cancelled, with an active contribution and an active `tom_gap` link or not;
 * - active benefits, with the §5 benefit upstream rule (any active edge into it in `traceability_edge`: a `kpi_benefit`
 *   link, an outcome KPI of its measurement KPI, or an allocation in its current set);
 * - inherited-approval dispensations still pending verification.
 */
export async function loadMissingLinkFacts(db: DbOrTx, transformationId: string): Promise<MissingLinkFacts> {
  const baselines = await db
    .selectFrom("baseline")
    .select(["id", "value"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const outcomes = await db
    .selectFrom("outcome as o")
    .select((eb) => [
      "o.id",
      "o.statement",
      eb
        .selectFrom("outcome_kpi as k")
        .select(sql<number>`count(*)::int`.as("n"))
        .whereRef("k.outcome_id", "=", "o.id")
        .where("k.status", "=", "active")
        .as("active_kpi_count"),
    ])
    .where("o.transformation_id", "=", transformationId)
    .where("o.status", "<>", "archived")
    .orderBy("o.created_at")
    .orderBy("o.id")
    .execute();
  const initiatives = await db
    .selectFrom("initiative as i")
    .select((eb) => [
      "i.id",
      "i.code",
      "i.name",
      eb
        .exists(
          eb
            .selectFrom("initiative_outcome_contribution as c")
            .select("c.id")
            .whereRef("c.initiative_id", "=", "i.id")
            .where("c.status", "=", "active"),
        )
        .as("has_contribution"),
      eb
        .exists(
          eb
            .selectFrom("initiative_gap_link as g")
            .select("g.id")
            .whereRef("g.initiative_id", "=", "i.id")
            .where("g.status", "=", "active")
            .where("g.target_type", "=", "tom_gap"),
        )
        .as("has_tom_gap_link"),
    ])
    .where("i.transformation_id", "=", transformationId)
    .where("i.status", "not in", ["draft", "cancelled"])
    .orderBy("i.code")
    .orderBy("i.id")
    .execute();
  const benefits = await db
    .selectFrom("benefit as b")
    .select((eb) => [
      "b.id",
      "b.code",
      "b.title",
      eb
        .exists(
          eb
            .selectFrom("traceability_edge as e")
            .select("e.link_id")
            .where("e.transformation_id", "=", transformationId)
            .where("e.to_type", "=", "benefit")
            .whereRef("e.to_id", "=", "b.id"),
        )
        .as("has_upstream"),
    ])
    .where("b.transformation_id", "=", transformationId)
    .where("b.status", "=", "active")
    .orderBy("b.code")
    .orderBy("b.id")
    .execute();
  const pending = await db
    .selectFrom("gate_dispensation")
    .select(["id", "gate_code"])
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", "inherited_approval")
    .where("status", "=", "pending")
    .orderBy("gate_code")
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  return {
    baselines: baselines.map((b) => ({ id: b.id, hasValue: b.value !== null })),
    outcomes: outcomes.map((o) => ({ id: o.id, label: o.statement, activeKpiCount: Number(o.active_kpi_count ?? 0) })),
    initiatives: initiatives.map((i) => ({
      id: i.id,
      label: `${i.code} ${i.name}`,
      hasActiveContribution: Boolean(i.has_contribution),
      hasActiveTomGapLink: Boolean(i.has_tom_gap_link),
    })),
    benefits: benefits.map((b) => ({
      id: b.id,
      label: `${b.code} ${b.title}`,
      hasUpstream: Boolean(b.has_upstream),
    })),
    pendingInheritedApprovals: pending.map((d) => ({ id: d.id, gateCode: d.gate_code })),
  };
}
