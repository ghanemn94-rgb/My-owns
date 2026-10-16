// The export content label table's closed sets (task KBE-D2; D-157 a; REQ-S13-009): every value of every closed set an
// assembler prints as a code label (`<prefix>.<value>`) has an English and an Arabic text, so an export never falls
// back to a key-derived label for a value the seeded worlds of the integration test happen not to contain. The sets are
// the shared Zod enums and constants (the API mirrors of the 0011-0082 CHECK constraints). All texts are checked for
// presence, a non-empty trimmed text, Arabic script in the Arabic column, and the honesty rules (no engineering-gate
// label, no certification claim).
import { describe, expect, it } from "vitest";
import {
  ACTION_SOURCE_KINDS,
  AGENDA_ITEM_KINDS,
  agendaItemOutcomeKind,
  agendaItemStatus,
  attendanceKind,
  BASELINE_SCOPES,
  BAU_HANDOVER_ITEMS,
  BAU_HANDOVER_STATUSES,
  BENEFIT_LIFECYCLE_STEPS,
  BENEFIT_TYPES,
  BENEFIT_VALUE_CLASSES,
  BUSINESS_CASE_LEVELS,
  BUSINESS_CASE_LINE_CLASSES,
  BUSINESS_CASE_VALIDATION_STATES,
  CONFIDENCES,
  CONTROL_CADENCES,
  CONTROL_STATUSES,
  DECISION_KINDS,
  DECISION_STATUSES,
  DEPENDENCY_STATUSES,
  DEPENDENCY_TYPES,
  DIAGNOSTIC_DIMENSION_CODES,
  EVIDENCE_KINDS,
  FINDING_KINDS,
  FINDING_STATUSES,
  GATE_CODES,
  GATE_CRITERION_RECOMMENDATIONS,
  GATE_INSTANCE_STATUSES,
  GATE_OUTCOMES,
  GUARDRAIL_CATEGORIES,
  IMPROVEMENT_ITEM_STATUSES,
  IMPROVEMENT_PRIORITIES,
  INITIATIVE_STATUSES,
  KPI_DEFINITION_STATUSES,
  KPI_FREQUENCIES,
  KPI_POLARITIES,
  KPI_UNIT_KINDS,
  LINE_KINDS,
  MATERIALITIES,
  MEETING_OUTPUT_KINDS,
  MEETING_OUTPUT_RECORD_TYPES,
  MEETING_STATUSES,
  meetingMinutesStatus,
  phase,
  QUANTIFICATION_STATUSES,
  RAG_STATUSES,
  RAID_ACTION_STATUSES,
  RAID_ENTRY_TYPES,
  RAID_LEVELS,
  RAID_STATUSES,
  REPORT_APPROVAL_STATES,
  roleCode,
  SOURCING_NEEDS,
  SUSTAIN_FREQUENCIES,
  T10_AREA_CODES,
  TOM_DIMENSION_CODES,
  TOM_GAP_STATUSES,
  VALIDATION_STATUSES,
} from "../schemas/index.ts";
import { REPORT_CONTENT_LABELS } from "./content-labels.ts";

/** prefix -> every value the assemblers can print under it. */
const CLOSED_SETS: Readonly<Record<string, readonly string[]>> = {
  "report.yes_no": ["yes", "no"],
  "report.approval_state": REPORT_APPROVAL_STATES,
  "report.rag_status": RAG_STATUSES,
  "report.rag": RAG_STATUSES,
  "report.confidence": CONFIDENCES,
  "report.raid_level": RAID_LEVELS,
  "report.raid_type": RAID_ENTRY_TYPES,
  "report.raid_status": RAID_STATUSES,
  "report.action_status": RAID_ACTION_STATUSES,
  "report.action_source": ACTION_SOURCE_KINDS,
  "report.decision_status": DECISION_STATUSES,
  "report.decision_kind": DECISION_KINDS,
  "report.dependency_status": DEPENDENCY_STATUSES,
  "report.dependency_type": DEPENDENCY_TYPES,
  "report.evidence_kind": EVIDENCE_KINDS,
  "report.evidence_review_status": ["unverified", "verified", "rejected"],
  "report.evidence_verified_at_submission": ["verified", "unverified"],
  "report.validation_status": VALIDATION_STATUSES,
  "report.sustain_frequency": [...SUSTAIN_FREQUENCIES, ...CONTROL_CADENCES],
  "report.phase": phase.options,
  "report.gate": GATE_CODES,
  "report.gate_status": GATE_INSTANCE_STATUSES,
  "report.gate_outcome": GATE_OUTCOMES,
  "report.criterion_state": ["complete", "incomplete", "covered_by_exception"],
  "report.criterion_mandatory": ["mandatory", "optional"],
  "report.criterion_verified_evidence": ["required", "not_required"],
  "report.criterion_recommendation": GATE_CRITERION_RECOMMENDATIONS,
  "report.record_type": [
    ...MEETING_OUTPUT_RECORD_TYPES,
    "outcome",
    "outcome_kpi",
    "initiative",
    "executive_decision",
    "adoption_metric_link",
  ],
  "report.role": roleCode.options,
  "report.t10_area": T10_AREA_CODES,
  "report.meeting_status": MEETING_STATUSES,
  "report.attendance": attendanceKind.options,
  "report.agenda_item_kind": AGENDA_ITEM_KINDS,
  "report.agenda_item_status": agendaItemStatus.options,
  "report.agenda_item_outcome": agendaItemOutcomeKind.options,
  "report.meeting_action_link_kind": ["assigned", "reviewed"],
  "report.meeting_output_kind": MEETING_OUTPUT_KINDS,
  "report.meeting_minutes.minutes_state": [...meetingMinutesStatus.options, "no_minutes"],
  "report.meeting_pack.ask_source": ["t16_decision", "brief"],
  "report.horizon_unit": ["months", "quarters", "years"],
  "report.outcome_status": ["draft", "active", "archived"],
  "report.guardrail_category": GUARDRAIL_CATEGORIES,
  "report.diagnostic_dimension": DIAGNOSTIC_DIMENSION_CODES,
  "report.diagnostic_item_status": ["active", "archived"],
  "report.finding_kind": FINDING_KINDS,
  "report.finding_status": FINDING_STATUSES,
  "report.baseline_scope": BASELINE_SCOPES,
  "report.quantification_status": QUANTIFICATION_STATUSES,
  "report.materiality": MATERIALITIES,
  "report.tom_dimension": TOM_DIMENSION_CODES,
  "report.tom_cell_status": ["draft", "ready"],
  "report.tom_gap_status": TOM_GAP_STATUSES,
  "report.capability_status": ["active", "archived"],
  "report.sourcing_need": SOURCING_NEEDS,
  "report.business_case_level": BUSINESS_CASE_LEVELS,
  "report.business_case_status": ["draft", "archived"],
  "report.business_case_validation": BUSINESS_CASE_VALIDATION_STATES,
  "report.business_case_line_kind": LINE_KINDS,
  "report.business_case_line_class": BUSINESS_CASE_LINE_CLASSES,
  "report.business_case_value_basis": [...BENEFIT_VALUE_CLASSES, "cash", "non_cash"],
  "report.business_case_measure": [
    "gross_benefits",
    "gross_benefits_by_value_basis",
    "implementation_cost",
    "implementation_cost_cash",
    "implementation_cost_non_cash",
    "net_value",
  ],
  "report.recurrence": ["one_off", "recurring"],
  "report.formula_validation": [
    "validated",
    "unvalidated",
    "rejected",
    "no_formula",
    "no_current_version",
    "formula_archived",
  ],
  "report.wave_status": ["active", "archived"],
  "report.milestone_status": ["planned", "achieved", "missed", "cancelled"],
  "report.initiative_status": INITIATIVE_STATUSES,
  "report.benefit_type": BENEFIT_TYPES,
  "report.benefit_value_class": BENEFIT_VALUE_CLASSES,
  "report.benefit_step": BENEFIT_LIFECYCLE_STEPS,
  "report.benefit_counting": [
    "counted",
    "not_counted",
    "archived",
    "parent_rollup",
    "group_counted_member_not_named",
    "group_member_not_counted",
    "overlap_duplicate",
  ],
  "report.kpi_status": KPI_DEFINITION_STATUSES,
  "report.kpi_unit_kind": KPI_UNIT_KINDS,
  "report.kpi_polarity": KPI_POLARITIES,
  "report.kpi_frequency": KPI_FREQUENCIES,
  "report.executive_pack.update_state": ["submitted", "no_update_submitted"],
  "report.executive_pack.owner_state": ["no_owner"],
  "report.executive_dashboard.policy_source": ["default", "configured"],
  "report.handover.item_state": ["present", "missing"],
  "report.bau_handover_item": BAU_HANDOVER_ITEMS.map((i) => i.item),
  "report.bau_handover_status": BAU_HANDOVER_STATUSES,
  "report.control_status": CONTROL_STATUSES,
  "report.improvement_priority": IMPROVEMENT_PRIORITIES,
  "report.improvement_status": IMPROVEMENT_ITEM_STATUSES,
};

describe("REPORT_CONTENT_LABELS", () => {
  it("has the same keys in English and Arabic, each a non-empty trimmed text", () => {
    const en = REPORT_CONTENT_LABELS.en;
    const ar = REPORT_CONTENT_LABELS.ar;
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of [...Object.entries(en), ...Object.entries(ar)]) {
      expect(v.trim(), k).toBe(v);
      expect(v.length, k).toBeGreaterThan(0);
    }
  });

  it("every Arabic text is written in Arabic script (codes such as G1 or SHA-256 may stay Latin inside it)", () => {
    for (const [k, v] of Object.entries(REPORT_CONTENT_LABELS.ar)) expect(/[؀-ۿ]/.test(v), k).toBe(true);
  });

  it("every value of every closed set has a label in both languages", () => {
    const missing: string[] = [];
    for (const [prefix, values] of Object.entries(CLOSED_SETS))
      for (const v of values) {
        const key = `${prefix}.${v}`;
        if (!Object.hasOwn(REPORT_CONTENT_LABELS.en, key) || !Object.hasOwn(REPORT_CONTENT_LABELS.ar, key))
          missing.push(key);
      }
    expect(missing).toEqual([]);
  });

  it("every executive-dashboard value column (value basis x unit kind) has a label", () => {
    for (const basis of ["actual", "validated", "planned", "none"])
      for (const kind of KPI_UNIT_KINDS)
        expect(Object.hasOwn(REPORT_CONTENT_LABELS.ar, `report.executive_dashboard.value_${basis}_${kind}`)).toBe(true);
  });

  it("honesty: no label names an engineering delivery gate, claims PMI status or a certification", () => {
    for (const v of [...Object.values(REPORT_CONTENT_LABELS.en), ...Object.values(REPORT_CONTENT_LABELS.ar)]) {
      expect(v).not.toMatch(/\bDG[0-7]\b/);
      expect(v).not.toMatch(/PMI|certif/i);
    }
  });
});
