// Product-gate criterion evaluators for G1 (Case for Change), G2 (Direction) and G3 (Target State) (ADR-0015 §2,
// "Required outputs per gate"). One pure evaluator per seeded criterion key, over facts loaded through the owning
// modules (transformations' registers, kpi's loadKpiGateFacts, evidence's verification facts).
//
// Rules that keep a gap from ever reading as complete:
//  - a missing record or value is `incomplete` with a machine-readable `missing[]` code - never complete by default;
//  - a criterion that requires verified evidence counts ONLY verified evidence (REQ-S13-012): a bare filename, an
//    inaccessible link, a rejected or unreviewed item is listed in `unverifiedEvidenceIds` and does not count;
//  - "every X has Y" criteria also need at least one X, except where the criterion is a pure prohibition
//    (g3.design_decisions: "no open design decision without an owner").
// These are BUSINESS gates inside the product; nothing here reads or writes the engineering gates DG0-DG7.
import type { DbOrTx } from "@mth/db";
import {
  composeThesis,
  hasText,
  type GateCriterionEvaluation,
  type GateDefinition,
  type Warning,
  truncateText,
} from "@mth/shared/schemas";
import { loadVerifiedEvidenceFacts, type EvidenceFact } from "../evidence/index.ts";
import { loadKpiGateFacts, type KpiGateFacts } from "../kpi/index.ts";
import { findCharter, findCurrentNorthStar, hasExclusions, loadGoodOutcomeFacts } from "../transformations/index.ts";
import { G4_EVALUATORS, loadG4Facts, type G4Facts, type GateFactsProvider } from "./g4.ts";

/** Everything the G1-G3 evaluators read, loaded once per evaluation (inside the submitting transaction on submit). */
export interface GateFacts {
  readonly seededDiagnosticItems: ReadonlyArray<{
    id: string;
    dimensionCode: string;
    hasCurrentState: boolean;
    hasRootCause: boolean;
    hasImpact: boolean;
    hasConfidence: boolean;
    baselineId: string | null;
  }>;
  readonly findings: ReadonlyArray<{ id: string; kind: string; status: string }>;
  readonly kpi: KpiGateFacts;
  readonly charter: {
    id: string;
    version: number;
    hasCaseForChange: boolean;
    hasName: boolean;
    hasSponsor: boolean;
    hasLead: boolean;
    hasInScope: boolean;
    hasOutOfScope: boolean;
    hasBaselineDate: boolean;
    /** Empty parts of the four-part thesis (B0037), e.g. ["thesisBecause"]; [] when complete. */
    thesisMissing: readonly string[];
  } | null;
  readonly northStar: { id: string; version: number } | null;
  readonly topOutcomes: ReadonlyArray<{ id: string }>;
  /**
   * The good outcome test (B0051, REQ-PB-036) of every non-archived outcome: G2 ("Are outcomes specific enough to
   * steer decisions?", B0023) lists each outcome whose test is not passing, with the criteria that fail or are unknown.
   */
  readonly outcomes: ReadonlyArray<{
    id: string;
    statement: string;
    isTopOutcome: boolean;
    goodOutcomePass: boolean;
    notPassing: ReadonlyArray<{ criterionCode: string; result: "fail" | "unknown"; reason: string | null }>;
  }>;
  readonly activeGuardrails: number;
  readonly canvasCells: ReadonlyArray<{ dimensionCode: string; status: string }>;
  readonly tomGaps: ReadonlyArray<{ id: string; status: string; hasOwner: boolean }>;
  readonly capabilities: ReadonlyArray<{ id: string; currentLevel: number | null; targetLevel: number | null }>;
  readonly futureJourneys: number;
  readonly openDesignDecisions: ReadonlyArray<{ id: string; code: string; hasOwner: boolean }>;
  readonly evidence: readonly EvidenceFact[];
  /**
   * P3: the G4 facts (portfolio and kpi halves) read through the GateFactsProvider (g4.ts). Absent when no provider
   * was passed, so every g4.* criterion is incomplete (fail closed).
   */
  readonly g4?: G4Facts;
}

export async function loadGateFacts(
  db: DbOrTx,
  transformationId: string,
  provider?: GateFactsProvider,
): Promise<GateFacts> {
  const items = await db
    .selectFrom("diagnostic_item")
    .select([
      "id",
      "dimension_code",
      "current_state",
      "root_cause",
      "impact_amount",
      "impact_kpi_definition_id",
      "impact_text",
      "confidence",
      "baseline_id",
    ])
    .where("transformation_id", "=", transformationId)
    .where("is_seeded", "=", true)
    .orderBy("dimension_code")
    .execute();
  const findings = await db
    .selectFrom("diagnostic_finding")
    .select(["id", "kind", "status"])
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .execute();
  const kpi = await loadKpiGateFacts(db, transformationId);
  const charter = await findCharter(db, transformationId);
  const northStar = await findCurrentNorthStar(db, transformationId);
  const topOutcomes = await db
    .selectFrom("outcome")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("is_top_outcome", "=", true)
    .where("status", "<>", "archived")
    .orderBy("id")
    .execute();
  const goodOutcomes = await loadGoodOutcomeFacts(db, transformationId);
  const guardrails = await db
    .selectFrom("strategic_guardrail")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  const canvasCells = await db
    .selectFrom("tom_canvas_cell")
    .select(["dimension_code", "status"])
    .where("transformation_id", "=", transformationId)
    .execute();
  const tomGaps = await db
    .selectFrom("tom_gap")
    .select(["id", "status", "owner_user_id"])
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .execute();
  const capabilities = await db
    .selectFrom("capability")
    .select(["id", "current_level", "target_level"])
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .execute();
  const journeys = await db
    .selectFrom("journey")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .where("transformation_id", "=", transformationId)
    .where("state", "=", "future")
    .where("status", "<>", "archived")
    .executeTakeFirst();
  const openDecisions = await db
    .selectFrom("decision")
    .select(["id", "code", "owner_user_id"])
    .where("transformation_id", "=", transformationId)
    .where("kind", "=", "design")
    .where("status", "=", "open")
    .execute();
  const evidence = await loadVerifiedEvidenceFacts(db, transformationId, [
    ...items.map((i) => ({ recordType: "diagnostic_item", recordId: i.id })),
    ...kpi.baselines.map((b) => ({ recordType: "baseline", recordId: b.id })),
  ]);
  return {
    seededDiagnosticItems: items.map((i) => ({
      id: i.id,
      dimensionCode: i.dimension_code,
      // F-DG2-150/160: every free-text "is present" test is `hasText` (visible content); blank text is not content.
      hasCurrentState: hasText(i.current_state),
      hasRootCause: hasText(i.root_cause),
      hasImpact: i.impact_amount !== null || i.impact_kpi_definition_id !== null || hasText(i.impact_text),
      hasConfidence: i.confidence !== null,
      baselineId: i.baseline_id,
    })),
    findings,
    kpi,
    charter: charter
      ? {
          id: charter.id,
          version: charter.version,
          hasCaseForChange: hasText(charter.case_for_change),
          hasName: hasText(charter.transformation_name),
          hasSponsor: charter.executive_sponsor_user_id !== null,
          hasLead: charter.transformation_lead_user_id !== null,
          hasInScope: hasText(charter.in_scope),
          // F-DG2-150: a blank Out of scope documents no exclusion (same rule as the `exclusions_present` pre-check).
          hasOutOfScope: hasExclusions(charter.out_of_scope),
          hasBaselineDate: charter.baseline_date !== null,
          thesisMissing: composeThesis({
            thesisChange: charter.thesis_change,
            thesisOutcomes: charter.thesis_outcomes,
            thesisBenefits: charter.thesis_benefits,
            thesisBecause: charter.thesis_because,
          }).missing,
        }
      : null,
    northStar: northStar ? { id: northStar.id, version: northStar.version } : null,
    topOutcomes,
    outcomes: goodOutcomes.map((o) => ({
      id: o.id,
      statement: o.statement,
      isTopOutcome: o.isTopOutcome,
      goodOutcomePass: o.goodOutcomePass,
      notPassing: o.test.flatMap((r) =>
        r.result === "pass" ? [] : [{ criterionCode: r.criterionCode, result: r.result, reason: r.reason }],
      ),
    })),
    activeGuardrails: Number(guardrails?.n ?? 0),
    canvasCells: canvasCells.map((c) => ({ dimensionCode: c.dimension_code, status: c.status })),
    tomGaps: tomGaps.map((g) => ({ id: g.id, status: g.status, hasOwner: g.owner_user_id !== null })),
    capabilities: capabilities.map((c) => ({ id: c.id, currentLevel: c.current_level, targetLevel: c.target_level })),
    futureJourneys: Number(journeys?.n ?? 0),
    openDesignDecisions: openDecisions.map((d) => ({ id: d.id, code: d.code, hasOwner: d.owner_user_id !== null })),
    evidence,
    ...(provider !== undefined ? { g4: await loadG4Facts(db, provider, transformationId) } : {}),
  };
}

interface Outcome {
  readonly missing: Warning[];
  readonly unverifiedEvidenceIds?: string[];
}
type Evaluator = (f: GateFacts) => Outcome;

const miss = (code: string, message: string, pointer?: string): Warning =>
  pointer === undefined ? { code, message } : { code, message, pointer };

const evidenceOf = (f: GateFacts, recordType: string, recordId: string) =>
  f.evidence.filter((e) => e.recordType === recordType && e.recordId === recordId);
const unverifiedIn = (facts: readonly EvidenceFact[]) => [
  ...new Set(facts.filter((e) => !e.verified).map((e) => e.evidenceId)),
];

/** "Outcome '<statement>' does not pass the good outcome test: specific (fail), causal_chain (unknown)." */
function goodOutcomeMessage(
  statement: string,
  notPassing: ReadonlyArray<{ criterionCode: string; result: string }>,
): string {
  // F-DG2-260: cut on a code-point boundary, so the quoted statement never ends in a lone surrogate.
  const quoted = statement.length > 80 ? `${truncateText(statement, 77)}...` : statement;
  const which = notPassing.map((c) => `${c.criterionCode} (${c.result})`).join(", ");
  return `Outcome "${quoted}" does not pass the good outcome test: ${which || "no criterion is evaluated"}.`;
}

/** The six T01 dimensions every transformation carries (seeded by p2_instantiate_transformation). */
const T01_SEEDED = 6;

export const EVALUATORS: ReadonlyMap<string, Evaluator> = new Map<string, Evaluator>([
  // ---------------------------------------------------------------- G4 Mobilize (ADR-0021 §7; workflows/g4.ts)
  ...G4_EVALUATORS.map(([key, evaluate]): [string, Evaluator] => [key, (f) => evaluate(f.g4)]),
  // ---------------------------------------------------------------- G1 Case for Change
  [
    "g1.diagnostic",
    (f) => {
      const missing: Warning[] = [];
      const linked: EvidenceFact[] = [];
      if (f.seededDiagnosticItems.length < T01_SEEDED)
        missing.push(miss("g1.diagnostic.dimensions_missing", "Not every T01 dimension row exists."));
      for (const i of f.seededDiagnosticItems) {
        const at = `/diagnosticItems/${i.dimensionCode}`;
        if (!i.hasCurrentState)
          missing.push(miss("g1.diagnostic.current_state_missing", `${i.dimensionCode}: current state`, at));
        if (!i.hasRootCause)
          missing.push(miss("g1.diagnostic.root_cause_missing", `${i.dimensionCode}: root cause`, at));
        if (!i.hasImpact) missing.push(miss("g1.diagnostic.impact_missing", `${i.dimensionCode}: impact`, at));
        if (!i.hasConfidence)
          missing.push(miss("g1.diagnostic.confidence_missing", `${i.dimensionCode}: confidence`, at));
        const ev = evidenceOf(f, "diagnostic_item", i.id);
        linked.push(...ev);
        const baselineBacked =
          i.baselineId !== null && f.kpi.baselines.some((b) => b.id === i.baselineId && b.status !== "archived");
        if (!baselineBacked && !ev.some((e) => e.verified))
          missing.push(
            miss(
              "g1.diagnostic.verified_evidence_missing",
              `${i.dimensionCode}: needs a linked baseline or VERIFIED evidence (a filename or an inaccessible link does not count)`,
              at,
            ),
          );
      }
      return { missing, unverifiedEvidenceIds: unverifiedIn(linked) };
    },
  ],
  [
    "g1.baseline",
    (f) => {
      const linked = f.kpi.baselines.flatMap((b) => evidenceOf(f, "baseline", b.id));
      const measurable = f.kpi.baselines.filter((b) => b.hasValue && b.hasSource && b.hasDate);
      const missing: Warning[] = [];
      if (measurable.length === 0)
        missing.push(miss("g1.baseline.measurable_missing", "No baseline has a value, a source and a baseline date."));
      else if (!measurable.some((b) => evidenceOf(f, "baseline", b.id).some((e) => e.verified)))
        missing.push(
          miss(
            "g1.baseline.verified_evidence_missing",
            "A measurable baseline needs VERIFIED evidence (a filename or an inaccessible link does not count).",
          ),
        );
      return { missing, unverifiedEvidenceIds: unverifiedIn(linked) };
    },
  ],
  [
    "g1.root_causes",
    (f) => {
      const missing: Warning[] = [];
      if (f.seededDiagnosticItems.length < T01_SEEDED || f.seededDiagnosticItems.some((i) => !i.hasRootCause))
        missing.push(miss("g1.root_causes.t01_root_cause_missing", "Every T01 row states a root cause."));
      if (!f.findings.some((x) => x.kind === "root_cause" && x.status === "confirmed"))
        missing.push(
          miss("g1.root_causes.confirmed_finding_missing", "No confirmed finding is classified as a root cause."),
        );
      return { missing };
    },
  ],
  [
    "g1.value_pools",
    (f) => {
      const missing: Warning[] = [];
      if (f.kpi.valuePools.length === 0) missing.push(miss("g1.value_pools.none", "No value pool is recorded."));
      for (const p of f.kpi.valuePools) {
        if (p.quantificationStatus !== "quantified" && p.quantificationStatus !== "unquantified")
          missing.push(
            miss("g1.value_pools.quantification_missing", "A value pool is neither quantified nor unquantified."),
          );
        if (p.materiality === "not_assessed")
          missing.push(miss("g1.value_pools.materiality_not_assessed", "A value pool's materiality is not assessed."));
      }
      return { missing };
    },
  ],
  [
    "g1.case_for_change",
    (f) => ({
      missing: f.charter?.hasCaseForChange
        ? []
        : [
            miss(
              "g1.case_for_change.missing",
              "The charter does not state the case for change.",
              "/charter/caseForChange",
            ),
          ],
    }),
  ],
  [
    "g1.initial_charter",
    (f) => {
      const c = f.charter;
      if (c === null) return { missing: [miss("g1.initial_charter.missing", "No charter exists yet.", "/charter")] };
      const parts: [boolean, string, string][] = [
        [c.hasName, "name", "/charter/transformationName"],
        [c.hasSponsor, "executive sponsor", "/charter/executiveSponsorUserId"],
        [c.hasLead, "transformation lead", "/charter/transformationLeadUserId"],
        [c.hasInScope, "scope in", "/charter/inScope"],
        [c.hasOutOfScope, "scope out", "/charter/outOfScope"],
        [c.hasBaselineDate, "baseline date", "/charter/baselineDate"],
      ];
      return {
        missing: parts
          .filter(([ok]) => !ok)
          .map(([, what, pointer]) =>
            miss("g1.initial_charter.field_missing", `The charter lacks its ${what}.`, pointer),
          ),
      };
    },
  ],
  // ---------------------------------------------------------------- G2 Direction
  [
    "g2.north_star",
    (f) => ({ missing: f.northStar ? [] : [miss("g2.north_star.missing", "No current North Star is set.")] }),
  ],
  [
    "g2.outcome_tree",
    (f) => {
      const missing: Warning[] = [];
      if (f.topOutcomes.length === 0) missing.push(miss("g2.outcome_tree.no_top_outcome", "No top outcome exists."));
      for (const o of f.topOutcomes)
        if (!f.kpi.outcomeKpis.some((k) => k.outcomeId === o.id))
          missing.push(
            miss("g2.outcome_tree.outcome_without_t02", "A top outcome has no T02 row.", `/outcomes/${o.id}`),
          );
      // REQ-PB-030 (F-DG2-203): the thesis states the causal chain change -> outcomes -> benefits (B0037) that the
      // outcome tree steers by; a thesis with an empty part keeps the criterion incomplete.
      if (f.charter === null)
        missing.push(
          miss("g2.outcome_tree.thesis_incomplete", "No charter states the transformation thesis.", "/charter"),
        );
      else
        for (const part of f.charter.thesisMissing)
          missing.push(
            miss(
              "g2.outcome_tree.thesis_incomplete",
              `The transformation thesis is incomplete (${part} is empty): "If we change ..., then ... will improve, which will create ..., because ..." (B0037).`,
              `/charter/${part}`,
            ),
          );
      // REQ-PB-036: every outcome whose good outcome test does not pass is listed (never silently a pass).
      for (const o of f.outcomes)
        if (!o.goodOutcomePass)
          missing.push(
            miss(
              "g2.outcome_tree.good_outcome_test_not_passing",
              goodOutcomeMessage(o.statement, o.notPassing),
              `/outcomes/${o.id}`,
            ),
          );
      return { missing };
    },
  ],
  [
    "g2.kpi_definitions",
    (f) => {
      const missing: Warning[] = [];
      if (f.kpi.outcomeKpis.length === 0) missing.push(miss("g2.kpi_definitions.no_t02", "The T02 tree has no row."));
      const used = new Set(f.kpi.outcomeKpis.map((k) => k.kpiDefinitionId));
      for (const id of used) {
        const d = f.kpi.kpiDefinitions.find((k) => k.id === id);
        if (!d || d.status !== "active")
          missing.push(
            miss("g2.kpi_definitions.not_active", "A T02 KPI has no active definition.", `/kpiDefinitions/${id}`),
          );
        else {
          if (!d.hasUnit)
            missing.push(miss("g2.kpi_definitions.unit_missing", "A KPI has no unit.", `/kpiDefinitions/${id}`));
          if (!d.polarity)
            missing.push(
              miss("g2.kpi_definitions.polarity_missing", "A KPI has no polarity.", `/kpiDefinitions/${id}`),
            );
          if (d.ownerUserId === null)
            missing.push(miss("g2.kpi_definitions.owner_missing", "A KPI has no owner.", `/kpiDefinitions/${id}`));
        }
      }
      return { missing };
    },
  ],
  [
    "g2.target_trajectory",
    (f) => {
      const missing: Warning[] = [];
      if (f.kpi.outcomeKpis.length === 0) missing.push(miss("g2.target_trajectory.no_t02", "The T02 tree has no row."));
      for (const k of f.kpi.outcomeKpis) {
        const at = `/outcomeKpis/${k.id}`;
        if (!k.hasTarget) missing.push(miss("g2.target_trajectory.target_missing", "A T02 row has no target.", at));
        if (!k.targetDate)
          missing.push(miss("g2.target_trajectory.target_date_missing", "A T02 row has no target date.", at));
        if (k.trajectoryStatus !== "approved")
          missing.push(
            miss("g2.target_trajectory.not_approved", "A T02 trajectory is not approved for its current version.", at),
          );
      }
      return { missing };
    },
  ],
  [
    "g2.guardrails",
    (f) => ({
      missing: f.activeGuardrails > 0 ? [] : [miss("g2.guardrails.none", "No active strategic guardrail exists.")],
    }),
  ],
  // ---------------------------------------------------------------- G3 Target State
  [
    "g3.target_operating_model",
    (f) => {
      const missing: Warning[] = [];
      if (f.canvasCells.length < 10) missing.push(miss("g3.tom.boxes_missing", "Not every TOM canvas box exists."));
      for (const c of f.canvasCells)
        if (c.status !== "ready")
          missing.push(
            miss(
              "g3.tom.box_not_ready",
              `${c.dimensionCode}: target design and owner are not ready.`,
              `/tomCanvas/${c.dimensionCode}`,
            ),
          );
      return { missing };
    },
  ],
  [
    "g3.gap_matrix",
    (f) => {
      const missing: Warning[] = [];
      if (f.tomGaps.length === 0) missing.push(miss("g3.gap_matrix.none", "The T03 gap matrix has no row."));
      for (const g of f.tomGaps)
        if (g.status === "open" && !g.hasOwner)
          missing.push(miss("g3.gap_matrix.owner_missing", "An open gap has no owner.", `/tomGaps/${g.id}`));
      return { missing };
    },
  ],
  [
    "g3.capability_gaps",
    (f) => ({
      missing: f.capabilities.some(
        (c) => c.currentLevel !== null && c.targetLevel !== null && c.targetLevel > c.currentLevel,
      )
        ? []
        : [miss("g3.capability_gaps.none", "No rated capability has a target level above its current level.")],
    }),
  ],
  [
    "g3.future_journeys",
    (f) => ({
      missing:
        f.futureJourneys > 0 ? [] : [miss("g3.future_journeys.none", "No future-state journey or process exists.")],
    }),
  ],
  [
    "g3.design_decisions",
    (f) => ({
      missing: f.openDesignDecisions
        .filter((d) => !d.hasOwner)
        .map((d) =>
          miss("g3.design_decisions.owner_missing", `${d.code} is open without an owner.`, `/decisions/${d.id}`),
        ),
    }),
  ],
]);

/** Live (or at-submission) evaluation of every criterion of a gate definition. */
export function evaluateGate(definition: GateDefinition, facts: GateFacts): GateCriterionEvaluation[] {
  return definition.criteria.map((c) => {
    const evaluator = EVALUATORS.get(c.key);
    // A criterion without an evaluator can never be complete (fail closed).
    const outcome: Outcome = evaluator
      ? evaluator(facts)
      : { missing: [miss("gate.criterion_not_evaluable", "This criterion cannot be evaluated in this release.")] };
    return {
      key: c.key,
      ordinal: c.ordinal,
      labelEn: c.labelEn,
      labelAr: c.labelAr,
      mandatory: c.mandatory,
      requiresVerifiedEvidence: c.requiresVerifiedEvidence,
      completeness: outcome.missing.length === 0 ? "complete" : "incomplete",
      missing: outcome.missing,
      unverifiedEvidenceIds: outcome.unverifiedEvidenceIds ?? [],
    };
  });
}
