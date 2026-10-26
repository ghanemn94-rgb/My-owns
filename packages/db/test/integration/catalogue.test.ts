// Catalogue checks on the migrated per-run database: the Kysely types match the real columns, only timestamptz,
// no floats, every table has a primary key, every mutable table has a version column, and mth_app's privileges are
// exactly what the data dictionary grants (no DDL, DELETE only where stated, INSERT/SELECT only on audit_event).
import { afterAll, describe, expect, it } from "vitest";
import { SCHEMA_COLUMNS, VIEW_NAMES } from "../../src/schema.ts";
import { ownerRole } from "../helpers.ts";

const owner = ownerRole();
afterAll(() => owner.close());

async function q<T>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await owner.pool.query(text, values)).rows as T[];
}

describe("schema.ts matches the migrated database", () => {
  it("has exactly the same relations and columns as public", async () => {
    const rows = await q<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const actual: Record<string, string[]> = {};
    for (const r of rows) (actual[r.table_name] ??= []).push(r.column_name);
    const expected = Object.fromEntries(Object.entries(SCHEMA_COLUMNS).map(([t, cols]) => [t, [...cols].sort()]));
    expect(Object.fromEntries(Object.entries(actual).map(([t, cols]) => [t, cols.sort()]))).toEqual(expected);
  });

  it("0025: an approved G1 decision is guarded by the deferred gate_decision_g1_agreements constraint trigger", async () => {
    const rows = await q<{ tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred FROM pg_trigger t
       WHERE t.tgrelid = 'public.gate_decision'::regclass AND t.tgname = 'gate_decision_g1_agreements'`,
    );
    expect(rows).toEqual([{ tgname: "gate_decision_g1_agreements", deferrable: true, deferred: true }]);
  });

  // T-DG4-BE-K (ADR-0035 §2 "Enabling"): 0059 opens G5 and G6 once their evaluators exist, so after every migration all
  // six product gates are submittable. 0026 itself still asserted G5/G6 closed when it ran (its own guard, in P3).
  it("0026 + 0059: product gate G4 is submittable (0026); G5 and G6 open with their evaluators (0059, ADR-0035 §2)", async () => {
    const rows = await q<{ code: string; submission_enabled: boolean }>(
      `SELECT code, submission_enabled FROM gate_definition ORDER BY ordinal`,
    );
    expect(rows.map((r) => [r.code, r.submission_enabled])).toEqual([
      ["G1", true],
      ["G2", true],
      ["G3", true],
      ["G4", true],
      ["G5", true],
      ["G6", true],
    ]);
  });

  it("0027: benefit_calculation.rounding is a nullable jsonb object, bound to the row and required on new rows (ADR-0024 §6 item 11)", async () => {
    const cols = await q<{ d: string; n: string }>(
      `SELECT data_type AS d, is_nullable AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'benefit_calculation' AND column_name = 'rounding'`,
    );
    expect(cols).toEqual([{ d: "jsonb", n: "YES" }]);
    const checks = await q<{ name: string; validated: boolean; def: string }>(
      `SELECT conname AS name, convalidated AS validated, pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conrelid = 'public.benefit_calculation'::regclass AND conname LIKE 'benefit_calculation_rounding%'
       ORDER BY conname`,
    );
    // Pre-0027 rows keep NULL (no backfill: the table is append-only), so the NOT NULL rule is a NOT VALID CHECK:
    // enforced on every new row, not checked against the rows that existed before 0027.
    expect(checks.map((c) => [c.name, c.validated])).toEqual([
      ["benefit_calculation_rounding_check", true],
      ["benefit_calculation_rounding_required", false],
      ["benefit_calculation_rounding_shape", true],
    ]);
    expect(checks[0]!.def).toBe("CHECK (((rounding IS NULL) OR (jsonb_typeof(rounding) = 'object'::text)))");
    expect(checks[1]!.def).toBe("CHECK ((rounding IS NOT NULL)) NOT VALID");
    expect(checks[2]!.def).toContain("(rounding -> 'rounded'::text) = to_jsonb(rounded)");
  });

  it("0029-0031: the P4 guards are attached (loop guard, one-accountable deferred guard, approval guards)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND t.tgname IN ('delegation_loop_guard', 'delegation_row_guard',
         'transformation_raci_assignment_one_accountable', 'transformation_raci_deliverable_one_accountable',
         'approval_guard', 'approval_decision_guard', 'approval_escalation_guard', 'approval_decision_append_only')
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["approval", "approval_guard", false, false],
      ["approval_decision", "approval_decision_append_only", false, false],
      ["approval_decision", "approval_decision_guard", false, false],
      ["approval_escalation", "approval_escalation_guard", false, false],
      ["delegation", "delegation_loop_guard", false, false],
      ["delegation", "delegation_row_guard", false, false],
      ["transformation_raci_assignment", "transformation_raci_assignment_one_accountable", true, true],
      ["transformation_raci_deliverable", "transformation_raci_deliverable_one_accountable", true, true],
    ]);
  });

  it("0033-0035: the P4 slice A guards are attached (deferred audit and consistency checks, append-only lineage)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('reporting_period', 'kpi_version', 'kpi_formula_input', 'kpi_rag_threshold',
         'target_trajectory', 'target_trajectory_point', 'kpi_actual', 'kpi_actual_value', 'kpi_actual_review', 'kpi_actual_evidence',
         'calculation_run', 'kpi_evaluation', 'data_quality_finding', 'rag_override')
         AND t.tgname NOT LIKE '%_row_guard'
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["calculation_run", "calculation_run_append_only", false, false],
      ["calculation_run", "calculation_run_append_only_truncate", false, false],
      // 0085 (T-DG5-ARCH-05; ADR-0047 §2): constrains only runs of the new kind 'restatement_approved'.
      ["calculation_run", "calculation_run_restatement_guard", false, false],
      ["data_quality_finding", "data_quality_finding_audit_required", true, true],
      ["data_quality_finding", "data_quality_finding_guard", false, false],
      ["kpi_actual", "kpi_actual_audit_required", true, true],
      ["kpi_actual", "kpi_actual_consistency", true, true],
      ["kpi_actual", "kpi_actual_guard", false, false],
      ["kpi_actual_evidence", "kpi_actual_evidence_append_only", false, false],
      ["kpi_actual_evidence", "kpi_actual_evidence_append_only_truncate", false, false],
      ["kpi_actual_review", "kpi_actual_review_append_only", false, false],
      ["kpi_actual_review", "kpi_actual_review_append_only_truncate", false, false],
      ["kpi_actual_value", "kpi_actual_value_append_only", false, false],
      ["kpi_actual_value", "kpi_actual_value_append_only_truncate", false, false],
      ["kpi_actual_value", "kpi_actual_value_guard", false, false],
      ["kpi_evaluation", "kpi_evaluation_append_only", false, false],
      ["kpi_evaluation", "kpi_evaluation_append_only_truncate", false, false],
      // 0085 (T-DG5-ARCH-05; ADR-0047 §2): constrains only evaluations of a restatement run.
      ["kpi_evaluation", "kpi_evaluation_restatement_guard", false, false],
      ["kpi_formula_input", "kpi_formula_input_append_only", false, false],
      ["kpi_formula_input", "kpi_formula_input_append_only_truncate", false, false],
      ["kpi_formula_input", "kpi_formula_input_guard", false, false],
      ["kpi_rag_threshold", "kpi_rag_threshold_audit_required", true, true],
      ["kpi_rag_threshold", "kpi_rag_threshold_guard", false, false],
      ["kpi_version", "kpi_version_audit_required", true, true],
      ["kpi_version", "kpi_version_guard", false, false],
      ["rag_override", "rag_override_audit_required", true, true],
      ["rag_override", "rag_override_guard", false, false],
      ["reporting_period", "reporting_period_audit_required", true, true],
      ["reporting_period", "reporting_period_guard", false, false],
      ["target_trajectory", "target_trajectory_audit_required", true, true],
      ["target_trajectory", "target_trajectory_guard", false, false],
      ["target_trajectory_point", "target_trajectory_point_append_only", false, false],
      ["target_trajectory_point", "target_trajectory_point_append_only_truncate", false, false],
      ["target_trajectory_point", "target_trajectory_point_guard", false, false],
    ]);
  });

  it("0037-0038: the P4 slice B guards are attached (deferred audit and Finance-decision checks, append-only history)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('benefit_lifecycle_step_definition', 'benefit_valuation_method', 'benefit_group',
         'benefit', 'benefit_enabler', 'benefit_lifecycle_event', 'benefit_allocation', 'benefit_scenario', 'benefit_scenario_value',
         'benefit_plan_value', 'benefit_measurement', 'benefit_measurement_input', 'benefit_evidence', 'finance_validation',
         'benefit_overlap')
         AND t.tgname NOT LIKE '%_row_guard'
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["benefit", "benefit_audit_required", true, true],
      ["benefit", "benefit_guard", false, false],
      ["benefit", "benefit_lifecycle_history", false, false],
      ["benefit", "benefit_value_lock_guard", false, false],
      ["benefit_allocation", "benefit_allocation_append_only", false, false],
      ["benefit_allocation", "benefit_allocation_append_only_truncate", false, false],
      ["benefit_allocation", "benefit_allocation_guard", false, false],
      ["benefit_enabler", "benefit_enabler_audit_required", true, true],
      ["benefit_enabler", "benefit_enabler_guard", false, false],
      ["benefit_evidence", "benefit_evidence_append_only", false, false],
      ["benefit_evidence", "benefit_evidence_append_only_truncate", false, false],
      ["benefit_evidence", "benefit_evidence_guard", false, false],
      ["benefit_group", "benefit_group_audit_required", true, true],
      ["benefit_group", "benefit_group_guard", false, false],
      ["benefit_lifecycle_event", "benefit_lifecycle_event_append_only", false, false],
      ["benefit_lifecycle_event", "benefit_lifecycle_event_append_only_truncate", false, false],
      ["benefit_measurement", "benefit_measurement_audit_required", true, true],
      ["benefit_measurement", "benefit_measurement_decision_present", true, true],
      ["benefit_measurement", "benefit_measurement_guard", false, false],
      ["benefit_measurement_input", "benefit_measurement_input_append_only", false, false],
      ["benefit_measurement_input", "benefit_measurement_input_append_only_truncate", false, false],
      ["benefit_measurement_input", "benefit_measurement_input_guard", false, false],
      ["benefit_overlap", "benefit_overlap_audit_required", true, true],
      ["benefit_overlap", "benefit_overlap_guard", false, false],
      ["benefit_plan_value", "benefit_plan_value_audit_required", true, true],
      ["benefit_plan_value", "benefit_plan_value_guard", false, false],
      ["benefit_scenario", "benefit_scenario_audit_required", true, true],
      ["benefit_scenario_value", "benefit_scenario_value_audit_required", true, true],
      ["benefit_scenario_value", "benefit_scenario_value_guard", false, false],
      ["benefit_valuation_method", "benefit_valuation_method_audit_required", true, true],
      ["benefit_valuation_method", "benefit_valuation_method_guard", false, false],
      ["finance_validation", "finance_validation_audit_required", true, true],
      ["finance_validation", "finance_validation_guard", false, false],
    ]);
  });

  it("0041-0042: the P4 slice E guards are attached (deferred audit, status guards, append-only signal log)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('raid_entry', 'corrective_action_rule', 'corrective_case',
         'corrective_signal', 'budget_line', 'initiative_schedule')
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["budget_line", "budget_line_audit_required", true, true],
      ["budget_line", "budget_line_guard", false, false],
      ["budget_line", "budget_line_row_guard", false, false],
      ["corrective_action_rule", "corrective_action_rule_audit_required", true, true],
      ["corrective_action_rule", "corrective_action_rule_guard", false, false],
      ["corrective_action_rule", "corrective_action_rule_row_guard", false, false],
      ["corrective_case", "corrective_case_audit_required", true, true],
      ["corrective_case", "corrective_case_guard", false, false],
      ["corrective_case", "corrective_case_row_guard", false, false],
      ["corrective_signal", "corrective_signal_append_only", false, false],
      ["corrective_signal", "corrective_signal_append_only_truncate", false, false],
      ["corrective_signal", "corrective_signal_row_guard", false, false],
      ["initiative_schedule", "initiative_schedule_audit_required", true, true],
      ["initiative_schedule", "initiative_schedule_guard", false, false],
      ["initiative_schedule", "initiative_schedule_row_guard", false, false],
      ["raid_entry", "raid_entry_audit_required", true, true],
      ["raid_entry", "raid_entry_guard", false, false],
      ["raid_entry", "raid_entry_row_guard", false, false],
    ]);
  });

  it("0044-0045: the P4 slice D guards are attached (deferred audit, status guards, frozen meetings, append-only logs)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (c.relname IN ('forum', 'forum_participant', 'meeting_series', 'meeting', 'agenda_item',
         'meeting_attendance', 'meeting_output', 'meeting_action_link', 'meeting_minutes', 'governance_escalation_rule',
         'decision_escalation', 'blocker_status') OR t.tgname IN ('decision_ask_guard', 'decision_ask_options'))
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["agenda_item", "agenda_item_audit_required", true, true],
      // T-DG5-ARCH-03 (0075; ADR-0044 §6): items of an unreviewed cut-off pack are not published.
      ["agenda_item", "agenda_item_cutoff_review", false, false],
      ["agenda_item", "agenda_item_guard", false, false],
      ["agenda_item", "agenda_item_meeting_editable", false, false],
      ["agenda_item", "agenda_item_row_guard", false, false],
      ["blocker_status", "blocker_status_append_only", false, false],
      ["blocker_status", "blocker_status_append_only_truncate", false, false],
      ["blocker_status", "blocker_status_audit_required", true, true],
      ["blocker_status", "blocker_status_guard", false, false],
      ["blocker_status", "blocker_status_meeting_editable", false, false],
      ["blocker_status", "blocker_status_row_guard", false, false],
      ["decision", "decision_ask_guard", false, false],
      ["decision", "decision_ask_options", true, true],
      ["decision_escalation", "decision_escalation_append_only", false, false],
      ["decision_escalation", "decision_escalation_append_only_truncate", false, false],
      ["decision_escalation", "decision_escalation_audit_required", true, true],
      ["decision_escalation", "decision_escalation_guard", false, false],
      ["decision_escalation", "decision_escalation_row_guard", false, false],
      ["forum", "forum_audit_required", true, true],
      ["forum", "forum_guard", false, false],
      ["forum", "forum_row_guard", false, false],
      ["forum_participant", "forum_participant_audit_required", true, true],
      ["forum_participant", "forum_participant_guard", false, false],
      ["forum_participant", "forum_participant_row_guard", false, false],
      ["governance_escalation_rule", "governance_escalation_rule_audit_required", true, true],
      ["governance_escalation_rule", "governance_escalation_rule_guard", false, false],
      ["governance_escalation_rule", "governance_escalation_rule_row_guard", false, false],
      ["meeting", "meeting_audit_required", true, true],
      ["meeting", "meeting_guard", false, false],
      ["meeting", "meeting_row_guard", false, false],
      ["meeting", "meeting_timezone_known", false, false],
      ["meeting_action_link", "meeting_action_link_append_only", false, false],
      ["meeting_action_link", "meeting_action_link_append_only_truncate", false, false],
      ["meeting_action_link", "meeting_action_link_audit_required", true, true],
      ["meeting_action_link", "meeting_action_link_meeting_editable", false, false],
      ["meeting_action_link", "meeting_action_link_row_guard", false, false],
      ["meeting_attendance", "meeting_attendance_audit_required", true, true],
      ["meeting_attendance", "meeting_attendance_guard", false, false],
      ["meeting_attendance", "meeting_attendance_meeting_editable", false, false],
      ["meeting_attendance", "meeting_attendance_row_guard", false, false],
      ["meeting_minutes", "meeting_minutes_audit_required", true, true],
      ["meeting_minutes", "meeting_minutes_guard", false, false],
      ["meeting_minutes", "meeting_minutes_no_delete", false, false],
      ["meeting_minutes", "meeting_minutes_row_guard", false, false],
      ["meeting_output", "meeting_output_append_only", false, false],
      ["meeting_output", "meeting_output_append_only_truncate", false, false],
      ["meeting_output", "meeting_output_audit_required", true, true],
      ["meeting_output", "meeting_output_guard", false, false],
      ["meeting_output", "meeting_output_meeting_editable", false, false],
      ["meeting_output", "meeting_output_row_guard", false, false],
      ["meeting_series", "meeting_series_audit_required", true, true],
      ["meeting_series", "meeting_series_guard", false, false],
      ["meeting_series", "meeting_series_row_guard", false, false],
      ["meeting_series", "meeting_series_timezone_known", false, false],
    ]);
  });

  it("0047-0048: the P4 slice F and G guards are attached (deferred audit, status guards, append-only history)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (c.relname IN ('adoption_indicator_template', 'stakeholder_group', 'stakeholder_champion',
         'adoption_metric_link', 'adoption_intervention', 'assessment_form', 'assessment_form_version', 'assessment_invitation',
         'training_record', 'assessment_record', 'stakeholder_involvement', 'champion_constraint', 'performance_area',
         'performance_area_cycle', 'performance_area_link', 'control', 'control_check', 'bau_handover', 'bau_handover_evidence',
         'transition_decision', 'sustainment_review', 'lesson', 'improvement_item', 'closure_record')
         OR t.tgname IN ('initiative_delivery_complete_guard', 'transformation_closure_guard'))
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["adoption_intervention", "adoption_intervention_audit_required", true, true],
      ["adoption_intervention", "adoption_intervention_guard", false, false],
      ["adoption_intervention", "adoption_intervention_row_guard", false, false],
      ["adoption_metric_link", "adoption_metric_link_audit_required", true, true],
      ["adoption_metric_link", "adoption_metric_link_guard", false, false],
      ["adoption_metric_link", "adoption_metric_link_row_guard", false, false],
      ["assessment_form", "assessment_form_audit_required", true, true],
      ["assessment_form", "assessment_form_guard", false, false],
      ["assessment_form", "assessment_form_row_guard", false, false],
      ["assessment_form_version", "assessment_form_version_append_only", false, false],
      ["assessment_form_version", "assessment_form_version_append_only_truncate", false, false],
      ["assessment_form_version", "assessment_form_version_audit_required", true, true],
      ["assessment_form_version", "assessment_form_version_guard", false, false],
      ["assessment_form_version", "assessment_form_version_row_guard", false, false],
      ["assessment_invitation", "assessment_invitation_audit_required", true, true],
      ["assessment_invitation", "assessment_invitation_guard", false, false],
      ["assessment_invitation", "assessment_invitation_row_guard", false, false],
      ["assessment_record", "assessment_record_audit_required", true, true],
      ["assessment_record", "assessment_record_guard", false, false],
      ["assessment_record", "assessment_record_row_guard", false, false],
      ["bau_handover", "bau_handover_audit_required", true, true],
      ["bau_handover", "bau_handover_guard", false, false],
      ["bau_handover", "bau_handover_row_guard", false, false],
      ["bau_handover_evidence", "bau_handover_evidence_append_only", false, false],
      ["bau_handover_evidence", "bau_handover_evidence_append_only_truncate", false, false],
      ["bau_handover_evidence", "bau_handover_evidence_audit_required", true, true],
      ["bau_handover_evidence", "bau_handover_evidence_guard", false, false],
      ["bau_handover_evidence", "bau_handover_evidence_row_guard", false, false],
      ["champion_constraint", "champion_constraint_audit_required", true, true],
      ["champion_constraint", "champion_constraint_guard", false, false],
      ["champion_constraint", "champion_constraint_row_guard", false, false],
      ["closure_record", "closure_record_append_only", false, false],
      ["closure_record", "closure_record_append_only_truncate", false, false],
      ["closure_record", "closure_record_audit_required", true, true],
      ["closure_record", "closure_record_guard", false, false],
      ["closure_record", "closure_record_row_guard", false, false],
      ["control", "control_audit_required", true, true],
      ["control", "control_guard", false, false],
      ["control", "control_row_guard", false, false],
      ["control_check", "control_check_audit_required", true, true],
      ["control_check", "control_check_guard", false, false],
      ["control_check", "control_check_row_guard", false, false],
      ["improvement_item", "improvement_item_audit_required", true, true],
      ["improvement_item", "improvement_item_guard", false, false],
      ["improvement_item", "improvement_item_row_guard", false, false],
      ["initiative", "initiative_delivery_complete_guard", false, false],
      ["lesson", "lesson_audit_required", true, true],
      ["lesson", "lesson_guard", false, false],
      ["lesson", "lesson_row_guard", false, false],
      ["performance_area", "performance_area_audit_required", true, true],
      ["performance_area", "performance_area_cycle_present", true, true],
      ["performance_area", "performance_area_guard", false, false],
      ["performance_area", "performance_area_row_guard", false, false],
      ["performance_area_cycle", "performance_area_cycle_append_only", false, false],
      ["performance_area_cycle", "performance_area_cycle_append_only_truncate", false, false],
      ["performance_area_cycle", "performance_area_cycle_audit_required", true, true],
      ["performance_area_cycle", "performance_area_cycle_row_guard", false, false],
      ["performance_area_link", "performance_area_link_audit_required", true, true],
      ["performance_area_link", "performance_area_link_guard", false, false],
      ["performance_area_link", "performance_area_link_row_guard", false, false],
      ["stakeholder_champion", "stakeholder_champion_audit_required", true, true],
      ["stakeholder_champion", "stakeholder_champion_guard", false, false],
      ["stakeholder_champion", "stakeholder_champion_row_guard", false, false],
      ["stakeholder_group", "stakeholder_group_audit_required", true, true],
      ["stakeholder_group", "stakeholder_group_guard", false, false],
      ["stakeholder_group", "stakeholder_group_row_guard", false, false],
      ["stakeholder_involvement", "stakeholder_involvement_append_only", false, false],
      ["stakeholder_involvement", "stakeholder_involvement_append_only_truncate", false, false],
      ["stakeholder_involvement", "stakeholder_involvement_audit_required", true, true],
      ["stakeholder_involvement", "stakeholder_involvement_guard", false, false],
      ["stakeholder_involvement", "stakeholder_involvement_row_guard", false, false],
      ["sustainment_review", "sustainment_review_audit_required", true, true],
      ["sustainment_review", "sustainment_review_guard", false, false],
      ["sustainment_review", "sustainment_review_row_guard", false, false],
      ["training_record", "training_record_audit_required", true, true],
      ["training_record", "training_record_guard", false, false],
      ["training_record", "training_record_row_guard", false, false],
      ["transformation", "transformation_closure_guard", false, false],
      ["transition_decision", "transition_decision_audit_required", true, true],
      ["transition_decision", "transition_decision_guard", false, false],
      ["transition_decision", "transition_decision_row_guard", false, false],
    ]);
  });

  it("0051-0052: the P4 slice H guards are attached (deferred audit, status guards, append-only reviews, scope and assessments)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (c.relname IN ('phase_definition', 'phase_step_definition', 'phase_step', 'phase_step_evidence',
         'gate_criterion_review', 'gate_exception', 'gate_decision_scale_scope', 'gate_decision_condition', 'scale_transition',
         'risk_disposition', 'change_control_policy', 'change_request', 'impact_assessment', 'impact_assessment_item')
         OR t.tgname = 'gate_submission_criterion_exception_valid')
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["change_control_policy", "change_control_policy_audit_required", true, true],
      ["change_control_policy", "change_control_policy_row_guard", false, false],
      ["change_request", "change_request_audit_required", true, true],
      ["change_request", "change_request_guard", false, false],
      ["change_request", "change_request_row_guard", false, false],
      ["gate_criterion_review", "gate_criterion_review_append_only", false, false],
      ["gate_criterion_review", "gate_criterion_review_append_only_truncate", false, false],
      ["gate_criterion_review", "gate_criterion_review_audit_required", true, true],
      ["gate_criterion_review", "gate_criterion_review_guard", false, false],
      ["gate_criterion_review", "gate_criterion_review_row_guard", false, false],
      ["gate_decision_condition", "gate_decision_condition_append_only", false, false],
      ["gate_decision_condition", "gate_decision_condition_append_only_truncate", false, false],
      ["gate_decision_condition", "gate_decision_condition_audit_required", true, true],
      ["gate_decision_condition", "gate_decision_condition_guard", false, false],
      ["gate_decision_condition", "gate_decision_condition_row_guard", false, false],
      ["gate_decision_scale_scope", "gate_decision_scale_scope_append_only", false, false],
      ["gate_decision_scale_scope", "gate_decision_scale_scope_append_only_truncate", false, false],
      ["gate_decision_scale_scope", "gate_decision_scale_scope_audit_required", true, true],
      ["gate_decision_scale_scope", "gate_decision_scale_scope_guard", false, false],
      ["gate_decision_scale_scope", "gate_decision_scale_scope_row_guard", false, false],
      ["gate_exception", "gate_exception_audit_required", true, true],
      ["gate_exception", "gate_exception_guard", false, false],
      ["gate_exception", "gate_exception_row_guard", false, false],
      ["gate_submission_criterion", "gate_submission_criterion_exception_valid", false, false],
      ["impact_assessment", "impact_assessment_append_only", false, false],
      ["impact_assessment", "impact_assessment_append_only_truncate", false, false],
      ["impact_assessment", "impact_assessment_audit_required", true, true],
      ["impact_assessment", "impact_assessment_row_guard", false, false],
      ["impact_assessment_item", "impact_assessment_item_append_only", false, false],
      ["impact_assessment_item", "impact_assessment_item_append_only_truncate", false, false],
      ["impact_assessment_item", "impact_assessment_item_row_guard", false, false],
      ["phase_step", "phase_step_audit_required", true, true],
      ["phase_step", "phase_step_row_guard", false, false],
      ["phase_step", "phase_step_status_step", false, false],
      ["phase_step_evidence", "phase_step_evidence_audit_required", true, true],
      ["phase_step_evidence", "phase_step_evidence_guard", false, false],
      ["phase_step_evidence", "phase_step_evidence_row_guard", false, false],
      ["risk_disposition", "risk_disposition_append_only", false, false],
      ["risk_disposition", "risk_disposition_append_only_truncate", false, false],
      ["risk_disposition", "risk_disposition_audit_required", true, true],
      ["risk_disposition", "risk_disposition_guard", false, false],
      ["risk_disposition", "risk_disposition_row_guard", false, false],
      ["scale_transition", "scale_transition_append_only", false, false],
      ["scale_transition", "scale_transition_append_only_truncate", false, false],
      ["scale_transition", "scale_transition_audit_required", true, true],
      ["scale_transition", "scale_transition_guard", false, false],
      ["scale_transition", "scale_transition_row_guard", false, false],
    ]);
  });

  it("0055-0056: the P4 slices J and K guards are attached (deferred audit, allocation-set guard, inherited-record guard)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (c.relname IN ('portfolio', 'portfolio_transformation', 'workstream', 'workstream_initiative',
         'trace_link', 'inherited_record', 't10_area_definition', 'dashboard_rag_policy')
         OR t.tgname = 'initiative_outcome_contribution_allocation_guard')
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["dashboard_rag_policy", "dashboard_rag_policy_audit_required", true, true],
      ["dashboard_rag_policy", "dashboard_rag_policy_row_guard", false, false],
      ["inherited_record", "inherited_record_audit_required", true, true],
      ["inherited_record", "inherited_record_guard", false, false],
      ["inherited_record", "inherited_record_row_guard", false, false],
      ["initiative_outcome_contribution", "initiative_outcome_contribution_allocation_guard", false, false],
      ["portfolio", "portfolio_audit_required", true, true],
      ["portfolio", "portfolio_row_guard", false, false],
      ["portfolio_transformation", "portfolio_transformation_audit_required", true, true],
      ["portfolio_transformation", "portfolio_transformation_row_guard", false, false],
      ["trace_link", "trace_link_allocation_guard", false, false],
      ["trace_link", "trace_link_audit_required", true, true],
      ["trace_link", "trace_link_row_guard", false, false],
      ["workstream", "workstream_audit_required", true, true],
      ["workstream", "workstream_row_guard", false, false],
      ["workstream_initiative", "workstream_initiative_audit_required", true, true],
      ["workstream_initiative", "workstream_initiative_row_guard", false, false],
    ]);
  });

  it("0062-0063: the P5 slice A guards are attached (deferred audit, Studio lifecycle, append-only runs and history)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('methodology_version', 'methodology_element', 'config_review_policy',
         'config_check_run', 'revision_proposal', 'config_review_request', 'methodology_migration',
         'methodology_migration_item', 'transformation_config_pin_history', 'gate_reapproval', 'transformation_config_pin')
         AND t.tgname NOT LIKE '%contributor%' -- 0097's triggers: checked by the 0097 test below
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["config_check_run", "config_check_run_append_only", false, false],
      ["config_check_run", "config_check_run_append_only_truncate", false, false],
      ["config_check_run", "config_check_run_audit_required", true, true],
      ["config_check_run", "config_check_run_row_guard", false, false],
      ["config_review_policy", "config_review_policy_audit_required", true, true],
      ["config_review_policy", "config_review_policy_guard", false, false],
      ["config_review_policy", "config_review_policy_row_guard", false, false],
      ["config_review_request", "config_review_request_audit_required", true, true],
      ["config_review_request", "config_review_request_guard", false, false],
      ["config_review_request", "config_review_request_row_guard", false, false],
      ["gate_reapproval", "gate_reapproval_audit_required", true, true],
      ["gate_reapproval", "gate_reapproval_guard", false, false],
      ["gate_reapproval", "gate_reapproval_row_guard", false, false],
      ["methodology_element", "methodology_element_audit_required", true, true],
      ["methodology_element", "methodology_element_guard", false, false],
      // 0089 (T-DG5-ARCH-06; ADR-0049 §2, §4, §6): the reader namespaces of methodology_text elements.
      ["methodology_element", "methodology_element_reader_guard", false, false],
      ["methodology_element", "methodology_element_row_guard", false, false],
      ["methodology_migration", "methodology_migration_audit_required", true, true],
      ["methodology_migration", "methodology_migration_executed_moved_pin", true, true],
      ["methodology_migration", "methodology_migration_guard", false, false],
      ["methodology_migration", "methodology_migration_row_guard", false, false],
      ["methodology_migration_item", "methodology_migration_item_append_only", false, false],
      ["methodology_migration_item", "methodology_migration_item_append_only_truncate", false, false],
      ["methodology_migration_item", "methodology_migration_item_row_guard", false, false],
      // 0086 (T-DG5-ARCH-05; ADR-0048 §6): the publish rule of a health-check scoring scheme.
      ["methodology_version", "health_scheme_publish_guard", false, false],
      ["methodology_version", "methodology_version_audit_required", true, true],
      ["methodology_version", "methodology_version_kind_key", false, false],
      ["methodology_version", "methodology_version_new_draft", false, false],
      ["methodology_version", "methodology_version_published_immutable", false, false],
      ["methodology_version", "methodology_version_row_guard", false, false],
      ["methodology_version", "methodology_version_studio_guard", false, false],
      ["revision_proposal", "revision_proposal_append_only", false, false],
      ["revision_proposal", "revision_proposal_append_only_truncate", false, false],
      ["revision_proposal", "revision_proposal_audit_required", true, true],
      ["revision_proposal", "revision_proposal_row_guard", false, false],
      ["transformation_config_pin", "transformation_config_pin_audit_required", true, true],
      ["transformation_config_pin", "transformation_config_pin_guard", false, false],
      ["transformation_config_pin", "transformation_config_pin_history_required", true, true],
      ["transformation_config_pin", "transformation_config_pin_row_guard", false, false],
      ["transformation_config_pin_history", "transformation_config_pin_history_append_only", false, false],
      ["transformation_config_pin_history", "transformation_config_pin_history_append_only_truncate", false, false],
      ["transformation_config_pin_history", "transformation_config_pin_history_row_guard", false, false],
    ]);
  });

  it("0068-0070: the P5 slice B/C guards are attached (deferred audit, record references, append-only comments and links)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('form_custom_value', 'form_draft', 'form_record_attachment', 'form_record_comment', 'methodology_coverage_link', 'procedure_definition', 'procedure_instance', 'procedure_instance_link', 'procedure_step_definition', 'procedure_step_instance', 'form_record_type', 'form_source_field')
         AND t.tgname NOT LIKE '%contributor%' -- 0097's triggers: checked by the 0097 test below
       ORDER BY 1, 2`,
    );
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual([
      ["form_custom_value", "form_custom_value_audit_required", true, true],
      ["form_custom_value", "form_custom_value_guard", false, false],
      ["form_custom_value", "form_custom_value_record_ref", false, false],
      ["form_custom_value", "form_custom_value_row_guard", false, false],
      ["form_draft", "form_draft_audit_required", true, true],
      ["form_draft", "form_draft_guard", false, false],
      ["form_draft", "form_draft_record_ref", false, false],
      ["form_draft", "form_draft_row_guard", false, false],
      ["form_record_attachment", "form_record_attachment_audit_required", true, true],
      ["form_record_attachment", "form_record_attachment_guard", false, false],
      ["form_record_attachment", "form_record_attachment_record_ref", false, false],
      ["form_record_attachment", "form_record_attachment_row_guard", false, false],
      ["form_record_comment", "form_record_comment_append_only", false, false],
      ["form_record_comment", "form_record_comment_append_only_truncate", false, false],
      ["form_record_comment", "form_record_comment_audit_required", true, true],
      ["form_record_comment", "form_record_comment_parent", false, false],
      ["form_record_comment", "form_record_comment_record_ref", false, false],
      ["form_record_comment", "form_record_comment_row_guard", false, false],
      ["methodology_coverage_link", "methodology_coverage_link_guard", false, false],
      ["procedure_definition", "procedure_definition_audit_required", true, true],
      ["procedure_definition", "procedure_definition_guard", false, false],
      ["procedure_definition", "procedure_definition_row_guard", false, false],
      ["procedure_instance", "procedure_instance_audit_required", true, true],
      ["procedure_instance", "procedure_instance_guard", false, false],
      ["procedure_instance", "procedure_instance_row_guard", false, false],
      ["procedure_instance_link", "procedure_instance_link_append_only", false, false],
      ["procedure_instance_link", "procedure_instance_link_append_only_truncate", false, false],
      ["procedure_instance_link", "procedure_instance_link_audit_required", true, true],
      ["procedure_instance_link", "procedure_instance_link_guard", false, false],
      ["procedure_instance_link", "procedure_instance_link_row_guard", false, false],
      ["procedure_step_definition", "procedure_step_definition_audit_required", true, true],
      ["procedure_step_definition", "procedure_step_definition_guard", false, false],
      ["procedure_step_definition", "procedure_step_definition_row_guard", false, false],
      ["procedure_step_instance", "procedure_step_instance_audit_required", true, true],
      ["procedure_step_instance", "procedure_step_instance_guard", false, false],
      ["procedure_step_instance", "procedure_step_instance_row_guard", false, false],
    ]);
  });

  it("0071: form_custom_value_guard() keeps every 0068 rule and accepts a multiple choice as a list (T-DG5-BE-D; D-145)", async () => {
    const [fn] = await q<{ def: string }>(
      `SELECT pg_get_functiondef('form_custom_value_guard()'::regprocedure) AS def`,
    );
    const def = fn!.def;
    // The 0068 constraint names are all still raised by the redefined function.
    for (const name of [
      "form_custom_value_record_type",
      "form_custom_value_pinned_version",
      "form_custom_value_unknown_field",
      "form_custom_value_type_shape",
    ])
      expect(def, name).toContain(`CONSTRAINT = '${name}'`);
    // The 0071 choice clause: the field's `multiple` setting selects an array of unique strings, else one string.
    expect(def).toContain("fmultiple");
    expect(def).toContain("count(DISTINCT x.item)");
    // The trigger that calls it is unchanged (0068).
    const triggers = await q<{ tgname: string }>(
      `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'form_custom_value' AND NOT t.tgisinternal AND t.tgname = 'form_custom_value_guard'`,
    );
    expect(triggers).toHaveLength(1);
  });

  it("0065: studio_default weight sets have no approver; p3_instantiate_transformation() pins scoring_defaults (T-DG5-KBE-A; D-142 Q12)", async () => {
    const checks = await q<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'scoring_weight_set'::regclass
          AND conname IN ('scoring_weight_set_approval_basis_check', 'scoring_weight_set_approval_complete')
        ORDER BY conname`,
    );
    expect(checks.map((c) => c.conname)).toEqual([
      "scoring_weight_set_approval_basis_check",
      "scoring_weight_set_approval_complete",
    ]);
    // The basis CHECK lists the DG3 values and the P5 one; the approval CHECK keeps both DG3 clauses and adds 'studio_default'.
    for (const v of ["source_default", "approved", "studio_default"]) expect(checks[0]!.def).toContain(`'${v}'`);
    for (const v of ["'approved'", "'source_default'", "'studio_default'"]) expect(checks[1]!.def).toContain(v);
    const [fn] = await q<{ def: string }>(
      `SELECT pg_get_functiondef('p3_instantiate_transformation(uuid, uuid, text, text)'::regprocedure) AS def`,
    );
    const def = fn!.def;
    expect(def).toContain("p2_instantiate_transformation(p_transformation_id");
    expect(def).toContain("'scoring_defaults'");
    expect(def).toContain("'scoring-defaults'");
    expect(def).toContain("'studio_default'");
    // The DG3 statements are still there verbatim (byte-identical output while the defaults equal B0076).
    expect(def).toContain(
      "'Source default weights (B0076): strategic fit 25%, financial value 25%, customer impact 20%, feasibility 15%, time-to-value 15%.'",
    );
  });

  it("0074-0075: the P5 slice D/E guards are attached (deferred audit and effective-version checks, append-only history)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('automation_rule', 'automation_rule_version', 'automation_dry_run',
         'automation_execution', 'automation_action_result', 'job_run', 'operational_failure', 'approval_route_step',
         'gate_condition_closure', 'gate_condition_escalation', 'notification_policy', 'notification_preference',
         'notification_digest', 'meeting_cutoff_pack', 'dependency_slip')
         AND t.tgname NOT LIKE '%contributor%' -- 0097's triggers: checked by the 0097 test below
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const guarded = (t: string, extra: string[] = [], appendOnly = false, audited = true): Row[] => [
      ...(appendOnly
        ? ([
            [t, `${t}_append_only`, false, false],
            [t, `${t}_append_only_truncate`, false, false],
          ] as Row[])
        : []),
      ...(audited ? ([[t, `${t}_audit_required`, true, true]] as Row[]) : []),
      ...extra.map((x): Row => [t, x, false, false]),
      [t, `${t}_row_guard`, false, false],
    ];
    const expected: Row[] = [
      ...guarded("approval_route_step", ["approval_route_step_guard"]),
      ...guarded("automation_action_result", ["automation_action_result_guard"], true),
      ...guarded("automation_dry_run", ["automation_dry_run_guard"], true),
      ...guarded("automation_execution", ["automation_execution_guard"]),
      ["automation_rule", "automation_rule_audit_required", true, true] as Row,
      ["automation_rule", "automation_rule_effective_check", true, true] as Row,
      ["automation_rule", "automation_rule_guard", false, false] as Row,
      ["automation_rule", "automation_rule_row_guard", false, false] as Row,
      ...guarded("automation_rule_version", ["automation_rule_version_guard"]),
      ...guarded("dependency_slip", [], true),
      ...guarded("gate_condition_closure", ["gate_condition_closure_guard"], true),
      ...guarded("gate_condition_escalation", ["gate_condition_escalation_guard"], true),
      ...guarded("job_run", [], true, false),
      ...guarded("meeting_cutoff_pack", ["meeting_cutoff_pack_guard"]),
      ...guarded("notification_digest", [], true),
      ...guarded("notification_policy"),
      ...guarded("notification_preference", [
        "notification_preference_guard",
        "notification_preference_timezone_known",
      ]),
      ...guarded("operational_failure", ["operational_failure_guard"]),
    ].sort((a, b) => {
      // Code-point order, as PostgreSQL's C collation sorts (ORDER BY 1, 2).
      const x = `${a[0]}\u0000${a[1]}`;
      const y = `${b[0]}\u0000${b[1]}`;
      return x < y ? -1 : x > y ? 1 : 0;
    });
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
  });

  it("0080-0081: the P5 slice F guards are attached (immutable snapshots, creation-only children, deferred checks)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('report_snapshot', 'report_snapshot_source', 'report_snapshot_version',
         'report_snapshot_evidence', 'owner_update', 'owner_update_revision', 'export_job', 'export_job_progress')
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const expected: Row[] = [
      ["export_job", "export_job_audit_required", true, true],
      ["export_job", "export_job_guard", false, false],
      ["export_job", "export_job_row_guard", false, false],
      ["export_job_progress", "export_job_progress_guard", false, false],
      ["export_job_progress", "export_job_progress_row_guard", false, false],
      ["owner_update", "owner_update_audit_required", true, true],
      ["owner_update", "owner_update_guard", false, false],
      ["owner_update", "owner_update_revision_present", true, true],
      ["owner_update", "owner_update_row_guard", false, false],
      ["owner_update_revision", "owner_update_revision_append_only", false, false],
      ["owner_update_revision", "owner_update_revision_append_only_truncate", false, false],
      ["owner_update_revision", "owner_update_revision_row_guard", false, false],
      ["report_snapshot", "report_snapshot_audit_required", true, true],
      ["report_snapshot", "report_snapshot_guard", false, false],
      ["report_snapshot", "report_snapshot_row_guard", false, false],
      ["report_snapshot", "report_snapshot_supersede_check", true, true],
      ["report_snapshot_evidence", "report_snapshot_evidence_append_only", false, false],
      ["report_snapshot_evidence", "report_snapshot_evidence_append_only_truncate", false, false],
      ["report_snapshot_evidence", "report_snapshot_evidence_content", false, false],
      ["report_snapshot_evidence", "report_snapshot_evidence_guard", false, false],
      ["report_snapshot_evidence", "report_snapshot_evidence_row_guard", false, false],
      ["report_snapshot_source", "report_snapshot_source_append_only", false, false],
      ["report_snapshot_source", "report_snapshot_source_append_only_truncate", false, false],
      ["report_snapshot_source", "report_snapshot_source_guard", false, false],
      ["report_snapshot_source", "report_snapshot_source_row_guard", false, false],
      ["report_snapshot_version", "report_snapshot_version_append_only", false, false],
      ["report_snapshot_version", "report_snapshot_version_append_only_truncate", false, false],
      ["report_snapshot_version", "report_snapshot_version_guard", false, false],
      ["report_snapshot_version", "report_snapshot_version_row_guard", false, false],
    ];
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
  });

  it("0085-0086: the P5 slice G/H guards are attached (deferred audit and completeness checks, append-only children)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('kpi_restatement', 'kpi_restatement_period', 'kpi_restatement_reconciliation', 'kpi_restatement_reissue_offer',
         'financial_metric_setting', 'financial_cash_flow_set', 'financial_cash_flow', 'launch_plan', 'launch_task',
         'launch_task_predecessor', 'day_ninety_test', 'day_ninety_response', 'health_assessment', 'health_assessment_answer',
         'health_assessment_action')
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const expected: Row[] = [
      ["day_ninety_response", "day_ninety_response_audit_required", true, true],
      ["day_ninety_response", "day_ninety_response_counted", true, true],
      ["day_ninety_response", "day_ninety_response_guard", false, false],
      ["day_ninety_response", "day_ninety_response_row_guard", false, false],
      ["day_ninety_test", "day_ninety_test_audit_required", true, true],
      ["day_ninety_test", "day_ninety_test_counted", true, true],
      ["day_ninety_test", "day_ninety_test_guard", false, false],
      ["day_ninety_test", "day_ninety_test_row_guard", false, false],
      ["financial_cash_flow", "financial_cash_flow_append_only", false, false],
      ["financial_cash_flow", "financial_cash_flow_append_only_truncate", false, false],
      ["financial_cash_flow", "financial_cash_flow_complete", true, true],
      ["financial_cash_flow", "financial_cash_flow_guard", false, false],
      ["financial_cash_flow", "financial_cash_flow_row_guard", false, false],
      ["financial_cash_flow_set", "financial_cash_flow_set_audit_required", true, true],
      ["financial_cash_flow_set", "financial_cash_flow_set_complete", true, true],
      ["financial_cash_flow_set", "financial_cash_flow_set_guard", false, false],
      ["financial_cash_flow_set", "financial_cash_flow_set_row_guard", false, false],
      ["financial_metric_setting", "financial_metric_setting_audit_required", true, true],
      ["financial_metric_setting", "financial_metric_setting_row_guard", false, false],
      ["health_assessment", "health_assessment_audit_required", true, true],
      ["health_assessment", "health_assessment_counted", true, true],
      ["health_assessment", "health_assessment_guard", false, false],
      ["health_assessment", "health_assessment_row_guard", false, false],
      ["health_assessment_action", "health_assessment_action_audit_required", true, true],
      ["health_assessment_action", "health_assessment_action_guard", false, false],
      ["health_assessment_action", "health_assessment_action_row_guard", false, false],
      ["health_assessment_answer", "health_assessment_answer_audit_required", true, true],
      ["health_assessment_answer", "health_assessment_answer_counted", true, true],
      ["health_assessment_answer", "health_assessment_answer_guard", false, false],
      ["health_assessment_answer", "health_assessment_answer_row_guard", false, false],
      ["kpi_restatement", "kpi_restatement_audit_required", true, true],
      ["kpi_restatement", "kpi_restatement_complete", true, true],
      ["kpi_restatement", "kpi_restatement_guard", false, false],
      ["kpi_restatement", "kpi_restatement_row_guard", false, false],
      ["kpi_restatement_period", "kpi_restatement_period_append_only", false, false],
      ["kpi_restatement_period", "kpi_restatement_period_append_only_truncate", false, false],
      ["kpi_restatement_period", "kpi_restatement_period_complete", true, true],
      ["kpi_restatement_period", "kpi_restatement_period_guard", false, false],
      ["kpi_restatement_period", "kpi_restatement_period_row_guard", false, false],
      ["kpi_restatement_reconciliation", "kpi_restatement_reconciliation_append_only", false, false],
      ["kpi_restatement_reconciliation", "kpi_restatement_reconciliation_append_only_truncate", false, false],
      ["kpi_restatement_reconciliation", "kpi_restatement_reconciliation_complete", true, true],
      ["kpi_restatement_reconciliation", "kpi_restatement_reconciliation_guard", false, false],
      ["kpi_restatement_reconciliation", "kpi_restatement_reconciliation_row_guard", false, false],
      ["kpi_restatement_reissue_offer", "kpi_restatement_reissue_offer_append_only", false, false],
      ["kpi_restatement_reissue_offer", "kpi_restatement_reissue_offer_append_only_truncate", false, false],
      ["kpi_restatement_reissue_offer", "kpi_restatement_reissue_offer_guard", false, false],
      ["kpi_restatement_reissue_offer", "kpi_restatement_reissue_offer_row_guard", false, false],
      ["launch_plan", "launch_plan_audit_required", true, true],
      ["launch_plan", "launch_plan_guard", false, false],
      ["launch_plan", "launch_plan_row_guard", false, false],
      ["launch_task", "launch_task_audit_required", true, true],
      ["launch_task", "launch_task_guard", false, false],
      ["launch_task", "launch_task_row_guard", false, false],
      ["launch_task_predecessor", "launch_task_predecessor_audit_required", true, true],
      ["launch_task_predecessor", "launch_task_predecessor_guard", false, false],
      ["launch_task_predecessor", "launch_task_predecessor_row_guard", false, false],
    ];
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
  });

  it("0089-0090: the P5 slice I/J guards are attached (deferred audit on branding, immutable catalogues and histories)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('guiding_question', 'playbook_block', 'playbook_block_link', 'source_foundation',
         'methodology_element_profile', 'branding_version', 'branding_setting', 'deployment_environment', 'demo_seed_record',
         'demo_dataset_run', 'walkthrough_step')
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const expected: Row[] = [
      ["branding_setting", "branding_setting_audit_required", true, true],
      ["branding_setting", "branding_setting_guard", false, false],
      ["branding_setting", "branding_setting_row_guard", false, false],
      ["branding_version", "branding_version_append_only", false, false],
      ["branding_version", "branding_version_append_only_truncate", false, false],
      ["branding_version", "branding_version_audit_required", true, true],
      ["branding_version", "branding_version_guard", false, false],
      ["branding_version", "branding_version_row_guard", false, false],
      ["demo_dataset_run", "demo_dataset_run_append_only", false, false],
      ["demo_dataset_run", "demo_dataset_run_append_only_truncate", false, false],
      ["demo_dataset_run", "demo_dataset_run_guard", false, false],
      ["demo_seed_record", "demo_seed_record_append_only", false, false],
      ["demo_seed_record", "demo_seed_record_append_only_truncate", false, false],
      ["demo_seed_record", "demo_seed_record_guard", false, false],
      ["deployment_environment", "deployment_environment_append_only", false, false],
      ["deployment_environment", "deployment_environment_append_only_truncate", false, false],
      ["guiding_question", "guiding_question_append_only", false, false],
      ["guiding_question", "guiding_question_append_only_truncate", false, false],
      ["methodology_element_profile", "methodology_element_profile_append_only", false, false],
      ["methodology_element_profile", "methodology_element_profile_append_only_truncate", false, false],
      ["methodology_element_profile", "methodology_element_profile_guard", false, false],
      ["playbook_block", "playbook_block_guard", false, false],
      ["playbook_block", "playbook_block_guard_truncate", false, false],
      ["playbook_block_link", "playbook_block_link_append_only", false, false],
      ["playbook_block_link", "playbook_block_link_append_only_truncate", false, false],
      ["source_foundation", "source_foundation_append_only", false, false],
      ["source_foundation", "source_foundation_append_only_truncate", false, false],
      ["walkthrough_step", "walkthrough_step_append_only", false, false],
      ["walkthrough_step", "walkthrough_step_append_only_truncate", false, false],
    ];
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
  });

  it("0098-0099: the P6 slice E/F guards are attached (deferred audit, record references, set-once deep links, trigger-written histories)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (c.relname IN ('record_sensitivity', 'record_sensitivity_change', 'sensitive_record_grant',
         'upload_policy', 'upload_policy_change') OR t.tgname = 'inbox_notification_deep_link_guard')
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const expected: Row[] = [
      ["inbox_notification", "inbox_notification_deep_link_guard", false, false],
      ["record_sensitivity", "record_sensitivity_audit_required", true, true],
      ["record_sensitivity", "record_sensitivity_guard", false, false],
      ["record_sensitivity", "record_sensitivity_history", false, false],
      ["record_sensitivity", "record_sensitivity_record_ref", false, false],
      ["record_sensitivity", "record_sensitivity_row_guard", false, false],
      ["record_sensitivity_change", "record_sensitivity_change_append_only", false, false],
      ["record_sensitivity_change", "record_sensitivity_change_append_only_truncate", false, false],
      ["sensitive_record_grant", "sensitive_record_grant_audit_required", true, true],
      ["sensitive_record_grant", "sensitive_record_grant_guard", false, false],
      ["sensitive_record_grant", "sensitive_record_grant_record_ref", false, false],
      ["sensitive_record_grant", "sensitive_record_grant_row_guard", false, false],
      ["upload_policy", "upload_policy_audit_required", true, true],
      ["upload_policy", "upload_policy_history", false, false],
      ["upload_policy", "upload_policy_row_guard", false, false],
      ["upload_policy_change", "upload_policy_change_append_only", false, false],
      ["upload_policy_change", "upload_policy_change_append_only_truncate", false, false],
    ];
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
  });

  it("0101-0102: the P6 slice J/C guards are attached (deferred audit, state machines, trigger-written histories, append-only links, an unaudited heartbeat)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('notification_channel', 'notification_channel_change', 'notification_delivery', 'operational_exception', 'operational_exception_event', 'operational_exception_kpi', 'service_identity', 'service_identity_change', 'storage_setting', 'storage_setting_change', 'worker_heartbeat')
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const expected: Row[] = [
      ["notification_channel", "notification_channel_audit_required", true, true],
      ["notification_channel", "notification_channel_history", false, false],
      ["notification_channel", "notification_channel_row_guard", false, false],
      ["notification_channel_change", "notification_channel_change_append_only", false, false],
      ["notification_channel_change", "notification_channel_change_append_only_truncate", false, false],
      ["notification_delivery", "notification_delivery_audit_required", true, true],
      ["notification_delivery", "notification_delivery_guard", false, false],
      ["notification_delivery", "notification_delivery_row_guard", false, false],
      ["operational_exception", "operational_exception_audit_required", true, true],
      ["operational_exception", "operational_exception_guard", false, false],
      ["operational_exception", "operational_exception_history", false, false],
      ["operational_exception", "operational_exception_row_guard", false, false],
      ["operational_exception_event", "operational_exception_event_append_only", false, false],
      ["operational_exception_event", "operational_exception_event_append_only_truncate", false, false],
      ["operational_exception_kpi", "operational_exception_kpi_append_only", false, false],
      ["operational_exception_kpi", "operational_exception_kpi_append_only_truncate", false, false],
      ["operational_exception_kpi", "operational_exception_kpi_guard", false, false],
      ["service_identity", "service_identity_audit_required", true, true],
      ["service_identity", "service_identity_guard", false, false],
      ["service_identity", "service_identity_history", false, false],
      ["service_identity", "service_identity_row_guard", false, false],
      ["service_identity_change", "service_identity_change_append_only", false, false],
      ["service_identity_change", "service_identity_change_append_only_truncate", false, false],
      ["storage_setting", "storage_setting_audit_required", true, true],
      ["storage_setting", "storage_setting_history", false, false],
      ["storage_setting", "storage_setting_row_guard", false, false],
      ["storage_setting_change", "storage_setting_change_append_only", false, false],
      ["storage_setting_change", "storage_setting_change_append_only_truncate", false, false],
      ["worker_heartbeat", "worker_heartbeat_guard", false, false],
      ["worker_heartbeat", "worker_heartbeat_row_guard", false, false],
    ];
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
  });

  it("0104-0106: the P6 slice B/A guards are attached (deferred audit, state machines, trigger-written histories, append-only configuration versions, receipts and lineage, staged rows never deleted)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('connector', 'connector_change', 'connector_config_version', 'deliverable_external_change', 'deliverable_external_change_event', 'import_batch', 'import_batch_event', 'import_row', 'import_row_commit', 'integration_run', 'integration_run_event', 'outbound_write', 'outbound_write_event', 'webhook_endpoint', 'webhook_endpoint_change', 'webhook_receipt')
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const expected: Row[] = [
      ["connector", "connector_audit_required", true, true],
      ["connector", "connector_guard", false, false],
      ["connector", "connector_history", false, false],
      ["connector", "connector_row_guard", false, false],
      ["connector_change", "connector_change_append_only", false, false],
      ["connector_change", "connector_change_append_only_truncate", false, false],
      ["connector_config_version", "connector_config_version_append_only", false, false],
      ["connector_config_version", "connector_config_version_append_only_truncate", false, false],
      ["connector_config_version", "connector_config_version_guard", false, false],
      ["deliverable_external_change", "deliverable_external_change_audit_required", true, true],
      ["deliverable_external_change", "deliverable_external_change_guard", false, false],
      ["deliverable_external_change", "deliverable_external_change_history", false, false],
      ["deliverable_external_change", "deliverable_external_change_row_guard", false, false],
      ["deliverable_external_change_event", "deliverable_external_change_event_append_only", false, false],
      ["deliverable_external_change_event", "deliverable_external_change_event_append_only_truncate", false, false],
      ["import_batch", "import_batch_audit_required", true, true],
      ["import_batch", "import_batch_guard", false, false],
      ["import_batch", "import_batch_history", false, false],
      ["import_batch", "import_batch_row_guard", false, false],
      ["import_batch_event", "import_batch_event_append_only", false, false],
      ["import_batch_event", "import_batch_event_append_only_truncate", false, false],
      ["import_row", "import_row_guard", false, false],
      ["import_row", "import_row_no_delete", false, false],
      ["import_row", "import_row_no_truncate", false, false],
      ["import_row", "import_row_row_guard", false, false],
      ["import_row_commit", "import_row_commit_append_only", false, false],
      ["import_row_commit", "import_row_commit_append_only_truncate", false, false],
      ["import_row_commit", "import_row_commit_guard", false, false],
      ["integration_run", "integration_run_audit_required", true, true],
      ["integration_run", "integration_run_guard", false, false],
      ["integration_run", "integration_run_history", false, false],
      ["integration_run", "integration_run_row_guard", false, false],
      ["integration_run_event", "integration_run_event_append_only", false, false],
      ["integration_run_event", "integration_run_event_append_only_truncate", false, false],
      ["outbound_write", "outbound_write_audit_required", true, true],
      ["outbound_write", "outbound_write_guard", false, false],
      ["outbound_write", "outbound_write_history", false, false],
      ["outbound_write", "outbound_write_row_guard", false, false],
      ["outbound_write_event", "outbound_write_event_append_only", false, false],
      ["outbound_write_event", "outbound_write_event_append_only_truncate", false, false],
      ["webhook_endpoint", "webhook_endpoint_audit_required", true, true],
      ["webhook_endpoint", "webhook_endpoint_guard", false, false],
      ["webhook_endpoint", "webhook_endpoint_history", false, false],
      ["webhook_endpoint", "webhook_endpoint_row_guard", false, false],
      ["webhook_endpoint_change", "webhook_endpoint_change_append_only", false, false],
      ["webhook_endpoint_change", "webhook_endpoint_change_append_only_truncate", false, false],
      ["webhook_receipt", "webhook_receipt_append_only", false, false],
      ["webhook_receipt", "webhook_receipt_append_only_truncate", false, false],
      ["webhook_receipt", "webhook_receipt_guard", false, false],
    ];
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
  });

  it("0097: the contributor tables are append-only and every content table of a draft records its writers (D-170)", async () => {
    const rows = await q<{ rel: string; tgname: string; deferrable: boolean; deferred: boolean }>(
      `SELECT c.relname AS rel, t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND (t.tgname LIKE '%contributor%' OR c.relname LIKE '%_contributor')
       ORDER BY 1, 2`,
    );
    type Row = [string, string, boolean, boolean];
    const expected: Row[] = [
      ["automation_rule_version", "automation_rule_version_contributor_audit_insert", true, true],
      ["automation_rule_version", "automation_rule_version_contributor_audit_update", true, true],
      ["automation_rule_version", "automation_rule_version_contributor_insert", false, false],
      ["automation_rule_version", "automation_rule_version_contributor_update", false, false],
      ["automation_rule_version", "automation_rule_version_sod_contributor", false, false],
      ["automation_rule_version_contributor", "automation_rule_version_contributor_append_only", false, false],
      ["automation_rule_version_contributor", "automation_rule_version_contributor_append_only_truncate", false, false],
      ["config_review_request", "config_review_request_sod_contributor", false, false],
      ["methodology_element", "methodology_element_contributor", false, false],
      ["methodology_element", "methodology_element_contributor_audit", true, true],
      ["methodology_version", "methodology_version_contributor_audit_insert", true, true],
      ["methodology_version", "methodology_version_contributor_audit_update", true, true],
      ["methodology_version", "methodology_version_contributor_insert", false, false],
      ["methodology_version", "methodology_version_contributor_update", false, false],
      ["methodology_version_contributor", "methodology_version_contributor_append_only", false, false],
      ["methodology_version_contributor", "methodology_version_contributor_append_only_truncate", false, false],
      ["procedure_definition", "procedure_definition_contributor", false, false],
      ["procedure_definition", "procedure_definition_contributor_audit", true, true],
      ["procedure_step_definition", "procedure_step_definition_contributor", false, false],
      ["procedure_step_definition", "procedure_step_definition_contributor_audit", true, true],
    ];
    expect(rows.map((r) => [r.rel, r.tgname, r.deferrable, r.deferred])).toEqual(expected);
    // The backfill wrote one migration audit event per backfilled draft, and none for a draft without contributors.
    const orphan = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_event e WHERE e.action = 'methodology_version.contributors_backfill'
         AND NOT EXISTS (SELECT 1 FROM methodology_version_contributor c WHERE c.methodology_version_id = e.record_id)`,
    );
    expect(orphan).toEqual([{ n: "0" }]);
  });

  it("marks exactly the views as views", async () => {
    const views = await q<{ table_name: string }>(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public' ORDER BY 1`,
    );
    expect(views.map((v) => v.table_name)).toEqual([...VIEW_NAMES].sort());
  });
});

describe("type and structure rules (ADR-0003, data dictionary global rules)", () => {
  it("uses timestamptz only (no timestamp without time zone) and no floating point", async () => {
    const bad = await q<{ t: string; c: string; d: string }>(
      `SELECT table_name AS t, column_name AS c, data_type AS d FROM information_schema.columns
       WHERE table_schema = 'public' AND data_type IN ('timestamp without time zone', 'real', 'double precision')`,
    );
    expect(bad).toEqual([]);
  });

  it("gives every base table a primary key and uuid ids without defaults", async () => {
    const noPk = await q<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'
         AND NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p')`,
    );
    expect(noPk).toEqual([]);
    const idDefaults = await q<{ t: string }>(
      `SELECT table_name AS t FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'id' AND data_type = 'uuid' AND column_default IS NOT NULL`,
    );
    expect(idDefaults).toEqual([]);
  });

  it("gives every mutable business table a version column >= 1 defaulting to 1", async () => {
    const mutable = [
      "organization",
      "business_unit",
      "app_user",
      "role",
      "scoped_assignment",
      "delegation",
      "transformation",
      // P2 (0010-0018): every mutable business, catalogue and history-header table (ADR-0016).
      "methodology_version",
      "transformation_config_pin",
      "diagnostic_dimension",
      "diagnostic_workstream",
      "tom_dimension",
      "gate_definition",
      "gate_criterion_definition",
      "charter_scope_check_definition",
      "good_outcome_criterion",
      "evidence",
      "evidence_link",
      "north_star",
      "strategic_guardrail",
      "outcome",
      "charter",
      "kpi_definition",
      "baseline",
      "outcome_kpi",
      "value_pool",
      "diagnostic_item",
      "diagnostic_finding",
      "diagnostic_workstream_output",
      "tom_canvas_cell",
      "tom_gap",
      "capability",
      "journey",
      "journey_pain_point",
      "decision",
      "decision_option",
      "tom_workshop",
      "tom_workshop_participant",
      "tom_workshop_item",
      "action_item",
      "dependency",
      "gate_instance",
      "gate_submission",
      "role_accountability",
      // P3 (0020-0024): every mutable business, catalogue and lifecycle-header table (ADR-0021..0024).
      "roadmap_wave",
      "initiative",
      "initiative_gap_link",
      "initiative_outcome_contribution",
      "initiative_decision_link",
      "deliverable",
      "milestone",
      "gate_dispensation",
      "scoring_weight_set",
      "initiative_score",
      "ranking_snapshot",
      "ranking_override",
      "dependency_type",
      "resource_role",
      "capacity",
      "resource_demand",
      "benefit_formula",
      "benefit_formula_version",
      "business_case",
      "business_case_line",
      "benefit_formula_example",
      // P4 slices I and C (0028-0031, T-DG4-ARCH-01; ADR-0025, ADR-0026).
      "business_calendar",
      "business_calendar_holiday",
      "job_schedule",
      "work_item",
      "inbox_notification",
      "access_group",
      "access_group_member",
      "role_mapping",
      "governance_matrix",
      "transformation_decision_right",
      "transformation_raci_deliverable",
      "transformation_raci_assignment",
      "approval",
      // P4 slice A (0033-0036, T-DG4-ARCH-02; ADR-0027, ADR-0028).
      "reporting_period",
      "kpi_version",
      "kpi_rag_threshold",
      "target_trajectory",
      "kpi_actual",
      "data_quality_finding",
      "rag_override",
      // P4 slice B (0037-0040, T-DG4-ARCH-03; ADR-0029, ADR-0030).
      "benefit_valuation_method",
      "benefit_group",
      "benefit",
      "benefit_enabler",
      "benefit_scenario",
      "benefit_scenario_value",
      "benefit_plan_value",
      "benefit_measurement",
      "finance_validation",
      "benefit_overlap",
      // P4 slice E (0041-0043, T-DG4-ARCH-04; ADR-0031).
      "raid_entry",
      "corrective_action_rule",
      "corrective_case",
      "budget_line",
      "initiative_schedule",
      // P4 slice D (0044-0046, T-DG4-ARCH-05; ADR-0032).
      "forum",
      "forum_participant",
      "meeting_series",
      "meeting",
      "agenda_item",
      "meeting_attendance",
      "meeting_minutes",
      "governance_escalation_rule",
      // P4 slices F and G (0047-0049, T-DG4-ARCH-06; ADR-0033, ADR-0034).
      "adoption_intervention",
      "adoption_metric_link",
      "assessment_form",
      "assessment_invitation",
      "assessment_record",
      "bau_handover",
      "champion_constraint",
      "control",
      "control_check",
      "improvement_item",
      "lesson",
      "performance_area",
      "performance_area_link",
      "stakeholder_champion",
      "stakeholder_group",
      "sustainment_review",
      "training_record",
      "transition_decision",
      // P4 slice H (0051-0052, T-DG4-ARCH-07; ADR-0035, ADR-0036).
      "change_control_policy",
      "change_request",
      "gate_exception",
      "phase_step",
      "phase_step_evidence",
      "risk_disposition",
      // P4 slices J and K (0055-0056, T-DG4-ARCH-08; ADR-0037, ADR-0038).
      "dashboard_rag_policy",
      "inherited_record",
      "portfolio",
      "portfolio_transformation",
      "trace_link",
      "workstream",
      "workstream_initiative",
      // P5 slice A (0062-0063, T-DG5-ARCH-01; ADR-0039, ADR-0040).
      "config_review_policy",
      "config_review_request",
      "gate_reapproval",
      "methodology_element",
      "methodology_migration",
      // P5 slices B and C (0068-0069, T-DG5-ARCH-02; ADR-0041, ADR-0042).
      "form_custom_value",
      "form_draft",
      "form_record_attachment",
      "procedure_definition",
      "procedure_instance",
      "procedure_step_definition",
      "procedure_step_instance",
      // P5 slices D and E (0074-0075, T-DG5-ARCH-03; ADR-0043, ADR-0044).
      "approval_route_step",
      "automation_execution",
      "automation_rule",
      "automation_rule_version",
      "meeting_cutoff_pack",
      "notification_policy",
      "notification_preference",
      "operational_failure",
      // P5 slice F (0080-0081, T-DG5-ARCH-04; ADR-0045, ADR-0046).
      "export_job",
      "export_job_progress",
      "owner_update",
      "report_snapshot",
      // P5 slices G and H (0085-0086, T-DG5-ARCH-05; ADR-0047, ADR-0048).
      "day_ninety_response",
      "day_ninety_test",
      "financial_cash_flow_set",
      "financial_metric_setting",
      "health_assessment",
      "health_assessment_action",
      "health_assessment_answer",
      "kpi_restatement",
      "launch_plan",
      "launch_task",
      "launch_task_predecessor",
      // P5 slices I and J (0089-0090, T-DG5-ARCH-06; ADR-0049, ADR-0050): the branding head row only.
      "branding_setting",
      // P6 slices E and F (0098-0099, T-DG6-ARCH-01; ADR-0051, ADR-0052). The two histories carry record_version.
      "record_sensitivity",
      "sensitive_record_grant",
      "upload_policy",
      // P6 slices J and C (0101-0102, T-DG6-ARCH-02; ADR-0053, ADR-0054). The histories carry record_version;
      // worker_heartbeat is version-stepped but not audited (telemetry).
      "service_identity",
      "operational_exception",
      "worker_heartbeat",
      "storage_setting",
      "notification_channel",
      "notification_delivery",
      // P6 slices B and A (0104-0106, T-DG6-ARCH-03; ADR-0055, ADR-0056). The histories carry record_version;
      // connector_config_version is numbered by version_no (append-only), import_row has no version (column grant).
      "connector",
      "integration_run",
      "outbound_write",
      "webhook_endpoint",
      "import_batch",
      "deliverable_external_change",
    ];
    const rows = await q<{ t: string; d: string }>(
      `SELECT table_name AS t, column_default AS d FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'version' AND is_nullable = 'NO' AND data_type = 'integer'`,
    );
    expect(rows.map((r) => r.t).sort()).toEqual(mutable.sort());
    expect(new Set(rows.map((r) => r.d))).toEqual(new Set(["1"]));
  });

  it("stores money-bearing currency as char(3) with a code check", async () => {
    const rows = await q<{ t: string; c: string; d: string; n: number }>(
      `SELECT table_name AS t, column_name AS c, data_type AS d, character_maximum_length AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name IN ('currency', 'default_currency')`,
    );
    for (const r of rows) expect([r.d, r.n]).toEqual(["character", 3]);
  });
});

describe("mth_app privileges are exactly the data dictionary's", () => {
  it("matches per table", async () => {
    const rows = await q<{ t: string; p: string }>(
      `SELECT table_name AS t, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p
       FROM information_schema.role_table_grants WHERE grantee = 'mth_app' AND table_schema = 'public' GROUP BY table_name`,
    );
    const actual = Object.fromEntries(rows.map((r) => [r.t, r.p]));
    const SIU = "INSERT,SELECT,UPDATE";
    expect(actual).toEqual({
      organization: SIU,
      business_unit: SIU,
      app_user: SIU,
      scoped_assignment: SIU,
      delegation: SIU,
      transformation: SIU,
      outbox_event: SIU,
      user_identity: "DELETE,INSERT,SELECT,UPDATE",
      session: "DELETE,INSERT,SELECT,UPDATE",
      oidc_login_state: "DELETE,INSERT,SELECT,UPDATE",
      idempotency_record: "DELETE,INSERT,SELECT",
      processed_message: "INSERT,SELECT",
      audit_event: "INSERT,SELECT",
      role: "SELECT",
      permission: "SELECT",
      role_permission: "SELECT",
      schema_migration: "SELECT",
      business_unit_closure: "SELECT",
      actor_display: "SELECT",
      scope_node: "SELECT",
      // P2 (0010-0018): no DELETE anywhere; history/snapshot tables are INSERT,SELECT only (ADR-0016).
      // P5 slice A (0062): Studio drafts are inserted and updated by the application (ADR-0039 §1).
      methodology_version: SIU,
      transformation_config_pin: SIU,
      diagnostic_dimension: "SELECT",
      diagnostic_workstream: "SELECT",
      tom_dimension: "SELECT,UPDATE",
      gate_definition: "SELECT",
      gate_criterion_definition: "SELECT",
      charter_scope_check_definition: "SELECT",
      good_outcome_criterion: "SELECT",
      evidence: SIU,
      evidence_content: "INSERT,SELECT",
      evidence_link: SIU,
      north_star: SIU,
      strategic_guardrail: SIU,
      outcome: SIU,
      charter: SIU,
      charter_version: "INSERT,SELECT",
      kpi_definition: SIU,
      baseline: SIU,
      outcome_kpi: SIU,
      value_pool: SIU,
      diagnostic_item: SIU,
      diagnostic_finding: SIU,
      diagnostic_workstream_output: SIU,
      tom_canvas_cell: SIU,
      tom_gap: SIU,
      capability: SIU,
      journey: SIU,
      journey_pain_point: SIU,
      decision: SIU,
      decision_option: SIU,
      record_code_counter: SIU,
      tom_workshop: SIU,
      tom_workshop_participant: SIU,
      tom_workshop_item: SIU,
      action_item: SIU,
      dependency: SIU,
      gate_instance: SIU,
      gate_submission: SIU,
      gate_submission_criterion: "INSERT,SELECT",
      gate_decision: "INSERT,SELECT",
      role_accountability: "SELECT",
      // P3 (0020-0024): still no DELETE anywhere; append-only history/decision tables are INSERT,SELECT only.
      roadmap_wave: SIU,
      initiative: SIU,
      initiative_gap_link: SIU,
      initiative_outcome_contribution: SIU,
      initiative_decision_link: SIU,
      deliverable: SIU,
      milestone: SIU,
      gate_dispensation: SIU,
      scoring_weight_set: SIU,
      scoring_weight: "INSERT,SELECT",
      initiative_score: SIU,
      initiative_score_result: "INSERT,SELECT",
      ranking_snapshot: SIU,
      ranking_override: SIU,
      ranking_entry: "INSERT,SELECT",
      dependency_type: SIU,
      resource_role: SIU,
      capacity: SIU,
      resource_demand: SIU,
      portfolio_selection: "INSERT,SELECT",
      funding_decision: "INSERT,SELECT",
      benefit_formula: SIU,
      benefit_formula_version: SIU,
      benefit_formula_variable: "INSERT,SELECT",
      benefit_calculation: "INSERT,SELECT",
      business_case: SIU,
      business_case_line: SIU,
      benefit_formula_example: "SELECT",
      benefit_formula_example_variable: "SELECT",
      gate_decision_agreement: "INSERT,SELECT",
      // P4 slices I and C (0028-0031): still no DELETE anywhere; seeded catalogues are SELECT only, job schedules are
      // seeded (SELECT,UPDATE), and append-only decision/escalation tables are INSERT,SELECT only.
      business_calendar: SIU,
      business_calendar_holiday: SIU,
      job_schedule: "SELECT,UPDATE",
      work_item_kind: "SELECT",
      work_item: SIU,
      inbox_notification: SIU,
      access_group: SIU,
      access_group_member: SIU,
      governance_party: "SELECT",
      role_mapping: SIU,
      decision_right_template: "SELECT",
      governance_matrix: SIU,
      transformation_decision_right: SIU,
      raci_template_deliverable: "SELECT",
      raci_template_cell: "SELECT",
      transformation_raci_deliverable: SIU,
      transformation_raci_assignment: SIU,
      approval_type: "SELECT",
      approval: SIU,
      approval_decision: "INSERT,SELECT",
      approval_escalation: "INSERT,SELECT",
      approval_decision_record: "SELECT",
      // P4 slice A (0033-0036): still no DELETE anywhere; value versions, reviews, evidence links, formula inputs,
      // trajectory points, calculation runs and evaluations are append-only (INSERT,SELECT).
      reporting_period: SIU,
      kpi_version: SIU,
      kpi_formula_input: "INSERT,SELECT",
      kpi_rag_threshold: SIU,
      target_trajectory: SIU,
      target_trajectory_point: "INSERT,SELECT",
      kpi_actual: SIU,
      kpi_actual_value: "INSERT,SELECT",
      kpi_actual_review: "INSERT,SELECT",
      kpi_actual_evidence: "INSERT,SELECT",
      calculation_run: "INSERT,SELECT",
      kpi_evaluation: "INSERT,SELECT",
      data_quality_finding: SIU,
      rag_override: SIU,
      // P4 slice B (0037-0040): still no DELETE anywhere; lifecycle history, allocations, lineage inputs and evidence
      // links are append-only (INSERT,SELECT); the step definitions and the two value views are read-only.
      benefit_lifecycle_step_definition: "SELECT",
      benefit_valuation_method: SIU,
      benefit_group: SIU,
      benefit: SIU,
      benefit_enabler: SIU,
      benefit_lifecycle_event: "INSERT,SELECT",
      benefit_allocation: "INSERT,SELECT",
      benefit_scenario: SIU,
      benefit_scenario_value: SIU,
      benefit_plan_value: SIU,
      benefit_measurement: SIU,
      benefit_measurement_input: "INSERT,SELECT",
      benefit_evidence: "INSERT,SELECT",
      finance_validation: SIU,
      benefit_overlap: SIU,
      benefit_counting: "SELECT",
      benefit_value_line: "SELECT",
      // P4 slice E (0041-0043): still no DELETE anywhere; the corrective signal log is append-only (INSERT,SELECT);
      // the RAID register is a read-only view.
      raid_entry: SIU,
      raid_register: "SELECT",
      corrective_action_rule: SIU,
      corrective_case: SIU,
      corrective_signal: "INSERT,SELECT",
      budget_line: SIU,
      initiative_schedule: SIU,
      // P4 slice D (0044-0046): still no DELETE anywhere; outputs, action links, escalations and blocker statuses are
      // append-only (INSERT,SELECT); the forum template and the T16 view are read-only.
      forum_template: "SELECT",
      forum: SIU,
      forum_participant: SIU,
      meeting_series: SIU,
      meeting: SIU,
      agenda_item: SIU,
      meeting_attendance: SIU,
      meeting_output: "INSERT,SELECT",
      meeting_action_link: "INSERT,SELECT",
      meeting_minutes: SIU,
      governance_escalation_rule: SIU,
      decision_escalation: "INSERT,SELECT",
      blocker_status: "INSERT,SELECT",
      executive_decision_log: "SELECT",
      // P4 slices F and G (0047-0049): still no DELETE anywhere; form versions, involvement, area cycles, handover evidence
      // and closure records are append-only (INSERT,SELECT); the indicator template is read-only.
      adoption_indicator_template: "SELECT",
      stakeholder_group: SIU,
      stakeholder_champion: SIU,
      adoption_metric_link: SIU,
      adoption_intervention: SIU,
      assessment_form: SIU,
      assessment_form_version: "INSERT,SELECT",
      assessment_invitation: SIU,
      training_record: SIU,
      assessment_record: SIU,
      stakeholder_involvement: "INSERT,SELECT",
      champion_constraint: SIU,
      performance_area: SIU,
      performance_area_cycle: "INSERT,SELECT",
      performance_area_link: SIU,
      control: SIU,
      control_check: SIU,
      bau_handover: SIU,
      bau_handover_evidence: "INSERT,SELECT",
      transition_decision: SIU,
      sustainment_review: SIU,
      lesson: SIU,
      improvement_item: SIU,
      closure_record: "INSERT,SELECT",
      phase_definition: "SELECT",
      phase_step_definition: "SELECT",
      phase_step: SIU,
      phase_step_evidence: SIU,
      gate_criterion_review: "INSERT,SELECT",
      gate_exception: SIU,
      gate_decision_scale_scope: "INSERT,SELECT",
      gate_decision_condition: "INSERT,SELECT",
      scale_transition: "INSERT,SELECT",
      risk_disposition: "INSERT,SELECT",
      change_control_policy: SIU,
      change_request: SIU,
      impact_assessment: "INSERT,SELECT",
      impact_assessment_item: "INSERT,SELECT",
      portfolio: SIU,
      portfolio_transformation: SIU,
      workstream: SIU,
      workstream_initiative: SIU,
      trace_link: SIU,
      inherited_record: SIU,
      traceability_edge: "SELECT",
      t10_area_definition: "SELECT",
      dashboard_rag_policy: SIU,
      my_work_draft: "SELECT",
      // P5 slice A (0062-0064): still no DELETE anywhere; check runs, revision proposals, plan items and pin history are
      // append-only (INSERT,SELECT); the source inventory is read-only; review policies are seeded (SELECT,UPDATE).
      config_review_policy: "SELECT,UPDATE",
      source_element: "SELECT",
      methodology_element: SIU,
      config_check_run: "INSERT,SELECT",
      revision_proposal: "INSERT,SELECT",
      config_review_request: SIU,
      methodology_migration: SIU,
      methodology_migration_item: "INSERT,SELECT",
      transformation_config_pin_history: "INSERT,SELECT",
      gate_reapproval: SIU,
      // P5 slices B and C (0068-0070): still no DELETE anywhere; comments and procedure links are append-only
      // (INSERT,SELECT); the record-type, source-column and coverage registries are read-only.
      form_record_type: "SELECT",
      form_source_field: "SELECT",
      form_custom_value: SIU,
      form_draft: SIU,
      form_record_comment: "INSERT,SELECT",
      form_record_attachment: SIU,
      procedure_definition: SIU,
      procedure_step_definition: SIU,
      procedure_instance: SIU,
      procedure_step_instance: SIU,
      procedure_instance_link: "INSERT,SELECT",
      methodology_coverage_link: "SELECT",
      // P5 slices D and E (0074-0076): still no DELETE anywhere; the trigger and action catalogues are read-only;
      // dry runs, action results, job runs, condition closures/escalations, digests and slips are append-only.
      automation_trigger: "SELECT",
      automation_action_type: "SELECT",
      automation_rule: SIU,
      automation_rule_version: SIU,
      // 0097 (D-170): the contributor records are append-only (written by triggers in the writer's transaction).
      automation_rule_version_contributor: "INSERT,SELECT",
      methodology_version_contributor: "INSERT,SELECT",
      automation_dry_run: "INSERT,SELECT",
      automation_execution: SIU,
      automation_action_result: "INSERT,SELECT",
      job_run: "INSERT,SELECT",
      operational_failure: SIU,
      approval_route_step: SIU,
      gate_condition_closure: "INSERT,SELECT",
      gate_condition_escalation: "INSERT,SELECT",
      notification_policy: SIU,
      notification_preference: SIU,
      notification_digest: "INSERT,SELECT",
      meeting_cutoff_pack: SIU,
      dependency_slip: "INSERT,SELECT",
      // P5 slice F (0080-0082): still no DELETE anywhere; the report catalogue is read-only; snapshot sources,
      // versions and evidence and owner-update revisions are append-only; snapshots are never deleted.
      report_definition: "SELECT",
      report_snapshot: SIU,
      report_snapshot_source: "INSERT,SELECT",
      report_snapshot_version: "INSERT,SELECT",
      report_snapshot_evidence: "INSERT,SELECT",
      owner_update: SIU,
      owner_update_revision: "INSERT,SELECT",
      export_job: SIU,
      export_job_progress: SIU,
      // P5 slices G and H (0085-0087): still no DELETE anywhere; the launch and Day-90 catalogues are read-only;
      // restatement periods, reconciliations and reissue offers and cash-flow rows are append-only; a predecessor link
      // is removed by stamping removed_at, never deleted.
      day_ninety_question: "SELECT",
      day_ninety_response: SIU,
      day_ninety_test: SIU,
      financial_cash_flow: "INSERT,SELECT",
      financial_cash_flow_set: SIU,
      financial_metric_setting: SIU,
      health_assessment: SIU,
      health_assessment_action: SIU,
      health_assessment_answer: SIU,
      kpi_restatement: SIU,
      kpi_restatement_period: "INSERT,SELECT",
      kpi_restatement_reconciliation: "INSERT,SELECT",
      kpi_restatement_reissue_offer: "INSERT,SELECT",
      launch_plan: SIU,
      launch_task: SIU,
      launch_task_predecessor: SIU,
      launch_template_item: "SELECT",
      launch_window: "SELECT",
      // P5 slices I and J (0089-0091): still no DELETE anywhere; the reader catalogues, the environment marker, demo
      // records, dataset runs and the walkthrough are read-only to mth_app (written by migrations and the demo CLI);
      // branding versions are append-only and the head row is updated in place with If-Match.
      branding_setting: SIU,
      branding_version: "INSERT,SELECT",
      demo_dataset_run: "SELECT",
      demo_seed_record: "SELECT",
      deployment_environment: "SELECT",
      guiding_question: "SELECT",
      methodology_element_profile: "SELECT",
      playbook_block: "SELECT",
      playbook_block_link: "SELECT",
      source_foundation: "SELECT",
      walkthrough_step: "SELECT",
      // P6 slices E and F (0098-0100): still no DELETE anywhere; the sensitivity flag, grants and upload policy are
      // updated in place with If-Match; their histories are written only by SECURITY DEFINER triggers (SELECT only).
      record_sensitivity: SIU,
      record_sensitivity_change: "SELECT",
      sensitive_record_grant: SIU,
      upload_policy: SIU,
      upload_policy_change: "SELECT",
      // P6 slices J and C (0101-0102): still no DELETE anywhere. service_identity has table-level INSERT and SELECT and a
      // COLUMN-level UPDATE of the grant only (not listed in role_table_grants; probe SI12). Histories: SELECT only.
      service_identity: "INSERT,SELECT",
      service_identity_change: "SELECT",
      operational_exception: SIU,
      operational_exception_event: "SELECT",
      operational_exception_kpi: "INSERT,SELECT",
      worker_heartbeat: SIU,
      storage_setting: SIU,
      storage_setting_change: "SELECT",
      notification_channel: SIU,
      notification_channel_change: "SELECT",
      notification_delivery: SIU,
      // P6 slices B and A (0104-0106): still no DELETE anywhere. Configuration versions, webhook receipts and lineage are
      // append-only (INSERT and SELECT); import_row has a COLUMN-level UPDATE of commit_status and updated_at only (probe
      // IM14). Histories: SELECT only.
      connector: SIU,
      connector_config_version: "INSERT,SELECT",
      connector_change: "SELECT",
      integration_run: SIU,
      integration_run_event: "SELECT",
      outbound_write: SIU,
      outbound_write_event: "SELECT",
      webhook_endpoint: SIU,
      webhook_endpoint_change: "SELECT",
      webhook_receipt: "INSERT,SELECT",
      import_batch: SIU,
      import_batch_event: "SELECT",
      import_row: "INSERT,SELECT",
      import_row_commit: "INSERT,SELECT",
      deliverable_external_change: SIU,
      deliverable_external_change_event: "SELECT",
    });
  });

  it("has no CREATE on public and owns nothing", async () => {
    const [row] = await q<{ create: boolean; owned: number }>(
      `SELECT has_schema_privilege('mth_app', 'public', 'CREATE') AS create,
              (SELECT count(*)::int FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'mth_app') AS owned`,
    );
    expect(row).toEqual({ create: false, owned: 0 });
  });

  it("can use the pg-boss schema without DDL", async () => {
    const [row] = await q<{ usage: boolean; create: boolean; ins: boolean }>(
      `SELECT has_schema_privilege('mth_app', 'pgboss', 'USAGE') AS usage,
              has_schema_privilege('mth_app', 'pgboss', 'CREATE') AS create,
              has_table_privilege('mth_app', 'pgboss.job', 'INSERT') AS ins`,
    );
    expect(row).toEqual({ usage: true, create: false, ins: true });
  });
});
