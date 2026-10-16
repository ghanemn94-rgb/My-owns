// The seed-coverage check (ADR-0050 §5; REQ-S18-002; M0348 "Seed enough coherent records to exercise every phase, gate
// and numbered template, all ten TOM dimensions, all six dashboard areas, the 25-question assessment, pending
// approvals, missing evidence, a stale KPI, an overdue decision, a shared benefit, an adoption gap and a BAU handover.
// Link the examples rather than creating unrelated sample cards.").
//
// Framework by T-DG5-BE-S; the conditions' SQL is BE-T's (p5-work-split §J.2: "the coverage conditions' SQL in
// packages/db/src/demo/coverage.ts (named lines, after BE-S)"). Each condition is a named count query over persisted
// rows of the ONE roaming transformation (DEMO_TRANSFORMATION_ID). A condition whose query is not written yet
// (`query: null`) is NOT counted: it is absent from the result (never reported as 0, which would read as a measured
// "none") and it makes the run incomplete. "Stale" and "overdue" are relative to the synthetic clock (ADR-0050 §5).
import { sql } from "kysely";
import type { Tx } from "../pool.ts";

/**
 * The roaming transformation's fixed id (ADR-0050 §4: every seeded id is a fixed literal UUID in `01995000-…`). The
 * dataset (BE-T, `demo/data/**`) creates the transformation with exactly this id; the conditions read its records.
 */
export const DEMO_TRANSFORMATION_ID = "01995000-0000-7000-8000-000000000001";

export interface CoverageCondition {
  /** Stable key in `demo_dataset_run.coverage` (lower-case, dotted). */
  readonly code: string;
  /** What the condition requires, in English (for the status screen and test messages). */
  readonly requirement: string;
  /** The count query (>= 1 passes), or null until BE-T writes it. */
  readonly query: ((tx: Tx, transformationId: string) => Promise<number>) | null;
}

const pad = (n: number): string => String(n).padStart(2, "0");

// ------------------------------------------------------------------------------------------------ BE-T's conditions
// Each query counts persisted rows of the ONE roaming transformation (`$t`). "Stale" and "overdue" are relative to the
// demo database's synthetic clock (deployment_environment.synthetic_clock_at; ADR-0050 §5). KBE-H's two counts are
// loaded lazily (dynamic import): demo/data/kpis.ts imports this file, so a static import would be a cycle.

async function count(tx: Tx, q: ReturnType<typeof sql<{ n: string }>>): Promise<number> {
  const r = await q.execute(tx);
  return Number(r.rows[0]?.n ?? "0");
}

/** The synthetic clock's business date (Asia/Riyadh) of this demo database. */
const CLOCK_DATE = sql`(SELECT (synthetic_clock_at AT TIME ZONE 'Asia/Riyadh')::date FROM deployment_environment)`;

/** T01–T16: at least one record of each template's table (source_element.feature_ref of the template set). */
const TEMPLATE_QUERIES: Readonly<Record<string, (t: string) => ReturnType<typeof sql<{ n: string }>>>> = {
  T01: (t) =>
    sql`SELECT count(*)::text AS n FROM diagnostic_item WHERE transformation_id = ${t}::uuid AND status = 'active'`,
  T02: (t) =>
    sql`SELECT count(*)::text AS n FROM outcome o WHERE o.transformation_id = ${t}::uuid AND o.status = 'active'
          AND EXISTS (SELECT 1 FROM outcome_kpi k WHERE k.outcome_id = o.id AND k.status = 'active')`,
  T03: (t) =>
    sql`SELECT count(*)::text AS n FROM tom_gap WHERE transformation_id = ${t}::uuid AND status <> 'archived'`,
  T04: (t) => sql`SELECT count(*)::text AS n FROM decision WHERE transformation_id = ${t}::uuid AND kind = 'design'`,
  T05: (t) =>
    sql`SELECT count(*)::text AS n FROM initiative WHERE transformation_id = ${t}::uuid AND status <> 'cancelled'`,
  T06: (t) =>
    sql`SELECT count(*)::text AS n FROM initiative_score s WHERE s.transformation_id = ${t}::uuid AND s.score IS NOT NULL
          AND EXISTS (SELECT 1 FROM scoring_weight_set w WHERE w.transformation_id = s.transformation_id AND w.status = 'active')`,
  T07: (t) =>
    sql`SELECT count(*)::text AS n FROM roadmap_wave WHERE transformation_id = ${t}::uuid AND status = 'active'`,
  T08: (t) =>
    sql`SELECT count(*)::text AS n FROM dependency WHERE transformation_id = ${t}::uuid AND status <> 'archived'`,
  T09: (t) => sql`SELECT count(*)::text AS n FROM benefit_formula WHERE transformation_id = ${t}::uuid`,
  // T10 (t10_area_definition, dashboards): the number of the six areas with data (the dashboard.area_N conditions).
  T10: (t) => sql`SELECT count(*)::text AS n FROM (${areaUnion(t)}) a WHERE a.n > 0`,
  T11: (t) =>
    sql`SELECT count(*)::text AS n FROM transformation_decision_right WHERE transformation_id = ${t}::uuid AND status = 'active'`,
  T12: (t) =>
    sql`SELECT count(*)::text AS n FROM transformation_raci_deliverable WHERE transformation_id = ${t}::uuid AND status = 'active'`,
  T13: (t) =>
    sql`SELECT count(*)::text AS n FROM stakeholder_group g WHERE g.transformation_id = ${t}::uuid AND g.status = 'active'
          AND EXISTS (SELECT 1 FROM adoption_intervention i WHERE i.stakeholder_group_id = g.id)`,
  T14: (t) => sql`SELECT count(*)::text AS n FROM benefit WHERE transformation_id = ${t}::uuid AND status = 'active'`,
  T15: (t) => sql`SELECT count(*)::text AS n FROM raid_entry WHERE transformation_id = ${t}::uuid`,
  T16: (t) => sql`SELECT count(*)::text AS n FROM decision WHERE transformation_id = ${t}::uuid AND kind = 'executive'`,
};

/** The six T10 areas (t10_area_definition codes, in ordinal order) and the rows that give each one data. */
const AREA_QUERIES: readonly (readonly [string, (t: string) => ReturnType<typeof sql<{ n: string }>>])[] = [
  [
    "outcomes",
    (t) => sql`SELECT count(*)::text AS n FROM outcome_kpi WHERE transformation_id = ${t}::uuid AND status = 'active'`,
  ],
  [
    "value",
    (t) =>
      sql`SELECT count(*)::text AS n FROM benefit b WHERE b.transformation_id = ${t}::uuid AND b.status = 'active'
            AND EXISTS (SELECT 1 FROM benefit_plan_value p WHERE p.benefit_id = b.id)`,
  ],
  [
    "portfolio",
    (t) =>
      sql`SELECT count(*)::text AS n FROM initiative WHERE transformation_id = ${t}::uuid AND status <> 'cancelled'`,
  ],
  [
    "dependencies",
    (t) =>
      sql`SELECT count(*)::text AS n FROM dependency WHERE transformation_id = ${t}::uuid AND status IN ('open', 'at_risk')`,
  ],
  [
    "decisions",
    (t) =>
      sql`SELECT count(*)::text AS n FROM decision WHERE transformation_id = ${t}::uuid AND kind = 'executive' AND status = 'open'`,
  ],
  [
    "people_adoption",
    (t) =>
      sql`SELECT (SELECT count(*) FROM initiative WHERE transformation_id = ${t}::uuid AND adoption_status <> 'not_assessed')
               + (SELECT count(*) FROM stakeholder_group WHERE transformation_id = ${t}::uuid AND status = 'active')
               AS n`,
  ],
];

function areaUnion(t: string): ReturnType<typeof sql> {
  return sql.join(
    AREA_QUERIES.map(([code, q]) => sql`SELECT ${code}::text AS code, (${q(t)})::bigint AS n`),
    sql` UNION ALL `,
  );
}

const q =
  (build: (t: string) => ReturnType<typeof sql<{ n: string }>>): CoverageCondition["query"] =>
  (tx, t) =>
    count(tx, build(t));

/** ADR-0050 §5, in order (codes and requirements by T-DG5-BE-S; the queries are BE-T's named lines). */
export const DEMO_COVERAGE_CONDITIONS: readonly CoverageCondition[] = [
  ...Array.from(
    { length: 16 },
    (_, i): CoverageCondition => ({
      code: `template.t${pad(i + 1)}`,
      requirement: `at least one record of template T${pad(i + 1)}'s table`,
      query: q(TEMPLATE_QUERIES[`T${pad(i + 1)}`]!),
    }),
  ),
  ...Array.from(
    { length: 6 },
    (_, i): CoverageCondition => ({
      code: `gate.g${i + 1}`,
      requirement: `a gate instance of G${i + 1}`,
      query: q(
        (t) =>
          sql`SELECT count(*)::text AS n FROM gate_instance WHERE transformation_id = ${t}::uuid AND gate_code = ${`G${i + 1}`}`,
      ),
    }),
  ),
  // The six phases (phase_definition ordinal 1–6): the phase's steps of this transformation (phase_step, DG4).
  ...Array.from(
    { length: 6 },
    (_, i): CoverageCondition => ({
      code: `phase.${i + 1}`,
      requirement: `phase ${i + 1} of the six phases`,
      query: q(
        (t) => sql`SELECT count(*)::text AS n FROM phase_step s
                  WHERE s.transformation_id = ${t}::uuid
                    AND s.phase_code = (SELECT code FROM phase_definition ORDER BY ordinal OFFSET ${i} LIMIT 1)`,
      ),
    }),
  ),
  // The ten TOM dimensions (tom_dimension ordinal 1–10): a canvas cell with a target design.
  ...Array.from(
    { length: 10 },
    (_, i): CoverageCondition => ({
      code: `tom.dimension_${pad(i + 1)}`,
      requirement: `a canvas cell of TOM dimension ${i + 1}`,
      query: q(
        (t) => sql`SELECT count(*)::text AS n FROM tom_canvas_cell c
                  WHERE c.transformation_id = ${t}::uuid AND c.target_design IS NOT NULL
                    AND c.dimension_code = (SELECT code FROM (SELECT DISTINCT ON (code) code, ordinal FROM tom_dimension
                                                               ORDER BY code, ordinal) d
                                             ORDER BY ordinal, code OFFSET ${i} LIMIT 1)`,
      ),
    }),
  ),
  ...AREA_QUERIES.map(
    ([, build], i): CoverageCondition => ({
      code: `dashboard.area_${i + 1}`,
      requirement: `data for dashboard area ${i + 1} (t10_area_definition)`,
      query: q(build),
    }),
  ),
  {
    code: "health_assessment.submitted",
    requirement: "one submitted 25-question health assessment",
    query: q(
      (t) => sql`SELECT count(*)::text AS n FROM health_assessment
                  WHERE transformation_id = ${t}::uuid AND status = 'submitted' AND answered_count = 25`,
    ),
  },
  {
    code: "kpi.stale",
    requirement: "a stale KPI",
    query: async (tx, t) => (await import("./data/actuals.ts")).countStaleKpis(tx, t),
  },
  {
    code: "decision.overdue",
    requirement: "an overdue decision",
    query: q(
      (t) => sql`SELECT count(*)::text AS n FROM decision
                  WHERE transformation_id = ${t}::uuid AND kind = 'executive' AND status = 'open'
                    AND due_date < ${CLOCK_DATE}`,
    ),
  },
  {
    code: "benefit.shared",
    requirement: "one benefit allocated to at least two initiatives",
    query: async (tx, t) => (await import("./data/benefits.ts")).countSharedBenefits(tx, t),
  },
  {
    code: "adoption.gap",
    requirement: "an adoption gap",
    query: q(
      (t) => sql`SELECT count(*)::text AS n FROM initiative
                  WHERE transformation_id = ${t}::uuid AND adoption_status = 'at_risk'`,
    ),
  },
  {
    code: "bau.handover",
    requirement: "a BAU handover",
    query: q((t) => sql`SELECT count(*)::text AS n FROM bau_handover WHERE transformation_id = ${t}::uuid`),
  },
  {
    code: "evidence.missing",
    requirement: "a mandatory evidence item with none attached",
    // A phase step whose definition requires evidence (phase_step_definition.completion_rule 'evidence_linked',
    // "At least one verified evidence item linked to the step …") and that has no active evidence attached.
    query: q(
      (t) => sql`SELECT count(*)::text AS n FROM phase_step s
                  JOIN phase_step_definition d ON d.key = s.step_key AND d.completion_rule = 'evidence_linked'
                  WHERE s.transformation_id = ${t}::uuid AND s.status <> 'complete'
                    AND NOT EXISTS (SELECT 1 FROM phase_step_evidence e WHERE e.phase_step_id = s.id AND e.status = 'active')`,
    ),
  },
  {
    code: "approval.pending",
    requirement: "a pending approval",
    // A pending business approval: an approval request, a submitted product gate, or a queued Finance validation.
    query: q(
      (t) => sql`SELECT ((SELECT count(*) FROM approval WHERE transformation_id = ${t}::uuid AND status = 'pending')
                       + (SELECT count(*) FROM gate_instance WHERE transformation_id = ${t}::uuid
                                                              AND status IN ('submitted', 'under_review'))
                       + (SELECT count(*) FROM finance_validation WHERE transformation_id = ${t}::uuid
                                                                   AND status = 'queued'))::text AS n`,
    ),
  },
];

export interface CoverageResult {
  /** {condition code: count} for every condition with a query, in condition order. */
  readonly counts: Record<string, number>;
  /** Conditions not yet implemented (no query): not counted. */
  readonly notImplemented: readonly string[];
  /** True only when every condition has a query and a count >= 1. */
  readonly complete: boolean;
}

/** Runs every condition in the caller's transaction (ADR-0050 §5). */
export async function runCoverage(
  tx: Tx,
  transformationId: string = DEMO_TRANSFORMATION_ID,
  conditions: readonly CoverageCondition[] = DEMO_COVERAGE_CONDITIONS,
): Promise<CoverageResult> {
  const counts: Record<string, number> = {};
  const notImplemented: string[] = [];
  for (const c of conditions) {
    if (c.query === null) {
      notImplemented.push(c.code);
      continue;
    }
    const n = await c.query(tx, transformationId);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error(`coverage: ${c.code} returned an invalid count`);
    counts[c.code] = n;
  }
  const complete = notImplemented.length === 0 && Object.values(counts).every((n) => n >= 1);
  return { counts, notImplemented, complete };
}
