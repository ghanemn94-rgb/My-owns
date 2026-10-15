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
const pending = (code: string, requirement: string): CoverageCondition => ({ code, requirement, query: null });

/** ADR-0050 §5, in order. BE-T replaces each `query: null` with its count query (named lines). */
export const DEMO_COVERAGE_CONDITIONS: readonly CoverageCondition[] = [
  ...Array.from({ length: 16 }, (_, i) =>
    pending(`template.t${pad(i + 1)}`, `at least one record of template T${pad(i + 1)}'s table`),
  ),
  ...Array.from({ length: 6 }, (_, i) => pending(`gate.g${i + 1}`, `a gate instance of G${i + 1}`)),
  ...Array.from({ length: 6 }, (_, i) => pending(`phase.${i + 1}`, `phase ${i + 1} of the six phases`)),
  ...Array.from({ length: 10 }, (_, i) =>
    pending(`tom.dimension_${pad(i + 1)}`, `a canvas cell of TOM dimension ${i + 1}`),
  ),
  ...Array.from({ length: 6 }, (_, i) =>
    pending(`dashboard.area_${i + 1}`, `data for dashboard area ${i + 1} (t10_area_definition)`),
  ),
  pending("health_assessment.submitted", "one submitted 25-question health assessment"),
  pending("kpi.stale", "a stale KPI"),
  pending("decision.overdue", "an overdue decision"),
  pending("benefit.shared", "one benefit allocated to at least two initiatives"),
  pending("adoption.gap", "an adoption gap"),
  pending("bau.handover", "a BAU handover"),
  pending("evidence.missing", "a mandatory evidence item with none attached"),
  pending("approval.pending", "a pending approval"),
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
