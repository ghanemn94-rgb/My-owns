// Product gate G6 "Sustain - Is value embedded in BAU?" (B0023 "Benefits evidence, ownership transfer, controls,
// continuous improvement backlog."; M0123; ADR-0035 §2; REQ-PB-015, REQ-PB-021, REQ-S04-008; T-DG4-BE-K): the four
// g6.* evaluators as pure functions of the facts, the G6 fact loader and the G6 snapshot member.
//
// Facts come through the GateFactsProvider members benefits and sustainment (those modules' gate-facts.ts, wired by
// server.ts). Fail closed: facts that were not loaded make the criterion incomplete; a pending benefit value is never
// counted as validated. Every missing item's message starts with the criterion label, so a refused submission (422)
// names "Ownership transfer" literally (REQ-PB-021).
//
// G6 is a BUSINESS approval inside the product (SP). An approved G6 changes no phase (next_phase NULL), does not close
// the transformation (D-089 Q4; closure is ADR-0034 §7) and NEVER implies the engineering gate DG7 (M0412).
import type { DbOrTx } from "@mth/db";
import type { Warning } from "@mth/shared/schemas";
import type { BenefitsGateFacts, GateFactsProvider, SustainmentGateFacts } from "./g4.ts";

export interface G6Facts {
  readonly benefits: BenefitsGateFacts;
  readonly sustainment: SustainmentGateFacts;
}

export async function loadG6Facts(db: DbOrTx, provider: GateFactsProvider, transformationId: string): Promise<G6Facts> {
  const none = { transformationId };
  return {
    benefits: provider.benefits ? await provider.benefits(db, transformationId) : none,
    sustainment: provider.sustainment ? await provider.sustainment(db, transformationId) : none,
  };
}

interface GateOutcome {
  readonly missing: Warning[];
}
export type G6Evaluator = (f: G6Facts | undefined) => GateOutcome;

const item = (code: string, message: string, pointer?: string): Warning =>
  pointer === undefined ? { code, message } : { code, message, pointer };
const notLoaded = (label: string, code: string): GateOutcome => ({
  missing: [item(code, `${label}: the facts could not be read.`)],
});

export const G6_EVALUATORS: ReadonlyArray<readonly [string, G6Evaluator]> = [
  [
    "g6.benefits_evidence",
    (f) => {
      const L = "Benefits evidence";
      const benefits = f?.benefits.benefits;
      if (benefits === undefined) return notLoaded(L, "g6.benefits_not_loaded");
      if (benefits.length === 0)
        return { missing: [item("g6.benefits_none", `${L}: the transformation has no benefit.`)] };
      return {
        missing: benefits
          .filter((b) => b.validatedMeasurementIds.length === 0 && b.approvedTransitionDecisionIds.length === 0)
          .map((b) =>
            item(
              "g6.benefit_not_validated",
              `${L}: ${b.code} ${b.title} has no Finance-validated measurement and no approved transition decision.`,
              `/benefits/${b.id}`,
            ),
          ),
      };
    },
  ],
  [
    "g6.ownership_transfer",
    (f) => {
      const L = "Ownership transfer";
      const areas = f?.sustainment.performanceAreas;
      if (areas === undefined) return notLoaded(L, "g6.ownership_not_loaded");
      if (areas.length === 0)
        return { missing: [item("g6.performance_area_none", `${L}: the transformation has no performance area.`)] };
      return {
        missing: areas
          .filter((a) => a.acceptedHandoverId === null)
          .map((a) =>
            item(
              "g6.handover_not_accepted",
              `${L}: ${a.code} ${a.name} has no accepted BAU handover in its current cycle.`,
              `/performanceAreas/${a.id}`,
            ),
          ),
      };
    },
  ],
  [
    "g6.controls",
    (f) => {
      const L = "Controls";
      const areas = f?.sustainment.performanceAreas;
      if (areas === undefined) return notLoaded(L, "g6.controls_not_loaded");
      const handed = areas.filter((a) => a.acceptedHandoverId !== null);
      if (handed.length === 0)
        return {
          missing: [item("g6.controls_no_handover", `${L}: no performance area has an accepted BAU handover.`)],
        };
      return {
        missing: handed
          .filter((a) => a.activeControlIds.length === 0)
          .map((a) =>
            item("g6.control_missing", `${L}: ${a.code} ${a.name} has no active control.`, `/performanceAreas/${a.id}`),
          ),
      };
    },
  ],
  [
    "g6.improvement_backlog",
    (f) => {
      const L = "Continuous improvement backlog";
      const items = f?.sustainment.improvementItemIds;
      if (items === undefined) return notLoaded(L, "g6.improvement_not_loaded");
      return {
        missing:
          items.length > 0 ? [] : [item("g6.improvement_backlog_empty", `${L}: the improvement backlog is empty.`)],
      };
    },
  ],
];

/**
 * The `g6` member of a G6 submission's frozen snapshot (ADR-0035 §2 "Snapshot"; REQ-S04-002): benefit ids with their
 * validated measurement and approved transition-decision ids, handover ids, control ids and CI item ids.
 */
export function g6SnapshotOf(f: G6Facts): Record<string, unknown> {
  const areas = f.sustainment.performanceAreas ?? [];
  return {
    benefits: (f.benefits.benefits ?? []).map((b) => ({
      id: b.id,
      code: b.code,
      validatedMeasurementIds: [...b.validatedMeasurementIds],
      approvedTransitionDecisionIds: [...b.approvedTransitionDecisionIds],
    })),
    handoverIds: areas.map((a) => a.acceptedHandoverId).filter((x): x is string => x !== null),
    performanceAreas: areas.map((a) => ({ id: a.id, cycleNo: a.cycleNo, acceptedHandoverId: a.acceptedHandoverId })),
    controlIds: areas.flatMap((a) => [...a.activeControlIds]),
    improvementItemIds: [...(f.sustainment.improvementItemIds ?? [])],
  };
}
