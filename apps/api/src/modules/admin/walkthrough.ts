// The guided walkthrough (P5 slice J; ADR-0050 §7, §8, §9; REQ-S18-004; M0349; p5-work-split §J.4; T-DG5-BE-T2):
//   GET /demo/walkthrough?transformationId=   getDemoWalkthrough   (session: every signed-in user; demo database only)
//
// The twelve M0349 steps come from the `walkthrough_step` catalogue (`0090`, verbatim English titles, provisional
// Arabic), in ordinal order. For each step the response gives its navigation area (ADR-0049 §9), the web route where
// the step is performed with the native workflows, and `completed`, which is evaluated HERE, on every read, from the
// persisted records of the given transformation (ADR-0050 §7). The guide never stores a completion and writes nothing:
// the route has no audit event and no mutation, and its queries run in one read-only, repeatable-read snapshot so the
// twelve answers are consistent with each other.
//
// Refusals, in order: 400 (query), 401 (no session), 409 `environment.not_demo` outside a demo database (ADR-0050 §9,
// exact text; checked before the transformation, so a production database discloses nothing about its records), and
// 404 when the caller cannot read the transformation (`transformation.read` there, the ADR-0049 §10 reader rule; an
// unknown id answers the same 404, so existence is never disclosed). Without `transformationId` only step 1 is
// evaluated and it is not completed (the contract's parameter description).
//
// Everything in a demo database is synthetic (ADR-0050 §2): a step's "approved G4 decision" or "Finance-validated
// benefit measurement" is a synthetic demonstration decision that approves nothing real (M0412). This file reads
// product gates G1-G6 only as records of the demo transformation; it never grants one, and nothing here reads or
// writes the engineering delivery gates DG0-DG7.
import { readDeploymentEnvironment, sql, type DbOrTx } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { parseQuery, type ModuleDeps } from "../platform/index.ts";
import { environmentRefusals } from "./environment.ts";

const WALKTHROUGH = "/api/v1/demo/walkthrough";
export const WALKTHROUGH_STEP_COUNT = 12;

// ------------------------------------------------------------------------------------------------ contract shapes
// Mirrors of docs/api/openapi.yaml DemoWalkthroughStep and DemoWalkthrough; every body is parsed before it is sent.
const AREA_CODES = [
  "my_work",
  "executive_overview",
  "transformations",
  "playbook_procedures",
  "strategy_kpis",
  "target_operating_model",
  "initiatives_roadmaps",
  "governance",
  "risks_actions",
  "benefits_finance",
  "change_adoption",
  "evidence_reports",
  "bau_improvement",
  "administration",
] as const;

export const demoWalkthroughStep = z.strictObject({
  code: z.string(),
  ordinal: z.number().int().min(1).max(WALKTHROUGH_STEP_COUNT),
  titleEn: z.string(),
  titleAr: z.string(),
  areaCode: z.enum(AREA_CODES),
  route: z.string(),
  completed: z.boolean(),
});

export const demoWalkthrough = z.strictObject({
  transformationId: z.uuid().nullable(),
  steps: z.array(demoWalkthroughStep).max(WALKTHROUGH_STEP_COUNT),
  completedCount: z.number().int().min(0),
  total: z.literal(WALKTHROUGH_STEP_COUNT),
});
export type DemoWalkthrough = z.infer<typeof demoWalkthrough>;

const walkthroughQuery = z.strictObject({ transformationId: z.uuid().optional() });

// ------------------------------------------------------------------------------------------------ completion rules
/** The twelve `walkthrough_step.completion_rule` codes of ADR-0050 §7 (seeded by `0090`). */
export type CompletionRule =
  | "transformation_created"
  | "baseline_agreed"
  | "outcomes_kpis_defined"
  | "tom_designed"
  | "mobilization_approved"
  | "delivery_adoption_updated"
  | "kpi_actual_submitted"
  | "benefit_validated"
  | "executive_decision_resolved"
  | "report_generated"
  | "bau_handover_accepted"
  | "performance_monitoring_continued";

type Predicate = (t: string) => ReturnType<typeof sql<{ done: boolean }>>;

/**
 * A KPI actual that was submitted: still awaiting review (`submitted`) or reviewed and kept (`accepted`). A draft was
 * never submitted; a rejected actual is not a KPI actual of record (ADR-0027/0028 lifecycle).
 */
const SUBMITTED_ACTUAL = sql`a.status IN ('submitted', 'accepted') AND a.submitted_at IS NOT NULL`;

/**
 * ADR-0050 §7, one read-only predicate per rule, each over the records of transformation `t` only. The comment on each
 * line quotes the ADR's "done when the transformation has …" text, then states how this reads it.
 */
export const COMPLETION_RULES: Readonly<Record<CompletionRule, Predicate>> = {
  // "the transformation exists and was created in this demo database (not a seeded record)": it exists (the caller's
  // read was already checked) and it is not registered in demo_seed_record as a dataset fixture.
  transformation_created: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM transformation x WHERE x.id = ${t}::uuid
                         AND NOT EXISTS (SELECT 1 FROM demo_seed_record r
                                          WHERE r.record_type = 'transformation' AND r.record_id = x.id)) AS done`,
  // "a baseline in the DG2 agreed state": an active baseline whose validation status is `validated` (the DG2
  // baseline lifecycle unvalidated -> validated | rejected; the Finance / Value Office validation, REQ-PB-013) and
  // whose validation is current: a later edit makes it stale (`validated_record_version` < `version`, validateBaseline).
  baseline_agreed: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM baseline b WHERE b.transformation_id = ${t}::uuid
                         AND b.status = 'active' AND b.validation_status = 'validated'
                         AND b.validated_record_version = b.version) AS done`,
  // "an outcome with a linked KPI definition": an outcome that is not archived (a defined outcome is `draft` until it
  // is activated) with an active outcome-KPI link (T02) to a KPI definition.
  outcomes_kpis_defined: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM outcome o JOIN outcome_kpi k ON k.outcome_id = o.id AND k.status = 'active'
                        WHERE o.transformation_id = ${t}::uuid AND o.status <> 'archived') AS done`,
  // "a target-state canvas cell and a TOM gap": a canvas cell with a target design, and a gap that is not archived.
  tom_designed: (t) =>
    sql`SELECT (EXISTS (SELECT 1 FROM tom_canvas_cell c WHERE c.transformation_id = ${t}::uuid
                          AND c.target_design IS NOT NULL)
            AND EXISTS (SELECT 1 FROM tom_gap g WHERE g.transformation_id = ${t}::uuid
                          AND g.status <> 'archived')) AS done`,
  // "a scored initiative and an approved G4 decision (synthetic)": an initiative score with a value, and a G4 gate
  // decision whose outcome is `approved` (a human decision recorded by the product-gate workflow; never by this read).
  mobilization_approved: (t) =>
    sql`SELECT (EXISTS (SELECT 1 FROM initiative_score s WHERE s.transformation_id = ${t}::uuid
                          AND s.score IS NOT NULL)
            AND EXISTS (SELECT 1 FROM gate_decision d WHERE d.transformation_id = ${t}::uuid
                          AND d.gate_code = 'G4' AND d.outcome = 'approved')) AS done`,
  // "an owner update and an adoption measurement": a submitted structured owner update, and a measured value of an
  // adoption indicator (ADR-0033 §1, §6): a submitted KPI actual of a KPI that an active adoption metric link
  // measures, or a recorded training completion, or a non-withdrawn proficiency observation.
  delivery_adoption_updated: (t) =>
    sql`SELECT (EXISTS (SELECT 1 FROM owner_update u WHERE u.transformation_id = ${t}::uuid
                          AND u.status = 'submitted')
            AND (EXISTS (SELECT 1 FROM kpi_actual a
                           JOIN adoption_metric_link l ON l.transformation_id = a.transformation_id
                                                      AND l.kpi_definition_id = a.kpi_definition_id
                                                      AND l.status = 'active'
                          WHERE a.transformation_id = ${t}::uuid AND ${SUBMITTED_ACTUAL})
              OR EXISTS (SELECT 1 FROM training_record r WHERE r.transformation_id = ${t}::uuid
                           AND r.status = 'completed')
              OR EXISTS (SELECT 1 FROM assessment_record r WHERE r.transformation_id = ${t}::uuid
                           AND r.kind = 'proficiency_observation' AND r.status <> 'withdrawn'))) AS done`,
  // "a submitted KPI actual".
  kpi_actual_submitted: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM kpi_actual a WHERE a.transformation_id = ${t}::uuid AND ${SUBMITTED_ACTUAL})
               AS done`,
  // "a Finance-validated benefit measurement (synthetic)": a benefit measurement in status `validated` with the
  // approved Finance validation that decided it (ADR-0030; a human Finance decision, never made by this read).
  benefit_validated: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM benefit_measurement m WHERE m.transformation_id = ${t}::uuid
                         AND m.status = 'validated'
                         AND EXISTS (SELECT 1 FROM finance_validation f WHERE f.benefit_measurement_id = m.id
                                       AND f.status = 'approved')) AS done`,
  // "a resolved executive decision": an executive decision (T16) in status `decided`. Deferred and cancelled are not
  // resolutions.
  executive_decision_resolved: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM decision d WHERE d.transformation_id = ${t}::uuid
                         AND d.kind = 'executive' AND d.status = 'decided') AS done`,
  // "a generated report snapshot": a report snapshot that was generated and not discarded (generated, issued or
  // superseded by a reissue).
  report_generated: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM report_snapshot s WHERE s.transformation_id = ${t}::uuid
                         AND s.status IN ('generated', 'issued', 'superseded')) AS done`,
  // "an accepted BAU handover".
  bau_handover_accepted: (t) =>
    sql`SELECT EXISTS (SELECT 1 FROM bau_handover h WHERE h.transformation_id = ${t}::uuid
                         AND h.status = 'accepted') AS done`,
  // "a KPI actual or control check dated after the handover's acceptance": a submitted KPI actual whose submission,
  // or a performed control check whose performance, is later than an accepted handover's acceptance.
  performance_monitoring_continued: (t) =>
    sql`SELECT EXISTS (
          SELECT 1 FROM bau_handover h
           WHERE h.transformation_id = ${t}::uuid AND h.status = 'accepted' AND h.accepted_at IS NOT NULL
             AND (EXISTS (SELECT 1 FROM kpi_actual a WHERE a.transformation_id = h.transformation_id
                            AND ${SUBMITTED_ACTUAL} AND a.submitted_at > h.accepted_at)
               OR EXISTS (SELECT 1 FROM control_check c WHERE c.transformation_id = h.transformation_id
                            AND c.status IN ('passed', 'failed') AND c.performed_at > h.accepted_at))) AS done`,
};

/** The predicates by rule code (a Map: lookups by a catalogue value are never computed member accesses). */
const PREDICATES: ReadonlyMap<string, Predicate> = new Map(Object.entries(COMPLETION_RULES));

/** Evaluates one rule for transformation `t` (read-only). An unknown rule is a catalogue/code drift and throws. */
export async function evaluateCompletionRule(db: DbOrTx, rule: string, t: string): Promise<boolean> {
  const predicate = PREDICATES.get(rule);
  if (predicate === undefined) throw new Error(`walkthrough: no predicate for completion rule ${rule}`);
  const r = await predicate(t).execute(db);
  return r.rows[0]?.done === true;
}

// ------------------------------------------------------------------------------------------------ web routes
/**
 * The web routes where each step is performed (apps/web/src/app/router.tsx): `withTransformation` with `{id}` = the
 * transformation; `without` when no transformation is given yet: step 1 opens the create form and every other step
 * the landing page of its navigation area (the ADR-0049 §9 area paths of identity/navigation.ts NAVIGATION_AREAS,
 * which is not on identity's public surface, so the twelve paths are stated here and pinned by the integration test).
 */
const STEP_ROUTES: ReadonlyMap<string, { readonly withTransformation: string; readonly without: string }> = new Map(
  Object.entries({
    transformation_created: { withTransformation: "/transformations/{id}", without: "/transformations/new" },
    baseline_agreed: { withTransformation: "/transformations/{id}/diagnose", without: "/strategy-kpis" },
    outcomes_kpis_defined: { withTransformation: "/transformations/{id}/define", without: "/strategy-kpis" },
    tom_designed: { withTransformation: "/transformations/{id}/design", without: "/target-operating-model" },
    mobilization_approved: {
      withTransformation: "/transformations/{id}/prioritization",
      without: "/initiatives-roadmaps",
    },
    delivery_adoption_updated: { withTransformation: "/transformations/{id}/adoption", without: "/change-adoption" },
    kpi_actual_submitted: { withTransformation: "/transformations/{id}/kpis", without: "/strategy-kpis" },
    benefit_validated: {
      withTransformation: "/transformations/{id}/finance-validations",
      without: "/benefits-finance",
    },
    executive_decision_resolved: {
      withTransformation: "/transformations/{id}/executive-decisions",
      without: "/governance",
    },
    report_generated: { withTransformation: "/transformations/{id}/reports", without: "/evidence-reports" },
    bau_handover_accepted: { withTransformation: "/transformations/{id}/bau-handovers", without: "/bau-improvement" },
    performance_monitoring_continued: { withTransformation: "/transformations/{id}/bau", without: "/bau-improvement" },
  } satisfies Record<CompletionRule, { withTransformation: string; without: string }>),
);

function routeOf(rule: string, transformationId: string | null): string {
  const r = STEP_ROUTES.get(rule);
  if (r === undefined) throw new Error(`walkthrough: no route for completion rule ${rule}`);
  return transformationId === null ? r.without : r.withTransformation.replace("{id}", transformationId);
}

// ------------------------------------------------------------------------------------------------ the read
interface StepRow {
  readonly code: string;
  readonly ordinal: number;
  readonly title_en: string;
  readonly title_ar: string;
  readonly area_code: string;
  readonly completion_rule: string;
}

/** The walkthrough of transformation `t` (null: step 1 not completed, nothing else evaluated), in one snapshot. */
export async function readWalkthrough(db: DbOrTx, transformationId: string | null): Promise<DemoWalkthrough> {
  const rows = (await db
    .selectFrom("walkthrough_step")
    .select(["code", "ordinal", "title_en", "title_ar", "area_code", "completion_rule"])
    .orderBy("ordinal")
    .execute()) as StepRow[];
  const steps = [];
  for (const row of rows) {
    // An unknown rule is a catalogue/code drift: routeOf and evaluateCompletionRule fail loudly rather than show a
    // step as done or not done.
    const route = routeOf(row.completion_rule, transformationId);
    const completed =
      transformationId === null ? false : await evaluateCompletionRule(db, row.completion_rule, transformationId);
    steps.push({
      code: row.code,
      ordinal: row.ordinal,
      titleEn: row.title_en,
      titleAr: row.title_ar,
      areaCode: row.area_code,
      route,
      completed,
    });
  }
  return demoWalkthrough.parse({
    transformationId,
    steps,
    completedCount: steps.filter((s) => s.completed).length,
    total: WALKTHROUGH_STEP_COUNT,
  });
}

// ------------------------------------------------------------------------------------------------ route
/** Registers getDemoWalkthrough (called from registerEnvironmentRoutes) and returns it as "METHOD /path". */
export function registerWalkthroughRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  app.get(WALKTHROUGH, { config: { access: { permission: "authenticated" } } }, async (request) => {
    const query = parseQuery(walkthroughQuery, request.query);
    const principal = principalOf(request);
    return db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => {
        if ((await readDeploymentEnvironment(tx)).kind !== "demo") throw environmentRefusals.notDemo();
        const transformationId = query.transformationId ?? null;
        if (transformationId !== null) await requireTransformationRead(tx, principal, transformationId);
        return readWalkthrough(tx, transformationId);
      });
  });
  return [`GET ${WALKTHROUGH}`];
}
