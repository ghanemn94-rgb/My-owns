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

  it("0026: product gate G4 is submittable; G5 and G6 stay closed (ADR-0021 §7)", async () => {
    const rows = await q<{ code: string; submission_enabled: boolean }>(
      `SELECT code, submission_enabled FROM gate_definition ORDER BY ordinal`,
    );
    expect(rows.map((r) => [r.code, r.submission_enabled])).toEqual([
      ["G1", true],
      ["G2", true],
      ["G3", true],
      ["G4", true],
      ["G5", false],
      ["G6", false],
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
      methodology_version: "SELECT",
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
